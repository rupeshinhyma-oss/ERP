/**
 * Outgoing Operation Queue (Phase 2 / Phase 8C, Section 3).
 *
 * The durable record of every mutation a module has asked the data
 * layer to perform on its behalf.
 *
 * State machine:
 *   PENDING --(sync picks it up)--> PROCESSING
 *   PROCESSING --(2xx response)----> COMPLETED
 *   PROCESSING --(temporary failure)-> RETRYING --(next_retry_at due)--> PROCESSING
 *   RETRYING --(retry budget exhausted)--> FAILED
 *   PROCESSING --(permanent failure, e.g. 4xx validation)--> FAILED
 *   PENDING/RETRYING --(user/app cancels)--> CANCELLED
 */

import { dbDelete, dbGet, dbGetAll, dbGetAllByIndex, dbPut, dbUpdate } from "./db";
import { STORES } from "./schema";
import { getCurrentDbName } from "./context";
import { generateIdempotencyKey, recordIdempotencyPending } from "./idempotency";

export type OperationStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "RETRYING" | "FAILED" | "CANCELLED";

export type OperationType = "CREATE" | "UPDATE" | "DELETE" | "CUSTOM";

export interface QueuedOperation {
  operationId: string;
  idempotencyKey: string;
  appId: string;
  userId: string | null;
  entityType: string;
  entityId: string | null;
  operationType: OperationType;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  payload: unknown;
  status: OperationStatus;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  clientSchemaVersion: number;
}

const CLIENT_SCHEMA_VERSION = 1;
const DEFAULT_MAX_RETRIES = 8;

export interface EnqueueOptions {
  appId: string;
  userId: string | null;
  entityType: string;
  entityId?: string | null;
  operationType: OperationType;
  method: QueuedOperation["method"];
  path: string;
  payload: unknown;
  maxRetries?: number;
}

/**
 * Add a new operation to the durable queue. Returns immediately once
 * the write to IndexedDB completes.
 */
export async function enqueueOperation(options: EnqueueOptions): Promise<QueuedOperation> {
  const now = new Date().toISOString();
  const idempotencyKey = generateIdempotencyKey();
  const operation: QueuedOperation = {
    operationId: crypto.randomUUID(),
    idempotencyKey,
    appId: options.appId,
    userId: options.userId,
    entityType: options.entityType,
    entityId: options.entityId ?? null,
    operationType: options.operationType,
    method: options.method,
    path: options.path,
    payload: options.payload,
    status: "PENDING",
    retryCount: 0,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    nextRetryAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    clientSchemaVersion: CLIENT_SCHEMA_VERSION,
  };

  const dbName = getCurrentDbName();
  await recordIdempotencyPending(idempotencyKey);
  await dbPut(dbName, STORES.PENDING_OPERATIONS, operation);
  return operation;
}

/**
 * Reclaim operations stuck in PROCESSING state because of a tab crash,
 * network abort, or closed browser. Any operation in PROCESSING whose lease
 * has expired is reset to RETRYING (or PENDING if retryCount === 0).
 */
export async function reclaimStaleProcessingOperations(leaseMs: number = 30_000): Promise<number> {
  const dbName = getCurrentDbName();
  const processingOps = await dbGetAllByIndex<QueuedOperation>(dbName, STORES.PENDING_OPERATIONS, "status", "PROCESSING");
  const now = Date.now();
  let reclaimed = 0;

  for (const op of processingOps) {
    const updatedAt = new Date(op.updatedAt).getTime();
    if (Number.isNaN(updatedAt) || now - updatedAt >= leaseMs) {
      const nextStatus: OperationStatus = op.retryCount > 0 ? "RETRYING" : "PENDING";
      await dbUpdate<QueuedOperation>(dbName, STORES.PENDING_OPERATIONS, op.operationId, (current) => {
        if (!current) return op;
        return {
          ...current,
          status: nextStatus,
          lastError: current.lastError || "Recovered from interrupted processing state.",
          updatedAt: new Date().toISOString(),
        };
      });
      reclaimed++;
    }
  }

  return reclaimed;
}

/** Fetch every operation currently in PENDING or RETRYING state, ready for the Sync Manager to consider. */
export async function getSyncableOperations(): Promise<QueuedOperation[]> {
  const dbName = getCurrentDbName();
  const [pending, retrying] = await Promise.all([
    dbGetAllByIndex<QueuedOperation>(dbName, STORES.PENDING_OPERATIONS, "status", "PENDING"),
    dbGetAllByIndex<QueuedOperation>(dbName, STORES.PENDING_OPERATIONS, "status", "RETRYING"),
  ]);
  return [...pending, ...retrying].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}


/** Mark an operation as currently being sent. Called by the Sync Manager immediately before the network call. */
export async function markProcessing(operationId: string): Promise<void> {
  await dbUpdate<QueuedOperation>(getCurrentDbName(), STORES.PENDING_OPERATIONS, operationId, (current) => {
    if (!current) throw new Error(`Cannot mark unknown operation ${operationId} as PROCESSING.`);
    return { ...current, status: "PROCESSING", updatedAt: new Date().toISOString() };
  });
}

/** Mark an operation as successfully completed and remove it from the active queue. */
export async function markCompleted(operationId: string): Promise<void> {
  await dbDelete(getCurrentDbName(), STORES.PENDING_OPERATIONS, operationId);
}

/** Schedule a retry for a temporarily-failed operation. */
export async function markRetrying(
  operationId: string,
  nextRetryAt: string,
  error: string
): Promise<QueuedOperation> {
  return dbUpdate<QueuedOperation>(getCurrentDbName(), STORES.PENDING_OPERATIONS, operationId, (current) => {
    if (!current) throw new Error(`Cannot mark unknown operation ${operationId} as RETRYING.`);
    return {
      ...current,
      status: "RETRYING",
      retryCount: current.retryCount + 1,
      nextRetryAt,
      lastError: error,
      updatedAt: new Date().toISOString(),
    };
  });
}

/**
 * Move a permanently-failed (or retry-exhausted) operation out of the
 * active queue and into `failed_operations`.
 */
export async function moveToFailed(operationId: string, error: string): Promise<void> {
  const dbName = getCurrentDbName();
  const current = await dbGet<QueuedOperation>(dbName, STORES.PENDING_OPERATIONS, operationId);
  if (!current) return;

  const failed = { ...current, status: "FAILED" as const, lastError: error, updatedAt: new Date().toISOString() };
  await dbPut(dbName, STORES.FAILED_OPERATIONS, { ...failed, failedAt: failed.updatedAt });
  await dbDelete(dbName, STORES.PENDING_OPERATIONS, operationId);
}

/** Cancel a still-pending operation. Never cancels one already PROCESSING. */
export async function cancelOperation(operationId: string): Promise<boolean> {
  const dbName = getCurrentDbName();
  const current = await dbGet<QueuedOperation>(dbName, STORES.PENDING_OPERATIONS, operationId);
  if (!current || current.status === "PROCESSING") return false;
  await dbPut(dbName, STORES.PENDING_OPERATIONS, {
    ...current,
    status: "CANCELLED" as OperationStatus,
    updatedAt: new Date().toISOString(),
  });
  return true;
}

export async function getFailedOperations(): Promise<(QueuedOperation & { failedAt: string })[]> {
  return dbGetAll(getCurrentDbName(), STORES.FAILED_OPERATIONS);
}

/** Total count of PENDING + PROCESSING + RETRYING operations -- for UI badges and diagnostics. */
export async function getPendingCount(): Promise<number> {
  const ops = await getSyncableOperations();
  return ops.length;
}
