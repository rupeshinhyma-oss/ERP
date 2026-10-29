import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { SortHeader } from "@/components/SortHeader";
import {
  InventoryApi,
  type ProductStockLedgerResponse,
  type StockTransactionLedgerEntry,
} from "@/lib/api";
import "@/styles/productStock.css";

function getBadgeVariant(txType: string): string {
  const norm = (txType || "").trim().toLowerCase();
  if (norm === "sale") return "sale";
  if (norm === "sale cancel") return "sale-cancel";
  if (norm === "stock in") return "stock-in";
  if (norm === "stock out") return "stock-out";
  if (norm === "local purchase" || norm === "import purchase") return "purchase";
  if (norm.startsWith("transfer")) return "transfer";
  return "stock-in";
}

function resolveReferenceRoute(entry: StockTransactionLedgerEntry): string | null {
  const refId = entry.ref_id;
  if (!refId) return null;
  switch (entry.ref_type) {
    case "sale_order":
      return `/sale-order/addedit/${encodeURIComponent(refId)}`;
    case "stock_adjustment":
      return `/adjustment/adjustment-order-pdf/${encodeURIComponent(refId)}`;
    case "local_purchase":
      return `/purchase/localpurchase/bill-file/${encodeURIComponent(refId)}`;
    case "import_purchase":
      return `/purchase/importpurchase/bill-file/${encodeURIComponent(refId)}`;
    case "stock_transfer":
      return `/transfer/transfer-order-pdf/${encodeURIComponent(refId)}`;
    default:
      return null;
  }
}

function formatQtyNumber(val: number): string {
  const rounded = Math.round(Number(val || 0) * 10000) / 10000;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

export function StockTransactionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [ledgerData, setLedgerData] = useState<ProductStockLedgerResponse | null>(null);

  // Action dropdown & collapsible filter panel
  const [actionMenuOpen, setActionMenuOpen] = useState<boolean>(false);
  const actionWrapRef = useRef<HTMLDivElement | null>(null);
  const [showFilterPanel, setShowFilterPanel] = useState<boolean>(false);

  // Filter draft states
  const [warehouseDraft, setWarehouseDraft] = useState<string>("All");
  const [typeDraft, setTypeDraft] = useState<string>("All");
  const [dateFromDraft, setDateFromDraft] = useState<string>("");
  const [dateToDraft, setDateToDraft] = useState<string>("");

  // Applied filter states
  const [appliedWarehouse, setAppliedWarehouse] = useState<string>("All");
  const [appliedType, setAppliedType] = useState<string>("All");
  const [appliedDateFrom, setAppliedDateFrom] = useState<string>("");
  const [appliedDateTo, setAppliedDateTo] = useState<string>("");

  // Table toolbar & sorting states
  const [perPage, setPerPage] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortColIndex, setSortColIndex] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    const handleOutsideClick = (ev: MouseEvent) => {
      if (actionWrapRef.current && !actionWrapRef.current.contains(ev.target as Node)) {
        setActionMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setErrorMsg("Missing product identifier.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);

    InventoryApi.getProductStockTransactions(id)
      .then((res) => {
        if (!cancelled && res?.data) {
          setLedgerData(res.data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Failed to fetch stock transaction ledger:", err);
          setErrorMsg(err?.message || "Unable to load stock transactions for this product.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const productName = ledgerData?.product?.product_name_tally || "";

  const availableQty = useMemo(() => {
    if (!ledgerData?.product) return 0;
    if (appliedWarehouse && appliedWarehouse !== "All") {
      const whKey = appliedWarehouse.trim().toLowerCase().replace(/\s+/g, "_");
      const whMap = ledgerData.product.warehouses || {};
      if (Object.prototype.hasOwnProperty.call(whMap, whKey)) {
        return Number(whMap[whKey] ?? 0);
      }
    }
    return Number(ledgerData.product.available_qty ?? 0);
  }, [ledgerData, appliedWarehouse]);

  const warehouseOptions = useMemo(() => {
    const defaults = [
      "Mumbai",
      "Mumbai Transit",
      "Mumbai Ordered",
      "Ahmedabad",
      "Ahmedabad Transit",
      "Ahmedabad Ordered",
      "Indore",
      "Indore Transit",
      "Indore Ordered",
    ];
    const fromApi = ledgerData?.filter_options?.warehouses || [];
    return Array.from(new Set([...defaults, ...fromApi]));
  }, [ledgerData]);

  const typeOptions = useMemo(() => {
    const defaults = [
      "Sale",
      "Sale Cancel",
      "Stock IN",
      "Stock OUT",
      "Local Purchase",
      "Import Purchase",
      "Transfer IN",
      "Transfer OUT",
    ];
    const fromApi = ledgerData?.filter_options?.types || [];
    return Array.from(new Set([...defaults, ...fromApi]));
  }, [ledgerData]);

  const handleApplyFilters = useCallback(() => {
    setAppliedWarehouse(warehouseDraft);
    setAppliedType(typeDraft);
    setAppliedDateFrom(dateFromDraft);
    setAppliedDateTo(dateToDraft);
    setCurrentPage(1);
  }, [warehouseDraft, typeDraft, dateFromDraft, dateToDraft]);

  const handleResetFilters = useCallback(() => {
    setWarehouseDraft("All");
    setTypeDraft("All");
    setDateFromDraft("");
    setDateToDraft("");
    setAppliedWarehouse("All");
    setAppliedType("All");
    setAppliedDateFrom("");
    setAppliedDateTo("");
    setCurrentPage(1);
  }, []);

  const filteredEntries = useMemo(() => {
    const items = ledgerData?.items || [];
    return items.filter((entry) => {
      if (
        appliedWarehouse !== "All" &&
        (entry.warehouse || "").trim().toLowerCase() !== appliedWarehouse.trim().toLowerCase()
      ) {
        return false;
      }
      if (
        appliedType !== "All" &&
        (entry.type || "").trim().toLowerCase() !== appliedType.trim().toLowerCase()
      ) {
        return false;
      }
      if (appliedDateFrom && entry.iso_date && entry.iso_date < appliedDateFrom) {
        return false;
      }
      if (appliedDateTo && entry.iso_date && entry.iso_date > appliedDateTo) {
        return false;
      }
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim();
        const matches =
          String(entry.id).toLowerCase().includes(q) ||
          (entry.title || "").toLowerCase().includes(q) ||
          (entry.party_name || "").toLowerCase().includes(q) ||
          (entry.type || "").toLowerCase().includes(q) ||
          (entry.warehouse || "").toLowerCase().includes(q) ||
          (entry.created_by || "").toLowerCase().includes(q) ||
          (entry.transaction_date || "").toLowerCase().includes(q) ||
          (entry.quantity_display || "").toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [ledgerData, appliedWarehouse, appliedType, appliedDateFrom, appliedDateTo, searchTerm]);

  const handleHeaderSort = useCallback(
    (colIdx: number) => {
      if (sortColIndex === colIdx) {
        if (sortDirection === "asc") {
          setSortDirection("desc");
        } else {
          setSortColIndex(null);
          setSortDirection("asc");
        }
      } else {
        setSortColIndex(colIdx);
        setSortDirection("asc");
      }
    },
    [sortColIndex, sortDirection]
  );

  const sortedEntries = useMemo(() => {
    if (sortColIndex === null) return filteredEntries;
    const list = [...filteredEntries];
    list.sort((a, b) => {
      let vA: string | number = "";
      let vB: string | number = "";
      switch (sortColIndex) {
        case 0:
          vA = a.id || 0;
          vB = b.id || 0;
          break;
        case 1:
          vA = `${a.title || ""} ${a.party_name || ""}`.trim().toLowerCase();
          vB = `${b.title || ""} ${b.party_name || ""}`.trim().toLowerCase();
          break;
        case 2:
          vA = (a.type || "").toLowerCase();
          vB = (b.type || "").toLowerCase();
          break;
        case 3:
          vA = (a.warehouse || "").toLowerCase();
          vB = (b.warehouse || "").toLowerCase();
          break;
        case 4:
          vA = Number(a.quantity || 0);
          vB = Number(b.quantity || 0);
          break;
        case 5:
          vA = (a.created_by || "").toLowerCase();
          vB = (b.created_by || "").toLowerCase();
          break;
        case 6:
          vA = Number(a.sort_epoch || 0);
          vB = Number(b.sort_epoch || 0);
          break;
        default:
          return 0;
      }
      if (typeof vA === "number" && typeof vB === "number") {
        return sortDirection === "asc" ? vA - vB : vB - vA;
      }
      if (vA < vB) return sortDirection === "asc" ? -1 : 1;
      if (vA > vB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [filteredEntries, sortColIndex, sortDirection]);

  const totalEntries = sortedEntries.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / perPage));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedEntries = useMemo(() => {
    const start = (safePage - 1) * perPage;
    return sortedEntries.slice(start, start + perPage);
  }, [sortedEntries, safePage, perPage]);

  const pageNumbers = useMemo(() => {
    const pages: number[] = [];
    const maxButtons = 5;
    let start = Math.max(1, safePage - Math.floor(maxButtons / 2));
    const end = Math.min(totalPages, start + maxButtons - 1);
    if (end - start + 1 < maxButtons) {
      start = Math.max(1, end - maxButtons + 1);
    }
    for (let p = start; p <= end; p += 1) {
      pages.push(p);
    }
    return pages;
  }, [safePage, totalPages]);

  const handleExport = useCallback(
    async (format: "xlsx" | "csv") => {
      setActionMenuOpen(false);
      const XLSX = await import("xlsx");
      const rows = sortedEntries.map((entry) => ({
        ID: entry.id,
        Title: entry.title,
        "Company / Party": entry.party_name || "",
        Type: entry.type,
        Warehouse: entry.warehouse,
        Quantity: entry.quantity_display,
        "Created By": entry.created_by,
        "Transaction Date": entry.transaction_date,
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Stock Transactions");
      const safeSlug = (productName || "Product").replace(/[^a-zA-Z0-9_-]+/g, "_");
      XLSX.writeFile(wb, `${safeSlug}_Stock_Transactions.${format}`);
    },
    [sortedEntries, productName]
  );

  const startEntryNum = totalEntries === 0 ? 0 : (safePage - 1) * perPage + 1;
  const endEntryNum = totalEntries === 0 ? 0 : Math.min(safePage * perPage, totalEntries);

  return (
    <AppShell activeKey="reports-stock-transactions">
      <main className="page stock-tx-detail-page">
        {/* Top Header matching Screenshot 3: '<Product Name> Stock' + Filter + Action ▾ */}
        <div className="stock-tx-detail-header">
          <h1 className="stock-tx-detail-title">
            {productName ? `${productName} Stock` : "Product Stock"}
          </h1>

          <div className="stock-tx-detail-actions">
            <button
              type="button"
              className="stock-tx-btn-filter"
              onClick={() => setShowFilterPanel((prev) => !prev)}
              title="Filter stock transactions"
              aria-label="Filter"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
            </button>

            <div className="stock-tx-action-wrap" ref={actionWrapRef}>
              <button
                type="button"
                className="stock-tx-btn-action"
                onClick={() => setActionMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={actionMenuOpen}
              >
                <span>Action</span>
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {actionMenuOpen && (
                <div className="stock-tx-action-menu" role="menu">
                  <button
                    type="button"
                    className="stock-tx-action-item"
                    role="menuitem"
                    onClick={() => handleExport("xlsx")}
                  >
                    Export to Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    className="stock-tx-action-item"
                    role="menuitem"
                    onClick={() => handleExport("csv")}
                  >
                    Export to CSV (.csv)
                  </button>
                  <button
                    type="button"
                    className="stock-tx-action-item"
                    role="menuitem"
                    onClick={() => {
                      setActionMenuOpen(false);
                      navigate("/adjustment/addEdit");
                    }}
                  >
                    Add Stock Adjustment
                  </button>
                  <button
                    type="button"
                    className="stock-tx-action-item"
                    role="menuitem"
                    onClick={() => {
                      setActionMenuOpen(false);
                      navigate("/transfer/addEdit");
                    }}
                  >
                    Add Stock Transfer
                  </button>
                  <button
                    type="button"
                    className="stock-tx-action-item"
                    role="menuitem"
                    onClick={() => {
                      setActionMenuOpen(false);
                      navigate("/reports/stock-transactions");
                    }}
                  >
                    ← Back to Stock Transactions
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Collapsible Filter Panel */}
        {showFilterPanel && (
          <div
            className="filter-panel-card stock-filter-panel"
            data-testid="stock-tx-filter-panel"
            style={{
              background: "#ffffff",
              padding: "16px 20px",
              borderRadius: "6px",
              border: "1px solid #e2e8f0",
              marginBottom: "16px",
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
            }}
          >
            <div
              className="stock-filter-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "16px",
              }}
            >
              <div className="stock-filter-field">
                <label
                  htmlFor="stock-tx-filter-warehouse"
                  style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}
                >
                  Warehouse
                </label>
                <select
                  id="stock-tx-filter-warehouse"
                  className="stock-filter-select"
                  value={warehouseDraft}
                  onChange={(e) => setWarehouseDraft(e.target.value)}
                  style={{ width: "100%", height: "36px", borderRadius: "4px", border: "1px solid #cbd5e1", padding: "0 10px", fontSize: "13px" }}
                >
                  <option value="All">All</option>
                  {warehouseOptions.map((wh) => (
                    <option key={wh} value={wh}>
                      {wh}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stock-filter-field">
                <label
                  htmlFor="stock-tx-filter-type"
                  style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}
                >
                  Type
                </label>
                <select
                  id="stock-tx-filter-type"
                  className="stock-filter-select"
                  value={typeDraft}
                  onChange={(e) => setTypeDraft(e.target.value)}
                  style={{ width: "100%", height: "36px", borderRadius: "4px", border: "1px solid #cbd5e1", padding: "0 10px", fontSize: "13px" }}
                >
                  <option value="All">All</option>
                  {typeOptions.map((tp) => (
                    <option key={tp} value={tp}>
                      {tp}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stock-filter-field">
                <label
                  htmlFor="stock-tx-filter-from"
                  style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}
                >
                  From Date
                </label>
                <input
                  id="stock-tx-filter-from"
                  type="date"
                  value={dateFromDraft}
                  onChange={(e) => setDateFromDraft(e.target.value)}
                  style={{ width: "100%", height: "36px", borderRadius: "4px", border: "1px solid #cbd5e1", padding: "0 10px", fontSize: "13px", boxSizing: "border-box" }}
                />
              </div>

              <div className="stock-filter-field">
                <label
                  htmlFor="stock-tx-filter-to"
                  style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}
                >
                  To Date
                </label>
                <input
                  id="stock-tx-filter-to"
                  type="date"
                  value={dateToDraft}
                  onChange={(e) => setDateToDraft(e.target.value)}
                  style={{ width: "100%", height: "36px", borderRadius: "4px", border: "1px solid #cbd5e1", padding: "0 10px", fontSize: "13px", boxSizing: "border-box" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
              <button type="button" className="btn-filter-reset" onClick={handleResetFilters}>
                Reset
              </button>
              <button type="button" className="btn-filter-search" onClick={handleApplyFilters}>
                Search
              </button>
            </div>
          </div>
        )}

        {/* AVAILABLE QTY KPI Card matching Screenshot 3 */}
        <div className="stock-tx-kpi-card" data-testid="available-qty-card">
          <div className="stock-tx-kpi-label">AVAILABLE QTY</div>
          <div className="stock-tx-kpi-value" data-testid="available-qty-value">
            {formatQtyNumber(availableQty)}
          </div>
        </div>

        {/* Ledger Data Card */}
        <div className="stock-tx-ledger-card">
          <div className="stock-tx-toolbar">
            <div className="stock-tx-perpage-wrap">
              <select
                className="stock-tx-perpage-select"
                aria-label="Items per page"
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span className="stock-tx-perpage-label">Items/Page</span>
            </div>

            <input
              type="text"
              className="stock-tx-ledger-search"
              placeholder="Search..."
              aria-label="Search transactions"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>

          <div className="stock-tx-ledger-table-wrap">
            <table className="stock-tx-ledger-table">
              <thead>
                <tr>
                  <th style={{ width: "75px" }}>
                    <SortHeader
                      label="ID"
                      isSorted={sortColIndex === 0}
                      sortDirection={sortDirection}
                      onSort={() => handleHeaderSort(0)}
                    />
                  </th>
                  <th style={{ minWidth: "320px" }}>
                    <SortHeader
                      label="Title"
                      isSorted={sortColIndex === 1}
                      sortDirection={sortDirection}
                      onSort={() => handleHeaderSort(1)}
                    />
                  </th>
                  <th style={{ width: "130px" }}>
                    <SortHeader
                      label="Type"
                      isSorted={sortColIndex === 2}
                      sortDirection={sortDirection}
                      onSort={() => handleHeaderSort(2)}
                    />
                  </th>
                  <th style={{ width: "145px" }}>
                    <SortHeader
                      label="Warehouse"
                      isSorted={sortColIndex === 3}
                      sortDirection={sortDirection}
                      onSort={() => handleHeaderSort(3)}
                    />
                  </th>
                  <th style={{ width: "110px" }}>
                    <SortHeader
                      label="Quantity"
                      isSorted={sortColIndex === 4}
                      sortDirection={sortDirection}
                      onSort={() => handleHeaderSort(4)}
                    />
                  </th>
                  <th style={{ width: "155px" }}>
                    <SortHeader
                      label="Created By"
                      isSorted={sortColIndex === 5}
                      sortDirection={sortDirection}
                      onSort={() => handleHeaderSort(5)}
                    />
                  </th>
                  <th style={{ width: "175px" }}>
                    <SortHeader
                      label="Transaction Date"
                      isSorted={sortColIndex === 6}
                      sortDirection={sortDirection}
                      onSort={() => handleHeaderSort(6)}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "32px 12px", color: "#64748b" }}>
                      Loading stock transactions...
                    </td>
                  </tr>
                ) : errorMsg ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "32px 12px", color: "#dc2626" }}>
                      {errorMsg}
                    </td>
                  </tr>
                ) : paginatedEntries.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "32px 12px", color: "#64748b" }}>
                      No stock transactions found for this product.
                    </td>
                  </tr>
                ) : (
                  paginatedEntries.map((entry) => {
                    const targetRoute = resolveReferenceRoute(entry);
                    const isPositive = Number(entry.quantity || 0) >= 0;
                    const absQty = formatQtyNumber(Math.abs(Number(entry.quantity || 0)));

                    return (
                      <tr key={entry.entry_uid}>
                        <td>{entry.id}</td>
                        <td>
                          {targetRoute ? (
                            <a
                              href={targetRoute}
                              className="stock-tx-title-link"
                              onClick={(e) => {
                                e.preventDefault();
                                navigate(targetRoute);
                              }}
                            >
                              {entry.title}
                            </a>
                          ) : (
                            <span>{entry.title}</span>
                          )}
                          {entry.party_name && (
                            <strong className="stock-tx-party-bold">{entry.party_name}</strong>
                          )}
                        </td>
                        <td>
                          <span className={`stock-tx-badge ${getBadgeVariant(entry.type)}`}>
                            {entry.type}
                          </span>
                        </td>
                        <td>{entry.warehouse}</td>
                        <td className="stock-tx-qty">
                          <span className={`stock-tx-qty-sign ${isPositive ? "pos" : "neg"}`}>
                            {isPositive ? "+" : "-"}
                          </span>{" "}
                          {absQty}
                        </td>
                        <td>{entry.created_by}</td>
                        <td>{entry.transaction_date}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="stock-tx-footer">
            <div data-testid="stock-tx-showing">
              Showing {startEntryNum} To {endEntryNum} Of {totalEntries} Entries
            </div>

            <div className="stock-tx-pager" role="navigation" aria-label="Pagination">
              <button
                type="button"
                className="stock-tx-page-btn"
                disabled={safePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              {pageNumbers.map((pageNum) => (
                <button
                  key={pageNum}
                  type="button"
                  className={`stock-tx-page-btn ${pageNum === safePage ? "active" : ""}`}
                  onClick={() => setCurrentPage(pageNum)}
                >
                  {pageNum}
                </button>
              ))}
              <button
                type="button"
                className="stock-tx-page-btn"
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
