/**
 * Local Purchase Details View Modal.
 *
 * Provides a corporate, read-only preview modal when clicking an invoice number,
 * displaying Order Details, Supplier (From), Organization (To), Quick Metrics,
 * Value-Based Landing Expenses, and Product Summary Table.
 *
 * Engineered with compact fluid design so all columns fit seamlessly without
 * horizontal scrolling.
 */

import { useEffect, useState } from "react";
import { apiGet, errorMessage } from "@/lib/api";
import type { LocalPurchaseDetail } from "@/types/localPurchase";

interface LocalPurchaseDetailModalProps {
  purchaseId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (id: string) => void;
}

export function LocalPurchaseDetailModal({
  purchaseId,
  isOpen,
  onClose,
  onEdit,
}: LocalPurchaseDetailModalProps) {
  const [detail, setDetail] = useState<LocalPurchaseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !purchaseId) {
      setDetail(null);
      setError(null);
      return;
    }

    const fetchDetail = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiGet<LocalPurchaseDetail>(`/purchases/local/${purchaseId}`);
        if (res.data) {
          setDetail(res.data);
        } else {
          setError("Purchase order record not found.");
        }
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [isOpen, purchaseId]);

  if (!isOpen) return null;

  const currencySymbol =
    detail?.currency === "RMB" ? "¥" : detail?.currency === "INR" ? "₹" : detail?.currency === "USD" ? "$" : "¥";

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return "—";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const formatDateTime = (dateStr?: string | null) => {
    if (!dateStr) return "—";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100020,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        boxSizing: "border-box",
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(15, 23, 42, 0.55)",
          backdropFilter: "blur(3px)",
        }}
      />

      {/* Modal Dialog Card - Widescreen compact layout */}
      <div
        style={{
          position: "relative",
          width: "1260px",
          maxWidth: "97vw",
          maxHeight: "92vh",
          background: "#ffffff",
          borderRadius: "12px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid #cbd5e1",
          boxSizing: "border-box",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#ffffff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
              Local Purchase Details
            </h2>
            {detail && (
              <span
                style={{
                  padding: "2px 8px",
                  fontSize: "11px",
                  fontWeight: 700,
                  borderRadius: "20px",
                  background: detail.status.toLowerCase() === "confirmed" ? "#e0edff" : "#f1f5f9",
                  color: detail.status.toLowerCase() === "confirmed" ? "#0061f2" : "#475569",
                  border: detail.status.toLowerCase() === "confirmed" ? "1px solid #bfdbfe" : "1px solid #cbd5e1",
                  letterSpacing: "0.3px",
                }}
              >
                {detail.status}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: "none",
              border: "none",
              fontSize: "18px",
              cursor: "pointer",
              color: "#64748b",
              lineHeight: 1,
              padding: "4px 8px",
              borderRadius: "4px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body (Scrollable vertically if needed, zero horizontal scroll) */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "14px 20px",
            background: "#f8fafc",
          }}
        >
          {loading && (
            <div style={{ padding: "50px 20px", textAlign: "center", color: "#64748b" }}>
              <div style={{ fontSize: "26px", marginBottom: "8px" }}>⏳</div>
              <div style={{ fontSize: "13.5px", fontWeight: 600 }}>Loading local purchase details...</div>
            </div>
          )}

          {error && !loading && (
            <div
              style={{
                padding: "18px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "8px",
                color: "#dc2626",
                textAlign: "center",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>Failed to Load Purchase Details</div>
              <div style={{ fontSize: "13px" }}>{error}</div>
              <button
                type="button"
                onClick={onClose}
                style={{
                  marginTop: "12px",
                  padding: "6px 14px",
                  background: "#ffffff",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "12.5px",
                }}
              >
                Close
              </button>
            </div>
          )}

          {detail && !loading && (
            <div>
              {/* SECTION 1: Top 3-Column Info Card */}
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  marginBottom: "12px",
                  display: "grid",
                  gridTemplateColumns: "1fr 1.2fr 1.2fr",
                  gap: "16px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                }}
              >
                {/* Order Detail */}
                <div style={{ borderRight: "1px solid #f1f5f9", paddingRight: "10px" }}>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      marginBottom: "4px",
                    }}
                  >
                    Order Detail
                  </div>
                  <div style={{ fontSize: "12.5px", color: "#1e293b", lineHeight: "1.6" }}>
                    <div>
                      <span style={{ color: "#64748b" }}>Created: </span>
                      <strong>{formatDateTime(detail.created_at)}</strong>
                    </div>
                    <div>
                      <span style={{ color: "#64748b" }}>Created By: </span>
                      <strong>{detail.created_by_name || "Admin"}</strong>
                    </div>
                    <div>
                      <span style={{ color: "#64748b" }}>Currency: </span>
                      <strong style={{ color: "#0061f2" }}>
                        {detail.currency} ({currencySymbol})
                      </strong>
                    </div>
                  </div>
                </div>

                {/* From (Supplier) */}
                <div style={{ borderRight: "1px solid #f1f5f9", paddingRight: "10px" }}>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      marginBottom: "4px",
                    }}
                  >
                    From (Supplier)
                  </div>
                  <div style={{ fontSize: "12.5px", color: "#1e293b", lineHeight: "1.6" }}>
                    <div style={{ fontWeight: 700, fontSize: "13.5px", color: "#0f172a" }}>
                      {detail.supplier_name}
                    </div>
                    <div style={{ fontSize: "11.5px", color: "#64748b" }}>
                      Domestic Factory / Vendor
                    </div>
                  </div>
                </div>

                {/* To (Organization / Branch) */}
                <div>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      marginBottom: "4px",
                    }}
                  >
                    To (Receiving Location)
                  </div>
                  <div style={{ fontSize: "12.5px", color: "#1e293b", lineHeight: "1.6" }}>
                    <div style={{ fontWeight: 700, fontSize: "13.5px", color: "#0f172a" }}>
                      {detail.organization_name}
                    </div>
                    <div>
                      <span style={{ color: "#64748b" }}>Branch: </span>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "1px 6px",
                          fontSize: "11px",
                          fontWeight: 700,
                          background: "#f1f5f9",
                          color: "#334155",
                          borderRadius: "4px",
                          border: "1px solid #cbd5e1",
                        }}
                      >
                        📍 {detail.branch_name}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 2: Invoice & Metrics Quick Strip */}
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "10px 16px",
                  marginBottom: "12px",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: "10px",
                  alignItems: "center",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                }}
              >

                <div>
                  <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>
                    Invoice No.
                  </div>
                  <div style={{ fontSize: "12.5px", fontWeight: 800, color: "#0061f2", marginTop: "1px" }}>
                    {detail.invoice_no}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>
                    Invoice Date
                  </div>
                  <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#0f172a", marginTop: "1px" }}>
                    {formatDate(detail.invoice_date)}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>
                    Bill Document
                  </div>
                  <div style={{ fontSize: "12px", marginTop: "1px" }}>
                    {detail.bill_file_url ? (
                      <a
                        href={detail.bill_file_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: "#16a34a",
                          textDecoration: "none",
                          fontWeight: 700,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px",
                        }}
                      >
                        <span>📥</span> Download File
                      </a>
                    ) : (
                      <span style={{ color: "#94a3b8" }}>— None</span>
                    )}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>
                    Basic Items Total
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "#475569", marginTop: "1px" }}>
                    {currencySymbol}{" "}
                    {detail.items_total_basic.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>
                    Invoice Total (with VAT)
                  </div>
                  <div style={{ fontSize: "13.5px", fontWeight: 800, color: "#059669", marginTop: "1px" }}>
                    {currencySymbol}{" "}
                    {detail.invoice_total_value.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                </div>
              </div>

              {/* SECTION 3: Expenses Card (Value-Based Landing Cost Engine) */}
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "10px 16px",
                  marginBottom: "12px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#475569",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    marginBottom: "8px",
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                  }}
                >
                  <span style={{ color: "#0061f2" }}>⚓</span> Expenses (Value-Based Landing Cost Engine)
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))",
                    gap: "8px",
                    background: "#f8fafc",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <div>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Packing & Forwarding:</span>
                    <div style={{ fontWeight: 700, fontSize: "12.5px", color: "#0f172a", marginTop: "1px" }}>
                      {currencySymbol}{" "}
                      {(detail.packing_forwarding || 0).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Transport / Freight:</span>
                    <div style={{ fontWeight: 700, fontSize: "12.5px", color: "#0f172a", marginTop: "1px" }}>
                      {currencySymbol}{" "}
                      {(detail.transport_expense || 0).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Offloading Charges:</span>
                    <div style={{ fontWeight: 700, fontSize: "12.5px", color: "#0f172a", marginTop: "1px" }}>
                      {currencySymbol}{" "}
                      {(detail.offloading_expense || 0).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Other Misc Charges:</span>
                    <div style={{ fontWeight: 700, fontSize: "12.5px", color: "#0f172a", marginTop: "1px" }}>
                      {currencySymbol}{" "}
                      {(detail.other_expense || 0).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Total All Expenses:</span>
                    <div style={{ fontWeight: 800, fontSize: "13px", color: "#0f172a", marginTop: "1px" }}>
                      {currencySymbol}{" "}
                      {detail.total_expenses.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>% Loading Expense (VB):</span>
                    <div style={{ fontWeight: 800, fontSize: "13px", color: "#0061f2", marginTop: "1px" }}>
                      {detail.loading_expense_pct.toFixed(2)} %
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 4: Product Summary Table - Perfectly Fitted, Zero Scroll */}
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  overflow: "hidden",
                  marginBottom: "12px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                }}
              >
                <div
                  style={{
                    padding: "9px 16px",
                    borderBottom: "1px solid #e2e8f0",
                    background: "#f8fafc",
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "#475569",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  Product Summary ({detail.items.length} items)
                </div>

                <div style={{ width: "100%", overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", tableLayout: "auto" }}>
                    <thead>
                      <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #cbd5e1" }}>
                        <th style={{ padding: "8px 8px", textAlign: "center", width: "40px", color: "#475569", whiteSpace: "nowrap" }}>
                          #
                        </th>
                        <th style={{ padding: "8px 10px", textAlign: "left", color: "#475569" }}>
                          Product Name
                        </th>
                        <th style={{ padding: "8px 8px", textAlign: "center", width: "80px", color: "#475569", whiteSpace: "nowrap" }}>
                          HSN
                        </th>
                        <th style={{ padding: "8px 8px", textAlign: "right", width: "55px", color: "#475569", whiteSpace: "nowrap" }}>
                          Qty
                        </th>
                        <th style={{ padding: "8px 8px", textAlign: "right", width: "95px", color: "#475569", whiteSpace: "nowrap" }}>
                          Unit Rate
                        </th>
                        <th style={{ padding: "8px 8px", textAlign: "right", width: "100px", color: "#475569", whiteSpace: "nowrap" }}>
                          Basic Total
                        </th>
                        <th style={{ padding: "8px 8px", textAlign: "right", width: "100px", color: "#475569", background: "#f0fdf4", whiteSpace: "nowrap" }}>
                          Expense / Unit
                        </th>
                        <th style={{ padding: "8px 8px", textAlign: "right", width: "110px", color: "#475569", background: "#f0fdf4", whiteSpace: "nowrap" }}>
                          Unit Landing (VB)
                        </th>
                        <th style={{ padding: "8px 10px", textAlign: "right", width: "115px", color: "#475569", background: "#f0fdf4", whiteSpace: "nowrap" }}>
                          Total Landing (VB)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.length === 0 ? (
                        <tr>
                          <td colSpan={9} style={{ padding: "24px", textAlign: "center", color: "#94a3b8" }}>
                            No line items recorded for this purchase.
                          </td>
                        </tr>
                      ) : (
                        detail.items.map((item, idx) => (
                          <tr
                            key={idx}
                            style={{
                              borderBottom: "1px solid #f1f5f9",
                              background: idx % 2 === 0 ? "#ffffff" : "#fafbfc",
                            }}
                          >
                            <td style={{ padding: "7px 8px", textAlign: "center", color: "#64748b", fontWeight: 600, whiteSpace: "nowrap" }}>
                              {idx + 1}
                            </td>

                            <td style={{ padding: "7px 10px" }}>
                              <div style={{ fontWeight: 700, color: "#0f172a", fontSize: "12.5px" }}>{item.product_name}</div>
                              {item.product_code && (
                                <span
                                  style={{
                                    display: "inline-block",
                                    marginTop: "1px",
                                    padding: "1px 5px",
                                    fontSize: "10px",
                                    fontWeight: 600,
                                    background: "#f1f5f9",
                                    color: "#475569",
                                    borderRadius: "4px",
                                    border: "1px solid #cbd5e1",
                                  }}
                                >
                                  {item.product_code}
                                </span>
                              )}
                            </td>

                            <td style={{ padding: "7px 8px", textAlign: "center", color: "#64748b", whiteSpace: "nowrap" }}>
                              {item.hsn_code || "—"}
                            </td>

                            <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap" }}>
                              {item.quantity}
                            </td>

                            <td style={{ padding: "7px 8px", textAlign: "right", color: "#334155", whiteSpace: "nowrap" }}>
                              {currencySymbol}{" "}
                              {item.unit_rate.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>

                            <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 600, color: "#0f172a", whiteSpace: "nowrap" }}>
                              {currencySymbol}{" "}
                              {item.item_total.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>

                            <td style={{ padding: "7px 8px", textAlign: "right", color: "#475569", background: "#f8fafc", whiteSpace: "nowrap" }}>
                              {currencySymbol}{" "}
                              {item.expense_per_unit.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>

                            <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700, color: "#1e40af", background: "#f8fafc", whiteSpace: "nowrap" }}>
                              {currencySymbol}{" "}
                              {item.unit_landing_rate.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>

                            <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800, color: "#059669", background: "#f8fafc", whiteSpace: "nowrap" }}>
                              {currencySymbol}{" "}
                              {item.total_landing_rate.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: "#f1f5f9", fontWeight: 700, borderTop: "2px solid #cbd5e1" }}>
                        <td colSpan={3} style={{ padding: "8px 8px", textAlign: "right", textTransform: "uppercase", fontSize: "11.5px" }}>
                          Grand Total:
                        </td>
                        <td style={{ padding: "8px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                          {detail.total_quantity}
                        </td>
                        <td></td>
                        <td style={{ padding: "8px 8px", textAlign: "right", color: "#0f172a", whiteSpace: "nowrap" }}>
                          {currencySymbol}{" "}
                          {detail.items_total_basic.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td></td>
                        <td style={{ padding: "8px 8px", textAlign: "right", color: "#1e40af", textTransform: "uppercase", fontSize: "11px", whiteSpace: "nowrap" }}>
                          Total Landing:
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#059669", fontSize: "13px", fontWeight: 800, whiteSpace: "nowrap" }}>
                          {currencySymbol}{" "}
                          {detail.items_total_landing.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* SECTION 5: Remarks (if present) */}
              {detail.remarks && (
                <div
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "10px 14px",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: "3px" }}>
                    Remarks / Factory Delivery Notes:
                  </div>
                  <div style={{ fontSize: "12.5px", color: "#1e293b", whiteSpace: "pre-wrap" }}>
                    {detail.remarks}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid #e2e8f0",
            background: "#ffffff",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            {detail && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEdit(detail.id);
                }}
                style={{
                  background: "#0061f2",
                  color: "#ffffff",
                  border: "none",
                  padding: "7px 15px",
                  borderRadius: "6px",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 2px 4px rgba(0,97,242,0.2)",
                }}
              >
                <span>✏️</span> Edit Local Purchase
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: "#ffffff",
              color: "#334155",
              border: "1px solid #cbd5e1",
              padding: "7px 16px",
              borderRadius: "6px",
              fontSize: "12.5px",
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
