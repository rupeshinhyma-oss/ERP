/**
 * TypeScript type definitions for the Sale Process module.
 */

export type SaleOrderStatus =
  | 'pending'
  | 'sales_confirmed'
  | 'admin_approved'
  | 'dispatched'
  | 'lr'
  | 'cancelled';

export interface SaleOrderItem {
  id?: string;
  order_id?: string;
  product_id: string | null;
  product_name: string;
  product_code?: string | null;
  hsn_code?: string | null;
  quantity: number;
  unit_rate: number;
  tax_percent: number;
  tax_amount: number;
  item_total: number;
  planning_row_id?: string | null;
  remarks?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SaleOrder {
  id: string;
  order_no: string;
  organization_id: string;
  organization_name: string;
  buyer_id: string;
  buyer_name: string;
  buyer_branch_id?: string | null;
  buyer_branch_name?: string | null;

  consignment_code?: string | null;
  planning_sheet_id?: string | null;
  planning_column_id?: string | null;

  order_date: string;
  delivery_date?: string | null;
  currency: string;
  status: SaleOrderStatus | string;

  total_basic: number;
  total_tax: number;
  total_amount: number;
  total_quantity: number;
  item_count: number;

  container_no?: string | null;
  bl_no?: string | null;
  lr_no?: string | null;
  transporter_name?: string | null;
  port_of_loading?: string | null;
  port_of_discharge?: string | null;
  remarks?: string | null;

  created_by_name?: string | null;
  created_at: string;
  updated_at: string;

  items?: SaleOrderItem[];
}

export interface MetricItem {
  count: number;
  amount: number;
}

export interface SaleSummaryMetrics {
  all: MetricItem;
  pending: MetricItem;
  sales_confirmed: MetricItem;
  admin_approved: MetricItem;
  dispatched: MetricItem;
  lr: MetricItem;
  cancelled: MetricItem;
  currency: string;
}

export interface PlanningConsignmentColumn {
  sheet_id: string;
  sheet_name: string;
  column_id: string;
  column_name: string;
  code: string;
  item_count: number;
  total_quantity: number;
  has_remarks_column: boolean;
}

export interface ExtractedConsignmentItem {
  product_id: string | null;
  product_name: string;
  product_code?: string | null;
  hsn_code?: string | null;
  quantity: number;
  unit_rate: number;
  vat_rate: number;
  planning_row_id?: string | null;
  remarks?: string | null;
}

export interface PlanningConsignmentItemsResponse {
  sheet_id: string;
  sheet_name: string;
  column_id: string;
  column_name: string;
  consignment_code: string;
  count: number;
  total_quantity: number;
  items: ExtractedConsignmentItem[];
}

export interface SaleOrderFormData {
  organization_id: string;
  organization_name: string;
  buyer_id: string;
  buyer_name: string;
  buyer_branch_id?: string | null;
  buyer_branch_name?: string | null;

  consignment_code?: string | null;
  planning_sheet_id?: string | null;
  planning_column_id?: string | null;

  order_date: string;
  delivery_date?: string | null;
  currency: string;
  status: SaleOrderStatus | string;

  container_no?: string | null;
  bl_no?: string | null;
  lr_no?: string | null;
  transporter_name?: string | null;
  port_of_loading?: string | null;
  port_of_discharge?: string | null;
  remarks?: string | null;

  items: Array<{
    product_id: string | null;
    product_name: string;
    product_code?: string | null;
    hsn_code?: string | null;
    quantity: number;
    unit_rate: number;
    tax_percent: number;
    tax_amount: number;
    item_total: number;
    planning_row_id?: string | null;
    remarks?: string | null;
  }>;
}
