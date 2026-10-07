import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { ProformaInvoicesPage } from "../ProformaInvoicesPage";
import { NAV_SECTIONS } from "@/lib/nav";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// The signed-in user is controlled per test
const auth = vi.hoisted(() => ({ isSuperAdmin: false }));
vi.mock("@/lib/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hooks")>()),
  useAuth: () => ({
    profile: { username: "marketing", full_name: "Marketing User" },
    isSuperAdmin: auth.isSuperAdmin,
    hasPermission: () => false,
  }),
}));

// ---- fixtures: everything the page reads comes from the API, nothing is built into the page ----
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
  "delivery.type": [opt("Godown", "Godown", 1), opt("Door", "Door", 2)],
  "delivery.charge": [opt("To Pay", "To Pay", 1), opt("Paid", "Paid", 2)],
};

const PENDING_PI = {
  id: "pi-001",
  proforma_no: "PI-00001",
  proforma_date: "19-09-2026",
  expected_delivery_date: "30-12-2099",
  warehouse: "Mumbai",
  lead_source: "Website",
  company_name: "R K Engineering",
  city: "Pune",
  state: "Maharashtra",
  sales_person: "Sunita Pawar",
  payment_terms: "100% Advance",
  transport_name: "Not Sure",
  transport_destination: "Pune",
  delivery_type: "Godown",
  delivery_charge: "To Pay",
  third_party_delivery: "No",
  billing_address: "1 Billing Rd",
  shipping_address: "2 Shipping Rd",
  terms_and_conditions: "Pay within 7 days",
  amount_inc_gst: 70210.0,
  discount: 0.0,
  status: "pending",
  below_min_price: false,
  remark: null,
  created_by: "marketing",
  items: [
    { id: "li-1", product_name: "Band Sealer", hsn_code: "84223000", quantity: 2, uom: "Nos", rate: 25000, unit_price: 25000, unit_discount: 0, gst_percent: 18, gst_amount: 9000, taxable_amount: 50000, amount: 59000, total: 59000, is_additional_charge: false },
  ],
};
const APPROVED_PI = {
  ...PENDING_PI,
  id: "pi-002",
  proforma_no: "PI-00002",
  proforma_date: "21-09-2026",
  company_name: "V S Machines",
  city: "Navi Mumbai",
  sales_person: "Dhairya Shah",
  amount_inc_gst: 271400.0,
  status: "admin_approved",
};

const LIST_RESPONSE = {
  items: [APPROVED_PI, PENDING_PI],
  tab_counts: {
    all: { count: 2, amount: 341610.0 },
    pending: { count: 1, amount: 70210.0 },
    admin_approved: { count: 1, amount: 271400.0 },
    confirmed: { count: 0, amount: 0.0 },
    cancelled: { count: 0, amount: 0.0 },
  },
  status_rules: STATUS_RULES,
};

const CATALOG = [{ product_name: "Continuous Band Sealer", hsn_number: "84223000", gst_percent: 18, standard_price: 25000 }];

function fakeApiGet(url: string) {
  if (url.startsWith("/masters/options/lookup")) {
    const groups = (new URLSearchParams(url.split("?")[1]).get("groups") || "").split(",");
    return Promise.resolve({ data: Object.fromEntries(groups.map((g) => [g, OPTION_GROUPS[g] || []])) });
  }
  if (url.startsWith("/proforma-invoice/list")) return Promise.resolve({ data: LIST_RESPONSE });
  if (url.startsWith("/companies/sales-persons")) return Promise.resolve({ data: [{ id: "u1", full_name: "Dhairya Shah", username: "dhairya" }] });
  if (url.startsWith("/masters/warehouses")) return Promise.resolve({ data: [{ name: "Mumbai" }, { name: "Ahmedabad" }] });
  if (url.startsWith("/masters/payment-terms")) return Promise.resolve({ data: [{ name: "100% Advance" }, { name: "7 Days Credit" }] });
  if (url.startsWith("/masters/transports")) return Promise.resolve({ data: [{ name: "Not Sure" }, { name: "Self Pick-up" }, { name: "VRL" }] });
  if (url.startsWith("/masters/lead-sources")) return Promise.resolve({ data: [{ name: "Website" }, { name: "IndiaMART" }] });
  if (url.startsWith("/masters/additional-charges")) return Promise.resolve({ data: [{ name: "Transport Charges" }, { name: "Packing & Forwarding" }] });
  if (url.startsWith("/masters/products")) return Promise.resolve({ data: CATALOG });
  if (url.startsWith("/companies/lookup")) return Promise.resolve({ data: [] });
  return Promise.resolve({ data: [] });
}

// Real helpers (toQueryString, errorMessage) stay; only the network functions are faked
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks(); // call history must not leak between tests
  auth.isSuperAdmin = false;
  (apiGet as any).mockImplementation(fakeApiGet);
  (apiPost as any).mockResolvedValue({ data: {} });
  (apiPatch as any).mockResolvedValue({ data: {} });
  (apiDelete as any).mockResolvedValue({ data: {} });
});

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
      expect(screen.getByText("PI-00002")).toBeTruthy();
    });

    const rows = screen.getAllByRole("row");
    // Row 0 is the table header, Row 1 has Sr. No. 1
    expect(within(rows[1]).getByText("1")).toBeTruthy();
    expect(within(rows[1]).getByText("PI-00002")).toBeTruthy();

    // Standard Companies Pagination component is rendered
    expect(screen.getByText(/showing/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /previous/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /next/i })).toBeTruthy();
  });

  it("includes all SALE parts in nav.ts (Proforma, Sales Process, Discount Payments)", () => {
    const saleSection = NAV_SECTIONS.find((s) => s.label === "SALE");
    expect(saleSection).toBeDefined();

    const saleKeys = saleSection?.items.map((i) => i.key);
    expect(saleKeys).toContain("proforma");
    expect(saleKeys).not.toContain("inquiries");
    expect(saleKeys).toContain("sales-process");
    expect(saleKeys).toContain("discount-payments");
    expect(saleKeys).not.toContain("quotation");

    expect(saleSection?.items.length).toBe(3);
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

  it("allows writing custom text as well as selecting from dropdown for all comboboxes", async () => {
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
    // the sales-person list is loaded from the API
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith("/companies/sales-persons"));
    const spToggle = screen.getByRole("button", { name: /toggle sales person options/i });
    fireEvent.click(spToggle);
    expect(await screen.findByText("Dhairya Shah")).toBeTruthy();
    fireEvent.click(screen.getByText("Dhairya Shah"));
    const spInput = screen.getByLabelText("Sales Person");
    expect((spInput as HTMLInputElement).value).toBe("Dhairya Shah");

    // 3. Payment Terms: type custom terms directly
    const ptInput = screen.getByLabelText("Payment Terms");
    fireEvent.change(ptInput, { target: { value: "70% Advance, 30% on Dispatch" } });
    expect((ptInput as HTMLInputElement).value).toBe("70% Advance, 30% on Dispatch");
  });

  it("renders combobox dropdowns with gray placeholders like Enter Destination and excludes 'Select' from dropdown options", async () => {
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
    expect((deliveryTypeInput as HTMLInputElement).placeholder).toBe("Select Delivery Type");

    // the delivery options are loaded from the database
    await screen.findByDisplayValue("Godown");

    // Open Delivery Type dropdown
    const dtToggle = screen.getByRole("button", { name: /toggle delivery type options/i });
    fireEvent.click(dtToggle);

    const optionsContainer = screen.getByTestId("combobox-options");
    expect(within(optionsContainer).getByText("Door")).toBeTruthy();
    expect(within(optionsContainer).getByText("Godown")).toBeTruthy();
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

  it("handles Product Search autocomplete (from the product master, after a warehouse is chosen) and adds the item", async () => {
    render(
      <BrowserRouter>
        <ProformaInvoicesPage defaultAdd={true} />
      </BrowserRouter>
    );

    // products cannot be searched until a warehouse is selected
    const locked = screen.getByPlaceholderText("Select a warehouse first") as HTMLInputElement;
    expect(locked.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Warehouse"), { target: { value: "Mumbai" } });

    const searchInput = await screen.findByPlaceholderText("Enter Product Name / Model No");
    fireEvent.change(searchInput, { target: { value: "Band" } });

    // Suggestion dropdown appears (data came from /masters/products)
    expect(await screen.findByText("Continuous Band Sealer")).toBeTruthy();

    // Click suggestion to add to table
    fireEvent.click(screen.getByText("Continuous Band Sealer"));

    // Item should now be in table with HSN and the product's own GST%
    expect(screen.getByDisplayValue("Continuous Band Sealer")).toBeTruthy();
    expect(screen.getByDisplayValue("84223000")).toBeTruthy(); // HSN
    expect(screen.getByDisplayValue("18")).toBeTruthy(); // GST % from the master, not a built-in 18
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
    const targetLink = piLinks.find((link) => link.textContent?.includes("PI-0000"));
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

// ----------------------------------------------------------------------------------------------
// Behavior required by the Sales & PI spec
// ----------------------------------------------------------------------------------------------
const renderAdd = () =>
  render(
    <BrowserRouter>
      <ProformaInvoicesPage defaultAdd={true} />
    </BrowserRouter>
  );

const renderList = async () => {
  render(
    <BrowserRouter>
      <ProformaInvoicesPage />
    </BrowserRouter>
  );
  await screen.findByText("PI-00002");
};

const openRowMenu = (rowIndex: number) => {
  const buttons = screen.getAllByRole("button", { name: "⋮" });
  fireEvent.click(buttons[rowIndex]);
};

describe("Add Proforma Invoice: defaults, rules and saving", () => {
  afterEach(() => cleanup());

  it("pre-fills payment terms, transport, delivery type/charge and third-party from the database defaults", async () => {
    renderAdd();
    await waitFor(() => expect((screen.getByLabelText("Payment Terms") as HTMLInputElement).value).toBe("100% Advance"));
    expect((screen.getByLabelText("Transport Name") as HTMLInputElement).value).toBe("Not Sure");
    expect((screen.getByLabelText("Delivery Type") as HTMLInputElement).value).toBe("Godown");
    expect((screen.getByLabelText("Delivery Charge") as HTMLInputElement).value).toBe("To Pay");
    expect((screen.getByLabelText("Third Party Delivery") as HTMLInputElement).value).toBe("No");
  });

  it("hides destination, delivery type and delivery charge when the transport is Self Pick-up", async () => {
    renderAdd();
    await screen.findByDisplayValue("Godown");
    expect(screen.getByLabelText("Delivery Type")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Transport Name"), { target: { value: "Self Pick-up" } });

    expect(screen.queryByLabelText("Delivery Type")).toBeNull();
    expect(screen.queryByLabelText("Delivery Charge")).toBeNull();
    expect(screen.queryByPlaceholderText("Enter Destination")).toBeNull();
  });

  it("shows an error for each missing required field", async () => {
    renderAdd();
    await screen.findByDisplayValue("Godown");
    fireEvent.change(screen.getByLabelText("Payment Terms"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Transport Name"), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

    for (const text of [/warehouse is required/i, /company name is required/i, /payment terms are required/i,
      /transport name is required/i, /billing address is required/i, /shipping address is required/i]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("rejects an expected delivery date in the past", async () => {
    renderAdd();
    await screen.findByDisplayValue("Godown");
    fireEvent.change(screen.getByLabelText("Expected Delivery Date"), { target: { value: "01-01-2020" } });
    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));
    expect(screen.getByText(/cannot be in the past/i)).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("warns when a unit price is below the product's minimum price", async () => {
    renderAdd();
    fireEvent.change(screen.getByLabelText("Warehouse"), { target: { value: "Mumbai" } });
    fireEvent.change(await screen.findByPlaceholderText("Enter Product Name / Model No"), { target: { value: "Band" } });
    fireEvent.click(await screen.findByText("Continuous Band Sealer"));

    expect(screen.queryByText(/below min/i)).toBeNull();

    // unit price input is the one holding the catalogue price (25000)
    fireEvent.change(screen.getByDisplayValue("25000"), { target: { value: "20000" } });

    expect(screen.getByText("Below min ₹25000")).toBeTruthy();
    expect(screen.getByText(/priced below the minimum price/i)).toBeTruthy();
  });

  it("uses the spec formula: taxable = (unit price - unit discount) x quantity", async () => {
    renderAdd();
    fireEvent.change(screen.getByLabelText("Warehouse"), { target: { value: "Mumbai" } });
    fireEvent.change(await screen.findByPlaceholderText("Enter Product Name / Model No"), { target: { value: "Band" } });
    fireEvent.click(await screen.findByText("Continuous Band Sealer"));

    const row = screen.getByDisplayValue("Continuous Band Sealer").closest("tr") as HTMLElement;
    const [qty, price, discount] = within(row).getAllByRole("spinbutton") as HTMLInputElement[];
    fireEvent.change(qty, { target: { value: "2" } });
    fireEvent.change(price, { target: { value: "1000" } });
    fireEvent.change(discount, { target: { value: "100" } });

    // (1000 - 100) x 2 = 1800 taxable, 18% GST = 324, total 2124
    expect(within(row).getByText("1800.00")).toBeTruthy();
    expect(within(row).getByText("324.00")).toBeTruthy();
    expect(within(row).getByText("2124.00")).toBeTruthy();
  });

  it("saves every field to the API and lets the server decide status, totals and author", async () => {
    renderAdd();
    await screen.findByDisplayValue("Godown");
    fireEvent.change(screen.getByLabelText("Warehouse"), { target: { value: "Mumbai" } });
    fireEvent.change(screen.getByPlaceholderText("Enter Customer Name"), { target: { value: "Acme Packaging" } });
    const [billing, shipping] = screen.getAllByPlaceholderText("Enter Address");
    fireEvent.change(billing, { target: { value: "1 Billing Rd" } });
    fireEvent.change(shipping, { target: { value: "2 Shipping Rd" } });
    fireEvent.change(await screen.findByPlaceholderText("Enter Product Name / Model No"), { target: { value: "Band" } });
    fireEvent.click(await screen.findByText("Continuous Band Sealer"));

    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [url, body] = (apiPost as any).mock.calls[0];
    expect(url).toBe("/proforma-invoice");
    expect(body).toMatchObject({
      warehouse: "Mumbai",
      company_name: "Acme Packaging",
      payment_terms: "100% Advance",
      transport_name: "Not Sure",
      delivery_type: "Godown",
      delivery_charge: "To Pay",
      third_party_delivery: "No",
      billing_address: "1 Billing Rd",
      shipping_address: "2 Shipping Rd",
      terms_and_conditions: "Pay within 7 days",
    });
    expect(body.items).toEqual([
      expect.objectContaining({ product_name: "Continuous Band Sealer", hsn_code: "84223000", unit_price: 25000, gst_percent: 18 }),
    ]);
    // server-controlled values are never sent
    for (const key of ["status", "amount_inc_gst", "discount", "created_by"]) expect(body).not.toHaveProperty(key);
    expect(body.items[0]).not.toHaveProperty("uom");
  });

  it("keeps the form open and shows the server's error when saving fails (no made-up invoice)", async () => {
    (apiPost as any).mockRejectedValueOnce(new Error("Warehouse is closed"));
    renderAdd();
    await screen.findByDisplayValue("Godown");
    fireEvent.change(screen.getByLabelText("Warehouse"), { target: { value: "Mumbai" } });
    fireEvent.change(screen.getByPlaceholderText("Enter Customer Name"), { target: { value: "Acme Packaging" } });
    const [billing, shipping] = screen.getAllByPlaceholderText("Enter Address");
    fireEvent.change(billing, { target: { value: "1 Billing Rd" } });
    fireEvent.change(shipping, { target: { value: "2 Shipping Rd" } });
    fireEvent.change(await screen.findByPlaceholderText("Enter Product Name / Model No"), { target: { value: "Band" } });
    fireEvent.click(await screen.findByText("Continuous Band Sealer"));

    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

    expect(await screen.findByText(/Warehouse is closed/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: /add proforma invoice/i })).toBeTruthy(); // still on the form
  });
});

describe("Proforma list: workflow actions follow the database rules and the user's role", () => {
  afterEach(() => cleanup());

  it("a normal user can edit, cancel and delete a pending invoice but not approve it", async () => {
    await renderList();
    openRowMenu(1); // PI-00001 is pending
    expect(screen.getByRole("button", { name: /✏️ Edit/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Cancel$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /🗑️ Delete/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Approve$/ })).toBeNull();
  });

  it("an administrator also sees Approve on a pending invoice, and it is saved through the status API", async () => {
    auth.isSuperAdmin = true;
    await renderList();
    openRowMenu(1);
    fireEvent.click(screen.getByRole("button", { name: /^Approve$/ }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith("/proforma-invoice/pi-001/status", { status: "admin_approved", reason: undefined }));
    // the list is reloaded from the server afterwards (no optimistic local-only change)
    await waitFor(() => expect((apiGet as any).mock.calls.filter((c: any[]) => String(c[0]).startsWith("/proforma-invoice/list")).length).toBeGreaterThan(1));
  });

  it("an approved invoice offers Confirm and Cancel, but no Edit or Delete to a normal user", async () => {
    await renderList();
    openRowMenu(0); // PI-00002 is admin_approved
    expect(screen.getByRole("button", { name: /Confirm & Create SO/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Cancel$/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /✏️ Edit/ })).toBeNull(); // edit is admin-only after approval
    expect(screen.queryByRole("button", { name: /🗑️ Delete/ })).toBeNull();
  });

  it("an administrator may still edit an approved invoice", async () => {
    auth.isSuperAdmin = true;
    await renderList();
    openRowMenu(0);
    expect(screen.getByRole("button", { name: /✏️ Edit/ })).toBeTruthy();
  });

  it("cancelling asks for a reason and sends it with the status change", async () => {
    await renderList();
    openRowMenu(1);
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));

    const dialog = await screen.findByRole("dialog", { name: /reason required/i });
    const confirm = within(dialog).getByRole("button", { name: /^confirm$/i }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // a reason is mandatory

    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Client declined" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith("/proforma-invoice/pi-001/status", { status: "cancelled", reason: "Client declined" })
    );
  });

  it("deleting asks for confirmation and calls the delete API", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderList();
    openRowMenu(1);
    fireEvent.click(screen.getByRole("button", { name: /🗑️ Delete/ }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/proforma-invoice/pi-001"));
    confirmSpy.mockRestore();
  });

  it("shows the server's message when a status change is refused", async () => {
    auth.isSuperAdmin = true;
    (apiPatch as any).mockRejectedValueOnce(new Error("A proforma invoice cannot move from 'pending' to 'confirmed'."));
    await renderList();
    openRowMenu(1);
    fireEvent.click(screen.getByRole("button", { name: /^Approve$/ }));
    expect(await screen.findByText(/cannot move from 'pending' to 'confirmed'/)).toBeTruthy();
  });

  it("Edit opens the saved invoice in the form and saves changes with PATCH", async () => {
    await renderList();
    openRowMenu(1);
    fireEvent.click(screen.getByRole("button", { name: /✏️ Edit/ }));

    expect(await screen.findByRole("heading", { name: /edit proforma invoice/i })).toBeTruthy();
    expect((screen.getByPlaceholderText("Enter Customer Name") as HTMLInputElement).value).toBe("R K Engineering");
    expect((screen.getByLabelText("Payment Terms") as HTMLInputElement).value).toBe("100% Advance");
    expect(screen.getByDisplayValue("Band Sealer")).toBeTruthy();
    expect((screen.getAllByPlaceholderText("Enter Address")[0] as HTMLInputElement).value).toBe("1 Billing Rd");

    fireEvent.change(screen.getByPlaceholderText("Enter Customer Name"), { target: { value: "R K Engineering Pvt Ltd" } });
    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    const [url, body] = (apiPatch as any).mock.calls[0];
    expect(url).toBe("/proforma-invoice/pi-001");
    expect(body.company_name).toBe("R K Engineering Pvt Ltd");
    expect(apiPost).not.toHaveBeenCalled();
  });
});
