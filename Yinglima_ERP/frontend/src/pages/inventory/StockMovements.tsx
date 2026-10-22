/**
 * Stock Movements Management Page.
 *
 * Provides:
 * - Real-time KPI summary (Total Inward, Total Outward, Net Inventory).
 * - Inward Register (Receipts from Local Purchase or direct).
 * - Outward Register (Dispatches for Sale Orders or direct).
 * - Live Current Stock Balance ledger with 1-click Kardex transaction history.
 */

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Can } from "@/components/ui";
import { apiDelete, apiGet, apiPost, errorMessage } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";
import type {
  StockBalanceItem,
  StockMovement,
  StockMovementType,
  StockSummaryMetrics,
} from "@/types/stockMovement";
import { StockMovementModal } from "./StockMovementModal";
import { StockMovementDetailModal } from "./StockMovementDetailModal";
import { ProductKardexModal } from "./ProductKardexModal";

type ActiveTab = "inward" | "outward" | "balances";

export function StockMovementsPage() {
  const showToast = useToast();
  const confirm = useConfirm();

  const [activeTab, setActiveTab] = useState<ActiveTab>("inward");
  const [metrics, setMetrics] = useState<StockSummaryMetrics | null>(null);

  // Movements state
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [totalMovements, setTotalMovements] = useState(0);

  // Balances state
  const [balances, setBalances] = useState<StockBalanceItem[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);

  // Filters state
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Modals state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<StockMovementType>("inward");
  const [selectedMovement, setSelectedMovement] = useState<StockMovement | null>(null);

  // Kardex modal
  const [kardexProduct, setKardexProduct] = useState<{
    name: string;
    code?: string | null;
    id?: string | null;
    stock: number;
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
    setLoadingMovements(true);
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
      setMovements(res.data?.items || []);
      setTotalMovements(res.data?.total || 0);
    } catch (err) {
      showToast(errorMessage(err) || "Failed to load movements", "error");
    } finally {
      setLoadingMovements(false);
    }
  }, [activeTab, search, dateFrom, dateTo, showToast]);

  // Fetch Live Stock Balances
  const loadBalances = useCallback(async () => {
    if (activeTab !== "balances") return;
    setLoadingBalances(true);
    try {
      const queryParams = new URLSearchParams({ limit: "100" });
      if (search.trim()) queryParams.set("search", search.trim());

      const res = await apiGet<{ items: StockBalanceItem[] }>(
        `/stock/balances?${queryParams.toString()}`
      );
      setBalances(res.data?.items || []);
    } catch (err) {
      showToast(errorMessage(err) || "Failed to load stock balances", "error");
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

  // Cancel Movement Handler
  const handleCancelMovement = async (m: StockMovement) => {
    const confirmed = await confirm({
      title: "Cancel Stock Movement",
      message: `Are you sure you want to cancel movement ${m.movement_no}? This will reverse the stock effect.`,
      itemName: m.movement_no,
      confirmLabel: "Cancel Movement",
      variant: "warning",
    });
    if (!confirmed) return;

    try {
      await apiPost(`/stock/movements/${m.id}/cancel?reason=User+Requested`);
      showToast(`Movement ${m.movement_no} cancelled`, "success");
      loadMovements();
      loadMetrics();
      loadBalances();
    } catch (err) {
      showToast(errorMessage(err) || "Failed to cancel movement", "error");
    }
  };

  // Delete Movement Handler
  const handleDeleteMovement = async (m: StockMovement) => {
    const confirmed = await confirm({
      title: "Permanently Delete Movement",
      message: `Are you sure you want to permanently delete movement ${m.movement_no}? This will remove it from the register and restore stock balances.`,
      itemName: m.movement_no,
      confirmLabel: "Permanently Delete",
      variant: "danger",
    });
    if (!confirmed) return;

    try {
      await apiDelete(`/stock/movements/${m.id}`);
      showToast(`Movement ${m.movement_no} deleted successfully`, "success");
      loadMovements();
      loadMetrics();
      loadBalances();
    } catch (err) {
      showToast(errorMessage(err) || "Failed to delete movement", "error");
    }
  };

  return (
    <AppShell activeKey="stock-movement">
      <div style={{ display: "flex", flexDirection: "column", gap: "24px", paddingBottom: "40px" }}>
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
              📥
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
              📤
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

        {/* Tab Selection Bar & Primary Action Buttons */}
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
          <div style={{ display: "flex", gap: "8px" }}>
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
              <span>📥</span> Inward Register {activeTab === "inward" && totalMovements > 0 ? `(${totalMovements})` : ""}
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
              <span>📤</span> Outward Register {activeTab === "outward" && totalMovements > 0 ? `(${totalMovements})` : ""}
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

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: "10px" }}>
            <Can permission="stock_movement.create">
              <button
                type="button"
                onClick={() => {
                  setModalType("inward");
                  setIsModalOpen(true);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "9px 16px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "#ffffff",
                  border: "none",
                  background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)",
                  cursor: "pointer",
                  boxShadow: "0 2px 4px rgba(22, 163, 74, 0.2)",
                }}
              >
                + New Inward Entry
              </button>

              <button
                type="button"
                onClick={() => {
                  setModalType("outward");
                  setIsModalOpen(true);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "9px 16px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "#ffffff",
                  border: "none",
                  background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
                  cursor: "pointer",
                  boxShadow: "0 2px 4px rgba(37, 99, 235, 0.2)",
                }}
              >
                + New Outward Entry
              </button>
            </Can>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "12px",
            alignItems: "center",
            backgroundColor: "#ffffff",
            padding: "14px 16px",
            borderRadius: "12px",
            border: "1px solid #e2e8f0",
          }}
        >
          <div style={{ flex: "1 1 240px" }}>
            <input
              type="text"
              placeholder={
                activeTab === "balances"
                  ? "Search by Product SKU or Item Name..."
                  : "Search Movement No, Party, Challan, Vehicle, Container, Bill..."
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 14px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                fontSize: "13px",
              }}
            />
          </div>

          {activeTab !== "balances" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>From:</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  style={{
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                  }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>To:</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  style={{
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                  }}
                />
              </div>

              {(search || dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setDateFrom("");
                    setDateTo("");
                  }}
                  style={{
                    padding: "7px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    background: "#f1f5f9",
                    color: "#475569",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Clear Filters
                </button>
              )}
            </>
          )}
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
                      <td colSpan={8} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                        Loading inventory ledger balances...
                      </td>
                    </tr>
                  ) : balances.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                        No stock records found.
                      </td>
                    </tr>
                  ) : (
                    balances.map((b, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "12px 16px", fontWeight: 600, color: "#0f172a" }}>
                          {b.product_name}
                        </td>
                        <td style={{ padding: "12px 16px", color: "#64748b" }}>{b.product_code || "—"}</td>
                        <td style={{ padding: "12px 16px", textAlign: "right", color: "#16a34a", fontWeight: 600 }}>
                          +{b.total_inward_qty.toLocaleString()}
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
                        </td>
                      </tr>
                    ))
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
                    <th style={{ padding: "12px 16px" }}>Movement No</th>
                    <th style={{ padding: "12px 16px" }}>Date</th>
                    <th style={{ padding: "12px 16px" }}>
                      {activeTab === "inward" ? "Supplier / Vendor" : "Buyer / Customer"}
                    </th>
                    <th style={{ padding: "12px 16px" }}>Ref / Challan</th>
                    <th style={{ padding: "12px 16px" }}>Vehicle / Logistics</th>
                    <th style={{ padding: "12px 16px", textAlign: "right" }}>Items</th>
                    <th style={{ padding: "12px 16px", textAlign: "right" }}>Total Qty</th>
                    <th style={{ padding: "12px 16px" }}>Status</th>
                    <th style={{ padding: "12px 16px", textAlign: "center" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingMovements ? (
                    <tr>
                      <td colSpan={9} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                        Loading {activeTab} movements...
                      </td>
                    </tr>
                  ) : movements.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                        No {activeTab} movements found. Click "+ New{" "}
                        {activeTab === "inward" ? "Inward" : "Outward"} Entry" to record one.
                      </td>
                    </tr>
                  ) : (
                    movements.map((m) => (
                      <tr key={m.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "12px 16px", fontWeight: 700, color: "#0f172a" }}>
                          {m.movement_no}
                          <div style={{ fontSize: "11px", fontWeight: 400, color: "#64748b" }}>
                            {m.source_type === "local_purchase"
                              ? `PO: ${m.purchase_invoice_no || "Linked"}`
                              : m.source_type === "sale_process"
                              ? `SO: ${m.sale_order_no || "Linked"}`
                              : "Direct"}
                          </div>
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
                        <td style={{ padding: "12px 16px", textAlign: "center" }}>
                          <div style={{ display: "flex", justifyContent: "center", gap: "8px" }}>
                            <button
                              type="button"
                              onClick={() => setSelectedMovement(m)}
                              style={{
                                padding: "4px 8px",
                                borderRadius: "4px",
                                border: "1px solid #cbd5e1",
                                background: "#ffffff",
                                fontSize: "12px",
                                cursor: "pointer",
                              }}
                            >
                              View
                            </button>
                            <Can permission="stock_movement.cancel">
                              {m.status === "confirmed" && (
                                <button
                                  type="button"
                                  onClick={() => handleCancelMovement(m)}
                                  style={{
                                    padding: "4px 8px",
                                    borderRadius: "4px",
                                    border: "1px solid #fecaca",
                                    background: "#fef2f2",
                                    color: "#dc2626",
                                    fontSize: "12px",
                                    cursor: "pointer",
                                  }}
                                >
                                  Cancel
                                </button>
                              )}
                            </Can>
                            <Can permission="stock_movement.delete">
                              <button
                                type="button"
                                onClick={() => handleDeleteMovement(m)}
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: "4px",
                                  border: "1px solid #fee2e2",
                                  background: "#fff1f2",
                                  color: "#e11d48",
                                  fontSize: "12px",
                                  cursor: "pointer",
                                }}
                                title="Delete movement entry"
                              >
                                Delete
                              </button>
                            </Can>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Creation Modal */}
      {isModalOpen && (
        <StockMovementModal
          isOpen={isModalOpen}
          movementType={modalType}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => {
            loadMovements();
            loadMetrics();
            loadBalances();
          }}
        />
      )}

      {/* Detail Modal */}
      <StockMovementDetailModal
        movement={selectedMovement}
        onClose={() => setSelectedMovement(null)}
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
    </AppShell>
  );
}
