/**
 * Price List Management Module.
 * Control Panel / Masters / Inventory.
 *
 * Implements:
 *  - Independent Price List module in Masters & Inventory navigation.
 *  - Interactive Inclusive vs Exclusive GST toggle adapted from F&B / retail ERP model.
 *  - Inline pricing edits and detailed 2-way real-time GST calculator drawer.
 *  - Supplier quotation accordion sub-tables.
 *  - Top KPI catalog summary metrics.
 *  - Excel export (.xlsx) & bulk spreadsheet import.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Pagination } from "@/components/Pagination";
import { SideDrawer } from "@/components/SideDrawer";
import { Banner, Modal } from "@/components/ui";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  downloadExport,
  API_ORIGIN,
} from "@/lib/api";
import { auth } from "@/lib/auth";
import { useLookup } from "@/lib/lookups";
import type {
  Brand,
  PriceListItem,
  PriceListMetrics,
  ProductCategory,
  ProductSubCategory,
} from "@/types";

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null || isNaN(amount)) return "—";
  return "₹ " + Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function resolveImageUrl(url: string | null | undefined): string {
  if (!url) return "";
  let clean = url.trim();
  if (
    (clean.startsWith('"') && clean.endsWith('"')) ||
    (clean.startsWith("'") && clean.endsWith("'"))
  ) {
    clean = clean.slice(1, -1).trim();
  }
  if (!clean) return "";
  if (
    clean.startsWith("data:") ||
    clean.startsWith("http://") ||
    clean.startsWith("https://")
  ) {
    return encodeURI(clean);
  }
  return encodeURI(`${API_ORIGIN}${clean.startsWith("/") ? "" : "/"}${clean}`);
}

export function PriceListPage() {
  // --- Pricing Mode State (Exclusive vs Inclusive GST) ---
  const [isInclusiveMode, setIsInclusiveMode] = useState<boolean>(false);

  // --- Catalog Data & Pagination ---
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [totalItems, setTotalItems] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);

  // --- KPI Metrics ---
  const [metrics, setMetrics] = useState<PriceListMetrics | null>(null);

  // --- Filters ---
  const [filterOpen, setFilterOpen] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [subCategoryFilter, setSubCategoryFilter] = useState<string>("");
  const [brandFilter, setBrandFilter] = useState<string>("");
  const [pricingStatusFilter, setPricingStatusFilter] = useState<"all" | "priced" | "unpriced">("all");
  const [gstFilter, setGstFilter] = useState<string>("");

  // --- Lookups ---
  const categories = useLookup<ProductCategory>("/masters/product-categories", 250);
  const subCategories = useLookup<ProductSubCategory>("/masters/product-sub-categories", 500);
  const brands = useLookup<Brand>("/masters/brands", 250);

  const scopedSubCategories = useMemo(() => {
    if (!categoryFilter) return subCategories.items;
    return subCategories.items.filter((sc) => sc.category_id === categoryFilter);
  }, [categoryFilter, subCategories.items]);

  // --- Accordion Sub-table Expanded Rows ---
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [addingQuoteProductId, setAddingQuoteProductId] = useState<string | null>(null);
  const [quoteSuppliers, setQuoteSuppliers] = useState<Array<{ id: string; company_name: string }>>([]);
  const [newQuoteSupplierId, setNewQuoteSupplierId] = useState<string>("");
  const [newQuotePrice, setNewQuotePrice] = useState<string>("");
  const [newQuoteMoq, setNewQuoteMoq] = useState<string>("");
  const [newQuoteNotes, setNewQuoteNotes] = useState<string>("");
  const [quoteSubmitting, setQuoteSubmitting] = useState<boolean>(false);

  // --- Inline Row Editing ---
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineStdPrice, setInlineStdPrice] = useState<string>("");
  const [inlineMinPrice, setInlineMinPrice] = useState<string>("");
  const [inlineSaving, setInlineSaving] = useState<boolean>(false);

  // --- Detail / GST Calculator Drawer ---
  const [drawerItem, setDrawerItem] = useState<PriceListItem | null>(null);
  const [drawerStdPrice, setDrawerStdPrice] = useState<string>("");
  const [drawerMinPrice, setDrawerMinPrice] = useState<string>("");
  const [drawerStdCost, setDrawerStdCost] = useState<string>("");
  const [drawerEditMode, setDrawerEditMode] = useState<"exclusive" | "inclusive">("exclusive");
  const [drawerSaving, setDrawerSaving] = useState<boolean>(false);

  // --- Bulk Import Modal ---
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importUploading, setImportUploading] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<{
    total_rows: number;
    successful_updates: number;
    failed_rows: number;
    errors: Array<{ row_number: number; product_code?: string; error: string }>;
  } | null>(null);

  // --- Export Menu ---
  const [exportMenuOpen, setExportMenuOpen] = useState<boolean>(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Click outside listener for export dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch KPI metrics
  const fetchMetrics = useCallback(async () => {
    try {
      const res = await apiGet<PriceListMetrics>("/masters/price-list/metrics");
      if (res.data) setMetrics(res.data);
    } catch {
      // Non-blocking
    }
  }, []);

  // Fetch price list items
  const fetchPrices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("page_size", String(pageSize));
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (categoryFilter) params.set("category_id", categoryFilter);
      if (subCategoryFilter) params.set("sub_category_id", subCategoryFilter);
      if (brandFilter) params.set("brand_id", brandFilter);
      if (pricingStatusFilter === "priced") params.set("has_price", "true");
      if (pricingStatusFilter === "unpriced") params.set("has_price", "false");
      if (gstFilter) params.set("gst_percent", gstFilter);

      const res = await apiGet<PriceListItem[]>(`/masters/price-list?${params.toString()}`);
      setItems(Array.isArray(res.data) ? res.data : []);
      if (res.meta?.pagination) {
        setTotalItems(res.meta.pagination.total_items ?? res.meta.pagination.total_records ?? 0);
        setTotalPages(res.meta.pagination.total_pages ?? 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load price list");
    } finally {
      setLoading(false);
    }
  }, [
    page,
    pageSize,
    debouncedSearch,
    categoryFilter,
    subCategoryFilter,
    brandFilter,
    pricingStatusFilter,
    gstFilter,
  ]);

  useEffect(() => {
    fetchPrices();
  }, [fetchPrices]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // Load suppliers lookup for quotation assignment
  const loadSuppliersForQuotes = useCallback(async () => {
    if (quoteSuppliers.length > 0) return;
    try {
      const res = await apiGet<Array<{ id: string; company_name: string }>>("/suppliers?page_size=200");
      if (Array.isArray(res.data)) {
        setQuoteSuppliers(res.data);
      }
    } catch {
      // Non-blocking
    }
  }, [quoteSuppliers.length]);

  // Toggle row expansion
  const toggleRow = (productId: string) => {
    setExpandedRows((prev) => ({ ...prev, [productId]: !prev[productId] }));
  };

  // Start inline editing
  const startInlineEdit = (item: PriceListItem) => {
    setInlineEditId(item.product_id);
    if (isInclusiveMode) {
      setInlineStdPrice(item.standard_price_inc_gst != null ? String(item.standard_price_inc_gst) : "");
      setInlineMinPrice(item.minimum_price_inc_gst != null ? String(item.minimum_price_inc_gst) : "");
    } else {
      setInlineStdPrice(item.standard_price != null ? String(item.standard_price) : "");
      setInlineMinPrice(item.minimum_price != null ? String(item.minimum_price) : "");
    }
  };

  const cancelInlineEdit = () => {
    setInlineEditId(null);
    setInlineStdPrice("");
    setInlineMinPrice("");
  };

  // Save inline edit
  const saveInlineEdit = async (item: PriceListItem) => {
    setInlineSaving(true);
    try {
      const stdNum = inlineStdPrice ? parseFloat(inlineStdPrice) : null;
      const minNum = inlineMinPrice ? parseFloat(inlineMinPrice) : null;

      await apiPatch(`/masters/price-list/${item.product_id}`, {
        standard_price: stdNum,
        minimum_price: minNum,
        is_inclusive: isInclusiveMode,
      });

      setSuccess(`Price updated for ${item.product_name_tally || item.product_name}`);
      setTimeout(() => setSuccess(null), 3500);
      setInlineEditId(null);
      fetchPrices();
      fetchMetrics();
    } catch (err) {
      alert("Failed to save price: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setInlineSaving(false);
    }
  };

  // Open Drawer and initialize calculator inputs
  const openDrawer = (item: PriceListItem) => {
    setDrawerItem(item);
    setDrawerEditMode(isInclusiveMode ? "inclusive" : "exclusive");
    if (isInclusiveMode) {
      setDrawerStdPrice(item.standard_price_inc_gst != null ? String(item.standard_price_inc_gst) : "");
      setDrawerMinPrice(item.minimum_price_inc_gst != null ? String(item.minimum_price_inc_gst) : "");
      setDrawerStdCost(item.standard_cost != null ? String(item.standard_cost) : "");
    } else {
      setDrawerStdPrice(item.standard_price != null ? String(item.standard_price) : "");
      setDrawerMinPrice(item.minimum_price != null ? String(item.minimum_price) : "");
      setDrawerStdCost(item.standard_cost != null ? String(item.standard_cost) : "");
    }
  };

  // Save Drawer edits
  const saveDrawerPrice = async () => {
    if (!drawerItem) return;
    setDrawerSaving(true);
    try {
      const stdNum = drawerStdPrice ? parseFloat(drawerStdPrice) : null;
      const minNum = drawerMinPrice ? parseFloat(drawerMinPrice) : null;
      const costNum = drawerStdCost ? parseFloat(drawerStdCost) : null;

      await apiPatch(`/masters/price-list/${drawerItem.product_id}`, {
        standard_price: stdNum,
        minimum_price: minNum,
        standard_cost: costNum,
        is_inclusive: drawerEditMode === "inclusive",
      });

      setSuccess(`Commercial pricing saved for ${drawerItem.product_name_tally}`);
      setTimeout(() => setSuccess(null), 3500);
      setDrawerItem(null);
      fetchPrices();
      fetchMetrics();
    } catch (err) {
      alert("Failed to save pricing: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setDrawerSaving(false);
    }
  };

  // Add Supplier Quote in Accordion
  const handleAddQuote = async (productId: string) => {
    if (!newQuoteSupplierId) {
      alert("Please select a supplier");
      return;
    }
    const priceVal = parseFloat(newQuotePrice);
    if (isNaN(priceVal) || priceVal < 0) {
      alert("Please enter a valid unit quotation price");
      return;
    }

    setQuoteSubmitting(true);
    try {
      await apiPost(`/masters/price-list/${productId}/suppliers`, {
        supplier_id: newQuoteSupplierId,
        unit_price: priceVal,
        currency: "INR",
        moq: newQuoteMoq ? parseFloat(newQuoteMoq) : null,
        notes: newQuoteNotes.trim() || null,
      });

      setSuccess("Supplier quotation added successfully");
      setTimeout(() => setSuccess(null), 3000);
      setAddingQuoteProductId(null);
      setNewQuoteSupplierId("");
      setNewQuotePrice("");
      setNewQuoteMoq("");
      setNewQuoteNotes("");
      fetchPrices();
    } catch (err) {
      alert("Failed to add supplier quote: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setQuoteSubmitting(false);
    }
  };

  // Delete Supplier Quote
  const handleDeleteQuote = async (linkId: string, supplierName: string) => {
    if (!confirm(`Remove quote from ${supplierName}?`)) return;
    try {
      await apiDelete(`/masters/price-list/suppliers/${linkId}`);
      setSuccess(`Removed quotation from ${supplierName}`);
      setTimeout(() => setSuccess(null), 3000);
      fetchPrices();
    } catch (err) {
      alert("Failed to remove quotation: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Export handlers
  const handleExport = async (format: "xlsx" | "csv") => {
    try {
      await downloadExport("/masters/price-list", format, "inhyma_price_list");
      setSuccess(`Export downloaded successfully (${format.toUpperCase()})`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      alert("Export failed: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const token = auth.getAccessToken();
      const res = await fetch(`${API_ORIGIN}/api/v1/masters/price-list/sample-template`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Template download failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "price_import_template.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Failed to download template: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleUploadImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile) return;
    setImportUploading(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);

      const res = await apiPost<{
        total_rows: number;
        successful_updates: number;
        failed_rows: number;
        errors: Array<{ row_number: number; product_code?: string; error: string }>;
      }>("/masters/price-list/import", formData);

      if (res.data) {
        setImportResult(res.data);
        if (res.data.successful_updates > 0) {
          fetchPrices();
          fetchMetrics();
        }
      }
    } catch (err) {
      alert("Import failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setImportUploading(false);
    }
  };

  return (
    <AppShell activeKey="masters-price-list">
      <div style={{ padding: "20px 28px 40px", maxWidth: "1600px", margin: "0 auto" }}>
        {/* Breadcrumb Navigation */}
        <Breadcrumb trail={["Masters", "Price List Management"]} />

        {/* Top Header Row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "12px",
            marginBottom: "16px",
            flexWrap: "wrap",
            gap: "16px",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "22px",
                fontWeight: 700,
                color: "#0f172a",
                margin: 0,
                letterSpacing: "-0.01em",
              }}
            >
              Price List Management
            </h1>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "4px 0 0" }}>
              Control Panel &amp; Catalog Pricing with dual Inclusive/Exclusive GST calculation
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            {/* PROMINENT INCLUSIVE / EXCLUSIVE GST TOGGLE (F&B ERP MODEL) */}
            <div
              style={{
                display: "inline-flex",
                background: "#f1f5f9",
                padding: "3px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
              }}
            >
              <button
                type="button"
                onClick={() => setIsInclusiveMode(false)}
                style={{
                  padding: "6px 14px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  background: !isInclusiveMode ? "#ffffff" : "transparent",
                  color: !isInclusiveMode ? "#0061f2" : "#475569",
                  boxShadow: !isInclusiveMode ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                }}
              >
                Exclusive of GST (Base Rate)
              </button>
              <button
                type="button"
                onClick={() => setIsInclusiveMode(true)}
                style={{
                  padding: "6px 14px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  background: isInclusiveMode ? "#0061f2" : "transparent",
                  color: isInclusiveMode ? "#ffffff" : "#475569",
                  boxShadow: isInclusiveMode ? "0 1px 3px rgba(0,97,242,0.3)" : "none",
                }}
              >
                Inclusive of GST (MRP / Final)
              </button>
            </div>

            {/* Filter Toggle Button */}
            <button
              type="button"
              onClick={() => setFilterOpen((prev) => !prev)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "6px",
                border: filterOpen ? "1px solid #0061f2" : "1px solid #cbd5e1",
                background: filterOpen ? "#eff6ff" : "#ffffff",
                color: filterOpen ? "#0061f2" : "#334155",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <span>🔍 Filter</span>
              {(categoryFilter || subCategoryFilter || brandFilter || pricingStatusFilter !== "all" || gstFilter) && (
                <span
                  style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    background: "#0061f2",
                  }}
                />
              )}
            </button>

            {/* Import Button */}
            <button
              type="button"
              onClick={() => {
                setImportModalOpen(true);
                setImportResult(null);
                setImportFile(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#334155",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <span>📥 Import</span>
            </button>

            {/* Export Dropdown */}
            <div style={{ position: "relative" }} ref={exportMenuRef}>
              <button
                type="button"
                onClick={() => setExportMenuOpen((prev) => !prev)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "6px",
                  border: "1px solid #0061f2",
                  background: "#0061f2",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <span>📊 Export ▾</span>
              </button>
              {exportMenuOpen && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "100%",
                    marginTop: "6px",
                    background: "#ffffff",
                    borderRadius: "8px",
                    boxShadow: "0 8px 24px rgba(15,23,42,0.15)",
                    border: "1px solid #e2e8f0",
                    width: "180px",
                    zIndex: 50,
                    overflow: "hidden",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setExportMenuOpen(false);
                      handleExport("xlsx");
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 14px",
                      fontSize: "13px",
                      color: "#1e293b",
                      fontWeight: 600,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    <span>📊</span> Export to Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExportMenuOpen(false);
                      handleExport("csv");
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 14px",
                      fontSize: "13px",
                      color: "#1e293b",
                      fontWeight: 600,
                      background: "none",
                      border: "none",
                      borderTop: "1px solid #f1f5f9",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    <span>📄</span> Export to CSV (.csv)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <Banner error={error} success={success} />

        {/* Top 4 KPI Metrics Cards */}
        {metrics && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "16px",
              marginBottom: "18px",
            }}
          >
            <div
              style={{
                background: "#ffffff",
                borderRadius: "10px",
                padding: "16px 20px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
                Total Catalog Products
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#0f172a", marginTop: "4px" }}>
                {metrics.total_products.toLocaleString()}
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                Items registered in Inhyma ERP
              </div>
            </div>

            <div
              style={{
                background: "#ffffff",
                borderRadius: "10px",
                padding: "16px 20px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#10b981", textTransform: "uppercase" }}>
                Priced Products
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#0f172a", marginTop: "4px" }}>
                {metrics.priced_products.toLocaleString()}
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#10b981", marginLeft: "8px" }}>
                  (
                  {metrics.total_products > 0
                    ? Math.round((metrics.priced_products / metrics.total_products) * 100)
                    : 0}
                  %)
                </span>
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                Active selling rates assigned
              </div>
            </div>

            <div
              style={{
                background: "#ffffff",
                borderRadius: "10px",
                padding: "16px 20px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#f59e0b", textTransform: "uppercase" }}>
                Unpriced Products
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#0f172a", marginTop: "4px" }}>
                {metrics.unpriced_products.toLocaleString()}
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                Pending commercial pricing setup
              </div>
            </div>

            <div
              style={{
                background: "#ffffff",
                borderRadius: "10px",
                padding: "16px 20px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#0061f2", textTransform: "uppercase" }}>
                Average Selling Price ({isInclusiveMode ? "Incl. GST" : "Excl. GST"})
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#0f172a", marginTop: "4px" }}>
                {formatCurrency(
                  isInclusiveMode
                    ? metrics.avg_standard_price_inc_gst
                    : metrics.avg_standard_price_ex_gst
                )}
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                Avg Min Floor:{" "}
                {formatCurrency(
                  isInclusiveMode ? metrics.avg_min_price_inc_gst : metrics.avg_min_price_ex_gst
                )}
              </div>
            </div>
          </div>
        )}

        {/* Collapsible Filter Panel */}
        {filterOpen && (
          <div
            style={{
              background: "#ffffff",
              borderRadius: "10px",
              padding: "16px 20px",
              border: "1px solid #e2e8f0",
              marginBottom: "18px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "14px",
              alignItems: "flex-end",
            }}
          >
            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>
                Category
              </label>
              <select
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setSubCategoryFilter("");
                  setPage(1);
                }}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "13px",
                  background: "#fff",
                }}
              >
                <option value="">All Categories</option>
                {categories.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>
                Sub Category
              </label>
              <select
                value={subCategoryFilter}
                onChange={(e) => {
                  setSubCategoryFilter(e.target.value);
                  setPage(1);
                }}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "13px",
                  background: "#fff",
                }}
              >
                <option value="">All Sub Categories</option>
                {scopedSubCategories.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>
                Brand
              </label>
              <select
                value={brandFilter}
                onChange={(e) => {
                  setBrandFilter(e.target.value);
                  setPage(1);
                }}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "13px",
                  background: "#fff",
                }}
              >
                <option value="">All Brands</option>
                {brands.items.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>
                Price Status
              </label>
              <select
                value={pricingStatusFilter}
                onChange={(e) => {
                  setPricingStatusFilter(e.target.value as any);
                  setPage(1);
                }}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "13px",
                  background: "#fff",
                }}
              >
                <option value="all">All Items</option>
                <option value="priced">Priced Only</option>
                <option value="unpriced">Unpriced Only</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>
                GST Rate
              </label>
              <select
                value={gstFilter}
                onChange={(e) => {
                  setGstFilter(e.target.value);
                  setPage(1);
                }}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "13px",
                  background: "#fff",
                }}
              >
                <option value="">All GST Rates</option>
                <option value="0">0% GST</option>
                <option value="5">5% GST</option>
                <option value="12">12% GST</option>
                <option value="18">18% GST</option>
                <option value="28">28% GST</option>
              </select>
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter("");
                  setSubCategoryFilter("");
                  setBrandFilter("");
                  setPricingStatusFilter("all");
                  setGstFilter("");
                  setSearchTerm("");
                  setPage(1);
                }}
                style={{
                  padding: "8px 14px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#f8fafc",
                  color: "#475569",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Reset
              </button>
            </div>
          </div>
        )}

        {/* Search & Mode Info Bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div style={{ position: "relative", minWidth: "300px", maxWidth: "450px", flex: 1 }}>
            <span
              style={{
                position: "absolute",
                left: "12px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "#94a3b8",
                fontSize: "14px",
              }}
            >
              🔍
            </span>
            <input
              type="text"
              placeholder="Search product code, name, tally, barcode, brand..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px 8px 36px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                fontSize: "13px",
                background: "#ffffff",
              }}
            />
          </div>

          <div style={{ fontSize: "12.5px", color: "#64748b", display: "flex", alignItems: "center", gap: "10px" }}>
            <span>
              Showing{" "}
              <strong style={{ color: "#0f172a" }}>
                {isInclusiveMode ? "Customer Final Price (Incl. GST)" : "Commercial Base Price (Excl. GST)"}
              </strong>
            </span>
            <span style={{ color: "#cbd5e1" }}>|</span>
            <span>
              Total: <strong style={{ color: "#0f172a" }}>{totalItems}</strong> products
            </span>
          </div>
        </div>

        {/* Pricing Data Table */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: "10px",
            border: "1px solid #e2e8f0",
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                  <th style={{ padding: "12px 14px", width: "40px", textAlign: "center" }}>#</th>
                  <th style={{ padding: "12px 14px" }}>Product Name &amp; Code</th>
                  <th style={{ padding: "12px 14px" }}>Category &amp; Brand</th>
                  <th style={{ padding: "12px 14px", textAlign: "center" }}>Stock</th>
                  <th style={{ padding: "12px 14px", textAlign: "center" }}>HSN &amp; GST</th>
                  <th style={{ padding: "12px 14px", textAlign: "right" }}>Landing Cost</th>
                  <th
                    style={{
                      padding: "12px 14px",
                      textAlign: "right",
                      background: isInclusiveMode ? "#f0fdf4" : "#eff6ff",
                      color: isInclusiveMode ? "#166534" : "#1e40af",
                      fontWeight: 700,
                    }}
                  >
                    {isInclusiveMode ? "Selling Price (Incl. GST)" : "Selling Price (Excl. GST)"}
                  </th>
                  <th style={{ padding: "12px 14px", textAlign: "right" }}>
                    {isInclusiveMode ? "Min Price (Incl.)" : "Min Price (Excl.)"}
                  </th>
                  <th style={{ padding: "12px 14px", textAlign: "center" }}>Margin</th>
                  <th style={{ padding: "12px 14px", textAlign: "center" }}>Quotes</th>
                  <th style={{ padding: "12px 14px", textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={11} style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                      Loading commercial price list...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                      No products found matching your search and filter criteria.
                    </td>
                  </tr>
                ) : (
                  items.map((item, index) => {
                    const isExpanded = !!expandedRows[item.product_id];
                    const isEditing = inlineEditId === item.product_id;

                    const displayStdPrice = isInclusiveMode
                      ? item.standard_price_inc_gst
                      : item.standard_price;
                    const displayMinPrice = isInclusiveMode
                      ? item.minimum_price_inc_gst
                      : item.minimum_price;

                    return (
                      <React.Fragment key={item.product_id}>
                        <tr
                          style={{
                            borderBottom: "1px solid #f1f5f9",
                            background: isExpanded ? "#f8fafc" : "#ffffff",
                            transition: "background 0.15s ease",
                          }}
                        >
                          {/* Row Index */}
                          <td style={{ padding: "12px 14px", textAlign: "center", color: "#94a3b8", fontSize: "12px" }}>
                            {(page - 1) * pageSize + index + 1}
                          </td>

                          {/* Product Name & Code */}
                          <td style={{ padding: "12px 14px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                              {item.image_url ? (
                                <img
                                  src={resolveImageUrl(item.image_url)}
                                  alt=""
                                  style={{
                                    width: "36px",
                                    height: "36px",
                                    objectFit: "cover",
                                    borderRadius: "6px",
                                    border: "1px solid #e2e8f0",
                                  }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: "36px",
                                    height: "36px",
                                    borderRadius: "6px",
                                    background: "#f1f5f9",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: "#94a3b8",
                                    fontSize: "14px",
                                  }}
                                >
                                  📦
                                </div>
                              )}
                              <div>
                                <div
                                  onClick={() => openDrawer(item)}
                                  style={{
                                    fontWeight: 600,
                                    color: "#0061f2",
                                    cursor: "pointer",
                                    lineHeight: "1.3",
                                  }}
                                >
                                  {item.product_name_tally || item.product_name}
                                </div>
                                <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
                                  Code: <span style={{ fontFamily: "monospace" }}>{item.product_code || "—"}</span>
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Category & Brand */}
                          <td style={{ padding: "12px 14px" }}>
                            <div style={{ fontSize: "12.5px", color: "#1e293b", fontWeight: 500 }}>
                              {item.category_name || "—"}
                            </div>
                            <div style={{ fontSize: "11.5px", color: "#64748b" }}>
                              {item.brand_name || item.sub_category_name || "—"}
                            </div>
                          </td>

                          {/* Stock & UOM */}
                          <td style={{ padding: "12px 14px", textAlign: "center" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 8px",
                                borderRadius: "12px",
                                fontSize: "12px",
                                fontWeight: 600,
                                background: item.current_stock > 0 ? "#ecfdf5" : "#fef2f2",
                                color: item.current_stock > 0 ? "#059669" : "#dc2626",
                              }}
                            >
                              {item.current_stock} {item.uom_code || ""}
                            </span>
                          </td>

                          {/* HSN & GST */}
                          <td style={{ padding: "12px 14px", textAlign: "center" }}>
                            <div style={{ fontSize: "12px", fontFamily: "monospace", color: "#334155" }}>
                              {item.hsn_number || "—"}
                            </div>
                            <span
                              style={{
                                display: "inline-block",
                                marginTop: "2px",
                                padding: "1px 6px",
                                borderRadius: "4px",
                                fontSize: "11px",
                                fontWeight: 700,
                                background: "#f1f5f9",
                                color: "#475569",
                              }}
                            >
                              {item.gst_percent}% GST
                            </span>
                          </td>

                          {/* Standard Cost (Landing Cost) */}
                          <td style={{ padding: "12px 14px", textAlign: "right", color: "#475569" }}>
                            {formatCurrency(item.standard_cost)}
                          </td>

                          {/* Selling Price */}
                          <td
                            style={{
                              padding: "12px 14px",
                              textAlign: "right",
                              background: isInclusiveMode ? "#f0fdf4" : "#eff6ff",
                            }}
                          >
                            {isEditing ? (
                              <input
                                type="number"
                                step="0.01"
                                value={inlineStdPrice}
                                onChange={(e) => setInlineStdPrice(e.target.value)}
                                style={{
                                  width: "90px",
                                  padding: "4px 6px",
                                  borderRadius: "4px",
                                  border: "1px solid #0061f2",
                                  fontSize: "13px",
                                  textAlign: "right",
                                }}
                                autoFocus
                              />
                            ) : (
                              <div>
                                <div
                                  style={{
                                    fontWeight: 700,
                                    fontSize: "14px",
                                    color: displayStdPrice ? (isInclusiveMode ? "#166534" : "#1e40af") : "#94a3b8",
                                  }}
                                >
                                  {formatCurrency(displayStdPrice)}
                                </div>
                                {displayStdPrice != null && (
                                  <div style={{ fontSize: "10.5px", color: "#64748b", marginTop: "2px" }}>
                                    {isInclusiveMode ? (
                                      <span>Base: {formatCurrency(item.standard_price)}</span>
                                    ) : (
                                      <span>Incl: {formatCurrency(item.standard_price_inc_gst)}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Minimum Price */}
                          <td style={{ padding: "12px 14px", textAlign: "right" }}>
                            {isEditing ? (
                              <input
                                type="number"
                                step="0.01"
                                value={inlineMinPrice}
                                onChange={(e) => setInlineMinPrice(e.target.value)}
                                style={{
                                  width: "90px",
                                  padding: "4px 6px",
                                  borderRadius: "4px",
                                  border: "1px solid #0061f2",
                                  fontSize: "13px",
                                  textAlign: "right",
                                }}
                              />
                            ) : (
                              <div style={{ color: displayMinPrice ? "#0f172a" : "#94a3b8", fontWeight: 500 }}>
                                {formatCurrency(displayMinPrice)}
                              </div>
                            )}
                          </td>

                          {/* Margin */}
                          <td style={{ padding: "12px 14px", textAlign: "center" }}>
                            {item.margin_percent != null ? (
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "2px 7px",
                                  borderRadius: "12px",
                                  fontSize: "11.5px",
                                  fontWeight: 600,
                                  background: item.margin_percent >= 15 ? "#ecfdf5" : "#fffbeb",
                                  color: item.margin_percent >= 15 ? "#047857" : "#b45309",
                                }}
                              >
                                {item.margin_percent.toFixed(1)}%
                              </span>
                            ) : (
                              <span style={{ color: "#cbd5e1" }}>—</span>
                            )}
                          </td>

                          {/* Supplier Quotes Button */}
                          <td style={{ padding: "12px 14px", textAlign: "center" }}>
                            <button
                              type="button"
                              onClick={() => toggleRow(item.product_id)}
                              style={{
                                padding: "4px 8px",
                                borderRadius: "6px",
                                border: "1px solid #e2e8f0",
                                background: isExpanded ? "#eff6ff" : "#ffffff",
                                color: isExpanded ? "#0061f2" : "#475569",
                                fontSize: "12px",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              {item.supplier_count} {item.supplier_count === 1 ? "Quote" : "Quotes"}{" "}
                              {isExpanded ? "▲" : "▼"}
                            </button>
                          </td>

                          {/* Actions */}
                          <td style={{ padding: "12px 14px", textAlign: "center" }}>
                            <div style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => saveInlineEdit(item)}
                                    disabled={inlineSaving}
                                    style={{
                                      padding: "4px 8px",
                                      borderRadius: "4px",
                                      background: "#10b981",
                                      color: "#fff",
                                      border: "none",
                                      cursor: "pointer",
                                      fontSize: "12px",
                                      fontWeight: 600,
                                    }}
                                    title="Save"
                                  >
                                    ✓
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelInlineEdit}
                                    disabled={inlineSaving}
                                    style={{
                                      padding: "4px 8px",
                                      borderRadius: "4px",
                                      background: "#e2e8f0",
                                      color: "#475569",
                                      border: "none",
                                      cursor: "pointer",
                                      fontSize: "12px",
                                    }}
                                    title="Cancel"
                                  >
                                    ✕
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => startInlineEdit(item)}
                                    style={{
                                      padding: "4px 8px",
                                      borderRadius: "4px",
                                      background: "#f1f5f9",
                                      color: "#334155",
                                      border: "none",
                                      cursor: "pointer",
                                      fontSize: "12px",
                                    }}
                                    title="Quick Edit Prices"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openDrawer(item)}
                                    style={{
                                      padding: "4px 8px",
                                      borderRadius: "4px",
                                      background: "#eff6ff",
                                      color: "#0061f2",
                                      border: "none",
                                      cursor: "pointer",
                                      fontSize: "12px",
                                      fontWeight: 600,
                                    }}
                                    title="Open Full Calculator & Details"
                                  >
                                    Calculator
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Expandable Accordion Sub-table for Supplier Quotes */}
                        {isExpanded && (
                          <tr style={{ background: "#f8fafc" }}>
                            <td colSpan={11} style={{ padding: "14px 20px 18px 48px" }}>
                              <div
                                style={{
                                  background: "#ffffff",
                                  border: "1px solid #e2e8f0",
                                  borderRadius: "8px",
                                  padding: "16px",
                                  boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    marginBottom: "12px",
                                  }}
                                >
                                  <div style={{ fontWeight: 700, fontSize: "13.5px", color: "#0f172a" }}>
                                    Supplier Quotation Matrix ({item.suppliers.length} sources)
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      loadSuppliersForQuotes();
                                      setAddingQuoteProductId(item.product_id);
                                    }}
                                    style={{
                                      padding: "5px 12px",
                                      borderRadius: "6px",
                                      border: "1px solid #0061f2",
                                      background: "#eff6ff",
                                      color: "#0061f2",
                                      fontSize: "12px",
                                      fontWeight: 600,
                                      cursor: "pointer",
                                    }}
                                  >
                                    + Add Supplier Quote
                                  </button>
                                </div>

                                {item.suppliers.length === 0 ? (
                                  <div style={{ padding: "16px", textAlign: "center", color: "#64748b", fontSize: "12.5px" }}>
                                    No purchase quotes registered for this product yet. Click "+ Add Supplier Quote" to link one.
                                  </div>
                                ) : (
                                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                                    <thead>
                                      <tr style={{ background: "#f1f5f9", color: "#475569" }}>
                                        <th style={{ padding: "8px 10px" }}>Supplier Company</th>
                                        <th style={{ padding: "8px 10px" }}>Contact</th>
                                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Quoted Purchase Price</th>
                                        <th style={{ padding: "8px 10px", textAlign: "center" }}>MOQ</th>
                                        <th style={{ padding: "8px 10px" }}>Notes / Remarks</th>
                                        <th style={{ padding: "8px 10px", textAlign: "center" }}>Actions</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {item.suppliers.map((quote) => (
                                        <tr key={quote.link_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                          <td style={{ padding: "8px 10px", fontWeight: 600, color: "#1e293b" }}>
                                            {quote.supplier_name}
                                          </td>
                                          <td style={{ padding: "8px 10px", color: "#64748b" }}>
                                            {quote.calling_number || "—"}
                                          </td>
                                          <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                                            {quote.currency} {quote.unit_price != null ? quote.unit_price.toFixed(2) : "—"}
                                          </td>
                                          <td style={{ padding: "8px 10px", textAlign: "center", color: "#475569" }}>
                                            {quote.moq != null ? quote.moq : "—"}
                                          </td>
                                          <td style={{ padding: "8px 10px", color: "#64748b", fontStyle: "italic" }}>
                                            {quote.notes || "—"}
                                          </td>
                                          <td style={{ padding: "8px 10px", textAlign: "center" }}>
                                            <button
                                              type="button"
                                              onClick={() => handleDeleteQuote(quote.link_id, quote.supplier_name)}
                                              style={{
                                                padding: "3px 8px",
                                                borderRadius: "4px",
                                                background: "#fee2e2",
                                                color: "#dc2626",
                                                border: "none",
                                                cursor: "pointer",
                                                fontSize: "11px",
                                                fontWeight: 600,
                                              }}
                                            >
                                              Delete
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}

                                {/* Inline Form to Add Quote */}
                                {addingQuoteProductId === item.product_id && (
                                  <div
                                    style={{
                                      marginTop: "14px",
                                      padding: "14px",
                                      background: "#f8fafc",
                                      borderRadius: "6px",
                                      border: "1px dashed #cbd5e1",
                                    }}
                                  >
                                    <div style={{ fontWeight: 600, fontSize: "12.5px", color: "#0f172a", marginBottom: "8px" }}>
                                      Assign New Supplier Quote
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px" }}>
                                      <div>
                                        <label style={{ fontSize: "11px", fontWeight: 600, color: "#475569" }}>Supplier *</label>
                                        <select
                                          value={newQuoteSupplierId}
                                          onChange={(e) => setNewQuoteSupplierId(e.target.value)}
                                          style={{ width: "100%", padding: "6px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                                        >
                                          <option value="">Select Supplier</option>
                                          {quoteSuppliers.map((s) => (
                                            <option key={s.id} value={s.id}>
                                              {s.company_name}
                                            </option>
                                          ))}
                                        </select>
                                      </div>

                                      <div>
                                        <label style={{ fontSize: "11px", fontWeight: 600, color: "#475569" }}>Quoted Price (₹) *</label>
                                        <input
                                          type="number"
                                          step="0.01"
                                          placeholder="0.00"
                                          value={newQuotePrice}
                                          onChange={(e) => setNewQuotePrice(e.target.value)}
                                          style={{ width: "100%", padding: "6px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                                        />
                                      </div>

                                      <div>
                                        <label style={{ fontSize: "11px", fontWeight: 600, color: "#475569" }}>MOQ</label>
                                        <input
                                          type="number"
                                          placeholder="Min Order Qty"
                                          value={newQuoteMoq}
                                          onChange={(e) => setNewQuoteMoq(e.target.value)}
                                          style={{ width: "100%", padding: "6px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                                        />
                                      </div>

                                      <div>
                                        <label style={{ fontSize: "11px", fontWeight: 600, color: "#475569" }}>Notes</label>
                                        <input
                                          type="text"
                                          placeholder="Payment terms, lead time..."
                                          value={newQuoteNotes}
                                          onChange={(e) => setNewQuoteNotes(e.target.value)}
                                          style={{ width: "100%", padding: "6px 8px", fontSize: "12px", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                                        />
                                      </div>
                                    </div>

                                    <div style={{ marginTop: "10px", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                                      <button
                                        type="button"
                                        onClick={() => setAddingQuoteProductId(null)}
                                        style={{
                                          padding: "5px 12px",
                                          borderRadius: "4px",
                                          border: "1px solid #cbd5e1",
                                          background: "#ffffff",
                                          color: "#475569",
                                          fontSize: "12px",
                                          cursor: "pointer",
                                        }}
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleAddQuote(item.product_id)}
                                        disabled={quoteSubmitting}
                                        style={{
                                          padding: "5px 14px",
                                          borderRadius: "4px",
                                          border: "none",
                                          background: "#0061f2",
                                          color: "#ffffff",
                                          fontSize: "12px",
                                          fontWeight: 600,
                                          cursor: "pointer",
                                        }}
                                      >
                                        {quoteSubmitting ? "Saving..." : "Save Quote"}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ padding: "12px 18px", borderTop: "1px solid #e2e8f0" }}>
            <Pagination
              pagination={{
                current_page: page,
                total_pages: totalPages,
                total_items: totalItems,
                page_size: pageSize,
              }}
              pageSize={pageSize}
              onPageChange={(p) => setPage(p)}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
            />
          </div>
        </div>

        {/* SIDE DRAWER: REAL-TIME 2-WAY GST PRICE CALCULATOR */}
        <SideDrawer
          open={!!drawerItem}
          title="Price &amp; GST Calculator"
          onClose={() => setDrawerItem(null)}
        >
          {drawerItem && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              {/* Product Header Card */}
              <div
                style={{
                  background: "#f8fafc",
                  borderRadius: "8px",
                  padding: "14px",
                  border: "1px solid #e2e8f0",
                  display: "flex",
                  gap: "12px",
                  alignItems: "center",
                }}
              >
                {drawerItem.image_url ? (
                  <img
                    src={resolveImageUrl(drawerItem.image_url)}
                    alt=""
                    style={{ width: "48px", height: "48px", borderRadius: "6px", objectFit: "cover", border: "1px solid #cbd5e1" }}
                  />
                ) : (
                  <div style={{ width: "48px", height: "48px", borderRadius: "6px", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px" }}>
                    📦
                  </div>
                )}
                <div>
                  <div style={{ fontWeight: 700, fontSize: "14px", color: "#0f172a" }}>
                    {drawerItem.product_name_tally}
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                    Code: <strong style={{ color: "#334155" }}>{drawerItem.product_code || "—"}</strong> | HSN:{" "}
                    <strong>{drawerItem.hsn_number || "—"}</strong> ({drawerItem.gst_percent}% GST)
                  </div>
                </div>
              </div>

              {/* Calculator Mode Switch */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569" }}>Calculator Entry Mode</label>
                <div style={{ display: "flex", background: "#f1f5f9", padding: "3px", borderRadius: "6px" }}>
                  <button
                    type="button"
                    onClick={() => setDrawerEditMode("exclusive")}
                    style={{
                      flex: 1,
                      padding: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      borderRadius: "4px",
                      border: "none",
                      cursor: "pointer",
                      background: drawerEditMode === "exclusive" ? "#fff" : "transparent",
                      color: drawerEditMode === "exclusive" ? "#0061f2" : "#64748b",
                      boxShadow: drawerEditMode === "exclusive" ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                    }}
                  >
                    Enter Base Rate (Excl. GST)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerEditMode("inclusive")}
                    style={{
                      flex: 1,
                      padding: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      borderRadius: "4px",
                      border: "none",
                      cursor: "pointer",
                      background: drawerEditMode === "inclusive" ? "#0061f2" : "transparent",
                      color: drawerEditMode === "inclusive" ? "#fff" : "#64748b",
                      boxShadow: drawerEditMode === "inclusive" ? "0 1px 2px rgba(0,97,242,0.3)" : "none",
                    }}
                  >
                    Enter Final Total (Incl. GST)
                  </button>
                </div>
              </div>

              {/* Selling Price Live Calculation Card */}
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  padding: "16px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "13px", color: "#0f172a", marginBottom: "10px" }}>
                  Selling Price Calculator
                </div>

                <div style={{ marginBottom: "12px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "4px" }}>
                    {drawerEditMode === "inclusive"
                      ? "Customer Final Rate (Incl. GST) (₹)"
                      : "Base Commercial Rate (Excl. GST) (₹)"}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={drawerStdPrice}
                    onChange={(e) => setDrawerStdPrice(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid #0061f2",
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#0f172a",
                    }}
                    placeholder="0.00"
                  />
                </div>

                {/* Real-time Math Output */}
                {(() => {
                  const val = parseFloat(drawerStdPrice);
                  if (isNaN(val) || val <= 0) return null;
                  const gstPct = drawerItem.gst_percent || 18.0;

                  let baseRate: number;
                  let gstAmt: number;
                  let totalRate: number;

                  if (drawerEditMode === "inclusive") {
                    totalRate = val;
                    baseRate = Math.round((totalRate / (1 + gstPct / 100)) * 100) / 100;
                    gstAmt = Math.round((totalRate - baseRate) * 100) / 100;
                  } else {
                    baseRate = val;
                    gstAmt = Math.round(baseRate * (gstPct / 100) * 100) / 100;
                    totalRate = Math.round((baseRate + gstAmt) * 100) / 100;
                  }

                  return (
                    <div
                      style={{
                        background: "#f0fdf4",
                        border: "1px solid #bbf7d0",
                        borderRadius: "6px",
                        padding: "10px 12px",
                        fontSize: "12.5px",
                        color: "#166534",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span>Base Rate (Excl. GST):</span>
                        <strong>{formatCurrency(baseRate)}</strong>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span>GST ({gstPct}%):</span>
                        <strong>{formatCurrency(gstAmt)}</strong>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          borderTop: "1px dashed #86efac",
                          paddingTop: "4px",
                          fontSize: "13px",
                          fontWeight: 700,
                        }}
                      >
                        <span>Final Customer Rate:</span>
                        <span>{formatCurrency(totalRate)}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Minimum Floor Price Card */}
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  padding: "16px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "13px", color: "#0f172a", marginBottom: "10px" }}>
                  Minimum Floor Price
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "4px" }}>
                    {drawerEditMode === "inclusive"
                      ? "Floor Rate (Incl. GST) (₹)"
                      : "Floor Rate (Excl. GST) (₹)"}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={drawerMinPrice}
                    onChange={(e) => setDrawerMinPrice(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "14px",
                      color: "#0f172a",
                    }}
                    placeholder="Floor Selling Rate"
                  />
                </div>
              </div>

              {/* Landing Cost (Standard Cost) */}
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  padding: "16px",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "13px", color: "#0f172a", marginBottom: "10px" }}>
                  Landing Cost (Standard Cost)
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "4px" }}>
                    Standard Cost (Excl. GST) (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={drawerStdCost}
                    onChange={(e) => setDrawerStdCost(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "14px",
                      color: "#0f172a",
                    }}
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Drawer Footer Buttons */}
              <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                <button
                  type="button"
                  onClick={() => setDrawerItem(null)}
                  style={{
                    flex: 1,
                    padding: "10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    color: "#475569",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveDrawerPrice}
                  disabled={drawerSaving}
                  style={{
                    flex: 2,
                    padding: "10px",
                    borderRadius: "6px",
                    border: "none",
                    background: "#0061f2",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {drawerSaving ? "Saving..." : "Save Pricing"}
                </button>
              </div>
            </div>
          )}
        </SideDrawer>

        {/* BULK IMPORT MODAL */}
        <Modal
          open={importModalOpen}
          title="Bulk Price Spreadsheet Import"
          onClose={() => setImportModalOpen(false)}
          variant="center"
          cardStyle={{ maxWidth: "600px" }}
        >
          <form onSubmit={handleUploadImport} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
              Update commercial product prices, minimum floor rates, and standard costs in bulk via Excel spreadsheet.
            </p>

            <div
              style={{
                border: "2px dashed #cbd5e1",
                borderRadius: "8px",
                padding: "24px",
                textAlign: "center",
                background: "#f8fafc",
              }}
            >
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                style={{ display: "none" }}
                id="price-import-input"
              />
              <label
                htmlFor="price-import-input"
                style={{
                  display: "inline-block",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  background: "#0061f2",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  marginBottom: "8px",
                }}
              >
                Browse Excel File (.xlsx)
              </label>
              <div style={{ fontSize: "12px", color: "#64748b" }}>
                {importFile ? <strong>{importFile.name}</strong> : "or drag and drop spreadsheet here"}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                style={{
                  background: "none",
                  border: "none",
                  color: "#0061f2",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                  textDecoration: "underline",
                  padding: 0,
                }}
              >
                ⬇ Download Sample Import Template (.xlsx)
              </button>
            </div>

            {/* Import Outcome Report */}
            {importResult && (
              <div
                style={{
                  background: importResult.failed_rows === 0 ? "#ecfdf5" : "#fffbeb",
                  border: importResult.failed_rows === 0 ? "1px solid #10b981" : "1px solid #f59e0b",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  fontSize: "13px",
                }}
              >
                <div style={{ fontWeight: 700, color: "#0f172a" }}>
                  Import Completed: {importResult.successful_updates} updated, {importResult.failed_rows} errors
                </div>
                {importResult.errors.length > 0 && (
                  <div style={{ marginTop: "8px", maxHeight: "120px", overflowY: "auto", fontSize: "12px" }}>
                    {importResult.errors.map((err, i) => (
                      <div key={i} style={{ color: "#b91c1c", marginBottom: "3px" }}>
                        Row {err.row_number}: {err.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
              <button
                type="submit"
                disabled={!importFile || importUploading}
                style={{
                  padding: "8px 20px",
                  borderRadius: "6px",
                  border: "none",
                  background: "#0061f2",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {importUploading ? "Uploading & Processing..." : "Upload & Update Prices"}
              </button>
            </div>
          </form>
        </Modal>
      </div>
    </AppShell>
  );
}

export default PriceListPage;
