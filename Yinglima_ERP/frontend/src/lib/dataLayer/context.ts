/**
 * Data Layer Context & Session Boundary (Phase 2, Sections 12-13).
 *
 * Resolves "which IndexedDB database applies right now" from two
 * inputs -- an `erpKey` the host app configures once (Section 12: ERP
 * isolation) and the currently logged-in user's id from `lib/auth.ts`
 * (Section 13: user/session isolation) -- and reacts when either
 * changes.
 *
 * This is the ONE file in the module that imports `lib/auth.ts`.
 * Every other file (schema/db/queue/cache/sync/connectivity) only ever
 * receives a plain `dbName` string as a parameter and has no idea an
 * "Auth" module exists -- keeping the storage layer itself reusable by
 * a future app with a different auth system, per Section 2's own goal.
 */

import { Auth } from "@/lib/auth";
import { closeDatabase, getDatabaseName, STORES } from "./schema";
import { dbClearStore } from "./db";

let configuredErpKey: string | null = null;
let currentDbName: string | null = null;

type ContextListener = (dbName: string) => void;
const listeners = new Set<ContextListener>();

/**
 * Configure which ERP this tab belongs to. Call once at app startup
 * (e.g. `configureDataLayer("yinglima")`), before anything else in
 * `lib/dataLayer` is used.
 *
 * Deliberately a plain function call rather than an environment-driven
 * default, so a future ERP_Main "switch ERP" UI could reconfigure this
 * at runtime if a single tab ever needs to address more than one ERP's
 * local data (not required by this phase, but not precluded either).
 */
export function configureDataLayer(erpKey: string): void {
  configuredErpKey = erpKey;
  resolveContext();
}

function resolveContext(): void {
  if (!configuredErpKey) return;
  const profile = Auth.getProfile();
  const nextDbName = getDatabaseName(configuredErpKey, profile?.id ?? null);

  if (currentDbName !== null && currentDbName !== nextDbName) {
    // The user identity changed (login, logout, or a different user
    // logging in on the same browser) -- close the previous connection
    // immediately (Section 13) rather than leaving it open and racing
    // the next openDatabase() call for the new name.
    closeDatabase();
  }

  currentDbName = nextDbName;
  listeners.forEach((listener) => listener(nextDbName));
}

// React to every login/logout/profile change the existing Auth store
// already broadcasts (see lib/auth.ts's subscribe/notify pair) --
// reusing that signal rather than introducing a second "user changed"
// event source, per Section 18 ("reuse or extend, don't duplicate").
Auth.subscribe(() => resolveContext());

/**
 * The current database name. Every read/write in this module should
 * call this fresh rather than caching the value themselves, since it
 * can change out from under a long-lived reference across a
 * logout/login.
 */
export function getCurrentDbName(): string {
  if (!configuredErpKey) {
    throw new Error(
      "Data layer used before configureDataLayer() was called. Call configureDataLayer(erpKey) once at app startup."
    );
  }
  if (currentDbName === null) {
    resolveContext();
  }
  return currentDbName as string;
}

/** Subscribe to database-name changes (fires on login/logout). Returns an unsubscribe function. */
export function onContextChange(listener: ContextListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Explicitly wipe all locally-cached data for the CURRENT context
 * (Section 13: "Determine which data must be cleared immediately").
 *
 * Call this from the app's logout handler for data that must not
 * survive a logout even within the same database generation. This
 * phase leaves the exact retention policy (e.g. whether pending
 * operations should survive a logout, to be retried once the next
 * user logs in) to the host app -- see `queue.ts`/`localCache.ts` for
 * the per-store primitives to build a more selective policy with.
 */
export async function wipeAllStores(): Promise<void> {
  const dbName = getCurrentDbName();
  await Promise.all(Object.values(STORES).map((store) => dbClearStore(dbName, store)));
}
