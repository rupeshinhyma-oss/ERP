/**
 * Data Layer Context & Session Boundary (Phase 2 / Phase 8C, Sections 12-13).
 *
 * Resolves "which IndexedDB database applies right now" from two
 * inputs -- an `erpKey` the host app configures once (Section 12: ERP
 * isolation) and the currently logged-in user's id from `lib/auth.ts`
 * (Section 13: user/session isolation) -- and reacts when either
 * changes.
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
 * (e.g. `configureDataLayer("inhyma")`), before anything else in
 * `lib/dataLayer` is used.
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
    // immediately rather than leaving it open and racing the next
    // openDatabase() call for the new name.
    closeDatabase();
  }

  currentDbName = nextDbName;
  listeners.forEach((listener) => listener(nextDbName));
}

// React to every login/logout/profile change the existing Auth store
// broadcasts.
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
 */
export async function wipeAllStores(): Promise<void> {
  const dbName = getCurrentDbName();
  await Promise.all(Object.values(STORES).map((store) => dbClearStore(dbName, store)));
}
