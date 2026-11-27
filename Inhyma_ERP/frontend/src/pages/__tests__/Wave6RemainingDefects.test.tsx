import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { App } from "@/App";
import { LoginPage } from "@/pages/Login";
import { NAV_SECTIONS } from "@/lib/nav";
import * as apiModule from "@/lib/api";
import { auth } from "@/lib/auth";

vi.mock("@/lib/ssoBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ssoBridge")>();
  return {
    ...actual,
    processIncomingSsoHandover: vi.fn().mockResolvedValue("none"),
  };
});

vi.mock("@/lib/live/liveConnectionLifecycle", () => ({
  LiveConnectionLifecycle: () => null,
}));

describe("Wave 6 Remaining Defects (BUG-010, BUG-013, BUG-014, BUG-016, BUG-018)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("BUG-010 & BUG-016: LoginPage sets crossOrigin=anonymous on logo and submits Forgot Password via API instead of window.alert", async () => {
    vi.spyOn(apiModule, "apiGet").mockResolvedValue({
      data: { company_name: "Inhyma", logo_url: "/api/v1/organizations/logo?v=1234" },
    } as never);
    const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      data: {
        message: "If an account matches that username or email, an administrator has been notified to reset your password.",
      },
    } as never);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>
    );

    const logoImg = screen.getByAltText(/Logo/i) as HTMLImageElement;
    expect(logoImg.getAttribute("crossorigin")).toBe("anonymous");

    fireEvent.change(screen.getByLabelText(/Username, Email or Mobile Number/i), {
      target: { value: "synthetic.user@example.test" },
    });
    fireEvent.click(screen.getByText(/Forgot Password\?/i));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /Reset Password/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Send Reset Request/i }));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/auth/forgot-password", {
        identifier: "synthetic.user@example.test",
      });
      expect(screen.getByRole("status").textContent).toContain("administrator has been notified");
    });
  });

  it("BUG-018: Unauthenticated visits to all 11 previously unguarded routes fire 0 protected API calls before redirecting to /login", async () => {
    vi.spyOn(auth, "isLoggedIn").mockReturnValue(false);
    const apiGetSpy = vi.spyOn(apiModule, "apiGet").mockImplementation(async (path: string) => {
      if (path === "/organizations/public") {
        return { data: { company_name: "Inhyma", logo_url: null } } as never;
      }
      throw new Error(`Unexpected protected API call while unauthenticated: ${path}`);
    });

    const previouslyUnguardedRoutes = [
      "/proforma-invoice/list",
      "/technical-task/list",
      "/sales/process",
      "/tasks",
      "/companies",
      "/users",
      "/purchase/suppliers",
      "/rbac",
      "/organization",
      "/feed",
      "/product-stock/list",
    ];

    for (const route of previouslyUnguardedRoutes) {
      apiGetSpy.mockClear();
      const { unmount } = render(
        <MemoryRouter initialEntries={[route]}>
          <App />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: /Sign In/i })).toBeTruthy();
      });

      const protectedCalls = apiGetSpy.mock.calls
        .map((c) => c[0])
        .filter((url) => url !== "/organizations/public");
      expect(protectedCalls, `Route ${route} fired unexpected pre-redirect calls`).toEqual([]);
      unmount();
    }
  });

  it("BUG-014: Discount Payments nav item defines isolated discount_payment.* anyPermissions (separated from saleorder.* and report.view)", () => {
    const saleSection = NAV_SECTIONS.find((s) => s.label === "SALE");
    const discountNav = saleSection?.items.find((i) => i.key === "discount-payments");
    expect(discountNav?.anyPermissions).toContain("discount_payment.view");
    expect(discountNav?.anyPermissions).toContain("discount_payment.pending.view");
    expect(discountNav?.anyPermissions).toContain("discount_payment.completed.view");
    expect(discountNav?.anyPermissions).toContain("discount_payment.manage");
    expect(discountNav?.anyPermissions?.some((p) => p.startsWith("saleorder."))).toBe(false);
    expect(discountNav?.anyPermissions?.some((p) => p === "report.view")).toBe(false);
  });
});
