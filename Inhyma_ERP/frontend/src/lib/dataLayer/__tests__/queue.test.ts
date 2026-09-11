/**
 * Inhyma Data Layer Test Suite: Queue & Storage (Phase 8C).
 *
 * Uses `fake-indexeddb` to provide a spec-compliant IndexedDB in Vitest/jsdom.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => {
  let profile: { id: string } | null = { id: "user-inhyma-1" };
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
import { dbGetAll } from "../db";
import {
  cancelOperation,
  enqueueOperation,
  getFailedOperations,
  getPendingCount,
  getSyncableOperations,
  markCompleted,
  markProcessing,
  markRetrying,
  moveToFailed,
} from "../queue";
import { cacheRecord, getCachedRecord } from "../localCache";

function setProfile(p: { id: string } | null): void {
  (Auth as unknown as { __setProfile: (p: { id: string } | null) => void }).__setProfile(p);
}

beforeEach(async () => {
  closeDatabase();
  setProfile({ id: "user-inhyma-1" });
  configureDataLayer("inhyma_test");
  await wipeAllStores();
});

describe("Inhyma schema.ts", () => {
  it("builds a distinct database name per ERP and per user", () => {
    const a = getDatabaseName("inhyma", "user-1");
    const b = getDatabaseName("inhyma", "user-2");
    const c = getDatabaseName("yinglima", "user-1");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
    expect(a).toBe("erp_data_layer:inhyma:user-1");
  });

  it("falls back to a stable anonymous namespace when no user is known", () => {
    expect(getDatabaseName("inhyma", null)).toBe(getDatabaseName("inhyma", undefined));
    expect(getDatabaseName("inhyma", null)).toContain("anonymous");
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

describe("ERP and user/session isolation", () => {
  it("does not mix cached data between Inhyma and another ERP", async () => {
    configureDataLayer("inhyma_test");
    await cacheRecord({ entity: "buyer", entityId: "b1", data: { name: "Inhyma Buyer" }, source: "SERVER_FETCH" });

    configureDataLayer("other_erp_test");
    const crossErpRead = await getCachedRecord("buyer", "b1");
    expect(crossErpRead).toBeUndefined();
  });

  it("does not leak one user's cached data to a different user on login", async () => {
    setProfile({ id: "inhyma_user_a" });
    configureDataLayer("inhyma_test");
    await cacheRecord({ entity: "buyer", entityId: "b1", data: { name: "User A Buyer" }, source: "SERVER_FETCH" });

    setProfile({ id: "inhyma_user_b" });
    await new Promise((r) => setTimeout(r, 0));

    const userBView = await getCachedRecord("buyer", "b1");
    expect(userBView).toBeUndefined();
  });

  it("wipeAllStores only clears the CURRENT context", async () => {
    configureDataLayer("inhyma_test");
    await cacheRecord({ entity: "buyer", entityId: "b1", data: {}, source: "SERVER_FETCH" });

    configureDataLayer("other_erp_test");
    await cacheRecord({ entity: "buyer", entityId: "b1", data: {}, source: "SERVER_FETCH" });
    await wipeAllStores();
    expect(await getCachedRecord("buyer", "b1")).toBeUndefined();

    configureDataLayer("inhyma_test");
    expect(await getCachedRecord("buyer", "b1")).toBeDefined();
  });
});

describe("Queue durability and state machine", () => {
  it("enqueues an operation in PENDING state with a unique idempotency key", async () => {
    const op = await enqueueOperation({
      appId: "inhyma",
      userId: "user-inhyma-1",
      entityType: "buyer",
      operationType: "UPDATE",
      method: "PATCH",
      path: "/buyers/b1",
      payload: { company_name: "Inhyma Updated" },
    });
    expect(op.status).toBe("PENDING");
    expect(op.idempotencyKey).toBeTruthy();
    expect(op.retryCount).toBe(0);
    expect(op.appId).toBe("inhyma");
  });

  it("survives a simulated browser reload without data loss", async () => {
    await enqueueOperation({
      appId: "inhyma",
      userId: "user-inhyma-1",
      entityType: "buyer",
      operationType: "CREATE",
      method: "POST",
      path: "/buyers",
      payload: { company_name: "Reload Test Buyer" },
    });

    // Simulate reload: close active connection
    closeDatabase();

    // Reopen
    const syncable = await getSyncableOperations();
    expect(syncable).toHaveLength(1);
    expect((syncable[0].payload as { company_name: string }).company_name).toBe("Reload Test Buyer");
  });

  it("transitions through PROCESSING -> COMPLETED and removes from syncable queue", async () => {
    const op = await enqueueOperation({
      appId: "inhyma",
      userId: "user-inhyma-1",
      entityType: "buyer",
      operationType: "CREATE",
      method: "POST",
      path: "/buyers",
      payload: {},
    });

    await markProcessing(op.operationId);
    let syncable = await getSyncableOperations();
    expect(syncable).toHaveLength(0); // PROCESSING operations are in-flight, not in syncable list

    await markCompleted(op.operationId);
    syncable = await getSyncableOperations();
    expect(syncable).toHaveLength(0);
  });

  it("schedules retries and increments retryCount", async () => {
    const op = await enqueueOperation({
      appId: "inhyma",
      userId: "user-inhyma-1",
      entityType: "buyer",
      operationType: "UPDATE",
      method: "PATCH",
      path: "/buyers/b1",
      payload: {},
    });

    const nextRetry = new Date(Date.now() + 5000).toISOString();
    const updated = await markRetrying(op.operationId, nextRetry, "temporary network drop");
    expect(updated.status).toBe("RETRYING");
    expect(updated.retryCount).toBe(1);
    expect(updated.lastError).toBe("temporary network drop");
  });

  it("moves failed operations to failed_operations store", async () => {
    const op = await enqueueOperation({
      appId: "inhyma",
      userId: "user-inhyma-1",
      entityType: "buyer",
      operationType: "CREATE",
      method: "POST",
      path: "/buyers",
      payload: {},
    });

    await moveToFailed(op.operationId, "Permanent 422 error");
    const syncable = await getSyncableOperations();
    expect(syncable).toHaveLength(0);

    const failed = await getFailedOperations();
    expect(failed).toHaveLength(1);
    expect(failed[0].lastError).toBe("Permanent 422 error");
  });

  it("allows cancelling pending operations but protects in-flight operations", async () => {
    const op = await enqueueOperation({
      appId: "inhyma",
      userId: "user-inhyma-1",
      entityType: "buyer",
      operationType: "CREATE",
      method: "POST",
      path: "/buyers",
      payload: {},
    });

    const cancelled = await cancelOperation(op.operationId);
    expect(cancelled).toBe(true);
    expect(await getPendingCount()).toBe(0);

    const op2 = await enqueueOperation({
      appId: "inhyma",
      userId: "user-inhyma-1",
      entityType: "buyer",
      operationType: "CREATE",
      method: "POST",
      path: "/buyers",
      payload: {},
    });
    await markProcessing(op2.operationId);
    const cancelInFlight = await cancelOperation(op2.operationId);
    expect(cancelInFlight).toBe(false);
  });
});
