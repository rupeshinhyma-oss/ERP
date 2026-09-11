/**
 * Promise-wrapped IndexedDB Transaction Helpers.
 *
 * Small, dependency-free wrappers around the native `IDBRequest`/
 * `IDBTransaction` callback API so every other file in this module can
 * `await` a read/write instead of hand-rolling `onsuccess`/`onerror`
 * every time.
 */

import { openDatabase, type StoreName } from "./schema";

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
  });
}

async function withStore<T>(
  dbName: string,
  storeName: StoreName,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  const db = await openDatabase(dbName);
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  const request = fn(store);
  const donePromise = transactionDone(tx);

  if (request) {
    const result = await requestToPromise(request);
    await donePromise;
    return result;
  }
  await donePromise;
  return undefined;
}

export async function dbGet<T>(dbName: string, storeName: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return withStore<T>(dbName, storeName, "readonly", (store) => store.get(key));
}

export async function dbPut<T>(dbName: string, storeName: StoreName, value: T): Promise<void> {
  await withStore(dbName, storeName, "readwrite", (store) => store.put(value));
}

export async function dbDelete(dbName: string, storeName: StoreName, key: IDBValidKey): Promise<void> {
  await withStore(dbName, storeName, "readwrite", (store) => store.delete(key));
}

export async function dbGetAll<T>(dbName: string, storeName: StoreName): Promise<T[]> {
  const result = await withStore<T[]>(dbName, storeName, "readonly", (store) => store.getAll());
  return result ?? [];
}

export async function dbGetAllByIndex<T>(
  dbName: string,
  storeName: StoreName,
  indexName: string,
  query: IDBValidKey | IDBKeyRange
): Promise<T[]> {
  const db = await openDatabase(dbName);
  const tx = db.transaction(storeName, "readonly");
  const index = tx.objectStore(storeName).index(indexName);
  const result = await requestToPromise(index.getAll(query));
  await transactionDone(tx);
  return result ?? [];
}

export async function dbCount(dbName: string, storeName: StoreName): Promise<number> {
  const result = await withStore<number>(dbName, storeName, "readonly", (store) => store.count());
  return result ?? 0;
}

/** Delete every record in a store. Used for logout cleanup and test resets. */
export async function dbClearStore(dbName: string, storeName: StoreName): Promise<void> {
  await withStore(dbName, storeName, "readwrite", (store) => store.clear());
}

/** Fetch, mutate, and re-save one record atomically within a single readwrite transaction. */
export async function dbUpdate<T>(
  dbName: string,
  storeName: StoreName,
  key: IDBValidKey,
  updater: (current: T | undefined) => T
): Promise<T> {
  const db = await openDatabase(dbName);
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  const current = await requestToPromise<T | undefined>(store.get(key));
  const next = updater(current);
  store.put(next);
  await transactionDone(tx);
  return next;
}
