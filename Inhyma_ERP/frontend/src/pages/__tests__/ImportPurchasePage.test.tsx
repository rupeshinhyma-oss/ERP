import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportPurchasePage } from "../purchase/ImportPurchasePage";

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

describe("ImportPurchasePage (/purchase-order/import-purchase-list)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  const renderImportPage = (initialRoute = "/purchase-order/import-purchase-list") => {
    return render(
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/purchase-order/import-purchase-list" element={<ImportPurchasePage defaultAdd={false} />} />
          <Route path="/purchase-order/import-purchase/addedit" element={<ImportPurchasePage defaultAdd={true} />} />
          <Route path="/purchase-order/import-purchase/addedit/:id" element={<ImportPurchasePage defaultAdd={true} />} />
          <Route path="/purchase/import" element={<ImportPurchasePage defaultAdd={false} />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it("renders page title Import Purchase and top action buttons matching production screenshot", () => {
    renderImportPage();

    expect(screen.getByRole("heading", { name: "Import Purchase" })).toBeTruthy();
    expect(screen.getByTestId("btn-filter-toggle")).toBeTruthy();
    expect(screen.getByTestId("btn-add-new")).toBeTruthy();
    expect(screen.getByText("ADD NEW")).toBeTruthy();
    expect(screen.getByTestId("btn-export")).toBeTruthy();
    expect(screen.getByText("Export")).toBeTruthy();
  });

  it("renders all 5 KPI summary cards with authentic metrics matching production screenshot", () => {
    renderImportPage();

    // ALL
    const allCard = screen.getByTestId("kpi-card-all");
    expect(within(allCard).getByText("ALL")).toBeTruthy();
    expect(within(allCard).getByText(/₹ 24,81,84,798.00 \(66\)/i)).toBeTruthy();

    // PENDING
    const pendingCard = screen.getByTestId("kpi-card-pending");
    expect(within(pendingCard).getByText("PENDING")).toBeTruthy();
    expect(within(pendingCard).getByText(/₹ 4,92,08,413.90 \(23\)/i)).toBeTruthy();

    // CONFIRMED
    const confirmedCard = screen.getByTestId("kpi-card-confirmed");
    expect(within(confirmedCard).getByText("CONFIRMED")).toBeTruthy();
    expect(within(confirmedCard).getByText(/₹ 0.00 \(0\)/i)).toBeTruthy();

    // RECEIVED
    const receivedCard = screen.getByTestId("kpi-card-received");
    expect(within(receivedCard).getByText("RECEIVED")).toBeTruthy();
    expect(within(receivedCard).getByText(/₹ 19,52,33,923.54 \(42\)/i)).toBeTruthy();

    // CLOSED
    const closedCard = screen.getByTestId("kpi-card-closed");
    expect(within(closedCard).getByText("CLOSED")).toBeTruthy();
    expect(within(closedCard).getByText(/₹ 37,42,460.56 \(1\)/i)).toBeTruthy();
  });

  it("renders 5 status tabs with counts and filters table when tab clicked", () => {
    renderImportPage();

    expect(screen.getByTestId("tab-all")).toBeTruthy();
    expect(screen.getByText("All (66)")).toBeTruthy();
    expect(screen.getByTestId("tab-pending")).toBeTruthy();
    expect(screen.getByText("Pending (23)")).toBeTruthy();
    expect(screen.getByTestId("tab-confirmed")).toBeTruthy();
    expect(screen.getByText("Confirmed (0)")).toBeTruthy();
    expect(screen.getByTestId("tab-received")).toBeTruthy();
    expect(screen.getByText("Received (42)")).toBeTruthy();
    expect(screen.getByTestId("tab-closed")).toBeTruthy();
    expect(screen.getByText("Closed (1)")).toBeTruthy();

    // Click Closed tab
    fireEvent.click(screen.getByTestId("tab-closed"));
    expect(screen.getByText("MUM-CLS-01")).toBeTruthy();
    expect(screen.getByText(/Showing 1 To 1 Of 1 Entries/i)).toBeTruthy();

    // Return to All tab
    fireEvent.click(screen.getByTestId("tab-all"));
    expect(screen.getByText("MUM51")).toBeTruthy();
  });

  it("renders exact table header columns matching screenshot", () => {
    renderImportPage();

    expect(screen.getByRole("columnheader", { name: /^Inv. \/ Con. No & Date/i })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /^Supplier/i })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /^Warehouse/i })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /^Ordered Date/i })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "ETD Origin Date" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "ETA Port Date" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Arrival Date" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Inv. Total ($)" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Inv. Total (₹)" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Total CBM" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Total Exp" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "% Loading Exp(VB)" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Loading Exp(CB)(₹)" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Gross Total Landing(₹)" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Created By" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Invoice" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /^Updated Date/i })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /^Status/i })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Action" })).toBeTruthy();
  });

  it("renders initial consignments from screenshot", () => {
    renderImportPage();

    expect(screen.getByText("MUM51")).toBeTruthy();
    expect(screen.getByText("MUM50")).toBeTruthy();
    expect(screen.getByText("MUM49")).toBeTruthy();
    expect(screen.getByText("GJ14")).toBeTruthy();
    expect(screen.getByText("MUM45")).toBeTruthy();
    expect(screen.getByText("MUM46")).toBeTruthy();
    expect(screen.getByText("MUM47")).toBeTruthy();
    expect(screen.getByText("MP05")).toBeTruthy();
    expect(screen.getByText("GJ13")).toBeTruthy();

    expect(screen.getAllByText("Yinglima").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mumbai Ordered").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Akshata Wadekar").length).toBeGreaterThan(0);
    expect(screen.getAllByText("19-09-2026").length).toBeGreaterThan(0);
  });

  it("filters consignments using the search input", () => {
    renderImportPage();

    const searchInput = screen.getByPlaceholderText("Search...");
    fireEvent.change(searchInput, { target: { value: "GJ14" } });

    expect(screen.getByText("GJ14")).toBeTruthy();
    expect(screen.queryByText("MUM51")).toBeNull();
    expect(screen.getByText(/Showing 1 To 1 Of 1 Entries/i)).toBeTruthy();
  });

  it("toggles filter panel when clicking the funnel button", () => {
    renderImportPage();

    expect(screen.queryByTestId("filter-panel")).toBeNull();

    const filterBtn = screen.getByTestId("btn-filter-toggle");
    fireEvent.click(filterBtn);

    const filterPanel = screen.getByTestId("filter-panel");
    expect(filterPanel).toBeTruthy();
    expect(within(filterPanel).getByText("Warehouse")).toBeTruthy();
    expect(within(filterPanel).getByText("Supplier")).toBeTruthy();
  });

  it("opens details modal when clicking on consignment link and closes on Escape", () => {
    renderImportPage();

    const conBtn = screen.getByText("MUM51");
    fireEvent.click(conBtn);

    const modal = screen.getByTestId("import-purchase-details-modal");
    expect(modal).toBeTruthy();
    expect(within(modal).getByText("Import Purchase Details")).toBeTruthy();
    expect(within(modal).getByText("Order Detail")).toBeTruthy();
    expect(within(modal).getByText("From")).toBeTruthy();
    expect(within(modal).getByText("To")).toBeTruthy();
    expect(within(modal).getByText("Expenses")).toBeTruthy();
    expect(within(modal).getByText("Product Summary")).toBeTruthy();
    expect(within(modal).getByText("ISL350XDAN Flow Wrap Machine W/O End Seal Chain")).toBeTruthy();
    expect(within(modal).getByText("Grand Total")).toBeTruthy();
    expect(within(modal).getByText("53.82")).toBeTruthy();
    expect(within(modal).getByText("$ 24.00")).toBeTruthy();
    expect(within(modal).getByText("₹ 191.00")).toBeTruthy();

    // Close on Escape
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("import-purchase-details-modal")).toBeNull();
  });

  it("renders Action menu with Edit and Download Purchase for Received orders and opens PDF viewer", () => {
    const originalOpen = window.open;
    window.open = vi.fn();

    renderImportPage();

    // Switch to Received tab
    fireEvent.click(screen.getByTestId("tab-received"));

    // First received order is imp-rec-1
    const actionBtn = screen.getByTestId("btn-action-imp-rec-1");
    fireEvent.click(actionBtn);

    const menu = screen.getByTestId("action-menu-imp-rec-1");
    expect(menu).toBeTruthy();

    expect(screen.getByTestId("action-edit-imp-rec-1")).toBeTruthy();
    expect(screen.getByText("Edit")).toBeTruthy();

    const downloadBtn = screen.getByTestId("action-download-imp-rec-1");
    expect(downloadBtn).toBeTruthy();
    expect(screen.getByText("Download Purchase")).toBeTruthy();

    fireEvent.click(downloadBtn);

    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining("/purchase-order/import-bill-file/REC-YG-1"),
      "_blank"
    );

    window.open = originalOpen;
  });

  it("renders Action menu with Edit, Confirm, and Delete for Pending orders", () => {
    renderImportPage();

    // MUM51 is imp-51 and starts as Pending
    const actionBtn = screen.getByTestId("btn-action-imp-51");
    fireEvent.click(actionBtn);

    const menu = screen.getByTestId("action-menu-imp-51");
    expect(menu).toBeTruthy();

    expect(screen.getByTestId("action-edit-imp-51")).toBeTruthy();
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.getByTestId("action-confirm-imp-51")).toBeTruthy();
    expect(screen.getByText("Confirm")).toBeTruthy();
    expect(screen.getByTestId("action-delete-imp-51")).toBeTruthy();
    expect(screen.getByText("Delete")).toBeTruthy();
    expect(screen.queryByTestId("action-download-imp-51")).toBeNull();
  });

  it("clicking Delete from Pending Action menu removes order upon confirmation", () => {
    const originalConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(true);

    renderImportPage();

    expect(screen.getByText("MUM51")).toBeTruthy();

    const actionBtn = screen.getByTestId("btn-action-imp-51");
    fireEvent.click(actionBtn);

    const deleteBtn = screen.getByTestId("action-delete-imp-51");
    fireEvent.click(deleteBtn);

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("MUM51")
    );
    expect(screen.queryByText("MUM51")).toBeNull();

    window.confirm = originalConfirm;
  });

  it("clicking Confirm changes order status from Pending to Confirmed and subsequently shows Download Purchase", () => {
    renderImportPage();

    const actionBtn = screen.getByTestId("btn-action-imp-51");
    fireEvent.click(actionBtn);

    const confirmBtn = screen.getByTestId("action-confirm-imp-51");
    fireEvent.click(confirmBtn);

    // Menu closes
    expect(screen.queryByTestId("action-menu-imp-51")).toBeNull();

    // Clicking action button on imp-51 again now shows Edit and Download Purchase
    fireEvent.click(actionBtn);
    expect(screen.getByTestId("action-download-imp-51")).toBeTruthy();
    expect(screen.getByTestId("action-edit-imp-51")).toBeTruthy();
    expect(screen.queryByTestId("action-confirm-imp-51")).toBeNull();
    expect(screen.queryByTestId("action-delete-imp-51")).toBeNull();
  });

  it("clicking Edit from Pending Action menu opens Add/Edit view pre-populated with data", () => {
    renderImportPage();

    const actionBtn = screen.getByTestId("btn-action-imp-51");
    fireEvent.click(actionBtn);

    const editBtn = screen.getByTestId("action-edit-imp-51");
    fireEvent.click(editBtn);

    expect(screen.getByRole("heading", { name: "Edit Import Purchase" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "← BACK" })).toBeTruthy();

    const conInput = screen.getByPlaceholderText("e.g. MUM52");
    expect((conInput as HTMLInputElement).value).toBe("MUM51");
  });

  it("navigates to Add Import Purchase form on ADD NEW click and submits", async () => {
    renderImportPage();

    const addBtn = screen.getByTestId("btn-add-new");
    fireEvent.click(addBtn);

    expect(screen.getByRole("heading", { name: "Add Import Purchase" })).toBeTruthy();

    // Fill consignment no
    const conInput = screen.getByPlaceholderText("e.g. MUM52");
    fireEvent.change(conInput, { target: { value: "MUM99" } });

    // Fill USD total
    const usdInput = screen.getByPlaceholderText("e.g. 42500");
    fireEvent.change(usdInput, { target: { value: "50000" } });

    // Submit
    const submitBtn = screen.getByRole("button", { name: "Submit Consignment" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Import Purchase" })).toBeTruthy();
    });

    expect(screen.getByText("MUM99")).toBeTruthy();
  });

  it("triggers file download when clicking Export button", () => {
    const createElementSpy = vi.spyOn(document, "createElement");

    renderImportPage();

    const exportBtn = screen.getByTestId("btn-export");
    fireEvent.click(exportBtn);

    expect(createElementSpy).toHaveBeenCalledWith("a");
    createElementSpy.mockRestore();
  });
});
