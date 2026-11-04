/**
 * Sale Process List Page.
 *
 * Implements the sales workflow modeled after Darsh Impex reference
 * (erp.darshimpexindia.com/sale_order/list), with KPI cards on top,
 * status filter tabs, consignment badges, comprehensive search/filters,
 * and direct integration with Shipment Planning.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Can } from "@/components/ui";
import { apiDelete, apiGet, apiPatch, downloadExport, errorMessage } from "@/lib/api";
import { useLookup } from "@/lib/lookups";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";
import type { SaleOrder, SaleSummaryMetrics } from "@/types/saleProcess";
import {
  getSaleOrdersListCache,
  setSaleOrdersListCache,
  getSaleMetricsCache,
  setSaleMetricsCache,
  removeSaleOrderFromCache,
} from "@/lib/saleProcessCache";
import { SaleProcessDetailModal } from "./SaleProcessDetailModal";
import { SaleProcessOutwardModal } from "./SaleProcessOutwardModal";

export function SaleProcessListPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);

  // Filters state
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<string>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedBuyerId, setSelectedBuyerId] = useState("");
  const [selectedConsignment, setSelectedConsignment] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const listCacheKey = useMemo(() => {
    return JSON.stringify({
      page,
      pageSize,
      search: search.trim(),
      activeTab,
      selectedBuyerId,
      selectedConsignment,
      selectedCurrency,
      dateFrom,
      dateTo,
    });
  }, [page, pageSize, search, activeTab, selectedBuyerId, selectedConsignment, selectedCurrency, dateFrom, dateTo]);

  const metricsCacheKey = useMemo(() => {
    return JSON.stringify({
      selectedBuyerId,
      selectedCurrency,
      dateFrom,
      dateTo,
    });
  }, [selectedBuyerId, selectedCurrency, dateFrom, dateTo]);

  const initialListCache = useMemo(() => getSaleOrdersListCache(listCacheKey), [listCacheKey]);
  const initialMetricsCache = useMemo(() => getSaleMetricsCache(metricsCacheKey), [metricsCacheKey]);

  const [orders, setOrders] = useState<SaleOrder[]>(() => (initialListCache ? initialListCache.items : []));
  const [loading, setLoading] = useState(() => !initialListCache);
  const [total, setTotal] = useState(() => (initialListCache ? initialListCache.total : 0));
  const [selectedOrder, setSelectedOrder] = useState<SaleOrder | null>(null);

  // Metrics
  const [metrics, setMetrics] = useState<SaleSummaryMetrics>(() => initialMetricsCache || {
    all: { count: 0, amount: 0 },
    pending: { count: 0, amount: 0 },
    confirmed: { count: 0, amount: 0 },
    sales_confirmed: { count: 0, amount: 0 },
    admin_approved: { count: 0, amount: 0 },
    dispatched: { count: 0, amount: 0 },
    lr: { count: 0, amount: 0 },
    cancelled: { count: 0, amount: 0 },
    currency: "RMB",
  });

  // Action Menu & Modal State
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const [actionMenuPos, setActionMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [viewOrderId, setViewOrderId] = useState<string | null>(null);
  const [dispatchOrderId, setDispatchOrderId] = useState<string | null>(null);
  const [statusModal, setStatusModal] = useState<{ type: "lr" | "cancel"; order: SaleOrder } | null>(null);
  const [statusModalLrNo, setStatusModalLrNo] = useState("");
  const [statusModalRemarks, setStatusModalRemarks] = useState("");
  const [statusModalSaving, setStatusModalSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Sync deep link query params (from notifications or external links)
  useEffect(() => {
    const s = searchParams.get("search");
    const id = searchParams.get("id");
    if (s) {
      setSearch(s);
    }
    if (id) {
      setViewOrderId(id);
    }
  }, [searchParams]);

  // Close kebab action menu on outside click or scroll
  useEffect(() => {
    if (!openActionId) return;
    const closeMenu = () => {
      setOpenActionId(null);
      setActionMenuPos(null);
    };


    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };


  }, [openActionId]);

  // Lookups
  const buyerLookup = useLookup<{ id: string; company_name: string; name?: string }>(
    "/buyers",
    500
  );

  // Fetch KPI Metrics
  const fetchMetrics = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedBuyerId) params.set("buyer_id", selectedBuyerId);
      if (selectedCurrency) params.set("currency", selectedCurrency);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);

      const res = await apiGet<SaleSummaryMetrics>(`/sales/metrics?${params.toString()}`);
      if (res.data) {
        setMetrics(res.data);
        setSaleMetricsCache(metricsCacheKey, res.data);
      }
    } catch {
      // Non-critical, fallback quietly
    }
  }, [metricsCacheKey, selectedBuyerId, selectedCurrency, dateFrom, dateTo]);

  // Fetch Sale Orders
  const fetchOrders = useCallback(async () => {
    const cached = getSaleOrdersListCache(listCacheKey);
    if (!cached) {
      setLoading(true);
    }
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (search.trim()) params.set("search", search.trim());
      if (activeTab && activeTab !== "all") params.set("status", activeTab);
      if (selectedBuyerId) params.set("buyer_id", selectedBuyerId);
      if (selectedConsignment) params.set("consignment_code", selectedConsignment);
      if (selectedCurrency) params.set("currency", selectedCurrency);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);

      const res = await apiGet<{
        items: SaleOrder[];
        total: number;
        page: number;
        page_size: number;
        total_pages: number;
      }>(`/sales/orders?${params.toString()}`);

      if (res.data) {
        setOrders(res.data.items);
        setTotal(res.data.total);
        setSaleOrdersListCache(listCacheKey, { items: res.data.items, total: res.data.total });
      }
    } catch (err) {
      if (!cached) {
        toast(errorMessage(err), "error");
      }
    } finally {
      setLoading(false);
    }
  }, [listCacheKey, page, pageSize, search, activeTab, selectedBuyerId, selectedConsignment, selectedCurrency, dateFrom, dateTo, toast]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // Delete handler
  const handleDelete = async (orderId: string, orderNo: string) => {
    const confirmed = await confirm({
      title: "Delete Sale Order",
      message: `Are you sure you want to delete Sale Order ${orderNo}? This action cannot be undone.`,
      itemName: orderNo,
      confirmLabel: "Delete Order",
      variant: "danger",
    });
    if (!confirmed) return;
    try {
      await apiDelete(`/sales/orders/${orderId}`);
      toast(`Order ${orderNo} deleted.`, "success");
      removeSaleOrderFromCache(orderId);
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
      setTotal((prev) => Math.max(0, prev - 1));
      fetchOrders();
      fetchMetrics();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };



  // Export handler
  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (activeTab && activeTab !== "all") params.set("status", activeTab);
      if (selectedBuyerId) params.set("buyer_id", selectedBuyerId);
      if (selectedConsignment) params.set("consignment_code", selectedConsignment);
      if (selectedCurrency) params.set("currency", selectedCurrency);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);

      await downloadExport(
        `/sales?${params.toString()}`,
        "xlsx",
        `sales_orders_${new Date().toISOString().slice(0, 10)}`
      );
      toast("Sales orders exported successfully!", "success");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setExporting(false);
    }
  };



  const handleUpdateStatus = async (
    orderId: string,
    newStatus: string,
    extra?: { remarks?: string | null; lr_no?: string | null }
  ): Promise<boolean> => {
    const labels: Record<string, string> = {
      confirmed: "Confirmed",
      pending: "Pending",
      cancelled: "Cancelled",
      lr: "LR Received",
    };
    try {
      await apiPatch(`/sales/orders/${orderId}/status`, { status: newStatus, ...(extra || {}) });
      toast(`Order status changed to ${labels[newStatus] || newStatus.toUpperCase()}.`, "success");
      fetchOrders();
      fetchMetrics();
      return true;
    } catch (err) {
      toast(errorMessage(err), "error");
      return false;
    } finally {
      setOpenActionId(null);
      setActionMenuPos(null);
    }
  };

  const openStatusModal = (type: "lr" | "cancel", order: SaleOrder) => {
    setOpenActionId(null);
    setActionMenuPos(null);
    setStatusModalLrNo(type === "lr" ? order.lr_no || "" : "");
    setStatusModalRemarks("");
    setStatusModal({ type, order });
  };

  const submitStatusModal = async () => {
    if (!statusModal) return;
    setStatusModalSaving(true);
    const ok = await handleUpdateStatus(
      statusModal.order.id,
      statusModal.type === "lr" ? "lr" : "cancelled",
      {
        remarks: statusModalRemarks.trim() || null,
        lr_no: statusModal.type === "lr" ? statusModalLrNo.trim() || null : null,
      }
    );
    setStatusModalSaving(false);
    if (ok) setStatusModal(null);
  };

  const getStatusBadge = (status: string) => {
    const s = (status || "").toLowerCase();
    let bg = "#f1f5f9";
    let color = "#475569";
    let border = "#cbd5e1";
    let label = (status || "PENDING").toUpperCase().replace("_", " ");

    if (s === "pending") {
      bg = "#fef3c7";
      color = "#b45309";
      border = "#fde68a";
    } else if (s === "confirmed" || s === "sales_confirmed") {
      bg = "#e0f2fe";
      color = "#0369a1";
      border = "#bae6fd";
    } else if (s === "admin_approved") {
      bg = "#dcfce7";
      color = "#15803d";
      border = "#bbf7d0";
    } else if (s === "dispatched") {
      bg = "#f3e8ff";
      color = "#7e22ce";
      border = "#e9d5ff";
    } else if (s === "lr") {
      bg = "#ede9fe";
      color = "#4338ca";
      border = "#ddd6fe";
    } else if (s === "cancelled") {
      bg = "#ffe4e6";
      color = "#be123c";
      border = "#fecdd3";
    }

    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "3px 8px",
          borderRadius: "12px",
          fontSize: "11px",
          fontWeight: 700,
          background: bg,
          color: color,
          border: `1px solid ${border}`,
        }}
      >
        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: color }} />
        {label}
      </span>
    );
  };



  const activeFiltersCount = useMemo(() => {
    let cnt = 0;
    if (selectedBuyerId) cnt++;
    if (selectedConsignment) cnt++;
    if (selectedCurrency) cnt++;
    if (dateFrom) cnt++;
    if (dateTo) cnt++;
    return cnt;
  }, [selectedBuyerId, selectedConsignment, selectedCurrency, dateFrom, dateTo]);

  // Tab definitions
  const tabs = [
    { key: "all", label: "ALL", metric: metrics.all },
    { key: "pending", label: "PENDING", metric: metrics.pending },
    { key: "confirmed", label: "CONFIRMED", metric: metrics.confirmed || metrics.sales_confirmed },

    { key: "dispatched", label: "DISPATCHED", metric: metrics.dispatched },
    { key: "lr", label: "LR", metric: metrics.lr },
    { key: "cancelled", label: "CANCELLED", metric: metrics.cancelled },
  ];

  return (
    <AppShell activeKey="sale-process">
      <div style={{ padding: "0 4px" }}>
        {/* Page Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            marginBottom: "16px",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <h1 className="page-title">
                Sale Process
              </h1>
              <span
                style={{
                  fontSize: "12px",
                  padding: "3px 8px",
                  fontWeight: 600,
                  borderRadius: "12px",
                  background: "#e0f2fe",
                  color: "#0369a1",
                  border: "1px solid #bae6fd",
                }}
              >
                {total} Orders
              </span>
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            {/* Filter Toggle (Matching Products Master) */}
            <button
              type="button"
              className={`btn btn-header-filter ${filterOpen ? "active" : ""}`}
              onClick={() => setFilterOpen((prev) => !prev)}
              title="Toggle Filter Options"
              style={{
                background: filterOpen ? "#0061f2" : "#475569",
                color: "#ffffff",
                padding: "8px 12px",
                borderRadius: "6px",
                border: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
              </svg>
              {activeFiltersCount > 0 && (
                <span
                  style={{
                    background: "#ef4444",
                    color: "#ffffff",
                    fontSize: "10px",
                    fontWeight: 800,
                    borderRadius: "10px",
                    padding: "1px 5px",
                    lineHeight: 1,
                  }}
                >
                  {activeFiltersCount}
                </span>
              )}
            </button>

            {/* Create Sale Order Button */}
            <Can permission="sale_process.create">
              <Link
                to="/sale/process/new"
                className="btn btn-add-new"
                style={{
                  background: "#0061f2",
                  color: "#ffffff",
                  border: "none",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "13px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  textDecoration: "none",
                  boxShadow: "0 2px 4px rgba(0,97,242,0.25)",
                }}
              >
                <span>+ Create Sale Process</span>
              </Link>
            </Can>

            {/* Export Button (Matching Products Master Imp / Exp style) */}
            <Can permission="sale_process.export">
              <button
                type="button"
                className="btn btn-imp-exp"
                onClick={handleExport}
                disabled={exporting}
                title="Export Sale Process to Excel"
                style={{
                  background: "#f59e0b",
                  color: "#ffffff",
                  border: "none",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: exporting ? "wait" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 2px 4px rgba(245, 158, 11, 0.25)",
                }}
              >
                <span>{exporting ? "Exporting..." : "Export"}</span>
              </button>
            </Can>
          </div>
        </div>

        {/* KPI Summary Cards (Darsh Impex Pattern) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "12px",
            marginBottom: "16px",
          }}
        >
          {tabs.map((t) => {
            const isSelected = activeTab === t.key;
            return (
              <div
                key={t.key}
                onClick={() => {
                  setActiveTab(t.key);
                  setPage(1);
                }}
                style={{
                  background: isSelected ? "#f8fafc" : "#ffffff",
                  border: isSelected ? "2px solid #0061f2" : "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "12px 14px",
                  cursor: "pointer",
                  transition: "all 0.15s ease-in-out",
                  boxShadow: isSelected
                    ? "0 4px 6px -1px rgba(0,97,242,0.1), 0 2px 4px -2px rgba(0,97,242,0.1)"
                    : "0 1px 3px rgba(0,0,0,0.05)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "4px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: isSelected ? "#0061f2" : "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {t.label}
                  </span>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      padding: "1px 6px",
                      borderRadius: "10px",
                      background: isSelected ? "#0061f2" : "#f1f5f9",
                      color: isSelected ? "#ffffff" : "#475569",
                    }}
                  >
                    {t.metric?.count || 0}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "15px",
                    fontWeight: 800,
                    color: isSelected ? "#0f172a" : "#334155",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {(selectedCurrency === "USD" || metrics.currency === "USD") ? "$ " : "¥ "}
                  {Number(t.metric?.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Collapsible Filter Panel */}
        {filterOpen && (
          <div
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              padding: "16px 20px",
              marginBottom: "16px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <div style={{ fontWeight: 600, fontSize: "14px", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                </svg>
                Filter Options
                {activeFiltersCount > 0 && (
                  <span style={{ background: "#2563eb", color: "#ffffff", padding: "1px 7px", borderRadius: "10px", fontSize: "11px", fontWeight: 700, marginLeft: "4px" }}>
                    {activeFiltersCount}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="btn btn-small"
                style={{
                  background: "#f1f5f9",
                  color: "#475569",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: 600,
                  padding: "5px 14px",
                  fontSize: "12px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
                onClick={() => {
                  setSelectedBuyerId("");
                  setSelectedConsignment("");
                  setSelectedCurrency("");
                  setDateFrom("");
                  setDateTo("");
                  setSearch("");
                  setPage(1);
                }}
              >
                Reset Filters
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "14px",
              }}
            >
              {/* Buyer Filter */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Buyer Company
                </label>
                <select
                  value={selectedBuyerId}
                  onChange={(e) => {
                    setSelectedBuyerId(e.target.value);
                    setPage(1);
                  }}
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="">All Buyers</option>
                  {buyerLookup.items?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.company_name || b.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Consignment Code Filter */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Consignment Code
                </label>
                <input
                  type="text"
                  value={selectedConsignment}
                  onChange={(e) => {
                    setSelectedConsignment(e.target.value);
                    setPage(1);
                  }}
                  placeholder="e.g. MUMINHYMA 1"
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Currency */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Currency
                </label>
                <select
                  value={selectedCurrency}
                  onChange={(e) => {
                    setSelectedCurrency(e.target.value);
                    setPage(1);
                  }}
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="">All Currencies (RMB & USD)</option>
                  <option value="RMB">RMB (¥)</option>
                  <option value="USD">USD ($)</option>
                </select>
              </div>

              {/* Date From */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Date From
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Date To */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Date To
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Orders Table */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          {/* Standard Table Toolbar: Items/Page on left, Medium Search on right (No Freeze option) */}
          <div
            style={{
              padding: "10px 16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "#f8fafc",
              borderBottom: "1px solid #e2e8f0",
              gap: "12px",
            }}
          >
            {/* Left Group: Items/Page */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "13px",
                  background: "#ffffff",
                  cursor: "pointer",
                }}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span style={{ fontSize: "13px", color: "#64748b", fontWeight: 500 }}>Items/Page</span>
            </div>

            {/* Right: Search Input Box (medium breadth) */}
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <input
                type="text"
                placeholder="Search Order No, Consignment, Buyer..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                style={{
                  padding: "7px 32px 7px 32px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  width: "290px",
                  maxWidth: "100%",
                  fontSize: "13px",
                  outline: "none",
                  background: "#ffffff",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  left: "10px",
                  color: "#94a3b8",
                  fontSize: "13px",
                  pointerEvents: "none",
                }}
              >
                🔍
              </span>
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setPage(1);
                  }}
                  title="Clear search"
                  style={{
                    position: "absolute",
                    right: "8px",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#94a3b8",
                    fontSize: "13px",
                    padding: "2px 4px",
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          <div
            className="table-scroll"
            style={{
              overflowX: "auto",
              overflowY: "auto",
              maxHeight: "calc(100vh - 280px)",
              minHeight: "360px",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: "13px" }}>
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    color: "#475569",
                    fontSize: "12px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  <th
                    style={{
                      position: "sticky",
                      top: 0,
                      left: 0,
                      zIndex: 25,
                      background: "#f8fafc",
                      padding: "10px 12px",
                      width: "40px",
                      borderBottom: "2px solid #cbd5e1",
                      boxShadow: "0 2px 3px rgba(0,0,0,0.06)",
                    }}
                  >
                    #
                  </th>
                  <th
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 10,
                      background: "#f8fafc",
                      padding: "10px 12px",
                      whiteSpace: "nowrap",
                      borderBottom: "2px solid #cbd5e1",
                      boxShadow: "0 2px 3px rgba(0,0,0,0.06)",
                    }}
                  >
                    Order Date
                  </th>
                  <th
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 10,
                      background: "#f8fafc",
                      padding: "10px 12px",
                      whiteSpace: "nowrap",
                      borderBottom: "2px solid #cbd5e1",
                      boxShadow: "0 2px 3px rgba(0,0,0,0.06)",
                    }}
                  >
                    Order No
                  </th>
                  <th
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 10,
                      background: "#f8fafc",
                      padding: "10px 12px",
                      whiteSpace: "nowrap",
                      borderBottom: "2px solid #cbd5e1",
                      boxShadow: "0 2px 3px rgba(0,0,0,0.06)",
                    }}
                  >
                    Consignment
                  </th>
                  <th
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 10,
                      background: "#f8fafc",
                      padding: "10px 12px",
                      borderBottom: "2px solid #cbd5e1",
                      boxShadow: "0 2px 3px rgba(0,0,0,0.06)",
                    }}
                  >
                    Buyer / Branch
                  </th>
                  <th
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 10,
                      background: "#f8fafc",
                      padding: "10px 12px",
                      textAlign: "right",
                      whiteSpace: "nowrap",
                      borderBottom: "2px solid #cbd5e1",
                      boxShadow: "0 2px 3px rgba(0,0,0,0.06)",
                    }}
                  >
                    Items Qty
                  </th>
                  <th
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 10,
                      background: "#f8fafc",
                      padding: "10px 12px",
                      textAlign: "right",
                      whiteSpace: "nowrap",
                      borderBottom: "2px solid #cbd5e1",
                      boxShadow: "0 2px 3px rgba(0,0,0,0.06)",
                    }}
                  >
                    Total Amount
                  </th>
                  <th
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 10,
                      background: "#f8fafc",
                      padding: "10px 12px",
                      whiteSpace: "nowrap",
                      borderBottom: "2px solid #cbd5e1",
                      boxShadow: "0 2px 3px rgba(0,0,0,0.06)",
                    }}
                  >
                    Status
                  </th>
                  <th
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 10,
                      background: "#f8fafc",
                      padding: "10px 12px",
                      whiteSpace: "nowrap",
                      borderBottom: "2px solid #cbd5e1",
                      boxShadow: "0 2px 3px rgba(0,0,0,0.06)",
                    }}
                  >
                    Logistics Info
                  </th>
                  <th
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 10,
                      background: "#f8fafc",
                      padding: "10px 12px",
                      textAlign: "center",
                      width: "80px",
                      whiteSpace: "nowrap",
                      borderBottom: "2px solid #cbd5e1",
                      boxShadow: "0 2px 3px rgba(0,0,0,0.06)",
                    }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                      Loading sale orders...
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: "center", padding: "50px", color: "#94a3b8" }}>
                      <div style={{ fontSize: "28px", marginBottom: "8px" }}>📦</div>
                      <div style={{ fontWeight: 600, fontSize: "14px", color: "#475569" }}>No sale process orders found</div>
                      <div style={{ fontSize: "12px", marginTop: "4px" }}>
                        Click &quot;Create Sale Process&quot; to begin a new consignment order.
                      </div>
                    </td>
                  </tr>
                ) : (
                  orders.map((order, idx) => (
                    <tr
                      key={order.id}
                      style={{
                        backgroundColor: idx % 2 === 0 ? "#ffffff" : "#fcfdfe",
                        cursor: "pointer",
                        position: openActionId === order.id ? "relative" : undefined,
                        zIndex: openActionId === order.id ? 150 : undefined,
                      }}
                      onClick={() => {
                        setSelectedOrder(order);
                        setViewOrderId(order.id);
                      }}
                    >
                      <td
                        style={{
                          padding: "10px 12px",
                          color: "#94a3b8",
                          position: "sticky",
                          left: 0,
                          zIndex: openActionId === order.id ? 155 : 5,
                          background: idx % 2 === 0 ? "#ffffff" : "#fcfdfe",
                          borderBottom: "1px solid #f1f5f9",
                        }}
                      >
                        {(page - 1) * pageSize + idx + 1}
                      </td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: "#334155", borderBottom: "1px solid #f1f5f9" }}>
                        {order.order_date}
                      </td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                        <span
                          style={{
                            fontWeight: 700,
                            color: "#0061f2",
                            textDecoration: "none",
                          }}
                        >
                          {order.order_no}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                        {order.consignment_code ? (
                          <span
                            style={{
                              padding: "3px 8px",
                              borderRadius: "4px",
                              background: "#f0f9ff",
                              color: "#0284c7",
                              fontWeight: 600,
                              fontSize: "12px",
                              border: "1px solid #bae6fd",
                            }}
                          >
                            {order.consignment_code}
                          </span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>Direct Sale</span>
                        )}
                      </td>
                      <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>
                        <div style={{ fontWeight: 600, color: "#0f172a" }}>{order.buyer_name}</div>
                        {order.buyer_branch_name && (
                          <div style={{ fontSize: "11px", color: "#64748b" }}>
                            Branch: {order.buyer_branch_name}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                        <span style={{ fontWeight: 600, color: "#0f172a" }}>
                          {Number(order.total_quantity).toLocaleString()} pcs
                        </span>
                        <div style={{ fontSize: "11px", color: "#64748b" }}>
                          {order.item_count} items
                        </div>
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px" }}>
                          <span style={{ fontWeight: 800, color: "#0f172a" }}>
                            {order.currency === "USD" ? "$" : "¥"} {Number(order.total_amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 700,
                              padding: "1px 4px",
                              borderRadius: "3px",
                              background: order.currency === "USD" ? "#ecfdf5" : "#eff6ff",
                              color: order.currency === "USD" ? "#059669" : "#2563eb",
                              border: `1px solid ${order.currency === "USD" ? "#a7f3d0" : "#bfdbfe"}`,
                            }}
                          >
                            {order.currency || "RMB"}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                        <div>{getStatusBadge(order.status)}</div>
                        {order.status === "dispatched" && order.stock_movement_number ? (
                          <div style={{ marginTop: "3px", fontSize: "11px" }}>
                            <a
                              href="/inventory/stock-movements"
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={{ color: "#7e22ce", fontWeight: 600, textDecoration: "none" }}
                              title="View Outward Stock Movement Voucher"
                            >
                              Outward: {order.stock_movement_number}
                            </a>
                          </div>
                        ) : (order.status === "confirmed" || order.status === "sales_confirmed" || order.status === "admin_approved") ? (
                          <Can permission="sale_process.update">
                            <div style={{ marginTop: "4px" }}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDispatchOrderId(order.id);
                                }}
                                title="Dispatch order and deduct stock from warehouse"
                                style={{
                                  background: "#faf5ff",
                                  border: "1px solid #d8b4fe",
                                  color: "#7e22ce",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  borderRadius: "4px",
                                  padding: "2px 7px",
                                  cursor: "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "3px",
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = "#f3e8ff")}
                                onMouseLeave={(e) => (e.currentTarget.style.background = "#faf5ff")}
                              >
                                📤 Dispatch (Outward Stock)
                              </button>
                            </div>
                          </Can>
                        ) : null}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: "12px", color: "#475569", borderBottom: "1px solid #f1f5f9" }}>
                        {order.container_no ? (
                          <div>Cont: <strong>{order.container_no}</strong></div>
                        ) : order.bl_no ? (
                          <div>BL: <strong>{order.bl_no}</strong></div>
                        ) : order.lr_no ? (
                          <div>LR: <strong>{order.lr_no}</strong></div>
                        ) : (
                          null
                        )}
                        {order.etd_origin_date ? (
                          <div style={{ fontSize: "11px", color: "#0284c7" }}>ETD: <strong>{order.etd_origin_date}</strong></div>
                        ) : null}
                        {order.eta_port_date ? (
                          <div style={{ fontSize: "11px", color: "#059669" }}>ETA: <strong>{order.eta_port_date}</strong></div>
                        ) : null}
                        {!order.container_no && !order.bl_no && !order.lr_no && !order.etd_origin_date && !order.eta_port_date && (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          textAlign: "center",
                          position: "relative",
                          borderBottom: "1px solid #f1f5f9",
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (openActionId === order.id) {
                              setOpenActionId(null);
                              setActionMenuPos(null);
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const menuHeight = 240;
                              const spaceBelow = window.innerHeight - rect.bottom;
                              const showAbove = spaceBelow < menuHeight;
                              setActionMenuPos({
                                top: showAbove ? rect.top - menuHeight - 4 : rect.bottom + 4,
                                right: window.innerWidth - rect.right,
                              });
                              setOpenActionId(order.id);
                            }
                          }}
                          style={{
                            background: openActionId === order.id ? "#e2e8f0" : "none",
                            border: "1px solid #cbd5e1",
                            borderRadius: "4px",
                            padding: "4px 8px",
                            cursor: "pointer",
                            fontSize: "14px",
                            color: "#334155",
                          }}
                        >
                          ⋮
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Floating Fixed Action Dropdown (Never Clipped by Table Container) */}
          {openActionId && actionMenuPos && (() => {
            const activeOrder = orders.find((o) => o.id === openActionId);
            if (!activeOrder) return null;
            return (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "fixed",
                  top: `${actionMenuPos.top}px`,
                  right: `${actionMenuPos.right}px`,
                  background: "#ffffff",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  boxShadow: "0 10px 25px rgba(0,0,0,0.18)",
                  zIndex: 99999,
                  minWidth: "145px",
                  textAlign: "left",
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    const id = activeOrder.id;
                    setOpenActionId(null);
                    setActionMenuPos(null);
                    setSelectedOrder(activeOrder);
                    setViewOrderId(id);
                  }}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    border: "none",
                    background: "none",
                    textAlign: "left",
                    fontSize: "13px",
                    cursor: "pointer",
                    color: "#334155",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                >
                  <span>👁️</span> <span>View Details</span>
                </button>

                {activeOrder.status === "pending" && (
                  <Can permission="sale_process.update">
                    <button
                      type="button"
                      onClick={() => handleUpdateStatus(activeOrder.id, "confirmed")}
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        border: "none",
                        background: "#f0fdf4",
                        textAlign: "left",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: "pointer",
                        color: "#16a34a",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        borderTop: "1px solid #f1f5f9",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#dcfce7")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "#f0fdf4")}
                    >
                      <span>✅</span> <span>Confirm Order</span>
                    </button>
                  </Can>
                )}

                {(activeOrder.status === "confirmed" || activeOrder.status === "sales_confirmed") && (
                  <Can permission="sale_process.update">
                    <button
                      type="button"
                      onClick={() => handleUpdateStatus(activeOrder.id, "pending")}
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        border: "none",
                        background: "#fffbeb",
                        textAlign: "left",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: "pointer",
                        color: "#b45309",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        borderTop: "1px solid #f1f5f9",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#fef3c7")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "#fffbeb")}
                    >
                      <span>↩️</span> <span>Revert to Pending</span>
                    </button>
                  </Can>
                )}

                {(activeOrder.status === "confirmed" || activeOrder.status === "sales_confirmed" || activeOrder.status === "admin_approved") ? (
                  <Can permission="sale_process.update">
                    <button
                      type="button"
                      onClick={() => {
                        const id = activeOrder.id;
                        setOpenActionId(null);
                        setActionMenuPos(null);
                        setDispatchOrderId(id);
                      }}
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        border: "none",
                        background: "#faf5ff",
                        textAlign: "left",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: "pointer",
                        color: "#7e22ce",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        borderTop: "1px solid #f1f5f9",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f3e8ff")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "#faf5ff")}
                    >
                      <span>📤</span> <span>Dispatch (Outward Stock)</span>
                    </button>
                  </Can>
                ) : activeOrder.stock_movement_number ? (
                  <div
                    style={{
                      padding: "8px 12px",
                      fontSize: "11.5px",
                      color: "#7e22ce",
                      fontWeight: 600,
                      background: "#faf5ff",
                      borderTop: "1px solid #f1f5f9",
                    }}
                  >
                    ✓ Outward: {activeOrder.stock_movement_number}
                  </div>
                ) : null}

                {activeOrder.status === "dispatched" && (
                  <Can permission="sale_process.update">
                    <button
                      type="button"
                      onClick={() => openStatusModal("lr", activeOrder)}
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        border: "none",
                        background: "#eef2ff",
                        textAlign: "left",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: "pointer",
                        color: "#4338ca",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        borderTop: "1px solid #f1f5f9",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#e0e7ff")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "#eef2ff")}
                    >
                      <span>🚚</span> <span>Mark LR Received</span>
                    </button>
                  </Can>
                )}

                {(activeOrder.status === "pending" || activeOrder.status === "confirmed" || activeOrder.status === "sales_confirmed") && (
                  <Can permission="sale_process.update">
                    <button
                      type="button"
                      onClick={() => openStatusModal("cancel", activeOrder)}
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        border: "none",
                        background: "none",
                        textAlign: "left",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: "pointer",
                        color: "#be123c",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        borderTop: "1px solid #f1f5f9",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#ffe4e6")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                    >
                      <span>❌</span> <span>Cancel Order</span>
                    </button>
                  </Can>
                )}

                {!["dispatched", "lr", "cancelled"].includes(activeOrder.status) && (
                <Can permission="sale_process.update">
                  <button
                    type="button"
                    onClick={() => {
                      const id = activeOrder.id;
                      setOpenActionId(null);
                      setActionMenuPos(null);
                      navigate(`/sale/process/${id}/edit`);
                    }}
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      border: "none",
                      background: "none",
                      textAlign: "left",
                      fontSize: "13px",
                      cursor: "pointer",
                      color: "#334155",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      borderTop: "1px solid #f1f5f9",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    <span>✏️</span> <span>Edit Order</span>
                  </button>
                </Can>
                )}

                {!["dispatched", "lr"].includes(activeOrder.status) && (
                <Can permission="sale_process.delete">
                  <button
                    type="button"
                    onClick={() => {
                      const id = activeOrder.id;
                      const orderNo = activeOrder.order_no;
                      setOpenActionId(null);
                      setActionMenuPos(null);
                      handleDelete(id, orderNo);
                    }}
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      border: "none",
                      background: "none",
                      textAlign: "left",
                      fontSize: "13px",
                      cursor: "pointer",
                      color: "#dc2626",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      borderTop: "1px solid #f1f5f9",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#fee2e2")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    <span>🗑️</span> <span>Delete</span>
                  </button>
                </Can>
                )}
              </div>
            );
          })()}

          {/* LR Received / Cancel Order Modal */}
          {statusModal && (
            <div
              onClick={() => !statusModalSaving && setStatusModal(null)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(15,23,42,0.45)",
                zIndex: 100000,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px",
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "#ffffff",
                  borderRadius: "10px",
                  width: "100%",
                  maxWidth: "440px",
                  boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "14px 18px",
                    borderBottom: "1px solid #e2e8f0",
                    fontSize: "15px",
                    fontWeight: 700,
                    color: statusModal.type === "lr" ? "#4338ca" : "#be123c",
                  }}
                >
                  {statusModal.type === "lr" ? "🚚 Mark LR Received" : "❌ Cancel Sale Order"}
                  <div style={{ fontSize: "12px", fontWeight: 500, color: "#64748b", marginTop: "2px" }}>
                    {statusModal.order.order_no} • {statusModal.order.buyer_name}
                  </div>
                </div>
                <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  {statusModal.type === "cancel" && (
                    <div
                      style={{
                        fontSize: "12.5px",
                        color: "#9f1239",
                        background: "#fff1f2",
                        border: "1px solid #fecdd3",
                        borderRadius: "6px",
                        padding: "8px 10px",
                      }}
                    >
                      This order will move to the CANCELLED tab. No stock will change. A cancelled order cannot be edited, dispatched, or reopened.
                    </div>
                  )}
                  {statusModal.type === "lr" && (
                    <div>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                        LR No (optional)
                      </label>
                      <input
                        type="text"
                        autoFocus
                        value={statusModalLrNo}
                        onChange={(e) => setStatusModalLrNo(e.target.value)}
                        placeholder="e.g. LR-456789"
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "13px",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  )}
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                      {statusModal.type === "lr" ? "Remarks (optional)" : "Reason (optional)"}
                    </label>
                    <textarea
                      rows={2}
                      autoFocus={statusModal.type === "cancel"}
                      value={statusModalRemarks}
                      onChange={(e) => setStatusModalRemarks(e.target.value)}
                      placeholder={statusModal.type === "lr" ? "Any note about LR" : "e.g. Buyer changed quantity"}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                        fontSize: "13px",
                        boxSizing: "border-box",
                        resize: "vertical",
                      }}
                    />
                  </div>
                </div>
                <div
                  style={{
                    padding: "12px 18px",
                    borderTop: "1px solid #e2e8f0",
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "8px",
                    background: "#f8fafc",
                  }}
                >
                  <button
                    type="button"
                    disabled={statusModalSaving}
                    onClick={() => setStatusModal(null)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      background: "#ffffff",
                      color: "#475569",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {statusModal.type === "cancel" ? "Keep Order" : "Close"}
                  </button>
                  <button
                    type="button"
                    disabled={statusModalSaving}
                    onClick={submitStatusModal}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "6px",
                      border: "none",
                      background: statusModal.type === "lr" ? "#4338ca" : "#be123c",
                      color: "#ffffff",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: statusModalSaving ? "wait" : "pointer",
                    }}
                  >
                    {statusModalSaving ? "Saving..." : statusModal.type === "lr" ? "Mark LR Received" : "Cancel Order"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Pagination */}
          <div
            style={{
              padding: "12px 16px",
              borderTop: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "13px",
              color: "#64748b",
            }}
          >
            <div>
              Showing {orders.length > 0 ? (page - 1) * pageSize + 1 : 0} to{" "}
              {Math.min(page * pageSize, total)} of {total} orders
            </div>

            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{
                  padding: "4px 10px",
                  borderRadius: "4px",
                  border: "1px solid #cbd5e1",
                  background: page <= 1 ? "#f8fafc" : "#ffffff",
                  color: page <= 1 ? "#94a3b8" : "#334155",
                  cursor: page <= 1 ? "not-allowed" : "pointer",
                }}
              >
                Previous
              </button>
              <span style={{ padding: "0 6px", fontWeight: 600, color: "#1e293b" }}>
                Page {page} of {Math.max(1, Math.ceil(total / pageSize))}
              </span>
              <button
                type="button"
                disabled={page * pageSize >= total}
                onClick={() => setPage((p) => p + 1)}
                style={{
                  padding: "4px 10px",
                  borderRadius: "4px",
                  border: "1px solid #cbd5e1",
                  background: page * pageSize >= total ? "#f8fafc" : "#ffffff",
                  color: page * pageSize >= total ? "#94a3b8" : "#334155",
                  cursor: page * pageSize >= total ? "not-allowed" : "pointer",
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* View Detail & Workflow Modal */}
      {viewOrderId && (
        <SaleProcessDetailModal
          orderId={viewOrderId}
          initialOrder={selectedOrder}
          onClose={() => {
            setViewOrderId(null);
            setSelectedOrder(null);
          }}
          onStatusUpdated={() => {
            fetchOrders();
            fetchMetrics();
          }}
        />
      )}

      {/* Outward Stock Dispatch Modal */}
      <SaleProcessOutwardModal
        isOpen={!!dispatchOrderId}
        orderId={dispatchOrderId}
        onClose={() => setDispatchOrderId(null)}
        onSuccess={() => {
          fetchOrders();
          fetchMetrics();
        }}
      />
    </AppShell>
  );
}
