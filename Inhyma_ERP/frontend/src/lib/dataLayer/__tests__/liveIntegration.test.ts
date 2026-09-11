/**
 * Inhyma Data Layer Test Suite: Live Realtime Integration (Phase 8C).
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => {
  const profile = { id: "inhyma-live-user" };
  return {
    Auth: {
      getProfile: () => profile,
      subscribe: () => () => {},
    },
  };
});

import { configureDataLayer, wipeAllStores } from "../context";
import { closeDatabase } from "../schema";
import { cacheRecord, getCachedRecord } from "../localCache";
import { handleLiveEventForCache } from "../liveIntegration";
import type { LiveEvent } from "@/lib/live/liveEvent";

beforeEach(async () => {
  closeDatabase();
  configureDataLayer("inhyma_live_test");
  await wipeAllStores();
});

describe("WebSocket Live Events & Data Layer Integration", () => {
  it("patches a cached record when a newer *.updated event arrives", async () => {
    await cacheRecord({
      entity: "buyer",
      entityId: "b100",
      version: 1,
      data: { id: "b100", company_name: "Original Name", country_id: "c1" },
      source: "SERVER_FETCH",
    });

    const liveEvent: LiveEvent = {
      event_id: "evt_1",
      event_type: "buyer.updated",
      entity: "buyer",
      entity_id: "b100",
      version: 2,
      timestamp: new Date().toISOString(),
      user_id: "user-1",
      changes: { company_name: "Updated Name via Live" },
    };

    const result = await handleLiveEventForCache(liveEvent);
    expect(result.action).toBe("UPDATED");

    const refreshed = await getCachedRecord<{ company_name: string; country_id: string }>("buyer", "b100");
    expect(refreshed?.version).toBe(2);
    expect(refreshed?.data.company_name).toBe("Updated Name via Live");
    expect(refreshed?.data.country_id).toBe("c1"); // Preserves unchanged fields
    expect(refreshed?.source).toBe("LIVE_EVENT");
  });

  it("evicts a cached record when a *.deleted event arrives", async () => {
    await cacheRecord({
      entity: "buyer",
      entityId: "b200",
      version: 1,
      data: { id: "b200", company_name: "To Be Deleted" },
      source: "SERVER_FETCH",
    });

    const liveEvent: LiveEvent = {
      event_id: "evt_2",
      event_type: "buyer.deleted",
      entity: "buyer",
      entity_id: "b200",
      version: 2,
      timestamp: new Date().toISOString(),
      user_id: "user-1",
      changes: {},
    };

    const result = await handleLiveEventForCache(liveEvent);
    expect(result.action).toBe("EVICTED");

    const refreshed = await getCachedRecord("buyer", "b200");
    expect(refreshed).toBeUndefined();
  });

  it("safely ignores stale events whose version is older than cached", async () => {
    await cacheRecord({
      entity: "buyer",
      entityId: "b300",
      version: 5,
      data: { id: "b300", company_name: "Version 5 Name" },
      source: "SERVER_FETCH",
    });

    const staleEvent: LiveEvent = {
      event_id: "evt_3",
      event_type: "buyer.updated",
      entity: "buyer",
      entity_id: "b300",
      version: 4, // Stale!
      timestamp: new Date().toISOString(),
      user_id: "user-1",
      changes: { company_name: "Stale Version 4 Name" },
    };

    const result = await handleLiveEventForCache(staleEvent);
    expect(result.action).toBe("IGNORED_STALE");

    const refreshed = await getCachedRecord<{ company_name: string }>("buyer", "b300");
    expect(refreshed?.version).toBe(5);
    expect(refreshed?.data.company_name).toBe("Version 5 Name");
  });

  it("deduplicates identical event IDs received multiple times", async () => {
    await cacheRecord({
      entity: "buyer",
      entityId: "b400",
      version: 1,
      data: { id: "b400", company_name: "Dedup Test" },
      source: "SERVER_FETCH",
    });

    const event: LiveEvent = {
      event_id: "evt_dedup_unique_id",
      event_type: "buyer.updated",
      entity: "buyer",
      entity_id: "b400",
      version: 2,
      timestamp: new Date().toISOString(),
      user_id: "user-1",
      changes: { company_name: "Dedup Name" },
    };

    const first = await handleLiveEventForCache(event);
    expect(first.action).toBe("UPDATED");

    const second = await handleLiveEventForCache(event);
    expect(second.action).toBe("IGNORED_DUPLICATE");
  });

  it("does not pollute cache if entity is not currently cached", async () => {
    const event: LiveEvent = {
      event_id: "evt_uncached",
      event_type: "buyer.updated",
      entity: "buyer",
      entity_id: "not_in_cache",
      version: 1,
      timestamp: new Date().toISOString(),
      user_id: "user-1",
      changes: { company_name: "Should Not Cache" },
    };

    const result = await handleLiveEventForCache(event);
    expect(result.action).toBe("IGNORED_NOT_CACHED");

    const cached = await getCachedRecord("buyer", "not_in_cache");
    expect(cached).toBeUndefined();
  });
});
