import jsPDF from "jspdf";
import type { ImportPurchaseRecord } from "@/pages/purchase/ImportPurchasePage";

export function formatIndianCurrency(amount: number): string {
  return "₹ " + (amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatUsdCurrency(amount: number): string {
  return "$ " + (amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface ImportPurchasePdfOptions {
  openInNewTab?: boolean;
  saveFile?: boolean;
  doc?: jsPDF;
}

export function generateImportPurchaseBillPdf(
  order: ImportPurchaseRecord,
  options?: ImportPurchasePdfOptions
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

  const consignmentNo = order.consignment_no || "MUM51";
  const orderedDate = order.ordered_date || "19-09-2026";
  const warehouse = order.warehouse || "Mumbai Ordered";

  doc.setProperties({
    title: `Import Bill File: ${consignmentNo}`,
    subject: "Import Purchase Bill / Customs Tax Invoice",
    author: "Inhyma Solutions LLP",
  });

  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.35);

  let currentY = 12;

  // Header Title
  const headerHeight = 8;
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, currentY, contentWidth, headerHeight, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(30, 41, 59);
  doc.text("IMPORT PURCHASE CONSIGNMENT BILL / CUSTOMS INVOICE", pageWidth / 2, currentY + 5.5, { align: "center" });

  currentY += headerHeight + 3;

  // Supplier (Foreign Exporter) & Importer (Buyer)
  const colWidth = (contentWidth - 4) / 2;
  const infoBoxHeight = 40;

  // Left Box: Supplier
  doc.rect(margin, currentY, colWidth, infoBoxHeight);
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, currentY, colWidth, 6.5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  doc.text("FOREIGN SUPPLIER (EXPORTER)", margin + 4, currentY + 4.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(order.supplier_name || "Yinglima Machinery Co., Ltd.", margin + 4, currentY + 11.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  const supAddressLines = [
    "No. 18, Industrial Development Zone, Beilun District",
    "Ningbo, Zhejiang Province, 315800, China",
    "Origin Country: P.R. China",
  ];
  let supY = currentY + 16;
  supAddressLines.forEach((line) => {
    doc.text(line, margin + 4, supY);
    supY += 3.8;
  });
  doc.text("Supplier Code: YGL-CHINA-01", margin + 4, currentY + 29);
  doc.text("Email: export@yinglima-pack.com", margin + 4, currentY + 33);
  doc.text("Contact: +86-574-8688-9922", margin + 4, currentY + 37);

  // Right Box: Buyer (Importer)
  const rightX = margin + colWidth + 4;
  doc.rect(rightX, currentY, colWidth, infoBoxHeight);
  doc.setFillColor(248, 250, 252);
  doc.rect(rightX, currentY, colWidth, 6.5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  doc.text("IMPORTER (CONSIGNEE / BUYER)", rightX + 4, currentY + 4.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text("INHYMA SOLUTIONS LLP (MUMBAI HUB)", rightX + 4, currentY + 11.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  const toAddressLines = [
    "4th Floor, Office No 421, Supremus - I, Road No- 22",
    "Near Passport Office, Wagle Estate, Thane (W), 400604",
    "Maharashtra, India",
  ];
  let toY = currentY + 16;
  toAddressLines.forEach((line) => {
    doc.text(line, rightX + 4, toY);
    toY += 3.8;
  });
  doc.text("GSTIN: 27AAKFI9869H1ZL", rightX + 4, currentY + 29);
  doc.text("IEC Code: 0316912345 (DGFT)", rightX + 4, currentY + 33);
  doc.text("Email: procurement@inhymasolutions.com", rightX + 4, currentY + 37);

  currentY += infoBoxHeight + 3;

  // Consignment Metadata Strip
  const stripH = 13;
  doc.rect(margin, currentY, contentWidth, stripH);
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, currentY, contentWidth, stripH, "F");

  const colMetaW = contentWidth / 6;
  const metaFields = [
    { label: "Consignment No.", val: consignmentNo },
    { label: "Ordered Date", val: orderedDate },
    { label: "Destination Warehouse", val: warehouse },
    { label: "ETD Origin", val: order.etd_origin_date || "10-10-2026" },
    { label: "ETA Port", val: order.eta_port_date || "25-10-2026" },
    { label: "Consignment Status", val: order.status },
  ];

  metaFields.forEach((mf, i) => {
    const x = margin + i * colMetaW;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(mf.label, x + 3, currentY + 4.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.8);
    doc.setTextColor(15, 23, 42);
    doc.text(mf.val, x + 3, currentY + 9.5);
  });

  currentY += stripH + 4;

  // International Shipping & Logistics Strip
  const shippingStripH = 13;
  doc.rect(margin, currentY, contentWidth, shippingStripH);
  doc.setFillColor(255, 255, 255);
  doc.rect(margin, currentY, contentWidth, shippingStripH, "F");

  const shipFields = [
    { label: "Port of Loading", val: "Ningbo Port, China" },
    { label: "Port of Discharge", val: "Nhava Sheva (JNPT), Mumbai" },
    { label: "Container Size", val: "40 FT HC High Cube" },
    { label: "Total CBM", val: `${order.total_cbm || 65.4} CBM` },
    { label: "Gross Weight", val: `${order.gross_weight || 12400} KG` },
    { label: "Exchange Rate (USD/INR)", val: `1 USD = ₹ ${order.exchange_rate || 83.5}` },
  ];

  shipFields.forEach((sf, i) => {
    const x = margin + i * colMetaW;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(sf.label, x + 3, currentY + 4.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.8);
    doc.setTextColor(30, 41, 59);
    doc.text(sf.val, x + 3, currentY + 9.5);
  });

  currentY += shippingStripH + 4;

  // Products Table
  const tableHeaders = [
    { label: "Sr.", width: 10, align: "left" },
    { label: "Product Description / Model", width: 68, align: "left" },
    { label: "Qty", width: 18, align: "center" },
    { label: "Unit Rate ($)", width: 22, align: "right" },
    { label: "Total ($)", width: 22, align: "right" },
    { label: "Unit Landing (₹)", width: 23, align: "right" },
    { label: "Total Landing (₹)", width: 23, align: "right" },
  ];

  doc.setFillColor(241, 245, 249);
  doc.rect(margin, currentY, contentWidth, 7, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(30, 41, 59);

  let curX = margin;
  tableHeaders.forEach((th) => {
    let textX = curX + 2;
    if (th.align === "right") textX = curX + th.width - 2;
    if (th.align === "center") textX = curX + th.width / 2;
    doc.text(th.label, textX, currentY + 4.8, { align: th.align as any });
    curX += th.width;
  });

  currentY += 7;

  // Products items
  const items = order.items && order.items.length > 0 ? order.items : [
    {
      id: "it-1",
      product_name: "ISL450XDAN Flow Wrap Machine with Chain",
      quantity: 4,
      unit_rate_usd: 3500,
      total_usd: 14000,
      unit_landing_inr: 325000,
      total_landing_inr: 1300000,
    },
    {
      id: "it-2",
      product_name: "Continuous Band Sealer FRD-1000",
      quantity: 20,
      unit_rate_usd: 280,
      total_usd: 5600,
      unit_landing_inr: 26000,
      total_landing_inr: 520000,
    },
    {
      id: "it-3",
      product_name: "G43 Online Thermal Inkjet Printer 4.3 Inch",
      quantity: 15,
      unit_rate_usd: 420,
      total_usd: 6300,
      unit_landing_inr: 39000,
      total_landing_inr: 585000,
    },
  ];

  let totalQty = 0;
  let totalUsd = 0;
  let totalLandingInr = 0;

  items.forEach((item, idx) => {
    const rowH = 6.5;
    if (idx % 2 === 1) {
      doc.setFillColor(249, 250, 251);
      doc.rect(margin, currentY, contentWidth, rowH, "F");
    }
    doc.rect(margin, currentY, contentWidth, rowH);

    totalQty += item.quantity;
    totalUsd += item.total_usd || item.quantity * (item.unit_rate_usd || 0);
    totalLandingInr += item.total_landing_inr || item.quantity * (item.unit_landing_inr || 0);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);

    let x = margin;
    // Sr
    doc.text(String(idx + 1), x + 2, currentY + 4.5);
    x += tableHeaders[0].width;
    // Description
    doc.text(item.product_name, x + 2, currentY + 4.5);
    x += tableHeaders[1].width;
    // Qty
    doc.text(`${item.quantity} Nos`, x + tableHeaders[2].width / 2, currentY + 4.5, { align: "center" });
    x += tableHeaders[2].width;
    // Unit Rate USD
    doc.text(formatUsdCurrency(item.unit_rate_usd || 0), x + tableHeaders[3].width - 2, currentY + 4.5, { align: "right" });
    x += tableHeaders[3].width;
    // Total USD
    doc.text(formatUsdCurrency(item.total_usd || (item.quantity * (item.unit_rate_usd || 0))), x + tableHeaders[4].width - 2, currentY + 4.5, { align: "right" });
    x += tableHeaders[4].width;
    // Unit Landing INR
    doc.text(formatIndianCurrency(item.unit_landing_inr || 0), x + tableHeaders[5].width - 2, currentY + 4.5, { align: "right" });
    x += tableHeaders[5].width;
    // Total Landing INR
    doc.text(formatIndianCurrency(item.total_landing_inr || (item.quantity * (item.unit_landing_inr || 0))), x + tableHeaders[6].width - 2, currentY + 4.5, { align: "right" });

    currentY += rowH;
  });

  // Table Totals Footer
  const footerH = 7;
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, currentY, contentWidth, footerH, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);

  doc.text("Total Quantity & Cost", margin + tableHeaders[0].width + 2, currentY + 4.8);
  doc.text(`${totalQty} Nos`, margin + tableHeaders[0].width + tableHeaders[1].width + tableHeaders[2].width / 2, currentY + 4.8, { align: "center" });
  doc.text(formatUsdCurrency(totalUsd), margin + tableHeaders[0].width + tableHeaders[1].width + tableHeaders[2].width + tableHeaders[3].width + tableHeaders[4].width - 2, currentY + 4.8, { align: "right" });
  doc.text(formatIndianCurrency(totalLandingInr), margin + contentWidth - 2, currentY + 4.8, { align: "right" });

  currentY += footerH + 4;

  // Bottom 2-Column Section: Remarks & Import Expenses Breakdown
  const summaryBoxW = 85;
  const summaryBoxX = margin + contentWidth - summaryBoxW;
  const summaryH = 34;

  // Expenses & Customs Summary Box
  doc.rect(summaryBoxX, currentY, summaryBoxW, summaryH);
  doc.setFillColor(248, 250, 252);
  doc.rect(summaryBoxX, currentY, summaryBoxW, 6.5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  doc.text("IMPORT CUSTOMS & EXPENSES SUMMARY", summaryBoxX + 4, currentY + 4.5);

  const summaryLines = [
    { label: "Invoice Total ($ USD):", val: formatUsdCurrency(order.invoice_total_usd || totalUsd) },
    { label: "Basic Customs Value (INR):", val: formatIndianCurrency(order.invoice_total_inr || (totalUsd * (order.exchange_rate || 83.5))) },
    { label: "Total Import & Port Expenses:", val: formatIndianCurrency(order.total_expenses || 0) },
    { label: "Total Landed Consignment Cost:", val: formatIndianCurrency(order.invoice_total_inr || totalLandingInr) },
  ];

  let sumY = currentY + 11.5;
  summaryLines.forEach((line, idx) => {
    if (idx === summaryLines.length - 1) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(71, 85, 105);
    }
    doc.text(line.label, summaryBoxX + 4, sumY);
    doc.text(line.val, summaryBoxX + summaryBoxW - 4, sumY, { align: "right" });
    sumY += 6.5;
  });

  // Left Box: Remarks & Clearance Notes
  const remarksBoxW = contentWidth - summaryBoxW - 4;
  doc.rect(margin, currentY, remarksBoxW, summaryH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text("Import Notes & Clearance Remarks:", margin + 4, currentY + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(order.remarks || "Direct overseas procurement from Yinglima China. Custom duty cleared under Chapter 84.", margin + 4, currentY + 12);
  doc.text("Original Bill of Lading & Commercial Packing List archived in ERP files.", margin + 4, currentY + 17);
  doc.text("This is an official computer-generated copy of the import purchase order.", margin + 4, currentY + 22);

  currentY += summaryH + 8;

  // Dual Signature Block
  const sigBoxW = (contentWidth - 10) / 2;
  doc.line(margin, currentY + 10, margin + sigBoxW, currentY + 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("Customs Clearing Agent / Freight Forwarder", margin, currentY + 14);

  const sigRightX = margin + sigBoxW + 10;
  doc.line(sigRightX, currentY + 10, sigRightX + sigBoxW, currentY + 10);
  doc.text("For INHYMA SOLUTIONS LLP (Authorized Importer)", sigRightX, currentY + 14);

  // Output options
  if (options?.saveFile) {
    const filename = `Import_Bill_${consignmentNo.replace(/[\/\\]/g, "_")}.pdf`;
    doc.save(filename);
  }

  if (options?.openInNewTab) {
    const blob = doc.output("blob");
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, "_blank");
  }

  return doc;
}
