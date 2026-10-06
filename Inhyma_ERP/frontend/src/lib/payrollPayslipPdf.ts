import jsPDF from "jspdf";
import { getCachedBrandName } from "@/lib/brand";

export interface PayslipPdfData {
  company_name?: string;
  company_address?: string;
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
  earnings_breakdown: Array<{
    name: string;
    monthly_amount: number;
  }>;
  deductions_breakdown: Array<{
    name: string;
    monthly_amount: number;
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
  status: string;
}

export function formatInr(val: number): string {
  return "₹ " + Number(val || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function generatePayslipPdf(data: PayslipPdfData): jsPDF {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = 210;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2; // 182mm
  const companyName = data.company_name || getCachedBrandName() || "INHYMA ENTERPRISES PVT. LTD.";

  // Top Accent Bar
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(margin, 12, contentWidth, 22, "F");

  // Company Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text(companyName.toUpperCase(), margin + 6, 21);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225); // slate-300
  doc.text("SALARY STATEMENT / PAYSLIP", margin + 6, 28);

  // Month & Status Pill on right
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text(data.payroll_month || "-", margin + contentWidth - 6, 21, { align: "right" });

  doc.setFontSize(8);
  doc.setTextColor(147, 197, 253);
  doc.text(`STATUS: ${(data.status || "APPROVED").toUpperCase()}`, margin + contentWidth - 6, 28, { align: "right" });

  let curY = 40;

  // Employee Information Box
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setFillColor(248, 250, 252); // slate-50
  doc.roundedRect(margin, curY, contentWidth, 26, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);

  // Column 1
  doc.text("Employee Name:", margin + 4, curY + 6);
  doc.setFont("helvetica", "normal");
  doc.text(data.employee_name, margin + 34, curY + 6);

  doc.setFont("helvetica", "bold");
  doc.text("Employee ID:", margin + 4, curY + 13);
  doc.setFont("helvetica", "normal");
  doc.text(data.employee_code, margin + 34, curY + 13);

  doc.setFont("helvetica", "bold");
  doc.text("Department:", margin + 4, curY + 20);
  doc.setFont("helvetica", "normal");
  doc.text(data.department || "General", margin + 34, curY + 20);

  // Column 2
  const col2X = margin + 95;
  doc.setFont("helvetica", "bold");
  doc.text("Designation:", col2X, curY + 6);
  doc.setFont("helvetica", "normal");
  doc.text(data.designation || "Staff", col2X + 26, curY + 6);

  doc.setFont("helvetica", "bold");
  doc.text("Annual CTC:", col2X, curY + 13);
  doc.setFont("helvetica", "normal");
  doc.text(formatInr(data.annual_ctc), col2X + 26, curY + 13);

  doc.setFont("helvetica", "bold");
  doc.text("Monthly CTC:", col2X, curY + 20);
  doc.setFont("helvetica", "normal");
  doc.text(formatInr(data.monthly_ctc), col2X + 26, curY + 20);

  curY += 31;

  // Attendance Metrics Summary Bar
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, curY, contentWidth, 14, "F");
  doc.setDrawColor(203, 213, 225);
  doc.rect(margin, curY, contentWidth, 14, "D");

  const statWidth = contentWidth / 5;
  const stats = [
    { label: "Working Days", val: String(data.working_days) },
    { label: "Present Days", val: String(data.present_days) },
    { label: "Paid Leaves", val: String(data.paid_leave_days) },
    { label: "Holidays / Weekends", val: `${data.holiday_days} / ${data.weekend_days}` },
    { label: "LOP Days", val: String(data.lop_days) },
  ];

  stats.forEach((st, idx) => {
    const x = margin + idx * statWidth + statWidth / 2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(st.label, x, curY + 5, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(st.val, x, curY + 11, { align: "center" });
  });

  curY += 19;

  // Two Column Table: Earnings (Left) & Deductions (Right)
  const halfW = (contentWidth - 4) / 2;
  const colLeftX = margin;
  const colRightX = margin + halfW + 4;

  // Earnings Header
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.rect(colLeftX, curY, halfW, 7, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text("EARNINGS", colLeftX + 3, curY + 5);
  doc.text("AMOUNT", colLeftX + halfW - 3, curY + 5, { align: "right" });

  // Deductions Header
  doc.rect(colRightX, curY, halfW, 7, "FD");
  doc.text("DEDUCTIONS", colRightX + 3, curY + 5);
  doc.text("AMOUNT", colRightX + halfW - 3, curY + 5, { align: "right" });

  curY += 9;

  // Compile earnings rows (including any adjustments)
  const earningsRows: Array<{ label: string; amt: number }> = [];
  (data.earnings_breakdown || []).forEach((e) => {
    earningsRows.push({ label: e.name, amt: e.monthly_amount });
  });
  (data.additions_breakdown || []).forEach((a) => {
    earningsRows.push({ label: `[Add] ${a.title}`, amt: a.amount });
  });

  // Compile deductions rows (including LOP)
  const deductionRows: Array<{ label: string; amt: number }> = [];
  (data.deductions_breakdown || []).forEach((d) => {
    deductionRows.push({ label: d.name, amt: d.monthly_amount });
  });
  if (data.lop_deduction > 0) {
    deductionRows.push({ label: `Loss of Pay (${data.lop_days} days)`, amt: data.lop_deduction });
  }

  const maxRows = Math.max(earningsRows.length, deductionRows.length);
  const rowHeight = 6.5;

  for (let i = 0; i < maxRows; i++) {
    const e = earningsRows[i];
    const d = deductionRows[i];

    // Left (Earning)
    if (e) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(51, 65, 85);
      doc.text(e.label, colLeftX + 3, curY + 4);
      doc.text(formatInr(e.amt), colLeftX + halfW - 3, curY + 4, { align: "right" });
    }

    // Right (Deduction)
    if (d) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(51, 65, 85);
      doc.text(d.label, colRightX + 3, curY + 4);
      doc.text(formatInr(d.amt), colRightX + halfW - 3, curY + 4, { align: "right" });
    }

    doc.setDrawColor(241, 245, 249);
    doc.line(colLeftX, curY + 6, colLeftX + halfW, curY + 6);
    doc.line(colRightX, curY + 6, colRightX + halfW, curY + 6);

    curY += rowHeight;
  }

  curY += 2;

  // Subtotals
  doc.setFillColor(241, 245, 249);
  doc.rect(colLeftX, curY, halfW, 7, "F");
  doc.rect(colRightX, curY, halfW, 7, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text("Gross Earnings:", colLeftX + 3, curY + 5);
  doc.text(formatInr(data.gross_amount), colLeftX + halfW - 3, curY + 5, { align: "right" });

  doc.text("Total Deductions:", colRightX + 3, curY + 5);
  doc.text(formatInr(data.total_deductions), colRightX + halfW - 3, curY + 5, { align: "right" });

  curY += 12;

  // Net Salary Banner
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(margin, curY, contentWidth, 14, 2, 2, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text("NET SALARY PAYABLE:", margin + 6, curY + 9);

  doc.setFontSize(13);
  doc.setTextColor(52, 211, 153); // emerald-400
  doc.text(formatInr(data.net_salary), margin + contentWidth - 6, curY + 9.5, { align: "right" });

  curY += 22;

  // Note & Signatures
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text(
    "Note: This is a computer-generated salary slip and does not require a physical signature.",
    margin,
    curY
  );

  const nowStr = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  doc.text(`Generated on: ${nowStr}`, margin + contentWidth, curY, { align: "right" });

  curY += 15;
  doc.setDrawColor(203, 213, 225);
  doc.line(margin + 10, curY, margin + 50, curY);
  doc.line(margin + contentWidth - 50, curY, margin + contentWidth - 10, curY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("Employee Signature", margin + 30, curY + 4, { align: "center" });
  doc.text("Authorized Signatory", margin + contentWidth - 30, curY + 4, { align: "center" });

  return doc;
}
