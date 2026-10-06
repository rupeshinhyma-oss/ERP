/**
 * Purchase data layer: record types, API <-> UI mapping and loaders for Local and Import Purchases.
 *
 * Everything shown comes from the API; nothing is built in. Supplier / buyer details printed on documents
 * come from the Supplier master and the warehouse's billing company (the server resolves them).
 */

import { apiGet } from "./api";
import { statusLabel, type WorkflowRules } from "./workflowRules";

export const LOCAL_PURCHASE_API = "/purchase/local-orders";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------------------------ local
export interface LocalPurchaseItem {
  id: string;
  product_name: string;
  product_code?: string | null;
  uom?: string | null;
  quantity: number | "";
  unit_rate: number | "";
  item_total: number;
  expense_per_unit: number;
  unit_landing_rate: number;
  total_landing_rate: number;
}

export interface PurchaseOrderRecord {
  id: string;
  invoice_no: string;
  invoice_date: string;
  supplier_name: string;
  supplier_address?: string;
  supplier_email?: string;
  supplier_phone?: string;
  supplier_gst?: string;
  to_name?: string;
  to_address?: string;
  to_email?: string;
  to_phone?: string;
  to_gst?: string;
  created_at_time?: string;
  warehouse: string;
  basic_amount?: number;
  invoice_total: number;
  bill_file?: string;
  bill_file_url?: string;
  created_by: string;
  added_on: string;
  /** Display label of the status (from the DB rules). Use `status_key` for logic. */
  status: string;
  status_key: string;
  packing_forwarding?: number;
  transport_expense?: number;
  offloading_expense?: number;
  total_expenses?: number;
  loading_expense_percent?: number;
  remarks?: string | null;
  items?: LocalPurchaseItem[];
}

export function mapLocalPurchase(p: any, rules: WorkflowRules): PurchaseOrderRecord {
  return {
    id: p.id,
    invoice_no: p.invoice_no,
    invoice_date: p.invoice_date,
    supplier_name: p.supplier_name,
    supplier_address: p.supplier_address,
    supplier_email: p.supplier_email,
    supplier_phone: p.supplier_phone,
    supplier_gst: p.supplier_gst,
    to_name: p.to_name,
    to_address: p.to_address,
    to_email: p.to_email,
    to_phone: p.to_phone,
    to_gst: p.to_gst,
    created_at_time: p.created_date,
    warehouse: p.warehouse,
    basic_amount: p.invoice_value_ex_gst,
    invoice_total: p.invoice_value_inc_gst,
    bill_file: p.bill_file_name || undefined,
    bill_file_url: p.bill_file_url || undefined,
    created_by: p.created_by,
    added_on: p.created_date,
    status: statusLabel(rules, p.status),
    status_key: p.status,
    packing_forwarding: p.packing_forwarding,
    transport_expense: p.transport,
    offloading_expense: p.offloading,
    total_expenses: p.total_expenses,
    loading_expense_percent: p.loading_percent,
    remarks: p.remarks,
    items: (p.items || []).map((i: any) => ({
      id: i.id,
      product_name: i.product_name,
      product_code: i.product_code,
      uom: i.uom,
      quantity: i.quantity,
      unit_rate: i.unit_rate,
      item_total: i.item_total,
      expense_per_unit: i.expense_per_unit,
      unit_landing_rate: i.unit_landing_value,
      total_landing_rate: round2(Number(i.quantity) * Number(i.unit_landing_value)),
    })),
  };
}

export interface PurchaseList<T> {
  orders: T[];
  rules: WorkflowRules;
  counts: Record<string, { count: number }>;
  total: number;
}

/** Loads the most recent purchases (the API caps one page at 500 rows). */
export async function fetchLocalPurchases(): Promise<PurchaseList<PurchaseOrderRecord>> {
  const res = await apiGet<{ items: any[]; tab_counts: Record<string, { count: number }>; status_rules: WorkflowRules }>(
    `${LOCAL_PURCHASE_API}?limit=500`
  );
  const data = res.data;
  const rules = data?.status_rules || {};
  return {
    orders: (data?.items || []).map((p) => mapLocalPurchase(p, rules)),
    rules,
    counts: data?.tab_counts || {},
    total: (res as any).meta?.total ?? data?.items?.length ?? 0,
  };
}

export interface LocalFormValues {
  supplier_name: string;
  warehouse: string;
  invoice_no: string;
  invoice_date: string;
  basic_amount: string;
  invoice_total: string;
  packing_forwarding: string;
  transport: string;
  offloading: string;
  remarks: string;
  items: { product_name: string; product_code?: string | null; uom?: string | null; quantity: number | ""; unit_rate: number | "" }[];
}

const num = (v: string | number | "") => (v === "" ? 0 : Number(v) || 0);

/** The request body for create / edit. Totals and landing rates are calculated by the server. */
export function buildLocalPayload(v: LocalFormValues) {
  return {
    supplier_name: v.supplier_name,
    warehouse: v.warehouse,
    invoice_no: v.invoice_no.trim(),
    invoice_date: v.invoice_date.trim(),
    invoice_value_ex_gst: num(v.basic_amount),
    invoice_value_inc_gst: num(v.invoice_total),
    packing_forwarding: num(v.packing_forwarding),
    transport: num(v.transport),
    offloading: num(v.offloading),
    remarks: v.remarks.trim() || undefined,
    items: v.items.map((i) => ({
      product_name: i.product_name.trim(),
      product_code: i.product_code || undefined,
      uom: i.uom || undefined,
      quantity: num(i.quantity),
      unit_rate: num(i.unit_rate),
    })),
  };
}

// ----------------------------------------------------------------------------------- import
export const IMPORT_PURCHASE_API = "/purchase/import-orders";

export interface ImportPurchaseItem {
  id: string;
  sr_no?: number;
  product_name: string;
  quantity: number;
  unit?: string;
  pkg_unit_cbm?: number;
  pkg_qty?: number;
  total_cbm?: number;
  unit_rate_usd: number;
  unit_rate_inr?: number;
  total_usd: number;
  duty_percent?: number;
  unit_id_inr?: number;
  item_total_id_inr?: number;
  exp_per_unit_vb?: number;
  exp_per_unit_cb?: number;
  unit_landing_rate_vb?: number;
  unit_landing_rate_cb?: number;
  diff_cb_vb?: number;
  unit_landing_inr?: number;
  total_landing_inr?: number;
}

export interface ImportPurchaseRecord {
  id: string;
  consignment_no: string;
  supplier_name: string;
  warehouse: string;
  ordered_date: string;
  etd_origin_date?: string;
  eta_port_date?: string;
  arrival_date?: string;
  exp_arri_date?: string;
  invoice_total_usd: number;
  exchange_rate: number;
  con_rate_usd_to_inr?: number;
  custom_con_rate_usd_to_inr?: number;
  total_imp_duty?: number;
  invoice_total_inr: number;
  total_cbm?: number;
  total_expenses?: number;
  freight_exp?: number;
  insurance_exp?: number;
  stamp_duty_exp?: number;
  shipping_line_charges?: number;
  cfs_charges?: number;
  clearing_transport?: number;
  offloading_exp?: number;
  misc_charges?: number;
  misc_remarks?: string;
  total_all_expenses?: number;
  loading_expense_percent?: number;
  loading_amount_per_cbm?: number;
  gross_total_landing?: number;
  /** Display label of the status (from the DB rules). Use `status_key` for logic. */
  status: string;
  status_key: string;
  bill_file?: string;
  bill_file_url?: string;
  created_by?: string;
  added_on?: string;
  created_at_time?: string;
  supplier_email?: string;
  supplier_phone?: string;
  supplier_gst?: string;
  supplier_address?: string;
  to_name?: string;
  to_address?: string;
  to_email?: string;
  to_phone?: string;
  to_gst?: string;
  updated_date?: string;
  invoice_no?: string;
  invoice_date?: string;
  remarks?: string;
  items?: ImportPurchaseItem[];
}

export function mapImportPurchase(p: any, rules: WorkflowRules): ImportPurchaseRecord {
  return {
    id: p.id,
    consignment_no: p.consignment_no,
    invoice_no: p.consignment_no,
    supplier_name: p.supplier_name,
    warehouse: p.warehouse,
    ordered_date: p.ordered_date,
    etd_origin_date: p.etd_origin_date || undefined,
    eta_port_date: p.eta_port_date || undefined,
    arrival_date: p.expected_arrival_date || undefined,
    exp_arri_date: p.expected_arrival_date || undefined,
    invoice_date: p.invoice_date || undefined,
    invoice_total_usd: p.invoice_total_usd,
    exchange_rate: p.conversion_rate,
    con_rate_usd_to_inr: p.conversion_rate,
    custom_con_rate_usd_to_inr: p.customs_conversion_rate,
    total_imp_duty: p.total_import_duty,
    invoice_total_inr: p.invoice_total_inr,
    total_cbm: p.total_cbm,
    total_expenses: p.total_expenses,
    total_all_expenses: p.total_expenses,
    freight_exp: p.freight,
    insurance_exp: p.insurance,
    stamp_duty_exp: p.stamp_duty,
    shipping_line_charges: p.shipping_line_charges,
    cfs_charges: p.cfs_charges,
    clearing_transport: p.clearing_transport,
    offloading_exp: p.offloading,
    misc_charges: p.misc_charges,
    misc_remarks: p.misc_remarks || undefined,
    loading_expense_percent: p.loading_percent_vb,
    loading_amount_per_cbm: p.loading_amount_per_cbm,
    gross_total_landing: p.gross_total_landing,
    status: statusLabel(rules, p.status),
    status_key: p.status,
    bill_file: p.bill_file_name || undefined,
    bill_file_url: p.bill_file_url || undefined,
    created_by: p.created_by,
    added_on: p.created_date,
    created_at_time: p.created_date,
    updated_date: p.updated_date,
    supplier_address: p.supplier_address,
    supplier_email: p.supplier_email,
    supplier_phone: p.supplier_phone,
    supplier_gst: p.supplier_gst,
    to_name: p.to_name,
    to_address: p.to_address,
    to_email: p.to_email,
    to_phone: p.to_phone,
    to_gst: p.to_gst,
    remarks: p.remarks || undefined,
    items: (p.items || []).map((i: any, idx: number) => mapImportItem(i, idx)),
  };
}

export function mapImportItem(i: any, idx = 0): ImportPurchaseItem {
  return {
    id: i.id || `item-${idx}`,
    sr_no: idx + 1,
    product_name: i.product_name,
    quantity: i.quantity,
    unit: i.uom || undefined,
    pkg_unit_cbm: i.pkg_unit_cbm,
    pkg_qty: i.pkg_qty,
    total_cbm: i.item_total_cbm,
    unit_rate_usd: i.unit_rate_usd,
    unit_rate_inr: i.unit_rate_inr,
    total_usd: i.item_total_usd,
    duty_percent: i.duty_percent,
    unit_id_inr: i.unit_import_duty,
    item_total_id_inr: i.item_total_duty,
    exp_per_unit_vb: i.exp_per_unit_vb,
    exp_per_unit_cb: i.exp_per_unit_cb,
    unit_landing_rate_vb: i.unit_landing_vb,
    unit_landing_rate_cb: i.unit_landing_cb,
    diff_cb_vb: i.landing_diff,
    unit_landing_inr: i.unit_landing_vb,
    total_landing_inr: round2(Number(i.quantity) * Number(i.unit_landing_vb)),
  };
}

export async function fetchImportPurchases(): Promise<PurchaseList<ImportPurchaseRecord>> {
  const res = await apiGet<{ items: any[]; tab_counts: Record<string, { count: number }>; status_rules: WorkflowRules }>(
    `${IMPORT_PURCHASE_API}?limit=500`
  );
  const data = res.data;
  const rules = data?.status_rules || {};
  return {
    orders: (data?.items || []).map((p) => mapImportPurchase(p, rules)),
    rules,
    counts: data?.tab_counts || {},
    total: (res as any).meta?.total ?? data?.items?.length ?? 0,
  };
}

export interface ImportFormValues {
  consignment_no: string;
  supplier_name: string;
  warehouse: string;
  ordered_date: string;
  invoice_date: string;
  etd_origin_date: string;
  eta_port_date: string;
  expected_arrival_date: string;
  conversion_rate: string;
  customs_conversion_rate: string;
  invoice_total_usd: string;
  total_cbm: string;
  total_import_duty: string;
  freight: string;
  insurance: string;
  stamp_duty: string;
  shipping_line_charges: string;
  cfs_charges: string;
  clearing_transport: string;
  offloading: string;
  misc_charges: string;
  misc_remarks: string;
  remarks: string;
  items: { product_name: string; quantity: number | string; unit_rate_usd: number | string }[];
}

const blankToUndefined = (v: string) => (v.trim() ? v.trim() : undefined);

/** The numbers the server needs to price the consignment (also used for the live preview). */
export function buildImportCostInputs(v: ImportFormValues) {
  return {
    conversion_rate: num(v.conversion_rate),
    customs_conversion_rate: num(v.customs_conversion_rate),
    invoice_total_usd: num(v.invoice_total_usd),
    total_cbm: num(v.total_cbm),
    total_import_duty: num(v.total_import_duty),
    freight: num(v.freight),
    insurance: num(v.insurance),
    stamp_duty: num(v.stamp_duty),
    shipping_line_charges: num(v.shipping_line_charges),
    cfs_charges: num(v.cfs_charges),
    clearing_transport: num(v.clearing_transport),
    offloading: num(v.offloading),
    misc_charges: num(v.misc_charges),
    items: v.items
      .filter((i) => i.product_name.trim())
      .map((i) => ({ product_name: i.product_name.trim(), quantity: num(i.quantity as any), unit_rate_usd: num(i.unit_rate_usd as any) })),
  };
}

/** The full request body for create / edit. Every calculated figure is left to the server. */
export function buildImportPayload(v: ImportFormValues) {
  return {
    consignment_no: v.consignment_no.trim(),
    supplier_name: v.supplier_name,
    warehouse: v.warehouse,
    ordered_date: v.ordered_date.trim(),
    invoice_date: blankToUndefined(v.invoice_date),
    etd_origin_date: blankToUndefined(v.etd_origin_date),
    eta_port_date: blankToUndefined(v.eta_port_date),
    expected_arrival_date: blankToUndefined(v.expected_arrival_date),
    misc_remarks: blankToUndefined(v.misc_remarks),
    remarks: blankToUndefined(v.remarks),
    ...buildImportCostInputs(v),
  };
}

export interface ImportPreview {
  invoice_total_inr: number;
  total_expenses: number;
  gross_total_landing: number;
  loading_percent_vb: number;
  loading_amount_per_cbm: number;
  sum_cbm: number;
  sum_usd: number;
  sum_duty: number;
  items: ImportPurchaseItem[];
}

/** Asks the server to run the landing-cost formulas on the values typed so far (nothing is saved). */
export async function previewImport(v: ImportFormValues): Promise<ImportPreview> {
  const { apiPost } = await import("./api");
  const res = await apiPost<any>(`${IMPORT_PURCHASE_API}/preview`, buildImportCostInputs(v));
  const d = res.data;
  return { ...d, items: (d.items || []).map((i: any, idx: number) => mapImportItem(i, idx)) };
}