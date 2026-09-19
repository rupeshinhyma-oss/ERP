import { useState, useMemo, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { SideDrawer, DetailFieldGrid } from "@/components/SideDrawer";
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
  sub_category: string;
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
    sub_category: "Spares For Banding Machine",
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
    sub_category: "Miscellaneous",
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
    sub_category: "Capping Machine",
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
    sub_category: "Tube Sealer",
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
    sub_category: "Vacuum Sealer Machine",
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
    sub_category: "Cup Sealer",
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
    sub_category: "Conveyor Machine",
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
    sub_category: "FFS / Weighing Machines",
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
    sub_category: "FFS / Weighing Machines",
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
    sub_category: "FFS / Weighing Machines",
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
    sub_category: "FFS / Weighing Machines",
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

export function ProductStockPage() {
  const [items] = useState<ProductStockItem[]>(INITIAL_STOCK_ITEMS);
  const [searchTerm, setSearchTerm] = useState("");
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState("");
  const [selectedSubCategory, setSelectedSubCategory] = useState("");
  const [selectedStockStatus, setSelectedStockStatus] = useState("all");

  // Active drawer for detailed product view
  const [activeItem, setActiveItem] = useState<ProductStockItem | null>(null);

  // Active popover for ordered breakdown
  const [activeOrderPopover, setActiveOrderPopover] = useState<{
    item: ProductStockItem;
    location: string;
    orderedCount: number;
    details?: OrderDetail[];
  } | null>(null);

  // Extract unique options for filter modal
  const brandOptions = useMemo(() => {
    const brands = new Set<string>();
    items.forEach((item) => {
      if (item.brand && item.brand !== "-") brands.add(item.brand);
    });
    return Array.from(brands).sort();
  }, [items]);

  const subCategoryOptions = useMemo(() => {
    const subs = new Set<string>();
    items.forEach((item) => {
      if (item.sub_category) subs.add(item.sub_category);
    });
    return Array.from(subs).sort();
  }, [items]);

  // Filter items based on search and modal filters
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

      // Brand filter
      if (selectedBrand && item.brand !== selectedBrand) {
        return false;
      }

      // Sub Category filter
      if (selectedSubCategory && item.sub_category !== selectedSubCategory) {
        return false;
      }

      // Stock status filter
      if (selectedStockStatus === "in_stock" && item.total_qty <= 0) {
        return false;
      }
      if (selectedStockStatus === "mumbai" && item.mumbai <= 0) {
        return false;
      }
      if (selectedStockStatus === "ordered" && item.mumbai_ordered <= 0 && item.ahmedabad_ordered <= 0 && item.indore_ordered <= 0) {
        return false;
      }
      if (selectedStockStatus === "transit" && item.mumbai_transit <= 0 && item.ahmedabad_transit <= 0 && item.indore_transit <= 0) {
        return false;
      }

      return true;
    });
  }, [items, searchTerm, selectedBrand, selectedSubCategory, selectedStockStatus]);

  // Active filter count for badge
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedBrand) count++;
    if (selectedSubCategory) count++;
    if (selectedStockStatus !== "all") count++;
    return count;
  }, [selectedBrand, selectedSubCategory, selectedStockStatus]);

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

  // Export to Excel
  const handleExport = useCallback(async () => {
    const XLSX = await import("xlsx");
    const exportData = filteredItems.map((item) => ({
      "Sr. No.": item.sr_no,
      "Product Name (As Per Tally)": item.product_name_tally,
      "Product Code": item.product_code,
      "Brand": item.brand,
      "Sub Category": item.sub_category,
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
      <div className="page-product-stock">
        {/* Top Header */}
        <div className="stock-header">
          <h1 className="stock-header-title">Product Stock</h1>

          <div className="stock-header-actions">
            {/* Filter Button */}
            <button
              type="button"
              className="stock-btn-filter"
              onClick={() => setShowFilterModal(true)}
              title="Filter stock list"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              Filter
              {activeFilterCount > 0 && <span className="stock-filter-badge">{activeFilterCount}</span>}
            </button>

            {/* Export Button */}
            <button
              type="button"
              className="stock-btn-export"
              onClick={handleExport}
              title="Export to Excel"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="stock-search-card">
          <div className="stock-search-input-wrap">
            <svg
              className="stock-search-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="stock-search-input"
              placeholder="Search products by name, code, brand, sub-category..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                type="button"
                className="stock-search-clear"
                onClick={() => setSearchTerm("")}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Table Card */}
        <div className="stock-table-card">
          <div className="stock-table-wrap">
            <table className="stock-table">
              <thead>
                <tr>
                  <th style={{ width: "65px", textAlign: "center" }}>Sr. No.</th>
                  <th style={{ minWidth: "260px" }}>Product Name (As Per Tally)</th>
                  <th style={{ width: "110px", textAlign: "center" }}>Product Code</th>
                  <th style={{ width: "100px", textAlign: "center" }}>Brand</th>
                  <th style={{ minWidth: "170px" }}>Sub Category</th>
                  <th className="th-pink" style={{ width: "80px" }}>Mumbai</th>
                  <th className="th-sub" style={{ width: "95px" }}>Mumbai Transit</th>
                  <th className="th-sub" style={{ width: "105px" }}>Mumbai Ordered</th>
                  <th className="th-sub" style={{ width: "95px" }}>Ahmedabad</th>
                  <th className="th-sub" style={{ width: "110px" }}>Ahmedabad Transit</th>
                  <th className="th-sub" style={{ width: "120px" }}>Ahmedabad Ordered</th>
                  <th className="th-pink" style={{ width: "80px" }}>Indore</th>
                  <th className="th-sub" style={{ width: "95px" }}>Indore Transit</th>
                  <th className="th-sub" style={{ width: "105px" }}>Indore Ordered</th>
                  <th className="th-sub" style={{ width: "85px", fontWeight: 700 }}>Total Qty</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="stock-empty-state">
                      No products found matching your search or filters.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr key={item.id}>
                      <td className="td-center">{item.sr_no}</td>
                      <td>
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
                      <td className="td-pink">{item.mumbai}</td>
                      <td className="td-center">{item.mumbai_transit}</td>
                      <td className="td-center">
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
                      <td className="td-center">{item.ahmedabad}</td>
                      <td className="td-center">{item.ahmedabad_transit}</td>
                      <td className="td-center">
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
                      <td className="td-pink">{item.indore}</td>
                      <td className="td-center">{item.indore_transit}</td>
                      <td className="td-center">
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

          {/* Table Footer with Summary Counts */}
          <div className="stock-footer-bar">
            <div>
              Showing <strong>{filteredItems.length}</strong> of <strong>{items.length}</strong> products
            </div>
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
        </div>

        {/* Filter Modal */}
        {showFilterModal && (
          <div className="filter-modal-backdrop" onClick={() => setShowFilterModal(false)}>
            <div className="filter-modal-box" onClick={(e) => e.stopPropagation()}>
              <div className="filter-modal-header">
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#1e293b" }}>
                  Filter Product Stock
                </h3>
                <button
                  type="button"
                  onClick={() => setShowFilterModal(false)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "18px",
                    cursor: "pointer",
                    color: "#94a3b8",
                  }}
                >
                  ✕
                </button>
              </div>

              <div className="filter-modal-body">
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                    Brand
                  </label>
                  <select
                    value={selectedBrand}
                    onChange={(e) => setSelectedBrand(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      fontSize: "13px",
                      color: "#1e293b",
                    }}
                  >
                    <option value="">All Brands</option>
                    {brandOptions.map((brand) => (
                      <option key={brand} value={brand}>
                        {brand}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                    Sub Category
                  </label>
                  <select
                    value={selectedSubCategory}
                    onChange={(e) => setSelectedSubCategory(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      fontSize: "13px",
                      color: "#1e293b",
                    }}
                  >
                    <option value="">All Sub Categories</option>
                    {subCategoryOptions.map((sub) => (
                      <option key={sub} value={sub}>
                        {sub}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                    Stock Availability
                  </label>
                  <select
                    value={selectedStockStatus}
                    onChange={(e) => setSelectedStockStatus(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      fontSize: "13px",
                      color: "#1e293b",
                    }}
                  >
                    <option value="all">All Products</option>
                    <option value="in_stock">In Stock (Total Qty &gt; 0)</option>
                    <option value="mumbai">Mumbai In Stock</option>
                    <option value="ordered">Has Pending Orders</option>
                    <option value="transit">In Transit</option>
                  </select>
                </div>
              </div>

              <div className="filter-modal-footer">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBrand("");
                    setSelectedSubCategory("");
                    setSelectedStockStatus("all");
                  }}
                  style={{
                    padding: "8px 14px",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    borderRadius: "6px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#475569",
                    cursor: "pointer",
                  }}
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => setShowFilterModal(false)}
                  style={{
                    padding: "8px 16px",
                    border: "none",
                    background: "#2563eb",
                    borderRadius: "6px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#ffffff",
                    cursor: "pointer",
                  }}
                >
                  Apply Filters
                </button>
              </div>
            </div>
          </div>
        )}

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
                  { label: "Brand", value: activeItem.brand || "—" },
                  { label: "Sub Category", value: activeItem.sub_category || "—" },
                  { label: "Unit of Measure (UOM)", value: activeItem.uom || "SET" },
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
      </div>
    </AppShell>
  );
}

export default ProductStockPage;
