import { useEffect, useState } from "react";
import { apiGet, apiPost, errorMessage } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { SaleOrder } from "@/types/saleProcess";

interface SaleProcessOutwardModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string | null;
  onSuccess: (updatedOrder: SaleOrder) => void;
}

interface OutwardItemRow {
  product_id?: string | null;
  product_name: string;
  product_code?: string | null;
  quantity: number;
  unit_rate: number;
  remarks?: string;
}

export function SaleProcessOutwardModal({
  isOpen,
  onClose,
  orderId,
  onSuccess,
}: SaleProcessOutwardModalProps) {
  const toast = useToast();

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState<SaleOrder | null>(null);

  // Form header fields
  const [movementDate, setMovementDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [warehouseLocation, setWarehouseLocation] = useState("Main Godown");
  const [vehicleNo, setVehicleNo] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [containerNo, setContainerNo] = useState("");
  const [dispatchRemarks, setDispatchRemarks] = useState("");

  // Items state
  const [items, setItems] = useState<OutwardItemRow[]>([]);

  useEffect(() => {
    if (!isOpen || !orderId) {
      setOrder(null);
      setItems([]);
      return;
    }

    setLoading(true);
    apiGet<SaleOrder>(`/sales/orders/${orderId}`)
      .then((res) => {
        const o = res.data;
        if (o) {
          setOrder(o);
          setMovementDate(new Date().toISOString().slice(0, 10));
          setDispatchRemarks(`Outward dispatch for Sale Order ${o.order_no}`);
          if (o.container_no) setContainerNo(o.container_no);
          if (o.transporter_name) setTransporterName(o.transporter_name);
          if (o.vehicle_no) setVehicleNo(o.vehicle_no);

          // Populate line items
          const rows: OutwardItemRow[] = (o.items || []).map((it) => ({
            product_id: it.product_id,
            product_name: it.product_name,
            product_code: it.product_code,
            quantity: Number(it.quantity) || 0,
            unit_rate: Number(it.unit_rate) || 0,
            remarks: it.remarks || "",
          }));
          setItems(rows);
        }
      })
      .catch((err) => {
        toast(errorMessage(err) || "Failed to load order details.", "error");
        onClose();
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, orderId, toast, onClose]);

  if (!isOpen) return null;

  const totalQuantity = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderId || !order) return;

    if (items.length === 0) {
      toast("No line items found to dispatch.", "error");
      return;
    }

    const payload = {
      movement_date: movementDate,
      warehouse_location: warehouseLocation,
      vehicle_no: vehicleNo.trim() || undefined,
      transporter_name: transporterName.trim() || undefined,
      container_no: containerNo.trim() || undefined,
      remarks: dispatchRemarks.trim() || undefined,
      items: items.map((it) => ({
        product_id: it.product_id || undefined,
        product_name: it.product_name,
        product_code: it.product_code || undefined,
        quantity: Number(it.quantity) || 0,
        unit_rate: Number(it.unit_rate) || 0,
        remarks: it.remarks || undefined,
      })),
    };

    setSubmitting(true);
    try {
      const res = await apiPost<SaleOrder>(
        `/sales/orders/${orderId}/dispatch`,
        payload
      );
      toast(
        `Sale Order ${res.data?.order_no || order.order_no} successfully dispatched! Stock Outward Voucher: ${res.data?.stock_movement_number || "Generated"}.`,
        "success"
      );
      if (res.data) {
        onSuccess(res.data);
      }
      onClose();
    } catch (err) {
      toast(errorMessage(err) || "Failed to dispatch stock.", "error");
    } finally {
      setSubmitting(false);
    }
  };

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
        zIndex: 10000,
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "850px",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
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
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                background: "#f3e8ff",
                color: "#7e22ce",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "18px",
                fontWeight: 700,
              }}
            >
              📤
            </div>
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: "16px",
                  fontWeight: 700,
                  color: "#0f172a",
                }}
              >
                Dispatch & Outward Stock from Warehouse
              </h2>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                Order No: <strong style={{ color: "#0061f2" }}>{order?.order_no || "..."}</strong> | Buyer:{" "}
                <strong style={{ color: "#1e293b" }}>{order?.buyer_name || "..."}</strong>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "18px",
              cursor: "pointer",
              color: "#94a3b8",
            }}
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        {loading ? (
          <div style={{ padding: "60px", textAlign: "center", color: "#64748b" }}>
            Loading order line items and warehouse data...
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
            <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1 }}>
              {/* Notice Banner */}
              <div
                style={{
                  background: "#faf5ff",
                  border: "1px solid #e9d5ff",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  marginBottom: "18px",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  fontSize: "12.5px",
                  color: "#6b21a8",
                }}
              >
                <span style={{ fontSize: "16px" }}>⚡</span>
                <div>
                  <strong>Live Inventory Deduction:</strong> Confirming dispatch will transition this sale order to <strong>Dispatched</strong> status, generate an official <strong>Outward Stock Movement Voucher (OUT-YYYY-XXXX)</strong>, and atomically decrease warehouse stock.
                  <div style={{ marginTop: "4px", fontSize: "11.5px", color: "#7e22ce" }}>
                    If warehouse stock is insufficient for any item, dispatch is strictly blocked to maintain inventory integrity.
                  </div>
                </div>
              </div>

              {/* Header Details Grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "14px",
                  marginBottom: "18px",
                }}
              >
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Movement Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={movementDate}
                    onChange={(e) => setMovementDate(e.target.value)}
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

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Warehouse Location *
                  </label>
                  <input
                    type="text"
                    required
                    value={warehouseLocation}
                    onChange={(e) => setWarehouseLocation(e.target.value)}
                    placeholder="e.g. Main Godown, Bay 1"
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

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Vehicle No
                  </label>
                  <input
                    type="text"
                    value={vehicleNo}
                    onChange={(e) => setVehicleNo(e.target.value)}
                    placeholder="e.g. MH 04 AB 1234"
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

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Transporter
                  </label>
                  <input
                    type="text"
                    value={transporterName}
                    onChange={(e) => setTransporterName(e.target.value)}
                    placeholder="e.g. Safe Cargo Logistics"
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

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Container No / Consignment
                  </label>
                  <input
                    type="text"
                    value={containerNo}
                    onChange={(e) => setContainerNo(e.target.value)}
                    placeholder="e.g. MSKU9876543"
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

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Dispatch Remarks
                  </label>
                  <input
                    type="text"
                    value={dispatchRemarks}
                    onChange={(e) => setDispatchRemarks(e.target.value)}
                    placeholder="e.g. Dispatched via truck"
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
              </div>

              {/* Items Table */}
              <div style={{ border: "1px solid #e2e8f0", borderRadius: "8px", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", color: "#475569", textAlign: "left" }}>
                      <th style={{ padding: "10px 14px", width: "40px" }}>#</th>
                      <th style={{ padding: "10px 14px" }}>Product Name</th>
                      <th style={{ padding: "10px 14px", width: "130px" }}>SKU Code</th>
                      <th style={{ padding: "10px 14px", textAlign: "right", width: "120px" }}>Dispatch Qty</th>
                      <th style={{ padding: "10px 14px", textAlign: "right", width: "120px" }}>Unit Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "10px 14px", color: "#94a3b8" }}>{idx + 1}</td>
                        <td style={{ padding: "10px 14px", fontWeight: 600, color: "#0f172a" }}>
                          {it.product_name}
                        </td>
                        <td style={{ padding: "10px 14px", color: "#64748b" }}>
                          {it.product_code || "—"}
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                          {Number(it.quantity).toLocaleString()} pcs
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "right", color: "#475569" }}>
                          {order?.currency === "USD" ? "$" : "¥"} {Number(it.unit_rate).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#f8fafc", fontWeight: 700 }}>
                      <td colSpan={3} style={{ padding: "10px 14px", textAlign: "right", color: "#475569" }}>
                        Total Dispatch Quantity:
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#7e22ce", fontSize: "13.5px" }}>
                        {totalQuantity.toLocaleString()} pcs
                      </td>
                      <td style={{ padding: "10px 14px" }}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                padding: "14px 24px",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#f8fafc",
              }}
            >
              <div style={{ fontSize: "12px", color: "#64748b" }}>
                Order Total: <strong>{order?.currency === "USD" ? "$" : "¥"} {Number(order?.total_amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#475569",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: "8px 20px",
                    borderRadius: "6px",
                    border: "none",
                    background: "linear-gradient(135deg, #9333ea 0%, #7e22ce 100%)",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: submitting ? "not-allowed" : "pointer",
                    boxShadow: "0 2px 4px rgba(126, 34, 206, 0.25)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span>📤</span>
                  <span>{submitting ? "Dispatching & Deducting Stock..." : "Confirm Outward & Dispatch"}</span>
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
