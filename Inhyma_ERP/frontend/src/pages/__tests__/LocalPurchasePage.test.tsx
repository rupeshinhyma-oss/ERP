import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalPurchasePage } from "../purchase/LocalPurchasePage";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

// Mock API
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: null }),
  apiPost: vi.fn().mockResolvedValue({ data: { success: true } }),
  errorMessage: vi.fn((err) => String(err)),
}));

describe("LocalPurchasePage (/purchase-order/list and /purchase-order/addedit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  const renderPurchasePage = (initialRoute = "/purchase-order/list") => {
    return render(
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/purchase-order/list" element={<LocalPurchasePage defaultAdd={false} />} />
          <Route path="/purchase-order/addedit" element={<LocalPurchasePage defaultAdd={true} />} />
          <Route path="/purchase-order/addedit/:id" element={<LocalPurchasePage defaultAdd={true} />} />
          <Route path="/purchase-order/add" element={<LocalPurchasePage defaultAdd={true} />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it("renders page title Local Purchase and top action buttons matching production screenshot", () => {
    renderPurchasePage();

    // Title
    expect(screen.getByRole("heading", { name: "Local Purchase" })).toBeTruthy();

    // Action buttons
    expect(screen.getByTestId("btn-add-new")).toBeTruthy();
    expect(screen.getByText("+ ADD NEW")).toBeTruthy();
    expect(screen.getByTestId("btn-export")).toBeTruthy();
    expect(screen.getByText("Export")).toBeTruthy();
  });

  it("renders toolbar with Items/Page dropdown and Search... input", () => {
    renderPurchasePage();

    expect(screen.getByText("Items/Page")).toBeTruthy();
    const select = screen.getByRole("combobox", { name: /items per page/i });
    expect(select).toBeTruthy();
    expect((select as HTMLSelectElement).value).toBe("50");

    const searchInput = screen.getByPlaceholderText("Search...");
    expect(searchInput).toBeTruthy();
  });

  it("renders exact table header columns matching the production screenshot", () => {
    renderPurchasePage();

    expect(screen.getByRole("columnheader", { name: /^Invoice ⇅/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /^Supplier ⇅/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /^Warehouse ⇅/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /^Invoice Total Value/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Created By" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /^Added On ⇅/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /^Status/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Action" })).toBeTruthy();
  });

  it("renders authentic initial records, status pills, and pagination footer matching screenshot", () => {
    renderPurchasePage();

    // Sample records from screenshot
    expect(screen.getByText("2026-27/SO/1534")).toBeTruthy();
    expect(screen.getAllByText("S B Inks & Packaging Co.").length).toBeGreaterThan(0);
    expect(screen.getByText("₹ 4,99,730.00")).toBeTruthy();
    expect(screen.getByText("Pending")).toBeTruthy();

    expect(screen.getByText("752/26-27")).toBeTruthy();
    expect(screen.getAllByText("Darsh Impex India LLP Mumbai").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);

    expect(screen.getByText("GST-436/26-27")).toBeTruthy();
    expect(screen.getAllByText("GLOBAL IMPEX MACHINERY").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ahmedabad").length).toBeGreaterThan(0);

    // Footer
    expect(screen.getByText(/Showing 1 To 12 Of 12 Entries/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
  });

  it("filters purchase records when typing in search box", () => {
    renderPurchasePage();

    const searchInput = screen.getByPlaceholderText("Search...");
    fireEvent.change(searchInput, { target: { value: "GLOBAL IMPEX" } });

    expect(screen.getAllByText("GLOBAL IMPEX MACHINERY").length).toBeGreaterThan(0);
    expect(screen.queryByText("2026-27/SO/1534")).toBeNull();
    expect(screen.getByText(/Showing 1 To 3 Of 3 Entries/i)).toBeTruthy();
  });

  it("opens Local Purchase Details modal when clicking on an invoice link matching screenshot media_1790064280588.png", () => {
    renderPurchasePage();

    const invoiceBtn = screen.getByText("2026-27/SO/1534");
    fireEvent.click(invoiceBtn);

    // Modal popup is rendered
    const modal = screen.getByTestId("local-purchase-details-modal");
    expect(modal).toBeTruthy();

    const modalScope = within(modal);
    expect(modalScope.getByRole("heading", { name: "Local Purchase Details" })).toBeTruthy();

    // Sections
    expect(modalScope.getByText("Order Detail")).toBeTruthy();
    expect(modalScope.getByText("From")).toBeTruthy();
    expect(modalScope.getByText("To")).toBeTruthy();
    expect(modalScope.getByText("Akshata Wadekar")).toBeTruthy();
    expect(modalScope.getByText("INHYMA SOLUTIONS LLP (M)")).toBeTruthy();
    expect(modalScope.getByText("Expenses")).toBeTruthy();
    expect(modalScope.getByText("Product Summary")).toBeTruthy();

    // Products in table
    expect(modalScope.getByText("G43 Online Printer TIJ 4.3")).toBeTruthy();
    expect(modalScope.getByText("XF12.7 Handy Printer Fiber Body 12.7mm")).toBeTruthy();
    expect(modalScope.getByText("50")).toBeTruthy();
    expect(modalScope.getByText("30")).toBeTruthy();
    expect(modalScope.getAllByText("₹ 6,400.00").length).toBe(2);
    expect(modalScope.getAllByText("₹ 3,450.00").length).toBe(2);
    expect(modalScope.getByText("₹ 3,20,000.00")).toBeTruthy();
    expect(modalScope.getByText("₹ 1,03,500.00")).toBeTruthy();
    expect(modalScope.getAllByText("₹ 4,23,500.00").length).toBeGreaterThan(0);

    // Close modal via ✕ button
    const closeBtn = modalScope.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);
    expect(screen.queryByTestId("local-purchase-details-modal")).toBeNull();
  });

  it("closes Local Purchase Details modal when Escape key is pressed", () => {
    renderPurchasePage();

    const invoiceBtn = screen.getByText("2026-27/SO/1534");
    fireEvent.click(invoiceBtn);

    expect(screen.getByTestId("local-purchase-details-modal")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("local-purchase-details-modal")).toBeNull();
  });

  it("opens Bill File PDF when clicking the bill file download icon in details modal", () => {
    const originalOpen = window.open;
    window.open = vi.fn();

    renderPurchasePage();

    const invoiceBtn = screen.getByText("2026-27/SO/1534");
    fireEvent.click(invoiceBtn);

    const billFileBtn = screen.getByTestId("btn-bill-file-pdf");
    expect(billFileBtn).toBeTruthy();

    fireEvent.click(billFileBtn);
    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining("/purchase-order/bill-file/"),
      "_blank"
    );

    window.open = originalOpen;
  });

  it("navigates to Add Local Purchase form on + ADD NEW click, with all fields matching media_1790063052113.png", () => {
    renderPurchasePage();

    const addBtn = screen.getByTestId("btn-add-new");
    fireEvent.click(addBtn);

    // Header
    expect(screen.getByRole("heading", { name: "Add Local Purchase" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "← BACK" })).toBeTruthy();

    // General Details Card
    expect(screen.getByText("Warehouse")).toBeTruthy();
    expect(screen.getByText("Supplier")).toBeTruthy();
    expect(screen.getByText("Invoice No.")).toBeTruthy();
    expect(screen.getByText("Invoice Date")).toBeTruthy();
    expect(screen.getByText(/Invoice Total Value \(INR\) \(Basic Without GST\)/i)).toBeTruthy();
    expect(screen.getByText(/Invoice Total Value \(INR\) \(Including GST\)/i)).toBeTruthy();
    expect(screen.getByText("Bill File")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose File" })).toBeTruthy();

    // EXPENSES Card
    expect(screen.getByText("EXPENSES")).toBeTruthy();
    expect(screen.getByText("Packing & Forwarding")).toBeTruthy();
    expect(screen.getByText("Transport")).toBeTruthy();
    expect(screen.getByText("Offloading")).toBeTruthy();
    expect(screen.getByText("Total Of All Expenses")).toBeTruthy();
    expect(screen.getByText("% Loading Expense (Value Based)")).toBeTruthy();

    // PRODUCT SEARCH Card
    expect(screen.getByText("PRODUCT SEARCH")).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter Product Name / Model No")).toBeTruthy();

    // PRODUCT ITEM Card
    expect(screen.getByText("PRODUCT ITEM")).toBeTruthy();
    expect(screen.getByText("Unit Landing Rate (VB)")).toBeTruthy();
    expect(screen.getByText("Total Landing Rate (VB)")).toBeTruthy();
    expect(screen.getByText("Grand Total")).toBeTruthy();
    expect(screen.getByText("Remarks")).toBeTruthy();
    expect(screen.getByPlaceholderText("Make all cheque payable to USER")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
  });

  it("fills Add Local Purchase form, adds product item, recalculates landed cost, and submits", async () => {
    renderPurchasePage("/purchase-order/addedit");

    // Select Warehouse
    const warehouseSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(warehouseSelect, { target: { value: "Mumbai" } });

    // Select Supplier
    const supplierSelect = screen.getAllByRole("combobox")[1];
    fireEvent.change(supplierSelect, { target: { value: "Darsh Impex India LLP Mumbai" } });

    // Invoice No
    const invoiceInput = screen.getByText("Invoice No.").parentElement?.querySelector("input");
    expect(invoiceInput).toBeTruthy();
    fireEvent.change(invoiceInput!, { target: { value: "2026-27/PO/9999" } });

    // Basic & Total Value
    const basicInput = screen.getByText(/Basic Without GST/i).parentElement?.querySelector("input");
    expect(basicInput).toBeTruthy();
    fireEvent.change(basicInput!, { target: { value: "50000" } });

    const totalInput = screen.getByText(/Including GST/i).parentElement?.querySelector("input");
    expect(totalInput).toBeTruthy();
    fireEvent.change(totalInput!, { target: { value: "59000" } });

    // Transport expense (₹ 1000)
    const transportInput = screen.getByText("Transport").parentElement?.querySelector("input");
    expect(transportInput).toBeTruthy();
    fireEvent.change(transportInput!, { target: { value: "1000" } });

    // Product search autocomplete
    const searchInput = screen.getByPlaceholderText("Enter Product Name / Model No");
    fireEvent.change(searchInput, { target: { value: "Continuous Band" } });

    // Click suggestion
    const suggestion = await screen.findByText(/Continuous Band Sealer/i);
    fireEvent.click(suggestion);

    // Verify item row added
    expect(screen.getAllByDisplayValue("Continuous Band Sealer").length).toBeGreaterThan(0);

    // Change quantity to 2
    const qtyInput = screen.getByDisplayValue("1");
    fireEvent.change(qtyInput, { target: { value: "2" } });

    // Click Submit
    const submitBtn = screen.getByRole("button", { name: "Submit" });
    fireEvent.click(submitBtn);

    // After submit, returns to Local Purchase list table with new record
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Local Purchase" })).toBeTruthy();
    });

    expect(screen.getByText("2026-27/PO/9999")).toBeTruthy();
    expect(screen.getAllByText("Darsh Impex India LLP Mumbai").length).toBeGreaterThan(0);
  });

  it("opens DatePicker calendar dropdown when clicking Invoice Date input and selects a date", () => {
    renderPurchasePage("/purchase-order/addedit");

    const dateInput = screen.getByLabelText("Invoice Date");
    expect(dateInput).toBeTruthy();
    expect((dateInput as HTMLInputElement).value).toBe("22-09-2026");

    // Click input to open calendar dropdown matching media_1790063310156.png
    fireEvent.click(dateInput);

    const dropdown = screen.getByTestId("datepicker-dropdown");
    expect(dropdown).toBeTruthy();
    expect(screen.getByText(/SEPTEMBER 2026/i)).toBeTruthy();
    expect(screen.getByText("SU")).toBeTruthy();
    expect(screen.getByText("MO")).toBeTruthy();

    // Click day 15
    const day15 = screen.getByRole("button", { name: "15" });
    fireEvent.click(day15);

    // Dropdown closes and input updates
    expect(screen.queryByTestId("datepicker-dropdown")).toBeNull();
    expect((dateInput as HTMLInputElement).value).toBe("15-09-2026");
  });

  it("returns to purchase list when ← BACK button is clicked in Add Local Purchase view", async () => {
    renderPurchasePage("/purchase-order/addedit");

    expect(screen.getByRole("heading", { name: "Add Local Purchase" })).toBeTruthy();

    const backBtn = screen.getByRole("button", { name: "← BACK" });
    fireEvent.click(backBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Local Purchase" })).toBeTruthy();
    });
  });

  it("renders Action menu with Download Purchase for Confirmed orders matching screenshot 1 and opens bill file PDF", () => {
    const originalOpen = window.open;
    window.open = vi.fn();

    renderPurchasePage();

    // Order 752/26-27 is 'po-2' and has status 'Confirmed'
    const actionBtn = screen.getByTestId("btn-action-po-2");
    expect(actionBtn).toBeTruthy();

    // Click Action button on Confirmed row
    fireEvent.click(actionBtn);

    // Menu should be open
    const menu = screen.getByTestId("action-menu-po-2");
    expect(menu).toBeTruthy();

    // Confirmed row has 'Edit' and 'Download Purchase' options
    const downloadBtn = screen.getByTestId("action-download-po-2");
    expect(downloadBtn).toBeTruthy();
    expect(screen.getByText("Download Purchase")).toBeTruthy();
    expect(screen.getByTestId("action-edit-po-2")).toBeTruthy();
    expect(screen.queryByTestId("action-confirm-po-2")).toBeNull();
    expect(screen.queryByTestId("action-delete-po-2")).toBeNull();

    // Click Download Purchase
    fireEvent.click(downloadBtn);

    // Expect window.open to be called targeting /purchase-order/bill-file/...
    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining("/purchase-order/bill-file/752%2F26-27"),
      "_blank"
    );

    // Menu should close
    expect(screen.queryByTestId("action-menu-po-2")).toBeNull();

    window.open = originalOpen;
  });

  it("renders Action menu with Edit, Confirm, and Delete for Pending orders matching screenshot 2", () => {
    renderPurchasePage();

    // Order 2026-27/SO/1534 is 'po-1' and has status 'Pending'
    const actionBtn = screen.getByTestId("btn-action-po-1");
    expect(actionBtn).toBeTruthy();

    // Click Action button on Pending row
    fireEvent.click(actionBtn);

    // Menu should be open
    const menu = screen.getByTestId("action-menu-po-1");
    expect(menu).toBeTruthy();

    // Pending row must have 'Edit', 'Confirm', and 'Delete' options, NOT 'Download Purchase'
    expect(screen.getByTestId("action-edit-po-1")).toBeTruthy();
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.getByTestId("action-confirm-po-1")).toBeTruthy();
    expect(screen.getByText("Confirm")).toBeTruthy();
    expect(screen.getByTestId("action-delete-po-1")).toBeTruthy();
    expect(screen.getByText("Delete")).toBeTruthy();
    expect(screen.queryByTestId("action-download-po-1")).toBeNull();
  });

  it("clicking Confirm changes order status from Pending to Confirmed and subsequently shows Edit and Download Purchase", () => {
    renderPurchasePage();

    // Order 2026-27/SO/1534 starts as Pending
    expect(screen.getByText("Pending")).toBeTruthy();

    const actionBtn = screen.getByTestId("btn-action-po-1");
    fireEvent.click(actionBtn);

    const confirmBtn = screen.getByTestId("action-confirm-po-1");
    fireEvent.click(confirmBtn);

    // Menu closes
    expect(screen.queryByTestId("action-menu-po-1")).toBeNull();

    // Status is now Confirmed (Pending text is gone)
    expect(screen.queryByText("Pending")).toBeNull();

    // Now clicking Action button on po-1 must show 'Edit' and 'Download Purchase'
    fireEvent.click(actionBtn);
    expect(screen.getByTestId("action-download-po-1")).toBeTruthy();
    expect(screen.getByTestId("action-edit-po-1")).toBeTruthy();
    expect(screen.queryByTestId("action-confirm-po-1")).toBeNull();
    expect(screen.queryByTestId("action-delete-po-1")).toBeNull();
  });

  it("clicking Edit from Pending Action menu opens edit view pre-populated with order details", () => {
    renderPurchasePage();

    const actionBtn = screen.getByTestId("btn-action-po-1");
    fireEvent.click(actionBtn);

    const editBtn = screen.getByTestId("action-edit-po-1");
    fireEvent.click(editBtn);

    // Form opens in Edit mode
    expect(screen.getByRole("heading", { name: "Add Local Purchase" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "← BACK" })).toBeTruthy();

    // Form is pre-populated with order 2026-27/SO/1534 data
    const invoiceInput = screen.getByText("Invoice No.").parentElement?.querySelector("input");
    expect((invoiceInput as HTMLInputElement).value).toBe("2026-27/SO/1534");

    const supplierSelect = screen.getAllByRole("combobox")[1];
    expect((supplierSelect as HTMLSelectElement).value).toBe("S B Inks & Packaging Co.");

    const warehouseSelect = screen.getAllByRole("combobox")[0];
    expect((warehouseSelect as HTMLSelectElement).value).toBe("Mumbai");

    // Items are pre-populated
    expect(screen.getByDisplayValue("G43 Online Printer TIJ 4.3")).toBeTruthy();
    expect(screen.getByDisplayValue("XF12.7 Handy Printer Fiber Body 12.7mm")).toBeTruthy();
  });

  it("closes Action menu when clicking outside the menu container", () => {
    renderPurchasePage();

    const actionBtn = screen.getByTestId("btn-action-po-1");
    fireEvent.click(actionBtn);

    expect(screen.getByTestId("action-menu-po-1")).toBeTruthy();

    // Click outside
    fireEvent.mouseDown(document.body);

    expect(screen.queryByTestId("action-menu-po-1")).toBeNull();
  });
});
