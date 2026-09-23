import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaleProcessFormPage } from "../sales/SaleProcessForm";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

// Mock api calls
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: null }),
  apiPost: vi.fn().mockResolvedValue({ data: { id: "so-new-123" } }),
  apiPatch: vi.fn().mockResolvedValue({ data: { id: "so-new-123" } }),
  errorMessage: vi.fn((err) => String(err)),
}));

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
});
