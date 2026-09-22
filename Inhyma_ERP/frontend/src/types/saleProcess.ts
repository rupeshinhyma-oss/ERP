/**
 * TypeScript type definitions for the Sale Process module.
 */

export type SaleOrderStatus =
  | 'pending'
  | 'sales_confirmed'
  | 'admin_approved'
  | 'acc_confirmed'
  | 'gatepass_created'
  | 'dispatched'
  | 'gatepass_cancelled'
  | 'lr'
  | 'cancelled';

export interface SaleOrderItem {
  id?: string;
  order_id?: string;
  product_id: string | null;
  product_name: string;
  product_code?: string | null;
  hsn_code?: string | null;
  hsn?: string;
  quantity: number;
  unit_rate: number;
  unit_price?: number;
  unit_discount?: number;
  taxable_amount?: number;
  gst_percent?: number;
  gst_amount?: number;
  total?: number;
  tax_percent: number;
  tax_amount: number;
  item_total: number;
  planning_row_id?: string | null;
  remarks?: string | null;
  is_additional_charge?: boolean;
  charge_type?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SaleTimelineEvent {
  status: string;
  date: string;
  by: string;
  remark?: string | null;
}

export interface SaleOrder {
  id: string;
  order_no: string;
  organization_id?: string;
  organization_name?: string;
  buyer_id?: string;
  buyer_name?: string;
  buyer_branch_id?: string | null;
  buyer_branch_name?: string | null;

  warehouse?: string;
  expected_delivery_date?: string | null;
  company_name?: string;
  city?: string | null;
  state?: string | null;
  third_party?: string | boolean;
  po?: string | boolean;
  sales_person?: string | null;
  amount_inc_gst?: number;
  amount_exc_gst?: number;
  discount?: number;
  status_updated_at?: string | null;
  acc_dep?: string | null;
  acc_dep_badges?: string[];
  timeline?: SaleTimelineEvent[];
  gatepass?: string | null;
  gatepass_no?: string | null;
  billing_address?: string | null;
  shipping_address?: string | null;
  phone?: string | null;
  gst_no?: string | null;
  contact_person_name?: string | null;
  contact_person_mobile?: string | null;
  contact_name?: string | null;
  transport_name?: string | null;
  transporter_gst?: string | null;
  transport_destination?: string | null;
  delivery_type?: string | null;
  delivery_charge?: string | null;
  third_party_delivery?: string | null;
  payment_terms?: string | null;
  exp_dispatch_date?: string | null;
  terms?: string[] | string | null;
  terms_and_conditions?: string | null;
  booking_remarks?: string | null;
  additional_charges_enabled?: boolean;
  total_discount?: number;
  total_taxable_amount?: number;
  total_including_tax?: number;
  amount_in_words?: string;
  files?: Array<{ name: string; size?: string; type?: string; url?: string }>;

  consignment_code?: string | null;
  planning_sheet_id?: string | null;
  planning_column_id?: string | null;

  order_date: string;
  delivery_date?: string | null;
  currency?: string;
  status: SaleOrderStatus | string;

  total_basic?: number;
  total_tax?: number;
  total_amount?: number;
  total_quantity?: number;
  item_count?: number;

  container_no?: string | null;
  bl_no?: string | null;
  lr_no?: string | null;
  transporter_name?: string | null;
  port_of_loading?: string | null;
  port_of_discharge?: string | null;
  remarks?: string | null;

  created_by_name?: string | null;
  created_at?: string;
  updated_at?: string;

  items?: SaleOrderItem[];
}

export interface MetricItem {
  count: number;
  amount: number;
}

export interface SaleSummaryMetrics {
  all: MetricItem;
  admin_confirmed_to_lr?: MetricItem;
  pending: MetricItem;
  sales_confirmed?: MetricItem;
  admin_approved: MetricItem;
  acc_confirmed?: MetricItem;
  gatepass_created?: MetricItem;
  dispatched?: MetricItem;
  gatepass_cancelled?: MetricItem;
  lr: MetricItem;
  cancelled: MetricItem;
  currency?: string;
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
