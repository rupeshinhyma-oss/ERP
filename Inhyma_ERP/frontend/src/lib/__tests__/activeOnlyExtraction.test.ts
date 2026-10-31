import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { invalidateLookupCache, isRecordActive, useLookup } from "../lookups";
import { clearProductCache, fetchMasterProducts, prefetchMasterProducts } from "../productSearchCache";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    apiGet: vi.fn(),
  };
});

describe("Active-Only Cross-Module Extraction Helpers", () => {
  const mockedApiGet = vi.mocked(api.apiGet);

  beforeEach(() => {
    mockedApiGet.mockReset();
    invalidateLookupCache();
    clearProductCache();
  });

  it("isRecordActive evaluates both status strings and is_active booleans accurately", () => {
    expect(isRecordActive({ id: "1", status: "ACTIVE" })).toBe(true);
    expect(isRecordActive({ id: "2", status: "active" })).toBe(true);
    expect(isRecordActive({ id: "3", is_active: true })).toBe(true);
    expect(isRecordActive({ id: "4", status: "INACTIVE" })).toBe(false);
    expect(isRecordActive({ id: "5", status: "inactive" })).toBe(false);
    expect(isRecordActive({ id: "6", is_active: false })).toBe(false);
  });

  it("useLookup excludes inactive records by default and preserves them when includeInactive=true", async () => {
    mockedApiGet.mockResolvedValue({
      data: [
        { id: "b-1", name: "Active Brand", status: "ACTIVE" },
        { id: "b-2", name: "Inactive Brand", status: "INACTIVE" },
        { id: "b-3", name: "Bool Inactive", is_active: false },
      ],
    } as any);

    const { result: activeOnly } = renderHook(() =>
      useLookup<{ id: string; name: string }>("/masters/brands", 250, false)
    );
    await waitFor(() => expect(activeOnly.current.loaded).toBe(true));
    expect(activeOnly.current.items.map((x) => x.id)).toEqual(["b-1"]);

    const { result: withInactive } = renderHook(() =>
      useLookup<{ id: string; name: string }>("/masters/brands", 250, true)
    );
    await waitFor(() => expect(withInactive.current.loaded).toBe(true));
    expect(withInactive.current.items.map((x) => x.id)).toEqual(["b-1", "b-2", "b-3"]);
  });

  it("prefetchMasterProducts and fetchMasterProducts filter out inactive products", async () => {
    mockedApiGet.mockResolvedValue({
      data: [
        { id: "p-1", product_name: "AFM-500", product_code: "PRD-001", status: "ACTIVE" },
        { id: "p-2", product_name: "LDM-99", product_code: "PRD-INACT-001", status: "INACTIVE" },
        { id: "p-3", product_name: "Legacy Disabled", product_code: "PRD-INACT-002", is_active: false },
      ],
    } as any);

    const prefetched = await prefetchMasterProducts();
    expect(prefetched.map((p) => p.product_name)).toEqual(["AFM-500"]);

    clearProductCache();
    const searched = await fetchMasterProducts("LDM");
    expect(searched.map((p) => p.product_name)).toEqual(["AFM-500"]);
  });
});
