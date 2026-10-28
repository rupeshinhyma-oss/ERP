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

  it("evaluates branch-scoped Short Fall & Order To Be Place via Warehouse selector and renders (i) on 0 physical stock when breakup_flags includes mumbai", async () => {
    vi.spyOn(InventoryApi, "listProductReorder").mockResolvedValueOnce({
      data: {
        items: [
          {
            id: "air-timer-1",
            sr_no: 1,
            product_id: "prod-air-1",
            product_name_tally: "Air Timer (PFS)",
            product_code: "AT-PFS",
            brand: "Inhyma",
            category: "Spares",
            sub_category: "Spares For PFS",
            uom: "NOS",
            hsn_code: "84229090",
            gst_percent: 18,
            import_duty_percent: 7.5,
            minimum_price: 4200,
            packaging_quantity: 1,
            length_cm: 20,
            width_cm: 15,
            height_cm: 10,
            packaging_unit_cbm: 0.01,
            mumbai: 0,
            mumbai_transit: 0,
            mumbai_ordered: 0,
            ahmedabad: 0,
            ahmedabad_transit: 0,
            ahmedabad_ordered: 0,
            indore: 41,
            indore_transit: 0,
            indore_ordered: 0,
            total_qty: 41,
            reorder_level: 5,
            short_fall: 5,
            moq: 8,
            order_to_be_place: 8,
            breakup_flags: ["mumbai", "mumbai_transit"],
            warehouse_thresholds: {
              mumbai: { reorder_level: 5, moq: 8 },
              indore: { reorder_level: 10, moq: 5 },
            },
          },
        ],
      },
    } as any);

    render(
      <BrowserRouter>
        <ProductReorderPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Air Timer (PFS)")).toBeTruthy();
    });

    // Default warehouse is Mumbai (per screenshot): Mumbai pipeline=0, reorder=5, shortfall=5, moq=8 -> order_to_be_place=8
    const whSelect = screen.getByLabelText("Warehouse") as HTMLSelectElement;
    expect(whSelect.value).toBe("Mumbai");
    expect(screen.getByText("1–1")).toBeTruthy();
    expect(screen.getByText("5", { selector: ".reorder-shortfall-alert" })).toBeTruthy();
    expect(screen.getByText("8", { selector: ".reorder-order-place-badge" })).toBeTruthy();

    // (i) button appears on Mumbai=0 because breakup_flags has "mumbai", and NOT on Indore=41 (no open SO in Indore)
    expect(screen.getByRole("button", { name: /View Mumbai Sale Order Information/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /View Indore Sale Order Information/i })).toBeNull();

    // Switching warehouse to Indore (pipeline=41, reorder=10) clears shortfall to 0
    fireEvent.change(whSelect, { target: { value: "Indore" } });
    await waitFor(() => {
      expect(screen.queryByText("5", { selector: ".reorder-shortfall-alert" })).toBeNull();
    });

    // Clicking Transit (i) opens Consignment Breakup and clicking EXP-26 opens Consignment Details modal
    fireEvent.click(screen.getByRole("button", { name: /View Mumbai Transit Consignment Breakup/i }));
    await waitFor(() => {
      expect(screen.getByText("Consignment Breakup")).toBeTruthy();
      expect(screen.getByText("EXP-26")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("EXP-26"));
    await waitFor(() => {
      expect(screen.getByTestId("reorder-consignment-detail-modal")).toBeTruthy();
      expect(screen.getByText(/Consignment Details: EXP-26/i)).toBeTruthy();
    });

    // Clicking Product Name opens Product Master View Window with HSN & UOM
    fireEvent.click(screen.getByLabelText("Close consignment details"));
    fireEvent.click(screen.getByText("Air Timer (PFS)", { selector: "a.reorder-product-link" }));
    await waitFor(() => {
      expect(screen.getByText("Product Master View Window")).toBeTruthy();
      expect(screen.getByText("84229090")).toBeTruthy();
      expect(screen.getByText("NOS")).toBeTruthy();
    });
  });
});
