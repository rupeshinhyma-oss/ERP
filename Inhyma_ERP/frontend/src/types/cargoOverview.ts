/**
 * TypeScript definitions for the Cargo Overview module.
 */

export type CargoStage = "pending" | "cleared" | "all";
export type CargoCurrency = "INR" | "USD";
export type CargoPartyRole =
  | "Supplier"
  | "Cargo Forwarder"
  | "Clearing Agent"
  | "Taxes"
  | "Customer";

export interface CargoFinanceLine {
  id: string;
  role: CargoPartyRole;
  party_name: string;
  doc_no: string;
  payment_terms?: string | null;
  attachment_url?: string | null;
  attachment_name?: string | null;
  currency: CargoCurrency;
  total_amount: number;
  paid_amount: number;
  balance_amount: number;
  due_date?: string | null;
  stage: "pending" | "cleared";
  source_module?: string | null;
  source_record_id?: string | null;
}

export interface CargoDocumentSlot {
  slot_key: string;
  label: string;
  file_url?: string | null;
  filename?: string | null;
  uploaded_at?: string | null;
  uploaded_by?: string | null;
  is_auto_linked: boolean;
}

export interface CargoChecklistItem {
  key: string;
  label: string;
  value: boolean;
}

export interface CargoProductLine {
  sr_no: number;
  product_name: string;
  product_code?: string | null;
  hsn_code?: string | null;
  quantity: number;
  uom: string;
  batch_no?: string | null;
  supplier_name?: string | null;
  source_doc_no?: string | null;
}

export interface CargoOverviewRow {
  consignment_key: string;
  display_title: string;
  invoice_or_order_summary: string;
  batch_no?: string | null;
  supplier_summary: string;
  warehouse?: string | null;
  ordered_date?: string | null;
  etd_origin_date?: string | null;
  eta_port_date?: string | null;
  expected_arrival_date?: string | null;
  forwarder_name?: string | null;
  clearing_agent_name?: string | null;
  cargo_remarks?: string | null;
  source_module?: string | null;
  source_record_id?: string | null;

  pi_file_url?: string | null;
  overall_stage: "pending" | "cleared";
  docs_uploaded_count: number;
  docs_total_count: number;
  checklist_yes_count: number;
  checklist_total_count: number;

  finance_rows: CargoFinanceLine[];
  documents: CargoDocumentSlot[];
  checklist: CargoChecklistItem[];
  products: CargoProductLine[];
}

export interface CargoOverviewListResponse {
  total_consignments: number;
  pending_consignments: number;
  cleared_consignments: number;
  warehouses: string[];
  items: CargoOverviewRow[];
}
