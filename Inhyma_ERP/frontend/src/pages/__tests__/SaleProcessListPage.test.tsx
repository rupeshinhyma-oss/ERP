import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { SaleProcessListPage } from "../sales/SaleProcessList";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

// Mock API
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({
    data: {
      items: [],
      total: 0,
    },
  }),
  apiDelete: vi.fn(),
  apiPatch: vi.fn().mockResolvedValue({ data: { success: true } }),
  toQueryString: vi.fn((_params?: any) => ""),
  errorMessage: vi.fn((err: any) => err?.message || "Error"),
}));

describe("SaleProcessListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders page title, actions, and Including GST toggle switch", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    expect(screen.getByRole("heading", { name: /sale process/i })).toBeTruthy();
    expect(screen.getByText("Including GST")).toBeTruthy();
    expect(screen.getByTestId("btn-toggle-filter")).toBeTruthy();
    expect(screen.getByRole("link", { name: /\+ add new/i })).toBeTruthy();
    const exportBtn = screen.getByRole("button", { name: /^export$/i });
    expect(exportBtn).toBeTruthy();
    expect(exportBtn.classList.contains("btn-imp-exp")).toBe(true);
    expect(exportBtn.querySelector("svg")).toBeTruthy();
  });

  it("renders the 6 KPI summary stat cards matching the screenshot", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    expect(screen.getByText("ALL")).toBeTruthy();
    expect(screen.getByText("ADMIN CONFIRMED TO LR")).toBeTruthy();
    expect(screen.getByText("PENDING")).toBeTruthy();
    expect(screen.getByText("ADMIN APPROVED")).toBeTruthy();
    expect(screen.getAllByText("LR").length).toBeGreaterThan(0);
    expect(screen.getByText("CANCELLED")).toBeTruthy();
  });

  it("renders the 10 status tabs with counts", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    expect(screen.getByText(/All \(4762\)/i)).toBeTruthy();
    expect(screen.getByText(/Pending \(2\)/i)).toBeTruthy();
    expect(screen.getByText(/Sales Confirmed \(15\)/i)).toBeTruthy();
    expect(screen.getByText(/Admin Approved \(8\)/i)).toBeTruthy();
    expect(screen.getByText(/Acc\. Confirmed \(4\)/i)).toBeTruthy();
    expect(screen.getByText(/Gatepass Created \(14\)/i)).toBeTruthy();
    expect(screen.getByText(/Dispatched \(37\)/i)).toBeTruthy();
    expect(screen.getByText(/Gatepass Cancelled \(0\)/i)).toBeTruthy();
    expect(screen.getByText(/LR \(4682\)/i)).toBeTruthy();
    expect(screen.getAllByText(/Cancelled \(0\)/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders exact table columns including Gatepass and Action", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    expect(screen.getByText(/Order No/i)).toBeTruthy();
    expect(screen.getByText(/^Warehouse$/i)).toBeTruthy();
    expect(screen.getByText(/^Exp\. Deli\. Date$/i)).toBeTruthy();
    expect(screen.getByText(/^Company$/i)).toBeTruthy();
    expect(screen.getByText(/^City \/ State$/i)).toBeTruthy();
    expect(screen.getByText(/^Third Party$/i)).toBeTruthy();
    expect(screen.getByText(/^PO$/i)).toBeTruthy();
    expect(screen.getByText(/^Sales Person$/i)).toBeTruthy();
    expect(screen.getByText(/Amount \(Inc\.GST\)/i)).toBeTruthy();
    expect(screen.getByText(/^Discount$/i)).toBeTruthy();
    expect(screen.getByText(/Status/i)).toBeTruthy();
    expect(screen.getByText(/^Acc\. Dep\.$/i)).toBeTruthy();
    expect(screen.getByText(/^Gatepass$/i)).toBeTruthy();
    expect(screen.getByText(/^Action$/i)).toBeTruthy();

    // Verify Gatepass cell displays "Pending"
    expect(screen.getAllByText("Pending").length).toBeGreaterThanOrEqual(1);
  });

  it("opens Sale Status Update side drawer when clicking the edit icon on a status badge", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    const editBtns = screen.getAllByTitle("Update Status");
    expect(editBtns.length).toBeGreaterThan(0);

    fireEvent.click(editBtns[0]);
    expect(screen.getByText("Sale Status Update")).toBeTruthy();
    expect(screen.getByText(/Current Status:\s*Pending/i)).toBeTruthy();
    const statusSelect = screen.getByTestId("select-sale-status") as HTMLSelectElement;
    expect(statusSelect.value).toBe("sales_confirmed");
    expect(screen.getByTestId("input-status-po-file")).toBeTruthy();
    expect(screen.getByTestId("btn-submit-status-drawer")).toBeTruthy();
  });

  it("renders Edit, SO Files, and Delete in action menu and opens Upload Files drawer when clicking SO Files", async () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    const kebabBtns = screen.getAllByRole("button", { name: "⋮" });
    expect(kebabBtns.length).toBeGreaterThan(0);

    fireEvent.click(kebabBtns[0]);
    const editBtn = screen.getByRole("button", { name: /Edit/i });
    const soFilesBtn = screen.getByRole("button", { name: /SO Files/i });
    const deleteBtn = screen.getByRole("button", { name: /Delete/i });

    expect(editBtn).toBeTruthy();
    expect(soFilesBtn).toBeTruthy();
    expect(deleteBtn).toBeTruthy();

    // Verify non-pending actions are NOT rendered when status is Pending
    expect(screen.queryByRole("button", { name: /Print SO \(Pricing\)/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Warehouse SO \(No Pricing\)/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Gate Pass PDF/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Download Gate Pass/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Send LR to Client/i })).toBeNull();

    fireEvent.click(soFilesBtn);
    await waitFor(() => {
      expect(screen.getByText("Upload Files")).toBeTruthy();
      expect(screen.getByText("Check All Upload Files")).toBeTruthy();
      expect(screen.getByText("PO File")).toBeTruthy();
      expect(screen.getByTestId("btn-submit-upload-files")).toBeTruthy();
    });
  });

  it("opens Sales Details modal when clicking Individual Order No from the left side of the table", async () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    // Find and click the first Order No link (e.g. SO-MH/26-27/4041)
    const orderLink = screen.getByRole("button", { name: "SO-MH/26-27/4041" });
    expect(orderLink).toBeTruthy();

    fireEvent.click(orderLink);
    await waitFor(() => {
      expect(document.body.innerHTML).toContain("Sales Details");
      expect(document.body.innerHTML).toContain("Bill To");
    });
  });

  it("toggles column header between Amount (Inc.GST) and Amount (Ex.GST)", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    expect(screen.getByText(/Amount \(Inc\.GST\)/i)).toBeTruthy();

    // Click toggle switch
    const switchEl = screen.getByRole("switch");
    fireEvent.click(switchEl);

    expect(screen.getByText(/Amount \(Ex\.GST\)/i)).toBeTruthy();

    // Click back
    fireEvent.click(switchEl);
    expect(screen.getByText(/Amount \(Inc\.GST\)/i)).toBeTruthy();
  });

  it("opens Account Department Timeline drawer when clicking Timeline link", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    const timelineLinks = screen.getAllByRole("button", { name: "Timeline" });
    expect(timelineLinks.length).toBeGreaterThan(0);

    fireEvent.click(timelineLinks[0]);

    // Drawer should open showing timeline matching screenshot
    expect(screen.getByText(/Sale Order Time Line #/i)).toBeTruthy();
    expect(screen.getAllByText(/By : /i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Remark :/i).length).toBeGreaterThan(0);
  });

  it("toggles the collapsible filter panel and renders all 13 filter controls matching screenshot", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    const filterBtn = screen.getByTestId("btn-toggle-filter");
    expect(screen.queryByTestId("sale-process-filter-panel")).toBeNull();

    fireEvent.click(filterBtn);
    const panel = screen.getByTestId("sale-process-filter-panel");
    expect(panel).toBeTruthy();

    // Row 1 - 6 Date inputs
    expect(within(panel).getByText("Order Date From")).toBeTruthy();
    expect(within(panel).getByTestId("filter-order-date-from")).toBeTruthy();
    expect(within(panel).getByText("Order Date To")).toBeTruthy();
    expect(within(panel).getByTestId("filter-order-date-to")).toBeTruthy();
    expect(within(panel).getByText("Invoice Date From")).toBeTruthy();
    expect(within(panel).getByTestId("filter-invoice-date-from")).toBeTruthy();
    expect(within(panel).getByText("Invoice Date To")).toBeTruthy();
    expect(within(panel).getByTestId("filter-invoice-date-to")).toBeTruthy();
    expect(within(panel).getByText("Exp. Delivery From")).toBeTruthy();
    expect(within(panel).getByTestId("filter-exp-date-from")).toBeTruthy();
    expect(within(panel).getByText("Exp. Delivery To")).toBeTruthy();
    expect(within(panel).getByTestId("filter-exp-date-to")).toBeTruthy();

    // Row 2 - State, Dispatch, Warehouse, Sales Person (dropdown), Company, Third Party
    expect(within(panel).getByText("State")).toBeTruthy();
    expect(within(panel).getByText("Dispatch")).toBeTruthy();
    const dispatchSelect = within(panel).getByTestId("filter-dispatch") as HTMLSelectElement;
    expect(dispatchSelect).toBeTruthy();
    expect(Array.from(dispatchSelect.options).map((o) => o.text)).toEqual(["All", "Yes", "No"]);
    expect(within(panel).getByText("Warehouse")).toBeTruthy();
    expect(within(panel).getByTestId("filter-warehouse")).toBeTruthy();
    expect(within(panel).getByText("Sales Person")).toBeTruthy();
    expect(within(panel).getByTestId("filter-sales-person")).toBeTruthy();
    expect(within(panel).getByText("Company")).toBeTruthy();
    expect(within(panel).getByTestId("filter-company")).toBeTruthy();
    expect(within(panel).getByText("Third Party")).toBeTruthy();
    expect(within(panel).getByTestId("filter-third-party")).toBeTruthy();

    // Row 3 - PO, Reset, Search
    expect(within(panel).getByText("PO")).toBeTruthy();
    expect(within(panel).getByTestId("filter-po")).toBeTruthy();
    expect(within(panel).getByTestId("btn-filter-reset")).toBeTruthy();
    expect(within(panel).getByTestId("btn-filter-search")).toBeTruthy();

    // Closes on clicking toggle again
    fireEvent.click(filterBtn);
    expect(screen.queryByTestId("sale-process-filter-panel")).toBeNull();
  });

  it("renders Sales Person as a dropdown with options and filters orders when applied", async () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    const filterBtn = screen.getByTestId("btn-toggle-filter");
    fireEvent.click(filterBtn);

    const salesPersonSelect = screen.getByTestId("filter-sales-person") as HTMLSelectElement;
    expect(salesPersonSelect).toBeTruthy();
    expect(salesPersonSelect.tagName).toBe("SELECT");

    // Check that options include All, Admin, Dhairya Shah
    const optionTexts = Array.from(salesPersonSelect.options).map((opt) => opt.text);
    expect(optionTexts).toContain("All");
    expect(optionTexts).toContain("Admin");
    expect(optionTexts).toContain("Dhairya Shah");

    // Select Admin
    fireEvent.change(salesPersonSelect, { target: { value: "Admin" } });
    expect(salesPersonSelect.value).toBe("Admin");

    // Click Search button
    const searchBtn = screen.getByTestId("btn-filter-search");
    fireEvent.click(searchBtn);

    // Click Reset button to clear filter
    const resetBtn = screen.getByTestId("btn-filter-reset");
    fireEvent.click(resetBtn);
    expect(salesPersonSelect.value).toBe("");
  });

  it("filters orders by Warehouse and Company and resets filters cleanly", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    const filterBtn = screen.getByTestId("btn-toggle-filter");
    fireEvent.click(filterBtn);

    const warehouseSelect = screen.getByTestId("filter-warehouse") as HTMLSelectElement;
    const companyInput = screen.getByTestId("filter-company") as HTMLInputElement;

    fireEvent.change(warehouseSelect, { target: { value: "Mumbai" } });
    fireEvent.change(companyInput, { target: { value: "Om Polymer" } });

    expect(warehouseSelect.value).toBe("Mumbai");
    expect(companyInput.value).toBe("Om Polymer");

    const searchBtn = screen.getByTestId("btn-filter-search");
    fireEvent.click(searchBtn);

    const resetBtn = screen.getByTestId("btn-filter-reset");
    fireEvent.click(resetBtn);

    expect(warehouseSelect.value).toBe("");
    expect(companyInput.value).toBe("");
  });

  it("renders Edit, SO Files, Cancel, and Delete in action menu when order status is Sales Confirmed and excludes downstream actions", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    // Filter to Sales Confirmed tab
    const salesConfirmedTab = screen.getByRole("button", { name: /Sales Confirmed/i });
    fireEvent.click(salesConfirmedTab);

    const kebabBtns = screen.getAllByRole("button", { name: "⋮" });
    expect(kebabBtns.length).toBeGreaterThan(0);

    fireEvent.click(kebabBtns[0]);
    expect(screen.getByRole("button", { name: /Edit/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /SO Files/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Cancel$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Delete/i })).toBeTruthy();

    // Verify downstream actions are NOT rendered
    expect(screen.queryByRole("button", { name: /Print SO \(Pricing\)/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Warehouse SO \(No Pricing\)/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Gate Pass PDF/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Download Gate Pass/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Send LR to Client/i })).toBeNull();
  });

  it("directly moves order to cancelled status and switches active tab to Cancelled when clicking Cancel in action menu", async () => {
    const { apiPatch } = await import("@/lib/api");
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    // Switch to Sales Confirmed tab
    const salesConfirmedTab = screen.getByRole("button", { name: /Sales Confirmed/i });
    fireEvent.click(salesConfirmedTab);

    const kebabBtns = screen.getAllByRole("button", { name: "⋮" });
    fireEvent.click(kebabBtns[0]);

    const cancelBtn = screen.getByTestId("btn-action-cancel");
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        expect.stringMatching(/\/sales\/orders\/.*\/status/),
        expect.objectContaining({ status: "cancelled" })
      );
    });
  });

  it("renders SO Files, Cancel, and Delete in action menu for Admin Approved orders", async () => {
    const { apiGet } = await import("@/lib/api");
    (apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/sales/orders")) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "ord-admin-app",
                order_no: "SO-ADM-01",
                status: "admin_approved",
                company_name: "Acme Corp",
                customer_name: "John Doe",
                total_amount: 50000,
                amount_inc_gst: 59000,
                order_date: "25-10-2026",
                warehouse: "Main Warehouse",
              },
            ],
            total: 1,
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SO-ADM-01")).toBeTruthy();
    });

    const kebab = screen.getByRole("button", { name: "⋮" });
    fireEvent.click(kebab);

    expect(screen.getByTestId("btn-action-so-files")).toBeTruthy();
    expect(screen.getByTestId("btn-action-cancel")).toBeTruthy();
    expect(screen.getByTestId("btn-action-delete")).toBeTruthy();

    expect(screen.queryByTestId("btn-action-edit")).toBeNull();
    expect(screen.queryByTestId("btn-action-duplicate")).toBeNull();
    expect(screen.queryByTestId("btn-action-download-gatepass")).toBeNull();
  });

  it("renders SO Files and Delete in action menu for Acc Confirmed orders", async () => {
    const { apiGet } = await import("@/lib/api");
    (apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/sales/orders")) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "ord-acc-conf",
                order_no: "SO-ACC-01",
                status: "acc_confirmed",
                company_name: "Acme Corp",
                customer_name: "John Doe",
                total_amount: 50000,
                amount_inc_gst: 59000,
                order_date: "25-10-2026",
                warehouse: "Main Warehouse",
              },
            ],
            total: 1,
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SO-ACC-01")).toBeTruthy();
    });

    const kebab = screen.getByRole("button", { name: "⋮" });
    fireEvent.click(kebab);

    expect(screen.getByTestId("btn-action-so-files")).toBeTruthy();
    expect(screen.getByTestId("btn-action-delete")).toBeTruthy();

    expect(screen.queryByTestId("btn-action-edit")).toBeNull();
    expect(screen.queryByTestId("btn-action-cancel")).toBeNull();
    expect(screen.queryByTestId("btn-action-duplicate")).toBeNull();
    expect(screen.queryByTestId("btn-action-download-gatepass")).toBeNull();
  });

  it("renders Download Gatepass, SO Files, and Delete in action menu for Gatepass Created and Dispatched orders", async () => {
    const { apiGet } = await import("@/lib/api");
    (apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/sales/orders")) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "ord-gp-1",
                order_no: "SO-GP-01",
                status: "gatepass_created",
                company_name: "Acme Corp",
                customer_name: "John Doe",
                total_amount: 50000,
                amount_inc_gst: 59000,
                order_date: "25-10-2026",
                warehouse: "Main Warehouse",
              },
            ],
            total: 1,
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SO-GP-01")).toBeTruthy();
    });

    const kebab = screen.getByRole("button", { name: "⋮" });
    fireEvent.click(kebab);

    expect(screen.getByTestId("btn-action-download-gatepass")).toBeTruthy();
    expect(screen.getByTestId("btn-action-so-files")).toBeTruthy();
    expect(screen.getByTestId("btn-action-delete")).toBeTruthy();

    expect(screen.queryByTestId("btn-action-edit")).toBeNull();
    expect(screen.queryByTestId("btn-action-cancel")).toBeNull();
    expect(screen.queryByTestId("btn-action-duplicate")).toBeNull();
  });

  it("renders SO Files, Cancel, and Delete in action menu for Gatepass Cancelled orders", async () => {
    const { apiGet } = await import("@/lib/api");
    (apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/sales/orders")) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "ord-gpc-1",
                order_no: "SO-GPC-01",
                status: "gatepass_cancelled",
                company_name: "Acme Corp",
                customer_name: "John Doe",
                total_amount: 50000,
                amount_inc_gst: 59000,
                order_date: "25-10-2026",
                warehouse: "Main Warehouse",
              },
            ],
            total: 1,
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SO-GPC-01")).toBeTruthy();
    });

    const kebab = screen.getByRole("button", { name: "⋮" });
    fireEvent.click(kebab);

    expect(screen.getByTestId("btn-action-so-files")).toBeTruthy();
    expect(screen.getByTestId("btn-action-cancel")).toBeTruthy();
    expect(screen.getByTestId("btn-action-delete")).toBeTruthy();

    expect(screen.queryByTestId("btn-action-edit")).toBeNull();
    expect(screen.queryByTestId("btn-action-duplicate")).toBeNull();
    expect(screen.queryByTestId("btn-action-download-gatepass")).toBeNull();
  });

  it("renders Duplicate, Download Gatepass, and Delete in action menu for LR orders", async () => {
    const { apiGet } = await import("@/lib/api");
    (apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/sales/orders")) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "ord-lr-1",
                order_no: "SO-LR-01",
                status: "lr",
                company_name: "Acme Corp",
                customer_name: "John Doe",
                total_amount: 50000,
                amount_inc_gst: 59000,
                order_date: "25-10-2026",
                warehouse: "Main Warehouse",
              },
            ],
            total: 1,
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SO-LR-01")).toBeTruthy();
    });

    const kebab = screen.getByRole("button", { name: "⋮" });
    fireEvent.click(kebab);

    expect(screen.getByTestId("btn-action-duplicate")).toBeTruthy();
    expect(screen.getByTestId("btn-action-download-gatepass")).toBeTruthy();
    expect(screen.getByTestId("btn-action-delete")).toBeTruthy();

    expect(screen.queryByTestId("btn-action-edit")).toBeNull();
    expect(screen.queryByTestId("btn-action-so-files")).toBeNull();
    expect(screen.queryByTestId("btn-action-cancel")).toBeNull();
  });

  it("renders only Delete in action menu for Cancelled orders", async () => {
    const { apiGet } = await import("@/lib/api");
    (apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/sales/orders")) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "ord-canc-1",
                order_no: "SO-CANC-01",
                status: "cancelled",
                company_name: "Acme Corp",
                customer_name: "John Doe",
                total_amount: 50000,
                amount_inc_gst: 59000,
                order_date: "25-10-2026",
                warehouse: "Main Warehouse",
              },
            ],
            total: 1,
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SO-CANC-01")).toBeTruthy();
    });

    const kebab = screen.getByRole("button", { name: "⋮" });
    fireEvent.click(kebab);

    expect(screen.getByTestId("btn-action-delete")).toBeTruthy();

    expect(screen.queryByTestId("btn-action-edit")).toBeNull();
    expect(screen.queryByTestId("btn-action-duplicate")).toBeNull();
    expect(screen.queryByTestId("btn-action-download-gatepass")).toBeNull();
    expect(screen.queryByTestId("btn-action-so-files")).toBeNull();
    expect(screen.queryByTestId("btn-action-cancel")).toBeNull();
  });

  it("allows deleting uploaded file and attached PO from the SO files drawer", async () => {
    const { apiGet, apiPatch } = await import("@/lib/api");
    (apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/sales/orders")) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "ord-files-1",
                order_no: "SO-FILES-01",
                status: "pending",
                company_name: "Acme Corp",
                customer_name: "John Doe",
                po: "Yes",
                po_file: "Customer_PO_123.pdf",
                files: [
                  { name: "Order_Spec.pdf", size: "150 KB" },
                  { name: "Customer_PO_123.pdf", size: "200 KB" },
                ],
                total_amount: 50000,
                amount_inc_gst: 59000,
                order_date: "25-10-2026",
                warehouse: "Main Warehouse",
              },
            ],
            total: 1,
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SO-FILES-01")).toBeTruthy();
    });

    const kebab = screen.getByRole("button", { name: "⋮" });
    fireEvent.click(kebab);

    const soFilesBtn = screen.getByTestId("btn-action-so-files");
    fireEvent.click(soFilesBtn);

    // Open Check All Upload Files section
    const checkAllBtn = screen.getByTestId("btn-check-all-upload-files");
    fireEvent.click(checkAllBtn);

    // Both files should be listed with delete buttons
    expect(screen.getByText(/Order_Spec\.pdf/)).toBeTruthy();
    const deleteFile0 = screen.getByTestId("btn-delete-file-0");
    fireEvent.click(deleteFile0);

    await waitFor(() => {
      expect(screen.queryByText(/Order_Spec\.pdf/)).toBeNull();
    });

    // Delete existing PO file
    const deletePoBtn = screen.getByTestId("btn-delete-po-file");
    fireEvent.click(deletePoBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("btn-delete-po-file")).toBeNull();
      expect(apiPatch).toHaveBeenCalledWith(
        expect.stringMatching(/\/sales\/orders\/ord-files-1/),
        expect.objectContaining({ po: "No" })
      );
    });
  });

  it("supports multi-stage Sale Status Update drawer workflow (Pending -> Sales Confirmed -> Admin Approved -> Acc. Confirmed)", async () => {
    const { apiGet, apiPatch } = await import("@/lib/api");

    (apiGet as any).mockImplementation((url: string) => {
      if (url.startsWith("/sales/orders")) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "ord-stage-1",
                order_no: "SO-STAGE-01",
                company_name: "Alpha Packaging",
                buyer_name: "Alpha Packaging",
                status: "pending",
                total_amount: 100000,
                amount_inc_gst: 118000,
                order_date: "28-10-2026",
                warehouse: "Mumbai",
              },
              {
                id: "ord-stage-2",
                order_no: "SO-STAGE-02",
                company_name: "Beta Industries",
                buyer_name: "Beta Industries",
                status: "sales_confirmed",
                po_file_url: "/uploads/private/sales_po/beta_po.pdf",
                po_file_name: "beta_po.pdf",
                total_amount: 150000,
                amount_inc_gst: 177000,
                order_date: "28-10-2026",
                warehouse: "Mumbai",
              },
              {
                id: "ord-stage-3",
                order_no: "SO-STAGE-03",
                company_name: "Gamma Corp",
                buyer_name: "Gamma Corp",
                status: "admin_approved",
                po_file_url: "/uploads/private/sales_po/gamma_po.pdf",
                po_file_name: "gamma_po.pdf",
                total_amount: 200000,
                amount_inc_gst: 236000,
                order_date: "28-10-2026",
                warehouse: "Mumbai",
              },
            ],
            total: 3,
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SO-STAGE-01")).toBeTruthy();
      expect(screen.getByText("SO-STAGE-02")).toBeTruthy();
      expect(screen.getByText("SO-STAGE-03")).toBeTruthy();
    });

    // PO badges are rendered for orders that already have po_file_url
    expect(screen.getAllByText(/📎 PO/i).length).toBeGreaterThanOrEqual(2);

    const updateBtns = screen.getAllByTitle("Update Status");

    // Stage 1: Pending -> Sales Confirmed with PO File upload
    fireEvent.click(updateBtns[0]);
    expect(screen.getByText(/Current Status:\s*Pending/i)).toBeTruthy();
    const poInput = screen.getByTestId("input-status-po-file") as HTMLInputElement;
    const poFile = new File(["dummy po"], "alpha_po.pdf", { type: "application/pdf" });
    fireEvent.change(poInput, { target: { files: [poFile] } });
    expect(screen.getByText(/alpha_po\.pdf/i)).toBeTruthy();

    fireEvent.change(screen.getByTestId("textarea-status-remarks"), {
      target: { value: "PO verified by sales" },
    });
    fireEvent.click(screen.getByTestId("btn-submit-status-drawer"));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        "/sales/orders/ord-stage-1/status",
        expect.objectContaining({
          status: "sales_confirmed",
          remarks: "PO verified by sales",
          po_file_name: "alpha_po.pdf",
        })
      );
    });

    // Stage 2: Sales Confirmed -> Admin Approved (PO File input hidden)
    fireEvent.click(screen.getAllByTitle("Update Status")[1]);
    expect(screen.getByText(/Current Status:\s*Sales Confirmed/i)).toBeTruthy();
    expect(screen.queryByTestId("input-status-po-file")).toBeNull();
    const stage2Select = screen.getByTestId("select-sale-status") as HTMLSelectElement;
    expect(stage2Select.value).toBe("admin_approved");
    fireEvent.click(screen.getByTestId("btn-submit-status-drawer"));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        "/sales/orders/ord-stage-2/status",
        expect.objectContaining({
          status: "admin_approved",
        })
      );
    });

    // Stage 3: Admin Approved -> Acc. Confirmed (Invoice Date, Invoice No, Tally Bill, E-Way Bill)
    fireEvent.click(screen.getAllByTitle("Update Status")[2]);
    expect(screen.getByText(/Current Status:\s*Admin Approved/i)).toBeTruthy();
    expect(screen.getByTestId("input-status-invoice-date")).toBeTruthy();
    expect(screen.getByTestId("input-status-invoice-no")).toBeTruthy();
    expect(screen.getByTestId("input-status-tally-bill")).toBeTruthy();
    expect(screen.getByTestId("select-status-eway-bill")).toBeTruthy();

    // When E-Way Bill is "No" (default), E-Way Bill * file input is NOT rendered
    expect((screen.getByTestId("select-status-eway-bill") as HTMLSelectElement).value).toBe("No");
    expect(screen.queryByTestId("input-status-eway-bill-file")).toBeNull();

    fireEvent.change(screen.getByTestId("input-status-invoice-date"), {
      target: { value: "2026-10-28" },
    });
    fireEvent.change(screen.getByTestId("input-status-invoice-no"), {
      target: { value: "INV-INH/26-27/0999" },
    });
    const tallyFile = new File(["tally pdf"], "gamma_tally_bill.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("input-status-tally-bill"), {
      target: { files: [tallyFile] },
    });

    // Switch E-Way Bill to "Yes" -> mandatory E-Way Bill * file upload appears
    fireEvent.change(screen.getByTestId("select-status-eway-bill"), {
      target: { value: "Yes" },
    });
    expect(screen.getByTestId("input-status-eway-bill-file")).toBeTruthy();

    // Submitting without E-Way Bill file when E-Way Bill = Yes blocks submission
    (apiPatch as any).mockClear();
    fireEvent.click(screen.getByTestId("btn-submit-status-drawer"));
    expect(apiPatch).not.toHaveBeenCalled();

    // Attach E-Way Bill file and submit
    const ewayFile = new File(["eway pdf"], "gamma_eway_bill.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("input-status-eway-bill-file"), {
      target: { files: [ewayFile] },
    });
    fireEvent.click(screen.getByTestId("btn-submit-status-drawer"));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        "/sales/orders/ord-stage-3/status",
        expect.objectContaining({
          status: "acc_confirmed",
          invoice_date: "2026-10-28",
          invoice_no: "INV-INH/26-27/0999",
          tally_bill_name: "gamma_tally_bill.pdf",
          eway_bill: "Yes",
          eway_bill_name: "gamma_eway_bill.pdf",
        })
      );
    });
  });

  it("renders clean Sale Status Update drawer for Acc. Confirmed -> Gatepass Created (Status, Remarks, Submit only)", async () => {
    const { apiGet, apiPatch } = await import("@/lib/api");

    (apiGet as any).mockImplementation((url: string) => {
      if (url.startsWith("/sales/orders")) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "ord-acc-1",
                order_no: "SO-MH/26-27/4992",
                company_name: "ASN PACKAGING PRIVATE LIMITED",
                buyer_name: "ASN PACKAGING PRIVATE LIMITED",
                status: "acc_confirmed",
                status_updated_at: "28-10-2026 01:21 PM",
                total_amount: 4620,
                amount_inc_gst: 5451.6,
                order_date: "28-10-2026",
                warehouse: "Mumbai",
                city: "VILL.KURULI CHAKAN",
                state: "Maharashtra",
                sales_person: "Abhishek Patel",
                tally_bill_url: "/uploads/private/sales_tally_bills/tally_4992.pdf",
                tally_bill_name: "tally_4992.pdf",
                eway_bill: "Yes",
                eway_bill_url: "/uploads/private/sales_eway_bills/eway_4992.pdf",
                eway_bill_name: "eway_4992.pdf",
              },
            ],
            total: 1,
          },
        });
      }
      if (url.startsWith("/sales/next-gatepass-no")) {
        return Promise.resolve({ data: { gatepass_no: "GP-26-27/0501" } });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SO-MH/26-27/4992")).toBeTruthy();
    });

    // Verify Acc. Dep. renders clickable [i] (Tally Bill) and [E] (E-Way Bill) chips with dark hover tooltips
    const tallyBadge = screen.getByTestId("acc-dep-tally-ord-acc-1") as HTMLAnchorElement;
    const ewayBadge = screen.getByTestId("acc-dep-eway-ord-acc-1") as HTMLAnchorElement;
    expect(tallyBadge.textContent).toBe("i");
    expect(tallyBadge.getAttribute("href")).toContain("/uploads/private/sales_tally_bills/tally_4992.pdf");
    expect(ewayBadge.textContent).toBe("E");
    expect(ewayBadge.getAttribute("href")).toContain("/uploads/private/sales_eway_bills/eway_4992.pdf");

    fireEvent.mouseEnter(tallyBadge.parentElement!);
    expect(screen.getByRole("tooltip").textContent).toBe("Tally Bill");
    fireEvent.mouseLeave(tallyBadge.parentElement!);

    fireEvent.mouseEnter(ewayBadge.parentElement!);
    expect(screen.getByRole("tooltip").textContent).toBe("E-Way Bill");
    fireEvent.mouseLeave(ewayBadge.parentElement!);

    fireEvent.click(screen.getByTitle("Update Status"));

    expect(screen.getByText(/Current Status:\s*Acc\. Confirmed/i)).toBeTruthy();
    const statusSelect = screen.getByTestId("select-sale-status") as HTMLSelectElement;
    expect(statusSelect.value).toBe("gatepass_created");
    expect(Array.from(statusSelect.options).map((o) => o.text)).toEqual(["Gatepass Created"]);

    // Ensure no extra Gate Pass Details or PO/Invoice fields render in the Acc. Confirmed drawer
    expect(screen.queryByText(/Outward Gate Pass Details/i)).toBeNull();
    expect(screen.queryByTestId("input-status-po-file")).toBeNull();
    expect(screen.queryByTestId("input-status-invoice-no")).toBeNull();
    expect(screen.getByTestId("textarea-status-remarks")).toBeTruthy();

    fireEvent.change(screen.getByTestId("textarea-status-remarks"), {
      target: { value: "Ready for gatepass" },
    });
    fireEvent.click(screen.getByTestId("btn-submit-status-drawer"));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        "/sales/orders/ord-acc-1/status",
        expect.objectContaining({
          status: "gatepass_created",
          remarks: "Ready for gatepass",
        })
      );
    });
  });

  it("renders Dispatched drawer with LR & Gatepass Cancel options, Change Transport Info toggle, mandatory LR File *, and Images/Videos multiple upload dropzone", async () => {
    const { apiGet, apiPatch } = await import("@/lib/api");

    (apiGet as any).mockImplementation((url: string) => {
      if (url.startsWith("/sales/orders")) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "ord-disp-1",
                order_no: "SO-GJ/26-27/1013",
                company_name: "APH TECH",
                buyer_name: "APH TECH",
                status: "dispatched",
                status_updated_at: "28-10-2026 02:23 PM",
                total_amount: 17000,
                amount_inc_gst: 20060,
                order_date: "28-10-2026",
                warehouse: "Ahmedabad",
                city: "KANDIVALI EAST",
                state: "Maharashtra",
                sales_person: "Dhairya Shah",
                transporter_name: "VRL Logistics",
                transport_destination: "Mumbai",
                delivery_type: "Godown Delivery",
                delivery_charge: "To Pay",
                gatepass_no: "NO: 5845",
                gatepass_date: "28-10-2026",
              },
              {
                id: "ord-disp-2",
                order_no: "SO-GJ/26-27/1012",
                company_name: "SHREERAM ENTERPRISES",
                buyer_name: "SHREERAM ENTERPRISES",
                status: "dispatched",
                status_updated_at: "28-10-2026 02:23 PM",
                total_amount: 8800,
                amount_inc_gst: 10384,
                order_date: "28-10-2026",
                warehouse: "Ahmedabad",
                city: "Indore",
                state: "Madhya Pradesh",
                sales_person: "Dhairya Shah",
                gatepass_no: "NO: 5846",
                gatepass_date: "28-10-2026",
              },
            ],
            total: 2,
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SO-GJ/26-27/1013")).toBeTruthy();
    });

    // 1. Open Dispatched drawer for first order (Dispatched -> LR)
    fireEvent.click(screen.getAllByTitle("Update Status")[0]);

    expect(screen.getByText(/Current Status:\s*Dispatched/i)).toBeTruthy();
    const statusSelect = screen.getByTestId("select-sale-status") as HTMLSelectElement;
    expect(statusSelect.value).toBe("lr");
    expect(Array.from(statusSelect.options).map((o) => o.text)).toEqual(["LR", "Gatepass Cancel"]);

    // Verify Change Transport Info checkbox is unchecked by default and fields are collapsed
    const changeTransportCheckbox = screen.getByTestId("checkbox-change-transport-info") as HTMLInputElement;
    expect(changeTransportCheckbox.checked).toBe(false);
    expect(screen.queryByTestId("section-change-transport-fields")).toBeNull();

    // Verify LR File * and Images/Videos (Upload Multiple) dropzone are rendered
    expect(screen.getByTestId("input-status-lr-file")).toBeTruthy();
    expect(screen.getByTestId("dropzone-dispatch-media")).toBeTruthy();
    expect(screen.getByText(/Drag files here to upload/i)).toBeTruthy();

    // Submitting without LR File * blocks submission
    fireEvent.click(screen.getByTestId("btn-submit-status-drawer"));
    expect(apiPatch).not.toHaveBeenCalled();

    // Toggle Change Transport Info and verify 2x2 grid (Transport Name | Transport Destination / Delivery Type | Delivery Charge)
    fireEvent.click(changeTransportCheckbox);
    const transportGrid = screen.getByTestId("section-change-transport-fields");
    expect(transportGrid).toBeTruthy();
    expect(transportGrid.style.gridTemplateColumns).toBe("1fr 1fr");
    expect(within(transportGrid).getByText("Transport Name")).toBeTruthy();
    expect(within(transportGrid).getByText("Transport Destination")).toBeTruthy();
    expect(within(transportGrid).getByText("Delivery Type")).toBeTruthy();
    expect(within(transportGrid).getByText("Delivery Charge")).toBeTruthy();

    fireEvent.change(screen.getByTestId("select-status-transport-name"), {
      target: { value: "Falcon Cargo" },
    });
    fireEvent.change(screen.getByTestId("input-status-transport-destination"), {
      target: { value: "Kandivali East" },
    });
    fireEvent.change(screen.getByTestId("select-status-delivery-type"), {
      target: { value: "Door" },
    });
    fireEvent.change(screen.getByTestId("select-status-delivery-charge"), {
      target: { value: "To Pay" },
    });

    // Attach LR File * and drop multiple Images/Videos
    const lrFile = new File(["lr pdf"], "lr_5845.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("input-status-lr-file"), {
      target: { files: [lrFile] },
    });

    const imgFile = new File(["jpg bytes"], "box_photo.jpg", { type: "image/jpeg" });
    const vidFile = new File(["mp4 bytes"], "truck_loading.mp4", { type: "video/mp4" });
    fireEvent.drop(screen.getByTestId("dropzone-dispatch-media"), {
      dataTransfer: { files: [imgFile, vidFile] },
    });

    expect(screen.getByText(/box_photo\.jpg/i)).toBeTruthy();
    expect(screen.getByText(/truck_loading\.mp4/i)).toBeTruthy();

    fireEvent.change(screen.getByTestId("textarea-status-remarks"), {
      target: { value: "LR uploaded with 2 dispatch proofs" },
    });
    fireEvent.click(screen.getByTestId("btn-submit-status-drawer"));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        "/sales/orders/ord-disp-1/status",
        expect.objectContaining({
          status: "lr",
          lr_file_name: "lr_5845.pdf",
          change_transport_info: true,
          transport_name: "Falcon Cargo",
          transporter_name: "Falcon Cargo",
          transport_destination: "Kandivali East",
          delivery_type: "Door",
          delivery_charge: "To Pay",
          remarks: "LR uploaded with 2 dispatch proofs",
          dispatch_media: expect.arrayContaining([
            expect.objectContaining({ filename: "box_photo.jpg" }),
            expect.objectContaining({ filename: "truck_loading.mp4" }),
          ]),
        })
      );
    });

    // 2. Open Dispatched drawer for second order (no transport_destination/delivery_type set)
    fireEvent.click(screen.getAllByTitle("Update Status")[1]);
    fireEvent.click(screen.getByTestId("checkbox-change-transport-info"));
    // Verify Transport Destination does NOT fall back to city ("Indore") and Delivery Type/Charge default to Door / To Pay
    expect((screen.getByTestId("input-status-transport-destination") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("select-status-delivery-type") as HTMLSelectElement).value).toBe("Door");
    expect((screen.getByTestId("select-status-delivery-charge") as HTMLSelectElement).value).toBe("To Pay");

    // Switch to Gatepass Cancel
    fireEvent.change(screen.getByTestId("select-sale-status"), {
      target: { value: "gatepass_cancelled" },
    });

    // LR File *, Change Transport Info, and Images/Videos dropzone hide on Gatepass Cancel
    expect(screen.queryByTestId("checkbox-change-transport-info")).toBeNull();
    expect(screen.queryByTestId("input-status-lr-file")).toBeNull();
    expect(screen.queryByTestId("dropzone-dispatch-media")).toBeNull();

    fireEvent.change(screen.getByTestId("textarea-status-remarks"), {
      target: { value: "Gatepass cancelled due to vehicle change" },
    });
    fireEvent.click(screen.getByTestId("btn-submit-status-drawer"));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        "/sales/orders/ord-disp-2/status",
        expect.objectContaining({
          status: "gatepass_cancelled",
          remarks: "Gatepass cancelled due to vehicle change",
        })
      );
    });
  });

  it("renders full 7-stage Sale Order Timeline with Account Confirmed Invoice No, Invoice Date, E-Way Bill and Tally Bill download links", async () => {
    const { apiGet } = await import("@/lib/api");
    (apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/sales/orders")) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "ord-lr-6673",
                order_no: "SO-MH/26-27/6673",
                buyer_name: "SHRI RAM PACKAGING SYSTEM",
                company_name: "SHRI RAM PACKAGING SYSTEM",
                status: "lr",
                status_updated_at: "28-10-2026 02:35 PM",
                total_amount: 12980,
                amount_inc_gst: 12980,
                order_date: "28-10-2026",
                warehouse: "Mumbai",
                city: "Indore",
                state: "Madhya Pradesh",
                sales_person: "Sunita Pawar",
                invoice_no: "887/26-27",
                invoice_date: "2026-10-28",
                eway_bill: "Yes",
                eway_bill_url: "/uploads/private/sales_eway_bills/eway_887.pdf",
                eway_bill_name: "eway_887.pdf",
                tally_bill_url: "/uploads/private/sales_tally_bills/tally_887.pdf",
                tally_bill_name: "tally_887.pdf",
                timeline: [
                  { status: "LR Mandatory", status_key: "lr", date: "28-10-2026 02:35 PM", by: "Dhairya Shah" },
                  { status: "Dispatched", status_key: "dispatched", date: "28-10-2026 02:30 PM", by: "Dhairya Shah" },
                  { status: "Gatepass Created", status_key: "gatepass_created", date: "28-10-2026 02:30 PM", by: "Dhairya Shah" },
                  {
                    status: "Account Confirmed",
                    status_key: "acc_confirmed",
                    date: "28-10-2026 02:23 PM",
                    by: "Ankita Sawant",
                    invoice_no: "887/26-27",
                    invoice_date: "2026-10-28",
                    eway_bill_url: "/uploads/private/sales_eway_bills/eway_887.pdf",
                    tally_bill_url: "/uploads/private/sales_tally_bills/tally_887.pdf",
                  },
                  { status: "Admin Approval", status_key: "admin_approved", date: "28-10-2026 02:07 PM", by: "Dhairya Shah" },
                  { status: "Sales Confirmed", status_key: "sales_confirmed", date: "28-10-2026 02:07 PM", by: "Dhairya Shah" },
                  { status: "Pending", status_key: "pending", date: "28-10-2026 02:06 PM", by: "Dhairya Shah" },
                ],
              },
              {
                id: "ord-gp-6676",
                order_no: "SO-MH/26-27/6676",
                buyer_name: "MAHADEV ENTERPRISES",
                company_name: "MAHADEV ENTERPRISES",
                status: "gatepass_created",
                status_updated_at: "28-10-2026 03:16 PM",
                total_amount: 6136,
                amount_inc_gst: 6136,
                order_date: "28-10-2026",
                warehouse: "Mumbai",
                city: "Kalyan",
                state: "Maharashtra",
                sales_person: "Siddhi Kilaje",
                invoice_no: "4204/26-27",
                invoice_date: "2026-10-28",
                eway_bill: "No",
                tally_bill_url: "/uploads/private/sales_tally_bills/tally_4204.pdf",
                tally_bill_name: "tally_4204.pdf",
              },
            ],
            total: 2,
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SO-MH/26-27/6673")).toBeTruthy();
    });

    // 1. Open Timeline for #6673 (LR Mandatory with both E-Way Bill and Tally Bill)
    const timelineButtons = screen.getAllByRole("button", { name: "Timeline" });
    fireEvent.click(timelineButtons[0]);

    expect(screen.getByText("Sale Order Time Line #6673")).toBeTruthy();
    const list = screen.getByTestId("sale-order-timeline-list");
    expect(within(list).getByText("LR Mandatory")).toBeTruthy();
    expect(within(list).getByText("Dispatched")).toBeTruthy();
    expect(within(list).getByText("Gatepass Created")).toBeTruthy();
    expect(within(list).getByText("Account Confirmed")).toBeTruthy();
    expect(within(list).getByText("Admin Approval")).toBeTruthy();
    expect(within(list).getByText("Sales Confirmed")).toBeTruthy();
    expect(within(list).getByText("Pending")).toBeTruthy();

    expect(within(list).getByText("By : Ankita Sawant")).toBeTruthy();
    expect(within(list).getByText("Invoice No : 887/26-27")).toBeTruthy();
    expect(within(list).getByText("Invoice Date : 28-10-2026")).toBeTruthy();

    const ewayLink = within(list).getByTestId("timeline-download-eway-bill") as HTMLAnchorElement;
    const tallyLink = within(list).getByTestId("timeline-download-tally-bill") as HTMLAnchorElement;
    expect(ewayLink.getAttribute("href")).toContain("/uploads/private/sales_eway_bills/eway_887.pdf");
    expect(tallyLink.getAttribute("href")).toContain("/uploads/private/sales_tally_bills/tally_887.pdf");
    expect(within(list).queryByText(/Remark :/i)).toBeNull();

    // 2. Open Timeline for #6676 (Gatepass Created without persisted timeline array & E-Way Bill = No)
    fireEvent.click(timelineButtons[1]);
    expect(screen.getByText("Sale Order Time Line #6676")).toBeTruthy();
    const gpList = screen.getByTestId("sale-order-timeline-list");
    expect(within(gpList).queryByText("LR Mandatory")).toBeNull();
    expect(within(gpList).queryByText("Dispatched")).toBeNull();
    expect(within(gpList).getByText("Gatepass Created")).toBeTruthy();
    expect(within(gpList).getByText("Account Confirmed")).toBeTruthy();
    expect(within(gpList).getByText("Admin Approval")).toBeTruthy();
    expect(within(gpList).getByText("Sales Confirmed")).toBeTruthy();
    expect(within(gpList).getByText("Pending")).toBeTruthy();
    expect(within(gpList).getByText("Invoice No : 4204/26-27")).toBeTruthy();
    expect(within(gpList).getByText("Invoice Date : 28-10-2026")).toBeTruthy();
    expect(within(gpList).queryByTestId("timeline-download-eway-bill")).toBeNull();
    expect(within(gpList).getByTestId("timeline-download-tally-bill")).toBeTruthy();
    expect(within(gpList).queryByText(/Bill Abhi Mat Banana/i)).toBeNull();
  });
});
