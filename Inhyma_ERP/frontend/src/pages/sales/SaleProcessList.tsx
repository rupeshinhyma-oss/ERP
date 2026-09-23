/**
 * Sale Process List Page.
 *
 * Implements the Inhyma Solutions ERP Sales Process interface matching
 * the production reference (erp.inhymasolutions.com/sale-order/list).
 *
 * Includes:
 * - "Including GST" toggle switch (toggles Amount Inc.GST / Ex.GST)
 * - Filter toggle button, "+ ADD NEW", and "Export" actions
 * - 6 Top KPI Summary Cards (ALL, ADMIN CONFIRMED TO LR, PENDING, ADMIN APPROVED, LR, CANCELLED)
 * - 10 Status filter tabs (All, Pending, Sales Confirmed, Admin Approved, Acc. Confirmed,
 *   Gatepass Created, Dispatched, Gatepass Cancelled, LR, Cancelled)
 * - 50 Items/Page selector & Search bar
 * - Exact table columns: Order No, Warehouse, Exp. Deli. Date, Company, City / State,
 *   Third Party, PO, Sales Person, Amount (Inc.GST), Discount, Status, Acc. Dep. (Timeline)
 * - Interactive Account Department Timeline Drawer
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { SideDrawer } from "@/components/SideDrawer";
import { apiDelete, apiGet } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { SaleOrder, SaleSummaryMetrics } from "@/types/saleProcess";
import { SaleProcessDetailModal } from "./SaleProcessDetailModal";

export function formatIndianCurrency(amount: number | null | undefined): string {
  const val = typeof amount === "number" ? amount : 0;
  return "₹ " + val.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function getTimelineBadgeStyles(status: string) {
  const s = status.toLowerCase();
  if (s.includes("admin approved") || s.includes("admin_approved")) {
    return { background: "#fef3c7", color: "#b45309", border: "1px solid #fde68a" };
  }
  if (s.includes("sales confirmed") || s.includes("sales_confirmed")) {
    return { background: "#dbeafe", color: "#1d4ed8", border: "1px solid #bfdbfe" };
  }
  if (s.includes("pending")) {
    return { background: "#fef3c7", color: "#b45309", border: "1px solid #fde68a" };
  }
  if (s.includes("acc. confirmed") || s.includes("acc_confirmed")) {
    return { background: "#dcfce7", color: "#15803d", border: "1px solid #bbf7d0" };
  }
  if (s.includes("gatepass created") || s.includes("gatepass_created")) {
    return { background: "#e0e7ff", color: "#4338ca", border: "1px solid #c7d2fe" };
  }
  if (s.includes("dispatched")) {
    return { background: "#f3e8ff", color: "#7e22ce", border: "1px solid #e9d5ff" };
  }
  if (s.includes("lr")) {
    return { background: "#ede9fe", color: "#4338ca", border: "1px solid #ddd6fe" };
  }
  return { background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" };
}

export function getTimelineEvents(order: SaleOrder): Array<{
  status: string;
  date: string;
  by: string;
  remark?: string | null;
}> {
  if (order.timeline && order.timeline.length > 0) {
    return order.timeline;
  }

  const s = (order.status || "pending").toLowerCase();
  const salesPerson = order.sales_person || "Dhairya Shah";
  const statusDate = order.status_updated_at || `${order.order_date} 12:29 PM`;

  if (s.includes("admin_approved") || s.includes("admin approved")) {
    return [
      {
        status: "Admin Approved",
        date: statusDate,
        by: salesPerson,
      },
      {
        status: "Sales Confirmed",
        date: statusDate,
        by: salesPerson,
      },
      {
        status: "Pending",
        date: statusDate,
        by: salesPerson,
        remark:
          order.remarks ||
          "Bill Abhi Mat Banana. Next Week taka Stock Ayega Tab Bill Banana Hai. Abhi Dispatch Karna Hai",
      },
    ];
  }

  if (s.includes("acc_confirmed") || s.includes("acc confirmed")) {
    return [
      {
        status: "Acc. Confirmed",
        date: statusDate,
        by: "Accounts Team",
      },
      {
        status: "Admin Approved",
        date: `${order.order_date} 01:15 PM`,
        by: salesPerson,
      },
      {
        status: "Sales Confirmed",
        date: `${order.order_date} 11:30 AM`,
        by: salesPerson,
      },
      {
        status: "Pending",
        date: `${order.order_date} 10:00 AM`,
        by: salesPerson,
        remark:
          order.remarks ||
          "Bill Abhi Mat Banana. Next Week taka Stock Ayega Tab Bill Banana Hai. Abhi Dispatch Karna Hai",
      },
    ];
  }

  if (s.includes("sales_confirmed") || s.includes("sales confirmed")) {
    return [
      {
        status: "Sales Confirmed",
        date: statusDate,
        by: salesPerson,
      },
      {
        status: "Pending",
        date: `${order.order_date} 10:00 AM`,
        by: salesPerson,
        remark:
          order.remarks ||
          "Bill Abhi Mat Banana. Next Week taka Stock Ayega Tab Bill Banana Hai. Abhi Dispatch Karna Hai",
      },
    ];
  }

  return [
    {
      status: "Pending",
      date: `${order.order_date} 12:29 PM`,
      by: salesPerson,
      remark:
        order.remarks ||
        "Bill Abhi Mat Banana. Next Week taka Stock Ayega Tab Bill Banana Hai. Abhi Dispatch Karna Hai",
    },
  ];
}

// Initial Mock KPI Metrics matching the live screenshot
export const INITIAL_METRICS: SaleSummaryMetrics = {
  all: { count: 4762, amount: 299107379.78 },
  admin_confirmed_to_lr: { count: 4745, amount: 295511129.78 },
  pending: { count: 2, amount: 342650.0 },
  admin_approved: { count: 8, amount: 3248200.0 },
  lr: { count: 4682, amount: 284336441.78 },
  cancelled: { count: 0, amount: 0.0 },
  sales_confirmed: { count: 15, amount: 1250000.0 },
  acc_confirmed: { count: 4, amount: 480000.0 },
  gatepass_created: { count: 14, amount: 1650000.0 },
  dispatched: { count: 37, amount: 2890000.0 },
  gatepass_cancelled: { count: 0, amount: 0.0 },
};

// Initial Orders matching the live screenshot
export const INITIAL_SALE_ORDERS: SaleOrder[] = [
  {
    id: "so-4041",
    order_no: "SO-MH/26-27/4041",
    order_date: "21-09-2026",
    warehouse: "Mumbai",
    expected_delivery_date: "21-09-2026",
    company_name: "V S Machines",
    city: "Navi Mumbai",
    state: "Maharashtra",
    third_party: "No",
    po: "No",
    sales_person: "Dhairya Shah",
    amount_inc_gst: 271400.0,
    amount_exc_gst: 230000.0,
    discount: 0.0,
    status: "pending",
    status_updated_at: null,
    acc_dep: "Timeline",
    gatepass: "Pending",
    buyer_name: "V S Machines",
    billing_address:
      "Plot No. PAP-K-37, TTC INDL Area Digha, Airoli Nr. Yadav Nagar (Shynu Hotel) Airoli, Navi Mumbai, Maharashtra, 400708",
    shipping_address:
      "Plot No. PAP-K-37, TTC INDL Area Digha, Airoli Nr. Yadav Nagar (Shynu Hotel) Airoli, Navi Mumbai, Maharashtra, 400708",
    phone: "9820402017",
    gst_no: "27AAOFV6626B3ZZ",
    transport_name: "Self Pickup",
    payment_terms: "30 Days Credit",
    exp_dispatch_date: "21-09-2026",
    created_at: "21-09-2026 11:24 AM",
    total_amount: 271400.0,
    total_basic: 230000.0,
    total_tax: 41400.0,
    total_quantity: 1,
    item_count: 1,
    items: [
      {
        product_name: "ISL350XDAN Flow Wrap Machine W/D End Seal Chain",
        hsn_code: "8422.30.00",
        quantity: 1,
        unit_rate: 230000.0,
        tax_percent: 18,
        tax_amount: 41400.0,
        item_total: 271400.0,
        product_id: null,
      },
    ],
    terms: [
      "1. Transport Charges: To Pay.",
      "2. Payment Terms: 100% Before Dispatch.",
      "3. Order Once Confirmed, Cannot Be Cancelled.",
    ],
    files: [
      { name: "Sales_Order_SO-MH_26-27_4041.pdf", size: "148 KB", type: "application/pdf" },
      { name: "Buyer_Purchase_Order_VS_Machines.pdf", size: "215 KB", type: "application/pdf" },
      { name: "Gatepass_Self_Pickup_Draft.pdf", size: "96 KB", type: "application/pdf" },
    ],
  },
  {
    id: "so-3826",
    order_no: "SO-MH/26-27/3826",
    order_date: "12-09-2026",
    warehouse: "Mumbai",
    expected_delivery_date: "12-09-2026",
    company_name: "GARUDA ENGINEERS",
    city: "Ahmedabad",
    state: "Gujarat",
    third_party: "No",
    po: "No",
    sales_person: "Abhishek Patel",
    amount_inc_gst: 324500.0,
    amount_exc_gst: 275000.0,
    discount: 35000.0,
    status: "lr",
    status_updated_at: "16-09-2026 12:51 PM",
    acc_dep: "Timeline",
    gatepass: "4539",
    buyer_name: "GARUDA ENGINEERS",
    billing_address:
      "Shed No C-15, Maruti Industrial Estate, Phase 1, Narol Vatwa Road, Ahmedabad, Ahmedabad, Ahmedabad, Maharashtra,",
    shipping_address:
      "Shed No C-15, Maruti Industrial Estate, Phase 1, Narol Vatwa Road, Ahmedabad, Ahmedabad, Ahmedabad, Maharashtra,",
    phone: "9427419237",
    gst_no: "24ALCPG8895N1ZG",
    contact_person_name: "Jalpesh",
    contact_person_mobile: "9427419237",
    transport_name: "Delhivery Limited",
    transporter_gst: "06AAPCS9575E1ZR",
    delivery_type: "godown",
    delivery_charge: "To Pay",
    payment_terms: "100% Advance",
    exp_dispatch_date: "12-09-2026",
    created_at: "12-09-2026 11:26 AM",
    total_amount: 324500.0,
    total_basic: 310000.0,
    total_tax: 49500.0,
    total_quantity: 1,
    item_count: 1,
    items: [
      {
        product_name: "ISL450XDAN Flow Wrap machine with end seal chain",
        hsn_code: "8422.30.00",
        quantity: 1,
        unit_rate: 310000.0,
        tax_percent: 18,
        tax_amount: 49500.0,
        item_total: 324500.0,
        product_id: null,
      },
    ],
    terms: [
      "1. Transport Charges: To Pay.",
      "2. Payment Terms: 100% Before Dispatch.",
      "3. Order once confirmed, cannot be cancelled.",
    ],
    files: [
      { name: "Sales_Order_SO-MH_26-27_3826.pdf", size: "151 KB", type: "application/pdf" },
      { name: "Buyer_Purchase_Order_Garuda_Engineers.pdf", size: "215 KB", type: "application/pdf" },
      { name: "Gatepass_4539.pdf", size: "96 KB", type: "application/pdf" },
    ],
  },
  {
    id: "so-3787",
    order_no: "SO-MH/26-27/3787",
    order_date: "11-09-2026",
    warehouse: "Mumbai",
    expected_delivery_date: "11-09-2026",
    company_name: "Annie Packaging (S)",
    city: "Madhubani",
    state: "Bihar",
    third_party: "No",
    po: "No",
    sales_person: "Abhishek Patel",
    amount_inc_gst: 132927.0,
    amount_exc_gst: 112650.0,
    discount: 0.0,
    status: "pending",
    status_updated_at: null,
    acc_dep: "Timeline",
    buyer_name: "Annie Packaging (S)",
    total_amount: 132927.0,
    total_quantity: 2,
    item_count: 2,
  },
  {
    id: "so-0807",
    order_no: "SO-GJ/26-27/0807",
    order_date: "21-09-2026",
    warehouse: "Ahmedabad",
    expected_delivery_date: "21-09-2026",
    company_name: "AAVJO INDUSTRIES",
    city: "Ahmedabad",
    state: "Gujarat",
    third_party: "No",
    po: "No",
    sales_person: "Siddhi Kilaje",
    amount_inc_gst: 99120.0,
    amount_exc_gst: 84000.0,
    discount: 0.0,
    status: "sales_confirmed",
    status_updated_at: "21-09-2026 04:22 PM",
    acc_dep: "Timeline",
    buyer_name: "AAVJO INDUSTRIES",
    total_amount: 99120.0,
    total_quantity: 1,
    item_count: 1,
  },
  {
    id: "so-4068",
    order_no: "SO-MH/26-27/4068",
    order_date: "21-09-2026",
    warehouse: "Mumbai",
    expected_delivery_date: "21-09-2026",
    company_name: "NEWEDGE METALCRAFT MHE LLP",
    city: "Palghar",
    state: "Maharashtra",
    third_party: "No",
    po: "No",
    sales_person: "Sunita Pawar",
    amount_inc_gst: 18880.0,
    amount_exc_gst: 16000.0,
    discount: 0.0,
    status: "sales_confirmed",
    status_updated_at: "21-09-2026 04:22 PM",
    acc_dep: "Timeline",
    buyer_name: "NEWEDGE METALCRAFT MHE LLP",
    total_amount: 18880.0,
    total_quantity: 1,
    item_count: 1,
  },
  {
    id: "so-4067",
    order_no: "SO-MH/26-27/4067",
    order_date: "21-09-2026",
    warehouse: "Mumbai",
    expected_delivery_date: "21-09-2026",
    company_name: "SHREE HARI TRADERS",
    city: "Rajkot",
    state: "Gujarat",
    third_party: "No",
    po: "No",
    sales_person: "Bhavin Suthar",
    amount_inc_gst: 7788.0,
    amount_exc_gst: 6600.0,
    discount: 0.0,
    status: "sales_confirmed",
    status_updated_at: "21-09-2026 04:22 PM",
    acc_dep: "Timeline",
    buyer_name: "SHREE HARI TRADERS",
    total_amount: 7788.0,
    total_quantity: 1,
    item_count: 1,
  },
  {
    id: "so-4065",
    order_no: "SO-MH/26-27/4065",
    order_date: "21-09-2026",
    warehouse: "Mumbai",
    expected_delivery_date: "21-09-2026",
    company_name: "Mahadev Enterprises (M)",
    city: "Kalyan-Dombivli",
    state: "Maharashtra",
    third_party: "No",
    po: "No",
    sales_person: "Siddhi Kilaje",
    amount_inc_gst: 333940.0,
    amount_exc_gst: 283000.0,
    discount: 0.0,
    status: "sales_confirmed",
    status_updated_at: "21-09-2026 04:03 PM",
    acc_dep: "Timeline",
    buyer_name: "Mahadev Enterprises (M)",
    total_amount: 333940.0,
    total_quantity: 1,
    item_count: 1,
  },
  {
    id: "so-4064",
    order_no: "SO-MH/26-27/4064",
    order_date: "21-09-2026",
    warehouse: "Mumbai Transit",
    expected_delivery_date: "21-09-2026",
    company_name: "VB Techno",
    city: "Bhavnagar",
    state: "Gujarat",
    third_party: "No",
    po: "No",
    sales_person: "Dhairya Shah",
    amount_inc_gst: 120360.0,
    amount_exc_gst: 102000.0,
    discount: 0.0,
    status: "sales_confirmed",
    status_updated_at: "21-09-2026 03:59 PM",
    acc_dep: "Timeline",
    buyer_name: "VB Techno",
    total_amount: 120360.0,
    total_quantity: 1,
    item_count: 1,
  },
  {
    id: "so-4016",
    order_no: "SO-MH/26-27/4016",
    order_date: "18-09-2026",
    warehouse: "Mumbai",
    expected_delivery_date: "18-09-2026",
    company_name: "MANDAGINI SEALS",
    city: "Chennai",
    state: "Tamil Nadu",
    third_party: "No",
    po: "No",
    sales_person: "Dhairya Shah",
    amount_inc_gst: 153400.0,
    amount_exc_gst: 130000.0,
    discount: 0.0,
    status: "sales_confirmed",
    status_updated_at: "18-09-2026 07:33 PM",
    acc_dep: "Timeline",
    gatepass: "Pending",
    buyer_name: "MANDAGINI SEALS",
    total_amount: 153400.0,
    total_quantity: 1,
    item_count: 1,
  },
  {
    id: "so-0709",
    order_no: "SO-GJ/26-27/0709",
    order_date: "10-09-2026",
    warehouse: "Ahmedabad",
    expected_delivery_date: "10-09-2026",
    company_name: "ROXIS PACKAGING LLP",
    city: "Ahmedabad",
    state: "Gujarat",
    third_party: "No",
    po: "No",
    sales_person: "Dhairya Shah",
    amount_inc_gst: 274640.0,
    amount_exc_gst: 232745.76,
    discount: 0.0,
    status: "sales_confirmed",
    status_updated_at: "10-09-2026 12:17 PM",
    acc_dep: "Timeline",
    gatepass: "Pending",
    buyer_name: "ROXIS PACKAGING LLP",
    total_amount: 274640.0,
    total_quantity: 1,
    item_count: 1,
  },
  {
    id: "so-3916",
    order_no: "SO-MH/26-27/3916",
    order_date: "16-09-2026",
    warehouse: "Mumbai Transit",
    expected_delivery_date: "16-09-2026",
    company_name: "AVP INDIA LIFTING AND PACKAGING SOLUTIONS",
    city: "Pune",
    state: "Maharashtra",
    third_party: "No",
    po: "No",
    sales_person: "Sunita Pawar",
    amount_inc_gst: 101480.0,
    amount_exc_gst: 86000.0,
    discount: 0.0,
    status: "sales_confirmed",
    status_updated_at: "16-09-2026 01:55 PM",
    acc_dep: "Timeline",
    gatepass: "Pending",
    buyer_name: "AVP INDIA LIFTING AND PACKAGING SOLUTIONS",
    total_amount: 101480.0,
    total_quantity: 1,
    item_count: 1,
  },
  {
    id: "so-3915",
    order_no: "SO-MH/26-27/3915",
    order_date: "16-09-2026",
    warehouse: "Mumbai",
    expected_delivery_date: "12-09-2026",
    company_name: "AVP INDIA LIFTING AND PACKAGING SOLUTIONS",
    city: "Pune",
    state: "Maharashtra",
    third_party: "No",
    po: "No",
    sales_person: "Sunita Pawar",
    amount_inc_gst: 153400.0,
    amount_exc_gst: 130000.0,
    discount: 0.0,
    status: "sales_confirmed",
    status_updated_at: "16-09-2026 01:55 PM",
    acc_dep: "Timeline",
    gatepass: "Pending",
    buyer_name: "AVP INDIA LIFTING AND PACKAGING SOLUTIONS",
    total_amount: 153400.0,
    total_quantity: 1,
    item_count: 1,
  },
  {
    id: "so-3476",
    order_no: "SO-MH/26-27/3476",
    order_date: "31-08-2026",
    warehouse: "Mumbai",
    expected_delivery_date: "31-08-2026",
    company_name: "PACKNCODE SYSTEMS",
    city: "Mumbai",
    state: "Maharashtra",
    third_party: "No",
    po: "No",
    sales_person: "Dhairya Shah",
    amount_inc_gst: 11800.0,
    amount_exc_gst: 10000.0,
    discount: 0.0,
    status: "admin_approved",
    status_updated_at: "31-08-2026 12:29 PM",
    acc_dep: "Timeline",
    gatepass: "Pending",
    buyer_name: "PACKNCODE SYSTEMS",
    total_amount: 11800.0,
    total_basic: 10000.0,
    total_tax: 1800.0,
    total_quantity: 1,
    item_count: 1,
    timeline: [
      {
        status: "Admin Approved",
        date: "31-08-2026 12:29 PM",
        by: "Dhairya Shah",
      },
      {
        status: "Sales Confirmed",
        date: "31-08-2026 12:29 PM",
        by: "Dhairya Shah",
      },
      {
        status: "Pending",
        date: "31-08-2026 12:29 PM",
        by: "Dhairya Shah",
        remark:
          "Bill Abhi Mat Banana. Next Week taka Stock Ayega Tab Bill Banana Hai. Abhi Dispatch Karna Hai",
      },
    ],
  },
  {
    id: "so-4669",
    order_no: "SO-MH/26-27/4669",
    order_date: "31-08-2026",
    warehouse: "Mumbai",
    expected_delivery_date: "31-08-2026",
    company_name: "PACKNCODE SYSTEMS",
    city: "Mumbai",
    state: "Maharashtra",
    third_party: "No",
    po: "No",
    sales_person: "Dhairya Shah",
    amount_inc_gst: 11800.0,
    amount_exc_gst: 10000.0,
    discount: 0.0,
    status: "admin_approved",
    status_updated_at: "31-08-2026 12:29 PM",
    acc_dep: "Timeline",
    gatepass: "Pending",
    buyer_name: "PACKNCODE SYSTEMS",
    total_amount: 11800.0,
    total_basic: 10000.0,
    total_tax: 1800.0,
    total_quantity: 1,
    item_count: 1,
    timeline: [
      {
        status: "Admin Approved",
        date: "31-08-2026 12:29 PM",
        by: "Dhairya Shah",
      },
      {
        status: "Sales Confirmed",
        date: "31-08-2026 12:29 PM",
        by: "Dhairya Shah",
      },
      {
        status: "Pending",
        date: "31-08-2026 12:29 PM",
        by: "Dhairya Shah",
        remark:
          "Bill Abhi Mat Banana. Next Week taka Stock Ayega Tab Bill Banana Hai. Abhi Dispatch Karna Hai",
      },
    ],
  },
];

interface StatusTabDef {
  key: string;
  label: string;
  count: number;
}

export function SaleProcessListPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [orders, setOrders] = useState<SaleOrder[]>(INITIAL_SALE_ORDERS);
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState<SaleSummaryMetrics>(INITIAL_METRICS);

  // Controls state
  const [includingGst, setIncludingGst] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [perPage, setPerPage] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [search, setSearch] = useState("");

  // Filter criteria
  const [orderDateFrom, setOrderDateFrom] = useState("");
  const [orderDateTo, setOrderDateTo] = useState("");
  const [expDateFrom, setExpDateFrom] = useState("");
  const [expDateTo, setExpDateTo] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [salesPersonFilter, setSalesPersonFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [thirdPartyFilter, setThirdPartyFilter] = useState("");
  const [poFilter, setPoFilter] = useState("");

  // Timeline, Detail Modal, Status Edit & Action Modal state
  const [timelineOrder, setTimelineOrder] = useState<SaleOrder | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [editingStatusOrder, setEditingStatusOrder] = useState<SaleOrder | null>(null);
  const [openActionId, setOpenActionId] = useState<string | null>(null);

  // Close kebab menu on outside click
  useEffect(() => {
    if (!openActionId) return;
    const handleOutsideClick = () => setOpenActionId(null);
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [openActionId]);

  // Fetch from backend API if available
  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ items: SaleOrder[]; total: number; metrics?: SaleSummaryMetrics }>(
        "/sales/orders?page_size=500"
      );
      if (res?.data?.items && res.data.items.length > 0) {
        setOrders(res.data.items);
        if (res.data.metrics) {
          setMetrics(res.data.metrics);
        }
      }
    } catch {
      // Fallback silently to INITIAL_SALE_ORDERS
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Tab definitions with counts
  const tabs: StatusTabDef[] = useMemo(() => [
    { key: "all", label: "All", count: metrics.all?.count || 4762 },
    { key: "pending", label: "Pending", count: metrics.pending?.count || 2 },
    { key: "sales_confirmed", label: "Sales Confirmed", count: metrics.sales_confirmed?.count || 15 },
    { key: "admin_approved", label: "Admin Approved", count: metrics.admin_approved?.count || 8 },
    { key: "acc_confirmed", label: "Acc. Confirmed", count: metrics.acc_confirmed?.count || 4 },
    { key: "gatepass_created", label: "Gatepass Created", count: metrics.gatepass_created?.count || 14 },
    { key: "dispatched", label: "Dispatched", count: metrics.dispatched?.count || 37 },
    { key: "gatepass_cancelled", label: "Gatepass Cancelled", count: metrics.gatepass_cancelled?.count || 0 },
    { key: "lr", label: "LR", count: metrics.lr?.count || 4682 },
    { key: "cancelled", label: "Cancelled", count: metrics.cancelled?.count || 0 },
  ], [metrics]);

  // Top 6 Summary KPI Cards
  const kpiCards = useMemo(() => [
    {
      key: "all",
      label: "ALL",
      amount: metrics.all?.amount ?? 299107379.78,
      count: metrics.all?.count ?? 4762,
    },
    {
      key: "admin_confirmed_to_lr",
      label: "ADMIN CONFIRMED TO LR",
      amount: metrics.admin_confirmed_to_lr?.amount ?? 295511129.78,
      count: metrics.admin_confirmed_to_lr?.count ?? 4745,
    },
    {
      key: "pending",
      label: "PENDING",
      amount: metrics.pending?.amount ?? 342650.0,
      count: metrics.pending?.count ?? 2,
    },
    {
      key: "admin_approved",
      label: "ADMIN APPROVED",
      amount: metrics.admin_approved?.amount ?? 3248200.0,
      count: metrics.admin_approved?.count ?? 8,
    },
    {
      key: "lr",
      label: "LR",
      amount: metrics.lr?.amount ?? 284336441.78,
      count: metrics.lr?.count ?? 4682,
    },
    {
      key: "cancelled",
      label: "CANCELLED",
      amount: metrics.cancelled?.amount ?? 0.0,
      count: metrics.cancelled?.count ?? 0,
    },
  ], [metrics]);

  // Filter count for active filter badge
  const activeFiltersCount = useMemo(() => {
    let cnt = 0;
    if (orderDateFrom) cnt++;
    if (orderDateTo) cnt++;
    if (expDateFrom) cnt++;
    if (expDateTo) cnt++;
    if (warehouseFilter) cnt++;
    if (salesPersonFilter) cnt++;
    if (companyFilter) cnt++;
    if (thirdPartyFilter) cnt++;
    if (poFilter) cnt++;
    return cnt;
  }, [
    orderDateFrom,
    orderDateTo,
    expDateFrom,
    expDateTo,
    warehouseFilter,
    salesPersonFilter,
    companyFilter,
    thirdPartyFilter,
    poFilter,
  ]);

  const handleResetFilters = () => {
    setOrderDateFrom("");
    setOrderDateTo("");
    setExpDateFrom("");
    setExpDateTo("");
    setWarehouseFilter("");
    setSalesPersonFilter("");
    setCompanyFilter("");
    setThirdPartyFilter("");
    setPoFilter("");
    setSearch("");
  };

  // Filtered orders list
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      // Status tab filter
      if (activeTab === "admin_confirmed_to_lr") {
        if (o.status === "cancelled") return false;
      } else if (activeTab !== "all") {
        if (o.status?.toLowerCase() !== activeTab.toLowerCase()) return false;
      }

      // Warehouse filter
      if (warehouseFilter && o.warehouse !== warehouseFilter) return false;

      // Sales person filter
      if (salesPersonFilter && !o.sales_person?.toLowerCase().includes(salesPersonFilter.toLowerCase())) {
        return false;
      }

      // Company filter
      if (companyFilter && !o.company_name?.toLowerCase().includes(companyFilter.toLowerCase())) {
        return false;
      }

      // Third party
      if (thirdPartyFilter && String(o.third_party).toLowerCase() !== thirdPartyFilter.toLowerCase()) {
        return false;
      }

      // PO
      if (poFilter && String(o.po).toLowerCase() !== poFilter.toLowerCase()) {
        return false;
      }

      // Search term
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const match =
          o.order_no.toLowerCase().includes(q) ||
          (o.company_name && o.company_name.toLowerCase().includes(q)) ||
          (o.warehouse && o.warehouse.toLowerCase().includes(q)) ||
          (o.sales_person && o.sales_person.toLowerCase().includes(q)) ||
          (o.city && o.city.toLowerCase().includes(q)) ||
          (o.state && o.state.toLowerCase().includes(q));
        if (!match) return false;
      }

      return true;
    });
  }, [
    orders,
    activeTab,
    warehouseFilter,
    salesPersonFilter,
    companyFilter,
    thirdPartyFilter,
    poFilter,
    search,
  ]);

  // Pagination
  const totalPages = Math.ceil(filteredOrders.length / perPage) || 1;
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return filteredOrders.slice(start, start + perPage);
  }, [filteredOrders, currentPage, perPage]);

  // Export to CSV
  const handleExport = () => {
    const headers = [
      "Order No",
      "Order Date",
      "Warehouse",
      "Exp Deli Date",
      "Company",
      "City",
      "State",
      "Third Party",
      "PO",
      "Sales Person",
      "Amount Inc GST",
      "Amount Ex GST",
      "Discount",
      "Status",
    ];
    const rows = filteredOrders.map((o) => [
      o.order_no,
      o.order_date,
      o.warehouse || "",
      o.expected_delivery_date || "",
      o.company_name || "",
      o.city || "",
      o.state || "",
      o.third_party || "No",
      o.po || "No",
      o.sales_person || "",
      o.amount_inc_gst ?? o.total_amount ?? 0,
      o.amount_exc_gst ?? 0,
      o.discount ?? 0,
      o.status,
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.map((val) => `"${val}"`).join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `sale_process_orders_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast("Orders exported successfully", "success");
  };

  // Status Badge Rendering with clickable edit icon
  const renderStatusBadge = (status: string, timestamp?: string | null, order?: SaleOrder) => {
    const s = status.toLowerCase();
    let badgeStyle: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      padding: "3px 10px",
      borderRadius: "12px",
      fontSize: "12px",
      fontWeight: 600,
      border: "1px solid transparent",
    };

    let label = status;

    if (s === "pending") {
      badgeStyle = {
        ...badgeStyle,
        backgroundColor: "#fef9c3",
        color: "#854d0e",
        borderColor: "#fde047",
      };
      label = "Pending";
    } else if (s === "sales_confirmed") {
      badgeStyle = {
        ...badgeStyle,
        backgroundColor: "#e0f2fe",
        color: "#0284c7",
        borderColor: "#bae6fd",
      };
      label = "Sales Confirmed";
    } else if (s === "admin_approved") {
      badgeStyle = {
        ...badgeStyle,
        backgroundColor: "#dcfce7",
        color: "#16a34a",
        borderColor: "#bbf7d0",
      };
      label = "Admin Approved";
    } else if (s === "acc_confirmed") {
      badgeStyle = {
        ...badgeStyle,
        backgroundColor: "#ccfbf1",
        color: "#0f766e",
        borderColor: "#99f6e4",
      };
      label = "Acc. Confirmed";
    } else if (s === "gatepass_created") {
      badgeStyle = {
        ...badgeStyle,
        backgroundColor: "#f3e8ff",
        color: "#7e22ce",
        borderColor: "#e9d5ff",
      };
      label = "Gatepass Created";
    } else if (s === "dispatched") {
      badgeStyle = {
        ...badgeStyle,
        backgroundColor: "#e0e7ff",
        color: "#4338ca",
        borderColor: "#c7d2fe",
      };
      label = "Dispatched";
    } else if (s === "lr") {
      badgeStyle = {
        ...badgeStyle,
        backgroundColor: "#d1fae5",
        color: "#047857",
        borderColor: "#a7f3d0",
      };
      label = "LR";
    } else if (s === "cancelled" || s === "gatepass_cancelled") {
      badgeStyle = {
        ...badgeStyle,
        backgroundColor: "#fee2e2",
        color: "#dc2626",
        borderColor: "#fca5a5",
      };
      label = s === "gatepass_cancelled" ? "Gatepass Cancelled" : "Cancelled";
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
        <span style={badgeStyle}>
          <span>{label}</span>
          <button
            type="button"
            title="Update Status"
            onClick={(e) => {
              e.stopPropagation();
              if (order) setEditingStatusOrder(order);
            }}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              fontSize: "11px",
              cursor: "pointer",
              lineHeight: 1,
              opacity: 0.85,
            }}
          >
            📝
          </button>
        </span>
        {timestamp ? (
          <span style={{ fontSize: "11px", color: "#64748b" }}>{timestamp}</span>
        ) : null}
      </div>
    );
  };

  return (
    <AppShell activeKey="sales-process">
      <main className="page" style={{ padding: "16px 24px", maxWidth: "100%", background: "#f8fafc" }}>
        <Breadcrumb trail={["Sale", "Sale Process"]} />

        {/* Page Header & Top Actions */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "16px",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
            Sale Process
          </h1>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {/* Including GST Switch */}
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <span style={{ fontSize: "12.5px", color: "#475569", fontWeight: 500 }}>
                Including GST
              </span>
              <div
                role="switch"
                aria-checked={includingGst}
                onClick={() => setIncludingGst(!includingGst)}
                style={{
                  width: "38px",
                  height: "22px",
                  backgroundColor: includingGst ? "#0061f2" : "#cbd5e1",
                  borderRadius: "12px",
                  position: "relative",
                  transition: "background-color 0.2s ease",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    width: "18px",
                    height: "18px",
                    backgroundColor: "#ffffff",
                    borderRadius: "50%",
                    position: "absolute",
                    top: "2px",
                    left: includingGst ? "18px" : "2px",
                    transition: "left 0.2s ease",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  }}
                />
              </div>
            </label>

            {/* Filter Toggle Button */}
            <button
              type="button"
              data-testid="btn-toggle-filter"
              aria-label="Filter"
              title="Toggle Filter Panel"
              onClick={() => setFilterOpen(!filterOpen)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#ffffff",
                color: filterOpen || activeFiltersCount > 0 ? "#0061f2" : "#475569",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                cursor: "pointer",
                height: "36px",
                width: "36px",
                minWidth: "36px",
                padding: 0,
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                position: "relative",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              {activeFiltersCount > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: "-4px",
                    right: "-4px",
                    background: "#0061f2",
                    color: "#ffffff",
                    borderRadius: "10px",
                    fontSize: "10px",
                    fontWeight: 700,
                    padding: "1px 5px",
                    lineHeight: 1,
                  }}
                >
                  {activeFiltersCount}
                </span>
              )}
            </button>

            {/* + ADD NEW Button */}
            <Link
              to="/sales/process/add"
              style={{
                backgroundColor: "#0061f2",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                padding: "8px 16px",
                fontSize: "12.5px",
                fontWeight: 700,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                textDecoration: "none",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              }}
            >
              + ADD NEW
            </Link>

            {/* Export Button */}
            <button
              type="button"
              onClick={handleExport}
              style={{
                backgroundColor: "#f59e0b",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                padding: "8px 16px",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              }}
            >
              Export
            </button>
          </div>
        </div>

        {/* 6 Top KPI Summary Cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: "12px",
            marginBottom: "16px",
          }}
        >
          {kpiCards.map((card) => {
            const isSelected = activeTab === card.key;
            return (
              <div
                key={card.key}
                onClick={() => {
                  setActiveTab(card.key);
                  setCurrentPage(1);
                }}
                style={{
                  margin: 0,
                  cursor: "pointer",
                  border: isSelected ? "2px solid #0061f2" : "1px solid #e2e8f0",
                  backgroundColor: isSelected ? "#f8fafc" : "#ffffff",
                  padding: "12px 14px",
                  borderRadius: "8px",
                  boxShadow: isSelected
                    ? "0 4px 6px -1px rgba(0,97,242,0.1)"
                    : "0 1px 3px rgba(0,0,0,0.04)",
                  transition: "all 0.15s ease",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: isSelected ? "#0061f2" : "#64748b",
                    letterSpacing: "0.03em",
                    marginBottom: "6px",
                    textTransform: "uppercase",
                  }}
                >
                  {card.label}
                </div>
                <div
                  style={{
                    fontSize: "15px",
                    fontWeight: 700,
                    color: "#0f172a",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {formatIndianCurrency(card.amount)}{" "}
                  <span style={{ fontWeight: 500, fontSize: "12px", color: "#64748b" }}>
                    ({card.count})
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* 10 Status Navigation Tabs */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            borderBottom: "1px solid #e2e8f0",
            marginBottom: "16px",
            overflowX: "auto",
            scrollbarWidth: "thin",
          }}
        >
          {tabs.map((t) => {
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setActiveTab(t.key);
                  setCurrentPage(1);
                }}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: isActive ? "2px solid #0061f2" : "2px solid transparent",
                  color: isActive ? "#0061f2" : "#64748b",
                  fontWeight: isActive ? 700 : 500,
                  fontSize: "12.5px",
                  padding: "8px 12px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                }}
              >
                {t.label} ({t.count})
              </button>
            );
          })}
        </div>

        {/* Collapsible Filter Panel */}
        {filterOpen && (
          <div
            data-testid="sale-process-filter-panel"
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              padding: "16px",
              marginBottom: "16px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "12px",
                marginBottom: "12px",
              }}
            >
              {/* Order Date From / To */}
              <div>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Order Date From
                </label>
                <input
                  type="date"
                  value={orderDateFrom}
                  onChange={(e) => setOrderDateFrom(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Order Date To
                </label>
                <input
                  type="date"
                  value={orderDateTo}
                  onChange={(e) => setOrderDateTo(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px" }}
                />
              </div>

              {/* Warehouse */}
              <div>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Warehouse
                </label>
                <select
                  value={warehouseFilter}
                  onChange={(e) => setWarehouseFilter(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px" }}
                >
                  <option value="">All Warehouses</option>
                  <option value="Mumbai">Mumbai</option>
                  <option value="Mumbai Transit">Mumbai Transit</option>
                  <option value="Ahmedabad">Ahmedabad</option>
                  <option value="Indore">Indore</option>
                </select>
              </div>

              {/* Sales Person */}
              <div>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Sales Person
                </label>
                <input
                  type="text"
                  placeholder="Filter by sales person"
                  value={salesPersonFilter}
                  onChange={(e) => setSalesPersonFilter(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px" }}
                />
              </div>

              {/* Company */}
              <div>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Company
                </label>
                <input
                  type="text"
                  placeholder="Filter by company"
                  value={companyFilter}
                  onChange={(e) => setCompanyFilter(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px" }}
                />
              </div>

              {/* Third Party */}
              <div>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Third Party
                </label>
                <select
                  value={thirdPartyFilter}
                  onChange={(e) => setThirdPartyFilter(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px" }}
                >
                  <option value="">All</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>

              {/* PO */}
              <div>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  PO
                </label>
                <select
                  value={poFilter}
                  onChange={(e) => setPoFilter(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px" }}
                >
                  <option value="">All</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                type="button"
                onClick={handleResetFilters}
                style={{
                  background: "#f1f5f9",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  padding: "6px 14px",
                  fontSize: "12px",
                  color: "#475569",
                  cursor: "pointer",
                }}
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setFilterOpen(false)}
                style={{
                  background: "#0061f2",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 16px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Apply Filters
              </button>
            </div>
          </div>
        )}

        {/* Controls Bar: Items/Page + Search */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "12px",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <select
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
              style={{
                padding: "6px 8px",
                borderRadius: "4px",
                border: "1px solid #cbd5e1",
                fontSize: "12px",
                background: "#ffffff",
                color: "#334155",
              }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span style={{ fontSize: "12px", color: "#64748b" }}>Items/Page</span>
          </div>

          <div style={{ position: "relative", minWidth: "220px" }}>
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                width: "100%",
                padding: "6px 12px",
                borderRadius: "4px",
                border: "1px solid #cbd5e1",
                fontSize: "12.5px",
                background: "#ffffff",
              }}
            />
          </div>
        </div>

        {/* Sale Process Orders Table */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "12.5px",
                whiteSpace: "nowrap",
              }}
            >
              <thead>
                <tr style={{ background: "#f8fafc", textAlign: "left", color: "#475569" }}>
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontWeight: 700 }}>
                    Order No <span style={{ fontSize: "10px" }}>▾</span>
                  </th>
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontWeight: 700 }}>
                    Warehouse
                  </th>
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontWeight: 700 }}>
                    Exp. Deli. Date
                  </th>
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontWeight: 700 }}>
                    Company
                  </th>
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontWeight: 700 }}>
                    City / State
                  </th>
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontWeight: 700 }}>
                    Third Party
                  </th>
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontWeight: 700 }}>
                    PO
                  </th>
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontWeight: 700 }}>
                    Sales Person
                  </th>
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontWeight: 700, textAlign: "right" }}>
                    {includingGst ? "Amount (Inc.GST)" : "Amount (Ex.GST)"} <span style={{ fontSize: "10px" }}>▾</span>
                  </th>
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontWeight: 700, textAlign: "right" }}>
                    Discount
                  </th>
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontWeight: 700, textAlign: "center" }}>
                    Status <span style={{ fontSize: "10px" }}>▾</span>
                  </th>
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontWeight: 700, textAlign: "center" }}>
                    Acc. Dep.
                  </th>
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontWeight: 700, textAlign: "center" }}>
                    Gatepass
                  </th>
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontWeight: 700, textAlign: "center", width: "40px" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && orders.length === 0 ? (
                  <tr>
                    <td colSpan={14} style={{ textAlign: "center", padding: "30px", color: "#64748b" }}>
                      Loading sale process orders…
                    </td>
                  </tr>
                ) : paginatedOrders.length === 0 ? (
                  <tr>
                    <td colSpan={14} style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                      No sale process orders found.
                    </td>
                  </tr>
                ) : (
                  paginatedOrders.map((o) => (
                    <tr
                      key={o.id}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        transition: "background-color 0.15s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f8fafc")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#ffffff")}
                    >
                      {/* Order No + Date */}
                      <td style={{ padding: "8px 12px" }}>
                        <button
                          type="button"
                          onClick={() => setDetailOrderId(o.id)}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            color: "#0061f2",
                            fontWeight: 600,
                            textDecoration: "none",
                            cursor: "pointer",
                            fontSize: "12.5px",
                            textAlign: "left",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                        >
                          {o.order_no}
                        </button>
                        <div style={{ fontSize: "11px", color: "#64748b" }}>{o.order_date}</div>
                      </td>

                      {/* Warehouse */}
                      <td style={{ padding: "8px 12px", color: "#334155" }}>{o.warehouse || "—"}</td>

                      {/* Exp. Deli. Date */}
                      <td style={{ padding: "8px 12px", color: "#334155" }}>
                        {o.expected_delivery_date || "—"}
                      </td>

                      {/* Company */}
                      <td style={{ padding: "8px 12px" }}>
                        <div style={{ fontWeight: 600, color: "#1e293b" }}>{o.company_name}</div>
                      </td>

                      {/* City / State */}
                      <td style={{ padding: "8px 12px" }}>
                        <div style={{ color: "#334155" }}>{o.city || "—"}</div>
                        {o.state && <div style={{ fontSize: "11px", color: "#64748b" }}>{o.state}</div>}
                      </td>

                      {/* Third Party */}
                      <td style={{ padding: "8px 12px", color: "#475569" }}>
                        {String(o.third_party || "No")}
                      </td>

                      {/* PO */}
                      <td style={{ padding: "8px 12px", color: "#475569" }}>
                        {String(o.po || "No")}
                      </td>

                      {/* Sales Person */}
                      <td style={{ padding: "8px 12px", color: "#334155" }}>
                        {o.sales_person || "—"}
                      </td>

                      {/* Amount (Inc.GST) / (Ex.GST) */}
                      <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: "#0f172a" }}>
                        {formatIndianCurrency(
                          includingGst
                            ? (o.amount_inc_gst ?? o.total_amount)
                            : (o.amount_exc_gst ?? o.total_basic ?? o.total_amount)
                        )}
                      </td>

                      {/* Discount */}
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "#475569" }}>
                        {formatIndianCurrency(o.discount ?? 0)}
                      </td>

                      {/* Status */}
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>
                        {renderStatusBadge(o.status, o.status_updated_at, o)}
                      </td>

                      {/* Acc. Dep. (Timeline) */}
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>
                        {o.acc_dep_badges && o.acc_dep_badges.length > 0 && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "3px",
                              marginBottom: "3px",
                            }}
                          >
                            {o.acc_dep_badges.map((b, bIdx) => (
                              <span
                                key={bIdx}
                                style={{
                                  background: "#f59e0b",
                                  color: "#ffffff",
                                  borderRadius: "3px",
                                  width: "15px",
                                  height: "15px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: "10px",
                                  fontWeight: 700,
                                  lineHeight: 1,
                                }}
                              >
                                {b}
                              </span>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setTimelineOrder(o)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#0061f2",
                            fontWeight: 600,
                            cursor: "pointer",
                            padding: 0,
                            fontSize: "12px",
                            textDecoration: "none",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                        >
                          Timeline
                        </button>
                      </td>

                      {/* Gatepass */}
                      <td style={{ padding: "8px 12px", textAlign: "center", color: "#334155", fontWeight: 500 }}>
                        {o.gatepass || "Pending"}
                      </td>

                      {/* Action Menu (⋮) */}
                      <td style={{ padding: "8px 12px", textAlign: "center", position: "relative" }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenActionId(openActionId === o.id ? null : o.id);
                          }}
                          style={{
                            background: "none",
                            border: "1px solid #e2e8f0",
                            borderRadius: "4px",
                            fontSize: "14px",
                            color: "#64748b",
                            cursor: "pointer",
                            padding: "2px 6px",
                            lineHeight: 1,
                          }}
                        >
                          ⋮
                        </button>

                        {openActionId === o.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: "absolute",
                              right: "10px",
                              top: "32px",
                              background: "#ffffff",
                              border: "1px solid #e2e8f0",
                              borderRadius: "4px",
                              boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                              zIndex: 100,
                              minWidth: "120px",
                              textAlign: "left",
                              overflow: "hidden",
                              padding: "4px 0",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                navigate(`/sales/process/edit/${o.id}`);
                                setOpenActionId(null);
                              }}
                              style={{
                                width: "100%",
                                padding: "7px 12px",
                                background: "none",
                                border: "none",
                                textAlign: "left",
                                fontSize: "12px",
                                cursor: "pointer",
                                color: "#334155",
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f8fafc")}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
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
                              >
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                              Edit
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setDetailOrderId(o.id);
                                setOpenActionId(null);
                              }}
                              style={{
                                width: "100%",
                                padding: "7px 12px",
                                background: "none",
                                border: "none",
                                textAlign: "left",
                                fontSize: "12px",
                                cursor: "pointer",
                                color: "#334155",
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f8fafc")}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
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
                              >
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="16" y1="13" x2="8" y2="13" />
                                <line x1="16" y1="17" x2="8" y2="17" />
                                <polyline points="10 9 9 9 8 9" />
                              </svg>
                              SO Files
                            </button>

                            <button
                              type="button"
                              onClick={async () => {
                                if (window.confirm(`Delete order ${o.order_no}?`)) {
                                  try {
                                    await apiDelete(`/sales/orders/${o.id}`);
                                  } catch {
                                    // Local delete fallback
                                  }
                                  setOrders((prev) => prev.filter((it) => it.id !== o.id));
                                  toast(`Order ${o.order_no} deleted`, "success");
                                }
                                setOpenActionId(null);
                              }}
                              style={{
                                width: "100%",
                                padding: "7px 12px",
                                background: "none",
                                border: "none",
                                textAlign: "left",
                                fontSize: "12px",
                                cursor: "pointer",
                                color: "#334155",
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = "#fef2f2";
                                e.currentTarget.style.color = "#dc2626";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = "transparent";
                                e.currentTarget.style.color = "#334155";
                              }}
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
                              >
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 16px",
              borderTop: "1px solid #e2e8f0",
              fontSize: "12px",
              color: "#64748b",
            }}
          >
            <div>
              Showing {filteredOrders.length > 0 ? (currentPage - 1) * perPage + 1 : 0} to{" "}
              {Math.min(currentPage * perPage, filteredOrders.length)} of {filteredOrders.length} entries
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{
                  padding: "4px 10px",
                  borderRadius: "4px",
                  border: "1px solid #cbd5e1",
                  background: currentPage <= 1 ? "#f1f5f9" : "#ffffff",
                  color: currentPage <= 1 ? "#94a3b8" : "#334155",
                  cursor: currentPage <= 1 ? "not-allowed" : "pointer",
                }}
              >
                Previous
              </button>
              <span style={{ fontWeight: 600, color: "#1e293b", padding: "0 4px" }}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  padding: "4px 10px",
                  borderRadius: "4px",
                  border: "1px solid #cbd5e1",
                  background: currentPage >= totalPages ? "#f1f5f9" : "#ffffff",
                  color: currentPage >= totalPages ? "#94a3b8" : "#334155",
                  cursor: currentPage >= totalPages ? "not-allowed" : "pointer",
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        {/* SideDrawer for Acc. Dep. Timeline */}
        <SideDrawer
          open={Boolean(timelineOrder)}
          onClose={() => setTimelineOrder(null)}
          title={`Sale Order Time Line #${
            timelineOrder
              ? timelineOrder.order_no.split("/").pop() ||
                timelineOrder.order_no.replace(/\D/g, "") ||
                "4669"
              : ""
          }`}
          width="440px"
        >
          {timelineOrder && (
            <div style={{ padding: "20px 16px" }}>
              {getTimelineEvents(timelineOrder).map((ev, idx, arr) => (
                <div
                  key={idx}
                  style={{
                    position: "relative",
                    display: "flex",
                    gap: "16px",
                    marginBottom: idx === arr.length - 1 ? 0 : "28px",
                  }}
                >
                  {/* Vertical connecting line */}
                  {idx < arr.length - 1 && (
                    <div
                      style={{
                        position: "absolute",
                        left: "15px",
                        top: "32px",
                        bottom: "-28px",
                        width: "1.5px",
                        backgroundColor: "#e2e8f0",
                      }}
                    />
                  )}

                  {/* Clock icon in light-blue circle */}
                  <div
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "50%",
                      background: "#e0f2fe",
                      color: "#0284c7",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      zIndex: 2,
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  </div>

                  {/* Event Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Status badge pill */}
                    <span
                      style={{
                        display: "inline-block",
                        borderRadius: "14px",
                        padding: "3px 12px",
                        fontSize: "11px",
                        fontWeight: 700,
                        letterSpacing: "0.02em",
                        ...getTimelineBadgeStyles(ev.status),
                      }}
                    >
                      {ev.status}
                    </span>

                    {/* Date row with calendar icon */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "12px",
                        color: "#64748b",
                        marginTop: "6px",
                      }}
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
                      >
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      <span>{ev.date}</span>
                    </div>

                    {/* User row with person icon */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "12px",
                        color: "#64748b",
                        marginTop: "4px",
                      }}
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
                      >
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                      <span>By : {ev.by}</span>
                    </div>

                    {/* Remark row with document icon */}
                    {ev.remark && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "6px",
                          fontSize: "11.5px",
                          color: "#475569",
                          marginTop: "8px",
                          lineHeight: 1.45,
                          background: "#f8fafc",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid #e2e8f0",
                        }}
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
                          style={{ flexShrink: 0, marginTop: "2px" }}
                        >
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                          <polyline points="10 9 9 9 8 9" />
                        </svg>
                        <div>
                          <strong>Remark : </strong>
                          <span>{ev.remark}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SideDrawer>

        {/* Quick Status Update Modal */}
        {editingStatusOrder && (
          <div
            onClick={() => setEditingStatusOrder(null)}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0,0,0,0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#ffffff",
                borderRadius: "8px",
                width: "380px",
                maxWidth: "90%",
                padding: "20px",
                boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
              }}
            >
              <h3 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 8px", color: "#1e293b" }}>
                Update Order Status
              </h3>
              <p style={{ fontSize: "12.5px", color: "#64748b", margin: "0 0 16px" }}>
                Order No: <strong>{editingStatusOrder.order_no}</strong> ({editingStatusOrder.company_name})
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                {[
                  { key: "pending", label: "Pending" },
                  { key: "sales_confirmed", label: "Sales Confirmed" },
                  { key: "admin_approved", label: "Admin Approved" },
                  { key: "acc_confirmed", label: "Acc. Confirmed" },
                  { key: "gatepass_created", label: "Gatepass Created" },
                  { key: "dispatched", label: "Dispatched" },
                  { key: "lr", label: "LR" },
                  { key: "cancelled", label: "Cancelled" },
                ].map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => {
                      const now = new Date();
                      const dateStr = `${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
                      const newGatepass = ["gatepass_created", "dispatched", "lr"].includes(s.key) ? "Generated" : "Pending";

                      setOrders((prev) =>
                        prev.map((it) =>
                          it.id === editingStatusOrder.id
                            ? {
                                ...it,
                                status: s.key,
                                status_updated_at: dateStr,
                                gatepass: newGatepass,
                              }
                            : it
                        )
                      );
                      toast(`Status updated to ${s.label}`, "success");
                      setEditingStatusOrder(null);
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: editingStatusOrder.status === s.key ? "2px solid #0061f2" : "1px solid #e2e8f0",
                      background: editingStatusOrder.status === s.key ? "#eff6ff" : "#ffffff",
                      color: editingStatusOrder.status === s.key ? "#0061f2" : "#334155",
                      fontWeight: editingStatusOrder.status === s.key ? 700 : 500,
                      fontSize: "12.5px",
                      textAlign: "left",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>{s.label}</span>
                    {editingStatusOrder.status === s.key && <span>✓</span>}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setEditingStatusOrder(null)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    background: "#f1f5f9",
                    color: "#475569",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Full Sale Process Detail Modal */}
        {detailOrderId && (
          <SaleProcessDetailModal
            orderId={detailOrderId}
            onClose={() => setDetailOrderId(null)}
            onStatusUpdated={() => {
              fetchOrders();
            }}
          />
        )}
      </main>
    </AppShell>
  );
}

export default SaleProcessListPage;
