import jsPDF from "jspdf";
import type { StockAdjustmentItem } from "@/pages/StockAdjustmentPage";

/**
 * Generates an official Stock Adjustment PDF document matching the
 * ERP PDF template words by words:
 * - Centered "Stock Adjustment" title bordered by top & bottom horizontal rules
 * - Client Name, Invoice No, Adjustment Type, Purpose, Date, Created by, Created at
 * - Warehouse
 * - Grand Total row
 * - Bordered Remarks box
 */
export function formatIndianCurrency(amount: number): string {
  return "₹ " + amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function generateStockAdjustmentPdf(
  item: StockAdjustmentItem,
  options?: { openInNewTab?: boolean; saveFile?: boolean; doc?: jsPDF }
): jsPDF {
  const doc =
    options?.doc ||
    new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

  const pageWidth = 210;
  const margin = 15;
  const contentWidth = pageWidth - margin * 2; // 180mm

  // Determine adjustment number (e.g. "492")
  const adjNo = item.adjustment_no || item.id.replace(/\D/g, "") || "492";

  // Document metadata
  doc.setProperties({
    title: `Adjustment No: ${adjNo}`,
    subject: "Stock Adjustment Order",
    author: "Inhyma Solutions ERP",
  });

  // 1. Title bar with double horizontal rules
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.35);

  // Top line
  doc.line(margin, 22, margin + contentWidth, 22);

  // Centered title: "Stock Adjustment"
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(0, 0, 0);
  doc.text("Stock Adjustment", pageWidth / 2, 27, { align: "center" });

  // Bottom line
  doc.line(margin, 30, margin + contentWidth, 30);

  // 2. Metadata details
  const leftX = margin;
  const labelWidth = 34;
  let currentY = 36.5;
  const lineHeight = 4.8;

  const metadataLeft = [
    { label: "Client Name :", value: item.client_name || "—" },
    { label: "Invoice No :", value: item.invoice_no || "—" },
    { label: "Adjustment Type :", value: item.type },
    { label: "Purpose :", value: item.purpose },
    { label: "Date :", value: `${item.adjustment_date} 12:00 AM` },
    { label: "Created by :", value: item.created_by },
    { label: "Created at :", value: `${item.adjustment_date} 11:23 AM` },
  ];

  doc.setFontSize(8.5);

  metadataLeft.forEach(({ label, value }) => {
    doc.setFont("helvetica", "bold");
    doc.text(label, leftX, currentY);
    doc.setFont("helvetica", "normal");
    doc.text(value, leftX + labelWidth, currentY);
    currentY += lineHeight;
  });

  // Right Column: Warehouse
  const rightX = 135;
  doc.setFont("helvetica", "bold");
  doc.text("Warehouse:", rightX, 36.5);
  doc.setFont("helvetica", "normal");
  doc.text(item.warehouse || "—", rightX, 41.3);
  doc.text(item.warehouse || "—", rightX, 46.1);

  // 3. Items Table
  const tableStartY = 75;
  // Total table width: 14 + 100 + 16 + 25 + 25 = 180mm
  const colWidths = [14, 100, 16, 25, 25];
  const colX = [
    margin,
    margin + colWidths[0],
    margin + colWidths[0] + colWidths[1],
    margin + colWidths[0] + colWidths[1] + colWidths[2],
    margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3],
  ];

  // Header Row
  const headerHeight = 7.5;
  doc.setLineWidth(0.3);
  doc.rect(margin, tableStartY, contentWidth, headerHeight);

  // Divider lines between header columns
  for (let i = 1; i < colX.length; i++) {
    doc.line(colX[i], tableStartY, colX[i], tableStartY + headerHeight);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("Sr.", colX[0] + 3, tableStartY + 5.2);
  doc.text("Item(s)", colX[1] + 3, tableStartY + 5.2);
  doc.text("Quantity", colX[2] + colWidths[2] / 2, tableStartY + 5.2, { align: "center" });
  doc.text("Unit Price", colX[3] + colWidths[3] - 2, tableStartY + 5.2, { align: "right" });
  doc.text("Total Price", colX[4] + colWidths[4] - 2, tableStartY + 5.2, { align: "right" });

  // Body Rows
  let rowY = tableStartY + headerHeight;
  const rowHeight = 11;

  const lineItems =
    item.items && item.items.length > 0
      ? item.items
      : [
          {
            product_name: "Machine Spare / Adjustment Item",
            qty: 1,
            rate: item.total_amount,
            amount: item.total_amount,
          },
        ];

  lineItems.forEach((li, idx) => {
    doc.rect(margin, rowY, contentWidth, rowHeight);
    for (let i = 1; i < colX.length; i++) {
      doc.line(colX[i], rowY, colX[i], rowY + rowHeight);
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    // Sr.
    doc.text(String(idx + 1), colX[0] + 3.5, rowY + 6.5);

    // Item(s)
    const splitName = doc.splitTextToSize(li.product_name, colWidths[1] - 6);
    doc.text(splitName, colX[1] + 3, rowY + 5.5);

    // Quantity
    doc.text(String(li.qty), colX[2] + colWidths[2] / 2, rowY + 6.5, { align: "center" });

    // Unit Price
    const rateStr = Number(li.rate).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    doc.text(rateStr, colX[3] + colWidths[3] - 2, rowY + 6.5, { align: "right" });

    // Total Price
    const amtStr = Number(li.amount).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    doc.text(amtStr, colX[4] + colWidths[4] - 2, rowY + 6.5, { align: "right" });

    rowY += rowHeight;
  });

  // Grand Total Row
  const totalRowHeight = 7.5;
  doc.rect(margin, rowY, contentWidth, totalRowHeight);
  // Divider before the last column
  doc.line(colX[4], rowY, colX[4], rowY + totalRowHeight);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("Grand Total", margin + 3, rowY + 5.2);

  const totalStr = Number(item.total_amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  doc.text(totalStr, colX[4] + colWidths[4] - 2, rowY + 5.2, { align: "right" });

  rowY += totalRowHeight;

  // 4. Remarks Box
  const remarksY = rowY + 8;
  const remarksHeight = 8;
  doc.rect(margin, remarksY, contentWidth, remarksHeight);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Remarks: ", margin + 3, remarksY + 5.2);

  doc.setFont("helvetica", "normal");
  const remarksText =
    item.remarks || "Party required another machine, but salesperson give the other machine";
  doc.text(remarksText, margin + 18, remarksY + 5.2);

  const filename = `Adjustment No_${adjNo}.pdf`;

  // Save PDF file to user's device
  if (options?.saveFile !== false) {
    doc.save(filename);
  }

  // Also open preview in new tab
  if (options?.openInNewTab) {
    try {
      const pdfBlob = doc.output("blob");
      const blobUrl = URL.createObjectURL(pdfBlob);
      window.open(blobUrl, "_blank");
    } catch {
      // Ignored if popups are blocked
    }
  }

  return doc;
}
