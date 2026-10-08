import jsPDF from "jspdf";
import type { SaleOrder, SaleOrderItem } from "@/types/saleProcess";
import { getCachedBrandName } from "@/lib/brand";

export interface GatePassPdfOptions {
  openInNewTab?: boolean;
  saveFile?: boolean;
  doc?: jsPDF;
}

/**
 * Generates an official Outward Gate Pass printable/downloadable PDF
 * matching the template specified in Completed\Gate Pass.docx.
 */
export function generateGatePassPdf(
  order: Partial<SaleOrder> & Record<string, any>,
  options?: GatePassPdfOptions
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

  // Generate or read Gatepass attributes
  const todayFormatted = new Date().toLocaleDateString("en-GB").split("/").join("-");
  const gatepassNo = order.gatepass_no || `GP-${new Date().getFullYear().toString().slice(-2)}-${(new Date().getFullYear() + 1).toString().slice(-2)}/0123`;
  const gatepassDate = order.gatepass_date || todayFormatted;

  const orderNo = order.order_no || "SO-MH/26-27/00001";
  const orderDate = order.order_date || todayFormatted;
  const salesPerson = order.sales_person || "Marketing Team";
  const invoiceNo = order.invoice_no || "—";
  const invoiceDate = order.invoice_date || "—";

  const partyName = order.company_name || order.buyer_name || "Valued Customer";
  const billingAddress = order.billing_address || "—";
  const shippingAddress = order.shipping_address || billingAddress;

  const transportName = order.transport_name || order.transporter_name || "Road / Self Pickup";
  const destination = order.transport_destination || order.city || "Mumbai";
  const deliveryType = order.delivery_type || "Godown";
  const deliveryCharges = order.delivery_charge || "To Pay";
  const warehouse = order.warehouse || "Mumbai Central Warehouse";
  const handledBy = order.gatepass_handled_by || "Warehouse Operations";

  const brandName = getCachedBrandName();

  doc.setProperties({
    title: `Gate Pass: ${gatepassNo}`,
    subject: `Outward Gate Pass for ${orderNo}`,
    author: brandName,
    creator: "Inhyma ERP",
  });

  let currentY = 12;

  // ==========================================
  // HEADER SECTION: Company Branding & Title
  // ==========================================
  doc.setDrawColor(203, 213, 225); // #cbd5e1
  doc.setLineWidth(0.3);

  // Outer Border Box for Document
  doc.rect(margin, currentY, contentWidth, 272);

  // Header Title Banner
  doc.setFillColor(241, 245, 249); // light slate #f1f5f9
  doc.rect(margin, currentY, contentWidth, 18, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(30, 41, 59); // #1e293b
  doc.text(brandName.toUpperCase(), margin + contentWidth / 2, currentY + 7, { align: "center" });

  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105); // #475569
  doc.text("OUTWARD GATE PASS / DISPATCH PERMIT", margin + contentWidth / 2, currentY + 13, { align: "center" });

  currentY += 18;
  doc.line(margin, currentY, margin + contentWidth, currentY);

  // ==========================================
  // SECTION 1: Gatepass & Order Meta Grid
  // ==========================================
  const metaHeight = 32;
  const colW = contentWidth / 2; // 93mm each

  // Background subtle fill for meta headers
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, currentY, contentWidth, metaHeight, "F");

  // Vertical Divider
  doc.line(margin + colW, currentY, margin + colW, currentY + metaHeight);

  // Left Column Details
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);

  doc.text("Gatepass No :", margin + 4, currentY + 6);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(2, 132, 199); // #0284c7
  doc.text(gatepassNo, margin + 32, currentY + 6);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text("Gatepass Date :", margin + 4, currentY + 12);
  doc.setFont("helvetica", "normal");
  doc.text(gatepassDate, margin + 32, currentY + 12);

  doc.setFont("helvetica", "bold");
  doc.text("Sales Order No :", margin + 4, currentY + 18);
  doc.setFont("helvetica", "normal");
  doc.text(orderNo, margin + 32, currentY + 18);

  doc.setFont("helvetica", "bold");
  doc.text("SO Date :", margin + 4, currentY + 24);
  doc.setFont("helvetica", "normal");
  doc.text(orderDate, margin + 32, currentY + 24);

  doc.setFont("helvetica", "bold");
  doc.text("Sales Person :", margin + 4, currentY + 29.5);
  doc.setFont("helvetica", "normal");
  doc.text(salesPerson, margin + 32, currentY + 29.5);

  // Right Column Details
  const rightX = margin + colW + 4;
  doc.setFont("helvetica", "bold");
  doc.text("Tax Invoice No :", rightX, currentY + 6);
  doc.setFont("helvetica", "normal");
  doc.text(invoiceNo, rightX + 32, currentY + 6);

  doc.setFont("helvetica", "bold");
  doc.text("Invoice Date :", rightX, currentY + 12);
  doc.setFont("helvetica", "normal");
  doc.text(invoiceDate, rightX + 32, currentY + 12);

  doc.setFont("helvetica", "bold");
  doc.text("Warehouse :", rightX, currentY + 18);
  doc.setFont("helvetica", "normal");
  doc.text(warehouse, rightX + 32, currentY + 18);

  doc.setFont("helvetica", "bold");
  doc.text("Handled By :", rightX, currentY + 24);
  doc.setFont("helvetica", "normal");
  doc.text(handledBy, rightX + 32, currentY + 24);

  doc.setFont("helvetica", "bold");
  doc.text("Status :", rightX, currentY + 29.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(22, 163, 74); // #16a34a
  doc.text("AUTHORIZED FOR OUTWARD", rightX + 32, currentY + 29.5);
  doc.setTextColor(15, 23, 42);

  currentY += metaHeight;
  doc.line(margin, currentY, margin + contentWidth, currentY);

  // ==========================================
  // SECTION 2: Party & Addresses Box
  // ==========================================
  const partyBoxHeight = 36;
  doc.setFillColor(255, 255, 255);
  doc.rect(margin, currentY, contentWidth, partyBoxHeight);
  doc.line(margin + colW, currentY, margin + colW, currentY + partyBoxHeight);

  // Left Side: Party Name & Billing Address
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.text("Party / Consignee Details :", margin + 4, currentY + 6);

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.text(partyName.toUpperCase(), margin + 4, currentY + 11.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  const billLines = doc.splitTextToSize(`Billing Address: ${billingAddress}`, colW - 8);
  doc.text(billLines.slice(0, 4), margin + 4, currentY + 16.5);

  // Right Side: Shipping Address
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text("Shipping & Delivery Address :", rightX, currentY + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  const shipLines = doc.splitTextToSize(shippingAddress, colW - 8);
  doc.text(shipLines.slice(0, 4), rightX, currentY + 12);

  currentY += partyBoxHeight;
  doc.line(margin, currentY, margin + contentWidth, currentY);

  // ==========================================
  // SECTION 3: Transport & Dispatch Terms Box
  // ==========================================
  const transportBoxHeight = 16;
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, currentY, contentWidth, transportBoxHeight, "F");

  const transColW = contentWidth / 4; // 46.5mm each
  for (let i = 1; i < 4; i++) {
    doc.line(margin + transColW * i, currentY, margin + transColW * i, currentY + transportBoxHeight);
  }

  // Col 1: Transport Name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("TRANSPORT NAME", margin + 3, currentY + 5.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(transportName, margin + 3, currentY + 11);

  // Col 2: Destination
  const t2X = margin + transColW + 3;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("DESTINATION", t2X, currentY + 5.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(destination, t2X, currentY + 11);

  // Col 3: Delivery Type
  const t3X = margin + transColW * 2 + 3;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("DELIVERY TYPE", t3X, currentY + 5.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(deliveryType, t3X, currentY + 11);

  // Col 4: Delivery Charges
  const t4X = margin + transColW * 3 + 3;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("DELIVERY CHARGES", t4X, currentY + 5.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(deliveryCharges.toLowerCase().includes("paid") ? "#16a34a" : "#b45309");
  doc.text(deliveryCharges, t4X, currentY + 11);

  currentY += transportBoxHeight;
  doc.line(margin, currentY, margin + contentWidth, currentY);

  // ==========================================
  // SECTION 4: Product Table
  // Description of goods | HSN Code | QTY | UOM | Remarks
  // ==========================================
  const tableHeaderHeight = 8;
  doc.setFillColor(226, 232, 240); // #e2e8f0
  doc.rect(margin, currentY, contentWidth, tableHeaderHeight, "F");

  // Columns Widths: Total 186mm
  // # (12) | Description (84) | HSN Code (25) | Quantity (20) | UOM (15) | Remarks (30)
  const pCols = [12, 84, 25, 20, 15, 30];
  const pX = [
    margin,
    margin + 12,
    margin + 12 + 84,
    margin + 12 + 84 + 25,
    margin + 12 + 84 + 25 + 20,
    margin + 12 + 84 + 25 + 20 + 15,
  ];

  for (let i = 1; i < pCols.length; i++) {
    doc.line(pX[i], currentY, pX[i], currentY + tableHeaderHeight);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);

  doc.text("#", pX[0] + 6, currentY + 5.5, { align: "center" });
  doc.text("Description of Goods", pX[1] + 3, currentY + 5.5);
  doc.text("HSN Code", pX[2] + 12.5, currentY + 5.5, { align: "center" });
  doc.text("Quantity", pX[3] + 10, currentY + 5.5, { align: "center" });
  doc.text("UOM", pX[4] + 7.5, currentY + 5.5, { align: "center" });
  doc.text("Remarks", pX[5] + 3, currentY + 5.5);

  currentY += tableHeaderHeight;
  doc.line(margin, currentY, margin + contentWidth, currentY);

  // Items Rows
  const rawItems: SaleOrderItem[] = Array.isArray(order.items) && order.items.length > 0
    ? order.items.filter((it: any) => !it.is_additional_charge)
    : [
        {
          id: "item-1",
          order_id: order.id || "sample",
          product_name: "Automatic Continuous Band Sealer (Horizontal)",
          product_code: "CBS-900",
          hsn_code: "84223000",
          quantity: 1,
          uom: "SET",
          remarks: "Standard Wooden Box Packing",
        } as any,
      ];

  const rowHeight = 9;
  let totalQty = 0;

  rawItems.forEach((it, index) => {
    const qty = typeof it.quantity === "number" ? it.quantity : 1;
    totalQty += qty;

    doc.rect(margin, currentY, contentWidth, rowHeight);
    for (let i = 1; i < pCols.length; i++) {
      doc.line(pX[i], currentY, pX[i], currentY + rowHeight);
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);

    // #
    doc.text(String(index + 1), pX[0] + 6, currentY + 6, { align: "center" });

    // Description of Goods
    const pName = it.product_name || "Industrial Packaging Equipment";
    const descLines = doc.splitTextToSize(pName, pCols[1] - 4);
    doc.text(descLines[0], pX[1] + 3, currentY + 6);

    // HSN Code
    doc.text(it.hsn_code || "84223000", pX[2] + 12.5, currentY + 6, { align: "center" });

    // Quantity
    doc.setFont("helvetica", "bold");
    doc.text(String(qty), pX[3] + 10, currentY + 6, { align: "center" });
    doc.setFont("helvetica", "normal");

    // UOM
    doc.text(it.uom || "SET", pX[4] + 7.5, currentY + 6, { align: "center" });

    // Remarks
    const itemRemark = it.remarks || order.booking_remarks || "Verified";
    const remLines = doc.splitTextToSize(itemRemark, pCols[5] - 4);
    doc.text(remLines[0], pX[5] + 3, currentY + 6);

    currentY += rowHeight;
  });

  // Table Totals Bar
  const totalBarHeight = 8;
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, currentY, contentWidth, totalBarHeight, "F");
  doc.rect(margin, currentY, contentWidth, totalBarHeight);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text("TOTAL DISPATCH QUANTITY", pX[1] + 3, currentY + 5.5);
  doc.text(`${totalQty} Units`, pX[3] + 10, currentY + 5.5, { align: "center" });

  currentY += totalBarHeight;

  // ==========================================
  // SECTION 5: Dispatch Instructions & Remarks
  // ==========================================
  const instructionBoxHeight = 34;
  doc.rect(margin, currentY, contentWidth, instructionBoxHeight);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text("Important Security & Gate Pass Instructions :", margin + 4, currentY + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text("1. Security personnel must inspect physical goods, serial number barcodes, and box count against this Gate Pass.", margin + 4, currentY + 11.5);
  doc.text("2. Transporter driver must verify package integrity before departure and sign acknowledging custody.", margin + 4, currentY + 16);
  doc.text("3. This Gate Pass is valid only for the designated transport and destination specified above.", margin + 4, currentY + 20.5);

  const extraNotes = order.remarks ? `Order Remarks: ${order.remarks}` : "";
  if (extraNotes) {
    const noteLines = doc.splitTextToSize(extraNotes, contentWidth - 8);
    doc.text(noteLines[0], margin + 4, currentY + 26);
  }

  currentY += instructionBoxHeight;

  // ==========================================
  // SECTION 6: Signatures (4 Boxes)
  // ==========================================
  const sigBoxHeight = 36;
  doc.rect(margin, currentY, contentWidth, sigBoxHeight);

  const sigColW = contentWidth / 4;
  for (let i = 1; i < 4; i++) {
    doc.line(margin + sigColW * i, currentY, margin + sigColW * i, currentY + sigBoxHeight);
  }

  const sigHeaders = [
    "Prepared / Handled By",
    "Security / Verification",
    "Driver / Transporter Sign",
    "Authorized Signatory",
  ];

  sigHeaders.forEach((title, idx) => {
    const sX = margin + sigColW * idx + 3;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(title, sX, currentY + 6);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);

    if (idx === 0) {
      doc.text(`Name: ${handledBy}`, sX, currentY + 16);
      doc.text("Sign: __________________", sX, currentY + 28);
    } else if (idx === 1) {
      doc.text("Vehicle No: ____________", sX, currentY + 16);
      doc.text("Sign: __________________", sX, currentY + 28);
    } else if (idx === 2) {
      doc.text("Driver Name: ___________", sX, currentY + 16);
      doc.text("Sign & Mob: ____________", sX, currentY + 28);
    } else {
      doc.text(`For ${brandName}`, sX, currentY + 16);
      doc.text("Authorized Sign: _______", sX, currentY + 28);
    }
  });

  currentY += sigBoxHeight;

  // ==========================================
  // SECTION 7: Footer Notice
  // ==========================================
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(100, 116, 139);
  doc.text(
    `System Generated Document - Inhyma Solutions ERP | Gate Pass No: ${gatepassNo} | Printed: ${todayFormatted} ${new Date().toLocaleTimeString()}`,
    margin + 4,
    currentY + 6
  );

  if (options?.saveFile) {
    doc.save(`GatePass_${gatepassNo.replace(/[/\\?%*:|"<>]/g, "-")}.pdf`);
  }

  if (options?.openInNewTab) {
    const blob = doc.output("blob");
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, "_blank");
  }

  return doc;
}
