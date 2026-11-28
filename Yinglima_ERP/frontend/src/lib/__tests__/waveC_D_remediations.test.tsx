import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { establishCentralEcosystemSession } from "@/lib/ecosystemSession";
import { RouteGuard } from "@/App";
import { Auth } from "@/lib/auth";
import * as hooks from "@/lib/hooks";

describe("Yinglima Wave C & D Remediations (BUG-019, BUG-027)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("VITE_CENTRAL_AUTH_API", "http://127.0.0.1:8000/api/v1/global/ecosystem-session");
    window.localStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("BUG-019: direct-login local session makes ZERO POST /global/ecosystem-session/establish calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res1 = await establishCentralEcosystemSession({
      email: "direct@yinglima.com",
      source_erp: "yinglima",
      existing_session_id: "ylm-sess-local-123",
    });
    const res2 = await establishCentralEcosystemSession({
      email: "direct@yinglima.com",
      source_erp: "yinglima",
    });

    expect(res1).toBeNull();
    expect(res2).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("BUG-019: concurrent central-session establish calls are deduplicated to 1 request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          session_id: "eco-central-777",
          user_id: "u1",
          email: "sso@yinglima.com",
          full_name: "SSO User",
          is_super_admin: false,
          memberships: [],
          active_erp: "yinglima",
          expires_at: "2099-01-01T00:00:00Z",
        },
      }),
    } as Response);

    const [a, b] = await Promise.all([
      establishCentralEcosystemSession({
        email: "sso@yinglima.com",
        source_erp: "yinglima",
        existing_session_id: "eco-central-777",
      }),
      establishCentralEcosystemSession({
        email: "sso@yinglima.com",
        source_erp: "yinglima",
        existing_session_id: "eco-central-777",
      }),
    ]);

    expect(a?.session_id).toBe("eco-central-777");
    expect(b?.session_id).toBe("eco-central-777");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("BUG-027: RouteGuard blocks unauthorized finance/admin page mount with ZERO API fetches", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.spyOn(Auth, "isLoggedIn").mockReturnValue(true);
    vi.spyOn(hooks, "useAuth").mockReturnValue({
      profile: { id: "u1", username: "staff", full_name: "Staff" } as any,
      isSuperAdmin: false,
      permissions: new Set<string>(["dashboard.view"]),
      hasPermission: () => false,
    } as any);

    const childMounted = vi.fn();
    function RestrictedFinanceReport() {
      childMounted();
      void fetch("/api/v1/finance/report");
      return <div>Secret Finance</div>;
    }

    render(
      <MemoryRouter initialEntries={["/finance/report"]}>
        <RouteGuard permission="finance_report.view">
          <RestrictedFinanceReport />
        </RouteGuard>
      </MemoryRouter>
    );

    expect(childMounted).not.toHaveBeenCalled();
    const calledUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("/api/v1/finance/report"))).toBe(false);
    expect(screen.queryByText("Secret Finance")).toBeNull();
  });
});
