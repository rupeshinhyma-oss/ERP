/**
 * Data Layer Test Suite (Phase 2, Section 20).
 *
 * Uses `fake-indexeddb` (dev-only dependency) to give this Vitest/jsdom
 * environment a real, spec-compliant IndexedDB implementation -- jsdom
 * itself does not implement IndexedDB, and none existed to reuse.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => {
  let profile: { id: string } | null = { id: "user-1" };
  const listeners = new Set<(p: unknown) => void>();
  return {
    Auth: {
      getProfile: () => profile,
      subscribe: (fn: (p: unknown) => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      __setProfile: (next: { id: string } | null) => {
        profile = next;
        listeners.forEach((fn) => fn(profile));
      },
    },
  };
});

import { Auth } from "@/lib/auth";
import { configureDataLayer, getCurrentDbName, wipeAllStores } from "../context";
import { closeDatabase, getDatabaseName, SCHEMA_VERSION, STORES } from "../schema";
import { dbGet, dbGetAll } from "../db";
import {
  enqueueOperation,
  getFailedOperations,
  getPendingCount,
  getSyncableOperations,
  markCompleted,
  markRetrying,
  moveToFailed,
} from "../queue";
import { cacheRecord, getCachedRecord } from "../localCache";

function setProfile(p: { id: string } | null): void {
  (Auth as unknown as { __setProfile: (p: { id: string } | null) => void }).__setProfile(p);
}

beforeEach(async () => {
  closeDatabase();
  setProfile({ id: "user-1" });
  configureDataLayer("yinglima_test");
  // Section 20 test isolation: each test must start from an empty queue.
  // closeDatabase() only drops the connection, it does not clear data --
  // deliberately (a real page refresh must NOT wipe pending operations,
  // which is exactly what the "survives a simulated browser refresh"
  // test below verifies). Tests therefore clear explicitly instead.
  await wipeAllStores();
});

describe("schema.ts", () => {
  it("builds a distinct database name per ERP and per user", () => {
    const a = getDatabaseName("yinglima", "user-1");
    const b = getDatabaseName("yinglima", "user-2");
    const c = getDatabaseName("inhyma", "user-1");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it("falls back to a stable anonymous namespace when no user is known", () => {
    expect(getDatabaseName("yinglima", null)).toBe(getDatabaseName("yinglima", undefined));
    expect(getDatabaseName("yinglima", null)).toContain("anonymous");
  });

  it("creates every required object store on first open", async () => {
    const dbName = getCurrentDbName();
    await dbGetAll(dbName, STORES.CACHED_RECORDS);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, SCHEMA_VERSION);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const storeNames = Array.from(db.objectStoreNames);
    for (const expected of Object.values(STORES)) {
      expect(storeNames).toContain(expected);
    }
    db.close();
  });
});

describe("Section 12/13: ERP and user/session isolation", () => {
  it("does not mix cached data between two different ERPs", async () => {
    configureDataLayer("yinglima_test");
    await cacheRecord({ entity: "buyer", entityId: "b1", data: { name: "Yinglima Buyer" }, source: "SERVER_FETCH" });

    configureDataLayer("inhyma_test");
    const crossErpRead = await getCachedRecord("buyer", "b1");
    expect(crossErpRead).toBeUndefined();
  });

  it("does not leak one user's cached data to a different user on login", async () => {
    setProfile({ id: "alice" });
    configureDataLayer("yinglima_test");
    await cacheRecord({ entity: "buyer", entityId: "b1", data: { name: "Alice's buyer" }, source: "SERVER_FETCH" });

    setProfile({ id: "bob" });
    await new Promise((r) => setTimeout(r, 0));

    const bobsView = await getCachedRecord("buyer", "b1");
    expect(bobsView).toBeUndefined();
  });

  it("wipeAllStores only clears the CURRENT context, not other ERPs", async () => {
    configureDataLayer("yinglima_test");
    await cacheRecord({ entity: "buyer", entityId: "b1", data: {}, source: "SERVER_FETCH" });

    configureDataLayer("inhyma_test");
    await cacheRecord({ entity: "buyer", entityId: "b1", data: {}, source: "SERVER_FETCH" });
    await wipeAllStores();
    expect(await getCachedRecord("buyer", "b1")).toBeUndefined();

    configureDataLayer("yinglima_test");
    expect(await getCachedRecord("buyer", "b1")).toBeDefined();
  });
});

describe("Section 3/11: queue durability and state machine", () => {
  it("enqueues an operation in PENDING state with a unique idempotency key", async () => {
    const op = await enqueueOperation({
      appId: "yinglima",
      userId: "user-1",
      entityType: "buyer",
      operationType: "UPDATE",
      method: "PATCH",
      path: "/buyers/b1",
      payload: { name: "Updated" },
    });
    expect(op.status).toBe("PENDING");
    expect(op.idempotencyKey).toBeTruthy();
    expect(op.retryCount).toBe(0);
  });

  it("survives a simulated browser refresh", async () => {
    await enqueueOperation({
      appId: "yinglima",
      userId: "user-1",
      entityType: "buyer",
      operationType: "CREATE",
      method: "POST",
      path: "/buyers",
      payload: { name: "New Buyer" },
    });

    closeDatabase();
    configureDataLayer("yinglima_test");

    const pending = await getSyncableOperations();
    expect(pending.length).toBe(1);
    expect(pending[0].entityType).toBe("buyer");
  });

  it("moves a permanently-failed operation into failed_operations", async () => {
    const op = await enqueueOperation({
      appId: "yinglima",
      userId: "user-1",
      entityType: "buyer",
      operationType: "DELETE",
      method: "DELETE",
      path: "/buyers/b1",
      payload: null,
    });
    await moveToFailed(op.operationId, "Validation error.");

    const stillPending = await getSyncableOperations();
    expect(stillPending.find((o) => o.operationId === op.operationId)).toBeUndefined();

    const failed = await getFailedOperations();
    expect(failed.find((o) => o.operationId === op.operationId)).toBeDefined();
  });

  it("completing an operation removes it from the queue entirely", async () => {
    const op = await enqueueOperation({
      appId: "yinglima",
      userId: "user-1",
      entityType: "buyer",
      operationType: "UPDATE",
      method: "PATCH",
      path: "/buyers/b1",
      payload: {},
    });
    await markCompleted(op.operationId);
    expect(await getPendingCount()).toBe(0);
  });

  it("retrying increments retryCount and sets nextRetryAt in the future", async () => {
    const op = await enqueueOperation({
      appId: "yinglima",
      userId: "user-1",
      entityType: "buyer",
      operationType: "UPDATE",
      method: "PATCH",
      path: "/buyers/b1",
      payload: {},
    });
    const nextRetryAt = new Date(Date.now() + 5000).toISOString();
    const updated = await markRetrying(op.operationId, nextRetryAt, "network error");
    expect(updated.status).toBe("RETRYING");
    expect(updated.retryCount).toBe(1);
    expect(new Date(updated.nextRetryAt as string).getTime()).toBeGreaterThan(Date.now());
  });

  it("large queue: enqueuing 200 operations does not throw", async () => {
    for (let i = 0; i < 200; i++) {
      await enqueueOperation({
        appId: "yinglima",
        userId: "user-1",
        entityType: "buyer",
        entityId: `b${i}`,
        operationType: "UPDATE",
        method: "PATCH",
        path: `/buyers/b${i}`,
        payload: { i },
      });
    }
    expect(await getPendingCount()).toBe(200);
  });

  it("dbGet on a missing key resolves to undefined rather than throwing", async () => {
    const result = await dbGet(getCurrentDbName(), STORES.CACHED_RECORDS, "nonexistent:key");
    expect(result).toBeUndefined();
  });
});
