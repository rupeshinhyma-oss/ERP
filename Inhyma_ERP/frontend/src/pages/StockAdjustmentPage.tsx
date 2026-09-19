import { useState, useMemo, useCallback, useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { SideDrawer, DetailFieldGrid } from "@/components/SideDrawer";
import { DateRangePicker } from "@/components/DateRangePicker";
import { generateStockAdjustmentPdf } from "@/lib/stockAdjustmentPdf";
import "@/styles/stockAdjustment.css";

export interface StockAdjustmentLineItem {
  product_name: string;
  product_code?: string;
  category?: string;
  hsn_code?: string;
  gst_rate?: string;
  qty: number;
  uom: string;
  rate: number;
  amount: number;
}

export interface StockAdjustmentItem {
  id: string;
  adjustment_no?: string;
  adjustment_date: string;
  client_name?: string;
  invoice_no?: string;
  warehouse: string;
  type: "Stock IN" | "Stock OUT";
  purpose: "Return From Client" | "Split" | "Damage" | "Return from client";
  total_amount: number;
  created_by: string;
  created_at?: string;
  remarks?: string;
  items?: StockAdjustmentLineItem[];
}

export const INITIAL_ADJUSTMENTS: StockAdjustmentItem[] = [
  {
    id: "adj-1",
    adjustment_no: "492",
    adjustment_date: "19-09-2026",
    client_name: "GARUDA ENGINEERS",
    invoice_no: "660/26-27",
    warehouse: "Ahmedabad",
    type: "Stock IN",
    purpose: "Return From Client",
    total_amount: 275000,
    created_by: "Akshata Wadekar",
    created_at: "19-09-2026",
    remarks: "Party required another machine, but salesperson give the other machine",
    items: [
      {
        product_name: "ISL450XDAN Flow Wrap machine w/o end seal chain",
        product_code: "MACH-002",
        category: "Machines",
        hsn_code: "84224000",
        gst_rate: "18%",
        qty: 1,
        uom: "SET",
        rate: 275000,
        amount: 275000,
      },
    ],
  },
  {
    id: "adj-2",
    adjustment_date: "18-09-2026",
    client_name: "",
    invoice_no: "",
    warehouse: "Ahmedabad",
    type: "Stock IN",
    purpose: "Split",
    total_amount: 61250,
    created_by: "Akshata Wadekar",
    remarks: "Stock inward from split batch 09-AHM",
    items: [
      {
        product_name: "XLSG36100 Capping Machine Spares",
        product_code: "SPR-003",
        category: "Spares",
        hsn_code: "84229090",
        gst_rate: "18%",
        qty: 5,
        uom: "PCS",
        rate: 12250,
        amount: 61250,
      },
    ],
  },
  {
    id: "adj-3",
    adjustment_date: "18-09-2026",
    client_name: "",
    invoice_no: "",
    warehouse: "Ahmedabad",
    type: "Stock OUT",
    purpose: "Split",
    total_amount: 61250,
    created_by: "Akshata Wadekar",
    remarks: "Stock outward to component sub-assemblies",
    items: [
      {
        product_name: "XLSG36100 Assembly Unit",
        product_code: "ASSM-003",
        category: "Machines",
        hsn_code: "84223000",
        gst_rate: "18%",
        qty: 1,
        uom: "SET",
        rate: 61250,
        amount: 61250,
      },
    ],
  },
  {
    id: "adj-4",
    adjustment_date: "17-09-2026",
    client_name: "",
    invoice_no: "",
    warehouse: "Mumbai",
    type: "Stock IN",
    purpose: "Split",
    total_amount: 10708,
    created_by: "Akshata Wadekar",
    remarks: "Inward adjustment split across spare kits",
    items: [
      {
        product_name: "Sensor (Banding)",
        product_code: "SEN-001",
        category: "Spares",
        hsn_code: "84229090",
        gst_rate: "18%",
        qty: 2,
        uom: "PCS",
        rate: 5354,
        amount: 10708,
      },
    ],
  },
  {
    id: "adj-5",
    adjustment_date: "17-09-2026",
    client_name: "",
    invoice_no: "",
    warehouse: "Mumbai",
    type: "Stock OUT",
    purpose: "Damage",
    total_amount: 225000,
    created_by: "Akshata Wadekar",
    remarks: "Transit handling damage write-off",
    items: [
      {
        product_name: "Automatic Tube Filling & Sealing Machine",
        product_code: "MACH-004",
        category: "Machines",
        hsn_code: "84223000",
        gst_rate: "18%",
        qty: 1,
        uom: "SET",
        rate: 225000,
        amount: 225000,
      },
    ],
  },
  {
    id: "adj-6",
    adjustment_date: "17-09-2026",
    client_name: "",
    invoice_no: "",
    warehouse: "Mumbai",
    type: "Stock IN",
    purpose: "Split",
    total_amount: 73500,
    created_by: "Akshata Wadekar",
    remarks: "Repackaging modular station kits",
    items: [
      {
        product_name: "Cup Filler 16LTR Component Kit",
        product_code: "SPR-006",
        category: "Spares",
        hsn_code: "84229090",
        gst_rate: "18%",
        qty: 3,
        uom: "SET",
        rate: 24500,
        amount: 73500,
      },
    ],
  },
  {
    id: "adj-7",
    adjustment_date: "17-09-2026",
    client_name: "",
    invoice_no: "",
    warehouse: "Mumbai",
    type: "Stock OUT",
    purpose: "Split",
    total_amount: 73500,
    created_by: "Akshata Wadekar",
    remarks: "Outward adjustment split for packaging conversion",
    items: [
      {
        product_name: "AF1000T Sub-assembly Module",
        product_code: "ASSM-007",
        category: "Machines",
        hsn_code: "84223000",
        gst_rate: "18%",
        qty: 1,
        uom: "SET",
        rate: 73500,
        amount: 73500,
      },
    ],
  },
  {
    id: "adj-8",
    adjustment_date: "15-09-2026",
    client_name: "SLEXO PACKAGING",
    invoice_no: "3288/26-27",
    warehouse: "Mumbai",
    type: "Stock IN",
    purpose: "Return From Client",
    total_amount: 26000,
    created_by: "Akshata Wadekar",
    remarks: "Return from customer demo consignment",
    items: [
      {
        product_name: "Sensor (Banding) & Heating Elements",
        product_code: "SEN-001B",
        category: "Spares",
        hsn_code: "84229090",
        gst_rate: "18%",
        qty: 4,
        uom: "PCS",
        rate: 6500,
        amount: 26000,
      },
    ],
  },
  {
    id: "adj-9",
    adjustment_date: "15-09-2026",
    client_name: "",
    invoice_no: "",
    warehouse: "Ahmedabad",
    type: "Stock IN",
    purpose: "Split",
    total_amount: 105000,
    created_by: "Akshata Wadekar",
    remarks: "Stock inward split for packaging sub-assembly",
    items: [
      {
        product_name: "Packaging Line Conveyor Belt & Assembly",
        product_code: "CONV-001",
        category: "Machines",
        hsn_code: "84223000",
        gst_rate: "18%",
        qty: 1,
        uom: "SET",
        rate: 105000,
        amount: 105000,
      },
    ],
  },
  {
    id: "adj-10",
    adjustment_date: "15-09-2026",
    client_name: "",
    invoice_no: "",
    warehouse: "Ahmedabad",
    type: "Stock OUT",
    purpose: "Split",
    total_amount: 105000,
    created_by: "Akshata Wadekar",
    remarks: "Stock outward split for assembly transfer",
    items: [
      {
        product_name: "Packaging Line Conveyor Belt & Assembly",
        product_code: "CONV-001",
        category: "Machines",
        hsn_code: "84223000",
        gst_rate: "18%",
        qty: 1,
        uom: "SET",
        rate: 105000,
        amount: 105000,
      },
    ],
  },
  {
    id: "adj-11",
    adjustment_date: "12-09-2026",
    client_name: "",
    invoice_no: "",
    warehouse: "Mumbai",
    type: "Stock OUT",
    purpose: "Damage",
    total_amount: 347349,
    created_by: "Akshata Wadekar",
    remarks: "Damaged during transit inspection",
    items: [
      {
        product_name: "Automatic Liquid Nitrogen Dosing System",
        product_code: "DOS-002",
        category: "Machines",
        hsn_code: "84224000",
        gst_rate: "18%",
        qty: 1,
        uom: "SET",
        rate: 347349,
        amount: 347349,
      },
    ],
  },
];

// Helper to format Indian currency
function formatIndianCurrency(amount: number): string {
  return "₹ " + amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function StockAdjustmentPage() {
  const [items, setItems] = useState<StockAdjustmentItem[]>(INITIAL_ADJUSTMENTS);
  const [searchTerm, setSearchTerm] = useState("");

  // Collapsible inline filter panel (off by default until clicked)
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  // Filter input draft states
  const [dateRangeFilter, setDateRangeFilter] = useState("08/21/2026 - 09/19/2026");
  const [typeFilter, setTypeFilter] = useState("All");
  const [purposeFilter, setPurposeFilter] = useState("All");
  const [warehouseFilter, setWarehouseFilter] = useState("All");

  // Applied filter states
  const [appliedDateRange, setAppliedDateRange] = useState("08/21/2026 - 09/19/2026");
  const [appliedType, setAppliedType] = useState("All");
  const [appliedPurpose, setAppliedPurpose] = useState("All");
  const [appliedWarehouse, setAppliedWarehouse] = useState("All");

  // Per page items
  const [perPage, setPerPage] = useState<number>(50);

  // Add New Dropdown state
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Active drawer item for viewing details
  const [activeItem, setActiveItem] = useState<StockAdjustmentItem | null>(null);

  // Action dropdown menu state (opened for specific item id)
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  // Close action dropdown menu on outside click
  useEffect(() => {
    function handleDocClick() {
      setOpenActionMenuId(null);
    }
    if (openActionMenuId) {
      document.addEventListener("click", handleDocClick);
    }
    return () => {
      document.removeEventListener("click", handleDocClick);
    };
  }, [openActionMenuId]);

  // Handle item deletion
  const handleDeleteItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // Handle item download: creates PDF document matching template
  const handleDownloadItem = useCallback((item: StockAdjustmentItem) => {
    generateStockAdjustmentPdf(item, { saveFile: true, openInNewTab: true });
  }, []);

  // Add New Adjustment modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newType, setNewType] = useState<"Stock IN" | "Stock OUT">("Stock IN");
  const [newWarehouse, setNewWarehouse] = useState("Mumbai");
  const [newPurpose, setNewPurpose] = useState<"Return From Client" | "Split" | "Damage">("Return From Client");
  const [newClientName, setNewClientName] = useState("");
  const [newInvoiceNo, setNewInvoiceNo] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [newCategory, setNewCategory] = useState("Machines");
  const [newHsn, setNewHsn] = useState("84224000");
  const [newGst, setNewGst] = useState("18%");
  const [newQty, setNewQty] = useState<number>(1);
  const [newRate, setNewRate] = useState<number>(50000);

  // Handle filter submission
  const handleApplyFilters = useCallback(() => {
    setAppliedDateRange(dateRangeFilter);
    setAppliedType(typeFilter);
    setAppliedPurpose(purposeFilter);
    setAppliedWarehouse(warehouseFilter);
  }, [dateRangeFilter, typeFilter, purposeFilter, warehouseFilter]);

  // Handle filter reset
  const handleResetFilters = useCallback(() => {
    setDateRangeFilter("08/21/2026 - 09/19/2026");
    setTypeFilter("All");
    setPurposeFilter("All");
    setWarehouseFilter("All");
    setAppliedDateRange("08/21/2026 - 09/19/2026");
    setAppliedType("All");
    setAppliedPurpose("All");
    setAppliedWarehouse("All");
  }, []);

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Live search input
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim();
        const matchClient = item.client_name?.toLowerCase().includes(query) ?? false;
        const matchInvoice = item.invoice_no?.toLowerCase().includes(query) ?? false;
        const matchWarehouse = item.warehouse.toLowerCase().includes(query);
        const matchPurpose = item.purpose.toLowerCase().includes(query);
        const matchType = item.type.toLowerCase().includes(query);
        const matchCreated = item.created_by.toLowerCase().includes(query);
        const matchItemName = item.items?.some((i) => i.product_name.toLowerCase().includes(query)) ?? false;
        if (!matchClient && !matchInvoice && !matchWarehouse && !matchPurpose && !matchType && !matchCreated && !matchItemName) {
          return false;
        }
      }

      // Applied Date Range
      if (appliedDateRange && appliedDateRange.includes("-")) {
        const [sStr, eStr] = appliedDateRange.split("-").map((s) => s.trim());
        const [sm, sd, sy] = sStr.split("/").map((n) => parseInt(n, 10));
        const [em, ed, ey] = eStr.split("/").map((n) => parseInt(n, 10));
        if (!isNaN(sm) && !isNaN(sd) && !isNaN(sy) && !isNaN(em) && !isNaN(ed) && !isNaN(ey)) {
          const startDate = new Date(sy, sm - 1, sd, 0, 0, 0);
          const endDate = new Date(ey, em - 1, ed, 23, 59, 59);
          const itemParts = item.adjustment_date.split("-").map((n) => parseInt(n, 10));
          if (itemParts.length === 3) {
            const itemDate = new Date(itemParts[2], itemParts[1] - 1, itemParts[0], 12, 0, 0);
            if (itemDate < startDate || itemDate > endDate) {
              return false;
            }
          }
        }
      }

      // Applied Type
      if (appliedType !== "All" && item.type !== appliedType) {
        return false;
      }

      // Applied Purpose
      if (appliedPurpose !== "All" && item.purpose !== appliedPurpose) {
        return false;
      }

      // Applied Warehouse
      if (appliedWarehouse !== "All" && item.warehouse !== appliedWarehouse) {
        return false;
      }

      return true;
    });
  }, [items, searchTerm, appliedDateRange, appliedType, appliedPurpose, appliedWarehouse]);

  // Active filter badge count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (appliedDateRange !== "08/21/2026 - 09/19/2026" && appliedDateRange !== "") count++;
    if (appliedType !== "All") count++;
    if (appliedPurpose !== "All") count++;
    if (appliedWarehouse !== "All") count++;
    return count;
  }, [appliedDateRange, appliedType, appliedPurpose, appliedWarehouse]);

  // Handle saving new adjustment
  const handleCreateAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    const totalAmount = newQty * newRate;
    const now = new Date();
    const formattedDate = `${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()}`;

    const newRecord: StockAdjustmentItem = {
      id: `adj-${Date.now()}`,
      adjustment_date: formattedDate,
      created_at: formattedDate,
      client_name: newClientName.trim() || undefined,
      invoice_no: newInvoiceNo.trim() || undefined,
      warehouse: newWarehouse,
      type: newType,
      purpose: newPurpose,
      total_amount: totalAmount,
      created_by: "Admin User",
      items: [
        {
          product_name: newProductName.trim() || "Packaging Machine Component",
          product_code: "ADJ-NEW",
          category: newCategory,
          hsn_code: newHsn,
          gst_rate: newGst,
          qty: Number(newQty),
          uom: "SET",
          rate: Number(newRate),
          amount: totalAmount,
        },
      ],
    };

    setItems((prev) => [newRecord, ...prev]);
    setShowAddModal(false);
    // Reset form
    setNewClientName("");
    setNewInvoiceNo("");
    setNewProductName("");
    setNewQty(1);
    setNewRate(50000);
  };

  return (
    <AppShell activeKey="stock-adjustment">
      <div className="page-stock-adjustment">
        {/* Top Header */}
        <div className="adjustment-header">
          <h1 className="adjustment-header-title">Stock Adjustment</h1>

          <div className="adjustment-header-actions">
            {/* Filter Toggle Button */}
            <button
              type="button"
              className={`adjustment-btn-filter ${showFilterPanel ? "active" : ""}`}
              onClick={() => setShowFilterPanel((prev) => !prev)}
              title="Filter stock adjustments"
              aria-label="Filter"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              {activeFilterCount > 0 && <span className="adjustment-filter-badge">{activeFilterCount}</span>}
            </button>

            {/* Add New Button with dropdown */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="adjustment-btn-add"
                onClick={() => setShowAddMenu((prev) => !prev)}
              >
                Add New
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {showAddMenu && (
                <div className="add-menu-dropdown">
                  <button
                    type="button"
                    className="add-menu-item"
                    onClick={() => {
                      setNewType("Stock IN");
                      setShowAddMenu(false);
                      setShowAddModal(true);
                    }}
                  >
                    <span className="badge-stock-in" style={{ padding: "1px 6px", fontSize: "10px" }}>IN</span>
                    Stock IN Adjustment
                  </button>
                  <button
                    type="button"
                    className="add-menu-item"
                    onClick={() => {
                      setNewType("Stock OUT");
                      setShowAddMenu(false);
                      setShowAddModal(true);
                    }}
                  >
                    <span className="badge-stock-out" style={{ padding: "1px 6px", fontSize: "10px" }}>OUT</span>
                    Stock OUT Adjustment
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Collapsible Filter Panel - off by default until clicked */}
        {showFilterPanel && (
          <div className="adjustment-filter-panel" data-testid="adjustment-filter-panel">
            <div className="adjustment-filter-grid">
              <div className="adjustment-filter-field">
                <label htmlFor="filter-adjustment-date">Adjustment Date Range</label>
                <DateRangePicker
                  id="filter-adjustment-date"
                  value={dateRangeFilter}
                  onChange={(val) => setDateRangeFilter(val)}
                  onApply={(val) => {
                    setDateRangeFilter(val);
                    setAppliedDateRange(val);
                  }}
                />
              </div>

              <div className="adjustment-filter-field">
                <label htmlFor="filter-adjustment-type">Adjustment Type</label>
                <select
                  id="filter-adjustment-type"
                  className="adjustment-filter-select"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                >
                  <option value="All">All</option>
                  <option value="Stock IN">Stock IN</option>
                  <option value="Stock OUT">Stock OUT</option>
                </select>
              </div>

              <div className="adjustment-filter-field">
                <label htmlFor="filter-adjustment-purpose">Purpose</label>
                <select
                  id="filter-adjustment-purpose"
                  className="adjustment-filter-select"
                  value={purposeFilter}
                  onChange={(e) => setPurposeFilter(e.target.value)}
                >
                  <option value="All">All</option>
                  <option value="Return From Client">Return From Client</option>
                  <option value="Split">Split</option>
                  <option value="Damage">Damage</option>
                </select>
              </div>

              <div className="adjustment-filter-field">
                <label htmlFor="filter-adjustment-warehouse">Warehouse</label>
                <select
                  id="filter-adjustment-warehouse"
                  className="adjustment-filter-select"
                  value={warehouseFilter}
                  onChange={(e) => setWarehouseFilter(e.target.value)}
                >
                  <option value="All">All</option>
                  <option value="Ahmedabad">Ahmedabad</option>
                  <option value="Mumbai">Mumbai</option>
                  <option value="Indore">Indore</option>
                </select>
              </div>
            </div>

            <div className="adjustment-filter-actions">
              <button
                type="button"
                className="adjustment-btn-reset"
                onClick={handleResetFilters}
              >
                Reset
              </button>
              <button
                type="button"
                className="adjustment-btn-search"
                onClick={handleApplyFilters}
              >
                Search
              </button>
            </div>
          </div>
        )}

        {/* Control Bar: Items Per Page + Live Search */}
        <div className="adjustment-control-bar">
          <div className="adjustment-per-page">
            <select
              className="adjustment-per-page-select"
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value))}
              aria-label="Items per page"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span>Items/Page</span>
          </div>

          <div className="adjustment-search-wrap">
            <input
              type="text"
              className="adjustment-search-input"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Table Card */}
        <div className="adjustment-table-card">
          <div className="adjustment-table-wrap">
            <table className="adjustment-table">
              <thead>
                <tr>
                  <th className="sortable">
                    Adjustment Date <span className="sort-icon">⇅</span>
                  </th>
                  <th className="sortable">
                    Client / Inv. No. <span className="sort-icon">⇅</span>
                  </th>
                  <th className="sortable">
                    Warehouse <span className="sort-icon">⇅</span>
                  </th>
                  <th>Type</th>
                  <th className="sortable">
                    Purpose <span className="sort-icon">⇅</span>
                  </th>
                  <th className="sortable" style={{ textAlign: "right" }}>
                    Total <span className="sort-icon">⇅</span>
                  </th>
                  <th>Created By</th>
                  <th style={{ textAlign: "center", width: "60px" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                      No stock adjustment records found.
                    </td>
                  </tr>
                ) : (
                  filteredItems.slice(0, perPage).map((item) => (
                    <tr
                      key={item.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => setActiveItem(item)}
                    >
                      <td>{item.adjustment_date}</td>
                      <td>
                        {item.client_name ? (
                          <div>
                            <span className="client-name">{item.client_name}</span>
                            {item.invoice_no && <span className="invoice-no">{item.invoice_no}</span>}
                          </div>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </td>
                      <td>{item.warehouse}</td>
                      <td>
                        {item.type === "Stock IN" ? (
                          <span className="badge-stock-in">Stock IN</span>
                        ) : (
                          <span className="badge-stock-out">Stock OUT</span>
                        )}
                      </td>
                      <td>{item.purpose}</td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: "#0f172a" }}>
                        {formatIndianCurrency(item.total_amount)}
                      </td>
                      <td>{item.created_by}</td>
                      <td className="adjustment-action-cell" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className={`adjustment-action-btn ${openActionMenuId === item.id ? "active" : ""}`}
                          title="Actions"
                          aria-label="Actions"
                          aria-expanded={openActionMenuId === item.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenActionMenuId((prev) => (prev === item.id ? null : item.id));
                          }}
                        >
                          ⋮
                        </button>

                        {openActionMenuId === item.id && (
                          <div className="adjustment-action-menu" data-testid={`action-menu-${item.id}`}>
                            <button
                              type="button"
                              className="adjustment-action-item"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteItem(item.id);
                                setOpenActionMenuId(null);
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                              <span>Delete</span>
                            </button>
                            <button
                              type="button"
                              className="adjustment-action-item"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownloadItem(item);
                                setOpenActionMenuId(null);
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                              <span>Download</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="adjustment-footer-bar">
            <span>
              Showing <strong>{Math.min(filteredItems.length, perPage)}</strong> of{" "}
              <strong>{filteredItems.length}</strong> adjustments
            </span>
          </div>
        </div>

        {/* Details SideDrawer */}
        <SideDrawer
          open={Boolean(activeItem)}
          onClose={() => setActiveItem(null)}
          title="Stock Adjustment Details"
          subtitle={activeItem ? `${activeItem.warehouse} • ${activeItem.type} • ${activeItem.adjustment_date}` : ""}
          maxWidth="min(1050px, 96vw)"
          className="stock-adjustment-drawer"
        >
          {activeItem && (
            <div>
              <DetailFieldGrid
                fields={[
                  { label: "Client Name", value: activeItem.client_name || "—" },
                  { label: "Warehouse", value: activeItem.warehouse },
                  { label: "Invoice No.", value: activeItem.invoice_no || "—" },
                  { label: "Adjustment Type", value: activeItem.type },
                  { label: "Date", value: activeItem.adjustment_date },
                  { label: "Purpose", value: activeItem.purpose },
                  { label: "Created By", value: activeItem.created_by },
                  { label: "Created At", value: activeItem.created_at || activeItem.adjustment_date },
                  { label: "Total Amount", value: formatIndianCurrency(activeItem.total_amount) },
                ]}
              />

              {/* Items Breakdown with Category, HSN, and GST */}
              <h4 style={{ margin: "22px 0 10px", fontSize: "14px", fontWeight: 700, color: "#1e293b" }}>
                Adjusted Items Breakdown
              </h4>
              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  overflowX: "auto",
                  marginBottom: "16px",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
                  backgroundColor: "#ffffff",
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px", minWidth: "850px" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                      <th style={{ padding: "10px 12px", textAlign: "center", width: "55px", color: "#475569", fontWeight: 700 }}>Sr No.</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", color: "#475569", fontWeight: 700 }}>Item(S)</th>
                      <th style={{ padding: "10px 12px", textAlign: "center", width: "100px", color: "#475569", fontWeight: 700 }}>Category</th>
                      <th style={{ padding: "10px 12px", textAlign: "center", width: "90px", color: "#475569", fontWeight: 700 }}>HSN</th>
                      <th style={{ padding: "10px 12px", textAlign: "center", width: "75px", color: "#475569", fontWeight: 700 }}>GST</th>
                      <th style={{ padding: "10px 12px", textAlign: "center", width: "95px", color: "#475569", fontWeight: 700 }}>Quantity</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", width: "130px", color: "#475569", fontWeight: 700 }}>Unit Price</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", width: "140px", color: "#475569", fontWeight: 700 }}>Total Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeItem.items && activeItem.items.length > 0 ? (
                      activeItem.items.map((line, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "10px 12px", textAlign: "center", color: "#64748b" }}>{idx + 1}</td>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ fontWeight: 600, color: "#1e293b" }}>{line.product_name}</div>
                            {line.product_code && (
                              <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                                SKU: {line.product_code}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center" }}>
                            <span style={{ display: "inline-block", padding: "2px 8px", background: "#f1f5f9", borderRadius: "12px", fontSize: "11.5px", color: "#475569", fontWeight: 500 }}>
                              {line.category || "Machines"}
                            </span>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center", fontFamily: "monospace", fontSize: "12px", color: "#475569" }}>
                            {line.hsn_code || "84224000"}
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 600, color: "#2563eb" }}>
                            {line.gst_rate || "18%"}
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 600, color: "#0f172a" }}>
                            {line.qty} {line.uom}
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "#334155" }}>
                            {formatIndianCurrency(line.rate)}
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                            {formatIndianCurrency(line.amount)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={8} style={{ padding: "18px", textAlign: "center", color: "#94a3b8" }}>
                          No line items recorded.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {activeItem.items && activeItem.items.length > 0 && (
                    <tfoot>
                      <tr style={{ background: "#e2e8f0", borderTop: "2px solid #cbd5e1" }}>
                        <td colSpan={7} style={{ padding: "11px 16px", textAlign: "right", fontWeight: 700, fontSize: "13px", color: "#1e293b" }}>
                          Grand Total
                        </td>
                        <td style={{ padding: "11px 16px", textAlign: "right", fontWeight: 700, fontSize: "14px", color: "#15803d", whiteSpace: "nowrap" }}>
                          {formatIndianCurrency(activeItem.total_amount)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Remarks Box positioned below table matching Screenshot 1 */}
              {activeItem.remarks && (
                <div
                  style={{
                    padding: "12px 16px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                    backgroundColor: "#f8fafc",
                    fontSize: "13px",
                    color: "#334155",
                    lineHeight: 1.5,
                  }}
                >
                  <strong style={{ color: "#1e293b" }}>Remarks: </strong>
                  {activeItem.remarks}
                </div>
              )}
            </div>
          )}
        </SideDrawer>

        {/* Modal: Add New Stock Adjustment */}
        {showAddModal && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15, 23, 42, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: "20px",
            }}
            onClick={() => setShowAddModal(false)}
          >
            <div
              style={{
                background: "#ffffff",
                borderRadius: "10px",
                width: "100%",
                maxWidth: "560px",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
                overflow: "hidden",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  padding: "16px 20px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#1e293b" }}>
                  New {newType} Adjustment
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: "#94a3b8" }}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateAdjustment} style={{ padding: "20px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                      Adjustment Type
                    </label>
                    <select
                      value={newType}
                      onChange={(e) => setNewType(e.target.value as "Stock IN" | "Stock OUT")}
                      className="adjustment-filter-select"
                    >
                      <option value="Stock IN">Stock IN</option>
                      <option value="Stock OUT">Stock OUT</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                      Warehouse
                    </label>
                    <select
                      value={newWarehouse}
                      onChange={(e) => setNewWarehouse(e.target.value)}
                      className="adjustment-filter-select"
                    >
                      <option value="Ahmedabad">Ahmedabad</option>
                      <option value="Mumbai">Mumbai</option>
                      <option value="Indore">Indore</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                      Purpose
                    </label>
                    <select
                      value={newPurpose}
                      onChange={(e) => setNewPurpose(e.target.value as "Return From Client" | "Split" | "Damage")}
                      className="adjustment-filter-select"
                    >
                      <option value="Return From Client">Return From Client</option>
                      <option value="Split">Split</option>
                      <option value="Damage">Damage</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                      Client Name (Optional)
                    </label>
                    <input
                      type="text"
                      className="adjustment-filter-input"
                      placeholder="e.g. GARUDA ENGINEERS"
                      value={newClientName}
                      onChange={(e) => setNewClientName(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: "14px" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                    Invoice / Reference No. (Optional)
                  </label>
                  <input
                    type="text"
                    className="adjustment-filter-input"
                    placeholder="e.g. 660/26-27"
                    value={newInvoiceNo}
                    onChange={(e) => setNewInvoiceNo(e.target.value)}
                  />
                </div>

                <div style={{ marginBottom: "14px" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                    Product Name
                  </label>
                  <input
                    type="text"
                    className="adjustment-filter-input"
                    placeholder="e.g. ISL250 Rotary PFS 8 Head With Zipper"
                    required
                    value={newProductName}
                    onChange={(e) => setNewProductName(e.target.value)}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                      Category
                    </label>
                    <select
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      className="adjustment-filter-select"
                    >
                      <option value="Machines">Machines</option>
                      <option value="Spares">Spares</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                      HSN
                    </label>
                    <input
                      type="text"
                      className="adjustment-filter-input"
                      value={newHsn}
                      onChange={(e) => setNewHsn(e.target.value)}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                      GST
                    </label>
                    <input
                      type="text"
                      className="adjustment-filter-input"
                      value={newGst}
                      onChange={(e) => setNewGst(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "18px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                      Quantity
                    </label>
                    <input
                      type="number"
                      min={1}
                      className="adjustment-filter-input"
                      value={newQty}
                      onChange={(e) => setNewQty(Number(e.target.value))}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                      Rate (₹)
                    </label>
                    <input
                      type="number"
                      min={0}
                      className="adjustment-filter-input"
                      value={newRate}
                      onChange={(e) => setNewRate(Number(e.target.value))}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    style={{
                      padding: "8px 16px",
                      border: "1px solid #cbd5e1",
                      background: "#ffffff",
                      borderRadius: "6px",
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
                    style={{
                      padding: "8px 20px",
                      border: "none",
                      background: "#f59e0b",
                      borderRadius: "6px",
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "#ffffff",
                      cursor: "pointer",
                    }}
                  >
                    Create Adjustment
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default StockAdjustmentPage;
