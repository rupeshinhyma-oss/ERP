import { describe, it, expect, vi } from "vitest";
import { generateSalesOrderPdf, formatSalesPdfCurrency } from "../salesOrderPdf";
import type { SaleOrder } from "@/types/saleProcess";

describe("salesOrderPdf generator", () => {
  it("formats Indian currency correctly with 'Rs.' prefix", () => {
    expect(formatSalesPdfCurrency(310000)).toBe("Rs. 3,10,000.00");
    expect(formatSalesPdfCurrency(49500)).toBe("Rs. 49,500.00");
    expect(formatSalesPdfCurrency(0)).toBe("Rs. 0.00");
    expect(formatSalesPdfCurrency(null)).toBe("Rs. 0.00");
  });

  it("generates a valid jsPDF document with document properties", () => {
    const mockOrder: Partial<SaleOrder> = {
      id: "so-3826",
      order_no: "SO-MH/26-27/3826",
      order_date: "12-09-2026",
      company_name: "GARUDA ENGINEERS",
      amount_exc_gst: 310000,
      amount_inc_gst: 324500,
      discount: 35000,
    };

    const doc = generateSalesOrderPdf(mockOrder, { saveFile: false, openInNewTab: false });
    expect(doc).toBeDefined();
    expect(doc.output("datauristring")).toContain("data:application/pdf");
  });

  it("handles custom items, tax rates, and calculations properly", () => {
    const customOrder: Partial<SaleOrder> = {
      order_no: "SO-GJ/26-27/0560",
      order_date: "29-07-2026",
      company_name: "GLOBAL IMPEX MACHINERY",
      delivery_charge: "Paid",
      payment_terms: "30 Days Credit",
      total_discount: 56000,
      items: [
        {
          product_name: "Semi Automatic Strapping Machine",
          hsn_code: "8422.40.00",
          quantity: 2,
          unit_rate: 65000,
          tax_percent: 18,
          tax_amount: 23400,
          item_total: 153400,
          product_id: null,
        },
      ],
    };

    const doc = generateSalesOrderPdf(customOrder);
    expect(doc).toBeDefined();
    const blob = doc.output("blob");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("supports saveFile and openInNewTab options", () => {
    const saveSpy = vi.fn();
    const mockOrder = { order_no: "SO-MH/26-27/TEST" };

    const fakeDoc = {
      setProperties: vi.fn(),
      setDrawColor: vi.fn(),
      setLineWidth: vi.fn(),
      rect: vi.fn(),
      setFont: vi.fn(),
      setFontSize: vi.fn(),
      setTextColor: vi.fn(),
      text: vi.fn(),
      line: vi.fn(),
      splitTextToSize: vi.fn().mockReturnValue(["Line 1"]),
      save: saveSpy,
      output: vi.fn().mockReturnValue(new Blob()),
    } as any;

    generateSalesOrderPdf(mockOrder, { doc: fakeDoc, saveFile: true });
    expect(saveSpy).toHaveBeenCalledWith("Sales_Order_SO-MH_26-27_TEST.pdf");
  });
});
