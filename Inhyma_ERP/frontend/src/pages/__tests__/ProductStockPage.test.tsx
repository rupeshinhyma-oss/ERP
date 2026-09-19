import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { ProductStockPage, INITIAL_STOCK_ITEMS } from "../ProductStockPage";

// Mock AppShell so the test focuses purely on the page content and navigation key
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock xlsx library
vi.mock("xlsx", () => ({
  utils: {
    json_to_sheet: vi.fn(() => ({})),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
}));

describe("ProductStockPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders page header and action buttons", () => {
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    expect(screen.getByRole("heading", { name: "Product Stock" })).toBeTruthy();
    expect(screen.getByTitle("Filter stock list")).toBeTruthy();
    expect(screen.getByTitle("Export to Excel")).toBeTruthy();
  });

  it("renders search input with placeholder matching screenshot", () => {
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    expect(
      screen.getByPlaceholderText("Search products by name, code, brand, sub-category...")
    ).toBeTruthy();
  });

  it("renders exact table column headers words by words", () => {
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    expect(screen.getByText("Sr. No.")).toBeTruthy();
    expect(screen.getByText("Product Name (As Per Tally)")).toBeTruthy();
    expect(screen.getByText("Product Code")).toBeTruthy();
    expect(screen.getByText("Brand")).toBeTruthy();
    expect(screen.getByText("Sub Category")).toBeTruthy();
    expect(screen.getByText("Mumbai")).toBeTruthy();
    expect(screen.getByText("Mumbai Transit")).toBeTruthy();
    expect(screen.getByText("Mumbai Ordered")).toBeTruthy();
    expect(screen.getByText("Ahmedabad")).toBeTruthy();
    expect(screen.getByText("Ahmedabad Transit")).toBeTruthy();
    expect(screen.getByText("Ahmedabad Ordered")).toBeTruthy();
    expect(screen.getByText("Indore")).toBeTruthy();
    expect(screen.getByText("Indore Transit")).toBeTruthy();
    expect(screen.getByText("Indore Ordered")).toBeTruthy();
    expect(screen.getByText("Total Qty")).toBeTruthy();
  });

  it("renders all 11 screenshot rows words by words", () => {
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    for (const item of INITIAL_STOCK_ITEMS) {
      expect(screen.getByText(item.product_name_tally)).toBeTruthy();
    }
  });

  it("filters rows live as user types in search bar", async () => {
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    const searchInput = screen.getByPlaceholderText("Search products by name, code, brand, sub-category...");
    fireEvent.change(searchInput, { target: { value: "Banding" } });

    expect(screen.getByText("Sensor (Banding)")).toBeTruthy();
    expect(screen.queryByText("XLSG36100 Capping Machine")).toBeNull();
  });

  it("opens Detail drawer when clicking product name", async () => {
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    const link = screen.getByText("Sensor (Banding)");
    fireEvent.click(link);

    await waitFor(() => {
      expect(screen.getAllByText("Sensor (Banding)").length).toBeGreaterThan(1);
      expect(screen.getByText("Location Stock Breakdown")).toBeTruthy();
    });
  });

  it("triggers Excel export when Export button is clicked", async () => {
    const XLSX = await import("xlsx");
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    const exportBtn = screen.getByTitle("Export to Excel");
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(XLSX.writeFile).toHaveBeenCalledWith(expect.anything(), "Product_Stock_List.xlsx");
    });
  });
});
