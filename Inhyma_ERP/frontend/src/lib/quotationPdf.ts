import jsPDF from "jspdf";
import { INHYMA_LOGO_BASE64 } from "@/lib/inhymaLogoBase64";
import { getCachedBrandName } from "@/lib/brand";

export function formatQuotationCurrency(amount: number | null | undefined, currency: string = "INR"): string {
  const val = typeof amount === "number" && !isNaN(amount) ? amount : 0;
  const prefix = currency === "USD" ? "$ " : currency === "EUR" ? "€ " : "Rs. ";
  return (
    prefix +
    val.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function formatQuotationDate(dtStr: string | null | undefined): string {
  if (!dtStr) return "—";
  try {
    const d = new Date(dtStr);
    if (isNaN(d.getTime())) return dtStr.slice(0, 10);
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dtStr.slice(0, 10);
  }
}

export interface QuotationPdfItem {
  position?: number;
  product_name: string;
  product_code?: string | null;
  description?: string | null;
  specification?: string | null;
  uom?: string;
  quantity: number;
  unit_price: number;
  unit_discount?: number;
  tax_rate?: number;
  taxable_amount?: number;
  tax_amount?: number;
  total_amount: number;
  include_specifications?: boolean;
  demo_link?: string | null;
  include_images?: boolean;
  selected_image_url?: string | null;
}

export interface QuotationPdfData {
  quotation_number: string;
  version: number;
  status?: string;
  quotation_date?: string | null;
  valid_until?: string | null;
  currency?: string;
  customer_name_snapshot?: string | null;
  customer_phone_snapshot?: string | null;
  customer_email_snapshot?: string | null;
  company_name_snapshot?: string | null;
  subtotal: number;
  discount_total?: number;
  tax_total?: number;
  total_amount: number;
  payment_terms?: string | null;
  delivery_terms?: string | null;
  notes?: string | null;
  terms_and_conditions?: string | null;
  created_by_name?: string | null;
  items: QuotationPdfItem[];
}

export interface QuotationPdfOptions {
  openInNewTab?: boolean;
  saveFile?: boolean;
  doc?: jsPDF;
}

/**
 * Generates an official CRM Sales Quotation PDF with exact snapshot preservation,
 * multi-page continuation, page numbering, and clean ERP styling.
 */
export function generateCrmQuotationPdf(
  quotation: QuotationPdfData,
  options?: QuotationPdfOptions
): jsPDF {
  const doc =
    options?.doc ||
    new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 12;
  const contentWidth = pageWidth - margin * 2; // 186mm
  const bottomThreshold = pageHeight - 22; // Leave room for running footer

  const currency = quotation.currency || "INR";
  const brandName = getCachedBrandName() || "Inhyma";

  doc.setProperties({
    title: `Quotation: ${quotation.quotation_number} (v${quotation.version})`,
    subject: "CRM Sales Quotation",
    author: `${brandName} ERP CRM`,
  });

  let currentY = 12;

  // Helper to draw company header & document banner
  const drawHeaderAndBanner = () => {
    // 1. Header Box
    const headerBoxHeight = 28;
    doc.setDrawColor(203, 213, 225); // Slate 300
    doc.setLineWidth(0.3);
    doc.rect(margin, currentY, contentWidth, headerBoxHeight);

    // Try adding Logo image if available
    let hasLogo = false;
    if (INHYMA_LOGO_BASE64) {
      try {
        doc.addImage(INHYMA_LOGO_BASE64, "PNG", margin + 3, currentY + 3, 28, 22);
        hasLogo = true;
      } catch {
        hasLogo = false;
      }
    }

    const brandX = hasLogo ? margin + 34 : margin + 5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(0, 97, 242); // Brand Blue
    doc.text("INHYMA SOLUTIONS LLP", brandX, currentY + 9);

    doc.setFontSize(7.5);
    doc.setTextColor(220, 38, 38); // Tagline Red
    doc.text("YOUR INDUSTRIAL HYPER MARKET", brandX, currentY + 14);

    // Right Company Details
    const compRightX = margin + contentWidth - 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42); // Slate 900
    doc.text("INHYMA SOLUTIONS LLP", compRightX, currentY + 6.5, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(51, 65, 85);
    doc.text(
      "Office No 421, Supremus-II, Road No-22, Wagle Estate, Thane, MH - 400604",
      compRightX,
      currentY + 10.5,
      { align: "right" }
    );
    doc.text(
      "Email: payment.darsh@gmail.com | Phone: +91 9653261742",
      compRightX,
      currentY + 14.5,
      { align: "right" }
    );
    doc.setFont("helvetica", "bold");
    doc.text("GSTIN: 27AAKFI9869H1ZL", compRightX, currentY + 19, { align: "right" });

    currentY += headerBoxHeight + 3;

    // Document Title Banner
    doc.setFillColor(241, 245, 249); // Slate 100
    doc.rect(margin, currentY, contentWidth, 7, "F");
    doc.rect(margin, currentY, contentWidth, 7, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text("COMMERCIAL SALES QUOTATION", pageWidth / 2, currentY + 5, { align: "center" });

    currentY += 10;
  };

  drawHeaderAndBanner();

  // -------------------------------------------------------------------------
  // 2. Metadata & Customer Details Box (2 Columns)
  // -------------------------------------------------------------------------
  const metaBoxHeight = 28;
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, currentY, contentWidth, metaBoxHeight, "FD");

  const col1X = margin + 4;
  const col2X = margin + contentWidth / 2 + 4;
  let metaY = currentY + 5;

  doc.setFontSize(7.5);

  // Left Column: Quotation Metadata
  doc.setFont("helvetica", "bold");
  doc.setTextColor(71, 85, 105);
  doc.text("Quotation No:", col1X, metaY);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 97, 242);
  doc.text(quotation.quotation_number, col1X + 26, metaY);

  metaY += 5;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(71, 85, 105);
  doc.text("Revision:", col1X, metaY);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(15, 23, 42);
  const statusStr = (quotation.status || "draft").toUpperCase();
  doc.text(`v${quotation.version} (${statusStr})`, col1X + 26, metaY);

  metaY += 5;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(71, 85, 105);
  doc.text("Date Issued:", col1X, metaY);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(15, 23, 42);
  doc.text(formatQuotationDate(quotation.quotation_date), col1X + 26, metaY);

  metaY += 5;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(71, 85, 105);
  doc.text("Valid Until:", col1X, metaY);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(15, 23, 42);
  doc.text(formatQuotationDate(quotation.valid_until), col1X + 26, metaY);

  metaY += 5;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(71, 85, 105);
  doc.text("Currency:", col1X, metaY);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(15, 23, 42);
  doc.text(currency, col1X + 26, metaY);

  // Right Column: Customer & Company Details
  let rMetaY = currentY + 5;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(71, 85, 105);
  doc.text("Customer:", col2X, rMetaY);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text(quotation.customer_name_snapshot || "—", col2X + 26, rMetaY);

  rMetaY += 5;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(71, 85, 105);
  doc.text("Company:", col2X, rMetaY);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(15, 23, 42);
  doc.text(quotation.company_name_snapshot || "—", col2X + 26, rMetaY);

  rMetaY += 5;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(71, 85, 105);
  doc.text("Contact:", col2X, rMetaY);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(15, 23, 42);
  doc.text(quotation.customer_phone_snapshot || "—", col2X + 26, rMetaY);

  rMetaY += 5;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(71, 85, 105);
  doc.text("Email:", col2X, rMetaY);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(15, 23, 42);
  doc.text(quotation.customer_email_snapshot || "—", col2X + 26, rMetaY);

  rMetaY += 5;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(71, 85, 105);
  doc.text("Sales Rep:", col2X, rMetaY);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(15, 23, 42);
  doc.text(quotation.created_by_name || "Sales Representative", col2X + 26, rMetaY);

  currentY += metaBoxHeight + 5;

  // -------------------------------------------------------------------------
  // 3. Products Table
  // -------------------------------------------------------------------------
  // Columns: Sr (10mm) | Item & Specs (68mm) | Qty (18mm) | Unit Price (24mm) | Disc (18mm) | Tax (16mm) | Total (32mm) = 186mm
  const colW = [10, 68, 18, 24, 18, 16, 32];
  const colX: number[] = [margin];
  for (let i = 0; i < colW.length - 1; i++) {
    colX.push(colX[i] + colW[i]);
  }

  const drawTableHeader = () => {
    doc.setFillColor(15, 23, 42); // Slate 900
    doc.rect(margin, currentY, contentWidth, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);

    doc.text("Sr.", colX[0] + 5, currentY + 4.8, { align: "center" });
    doc.text("Item Description & Specifications", colX[1] + 2, currentY + 4.8);
    doc.text("Qty", colX[2] + colW[2] - 2, currentY + 4.8, { align: "right" });
    doc.text("Unit Price", colX[3] + colW[3] - 2, currentY + 4.8, { align: "right" });
    doc.text("Discount", colX[4] + colW[4] - 2, currentY + 4.8, { align: "right" });
    doc.text("Tax", colX[5] + colW[5] - 2, currentY + 4.8, { align: "right" });
    doc.text("Line Total", colX[6] + colW[6] - 2, currentY + 4.8, { align: "right" });

    currentY += 7;
  };

  drawTableHeader();

  // Render Line Items
  quotation.items.forEach((item, idx) => {
    // Compute item height dynamically to avoid overlapping or clipping
    const pTitle = item.product_name + (item.product_code ? ` (${item.product_code})` : "");
    const titleLines = doc.splitTextToSize(pTitle, colW[1] - 4);
    let descLines: string[] = [];
    if (item.description) {
      descLines = doc.splitTextToSize(item.description, colW[1] - 4);
    }
    let specLines: string[] = [];
    if (item.include_specifications !== false && item.specification) {
      specLines = doc.splitTextToSize(`Specs: ${item.specification}`, colW[1] - 4);
    }
    let demoLines: string[] = [];
    if (item.demo_link) {
      demoLines = doc.splitTextToSize(`Demo: ${item.demo_link}`, colW[1] - 4);
    }

    const totalTextLines = titleLines.length + descLines.length + specLines.length + demoLines.length;
    const rowHeight = Math.max(8, totalTextLines * 3.6 + 4);

    // Multi-page page-break check
    if (currentY + rowHeight > bottomThreshold) {
      doc.addPage();
      currentY = 14;
      drawTableHeader();
    }

    // Row Background (Alternating subtle gray)
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, currentY, contentWidth, rowHeight, "F");
    }
    doc.setDrawColor(226, 232, 240);
    doc.rect(margin, currentY, contentWidth, rowHeight, "S");

    // Sr.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(String(idx + 1), colX[0] + 5, currentY + 5, { align: "center" });

    // Item & Description & Specs
    let textY = currentY + 4.5;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    titleLines.forEach((tl: string) => {
      doc.text(tl, colX[1] + 2, textY);
      textY += 3.5;
    });

    if (descLines.length > 0) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(71, 85, 105);
      descLines.forEach((dl: string) => {
        doc.text(dl, colX[1] + 2, textY);
        textY += 3.2;
      });
    }

    if (specLines.length > 0) {
      doc.setFont("helvetica", "italic");
      doc.setTextColor(100, 116, 139);
      specLines.forEach((sl: string) => {
        doc.text(sl, colX[1] + 2, textY);
        textY += 3.0;
      });
    }

    if (demoLines.length > 0) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 97, 242);
      demoLines.forEach((ml: string) => {
        doc.text(ml, colX[1] + 2, textY);
        textY += 3.0;
      });
    }

    // Qty
    doc.setFont("helvetica", "normal");
    doc.setTextColor(15, 23, 42);
    doc.text(`${item.quantity} ${item.uom || "Nos"}`, colX[2] + colW[2] - 2, currentY + 5, { align: "right" });

    // Unit Price
    doc.text(formatQuotationCurrency(item.unit_price, currency), colX[3] + colW[3] - 2, currentY + 5, { align: "right" });

    // Discount
    doc.text(formatQuotationCurrency(item.unit_discount || 0, currency), colX[4] + colW[4] - 2, currentY + 5, { align: "right" });

    // Tax
    doc.text(`${item.tax_rate || 0}%`, colX[5] + colW[5] - 2, currentY + 5, { align: "right" });

    // Line Total
    doc.setFont("helvetica", "bold");
    doc.text(formatQuotationCurrency(item.total_amount, currency), colX[6] + colW[6] - 2, currentY + 5, { align: "right" });

    currentY += rowHeight;
  });

  currentY += 4;

  // -------------------------------------------------------------------------
  // 4. Commercial Totals Summary (Right-aligned table)
  // -------------------------------------------------------------------------
  const summaryBoxWidth = 80;
  const summaryBoxX = margin + contentWidth - summaryBoxWidth;
  const summaryRowHeight = 5.5;

  if (currentY + 30 > bottomThreshold) {
    doc.addPage();
    currentY = 14;
  }

  const totals = [
    { label: "Subtotal (Taxable):", value: formatQuotationCurrency(quotation.subtotal, currency), bold: false },
    ...(quotation.discount_total && quotation.discount_total > 0
      ? [{ label: "Total Discount:", value: formatQuotationCurrency(quotation.discount_total, currency), bold: false }]
      : []),
    { label: "Total GST / Tax:", value: formatQuotationCurrency(quotation.tax_total || 0, currency), bold: false },
    { label: "GRAND TOTAL:", value: formatQuotationCurrency(quotation.total_amount, currency), bold: true },
  ];

  totals.forEach((row) => {
    const isGrand = row.bold;
    if (isGrand) {
      doc.setFillColor(239, 246, 255); // Blue 50
      doc.rect(summaryBoxX, currentY, summaryBoxWidth, summaryRowHeight + 1, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(0, 97, 242);
    } else {
      doc.setFillColor(248, 250, 252);
      doc.rect(summaryBoxX, currentY, summaryBoxWidth, summaryRowHeight, "FD");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);
    }

    doc.text(row.label, summaryBoxX + 3, currentY + 4);
    doc.text(row.value, summaryBoxX + summaryBoxWidth - 3, currentY + 4, { align: "right" });

    currentY += isGrand ? summaryRowHeight + 2 : summaryRowHeight;
  });

  currentY += 5;

  // -------------------------------------------------------------------------
  // 5. Terms & Conditions Section
  // -------------------------------------------------------------------------
  if (currentY + 25 > bottomThreshold) {
    doc.addPage();
    currentY = 14;
  }

  const termsBoxHeight = 24;
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, currentY, contentWidth, termsBoxHeight, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text("Commercial Terms & Notes", margin + 4, currentY + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(51, 65, 85);
  let termsY = currentY + 9;

  if (quotation.payment_terms) {
    doc.text(`• Payment Terms: ${quotation.payment_terms}`, margin + 4, termsY);
    termsY += 3.8;
  }
  if (quotation.delivery_terms) {
    doc.text(`• Delivery Terms: ${quotation.delivery_terms}`, margin + 4, termsY);
    termsY += 3.8;
  }
  if (quotation.notes) {
    doc.text(`• Notes: ${quotation.notes}`, margin + 4, termsY);
    termsY += 3.8;
  }
  if (quotation.terms_and_conditions) {
    doc.text(`• Standard Terms: ${quotation.terms_and_conditions}`, margin + 4, termsY);
  } else {
    doc.text(
      "• 1. Goods once sold will not be returned without prior written approval.  2. Warranty applies as per manufacturer terms.",
      margin + 4,
      termsY
    );
  }

  // -------------------------------------------------------------------------
  // 6. Running Footer & Page X of Y
  // -------------------------------------------------------------------------
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 12, margin + contentWidth, pageHeight - 12);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text("INHYMA SOLUTIONS LLP — Computer-Generated Official Sales Quotation", margin, pageHeight - 8);
    doc.text(`Page ${p} of ${totalPages}`, margin + contentWidth, pageHeight - 8, { align: "right" });
  }

  if (options?.saveFile) {
    doc.save(`${quotation.quotation_number}_v${quotation.version}.pdf`);
  }

  if (options?.openInNewTab) {
    const blobUrl = doc.output("bloburl");
    window.open(blobUrl, "_blank");
  }

  return doc;
}
