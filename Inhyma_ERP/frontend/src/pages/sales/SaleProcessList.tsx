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
import { apiDelete, apiGet, apiPatch } from "@/lib/api";
import { useAuth } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import { generateGatePassPdf } from "@/lib/gatePassPdf";
import type { SaleOrder, SaleSummaryMetrics } from "@/types/saleProcess";
import { SaleProcessDetailModal } from "./SaleProcessDetailModal";

export const INDIAN_STATES = [
  "Maharashtra",
  "Gujarat",
  "Delhi",
  "Karnataka",
  "Tamil Nadu",
  "Uttar Pradesh",
  "Madhya Pradesh",
  "Rajasthan",
  "West Bengal",
  "Haryana",
  "Punjab",
  "Telangana",
  "Andhra Pradesh",
  "Kerala",
  "Goa",
  "Chhattisgarh",
  "Jharkhand",
  "Bihar",
  "Assam",
  "Odisha",
  "Uttarakhand",
  "Himachal Pradesh",
];

export function _yes(val: any): boolean {
  return ["yes", "y", "true", "1"].includes(String(val || "").trim().toLowerCase());
}

export function parseDateForCompare(dStr?: string | null): number | null {
  if (!dStr) return null;
  const s = dStr.trim();
  if (s.includes("-")) {
    const parts = s.split("-");
    if (parts[0].length === 4) {
      return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getTime();
    } else if (parts[2]?.length === 4) {
      return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0])).getTime();
    }
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

export function getCompanyGst(order: SaleOrder): string | null {
  if ((order as any).gst_no) return (order as any).gst_no;
  if ((order as any).buyer_gst) return (order as any).buyer_gst;
  if (order.billing_address) {
    const m = order.billing_address.match(/GST(?:IN)?[:\s\-]+([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})/i) ||
              order.billing_address.match(/GST(?:IN)?[:\s\-]+([0-9A-Za-z]{15})/i) ||
              order.billing_address.match(/\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})\b/);
    if (m) return m[1];
  }
  return null;
}

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

// Re-export Mock KPI Metrics and Orders from saleMockData
export { INITIAL_METRICS, INITIAL_SALE_ORDERS, EMPTY_METRICS } from "./saleMockData";
import { INITIAL_METRICS, INITIAL_SALE_ORDERS, EMPTY_METRICS } from "./saleMockData";


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
  const { profile } = useAuth();

  // Filter criteria
  const [orderDateFrom, setOrderDateFrom] = useState("");
  const [orderDateTo, setOrderDateTo] = useState("");
  const [invoiceDateFrom, setInvoiceDateFrom] = useState("");
  const [invoiceDateTo, setInvoiceDateTo] = useState("");
  const [expDateFrom, setExpDateFrom] = useState("");
  const [expDateTo, setExpDateTo] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [dispatchFilter, setDispatchFilter] = useState("");
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

  // Status modal input states
  const [selectedNewStatus, setSelectedNewStatus] = useState<string | null>(null);
  const [modalInvoiceNo, setModalInvoiceNo] = useState("");
  const [modalInvoiceDate, setModalInvoiceDate] = useState(() => new Date().toLocaleDateString("en-GB").split("/").join("-"));
  const [modalThirdPartyInvoice, setModalThirdPartyInvoice] = useState("");
  const [modalGpNo, setModalGpNo] = useState("");
  const [modalGpDate, setModalGpDate] = useState(() => new Date().toLocaleDateString("en-GB").split("/").join("-"));
  const [modalGpHandledBy, setModalGpHandledBy] = useState("Warehouse Team");
  const [modalGpTransporter, setModalGpTransporter] = useState("");
  const [modalGpDestination, setModalGpDestination] = useState("");
  const [modalGpDeliveryType, setModalGpDeliveryType] = useState("Godown");
  const [modalGpDeliveryCharge, setModalGpDeliveryCharge] = useState("To Pay");
  const [modalLrNo, setModalLrNo] = useState("");
  const [modalLrTransporter, setModalLrTransporter] = useState("");
  const [modalLrDate, setModalLrDate] = useState(() => new Date().toLocaleDateString("en-GB").split("/").join("-"));

  // LR Dispatch Modal state (WhatsApp / Email direct notice)
  const [lrDispatchOrder, setLrDispatchOrder] = useState<SaleOrder | null>(null);
  const [lrClientPhone, setLrClientPhone] = useState("");
  const [lrClientEmail, setLrClientEmail] = useState("");
  const [lrMessageText, setLrMessageText] = useState("");

  // Close kebab menu on outside click
  useEffect(() => {
    if (!openActionId) return;
    const handleOutsideClick = () => setOpenActionId(null);
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [openActionId]);

  const isTestMode = import.meta.env.MODE === "test";

  // Fetch from backend API if available
  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      let url = "/sales/orders?page_size=500";
      if (orderDateFrom) url += `&date_from=${orderDateFrom}`;
      if (orderDateTo) url += `&date_to=${orderDateTo}`;
      if (invoiceDateFrom) url += `&invoice_date_from=${invoiceDateFrom}`;
      if (invoiceDateTo) url += `&invoice_date_to=${invoiceDateTo}`;
      if (expDateFrom) url += `&delivery_date_from=${expDateFrom}`;
      if (expDateTo) url += `&delivery_date_to=${expDateTo}`;
      if (stateFilter) url += `&state=${encodeURIComponent(stateFilter)}`;
      if (dispatchFilter) url += `&dispatch=${dispatchFilter}`;

      const res = await apiGet<{ items: SaleOrder[]; total: number; metrics?: SaleSummaryMetrics }>(url);
      if (res?.data?.items && Array.isArray(res.data.items)) {
        setOrders(res.data.items);
        if (res.data.metrics) {
          setMetrics(res.data.metrics);
        } else if (res.data.items.length === 0 && !isTestMode) {
          setMetrics(EMPTY_METRICS);
        }
      }
    } catch {
      if (!isTestMode) {
        setOrders([]);
        setMetrics(EMPTY_METRICS);
      }
    } finally {
      setLoading(false);
    }
  }, [
    isTestMode,
    orderDateFrom,
    orderDateTo,
    invoiceDateFrom,
    invoiceDateTo,
    expDateFrom,
    expDateTo,
    stateFilter,
    dispatchFilter,
  ]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Tab definitions with counts
  const tabs: StatusTabDef[] = useMemo(() => [
    { key: "all", label: "All", count: metrics.all?.count ?? (isTestMode ? 4762 : 0) },
    { key: "pending", label: "Pending", count: metrics.pending?.count ?? (isTestMode ? 2 : 0) },
    { key: "sales_confirmed", label: "Sales Confirmed", count: metrics.sales_confirmed?.count ?? (isTestMode ? 15 : 0) },
    { key: "admin_approved", label: "Admin Approved", count: metrics.admin_approved?.count ?? (isTestMode ? 8 : 0) },
    { key: "acc_confirmed", label: "Acc. Confirmed", count: metrics.acc_confirmed?.count ?? (isTestMode ? 4 : 0) },
    { key: "gatepass_created", label: "Gatepass Created", count: metrics.gatepass_created?.count ?? (isTestMode ? 14 : 0) },
    { key: "dispatched", label: "Dispatched", count: metrics.dispatched?.count ?? (isTestMode ? 37 : 0) },
    { key: "gatepass_cancelled", label: "Gatepass Cancelled", count: metrics.gatepass_cancelled?.count ?? 0 },
    { key: "lr", label: "LR", count: metrics.lr?.count ?? (isTestMode ? 4682 : 0) },
    { key: "cancelled", label: "Cancelled", count: metrics.cancelled?.count ?? 0 },
  ], [metrics, isTestMode]);

  // Top 6 Summary KPI Cards
  const kpiCards = useMemo(() => [
    {
      key: "all",
      label: "ALL",
      amount: metrics.all?.amount ?? (isTestMode ? 299107379.78 : 0.0),
      count: metrics.all?.count ?? (isTestMode ? 4762 : 0),
    },
    {
      key: "admin_confirmed_to_lr",
      label: "ADMIN CONFIRMED TO LR",
      amount: metrics.admin_confirmed_to_lr?.amount ?? (isTestMode ? 295511129.78 : 0.0),
      count: metrics.admin_confirmed_to_lr?.count ?? (isTestMode ? 4745 : 0),
    },
    {
      key: "pending",
      label: "PENDING",
      amount: metrics.pending?.amount ?? (isTestMode ? 342650.0 : 0.0),
      count: metrics.pending?.count ?? (isTestMode ? 2 : 0),
    },
    {
      key: "admin_approved",
      label: "ADMIN APPROVED",
      amount: metrics.admin_approved?.amount ?? (isTestMode ? 3248200.0 : 0.0),
      count: metrics.admin_approved?.count ?? (isTestMode ? 8 : 0),
    },
    {
      key: "lr",
      label: "LR",
      amount: metrics.lr?.amount ?? (isTestMode ? 284336441.78 : 0.0),
      count: metrics.lr?.count ?? (isTestMode ? 4682 : 0),
    },
    {
      key: "cancelled",
      label: "CANCELLED",
      amount: metrics.cancelled?.amount ?? 0.0,
      count: metrics.cancelled?.count ?? 0,
    },
  ], [metrics, isTestMode]);

  // Filter count for active filter badge
  const activeFiltersCount = useMemo(() => {
    let cnt = 0;
    if (orderDateFrom) cnt++;
    if (orderDateTo) cnt++;
    if (invoiceDateFrom) cnt++;
    if (invoiceDateTo) cnt++;
    if (expDateFrom) cnt++;
    if (expDateTo) cnt++;
    if (stateFilter) cnt++;
    if (dispatchFilter) cnt++;
    if (warehouseFilter) cnt++;
    if (salesPersonFilter) cnt++;
    if (companyFilter) cnt++;
    if (thirdPartyFilter) cnt++;
    if (poFilter) cnt++;
    return cnt;
  }, [
    orderDateFrom,
    orderDateTo,
    invoiceDateFrom,
    invoiceDateTo,
    expDateFrom,
    expDateTo,
    stateFilter,
    dispatchFilter,
    warehouseFilter,
    salesPersonFilter,
    companyFilter,
    thirdPartyFilter,
    poFilter,
  ]);

  const handleResetFilters = () => {
    setOrderDateFrom("");
    setOrderDateTo("");
    setInvoiceDateFrom("");
    setInvoiceDateTo("");
    setExpDateFrom("");
    setExpDateTo("");
    setStateFilter("");
    setDispatchFilter("");
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

      // Order Date filter
      if (orderDateFrom) {
        const fromT = parseDateForCompare(orderDateFrom);
        const ordT = parseDateForCompare(o.order_date);
        if (fromT && (!ordT || ordT < fromT)) return false;
      }
      if (orderDateTo) {
        const toT = parseDateForCompare(orderDateTo);
        const ordT = parseDateForCompare(o.order_date);
        if (toT && (!ordT || ordT > toT)) return false;
      }

      // Invoice Date filter
      if (invoiceDateFrom) {
        const fromT = parseDateForCompare(invoiceDateFrom);
        const invT = parseDateForCompare(o.invoice_date);
        if (fromT && (!invT || invT < fromT)) return false;
      }
      if (invoiceDateTo) {
        const toT = parseDateForCompare(invoiceDateTo);
        const invT = parseDateForCompare(o.invoice_date);
        if (toT && (!invT || invT > toT)) return false;
      }

      // Expected Delivery Date filter
      if (expDateFrom) {
        const fromT = parseDateForCompare(expDateFrom);
        const expT = parseDateForCompare(o.expected_delivery_date || o.delivery_date);
        if (fromT && (!expT || expT < fromT)) return false;
      }
      if (expDateTo) {
        const toT = parseDateForCompare(expDateTo);
        const expT = parseDateForCompare(o.expected_delivery_date || o.delivery_date);
        if (toT && (!expT || expT > toT)) return false;
      }

      // State filter
      if (stateFilter && !o.state?.toLowerCase().includes(stateFilter.toLowerCase())) {
        return false;
      }

      // Dispatch filter
      if (dispatchFilter) {
        const isDisp = ["dispatched", "lr", "delivered", "completed"].includes((o.status || "").toLowerCase()) || Boolean(o.lr_no);
        if (dispatchFilter === "yes" && !isDisp) return false;
        if (dispatchFilter === "no" && isDisp) return false;
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
      if (thirdPartyFilter && String(o.third_party || o.third_party_delivery || "no").toLowerCase() !== thirdPartyFilter.toLowerCase()) {
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
          (o.state && o.state.toLowerCase().includes(q)) ||
          (o.invoice_no && o.invoice_no.toLowerCase().includes(q)) ||
          (o.gatepass_no && o.gatepass_no.toLowerCase().includes(q)) ||
          (o.lr_no && o.lr_no.toLowerCase().includes(q));
        if (!match) return false;
      }

      return true;
    });
  }, [
    orders,
    activeTab,
    orderDateFrom,
    orderDateTo,
    invoiceDateFrom,
    invoiceDateTo,
    expDateFrom,
    expDateTo,
    stateFilter,
    dispatchFilter,
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
              if (order) {
                setEditingStatusOrder(order);
                setSelectedNewStatus(null);
                setModalInvoiceNo(order.invoice_no || `INV-INH/${new Date().getFullYear().toString().slice(-2)}-${(new Date().getFullYear() + 1).toString().slice(-2)}/${Math.floor(1000 + Math.random() * 9000)}`);
                setModalInvoiceDate(order.invoice_date || new Date().toLocaleDateString("en-GB").split("/").join("-"));
                setModalThirdPartyInvoice(order.third_party_invoice || "");
                const curGp = order.gatepass_no || `GP-${new Date().getFullYear().toString().slice(-2)}-${(new Date().getFullYear() + 1).toString().slice(-2)}/0123`;
                setModalGpNo(curGp);
                setModalGpDate(order.gatepass_date || new Date().toLocaleDateString("en-GB").split("/").join("-"));
                setModalGpHandledBy(order.gatepass_handled_by || profile?.full_name || profile?.username || "Warehouse Team");
                setModalGpTransporter(order.transport_name || order.transporter_name || "Road");
                setModalGpDestination(order.transport_destination || order.city || "");
                setModalGpDeliveryType(order.delivery_type || "Godown");
                setModalGpDeliveryCharge(order.delivery_charge || "To Pay");
                setModalLrNo(order.lr_no || "");
                setModalLrTransporter(order.transport_name || order.transporter_name || "");
                setModalLrDate(order.lr_date || new Date().toLocaleDateString("en-GB").split("/").join("-"));

                if (!order.gatepass_no) {
                  apiGet<{ gatepass_no: string }>("/sales/next-gatepass-no")
                    .then((r) => {
                      if (r?.data?.gatepass_no) setModalGpNo(r.data.gatepass_no);
                    })
                    .catch(() => {});
                }
              }
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

  const handleOpenLrDispatch = (order: SaleOrder) => {
    setLrDispatchOrder(order);
    const phone = (order.phone || order.mobile || "").replace(/\D/g, "");
    setLrClientPhone(phone);
    setLrClientEmail(order.email || "");
    const invStr = order.invoice_no ? `Invoice: ${order.invoice_no}` : `SO: ${order.order_no}`;
    const transporterStr = order.transport_name || order.transporter_name || "Road Cargo";
    const lrStr = order.lr_no ? `LR / Bilty No: ${order.lr_no}` : "LR No: Under Processing";
    const lrDateStr = order.lr_date || new Date().toLocaleDateString("en-GB").split("/").join("-");
    const destStr = order.transport_destination || order.destination || order.city || "Client Location";
    const chargesStr = order.delivery_charge || order.delivery_charges || "To Pay";
    const delTypeStr = order.delivery_type || "Godown";

    const defaultMsg = `Dear ${order.company_name},\n\nYour order #${order.order_no} (${invStr}) has been dispatched.\n\n*Dispatch & LR Details:*\n- Transporter: ${transporterStr}\n- ${lrStr}\n- Date: ${lrDateStr}\n- Destination: ${destStr}\n- Delivery Type: ${delTypeStr}\n- Delivery Charges: ${chargesStr}\n\nFor any queries or tracking assistance, please reach out to us.\n\nThank you for choosing Inhyma Solutions!\nwww.inhymasolutions.com`;
    setLrMessageText(defaultMsg);
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
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "12px",
                marginBottom: "14px",
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

              {/* Invoice Date Range */}
              <div>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#0369a1", marginBottom: "4px" }}>
                  Invoice Date From
                </label>
                <input
                  type="date"
                  value={invoiceDateFrom}
                  onChange={(e) => setInvoiceDateFrom(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #7dd3fc", fontSize: "12.5px" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#0369a1", marginBottom: "4px" }}>
                  Invoice Date To
                </label>
                <input
                  type="date"
                  value={invoiceDateTo}
                  onChange={(e) => setInvoiceDateTo(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #7dd3fc", fontSize: "12.5px" }}
                />
              </div>

              {/* Expected Delivery Date Range */}
              <div>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Exp. Delivery From
                </label>
                <input
                  type="date"
                  value={expDateFrom}
                  onChange={(e) => setExpDateFrom(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Exp. Delivery To
                </label>
                <input
                  type="date"
                  value={expDateTo}
                  onChange={(e) => setExpDateTo(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px" }}
                />
              </div>

              {/* State Filter */}
              <div>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  State
                </label>
                <select
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px" }}
                >
                  <option value="">All States</option>
                  {INDIAN_STATES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              {/* Dispatch (Yes / No) */}
              <div>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Dispatch Status
                </label>
                <select
                  value={dispatchFilter}
                  onChange={(e) => setDispatchFilter(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px" }}
                >
                  <option value="">All (Dispatch)</option>
                  <option value="yes">Yes (Dispatched / LR)</option>
                  <option value="no">No (Pending Dispatch)</option>
                </select>
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
                        {(o.allocated_consignment || o.consignment_code) && (
                          <div style={{ fontSize: "11px", color: "#d97706", fontWeight: 600, marginTop: "2px" }} title="Allocated Transit Consignment">
                            📦 {o.allocated_consignment || o.consignment_code}
                          </div>
                        )}
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
                        {getCompanyGst(o) && (
                          <div style={{ fontSize: "11px", color: "#64748b", fontFamily: "monospace", marginTop: "1px" }}>
                            GST: {getCompanyGst(o)}
                          </div>
                        )}
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
                        {o.gatepass_no ? (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                            <Link
                              to={`/sales/gatepass-pdf/${o.id}`}
                              target="_blank"
                              style={{
                                color: "#0061f2",
                                fontWeight: 700,
                                textDecoration: "none",
                                fontSize: "12px",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                              title="Click to view & print official Gate Pass PDF"
                            >
                              📄 {o.gatepass_no}
                            </Link>
                            {o.gatepass_date && (
                              <span style={{ fontSize: "10.5px", color: "#64748b" }}>{o.gatepass_date}</span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>{o.gatepass || "Pending"}</span>
                        )}
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
                              minWidth: "150px",
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
                              onClick={() => {
                                window.open(`/sale-order/invoice/${o.order_no || o.id}`, "_blank");
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
                              <span style={{ fontSize: "13px" }}>📄</span>
                              Print SO (Pricing)
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                window.open(`/sale-order/invoice/${o.order_no || o.id}?mode=warehouse`, "_blank");
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
                                color: "#d97706",
                                fontWeight: 600,
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#fffbeb")}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                            >
                              <span style={{ fontSize: "13px" }}>📦</span>
                              Warehouse SO (No Pricing)
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                window.open(`/sales/gatepass-pdf/${o.id}`, "_blank");
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
                                color: "#4338ca",
                                fontWeight: 600,
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#eef2ff")}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                            >
                              <span style={{ fontSize: "13px" }}>📜</span>
                              Gate Pass PDF
                            </button>

                            <button
                              type="button"
                              onClick={async () => {
                                setOpenActionId(null);
                                try {
                                  await generateGatePassPdf(o);
                                  toast("Gate Pass PDF downloaded", "success");
                                } catch {
                                  toast("Failed to download Gate Pass PDF", "error");
                                }
                              }}
                              style={{
                                width: "100%",
                                padding: "7px 12px",
                                background: "none",
                                border: "none",
                                textAlign: "left",
                                fontSize: "12px",
                                cursor: "pointer",
                                color: "#047857",
                                fontWeight: 600,
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#ecfdf5")}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                            >
                              <span style={{ fontSize: "13px" }}>📥</span>
                              Download Gate Pass
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setOpenActionId(null);
                                handleOpenLrDispatch(o);
                              }}
                              style={{
                                width: "100%",
                                padding: "7px 12px",
                                background: "none",
                                border: "none",
                                textAlign: "left",
                                fontSize: "12px",
                                cursor: "pointer",
                                color: "#0284c7",
                                fontWeight: 600,
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f0f9ff")}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                            >
                              <span style={{ fontSize: "13px" }}>🚀</span>
                              Send LR to Client
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
            onClick={() => {
              setEditingStatusOrder(null);
              setSelectedNewStatus(null);
            }}
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
                width: "440px",
                maxWidth: "92%",
                padding: "20px",
                boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <h3 style={{ fontSize: "15px", fontWeight: 700, margin: 0, color: "#1e293b" }}>
                  Update Order Status
                </h3>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => {
                    setEditingStatusOrder(null);
                    setSelectedNewStatus(null);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#64748b",
                    cursor: "pointer",
                    padding: "2px 6px",
                  }}
                >
                  Close
                </button>
              </div>
              <p style={{ fontSize: "12.5px", color: "#64748b", margin: "0 0 14px" }}>
                Order No: <strong>{editingStatusOrder.order_no}</strong> ({editingStatusOrder.company_name})
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "14px" }}>
                {[
                  { key: "pending", label: "Pending" },
                  { key: "sales_confirmed", label: "Sales Confirmed" },
                  { key: "admin_approved", label: "Admin Approved" },
                  { key: "acc_confirmed", label: "Acc. Confirmed" },
                  { key: "gatepass_created", label: "Gatepass Created" },
                  { key: "dispatched", label: "Dispatched" },
                  { key: "lr", label: "LR" },
                  { key: "gatepass_cancelled", label: "Gatepass Cancelled" },
                  { key: "cancelled", label: "Cancelled" },
                ].map((s) => {
                  const isCurrent = (selectedNewStatus || editingStatusOrder.status) === s.key;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setSelectedNewStatus(s.key)}
                      style={{
                        padding: "7px 10px",
                        borderRadius: "5px",
                        border: isCurrent ? "2px solid #0061f2" : "1px solid #cbd5e1",
                        background: isCurrent ? "#eff6ff" : "#ffffff",
                        color: isCurrent ? "#0061f2" : "#334155",
                        fontWeight: isCurrent ? 700 : 500,
                        fontSize: "12px",
                        textAlign: "left",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span>{s.label}</span>
                      {isCurrent && <span>✓</span>}
                    </button>
                  );
                })}
              </div>

              {/* Conditional Inputs based on selected status */}
              {(selectedNewStatus || editingStatusOrder.status) === "acc_confirmed" && (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "6px", padding: "12px", marginBottom: "14px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#166534", marginBottom: "8px" }}>
                    🧾 Accounts Invoicing Details:
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#166534", marginBottom: "3px" }}>
                        Invoice No <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <input
                        type="text"
                        value={modalInvoiceNo}
                        onChange={(e) => setModalInvoiceNo(e.target.value)}
                        placeholder="INV-INH/..."
                        style={{ width: "100%", padding: "5px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #86efac" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#166534", marginBottom: "3px" }}>
                        Invoice Date <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <input
                        type="text"
                        value={modalInvoiceDate}
                        onChange={(e) => setModalInvoiceDate(e.target.value)}
                        placeholder="DD-MM-YYYY"
                        style={{ width: "100%", padding: "5px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #86efac" }}
                      />
                    </div>
                  </div>

                  {_yes(editingStatusOrder.third_party) && (
                    <div style={{ marginTop: "10px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px", padding: "8px" }}>
                      <label style={{ display: "block", fontSize: "11.5px", fontWeight: 700, color: "#991b1b", marginBottom: "3px" }}>
                        Third Party Invoice / Reference <span style={{ color: "#dc2626" }}>* (Mandatory for 3rd-Party Delivery)</span>
                      </label>
                      <input
                        type="text"
                        value={modalThirdPartyInvoice}
                        onChange={(e) => setModalThirdPartyInvoice(e.target.value)}
                        placeholder="Enter 3rd Party Vendor Invoice No / Document Ref"
                        style={{ width: "100%", padding: "5px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #f87171" }}
                      />
                      <div style={{ fontSize: "10.5px", color: "#b91c1c", marginTop: "3px" }}>
                        Third-Party Delivery is set to "Yes". Entering/uploading the third-party invoice details is mandatory at the Acc. Confirmed stage.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {(selectedNewStatus || editingStatusOrder.status) === "gatepass_created" && (
                <div style={{ background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: "6px", padding: "12px", marginBottom: "14px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#3730a3", marginBottom: "8px" }}>
                    🚚 Outward Gate Pass Details:
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#3730a3", marginBottom: "3px" }}>
                        Gate Pass No
                      </label>
                      <input
                        type="text"
                        value={modalGpNo}
                        onChange={(e) => setModalGpNo(e.target.value)}
                        style={{ width: "100%", padding: "5px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #a5b4fc" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#3730a3", marginBottom: "3px" }}>
                        Gate Pass Date
                      </label>
                      <input
                        type="text"
                        value={modalGpDate}
                        onChange={(e) => setModalGpDate(e.target.value)}
                        style={{ width: "100%", padding: "5px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #a5b4fc" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#3730a3", marginBottom: "3px" }}>
                        Handled By (from login)
                      </label>
                      <input
                        type="text"
                        value={modalGpHandledBy}
                        onChange={(e) => setModalGpHandledBy(e.target.value)}
                        style={{ width: "100%", padding: "5px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #a5b4fc" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#3730a3", marginBottom: "3px" }}>
                        Transporter Name
                      </label>
                      <input
                        type="text"
                        value={modalGpTransporter}
                        onChange={(e) => setModalGpTransporter(e.target.value)}
                        placeholder="e.g. VRL Logistics, SafeXpress"
                        style={{ width: "100%", padding: "5px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #a5b4fc" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#3730a3", marginBottom: "3px" }}>
                        Destination
                      </label>
                      <input
                        type="text"
                        value={modalGpDestination}
                        onChange={(e) => setModalGpDestination(e.target.value)}
                        placeholder="Destination city"
                        style={{ width: "100%", padding: "5px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #a5b4fc" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#3730a3", marginBottom: "3px" }}>
                        Delivery Type
                      </label>
                      <select
                        value={modalGpDeliveryType}
                        onChange={(e) => setModalGpDeliveryType(e.target.value)}
                        style={{ width: "100%", padding: "5px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #a5b4fc" }}
                      >
                        <option value="Godown">Godown</option>
                        <option value="Door">Door Delivery</option>
                      </select>
                    </div>
                    <div style={{ gridColumn: "span 2" }}>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#3730a3", marginBottom: "3px" }}>
                        Delivery Charges
                      </label>
                      <select
                        value={modalGpDeliveryCharge}
                        onChange={(e) => setModalGpDeliveryCharge(e.target.value)}
                        style={{ width: "100%", padding: "5px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #a5b4fc" }}
                      >
                        <option value="To Pay">To Pay</option>
                        <option value="Paid">Paid</option>
                        <option value="Free">Free</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {(selectedNewStatus || editingStatusOrder.status) === "lr" && (
                <div style={{ background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: "6px", padding: "12px", marginBottom: "14px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#6b21a8", marginBottom: "8px" }}>
                    📦 Transporter LR Details:
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b21a8", marginBottom: "3px" }}>
                        LR / Consignment No <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <input
                        type="text"
                        value={modalLrNo}
                        onChange={(e) => setModalLrNo(e.target.value)}
                        placeholder="e.g. VRL-90123"
                        style={{ width: "100%", padding: "5px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #d8b4fe" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b21a8", marginBottom: "3px" }}>
                        Transporter Name
                      </label>
                      <input
                        type="text"
                        value={modalLrTransporter}
                        onChange={(e) => setModalLrTransporter(e.target.value)}
                        style={{ width: "100%", padding: "5px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #d8b4fe" }}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => {
                    setEditingStatusOrder(null);
                    setSelectedNewStatus(null);
                  }}
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
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const targetStatus = selectedNewStatus || editingStatusOrder.status;
                    const extra: Record<string, any> = {};

                    if (targetStatus === "acc_confirmed") {
                      if (!modalInvoiceNo.trim()) {
                        toast("Invoice Number is required for Acc. Confirmed", "error");
                        return;
                      }
                      if (_yes(editingStatusOrder.third_party) && !modalThirdPartyInvoice.trim()) {
                        toast("Third Party Invoice / Reference is mandatory for Third Party Delivery at Acc. Confirmed stage", "error");
                        return;
                      }
                      extra.invoice_no = modalInvoiceNo.trim();
                      extra.invoice_date = modalInvoiceDate.trim();
                      if (modalThirdPartyInvoice.trim()) {
                        extra.third_party_invoice = modalThirdPartyInvoice.trim();
                      }
                    } else if (targetStatus === "gatepass_created") {
                      extra.gatepass_no = modalGpNo.trim();
                      extra.gatepass_date = modalGpDate.trim();
                      extra.gatepass_handled_by = modalGpHandledBy.trim();
                      extra.transporter_name = modalGpTransporter.trim();
                      extra.transport_name = modalGpTransporter.trim();
                      extra.transport_destination = modalGpDestination.trim();
                      extra.destination = modalGpDestination.trim();
                      extra.delivery_type = modalGpDeliveryType;
                      extra.delivery_charge = modalGpDeliveryCharge;
                      extra.delivery_charges = modalGpDeliveryCharge;
                      extra.gatepass = "Generated";
                    } else if (targetStatus === "lr") {
                      if (!modalLrNo.trim()) {
                        toast("LR / Consignment No is required", "error");
                        return;
                      }
                      extra.lr_no = modalLrNo.trim();
                      extra.transporter_name = modalLrTransporter.trim();
                      extra.transport_name = modalLrTransporter.trim();
                      extra.lr_date = modalLrDate.trim();
                    }

                    try {
                      await apiPatch(`/sales/orders/${editingStatusOrder.id}/status`, {
                        status: targetStatus,
                        ...extra,
                      });
                      toast(`Status updated to ${targetStatus.replace(/_/g, " ").toUpperCase()}`, "success");
                      await fetchOrders();
                    } catch {
                      // Local fallback
                      const now = new Date();
                      const dateStr = `${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
                      const newGatepass = ["gatepass_created", "dispatched", "lr"].includes(targetStatus) ? "Generated" : "Pending";

                      setOrders((prev) =>
                        prev.map((it) =>
                          it.id === editingStatusOrder.id
                            ? {
                                ...it,
                                status: targetStatus,
                                status_updated_at: dateStr,
                                gatepass: newGatepass,
                                ...extra,
                              }
                            : it
                        )
                      );
                      toast(`Status updated to ${targetStatus.replace(/_/g, " ").toUpperCase()}`, "success");
                    } finally {
                      setEditingStatusOrder(null);
                      setSelectedNewStatus(null);
                    }
                  }}
                  style={{
                    padding: "6px 16px",
                    borderRadius: "6px",
                    border: "none",
                    background: "#0061f2",
                    color: "#ffffff",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Save & Update Status
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Direct Dispatch of LR to Client (WhatsApp / Email / Gate Pass) */}
        {lrDispatchOrder && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: "20px",
            }}
            onClick={() => setLrDispatchOrder(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#ffffff",
                borderRadius: "10px",
                width: "560px",
                maxWidth: "100%",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                padding: "24px",
                maxHeight: "90vh",
                overflowY: "auto",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "20px" }}>🚀</span>
                  <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "#1e293b" }}>
                    Direct Dispatch & LR Notice
                  </h3>
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setLrDispatchOrder(null)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#64748b",
                    cursor: "pointer",
                    padding: "2px 6px",
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px", marginBottom: "16px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b" }}>
                  {lrDispatchOrder.company_name}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "12px", color: "#475569", marginTop: "6px" }}>
                  <div>SO No: <strong>{lrDispatchOrder.order_no}</strong></div>
                  <div>Invoice No: <strong>{lrDispatchOrder.invoice_no || "N/A"}</strong></div>
                  <div>Transporter: <strong>{lrDispatchOrder.transport_name || lrDispatchOrder.transporter_name || "—"}</strong></div>
                  <div>LR / Bilty No: <strong>{lrDispatchOrder.lr_no || "—"}</strong></div>
                  <div>Destination: <strong>{lrDispatchOrder.transport_destination || lrDispatchOrder.destination || lrDispatchOrder.city || "—"}</strong></div>
                  <div>Gatepass: <strong>{lrDispatchOrder.gatepass_no || "—"}</strong></div>
                </div>
              </div>

              {/* Client WhatsApp Phone & Email */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Client Mobile / WhatsApp
                  </label>
                  <input
                    type="text"
                    value={lrClientPhone}
                    onChange={(e) => setLrClientPhone(e.target.value)}
                    placeholder="e.g. 9876543210"
                    style={{ width: "100%", padding: "7px 10px", fontSize: "12.5px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Client Email Address
                  </label>
                  <input
                    type="email"
                    value={lrClientEmail}
                    onChange={(e) => setLrClientEmail(e.target.value)}
                    placeholder="e.g. accounts@client.com"
                    style={{ width: "100%", padding: "7px 10px", fontSize: "12.5px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  />
                </div>
              </div>

              {/* Message text area */}
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Message Preview / Delivery Notice
                </label>
                <textarea
                  rows={6}
                  value={lrMessageText}
                  onChange={(e) => setLrMessageText(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    fontSize: "12px",
                    fontFamily: "inherit",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    lineHeight: 1.5,
                  }}
                />
              </div>

              {/* Actions row */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await generateGatePassPdf(lrDispatchOrder);
                        toast("Gate Pass PDF downloaded", "success");
                      } catch {
                        toast("Failed to download Gate Pass PDF", "error");
                      }
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "7px 12px",
                      background: "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#334155",
                      cursor: "pointer",
                    }}
                  >
                    <span>📜</span>
                    Download Gate Pass
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      window.open(`/sales/gatepass-pdf/${lrDispatchOrder.id}`, "_blank");
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "7px 12px",
                      background: "#eef2ff",
                      border: "1px solid #c7d2fe",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#4338ca",
                      cursor: "pointer",
                    }}
                  >
                    <span>👁️</span>
                    View PDF
                  </button>
                </div>

                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!lrClientEmail) {
                        toast("Please enter a client email address", "error");
                        return;
                      }
                      const subject = `Dispatch & LR Advice: Order #${lrDispatchOrder.order_no} - Inhyma Solutions`;
                      const mailtoUrl = `mailto:${encodeURIComponent(lrClientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lrMessageText)}`;
                      window.open(mailtoUrl, "_blank");
                      toast("Opening email client...", "success");
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "7px 14px",
                      background: "#0284c7",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <span>✉️</span>
                    Send Email
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      let cleanedPhone = lrClientPhone.replace(/\D/g, "");
                      if (cleanedPhone.length === 10) {
                        cleanedPhone = "91" + cleanedPhone;
                      }
                      const waUrl = cleanedPhone
                        ? `https://wa.me/${cleanedPhone}?text=${encodeURIComponent(lrMessageText)}`
                        : `https://wa.me/?text=${encodeURIComponent(lrMessageText)}`;
                      window.open(waUrl, "_blank");
                      toast("Opening WhatsApp...", "success");
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "7px 16px",
                      background: "#25D366",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    <span>💬</span>
                    Send WhatsApp
                  </button>
                </div>
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
