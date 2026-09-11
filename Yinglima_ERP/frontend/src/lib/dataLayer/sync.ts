/**
 * Sync Manager (Phase 2, Section 7).
 *
 * The one place that actually sends a queued operation to the network.
 * Ties together every other module in this layer:
 *
 *   connectivity.ts  -- don't even try if we know we're not reachable
 *   queue.ts         -- what to send, and how to record the outcome
 *   retryPolicy.ts   -- how long to wait before trying a failed one again
 *   tabLock.ts       -- only one tab actually drains the queue at a time
 *   idempotency.ts   -- every request carries its stable key
 *
 * Triggers (Section 7's exact required list -- deliberately NOT a
 * polling loop):
 * - `start()` is called once at app startup (see Section 11).
 * - The connectivity manager's OFFLINE/DEGRADED -> ONLINE transition.
 * - `triggerSync()` called explicitly by the host app (a user action,
 *   or a future WebSocket "you have pending changes" notification).
 *
 * Nothing here uses `setInterval`. The only timer this file schedules
 * is a ONE-SHOT `setTimeout` per retrying operation, fired at that
 * operation's own `nextRetryAt` -- never a fixed-cadence rescan of the
 * whole queue (Section 21).
 */

import { apiCall } from "@/lib/api";
import { connectivityManager } from "./connectivity";
import { withCrossTabLock } from "./tabLock";
import { classifyError } from "./errors";
import { computeNextRetryAt } from "./retryPolicy";
import { recordIdempotencyResolved } from "./idempotency";
import { getCurrentDbName } from "./context";
import { dbPut, dbGet } from "./db";
import { STORES } from "./schema";
import {
  getSyncableOperations,
  markCompleted,
  markProcessing,
  markRetrying,
  moveToFailed,
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

    void this.triggerSync();
  }

  stop(): void {
    this.started = false;
    this.unsubscribeConnectivity?.();
    this.unsubscribeConnectivity = null;
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
    await markProcessing(operation.operationId);

    try {
      // Deliberately NOT passing a `RetryConfig` with `idempotent: true`
      // here: apiCall's own built-in retry (for GET/HEAD or explicitly
      // idempotent calls) would double up with this Sync Manager's own
      // queue-level retry/backoff below, layering two independent retry
      // loops on the same request. The queue is the single source of
      // retry truth for anything that went through it.
      await apiCall(operation.path, {
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

/** Read the current sync metadata (Section 16: "last successful synchronization"). */
export async function getSyncMetadata(): Promise<SyncMetadataRecord | undefined> {
  return dbGet<SyncMetadataRecord>(getCurrentDbName(), STORES.SYNC_METADATA, SYNC_METADATA_KEY);
}
