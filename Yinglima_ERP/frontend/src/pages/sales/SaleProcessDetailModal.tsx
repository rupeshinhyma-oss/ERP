/**
 * Sale Process Detail & Commercial Invoice Modal.
 *
 * Provides a comprehensive, print-ready Commercial Order & Packing Slip view,
 * complete with consignment details, container/BL/LR numbers, product breakdown,
 * currency calculations in RMB (¥), and workflow status transitions.
 */

import { useEffect, useState } from "react";
import { apiGet, apiPatch, errorMessage } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { SaleOrder, SaleOrderStatus } from "@/types/saleProcess";

interface SaleProcessDetailModalProps {
  orderId: string;
  onClose: () => void;
  onStatusUpdated?: () => void;
}

export function SaleProcessDetailModal({
  orderId,
  onClose,
  onStatusUpdated,
}: SaleProcessDetailModalProps) {
  const toast = useToast();
  const [order, setOrder] = useState<SaleOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusRemark, setStatusRemark] = useState("");
  const [showStatusModal, setShowStatusModal] = useState<SaleOrderStatus | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function fetchDetails() {
      setLoading(true);
      try {
        const res = await apiGet<SaleOrder>(`/sales/orders/${orderId}`);
        if (mounted && res.data) {
          setOrder(res.data);
        }
      } catch (err) {
        if (mounted) {
          toast(errorMessage(err), "error");
          onClose();
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetchDetails();
    return () => {
      mounted = false;
    };
  }, [orderId, onClose, toast]);

  const handleStatusChange = async (newStatus: SaleOrderStatus) => {
    setUpdatingStatus(true);
    try {
      const res = await apiPatch<SaleOrder>(`/sales/orders/${orderId}/status`, {
        status: newStatus,
        remarks: statusRemark.trim() || undefined,
      });
      if (res.data) {
        setOrder(res.data);
        toast(`Order status updated to ${newStatus.replace("_", " ").toUpperCase()}`, "success");
        setShowStatusModal(null);
        setStatusRemark("");
        if (onStatusUpdated) onStatusUpdated();
      }
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    let bg = "#f1f5f9";
    let color = "#475569";
    let border = "#cbd5e1";
    let text = status.toUpperCase().replace("_", " ");

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
          padding: "3px 10px",
          borderRadius: "12px",
          fontSize: "12px",
          fontWeight: 700,
          background: bg,
          color: color,
          border: `1px solid ${border}`,
        }}
      >
        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: color }} />
        {text}
      </span>
    );
  };

  const currencySymbol = order?.currency === "USD" ? "$" : "¥";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: isFullScreen ? "8px" : "20px",
        boxSizing: "border-box",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: isFullScreen ? "8px" : "12px",
          width: "100%",
          maxWidth: isFullScreen ? "calc(100vw - 16px)" : "1350px",
          height: isFullScreen ? "calc(100vh - 16px)" : undefined,
          maxHeight: isFullScreen ? "calc(100vh - 16px)" : "92vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.35)",
          overflow: "hidden",
          transition: "all 0.15s ease-in-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#f8fafc",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                background: "#eff6ff",
                color: "#2563eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "18px",
                fontWeight: 700,
              }}
            >
              📋
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#0f172a" }}>
                  Sale Process Order: {order?.order_no || "Loading..."}
                </h2>
                {order && getStatusBadge(order.status)}
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                Consignment:{" "}
                <strong style={{ color: "#1e293b" }}>{order?.consignment_code || "N/A"}</strong> |
                Buyer: <strong style={{ color: "#1e293b" }}>{order?.buyer_name || "N/A"}</strong>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              onClick={() => setIsFullScreen(!isFullScreen)}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                background: isFullScreen ? "#eff6ff" : "#ffffff",
                fontSize: "13px",
                fontWeight: 600,
                color: isFullScreen ? "#1d4ed8" : "#334155",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
              }}
              title={isFullScreen ? "Restore smaller size" : "Expand to full screen"}
            >
              <span>{isFullScreen ? "🗗" : "⛶"}</span>
              <span>{isFullScreen ? "Standard" : "Full Screen"}</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                fontSize: "13px",
                fontWeight: 600,
                color: "#334155",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              🖨️ Print
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "6px",
                border: "1px solid #e2e8f0",
                background: "#ffffff",
                fontSize: "16px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#64748b",
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#64748b" }}>
              <div style={{ fontSize: "24px", marginBottom: "8px" }}>⏳</div>
              Loading order details...
            </div>
          ) : !order ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#ef4444" }}>
              Sale order not found.
            </div>
          ) : (
            <div>
              {/* Order Metadata Cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "14px",
                  marginBottom: "20px",
                }}
              >
                {/* Card 1: Buyer Info */}
                <div
                  style={{
                    padding: "14px",
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: "6px" }}>
                    Buyer Company
                  </div>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>
                    {order.buyer_name}
                  </div>
                  {order.buyer_branch_name && (
                    <div style={{ fontSize: "12px", color: "#475569", marginTop: "2px" }}>
                      Branch: {order.buyer_branch_name}
                    </div>
                  )}
                  <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
                    Supplier: {order.organization_name}
                  </div>
                </div>

                {/* Card 2: Consignment & Dates */}
                <div
                  style={{
                    padding: "14px",
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: "6px" }}>
                    Consignment & Timeline
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: "4px",
                        background: "#e0f2fe",
                        color: "#0369a1",
                        fontSize: "13px",
                        fontWeight: 700,
                      }}
                    >
                      {order.consignment_code || "Direct Sale"}
                    </span>
                  </div>
                  <div style={{ fontSize: "12px", color: "#475569", marginTop: "6px" }}>
                    Order Date: <strong>{order.order_date}</strong>
                  </div>
                  {order.delivery_date && (
                    <div style={{ fontSize: "12px", color: "#475569" }}>
                      Delivery Target: <strong>{order.delivery_date}</strong>
                    </div>
                  )}
                </div>

                {/* Card 3: Logistics & Shipping */}
                <div
                  style={{
                    padding: "14px",
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: "6px" }}>
                    Logistics / Shipping
                  </div>
                  <div style={{ fontSize: "12px", color: "#334155" }}>
                    Container No: <strong>{order.container_no || "—"}</strong>
                  </div>
                  <div style={{ fontSize: "12px", color: "#334155" }}>
                    BL No: <strong>{order.bl_no || "—"}</strong> | LR No: <strong>{order.lr_no || "—"}</strong>
                  </div>
                  <div style={{ fontSize: "12px", color: "#334155" }}>
                    Transporter: <strong>{order.transporter_name || "—"}</strong>
                  </div>
                  {(order.port_of_loading || order.port_of_discharge) && (
                    <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                      {order.port_of_loading || "POL"} → {order.port_of_discharge || "POD"}
                    </div>
                  )}
                </div>

                {/* Card 4: Financial Summary */}
                <div
                  style={{
                    padding: "14px",
                    borderRadius: "8px",
                    border: "1px solid #bfdbfe",
                    background: "#eff6ff",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", marginBottom: "6px" }}>
                    Total Order Value
                  </div>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#1e3a8a" }}>
                    {currencySymbol} {Number(order.total_amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div style={{ fontSize: "11px", color: "#3b82f6", marginTop: "4px" }}>
                    Basic: {currencySymbol} {Number(order.total_basic).toFixed(2)} | Tax: {currencySymbol} {Number(order.total_tax).toFixed(2)}
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                    Total Quantity: <strong>{Number(order.total_quantity).toLocaleString()} pcs</strong>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  overflow: "hidden",
                  marginBottom: "20px",
                }}
              >
                <div
                  style={{
                    padding: "10px 16px",
                    background: "#f1f5f9",
                    borderBottom: "1px solid #e2e8f0",
                    fontWeight: 700,
                    fontSize: "13px",
                    color: "#334155",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>Planned Products Breakdown ({order.items?.length || 0} line items)</span>
                  <span>Currency: {order.currency}</span>
                </div>
                <div
                  style={{
                    overflow: "auto",
                    maxHeight: isFullScreen ? "calc(100vh - 350px)" : "450px",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "separate",
                      borderSpacing: 0,
                      fontSize: "12px",
                      tableLayout: "auto",
                    }}
                  >
                    <thead>
                      <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                        <th
                          style={{
                            padding: "9px 10px",
                            width: "35px",
                            textAlign: "center",
                            position: "sticky",
                            top: 0,
                            left: 0,
                            zIndex: 15,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          #
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            minWidth: "220px",
                            position: "sticky",
                            top: 0,
                            left: "35px",
                            zIndex: 15,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                            borderRight: "1px solid #e2e8f0",
                          }}
                        >
                          Product Description
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            width: "110px",
                            whiteSpace: "nowrap",
                            position: "sticky",
                            top: 0,
                            zIndex: 10,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          Item Code
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            width: "85px",
                            whiteSpace: "nowrap",
                            position: "sticky",
                            top: 0,
                            zIndex: 10,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          HSN
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            width: "85px",
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            position: "sticky",
                            top: 0,
                            zIndex: 10,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          Quantity
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            width: "100px",
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            position: "sticky",
                            top: 0,
                            zIndex: 10,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          Rate ({currencySymbol})
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            width: "65px",
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            position: "sticky",
                            top: 0,
                            zIndex: 10,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          Tax %
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            width: "105px",
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            position: "sticky",
                            top: 0,
                            zIndex: 10,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          Tax Amount ({currencySymbol})
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            width: "115px",
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            position: "sticky",
                            top: 0,
                            zIndex: 10,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          Total ({currencySymbol})
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            minWidth: "160px",
                            position: "sticky",
                            top: 0,
                            zIndex: 10,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          Remarks
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items && order.items.length > 0 ? (
                        order.items.map((item, idx) => {
                          const rowBg = idx % 2 === 0 ? "#ffffff" : "#fcfdfe";
                          return (
                            <tr
                              key={item.id || idx}
                              style={{
                                backgroundColor: rowBg,
                              }}
                            >
                              <td
                                style={{
                                  padding: "8px 10px",
                                  color: "#64748b",
                                  textAlign: "center",
                                  position: "sticky",
                                  left: 0,
                                  zIndex: 5,
                                  background: rowBg,
                                  borderBottom: "1px solid #f1f5f9",
                                }}
                              >
                                {idx + 1}
                              </td>
                              <td
                                style={{
                                  padding: "8px 10px",
                                  fontWeight: 600,
                                  color: "#1e293b",
                                  position: "sticky",
                                  left: "35px",
                                  zIndex: 5,
                                  background: rowBg,
                                  borderBottom: "1px solid #f1f5f9",
                                  borderRight: "1px solid #e2e8f0",
                                }}
                              >
                                {item.product_name}
                              </td>
                              <td style={{ padding: "8px 10px", color: "#64748b", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                                {item.product_code || "—"}
                              </td>
                              <td style={{ padding: "8px 10px", color: "#64748b", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                                {item.hsn_code || "—"}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                                {Number(item.quantity).toLocaleString()}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: "#334155", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                                {Number(item.unit_rate).toFixed(2)}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: "#64748b", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                                {Number(item.tax_percent)}%
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: "#64748b", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                                {Number(item.tax_amount).toFixed(2)}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                                {Number(item.item_total).toFixed(2)}
                              </td>
                              <td style={{ padding: "8px 10px", color: "#64748b", fontStyle: item.remarks ? "normal" : "italic", borderBottom: "1px solid #f1f5f9" }}>
                                {item.remarks || "—"}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={10} style={{ textAlign: "center", padding: "20px", color: "#94a3b8" }}>
                            No line items recorded.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr
                        style={{
                          background: "#f8fafc",
                          fontWeight: 700,
                          position: "sticky",
                          bottom: 0,
                          zIndex: 10,
                          boxShadow: "0 -2px 4px rgba(0,0,0,0.05)",
                        }}
                      >
                        <td
                          colSpan={2}
                          style={{
                            padding: "8px 10px",
                            textAlign: "right",
                            position: "sticky",
                            left: 0,
                            zIndex: 15,
                            background: "#f8fafc",
                            borderTop: "2px solid #cbd5e1",
                            borderRight: "1px solid #e2e8f0",
                          }}
                        >
                          Totals:
                        </td>
                        <td colSpan={2} style={{ borderTop: "2px solid #cbd5e1" }}></td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#0f172a", whiteSpace: "nowrap", borderTop: "2px solid #cbd5e1" }}>
                          {Number(order.total_quantity).toLocaleString()}
                        </td>
                        <td colSpan={2} style={{ borderTop: "2px solid #cbd5e1" }}></td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#64748b", whiteSpace: "nowrap", borderTop: "2px solid #cbd5e1" }}>
                          {currencySymbol} {Number(order.total_tax).toFixed(2)}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#1d4ed8", fontSize: "14px", whiteSpace: "nowrap", borderTop: "2px solid #cbd5e1" }}>
                          {currencySymbol} {Number(order.total_amount).toFixed(2)}
                        </td>
                        <td style={{ borderTop: "2px solid #cbd5e1" }}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Order Remarks */}
              {order.remarks && (
                <div
                  style={{
                    padding: "12px 16px",
                    borderRadius: "6px",
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                    fontSize: "12px",
                    color: "#475569",
                    marginBottom: "20px",
                  }}
                >
                  <strong style={{ color: "#1e293b" }}>Order Remarks / Notes:</strong>
                  <pre style={{ margin: "4px 0 0 0", fontFamily: "inherit", whiteSpace: "pre-wrap" }}>
                    {order.remarks}
                  </pre>
                </div>
              )}

              {/* Status Update Actions Bar */}
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: "8px",
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "10px",
                }}
              >
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}>
                    Workflow Stage Transitions
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>
                    Current Status: <strong style={{ textTransform: "uppercase" }}>{order.status}</strong>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {order.status === "pending" && (
                    <button
                      type="button"
                      disabled={updatingStatus}
                      onClick={() => setShowStatusModal("sales_confirmed")}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        background: "#0284c7",
                        color: "#ffffff",
                        border: "none",
                        fontWeight: 600,
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      ✓ Confirm Sales
                    </button>
                  )}

                  {(order.status === "pending" || order.status === "sales_confirmed") && (
                    <button
                      type="button"
                      disabled={updatingStatus}
                      onClick={() => setShowStatusModal("admin_approved")}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        background: "#16a34a",
                        color: "#ffffff",
                        border: "none",
                        fontWeight: 600,
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      ★ Admin Approve
                    </button>
                  )}

                  {order.status === "admin_approved" && (
                    <button
                      type="button"
                      disabled={updatingStatus}
                      onClick={() => setShowStatusModal("dispatched")}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        background: "#9333ea",
                        color: "#ffffff",
                        border: "none",
                        fontWeight: 600,
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      🚚 Mark Dispatched
                    </button>
                  )}

                  {order.status === "dispatched" && (
                    <button
                      type="button"
                      disabled={updatingStatus}
                      onClick={() => setShowStatusModal("lr")}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        background: "#4f46e5",
                        color: "#ffffff",
                        border: "none",
                        fontWeight: 600,
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      📄 LR Received / Complete
                    </button>
                  )}

                  {order.status !== "cancelled" && (
                    <button
                      type="button"
                      disabled={updatingStatus}
                      onClick={() => setShowStatusModal("cancelled")}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        background: "#ffffff",
                        color: "#dc2626",
                        border: "1px solid #fca5a5",
                        fontWeight: 600,
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      ✕ Cancel Order
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: "12px 24px",
            borderTop: "1px solid #e2e8f0",
            background: "#ffffff",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 18px",
              borderRadius: "6px",
              background: "#e2e8f0",
              color: "#334155",
              border: "none",
              fontWeight: 600,
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>

      {/* Confirmation Sub-Modal for Status Change */}
      {showStatusModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            padding: "16px",
          }}
          onClick={() => setShowStatusModal(null)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "10px",
              width: "100%",
              maxWidth: "450px",
              padding: "20px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 10px 0", fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
              Confirm Status Change: {showStatusModal.toUpperCase().replace("_", " ")}
            </h3>
            <p style={{ margin: "0 0 14px 0", fontSize: "13px", color: "#64748b" }}>
              Are you sure you want to transition this sale process order to{" "}
              <strong>{showStatusModal.toUpperCase().replace("_", " ")}</strong>?
            </p>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                Optional Remarks / Note:
              </label>
              <textarea
                value={statusRemark}
                onChange={(e) => setStatusRemark(e.target.value)}
                placeholder="Reason or dispatch notes..."
                rows={3}
                style={{
                  width: "100%",
                  padding: "8px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "13px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                type="button"
                onClick={() => setShowStatusModal(null)}
                style={{
                  padding: "8px 14px",
                  borderRadius: "6px",
                  background: "#e2e8f0",
                  color: "#334155",
                  border: "none",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={updatingStatus}
                onClick={() => handleStatusChange(showStatusModal)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  background: showStatusModal === "cancelled" ? "#dc2626" : "#0061f2",
                  color: "#ffffff",
                  border: "none",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {updatingStatus ? "Updating..." : "Confirm Update"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
