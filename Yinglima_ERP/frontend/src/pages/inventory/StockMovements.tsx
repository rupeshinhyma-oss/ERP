/**
 * Stock Movements Management Page.
 *
 * Provides:
 * - Real-time KPI summary (Total Inward, Total Outward, Net Inventory).
 * - Inward Register (Receipts from Local Purchase or direct).
 * - Outward Register (Dispatches for Sale Orders or direct).
 * - Live Current Stock Balance ledger with 1-click Kardex transaction history
 *   and clickable Product Hyperlinks for full Purchase & Sales Trade History.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { apiGet, errorMessage } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type {
  StockBalanceItem,
  StockMovement,
  StockSummaryMetrics,
} from "@/types/stockMovement";
import { StockMovementDetailModal } from "./StockMovementDetailModal";
import { ProductKardexModal } from "./ProductKardexModal";
import { ProductTradeHistoryDrawer, prefetchProductTradeHistory } from "@/components/ProductTradeHistoryDrawer";

type ActiveTab = "inward" | "outward" | "balances";

const stockMovementsCache = new Map<string, { items: StockMovement[]; total: number }>();
const stockBalancesCache = new Map<string, StockBalanceItem[]>();

export function StockMovementsPage() {
  const showToast = useToast();

  const [activeTab, setActiveTab] = useState<ActiveTab>("inward");
  const [metrics, setMetrics] = useState<StockSummaryMetrics | null>(null);

  // Movements state
  const initialMovementsCache = stockMovementsCache.get("inward");
  const [movements, setMovements] = useState<StockMovement[]>(() => initialMovementsCache?.items || []);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [totalMovements, setTotalMovements] = useState(() => initialMovementsCache?.total || 0);

  // Balances state
  const initialBalancesCache = stockBalancesCache.get("balances");
  const [balances, setBalances] = useState<StockBalanceItem[]>(() => initialBalancesCache || []);
  const [loadingBalances, setLoadingBalances] = useState(false);

  // Filters state
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  const activeFiltersCount =
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);

  // Modals state
  const [selectedMovement, setSelectedMovement] = useState<StockMovement | null>(null);

  // Kardex modal
  const [kardexProduct, setKardexProduct] = useState<{
    name: string;
    code?: string | null;
    id?: string | null;
    stock: number;
  } | null>(null);

  // Product Trade History Drawer (Purchase + Sales History)
  const [historyProduct, setHistoryProduct] = useState<{
    id: string;
    name: string;
    code?: string | null;
  } | null>(null);

  // Fetch KPI Metrics
  const loadMetrics = useCallback(async () => {
    try {
      const res = await apiGet<StockSummaryMetrics>("/stock/metrics");
      if (res.data) setMetrics(res.data);
    } catch {
      // Ignore initial metric fail
    }
  }, []);

  // Fetch Inward/Outward movements
  const loadMovements = useCallback(async () => {
    if (activeTab === "balances") return;
    const cacheKey = `${activeTab}:${search}:${dateFrom}:${dateTo}`;
    const cached = stockMovementsCache.get(cacheKey) || stockMovementsCache.get(activeTab);
    if (cached) {
      setMovements(cached.items);
      setTotalMovements(cached.total);
    } else {
      setLoadingMovements(true);
    }
    try {
      const queryParams = new URLSearchParams({
        movement_type: activeTab,
        limit: "50",
      });
      if (search.trim()) queryParams.set("search", search.trim());
      if (dateFrom) queryParams.set("date_from", dateFrom);
      if (dateTo) queryParams.set("date_to", dateTo);

      const res = await apiGet<{ items: StockMovement[]; total: number }>(
        `/stock/movements?${queryParams.toString()}`
      );
      const items = res.data?.items || [];
      const total = res.data?.total || 0;
      setMovements(items);
      setTotalMovements(total);
      stockMovementsCache.set(cacheKey, { items, total });
      stockMovementsCache.set(activeTab, { items, total });
    } catch (err) {
      if (!cached) showToast(errorMessage(err) || "Failed to load movements", "error");
    } finally {
      setLoadingMovements(false);
    }
  }, [activeTab, search, dateFrom, dateTo, showToast]);

  // Fetch Live Stock Balances
  const loadBalances = useCallback(async () => {
    if (activeTab !== "balances") return;
    const cacheKey = `balances:${search}`;
    const cached = stockBalancesCache.get(cacheKey) || stockBalancesCache.get("balances");
    if (cached) {
      setBalances(cached);
    } else {
      setLoadingBalances(true);
    }
    try {
      const queryParams = new URLSearchParams({ limit: "100" });
      if (search.trim()) queryParams.set("search", search.trim());

      const res = await apiGet<{ items: StockBalanceItem[] }>(
        `/stock/balances?${queryParams.toString()}`
      );
      const items = res.data?.items || [];
      setBalances(items);
      stockBalancesCache.set(cacheKey, items);
      stockBalancesCache.set("balances", items);
    } catch (err) {
      if (!cached) showToast(errorMessage(err) || "Failed to load stock balances", "error");
    } finally {
      setLoadingBalances(false);
    }
  }, [activeTab, search, showToast]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  useEffect(() => {
    if (activeTab === "balances") {
      loadBalances();
    } else {
      loadMovements();
    }
  }, [activeTab, loadMovements, loadBalances]);

  return (
    <AppShell activeKey="stock-movement">
      <main className="page" style={{ width: "100%", padding: "16px 24px" }}>
        {/* Page Header Bar */}
        <div className="page-header" style={{ marginBottom: "16px" }}>
          <div>
            <h1 className="page-title">Stock Movement</h1>
          </div>
          <div className="page-header-actions" style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <Link
              to="/masters/warehouses"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 14px",
                borderRadius: "6px",
                fontSize: "12.5px",
                fontWeight: 600,
                color: "#334155",
                background: "#f8fafc",
                border: "1px solid #cbd5e1",
                textDecoration: "none",
              }}
              title="Manage Warehouse Master locations"
            >
              <span>🏭</span> Warehouse Master
            </Link>
            {activeTab === "inward" ? (
              <Link
                to="/purchase/local"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 14px",
                  borderRadius: "6px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  color: "#047857",
                  background: "#ecfdf5",
                  border: "1px solid #a7f3d0",
                  textDecoration: "none",
                }}
                title="Inward stock is strictly generated from Local Purchases"
              >
                <span>📦</span> Go to Local Purchase &rarr;
              </Link>
            ) : activeTab === "outward" ? (
              <Link
                to="/sale/process"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 14px",
                  borderRadius: "6px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  color: "#7e22ce",
                  background: "#faf5ff",
                  border: "1px solid #d8b4fe",
                  textDecoration: "none",
                }}
                title="Outward stock is strictly generated from Sales Process upon dispatch"
              >
                <span>📤</span> Go to Sales Process &rarr;
              </Link>
            ) : null}

            <button
              type="button"
              className={`btn btn-header-filter ${filterOpen ? "active" : ""}`}
              onClick={() => setFilterOpen((v) => !v)}
              style={{
                background: filterOpen || activeFiltersCount > 0 ? "#0061f2" : "#475569",
                color: "#ffffff",
                padding: "8px 12px",
                borderRadius: "6px",
                border: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                position: "relative",
              }}
              title="Toggle Filter Options"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
              </svg>
              {activeFiltersCount > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: "-5px",
                    right: "-5px",
                    background: "#ef4444",
                    color: "#ffffff",
                    borderRadius: "10px",
                    padding: "1px 5px",
                    fontSize: "10px",
                    fontWeight: 700,
                    lineHeight: "1.2",
                  }}
                >
                  {activeFiltersCount}
                </span>
              )}
            </button>
          </div>
        </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "18px", paddingBottom: "40px" }}>
        {/* Top KPI Metric Cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "16px",
          }}
        >
          {/* Inward Card */}
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              padding: "20px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                Total Inward Received
              </div>
              <div style={{ fontSize: "26px", fontWeight: 800, color: "#16a34a", marginTop: "4px" }}>
                {metrics ? metrics.total_inward_quantity.toLocaleString() : "—"}{" "}
                <span style={{ fontSize: "14px", fontWeight: 500, color: "#64748b" }}>units</span>
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                Across {metrics ? metrics.total_inward_records : 0} confirmed shipments
              </div>
            </div>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "12px",
                backgroundColor: "#dcfce7",
                color: "#16a34a",
                fontSize: "24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </div>
          </div>

          {/* Outward Card */}
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              padding: "20px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                Total Outward Dispatched
              </div>
              <div style={{ fontSize: "26px", fontWeight: 800, color: "#2563eb", marginTop: "4px" }}>
                {metrics ? metrics.total_outward_quantity.toLocaleString() : "—"}{" "}
                <span style={{ fontSize: "14px", fontWeight: 500, color: "#64748b" }}>units</span>
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                Across {metrics ? metrics.total_outward_records : 0} client dispatches
              </div>
            </div>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "12px",
                backgroundColor: "#dbeafe",
                color: "#2563eb",
                fontSize: "24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="3" width="15" height="13" rx="2" />
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                <circle cx="5.5" cy="18.5" r="2.5" />
                <circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
            </div>
          </div>

          {/* Net Available Stock Card */}
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              padding: "20px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                Net Current Warehouse Stock
              </div>
              <div
                style={{
                  fontSize: "26px",
                  fontWeight: 800,
                  color: (metrics?.total_net_stock_quantity || 0) >= 0 ? "#0f172a" : "#dc2626",
                  marginTop: "4px",
                }}
              >
                {metrics ? metrics.total_net_stock_quantity.toLocaleString() : "—"}{" "}
                <span style={{ fontSize: "14px", fontWeight: 500, color: "#64748b" }}>units</span>
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                Live ledger balance (+Inward - Outward)
              </div>
            </div>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "12px",
                backgroundColor: "#f1f5f9",
                color: "#0f172a",
                fontSize: "24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              📊
            </div>
          </div>
        </div>

        {/* Collapsible Filter Options Card */}
        {filterOpen && (
          <div
            className="card"
            style={{
              padding: "16px 20px",
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "12px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "14px",
                paddingBottom: "10px",
                borderBottom: "1px solid #f1f5f9",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13.5px", fontWeight: 700, color: "#1e293b" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                </svg>
                <span>Filter Options</span>
                {activeFiltersCount > 0 && (
                  <span
                    style={{
                      background: "#eff6ff",
                      color: "#2563eb",
                      border: "1px solid #bfdbfe",
                      borderRadius: "999px",
                      padding: "1px 8px",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    {activeFiltersCount} active
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setDateFrom("");
                  setDateTo("");
                }}
                style={{
                  background: "#f1f5f9",
                  border: "1px solid #cbd5e1",
                  color: "#475569",
                  borderRadius: "6px",
                  padding: "5px 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Reset Filters
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "16px",
                alignItems: "flex-end",
              }}
            >
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                  Date From
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                  Date To
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Tab Selection Bar & Inline Quick Search */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            backgroundColor: "#ffffff",
            padding: "12px 16px",
            borderRadius: "12px",
            border: "1px solid #e2e8f0",
          }}
        >
          {/* Tabs */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setActiveTab("inward")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 16px",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                border: "none",
                backgroundColor: activeTab === "inward" ? "#16a34a" : "#f1f5f9",
                color: activeTab === "inward" ? "#ffffff" : "#475569",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              Inward Register {activeTab === "inward" && totalMovements > 0 ? `(${totalMovements})` : ""}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("outward")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 16px",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                border: "none",
                backgroundColor: activeTab === "outward" ? "#2563eb" : "#f1f5f9",
                color: activeTab === "outward" ? "#ffffff" : "#475569",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="3" width="15" height="13" rx="2" />
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                <circle cx="5.5" cy="18.5" r="2.5" />
                <circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
              Outward Register {activeTab === "outward" && totalMovements > 0 ? `(${totalMovements})` : ""}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("balances")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 16px",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                border: "none",
                backgroundColor: activeTab === "balances" ? "#0f172a" : "#f1f5f9",
                color: activeTab === "balances" ? "#ffffff" : "#475569",
              }}
            >
              <span>📊</span> Current Stock Ledger
            </button>
          </div>

          {/* Inline Quick Search Input */}
          <div style={{ position: "relative", minWidth: "280px", flex: "0 1 340px" }}>
            <input
              type="text"
              placeholder={
                activeTab === "balances"
                  ? "Search by Product SKU or Item Name..."
                  : "Search Movement No, Party, Challan, Container..."
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                height: "36px",
                padding: "6px 30px 6px 12px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                fontSize: "13px",
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                title="Clear search"
                style={{
                  position: "absolute",
                  right: "8px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  border: "none",
                  background: "transparent",
                  color: "#94a3b8",
                  cursor: "pointer",
                  fontSize: "14px",
                  padding: "2px",
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Content Table */}
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "14px",
            border: "1px solid #e2e8f0",
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          {activeTab === "balances" ? (
            /* Stock Balances Table */
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ backgroundColor: "#f8fafc", textAlign: "left", color: "#475569" }}>
                    <th style={{ padding: "12px 16px" }}>Product Name</th>
                    <th style={{ padding: "12px 16px" }}>SKU Code</th>
                    <th style={{ padding: "12px 16px", textAlign: "right" }}>Total Inward (+)</th>
                    <th style={{ padding: "12px 16px", textAlign: "right" }}>Damaged Qty</th>
                    <th style={{ padding: "12px 16px", textAlign: "right" }}>Total Outward (-)</th>
                    <th style={{ padding: "12px 16px", textAlign: "right" }}>Current In-Stock</th>
                    <th style={{ padding: "12px 16px" }}>Status</th>
                    <th style={{ padding: "12px 16px" }}>Last Activity</th>
                    <th style={{ padding: "12px 16px", textAlign: "center" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingBalances ? (
                    <tr>
                      <td colSpan={9} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                        Loading inventory ledger balances...
                      </td>
                    </tr>
                  ) : balances.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                        No stock records found.
                      </td>
                    </tr>
                  ) : (
                    balances.map((b, idx) => {
                      const damagedQty = Number(b.total_damaged_qty || 0);
                      return (
                        <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "12px 16px", fontWeight: 600, color: "#0f172a" }}>
                            {b.product_id ? (
                              <div
                                style={{ display: "inline-flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}
                                onMouseEnter={() => prefetchProductTradeHistory(b.product_id)}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setHistoryProduct({
                                      id: b.product_id!,
                                      name: b.product_name,
                                      code: b.product_code,
                                    })
                                  }
                                  style={{
                                    background: "none",
                                    border: "none",
                                    padding: 0,
                                    margin: 0,
                                    fontWeight: 700,
                                    fontSize: "13px",
                                    color: "#2563eb",
                                    textDecoration: "underline",
                                    cursor: "pointer",
                                    textAlign: "left",
                                  }}
                                  title="Click to view complete Purchase & Sales History"
                                >
                                  {b.product_name}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setHistoryProduct({
                                      id: b.product_id!,
                                      name: b.product_name,
                                      code: b.product_code,
                                    })
                                  }
                                  style={{
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    padding: "2px 7px",
                                    borderRadius: "4px",
                                    border: "1px solid #bfdbfe",
                                    background: "#eff6ff",
                                    color: "#1d4ed8",
                                    cursor: "pointer",
                                  }}
                                  title="View Purchase & Sales History"
                                >
                                  📜 History
                                </button>
                              </div>
                            ) : (
                              b.product_name
                            )}
                          </td>
                          <td style={{ padding: "12px 16px", color: "#64748b" }}>{b.product_code || "—"}</td>
                          <td style={{ padding: "12px 16px", textAlign: "right", color: "#16a34a", fontWeight: 600 }}>
                            +{b.total_inward_qty.toLocaleString()}
                          </td>
                          <td
                            style={{
                              padding: "12px 16px",
                              textAlign: "right",
                              fontWeight: damagedQty > 0 ? 700 : 500,
                              color: damagedQty > 0 ? "#dc2626" : "#94a3b8",
                            }}
                          >
                            {damagedQty > 0 ? `${damagedQty.toLocaleString()}` : "0"}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right", color: "#2563eb", fontWeight: 600 }}>
                            -{b.total_outward_qty.toLocaleString()}
                          </td>
                          <td
                            style={{
                              padding: "12px 16px",
                              textAlign: "right",
                              fontWeight: 800,
                              fontSize: "14px",
                              color: b.current_stock_qty > 0 ? "#16a34a" : b.current_stock_qty === 0 ? "#64748b" : "#dc2626",
                            }}
                          >
                            {b.current_stock_qty.toLocaleString()}
                          </td>
                          <td style={{ padding: "12px 16px" }}>
                            <span
                              style={{
                                fontSize: "11px",
                                fontWeight: 700,
                                padding: "3px 8px",
                                borderRadius: "4px",
                                backgroundColor:
                                  b.current_stock_qty > 0 ? "#dcfce7" : b.current_stock_qty === 0 ? "#f1f5f9" : "#fee2e2",
                                color:
                                  b.current_stock_qty > 0 ? "#15803d" : b.current_stock_qty === 0 ? "#64748b" : "#b91c1c",
                              }}
                            >
                              {b.current_stock_qty > 0 ? "IN STOCK" : b.current_stock_qty === 0 ? "ZERO" : "DEFICIT"}
                            </span>
                          </td>
                          <td style={{ padding: "12px 16px", color: "#64748b" }}>
                            {b.last_movement_date || "—"}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "center" }}>
                            <div style={{ display: "inline-flex", gap: "6px", alignItems: "center", justifyContent: "center" }}>
                              {b.product_id && (
                                <button
                                  type="button"
                                  onMouseEnter={() => prefetchProductTradeHistory(b.product_id)}
                                  onClick={() =>
                                    setHistoryProduct({
                                      id: b.product_id!,
                                      name: b.product_name,
                                      code: b.product_code,
                                    })
                                  }
                                  style={{
                                    padding: "4px 10px",
                                    borderRadius: "6px",
                                    border: "1px solid #bfdbfe",
                                    background: "#eff6ff",
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    color: "#1d4ed8",
                                    cursor: "pointer",
                                  }}
                                  title="View Purchase & Sales History"
                                >
                                  📜 Trade History
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setKardexProduct({
                                    name: b.product_name,
                                    code: b.product_code,
                                    id: b.product_id,
                                    stock: b.current_stock_qty,
                                  })
                                }
                                style={{
                                  padding: "4px 10px",
                                  borderRadius: "6px",
                                  border: "1px solid #cbd5e1",
                                  background: "#f8fafc",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  color: "#0f172a",
                                  cursor: "pointer",
                                }}
                              >
                                📊 View Kardex
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            /* Inward / Outward Movement Table */
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ backgroundColor: "#f8fafc", textAlign: "left", color: "#475569" }}>
                    <th style={{ padding: "12px 16px" }}>Invoice No</th>
                    <th style={{ padding: "12px 16px" }}>Date</th>
                    <th style={{ padding: "12px 16px" }}>
                      {activeTab === "inward" ? "Supplier / Vendor" : "Buyer / Customer"}
                    </th>
                    <th style={{ padding: "12px 16px" }}>Ref / Challan</th>
                    <th style={{ padding: "12px 16px" }}>Vehicle / Logistics</th>
                    <th style={{ padding: "12px 16px", textAlign: "right" }}>Items</th>
                    <th style={{ padding: "12px 16px", textAlign: "right" }}>Total Qty</th>
                    <th style={{ padding: "12px 16px" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingMovements ? (
                    <tr>
                      <td colSpan={8} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                        Loading {activeTab} movements...
                      </td>
                    </tr>
                  ) : movements.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                        {activeTab === "inward"
                          ? "No inward movements found. Inward receipts are automatically generated when receiving stock in Local Purchases (/purchase/local)."
                          : "No outward movements found. Outward dispatches are automatically generated when dispatching orders in Sales Process (/sale/process)."}
                      </td>
                    </tr>
                  ) : (
                    movements.map((m) => {
                      const invoiceDisplayNo =
                        (activeTab === "inward"
                          ? m.purchase_invoice_no || m.reference_no
                          : m.sale_order_no || m.reference_no) || m.movement_no;
                      return (
                        <tr key={m.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "12px 16px", fontWeight: 700, color: "#0f172a" }}>
                            <button
                              type="button"
                              onClick={() => setSelectedMovement(m)}
                              style={{
                                background: "none",
                                border: "none",
                                padding: 0,
                                margin: 0,
                                fontWeight: 700,
                                fontSize: "13px",
                                color: "#2563eb",
                                textDecoration: "underline",
                                cursor: "pointer",
                                textAlign: "left",
                              }}
                              title="Click to view movement items & details"
                            >
                              {invoiceDisplayNo}
                            </button>
                          </td>
                          <td style={{ padding: "12px 16px", color: "#475569" }}>{m.movement_date}</td>
                          <td style={{ padding: "12px 16px", fontWeight: 500, color: "#1e293b" }}>
                            {(activeTab === "inward" ? m.supplier_name : m.buyer_name) || "—"}
                          </td>
                          <td style={{ padding: "12px 16px", color: "#64748b" }}>
                            {m.reference_no || "—"}
                          </td>
                          <td style={{ padding: "12px 16px", color: "#64748b" }}>
                            {m.vehicle_no && <div>🚗 {m.vehicle_no}</div>}
                            {m.container_no && <div>📦 {m.container_no}</div>}
                            {!m.vehicle_no && !m.container_no && (m.transporter_name || "—")}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right", color: "#64748b" }}>
                            {m.total_items_count}
                          </td>
                          <td
                            style={{
                              padding: "12px 16px",
                              textAlign: "right",
                              fontWeight: 700,
                              color: activeTab === "inward" ? "#16a34a" : "#2563eb",
                            }}
                          >
                            {m.total_quantity.toLocaleString()}
                          </td>
                          <td style={{ padding: "12px 16px" }}>
                            <span
                              style={{
                                fontSize: "11px",
                                fontWeight: 700,
                                padding: "2px 8px",
                                borderRadius: "4px",
                                backgroundColor:
                                  m.status === "confirmed"
                                    ? "#dcfce7"
                                    : m.status === "cancelled"
                                    ? "#fee2e2"
                                    : "#f1f5f9",
                                color:
                                  m.status === "confirmed"
                                    ? "#15803d"
                                    : m.status === "cancelled"
                                    ? "#b91c1c"
                                    : "#475569",
                                textTransform: "uppercase",
                              }}
                            >
                              {m.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      <StockMovementDetailModal
        movement={selectedMovement}
        onClose={() => setSelectedMovement(null)}
        onViewProductHistory={(product) => setHistoryProduct(product)}
      />

      {/* Product Kardex Modal */}
      {kardexProduct && (
        <ProductKardexModal
          isOpen={!!kardexProduct}
          productName={kardexProduct.name}
          productCode={kardexProduct.code}
          productId={kardexProduct.id}
          currentStock={kardexProduct.stock}
          onClose={() => setKardexProduct(null)}
        />
      )}

      {/* Product Trade History Drawer (Purchase History + Sales History) */}
      <ProductTradeHistoryDrawer
        productId={historyProduct?.id ?? null}
        productName={historyProduct?.name}
        productCode={historyProduct?.code}
        open={Boolean(historyProduct)}
        onClose={() => setHistoryProduct(null)}
      />
      </main>
    </AppShell>
  );
}
