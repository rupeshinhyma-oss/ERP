import React, { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { InventoryApi } from "@/lib/api";
import { INITIAL_STOCK_ITEMS } from "@/pages/ProductStockPage";
import "@/styles/stockTransfer.css";

function formatIndianCurrency(amount: number): string {
  return "₹ " + amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface SelectedTransferProduct {
  id: string;
  product_name: string;
  product_code: string;
  category: string;
  hsn_code: string;
  gst_rate: string;
  available_qty: number;
  transfer_qty: number;
  unit_price: number;
  total_price: number;
  uom: string;
}

export const WAREHOUSE_OPTIONS = [
  "Ahmedabad",
  "Mumbai",
  "Indore",
  "Main Warehouse - Bhiwandi",
];

// Product reference prices
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

export function AddTransferOrderPage() {
  const navigate = useNavigate();

  const [fromWarehouse, setFromWarehouse] = useState<string>("");
  const [toWarehouse, setToWarehouse] = useState<string>("");
  const [remark, setRemark] = useState<string>("");

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showSearchDropdown, setShowSearchDropdown] = useState<boolean>(false);
  const [selectedProducts, setSelectedProducts] = useState<SelectedTransferProduct[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSearchDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Compute available stock for items based on selected origin warehouse
  const availableCatalog = useMemo(() => {
    return INITIAL_STOCK_ITEMS.map((item) => {
      let qtyInWarehouse = item.total_qty;
      if (fromWarehouse === "Ahmedabad") qtyInWarehouse = item.ahmedabad;
      else if (fromWarehouse === "Mumbai") qtyInWarehouse = item.mumbai;
      else if (fromWarehouse === "Indore") qtyInWarehouse = item.indore;
      else if (fromWarehouse === "Main Warehouse - Bhiwandi") qtyInWarehouse = item.total_qty;

      return {
        ...item,
        available_in_warehouse: qtyInWarehouse,
        unit_price: PRODUCT_PRICE_MAP[item.id] || 25000,
      };
    });
  }, [fromWarehouse]);

  // Filtered search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !fromWarehouse) return [];
    const q = searchQuery.toLowerCase();
    return availableCatalog.filter(
      (p) =>
        p.product_name_tally.toLowerCase().includes(q) ||
        p.product_code.toLowerCase().includes(q) ||
        (p.category && p.category.toLowerCase().includes(q)) ||
        (p.sub_category && p.sub_category.toLowerCase().includes(q))
    );
  }, [searchQuery, fromWarehouse, availableCatalog]);

  // Handle adding a product from search
  const handleSelectProduct = (product: (typeof availableCatalog)[0]) => {
    setSelectedProducts((prev) => {
      const existingIdx = prev.findIndex((p) => p.id === product.id);
      if (existingIdx >= 0) {
        // Increment quantity if available
        const updated = [...prev];
        const item = updated[existingIdx];
        const newQty = item.transfer_qty + 1;
        updated[existingIdx] = {
          ...item,
          transfer_qty: newQty,
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
          product_code:
            product.product_code !== "-" ? product.product_code : `SKU-${product.sr_no.toString().padStart(3, "0")}`,
          category: product.category || "Machines",
          hsn_code: product.hsn_code || "84224000",
          gst_rate: product.gst_rate || "18%",
          available_qty: product.available_in_warehouse,
          transfer_qty: 1,
          unit_price: unitPrice,
          total_price: unitPrice,
          uom: product.uom || "SET",
        },
      ];
    });

    setSearchQuery("");
    setShowSearchDropdown(false);
    setErrorMessage(null);
  };

  // Handle updating transfer quantity
  const handleUpdateQty = (index: number, newQty: number) => {
    if (newQty < 1 || isNaN(newQty)) newQty = 1;
    setSelectedProducts((prev) => {
      const updated = [...prev];
      const item = updated[index];
      updated[index] = {
        ...item,
        transfer_qty: newQty,
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
        total_price: item.transfer_qty * newPrice,
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

    if (!fromWarehouse) {
      setErrorMessage("Please select From Warehouse.");
      return;
    }

    if (!toWarehouse) {
      setErrorMessage("Please select To Warehouse.");
      return;
    }

    if (fromWarehouse === toWarehouse) {
      setErrorMessage("From Warehouse and To Warehouse cannot be the same.");
      return;
    }

    if (selectedProducts.length === 0) {
      setErrorMessage("Please add at least one product to the transfer order.");
      return;
    }

    // Check if any product exceeds available quantity
    const exceededItem = selectedProducts.find((p) => p.transfer_qty > p.available_qty);
    if (exceededItem) {
      setErrorMessage(
        `Quantity for "${exceededItem.product_name}" exceeds available balance of ${exceededItem.available_qty} in ${fromWarehouse}.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date();
      const dateStr =
        now.toLocaleDateString("en-GB").replace(/\//g, "-") +
        " " +
        now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

      const payload = {
        transfer_date: dateStr,
        from_warehouse: fromWarehouse,
        to_warehouse: toWarehouse,
        total_amount: grandTotal,
        added_by: "Akshata Wadekar",
        status: "Received",
        remarks: remark || undefined,
        items: selectedProducts.map((p) => ({
          product_name: p.product_name,
          product_code: p.product_code || undefined,
          category: p.category || "Machines",
          quantity: p.transfer_qty,
          uom: p.uom || "SET",
          rate: p.unit_price,
          amount: p.total_price,
        })),
      };

      try {
        await InventoryApi.createStockTransfer(payload);
      } catch (err) {
        console.warn("API createStockTransfer fallback to local persistence:", err);
      }

      // Save locally to localStorage so StockTransferPage can read it immediately
      const savedListStr = localStorage.getItem("local_stock_transfers");
      const currentSaved = savedListStr ? JSON.parse(savedListStr) : [];
      const nextSr = 53 + currentSaved.length;
      const newRecord = {
        id: `trf-${Date.now()}`,
        sr_no: nextSr,
        transfer_no: `TRF-2026-${String(nextSr).padStart(3, "0")}`,
        transfer_date: dateStr,
        from_warehouse: fromWarehouse,
        to_warehouse: toWarehouse,
        total_amount: grandTotal,
        added_by: "Akshata Wadekar",
        status: "Received",
        remarks: remark,
        items: selectedProducts.map((p) => ({
          product_name: p.product_name,
          product_code: p.product_code,
          category: p.category,
          quantity: p.transfer_qty,
          uom: p.uom,
          rate: p.unit_price,
          amount: p.total_price,
        })),
      };
      localStorage.setItem("local_stock_transfers", JSON.stringify([newRecord, ...currentSaved]));

      // Navigate back to stock transfer list
      navigate("/transfer/list");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to create stock transfer order.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell activeKey="stock-transfer">
      <div className="page-add-transfer">
        {/* Header: Title and Back Button */}
        <div className="add-transfer-header">
          <h1 className="add-transfer-title">Add Transfer Order</h1>
          <button
            type="button"
            className="add-transfer-btn-back"
            onClick={() => navigate("/transfer/list")}
          >
            ← BACK
          </button>
        </div>

        {/* Error notification banner */}
        {errorMessage && (
          <div className="add-transfer-error-banner" role="alert">
            <span>⚠️ {errorMessage}</span>
          </div>
        )}

        {/* Form Container Card */}
        <form onSubmit={handleSubmit} className="add-transfer-form-card">
          {/* Row 1: From Warehouse * and To Warehouse * */}
          <div className="add-transfer-grid-2">
            <div className="add-transfer-field">
              <label htmlFor="from-warehouse">
                From Warehouse <span className="req">*</span>
              </label>
              <select
                id="from-warehouse"
                className="add-transfer-select"
                value={fromWarehouse}
                onChange={(e) => {
                  setFromWarehouse(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                required
              >
                <option value="">Select</option>
                {WAREHOUSE_OPTIONS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>

            <div className="add-transfer-field">
              <label htmlFor="to-warehouse">
                To Warehouse <span className="req">*</span>
              </label>
              <select
                id="to-warehouse"
                className="add-transfer-select"
                value={toWarehouse}
                onChange={(e) => {
                  setToWarehouse(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                required
              >
                <option value="">Select</option>
                {WAREHOUSE_OPTIONS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Remark */}
          <div className="add-transfer-field add-transfer-field-full">
            <label htmlFor="transfer-remark">Remark</label>
            <textarea
              id="transfer-remark"
              className="add-transfer-textarea"
              placeholder=""
              rows={3}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          </div>

          {/* Row 3: PRODUCT SEARCH Fieldset */}
          <fieldset className="add-transfer-search-fieldset">
            <legend className="add-transfer-search-legend">PRODUCT SEARCH</legend>
            <div className="add-transfer-search-group" ref={searchContainerRef}>
              {/* Blue Barcode Addon Button */}
              <button
                type="button"
                className="add-transfer-barcode-btn"
                title="Barcode Search"
                onClick={() => {
                  if (!fromWarehouse) {
                    setErrorMessage("Please select From Warehouse first.");
                  }
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14M21 5v14M5 5v14M13 5v14M17 5v14" />
                </svg>
              </button>

              {/* Search Text Input */}
              <input
                id="product-search-input"
                type="text"
                className="add-transfer-search-input"
                placeholder="Enter Product Name / Model No"
                value={searchQuery}
                disabled={!fromWarehouse}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSearchDropdown(Boolean(e.target.value.trim()));
                }}
                onFocus={() => {
                  if (searchQuery.trim() && fromWarehouse) setShowSearchDropdown(true);
                }}
              />

              {/* Red Plus Search/Add Button */}
              <button
                type="button"
                className="add-transfer-add-btn"
                title="Add Product"
                onClick={() => {
                  if (!fromWarehouse) {
                    setErrorMessage("Please select From Warehouse first.");
                    return;
                  }
                  if (searchQuery.trim()) {
                    setShowSearchDropdown(true);
                  }
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              </button>

              {/* Autocomplete Dropdown List */}
              {showSearchDropdown && fromWarehouse && (
                <div className="add-transfer-autocomplete-dropdown">
                  {searchResults.length > 0 ? (
                    searchResults.map((p) => (
                      <div
                        key={p.id}
                        className="add-transfer-autocomplete-item"
                        onClick={() => handleSelectProduct(p)}
                      >
                        <div>
                          <strong className="autocomplete-item-name">
                            {p.product_name_tally}
                          </strong>
                          <span className="autocomplete-item-sub">
                            {p.category || "Machines"} • SKU: {p.product_code !== "-" ? p.product_code : `SKU-${p.sr_no}`}
                          </span>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span
                            className={`autocomplete-item-avail ${
                              p.available_in_warehouse > 0 ? "avail-positive" : "avail-zero"
                            }`}
                          >
                            Avail: {p.available_in_warehouse} {p.uom || "SET"}
                          </span>
                          <span className="autocomplete-item-price">
                            {formatIndianCurrency(p.unit_price)}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="autocomplete-empty-state">
                      No matching products found in {fromWarehouse}.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Note if no From Warehouse selected */}
            {!fromWarehouse && (
              <p className="add-transfer-notice-helper">Please select From Warehouse to search products.</p>
            )}
          </fieldset>

          {/* Row 4: Notice: Only The Main Balance Quantity Is Transferable */}
          <div className="add-transfer-notice-text">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ display: "inline-block", verticalAlign: "-2px", marginRight: "6px" }}
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>Only The Main Balance Quantity Is Transferable.</span>
          </div>

          {/* Row 5: Table of Products */}
          <div className="add-transfer-table-wrap">
            <table className="add-transfer-table">
              <thead>
                <tr>
                  <th style={{ width: "42%" }}>Product Name</th>
                  <th style={{ width: "12%", textAlign: "center" }}>Qty</th>
                  <th style={{ width: "12%", textAlign: "center" }}>Qty</th>
                  <th style={{ width: "16%", textAlign: "right" }}>Unit Price</th>
                  <th style={{ width: "14%", textAlign: "right" }}>Total Price</th>
                  <th style={{ width: "4%", textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {selectedProducts.map((p, idx) => (
                  <tr key={p.id}>
                    <td>
                      <div className="table-product-title">{p.product_name}</div>
                      <div className="table-product-meta">
                        {p.category} • HSN: {p.hsn_code} • GST: {p.gst_rate}
                      </div>
                    </td>
                    <td
                      style={{
                        textAlign: "center",
                        fontWeight: 600,
                        color: p.available_qty > 0 ? "#15803d" : "#ef4444",
                      }}
                    >
                      {p.available_qty} {p.uom}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="number"
                        min="1"
                        max={p.available_qty > 0 ? p.available_qty : undefined}
                        className="table-qty-input"
                        value={p.transfer_qty}
                        onChange={(e) => handleUpdateQty(idx, parseInt(e.target.value, 10) || 1)}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        type="number"
                        min="0"
                        step="100"
                        className="table-price-input"
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
                        className="table-action-delete-btn"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="transfer-grand-total-row">
                  <td colSpan={4} className="transfer-grand-total-label">
                    Grand Total
                  </td>
                  <td className="transfer-grand-total-value">
                    {formatIndianCurrency(grandTotal)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Row 6: Submit Button */}
          <div className="add-transfer-actions">
            <button
              type="submit"
              className="add-transfer-btn-submit"
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
