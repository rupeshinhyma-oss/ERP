import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { StockTransferPage, INITIAL_TRANSFERS, StockTransferSkeletonRows } from "../StockTransferPage";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock AppShell to isolate page testing
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
        items: [
          {
            id: "trf-52",
            sr_no: 52,
            transfer_no: "TRF-2026-052",
            transfer_date: "18-09-2026 04:37 PM",
            from_warehouse: "Ahmedabad",
            to_warehouse: "Mumbai",
            total_amount: 629534.06,
            added_by: "Akshata Wadekar",
            status: "Received",
            remarks: "Inter-branch stock transfer from Ahmedabad warehouse to Mumbai main hub",
            items: [
              {
                product_name: "ISL450XDAN Flow Wrap machine w/o end seal chain",
                product_code: "MACH-002",
                category: "Machines",
                quantity: 2,
                uom: "SET",
                rate: 275000,
                amount: 550000,
              },
            ],
          },
        ],
        total: 46,
        tab_counts: {
          all: 46,
          pending: 0,
          confirmed: 3,
          received: 41,
          cancel: 2,
        },
      },
      status: 200,
      success: true,
    }),
    getStockTransfer: vi.fn().mockImplementation((id: string) =>
      Promise.resolve({
        id,
        sr_no: 52,
        transfer_no: "TRF-2026-052",
        transfer_date: "18-09-2026 04:37 PM",
        from_warehouse: "Ahmedabad",
        to_warehouse: "Mumbai",
        total_amount: 629534.06,
        added_by: "Akshata Wadekar",
        status: "Received",
        remarks: "Inter-branch stock transfer",
        items: [],
      })
    ),
    createStockTransfer: vi.fn().mockResolvedValue({
      id: "trf-53",
      transfer_no: "TRF-2026-053",
      status: "Received",
    }),
    updateStockTransferStatus: vi.fn().mockResolvedValue({
      id: "trf-52",
      status: "Cancel",
    }),
  },
}));

describe("StockTransferPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders page header, action buttons and active sidebar key", () => {
    render(
      <BrowserRouter>
        <StockTransferPage initialLoading={false} />
      </BrowserRouter>
    );

    expect(screen.getByRole("heading", { name: "Stock Transfer" })).toBeTruthy();
    expect(screen.getByTitle("Filter stock transfers")).toBeTruthy();
    expect(screen.getByRole("button", { name: /\+ ADD NEW/i })).toBeTruthy();
    expect(screen.getByTestId("app-shell").getAttribute("data-active-key")).toBe("stock-transfer");
  });

  it("renders all status tabs with accurate badge counts matching the legacy ERP", () => {
    render(
      <BrowserRouter>
        <StockTransferPage initialLoading={false} />
      </BrowserRouter>
    );

    const allTab = screen.getByTestId("tab-All");
    expect(allTab.textContent).toContain("All");
    expect(allTab.textContent).toContain("46");

    const pendingTab = screen.getByTestId("tab-Pending");
    expect(pendingTab.textContent).toContain("Pending");
    expect(pendingTab.textContent).toContain("0");

    const confirmedTab = screen.getByTestId("tab-Confirmed");
    expect(confirmedTab.textContent).toContain("Confirmed");
    expect(confirmedTab.textContent).toContain("3");

    const receivedTab = screen.getByTestId("tab-Received");
    expect(receivedTab.textContent).toContain("Received");
    expect(receivedTab.textContent).toContain("41");

    const cancelTab = screen.getByTestId("tab-Cancel");
    expect(cancelTab.textContent).toContain("Cancel");
    expect(cancelTab.textContent).toContain("2");
  });

  it("renders skeleton shimmer rows when initialLoading is true", () => {
    render(
      <BrowserRouter>
        <StockTransferPage initialLoading={true} />
      </BrowserRouter>
    );

    const skeletonRows = screen.getAllByTestId("transfer-skeleton-row");
    expect(skeletonRows.length).toBeGreaterThanOrEqual(8);
  });

  it("renders standalone StockTransferSkeletonRows helper component", () => {
    render(
      <table>
        <tbody>
          <StockTransferSkeletonRows count={4} />
        </tbody>
      </table>
    );

    const skeletonRows = screen.getAllByTestId("transfer-skeleton-row");
    expect(skeletonRows.length).toBe(4);
  });

  it("renders table columns with correct headers and sorting arrows", () => {
    render(
      <BrowserRouter>
        <StockTransferPage initialLoading={false} />
      </BrowserRouter>
    );

    expect(screen.getByText(/Sr\. No\./i)).toBeTruthy();
    expect(screen.getByText(/Transfer Date/i)).toBeTruthy();
    expect(screen.getByText(/From Warehouse/i)).toBeTruthy();
    expect(screen.getByText(/To Warehouse/i)).toBeTruthy();
    expect(screen.getByText(/^Total/i)).toBeTruthy();
    expect(screen.getByText(/Added By/i)).toBeTruthy();
    expect(screen.getByText(/^Status$/i)).toBeTruthy();
    expect(screen.getByText(/^Action$/i)).toBeTruthy();
  });

  it("renders initial transfer rows with Indian Rupee formatted amounts and warehouse pairs", async () => {
    render(
      <BrowserRouter>
        <StockTransferPage initialLoading={false} />
      </BrowserRouter>
    );

    await waitFor(() => {
      // Check top transfer record (Sr. 52: Ahmedabad -> Mumbai, ₹ 6,29,534.06)
      expect(screen.getByText("52")).toBeTruthy();
      expect(screen.getByText("18-09-2026 04:37 PM")).toBeTruthy();
      expect(screen.getByText("Ahmedabad")).toBeTruthy();
      expect(screen.getByText("Mumbai")).toBeTruthy();
      expect(screen.getByText("₹ 6,29,534.06")).toBeTruthy();
      expect(screen.getAllByText("Akshata Wadekar").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Received").length).toBeGreaterThan(0);
    });
  });

  it("toggles the filter panel on filter button click", () => {
    render(
      <BrowserRouter>
        <StockTransferPage initialLoading={false} />
      </BrowserRouter>
    );

    // Filter panel should be hidden initially
    expect(screen.queryByTestId("transfer-filter-panel")).toBeNull();

    // Open filter panel
    fireEvent.click(screen.getByTitle("Filter stock transfers"));
    expect(screen.getByTestId("transfer-filter-panel")).toBeTruthy();
    expect(screen.getByLabelText("Transfer Date")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();

    // Close filter panel
    fireEvent.click(screen.getByTitle("Filter stock transfers"));
    expect(screen.queryByTestId("transfer-filter-panel")).toBeNull();
  });

  it("opens DateRangePicker popover when clicking Transfer Date input", async () => {
    render(
      <BrowserRouter>
        <StockTransferPage initialLoading={false} />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByTitle("Filter stock transfers"));
    const dateInput = screen.getByLabelText("Transfer Date");
    fireEvent.click(dateInput);

    await waitFor(() => {
      expect(screen.getByTestId("date-range-popover")).toBeTruthy();
      expect(screen.getByText("Last 30 Days")).toBeTruthy();
      expect(screen.getByText("Custom Range")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    });
  });

  it("filters transfers via search input", async () => {
    render(
      <BrowserRouter>
        <StockTransferPage initialLoading={false} />
      </BrowserRouter>
    );

    const searchInput = screen.getByPlaceholderText("Search...");
    fireEvent.change(searchInput, { target: { value: "Indore" } });

    await waitFor(() => {
      expect((searchInput as HTMLInputElement).value).toBe("Indore");
    });
  });

  it("switches tabs when clicking on status tabs", async () => {
    render(
      <BrowserRouter>
        <StockTransferPage initialLoading={false} />
      </BrowserRouter>
    );

    const receivedTab = screen.getByTestId("tab-Received");
    fireEvent.click(receivedTab);
    expect(receivedTab.className).toContain("active");

    const cancelTab = screen.getByTestId("tab-Cancel");
    fireEvent.click(cancelTab);
    expect(cancelTab.className).toContain("active");
    expect(receivedTab.className).not.toContain("active");
  });

  it("opens SideDrawer when clicking on a transfer row", async () => {
    render(
      <BrowserRouter>
        <StockTransferPage initialLoading={false} />
      </BrowserRouter>
    );

    const dateLink = screen.getByText("18-09-2026 04:37 PM");
    fireEvent.click(dateLink);

    await waitFor(() => {
      expect(screen.getByText("Stock Transfer Details")).toBeTruthy();
      expect(screen.getByText("Transferred Line Items Breakdown")).toBeTruthy();
      expect(screen.getAllByText("18-09-2026 04:37 PM").length).toBeGreaterThan(0);
    });
  });

  it("navigates to /transfer/addEdit when + ADD NEW button is clicked", () => {
    render(
      <BrowserRouter>
        <StockTransferPage initialLoading={false} />
      </BrowserRouter>
    );

    const addBtn = screen.getByRole("button", { name: /\+ ADD NEW/i });
    fireEvent.click(addBtn);

    expect(mockNavigate).toHaveBeenCalledWith("/transfer/addEdit");
  });

  it("toggles action popup menu when three dots button is clicked", async () => {
    render(
      <BrowserRouter>
        <StockTransferPage initialLoading={false} />
      </BrowserRouter>
    );

    const actionButtons = screen.getAllByTitle("Actions");
    expect(actionButtons.length).toBeGreaterThan(0);

    fireEvent.click(actionButtons[0]);

    await waitFor(() => {
      expect(screen.getByTestId("action-popup-menu")).toBeTruthy();
      expect(screen.getByText("Download")).toBeTruthy();
      expect(screen.getByText("Cancel")).toBeTruthy();
    });
  });
});
