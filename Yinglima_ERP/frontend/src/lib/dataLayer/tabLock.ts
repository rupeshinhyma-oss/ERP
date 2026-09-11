/**
 * Multi-Tab Sync Coordination (Phase 2, Section 14).
 *
 * Generalizes the exact TTL-based `localStorage` lock pattern
 * `lib/api.ts` already uses for cross-tab token-refresh coordination
 * (`acquireCrossTabRefreshLock`/`releaseCrossTabRefreshLock`) into a
 * reusable primitive, rather than introducing `BroadcastChannel` or
 * another new browser-coordination mechanism for what is the same
 * underlying problem: "only one tab should do this thing at a time"
 * (Section 18: reuse an existing pattern instead of a second one).
 *
 * Used by the Sync Manager so that with N tabs open, only one actually
 * flushes the operation queue at a time -- Section 14's "Tab A processes
 * operation, Tab B processes the same operation again" is prevented at
 * the point of DEQUEUEING, on top of (not instead of) each operation's
 * own idempotency key, which remains the last line of defense if a lock
 * is ever bypassed (e.g. a tab that hard-crashed mid-sync).
 */

const LOCK_TTL_MS = 15000;
const LOCK_POLL_INTERVAL_MS = 200;

function lockKey(name: string): string {
  return `erp_data_layer_lock:${name}`;
}

function isLockActive(name: string): boolean {
  const raw = localStorage.getItem(lockKey(name));
  if (!raw) return false;
  const lockedAt = Number(raw);
  if (!Number.isFinite(lockedAt)) return false;
  if (Date.now() - lockedAt > LOCK_TTL_MS) return false;
  return true;
}

function acquireLock(name: string): void {
  localStorage.setItem(lockKey(name), String(Date.now()));
}

function releaseLock(name: string): void {
  localStorage.removeItem(lockKey(name));
}

/**
 * Run `fn` while holding the named lock, waiting (bounded by
 * `LOCK_TTL_MS`) for any other tab currently holding it to finish
 * first. If the lock is still held by another tab once the wait times
 * out, `fn` is skipped entirely and this resolves to `undefined` --
 * the caller (the Sync Manager) simply tries again on its next trigger
 * rather than forcing its way in.
 */
export async function withCrossTabLock<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const deadline = Date.now() + LOCK_TTL_MS;
  while (isLockActive(name) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
  }
  if (isLockActive(name)) {
    return undefined;
  }

  acquireLock(name);
  try {
    return await fn();
  } finally {
    releaseLock(name);
  }
}
