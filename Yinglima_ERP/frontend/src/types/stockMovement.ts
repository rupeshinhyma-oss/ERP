/**
 * Stock Movement & Inventory Ledger Types.
 */

export type StockMovementType = "inward" | "outward";
export type StockMovementSource = "local_purchase" | "sale_process" | "direct";
export type StockMovementStatus = "confirmed" | "cancelled" | "draft";

export interface StockMovementItem {
  id?: string;
  movement_id?: string;
  product_id?: string | null;
  product_name: string;
  product_code?: string | null;
  expected_quantity: number;
  quantity: number;
  damaged_quantity: number;
  accepted_quantity: number;
  unit_rate: number;
  package_details?: string | null;
  remarks?: string | null;
}

export interface StockMovement {
  id: string;
  movement_no: string;
  movement_type: StockMovementType;
  movement_date: string;
  status: StockMovementStatus;
  source_type: StockMovementSource;

  purchase_id?: string | null;
  purchase_invoice_no?: string | null;
  sale_order_id?: string | null;
  sale_order_no?: string | null;

  supplier_id?: string | null;
  supplier_name?: string | null;
  buyer_id?: string | null;
  buyer_name?: string | null;

  reference_no?: string | null;
  warehouse_location?: string | null;
  vehicle_no?: string | null;
  transporter_name?: string | null;
  container_no?: string | null;

  total_quantity: number;
  total_items_count: number;
  remarks?: string | null;

  created_by_name?: string | null;
  created_at: string;
  updated_at: string;

  items: StockMovementItem[];
}

export interface StockMovementCreatePayload {
  movement_type: StockMovementType;
  movement_date: string;
  source_type: StockMovementSource;

  purchase_id?: string | null;
  purchase_invoice_no?: string | null;
  sale_order_id?: string | null;
  sale_order_no?: string | null;

  supplier_id?: string | null;
  supplier_name?: string | null;
  buyer_id?: string | null;
  buyer_name?: string | null;

  reference_no?: string | null;
  warehouse_location?: string | null;
  vehicle_no?: string | null;
  transporter_name?: string | null;
  container_no?: string | null;
  remarks?: string | null;

  items: {
    product_id?: string | null;
    product_name: string;
    product_code?: string | null;
    expected_quantity: number;
    quantity: number;
    damaged_quantity: number;
    accepted_quantity: number;
    unit_rate: number;
    package_details?: string | null;
    remarks?: string | null;
  }[];
}

export interface StockSummaryMetrics {
  total_inward_records: number;
  total_inward_quantity: number;
  total_outward_records: number;
  total_outward_quantity: number;
  total_net_stock_quantity: number;
}

export interface StockBalanceItem {
  product_id?: string | null;
  product_name: string;
  product_code?: string | null;
  total_inward_qty: number;
  total_outward_qty: number;
  current_stock_qty: number;
  last_movement_date?: string | null;
}

export interface ExtractedItem {
  product_id?: string | null;
  product_name: string;
  product_code?: string | null;
  quantity: number;
  unit_rate: number;
  hsn_code?: string | null;
}

export interface PurchaseExtractResponse {
  purchase_id: string;
  invoice_no: string;
  invoice_date: string;
  supplier_id: string;
  supplier_name: string;
  consignment_code?: string | null;
  currency: string;
  total_quantity: number;
  items: ExtractedItem[];
}

export interface SaleOrderExtractResponse {
  sale_order_id: string;
  order_no: string;
  order_date: string;
  buyer_id?: string | null;
  buyer_name: string;
  consignment_code?: string | null;
  container_no?: string | null;
  transporter_name?: string | null;
  lr_no?: string | null;
  currency: string;
  total_quantity: number;
  items: ExtractedItem[];
}

export interface ProductKardexItem {
  movement_no: string;
  movement_type: StockMovementType;
  movement_date: string;
  source_type: StockMovementSource;
  party_name?: string | null;
  reference_no?: string | null;
  warehouse_location?: string | null;
  expected_qty: number;
  received_or_dispatched_qty: number;
  damaged_qty: number;
  net_qty: number;
  qty_in: number;
  qty_out: number;
  balance: number;
  remarks?: string | null;
}
