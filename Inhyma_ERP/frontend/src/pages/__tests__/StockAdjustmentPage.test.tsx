import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { StockAdjustmentPage, INITIAL_ADJUSTMENTS } from "../StockAdjustmentPage";

// Mock AppShell to isolate page testing
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

describe("StockAdjustmentPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders page header and action buttons", () => {
    render(
      <BrowserRouter>
        <StockAdjustmentPage />
      </BrowserRouter>
    );

    expect(screen.getByRole("heading", { name: "Stock Adjustment" })).toBeTruthy();
    expect(screen.getByTitle("Filter stock adjustments")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add New/i })).toBeTruthy();
  });

  it("filter panel is off by default until filter button is clicked", () => {
    render(
      <BrowserRouter>
        <StockAdjustmentPage />
      </BrowserRouter>
    );

    // Filter panel should be hidden initially
    expect(screen.queryByTestId("adjustment-filter-panel")).toBeNull();

    // Click filter button
    const filterBtn = screen.getByTitle("Filter stock adjustments");
    fireEvent.click(filterBtn);

    // Filter panel should now be visible with all 4 fields
    expect(screen.getByTestId("adjustment-filter-panel")).toBeTruthy();
    expect(screen.getByLabelText("Adjustment Date Range")).toBeTruthy();
    expect(screen.getByLabelText("Adjustment Type")).toBeTruthy();
    expect(screen.getByLabelText("Purpose")).toBeTruthy();
    expect(screen.getByLabelText("Warehouse")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();

    // Toggling filter button closes it
    fireEvent.click(filterBtn);
    expect(screen.queryByTestId("adjustment-filter-panel")).toBeNull();
  });

  it("renders exact table column headers", () => {
    render(
      <BrowserRouter>
        <StockAdjustmentPage />
      </BrowserRouter>
    );

    expect(screen.getByText(/Adjustment Date/i)).toBeTruthy();
    expect(screen.getByText(/Client \/ Inv\. No\./i)).toBeTruthy();
    expect(screen.getByText(/Warehouse/i)).toBeTruthy();
    expect(screen.getByText("Type")).toBeTruthy();
    expect(screen.getByText(/Purpose/i)).toBeTruthy();
    expect(screen.getByText(/Total/i)).toBeTruthy();
    expect(screen.getByText("Created By")).toBeTruthy();
    expect(screen.getByText("Action")).toBeTruthy();
  });

  it("renders records words by words from the screenshot", () => {
    render(
      <BrowserRouter>
        <StockAdjustmentPage />
      </BrowserRouter>
    );

    // Clients & invoices
    expect(screen.getByText("GARUDA ENGINEERS")).toBeTruthy();
    expect(screen.getByText("660/26-27")).toBeTruthy();
    expect(screen.getByText("SLEXO PACKAGING")).toBeTruthy();
    expect(screen.getByText("3288/26-27")).toBeTruthy();

    // Values & formatted currency
    expect(screen.getByText("₹ 2,75,000.00")).toBeTruthy();
    expect(screen.getByText("₹ 2,25,000.00")).toBeTruthy();

    // Created by
    expect(screen.getAllByText("Akshata Wadekar").length).toBe(INITIAL_ADJUSTMENTS.length);
  });

  it("filters records by Type and resets on Reset", () => {
    render(
      <BrowserRouter>
        <StockAdjustmentPage />
      </BrowserRouter>
    );

    // Open filter panel
    fireEvent.click(screen.getByTitle("Filter stock adjustments"));

    // Select Stock OUT
    const typeSelect = screen.getByLabelText("Adjustment Type");
    fireEvent.change(typeSelect, { target: { value: "Stock OUT" } });

    // Apply filters
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    // Only Damage and Split Stock OUT entries should remain
    expect(screen.queryByText("GARUDA ENGINEERS")).toBeNull();
    expect(screen.getByText("₹ 2,25,000.00")).toBeTruthy();

    // Click Reset
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    // All records should be restored
    expect(screen.getByText("GARUDA ENGINEERS")).toBeTruthy();
  });

  it("opens SideDrawer on row click and shows Category, HSN, and GST in breakdown", async () => {
    render(
      <BrowserRouter>
        <StockAdjustmentPage />
      </BrowserRouter>
    );

    const clientRow = screen.getByText("GARUDA ENGINEERS");
    fireEvent.click(clientRow);

    await waitFor(() => {
      expect(screen.getByText("Adjusted Items Breakdown")).toBeTruthy();
      expect(screen.getByText("ISL250 Rotary PFS 8 Head With Zipper & Nitrogen")).toBeTruthy();
      expect(screen.getByText("Category")).toBeTruthy();
      expect(screen.getByText("HSN")).toBeTruthy();
      expect(screen.getByText("GST")).toBeTruthy();
      expect(screen.getByText("84224000")).toBeTruthy();
      expect(screen.getByText("18%")).toBeTruthy();
    });
  });

  it("opens DateRangePicker popover on clicking date input and allows preset selection", async () => {
    render(
      <BrowserRouter>
        <StockAdjustmentPage />
      </BrowserRouter>
    );

    // Open filter panel
    fireEvent.click(screen.getByTitle("Filter stock adjustments"));

    // Date range input should have initial value "08/21/2026 - 09/19/2026"
    const dateInput = screen.getByTestId("date-range-input") as HTMLInputElement;
    expect(dateInput.value).toBe("08/21/2026 - 09/19/2026");

    // Popover is not open initially
    expect(screen.queryByTestId("date-range-popover")).toBeNull();

    // Click date input to open popover
    fireEvent.click(dateInput);

    // Popover should now appear
    expect(screen.getByTestId("date-range-popover")).toBeTruthy();

    // Verify all 7 presets are rendered
    expect(screen.getByRole("button", { name: "Today" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yesterday" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Last 7 Days" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Last 30 Days" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "This Month" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Last Month" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Custom Range" })).toBeTruthy();

    // Check footer Clear and Apply buttons
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();

    // Click Today preset
    fireEvent.click(screen.getByRole("button", { name: "Today" }));

    // Click Apply
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Popover should close and date input should be updated to Today
    expect(screen.queryByTestId("date-range-popover")).toBeNull();
    expect(dateInput.value).toBe("09/19/2026 - 09/19/2026");

    // Only adjustments from today (19-09-2026) should remain
    expect(screen.getByText("GARUDA ENGINEERS")).toBeTruthy();
    // 18-09-2026 and 17-09-2026 items should be filtered out
    expect(screen.queryByText("61,250.00")).toBeNull();
  });

  it("clears date range filter on clicking Clear in the DateRangePicker popover", () => {
    render(
      <BrowserRouter>
        <StockAdjustmentPage />
      </BrowserRouter>
    );

    // Open filter panel
    fireEvent.click(screen.getByTitle("Filter stock adjustments"));

    const dateInput = screen.getByTestId("date-range-input") as HTMLInputElement;
    fireEvent.click(dateInput);

    // Click Clear
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    // Popover closes and input is cleared
    expect(screen.queryByTestId("date-range-popover")).toBeNull();
    expect(dateInput.value).toBe("");
  });
});
