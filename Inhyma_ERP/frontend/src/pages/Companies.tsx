/**
 * Company Profiles. Ported from suppliers.html + suppliers.js.
 *
 * Implements the list view (top filter fields, truncated multi-value columns
 * with a "+N more" expander, inline editable Grade/Potential dropdowns) and the
 * two-step First-Data-Form / Main-Profile creation flow, plus the Contacts
 * sub-panel.
 *
 * Country/State/City/Category/Sub-Category/Product selectors are all type-ahead
 * rather than pre-loaded <select> lists: Cities alone can realistically reach
 * tens of thousands of rows, and a browser <select> with that many options is
 * both slow to render and unusable to scroll. Table-column name lookups use a
 * bounded NameResolver that only resolves the IDs on the current page of
 * results, not the full related tables.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Banner, ModalAlert, TableMessageRow } from "@/components/ui";
import { SideDrawer, DetailFieldGrid } from "@/components/SideDrawer";
import { Pagination } from "@/components/Pagination";
import { ItemPopoverCell } from "@/components/ItemPopoverCell";
import { ImpExpDropdown, BulkActionsDropdown, ImportSummaryPanel, downloadSampleCsv, parseFile, WizardModal, type SheetRow } from "@/components/ImportWizard";
import { DateRangePicker } from "@/components/DateRangePicker";
import {
  SearchableDropdown,
  type DropdownOption,
} from "@/components/SearchableDropdown";
import { autoTitleCase } from "@/components/fields";
import { useLiveModule } from "@/lib/live/useLive";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  downloadExport,
  toQueryString,
} from "@/lib/api";
import { createNameResolver } from "@/lib/nameResolver";
import { useAuth, useSrNoJump, isSrNoQuery, usePendingGuard, useModalHistorySync } from "@/lib/hooks";
import { useOptions, optionValues } from "@/lib/options";
import {
  showsDirectImportCluster,
  showsImportSubFields,
  showsMonthlyTurnover,
  showsPotentialBusinessPerMonth,
  showsPotentialReason,
  clearInapplicableCompanyFields,
  computeAge,
} from "@/lib/companyFields";
import { useLiveConnectionStatus } from "@/lib/live/useLive";
import { useLiveList } from "@/lib/live/useLiveList";
import type {
  ImportHeader,
  ImportSummary,
  PaginationMeta,
  Company,
  CompanyContact,
} from "@/types";

/** Document rule: show 5 chips inline, the rest behind a "+N more" expander. */
/** Import field list for Suppliers, shared by the Import Wizard button and the Sample Template downloader so the two can never drift apart. */
const COMPANY_IMPORT_HEADERS: ImportHeader[] = [
  { key: "Company Name", label: "Company Name", required: true },
  { key: "Product Categories", label: "Product Categories" },
  { key: "Key Strength Sub-Categories", label: "Key Strength Sub-Categories" },
  { key: "Products Supplied", label: "Products Supplied" },
  { key: "Secondary Products", label: "Secondary Products" },
  { key: "Country", label: "Country", required: true },
  { key: "State / Province", label: "State / Province", required: true },
  { key: "City", label: "City", required: true },
  { key: "Brand Description", label: "Brand Description" },
  { key: "Company Type", label: "Company Type" },
  { key: "Current Status", label: "Current Status" },
  { key: "Company Grade", label: "Company Grade" },
  { key: "Potential", label: "Potential" },
  { key: "Potential Reason", label: "Potential Reason" },
  { key: "Contact Person", label: "Contact Person" },
  { key: "Designation", label: "Designation" },
  { key: "Calling Number", label: "Calling Number" },
  { key: "WhatsApp Number", label: "WhatsApp Number" },
  { key: "WeChat Number", label: "WeChat Number" },
  { key: "Emails", label: "Emails" },
  { key: "Tax ID / GST Number", label: "Tax ID / GST Number" },
  { key: "Address", label: "Address" },
  { key: "Town", label: "Town" },
  { key: "Primary Website", label: "Primary Website" },
  { key: "Secondary Website", label: "Secondary Website" },
  { key: "Visited Factory/Office", label: "Visited Factory/Office" },
  { key: "Visit Remarks", label: "Visit Remarks" },
  { key: "Overall Remarks", label: "Overall Remarks" },
  { key: "Status", label: "Status" },
];

const COMPANY_SECTORS = [
  "Automobile",
  "Bakery",
  "Beverage",
  "Chemical",
  "Confectionary",
  "Dairy",
  "Electrical",
  "Electronics",
  "Hardware",
  "Mechanical Items",
  "Other Food",
  "Others (Misc.)",
  "Pharmaceutical",
  "Snacks",
  "Textile",
];


const GST_STATE_CODE_MAP: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

const EMPTY_QUICK_FORM = {
  company_name: "",
  company_type: "",
  tax_id_number: "",
  area: "",
  state_id: "",
  district: "",
  city_id: "",
  contact_salutation: "Mr",
  contact_full_name: "",
  contact_designation: "",
  contact_indiamart_number: "",
  contact_calling_number: "",
  contact_whatsapp_number: "",
  primary_website: "",
  sales_person_id: "",
};

const EMPTY_SUPPLIER_FORM = {
  company_name: "",
  contact_salutation: "Mr",
  contact_full_name: "",
  contact_designation: "",
  tax_id_number: "",
  contact_calling_number: "",
  contact_indiamart_number: "",
  contact_whatsapp_number: "",
  primary_website: "",
  email: "",
  emails: [] as string[],
  secondary_website: "",
  address: "",
  area: "",
  state_id: "",
  district_id: "",
  district: "",
  city_id: "",
  pincode: "",
  current_status: "",
  company_type: "",
  category_id: "",
  company_grade: "",
  potential: "",
  company_category: "",
  product_manufacture_or_supply: "",
  machines_buying_from: "",
  spares_buying_from: "",
  products_interested: "",
  gst_registration_date: "",
  age_of_company: "",
  monthly_turnover: "",
  potential_business_per_month: "",
  direct_import_from_china: "",
  monthly_import_volume: "",
  products_needed_for_imports: "",
  social_media: [{ platform: "", url: "" }] as Array<{ platform: string; url: string }>,
  overall_remarks: "",
  sales_person_id: "",
  brand_description: "",
  town: "",
  potential_reason: "",
  secondary_products_description: "",
  visited_factory_office: "false",
  visit_remarks: "",
  visit_media_input: "",
  visit_video_url: "",
  contact_wechat_number: "",
  is_active: "true",
};

const EMPTY_CONTACT_FORM = {
  id: "",
  salutation: "",
  person_name: "",
  designation: "",
  handling_territory: "",
  calling_number: "",
  whatsapp_number: "",
  wechat_number: "",
  email: "",
  birth_date: "",
  anniversary_date: "",
};



/** Positive-sounding values read as active; everything else is neutral. */
function StatusPill({ value }: { value?: string | null }) {
  if (!value) return <span className="badge badge-neutral">Select</span>;
  const isPositive = value === "existing" || value === "yes" || value === "active";
  const cls = isPositive ? "badge-active" : "badge-neutral";
  const label =
    value === "existing"
      ? "Existing"
      : value === "new"
        ? "New"
        : value === "yes"
          ? "Yes"
          : value === "no"
            ? "No"
            : value;
  return <span className={`badge ${cls}`}>{label}</span>;
}



export const COMPANY_TABLE_COLUMNS = [
  "Checkbox",
  "Sr. No.",
  "Company",
  "Name / Designation",
  "Contact (Direct)",
  "Area / City",
  "Dist. / State",
  "Curr. Status",
  "Bus. Type",
  "Grade",
  "Potential",
  "Mac. Buying From",
  "P1 To Buy From Us",
  "Sales Per. / Added On",
  "Action",
];

function formatDateDMY(dStr: string | Date | null | undefined): string {
  if (!dStr) return "—";
  const d = new Date(dStr);
  if (isNaN(d.getTime())) return String(dStr);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function parseDateRange(rangeStr: string): { created_after?: string; created_before?: string } {
  if (!rangeStr || !rangeStr.trim()) return {};
  const separator = rangeStr.includes(" - ")
    ? " - "
    : rangeStr.includes(" to ")
      ? " to "
      : rangeStr.includes("-") && !rangeStr.includes("/")
        ? "-"
        : " - ";
  const parts = rangeStr.split(separator).map((s) => s.trim());
  const startStr = parts[0];
  const endStr = parts[1] || parts[0];

  const parseSingleDate = (s: string, isEnd: boolean): Date | null => {
    if (!s) return null;
    if (s.includes("/")) {
      const p = s.split("/");
      if (p.length === 3) {
        const m = parseInt(p[0], 10) - 1;
        const d = parseInt(p[1], 10);
        const y = parseInt(p[2], 10);
        if (!isNaN(m) && !isNaN(d) && !isNaN(y)) {
          return new Date(y, m, d, isEnd ? 23 : 0, isEnd ? 59 : 0, isEnd ? 59 : 0, isEnd ? 999 : 0);
        }
      }
    }
    if (s.includes("-")) {
      const p = s.split("-");
      if (p.length === 3) {
        if (p[0].length === 4) {
          const y = parseInt(p[0], 10);
          const m = parseInt(p[1], 10) - 1;
          const d = parseInt(p[2], 10);
          if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
            return new Date(y, m, d, isEnd ? 23 : 0, isEnd ? 59 : 0, isEnd ? 59 : 0, isEnd ? 999 : 0);
          }
        } else {
          const d = parseInt(p[0], 10);
          const m = parseInt(p[1], 10) - 1;
          const y = parseInt(p[2], 10);
          if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
            return new Date(y, m, d, isEnd ? 23 : 0, isEnd ? 59 : 0, isEnd ? 59 : 0, isEnd ? 999 : 0);
          }
        }
      }
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      if (isEnd) d.setHours(23, 59, 59, 999);
      else d.setHours(0, 0, 0, 0);
      return d;
    }
    return null;
  };

  const startDate = parseSingleDate(startStr, false);
  const endDate = parseSingleDate(endStr, true);

  const res: { created_after?: string; created_before?: string } = {};
  if (startDate) res.created_after = startDate.toISOString();
  if (endDate) res.created_before = endDate.toISOString();
  return res;
}

function CompanySkeletonRows({
  count = 8,
  displayOrder,
  getFreezeStyle,
}: {
  count?: number;
  displayOrder: number[];
  getFreezeStyle: (colIdx: number, isHeader?: boolean) => React.CSSProperties;
}) {
  const rowIndexes = Array.from({ length: count }, (_, i) => i);

  return (
    <>
      {rowIndexes.map((rowIndex) => (
        <tr key={`skeleton-row-${rowIndex}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
          {displayOrder.map((colIdx) => {
            let content: React.ReactNode = null;
            switch (colIdx) {
              case 0:
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
                    style={{ width: "30px", height: "14px", borderRadius: "3px", margin: "0 auto" }}
                  />
                );
                break;
              case 2: // Company
                content = (
                  <div>
                    <div className="skeleton-line" style={{ width: "130px", height: "14px", borderRadius: "4px", marginBottom: "4px" }} />
                    <div className="skeleton-line" style={{ width: "95px", height: "11px", borderRadius: "3px" }} />
                  </div>
                );
                break;
              case 3: // Name / Designation
                content = (
                  <div>
                    <div className="skeleton-line" style={{ width: "120px", height: "13px", borderRadius: "4px", marginBottom: "4px" }} />
                    <div className="skeleton-line" style={{ width: "70px", height: "11px", borderRadius: "3px" }} />
                  </div>
                );
                break;
              case 4: // Contact (Direct)
                content = (
                  <div>
                    <div className="skeleton-line" style={{ width: "95px", height: "12px", borderRadius: "3px", marginBottom: "4px" }} />
                    <div className="skeleton-line" style={{ width: "95px", height: "12px", borderRadius: "3px" }} />
                  </div>
                );
                break;
              case 5: // Area / City
              case 6: // Dist. / State
                content = (
                  <div>
                    <div className="skeleton-line" style={{ width: "80px", height: "12px", borderRadius: "3px", marginBottom: "4px" }} />
                    <div className="skeleton-line" style={{ width: "70px", height: "11px", borderRadius: "3px" }} />
                  </div>
                );
                break;
              case 7: // Curr. Status
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "55px", height: "20px", borderRadius: "10px", margin: "0 auto" }}
                  />
                );
                break;
              case 8: // Bus. Type
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "40px", height: "14px", borderRadius: "4px", margin: "0 auto" }}
                  />
                );
                break;
              case 9: // Grade
              case 10: // Potential
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "65px", height: "24px", borderRadius: "4px", margin: "0 auto" }}
                  />
                );
                break;
              case 11: // Mac. Buying From
              case 12: // P1 To Buy From Us
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "30px", height: "12px", borderRadius: "3px", margin: "0 auto" }}
                  />
                );
                break;
              case 13: // Sales Per. / Added On
                content = (
                  <div>
                    <div className="skeleton-line" style={{ width: "95px", height: "13px", borderRadius: "4px", marginBottom: "4px" }} />
                    <div className="skeleton-line" style={{ width: "75px", height: "11px", borderRadius: "3px" }} />
                  </div>
                );
                break;
              case 14: // Action
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "28px", height: "28px", borderRadius: "4px", margin: "0 auto" }}
                  />
                );
                break;
              default:
                content = <div className="skeleton-line" style={{ height: "14px" }} />;
            }

            return (
              <td
                key={`skeleton-cell-${colIdx}`}
                style={{
                  padding: "10px 12px",
                  verticalAlign: "middle",
                  width: colIdx === 0 ? "40px" : colIdx === 13 ? "60px" : undefined,
                  minWidth: colIdx === 0 ? "40px" : colIdx === 13 ? "60px" : undefined,
                  maxWidth: colIdx === 0 ? "45px" : undefined,
                  textAlign: colIdx === 0 || colIdx === 6 || colIdx === 7 || colIdx === 8 || colIdx === 9 || colIdx === 10 || colIdx === 11 || colIdx === 13 ? "center" : "left",
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

interface SelectWithSearchOption {
  value: string;
  label: string;
}

interface SelectWithSearchProps {
  id?: string;
  value: string;
  options: SelectWithSearchOption[];
  onChange: (value: string, label: string) => void;
  placeholder?: string;
  allowCustom?: boolean;
  hasError?: boolean;
  disabled?: boolean;
}

function SelectWithSearch({
  id,
  value,
  options,
  onChange,
  placeholder = "Select",
  allowCustom = false,
  hasError = false,
  disabled = false,
}: SelectWithSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleDocClick);
    return () => document.removeEventListener("mousedown", handleDocClick);
  }, [isOpen]);

  // Focus search/write input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setSearchTerm("");
      setHighlightedIndex(-1);
      const t = setTimeout(() => {
        inputRef.current?.focus();
      }, 40);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Selected label calculation
  const currentOption = options.find((opt) => opt.value === value);
  const displayLabel = currentOption ? currentOption.label : value ? value : placeholder;
  const isPlaceholder = !currentOption && !value;

  // Filter options based on search term
  const termLower = searchTerm.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!termLower) return options;
    return options.filter((opt) => opt.label.toLowerCase().includes(termLower));
  }, [options, termLower]);

  const hasExactMatch = useMemo(() => {
    if (!termLower) return false;
    return options.some((opt) => opt.label.toLowerCase() === termLower);
  }, [options, termLower]);

  function handleSelect(val: string, lbl: string) {
    onChange(val, lbl);
    setIsOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, filteredOptions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
        handleSelect(filteredOptions[highlightedIndex].value, filteredOptions[highlightedIndex].label);
      } else if (filteredOptions.length > 0) {
        handleSelect(filteredOptions[0].value, filteredOptions[0].label);
      } else if (allowCustom && searchTerm.trim()) {
        handleSelect(searchTerm.trim(), searchTerm.trim());
      }
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      {/* Trigger Box */}
      <div
        id={id}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => {
          if (!disabled) setIsOpen((prev) => !prev);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
            e.preventDefault();
            setIsOpen(true);
          }
        }}
        style={{
          width: "100%",
          height: "36px",
          border: hasError ? "1px solid #ef4444" : isOpen ? "1px solid #0061f2" : "1px solid #cbd5e1",
          borderRadius: "4px",
          padding: "0 10px",
          fontSize: "13.5px",
          boxSizing: "border-box",
          background: disabled ? "#f8fafc" : "#ffffff",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          outline: "none",
          userSelect: "none",
          boxShadow: isOpen ? "0 0 0 2px rgba(0, 97, 242, 0.15)" : "none",
          transition: "border-color 0.15s, box-shadow 0.15s",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: isPlaceholder ? "#64748b" : "#1e293b",
            fontWeight: isPlaceholder ? 400 : 500,
          }}
        >
          {displayLabel}
        </span>
        <span
          style={{
            fontSize: "10px",
            color: "#64748b",
            marginLeft: "8px",
            flexShrink: 0,
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
          }}
        >
          ▼
        </span>
      </div>

      {/* Dropdown Popover */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 2px)",
            left: 0,
            right: 0,
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: "4px",
            boxShadow: "0 6px 16px rgba(0, 0, 0, 0.14)",
            zIndex: 2200,
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          {/* Write / Search Input Box at Top */}
          <div style={{ padding: "6px 8px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder=""
              style={{
                width: "100%",
                height: "30px",
                border: "1px solid #cbd5e1",
                borderRadius: "3px",
                padding: "0 8px",
                fontSize: "13px",
                outline: "none",
                boxSizing: "border-box",
                background: "#ffffff",
              }}
            />
          </div>

          {/* Scrollable Options List */}
          <div
            ref={listRef}
            style={{
              maxHeight: "220px",
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            {/* "Select" option if no search term or search matches "select" */}
            {(!termLower || "select".includes(termLower)) && (
              <div
                onClick={() => handleSelect("", placeholder)}
                onMouseEnter={() => setHighlightedIndex(-1)}
                style={{
                  padding: "8px 12px",
                  fontSize: "13px",
                  cursor: "pointer",
                  background: !value ? "#0061f2" : highlightedIndex === -1 ? "#f1f5f9" : "#ffffff",
                  color: !value ? "#ffffff" : "#475569",
                  fontWeight: !value ? 600 : 400,
                  transition: "background 0.1s",
                }}
              >
                {placeholder}
              </div>
            )}

            {/* Filtered options list */}
            {filteredOptions.map((opt, idx) => {
              const isSelected = opt.value === value || (opt.label && opt.label.toLowerCase() === value.toLowerCase());
              const isHighlighted = idx === highlightedIndex;
              return (
                <div
                  key={opt.value || opt.label}
                  onClick={() => handleSelect(opt.value, opt.label)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  style={{
                    padding: "8px 12px",
                    fontSize: "13.5px",
                    cursor: "pointer",
                    background: isSelected ? "#0061f2" : isHighlighted ? "#f1f5f9" : "#ffffff",
                    color: isSelected ? "#ffffff" : "#1e293b",
                    fontWeight: isSelected ? 600 : 400,
                    transition: "background 0.1s",
                  }}
                >
                  {opt.label}
                </div>
              );
            })}

            {/* If custom option allowed and user typed something not matching any option */}
            {allowCustom && searchTerm.trim() && !hasExactMatch && (
              <div
                onClick={() => handleSelect(searchTerm.trim(), searchTerm.trim())}
                style={{
                  padding: "8px 12px",
                  fontSize: "13px",
                  cursor: "pointer",
                  background: "#f0fdf4",
                  color: "#166534",
                  fontWeight: 600,
                  borderTop: "1px solid #bbf7d0",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>➕</span>
                <span>Use &quot;{searchTerm.trim()}&quot;</span>
              </div>
            )}

            {filteredOptions.length === 0 && (!allowCustom || !searchTerm.trim()) && (!termLower || !"select".includes(termLower)) && (
              <div style={{ padding: "12px", textAlign: "center", color: "#94a3b8", fontSize: "12.5px" }}>
                No matches found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export interface CompanyAutocompleteItem {
  id: string;
  company_name: string;
  company_type?: string | null;
  tax_id_number?: string | null;
  area?: string | null;
  district?: string | null;
  city_id?: string | null;
  state_id?: string | null;
  contact_salutation?: string | null;
  contact_full_name?: string | null;
  contact_designation?: string | null;
  contact_calling_number?: string | null;
  contact_whatsapp_number?: string | null;
  contact_indiamart_number?: string | null;
  primary_website?: string | null;
  sales_person_id?: string | null;
}

interface CompanyNameAutocompleteProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onSelectCompany?: (company: CompanyAutocompleteItem) => void;
  placeholder?: string;
  hasError?: boolean;
  errorMessage?: string;
  preloadedCompanies?: Array<Company | CompanyAutocompleteItem>;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
  autoFocus?: boolean;
}

function CompanyNameAutocomplete({
  id = "company_name",
  value,
  onChange,
  onSelectCompany,
  placeholder = "Enter company name",
  hasError = false,
  errorMessage,
  preloadedCompanies = [],
  style,
  inputStyle,
  autoFocus,
}: CompanyNameAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [remoteItems, setRemoteItems] = useState<CompanyAutocompleteItem[]>([]);
  const [, setIsSearching] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [hasSelectedExact, setHasSelectedExact] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const term = value.trim();

  // Outside click listener
  useEffect(() => {
    function handleDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsFocused(false);
      }
    }
    document.addEventListener("mousedown", handleDocClick);
    return () => document.removeEventListener("mousedown", handleDocClick);
  }, []);

  // Debounced remote search
  useEffect(() => {
    if (!term || !isFocused || hasSelectedExact) {
      setRemoteItems([]);
      return;
    }
    const timer = setTimeout(() => {
      setIsSearching(true);
      apiGet<CompanyAutocompleteItem[]>(`/companies/lookup?q=${encodeURIComponent(term)}&limit=30`)
        .then((res) => {
          if (res?.data) {
            setRemoteItems(res.data);
          }
        })
        .catch(() => { })
        .finally(() => setIsSearching(false));
    }, 150);
    return () => clearTimeout(timer);
  }, [term, isFocused, hasSelectedExact]);

  // Combined suggestions
  const suggestions = useMemo(() => {
    if (!term) return [];
    const termLower = term.toLowerCase();
    const seen = new Set<string>();
    const list: CompanyAutocompleteItem[] = [];

    // Local matches from preloadedCompanies
    for (const c of preloadedCompanies) {
      if (c.company_name && c.company_name.toLowerCase().includes(termLower)) {
        const key = c.company_name.toLowerCase().trim();
        if (!seen.has(key)) {
          seen.add(key);
          list.push({
            id: c.id,
            company_name: c.company_name,
            company_type: c.company_type,
            tax_id_number: c.tax_id_number,
            area: c.area,
            district: c.district,
            city_id: c.city_id,
            state_id: c.state_id,
            contact_salutation: (c as any).contact_salutation,
            contact_full_name: (c as any).contact_full_name,
            contact_designation: (c as any).contact_designation,
            contact_calling_number: (c as any).contact_calling_number,
            contact_whatsapp_number: (c as any).contact_whatsapp_number,
            contact_indiamart_number: (c as any).contact_indiamart_number,
            primary_website: (c as any).primary_website,
            sales_person_id: (c as any).sales_person_id,
          });
        }
      }
    }

    // Remote items from /companies/lookup
    for (const r of remoteItems) {
      const key = r.company_name.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        list.push(r);
      }
    }

    return list;
  }, [term, preloadedCompanies, remoteItems]);

  const showDropdown = isOpen && isFocused && term.length > 0 && !hasSelectedExact;

  function handleSelect(item: CompanyAutocompleteItem) {
    onChange(item.company_name);
    setHasSelectedExact(true);
    setIsOpen(false);
    setHighlightedIndex(-1);
    if (onSelectCompany) {
      onSelectCompany(item);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!showDropdown) {
        setIsOpen(true);
      } else {
        setHighlightedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter") {
      if (showDropdown && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
        e.preventDefault();
        handleSelect(suggestions[highlightedIndex]);
      }
    }
  }

  function renderHighlight(text: string, query: string) {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    const before = text.slice(0, idx);
    const matched = text.slice(idx, idx + query.length);
    const after = text.slice(idx + query.length);
    return (
      <>
        {before}
        <span style={{ color: "#0061f2", fontWeight: 700, backgroundColor: "#e0f2fe", borderRadius: "2px", padding: "0 1px" }}>
          {matched}
        </span>
        {after}
      </>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", ...style }}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{
          width: "100%",
          height: "36px",
          border: hasError ? "1px solid #ef4444" : isFocused ? "1px solid #0061f2" : "1px solid #cbd5e1",
          borderRadius: "4px",
          padding: "0 10px",
          fontSize: "13.5px",
          boxSizing: "border-box",
          outline: "none",
          boxShadow: isFocused ? "0 0 0 2px rgba(0, 97, 242, 0.15)" : "none",
          transition: "border-color 0.15s, box-shadow 0.15s",
          ...inputStyle,
        }}
        value={value}
        onFocus={() => {
          setIsFocused(true);
          setIsOpen(true);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setHasSelectedExact(false);
          setIsOpen(true);
          setHighlightedIndex(-1);
        }}
        onKeyDown={handleKeyDown}
      />

      {errorMessage && (
        <div style={{ color: "#ef4444", fontSize: "11.5px", marginTop: "3px" }}>{errorMessage}</div>
      )}

      {showDropdown && (
        <div
          ref={listRef}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: "6px",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.08)",
            zIndex: 2500,
            maxHeight: "260px",
            overflowY: "auto",
            boxSizing: "border-box",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "6px 10px",
              background: "#f8fafc",
              borderBottom: "1px solid #e2e8f0",
              fontSize: "11px",
              fontWeight: 700,
              color: "#64748b",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              position: "sticky",
              top: 0,
              zIndex: 1,
            }}
          >
            <span>Existing Companies</span>
            <span
              style={{
                fontSize: "10px",
                background: "#e0f2fe",
                color: "#0061f2",
                padding: "1px 6px",
                borderRadius: "10px",
                fontWeight: 600,
              }}
            >
              {suggestions.length} {suggestions.length === 1 ? "match" : "matches"}
            </span>
          </div>

          {/* List items */}
          {suggestions.map((item, idx) => {
            const isHighlighted = idx === highlightedIndex;
            return (
              <div
                key={item.id || item.company_name + idx}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setHighlightedIndex(idx)}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  background: isHighlighted ? "#eff6ff" : "#ffffff",
                  borderLeft: isHighlighted ? "3px solid #0061f2" : "3px solid transparent",
                  borderBottom: "1px solid #f1f5f9",
                  transition: "background 0.1s ease, border-left 0.1s ease",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: "13.5px",
                      fontWeight: 600,
                      color: "#1e293b",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {renderHighlight(item.company_name, term)}
                  </div>
                  {(item.tax_id_number || item.area || item.district) && (
                    <div
                      style={{
                        fontSize: "11.5px",
                        color: "#64748b",
                        marginTop: "2px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.tax_id_number && (
                        <span style={{ marginRight: "8px" }}>
                          <strong>GST:</strong> {item.tax_id_number}
                        </span>
                      )}
                      {(item.area || item.district) && (
                        <span>{[item.area, item.district].filter(Boolean).join(", ")}</span>
                      )}
                    </div>
                  )}
                </div>
                {item.company_type && (
                  <span
                    style={{
                      fontSize: "10.5px",
                      fontWeight: 600,
                      padding: "2px 6px",
                      borderRadius: "4px",
                      background: "#f1f5f9",
                      color: "#475569",
                      marginLeft: "8px",
                      flexShrink: 0,
                    }}
                  >
                    {item.company_type}
                  </span>
                )}
              </div>
            );
          })}

          {suggestions.length === 0 && (
            <div
              style={{
                padding: "14px 12px",
                textAlign: "center",
                color: "#64748b",
                fontSize: "12.5px",
                background: "#ffffff",
              }}
            >
              <span>✨</span> No existing company matches &ldquo;<strong>{term}</strong>&rdquo;. You can continue typing to create a new one.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CompaniesPage({ defaultAdd, defaultFilterOpen = false }: { defaultAdd?: boolean; defaultFilterOpen?: boolean } = {}) {
  const { profile, hasPermission } = useAuth();

  const COMPANY_OPTION_GROUPS = useMemo(
    () => [
      "company.business_type",
      "company.business_category",
      "company.monthly_turnover",
      "company.potential_business_per_month",
      "company.direct_import_from_china",
      "company.monthly_import_volume",
    ],
    []
  );
  const { options: companyOptionGroups } = useOptions(COMPANY_OPTION_GROUPS);
  const BUSINESS_TYPE_OPTIONS = optionValues(companyOptionGroups, "company.business_type");
  const BUSINESS_CATEGORY_OPTIONS = optionValues(companyOptionGroups, "company.business_category");
  const MONTHLY_TURNOVER_OPTIONS = optionValues(companyOptionGroups, "company.monthly_turnover");
  const POTENTIAL_BUSINESS_OPTIONS = optionValues(companyOptionGroups, "company.potential_business_per_month");
  const DIRECT_IMPORT_OPTIONS = optionValues(companyOptionGroups, "company.direct_import_from_china");
  const IMPORT_VOLUME_OPTIONS = optionValues(companyOptionGroups, "company.monthly_import_volume");
  const canCreate = hasPermission("company.create") || hasPermission("supplier.create");
  const canUpdate = hasPermission("company.update") || hasPermission("supplier.update");
  const canDelete = hasPermission("company.delete") || hasPermission("supplier.delete");
  const canExport = hasPermission("company.export") || hasPermission("supplier.export");
  const canImport = hasPermission("company.import") || hasPermission("supplier.import");
  const canBulkAction = hasPermission("company.bulk_action") || hasPermission("supplier.bulk_action");
  const canEditGrade = hasPermission("company.grade_edit") || hasPermission("supplier.grade_edit") || canUpdate;
  const canEditPotential = hasPermission("company.potential_edit") || hasPermission("supplier.potential_edit") || canUpdate;

  const [rows, setRows] = useState<Company[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [reloadCounter, setReloadCounter] = useState(0);
  const [namesVersion, setNamesVersion] = useState(0);

  /* Live Real-time cross-tab synchronization for Suppliers */
  useLiveModule("companies", () => {
    setReloadCounter((k) => k + 1);
  });

  const [searchInput, setSearchInput] = useState("");
  const [effectiveSearch, setEffectiveSearch] = useState("");
  const srNoJump = useSrNoJump();
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);

  /* Status Tab (Active vs Inactive) */
  const [statusTab, setStatusTab] = useState<"active" | "inactive">("active");

  /* Filters - matching ERP Companies Filter Panel */
  const [filterOpen, setFilterOpen] = useState(defaultFilterOpen);
  const [filterDateRange, setFilterDateRange] = useState("");
  const [companyTypeFilter, setCompanyTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("");
  const [cityFilter, setCityFilter] = useState<string>("");
  const [districtFilter, setDistrictFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [potentialFilter, setPotentialFilter] = useState("");
  const [businessCategoryFilter, setBusinessCategoryFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [salesPersonFilter, setSalesPersonFilter] = useState("");

  // Master option lists for filter dropdowns
  const [filterStates, setFilterStates] = useState<Array<{ id: string; name: string }>>([]);
  const [filterDistricts, setFilterDistricts] = useState<Array<{ id: string; name: string; state_id?: string }>>([]);
  const [filterCities, setFilterCities] = useState<Array<{ id: string; name: string; state_id?: string; district_id?: string }>>([]);
  const [filterCategories, setFilterCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [filterSalesPersons, setFilterSalesPersons] = useState<Array<{ id: string; full_name: string; username: string }>>([]);
  const [salesPersons, setSalesPersons] = useState<Array<{ id: string; full_name: string; username: string }>>([]);
  const [filterBusinessTypes] = useState<Array<{ value: string; label: string }>>([
    { value: "", label: "All" },
    { value: "B2B", label: "B2B" },
    { value: "B2C", label: "B2C" },
    { value: "blank", label: "Blank" },
  ]);

  // Legacy/auxiliary filters
  const [countryFilter, setCountryFilter] = useState<string | null>(null);
  const [subCategoryFilter, setSubCategoryFilter] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState<string | null>(null);
  const [visitedFilter, setVisitedFilter] = useState("");

  // Load master data for filter dropdowns on mount
  useEffect(() => {
    void apiGet<Array<{ id: string; name: string }>>("/masters/states?page_size=250&status=active")
      .then((res) => {
        if (res?.data) {
          setFilterStates([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
        }
      })
      .catch(() => { });

    void apiGet<Array<{ id: string; name: string }>>("/masters/product-categories?page_size=250&status=active")
      .then((res) => {
        if (res?.data) {
          setFilterCategories([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
        }
      })
      .catch(() => { });


    void apiGet<Array<{ id: string; full_name: string; username: string }>>("/companies/sales-persons")
      .then((res) => {
        if (res?.data && res.data.length > 0) {
          setFilterSalesPersons(res.data);
          setSalesPersons(res.data);
        }
      })
      .catch(() => { });

  }, []);

  // Cascading: state -> districts and cities
  useEffect(() => {
    if (!stateFilter) {
      setFilterDistricts([]);
      setFilterCities([]);
      return;
    }
    void apiGet<Array<{ id: string; name: string }>>(
      `/masters/districts/lookup?state_id=${stateFilter}`
    )
      .then((res) => {
        if (res?.data) {
          setFilterDistricts([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
        }
      })
      .catch(() => setFilterDistricts([]));

    void apiGet<Array<{ id: string; name: string; district_id?: string }>>(
      `/masters/cities?state_id=${stateFilter}&page_size=250&status=active`
    )
      .then((res) => {
        if (res?.data) {
          setFilterCities([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
        }
      })
      .catch(() => setFilterCities([]));
  }, [stateFilter]);

  // Available cities filtered by selected district if present
  const availableCities = useMemo(() => {
    if (!districtFilter) return filterCities;
    const matchedDist = filterDistricts.find(
      (d) => d.name.toLowerCase() === districtFilter.toLowerCase() || d.id === districtFilter
    );
    if (!matchedDist) return filterCities;
    const filtered = filterCities.filter(
      (c: any) => c.district_id === matchedDist.id || c.district === districtFilter
    );
    return filtered.length > 0 ? filtered : filterCities;
  }, [filterCities, districtFilter, filterDistricts]);

  const handleResetFilters = () => {
    setFilterDateRange("");
    setCompanyTypeFilter("");
    setStatusFilter("");
    setStateFilter("");
    setCityFilter("");
    setDistrictFilter("");
    setCategoryFilter("");
    setGradeFilter("");
    setPotentialFilter("");
    setBusinessCategoryFilter("");
    setSectorFilter("");
    setSalesPersonFilter("");
    setCountryFilter(null);
    setSubCategoryFilter(null);
    setProductFilter(null);
    setVisitedFilter("");
    setCurrentPage(1);
    setReloadCounter((n) => n + 1);
  };

  const handleSearchFilters = () => {
    setCurrentPage(1);
    setReloadCounter((n) => n + 1);
  };

  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImportPageOpen, setIsImportPageOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [wizardPending, setWizardPending] = useState<{
    file: File;
    rows: SheetRow[];
    sheetColumns: string[];
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Phase 7: keyed so deleting one row/contact, or the bulk delete, never
  // disables an unrelated row's controls.
  const { isPending: isRowActionPending, guard: guardRowAction } = usePendingGuard<string>();
  const [alertPopup, setAlertPopup] = useState<{ title: string; message: string } | null>(null);
  const [drawerCompany, setDrawerCompany] = useState<Company | null>(null);
  const [pinnedCols, setPinnedCols] = useState<Record<number, "left" | "right">>(() => {
    const saved = localStorage.getItem("companies_pinned_cols");
    if (saved !== null) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return { 0: "left" };
  });

  useEffect(() => {
    localStorage.setItem("companies_pinned_cols", JSON.stringify(pinnedCols));
  }, [pinnedCols]);

  const [colLeftOffsets, setColLeftOffsets] = useState<Record<number, number>>({});
  const [colRightOffsets, setColRightOffsets] = useState<Record<number, number>>({});
  const [pinMenuOpen, setPinMenuOpen] = useState(false);
  const pinMenuRef = useRef<HTMLDivElement>(null);

  const tableRef = useRef<HTMLTableElement>(null);

  // Close popup menu when clicking outside anywhere on screen
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
        if (colIdx >= 14) {
          next[colIdx] = "right";
        } else {
          next[colIdx] = "left";
        }
      }
      return next;
    });
  }, []);

  const displayOrder = useMemo(() => {
    const allIndices = Array.from({ length: COMPANY_TABLE_COLUMNS.length }, (_, i) => i);
    const lefts = allIndices.filter((idx) => pinnedCols[idx] === "left");
    const unpinned = allIndices.filter((idx) => !pinnedCols[idx]);
    const rights = allIndices.filter((idx) => pinnedCols[idx] === "right");
    return [...lefts, ...unpinned, ...rights];
  }, [pinnedCols]);

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

      setColLeftOffsets(nextLefts);
      setColRightOffsets(nextRights);
    };

    updateOffsets();

    const ro = new ResizeObserver(() => updateOffsets());
    ro.observe(tableEl);
    return () => ro.disconnect();
  }, [pinnedCols, rows, loading, displayOrder]);

  const getFreezeStyle = useCallback((colIdx: number, isHeader = false): React.CSSProperties => {
    const dir = pinnedCols[colIdx];
    const headerTopStyle: React.CSSProperties = isHeader
      ? {
        position: "sticky",
        top: 0,
        zIndex: dir ? 30 : 15,
        backgroundColor: "#f8fafc",
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
        backgroundColor: isHeader ? "#f8fafc" : "#ffffff",
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
      backgroundColor: isHeader ? "#f8fafc" : "#ffffff",
      boxShadow: isFirstRight ? "-3px 0 6px -2px rgba(0, 0, 0, 0.15)" : "none",
      borderLeft: isFirstRight ? "2px solid #cbd5e1" : undefined,
    };
  }, [pinnedCols, colLeftOffsets, colRightOffsets, displayOrder]);





  /* Modal state */
  const [modalOpen, setModalOpen] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkCompanyId = searchParams.get("id");
  const isAddParam = searchParams.get("add") === "full" || searchParams.get("add") === "true" || searchParams.get("action") === "add";
  const activeFetchCompanyIdRef = useRef<string | null>(null);

  const handleCloseDrawer = useCallback(() => {
    setDrawerCompany(null);
    activeFetchCompanyIdRef.current = null;
    setSearchParams((prev) => {
      if (!prev.has("id")) return prev;
      const next = new URLSearchParams(prev);
      next.delete("id");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Sync browser back arrow with modal & drawer so it closes them instead of
  // navigating back to Dashboard.
  useModalHistorySync(modalOpen, () => setModalOpen(false));
  useModalHistorySync(Boolean(drawerCompany), handleCloseDrawer);
  useModalHistorySync(isImportPageOpen, () => setIsImportPageOpen(false));

  useEffect(() => {
    if (defaultAdd || isAddParam) {
      void openModal(null, "full");
    }
  }, [defaultAdd, isAddParam]);

  /* Quick Add Drawer state */
  const [quickDrawerOpen, setQuickDrawerOpen] = useState(false);
  const [quickForm, setQuickForm] = useState(EMPTY_QUICK_FORM);
  const [quickStates, setQuickStates] = useState<Array<{ id: string; name: string }>>([]);
  const [quickDistricts, setQuickDistricts] = useState<Array<{ id: string; name: string }>>([]);
  const [quickCities, setQuickCities] = useState<Array<{ id: string; name: string }>>([]);
  const [quickGstFetching, setQuickGstFetching] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickErrors, setQuickErrors] = useState<Record<string, string>>({});
  const [quickAlert, setQuickAlert] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  useModalHistorySync(quickDrawerOpen, () => setQuickDrawerOpen(false));

  const getLoggedInSalesPersonId = useCallback((): string => {
    if (!profile) return "";
    const pId = profile.id ? String(profile.id).toLowerCase() : "";
    const pUser = (profile.username || "").toLowerCase();
    const pFull = (profile.full_name || `${profile.first_name || ""} ${profile.last_name || ""}`).trim().toLowerCase();

    const match = salesPersons.find((u) => {
      const uId = String(u.id).toLowerCase();
      const uUser = (u.username || "").toLowerCase();
      const uFull = (u.full_name || "").toLowerCase();
      return (
        (pId && uId === pId) ||
        (pUser && (uUser === pUser || uFull === pUser)) ||
        (pFull && (uFull === pFull || uUser === pFull))
      );
    });
    return match?.id || profile.id || "";
  }, [salesPersons, profile]);

  const effectiveSalesPersons = useMemo(() => {
    const list = [...salesPersons];
    if (profile) {
      const pId = profile.id ? String(profile.id).toLowerCase() : "";
      const pUser = (profile.username || "").toLowerCase();
      const exists = list.some((u) => {
        const uId = String(u.id).toLowerCase();
        const uUser = (u.username || "").toLowerCase();
        return (pId && uId === pId) || (pUser && uUser === pUser);
      });
      if (!exists && profile.id) {
        list.unshift({
          id: profile.id,
          username: profile.username || "admin",
          full_name: profile.full_name || (profile.first_name ? `${profile.first_name} ${profile.last_name || ""}`.trim() : (profile.username === "admin" ? "Admin" : profile.username)),
        });
      }
    }
    return list;
  }, [salesPersons, profile]);

  const openQuickAdd = useCallback(() => {
    const defaultSpId = getLoggedInSalesPersonId();
    setQuickForm({
      ...EMPTY_QUICK_FORM,
      sales_person_id: defaultSpId,
    });
    setQuickErrors({});
    setQuickAlert(null);
    setQuickDrawerOpen(true);
  }, [getLoggedInSalesPersonId]);

  const [defaultIndiaId, setDefaultIndiaId] = useState<string>("bf5a75c1-34e6-48ab-8a52-b537806107e0");

  useEffect(() => {
    if (quickDrawerOpen || modalOpen) {
      void apiGet<Array<{ id: string; name: string }>>("/masters/states?page_size=250&status=active")
        .then((res) => {
          if (res?.data) {
            setQuickStates([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
          }
        })
        .catch(() => { });

      void apiGet<Array<{ id: string; name: string }>>("/masters/countries?search=India&page_size=5")
        .then((res) => {
          const match = res?.data?.find((c) => c.name.toLowerCase().includes("india"));
          if (match) setDefaultIndiaId(match.id);
        })
        .catch(() => { });

      void apiGet<Array<{ id: string; name: string }>>("/masters/product-categories?page_size=250&status=active")
        .then((res) => {
          if (res?.data) {
            setProductCategories([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
          }
        })
        .catch(() => { });


      void apiGet<Array<{ id: string; full_name: string; username: string }>>("/companies/sales-persons")
        .then((res) => {
          if (res?.data && res.data.length > 0) {
            setSalesPersons(res.data);
            const defaultSpId = getLoggedInSalesPersonId();
            if (defaultSpId) {
              setQuickForm((prev) => (!prev.sales_person_id ? { ...prev, sales_person_id: defaultSpId } : prev));
            }
          }
        })
        .catch(() => {
          void apiGet<any[]>("/users/all")
            .then((res) => {
              if (res?.data) {
                const mapped = res.data.map((u) => ({
                  id: u.id,
                  username: u.username,
                  full_name: u.full_name || u.username,
                }));
                setSalesPersons(mapped);
              }
            })
            .catch(() => { });
        });
    }
  }, [quickDrawerOpen, modalOpen, profile, getLoggedInSalesPersonId]);

  useEffect(() => {
    if (profile && quickDrawerOpen && !quickForm.sales_person_id) {
      const defaultSpId = getLoggedInSalesPersonId();
      if (defaultSpId) {
        setQuickForm((prev) => (!prev.sales_person_id ? { ...prev, sales_person_id: defaultSpId } : prev));
      }
    }
  }, [quickDrawerOpen, profile, getLoggedInSalesPersonId, quickForm.sales_person_id]);

  useEffect(() => {
    if (!quickForm.state_id) {
      setQuickCities([]);
      setQuickDistricts([]);
      return;
    }
    void apiGet<Array<{ id: string; name: string }>>(
      `/masters/cities?state_id=${quickForm.state_id}&page_size=200&status=active`
    )
      .then((res) => {
        if (res?.data) {
          setQuickCities([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
        }
      })
      .catch(() => setQuickCities([]));

    void apiGet<Array<{ id: string; name: string }>>(
      `/masters/districts/lookup?state_id=${quickForm.state_id}`
    )
      .then((res) => {
        if (res?.data) {
          setQuickDistricts([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
        }
      })
      .catch(() => setQuickDistricts([]));
  }, [quickForm.state_id]);

  async function handleQuickCitySelectOrCustom(cityVal: string, cityLabel: string) {
    if (!cityVal) {
      setQuickForm((p) => ({ ...p, city_id: "" }));
      return;
    }
    const existing = quickCities.find((c) => c.id === cityVal);
    if (existing) {
      setQuickForm((p) => ({ ...p, city_id: cityVal }));
      return;
    }

    // User wrote a custom city name
    if (!quickForm.state_id) {
      setQuickAlert({ type: "info", message: "Please select State before adding a city." });
      return;
    }

    try {
      const res = await apiPost<{ id: string; name: string }>("/masters/cities", {
        name: cityLabel,
        state_id: quickForm.state_id,
        country_id: defaultIndiaId,
      });
      if (res?.data?.id) {
        setQuickCities((prev) => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)));
        setQuickForm((p) => ({ ...p, city_id: res.data.id }));
        setQuickAlert({ type: "success", message: `City "${res.data.name}" added successfully.` });
      }
    } catch (err: any) {
      try {
        const fetchRes = await apiGet<Array<{ id: string; name: string }>>(
          `/masters/cities?state_id=${quickForm.state_id}&search=${encodeURIComponent(cityLabel)}&page_size=10`
        );
        const match = fetchRes.data?.find((c) => c.name.toLowerCase() === cityLabel.toLowerCase());
        if (match) {
          setQuickCities((prev) => {
            if (!prev.some((c) => c.id === match.id)) {
              return [...prev, match].sort((a, b) => a.name.localeCompare(b.name));
            }
            return prev;
          });
          setQuickForm((p) => ({ ...p, city_id: match.id }));
          return;
        }
      } catch { }
      const msg = err?.detail || err?.message || "Failed to add custom city.";
      setQuickAlert({ type: "error", message: msg });
    }
  }

  async function handleFetchGstData() {
    const raw = quickForm.tax_id_number.trim().toUpperCase();
    if (!raw) {
      setQuickErrors((prev) => ({ ...prev, tax_id_number: "Please enter GST No." }));
      return;
    }
    setQuickGstFetching(true);
    setQuickAlert(null);
    try {
      const code = raw.slice(0, 2);
      const stateName = GST_STATE_CODE_MAP[code];
      if (stateName) {
        const matched = quickStates.find(
          (s) =>
            s.name.toLowerCase() === stateName.toLowerCase() ||
            s.name.toLowerCase().includes(stateName.toLowerCase()) ||
            stateName.toLowerCase().includes(s.name.toLowerCase())
        );
        if (matched) {
          setQuickForm((prev) => ({ ...prev, state_id: matched.id, tax_id_number: raw }));
          setQuickAlert({ type: "info", message: `State auto-detected: ${matched.name}` });
          if (quickErrors.state_id) setQuickErrors((prev) => ({ ...prev, state_id: "" }));
        } else {
          try {
            const indiaRes = await apiGet<any[]>("/masters/countries?search=India&page_size=1");
            const indiaId = indiaRes.data?.[0]?.id;
            const { data: newState } = await apiPost<{ id: string; name: string }>("/masters/states", {
              name: stateName,
              country_id: indiaId,
              code,
            });
            if (newState) {
              setQuickStates((prev) => [...prev, newState].sort((a, b) => a.name.localeCompare(b.name)));
              setQuickForm((prev) => ({ ...prev, state_id: newState.id, tax_id_number: raw }));
              setQuickAlert({ type: "info", message: `State auto-detected: ${newState.name}` });
              if (quickErrors.state_id) setQuickErrors((prev) => ({ ...prev, state_id: "" }));
            }
          } catch {
            setQuickAlert({ type: "info", message: `GST State Code: ${stateName}` });
          }
        }
      } else {
        setQuickAlert({ type: "info", message: "GST recorded. Please select State." });
      }
    } finally {
      setQuickGstFetching(false);
    }
  }

  function handleCopyPrimary() {
    const direct = quickForm.contact_calling_number.trim();
    if (direct) {
      setQuickForm((prev) => ({ ...prev, contact_whatsapp_number: direct }));
    }
  }

  async function handleQuickSave(exitAfterSave: boolean) {
    const errors: Record<string, string> = {};
    if (!quickForm.company_name.trim()) {
      errors.company_name = "Company Name is required.";
    }
    if (!quickForm.tax_id_number.trim()) {
      errors.tax_id_number = "GST No Of Company is required.";
    }
    if (!quickForm.state_id) {
      errors.state_id = "State is required.";
    }

    if (Object.keys(errors).length > 0) {
      setQuickErrors(errors);
      return;
    }

    setQuickSaving(true);
    setQuickErrors({});
    setQuickAlert(null);

    try {
      const payload: Record<string, any> = {
        company_name: quickForm.company_name.trim(),
        company_type: quickForm.company_type || null,
        tax_id_number: quickForm.tax_id_number.trim().toUpperCase() || null,
        area: quickForm.area.trim() || null,
        state_id: quickForm.state_id || null,
        district: quickForm.district.trim() || null,
        city_id: quickForm.city_id || null,
        contact_salutation: quickForm.contact_salutation || null,
        contact_full_name: quickForm.contact_full_name.trim() || null,
        contact_designation: quickForm.contact_designation.trim() || null,
        contact_indiamart_number: quickForm.contact_indiamart_number.trim() || null,
        contact_calling_number: quickForm.contact_calling_number.trim() || null,
        contact_whatsapp_number: quickForm.contact_whatsapp_number.trim() || null,
        primary_website: quickForm.primary_website.trim() || null,
        sales_person_id: quickForm.sales_person_id || null,
      };

      const { data } = await apiPost<Company>("/companies", payload);

      setReloadCounter((c) => c + 1);

      if (exitAfterSave) {
        setQuickDrawerOpen(false);
        setAlertPopup({
          title: "Company Added",
          message: `Company "${data.company_name}" created successfully.`,
        });
      } else {
        setQuickAlert({
          type: "success",
          message: `Company "${data.company_name}" created successfully. Add next company below:`,
        });
        setQuickForm((prev) => ({
          ...EMPTY_QUICK_FORM,
          sales_person_id: prev.sales_person_id,
        }));
        setTimeout(() => {
          const el = document.getElementById("quick_company_name");
          if (el) el.focus();
        }, 60);
      }
    } catch (err: any) {
      const detail = err?.detail || err?.message || "Failed to create company.";
      setQuickAlert({ type: "error", message: detail });
    } finally {
      setQuickSaving(false);
    }
  }

  // Universal search deep-link: `?id=` opens that supplier's detail drawer
  // directly, so clicking a Suppliers result in the topbar search lands on
  // the actual record instead of just the bare list.
  useEffect(() => {
    if (!deepLinkCompanyId) return;
    if (activeFetchCompanyIdRef.current === deepLinkCompanyId) return;
    const targetId = deepLinkCompanyId;
    activeFetchCompanyIdRef.current = targetId;

    // Immediately replace URL in history so history.back() never returns to ?id=
    setSearchParams((prev) => {
      if (!prev.has("id")) return prev;
      const next = new URLSearchParams(prev);
      next.delete("id");
      return next;
    }, { replace: true });

    (async () => {
      try {
        const { data } = await apiGet<Company>(`/companies/${targetId}`);
        if (activeFetchCompanyIdRef.current === targetId) {
          setDrawerCompany(data);
        }
      } catch (err) {
        console.error("Failed to load supplier detail for deep-link:", err);
      }
    })();
  }, [deepLinkCompanyId, setSearchParams]);
  const [modalMode, setModalMode] = useState<"quick" | "full">("full");
  const [currentCompanyId, setCurrentCompanyId] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({
    ...EMPTY_SUPPLIER_FORM,
    sales_person_id: getLoggedInSalesPersonId(),
  }));
  const [formDistricts, setFormDistricts] = useState<Array<{ id: string; name: string }>>([]);
  const [formCities, setFormCities] = useState<Array<{ id: string; name: string }>>([]);
  const [productCategories, setProductCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [gstFetching, setGstFetching] = useState(false);
  const [formAlert, setFormAlert] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  useEffect(() => {
    if (profile && modalOpen && !currentCompanyId && !form.sales_person_id) {
      const defaultSpId = getLoggedInSalesPersonId();
      if (defaultSpId) {
        setForm((prev) => (!prev.sales_person_id ? { ...prev, sales_person_id: defaultSpId } : prev));
      }
    }
  }, [modalOpen, currentCompanyId, profile, getLoggedInSalesPersonId, form.sales_person_id]);

  // Full Form Cascading: When form.state_id changes -> Fetch districts for that state
  useEffect(() => {
    if (!form.state_id) {
      setFormDistricts([]);
      setFormCities([]);
      return;
    }
    void apiGet<Array<{ id: string; name: string }>>(
      `/masters/districts/lookup?state_id=${form.state_id}`
    )
      .then((res) => {
        if (res?.data) {
          const sorted = [...res.data].sort((a, b) => a.name.localeCompare(b.name));
          setFormDistricts(sorted);
          if (form.district && !form.district_id) {
            const m = sorted.find(
              (d) => d.name.toLowerCase() === form.district.toLowerCase() || d.id === form.district
            );
            if (m) {
              setForm((p) => ({ ...p, district_id: m.id, district: m.name }));
            }
          }
        } else {
          setFormDistricts([]);
        }
      })
      .catch(() => setFormDistricts([]));
  }, [form.state_id]);

  // Full Form Cascading: When form.district_id changes -> Fetch cities for that district
  useEffect(() => {
    const distId = form.district_id;
    if (!distId || !form.state_id) {
      setFormCities([]);
      return;
    }
    void apiGet<Array<{ id: string; name: string }>>(
      `/masters/cities/lookup?district_id=${distId}&state_id=${form.state_id}`
    )
      .then((res) => {
        if (res?.data) {
          setFormCities([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
        } else {
          setFormCities([]);
        }
      })
      .catch(() => setFormCities([]));
  }, [form.district_id, form.state_id]);

  function handleCopyPrimaryFull() {
    const direct = (form.contact_calling_number || "").trim();
    if (direct) {
      setForm((prev) => ({ ...prev, contact_whatsapp_number: direct }));
    }
  }

  async function handleFullFormGstFetch() {
    const raw = (form.tax_id_number || "").trim().toUpperCase();
    if (!raw) {
      setValidationErrors((prev) => ({ ...prev, tax_id_number: "Please enter GST No." }));
      return;
    }
    setGstFetching(true);
    setFormAlert(null);
    try {
      const code = raw.slice(0, 2);
      const stateName = GST_STATE_CODE_MAP[code];
      if (stateName) {
        const matched = quickStates.find(
          (s) =>
            s.name.toLowerCase() === stateName.toLowerCase() ||
            s.name.toLowerCase().includes(stateName.toLowerCase()) ||
            stateName.toLowerCase().includes(s.name.toLowerCase())
        );
        if (matched) {
          setForm((prev) => ({
            ...prev,
            state_id: matched.id,
            district_id: "",
            district: "",
            city_id: "",
            tax_id_number: raw,
          }));
          setFormDistricts([]);
          setFormCities([]);
          setFormAlert({ type: "info", message: `State auto-detected: ${matched.name}. Please select District.` });
          if (validationErrors.tax_id_number) setValidationErrors((prev) => ({ ...prev, tax_id_number: "" }));
          if (validationErrors.state_id) setValidationErrors((prev) => ({ ...prev, state_id: "" }));
        } else {
          setFormAlert({ type: "info", message: `GST State Code: ${stateName}` });
        }
      } else {
        setFormAlert({ type: "info", message: "GST recorded. Please select State." });
      }
    } finally {
      setGstFetching(false);
    }
  }

  function handleAddSocialMedia() {
    setForm((prev) => ({
      ...prev,
      social_media: [...(prev.social_media || []), { platform: "", url: "" }],
    }));
  }

  function handleUpdateSocialMedia(index: number, key: "platform" | "url", value: string) {
    setForm((prev) => {
      const list = [...(prev.social_media || [])];
      if (!list[index]) list[index] = { platform: "", url: "" };
      list[index] = { ...list[index], [key]: value };
      return { ...prev, social_media: list };
    });
  }

  function handleRemoveSocialMedia(index: number) {
    setForm((prev) => {
      const list = [...(prev.social_media || [])];
      list.splice(index, 1);
      if (list.length === 0) list.push({ platform: "", url: "" });
      return { ...prev, social_media: list };
    });
  }

  async function handleSaveFullCompany(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSaving(true);
    setError(null);
    setFormAlert(null);
    setValidationErrors({});

    const errors: Record<string, string> = {};
    if (!form.company_name.trim()) errors.company_name = "Company Name is required.";
    if (!form.tax_id_number.trim()) errors.tax_id_number = "GST No is required.";
    if (!form.state_id) errors.state_id = "State is required.";
    if (!form.city_id) errors.city_id = "City is required.";

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      setError("Please fill all required fields marked with *.");
      setSaving(false);
      return;
    }

    try {
      const emailList = form.email.trim()
        ? [form.email.trim()]
        : (form.emails && form.emails.length > 0 ? form.emails : []);

      const cleanSocialMedia = (form.social_media || []).filter(
        (sm) => sm.platform.trim() || sm.url.trim()
      );

      const categoryIds = form.category_id
        ? [form.category_id]
        : (formCategoryIds && formCategoryIds.length > 0 ? formCategoryIds : []);

      const payload: Record<string, any> = {
        company_name: form.company_name.trim(),
        contact_salutation: form.contact_salutation || null,
        contact_full_name: form.contact_full_name.trim() || null,
        contact_designation: form.contact_designation.trim() || null,
        tax_id_number: form.tax_id_number.trim().toUpperCase() || null,
        contact_calling_number: form.contact_calling_number.trim() || null,
        contact_indiamart_number: form.contact_indiamart_number.trim() || null,
        contact_whatsapp_number: form.contact_whatsapp_number.trim() || null,
        primary_website: form.primary_website.trim() || null,
        emails: emailList,
        secondary_website: form.secondary_website.trim() || null,
        address: form.address.trim() || null,
        area: form.area.trim() || null,
        state_id: form.state_id || null,
        district: form.district.trim() || null,
        city_id: form.city_id || null,
        pincode: form.pincode.trim() || null,
        current_status: form.current_status || null,
        company_type: form.company_type || null,
        category_ids: categoryIds,
        company_grade: form.company_grade || null,
        potential: form.potential || null,
        company_category: form.company_category || null,
        product_manufacture_or_supply: form.product_manufacture_or_supply.trim() || null,
        machines_buying_from: form.machines_buying_from.trim() || null,
        spares_buying_from: form.spares_buying_from.trim() || null,
        products_interested: form.products_interested.trim() || null,
        gst_registration_date: form.gst_registration_date.trim() || null,
        age_of_company: form.age_of_company.trim() || null,
        ...(() => {
          const cleared = clearInapplicableCompanyFields(form);
          return {
            monthly_turnover: cleared.monthly_turnover || null,
            potential_business_per_month: cleared.potential_business_per_month || null,
            direct_import_from_china: cleared.direct_import_from_china || null,
            monthly_import_volume: cleared.monthly_import_volume || null,
            products_needed_for_imports: cleared.products_needed_for_imports.trim() || null,
          };
        })(),
        social_media: cleanSocialMedia.length > 0 ? cleanSocialMedia : null,
        overall_remarks: form.overall_remarks.trim() || null,
        sales_person_id: form.sales_person_id || null,
        country_id: defaultIndiaId,
      };

      const res = currentCompanyId
        ? await apiPatch<Company>(`/companies/${currentCompanyId}`, payload)
        : await apiPost<Company>("/companies", payload);

      const saved = res.data;
      setReloadCounter((c) => c + 1);
      closeModal();
      setAlertPopup({
        title: currentCompanyId ? "Company Updated" : "Company Created",
        message: `Company "${saved.company_name}" saved successfully.`,
      });
    } catch (err: any) {
      const msg = err?.detail || err?.message || "Failed to save company.";
      setError(msg);
      setFormAlert({ type: "error", message: msg });
    } finally {
      setSaving(false);
    }
  }
  const [formCountryId, setFormCountryId] = useState<string | null>(null);
  const [formStateId, setFormStateId] = useState<string | null>(null);
  const [formCategoryIds, setFormCategoryIds] = useState<string[]>([]);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // phone helpers removed

  function focusAndScrollToField(fieldId: string) {
    setTimeout(() => {
      const el = document.getElementById(fieldId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        if (typeof (el as HTMLElement).focus === "function") {
          (el as HTMLElement).focus();
        }
        if (el.tagName !== "INPUT" && el.tagName !== "SELECT" && el.tagName !== "TEXTAREA") {
          const inner = el.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea");
          if (inner) inner.focus();
        }
      }
    }, 60);
  }

  /* Tabs & Contacts State */
  const [editTab, setEditTab] = useState<"profile" | "contacts">("profile");
  const [contacts, setContacts] = useState<CompanyContact[]>([]);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [contactForm, setContactForm] = useState(EMPTY_CONTACT_FORM);
  const [contactCountryId, setContactCountryId] = useState<string | null>(null);
  const [contactPhoneCode, setContactPhoneCode] = useState<string>("");
  const [contactSameCallingWhatsapp, setContactSameCallingWhatsapp] = useState(false);
  const [contactSameCallingWechat, setContactSameCallingWechat] = useState(false);
  const [drawerError, setDrawerError] = useState<unknown>(null);
  const [contactSubmitting, setContactSubmitting] = useState(false);

  useEffect(() => {
    if (!contactCountryId) {
      setContactPhoneCode("");
      return;
    }
    let cancelled = false;
    apiGet<{ phone_code?: string | null }>(`/masters/countries/${contactCountryId}`)
      .then(({ data }) => {
        if (!cancelled) {
          const code = data.phone_code ? (data.phone_code.startsWith("+") ? data.phone_code : `+${data.phone_code}`) : "";
          setContactPhoneCode(code);
        }
      })
      .catch(() => {
        if (!cancelled) setContactPhoneCode("");
      });
    return () => {
      cancelled = true;
    };
  }, [contactCountryId]);

  const setField = (id: keyof typeof EMPTY_SUPPLIER_FORM, value: string) => {
    const rawFields = new Set([
      "visited_factory_office",
      "is_active",
      "current_status",
      "potential",
      "company_grade",
      "primary_website",
      "secondary_website",
      "visit_video_url",
      "visit_media_input",
      "email",
      "tax_id_number",
      "state_id",
      "district_id",
      "city_id",
      "pincode",
      "contact_salutation",
      "category_id",
      "sales_person_id",
      "gst_registration_date",
    ]);
    const formatted = id === "tax_id_number"
      ? value.toUpperCase()
      : rawFields.has(id as string) ? value : autoTitleCase(value, id as string);
    setForm((prev) => ({ ...prev, [id]: formatted }));
    if (validationErrors[id as string]) {
      setValidationErrors((prev) => ({ ...prev, [id as string]: "" }));
    }
  };

  /* --- Bounded name resolver with fast batch lookup and global memory cache --- */
  const resolver = useMemo(() => {
    const loadedBatchEndpoints = new Set<string>();

    const fetchNamesBatch = async (
      apiBase: string,
      ids: string[],
      labelFn?: (d: Record<string, unknown>) => string
    ): Promise<[string, string][]> => {
      const results: [string, string][] = [];

      // 1. Bulk-load the master endpoint on first encounter (1 single request for up to 250 records)
      if (!loadedBatchEndpoints.has(apiBase)) {
        loadedBatchEndpoints.add(apiBase);
        try {
          let data: Record<string, unknown>[] | undefined;
          try {
            const lookupRes = await apiGet<Record<string, unknown>[]>(`${apiBase}/lookup`);
            if (Array.isArray(lookupRes?.data)) {
              data = lookupRes.data;
            }
          } catch {
            /* fall back to standard list endpoint */
          }

          if (!data) {
            const listRes = await apiGet<Record<string, unknown>[]>(
              `${apiBase}${toQueryString({ page: 1, page_size: 250, sort_order: "asc" })}`
            );
            if (Array.isArray(listRes?.data)) {
              data = listRes.data;
            }
          }

          if (Array.isArray(data)) {
            for (const item of data) {
              const itemId = String(item.id || "");
              const itemLabel = labelFn ? labelFn(item) : String(item.name || item.code || "");
              if (itemId && itemLabel) {
                results.push([itemId, itemLabel]);
              }
            }
          }
        } catch {
          // If bulk load fails, fallback to individual resolution
        }
      }

      // 2. Resolve any specific requested ID not present in the batch load
      const foundMap = new Map(results);
      const missingIds = ids.filter((id) => !foundMap.has(id));

      if (missingIds.length > 0) {
        const individual = await Promise.all(
          missingIds.map(async (id): Promise<[string, string | null]> => {
            try {
              const { data } = await apiGet<Record<string, unknown>>(`${apiBase}/${id}`);
              return [id, labelFn ? labelFn(data) : (data.name as string)];
            } catch {
              return [id, null];
            }
          })
        );
        for (const [id, label] of individual) {
          if (label) results.push([id, label]);
        }
      }

      return results;
    };

    return createNameResolver({
      countries: (ids) => fetchNamesBatch("/masters/countries", ids),
      states: (ids) => fetchNamesBatch("/masters/states", ids),
      cities: (ids) => fetchNamesBatch("/masters/cities", ids),
      categories: (ids) => fetchNamesBatch("/masters/product-categories", ids),
      subCategories: (ids) => fetchNamesBatch("/masters/product-sub-categories", ids),
      products: (ids) =>
        fetchNamesBatch("/masters/products", ids, (d) => d.product_name as string),
    });
  }, []);

  /* --- Type-ahead fetchers & instant Geo Cache --- */
  const geoDropdownCache = useRef<Record<string, DropdownOption[]>>({});

  useEffect(() => {
    if (formCountryId) {
      const cacheKey = `/masters/states:{"country_id":"${formCountryId}"}`;
      if (!geoDropdownCache.current[cacheKey]) {
        void apiGet<{ id: string; name: string }[]>(
          `/masters/states${toQueryString({ country_id: formCountryId, page: 1, page_size: 50, sort_order: "asc", status: "active" })}`
        )
          .then((res) => {
            if (res?.data) {
              geoDropdownCache.current[cacheKey] = res.data.map((d) => ({ value: d.id, label: d.name }));
            }
          })
          .catch(() => { });
      }
    }
  }, [formCountryId]);

  useEffect(() => {
    if (formStateId) {
      const cacheKey = `/masters/cities:{"state_id":"${formStateId}"}`;
      if (!geoDropdownCache.current[cacheKey]) {
        void apiGet<{ id: string; name: string }[]>(
          `/masters/cities${toQueryString({ state_id: formStateId, page: 1, page_size: 50, sort_order: "asc", status: "active" })}`
        )
          .then((res) => {
            if (res?.data) {
              geoDropdownCache.current[cacheKey] = res.data.map((d) => ({ value: d.id, label: d.name }));
            }
          })
          .catch(() => { });
      }
    }
  }, [formStateId]);

  const searchFetcher = useCallback(
    (apiBase: string, extraParams?: () => Record<string, string>) =>
      async (term: string, signal: AbortSignal): Promise<DropdownOption[]> => {
        const extra = extraParams ? extraParams() : {};
        const cacheKey = `${apiBase}:${JSON.stringify(extra)}`;

        if (!term.trim() && geoDropdownCache.current[cacheKey]) {
          return geoDropdownCache.current[cacheKey];
        }

        const { data } = await apiGet<{ id: string; name: string }[]>(
          apiBase +
          toQueryString({
            search: term,
            page: 1,
            page_size: 250,
            sort_order: "asc",
            status: "active",
            ...extra,
          }),
          { signal }
        );
        const mapped = data.map((d) => ({ value: d.id, label: d.name }));
        if (!term.trim()) {
          geoDropdownCache.current[cacheKey] = mapped;
        }
        return mapped;
      },
    []
  );

  // companyNameFetcher removed


  const fetchNameLabel = useCallback(
    (apiBase: string) => async (id: string) => {
      try {
        const { data } = await apiGet<{ name?: string; product_name?: string }>(`${apiBase}/${id}`);
        return data?.name || data?.product_name || "";
      } catch {
        return "";
      }
    },
    []
  );

  const [sortColIndex, setSortColIndex] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleHeaderSort = useCallback((colIdx: number) => {
    setSortColIndex((prevCol) => {
      if (prevCol === colIdx) {
        if (sortDirection === "asc") {
          setSortDirection("desc");
          return colIdx;
        } else {
          setSortDirection("asc");
          return null;
        }
      } else {
        setSortDirection("asc");
        return colIdx;
      }
    });
  }, [sortDirection]);

  const sortedRows = useMemo(() => {
    if (sortColIndex === null) return rows;
    const list = [...rows];
    list.sort((a, b) => {
      let valA: string | number = "";
      let valB: string | number = "";
      switch (sortColIndex) {
        case 1: { // Sr. No.
          const tA = (a as any).created_at ? new Date((a as any).created_at).getTime() : 0;
          const tB = (b as any).created_at ? new Date((b as any).created_at).getTime() : 0;
          return sortDirection === "asc" ? tA - tB : tB - tA;
        }
        case 2: // Company
          valA = a.company_name || "";
          valB = b.company_name || "";
          break;
        case 3: // Name / Designation
          valA = a.contact_full_name || (a.contacts && a.contacts[0]?.person_name) || "";
          valB = b.contact_full_name || (b.contacts && b.contacts[0]?.person_name) || "";
          break;
        case 4: // Contact (Direct)
          valA = a.contact_calling_number || (a.contacts && a.contacts[0]?.calling_number) || "";
          valB = b.contact_calling_number || (b.contacts && b.contacts[0]?.calling_number) || "";
          break;
        case 5: // Area / City
          valA = `${a.area || ""} ${resolver.get("cities", a.city_id) || ""}`;
          valB = `${b.area || ""} ${resolver.get("cities", b.city_id) || ""}`;
          break;
        case 6: // Dist. / State
          valA = `${a.district || ""} ${resolver.get("states", a.state_id) || ""}`;
          valB = `${b.district || ""} ${resolver.get("states", b.state_id) || ""}`;
          break;
        case 7: // Curr. Status
          valA = a.current_status || "";
          valB = b.current_status || "";
          break;
        case 8: // Bus. Type
          valA = a.company_type || "";
          valB = b.company_type || "";
          break;
        case 9: // Grade
          valA = a.company_grade || "";
          valB = b.company_grade || "";
          break;
        case 10: // Potential
          valA = a.potential || "";
          valB = b.potential || "";
          break;
        case 11: // Mac. Buying From
          valA = a.machines_buying_from || "";
          valB = b.machines_buying_from || "";
          break;
        case 12: // P1 To Buy From Us
          valA = a.products_interested || a.product_manufacture_or_supply || "";
          valB = b.products_interested || b.product_manufacture_or_supply || "";
          break;
        case 13: { // Sales Per. / Added On
          const tA = (a as any).created_at ? new Date((a as any).created_at).getTime() : 0;
          const tB = (b as any).created_at ? new Date((b as any).created_at).getTime() : 0;
          return sortDirection === "asc" ? tA - tB : tB - tA;
        }
        default:
          return 0;
      }
      const strA = String(valA).trim().toLowerCase();
      const strB = String(valB).trim().toLowerCase();
      return sortDirection === "asc"
        ? strA.localeCompare(strB, undefined, { numeric: true, sensitivity: "base" })
        : strB.localeCompare(strA, undefined, { numeric: true, sensitivity: "base" });
    });
    return list;
  }, [rows, sortColIndex, sortDirection, resolver, namesVersion]);

  /* --- Search debounce with Sr. No. jump --- */
  useEffect(() => {
    const timer = setTimeout(() => {
      const raw = searchInput.trim();
      if (raw && isSrNoQuery(raw)) {
        const srNo = parseInt(raw, 10);
        if (srNo >= 1) {
          setCurrentPage(Math.ceil(srNo / pageSize));
          setEffectiveSearch("");
          srNoJump.request(srNo);
          return;
        }
      }
      srNoJump.clear();
      setCurrentPage(1);
      setEffectiveSearch(raw);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, pageSize]);

  /* --- List load --- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { created_after, created_before } = parseDateRange(filterDateRange);
      const params = {
        page: currentPage,
        page_size: pageSize,
        sort_order: "asc",
        search: effectiveSearch,
        is_active: statusTab === "active" ? "true" : "false",
        country_id: countryFilter || "",
        state_id: stateFilter || "",
        city_id: cityFilter || "",
        district: districtFilter || "",
        company_type: companyTypeFilter || "",
        company_grade: gradeFilter || "",
        current_status: statusFilter || "",
        potential: potentialFilter || "",
        company_category: businessCategoryFilter || "",
        sector: sectorFilter || "",
        sales_person_id: salesPersonFilter || "",
        visited_factory_office: visitedFilter || "",
        category_id: categoryFilter || "",
        sub_category_id: subCategoryFilter || "",
        product_id: productFilter || "",
        created_after: created_after || "",
        created_before: created_before || "",
      };
      try {
        const { data, meta } = await apiGet<Company[]>("/companies" + toQueryString(params));
        if (cancelled) return;
        const items = data || [];
        // Immediately render rows to the user without delay
        setRows(items);
        setPagination(meta?.pagination);
        setError(null);
        setLoading(false);

        if (items.length) {
          // Resolve every related name concurrently in background
          void Promise.all([
            resolver.resolve("countries", items.map((s) => s.country_id)),
            resolver.resolve("states", items.map((s) => s.state_id)),
            resolver.resolve("cities", items.map((s) => s.city_id)),
            resolver.resolve("categories", items.flatMap((s) => s.category_ids || [])),
            resolver.resolve("subCategories", items.flatMap((s) => s.sub_category_ids || [])),
            resolver.resolve("products", items.flatMap((s) => s.product_ids || [])),
          ]).then(() => {
            if (!cancelled) {
              setNamesVersion((n) => n + 1);
            }
          });
        }
      } catch (err) {
        if (cancelled) return;
        setRows([]);
        setError(err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    statusTab,
    currentPage,
    pageSize,
    effectiveSearch,
    countryFilter,
    stateFilter,
    cityFilter,
    districtFilter,
    companyTypeFilter,
    gradeFilter,
    statusFilter,
    potentialFilter,
    businessCategoryFilter,
    sectorFilter,
    salesPersonFilter,
    visitedFilter,
    categoryFilter,
    subCategoryFilter,
    productFilter,
    filterDateRange,
    reloadCounter,
    resolver,
  ]);

  useEffect(() => {
    if (!loading) srNoJump.applyTo(tableBodyRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, rows]);

  const reload = () => setReloadCounter((n) => n + 1);

  /* --- bfcache restoration handler --- */
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        // Page was restored from Back-Forward Cache (bfcache).
        // Trigger a fresh list reload so table data is refreshed and loading skeleton is cleared.
        reload();
      }
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  /**
   * Live sync (Phase 9): Suppliers list receives real-time updates from
   * other users without a manual refresh, using the same useLiveList
   * pattern as Buyers.tsx. Skips live-patching when any filter/search is
   * active or when not on page 1 -- the same conservative correctness
   * decision Buyers already makes (server-side filter logic would need to
   * be duplicated here to decide whether a live-patched record still
   * belongs in the current filtered view, so we don't attempt it;
   * unfiltered page 1 is the safe case).
   */
  const hasActiveCompanyFilterOrSearch =
    Boolean(effectiveSearch) ||
    Boolean(filterDateRange) ||
    Boolean(companyTypeFilter) ||
    Boolean(statusFilter) ||
    Boolean(stateFilter) ||
    Boolean(cityFilter) ||
    Boolean(districtFilter) ||
    Boolean(categoryFilter) ||
    Boolean(gradeFilter) ||
    Boolean(potentialFilter) ||
    Boolean(businessCategoryFilter) ||
    Boolean(sectorFilter) ||
    Boolean(salesPersonFilter) ||
    Boolean(countryFilter) ||
    Boolean(subCategoryFilter) ||
    Boolean(productFilter) ||
    Boolean(visitedFilter);

  useLiveList<Company>({
    moduleName: "suppliers",
    setRecords: setRows,
    shouldSkip: () => hasActiveCompanyFilterOrSearch || currentPage !== 1,
    onApplied: (result) => {
      if (result.action === "created" || result.action === "deleted") {
        setPagination((prev) =>
          prev
            ? {
              ...prev,
              total_records:
                result.action === "created"
                  ? (prev.total_records || 0) + 1
                  : Math.max(0, (prev.total_records || 1) - 1),
            }
            : prev
        );
      }
    },
  });

  /**
   * Reconnect sync (Phase 9): if the WebSocket dropped while we were
   * viewing this page, re-run the REST fetch once when it comes back to
   * pick up any changes missed during the disconnect window. Mirrors the
   * identical pattern in Buyers.tsx.
   */
  const liveConnectionStatus = useLiveConnectionStatus();
  const hasConnectedBeforeRef = useRef(false);
  const wasDisconnectedRef = useRef(false);
  useEffect(() => {
    if (liveConnectionStatus === "connected") {
      if (hasConnectedBeforeRef.current && wasDisconnectedRef.current) {
        reload();
      }
      hasConnectedBeforeRef.current = true;
      wasDisconnectedRef.current = false;
    } else if (hasConnectedBeforeRef.current) {
      wasDisconnectedRef.current = true;
    }
  }, [liveConnectionStatus]);


  function chipList(
    ids: string[] | undefined,
    tableKey: string,
    modalTitle = "Selected Items",
    icon = "🏷️"
  ) {
    if (!ids || !ids.length) return <span className="muted">—</span>;
    const names = ids.map((id) => resolver.get(tableKey, id) || id);
    const hasUnresolved = names.some((n) => !n || n === "…");
    if (hasUnresolved) {
      void resolver.resolve(tableKey, ids).then(() => setNamesVersion((n) => n + 1));
    }
    const cleanNames = names.filter(Boolean);

    return (
      <ItemPopoverCell
        items={cleanNames}
        icon={icon}
        itemIcon={icon}
        title={`📍 ${modalTitle}`}
        badgeIcon="📍"
      />
    );
  }

  /* --- Modal --- */
  async function openModal(supplier: Company | null, mode: "quick" | "full" = "full") {
    if (mode === "quick" && !supplier) {
      openQuickAdd();
      return;
    }
    setCurrentCompanyId(supplier ? supplier.id : null);
    setModalMode(mode);
    setEditTab("profile");
    setError(null);
    setAlertPopup(null);
    setContactFormOpen(false);
    setValidationErrors({});

    if (supplier) {
      setForm({
        company_name: supplier.company_name || "",
        contact_salutation: supplier.contact_salutation || "Mr",
        contact_full_name: supplier.contact_full_name || "",
        contact_designation: supplier.contact_designation || "",
        tax_id_number: supplier.tax_id_number || "",
        contact_calling_number: supplier.contact_calling_number || "",
        contact_indiamart_number: supplier.contact_indiamart_number || "",
        contact_whatsapp_number: supplier.contact_whatsapp_number || "",
        primary_website: supplier.primary_website || "",
        email: (supplier.emails && supplier.emails[0]) || "",
        emails: supplier.emails || [],
        secondary_website: supplier.secondary_website || "",
        address: supplier.address || "",
        area: supplier.area || "",
        state_id: supplier.state_id || "",
        district_id: supplier.district_id || "",
        district: supplier.district || "",
        city_id: supplier.city_id || "",
        pincode: supplier.pincode || "",
        current_status: supplier.current_status || "",
        company_type: supplier.company_type || "",
        category_id: (supplier.category_ids && supplier.category_ids[0]) || "",
        company_grade: supplier.company_grade || "",
        potential: supplier.potential || "",
        company_category: supplier.company_category || "",
        product_manufacture_or_supply: supplier.product_manufacture_or_supply || "",
        machines_buying_from: supplier.machines_buying_from || "",
        spares_buying_from: supplier.spares_buying_from || "",
        products_interested: supplier.products_interested || "",
        gst_registration_date: supplier.gst_registration_date || "",
        age_of_company: supplier.age_of_company || "",
        monthly_turnover: supplier.monthly_turnover || "",
        potential_business_per_month: supplier.potential_business_per_month || "",
        direct_import_from_china: supplier.direct_import_from_china || "",
        monthly_import_volume: supplier.monthly_import_volume || "",
        products_needed_for_imports: supplier.products_needed_for_imports || "",
        social_media: supplier.social_media && supplier.social_media.length > 0 ? supplier.social_media : [{ platform: "", url: "" }],
        overall_remarks: supplier.overall_remarks || "",
        sales_person_id: supplier.sales_person_id || "",
        brand_description: supplier.brand_description || "",
        town: supplier.town || "",
        potential_reason: supplier.potential_reason || "",
        secondary_products_description: supplier.secondary_products_description || "",
        visited_factory_office: String(supplier.visited_factory_office),
        visit_remarks: supplier.visit_remarks || "",
        visit_media_input: (supplier.visit_media || []).filter((u) => !u.startsWith("http") || u.match(/\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i) || u.includes("/storage/v1/object/public/")).join(", "),
        visit_video_url: (supplier.visit_media || []).find((u) => u.startsWith("http") && !u.match(/\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i) && !u.includes("/storage/v1/object/public/")) || "",
        contact_wechat_number: supplier.contact_wechat_number || "",
        is_active: String(supplier.is_active),
      });
      setFormCountryId(supplier.country_id || null);
      setFormStateId(supplier.state_id || null);
      setFormCategoryIds(supplier.category_ids || []);
      setContacts(supplier.contacts || []);
    } else {
      const defaultSpId = getLoggedInSalesPersonId();
      setForm({
        ...EMPTY_SUPPLIER_FORM,
        sales_person_id: defaultSpId,
      });
      setFormStateId(null);
      setFormDistricts([]);
      setFormCities([]);
      setFormCategoryIds([]);
      setContacts([]);
      setFormCountryId(defaultIndiaId || null);
      setFormAlert(null);
    }

    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setCurrentCompanyId(null);
    setError(null);
    setAlertPopup(null);
    setValidationErrors({});
  }

  async function refreshContacts() {
    if (!currentCompanyId) return;
    const { data } = await apiGet<CompanyContact[]>(`/companies/${currentCompanyId}/contacts`);
    setContacts(data);
  }

  function openContactForm(contact: CompanyContact | null) {
    setDrawerError(null);
    setContactSubmitting(false);
    setContactForm(
      contact
        ? {
          id: contact.id,
          salutation: contact.salutation || "",
          person_name: contact.person_name,
          designation: contact.designation || "",
          handling_territory: contact.handling_territory || "",
          birth_date: contact.birth_date || "",
          anniversary_date: contact.anniversary_date || "",
          calling_number: contact.calling_number || "",
          whatsapp_number: contact.whatsapp_number || "",
          wechat_number: contact.wechat_number || "",
          email: contact.email || "",
        }
        : EMPTY_CONTACT_FORM
    );
    setContactCountryId(contact?.country_id || formCountryId || defaultIndiaId || null);
    setContactSameCallingWhatsapp(false);
    setContactSameCallingWechat(false);
    setContactFormOpen(true);
  }

  async function handleContactSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDrawerError(null);

    if (!currentCompanyId) return;

    if (!contactForm.person_name.trim()) {
      setDrawerError("Person Name is required. Please enter Full Name.");
      return;
    }

    const payload = {
      salutation: contactForm.salutation || null,
      person_name: contactForm.person_name.trim(),
      designation: contactForm.designation.trim() || null,
      handling_territory: contactForm.handling_territory.trim() || null,
      country_id: contactCountryId || null,
      calling_number: contactForm.calling_number.trim() || null,
      whatsapp_number: contactForm.whatsapp_number.trim() || null,
      wechat_number: contactForm.wechat_number.trim() || null,
      email: contactForm.email.trim() || null,
      birth_date: contactForm.birth_date || null,
      anniversary_date: contactForm.anniversary_date || null,
    };

    setContactSubmitting(true);
    try {
      if (contactForm.id) {
        await apiPatch(`/companies/${currentCompanyId}/contacts/${contactForm.id}`, payload);
      } else {
        await apiPost(`/companies/${currentCompanyId}/contacts`, payload);
      }
      setContactFormOpen(false);
      await refreshContacts();
    } catch (err) {
      setDrawerError(err);
    } finally {
      setContactSubmitting(false);
    }
  }

  async function handleContactDelete(contactId: string) {
    if (!confirm("Delete this contact?")) return;
    await guardRowAction(`delete-contact:${contactId}`, async () => {
      try {
        await apiDelete(`/companies/${currentCompanyId}/contacts/${contactId}`);
        await refreshContacts();
      } catch (err) {
        setError(err);
      }
    });
  }

  async function handleRowEdit(id: string) {
    try {
      const { data } = await apiGet<Company>(`/companies/${id}`);
      await openModal(data);
    } catch (err) {
      setError(err);
    }
  }

  async function handleRowDelete(id: string) {
    if (!confirm("Delete this supplier?")) return;
    await guardRowAction(`delete:${id}`, async () => {
      try {
        await apiDelete(`/companies/${id}`);
        setRows((prev) => prev.filter((r) => r.id !== id));
        setPagination((prev) => (prev ? { ...prev, total_records: Math.max(0, (prev.total_records || 1) - 1) } : prev));
      } catch (err) {
        setError(err);
      }
    });
  }

  async function handleBulkDelete() {
    if (!selectedIds.length) return;
    if (!confirm(`Delete ${selectedIds.length} selected supplier(s)? This cannot be undone.`)) return;
    await guardRowAction("bulk-delete", async () => {
      try {
        await Promise.all(selectedIds.map((id) => apiDelete(`/companies/${id}`)));
        setRows((prev) => prev.filter((r) => !selectedIds.includes(r.id)));
        setSelectedIds([]);
      } catch (err) {
        setError(err);
      }
    });
  }

  async function handleBulkDeactivate() {
    if (!selectedIds.length) return;
    if (!confirm(`Deactivate ${selectedIds.length} selected supplier(s)?`)) return;
    await guardRowAction("bulk-deactivate", async () => {
      try {
        await Promise.all(selectedIds.map((id) => apiPost(`/companies/${id}/deactivate`, {})));
        setSelectedIds([]);
        reload();
      } catch (err) {
        setError(err);
      }
    });
  }

  async function handleBulkActivate() {
    if (!selectedIds.length) return;
    if (!confirm(`Activate ${selectedIds.length} selected supplier(s)?`)) return;
    await guardRowAction("bulk-activate", async () => {
      try {
        await Promise.all(selectedIds.map((id) => apiPost(`/companies/${id}/activate`, {})));
        setSelectedIds([]);
        reload();
      } catch (err) {
        setError(err);
      }
    });
  }

  async function handleInlineUpdate(supplierId: string, path: string, updates: Record<string, unknown>) {
    // 1. Optimistic live update in memory (0ms dynamic UI reaction)
    setRows((prev) =>
      prev.map((s) => (s.id === supplierId ? { ...s, ...updates } : s))
    );
    // 2. Persist to server in background
    try {
      await apiPatch(path, updates);
    } catch (err) {
      setError(err);
      reload();
    }
  }

  async function handleExport(format: "csv" | "xlsx") {
    try {
      await downloadExport("/companies", format, "suppliers");
    } catch (err) {
      setError(err);
    }
  }

  async function handleImportSubmit() {
    if (!importFile || importLoading) return;
    setImportLoading(true);
    setImportError(null);

    try {
      const rows = await parseFile(importFile);
      if (!rows.length) {
        throw new Error("The file appears to be empty or has no data rows.");
      }
      setWizardPending({
        file: importFile,
        rows,
        sheetColumns: Object.keys(rows[0]),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportError(msg || "Failed to read file. Please check file format and try again.");
    } finally {
      setImportLoading(false);
    }
  }

  /* ------------------------------------------------------------------------- */
  /* RENDER: DEDICATED FULL-PAGE IMPORT SUPPLIERS VIEW                         */
  /* ------------------------------------------------------------------------- */
  if (isImportPageOpen) {
    return (
      <AppShell activeKey="companies" pageClassName="page-suppliers">
        <main className="page" style={{ padding: "20px", maxWidth: "1600px", margin: "0 auto" }}>
          <Breadcrumb trail={["Company Profiles", "Import Companies"]} />

          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <div>
              <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#0F172A", margin: 0 }}>Import Companies</h1>
              <div style={{ fontSize: "13px", color: "#64748b", marginTop: "4px" }}>
                Upload bulk supplier accounts, contacts, and sourcing capabilities from Excel (.xlsx, .xls) or CSV.
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsImportPageOpen(false);
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

          <Banner error={importError} />

          {/* Import Summary Results Panel if completed */}
          {importSummary && (
            <div style={{ marginBottom: "20px" }}>
              <ImportSummaryPanel summary={importSummary} error={importError} />
            </div>
          )}

          {/* Main Workspace Card */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              padding: "28px 36px",
            }}
          >
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
                  onClick={() => downloadSampleCsv("supplier", COMPANY_IMPORT_HEADERS)}
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
                <li>Mandatory Columns: <strong>Company Name</strong>, <strong>Country</strong>, <strong>Province / State</strong>, And <strong>City</strong>.</li>
                <li><strong>Company Name</strong> Must Be Unique.</li>
                <li><strong>Country, Province / State, City, Product Category, Key Strength Sub Category, And Company Type</strong> Must Already Exist In The System.</li>
                <li><strong>Key Strength Sub Category</strong> Must Belong To The Selected <strong>Product Category</strong>.</li>
                <li><strong>Calling Number</strong>, <strong>WhatsApp Number</strong>, And <strong>WeChat Number</strong> Must Include Country Code (Maximum 15 Digits Total).</li>
                <li>Multiple <strong>Emails</strong>, <strong>Product Categories</strong>, And <strong>Key Strength Sub Categories</strong> Can Be Separated By Comma (,).</li>
                <li><strong>Visited Factory/Office</strong> Must Be <em>Yes</em> Or <em>No</em>; If <em>Yes</em>, <strong>Visit Remarks</strong> Can Be Provided.</li>
                <li><strong>Current Status</strong> Must Be <em>Existing</em> Or <em>New</em>; <strong>Potential</strong> Must Be <em>Yes</em> Or <em>No</em>; <strong>Company Grade</strong> Must Be <em>A</em>, <em>B</em>, Or <em>C</em>.</li>
                <li>No Blank Rows, Merged Cells, Or Excel Formulas Allowed.</li>
                <li>Company Import May Take <strong>Several Seconds</strong> Depending On The Number Of Rows And Server Load. Please Do Not Refresh The Page During Import.</li>
              </ul>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "32px", borderTop: "1px solid #f1f5f9", paddingTop: "20px", gap: "12px" }}>
              <button
                type="button"
                onClick={() => {
                  setIsImportPageOpen(false);
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
                  padding: "9px 28px",
                  borderRadius: "6px",
                  border: "none",
                  background: !importFile || importLoading ? "#94a3b8" : "#2563eb",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: "13.5px",
                  cursor: !importFile || importLoading ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  boxShadow: !importFile || importLoading ? "none" : "0 2px 4px rgba(37,99,235,0.25)",
                }}
              >
                {importLoading ? "Importing..." : "Import"}
              </button>
            </div>
          </div>

          {/* Column Mapping Wizard Modal (Matches Supplier & Buyer Master) */}
          {wizardPending && (
            <WizardModal
              file={wizardPending.file}
              rows={wizardPending.rows}
              sheetColumns={wizardPending.sheetColumns}
              apiBase="/companies"
              entityName="supplier"
              importHeaders={COMPANY_IMPORT_HEADERS}
              onClose={() => setWizardPending(null)}
              onComplete={(summary) => {
                setWizardPending(null);
                setImportFile(null);
                if (importFileInputRef.current) importFileInputRef.current.value = "";
                if (summary) {
                  setImportSummary(summary);
                }
                reload();
              }}
              onError={(msg) => {
                setImportError(msg);
              }}
            />
          )}
        </main>
      </AppShell>
    );
  }

  const startSrNo = (currentPage - 1) * pageSize + 1;

  const fieldLabelStyle: React.CSSProperties = {
    fontSize: "12px",
    fontWeight: 600,
    color: "#475569",
    marginBottom: "6px",
    display: "block",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 12px",
    fontSize: "13px",
    border: "1px solid #cbd5e1",
    borderRadius: "5px",
    backgroundColor: "#ffffff",
    color: "#1e293b",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s ease",
  };

  const selectStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 12px",
    fontSize: "13px",
    border: "1px solid #cbd5e1",
    borderRadius: "5px",
    backgroundColor: "#ffffff",
    color: "#1e293b",
    outline: "none",
    boxSizing: "border-box",
    cursor: "pointer",
    transition: "border-color 0.15s ease",
  };

  const getInputStyle = (hasError: boolean): React.CSSProperties => ({
    ...inputStyle,
    borderColor: hasError ? "#ef4444" : "#cbd5e1",
    backgroundColor: hasError ? "#fef2f2" : "#ffffff",
  });

  const errorStyle: React.CSSProperties = {
    color: "#ef4444",
    fontSize: "12px",
    fontWeight: 600,
    marginTop: "4px",
    display: "flex",
    alignItems: "center",
    gap: "4px",
  };

  return (
    <AppShell activeKey="companies" pageClassName="page-suppliers">
      {modalOpen ? (
        <main className="page" style={{ width: "100%", padding: "20px 24px" }}>
          {/* Header Bar with Back Button */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <div>
              <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                {currentCompanyId ? "Edit Company" : "Add New Company"}
              </h1>
              <div style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>
                {currentCompanyId ? "Update company details below." : "Enter company information, contact details, and business profile."}
              </div>
            </div>
            <button
              type="button"
              className="btn"
              onClick={closeModal}
              style={{
                background: "#ffffff",
                border: "1px solid #cbd5e1",
                color: "#475569",
                fontWeight: 600,
                fontSize: "13px",
                padding: "8px 18px",
                borderRadius: "6px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              ← BACK
            </button>
          </div>
          <div className="card" style={{ background: "#ffffff", padding: "28px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
            {/* TOP NAVIGATION TABS (PROFILE | CONTACTS) */}
            {modalMode === "full" && (
              <div style={{ display: "flex", gap: "24px", borderBottom: "2px solid #e2e8f0", marginBottom: "24px" }}>
                <button
                  type="button"
                  onClick={() => setEditTab("profile")}
                  style={{
                    padding: "10px 18px",
                    background: "none",
                    border: "none",
                    borderBottom: editTab === "profile" ? "3px solid #0061f2" : "3px solid transparent",
                    color: editTab === "profile" ? "#0061f2" : "#64748b",
                    fontWeight: editTab === "profile" ? 700 : 600,
                    fontSize: "14.5px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "-2px",
                    transition: "all 0.2s ease",
                  }}
                >
                  <span style={{ fontSize: "16px" }}>👤</span> Profile
                </button>
                {currentCompanyId && (
                  <button
                    type="button"
                    onClick={() => setEditTab("contacts")}
                    style={{
                      padding: "10px 18px",
                      background: "none",
                      border: "none",
                      borderBottom: editTab === "contacts" ? "3px solid #0061f2" : "3px solid transparent",
                      color: editTab === "contacts" ? "#0061f2" : "#64748b",
                      fontWeight: editTab === "contacts" ? 700 : 600,
                      fontSize: "14.5px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "-2px",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <span style={{ fontSize: "16px" }}>📇</span> Contacts
                    {contacts.length > 0 && (
                      <span style={{
                        background: editTab === "contacts" ? "#e0e7ff" : "#f1f5f9",
                        color: editTab === "contacts" ? "#4338ca" : "#64748b",
                        fontSize: "12px",
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: "12px",
                      }}>
                        {contacts.length}
                      </span>
                    )}
                  </button>
                )}
              </div>
            )}
            {/* TAB 1: PROFILE FORM (MATCHES PRODUCTION erp.inhymasolutions.com/user/addEdit) */}
            {(editTab === "profile" || modalMode === "quick") && (
              <form onSubmit={handleSaveFullCompany} noValidate>
                {/* SECTION 1: Company & Contact Information */}
                <div style={{ marginBottom: "28px" }}>
                  <div
                    style={{
                      fontSize: "15px",
                      fontWeight: 700,
                      color: "#1e293b",
                      marginBottom: "18px",
                      paddingBottom: "8px",
                      borderBottom: "1px solid #e2e8f0",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <span>🏢</span> Company &amp; Contact Information
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, 1fr)",
                      gap: "16px",
                      marginBottom: "16px",
                    }}
                  >
                    {/* Row 1: Company Name *, Full Name (IndiaMart Or Other), Designation, GST No * */}
                    <div>
                      <label style={fieldLabelStyle}>
                        Company Name <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <CompanyNameAutocomplete
                        id="company_name"
                        value={form.company_name}
                        onChange={(val) => setField("company_name", val)}
                        onSelectCompany={(comp) => {
                          setField("company_name", comp.company_name);
                          if (!form.tax_id_number && comp.tax_id_number) setField("tax_id_number", comp.tax_id_number);
                          if (!form.company_type && comp.company_type) setField("company_type", comp.company_type);
                          if (!form.area && comp.area) setField("area", comp.area);
                          if (!form.district && comp.district) setField("district", comp.district);
                          if (!form.state_id && comp.state_id) setField("state_id", comp.state_id);
                          if (!form.city_id && comp.city_id) setField("city_id", comp.city_id);
                          if (!form.contact_full_name && comp.contact_full_name) setField("contact_full_name", comp.contact_full_name);
                          if (!form.contact_designation && comp.contact_designation) setField("contact_designation", comp.contact_designation);
                        }}
                        hasError={Boolean(validationErrors.company_name)}
                        errorMessage={validationErrors.company_name}
                        preloadedCompanies={rows}
                        placeholder="Enter company name"
                      />
                    </div>

                    <div>
                      <label style={fieldLabelStyle}>Full Name (IndiaMart Or Other)</label>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <select
                          id="contact_salutation"
                          style={{ ...selectStyle, width: "85px", flexShrink: 0 }}
                          value={form.contact_salutation || "Mr"}
                          onChange={(e) => setField("contact_salutation", e.target.value)}
                        >
                          <option value="Mr">Mr</option>
                          <option value="Ms">Ms</option>
                          <option value="Mrs">Mrs</option>
                          <option value="Dr">Dr</option>
                        </select>
                        <input
                          id="contact_full_name"
                          type="text"
                          style={inputStyle}
                          placeholder="Enter contact full name"
                          value={form.contact_full_name}
                          onChange={(e) => setField("contact_full_name", e.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={fieldLabelStyle}>Designation</label>
                      <input
                        id="contact_designation"
                        type="text"
                        style={inputStyle}
                        placeholder="Enter designation"
                        value={form.contact_designation}
                        onChange={(e) => setField("contact_designation", e.target.value)}
                      />
                    </div>

                    <div>
                      <label style={fieldLabelStyle}>
                        GST No <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <input
                          id="tax_id_number"
                          type="text"
                          maxLength={15}
                          style={{ ...getInputStyle(Boolean(validationErrors.tax_id_number)), textTransform: "uppercase" }}
                          placeholder="Enter 15-digit GSTIN"
                          value={form.tax_id_number}
                          onChange={(e) => setField("tax_id_number", e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={handleFullFormGstFetch}
                          disabled={gstFetching}
                          style={{
                            padding: "0 12px",
                            background: "#2563eb",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: "5px",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: gstFetching ? "not-allowed" : "pointer",
                            whiteSpace: "nowrap",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          {gstFetching ? "Fetching..." : "Fetch Data"}
                        </button>
                      </div>
                      {validationErrors.tax_id_number && (
                        <div style={errorStyle}><span>⚠️</span> {validationErrors.tax_id_number}</div>
                      )}
                    </div>

                    {/* Row 2: Contact Number, WhatsApp Number, Company Website */}
                    <div>
                      <label style={fieldLabelStyle}>Contact Number</label>
                      <input
                        id="contact_calling_number"
                        type="text"
                        style={inputStyle}
                        placeholder="Enter contact number"
                        value={form.contact_calling_number}
                        onChange={(e) => setField("contact_calling_number", e.target.value)}
                      />
                    </div>

                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                        <label style={{ ...fieldLabelStyle, marginBottom: 0 }}>WhatsApp Number</label>
                        <button
                          type="button"
                          onClick={handleCopyPrimaryFull}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#2563eb",
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: "pointer",
                            padding: "0 4px",
                            textDecoration: "underline",
                          }}
                        >
                          Copy Primary
                        </button>
                      </div>
                      <input
                        id="contact_whatsapp_number"
                        type="text"
                        style={inputStyle}
                        placeholder="Enter WhatsApp number"
                        value={form.contact_whatsapp_number}
                        onChange={(e) => setField("contact_whatsapp_number", e.target.value)}
                      />
                    </div>

                    <div style={{ gridColumn: "span 2" }}>
                      <label style={fieldLabelStyle}>Company Website</label>
                      <input
                        id="primary_website"
                        type="text"
                        style={inputStyle}
                        placeholder="https://..."
                        value={form.primary_website}
                        onChange={(e) => setField("primary_website", e.target.value)}
                      />
                    </div>

                    {/* Row 3: Email (span 3), Webpage (IndiaMart Or Other) (span 1) */}
                    <div style={{ gridColumn: "span 3" }}>
                      <label style={fieldLabelStyle}>Email</label>
                      <input
                        id="email"
                        type="email"
                        style={inputStyle}
                        placeholder="Enter email address"
                        value={form.email}
                        onChange={(e) => setField("email", e.target.value)}
                      />
                    </div>

                    <div>
                      <label style={fieldLabelStyle}>Webpage (IndiaMart Or Other)</label>
                      <input
                        id="secondary_website"
                        type="text"
                        style={inputStyle}
                        placeholder="Enter IndiaMart or other webpage"
                        value={form.secondary_website}
                        onChange={(e) => setField("secondary_website", e.target.value)}
                      />
                    </div>

                    {/* Row 4: Address (span 2), Area (span 1), State * (span 1) */}
                    <div style={{ gridColumn: "span 2" }}>
                      <label style={fieldLabelStyle}>Address</label>
                      <input
                        id="address"
                        type="text"
                        style={inputStyle}
                        placeholder="Enter full address"
                        value={form.address}
                        onChange={(e) => setField("address", e.target.value)}
                      />
                    </div>

                    <div>
                      <label style={fieldLabelStyle}>Area</label>
                      <input
                        id="area"
                        type="text"
                        style={inputStyle}
                        placeholder="Enter area / locality"
                        value={form.area}
                        onChange={(e) => setField("area", e.target.value)}
                      />
                    </div>

                    <div>
                      <label style={fieldLabelStyle}>
                        State <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <SelectWithSearch
                        id="state_id"
                        value={form.state_id}
                        placeholder="Select State"
                        options={quickStates.map((s) => ({ value: s.id, label: s.name }))}
                        hasError={Boolean(validationErrors.state_id)}
                        onChange={(val) => {
                          setField("state_id", val);
                          setField("district_id", "");
                          setField("district", "");
                          setField("city_id", "");
                          setFormDistricts([]);
                          setFormCities([]);
                          if (validationErrors.state_id) setValidationErrors((prev) => ({ ...prev, state_id: "" }));
                        }}
                      />
                      {validationErrors.state_id && (
                        <div style={errorStyle}><span>⚠️</span> {validationErrors.state_id}</div>
                      )}
                    </div>

                    {/* Row 5: District (cascading), City * (cascading), Pincode, Empty */}
                    <div>
                      <label style={fieldLabelStyle}>District</label>
                      <SelectWithSearch
                        id="district_id"
                        value={form.district_id}
                        placeholder={!form.state_id ? "Select State First" : formDistricts.length === 0 ? "No Districts Found" : "Select District"}
                        disabled={!form.state_id || formDistricts.length === 0}
                        options={formDistricts.map((d) => ({ value: d.id, label: d.name }))}
                        allowCustom={true}
                        onChange={(val, lbl) => {
                          setField("district_id", val);
                          setField("district", lbl || val);
                          setField("city_id", "");
                          setFormCities([]);
                        }}
                      />
                    </div>

                    <div>
                      <label style={fieldLabelStyle}>
                        City <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <SelectWithSearch
                        id="city_id"
                        value={form.city_id}
                        placeholder={!form.district_id ? "Select District First" : formCities.length === 0 ? "No Cities Found" : "Select City"}
                        disabled={!form.district_id || formCities.length === 0}
                        options={formCities.map((c) => ({ value: c.id, label: c.name }))}
                        allowCustom={true}
                        hasError={Boolean(validationErrors.city_id)}
                        onChange={(val) => {
                          setField("city_id", val);
                          if (validationErrors.city_id) setValidationErrors((prev) => ({ ...prev, city_id: "" }));
                        }}
                      />
                      {validationErrors.city_id && (
                        <div style={errorStyle}><span>⚠️</span> {validationErrors.city_id}</div>
                      )}
                    </div>

                    <div>
                      <label style={fieldLabelStyle}>Pincode</label>
                      <input
                        id="pincode"
                        type="text"
                        maxLength={10}
                        style={inputStyle}
                        placeholder="Enter 6-digit pincode"
                        value={form.pincode}
                        onChange={(e) => setField("pincode", e.target.value)}
                      />
                    </div>

                    <div>{/* 4th Column Spacer */}</div>
                  </div>
                </div>

                {/* SECTION 2: Other Details */}
                <div style={{ marginBottom: "28px" }}>
                  <div
                    style={{
                      fontSize: "15px",
                      fontWeight: 700,
                      color: "#1e293b",
                      marginBottom: "18px",
                      paddingBottom: "8px",
                      borderBottom: "1px solid #e2e8f0",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <span>📋</span> Other Details
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, 1fr)",
                      gap: "16px",
                      marginBottom: "16px",
                    }}
                  >
                    {/* Row 1: Current Status, Business Type, Category, Client Grade */}
                    <div>
                      <label style={fieldLabelStyle}>Current Status</label>
                      <select
                        id="current_status"
                        style={selectStyle}
                        value={
                          form.current_status?.toLowerCase() === "existing"
                            ? "Existing"
                            : form.current_status?.toLowerCase() === "new"
                              ? "New"
                              : form.current_status || ""
                        }
                        onChange={(e) => setField("current_status", e.target.value)}
                      >
                        <option value="">Select</option>
                        <option value="Existing">Existing</option>
                        <option value="New">New</option>
                        {form.current_status &&
                          !["existing", "new", ""].includes(form.current_status.toLowerCase()) && (
                            <option value={form.current_status}>{form.current_status}</option>
                          )}
                      </select>
                    </div>

                    <div>
                      <label style={fieldLabelStyle}>Business Type</label>
                      <select
                        id="company_type"
                        style={selectStyle}
                        value={form.company_type}
                        onChange={(e) => setField("company_type", e.target.value)}
                      >
                        <option value="">Select</option>
                        {BUSINESS_TYPE_OPTIONS.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                        {form.company_type && !BUSINESS_TYPE_OPTIONS.includes(form.company_type) && (
                          <option value={form.company_type}>{form.company_type}</option>
                        )}
                      </select>
                    </div>

                    <div>
                      <label style={fieldLabelStyle}>Category</label>
                      <select
                        id="category_id"
                        style={selectStyle}
                        value={form.category_id}
                        onChange={(e) => setField("category_id", e.target.value)}
                      >
                        <option value="">Select Category</option>
                        {productCategories.map((pc) => (
                          <option key={pc.id} value={pc.id}>
                            {pc.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={fieldLabelStyle}>Client Grade</label>
                      <select
                        id="company_grade"
                        style={selectStyle}
                        value={form.company_grade}
                        onChange={(e) => setField("company_grade", e.target.value)}
                      >
                        <option value="">Select</option>
                        <option value="A">A</option>
                        <option value="B">B</option>
                        <option value="C">C</option>
                        {form.company_grade &&
                          !["A", "B", "C"].includes(form.company_grade) && (
                            <option value={form.company_grade}>{form.company_grade}</option>
                          )}
                      </select>
                    </div>

                    {/* Row 2: Potential, Business Categories, Product They Manufacture Or Supply, Machines Currently Buying From */}
                    <div>
                      <label style={fieldLabelStyle}>Potential</label>
                      <select
                        id="potential"
                        style={selectStyle}
                        value={form.potential}
                        onChange={(e) => setField("potential", e.target.value)}
                      >
                        <option value="">Select</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </div>

                    {showsPotentialReason(form.potential) && (
                      <div>
                        <label style={fieldLabelStyle}>Reason</label>
                        <input
                          id="potential_reason"
                          type="text"
                          style={inputStyle}
                          placeholder="Why is this not a potential client?"
                          value={form.potential_reason}
                          onChange={(e) => setField("potential_reason", e.target.value)}
                        />
                      </div>
                    )}

                    {showsPotentialBusinessPerMonth(form.potential) && (
                      <div>
                        <label style={fieldLabelStyle}>Potential For Business Per Month</label>
                        <select
                          id="potential_business_per_month"
                          style={selectStyle}
                          value={form.potential_business_per_month}
                          onChange={(e) => setField("potential_business_per_month", e.target.value)}
                        >
                          <option value="">Select</option>
                          {POTENTIAL_BUSINESS_OPTIONS.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {showsMonthlyTurnover(form.company_type) && (
                      <div>
                        <label style={fieldLabelStyle}>Monthly Turnover</label>
                        <select
                          id="monthly_turnover"
                          style={selectStyle}
                          value={form.monthly_turnover}
                          onChange={(e) => setField("monthly_turnover", e.target.value)}
                        >
                          <option value="">Select</option>
                          {MONTHLY_TURNOVER_OPTIONS.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div>
                      <label style={fieldLabelStyle}>Business Categories</label>
                      <select
                        id="company_category"
                        style={selectStyle}
                        value={form.company_category}
                        onChange={(e) => setField("company_category", e.target.value)}
                      >
                        <option value="">Select</option>
                        {BUSINESS_CATEGORY_OPTIONS.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                        {form.company_category && !BUSINESS_CATEGORY_OPTIONS.includes(form.company_category) && (
                          <option value={form.company_category}>{form.company_category}</option>
                        )}
                      </select>
                    </div>

                    <div>
                      <label style={fieldLabelStyle}>Product They Manufacture Or Supply</label>
                      <input
                        id="product_manufacture_or_supply"
                        type="text"
                        style={inputStyle}
                        placeholder="Enter products manufactured / supplied"
                        value={form.product_manufacture_or_supply}
                        onChange={(e) => setField("product_manufacture_or_supply", e.target.value)}
                      />
                    </div>

                    <div>
                      <label style={fieldLabelStyle}>Machines Currently Buying From</label>
                      <input
                        id="machines_buying_from"
                        type="text"
                        style={inputStyle}
                        placeholder="Enter suppliers / machines"
                        value={form.machines_buying_from}
                        onChange={(e) => setField("machines_buying_from", e.target.value)}
                      />
                    </div>

                    {/* Row 3: Spares Currently Buying From, Products Interested To Buy From Us, GST Registration Date, Age Of Company */}
                    <div>
                      <label style={fieldLabelStyle}>Spares Currently Buying From</label>
                      <input
                        id="spares_buying_from"
                        type="text"
                        style={inputStyle}
                        placeholder="Enter spares suppliers"
                        value={form.spares_buying_from}
                        onChange={(e) => setField("spares_buying_from", e.target.value)}
                      />
                    </div>

                    <div>
                      <label style={fieldLabelStyle}>Products Interested To Buy From Us</label>
                      <input
                        id="products_interested"
                        type="text"
                        style={inputStyle}
                        placeholder="Enter interested products"
                        value={form.products_interested}
                        onChange={(e) => setField("products_interested", e.target.value)}
                      />
                    </div>

                    <div>
                      <label style={fieldLabelStyle}>GST Registration Date</label>
                      <input
                        id="gst_registration_date"
                        type="date"
                        style={inputStyle}
                        value={form.gst_registration_date}
                        onChange={(e) => setField("gst_registration_date", e.target.value)}
                      />
                    </div>

                    <div>
                      <label style={fieldLabelStyle}>Age Of Company</label>
                      <input
                        id="age_of_company"
                        type="text"
                        style={inputStyle}
                        placeholder="e.g. 5 Years"
                        value={form.age_of_company}
                        onChange={(e) => setField("age_of_company", e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* SECTION 2b: Direct Import from China (separate cluster, spec: shown only when Business Type is B2B) */}
                {showsDirectImportCluster(form.company_type) && (
                  <div style={{ marginBottom: "28px" }}>
                    <div
                      style={{
                        fontSize: "15px",
                        fontWeight: 700,
                        color: "#1e293b",
                        marginBottom: "18px",
                        paddingBottom: "8px",
                        borderBottom: "1px solid #e2e8f0",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <span>🚢</span> Direct Import From China
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: "18px",
                      }}
                    >
                      <div>
                        <label style={fieldLabelStyle}>Direct Import From China?</label>
                        <select
                          id="direct_import_from_china"
                          style={selectStyle}
                          value={form.direct_import_from_china}
                          onChange={(e) => setField("direct_import_from_china", e.target.value)}
                        >
                          <option value="">Select</option>
                          {DIRECT_IMPORT_OPTIONS.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </div>

                      {showsImportSubFields(form.company_type, form.direct_import_from_china) && (
                        <>
                          <div>
                            <label style={fieldLabelStyle}>Monthly Import Volume (INR)</label>
                            <select
                              id="monthly_import_volume"
                              style={selectStyle}
                              value={form.monthly_import_volume}
                              onChange={(e) => setField("monthly_import_volume", e.target.value)}
                            >
                              <option value="">Select</option>
                              {IMPORT_VOLUME_OPTIONS.map((v) => (
                                <option key={v} value={v}>
                                  {v}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label style={fieldLabelStyle}>Products Needed For Imports</label>
                            <input
                              id="products_needed_for_imports"
                              type="text"
                              style={inputStyle}
                              placeholder="Enter products needed for imports"
                              value={form.products_needed_for_imports}
                              onChange={(e) => setField("products_needed_for_imports", e.target.value)}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* SECTION 3: Social Media Details */}
                <div style={{ marginBottom: "28px" }}>
                  <div
                    style={{
                      fontSize: "15px",
                      fontWeight: 700,
                      color: "#1e293b",
                      marginBottom: "18px",
                      paddingBottom: "8px",
                      borderBottom: "1px solid #e2e8f0",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <span>🌐</span> Social Media Details
                  </div>

                  <div>
                    {(form.social_media || []).map((sm, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: "flex",
                          gap: "12px",
                          alignItems: "center",
                          marginBottom: "12px",
                        }}
                      >
                        <select
                          style={{ ...selectStyle, width: "200px", flexShrink: 0 }}
                          value={sm.platform}
                          onChange={(e) => handleUpdateSocialMedia(idx, "platform", e.target.value)}
                        >
                          <option value="">Select Platform</option>
                          <option value="LinkedIn">LinkedIn</option>
                          <option value="Facebook">Facebook</option>
                          <option value="Instagram">Instagram</option>
                          <option value="Twitter">Twitter / X</option>
                          <option value="YouTube">YouTube</option>
                          <option value="Website">Website</option>
                          <option value="WhatsApp">WhatsApp</option>
                          <option value="Other">Other</option>
                        </select>
                        <input
                          type="text"
                          style={{ ...inputStyle, flex: 1 }}
                          placeholder="Enter your link..."
                          value={sm.url}
                          onChange={(e) => handleUpdateSocialMedia(idx, "url", e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveSocialMedia(idx)}
                          title="Remove row"
                          style={{
                            width: "36px",
                            height: "36px",
                            borderRadius: "5px",
                            border: "1px solid #fecaca",
                            background: "#fef2f2",
                            color: "#ef4444",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "14px",
                            flexShrink: 0,
                          }}
                        >
                          🗑
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={handleAddSocialMedia}
                      style={{
                        padding: "6px 14px",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "#2563eb",
                        background: "#eff6ff",
                        border: "1px solid #bfdbfe",
                        borderRadius: "5px",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        marginTop: "4px",
                      }}
                    >
                      + Add Social Media
                    </button>
                  </div>
                </div>

                {/* SECTION 4: Remarks, Sales Person & Bottom Action Controls */}
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ marginBottom: "16px" }}>
                    <label style={fieldLabelStyle}>Overall Observations / Remarks / Key Strengths</label>
                    <textarea
                      id="overall_remarks"
                      rows={3}
                      style={{ ...inputStyle, resize: "vertical" }}
                      placeholder="Enter overall observations, remarks, or key strengths..."
                      value={form.overall_remarks}
                      onChange={(e) => setField("overall_remarks", e.target.value)}
                    />
                  </div>

                  <div style={{ maxWidth: "350px", marginBottom: "20px" }}>
                    <label style={fieldLabelStyle}>Sales Person</label>
                    <select
                      id="sales_person_id"
                      style={selectStyle}
                      value={form.sales_person_id}
                      onChange={(e) => setField("sales_person_id", e.target.value)}
                    >
                      <option value="">Select Sales Person</option>
                      {effectiveSalesPersons.map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          {sp.full_name || sp.username}
                        </option>
                      ))}
                    </select>
                  </div>

                  {formAlert && (
                    <div
                      style={{
                        padding: "10px 14px",
                        borderRadius: "6px",
                        fontSize: "13px",
                        marginBottom: "16px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        background: formAlert.type === "error" ? "#fef2f2" : "#eff6ff",
                        color: formAlert.type === "error" ? "#b91c1c" : "#1d4ed8",
                        border: `1px solid ${formAlert.type === "error" ? "#fecaca" : "#bfdbfe"}`,
                      }}
                    >
                      <span>{formAlert.type === "error" ? "⚠️" : "ℹ️"}</span>
                      <span>{formAlert.message}</span>
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "12px",
                      borderTop: "1px solid #f1f5f9",
                      paddingTop: "20px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={closeModal}
                      style={{
                        padding: "10px 22px",
                        background: "#ffffff",
                        color: "#475569",
                        border: "1px solid #cbd5e1",
                        borderRadius: "6px",
                        fontWeight: 600,
                        fontSize: "14px",
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      style={{
                        padding: "10px 28px",
                        background: "#2563eb",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "6px",
                        fontWeight: 700,
                        fontSize: "14px",
                        cursor: saving ? "not-allowed" : "pointer",
                        opacity: saving ? 0.7 : 1,
                        boxShadow: "0 2px 6px rgba(37,99,235,0.25)",
                      }}
                    >
                      {saving ? "Saving..." : (currentCompanyId ? "Update & Exit" : "Save & Exit")}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* TAB 2: CONTACTS TAB VIEW */}
            {modalMode === "full" && currentCompanyId && editTab === "contacts" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                  <div>
                    <h3 style={{ fontSize: "17px", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                      Company Contacts
                    </h3>
                    <div style={{ fontSize: "13px", color: "#64748b", marginTop: "3px" }}>
                      Manage contact persons, territory assignments, numbers, WeChat, and email addresses.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-add-new"
                    onClick={() => openContactForm(null)}
                    style={{
                      background: "#0061f2",
                      color: "#ffffff",
                      padding: "9px 18px",
                      borderRadius: "6px",
                      fontWeight: 600,
                      fontSize: "13.5px",
                      border: "none",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    + Add New
                  </button>
                </div>

                {/* RIGHT SIDE DRAWER MODAL FOR ADD/EDIT CONTACT */}
                {contactFormOpen && (
                  <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", justifyContent: "flex-end" }}>
                    {/* Dark Backdrop Overlay */}
                    <div
                      onClick={() => setContactFormOpen(false)}
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "rgba(15, 23, 42, 0.45)",
                        backdropFilter: "blur(2px)",
                        transition: "opacity 0.2s ease",
                      }}
                    />

                    {/* Side Drawer Panel */}
                    <div
                      style={{
                        position: "relative",
                        width: "460px",
                        maxWidth: "92vw",
                        height: "100%",
                        background: "#ffffff",
                        boxShadow: "-8px 0 30px rgba(0, 0, 0, 0.18)",
                        display: "flex",
                        flexDirection: "column",
                        zIndex: 10000,
                      }}
                    >
                      {/* Drawer Header */}
                      <div
                        style={{
                          padding: "18px 24px",
                          borderBottom: "1px solid #e2e8f0",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          background: "#ffffff",
                        }}
                      >
                        <h3 style={{ fontSize: "17px", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                          {contactForm.id ? "Edit Contact Person" : "Add New Contact"}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setContactFormOpen(false)}
                          style={{
                            background: "none",
                            border: "none",
                            fontSize: "20px",
                            color: "#64748b",
                            cursor: "pointer",
                            padding: "4px 8px",
                            borderRadius: "4px",
                            lineHeight: 1,
                          }}
                        >
                          ✕
                        </button>
                      </div>

                      {/* Drawer Form Content (Scrollable) */}
                      <form
                        autoComplete="none"
                        onSubmit={(e) => { void handleContactSubmit(e); }}
                        style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: "18px" }}
                      >
                        {Boolean(drawerError) && (
                          <div style={{ marginBottom: "6px" }}>
                            <Banner error={drawerError} />
                          </div>
                        )}

                        {/* Full Name Field (Compact inline Salutation dropdown + Name input) */}
                        <div className="field">
                          <label style={{ fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px", display: "block" }}>
                            Full Name <span style={{ color: "#ef4444" }}>*</span>
                          </label>
                          <div style={{ display: "flex", gap: "8px" }}>
                            <select
                              value={contactForm.salutation}
                              onChange={(e) => setContactForm((f) => ({ ...f, salutation: e.target.value }))}
                              style={{
                                width: "75px",
                                padding: "9px 8px",
                                fontSize: "13.5px",
                                borderRadius: "6px",
                                border: "1px solid #cbd5e1",
                                background: "#ffffff",
                                color: "#334155",
                                fontWeight: 500,
                                outline: "none",
                              }}
                            >
                              <option value="">Mr</option>
                              <option value="Mr.">Mr.</option>
                              <option value="Mrs.">Mrs.</option>
                              <option value="Ms.">Ms.</option>
                            </select>
                            <input
                              type="text"
                              required
                              autoComplete="new-password"
                              readOnly
                              onFocus={(e) => e.target.removeAttribute("readonly")}
                              maxLength={150}
                              placeholder="Full name of contact..."
                              value={contactForm.person_name}
                              onChange={(e) => setContactForm((f) => ({ ...f, person_name: e.target.value }))}
                              style={{
                                flex: 1,
                                padding: "9px 12px",
                                fontSize: "13.5px",
                                borderRadius: "6px",
                                border: "1px solid #cbd5e1",
                                outline: "none",
                                color: "#0f172a",
                              }}
                            />
                          </div>
                        </div>

                        {/* Designation */}
                        <div className="field">
                          <label style={{ fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px", display: "block" }}>
                            Designation
                          </label>
                          <input
                            type="text"
                            autoComplete="new-password"
                            readOnly
                            onFocus={(e) => e.target.removeAttribute("readonly")}
                            maxLength={150}
                            placeholder="e.g. Sales Manager, Sourcing Lead"
                            value={contactForm.designation}
                            onChange={(e) => setContactForm((f) => ({ ...f, designation: e.target.value }))}
                            style={{
                              width: "100%",
                              padding: "9px 12px",
                              fontSize: "13.5px",
                              borderRadius: "6px",
                              border: "1px solid #cbd5e1",
                              outline: "none",
                              color: "#0f172a",
                            }}
                          />
                        </div>

                        {/* Calling Number */}
                        <div className="field">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                            <label style={{ fontSize: "12.5px", fontWeight: 600, color: "#475569", margin: 0 }}>Calling Number</label>
                            {contactPhoneCode && (
                              <span style={{ fontSize: "11px", fontWeight: 700, color: "#0061f2", background: "#eff6ff", padding: "1px 7px", borderRadius: "4px" }}>
                                Code: {contactPhoneCode}
                              </span>
                            )}
                          </div>
                          <input
                            type="text"
                            autoComplete="new-password"
                            readOnly
                            onFocus={(e) => e.target.removeAttribute("readonly")}
                            maxLength={30}
                            placeholder={contactPhoneCode ? `${contactPhoneCode} 13800...` : "With country code..."}
                            value={contactForm.calling_number}
                            onChange={(e) => {
                              const v = e.target.value;
                              setContactForm((f) => {
                                const updated = { ...f, calling_number: v };
                                if (contactSameCallingWhatsapp) updated.whatsapp_number = v;
                                if (contactSameCallingWechat) updated.wechat_number = v;
                                return updated;
                              });
                            }}
                            style={{
                              width: "100%",
                              padding: "9px 12px",
                              fontSize: "13.5px",
                              borderRadius: "6px",
                              border: "1px solid #cbd5e1",
                              outline: "none",
                              color: "#0f172a",
                            }}
                          />
                        </div>

                        {/* WhatsApp Number */}
                        <div className="field">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                            <label style={{ fontSize: "12.5px", fontWeight: 600, color: "#475569", margin: 0 }}>Whatsapp Number</label>
                            <label style={{ fontSize: "11.5px", color: "#0061f2", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 600 }}>
                              <input
                                type="checkbox"
                                checked={contactSameCallingWhatsapp}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setContactSameCallingWhatsapp(checked);
                                  if (checked) {
                                    setContactForm((f) => ({ ...f, whatsapp_number: f.calling_number }));
                                  }
                                }}
                              />
                              Same As Calling
                            </label>
                          </div>
                          <input
                            type="text"
                            autoComplete="new-password"
                            readOnly
                            onFocus={(e) => e.target.removeAttribute("readonly")}
                            maxLength={30}
                            placeholder={contactPhoneCode ? `${contactPhoneCode} 13800...` : "With country code..."}
                            value={contactForm.whatsapp_number}
                            onChange={(e) => setContactForm((f) => ({ ...f, whatsapp_number: e.target.value }))}
                            style={{
                              width: "100%",
                              padding: "9px 12px",
                              fontSize: "13.5px",
                              borderRadius: "6px",
                              border: "1px solid #cbd5e1",
                              outline: "none",
                              color: "#0f172a",
                            }}
                          />
                        </div>

                        {/* WeChat Number */}
                        <div className="field">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                            <label style={{ fontSize: "12.5px", fontWeight: 600, color: "#475569", margin: 0 }}>WeChat Number</label>
                            <label style={{ fontSize: "11.5px", color: "#0061f2", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 600 }}>
                              <input
                                type="checkbox"
                                checked={contactSameCallingWechat}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setContactSameCallingWechat(checked);
                                  if (checked) {
                                    setContactForm((f) => ({ ...f, wechat_number: f.calling_number }));
                                  }
                                }}
                              />
                              Same As Calling
                            </label>
                          </div>
                          <input
                            type="text"
                            autoComplete="new-password"
                            readOnly
                            onFocus={(e) => e.target.removeAttribute("readonly")}
                            maxLength={50}
                            placeholder={contactPhoneCode ? `${contactPhoneCode} / ID` : "WeChat ID or Phone..."}
                            value={contactForm.wechat_number}
                            onChange={(e) => setContactForm((f) => ({ ...f, wechat_number: e.target.value }))}
                            style={{
                              width: "100%",
                              padding: "9px 12px",
                              fontSize: "13.5px",
                              borderRadius: "6px",
                              border: "1px solid #cbd5e1",
                              outline: "none",
                              color: "#0f172a",
                            }}
                          />
                        </div>

                        {/* Email ID */}
                        <div className="field">
                          <label style={{ fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px", display: "block" }}>
                            Email ID
                          </label>
                          <input
                            type="text"
                            inputMode="email"
                            autoComplete="new-password"
                            readOnly
                            onFocus={(e) => e.target.removeAttribute("readonly")}
                            maxLength={255}
                            placeholder="contact@supplier.com"
                            value={contactForm.email}
                            onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))}
                            style={{
                              width: "100%",
                              padding: "9px 12px",
                              fontSize: "13.5px",
                              borderRadius: "6px",
                              border: "1px solid #cbd5e1",
                              outline: "none",
                              color: "#0f172a",
                            }}
                          />
                        </div>

                        {/* Birth Date */}
                        <div className="field">
                          <label style={{ fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px", display: "block" }}>
                            Birth Date
                          </label>
                          <input
                            type="date"
                            value={contactForm.birth_date}
                            onChange={(e) => setContactForm((f) => ({ ...f, birth_date: e.target.value }))}
                            style={{
                              width: "100%",
                              padding: "9px 12px",
                              fontSize: "13.5px",
                              borderRadius: "6px",
                              border: "1px solid #cbd5e1",
                              outline: "none",
                              color: "#0f172a",
                            }}
                          />
                        </div>

                        {/* Anniversary Date */}
                        <div className="field">
                          <label style={{ fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px", display: "block" }}>
                            Anniversary Date
                          </label>
                          <input
                            type="date"
                            value={contactForm.anniversary_date}
                            onChange={(e) => setContactForm((f) => ({ ...f, anniversary_date: e.target.value }))}
                            style={{
                              width: "100%",
                              padding: "9px 12px",
                              fontSize: "13.5px",
                              borderRadius: "6px",
                              border: "1px solid #cbd5e1",
                              outline: "none",
                              color: "#0f172a",
                            }}
                          />
                        </div>

                        {/* Handling Territory */}
                        <div className="field">
                          <label style={{ fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px", display: "block" }}>
                            Handling Territory
                          </label>
                          <input
                            type="text"
                            autoComplete="new-password"
                            readOnly
                            onFocus={(e) => e.target.removeAttribute("readonly")}
                            maxLength={150}
                            placeholder="e.g. local, Export India, Export Africa..."
                            value={contactForm.handling_territory}
                            onChange={(e) => setContactForm((f) => ({ ...f, handling_territory: e.target.value }))}
                            style={{
                              width: "100%",
                              padding: "9px 12px",
                              fontSize: "13.5px",
                              borderRadius: "6px",
                              border: "1px solid #cbd5e1",
                              outline: "none",
                              color: "#0f172a",
                            }}
                          />
                          <div style={{ display: "flex", gap: "6px", marginTop: "6px", flexWrap: "wrap" }}>
                            {["local", "Export India", "Export Africa", "Export Global"].map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setContactForm((f) => ({ ...f, handling_territory: t }))}
                                style={{
                                  padding: "3px 10px",
                                  fontSize: "11.5px",
                                  fontWeight: 600,
                                  background: contactForm.handling_territory === t ? "#e0e7ff" : "#f8fafc",
                                  color: contactForm.handling_territory === t ? "#4338ca" : "#475569",
                                  border: "1px solid",
                                  borderColor: contactForm.handling_territory === t ? "#c7d2fe" : "#cbd5e1",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                }}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Country (Default China) */}
                        <div className="field">
                          <label style={{ fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px", display: "block" }}>
                            Country <span style={{ color: "#ef4444" }}>*</span>
                          </label>
                          <SearchableDropdown
                            value={contactCountryId}
                            onChange={setContactCountryId}
                            placeholder="Search country..."
                            fetchOptions={searchFetcher("/masters/countries")}
                            fetchLabelForValue={fetchNameLabel("/masters/countries")}
                          />
                        </div>
                      </form>

                      {/* Footer Bar with Prominent Full-Width Blue Submit Button */}
                      <div
                        style={{
                          padding: "16px 24px",
                          borderTop: "1px solid #e2e8f0",
                          background: "#ffffff",
                          display: "flex",
                          gap: "12px",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setContactFormOpen(false)}
                          style={{
                            flex: "0 0 90px",
                            padding: "11px",
                            background: "#ffffff",
                            border: "1px solid #cbd5e1",
                            color: "#475569",
                            borderRadius: "6px",
                            fontSize: "14px",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={contactSubmitting}
                          onClick={(e) => { void handleContactSubmit(e); }}
                          style={{
                            flex: 1,
                            padding: "11px",
                            background: "#0061f2",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: "6px",
                            fontSize: "14px",
                            fontWeight: 700,
                            cursor: contactSubmitting ? "not-allowed" : "pointer",
                            opacity: contactSubmitting ? 0.7 : 1,
                            boxShadow: "0 2px 6px rgba(0, 97, 242, 0.3)",
                          }}
                        >
                          {contactSubmitting ? "Submitting..." : "Submit"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* CONTACTS LIST TABLE */}
                <div className="table-scroll" style={{ border: "1px solid #e2e8f0", borderRadius: "8px", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                        <th style={{ padding: "12px 14px", textAlign: "left", fontSize: "12px", fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>NAME / DESIGNATION</th>
                        <th style={{ padding: "12px 14px", textAlign: "left", fontSize: "12px", fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>CALLING / WHATSAPP</th>
                        <th style={{ padding: "12px 14px", textAlign: "left", fontSize: "12px", fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>WECHAT / EMAIL</th>
                        <th style={{ padding: "12px 14px", textAlign: "left", fontSize: "12px", fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>HANDLING TERRITORY</th>
                        <th style={{ padding: "12px 14px", textAlign: "center", fontSize: "12px", fontWeight: 700, color: "#475569", textTransform: "uppercase", width: "140px" }}>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ padding: "24px", textAlign: "center", color: "#94a3b8", fontSize: "13.5px" }}>
                            No contact persons added yet. Click "+ Add New" above to add contacts.
                          </td>
                        </tr>
                      ) : (
                        contacts.map((c) => (
                          <tr key={c.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            {/* NAME / DESIGNATION */}
                            <td style={{ padding: "12px 14px", verticalAlign: "top" }}>
                              <div style={{ fontWeight: 700, color: "#0f172a", fontSize: "13.5px" }}>
                                {c.salutation ? `${c.salutation} ` : ""}{c.person_name}
                                {c.is_primary && (
                                  <span style={{ marginLeft: "6px", background: "#e2e8f0", color: "#334155", fontSize: "11px", fontWeight: 600, padding: "1px 6px", borderRadius: "4px" }}>
                                    Primary
                                  </span>
                                )}
                              </div>
                              {c.designation ? (
                                <div style={{ fontSize: "12.5px", color: "#64748b", marginTop: "2px" }}>{c.designation}</div>
                              ) : (
                                <div style={{ fontSize: "12px", color: "#cbd5e1" }}>—</div>
                              )}
                              {computeAge(c.birth_date) !== null && (
                                <div style={{ fontSize: "11.5px", color: "#94a3b8", marginTop: "2px" }}>
                                  Age: {computeAge(c.birth_date)}
                                </div>
                              )}
                            </td>

                            {/* CALLING / WHATSAPP */}
                            <td style={{ padding: "12px 14px", verticalAlign: "top" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
                                {c.calling_number ? (
                                  <a href={`tel:${c.calling_number}`} style={{ color: "#0061f2", textDecoration: "none", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: "5px" }}>
                                    📞 {c.calling_number}
                                  </a>
                                ) : <span style={{ color: "#cbd5e1" }}>—</span>}
                                {c.whatsapp_number ? (
                                  <a href={`https://wa.me/${c.whatsapp_number.replace(/[^0-9]/g, "")}`} target="_blank" rel="noopener noreferrer" style={{ color: "#16a34a", textDecoration: "none", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: "5px" }}>
                                    💬 {c.whatsapp_number}
                                  </a>
                                ) : null}
                              </div>
                            </td>

                            {/* WECHAT / EMAIL */}
                            <td style={{ padding: "12px 14px", verticalAlign: "top" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
                                {c.wechat_number ? (
                                  <span style={{ color: "#334155", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: "5px" }}>
                                    💬 {c.wechat_number}
                                  </span>
                                ) : <span style={{ color: "#cbd5e1" }}>—</span>}
                                {c.email ? (
                                  <a href={`mailto:${c.email}`} style={{ color: "#0061f2", textDecoration: "none", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: "5px" }}>
                                    ✉️ {c.email}
                                  </a>
                                ) : null}
                              </div>
                            </td>

                            {/* HANDLING TERRITORY */}
                            <td style={{ padding: "12px 14px", verticalAlign: "top" }}>
                              <span style={{ fontSize: "13px", color: "#334155", fontWeight: 500 }}>
                                {c.handling_territory || "—"}
                              </span>
                            </td>

                            {/* ACTION */}
                            <td style={{ padding: "12px 14px", verticalAlign: "top", textAlign: "center" }}>
                              <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                                <button
                                  type="button"
                                  onClick={() => openContactForm(c)}
                                  style={{
                                    background: "#0061f2",
                                    color: "#ffffff",
                                    border: "none",
                                    borderRadius: "5px",
                                    padding: "5px 12px",
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                  }}
                                >
                                  ✏️ Edit
                                </button>
                                {!c.is_primary && (
                                  <button
                                    type="button"
                                    onClick={() => handleContactDelete(c.id)}
                                    disabled={isRowActionPending(`delete-contact:${c.id}`)}
                                    style={{
                                      background: "#ef4444",
                                      color: "#ffffff",
                                      border: "none",
                                      borderRadius: "5px",
                                      padding: "5px 12px",
                                      fontSize: "12px",
                                      fontWeight: 600,
                                      cursor: isRowActionPending(`delete-contact:${c.id}`) ? "default" : "pointer",
                                      opacity: isRowActionPending(`delete-contact:${c.id}`) ? 0.6 : 1,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "4px",
                                    }}
                                  >
                                    {isRowActionPending(`delete-contact:${c.id}`) ? "Deleting…" : "🗑️ Delete"}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </main>
      ) : (
        <main className="page">
          <Breadcrumb trail={["Companies"]} />
          <div className="page-header">
            <div>
              <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#1e293b" }}>Companies</h1>
            </div>
            <div className="page-header-actions" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <button
                type="button"
                className="btn"
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
                onClick={() => setFilterOpen((v) => !v)}
                title="Toggle Filter Options"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                </svg>
              </button>
              {canCreate && (
                <button className="btn btn-quick-add" onClick={openQuickAdd}>
                  + QUICK ADD
                </button>
              )}
              {canCreate && (
                <button className="btn btn-add-new" onClick={() => openModal(null, "full")}>
                  + ADD NEW
                </button>
              )}
              <ImpExpDropdown
                apiBase="/companies"
                entityName="supplier"
                importHeaders={COMPANY_IMPORT_HEADERS}
                onSummary={setImportSummary}
                onError={setImportError}
                onComplete={() => reload()}
                onExportCsv={() => handleExport("csv")}
                showImport={canImport}
                showExport={canExport}
                onOpenImportPage={() => {
                  setImportError(null);
                  setImportSummary(null);
                  setImportFile(null);
                  setIsImportPageOpen(true);
                }}
              />
              {canBulkAction && (
                <BulkActionsDropdown
                  selectedCount={selectedIds.length}
                  onBulkActivate={canUpdate && statusTab === "inactive" ? handleBulkActivate : undefined}
                  onBulkDeactivate={canUpdate && statusTab === "active" ? handleBulkDeactivate : undefined}
                  onBulkDelete={canDelete ? handleBulkDelete : undefined}
                />
              )}
            </div>
          </div>
          <Banner error={error} />
          <ImportSummaryPanel summary={importSummary} error={importError} />

          {/* TOGGLABLE TOP FILTER PANEL */}
          {filterOpen && (
            <div
              className="card"
              style={{
                background: "#ffffff",
                padding: "20px 24px",
                borderRadius: "10px",
                border: "1px solid #cbd5e1",
                marginBottom: "16px",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.04)",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  columnGap: "24px",
                  rowGap: "16px",
                }}
              >
                {/* Row 1 */}
                <div>
                  <label style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Date / Date Range
                  </label>
                  <DateRangePicker
                    value={filterDateRange}
                    onChange={setFilterDateRange}
                    placeholder="Date / Date Range"
                  />
                </div>

                <div>
                  <label style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Business Type
                  </label>
                  <select
                    value={companyTypeFilter}
                    onChange={(e) => setCompanyTypeFilter(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      color: companyTypeFilter ? "#0f172a" : "#64748b",
                      background: "#ffffff",
                    }}
                  >
                    {filterBusinessTypes.map((opt) => (
                      <option key={opt.label} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Current Status
                  </label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      color: statusFilter ? "#0f172a" : "#64748b",
                      background: "#ffffff",
                    }}
                  >
                    <option value="">All</option>
                    <option value="existing">Existing</option>
                    <option value="new">New</option>
                    <option value="blank">Blank</option>
                  </select>
                </div>

                {/* Row 2 */}
                <div>
                  <label style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    State
                  </label>
                  <select
                    value={stateFilter}
                    onChange={(e) => {
                      setStateFilter(e.target.value);
                      setDistrictFilter("");
                      setCityFilter("");
                    }}
                    style={{
                      width: "100%",
                      height: "38px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      color: stateFilter ? "#0f172a" : "#64748b",
                      background: "#ffffff",
                    }}
                  >
                    <option value="">All</option>
                    {filterStates.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    City
                  </label>
                  <select
                    value={cityFilter}
                    onChange={(e) => setCityFilter(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      color: cityFilter ? "#0f172a" : "#64748b",
                      background: "#ffffff",
                    }}
                  >
                    <option value="">All</option>
                    {availableCities.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    District
                  </label>
                  <select
                    value={districtFilter}
                    onChange={(e) => {
                      setDistrictFilter(e.target.value);
                      setCityFilter("");
                    }}
                    style={{
                      width: "100%",
                      height: "38px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      color: districtFilter ? "#0f172a" : "#64748b",
                      background: "#ffffff",
                    }}
                  >
                    <option value="">All</option>
                    {filterDistricts.map((d) => (
                      <option key={d.id || d.name} value={d.name}>{d.name}</option>
                    ))}
                  </select>
                </div>

                {/* Row 3 */}
                <div>
                  <label style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Category
                  </label>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      color: categoryFilter ? "#0f172a" : "#64748b",
                      background: "#ffffff",
                    }}
                  >
                    <option value="">All</option>
                    <option value="blank">Blank</option>
                    {filterCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Client Grade
                  </label>
                  <select
                    value={gradeFilter}
                    onChange={(e) => setGradeFilter(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      color: gradeFilter ? "#0f172a" : "#64748b",
                      background: "#ffffff",
                    }}
                  >
                    <option value="">All</option>
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                    <option value="blank">Blank</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Potential
                  </label>
                  <select
                    value={potentialFilter}
                    onChange={(e) => setPotentialFilter(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      color: potentialFilter ? "#0f172a" : "#64748b",
                      background: "#ffffff",
                    }}
                  >
                    <option value="">All</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>

                {/* Row 4 */}
                <div>
                  <label style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Business Category
                  </label>
                  <select
                    value={businessCategoryFilter}
                    onChange={(e) => setBusinessCategoryFilter(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      color: businessCategoryFilter ? "#0f172a" : "#64748b",
                      background: "#ffffff",
                    }}
                  >
                    <option value="">All</option>
                    <option value="Manufacturer">Manufacturer</option>
                    <option value="Trader">Trader</option>
                    <option value="blank">Blank</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Sector
                  </label>
                  <select
                    value={sectorFilter}
                    onChange={(e) => setSectorFilter(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      color: sectorFilter ? "#0f172a" : "#64748b",
                      background: "#ffffff",
                    }}
                  >
                    <option value="">All</option>
                    {COMPANY_SECTORS.map((sec) => (
                      <option key={sec} value={sec}>
                        {sec}
                      </option>
                    ))}
                    <option value="blank">Blank</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Sales Person
                  </label>
                  <select
                    value={salesPersonFilter}
                    onChange={(e) => setSalesPersonFilter(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      color: salesPersonFilter ? "#0f172a" : "#64748b",
                      background: "#ffffff",
                    }}
                  >
                    <option value="">All</option>
                    {filterSalesPersons.map((sp) => (
                      <option key={sp.id} value={sp.id}>{sp.full_name || sp.username}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "18px" }}>
                <button
                  type="button"
                  onClick={handleResetFilters}
                  style={{
                    background: "#556987",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "8px 24px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleSearchFilters}
                  style={{
                    background: "#f59e0b",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "8px 24px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Search
                </button>
              </div>
            </div>
          )}

          <div className="card">
            {/* Active / Inactive Top Tabs */}
            <div style={{ display: "flex", gap: "20px", borderBottom: "1px solid #e2e8f0", padding: "6px 16px 0" }}>
              <button
                type="button"
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: statusTab === "active" ? "2.5px solid #0061f2" : "2.5px solid transparent",
                  color: statusTab === "active" ? "#0061f2" : "#64748b",
                  fontWeight: 700,
                  fontSize: "13.5px",
                  paddingBottom: "6px",
                  cursor: "pointer",
                }}
                onClick={() => {
                  setCurrentPage(1);
                  setSelectedIds([]);
                  setStatusTab("active");
                }}
              >
                Active
              </button>
              <button
                type="button"
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: statusTab === "inactive" ? "2.5px solid #0061f2" : "2.5px solid transparent",
                  color: statusTab === "inactive" ? "#0061f2" : "#64748b",
                  fontWeight: 700,
                  fontSize: "13.5px",
                  paddingBottom: "6px",
                  cursor: "pointer",
                }}
                onClick={() => {
                  setCurrentPage(1);
                  setSelectedIds([]);
                  setStatusTab("inactive");
                }}
              >
                Inactive
              </button>
            </div>

            <div className="toolbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", gap: "10px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                  <span style={{ fontSize: "13px", color: "#64748b", fontWeight: 500 }}>Items/Page</span>
                </div>

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
                        right: 0,
                        top: "38px",
                        zIndex: 100,
                        background: "#ffffff",
                        border: "1px solid #cbd5e1",
                        borderRadius: "8px",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                        padding: "12px",
                        minWidth: "220px",
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#475569", marginBottom: "8px", borderBottom: "1px solid #f1f5f9", paddingBottom: "6px" }}>
                        Toggle Frozen Columns
                      </div>
                      <div style={{ maxHeight: "200px", overflowY: "auto", paddingRight: "4px" }}>
                        {COMPANY_TABLE_COLUMNS.map((label, idx) => {
                          const isPinned = Boolean(pinnedCols[idx]);
                          return (
                            <label key={label} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer", padding: "4px 0" }}>
                              <input type="checkbox" checked={isPinned} onChange={() => togglePin(idx)} /> {label}
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

              <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  style={{ width: "320px", padding: "8px 36px 8px 14px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => setSearchInput("")}
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

            <div className="table-scroll" style={{ maxHeight: "calc(100vh - 220px)", overflowY: "auto", overflowX: "auto" }}>
              <table ref={tableRef} style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>

                <thead>
                  <tr>
                    {displayOrder.map((idx) => {
                      if (idx === 0) {
                        return (
                          <th key="col-0" style={{ width: "40px", minWidth: "40px", maxWidth: "45px", textAlign: "center", ...getFreezeStyle(0, true) }}>
                            <input
                              type="checkbox"
                              checked={rows.length > 0 && rows.every((r) => selectedIds.includes(r.id))}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedIds(rows.map((r) => r.id));
                                else setSelectedIds([]);
                              }}
                              style={{ cursor: "pointer", width: "16px", height: "16px" }}
                            />
                          </th>
                        );
                      }
                      const label = COMPANY_TABLE_COLUMNS[idx];
                      const isPinned = Boolean(pinnedCols[idx]);
                      const isAction = idx === 14;
                      const isSrNo = idx === 1;
                      const isSorted = sortColIndex === idx;
                      return (
                        <th
                          key={`col-${idx}-${label}`}
                          style={{
                            ...(isAction
                              ? { width: "70px", minWidth: "70px", textAlign: "center" }
                              : isSrNo
                                ? { width: "70px", minWidth: "70px", maxWidth: "80px", textAlign: "center" }
                                : {}),
                            ...getFreezeStyle(idx, true),
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: isAction ? "center" : "space-between", gap: "4px" }}>
                            {isAction ? (
                              <span>{label}</span>
                            ) : (
                              <div
                                onClick={() => handleHeaderSort(idx)}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
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
                                      color: "#0284c7",
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
                              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "11px", opacity: isPinned ? 1 : 0.3, padding: "0 2px", flexShrink: 0 }}
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
                <tbody ref={tableBodyRef} data-names-version={namesVersion}>
                  {loading ? (
                    <CompanySkeletonRows count={8} displayOrder={displayOrder} getFreezeStyle={getFreezeStyle} />
                  ) : sortedRows.length === 0 ? (
                    <TableMessageRow colSpan={COMPANY_TABLE_COLUMNS.length}>No companies found.</TableMessageRow>
                  ) : (
                    sortedRows.map((s, index) => (
                      <tr key={s.id}>
                        {displayOrder.map((idx) => {
                          switch (idx) {
                            case 0:
                              return (
                                <td key="cell-0" style={{ width: "40px", minWidth: "40px", maxWidth: "45px", textAlign: "center", ...getFreezeStyle(0, false) }}>
                                  <input
                                    type="checkbox"
                                    className="row-select"
                                    checked={selectedIds.includes(s.id)}
                                    onChange={(e) => {
                                      if (e.target.checked) setSelectedIds((prev) => [...prev, s.id]);
                                      else setSelectedIds((prev) => prev.filter((i) => i !== s.id));
                                    }}
                                    style={{ cursor: "pointer", width: "16px", height: "16px" }}
                                  />
                                </td>
                              );
                            case 1: // Sr. No.
                              return (
                                <td
                                  key="cell-1"
                                  className="cell-srno"
                                  style={{
                                    width: "65px",
                                    minWidth: "65px",
                                    maxWidth: "75px",
                                    textAlign: "center",
                                    fontWeight: 600,
                                    color: "#475569",
                                    ...getFreezeStyle(1, false),
                                  }}
                                >
                                  {startSrNo + index}
                                </td>
                              );
                            case 2: // Company
                              return (
                                <td key="cell-2" style={getFreezeStyle(2, false)}>
                                  <a
                                    href="#"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setDrawerCompany(s);
                                    }}
                                    style={{
                                      fontWeight: 600,
                                      color: "#0061f2",
                                      textDecoration: "none",
                                      textTransform: "uppercase",
                                      fontSize: "13px",
                                      display: "block",
                                    }}
                                  >
                                    {s.company_name}
                                  </a>
                                  <div style={{ fontSize: "11.5px", color: "#0284c7", fontWeight: 500, marginTop: "2px" }}>
                                    {s.tax_id_number || <span style={{ color: "#94a3b8" }}>—</span>}
                                  </div>
                                </td>
                              );
                            case 3: // Name / Designation
                              return (
                                <td key="cell-3" style={getFreezeStyle(3, false)}>
                                  {(() => {
                                    const salutation = s.contact_salutation
                                      ? s.contact_salutation.trim().replace(/\.+$/, "") + ". "
                                      : "";
                                    const name = s.contact_full_name || (s.contacts && s.contacts[0]?.person_name);
                                    const designation = s.contact_designation || (s.contacts && s.contacts[0]?.designation);
                                    return (
                                      <div>
                                        <div style={{ fontWeight: 600, color: "#1e293b", fontSize: "12.5px", textTransform: "uppercase" }}>
                                          {name ? `${salutation}${name}`.trim() : "—"}
                                        </div>
                                        <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px", textTransform: "uppercase" }}>
                                          {designation || "—"}
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </td>
                              );
                            case 4: // Contact (Direct)
                              return (
                                <td key="cell-4" style={getFreezeStyle(4, false)}>
                                  {(() => {
                                    const phone = s.contact_calling_number || (s.contacts && s.contacts[0]?.calling_number);
                                    const wa = s.contact_whatsapp_number || (s.contacts && (s.contacts[0]?.whatsapp_number || s.contacts[0]?.calling_number));
                                    return (
                                      <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                        {phone ? (
                                          <a
                                            href={`tel:${phone}`}
                                            style={{
                                              color: "#0284c7",
                                              textDecoration: "none",
                                              fontSize: "12px",
                                              fontWeight: 600,
                                              display: "inline-flex",
                                              alignItems: "center",
                                              gap: "4px",
                                            }}
                                          >
                                            <span style={{ fontSize: "11px" }}>📞</span> {phone}
                                          </a>
                                        ) : null}
                                        {wa ? (
                                          <a
                                            href={`https://wa.me/${wa.replace(/[^0-9]/g, "")}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            style={{
                                              color: "#16a34a",
                                              textDecoration: "none",
                                              fontSize: "12px",
                                              fontWeight: 600,
                                              display: "inline-flex",
                                              alignItems: "center",
                                              gap: "4px",
                                            }}
                                          >
                                            <span style={{ fontSize: "11px" }}>🟢</span> {wa}
                                          </a>
                                        ) : null}
                                        {!phone && !wa && <span style={{ color: "#94a3b8" }}>—</span>}
                                      </div>
                                    );
                                  })()}
                                </td>
                              );
                            case 5: // Area / City
                              return (
                                <td key="cell-5" style={getFreezeStyle(5, false)}>
                                  <div>
                                    <div style={{ fontWeight: 600, color: "#1e293b", fontSize: "12.5px" }}>
                                      {s.area || "—"}
                                    </div>
                                    <div style={{ fontSize: "12px", color: "#475569", marginTop: "2px" }}>
                                      {resolver.get("cities", s.city_id) || "—"}
                                    </div>
                                  </div>
                                </td>
                              );
                            case 6: // Dist. / State
                              return (
                                <td key="cell-6" style={getFreezeStyle(6, false)}>
                                  <div>
                                    <div style={{ fontWeight: 600, color: "#1e293b", fontSize: "12.5px" }}>
                                      {s.district || "—"}
                                    </div>
                                    <div style={{ fontSize: "12px", color: "#475569", marginTop: "2px" }}>
                                      {resolver.get("states", s.state_id) || "—"}
                                    </div>
                                  </div>
                                </td>
                              );
                            case 7: // Curr. Status
                              return (
                                <td key="cell-7" style={getFreezeStyle(7, false)}>
                                  <StatusPill value={s.current_status} />
                                </td>
                              );
                            case 8: // Bus. Type
                              return (
                                <td key="cell-8" style={getFreezeStyle(8, false)}>
                                  {s.company_type ? s.company_type : <span className="muted">—</span>}
                                </td>
                              );
                            case 9: // Grade
                              return (
                                <td key="cell-9" style={getFreezeStyle(9, false)}>
                                  {canEditGrade ? (
                                    <select
                                      className="inline-select"
                                      value={s.company_grade || ""}
                                      onChange={(e) =>
                                        handleInlineUpdate(s.id, `/companies/${s.id}/grade`, {
                                          company_grade: e.target.value || null,
                                        })
                                      }
                                      style={{
                                        padding: "4px 8px",
                                        borderRadius: "5px",
                                        border: "1px solid #cbd5e1",
                                        fontSize: "12px",
                                        background: "#ffffff",
                                        cursor: "pointer",
                                      }}
                                    >
                                      <option value="">Select</option>
                                      <option value="A">A</option>
                                      <option value="B">B</option>
                                      <option value="C">C</option>
                                    </select>
                                  ) : (
                                    <span>{s.company_grade || "—"}</span>
                                  )}
                                </td>
                              );
                            case 10: // Potential
                              return (
                                <td key="cell-10" style={getFreezeStyle(10, false)}>
                                  {canEditPotential ? (
                                    <select
                                      className="inline-select"
                                      value={s.potential ? s.potential.toLowerCase() : ""}
                                      onChange={(e) =>
                                        handleInlineUpdate(s.id, `/companies/${s.id}/potential`, {
                                          potential: e.target.value || null,
                                        })
                                      }
                                      style={{
                                        padding: "4px 8px",
                                        borderRadius: "5px",
                                        border: "1px solid #cbd5e1",
                                        fontSize: "12px",
                                        background: "#ffffff",
                                        cursor: "pointer",
                                      }}
                                    >
                                      <option value="">Select</option>
                                      <option value="yes">Yes</option>
                                      <option value="no">No</option>
                                    </select>
                                  ) : (
                                    <span>{s.potential ? (s.potential.toLowerCase() === "yes" ? "Yes" : s.potential.toLowerCase() === "no" ? "No" : s.potential) : "—"}</span>
                                  )}
                                </td>
                              );
                            case 11: // Mac. Buying From
                              return (
                                <td key="cell-11" style={getFreezeStyle(11, false)}>
                                  {s.machines_buying_from || <span className="muted">—</span>}
                                </td>
                              );
                            case 12: // P1 To Buy From Us
                              return (
                                <td key="cell-12" style={getFreezeStyle(12, false)}>
                                  {s.products_interested || s.product_manufacture_or_supply || <span className="muted">—</span>}
                                </td>
                              );
                            case 13: // Sales Per. / Added On
                              return (
                                <td key="cell-13" style={getFreezeStyle(13, false)}>
                                  {(() => {
                                    const sp = filterSalesPersons.find((u) => u.id === s.sales_person_id) || salesPersons.find((u) => u.id === s.sales_person_id);
                                    const spName = sp ? (sp.full_name || sp.username) : (s.sales_person_id ? "Assigned" : "—");
                                    return (
                                      <div>
                                        <div style={{ fontWeight: 600, color: "#1e293b", fontSize: "12px" }}>
                                          {spName}
                                        </div>
                                        <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
                                          {formatDateDMY((s as any).created_at)}
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </td>
                              );
                            case 14: // Action
                              return (
                                <td key="cell-14" className="actions" style={{ textAlign: "center", ...getFreezeStyle(14, false) }}>
                                  <div style={{ display: "flex", gap: "6px", justifyContent: "center", alignItems: "center" }}>
                                    {canUpdate && (
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
                                        onClick={() => handleRowEdit(s.id)}
                                        title="Edit Company"
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                        </svg>
                                      </button>
                                    )}
                                    {canDelete && (() => {
                                      const isEligibleForDelete =
                                        (!s.current_status || s.current_status.toLowerCase() === "new") &&
                                        (!s.potential || s.potential.toLowerCase() === "no");
                                      if (!isEligibleForDelete) return null;
                                      return (
                                        <button
                                          type="button"
                                          className="btn"
                                          disabled={isRowActionPending(`delete:${s.id}`)}
                                          style={{
                                            background: "#ef4444",
                                            color: "#ffffff",
                                            padding: "6px 8px",
                                            borderRadius: "4px",
                                            border: "none",
                                            cursor: isRowActionPending(`delete:${s.id}`) ? "default" : "pointer",
                                            opacity: isRowActionPending(`delete:${s.id}`) ? 0.6 : 1,
                                            display: "inline-flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                          }}
                                          onClick={() => {
                                            void handleRowDelete(s.id);
                                          }}
                                          title="Delete Company"
                                        >
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="3 6 5 6 21 6" />
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                            <line x1="10" y1="11" x2="10" y2="17" />
                                            <line x1="14" y1="11" x2="14" y2="17" />
                                          </svg>
                                        </button>
                                      );
                                    })()}
                                  </div>
                                </td>
                              );
                            default:
                              return null;
                          }
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <Pagination
                pagination={pagination}
                pageSize={pageSize}
                onPageChange={setCurrentPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setCurrentPage(1);
                }}
              />
            </div>
          </div>
        </main>
      )}

      <ModalAlert
        isOpen={Boolean(alertPopup)}
        title={alertPopup?.title}
        message={alertPopup?.message || ""}
        onClose={() => {
          setAlertPopup(null);
          const errKeys = Object.keys(validationErrors).filter((k) => validationErrors[k]);
          if (errKeys.length > 0) {
            setTimeout(() => focusAndScrollToField(errKeys[0]), 50);
          }
        }}
      />

      {drawerCompany && (
        <SideDrawer
          open={Boolean(drawerCompany)}
          title={`Company Detail #${drawerCompany.company_name}`}
          subtitle={`Company Type: ${drawerCompany.company_type || "—"} | Status: ${drawerCompany.is_active ? "Active" : "Inactive"}`}
          onClose={handleCloseDrawer}
          onEdit={
            canUpdate
              ? () => {
                const id = drawerCompany.id;
                handleCloseDrawer();
                void handleRowEdit(id);
              }
              : undefined
          }
          editLabel="✏️ Edit Company"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <DetailFieldGrid
              fields={[
                { label: "Company Name", value: drawerCompany.company_name, fullWidth: true },
                { label: "Company Type", value: drawerCompany.company_type || "—" },
                { label: "GST No Of Company", value: drawerCompany.tax_id_number || "—" },
                { label: "Brand Description", value: drawerCompany.brand_description || "—" },
                { label: "Area", value: drawerCompany.area || "—" },
                { label: "District", value: drawerCompany.district || "—" },
                { label: "Country", value: resolver.get("countries", drawerCompany.country_id) || "—" },
                { label: "Province / State", value: resolver.get("states", drawerCompany.state_id) || "—" },
                { label: "City", value: resolver.get("cities", drawerCompany.city_id) || "—" },
                { label: "Product Categories", value: chipList(drawerCompany.category_ids, "categories"), fullWidth: true },
                { label: "Sub-Categories", value: chipList(drawerCompany.sub_category_ids, "subCategories"), fullWidth: true },
                { label: "Products Supplied", value: chipList(drawerCompany.product_ids, "products"), fullWidth: true },
                { label: "Secondary Products", value: drawerCompany.secondary_products_description || "—", fullWidth: true },
                { label: "Address", value: drawerCompany.address || "—", fullWidth: true },
              ]}
            />

            <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
              <h4 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 12px 0", color: "#0f172a" }}>
                Primary Contact Information
              </h4>
              <DetailFieldGrid
                fields={[
                  {
                    label: "Full Name",
                    value: `${drawerCompany.contact_salutation || ""} ${drawerCompany.contact_full_name || ""}`.trim() || "—",
                  },
                  { label: "Designation", value: drawerCompany.contact_designation || "—" },
                  { label: "Calling Number", value: drawerCompany.contact_calling_number || "—" },
                  { label: "WhatsApp Number", value: drawerCompany.contact_whatsapp_number || "—" },
                  { label: "WeChat Number", value: drawerCompany.contact_wechat_number || "—" },
                  { label: "Email Addresses", value: drawerCompany.emails && drawerCompany.emails.length ? drawerCompany.emails.join(", ") : "—", fullWidth: true },
                  { label: "Primary Website", value: drawerCompany.primary_website || "—" },
                  { label: "Secondary Website", value: drawerCompany.secondary_website || "—" },
                ]}
              />
              {drawerCompany.contacts && drawerCompany.contacts.length > 0 && (
                <div style={{ marginTop: "16px", borderTop: "1px solid #e2e8f0", paddingTop: "12px" }}>
                  <h5 style={{ fontSize: "12.5px", fontWeight: 700, margin: "0 0 10px 0", color: "#475569" }}>
                    Other Contacts
                  </h5>
                  {drawerCompany.contacts.map((c) => (
                    <div
                      key={c.id}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: "13px" }}
                    >
                      <span>
                        {c.salutation ? `${c.salutation} ` : ""}
                        {c.person_name}
                        {c.designation ? ` — ${c.designation}` : ""}
                        {computeAge(c.birth_date) !== null && ` (Age ${computeAge(c.birth_date)})`}
                      </span>
                      <span style={{ color: "#64748b" }}>{c.calling_number || "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <DetailFieldGrid
              fields={[
                { label: "Company Grade", value: drawerCompany.company_grade || "—" },
                { label: "Current Status", value: <StatusPill value={drawerCompany.current_status} /> },
                { label: "Potential", value: drawerCompany.potential || "—" },
                ...(showsPotentialReason(drawerCompany.potential || "")
                  ? [{ label: "Potential Reason", value: drawerCompany.potential_reason || "—" }]
                  : []),
                ...(showsPotentialBusinessPerMonth(drawerCompany.potential || "")
                  ? [{ label: "Potential Business / Month", value: drawerCompany.potential_business_per_month || "—" }]
                  : []),
                ...(showsMonthlyTurnover(drawerCompany.company_type || "")
                  ? [{ label: "Monthly Turnover", value: drawerCompany.monthly_turnover || "—" }]
                  : []),
                ...(showsDirectImportCluster(drawerCompany.company_type || "")
                  ? [{ label: "Direct Import From China", value: drawerCompany.direct_import_from_china || "—" }]
                  : []),
                ...(showsImportSubFields(drawerCompany.company_type || "", drawerCompany.direct_import_from_china || "")
                  ? [
                    { label: "Monthly Import Volume", value: drawerCompany.monthly_import_volume || "—" },
                    { label: "Products Needed For Imports", value: drawerCompany.products_needed_for_imports || "—", fullWidth: true },
                  ]
                  : []),
                { label: "Visited Factory/Office", value: drawerCompany.visited_factory_office ? "Yes" : "No" },
                { label: "Overall Remarks", value: drawerCompany.overall_remarks || "—", fullWidth: true },
              ]}
            />
          </div>
        </SideDrawer>
      )}

      {/* Quick Add SideDrawer - EXACT layout matching user screenshot */}
      <div
        className={`side-drawer-backdrop ${quickDrawerOpen ? "open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setQuickDrawerOpen(false);
        }}
        style={{ zIndex: 1500 }}
      >
        <div
          className="side-drawer-card"
          style={{
            width: "100%",
            maxWidth: "720px",
            height: "100vh",
            background: "#ffffff",
            display: "flex",
            flexDirection: "column",
            boxShadow: "-10px 0 25px rgba(0,0,0,0.15)",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "16px 24px",
              borderBottom: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#ffffff",
            }}
          >
            <h2 style={{ margin: 0, fontSize: "17.5px", fontWeight: 700, color: "#1e293b" }}>
              Add Company
            </h2>
            <button
              type="button"
              onClick={() => setQuickDrawerOpen(false)}
              style={{
                background: "none",
                border: "none",
                fontSize: "22px",
                color: "#64748b",
                cursor: "pointer",
                lineHeight: 1,
                padding: "4px 8px",
              }}
              title="Close"
            >
              ✕
            </button>
          </div>

          {/* Quick Alert Banner */}
          {quickAlert && (
            <div
              style={{
                margin: "12px 24px 0",
                padding: "10px 14px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: 500,
                background: quickAlert.type === "success" ? "#f0fdf4" : quickAlert.type === "error" ? "#fef2f2" : "#f0f9ff",
                color: quickAlert.type === "success" ? "#166534" : quickAlert.type === "error" ? "#991b1b" : "#0369a1",
                border: `1px solid ${quickAlert.type === "success" ? "#bbf7d0" : quickAlert.type === "error" ? "#fecaca" : "#bae6fd"}`,
              }}
            >
              {quickAlert.message}
            </div>
          )}

          {/* Form Body: Exactly the 14 fields from user screenshot */}
          <div
            style={{
              padding: "18px 24px 20px",
              flex: 1,
              overflowY: "auto",
              overflowX: "hidden",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              columnGap: "20px",
              rowGap: "14px",
              alignContent: "start",
              boxSizing: "border-box",
              width: "100%",
            }}
          >
            {/* 1. Company Name * (full width) */}
            <div style={{ gridColumn: "span 2", minWidth: 0 }}>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "5px" }}>
                Company Name <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <CompanyNameAutocomplete
                id="quick_company_name"
                value={quickForm.company_name}
                onChange={(val) => {
                  setQuickForm((p) => ({ ...p, company_name: val }));
                  if (quickErrors.company_name) setQuickErrors((p) => ({ ...p, company_name: "" }));
                }}
                onSelectCompany={(comp) => {
                  setQuickForm((p) => ({
                    ...p,
                    company_name: comp.company_name,
                    company_type: comp.company_type || p.company_type,
                    tax_id_number: comp.tax_id_number || p.tax_id_number,
                    area: comp.area || p.area,
                    state_id: comp.state_id || p.state_id,
                    district: comp.district || p.district,
                    city_id: comp.city_id || p.city_id,
                    contact_salutation: comp.contact_salutation || p.contact_salutation,
                    contact_full_name: comp.contact_full_name || p.contact_full_name,
                    contact_designation: comp.contact_designation || p.contact_designation,
                    contact_calling_number: comp.contact_calling_number || p.contact_calling_number,
                    contact_whatsapp_number: comp.contact_whatsapp_number || p.contact_whatsapp_number,
                    contact_indiamart_number: comp.contact_indiamart_number || p.contact_indiamart_number,
                    primary_website: comp.primary_website || p.primary_website,
                    sales_person_id: comp.sales_person_id || p.sales_person_id,
                  }));
                  if (quickErrors.company_name) setQuickErrors((p) => ({ ...p, company_name: "" }));
                }}
                hasError={Boolean(quickErrors.company_name)}
                errorMessage={quickErrors.company_name}
                preloadedCompanies={rows}
                placeholder="Enter company name"
              />
            </div>

            {/* 2. Business Type */}
            <div style={{ minWidth: 0 }}>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "5px" }}>
                Business Type
              </label>
              <SelectWithSearch
                id="quick_company_type"
                value={quickForm.company_type}
                placeholder="Select"
                options={[
                  { value: "B2B", label: "B2B" },
                  { value: "B2C", label: "B2C" },
                ]}
                onChange={(val) => setQuickForm((p) => ({ ...p, company_type: val }))}
              />
            </div>

            {/* 3. GST No Of Company * */}
            <div style={{ minWidth: 0 }}>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "5px" }}>
                GST No Of Company <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <div style={{ display: "flex", gap: "6px", width: "100%", minWidth: 0 }}>
                <input
                  type="text"
                  autoComplete="off"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: "36px",
                    border: quickErrors.tax_id_number ? "1px solid #ef4444" : "1px solid #cbd5e1",
                    borderRadius: "4px",
                    padding: "0 10px",
                    fontSize: "13.5px",
                    textTransform: "uppercase",
                    boxSizing: "border-box",
                    outline: "none",
                  }}
                  value={quickForm.tax_id_number}
                  onChange={(e) => {
                    setQuickForm((p) => ({ ...p, tax_id_number: e.target.value.toUpperCase() }));
                    if (quickErrors.tax_id_number) setQuickErrors((p) => ({ ...p, tax_id_number: "" }));
                  }}
                />
                <button
                  type="button"
                  onClick={handleFetchGstData}
                  disabled={quickGstFetching}
                  style={{
                    background: "#0061f2",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    padding: "0 14px",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    cursor: quickGstFetching ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap",
                    height: "36px",
                    flexShrink: 0,
                  }}
                >
                  {quickGstFetching ? "..." : "Fetch Data"}
                </button>
              </div>
              {quickErrors.tax_id_number && (
                <div style={{ color: "#ef4444", fontSize: "11.5px", marginTop: "3px" }}>{quickErrors.tax_id_number}</div>
              )}
            </div>

            {/* 4. Area */}
            <div style={{ minWidth: 0 }}>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "5px" }}>
                Area
              </label>
              <input
                type="text"
                autoComplete="off"
                style={{
                  width: "100%",
                  height: "36px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  padding: "0 10px",
                  fontSize: "13.5px",
                  boxSizing: "border-box",
                  outline: "none",
                }}
                value={quickForm.area}
                onChange={(e) => setQuickForm((p) => ({ ...p, area: e.target.value }))}
              />
            </div>

            {/* 5. State * */}
            <div style={{ minWidth: 0 }}>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "5px" }}>
                State <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <SelectWithSearch
                id="quick_state_id"
                value={quickForm.state_id}
                placeholder="Select"
                options={quickStates.map((s) => ({ value: s.id, label: s.name }))}
                hasError={Boolean(quickErrors.state_id)}
                onChange={(stateId) => {
                  setQuickForm((p) => ({ ...p, state_id: stateId, district: "", city_id: "" }));
                  if (quickErrors.state_id) setQuickErrors((p) => ({ ...p, state_id: "" }));
                }}
              />
              {quickErrors.state_id && (
                <div style={{ color: "#ef4444", fontSize: "11.5px", marginTop: "3px" }}>{quickErrors.state_id}</div>
              )}
            </div>

            {/* 6. District */}
            <div style={{ minWidth: 0 }}>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "5px" }}>
                District
              </label>
              <SelectWithSearch
                id="quick_district"
                value={quickForm.district}
                placeholder={!quickForm.state_id ? "Select State First" : "Select"}
                options={quickDistricts.map((d) => ({ value: d.name, label: d.name }))}
                allowCustom={true}
                disabled={!quickForm.state_id}
                onChange={(val, lbl) => setQuickForm((p) => ({ ...p, district: lbl || val, city_id: "" }))}
              />
            </div>

            {/* 7. City */}
            <div style={{ minWidth: 0 }}>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "5px" }}>
                City
              </label>
              <SelectWithSearch
                id="quick_city_id"
                value={quickForm.city_id}
                placeholder={!quickForm.district ? "Select District First" : "Select"}
                disabled={!quickForm.district}
                options={!quickForm.district ? [] : quickCities
                  .filter((c: any) => {
                    const matchedDist = quickDistricts.find((d) => d.name.toLowerCase() === quickForm.district.toLowerCase());
                    return !c.district_id || (matchedDist && c.district_id === matchedDist.id);
                  })
                  .map((c) => ({ value: c.id, label: c.name }))}
                allowCustom={true}
                onChange={async (cityVal, cityLabel) => {
                  await handleQuickCitySelectOrCustom(cityVal, cityLabel);
                }}
              />
            </div>

            {/* 8. Full Name (IndiaMart Or Other) */}
            <div style={{ minWidth: 0 }}>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "5px" }}>
                Full Name <em>(IndiaMart Or Other)</em>
              </label>
              <div style={{ display: "flex", gap: "6px", width: "100%", minWidth: 0 }}>
                <select
                  style={{
                    width: "68px",
                    flexShrink: 0,
                    height: "36px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    padding: "0 6px",
                    fontSize: "13.5px",
                    background: "#fff",
                    outline: "none",
                  }}
                  value={quickForm.contact_salutation}
                  onChange={(e) => setQuickForm((p) => ({ ...p, contact_salutation: e.target.value }))}
                >
                  <option value="Mr">Mr</option>
                  <option value="Mrs">Mrs</option>
                  <option value="Ms">Ms</option>
                  <option value="Dr">Dr</option>
                </select>
                <input
                  type="text"
                  autoComplete="off"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: "36px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    padding: "0 10px",
                    fontSize: "13.5px",
                    boxSizing: "border-box",
                    outline: "none",
                  }}
                  value={quickForm.contact_full_name}
                  onChange={(e) => setQuickForm((p) => ({ ...p, contact_full_name: e.target.value }))}
                />
              </div>
            </div>

            {/* 9. Designation */}
            <div style={{ minWidth: 0 }}>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "5px" }}>
                Designation
              </label>
              <input
                type="text"
                autoComplete="off"
                style={{
                  width: "100%",
                  height: "36px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  padding: "0 10px",
                  fontSize: "13.5px",
                  boxSizing: "border-box",
                  outline: "none",
                }}
                value={quickForm.contact_designation}
                onChange={(e) => setQuickForm((p) => ({ ...p, contact_designation: e.target.value }))}
              />
            </div>


            {/* 11. Contact Number */}
            <div style={{ minWidth: 0 }}>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "5px" }}>
                Contact Number
              </label>
              <input
                type="text"
                autoComplete="off"
                placeholder="Enter contact number"
                style={{
                  width: "100%",
                  height: "36px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  padding: "0 10px",
                  fontSize: "13.5px",
                  boxSizing: "border-box",
                  outline: "none",
                }}
                value={quickForm.contact_calling_number}
                onChange={(e) => setQuickForm((p) => ({ ...p, contact_calling_number: e.target.value }))}
              />
            </div>

            {/* 12. WhatsApp Number */}
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px" }}>
                <label style={{ fontSize: "12.5px", fontWeight: 600, color: "#334155", margin: 0 }}>
                  WhatsApp Number
                </label>
                <button
                  type="button"
                  onClick={handleCopyPrimary}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#0061f2",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: 0,
                    textDecoration: "underline",
                  }}
                >
                  Copy Primary
                </button>
              </div>
              <input
                type="text"
                autoComplete="off"
                style={{
                  width: "100%",
                  height: "36px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  padding: "0 10px",
                  fontSize: "13.5px",
                  boxSizing: "border-box",
                  outline: "none",
                }}
                value={quickForm.contact_whatsapp_number}
                onChange={(e) => setQuickForm((p) => ({ ...p, contact_whatsapp_number: e.target.value }))}
              />
            </div>

            {/* 13. Webpage (IndiaMart Or Other) */}
            <div style={{ minWidth: 0 }}>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "5px" }}>
                Webpage <em>(IndiaMart Or Other)</em>
              </label>
              <input
                type="text"
                autoComplete="off"
                style={{
                  width: "100%",
                  height: "36px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  padding: "0 10px",
                  fontSize: "13.5px",
                  boxSizing: "border-box",
                  outline: "none",
                }}
                value={quickForm.primary_website}
                onChange={(e) => setQuickForm((p) => ({ ...p, primary_website: e.target.value }))}
              />
            </div>

            {/* 14. Sales Person */}
            <div style={{ minWidth: 0 }}>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "5px" }}>
                Sales Person
              </label>
              <SelectWithSearch
                id="quick_sales_person"
                value={quickForm.sales_person_id}
                placeholder="Select Sales Person"
                options={effectiveSalesPersons.map((u) => ({ value: u.id, label: u.full_name || u.username }))}
                onChange={(val) => setQuickForm((p) => ({ ...p, sales_person_id: val }))}
              />
            </div>
          </div>

          {/* Sticky Action Footer */}
          <div
            style={{
              padding: "16px 24px",
              borderTop: "1px solid #e2e8f0",
              background: "#ffffff",
              display: "flex",
              gap: "12px",
              position: "sticky",
              bottom: 0,
              zIndex: 10,
            }}
          >
            <button
              type="button"
              disabled={quickSaving}
              onClick={() => handleQuickSave(false)}
              style={{
                flex: 1,
                background: "#0061f2",
                color: "#ffffff",
                border: "none",
                borderRadius: "4px",
                padding: "10px 16px",
                fontWeight: 600,
                fontSize: "13.5px",
                cursor: quickSaving ? "not-allowed" : "pointer",
                opacity: quickSaving ? 0.7 : 1,
              }}
            >
              {quickSaving ? "Saving..." : "Save & Continue"}
            </button>
            <button
              type="button"
              disabled={quickSaving}
              onClick={() => handleQuickSave(true)}
              style={{
                flex: 1,
                background: "#0061f2",
                color: "#ffffff",
                border: "none",
                borderRadius: "4px",
                padding: "10px 16px",
                fontWeight: 600,
                fontSize: "13.5px",
                cursor: quickSaving ? "not-allowed" : "pointer",
                opacity: quickSaving ? 0.7 : 1,
              }}
            >
              {quickSaving ? "Saving..." : "Save & Exit"}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}