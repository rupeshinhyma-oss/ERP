import { useEffect, useState } from "react";
import { apiGet, apiPost, errorMessage } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { LocalPurchaseDetail } from "@/types/localPurchase";

interface LocalPurchaseInwardModalProps {
  isOpen: boolean;
  onClose: () => void;
  purchaseId: string | null;
  onSuccess: (updatedPurchase: LocalPurchaseDetail) => void;
}

interface InwardItemRow {
  product_id?: string | null;
  product_name: string;
  product_code?: string | null;
  expected_quantity: number;
  quantity: number | ""; // Received / Accepted
  damaged_quantity: number | "";
  unit_rate: number;
  remarks?: string;
}

export function LocalPurchaseInwardModal({
  isOpen,
  onClose,
  purchaseId,
  onSuccess,
}: LocalPurchaseInwardModalProps) {
  const toast = useToast();

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [purchase, setPurchase] = useState<LocalPurchaseDetail | null>(null);

  // Form header fields
  const [movementDate, setMovementDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [warehouseLocation, setWarehouseLocation] = useState("Main Godown");
  const [vehicleNo, setVehicleNo] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [containerNo, setContainerNo] = useState("");
  const [inwardRemarks, setInwardRemarks] = useState("");

  // Items state
  const [items, setItems] = useState<InwardItemRow[]>([]);

  useEffect(() => {
    if (!isOpen || !purchaseId) {
      setPurchase(null);
      setItems([]);
      return;
    }

    setLoading(true);
    apiGet<LocalPurchaseDetail>(`/purchases/local/${purchaseId}`)
      .then((res) => {
        const p = res.data;
        if (p) {
          setPurchase(p);
          setMovementDate(new Date().toISOString().slice(0, 10));
          setInwardRemarks(`Inward receipt from invoice ${p.invoice_no}`);
          if (p.consignment_code) {
            setContainerNo(p.consignment_code);
          }

          // Populate line items pre-filled to 100% accepted
          const rows: InwardItemRow[] = (p.items || []).map((it) => {
            const qty = Number(it.quantity) || 0;
            return {
              product_id: it.product_id,
              product_name: it.product_name,
              product_code: it.product_code,
              expected_quantity: qty,
              quantity: qty, // Default received = 100% of purchase
              damaged_quantity: "",
              unit_rate: Number(it.unit_rate) || 0,
              remarks: "",
            };
          });
          setItems(rows);
        }
      })
      .catch((err) => {
        toast(errorMessage(err) || "Failed to load purchase details.", "error");
        onClose();
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, purchaseId, toast, onClose]);

  if (!isOpen) return null;

  const totalOrdered = items.reduce((sum, it) => sum + (Number(it.expected_quantity) || 0), 0);
  const totalReceived = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
  const totalDamaged = items.reduce((sum, it) => sum + (Number(it.damaged_quantity) || 0), 0);

  const handleItemChange = (index: number, field: keyof InwardItemRow, value: any) => {
    setItems((prev) => {
      const next = [...prev];
      const current = { ...next[index], [field]: value };
      if (field === "damaged_quantity") {
        const dmg = Math.max(0, Number(value) || 0);
        const exp = Number(current.expected_quantity) || 0;
        current.quantity = Math.max(0, exp - dmg);
      }
      next[index] = current;
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchaseId) return;

    if (items.length === 0) {
      toast("No line items to inward.", "error");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        movement_date: movementDate,
        warehouse_location: warehouseLocation,
        vehicle_no: vehicleNo.trim() || null,
        transporter_name: transporterName.trim() || null,
        container_no: containerNo.trim() || null,
        remarks: inwardRemarks.trim() || null,
        items: items.map((it) => ({
          product_id: it.product_id || null,
          product_name: it.product_name,
          product_code: it.product_code || null,
          expected_quantity: Number(it.expected_quantity) || 0,
          quantity: Math.max(0, Number(it.quantity) || 0),
          damaged_quantity: Math.max(0, Number(it.damaged_quantity) || 0),
          unit_rate: Number(it.unit_rate) || 0,
          remarks: it.remarks || null,
        })),
      };

      const res = await apiPost<LocalPurchaseDetail>(
        `/purchases/local/${purchaseId}/inward`,
        payload
      );

      toast(
        `Inward completed successfully! Slip: ${res.data?.stock_movement_number || "Confirmed"}`,
        "success"
      );
      if (res.data) {
        onSuccess(res.data);
      }
      onClose();
    } catch (err) {
      toast(errorMessage(err) || "Failed to process inward movement.", "error");
    } finally {
      setSubmitting(false);
    }
  };

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
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "14px",
          width: "100%",
          maxWidth: "920px",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          border: "1px solid #cbd5e1",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#f8fafc",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>📦</span>
              <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#0f172a" }}>
                Receive &amp; Inward Stock to Warehouse
              </h3>
              {purchase?.invoice_no && (
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    background: "#e0f2fe",
                    color: "#0369a1",
                    padding: "2px 8px",
                    borderRadius: "6px",
                  }}
                >
                  PO #{purchase.invoice_no}
                </span>
              )}
            </div>
            <p style={{ margin: "4px 0 0 30px", fontSize: "12.5px", color: "#64748b" }}>
              Supplier: <strong style={{ color: "#1e293b" }}>{purchase?.supplier_name || "—"}</strong>
              {purchase?.consignment_code && ` • Consignment: ${purchase.consignment_code}`}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              background: "none",
              border: "none",
              fontSize: "20px",
              cursor: submitting ? "not-allowed" : "pointer",
              color: "#94a3b8",
            }}
          >
            ✕
          </button>
        </div>

        {/* Body Content */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1 }}>
          <div style={{ padding: "18px 20px", overflowY: "auto", flex: 1 }}>
            {loading ? (
              <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                Loading purchase line items...
              </div>
            ) : (
              <>
                {/* Receiving Meta Fields */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: "12px",
                    background: "#f8fafc",
                    padding: "14px",
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    marginBottom: "18px",
                  }}
                >
                  <div>
                    <label style={{ fontSize: "11.5px", fontWeight: 700, color: "#475569", display: "block", marginBottom: "4px" }}>
                      Receiving Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={movementDate}
                      onChange={(e) => setMovementDate(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "7px 10px",
                        fontSize: "13px",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "11.5px", fontWeight: 700, color: "#475569", display: "block", marginBottom: "4px" }}>
                      Destination Warehouse *
                    </label>
                    <select
                      value={warehouseLocation}
                      onChange={(e) => setWarehouseLocation(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "7px 10px",
                        fontSize: "13px",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                        background: "#ffffff",
                        boxSizing: "border-box",
                        fontWeight: 600,
                      }}
                    >
                      <option value="Main Godown">Main Godown (Default)</option>
                      <option value="Factory Staging Yard">Factory Staging Yard</option>
                      <option value="Transit Bay">Transit Bay</option>
                      <option value="Customs Bonded Area">Customs Bonded Area</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: "11.5px", fontWeight: 700, color: "#475569", display: "block", marginBottom: "4px" }}>
                      Vehicle / Truck No
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 浙B-98821"
                      value={vehicleNo}
                      onChange={(e) => setVehicleNo(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "7px 10px",
                        fontSize: "13px",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "11.5px", fontWeight: 700, color: "#475569", display: "block", marginBottom: "4px" }}>
                      Transporter / Logistics
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. SF Express / Debon"
                      value={transporterName}
                      onChange={(e) => setTransporterName(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "7px 10px",
                        fontSize: "13px",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>

                {/* Line Items Table */}
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <h4 style={{ margin: 0, fontSize: "13.5px", fontWeight: 700, color: "#1e293b" }}>
                      Line Items To Receive ({items.length})
                    </h4>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>
                      Defaulted to 100% accepted. Adjust damaged qty if cartons are damaged.
                    </span>
                  </div>

                  <div style={{ border: "1px solid #cbd5e1", borderRadius: "8px", overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                      <thead>
                        <tr style={{ background: "#f1f5f9", textAlign: "left", color: "#475569", borderBottom: "1px solid #cbd5e1" }}>
                          <th style={{ padding: "8px 10px", width: "35px" }}>#</th>
                          <th style={{ padding: "8px 10px" }}>Product Name &amp; SKU</th>
                          <th style={{ padding: "8px 10px", textAlign: "right", width: "90px" }}>Ordered</th>
                          <th style={{ padding: "8px 10px", textAlign: "right", width: "110px" }}>Received *</th>
                          <th style={{ padding: "8px 10px", textAlign: "right", width: "100px" }}>Damaged</th>
                          <th style={{ padding: "8px 10px", width: "160px" }}>Item Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((row, idx) => (
                          <tr key={idx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                            <td style={{ padding: "8px 10px", color: "#64748b" }}>{idx + 1}</td>
                            <td style={{ padding: "8px 10px" }}>
                              <div style={{ fontWeight: 600, color: "#0f172a" }}>{row.product_name}</div>
                              {row.product_code && (
                                <div style={{ fontSize: "11px", color: "#0284c7" }}>SKU: {row.product_code}</div>
                              )}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: "#475569" }}>
                              {row.expected_quantity}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>
                              <input
                                type="number"
                                min="0"
                                max={row.expected_quantity}
                                step="any"
                                required
                                placeholder="0"
                                value={row.quantity === 0 || row.quantity === "" ? "" : row.quantity}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  handleItemChange(idx, "quantity", val === "" ? "" : Number(val));
                                }}
                                style={{
                                  width: "90px",
                                  padding: "5px 8px",
                                  textAlign: "right",
                                  borderRadius: "4px",
                                  border: "1.5px solid #22c55e",
                                  fontWeight: 700,
                                  color: "#166534",
                                  background: "#f0fdf4",
                                }}
                              />
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>
                              <input
                                type="number"
                                min="0"
                                max={row.expected_quantity}
                                step="any"
                                placeholder="0"
                                value={row.damaged_quantity === 0 || row.damaged_quantity === "" ? "" : row.damaged_quantity}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  handleItemChange(idx, "damaged_quantity", val === "" ? "" : Number(val));
                                }}
                                style={{
                                  width: "80px",
                                  padding: "5px 8px",
                                  textAlign: "right",
                                  borderRadius: "4px",
                                  border: Number(row.damaged_quantity) > 0 ? "1.5px solid #ef4444" : "1px solid #cbd5e1",
                                  color: Number(row.damaged_quantity) > 0 ? "#dc2626" : "#475569",
                                  fontWeight: Number(row.damaged_quantity) > 0 ? 700 : 400,
                                  background: Number(row.damaged_quantity) > 0 ? "#fef2f2" : "#ffffff",
                                  boxSizing: "border-box",
                                }}
                              />
                            </td>
                            <td style={{ padding: "8px 10px" }}>
                              <input
                                type="text"
                                placeholder="Optional note"
                                value={row.remarks || ""}
                                onChange={(e) => handleItemChange(idx, "remarks", e.target.value)}
                                style={{
                                  width: "100%",
                                  padding: "5px 8px",
                                  borderRadius: "4px",
                                  border: "1px solid #cbd5e1",
                                  fontSize: "12px",
                                  boxSizing: "border-box",
                                }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Overall Remarks */}
                <div>
                  <label style={{ fontSize: "11.5px", fontWeight: 700, color: "#475569", display: "block", marginBottom: "4px" }}>
                    Warehouse Inward Remarks
                  </label>
                  <input
                    type="text"
                    value={inwardRemarks}
                    onChange={(e) => setInwardRemarks(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "7px 10px",
                      fontSize: "12.5px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </>
            )}
          </div>

          {/* Footer Bar */}
          <div
            style={{
              padding: "12px 20px",
              borderTop: "1px solid #e2e8f0",
              background: "#fafbfc",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", gap: "16px", fontSize: "13px" }}>
              <div>
                Ordered: <strong>{totalOrdered}</strong>
              </div>
              <div style={{ color: "#16a34a" }}>
                Received: <strong>{totalReceived}</strong> units
              </div>
              {totalDamaged > 0 && (
                <div style={{ color: "#dc2626" }}>
                  Damaged: <strong>{totalDamaged}</strong> units
                </div>
              )}
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
                  cursor: submitting ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={submitting || loading || items.length === 0}
                style={{
                  padding: "8px 20px",
                  borderRadius: "6px",
                  border: "none",
                  background: submitting ? "#94a3b8" : "#16a34a",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: submitting ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 2px 4px rgba(22, 163, 74, 0.2)",
                }}
              >
                {submitting ? "Posting to Stock Ledger..." : "✓ Confirm Inward to Warehouse"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
