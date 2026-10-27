import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaleProcessFormPage } from "../sales/SaleProcessForm";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

// Mock api calls
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiGet: vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/masters/products")) {
        return Promise.resolve({
          data: {
            items: [
              {
                product_name: "Continuous Band Sealer",
                product_code: "CBS-01",
                hsn: "84223000",
                standard_price: 25000,
                gst_percent: 18,
                minimum_price: 22000,
                available_stock: 10,
              },
              {
                product_name: "Induction Cap Sealing Machine",
                product_code: "ICSM-01",
                hsn: "84223000",
                standard_price: 72203,
                gst_percent: 18,
                minimum_price: 68000,
                available_stock: 5,
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: null });
    }),
    apiPost: vi.fn().mockResolvedValue({ data: { id: "so-new-123" } }),
    apiPatch: vi.fn().mockResolvedValue({ data: { id: "so-new-123" } }),
    errorMessage: vi.fn((err) => String(err)),
  };
});

// Mock toast
vi.mock("@/lib/toast", () => ({
  useToast: () => vi.fn(),
}));

describe("SaleProcessFormPage (/sale-order/addedit & /sales/process/add)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders page header, title, and ← BACK button", () => {
    render(
      <BrowserRouter>
        <SaleProcessFormPage />
      </BrowserRouter>
    );

    expect(screen.getByRole("heading", { name: /Add Sales Order/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /← BACK/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Submit/i })).toBeTruthy();
  });

  it("renders all General Details fields matching production screenshot", () => {
    render(
      <BrowserRouter>
        <SaleProcessFormPage />
      </BrowserRouter>
    );

    expect(screen.getByRole("textbox", { name: "Warehouse" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Expected Delivery Date" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Payment Terms" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Sales Person" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Transport Name" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Third Party Delivery" })).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter Destination")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Delivery Type" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Delivery Charge" })).toBeTruthy();
  });

  it("renders 3 Entity Cards (Company, Billing Address, Shipping Address) with Clear and + Add buttons", () => {
    render(
      <BrowserRouter>
        <SaleProcessFormPage />
      </BrowserRouter>
    );

    const companyInput = screen.getByPlaceholderText("Enter Customer Name") as HTMLInputElement;
    const addressInputs = screen.getAllByPlaceholderText("Enter Address") as HTMLInputElement[];
    expect(companyInput).toBeTruthy();
    expect(addressInputs.length).toBe(2);

    const addButtons = screen.getAllByRole("button", { name: "+ Add" });
    expect(addButtons.length).toBe(3);

    // Clicking + Add autofills sample company
    fireEvent.click(addButtons[0]);
    expect(companyInput.value).toBe("V S Machines");

    // Clicking clear (trash button) clears the input
    const clearButtons = screen.getAllByTitle("Clear");
    expect(clearButtons.length).toBe(3);
    fireEvent.click(clearButtons[0]);
    expect(companyInput.value).toBe("");
  });

  it("handles Product Search autocomplete and adds item to table", async () => {
    render(
      <BrowserRouter>
        <SaleProcessFormPage />
      </BrowserRouter>
    );

    const searchInput = screen.getByPlaceholderText("Enter Product Name / Model No");
    fireEvent.change(searchInput, { target: { value: "Band Sealer" } });

    await waitFor(() => {
      expect(screen.getByText("Continuous Band Sealer")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Continuous Band Sealer"));

    // Item should now appear in table inputs
    await waitFor(() => {
      const prodInputs = screen.getAllByDisplayValue("Continuous Band Sealer");
      expect(prodInputs.length).toBeGreaterThan(0);
      expect(screen.getByDisplayValue("84223000")).toBeTruthy();
    });
  });

  it("toggles Additional Charges checkbox and calculates live totals and Amount In Words", async () => {
    render(
      <BrowserRouter>
        <SaleProcessFormPage />
      </BrowserRouter>
    );

    const addChargesCheckbox = screen.getByRole("checkbox", { name: /Additional Charges/i }) as HTMLInputElement;
    expect(addChargesCheckbox.checked).toBe(true);

    // Add a product item
    const searchInput = screen.getByPlaceholderText("Enter Product Name / Model No");
    fireEvent.change(searchInput, { target: { value: "Induction Cap" } });

    await waitFor(() => {
      expect(screen.getByText("Induction Cap Sealing Machine")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Induction Cap Sealing Machine"));

    // Summary card should update with live totals and Amount In Words
    await waitFor(() => {
      expect(screen.getByText(/Total Including Tax/i)).toBeTruthy();
      expect(screen.getByText(/Amount In Words:/i)).toBeTruthy();
    });

    // Uncheck additional charges
    fireEvent.click(addChargesCheckbox);
    expect(addChargesCheckbox.checked).toBe(false);
  });

  it("validates required fields on Submit click", async () => {
    render(
      <BrowserRouter>
        <SaleProcessFormPage />
      </BrowserRouter>
    );

    const submitBtn = screen.getByRole("button", { name: /Submit/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Warehouse is required")).toBeTruthy();
      expect(screen.getByText("Payment Terms is required")).toBeTruthy();
      expect(screen.getByText("Transport Name is required")).toBeTruthy();
      expect(screen.getByText("Delivery Type is required")).toBeTruthy();
      expect(screen.getByText("Delivery Charge is required")).toBeTruthy();
      expect(screen.getByText("Company is required")).toBeTruthy();
      expect(screen.getByText("Billing Address is required")).toBeTruthy();
      expect(screen.getByText("Shipping Address is required")).toBeTruthy();
    });
  });

  it("loads source order details and sets duplicate header title in duplicate mode", async () => {
    const { apiGet } = await import("@/lib/api");
    (apiGet as any).mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/sales/orders/source-order-1")) {
        return Promise.resolve({
          data: {
            id: "source-order-1",
            order_no: "SO-OLD-999",
            warehouse: "Primary Godown",
            payment_terms: "Immediate",
            sales_person: "Admin",
            transport_name: "Safe Express",
            delivery_type: "Door Delivery",
            delivery_charge: "Paid",
            company_name: "Acme Corp",
            customer_name: "John Doe",
            shipping_address: "123 Street",
            billing_address: "123 Street",
            status: "pending",
            items: [
              {
                item_name: "Continuous Band Sealer",
                hsn: "84223000",
                quantity: 2,
                rate: 25000,
                amount: 50000,
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: { items: [] } });
    });

    render(
      <MemoryRouter initialEntries={["/sales/process/add?duplicate_id=source-order-1"]}>
        <SaleProcessFormPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Add Sales Order (Duplicate)" })).toBeTruthy();
    });
  });
});
