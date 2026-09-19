import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { AddTransferOrderPage } from "../AddTransferOrderPage";
import { StockTransferPage } from "../StockTransferPage";

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
    listStockTransfers: vi.fn().mockResolvedValue({
      data: {
        items: [],
        total: 0,
        tab_counts: { all: 0, pending: 0, confirmed: 0, received: 0, cancel: 0 },
      },
      status: 200,
      success: true,
    }),
    createStockTransfer: vi.fn().mockResolvedValue({
      data: { id: "trf-123" },
      status: 201,
      success: true,
    }),
  },
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("AddTransferOrderPage", () => {
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
        <AddTransferOrderPage />
      </BrowserRouter>
    );

    expect(screen.getByRole("heading", { name: "Add Transfer Order" })).toBeTruthy();
    const backBtn = screen.getByRole("button", { name: "← BACK" });
    expect(backBtn).toBeTruthy();

    fireEvent.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/transfer/list");
  });

  it("renders all form fields matching legacy ERP screenshot erp.inhymasolutions.com/transfer/addEdit", () => {
    render(
      <BrowserRouter>
        <AddTransferOrderPage />
      </BrowserRouter>
    );

    expect(screen.getByLabelText(/From Warehouse/i)).toBeTruthy();
    expect(screen.getByLabelText(/To Warehouse/i)).toBeTruthy();
    expect(screen.getByLabelText("Remark")).toBeTruthy();
    expect(screen.getByText("PRODUCT SEARCH")).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter Product Name / Model No")).toBeTruthy();
    expect(screen.getByText("Only The Main Balance Quantity Is Transferable.")).toBeTruthy();
    expect(screen.getByText("Grand Total")).toBeTruthy();
    expect(screen.getByText("₹ 0.00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
  });

  it("disables search input and shows helper note until From Warehouse is selected", () => {
    render(
      <BrowserRouter>
        <AddTransferOrderPage />
      </BrowserRouter>
    );

    expect(screen.getByText("Please select From Warehouse to search products.")).toBeTruthy();
    const searchInput = screen.getByPlaceholderText("Enter Product Name / Model No") as HTMLInputElement;
    expect(searchInput.disabled).toBe(true);

    // Select From Warehouse
    const fromWhSelect = screen.getByLabelText(/From Warehouse/i);
    fireEvent.change(fromWhSelect, { target: { value: "Ahmedabad" } });

    expect(searchInput.disabled).toBe(false);
    expect(screen.queryByText("Please select From Warehouse to search products.")).toBeNull();
  });

  it("allows searching for catalog products and adding them to the transfer line items table", async () => {
    render(
      <BrowserRouter>
        <AddTransferOrderPage />
      </BrowserRouter>
    );

    // Select From Warehouse
    fireEvent.change(screen.getByLabelText(/From Warehouse/i), { target: { value: "Mumbai" } });
    fireEvent.change(screen.getByLabelText(/To Warehouse/i), { target: { value: "Ahmedabad" } });

    const searchInput = screen.getByPlaceholderText("Enter Product Name / Model No");
    fireEvent.change(searchInput, { target: { value: "Sensor" } });

    // Autocomplete dropdown should be visible
    await waitFor(() => {
      expect(screen.getByText("Sensor (Banding)")).toBeTruthy();
    });

    // Click on autocomplete item to add it
    fireEvent.click(screen.getByText("Sensor (Banding)"));

    // Check table now has the item row
    expect(screen.getByText("Spares • HSN: 84229090 • GST: 18%")).toBeTruthy();
    // Grand total should be updated from ₹ 0.00
    expect(screen.queryByText("₹ 0.00")).toBeNull();
  });

  it("prevents submission if From Warehouse and To Warehouse are identical", async () => {
    render(
      <BrowserRouter>
        <AddTransferOrderPage />
      </BrowserRouter>
    );

    fireEvent.change(screen.getByLabelText(/From Warehouse/i), { target: { value: "Ahmedabad" } });
    fireEvent.change(screen.getByLabelText(/To Warehouse/i), { target: { value: "Ahmedabad" } });

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(screen.getByText(/From Warehouse and To Warehouse cannot be the same/i)).toBeTruthy();
  });

  it("prevents submission if no products are added", async () => {
    render(
      <BrowserRouter>
        <AddTransferOrderPage />
      </BrowserRouter>
    );

    fireEvent.change(screen.getByLabelText(/From Warehouse/i), { target: { value: "Ahmedabad" } });
    fireEvent.change(screen.getByLabelText(/To Warehouse/i), { target: { value: "Mumbai" } });

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(screen.getByText(/Please add at least one product to the transfer order/i)).toBeTruthy();
  });

  it("successfully submits transfer order and navigates back to /transfer/list", async () => {
    render(
      <BrowserRouter>
        <AddTransferOrderPage />
      </BrowserRouter>
    );

    fireEvent.change(screen.getByLabelText(/From Warehouse/i), { target: { value: "Mumbai" } });
    fireEvent.change(screen.getByLabelText(/To Warehouse/i), { target: { value: "Ahmedabad" } });
    fireEvent.change(screen.getByLabelText("Remark"), { target: { value: "Test inter-warehouse transfer" } });

    const searchInput = screen.getByPlaceholderText("Enter Product Name / Model No");
    fireEvent.change(searchInput, { target: { value: "Sensor" } });

    await waitFor(() => {
      expect(screen.getByText("Sensor (Banding)")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Sensor (Banding)"));

    // Submit form
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/transfer/list");
    });
  });

  it("StockTransferPage + ADD NEW button navigates to /transfer/addEdit", () => {
    render(
      <BrowserRouter>
        <StockTransferPage initialLoading={false} />
      </BrowserRouter>
    );

    const addNewBtn = screen.getByRole("button", { name: "+ ADD NEW" });
    expect(addNewBtn).toBeTruthy();

    fireEvent.click(addNewBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/transfer/addEdit");
  });
});
