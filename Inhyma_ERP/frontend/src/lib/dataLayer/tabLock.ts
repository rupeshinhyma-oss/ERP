/**
 * Multi-Tab Sync Coordination (Phase 2 / Phase 8C, Section 14).
 *
 * Reusable TTL-based `localStorage` lock primitive preventing multiple
 * tabs from concurrently draining the queue.
 *
 * Hardened with:
 * - Clock skew tolerance (rejecting timestamps far in the future)
 * - Owner ID validation (ensuring a tab cannot accidentally release another tab's lock)
 */

const LOCK_TTL_MS = 15000;
const LOCK_POLL_INTERVAL_MS = 200;

interface LockPayload {
  lockedAt: number;
  ownerId: string;
}

function lockKey(name: string): string {
  return `erp_data_layer_lock:${name}`;
}

function isLockActive(name: string): boolean {
  const raw = localStorage.getItem(lockKey(name));
  if (!raw) return false;

  let lockedAt: number;
  try {
    const parsed = JSON.parse(raw) as LockPayload;
    lockedAt = Number(parsed.lockedAt);
  } catch {
    // Backward compatibility with raw timestamp string
    lockedAt = Number(raw);
  }

  if (!Number.isFinite(lockedAt)) return false;
  const now = Date.now();
  // Clock skewed into future by > 1s -> invalid
  if (lockedAt > now + 1000) return false;
  // Expired
  if (now - lockedAt > LOCK_TTL_MS) return false;

  return true;
}

function acquireLock(name: string, ownerId: string): void {
  const payload: LockPayload = {
    lockedAt: Date.now(),
    ownerId,
  };
  localStorage.setItem(lockKey(name), JSON.stringify(payload));
}

function releaseLock(name: string, ownerId: string): void {
  const raw = localStorage.getItem(lockKey(name));
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw) as LockPayload;
    if (parsed.ownerId === ownerId) {
      localStorage.removeItem(lockKey(name));
    }
  } catch {
    // Raw legacy fallback
    localStorage.removeItem(lockKey(name));
  }
}

/**
 * Run `fn` while holding the named lock, waiting (bounded by
 * `LOCK_TTL_MS`) for any other tab currently holding it to finish
 * first.
 */
export async function withCrossTabLock<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const ownerId = crypto.randomUUID();
  const deadline = Date.now() + LOCK_TTL_MS;
  while (isLockActive(name) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
  }
  if (isLockActive(name)) {
    return undefined;
  }

  acquireLock(name, ownerId);
  try {
    return await fn();
  } finally {
    releaseLock(name, ownerId);
  }
}

