import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getCachedBrandName,
  setBrandName,
  invalidateBrandNameCache,
  resolveBrandName,
  subscribeBrandName,
} from "../brand";
import { ECOSYSTEM_ERPS } from "../ssoBridge";

describe("Dynamic Branding and Unique ERP ID Resolution", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    invalidateBrandNameCache();
    vi.restoreAllMocks();
  });

  it("defaults to generic ERP brand when cache is empty", () => {
    expect(getCachedBrandName()).toBe("ERP");
  });

  it("updates and notifies subscribers on brand name change", () => {
    const subscriber = vi.fn();
    const unsub = subscribeBrandName(subscriber);

    setBrandName("Acme Global Manufacturing");
    expect(getCachedBrandName()).toBe("Acme Global Manufacturing");
    expect(subscriber).toHaveBeenCalledWith("Acme Global Manufacturing");

    unsub();
  });

  it("resolves dynamic brand name from public unauthenticated organization endpoint", async () => {
    const mockPublicResponse = {
      data: {
        company_name: "Titan Dynamic Corp",
        legal_name: "Titan Dynamic Corporation Ltd",
        erp_id: "erp-01",
      },
    };

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockPublicResponse,
    } as Response);

    const resolved = await resolveBrandName();
    expect(resolved).toBe("Titan Dynamic Corp");
    expect(getCachedBrandName()).toBe("Titan Dynamic Corp");
    expect(localStorage.getItem("erp_org_company_name")).toBe("Titan Dynamic Corp");
  });

  it("assigns unique machine identifiers (erp-01 and erp-02) across ecosystem", () => {
    const erp01 = ECOSYSTEM_ERPS.find((e) => e.id === "erp-01");
    const erp02 = ECOSYSTEM_ERPS.find((e) => e.id === "erp-02");

    expect(erp01).toBeDefined();
    expect(erp01?.key).toBe("inhyma");
    expect(erp01?.apiUrl).toContain(":8002/api/v1");

    expect(erp02).toBeDefined();
    expect(erp02?.key).toBe("yinglima");
    expect(erp02?.apiUrl).toContain(":8001/api/v1");
  });
});
