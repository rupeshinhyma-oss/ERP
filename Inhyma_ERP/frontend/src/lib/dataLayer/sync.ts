/**
 * Sync Manager (Phase 2 / Phase 8C, Section 7).
 *
 * Drains the queued operations over the authenticated HTTP API.
 * Uses cross-tab locking, error classification, exponential backoff,
 * and stable idempotency keys.
 */

import { apiCall } from "@/lib/api";
import { Auth } from "@/lib/auth";
import { connectivityManager } from "./connectivity";
import { withCrossTabLock } from "./tabLock";
import { classifyError } from "./errors";
import { computeNextRetryAt } from "./retryPolicy";
import { recordIdempotencyResolved } from "./idempotency";
import { getCurrentDbName, onContextChange } from "./context";
import { cacheRecord, evictCachedRecord } from "./localCache";
import { dbPut, dbGet } from "./db";
import { STORES } from "./schema";
import {
  getSyncableOperations,
  markCompleted,
  markProcessing,
  markRetrying,
  moveToFailed,
  reclaimStaleProcessingOperations,
  type QueuedOperation,
} from "./queue";

export type SyncStatus = "IDLE" | "SYNCING";

type SyncListener = (status: SyncStatus) => void;

interface SyncMetadataRecord {
  key: "last_sync";
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}

const SYNC_LOCK_NAME = "queue_drain";
const SYNC_METADATA_KEY = "last_sync";

class SyncManager {
  private status: SyncStatus = "IDLE";
  private readonly listeners = new Set<SyncListener>();
  private readonly scheduledRetries = new Map<string, ReturnType<typeof setTimeout>>();
  private started = false;
  private unsubscribeConnectivity: (() => void) | null = null;
  private unsubscribeContext: (() => void) | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;

    let wasReachable = connectivityManager.isReachable();
    this.unsubscribeConnectivity = connectivityManager.subscribe((state) => {
      const reachable = state === "ONLINE";
      if (reachable && !wasReachable) {
        void this.triggerSync();
      }
      wasReachable = reachable;
    });

    // Cancel retry timers immediately if user logs out or switches accounts
    this.unsubscribeContext = onContextChange(() => {
      for (const timer of this.scheduledRetries.values()) clearTimeout(timer);
      this.scheduledRetries.clear();
    });

    void this.triggerSync();
  }

  stop(): void {
    this.started = false;
    this.unsubscribeConnectivity?.();
    this.unsubscribeConnectivity = null;
    this.unsubscribeContext?.();
    this.unsubscribeContext = null;
    for (const timer of this.scheduledRetries.values()) clearTimeout(timer);
    this.scheduledRetries.clear();
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async triggerSync(): Promise<void> {
    if (this.status === "SYNCING") return;

    const reachable = await connectivityManager.probeNow();
    if (!reachable) return;

    this.setStatus("SYNCING");
    try {
      await withCrossTabLock(SYNC_LOCK_NAME, () => this.drainQueue());
    } finally {
      this.setStatus("IDLE");
    }
  }

  private async drainQueue(): Promise<void> {
    // 1. Recover any operations stranded in PROCESSING by a tab crash or closed browser
    await reclaimStaleProcessingOperations();

    // 2. Fetch syncable operations
    const operations = await getSyncableOperations();
    const now = Date.now();
    let attemptedAny = false;
    let lastError: string | null = null;

    for (const operation of operations) {
      if (operation.nextRetryAt && new Date(operation.nextRetryAt).getTime() > now) {
        this.scheduleRetryWakeup(operation);
        continue;
      }

      attemptedAny = true;
      const outcome = await this.attemptOperation(operation);
      if (outcome !== null) lastError = outcome;
    }

    await this.recordSyncMetadata(attemptedAny, lastError);
  }

  private async attemptOperation(operation: QueuedOperation): Promise<string | null> {
    // Security check: ensure operation belongs to the currently-authenticated user
    const currentUserId = Auth.getProfile()?.id ?? null;
    if (operation.userId && operation.userId !== currentUserId) {
      // Never dispatch User A's pending mutation under User B's authentication!
      return "USER_CONTEXT_MISMATCH";
    }

    await markProcessing(operation.operationId);

    try {
      const response = await apiCall(operation.path, {
        method: operation.method,
        body: operation.payload !== undefined ? JSON.stringify(operation.payload) : undefined,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": operation.idempotencyKey,
        },
      });

      await markCompleted(operation.operationId);
      await recordIdempotencyResolved(operation.idempotencyKey, "SUCCEEDED");
      const timer = this.scheduledRetries.get(operation.operationId);
      if (timer) {
        clearTimeout(timer);
        this.scheduledRetries.delete(operation.operationId);
      }

      // Reconcile cache if server returned authoritative data
      if (response && typeof response === "object" && "data" in response) {
        const serverData = (response as { data: unknown }).data;
        if (serverData && typeof serverData === "object" && "id" in serverData) {
          const recordId = String((serverData as { id: unknown }).id);
          const serverVersion = (serverData as { version?: number | null }).version ?? 1;

          // If this was an optimistic creation with a temp ID, evict the temp record
          if (operation.entityId && operation.entityId.startsWith("temp_")) {
            await evictCachedRecord(operation.entityType, operation.entityId);
          }

          // Write authoritative server record to local cache
          await cacheRecord({
            entity: operation.entityType,
            entityId: recordId,
            version: serverVersion,
            data: serverData,
            source: "SERVER_FETCH",
          });
        }
      }

      return null;
    } catch (err) {
      const classified = classifyError(err);

      if (classified.classification === "PERMANENT") {
        await moveToFailed(operation.operationId, classified.diagnosticMessage);
        await recordIdempotencyResolved(operation.idempotencyKey, "FAILED");
        return classified.diagnosticMessage;
      }

      if (operation.retryCount + 1 >= operation.maxRetries) {
        await moveToFailed(
          operation.operationId,
          `Retry limit (${operation.maxRetries}) exhausted. Last error: ${classified.diagnosticMessage}`
        );
        await recordIdempotencyResolved(operation.idempotencyKey, "FAILED");
        return classified.diagnosticMessage;
      }

      const nextRetryAt = computeNextRetryAt(operation.retryCount);
      const updated = await markRetrying(operation.operationId, nextRetryAt, classified.diagnosticMessage);
      this.scheduleRetryWakeup(updated);
      return classified.diagnosticMessage;
    }
  }


  private scheduleRetryWakeup(operation: QueuedOperation): void {
    const existing = this.scheduledRetries.get(operation.operationId);
    if (existing) clearTimeout(existing);
    if (!operation.nextRetryAt) return;

    const delayMs = Math.max(0, new Date(operation.nextRetryAt).getTime() - Date.now());
    const timer = setTimeout(() => {
      this.scheduledRetries.delete(operation.operationId);
      void this.triggerSync();
    }, delayMs);
    this.scheduledRetries.set(operation.operationId, timer);
  }

  private async recordSyncMetadata(attemptedAny: boolean, lastError: string | null): Promise<void> {
    if (!attemptedAny) return;
    const dbName = getCurrentDbName();
    const now = new Date().toISOString();
    const record: SyncMetadataRecord = {
      key: SYNC_METADATA_KEY,
      lastSuccessAt: lastError ? await this.getLastSuccessAt(dbName) : now,
      lastAttemptAt: now,
      lastError,
    };
    await dbPut(dbName, STORES.SYNC_METADATA, record);
  }

  private async getLastSuccessAt(dbName: string): Promise<string | null> {
    const existing = await dbGet<SyncMetadataRecord>(dbName, STORES.SYNC_METADATA, SYNC_METADATA_KEY);
    return existing?.lastSuccessAt ?? null;
  }

  private setStatus(next: SyncStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.listeners.forEach((listener) => listener(next));
  }
}

export const syncManager = new SyncManager();

/** Read the current sync metadata. */
export async function getSyncMetadata(): Promise<SyncMetadataRecord | undefined> {
  return dbGet<SyncMetadataRecord>(getCurrentDbName(), STORES.SYNC_METADATA, SYNC_METADATA_KEY);
}
