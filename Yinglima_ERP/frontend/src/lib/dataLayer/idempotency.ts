/**
 * Idempotency Foundation (Phase 2, Section 4).
 *
 * Generates a stable idempotency key for a queued operation and records
 * its eventual outcome, independently of `pending_operations` itself
 * (Section 3's own `idempotency_records` store) -- so "did this
 * operation already succeed?" can still be answered even after the
 * originating queue entry has been pruned (e.g. a completed operation
 * cleaned out of `pending_operations` after a successful sync).
 *
 * This is the CLIENT-SIDE half only, exactly as the brief scopes this
 * phase ("The server-side idempotency enforcement will be addressed in
 * a later phase"). What this file guarantees today: the same logical
 * user action -- clicked once, retried automatically after a lost
 * response, or double-clicked -- always carries the SAME key, so once
 * a future backend honors an `Idempotency-Key` header, replays collapse
 * to one business effect. Until that backend support exists, this key
 * is inert extra metadata sent nowhere -- see `queue.ts` for exactly
 * what gets sent today.
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
 *
 * Uses `crypto.randomUUID()` (available in every browser this ERP
 * already targets, per its Vite/ES2021 baseline) rather than a
 * timestamp+random string -- a real UUID has no meaningful collision
 * risk and needs no custom entropy handling.
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
 *
 * A caller can use this BEFORE re-sending a retried mutation to check
 * "did an earlier attempt already succeed?" -- e.g. after a browser
 * restart recovers a PENDING queue entry (Section 11), checking here
 * first can avoid re-sending a mutation whose response was simply lost
 * in transit the first time, once a backend endpoint exists to confirm
 * that server-side (not built in this phase; see module docstring).
 */
export async function getIdempotencyRecord(idempotencyKey: string): Promise<IdempotencyRecord | undefined> {
  return dbGet<IdempotencyRecord>(getCurrentDbName(), STORES.IDEMPOTENCY_RECORDS, idempotencyKey);
}
