/**
 * Data Layer Test Suite, part 2 (Phase 2, Section 20).
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => {
  const profile = { id: "user-1" };
  return {
    Auth: {
      getProfile: () => profile,
      subscribe: () => () => {},
    },
  };
});

import { ApiError } from "@/lib/api";
import { configureDataLayer } from "../context";
import { closeDatabase } from "../schema";
import {
  generateIdempotencyKey,
  getIdempotencyRecord,
  recordIdempotencyPending,
  recordIdempotencyResolved,
} from "../idempotency";
import { enqueueOperation } from "../queue";
import { classifyFailure, computeBackoffDelay } from "../retryPolicy";
import { classifyError } from "../errors";
import { cacheRecord, isNewerVersion, shouldApplyLiveEvent } from "../localCache";
import { withCrossTabLock } from "../tabLock";

beforeEach(async () => {
  closeDatabase();
  configureDataLayer("yinglima_test2");
  await import("../context").then((m) => m.wipeAllStores());
});

describe("Section 4: idempotency", () => {
  it("generates a unique key per call", () => {
    expect(generateIdempotencyKey()).not.toBe(generateIdempotencyKey());
  });

  it("enqueueing twice (simulated double-click) produces two distinct idempotency keys", async () => {
    const op1 = await enqueueOperation({
      appId: "yinglima",
      userId: "user-1",
      entityType: "buyer",
      operationType: "CREATE",
      method: "POST",
      path: "/buyers",
      payload: { name: "X" },
    });
    const op2 = await enqueueOperation({
      appId: "yinglima",
      userId: "user-1",
      entityType: "buyer",
      operationType: "CREATE",
      method: "POST",
      path: "/buyers",
      payload: { name: "X" },
    });
    expect(op1.idempotencyKey).not.toBe(op2.idempotencyKey);
  });

  it("records resolution outcome and preserves the original createdAt", async () => {
    const key = generateIdempotencyKey();
    await recordIdempotencyPending(key);
    const pending = await getIdempotencyRecord(key);
    await recordIdempotencyResolved(key, "SUCCEEDED", { id: "b1" });
    const resolved = await getIdempotencyRecord(key);
    expect(resolved?.outcome).toBe("SUCCEEDED");
    expect(resolved?.createdAt).toBe(pending?.createdAt);
    expect(resolved?.resolvedAt).toBeTruthy();
  });
});

describe("Section 8: retry policy classification", () => {
  it("classifies a network error (status 0) as TEMPORARY", () => {
    expect(classifyFailure(new ApiError("network down", 0, []))).toBe("TEMPORARY");
  });

  it("classifies 503 as TEMPORARY", () => {
    expect(classifyFailure(new ApiError("service unavailable", 503, []))).toBe("TEMPORARY");
  });

  it("classifies 422 validation error as PERMANENT", () => {
    expect(classifyFailure(new ApiError("invalid data", 422, []))).toBe("PERMANENT");
  });

  it("classifies 409 conflict as PERMANENT", () => {
    expect(classifyFailure(new ApiError("conflict", 409, []))).toBe("PERMANENT");
  });

  it("computes a bounded backoff delay that respects the cap", () => {
    const d0 = computeBackoffDelay(0);
    const d20 = computeBackoffDelay(20);
    expect(d0).toBeGreaterThan(0);
    expect(d20).toBeLessThanOrEqual(5 * 60 * 1000 * 1.21);
  });
});

describe("Section 15: error classification", () => {
  it("classifies a 401 as AUTH_SESSION / PERMANENT with a safe user message", () => {
    const classified = classifyError(new ApiError("Unauthorized", 401, []));
    expect(classified.category).toBe("AUTH_SESSION");
    expect(classified.classification).toBe("PERMANENT");
    expect(classified.userMessage).not.toContain("Unauthorized");
  });

  it("classifies a 500 as SERVER / TEMPORARY", () => {
    const classified = classifyError(new ApiError("Internal Server Error", 500, []));
    expect(classified.category).toBe("SERVER");
    expect(classified.classification).toBe("TEMPORARY");
  });

  it("never puts a raw JS error message into userMessage for an unknown error", () => {
    const classified = classifyError(new TypeError("Cannot read properties of undefined (reading 'foo')"));
    expect(classified.userMessage).not.toContain("Cannot read properties");
  });
});

describe("Section 9/10: local cache versioning", () => {
  it("caches and retrieves a record with its version", async () => {
    const cached = await cacheRecord({
      entity: "buyer",
      entityId: "b1",
      version: 7,
      data: { name: "X" },
      source: "SERVER_FETCH",
    });
    expect(cached.version).toBe(7);
  });

  it("recognizes a higher incoming version as newer, and rejects an equal/lower one", async () => {
    const cached = await cacheRecord({ entity: "buyer", entityId: "b1", version: 7, data: {}, source: "SERVER_FETCH" });
    expect(isNewerVersion(cached, 8)).toBe(true);
    expect(isNewerVersion(cached, 7)).toBe(false);
    expect(isNewerVersion(cached, 6)).toBe(false);
  });

  it("shouldApplyLiveEvent matches the same version-comparison rule", async () => {
    const cached = await cacheRecord({ entity: "buyer", entityId: "b1", version: 7, data: {}, source: "SERVER_FETCH" });
    expect(shouldApplyLiveEvent(cached, { entity: "buyer", entityId: "b1", version: 8 })).toBe(true);
    expect(shouldApplyLiveEvent(cached, { entity: "buyer", entityId: "b1", version: 7 })).toBe(false);
  });

  it("treats an unversioned entity's incoming data as always newer", () => {
    expect(isNewerVersion(undefined, null)).toBe(true);
  });
});

describe("Section 14: multi-tab coordination", () => {
  it("a second concurrent caller never runs while the lock is held by the first", async () => {
    const order: string[] = [];
    const first = withCrossTabLock("test-lock", async () => {
      order.push("first-start");
      await new Promise((r) => setTimeout(r, 50));
      order.push("first-end");
      return "first";
    });
    await new Promise((r) => setTimeout(r, 5));
    const secondPromise = withCrossTabLock("test-lock", async () => {
      order.push("second-ran");
      return "second";
    });

    await first;
    await secondPromise;
    expect(order.indexOf("second-ran") === -1 || order.indexOf("second-ran") > order.indexOf("first-end")).toBe(true);
  });
});
