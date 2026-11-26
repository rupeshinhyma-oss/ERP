import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaleProcessListPage } from "../sales/SaleProcessList";
import * as api from "@/lib/api";
import { NAV_SECTIONS } from "@/lib/nav";
import { friendlyPermissionLabel } from "@/lib/permissionLabels";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

const authState = {
  perms: [] as string[],
};

const stableProfile = {
  id: "u-sales",
  username: "sales_user",
  display_name: "Sales User",
  full_name: "Sales User",
};

vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    useAuth: () => ({
      hasPermission: (code?: string | null) =>
        !code || authState.perms.includes("*") || authState.perms.includes(code),
      isSuperAdmin: false,
      profile: stableProfile,
    }),
  };
});

const SAMPLE_ORDERS = [
  {
    id: "so-pending",
    order_no: "SO-MH/26-27/00001",
    order_date: "2026-10-26",
    warehouse: "Mumbai",
    company_name: "Alpha Corp",
    city: "Mumbai",
    state: "Maharashtra",
    sales_person: "Sales User",
    amount_inc_gst: 10000,
    total_amount: 10000,
    discount: 0,
    status: "pending",
    items: [],
  },
  {
    id: "so-lr",
    order_no: "SO-MH/26-27/00002",
    order_date: "2026-10-27",
    warehouse: "Mumbai",
    company_name: "Beta Ltd",
    city: "Pune",
    state: "Maharashtra",
    sales_person: "Sales User",
    amount_inc_gst: 20000,
    total_amount: 20000,
    discount: 0,
    status: "lr",
    gatepass_no: "GP-26-27/0001",
    gatepass_date: "27-10-2026",
    items: [],
  },
];

describe("Sales Process granular RBAC permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.perms = [];
    sessionStorage.clear();
    vi.spyOn(api, "apiGet").mockImplementation(async (url: string) => {
      if (url.startsWith("/sales/orders")) {
        return {
          data: {
            items: SAMPLE_ORDERS,
            total: SAMPLE_ORDERS.length,
            metrics: {
              all: { count: 2, amount: 30000 },
              admin_confirmed_to_lr: { count: 1, amount: 20000 },
              pending: { count: 1, amount: 10000 },
              sales_confirmed: { count: 0, amount: 0 },
              admin_approved: { count: 0, amount: 0 },
              acc_confirmed: { count: 0, amount: 0 },
              gatepass_created: { count: 0, amount: 0 },
              dispatched: { count: 0, amount: 0 },
              gatepass_cancelled: { count: 0, amount: 0 },
              lr: { count: 1, amount: 20000 },
              cancelled: { count: 0, amount: 0 },
            },
          },
        } as any;
      }
      return { data: [] } as any;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("exposes friendly labels for all 25 Sales Process permissions and nav metadata", () => {
    expect(friendlyPermissionLabel("saleorder.view")).toBe("View");
    expect(friendlyPermissionLabel("saleorder.pending.view")).toBe("View Pending Stage");
    expect(friendlyPermissionLabel("saleorder.sales_confirmed.view")).toBe("View Sales Confirmed Stage");
    expect(friendlyPermissionLabel("saleorder.admin_approved.view")).toBe("View Admin Approved Stage");
    expect(friendlyPermissionLabel("saleorder.acc_confirmed.view")).toBe("View Acc. Confirmed Stage");
    expect(friendlyPermissionLabel("saleorder.gatepass_created.view")).toBe("View Gatepass Created Stage");
    expect(friendlyPermissionLabel("saleorder.dispatched.view")).toBe("View Dispatched Stage");
    expect(friendlyPermissionLabel("saleorder.gatepass_cancelled.view")).toBe("View Gatepass Cancelled Stage");
    expect(friendlyPermissionLabel("saleorder.lr.view")).toBe("View LR Stage");
    expect(friendlyPermissionLabel("saleorder.cancelled.view")).toBe("View Cancelled Stage");
    expect(friendlyPermissionLabel("saleorder.create")).toBe("+ Add New (Create)");
    expect(friendlyPermissionLabel("saleorder.export")).toBe("Export");
    expect(friendlyPermissionLabel("saleorder.details.view")).toBe("Action: View Details");
    expect(friendlyPermissionLabel("saleorder.action.view")).toBe("View Action Column (⋮)");
    expect(friendlyPermissionLabel("saleorder.update")).toBe("Action: Edit");
    expect(friendlyPermissionLabel("saleorder.duplicate")).toBe("Action: Duplicate");
    expect(friendlyPermissionLabel("saleorder.download")).toBe("Action: Download Gatepass / PDF");
    expect(friendlyPermissionLabel("saleorder.files")).toBe("Action: SO Files");
    expect(friendlyPermissionLabel("saleorder.confirm")).toBe("Stage: Sales Confirmed (Confirm)");
    expect(friendlyPermissionLabel("saleorder.approve")).toBe("Stage: Admin Approved (Approve)");
    expect(friendlyPermissionLabel("saleorder.accounts")).toBe("Stage: Acc. Confirmed (Accounts)");
    expect(friendlyPermissionLabel("saleorder.warehouse")).toBe("Stage: Gatepass / Dispatch / LR (Warehouse)");
    expect(friendlyPermissionLabel("saleorder.cancel")).toBe("Action: Cancel");
    expect(friendlyPermissionLabel("saleorder.delete")).toBe("Action: Delete");
    expect(friendlyPermissionLabel("saleorder.manage")).toBe("Manage All");

    const saleNav = NAV_SECTIONS.find((s) => s.label === "SALE")?.items.find((i) => i.key === "sales-process");
    expect(saleNav?.anyPermissions).toContain("saleorder.view");
    expect(saleNav?.anyPermissions).toContain("saleorder.pending.view");
    expect(saleNav?.anyPermissions).toContain("saleorder.manage");
  });

  it("renders read-only list when only saleorder.view is granted", async () => {
    authState.perms = ["saleorder.view"];

    render(
      <MemoryRouter>
        <SaleProcessListPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("SO-MH/26-27/00001")).toBeTruthy());

    expect(screen.queryByRole("link", { name: /\+ ADD NEW/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Export$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^All \(2\)$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Pending \(/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^LR \(/i })).toBeNull();
    expect(screen.queryByText("Action")).toBeNull();
    expect(screen.queryAllByRole("button", { name: "⋮" }).length).toBe(0);
    expect(screen.queryByRole("button", { name: "Update Status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "SO-MH/26-27/00001" })).toBeNull();
    expect(screen.queryByRole("link", { name: /GP-26-27\/0001/i })).toBeNull();
  });

  it("limits stage tabs, KPI cards, and rows when only specific stage view perms are granted", async () => {
    authState.perms = ["saleorder.pending.view"];

    render(
      <MemoryRouter>
        <SaleProcessListPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("SO-MH/26-27/00001")).toBeTruthy());

    expect(screen.queryByText("SO-MH/26-27/00002")).toBeNull();
    expect(screen.queryByRole("button", { name: /^All \(/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^Pending \(1\)$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^LR \(/i })).toBeNull();
  });

  it("shows only permitted Action menu buttons and status drawer transition choices", async () => {
    authState.perms = [
      "saleorder.view",
      "saleorder.pending.view",
      "saleorder.lr.view",
      "saleorder.create",
      "saleorder.export",
      "saleorder.action.view",
      "saleorder.update",
      "saleorder.confirm",
    ];

    render(
      <MemoryRouter>
        <SaleProcessListPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("SO-MH/26-27/00001")).toBeTruthy());

    expect(screen.getByRole("link", { name: /\+ ADD NEW/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Export$/i })).toBeTruthy();

    // Pending row Action menu shows ONLY Edit (hides SO Files, Delete)
    const kebabs = screen.getAllByRole("button", { name: "⋮" });
    fireEvent.click(kebabs[0]);
    expect(screen.getByTestId("btn-action-edit")).toBeTruthy();
    expect(screen.queryByTestId("btn-action-so-files")).toBeNull();
    expect(screen.queryByTestId("btn-action-delete")).toBeNull();

    // LR row Action menu shows "No permitted actions" without duplicate/download/delete
    fireEvent.click(kebabs[1]);
    expect(within(document.body).getByText("No permitted actions")).toBeTruthy();

    // Pending row: Update Status pencil visible (because saleorder.confirm is granted); LR row: no pencil
    const updateBtns = screen.getAllByRole("button", { name: "Update Status" });
    expect(updateBtns.length).toBe(1);
    fireEvent.click(updateBtns[0]);
    const statusSelect = screen.getByTestId("select-sale-status") as HTMLSelectElement;
    expect(Array.from(statusSelect.options).map((o) => o.value)).toEqual(["sales_confirmed"]);
  });
});
