import jsPDF from "jspdf";
import type { ProformaInvoice, ProformaLineItem, Organization } from "@/types";
import { getCachedBrandName, getCachedBrandLogo, getCachedOrganizationProfile } from "@/lib/brand";
import { INHYMA_LOGO_BASE64 } from "@/lib/inhymaLogoBase64";

/**
 * Format currency matching legacy ERP Proforma PDF:
 * e.g. "Rs. 1,82,900.00" or "Rs. 0.00"
 */
export function formatPdfCurrency(amount: number | null | undefined): string {
  const val = typeof amount === "number" ? amount : 0;
  return "Rs. " + val.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export interface BankDetails {
  bank_name?: string;
  account_number?: string;
  account_holder_name?: string;
  ifsc_code?: string;
  branch?: string;
}

export interface ProformaInvoicePdfOptions {
  openInNewTab?: boolean;
  saveFile?: boolean;
  doc?: jsPDF;
  bankDetails?: BankDetails;
  logoUrl?: string | null;
  orgProfile?: Partial<Organization> | null;
}

/**
 * Generates an official Proforma Invoice PDF matching the exact
 * TCPDF layout from the user screenshot:
 * - Header: "Proforma Invoice"
 * - Company details: Inhyma Solutions LLP (M), Wagle Estate Thane, Email, Phone, GSTIN
 * - 3-Column box: Bill To, Delivery, Details (PI No, Date, Exp. Dispatch Date, Payment Terms, Created)
 * - Product Summary Table: Sr. | Item(s) | HSN | Qty | Price | Tax | Subtotal
 * - Discount, Tax, Total rows
 * - Terms And Conditions: Transport Charges, Payment Terms, Cancellation terms
 * - Signature lines: Received by, Approved by
 * - Bank Details: HDFC Bank, A/c No, IFSC Code
 * - Computer-generated notice & TCPDF footer
 */
export function generateProformaInvoicePdf(
  item: ProformaInvoice,
  options?: ProformaInvoicePdfOptions
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

  const piNo = item.proforma_no || "PI-MH/26-27/1714";

  doc.setProperties({
    title: `PI No: ${piNo}`,
    subject: "Proforma Invoice",
    author: getCachedBrandName(),
  });

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.35);

  let currentY = 14;

  // ==========================================
  // SECTION 1: Top Header "Proforma Invoice"
  // ==========================================
  const headerHeight = 7.5;
  doc.rect(margin, currentY, contentWidth, headerHeight);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(0, 0, 0);
  doc.text("Proforma Invoice", pageWidth / 2, currentY + 5.2, { align: "center" });

  currentY += headerHeight;

  // ==========================================
  // SECTION 2: Company Details Box (Logo Left, Address Right)
  // ==========================================
  const companyBoxHeight = 32;
  doc.rect(margin, currentY, contentWidth, companyBoxHeight);

  // Retrieve logo and organization details from options / ERP Settings cache
  const logoData = options?.logoUrl ?? getCachedBrandLogo() ?? INHYMA_LOGO_BASE64;
  const orgProfile = options?.orgProfile ?? getCachedOrganizationProfile();
  const brandName = (orgProfile?.company_name || getCachedBrandName()).trim();

  // Left: Render Company Logo image from ERP Settings
  let logoRendered = false;
  if (logoData && typeof logoData === "string" && logoData.trim()) {
    try {
      let imgType = "PNG";
      if (
        logoData.startsWith("data:image/jpeg") ||
        logoData.startsWith("data:image/jpg") ||
        /\.jpe?g($|\?)/i.test(logoData)
      ) {
        imgType = "JPEG";
      } else if (
        logoData.startsWith("data:image/webp") ||
        /\.webp($|\?)/i.test(logoData)
      ) {
        imgType = "WEBP";
      }

      let renderW = 50;
      let renderH = 24;

      try {
        const props = doc.getImageProperties(logoData);
        if (props && props.width > 0 && props.height > 0) {
          const aspect = props.width / props.height;
          const maxW = 52;
          const maxH = 25;
          if (aspect > maxW / maxH) {
            renderW = maxW;
            renderH = Math.max(10, Math.min(maxH, maxW / aspect));
          } else {
            renderH = maxH;
            renderW = Math.max(15, Math.min(maxW, maxH * aspect));
          }
        }
      } catch {
        renderW = 50;
        renderH = 24;
      }

      const renderY = currentY + (companyBoxHeight - renderH) / 2;
      const renderX = margin + 4;

      doc.addImage(logoData, imgType, renderX, renderY, renderW, renderH, undefined, "FAST");
      logoRendered = true;
    } catch {
      // If primary custom logoData failed and was not default base64, attempt fallback
      if (logoData !== INHYMA_LOGO_BASE64) {
        try {
          const renderW = 48;
          const renderH = 22;
          const renderY = currentY + (companyBoxHeight - renderH) / 2;
          const renderX = margin + 4;
          doc.addImage(INHYMA_LOGO_BASE64, "PNG", renderX, renderY, renderW, renderH, undefined, "FAST");
          logoRendered = true;
        } catch {
          logoRendered = false;
        }
      }
    }
  }

  // Graceful fallback brand text if image cannot be rendered
  if (!logoRendered) {
    const brandX = margin + 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(0, 97, 242);
    doc.text(brandName.toUpperCase(), brandX, currentY + 12);
    doc.setFontSize(7.5);
    doc.setTextColor(220, 38, 38);
    doc.text("YOUR INDUSTRIAL HYPER MARKET", brandX, currentY + 18);
  }

  // Right: Company Info Block from ERP Settings
  const compInfoX = margin + 58;
  const maxCompWidth = contentWidth - 60; // 126mm width
  doc.setTextColor(0, 0, 0);

  // 1. Company Name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(brandName.toUpperCase(), compInfoX, currentY + 6);

  // 2. Address Lines
  const rawAddress =
    orgProfile?.address?.trim() ||
    "4th Floor, Office No 421, Supremus -II, Road No- 22, Near Passport Office, Wagle Estate";
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);

  const addrLines = doc.splitTextToSize(rawAddress, maxCompWidth);
  const displayAddrLines = addrLines.slice(0, 2);
  let compLineY = currentY + 10;
  displayAddrLines.forEach((line: string) => {
    doc.text(line, compInfoX, compLineY);
    compLineY += 3.6;
  });

  // 3. City, State, Postal Code
  const cityStateParts = [orgProfile?.city?.trim(), orgProfile?.state?.trim()].filter(Boolean);
  const zip = orgProfile?.postal_code?.trim();
  const cityLine = cityStateParts.length
    ? cityStateParts.join(", ") + (zip ? ` - ${zip}` : "")
    : "Thane, Maharashtra - 400604";
  doc.text(cityLine, compInfoX, compLineY);
  compLineY += 3.6;

  // 4. Contact Details (Email & Phone)
  const orgEmail = orgProfile?.email?.trim() || "payment.darsh@gmail.com";
  const orgPhone = orgProfile?.phone?.trim() || "+91 96532 61742";
  const contactParts = [orgEmail ? `Email: ${orgEmail}` : "", orgPhone ? `Phone: ${orgPhone}` : ""].filter(Boolean);
  if (contactParts.length > 0) {
    doc.text(contactParts.join(", "), compInfoX, compLineY);
    compLineY += 3.6;
  }

  // 5. GST Number
  const orgGst = orgProfile?.gst_number?.trim() || "27AAKFI9869H1ZL";
  doc.setFont("helvetica", "bold");
  doc.text(`GST No: ${orgGst}`, compInfoX, compLineY);

  currentY += companyBoxHeight;

  // ==========================================
  // SECTION 3: 3-Column Entity Info (Bill To, Delivery, Details)
  // ==========================================
  const colWidth = contentWidth / 3; // 62mm each
  const entityBoxHeight = 44;
  doc.rect(margin, currentY, contentWidth, entityBoxHeight);
  // Column dividers
  doc.line(margin + colWidth, currentY, margin + colWidth, currentY + entityBoxHeight);
  doc.line(margin + colWidth * 2, currentY, margin + colWidth * 2, currentY + entityBoxHeight);

  // Col 1: Bill To
  const col1X = margin + 2.5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Bill To", col1X, currentY + 4.5);
  doc.line(margin, currentY + 6, margin + colWidth, currentY + 6);

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text((item.company_name || "ELITE PACK INDIA").toUpperCase(), col1X, currentY + 10);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  const billAddr = item.billing_address || "THIRD FLOOR, B-10/A, SHISH RAM PARK,\nUTTAM NAGAR, West Delhi, Delhi, 110059,\nNew Delhi, Delhi, 110059";
  const billLines = doc.splitTextToSize(billAddr, colWidth - 5);
  doc.text(billLines, col1X, currentY + 13.5);

  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text("Phone: " + ((item as any).phone || "9599915429"), col1X, currentY + 36);
  doc.text("GST No: " + ((item as any).gst_no || "07BEMPC5877G1Z7"), col1X, currentY + 40);

  // Col 2: Delivery
  const col2X = margin + colWidth + 2.5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Delivery", col2X, currentY + 4.5);
  doc.line(margin + colWidth, currentY + 6, margin + colWidth * 2, currentY + 6);

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text((item.company_name || "ELITE PACK INDIA").toUpperCase(), col2X, currentY + 10);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  const shipAddr = item.shipping_address || item.billing_address || "THIRD FLOOR, B-10/A, SHISH RAM PARK,\nUTTAM NAGAR, West Delhi, Delhi, 110059,\nNew Delhi, Delhi, 110059";
  const shipLines = doc.splitTextToSize(shipAddr, colWidth - 5);
  doc.text(shipLines, col2X, currentY + 13.5);

  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text("Phone: " + ((item as any).phone || "9599915429"), col2X, currentY + 34.5);
  doc.text("GST No: " + ((item as any).gst_no || "07BEMPC5877G1Z7"), col2X, currentY + 38);
  doc.setFont("helvetica", "bold");
  doc.text("Transport Name: " + (item.transport_name || "Self Pickup"), col2X, currentY + 41.5);

  // Col 3: Details
  const col3X = margin + colWidth * 2 + 2.5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Details", col3X, currentY + 4.5);
  doc.line(margin + colWidth * 2, currentY + 6, margin + contentWidth, currentY + 6);

  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("PI No: " + piNo, col3X, currentY + 10);
  doc.text("Date: " + (item.proforma_date || "21-09-2026"), col3X, currentY + 14);

  doc.text("Exp. Dispatch Date: " + (item.expected_delivery_date || "21-09-2026"), col3X, currentY + 19.5);
  doc.text("Payment Terms: " + (item.payment_terms || "30 Days Credit"), col3X, currentY + 23.5);

  doc.text("Created: " + (item.proforma_date || "21-09-2026") + " 03:31 PM", col3X, currentY + 31.5);

  currentY += entityBoxHeight;

  // ==========================================
  // SECTION 4: Product Summary Table
  // ==========================================
  const prodSummaryHeaderHeight = 6.5;
  doc.rect(margin, currentY, contentWidth, prodSummaryHeaderHeight);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Product Summary", pageWidth / 2, currentY + 4.5, { align: "center" });

  currentY += prodSummaryHeaderHeight;

  // Table Column Widths: 10, 68, 24, 16, 22, 22, 24 = 186mm
  const colW = [10, 68, 24, 16, 22, 22, 24];
  const colXPos = [
    margin,
    margin + colW[0],
    margin + colW[0] + colW[1],
    margin + colW[0] + colW[1] + colW[2],
    margin + colW[0] + colW[1] + colW[2] + colW[3],
    margin + colW[0] + colW[1] + colW[2] + colW[3] + colW[4],
    margin + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] + colW[5],
  ];

  // Table Header Row
  const tableHeaderHeight = 6.5;
  doc.rect(margin, currentY, contentWidth, tableHeaderHeight);
  for (let i = 1; i < colW.length; i++) {
    doc.line(colXPos[i], currentY, colXPos[i], currentY + tableHeaderHeight);
  }

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("Sr.", colXPos[0] + colW[0] / 2, currentY + 4.5, { align: "center" });
  doc.text("Item(s)", colXPos[1] + 3, currentY + 4.5);
  doc.text("HSN", colXPos[2] + colW[2] / 2, currentY + 4.5, { align: "center" });
  doc.text("Qty", colXPos[3] + colW[3] / 2, currentY + 4.5, { align: "center" });
  doc.text("Price", colXPos[4] + colW[4] - 3, currentY + 4.5, { align: "right" });
  doc.text("Tax", colXPos[5] + colW[5] - 3, currentY + 4.5, { align: "right" });
  doc.text("Subtotal", colXPos[6] + colW[6] - 3, currentY + 4.5, { align: "right" });

  currentY += tableHeaderHeight;

  // Table Rows
  const lineItems: ProformaLineItem[] =
    item.items && item.items.length > 0
      ? item.items
      : [
          {
            id: "pi-it-1",
            product_name: "DQFXA6050 Automatic Carton Sealer",
            hsn_code: "8422.30.00",
            quantity: 1,
            uom: "Nos",
            rate: 155000.0,
            amount: 182900.0,
            gst_amount: 27900.0,
            gst_percent: 18,
            taxable_amount: 155000.0,
            total: 182900.0,
          },
        ];

  const rowHeight = 14;
  lineItems.forEach((it, idx) => {
    doc.rect(margin, currentY, contentWidth, rowHeight);
    for (let i = 1; i < colW.length; i++) {
      doc.line(colXPos[i], currentY, colXPos[i], currentY + rowHeight);
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);

    // Sr.
    doc.text(String(idx + 1), colXPos[0] + colW[0] / 2, currentY + 6, { align: "center" });

    // Item name
    const itemLines = doc.splitTextToSize(it.product_name, colW[1] - 4);
    doc.text(itemLines, colXPos[1] + 2.5, currentY + 5.5);

    // HSN & GST %
    const hsnText = it.hsn_code || "8422.30.00";
    const gstPct = (it as any).gst_percent ? `${(it as any).gst_percent}%` : "18%";
    doc.text(hsnText, colXPos[2] + colW[2] / 2, currentY + 5.5, { align: "center" });
    doc.text(gstPct, colXPos[2] + colW[2] / 2, currentY + 9.5, { align: "center" });

    // Qty
    doc.text(String(it.quantity || 1), colXPos[3] + colW[3] / 2, currentY + 6, { align: "center" });

    // Price
    const priceVal = it.rate || (it as any).unit_price || 155000.0;
    doc.text(formatPdfCurrency(priceVal), colXPos[4] + colW[4] - 2.5, currentY + 6, { align: "right" });

    // Tax
    const taxVal = (it as any).gst_amount ?? ((it.amount || it.rate || 0) * 0.18);
    doc.text(formatPdfCurrency(taxVal), colXPos[5] + colW[5] - 2.5, currentY + 6, { align: "right" });

    // Subtotal
    const subtotalVal = it.amount || (it as any).total || 182900.0;
    doc.text(formatPdfCurrency(subtotalVal), colXPos[6] + colW[6] - 2.5, currentY + 6, { align: "right" });

    currentY += rowHeight;
  });

  // Table Totals Section (Discount, Tax, Total)
  const totalsHeight = 21;
  doc.rect(margin, currentY, contentWidth, totalsHeight);

  // Divide right totals box
  const rightTotalsW = colW[4] + colW[5] + colW[6];
  const rightTotalsX = margin + contentWidth - rightTotalsW;
  doc.line(rightTotalsX, currentY, rightTotalsX, currentY + totalsHeight);

  // Internal horizontal lines for 3 rows in right box
  const singleRowH = totalsHeight / 3;
  doc.line(rightTotalsX, currentY + singleRowH, margin + contentWidth, currentY + singleRowH);
  doc.line(rightTotalsX, currentY + singleRowH * 2, margin + contentWidth, currentY + singleRowH * 2);

  // Middle vertical divider between label and value
  const midDividerX = rightTotalsX + 28;
  doc.line(midDividerX, currentY, midDividerX, currentY + totalsHeight);

  // Row 1: Discount
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.text("Discount", rightTotalsX + 3, currentY + 5);
  doc.text(formatPdfCurrency(item.discount || 0), margin + contentWidth - 3, currentY + 5, { align: "right" });

  // Row 2: Tax
  doc.text("Tax", rightTotalsX + 3, currentY + singleRowH + 5);
  const totalTax =
    lineItems.reduce((acc, it) => acc + ((it as any).gst_amount || 0), 0) || 27900.0;
  doc.text(formatPdfCurrency(totalTax), margin + contentWidth - 3, currentY + singleRowH + 5, { align: "right" });

  // Row 3: Total
  doc.setFont("helvetica", "bold");
  doc.text("Total", rightTotalsX + 3, currentY + singleRowH * 2 + 5);
  const totalIncGst = item.amount_inc_gst || 182900.0;
  doc.text(formatPdfCurrency(totalIncGst), margin + contentWidth - 3, currentY + singleRowH * 2 + 5, { align: "right" });

  currentY += totalsHeight;

  // ==========================================
  // SECTION 5: Terms and Conditions Box + Signatures
  // ==========================================
  const termsBoxHeight = 44;
  doc.rect(margin, currentY, contentWidth, termsBoxHeight);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Terms And Conditions", margin + 4, currentY + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("1. Transport Charges: To Pay.", margin + 4, currentY + 11.5);
  doc.text("2. Payment Terms: 100% Before Dispatch.", margin + 4, currentY + 15.5);
  doc.text("3. Order once confirmed, cannot be cancelled.", margin + 4, currentY + 19.5);

  // Signature Blocks
  const sigY = currentY + 28;
  const sigLeftX = margin + 5;
  const sigRightX = margin + contentWidth / 2 + 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("Received by", sigLeftX, sigY);
  doc.text("Approved by", sigRightX, sigY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("Name :", sigLeftX, sigY + 6);
  doc.text("Sign :", sigLeftX, sigY + 11);

  doc.text("Name :", sigRightX, sigY + 6);
  doc.text("Sign :", sigRightX, sigY + 11);

  currentY += termsBoxHeight;

  // ==========================================
  // SECTION 6: Bank Details Box
  // ==========================================
  const bankBoxHeight = 26;
  doc.rect(margin, currentY, contentWidth, bankBoxHeight);

  const bank = options?.bankDetails || {};
  const bName = bank.bank_name || "HDFC BANK";
  const acHolder = bank.account_holder_name || brandName.toUpperCase();
  const acNo = bank.account_number || "50200102929151";
  const branchIfsc = [bank.branch, bank.ifsc_code].filter(Boolean).join(" & ") || "PARMESHWARI PLAZA MULUND (W) & HDFC0001576";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Bank Details", margin + 4, currentY + 5.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("A/c Holder's Name :", margin + 4, currentY + 10.5);
  doc.setFont("helvetica", "normal");
  doc.text(acHolder, margin + 35, currentY + 10.5);

  doc.setFont("helvetica", "bold");
  doc.text("Bank Name :", margin + 4, currentY + 14.5);
  doc.setFont("helvetica", "normal");
  doc.text(bName, margin + 35, currentY + 14.5);

  doc.setFont("helvetica", "bold");
  doc.text("A/c No. :", margin + 4, currentY + 18.5);
  doc.setFont("helvetica", "normal");
  doc.text(acNo, margin + 35, currentY + 18.5);

  doc.setFont("helvetica", "bold");
  doc.text("Branch & IFSC Code :", margin + 4, currentY + 22.5);
  doc.setFont("helvetica", "normal");
  doc.text(branchIfsc, margin + 35, currentY + 22.5);

  currentY += bankBoxHeight;

  // ==========================================
  // SECTION 7: Footer Notice
  // ==========================================
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(50, 50, 50);
  doc.text("This is a computer-generated document. No signature is required.", margin, currentY + 6);

  doc.setFontSize(6.5);
  doc.setTextColor(100, 100, 100);
  doc.text("Powered by TCPDF (www.tcpdf.org)", margin, currentY + 10);

  if (options?.saveFile) {
    doc.save("proforma_invoice.pdf");
  }

  if (options?.openInNewTab) {
    const blob = doc.output("blob");
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, "_blank");
  }

  return doc;
}
