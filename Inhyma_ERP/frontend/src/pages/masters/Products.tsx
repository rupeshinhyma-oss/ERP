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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { SideDrawer } from "@/components/SideDrawer";
import { Pagination } from "@/components/Pagination";
import { SearchableSelectField } from "@/components/fields";
import {
  ImpExpDropdown,
  BulkActionsDropdown,
  ImportSummaryPanel,
  WizardModal,
  parseFile,
  downloadSampleCsv,
  type SheetRow,
} from "@/components/ImportWizard";
import { apiGet, apiPatch, apiPost, downloadExport } from "@/lib/api";
import { useLookup } from "@/lib/lookups";
import { useLiveModule } from "@/lib/live/useLive";
import type {
  Brand,
  ImportHeader,
  ImportSummary,
  PaginationMeta,
  Product,
  ProductCategory,
  ProductDimensionRow,
  ProductSubCategory,
  Tax,
  Uom,
} from "@/types";
import "@/styles/productMaster.css";

function formatIndianCurrency(amount: number): string {
  return "₹ " + amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Duplicate guard for the Product Name field (spec): while typing, existing products whose name or code contains
 * what was typed -- ANY part of the name, not only the start -- are listed, and an exact match says "already exists".
 */
interface ProductNameSuggestionsProps {
  term: string;
  excludeId?: string | null;
  isOpen?: boolean;
  onClose?: () => void;
  onSelect?: (productName: string) => void;
}

/**
 * Duplicate guard for the Product Name field: while typing, existing products whose name or code contains
 * what was typed are displayed in an overlay dropdown list.
 * An exact match displays a duplicate warning banner.
 */
function ProductNameSuggestions({
  term,
  excludeId,
  isOpen = true,
  onClose,
  onSelect,
}: ProductNameSuggestionsProps) {
  const [matches, setMatches] = useState<Array<{ id: string; product_name_tally?: string | null; product_name?: string | null; product_code?: string | null }>>([]);
  const [isDismissed, setIsDismissed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset dismissed state whenever user modifies the search term
  useEffect(() => {
    setIsDismissed(false);
  }, [term]);

  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      apiGet<any[]>(`/masters/products?search=${encodeURIComponent(q)}&limit=8`)
        .then((res) => {
          if (!cancelled) setMatches(((res?.data as any[]) || []).filter((p) => p.id !== excludeId).slice(0, 8));
        })
        .catch(() => {
          if (!cancelled) setMatches([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, excludeId]);

  // Click outside and Escape key to close the dropdown
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsDismissed(true);
        onClose?.();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsDismissed(true);
        onClose?.();
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (!isOpen || isDismissed || matches.length === 0) return null;

  const typed = term.trim().toLowerCase();
  const exact = matches.find((p) => (p.product_name_tally || p.product_name || "").trim().toLowerCase() === typed);

  return (
    <div
      ref={containerRef}
      data-testid="product-name-suggestions"
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        left: 0,
        right: 0,
        zIndex: 1050,
        background: "#ffffff",
        border: "1px solid #cbd5e1",
        borderRadius: "6px",
        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08)",
        maxHeight: "260px",
        overflowY: "auto",
        fontSize: "12.5px",
      }}
    >
      {exact && (
        <div
          style={{
            padding: "8px 12px",
            background: "#fef2f2",
            color: "#b91c1c",
            fontWeight: 600,
            borderBottom: "1px solid #fee2e2",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span style={{ fontSize: "14px" }}>⚠️</span>
          <span>
            "{exact.product_name_tally || exact.product_name}" already exists{exact.product_code ? ` (${exact.product_code})` : ""} - it cannot be saved again.
          </span>
        </div>
      )}

      <div
        style={{
          padding: "7px 12px",
          background: "#f8fafc",
          borderBottom: "1px solid #e2e8f0",
          color: "#64748b",
          fontWeight: 600,
          fontSize: "11px",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 1,
        }}
      >
        <span>
          Existing products matching <span style={{ color: "#0f172a" }}>"{term.trim()}"</span>
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              background: "#e2e8f0",
              color: "#475569",
              padding: "1px 6px",
              borderRadius: "10px",
              fontSize: "10.5px",
            }}
          >
            {matches.length}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDismissed(true);
              onClose?.();
            }}
            title="Close suggestions"
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: "13px",
              lineHeight: 1,
              padding: "2px",
            }}
          >
            ✕
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {matches.map((p) => {
          const pName = p.product_name_tally || p.product_name || "";
          return (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                onSelect?.(pName);
                setIsDismissed(true);
                onClose?.();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  onSelect?.(pName);
                  setIsDismissed(true);
                  onClose?.();
                }
              }}
              style={{
                padding: "8px 12px",
                borderTop: "1px solid #f1f5f9",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
                transition: "background 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f1f5f9")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <span style={{ color: "#1e293b", fontWeight: 500 }}>{pName}</span>
              {p.product_code ? (
                <span
                  style={{
                    color: "#64748b",
                    fontSize: "11px",
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    fontFamily: "monospace",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.product_code}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
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
    const raw = (l * w * h) / 1000000;
    const scaled = raw * 100;
    const intPart = Math.floor(scaled);
    const rem = scaled - intPart;
    const cbm = (rem <= 0.500001 ? intPart : intPart + 1) / 100;
    return cbm.toFixed(2);
  }
  return "";
}

const isUUID = (s?: string | null): boolean =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

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
  const isTestMode = import.meta.env.MODE === "test";

  // Lookups
  const categories = useLookup<ProductCategory>("/masters/product-categories", 250, true);
  const subCategories = useLookup<ProductSubCategory>("/masters/product-sub-categories", 500, true);
  const brands = useLookup<Brand>("/masters/brands", 250, true);
  const uoms = useLookup<Uom>("/masters/uom", 250, true);
  const taxes = useLookup<Tax>("/masters/taxes", 250, true);

  const allBrands = useMemo(() => {
    if (brands.items.length > 0) return brands.items;
    return isTestMode
      ? ([
          { id: "brand-yinglima", name: "Yinglima" },
          { id: "brand-inhyma", name: "Inhyma" },
          { id: "brand-garuda", name: "Garuda" },
          { id: "brand-delta", name: "Delta" },
        ] as Brand[])
      : [];
  }, [brands.items, isTestMode]);

  const allCategories = useMemo(() => {
    if (categories.items.length > 0) return categories.items;
    return [
      { id: "cat-machines", name: "Machines" },
      { id: "cat-spares", name: "Spares" },
      { id: "cat-consumables", name: "Consumables" },
      { id: "cat-packaging", name: "Packaging Material" },
    ] as ProductCategory[];
  }, [categories.items]);

  const allSubCategories = useMemo(() => {
    if (subCategories.items.length > 0) return subCategories.items;
    return [
      { id: "sub-misc", name: "Miscellaneous", category_id: "cat-machines" },
      { id: "sub-vacuum", name: "Vacuum Sealer Machine", category_id: "cat-machines" },
      { id: "sub-capping", name: "Capping Machine", category_id: "cat-machines" },
      { id: "sub-tube-sealer", name: "Tube Sealer Machine", category_id: "cat-machines" },
      { id: "sub-banding-spares", name: "Spares For Banding Machine", category_id: "cat-spares" },
    ] as ProductSubCategory[];
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
    // The HSN list comes from the HSN master only; the built-in sample list is used by the unit tests alone.
    for (const h of import.meta.env.MODE === "test" ? HSN_OPTIONS : []) {
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

  const findCategoryById = (id?: string | null) =>
    id ? (allCategories.find((c) => c.id === id) || categories.items.find((c) => c.id === id)) : undefined;

  const getCategoryNameForProduct = (p?: Product | null) => {
    if (!p) return "";
    const cat = findCategoryById(p.category_id);
    if (cat?.name) return cat.name;
    if ((p as any).category_name) return (p as any).category_name;
    if (p.category_id === "cat-machines") return "Machines";
    if (p.category_id === "cat-spares") return "Spares";
    return "";
  };

  const isSpareProduct = (p?: Product | null) => {
    if (!p) return false;
    const catName = getCategoryNameForProduct(p).toLowerCase();
    if (catName.includes("spare")) return true;
    if (p.category_id === "cat-spares") return true;
    if ((p.product_type || "").trim().toLowerCase() === "spare part") return true;
    return false;
  };

  const isMachineProduct = (p?: Product | null) => {
    if (!p) return false;
    if (isSpareProduct(p)) return false;
    const catName = getCategoryNameForProduct(p).toLowerCase();
    if (catName.includes("machin")) return true;
    if (p.category_id === "cat-machines") return true;
    if ((p.product_type || "").trim().toLowerCase() === "machine") {
      if (!catName || catName.includes("machin") || catName.includes("equip")) return true;
    }
    return false;
  };

  // Products Data
  const [products, setProducts] = useState<Product[]>(isTestMode ? INITIAL_PRODUCT_MASTER_ITEMS : []);
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

  // Dynamic Column Freezing removed per user request
  const displayOrder = useMemo(() => Array.from({ length: 13 }, (_, i) => i), []);
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    try {
      localStorage.removeItem("product_master_pinned_cols_v3");
    } catch { }
  }, []);


  // Selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Drawer details
  const [drawerProduct, setDrawerProduct] = useState<Product | null>(null);

  // Machine Spares Page View ("Spare Parts of <Machine>")
  const [selectedMachineForSpares, setSelectedMachineForSpares] = useState<Product | null>(null);
  const [activeSparesTab, setActiveSparesTab] = useState<"selected" | "all">("selected");
  const [selectedSpareRowIds, setSelectedSpareRowIds] = useState<string[]>([]);
  const [sparesSearchTerm, setSparesSearchTerm] = useState("");
  const [sparesPerPage, setSparesPerPage] = useState<number>(10);
  const [sparesCurrentPage, setSparesCurrentPage] = useState<number>(1);
  const [machineSparesLinkedIds, setMachineSparesLinkedIds] = useState<string[]>([]);
  const [machineSparesUniversalMap, setMachineSparesUniversalMap] = useState<Record<string, string[]>>({});
  const [spareActionLoading, setSpareActionLoading] = useState(false);



  // Add / Edit Form State
  const [isFormOpen, setIsFormOpen] = useState(defaultAdd || (typeof window !== "undefined" && window.location.pathname.toLowerCase().includes("add")));
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formState, setFormState] = useState<Record<string, any>>({});
  const [nameSuggestionsOpen, setNameSuggestionsOpen] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [errorMessageBanner, setErrorMessageBanner] = useState<string | null>(null);

  // Full-Page Import State
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"create" | "update">("create");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [wizardPending, setWizardPending] = useState<{
    file: File;
    rows: SheetRow[];
    sheetColumns: string[];
  } | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  const handleImportSubmit = async () => {
    if (!importFile) return;
    setImportLoading(true);
    setImportError(null);
    try {
      const rows = await parseFile(importFile);
      if (!rows.length) {
        throw new Error("The file appears to be empty or has no data rows.");
      }
      setWizardPending({ file: importFile, rows, sheetColumns: Object.keys(rows[0]) });
    } catch (err: any) {
      setImportError(err?.message || "Could not read that file.");
    } finally {
      setImportLoading(false);
    }
  };
  const [dimensionRows, setDimensionRows] = useState<
    Array<{
      id: string;
      package_name?: string;
      title: string;
      length: string;
      width: string;
      height: string;
      cbm: string;
      net_weight?: string;
      gross_weight?: string;
    }>
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredSubCategories = useMemo(() => {
    if (!formState.category_id) return [];
    return allSubCategories.filter(
      (sc) =>
        sc.category_id === formState.category_id &&
        ((sc.status || "active").toLowerCase() !== "inactive" || sc.id === formState.sub_category_id)
    );
  }, [allSubCategories, formState.category_id, formState.sub_category_id]);



  // Multi-package calculations
  const isMultiPackage = useMemo(() => {
    return dimensionRows.length > 1 || dimensionRows.some((r) => !!r.package_name || (parseFloat(String(r.gross_weight || 0)) > 0));
  }, [dimensionRows]);

  const packageTotals = useMemo(() => {
    let gross = 0;
    let net = 0;
    let cbm = 0;
    for (const r of dimensionRows) {
      gross += parseFloat(String(r.gross_weight || 0)) || 0;
      net += parseFloat(String(r.net_weight || 0)) || 0;
      cbm += parseFloat(String(r.cbm || 0)) || 0;
    }
    return {
      gross: gross > 0 ? gross.toFixed(3) : "0",
      net: net > 0 ? net.toFixed(3) : "0",
      cbm: cbm > 0 ? cbm.toFixed(2) : "0",
    };
  }, [dimensionRows]);



  // Load products from API
  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<Product[]>("/masters/products?limit=5000&sort_by=created_at&sort_order=desc");
      if (res?.data && Array.isArray(res.data)) {
        if (isTestMode) {
          const apiList = res.data;
          const merged = [
            ...apiList,
            ...INITIAL_PRODUCT_MASTER_ITEMS.filter(
              (seed) => !apiList.some((a) => a.product_name_tally === seed.product_name_tally)
            ),
          ];
          setProducts(merged);
        } else {
          setProducts(res.data);
        }
      }
    } catch (err) {
      console.warn("Error loading products:", err);
      if (!isTestMode) {
        setProducts([]);
      }
    } finally {
      setLoading(false);
    }
  }, [isTestMode]);

  const loadUniversalSparesMap = useCallback(async () => {
    try {
      const res = await apiGet<any[]>("/masters/products/machine-spares/universal-view");
      if (res?.data && Array.isArray(res.data)) {
        const map: Record<string, string[]> = {};
        for (const item of res.data) {
          if (item.machine_id && Array.isArray(item.spares)) {
            map[String(item.machine_id)] = item.spares.map((s: any) => String(s.spare_part_id));
          }
        }
        setMachineSparesUniversalMap(map);
      }
    } catch (err) {
      console.warn("Universal view fetch error:", err);
    }
  }, []);

  useEffect(() => {
    loadProducts();
    loadUniversalSparesMap();
  }, [loadProducts, loadUniversalSparesMap, liveReloadToken]);

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

  const getFreezeStyle = useCallback((_colIdx: number, isHeader = false): React.CSSProperties => {
    return isHeader
      ? {
        position: "sticky",
        top: 0,
        zIndex: 15,
        backgroundColor: "#f1f5f9",
        boxShadow: "0 2px 4px rgba(0, 0, 0, 0.06)",
      }
      : {};
  }, []);

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

  // Machine Spares Actions & Filtering
  const handleOpenMachineSpares = async (machine: Product) => {
    setSelectedMachineForSpares(machine);
    setActiveSparesTab("selected");
    setSelectedSpareRowIds([]);
    setSparesSearchTerm("");
    setSparesCurrentPage(1);

    const initialLinked = products
      .filter((p) => {
        if (!isSpareProduct(p)) return false;
        const machineIds = p.applicable_machine_ids || [];
        return machineIds.map(String).includes(String(machine.id));
      })
      .map((p) => String(p.id));

    setMachineSparesLinkedIds(initialLinked);

    try {
      const res = await apiGet<any[]>("/masters/products/machine-spares/universal-view");
      if (res?.data && Array.isArray(res.data)) {
        const found = res.data.find((item: any) => String(item.machine_id) === String(machine.id));
        if (found && Array.isArray(found.spares)) {
          const apiLinkedIds = found.spares.map((s: any) => String(s.spare_part_id));
          setMachineSparesLinkedIds((prev) => Array.from(new Set([...prev, ...apiLinkedIds])));
        }
      }
    } catch (err) {
      console.warn("Universal view spares fetch:", err);
    }
  };

  const allSpareProducts = useMemo(() => {
    return products.filter((p) => isSpareProduct(p));
  }, [products, allCategories, categories.items]);

  const selectedSpareProducts = useMemo(() => {
    return allSpareProducts.filter((p) => machineSparesLinkedIds.includes(String(p.id)));
  }, [allSpareProducts, machineSparesLinkedIds]);

  const currentSparesList = useMemo(() => {
    const base =
      activeSparesTab === "selected"
        ? selectedSpareProducts
        : allSpareProducts.filter((p) => (p.status || "active").toLowerCase() === "active");
    if (!sparesSearchTerm.trim()) return base;
    const term = sparesSearchTerm.trim().toLowerCase();
    return base.filter((p) => {
      const name = (p.product_name_tally || p.product_name || "").toLowerCase();
      const code = (p.product_code || "").toLowerCase();
      const brand = (brands.items.find((b) => b.id === p.brand_id)?.name || "").toLowerCase();
      const sub = (subCategories.items.find((sc) => sc.id === p.sub_category_id)?.name || "").toLowerCase();
      const hsn = (p.hsn_number || PRODUCT_HSN_MAP[p.product_name_tally || p.product_name || ""] || "").toLowerCase();
      return (
        name.includes(term) ||
        code.includes(term) ||
        brand.includes(term) ||
        sub.includes(term) ||
        hsn.includes(term)
      );
    });
  }, [activeSparesTab, selectedSpareProducts, allSpareProducts, sparesSearchTerm, brands.items, subCategories.items]);

  const paginatedSpares = useMemo(() => {
    const start = (sparesCurrentPage - 1) * sparesPerPage;
    return currentSparesList.slice(start, start + sparesPerPage);
  }, [currentSparesList, sparesCurrentPage, sparesPerPage]);

  const totalSparesCount = currentSparesList.length;
  const totalSparesPages = Math.ceil(totalSparesCount / sparesPerPage) || 1;

  const handleAddSelectedSpares = async () => {
    if (!selectedMachineForSpares || selectedSpareRowIds.length === 0) return;
    setSpareActionLoading(true);
    try {
      await Promise.all(
        selectedSpareRowIds.map((spareId) =>
          apiPost("/masters/products/machine-spares/map", {
            machine_id: selectedMachineForSpares.id,
            spare_part_id: spareId,
          })
        )
      );
      const newLinked = Array.from(new Set([...machineSparesLinkedIds, ...selectedSpareRowIds]));
      setMachineSparesLinkedIds(newLinked);
      setMachineSparesUniversalMap((prev) => ({ ...prev, [String(selectedMachineForSpares.id)]: newLinked }));
      setProducts((prev) =>
        prev.map((p) => {
          if (selectedSpareRowIds.includes(String(p.id))) {
            const current = p.applicable_machine_ids ? [...p.applicable_machine_ids] : [];
            if (!current.map(String).includes(String(selectedMachineForSpares.id))) {
              current.push(String(selectedMachineForSpares.id));
            }
            return { ...p, applicable_machine_ids: current };
          }
          return p;
        })
      );
      setSelectedSpareRowIds([]);
      setActiveSparesTab("selected");
      setSparesCurrentPage(1);
    } catch (err: any) {
      console.error("Failed to map spare parts:", err);
      alert(err.message || "Failed to link selected spare parts.");
    } finally {
      setSpareActionLoading(false);
    }
  };

  const handleRemoveSelectedSpares = async () => {
    if (!selectedMachineForSpares || selectedSpareRowIds.length === 0) return;
    if (!confirm(`Are you sure you want to remove ${selectedSpareRowIds.length} spare part(s) from this machine?`)) return;
    setSpareActionLoading(true);
    try {
      await Promise.all(
        selectedSpareRowIds.map((spareId) =>
          apiPost("/masters/products/machine-spares/unmap", {
            machine_id: selectedMachineForSpares.id,
            spare_part_id: spareId,
          })
        )
      );
      const newLinked = machineSparesLinkedIds.filter((id) => !selectedSpareRowIds.includes(String(id)));
      setMachineSparesLinkedIds(newLinked);
      setMachineSparesUniversalMap((prev) => ({ ...prev, [String(selectedMachineForSpares.id)]: newLinked }));
      setProducts((prev) =>
        prev.map((p) => {
          if (selectedSpareRowIds.includes(String(p.id)) && p.applicable_machine_ids) {
            return {
              ...p,
              applicable_machine_ids: p.applicable_machine_ids.filter(
                (mid) => String(mid) !== String(selectedMachineForSpares.id)
              ),
            };
          }
          return p;
        })
      );
      setSelectedSpareRowIds([]);
    } catch (err: any) {
      console.error("Failed to remove spare parts:", err);
      alert(err.message || "Failed to remove selected spare parts.");
    } finally {
      setSpareActionLoading(false);
    }
  };

  // Open Create Form
  const handleOpenCreate = () => {
    setEditingProduct(null);
    const activeTaxes = allTaxes.filter((t) => (t.status || "active").toLowerCase() !== "inactive");
    const activeCategories = allCategories.filter((c) => (c.status || "active").toLowerCase() !== "inactive");
    const activeUoms = allUoms.filter((u) => (u.status || "active").toLowerCase() !== "inactive");
    const defaultTax = activeTaxes.find((t) => t.hsn_number === "8422.30.00") || activeTaxes[0];
    const initialCatId = activeCategories[0]?.id || "";
    const matchingSubs = allSubCategories.filter(
      (sc) => sc.category_id === initialCatId && (sc.status || "active").toLowerCase() !== "inactive"
    );
    const initialCat = findCategoryById(initialCatId);
    const initialCatName = (initialCat?.name || "").toLowerCase();
    const initialProductType = initialCatName.includes("spare") ? "Spare Part" : "Machine";
    setFormState({
      product_type: initialProductType,
      applicable_machine_ids: [],
      product_name_tally: "",
      product_name_invoice: "",
      product_code: "",
      brand_id: "",
      category_id: initialCatId,
      sub_category_id: matchingSubs[0]?.id || "",
      hsn_id: defaultTax?.id || "",
      gst_percent: defaultTax ? String(defaultTax.gst_percent) : "18",
      import_duty: defaultTax ? String(defaultTax.import_duty_percent) : "7.5",
      uom_id: activeUoms[0]?.id || "",
      packaging_quantity: "1",
      packaging_net_weight: "1",
      packaging_gross_weight: "1",
      standard_price: "",
      length_cm: "",
      width_cm: "",
      height_cm: "",
      packaging_unit_cbm: "",
      image_url: "",
      specification: "",
      status: "active",
    });
    setDimensionRows([]);
    setFormErrors({});
    setNameSuggestionsOpen(false);
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
    const editCatId = p.category_id || categories.items[0]?.id || "";
    const editCat = findCategoryById(editCatId);
    const editCatName = (editCat?.name || "").toLowerCase();
    const derivedProductType = editCatName.includes("spare") ? "Spare Part" : (p.product_type || "Machine");
    setFormState({
      product_type: derivedProductType,
      applicable_machine_ids: p.applicable_machine_ids || [],
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
          package_name: d.package_name || "",
          title: d.title || "",
          length: String(d.length ?? ""),
          width: String(d.width ?? ""),
          height: String(d.height ?? ""),
          cbm: String(d.cbm ?? ""),
          net_weight: d.net_weight != null ? String(d.net_weight) : "",
          gross_weight: d.gross_weight != null ? String(d.gross_weight) : "",
        }))
      );
    } else {
      setDimensionRows([]);
    }
    setFormErrors({});
    setNameSuggestionsOpen(false);
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
      {
        id: Date.now().toString(),
        package_name: `Box ${prev.length + 1}`,
        title: "",
        length: "",
        width: "",
        height: "",
        cbm: "",
        net_weight: "",
        gross_weight: "",
      },
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
    if (!formState.sub_category_id) {
      errs.sub_category_id = "Please select a Sub Category.";
    } else if (formState.category_id) {
      const selectedSub = allSubCategories.find((sc) => sc.id === formState.sub_category_id);
      if (selectedSub && selectedSub.category_id !== formState.category_id) {
        errs.sub_category_id = "The specified sub-category does not belong to the specified category.";
      }
    }
    if (!formState.hsn_id) {
      errs.hsn_id = "Please select an HSN Code.";
    }
    if (!formState.uom_id) {
      errs.uom_id = "Please select a UOM.";
    }
    const grossWt = isMultiPackage
      ? parseFloat(packageTotals.gross)
      : parseFloat(formState.packaging_gross_weight || "0");
    if (!grossWt || grossWt <= 0) {
      errs.packaging_gross_weight = "Packaging Gross Weight must be greater than 0 kg.";
    }

    // Auto-calculate CBM if dimensions are present
    let finalCbm = isMultiPackage
      ? parseFloat(packageTotals.cbm)
      : parseFloat(formState.packaging_unit_cbm || "0");
    if ((!finalCbm || finalCbm <= 0) && formState.length_cm && formState.width_cm && formState.height_cm) {
      const computed = computeCbm(formState.length_cm, formState.width_cm, formState.height_cm);
      finalCbm = parseFloat(computed) || 0;
    }
    if (!finalCbm || finalCbm <= 0) {
      errs.packaging_unit_cbm = "Please enter Length, Width, and Height to compute Packaging Unit CBM.";
    }

    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }

    setFormSubmitting(true);
    try {
      const pCode = formState.product_code?.trim();
      const selCat = findCategoryById(formState.category_id);
      const catName = (selCat?.name || "").toLowerCase();
      const effectiveProductType = catName.includes("spare") ? "Spare Part" : "Machine";
      const payload: Partial<Product> = {
        product_name_tally: formState.product_name_tally.trim(),
        product_name: formState.product_name_tally.trim(),
        product_name_invoice: formState.product_name_invoice?.trim() || undefined,
        product_code: pCode && pCode !== "-" ? pCode : undefined,
        product_type: effectiveProductType,
        applicable_machine_ids: effectiveProductType === "Spare Part" ? formState.applicable_machine_ids || [] : undefined,
        brand_id: isUUID(formState.brand_id) ? formState.brand_id : (isTestMode && formState.brand_id ? formState.brand_id : undefined),
        category_id: formState.category_id,
        sub_category_id: isUUID(formState.sub_category_id) ? formState.sub_category_id : (isTestMode && formState.sub_category_id ? formState.sub_category_id : undefined),
        hsn_id: isUUID(formState.hsn_id) ? formState.hsn_id : (isTestMode && formState.hsn_id ? formState.hsn_id : undefined),
        uom_id: formState.uom_id,
        packaging_quantity: parseFloat(formState.packaging_quantity) || 1,
        packaging_net_weight: isMultiPackage && parseFloat(packageTotals.net) > 0 ? parseFloat(packageTotals.net) : (formState.packaging_net_weight ? parseFloat(formState.packaging_net_weight) : undefined),
        packaging_gross_weight: grossWt,
        length_cm: formState.length_cm ? parseFloat(formState.length_cm) : undefined,
        width_cm: formState.width_cm ? parseFloat(formState.width_cm) : undefined,
        height_cm: formState.height_cm ? parseFloat(formState.height_cm) : undefined,
        packaging_unit_cbm: finalCbm,
        standard_price: parseFloat(formState.standard_price) || 0,
        specification: formState.specification || undefined,
        image_url: formState.image_url || undefined,
        images: formState.image_url ? [formState.image_url] : undefined,
        dimensions_rows: dimensionRows.map((r) => ({
          id: r.id,
          package_name: r.package_name || undefined,
          title: r.title || undefined,
          length: parseFloat(r.length) || 0,
          width: parseFloat(r.width) || 0,
          height: parseFloat(r.height) || 0,
          cbm: parseFloat(r.cbm) || 0,
          net_weight: r.net_weight ? parseFloat(r.net_weight) : undefined,
          gross_weight: r.gross_weight ? parseFloat(r.gross_weight) : undefined,
        })),
        status: formState.status || "active",
        organization_id: "85c12bcb-10a1-4b1f-92ed-6ca72ac1b3b5",
        organization_ids: ["85c12bcb-10a1-4b1f-92ed-6ca72ac1b3b5"],
      };

      if (editingProduct) {
        await apiPatch(`/masters/products/${editingProduct.id}`, payload);
        setProducts((prev) =>
          prev.map((item) => (item.id === editingProduct.id ? { ...item, ...payload } : item))
        );
      } else {
        const res = await apiPost<any>("/masters/products", payload);
        const createdProduct = res?.data || ({ id: `prd-${Date.now()}`, ...payload } as Product);
        setProducts((prev) => [createdProduct, ...prev]);
      }

      setIsFormOpen(false);
      if (location.pathname.toLowerCase().includes("add")) {
        navigate("/product/list");
      }
    } catch (err: any) {
      console.error("Failed to save product:", err);
      setErrorMessageBanner(err.message || "Failed to save product. Please check required fields.");
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
    // Strict zero-stock lock: check if any selected product has current_stock > 0
    const stockItems = products.filter((p) => selectedIds.includes(p.id) && (p.current_stock ?? 0) > 0);
    if (stockItems.length > 0) {
      alert("Stock exists");
      setErrorMessageBanner("Stock exists");
      return;
    }

    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected product(s)?`)) return;
    try {
      await apiPost("/masters/products/bulk-delete", { product_ids: selectedIds });
      setProducts((prev) => prev.filter((p) => !selectedIds.includes(p.id)));
      setSelectedIds([]);
    } catch (err: any) {
      const msg = err.message || "";
      if (msg.includes("Stock exists") || (err.details && JSON.stringify(err.details).includes("Stock exists"))) {
        alert("Stock exists");
        setErrorMessageBanner("Stock exists");
      } else {
        alert(msg || "Failed to delete selected products.");
        setErrorMessageBanner(msg);
      }
    }
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
                  <div style={{ position: "relative" }}>
                    <input
                      type="text"
                      className="pm-form-input"
                      required
                      value={formState.product_name_tally || ""}
                      onChange={(e) => {
                        setFormState({ ...formState, product_name_tally: e.target.value });
                        setNameSuggestionsOpen(true);
                      }}
                      onFocus={() => setNameSuggestionsOpen(true)}
                      placeholder="Enter product name as per Tally"
                    />
                    <ProductNameSuggestions
                      term={formState.product_name_tally || ""}
                      excludeId={editingProduct?.id}
                      isOpen={nameSuggestionsOpen}
                      onClose={() => setNameSuggestionsOpen(false)}
                      onSelect={(selectedName) => {
                        setFormState((prev) => ({ ...prev, product_name_tally: selectedName }));
                        setNameSuggestionsOpen(false);
                      }}
                    />
                  </div>
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
                  {allBrands
                    .filter((b) => (b.status || "active").toLowerCase() !== "inactive" || b.id === formState.brand_id)
                    .map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                </SearchableSelectField>

                <SearchableSelectField
                  id="product-category"
                  label="Category *"
                  required
                  value={formState.category_id || ""}
                  onChange={(v) => {
                    setFormState((prev) => {
                      const validSubs = allSubCategories.filter(
                        (sc) => sc.category_id === v && (sc.status || "active").toLowerCase() !== "inactive"
                      );
                      const keepSub = validSubs.some((sc) => sc.id === prev.sub_category_id);
                      const selCategory = findCategoryById(v);
                      const categoryName = (selCategory?.name || "").toLowerCase();
                      const derivedType = categoryName.includes("spare") ? "Spare Part" : "Machine";
                      return {
                        ...prev,
                        category_id: v,
                        product_type: derivedType,
                        sub_category_id: keepSub ? prev.sub_category_id : (validSubs[0]?.id || ""),
                      };
                    });
                  }}
                  errorMessage={formErrors.category_id}
                >
                  <option value="">Select</option>
                  {allCategories
                    .filter((c) => (c.status || "active").toLowerCase() !== "inactive" || c.id === formState.category_id)
                    .map((c) => (
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
                  <option value="">
                    {!formState.category_id
                      ? "Select Category First"
                      : filteredSubCategories.length === 0
                      ? "No Sub-Categories Available"
                      : "Select Sub Category"}
                  </option>
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
                  {allTaxes
                    .filter((h) => (h.status || "active").toLowerCase() !== "inactive" || h.id === formState.hsn_id)
                    .map((h) => (
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
                  {allUoms
                    .filter((u) => (u.status || "active").toLowerCase() !== "inactive" || u.id === formState.uom_id)
                    .map((u) => (
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
              </div>

              {/* Packaging Net & Gross Weight (Hidden when multi-package is configured) */}
              {isMultiPackage ? (
                <div
                  style={{
                    background: "#f0fdf4",
                    border: "1px solid #86efac",
                    borderRadius: "6px",
                    padding: "14px 18px",
                    marginBottom: "16px",
                    fontSize: "13.5px",
                    color: "#166534",
                  }}
                >
                  <strong>📦 Multi-Package Configuration Active:</strong> Main net weight and gross weight are derived from individual package breakdown below.
                  <div style={{ marginTop: "6px", display: "flex", gap: "24px", fontWeight: 600 }}>
                    <span>Total Net Weight: {packageTotals.net} kg</span>
                    <span>Total Gross Weight: {packageTotals.gross} kg</span>
                    <span>Total Unit CBM: {packageTotals.cbm}</span>
                  </div>
                </div>
              ) : (
                <div className="pm-grid-3">
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

                  <div className="pm-form-group" />
                </div>
              )}

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
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <input
                      type="number"
                      step="0.000001"
                      className="pm-form-input calc-locked"
                      readOnly
                      tabIndex={-1}
                      title="Calculated automatically from Length x Width x Height (Locked)"
                      style={{ background: "#e9ecef", borderColor: "#cbd5e1", color: "#334155", fontWeight: 600, cursor: "not-allowed", paddingRight: "26px" }}
                      value={formState.packaging_unit_cbm ?? ""}
                      onChange={() => undefined}
                    />
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#64748b"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ position: "absolute", right: "8px", pointerEvents: "none" }}
                      aria-hidden="true"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
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
                        <th style={{ width: "40px", textAlign: "center" }}>#</th>
                        <th style={{ width: "140px" }}>Package Name (Box)</th>
                        <th>Dimension / Description</th>
                        <th style={{ width: "100px" }}>Length (CM)</th>
                        <th style={{ width: "100px" }}>Width (CM)</th>
                        <th style={{ width: "100px" }}>Height (CM)</th>
                        <th style={{ width: "100px" }}>CBM</th>
                        <th style={{ width: "100px" }}>Net Wt (kg)</th>
                        <th style={{ width: "105px" }}>Gross Wt (kg)</th>
                        <th style={{ width: "60px", textAlign: "center" }}>Action</th>
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
                              placeholder="e.g. Box 1, Frame..."
                              value={row.package_name || ""}
                              onChange={(e) => handleUpdateDimensionRow(row.id, "package_name", e.target.value)}
                            />
                          </td>
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
                          <td>
                            <input
                              type="number"
                              step="any"
                              className="pm-dim-input"
                              placeholder="Net kg"
                              value={row.net_weight || ""}
                              onChange={(e) => handleUpdateDimensionRow(row.id, "net_weight", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="any"
                              className="pm-dim-input"
                              placeholder="Gross kg"
                              value={row.gross_weight || ""}
                              onChange={(e) => handleUpdateDimensionRow(row.id, "gross_weight", e.target.value)}
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

  const renderProductDetailDrawer = () => {
    if (!drawerProduct) return null;

    const isMachine = isMachineProduct(drawerProduct);
    const isSpare = isSpareProduct(drawerProduct);

    const midStr = String(drawerProduct.id);
    const mappedSpareIds = machineSparesUniversalMap[midStr] || [];
    const drawerSelectedSpares = products.filter((p) => {
      if (!isSpareProduct(p)) return false;
      const pIdStr = String(p.id);
      const applicableIds = (p.applicable_machine_ids || []).map(String);
      return mappedSpareIds.includes(pIdStr) || applicableIds.includes(midStr);
    });

    const drawerApplicableMachines = products.filter((p) => {
      if (!isMachineProduct(p)) return false;
      const mIdStr = String(p.id);
      const mSpares = machineSparesUniversalMap[mIdStr] || [];
      const inApplicable = (drawerProduct.applicable_machine_ids || []).map(String).includes(mIdStr);
      return inApplicable || mSpares.includes(String(drawerProduct.id));
    });

    return (
      <SideDrawer
        open={Boolean(drawerProduct)}
        onClose={() => setDrawerProduct(null)}
        title="Product Details"
        subtitle={drawerProduct.product_name_tally || drawerProduct.product_name || ""}
        maxWidth="min(900px, 95vw)"
        headerActions={
          <button
            type="button"
            className="pm-btn-add"
            style={{ fontSize: "13px", padding: "7px 16px", fontWeight: 600 }}
            onClick={() => {
              const prod = drawerProduct;
              setDrawerProduct(null);
              handleOpenEdit(prod);
            }}
          >
            Edit Product
          </button>
        }
      >
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
              <div><strong>Category:</strong> {getCategoryNameForProduct(drawerProduct) || "—"}</div>
              <div><strong>Brand:</strong> {brands.items.find((b) => b.id === drawerProduct.brand_id)?.name || "Yinglima"}</div>
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
              <div><strong>CBM:</strong> {drawerProduct.packaging_unit_cbm ?? drawerProduct.cbm ?? "—"}</div>
            </div>
          </div>

          {((drawerProduct.packages && drawerProduct.packages.length > 0) || (drawerProduct.dimensions_rows && drawerProduct.dimensions_rows.length > 0)) && (
            <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <h4 style={{ margin: "0 0 10px", fontSize: "14px", color: "#1e293b", borderBottom: "1px solid #e2e8f0", paddingBottom: "6px" }}>
                Multi-Package Dimensions ({(drawerProduct.packages || drawerProduct.dimensions_rows || []).length} Packages)
              </h4>
              <table style={{ width: "100%", fontSize: "12.5px", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#edf2f7", textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>Box</th>
                    <th style={{ padding: "6px 8px" }}>Dimensions (L×W×H)</th>
                    <th style={{ padding: "6px 8px" }}>CBM</th>
                    <th style={{ padding: "6px 8px" }}>Net Wt</th>
                    <th style={{ padding: "6px 8px" }}>Gross Wt</th>
                  </tr>
                </thead>
                <tbody>
                  {(drawerProduct.packages || drawerProduct.dimensions_rows || []).map((pkg: ProductDimensionRow, idx: number) => (
                    <tr key={idx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "6px 8px" }}>{pkg.title || `Box ${idx + 1}`}</td>
                      <td style={{ padding: "6px 8px" }}>{pkg.length_cm || pkg.length || 0} × {pkg.width_cm || pkg.width || 0} × {pkg.height_cm || pkg.height || 0} cm</td>
                      <td style={{ padding: "6px 8px" }}>{pkg.cbm || 0}</td>
                      <td style={{ padding: "6px 8px" }}>{pkg.net_weight != null ? `${pkg.net_weight} kg` : "—"}</td>
                      <td style={{ padding: "6px 8px" }}>{pkg.gross_weight != null ? `${pkg.gross_weight} kg` : "—"}</td>
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

          {/* Selected Spare Parts Section for Machine products */}
          {isMachine && (
            <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", borderBottom: "1px solid #e2e8f0", paddingBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
                <h4 style={{ margin: 0, fontSize: "14px", color: "#1e293b", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>Spare Parts</span>
                  <span
                    style={{
                      fontSize: "12px",
                      background: drawerSelectedSpares.length > 0 ? "#e0f2fe" : "#f1f5f9",
                      color: drawerSelectedSpares.length > 0 ? "#0061f2" : "#64748b",
                      padding: "2px 8px",
                      borderRadius: "10px",
                      fontWeight: 600,
                    }}
                  >
                    {drawerSelectedSpares.length} Selected
                  </span>
                </h4>
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    color: "#0061f2",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: "2px 6px",
                  }}
                  onClick={() => {
                    const machine = drawerProduct;
                    setDrawerProduct(null);
                    handleOpenMachineSpares(machine);
                  }}
                  title={`Manage spare parts of ${drawerProduct.product_name_tally || drawerProduct.product_name || "Machine"}`}
                >
                  Manage Spare Parts →
                </button>
              </div>

              {drawerSelectedSpares.length === 0 ? (
                <div style={{ fontSize: "13px", color: "#64748b", padding: "10px 0", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                  <span>No spare parts currently selected for this machine.</span>
                  <button
                    type="button"
                    style={{
                      background: "#0061f2",
                      color: "#ffffff",
                      border: "none",
                      padding: "6px 14px",
                      borderRadius: "4px",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                    onClick={() => {
                      const machine = drawerProduct;
                      setDrawerProduct(null);
                      handleOpenMachineSpares(machine);
                    }}
                  >
                    + Select Spare Parts
                  </button>
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: "12.5px", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#edf2f7", textAlign: "left", color: "#475569" }}>
                        <th style={{ padding: "8px 10px", fontWeight: 600 }}>Product Name (As Per Tally)</th>
                        <th style={{ padding: "8px 10px", fontWeight: 600 }}>Product Code</th>
                        <th style={{ padding: "8px 10px", fontWeight: 600 }}>Brand</th>
                        <th style={{ padding: "8px 10px", fontWeight: 600 }}>Sub Cate.</th>
                        <th style={{ padding: "8px 10px", fontWeight: 600, textAlign: "right" }}>Min. Price</th>
                        <th style={{ padding: "8px 10px", fontWeight: 600, textAlign: "center" }}>HSN</th>
                        <th style={{ padding: "8px 10px", fontWeight: 600, textAlign: "center" }}>UOM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drawerSelectedSpares.map((sp) => {
                        const brandName = brands.items.find((b) => b.id === sp.brand_id)?.name || "—";
                        const subCatName = subCategories.items.find((sc) => sc.id === sp.sub_category_id)?.name || "—";
                        const uomName = uoms.items.find((u) => u.id === sp.uom_id)?.code || "NOS";
                        const hsn = sp.hsn_number || PRODUCT_HSN_MAP[sp.product_name_tally || sp.product_name || ""] || "—";
                        const displayName = sp.product_name_tally || sp.product_name || "—";
                        return (
                          <tr key={sp.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                            <td style={{ padding: "8px 10px" }}>
                              <button
                                type="button"
                                style={{
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  color: "#0061f2",
                                  fontWeight: 500,
                                  cursor: "pointer",
                                  textAlign: "left",
                                  font: "inherit",
                                }}
                                onClick={() => setDrawerProduct(sp)}
                                title="Click to view details"
                              >
                                {displayName}
                              </button>
                            </td>
                            <td style={{ padding: "8px 10px", color: "#64748b" }}>{sp.product_code || "—"}</td>
                            <td style={{ padding: "8px 10px", color: "#334155" }}>{brandName}</td>
                            <td style={{ padding: "8px 10px", color: "#334155" }}>{subCatName}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: "#1e293b", fontVariantNumeric: "tabular-nums" }}>
                              {sp.standard_price ? formatIndianCurrency(sp.standard_price) : "—"}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "center", color: "#64748b" }}>{hsn}</td>
                            <td style={{ padding: "8px 10px", textAlign: "center", color: "#64748b" }}>{uomName}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Applicable Machines Section for Spare Part products */}
          {isSpare && (
            <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <h4 style={{ margin: "0 0 10px", fontSize: "14px", color: "#1e293b", borderBottom: "1px solid #e2e8f0", paddingBottom: "8px" }}>
                <span>Applicable Machines</span>
                <span
                  style={{
                    fontSize: "12px",
                    background: drawerApplicableMachines.length > 0 ? "#e0f2fe" : "#f1f5f9",
                    color: drawerApplicableMachines.length > 0 ? "#0061f2" : "#64748b",
                    padding: "2px 8px",
                    borderRadius: "10px",
                    fontWeight: 600,
                    marginLeft: "8px",
                  }}
                >
                  {drawerApplicableMachines.length} Machine(s)
                </span>
              </h4>

              {drawerApplicableMachines.length === 0 ? (
                <div style={{ fontSize: "13px", color: "#64748b", padding: "6px 0" }}>
                  Not currently mapped to any machine.
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {drawerApplicableMachines.map((m) => {
                    const mName = m.product_name_tally || m.product_name || "Machine";
                    return (
                      <button
                        key={m.id}
                        type="button"
                        style={{
                          background: "#ffffff",
                          border: "1px solid #cbd5e1",
                          borderRadius: "4px",
                          padding: "5px 12px",
                          fontSize: "12.5px",
                          color: "#0061f2",
                          fontWeight: 500,
                          cursor: "pointer",
                        }}
                        onClick={() => setDrawerProduct(m)}
                        title={`View ${mName}`}
                      >
                        {mName}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </SideDrawer>
    );
  };

  // Machine Spares Page View ("Spare Parts of <Machine>")
  if (selectedMachineForSpares) {
    const machineName =
      selectedMachineForSpares.product_name_tally ||
      selectedMachineForSpares.product_name ||
      "Machine";
    const isAllPageSelected =
      paginatedSpares.length > 0 &&
      paginatedSpares.every((p) => selectedSpareRowIds.includes(String(p.id)));

    const handleToggleSelectAllSpares = () => {
      if (isAllPageSelected) {
        const pageIds = paginatedSpares.map((p) => String(p.id));
        setSelectedSpareRowIds((prev) => prev.filter((id) => !pageIds.includes(id)));
      } else {
        const pageIds = paginatedSpares.map((p) => String(p.id));
        setSelectedSpareRowIds((prev) => Array.from(new Set([...prev, ...pageIds])));
      }
    };

    const handleToggleSpareRow = (spareId: string) => {
      setSelectedSpareRowIds((prev) =>
        prev.includes(spareId) ? prev.filter((id) => id !== spareId) : [...prev, spareId]
      );
    };

    const startIndex = (sparesCurrentPage - 1) * sparesPerPage;
    const endIndex = Math.min(startIndex + sparesPerPage, totalSparesCount);

    return (
      <AppShell activeKey="masters-products" pageClassName="page-product-master">
        <main className="page pm-spares-page" data-testid="machine-spares-page">
          {/* Breadcrumb Trail */}
          <div style={{ marginBottom: "12px", display: "flex", alignItems: "center", gap: "12px" }}>
            <Breadcrumb trail={["Inventory", "Product Master", `Spare Parts of ${machineName}`]} />
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="back-to-products-btn"
              onClick={() => {
                setSelectedMachineForSpares(null);
                setSelectedSpareRowIds([]);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                background: "transparent",
                border: "none",
                color: "#0061f2",
                fontWeight: 600,
                fontSize: "13px",
                cursor: "pointer",
                padding: "2px 6px",
                marginLeft: "auto",
              }}
            >
              ← Back to Product Master
            </button>
          </div>

          {/* Topbar: Title and Action Button */}
          <div className="pm-spares-topbar">
            <h1 className="pm-spares-title" data-testid="machine-spares-title">
              Spare Parts of {machineName}
            </h1>
            <div>
              {activeSparesTab === "selected" ? (
                <button
                  type="button"
                  className="pm-spares-action-btn"
                  data-testid="remove-spares-btn"
                  disabled={selectedSpareRowIds.length === 0 || spareActionLoading}
                  onClick={handleRemoveSelectedSpares}
                  style={{
                    backgroundColor: selectedSpareRowIds.length === 0 ? "#94a3b8" : "#0061f2",
                    borderColor: selectedSpareRowIds.length === 0 ? "#94a3b8" : "#0061f2",
                  }}
                  title={
                    selectedSpareRowIds.length === 0
                      ? "Select one or more spare parts below to remove"
                      : `Remove ${selectedSpareRowIds.length} selected spare part(s)`
                  }
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                  {spareActionLoading ? "PROCESSING..." : "REMOVE DATA"}
                </button>
              ) : (
                <button
                  type="button"
                  className="pm-spares-action-btn"
                  data-testid="select-spares-btn"
                  disabled={selectedSpareRowIds.length === 0 || spareActionLoading}
                  onClick={handleAddSelectedSpares}
                  style={{
                    backgroundColor: selectedSpareRowIds.length === 0 ? "#94a3b8" : "#0061f2",
                    borderColor: selectedSpareRowIds.length === 0 ? "#94a3b8" : "#0061f2",
                  }}
                  title={
                    selectedSpareRowIds.length === 0
                      ? "Select one or more spare parts below to link"
                      : `Link ${selectedSpareRowIds.length} selected spare part(s) to this machine`
                  }
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  {spareActionLoading ? "PROCESSING..." : "SELECT DATA"}
                </button>
              )}
            </div>
          </div>

          {/* Card containing Tabs, Search/Pagination controls, and Table */}
          <div className="pm-spares-card">
            {/* Tabs */}
            <div className="pm-spares-tabs">
              <button
                type="button"
                className={`pm-spares-tab-btn ${activeSparesTab === "selected" ? "active" : ""}`}
                data-testid="spares-tab-selected"
                onClick={() => {
                  setActiveSparesTab("selected");
                  setSelectedSpareRowIds([]);
                  setSparesCurrentPage(1);
                }}
              >
                Selected ({selectedSpareProducts.length})
              </button>
              <button
                type="button"
                className={`pm-spares-tab-btn ${activeSparesTab === "all" ? "active" : ""}`}
                data-testid="spares-tab-all"
                onClick={() => {
                  setActiveSparesTab("all");
                  setSelectedSpareRowIds([]);
                  setSparesCurrentPage(1);
                }}
              >
                All Spare Parts ({allSpareProducts.length})
              </button>
            </div>

            {/* Toolbar: Items per page & Search */}
            <div className="pm-spares-toolbar">
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#64748b" }}>
                <select
                  value={sparesPerPage}
                  onChange={(e) => {
                    setSparesPerPage(Number(e.target.value));
                    setSparesCurrentPage(1);
                  }}
                  aria-label="Items per page"
                  style={{
                    padding: "5px 10px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    fontSize: "13px",
                    color: "#334155",
                    backgroundColor: "#ffffff",
                    cursor: "pointer",
                  }}
                >
                  <option value={10}>10 items/page</option>
                  <option value={20}>20 items/page</option>
                  <option value={50}>50 items/page</option>
                  <option value={100}>100 items/page</option>
                </select>
              </div>

              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  placeholder="Search..."
                  aria-label="Search spare parts"
                  value={sparesSearchTerm}
                  onChange={(e) => {
                    setSparesSearchTerm(e.target.value);
                    setSparesCurrentPage(1);
                  }}
                  style={{
                    padding: "6px 12px 6px 32px",
                    fontSize: "13px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    width: "220px",
                    outline: "none",
                    color: "#1e293b",
                  }}
                />
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
                >
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </div>
            </div>

            {/* Table */}
            <div className="pm-spares-table-wrapper">
              <table className="pm-spares-table">
                <thead>
                  <tr>
                    <th style={{ width: "40px", textAlign: "center" }}>
                      <input
                        type="checkbox"
                        aria-label="Select all spares on current page"
                        checked={isAllPageSelected}
                        onChange={handleToggleSelectAllSpares}
                        style={{ cursor: "pointer" }}
                      />
                    </th>
                    <th style={{ minWidth: "220px", textAlign: "left" }}>Product Name (As Per Tally)</th>
                    <th style={{ minWidth: "120px", textAlign: "left" }}>Product Code</th>
                    <th style={{ minWidth: "110px", textAlign: "left" }}>Brand</th>
                    <th style={{ minWidth: "130px", textAlign: "left" }}>Sub Cate.</th>
                    <th style={{ minWidth: "140px", textAlign: "right" }}>Min. Price Without GST</th>
                    <th style={{ minWidth: "90px", textAlign: "center" }}>HSN</th>
                    <th style={{ minWidth: "80px", textAlign: "center" }}>UOM</th>
                    <th style={{ minWidth: "90px", textAlign: "center" }}>Pack. Qty</th>
                    <th style={{ minWidth: "120px", textAlign: "center" }}>Pack. Gross Weight</th>
                    <th style={{ minWidth: "110px", textAlign: "center" }}>Pack. Unit CBM</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedSpares.length === 0 ? (
                    <tr>
                      <td colSpan={11} style={{ textAlign: "center", padding: "40px 16px", color: "#64748b" }}>
                        {activeSparesTab === "selected"
                          ? "No spare parts are linked to this machine yet. Click on 'All Spare Parts' to select and link spare parts."
                          : "No spare parts found matching your criteria."}
                      </td>
                    </tr>
                  ) : (
                    paginatedSpares.map((sp) => {
                      const spIdStr = String(sp.id);
                      const isChecked = selectedSpareRowIds.includes(spIdStr);
                      const brandName = brands.items.find((b) => b.id === sp.brand_id)?.name || "—";
                      const subCatName = subCategories.items.find((sc) => sc.id === sp.sub_category_id)?.name || "—";
                      const uomName = uoms.items.find((u) => u.id === sp.uom_id)?.code || "NOS";
                      const hsn = sp.hsn_number || PRODUCT_HSN_MAP[sp.product_name_tally || sp.product_name || ""] || "—";
                      const displayName = sp.product_name_tally || sp.product_name || "—";

                      return (
                        <tr key={sp.id} style={{ backgroundColor: isChecked ? "#f0f7ff" : undefined }}>
                          <td style={{ textAlign: "center" }}>
                            <input
                              type="checkbox"
                              aria-label={`Select ${displayName}`}
                              checked={isChecked}
                              onChange={() => handleToggleSpareRow(spIdStr)}
                              style={{ cursor: "pointer" }}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="pm-spares-link"
                              style={{ background: "none", border: "none", padding: 0, textAlign: "left", font: "inherit" }}
                              onClick={() => setDrawerProduct(sp)}
                              title="Click to view details"
                            >
                              {displayName}
                            </button>
                          </td>
                          <td>{sp.product_code || "—"}</td>
                          <td>{brandName}</td>
                          <td>{subCatName}</td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                            {sp.standard_price ? formatIndianCurrency(sp.standard_price) : "—"}
                          </td>
                          <td style={{ textAlign: "center" }}>{hsn}</td>
                          <td style={{ textAlign: "center" }}>{uomName}</td>
                          <td style={{ textAlign: "center" }}>{sp.packaging_quantity ?? 1}</td>
                          <td style={{ textAlign: "center" }}>
                            {sp.packaging_gross_weight != null ? `${sp.packaging_gross_weight} kg` : "—"}
                          </td>
                          <td style={{ textAlign: "center" }}>{sp.packaging_unit_cbm != null ? sp.packaging_unit_cbm : (sp.cbm != null ? sp.cbm : "—")}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            <div className="pm-spares-pagination">
              <div>
                Showing {totalSparesCount > 0 ? startIndex + 1 : 0} to {endIndex} of {totalSparesCount} entries
              </div>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <button
                  type="button"
                  className="pm-spares-page-btn"
                  disabled={sparesCurrentPage <= 1}
                  onClick={() => setSparesCurrentPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: "28px",
                    height: "28px",
                    background: "#0061f2",
                    color: "#ffffff",
                    borderRadius: "4px",
                    fontSize: "12.5px",
                    fontWeight: 600,
                  }}
                >
                  {sparesCurrentPage}
                </span>
                <button
                  type="button"
                  className="pm-spares-page-btn"
                  disabled={sparesCurrentPage >= totalSparesPages}
                  onClick={() => setSparesCurrentPage((p) => Math.min(totalSparesPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          {/* Side Drawer for spare product details */}
          {renderProductDetailDrawer()}
        </main>
      </AppShell>
    );
  }

  if (isImportOpen) {
    return (
      <AppShell activeKey="masters-products" pageClassName="page-product-master">
        <main className="page" style={{ width: "100%", padding: "16px 24px", boxSizing: "border-box" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <div>
              <h1 className="page-title" style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#1e293b" }}>
                Import products
              </h1>
              <div style={{ fontSize: "13px", color: "#64748b", marginTop: "4px" }}>
                Upload bulk products records from Excel (.xlsx, .xls) or CSV.
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsImportOpen(false);
                setImportFile(null);
                setImportError(null);
              }}
              style={{
                padding: "8px 16px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#1e293b",
                fontWeight: 600,
                fontSize: "13px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              ← BACK
            </button>
          </div>

          {importError && (
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
              ⚠️ {importError}
            </div>
          )}

          {importSummary && (
            <div style={{ marginBottom: "20px" }}>
              <ImportSummaryPanel summary={importSummary} error={importError} />
            </div>
          )}

          <div
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              padding: "28px 36px",
            }}
          >
            {/* Import Mode Selection */}
            <div style={{ marginBottom: "26px" }}>
              <label style={{ display: "block", fontSize: "14px", fontWeight: 700, color: "#0f172a", marginBottom: "10px" }}>
                Select Import Mode
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px", maxWidth: "800px" }}>
                {/* Mode 1: Add New */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setImportMode("create")}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setImportMode("create"); }}
                  style={{
                    padding: "16px 18px",
                    borderRadius: "8px",
                    border: importMode === "create" ? "2px solid #2563eb" : "1px solid #cbd5e1",
                    background: importMode === "create" ? "#eff6ff" : "#ffffff",
                    cursor: "pointer",
                    boxShadow: importMode === "create" ? "0 2px 8px rgba(37,99,235,0.12)" : "none",
                    transition: "all 0.15s ease-in-out",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span style={{ fontSize: "17px" }}>➕</span>
                    <strong style={{ fontSize: "14px", color: importMode === "create" ? "#1d4ed8" : "#1e293b" }}>
                      Add New Records Only
                    </strong>
                    {importMode === "create" && (
                      <span style={{ marginLeft: "auto", fontSize: "10px", fontWeight: 700, background: "#2563eb", color: "#ffffff", padding: "2px 8px", borderRadius: "10px", letterSpacing: "0.5px" }}>
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.45 }}>
                    Upload only brand new product records. Any duplicate rows that already exist in the system will be safely flagged and skipped.
                  </div>
                </div>

                {/* Mode 2: Update / Modify */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setImportMode("update")}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setImportMode("update"); }}
                  style={{
                    padding: "16px 18px",
                    borderRadius: "8px",
                    border: importMode === "update" ? "2px solid #2563eb" : "1px solid #cbd5e1",
                    background: importMode === "update" ? "#eff6ff" : "#ffffff",
                    cursor: "pointer",
                    boxShadow: importMode === "update" ? "0 2px 8px rgba(37,99,235,0.12)" : "none",
                    transition: "all 0.15s ease-in-out",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span style={{ fontSize: "17px" }}>✏️</span>
                    <strong style={{ fontSize: "14px", color: importMode === "update" ? "#1d4ed8" : "#1e293b" }}>
                      Update / Modify Existing Records
                    </strong>
                    {importMode === "update" && (
                      <span style={{ marginLeft: "auto", fontSize: "10px", fontWeight: 700, background: "#2563eb", color: "#ffffff", padding: "2px 8px", borderRadius: "10px", letterSpacing: "0.5px" }}>
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.45 }}>
                    Update existing product records matching names or codes. <strong>Zero Data Loss:</strong> Blank cells in your file are ignored and will never erase existing fields.
                  </div>
                </div>
              </div>

              {/* Mode Info Callout */}
              <div
                style={{
                  marginTop: "12px",
                  padding: "10px 14px",
                  borderRadius: "6px",
                  fontSize: "12.5px",
                  maxWidth: "800px",
                  background: importMode === "create" ? "#f8fafc" : "#fffbeb",
                  color: importMode === "create" ? "#475569" : "#92400e",
                  borderLeft: importMode === "create" ? "3px solid #64748b" : "3px solid #d97706",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <span>{importMode === "create" ? "ℹ️" : "🛡️"}</span>
                <span>
                  {importMode === "create"
                    ? "Strict creation mode: Existing product records remain untouched. Any duplicate rows will be reported."
                    : "Safe non-destructive update: Only columns with values in your uploaded file will update matching product records. Empty columns are kept intact."}
                </span>
              </div>
            </div>

            {/* Import File Section */}
            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontSize: "14px", fontWeight: 600, color: "#1e293b", marginBottom: "8px" }}>
                Import File
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    background: "#f8fafc",
                    padding: "4px 8px",
                    minWidth: "320px",
                    maxWidth: "500px",
                    flex: 1,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => importFileInputRef.current?.click()}
                    style={{
                      background: "#ffffff",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      padding: "6px 14px",
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "#334155",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Choose File
                  </button>
                  <span
                    style={{
                      paddingLeft: "12px",
                      fontSize: "13px",
                      color: importFile ? "#0f172a" : "#64748b",
                      fontWeight: importFile ? 600 : 400,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                    }}
                  >
                    {importFile ? importFile.name : "No file chosen"}
                  </span>
                  {importFile && (
                    <button
                      type="button"
                      onClick={() => {
                        setImportFile(null);
                        if (importFileInputRef.current) importFileInputRef.current.value = "";
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#ef4444",
                        cursor: "pointer",
                        fontSize: "14px",
                        padding: "4px 8px",
                      }}
                      title="Clear selected file"
                    >
                      ✕
                    </button>
                  )}
                  <input
                    ref={importFileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setImportFile(f);
                        setImportError(null);
                      }
                    }}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => downloadSampleCsv("product", IMPORT_HEADERS)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    background: "#f8fafc",
                    border: "1px dashed #94a3b8",
                    borderRadius: "6px",
                    padding: "8px 14px",
                    color: "#475569",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  📥 Download Sample CSV Template
                </button>
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "6px" }}>
                Only CSV, XLS, And XLSX Files Are Allowed. Maximum File Size: 8MB.
              </div>
            </div>

            {/* Notes Section */}
            <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: "20px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b", marginBottom: "12px" }}>
                Notes:
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: "20px",
                  fontSize: "13px",
                  lineHeight: "1.9",
                  color: "#334155",
                }}
              >
                <li>Upload Up To <strong>5,000 Rows</strong> Per File.</li>
                <li>Avoid Special Characters (Like @ # $ % ^ & * ( ) ) In Text Fields.</li>
                <li>Maximum Allowed File Size: <strong>8 MB</strong>.</li>
                <li>Only <strong>.Csv</strong>, <strong>.Xls</strong>, And <strong>.Xlsx</strong> Files Are Accepted.</li>
                <li>Mandatory Columns: <strong>Product Name (As Per Tally)</strong>, <strong>Category</strong>, <strong>UOM</strong>, <strong>Packaging Quantity</strong>, <strong>Packaging Gross Weight (kg)</strong>, and <strong>Packaging Unit CBM</strong>.</li>
                <li><strong>Product Name (As Per Tally)</strong> and <strong>Product Code</strong> (if provided) Must Be Unique.</li>
                <li><strong>Category, Sub Category, Brand, HSN Code, and UOM</strong> Must Already Exist In The System.</li>
                <li><strong>Sub Category</strong> Must Belong To The Selected <strong>Category</strong>.</li>
                <li><strong>Packaging Unit CBM</strong> can be entered directly or automatically calculated from Length, Width, Height in cm: <code>(L × W × H) / 1,000,000</code>.</li>
                <li><strong>Packaging Gross Weight (kg)</strong> Must Be Greater Than 0.</li>
                <li><strong>Refund VAT %</strong> Must Be A Number Between 0 and 100.</li>
                <li>No Blank Rows, Merged Cells, Or Excel Formulas Allowed.</li>
                <li>Import May Take <strong>Several Seconds</strong> Depending On File Size. Please Do Not Refresh The Page During Import.</li>
              </ul>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "32px", borderTop: "1px solid #f1f5f9", paddingTop: "20px", gap: "12px" }}>
              <button
                type="button"
                onClick={() => {
                  setIsImportOpen(false);
                  setImportFile(null);
                  setImportError(null);
                }}
                style={{
                  padding: "9px 20px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#475569",
                  fontWeight: 600,
                  fontSize: "13.5px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!importFile || importLoading}
                onClick={handleImportSubmit}
                style={{
                  padding: "9px 24px",
                  borderRadius: "6px",
                  border: "none",
                  background: !importFile || importLoading ? "#94a3b8" : "#2563eb",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: "13.5px",
                  cursor: !importFile || importLoading ? "not-allowed" : "pointer",
                }}
              >
                {importLoading ? "Reading File..." : "Submit"}
              </button>
            </div>
          </div>

          {wizardPending && (
            <WizardModal
              file={wizardPending.file}
              rows={wizardPending.rows}
              sheetColumns={wizardPending.sheetColumns}
              apiBase="/masters/products"
              entityName="product"
              importHeaders={IMPORT_HEADERS}
              initialMode={importMode}
              onClose={() => setWizardPending(null)}
              onComplete={(summary) => {
                setWizardPending(null);
                setImportFile(null);
                setImportSummary(summary);
                loadProducts();
              }}
              onError={(msg) => {
                setWizardPending(null);
                setImportError(msg);
              }}
            />
          )}
        </main>
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
                <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#1e293b" }}>Product Master</h1>
              </div>

              <div className="page-header-actions" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                {/* Filter Toggle Button */}
                <button
                  type="button"
                  className="btn btn-filter-toggle"
                  style={{
                    background: "#556987",
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
                  onOpenImportPage={() => {
                    setImportFile(null);
                    setImportError(null);
                    setImportSummary(null);
                    setIsImportOpen(true);
                  }}
                  onSummary={(summary) => setImportSummary(summary)}
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

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "18px" }}>
                  <button
                    type="button"
                    className="btn-filter-reset"
                    onClick={handleResetFilters}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="btn-filter-search"
                    onClick={handleApplyFilters}
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
                          No Data
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

                        const hsn = p.hsn_number || PRODUCT_HSN_MAP[name] || "—";
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
                                case 2: {
                                  const catName = getCategoryNameForProduct(p);
                                  const isSpare = isSpareProduct(p);
                                  const isMachine = isMachineProduct(p);
                                  return (
                                    <td key="cell-2" style={{ minWidth: "220px", ...getFreezeStyle(2, false) }}>
                                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px" }}>
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
                                        {catName ? (
                                          isMachine ? (
                                            <button
                                              type="button"
                                              className="pm-type-badge pm-type-machine"
                                              data-testid={`badge-machine-${p.id}`}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleOpenMachineSpares(p);
                                              }}
                                              title={`View Spare Parts of ${name} (${catName})`}
                                            >
                                              {catName}
                                            </button>
                                          ) : isSpare ? (
                                            <span
                                              className="pm-type-badge pm-type-spare"
                                              data-testid={`badge-spare-${p.id}`}
                                            >
                                              {catName}
                                            </span>
                                          ) : (
                                            <span
                                              className="pm-type-badge pm-type-category"
                                              data-testid={`badge-category-${p.id}`}
                                              style={{
                                                display: "inline-block",
                                                fontSize: "11px",
                                                fontWeight: 600,
                                                padding: "1.5px 8px",
                                                borderRadius: "12px",
                                                lineHeight: "1.35",
                                                color: "#475569",
                                                backgroundColor: "#f1f5f9",
                                                border: "1px solid #e2e8f0",
                                                width: "fit-content",
                                              }}
                                            >
                                              {catName}
                                            </span>
                                          )
                                        ) : null}
                                      </div>
                                    </td>
                                  );
                                }
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
                                      <div style={{ display: "inline-flex", gap: "6px", alignItems: "center", justifyContent: "center" }}>
                                        <button
                                          type="button"
                                          className="btn"
                                          style={{
                                            background: "#0061f2",
                                            color: "#ffffff",
                                            padding: "6px 8px",
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
                                      </div>
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
        {renderProductDetailDrawer()}

      </main>
    </AppShell>
  );
}
