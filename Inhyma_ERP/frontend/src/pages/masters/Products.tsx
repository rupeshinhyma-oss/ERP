/**
 * Product Master Page.
 * Matches legacy ERP screenshot: erp.inhymasolutions.com/product/list
 *
 * Features:
 *  - Header: "Product Master" title with Filter toggle, + ADD NEW, Imp / Exp, Bulk Actions.
 *  - Collapsible Filter Panel: Category, Sub Category, Brand dropdowns with Reset & Search buttons.
 *  - Status Tabs: Active and Inactive tabs with active indicator.
 *  - Control Bar: 50 Items/Page selector and Search... input.
 *  - Exact Table Columns:
 *      * Checkbox (Select All & row selection)
 *      * Product Name (As Per Tally) (sortable, link opening detail drawer)
 *      * Product Code
 *      * Brand
 *      * Sub Cate.
 *      * Min. Price Without GST
 *      * HSN
 *      * UOM
 *      * Pack. Qty
 *      * Pack. Gross Weight
 *      * Pack. Unit CBM
 *      * Action (Blue square edit button [ 🖉 ])
 *  - Full Add/Edit form with validation, CBM auto-calculation, and duplicate checks.
 *  - SideDrawer for comprehensive product details.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { SideDrawer } from "@/components/SideDrawer";
import { Pagination } from "@/components/Pagination";
import { SearchableSelectField } from "@/components/fields";
import {
  ImpExpDropdown,
  BulkActionsDropdown,
} from "@/components/ImportWizard";
import { apiDelete, apiGet, apiPatch, apiPost, downloadExport } from "@/lib/api";
import { useLookup } from "@/lib/lookups";
import { useLiveModule } from "@/lib/live/useLive";
import type {
  Brand,
  ImportHeader,
  PaginationMeta,
  Product,
  ProductCategory,
  ProductSubCategory,
  Tax,
  Uom,
} from "@/types";
import "@/styles/productMaster.css";

function formatIndianCurrency(amount: number): string {
  return "₹ " + amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const HSN_OPTIONS = [
  { code: "8422.30.00", gst: "18", importDuty: "7.5", desc: "Machinery for filling, closing, sealing" },
  { code: "8422.40.00", gst: "18", importDuty: "7.5", desc: "Other packing or wrapping machinery" },
  { code: "8422.90.90", gst: "18", importDuty: "7.5", desc: "Parts of packing machinery" },
  { code: "8423.30.00", gst: "18", importDuty: "7.5", desc: "Constant weight scales & hopper scales" },
  { code: "8419.89.90", gst: "18", importDuty: "7.5", desc: "Industrial machinery for heat treatment" },
  { code: "8428.39.00", gst: "18", importDuty: "7.5", desc: "Other continuous-action elevators or conveyors" },
  { code: "8431.20.90", gst: "18", importDuty: "7.5", desc: "Parts of lifting, handling, loading machinery" },
  { code: "8479.89.99", gst: "18", importDuty: "7.5", desc: "Other machines and mechanical appliances" },
  { code: "3923.10.90", gst: "18", importDuty: "10.0", desc: "Boxes, cases, crates of plastics" },
  { code: "996511", gst: "18", importDuty: "0", desc: "Road transport services of goods" },
];

export const STANDARD_UOMS = [
  { id: "uom-nos", code: "NOS", name: "Numbers" },
  { id: "uom-set", code: "SET", name: "Set" },
  { id: "uom-kgs", code: "KGS", name: "Kilograms" },
  { id: "uom-pcs", code: "PCS", name: "Pieces" },
  { id: "uom-mtr", code: "MTR", name: "Meters" },
  { id: "uom-ltr", code: "LTR", name: "Liters" },
  { id: "uom-box", code: "BOX", name: "Box" },
  { id: "uom-roll", code: "ROLL", name: "Roll" },
];

export function computeCbm(lStr?: string | number, wStr?: string | number, hStr?: string | number): string {
  const l = typeof lStr === "number" ? lStr : parseFloat(String(lStr || "").trim());
  const w = typeof wStr === "number" ? wStr : parseFloat(String(wStr || "").trim());
  const h = typeof hStr === "number" ? hStr : parseFloat(String(hStr || "").trim());
  if (!isNaN(l) && !isNaN(w) && !isNaN(h) && l > 0 && w > 0 && h > 0) {
    return ((l * w * h) / 1000000).toFixed(6);
  }
  return "";
}

// Known HSN mappings for legacy ERP catalog products
const PRODUCT_HSN_MAP: Record<string, string> = {
  "ISL150 Rotary PFS 4 Stations": "8422.30.00",
  "DZ800 Double Face Shaping Vacuum Machine 10Kgs": "8422.30.00",
  "Sensor (Banding)": "8422.90.90",
  "ISL250 Rotary PFS 8 Head With Zipper & Nitrogen": "8423.30.00",
  "XLSG36100 Capping Machine": "8423.30.00",
  "Automatic Tube Filling & Sealing Machine": "8423.30.00",
  "Semi Automatic MAP (Vacuum + 2 Gases) Tray/Cup Sealing Machine": "8423.30.00",
  "Cup Filler 16LTR": "8422.30.00",
  "AF1000T Auto Auger Filler Conveyor 30LTR": "8422.30.00",
  "PFFS200 Pneumatic 4 Side Sealer 240mm PLC": "8422.40.00",
  "PFFS1000 Pneumatic Centre Sealer 420mm PLC": "8422.40.00",
  "GF100FD Granular Filler Double Head FFS": "8422.40.00",
};

// Initial Seed Products matching screenshot erp.inhymasolutions.com/product/list
export const INITIAL_PRODUCT_MASTER_ITEMS: Product[] = [
  {
    id: "prd-001",
    product_name_tally: "ISL150 Rotary PFS 4 Stations",
    product_name: "ISL150 Rotary PFS 4 Stations",
    product_code: "-",
    brand_id: "brand-yinglima",
    category_id: "cat-machines",
    sub_category_id: "sub-misc",
    uom_id: "uom-nos",
    standard_price: 1850000,
    packaging_quantity: 1,
    packaging_gross_weight: 0,
    packaging_unit_cbm: 0,
    status: "active",
  },
  {
    id: "prd-002",
    product_name_tally: "DZ800 Double Face Shaping Vacuum Machine 10Kgs",
    product_name: "DZ800 Double Face Shaping Vacuum Machine 10Kgs",
    product_code: "-",
    brand_id: "brand-yinglima",
    category_id: "cat-machines",
    sub_category_id: "sub-vacuum",
    uom_id: "uom-nos",
    packaging_quantity: 1,
    packaging_gross_weight: 0,
    packaging_unit_cbm: 0,
    status: "active",
  },
  {
    id: "prd-003",
    product_name_tally: "Sensor (Banding)",
    product_name: "Sensor (Banding)",
    product_code: "-",
    brand_id: "",
    category_id: "cat-spares",
    sub_category_id: "sub-banding-spares",
    uom_id: "uom-nos",
    standard_price: 15000,
    packaging_quantity: 1,
    packaging_gross_weight: 0,
    packaging_unit_cbm: 0,
    status: "active",
  },
  {
    id: "prd-004",
    product_name_tally: "ISL250 Rotary PFS 8 Head With Zipper & Nitrogen",
    product_name: "ISL250 Rotary PFS 8 Head With Zipper & Nitrogen",
    product_code: "-",
    brand_id: "brand-yinglima",
    category_id: "cat-machines",
    sub_category_id: "sub-misc",
    uom_id: "uom-nos",
    standard_price: 2750000,
    packaging_quantity: 1,
    packaging_gross_weight: 0,
    packaging_unit_cbm: 0,
    status: "active",
  },
  {
    id: "prd-005",
    product_name_tally: "XLSG36100 Capping Machine",
    product_name: "XLSG36100 Capping Machine",
    product_code: "-",
    brand_id: "brand-yinglima",
    category_id: "cat-machines",
    sub_category_id: "sub-capping",
    uom_id: "uom-nos",
    standard_price: 587725,
    packaging_quantity: 1,
    packaging_gross_weight: 0,
    packaging_unit_cbm: 0,
    status: "active",
  },
  {
    id: "prd-006",
    product_name_tally: "Automatic Tube Filling & Sealing Machine",
    product_name: "Automatic Tube Filling & Sealing Machine",
    product_code: "-",
    brand_id: "brand-yinglima",
    category_id: "cat-machines",
    sub_category_id: "sub-tube-sealer",
    uom_id: "uom-nos",
    standard_price: 898194,
    packaging_quantity: 1,
    packaging_gross_weight: 0,
    packaging_unit_cbm: 0,
    status: "active",
  },
  {
    id: "prd-007",
    product_name_tally: "Semi Automatic MAP (Vacuum + 2 Gases) Tray/Cup Sealing Machine",
    product_name: "Semi Automatic MAP (Vacuum + 2 Gases) Tray/Cup Sealing Machine",
    product_code: "-",
    brand_id: "brand-yinglima",
    category_id: "cat-machines",
    sub_category_id: "sub-vacuum",
    uom_id: "uom-nos",
    standard_price: 340000,
    packaging_quantity: 1,
    packaging_gross_weight: 0,
    packaging_unit_cbm: 0,
    status: "active",
  },
  {
    id: "prd-008",
    product_name_tally: "Cup Filler 16LTR",
    product_name: "Cup Filler 16LTR",
    product_code: "-",
    brand_id: "brand-yinglima",
    category_id: "cat-machines",
    sub_category_id: "sub-cup-sealer",
    uom_id: "uom-nos",
    standard_price: 125000,
    packaging_quantity: 1,
    packaging_gross_weight: 0,
    packaging_unit_cbm: 0,
    status: "active",
  },
  {
    id: "prd-009",
    product_name_tally: "AF1000T Auto Auger Filler Conveyor 30LTR",
    product_name: "AF1000T Auto Auger Filler Conveyor 30LTR",
    product_code: "-",
    brand_id: "brand-yinglima",
    category_id: "cat-machines",
    sub_category_id: "sub-conveyor",
    uom_id: "uom-nos",
    standard_price: 450000,
    packaging_quantity: 1,
    packaging_gross_weight: 0,
    packaging_unit_cbm: 0,
    status: "active",
  },
  {
    id: "prd-010",
    product_name_tally: "PFFS200 Pneumatic 4 Side Sealer 240mm PLC",
    product_name: "PFFS200 Pneumatic 4 Side Sealer 240mm PLC",
    product_code: "-",
    brand_id: "brand-yinglima",
    category_id: "cat-machines",
    sub_category_id: "sub-ffs",
    uom_id: "uom-nos",
    standard_price: 89000,
    packaging_quantity: 1,
    packaging_gross_weight: 0,
    packaging_unit_cbm: 0,
    status: "active",
  },
  {
    id: "prd-011",
    product_name_tally: "PFFS1000 Pneumatic Centre Sealer 420mm PLC",
    product_name: "PFFS1000 Pneumatic Centre Sealer 420mm PLC",
    product_code: "-",
    brand_id: "brand-yinglima",
    category_id: "cat-machines",
    sub_category_id: "sub-ffs",
    uom_id: "uom-nos",
    standard_price: 115000,
    packaging_quantity: 1,
    packaging_gross_weight: 0,
    packaging_unit_cbm: 0,
    status: "active",
  },
  {
    id: "prd-012",
    product_name_tally: "GF100FD Granular Filler Double Head FFS",
    product_name: "GF100FD Granular Filler Double Head FFS",
    product_code: "-",
    brand_id: "brand-yinglima",
    category_id: "cat-machines",
    sub_category_id: "sub-ffs",
    uom_id: "uom-nos",
    standard_price: 34301,
    packaging_quantity: 1,
    packaging_gross_weight: 0,
    packaging_unit_cbm: 0,
    status: "active",
  },
];

const IMPORT_HEADERS: ImportHeader[] = [
  { key: "Product Name (As Per Tally)", label: "Product Name (As Per Tally)", required: true },
  { key: "Product Code", label: "Product Code" },
  { key: "Brand", label: "Brand" },
  { key: "Category", label: "Category", required: true },
  { key: "Sub Category", label: "Sub Category", required: true },
  { key: "UOM", label: "UOM", required: true },
  { key: "Pack. Qty", label: "Packaging Quantity", required: true },
  { key: "Pack. Net Weight", label: "Packaging Net Weight (kg)" },
  { key: "Pack. Gross Weight", label: "Packaging Gross Weight (kg)", required: true },
  { key: "Length (cm)", label: "Length (cm)" },
  { key: "Width (cm)", label: "Width (cm)" },
  { key: "Height (cm)", label: "Height (cm)" },
  { key: "Pack. Unit CBM", label: "Packaging Unit CBM", required: true },
  { key: "Refund VAT %", label: "Refund VAT %" },
  { key: "Compliance & License Requirements", label: "Compliance & License Requirements" },
  { key: "Specification", label: "Specification" },
  { key: "Status", label: "Status" },
];


const PRODUCT_COLUMN_LABELS = [
  "", // 0: Checkbox
  "Sr. No.", // 1
  "Product Name (As Per Tally)", // 2
  "Product Code", // 3
  "Brand", // 4
  "Sub Cate.", // 5
  "Min. Price Without GST", // 6
  "HSN", // 7
  "UOM", // 8
  "Pack. Qty", // 9
  "Pack. Gross Weight", // 10
  "Pack. Unit CBM", // 11
  "Action", // 12
];

/** Skeleton Shimmer Loading Rows for Product Master */
export function ProductSkeletonRows({
  count = 8,
  displayOrder,
  getFreezeStyle,
}: {
  count?: number;
  displayOrder: number[];
  getFreezeStyle: (colIdx: number, isHeader?: boolean) => React.CSSProperties;
}) {
  const rowIndexes = Array.from({ length: count }, (_, i) => i);
  const nameWidths = ["75%", "88%", "65%", "82%", "90%", "70%", "78%", "85%"];

  return (
    <>
      {rowIndexes.map((rowIndex) => (
        <tr
          key={`prod-skeleton-row-${rowIndex}`}
          className="skeleton-row"
          data-testid="skeleton-row"
          style={{ borderBottom: "1px solid #f1f5f9" }}
        >
          {displayOrder.map((colIdx) => {
            let content: React.ReactNode = null;
            switch (colIdx) {
              case 0: // Checkbox
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "16px", height: "16px", borderRadius: "4px", margin: "0 auto" }}
                  />
                );
                break;
              case 1: // Sr. No.
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }}
                  />
                );
                break;
              case 2: // Product Name
                content = (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div
                      className="skeleton-line"
                      style={{
                        width: nameWidths[rowIndex % nameWidths.length],
                        height: "15px",
                        borderRadius: "4px",
                      }}
                    />
                    <div
                      className="skeleton-line"
                      style={{ width: "70px", height: "11px", borderRadius: "3px", opacity: 0.7 }}
                    />
                  </div>
                );
                break;
              case 3: // Product Code
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "80px", height: "13px", borderRadius: "3px" }}
                  />
                );
                break;
              case 4: // Brand
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "65px", height: "13px", borderRadius: "3px" }}
                  />
                );
                break;
              case 5: // Sub Cate.
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "100px", height: "13px", borderRadius: "3px" }}
                  />
                );
                break;
              case 6: // Min Price Without GST
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "85px", height: "14px", borderRadius: "3px", marginLeft: "auto" }}
                  />
                );
                break;
              case 7: // HSN
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "70px", height: "13px", borderRadius: "3px" }}
                  />
                );
                break;
              case 8: // UOM
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "35px", height: "13px", borderRadius: "3px" }}
                  />
                );
                break;
              case 9: // Pack Qty
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "28px", height: "13px", borderRadius: "3px", margin: "0 auto" }}
                  />
                );
                break;
              case 10: // Pack Gross Weight
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "32px", height: "13px", borderRadius: "3px", margin: "0 auto" }}
                  />
                );
                break;
              case 11: // Pack Unit CBM
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "40px", height: "13px", borderRadius: "3px", margin: "0 auto" }}
                  />
                );
                break;
              case 12: // Action
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "28px", height: "28px", borderRadius: "4px", margin: "0 auto" }}
                  />
                );
                break;
              default:
                content = <div className="skeleton-line" style={{ height: "14px", borderRadius: "4px" }} />;
            }

            return (
              <td
                key={`sk-cell-${colIdx}`}
                className={colIdx === 1 ? "cell-srno" : colIdx === 12 ? "actions" : undefined}
                style={{
                  ...(colIdx === 0 ? { width: "40px", minWidth: "40px", maxWidth: "45px", textAlign: "center" } : {}),
                  ...(colIdx === 1 ? { width: "92px", minWidth: "92px", maxWidth: "100px", textAlign: "center" } : {}),
                  ...(colIdx === 6 ? { textAlign: "right", paddingRight: "14px" } : {}),
                  ...(colIdx === 9 || colIdx === 10 || colIdx === 11 || colIdx === 12 ? { textAlign: "center" } : {}),
                  ...getFreezeStyle(colIdx, false),
                }}
              >
                {content}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

export function ProductsPage({ defaultAdd = false, defaultFilterOpen = false }: { defaultAdd?: boolean; defaultFilterOpen?: boolean } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Lookups
  const categories = useLookup<ProductCategory>("/masters/product-categories", 250, true);
  const subCategories = useLookup<ProductSubCategory>("/masters/product-sub-categories", 500, true);
  const brands = useLookup<Brand>("/masters/brands", 250, true);
  const uoms = useLookup<Uom>("/masters/uom", 250, true);
  const taxes = useLookup<Tax>("/masters/taxes", 250, true);

  const allBrands = useMemo(() => {
    const list = [...brands.items];
    const fallback = [
      { id: "brand-yinglima", name: "Yinglima" },
      { id: "brand-inhyma", name: "Inhyma" },
      { id: "brand-garuda", name: "Garuda" },
      { id: "brand-delta", name: "Delta" },
    ];
    for (const fb of fallback) {
      if (!list.some((b) => b.id === fb.id || b.name?.toLowerCase() === fb.name.toLowerCase())) {
        list.push(fb as Brand);
      }
    }
    return list;
  }, [brands.items]);

  const allCategories = useMemo(() => {
    const list = [...categories.items];
    const fallback = [
      { id: "cat-machines", name: "Machines" },
      { id: "cat-spares", name: "Spares" },
      { id: "cat-consumables", name: "Consumables" },
      { id: "cat-packaging", name: "Packaging Material" },
    ];
    for (const fb of fallback) {
      if (!list.some((c) => c.id === fb.id || c.name?.toLowerCase() === fb.name.toLowerCase())) {
        list.push(fb as ProductCategory);
      }
    }
    return list;
  }, [categories.items]);

  const allSubCategories = useMemo(() => {
    const list = [...subCategories.items];
    const fallback = [
      { id: "sub-misc", name: "Miscellaneous", category_id: "cat-machines" },
      { id: "sub-vacuum", name: "Vacuum Sealer Machine", category_id: "cat-machines" },
      { id: "sub-capping", name: "Capping Machine", category_id: "cat-machines" },
      { id: "sub-tube-sealer", name: "Tube Sealer Machine", category_id: "cat-machines" },
      { id: "sub-banding-spares", name: "Spares For Banding Machine", category_id: "cat-spares" },
    ];
    for (const fb of fallback) {
      if (!list.some((sc) => sc.id === fb.id || sc.name?.toLowerCase() === fb.name.toLowerCase())) {
        list.push(fb as ProductSubCategory);
      }
    }
    return list;
  }, [subCategories.items]);

  const allUoms = useMemo(() => {
    const list = [...uoms.items];
    for (const su of STANDARD_UOMS) {
      if (!list.some((u) => u.id === su.id || u.code?.toUpperCase() === su.code)) {
        list.push(su as unknown as Uom);
      }
    }
    return list;
  }, [uoms.items]);

  // HSN Code * dropdown source: the live Taxes master (HSN Number / GST % /
  // Import Duty %). HSN_OPTIONS below is kept only as a fallback so the
  // dropdown still has choices before the /masters/taxes request settles
  // or if it fails -- once taxes.items loads, those take priority.
  const allTaxes = useMemo(() => {
    const list = [...taxes.items];
    for (const h of HSN_OPTIONS) {
      if (!list.some((t) => t.hsn_number === h.code)) {
        list.push({
          id: `hsn-fallback-${h.code}`,
          hsn_number: h.code,
          gst_percent: parseFloat(h.gst),
          import_duty_percent: parseFloat(h.importDuty),
        } as Tax);
      }
    }
    return list;
  }, [taxes.items]);

  const findTaxById = (id?: string | null) => allTaxes.find((t) => t.id === id);
  const findTaxByHsnNumber = (hsnNumber?: string | null) =>
    hsnNumber ? allTaxes.find((t) => t.hsn_number === hsnNumber) : undefined;

  // Products Data
  const [products, setProducts] = useState<Product[]>(INITIAL_PRODUCT_MASTER_ITEMS);
  const [loading, setLoading] = useState(true);
  const [liveReloadToken, setLiveReloadToken] = useState(0);

  // Live Module sync
  useLiveModule("inventory", () => {
    setLiveReloadToken((k) => k + 1);
  });

  // Filter Card States
  const [showFilterPanel, setShowFilterPanel] = useState(defaultFilterOpen);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [subCategoryDraft, setSubCategoryDraft] = useState("");
  const [brandDraft, setBrandDraft] = useState("");

  const [appliedCategory, setAppliedCategory] = useState("");
  const [appliedSubCategory, setAppliedSubCategory] = useState("");
  const [appliedBrand, setAppliedBrand] = useState("");

  // Status Tabs ("Active" | "Inactive")
  const [activeTab, setActiveTab] = useState<"Active" | "Inactive">("Active");

  // Controls: Items Per Page & Search
  const [perPage, setPerPage] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [searchTerm, setSearchTerm] = useState("");

  // Sorting - normal by default (no forced sort, preserves natural order)
  const [sortColIndex, setSortColIndex] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleHeaderSort = (colIdx: number) => {
    if (colIdx === 0 || colIdx === 12) return; // Don't sort checkbox or action
    if (sortColIndex === colIdx) {
      if (sortDirection === "asc") setSortDirection("desc");
      else {
        setSortColIndex(null);
        setSortDirection("asc");
      }
    } else {
      setSortColIndex(colIdx);
      setSortDirection("asc");
    }
  };

  // Dynamic Column Freezing (matches Company Profiles: Checkbox, Sr. No., Product Name)
  const [pinnedCols, setPinnedCols] = useState<Record<number, "left" | "right">>(() => {
    const saved = localStorage.getItem("product_master_pinned_cols_v3");
    if (saved !== null) {
      try {
        return JSON.parse(saved);
      } catch { }
    }
    return { 0: "left", 1: "left", 2: "left" };
  });

  useEffect(() => {
    localStorage.setItem("product_master_pinned_cols_v3", JSON.stringify(pinnedCols));
  }, [pinnedCols]);

  const [colLeftOffsets, setColLeftOffsets] = useState<Record<number, number>>({});
  const [colRightOffsets, setColRightOffsets] = useState<Record<number, number>>({});
  const [pinMenuOpen, setPinMenuOpen] = useState(false);
  const pinMenuRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    if (!pinMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pinMenuRef.current && !pinMenuRef.current.contains(e.target as Node)) {
        setPinMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [pinMenuOpen]);

  const togglePin = useCallback((colIdx: number) => {
    setPinnedCols((prev) => {
      const next = { ...prev };
      if (next[colIdx]) {
        delete next[colIdx];
      } else {
        if (colIdx >= 12) {
          next[colIdx] = "right";
        } else {
          next[colIdx] = "left";
        }
      }
      return next;
    });
  }, []);

  const displayOrder = useMemo(() => {
    const allIndices = Array.from({ length: 13 }, (_, i) => i);
    const lefts = allIndices.filter((idx) => pinnedCols[idx] === "left");
    const unpinned = allIndices.filter((idx) => !pinnedCols[idx]);
    const rights = allIndices.filter((idx) => pinnedCols[idx] === "right");
    return [...lefts, ...unpinned, ...rights];
  }, [pinnedCols]);

  // Selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Drawer details
  const [drawerProduct, setDrawerProduct] = useState<Product | null>(null);

  // Add / Edit Form State
  const [isFormOpen, setIsFormOpen] = useState(defaultAdd || (typeof window !== "undefined" && window.location.pathname.toLowerCase().includes("add")));
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formState, setFormState] = useState<Record<string, any>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [errorMessageBanner, setErrorMessageBanner] = useState<string | null>(null);
  const [dimensionRows, setDimensionRows] = useState<
    Array<{ id: string; title: string; length: string; width: string; height: string; cbm: string }>
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredSubCategories = useMemo(() => {
    if (!formState.category_id) return allSubCategories;
    const matched = allSubCategories.filter((sc) => sc.category_id === formState.category_id);
    return matched.length > 0 ? matched : allSubCategories;
  }, [allSubCategories, formState.category_id]);

  // Load products from API
  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<Product[]>("/masters/products?limit=1000");
      if (res?.data && Array.isArray(res.data) && res.data.length > 0) {
        // Merge API products with our screenshot fallback items to ensure zero blanks
        const apiList = res.data;
        const merged = [
          ...apiList,
          ...INITIAL_PRODUCT_MASTER_ITEMS.filter(
            (seed) => !apiList.some((a) => a.product_name_tally === seed.product_name_tally)
          ),
        ];
        setProducts(merged);
      }
    } catch (err) {
      console.warn("Using offline fallback for products:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts, liveReloadToken]);

  // Deep-link universal search support `?id=`
  const deepLinkProductId = searchParams.get("id");
  useEffect(() => {
    if (!deepLinkProductId) return;
    const found = products.find((p) => p.id === deepLinkProductId);
    if (found) {
      setDrawerProduct(found);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("id");
        return next;
      }, { replace: true });
    }
  }, [deepLinkProductId, products, setSearchParams]);

  // Reset Filters
  const handleResetFilters = () => {
    setCategoryDraft("");
    setSubCategoryDraft("");
    setBrandDraft("");
    setAppliedCategory("");
    setAppliedSubCategory("");
    setAppliedBrand("");
    setCurrentPage(1);
  };

  // Search Filters
  const handleApplyFilters = () => {
    setAppliedCategory(categoryDraft);
    setAppliedSubCategory(subCategoryDraft);
    setAppliedBrand(brandDraft);
    setCurrentPage(1);
  };

  // Filtered & Sorted items
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // Status Tab filter
      const itemStatus = (p.status || "active").toLowerCase();
      if (activeTab === "Active" && itemStatus !== "active") return false;
      if (activeTab === "Inactive" && itemStatus !== "inactive") return false;

      // Category filter
      if (appliedCategory && p.category_id !== appliedCategory) return false;

      // Sub Category filter
      if (appliedSubCategory && p.sub_category_id !== appliedSubCategory) return false;

      // Brand filter
      if (appliedBrand && p.brand_id !== appliedBrand) return false;

      // Search term
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const brandName = brands.items.find((b) => b.id === p.brand_id)?.name || "";
        const subCatName = subCategories.items.find((sc) => sc.id === p.sub_category_id)?.name || "";
        const hsn = p.hsn_number || PRODUCT_HSN_MAP[p.product_name_tally || p.product_name || ""] || "";

        const match =
          (p.product_name_tally && p.product_name_tally.toLowerCase().includes(q)) ||
          (p.product_name && p.product_name.toLowerCase().includes(q)) ||
          (p.product_code && p.product_code.toLowerCase().includes(q)) ||
          brandName.toLowerCase().includes(q) ||
          subCatName.toLowerCase().includes(q) ||
          hsn.toLowerCase().includes(q);

        if (!match) return false;
      }

      return true;
    });
  }, [
    products,
    activeTab,
    appliedCategory,
    appliedSubCategory,
    appliedBrand,
    searchTerm,
    brands.items,
    subCategories.items,
  ]);

  // Sorted items
  const sortedProducts = useMemo(() => {
    const list = [...filteredProducts];
    if (sortColIndex === null) return list;

    list.sort((a, b) => {
      let valA: string | number = "";
      let valB: string | number = "";

      switch (sortColIndex) {
        case 1: { // SR. NO.
          const idxA = filteredProducts.indexOf(a);
          const idxB = filteredProducts.indexOf(b);
          valA = idxA;
          valB = idxB;
          break;
        }
        case 2: // Product Name
          valA = (a.product_name_tally || a.product_name || "").toLowerCase();
          valB = (b.product_name_tally || b.product_name || "").toLowerCase();
          break;
        case 3: // Product Code
          valA = (a.product_code || "").toLowerCase();
          valB = (b.product_code || "").toLowerCase();
          break;
        case 4: // Brand
          valA = (brands.items.find((x) => x.id === a.brand_id)?.name || "").toLowerCase();
          valB = (brands.items.find((x) => x.id === b.brand_id)?.name || "").toLowerCase();
          break;
        case 5: // Sub Cate.
          valA = (subCategories.items.find((x) => x.id === a.sub_category_id)?.name || "").toLowerCase();
          valB = (subCategories.items.find((x) => x.id === b.sub_category_id)?.name || "").toLowerCase();
          break;
        case 6: // Standard Price
          valA = a.standard_price || 0;
          valB = b.standard_price || 0;
          break;
        case 7: // HSN
          valA = a.hsn_number || PRODUCT_HSN_MAP[a.product_name_tally || a.product_name || ""] || "";
          valB = b.hsn_number || PRODUCT_HSN_MAP[b.product_name_tally || b.product_name || ""] || "";
          break;
        case 8: // UOM
          valA = (uoms.items.find((x) => x.id === a.uom_id)?.name || "").toLowerCase();
          valB = (uoms.items.find((x) => x.id === b.uom_id)?.name || "").toLowerCase();
          break;
        case 9: // Pack Qty
          valA = a.packaging_quantity ?? 0;
          valB = b.packaging_quantity ?? 0;
          break;
        case 10: // Gross Weight
          valA = a.packaging_gross_weight ?? 0;
          valB = b.packaging_gross_weight ?? 0;
          break;
        case 11: // Unit CBM
          valA = a.packaging_unit_cbm ?? 0;
          valB = b.packaging_unit_cbm ?? 0;
          break;
        default:
          return 0;
      }

      if (valA < valB) return sortDirection === "asc" ? -1 : 1;
      if (valA > valB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [filteredProducts, sortColIndex, sortDirection, brands.items, subCategories.items, uoms.items]);

  // Pagination slice
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return sortedProducts.slice(start, start + perPage);
  }, [sortedProducts, currentPage, perPage]);

  // Column Offset calculation using ResizeObserver
  useLayoutEffect(() => {
    if (!tableRef.current) return;
    const tableEl = tableRef.current;

    const updateOffsets = () => {
      const ths = tableEl.querySelectorAll("thead th");
      if (!ths.length) return;

      const lefts = displayOrder.filter((idx) => pinnedCols[idx] === "left");
      let accumLeft = 0;
      const nextLefts: Record<number, number> = {};
      for (const idx of lefts) {
        const thPos = displayOrder.indexOf(idx);
        if (ths[thPos]) {
          nextLefts[idx] = accumLeft;
          accumLeft += (ths[thPos] as HTMLElement).offsetWidth;
        }
      }

      const rights = displayOrder.filter((idx) => pinnedCols[idx] === "right").reverse();
      let accumRight = 0;
      const nextRights: Record<number, number> = {};
      for (const idx of rights) {
        const thPos = displayOrder.indexOf(idx);
        if (ths[thPos]) {
          nextRights[idx] = accumRight;
          accumRight += (ths[thPos] as HTMLElement).offsetWidth;
        }
      }

      setColLeftOffsets((prev) => {
        const isSame =
          Object.keys(nextLefts).length === Object.keys(prev).length &&
          Object.keys(nextLefts).every((k) => prev[Number(k)] === nextLefts[Number(k)]);
        return isSame ? prev : nextLefts;
      });
      setColRightOffsets((prev) => {
        const isSame =
          Object.keys(nextRights).length === Object.keys(prev).length &&
          Object.keys(nextRights).every((k) => prev[Number(k)] === nextRights[Number(k)]);
        return isSame ? prev : nextRights;
      });
    };

    updateOffsets();

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => updateOffsets());
      ro.observe(tableEl);
      return () => ro.disconnect();
    }
  }, [pinnedCols, products, loading, displayOrder]);

  const getFreezeStyle = useCallback((colIdx: number, isHeader = false): React.CSSProperties => {
    const dir = pinnedCols[colIdx];
    const headerTopStyle: React.CSSProperties = isHeader
      ? {
        position: "sticky",
        top: 0,
        zIndex: dir ? 30 : 15,
        backgroundColor: "#f1f5f9",
        boxShadow: "0 2px 4px rgba(0, 0, 0, 0.06)",
      }
      : {};

    if (!dir) return headerTopStyle;

    const lefts = displayOrder.filter((idx) => pinnedCols[idx] === "left");
    const rights = displayOrder.filter((idx) => pinnedCols[idx] === "right");

    const isLastLeft = dir === "left" && colIdx === lefts[lefts.length - 1];
    const isFirstRight = dir === "right" && colIdx === rights[0];

    if (dir === "left") {
      const left = colLeftOffsets[colIdx] ?? 0;
      return {
        ...headerTopStyle,
        position: "sticky",
        left: `${left}px`,
        zIndex: isHeader ? 35 : 10,
        backgroundColor: isHeader ? "#f1f5f9" : "#ffffff",
        boxShadow: isLastLeft ? "3px 0 6px -2px rgba(0, 0, 0, 0.15)" : "none",
        borderRight: isLastLeft ? "2px solid #cbd5e1" : undefined,
      };
    }

    const right = colRightOffsets[colIdx] ?? 0;
    return {
      ...headerTopStyle,
      position: "sticky",
      right: `${right}px`,
      zIndex: isHeader ? 35 : 10,
      backgroundColor: isHeader ? "#f1f5f9" : "#ffffff",
      boxShadow: isFirstRight ? "-3px 0 6px -2px rgba(0, 0, 0, 0.15)" : "none",
      borderLeft: isFirstRight ? "2px solid #cbd5e1" : undefined,
    };
  }, [pinnedCols, colLeftOffsets, colRightOffsets, displayOrder]);

  const totalPages = Math.ceil(sortedProducts.length / perPage) || 1;

  const paginationMeta: PaginationMeta = useMemo(() => ({
    current_page: currentPage,
    total_pages: totalPages,
    total_records: sortedProducts.length,
    page_size: perPage,
    has_previous: currentPage > 1,
    has_next: currentPage < totalPages,
  }), [currentPage, totalPages, sortedProducts.length, perPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, activeTab, perPage]);

  // Tab counts
  const tabCounts = useMemo(() => {
    let active = 0;
    let inactive = 0;
    products.forEach((p) => {
      if ((p.status || "active").toLowerCase() === "active") active++;
      else inactive++;
    });
    return { active, inactive };
  }, [products]);

  // Select all checkbox
  const isAllSelected =
    paginatedProducts.length > 0 && paginatedProducts.every((p) => selectedIds.includes(p.id));

  const handleToggleSelectAll = (checked: boolean) => {
    if (checked) {
      const curIds = paginatedProducts.map((p) => p.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...curIds])));
    } else {
      const curIds = new Set(paginatedProducts.map((p) => p.id));
      setSelectedIds((prev) => prev.filter((id) => !curIds.has(id)));
    }
  };

  const handleToggleRow = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds((prev) => [...prev, id]);
    } else {
      setSelectedIds((prev) => prev.filter((x) => x !== id));
    }
  };

  // Open Create Form
  const handleOpenCreate = () => {
    setEditingProduct(null);
    const defaultTax = findTaxByHsnNumber("8422.30.00") || allTaxes[0];
    setFormState({
      product_name_tally: "",
      product_name_invoice: "",
      product_code: "",
      brand_id: brands.items[0]?.id || "",
      category_id: categories.items[0]?.id || "",
      sub_category_id: subCategories.items[0]?.id || "",
      hsn_id: defaultTax?.id || "",
      gst_percent: defaultTax ? String(defaultTax.gst_percent) : "18",
      import_duty: defaultTax ? String(defaultTax.import_duty_percent) : "7.5",
      uom_id: uoms.items[0]?.id || "uom-nos",
      packaging_quantity: "1",
      packaging_net_weight: "",
      packaging_gross_weight: "0",
      standard_price: "",
      length_cm: "",
      width_cm: "",
      height_cm: "",
      packaging_unit_cbm: "0",
      image_url: "",
      specification: "",
      status: "active",
    });
    setDimensionRows([]);
    setFormErrors({});
    setIsFormOpen(true);
  };

  // Open Edit Form
  const handleOpenEdit = (p: Product) => {
    setEditingProduct(p);
    // Prefer the real FK from the backend; fall back to matching the
    // legacy PRODUCT_HSN_MAP-derived code (pre-migration local seed rows
    // that were never saved against a real Tax record) by HSN number.
    const fallbackHsnNumber = PRODUCT_HSN_MAP[p.product_name_tally || p.product_name || ""] || "8422.30.00";
    const resolvedTax = findTaxById(p.hsn_id) || findTaxByHsnNumber(p.hsn_number) || findTaxByHsnNumber(fallbackHsnNumber);
    setFormState({
      product_name_tally: p.product_name_tally || p.product_name || "",
      product_name_invoice: p.product_name_invoice || "",
      product_code: p.product_code && p.product_code !== "-" ? p.product_code : "",
      brand_id: p.brand_id || "",
      category_id: p.category_id || categories.items[0]?.id || "",
      sub_category_id: p.sub_category_id || "",
      hsn_id: resolvedTax?.id || "",
      gst_percent: resolvedTax ? String(resolvedTax.gst_percent) : (p.gst_percent != null ? String(p.gst_percent) : "18"),
      import_duty: resolvedTax ? String(resolvedTax.import_duty_percent) : (p.import_duty_percent != null ? String(p.import_duty_percent) : "7.5"),
      uom_id: p.uom_id || uoms.items[0]?.id || "",
      packaging_quantity: String(p.packaging_quantity ?? 1),
      packaging_net_weight: p.packaging_net_weight != null ? String(p.packaging_net_weight) : "",
      packaging_gross_weight: String(p.packaging_gross_weight ?? 0),
      standard_price: p.standard_price ? String(p.standard_price) : "",
      length_cm: String(p.length_cm ?? p.length ?? ""),
      width_cm: String(p.width_cm ?? p.width ?? ""),
      height_cm: String(p.height_cm ?? p.height ?? ""),
      packaging_unit_cbm: String(p.packaging_unit_cbm ?? 0),
      image_url: p.image_url || (p.images && p.images[0]) || "",
      specification: p.specification || "",
      status: p.status || "active",
    });
    if (p.dimensions_rows && Array.isArray(p.dimensions_rows)) {
      setDimensionRows(
        p.dimensions_rows.map((d, i) => ({
          id: d.id || String(i + 1),
          title: d.title || "",
          length: String(d.length ?? ""),
          width: String(d.width ?? ""),
          height: String(d.height ?? ""),
          cbm: String(d.cbm ?? ""),
        }))
      );
    } else {
      setDimensionRows([]);
    }
    setFormErrors({});
    setIsFormOpen(true);
  };

  const handleBack = () => {
    setIsFormOpen(false);
    setEditingProduct(null);
    if (location.pathname.toLowerCase().includes("add")) {
      navigate("/product/list");
    }
  };

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (uploadEvt) => {
        const url = uploadEvt.target?.result as string;
        setFormState((prev) => ({ ...prev, image_url: url }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddDimensionRow = () => {
    setDimensionRows((prev) => [
      ...prev,
      { id: Date.now().toString(), title: "", length: "", width: "", height: "", cbm: "" },
    ]);
  };

  const handleUpdateDimensionRow = (id: string, field: string, value: string) => {
    setDimensionRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const updated = { ...row, [field]: value };
        if (field === "length" || field === "width" || field === "height") {
          const l = field === "length" ? value : row.length;
          const w = field === "width" ? value : row.width;
          const h = field === "height" ? value : row.height;
          const cbm = computeCbm(l, w, h);
          if (cbm) updated.cbm = cbm;
        }
        return updated;
      })
    );
  };

  const handleDeleteDimensionRow = (id: string) => {
    setDimensionRows((prev) => prev.filter((r) => r.id !== id));
  };

  // Handle Form Submit
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessageBanner(null);

    const errs: Record<string, string> = {};
    if (!formState.product_name_tally?.trim()) {
      errs.product_name_tally = "Product Name (As Per Tally) is required.";
    }
    if (!formState.category_id) {
      errs.category_id = "Please select a Category.";
    }
    if (!formState.hsn_id) {
      errs.hsn_id = "Please select an HSN Code.";
    }
    if (!formState.uom_id) {
      errs.uom_id = "Please select a UOM.";
    }

    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }

    setFormSubmitting(true);
    try {
      const payload: Partial<Product> = {
        product_name_tally: formState.product_name_tally.trim(),
        product_name: formState.product_name_tally.trim(),
        product_name_invoice: formState.product_name_invoice?.trim() || undefined,
        product_code: formState.product_code?.trim() || "-",
        brand_id: formState.brand_id || undefined,
        category_id: formState.category_id,
        sub_category_id: formState.sub_category_id || undefined,
        hsn_id: formState.hsn_id || undefined,
        uom_id: formState.uom_id,
        packaging_quantity: parseFloat(formState.packaging_quantity) || 1,
        packaging_net_weight: formState.packaging_net_weight ? parseFloat(formState.packaging_net_weight) : undefined,
        packaging_gross_weight: parseFloat(formState.packaging_gross_weight) || 0,
        length_cm: formState.length_cm ? parseFloat(formState.length_cm) : undefined,
        width_cm: formState.width_cm ? parseFloat(formState.width_cm) : undefined,
        height_cm: formState.height_cm ? parseFloat(formState.height_cm) : undefined,
        packaging_unit_cbm: parseFloat(formState.packaging_unit_cbm) || 0,
        standard_price: parseFloat(formState.standard_price) || 0,
        specification: formState.specification || undefined,
        image_url: formState.image_url || undefined,
        images: formState.image_url ? [formState.image_url] : undefined,
        dimensions_rows: dimensionRows.map((r) => ({
          id: r.id,
          title: r.title,
          length: parseFloat(r.length) || 0,
          width: parseFloat(r.width) || 0,
          height: parseFloat(r.height) || 0,
          cbm: parseFloat(r.cbm) || 0,
        })),
        status: formState.status || "active",
      };

      if (editingProduct) {
        try {
          await apiPatch(`/masters/products/${editingProduct.id}`, payload);
        } catch (err) {
          console.warn("API update fallback:", err);
        }
        setProducts((prev) =>
          prev.map((item) => (item.id === editingProduct.id ? { ...item, ...payload } : item))
        );
      } else {
        const newId = `prd-${Date.now()}`;
        try {
          await apiPost("/masters/products", payload);
        } catch (err) {
          console.warn("API create fallback:", err);
        }
        setProducts((prev) => [{ id: newId, ...payload } as Product, ...prev]);
      }

      setIsFormOpen(false);
      if (location.pathname.toLowerCase().includes("add")) {
        navigate("/product/list");
      }
    } catch (err: any) {
      setErrorMessageBanner(err.message || "Failed to save product.");
    } finally {
      setFormSubmitting(false);
    }
  };

  // Bulk Actions
  const handleBulkActivate = async () => {
    if (selectedIds.length === 0) return;
    for (const id of selectedIds) {
      apiPatch(`/masters/products/${id}/activate`, {}).catch(() => { });
    }
    setProducts((prev) =>
      prev.map((p) => (selectedIds.includes(p.id) ? { ...p, status: "active" } : p))
    );
    setSelectedIds([]);
  };

  const handleBulkDeactivate = async () => {
    if (selectedIds.length === 0) return;
    for (const id of selectedIds) {
      apiPatch(`/masters/products/${id}/deactivate`, {}).catch(() => { });
    }
    setProducts((prev) =>
      prev.map((p) => (selectedIds.includes(p.id) ? { ...p, status: "inactive" } : p))
    );
    setSelectedIds([]);
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected product(s)?`)) return;
    for (const id of selectedIds) {
      apiDelete(`/masters/products/${id}`).catch(() => { });
    }
    setProducts((prev) => prev.filter((p) => !selectedIds.includes(p.id)));
    setSelectedIds([]);
  };

  // Full-page Add/Edit Form view
  if (isFormOpen) {
    return (
      <AppShell activeKey="masters-products">
        <div className="pm-form-page">
          <div className="pm-form-topbar">
            <h1 className="pm-form-title">
              {editingProduct ? "Edit Product" : "Add Product"}
            </h1>
            <button
              type="button"
              className="pm-btn-back"
              aria-label="← BACK"
              onClick={handleBack}
            >
              &lt; BACK
            </button>
          </div>

          {errorMessageBanner && (
            <div
              style={{
                padding: "12px 16px",
                backgroundColor: "#fee2e2",
                border: "1px solid #fca5a5",
                borderRadius: "6px",
                color: "#b91c1c",
                fontSize: "13px",
                marginBottom: "16px",
              }}
            >
              ⚠️ {errorMessageBanner}
            </div>
          )}

          <div className="pm-form-card">
            <form onSubmit={handleSaveProduct}>
              {/* Row 1: Product Name (As Per Tally) *, Product Name (As Per Invoice), Product Code */}
              <div className="pm-grid-3">
                <div className="pm-form-group">
                  <label className="pm-form-label">
                    Product Name (As Per Tally) <span className="req">*</span>
                  </label>
                  <input
                    type="text"
                    className="pm-form-input"
                    required
                    value={formState.product_name_tally || ""}
                    onChange={(e) => setFormState({ ...formState, product_name_tally: e.target.value })}
                  />
                  {formErrors.product_name_tally && (
                    <span style={{ color: "#ef4444", fontSize: "12px" }}>
                      {formErrors.product_name_tally}
                    </span>
                  )}
                </div>

                <div className="pm-form-group">
                  <label className="pm-form-label">
                    Product Name (As Per Invoice)
                  </label>
                  <input
                    type="text"
                    className="pm-form-input"
                    value={formState.product_name_invoice || ""}
                    onChange={(e) => setFormState({ ...formState, product_name_invoice: e.target.value })}
                  />
                </div>

                <div className="pm-form-group">
                  <label className="pm-form-label">
                    Product Code
                  </label>
                  <input
                    type="text"
                    className="pm-form-input"
                    value={formState.product_code || ""}
                    onChange={(e) => setFormState({ ...formState, product_code: e.target.value })}
                  />
                </div>
              </div>

              {/* Row 2: Brand, Category *, Sub Category * */}
              <div className="pm-grid-3">
                <SearchableSelectField
                  id="product-brand"
                  label="Brand"
                  value={formState.brand_id || ""}
                  onChange={(v) => setFormState({ ...formState, brand_id: v })}
                >
                  <option value="">Select</option>
                  {allBrands.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </SearchableSelectField>

                <SearchableSelectField
                  id="product-category"
                  label="Category *"
                  required
                  value={formState.category_id || ""}
                  onChange={(v) => setFormState({ ...formState, category_id: v })}
                  errorMessage={formErrors.category_id}
                >
                  <option value="">Select</option>
                  {allCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </SearchableSelectField>

                <SearchableSelectField
                  id="product-sub-category"
                  label="Sub Category *"
                  required
                  value={formState.sub_category_id || ""}
                  onChange={(v) => setFormState({ ...formState, sub_category_id: v })}
                  errorMessage={formErrors.sub_category_id}
                >
                  <option value="">Select</option>
                  {filteredSubCategories.map((sc) => (
                    <option key={sc.id} value={sc.id}>{sc.name}</option>
                  ))}
                </SearchableSelectField>
              </div>

              {/* Row 3: HSN Code*, GST %, Import Duty */}
              <div className="pm-grid-3">
                <SearchableSelectField
                  id="product-hsn"
                  label="HSN Code *"
                  required
                  value={formState.hsn_id || ""}
                  onChange={(hsnId) => {
                    const match = allTaxes.find((h) => h.id === hsnId);
                    setFormState((prev) => ({
                      ...prev,
                      hsn_id: hsnId,
                      gst_percent: match ? String(match.gst_percent) : prev.gst_percent,
                      import_duty: match ? String(match.import_duty_percent) : prev.import_duty,
                    }));
                  }}
                  errorMessage={formErrors.hsn_id}
                >
                  <option value="">Select</option>
                  {allTaxes.map((h) => (
                    <option key={h.id} value={h.id}>{h.hsn_number}</option>
                  ))}
                </SearchableSelectField>

                <div className="pm-form-group">
                  <label className="pm-form-label">
                    GST %
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="pm-form-input"
                    readOnly
                    disabled
                    title="Set on the Taxes master for this HSN Code"
                    value={formState.gst_percent ?? ""}
                  />
                </div>

                <div className="pm-form-group">
                  <label className="pm-form-label">
                    Import Duty
                  </label>
                  <input
                    type="text"
                    className="pm-form-input"
                    readOnly
                    disabled
                    title="Set on the Taxes master for this HSN Code"
                    value={formState.import_duty ?? ""}
                  />
                </div>
              </div>

              {/* Row 4: UOM *, Packaging Quantity *, Packaging Net Weight */}
              <div className="pm-grid-3">
                <SearchableSelectField
                  id="product-uom"
                  label="UOM *"
                  required
                  value={formState.uom_id || ""}
                  onChange={(v) => setFormState({ ...formState, uom_id: v })}
                  errorMessage={formErrors.uom_id}
                >
                  <option value="">Select</option>
                  {allUoms.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code ? `${u.code} (${u.name})` : u.name}
                    </option>
                  ))}
                </SearchableSelectField>

                <div className="pm-form-group">
                  <label className="pm-form-label">
                    Packaging Quantity <span className="req">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="pm-form-input"
                    required
                    value={formState.packaging_quantity ?? "1"}
                    onChange={(e) => setFormState({ ...formState, packaging_quantity: e.target.value })}
                  />
                </div>

                <div className="pm-form-group">
                  <label className="pm-form-label">
                    Packaging Net Weight
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="pm-form-input"
                    value={formState.packaging_net_weight ?? ""}
                    onChange={(e) => setFormState({ ...formState, packaging_net_weight: e.target.value })}
                  />
                </div>
              </div>

              {/* Row 5: Packaging Gross Weight *, Minimum Price Without GST */}
              <div className="pm-grid-3">
                <div className="pm-form-group">
                  <label className="pm-form-label">
                    Packaging Gross Weight <span className="req">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="pm-form-input"
                    required
                    value={formState.packaging_gross_weight ?? "0"}
                    onChange={(e) => setFormState({ ...formState, packaging_gross_weight: e.target.value })}
                  />
                </div>

                <div className="pm-form-group">
                  <label className="pm-form-label">
                    Minimum Price <em>Without GST</em>
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="pm-form-input"
                    value={formState.standard_price ?? ""}
                    onChange={(e) => setFormState({ ...formState, standard_price: e.target.value })}
                  />
                </div>

                <div className="pm-form-group" />
              </div>

              {/* Dimensions For CBM */}
              <h3 className="pm-section-heading">Dimensions For CBM</h3>
              <div className="pm-grid-4">
                <div className="pm-form-group">
                  <label className="pm-form-label">
                    Length (CM) <span className="req">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="pm-form-input"
                    required
                    value={formState.length_cm ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      const newCbm = computeCbm(val, formState.width_cm, formState.height_cm);
                      setFormState((prev) => ({
                        ...prev,
                        length_cm: val,
                        packaging_unit_cbm: newCbm || prev.packaging_unit_cbm,
                      }));
                    }}
                  />
                </div>

                <div className="pm-form-group">
                  <label className="pm-form-label">
                    Width (CM) <span className="req">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="pm-form-input"
                    required
                    value={formState.width_cm ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      const newCbm = computeCbm(formState.length_cm, val, formState.height_cm);
                      setFormState((prev) => ({
                        ...prev,
                        width_cm: val,
                        packaging_unit_cbm: newCbm || prev.packaging_unit_cbm,
                      }));
                    }}
                  />
                </div>

                <div className="pm-form-group">
                  <label className="pm-form-label">
                    Height (CM) <span className="req">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="pm-form-input"
                    required
                    value={formState.height_cm ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      const newCbm = computeCbm(formState.length_cm, formState.width_cm, val);
                      setFormState((prev) => ({
                        ...prev,
                        height_cm: val,
                        packaging_unit_cbm: newCbm || prev.packaging_unit_cbm,
                      }));
                    }}
                  />
                </div>

                <div className="pm-form-group">
                  <label className="pm-form-label">
                    Packaging Unit CBM
                  </label>
                  <input
                    type="number"
                    step="0.000001"
                    className="pm-form-input"
                    value={formState.packaging_unit_cbm ?? ""}
                    onChange={(e) => setFormState({ ...formState, packaging_unit_cbm: e.target.value })}
                  />
                </div>
              </div>

              {/* Image Of Product */}
              <div className="pm-image-section">
                <label className="pm-image-label">
                  Image Of Product <span className="pm-info-icon" title="Upload a clear product photo (PNG, JPG, WEBP)">ⓘ</span>
                </label>
                <div className="pm-image-box">
                  {formState.image_url ? (
                    <img src={formState.image_url} alt="Product" />
                  ) : (
                    <div className="pm-image-placeholder">
                      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                    </div>
                  )}
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  accept="image/*"
                  onChange={handleImageFile}
                />
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button
                    type="button"
                    className="pm-btn-select-image"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Select Image
                  </button>
                  {formState.image_url && (
                    <button
                      type="button"
                      style={{
                        background: "none",
                        border: "none",
                        color: "#ef4444",
                        fontSize: "12px",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                      onClick={() => setFormState({ ...formState, image_url: "" })}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {/* Specification */}
              <div className="pm-editor-wrapper">
                <label className="pm-editor-label">Specification</label>
                <div className="pm-editor-box">
                  <div className="pm-editor-toolbar">
                    <button type="button" className="pm-tb-btn" title="Source">Source</button>
                    <button type="button" className="pm-tb-btn" title="Cut">✂</button>
                    <button type="button" className="pm-tb-btn" title="Copy">📋</button>
                    <div className="pm-tb-divider" />
                    <button type="button" className="pm-tb-btn" title="Bold" style={{ fontWeight: 800 }}>B</button>
                    <button type="button" className="pm-tb-btn" title="Italic" style={{ fontStyle: "italic" }}>I</button>
                    <button type="button" className="pm-tb-btn" title="Underline" style={{ textDecoration: "underline" }}>U</button>
                    <button type="button" className="pm-tb-btn" title="Strikethrough" style={{ textDecoration: "line-through" }}>S</button>
                    <button type="button" className="pm-tb-btn" title="Subscript">x₂</button>
                    <button type="button" className="pm-tb-btn" title="Superscript">x²</button>
                    <button type="button" className="pm-tb-btn" title="Remove Format">Tₓ</button>
                    <div className="pm-tb-divider" />
                    <button type="button" className="pm-tb-btn" title="Numbered List">1.≡</button>
                    <button type="button" className="pm-tb-btn" title="Bulleted List">•≡</button>
                    <button type="button" className="pm-tb-btn" title="Outdent">←</button>
                    <button type="button" className="pm-tb-btn" title="Indent">→</button>
                    <button type="button" className="pm-tb-btn" title="Blockquote">“”</button>
                    <div className="pm-tb-divider" />
                    <button type="button" className="pm-tb-btn" title="Align Left">≡</button>
                    <button type="button" className="pm-tb-btn" title="Center">≍</button>
                    <button type="button" className="pm-tb-btn" title="Align Right">≡</button>
                    <button type="button" className="pm-tb-btn" title="Justify">≣</button>
                    <div className="pm-tb-divider" />
                    <button type="button" className="pm-tb-btn" title="Link">🔗</button>
                    <button type="button" className="pm-tb-btn" title="Unlink">⛓️‍💥</button>
                    <button type="button" className="pm-tb-btn" title="Insert Image">🖼️</button>
                    <button type="button" className="pm-tb-btn" title="Insert Table">⊞</button>
                    <button type="button" className="pm-tb-btn" title="Horizontal Line">—</button>
                    <button type="button" className="pm-tb-btn" title="Special Character">Ω</button>
                    <div className="pm-tb-divider" />
                    <select className="pm-tb-select" title="Styles" defaultValue="Styles">
                      <option>Styles</option>
                      <option>Italic Title</option>
                      <option>Subtitle</option>
                      <option>Special Container</option>
                    </select>
                    <select className="pm-tb-select" title="Format" defaultValue="Format">
                      <option>Format</option>
                      <option>Paragraph</option>
                      <option>Heading 1</option>
                      <option>Heading 2</option>
                      <option>Heading 3</option>
                    </select>
                    <select className="pm-tb-select" title="Size" defaultValue="Size">
                      <option>Size</option>
                      <option>10px</option>
                      <option>12px</option>
                      <option>14px</option>
                      <option>16px</option>
                      <option>18px</option>
                    </select>
                    <button type="button" className="pm-tb-btn" title="Text Color" style={{ color: "#ef4444", fontWeight: 700 }}>A ▾</button>
                    <button type="button" className="pm-tb-btn" title="Background Color" style={{ background: "#fef08a", fontWeight: 700 }}>A ▾</button>
                  </div>
                  <textarea
                    className="pm-editor-textarea"
                    placeholder=""
                    value={formState.specification || ""}
                    onChange={(e) => setFormState({ ...formState, specification: e.target.value })}
                  />
                </div>
              </div>

              {/* Dimensions */}
              <div className="pm-dimensions-wrapper">
                <h3 className="pm-section-heading" style={{ marginTop: 0 }}>Dimensions</h3>
                <button
                  type="button"
                  className="pm-btn-add-row"
                  onClick={handleAddDimensionRow}
                >
                  + Add Row
                </button>
                {dimensionRows.length > 0 && (
                  <table className="pm-dim-table">
                    <thead>
                      <tr>
                        <th style={{ width: "60px", textAlign: "center" }}>#</th>
                        <th>Dimension / Description</th>
                        <th style={{ width: "120px" }}>Length (CM)</th>
                        <th style={{ width: "120px" }}>Width (CM)</th>
                        <th style={{ width: "120px" }}>Height (CM)</th>
                        <th style={{ width: "130px" }}>CBM</th>
                        <th style={{ width: "70px", textAlign: "center" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dimensionRows.map((row, idx) => (
                        <tr key={row.id}>
                          <td style={{ textAlign: "center", color: "#64748b", fontWeight: 500 }}>{idx + 1}</td>
                          <td>
                            <input
                              type="text"
                              className="pm-dim-input"
                              placeholder="e.g. Master Carton, Unit Box..."
                              value={row.title}
                              onChange={(e) => handleUpdateDimensionRow(row.id, "title", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="any"
                              className="pm-dim-input"
                              placeholder="L"
                              value={row.length}
                              onChange={(e) => handleUpdateDimensionRow(row.id, "length", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="any"
                              className="pm-dim-input"
                              placeholder="W"
                              value={row.width}
                              onChange={(e) => handleUpdateDimensionRow(row.id, "width", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="any"
                              className="pm-dim-input"
                              placeholder="H"
                              value={row.height}
                              onChange={(e) => handleUpdateDimensionRow(row.id, "height", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.000001"
                              className="pm-dim-input"
                              placeholder="0.000000"
                              value={row.cbm}
                              onChange={(e) => handleUpdateDimensionRow(row.id, "cbm", e.target.value)}
                            />
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <button
                              type="button"
                              className="pm-btn-delete-row"
                              title="Delete Row"
                              onClick={() => handleDeleteDimensionRow(row.id)}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Submit Button */}
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <button
                  type="submit"
                  className="pm-btn-submit"
                  aria-label="Save Product"
                  disabled={formSubmitting}
                >
                  {formSubmitting ? "Submitting..." : "Submit"}
                </button>
                <button
                  type="button"
                  className="pm-btn-back"
                  onClick={handleBack}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell activeKey="masters-products" pageClassName="page-product-master">
      <main className="page">
        {/* Breadcrumb Trail */}
        <Breadcrumb trail={["Inventory", "Product Master"]} />

        {/* 1. Header with Title and Action Buttons */}
        <div className="page-header">
          <div>
            <h1>Product Master</h1>
            <div className="page-subtitle">
              Catalog of products, pricing, specifications, and packaging configurations.
            </div>
          </div>

          <div className="page-header-actions" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {/* Filter Toggle Button */}
            <button
              type="button"
              className="btn"
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
              title="Toggle Filter Options"
              aria-label="Filter"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
            </button>

            {/* + ADD NEW Button */}
            <button
              id="btn-add-product"
              type="button"
              className="btn btn-add-new"
              onClick={handleOpenCreate}
            >
              + ADD NEW
            </button>

            {/* Imp / Exp Dropdown */}
            <ImpExpDropdown
              apiBase="/masters/products"
              entityName="product"
              importHeaders={IMPORT_HEADERS}
              onSummary={() => { }}
              onError={(msg) => setErrorMessageBanner(msg)}
              onComplete={() => loadProducts()}
              onExportCsv={() => {
                downloadExport("/masters/products", "csv", "products");
              }}
              showImport={true}
              showExport={true}
            />

            {/* Bulk Actions Dropdown */}
            <BulkActionsDropdown
              selectedCount={selectedIds.length}
              onBulkActivate={handleBulkActivate}
              onBulkDeactivate={handleBulkDeactivate}
              onBulkDelete={handleBulkDelete}
            />
          </div>
        </div>

        {/* 2. Collapsible Filter Panel Card (Matches Company Profiles Layout) */}
        {showFilterPanel && (
          <div
            className="filter-panel-card"
            data-testid="pm-filter-panel"
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
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "18px 24px",
              }}
            >
              <div>
                <label htmlFor="filter-category" style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                  Category
                </label>
                <select
                  id="filter-category"
                  value={categoryDraft}
                  onChange={(e) => {
                    setCategoryDraft(e.target.value);
                    setSubCategoryDraft("");
                  }}
                  style={{
                    width: "100%",
                    height: "38px",
                    borderRadius: "5px",
                    border: "1px solid #cbd5e1",
                    padding: "0 28px 0 10px",
                    fontSize: "13.5px",
                    color: categoryDraft ? "#334155" : "#64748b",
                    fontStyle: categoryDraft ? "normal" : "italic",
                    background: "#ffffff url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>\") no-repeat right 10px center",
                    appearance: "none",
                    WebkitAppearance: "none",
                    MozAppearance: "none",
                    boxSizing: "border-box",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="">All</option>
                  {categories.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="filter-subcategory" style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                  Sub Category
                </label>
                <select
                  id="filter-subcategory"
                  value={subCategoryDraft}
                  onChange={(e) => setSubCategoryDraft(e.target.value)}
                  style={{
                    width: "100%",
                    height: "38px",
                    borderRadius: "5px",
                    border: "1px solid #cbd5e1",
                    padding: "0 28px 0 10px",
                    fontSize: "13.5px",
                    color: subCategoryDraft ? "#334155" : "#64748b",
                    fontStyle: subCategoryDraft ? "normal" : "italic",
                    background: "#ffffff url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>\") no-repeat right 10px center",
                    appearance: "none",
                    WebkitAppearance: "none",
                    MozAppearance: "none",
                    boxSizing: "border-box",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="">All</option>
                  {subCategories.items
                    .filter((sc) => !categoryDraft || sc.category_id === categoryDraft)
                    .map((sc) => (
                      <option key={sc.id} value={sc.id}>
                        {sc.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label htmlFor="filter-brand" style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                  Brand
                </label>
                <select
                  id="filter-brand"
                  value={brandDraft}
                  onChange={(e) => setBrandDraft(e.target.value)}
                  style={{
                    width: "100%",
                    height: "38px",
                    borderRadius: "5px",
                    border: "1px solid #cbd5e1",
                    padding: "0 28px 0 10px",
                    fontSize: "13.5px",
                    color: brandDraft ? "#334155" : "#64748b",
                    fontStyle: brandDraft ? "normal" : "italic",
                    background: "#ffffff url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>\") no-repeat right 10px center",
                    appearance: "none",
                    WebkitAppearance: "none",
                    MozAppearance: "none",
                    boxSizing: "border-box",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="">All</option>
                  {brands.items.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
              <button
                type="button"
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
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                  transition: "opacity 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                Reset
              </button>
              <button
                type="button"
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
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                  transition: "opacity 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                Search
              </button>
            </div>
          </div>
        )}

        {/* 3. Main Data Card (Clean Company Profiles Layout) */}
        <div className="card">
          {/* Active / Inactive Top Tabs */}
          <div style={{ display: "flex", gap: "20px", borderBottom: "1px solid #e2e8f0", padding: "6px 16px 0" }}>
            <button
              type="button"
              className={`pm-tab-btn ${activeTab === "Active" ? "active" : ""}`}
              style={{
                background: "none",
                border: "none",
                borderBottom: activeTab === "Active" ? "2.5px solid #0061f2" : "2.5px solid transparent",
                color: activeTab === "Active" ? "#0061f2" : "#64748b",
                fontWeight: 700,
                fontSize: "13.5px",
                paddingBottom: "8px",
                cursor: "pointer",
              }}
              onClick={() => {
                setActiveTab("Active");
                setCurrentPage(1);
              }}
            >
              Active ({tabCounts.active})
            </button>
            <button
              type="button"
              className={`pm-tab-btn ${activeTab === "Inactive" ? "active" : ""}`}
              style={{
                background: "none",
                border: "none",
                borderBottom: activeTab === "Inactive" ? "2.5px solid #0061f2" : "2.5px solid transparent",
                color: activeTab === "Inactive" ? "#0061f2" : "#64748b",
                fontWeight: 700,
                fontSize: "13.5px",
                paddingBottom: "8px",
                cursor: "pointer",
              }}
              onClick={() => {
                setActiveTab("Inactive");
                setCurrentPage(1);
              }}
            >
              Inactive ({tabCounts.inactive})
            </button>
          </div>

          {/* Controls Bar: Items per page & Freeze Columns & Search */}
          <div
            className="toolbar"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 14px",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <select
                  value={perPage}
                  onChange={(e) => {
                    setPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  aria-label="Items per page"
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                  }}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span style={{ fontSize: "13px", color: "#64748b", fontWeight: 500 }}>Items/Page</span>
              </div>

              {/* Dynamic Freeze Columns Dropdown Menu */}
              <div ref={pinMenuRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setPinMenuOpen((v) => !v)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: pinMenuOpen ? "#e2e8f0" : "#ffffff",
                    cursor: "pointer",
                    color: "#0f172a",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  📌 Freeze Columns ({Object.keys(pinnedCols).length})
                </button>
                {pinMenuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: "38px",
                      zIndex: 100,
                      background: "#ffffff",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                      padding: "12px",
                      minWidth: "240px",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#475569",
                        marginBottom: "8px",
                        borderBottom: "1px solid #f1f5f9",
                        paddingBottom: "6px",
                      }}
                    >
                      Toggle Frozen Columns
                    </div>
                    <div style={{ maxHeight: "200px", overflowY: "auto", paddingRight: "4px" }}>
                      {PRODUCT_COLUMN_LABELS.map((label, idx) => {
                        if (!label) return null;
                        const isPinned = Boolean(pinnedCols[idx]);
                        return (
                          <label
                            key={label}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                              cursor: "pointer",
                              padding: "4px 0",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isPinned}
                              onChange={() => togglePin(idx)}
                            />{" "}
                            {label}
                          </label>
                        );
                      })}
                    </div>
                    <div style={{ borderTop: "1px solid #f1f5f9", marginTop: "8px", paddingTop: "8px" }}>
                      <button
                        type="button"
                        onClick={() => setPinnedCols({})}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: "12px",
                          borderRadius: "4px",
                          border: "1px solid #e2e8f0",
                          background: "#f8fafc",
                          cursor: "pointer",
                          color: "#dc2626",
                          fontWeight: 600,
                        }}
                      >
                        Clear All Freezes
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Search Input with Clear Button */}
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                style={{
                  width: "320px",
                  padding: "8px 36px 8px 14px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                }}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm("");
                    setCurrentPage(1);
                  }}
                  title="Clear search"
                  style={{
                    position: "absolute",
                    right: "8px",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#94a3b8",
                    fontSize: "16px",
                    lineHeight: 1,
                    padding: "0 2px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {/* 5. Products Table matching Company Profiles Grid */}
          <div className="table-scroll" style={{ maxHeight: "calc(100vh - 220px)", overflowY: "auto", overflowX: "auto" }}>
            <table ref={tableRef} style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  {displayOrder.map((idx) => {
                    if (idx === 0) {
                      return (
                        <th
                          key="col-0"
                          style={{
                            width: "40px",
                            minWidth: "40px",
                            maxWidth: "45px",
                            textAlign: "center",
                            ...getFreezeStyle(0, true),
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isAllSelected}
                            onChange={(e) => handleToggleSelectAll(e.target.checked)}
                            style={{ cursor: "pointer", width: "16px", height: "16px" }}
                            aria-label="Select All"
                          />
                        </th>
                      );
                    }

                    const label = PRODUCT_COLUMN_LABELS[idx];
                    const isPinned = Boolean(pinnedCols[idx]);
                    const isSrNo = idx === 1;
                    const isAction = idx === 12;
                    const isSorted = sortColIndex === idx;

                    return (
                      <th
                        key={`col-${idx}-${label}`}
                        style={{
                          ...(isSrNo ? { width: "92px", minWidth: "92px", maxWidth: "100px", textAlign: "center" } : isAction ? { width: "70px", minWidth: "70px", textAlign: "center" } : {}),
                          ...getFreezeStyle(idx, true),
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: isAction || isSrNo ? "center" : "space-between",
                            gap: "4px",
                          }}
                        >
                          {isAction ? (
                            <span>{label}</span>
                          ) : (
                            <div
                              onClick={() => handleHeaderSort(idx)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: isSrNo ? "center" : "flex-start",
                                gap: "5px",
                                cursor: "pointer",
                                userSelect: "none",
                                flex: isSrNo ? undefined : 1,
                                minWidth: 0,
                                padding: "2px 0",
                              }}
                              title={
                                isSorted
                                  ? `Sorted by ${label} (${sortDirection === "asc" ? "Ascending — click for Descending" : "Descending — click to reset"})`
                                  : `Click to sort by ${label} (Ascending)`
                              }
                            >
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {label}
                              </span>
                              {isSorted ? (
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    color: "#0061f2",
                                    fontSize: "10px",
                                    fontWeight: 800,
                                    background: "#e0f2fe",
                                    padding: "1px 4px",
                                    borderRadius: "3px",
                                    border: "1px solid #bae6fd",
                                    lineHeight: 1,
                                    flexShrink: 0,
                                  }}
                                >
                                  {sortDirection === "asc" ? "▲" : "▼"}
                                </span>
                              ) : (
                                <span
                                  style={{
                                    fontSize: "10px",
                                    color: "#94a3b8",
                                    opacity: 0.45,
                                    lineHeight: 1,
                                    flexShrink: 0,
                                  }}
                                >
                                  ↕
                                </span>
                              )}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePin(idx);
                            }}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              fontSize: "11px",
                              opacity: isPinned ? 1 : 0.3,
                              padding: "0 2px",
                              flexShrink: 0,
                            }}
                            title={isPinned ? "Unfreeze column" : "Freeze column"}
                          >
                            📌
                          </button>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <ProductSkeletonRows
                    count={perPage > 10 ? 8 : perPage}
                    displayOrder={displayOrder}
                    getFreezeStyle={getFreezeStyle}
                  />
                ) : paginatedProducts.length === 0 ? (
                  <tr>
                    <td colSpan={displayOrder.length} style={{ textAlign: "center", padding: "36px", color: "#64748b" }}>
                      No products found.
                    </td>
                  </tr>
                ) : (
                  paginatedProducts.map((p, rowIdx) => {
                    const name = p.product_name_tally || p.product_name || "—";
                    const brandObj = brands.items.find((b) => b.id === p.brand_id);
                    const brandName = brandObj?.name || (p.brand_id === "brand-yinglima" ? "Yinglima" : "—");

                    const subCatObj = subCategories.items.find((sc) => sc.id === p.sub_category_id);
                    let subCatName = subCatObj?.name;
                    if (!subCatName) {
                      if (p.sub_category_id === "sub-misc") subCatName = "Miscellaneous";
                      else if (p.sub_category_id === "sub-vacuum") subCatName = "Vacuum Sealer Machine";
                      else if (p.sub_category_id === "sub-banding-spares") subCatName = "Spares For Banding Machine";
                      else if (p.sub_category_id === "sub-capping") subCatName = "Capping Machine";
                      else if (p.sub_category_id === "sub-tube-sealer") subCatName = "Tube Sealer";
                      else if (p.sub_category_id === "sub-cup-sealer") subCatName = "Cup Sealer";
                      else if (p.sub_category_id === "sub-conveyor") subCatName = "Conveyor Machine";
                      else if (p.sub_category_id === "sub-ffs") subCatName = "FFS / Weighing Machines";
                      else subCatName = "—";
                    }

                    const hsn = p.hsn_number || PRODUCT_HSN_MAP[name] || "8422.30.00";
                    const uomObj = uoms.items.find((u) => u.id === p.uom_id);
                    const uomName = uomObj?.code || uomObj?.name || "Nos";
                    const isChecked = selectedIds.includes(p.id);
                    const srNo = (currentPage - 1) * perPage + rowIdx + 1;

                    return (
                      <tr key={p.id}>
                        {displayOrder.map((colIdx) => {
                          switch (colIdx) {
                            case 0:
                              return (
                                <td key="cell-0" style={{ width: "40px", minWidth: "40px", maxWidth: "45px", textAlign: "center", ...getFreezeStyle(0, false) }}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => handleToggleRow(p.id, e.target.checked)}
                                    style={{ cursor: "pointer", width: "16px", height: "16px" }}
                                  />
                                </td>
                              );
                            case 1:
                              return (
                                <td
                                  key="cell-1"
                                  className="cell-srno"
                                  style={{
                                    width: "92px",
                                    minWidth: "92px",
                                    maxWidth: "100px",
                                    textAlign: "center",
                                    color: "#64748b",
                                    fontWeight: 500,
                                    ...getFreezeStyle(1, false),
                                  }}
                                >
                                  {srNo}
                                </td>
                              );
                            case 2:
                              return (
                                <td key="cell-2" style={{ minWidth: "220px", ...getFreezeStyle(2, false) }}>
                                  <a
                                    href="#detail"
                                    className="pm-link-product"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setDrawerProduct(p);
                                    }}
                                  >
                                    {name}
                                  </a>
                                </td>
                              );
                            case 3:
                              return (
                                <td key="cell-3" style={{ minWidth: "120px", ...getFreezeStyle(3, false) }}>
                                  {p.product_code && p.product_code !== "-" ? p.product_code : "—"}
                                </td>
                              );
                            case 4:
                              return (
                                <td key="cell-4" style={{ minWidth: "120px", ...getFreezeStyle(4, false) }}>
                                  {brandName}
                                </td>
                              );
                            case 5:
                              return (
                                <td key="cell-5" style={{ minWidth: "160px", ...getFreezeStyle(5, false) }}>
                                  {subCatName}
                                </td>
                              );
                            case 6:
                              return (
                                <td key="cell-6" style={{ minWidth: "150px", textAlign: "right", paddingRight: "14px", ...getFreezeStyle(6, false) }}>
                                  {p.standard_price ? formatIndianCurrency(p.standard_price) : "—"}
                                </td>
                              );
                            case 7:
                              return (
                                <td key="cell-7" style={{ minWidth: "100px", ...getFreezeStyle(7, false) }}>
                                  {hsn}
                                </td>
                              );
                            case 8:
                              return (
                                <td key="cell-8" style={{ minWidth: "80px", ...getFreezeStyle(8, false) }}>
                                  {uomName}
                                </td>
                              );
                            case 9:
                              return (
                                <td key="cell-9" style={{ minWidth: "90px", textAlign: "center", ...getFreezeStyle(9, false) }}>
                                  {p.packaging_quantity ?? 1}
                                </td>
                              );
                            case 10:
                              return (
                                <td key="cell-10" style={{ minWidth: "130px", textAlign: "center", ...getFreezeStyle(10, false) }}>
                                  {p.packaging_gross_weight ?? 0}
                                </td>
                              );
                            case 11:
                              return (
                                <td key="cell-11" style={{ minWidth: "110px", textAlign: "center", ...getFreezeStyle(11, false) }}>
                                  {p.packaging_unit_cbm ?? 0}
                                </td>
                              );
                            case 12:
                              return (
                                <td key="cell-12" className="actions" style={{ width: "70px", minWidth: "70px", textAlign: "center", ...getFreezeStyle(12, false) }}>
                                  <button
                                    type="button"
                                    className="btn"
                                    style={{
                                      background: "#0061f2",
                                      color: "#ffffff",
                                      padding: "6px 9px",
                                      borderRadius: "4px",
                                      border: "none",
                                      cursor: "pointer",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                    }}
                                    onClick={() => handleOpenEdit(p)}
                                    title="Edit Product"
                                    aria-label={`Edit ${name}`}
                                  >
                                    <svg
                                      width="14"
                                      height="14"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                    </svg>
                                  </button>
                                </td>
                              );
                            default:
                              return null;
                          }
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Matching Company Profiles */}
          <div className="pagination">
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

        {/* 6. SideDrawer for Viewing Product Details */}
        <SideDrawer
          open={Boolean(drawerProduct)}
          onClose={() => setDrawerProduct(null)}
          title="Product Details"
          subtitle={drawerProduct ? drawerProduct.product_name_tally || drawerProduct.product_name || "" : ""}
          maxWidth="min(900px, 95vw)"
        >
          {drawerProduct && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Product Image Preview if available */}
              {(drawerProduct.image_url || (drawerProduct.images && drawerProduct.images[0])) && (
                <div style={{ display: "flex", justifyContent: "center", padding: "12px", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                  <img
                    src={drawerProduct.image_url || (drawerProduct.images && drawerProduct.images[0]) || undefined}
                    alt={drawerProduct.product_name_tally || "Product"}
                    style={{ maxHeight: "160px", maxWidth: "100%", objectFit: "contain", borderRadius: "4px" }}
                  />
                </div>
              )}

              <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <h4 style={{ margin: "0 0 10px", fontSize: "14px", color: "#1e293b", borderBottom: "1px solid #e2e8f0", paddingBottom: "6px" }}>
                  Identity &amp; Classification
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", fontSize: "13px" }}>
                  <div><strong>Product Name (Tally):</strong> {drawerProduct.product_name_tally || "—"}</div>
                  <div><strong>Product Name (Invoice):</strong> {drawerProduct.product_name_invoice || "—"}</div>
                  <div><strong>Product Code:</strong> {drawerProduct.product_code || "—"}</div>
                  <div><strong>Brand:</strong> {brands.items.find((b) => b.id === drawerProduct.brand_id)?.name || "Yinglima"}</div>
                  <div><strong>Category:</strong> {categories.items.find((c) => c.id === drawerProduct.category_id)?.name || "Machines"}</div>
                  <div><strong>Sub Category:</strong> {subCategories.items.find((sc) => sc.id === drawerProduct.sub_category_id)?.name || "Miscellaneous"}</div>
                  <div><strong>HSN Code:</strong> {drawerProduct.hsn_number || PRODUCT_HSN_MAP[drawerProduct.product_name_tally || ""] || "8422.30.00"}</div>
                  <div><strong>GST %:</strong> {drawerProduct.gst_percent != null ? `${drawerProduct.gst_percent}%` : "18%"}</div>
                  <div><strong>Import Duty:</strong> {drawerProduct.import_duty_percent != null ? `${drawerProduct.import_duty_percent}%` : "7.5%"}</div>
                  <div><strong>UOM:</strong> {uoms.items.find((u) => u.id === drawerProduct.uom_id)?.code || "NOS"}</div>
                </div>
              </div>

              <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <h4 style={{ margin: "0 0 10px", fontSize: "14px", color: "#1e293b", borderBottom: "1px solid #e2e8f0", paddingBottom: "6px" }}>
                  Packaging &amp; Pricing
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", fontSize: "13px" }}>
                  <div><strong>Packaging Quantity:</strong> {drawerProduct.packaging_quantity ?? 1}</div>
                  <div><strong>Packaging Net Weight:</strong> {drawerProduct.packaging_net_weight != null ? `${drawerProduct.packaging_net_weight} kg` : "—"}</div>
                  <div><strong>Packaging Gross Weight:</strong> {drawerProduct.packaging_gross_weight ?? 0} kg</div>
                  <div><strong>Min. Price Without GST:</strong> {drawerProduct.standard_price ? formatIndianCurrency(drawerProduct.standard_price) : "—"}</div>
                </div>
              </div>

              <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <h4 style={{ margin: "0 0 10px", fontSize: "14px", color: "#1e293b", borderBottom: "1px solid #e2e8f0", paddingBottom: "6px" }}>
                  Dimensions For CBM
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "8px", fontSize: "13px" }}>
                  <div><strong>Length:</strong> {drawerProduct.length_cm ?? drawerProduct.length ?? "—"} cm</div>
                  <div><strong>Width:</strong> {drawerProduct.width_cm ?? drawerProduct.width ?? "—"} cm</div>
                  <div><strong>Height:</strong> {drawerProduct.height_cm ?? drawerProduct.height ?? "—"} cm</div>
                  <div><strong>Packaging Unit CBM:</strong> {drawerProduct.packaging_unit_cbm ?? 0}</div>
                </div>
              </div>

              {drawerProduct.dimensions_rows && drawerProduct.dimensions_rows.length > 0 && (
                <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                  <h4 style={{ margin: "0 0 10px", fontSize: "14px", color: "#1e293b", borderBottom: "1px solid #e2e8f0", paddingBottom: "6px" }}>
                    Dynamic Dimensions
                  </h4>
                  <table style={{ width: "100%", fontSize: "12.5px", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                        <th style={{ padding: "6px 8px" }}>#</th>
                        <th style={{ padding: "6px 8px" }}>Description</th>
                        <th style={{ padding: "6px 8px" }}>L (cm)</th>
                        <th style={{ padding: "6px 8px" }}>W (cm)</th>
                        <th style={{ padding: "6px 8px" }}>H (cm)</th>
                        <th style={{ padding: "6px 8px" }}>CBM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drawerProduct.dimensions_rows.map((row, idx) => (
                        <tr key={row.id || idx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                          <td style={{ padding: "6px 8px", color: "#64748b" }}>{idx + 1}</td>
                          <td style={{ padding: "6px 8px" }}>{row.title || "—"}</td>
                          <td style={{ padding: "6px 8px" }}>{row.length ?? "—"}</td>
                          <td style={{ padding: "6px 8px" }}>{row.width ?? "—"}</td>
                          <td style={{ padding: "6px 8px" }}>{row.height ?? "—"}</td>
                          <td style={{ padding: "6px 8px" }}>{row.cbm ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {drawerProduct.specification && (
                <div style={{ background: "#ffffff", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                  <h4 style={{ margin: "0 0 6px", fontSize: "14px", color: "#1e293b" }}>Specification</h4>
                  <p style={{ margin: 0, fontSize: "13px", color: "#475569", whiteSpace: "pre-wrap" }}>
                    {drawerProduct.specification}
                  </p>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px", borderTop: "1px solid #e2e8f0", paddingTop: "14px" }}>
                <button
                  type="button"
                  className="pm-btn-add"
                  style={{ fontSize: "13px", padding: "8px 16px" }}
                  onClick={() => {
                    const prod = drawerProduct;
                    setDrawerProduct(null);
                    handleOpenEdit(prod);
                  }}
                >
                  Edit Product
                </button>
              </div>
            </div>
          )}
        </SideDrawer>

      </main>
    </AppShell>
  );
}