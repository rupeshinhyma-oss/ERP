/**
 * IndexedDB Schema & Connection (Phase 2, Section 1).
 *
 * The single source of truth for this ERP's IndexedDB structure. Every
 * other file in `lib/dataLayer/` opens the database through
 * `openDatabase()` here rather than calling `indexedDB.open` itself, so
 * there is exactly one place the schema version and store definitions
 * live -- adding a new store or index later means one `onupgradeneeded`
 * branch here, not a hunt through every consumer.
 *
 * No wrapper library (idb/Dexie/etc.) is used -- the native `indexedDB`
 * API is small enough for what this phase needs (a handful of stores,
 * simple key/index lookups), and the brief's own instruction is to avoid
 * unnecessary infrastructure. `openDatabase()` below is the one place
 * that promise-wraps the native callback API so nothing else in this
 * module has to.
 *
 * Namespaced per ERP (Section 12) and per user (Section 13): the
 * database NAME itself embeds both, so Yinglima's data and Inhyma's
 * data (and different users' data on a shared machine) physically
 * cannot collide -- there is no shared object store a bug could
 * accidentally cross-write between them. See `getDatabaseName()`.
 */

export const SCHEMA_VERSION = 1;

/** Logical store names (Section 1's required list). */
export const STORES = {
  CACHED_RECORDS: "cached_records",
  PENDING_OPERATIONS: "pending_operations",
  SYNC_METADATA: "sync_metadata",
  EVENT_CHECKPOINTS: "event_checkpoints",
  FAILED_OPERATIONS: "failed_operations",
  IDEMPOTENCY_RECORDS: "idempotency_records",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

/**
 * Build the IndexedDB database name for one ERP + one user.
 *
 * `erpKey` mirrors the backend's own `ERP_KEY` concept (Phase 2 of the
 * platform architecture: `yinglima`, `inhyma`, ...) -- passed in by the
 * caller rather than imported from a config module here, so this file
 * has zero dependency on how a given app happens to expose its own
 * identity (Section 2: this layer should stay reusable across apps).
 *
 * `userId` is `Profile.id` from `lib/auth.ts` when known, or the
 * literal string `"anonymous"` before login -- so pre-login caching
 * (e.g. public lookups) has a stable, harmless namespace instead of
 * `undefined` silently becoming part of a database name.
 *
 * A different user on the same browser gets a genuinely different
 * IndexedDB database, not just a different key within one database --
 * this is what makes Section 13's "do not leak one user's cached data
 * to another" a structural guarantee rather than a rule every reader
 * has to remember to respect.
 */
export function getDatabaseName(erpKey: string, userId: string | null | undefined): string {
  const safeUser = userId && userId.length > 0 ? userId : "anonymous";
  return `erp_data_layer:${erpKey}:${safeUser}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let openDbName: string | null = null;

/**
 * Open (creating/upgrading if necessary) the IndexedDB database for the given name.
 *
 * Caches the open connection per database name for the lifetime of the
 * tab -- IndexedDB connections are cheap to reuse and expensive to
 * reopen on every operation, and reopening repeatedly is exactly the
 * kind of unnecessary IndexedDB churn Section 21 warns against.
 * Switching users/ERPs (a different `name`) closes the previous
 * connection and opens a fresh one -- see `closeDatabase()`, called by
 * the session-boundary logic in `sessionBoundary.ts`.
 */
export function openDatabase(name: string): Promise<IDBDatabase> {
  if (dbPromise && openDbName === name) {
    return dbPromise;
  }
  if (dbPromise && openDbName !== name) {
    dbPromise = null;
  }

  openDbName = name;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, SCHEMA_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;
      applyMigrations(db, oldVersion);
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        if (openDbName === name) {
          dbPromise = null;
          openDbName = null;
        }
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      openDbName = null;
      reject(request.error ?? new Error(`Failed to open IndexedDB database "${name}".`));
    };

    request.onblocked = () => {
      console.warn(`IndexedDB open for "${name}" is blocked by another open connection/tab.`);
    };
  });

  return dbPromise;
}

/**
 * Close the currently-open database connection, if any.
 *
 * Called on ERP switch or user logout/login (Section 13) so the next
 * `openDatabase()` call for a different name doesn't race against a
 * stale connection, and so a browser holding a connection open doesn't
 * block a schema upgrade needed by the next session.
 */
export function closeDatabase(): void {
  if (dbPromise) {
    dbPromise.then((db) => db.close()).catch(() => {});
  }
  dbPromise = null;
  openDbName = null;
}

/**
 * Schema migrations, keyed by the version being upgraded FROM.
 *
 * Section 1: "The design must support future schema upgrades safely."
 * A fresh database has `oldVersion === 0`, so the `if (oldVersion < 1)`
 * branch below both creates the initial schema for a new user/ERP AND
 * is the template for every future bump -- add `if (oldVersion < 2) { ... }`
 * for the next version rather than rewriting this function, so a
 * browser upgrading from version 1 straight to version 3 (having missed
 * a release) still runs every intermediate migration in order.
 */
function applyMigrations(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    const cachedRecords = db.createObjectStore(STORES.CACHED_RECORDS, { keyPath: "cacheKey" });
    cachedRecords.createIndex("entity", "entity", { unique: false });

    const pendingOps = db.createObjectStore(STORES.PENDING_OPERATIONS, {
      keyPath: "operationId",
    });
    pendingOps.createIndex("status", "status", { unique: false });
    pendingOps.createIndex("nextRetryAt", "nextRetryAt", { unique: false });
    pendingOps.createIndex("idempotencyKey", "idempotencyKey", { unique: true });
    pendingOps.createIndex("createdAt", "createdAt", { unique: false });

    db.createObjectStore(STORES.SYNC_METADATA, { keyPath: "key" });

    db.createObjectStore(STORES.EVENT_CHECKPOINTS, { keyPath: "checkpointKey" });

    const failedOps = db.createObjectStore(STORES.FAILED_OPERATIONS, { keyPath: "operationId" });
    failedOps.createIndex("failedAt", "failedAt", { unique: false });

    const idempotency = db.createObjectStore(STORES.IDEMPOTENCY_RECORDS, { keyPath: "idempotencyKey" });
    idempotency.createIndex("createdAt", "createdAt", { unique: false });
  }

  // Future migrations:
  // if (oldVersion < 2) { ... }
}
