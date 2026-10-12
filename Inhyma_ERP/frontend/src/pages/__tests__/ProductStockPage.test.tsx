import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { ProductStockPage, INITIAL_STOCK_ITEMS, INITIAL_GOODS_EXPECTED_ITEMS } from "../ProductStockPage";
import { InventoryApi } from "@/lib/api";

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
    vi.spyOn(InventoryApi, "listProductStock").mockResolvedValue({
      data: { items: INITIAL_STOCK_ITEMS },
    } as any);
    vi.spyOn(InventoryApi, "getGoodsExpectedReport").mockImplementation((params?: any) => {
      let filtered = [...INITIAL_GOODS_EXPECTED_ITEMS];
      if (params?.machine) {
        const q = String(params.machine).toLowerCase();
        filtered = filtered.filter(
          (i) =>
            i.product_name.toLowerCase().includes(q) ||
            i.product_code.toLowerCase().includes(q) ||
            i.container_no.toLowerCase().includes(q)
        );
      }
      return Promise.resolve({
        data: {
          items: filtered,
          total: filtered.length,
        },
      } as any);
    });
    vi.spyOn(InventoryApi, "getProductStockBreakup").mockImplementation((({ type }: { type: string }) => {
      if (type === "physical") {
        return Promise.resolve({
          data: {
            items: [
              {
                sr_no: 1,
                order_no: "SO-2026-001",
                order_date: "2026-10-01",
                company_name: "Acme Packaging",
                city_state: "Mumbai, Maharashtra",
                quantity: 1,
                status: "Confirmed",
                sales_person: "Rohit",
                delivery_date: "2026-10-15",
              },
            ],
          },
        });
      }
      return Promise.resolve({
        data: {
          items: [
            {
              sr_no: 1,
              consignment_no: "CON-2026-99",
              invoice_no: "INV-99",
              date: "2026-10-02",
              supplier_name: "Yinglima Co.",
              quantity: 2,
              arrival_date: "2026-10-20",
              status: "Ordered",
            },
          ],
        },
      });
    }) as any);
  });

  it("renders page header and action buttons", () => {
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    expect(screen.getByRole("heading", { name: /Product Stock/i })).toBeTruthy();
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

  it("renders 15 table column headers", () => {
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

  it("opens Product Master View Window drawer when clicking product name", async () => {
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    const link = screen.getByText("Sensor (Banding)");
    fireEvent.click(link);

    await waitFor(() => {
      expect(screen.getAllByText("Sensor (Banding)").length).toBeGreaterThan(1);
      expect(screen.getByText("Identity & Classification")).toBeTruthy();
      expect(screen.getByText("Packaging & Pricing")).toBeTruthy();
      expect(screen.getByText("Dimensions For CBM")).toBeTruthy();
      expect(screen.getByText("Location Stock Breakdown")).toBeTruthy();
      expect(screen.getByRole("button", { name: /Open in Product Master/i })).toBeTruthy();
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

  it("filter panel is off by default and only opens when filter button is clicked", () => {
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    // Filter panel should be OFF initially
    expect(screen.queryByTestId("stock-filter-panel")).toBeNull();

    // Click filter button
    const filterBtn = screen.getByTitle("Filter stock list");
    fireEvent.click(filterBtn);

    // Filter panel should now be visible
    expect(screen.getByTestId("stock-filter-panel")).toBeTruthy();
    expect(screen.getByLabelText("Category")).toBeTruthy();
    expect(screen.getByLabelText("Sub Category")).toBeTruthy();
    expect(screen.getByLabelText("Brand")).toBeTruthy();
    expect(screen.getByLabelText("Negative Stock")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();

    // Clicking filter button again toggles it off
    fireEvent.click(filterBtn);
    expect(screen.queryByTestId("stock-filter-panel")).toBeNull();
  });

  it("applies category and brand filters when Search is clicked and resets on Reset", () => {
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    // Open filter panel
    fireEvent.click(screen.getByTitle("Filter stock list"));
    expect(screen.getByTestId("stock-filter-panel")).toBeTruthy();

    // Select Category "Spares"
    const categorySelect = screen.getByLabelText("Category");
    fireEvent.change(categorySelect, { target: { value: "Spares" } });

    // Click Search to apply filter
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    // Only Sensor (Banding) is in Spares
    expect(screen.getByText("Sensor (Banding)")).toBeTruthy();
    expect(screen.queryByText("XLSG36100 Capping Machine")).toBeNull();

    // Click Reset
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    // All items should be restored
    expect(screen.getByText("Sensor (Banding)")).toBeTruthy();
    expect(screen.getByText("XLSG36100 Capping Machine")).toBeTruthy();
  });

  it("filters correctly by Negative Stock (Select, Yes, No)", () => {
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    // Open filter panel
    fireEvent.click(screen.getByTitle("Filter stock list"));
    const negSelect = screen.getByLabelText("Negative Stock");

    // Select Yes (none in INITIAL_STOCK_ITEMS have negative stock)
    fireEvent.change(negSelect, { target: { value: "Yes" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    // Empty state should be visible
    expect(screen.getByText("No products found matching your search or filters.")).toBeTruthy();

    // Select No (all in INITIAL_STOCK_ITEMS have stock >= 0)
    fireEvent.change(negSelect, { target: { value: "No" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(screen.getByText("Sensor (Banding)")).toBeTruthy();

    // Reset back to Select
    fireEvent.change(negSelect, { target: { value: "Select" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("Sensor (Banding)")).toBeTruthy();
  });

  it("opens slide-over breakup modal when clicking (i) button on stock cells", async () => {
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    // Find and click Mumbai physical stock (i) button on Sensor (Banding)
    const mumbaiPhysicalBtn = screen.getAllByLabelText("View Mumbai Sale Order Information")[0];
    expect(mumbaiPhysicalBtn).toBeTruthy();
    fireEvent.click(mumbaiPhysicalBtn);

    // Breakup modal should open
    await waitFor(() => {
      expect(screen.getByTestId("stock-breakup-modal")).toBeTruthy();
      expect(screen.getByText(/Sale Order Information/i)).toBeTruthy();
      expect(screen.getByRole("table", { name: "Sale Order Information Table" })).toBeTruthy();
    });

    // Close modal
    const closeBtn = screen.getByLabelText("Close breakup modal");
    fireEvent.click(closeBtn);
    expect(screen.queryByTestId("stock-breakup-modal")).toBeNull();

    // Now test Ordered stock (i) button
    const mumbaiOrderedBtn = screen.getAllByLabelText("View Mumbai Ordered Consignment Breakup")[0];
    fireEvent.click(mumbaiOrderedBtn);

    await waitFor(() => {
      expect(screen.getByTestId("stock-breakup-modal")).toBeTruthy();
      expect(screen.getByText(/Consignment Breakup/i)).toBeTruthy();
      expect(screen.getByRole("table", { name: "Consignment Breakup Table" })).toBeTruthy();
    });
  });

  it("renders shimmer skeleton rows when loading is true", () => {
    render(
      <BrowserRouter>
        <ProductStockPage initialLoading={true} />
      </BrowserRouter>
    );

    const skeletonRows = screen.getAllByTestId("stock-skeleton-row");
    expect(skeletonRows.length).toBe(8);
  });

  it("opens consignment PO details modal when clicking consignment number in ordered breakup", async () => {
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    // Open ordered breakup modal
    const orderedBtn = screen.getAllByLabelText("View Mumbai Ordered Consignment Breakup")[0];
    fireEvent.click(orderedBtn);

    await waitFor(() => {
      expect(screen.getByText("CON-2026-99")).toBeTruthy();
    });

    // Click consignment number link
    fireEvent.click(screen.getByText("CON-2026-99"));

    await waitFor(() => {
      expect(screen.getByTestId("consignment-detail-modal")).toBeTruthy();
      expect(screen.getByText(/Consignment Details: CON-2026-99/i)).toBeTruthy();
      expect(screen.getByText(/ETA Port Date:/i)).toBeTruthy();
      expect(screen.getByText(/ETD Origin Date:/i)).toBeTruthy();
    });

    // Close consignment details
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("consignment-detail-modal")).toBeNull();
  });

  it("displays company name directly beneath the SO number in stock transaction popup", async () => {
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    // Find and click Mumbai physical stock (i) button on Sensor (Banding)
    const mumbaiPhysicalBtn = screen.getAllByLabelText("View Mumbai Sale Order Information")[0];
    expect(mumbaiPhysicalBtn).toBeTruthy();
    fireEvent.click(mumbaiPhysicalBtn);

    await waitFor(() => {
      expect(screen.getByTestId("stock-breakup-modal")).toBeTruthy();
    });

    // Verify SO number is rendered
    expect(screen.getByText("SO-2026-001")).toBeTruthy();

    // Verify company name is rendered directly beneath SO number with testid
    const companySub = screen.getByTestId("stock-popup-company-sub");
    expect(companySub).toBeTruthy();
    expect(companySub.textContent).toBe("Acme Packaging");
  });

  it("switches to Goods Expected Date Report tab and displays machine lookup report", async () => {
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    // Click tab to switch
    const goodsTab = screen.getByTestId("tab-goods-expected");
    expect(goodsTab).toBeTruthy();
    fireEvent.click(goodsTab);

    // Wait for goods expected view to render
    await waitFor(() => {
      expect(screen.getByLabelText("Machine lookup")).toBeTruthy();
      expect(screen.getByLabelText("Goods Expected Date Report Table")).toBeTruthy();
    });

    // Check table headers
    expect(screen.getByText("Machine / Product Name")).toBeTruthy();
    expect(screen.getByText("Container / Consignment No")).toBeTruthy();
    expect(screen.getByText("ETD (Origin)")).toBeTruthy();
    expect(screen.getByText("ETA Port")).toBeTruthy();
    expect(screen.getByText("Expected Arrival")).toBeTruthy();

    // Check that items are displayed
    expect(screen.getByText("Continuous Band Sealer With Nitrogen Flushing")).toBeTruthy();
    expect(screen.getByText("CON-INHYMA-2026-004")).toBeTruthy();
    expect(screen.getByText("04-05-2026")).toBeTruthy();
  });

  it("filters goods expected report by machine name lookup", async () => {
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    // Switch to goods expected tab
    fireEvent.click(screen.getByTestId("tab-goods-expected"));

    await waitFor(() => {
      expect(screen.getByLabelText("Machine lookup")).toBeTruthy();
    });

    const searchInput = screen.getByLabelText("Machine lookup");
    fireEvent.change(searchInput, { target: { value: "Shrink" } });

    await waitFor(() => {
      expect(screen.getByText("Automatic Shrink Tunnel 4020")).toBeTruthy();
      expect(screen.queryByText("Continuous Band Sealer With Nitrogen Flushing")).toBeNull();
    });
  });

  it("opens container/consignment details modal from Goods Expected Date Report", async () => {
    render(
      <BrowserRouter>
        <ProductStockPage />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByTestId("tab-goods-expected"));

    await waitFor(() => {
      expect(screen.getByText("CON-INHYMA-2026-004")).toBeTruthy();
    });

    // Click container button/link
    fireEvent.click(screen.getByText("CON-INHYMA-2026-004"));

    await waitFor(() => {
      expect(screen.getByTestId("consignment-detail-modal")).toBeTruthy();
      expect(screen.getByText(/Consignment Details: CON-INHYMA-2026-004/i)).toBeTruthy();
      expect(screen.getByText(/ETD Origin Date:/i)).toBeTruthy();
      expect(screen.getByText(/ETA Port Date:/i)).toBeTruthy();
    });
  });
});

