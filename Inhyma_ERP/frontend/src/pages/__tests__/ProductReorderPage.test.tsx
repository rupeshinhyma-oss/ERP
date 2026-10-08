import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { ProductReorderPage, INITIAL_REORDER_ITEMS } from "../ProductReorderPage";
import { InventoryApi } from "@/lib/api";
import * as salesPdfModule from "@/lib/salesOrderPdf";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock sales order PDF generator
vi.spyOn(salesPdfModule, "generateSalesOrderPdf").mockReturnValue({} as any);

describe("ProductReorderPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(InventoryApi, "listProductReorder").mockResolvedValue({
      data: { items: INITIAL_REORDER_ITEMS },
    } as any);

    vi.spyOn(InventoryApi, "getProductStockBreakup").mockImplementation((({ type }: { type: string }) => {
      if (type === "physical") {
        return Promise.resolve({
          data: {
            items: [
              {
                sr_no: 1,
                order_no: "SO-MH/26-27/0432",
                order_date: "12-07-2026",
                company_name: "VN GOURMET LLT",
                city_state: "Mumbai, Maharashtra",
                quantity: 1,
                status: "Acc. Confirmed",
                sales_person: "Inhyma Admin",
                delivery_date: "25-07-2026",
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
              consignment_no: "EXP-26",
              invoice_no: "EXP-26",
              date: "10-07-2026",
              supplier_name: "Yinglima Machinery Co.",
              quantity: 2,
              arrival_date: "15-08-2026",
              status: "In Transit",
            },
          ],
        },
      });
    }) as any);
  });

  it("renders page title and active navigation key", async () => {
    render(
      <BrowserRouter>
        <ProductReorderPage />
      </BrowserRouter>
    );

    expect(screen.getByText("Product Re-Order")).toBeTruthy();
    expect(screen.getByTestId("app-shell").getAttribute("data-active-key")).toBe("reports-re-order");
  });

  it("renders the 16 core table headers including Re-Order, Short Fall, MOQ, and Order To Be Place", async () => {
    render(
      <BrowserRouter>
        <ProductReorderPage />
      </BrowserRouter>
    );

    expect(screen.getByText("Sr. No.")).toBeTruthy();
    expect(screen.getByText("Product Name (As Per Tally)")).toBeTruthy();
    expect(screen.getByText("Total Qty")).toBeTruthy();
    expect(screen.getAllByText("Re-Order").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Short Fall").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("MOQ")).toBeTruthy();
    expect(screen.getByText("Order To Be Place")).toBeTruthy();
  });

  it("renders the Short Fall and Re-Order dropdowns with exact options (All, 0, Greater Than 0)", async () => {
    render(
      <BrowserRouter>
        <ProductReorderPage />
      </BrowserRouter>
    );

    const shortfallSelect = screen.getByLabelText("Short Fall") as HTMLSelectElement;
    expect(shortfallSelect).toBeTruthy();
    const sfOptions = Array.from(shortfallSelect.options).map((o) => o.text);
    expect(sfOptions).toEqual(["All", "0", "Greater Than 0"]);

    const reorderSelect = screen.getByLabelText("Re-Order") as HTMLSelectElement;
    expect(reorderSelect).toBeTruthy();
    const roOptions = Array.from(reorderSelect.options).map((o) => o.text);
    expect(roOptions).toEqual(["All", "0", "Greater Than 0"]);
  });

  it("renders the seed items from screenshot (Limit Switch, Bolt, DBF900L)", async () => {
    render(
      <BrowserRouter>
        <ProductReorderPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Limit Switch (DQL5545)")).toBeTruthy();
      expect(screen.getByText("Bolt 992-8M")).toBeTruthy();
      expect(screen.getByText("DBF900L Band Sealer MSV With Nitrogen Kit")).toBeTruthy();
    });
  });

  it("opens Sale Order Information drawer on physical stock info click and shows clickable SO number and company name", async () => {
    render(
      <BrowserRouter>
        <ProductReorderPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("DBF900L Band Sealer MSV With Nitrogen Kit")).toBeTruthy();
    });

    // Find and click the (i) button
    const infoButtons = screen.getAllByRole("button", { name: /View Mumbai Sale Order Information/i });
    expect(infoButtons.length).toBeGreaterThan(0);
    fireEvent.click(infoButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Sale Order Information")).toBeTruthy();
      expect(screen.getByText("SO-MH/26-27/0432")).toBeTruthy();
      expect(screen.getByText("VN GOURMET LLT")).toBeTruthy();
    });

    // Clicking SO number calls generateSalesOrderPdf
    const soLink = screen.getByText("SO-MH/26-27/0432");
    fireEvent.click(soLink);
    expect(salesPdfModule.generateSalesOrderPdf).toHaveBeenCalled();
  });

  it("opens edit modal when clicking Re-Order or MOQ link", async () => {
    render(
      <BrowserRouter>
        <ProductReorderPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("DBF900L Band Sealer MSV With Nitrogen Kit")).toBeTruthy();
    });

    const editLinks = screen.getAllByTitle(/Click to edit Re-Order Level threshold/i);
    expect(editLinks.length).toBeGreaterThan(0);
    fireEvent.click(editLinks[0]);

    expect(screen.getByText("Edit Re-Order & MOQ Thresholds")).toBeTruthy();
    expect(screen.getByLabelText(/Re-Order Level \(Threshold\)/i)).toBeTruthy();
    expect(screen.getByLabelText(/Minimum Order Quantity \(MOQ\)/i)).toBeTruthy();
  });

  it("filters items by search keyword", async () => {
    render(
      <BrowserRouter>
        <ProductReorderPage />
      </BrowserRouter>
    );

    const searchInput = screen.getByPlaceholderText(/Search products by name/i);
    fireEvent.change(searchInput, { target: { value: "Limit Switch" } });

    await waitFor(() => {
      expect(screen.getByText("Limit Switch (DQL5545)")).toBeTruthy();
      expect(screen.queryByText("Bolt 992-8M")).toBeNull();
    });
  });
});
