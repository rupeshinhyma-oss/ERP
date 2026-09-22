import { describe, it, expect, vi } from "vitest";
import { generateProformaInvoicePdf, formatPdfCurrency } from "../proformaInvoicePdf";
import { INITIAL_PROFORMA_ITEMS } from "@/pages/ProformaInvoicesPage";
import jsPDF from "jspdf";

describe("proformaInvoicePdf", () => {
  describe("formatPdfCurrency", () => {
    it("formats amounts in Indian currency notation with Rs. prefix", () => {
      expect(formatPdfCurrency(182900)).toBe("Rs. 1,82,900.00");
      expect(formatPdfCurrency(0)).toBe("Rs. 0.00");
      expect(formatPdfCurrency(27900)).toBe("Rs. 27,900.00");
      expect(formatPdfCurrency(null)).toBe("Rs. 0.00");
    });
  });

  describe("generateProformaInvoicePdf", () => {
    it("creates a valid jsPDF document instance from proforma item", () => {
      const item = INITIAL_PROFORMA_ITEMS[0]; // PI-MH/26-27/1714 ELITE PACK INDIA
      const doc = generateProformaInvoicePdf(item, { saveFile: false, openInNewTab: false });

      expect(doc).toBeDefined();
      expect(doc.output("datauristring")).toContain("data:application/pdf");
    });

    it("calls doc.save with 'proforma_invoice.pdf' when saveFile is true", () => {
      const item = INITIAL_PROFORMA_ITEMS[0];
      const doc = new jsPDF();
      const saveSpy = vi.spyOn(doc, "save").mockImplementation(() => doc);

      generateProformaInvoicePdf(item, { saveFile: true, openInNewTab: false, doc });
      expect(saveSpy).toHaveBeenCalledWith("proforma_invoice.pdf");
    });

    it("handles an item without line items gracefully", () => {
      const item = { ...INITIAL_PROFORMA_ITEMS[0], items: [] };
      const doc = generateProformaInvoicePdf(item, { saveFile: false, openInNewTab: false });

      expect(doc).toBeDefined();
      expect(doc.output("datauristring")).toContain("data:application/pdf");
    });
  });
});
