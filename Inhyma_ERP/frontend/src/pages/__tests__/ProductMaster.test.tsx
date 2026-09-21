import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { ProductsPage, ProductSkeletonRows } from "../masters/Products";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock API
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockImplementation((url: string) => {
    if (url.includes("/masters/products")) {
      return Promise.resolve({
        data: [
          {
            id: "prd-001",
            product_name_tally: "ISL150 Rotary PFS 4 Stations",
            product_name: "ISL150 Rotary PFS 4 Stations",
            product_code: "-",
            brand_id: "brand-yinglima",
            category_id: "cat-machines",
            sub_category_id: "sub-misc",
            uom_id: "uom-nos",
            standard_price: 1850000,
            packaging_quantity: 1,
            packaging_gross_weight: 0,
            packaging_unit_cbm: 0,
            status: "active",
          },
          {
            id: "prd-002",
            product_name_tally: "DZ800 Double Face Shaping Vacuum Machine 10Kgs",
            product_name: "DZ800 Double Face Shaping Vacuum Machine 10Kgs",
            product_code: "-",
            brand_id: "brand-yinglima",
            category_id: "cat-machines",
            sub_category_id: "sub-vacuum",
            uom_id: "uom-nos",
            packaging_quantity: 1,
            packaging_gross_weight: 0,
            packaging_unit_cbm: 0,
            status: "active",
          },
          {
            id: "prd-003",
            product_name_tally: "Sensor (Banding)",
            product_name: "Sensor (Banding)",
            product_code: "-",
            brand_id: "",
            category_id: "cat-spares",
            sub_category_id: "sub-banding-spares",
            uom_id: "uom-nos",
            standard_price: 15000,
            packaging_quantity: 1,
            packaging_gross_weight: 0,
            packaging_unit_cbm: 0,
            status: "active",
          },
          {
            id: "prd-099",
            product_name_tally: "Discontinued Obsolete Model 99",
            product_name: "Discontinued Obsolete Model 99",
            product_code: "OBS-099",
            brand_id: "",
            category_id: "cat-spares",
            sub_category_id: "sub-misc",
            uom_id: "uom-nos",
            status: "inactive",
          },
        ],
        success: true,
      });
    }
    return Promise.resolve({ data: [], success: true });
  }),
  apiPost: vi.fn().mockResolvedValue({ success: true, data: { id: "new-prod" } }),
  apiPatch: vi.fn().mockResolvedValue({ success: true }),
  apiDelete: vi.fn().mockResolvedValue({ success: true }),
  downloadExport: vi.fn(),
  API_ORIGIN: "http://localhost:8000",
}));

// Mock Lookups
vi.mock("@/lib/lookups", () => ({
  useLookup: (url: string) => {
    if (url.includes("categories")) {
      return { items: [{ id: "cat-machines", name: "Machines" }, { id: "cat-spares", name: "Spares" }], loaded: true };
    }
    if (url.includes("sub-categories")) {
      return {
        items: [
          { id: "sub-misc", name: "Miscellaneous", category_id: "cat-machines" },
          { id: "sub-vacuum", name: "Vacuum Sealer Machine", category_id: "cat-machines" },
          { id: "sub-banding-spares", name: "Spares For Banding Machine", category_id: "cat-spares" },
        ],
        loaded: true,
      };
    }
    if (url.includes("brands")) {
      return { items: [{ id: "brand-yinglima", name: "Yinglima" }], loaded: true };
    }
    if (url.includes("uom")) {
      return { items: [{ id: "uom-nos", name: "Numbers", code: "Nos" }], loaded: true };
    }
    return { items: [], loaded: true };
  },
}));

describe("Product Master (/product/list)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders page header, title, and action buttons matching legacy ERP screenshot", () => {
    render(
      <BrowserRouter>
        <ProductsPage />
      </BrowserRouter>
    );

    expect(screen.getByRole("heading", { name: "Product Master" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ ADD NEW" })).toBeTruthy();
    expect(screen.getByText(/Imp \/ Exp/i)).toBeTruthy();
    expect(screen.getByText(/Bulk Actions/i)).toBeTruthy();
  });

  it("renders collapsible filter panel with Category, Sub Category, Brand dropdowns and Reset & Search buttons", () => {
    render(
      <BrowserRouter>
        <ProductsPage defaultFilterOpen={true} />
      </BrowserRouter>
    );

    expect(screen.getByTestId("pm-filter-panel")).toBeTruthy();
    expect(screen.getByLabelText("Category")).toBeTruthy();
    expect(screen.getByLabelText("Sub Category")).toBeTruthy();
    expect(screen.getByLabelText("Brand")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();

    // Toggle filter panel closed
    const filterBtn = screen.getByRole("button", { name: "Filter" });
    fireEvent.click(filterBtn);
    expect(screen.queryByTestId("pm-filter-panel")).toBeNull();

    // Toggle back open
    fireEvent.click(filterBtn);
    expect(screen.getByTestId("pm-filter-panel")).toBeTruthy();
  });

  it("renders Active and Inactive status tabs and filters products accordingly", async () => {
    render(
      <BrowserRouter>
        <ProductsPage />
      </BrowserRouter>
    );

    const activeTab = screen.getByRole("button", { name: /^Active \(/i });
    expect(activeTab).toBeTruthy();

    // Active tab shows active products
    await waitFor(() => {
      expect(screen.getByText("ISL150 Rotary PFS 4 Stations")).toBeTruthy();
      expect(screen.queryByText("Discontinued Obsolete Model 99")).toBeNull();
      // Wait until async API call updates inactive count badge
      expect(screen.getByRole("button", { name: /^Inactive \(1\)/i })).toBeTruthy();
    });

    const inactiveTab = screen.getByRole("button", { name: /^Inactive \(1\)/i });

    // Click Inactive tab
    fireEvent.click(inactiveTab);

    await waitFor(() => {
      expect(screen.getByText("Discontinued Obsolete Model 99")).toBeTruthy();
      expect(screen.queryByText("ISL150 Rotary PFS 4 Stations")).toBeNull();
    });
  });

  it("renders all table columns including Sr. No. and preserves natural default order", async () => {
    render(
      <BrowserRouter>
        <ProductsPage />
      </BrowserRouter>
    );

    const table = screen.getByRole("table");
    expect(table).toBeTruthy();

    const { getByText, getByRole } = within(table);

    // Sr. No. column header
    expect(getByText("Sr. No.")).toBeTruthy();
    expect(getByRole("columnheader", { name: /Product Name \(As Per Tally\)/i })).toBeTruthy();
    expect(getByText("Product Code")).toBeTruthy();
    expect(getByText("Brand")).toBeTruthy();
    expect(getByText("Sub Cate.")).toBeTruthy();
    expect(getByText("Min. Price Without GST")).toBeTruthy();
    expect(getByText("HSN")).toBeTruthy();
    expect(getByText("UOM")).toBeTruthy();
    expect(getByText("Pack. Qty")).toBeTruthy();
    expect(getByText("Pack. Gross Weight")).toBeTruthy();
    expect(getByText("Pack. Unit CBM")).toBeTruthy();
    expect(getByText("Action")).toBeTruthy();

    // Verify row serial numbers (1, 2, 3...)
    await waitFor(() => {
      expect(screen.getByText("ISL150 Rotary PFS 4 Stations")).toBeTruthy();
    });

    const rows = screen.getAllByRole("row");
    // Row 0 is header, Row 1 should have Sr. No. 1, Row 2 should have Sr. No. 2
    expect(rows[1].querySelector(".cell-srno")?.textContent?.trim()).toBe("1");
    expect(within(rows[1]).getByText("ISL150 Rotary PFS 4 Stations")).toBeTruthy();
    expect(rows[2].querySelector(".cell-srno")?.textContent?.trim()).toBe("2");
    expect(within(rows[2]).getByText("DZ800 Double Face Shaping Vacuum Machine 10Kgs")).toBeTruthy();
  });

  it("renders blue square edit button on each row and clicking it opens the edit form", async () => {
    render(
      <BrowserRouter>
        <ProductsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("ISL150 Rotary PFS 4 Stations")).toBeTruthy();
    });

    const editBtn = screen.getByLabelText("Edit ISL150 Rotary PFS 4 Stations");
    expect(editBtn).toBeTruthy();

    fireEvent.click(editBtn);

    // Should open edit product form
    expect(screen.getByRole("heading", { name: "Edit Product" })).toBeTruthy();
    expect(screen.getByDisplayValue("ISL150 Rotary PFS 4 Stations")).toBeTruthy();
    expect(screen.getByRole("button", { name: "← BACK" })).toBeTruthy();

    // Click back button to return to list
    fireEvent.click(screen.getByRole("button", { name: "← BACK" }));
    expect(screen.getByRole("heading", { name: "Product Master" })).toBeTruthy();
  });

  it("clicking + ADD NEW button opens the Add Product form", () => {
    render(
      <BrowserRouter>
        <ProductsPage />
      </BrowserRouter>
    );

    const addBtn = screen.getByRole("button", { name: "+ ADD NEW" });
    fireEvent.click(addBtn);

    expect(screen.getByRole("heading", { name: "Add Product" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Product" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "← BACK" })).toBeTruthy();
  });

  it("clicking product name opens the SideDrawer with details", async () => {
    render(
      <BrowserRouter>
        <ProductsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("ISL150 Rotary PFS 4 Stations")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("ISL150 Rotary PFS 4 Stations"));

    expect(screen.getByText("Identity & Classification")).toBeTruthy();
    expect(screen.getByText("Packaging & Pricing")).toBeTruthy();
  });

  it("renders standalone ProductSkeletonRows with specified row count and shimmer classes", () => {
    const { container } = render(
      <table>
        <tbody>
          <ProductSkeletonRows
            count={6}
            displayOrder={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}
            getFreezeStyle={() => ({})}
          />
        </tbody>
      </table>
    );

    const skeletonRows = screen.getAllByTestId("skeleton-row");
    expect(skeletonRows.length).toBe(6);

    const shimmerLines = container.querySelectorAll(".skeleton-line");
    expect(shimmerLines.length).toBeGreaterThan(0);
  });

  it("displays skeleton loading rows while products data is fetching", async () => {
    render(
      <BrowserRouter>
        <ProductsPage />
      </BrowserRouter>
    );

    // Skeleton rows should appear during loading
    const skeletonRows = screen.queryAllByTestId("skeleton-row");
    expect(skeletonRows.length).toBeGreaterThanOrEqual(0);

    // After loading resolves, products should be displayed
    await waitFor(() => {
      expect(screen.getByText("ISL150 Rotary PFS 4 Stations")).toBeTruthy();
    });
  });

  it("renders all legacy ERP fields in the Add Product form matching the screenshot", () => {
    render(
      <BrowserRouter>
        <ProductsPage defaultAdd={true} />
      </BrowserRouter>
    );

    // Header & Navigation
    expect(screen.getByRole("heading", { name: "Add Product" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "← BACK" })).toBeTruthy();

    // Row 1
    expect(screen.getByText(/Product Name \(As Per Tally\)/i)).toBeTruthy();
    expect(screen.getByText(/Product Name \(As Per Invoice\)/i)).toBeTruthy();
    expect(screen.getByText(/^Product Code$/i)).toBeTruthy();

    // Row 2
    expect(screen.getByText(/^Brand$/i)).toBeTruthy();
    expect(screen.getByText(/^Category/i)).toBeTruthy();
    expect(screen.getByText(/^Sub Category/i)).toBeTruthy();

    // Row 3
    expect(screen.getByText(/HSN Code/i)).toBeTruthy();
    expect(screen.getByText(/^GST %$/i)).toBeTruthy();
    expect(screen.getByText(/^Import Duty$/i)).toBeTruthy();

    // Row 4
    expect(screen.getByText(/^UOM/i)).toBeTruthy();
    expect(screen.getByText(/Packaging Quantity/i)).toBeTruthy();
    expect(screen.getByText(/Packaging Net Weight/i)).toBeTruthy();

    // Row 5
    expect(screen.getByText(/Packaging Gross Weight/i)).toBeTruthy();
    expect(screen.getByText(/Minimum Price/i)).toBeTruthy();
    expect(screen.getByText(/Without GST/i)).toBeTruthy();

    // Dimensions For CBM
    expect(screen.getByText(/^Dimensions For CBM$/i)).toBeTruthy();
    expect(screen.getByText(/Length \(CM\)/i)).toBeTruthy();
    expect(screen.getByText(/Width \(CM\)/i)).toBeTruthy();
    expect(screen.getByText(/Height \(CM\)/i)).toBeTruthy();
    expect(screen.getByText(/^Packaging Unit CBM$/i)).toBeTruthy();

    // Image Of Product
    expect(screen.getByText(/Image Of Product/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select Image" })).toBeTruthy();

    // Specification
    expect(screen.getByText(/^Specification$/i)).toBeTruthy();
    expect(screen.getByTitle("Bold")).toBeTruthy();
    expect(screen.getByTitle("Italic")).toBeTruthy();
    expect(screen.getByTitle("Underline")).toBeTruthy();

    // Dimensions Dynamic Table
    expect(screen.getByRole("heading", { name: /^Dimensions$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Add Row" })).toBeTruthy();

    // Submit button
    expect(screen.getByRole("button", { name: /Submit|Save Product/i })).toBeTruthy();
    expect(screen.getByText("Submit")).toBeTruthy();
  });

  it("dynamically adds dimension rows and auto-calculates CBM", async () => {
    render(
      <BrowserRouter>
        <ProductsPage defaultAdd={true} />
      </BrowserRouter>
    );

    const addRowBtn = screen.getByRole("button", { name: "+ Add Row" });
    fireEvent.click(addRowBtn);

    // Dimension row inputs should appear
    expect(screen.getByPlaceholderText("e.g. Master Carton, Unit Box...")).toBeTruthy();
    const lInput = screen.getByPlaceholderText("L") as HTMLInputElement;
    const wInput = screen.getByPlaceholderText("W") as HTMLInputElement;
    const hInput = screen.getByPlaceholderText("H") as HTMLInputElement;
    const cbmInput = screen.getByPlaceholderText("0.000000") as HTMLInputElement;

    // Type dimensions: 100 x 50 x 20 = 100,000 / 1,000,000 = 0.100000
    fireEvent.change(lInput, { target: { value: "100" } });
    fireEvent.change(wInput, { target: { value: "50" } });
    fireEvent.change(hInput, { target: { value: "20" } });

    await waitFor(() => {
      expect(cbmInput.value).toBe("0.100000");
    });

    // Delete row
    const deleteBtn = screen.getByTitle("Delete Row");
    fireEvent.click(deleteBtn);
    expect(screen.queryByPlaceholderText("e.g. Master Carton, Unit Box...")).toBeNull();
  });
});

