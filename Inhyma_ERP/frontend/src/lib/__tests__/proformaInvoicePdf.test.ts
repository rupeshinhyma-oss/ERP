import { describe, it, expect, vi } from "vitest";
import { generateProformaInvoicePdf, formatPdfCurrency } from "../proformaInvoicePdf";
import { PROFORMA_FIXTURE_ITEMS } from "./fixtures/proformaInvoices";
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
      const item = PROFORMA_FIXTURE_ITEMS[0]; // PI-MH/26-27/1714 ELITE PACK INDIA
      const doc = generateProformaInvoicePdf(item, { saveFile: false, openInNewTab: false });

      expect(doc).toBeDefined();
      expect(doc.output("datauristring")).toContain("data:application/pdf");
    });

    it("calls doc.save with 'proforma_invoice.pdf' when saveFile is true", () => {
      const item = PROFORMA_FIXTURE_ITEMS[0];
      const doc = new jsPDF();
      const saveSpy = vi.spyOn(doc, "save").mockImplementation(() => doc);

      generateProformaInvoicePdf(item, { saveFile: true, openInNewTab: false, doc });
      expect(saveSpy).toHaveBeenCalledWith("proforma_invoice.pdf");
    });

    it("handles an item without line items gracefully", () => {
      const item = { ...PROFORMA_FIXTURE_ITEMS[0], items: [] };
      const doc = generateProformaInvoicePdf(item, { saveFile: false, openInNewTab: false });

      expect(doc).toBeDefined();
      expect(doc.output("datauristring")).toContain("data:application/pdf");
    });

    it("takes the company logo from ERP settings options and renders it with addImage", () => {
      const item = PROFORMA_FIXTURE_ITEMS[0];
      const doc = new jsPDF();
      const addImageSpy = vi.spyOn(doc, "addImage").mockImplementation(() => doc);

      const customLogo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

      generateProformaInvoicePdf(item, {
        doc,
        logoUrl: customLogo,
        orgProfile: {
          company_name: "Inhyma Solutions LLP",
          address: "Office No 421, Supremus-II, Road No-22, Wagle Estate",
          city: "Thane",
          state: "Maharashtra",
          postal_code: "400604",
          gst_number: "27AAKFI9869H1ZL",
          email: "payment.darsh@gmail.com",
          phone: "+91 96532 61742",
        },
      });

      expect(addImageSpy).toHaveBeenCalledWith(
        customLogo,
        "PNG",
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        undefined,
        "FAST"
      );
    });

    it("falls back to default INHYMA_LOGO_BASE64 when custom logoUrl is omitted", () => {
      const item = PROFORMA_FIXTURE_ITEMS[0];
      const doc = new jsPDF();
      const addImageSpy = vi.spyOn(doc, "addImage").mockImplementation(() => doc);

      generateProformaInvoicePdf(item, { doc });

      expect(addImageSpy).toHaveBeenCalled();
    });
  });
});