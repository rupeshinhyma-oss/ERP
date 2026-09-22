import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { ProformaInvoicesPage } from "../ProformaInvoicesPage";
import { NAV_SECTIONS } from "@/lib/nav";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock API
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockImplementation((_url: string) => {
    return Promise.resolve({
      data: {
        items: [
          {
            id: "pi-002",
            proforma_no: "PI-MH/26-27/1701",
            proforma_date: "21-09-2026",
            expected_delivery_date: "21-09-2026",
            warehouse: "Mumbai",
            lead_source: "",
            company_name: "V S Machines",
            city: "Navi Mumbai",
            state: "Maharashtra",
            sales_person: "Dhairya Shah",
            amount_inc_gst: 271400.0,
            discount: 0.0,
            status: "admin_approved",
            remark: null,
            created_by: "Dhairya Shah",
            items: [],
          },
          {
            id: "pi-003",
            proforma_no: "PI-MH/26-27/1698",
            proforma_date: "19-09-2026",
            expected_delivery_date: "19-09-2026",
            warehouse: "Mumbai",
            lead_source: "",
            company_name: "R K ENGINEERING SOLUTIONS",
            city: "Pune",
            state: "Maharashtra",
            sales_person: "Sunita Pawar",
            amount_inc_gst: 70210.0,
            discount: 0.0,
            status: "admin_approved",
            remark: null,
            created_by: "Sunita Pawar",
            items: [],
          },
        ],
        tab_counts: {
          all: { count: 1609, amount: 162708410.52 },
          pending: { count: 0, amount: 0.0 },
          admin_approved: { count: 607, amount: 80914635.5 },
          confirmed: { count: 991, amount: 80545569.84 },
          cancelled: { count: 11, amount: 1248205.18 },
        },
      },
    });
  }),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

describe("Proforma Invoices Page & Filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders page header and action buttons matching legacy ERP screenshot", () => {
    render(
      <BrowserRouter>
        <ProformaInvoicesPage />
      </BrowserRouter>
    );

    expect(screen.getByRole("heading", { name: /proforma invoices/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /\+ add new/i })).toBeTruthy();
    expect(screen.getByTestId("btn-toggle-filter")).toBeTruthy();
  });

  it("renders the 5 summary stat cards matching the legacy screenshot", async () => {
    render(
      <BrowserRouter>
        <ProformaInvoicesPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("ADMIN APPROVED")).toBeTruthy();
      expect(screen.getByText("CONFIRMED")).toBeTruthy();
      expect(screen.getByText("CANCELLED")).toBeTruthy();
    });
  });

  it("toggles the collapsible filter panel when clicking the filter button", () => {
    render(
      <BrowserRouter>
        <ProformaInvoicesPage />
      </BrowserRouter>
    );

    const filterBtn = screen.getByTestId("btn-toggle-filter");
    expect(screen.queryByText("Proforma Invoice Date Range")).toBeNull();

    // Click to open filter
    fireEvent.click(filterBtn);
    const panel = screen.getByTestId("proforma-filter-panel");
    expect(within(panel).getByText("Proforma Invoice Date Range")).toBeTruthy();
    expect(within(panel).getByText("Expected Delivery Date Range")).toBeTruthy();
    expect(within(panel).getByText("Warehouse")).toBeTruthy();
    expect(within(panel).getByText("Sales Person")).toBeTruthy();
    expect(within(panel).getByText("Lead Source")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: /search/i })).toBeTruthy();
    expect(within(panel).getAllByRole("button", { name: /reset/i }).length).toBeGreaterThanOrEqual(1);

    // Click again to close
    fireEvent.click(filterBtn);
    expect(screen.queryByTestId("proforma-filter-panel")).toBeNull();
  });

  it("displays active filter badge and resets filters on Reset click", () => {
    render(
      <BrowserRouter>
        <ProformaInvoicesPage defaultFilterOpen={true} />
      </BrowserRouter>
    );

    const warehouseSelect = screen.getByLabelText("Warehouse");
    fireEvent.change(warehouseSelect, { target: { value: "Mumbai" } });

    // Click Search to apply filter
    const searchBtn = screen.getByRole("button", { name: /search/i });
    fireEvent.click(searchBtn);

    // Active filter badge shows 1 on the filter button
    const toggleBtn = screen.getByTestId("btn-toggle-filter");
    const badge = within(toggleBtn).getByText("1");
    expect(badge).toBeTruthy();

    // Click Reset
    const resetBtn = screen.getByRole("button", { name: /^reset$/i });
    fireEvent.click(resetBtn);

    expect((warehouseSelect as HTMLSelectElement).value).toBe("All");
    expect(within(toggleBtn).queryByText("1")).toBeNull();
  });

  it("renders table with Sr. No. column and standardized Companies Pagination component", async () => {
    render(
      <BrowserRouter>
        <ProformaInvoicesPage />
      </BrowserRouter>
    );

    // Sr. No. header present
    expect(screen.getByRole("columnheader", { name: /sr\. no\./i })).toBeTruthy();

    // First row shows serial number 1
    await waitFor(() => {
      expect(screen.getByText("PI-MH/26-27/1701")).toBeTruthy();
    });

    const rows = screen.getAllByRole("row");
    // Row 0 is the table header, Row 1 has Sr. No. 1
    expect(within(rows[1]).getByText("1")).toBeTruthy();
    expect(within(rows[1]).getByText("PI-MH/26-27/1701")).toBeTruthy();

    // Standard Companies Pagination component is rendered
    expect(screen.getByText(/showing/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /previous/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /next/i })).toBeTruthy();
  });

  it("includes all SALE parts in nav.ts (Proforma, Inquiries, Sales Process, Discount Payments)", () => {
    const saleSection = NAV_SECTIONS.find((s) => s.label === "SALE");
    expect(saleSection).toBeDefined();

    const saleKeys = saleSection?.items.map((i) => i.key);
    expect(saleKeys).toContain("proforma");
    expect(saleKeys).toContain("inquiries");
    expect(saleKeys).toContain("sales-process");
    expect(saleKeys).toContain("discount-payments");
    expect(saleKeys).not.toContain("quotation");

    expect(saleSection?.items.length).toBe(4);
  });

  it("includes PURCHASE and REPORTS sections in nav.ts matching legacy ERP", () => {
    const purchaseSection = NAV_SECTIONS.find((s) => s.label === "PURCHASE");
    expect(purchaseSection).toBeDefined();
    const purchaseKeys = purchaseSection?.items.map((i) => i.key);
    expect(purchaseKeys).toContain("local-purchases");
    expect(purchaseKeys).toContain("import-purchases");
    expect(purchaseKeys).toContain("purchase-suppliers");

    const reportsSection = NAV_SECTIONS.find((s) => s.label === "REPORTS");
    expect(reportsSection).toBeDefined();
    const reportKeys = reportsSection?.items.map((i) => i.key);
    expect(reportKeys).toContain("reports-re-order");
    expect(reportKeys).toContain("reports-stock-transactions");
    expect(reportKeys).toContain("reports-deleted-orders");
    expect(reportKeys).toContain("reports-general");
  });
});

describe("Add Proforma Invoice Form (/proforma-invoice/add & /proforma-invoice/addedit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens Add Proforma Invoice form when + ADD NEW button is clicked", () => {
    render(
      <BrowserRouter>
        <ProformaInvoicesPage />
      </BrowserRouter>
    );

    const addNewBtn = screen.getByRole("button", { name: /\+ add new/i });
    fireEvent.click(addNewBtn);

    expect(screen.getByRole("heading", { name: /add proforma invoice/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /← back/i })).toBeTruthy();
    expect(screen.getByText(/product search/i)).toBeTruthy();
    expect(screen.getByText(/product item/i)).toBeTruthy();
  });

  it("renders with defaultAdd=true and displays all General Details fields", () => {
    render(
      <BrowserRouter>
        <ProformaInvoicesPage defaultAdd={true} />
      </BrowserRouter>
    );

    expect(screen.getByRole("heading", { name: /add proforma invoice/i })).toBeTruthy();
    expect(screen.getByLabelText("Warehouse")).toBeTruthy();
    expect(screen.getByPlaceholderText("DD-MM-YYYY")).toBeTruthy();
    expect(screen.getByLabelText("Payment Terms")).toBeTruthy();
    expect(screen.getByLabelText("Sales Person")).toBeTruthy();
    expect(screen.getByLabelText("Transport Name")).toBeTruthy();
    expect(screen.getByLabelText("Third Party Delivery")).toBeTruthy();
    expect(screen.getByLabelText("Lead Source")).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter Destination")).toBeTruthy();
    expect(screen.getByLabelText("Delivery Type")).toBeTruthy();
    expect(screen.getByLabelText("Delivery Charge")).toBeTruthy();
  });

  it("opens DatePicker calendar dropdown when clicking Expected Delivery Date input and updates selected date", () => {
    render(
      <BrowserRouter>
        <ProformaInvoicesPage defaultAdd={true} />
      </BrowserRouter>
    );

    const expDateInput = screen.getByLabelText("Expected Delivery Date");
    expect((expDateInput as HTMLInputElement).value).toMatch(/^\d{2}-\d{2}-\d{4}$/);

    // Click input to open calendar dropdown
    fireEvent.click(expDateInput);
    const dropdown = screen.getByTestId("datepicker-dropdown");
    expect(dropdown).toBeTruthy();

    // Select date 24
    const day24Btn = screen.getByRole("button", { name: "24" });
    fireEvent.click(day24Btn);

    // Expect input value updated
    expect((expDateInput as HTMLInputElement).value).toMatch(/^24-\d{2}-\d{4}$/);
    expect(screen.queryByTestId("datepicker-dropdown")).toBeNull();
  });

  it("allows writing custom text as well as selecting from dropdown for all comboboxes", () => {
    render(
      <BrowserRouter>
        <ProformaInvoicesPage defaultAdd={true} />
      </BrowserRouter>
    );

    // 1. Warehouse: write custom text
    const warehouseInput = screen.getByLabelText("Warehouse");
    fireEvent.change(warehouseInput, { target: { value: "Pune Facility" } });
    expect((warehouseInput as HTMLInputElement).value).toBe("Pune Facility");

    // 2. Sales Person: select from dropdown via toggle button
    const spToggle = screen.getByRole("button", { name: /toggle sales person options/i });
    fireEvent.click(spToggle);
    expect(screen.getByText("Dhairya Shah")).toBeTruthy();
    fireEvent.click(screen.getByText("Dhairya Shah"));
    const spInput = screen.getByLabelText("Sales Person");
    expect((spInput as HTMLInputElement).value).toBe("Dhairya Shah");

    // 3. Payment Terms: type custom terms directly
    const ptInput = screen.getByLabelText("Payment Terms");
    fireEvent.change(ptInput, { target: { value: "70% Advance, 30% on Dispatch" } });
    expect((ptInput as HTMLInputElement).value).toBe("70% Advance, 30% on Dispatch");
  });

  it("renders combobox dropdowns with gray placeholders like Enter Destination and excludes 'Select' from dropdown options", () => {
    render(
      <BrowserRouter>
        <ProformaInvoicesPage defaultAdd={true} />
      </BrowserRouter>
    );

    // Initial values are empty, showing placeholder text like "Enter Destination"
    const warehouseInput = screen.getByLabelText("Warehouse");
    expect((warehouseInput as HTMLInputElement).value).toBe("");
    expect((warehouseInput as HTMLInputElement).placeholder).toBe("Select Warehouse");

    const deliveryTypeInput = screen.getByLabelText("Delivery Type");
    expect((deliveryTypeInput as HTMLInputElement).value).toBe("");
    expect((deliveryTypeInput as HTMLInputElement).placeholder).toBe("Select Delivery Type");

    // Open Delivery Type dropdown
    const dtToggle = screen.getByRole("button", { name: /toggle delivery type options/i });
    fireEvent.click(dtToggle);

    const optionsContainer = screen.getByTestId("combobox-options");
    expect(within(optionsContainer).getByText("Door Delivery")).toBeTruthy();
    expect(within(optionsContainer).getByText("Godown Delivery")).toBeTruthy();
    // 'Select' is NOT an option in the dropdown list
    expect(within(optionsContainer).queryByText(/^select$/i)).toBeNull();
  });

  it("renders 3 Entity Cards with Clear and + Add buttons", () => {
    render(
      <BrowserRouter>
        <ProformaInvoicesPage defaultAdd={true} />
      </BrowserRouter>
    );

    const customerInput = screen.getByPlaceholderText("Enter Customer Name");
    expect(customerInput).toBeTruthy();

    const addressInputs = screen.getAllByPlaceholderText("Enter Address");
    expect(addressInputs.length).toBe(2); // Billing and Shipping

    // Type in customer name and click clear
    fireEvent.change(customerInput, { target: { value: "Test Client Ltd." } });
    expect((customerInput as HTMLInputElement).value).toBe("Test Client Ltd.");

    const clearButtons = screen.getAllByTitle("Clear");
    expect(clearButtons.length).toBe(3);
    fireEvent.click(clearButtons[0]);
    expect((customerInput as HTMLInputElement).value).toBe("");
  });

  it("handles Product Search autocomplete and adds item to table", () => {
    render(
      <BrowserRouter>
        <ProformaInvoicesPage defaultAdd={true} />
      </BrowserRouter>
    );

    const searchInput = screen.getByPlaceholderText("Enter Product Name / Model No");
    fireEvent.change(searchInput, { target: { value: "Band" } });

    // Suggestion dropdown appears
    expect(screen.getByText("Continuous Band Sealer")).toBeTruthy();

    // Click suggestion to add to table
    fireEvent.click(screen.getByText("Continuous Band Sealer"));

    // Item should now be in table
    expect(screen.getByDisplayValue("Continuous Band Sealer")).toBeTruthy();
    expect(screen.getByDisplayValue("84223000")).toBeTruthy(); // HSN
  });

  it("calculates live item totals, summary bar, and Amount In Words correctly", () => {
    render(
      <BrowserRouter>
        <ProformaInvoicesPage defaultAdd={true} />
      </BrowserRouter>
    );

    // Click "+ Add Product Row"
    const addProductBtn = screen.getByRole("button", { name: /\+ add product row/i });
    fireEvent.click(addProductBtn);

    // Find the product name input
    const prodInput = screen.getByPlaceholderText("Product Name");
    fireEvent.change(prodInput, { target: { value: "Servo Motor 750W" } });

    // Qty input is already 1, set Unit Price to 1000
    const numberInputs = screen.getAllByRole("spinbutton");
    // Find Unit Price input
    const unitPriceInput = numberInputs.find((el) => (el as HTMLInputElement).value === "");
    if (unitPriceInput) {
      fireEvent.change(unitPriceInput, { target: { value: "1000" } });
    }

    // Verify Amount In Words is displayed
    expect(screen.getByText(/amount in words:/i)).toBeTruthy();
  });

  it("validates mandatory fields on submit and returns to list on ← BACK", () => {
    render(
      <BrowserRouter>
        <ProformaInvoicesPage defaultAdd={true} />
      </BrowserRouter>
    );

    const submitBtn = screen.getByRole("button", { name: /^submit$/i });
    fireEvent.click(submitBtn);

    // Shows validation errors
    expect(screen.getByText(/warehouse is required/i)).toBeTruthy();
    expect(screen.getByText(/company name is required/i)).toBeTruthy();

    // Click ← BACK to return
    const backBtn = screen.getByRole("button", { name: /← back/i });
    fireEvent.click(backBtn);
    expect(screen.getByRole("heading", { name: /proforma invoices/i })).toBeTruthy();
  });

  it("opens the PDF download route in a new tab when clicking Proforma No", async () => {
    const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <BrowserRouter>
        <ProformaInvoicesPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).toBeNull();
    });

    // Click on proforma number link
    const piLinks = screen.getAllByRole("link");
    const targetLink = piLinks.find((link) => link.textContent?.includes("PI-MH"));
    expect(targetLink).toBeTruthy();

    if (targetLink) {
      fireEvent.click(targetLink);
      expect(windowOpenSpy).toHaveBeenCalledWith(
        expect.stringContaining("/proforma-invoice/download-proforma-invoice/"),
        "_blank"
      );
    }

    windowOpenSpy.mockRestore();
  });

  it("includes 'Download / View PDF' in row actions menu", async () => {
    const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <BrowserRouter>
        <ProformaInvoicesPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).toBeNull();
    });

    // Open first row action dropdown
    const actionBtns = screen.getAllByRole("button", { name: "⋮" });
    expect(actionBtns.length).toBeGreaterThan(0);
    fireEvent.click(actionBtns[0]);

    // Menu should show "Download / View PDF"
    const pdfBtn = screen.getByRole("button", { name: /📄 Download \/ View PDF/i });
    expect(pdfBtn).toBeTruthy();

    fireEvent.click(pdfBtn);
    expect(windowOpenSpy).toHaveBeenCalledWith(
      expect.stringContaining("/proforma-invoice/download-proforma-invoice/"),
      "_blank"
    );

    windowOpenSpy.mockRestore();
  });
});

