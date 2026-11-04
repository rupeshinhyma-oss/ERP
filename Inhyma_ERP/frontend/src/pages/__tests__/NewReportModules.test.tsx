import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NAV_SECTIONS, NAV_ITEMS_BY_KEY, PAGE_TITLES } from "@/lib/nav";
import {
  FinancialPlanningReportPage,
  type FinancialPlanningRecord,
} from "@/pages/FinancialPlanningReportPage";
import { CargoOverviewPage } from "@/pages/CargoOverviewPage";

const { mockApiGet, mockApiPatch, mockApiPost, mockApiPostMultipart, mockToast } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPatch: vi.fn(),
  mockApiPost: vi.fn(),
  mockApiPostMultipart: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: mockApiGet,
    apiPatch: mockApiPatch,
    apiPost: mockApiPost,
    apiPostMultipart: mockApiPostMultipart,
  };
});

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ activeKey, children }: { activeKey: string; children: React.ReactNode }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

vi.mock("@/lib/toast", () => ({
  useToast: () => mockToast,
}));

describe("Financial Planning Report & Cargo Overview Modules", () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    mockApiPatch.mockReset();
    mockApiPost.mockReset();
    mockApiPostMultipart.mockReset();
    mockApiGet.mockResolvedValue({ data: { items: [], payment_terms_options: [] } });
  });

  afterEach(() => {
    cleanup();
  });

  it("registers Financial Planning Report and Cargo Overview under REPORTS in nav.ts with report.view permission", () => {
    const reportsSection = NAV_SECTIONS.find((s) => s.label === "REPORTS");
    expect(reportsSection).toBeDefined();

    const finItem = reportsSection?.items.find((i) => i.key === "reports-financial-planning");
    expect(finItem).toBeDefined();
    expect(finItem?.label).toBe("Financial Planning Report");
    expect(finItem?.path).toBe("/reports/financial-planning");
    expect(finItem?.permission).toBe("report.view");
    expect(NAV_ITEMS_BY_KEY["reports-financial-planning"]).toBeDefined();
    expect(PAGE_TITLES["reports-financial-planning"]).toBe("Financial Planning Report");

    const cargoItem = reportsSection?.items.find((i) => i.key === "reports-cargo-overview");
    expect(cargoItem).toBeDefined();
    expect(cargoItem?.label).toBe("Cargo Overview");
    expect(cargoItem?.path).toBe("/reports/cargo-overview");
    expect(cargoItem?.permission).toBe("report.view");
    expect(NAV_ITEMS_BY_KEY["reports-cargo-overview"]).toBeDefined();
    expect(PAGE_TITLES["reports-cargo-overview"]).toBe("Cargo Overview");
  });

  it("renders Financial Planning Report list fields, Rupees (₹) default KPIs (no UGX), Pending/Cleared tabs, 50 items/page, and all 10 columns", async () => {
    render(
      <MemoryRouter initialEntries={["/reports/financial-planning"]}>
        <FinancialPlanningReportPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/financial-planning", expect.any(Object)));

    expect(screen.getByTestId("app-shell").getAttribute("data-active-key")).toBe("reports-financial-planning");
    expect(screen.getByRole("heading", { name: "Financial Planning Report" })).toBeTruthy();

    // Header actions: Refresh + Filter toggle + Export button
    expect(screen.getByTestId("fp-btn-refresh")).toBeTruthy();
    expect(screen.getByTestId("fp-btn-toggle-filter")).toBeTruthy();
    expect(screen.getByTestId("fp-btn-export")).toBeTruthy();

    // 6 KPI cards: Rupees ₹ default (no UGX!) + USD $
    expect(screen.getByTestId("fp-kpi-inr-all").textContent).toContain("₹ 0.00 (0)");
    expect(screen.getByTestId("fp-kpi-inr-paid").textContent).toContain("₹ 0.00");
    expect(screen.getByTestId("fp-kpi-inr-balance").textContent).toContain("₹ 0.00");
    expect(screen.getByTestId("fp-kpi-usd-all").textContent).toContain("$ 0.00 (0)");
    expect(screen.getByTestId("fp-kpi-usd-paid").textContent).toContain("$ 0.00");
    expect(screen.getByTestId("fp-kpi-usd-balance").textContent).toContain("$ 0.00");
    expect(document.body.textContent).not.toContain("UGX");

    // Stage tabs & 50 items/page default
    expect(screen.getByTestId("fp-tab-pending").textContent).toBe("Pending (0)");
    expect(screen.getByTestId("fp-tab-cleared").textContent).toBe("Cleared (0)");
    expect((screen.getByTestId("fp-items-per-page") as HTMLSelectElement).value).toBe("50");
    expect(screen.getByTestId("fp-search-input")).toBeTruthy();

    // All 10 exact column headers
    const table = screen.getByTestId("fp-table");
    expect(within(table).getByText("Party Name")).toBeTruthy();
    expect(within(table).getByText("Invoice / Cons. No.")).toBeTruthy();
    expect(within(table).getByText(/Attachment/i)).toBeTruthy();
    expect(within(table).getByText("Payment Terms")).toBeTruthy();
    expect(within(table).getByText("Total Amount")).toBeTruthy();
    expect(within(table).getByText("Paid Amount")).toBeTruthy();
    expect(within(table).getByText("Balance Amount")).toBeTruthy();
    expect(within(table).getByText("Due Date")).toBeTruthy();
    expect(within(table).getByText("Status")).toBeTruthy();
    expect(within(table).getByText("Action")).toBeTruthy();

    // Honest empty state
    expect(screen.getByTestId("fp-empty-state").textContent).toBe("No Data Available In Table");
  });

  it("computes Rupees (₹) default and USD ($) KPIs, normalizes Taxes (INR), switches Pending/Cleared tabs, and filters/edits rows", () => {
    const sampleRows: FinancialPlanningRecord[] = [
      {
        id: "row-1",
        party_name: "Total Taxes (UGX)", // should auto-normalize to Total Taxes (INR) with ₹ currency by default
        party_type: "Taxes",
        invoice_no: "SBC-HH2026041412",
        total_amount: 110000,
        paid_amount: 60000,
        due_date: "23-06-2026",
        status: "Pending",
      },
      {
        id: "row-2",
        party_name: "SHANDONG MACHINERY CO., LTD",
        party_type: "Supplier",
        invoice_no: "SBC-HH2026041412",
        invoice_attachment_url: "/files/inv-1.pdf",
        payment_terms: "100% Advance",
        payment_attachment_url: "/files/pay-1.pdf",
        currency: "USD",
        total_amount: 14148,
        paid_amount: 14148,
        due_date: "23-06-2026",
        status: "Cleared",
      },
      {
        id: "row-3",
        party_name: "DARSH ENTERPRISES",
        party_type: "Supplier",
        invoice_no: "DARSH-EXP-04",
        payment_terms: "CAD",
        // currency omitted -> defaults to INR (₹)
        total_amount: 50000,
        paid_amount: 50000,
        due_date: "01-07-2026",
        status: "Cleared",
      },
    ];

    render(
      <MemoryRouter initialEntries={["/reports/financial-planning"]}>
        <FinancialPlanningReportPage initialRecords={sampleRows} />
      </MemoryRouter>,
    );

    // INR KPIs aggregate row-1 (1,10,000 / 60,000 / 50,000) + row-3 (50,000 / 50,000 / 0) = 1,60,000 (2) / 1,10,000 / 50,000
    expect(screen.getByTestId("fp-kpi-inr-all").textContent).toContain("₹ 1,60,000.00 (2)");
    expect(screen.getByTestId("fp-kpi-inr-paid").textContent).toContain("₹ 1,10,000.00");
    expect(screen.getByTestId("fp-kpi-inr-balance").textContent).toContain("₹ 50,000.00");

    // USD KPIs aggregate row-2 (14,148 / 14,148 / 0)
    expect(screen.getByTestId("fp-kpi-usd-all").textContent).toContain("$ 14,148.00 (1)");
    expect(screen.getByTestId("fp-kpi-usd-paid").textContent).toContain("$ 14,148.00");
    expect(screen.getByTestId("fp-kpi-usd-balance").textContent).toContain("$ 0.00");

    // Tab counts: Pending (1), Cleared (2)
    expect(screen.getByTestId("fp-tab-pending").textContent).toBe("Pending (1)");
    expect(screen.getByTestId("fp-tab-cleared").textContent).toBe("Cleared (2)");

    // Pending tab shows normalized "Total Taxes (INR)" with Taxes badge, + Add invoice button, and ₹ amounts
    const pendingRow = screen.getByTestId("fp-row-row-1");
    expect(pendingRow.textContent).toContain("Total Taxes (INR)");
    expect(pendingRow.textContent).not.toContain("UGX");
    expect(pendingRow.textContent).toContain("Taxes");
    expect(within(pendingRow).getByTestId("fp-add-invoice-row-1")).toBeTruthy();

    // Switch to Cleared tab -> shows Supplier rows in $ and ₹
    fireEvent.click(screen.getByTestId("fp-tab-cleared"));
    expect(screen.getByTestId("fp-row-row-2").textContent).toContain("$ 14,148.00");
    expect(screen.getByTestId("fp-row-row-3").textContent).toContain("₹ 50,000.00");

    // Toggle collapsible Filter panel
    fireEvent.click(screen.getByTestId("fp-btn-toggle-filter"));
    expect(screen.getByTestId("fp-filter-panel")).toBeTruthy();
  });

  it("loads live confirmed records from Import Purchase, Local Purchase, and Sales Process (Acc. Confirmed) and persists payment updates", async () => {
    const impKey = "import_purchase:11111111-1111-1111-1111-111111111111:supplier";
    const locKey = "local_purchase:22222222-2222-2222-2222-222222222222:supplier";
    const salesKey = "sales_process:33333333-3333-3333-3333-333333333333:client";

    const liveItems: FinancialPlanningRecord[] = [
      {
        id: impKey,
        entry_key: impKey,
        party_name: "SHANDONG RUIDESHENG INTERNATIONAL",
        party_type: "Supplier",
        invoice_no: "IMP-2026-01",
        currency: "USD",
        total_amount: 12000,
        paid_amount: 0,
        balance_amount: 12000,
        due_date: "15-07-2026",
        status: "Pending",
        source_module: "import_purchase",
        source_label: "Import Purchase",
        source_stage: "Confirmed",
      },
      {
        id: locKey,
        entry_key: locKey,
        party_name: "SHREE BALAJI PACKAGING",
        party_type: "Supplier",
        invoice_no: "LP-2026-09",
        currency: "INR",
        total_amount: 59000,
        paid_amount: 0,
        balance_amount: 59000,
        due_date: "10-07-2026",
        status: "Pending",
        source_module: "local_purchase",
        source_label: "Local Purchase",
        source_stage: "Confirmed",
      },
      {
        id: salesKey,
        entry_key: salesKey,
        party_name: "ACME GLOBAL PACKAGING PVT LTD",
        party_type: "Customer",
        invoice_no: "TI/26-27/108",
        payment_terms: "30 Days Credit",
        currency: "INR",
        total_amount: 236000,
        paid_amount: 0,
        balance_amount: 236000,
        due_date: "04-07-2026",
        status: "Pending",
        source_module: "sales_process",
        source_label: "Sales Process",
        source_stage: "Acc. Confirmed",
      },
    ];

    mockApiGet.mockResolvedValueOnce({
      data: {
        items: liveItems,
        payment_terms_options: ["30 Days Credit", "100% Advance"],
      },
    });

    mockApiPost.mockResolvedValueOnce({
      data: {
        ...liveItems[2],
        paid_amount: 236000,
        balance_amount: 0,
        status: "Cleared",
      },
    });

    render(
      <MemoryRouter initialEntries={["/reports/financial-planning"]}>
        <FinancialPlanningReportPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId(`fp-row-${salesKey}`)).toBeTruthy();
    });

    // Verify all 3 wired source modules render with accurate INR (₹) & USD ($) KPIs
    expect(screen.getByTestId("fp-kpi-inr-all").textContent).toContain("₹ 2,95,000.00 (2)");
    expect(screen.getByTestId("fp-kpi-usd-all").textContent).toContain("$ 12,000.00 (1)");
    expect(screen.getByTestId(`fp-row-${salesKey}`).textContent).toContain("Sales Process • Acc. Confirmed");
    expect(screen.getByTestId(`fp-row-${salesKey}`).textContent).toContain("Customer");

    // Open Row Action Menu on Sales Process row: renders in document.body portal with vertical column layout & fixed positioning
    fireEvent.click(screen.getByTestId(`fp-action-btn-${salesKey}`));
    const actionMenu = screen.getByTestId("fp-action-menu");
    expect(screen.getByTestId("fp-table").contains(actionMenu)).toBe(false);
    expect(actionMenu.style.position).toBe("fixed");
    expect(actionMenu.style.display).toBe("flex");
    expect(actionMenu.style.flexDirection).toBe("column");
    expect(within(actionMenu).getByRole("menuitem", { name: "View Details" })).toBeTruthy();
    expect(within(actionMenu).getByRole("menuitem", { name: "Update Payment Terms" })).toBeTruthy();
    expect(within(actionMenu).getByRole("menuitem", { name: "Record Payment" })).toBeTruthy();
    expect(within(actionMenu).getByRole("menuitem", { name: "Attach Invoice" })).toBeTruthy();

    // Simulate real browser mousedown + click on View Details inside the portal -> opens padded drawer with structured cards & footer
    const viewDetailsBtn = within(actionMenu).getByRole("menuitem", { name: "View Details" });
    fireEvent.mouseDown(viewDetailsBtn);
    fireEvent.click(viewDetailsBtn);

    const detailBody = screen.getByTestId("fp-detail-modal-body");
    expect(detailBody.className).toContain("drawer-content-scroll");
    expect(detailBody.style.padding).toBe("20px 24px");
    expect(detailBody.textContent).toContain("ACME GLOBAL PACKAGING PVT LTD");
    expect(detailBody.textContent).toContain("TI/26-27/108");
    expect(detailBody.textContent).toContain("Rupees (₹ / INR)");

    // Transition directly from View Details sticky footer -> Record Payment modal -> Save Payment
    fireEvent.click(screen.getByRole("button", { name: "Record Payment" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Payment" }));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        `/financial-planning/entries/${encodeURIComponent(salesKey)}/record-payment`,
        expect.objectContaining({ amount: 236000 }),
      );
    });

    // Row transitions from Pending (3->2) to Cleared (0->1)
    await waitFor(() => {
      expect(screen.getByTestId("fp-tab-pending").textContent).toBe("Pending (2)");
      expect(screen.getByTestId("fp-tab-cleared").textContent).toBe("Cleared (1)");
    });
  });

  it("renders Cargo Overview blank module shell cleanly", () => {
    render(
      <MemoryRouter initialEntries={["/reports/cargo-overview"]}>
        <CargoOverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("app-shell").getAttribute("data-active-key")).toBe("reports-cargo-overview");
    expect(screen.getByRole("heading", { name: "Cargo Overview" })).toBeTruthy();
    expect(screen.getByTestId("cargo-overview-blank-canvas")).toBeTruthy();
  });
});
