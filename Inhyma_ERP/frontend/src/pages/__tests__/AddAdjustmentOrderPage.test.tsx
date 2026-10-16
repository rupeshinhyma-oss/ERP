import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { AddAdjustmentOrderPage } from "../AddAdjustmentOrderPage";
import { InventoryApi } from "@/lib/api";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mockNavigate,
}));

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock InventoryApi and apiGet
vi.mock("@/lib/api", () => ({
  InventoryApi: {
    createStockAdjustment: vi.fn().mockResolvedValue({ success: true }),
    listProductStock: vi.fn().mockResolvedValue({ data: { items: [] } }),
  },
  // client names come from the company master (/companies/lookup)
  apiGet: vi.fn().mockImplementation((url: string) =>
    Promise.resolve({
      success: true,
      data: url.startsWith("/companies/lookup")
        ? [
          { id: "c1", company_name: "Cirkla Technologies Pvt Ltd" },
          { id: "c2", company_name: "Apex Valves & Automation India Pvt Ltd" },
        ]
        : [],
    })
  ),
}));

describe("AddAdjustmentOrderPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders exact page title and BACK button matching legacy ERP screenshot", () => {
    render(
      <BrowserRouter>
        <AddAdjustmentOrderPage />
      </BrowserRouter>
    );

    expect(screen.getByRole("heading", { name: "Add Adjustment Order" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "← BACK" })).toBeTruthy();
  });

  it("renders all form fields matching legacy ERP screenshot", () => {
    render(
      <BrowserRouter>
        <AddAdjustmentOrderPage />
      </BrowserRouter>
    );

    expect(screen.getByLabelText("Adjustment Type")).toBeTruthy();
    expect(screen.getByLabelText(/Purpose/i)).toBeTruthy();
    expect(screen.getByLabelText("Warehouse")).toBeTruthy();
    expect(screen.getByLabelText("Client Name")).toBeTruthy();
    expect(screen.getByLabelText("Invoice No")).toBeTruthy();
    expect(screen.getByLabelText("Remark")).toBeTruthy();
    expect(screen.getByText("PRODUCT SEARCH")).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter Product Name / Model No")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
  });

  it("shows warning when warehouse is not selected before product search", () => {
    render(
      <BrowserRouter>
        <AddAdjustmentOrderPage />
      </BrowserRouter>
    );

    expect(screen.getByText("Please Select Warehouse First.")).toBeTruthy();
    const searchInput = screen.getByPlaceholderText("Enter Product Name / Model No") as HTMLInputElement;
    expect(searchInput.disabled).toBe(true);
  });

  it("enables product search after selecting a warehouse", () => {
    render(
      <BrowserRouter>
        <AddAdjustmentOrderPage />
      </BrowserRouter>
    );

    const warehouseSelect = screen.getByLabelText("Warehouse");
    fireEvent.change(warehouseSelect, { target: { value: "Ahmedabad" } });

    expect(screen.queryByText("Please Select Warehouse First.")).toBeNull();
    const searchInput = screen.getByPlaceholderText("Enter Product Name / Model No") as HTMLInputElement;
    expect(searchInput.disabled).toBe(false);
  });

  it("displays product table with columns and initial Grand Total 0.00", () => {
    render(
      <BrowserRouter>
        <AddAdjustmentOrderPage />
      </BrowserRouter>
    );

    expect(screen.getByRole("columnheader", { name: "Product Name" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Available Qty" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Qty" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Unit Price" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Total Price" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Action" })).toBeTruthy();
    expect(screen.getByText("Grand Total")).toBeTruthy();
    expect(screen.getByText("0.00")).toBeTruthy();
  });

  it("extracts and displays matching companies when typing letters in Client Name for Stock IN and Stock OUT", async () => {
    render(
      <BrowserRouter>
        <AddAdjustmentOrderPage />
      </BrowserRouter>
    );

    const clientInput = screen.getByPlaceholderText("Enter Client Name") as HTMLInputElement;

    // Focus opens dropdown with companies
    fireEvent.focus(clientInput);
    expect(await screen.findByRole("option", { name: "Cirkla Technologies Pvt Ltd" })).toBeTruthy();

    // Type letters to filter
    fireEvent.change(clientInput, { target: { value: "Apex" } });
    const suggestion = await screen.findByRole("option", { name: "Apex Valves & Automation India Pvt Ltd" });
    expect(suggestion).toBeTruthy();

    // Click on suggestion to select
    fireEvent.click(suggestion);
    expect(clientInput.value).toBe("Apex Valves & Automation India Pvt Ltd");

    // Change to Stock OUT and verify client name is retained and accessible
    const adjTypeSelect = screen.getByLabelText("Adjustment Type") as HTMLSelectElement;
    fireEvent.change(adjTypeSelect, { target: { value: "Stock OUT" } });
    expect(adjTypeSelect.value).toBe("Stock OUT");
    expect(clientInput.value).toBe("Apex Valves & Automation India Pvt Ltd");
  });

  /** Fill the form with one product from the page's built-in test catalogue so it can be submitted. */
  async function fillValidForm() {
    render(
      <BrowserRouter>
        <AddAdjustmentOrderPage />
      </BrowserRouter>
    );
    const selects = Array.from(document.querySelectorAll("select"));
    fireEvent.change(selects[1], { target: { value: Array.from(selects[1].options).find((o) => o.textContent?.startsWith("Split"))!.value } });
    fireEvent.change(selects[2], { target: { value: Array.from(selects[2].options).find((o) => o.textContent?.startsWith("Mumbai"))!.value } });
    const search = screen.getByPlaceholderText("Enter Product Name / Model No");
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "Limit Switch" } });
    const hit = await screen.findAllByText(/Limit Switch \(DQL5545\)/);
    fireEvent.click(hit[hit.length - 1]);
  }

  it("shows the server's refusal, stays on the page and saves nothing locally when the adjustment is refused", async () => {
    (InventoryApi.createStockAdjustment as any).mockRejectedValueOnce(
      new Error("Not enough stock of 'Limit Switch (DQL5545)' in Mumbai (available 5, needed 9). Physical warehouses cannot go negative.")
    );
    await fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText(/Physical warehouses cannot go negative/)).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(localStorage.getItem("local_stock_adjustments")).toBeNull();
  });

  it("goes back to the list only after the server has recorded the adjustment", async () => {
    (InventoryApi.createStockAdjustment as any).mockResolvedValueOnce({ success: true });
    await fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/stock-adjustment"));
    expect(InventoryApi.createStockAdjustment).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("local_stock_adjustments")).toBeNull();
  });
});