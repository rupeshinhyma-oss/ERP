/**
 * Inhyma Data Layer Test Suite: Idempotency, Retry, Errors, TabLock (Phase 8C).
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => {
  const profile = { id: "inhyma-user-1" };
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
  configureDataLayer("inhyma_misc_test");
  await import("../context").then((m) => m.wipeAllStores());
});

describe("Idempotency Foundation", () => {
  it("generates a unique key per call", () => {
    expect(generateIdempotencyKey()).not.toBe(generateIdempotencyKey());
  });

  it("enqueueing twice generates distinct idempotency keys", async () => {
    const op1 = await enqueueOperation({
      appId: "inhyma",
      userId: "inhyma-user-1",
      entityType: "buyer",
      operationType: "CREATE",
      method: "POST",
      path: "/buyers",
      payload: { company_name: "Buyer 1" },
    });
    const op2 = await enqueueOperation({
      appId: "inhyma",
      userId: "inhyma-user-1",
      entityType: "buyer",
      operationType: "CREATE",
      method: "POST",
      path: "/buyers",
      payload: { company_name: "Buyer 1" },
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

describe("Retry Policy & Backoff", () => {
  it("classifies network error as TEMPORARY", () => {
    expect(classifyFailure(new ApiError("Network failure", 0, []))).toBe("TEMPORARY");
  });

  it("classifies 500, 502, 503, 504, 429 as TEMPORARY", () => {
    expect(classifyFailure(new ApiError("500", 500, []))).toBe("TEMPORARY");
    expect(classifyFailure(new ApiError("502", 502, []))).toBe("TEMPORARY");
    expect(classifyFailure(new ApiError("503", 503, []))).toBe("TEMPORARY");
    expect(classifyFailure(new ApiError("504", 504, []))).toBe("TEMPORARY");
    expect(classifyFailure(new ApiError("429", 429, []))).toBe("TEMPORARY");
  });

  it("classifies 400, 401, 403, 404, 409, 422 as PERMANENT", () => {
    expect(classifyFailure(new ApiError("400", 400, []))).toBe("PERMANENT");
    expect(classifyFailure(new ApiError("401", 401, []))).toBe("PERMANENT");
    expect(classifyFailure(new ApiError("403", 403, []))).toBe("PERMANENT");
    expect(classifyFailure(new ApiError("404", 404, []))).toBe("PERMANENT");
    expect(classifyFailure(new ApiError("409", 409, []))).toBe("PERMANENT");
    expect(classifyFailure(new ApiError("422", 422, []))).toBe("PERMANENT");
  });

  it("computes exponential backoff bounded by max delay", () => {
    const delay0 = computeBackoffDelay(0);
    const delay5 = computeBackoffDelay(5);
    const delay20 = computeBackoffDelay(20);
    expect(delay0).toBeGreaterThanOrEqual(1600); // 2000 - 20%
    expect(delay5).toBeGreaterThan(delay0);
    expect(delay20).toBeLessThanOrEqual(5 * 60 * 1000 * 1.25);
  });
});

describe("Error Classification", () => {
  it("produces safe user message for 401 session expiry", () => {
    const err = classifyError(new ApiError("Token expired", 401, []));
    expect(err.category).toBe("AUTH_SESSION");
    expect(err.classification).toBe("PERMANENT");
    expect(err.userMessage).toContain("session has expired");
  });

  it("produces friendly message for 500 server error", () => {
    const err = classifyError(new ApiError("Internal error", 500, []));
    expect(err.category).toBe("SERVER");
    expect(err.classification).toBe("TEMPORARY");
    expect(err.userMessage).toContain("retried automatically");
  });

  it("never exposes internal JS runtime stack traces in userMessage", () => {
    const err = classifyError(new TypeError("Cannot read properties of null"));
    expect(err.userMessage).not.toContain("Cannot read properties");
  });
});

describe("Local Cache Versioning", () => {
  it("caches and retrieves entity record", async () => {
    const record = await cacheRecord({
      entity: "buyer",
      entityId: "buyer_123",
      version: 3,
      data: { company_name: "Inhyma Test Co" },
      source: "SERVER_FETCH",
    });
    expect(record.version).toBe(3);
    expect(record.cacheKey).toBe("buyer:buyer_123");
  });

  it("enforces version ordering: newer versions accept, equal or older reject", async () => {
    const record = await cacheRecord({
      entity: "buyer",
      entityId: "buyer_123",
      version: 5,
      data: {},
      source: "SERVER_FETCH",
    });
    expect(isNewerVersion(record, 6)).toBe(true);
    expect(isNewerVersion(record, 5)).toBe(false);
    expect(isNewerVersion(record, 4)).toBe(false);
  });

  it("shouldApplyLiveEvent respects version check", async () => {
    const record = await cacheRecord({
      entity: "buyer",
      entityId: "buyer_123",
      version: 5,
      data: {},
      source: "SERVER_FETCH",
    });
    expect(shouldApplyLiveEvent(record, { entity: "buyer", entityId: "buyer_123", version: 6 })).toBe(true);
    expect(shouldApplyLiveEvent(record, { entity: "buyer", entityId: "buyer_123", version: 5 })).toBe(false);
  });
});

describe("Cross-Tab Lock", () => {
  it("acquires and releases cross-tab lock cleanly", async () => {
    let executed = false;
    await withCrossTabLock("test_lock", async () => {
      executed = true;
    });
    expect(executed).toBe(true);
  });
});
