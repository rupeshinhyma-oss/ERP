/**
 * Buyer Pilot Data Layer Integration (Phase 8C, Section 15).
 *
 * Demonstrates the full integration pattern for the low-risk Buyer entity:
 * - Cache-first retrieval with transparent network fallback.
 * - Offline-capable optimistic mutation via `enqueueOperation`.
 * - Durable queue persistence across reload.
 * - Integration with live event updates and reconnection syncing.
 */

import { apiGet } from "@/lib/api";
import { cacheRecord, getCachedRecord } from "./localCache";
import { enqueueOperation, type QueuedOperation } from "./queue";
import { connectivityManager } from "./connectivity";
import { syncManager } from "./sync";

export interface BuyerEntity {
  id: string;
  company_name: string;
  country_id: string;
  country_name?: string;
  buyer_type?: string;
  status?: string;
  version?: number | null;
  [key: string]: unknown;
}

const BUYER_ENTITY = "buyer";

/**
 * Fetch a buyer record using a cache-first strategy:
 * 1. If present in IndexedDB cache and fresh, returns cached version immediately.
 * 2. If absent or stale, fetches from server REST API (`/buyers/${id}`), updates cache, and returns.
 * 3. If offline and cached, returns cached version with `fromCache: true`.
 */
export async function getBuyerWithCache(
  buyerId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<{ buyer: BuyerEntity; fromCache: boolean }> {
  if (!options.forceRefresh) {
    const cached = await getCachedRecord<BuyerEntity>(BUYER_ENTITY, buyerId);
    if (cached) {
      return { buyer: cached.data, fromCache: true };
    }
  }

  try {
    // Fetch from server: apiGet returns ApiResult<BuyerEntity> where payload is in .data
    const response = await apiGet<BuyerEntity>(`/buyers/${buyerId}`);
    const serverBuyer = response.data;

    // Write to IndexedDB
    await cacheRecord({
      entity: BUYER_ENTITY,
      entityId: buyerId,
      version: serverBuyer.version ?? 1,
      data: serverBuyer,
      source: "SERVER_FETCH",
    });

    return { buyer: serverBuyer, fromCache: false };
  } catch (err) {
    const fallbackCached = await getCachedRecord<BuyerEntity>(BUYER_ENTITY, buyerId);
    if (fallbackCached) {
      return { buyer: fallbackCached.data, fromCache: true };
    }
    throw err;
  }
}


/**
 * Create a buyer with offline capability:
 * 1. Generates an optimistic local buyer ID if not provided.
 * 2. Enqueues the CREATE mutation in the durable `pending_operations` store.
 * 3. Caches the optimistic record in IndexedDB (`source: "OPTIMISTIC_LOCAL"`).
 * 4. If connectivity is ONLINE, triggers `syncManager.triggerSync()` to flush immediately.
 * 5. Returns the optimistic buyer and the queued operation.
 */
export async function createBuyerOfflineCapable(
  payload: Partial<BuyerEntity>,
  userId: string | null = null
): Promise<{ buyer: BuyerEntity; operation: QueuedOperation }> {
  const temporaryId = payload.id || `temp_${crypto.randomUUID()}`;
  const optimisticBuyer: BuyerEntity = {
    id: temporaryId,
    company_name: payload.company_name || "New Buyer",
    country_id: payload.country_id || "",
    version: 1,
    ...payload,
  };

  // Enqueue durable mutation
  const operation = await enqueueOperation({
    appId: "inhyma",
    userId,
    entityType: BUYER_ENTITY,
    entityId: temporaryId,
    operationType: "CREATE",
    method: "POST",
    path: "/buyers",
    payload,
  });

  // Write optimistic record to local cache
  await cacheRecord({
    entity: BUYER_ENTITY,
    entityId: temporaryId,
    version: 1,
    data: optimisticBuyer,
    source: "OPTIMISTIC_LOCAL",
  });

  // Attempt sync if online
  if (connectivityManager.isReachable()) {
    void syncManager.triggerSync();
  }

  return { buyer: optimisticBuyer, operation };
}

/**
 * Update a buyer with offline capability.
 */
export async function updateBuyerOfflineCapable(
  buyerId: string,
  changes: Partial<BuyerEntity>,
  userId: string | null = null
): Promise<{ buyer: BuyerEntity; operation: QueuedOperation }> {
  const cached = await getCachedRecord<BuyerEntity>(BUYER_ENTITY, buyerId);
  const currentData = cached?.data || ({ id: buyerId } as BuyerEntity);
  const updatedBuyer: BuyerEntity = {
    ...currentData,
    ...changes,
    version: (currentData.version ?? 1) + 1,
  };

  const operation = await enqueueOperation({
    appId: "inhyma",
    userId,
    entityType: BUYER_ENTITY,
    entityId: buyerId,
    operationType: "UPDATE",
    method: "PATCH",
    path: `/buyers/${buyerId}`,
    payload: changes,
  });

  await cacheRecord({
    entity: BUYER_ENTITY,
    entityId: buyerId,
    version: updatedBuyer.version,
    data: updatedBuyer,
    source: "OPTIMISTIC_LOCAL",
  });

  if (connectivityManager.isReachable()) {
    void syncManager.triggerSync();
  }

  return { buyer: updatedBuyer, operation };
}
