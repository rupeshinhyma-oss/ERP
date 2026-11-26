import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProformaInvoicesPage } from "../ProformaInvoicesPage";
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

const stableProfile = { id: "u-1", username: "sales_user", display_name: "Sales User", full_name: "Sales User" };

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

const opt = (value: string, label: string, sort_order: number, meta: Record<string, unknown> | null = null) => ({
  id: `${value}-id`,
  value,
  label,
  sort_order,
  meta,
});

const STATUS_RULES = {
  pending: { next: ["admin_approved", "cancelled"], admin_only_to: ["admin_approved"], reason_required_to: ["cancelled"], edit: "any", delete: true, initial: true },
  admin_approved: { next: ["confirmed", "cancelled"], admin_only_to: [], reason_required_to: ["cancelled"], edit: "admin", delete: false, action_label: "Approve", action_color: "#d97706" },
  confirmed: { next: [], admin_only_to: [], reason_required_to: [], edit: "none", delete: false, action_label: "Confirm", action_color: "#16a34a" },
  cancelled: { next: [], admin_only_to: [], reason_required_to: [], edit: "none", delete: true, action_label: "Cancel", action_color: "#dc2626" },
};

const OPTION_GROUPS: Record<string, ReturnType<typeof opt>[]> = {
  "proforma.status": [
    opt("all", "All", 1, { card_label: "ALL", badge: "badge badge-neutral" }),
    opt("pending", "Pending", 2, { card_label: "PENDING", badge: "badge badge-neutral", ...STATUS_RULES.pending }),
    opt("admin_approved", "Admin Approved", 3, { card_label: "ADMIN APPROVED", badge: "badge badge-warning", ...STATUS_RULES.admin_approved }),
    opt("confirmed", "Confirmed", 4, { card_label: "CONFIRMED", badge: "badge badge-active", ...STATUS_RULES.confirmed }),
    opt("cancelled", "Cancelled", 5, { card_label: "CANCELLED", badge: "badge badge-danger", ...STATUS_RULES.cancelled }),
  ],
  "proforma.defaults": [
    opt("payment_terms", "100% Advance", 1),
    opt("transport_name", "Not Sure", 2),
    opt("delivery_type", "Godown", 3),
    opt("delivery_charge", "To Pay", 4),
    opt("third_party_delivery", "No", 5),
    opt("self_pickup_transport", "Self Pick-up", 6),
    opt("terms_and_conditions", "Pay within 7 days", 7),
  ],
  "common.yes_no": [opt("No", "No", 1), opt("Yes", "Yes", 2)],
  "delivery.type": [opt("Godown", "Godown", 1)],
  "delivery.charge": [opt("To Pay", "To Pay", 1)],
};

const PENDING_PI = {
  id: "pi-pending-1",
  proforma_no: "PI-00001",
  proforma_date: "19-09-2026",
  expected_delivery_date: "30-12-2099",
  warehouse: "Mumbai",
  lead_source: "Website",
  company_name: "R K Engineering",
  city: "Pune",
  state: "Maharashtra",
  sales_person: "Sales User",
  amount_inc_gst: 70210.0,
  discount: 0.0,
  status: "pending",
  below_min_price: false,
  remark: null,
  created_by: "Sales User",
  items: [{ id: "li-1", product_name: "Band Sealer", quantity: 1, uom: "Nos", rate: 70210, amount: 70210 }],
};

const APPROVED_PI = {
  ...PENDING_PI,
  id: "pi-approved-1",
  proforma_no: "PI-00002",
  company_name: "V S Machines",
  status: "admin_approved",
};

const CONFIRMED_PI = {
  ...PENDING_PI,
  id: "pi-confirmed-1",
  proforma_no: "PI-00003",
  company_name: "Acme Packaging",
  status: "confirmed",
};

const CANCELLED_PI = {
  ...PENDING_PI,
  id: "pi-cancelled-1",
  proforma_no: "PI-00004",
  company_name: "Beta Packaging",
  status: "cancelled",
};

const ALL_ITEMS = [PENDING_PI, APPROVED_PI, CONFIRMED_PI, CANCELLED_PI];

describe("ProformaInvoicesPage granular RBAC permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.spyOn(api, "apiGet").mockImplementation(async (url: string) => {
      if (url.startsWith("/masters/options/lookup")) {
        const groups = (new URLSearchParams(url.split("?")[1]).get("groups") || "").split(",");
        return { data: Object.fromEntries(groups.map((g) => [g, OPTION_GROUPS[g] || []])) } as any;
      }
      if (url.startsWith("/proforma-invoice/list")) {
        return {
          data: {
            items: ALL_ITEMS,
            tab_counts: {
              all: { count: 4, amount: 280840 },
              pending: { count: 1, amount: 70210 },
              admin_approved: { count: 1, amount: 70210 },
              confirmed: { count: 1, amount: 70210 },
              cancelled: { count: 1, amount: 70210 },
            },
            status_rules: STATUS_RULES,
          },
          success: true,
        } as any;
      }
      return { data: [], success: true } as any;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("exposes friendly permission labels for all 15 Proforma Invoices permissions", () => {
    expect(friendlyPermissionLabel("proforma.view")).toBe("View");
    expect(friendlyPermissionLabel("proforma.pending.view")).toBe("View Pending Stage");
    expect(friendlyPermissionLabel("proforma.admin_approved.view")).toBe("View Admin Approved Stage");
    expect(friendlyPermissionLabel("proforma.confirmed.view")).toBe("View Confirmed Stage");
    expect(friendlyPermissionLabel("proforma.cancelled.view")).toBe("View Cancelled Stage");
    expect(friendlyPermissionLabel("proforma.create")).toBe("+ Add New (Create)");
    expect(friendlyPermissionLabel("proforma.action.view")).toBe("View Action Column (⋮)");
    expect(friendlyPermissionLabel("proforma.download")).toBe("Action: Download / View PDF");
    expect(friendlyPermissionLabel("proforma.details.view")).toBe("Action: View Details");
    expect(friendlyPermissionLabel("proforma.update")).toBe("Action: Edit");
    expect(friendlyPermissionLabel("proforma.approve")).toBe("Stage: Admin Approved (Approve)");
    expect(friendlyPermissionLabel("proforma.confirm")).toBe("Stage: Confirmed (Confirm & Create SO)");
    expect(friendlyPermissionLabel("proforma.cancel")).toBe("Stage: Cancelled (Cancel)");
    expect(friendlyPermissionLabel("proforma.delete")).toBe("Action: Delete");
    expect(friendlyPermissionLabel("proforma.manage")).toBe("Manage All");
  });

  it("shows read-only list with only All tab & plain Proforma No when only proforma.view is granted", async () => {
    authState.perms = ["proforma.view"];

    render(
      <MemoryRouter>
        <ProformaInvoicesPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("PI-00001")).toBeTruthy());

    expect(screen.queryByRole("button", { name: /\+ ADD NEW/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^All \(4\)$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Pending \(/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Admin Approved \(/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Confirmed \(/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Cancelled \(/i })).toBeNull();
    expect(screen.queryByText("ACTION")).toBeNull();
    expect(screen.queryAllByRole("button", { name: "⋮" }).length).toBe(0);
    // Without proforma.download, PI numbers render as text, not links
    expect(screen.queryByRole("link", { name: "PI-00001" })).toBeNull();
  });

  it("controls individual stage tabs & auto-switches when All tab is hidden", async () => {
    authState.perms = ["proforma.confirmed.view"];

    render(
      <MemoryRouter>
        <ProformaInvoicesPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("PI-00003")).toBeTruthy());

    expect(screen.queryByRole("button", { name: /^All \(/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Pending \(/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Admin Approved \(/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^Confirmed \(1\)$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Cancelled \(/i })).toBeNull();
    expect(screen.queryByText("PI-00001")).toBeNull();
  });

  it("controls + ADD NEW, Action column (⋮), each Action menu item, stage transitions, and Manage All independently", async () => {
    // 1. proforma.action.view + proforma.details.view -> shows ⋮ column with View Details only
    authState.perms = ["proforma.view", "proforma.action.view", "proforma.details.view"];
    const { rerender } = render(
      <MemoryRouter>
        <ProformaInvoicesPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("PI-00001")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: "⋮" })[0]);
    expect(screen.getByRole("button", { name: /👁️ View Details/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /📄 Download \/ View PDF/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /✏️ Edit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Approve$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Cancel$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /🗑️ Delete/i })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "⋮" })[0]);

    // 2. proforma.download reveals clickable PI link & Download / View PDF action
    authState.perms = ["proforma.view", "proforma.action.view", "proforma.download"];
    rerender(
      <MemoryRouter>
        <ProformaInvoicesPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "PI-00001" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "⋮" })[0]);
    expect(screen.getByRole("button", { name: /📄 Download \/ View PDF/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /👁️ View Details/i })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "⋮" })[0]);

    // 3. Stage transitions: proforma.approve on Pending shows Approve only; proforma.confirm on Admin Approved shows Confirm & Create SO; proforma.cancel shows Cancel
    authState.perms = ["proforma.view", "proforma.action.view", "proforma.approve", "proforma.confirm", "proforma.cancel", "proforma.create", "proforma.update", "proforma.delete"];
    rerender(
      <MemoryRouter>
        <ProformaInvoicesPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /\+ ADD NEW/i })).toBeTruthy();
    // Row 0 = PENDING_PI
    fireEvent.click(screen.getAllByRole("button", { name: "⋮" })[0]);
    expect(screen.getByRole("button", { name: /✏️ Edit/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Approve$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Cancel$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /🗑️ Delete/i })).toBeTruthy();
    // Row 1 = APPROVED_PI (has proforma.approve + proforma.update -> admin stage editable!)
    fireEvent.click(screen.getAllByRole("button", { name: "⋮" })[1]);
    expect(screen.getByRole("button", { name: /✏️ Edit/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Confirm & Create SO/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Cancel$/i })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "⋮" })[1]);

    // 4. proforma.manage grants all stage tabs, header + ADD NEW, Action column, and every action
    authState.perms = ["proforma.manage"];
    rerender(
      <MemoryRouter>
        <ProformaInvoicesPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /^All \(4\)$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Pending \(1\)$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Admin Approved \(1\)$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Confirmed \(1\)$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Cancelled \(1\)$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /\+ ADD NEW/i })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "⋮" })[0]);
    expect(screen.getByRole("button", { name: /📄 Download \/ View PDF/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /👁️ View Details/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /✏️ Edit/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Approve$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Cancel$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /🗑️ Delete/i })).toBeTruthy();
  });

  it("keeps Proforma and Discount Payments sidebar permissions completely independent", () => {
    const saleSection = NAV_SECTIONS.find((s) => s.label === "SALE");
    const proformaNav = saleSection?.items.find((i) => i.key === "proforma");
    const discountNav = saleSection?.items.find((i) => i.key === "discount-payments");

    expect(proformaNav?.anyPermissions?.every((p) => p.startsWith("proforma."))).toBe(true);
    expect(discountNav?.anyPermissions?.some((p) => p.startsWith("proforma."))).toBe(false);
  });
});
