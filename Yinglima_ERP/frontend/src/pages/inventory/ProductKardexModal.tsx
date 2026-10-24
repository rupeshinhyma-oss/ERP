/**
 * Product Kardex Transaction Ledger Modal.
 *
 * Displays full chronological history of an item's inward and outward movements
 * with running inventory balance.
 */

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import type { ProductKardexItem } from "@/types/stockMovement";

interface ProductKardexModalProps {
  isOpen: boolean;
  onClose: () => void;
  productName: string;
  productCode?: string | null;
  productId?: string | null;
  currentStock: number;
}

export function ProductKardexModal({
  isOpen,
  onClose,
  productName,
  productCode,
  productId,
  currentStock,
}: ProductKardexModalProps) {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<ProductKardexItem[]>([]);

  useEffect(() => {
    if (!isOpen || !productName) return;

    setLoading(true);
    const query = productId
      ? `/stock/kardex?product_id=${productId}`
      : `/stock/kardex?product_name=${encodeURIComponent(productName)}`;

    apiGet<{ items: ProductKardexItem[] }>(query)
      .then((res) => {
        setHistory(res.data?.items || []);
      })
      .catch(() => {
        setHistory([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, productName, productId]);

  if (!isOpen) return null;

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
          maxHeight: "88vh",
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
            background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>📊</span>
              <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "#0f172a" }}>
                {productName}
              </h2>
              {productCode && (
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    padding: "2px 8px",
                    backgroundColor: "#e2e8f0",
                    color: "#475569",
                    borderRadius: "4px",
                  }}
                >
                  {productCode}
                </span>
              )}
            </div>
            <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#64748b" }}>
              Item Stock Ledger & Transaction History (Kardex)
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                backgroundColor: currentStock > 0 ? "#f0fdf4" : "#fef2f2",
                border: `1px solid ${currentStock > 0 ? "#bbf7d0" : "#fecaca"}`,
                borderRadius: "8px",
                padding: "6px 14px",
                textAlign: "right",
              }}
            >
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b" }}>Current Balance</div>
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: 800,
                  color: currentStock > 0 ? "#16a34a" : "#dc2626",
                }}
              >
                {currentStock.toLocaleString()} units
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
        </div>

        {/* Content Table */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
              Loading transaction history...
            </div>
          ) : history.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
              No stock transactions recorded for this item yet.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ backgroundColor: "#f8fafc", textAlign: "left", color: "#475569" }}>
                  <th style={{ padding: "10px 12px" }}>Date</th>
                  <th style={{ padding: "10px 12px" }}>Movement No</th>
                  <th style={{ padding: "10px 12px" }}>Type</th>
                  <th style={{ padding: "10px 12px" }}>Party / Reference</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" }}>In (+)</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" }}>Out (-)</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" }}>Balance</th>
                  <th style={{ padding: "10px 12px" }}>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 12px", color: "#64748b" }}>{row.movement_date}</td>
                    <td style={{ padding: "10px 12px", fontWeight: 600, color: "#0f172a" }}>
                      {row.movement_no}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: "4px",
                          textTransform: "uppercase",
                          backgroundColor: row.movement_type === "inward" ? "#dcfce7" : "#dbeafe",
                          color: row.movement_type === "inward" ? "#15803d" : "#1d4ed8",
                        }}
                      >
                        {row.movement_type}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ fontWeight: 500, color: "#1e293b" }}>
                        {row.party_name || "—"}
                      </div>
                      {row.reference_no && (
                        <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                          Ref: {row.reference_no}
                        </div>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        textAlign: "right",
                        fontWeight: 600,
                        color: row.qty_in > 0 ? "#16a34a" : "#cbd5e1",
                      }}
                    >
                      {row.qty_in > 0 ? `+${row.qty_in.toLocaleString()}` : "—"}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        textAlign: "right",
                        fontWeight: 600,
                        color: row.qty_out > 0 ? "#2563eb" : "#cbd5e1",
                      }}
                    >
                      {row.qty_out > 0 ? `-${row.qty_out.toLocaleString()}` : "—"}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        textAlign: "right",
                        fontWeight: 700,
                        color: "#0f172a",
                      }}
                    >
                      {row.balance.toLocaleString()}
                    </td>
                    <td style={{ padding: "10px 12px", color: "#64748b", fontSize: "12px" }}>
                      {row.remarks || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 24px",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "flex-end",
            backgroundColor: "#f8fafc",
          }}
        >
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
