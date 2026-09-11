/**
 * Inhyma Data Layer Test Suite: Buyer Pilot (Phase 8C, Section 15).
 *
 * Validates the complete Buyer Pilot workflow:
 * - Online read -> cached in IndexedDB
 * - Offline mutation -> queued in IndexedDB
 * - Survives simulated browser restart
 * - Sync dispatch on reconnect
 * - Live event invalidation
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => {
  const profile = { id: "inhyma-pilot-user" };
  return {
    Auth: {
      getProfile: () => profile,
      subscribe: () => () => {},
    },
  };
});

const mockApiGet = vi.fn();
const mockApiCall = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: (...args: unknown[]) => mockApiGet(...args),
    apiCall: (...args: unknown[]) => mockApiCall(...args),
  };
});

import { configureDataLayer, wipeAllStores } from "../context";
import { closeDatabase } from "../schema";
import { getSyncableOperations } from "../queue";
import { getCachedRecord } from "../localCache";
import { connectivityManager } from "../connectivity";
import { syncManager } from "../sync";
import {
  getBuyerWithCache,
  createBuyerOfflineCapable,
  updateBuyerOfflineCapable,
} from "../buyerPilot";
import { handleLiveEventForCache } from "../liveIntegration";
import type { LiveEvent } from "@/lib/live/liveEvent";

beforeEach(async () => {
  closeDatabase();
  configureDataLayer("inhyma_buyer_pilot_test");
  await wipeAllStores();
  vi.clearAllMocks();
});

describe("Inhyma Buyer Pilot Integration", () => {
  it("performs cache-first read: fetches from API on first call, then reads from IndexedDB", async () => {
    const mockBuyer = {
      id: "buyer_abc",
      company_name: "Pilot Client Co",
      country_id: "country_1",
      version: 1,
    };
    mockApiGet.mockResolvedValueOnce({ data: mockBuyer });

    // First call: fetches from server
    const res1 = await getBuyerWithCache("buyer_abc");
    expect(res1.fromCache).toBe(false);
    expect(res1.buyer.company_name).toBe("Pilot Client Co");
    expect(mockApiGet).toHaveBeenCalledTimes(1);

    // Second call: served directly from IndexedDB without API call
    const res2 = await getBuyerWithCache("buyer_abc");
    expect(res2.fromCache).toBe(true);
    expect(res2.buyer.company_name).toBe("Pilot Client Co");
    expect(mockApiGet).toHaveBeenCalledTimes(1); // No new network call!
  });

  it("handles offline creation: enqueues operation and saves optimistic record in IndexedDB", async () => {
    // Simulate offline
    vi.spyOn(connectivityManager, "isReachable").mockReturnValue(false);

    const { buyer, operation } = await createBuyerOfflineCapable(
      { company_name: "Offline Created Buyer", country_id: "c_99" },
      "inhyma-pilot-user"
    );

    expect(buyer.company_name).toBe("Offline Created Buyer");
    expect(operation.status).toBe("PENDING");
    expect(operation.idempotencyKey).toBeTruthy();

    // Verify it is stored in IndexedDB pending_operations
    const syncable = await getSyncableOperations();
    expect(syncable).toHaveLength(1);
    expect(syncable[0].operationId).toBe(operation.operationId);

    // Verify optimistic record is stored in IndexedDB cached_records
    const cached = await getCachedRecord<{ company_name: string }>("buyer", buyer.id);
    expect(cached).toBeDefined();
    expect(cached?.data.company_name).toBe("Offline Created Buyer");
    expect(cached?.source).toBe("OPTIMISTIC_LOCAL");
  });

  it("handles offline update: enqueues update operation and updates optimistic record in IndexedDB", async () => {
    vi.spyOn(connectivityManager, "isReachable").mockReturnValue(false);

    const { buyer, operation } = await updateBuyerOfflineCapable(
      "buyer_123",
      { company_name: "Updated Offline Name" },
      "inhyma-pilot-user"
    );

    expect(buyer.company_name).toBe("Updated Offline Name");
    expect(operation.operationType).toBe("UPDATE");
    expect(operation.path).toBe("/buyers/buyer_123");

    const syncable = await getSyncableOperations();
    expect(syncable).toHaveLength(1);
    expect(syncable[0].operationId).toBe(operation.operationId);
  });

  it("persists offline queued operations across a browser reload", async () => {
    vi.spyOn(connectivityManager, "isReachable").mockReturnValue(false);

    await createBuyerOfflineCapable({ company_name: "Survive Reload Buyer" });

    // Simulate browser restart / tab close
    closeDatabase();

    // Reopen database connection
    const pendingAfterReload = await getSyncableOperations();
    expect(pendingAfterReload).toHaveLength(1);
    expect((pendingAfterReload[0].payload as { company_name: string }).company_name).toBe("Survive Reload Buyer");
  });

  it("drains queue and dispatches enqueued operation when connectivity recovers", async () => {
    vi.spyOn(connectivityManager, "isReachable").mockReturnValue(false);
    vi.spyOn(connectivityManager, "probeNow").mockResolvedValue(true);
    mockApiCall.mockResolvedValueOnce({ data: { status: "ok" } });

    const { operation } = await createBuyerOfflineCapable({ company_name: "Recover Sync Buyer" });

    let syncable = await getSyncableOperations();
    expect(syncable).toHaveLength(1);

    // Simulate online recovery
    await syncManager.triggerSync();

    // Verify API call was dispatched with Idempotency-Key
    expect(mockApiCall).toHaveBeenCalledTimes(1);
    expect(mockApiCall).toHaveBeenCalledWith(
      "/buyers",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Idempotency-Key": operation.idempotencyKey,
        }),
      })
    );

    // Queue is now empty
    syncable = await getSyncableOperations();
    expect(syncable).toHaveLength(0);
  });

  it("updates cached buyer when real-time live event arrives", async () => {
    mockApiGet.mockResolvedValueOnce({
      data: {
        id: "buyer_live_test",
        company_name: "Initial Buyer Name",
        country_id: "c_1",
        version: 1,
      },
    });

    // Populate cache
    await getBuyerWithCache("buyer_live_test");

    // Receive live event
    const liveUpdate: LiveEvent = {
      event_id: "evt_live_123",
      event_type: "buyer.updated",
      entity: "buyer",
      entity_id: "buyer_live_test",
      version: 2,
      timestamp: new Date().toISOString(),
      user_id: "user_remote",
      changes: { company_name: "Live Updated Buyer Name" },
    };

    await handleLiveEventForCache(liveUpdate);

    // Read cache
    const cached = await getCachedRecord<{ company_name: string }>("buyer", "buyer_live_test");
    expect(cached?.version).toBe(2);
    expect(cached?.data.company_name).toBe("Live Updated Buyer Name");
  });
});
