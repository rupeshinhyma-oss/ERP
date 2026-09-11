/**
 * IndexedDB Schema & Connection (Phase 2 / Phase 8C, Section 1).
 *
 * The single source of truth for Inhyma's IndexedDB structure. Every
 * other file in `lib/dataLayer/` opens the database through
 * `openDatabase()` here rather than calling `indexedDB.open` itself, so
 * there is exactly one place the schema version and store definitions
 * live.
 *
 * Namespaced per ERP ("inhyma") and per user (Section 13): the database
 * NAME itself embeds both, so Inhyma's data and another ERP's data
 * (and different users' data on a shared machine) physically cannot
 * collide.
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
 * `erpKey` is "inhyma".
 * `userId` is `Profile.id` from `lib/auth.ts` when known, or the
 * literal string `"anonymous"` before login.
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
 * Caches the open connection per database name for the lifetime of the tab.
 * Switching users/ERPs closes the previous connection and opens a fresh one.
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
 * Called on ERP switch or user logout/login so the next `openDatabase()`
 * call for a different name doesn't race against a stale connection.
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
}
