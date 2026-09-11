/**
 * Idempotency Foundation (Phase 2 / Phase 8C, Section 4).
 *
 * Generates a stable idempotency key for a queued operation and records
 * its eventual outcome, independently of `pending_operations` itself
 * (Section 3's own `idempotency_records` store) -- so "did this
 * operation already succeed?" can still be answered even after the
 * originating queue entry has been pruned.
 */

import { dbGet, dbPut } from "./db";
import { STORES } from "./schema";
import { getCurrentDbName } from "./context";

export type IdempotencyOutcome = "PENDING" | "SUCCEEDED" | "FAILED";

export interface IdempotencyRecord {
  idempotencyKey: string;
  outcome: IdempotencyOutcome;
  resultSnapshot?: unknown;
  createdAt: string;
  resolvedAt?: string;
}

/**
 * Generate a new, globally-unique idempotency key.
 */
export function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** Record that an idempotency key now exists and is awaiting resolution. Call this at the moment an operation is enqueued, not when it's sent. */
export async function recordIdempotencyPending(idempotencyKey: string): Promise<void> {
  const record: IdempotencyRecord = {
    idempotencyKey,
    outcome: "PENDING",
    createdAt: new Date().toISOString(),
  };
  await dbPut(getCurrentDbName(), STORES.IDEMPOTENCY_RECORDS, record);
}

/** Record the final outcome of an operation once the server has actually responded (success or permanent failure). */
export async function recordIdempotencyResolved(
  idempotencyKey: string,
  outcome: "SUCCEEDED" | "FAILED",
  resultSnapshot?: unknown
): Promise<void> {
  const existing = await dbGet<IdempotencyRecord>(getCurrentDbName(), STORES.IDEMPOTENCY_RECORDS, idempotencyKey);
  const record: IdempotencyRecord = {
    idempotencyKey,
    outcome,
    resultSnapshot,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    resolvedAt: new Date().toISOString(),
  };
  await dbPut(getCurrentDbName(), STORES.IDEMPOTENCY_RECORDS, record);
}

/**
 * Look up what's known about a previously-issued idempotency key.
 */
export async function getIdempotencyRecord(idempotencyKey: string): Promise<IdempotencyRecord | undefined> {
  return dbGet<IdempotencyRecord>(getCurrentDbName(), STORES.IDEMPOTENCY_RECORDS, idempotencyKey);
}
