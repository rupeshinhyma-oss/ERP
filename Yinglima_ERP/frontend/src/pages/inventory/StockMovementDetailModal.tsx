/**
 * Stock Movement Detail Modal.
 *
 * Full read-only view of a confirmed or cancelled Inward/Outward transaction.
 */

import { useEffect } from "react";
import { prefetchProductTradeHistory } from "@/components/ProductTradeHistoryDrawer";
import type { StockMovement } from "@/types/stockMovement";

interface StockMovementDetailModalProps {
  movement: StockMovement | null;
  onClose: () => void;
  onViewProductHistory?: (product: {
    id: string;
    name: string;
    code?: string | null;
  }) => void;
}

export function StockMovementDetailModal({
  movement,
  onClose,
  onViewProductHistory,
}: StockMovementDetailModalProps) {
  useEffect(() => {
    if (!movement?.items) return;
    for (const it of movement.items) {
      if (it.product_id) {
        prefetchProductTradeHistory(it.product_id);
      }
    }
  }, [movement]);

  if (!movement) return null;

  const isInward = movement.movement_type === "inward";
  const invoiceDisplayNo =
    (isInward
      ? movement.purchase_invoice_no || movement.reference_no
      : movement.sale_order_no || movement.reference_no) || movement.movement_no;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.75)",
        backdropFilter: "blur(6px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "960px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: isInward
              ? "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)"
              : "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span
              style={{
                backgroundColor: isInward ? "#16a34a" : "#2563eb",
                color: "#fff",
                width: "42px",
                height: "42px",
                borderRadius: "10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: isInward
                  ? "0 4px 10px rgba(22, 163, 74, 0.25)"
                  : "0 4px 10px rgba(37, 99, 235, 0.25)",
              }}
            >
              {isInward ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="3" width="15" height="13" rx="2" />
                  <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                  <circle cx="5.5" cy="18.5" r="2.5" />
                  <circle cx="18.5" cy="18.5" r="2.5" />
                </svg>
              )}
            </span>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "#0f172a" }}>
                  {invoiceDisplayNo}
                </h2>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: "4px",
                    backgroundColor:
                      movement.status === "confirmed"
                        ? "#dcfce7"
                        : movement.status === "cancelled"
                        ? "#fee2e2"
                        : "#f1f5f9",
                    color:
                      movement.status === "confirmed"
                        ? "#15803d"
                        : movement.status === "cancelled"
                        ? "#b91c1c"
                        : "#475569",
                    textTransform: "uppercase",
                  }}
                >
                  {movement.status}
                </span>
              </div>
              <p style={{ margin: "2px 0 0 0", fontSize: "13px", color: "#64748b" }}>
                {isInward ? "Stock Inward Receipt" : "Stock Outward Dispatch"} • {movement.movement_date}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "#ffffff",
              color: "#64748b",
              borderRadius: "8px",
              width: "36px",
              height: "36px",
              cursor: "pointer",
              fontSize: "18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}
          >
            ✕
          </button>
        </div>

        {/* Body Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Metadata Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "16px",
              padding: "16px",
              backgroundColor: "#f8fafc",
              borderRadius: "12px",
              border: "1px solid #e2e8f0",
            }}
          >
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
                {isInward ? "Supplier / Vendor" : "Buyer / Customer"}
              </div>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a", marginTop: "2px" }}>
                {(isInward ? movement.supplier_name : movement.buyer_name) || "—"}
              </div>
            </div>

            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
                Source & Ref
              </div>
              <div style={{ fontSize: "14px", fontWeight: 500, color: "#0f172a", marginTop: "2px" }}>
                {movement.source_type === "local_purchase"
                  ? `Local Purchase: ${movement.purchase_invoice_no || "Linked"}`
                  : movement.source_type === "sale_process"
                  ? `Sale Order: ${movement.sale_order_no || "Linked"}`
                  : "Direct Manual Entry"}
              </div>
              {movement.reference_no && (
                <div style={{ fontSize: "12px", color: "#64748b" }}>Ref: {movement.reference_no}</div>
              )}
            </div>

            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
                Warehouse Location
              </div>
              <div style={{ fontSize: "14px", fontWeight: 500, color: "#0f172a", marginTop: "2px" }}>
                {movement.warehouse_location || "—"}
              </div>
            </div>

            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
                Logistics & Transport
              </div>
              <div style={{ fontSize: "13px", color: "#0f172a", marginTop: "2px" }}>
                {movement.transporter_name && <div>🚚 {movement.transporter_name}</div>}
                {movement.vehicle_no && <div>🚗 Vehicle: {movement.vehicle_no}</div>}
                {movement.container_no && <div>📦 Cont: {movement.container_no}</div>}
                {!movement.transporter_name && !movement.vehicle_no && !movement.container_no && "—"}
              </div>
            </div>
          </div>

          {/* Line Items Table */}
          <div style={{ border: "1px solid #e2e8f0", borderRadius: "12px", overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontWeight: 700, fontSize: "13px", color: "#334155" }}>
              Movement Items ({movement.items?.length || 0})
            </div>
            <div style={{ maxHeight: "380px", overflowY: "auto", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 2,
                    backgroundColor: "#f1f5f9",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                  }}
                >
                  <tr style={{ textAlign: "left", color: "#475569" }}>
                    <th style={{ padding: "10px 12px" }}>Product</th>
                    <th style={{ padding: "10px 12px" }}>Code</th>
                    <th style={{ padding: "10px 12px", textAlign: "right" }}>Expected</th>
                    <th style={{ padding: "10px 12px", textAlign: "right" }}>
                      {isInward ? "Received" : "Dispatched"}
                    </th>
                    {isInward && (
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>Damaged</th>
                    )}
                    <th style={{ padding: "10px 12px", textAlign: "right" }}>Net Accepted</th>
                    <th style={{ padding: "10px 12px" }}>Package</th>
                  </tr>
                </thead>
                <tbody>
                  {movement.items?.map((it, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 500, color: "#0f172a" }}>
                        {it.product_id && onViewProductHistory ? (
                          <div
                            style={{ display: "inline-flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}
                            onMouseEnter={() => prefetchProductTradeHistory(it.product_id)}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                onViewProductHistory({
                                  id: it.product_id!,
                                  name: it.product_name,
                                  code: it.product_code,
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
                              {it.product_name}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onViewProductHistory({
                                  id: it.product_id!,
                                  name: it.product_name,
                                  code: it.product_code,
                                })
                              }
                              style={{
                                fontSize: "10.5px",
                                fontWeight: 700,
                                padding: "2px 6px",
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
                          it.product_name
                        )}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#64748b" }}>
                        {it.product_code || "—"}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#64748b" }}>
                        {it.expected_quantity.toLocaleString()}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>
                        {it.quantity.toLocaleString()}
                      </td>
                      {isInward && (
                        <td
                          style={{
                            padding: "10px 12px",
                            textAlign: "right",
                            color: it.damaged_quantity > 0 ? "#dc2626" : "#64748b",
                          }}
                        >
                          {it.damaged_quantity.toLocaleString()}
                        </td>
                      )}
                      <td
                        style={{
                          padding: "10px 12px",
                          textAlign: "right",
                          fontWeight: 700,
                          color: isInward ? "#16a34a" : "#2563eb",
                        }}
                      >
                        {it.accepted_quantity.toLocaleString()}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#64748b" }}>
                        {it.package_details || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div
              style={{
                padding: "12px 16px",
                backgroundColor: "#f8fafc",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "flex-end",
                gap: "24px",
                fontSize: "14px",
              }}
            >
              <span>
                Total Net Movement Qty:{" "}
                <strong style={{ color: isInward ? "#16a34a" : "#2563eb", fontSize: "16px" }}>
                  {movement.total_quantity.toLocaleString()}
                </strong>
              </span>
            </div>
          </div>

          {movement.remarks && (
            <div style={{ fontSize: "13px", color: "#475569" }}>
              <strong>Remarks:</strong> {movement.remarks}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 24px",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor: "#f8fafc",
          }}
        >
          <div style={{ fontSize: "12px", color: "#64748b" }}>
            Recorded by: <strong>{movement.created_by_name || "Admin"}</strong> on{" "}
            {new Date(movement.created_at).toLocaleString()}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 18px",
              borderRadius: "8px",
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
