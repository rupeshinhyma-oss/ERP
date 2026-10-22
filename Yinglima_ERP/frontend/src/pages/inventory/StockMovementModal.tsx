/**
 * Stock Movement Creation Modal (Inward & Outward).
 *
 * Supports:
 * - 1-Click extraction from Local Purchase bills (for Inward).
 * - 1-Click extraction from Sale Process orders (for Outward).
 * - Direct manual entry for opening stock, samples, and adjustments.
 * - Dynamic line items table with live calculation of accepted/net quantity.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { apiGet, apiPost, errorMessage } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type {
  PurchaseExtractResponse,
  SaleOrderExtractResponse,
  StockMovement,
  StockMovementCreatePayload,
  StockMovementSource,
  StockMovementType,
} from "@/types/stockMovement";

interface StockMovementModalProps {
  isOpen: boolean;
  onClose: () => void;
  movementType: StockMovementType;
  onSuccess: (created: StockMovement) => void;
}

interface ItemRow {
  product_id?: string | null;
  product_name: string;
  product_code?: string | null;
  expected_quantity: number;
  quantity: number;
  damaged_quantity: number;
  accepted_quantity: number;
  unit_rate: number;
  package_details?: string | null;
  remarks?: string | null;
}

export function StockMovementModal({
  isOpen,
  onClose,
  movementType,
  onSuccess,
}: StockMovementModalProps) {
  const showToast = useToast();

  const isInward = movementType === "inward";

  const [sourceType, setSourceType] = useState<StockMovementSource>(
    isInward ? "local_purchase" : "sale_process"
  );
  const [movementDate, setMovementDate] = useState(
    new Date().toISOString().slice(0, 10)
  );

  // Form Header State
  const [supplierName, setSupplierName] = useState("");
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [buyerName, setBuyerName] = useState("");
  const [buyerId, setBuyerId] = useState<string | null>(null);
  const [referenceNo, setReferenceNo] = useState("");
  const [warehouseLocation, setWarehouseLocation] = useState("Main Godown");
  const [vehicleNo, setVehicleNo] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [containerNo, setContainerNo] = useState("");
  const [remarks, setRemarks] = useState("");

  // 1-Click Extraction State
  const [purchaseInvoiceNo, setPurchaseInvoiceNo] = useState<string | null>(null);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);
  const [saleOrderNo, setSaleOrderNo] = useState<string | null>(null);
  const [selectedSaleOrderId, setSelectedSaleOrderId] = useState<string | null>(null);

  // Lookup options for PO / SO
  const [purchasesList, setPurchasesList] = useState<{ id: string; label: string }[]>([]);
  const [saleOrdersList, setSaleOrdersList] = useState<{ id: string; label: string }[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Live warehouse stock balances for outward validation
  const [stockMap, setStockMap] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!isOpen || isInward) return;
    const loadBalances = async () => {
      try {
        const res = await apiGet<{ items: { product_id?: string; product_code?: string; product_name: string; current_stock_qty: number }[] }>("/stock/balances?limit=500");
        const map: Record<string, number> = {};
        for (const b of res.data?.items || []) {
          if (b.product_id) map[b.product_id] = b.current_stock_qty;
          if (b.product_code?.trim()) map[b.product_code.trim().toLowerCase()] = b.current_stock_qty;
          if (b.product_name?.trim()) map[b.product_name.trim().toLowerCase()] = b.current_stock_qty;
        }
        setStockMap(map);
      } catch {
        // Ignore failure
      }
    };
    loadBalances();
  }, [isOpen, isInward]);

  const getItemStock = useCallback(
    (it: ItemRow): number => {
      if (it.product_id && stockMap[it.product_id] !== undefined) return stockMap[it.product_id];
      if (it.product_code?.trim() && stockMap[it.product_code.trim().toLowerCase()] !== undefined) {
        return stockMap[it.product_code.trim().toLowerCase()];
      }
      if (it.product_name?.trim() && stockMap[it.product_name.trim().toLowerCase()] !== undefined) {
        return stockMap[it.product_name.trim().toLowerCase()];
      }
      return 0;
    },
    [stockMap]
  );

  // Searchable Dropdown state for order / purchase selection
  const [orderSearchText, setOrderSearchText] = useState("");
  const [orderDropdownOpen, setOrderDropdownOpen] = useState(false);
  const orderDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (orderDropdownRef.current && !orderDropdownRef.current.contains(e.target as Node)) {
        setOrderDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const activeOrdersList = isInward ? purchasesList : saleOrdersList;
  const filteredOrdersList = useMemo(() => {
    if (!orderSearchText.trim()) return activeOrdersList;
    const q = orderSearchText.toLowerCase();
    return activeOrdersList.filter((o) => o.label.toLowerCase().includes(q));
  }, [activeOrdersList, orderSearchText]);

  const selectedOrderLabel = useMemo(() => {
    const currentId = isInward ? selectedPurchaseId : selectedSaleOrderId;
    const found = activeOrdersList.find((o) => o.id === currentId);
    return found ? found.label : "";
  }, [activeOrdersList, isInward, selectedPurchaseId, selectedSaleOrderId]);

  const createEmptyItem = (): ItemRow => ({
    product_name: "",
    product_code: "",
    expected_quantity: 0,
    quantity: 0,
    damaged_quantity: 0,
    accepted_quantity: 0,
    unit_rate: 0,
  });

  // Line Items
  const [items, setItems] = useState<ItemRow[]>([]);

  const resetForm = useCallback(() => {
    setSourceType(isInward ? "local_purchase" : "sale_process");
    setMovementDate(new Date().toISOString().slice(0, 10));
    setSupplierName("");
    setSupplierId(null);
    setBuyerName("");
    setBuyerId(null);
    setReferenceNo("");
    setWarehouseLocation("Main Godown");
    setVehicleNo("");
    setTransporterName("");
    setContainerNo("");
    setRemarks("");

    setPurchaseInvoiceNo(null);
    setSelectedPurchaseId(null);
    setSaleOrderNo(null);
    setSelectedSaleOrderId(null);

    setOrderSearchText("");
    setOrderDropdownOpen(false);
    setItems([]);
  }, [isInward]);

  const handleClearSelectedOrder = useCallback(() => {
    setSelectedPurchaseId(null);
    setPurchaseInvoiceNo(null);
    setSelectedSaleOrderId(null);
    setSaleOrderNo(null);
    setOrderSearchText("");
    setOrderDropdownOpen(false);

    setSupplierName("");
    setSupplierId(null);
    setBuyerName("");
    setBuyerId(null);
    setReferenceNo("");
    setVehicleNo("");
    setTransporterName("");
    setContainerNo("");
    setRemarks("");

    setItems([]);
  }, []);

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Automatically reset the form whenever the modal opens
  useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [isOpen, resetForm]);

  // Load available purchases / sales orders when modal opens
  useEffect(() => {
    if (!isOpen) return;

    if (isInward) {
      apiGet<{ items: { id: string; invoice_no: string; supplier_name: string; invoice_date: string }[] }>(
        "/purchases/local?limit=100"
      )
        .then((res) => {
          const rows = res.data?.items || [];
          setPurchasesList(
            rows.map((p) => ({
              id: p.id,
              label: `${p.invoice_no} (${p.supplier_name}) - ${p.invoice_date}`,
            }))
          );
        })
        .catch(() => {});
    } else {
      apiGet<{ items: { id: string; order_no: string; buyer_name: string; order_date: string; container_no?: string }[] }>(
        "/sales/orders?limit=100"
      )
        .then((res) => {
          const rows = res.data?.items || [];
          setSaleOrdersList(
            rows.map((s) => ({
              id: s.id,
              label: `${s.order_no} (${s.buyer_name}) - ${s.order_date}${s.container_no ? ` [${s.container_no}]` : ""}`,
            }))
          );
        })
        .catch(() => {});
    }
  }, [isOpen, isInward]);

  // Handle 1-Click Extract from Local Purchase
  const handleExtractPurchase = async (purchaseId: string) => {
    if (!purchaseId) return;
    setExtracting(true);
    try {
      const res = await apiGet<PurchaseExtractResponse>(`/stock/extract/purchase/${purchaseId}`);
      const data = res.data;
      if (data) {
        setSelectedPurchaseId(data.purchase_id);
        setPurchaseInvoiceNo(data.invoice_no);
        setSupplierId(data.supplier_id);
        setSupplierName(data.supplier_name);
        setReferenceNo(data.invoice_no);
        if (data.consignment_code) {
          setRemarks(`Consignment: ${data.consignment_code}`);
        }
        const extractedRows: ItemRow[] = data.items.map((it) => ({
          product_id: it.product_id,
          product_name: it.product_name,
          product_code: it.product_code,
          expected_quantity: it.quantity,
          quantity: it.quantity,
          damaged_quantity: 0,
          accepted_quantity: it.quantity,
          unit_rate: it.unit_rate,
        }));
        setItems(extractedRows);
        if (data.items.length > 0) {
          showToast(`Extracted ${data.items.length} items from Bill ${data.invoice_no}`, "success");
        } else {
          showToast(`Bill ${data.invoice_no} has no line items`, "warning");
        }
      }
    } catch (err) {
      showToast(errorMessage(err) || "Failed to extract purchase data", "error");
    } finally {
      setExtracting(false);
    }
  };

  // Handle 1-Click Extract from Sale Order
  const handleExtractSaleOrder = async (orderId: string) => {
    if (!orderId) return;
    setExtracting(true);
    try {
      const res = await apiGet<SaleOrderExtractResponse>(`/stock/extract/sale-order/${orderId}`);
      const data = res.data;
      if (data) {
        setSelectedSaleOrderId(data.sale_order_id);
        setSaleOrderNo(data.order_no);
        setBuyerId(data.buyer_id || null);
        setBuyerName(data.buyer_name);
        setReferenceNo(data.order_no);
        if (data.container_no) setContainerNo(data.container_no);
        if (data.transporter_name) setTransporterName(data.transporter_name);
        if (data.lr_no) setVehicleNo(data.lr_no);
        if (data.consignment_code) {
          setRemarks(`Consignment: ${data.consignment_code}`);
        }
        const extractedRows: ItemRow[] = data.items.map((it) => ({
          product_id: it.product_id,
          product_name: it.product_name,
          product_code: it.product_code,
          expected_quantity: it.quantity,
          quantity: it.quantity,
          damaged_quantity: 0,
          accepted_quantity: it.quantity,
          unit_rate: it.unit_rate,
        }));
        setItems(extractedRows);
        if (data.items.length > 0) {
          showToast(`Extracted ${data.items.length} items from Order ${data.order_no}`, "success");
        } else {
          showToast(`Order ${data.order_no} has no line items`, "warning");
        }
      }
    } catch (err) {
      showToast(errorMessage(err) || "Failed to extract sale order data", "error");
    } finally {
      setExtracting(false);
    }
  };

  const updateItem = (index: number, patch: Partial<ItemRow>) => {
    setItems((prev) => {
      const copy = [...prev];
      const current = { ...copy[index], ...patch };
      // auto compute accepted_quantity if quantity or damaged_quantity changes
      if ("quantity" in patch || "damaged_quantity" in patch) {
        current.accepted_quantity = Math.max(0, current.quantity - current.damaged_quantity);
      }
      copy[index] = current;
      return copy;
    });
  };

  const addItemRow = () => {
    setItems((prev) => [...prev, createEmptyItem()]);
  };

  const removeItemRow = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Submit Handler
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (items.length === 0) {
      showToast(
        `Please ${
          sourceType !== "direct"
            ? isInward
              ? "select a confirmed purchase bill"
              : "select a confirmed sale order"
            : "add at least one line item"
        } before recording stock`,
        "error"
      );
      return;
    }
    if (items.some((it) => !it.product_name.trim())) {
      showToast("Please enter Product Name for all items", "error");
      return;
    }
    if (items.some((it) => it.quantity <= 0)) {
      showToast("Quantity must be greater than 0 for all items", "error");
      return;
    }

    // STRICT OUTWARD VALIDATION (Block Outward if quantity exceeds available stock)
    if (!isInward) {
      for (const it of items) {
        const avail = getItemStock(it);
        const req = it.accepted_quantity > 0 ? it.accepted_quantity : it.quantity;
        if (req > avail) {
          showToast(
            `Insufficient Stock for "${it.product_name}". Available in warehouse: ${avail} units, requested: ${req} units. Outward dispatch blocked to prevent negative inventory.`,
            "error"
          );
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      const payload: StockMovementCreatePayload = {
        movement_type: movementType,
        movement_date: movementDate,
        source_type: sourceType,
        purchase_id: isInward && sourceType === "local_purchase" ? selectedPurchaseId : null,
        purchase_invoice_no: isInward && sourceType === "local_purchase" ? purchaseInvoiceNo : null,
        sale_order_id: !isInward && sourceType === "sale_process" ? selectedSaleOrderId : null,
        sale_order_no: !isInward && sourceType === "sale_process" ? saleOrderNo : null,
        supplier_id: isInward ? supplierId : null,
        supplier_name: isInward ? supplierName : null,
        buyer_id: !isInward ? buyerId : null,
        buyer_name: !isInward ? buyerName : null,
        reference_no: referenceNo || null,
        warehouse_location: warehouseLocation || null,
        vehicle_no: vehicleNo || null,
        transporter_name: transporterName || null,
        container_no: containerNo || null,
        remarks: remarks || null,
        items: items.map((it) => ({
          product_id: it.product_id || null,
          product_name: it.product_name.trim(),
          product_code: it.product_code?.trim() || null,
          expected_quantity: Number(it.expected_quantity) || 0,
          quantity: Number(it.quantity) || 0,
          damaged_quantity: Number(it.damaged_quantity) || 0,
          accepted_quantity: Number(it.accepted_quantity) || 0,
          unit_rate: Number(it.unit_rate) || 0,
          package_details: it.package_details || null,
          remarks: it.remarks || null,
        })),
      };

      const res = await apiPost<StockMovement>("/stock/movements", payload);
      showToast(
        `${isInward ? "Inward" : "Outward"} entry ${res.data?.movement_no || ""} recorded successfully!`,
        "success"
      );
      if (res.data) {
        onSuccess(res.data);
      }
      resetForm();
      onClose();
    } catch (err) {
      showToast(errorMessage(err) || "Failed to record stock movement", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const totalAcceptedQty = items.reduce((acc, it) => acc + (Number(it.accepted_quantity) || 0), 0);

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
      <style>{`
        .stock-modal-scroll::-webkit-scrollbar,
        .stock-table-scroll::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .stock-modal-scroll::-webkit-scrollbar-track,
        .stock-table-scroll::-webkit-scrollbar-track {
          background: #f1f5f9;
          border-radius: 4px;
        }
        .stock-modal-scroll::-webkit-scrollbar-thumb,
        .stock-table-scroll::-webkit-scrollbar-thumb {
          background: #94a3b8;
          border-radius: 4px;
        }
        .stock-modal-scroll::-webkit-scrollbar-thumb:hover,
        .stock-table-scroll::-webkit-scrollbar-thumb:hover {
          background: #64748b;
        }
      `}</style>
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "14px",
          width: "96vw",
          maxWidth: "1280px",
          height: "94vh",
          maxHeight: "96vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          border: "1px solid #cbd5e1",
          overflow: "hidden",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "10px 18px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: isInward
              ? "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)"
              : "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span
              style={{
                fontSize: "18px",
                backgroundColor: isInward ? "#16a34a" : "#2563eb",
                color: "#fff",
                width: "34px",
                height: "34px",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {isInward ? "📥" : "📤"}
            </span>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "#0f172a" }}>
                {isInward ? "New Stock Inward Entry (Receipt)" : "New Stock Outward Entry (Dispatch)"}
              </h2>
              <p style={{ margin: "1px 0 0 0", fontSize: "12px", color: "#64748b" }}>
                {isInward
                  ? "Record incoming vendor goods, factory shipments, or warehouse returns"
                  : "Record goods dispatched to buyers, branch transfers, or container loadings"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            style={{
              border: "none",
              background: "#ffffff",
              color: "#64748b",
              borderRadius: "6px",
              width: "28px",
              height: "28px",
              cursor: "pointer",
              fontSize: "14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body Form */}
        <form
          onSubmit={handleSubmit}
          style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <div
            className="stock-modal-scroll"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "10px 16px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            {/* Sourcing / Entry Mode Selection Card */}
            <div
              style={{
                padding: "8px 12px",
                backgroundColor: "#f8fafc",
                borderRadius: "10px",
                border: "1px solid #e2e8f0",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  1. Entry Mode & Source
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      const target = isInward ? "local_purchase" : "sale_process";
                      if (sourceType !== target) {
                        setSourceType(target);
                        handleClearSelectedOrder();
                      }
                    }}
                    style={{
                      padding: "4px 12px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      border: "1px solid",
                      backgroundColor:
                        sourceType !== "direct" ? (isInward ? "#16a34a" : "#2563eb") : "#ffffff",
                      borderColor:
                        sourceType !== "direct" ? (isInward ? "#16a34a" : "#2563eb") : "#cbd5e1",
                      color: sourceType !== "direct" ? "#ffffff" : "#475569",
                    }}
                  >
                    ⚡ 1-Click Extract from {isInward ? "Local Purchase" : "Sale Process"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (sourceType !== "direct") {
                        setSourceType("direct");
                        handleClearSelectedOrder();
                        setItems([createEmptyItem()]);
                      }
                    }}
                    style={{
                      padding: "4px 12px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      border: "1px solid",
                      backgroundColor: sourceType === "direct" ? "#0f172a" : "#ffffff",
                      borderColor: sourceType === "direct" ? "#0f172a" : "#cbd5e1",
                      color: sourceType === "direct" ? "#ffffff" : "#475569",
                    }}
                  >
                    ✍️ Direct Manual Entry
                  </button>
                </div>
              </div>

              {/* If 1-Click Extract Mode */}
              {sourceType !== "direct" && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: "10px",
                    alignItems: "center",
                    backgroundColor: "#ffffff",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                  }}
                >
                  <div ref={orderDropdownRef} style={{ position: "relative", width: "100%" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569" }}>
                        {isInward ? "Select Confirmed Purchase Bill (Type to Search)" : "Select Confirmed Sale Order (Type to Search)"}
                      </label>
                      {activeOrdersList.length > 0 && (
                        <span style={{ fontSize: "11px", color: "#64748b" }}>
                          {activeOrdersList.length} order{activeOrdersList.length > 1 ? "s" : ""} available
                        </span>
                      )}
                    </div>

                    {/* Searchable Combobox Trigger / Search Input */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        border: "1px solid #cbd5e1",
                        borderRadius: "6px",
                        backgroundColor: "#ffffff",
                        padding: "4px 10px",
                        gap: "8px",
                        boxShadow: orderDropdownOpen ? "0 0 0 2px rgba(37,99,235,0.15)" : "none",
                        borderColor: orderDropdownOpen ? "#2563eb" : "#cbd5e1",
                      }}
                    >
                      <span style={{ fontSize: "13px", color: "#64748b" }}>🔍</span>
                      <input
                        type="text"
                        placeholder={
                          selectedOrderLabel
                            ? `Selected: ${selectedOrderLabel}`
                            : isInward
                            ? "Type to search purchase bill #, vendor name..."
                            : "Type to search SO #, buyer name, container..."
                        }
                        value={orderSearchText}
                        onFocus={() => setOrderDropdownOpen(true)}
                        onChange={(e) => {
                          setOrderSearchText(e.target.value);
                          setOrderDropdownOpen(true);
                        }}
                        style={{
                          flex: 1,
                          border: "none",
                          outline: "none",
                          fontSize: "13px",
                          color: "#0f172a",
                          backgroundColor: "transparent",
                        }}
                      />
                      {(selectedOrderLabel || orderSearchText) && (
                        <button
                          type="button"
                          onClick={() => {
                            handleClearSelectedOrder();
                          }}
                          title="Clear selected order & extracted line items"
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            fontSize: "13px",
                            color: "#94a3b8",
                            padding: "0 2px",
                          }}
                        >
                          ✕
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setOrderDropdownOpen((prev) => !prev)}
                        style={{
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          color: "#64748b",
                          fontSize: "10px",
                          padding: "0 2px",
                        }}
                      >
                        {orderDropdownOpen ? "▲" : "▼"}
                      </button>
                    </div>

                    {/* Dropdown Options Popup */}
                    {orderDropdownOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: "calc(100% + 4px)",
                          left: 0,
                          right: 0,
                          maxHeight: "220px",
                          overflowY: "auto",
                          backgroundColor: "#ffffff",
                          border: "1px solid #cbd5e1",
                          borderRadius: "8px",
                          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.15)",
                          zIndex: 60,
                        }}
                      >
                        {filteredOrdersList.length === 0 ? (
                          <div style={{ padding: "10px 14px", fontSize: "12px", color: "#64748b" }}>
                            No orders matching "{orderSearchText}"
                          </div>
                        ) : (
                          filteredOrdersList.map((opt) => {
                            const isSelected =
                              (isInward ? selectedPurchaseId : selectedSaleOrderId) === opt.id;
                            return (
                              <div
                                key={opt.id}
                                onClick={() => {
                                  if (isInward) {
                                    handleExtractPurchase(opt.id);
                                  } else {
                                    handleExtractSaleOrder(opt.id);
                                  }
                                  setOrderSearchText("");
                                  setOrderDropdownOpen(false);
                                }}
                                style={{
                                  padding: "8px 12px",
                                  fontSize: "13px",
                                  cursor: "pointer",
                                  borderBottom: "1px solid #f1f5f9",
                                  backgroundColor: isSelected ? "#eff6ff" : "#ffffff",
                                  color: isSelected ? "#2563eb" : "#0f172a",
                                  fontWeight: isSelected ? 600 : 400,
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                }}
                                onMouseEnter={(e) => {
                                  if (!isSelected) e.currentTarget.style.backgroundColor = "#f8fafc";
                                }}
                                onMouseLeave={(e) => {
                                  if (!isSelected) e.currentTarget.style.backgroundColor = "#ffffff";
                                }}
                              >
                                <span>{opt.label}</span>
                                {isSelected && <span style={{ fontSize: "12px", color: "#2563eb" }}>✓</span>}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>

                  {extracting && (
                    <span style={{ fontSize: "12px", color: "#2563eb", fontWeight: 600, whiteSpace: "nowrap" }}>
                      ⏳ Extracting data...
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Header Metadata Grid (Compact 4 columns) */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "8px 12px",
                backgroundColor: "#ffffff",
                padding: "8px 12px",
                borderRadius: "10px",
                border: "1px solid #e2e8f0",
              }}
            >
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#475569", marginBottom: "3px" }}>
                  {isInward ? "Inward Date *" : "Outward Date *"}
                </label>
                <input
                  type="date"
                  required
                  value={movementDate}
                  onChange={(e) => setMovementDate(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "5px 8px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#475569", marginBottom: "3px" }}>
                  {isInward ? "Supplier / Vendor Name" : "Buyer / Customer Name"}
                </label>
                <input
                  type="text"
                  placeholder={isInward ? "e.g. Apex Packaging" : "e.g. Om Packaging"}
                  value={isInward ? supplierName : buyerName}
                  onChange={(e) => (isInward ? setSupplierName(e.target.value) : setBuyerName(e.target.value))}
                  style={{
                    width: "100%",
                    padding: "5px 8px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#475569", marginBottom: "3px" }}>
                  {isInward ? "Vendor Bill / Challan No" : "Dispatch Challan / LR No"}
                </label>
                <input
                  type="text"
                  placeholder="e.g. CHAL-4890 / LR-9912"
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "5px 8px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#475569", marginBottom: "3px" }}>
                  Receiving / Dispatch Warehouse
                </label>
                <input
                  type="text"
                  placeholder="e.g. Mumbai Main Warehouse"
                  value={warehouseLocation}
                  onChange={(e) => setWarehouseLocation(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "5px 8px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#475569", marginBottom: "3px" }}>
                  Vehicle / Tempo No
                </label>
                <input
                  type="text"
                  placeholder="e.g. MH-04-AB-1234"
                  value={vehicleNo}
                  onChange={(e) => setVehicleNo(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "5px 8px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#475569", marginBottom: "3px" }}>
                  Transporter Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. V-Trans / SafeExpress"
                  value={transporterName}
                  onChange={(e) => setTransporterName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "5px 8px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#475569", marginBottom: "3px" }}>
                  Container / Seal No (if applicable)
                </label>
                <input
                  type="text"
                  placeholder="e.g. MSKU992381 / SEAL-7788"
                  value={containerNo}
                  onChange={(e) => setContainerNo(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "5px 8px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#475569", marginBottom: "3px" }}>
                  General Remarks / Notes
                </label>
                <input
                  type="text"
                  placeholder="e.g. Consignment MP-06 / Gate inspected"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "5px 8px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                  }}
                />
              </div>
            </div>

          {/* Line Items Table Card */}
          <div
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: "10px",
              overflow: "hidden",
              backgroundColor: "#ffffff",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "8px 14px",
                backgroundColor: "#f8fafc",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#334155", textTransform: "uppercase" }}>
                  2. Goods Line Items ({items.length} items)
                </span>
                <span style={{ fontSize: "11px", color: "#64748b", background: "#f1f5f9", padding: "2px 8px", borderRadius: "12px" }}>
                  {items.length > 0 ? `Scroll table to view all ${items.length} items` : "0 items currently added"}
                </span>
              </div>
              <button
                type="button"
                onClick={addItemRow}
                style={{
                  padding: "4px 10px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                + Add Item
              </button>
            </div>

            <div
              className="stock-table-scroll"
              style={{
                maxHeight: "520px",
                overflowY: "auto",
                overflowX: "auto",
                scrollbarGutter: "stable",
              }}
            >
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
                    <th style={{ padding: "8px 10px" }}>Product Name *</th>
                    <th style={{ padding: "8px 10px", width: "130px" }}>Product Code</th>
                    <th style={{ padding: "8px 10px", width: "110px", textAlign: "right" }}>Expected Qty</th>
                    <th style={{ padding: "8px 10px", width: "110px", textAlign: "right" }}>
                      {isInward ? "Received Qty *" : "Dispatched Qty *"}
                    </th>
                    {isInward && (
                      <th style={{ padding: "8px 10px", width: "100px", textAlign: "right" }}>Damaged Qty</th>
                    )}
                    <th style={{ padding: "8px 10px", width: "110px", textAlign: "right" }}>Accepted Qty</th>
                    <th style={{ padding: "8px 10px", width: "120px" }}>Package Details</th>
                    <th style={{ padding: "8px 10px", width: "50px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td
                        colSpan={isInward ? 8 : 7}
                        style={{
                          textAlign: "center",
                          padding: "36px 16px",
                          color: "#64748b",
                          backgroundColor: "#fcfdfe",
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "28px" }}>{isInward ? "📥" : "📤"}</span>
                          <span style={{ fontWeight: 600, fontSize: "14px", color: "#334155" }}>
                            {sourceType !== "direct"
                              ? isInward
                                ? "No purchase bill selected yet"
                                : "No sale order selected yet"
                              : "No line items added yet"}
                          </span>
                          <span style={{ fontSize: "12px", color: "#64748b", maxWidth: "480px", lineHeight: "1.5" }}>
                            {sourceType !== "direct"
                              ? `Search and select a confirmed ${
                                  isInward ? "purchase bill" : "sale order"
                                } above to auto-extract line items, or click "+ Add Item" above to add products manually.`
                              : 'Click the "+ Add Item" button above to add line items manually to this stock movement.'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    items.map((it, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "6px 8px" }}>
                          <input
                            type="text"
                            required
                            placeholder="e.g. Vacuum Sealing Film"
                            value={it.product_name}
                            onChange={(e) => updateItem(idx, { product_name: e.target.value })}
                            style={{
                              width: "100%",
                              padding: "5px 8px",
                              borderRadius: "6px",
                              border: "1px solid #cbd5e1",
                              fontSize: "13px",
                            }}
                          />
                          {!isInward && it.product_name.trim() && (
                            <div style={{ marginTop: "4px", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                              <span
                                style={{
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  padding: "1px 6px",
                                  borderRadius: "4px",
                                  backgroundColor: getItemStock(it) > 0 ? "#dcfce7" : "#fee2e2",
                                  color: getItemStock(it) > 0 ? "#15803d" : "#b91c1c",
                                }}
                              >
                                In-Stock: {getItemStock(it)} units
                              </span>
                              {it.quantity > getItemStock(it) && (
                                <span style={{ fontSize: "11px", color: "#dc2626", fontWeight: 700 }}>
                                  ⚠️ Blocked: Exceeds warehouse stock!
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <input
                            type="text"
                            placeholder="SKU"
                            value={it.product_code || ""}
                            onChange={(e) => updateItem(idx, { product_code: e.target.value })}
                            style={{
                              width: "100%",
                              padding: "5px 8px",
                              borderRadius: "6px",
                              border: "1px solid #cbd5e1",
                              fontSize: "13px",
                            }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          <input
                            type="number"
                            step="any"
                            value={it.expected_quantity || ""}
                            onChange={(e) => updateItem(idx, { expected_quantity: parseFloat(e.target.value) || 0 })}
                            style={{
                              width: "100%",
                              textAlign: "right",
                              padding: "5px 8px",
                              borderRadius: "6px",
                              border: "1px solid #cbd5e1",
                              fontSize: "13px",
                            }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          <input
                            type="number"
                            step="any"
                            required
                            value={it.quantity || ""}
                            onChange={(e) => updateItem(idx, { quantity: parseFloat(e.target.value) || 0 })}
                            style={{
                              width: "100%",
                              textAlign: "right",
                              padding: "5px 8px",
                              borderRadius: "6px",
                              border:
                                !isInward && it.quantity > getItemStock(it)
                                  ? "1.5px solid #ef4444"
                                  : "1px solid #94a3b8",
                              backgroundColor:
                                !isInward && it.quantity > getItemStock(it) ? "#fff1f2" : "#ffffff",
                              fontWeight: 600,
                              fontSize: "13px",
                            }}
                          />
                        </td>
                        {isInward && (
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>
                            <input
                              type="number"
                              step="any"
                              value={it.damaged_quantity || ""}
                              onChange={(e) => updateItem(idx, { damaged_quantity: parseFloat(e.target.value) || 0 })}
                              style={{
                                width: "100%",
                                textAlign: "right",
                                padding: "5px 8px",
                                borderRadius: "6px",
                                border: "1px solid #cbd5e1",
                                color: it.damaged_quantity > 0 ? "#dc2626" : "#475569",
                                fontSize: "13px",
                              }}
                            />
                          </td>
                        )}
                        <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: "#16a34a" }}>
                          {it.accepted_quantity.toLocaleString()}
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <input
                            type="text"
                            placeholder="e.g. 10 Boxes"
                            value={it.package_details || ""}
                            onChange={(e) => updateItem(idx, { package_details: e.target.value })}
                            style={{
                              width: "100%",
                              padding: "5px 8px",
                              borderRadius: "6px",
                              border: "1px solid #cbd5e1",
                              fontSize: "13px",
                            }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "center" }}>
                          <button
                            type="button"
                            onClick={() => removeItemRow(idx)}
                            title="Remove item"
                            style={{
                              border: "none",
                              background: "transparent",
                              color: "#ef4444",
                              cursor: "pointer",
                              fontSize: "16px",
                            }}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Submit Actions Footer (Pinned at modal bottom) */}
        <div
          style={{
            padding: "10px 18px",
            borderTop: "1px solid #e2e8f0",
            backgroundColor: "#f8fafc",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: "13px", color: "#64748b" }}>
            Total Items: <strong style={{ color: "#0f172a" }}>{items.length}</strong> | Total Net Qty:{" "}
            <strong style={{ color: isInward ? "#16a34a" : "#2563eb", fontSize: "15px" }}>
              {totalAcceptedQty.toLocaleString()}
            </strong>
          </div>

          {(() => {
            const hasOutwardDeficit =
              !isInward &&
              items.some(
                (it) =>
                  it.product_name.trim() &&
                  (it.accepted_quantity > 0 ? it.accepted_quantity : it.quantity) > getItemStock(it)
              );

            return (
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  onClick={handleClose}
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
                  disabled={submitting || hasOutwardDeficit || items.length === 0}
                  style={{
                    padding: "8px 20px",
                    borderRadius: "6px",
                    border: "none",
                    background:
                      hasOutwardDeficit || items.length === 0
                        ? "#94a3b8"
                        : isInward
                        ? "linear-gradient(135deg, #16a34a 0%, #15803d 100%)"
                        : "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "#ffffff",
                    cursor:
                      submitting || hasOutwardDeficit || items.length === 0
                        ? "not-allowed"
                        : "pointer",
                    boxShadow:
                      hasOutwardDeficit || items.length === 0
                        ? "none"
                        : "0 2px 4px rgba(0, 0, 0, 0.1)",
                  }}
                  title={
                    items.length === 0
                      ? `Select a ${isInward ? "purchase bill" : "sale order"} or add line items first`
                      : hasOutwardDeficit
                      ? "Outward dispatch blocked: One or more items exceed warehouse in-stock balance"
                      : undefined
                  }
                >
                  {submitting
                    ? "Saving..."
                    : hasOutwardDeficit
                    ? "🚫 Blocked: Insufficient Stock"
                    : isInward
                    ? "Confirm & Record Inward Stock"
                    : "Confirm & Record Outward Stock"}
                </button>
              </div>
            );
          })()}
        </div>
      </form>
      </div>
    </div>
  );
}
