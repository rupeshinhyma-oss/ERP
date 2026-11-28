import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { establishCentralEcosystemSession } from "@/lib/ecosystemSession";
import { ConfirmModal } from "@/components/ui";
import { HrmsRouteGuard } from "@/App";
import { auth } from "@/lib/auth";
import * as hooks from "@/lib/hooks";

describe("Inhyma Wave C & D Remediations (BUG-019, BUG-027, BUG-029)", () => {
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
      email: "direct@inhyma.com",
      source_erp: "inhyma",
      existing_session_id: "ihm-sess-local-123",
    });
    const res2 = await establishCentralEcosystemSession({
      email: "direct@inhyma.com",
      source_erp: "inhyma",
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
          session_id: "eco-central-999",
          user_id: "u1",
          email: "sso@inhyma.com",
          full_name: "SSO User",
          is_super_admin: false,
          memberships: [],
          active_erp: "inhyma",
          expires_at: "2099-01-01T00:00:00Z",
        },
      }),
    } as Response);

    const [a, b] = await Promise.all([
      establishCentralEcosystemSession({
        email: "sso@inhyma.com",
        source_erp: "inhyma",
        existing_session_id: "eco-central-999",
      }),
      establishCentralEcosystemSession({
        email: "sso@inhyma.com",
        source_erp: "inhyma",
        existing_session_id: "eco-central-999",
      }),
    ]);

    expect(a?.session_id).toBe("eco-central-999");
    expect(b?.session_id).toBe("eco-central-999");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("BUG-029: ConfirmModal renders accessible custom dialog without native confirm/alert", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const alertSpy = vi.spyOn(window, "alert");
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmModal
        open={true}
        title="Delete Item"
        message="Are you sure you want to delete this item?"
        confirmLabel="Delete"
        danger={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByTestId("erp-confirm-modal")).toBeTruthy();
    expect(screen.getByText("Delete Item")).toBeTruthy();
    expect(screen.getByText("Are you sure you want to delete this item?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("BUG-027: HrmsRouteGuard blocks unauthorized route mount with ZERO child API fetches", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.spyOn(auth, "isLoggedIn").mockReturnValue(true);
    vi.spyOn(hooks, "useAuth").mockReturnValue({
      profile: { id: "u1", username: "staff", full_name: "Staff" } as any,
      isSuperAdmin: false,
      permissions: new Set<string>(["dashboard.view"]),
      hasPermission: () => false,
    } as any);

    const childMounted = vi.fn();
    function RestrictedAuditPage() {
      childMounted();
      void fetch("/api/v1/audit");
      return <div>Secret Audit</div>;
    }

    render(
      <MemoryRouter initialEntries={["/audit"]}>
        <HrmsRouteGuard permission="audit.view">
          <RestrictedAuditPage />
        </HrmsRouteGuard>
      </MemoryRouter>
    );

    expect(childMounted).not.toHaveBeenCalled();
    const calledUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("/api/v1/audit"))).toBe(false);
    expect(screen.queryByText("Secret Audit")).toBeNull();
  });
});
