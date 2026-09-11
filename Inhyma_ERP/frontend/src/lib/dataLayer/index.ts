/**
 * Data Layer Public Entry Point (Phase 2 / Phase 8C).
 *
 * Public interface for application code: `import { ... } from "@/lib/dataLayer"`.
 */

import { configureDataLayer } from "./context";
import { connectivityManager } from "./connectivity";
import { syncManager } from "./sync";
import { startLiveIntegration, stopLiveIntegration } from "./liveIntegration";
import { closeDatabase } from "./schema";

export { configureDataLayer, getCurrentDbName, onContextChange, wipeAllStores } from "./context";
export { closeDatabase } from "./schema";
export { connectivityManager, type ConnectivityState } from "./connectivity";
export { syncManager, getSyncMetadata, type SyncStatus } from "./sync";
export {
  enqueueOperation,
  cancelOperation,
  getFailedOperations,
  getPendingCount,
  getSyncableOperations,
  reclaimStaleProcessingOperations,
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
export {
  handleLiveEventForCache,
  onLiveReconnect,
  startLiveIntegration,
  stopLiveIntegration,
  type CacheAction,
  type LiveCacheIntegrationResult,
} from "./liveIntegration";
export {
  getBuyerWithCache,
  createBuyerOfflineCapable,
  updateBuyerOfflineCapable,
  type BuyerEntity,
} from "./buyerPilot";

/**
 * Initialize the data layer for this tab: configure the ERP namespace,
 * start connectivity monitoring, start the Sync Manager, and wire the
 * realtime liveClient bridge.
 */
export function initDataLayer(erpKey: string = "inhyma"): void {
  configureDataLayer(erpKey);
  connectivityManager.start();
  syncManager.start();
  startLiveIntegration();
}

/** Tear down background activity (primarily for test cleanup). */
export function shutdownDataLayer(): void {
  stopLiveIntegration();
  syncManager.stop();
  connectivityManager.stop();
  closeDatabase();
}


