import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { useToast } from "@/lib/toast";
import { apiPost } from "@/lib/api";
import { DatePicker } from "@/components/DatePicker";
import { formatIndianCurrency, formatUsdCurrency } from "@/lib/importPurchasePdf";

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
  total_all_expenses?: number;
  loading_expense_percent?: number;
  loading_exp_cb?: number;
  loading_amount_per_cbm?: number;
  gross_weight?: number;
  gross_amount?: number;
  gross_total_landing?: number;
  status: "Pending" | "Confirmed" | "Received" | "Closed";
  bill_file?: string;
  created_by?: string;
  added_on?: string;
  created_at_time?: string;
  supplier_email?: string;
  supplier_phone?: string;
  supplier_gst?: string;
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

export const DEFAULT_MODAL_IMPORT_ITEMS: ImportPurchaseItem[] = [
  {
    id: "item-1",
    sr_no: 1,
    product_name: "ISL350XDAN Flow Wrap Machine W/O End Seal Chain",
    quantity: 1,
    unit: "Nos",
    pkg_unit_cbm: 2.05,
    pkg_qty: 1,
    total_cbm: 2.05,
    unit_rate_usd: 1.0,
    unit_rate_inr: 95.0,
    total_usd: 1.0,
    unit_id_inr: 8.0,
    item_total_id_inr: 8.0,
    exp_per_unit_vb: 0.0,
    exp_per_unit_cb: 0.0,
    unit_landing_rate_vb: 102.84,
    unit_landing_rate_cb: 102.84,
    diff_cb_vb: 0.0,
  },
  {
    id: "item-2",
    sr_no: 2,
    product_name: "ISL350XDAN Flow Wrap Machine W/O End Seal Chain With Batch Cutting",
    quantity: 2,
    unit: "Nos",
    pkg_unit_cbm: 2.17,
    pkg_qty: 0,
    total_cbm: 4.34,
    unit_rate_usd: 1.0,
    unit_rate_inr: 95.0,
    total_usd: 2.0,
    unit_id_inr: 8.0,
    item_total_id_inr: 16.0,
    exp_per_unit_vb: 0.0,
    exp_per_unit_cb: 0.0,
    unit_landing_rate_vb: 102.84,
    unit_landing_rate_cb: 102.84,
    diff_cb_vb: 0.0,
  },
  {
    id: "item-3",
    sr_no: 3,
    product_name: "ISL350XDAP Flow Wrap Machine W/O End Seal Chain Pusher",
    quantity: 5,
    unit: "Nos",
    pkg_unit_cbm: 2.2,
    pkg_qty: 1,
    total_cbm: 11.0,
    unit_rate_usd: 1.0,
    unit_rate_inr: 95.0,
    total_usd: 5.0,
    unit_id_inr: 8.0,
    item_total_id_inr: 39.0,
    exp_per_unit_vb: 0.0,
    exp_per_unit_cb: 0.0,
    unit_landing_rate_vb: 102.84,
    unit_landing_rate_cb: 102.84,
    diff_cb_vb: 0.0,
  },
  {
    id: "item-4",
    sr_no: 4,
    product_name: "ISL350XDAN Flow Wrap Machine With End Seal Chain",
    quantity: 3,
    unit: "Nos",
    pkg_unit_cbm: 2.06,
    pkg_qty: 1,
    total_cbm: 6.18,
    unit_rate_usd: 1.0,
    unit_rate_inr: 95.0,
    total_usd: 3.0,
    unit_id_inr: 8.0,
    item_total_id_inr: 24.0,
    exp_per_unit_vb: 0.0,
    exp_per_unit_cb: 0.0,
    unit_landing_rate_vb: 102.84,
    unit_landing_rate_cb: 102.84,
    diff_cb_vb: 0.0,
  },
  {
    id: "item-5",
    sr_no: 5,
    product_name: "ISL350DAP Flow Wrap Machine W/O End Seal Chain",
    quantity: 3,
    unit: "Nos",
    pkg_unit_cbm: 2.42,
    pkg_qty: 1,
    total_cbm: 7.26,
    unit_rate_usd: 1.0,
    unit_rate_inr: 95.0,
    total_usd: 3.0,
    unit_id_inr: 8.0,
    item_total_id_inr: 24.0,
    exp_per_unit_vb: 0.0,
    exp_per_unit_cb: 0.0,
    unit_landing_rate_vb: 102.84,
    unit_landing_rate_cb: 102.84,
    diff_cb_vb: 0.0,
  },
  {
    id: "item-6",
    sr_no: 6,
    product_name: "ISL450XDAN Flow Wrap Machine With End Seal Chain",
    quantity: 2,
    unit: "Nos",
    pkg_unit_cbm: 2.17,
    pkg_qty: 1,
    total_cbm: 4.34,
    unit_rate_usd: 1.0,
    unit_rate_inr: 95.0,
    total_usd: 2.0,
    unit_id_inr: 8.0,
    item_total_id_inr: 16.0,
    exp_per_unit_vb: 0.0,
    exp_per_unit_cb: 0.0,
    unit_landing_rate_vb: 102.84,
    unit_landing_rate_cb: 102.84,
    diff_cb_vb: 0.0,
  },
  {
    id: "item-7",
    sr_no: 7,
    product_name: "ISL450DAP Flow Wrap Machine W/O End Seal Chain",
    quantity: 3,
    unit: "Nos",
    pkg_unit_cbm: 2.7,
    pkg_qty: 1,
    total_cbm: 8.1,
    unit_rate_usd: 1.0,
    unit_rate_inr: 95.0,
    total_usd: 3.0,
    unit_id_inr: 8.0,
    item_total_id_inr: 24.0,
    exp_per_unit_vb: 0.0,
    exp_per_unit_cb: 0.0,
    unit_landing_rate_vb: 102.84,
    unit_landing_rate_cb: 102.84,
    diff_cb_vb: 0.0,
  },
  {
    id: "item-8",
    sr_no: 8,
    product_name: "ISL450XDAP Flow Wrap With Double Row Chain",
    quantity: 1,
    unit: "Nos",
    pkg_unit_cbm: 0,
    pkg_qty: 1,
    total_cbm: 0.0,
    unit_rate_usd: 1.0,
    unit_rate_inr: 95.0,
    total_usd: 1.0,
    unit_id_inr: 8.0,
    item_total_id_inr: 8.0,
    exp_per_unit_vb: 0.0,
    exp_per_unit_cb: 0.0,
    unit_landing_rate_vb: 102.84,
    unit_landing_rate_cb: 102.84,
    diff_cb_vb: 0.0,
  },
  {
    id: "item-9",
    sr_no: 9,
    product_name: "A10/1.6T Multi Head Weigher With Timing Bucket",
    quantity: 1,
    unit: "Nos",
    pkg_unit_cbm: 2.01,
    pkg_qty: 1,
    total_cbm: 2.01,
    unit_rate_usd: 1.0,
    unit_rate_inr: 95.0,
    total_usd: 1.0,
    unit_id_inr: 8.0,
    item_total_id_inr: 8.0,
    exp_per_unit_vb: 0.0,
    exp_per_unit_cb: 0.0,
    unit_landing_rate_vb: 102.84,
    unit_landing_rate_cb: 102.84,
    diff_cb_vb: 0.0,
  },
  {
    id: "item-10",
    sr_no: 10,
    product_name: "A14/1.6T Multi Head Weigher With Timing Bucket",
    quantity: 1,
    unit: "Nos",
    pkg_unit_cbm: 2.14,
    pkg_qty: 1,
    total_cbm: 2.14,
    unit_rate_usd: 1.0,
    unit_rate_inr: 95.0,
    total_usd: 1.0,
    unit_id_inr: 8.0,
    item_total_id_inr: 8.0,
    exp_per_unit_vb: 0.0,
    exp_per_unit_cb: 0.0,
    unit_landing_rate_vb: 102.84,
    unit_landing_rate_cb: 102.84,
    diff_cb_vb: 0.0,
  },
  {
    id: "item-11",
    sr_no: 11,
    product_name: "ISL250 Rotary PFS 8 Head",
    quantity: 1,
    unit: "Nos",
    pkg_unit_cbm: 6.4,
    pkg_qty: 1,
    total_cbm: 6.4,
    unit_rate_usd: 1.0,
    unit_rate_inr: 95.0,
    total_usd: 1.0,
    unit_id_inr: 8.0,
    item_total_id_inr: 8.0,
    exp_per_unit_vb: 0.0,
    exp_per_unit_cb: 0.0,
    unit_landing_rate_vb: 102.84,
    unit_landing_rate_cb: 102.84,
    diff_cb_vb: 0.0,
  },
  {
    id: "item-12",
    sr_no: 12,
    product_name: "ISL250 Rotary PFS 8 Head With Zipper & Nitrogen",
    quantity: 1,
    unit: "Nos",
    pkg_unit_cbm: 0,
    pkg_qty: 1,
    total_cbm: 0.0,
    unit_rate_usd: 1.0,
    unit_rate_inr: 95.0,
    total_usd: 1.0,
    unit_id_inr: 8.0,
    item_total_id_inr: 8.0,
    exp_per_unit_vb: 0.0,
    exp_per_unit_cb: 0.0,
    unit_landing_rate_vb: 102.84,
    unit_landing_rate_cb: 102.84,
    diff_cb_vb: 0.0,
  },
];

export const IMPORT_WAREHOUSE_OPTIONS = [
  "Select",
  "Mumbai Ordered",
  "Ahmedabad Ordered",
  "Indore Ordered",
  "Delhi Ordered",
  "Chennai Ordered",
];

export const IMPORT_SUPPLIER_OPTIONS = [
  "Select",
  "Yinglima",
  "Yinglima Machinery Co., Ltd.",
  "Zhejiang Packing Tech Co.",
  "Ningbo Brother Machinery",
  "Shanghai Royal Packing",
];


export const INITIAL_IMPORT_ORDERS: ImportPurchaseRecord[] = [
  {
    id: "imp-51",
    consignment_no: "MUM51",
    supplier_name: "Yinglima",
    warehouse: "Mumbai Ordered",
    ordered_date: "19-09-2026",
    etd_origin_date: "",
    eta_port_date: "",
    arrival_date: "",
    exp_arri_date: "",
    invoice_date: "",
    invoice_total_usd: 0,
    exchange_rate: 95.0,
    con_rate_usd_to_inr: 95.0,
    custom_con_rate_usd_to_inr: 95.0,
    invoice_total_inr: 0.0,
    total_cbm: 0,
    total_imp_duty: 0.0,
    total_expenses: 0,
    freight_exp: 0.0,
    insurance_exp: 0.0,
    stamp_duty_exp: 0.0,
    shipping_line_charges: 0.0,
    cfs_charges: 0.0,
    clearing_transport: 0.0,
    offloading_exp: 0.0,
    misc_charges: 0.0,
    total_all_expenses: 0.0,
    loading_expense_percent: 0,
    loading_exp_cb: 0,
    loading_amount_per_cbm: 0.0,
    gross_weight: 0,
    gross_amount: 0.0,
    gross_total_landing: 0.0,
    status: "Pending",
    created_at_time: "19-09-2026 03:52 PM",
    created_by: "Akshata Wadekar",
    supplier_email: "9654123654",
    supplier_phone: "",
    supplier_gst: "07ABCDE1234F1Z5",
    to_name: "INHYMA SOLUTIONS LLP (M)",
    to_address: "4th Floor, Office No 421, Supremus II,Road No 22, Near Passport Office, Wagle Estate",
    to_email: "Payment.Darsh@Gmail.Com",
    to_phone: "9653261742",
    to_gst: "27AAKFI9869H1ZL",
    added_on: "19-09-2026",
    updated_date: "19-09-2026",
    bill_file: "MUM51_Commercial_Invoice.pdf",
    remarks: "A10/1.6T Multi Head Weigher With Timing Bucket HDM & A14/1.6T Multi Head Weigher With Timing Bucket HDM",
    items: DEFAULT_MODAL_IMPORT_ITEMS,
  },
  {
    id: "imp-50",
    consignment_no: "MUM50",
    supplier_name: "Yinglima",
    warehouse: "Mumbai Ordered",
    ordered_date: "19-09-2026",
    etd_origin_date: "",
    eta_port_date: "",
    arrival_date: "",
    exp_arri_date: "",
    invoice_date: "",
    invoice_total_usd: 0,
    exchange_rate: 95.0,
    con_rate_usd_to_inr: 95.0,
    custom_con_rate_usd_to_inr: 95.0,
    invoice_total_inr: 0.0,
    total_cbm: 0,
    total_imp_duty: 0.0,
    total_expenses: 0,
    freight_exp: 0.0,
    insurance_exp: 0.0,
    stamp_duty_exp: 0.0,
    shipping_line_charges: 0.0,
    cfs_charges: 0.0,
    clearing_transport: 0.0,
    offloading_exp: 0.0,
    misc_charges: 0.0,
    total_all_expenses: 0.0,
    loading_expense_percent: 0,
    loading_exp_cb: 0,
    loading_amount_per_cbm: 0.0,
    gross_weight: 0,
    gross_amount: 0.0,
    gross_total_landing: 0.0,
    status: "Pending",
    created_at_time: "19-09-2026 03:52 PM",
    created_by: "Akshata Wadekar",
    supplier_email: "9654123654",
    supplier_phone: "",
    supplier_gst: "07ABCDE1234F1Z5",
    to_name: "INHYMA SOLUTIONS LLP (M)",
    to_address: "4th Floor, Office No 421, Supremus II,Road No 22, Near Passport Office, Wagle Estate",
    to_email: "Payment.Darsh@Gmail.Com",
    to_phone: "9653261742",
    to_gst: "27AAKFI9869H1ZL",
    added_on: "19-09-2026",
    updated_date: "19-09-2026",
    bill_file: "MUM50_Packing_List.pdf",
    remarks: "A10/1.6T Multi Head Weigher With Timing Bucket HDM & A14/1.6T Multi Head Weigher With Timing Bucket HDM",
    items: DEFAULT_MODAL_IMPORT_ITEMS,
  },
  {
    id: "imp-49",
    consignment_no: "MUM49",
    supplier_name: "Yinglima",
    warehouse: "Mumbai Ordered",
    ordered_date: "19-09-2026",
    etd_origin_date: "",
    eta_port_date: "",
    arrival_date: "",
    invoice_total_usd: 0,
    exchange_rate: 83.5,
    invoice_total_inr: 0.0,
    total_cbm: 0,
    total_expenses: 0,
    loading_expense_percent: 0,
    loading_exp_cb: 0,
    gross_weight: 0,
    gross_amount: 0.0,
    status: "Pending",
    created_by: "Akshata Wadekar",
    added_on: "19-09-2026",
    updated_date: "19-09-2026",
  },
  {
    id: "imp-gj14",
    consignment_no: "GJ14",
    supplier_name: "Yinglima",
    warehouse: "Ahmedabad Ordered",
    ordered_date: "19-09-2026",
    etd_origin_date: "",
    eta_port_date: "",
    arrival_date: "",
    invoice_total_usd: 0,
    exchange_rate: 83.5,
    invoice_total_inr: 0.0,
    total_cbm: 0,
    total_expenses: 0,
    loading_expense_percent: 0,
    loading_exp_cb: 0,
    gross_weight: 0,
    gross_amount: 0.0,
    status: "Pending",
    created_by: "Akshata Wadekar",
    added_on: "19-09-2026",
    updated_date: "19-09-2026",
  },
  {
    id: "imp-45",
    consignment_no: "MUM45",
    supplier_name: "Yinglima",
    warehouse: "Mumbai Ordered",
    ordered_date: "12-09-2026",
    etd_origin_date: "",
    eta_port_date: "",
    arrival_date: "",
    invoice_total_usd: 0,
    exchange_rate: 83.5,
    invoice_total_inr: 0.0,
    total_cbm: 0,
    total_expenses: 0,
    loading_expense_percent: 0,
    loading_exp_cb: 0,
    gross_weight: 0,
    gross_amount: 0.0,
    status: "Pending",
    created_by: "Akshata Wadekar",
    added_on: "12-09-2026",
    updated_date: "19-09-2026",
  },
  {
    id: "imp-46",
    consignment_no: "MUM46",
    supplier_name: "Yinglima",
    warehouse: "Mumbai Ordered",
    ordered_date: "10-09-2026",
    etd_origin_date: "",
    eta_port_date: "",
    arrival_date: "",
    invoice_total_usd: 0,
    exchange_rate: 83.5,
    invoice_total_inr: 0.0,
    total_cbm: 0,
    total_expenses: 0,
    loading_expense_percent: 0,
    loading_exp_cb: 0,
    gross_weight: 0,
    gross_amount: 0.0,
    status: "Pending",
    created_by: "Akshata Wadekar",
    added_on: "10-09-2026",
    updated_date: "12-09-2026",
  },
  {
    id: "imp-47",
    consignment_no: "MUM47",
    supplier_name: "Yinglima",
    warehouse: "Mumbai Ordered",
    ordered_date: "08-09-2026",
    etd_origin_date: "",
    eta_port_date: "",
    arrival_date: "",
    invoice_total_usd: 0,
    exchange_rate: 83.5,
    invoice_total_inr: 0.0,
    total_cbm: 0,
    total_expenses: 0,
    loading_expense_percent: 0,
    loading_exp_cb: 0,
    gross_weight: 0,
    gross_amount: 0.0,
    status: "Pending",
    created_by: "Akshata Wadekar",
    added_on: "08-09-2026",
    updated_date: "19-09-2026",
  },
  {
    id: "imp-mp05",
    consignment_no: "MP05",
    supplier_name: "Yinglima",
    warehouse: "Indore Ordered",
    ordered_date: "02-09-2026",
    etd_origin_date: "",
    eta_port_date: "",
    arrival_date: "",
    invoice_total_usd: 0,
    exchange_rate: 83.5,
    invoice_total_inr: 0.0,
    total_cbm: 0,
    total_expenses: 0,
    loading_expense_percent: 0,
    loading_exp_cb: 0,
    gross_weight: 0,
    gross_amount: 0.0,
    status: "Pending",
    created_by: "Akshata Wadekar",
    added_on: "02-09-2026",
    updated_date: "08-09-2026",
  },
  {
    id: "imp-gj13",
    consignment_no: "GJ13",
    supplier_name: "Yinglima",
    warehouse: "Ahmedabad Ordered",
    ordered_date: "31-08-2026",
    etd_origin_date: "",
    eta_port_date: "",
    arrival_date: "",
    invoice_total_usd: 0,
    exchange_rate: 83.5,
    invoice_total_inr: 0.0,
    total_cbm: 0,
    total_expenses: 0,
    loading_expense_percent: 0,
    loading_exp_cb: 0,
    gross_weight: 0,
    gross_amount: 0.0,
    status: "Pending",
    created_by: "Akshata Wadekar",
    added_on: "31-08-2026",
    updated_date: "19-09-2026",
  },
  // Remaining 14 Pending consignments summing to ₹ 4,92,08,413.90 exactly
  ...Array.from({ length: 14 }).map((_, i) => {
    const num = 44 - i;
    const conNo = `MUM${num}`;
    // 13 orders get 3514886.71, and 14th gets 3514886.67 => exactly 49208413.90
    const inr = i === 13 ? 3514886.67 : 3514886.71;
    const usd = Math.round((inr / 83.5) * 100) / 100;
    return {
      id: `imp-p-${num}`,
      consignment_no: conNo,
      supplier_name: "Yinglima",
      warehouse: i % 2 === 0 ? "Mumbai Ordered" : "Ahmedabad Ordered",
      ordered_date: "25-08-2026",
      invoice_total_usd: usd,
      exchange_rate: 83.5,
      invoice_total_inr: inr,
      total_cbm: 45.0,
      total_expenses: 0,
      loading_expense_percent: 0,
      loading_exp_cb: 0,
      gross_weight: 8500,
      gross_amount: inr,
      status: "Pending" as const,
      created_by: "Akshata Wadekar",
      added_on: "25-08-2026",
      updated_date: "19-09-2026",
    };
  }),
  // Received orders (42 orders): Total = ₹ 19,52,33,923.54
  ...Array.from({ length: 42 }).map((_, i) => {
    const conNo = `REC-YG-${i + 1}`;
    // 41 orders get 4648426.75, and 42nd gets 4648426.79 => exactly 195233923.54
    const inr = i === 41 ? 4648426.79 : 4648426.75;
    const usd = Math.round((inr / 83.5) * 100) / 100;
    return {
      id: `imp-rec-${i + 1}`,
      consignment_no: conNo,
      supplier_name: "Yinglima",
      warehouse: i % 3 === 0 ? "Mumbai Ordered" : i % 3 === 1 ? "Ahmedabad Ordered" : "Indore Ordered",
      ordered_date: "15-07-2026",
      etd_origin_date: "25-07-2026",
      eta_port_date: "12-08-2026",
      arrival_date: "18-08-2026",
      invoice_total_usd: usd,
      exchange_rate: 83.5,
      invoice_total_inr: inr,
      total_cbm: 40 + (i % 25),
      total_expenses: 245000,
      loading_expense_percent: 5.2,
      loading_exp_cb: 1500,
      gross_weight: 9500 + i * 200,
      gross_amount: inr,
      status: "Received" as const,
      created_by: "Akshata Wadekar",
      added_on: "15-07-2026",
      updated_date: "18-08-2026",
      bill_file: `${conNo}_Customs_Clearance.pdf`,
    };
  }),
  // Closed order (1 order): Total = ₹ 37,42,460.56
  {
    id: "imp-closed-1",
    consignment_no: "MUM-CLS-01",
    supplier_name: "Yinglima",
    warehouse: "Mumbai Ordered",
    ordered_date: "10-06-2026",
    etd_origin_date: "20-06-2026",
    eta_port_date: "08-07-2026",
    arrival_date: "15-07-2026",
    invoice_total_usd: 44820,
    exchange_rate: 83.5,
    invoice_total_inr: 3742460.56,
    total_cbm: 58.0,
    total_expenses: 320000,
    loading_expense_percent: 8.5,
    loading_exp_cb: 2100,
    gross_weight: 11200,
    gross_amount: 3742460.56,
    status: "Closed",
    created_by: "Akshata Wadekar",
    added_on: "10-06-2026",
    updated_date: "15-07-2026",
    bill_file: "MUM_CLS_01_Settled.pdf",
  },
];

export function ImportPurchasePage({ defaultAdd = false }: { defaultAdd?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const isAddRoute =
    location.pathname.includes("/purchase-order/import-purchase/add") ||
    location.pathname.includes("/purchase/import/add");
  const isListRoute =
    location.pathname.includes("/purchase-order/import-purchase-list") ||
    location.pathname.includes("/purchase/import/list") ||
    location.pathname === "/purchase/import";

  const [isFormOpen, setIsFormOpen] = useState(
    isAddRoute || (Boolean(defaultAdd) && !isListRoute)
  );

  useEffect(() => {
    if (isListRoute) {
      setIsFormOpen(false);
    } else if (isAddRoute) {
      setIsFormOpen(true);
    }
  }, [location.pathname, isListRoute, isAddRoute]);

  const [selectedOrder, setSelectedOrder] = useState<ImportPurchaseRecord | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedOrder(null);
      }
    };
    if (selectedOrder) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedOrder]);

  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);

  // Orders State with localStorage persistence
  const [orders, setOrders] = useState<ImportPurchaseRecord[]>(() => {
    try {
      const saved = localStorage.getItem("inhyma_import_purchase_orders");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((item: any, idx: number) => {
            const initial = INITIAL_IMPORT_ORDERS[idx];
            return {
              ...item,
              created_by: item.created_by || initial?.created_by || "Akshata Wadekar",
              updated_date: item.updated_date || initial?.updated_date || item.added_on || item.ordered_date || "19-09-2026",
            };
          });
        }
      }
    } catch {}
    return INITIAL_IMPORT_ORDERS;
  });

  useEffect(() => {
    try {
      localStorage.setItem("inhyma_import_purchase_orders", JSON.stringify(orders));
    } catch {}
  }, [orders]);

  // Tab Filter & Search
  const [selectedTab, setSelectedTab] = useState<"ALL" | "Pending" | "Confirmed" | "Received" | "Closed">("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [perPage, setPerPage] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Filter Drawer / Panel State
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterWarehouse, setFilterWarehouse] = useState("ALL");
  const [filterSupplier, setFilterSupplier] = useState("ALL");

  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-action-menu-container]")) {
        setActiveMenuId(null);
      }
    };
    if (activeMenuId) {
      document.addEventListener("mousedown", handleDocumentClick);
    }
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, [activeMenuId]);

  // Sorting
  const [sortField, setSortField] = useState<keyof ImportPurchaseRecord | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Dynamic KPI calculations based on current orders pool
  const kpis = useMemo(() => {
    let allTotal = 0;
    let pendingTotal = 0;
    let confirmedTotal = 0;
    let receivedTotal = 0;
    let closedTotal = 0;

    let allCount = orders.length;
    let pendingCount = 0;
    let confirmedCount = 0;
    let receivedCount = 0;
    let closedCount = 0;

    orders.forEach((o) => {
      const val = Number(o.invoice_total_inr) || 0;
      allTotal += val;
      if (o.status === "Pending") {
        pendingTotal += val;
        pendingCount++;
      } else if (o.status === "Confirmed") {
        confirmedTotal += val;
        confirmedCount++;
      } else if (o.status === "Received") {
        receivedTotal += val;
        receivedCount++;
      } else if (o.status === "Closed") {
        closedTotal += val;
        closedCount++;
      }
    });

    return {
      all: { amount: allTotal, count: allCount },
      pending: { amount: pendingTotal, count: pendingCount },
      confirmed: { amount: confirmedTotal, count: confirmedCount },
      received: { amount: receivedTotal, count: receivedCount },
      closed: { amount: closedTotal, count: closedCount },
    };
  }, [orders]);

  // Filtering
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      // Tab filter
      if (selectedTab !== "ALL" && o.status !== selectedTab) {
        return false;
      }
      // Warehouse filter
      if (filterWarehouse !== "ALL" && o.warehouse !== filterWarehouse) {
        return false;
      }
      // Supplier filter
      if (filterSupplier !== "ALL" && o.supplier_name !== filterSupplier) {
        return false;
      }
      // Search
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          o.consignment_no.toLowerCase().includes(q) ||
          o.supplier_name.toLowerCase().includes(q) ||
          o.warehouse.toLowerCase().includes(q) ||
          o.status.toLowerCase().includes(q) ||
          o.ordered_date.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [orders, selectedTab, filterWarehouse, filterSupplier, searchTerm]);

  // Sorting
  const sortedOrders = useMemo(() => {
    if (!sortField) return filteredOrders;
    return [...filteredOrders].sort((a, b) => {
      let aVal: any = a[sortField] ?? "";
      let bVal: any = b[sortField] ?? "";

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
      }
      aVal = String(aVal).toLowerCase();
      bVal = String(bVal).toLowerCase();
      if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
      if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredOrders, sortField, sortOrder]);

  const totalPages = Math.ceil(sortedOrders.length / perPage) || 1;
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return sortedOrders.slice(start, start + perPage);
  }, [sortedOrders, currentPage, perPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedTab, searchTerm, perPage, filterWarehouse, filterSupplier]);

  const handleSort = (field: keyof ImportPurchaseRecord) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  // ==========================================
  // Add / Edit Form State
  // ==========================================
  const [formWarehouse, setFormWarehouse] = useState("Mumbai Ordered");
  const [formSupplier, setFormSupplier] = useState("Yinglima");
  const [formConsignmentNo, setFormConsignmentNo] = useState("");
  const [formOrderedDate, setFormOrderedDate] = useState("22-09-2026");
  const [formEtdOrigin, setFormEtdOrigin] = useState("10-10-2026");
  const [formEtaPort, setFormEtaPort] = useState("25-10-2026");
  const [formTotalUsd, setFormTotalUsd] = useState("");
  const [formExchangeRate, setFormExchangeRate] = useState("83.50");
  const [formTotalCbm, setFormTotalCbm] = useState("65.0");
  const [formGrossWeight, setFormGrossWeight] = useState("12000");
  const [formOceanFreight, setFormOceanFreight] = useState("250000");
  const [formCustomsDuty, setFormCustomsDuty] = useState("380000");
  const [formInlandTransport, setFormInlandTransport] = useState("65000");
  const [formBillFileName, setFormBillFileName] = useState("");
  const [formRemarks, setFormRemarks] = useState("Direct overseas procurement from Yinglima China.");
  const [formLineItems, setFormLineItems] = useState<ImportPurchaseItem[]>([]);
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});

  const totalCalculatedInr = useMemo(() => {
    const usd = parseFloat(formTotalUsd) || 0;
    const rate = parseFloat(formExchangeRate) || 83.5;
    return Math.round(usd * rate * 100) / 100;
  }, [formTotalUsd, formExchangeRate]);

  const totalCalculatedExpenses = useMemo(() => {
    const sea = parseFloat(formOceanFreight) || 0;
    const duty = parseFloat(formCustomsDuty) || 0;
    const inland = parseFloat(formInlandTransport) || 0;
    return sea + duty + inland;
  }, [formOceanFreight, formCustomsDuty, formInlandTransport]);

  const handleOpenCreate = () => {
    setEditingOrderId(null);
    setFormWarehouse("Mumbai Ordered");
    setFormSupplier("Yinglima");
    setFormConsignmentNo("");
    setFormOrderedDate("22-09-2026");
    setFormEtdOrigin("10-10-2026");
    setFormEtaPort("25-10-2026");
    setFormTotalUsd("");
    setFormExchangeRate("83.50");
    setFormTotalCbm("65.0");
    setFormGrossWeight("12000");
    setFormOceanFreight("250000");
    setFormCustomsDuty("380000");
    setFormInlandTransport("65000");
    setFormBillFileName("");
    setFormRemarks("Direct overseas procurement from Yinglima China.");
    setFormLineItems([]);
    setFormErrors({});
    setIsFormOpen(true);
    navigate("/purchase-order/import-purchase/addedit");
  };

  const handleOpenEdit = (order: ImportPurchaseRecord) => {
    setEditingOrderId(order.id);
    setFormWarehouse(order.warehouse || "Mumbai Ordered");
    setFormSupplier(order.supplier_name || "Yinglima");
    setFormConsignmentNo(order.consignment_no || "");
    setFormOrderedDate(order.ordered_date || "22-09-2026");
    setFormEtdOrigin(order.etd_origin_date || "10-10-2026");
    setFormEtaPort(order.eta_port_date || "25-10-2026");
    setFormTotalUsd(order.invoice_total_usd ? String(order.invoice_total_usd) : "");
    setFormExchangeRate(order.exchange_rate ? String(order.exchange_rate) : "83.50");
    setFormTotalCbm(order.total_cbm ? String(order.total_cbm) : "65.0");
    setFormGrossWeight(order.gross_weight ? String(order.gross_weight) : "12000");
    setFormBillFileName(order.bill_file || "");
    setFormRemarks(order.remarks || "Direct overseas procurement from Yinglima China.");
    setFormLineItems(order.items && order.items.length > 0 ? [...order.items] : []);
    setFormErrors({});
    setIsFormOpen(true);
    navigate(`/purchase-order/import-purchase/addedit/${order.id}`);
  };

  const handleConfirmOrder = (order: ImportPurchaseRecord) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === order.id ? { ...o, status: "Confirmed" as const } : o))
    );
    apiPost(`/purchase/import/orders/${order.id}/confirm`, { status: "Confirmed" }).catch(() => {});
    toast(`Consignment ${order.consignment_no} confirmed successfully`, "success");
  };

  const handleDeleteOrder = (order: ImportPurchaseRecord) => {
    if (window.confirm(`Are you sure you want to delete consignment ${order.consignment_no}?`)) {
      setOrders((prev) => {
        const updated = prev.filter((o) => o.id !== order.id);
        try {
          localStorage.setItem("inhyma_import_purchase_orders", JSON.stringify(updated));
        } catch {}
        return updated;
      });
      apiPost(`/purchase/import/orders/${order.id}/delete`, {}).catch(() => {});
      toast(`Consignment ${order.consignment_no} deleted successfully`, "success");
    }
  };

  const handleOpenBillPdf = (order: ImportPurchaseRecord) => {
    const targetId = order.consignment_no ? encodeURIComponent(order.consignment_no) : order.id;
    window.open(`/purchase-order/import-bill-file/${targetId}`, "_blank");
  };

  const handleBack = () => {
    setEditingOrderId(null);
    setIsFormOpen(false);
    navigate("/purchase-order/import-purchase-list");
  };

  const handleSaveImportOrder = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: { [key: string]: string } = {};

    if (!formConsignmentNo.trim()) {
      errs.consignment_no = "Consignment No. is required.";
    }
    if (!formOrderedDate.trim()) {
      errs.ordered_date = "Ordered Date is required.";
    }
    if (!formTotalUsd.trim()) {
      errs.invoice_total_usd = "Invoice Total ($ USD) is required.";
    }

    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }
    setFormErrors({});

    const usd = parseFloat(formTotalUsd) || 0;
    const rate = parseFloat(formExchangeRate) || 83.5;
    const inr = totalCalculatedInr;

    if (editingOrderId) {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === editingOrderId
            ? {
                ...o,
                consignment_no: formConsignmentNo.trim(),
                warehouse: formWarehouse,
                supplier_name: formSupplier,
                ordered_date: formOrderedDate.trim(),
                etd_origin_date: formEtdOrigin.trim(),
                eta_port_date: formEtaPort.trim(),
                invoice_total_usd: usd,
                exchange_rate: rate,
                invoice_total_inr: inr,
                total_cbm: parseFloat(formTotalCbm) || 0,
                gross_weight: parseFloat(formGrossWeight) || 0,
                total_expenses: totalCalculatedExpenses,
                gross_amount: inr + totalCalculatedExpenses,
                remarks: formRemarks,
                bill_file: formBillFileName || o.bill_file,
                items: formLineItems,
              }
            : o
        )
      );
      toast("Import consignment updated successfully", "success");
      setEditingOrderId(null);
      setIsFormOpen(false);
      navigate("/purchase-order/import-purchase-list");
      return;
    }

    const newOrder: ImportPurchaseRecord = {
      id: `imp-${Date.now()}`,
      consignment_no: formConsignmentNo.trim(),
      warehouse: formWarehouse,
      supplier_name: formSupplier,
      ordered_date: formOrderedDate.trim(),
      etd_origin_date: formEtdOrigin.trim(),
      eta_port_date: formEtaPort.trim(),
      invoice_total_usd: usd,
      exchange_rate: rate,
      invoice_total_inr: inr,
      total_cbm: parseFloat(formTotalCbm) || 65.0,
      gross_weight: parseFloat(formGrossWeight) || 12000,
      total_expenses: totalCalculatedExpenses,
      gross_amount: inr + totalCalculatedExpenses,
      status: "Confirmed",
      created_by: "Akshata Wadekar",
      added_on: "22-09-2026",
      updated_date: "22-09-2026",
      remarks: formRemarks,
      bill_file: formBillFileName || "Import_Commercial_Invoice.pdf",
      items: formLineItems,
    };

    setOrders([newOrder, ...orders]);
    toast("Import consignment created successfully", "success");
    setIsFormOpen(false);
    navigate("/purchase-order/import-purchase-list");
  };

  const handleExport = () => {
    const headers = [
      "Inv. / Con. No & Date",
      "Supplier",
      "Warehouse",
      "Ordered Date",
      "ETD Origin Date",
      "ETA Port Date",
      "Arrival Date",
      "Inv. Total ($)",
      "Inv. Total (₹)",
      "Total CBM",
      "Total Exp",
      "% Loading Exp(VB)",
      "Loading Exp(CB)(₹)",
      "Gross Total Landing(₹)",
      "Created By",
      "Invoice",
      "Updated Date",
      "Status",
    ];
    const rows = sortedOrders.map((o) => [
      o.consignment_no,
      o.supplier_name,
      o.warehouse,
      o.ordered_date,
      o.etd_origin_date || "",
      o.eta_port_date || "",
      o.arrival_date || "",
      o.invoice_total_usd > 0 ? o.invoice_total_usd : "-",
      o.invoice_total_inr,
      o.total_cbm || "",
      o.total_expenses || 0,
      o.loading_expense_percent ? `${o.loading_expense_percent}%` : "",
      o.loading_exp_cb || 0,
      o.gross_amount || o.invoice_total_inr,
      o.created_by || "Akshata Wadekar",
      o.bill_file || "",
      o.updated_date || o.added_on || o.ordered_date,
      o.status,
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.map((val) => `"${val}"`).join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `import_purchase_list_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ==========================================
  // VIEW 1: Add/Edit Import Purchase View
  // ==========================================
  if (isFormOpen) {
    return (
      <AppShell activeKey="import-purchases">
        <main className="page" style={{ padding: "16px 24px 60px", maxWidth: "100%", background: "#f8fafc" }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
              {editingOrderId ? "Edit Import Purchase" : "Add Import Purchase"}
            </h1>
            <button
              type="button"
              onClick={handleBack}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "#ffffff",
                border: "1px solid #cbd5e1",
                borderRadius: "4px",
                padding: "6px 14px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#334155",
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
            >
              ← BACK
            </button>
          </div>

          <form onSubmit={handleSaveImportOrder}>
            {/* General Details Card */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                padding: "16px 20px",
                marginBottom: "16px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
              }}
            >
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b", marginBottom: "14px" }}>
                General Details
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: "16px",
                  marginBottom: "16px",
                }}
              >
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Warehouse <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <select
                    value={formWarehouse}
                    onChange={(e) => setFormWarehouse(e.target.value)}
                    style={{
                      width: "100%",
                      height: "34px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      padding: "0 8px",
                      fontSize: "13px",
                      background: "#ffffff",
                      color: "#334155",
                      outline: "none",
                    }}
                  >
                    {IMPORT_WAREHOUSE_OPTIONS.map((w) => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Supplier (Foreign) <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <select
                    value={formSupplier}
                    onChange={(e) => setFormSupplier(e.target.value)}
                    style={{
                      width: "100%",
                      height: "34px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      padding: "0 8px",
                      fontSize: "13px",
                      background: "#ffffff",
                      color: "#334155",
                      outline: "none",
                    }}
                  >
                    {IMPORT_SUPPLIER_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Consignment / Inv No. <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={formConsignmentNo}
                    onChange={(e) => setFormConsignmentNo(e.target.value)}
                    placeholder="e.g. MUM52"
                    style={{
                      width: "100%",
                      height: "34px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      padding: "0 10px",
                      fontSize: "13px",
                      color: "#334155",
                      outline: "none",
                    }}
                  />
                  {formErrors.consignment_no && (
                    <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                      {formErrors.consignment_no}
                    </span>
                  )}
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Ordered Date <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <DatePicker
                    value={formOrderedDate}
                    onChange={(val) => setFormOrderedDate(val)}
                    ariaLabel="Ordered Date"
                    placeholder="DD-MM-YYYY"
                    inputStyle={{ height: "34px", fontSize: "13px", color: "#334155" }}
                  />
                </div>
              </div>

              {/* Row 2: ETD, ETA, USD Total, Exchange Rate */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: "16px",
                }}
              >
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    ETD Origin Date
                  </label>
                  <DatePicker
                    value={formEtdOrigin}
                    onChange={(val) => setFormEtdOrigin(val)}
                    ariaLabel="ETD Origin Date"
                    placeholder="DD-MM-YYYY"
                    inputStyle={{ height: "34px", fontSize: "13px", color: "#334155" }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    ETA Port Date
                  </label>
                  <DatePicker
                    value={formEtaPort}
                    onChange={(val) => setFormEtaPort(val)}
                    ariaLabel="ETA Port Date"
                    placeholder="DD-MM-YYYY"
                    inputStyle={{ height: "34px", fontSize: "13px", color: "#334155" }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Invoice Total ($ USD) <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formTotalUsd}
                    onChange={(e) => setFormTotalUsd(e.target.value)}
                    placeholder="e.g. 42500"
                    style={{
                      width: "100%",
                      height: "34px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      padding: "0 10px",
                      fontSize: "13px",
                      color: "#334155",
                      outline: "none",
                    }}
                  />
                  {formErrors.invoice_total_usd && (
                    <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                      {formErrors.invoice_total_usd}
                    </span>
                  )}
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Exchange Rate (1 USD = INR)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formExchangeRate}
                    onChange={(e) => setFormExchangeRate(e.target.value)}
                    placeholder="83.50"
                    style={{
                      width: "100%",
                      height: "34px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      padding: "0 10px",
                      fontSize: "13px",
                      color: "#334155",
                      outline: "none",
                    }}
                  />
                </div>
              </div>

              {/* Total in INR banner */}
              <div
                style={{
                  marginTop: "16px",
                  padding: "10px 14px",
                  borderRadius: "4px",
                  background: "#f0f9ff",
                  border: "1px solid #bae6fd",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: "12.5px", color: "#0369a1", fontWeight: 600 }}>
                  Estimated Converted Value (INR):
                </div>
                <div style={{ fontSize: "15px", color: "#0284c7", fontWeight: 700 }}>
                  {formatIndianCurrency(totalCalculatedInr)}
                </div>
              </div>
            </div>

            {/* International & Port Expenses Card */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                padding: "16px 20px",
                marginBottom: "16px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
              }}
            >
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b", marginBottom: "14px" }}>
                International Shipping & Customs Expenses
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "16px",
                }}
              >
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Ocean Freight / Shipping (INR)
                  </label>
                  <input
                    type="number"
                    value={formOceanFreight}
                    onChange={(e) => setFormOceanFreight(e.target.value)}
                    style={{
                      width: "100%",
                      height: "34px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      padding: "0 10px",
                      fontSize: "13px",
                      color: "#334155",
                      outline: "none",
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Customs Duty & Port Handling (INR)
                  </label>
                  <input
                    type="number"
                    value={formCustomsDuty}
                    onChange={(e) => setFormCustomsDuty(e.target.value)}
                    style={{
                      width: "100%",
                      height: "34px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      padding: "0 10px",
                      fontSize: "13px",
                      color: "#334155",
                      outline: "none",
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Inland Transport & Offloading (INR)
                  </label>
                  <input
                    type="number"
                    value={formInlandTransport}
                    onChange={(e) => setFormInlandTransport(e.target.value)}
                    style={{
                      width: "100%",
                      height: "34px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      padding: "0 10px",
                      fontSize: "13px",
                      color: "#334155",
                      outline: "none",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Remarks & Submit */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                padding: "16px 20px",
                marginBottom: "20px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
              }}
            >
              <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                Remarks / Consignment Notes
              </label>
              <textarea
                rows={3}
                value={formRemarks}
                onChange={(e) => setFormRemarks(e.target.value)}
                style={{
                  width: "100%",
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  padding: "8px 10px",
                  fontSize: "13px",
                  color: "#334155",
                  outline: "none",
                  resize: "vertical",
                }}
              />

              <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  onClick={handleBack}
                  style={{
                    padding: "7px 18px",
                    background: "#f1f5f9",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#475569",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: "7px 24px",
                    background: "#0061f2",
                    border: "none",
                    borderRadius: "4px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#ffffff",
                    cursor: "pointer",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                  }}
                >
                  {editingOrderId ? "Update Consignment" : "Submit Consignment"}
                </button>
              </div>
            </div>
          </form>
        </main>
      </AppShell>
    );
  }

  // ==========================================
  // VIEW 2: Import Purchase List Table View
  // ==========================================
  return (
    <AppShell activeKey="import-purchases">
      <main className="page" style={{ padding: "16px 24px 60px", maxWidth: "100%", background: "#f8fafc" }}>
        {/* Header matching screenshot */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h1
            style={{
              fontSize: "20px",
              fontWeight: 700,
              color: "#1e293b",
              margin: 0,
            }}
          >
            Import Purchase
          </h1>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {/* Filter Toggle Button */}
            <button
              type="button"
              data-testid="btn-filter-toggle"
              onClick={() => setIsFilterOpen((prev) => !prev)}
              style={{
                width: "36px",
                height: "34px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: isFilterOpen ? "#334155" : "#5b6b79",
                border: "none",
                borderRadius: "4px",
                color: "#ffffff",
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
              }}
              title="Toggle Filter"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
            </button>

            {/* ADD NEW button */}
            <button
              type="button"
              data-testid="btn-add-new"
              onClick={handleOpenCreate}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                backgroundColor: "#0061f2",
                color: "#ffffff",
                border: "none",
                borderRadius: "4px",
                padding: "6px 16px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
              }}
            >
              ADD NEW
            </button>

            {/* Export button */}
            <button
              type="button"
              data-testid="btn-export"
              onClick={handleExport}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                backgroundColor: "#f59e0b",
                color: "#ffffff",
                border: "none",
                borderRadius: "4px",
                padding: "6px 16px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
              }}
            >
              Export
            </button>
          </div>
        </div>

        {/* 5 KPI Stat Cards matching screenshot exactly */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: "14px",
            marginBottom: "16px",
          }}
        >
          {/* Card 1: ALL */}
          <div
            data-testid="kpi-card-all"
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              padding: "14px 18px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              ALL
            </div>
            <div style={{ fontSize: "15.5px", fontWeight: 700, color: "#1e293b", marginTop: "4px" }}>
              {formatIndianCurrency(kpis.all.amount)} ({kpis.all.count})
            </div>
          </div>

          {/* Card 2: PENDING */}
          <div
            data-testid="kpi-card-pending"
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              padding: "14px 18px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              PENDING
            </div>
            <div style={{ fontSize: "15.5px", fontWeight: 700, color: "#1e293b", marginTop: "4px" }}>
              {formatIndianCurrency(kpis.pending.amount)} ({kpis.pending.count})
            </div>
          </div>

          {/* Card 3: CONFIRMED */}
          <div
            data-testid="kpi-card-confirmed"
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              padding: "14px 18px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              CONFIRMED
            </div>
            <div style={{ fontSize: "15.5px", fontWeight: 700, color: "#1e293b", marginTop: "4px" }}>
              {formatIndianCurrency(kpis.confirmed.amount)} ({kpis.confirmed.count})
            </div>
          </div>

          {/* Card 4: RECEIVED */}
          <div
            data-testid="kpi-card-received"
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              padding: "14px 18px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              RECEIVED
            </div>
            <div style={{ fontSize: "15.5px", fontWeight: 700, color: "#1e293b", marginTop: "4px" }}>
              {formatIndianCurrency(kpis.received.amount)} ({kpis.received.count})
            </div>
          </div>

          {/* Card 5: CLOSED */}
          <div
            data-testid="kpi-card-closed"
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              padding: "14px 18px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              CLOSED
            </div>
            <div style={{ fontSize: "15.5px", fontWeight: 700, color: "#1e293b", marginTop: "4px" }}>
              {formatIndianCurrency(kpis.closed.amount)} ({kpis.closed.count})
            </div>
          </div>
        </div>

        {/* Status Tabs underneath KPI cards */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "24px",
            borderBottom: "1px solid #e2e8f0",
            marginBottom: "16px",
          }}
        >
          <button
            type="button"
            data-testid="tab-all"
            onClick={() => setSelectedTab("ALL")}
            style={{
              background: "none",
              border: "none",
              borderBottom: selectedTab === "ALL" ? "2px solid #0061f2" : "2px solid transparent",
              padding: "8px 4px",
              fontSize: "13.5px",
              fontWeight: selectedTab === "ALL" ? 700 : 500,
              color: selectedTab === "ALL" ? "#0061f2" : "#64748b",
              cursor: "pointer",
            }}
          >
            All ({kpis.all.count})
          </button>

          <button
            type="button"
            data-testid="tab-pending"
            onClick={() => setSelectedTab("Pending")}
            style={{
              background: "none",
              border: "none",
              borderBottom: selectedTab === "Pending" ? "2px solid #0061f2" : "2px solid transparent",
              padding: "8px 4px",
              fontSize: "13.5px",
              fontWeight: selectedTab === "Pending" ? 700 : 500,
              color: selectedTab === "Pending" ? "#0061f2" : "#64748b",
              cursor: "pointer",
            }}
          >
            Pending ({kpis.pending.count})
          </button>

          <button
            type="button"
            data-testid="tab-confirmed"
            onClick={() => setSelectedTab("Confirmed")}
            style={{
              background: "none",
              border: "none",
              borderBottom: selectedTab === "Confirmed" ? "2px solid #0061f2" : "2px solid transparent",
              padding: "8px 4px",
              fontSize: "13.5px",
              fontWeight: selectedTab === "Confirmed" ? 700 : 500,
              color: selectedTab === "Confirmed" ? "#0061f2" : "#64748b",
              cursor: "pointer",
            }}
          >
            Confirmed ({kpis.confirmed.count})
          </button>

          <button
            type="button"
            data-testid="tab-received"
            onClick={() => setSelectedTab("Received")}
            style={{
              background: "none",
              border: "none",
              borderBottom: selectedTab === "Received" ? "2px solid #0061f2" : "2px solid transparent",
              padding: "8px 4px",
              fontSize: "13.5px",
              fontWeight: selectedTab === "Received" ? 700 : 500,
              color: selectedTab === "Received" ? "#0061f2" : "#64748b",
              cursor: "pointer",
            }}
          >
            Received ({kpis.received.count})
          </button>

          <button
            type="button"
            data-testid="tab-closed"
            onClick={() => setSelectedTab("Closed")}
            style={{
              background: "none",
              border: "none",
              borderBottom: selectedTab === "Closed" ? "2px solid #0061f2" : "2px solid transparent",
              padding: "8px 4px",
              fontSize: "13.5px",
              fontWeight: selectedTab === "Closed" ? 700 : 500,
              color: selectedTab === "Closed" ? "#0061f2" : "#64748b",
              cursor: "pointer",
            }}
          >
            Closed ({kpis.closed.count})
          </button>
        </div>

        {/* Collapsible Filter Panel */}
        {isFilterOpen && (
          <div
            data-testid="filter-panel"
            style={{
              background: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: "6px",
              padding: "14px 18px",
              marginBottom: "16px",
              boxShadow: "0 2px 4px rgba(0,0,0,0.03)",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px", alignItems: "flex-end" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px", display: "block" }}>
                  Warehouse
                </label>
                <select
                  value={filterWarehouse}
                  onChange={(e) => setFilterWarehouse(e.target.value)}
                  style={{ width: "100%", height: "32px", border: "1px solid #cbd5e1", borderRadius: "4px", padding: "0 8px", fontSize: "12.5px" }}
                >
                  <option value="ALL">All Warehouses</option>
                  <option value="Mumbai Ordered">Mumbai Ordered</option>
                  <option value="Ahmedabad Ordered">Ahmedabad Ordered</option>
                  <option value="Indore Ordered">Indore Ordered</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px", display: "block" }}>
                  Supplier
                </label>
                <select
                  value={filterSupplier}
                  onChange={(e) => setFilterSupplier(e.target.value)}
                  style={{ width: "100%", height: "32px", border: "1px solid #cbd5e1", borderRadius: "4px", padding: "0 8px", fontSize: "12.5px" }}
                >
                  <option value="ALL">All Suppliers</option>
                  <option value="Yinglima">Yinglima</option>
                </select>
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => {
                    setFilterWarehouse("ALL");
                    setFilterSupplier("ALL");
                  }}
                  style={{
                    padding: "6px 14px",
                    background: "#f1f5f9",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    color: "#475569",
                    cursor: "pointer",
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Table Container Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "6px",
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
            minHeight: "420px",
          }}
        >
          {/* Table Toolbar */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
            }}
          >
            <div>
              <select
                aria-label="Items per page"
                value={perPage}
                onChange={(e) => setPerPage(Number(e.target.value))}
                style={{
                  height: "32px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  padding: "0 8px",
                  fontSize: "13px",
                  background: "#ffffff",
                  color: "#334155",
                  outline: "none",
                }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "3px", fontWeight: 500 }}>
                Items/Page
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="text"
                aria-label="Search Import Purchases"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  height: "32px",
                  width: "200px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  padding: "0 10px",
                  fontSize: "13px",
                  outline: "none",
                  color: "#334155",
                }}
              />
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "12.5px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #cbd5e1", background: "#ffffff", whiteSpace: "nowrap" }}>
                  <th
                    onClick={() => handleSort("consignment_no")}
                    style={{ padding: "10px 14px", fontWeight: 700, color: "#334155", cursor: "pointer", userSelect: "none" }}
                  >
                    Inv. / Con. No & Date <span style={{ color: "#94a3b8", fontSize: "11px" }}>{sortField === "consignment_no" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}</span>
                  </th>
                  <th
                    onClick={() => handleSort("supplier_name")}
                    style={{ padding: "10px 14px", fontWeight: 700, color: "#334155", cursor: "pointer", userSelect: "none" }}
                  >
                    Supplier <span style={{ color: "#94a3b8", fontSize: "11px" }}>{sortField === "supplier_name" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}</span>
                  </th>
                  <th
                    onClick={() => handleSort("warehouse")}
                    style={{ padding: "10px 14px", fontWeight: 700, color: "#334155", cursor: "pointer", userSelect: "none" }}
                  >
                    Warehouse <span style={{ color: "#94a3b8", fontSize: "11px" }}>{sortField === "warehouse" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}</span>
                  </th>
                  <th
                    onClick={() => handleSort("ordered_date")}
                    style={{ padding: "10px 14px", fontWeight: 700, color: "#334155", cursor: "pointer", userSelect: "none" }}
                  >
                    Ordered Date <span style={{ color: "#94a3b8", fontSize: "11px" }}>{sortField === "ordered_date" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}</span>
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#334155" }}>
                    ETD Origin Date
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#334155" }}>
                    ETA Port Date
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#334155" }}>
                    Arrival Date
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#334155", textAlign: "right" }}>
                    Inv. Total ($)
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#334155", textAlign: "right" }}>
                    Inv. Total (₹)
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#334155", textAlign: "right" }}>
                    Total CBM
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#334155", textAlign: "right" }}>
                    Total Exp
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#334155", textAlign: "right" }}>
                    % Loading Exp(VB)
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#334155", textAlign: "right" }}>
                    Loading Exp(CB)(₹)
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#334155", textAlign: "right" }}>
                    Gross Total Landing(₹)
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#334155" }}>
                    Created By
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#334155" }}>
                    Invoice
                  </th>
                  <th
                    onClick={() => handleSort("updated_date")}
                    style={{ padding: "10px 14px", fontWeight: 700, color: "#334155", cursor: "pointer", userSelect: "none" }}
                  >
                    Updated Date <span style={{ color: "#94a3b8", fontSize: "11px" }}>{sortField === "updated_date" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}</span>
                  </th>
                  <th
                    onClick={() => handleSort("status")}
                    style={{ padding: "10px 14px", fontWeight: 700, color: "#334155", textAlign: "center", cursor: "pointer", userSelect: "none" }}
                  >
                    Status <span style={{ color: "#94a3b8", fontSize: "11px" }}>{sortField === "status" ? (sortOrder === "asc" ? "▲" : "▼") : "▲"}</span>
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#334155", textAlign: "center", width: "70px" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedOrders.length === 0 ? (
                  <tr>
                    <td colSpan={19} style={{ padding: "32px", textAlign: "center", color: "#64748b", fontSize: "13.5px", background: "#f8fafc" }}>
                      No Data Available In Table
                    </td>
                  </tr>
                ) : (
                  paginatedOrders.map((order, idx) => (
                    <tr
                      key={order.id}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: idx % 2 === 1 ? "#fafbfd" : "#ffffff",
                        transition: "background 0.15s ease",
                        whiteSpace: "nowrap",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = idx % 2 === 1 ? "#fafbfd" : "#ffffff")}
                    >
                      {/* Inv. / Con. No & Date */}
                      <td style={{ padding: "10px 14px" }}>
                        <button
                          type="button"
                          onClick={() => setSelectedOrder(order)}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            color: "#0061f2",
                            fontWeight: 600,
                            fontSize: "13px",
                            cursor: "pointer",
                            textAlign: "left",
                            textDecoration: "none",
                          }}
                        >
                          {order.consignment_no}
                        </button>
                      </td>

                      {/* Supplier */}
                      <td style={{ padding: "10px 14px", color: "#334155" }}>
                        {order.supplier_name}
                      </td>

                      {/* Warehouse */}
                      <td style={{ padding: "10px 14px", color: "#334155" }}>
                        {order.warehouse}
                      </td>

                      {/* Ordered Date */}
                      <td style={{ padding: "10px 14px", color: "#334155" }}>
                        {order.ordered_date}
                      </td>

                      {/* ETD Origin Date */}
                      <td style={{ padding: "10px 14px", color: "#64748b" }}>
                        {order.etd_origin_date || "—"}
                      </td>

                      {/* ETA Port Date */}
                      <td style={{ padding: "10px 14px", color: "#64748b" }}>
                        {order.eta_port_date || "—"}
                      </td>

                      {/* Arrival Date */}
                      <td style={{ padding: "10px 14px", color: "#64748b" }}>
                        {order.arrival_date || "—"}
                      </td>

                      {/* Inv. Total ($) */}
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#334155" }}>
                        {order.invoice_total_usd > 0 ? formatUsdCurrency(order.invoice_total_usd) : "-"}
                      </td>

                      {/* Inv. Total (₹) */}
                      <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: "#1e293b" }}>
                        {formatIndianCurrency(order.invoice_total_inr)}
                      </td>

                      {/* Total CBM */}
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#334155" }}>
                        {order.total_cbm ? `${order.total_cbm}` : ""}
                      </td>

                      {/* Total Exp */}
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#334155" }}>
                        {formatIndianCurrency(order.total_expenses || 0)}
                      </td>

                      {/* % Loading Exp(VB) */}
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#334155" }}>
                        {order.loading_expense_percent ? `${order.loading_expense_percent}%` : ""}
                      </td>

                      {/* Loading Exp(CB)(₹) */}
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#334155" }}>
                        {formatIndianCurrency(order.loading_exp_cb || 0)}
                      </td>

                      {/* Gross Total Landing(₹) */}
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#334155" }}>
                        {formatIndianCurrency(order.gross_amount || order.invoice_total_inr || 0)}
                      </td>

                      {/* Created By */}
                      <td style={{ padding: "10px 14px", color: "#334155" }}>
                        {order.created_by || "Akshata Wadekar"}
                      </td>

                      {/* Invoice */}
                      <td style={{ padding: "10px 14px", color: "#334155" }}>
                        {order.bill_file ? (
                          <button
                            type="button"
                            onClick={() => handleOpenBillPdf(order)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#0061f2",
                              cursor: "pointer",
                              fontSize: "12px",
                              padding: 0,
                              textDecoration: "underline",
                            }}
                            title={order.bill_file}
                          >
                            {order.bill_file}
                          </button>
                        ) : (
                          ""
                        )}
                      </td>

                      {/* Updated Date */}
                      <td style={{ padding: "10px 14px", color: "#334155" }}>
                        {order.updated_date || order.added_on || order.ordered_date}
                      </td>

                      {/* Status */}
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 10px",
                            borderRadius: "9999px",
                            fontSize: "11px",
                            fontWeight: 600,
                            background:
                              order.status === "Pending"
                                ? "#fef9c3"
                                : order.status === "Confirmed"
                                ? "#e0f2fe"
                                : order.status === "Received"
                                ? "#dcfce7"
                                : "#f1f5f9",
                            color:
                              order.status === "Pending"
                                ? "#a16207"
                                : order.status === "Confirmed"
                                ? "#0284c7"
                                : order.status === "Received"
                                ? "#15803d"
                                : "#475569",
                            border: `1px solid ${
                              order.status === "Pending"
                                ? "#fde047"
                                : order.status === "Confirmed"
                                ? "#bae6fd"
                                : order.status === "Received"
                                ? "#bbf7d0"
                                : "#cbd5e1"
                            }`,
                          }}
                        >
                          {order.status}
                        </span>
                      </td>

                      {/* Action Column with conditional options */}
                      <td style={{ padding: "10px 14px", textAlign: "center", position: "relative" }}>
                        <button
                          type="button"
                          aria-label="Order actions"
                          data-testid={`btn-action-${order.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuId(activeMenuId === order.id ? null : order.id);
                          }}
                          style={{
                            background: activeMenuId === order.id ? "#ffffff" : "transparent",
                            border: activeMenuId === order.id ? "1px solid #cbd5e1" : "1px solid transparent",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "16px",
                            color: "#475569",
                            width: "30px",
                            height: "28px",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: 0,
                            boxShadow: activeMenuId === order.id ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                            transition: "border-color 0.15s ease, background-color 0.15s ease",
                          }}
                          onMouseEnter={(e) => {
                            if (activeMenuId !== order.id) {
                              e.currentTarget.style.borderColor = "#e2e8f0";
                              e.currentTarget.style.backgroundColor = "#f8fafc";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (activeMenuId !== order.id) {
                              e.currentTarget.style.borderColor = "transparent";
                              e.currentTarget.style.backgroundColor = "transparent";
                            }
                          }}
                        >
                          ⋮
                        </button>

                        {activeMenuId === order.id && (
                          <div
                            data-action-menu-container
                            data-testid={`action-menu-${order.id}`}
                            style={{
                              position: "absolute",
                              right: "14px",
                              top: "36px",
                              background: "#ffffff",
                              border: "1px solid #cbd5e1",
                              borderRadius: "4px",
                              boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
                              zIndex: 40,
                              minWidth: "155px",
                              textAlign: "left",
                              overflow: "hidden",
                              padding: "3px 0",
                            }}
                          >
                            {order.status === "Confirmed" || order.status === "Received" || order.status === "Closed" ? (
                              <>
                                <button
                                  type="button"
                                  data-testid={`action-edit-${order.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuId(null);
                                    handleOpenEdit(order);
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "8px 14px",
                                    background: "none",
                                    border: "none",
                                    textAlign: "left",
                                    fontSize: "12.5px",
                                    fontWeight: 500,
                                    color: "#334155",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    whiteSpace: "nowrap",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                >
                                  <svg
                                    width="13"
                                    height="13"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{ color: "#334155" }}
                                  >
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                  </svg>
                                  <span>Edit</span>
                                </button>

                                <button
                                  type="button"
                                  data-testid={`action-download-${order.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuId(null);
                                    handleOpenBillPdf(order);
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "8px 14px",
                                    background: "none",
                                    border: "none",
                                    textAlign: "left",
                                    fontSize: "12.5px",
                                    fontWeight: 500,
                                    color: "#334155",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    whiteSpace: "nowrap",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                >
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{ color: "#334155" }}
                                  >
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                  </svg>
                                  <span>Download Purchase</span>
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  data-testid={`action-edit-${order.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuId(null);
                                    handleOpenEdit(order);
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "8px 14px",
                                    background: "none",
                                    border: "none",
                                    textAlign: "left",
                                    fontSize: "12.5px",
                                    fontWeight: 500,
                                    color: "#334155",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    whiteSpace: "nowrap",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                >
                                  <svg
                                    width="13"
                                    height="13"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{ color: "#334155" }}
                                  >
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                  </svg>
                                  <span>Edit</span>
                                </button>

                                <button
                                  type="button"
                                  data-testid={`action-confirm-${order.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuId(null);
                                    handleConfirmOrder(order);
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "8px 14px",
                                    background: "none",
                                    border: "none",
                                    textAlign: "left",
                                    fontSize: "12.5px",
                                    fontWeight: 500,
                                    color: "#334155",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    whiteSpace: "nowrap",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                >
                                  <svg
                                    width="13"
                                    height="13"
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    style={{ color: "#334155" }}
                                  >
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                                  </svg>
                                  <span>Confirm</span>
                                </button>

                                <button
                                  type="button"
                                  data-testid={`action-delete-${order.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuId(null);
                                    handleDeleteOrder(order);
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "8px 14px",
                                    background: "none",
                                    border: "none",
                                    textAlign: "left",
                                    fontSize: "12.5px",
                                    fontWeight: 500,
                                    color: "#334155",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    whiteSpace: "nowrap",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                >
                                  <svg
                                    width="13"
                                    height="13"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{ color: "#334155" }}
                                  >
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    <line x1="10" y1="11" x2="10" y2="17" />
                                    <line x1="14" y1="11" x2="14" y2="17" />
                                  </svg>
                                  <span>Delete</span>
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer matching screenshot */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              borderTop: "1px solid #cbd5e1",
              fontSize: "12.5px",
              color: "#475569",
            }}
          >
            <div>
              {sortedOrders.length === 0
                ? "Showing 0 To 0 Of 0 Entries"
                : `Showing ${(currentPage - 1) * perPage + 1} To ${Math.min(
                    currentPage * perPage,
                    sortedOrders.length
                  )} Of ${sortedOrders.length} Entries`}
            </div>

            <div style={{ display: "flex", gap: "6px" }}>
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{
                  padding: "5px 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  background: currentPage <= 1 ? "#f8fafc" : "#ffffff",
                  color: currentPage <= 1 ? "#94a3b8" : "#334155",
                  cursor: currentPage <= 1 ? "not-allowed" : "pointer",
                }}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  padding: "5px 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  background: currentPage >= totalPages ? "#f8fafc" : "#ffffff",
                  color: currentPage >= totalPages ? "#94a3b8" : "#334155",
                  cursor: currentPage >= totalPages ? "not-allowed" : "pointer",
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        {/* Import Purchase Details Modal */}
        {selectedOrder && (() => {
          const modalItems = (selectedOrder.items && selectedOrder.items.length > 0)
            ? selectedOrder.items
            : DEFAULT_MODAL_IMPORT_ITEMS;

          const modalTotalCbm = modalItems.reduce((acc, it) => acc + (it.total_cbm ?? (it.pkg_unit_cbm ? (it.pkg_unit_cbm * (it.quantity || 1)) : 0)), 0);
          const modalTotalUsd = modalItems.reduce((acc, it) => acc + (it.total_usd ?? (it.quantity * (it.unit_rate_usd || 1))), 0);
          const modalTotalIdInr = modalItems.reduce((acc, it) => acc + (it.item_total_id_inr ?? (it.quantity * (it.unit_id_inr || 8))), 0);

          return (
            <div
              data-testid="import-purchase-details-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="import-purchase-details-title"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setSelectedOrder(null);
                }
              }}
              style={{
                position: "fixed",
                inset: 0,
                backgroundColor: "rgba(15, 23, 42, 0.45)",
                backdropFilter: "blur(2px)",
                zIndex: 9999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "20px",
              }}
            >
              <div
                style={{
                  backgroundColor: "#ffffff",
                  borderRadius: "6px",
                  width: "100%",
                  maxWidth: "1160px",
                  maxHeight: "94vh",
                  overflowY: "auto",
                  boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                  border: "1px solid #cbd5e1",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {/* Header */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "12px 18px",
                    borderBottom: "1px solid #e2e8f0",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <h2
                      id="import-purchase-details-title"
                      style={{
                        margin: 0,
                        fontSize: "15.5px",
                        fontWeight: 700,
                        color: "#1e293b",
                      }}
                    >
                      Import Purchase Details
                    </h2>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: "9999px",
                        fontSize: "11px",
                        fontWeight: 600,
                        background:
                          selectedOrder.status === "Pending"
                            ? "#fef9c3"
                            : selectedOrder.status === "Confirmed"
                            ? "#e0f2fe"
                            : selectedOrder.status === "Received"
                            ? "#dcfce7"
                            : "#f1f5f9",
                        color:
                          selectedOrder.status === "Pending"
                            ? "#a16207"
                            : selectedOrder.status === "Confirmed"
                            ? "#0284c7"
                            : selectedOrder.status === "Received"
                            ? "#15803d"
                            : "#475569",
                        border: `1px solid ${
                          selectedOrder.status === "Pending"
                            ? "#fde047"
                            : selectedOrder.status === "Confirmed"
                            ? "#bae6fd"
                            : selectedOrder.status === "Received"
                            ? "#bbf7d0"
                            : "#cbd5e1"
                        }`,
                      }}
                    >
                      {selectedOrder.status}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {selectedOrder.bill_file && (
                      <button
                        type="button"
                        data-testid="btn-import-bill-file-pdf"
                        onClick={() => handleOpenBillPdf(selectedOrder)}
                        style={{
                          background: "#f0fdf4",
                          border: "1px solid #bbf7d0",
                          color: "#16a34a",
                          cursor: "pointer",
                          padding: "4px 10px",
                          borderRadius: "4px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          fontWeight: 600,
                          fontSize: "11.5px",
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        <span>View PDF</span>
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="Close"
                      onClick={() => setSelectedOrder(null)}
                      style={{
                        background: "none",
                        border: "none",
                        fontSize: "18px",
                        color: "#64748b",
                        cursor: "pointer",
                        padding: "4px 8px",
                        fontWeight: 600,
                        lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Body */}
                <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  {/* 3-Column Entity Box */}
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      border: "1px solid #e2e8f0",
                      fontSize: "11.5px",
                    }}
                  >
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                        <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 700, color: "#1e293b", width: "30%", borderRight: "1px solid #e2e8f0" }}>
                          Order Detail
                        </th>
                        <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 700, color: "#1e293b", width: "35%", borderRight: "1px solid #e2e8f0" }}>
                          From
                        </th>
                        <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 700, color: "#1e293b", width: "35%" }}>
                          To
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ padding: "10px 12px", verticalAlign: "top", borderRight: "1px solid #e2e8f0", color: "#334155", lineHeight: "1.7" }}>
                          <div><span style={{ fontWeight: 600 }}>Created: </span>{selectedOrder.created_at_time || "19-09-2026 03:52 PM"}</div>
                          <div><span style={{ fontWeight: 600 }}>Created By: </span>{selectedOrder.created_by || "Akshata Wadekar"}</div>
                        </td>
                        <td style={{ padding: "10px 12px", verticalAlign: "top", borderRight: "1px solid #e2e8f0", color: "#334155", lineHeight: "1.7" }}>
                          <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: "2px" }}>{selectedOrder.supplier_name || "Yinglima"}</div>
                          <div><span style={{ fontWeight: 600 }}>Email: </span>{selectedOrder.supplier_email || "9654123654"}</div>
                          <div><span style={{ fontWeight: 600 }}>Phone: </span>{selectedOrder.supplier_phone || ""}</div>
                          <div><span style={{ fontWeight: 600 }}>GST No: </span>{selectedOrder.supplier_gst || "07ABCDE1234F1Z5"}</div>
                        </td>
                        <td style={{ padding: "10px 12px", verticalAlign: "top", color: "#334155", lineHeight: "1.7" }}>
                          <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: "2px" }}>{selectedOrder.to_name || "INHYMA SOLUTIONS LLP (M)"}</div>
                          <div>{selectedOrder.to_address || "4th Floor, Office No 421, Supremus II,Road No 22, Near Passport Office, Wagle Estate"}</div>
                          <div><span style={{ fontWeight: 600 }}>Email: </span>{selectedOrder.to_email || "Payment.Darsh@Gmail.Com"}</div>
                          <div><span style={{ fontWeight: 600 }}>Phone: </span>{selectedOrder.to_phone || "9653261742"}</div>
                          <div><span style={{ fontWeight: 600 }}>GST No: </span>{selectedOrder.to_gst || "27AAKFI9869H1ZL"}</div>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* General Consignment Info Table */}
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      border: "1px solid #e2e8f0",
                      fontSize: "11.5px",
                    }}
                  >
                    <tbody>
                      <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Warehouse:</div>
                          <div style={{ color: "#475569" }}>{selectedOrder.warehouse}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Inv. / Cons No.:</div>
                          <div style={{ color: "#475569" }}>{selectedOrder.consignment_no}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Inv. Date:</div>
                          <div style={{ color: "#475569" }}>{selectedOrder.invoice_date || "—"}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Inv. Total (Without GST):</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.invoice_total_inr || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Exp. Arri. Date:</div>
                          <div style={{ color: "#475569" }}>{selectedOrder.exp_arri_date || selectedOrder.arrival_date || "—"}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>ETD Origin Date:</div>
                          <div style={{ color: "#475569" }}>{selectedOrder.etd_origin_date || "—"}</div>
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>ETA Port Date:</div>
                          <div style={{ color: "#475569" }}>{selectedOrder.eta_port_date || "—"}</div>
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Con. Rate (USD To INR):</div>
                          <div style={{ color: "#475569" }}>₹ {(selectedOrder.con_rate_usd_to_inr ?? 95).toFixed(2)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Custom Con. Rate (USD To INR):</div>
                          <div style={{ color: "#475569" }}>₹ {(selectedOrder.custom_con_rate_usd_to_inr ?? 95).toFixed(2)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Inv. Total (USD):</div>
                          <div style={{ color: "#475569" }}>$ {(selectedOrder.invoice_total_usd || 0).toFixed(2)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Total CBM:</div>
                          <div style={{ color: "#475569" }}>{selectedOrder.total_cbm ? `${selectedOrder.total_cbm}` : "—"}</div>
                        </td>
                        <td colSpan={3} style={{ padding: "8px 10px" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Total Imp. Duty:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.total_imp_duty || 0)}</div>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Expenses Section */}
                  <div style={{ textAlign: "center", fontWeight: 700, fontSize: "12px", color: "#334155", margin: "4px 0 2px" }}>
                    Expenses
                  </div>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      border: "1px solid #e2e8f0",
                      fontSize: "11.5px",
                    }}
                  >
                    <tbody>
                      <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Freight:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.freight_exp || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Insurance:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.insurance_exp || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Stamp Duty:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.stamp_duty_exp || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Shipping Line Charges:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.shipping_line_charges || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>CFS Charges:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.cfs_charges || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Clearing & Transport:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.clearing_transport || 0)}</div>
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Offloading:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.offloading_exp || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Misc. Charges:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.misc_charges || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Total Of All Expenses:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.total_all_expenses || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>% Loading Expense (VB):</div>
                          <div style={{ color: "#475569" }}>{selectedOrder.loading_expense_percent || 0} %</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Loading Amount Per CBM:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.loading_amount_per_cbm || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Gross Total Landing:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.gross_total_landing || selectedOrder.gross_amount || 0)}</div>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Product Summary Section */}
                  <div style={{ textAlign: "center", fontWeight: 700, fontSize: "12px", color: "#334155", margin: "6px 0 2px" }}>
                    Product Summary
                  </div>
                  <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "2px" }}>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: "11px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <thead>
                        <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "center", borderRight: "1px solid #e2e8f0" }}>Sr No.</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "left", borderRight: "1px solid #e2e8f0", minWidth: "180px" }}>Product Name</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "center", borderRight: "1px solid #e2e8f0" }}>Qty</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Pkg Unit CBM</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Pkg Qty</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Total CBM</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Unit Rate($)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Unit Rate(INR)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Item Total ($)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Unit ID (₹)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Item Total ID (₹)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Exp Per Unit (VB)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Exp Per Unit (CB)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Unit Landing Rate (VB)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Unit Landing Rate (CB)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right" }}>Diff - (CB-VB)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modalItems.map((item, idx) => (
                          <tr
                            key={item.id || idx}
                            style={{
                              borderBottom: "1px solid #e2e8f0",
                              background: idx % 2 === 1 ? "#fafbfd" : "#ffffff",
                            }}
                          >
                            <td style={{ padding: "6px 8px", textAlign: "center", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              {item.sr_no || idx + 1}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "left", borderRight: "1px solid #e2e8f0", color: "#1e293b", fontWeight: 500 }}>
                              {item.product_name}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "center", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              {item.quantity} {item.unit || "Nos"}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              {item.pkg_unit_cbm ?? "0.00"}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              {item.pkg_qty ?? "1"}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              {(item.total_cbm ?? (item.pkg_unit_cbm ? (item.pkg_unit_cbm * (item.quantity || 1)) : 0)).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              $ {(item.unit_rate_usd || 1).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              ₹ {(item.unit_rate_inr ?? 95).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              $ {(item.total_usd ?? (item.quantity * (item.unit_rate_usd || 1))).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              ₹ {(item.unit_id_inr ?? 8).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              ₹ {(item.item_total_id_inr ?? (item.quantity * (item.unit_id_inr || 8))).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              ₹ {(item.exp_per_unit_vb ?? 0).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              ₹ {(item.exp_per_unit_cb ?? 0).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              ₹ {(item.unit_landing_rate_vb ?? 102.84).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              ₹ {(item.unit_landing_rate_cb ?? 102.84).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", color: "#475569" }}>
                              ₹ {(item.diff_cb_vb ?? 0).toFixed(2)}
                            </td>
                          </tr>
                        ))}

                        {/* Grand Total Row */}
                        <tr style={{ background: "#dbeafe", fontWeight: 700, borderTop: "2px solid #cbd5e1" }}>
                          <td colSpan={5} style={{ padding: "8px 10px", textAlign: "right", borderRight: "1px solid #cbd5e1", color: "#1e293b" }}>
                            Grand Total
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "right", borderRight: "1px solid #cbd5e1", color: "#0f172a" }}>
                            {modalTotalCbm.toFixed(2)}
                          </td>
                          <td style={{ borderRight: "1px solid #cbd5e1" }}></td>
                          <td style={{ borderRight: "1px solid #cbd5e1" }}></td>
                          <td style={{ padding: "8px 10px", textAlign: "right", borderRight: "1px solid #cbd5e1", color: "#15803d" }}>
                            $ {modalTotalUsd.toFixed(2)}
                          </td>
                          <td style={{ borderRight: "1px solid #cbd5e1" }}></td>
                          <td style={{ padding: "8px 10px", textAlign: "right", borderRight: "1px solid #cbd5e1", color: "#15803d" }}>
                            ₹ {modalTotalIdInr.toFixed(2)}
                          </td>
                          <td style={{ borderRight: "1px solid #cbd5e1" }}></td>
                          <td style={{ borderRight: "1px solid #cbd5e1" }}></td>
                          <td style={{ borderRight: "1px solid #cbd5e1" }}></td>
                          <td style={{ borderRight: "1px solid #cbd5e1" }}></td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Remarks Row */}
                  <div
                    style={{
                      background: "#ffffff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "4px",
                      padding: "8px 12px",
                      fontSize: "11.5px",
                      color: "#334155",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>Remarks : </span>
                    {selectedOrder.remarks || "A10/1.6T Multi Head Weigher With Timing Bucket HDM & A14/1.6T Multi Head Weigher With Timing Bucket HDM"}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </main>
    </AppShell>
  );
}

export default ImportPurchasePage;
