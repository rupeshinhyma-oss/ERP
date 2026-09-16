/**
 * Local Purchase TypeScript Interfaces.
 */

export interface LocalPurchaseItem {
  id?: string;
  purchase_id?: string;
  product_id?: string | null;
  product_name: string;
  product_code?: string | null;
  hsn_code?: string | null;
  quantity: number;
  unit_rate: number; // in RMB
  vat_rate: number; // default 13%
  item_total: number; // Basic total (qty * unit_rate)
  vat_amount: number;
  expense_per_unit: number; // Value-Based allocated expense per unit
  unit_landing_rate: number; // unit_rate + expense_per_unit
  total_landing_rate: number; // quantity * unit_landing_rate
  planning_sheet_name?: string;
  planning_row_id?: string;
  created_at?: string;
}

export interface LocalPurchaseSummary {
  id: string;
  organization_id: string;
  organization_name: string;
  branch_id: string;
  branch_name: string;
  supplier_id: string;
  supplier_name: string;
  invoice_no: string;
  invoice_date: string;
  currency: string;
  invoice_total_value: number;
  bill_file_url?: string | null;
  total_expenses: number;
  loading_expense_pct: number;
  items_total_basic: number;
  items_total_vat: number;
  items_total_landing: number;
  total_quantity: number;
  items_count: number;
  remarks?: string | null;
  status: "Pending" | "Confirmed" | "Cancelled" | string;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocalPurchaseDetail extends LocalPurchaseSummary {
  packing_forwarding: number;
  transport_expense: number;
  offloading_expense: number;
  other_expense: number;
  items: LocalPurchaseItem[];
}

export interface LocalPurchasePayload {
  organization_id: string;
  organization_name: string;
  branch_id: string;
  branch_name: string;
  supplier_id: string;
  supplier_name: string;
  invoice_no: string;
  invoice_date: string;
  currency: string;
  invoice_total_value: number;
  bill_file_url?: string | null;
  packing_forwarding: number;
  transport_expense: number;
  offloading_expense: number;
  other_expense: number;
  remarks?: string | null;
  status: string;
  items: Array<{
    id?: string;
    product_id?: string | null;
    product_name: string;
    product_code?: string | null;
    hsn_code?: string | null;
    quantity: number;
    unit_rate: number;
    vat_rate: number;
  }>;
}

export interface BillExtractedItem {
  product_name: string;
  product_code?: string | null;
  hsn_code?: string | null;
  quantity: number;
  unit_rate: number;
  vat_rate: number;
  item_total: number;
  matched_product_id?: string | null;
}

export interface BillExtractionResult {
  supplier_name?: string | null;
  supplier_id?: string | null;
  invoice_no?: string | null;
  invoice_date?: string | null;
  currency?: string;
  invoice_total_value?: number | null;
  items: BillExtractedItem[];
  confidence?: number;
  notes?: string | null;
}
