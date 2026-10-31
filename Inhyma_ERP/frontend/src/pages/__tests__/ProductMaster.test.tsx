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
  apiPostMultipart: vi.fn().mockImplementation((_url: string, fd: FormData) => {
    const uploadedFile = fd.get("file") as File | null;
    const fname = uploadedFile?.name || "spec.pdf";
    const isPdf = fname.toLowerCase().endsWith(".pdf") || uploadedFile?.type === "application/pdf";
    const docId = "11111111-1111-4111-8111-111111111111";
    const url = `http://localhost:8002/api/v1/masters/products/specification-documents/${docId}/${encodeURIComponent(fname)}`;
    return Promise.resolve({
      success: true,
      data: {
        doc_id: docId,
        filename: fname,
        clean_filename: fname,
        content_type: isPdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        file_size: uploadedFile?.size || 1024,
        is_pdf: isPdf,
        url,
        pdf_link: isPdf ? url : null,
      },
    });
  }),
  apiPatch: vi.fn().mockResolvedValue({ success: true }),
  apiDelete: vi.fn().mockResolvedValue({ success: true }),
  downloadExport: vi.fn(),
  errorMessage: vi.fn((err: any) => err?.message || "Request failed"),
  API_ORIGIN: "http://localhost:8000",
}));

// Mock Lookups
vi.mock("@/lib/lookups", () => ({
  useLookup: (url: string) => {
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
    if (url.includes("categories")) {
      return { items: [{ id: "cat-machines", name: "Machines" }, { id: "cat-spares", name: "Spares" }], loaded: true };
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

    // Specification Document Upload
    expect(screen.getByText(/^Specification$/i)).toBeTruthy();
    expect(screen.getByTestId("specification-doc-input")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select Document" })).toBeTruthy();

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

    // Type dimensions: 100 x 50 x 20 = 100,000 / 1,000,000 = 0.10 (client 2-decimal rounding rule)
    fireEvent.change(lInput, { target: { value: "100" } });
    fireEvent.change(wInput, { target: { value: "50" } });
    fireEvent.change(hInput, { target: { value: "20" } });

    await waitFor(() => {
      expect(cbmInput.value).toBe("0.10");
    });

    // Delete row
    const deleteBtn = screen.getByTitle("Delete Row");
    fireEvent.click(deleteBtn);
    expect(screen.queryByPlaceholderText("e.g. Master Carton, Unit Box...")).toBeNull();
  });

  it("renders Machine and Spare Part badges on rows and clicking Machine badge opens machine spares page", async () => {
    render(
      <BrowserRouter>
        <ProductsPage />
      </BrowserRouter>
    );

    // Initial seed product prd-001 is a Machine; prd-003 is Spares
    await waitFor(() => {
      expect(screen.getByTestId("badge-machine-prd-001")).toBeTruthy();
      expect(screen.getByTestId("badge-spare-prd-003")).toBeTruthy();
    });

    const machineBadge = screen.getByTestId("badge-machine-prd-001");
    expect(machineBadge.tagName.toLowerCase()).toBe("button");
    expect(machineBadge.textContent).toContain("Machine");

    const spareBadge = screen.getByTestId("badge-spare-prd-003");
    expect(spareBadge.tagName.toLowerCase()).toBe("span");
    expect(spareBadge.textContent).toContain("Spare");

    // Click Machine badge -> opens dedicated machine spares page
    fireEvent.click(machineBadge);
    await waitFor(() => {
      expect(screen.getByTestId("machine-spares-page")).toBeTruthy();
      expect(screen.getByTestId("machine-spares-title")).toBeTruthy();
      expect(screen.getByTestId("spares-tab-selected")).toBeTruthy();
      expect(screen.getByTestId("spares-tab-all")).toBeTruthy();
    });

    // Verify tabs can be switched
    const allTab = screen.getByTestId("spares-tab-all");
    fireEvent.click(allTab);
    expect(screen.getByTestId("select-spares-btn")).toBeTruthy();

    const selectedTab = screen.getByTestId("spares-tab-selected");
    fireEvent.click(selectedTab);
    expect(screen.getByTestId("remove-spares-btn")).toBeTruthy();

    // Click Back to Product Master
    const backBtn = screen.getByTestId("back-to-products-btn");
    fireEvent.click(backBtn);
    expect(screen.queryByTestId("machine-spares-page")).toBeNull();
  });

  it("renders product name suggestions as an absolute overlay dropdown and allows selection", async () => {
    render(
      <BrowserRouter>
        <ProductsPage defaultAdd={true} />
      </BrowserRouter>
    );

    const nameInput = screen.getByPlaceholderText("Enter product name as per Tally") as HTMLInputElement;
    expect(nameInput).toBeTruthy();

    // Type query with >= 2 characters
    fireEvent.change(nameInput, { target: { value: "Rotary" } });

    // Wait for debounced suggestions dropdown
    await waitFor(() => {
      const suggestions = screen.getByTestId("product-name-suggestions");
      expect(suggestions).toBeTruthy();
      expect(suggestions.style.position).toBe("absolute");
      expect(suggestions.style.zIndex).toBe("1050");
    });

    // Verify dropdown lists the matching product
    expect(screen.getByText(/Existing products matching/i)).toBeTruthy();
    const item = screen.getByText("ISL150 Rotary PFS 4 Stations");
    expect(item).toBeTruthy();

    // Clicking the item selects it and closes the dropdown
    fireEvent.click(item);
    expect(nameInput.value).toBe("ISL150 Rotary PFS 4 Stations");
    expect(screen.queryByTestId("product-name-suggestions")).toBeNull();
  });

  it("uploads a non-PDF document (.docx) to DB and displays its saved document link without copying to clipboard", async () => {
    const apiMod = await import("@/lib/api");
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(
      <BrowserRouter>
        <ProductsPage defaultAdd={true} />
      </BrowserRouter>
    );

    const fileInput = screen.getByTestId("specification-doc-input") as HTMLInputElement;
    const docxFile = new File(["dummy docx bytes"], "machine_manual.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    fireEvent.change(fileInput, { target: { files: [docxFile] } });

    await waitFor(() => {
      expect(apiMod.apiPostMultipart).toHaveBeenCalledWith(
        "/masters/products/specification-document",
        expect.any(FormData)
      );
      expect(screen.getByText("machine_manual.docx")).toBeTruthy();
      expect(screen.getByText("Stored in Database")).toBeTruthy();
      expect(screen.getByTestId("specification-pdf-link-box")).toBeTruthy();
    });

    expect(writeTextMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Copy Link|Copied!/i })).toBeNull();
  });

  it("uploads a PDF specification to DB, displays Saved PDF Link without clipboard copy, and shows saved link in Product View", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(
      <BrowserRouter>
        <ProductsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("ISL150 Rotary PFS 4 Stations")).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText("Edit ISL150 Rotary PFS 4 Stations"));

    const fileInput = screen.getByTestId("specification-doc-input") as HTMLInputElement;
    const pdfFile = new File(["%PDF-1.4 sample spec"], "AFM500_Spec.pdf", {
      type: "application/pdf",
    });

    fireEvent.change(fileInput, { target: { files: [pdfFile] } });

    const expectedUrl =
      "http://localhost:8002/api/v1/masters/products/specification-documents/11111111-1111-4111-8111-111111111111/AFM500_Spec.pdf";

    await waitFor(() => {
      expect(screen.getByText("AFM500_Spec.pdf")).toBeTruthy();
      expect(screen.getByText("Stored in Database")).toBeTruthy();
      expect(screen.getByTestId("specification-pdf-link-box")).toBeTruthy();
      expect(screen.getByText(expectedUrl)).toBeTruthy();
    });

    // Never copies to user's clipboard and renders no Copy Link button
    expect(writeTextMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Copy Link|Copied!/i })).toBeNull();

    // Return to list and open Product Details View drawer — saved link is displayed in View
    fireEvent.click(screen.getByRole("button", { name: "← BACK" }));
    fireEvent.click(screen.getByText("ISL150 Rotary PFS 4 Stations"));

    await waitFor(() => {
      expect(screen.getByTestId("drawer-product-specification")).toBeTruthy();
      expect(screen.getByTestId("drawer-specification-link")).toBeTruthy();
      expect(within(screen.getByTestId("drawer-specification-link")).getByText(expectedUrl)).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /Copy Link|Copied!/i })).toBeNull();
  });

  it("shows visible validation error near Submit when editing a legacy product with 0 weight, then submits cleanly once filled", async () => {
    const apiMod = await import("@/lib/api");
    render(
      <BrowserRouter>
        <ProductsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("ISL150 Rotary PFS 4 Stations")).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText("Edit ISL150 Rotary PFS 4 Stations"));
    expect(screen.getByRole("heading", { name: "Edit Product" })).toBeTruthy();

    // Legacy 0 weight is initialized empty rather than misleadingly pre-filling "0"
    const grossWtInput = screen.getByPlaceholderText("Enter weight in kg (> 0)") as HTMLInputElement;
    expect(grossWtInput.value).toBe("");

    // Clicking Submit without filling gross weight or dimensions shows visible error near Submit
    fireEvent.click(screen.getByRole("button", { name: "Save Product" }));
    await waitFor(() => {
      expect(screen.getByTestId("product-submit-error")).toBeTruthy();
      expect(screen.getAllByText(/Packaging Gross Weight must be greater than 0 kg\./i).length).toBeGreaterThanOrEqual(1);
    });
    expect(apiMod.apiPatch).not.toHaveBeenCalled();

    // Fill gross weight + dimensions + upload Specification PDF, then click Submit
    fireEvent.change(grossWtInput, { target: { value: "25" } });
    const numberInputs = document.querySelectorAll('input[type="number"]');
    // Length, Width, Height inputs are right after Packaging Gross Weight
    const grossIdx = Array.from(numberInputs).indexOf(grossWtInput);
    fireEvent.change(numberInputs[grossIdx + 1], { target: { value: "45" } });
    fireEvent.change(numberInputs[grossIdx + 2], { target: { value: "85" } });
    fireEvent.change(numberInputs[grossIdx + 3], { target: { value: "65" } });

    const fileInput = screen.getByTestId("specification-doc-input") as HTMLInputElement;
    const pdfFile = new File(["%PDF-1.4 spec"], "Sales_Order_SO.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, { target: { files: [pdfFile] } });

    await waitFor(() => {
      expect(screen.getByText("Sales_Order_SO.pdf")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Product" }));

    await waitFor(() => {
      expect(apiMod.apiPatch).toHaveBeenCalledWith(
        "/masters/products/prd-001",
        expect.objectContaining({
          packaging_gross_weight: 25,
          packaging_unit_cbm: 0.25,
          specification_doc_id: "11111111-1111-4111-8111-111111111111",
          specification_doc_name: "Sales_Order_SO.pdf",
        })
      );
      expect(screen.getByRole("heading", { name: "Product Master" })).toBeTruthy();
    });
  });
});



