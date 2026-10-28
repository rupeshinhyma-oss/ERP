/**
 * Local Purchases List Page.
 *
 * Displays domestic vendor purchases, invoice values in RMB with VAT,
 * Value-Based landing costs, and provides search, filters, export, and CRUD actions.
 * Fully styled using the ERP's native design system (vanilla CSS tokens & inline styles).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { apiDelete, apiGet, downloadExport, errorMessage } from "@/lib/api";
import { useLookup } from "@/lib/lookups";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";
import type { LocalPurchaseSummary } from "@/types/localPurchase";
import {
  getLocalPurchasesListCache,
  setLocalPurchasesListCache,
  removeLocalPurchaseFromCache,
} from "@/lib/localPurchaseCache";
import { LocalPurchaseDetailModal } from "./LocalPurchaseDetailModal";
import { LocalPurchaseInwardModal } from "./LocalPurchaseInwardModal";

export function LocalPurchasesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  // Filters state
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // In-memory cache key & cache-first instant render (0ms transition on back/re-entry)
  const cacheKey = useMemo(() => {
    return `${page}_${pageSize}_${debouncedSearch.trim()}_${selectedSupplierId}_${selectedStatus}_${dateFrom}_${dateTo}`;
  }, [page, pageSize, debouncedSearch, selectedSupplierId, selectedStatus, dateFrom, dateTo]);

  const initialCached = useMemo(() => getLocalPurchasesListCache(cacheKey), [cacheKey]);

  const [purchases, setPurchases] = useState<LocalPurchaseSummary[]>(() => initialCached?.items || []);
  const [loading, setLoading] = useState(() => !initialCached);
  const [total, setTotal] = useState(() => initialCached?.total || 0);

  // Selected purchase summary for instant modal painting
  const [selectedSummary, setSelectedSummary] = useState<LocalPurchaseSummary | null>(null);

  // Debounce search input by 300ms to eliminate redundant network calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Action Menu State
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const [viewPurchaseId, setViewPurchaseId] = useState<string | null>(null);
  const [inwardPurchaseId, setInwardPurchaseId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Sync deep link query params (from notifications or external links)
  useEffect(() => {
    const s = searchParams.get("search");
    const id = searchParams.get("id");
    if (s) {
      setSearchInput(s);
      setDebouncedSearch(s);
    }
    if (id) {
      setViewPurchaseId(id);
    }
  }, [searchParams]);

  // Close kebab action menu on outside click
  useEffect(() => {
    if (!openActionId) return;
    const handleOutsideClick = () => setOpenActionId(null);
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [openActionId]);

  // Lookups
  const supplierLookup = useLookup<{ id: string; company_name: string }>(
    "/suppliers/lookup",
    1000
  );

  // Fetch Purchases with SWR background revalidation
  const fetchPurchases = useCallback(async () => {
    const cached = getLocalPurchasesListCache(cacheKey);
    if (cached) {
      setPurchases(cached.items);
      setTotal(cached.total);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (selectedSupplierId) params.set("supplier_id", selectedSupplierId);
      if (selectedStatus) params.set("status", selectedStatus);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);

      const res = await apiGet<{
        items: LocalPurchaseSummary[];
        total: number;
        page: number;
        page_size: number;
        total_pages: number;
      }>(`/purchases/local?${params.toString()}`);

      if (res.data) {
        setPurchases(res.data.items);
        setTotal(res.data.total);
        setLocalPurchasesListCache(cacheKey, {
          items: res.data.items,
          total: res.data.total,
        });
      }
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  }, [cacheKey, page, pageSize, debouncedSearch, selectedSupplierId, selectedStatus, dateFrom, dateTo, toast]);

  useEffect(() => {
    fetchPurchases();
  }, [fetchPurchases]);

  // Close menus on outside click
  useEffect(() => {
    const handleDocClick = () => {
      setOpenActionId(null);
      setExportOpen(false);
    };
    document.addEventListener("click", handleDocClick);
    return () => document.removeEventListener("click", handleDocClick);
  }, []);

  // Delete Purchase
  const handleDelete = async (id: string, invoiceNo: string) => {
    const confirmed = await confirm({
      title: "Delete Purchase Invoice",
      message: `Are you sure you want to delete purchase invoice "${invoiceNo}"? This action cannot be undone.`,
      itemName: invoiceNo,
      confirmLabel: "Delete Invoice",
      variant: "danger",
    });
    if (!confirmed) return;
    try {
      await apiDelete(`/purchases/local/${id}`);
      removeLocalPurchaseFromCache(id);
      setPurchases((prev) => prev.filter((p) => p.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
      toast(`Purchase invoice "${invoiceNo}" deleted successfully.`, "success");
      fetchPurchases();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  // Export
  const handleExport = async (format: "xlsx" | "csv") => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (selectedSupplierId) params.set("supplier_id", selectedSupplierId);
      if (selectedStatus) params.set("status", selectedStatus);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);

      await downloadExport(
        `/purchases/local?${params.toString()}`,
        format,
        `local_purchases_${new Date().toISOString().slice(0, 10)}`
      );
      toast(`Exported local purchases as ${format.toUpperCase()}`, "success");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setExporting(false);
      setExportOpen(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Count active filters
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (selectedSupplierId) count++;
    if (selectedStatus) count++;
    if (dateFrom || dateTo) count++;
    return count;
  }, [selectedSupplierId, selectedStatus, dateFrom, dateTo]);

  // Aggregate stats from current view
  const stats = useMemo(() => {
    const totalLandingVal = purchases.reduce((acc, p) => acc + (p.items_total_landing || 0), 0);
    const totalExpVal = purchases.reduce((acc, p) => acc + (p.total_expenses || 0), 0);
    return {
      totalLandingVal,
      totalExpVal,
    };
  }, [purchases]);

  return (
    <AppShell activeKey="local-purchases">
      <main className="page" style={{ width: "100%", padding: "16px 24px" }}>
        {/* Page Header Bar */}
        <div className="page-header" style={{ marginBottom: "16px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <h1 className="page-title">
                Local Purchases
              </h1>
              <span className="badge badge-info" style={{ fontSize: "12px", padding: "3px 8px", fontWeight: 600 }}>
                {total} Records
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="page-header-actions" style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            {/* Filter Toggle Button (Matching Products Master Style) */}
            <button
              type="button"
              className={`btn btn-header-filter ${filterOpen ? "active" : ""}`}
              onClick={() => setFilterOpen((v) => !v)}
              style={{
                background: filterOpen || activeFiltersCount > 0 ? "#0061f2" : "#475569",
                color: "#ffffff",
                padding: "8px 12px",
                borderRadius: "6px",
                border: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                position: "relative",
              }}
              title="Toggle Filter Options"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
              </svg>
              {activeFiltersCount > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: "-5px",
                    right: "-5px",
                    background: "#ef4444",
                    color: "#ffffff",
                    borderRadius: "10px",
                    padding: "1px 5px",
                    fontSize: "10px",
                    fontWeight: 700,
                    lineHeight: "1.2",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  }}
                >
                  {activeFiltersCount}
                </span>
              )}
            </button>

            {/* Add New Local Purchase Button */}
            {hasPermission("local_purchase.create") && (
            <button
              type="button"
              className="btn btn-add-new"
              onClick={() => navigate("/purchase/local/new")}
              style={{
                background: "#0061f2",
                color: "#ffffff",
                border: "none",
                padding: "8px 18px",
                borderRadius: "6px",
                fontWeight: 700,
                fontSize: "13px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 2px 4px rgba(0,97,242,0.2)",
              }}
            >
              <span>+</span> ADD LOCAL PURCHASE
            </button>
            )}

            {/* Export Dropdown (Matching Products Master Orange Imp/Exp Style) */}
            {hasPermission("local_purchase.export") && (
            <div style={{ position: "relative", display: "inline-block" }}>
              <button
                type="button"
                className="btn btn-imp-exp"
                onClick={(e) => {
                  e.stopPropagation();
                  setExportOpen((prev) => !prev);
                }}
                disabled={exporting}
                style={{
                  background: "#f59e0b",
                  color: "#ffffff",
                  border: "none",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: exporting ? "wait" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 2px 4px rgba(245, 158, 11, 0.25)",
                }}
                title="Export Local Purchases"
              >
                <span>{exporting ? "Exporting..." : "Export ▾"}</span>
              </button>

              {exportOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    marginTop: "6px",
                    background: "#ffffff",
                    borderRadius: "8px",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)",
                    border: "1px solid #e2e8f0",
                    zIndex: 1000,
                    minWidth: "190px",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ padding: "8px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Export Options
                  </div>
                  <button
                    type="button"
                    onClick={() => handleExport("xlsx")}
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
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    <span style={{ color: "#16a34a", fontSize: "15px" }}>📊</span> Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport("csv")}
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
                      borderTop: "1px solid #f1f5f9",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    <span style={{ color: "#0061f2", fontSize: "15px" }}>📄</span> CSV (.csv)
                  </button>
                </div>
              )}
            </div>
            )}
          </div>
        </div>

        {/* Top KPI Stat Cards */}
        <div className="stat-grid" style={{ marginBottom: "16px" }}>
          <div className="stat-card">
            <div>
              <div className="stat-value" style={{ color: "#0061f2" }}>{total}</div>
              <div className="stat-label">Total Domestic Purchases</div>
            </div>
            <div className="stat-icon" style={{ background: "#e0edff", color: "#0061f2", fontSize: "20px" }}>
              📦
            </div>
          </div>

          <div className="stat-card">
            <div>
              <div className="stat-value" style={{ color: "#0f172a" }}>
                ¥ {stats.totalLandingVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="stat-label">Current Page Total Landing</div>
            </div>
            <div className="stat-icon" style={{ background: "#f1f5f9", color: "#334155", fontSize: "20px" }}>
              💰
            </div>
          </div>

          <div className="stat-card">
            <div>
              <div className="stat-value" style={{ color: "#d97706" }}>
                ¥ {stats.totalExpVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="stat-label">Total Expenses Disbursed</div>
            </div>
            <div className="stat-icon" style={{ background: "#fffbeb", color: "#d97706", fontSize: "20px" }}>
              🚛
            </div>
          </div>
        </div>

        {/* Expandable Filter Box matching Products Master ERP Standard (Above the table card) */}
        {filterOpen && (
          <div
            className="card"
            style={{
              padding: "16px 20px",
              marginBottom: "16px",
              background: "#ffffff",
              borderRadius: "10px",
              border: "1.5px solid #cbd5e1",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <div style={{ fontWeight: 600, fontSize: "14px", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                </svg>
                Filter Options
                {activeFiltersCount > 0 && (
                  <span style={{ background: "#2563eb", color: "#ffffff", padding: "1px 7px", borderRadius: "10px", fontSize: "11px", fontWeight: 700, marginLeft: "4px" }}>
                    {activeFiltersCount}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="btn btn-small"
                style={{
                  background: "#f1f5f9",
                  color: "#475569",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: 600,
                  padding: "5px 14px",
                  fontSize: "12px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
                onClick={() => {
                  setSelectedSupplierId("");
                  setSelectedStatus("");
                  setDateFrom("");
                  setDateTo("");
                  setSearchInput("");
                  setPage(1);
                }}
              >
                Reset Filters
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "14px",
                alignItems: "flex-end",
              }}
            >
              {/* Supplier Filter */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Supplier
                </label>
                <select
                  value={selectedSupplierId}
                  onChange={(e) => {
                    setSelectedSupplierId(e.target.value);
                    setPage(1);
                  }}
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#1e293b",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="">All Suppliers</option>
                  {(supplierLookup.items || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.company_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status Filter */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  Status
                </label>
                <select
                  value={selectedStatus}
                  onChange={(e) => {
                    setSelectedStatus(e.target.value);
                    setPage(1);
                  }}
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#1e293b",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="">All Statuses</option>
                  <option value="Confirmed">Confirmed</option>
                  <option value="Inwarded">Inwarded</option>
                  <option value="Pending">Pending</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>

              {/* From Date */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  From Date
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#1e293b",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* To Date */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                  To Date
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#1e293b",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Data Table Card */}
        <div
          className="card"
          style={{
            background: "#ffffff",
            borderRadius: "10px",
            border: "1.5px solid #cbd5e1",
            padding: 0,
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          {/* Table Card Toolbar */}
          <div
            className="toolbar"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 16px",
              gap: "10px",
              flexWrap: "wrap",
              borderBottom: "1px solid #e2e8f0",
              background: "#fafbfc",
            }}
          >
            {/* Left: Items per Page */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "13px",
                  background: "#ffffff",
                  fontWeight: 600,
                  color: "#334155",
                }}
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
              <span style={{ fontSize: "13px", color: "#64748b", fontWeight: 500 }}>Items/Page</span>
            </div>

            {/* Right: Search Box */}
            <div style={{ position: "relative", minWidth: "280px" }}>
              <input
                type="text"
                placeholder="Search invoice, supplier, org..."
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setPage(1);
                }}
                style={{
                  width: "100%",
                  padding: "7px 32px 7px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "13px",
                  boxSizing: "border-box",
                  background: "#ffffff",
                  outline: "none",
                }}
              />
              {searchInput ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput("");
                    setDebouncedSearch("");
                    setPage(1);
                  }}
                  style={{
                    position: "absolute",
                    right: "8px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "#94a3b8",
                    cursor: "pointer",
                    fontSize: "14px",
                    padding: "2px 4px",
                  }}
                >
                  ✕
                </button>
              ) : (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    position: "absolute",
                    right: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    pointerEvents: "none",
                    flexShrink: 0,
                  }}
                >
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              )}
            </div>
          </div>

          {/* Table Container */}
          <div className="table-scroll" style={{ maxHeight: "calc(100vh - 340px)", minHeight: "240px", border: "none", borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: "60px", textAlign: "center" }}>SR.</th>
                  <th style={{ minWidth: "160px" }}>INVOICE NO & DATE</th>
                  <th style={{ minWidth: "180px" }}>SUPPLIER</th>
                  <th style={{ textAlign: "right", minWidth: "130px" }}>INVOICE TOTAL (VAT)</th>
                  <th style={{ textAlign: "right", minWidth: "110px" }}>EXPENSES</th>
                  <th style={{ textAlign: "right", minWidth: "130px" }}>TOTAL LANDING</th>
                  <th style={{ minWidth: "110px" }}>CREATED BY</th>
                  <th style={{ minWidth: "100px" }}>DATE ADDED</th>
                  <th style={{ textAlign: "center", width: "100px" }}>STATUS</th>
                  <th style={{ textAlign: "center", width: "80px" }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                      <div style={{ display: "inline-block", fontSize: "16px", marginBottom: "8px" }}>⏳</div>
                      <div>Loading local purchases...</div>
                    </td>
                  </tr>
                ) : purchases.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                      No local purchase records found. Click <strong>+ ADD LOCAL PURCHASE</strong> to create one.
                    </td>
                  </tr>
                ) : (
                  purchases.map((p, idx) => {
                    const srNo = (page - 1) * pageSize + idx + 1;
                    const isAlreadyInwarded =
                      p.status.toLowerCase() === "inwarded" || !!p.stock_movement_id;

                    return (
                      <tr key={p.id}>
                        {/* Sr. No */}
                        <td style={{ textAlign: "center", color: "#64748b", fontWeight: 600 }}>
                          {srNo}
                        </td>

                        {/* Invoice No & Date */}
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSummary(p);
                                setViewPurchaseId(p.id);
                              }}
                              title="Click to view purchase details"
                              style={{
                                background: "none",
                                border: "none",
                                padding: 0,
                                fontWeight: 700,
                                color: "#0061f2",
                                cursor: "pointer",
                                textAlign: "left",
                                fontSize: "13px",
                                display: "inline-block",
                                textDecoration: "underline",
                                textUnderlineOffset: "2px",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = "#0041a8")}
                              onMouseLeave={(e) => (e.currentTarget.style.color = "#0061f2")}
                            >
                              {p.invoice_no}
                            </button>
                            {p.bill_file_url && (
                              <a
                                href={p.bill_file_url}
                                target="_blank"
                                rel="noreferrer"
                                download
                                title="Download bill file from Supabase"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "3px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  color: "#059669",
                                  background: "#ecfdf5",
                                  border: "1px solid #a7f3d0",
                                  borderRadius: "4px",
                                  padding: "1px 6px",
                                  textDecoration: "none",
                                }}
                              >
                                📥 Bill
                              </a>
                            )}
                          </div>
                          <span style={{ fontSize: "11px", color: "#64748b" }}>{p.invoice_date}</span>
                        </td>

                        {/* Supplier */}
                        <td style={{ fontWeight: 600, color: "#334155" }}>
                          <div>
                            {(() => {
                              const raw = p.supplier_name || "-";
                              const m = raw.match(/^(.+?)\s*\((.+?)\)$/);
                              if (m) {
                                return (
                                  <span>
                                    <strong style={{ fontWeight: 700, color: "#0f172a" }}>{m[1]}</strong>
                                    <span style={{ color: "#64748b", marginLeft: "4px", fontWeight: 400 }}>({m[2]})</span>
                                  </span>
                                );
                              }
                              return <strong style={{ fontWeight: 600, color: "#1e293b" }}>{raw}</strong>;
                            })()}
                          </div>
                          {p.consignment_code && (
                            <div style={{ marginTop: "4px" }}>
                              <span
                                style={{
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  color: "#0369a1",
                                  background: "#e0f2fe",
                                  border: "1px solid #bae6fd",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                🚢 {p.consignment_code}
                                {p.branch_name ? ` • ${p.branch_name}` : ""}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Invoice Total Value with VAT */}
                        <td style={{ textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                          {p.currency === "RMB" ? "¥" : p.currency === "INR" ? "₹" : "$"}{" "}
                          {p.invoice_total_value.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>

                        {/* Total Expenses */}
                        <td style={{ textAlign: "right", color: "#475569" }}>
                          {p.currency === "RMB" ? "¥" : p.currency === "INR" ? "₹" : "$"}{" "}
                          {p.total_expenses.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                          <div style={{ fontSize: "10.5px", color: "#94a3b8" }}>
                            {p.loading_expense_pct.toFixed(1)}% loading
                          </div>
                        </td>

                        {/* Total Landing Cost */}
                        <td style={{ textAlign: "right", fontWeight: 700, color: "#059669" }}>
                          {p.currency === "RMB" ? "¥" : p.currency === "INR" ? "₹" : "$"}{" "}
                          {p.items_total_landing.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                          <div style={{ fontSize: "10.5px", color: "#64748b" }}>
                            {p.items_count} item(s)
                          </div>
                        </td>

                        {/* Created By */}
                        <td style={{ color: "#475569", fontSize: "12.5px" }}>
                          {p.created_by_name || "—"}
                        </td>

                        {/* Date Added */}
                        <td style={{ color: "#64748b", fontSize: "12px", whiteSpace: "nowrap" }}>
                          {p.created_at ? p.created_at.slice(0, 10) : "—"}
                        </td>

                        {/* Status */}
                        <td style={{ textAlign: "center" }}>
                          {isAlreadyInwarded ? (
                            <div>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  background: "#ecfdf5",
                                  color: "#059669",
                                  border: "1px solid #a7f3d0",
                                  padding: "3px 8px",
                                  borderRadius: "12px",
                                  fontSize: "11.5px",
                                  fontWeight: 700,
                                }}
                              >
                                ● Inwarded
                              </span>
                              {p.stock_movement_number && (
                                <div style={{ marginTop: "3px", fontSize: "11px" }}>
                                  <a
                                    href="/inventory/stock-movements"
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: "#0284c7", fontWeight: 600, textDecoration: "none" }}
                                    title="View Inward Stock Movement"
                                  >
                                    Slip: {p.stock_movement_number}
                                  </a>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  background: "#fef3c7",
                                  color: "#b45309",
                                  border: "1px solid #fde68a",
                                  padding: "3px 8px",
                                  borderRadius: "12px",
                                  fontSize: "11.5px",
                                  fontWeight: 700,
                                }}
                              >
                                ● {p.status || "Confirmed"}
                              </span>
                              {hasPermission("local_purchase.inward") && (
                                <div style={{ marginTop: "4px" }}>
                                  <button
                                    type="button"
                                    onClick={() => setInwardPurchaseId(p.id)}
                                    title="Inward this purchase into warehouse stock"
                                    style={{
                                      background: "#f0fdf4",
                                      border: "1px solid #86efac",
                                      color: "#166534",
                                      fontSize: "11px",
                                      fontWeight: 700,
                                      borderRadius: "4px",
                                      padding: "2px 7px",
                                      cursor: "pointer",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "3px",
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.background = "#dcfce7")}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = "#f0fdf4")}
                                  >
                                    📦 Inward Stock
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Actions (Kebab Menu) */}
                        <td style={{ textAlign: "center", position: "relative" }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenActionId(openActionId === p.id ? null : p.id);
                            }}
                            style={{
                              background: "none",
                              border: "1px solid #e2e8f0",
                              borderRadius: "4px",
                              padding: "4px 8px",
                              cursor: "pointer",
                              fontSize: "14px",
                              color: "#475569",
                            }}
                            title="Actions"
                          >
                            ⋮
                          </button>

                          {openActionId === p.id && (() => {
                            const isNearBottom = idx >= Math.max(1, purchases.length - 2);
                            return (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  position: "absolute",
                                  right: "10px",
                                  ...(isNearBottom
                                    ? { bottom: "100%", marginBottom: "4px" }
                                    : { top: "100%", marginTop: "4px" }),
                                  background: "#ffffff",
                                  borderRadius: "6px",
                                  boxShadow: "0 8px 20px rgba(0,0,0,0.15)",
                                  border: "1px solid #cbd5e1",
                                  zIndex: 100,
                                  minWidth: "125px",
                                  overflow: "hidden",
                                  textAlign: "left",
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenActionId(null);
                                    setSelectedSummary(p);
                                    setViewPurchaseId(p.id);
                                  }}
                                  style={{
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "8px 12px",
                                    fontSize: "12.5px",
                                    color: "#0f172a",
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                >
                                  👁️ View Details
                                </button>
                                {!isAlreadyInwarded ? (
                                  hasPermission("local_purchase.inward") && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionId(null);
                                        setInwardPurchaseId(p.id);
                                      }}
                                      style={{
                                        width: "100%",
                                        textAlign: "left",
                                        padding: "8px 12px",
                                        fontSize: "12.5px",
                                        color: "#166534",
                                        fontWeight: 700,
                                        background: "#f0fdf4",
                                        border: "none",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "6px",
                                      }}
                                      onMouseEnter={(e) => (e.currentTarget.style.background = "#dcfce7")}
                                      onMouseLeave={(e) => (e.currentTarget.style.background = "#f0fdf4")}
                                    >
                                      📦 Inward to Warehouse
                                    </button>
                                  )
                                ) : (
                                  <div
                                    style={{
                                      padding: "6px 12px",
                                      fontSize: "11.5px",
                                      color: "#059669",
                                      fontWeight: 600,
                                      background: "#f0fdf4",
                                      borderBottom: "1px solid #e2e8f0",
                                    }}
                                  >
                                    ✓ Inwarded: {p.stock_movement_number || "Complete"}
                                  </div>
                                )}
                              {p.bill_file_url ? (
                                <a
                                  href={p.bill_file_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  download
                                  onClick={() => setOpenActionId(null)}
                                  style={{
                                    width: "100%",
                                    boxSizing: "border-box",
                                    textAlign: "left",
                                    padding: "8px 12px",
                                    fontSize: "12.5px",
                                    color: "#059669",
                                    background: "none",
                                    border: "none",
                                    borderTop: "1px solid #f1f5f9",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    textDecoration: "none",
                                    fontWeight: 600,
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = "#ecfdf5")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                >
                                  📥 Download Bill
                                </a>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenActionId(null);
                                    toast("No bill document was uploaded for this purchase.", "warning");
                                  }}
                                  style={{
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "8px 12px",
                                    fontSize: "12.5px",
                                    color: "#94a3b8",
                                    background: "none",
                                    border: "none",
                                    borderTop: "1px solid #f1f5f9",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                >
                                  📥 Download Bill (None)
                                </button>
                              )}
                              {hasPermission("local_purchase.update") && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenActionId(null);
                                  navigate(`/purchase/local/${p.id}/edit`);
                                }}
                                style={{
                                  width: "100%",
                                  textAlign: "left",
                                  padding: "8px 12px",
                                  fontSize: "12.5px",
                                  color: "#334155",
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  borderTop: "1px solid #f1f5f9",
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                              >
                                ✏️ Edit
                              </button>
                              )}
                              {hasPermission("local_purchase.delete") && (
                              <button
                                type="button"
                                onClick={() => handleDelete(p.id, p.invoice_no)}
                                style={{
                                  width: "100%",
                                  textAlign: "left",
                                  padding: "8px 12px",
                                  fontSize: "12.5px",
                                  color: "#ef4444",
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  borderTop: "1px solid #f1f5f9",
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = "#fef2f2")}
                                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                              >
                                🗑️ Delete
                              </button>
                              )}
                            </div>
                          );
                        })()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Footer Pagination */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 18px",
              borderTop: "1px solid #e2e8f0",
              background: "#fafbfc",
              fontSize: "13px",
              color: "#64748b",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <div>
              Showing {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} records (Page {page} of {totalPages})
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{
                  padding: "5px 12px",
                  borderRadius: "5px",
                  border: "1px solid #cbd5e1",
                  background: page <= 1 ? "#f1f5f9" : "#ffffff",
                  color: page <= 1 ? "#94a3b8" : "#334155",
                  cursor: page <= 1 ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  fontSize: "12.5px",
                }}
              >
                Previous
              </button>
              <span
                style={{
                  padding: "5px 10px",
                  background: "#0061f2",
                  color: "#ffffff",
                  borderRadius: "5px",
                  fontWeight: 700,
                  fontSize: "12.5px",
                }}
              >
                {page}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={{
                  padding: "5px 12px",
                  borderRadius: "5px",
                  border: "1px solid #cbd5e1",
                  background: page >= totalPages ? "#f1f5f9" : "#ffffff",
                  color: page >= totalPages ? "#94a3b8" : "#334155",
                  cursor: page >= totalPages ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  fontSize: "12.5px",
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Local Purchase Details Preview Modal */}
      <LocalPurchaseDetailModal
        purchaseId={viewPurchaseId}
        initialSummary={selectedSummary}
        isOpen={!!viewPurchaseId}
        onClose={() => {
          setViewPurchaseId(null);
          setSelectedSummary(null);
        }}
        onEdit={(id) => {
          setViewPurchaseId(null);
          setSelectedSummary(null);
          navigate(`/purchase/local/${id}/edit`);
        }}
      />

      {/* Inward Stock Receiving Modal */}
      <LocalPurchaseInwardModal
        isOpen={!!inwardPurchaseId}
        purchaseId={inwardPurchaseId}
        onClose={() => setInwardPurchaseId(null)}
        onSuccess={() => {
          fetchPurchases();
        }}
      />
    </AppShell>
  );
}
