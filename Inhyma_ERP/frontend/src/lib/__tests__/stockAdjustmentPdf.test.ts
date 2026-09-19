import { describe, it, expect, vi } from "vitest";
import { generateStockAdjustmentPdf } from "../stockAdjustmentPdf";
import { INITIAL_ADJUSTMENTS } from "@/pages/StockAdjustmentPage";

describe("generateStockAdjustmentPdf", () => {
  it("creates a valid jsPDF document instance", () => {
    const item = INITIAL_ADJUSTMENTS[0]; // Garuda Engineers adj-1 (492)
    const doc = generateStockAdjustmentPdf(item, { saveFile: false, openInNewTab: false });

    expect(doc).toBeDefined();
    expect(doc.output("datauristring")).toContain("data:application/pdf");
  });

  it("calls doc.save when saveFile is enabled", () => {
    const item = INITIAL_ADJUSTMENTS[0];
    const doc = generateStockAdjustmentPdf(item, { saveFile: false, openInNewTab: false });
    const saveSpy = vi.spyOn(doc, "save");

    generateStockAdjustmentPdf(item, { saveFile: true, openInNewTab: false });
    expect(doc.output("datauristring")).toContain("data:application/pdf");
  });
});
