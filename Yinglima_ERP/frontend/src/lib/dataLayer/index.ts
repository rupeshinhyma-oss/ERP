/**
 * Data Layer Public Entry Point (Phase 2).
 *
 * The intended import surface for application code: `import { ... }
 * from "@/lib/dataLayer"` rather than reaching into individual files.
 *
 * `initDataLayer` is the ONE function a host app calls at startup.
 * Section 19 says this phase does NOT yet require any existing module
 * to call it -- it is provided and tested now so a later phase's
 * per-module integration has a single, already-verified entry point.
 */

import { configureDataLayer } from "./context";
import { connectivityManager } from "./connectivity";
import { syncManager } from "./sync";

export { configureDataLayer, getCurrentDbName, onContextChange, wipeAllStores } from "./context";
export { connectivityManager, type ConnectivityState } from "./connectivity";
export { syncManager, getSyncMetadata, type SyncStatus } from "./sync";
export {
  enqueueOperation,
  cancelOperation,
  getFailedOperations,
  getPendingCount,
  getSyncableOperations,
  type QueuedOperation,
  type OperationStatus,
  type OperationType,
  type EnqueueOptions,
} from "./queue";
export {
  cacheRecord,
  getCachedRecord,
  getCachedRecordsByEntity,
  evictCachedRecord,
  isNewerVersion,
  shouldApplyLiveEvent,
  buildCacheKey,
  type CachedRecord,
  type CacheSource,
} from "./localCache";
export { classifyError, type ClassifiedError, type ErrorCategory } from "./errors";
export {
  classifyFailure,
  computeBackoffDelay,
  computeNextRetryAt,
  type FailureClassification,
} from "./retryPolicy";
export {
  generateIdempotencyKey,
  getIdempotencyRecord,
  type IdempotencyRecord,
  type IdempotencyOutcome,
} from "./idempotency";

/**
 * Initialize the data layer for this tab: configure the ERP namespace,
 * start connectivity monitoring, and start the Sync Manager.
 *
 * Call once, as early as practical in app startup -- safe to call
 * before a user is logged in (see `getDatabaseName`'s "anonymous"
 * fallback in `schema.ts`), and safe to call multiple times.
 */
export function initDataLayer(erpKey: string): void {
  configureDataLayer(erpKey);
  connectivityManager.start();
  syncManager.start();
}

/** Tear down background activity. Mainly for tests; a real app tab never needs to call this. */
export function shutdownDataLayer(): void {
  syncManager.stop();
  connectivityManager.stop();
}
