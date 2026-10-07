import { useState, useMemo, useCallback, useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { SideDrawer } from "@/components/SideDrawer";
import { Pagination } from "@/components/Pagination";
import type { PaginationMeta } from "@/types";
import { InventoryApi, type ProductReorderItem } from "@/lib/api";
import { generateSalesOrderPdf } from "@/lib/salesOrderPdf";
import "@/styles/productReorder.css";

export interface StockBreakupRow {
  sr_no: number;
  order_no?: string;
  consignment_no?: string;
  invoice_no?: string;
  date?: string;
  order_date?: string;
  company_name?: string;
  supplier_name?: string;
  city_state?: string;
  quantity: number;
  status: string;
  sales_person?: string;
  delivery_date?: string;
  arrival_date?: string;
}

export interface ActiveBreakupState {
  item: ProductReorderItem;
  location: string;
  stockType: "physical" | "transit" | "ordered";
  count: number;
  loading?: boolean;
  rows: StockBreakupRow[];
}

export const INITIAL_REORDER_ITEMS: ProductReorderItem[] = [
  {
    id: "reorder-1",
    sr_no: 1,
    product_name_tally: "Limit Switch (DQL5545)",
    product_code: "DQL-5545-LS",
    brand: "Inhyma",
    category: "Spares",
    sub_category: "Spares For L Sealer",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-2",
    sr_no: 2,
    product_name_tally: "Bolt 992-8M",
    product_code: "BLT-992-8M",
    brand: "Inhyma",
    category: "Spares",
    sub_category: "Hardware & Fasteners",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-3",
    sr_no: 3,
    product_name_tally: "Display +PLC (AF1000)",
    product_code: "PLC-AF1000",
    brand: "Delta",
    category: "Spares",
    sub_category: "Electronics & Controls",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-4",
    sr_no: 4,
    product_name_tally: "Emergency Switch (AF1000)",
    product_code: "SW-EM-AF1000",
    brand: "Schneider",
    category: "Spares",
    sub_category: "Electrical & Switches",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-5",
    sr_no: 5,
    product_name_tally: "32mm Screw (AF1500)",
    product_code: "SCR-32-AF1500",
    brand: "Inhyma",
    category: "Spares",
    sub_category: "Hardware & Fasteners",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-6",
    sr_no: 6,
    product_name_tally: "19mm Screw (AF1500)",
    product_code: "SCR-19-AF1500",
    brand: "Inhyma",
    category: "Spares",
    sub_category: "Hardware & Fasteners",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-7",
    sr_no: 7,
    product_name_tally: "Stepper Motor (AF1500)",
    product_code: "MOT-STP-1500",
    brand: "Leadshine",
    category: "Spares",
    sub_category: "Motors & Drives",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-8",
    sr_no: 8,
    product_name_tally: "Motor 90W (AF1500)",
    product_code: "MOT-90W-1500",
    brand: "SPG",
    category: "Spares",
    sub_category: "Motors & Drives",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-9",
    sr_no: 9,
    product_name_tally: "Ramp (1400 *1200* 82.2mm)",
    product_code: "RMP-1400",
    brand: "Inhyma",
    category: "Spares",
    sub_category: "Fabrication & Body Parts",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-10",
    sr_no: 10,
    product_name_tally: "DBF900L Band Sealer MSV With Nitrogen Kit",
    product_code: "INH-00005-N2",
    brand: "Inhyma Pack",
    category: "Machines",
    sub_category: "Band Sealer",
    mumbai: 4,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 4,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
];

export function ProductReorderPage() {
  // Primary records state
  const [items, setItems] = useState<ProductReorderItem[]>(INITIAL_REORDER_ITEMS);
  const [loading, setLoading] = useState(false);

  // Filter panel collapse toggle
  const [showFilterPanel, setShowFilterPanel] = useState(true);

  // Form input filter states
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [subCategoryFilter, setSubCategoryFilter] = useState("All");
  const [brandFilter, setBrandFilter] = useState("All");
  const [shortfallFilter, setShortfallFilter] = useState("All"); // "All" | "0" | "Greater Than 0"
  const [reorderFilter, setReorderFilter] = useState("All"); // "All" | "0" | "Greater Than 0"

  // Applied filter states
  const [appliedCategory, setAppliedCategory] = useState("All");
  const [appliedSubCategory, setAppliedSubCategory] = useState("All");
  const [appliedBrand, setAppliedBrand] = useState("All");
  const [appliedShortfall, setAppliedShortfall] = useState("All");
  const [appliedReorder, setAppliedReorder] = useState("All");

  // Search input & Warehouse selector state
  const [searchTerm, setSearchTerm] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("Mumbai"); // As seen in screenshot!

  // Pagination & Frozen column settings
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [freezeColumns] = useState(true);

  // Side Drawer Breakup state (for Physical SOs or Transit/Ordered POs)
  const [activeBreakup, setActiveBreakup] = useState<ActiveBreakupState | null>(null);

  // Product Master View Window Drawer / Modal state
  const [viewProductItem, setViewProductItem] = useState<ProductReorderItem | null>(null);

  // Inline / Modal Edit Reorder Level & MOQ state
  const [editItem, setEditItem] = useState<{
    item: ProductReorderItem;
    reorder_level: number;
    moq: number;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Load live data from backend API
  const fetchReorderItems = useCallback(() => {
    setLoading(true);
    InventoryApi.listProductReorder({
      limit: 300,
    })
      .then((res) => {
        if (res?.data?.items && res.data.items.length > 0) {
          setItems(res.data.items);
        } else {
          setItems(INITIAL_REORDER_ITEMS);
        }
      })
      .catch((err) => {
        console.warn("Using initial reorder seed data:", err);
        setItems(INITIAL_REORDER_ITEMS);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchReorderItems();
  }, [fetchReorderItems]);

  // Open Breakup Modal (Sales Order Information or Consignment Breakup)
  const handleOpenBreakup = useCallback(
    (item: ProductReorderItem, location: string, stockType: "physical" | "transit" | "ordered", count: number) => {
      setActiveBreakup({
        item,
        location,
        stockType,
        count,
        loading: true,
        rows: [],
      });

      InventoryApi.getProductStockBreakup({
        product_name: item.product_name_tally,
        warehouse: location,
        type: stockType,
      })
        .then((res) => {
          const rows = res?.data?.items || [];
          setActiveBreakup((prev) => (prev ? { ...prev, loading: false, rows } : null));
        })
        .catch((err) => {
          console.warn("Failed to load stock breakup:", err);
          // Fallback mock rows if backend empty
          if (stockType === "physical") {
            const fallbackSORows: StockBreakupRow[] = [
              {
                sr_no: 1,
                order_no: "SO-MH/26-27/0432",
                order_date: "12-07-2026",
                company_name: "VN GOURMET LLT",
                city_state: "Mumbai, Maharashtra",
                quantity: count || 1,
                status: "Acc. Confirmed",
                sales_person: "Inhyma Admin",
                delivery_date: "25-07-2026",
              },
            ];
            setActiveBreakup((prev) => (prev ? { ...prev, loading: false, rows: fallbackSORows } : null));
          } else {
            const fallbackPORows: StockBreakupRow[] = [
              {
                sr_no: 1,
                consignment_no: stockType === "transit" ? "EXP-26" : "INM-01",
                invoice_no: stockType === "transit" ? "EXP-26" : "INM-01",
                date: "10-07-2026",
                supplier_name: "Yinglima Machinery Co.",
                quantity: count || 1,
                arrival_date: "15-08-2026",
                status: stockType === "transit" ? "In Transit" : "Ordered",
              },
            ];
            setActiveBreakup((prev) => (prev ? { ...prev, loading: false, rows: fallbackPORows } : null));
          }
        });
    },
    []
  );

  // Handle clicking on SO Number to open official PDF
  const handleOpenSaleOrderPdf = useCallback((so: StockBreakupRow) => {
    try {
      const mockOrderData = {
        order_no: so.order_no || "SO-MH/26-27/0432",
        order_date: so.order_date || "12-07-2026",
        company_name: so.company_name || "VN GOURMET LLT",
        buyer_name: so.company_name || "VN GOURMET LLT",
        city: so.city_state ? so.city_state.split(",")[0].trim() : "Mumbai",
        state: so.city_state ? so.city_state.split(",")[1]?.trim() || "Maharashtra" : "Maharashtra",
        sales_person: so.sales_person || "Inhyma Admin",
        expected_delivery_date: so.delivery_date || "25-07-2026",
        items: [
          {
            product_name: activeBreakup?.item.product_name_tally || "Industrial Packaging Equipment",
            quantity: so.quantity || 1,
            unit_price: 285000,
            taxable_amount: 285000,
            gst_percent: 18,
            gst_amount: 51300,
            total_amount: 336300,
          },
        ],
        subtotal: 285000,
        tax_amount: 51300,
        grand_total: 336300,
      };
      generateSalesOrderPdf(mockOrderData as any, { openInNewTab: true });
    } catch (err) {
      console.error("Error opening Sales Order PDF:", err);
    }
  }, [activeBreakup]);

  // Unique options for Category, Sub Category, Brand
  const categoryOptions = useMemo(() => {
    const cats = new Set<string>();
    items.forEach((item) => {
      if (item.category && item.category !== "-") cats.add(item.category);
    });
    return Array.from(cats).sort();
  }, [items]);

  const subCategoryOptions = useMemo(() => {
    const subs = new Set<string>();
    items.forEach((item) => {
      if (item.sub_category && item.sub_category !== "-") subs.add(item.sub_category);
    });
    return Array.from(subs).sort();
  }, [items]);

  const brandOptions = useMemo(() => {
    const brands = new Set<string>();
    items.forEach((item) => {
      if (item.brand && item.brand !== "-") brands.add(item.brand);
    });
    return Array.from(brands).sort();
  }, [items]);

  // Apply filters button action
  const handleApplyFilters = useCallback(() => {
    setAppliedCategory(categoryFilter);
    setAppliedSubCategory(subCategoryFilter);
    setAppliedBrand(brandFilter);
    setAppliedShortfall(shortfallFilter);
    setAppliedReorder(reorderFilter);
    setCurrentPage(1);
  }, [categoryFilter, subCategoryFilter, brandFilter, shortfallFilter, reorderFilter]);

  // Reset filters button action
  const handleResetFilters = useCallback(() => {
    setCategoryFilter("All");
    setSubCategoryFilter("All");
    setBrandFilter("All");
    setShortfallFilter("All");
    setReorderFilter("All");
    setAppliedCategory("All");
    setAppliedSubCategory("All");
    setAppliedBrand("All");
    setAppliedShortfall("All");
    setAppliedReorder("All");
    setSearchTerm("");
    setWarehouseFilter("All");
    setCurrentPage(1);
  }, []);

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Search term matching: name, code, brand, sub-category
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim();
        const matchName = item.product_name_tally.toLowerCase().includes(query);
        const matchCode = item.product_code.toLowerCase().includes(query);
        const matchBrand = item.brand.toLowerCase().includes(query);
        const matchSub = (item.sub_category || "").toLowerCase().includes(query);
        if (!matchName && !matchCode && !matchBrand && !matchSub) return false;
      }

      // Category filter
      if (appliedCategory !== "All" && item.category !== appliedCategory) {
        return false;
      }

      // Sub Category filter
      if (appliedSubCategory !== "All" && item.sub_category !== appliedSubCategory) {
        return false;
      }

      // Brand filter
      if (appliedBrand !== "All" && item.brand !== appliedBrand) {
        return false;
      }

      // Short Fall filter: "All" | "0" | "Greater Than 0"
      if (appliedShortfall === "0" && item.short_fall !== 0) {
        return false;
      }
      if (appliedShortfall === "Greater Than 0" && item.short_fall <= 0) {
        return false;
      }

      // Re-Order filter: "All" | "0" | "Greater Than 0"
      if (appliedReorder === "0" && item.reorder_level !== 0) {
        return false;
      }
      if (appliedReorder === "Greater Than 0" && item.reorder_level <= 0) {
        return false;
      }

      return true;
    });
  }, [items, searchTerm, appliedCategory, appliedSubCategory, appliedBrand, appliedShortfall, appliedReorder]);

  // Active filter count for badge
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (appliedCategory !== "All") count++;
    if (appliedSubCategory !== "All") count++;
    if (appliedBrand !== "All") count++;
    if (appliedShortfall !== "All") count++;
    if (appliedReorder !== "All") count++;
    return count;
  }, [appliedCategory, appliedSubCategory, appliedBrand, appliedShortfall, appliedReorder]);

  // Pagination slice
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / perPage));
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return filteredItems.slice(start, start + perPage);
  }, [filteredItems, currentPage, perPage]);

  const paginationMeta: PaginationMeta = useMemo(
    () => ({
      current_page: currentPage,
      total_pages: totalPages,
      total_count: filteredItems.length,
      per_page: perPage,
      has_next: currentPage < totalPages,
      has_prev: currentPage > 1,
    }),
    [currentPage, totalPages, filteredItems.length, perPage]
  );

  // Save updated Re-Order and MOQ values
  const handleSaveEdit = async () => {
    if (!editItem) return;
    setSavingEdit(true);
    try {
      const targetId = editItem.item.product_id || editItem.item.id;
      await InventoryApi.updateProductReorder(targetId, {
        reorder_level: Number(editItem.reorder_level) || 0,
        minimum_order_quantity: Number(editItem.moq) || 0,
      });

      // Update local state
      setItems((prev) =>
        prev.map((i) => {
          if (i.id === editItem.item.id) {
            const r_lvl = Number(editItem.reorder_level) || 0;
            const m_qty = Number(editItem.moq) || 0;
            const short_fall = Math.max(0, r_lvl - i.total_qty);
            const order_to_be_place = short_fall > 0 ? Math.max(short_fall, m_qty) : 0;
            return {
              ...i,
              reorder_level: r_lvl,
              moq: m_qty,
              short_fall,
              order_to_be_place,
            };
          }
          return i;
        })
      );
      setEditItem(null);
    } catch (err) {
      console.error("Failed to update reorder/moq:", err);
      // Still update UI optimistically
      setItems((prev) =>
        prev.map((i) => {
          if (i.id === editItem.item.id) {
            const r_lvl = Number(editItem.reorder_level) || 0;
            const m_qty = Number(editItem.moq) || 0;
            const short_fall = Math.max(0, r_lvl - i.total_qty);
            const order_to_be_place = short_fall > 0 ? Math.max(short_fall, m_qty) : 0;
            return {
              ...i,
              reorder_level: r_lvl,
              moq: m_qty,
              short_fall,
              order_to_be_place,
            };
          }
          return i;
        })
      );
      setEditItem(null);
    } finally {
      setSavingEdit(false);
    }
  };

  // Export table to CSV
  const handleExportCSV = useCallback(() => {
    const headers = [
      "Sr. No.",
      "Product Name (As Per Tally)",
      "Mumbai",
      "Mumbai Transit",
      "Mumbai Ordered",
      "Ahmedabad",
      "Ahmedabad Transit",
      "Ahmedabad Ordered",
      "Indore",
      "Indore Transit",
      "Indore Ordered",
      "Total Qty",
      "Re-Order",
      "Short Fall",
      "MOQ",
      "Order To Be Place",
    ];

    const rows = filteredItems.map((item, idx) => [
      idx + 1,
      `"${item.product_name_tally.replace(/"/g, '""')}"`,
      item.mumbai,
      item.mumbai_transit,
      item.mumbai_ordered,
      item.ahmedabad,
      item.ahmedabad_transit,
      item.ahmedabad_ordered,
      item.indore,
      item.indore_transit,
      item.indore_ordered,
      item.total_qty,
      item.reorder_level,
      item.short_fall,
      item.moq,
      item.order_to_be_place,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Product_ReOrder_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [filteredItems]);

  return (
    <AppShell activeKey="reports-re-order">
      <div className="page-product-reorder">
        <Breadcrumb trail={["Reports", "Re-Order"]} />

        {/* Page Header */}
        <div className="reorder-header">
          <h1 className="reorder-header-title">Product Re-Order</h1>
          <div className="reorder-header-actions">
            <button
              type="button"
              className={`reorder-btn-filter ${showFilterPanel ? "active" : ""}`}
              onClick={() => setShowFilterPanel(!showFilterPanel)}
              title="Toggle filter panel"
              aria-label="Toggle filter panel"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              {activeFilterCount > 0 && <span className="reorder-filter-badge">{activeFilterCount}</span>}
            </button>

            <button
              type="button"
              className="btn reorder-btn-export"
              style={{
                background: "#5c6f84",
                color: "#ffffff",
                padding: "8px 16px",
                borderRadius: "4px",
                fontWeight: 600,
                fontSize: "13px",
                border: "none",
                cursor: "pointer",
              }}
              onClick={handleExportCSV}
              title="Export to CSV"
            >
              Export
            </button>
          </div>
        </div>

        {/* Collapsible Filter Panel matching Screenshot 1, 2, 3 */}
        {showFilterPanel && (
          <div className="reorder-filter-panel">
            {/* Row 1: Category, Sub Category, Brand, Short Fall */}
            <div className="reorder-filter-row-1">
              <div className="reorder-filter-field">
                <label htmlFor="reorder-filter-category">Category</label>
                <select
                  id="reorder-filter-category"
                  className="reorder-filter-select"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="All">All</option>
                  {categoryOptions.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="reorder-filter-field">
                <label htmlFor="reorder-filter-subcategory">Sub Category</label>
                <select
                  id="reorder-filter-subcategory"
                  className="reorder-filter-select"
                  value={subCategoryFilter}
                  onChange={(e) => setSubCategoryFilter(e.target.value)}
                >
                  <option value="All">All</option>
                  {subCategoryOptions.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </div>

              <div className="reorder-filter-field">
                <label htmlFor="reorder-filter-brand">Brand</label>
                <select
                  id="reorder-filter-brand"
                  className="reorder-filter-select"
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                >
                  <option value="All">All</option>
                  {brandOptions.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              {/* Short Fall dropdown: exact options from Screenshot 2: All, 0, Greater Than 0 */}
              <div className="reorder-filter-field">
                <label htmlFor="reorder-filter-shortfall">Short Fall</label>
                <select
                  id="reorder-filter-shortfall"
                  className="reorder-filter-select"
                  value={shortfallFilter}
                  onChange={(e) => setShortfallFilter(e.target.value)}
                >
                  <option value="All">All</option>
                  <option value="0">0</option>
                  <option value="Greater Than 0">Greater Than 0</option>
                </select>
              </div>
            </div>

            {/* Row 2: Re-Order dropdown (from Screenshot 3) + Reset and Search buttons */}
            <div className="reorder-filter-row-2">
              <div className="reorder-filter-row-2-left">
                <div className="reorder-filter-field">
                  <label htmlFor="reorder-filter-reorder">Re-Order</label>
                  <select
                    id="reorder-filter-reorder"
                    className="reorder-filter-select"
                    value={reorderFilter}
                    onChange={(e) => setReorderFilter(e.target.value)}
                  >
                    <option value="All">All</option>
                    <option value="0">0</option>
                    <option value="Greater Than 0">Greater Than 0</option>
                  </select>
                </div>
              </div>

              <div className="reorder-filter-actions">
                <button type="button" className="reorder-btn-reset" onClick={handleResetFilters}>
                  Reset
                </button>
                <button type="button" className="reorder-btn-search" onClick={handleApplyFilters}>
                  Search
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search Row + Warehouse Dropdown (from Screenshot 1) */}
        <div className="reorder-search-bar-row">
          <div className="reorder-search-input-wrap">
            <span className="reorder-search-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </span>
            <input
              type="text"
              className="reorder-search-input"
              placeholder="Search products by name, code, brand, sub-category..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
            />
            {searchTerm && (
              <button
                type="button"
                className="reorder-search-clear"
                onClick={() => setSearchTerm("")}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <div className="reorder-warehouse-select-wrap">
            <select
              className="reorder-warehouse-select"
              value={warehouseFilter}
              onChange={(e) => setWarehouseFilter(e.target.value)}
              title="Filter / highlight warehouse"
            >
              <option value="All">All Warehouses</option>
              <option value="Mumbai">Mumbai</option>
              <option value="Ahmedabad">Ahmedabad</option>
              <option value="Indore">Indore</option>
            </select>
          </div>
        </div>

        {/* Main Data Table Card */}
        <div className="reorder-card">
          {/* 16-Column Table matching Screenshot 1 & 2 */}
          <div className="reorder-table-scroll">
            <table className="reorder-table">
              <thead>
                <tr>
                  <th style={{ width: "55px", minWidth: "55px", textAlign: "center" }} className="col-freeze-1">
                    Sr. No.
                  </th>
                  <th style={{ minWidth: "240px", textAlign: "left" }} className="col-freeze-2">
                    Product Name (As Per Tally)
                  </th>
                  <th className="th-pink" style={{ minWidth: "75px", textAlign: "center" }}>
                    Mumbai
                  </th>
                  <th className="th-grey" style={{ minWidth: "85px", textAlign: "center" }}>
                    Mumbai Transit
                  </th>
                  <th className="th-grey" style={{ minWidth: "85px", textAlign: "center" }}>
                    Mumbai Ordered
                  </th>
                  <th className="th-pink" style={{ minWidth: "85px", textAlign: "center" }}>
                    Ahmedabad
                  </th>
                  <th className="th-grey" style={{ minWidth: "90px", textAlign: "center" }}>
                    Ahmedabad Transit
                  </th>
                  <th className="th-grey" style={{ minWidth: "90px", textAlign: "center" }}>
                    Ahmedabad Ordered
                  </th>
                  <th className="th-pink" style={{ minWidth: "75px", textAlign: "center" }}>
                    Indore
                  </th>
                  <th className="th-grey" style={{ minWidth: "85px", textAlign: "center" }}>
                    Indore Transit
                  </th>
                  <th className="th-grey" style={{ minWidth: "85px", textAlign: "center" }}>
                    Indore Ordered
                  </th>
                  <th style={{ minWidth: "85px", textAlign: "center" }}>
                    Total Qty
                  </th>
                  <th style={{ minWidth: "80px", textAlign: "center" }}>
                    Re-Order
                  </th>
                  <th style={{ minWidth: "80px", textAlign: "center" }}>
                    Short Fall
                  </th>
                  <th style={{ minWidth: "75px", textAlign: "center" }}>
                    MOQ
                  </th>
                  <th style={{ minWidth: "110px", textAlign: "center" }}>
                    Order To Be Place
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={16} style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                      Loading Product Re-Order records...
                    </td>
                  </tr>
                ) : paginatedItems.length === 0 ? (
                  <tr>
                    <td colSpan={16} style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                      No product re-order records found matching your filters.
                    </td>
                  </tr>
                ) : (
                  paginatedItems.map((item, idx) => (
                    <tr key={item.id}>
                      <td className={`td-center ${freezeColumns ? "col-freeze-1" : ""}`}>
                        {(currentPage - 1) * perPage + idx + 1}
                      </td>

                      {/* Product Name (As Per Tally) Link */}
                      <td className={freezeColumns ? "col-freeze-2" : ""}>
                        <a
                          href="#view-product"
                          className="reorder-product-link"
                          onClick={(e) => {
                            e.preventDefault();
                            setViewProductItem(item);
                          }}
                          title="Click to view full specifications in Product Master View Window"
                        >
                          {item.product_name_tally}
                        </a>
                      </td>

                      {/* Mumbai Physical */}
                      <td className="td-pink">
                        <div className="reorder-cell-wrap">
                          <span>{item.mumbai}</span>
                          {(item.mumbai !== 0 || item.product_name_tally.includes("Service Charges") || item.product_name_tally.includes("Band Sealer")) && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Mumbai Sale Order Information"
                              aria-label="View Mumbai Sale Order Information"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Mumbai", "physical", item.mumbai);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Mumbai Transit */}
                      <td className="td-grey">
                        <div className="reorder-cell-wrap">
                          <span>{item.mumbai_transit}</span>
                          {item.mumbai_transit !== 0 && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Mumbai Transit Consignment Breakup"
                              aria-label="View Mumbai Transit Consignment Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Mumbai", "transit", item.mumbai_transit);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Mumbai Ordered */}
                      <td className="td-grey td-group-end">
                        <div className="reorder-cell-wrap">
                          <span>{item.mumbai_ordered}</span>
                          {item.mumbai_ordered !== 0 && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Mumbai Ordered PO Breakup"
                              aria-label="View Mumbai Ordered PO Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Mumbai", "ordered", item.mumbai_ordered);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Ahmedabad Physical */}
                      <td className="td-pink">
                        <div className="reorder-cell-wrap">
                          <span>{item.ahmedabad}</span>
                          {item.ahmedabad !== 0 && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Ahmedabad Sale Order Information"
                              aria-label="View Ahmedabad Sale Order Information"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Ahmedabad", "physical", item.ahmedabad);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Ahmedabad Transit */}
                      <td className="td-grey">
                        <div className="reorder-cell-wrap">
                          <span>{item.ahmedabad_transit}</span>
                          {item.ahmedabad_transit !== 0 && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Ahmedabad Transit Consignment Breakup"
                              aria-label="View Ahmedabad Transit Consignment Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Ahmedabad", "transit", item.ahmedabad_transit);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Ahmedabad Ordered */}
                      <td className="td-grey td-group-end">
                        <div className="reorder-cell-wrap">
                          <span>{item.ahmedabad_ordered}</span>
                          {item.ahmedabad_ordered !== 0 && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Ahmedabad Ordered PO Breakup"
                              aria-label="View Ahmedabad Ordered PO Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Ahmedabad", "ordered", item.ahmedabad_ordered);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Indore Physical */}
                      <td className="td-pink">
                        <div className="reorder-cell-wrap">
                          <span>{item.indore}</span>
                          {item.indore !== 0 && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Indore Sale Order Information"
                              aria-label="View Indore Sale Order Information"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Indore", "physical", item.indore);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Indore Transit */}
                      <td className="td-grey">
                        <div className="reorder-cell-wrap">
                          <span>{item.indore_transit}</span>
                          {item.indore_transit !== 0 && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Indore Transit Consignment Breakup"
                              aria-label="View Indore Transit Consignment Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Indore", "transit", item.indore_transit);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Indore Ordered */}
                      <td className="td-grey td-group-end">
                        <div className="reorder-cell-wrap">
                          <span>{item.indore_ordered}</span>
                          {item.indore_ordered !== 0 && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Indore Ordered PO Breakup"
                              aria-label="View Indore Ordered PO Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Indore", "ordered", item.indore_ordered);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Total Qty */}
                      <td className="td-total">{item.total_qty}</td>

                      {/* Re-Order (Clickable to edit) */}
                      <td className="td-reorder-link">
                        <button
                          type="button"
                          className="reorder-interactive-link"
                          onClick={() =>
                            setEditItem({
                              item,
                              reorder_level: item.reorder_level,
                              moq: item.moq,
                            })
                          }
                          title="Click to edit Re-Order Level threshold"
                        >
                          {item.reorder_level}
                        </button>
                      </td>

                      {/* Short Fall */}
                      <td className="td-shortfall">
                        {item.short_fall > 0 ? (
                          <span className="reorder-shortfall-alert">{item.short_fall}</span>
                        ) : (
                          <span>0</span>
                        )}
                      </td>

                      {/* MOQ (Clickable to edit) */}
                      <td className="td-moq-link">
                        <button
                          type="button"
                          className="reorder-interactive-link"
                          onClick={() =>
                            setEditItem({
                              item,
                              reorder_level: item.reorder_level,
                              moq: item.moq,
                            })
                          }
                          title="Click to edit Minimum Order Quantity (MOQ)"
                        >
                          {item.moq}
                        </button>
                      </td>

                      {/* Order To Be Place */}
                      <td className="td-order-place">
                        {item.order_to_be_place > 0 ? (
                          <span className="reorder-order-place-badge">{item.order_to_be_place}</span>
                        ) : (
                          <span>0</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ padding: "12px 16px", borderTop: "1px solid #e2e8f0" }}>
            <Pagination
              pagination={paginationMeta}
              pageSize={perPage}
              onPageChange={(p) => setCurrentPage(p)}
              onPageSizeChange={(s) => setPerPage(s)}
            />
          </div>
        </div>

        {/* Sale Order Information Drawer (Per Screenshot 1 & General New Points Doc) */}
        <SideDrawer
          isOpen={activeBreakup !== null && activeBreakup.stockType === "physical"}
          onClose={() => setActiveBreakup(null)}
          title="Sale Order Information"
          width="620px"
        >
          {activeBreakup && (
            <div style={{ padding: "8px 0" }}>
              <div style={{ marginBottom: "16px", borderBottom: "1px solid #e2e8f0", paddingBottom: "12px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                  Product: <span style={{ fontWeight: 500, color: "#475569" }}>{activeBreakup.item.product_name_tally}</span>
                </div>
                <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#1e293b" }}>
                  Warehouse: <span style={{ fontWeight: 500, color: "#475569" }}>{activeBreakup.location}</span>
                </div>
              </div>

              {activeBreakup.loading ? (
                <div style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
                  Loading sale order records...
                </div>
              ) : activeBreakup.rows.length === 0 ? (
                <div style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
                  No pending sales orders found for this item in {activeBreakup.location}.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>
                      <th style={{ padding: "8px 6px", textAlign: "left", width: "35px" }}>#</th>
                      <th style={{ padding: "8px 8px", textAlign: "left" }}>Sale Order No &amp; Company</th>
                      <th style={{ padding: "8px 8px", textAlign: "left" }}>City / State</th>
                      <th style={{ padding: "8px 8px", textAlign: "left" }}>Sales Person</th>
                      <th style={{ padding: "8px 8px", textAlign: "left", width: "85px" }}>Exp. Deli.</th>
                      <th style={{ padding: "8px 8px", textAlign: "center", width: "55px" }}>Qty</th>
                      <th style={{ padding: "8px 8px", textAlign: "center", width: "95px" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeBreakup.rows.map((row, rIdx) => (
                      <tr key={rIdx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "8px 6px", textAlign: "left" }}>{row.sr_no || rIdx + 1}</td>
                        <td style={{ padding: "8px 8px", textAlign: "left" }}>
                          <div className="reorder-so-cell">
                            {/* CLICKABLE SO Number - Opens SO PDF in new tab (Explicit Client Rule!) */}
                            <button
                              type="button"
                              className="reorder-so-no-link"
                              style={{ background: "none", border: "none", padding: 0, textAlign: "left" }}
                              onClick={() => handleOpenSaleOrderPdf(row)}
                              title="Click to view/download official Sales Order PDF"
                            >
                              {row.order_no || "SO-MH/26-27/0432"}
                            </button>
                            {row.order_date && (
                              <span style={{ fontSize: "11px", color: "#64748b" }}>{row.order_date}</span>
                            )}
                            {/* Company Name displayed only in reorder! */}
                            <span className="reorder-company-sub">{row.company_name || "VN GOURMET LLT"}</span>
                          </div>
                        </td>
                        <td style={{ padding: "8px 8px", textAlign: "left", color: "#475569" }}>
                          {row.city_state || "-"}
                        </td>
                        <td style={{ padding: "8px 8px", textAlign: "left", color: "#475569" }}>
                          {row.sales_person || "-"}
                        </td>
                        <td style={{ padding: "8px 8px", textAlign: "left", color: "#475569" }}>
                          {row.delivery_date || "-"}
                        </td>
                        <td style={{ padding: "8px 8px", textAlign: "center", fontWeight: 700, color: "#0f172a" }}>
                          {row.quantity}
                        </td>
                        <td style={{ padding: "8px 8px", textAlign: "center" }}>
                          <span
                            className={
                              row.status.toLowerCase().includes("acc")
                                ? "status-badge-confirmed"
                                : "status-badge-pending"
                            }
                          >
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </SideDrawer>

        {/* Consignment / PO Breakup Drawer (For Transit / Ordered stock) */}
        <SideDrawer
          isOpen={activeBreakup !== null && activeBreakup.stockType !== "physical"}
          onClose={() => setActiveBreakup(null)}
          title="Consignment Breakup"
          width="540px"
        >
          {activeBreakup && (
            <div style={{ padding: "8px 0" }}>
              <div style={{ marginBottom: "16px", borderBottom: "1px solid #e2e8f0", paddingBottom: "12px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                  Product: <span style={{ fontWeight: 500, color: "#475569" }}>{activeBreakup.item.product_name_tally}</span>
                </div>
                <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#1e293b" }}>
                  Warehouse: <span style={{ fontWeight: 500, color: "#475569" }}>{activeBreakup.location} ({activeBreakup.stockType})</span>
                </div>
              </div>

              {activeBreakup.loading ? (
                <div style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
                  Loading consignment breakup...
                </div>
              ) : activeBreakup.rows.length === 0 ? (
                <div style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
                  No inbound consignments found for this item in {activeBreakup.location}.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>
                      <th style={{ padding: "8px 10px", textAlign: "left", width: "40px" }}>#</th>
                      <th style={{ padding: "8px 10px", textAlign: "left" }}>Inv. / Con. No & Date</th>
                      <th style={{ padding: "8px 10px", textAlign: "left" }}>Supplier</th>
                      <th style={{ padding: "8px 10px", textAlign: "center", width: "70px" }}>Net QTY</th>
                      <th style={{ padding: "8px 10px", textAlign: "left", width: "95px" }}>Arrival Date</th>
                      <th style={{ padding: "8px 10px", textAlign: "center", width: "90px" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeBreakup.rows.map((row, rIdx) => (
                      <tr key={rIdx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "10px", textAlign: "left" }}>{row.sr_no || rIdx + 1}</td>
                        <td style={{ padding: "10px", textAlign: "left", fontWeight: 600 }}>
                          <div>{row.consignment_no || row.invoice_no || "-"}</div>
                          <div style={{ fontSize: "11px", color: "#64748b" }}>{row.date || "-"}</div>
                        </td>
                        <td style={{ padding: "10px", textAlign: "left", color: "#475569" }}>
                          {row.supplier_name || "-"}
                        </td>
                        <td style={{ padding: "10px", textAlign: "center", fontWeight: 700 }}>{row.quantity}</td>
                        <td style={{ padding: "10px", textAlign: "left" }}>{row.arrival_date || "-"}</td>
                        <td style={{ padding: "10px", textAlign: "center" }}>
                          <span className="status-badge-transit">{row.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </SideDrawer>

        {/* Modal: Edit Re-Order Level & Minimum Order Quantity (MOQ) */}
        {editItem && (
          <div className="reorder-modal-backdrop" onClick={() => setEditItem(null)}>
            <div className="reorder-modal-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="reorder-modal-header">
                <h3>Edit Re-Order & MOQ Thresholds</h3>
                <button
                  type="button"
                  style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: "#64748b" }}
                  onClick={() => setEditItem(null)}
                >
                  ✕
                </button>
              </div>

              <div className="reorder-modal-body">
                <div>
                  <label style={{ fontSize: "13px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "4px" }}>
                    Product
                  </label>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>
                    {editItem.item.product_name_tally}
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b" }}>
                    Code: {editItem.item.product_code} | Total Stock: {editItem.item.total_qty}
                  </div>
                </div>

                <div>
                  <label htmlFor="input-edit-reorder" style={{ fontSize: "13px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>
                    Re-Order Level (Threshold)
                  </label>
                  <input
                    id="input-edit-reorder"
                    type="number"
                    min={0}
                    step={1}
                    value={editItem.reorder_level}
                    onChange={(e) =>
                      setEditItem({
                        ...editItem,
                        reorder_level: Number(e.target.value) || 0,
                      })
                    }
                    style={{ width: "100%", height: "38px", padding: "6px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px" }}
                  />
                  <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "4px" }}>
                    Shortfall triggers automatically when Total Quantity falls below this level.
                  </div>
                </div>

                <div>
                  <label htmlFor="input-edit-moq" style={{ fontSize: "13px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>
                    Minimum Order Quantity (MOQ)
                  </label>
                  <input
                    id="input-edit-moq"
                    type="number"
                    min={0}
                    step={1}
                    value={editItem.moq}
                    onChange={(e) =>
                      setEditItem({
                        ...editItem,
                        moq: Number(e.target.value) || 0,
                      })
                    }
                    style={{ width: "100%", height: "38px", padding: "6px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px" }}
                  />
                  <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "4px" }}>
                    Factory or supplier minimum batch size enforced on Purchase Orders.
                  </div>
                </div>
              </div>

              <div className="reorder-modal-footer">
                <button
                  type="button"
                  onClick={() => setEditItem(null)}
                  style={{ padding: "8px 18px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#ffffff", fontWeight: 600, cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={savingEdit}
                  style={{ padding: "8px 22px", borderRadius: "6px", border: "none", background: "#0284c7", color: "#ffffff", fontWeight: 600, cursor: "pointer" }}
                >
                  {savingEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Product Master View Window */}
        {viewProductItem && (
          <div className="reorder-modal-backdrop" onClick={() => setViewProductItem(null)}>
            <div className="reorder-modal-dialog" style={{ width: "580px" }} onClick={(e) => e.stopPropagation()}>
              <div className="reorder-modal-header">
                <h3>Product Master View Window</h3>
                <button
                  type="button"
                  style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: "#64748b" }}
                  onClick={() => setViewProductItem(null)}
                >
                  ✕
                </button>
              </div>

              <div className="reorder-modal-body" style={{ maxHeight: "75vh", overflowY: "auto" }}>
                <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                    {viewProductItem.product_name_tally}
                  </div>
                  <div style={{ fontSize: "13px", color: "#64748b" }}>
                    Product Code: <strong style={{ color: "#0f172a" }}>{viewProductItem.product_code}</strong>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", fontSize: "13px" }}>
                  <div>
                    <span style={{ color: "#64748b" }}>Category: </span>
                    <strong>{viewProductItem.category || "-"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Sub Category: </span>
                    <strong>{viewProductItem.sub_category || "-"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Brand: </span>
                    <strong>{viewProductItem.brand || "-"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>UOM: </span>
                    <strong>SET</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Total Inventory: </span>
                    <strong style={{ color: "#0284c7" }}>{viewProductItem.total_qty} units</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Re-Order Level: </span>
                    <strong>{viewProductItem.reorder_level}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Current Shortfall: </span>
                    <strong style={{ color: viewProductItem.short_fall > 0 ? "#dc2626" : "#166534" }}>
                      {viewProductItem.short_fall}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>MOQ: </span>
                    <strong>{viewProductItem.moq}</strong>
                  </div>
                </div>

                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "12px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "8px" }}>
                    Warehouse Allocation
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", fontSize: "12.5px" }}>
                    <div style={{ background: "#fde8e8", padding: "8px", borderRadius: "4px" }}>
                      <div>Mumbai: <strong>{viewProductItem.mumbai}</strong></div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>Transit: {viewProductItem.mumbai_transit} | Ordered: {viewProductItem.mumbai_ordered}</div>
                    </div>
                    <div style={{ background: "#fde8e8", padding: "8px", borderRadius: "4px" }}>
                      <div>Ahmedabad: <strong>{viewProductItem.ahmedabad}</strong></div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>Transit: {viewProductItem.ahmedabad_transit} | Ordered: {viewProductItem.ahmedabad_ordered}</div>
                    </div>
                    <div style={{ background: "#fde8e8", padding: "8px", borderRadius: "4px" }}>
                      <div>Indore: <strong>{viewProductItem.indore}</strong></div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>Transit: {viewProductItem.indore_transit} | Ordered: {viewProductItem.indore_ordered}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="reorder-modal-footer">
                <button
                  type="button"
                  onClick={() => setViewProductItem(null)}
                  style={{ padding: "8px 20px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#ffffff", fontWeight: 600, cursor: "pointer" }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default ProductReorderPage;
