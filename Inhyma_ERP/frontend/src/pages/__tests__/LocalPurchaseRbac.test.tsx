import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LocalPurchasePage } from "../purchase/LocalPurchasePage";
import { NAV_SECTIONS } from "@/lib/nav";
import { MODULE_NAMES, NAV_PERMISSION_SECTIONS, friendlyPermissionLabel } from "@/lib/permissionLabels";
import { App } from "@/App";

const authState: { perms: string[]; isSuperAdmin: boolean } = {
  perms: ["localpurchase.view"],
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
        id: "u-lp",
        username: "lp_tester",
        display_name: "LP Tester",
        full_name: "LP Tester",
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
      id: "u-lp",
      username: "lp_tester",
      display_name: "LP Tester",
      full_name: "LP Tester",
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

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  const RULES = {
    pending: {
      label: "Pending",
      next: ["confirmed"],
      admin_only_to: [],
      perm_to: { confirmed: "localpurchase.confirm" },
      reason_required_to: [],
      edit: "perm:localpurchase.update",
      delete: "perm:localpurchase.delete",
      initial: true,
    },
    confirmed: {
      label: "Confirmed",
      next: [],
      edit: "none",
      delete: "admin",
      stock_in: true,
      action_label: "Confirm",
    },
  };
  const ORDERS = [
    {
      id: "lp-1",
      supplier_name: "Local Traders",
      warehouse: "Mumbai",
      invoice_no: "INV-LP-1",
      invoice_date: "19-11-2026",
      invoice_value_inc_gst: 11800,
      status: "pending",
      created_date: "19-11-2026",
      created_by: "Admin",
      bill_file_name: "bill1.pdf",
      items: [],
    },
    {
      id: "lp-2",
      supplier_name: "Darsh Impex",
      warehouse: "Mumbai",
      invoice_no: "INV-LP-2",
      invoice_date: "20-11-2026",
      invoice_value_inc_gst: 23600,
      status: "confirmed",
      stock_applied: true,
      created_date: "20-11-2026",
      created_by: "Admin",
      bill_file_name: "bill2.pdf",
      items: [],
    },
  ];
  return {
    ...actual,
    apiGet: vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith("/purchase/local-orders")) {
        return { data: { items: ORDERS, tab_counts: { all: { count: 2 }, pending: { count: 1 }, confirmed: { count: 1 } }, status_rules: RULES }, meta: { total: 2 } };
      }
      return { data: [] };
    }),
    apiPost: vi.fn().mockResolvedValue({ data: {} }),
    apiPut: vi.fn().mockResolvedValue({ data: {} }),
    apiPatch: vi.fn().mockResolvedValue({ data: {} }),
    apiDelete: vi.fn().mockResolvedValue({ data: { deleted: true } }),
    setUnauthorizedHandler: vi.fn(),
    errorMessage: vi.fn((err: unknown) => String(err)),
  };
});

vi.mock("@/lib/toast", () => ({
  useToast: () => vi.fn(),
}));

describe("Local Purchase 10-permission RBAC & Import Purchase isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.isSuperAdmin = false;
    authState.perms = ["localpurchase.view"];
  });

  afterEach(() => {
    cleanup();
  });

  it("wires localpurchase nav, /rbac labels, and separation from Import Purchase (purchase.*)", () => {
    const purchaseSection = NAV_SECTIONS.find((s) => s.label === "PURCHASE");
    const localNav = purchaseSection?.items.find((i) => i.key === "local-purchases");
    expect(localNav?.anyPermissions).toEqual(["localpurchase.view", "localpurchase.manage"]);
    expect(localNav?.permission).toBeUndefined();

    const rbacPurchaseSec = NAV_PERMISSION_SECTIONS.find((s) => s.id === "purchase");
    expect(rbacPurchaseSec?.modules).toEqual(["localpurchase", "purchase", "supplier"]);
    expect(MODULE_NAMES.localpurchase).toBe("Local Purchase");

    expect(friendlyPermissionLabel("localpurchase.view")).toBe("View");
    expect(friendlyPermissionLabel("localpurchase.create")).toBe("+ Add New (Create)");
    expect(friendlyPermissionLabel("localpurchase.import")).toBe("Import (Sample + Import)");
    expect(friendlyPermissionLabel("localpurchase.export")).toBe("Export");
    expect(friendlyPermissionLabel("localpurchase.bulk_action")).toBe("Bulk Actions");
    expect(friendlyPermissionLabel("localpurchase.download")).toBe("Action: Download Purchase");
    expect(friendlyPermissionLabel("localpurchase.update")).toBe("Action: Edit");
    expect(friendlyPermissionLabel("localpurchase.confirm")).toBe("Action: Confirm (Add Stock)");
    expect(friendlyPermissionLabel("localpurchase.delete")).toBe("Action: Delete");
    expect(friendlyPermissionLabel("localpurchase.manage")).toBe("Manage All");
  });

  it("redirects purchase.view-only user to /403 when navigating to /purchase/localpurchase", async () => {
    authState.perms = ["purchase.view"];
    render(
      <MemoryRouter initialEntries={["/purchase/localpurchase"]}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText(/Access Restricted|403/i)).toBeTruthy();
    });
  });

  it("redirects localpurchase.view-only user to /403 for add/edit/download routes", async () => {
    authState.perms = ["localpurchase.view"];
    const { unmount } = render(
      <MemoryRouter initialEntries={["/purchase/localpurchase/add"]}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText(/Access Restricted|403/i)).toBeTruthy());
    unmount();

    render(
      <MemoryRouter initialEntries={["/purchase-order/bill-file/lp-2"]}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText(/Access Restricted|403/i)).toBeTruthy());
  });

  it("enforces all 10 permissions independently on LocalPurchasePage", async () => {
    // 1. View only -> read-only table, no header actions, no checkboxes, no Action column, no clickable Bill File PDF
    authState.perms = ["localpurchase.view"];
    const { rerender } = render(
      <MemoryRouter>
        <LocalPurchasePage />
      </MemoryRouter>
    );
    await screen.findByText("INV-LP-1");

    expect(screen.queryByTestId("btn-add-new")).toBeNull();
    expect(screen.queryByRole("button", { name: /imp \/ exp|import|export/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /bulk actions/i })).toBeNull();
    expect(screen.queryByLabelText("Select all orders")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Action" })).toBeNull();

    fireEvent.click(screen.getByText("INV-LP-1"));
    expect(screen.queryByTestId("btn-bill-file-pdf")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // 2. Import only vs Export only
    authState.perms = ["localpurchase.view", "localpurchase.import"];
    rerender(<MemoryRouter><LocalPurchasePage /></MemoryRouter>);
    const importBtn = screen.getByRole("button", { name: /^Import$/i });
    fireEvent.click(importBtn);
    const impMenu = screen.getByRole("menu");
    expect(within(impMenu).getByText("SAMPLE FILE")).toBeTruthy();
    expect(within(impMenu).getByText("IMPORT")).toBeTruthy();
    expect(within(impMenu).queryByText("EXPORT")).toBeNull();
    fireEvent.click(importBtn); // close dropdown before switching permissions

    authState.perms = ["localpurchase.view", "localpurchase.export"];
    rerender(<MemoryRouter><LocalPurchasePage /></MemoryRouter>);
    const exportBtn = screen.getByRole("button", { name: /^Export$/i });
    fireEvent.click(exportBtn);
    const expMenu = screen.getByRole("menu");
    expect(within(expMenu).getByText("EXPORT")).toBeTruthy();
    expect(within(expMenu).queryByText("IMPORT")).toBeNull();
    fireEvent.click(exportBtn);

    // 3. Create + Bulk Actions + Delete (no Edit/Confirm/Download)
    authState.perms = ["localpurchase.view", "localpurchase.create", "localpurchase.bulk_action", "localpurchase.delete"];
    rerender(<MemoryRouter><LocalPurchasePage /></MemoryRouter>);
    expect(screen.getByTestId("btn-add-new")).toBeTruthy();
    expect(screen.getByLabelText("Select all orders")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Select order INV-LP-1"));
    fireEvent.click(screen.getByRole("button", { name: /Bulk Actions \(1\)/i }));
    const bulkMenu = screen.getByTestId("bulk-actions-menu");
    expect(within(bulkMenu).getByText("Delete Selected")).toBeTruthy();
    expect(within(bulkMenu).queryByText("Confirm Selected")).toBeNull();

    fireEvent.click(screen.getByTestId("btn-action-lp-1"));
    expect(screen.getByTestId("action-delete-lp-1")).toBeTruthy();
    expect(screen.queryByTestId("action-edit-lp-1")).toBeNull();
    expect(screen.queryByTestId("action-confirm-lp-1")).toBeNull();

    // 4. Download Purchase only
    authState.perms = ["localpurchase.view", "localpurchase.download"];
    rerender(<MemoryRouter><LocalPurchasePage /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("btn-action-lp-2"));
    expect(screen.getByTestId("action-download-lp-2")).toBeTruthy();
    fireEvent.click(screen.getByText("INV-LP-2"));
    expect(screen.getByTestId("btn-bill-file-pdf")).toBeTruthy();
  });
});
