/**
 * Local Entity Cache (Phase 2 / Phase 8C, Sections 9-10).
 *
 * Caches individual ERP records in IndexedDB with enough metadata
 * (entity, entity_id, version, updated_at, cached_at, source, sync
 * state) to support fast local reads and version-based staleness
 * checking against live events.
 */

import { dbDelete, dbGet, dbGetAllByIndex, dbPut } from "./db";
import { STORES } from "./schema";
import { getCurrentDbName } from "./context";

export type CacheSource = "SERVER_FETCH" | "OPTIMISTIC_LOCAL" | "LIVE_EVENT";

export interface CachedRecord<T = unknown> {
  cacheKey: string;
  entity: string;
  entityId: string;
  version: number | null;
  data: T;
  updatedAt: string | null;
  cachedAt: string;
  source: CacheSource;
}

export function buildCacheKey(entity: string, entityId: string): string {
  return `${entity}:${entityId}`;
}

export interface CacheRecordInput<T> {
  entity: string;
  entityId: string;
  version?: number | null;
  data: T;
  updatedAt?: string | null;
  source: CacheSource;
}

/** Store (or overwrite) one cached record. */
export async function cacheRecord<T>(input: CacheRecordInput<T>): Promise<CachedRecord<T>> {
  const record: CachedRecord<T> = {
    cacheKey: buildCacheKey(input.entity, input.entityId),
    entity: input.entity,
    entityId: input.entityId,
    version: input.version ?? null,
    data: input.data,
    updatedAt: input.updatedAt ?? null,
    cachedAt: new Date().toISOString(),
    source: input.source,
  };
  await dbPut(getCurrentDbName(), STORES.CACHED_RECORDS, record);
  return record;
}

export async function getCachedRecord<T>(entity: string, entityId: string): Promise<CachedRecord<T> | undefined> {
  return dbGet<CachedRecord<T>>(getCurrentDbName(), STORES.CACHED_RECORDS, buildCacheKey(entity, entityId));
}

export async function getCachedRecordsByEntity<T>(entity: string): Promise<CachedRecord<T>[]> {
  return dbGetAllByIndex<CachedRecord<T>>(getCurrentDbName(), STORES.CACHED_RECORDS, "entity", entity);
}

export async function evictCachedRecord(entity: string, entityId: string): Promise<void> {
  await dbDelete(getCurrentDbName(), STORES.CACHED_RECORDS, buildCacheKey(entity, entityId));
}

/**
 * Given what's currently cached for an entity and an incoming version / timestamp,
 * decide whether the incoming data is strictly newer.
 *
 * Handles:
 * - Numeric versions (numbers or numeric strings)
 * - Timestamps fallback if versions are absent
 * - Equal or stale versions (returns false)
 * - Malformed version inputs (returns false)
 */
export function isNewerVersion(
  cached: CachedRecord | undefined,
  incomingVersion?: number | string | null,
  incomingTimestamp?: string | null
): boolean {
  if (!cached) return true;

  const numIncoming =
    incomingVersion !== null && incomingVersion !== undefined ? Number(incomingVersion) : null;
  const numCached =
    cached.version !== null && cached.version !== undefined ? Number(cached.version) : null;

  const hasNumIncoming = numIncoming !== null && !Number.isNaN(numIncoming);
  const hasNumCached = numCached !== null && !Number.isNaN(numCached);

  if (hasNumIncoming && hasNumCached) {
    return numIncoming > numCached;
  }

  // If timestamp comparison is available when versions are absent
  if (incomingTimestamp && cached.updatedAt) {
    const incomingTime = new Date(incomingTimestamp).getTime();
    const cachedTime = new Date(cached.updatedAt).getTime();
    if (!Number.isNaN(incomingTime) && !Number.isNaN(cachedTime)) {
      return incomingTime > cachedTime;
    }
  }

  // If incoming has a valid numeric version and cached has none, allow
  if (hasNumIncoming && !hasNumCached) return true;

  // If cached has a valid numeric version and incoming has none, reject overwrite
  if (!hasNumIncoming && hasNumCached) return false;

  return false;
}

/**
 * Given an incoming event shape and what's currently cached, decide
 * whether applying it would move the cache forward.
 */
export function shouldApplyLiveEvent(
  cached: CachedRecord | undefined,
  incoming: {
    entity: string;
    entityId: string;
    version?: number | string | null;
    timestamp?: string | null;
  }
): boolean {
  if (!cached) return true;
  if (cached.entity !== incoming.entity || cached.entityId !== incoming.entityId) {
    throw new Error(
      `shouldApplyLiveEvent called with mismatched entity: cached=${cached.entity}:${cached.entityId}, incoming=${incoming.entity}:${incoming.entityId}`
    );
  }
  return isNewerVersion(cached, incoming.version, incoming.timestamp);
}

