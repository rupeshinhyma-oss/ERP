/**
 * Sale Process List Page.
 *
 * Implements the sales workflow modeled after Darsh Impex reference
 * (erp.darshimpexindia.com/sale_order/list), with KPI cards on top,
 * status filter tabs, consignment badges, comprehensive search/filters,
 * and direct integration with Shipment Planning.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { apiDelete, apiGet, downloadExport, errorMessage } from "@/lib/api";
import { useLookup } from "@/lib/lookups";
import { useToast } from "@/lib/toast";
import type { SaleOrder, SaleSummaryMetrics } from "@/types/saleProcess";
import { SaleProcessDetailModal } from "./SaleProcessDetailModal";

export function SaleProcessListPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [orders, setOrders] = useState<SaleOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Metrics
  const [metrics, setMetrics] = useState<SaleSummaryMetrics>({
    all: { count: 0, amount: 0 },
    pending: { count: 0, amount: 0 },
    sales_confirmed: { count: 0, amount: 0 },
    admin_approved: { count: 0, amount: 0 },
    dispatched: { count: 0, amount: 0 },
    lr: { count: 0, amount: 0 },
    cancelled: { count: 0, amount: 0 },
    currency: "RMB",
  });

  // Filters state
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<string>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedBuyerId, setSelectedBuyerId] = useState("");
  const [selectedConsignment, setSelectedConsignment] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Action Menu & Modal State
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const [viewOrderId, setViewOrderId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Close kebab action menu on outside click
  useEffect(() => {
    if (!openActionId) return;
    const handleOutsideClick = () => setOpenActionId(null);
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [openActionId]);

  // Lookups
  const buyerLookup = useLookup<{ id: string; company_name: string; name?: string }>(
    "/buyers?page_size=500",
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
      }
    } catch {
      // Non-critical, fallback quietly
    }
  }, [selectedBuyerId, selectedCurrency, dateFrom, dateTo]);

  // Fetch Sale Orders
  const fetchOrders = useCallback(async () => {
    setLoading(true);
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
      }
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, activeTab, selectedBuyerId, selectedConsignment, selectedCurrency, dateFrom, dateTo, toast]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // Delete handler
  const handleDelete = async (orderId: string, orderNo: string) => {
    if (!window.confirm(`Are you sure you want to delete Sale Order ${orderNo}?`)) return;
    try {
      await apiDelete(`/sales/orders/${orderId}`);
      toast(`Order ${orderNo} deleted.`, "success");
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
    } else if (s === "sales_confirmed") {
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
    { key: "sales_confirmed", label: "SALES CONFIRMED", metric: metrics.sales_confirmed },
    { key: "admin_approved", label: "ADMIN APPROVED", metric: metrics.admin_approved },
    { key: "dispatched", label: "DISPATCHED", metric: metrics.dispatched },
    { key: "lr", label: "LR", metric: metrics.lr },
    { key: "cancelled", label: "CANCELLED", metric: metrics.cancelled },
  ];

  return (
    <AppShell activeKey="sale-process">
      <Breadcrumb trail={["Sale", "Sale Process"]} />

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
              <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: "#0f172a" }}>
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
            <div style={{ marginTop: "4px", color: "#64748b", fontSize: "13px" }}>
              Inter-company sales, container consignment fulfillment & dispatch pipeline
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            {/* Filter Toggle */}
            <button
              type="button"
              onClick={() => setFilterOpen((prev) => !prev)}
              style={{
                background: filterOpen || activeFiltersCount > 0 ? "#0061f2" : "#ffffff",
                color: filterOpen || activeFiltersCount > 0 ? "#ffffff" : "#334155",
                border: "1px solid #cbd5e1",
                padding: "8px 14px",
                borderRadius: "6px",
                fontWeight: 600,
                fontSize: "13px",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              }}
            >
              <span>🔍 Filters</span>
              {activeFiltersCount > 0 && (
                <span
                  style={{
                    background: filterOpen ? "#ffffff" : "#0061f2",
                    color: filterOpen ? "#0061f2" : "#ffffff",
                    fontSize: "10px",
                    fontWeight: 800,
                    borderRadius: "10px",
                    padding: "1px 6px",
                  }}
                >
                  {activeFiltersCount}
                </span>
              )}
            </button>

            {/* Export Button */}
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              style={{
                background: "#ffffff",
                color: "#1e293b",
                border: "1px solid #cbd5e1",
                padding: "8px 14px",
                borderRadius: "6px",
                fontWeight: 600,
                fontSize: "13px",
                cursor: exporting ? "wait" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              }}
            >
              <span>📊</span>
              <span>{exporting ? "Exporting..." : "Export"}</span>
            </button>

            {/* Create Sale Order Button */}
            <Link
              to="/sale/process/new"
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
              <span>+</span>
              <span>Create Sale Process</span>
            </Link>
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
              padding: "16px",
              marginBottom: "16px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            }}
          >
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
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
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
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
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
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            {/* Clear Filters button */}
            {activeFiltersCount > 0 && (
              <div style={{ marginTop: "12px", display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBuyerId("");
                    setSelectedConsignment("");
                    setSelectedCurrency("");
                    setDateFrom("");
                    setDateTo("");
                    setPage(1);
                  }}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    background: "#f1f5f9",
                    color: "#475569",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Clear All Filters
                </button>
              </div>
            )}
          </div>
        )}

        {/* Search Bar */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ position: "relative" }}>
            <input
              type="text"
              placeholder="Search by Order No, Consignment, Buyer Company, Container, BL, or LR No..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              style={{
                width: "100%",
                padding: "9px 12px 9px 36px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                fontSize: "13px",
                boxSizing: "border-box",
                background: "#ffffff",
              }}
            />
            <span
              style={{
                position: "absolute",
                left: "12px",
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: "14px",
                color: "#94a3b8",
              }}
            >
              🔍
            </span>
          </div>
        </div>

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
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr
                  style={{
                    background: "#f8fafc",
                    borderBottom: "1px solid #e2e8f0",
                    textAlign: "left",
                    color: "#475569",
                    fontSize: "12px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  <th style={{ padding: "10px 12px", width: "40px" }}>#</th>
                  <th style={{ padding: "10px 12px" }}>Order Date</th>
                  <th style={{ padding: "10px 12px" }}>Order No</th>
                  <th style={{ padding: "10px 12px" }}>Consignment</th>
                  <th style={{ padding: "10px 12px" }}>Buyer / Branch</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" }}>Items Qty</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" }}>Total Amount</th>
                  <th style={{ padding: "10px 12px" }}>Status</th>
                  <th style={{ padding: "10px 12px" }}>Logistics Info</th>
                  <th style={{ padding: "10px 12px", textAlign: "center", width: "80px" }}>Actions</th>
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
                        borderBottom: "1px solid #f1f5f9",
                        backgroundColor: idx % 2 === 0 ? "#ffffff" : "#fcfdfe",
                        cursor: "pointer",
                      }}
                      onClick={() => setViewOrderId(order.id)}
                    >
                      <td style={{ padding: "10px 12px", color: "#94a3b8" }}>
                        {(page - 1) * pageSize + idx + 1}
                      </td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: "#334155" }}>
                        {order.order_date}
                      </td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
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
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                        {order.consignment_code ? (
                          <span
                            style={{
                              padding: "3px 8px",
                              borderRadius: "4px",
                              background: "#e0f2fe",
                              color: "#0369a1",
                              fontWeight: 700,
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
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{ fontWeight: 600, color: "#0f172a" }}>{order.buyer_name}</div>
                        {order.buyer_branch_name && (
                          <div style={{ fontSize: "11px", color: "#64748b" }}>
                            Branch: {order.buyer_branch_name}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={{ fontWeight: 600, color: "#0f172a" }}>
                          {Number(order.total_quantity).toLocaleString()} pcs
                        </span>
                        <div style={{ fontSize: "11px", color: "#64748b" }}>
                          {order.item_count} items
                        </div>
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px" }}>
                          <span style={{ fontWeight: 800, color: "#0f172a" }}>
                            {order.currency === "USD" ? "$" : "¥"} {Number(order.total_amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 700,
                              padding: "1px 5px",
                              borderRadius: "4px",
                              background: order.currency === "USD" ? "#ecfdf5" : "#eff6ff",
                              color: order.currency === "USD" ? "#047857" : "#1d4ed8",
                              border: `1px solid ${order.currency === "USD" ? "#a7f3d0" : "#bfdbfe"}`,
                            }}
                          >
                            {order.currency || "RMB"}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                        {getStatusBadge(order.status)}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: "12px", color: "#475569" }}>
                        {order.container_no ? (
                          <div>Cont: <strong>{order.container_no}</strong></div>
                        ) : order.bl_no ? (
                          <div>BL: <strong>{order.bl_no}</strong></div>
                        ) : order.lr_no ? (
                          <div>LR: <strong>{order.lr_no}</strong></div>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </td>
                      <td
                        style={{ padding: "10px 12px", textAlign: "center", position: "relative" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenActionId(openActionId === order.id ? null : order.id);
                          }}
                          style={{
                            background: "none",
                            border: "1px solid #e2e8f0",
                            borderRadius: "4px",
                            padding: "4px 8px",
                            cursor: "pointer",
                            fontSize: "14px",
                            color: "#64748b",
                          }}
                        >
                          ⋮
                        </button>

                        {openActionId === order.id && (
                          <div
                            style={{
                              position: "absolute",
                              right: "12px",
                              top: "38px",
                              background: "#ffffff",
                              borderRadius: "6px",
                              border: "1px solid #e2e8f0",
                              boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)",
                              zIndex: 100,
                              minWidth: "140px",
                              textAlign: "left",
                              overflow: "hidden",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setOpenActionId(null);
                                setViewOrderId(order.id);
                              }}
                              style={{
                                width: "100%",
                                padding: "8px 12px",
                                border: "none",
                                background: "none",
                                textAlign: "left",
                                fontSize: "13px",
                                cursor: "pointer",
                                color: "#334155",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                            >
                              👁️ View Details
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setOpenActionId(null);
                                navigate(`/sale/process/${order.id}/edit`);
                              }}
                              style={{
                                width: "100%",
                                padding: "8px 12px",
                                border: "none",
                                background: "none",
                                textAlign: "left",
                                fontSize: "13px",
                                cursor: "pointer",
                                color: "#334155",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                            >
                              ✏️ Edit Order
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setOpenActionId(null);
                                handleDelete(order.id, order.order_no);
                              }}
                              style={{
                                width: "100%",
                                padding: "8px 12px",
                                border: "none",
                                background: "none",
                                textAlign: "left",
                                fontSize: "13px",
                                cursor: "pointer",
                                color: "#dc2626",
                                borderTop: "1px solid #f1f5f9",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "#fee2e2")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                            >
                              🗑️ Delete
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
          onClose={() => setViewOrderId(null)}
          onStatusUpdated={() => {
            fetchOrders();
            fetchMetrics();
          }}
        />
      )}
    </AppShell>
  );
}
