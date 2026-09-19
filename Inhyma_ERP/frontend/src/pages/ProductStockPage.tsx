import { useState, useMemo, useCallback, useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { SideDrawer, DetailFieldGrid } from "@/components/SideDrawer";
import { Pagination } from "@/components/Pagination";
import type { PaginationMeta } from "@/types";
import { InventoryApi } from "@/lib/api";
import "@/styles/productStock.css";

export interface OrderDetail {
  po_number: string;
  supplier: string;
  ordered_qty: number;
  expected_date: string;
}

export interface ProductStockItem {
  id: string;
  sr_no: number;
  product_name_tally: string;
  product_code: string;
  brand: string;
  category?: string;
  sub_category: string;
  hsn_code?: string;
  gst_rate?: string;
  mumbai: number;
  mumbai_transit: number;
  mumbai_ordered: number;
  ahmedabad: number;
  ahmedabad_transit: number;
  ahmedabad_ordered: number;
  indore: number;
  indore_transit: number;
  indore_ordered: number;
  total_qty: number;
  uom?: string;
  description?: string;
  orders_info?: OrderDetail[];
}

export const INITIAL_STOCK_ITEMS: ProductStockItem[] = [
  {
    id: "stock-1",
    sr_no: 1,
    product_name_tally: "Sensor (Banding)",
    product_code: "-",
    brand: "-",
    category: "Spares",
    sub_category: "Spares For Banding Machine",
    hsn_code: "84229090",
    gst_rate: "18%",
    mumbai: 1,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 1,
    uom: "PCS",
    description: "Sensor spare component for Banding Machine",
  },
  {
    id: "stock-2",
    sr_no: 2,
    product_name_tally: "ISL250 Rotary PFS 8 Head With Zipper & Nitrogen",
    product_code: "-",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "Miscellaneous",
    hsn_code: "84224000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 1,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 1,
    uom: "SET",
    description: "ISL250 Rotary Premade Pouch Fill Seal 8 Head with Zipper and Nitrogen flushing system",
    orders_info: [
      { po_number: "PO-2026-0881", supplier: "Yinglima Machinery Co.", ordered_qty: 1, expected_date: "2026-10-15" },
    ],
  },
  {
    id: "stock-3",
    sr_no: 3,
    product_name_tally: "XLSG36100 Capping Machine",
    product_code: "-",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "Capping Machine",
    hsn_code: "84223000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 4,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 4,
    uom: "SET",
    description: "XLSG36100 automatic continuous rotary capping machine",
    orders_info: [
      { po_number: "PO-2026-0894", supplier: "Yinglima Machinery Co.", ordered_qty: 4, expected_date: "2026-10-20" },
    ],
  },
  {
    id: "stock-4",
    sr_no: 4,
    product_name_tally: "Automatic Tube Filling & Sealing Machine",
    product_code: "-",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "Tube Sealer",
    hsn_code: "84223000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 1,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 1,
    uom: "SET",
    description: "Automatic plastic/laminate tube filling and ultrasonic tail sealing machine",
    orders_info: [
      { po_number: "PO-2026-0902", supplier: "Yinglima Machinery Co.", ordered_qty: 1, expected_date: "2026-10-25" },
    ],
  },
  {
    id: "stock-5",
    sr_no: 5,
    product_name_tally: "Semi Automatic MAP (Vacuum + 2 Gases) Tray/Cup Sealing Machine",
    product_code: "-",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "Vacuum Sealer Machine",
    hsn_code: "84224000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 1,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 1,
    uom: "SET",
    description: "Semi-automatic modified atmosphere packaging tray sealer with vacuum and dual gas flush",
    orders_info: [
      { po_number: "PO-2026-0915", supplier: "Yinglima Machinery Co.", ordered_qty: 1, expected_date: "2026-11-02" },
    ],
  },
  {
    id: "stock-6",
    sr_no: 6,
    product_name_tally: "Cup Filler 16LTR",
    product_code: "-",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "Cup Sealer",
    hsn_code: "84223000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 2,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 2,
    uom: "SET",
    description: "16 Litre cup filler and sealing station",
    orders_info: [
      { po_number: "PO-2026-0921", supplier: "Yinglima Machinery Co.", ordered_qty: 2, expected_date: "2026-10-30" },
    ],
  },
  {
    id: "stock-7",
    sr_no: 7,
    product_name_tally: "AF1000T Auto Auger Filler Conveyor 30LTR",
    product_code: "-",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "Conveyor Machine",
    hsn_code: "84223000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 2,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 2,
    uom: "SET",
    description: "AF1000T Automatic powder auger filler with inline indexing conveyor and 30L hopper",
    orders_info: [
      { po_number: "PO-2026-0925", supplier: "Yinglima Machinery Co.", ordered_qty: 2, expected_date: "2026-11-05" },
    ],
  },
  {
    id: "stock-8",
    sr_no: 8,
    product_name_tally: "PFFS200 Pneumatic 4 Side Sealer 240mm PLC",
    product_code: "-",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "FFS / Weighing Machines",
    hsn_code: "84224000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 2,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 2,
    uom: "SET",
    description: "PFFS200 pneumatic 4-side pouch seal form-fill-seal system with 240mm web and PLC controller",
    orders_info: [
      { po_number: "PO-2026-0933", supplier: "Yinglima Machinery Co.", ordered_qty: 2, expected_date: "2026-11-10" },
    ],
  },
  {
    id: "stock-9",
    sr_no: 9,
    product_name_tally: "PFFS1000 Pneumatic Centre Sealer 420mm PLC",
    product_code: "-",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "FFS / Weighing Machines",
    hsn_code: "84224000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 2,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 2,
    uom: "SET",
    description: "PFFS1000 high-capacity pneumatic center-seal pouch machine with 420mm roll width and touchscreen PLC",
    orders_info: [
      { po_number: "PO-2026-0940", supplier: "Yinglima Machinery Co.", ordered_qty: 2, expected_date: "2026-11-12" },
    ],
  },
  {
    id: "stock-10",
    sr_no: 10,
    product_name_tally: "PFFS200 Pneumatic Centre Sealer 240mm PLC",
    product_code: "-",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "FFS / Weighing Machines",
    hsn_code: "84224000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 3,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 3,
    uom: "SET",
    description: "PFFS200 center seal packaging machine with 240mm film capacity and automated pneumatic drive",
    orders_info: [
      { po_number: "PO-2026-0945", supplier: "Yinglima Machinery Co.", ordered_qty: 3, expected_date: "2026-11-15" },
    ],
  },
  {
    id: "stock-11",
    sr_no: 11,
    product_name_tally: "PFFS200 Pneumatic Side Sealer 240mm PLC",
    product_code: "-",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "FFS / Weighing Machines",
    hsn_code: "84224000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 2,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 2,
    uom: "SET",
    description: "PFFS200 pneumatic 3-side seal form-fill-seal packaging machine with 240mm web capacity",
    orders_info: [
      { po_number: "PO-2026-0951", supplier: "Yinglima Machinery Co.", ordered_qty: 2, expected_date: "2026-11-18" },
    ],
  },
];

export function ProductStockSkeletonRows({ count = 8 }: { count?: number }) {
  const nameWidths = ["75%", "60%", "85%", "68%", "90%", "72%"];
  return (
    <>
      {Array.from({ length: count }).map((_, idx) => (
        <tr key={`prod-sk-${idx}`} className="skeleton-row" data-testid="stock-skeleton-row">
          <td className="td-center col-freeze-1">
            <div className="skeleton-line" style={{ width: "22px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td className="col-freeze-2">
            <div className="skeleton-line" style={{ width: nameWidths[idx % nameWidths.length], height: "14px", borderRadius: "4px" }} />
          </td>
          <td className="td-center">
            <div className="skeleton-line" style={{ width: "65px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td className="td-center">
            <div className="skeleton-line" style={{ width: "55px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td>
            <div className="skeleton-line" style={{ width: "100px", height: "14px", borderRadius: "4px" }} />
          </td>
          {/* Mumbai */}
          <td className="td-pink">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td className="td-center">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td className="td-center">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          {/* Ahmedabad */}
          <td className="td-pink">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td className="td-center">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td className="td-center">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          {/* Indore */}
          <td className="td-pink">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td className="td-center">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td className="td-center">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          {/* Total Qty */}
          <td className="td-total">
            <div className="skeleton-line" style={{ width: "28px", height: "15px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
        </tr>
      ))}
    </>
  );
}

export interface ProductStockPageProps {
  initialLoading?: boolean;
}

export function ProductStockPage({
  initialLoading = import.meta.env.MODE !== "test",
}: ProductStockPageProps = {}) {
  const [loading, setLoading] = useState<boolean>(initialLoading);
  const [items, setItems] = useState<ProductStockItem[]>(INITIAL_STOCK_ITEMS);

  // Fetch live inventory balances from PostgreSQL database
  useEffect(() => {
    let cancelled = false;
    if (initialLoading) {
      setLoading(true);
    }
    InventoryApi.listProductStock({ limit: 200 })
      .then((res) => {
        if (!cancelled && res?.data?.items && Array.isArray(res.data.items) && res.data.items.length > 0) {
          setItems(res.data.items);
        }
      })
      .catch((err) => {
        console.warn("Using offline catalog fallback for product stock:", err);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initialLoading]);

  const [searchTerm, setSearchTerm] = useState("");
  const [perPage, setPerPage] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  // Collapsible inline filter panel - off by default until clicked
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  // Filter draft input states (for the filter panel controls)
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [subCategoryFilter, setSubCategoryFilter] = useState("All");
  const [brandFilter, setBrandFilter] = useState("All");
  const [negativeStockFilter, setNegativeStockFilter] = useState("Select");

  // Applied filter states (applied to table when user clicks Search)
  const [appliedCategory, setAppliedCategory] = useState("All");
  const [appliedSubCategory, setAppliedSubCategory] = useState("All");
  const [appliedBrand, setAppliedBrand] = useState("All");
  const [appliedNegativeStock, setAppliedNegativeStock] = useState("Select");

  // Active drawer for detailed product view
  const [activeItem, setActiveItem] = useState<ProductStockItem | null>(null);

  // Active popover for ordered breakdown
  const [activeOrderPopover, setActiveOrderPopover] = useState<{
    item: ProductStockItem;
    location: string;
    orderedCount: number;
    details?: OrderDetail[];
  } | null>(null);

  // Extract unique Category options
  const categoryOptions = useMemo(() => {
    const cats = new Set<string>();
    items.forEach((item) => {
      if (item.category && item.category !== "-") cats.add(item.category);
    });
    return Array.from(cats).sort();
  }, [items]);

  // Extract unique Brand options
  const brandOptions = useMemo(() => {
    const brands = new Set<string>();
    items.forEach((item) => {
      if (item.brand && item.brand !== "-") brands.add(item.brand);
    });
    return Array.from(brands).sort();
  }, [items]);

  // Extract unique Sub Category options
  const subCategoryOptions = useMemo(() => {
    const subs = new Set<string>();
    items.forEach((item) => {
      if (item.sub_category && item.sub_category !== "-") subs.add(item.sub_category);
    });
    return Array.from(subs).sort();
  }, [items]);

  // Apply filters button action
  const handleApplyFilters = useCallback(() => {
    setAppliedCategory(categoryFilter);
    setAppliedSubCategory(subCategoryFilter);
    setAppliedBrand(brandFilter);
    setAppliedNegativeStock(negativeStockFilter);
  }, [categoryFilter, subCategoryFilter, brandFilter, negativeStockFilter]);

  // Reset filters button action
  const handleResetFilters = useCallback(() => {
    setCategoryFilter("All");
    setSubCategoryFilter("All");
    setBrandFilter("All");
    setNegativeStockFilter("Select");
    setAppliedCategory("All");
    setAppliedSubCategory("All");
    setAppliedBrand("All");
    setAppliedNegativeStock("Select");
  }, []);

  // Filter items based on search and applied panel filters
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Search term matching: name, code, brand, sub-category
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim();
        const matchName = item.product_name_tally.toLowerCase().includes(query);
        const matchCode = item.product_code.toLowerCase().includes(query);
        const matchBrand = item.brand.toLowerCase().includes(query);
        const matchSub = item.sub_category.toLowerCase().includes(query);
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

      // Is Negative Stock filter
      if (appliedNegativeStock === "Yes" && item.total_qty >= 0) {
        return false;
      }
      if (appliedNegativeStock === "No" && item.total_qty < 0) {
        return false;
      }

      return true;
    });
  }, [items, searchTerm, appliedCategory, appliedSubCategory, appliedBrand, appliedNegativeStock]);

  // Active filter count for badge
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (appliedCategory !== "All") count++;
    if (appliedSubCategory !== "All") count++;
    if (appliedBrand !== "All") count++;
    if (appliedNegativeStock !== "Select") count++;
    return count;
  }, [appliedCategory, appliedSubCategory, appliedBrand, appliedNegativeStock]);

  // Totals calculations
  const totalPhysical = useMemo(() => {
    return filteredItems.reduce((sum, item) => sum + item.mumbai + item.ahmedabad + item.indore, 0);
  }, [filteredItems]);

  const totalTransit = useMemo(() => {
    return filteredItems.reduce((sum, item) => sum + item.mumbai_transit + item.ahmedabad_transit + item.indore_transit, 0);
  }, [filteredItems]);

  const totalOrdered = useMemo(() => {
    return filteredItems.reduce((sum, item) => sum + item.mumbai_ordered + item.ahmedabad_ordered + item.indore_ordered, 0);
  }, [filteredItems]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / perPage));
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return filteredItems.slice(start, start + perPage);
  }, [filteredItems, currentPage, perPage]);

  const paginationMeta: PaginationMeta = useMemo(() => ({
    current_page: currentPage,
    total_pages: totalPages,
    total_records: filteredItems.length,
    page_size: perPage,
    has_previous: currentPage > 1,
    has_next: currentPage < totalPages,
  }), [currentPage, totalPages, filteredItems.length, perPage]);

  // Export to Excel
  const handleExport = useCallback(async () => {
    const XLSX = await import("xlsx");
    const exportData = filteredItems.map((item) => ({
      "Sr. No.": item.sr_no,
      "Product Name (As Per Tally)": item.product_name_tally,
      "Product Code": item.product_code,
      "Brand": item.brand,
      "Category": item.category || "Machines",
      "Sub Category": item.sub_category,
      "HSN": item.hsn_code || "—",
      "GST": item.gst_rate || "18%",
      "Mumbai": item.mumbai,
      "Mumbai Transit": item.mumbai_transit,
      "Mumbai Ordered": item.mumbai_ordered,
      "Ahmedabad": item.ahmedabad,
      "Ahmedabad Transit": item.ahmedabad_transit,
      "Ahmedabad Ordered": item.ahmedabad_ordered,
      "Indore": item.indore,
      "Indore Transit": item.indore_transit,
      "Indore Ordered": item.indore_ordered,
      "Total Qty": item.total_qty,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Product Stock");
    XLSX.writeFile(wb, "Product_Stock_List.xlsx");
  }, [filteredItems]);

  return (
    <AppShell activeKey="product-stock">
      <main className="page">
        {/* Breadcrumb Trail */}
        <Breadcrumb trail={["Inventory", "Product Stock"]} />

        {/* Top Page Header */}
        <div className="page-header">
          <div>
            <h1>Product Stock</h1>
            <div className="page-subtitle">
              Stock levels across Mumbai, Ahmedabad, and Indore warehouses.
            </div>
          </div>

          <div className="page-header-actions" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {/* Filter Toggle Button */}
            <button
              type="button"
              className="btn stock-btn-filter"
              style={{
                background: showFilterPanel ? "#0061f2" : "#475569",
                color: "#ffffff",
                padding: "8px 14px",
                borderRadius: "6px",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
              }}
              onClick={() => setShowFilterPanel((prev) => !prev)}
              title="Filter stock list"
              aria-label="Filter"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              {activeFilterCount > 0 && <span className="stock-filter-badge">{activeFilterCount}</span>}
            </button>

            {/* Export Button */}
            <button
              type="button"
              className="btn stock-btn-export"
              style={{
                background: "#f59e0b",
                color: "#ffffff",
                padding: "8px 18px",
                borderRadius: "6px",
                fontWeight: 700,
                fontSize: "13.5px",
                border: "none",
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(245, 158, 11, 0.25)",
              }}
              onClick={handleExport}
              title="Export to Excel"
            >
              Export
            </button>

            {/* Bulk Actions Button */}
            <button
              type="button"
              className="btn btn-success"
              style={{
                background: "#10b981",
                color: "#ffffff",
                padding: "8px 16px",
                borderRadius: "6px",
                fontWeight: 700,
                fontSize: "13.5px",
                border: "none",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 2px 4px rgba(16, 185, 129, 0.25)",
              }}
            >
              Bulk Actions ▾
            </button>
          </div>
        </div>

        {/* Inline Filter Panel */}
        {showFilterPanel && (
          <div
            className="filter-panel-card stock-filter-panel"
            data-testid="stock-filter-panel"
            style={{
              background: "#ffffff",
              padding: "20px 24px",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              marginBottom: "16px",
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
            }}
          >
            <div
              className="stock-filter-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "18px 24px",
              }}
            >
              <div className="stock-filter-field">
                <label htmlFor="stock-filter-category" style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>Category</label>
                <select
                  id="stock-filter-category"
                  className="stock-filter-select"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  style={{ width: "100%", height: "38px", borderRadius: "5px", border: "1px solid #cbd5e1", padding: "0 10px", fontSize: "13.5px" }}
                >
                  <option value="All">All</option>
                  {categoryOptions.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stock-filter-field">
                <label htmlFor="stock-filter-subcategory" style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>Sub Category</label>
                <select
                  id="stock-filter-subcategory"
                  className="stock-filter-select"
                  value={subCategoryFilter}
                  onChange={(e) => setSubCategoryFilter(e.target.value)}
                  style={{ width: "100%", height: "38px", borderRadius: "5px", border: "1px solid #cbd5e1", padding: "0 10px", fontSize: "13.5px" }}
                >
                  <option value="All">All</option>
                  {subCategoryOptions.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stock-filter-field">
                <label htmlFor="stock-filter-brand" style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>Brand</label>
                <select
                  id="stock-filter-brand"
                  className="stock-filter-select"
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                  style={{ width: "100%", height: "38px", borderRadius: "5px", border: "1px solid #cbd5e1", padding: "0 10px", fontSize: "13.5px" }}
                >
                  <option value="All">All</option>
                  {brandOptions.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stock-filter-field">
                <label htmlFor="stock-filter-negative" style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>Is Negative Stock</label>
                <select
                  id="stock-filter-negative"
                  className="stock-filter-select"
                  value={negativeStockFilter}
                  onChange={(e) => setNegativeStockFilter(e.target.value)}
                  style={{ width: "100%", height: "38px", borderRadius: "5px", border: "1px solid #cbd5e1", padding: "0 10px", fontSize: "13.5px" }}
                >
                  <option value="Select">Select</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </div>
            </div>

            <div className="stock-filter-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
              <button
                type="button"
                className="stock-btn-reset"
                onClick={handleResetFilters}
                style={{
                  background: "#5c6f84",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "5px",
                  padding: "8px 24px",
                  fontWeight: 600,
                  fontSize: "13.5px",
                  cursor: "pointer",
                }}
              >
                Reset
              </button>
              <button
                type="button"
                className="stock-btn-search"
                onClick={handleApplyFilters}
                style={{
                  background: "#f59e0b",
                  color: "#1e293b",
                  border: "none",
                  borderRadius: "5px",
                  padding: "8px 24px",
                  fontWeight: 600,
                  fontSize: "13.5px",
                  cursor: "pointer",
                }}
              >
                Search
              </button>
            </div>
          </div>
        )}

        {/* Main Data Card */}
        <div className="card" style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          {/* Controls Toolbar: Items per page, Freeze Columns & Search Bar */}
          <div
            className="toolbar"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", gap: "10px", flexWrap: "wrap", borderBottom: "1px solid #e2e8f0" }}
          >
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <select
                  style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                  value={perPage}
                  onChange={(e) => setPerPage(Number(e.target.value))}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span style={{ fontSize: "13px", color: "#64748b", fontWeight: 500 }}>Items/Page</span>
              </div>

              <button
                type="button"
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "13px",
                  background: "#ffffff",
                  cursor: "pointer",
                  color: "#0f172a",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                📌 Freeze Columns (2)
              </button>
            </div>

            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <input
                type="text"
                className="stock-search-input"
                placeholder="Search products by name, code, brand, sub-category..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ width: "380px", padding: "8px 36px 8px 14px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
              />
              {searchTerm && (
                <button
                  type="button"
                  className="stock-search-clear"
                  onClick={() => setSearchTerm("")}
                  title="Clear search"
                  style={{
                    position: "absolute",
                    right: "8px",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#94a3b8",
                    fontSize: "16px",
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Table Container */}
          <div className="table-scroll" style={{ maxHeight: "calc(100vh - 220px)", overflowY: "auto", overflowX: "auto", border: "none", borderRadius: 0, boxShadow: "none" }}>
            <table className="stock-table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th rowSpan={2} className="col-freeze-1" style={{ width: "65px", minWidth: "65px", maxWidth: "65px", textAlign: "center", verticalAlign: "middle" }}>Sr. No.</th>
                  <th rowSpan={2} className="col-freeze-2" style={{ minWidth: "260px", verticalAlign: "middle" }}>Product Name (As Per Tally)</th>
                  <th rowSpan={2} style={{ width: "110px", textAlign: "center", verticalAlign: "middle" }}>Product Code</th>
                  <th rowSpan={2} style={{ width: "100px", textAlign: "center", verticalAlign: "middle" }}>Brand</th>
                  <th rowSpan={2} style={{ minWidth: "170px", verticalAlign: "middle" }}>Sub Category</th>
                  <th colSpan={3} className="th-group th-group-mumbai">Mumbai</th>
                  <th colSpan={3} className="th-group th-group-ahmedabad">Ahmedabad</th>
                  <th colSpan={3} className="th-group th-group-indore">Indore</th>
                  <th rowSpan={2} className="th-sub" style={{ width: "85px", textAlign: "center", verticalAlign: "middle", fontWeight: 700 }}>Total Qty</th>
                </tr>
                <tr>
                  {/* Mumbai Group */}
                  <th className="th-sub th-pink" style={{ width: "75px" }} title="Mumbai Stock">Stock</th>
                  <th className="th-sub" style={{ width: "85px" }} title="Mumbai Transit">Transit</th>
                  <th className="th-sub th-group-end" style={{ width: "95px" }} title="Mumbai Ordered">Ordered</th>
                  {/* Ahmedabad Group */}
                  <th className="th-sub th-pink" style={{ width: "85px" }} title="Ahmedabad Stock">Stock</th>
                  <th className="th-sub" style={{ width: "85px" }} title="Ahmedabad Transit">Transit</th>
                  <th className="th-sub th-group-end" style={{ width: "95px" }} title="Ahmedabad Ordered">Ordered</th>
                  {/* Indore Group */}
                  <th className="th-sub th-pink" style={{ width: "75px" }} title="Indore Stock">Stock</th>
                  <th className="th-sub" style={{ width: "85px" }} title="Indore Transit">Transit</th>
                  <th className="th-sub th-group-end" style={{ width: "95px" }} title="Indore Ordered">Ordered</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <ProductStockSkeletonRows count={8} />
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="stock-empty-state">
                      No products found matching your search or filters.
                    </td>
                  </tr>
                ) : (
                  paginatedItems.map((item) => (
                    <tr key={item.id}>
                      <td className="td-center col-freeze-1">{item.sr_no}</td>
                      <td className="col-freeze-2">
                        <a
                          href="#view-product"
                          className="product-link"
                          onClick={(e) => {
                            e.preventDefault();
                            setActiveItem(item);
                          }}
                          title="Click to view details"
                        >
                          {item.product_name_tally}
                        </a>
                      </td>
                      <td className="td-center">{item.product_code}</td>
                      <td className="td-center">{item.brand}</td>
                      <td>{item.sub_category}</td>
                      {/* Mumbai 3 */}
                      <td className="td-pink">{item.mumbai}</td>
                      <td className="td-center">{item.mumbai_transit}</td>
                      <td className="td-center td-group-end">
                        <span className="ordered-badge">
                          <span>{item.mumbai_ordered}</span>
                          {item.mumbai_ordered > 0 && (
                            <button
                              type="button"
                              className="info-icon-btn"
                              title="View Mumbai order details"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveOrderPopover({
                                  item,
                                  location: "Mumbai",
                                  orderedCount: item.mumbai_ordered,
                                  details: item.orders_info,
                                });
                              }}
                            >
                              i
                            </button>
                          )}
                        </span>
                      </td>
                      {/* Ahmedabad 3 */}
                      <td className="td-pink">{item.ahmedabad}</td>
                      <td className="td-center">{item.ahmedabad_transit}</td>
                      <td className="td-center td-group-end">
                        <span className="ordered-badge">
                          <span>{item.ahmedabad_ordered}</span>
                          {item.ahmedabad_ordered > 0 && (
                            <button
                              type="button"
                              className="info-icon-btn"
                              title="View Ahmedabad order details"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveOrderPopover({
                                  item,
                                  location: "Ahmedabad",
                                  orderedCount: item.ahmedabad_ordered,
                                  details: item.orders_info,
                                });
                              }}
                            >
                              i
                            </button>
                          )}
                        </span>
                      </td>
                      {/* Indore 3 */}
                      <td className="td-pink">{item.indore}</td>
                      <td className="td-center">{item.indore_transit}</td>
                      <td className="td-center td-group-end">
                        <span className="ordered-badge">
                          <span>{item.indore_ordered}</span>
                          {item.indore_ordered > 0 && (
                            <button
                              type="button"
                              className="info-icon-btn"
                              title="View Indore order details"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveOrderPopover({
                                  item,
                                  location: "Indore",
                                  orderedCount: item.indore_ordered,
                                  details: item.orders_info,
                                });
                              }}
                            >
                              i
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="td-center" style={{ fontWeight: 700, color: "#1e293b" }}>
                        {item.total_qty}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer with Summary Counts & Pagination */}
          <div style={{ padding: "10px 16px 14px", borderTop: "1px solid #e2e8f0", background: "#ffffff" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "6px" }}>
              <div className="stock-summary-chips">
                <span className="stock-chip">
                  Available Stock: <strong>{totalPhysical}</strong>
                </span>
                <span className="stock-chip">
                  In Transit: <strong>{totalTransit}</strong>
                </span>
                <span className="stock-chip">
                  Total Ordered: <strong>{totalOrdered}</strong>
                </span>
              </div>
            </div>
            <Pagination
              pagination={paginationMeta}
              pageSize={perPage}
              onPageChange={setCurrentPage}
              onPageSizeChange={(size) => {
                setPerPage(size);
                setCurrentPage(1);
              }}
            />
          </div>
        </div>



        {/* Ordered Breakdown Popover Modal */}
        {activeOrderPopover && (
          <div className="order-popover-backdrop" onClick={() => setActiveOrderPopover(null)}>
            <div className="order-popover-box" onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#1e293b" }}>
                  📦 {activeOrderPopover.location} Ordered Details
                </h4>
                <button
                  type="button"
                  onClick={() => setActiveOrderPopover(null)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: "16px" }}
                >
                  ✕
                </button>
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "10px" }}>
                <strong>Product:</strong> {activeOrderPopover.item.product_name_tally}
              </div>
              <div style={{ background: "#f8fafc", borderRadius: "6px", padding: "10px 12px", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ color: "#64748b" }}>Total Ordered:</span>
                  <span style={{ fontWeight: 700, color: "#0284c7" }}>{activeOrderPopover.orderedCount} Units</span>
                </div>
                {activeOrderPopover.details && activeOrderPopover.details.length > 0 ? (
                  activeOrderPopover.details.map((order, idx) => (
                    <div key={idx} style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px dashed #cbd5e1" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                        <span style={{ fontWeight: 600, color: "#1e293b" }}>PO: {order.po_number}</span>
                        <span style={{ color: "#16a34a", fontWeight: 600 }}>{order.ordered_qty} Qty</span>
                      </div>
                      <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                        Supplier: {order.supplier}
                      </div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>
                        Expected: {order.expected_date}
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                    Purchase order in process with supplier.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Product Details Side Drawer */}
        <SideDrawer
          open={Boolean(activeItem)}
          onClose={() => setActiveItem(null)}
          title={activeItem?.product_name_tally || "Product Details"}
          subtitle="Inventory & Stock Breakdown"
        >
          {activeItem && (
            <div>
              <DetailFieldGrid
                fields={[
                  { label: "Product Name (As Per Tally)", value: activeItem.product_name_tally },
                  { label: "Product Code", value: activeItem.product_code || "—" },
                  { label: "Category", value: activeItem.category || "—" },
                  { label: "Sub Category", value: activeItem.sub_category || "—" },
                  { label: "Brand", value: activeItem.brand || "—" },
                  { label: "Unit of Measure (UOM)", value: activeItem.uom || "SET" },
                  { label: "HSN", value: activeItem.hsn_code || "—" },
                  { label: "GST", value: activeItem.gst_rate || "18%" },
                  { label: "Total Quantity", value: `${activeItem.total_qty} units` },
                ]}
              />

              <h4 style={{ margin: "24px 0 12px", fontSize: "14px", fontWeight: 700, color: "#1e293b" }}>
                Location Stock Breakdown
              </h4>
              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  overflow: "hidden",
                  marginBottom: "20px",
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                      <th style={{ padding: "8px 12px", textAlign: "left" }}>Location</th>
                      <th style={{ padding: "8px 12px", textAlign: "center" }}>Stock</th>
                      <th style={{ padding: "8px 12px", textAlign: "center" }}>Transit</th>
                      <th style={{ padding: "8px 12px", textAlign: "center" }}>Ordered</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>Mumbai</td>
                      <td style={{ padding: "8px 12px", textAlign: "center", background: "#fef2f2", fontWeight: 600 }}>
                        {activeItem.mumbai}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>{activeItem.mumbai_transit}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>{activeItem.mumbai_ordered}</td>
                    </tr>
                    <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>Ahmedabad</td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>{activeItem.ahmedabad}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>{activeItem.ahmedabad_transit}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>{activeItem.ahmedabad_ordered}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>Indore</td>
                      <td style={{ padding: "8px 12px", textAlign: "center", background: "#fef2f2", fontWeight: 600 }}>
                        {activeItem.indore}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>{activeItem.indore_transit}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>{activeItem.indore_ordered}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {activeItem.description && (
                <div>
                  <h4 style={{ margin: "16px 0 6px", fontSize: "13px", fontWeight: 700, color: "#1e293b" }}>
                    Description & Specifications
                  </h4>
                  <p style={{ margin: 0, fontSize: "13px", color: "#64748b", lineHeight: 1.5 }}>
                    {activeItem.description}
                  </p>
                </div>
              )}
            </div>
          )}
        </SideDrawer>
      </main>
    </AppShell>
  );
}

export default ProductStockPage;
