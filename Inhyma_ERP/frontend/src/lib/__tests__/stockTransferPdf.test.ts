import { describe, it, expect } from "vitest";
import { generateStockTransferPdf, formatRs, extractDateOnly, TRANSFER_52_EXACT_ITEMS } from "../stockTransferPdf";
import { INITIAL_TRANSFERS } from "@/pages/StockTransferPage";

describe("stockTransferPdf", () => {
  it("formats Indian rupees with Rs. prefix correctly", () => {
    expect(formatRs(37494.85)).toBe("Rs.37,494.85");
    expect(formatRs(112484.55)).toBe("Rs.1,12,484.55");
    expect(formatRs(629534.06)).toBe("Rs.6,29,534.06");
  });

  it("extracts date only from transfer_date string", () => {
    expect(extractDateOnly("18-09-2026 04:37 PM")).toBe("18-09-2026");
    expect(extractDateOnly("")).toBe("18-09-2026");
  });

  it("has exactly 9 line items totaling 19 qty and Rs.6,29,534.06 for transfer 52", () => {
    expect(TRANSFER_52_EXACT_ITEMS.length).toBe(9);
    const totalQty = TRANSFER_52_EXACT_ITEMS.reduce((sum, it) => sum + it.quantity, 0);
    const totalAmt = TRANSFER_52_EXACT_ITEMS.reduce((sum, it) => sum + it.amount, 0);
    expect(totalQty).toBe(19);
    expect(Math.round(totalAmt * 100) / 100).toBe(629534.06);
  });

  it("creates a valid jsPDF document instance for transfer 52", () => {
    const item = INITIAL_TRANSFERS[0]; // Transfer 52
    const doc = generateStockTransferPdf(item, { saveFile: false, openInNewTab: false });

    expect(doc).toBeDefined();
    expect(doc.output("datauristring")).toContain("data:application/pdf");
  });

  it("generates and saves document when saveFile is true", () => {
    const item = INITIAL_TRANSFERS[0];
    const doc = generateStockTransferPdf(item, { saveFile: true, openInNewTab: false });
    expect(doc.output("datauristring")).toContain("data:application/pdf");
  });
});
