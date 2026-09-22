import jsPDF from "jspdf";
import type { PurchaseOrderRecord, LocalPurchaseItem } from "@/pages/purchase/LocalPurchasePage";

export function formatIndianCurrency(amount: number): string {
  return "₹ " + (amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface LocalPurchasePdfOptions {
  openInNewTab?: boolean;
  saveFile?: boolean;
  doc?: jsPDF;
}

export function generateLocalPurchaseBillPdf(
  order: PurchaseOrderRecord,
  options?: LocalPurchasePdfOptions
): jsPDF {
  const doc =
    options?.doc ||
    new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

  const pageWidth = 210;
  const margin = 12;
  const contentWidth = pageWidth - margin * 2; // 186mm

  const invoiceNo = order.invoice_no || "2026-27/SO/1534";
  const invoiceDate = order.invoice_date || "19-09-2026";
  const warehouse = order.warehouse || "Mumbai";

  doc.setProperties({
    title: `Bill File: ${invoiceNo}`,
    subject: "Local Purchase Bill / Tax Invoice",
    author: "Inhyma Solutions LLP",
  });

  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.35);

  let currentY = 12;

  // ==========================================
  // SECTION 1: Top Header "LOCAL PURCHASE BILL"
  // ==========================================
  const headerHeight = 8;
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, currentY, contentWidth, headerHeight, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(30, 41, 59);
  doc.text("LOCAL PURCHASE BILL / TAX INVOICE", pageWidth / 2, currentY + 5.5, { align: "center" });

  currentY += headerHeight + 3;

  // ==========================================
  // SECTION 2: Supplier ("From") & Buyer ("To")
  // ==========================================
  const colWidth = (contentWidth - 4) / 2; // ~91mm
  const infoBoxHeight = 38;

  // Left Box: Supplier ("From")
  doc.rect(margin, currentY, colWidth, infoBoxHeight);
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, currentY, colWidth, 6.5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  doc.text("SUPPLIER (FROM)", margin + 4, currentY + 4.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(order.supplier_name || "S B Inks & Packaging Co.", margin + 4, currentY + 11.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);

  const supAddressLines = (order.supplier_address || "6/7, Ripal Shopping Complex, Near Cosmo Vila Row House,\nPremchand Nagar Road, Bodakdev, Ahmedabad 380015").split("\n");
  let supY = currentY + 16;
  supAddressLines.forEach((line) => {
    doc.text(line, margin + 4, supY);
    supY += 3.8;
  });

  doc.text(`GSTIN: ${order.supplier_gst || "24ACSF51727J1ZB"}`, margin + 4, currentY + 29);
  doc.text(`Email: ${order.supplier_email || "8799513908"}`, margin + 4, currentY + 33);
  if (order.supplier_phone) {
    doc.text(`Phone: ${order.supplier_phone}`, margin + 50, currentY + 33);
  }

  // Right Box: Buyer ("To")
  const rightX = margin + colWidth + 4;
  doc.rect(rightX, currentY, colWidth, infoBoxHeight);
  doc.setFillColor(248, 250, 252);
  doc.rect(rightX, currentY, colWidth, 6.5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  doc.text("BILLED TO (BUYER)", rightX + 4, currentY + 4.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(order.to_name || "INHYMA SOLUTIONS LLP (M)", rightX + 4, currentY + 11.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);

  const toAddressLines = (order.to_address || "4th Floor, Office No 421, Supremus - [I, Road No- 22,\nNear Passport Office, Wagle Estate, Thane 400604").split("\n");
  let toY = currentY + 16;
  toAddressLines.forEach((line) => {
    doc.text(line, rightX + 4, toY);
    toY += 3.8;
  });

  doc.text(`GSTIN: ${order.to_gst || "27AAKFI9869H1ZL"}`, rightX + 4, currentY + 29);
  doc.text(`Email: ${order.to_email || "Payment.Darsh@Gmail.Com"}`, rightX + 4, currentY + 33);
  doc.text(`Phone: ${order.to_phone || "9653261742"}`, rightX + 50, currentY + 33);

  currentY += infoBoxHeight + 3;

  // ==========================================
  // SECTION 3: Invoice Metadata Strip
  // ==========================================
  const stripHeight = 13;
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, currentY, contentWidth, stripHeight, "FD");

  const stripCols = [
    { label: "Invoice No.", val: invoiceNo },
    { label: "Invoice Date", val: invoiceDate },
    { label: "Warehouse", val: warehouse },
    { label: "Created By", val: order.created_by || "Akshata Wadekar" },
    { label: "Status", val: order.status || "Pending" },
  ];

  const stripColW = contentWidth / stripCols.length;
  stripCols.forEach((col, idx) => {
    const cx = margin + idx * stripColW;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(col.label, cx + 3, currentY + 5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(30, 41, 59);
    doc.text(col.val, cx + 3, currentY + 10);
  });

  currentY += stripHeight + 4;

  // ==========================================
  // SECTION 4: Product Items Table
  // ==========================================
  const items: LocalPurchaseItem[] = order.items && order.items.length > 0
    ? order.items
    : [
        {
          id: "item-1",
          product_name: "G43 Online Printer TIJ 4.3",
          quantity: 1,
          unit_rate: order.basic_amount || Math.round((order.invoice_total / 1.18) * 100) / 100,
          item_total: order.basic_amount || Math.round((order.invoice_total / 1.18) * 100) / 100,
          expense_per_unit: 0,
          unit_landing_rate: order.basic_amount || Math.round((order.invoice_total / 1.18) * 100) / 100,
          total_landing_rate: order.basic_amount || Math.round((order.invoice_total / 1.18) * 100) / 100,
        },
      ];

  // Table Columns: Sr (12) | Product Name (70) | Qty (20) | Unit Rate (26) | Item Total (28) | Landing Rate (30)
  const colW = [12, 72, 20, 26, 28, 28];
  const colStarts = [
    margin,
    margin + colW[0],
    margin + colW[0] + colW[1],
    margin + colW[0] + colW[1] + colW[2],
    margin + colW[0] + colW[1] + colW[2] + colW[3],
    margin + colW[0] + colW[1] + colW[2] + colW[3] + colW[4],
  ];

  // Table Header
  const tableHeaderH = 7;
  doc.setFillColor(226, 232, 240);
  doc.rect(margin, currentY, contentWidth, tableHeaderH, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(30, 41, 59);

  doc.text("Sr No.", colStarts[0] + 2, currentY + 4.8);
  doc.text("Product Description", colStarts[1] + 2, currentY + 4.8);
  doc.text("Quantity", colStarts[2] + colW[2] - 2, currentY + 4.8, { align: "right" });
  doc.text("Unit Rate", colStarts[3] + colW[3] - 2, currentY + 4.8, { align: "right" });
  doc.text("Item Total", colStarts[4] + colW[4] - 2, currentY + 4.8, { align: "right" });
  doc.text("Landing Rate", colStarts[5] + colW[5] - 2, currentY + 4.8, { align: "right" });

  currentY += tableHeaderH;

  // Table Rows
  items.forEach((item, index) => {
    const rowH = 7.5;
    doc.rect(margin, currentY, contentWidth, rowH);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);

    doc.text(String(index + 1), colStarts[0] + 2, currentY + 5);
    doc.text(item.product_name, colStarts[1] + 2, currentY + 5);
    doc.text(`${item.quantity} Nos`, colStarts[2] + colW[2] - 2, currentY + 5, { align: "right" });
    doc.text(formatIndianCurrency(Number(item.unit_rate) || 0), colStarts[3] + colW[3] - 2, currentY + 5, { align: "right" });
    doc.text(formatIndianCurrency(Number(item.item_total) || 0), colStarts[4] + colW[4] - 2, currentY + 5, { align: "right" });
    doc.text(formatIndianCurrency(Number(item.total_landing_rate) || Number(item.item_total) || 0), colStarts[5] + colW[5] - 2, currentY + 5, { align: "right" });

    currentY += rowH;
  });

  // Table Total Row
  const totalItemAmt = items.reduce((s, it) => s + (Number(it.item_total) || 0), 0);
  const totalLandingAmt = items.reduce((s, it) => s + (Number(it.total_landing_rate) || Number(it.item_total) || 0), 0);

  const totalRowH = 7.5;
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, currentY, contentWidth, totalRowH, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text("Total", colStarts[1] + 2, currentY + 5);
  doc.text(formatIndianCurrency(totalItemAmt), colStarts[4] + colW[4] - 2, currentY + 5, { align: "right" });
  doc.text(formatIndianCurrency(totalLandingAmt), colStarts[5] + colW[5] - 2, currentY + 5, { align: "right" });

  currentY += totalRowH + 5;

  // ==========================================
  // SECTION 5: Expenses & Tax Summary Box
  // ==========================================
  const summaryBoxW = 90;
  const summaryBoxX = margin + contentWidth - summaryBoxW;
  const summaryH = 34;

  // Summary Container
  doc.rect(summaryBoxX, currentY, summaryBoxW, summaryH);

  const basicWithoutGst = order.basic_amount || totalItemAmt || Math.round((order.invoice_total / 1.18) * 100) / 100;
  const totalExpenses = order.total_expenses || 0;
  const invoiceTotalWithGst = order.invoice_total;
  const gstAmount = Math.max(0, invoiceTotalWithGst - basicWithoutGst);

  const summaryLines = [
    { label: "Basic Value (Without GST):", val: formatIndianCurrency(basicWithoutGst) },
    { label: "GST Amount (18%):", val: formatIndianCurrency(gstAmount) },
    { label: "Total Other Expenses:", val: formatIndianCurrency(totalExpenses) },
    { label: "Invoice Total (Including GST):", val: formatIndianCurrency(invoiceTotalWithGst), bold: true },
  ];

  let sumY = currentY + 5.5;
  summaryLines.forEach((line) => {
    if (line.bold) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
    }
    doc.text(line.label, summaryBoxX + 4, sumY);
    doc.text(line.val, summaryBoxX + summaryBoxW - 4, sumY, { align: "right" });
    sumY += 6.5;
  });

  // Left Note / Remarks
  const remarksBoxW = contentWidth - summaryBoxW - 4;
  doc.rect(margin, currentY, remarksBoxW, summaryH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text("Remarks & Notes:", margin + 4, currentY + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(order.remarks || "Make all cheque payable to USER. Standard inventory procurement invoice.", margin + 4, currentY + 12);
  doc.text("This document is a computer generated copy of the original supplier bill file.", margin + 4, currentY + 17);

  currentY += summaryH + 10;

  // ==========================================
  // SECTION 6: Signatures
  // ==========================================
  const sigBoxW = (contentWidth - 10) / 2;
  doc.line(margin, currentY + 12, margin + sigBoxW, currentY + 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("Supplier / Authorized Signatory", margin, currentY + 16);

  const sigRightX = margin + sigBoxW + 10;
  doc.line(sigRightX, currentY + 12, sigRightX + sigBoxW, currentY + 12);
  doc.text("For INHYMA SOLUTIONS LLP (Verified & Received)", sigRightX, currentY + 16);

  // Output options
  if (options?.saveFile) {
    const filename = `Bill_${invoiceNo.replace(/[\/\\]/g, "_")}.pdf`;
    doc.save(filename);
  }

  if (options?.openInNewTab) {
    const blob = doc.output("blob");
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, "_blank");
  }

  return doc;
}
