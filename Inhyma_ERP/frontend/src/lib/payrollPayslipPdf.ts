import jsPDF from "jspdf";
import { getCachedBrandName } from "@/lib/brand";
import { INHYMA_LOGO_BASE64 } from "@/lib/inhymaLogoBase64";

export interface PayslipPdfData {
  company_name?: string;
  company_address?: string;
  company_email?: string;
  company_phone?: string;
  company_cin?: string;
  company_gstin?: string;
  employee_name: string;
  employee_code: string;
  department: string;
  designation: string;
  payroll_month: string;
  annual_ctc: number;
  monthly_ctc: number;
  working_days: number;
  present_days: number;
  paid_leave_days: number;
  holiday_days: number;
  weekend_days: number;
  lop_days: number;
  paid_days?: number;
  bank_name?: string;
  bank_account_no?: string;
  payment_mode?: string;
  date_of_joining?: string;
  pf_uan?: string;
  pan_number?: string;
  earnings_breakdown: Array<{
    name: string;
    monthly_amount: number;
    code?: string;
  }>;
  deductions_breakdown: Array<{
    name: string;
    monthly_amount: number;
    code?: string;
  }>;
  additions_breakdown?: Array<{
    title: string;
    amount: number;
    reason?: string;
  }>;
  lop_deduction: number;
  gross_amount: number;
  total_deductions: number;
  net_salary: number;
  status?: string;
}

/** Formats currency with Indian numbering system (e.g. ₹50,000.00) for UI display */
export function formatInr(val: number): string {
  const n = Number(val || 0);
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Formats clean Indian number without currency symbol prefix (e.g. 50,000.00) */
export function formatIndianNumber(val: number): string {
  const n = Number(val || 0);
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Convert integer amount to Indian English Words */
export function amountInWords(num: number): string {
  const a = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function inWords(n: number): string {
    if (n === 0) return "";
    if (n < 20) return a[n] + " ";
    if (n < 100) return b[Math.floor(n / 10)] + " " + (n % 10 !== 0 ? a[n % 10] + " " : "");
    if (n < 1000) return a[Math.floor(n / 100)] + " Hundred " + inWords(n % 100);
    if (n < 100000) return inWords(Math.floor(n / 1000)) + "Thousand " + inWords(n % 1000);
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + "Lakh " + inWords(n % 100000);
    return inWords(Math.floor(n / 10000000)) + "Crore " + inWords(n % 10000000);
  }

  const rounded = Math.round(Number(num || 0));
  if (rounded <= 0) return "Zero Rupees Only";
  const words = inWords(rounded).trim().replace(/\s+/g, " ");
  return words ? `Rupees ${words} Only` : "Rupees Zero Only";
}

/**
 * Draws a sharp, proportional vector Indian Rupee symbol (₹).
 * Avoids jsPDF multibyte UTF-16 character spacing bugs in default fonts.
 */
function drawRupeeGlyph(
  doc: jsPDF,
  x: number,
  y: number,
  height: number,
  color: [number, number, number]
) {
  doc.saveGraphicsState();
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(height * 0.08);

  const w = height * 0.72;
  const topY = y - height * 0.82;
  const midY = y - height * 0.52;
  const loopBottomY = y - height * 0.28;

  // Top horizontal bar
  doc.line(x, topY, x + w, topY);
  // Second horizontal bar
  doc.line(x, midY, x + w * 0.88, midY);
  // Vertical stem of R
  doc.line(x + w * 0.16, topY, x + w * 0.16, loopBottomY);
  // Upper semi-circle loop
  doc.line(x + w * 0.16, topY, x + w * 0.68, topY);
  doc.line(x + w * 0.68, topY, x + w * 0.68, midY);
  doc.line(x + w * 0.68, midY, x + w * 0.16, midY);
  // Diagonal leg downwards
  doc.line(x + w * 0.25, midY, x + w * 0.92, y);

  doc.restoreGraphicsState();
}

/**
 * Renders right-aligned Indian Currency with authentic ₹ glyph and no character spacing.
 */
function renderRightAlignedCurrency(
  doc: jsPDF,
  amount: number,
  rightX: number,
  baselineY: number,
  fontSize: number,
  color: [number, number, number],
  isBold: boolean = false
): number {
  doc.setFont("helvetica", isBold ? "bold" : "normal");
  doc.setFontSize(fontSize);
  doc.setTextColor(color[0], color[1], color[2]);

  const numStr = formatIndianNumber(amount);
  const numWidth = doc.getTextWidth(numStr);
  const glyphH = fontSize * 0.27; // approx mm height
  const glyphW = glyphH * 0.72;
  const spacing = 1.0; // mm between ₹ and first digit

  const startX = rightX - numWidth - glyphW - spacing;

  // Draw Rupee symbol
  drawRupeeGlyph(doc, startX, baselineY, glyphH, color);

  // Print digits with standard 8-bit WinAnsi kerning (no digit spacing!)
  doc.text(numStr, rightX - numWidth, baselineY);

  return numWidth + glyphW + spacing;
}

/**
 * Renders left-aligned Indian Currency with authentic ₹ glyph and no character spacing.
 */
function renderLeftAlignedCurrency(
  doc: jsPDF,
  amount: number,
  startX: number,
  baselineY: number,
  fontSize: number,
  color: [number, number, number],
  isBold: boolean = false
): number {
  doc.setFont("helvetica", isBold ? "bold" : "normal");
  doc.setFontSize(fontSize);
  doc.setTextColor(color[0], color[1], color[2]);

  const glyphH = fontSize * 0.32;
  const glyphW = glyphH * 0.72;
  const spacing = 1.0;

  drawRupeeGlyph(doc, startX, baselineY, glyphH, color);

  const numStr = formatIndianNumber(amount);
  doc.text(numStr, startX + glyphW + spacing, baselineY);

  return glyphW + spacing + doc.getTextWidth(numStr);
}

/**
 * Professional Payslip PDF Generator for Inhyma ERP HRMS.
 * Redesigned to corporate salary statement standards:
 * - Proportional company logo with no stretching
 * - Inhyma corporate navy & slate palette
 * - Clear employee identity & attendance metrics
 * - Balanced dynamic two-column earnings & deductions table
 * - Formatted Indian numbers without wide character spacing
 * - Net pay hero card with amount in words
 * - A4 layout with generation timestamp and verification footer
 */
export function generatePayslipPdf(data: PayslipPdfData): jsPDF {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = 210;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2; // 182mm
  const brandName = getCachedBrandName() || "INHYMA ENTERPRISES PVT. LTD.";
  const companyName = data.company_name || brandName;

  // Colors
  const navyDark: [number, number, number] = [15, 23, 42];     // #0F172A
  const slateDark: [number, number, number] = [30, 41, 59];    // #1E293B
  const slateMuted: [number, number, number] = [100, 116, 139]; // #64748B
  const brandAccent: [number, number, number] = [2, 132, 199];  // #0284C7
  const borderLight: [number, number, number] = [226, 232, 240]; // #E2E8F0
  const emeraldGreen: [number, number, number] = [16, 185, 129]; // #10B981

  let curY = 12;

  // =========================================================================
  // SECTION 1: HEADER & CORPORATE BRANDING (Logo + Company + Document Title)
  // =========================================================================

  // 1. Proportional Logo (Aspect Ratio: 179 / 123 = 1.455)
  const logoH = 15;
  const logoW = logoH * 1.455; // 21.8mm
  try {
    doc.addImage(INHYMA_LOGO_BASE64, "PNG", margin, curY, logoW, logoH, undefined, "FAST");
  } catch (err) {
    // Graceful fallback if image fail
    doc.setFillColor(navyDark[0], navyDark[1], navyDark[2]);
    doc.roundedRect(margin, curY, logoW, logoH, 1, 1, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text("IHM", margin + logoW / 2, curY + logoH / 2 + 1.5, { align: "center" });
  }

  // 2. Company Details Block (Next to Logo)
  const compInfoX = margin + logoW + 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(navyDark[0], navyDark[1], navyDark[2]);
  doc.text(companyName.toUpperCase(), compInfoX, curY + 4.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(brandAccent[0], brandAccent[1], brandAccent[2]);
  doc.text("YOUR INDUSTRIAL HYPERMARKET & ENGINEERING SOLUTIONS", compInfoX, curY + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.8);
  doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
  doc.text(
    data.company_address || "4th Floor, Office No 421, Supremus-II, Road No 22, Wagle Estate, Thane, MH - 400604",
    compInfoX,
    curY + 11.5
  );
  doc.text(
    data.company_email ? `Email: ${data.company_email} | Web: erp.inhymasolutions.com` : "Email: info@inhyma.com | Web: erp.inhymasolutions.com",
    compInfoX,
    curY + 14.5
  );

  // 3. Document Title, Month & Status Pill (Right Aligned)
  const rightX = margin + contentWidth;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(slateDark[0], slateDark[1], slateDark[2]);
  doc.text("SALARY STATEMENT / PAYSLIP", rightX, curY + 4.5, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(brandAccent[0], brandAccent[1], brandAccent[2]);
  const monthNameStr = (data.payroll_month || "").toUpperCase();
  doc.text(`MONTH: ${monthNameStr}`, rightX, curY + 9, { align: "right" });

  // Status Badge Pill
  const isApproved = (data.status || "APPROVED").toUpperCase() === "APPROVED";
  const statusLabel = isApproved ? "APPROVED & LOCKED" : (data.status || "DRAFT").toUpperCase();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  const badgeW = doc.getTextWidth(statusLabel) + 6;
  const badgeH = 5;
  const badgeX = rightX - badgeW;
  const badgeY = curY + 10.8;

  if (isApproved) {
    doc.setFillColor(220, 252, 231); // #DCFCE7 soft green
    doc.setDrawColor(134, 239, 172); // #86EFAC green border
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1, 1, "FD");
    doc.setTextColor(21, 128, 61);   // #15803D dark green
  } else {
    doc.setFillColor(254, 243, 199); // #FEF3C7 amber
    doc.setDrawColor(252, 211, 77);  // #FCD34D
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1, 1, "FD");
    doc.setTextColor(180, 83, 9);    // #B45309 amber
  }
  doc.text(statusLabel, badgeX + badgeW / 2, badgeY + 3.5, { align: "center" });

  curY += 19;

  // Thin Accent Divider
  doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
  doc.setLineWidth(0.35);
  doc.line(margin, curY, margin + contentWidth, curY);

  curY += 4;

  // =========================================================================
  // SECTION 2: EMPLOYEE DETAILS (Structured 4-Column Card)
  // =========================================================================
  const infoBoxH = 26;
  doc.setFillColor(248, 250, 252); // #F8FAFC
  doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
  doc.roundedRect(margin, curY, contentWidth, infoBoxH, 1.5, 1.5, "FD");

  // Subtitle header inside card
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(brandAccent[0], brandAccent[1], brandAccent[2]);
  doc.text("EMPLOYEE MASTER INFORMATION", margin + 4, curY + 5);

  const col1X = margin + 4;
  const col2X = margin + 50;
  const col3X = margin + 98;
  const col4X = margin + 142;

  const renderField = (x: number, y: number, label: string, value: string, highlight: boolean = false) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
    doc.text(label, x, y);

    doc.setFont("helvetica", highlight ? "bold" : "normal");
    doc.setFontSize(8.2);
    doc.setTextColor(highlight ? brandAccent[0] : navyDark[0], highlight ? brandAccent[1] : navyDark[1], highlight ? brandAccent[2] : navyDark[2]);
    doc.text(value || "-", x, y + 4.2);
  };

  const renderCurrencyField = (x: number, y: number, label: string, amount: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
    doc.text(label, x, y);

    renderLeftAlignedCurrency(doc, amount, x, y + 4.2, 8.2, navyDark, false);
  };

  // Row 1 (y: curY + 10)
  renderField(col1X, curY + 10, "EMPLOYEE NAME", data.employee_name || "Employee");
  renderField(col2X, curY + 10, "EMPLOYEE CODE", data.employee_code || "-", true);
  renderField(col3X, curY + 10, "DEPARTMENT", data.department || "General");
  renderField(col4X, curY + 10, "DESIGNATION", data.designation || "Staff");

  // Row 2 (y: curY + 18)
  const payMode = data.payment_mode || "Bank Transfer";
  const paidDaysVal = data.paid_days !== undefined
    ? String(data.paid_days)
    : String(Number((data.present_days + data.paid_leave_days + data.holiday_days + data.weekend_days).toFixed(1)));

  renderCurrencyField(col1X, curY + 18, "ANNUAL CTC", data.annual_ctc);
  renderCurrencyField(col2X, curY + 18, "MONTHLY CTC", data.monthly_ctc);
  renderField(col3X, curY + 18, "PAYMENT METHOD", payMode);
  renderField(col4X, curY + 18, "EFFECTIVE PAID DAYS", paidDaysVal, true);

  curY += infoBoxH + 4;

  // =========================================================================
  // SECTION 3: ATTENDANCE SUMMARY (6-Metric Horizontal Bar)
  // =========================================================================
  const attBoxH = 15;
  doc.setFillColor(241, 245, 249); // #F1F5F9
  doc.setDrawColor(203, 213, 225); // #CBD5E1
  doc.roundedRect(margin, curY, contentWidth, attBoxH, 1.2, 1.2, "FD");

  const metricCols = [
    { label: "Working Days", val: String(data.working_days), color: navyDark },
    { label: "Present Days", val: String(data.present_days), color: emeraldGreen },
    { label: "Paid Leaves", val: String(data.paid_leave_days), color: brandAccent },
    { label: "Holidays", val: String(data.holiday_days), color: [109, 40, 217] as [number, number, number] },
    { label: "Weekly Offs", val: String(data.weekend_days), color: slateMuted },
    {
      label: "Loss of Pay (LOP)",
      val: String(data.lop_days),
      color: data.lop_days > 0 ? ([220, 38, 38] as [number, number, number]) : slateMuted,
    },
  ];

  const metricW = contentWidth / metricCols.length;
  metricCols.forEach((m, idx) => {
    const xCenter = margin + idx * metricW + metricW / 2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
    doc.text(m.label, xCenter, curY + 5, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(m.color[0], m.color[1], m.color[2]);
    doc.text(m.val, xCenter, curY + 11.5, { align: "center" });

    // Vertical column divider
    if (idx < metricCols.length - 1) {
      doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
      doc.line(margin + (idx + 1) * metricW, curY + 2.5, margin + (idx + 1) * metricW, curY + attBoxH - 2.5);
    }
  });

  curY += attBoxH + 5;

  // =========================================================================
  // SECTION 4: SALARY BREAKDOWN (Balanced Side-by-Side Two-Column Table)
  // =========================================================================
  const gap = 4;
  const colW = (contentWidth - gap) / 2; // 89mm
  const colEarningsX = margin;
  const colDeductionsX = margin + colW + gap;

  // Header Bar (Height 7.5mm)
  const thH = 7.5;
  doc.setFillColor(30, 41, 59); // slate-800
  doc.rect(colEarningsX, curY, colW, thH, "F");
  doc.rect(colDeductionsX, curY, colW, thH, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.2);
  doc.setTextColor(255, 255, 255);

  // Left Header
  doc.text("EARNINGS & ALLOWANCES", colEarningsX + 4, curY + 5);
  doc.text("AMOUNT", colEarningsX + colW - 4, curY + 5, { align: "right" });

  // Right Header
  doc.text("DEDUCTIONS & TAXES", colDeductionsX + 4, curY + 5);
  doc.text("AMOUNT", colDeductionsX + colW - 4, curY + 5, { align: "right" });

  curY += thH;

  // Compile Dynamic Rows
  const earningsList: Array<{ label: string; amount: number }> = [];
  (data.earnings_breakdown || []).forEach((e) => {
    earningsList.push({ label: e.name, amount: e.monthly_amount });
  });
  (data.additions_breakdown || []).forEach((a) => {
    earningsList.push({ label: `[Add] ${a.title}`, amount: a.amount });
  });

  const deductionsList: Array<{ label: string; amount: number }> = [];
  (data.deductions_breakdown || []).forEach((d) => {
    deductionsList.push({ label: d.name, amount: d.monthly_amount });
  });
  if (data.lop_deduction > 0) {
    deductionsList.push({
      label: `Loss of Pay Deduction (${data.lop_days} days)`,
      amount: data.lop_deduction,
    });
  }

  const rowCount = Math.max(earningsList.length, deductionsList.length, 5); // minimum 5 rows for balance
  const rowH = 6.2;
  const tableStartY = curY;

  for (let i = 0; i < rowCount; i++) {
    const isEven = i % 2 === 0;
    const rowY = curY;

    // Row zebra striping
    if (isEven) {
      doc.setFillColor(250, 250, 252);
      doc.rect(colEarningsX, rowY, colW, rowH, "F");
      doc.rect(colDeductionsX, rowY, colW, rowH, "F");
    }

    const earning = earningsList[i];
    const deduction = deductionsList[i];

    // Left Cell (Earning)
    if (earning) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(51, 65, 85);
      doc.text(earning.label, colEarningsX + 4, rowY + 4.2);
      renderRightAlignedCurrency(doc, earning.amount, colEarningsX + colW - 4, rowY + 4.2, 8, slateDark, false);
    }

    // Right Cell (Deduction)
    if (deduction) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(51, 65, 85);
      doc.text(deduction.label, colDeductionsX + 4, rowY + 4.2);
      renderRightAlignedCurrency(doc, deduction.amount, colDeductionsX + colW - 4, rowY + 4.2, 8, slateDark, false);
    }

    // Horizontal bottom line
    doc.setDrawColor(241, 245, 249);
    doc.setLineWidth(0.2);
    doc.line(colEarningsX, rowY + rowH, colEarningsX + colW, rowY + rowH);
    doc.line(colDeductionsX, rowY + rowH, colDeductionsX + colW, rowY + rowH);

    curY += rowH;
  }

  // Draw side borders around tables
  doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
  doc.setLineWidth(0.35);
  doc.rect(colEarningsX, tableStartY, colW, curY - tableStartY, "D");
  doc.rect(colDeductionsX, tableStartY, colW, curY - tableStartY, "D");

  // =========================================================================
  // SUB-TOTALS BAR (Gross Earnings & Total Deductions)
  // =========================================================================
  const subH = 8;
  doc.setFillColor(241, 245, 249); // #F1F5F9
  doc.setDrawColor(203, 213, 225);
  doc.rect(colEarningsX, curY, colW, subH, "FD");
  doc.rect(colDeductionsX, curY, colW, subH, "FD");

  // Left Subtotal
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(navyDark[0], navyDark[1], navyDark[2]);
  doc.text("TOTAL GROSS EARNINGS:", colEarningsX + 4, curY + 5.2);
  renderRightAlignedCurrency(doc, data.gross_amount, colEarningsX + colW - 4, curY + 5.2, 8.8, navyDark, true);

  // Right Subtotal
  doc.text("TOTAL DEDUCTIONS:", colDeductionsX + 4, curY + 5.2);
  renderRightAlignedCurrency(doc, data.total_deductions, colDeductionsX + colW - 4, curY + 5.2, 8.8, [185, 28, 28], true);

  curY += subH + 6;

  // =========================================================================
  // SECTION 5: NET SALARY PAYABLE HERO BANNER
  // =========================================================================
  const heroH = 18;
  doc.setFillColor(15, 23, 42); // slate-900
  doc.roundedRect(margin, curY, contentWidth, heroH, 2, 2, "F");

  // Left Side: Title & In-Words
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  doc.text("NET SALARY PAYABLE (TAKE HOME):", margin + 6, curY + 6.8);

  const wordsStr = amountInWords(data.net_salary);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text(`In Words: ${wordsStr}`, margin + 6, curY + 12.8);

  // Right Side: Net Amount with crisp Rupee Symbol (Emerald Green)
  renderRightAlignedCurrency(doc, data.net_salary, margin + contentWidth - 6, curY + 11.2, 14, [52, 211, 153], true);

  curY += heroH + 8;

  // =========================================================================
  // SECTION 6: FOOTER, AUDIT TIMESTAMP & SIGNATURES
  // =========================================================================
  // Disclaimer / Security Note
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.2);
  doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
  doc.text(
    "Note: This is an authoritative, system-generated salary statement approved by HR/Management under Inhyma ERP.",
    margin,
    curY
  );

  const nowFormatted = new Date().toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  doc.text(`Generated on: ${nowFormatted} | Reference: ${data.employee_code}-${data.payroll_month}`, margin + contentWidth, curY, {
    align: "right",
  });

  curY += 16;

  // Signatures Lines
  const sigLineW = 48;
  const sig1X = margin + 10;
  const sig2X = margin + contentWidth - sigLineW - 10;

  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.35);
  doc.line(sig1X, curY, sig1X + sigLineW, curY);
  doc.line(sig2X, curY, sig2X + sigLineW, curY);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(slateDark[0], slateDark[1], slateDark[2]);
  doc.text("Employee Signature", sig1X + sigLineW / 2, curY + 4, { align: "center" });
  doc.text("Authorized Signatory (HR / Accounts)", sig2X + sigLineW / 2, curY + 4, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
  doc.text("(Acknowledged by Employee)", sig1X + sigLineW / 2, curY + 7.5, { align: "center" });
  doc.text(`For ${companyName}`, sig2X + sigLineW / 2, curY + 7.5, { align: "center" });

  // Bottom Accent Line at end of page
  doc.setFillColor(brandAccent[0], brandAccent[1], brandAccent[2]);
  doc.rect(margin, 287, contentWidth, 1.2, "F");

  return doc;
}
