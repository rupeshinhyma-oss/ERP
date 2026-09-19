import React, { useState, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { InventoryApi } from "@/lib/api";
import { INITIAL_STOCK_ITEMS } from "@/pages/ProductStockPage";
import "@/styles/stockAdjustment.css";

function formatIndianCurrency(amount: number): string {
  return "₹ " + amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface SelectedAdjustmentProduct {
  id: string;
  product_name: string;
  product_code: string;
  category: string;
  hsn_code: string;
  gst_rate: string;
  available_qty: number;
  qty: number;
  unit_price: number;
  total_price: number;
  uom: string;
}

const WAREHOUSE_OPTIONS = ["Ahmedabad", "Mumbai", "Indore", "Main Warehouse - Bhiwandi"];

const PURPOSE_OPTIONS = [
  "Return From Client",
  "Split",
  "Damage",
  "Inventory Count Variance",
  "Internal Transfer Correction",
];

// Default unit prices for demo items if not present
const PRODUCT_PRICE_MAP: Record<string, number> = {
  "stock-1": 15000,
  "stock-2": 275000,
  "stock-3": 61250,
  "stock-4": 42000,
  "stock-5": 89000,
  "stock-6": 125000,
  "stock-7": 340000,
  "stock-8": 95000,
  "stock-9": 18500,
  "stock-10": 45000,
  "stock-11": 72000,
  "stock-12": 115000,
};

export function AddAdjustmentOrderPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // URL query parameter ?type=Addition -> "Stock IN", ?type=Deduction -> "Stock OUT"
  const initialType = useMemo(() => {
    const t = searchParams.get("type");
    if (t === "Deduction" || t === "Stock OUT") return "Stock OUT";
    return "Stock IN";
  }, [searchParams]);

  const [adjustmentType, setAdjustmentType] = useState<"Stock IN" | "Stock OUT">(initialType);
  const [purpose, setPurpose] = useState<string>("");
  const [warehouse, setWarehouse] = useState<string>("");
  const [clientName, setClientName] = useState<string>("");
  const [invoiceNo, setInvoiceNo] = useState<string>("");
  const [remark, setRemark] = useState<string>("");

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showSearchDropdown, setShowSearchDropdown] = useState<boolean>(false);
  const [selectedProducts, setSelectedProducts] = useState<SelectedAdjustmentProduct[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Sync if URL query param changes
  useEffect(() => {
    setAdjustmentType(initialType);
  }, [initialType]);

  // Compute available stock for items based on selected warehouse
  const availableCatalog = useMemo(() => {
    return INITIAL_STOCK_ITEMS.map((item) => {
      let qtyInWarehouse = item.total_qty;
      if (warehouse === "Ahmedabad") qtyInWarehouse = item.ahmedabad;
      else if (warehouse === "Mumbai") qtyInWarehouse = item.mumbai;
      else if (warehouse === "Indore") qtyInWarehouse = item.indore;

      return {
        ...item,
        available_in_warehouse: qtyInWarehouse,
        unit_price: PRODUCT_PRICE_MAP[item.id] || 25000,
      };
    });
  }, [warehouse]);

  // Filtered search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !warehouse) return [];
    const q = searchQuery.toLowerCase();
    return availableCatalog.filter(
      (p) =>
        p.product_name_tally.toLowerCase().includes(q) ||
        p.product_code.toLowerCase().includes(q) ||
        (p.category && p.category.toLowerCase().includes(q)) ||
        (p.sub_category && p.sub_category.toLowerCase().includes(q))
    );
  }, [searchQuery, warehouse, availableCatalog]);

  // Handle adding a product from search
  const handleSelectProduct = (product: (typeof availableCatalog)[0]) => {
    setSelectedProducts((prev) => {
      const existingIdx = prev.findIndex((p) => p.id === product.id);
      if (existingIdx >= 0) {
        // Increment quantity
        const updated = [...prev];
        const item = updated[existingIdx];
        const newQty = item.qty + 1;
        updated[existingIdx] = {
          ...item,
          qty: newQty,
          total_price: newQty * item.unit_price,
        };
        return updated;
      }

      // Add new row
      const unitPrice = product.unit_price;
      return [
        ...prev,
        {
          id: product.id,
          product_name: product.product_name_tally,
          product_code: product.product_code !== "-" ? product.product_code : `SKU-${product.sr_no.toString().padStart(3, "0")}`,
          category: product.category || "Machines",
          hsn_code: product.hsn_code || "84224000",
          gst_rate: product.gst_rate || "18%",
          available_qty: product.available_in_warehouse,
          qty: 1,
          unit_price: unitPrice,
          total_price: unitPrice,
          uom: product.uom || "SET",
        },
      ];
    });

    setSearchQuery("");
    setShowSearchDropdown(false);
  };

  // Handle updating quantity
  const handleUpdateQty = (index: number, newQty: number) => {
    if (newQty < 1 || isNaN(newQty)) newQty = 1;
    setSelectedProducts((prev) => {
      const updated = [...prev];
      const item = updated[index];
      updated[index] = {
        ...item,
        qty: newQty,
        total_price: newQty * item.unit_price,
      };
      return updated;
    });
  };

  // Handle updating unit price
  const handleUpdatePrice = (index: number, newPrice: number) => {
    if (newPrice < 0 || isNaN(newPrice)) newPrice = 0;
    setSelectedProducts((prev) => {
      const updated = [...prev];
      const item = updated[index];
      updated[index] = {
        ...item,
        unit_price: newPrice,
        total_price: item.qty * newPrice,
      };
      return updated;
    });
  };

  // Remove a product row
  const handleRemoveProduct = (index: number) => {
    setSelectedProducts((prev) => prev.filter((_, i) => i !== index));
  };

  // Calculate Grand Total
  const grandTotal = useMemo(() => {
    return selectedProducts.reduce((sum, item) => sum + item.total_price, 0);
  }, [selectedProducts]);

  // Form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!purpose) {
      setErrorMessage("Please select an Adjustment Purpose.");
      return;
    }

    if (!warehouse) {
      setErrorMessage("Please select a Warehouse.");
      return;
    }

    if (selectedProducts.length === 0) {
      setErrorMessage("Please add at least one product to the adjustment order.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        adjustment_date: new Date().toISOString().split("T")[0],
        adjustment_type: adjustmentType === "Stock IN" ? "IN" : "OUT",
        client_name: clientName || undefined,
        invoice_no: invoiceNo || undefined,
        warehouse,
        purpose,
        remarks: remark || undefined,
        total_amount: grandTotal,
        items: selectedProducts.map((p) => ({
          product_id: p.id,
          item_name: p.product_name,
          category: p.category,
          hsn: p.hsn_code,
          gst: p.gst_rate,
          quantity: p.qty,
          unit_price: p.unit_price,
          total_price: p.total_price,
        })),
      };

      try {
        await InventoryApi.createStockAdjustment(payload);
      } catch (err) {
        // If offline or dev mode, still succeed locally
        console.warn("API createStockAdjustment fallback to local state:", err);
      }

      // Save locally to localStorage so StockAdjustmentPage can read it immediately
      const savedListStr = localStorage.getItem("local_stock_adjustments");
      const currentSaved = savedListStr ? JSON.parse(savedListStr) : [];
      const newRecord = {
        id: `adj-${Date.now()}`,
        adjustment_no: Math.floor(100 + Math.random() * 900).toString(),
        adjustment_date: new Date().toLocaleDateString("en-GB").replace(/\//g, "-"),
        client_name: clientName,
        invoice_no: invoiceNo || `${Math.floor(100 + Math.random() * 900)}/26-27`,
        warehouse,
        type: adjustmentType,
        purpose,
        total_amount: grandTotal,
        created_by: "Current User",
        created_at: new Date().toLocaleDateString("en-GB").replace(/\//g, "-"),
        remarks: remark,
        items: selectedProducts.map((p) => ({
          product_name: p.product_name,
          product_code: p.product_code,
          category: p.category,
          hsn_code: p.hsn_code,
          gst_rate: p.gst_rate,
          qty: p.qty,
          uom: p.uom,
          rate: p.unit_price,
          amount: p.total_price,
        })),
      };
      localStorage.setItem("local_stock_adjustments", JSON.stringify([newRecord, ...currentSaved]));

      // Navigate back to stock adjustment list
      navigate("/stock-adjustment");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to create stock adjustment order.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell activeKey="stock-adjustment">
      <div className="page-add-adjustment">
        {/* Header: Title and Back Button */}
        <div className="add-adjustment-header">
          <h1 className="add-adjustment-title">Add Adjustment Order</h1>
          <button
            type="button"
            className="add-adjustment-btn-back"
            onClick={() => navigate("/stock-adjustment")}
          >
            ← BACK
          </button>
        </div>

        {/* Error notification banner */}
        {errorMessage && (
          <div
            style={{
              padding: "12px 16px",
              backgroundColor: "#fee2e2",
              border: "1px solid #fca5a5",
              borderRadius: "6px",
              color: "#b91c1c",
              fontSize: "13px",
              fontWeight: 500,
              marginBottom: "16px",
            }}
          >
            ⚠️ {errorMessage}
          </div>
        )}

        {/* Form Container Card */}
        <form onSubmit={handleSubmit} className="add-adjustment-form-card">
          {/* Row 1: Adjustment Type, Purpose *, Warehouse */}
          <div className="add-adjustment-row-3">
            <div className="add-adj-field">
              <label htmlFor="adj-type">Adjustment Type</label>
              <select
                id="adj-type"
                className="add-adj-select"
                value={adjustmentType}
                onChange={(e) => setAdjustmentType(e.target.value as "Stock IN" | "Stock OUT")}
              >
                <option value="Stock IN">Stock IN</option>
                <option value="Stock OUT">Stock OUT</option>
              </select>
            </div>

            <div className="add-adj-field">
              <label htmlFor="adj-purpose">
                Purpose <span className="req">*</span>
              </label>
              <select
                id="adj-purpose"
                className="add-adj-select"
                value={purpose}
                onChange={(e) => {
                  setPurpose(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                required
              >
                <option value="">Select</option>
                {PURPOSE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div className="add-adj-field">
              <label htmlFor="adj-warehouse">Warehouse</label>
              <select
                id="adj-warehouse"
                className="add-adj-select"
                value={warehouse}
                onChange={(e) => {
                  setWarehouse(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
              >
                <option value="">Select Warehouse</option>
                {WAREHOUSE_OPTIONS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Client Name, Invoice No */}
          <div className="add-adjustment-row-2">
            <div className="add-adj-field">
              <label htmlFor="adj-client">Client Name</label>
              <input
                id="adj-client"
                type="text"
                className="add-adj-input"
                placeholder="Enter Client Name"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </div>

            <div className="add-adj-field">
              <label htmlFor="adj-invoice">Invoice No</label>
              <input
                id="adj-invoice"
                type="text"
                className="add-adj-input"
                placeholder="Enter Invoice No"
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
              />
            </div>
          </div>

          {/* Row 3: Remark */}
          <div className="add-adjustment-row-1">
            <div className="add-adj-field">
              <label htmlFor="adj-remark">Remark</label>
              <textarea
                id="adj-remark"
                className="add-adj-textarea"
                placeholder="Enter remarks / inspection notes..."
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </div>
          </div>

          {/* Row 4: PRODUCT SEARCH Fieldset */}
          <fieldset className="add-adj-search-fieldset">
            <legend>PRODUCT SEARCH</legend>
            <div className="add-adj-search-input-group">
              {/* Blue Barcode Addon */}
              <div className="add-adj-barcode-addon" title="Barcode Search">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14M21 5v14M5 5v14M13 5v14M17 5v14" />
                </svg>
              </div>

              {/* Search Text Input */}
              <input
                type="text"
                className="add-adj-search-input"
                placeholder="Enter Product Name / Model No"
                value={searchQuery}
                disabled={!warehouse}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSearchDropdown(Boolean(e.target.value.trim()));
                }}
                onFocus={() => {
                  if (searchQuery.trim() && warehouse) setShowSearchDropdown(true);
                }}
              />

              {/* Red Action Search Button */}
              <button
                type="button"
                className="add-adj-search-btn"
                title="Scan / Search Product"
                onClick={() => {
                  if (warehouse && searchQuery.trim()) {
                    setShowSearchDropdown(true);
                  }
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="22" y1="12" x2="18" y2="12" />
                  <line x1="6" y1="12" x2="2" y2="12" />
                  <line x1="12" y1="6" x2="12" y2="2" />
                  <line x1="12" y1="22" x2="12" y2="18" />
                </svg>
              </button>

              {/* Autocomplete Dropdown List */}
              {showSearchDropdown && warehouse && (
                <div className="add-adj-autocomplete-dropdown">
                  {searchResults.length > 0 ? (
                    searchResults.map((p) => (
                      <div
                        key={p.id}
                        className="add-adj-autocomplete-item"
                        onClick={() => handleSelectProduct(p)}
                      >
                        <div>
                          <strong style={{ fontSize: "13px", color: "#1e293b", display: "block" }}>
                            {p.product_name_tally}
                          </strong>
                          <span style={{ fontSize: "11.5px", color: "#64748b" }}>
                            {p.category || "Machines"} • SKU: {p.product_code !== "-" ? p.product_code : `SKU-${p.sr_no}`}
                          </span>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ fontSize: "12px", fontWeight: 600, color: p.available_in_warehouse > 0 ? "#15803d" : "#ef4444", display: "block" }}>
                            Avail: {p.available_in_warehouse} {p.uom || "SET"}
                          </span>
                          <span style={{ fontSize: "11px", color: "#64748b" }}>
                            {formatIndianCurrency(p.unit_price)}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: "12px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
                      No matching products found in {warehouse}.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Red Warning text if no warehouse selected */}
            {!warehouse && (
              <p className="add-adj-warn-text">Please Select Warehouse First.</p>
            )}
          </fieldset>

          {/* Row 5: Table of Products */}
          <div className="add-adj-table-wrap">
            <table className="add-adj-table">
              <thead>
                <tr>
                  <th style={{ width: "42%" }}>Product Name</th>
                  <th style={{ width: "12%", textAlign: "center" }}>Available Qty</th>
                  <th style={{ width: "12%", textAlign: "center" }}>Qty</th>
                  <th style={{ width: "16%", textAlign: "right" }}>Unit Price</th>
                  <th style={{ width: "14%", textAlign: "right" }}>Total Price</th>
                  <th style={{ width: "4%", textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {selectedProducts.length > 0 ? (
                  selectedProducts.map((p, idx) => (
                    <tr key={p.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: "#1e293b" }}>{p.product_name}</div>
                        <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                          {p.category} • HSN: {p.hsn_code} • GST: {p.gst_rate}
                        </div>
                      </td>
                      <td style={{ textAlign: "center", fontWeight: 600, color: p.available_qty > 0 ? "#15803d" : "#ef4444" }}>
                        {p.available_qty} {p.uom}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="number"
                          min="1"
                          style={{
                            width: "70px",
                            height: "32px",
                            padding: "4px 6px",
                            textAlign: "center",
                            border: "1px solid #cbd5e1",
                            borderRadius: "4px",
                            fontSize: "13px",
                            fontWeight: 600,
                          }}
                          value={p.qty}
                          onChange={(e) => handleUpdateQty(idx, parseInt(e.target.value, 10) || 1)}
                        />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <input
                          type="number"
                          min="0"
                          step="100"
                          style={{
                            width: "115px",
                            height: "32px",
                            padding: "4px 8px",
                            textAlign: "right",
                            border: "1px solid #cbd5e1",
                            borderRadius: "4px",
                            fontSize: "13px",
                          }}
                          value={p.unit_price}
                          onChange={(e) => handleUpdatePrice(idx, parseFloat(e.target.value) || 0)}
                        />
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                        {formatIndianCurrency(p.total_price)}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          onClick={() => handleRemoveProduct(idx)}
                          title="Remove item"
                          style={{
                            background: "none",
                            border: "none",
                            color: "#ef4444",
                            cursor: "pointer",
                            padding: "4px 8px",
                            fontSize: "16px",
                            lineHeight: 1,
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ padding: "20px", textAlign: "center", color: "#94a3b8" }}>
                      No items added yet. Select a warehouse and search for products above.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ textAlign: "right", fontWeight: 700, color: "#1e293b", paddingRight: "16px" }}>
                    Grand Total
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                    {selectedProducts.length > 0 ? formatIndianCurrency(grandTotal) : "0.00"}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Row 6: Submit Button */}
          <div>
            <button
              type="submit"
              className="add-adj-btn-submit"
              disabled={submitting}
            >
              {submitting ? "Submitting..." : "Submit"}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
