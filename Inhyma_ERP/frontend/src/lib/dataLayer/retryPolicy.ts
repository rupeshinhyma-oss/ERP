/**
 * Retry Policy (Phase 2 / Phase 8C, Section 8).
 *
 * Classifies a failed sync attempt as temporary (worth retrying) or
 * permanent (never retry, surface it), and computes the exponential
 * backoff delay for temporary failures.
 *
 * Reuses `lib/api.ts`'s own `ApiError`/`NETWORK_ERROR_STATUS` rather
 * than re-deriving "is this retryable" a second, possibly-inconsistent
 * way.
 */

import { ApiError, NETWORK_ERROR_STATUS } from "@/lib/api";

const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 5 * 60 * 1000; // 5 minutes
const JITTER_RATIO = 0.2;

/** Statuses considered temporary/worth retrying. */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export type FailureClassification = "TEMPORARY" | "PERMANENT";

/**
 * Decide whether a failed sync attempt should be retried.
 *
 * A network error (no response at all) or one of the retryable HTTP
 * statuses is TEMPORARY. Everything else -- 400 (bad request), 401
 * (after refresh already failed), 403 (forbidden), 404 (gone), 409
 * (conflict), 422 (validation) -- is PERMANENT.
 */
export function classifyFailure(error: unknown): FailureClassification {
  if (error instanceof ApiError) {
    if (error.status === NETWORK_ERROR_STATUS) return "TEMPORARY";
    if (RETRYABLE_STATUSES.has(error.status)) return "TEMPORARY";
    return "PERMANENT";
  }
  return "TEMPORARY";
}

/**
 * Compute the delay (ms) before the next retry attempt, given how many
 * attempts have already been made (0 = about to make the first retry).
 *
 * Exponential backoff with +/-20% jitter, capped at `MAX_DELAY_MS`.
 */
export function computeBackoffDelay(attemptNumber: number): number {
  const raw = BASE_DELAY_MS * 2 ** attemptNumber;
  const capped = Math.min(raw, MAX_DELAY_MS);
  const jitter = capped * JITTER_RATIO * (Math.random() * 2 - 1);
  return Math.max(BASE_DELAY_MS, Math.round(capped + jitter));
}

/** Convenience: compute the next retry's ISO timestamp given the current retry count. */
export function computeNextRetryAt(retryCount: number): string {
  const delayMs = computeBackoffDelay(retryCount);
  return new Date(Date.now() + delayMs).toISOString();
}
