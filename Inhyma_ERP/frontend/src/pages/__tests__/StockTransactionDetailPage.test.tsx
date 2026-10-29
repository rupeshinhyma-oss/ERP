import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { StockTransactionDetailPage } from "../StockTransactionDetailPage";
import { InventoryApi } from "@/lib/api";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

vi.mock("xlsx", () => ({
  utils: {
    json_to_sheet: vi.fn(() => ({})),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
}));

const MOCK_LEDGER_RESPONSE = {
  data: {
    product: {
      id: "prod-1442",
      product_id: "prod-1442",
      stock_id: "stock-1442",
      sr_no: 1,
      product_name_tally: "Air Timer (PFS)",
      product_code: "-",
      brand: "Yinglima",
      category: "Spares",
      sub_category: "Spares For FFS / Weighing Machines",
      uom: "NOS",
      available_qty: 0,
      filtered_available_qty: 0,
      physical_qty: 0,
      warehouses: {
        mumbai: 0,
        mumbai_transit: 3,
        mumbai_ordered: 0,
        ahmedabad: 0,
        ahmedabad_transit: 0,
        ahmedabad_ordered: 0,
        indore: 0,
        indore_transit: 0,
        indore_ordered: 0,
      },
    },
    items: [
      {
        id: 32154,
        entry_uid: "so-1",
        title: "Sale Order #SO-MH/26-27/4987 Confirm",
        party_name: "VRO MACHINES PVT.LTD.",
        type: "Sale",
        warehouse: "Mumbai",
        quantity: -1,
        quantity_display: "- 1",
        created_by: "Bhavin Suthar",
        transaction_date: "28-10-2026 12:10 PM",
        iso_date: "2026-10-28",
        sort_epoch: 1793199000,
        ref_type: "sale_order",
        ref_id: "so-uuid-4987",
        ref_no: "SO-MH/26-27/4987",
      },
      {
        id: 32129,
        entry_uid: "adj-1",
        title: "Stock In For Purpose Opening Stock (Adjustment Order #608)",
        party_name: null,
        type: "Stock IN",
        warehouse: "Mumbai",
        quantity: 1,
        quantity_display: "+ 1",
        created_by: "Akshata Wadekar",
        transaction_date: "28-10-2026 11:38 AM",
        iso_date: "2026-10-28",
        sort_epoch: 1793197080,
        ref_type: "stock_adjustment",
        ref_id: "adj-uuid-608",
        ref_no: "608",
      },
    ],
    total: 2,
    filter_options: {
      warehouses: ["Mumbai", "Mumbai Transit"],
      types: ["Sale", "Stock IN"],
    },
  },
};

describe("StockTransactionDetailPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(InventoryApi, "getProductStockTransactions").mockResolvedValue(
      MOCK_LEDGER_RESPONSE as any
    );
  });

  it("renders '<Product Name> Stock' header, AVAILABLE QTY card, and 7 ledger columns matching Screenshot 3", async () => {
    render(
      <MemoryRouter initialEntries={["/stock-transaction/list/prod-1442"]}>
        <Routes>
          <Route path="/stock-transaction/list/:id" element={<StockTransactionDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Air Timer (PFS) Stock" })).toBeTruthy();
    });

    expect(screen.getByTestId("app-shell").getAttribute("data-active-key")).toBe(
      "reports-stock-transactions"
    );
    expect(screen.getByText("AVAILABLE QTY")).toBeTruthy();
    expect(screen.getByTestId("available-qty-value").textContent).toBe("0");

    // 7 column headers
    for (const col of [
      "ID",
      "Title",
      "Type",
      "Warehouse",
      "Quantity",
      "Created By",
      "Transaction Date",
    ]) {
      expect(screen.getByText(col)).toBeTruthy();
    }

    // Both ledger entries + bold company name under SO#
    expect(screen.getByText("32154")).toBeTruthy();
    expect(screen.getByText("Sale Order #SO-MH/26-27/4987 Confirm")).toBeTruthy();
    expect(screen.getByText("VRO MACHINES PVT.LTD.")).toBeTruthy();
    expect(screen.getByText("Bhavin Suthar")).toBeTruthy();
    expect(screen.getByText("28-10-2026 12:10 PM")).toBeTruthy();

    expect(screen.getByText("32129")).toBeTruthy();
    expect(
      screen.getByText("Stock In For Purpose Opening Stock (Adjustment Order #608)")
    ).toBeTruthy();
    expect(screen.getByText("Akshata Wadekar")).toBeTruthy();

    expect(screen.getByTestId("stock-tx-showing").textContent).toBe(
      "Showing 1 To 2 Of 2 Entries"
    );
  });

  it("supports live search, warehouse filter updating AVAILABLE QTY, and Action Excel export", async () => {
    const XLSX = await import("xlsx");

    render(
      <MemoryRouter initialEntries={["/stock-transaction/list/prod-1442"]}>
        <Routes>
          <Route path="/stock-transaction/list/:id" element={<StockTransactionDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("VRO MACHINES PVT.LTD.")).toBeTruthy();
    });

    // Live search filters rows
    const searchInput = screen.getByPlaceholderText("Search...");
    fireEvent.change(searchInput, { target: { value: "Akshata" } });
    expect(screen.getByText("Akshata Wadekar")).toBeTruthy();
    expect(screen.queryByText("VRO MACHINES PVT.LTD.")).toBeNull();
    expect(screen.getByTestId("stock-tx-showing").textContent).toBe(
      "Showing 1 To 1 Of 1 Entries"
    );

    // Clear search
    fireEvent.change(searchInput, { target: { value: "" } });

    // Open Filter panel and filter by Mumbai Transit -> AVAILABLE QTY updates to 3
    fireEvent.click(screen.getByLabelText("Filter"));
    fireEvent.change(screen.getByLabelText("Warehouse"), {
      target: { value: "Mumbai Transit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByTestId("available-qty-value").textContent).toBe("3");

    // Reset restores AVAILABLE QTY to 0
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByTestId("available-qty-value").textContent).toBe("0");

    // Action dropdown -> Export to Excel (.xlsx)
    fireEvent.click(screen.getByRole("button", { name: /Action/i }));
    fireEvent.click(screen.getByText("Export to Excel (.xlsx)"));

    await waitFor(() => {
      expect(XLSX.writeFile).toHaveBeenCalledWith(
        expect.anything(),
        "Air_Timer_PFS__Stock_Transactions.xlsx"
      );
    });
  });
});
