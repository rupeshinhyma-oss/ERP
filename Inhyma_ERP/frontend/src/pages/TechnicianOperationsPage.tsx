/**
 * Technician Spare Parts Gatepass, Wallet Management & Warranty Tracking.
 *
 * Implements Section 1.6:
 *  1. Technician Spare Parts Gatepass & Return Workflow:
 *     - Track spare parts taken out by technicians for service calls.
 *     - Partial return reconciliation: verify whether a Sales Order was created for consumed parts.
 *     - Outward gatepass issuance, return gatepass generation, and draft SO creation.
 *  2. Technician Payment & Wallet Management:
 *     - Record payments collected by technicians on field tasks (Cash, UPI, Cheque, Bank Transfer).
 *     - Track technician-wise cash/wallet balance ledger (Net Cash = Collections - Deposits - Expenses).
 *  3. Warranty Tracking System:
 *     - Warranty lifecycle tracking (under-warranty vs out-of-warranty validation based on serial number and invoice date).
 *     - Live machine serial validator widget.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Pagination } from "@/components/Pagination";
import { SideDrawer } from "@/components/SideDrawer";
import { Banner, Modal } from "@/components/ui";
import { API_ORIGIN, apiGet, apiPost, apiPostMultipart } from "@/lib/api";
import { useAuth } from "@/lib/hooks";

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export interface MachineWarranty {
  id: string;
  serial_number: string;
  machine_model: string;
  product_id?: string | null;
  company_name: string;
  company_id?: string | null;
  invoice_number?: string | null;
  invoice_date: string;
  warranty_months: number;
  warranty_end_date: string;
  status: string;
  contact_person?: string | null;
  contact_phone?: string | null;
  installation_city?: string | null;
  notes?: string | null;
  created_at: string;
  is_currently_covered: boolean;
  days_remaining: number;
}

export interface WarrantyValidationResult {
  serial_number: string;
  is_registered: boolean;
  is_covered: boolean;
  status: string;
  company_name?: string | null;
  machine_model?: string | null;
  invoice_date?: string | null;
  warranty_end_date?: string | null;
  message: string;
}

export interface GatepassItem {
  id: string;
  gatepass_id: string;
  product_id?: string | null;
  product_code?: string | null;
  product_name: string;
  uom: string;
  quantity_issued: number;
  quantity_consumed: number;
  quantity_returned: number;
  stock_returned_qty?: number;
  stock_billed_released_qty?: number;
  unit_rate?: number | null;
  is_warranty_covered: boolean;
  sales_order_number?: string | null;
  item_status: string;
  remarks?: string | null;
}

export interface Gatepass {
  id: string;
  gatepass_number: string;
  technician_id?: string | null;
  technician_name: string;
  technician_mobile?: string | null;
  technical_task_id?: string | null;
  company_id?: string | null;
  warehouse_name?: string | null;
  customer_name?: string | null;
  machine_model?: string | null;
  machine_serial_number?: string | null;
  is_warranty_service: boolean;
  issue_date: string;
  issued_by_name: string;
  purpose: string;
  status: string;
  so_required: boolean;
  sale_order_id?: string | null;
  so_number?: string | null;
  so_created: boolean;
  stock_deducted?: boolean;
  return_gatepass_number?: string | null;
  notes?: string | null;
  created_at: string;
  items: GatepassItem[];
  total_issued: number;
  total_consumed: number;
  total_returned: number;
  pending_return: number;
  reconciliation_message: string;
}

export interface WalletTransaction {
  id: string;
  transaction_number: string;
  technician_id?: string | null;
  technician_name: string;
  technical_task_id?: string | null;
  customer_name?: string | null;
  transaction_type: "COLLECTION" | "HANDOVER_DEPOSIT" | "FIELD_EXPENSE";
  amount: number;
  payment_mode: string;
  reference_no?: string | null;
  transaction_date: string;
  receipt_url?: string | null;
  status: string;
  notes?: string | null;
  created_at: string;
}

export interface TechnicianWalletSummary {
  technician_id?: string | null;
  technician_name: string;
  technician_mobile?: string | null;
  total_collected: number;
  total_deposited: number;
  total_expenses: number;
  net_wallet_balance: number;
  status: "CLEAR" | "PENDING_DEPOSIT" | "REIMBURSEMENT_DUE";
  last_transaction_date?: string | null;
}

export interface TechnicianOperationsMetrics {
  active_gatepasses: number;
  pending_reconciliations: number;
  pending_sales_orders: number;
  total_wallet_cash_held: number;
  total_warranties_active: number;
}

export interface DraftSOGenerationResponse {
  gatepass_id?: string | null;
  customer_name: string;
  company_id?: string | null;
  warehouse_name?: string | null;
  city?: string | null;
  state?: string | null;
  billing_address?: string | null;
  shipping_address?: string | null;
  machine_model?: string | null;
  machine_serial_number?: string | null;
  gatepass_number: string;
  so_created?: boolean;
  so_number?: string | null;
  items_to_bill: Array<{
    gatepass_item_id: string;
    product_id?: string | null;
    product_code?: string | null;
    product_name: string;
    hsn_code?: string | null;
    gst_percent?: number;
    uom: string;
    quantity: number;
    unit_rate: number;
    line_total: number;
    remarks?: string | null;
  }>;
  estimated_subtotal: number;
  message: string;
}

export interface TechnicianOpsLookups {
  technicians: Array<{ id: string; name: string; mobile?: string | null; city?: string | null }>;
  companies: Array<{
    id: string;
    company_name: string;
    city?: string | null;
    state?: string | null;
    address?: string | null;
    contact_person?: string | null;
    contact_phone?: string | null;
    gst_no?: string | null;
  }>;
  warehouses: Array<{ id: string; name: string; address?: string | null; billing_company?: string | null; is_primary?: boolean }>;
  machines: Array<{
    id: string;
    product_code?: string | null;
    product_name: string;
    product_type: string;
    uom: string;
    unit_rate: number;
  }>;
  spare_parts: Array<{
    id: string;
    product_code?: string | null;
    product_name: string;
    product_type: string;
    is_spare_part: boolean;
    uom: string;
    unit_rate: number;
    hsn_code?: string | null;
    gst_percent?: number;
    compatible_machine_ids: string[];
    stock_by_warehouse: Record<string, number>;
  }>;
  cities: Array<{ id: string; name: string; state?: string | null }>;
  technical_tasks: Array<{
    id: string;
    task_number?: string | null;
    company_name: string;
    machine_model?: string | null;
    serial_number?: string | null;
    task_allotted_to?: string | null;
    service_type?: string | null;
    task_type?: string | null;
    status?: string | null;
    city?: string | null;
    contact_person?: string | null;
    contact_phone?: string | null;
    task_description?: string | null;
  }>;
  sale_orders: Array<{
    id: string;
    order_no: string;
    company_name?: string | null;
    order_date?: string | null;
    warehouse?: string | null;
    total_amount?: number;
    status?: string | null;
    invoice_no?: string | null;
  }>;
  serial_registry: Array<{
    serial_number: string;
    machine_model?: string | null;
    company_name?: string | null;
    invoice_number?: string | null;
    invoice_date?: string | null;
    warranty_end_date?: string | null;
    is_covered: boolean;
    source?: string;
  }>;
}

const EMPTY_LOOKUPS: TechnicianOpsLookups = {
  technicians: [],
  companies: [],
  warehouses: [],
  machines: [],
  spare_parts: [],
  cities: [],
  technical_tasks: [],
  sale_orders: [],
  serial_registry: [],
};

// ---------------------------------------------------------------------------
// Enterprise Vector Icon Set (Lucide 24x24 Stroke Standard)
// ---------------------------------------------------------------------------

interface TechOpsIconProps {
  size?: number;
  strokeWidth?: number;
}

function TechOpsSvg({
  size = 16,
  strokeWidth = 2,
  children,
}: TechOpsIconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, display: "block" }}
    >
      {children}
    </svg>
  );
}

function TechOpsIconTruck({ size = 22, strokeWidth = 1.9 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="7" cy="18" r="2" />
    </TechOpsSvg>
  );
}

function TechOpsIconAlertTriangle({ size = 22, strokeWidth = 1.9 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </TechOpsSvg>
  );
}

function TechOpsIconBanknote({ size = 22, strokeWidth = 1.9 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <rect width="20" height="12" x="2" y="6" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </TechOpsSvg>
  );
}

function TechOpsIconWallet({ size = 16, strokeWidth = 1.9 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </TechOpsSvg>
  );
}

function TechOpsIconShieldCheck({ size = 22, strokeWidth = 1.9 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </TechOpsSvg>
  );
}

function TechOpsIconPackage({ size = 16, strokeWidth = 1.9 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </TechOpsSvg>
  );
}

function TechOpsIconPlus({ size = 15, strokeWidth = 2.2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </TechOpsSvg>
  );
}

function TechOpsIconLock({ size = 14, strokeWidth = 2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </TechOpsSvg>
  );
}

function TechOpsIconWarehouse({ size = 12, strokeWidth = 2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z" />
      <path d="M6 18h12" />
      <path d="M6 14h12" />
      <rect width="12" height="12" x="6" y="10" />
    </TechOpsSvg>
  );
}

function TechOpsIconPhone({ size = 12, strokeWidth = 2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </TechOpsSvg>
  );
}

function TechOpsIconRotateCcw({ size = 13, strokeWidth = 2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </TechOpsSvg>
  );
}

function TechOpsIconSettings({ size = 12, strokeWidth = 2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </TechOpsSvg>
  );
}

function TechOpsIconFileText({ size = 13, strokeWidth = 2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" x2="8" y1="13" y2="13" />
      <line x1="16" x2="8" y1="17" y2="17" />
    </TechOpsSvg>
  );
}

function TechOpsIconShoppingCart({ size = 13, strokeWidth = 2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </TechOpsSvg>
  );
}

function TechOpsIconLink({ size = 13, strokeWidth = 2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </TechOpsSvg>
  );
}

function TechOpsIconPrinter({ size = 14, strokeWidth = 2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect width="12" height="8" x="6" y="14" />
    </TechOpsSvg>
  );
}

function TechOpsIconArrowDownLeft({ size = 12, strokeWidth = 2.2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <path d="M17 7 7 17" />
      <path d="M17 17H7V7" />
    </TechOpsSvg>
  );
}

function TechOpsIconArrowUpRight({ size = 12, strokeWidth = 2.2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <path d="M7 17 17 7" />
      <path d="M7 7h10v10" />
    </TechOpsSvg>
  );
}

function TechOpsIconReceipt({ size = 12, strokeWidth = 2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M8 10h8" />
      <path d="M8 14h6" />
    </TechOpsSvg>
  );
}

function TechOpsIconWrench({ size = 11, strokeWidth = 2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </TechOpsSvg>
  );
}

function TechOpsIconPaperclip({ size = 12, strokeWidth = 2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </TechOpsSvg>
  );
}

function TechOpsIconSearch({ size = 17, strokeWidth = 2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </TechOpsSvg>
  );
}

function TechOpsIconCheckCircle({ size = 14, strokeWidth = 2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </TechOpsSvg>
  );
}

function TechOpsIconXCircle({ size = 14, strokeWidth = 2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </TechOpsSvg>
  );
}

function TechOpsIconInfo({ size = 14, strokeWidth = 2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </TechOpsSvg>
  );
}

function TechOpsIconCopy({ size = 14, strokeWidth = 2 }: TechOpsIconProps) {
  return (
    <TechOpsSvg size={size} strokeWidth={strokeWidth}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </TechOpsSvg>
  );
}

function resolveReceiptHref(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${API_ORIGIN}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function printGatepassSlip(gp: Gatepass): void {
  const win = window.open("", "_blank", "width=900,height=720");
  if (!win) return;
  const rowsHtml = (gp.items || [])
    .map(
      (it, idx) => `
      <tr>
        <td style="text-align:center">${idx + 1}</td>
        <td><b>${escapeHtml(it.product_name)}</b>${it.product_code ? `<div style="font-size:11px;color:#64748b">${escapeHtml(it.product_code)}</div>` : ""}</td>
        <td style="text-align:center">${escapeHtml(it.uom)}</td>
        <td style="text-align:center;font-weight:700">${it.quantity_issued}</td>
        <td style="text-align:center">${it.quantity_returned}</td>
        <td style="text-align:center">${it.quantity_consumed}</td>
        <td style="text-align:right">${it.unit_rate != null ? `₹ ${Number(it.unit_rate).toFixed(2)}` : "—"}</td>
        <td>${escapeHtml(it.item_status)}</td>
      </tr>`
    )
    .join("");

  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Gatepass ${escapeHtml(gp.gatepass_number)}</title>
  <style>
    body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; padding: 28px; font-size: 13px; }
    .hdr { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 18px; background: #f8fafc; padding: 12px 16px; border: 1px solid #cbd5e1; border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; font-size: 12px; }
    th { background: #f1f5f9; text-align: left; }
    .sigs { display: flex; justify-content: space-between; margin-top: 56px; padding-top: 12px; }
    .sig-box { width: 28%; border-top: 1px solid #334155; text-align: center; padding-top: 6px; font-weight: 600; font-size: 12px; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <div class="hdr">
    <div>
      <h2 style="margin:0 0 4px">TECHNICIAN SPARE PARTS GATEPASS</h2>
      <div style="color:#475569">Outward / Return Material Reconciliation Voucher</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:16px;font-weight:800">${escapeHtml(gp.gatepass_number)}</div>
      <div>Issue Date: <b>${escapeHtml(gp.issue_date)}</b></div>
      <div>Status: <b>${escapeHtml(gp.status)}</b></div>
    </div>
  </div>
  <div class="grid">
    <div><b>Technician:</b> ${escapeHtml(gp.technician_name)} ${gp.technician_mobile ? `(${escapeHtml(gp.technician_mobile)})` : ""}</div>
    <div><b>Dispatch Warehouse:</b> ${escapeHtml(gp.warehouse_name || "—")}</div>
    <div><b>Customer Company:</b> ${escapeHtml(gp.customer_name || "—")}</div>
    <div><b>Machine Model / Serial:</b> ${escapeHtml(gp.machine_model || "—")} / ${escapeHtml(gp.machine_serial_number || "—")}</div>
    <div><b>Warranty Service:</b> ${gp.is_warranty_service ? "YES (FOC Warranty)" : "NO (Chargeable)"}</div>
    <div><b>Linked Sales Order:</b> ${escapeHtml(gp.so_number || (gp.so_required ? "PENDING SO" : "N/A"))}</div>
    <div style="grid-column:1 / -1"><b>Purpose:</b> ${escapeHtml(gp.purpose)}</div>
    ${gp.return_gatepass_number ? `<div style="grid-column:1 / -1"><b>Return Gatepass #:</b> ${escapeHtml(gp.return_gatepass_number)}</div>` : ""}
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:40px;text-align:center">#</th>
        <th>Spare Part</th>
        <th style="width:60px;text-align:center">UOM</th>
        <th style="width:70px;text-align:center">Issued</th>
        <th style="width:75px;text-align:center">Returned</th>
        <th style="width:80px;text-align:center">Consumed</th>
        <th style="width:95px;text-align:right">Rate</th>
        <th style="width:120px">Item Status</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  ${gp.notes ? `<div style="margin-bottom:18px"><b>Remarks / Notes:</b><div style="white-space:pre-line;color:#334155">${escapeHtml(gp.notes)}</div></div>` : ""}
  <div class="sigs">
    <div class="sig-box">Technician Signature</div>
    <div class="sig-box">Store / Warehouse Keeper</div>
    <div class="sig-box">Authorized Signatory</div>
  </div>
  <script>window.onload = function(){ window.print(); };</script>
</body>
</html>`);
  win.document.close();
}

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null || isNaN(amount)) return "—";
  return "₹ " + Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const GatepassTableSkeletonRows: React.FC<{ count?: number }> = ({ count = 6 }) => (
  <>
    {Array.from({ length: count }).map((_, index) => (
      <tr key={`gp-skeleton-${index}`} className="table-skeleton-row" style={{ verticalAlign: "middle" }}>
        <td style={{ padding: "12px 14px" }}>
          <div className="skeleton-line" style={{ width: "80%", marginBottom: 4 }} />
          <div className="skeleton-line" style={{ width: "50%" }} />
        </td>
        <td style={{ padding: "12px 14px" }}><div className="skeleton-line" style={{ width: "70%" }} /></td>
        <td style={{ padding: "12px 14px" }}><div className="skeleton-line" style={{ width: "60%" }} /></td>
        <td style={{ padding: "12px 14px", textAlign: "center" }}><div className="skeleton-badge" style={{ width: 45, margin: "0 auto" }} /></td>
        <td style={{ padding: "12px 14px", textAlign: "center" }}><div className="skeleton-line" style={{ width: 50, margin: "0 auto" }} /></td>
        <td style={{ padding: "12px 14px" }}><div className="skeleton-badge" style={{ width: 80 }} /></td>
        <td style={{ padding: "12px 14px", textAlign: "right" }}>
          <div className="skeleton-box" style={{ width: 28, height: 28, borderRadius: 4, marginLeft: "auto" }} />
        </td>
      </tr>
    ))}
  </>
);

const WalletTableSkeletonRows: React.FC<{ count?: number }> = ({ count = 6 }) => (
  <>
    {Array.from({ length: count }).map((_, index) => (
      <tr key={`wallet-skeleton-${index}`} className="table-skeleton-row">
        <td style={{ padding: "10px 14px" }}><div className="skeleton-line" style={{ width: "70%" }} /></td>
        <td style={{ padding: "10px 14px" }}><div className="skeleton-line" style={{ width: "60%" }} /></td>
        <td style={{ padding: "10px 14px" }}><div className="skeleton-line" style={{ width: "65%" }} /></td>
        <td style={{ padding: "10px 14px" }}><div className="skeleton-badge" style={{ width: 50 }} /></td>
        <td style={{ padding: "10px 14px" }}><div className="skeleton-line" style={{ width: "45%" }} /></td>
        <td style={{ padding: "10px 14px" }}><div className="skeleton-line" style={{ width: "80%" }} /></td>
        <td style={{ padding: "10px 14px" }}><div className="skeleton-line" style={{ width: "50%", marginLeft: "auto" }} /></td>
        <td style={{ padding: "10px 14px", textAlign: "center" }}><div className="skeleton-badge" style={{ width: 60, margin: "0 auto" }} /></td>
      </tr>
    ))}
  </>
);

const WarrantyTableSkeletonRows: React.FC<{ count?: number }> = ({ count = 6 }) => (
  <>
    {Array.from({ length: count }).map((_, index) => (
      <tr key={`warr-skeleton-${index}`} className="table-skeleton-row">
        <td style={{ padding: "10px 14px" }}><div className="skeleton-line" style={{ width: "75%" }} /></td>
        <td style={{ padding: "10px 14px" }}><div className="skeleton-line" style={{ width: "70%" }} /></td>
        <td style={{ padding: "10px 14px" }}><div className="skeleton-line" style={{ width: "80%" }} /></td>
        <td style={{ padding: "10px 14px" }}><div className="skeleton-line" style={{ width: "60%" }} /></td>
        <td style={{ padding: "10px 14px" }}><div className="skeleton-line" style={{ width: "45%" }} /></td>
        <td style={{ padding: "10px 14px" }}><div className="skeleton-line" style={{ width: "60%" }} /></td>
        <td style={{ padding: "10px 14px", textAlign: "center" }}><div className="skeleton-badge" style={{ width: 65, margin: "0 auto" }} /></td>
      </tr>
    ))}
  </>
);

export function TechnicianOperationsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") || "gatepasses";
  const { isSuperAdmin, hasPermission } = useAuth();

  const canMutate = useMemo(
    () =>
      Boolean(
        isSuperAdmin ||
          hasPermission("technicaltask.create") ||
          hasPermission("technicaltask.update") ||
          hasPermission("technicaltask.manage") ||
          hasPermission("technician.create") ||
          hasPermission("technician.update")
      ),
    [isSuperAdmin, hasPermission]
  );

  const canLinkSO = useMemo(
    () => Boolean(canMutate || hasPermission("saleorder.create") || hasPermission("saleorder.update")),
    [canMutate, hasPermission]
  );
  const canCreateSO = canLinkSO;

  // --- Global State, Lookups & Metrics ---
  const [lookups, setLookups] = useState<TechnicianOpsLookups>(EMPTY_LOOKUPS);
  const [metrics, setMetrics] = useState<TechnicianOperationsMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // --- Tab 1: Gatepasses State ---
  const [gatepasses, setGatepasses] = useState<Gatepass[]>([]);
  const [gpStatusFilter, setGpStatusFilter] = useState<string>("");
  const [gpSearch, setGpSearch] = useState<string>("");
  const [gpPage, setGpPage] = useState<number>(1);
  const [gpTotal, setGpTotal] = useState<number>(0);
  const [gpTotalPages, setGpTotalPages] = useState<number>(1);

  // Modals for Gatepass
  const [openCreateGpModal, setOpenCreateGpModal] = useState<boolean>(false);
  const [openReturnModal, setOpenReturnModal] = useState<boolean>(false);
  const [selectedGpForReturn, setSelectedGpForReturn] = useState<Gatepass | null>(null);
  const [returnItemsState, setReturnItemsState] = useState<Array<{
    item_id: string;
    product_name: string;
    quantity_issued: number;
    quantity_returned: number;
    quantity_consumed: number;
    is_warranty_covered: boolean;
    item_status: string;
    remarks: string;
  }>>([]);
  const [returnGatepassNo, setReturnGatepassNo] = useState<string>("");
  const [returnNotes, setReturnNotes] = useState<string>("");

  // Link SO Modal
  const [openLinkSOModal, setOpenLinkSOModal] = useState<boolean>(false);
  const [selectedGpForSO, setSelectedGpForSO] = useState<Gatepass | null>(null);
  const [soNumberInput, setSoNumberInput] = useState<string>("");
  const [soNotesInput, setSoNotesInput] = useState<string>("");

  // Draft SO Drawer
  const [openDraftSODrawer, setOpenDraftSODrawer] = useState<boolean>(false);
  const [draftSOData, setDraftSOData] = useState<DraftSOGenerationResponse | null>(null);
  const [activeGpForDraft, setActiveGpForDraft] = useState<Gatepass | null>(null);

  // View Details Drawer
  const [openDetailDrawer, setOpenDetailDrawer] = useState<boolean>(false);
  const [activeGpDetail, setActiveGpDetail] = useState<Gatepass | null>(null);

  // Create Gatepass Form State
  const [newGpWarehouse, setNewGpWarehouse] = useState<string>("");
  const [newGpTaskId, setNewGpTaskId] = useState<string>("");
  const [newGpTechId, setNewGpTechId] = useState<string>("");
  const [newGpTechName, setNewGpTechName] = useState<string>("");
  const [newGpTechMobile, setNewGpTechMobile] = useState<string>("");
  const [newGpCompanyId, setNewGpCompanyId] = useState<string>("");
  const [newGpCustomer, setNewGpCustomer] = useState<string>("");
  const [newGpMachineId, setNewGpMachineId] = useState<string>("");
  const [newGpMachineModel, setNewGpMachineModel] = useState<string>("");
  const [newGpSerial, setNewGpSerial] = useState<string>("");
  const [newGpPurpose, setNewGpPurpose] = useState<string>("Field Breakdown Service Call");
  const [newGpNotes, setNewGpNotes] = useState<string>("");
  const [newGpItems, setNewGpItems] = useState<Array<{
    product_id?: string | null;
    product_name: string;
    product_code: string;
    uom: string;
    quantity_issued: number;
    unit_rate: number;
    remarks: string;
  }>>([
    { product_id: null, product_name: "", product_code: "", uom: "NOS", quantity_issued: 1, unit_rate: 0, remarks: "" }
  ]);
  const [newGpWarrantyCheckMsg, setNewGpWarrantyCheckMsg] = useState<string | null>(null);

  // --- Tab 2: Wallets & Collections State ---
  const [walletSummaries, setWalletSummaries] = useState<TechnicianWalletSummary[]>([]);
  const [walletTransactions, setWalletTransactions] = useState<WalletTransaction[]>([]);
  const [walletFilterTech, setWalletFilterTech] = useState<string>("");
  const [walletFilterType, setWalletFilterType] = useState<string>("");
  const [walletPage, setWalletPage] = useState<number>(1);
  const [walletTotal, setWalletTotal] = useState<number>(0);
  const [walletTotalPages, setWalletTotalPages] = useState<number>(1);

  // Record Transaction Modal
  const [openWalletTxnModal, setOpenWalletTxnModal] = useState<boolean>(false);
  const [txnTechId, setTxnTechId] = useState<string>("");
  const [txnTechName, setTxnTechName] = useState<string>("");
  const [txnType, setTxnType] = useState<"COLLECTION" | "HANDOVER_DEPOSIT" | "FIELD_EXPENSE">("COLLECTION");
  const [txnAmount, setTxnAmount] = useState<string>("");
  const [txnPaymentMode, setTxnPaymentMode] = useState<string>("Cash");
  const [txnCustomer, setTxnCustomer] = useState<string>("");
  const [txnRefNo, setTxnRefNo] = useState<string>("");
  const [txnReceiptUrl, setTxnReceiptUrl] = useState<string>("");
  const [txnReceiptFileName, setTxnReceiptFileName] = useState<string>("");
  const [txnUploadingReceipt, setTxnUploadingReceipt] = useState<boolean>(false);
  const [txnNotes, setTxnNotes] = useState<string>("");

  // --- Tab 3: Machine Warranty State ---
  const [warranties, setWarranties] = useState<MachineWarranty[]>([]);
  const [warrSearch, setWarrSearch] = useState<string>("");
  const [warrStatusFilter, setWarrStatusFilter] = useState<string>("");
  const [warrPage, setWarrPage] = useState<number>(1);
  const [warrTotal, setWarrTotal] = useState<number>(0);
  const [warrTotalPages, setWarrTotalPages] = useState<number>(1);

  // Serial Validator Widget State
  const [validatorSerialInput, setValidatorSerialInput] = useState<string>("");
  const [validationResult, setValidationResult] = useState<WarrantyValidationResult | null>(null);
  const [validating, setValidating] = useState<boolean>(false);

  // Register Warranty Modal
  const [openRegisterWarrModal, setOpenRegisterWarrModal] = useState<boolean>(false);
  const [regSerial, setRegSerial] = useState<string>("");
  const [regProductId, setRegProductId] = useState<string>("");
  const [regModel, setRegModel] = useState<string>("");
  const [regCompanyId, setRegCompanyId] = useState<string>("");
  const [regCompany, setRegCompany] = useState<string>("");
  const [regInvoiceNo, setRegInvoiceNo] = useState<string>("");
  const [regInvoiceDate, setRegInvoiceDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [regMonths, setRegMonths] = useState<number>(12);
  const [regContactPerson, setRegContactPerson] = useState<string>("");
  const [regContactPhone, setRegContactPhone] = useState<string>("");
  const [regCity, setRegCity] = useState<string>("");
  const [regNotes, setRegNotes] = useState<string>("");

  // -------------------------------------------------------------------------
  // Derived Lookup Helpers & Validations
  // -------------------------------------------------------------------------

  const resolvedMachineId = useMemo(() => {
    if (newGpMachineId) return newGpMachineId;
    if (!newGpMachineModel.trim()) return "";
    const match = lookups.machines.find(
      (mc) => mc.product_name.toLowerCase() === newGpMachineModel.trim().toLowerCase()
    );
    return match?.id || "";
  }, [newGpMachineId, newGpMachineModel, lookups.machines]);

  const { compatibleParts, otherParts } = useMemo(() => {
    if (!resolvedMachineId) {
      return { compatibleParts: [] as TechnicianOpsLookups["spare_parts"], otherParts: lookups.spare_parts };
    }
    const comp: TechnicianOpsLookups["spare_parts"] = [];
    const rest: TechnicianOpsLookups["spare_parts"] = [];
    for (const sp of lookups.spare_parts) {
      if ((sp.compatible_machine_ids || []).includes(resolvedMachineId)) {
        comp.push(sp);
      } else {
        rest.push(sp);
      }
    }
    return { compatibleParts: comp, otherParts: rest };
  }, [resolvedMachineId, lookups.spare_parts]);

  const getAvailableStock = useCallback(
    (productId?: string | null, warehouseName?: string): number | null => {
      if (!productId || !warehouseName) return null;
      const sp = lookups.spare_parts.find((p) => p.id === productId);
      if (!sp) return null;
      return Number(sp.stock_by_warehouse?.[warehouseName] ?? 0);
    },
    [lookups.spare_parts]
  );

  const returnValidationError = useMemo(() => {
    for (const row of returnItemsState) {
      const ret = Number(row.quantity_returned);
      const cons = Number(row.quantity_consumed);
      if (ret < 0 || cons < 0) {
        return `Negative quantities are not allowed for "${row.product_name}".`;
      }
      if (ret + cons > Number(row.quantity_issued) + 1e-6) {
        return `Returned (${ret}) + Consumed (${cons}) cannot exceed Issued (${row.quantity_issued}) for "${row.product_name}".`;
      }
    }
    return null;
  }, [returnItemsState]);

  const candidateSaleOrdersForLink = useMemo(() => {
    const targetCustomer = (selectedGpForSO?.customer_name || activeGpForDraft?.customer_name || "")
      .trim()
      .toLowerCase();
    if (!targetCustomer) return lookups.sale_orders;
    const exact = lookups.sale_orders.filter(
      (so) => (so.company_name || "").trim().toLowerCase() === targetCustomer
    );
    return exact.length > 0 ? exact : lookups.sale_orders;
  }, [lookups.sale_orders, selectedGpForSO, activeGpForDraft]);

  // -------------------------------------------------------------------------
  // Data Fetching
  // -------------------------------------------------------------------------

  const fetchLookups = useCallback(async () => {
    try {
      const res = await apiGet<TechnicianOpsLookups>("/technician-operations/lookups");
      if (res && res.data) {
        const data: TechnicianOpsLookups = {
          ...EMPTY_LOOKUPS,
          ...res.data,
        };
        setLookups(data);
        if (data.warehouses.length > 0) {
          const primaryWh = data.warehouses.find((w) => w.is_primary) || data.warehouses[0];
          setNewGpWarehouse((prev) => prev || primaryWh.name);
        }
      }
    } catch (err) {
      console.error("Failed to load technician operations lookups:", err);
    }
  }, []);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await apiGet<TechnicianOperationsMetrics>("/technician-operations/metrics");
      if (res && res.data) {
        setMetrics(res.data);
      }
    } catch (err) {
      console.error("Failed to load operations metrics:", err);
    }
  }, []);

  const fetchGatepasses = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (gpStatusFilter) params.append("status", gpStatusFilter);
      if (gpSearch) params.append("search", gpSearch);
      params.append("page", String(gpPage));
      params.append("page_size", "25");

      const res = await apiGet<Gatepass[]>(`/technician-operations/gatepasses?${params.toString()}`);

      if (res && res.data) {
        setGatepasses(res.data);
        const p = res.meta?.pagination as Record<string, number | undefined> | undefined;
        if (p) {
          setGpTotal(p.total ?? p.total_records ?? p.total_items ?? res.data.length);
          setGpTotalPages(p.total_pages ?? 1);
        } else {
          setGpTotal(res.data.length);
        }
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load gatepasses");
    } finally {
      setLoading(false);
    }
  }, [gpStatusFilter, gpSearch, gpPage]);

  const fetchWalletData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch live technician summaries
      const sumRes = await apiGet<TechnicianWalletSummary[]>("/technician-operations/wallet/summaries");
      if (sumRes && sumRes.data) {
        setWalletSummaries(sumRes.data);
      }

      // 2. Fetch transactions ledger
      const params = new URLSearchParams();
      if (walletFilterTech) params.append("technician_name", walletFilterTech);
      if (walletFilterType) params.append("transaction_type", walletFilterType);
      params.append("page", String(walletPage));
      params.append("page_size", "25");

      const txnRes = await apiGet<WalletTransaction[]>(`/technician-operations/wallet/transactions?${params.toString()}`);

      if (txnRes && txnRes.data) {
        setWalletTransactions(txnRes.data);
        const p = txnRes.meta?.pagination as Record<string, number | undefined> | undefined;
        if (p) {
          setWalletTotal(p.total ?? p.total_records ?? p.total_items ?? txnRes.data.length);
          setWalletTotalPages(p.total_pages ?? 1);
        } else {
          setWalletTotal(txnRes.data.length);
        }
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load wallet data");
    } finally {
      setLoading(false);
    }
  }, [walletFilterTech, walletFilterType, walletPage]);

  const fetchWarranties = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (warrSearch) params.append("search", warrSearch);
      if (warrStatusFilter) params.append("status", warrStatusFilter);
      params.append("page", String(warrPage));
      params.append("page_size", "25");

      const res = await apiGet<MachineWarranty[]>(`/technician-operations/warranty?${params.toString()}`);

      if (res && res.data) {
        setWarranties(res.data);
        const p = res.meta?.pagination as Record<string, number | undefined> | undefined;
        if (p) {
          setWarrTotal(p.total ?? p.total_records ?? p.total_items ?? res.data.length);
          setWarrTotalPages(p.total_pages ?? 1);
        } else {
          setWarrTotal(res.data.length);
        }
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load warranty registry");
    } finally {
      setLoading(false);
    }
  }, [warrSearch, warrStatusFilter, warrPage]);

  // Initial and reactive loads
  useEffect(() => {
    fetchMetrics();
    fetchLookups();
  }, [fetchMetrics, fetchLookups]);

  useEffect(() => {
    if (currentTab === "gatepasses") {
      fetchGatepasses();
    } else if (currentTab === "wallets") {
      fetchWalletData();
    } else if (currentTab === "warranty") {
      fetchWarranties();
    }
  }, [currentTab, fetchGatepasses, fetchWalletData, fetchWarranties]);

  // Tab switch handler
  const handleTabChange = (tabKey: string) => {
    setSearchParams({ tab: tabKey });
    setError(null);
    setSuccess(null);
  };

  // -------------------------------------------------------------------------
  // Machine Serial Validator Action
  // -------------------------------------------------------------------------

  const handleValidateSerial = async (serialToTest?: string) => {
    const s = (serialToTest || validatorSerialInput).trim();
    if (!s) return;
    setValidating(true);
    try {
      const res = await apiGet<WarrantyValidationResult>(
        `/technician-operations/warranty/validate?serial=${encodeURIComponent(s)}`
      );
      if (res && res.data) {
        setValidationResult(res.data);
      }
    } catch (err: any) {
      setError(err?.message || "Serial validation failed");
    } finally {
      setValidating(false);
    }
  };

  // -------------------------------------------------------------------------
  // Gatepass Actions
  // -------------------------------------------------------------------------

  // Check warranty during Gatepass creation
  const handleCheckSerialForGp = async (serialOverride?: string) => {
    const serialVal = (serialOverride ?? newGpSerial).trim();
    if (!serialVal) return;
    try {
      const res = await apiGet<WarrantyValidationResult>(
        `/technician-operations/warranty/validate?serial=${encodeURIComponent(serialVal)}`
      );
      if (res && res.data) {
        if (res.data.company_name && !newGpCustomer.trim()) {
          setNewGpCustomer(res.data.company_name);
          const comp = lookups.companies.find(
            (c) => c.company_name.toLowerCase() === res.data.company_name!.toLowerCase()
          );
          if (comp) setNewGpCompanyId(comp.id);
        }
        if (res.data.machine_model && !newGpMachineModel.trim()) {
          setNewGpMachineModel(res.data.machine_model);
          const mc = lookups.machines.find(
            (m) => m.product_name.toLowerCase() === res.data.machine_model!.toLowerCase()
          );
          if (mc) setNewGpMachineId(mc.id);
        }
        if (res.data.is_covered) {
          setNewGpWarrantyCheckMsg(
            `Machine is UNDER WARRANTY (${res.data.machine_model || ""} - ${res.data.company_name || ""}). Spare parts replacement eligible for FOC warranty.`
          );
        } else if (res.data.is_registered) {
          setNewGpWarrantyCheckMsg(
            `Machine Warranty EXPIRED on ${res.data.warranty_end_date}. Spare parts consumed MUST be billed via Sales Order.`
          );
        } else {
          setNewGpWarrantyCheckMsg(`Machine Serial not registered. Replacement parts will be chargeable.`);
        }
      }
    } catch {
      setNewGpWarrantyCheckMsg("Unable to verify machine warranty.");
    }
  };

  const handleSelectTechnicalTaskForGp = (taskId: string) => {
    setNewGpTaskId(taskId);
    if (!taskId) return;
    const t = lookups.technical_tasks.find((tk) => tk.id === taskId);
    if (!t) return;

    if (t.task_allotted_to) {
      setNewGpTechName(t.task_allotted_to);
      const tech = lookups.technicians.find(
        (tc) => tc.name.toLowerCase() === t.task_allotted_to!.toLowerCase()
      );
      setNewGpTechId(tech?.id || "");
      if (tech?.mobile) setNewGpTechMobile(tech.mobile);
    }
    if (t.company_name) {
      setNewGpCustomer(t.company_name);
      const comp = lookups.companies.find(
        (c) => c.company_name.toLowerCase() === t.company_name.toLowerCase()
      );
      setNewGpCompanyId(comp?.id || "");
    }
    if (t.machine_model) {
      setNewGpMachineModel(t.machine_model);
      const mc = lookups.machines.find(
        (m) => m.product_name.toLowerCase() === t.machine_model!.toLowerCase()
      );
      setNewGpMachineId(mc?.id || "");
    }
    if (t.serial_number) {
      setNewGpSerial(t.serial_number);
      void handleCheckSerialForGp(t.serial_number);
    }
    if (t.task_description) {
      setNewGpPurpose(t.task_description);
    } else if (t.task_number) {
      setNewGpPurpose(`Field Service Task ${t.task_number}`);
    }
  };

  const handleCreateGatepass = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!newGpTechName.trim()) {
      setError("Technician name is required");
      return;
    }
    if (lookups.warehouses.length > 0 && !newGpWarehouse.trim()) {
      setError("Please select the dispatch warehouse");
      return;
    }
    const validItems = newGpItems.filter((i) => i.product_name.trim() && i.quantity_issued > 0);
    if (validItems.length === 0) {
      setError("Please add at least one spare part item with quantity > 0");
      return;
    }

    // Validate live warehouse stock for catalog-linked items
    if (newGpWarehouse.trim()) {
      const requestedByProduct = new Map<string, { name: string; qty: number }>();
      for (const item of validItems) {
        if (item.product_id) {
          const prev = requestedByProduct.get(item.product_id);
          requestedByProduct.set(item.product_id, {
            name: item.product_name,
            qty: (prev?.qty || 0) + Number(item.quantity_issued),
          });
        }
      }
      for (const [prodId, info] of requestedByProduct.entries()) {
        const avail = getAvailableStock(prodId, newGpWarehouse.trim());
        if (avail !== null && info.qty > avail + 1e-6) {
          setError(
            `Insufficient stock in "${newGpWarehouse.trim()}" for "${info.name}": available ${avail}, requested ${info.qty}.`
          );
          return;
        }
      }
    }

    const matchedTech =
      lookups.technicians.find((t) => t.id === newGpTechId) ||
      lookups.technicians.find((t) => t.name.toLowerCase() === newGpTechName.trim().toLowerCase());
    const matchedCompany =
      lookups.companies.find((c) => c.id === newGpCompanyId) ||
      lookups.companies.find((c) => c.company_name.toLowerCase() === newGpCustomer.trim().toLowerCase());

    try {
      setLoading(true);
      await apiPost("/technician-operations/gatepasses", {
        technician_id: matchedTech?.id || null,
        technician_name: newGpTechName.trim(),
        technician_mobile: newGpTechMobile.trim() || matchedTech?.mobile || null,
        technical_task_id: newGpTaskId || null,
        company_id: matchedCompany?.id || null,
        warehouse_name: newGpWarehouse.trim() || null,
        customer_name: newGpCustomer.trim() || null,
        machine_model: newGpMachineModel.trim() || null,
        machine_serial_number: newGpSerial.trim() || null,
        purpose: newGpPurpose.trim(),
        notes: newGpNotes.trim() || null,
        items: validItems.map((i) => ({
          product_id: i.product_id || null,
          product_name: i.product_name.trim(),
          product_code: i.product_code.trim() || null,
          uom: i.uom || "NOS",
          quantity_issued: Number(i.quantity_issued),
          unit_rate: Number(i.unit_rate) || null,
          remarks: i.remarks.trim() || null,
        })),
      });

      setSuccess("Outward Gatepass created and warehouse stock reserved successfully");
      setOpenCreateGpModal(false);
      // Reset form
      setNewGpTaskId("");
      setNewGpTechId("");
      setNewGpTechName("");
      setNewGpTechMobile("");
      setNewGpCompanyId("");
      setNewGpCustomer("");
      setNewGpMachineId("");
      setNewGpMachineModel("");
      setNewGpSerial("");
      setNewGpNotes("");
      setNewGpWarrantyCheckMsg(null);
      setNewGpItems([
        { product_id: null, product_name: "", product_code: "", uom: "NOS", quantity_issued: 1, unit_rate: 0, remarks: "" },
      ]);

      fetchGatepasses();
      fetchMetrics();
      fetchLookups();
    } catch (err: any) {
      setError(err?.message || "Failed to create gatepass");
    } finally {
      setLoading(false);
    }
  };

  // Open return modal and initialize return rows
  const handleOpenReturnModal = (gp: Gatepass) => {
    setSelectedGpForReturn(gp);
    const rows = gp.items.map((i) => {
      const rem = Math.max(0, i.quantity_issued - (i.quantity_returned + i.quantity_consumed));
      return {
        item_id: i.id,
        product_name: i.product_name,
        quantity_issued: i.quantity_issued,
        quantity_returned: i.quantity_returned > 0 ? i.quantity_returned : rem,
        quantity_consumed: i.quantity_consumed,
        is_warranty_covered: i.is_warranty_covered || gp.is_warranty_service,
        item_status: i.item_status && i.item_status !== "ISSUED" ? i.item_status : "RETURNED_GOOD",
        remarks: i.remarks || "",
      };
    });
    setReturnItemsState(rows);
    setReturnGatepassNo(
      gp.return_gatepass_number || `RGP-TECH-${new Date().getFullYear()}-${gp.gatepass_number.split("-").pop()}`
    );
    setReturnNotes("");
    setOpenReturnModal(true);
  };

  const handleProcessReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGpForReturn) return;
    if (returnValidationError) {
      setError(returnValidationError);
      return;
    }

    try {
      setLoading(true);
      await apiPost(`/technician-operations/gatepasses/${selectedGpForReturn.id}/return`, {
        return_gatepass_number: returnGatepassNo.trim() || null,
        notes: returnNotes.trim() || null,
        items: returnItemsState.map((i) => ({
          item_id: i.item_id,
          quantity_returned: Number(i.quantity_returned),
          quantity_consumed: Number(i.quantity_consumed),
          is_warranty_covered: Boolean(i.is_warranty_covered),
          item_status: i.item_status,
          remarks: i.remarks || null,
        })),
      });

      setSuccess("Spare parts return processed and gatepass reconciled successfully");
      setOpenReturnModal(false);
      setSelectedGpForReturn(null);
      fetchGatepasses();
      fetchMetrics();
      fetchLookups();
    } catch (err: any) {
      setError(err?.message || "Failed to process return");
    } finally {
      setLoading(false);
    }
  };

  // Open Link SO Modal
  const handleOpenLinkSOModal = (gp: Gatepass) => {
    setSelectedGpForSO(gp);
    setSoNumberInput(gp.so_number || "");
    setSoNotesInput("");
    setOpenLinkSOModal(true);
  };

  const handleLinkSO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGpForSO) return;
    if (!soNumberInput.trim()) {
      setError("Please enter or select the Sales Order number");
      return;
    }

    try {
      setLoading(true);
      await apiPost(`/technician-operations/gatepasses/${selectedGpForSO.id}/link-so`, {
        sales_order_number: soNumberInput.trim(),
        notes: soNotesInput.trim() || null,
      });

      setSuccess(`Sales Order '${soNumberInput.trim()}' linked and gatepass marked reconciled!`);
      setOpenLinkSOModal(false);
      setSelectedGpForSO(null);
      fetchGatepasses();
      fetchMetrics();
      fetchLookups();
    } catch (err: any) {
      setError(err?.message || "Failed to link Sales Order");
    } finally {
      setLoading(false);
    }
  };

  // View Draft SO Payload
  const handleViewDraftSO = async (gp: Gatepass) => {
    setActiveGpForDraft(gp);
    try {
      setLoading(true);
      const res = await apiGet<DraftSOGenerationResponse>(
        `/technician-operations/gatepasses/${gp.id}/draft-so`
      );
      if (res && res.data) {
        setDraftSOData(res.data);
        setOpenDraftSODrawer(true);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to generate draft SO payload");
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Wallet Actions
  // -------------------------------------------------------------------------

  const handleUploadWalletReceipt = async (file: File) => {
    setTxnUploadingReceipt(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiPostMultipart<{ file_url: string; file_name: string }>(
        "/technical-tasks/upload-screenshot",
        fd
      );
      if (res?.data?.file_url) {
        setTxnReceiptUrl(res.data.file_url);
        setTxnReceiptFileName(res.data.file_name || file.name);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to upload receipt file");
    } finally {
      setTxnUploadingReceipt(false);
    }
  };

  const handleRecordWalletTxn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!txnTechName.trim()) {
      setError("Technician name is required");
      return;
    }
    const amt = parseFloat(txnAmount);
    if (isNaN(amt) || amt <= 0) {
      setError("Please enter a valid positive amount");
      return;
    }

    const matchedTech =
      lookups.technicians.find((t) => t.id === txnTechId) ||
      lookups.technicians.find((t) => t.name.toLowerCase() === txnTechName.trim().toLowerCase());

    try {
      setLoading(true);
      await apiPost("/technician-operations/wallet/transactions", {
        technician_id: matchedTech?.id || null,
        technician_name: txnTechName.trim(),
        transaction_type: txnType,
        amount: amt,
        payment_mode: txnPaymentMode,
        customer_name: txnCustomer.trim() || null,
        reference_no: txnRefNo.trim() || null,
        receipt_url: txnReceiptUrl.trim() || null,
        notes: txnNotes.trim() || null,
      });

      setSuccess(`Wallet transaction of ₹${amt.toLocaleString("en-IN")} recorded successfully`);
      setOpenWalletTxnModal(false);
      // Reset
      setTxnTechId("");
      setTxnTechName("");
      setTxnAmount("");
      setTxnCustomer("");
      setTxnRefNo("");
      setTxnReceiptUrl("");
      setTxnReceiptFileName("");
      setTxnNotes("");

      fetchWalletData();
      fetchMetrics();
    } catch (err: any) {
      setError(err?.message || "Failed to record wallet transaction");
    } finally {
      setLoading(false);
    }
  };

  // Fast trigger for technician wallet card
  const handleQuickTxn = (techName: string, type: "COLLECTION" | "HANDOVER_DEPOSIT" | "FIELD_EXPENSE") => {
    const matchedTech = lookups.technicians.find((t) => t.name.toLowerCase() === techName.toLowerCase());
    setTxnTechId(matchedTech?.id || "");
    setTxnTechName(techName);
    setTxnType(type);
    setTxnAmount("");
    setTxnPaymentMode(type === "HANDOVER_DEPOSIT" ? "Cash Deposit" : "Cash");
    setTxnCustomer("");
    setTxnRefNo("");
    setTxnReceiptUrl("");
    setTxnReceiptFileName("");
    setTxnNotes(type === "HANDOVER_DEPOSIT" ? "Handed over cash collection to Accounts" : "");
    setOpenWalletTxnModal(true);
  };

  // -------------------------------------------------------------------------
  // Machine Warranty Actions
  // -------------------------------------------------------------------------

  const handleRegisterWarranty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regSerial.trim() || !regModel.trim() || !regCompany.trim()) {
      setError("Serial Number, Machine Model, and Customer Company are required");
      return;
    }

    const matchedMachine =
      lookups.machines.find((m) => m.id === regProductId) ||
      lookups.machines.find((m) => m.product_name.toLowerCase() === regModel.trim().toLowerCase());
    const matchedCompany =
      lookups.companies.find((c) => c.id === regCompanyId) ||
      lookups.companies.find((c) => c.company_name.toLowerCase() === regCompany.trim().toLowerCase());

    try {
      setLoading(true);
      await apiPost("/technician-operations/warranty", {
        serial_number: regSerial.trim(),
        machine_model: regModel.trim(),
        product_id: matchedMachine?.id || null,
        company_name: regCompany.trim(),
        company_id: matchedCompany?.id || null,
        invoice_number: regInvoiceNo.trim() || null,
        invoice_date: regInvoiceDate,
        warranty_months: Number(regMonths),
        contact_person: regContactPerson.trim() || null,
        contact_phone: regContactPhone.trim() || null,
        installation_city: regCity.trim() || null,
        notes: regNotes.trim() || null,
      });

      setSuccess(`Machine Warranty for '${regSerial.trim()}' registered successfully`);
      setOpenRegisterWarrModal(false);
      // Reset
      setRegSerial("");
      setRegProductId("");
      setRegModel("");
      setRegCompanyId("");
      setRegCompany("");
      setRegInvoiceNo("");
      setRegNotes("");

      fetchWarranties();
      fetchMetrics();
      fetchLookups();
    } catch (err: any) {
      setError(err?.message || "Failed to register machine warranty");
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <AppShell activeKey="technician-operations">
      <main className="page">
        {/* Breadcrumb Navigation */}
        <Breadcrumb trail={["Technical Tasks", "Technician Ops & Wallet"]} />

        {/* Global Notifications */}
        <Banner error={error} success={success} />

        {/* Page Header (Exact Match to TechnicalTasksPage.tsx & Companies.tsx) */}
        <div className="page-header">
          <div>
            <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#1e293b" }}>
              Technician Gatepass &amp; Wallet Management
            </h1>
          </div>

          <div className="page-header-actions" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {!canMutate && (
              <span
                style={{
                  background: "#f1f5f9",
                  color: "#475569",
                  border: "1px solid #cbd5e1",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <TechOpsIconLock size={14} />
                Read-Only Access
              </span>
            )}

            {canMutate && currentTab === "gatepasses" && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setOpenCreateGpModal(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "13px",
                  boxShadow: "0 1px 2px rgba(37, 99, 235, 0.2)",
                }}
              >
                <TechOpsIconPlus size={15} />
                <span>Issue Outward Gatepass</span>
              </button>
            )}

            {canMutate && currentTab === "wallets" && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setTxnTechId("");
                  setTxnTechName("");
                  setTxnType("COLLECTION");
                  setTxnAmount("");
                  setTxnReceiptUrl("");
                  setTxnReceiptFileName("");
                  setOpenWalletTxnModal(true);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "13px",
                  boxShadow: "0 1px 2px rgba(37, 99, 235, 0.2)",
                }}
              >
                <TechOpsIconWallet size={15} />
                <span>Record Wallet Transaction</span>
              </button>
            )}

            {canMutate && currentTab === "warranty" && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setOpenRegisterWarrModal(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "13px",
                  boxShadow: "0 1px 2px rgba(37, 99, 235, 0.2)",
                }}
              >
                <TechOpsIconShieldCheck size={15} />
                <span>Register Machine Warranty</span>
              </button>
            )}
          </div>
        </div>

        {/* KPI Summary Ribbon */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          {/* Card 1: Active Gatepasses */}
          <div
            style={{
              background: "linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)",
              border: "1px solid #e2e8f0",
              borderRadius: "10px",
              padding: "16px 20px",
              boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
              display: "flex",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                minWidth: "48px",
                borderRadius: "12px",
                background: "#eff6ff",
                border: "1px solid #dbeafe",
                color: "#2563eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <TechOpsIconTruck size={22} />
            </div>
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em", color: "#64748b" }}>
                Active Gatepasses
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#1e293b", marginTop: "2px", lineHeight: 1.2 }}>
                {metrics?.active_gatepasses ?? "—"}
              </div>
              <div style={{ fontSize: "12px", color: "#2563eb", marginTop: "3px", fontWeight: 500 }}>
                Spare parts currently in field
              </div>
            </div>
          </div>

          {/* Card 2: Pending SO Reconciliations */}
          <div
            style={{
              background: "linear-gradient(135deg, #fffbeb 0%, #ffffff 100%)",
              border: "1px solid #fde68a",
              borderRadius: "10px",
              padding: "16px 20px",
              boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
              display: "flex",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                minWidth: "48px",
                borderRadius: "12px",
                background: "#fef3c7",
                border: "1px solid #fde68a",
                color: "#d97706",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <TechOpsIconAlertTriangle size={22} />
            </div>
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em", color: "#92400e" }}>
                Pending Sales Orders
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#b45309", marginTop: "2px", lineHeight: 1.2 }}>
                {metrics?.pending_sales_orders ?? "—"}
              </div>
              <div style={{ fontSize: "12px", color: "#b45309", marginTop: "3px", fontWeight: 500 }}>
                Consumed parts awaiting SO billing
              </div>
            </div>
          </div>

          {/* Card 3: Total Wallet Cash Held */}
          <div
            style={{
              background: "linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%)",
              border: "1px solid #bbf7d0",
              borderRadius: "10px",
              padding: "16px 20px",
              boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
              display: "flex",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                minWidth: "48px",
                borderRadius: "12px",
                background: "#dcfce7",
                border: "1px solid #bbf7d0",
                color: "#16a34a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <TechOpsIconBanknote size={22} />
            </div>
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em", color: "#166534" }}>
                Cash in Hand (Technicians)
              </div>
              <div style={{ fontSize: "22px", fontWeight: 700, color: "#15803d", marginTop: "2px", lineHeight: 1.2 }}>
                {formatCurrency(metrics?.total_wallet_cash_held ?? 0)}
              </div>
              <div style={{ fontSize: "12px", color: "#16a34a", marginTop: "3px", fontWeight: 500 }}>
                Collected &amp; pending deposit
              </div>
            </div>
          </div>

          {/* Card 4: Machines Under Active Warranty */}
          <div
            style={{
              background: "linear-gradient(135deg, #f5f3ff 0%, #ffffff 100%)",
              border: "1px solid #ddd6fe",
              borderRadius: "10px",
              padding: "16px 20px",
              boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
              display: "flex",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                minWidth: "48px",
                borderRadius: "12px",
                background: "#ede9fe",
                border: "1px solid #ddd6fe",
                color: "#7c3aed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <TechOpsIconShieldCheck size={22} />
            </div>
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em", color: "#5b21b6" }}>
                Active Machine Warranties
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#6d28d9", marginTop: "2px", lineHeight: 1.2 }}>
                {metrics?.total_warranties_active ?? "—"}
              </div>
              <div style={{ fontSize: "12px", color: "#7c3aed", marginTop: "3px", fontWeight: 500 }}>
                Registered equipment protected
              </div>
            </div>
          </div>
        </div>

        {/* Tab Selection Navigation */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            borderBottom: "2px solid #e2e8f0",
            marginBottom: "20px",
          }}
        >
          <button
            type="button"
            onClick={() => handleTabChange("gatepasses")}
            style={{
              padding: "10px 18px",
              border: "none",
              background: "none",
              borderBottom: currentTab === "gatepasses" ? "3px solid #2563eb" : "3px solid transparent",
              color: currentTab === "gatepasses" ? "#2563eb" : "#64748b",
              fontWeight: currentTab === "gatepasses" ? 700 : 500,
              fontSize: "14px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <TechOpsIconPackage size={16} />
            <span>Spare Parts Gatepass &amp; Returns</span>
            {metrics?.pending_sales_orders ? (
              <span
                style={{
                  background: "#fef3c7",
                  color: "#b45309",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontWeight: 700,
                }}
              >
                {metrics.pending_sales_orders} SO needed
              </span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange("wallets")}
            style={{
              padding: "10px 18px",
              border: "none",
              background: "none",
              borderBottom: currentTab === "wallets" ? "3px solid #2563eb" : "3px solid transparent",
              color: currentTab === "wallets" ? "#2563eb" : "#64748b",
              fontWeight: currentTab === "wallets" ? 700 : 500,
              fontSize: "14px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <TechOpsIconWallet size={16} />
            <span>Technician Wallets &amp; Field Collections</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange("warranty")}
            style={{
              padding: "10px 18px",
              border: "none",
              background: "none",
              borderBottom: currentTab === "warranty" ? "3px solid #2563eb" : "3px solid transparent",
              color: currentTab === "warranty" ? "#2563eb" : "#64748b",
              fontWeight: currentTab === "warranty" ? 700 : 500,
              fontSize: "14px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <TechOpsIconShieldCheck size={16} />
            <span>Machine Warranty Registry &amp; Validator</span>
          </button>
        </div>

        {/* ================================================================= */}
        {/* TAB 1: SPARE PARTS GATEPASS & RETURNS                            */}
        {/* ================================================================= */}
        {currentTab === "gatepasses" && (
          <div>
            {/* Filter controls */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "12px",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "16px",
                background: "#f8fafc",
                padding: "12px 16px",
                borderRadius: "8px",
                border: "1px solid #e2e8f0",
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Search Gatepass / Technician / Customer / Serial..."
                  value={gpSearch}
                  onChange={(e) => {
                    setGpSearch(e.target.value);
                    setGpPage(1);
                  }}
                  className="form-control"
                  style={{ width: "320px", fontSize: "13px" }}
                />

                <select
                  value={gpStatusFilter}
                  onChange={(e) => {
                    setGpStatusFilter(e.target.value);
                    setGpPage(1);
                  }}
                  className="form-control"
                  style={{ width: "190px", fontSize: "13px" }}
                >
                  <option value="">All Statuses</option>
                  <option value="ISSUED">ISSUED (In Field)</option>
                  <option value="PARTIALLY_RETURNED">PARTIALLY RETURNED</option>
                  <option value="RECONCILED">RECONCILED</option>
                  <option value="CLOSED">CLOSED</option>
                </select>

                {(gpSearch || gpStatusFilter) && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setGpSearch("");
                      setGpStatusFilter("");
                      setGpPage(1);
                    }}
                    style={{ fontSize: "12px", padding: "6px 12px" }}
                  >
                    Clear Filters
                  </button>
                )}
              </div>

              <div style={{ fontSize: "13px", color: "#64748b" }}>
                Showing <b>{gatepasses.length}</b> of <b>{gpTotal}</b> gatepasses
              </div>
            </div>

            {/* Gatepass Table */}
            <div className="table-responsive" style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <table className="table table-hover" style={{ margin: 0, fontSize: "13px" }}>
                <thead style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                  <tr>
                    <th style={{ padding: "12px 14px", fontWeight: 600 }}>Gatepass #</th>
                    <th style={{ padding: "12px 14px", fontWeight: 600 }}>Technician</th>
                    <th style={{ padding: "12px 14px", fontWeight: 600 }}>Customer &amp; Serial</th>
                    <th style={{ padding: "12px 14px", fontWeight: 600 }}>Issue Date</th>
                    <th style={{ padding: "12px 14px", fontWeight: 600, textAlign: "center" }}>Parts Issued</th>
                    <th style={{ padding: "12px 14px", fontWeight: 600, textAlign: "center" }}>Returned / Consumed</th>
                    <th style={{ padding: "12px 14px", fontWeight: 600 }}>SO &amp; Reconciliation Status</th>
                    <th style={{ padding: "12px 14px", fontWeight: 600, textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <GatepassTableSkeletonRows count={8} />
                  ) : gatepasses.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                        No spare parts gatepasses found. Click <b>"Issue Outward Gatepass"</b> to create one.
                      </td>
                    </tr>
                  ) : (
                    gatepasses.map((gp) => {
                      const isPendingSO = gp.so_required && !gp.so_created;
                      return (
                        <tr key={gp.id} style={{ verticalAlign: "middle" }}>
                          {/* Gatepass Number */}
                          <td style={{ padding: "12px 14px" }}>
                            <div style={{ fontWeight: 700, color: "#1e293b" }}>{gp.gatepass_number}</div>
                            {gp.warehouse_name && (
                              <div
                                style={{
                                  fontSize: "11px",
                                  color: "#2563eb",
                                  fontWeight: 600,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  marginTop: "2px",
                                }}
                              >
                                <TechOpsIconWarehouse size={12} />
                                <span>{gp.warehouse_name}</span>
                              </div>
                            )}
                            {gp.return_gatepass_number && (
                              <div style={{ fontSize: "11px", color: "#64748b" }}>
                                Ret: {gp.return_gatepass_number}
                              </div>
                            )}
                          </td>

                          {/* Technician */}
                          <td style={{ padding: "12px 14px" }}>
                            <div style={{ fontWeight: 600, color: "#1e293b" }}>{gp.technician_name}</div>
                            {gp.technician_mobile && (
                              <div
                                style={{
                                  fontSize: "11px",
                                  color: "#64748b",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  marginTop: "2px",
                                }}
                              >
                                <TechOpsIconPhone size={11} />
                                <span>{gp.technician_mobile}</span>
                              </div>
                            )}
                          </td>

                          {/* Customer & Machine Serial */}
                          <td style={{ padding: "12px 14px" }}>
                            <div style={{ fontWeight: 600 }}>{gp.customer_name || "—"}</div>
                            {gp.machine_model && (
                              <div style={{ fontSize: "11px", color: "#475569" }}>{gp.machine_model}</div>
                            )}
                            {gp.machine_serial_number ? (
                              <div style={{ fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                <span>SN: <b>{gp.machine_serial_number}</b></span>
                                {gp.is_warranty_service ? (
                                  <span style={{ color: "#16a34a", fontWeight: 700 }}>[Warranty FOC]</span>
                                ) : (
                                  <span style={{ color: "#d97706", fontWeight: 600 }}>[Chargeable]</span>
                                )}
                              </div>
                            ) : (
                              <div style={{ fontSize: "11px", color: "#94a3b8" }}>No machine linked</div>
                            )}
                          </td>

                          {/* Issue Date */}
                          <td style={{ padding: "12px 14px", color: "#475569" }}>
                            {gp.issue_date}
                          </td>

                          {/* Issued count */}
                          <td style={{ padding: "12px 14px", textAlign: "center" }}>
                            <span
                              style={{
                                background: "#eff6ff",
                                color: "#1d4ed8",
                                padding: "3px 8px",
                                borderRadius: "6px",
                                fontWeight: 700,
                              }}
                            >
                              {gp.total_issued}
                            </span>
                          </td>

                          {/* Returned vs Consumed */}
                          <td style={{ padding: "12px 14px", textAlign: "center" }}>
                            <div style={{ display: "inline-flex", gap: "6px" }}>
                              <span
                                title="Quantity returned to warehouse"
                                style={{
                                  background: "#f0fdf4",
                                  color: "#15803d",
                                  padding: "2px 7px",
                                  borderRadius: "4px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                <TechOpsIconRotateCcw size={12} />
                                {gp.total_returned}
                              </span>
                              <span
                                title="Quantity consumed on machine"
                                style={{
                                  background: gp.total_consumed > 0 ? (gp.is_warranty_service ? "#f5f3ff" : "#fffbeb") : "#f1f5f9",
                                  color: gp.total_consumed > 0 ? (gp.is_warranty_service ? "#6d28d9" : "#b45309") : "#64748b",
                                  padding: "2px 7px",
                                  borderRadius: "4px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                <TechOpsIconSettings size={12} />
                                {gp.total_consumed}
                              </span>
                            </div>
                            {gp.pending_return > 0 && (
                              <div style={{ fontSize: "10px", color: "#ea580c", marginTop: "2px" }}>
                                {gp.pending_return} in field
                              </div>
                            )}
                          </td>

                          {/* Status & SO Verification */}
                          <td style={{ padding: "12px 14px" }}>
                            {isPendingSO ? (
                              <div>
                                <span
                                  style={{
                                    background: "#fef3c7",
                                    color: "#92400e",
                                    padding: "3px 8px",
                                    borderRadius: "6px",
                                    fontWeight: 700,
                                    fontSize: "11px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "5px",
                                    border: "1px solid #fde68a",
                                  }}
                                >
                                  <TechOpsIconAlertTriangle size={12} />
                                  <span>SO Required ({gp.total_consumed} consumed)</span>
                                </span>
                                <div style={{ fontSize: "11px", color: "#b45309", marginTop: "3px" }}>
                                  Salesperson must bill parts
                                </div>
                              </div>
                            ) : gp.so_created ? (
                              <div>
                                <span
                                  style={{
                                    background: "#dcfce7",
                                    color: "#166534",
                                    padding: "3px 8px",
                                    borderRadius: "6px",
                                    fontWeight: 700,
                                    fontSize: "11px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "5px",
                                  }}
                                >
                                  <TechOpsIconCheckCircle size={12} />
                                  <span>SO: {gp.so_number}</span>
                                </span>
                                <div style={{ fontSize: "11px", color: "#16a34a", marginTop: "2px" }}>
                                  Billed &amp; Reconciled
                                </div>
                              </div>
                            ) : gp.status === "CLOSED" ? (
                              <span
                                style={{
                                  background: "#f1f5f9",
                                  color: "#334155",
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  fontWeight: 600,
                                  fontSize: "11px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "5px",
                                }}
                              >
                                <TechOpsIconCheckCircle size={12} />
                                <span>Closed</span>
                              </span>
                            ) : gp.is_warranty_service && gp.total_consumed > 0 ? (
                              <span
                                style={{
                                  background: "#f5f3ff",
                                  color: "#6d28d9",
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  fontWeight: 600,
                                  fontSize: "11px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "5px",
                                }}
                              >
                                <TechOpsIconShieldCheck size={12} />
                                <span>Warranty FOC Replacement</span>
                              </span>
                            ) : (
                              <span
                                style={{
                                  background: gp.status === "ISSUED" ? "#eff6ff" : "#f8fafc",
                                  color: gp.status === "ISSUED" ? "#1d4ed8" : "#475569",
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  fontWeight: 600,
                                  fontSize: "11px",
                                }}
                              >
                                {gp.status}
                              </span>
                            )}
                          </td>

                          {/* Row Actions */}
                          <td style={{ padding: "12px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                            <div style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                              {/* Record Return */}
                              {canMutate && gp.status !== "CLOSED" && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-primary"
                                  onClick={() => handleOpenReturnModal(gp)}
                                  title="Record unused spare parts return or consumed parts"
                                  style={{
                                    fontSize: "12px",
                                    padding: "4px 8px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "5px",
                                  }}
                                >
                                  <TechOpsIconRotateCcw size={13} />
                                  <span>Return</span>
                                </button>
                              )}

                              {/* View / Copy Draft SO if parts consumed */}
                              {gp.total_consumed > 0 && !gp.is_warranty_service && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-warning"
                                  onClick={() => handleViewDraftSO(gp)}
                                  title="View draft Sales Order details for salesperson"
                                  style={{
                                    fontSize: "12px",
                                    padding: "4px 8px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "5px",
                                  }}
                                >
                                  <TechOpsIconFileText size={13} />
                                  <span>Draft SO</span>
                                </button>
                              )}

                              {/* Direct Create SO in Sales Process */}
                              {isPendingSO && canCreateSO && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  onClick={() => navigate(`/sales/process/add?gatepass_id=${gp.id}`)}
                                  title="Open Sales Order form pre-filled with consumed spare parts"
                                  style={{
                                    fontSize: "12px",
                                    padding: "4px 8px",
                                    fontWeight: 600,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "5px",
                                  }}
                                >
                                  <TechOpsIconShoppingCart size={13} />
                                  <span>Create SO</span>
                                </button>
                              )}

                              {/* Link SO button */}
                              {isPendingSO && canLinkSO && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-warning"
                                  onClick={() => handleOpenLinkSOModal(gp)}
                                  title="Link existing Sales Order number created for consumed parts"
                                  style={{
                                    fontSize: "12px",
                                    padding: "4px 8px",
                                    fontWeight: 600,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "5px",
                                  }}
                                >
                                  <TechOpsIconLink size={13} />
                                  <span>Link SO</span>
                                </button>
                              )}

                              {/* Print Gatepass Slip */}
                              <button
                                type="button"
                                className="btn btn-sm btn-secondary"
                                aria-label="Print Gatepass Slip"
                                onClick={() => printGatepassSlip(gp)}
                                title="Print Outward / Return Gatepass Slip"
                                style={{
                                  fontSize: "12px",
                                  padding: "5px 8px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <TechOpsIconPrinter size={14} />
                              </button>

                              {/* Detail Drawer */}
                              <button
                                type="button"
                                className="btn btn-sm btn-secondary"
                                onClick={() => {
                                  setActiveGpDetail(gp);
                                  setOpenDetailDrawer(true);
                                }}
                                style={{ fontSize: "12px", padding: "4px 8px" }}
                              >
                                Details
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Gatepasses Pagination */}
            {gpTotalPages > 1 && (
              <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
                <Pagination
                  pagination={{
                    current_page: gpPage,
                    total_pages: gpTotalPages,
                    total_records: gpTotal,
                    page_size: 25,
                  }}
                  pageSize={25}
                  onPageChange={setGpPage}
                />
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 2: TECHNICIAN WALLETS & FIELD COLLECTIONS                    */}
        {/* ================================================================= */}
        {currentTab === "wallets" && (
          <div>
            {/* Top: Technician Cash-in-Hand Cards */}
            <div style={{ marginBottom: "24px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", marginBottom: "12px" }}>
                Technician Live Wallet Balances (Cash in Hand)
              </h2>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                  gap: "16px",
                }}
              >
                {walletSummaries.length === 0 ? (
                  <div
                    style={{
                      gridColumn: "1 / -1",
                      background: "#f8fafc",
                      padding: "24px",
                      borderRadius: "8px",
                      textAlign: "center",
                      color: "#64748b",
                    }}
                  >
                    No technician wallet balances recorded yet. Click <b>"Record Wallet Transaction"</b> to start tracking field collections.
                  </div>
                ) : (
                  walletSummaries.map((tech) => {
                    const isPendingDeposit = tech.net_wallet_balance > 0;
                    return (
                      <div
                        key={tech.technician_name}
                        style={{
                          background: "#fff",
                          border: isPendingDeposit ? "1px solid #fed7aa" : "1px solid #e2e8f0",
                          borderRadius: "10px",
                          padding: "16px 18px",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: "15px", color: "#1e293b" }}>
                              {tech.technician_name}
                            </div>
                            {tech.technician_mobile && (
                              <div
                                style={{
                                  fontSize: "12px",
                                  color: "#64748b",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  marginTop: "2px",
                                }}
                              >
                                <TechOpsIconPhone size={12} />
                                <span>{tech.technician_mobile}</span>
                              </div>
                            )}
                          </div>

                          <span
                            style={{
                              background: isPendingDeposit ? "#fff7ed" : "#f0fdf4",
                              color: isPendingDeposit ? "#c2410c" : "#15803d",
                              border: isPendingDeposit ? "1px solid #fed7aa" : "1px solid #bbf7d0",
                              padding: "2px 8px",
                              borderRadius: "12px",
                              fontSize: "11px",
                              fontWeight: 700,
                            }}
                          >
                            {isPendingDeposit ? "Cash in Hand" : tech.status}
                          </span>
                        </div>

                        {/* Financial Stats Grid */}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr 1fr",
                            gap: "8px",
                            padding: "8px 10px",
                            background: "#f8fafc",
                            borderRadius: "6px",
                            marginBottom: "12px",
                            fontSize: "11px",
                          }}
                        >
                          <div>
                            <div style={{ color: "#64748b" }}>Collections</div>
                            <div style={{ fontWeight: 700, color: "#16a34a", fontSize: "12px" }}>
                              {formatCurrency(tech.total_collected)}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: "#64748b" }}>Handover Dep.</div>
                            <div style={{ fontWeight: 700, color: "#2563eb", fontSize: "12px" }}>
                              {formatCurrency(tech.total_deposited)}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: "#64748b" }}>Field Expenses</div>
                            <div style={{ fontWeight: 700, color: "#9333ea", fontSize: "12px" }}>
                              {formatCurrency(tech.total_expenses)}
                            </div>
                          </div>
                        </div>

                        {/* Net Wallet Balance Row */}
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: "12px",
                            padding: "4px 0",
                            borderTop: "1px dashed #e2e8f0",
                          }}
                        >
                          <span style={{ fontSize: "13px", fontWeight: 600, color: "#475569" }}>
                            Net Wallet Balance:
                          </span>
                          <span
                            style={{
                              fontSize: "16px",
                              fontWeight: 800,
                              color: tech.net_wallet_balance > 0 ? "#ea580c" : (tech.net_wallet_balance < 0 ? "#dc2626" : "#16a34a"),
                            }}
                          >
                            {formatCurrency(tech.net_wallet_balance)}
                          </span>
                        </div>

                        {/* Quick action buttons */}
                        {canMutate && (
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-success"
                              onClick={() => handleQuickTxn(tech.technician_name, "COLLECTION")}
                              style={{
                                flex: 1,
                                fontSize: "11px",
                                padding: "5px 6px",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "4px",
                                fontWeight: 600,
                              }}
                            >
                              <TechOpsIconPlus size={12} />
                              <span>Collect</span>
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-primary"
                              onClick={() => handleQuickTxn(tech.technician_name, "HANDOVER_DEPOSIT")}
                              style={{
                                flex: 1,
                                fontSize: "11px",
                                padding: "5px 6px",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "4px",
                                fontWeight: 600,
                              }}
                            >
                              <TechOpsIconArrowUpRight size={12} />
                              <span>Handover</span>
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary"
                              onClick={() => handleQuickTxn(tech.technician_name, "FIELD_EXPENSE")}
                              style={{
                                flex: 1,
                                fontSize: "11px",
                                padding: "5px 6px",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "4px",
                                fontWeight: 600,
                              }}
                            >
                              <TechOpsIconReceipt size={12} />
                              <span>Expense</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Bottom: Transaction History Ledger */}
            <div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "12px",
                }}
              >
                <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                  Wallet Transaction History Ledger
                </h2>

                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <input
                    type="text"
                    list="tech-ops-tech-datalist"
                    placeholder="Filter by technician..."
                    value={walletFilterTech}
                    onChange={(e) => {
                      setWalletFilterTech(e.target.value);
                      setWalletPage(1);
                    }}
                    className="form-control"
                    style={{ width: "200px", fontSize: "12px" }}
                  />

                  <select
                    value={walletFilterType}
                    onChange={(e) => {
                      setWalletFilterType(e.target.value);
                      setWalletPage(1);
                    }}
                    className="form-control"
                    style={{ width: "180px", fontSize: "12px" }}
                  >
                    <option value="">All Types</option>
                    <option value="COLLECTION">Collections</option>
                    <option value="HANDOVER_DEPOSIT">Handover Deposits</option>
                    <option value="FIELD_EXPENSE">Field Expenses</option>
                  </select>
                </div>
              </div>

              {/* Transactions Table */}
              <div className="table-responsive" style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <table className="table table-hover" style={{ margin: 0, fontSize: "13px" }}>
                  <thead style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                    <tr>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Txn #</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Date</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Technician</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Type</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Mode</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Customer / Notes</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, textAlign: "right" }}>Amount</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, textAlign: "center" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <WalletTableSkeletonRows count={8} />
                    ) : walletTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: "center", padding: "30px", color: "#64748b" }}>
                          No wallet transactions found.
                        </td>
                      </tr>
                    ) : (
                      walletTransactions.map((tx) => (
                        <tr key={tx.id}>
                          <td style={{ padding: "10px 14px", fontWeight: 700, color: "#1e293b" }}>
                            {tx.transaction_number}
                          </td>
                          <td style={{ padding: "10px 14px", color: "#64748b" }}>
                            {tx.transaction_date}
                          </td>
                          <td style={{ padding: "10px 14px", fontWeight: 600 }}>
                            {tx.technician_name}
                          </td>
                          <td style={{ padding: "10px 14px" }}>
                            {tx.transaction_type === "COLLECTION" ? (
                              <span
                                style={{
                                  background: "#dcfce7",
                                  color: "#166534",
                                  padding: "2px 8px",
                                  borderRadius: "4px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                <TechOpsIconArrowDownLeft size={12} />
                                <span>COLLECTION</span>
                              </span>
                            ) : tx.transaction_type === "HANDOVER_DEPOSIT" ? (
                              <span
                                style={{
                                  background: "#eff6ff",
                                  color: "#1e40af",
                                  padding: "2px 8px",
                                  borderRadius: "4px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                <TechOpsIconArrowUpRight size={12} />
                                <span>HANDOVER</span>
                              </span>
                            ) : (
                              <span
                                style={{
                                  background: "#f5f3ff",
                                  color: "#6b21a8",
                                  padding: "2px 8px",
                                  borderRadius: "4px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                <TechOpsIconReceipt size={12} />
                                <span>EXPENSE</span>
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "10px 14px", color: "#475569" }}>
                            {tx.payment_mode}
                            {tx.reference_no && <div style={{ fontSize: "10px", color: "#64748b" }}>Ref: {tx.reference_no}</div>}
                          </td>
                          <td style={{ padding: "10px 14px" }}>
                            {tx.customer_name && <b>{tx.customer_name}</b>}
                            {tx.notes && <div style={{ fontSize: "11px", color: "#64748b" }}>{tx.notes}</div>}
                            <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "2px", flexWrap: "wrap" }}>
                              {tx.technical_task_id && (
                                <span
                                  style={{
                                    background: "#eff6ff",
                                    color: "#1d4ed8",
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    fontSize: "10px",
                                    fontWeight: 600,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                  }}
                                >
                                  <TechOpsIconWrench size={11} />
                                  <span>Task Sync</span>
                                </span>
                              )}
                              {resolveReceiptHref(tx.receipt_url) && (
                                <a
                                  href={resolveReceiptHref(tx.receipt_url)!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    color: "#2563eb",
                                    textDecoration: "underline",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                  }}
                                >
                                  <TechOpsIconPaperclip size={12} />
                                  <span>View Receipt</span>
                                </a>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: tx.transaction_type === "COLLECTION" ? "#16a34a" : "#1e293b" }}>
                            {tx.transaction_type === "COLLECTION" ? "+ " : "- "}
                            {formatCurrency(tx.amount)}
                          </td>
                          <td style={{ padding: "10px 14px", textAlign: "center" }}>
                            <span style={{ background: "#f1f5f9", color: "#475569", padding: "2px 6px", borderRadius: "4px", fontSize: "11px" }}>
                              {tx.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {walletTotalPages > 1 && (
                <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
                  <Pagination
                    pagination={{
                      current_page: walletPage,
                      total_pages: walletTotalPages,
                      total_records: walletTotal,
                      page_size: 25,
                    }}
                    pageSize={25}
                    onPageChange={setWalletPage}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 3: MACHINE WARRANTY REGISTRY & VALIDATOR                     */}
        {/* ================================================================= */}
        {currentTab === "warranty" && (
          <div>
            {/* Quick Serial Validator Widget */}
            <div
              style={{
                background: "linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)",
                border: "1px solid #cbd5e1",
                borderRadius: "10px",
                padding: "20px",
                marginBottom: "24px",
                boxShadow: "0 2px 4px rgba(0,0,0,0.03)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                <div
                  style={{
                    width: "34px",
                    height: "34px",
                    minWidth: "34px",
                    borderRadius: "8px",
                    background: "#eff6ff",
                    border: "1px solid #dbeafe",
                    color: "#2563eb",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <TechOpsIconSearch size={17} />
                </div>
                <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#1e293b" }}>
                  Live Machine Serial Warranty Validator
                </h2>
              </div>
              <p style={{ margin: "0 0 14px", fontSize: "13px", color: "#64748b" }}>
                Enter the customer's machine serial number before dispatching spare parts to verify whether replacement parts are Free-Of-Cost under warranty or require a chargeable Sales Order.
              </p>

              <div style={{ display: "flex", gap: "10px", maxWidth: "600px" }}>
                <input
                  type="text"
                  list="tech-ops-serial-datalist"
                  placeholder="Enter Serial Number (e.g. SN-INHYMA-1001)..."
                  value={validatorSerialInput}
                  onChange={(e) => setValidatorSerialInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleValidateSerial()}
                  className="form-control"
                  style={{ fontSize: "14px", fontWeight: 600 }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleValidateSerial()}
                  disabled={validating || !validatorSerialInput.trim()}
                  style={{ minWidth: "140px", fontWeight: 600 }}
                >
                  {validating ? "Checking..." : "Verify Serial"}
                </button>
              </div>

              {/* Validation Result Box */}
              {validationResult && (
                <div
                  style={{
                    marginTop: "16px",
                    padding: "16px 20px",
                    borderRadius: "8px",
                    background: validationResult.is_covered ? "#f0fdf4" : (validationResult.is_registered ? "#fef2f2" : "#f8fafc"),
                    border: validationResult.is_covered ? "1px solid #86efac" : (validationResult.is_registered ? "1px solid #fca5a5" : "1px solid #cbd5e1"),
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span
                      style={{
                        color: validationResult.is_covered
                          ? "#15803d"
                          : validationResult.is_registered
                          ? "#b91c1c"
                          : "#475569",
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                    >
                      {validationResult.is_covered ? (
                        <TechOpsIconCheckCircle size={18} />
                      ) : validationResult.is_registered ? (
                        <TechOpsIconXCircle size={18} />
                      ) : (
                        <TechOpsIconInfo size={18} />
                      )}
                    </span>
                    <span
                      style={{
                        fontWeight: 800,
                        fontSize: "15px",
                        color: validationResult.is_covered ? "#15803d" : (validationResult.is_registered ? "#b91c1c" : "#475569"),
                      }}
                    >
                      {validationResult.is_covered
                        ? "MACHINE IS UNDER ACTIVE WARRANTY"
                        : (validationResult.is_registered ? "WARRANTY EXPIRED — CHARGEABLE PARTS" : "SERIAL NOT REGISTERED")}
                    </span>
                  </div>

                  <p style={{ margin: "0 0 10px", fontSize: "13px", color: "#334155" }}>
                    {validationResult.message}
                  </p>

                  {validationResult.is_registered && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", fontSize: "12px", color: "#475569" }}>
                      <div><b>Machine Model:</b> {validationResult.machine_model || "—"}</div>
                      <div><b>Customer:</b> {validationResult.company_name || "—"}</div>
                      <div><b>Invoice Date:</b> {validationResult.invoice_date || "—"}</div>
                      <div><b>Warranty Expiry:</b> {validationResult.warranty_end_date || "—"}</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Warranty Registry Table */}
            <div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "12px",
                }}
              >
                <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                  Machine Warranty Registry
                </h2>

                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <input
                    type="text"
                    placeholder="Search Serial / Model / Company..."
                    value={warrSearch}
                    onChange={(e) => {
                      setWarrSearch(e.target.value);
                      setWarrPage(1);
                    }}
                    className="form-control"
                    style={{ width: "260px", fontSize: "12px" }}
                  />

                  <select
                    value={warrStatusFilter}
                    onChange={(e) => {
                      setWarrStatusFilter(e.target.value);
                      setWarrPage(1);
                    }}
                    className="form-control"
                    style={{ width: "180px", fontSize: "12px" }}
                  >
                    <option value="">All Statuses</option>
                    <option value="UNDER_WARRANTY">UNDER WARRANTY</option>
                    <option value="OUT_OF_WARRANTY">OUT OF WARRANTY</option>
                    <option value="EXTENDED_AMC">EXTENDED AMC</option>
                  </select>
                </div>
              </div>

              <div className="table-responsive" style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <table className="table table-hover" style={{ margin: 0, fontSize: "13px" }}>
                  <thead style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                    <tr>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Serial Number</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Machine Model</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Customer Company</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Invoice Date</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Duration</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Warranty Expiry</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, textAlign: "center" }}>Coverage Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <WarrantyTableSkeletonRows count={8} />
                    ) : warranties.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", padding: "30px", color: "#64748b" }}>
                          No machine warranties registered. Click <b>"Register Machine Warranty"</b> to add one.
                        </td>
                      </tr>
                    ) : (
                      warranties.map((w) => (
                        <tr key={w.id}>
                          <td style={{ padding: "10px 14px", fontWeight: 700, color: "#1e293b" }}>
                            {w.serial_number}
                          </td>
                          <td style={{ padding: "10px 14px", fontWeight: 600 }}>
                            {w.machine_model}
                          </td>
                          <td style={{ padding: "10px 14px" }}>
                            <b>{w.company_name}</b>
                            {w.installation_city && (
                              <span style={{ fontSize: "11px", color: "#64748b", marginLeft: "4px" }}>
                                ({w.installation_city})
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "10px 14px", color: "#64748b" }}>
                            {w.invoice_date}
                            {w.invoice_number && (
                              <div style={{ fontSize: "10px" }}>Inv: {w.invoice_number}</div>
                            )}
                          </td>
                          <td style={{ padding: "10px 14px" }}>
                            {w.warranty_months} Months
                          </td>
                          <td style={{ padding: "10px 14px", fontWeight: 600 }}>
                            {w.warranty_end_date}
                          </td>
                          <td style={{ padding: "10px 14px", textAlign: "center" }}>
                            {w.is_currently_covered ? (
                              <span
                                style={{
                                  background: "#dcfce7",
                                  color: "#166534",
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  fontWeight: 700,
                                  fontSize: "11px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "5px",
                                }}
                              >
                                <TechOpsIconCheckCircle size={12} />
                                <span>Under Warranty ({w.days_remaining}d left)</span>
                              </span>
                            ) : (
                              <span
                                style={{
                                  background: "#fee2e2",
                                  color: "#991b1b",
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  fontWeight: 600,
                                  fontSize: "11px",
                                }}
                              >
                                Expired (Chargeable)
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {warrTotalPages > 1 && (
                <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
                  <Pagination
                    pagination={{
                      current_page: warrPage,
                      total_pages: warrTotalPages,
                      total_records: warrTotal,
                      page_size: 25,
                    }}
                    pageSize={25}
                    onPageChange={setWarrPage}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* SHARED MASTER DATALISTS                                          */}
        {/* ================================================================= */}
        <datalist id="tech-ops-tech-datalist">
          {lookups.technicians.map((t) => (
            <option key={t.id} value={t.name}>
              {t.mobile ? `${t.mobile}${t.city ? ` • ${t.city}` : ""}` : t.city || ""}
            </option>
          ))}
        </datalist>

        <datalist id="tech-ops-company-datalist">
          {lookups.companies.map((c) => (
            <option key={c.id} value={c.company_name}>
              {[c.city, c.state].filter(Boolean).join(", ")}
            </option>
          ))}
        </datalist>

        <datalist id="tech-ops-machine-datalist">
          {lookups.machines.map((m) => (
            <option key={m.id} value={m.product_name}>
              {m.product_code || m.product_type}
            </option>
          ))}
        </datalist>

        <datalist id="tech-ops-serial-datalist">
          {lookups.serial_registry.map((s) => (
            <option key={s.serial_number} value={s.serial_number}>
              {[s.machine_model, s.company_name, s.is_covered ? "Under Warranty" : "Out of Warranty"]
                .filter(Boolean)
                .join(" • ")}
            </option>
          ))}
        </datalist>

        <datalist id="tech-ops-city-datalist">
          {lookups.cities.map((ct) => (
            <option key={ct.id} value={ct.name}>
              {ct.state || ""}
            </option>
          ))}
        </datalist>

        <datalist id="tech-ops-so-datalist">
          {candidateSaleOrdersForLink.map((so) => (
            <option key={so.id} value={so.order_no}>
              {[so.company_name, so.status, so.total_amount != null ? `₹${so.total_amount}` : ""]
                .filter(Boolean)
                .join(" • ")}
            </option>
          ))}
        </datalist>

        {/* ================================================================= */}
        {/* MODAL: ISSUE OUTWARD GATEPASS                                    */}
        {/* ================================================================= */}
        <Modal
          open={openCreateGpModal}
          title="Issue Outward Spare Parts Gatepass"
          onClose={() => setOpenCreateGpModal(false)}
          variant="center"
          cardStyle={{ maxWidth: "900px", width: "100%" }}
        >
          <form onSubmit={handleCreateGatepass} style={{ padding: "20px" }}>
            {/* Row 1: Dispatch Warehouse & Linked Technical Task */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Dispatch Warehouse {lookups.warehouses.length > 0 ? "*" : ""}
                </label>
                {lookups.warehouses.length > 0 ? (
                  <select
                    aria-label="Dispatch Warehouse"
                    required
                    value={newGpWarehouse}
                    onChange={(e) => setNewGpWarehouse(e.target.value)}
                    className="form-control"
                  >
                    <option value="">-- Select Physical Warehouse --</option>
                    {lookups.warehouses.map((wh) => (
                      <option key={wh.id} value={wh.name}>
                        {wh.name}
                        {wh.is_primary ? " (Primary)" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    aria-label="Dispatch Warehouse"
                    placeholder="e.g. Main Warehouse"
                    value={newGpWarehouse}
                    onChange={(e) => setNewGpWarehouse(e.target.value)}
                    className="form-control"
                  />
                )}
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Link Open Technical Task (Optional Auto-Fill)
                </label>
                <select
                  aria-label="Link Technical Task"
                  value={newGpTaskId}
                  onChange={(e) => handleSelectTechnicalTaskForGp(e.target.value)}
                  className="form-control"
                >
                  <option value="">-- Optional: Select Technical Task --</option>
                  {lookups.technical_tasks.map((tk) => (
                    <option key={tk.id} value={tk.id}>
                      {tk.task_number || "Task"} — {tk.company_name}
                      {tk.serial_number ? ` (SN: ${tk.serial_number})` : ""}
                      {tk.task_allotted_to ? ` • ${tk.task_allotted_to}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 2: Technician Name & Mobile */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Technician Name *
                </label>
                <input
                  type="text"
                  required
                  list="tech-ops-tech-datalist"
                  placeholder="Select or type technician name"
                  value={newGpTechName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewGpTechName(val);
                    const matched = lookups.technicians.find(
                      (t) => t.name.toLowerCase() === val.trim().toLowerCase()
                    );
                    setNewGpTechId(matched?.id || "");
                    if (matched?.mobile) {
                      setNewGpTechMobile(matched.mobile);
                    }
                  }}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Technician Mobile
                </label>
                <input
                  type="tel"
                  placeholder="e.g. 9876543210"
                  value={newGpTechMobile}
                  onChange={(e) => setNewGpTechMobile(e.target.value)}
                  className="form-control"
                />
              </div>
            </div>

            {/* Row 3: Customer Company, Machine Model & Serial */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px", marginBottom: "14px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Customer Company
                </label>
                <input
                  type="text"
                  list="tech-ops-company-datalist"
                  placeholder="Select or type customer"
                  value={newGpCustomer}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewGpCustomer(val);
                    const comp = lookups.companies.find(
                      (c) => c.company_name.toLowerCase() === val.trim().toLowerCase()
                    );
                    setNewGpCompanyId(comp?.id || "");
                  }}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Machine Model
                </label>
                <input
                  type="text"
                  list="tech-ops-machine-datalist"
                  placeholder="Select machine (filters compatible parts)"
                  value={newGpMachineModel}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewGpMachineModel(val);
                    const mc = lookups.machines.find(
                      (m) => m.product_name.toLowerCase() === val.trim().toLowerCase()
                    );
                    setNewGpMachineId(mc?.id || "");
                  }}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Machine Serial Number
                </label>
                <div style={{ display: "flex", gap: "6px" }}>
                  <input
                    type="text"
                    list="tech-ops-serial-datalist"
                    placeholder="e.g. SN-INHYMA-1001"
                    value={newGpSerial}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewGpSerial(val);
                      const known = lookups.serial_registry.find(
                        (s) => s.serial_number.toLowerCase() === val.trim().toLowerCase()
                      );
                      if (known) {
                        if (known.company_name && !newGpCustomer.trim()) setNewGpCustomer(known.company_name);
                        if (known.machine_model && !newGpMachineModel.trim()) setNewGpMachineModel(known.machine_model);
                      }
                    }}
                    className="form-control"
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleCheckSerialForGp()}
                    style={{ fontSize: "11px", whiteSpace: "nowrap" }}
                  >
                    Check
                  </button>
                </div>
              </div>
            </div>

            {newGpWarrantyCheckMsg && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  marginBottom: "14px",
                  background: newGpWarrantyCheckMsg.includes("UNDER WARRANTY") ? "#f0fdf4" : "#fef3c7",
                  border: newGpWarrantyCheckMsg.includes("UNDER WARRANTY")
                    ? "1px solid #bbf7d0"
                    : "1px solid #fde68a",
                  color: newGpWarrantyCheckMsg.includes("UNDER WARRANTY") ? "#15803d" : "#b45309",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "7px",
                }}
              >
                {newGpWarrantyCheckMsg.includes("UNDER WARRANTY") ? (
                  <TechOpsIconCheckCircle size={15} />
                ) : (
                  <TechOpsIconAlertTriangle size={15} />
                )}
                <span>{newGpWarrantyCheckMsg}</span>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "14px", marginBottom: "14px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Purpose / Task Description *
                </label>
                <input
                  type="text"
                  required
                  value={newGpPurpose}
                  onChange={(e) => setNewGpPurpose(e.target.value)}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Gatepass Notes / Remarks
                </label>
                <input
                  type="text"
                  placeholder="Optional dispatch notes"
                  value={newGpNotes}
                  onChange={(e) => setNewGpNotes(e.target.value)}
                  className="form-control"
                />
              </div>
            </div>

            {/* Line Items Section */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <div>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b" }}>
                    Spare Parts to Issue
                  </span>
                  {resolvedMachineId && compatibleParts.length > 0 && (
                    <span
                      style={{
                        marginLeft: "8px",
                        background: "#eff6ff",
                        color: "#1d4ed8",
                        padding: "2px 8px",
                        borderRadius: "10px",
                        fontSize: "11px",
                        fontWeight: 600,
                      }}
                    >
                      {compatibleParts.length} machine-compatible parts highlighted
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary"
                  onClick={() =>
                    setNewGpItems([
                      ...newGpItems,
                      {
                        product_id: null,
                        product_name: "",
                        product_code: "",
                        uom: "NOS",
                        quantity_issued: 1,
                        unit_rate: 0,
                        remarks: "",
                      },
                    ])
                  }
                  style={{ fontSize: "11px" }}
                >
                  + Add Part Row
                </button>
              </div>

              <div className="table-responsive" style={{ border: "1px solid #e2e8f0", borderRadius: "6px" }}>
                <table className="table" style={{ margin: 0, fontSize: "12px" }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th style={{ width: "44%" }}>Master Catalog / Part Name *</th>
                      <th style={{ width: "18%" }}>Code &amp; Stock</th>
                      <th style={{ width: "14%" }}>Qty *</th>
                      <th style={{ width: "16%" }}>Unit Rate (₹)</th>
                      <th style={{ width: "8%" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {newGpItems.map((item, idx) => {
                      const availStock = getAvailableStock(item.product_id, newGpWarehouse.trim());
                      const exceedsStock =
                        availStock !== null && Number(item.quantity_issued) > availStock + 1e-6;
                      return (
                        <tr key={idx}>
                          <td>
                            {lookups.spare_parts.length > 0 && (
                              <select
                                aria-label={`Select Catalog Part ${idx + 1}`}
                                value={item.product_id || ""}
                                onChange={(e) => {
                                  const prodId = e.target.value;
                                  const copy = [...newGpItems];
                                  if (!prodId) {
                                    copy[idx].product_id = null;
                                  } else {
                                    const sp = lookups.spare_parts.find((p) => p.id === prodId);
                                    if (sp) {
                                      copy[idx].product_id = sp.id;
                                      copy[idx].product_name = sp.product_name;
                                      copy[idx].product_code = sp.product_code || "";
                                      copy[idx].uom = sp.uom || "NOS";
                                      copy[idx].unit_rate = Number(sp.unit_rate || 0);
                                    }
                                  }
                                  setNewGpItems(copy);
                                }}
                                className="form-control form-control-sm"
                                style={{ marginBottom: "4px", fontSize: "11px" }}
                              >
                                <option value="">-- Select Spare Part from Master Catalog --</option>
                                {compatibleParts.length > 0 && (
                                  <optgroup label={`Compatible with ${newGpMachineModel || "Selected Machine"}`}>
                                    {compatibleParts.map((sp) => {
                                      const st = newGpWarehouse
                                        ? (sp.stock_by_warehouse?.[newGpWarehouse] ?? 0)
                                        : null;
                                      return (
                                        <option key={sp.id} value={sp.id}>
                                          {sp.product_code ? `[${sp.product_code}] ` : ""}
                                          {sp.product_name}
                                          {st !== null ? ` (Avail: ${st} ${sp.uom})` : ""}
                                        </option>
                                      );
                                    })}
                                  </optgroup>
                                )}
                                <optgroup
                                  label={
                                    compatibleParts.length > 0
                                      ? "Other Spare Parts & Products"
                                      : "Master Spare Parts & Products"
                                  }
                                >
                                  {otherParts.map((sp) => {
                                    const st = newGpWarehouse
                                      ? (sp.stock_by_warehouse?.[newGpWarehouse] ?? 0)
                                      : null;
                                    return (
                                      <option key={sp.id} value={sp.id}>
                                        {sp.product_code ? `[${sp.product_code}] ` : ""}
                                        {sp.product_name}
                                        {st !== null ? ` (Avail: ${st} ${sp.uom})` : ""}
                                      </option>
                                    );
                                  })}
                                </optgroup>
                              </select>
                            )}
                            <input
                              type="text"
                              required
                              aria-label={`Part Name ${idx + 1}`}
                              placeholder="e.g. Heating Element"
                              value={item.product_name}
                              onChange={(e) => {
                                const copy = [...newGpItems];
                                copy[idx].product_name = e.target.value;
                                setNewGpItems(copy);
                              }}
                              className="form-control form-control-sm"
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              placeholder="SP-001"
                              value={item.product_code}
                              onChange={(e) => {
                                const copy = [...newGpItems];
                                copy[idx].product_code = e.target.value;
                                setNewGpItems(copy);
                              }}
                              className="form-control form-control-sm"
                            />
                            {availStock !== null && (
                              <div
                                style={{
                                  marginTop: "4px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  color: exceedsStock ? "#dc2626" : "#15803d",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                {exceedsStock ? (
                                  <TechOpsIconAlertTriangle size={12} />
                                ) : (
                                  <TechOpsIconCheckCircle size={12} />
                                )}
                                <span>
                                  Avail: {availStock} {item.uom}
                                </span>
                              </div>
                            )}
                          </td>
                          <td>
                            <input
                              type="number"
                              required
                              aria-label={`Qty Issued ${idx + 1}`}
                              min="0.1"
                              step="any"
                              value={item.quantity_issued}
                              onChange={(e) => {
                                const copy = [...newGpItems];
                                copy[idx].quantity_issued = parseFloat(e.target.value) || 0;
                                setNewGpItems(copy);
                              }}
                              className="form-control form-control-sm"
                              style={exceedsStock ? { borderColor: "#dc2626", background: "#fef2f2" } : undefined}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={item.unit_rate}
                              onChange={(e) => {
                                const copy = [...newGpItems];
                                copy[idx].unit_rate = parseFloat(e.target.value) || 0;
                                setNewGpItems(copy);
                              }}
                              className="form-control form-control-sm"
                            />
                          </td>
                          <td style={{ textAlign: "center", verticalAlign: "middle" }}>
                            {newGpItems.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setNewGpItems(newGpItems.filter((_, i) => i !== idx))}
                                style={{
                                  background: "none",
                                  border: "none",
                                  color: "#dc2626",
                                  cursor: "pointer",
                                  fontSize: "16px",
                                }}
                              >
                                &times;
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setOpenCreateGpModal(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? "Issuing..." : "Create & Issue Gatepass"}
              </button>
            </div>
          </form>
        </Modal>

        {/* ================================================================= */}
        {/* MODAL: RECORD PARTS RETURN & RECONCILE                           */}
        {/* ================================================================= */}
        <Modal
          open={openReturnModal}
          title={`Record Parts Return: ${selectedGpForReturn?.gatepass_number || ""}`}
          onClose={() => setOpenReturnModal(false)}
          variant="center"
          cardStyle={{ maxWidth: "880px", width: "100%" }}
        >
          <form onSubmit={handleProcessReturn} style={{ padding: "20px" }}>
            <div
              style={{
                background: "#f8fafc",
                padding: "12px",
                borderRadius: "6px",
                marginBottom: "16px",
                display: "flex",
                flexWrap: "wrap",
                gap: "16px",
                fontSize: "12px",
              }}
            >
              <div><b>Technician:</b> {selectedGpForReturn?.technician_name}</div>
              {selectedGpForReturn?.warehouse_name && (
                <div><b>Warehouse:</b> {selectedGpForReturn.warehouse_name}</div>
              )}
              <div><b>Customer:</b> {selectedGpForReturn?.customer_name || "—"}</div>
              <div><b>Serial:</b> {selectedGpForReturn?.machine_serial_number || "—"}</div>
              <div>
                <b>Warranty:</b>{" "}
                {selectedGpForReturn?.is_warranty_service ? (
                  <span style={{ color: "#16a34a", fontWeight: 700 }}>YES (FOC Replacement)</span>
                ) : (
                  <span style={{ color: "#b45309", fontWeight: 700 }}>NO (Chargeable SO required for consumed)</span>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Return Gatepass Number
                </label>
                <input
                  type="text"
                  value={returnGatepassNo}
                  onChange={(e) => setReturnGatepassNo(e.target.value)}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Return Remarks / Condition
                </label>
                <input
                  type="text"
                  placeholder="e.g. Unused items intact in packaging"
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  className="form-control"
                />
              </div>
            </div>

            {/* Reconciliation Items Table */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b", marginBottom: "8px" }}>
                Reconcile Issued Parts: Returned vs Consumed
              </div>

              <div className="table-responsive" style={{ border: "1px solid #e2e8f0", borderRadius: "6px" }}>
                <table className="table" style={{ margin: 0, fontSize: "12px" }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th>Part Name</th>
                      <th style={{ width: "80px", textAlign: "center" }}>Issued</th>
                      <th style={{ width: "110px" }}>Returned</th>
                      <th style={{ width: "110px" }}>Consumed</th>
                      <th style={{ width: "120px" }}>Warranty FOC?</th>
                      <th style={{ width: "155px" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnItemsState.map((row, idx) => {
                      const rowOver =
                        Number(row.quantity_returned) + Number(row.quantity_consumed) >
                        Number(row.quantity_issued) + 1e-6;
                      return (
                        <tr key={row.item_id} style={rowOver ? { background: "#fef2f2" } : undefined}>
                          <td style={{ fontWeight: 600 }}>{row.product_name}</td>
                          <td style={{ textAlign: "center", fontWeight: 700, color: "#2563eb" }}>
                            {row.quantity_issued}
                          </td>
                          <td>
                            <input
                              type="number"
                              aria-label={`Returned Qty ${row.product_name}`}
                              min="0"
                              step="any"
                              value={row.quantity_returned}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                const copy = [...returnItemsState];
                                copy[idx].quantity_returned = val;
                                if (val >= 0 && val <= row.quantity_issued) {
                                  copy[idx].quantity_consumed = Math.max(0, row.quantity_issued - val);
                                }
                                setReturnItemsState(copy);
                              }}
                              className="form-control form-control-sm"
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              aria-label={`Consumed Qty ${row.product_name}`}
                              min="0"
                              step="any"
                              value={row.quantity_consumed}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                const copy = [...returnItemsState];
                                copy[idx].quantity_consumed = val;
                                setReturnItemsState(copy);
                              }}
                              className="form-control form-control-sm"
                            />
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={row.is_warranty_covered}
                              onChange={(e) => {
                                const copy = [...returnItemsState];
                                copy[idx].is_warranty_covered = e.target.checked;
                                setReturnItemsState(copy);
                              }}
                              style={{ width: "16px", height: "16px", cursor: "pointer" }}
                            />
                          </td>
                          <td>
                            <select
                              aria-label={`Return Status ${row.product_name}`}
                              value={row.item_status}
                              onChange={(e) => {
                                const copy = [...returnItemsState];
                                copy[idx].item_status = e.target.value;
                                setReturnItemsState(copy);
                              }}
                              className="form-control form-control-sm"
                            >
                              <option value="RETURNED_GOOD">Returned Good</option>
                              <option value="RETURNED_DEFECTIVE">Returned Defective</option>
                              <option value="CONSUMED_BILLED">Consumed Billed</option>
                              <option value="CONSUMED_WARRANTY">Consumed FOC Warranty</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Validation Error Banner when Returned + Consumed > Issued */}
            {returnValidationError && (
              <div
                role="alert"
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fca5a5",
                  borderRadius: "6px",
                  padding: "10px 14px",
                  fontSize: "12px",
                  color: "#b91c1c",
                  fontWeight: 600,
                  marginBottom: "14px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <TechOpsIconXCircle size={15} />
                <span>{returnValidationError}</span>
              </div>
            )}

            {/* Defective return quarantine notice */}
            {returnItemsState.some((i) => i.quantity_returned > 0 && i.item_status === "RETURNED_DEFECTIVE") && (
              <div
                style={{
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: "6px",
                  padding: "10px 14px",
                  fontSize: "12px",
                  color: "#1e40af",
                  marginBottom: "14px",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                }}
              >
                <div style={{ marginTop: "1px" }}>
                  <TechOpsIconInfo size={15} />
                </div>
                <div>
                  <b>Defective Return Quarantine:</b> Items marked <i>Returned Defective</i> are recorded for inspection and are NOT added back to saleable warehouse stock.
                </div>
              </div>
            )}

            {/* Warning banner about Sales Order requirement */}
            {returnItemsState.some((i) => i.quantity_consumed > 0 && !i.is_warranty_covered) && (
              <div
                style={{
                  background: "#fffbeb",
                  border: "1px solid #fef3c7",
                  borderRadius: "6px",
                  padding: "10px 14px",
                  fontSize: "12px",
                  color: "#92400e",
                  marginBottom: "16px",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                }}
              >
                <div style={{ marginTop: "1px" }}>
                  <TechOpsIconAlertTriangle size={15} />
                </div>
                <div>
                  <b>Sales Order Required:</b> Consumed parts detected that are NOT covered by warranty. A Sales Order must be created and linked before this gatepass is marked RECONCILED/CLOSED.
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setOpenReturnModal(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || Boolean(returnValidationError)}
              >
                {loading ? "Processing..." : "Confirm Return & Reconcile"}
              </button>
            </div>
          </form>
        </Modal>

        {/* ================================================================= */}
        {/* MODAL: LINK SALES ORDER                                          */}
        {/* ================================================================= */}
        <Modal
          open={openLinkSOModal}
          title={`Link Sales Order: ${selectedGpForSO?.gatepass_number || ""}`}
          onClose={() => setOpenLinkSOModal(false)}
          variant="center"
          cardStyle={{ maxWidth: "540px", width: "100%" }}
        >
          <form onSubmit={handleLinkSO} style={{ padding: "20px" }}>
            <p style={{ margin: "0 0 14px", fontSize: "13px", color: "#64748b" }}>
              Select or enter a verified non-cancelled Sales Order number from Sales Process to close spare-parts billing reconciliation.
            </p>

            {canCreateSO && selectedGpForSO && (
              <div style={{ marginBottom: "14px" }}>
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  onClick={() => {
                    setOpenLinkSOModal(false);
                    navigate(`/sales/process/add?gatepass_id=${selectedGpForSO.id}`);
                  }}
                  style={{
                    width: "100%",
                    fontSize: "12px",
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  <TechOpsIconShoppingCart size={14} />
                  <span>Create New Sales Order in Sales Process (Pre-Filled)</span>
                </button>
              </div>
            )}

            {candidateSaleOrdersForLink.length > 0 && (
              <div style={{ marginBottom: "12px" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Select Existing Sales Order
                </label>
                <select
                  aria-label="Select Existing Sales Order"
                  value={
                    candidateSaleOrdersForLink.some((so) => so.order_no === soNumberInput)
                      ? soNumberInput
                      : ""
                  }
                  onChange={(e) => {
                    if (e.target.value) setSoNumberInput(e.target.value);
                  }}
                  className="form-control"
                >
                  <option value="">-- Choose from Sales Orders --</option>
                  {candidateSaleOrdersForLink.map((so) => (
                    <option key={so.id} value={so.order_no}>
                      {so.order_no} — {so.company_name || "Customer"}{" "}
                      {so.total_amount != null ? `(₹${Number(so.total_amount).toLocaleString("en-IN")})` : ""}{" "}
                      [{so.status}]
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ marginBottom: "14px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                Sales Order Number *
              </label>
              <input
                type="text"
                required
                list="tech-ops-so-datalist"
                placeholder="e.g. SO-2026-0842"
                value={soNumberInput}
                onChange={(e) => setSoNumberInput(e.target.value)}
                className="form-control"
              />
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                Notes / Reference
              </label>
              <input
                type="text"
                placeholder="e.g. Invoiced to customer via GST invoice"
                value={soNotesInput}
                onChange={(e) => setSoNotesInput(e.target.value)}
                className="form-control"
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setOpenLinkSOModal(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? "Linking..." : "Link SO & Close Reconciliation"}
              </button>
            </div>
          </form>
        </Modal>

        {/* ================================================================= */}
        {/* DRAWER: DRAFT SALES ORDER PAYLOAD FOR SALESPERSON                */}
        {/* ================================================================= */}
        <SideDrawer
          open={openDraftSODrawer}
          title={`Draft Sales Order (${activeGpForDraft?.gatepass_number || ""})`}
          onClose={() => setOpenDraftSODrawer(false)}
        >
          {draftSOData && (
            <div style={{ padding: "16px" }}>
              <div
                style={{
                  background: "#eff6ff",
                  padding: "12px 16px",
                  borderRadius: "6px",
                  marginBottom: "16px",
                  fontSize: "12px",
                  color: "#1e40af",
                }}
              >
                {draftSOData.message}
              </div>

              <div style={{ marginBottom: "16px", fontSize: "13px", display: "grid", gap: "4px" }}>
                <div><b>Customer:</b> {draftSOData.customer_name}</div>
                {draftSOData.warehouse_name && (
                  <div><b>Dispatch Warehouse:</b> {draftSOData.warehouse_name}</div>
                )}
                {(draftSOData.city || draftSOData.state) && (
                  <div><b>Location:</b> {[draftSOData.city, draftSOData.state].filter(Boolean).join(", ")}</div>
                )}
                {draftSOData.machine_model && (
                  <div><b>Machine Model:</b> {draftSOData.machine_model}</div>
                )}
                {draftSOData.machine_serial_number && (
                  <div><b>Machine Serial:</b> {draftSOData.machine_serial_number}</div>
                )}
                <div><b>Gatepass Ref:</b> {draftSOData.gatepass_number}</div>
              </div>

              {/* Items Table */}
              <div className="table-responsive" style={{ border: "1px solid #e2e8f0", borderRadius: "6px", marginBottom: "16px" }}>
                <table className="table" style={{ margin: 0, fontSize: "12px" }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th>Spare Part</th>
                      <th style={{ width: "60px", textAlign: "center" }}>Qty</th>
                      <th style={{ width: "90px", textAlign: "right" }}>Rate</th>
                      <th style={{ width: "100px", textAlign: "right" }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftSOData.items_to_bill.map((it, i) => (
                      <tr key={i}>
                        <td>
                          <b>{it.product_name}</b>
                          <div style={{ fontSize: "10px", color: "#64748b" }}>
                            {[
                              it.product_code,
                              it.hsn_code ? `HSN: ${it.hsn_code}` : null,
                              it.gst_percent != null ? `GST ${it.gst_percent}%` : null,
                            ]
                              .filter(Boolean)
                              .join(" • ")}
                          </div>
                        </td>
                        <td style={{ textAlign: "center" }}>{it.quantity} {it.uom}</td>
                        <td style={{ textAlign: "right" }}>{formatCurrency(it.unit_rate)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{formatCurrency(it.line_total)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: "#f8fafc", fontWeight: 700 }}>
                      <td colSpan={3}>Estimated Subtotal (excl. GST):</td>
                      <td style={{ textAlign: "right", color: "#2563eb" }}>
                        {formatCurrency(draftSOData.estimated_subtotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Primary Bridge Action: Create Sales Order in Sales Process */}
              {canCreateSO && !draftSOData.so_created && (draftSOData.gatepass_id || activeGpForDraft?.id) && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const gpId = draftSOData.gatepass_id || activeGpForDraft?.id;
                    setOpenDraftSODrawer(false);
                    navigate(`/sales/process/add?gatepass_id=${gpId}`);
                  }}
                  style={{
                    width: "100%",
                    marginBottom: "10px",
                    fontSize: "13px",
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "7px",
                  }}
                >
                  <TechOpsIconShoppingCart size={15} />
                  <span>Create Sales Order in Sales Process</span>
                </button>
              )}

              {/* Copy action */}
              <button
                type="button"
                className="btn btn-outline-primary"
                onClick={() => {
                  const summaryText =
                    `Sales Order Draft for ${draftSOData.customer_name}\nGatepass: ${draftSOData.gatepass_number}\nItems:\n` +
                    draftSOData.items_to_bill
                      .map((it) => `- ${it.product_name}: ${it.quantity} ${it.uom} @ ₹${it.unit_rate} = ₹${it.line_total}`)
                      .join("\n") +
                    `\nEstimated Subtotal: ₹${draftSOData.estimated_subtotal}`;
                  navigator.clipboard.writeText(summaryText);
                  setSuccess("Draft SO copied to clipboard!");
                }}
                style={{
                  width: "100%",
                  marginBottom: "16px",
                  fontSize: "13px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "7px",
                }}
              >
                <TechOpsIconCopy size={14} />
                <span>Copy Draft SO to Clipboard</span>
              </button>

              {/* Direct link SO form */}
              {canLinkSO && (
                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "16px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                    Link Existing Sales Order
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      type="text"
                      list="tech-ops-so-datalist"
                      placeholder="e.g. SO-2026-0842"
                      value={soNumberInput}
                      onChange={(e) => setSoNumberInput(e.target.value)}
                      className="form-control form-control-sm"
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={!soNumberInput.trim()}
                      onClick={async () => {
                        if (!activeGpForDraft || !soNumberInput.trim()) return;
                        try {
                          await apiPost(`/technician-operations/gatepasses/${activeGpForDraft.id}/link-so`, {
                            sales_order_number: soNumberInput.trim(),
                          });
                          setSuccess(`SO '${soNumberInput.trim()}' linked successfully!`);
                          setOpenDraftSODrawer(false);
                          fetchGatepasses();
                          fetchMetrics();
                          fetchLookups();
                        } catch (err: any) {
                          setError(err?.message || "Failed to link SO");
                        }
                      }}
                    >
                      Link
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </SideDrawer>

        {/* ================================================================= */}
        {/* DRAWER: GATEPASS DETAILS                                         */}
        {/* ================================================================= */}
        <SideDrawer
          open={openDetailDrawer}
          title={`Gatepass Details: ${activeGpDetail?.gatepass_number || ""}`}
          onClose={() => setOpenDetailDrawer(false)}
        >
          {activeGpDetail && (
            <div style={{ padding: "16px", fontSize: "13px" }}>
              <div style={{ marginBottom: "12px", display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary"
                  onClick={() => printGatepassSlip(activeGpDetail)}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  <TechOpsIconPrinter size={14} />
                  <span>Print Gatepass Slip</span>
                </button>
              </div>

              <div style={{ marginBottom: "14px", display: "grid", gap: "4px" }}>
                <div><b>Technician:</b> {activeGpDetail.technician_name}</div>
                {activeGpDetail.technician_mobile && <div><b>Mobile:</b> {activeGpDetail.technician_mobile}</div>}
                {activeGpDetail.warehouse_name && (
                  <div>
                    <b>Dispatch Warehouse:</b> {activeGpDetail.warehouse_name}{" "}
                    {activeGpDetail.stock_deducted ? (
                      <span style={{ color: "#15803d", fontSize: "11px", fontWeight: 700 }}>(Stock Tracked)</span>
                    ) : null}
                  </div>
                )}
                <div><b>Customer:</b> {activeGpDetail.customer_name || "—"}</div>
                {activeGpDetail.machine_model && <div><b>Machine Model:</b> {activeGpDetail.machine_model}</div>}
                <div><b>Machine Serial:</b> {activeGpDetail.machine_serial_number || "—"}</div>
                <div><b>Issue Date:</b> {activeGpDetail.issue_date}</div>
                <div><b>Issued By:</b> {activeGpDetail.issued_by_name}</div>
                <div><b>Purpose:</b> {activeGpDetail.purpose}</div>
                <div><b>Status:</b> {activeGpDetail.status}</div>
                {activeGpDetail.return_gatepass_number && (
                  <div><b>Return Gatepass #:</b> {activeGpDetail.return_gatepass_number}</div>
                )}
                {activeGpDetail.so_number && <div><b>Linked SO:</b> {activeGpDetail.so_number}</div>}
              </div>

              <div style={{ fontWeight: 700, marginBottom: "8px", color: "#1e293b" }}>Issued Items</div>
              <div className="table-responsive" style={{ border: "1px solid #e2e8f0", borderRadius: "6px" }}>
                <table className="table" style={{ margin: 0, fontSize: "12px" }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th>Part</th>
                      <th style={{ textAlign: "center" }}>Issued</th>
                      <th style={{ textAlign: "center" }}>Returned</th>
                      <th style={{ textAlign: "center" }}>Consumed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeGpDetail.items.map((it) => (
                      <tr key={it.id}>
                        <td>
                          <b>{it.product_name}</b>
                          {it.product_code && <div style={{ fontSize: "10px", color: "#64748b" }}>{it.product_code}</div>}
                        </td>
                        <td style={{ textAlign: "center" }}>{it.quantity_issued}</td>
                        <td style={{ textAlign: "center", color: "#16a34a" }}>{it.quantity_returned}</td>
                        <td style={{ textAlign: "center", color: "#d97706" }}>{it.quantity_consumed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {activeGpDetail.notes && (
                <div style={{ marginTop: "14px", background: "#f8fafc", padding: "10px", borderRadius: "6px" }}>
                  <b>Notes:</b>
                  <div style={{ whiteSpace: "pre-line", color: "#475569" }}>{activeGpDetail.notes}</div>
                </div>
              )}
            </div>
          )}
        </SideDrawer>

        {/* ================================================================= */}
        {/* MODAL: RECORD WALLET TRANSACTION                                 */}
        {/* ================================================================= */}
        <Modal
          open={openWalletTxnModal}
          title="Record Technician Wallet Transaction"
          onClose={() => setOpenWalletTxnModal(false)}
          variant="center"
          cardStyle={{ maxWidth: "560px", width: "100%" }}
        >
          <form onSubmit={handleRecordWalletTxn} style={{ padding: "20px" }}>
            <div style={{ marginBottom: "12px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                Technician Name *
              </label>
              <input
                type="text"
                required
                list="tech-ops-tech-datalist"
                placeholder="Select or type technician name"
                value={txnTechName}
                onChange={(e) => {
                  const val = e.target.value;
                  setTxnTechName(val);
                  const matched = lookups.technicians.find(
                    (t) => t.name.toLowerCase() === val.trim().toLowerCase()
                  );
                  setTxnTechId(matched?.id || "");
                }}
                className="form-control"
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Transaction Type *
                </label>
                <select
                  value={txnType}
                  onChange={(e) => setTxnType(e.target.value as any)}
                  className="form-control"
                >
                  <option value="COLLECTION">Field Collection (from Customer)</option>
                  <option value="HANDOVER_DEPOSIT">Handover Deposit (to Accounts)</option>
                  <option value="FIELD_EXPENSE">Approved Field Expense</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Amount (₹) *
                </label>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="any"
                  placeholder="e.g. 5000"
                  value={txnAmount}
                  onChange={(e) => setTxnAmount(e.target.value)}
                  className="form-control"
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Payment Mode
                </label>
                <select
                  value={txnPaymentMode}
                  onChange={(e) => setTxnPaymentMode(e.target.value)}
                  className="form-control"
                >
                  <option value="Cash">Cash</option>
                  <option value="UPI / QR">UPI / QR</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Bank Transfer">Bank Transfer / NEFT</option>
                  <option value="Cash Deposit">Cash Deposit</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Reference / UTR / Cheque #
                </label>
                <input
                  type="text"
                  placeholder="Optional reference"
                  value={txnRefNo}
                  onChange={(e) => setTxnRefNo(e.target.value)}
                  className="form-control"
                />
              </div>
            </div>

            {txnType === "COLLECTION" && (
              <div style={{ marginBottom: "12px" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Customer Name
                </label>
                <input
                  type="text"
                  list="tech-ops-company-datalist"
                  placeholder="Select or type customer company"
                  value={txnCustomer}
                  onChange={(e) => setTxnCustomer(e.target.value)}
                  className="form-control"
                />
              </div>
            )}

            {/* Receipt / Voucher Attachment */}
            <div style={{ marginBottom: "12px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                Payment Receipt / Expense Voucher (Image or PDF)
              </label>
              <input
                type="file"
                aria-label="Upload Receipt"
                accept="image/*,.pdf"
                disabled={txnUploadingReceipt}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUploadWalletReceipt(file);
                }}
                className="form-control form-control-sm"
              />
              {txnUploadingReceipt && (
                <div style={{ fontSize: "11px", color: "#2563eb", marginTop: "4px" }}>Uploading receipt...</div>
              )}
              {txnReceiptUrl && (
                <div
                  style={{
                    marginTop: "6px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    borderRadius: "6px",
                    padding: "4px 10px",
                    fontSize: "11px",
                    color: "#166534",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontWeight: 600 }}>
                    <TechOpsIconCheckCircle size={13} />
                    <span>Attached: {txnReceiptFileName || "Receipt"}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setTxnReceiptUrl("");
                      setTxnReceiptFileName("");
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#dc2626",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: "11px",
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                Notes / Remarks
              </label>
              <input
                type="text"
                placeholder="e.g. Collected for service breakdown visit"
                value={txnNotes}
                onChange={(e) => setTxnNotes(e.target.value)}
                className="form-control"
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setOpenWalletTxnModal(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading || txnUploadingReceipt}>
                {loading ? "Recording..." : "Record Transaction"}
              </button>
            </div>
          </form>
        </Modal>

        {/* ================================================================= */}
        {/* MODAL: REGISTER MACHINE WARRANTY                                 */}
        {/* ================================================================= */}
        <Modal
          open={openRegisterWarrModal}
          title="Register Machine Warranty Policy"
          onClose={() => setOpenRegisterWarrModal(false)}
          variant="center"
          cardStyle={{ maxWidth: "620px", width: "100%" }}
        >
          <form onSubmit={handleRegisterWarranty} style={{ padding: "20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Machine Serial Number *
                </label>
                <input
                  type="text"
                  required
                  list="tech-ops-serial-datalist"
                  placeholder="e.g. SN-INHYMA-1001"
                  value={regSerial}
                  onChange={(e) => setRegSerial(e.target.value)}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Machine Model *
                </label>
                <input
                  type="text"
                  required
                  list="tech-ops-machine-datalist"
                  placeholder="Select or type machine model"
                  value={regModel}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRegModel(val);
                    const mc = lookups.machines.find(
                      (m) => m.product_name.toLowerCase() === val.trim().toLowerCase()
                    );
                    setRegProductId(mc?.id || "");
                  }}
                  className="form-control"
                />
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                Customer Company Name *
              </label>
              <input
                type="text"
                required
                list="tech-ops-company-datalist"
                placeholder="Select or type customer company"
                value={regCompany}
                onChange={(e) => {
                  const val = e.target.value;
                  setRegCompany(val);
                  const comp = lookups.companies.find(
                    (c) => c.company_name.toLowerCase() === val.trim().toLowerCase()
                  );
                  setRegCompanyId(comp?.id || "");
                  if (comp) {
                    if (comp.contact_person && !regContactPerson.trim()) setRegContactPerson(comp.contact_person);
                    if (comp.contact_phone && !regContactPhone.trim()) setRegContactPhone(comp.contact_phone);
                    if (comp.city && !regCity.trim()) setRegCity(comp.city);
                  }
                }}
                className="form-control"
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Invoice Number
                </label>
                <input
                  type="text"
                  placeholder="INV-2026-001"
                  value={regInvoiceNo}
                  onChange={(e) => setRegInvoiceNo(e.target.value)}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Invoice Date *
                </label>
                <input
                  type="date"
                  required
                  value={regInvoiceDate}
                  onChange={(e) => setRegInvoiceDate(e.target.value)}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Duration (Months) *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  max="120"
                  value={regMonths}
                  onChange={(e) => setRegMonths(parseInt(e.target.value) || 12)}
                  className="form-control"
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Contact Person
                </label>
                <input
                  type="text"
                  placeholder="e.g. Plant Manager"
                  value={regContactPerson}
                  onChange={(e) => setRegContactPerson(e.target.value)}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Contact Phone
                </label>
                <input
                  type="tel"
                  placeholder="e.g. 9876543210"
                  value={regContactPhone}
                  onChange={(e) => setRegContactPhone(e.target.value)}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Installation City
                </label>
                <input
                  type="text"
                  list="tech-ops-city-datalist"
                  placeholder="e.g. Ahmedabad"
                  value={regCity}
                  onChange={(e) => setRegCity(e.target.value)}
                  className="form-control"
                />
              </div>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                Notes / Warranty Scope
              </label>
              <input
                type="text"
                placeholder="Covers motor, PLC, heating elements"
                value={regNotes}
                onChange={(e) => setRegNotes(e.target.value)}
                className="form-control"
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setOpenRegisterWarrModal(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? "Registering..." : "Register Warranty"}
              </button>
            </div>
          </form>
        </Modal>
      </main>
    </AppShell>
  );
}
