import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DiscountPaymentsPage } from "../sales/DiscountPaymentsPage";
import { NAV_SECTIONS } from "@/lib/nav";
import { MODULE_NAMES, NAV_PERMISSION_SECTIONS, DEPRECATED_PERMISSION_CODES, friendlyPermissionLabel } from "@/lib/permissionLabels";
import { App } from "@/App";

const authState: { perms: string[]; isSuperAdmin: boolean } = {
  perms: ["discount_payment.view"],
  isSuperAdmin: false,
};

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    useAuth: () => ({
      isSuperAdmin: authState.isSuperAdmin,
      hasPermission: (p: string) => authState.isSuperAdmin || authState.perms.includes(p),
      hasAnyPermission: (...ps: string[]) =>
        authState.isSuperAdmin || ps.some((p) => authState.perms.includes(p)),
      profile: {
        id: "u-dp",
        username: "dp_tester",
        display_name: "DP Tester",
        full_name: "DP Tester",
        permissions: authState.isSuperAdmin ? ["*"] : authState.perms,
        is_super_admin: authState.isSuperAdmin,
      },
    }),
  };
});

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  const mockAuth = {
    ...actual.Auth,
    isAuthenticated: () => true,
    isLoggedIn: () => true,
    getProfile: () => ({
      id: "u-dp",
      username: "dp_tester",
      display_name: "DP Tester",
      full_name: "DP Tester",
      permissions: authState.isSuperAdmin ? ["*"] : authState.perms,
      is_super_admin: authState.isSuperAdmin,
    }),
    syncProfile: vi.fn().mockResolvedValue(null),
    subscribe: () => () => {},
  };
  return {
    ...actual,
    Auth: mockAuth,
    auth: mockAuth,
  };
});

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: null }),
  apiPatch: vi.fn().mockResolvedValue({ data: { success: true } }),
  setUnauthorizedHandler: vi.fn(),
  errorMessage: vi.fn((err: unknown) => String(err)),
}));

vi.mock("@/lib/toast", () => ({
  useToast: () => vi.fn(),
}));

describe("Discount Payments granular RBAC & Sales Process separation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.isSuperAdmin = false;
    authState.perms = ["discount_payment.view"];
  });

  afterEach(() => {
    cleanup();
  });

  it("completely separates Sales Process (saleorder.*) and Discount Payments (discount_payment.*) in nav and /rbac sections", () => {
    const saleSection = NAV_SECTIONS.find((s) => s.label === "SALE");
    const salesProcessNav = saleSection?.items.find((i) => i.key === "sales-process");
    const discountNav = saleSection?.items.find((i) => i.key === "discount-payments");

    expect(salesProcessNav?.anyPermissions?.some((p) => p.startsWith("discount_payment."))).toBe(false);
    expect(discountNav?.anyPermissions).toEqual([
      "discount_payment.view",
      "discount_payment.pending.view",
      "discount_payment.completed.view",
      "discount_payment.manage",
    ]);

    const rbacSaleSec = NAV_PERMISSION_SECTIONS.find((s) => s.id === "sale");
    expect(rbacSaleSec?.modules).toEqual(["proforma", "saleorder", "discount_payment"]);
    expect(MODULE_NAMES.inquiry).toBeUndefined();
    expect(DEPRECATED_PERMISSION_CODES.has("inquiry.view")).toBe(true);
    expect(DEPRECATED_PERMISSION_CODES.has("quotation.create")).toBe(true);
    expect(DEPRECATED_PERMISSION_CODES.has("discount_payment.action.view")).toBe(true);
    expect(MODULE_NAMES.discount_payment).toBe("Discount Payments");
    expect(friendlyPermissionLabel("discount_payment.pending.view")).toBe("View Pending");
    expect(friendlyPermissionLabel("discount_payment.completed.view")).toBe("View Completed");
    expect(friendlyPermissionLabel("discount_payment.adjust")).toBe("Action: Adjust Discount");
    expect(friendlyPermissionLabel("discount_payment.payments.view")).toBe("Action: List Payments");
  });

  it("redirects saleorder.view-only user to /403 when navigating to /discount-payments/list", async () => {
    authState.perms = ["saleorder.view"];
    render(
      <MemoryRouter initialEntries={["/discount-payments/list"]}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Access Restricted|403/i)).toBeTruthy();
    });
  });

  it("shows ONLY All tab without Pending/Completed tabs, Action column, or Order No PDF links when only discount_payment.view is granted", () => {
    authState.perms = ["discount_payment.view"];
    render(
      <MemoryRouter>
        <DiscountPaymentsPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: /^All/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Pending/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Completed/i })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Action" })).toBeNull();
    expect(screen.queryByTestId("action-btn-so-3826")).toBeNull();
    expect(screen.queryByTestId("order-no-btn-so-3826")).toBeNull();
    expect(screen.getByTestId("order-no-text-so-3826")).toBeTruthy();
  });

  it("restricts tabs when only single stage view permission is granted and auto-shows Action column when Adjust Discount / List Payments is granted", () => {
    authState.perms = ["discount_payment.completed.view"];
    const { rerender } = render(
      <MemoryRouter>
        <DiscountPaymentsPage />
      </MemoryRouter>
    );

    expect(screen.queryByRole("button", { name: /^All/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Pending/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^Completed/i })).toBeTruthy();
    expect(screen.getByText("SHREE GANESH ENTERPRISES")).toBeTruthy();
    expect(screen.queryByText("GARUDA ENGINEERS")).toBeNull();

    // Pending only
    authState.perms = ["discount_payment.pending.view"];
    rerender(
      <MemoryRouter>
        <DiscountPaymentsPage />
      </MemoryRouter>
    );
    expect(screen.queryByRole("button", { name: /^All/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^Pending/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Completed/i })).toBeNull();
    expect(screen.getByText("GARUDA ENGINEERS")).toBeTruthy();
    expect(screen.queryByText("SHREE GANESH ENTERPRISES")).toBeNull();

    // Grant view + payments.view (no adjust) -> Action column auto-shows with List Payments only
    authState.perms = ["discount_payment.view", "discount_payment.payments.view"];
    rerender(
      <MemoryRouter>
        <DiscountPaymentsPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("columnheader", { name: "Action" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("action-btn-so-3826"));
    expect(screen.getByRole("button", { name: /List Payments/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Adjust Discount/i })).toBeNull();

    // Grant view + adjust (no payments.view) -> Action column auto-shows with Adjust Discount only
    authState.perms = ["discount_payment.view", "discount_payment.adjust"];
    rerender(
      <MemoryRouter>
        <DiscountPaymentsPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /Adjust Discount/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /List Payments/i })).toBeNull();

    // Grant discount_payment.manage -> full access across All, Pending, Completed, Adjust, and List Payments
    authState.perms = ["discount_payment.manage"];
    rerender(
      <MemoryRouter>
        <DiscountPaymentsPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /^All/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Pending/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Completed/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Adjust Discount/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /List Payments/i })).toBeTruthy();
  });
});
