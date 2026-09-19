import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { AddAdjustmentOrderPage } from "../AddAdjustmentOrderPage";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock InventoryApi
vi.mock("@/lib/api", () => ({
  InventoryApi: {
    createStockAdjustment: vi.fn().mockResolvedValue({ success: true }),
  },
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
});
