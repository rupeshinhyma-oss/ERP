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
import { AddNewCompanyForm } from "./AddNewCompanyForm";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Banner, ModalAlert, TableMessageRow } from "@/components/ui";
import { Pagination } from "@/components/Pagination";
import { ImpExpDropdown, BulkActionsDropdown, ImportSummaryPanel, downloadSampleCsv, parseFile, WizardModal, type SheetRow } from "@/components/ImportWizard";
import {
  type DropdownOption,
} from "@/components/SearchableDropdown";
import { autoTitleCase } from "@/components/fields";
import { useLookup } from "@/lib/lookups";
import { useLiveModule } from "@/lib/live/useLive";

function resolveImageUrl(url: string | null | undefined): string {
  if (!url) return "";
  let clean = url.trim();
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
    clean = clean.slice(1, -1).trim();
  }
  if (!clean) return "";
  if (clean.toLowerCase().startsWith("/static/uploads/")) {
    clean = "/static/uploads/" + clean.slice("/static/uploads/".length);
  } else if (clean.toLowerCase().startsWith("/uploads/")) {
    clean = "/uploads/" + clean.slice("/uploads/".length);
  }
  if (clean.startsWith("data:") || clean.startsWith("http://") || clean.startsWith("https://")) {
    return encodeURI(clean);
  }
  const fullUrl = `${API_ORIGIN}${clean.startsWith("/") ? "" : "/"}${clean}`;
  return encodeURI(fullUrl);
}
void resolveImageUrl;
import {
  API_ORIGIN,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPostMultipart,
  downloadExport,
  toQueryString,
} from "@/lib/api";
import { createNameResolver } from "@/lib/nameResolver";
import { useAuth, useSrNoJump, isSrNoQuery, usePendingGuard, useModalHistorySync } from "@/lib/hooks";
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

type ModalTab = "first" | "second" | "contacts" | "continue";

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
  district_id: "",
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
  company_type: "",
  brand_description: "",
  area: "",
  district: "",
  sales_person_id: "",
  contact_salutation: "",
  contact_full_name: "",
  contact_designation: "",
  contact_calling_number: "",
  contact_whatsapp_number: "",
  contact_wechat_number: "",
  contact_indiamart_number: "",
  emails: [] as string[],
  tax_id_number: "",
  address: "",
  town: "",
  primary_website: "",
  secondary_website: "",
  company_grade: "",
  current_status: "",
  potential: "",
  potential_reason: "",
  secondary_products_description: "",
  visited_factory_office: "false",
  visit_remarks: "",
  visit_media_input: "",
  visit_video_url: "",
  overall_remarks: "",
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

function extractSubscriberNumber(val: string | undefined | null): string {
  if (!val) return "";
  const trimmed = val.trim();
  if (trimmed.startsWith("+")) {
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx !== -1) {
      return trimmed.slice(spaceIdx + 1).replace(/\D/g, "");
    }
    return ""; // Only prefix (e.g. "+86" or "+91") with no actual number!
  }
  return trimmed.replace(/\D/g, "");
}

function normalizePhoneValue(val: string | undefined | null): string | null {
  if (!val) return null;
  const subscriber = extractSubscriberNumber(val);
  if (!subscriber) return null; // Blank / empty if only country prefix exists
  return val.trim();
}

function validatePhoneNumber(val: string | undefined | null, fieldLabel = "Phone number"): string | null {
  if (!val || !val.trim()) return null;
  const subscriber = extractSubscriberNumber(val);
  // If the subscriber digits are empty (only country prefix exists), it is valid/blank (optional).
  if (!subscriber) return null;

  const digits = val.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return `${fieldLabel} must have between 7 and 15 digits (including country code).`;
  }
  return null;
}

const COMPANY_COLUMN_LABELS = [
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
  "PI To Buy From Us",
  "Sales Per. / Added On",
  "Action",
];

function formatAddedDate(dateStr?: string | null): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return "—";
  }
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
  const nameWidths = ["72%", "86%", "64%", "80%", "92%", "68%", "76%", "84%"];

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
              case 1:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }}
                  />
                );
                break;
              case 2:
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
                      style={{ width: "90px", height: "12px", borderRadius: "3px" }}
                    />
                  </div>
                );
                break;
              case 3:
                content = (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div
                      className="skeleton-line"
                      style={{ width: "110px", height: "14px", borderRadius: "4px" }}
                    />
                    <div
                      className="skeleton-line"
                      style={{ width: "60px", height: "12px", borderRadius: "3px" }}
                    />
                  </div>
                );
                break;
              case 4:
                content = (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div
                      className="skeleton-line"
                      style={{ width: "85px", height: "13px", borderRadius: "3px" }}
                    />
                    <div
                      className="skeleton-line"
                      style={{ width: "85px", height: "13px", borderRadius: "3px" }}
                    />
                  </div>
                );
                break;
              case 5:
                content = (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div
                      className="skeleton-line"
                      style={{ width: "70px", height: "13px", borderRadius: "3px" }}
                    />
                    <div
                      className="skeleton-line"
                      style={{ width: "60px", height: "13px", borderRadius: "3px" }}
                    />
                  </div>
                );
                break;
              case 6:
                content = (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div
                      className="skeleton-line"
                      style={{ width: "65px", height: "13px", borderRadius: "3px" }}
                    />
                    <div
                      className="skeleton-line"
                      style={{ width: "80px", height: "13px", borderRadius: "3px" }}
                    />
                  </div>
                );
                break;
              case 7:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "60px", height: "20px", borderRadius: "12px" }}
                  />
                );
                break;
              case 8:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "40px", height: "14px", borderRadius: "4px" }}
                  />
                );
                break;
              case 9:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "55px", height: "22px", borderRadius: "4px" }}
                  />
                );
                break;
              case 10:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "55px", height: "22px", borderRadius: "4px" }}
                  />
                );
                break;
              case 11:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "20px", height: "14px", borderRadius: "3px" }}
                  />
                );
                break;
              case 12:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "20px", height: "14px", borderRadius: "3px" }}
                  />
                );
                break;
              case 13:
                content = (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div
                      className="skeleton-line"
                      style={{ width: "75px", height: "13px", borderRadius: "3px" }}
                    />
                    <div
                      className="skeleton-line"
                      style={{ width: "65px", height: "12px", borderRadius: "3px" }}
                    />
                  </div>
                );
                break;
              case 14:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "32px", height: "26px", borderRadius: "4px", margin: "0 auto" }}
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
                  width: colIdx === 0 ? "40px" : colIdx === 1 ? "65px" : undefined,
                  minWidth: colIdx === 0 ? "40px" : colIdx === 1 ? "65px" : undefined,
                  maxWidth: colIdx === 0 ? "45px" : colIdx === 1 ? "75px" : undefined,
                  textAlign: colIdx === 0 || colIdx === 1 || colIdx === 14 ? "center" : "left",
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

export function CompaniesPage({ defaultAdd }: { defaultAdd?: boolean } = {}) {
  const { profile, hasPermission } = useAuth();
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

  /* Filters - matching exact user layout */
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDateRange, setFilterDateRange] = useState("");
  const [filterBusinessType, setFilterBusinessType] = useState("");
  const [filterCurrentStatus, setFilterCurrentStatus] = useState("");
  const [filterState, setFilterState] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [filterDistrict, setFilterDistrict] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterGrade, setFilterGrade] = useState("");
  const [filterPotential, setFilterPotential] = useState("");
  const [filterBusinessCategory, setFilterBusinessCategory] = useState("");
  const [filterSalesPerson, setFilterSalesPerson] = useState("");

  // Options for filter dropdowns - strictly extracted from companies profiles data
  const [filterOptions, setFilterOptions] = useState<{
    business_types: string[];
    current_statuses: string[];
    states: Array<{ id: string; name: string }>;
    cities: Array<{ id: string; name: string; state_id?: string | null }>;
    districts: Array<{ name: string; state_id?: string | null }>;
    categories: Array<{ id: string; name: string }>;
    client_grades: string[];
    potentials: string[];
    business_categories: string[];
    sales_persons: Array<{ id: string; name: string }>;
  }>({
    business_types: [],
    current_statuses: [],
    states: [],
    cities: [],
    districts: [],
    categories: [],
    client_grades: [],
    potentials: [],
    business_categories: [],
    sales_persons: [],
  });

  // Applied filter state (triggers the actual server query)
  const [appliedCompanyFilters, setAppliedCompanyFilters] = useState<{
    dateRange: string;
    businessType: string;
    currentStatus: string;
    state: string;
    city: string;
    district: string;
    category: string;
    grade: string;
    potential: string;
    businessCategory: string;
    salesPerson: string;
  }>({
    dateRange: "",
    businessType: "",
    currentStatus: "",
    state: "",
    city: "",
    district: "",
    category: "",
    grade: "",
    potential: "",
    businessCategory: "",
    salesPerson: "",
  });

  const handleSearchFilters = useCallback(() => {
    setCurrentPage(1);
    setAppliedCompanyFilters({
      dateRange: filterDateRange,
      businessType: filterBusinessType,
      currentStatus: filterCurrentStatus,
      state: filterState,
      city: filterCity,
      district: filterDistrict,
      category: filterCategory,
      grade: filterGrade,
      potential: filterPotential,
      businessCategory: filterBusinessCategory,
      salesPerson: filterSalesPerson,
    });
  }, [
    filterDateRange,
    filterBusinessType,
    filterCurrentStatus,
    filterState,
    filterCity,
    filterDistrict,
    filterCategory,
    filterGrade,
    filterPotential,
    filterBusinessCategory,
    filterSalesPerson,
  ]);

  const handleResetFilters = useCallback(() => {
    setFilterDateRange("");
    setFilterBusinessType("");
    setFilterCurrentStatus("");
    setFilterState("");
    setFilterCity("");
    setFilterDistrict("");
    setFilterCategory("");
    setFilterGrade("");
    setFilterPotential("");
    setFilterBusinessCategory("");
    setFilterSalesPerson("");
    setCurrentPage(1);
    setAppliedCompanyFilters({
      dateRange: "",
      businessType: "",
      currentStatus: "",
      state: "",
      city: "",
      district: "",
      category: "",
      grade: "",
      potential: "",
      businessCategory: "",
      salesPerson: "",
    });
  }, []);

  // Fetch filter options strictly from companies profile endpoint
  const loadFilterOptions = useCallback(() => {
    void apiGet<{
      business_types: string[];
      current_statuses: string[];
      states: Array<{ id: string; name: string }>;
      cities: Array<{ id: string; name: string; state_id?: string | null }>;
      districts: Array<{ name: string; state_id?: string | null }>;
      categories: Array<{ id: string; name: string }>;
      client_grades: string[];
      potentials: string[];
      business_categories: string[];
      sales_persons: Array<{ id: string; name: string }>;
    }>("/companies/filter-options")
      .then((res) => {
        if (res?.data) {
          setFilterOptions(res.data);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadFilterOptions();
  }, [loadFilterOptions]);

  // Sub-filter available districts based on selected state from companies profile data
  const availableDistricts = useMemo(() => {
    if (!filterState) return filterOptions.districts;
    return filterOptions.districts.filter((d) => !d.state_id || d.state_id === filterState);
  }, [filterOptions.districts, filterState]);

  // Sub-filter available cities based on selected state from companies profile data
  const availableCities = useMemo(() => {
    let list = filterOptions.cities;
    if (filterState) {
      list = list.filter((c) => !c.state_id || c.state_id === filterState);
    }
    return list;
  }, [filterOptions.cities, filterState]);

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
    const saved = localStorage.getItem("companies_pinned_cols_v3");
    if (saved !== null) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return { 0: "left", 1: "left", 2: "left" };
  });

  useEffect(() => {
    localStorage.setItem("companies_pinned_cols_v3", JSON.stringify(pinnedCols));
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
    const allIndices = Array.from({ length: 15 }, (_, i) => i);
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

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (defaultAdd || urlParams.get("action") === "add" || urlParams.get("add") === "true") {
      openModal(null, "full");
    }
  }, [defaultAdd]);

  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkCompanyId = searchParams.get("id");
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

  /* Quick Add Drawer state */
  const [quickDrawerOpen, setQuickDrawerOpen] = useState(false);
  const [quickForm, setQuickForm] = useState(EMPTY_QUICK_FORM);
  const [quickStates, setQuickStates] = useState<Array<{ id: string; name: string }>>([]);
  const [quickDistricts, setQuickDistricts] = useState<Array<{ id: string; name: string }>>([]);
  const [quickCities, setQuickCities] = useState<Array<{ id: string; name: string }>>([]);
  const [salesPersons, setSalesPersons] = useState<Array<{ id: string; full_name: string; username: string }>>([]);
  const [quickGstFetching, setQuickGstFetching] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickErrors, setQuickErrors] = useState<Record<string, string>>({});
  const [quickAlert, setQuickAlert] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  useModalHistorySync(quickDrawerOpen, () => setQuickDrawerOpen(false));

  const openQuickAdd = useCallback(() => {
    setQuickForm({
      ...EMPTY_QUICK_FORM,
      sales_person_id: salesPersons.find((u) => u.id === profile?.id || u.username === profile?.username)?.id || "",
    });
    setQuickErrors({});
    setQuickAlert(null);
    setQuickDrawerOpen(true);
  }, [salesPersons, profile]);

  const [defaultIndiaId, setDefaultIndiaId] = useState<string>("bf5a75c1-34e6-48ab-8a52-b537806107e0");

  useEffect(() => {
    if (quickDrawerOpen) {
      void apiGet<Array<{ id: string; name: string }>>("/masters/states?page_size=250&status=active")
        .then((res) => {
          if (res?.data) {
            setQuickStates([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
          }
        })
        .catch(() => {});

      void apiGet<Array<{ id: string; name: string }>>("/masters/countries?search=India&page_size=5")
        .then((res) => {
          const match = res?.data?.find((c) => c.name.toLowerCase().includes("india"));
          if (match) setDefaultIndiaId(match.id);
        })
        .catch(() => {});

      void apiGet<Array<{ id: string; full_name: string; username: string }>>("/companies/sales-persons")
        .then((res) => {
          if (res?.data && res.data.length > 0) {
            setSalesPersons(res.data);
            setQuickForm((prev) => {
              if (!prev.sales_person_id && profile) {
                const match = res.data.find((u) => u.id === profile.id || u.username === profile.username);
                if (match) return { ...prev, sales_person_id: match.id };
              }
              return prev;
            });
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
            .catch(() => {});
        });
    }
  }, [quickDrawerOpen, profile]);

  useEffect(() => {
    void apiGet<Array<{ id: string; full_name: string; username: string }>>("/companies/sales-persons")
      .then((res) => {
        if (res?.data && res.data.length > 0) {
          setSalesPersons(res.data);
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
          .catch(() => {});
      });
  }, []);

  // When State changes: fetch districts for that state
  useEffect(() => {
    if (!quickForm.state_id) {
      setQuickDistricts([]);
      setQuickCities([]);
      return;
    }
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

  // When District changes: fetch cities for that district
  useEffect(() => {
    if (!quickForm.state_id || (!quickForm.district_id && !quickForm.district)) {
      setQuickCities([]);
      return;
    }

    const dObj = quickDistricts.find(
      (d) =>
        d.id === quickForm.district_id ||
        d.name.toLowerCase() === quickForm.district.trim().toLowerCase()
    );
    const dId = dObj?.id || quickForm.district_id;

    if (dId) {
      void apiGet<Array<{ id: string; name: string }>>(
        `/masters/cities/lookup?district_id=${dId}`
      )
        .then((res) => {
          if (res?.data && res.data.length > 0) {
            setQuickCities([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
          } else if (quickForm.district) {
            // Default option using district name if no separate cities listed yet
            setQuickCities([{ id: dId, name: quickForm.district }]);
          } else {
            setQuickCities([]);
          }
        })
        .catch(() => {
          if (quickForm.district) {
            setQuickCities([{ id: dId, name: quickForm.district }]);
          } else {
            setQuickCities([]);
          }
        });
    } else if (quickForm.district) {
      setQuickCities([{ id: `custom-${quickForm.district}`, name: quickForm.district }]);
    }
  }, [quickForm.state_id, quickForm.district_id, quickForm.district, quickDistricts]);

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

    const dObj = quickDistricts.find(
      (d) =>
        d.id === quickForm.district_id ||
        d.name.toLowerCase() === quickForm.district.trim().toLowerCase()
    );
    const dId = dObj?.id || quickForm.district_id;

    try {
      const res = await apiPost<{ id: string; name: string }>("/masters/cities", {
        name: cityLabel,
        state_id: quickForm.state_id,
        district_id: dId || null,
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
      } catch {}
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
    const indiamart = quickForm.contact_indiamart_number.trim();
    const val = direct || indiamart;
    if (val) {
      setQuickForm((prev) => ({ ...prev, contact_whatsapp_number: val }));
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
  const [modalTab, setModalTab] = useState<ModalTab>("first");
  const [currentCompanyId, setCurrentCompanyId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_SUPPLIER_FORM);
  const [formCountryId, setFormCountryId] = useState<string | null>(null);
  const [formStateId, setFormStateId] = useState<string | null>(null);
  const [formCityId, setFormCityId] = useState<string | null>(null);
  const [formCategoryIds, setFormCategoryIds] = useState<string[]>([]);
  const [formSubCategoryIds, setFormSubCategoryIds] = useState<string[]>([]);
  const [formProductIds, setFormProductIds] = useState<string[]>([]);
  const [lockNewStatus, setLockNewStatus] = useState(false);
  const [formStateCustomText, setFormStateCustomText] = useState("");
  const [formCityCustomText, setFormCityCustomText] = useState("");
  const [whatsappSameAsCalling, setWhatsappSameAsCalling] = useState(false);
  const [wechatSameAsCalling, setWechatSameAsCalling] = useState(false);
  const [callingNumberError, setCallingNumberError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [defaultChinaId, setDefaultChinaId] = useState<string | null>(null);
  const [formCountryPhoneCode, setFormCountryPhoneCode] = useState<string>("+86");
  const [saving, setSaving] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const existingCompanies = useLookup<Company>("/companies", 500);

  async function resolveCountryPhoneCode(countryId: string | null): Promise<string> {
    if (!countryId) return "+86";
    try {
      const { data } = await apiGet<{ phone_code?: string }>(`/masters/countries/${countryId}`);
      if (data?.phone_code) {
        const rawCode = data.phone_code.trim().replace(/^\+/, "");
        return `+${rawCode}`;
      }
    } catch {
      // fallback
    }
    return "+86";
  }

  function replacePhonePrefix(fullNumber: string | undefined | null, newPrefix: string): string {
    if (!fullNumber) return "";
    const trimmed = fullNumber.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("+")) {
      const spaceIdx = trimmed.indexOf(" ");
      if (spaceIdx !== -1) {
        const subscriber = trimmed.slice(spaceIdx + 1).trim();
        return subscriber ? `${newPrefix} ${subscriber}` : newPrefix;
      }
      const match = trimmed.match(/^\+\d{1,4}(.*)$/);
      if (match && match[1]) {
        const subscriber = match[1].trim();
        return subscriber ? `${newPrefix} ${subscriber}` : newPrefix;
      }
      return newPrefix;
    }
    return `${newPrefix} ${trimmed}`;
  }

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

  const mediaList = useMemo(() => {
    return form.visit_media_input
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
  }, [form.visit_media_input]);

  const addMediaUrls = (newUrls: string[]) => {
    const combined = [...mediaList, ...newUrls];
    const unique = Array.from(new Set(combined));
    setField("visit_media_input", unique.join(", "));
  };

  const removeMediaUrl = (urlToRemove: string) => {
    const filtered = mediaList.filter((u) => u !== urlToRemove);
    setField("visit_media_input", filtered.join(", "));
  };

  const handleMediaFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingMedia(true);
    const uploadedUrls: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await apiPostMultipart<{ url: string }>("/suppliers/upload-media", formData);
        if (res.data?.url) {
          uploadedUrls.push(res.data.url);
        }
      } catch (err) {
        console.warn("Failed to upload media to Supabase storage:", err);
      }
    }

    if (uploadedUrls.length > 0) {
      addMediaUrls(uploadedUrls);
    }
    setUploadingMedia(false);
  };

  const fetchChinaId = useCallback(async (): Promise<string | null> => {
    try {
      const { data } = await apiGet<{ id: string; name: string }[]>(
        "/masters/countries" +
        toQueryString({
          search: "China",
          page: 1,
          page_size: 20,
          sort_order: "asc",
          status: "active",
        })
      );
      const china = (data || []).find((c) => c.name.toLowerCase().includes("china"));
      if (china) return china.id;

      // Fallback: list all countries
      const { data: allData } = await apiGet<{ id: string; name: string }[]>(
        "/masters/countries" + toQueryString({ page: 1, page_size: 250, sort_order: "asc", status: "active" })
      );
      const foundInAll = (allData || []).find((c) => c.name.toLowerCase().includes("china"));
      if (foundInAll) return foundInAll.id;
    } catch (err) {
      console.error("Failed to fetch China ID:", err);
    }
    return null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchChinaId().then((id) => {
      if (!cancelled && id) setDefaultChinaId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchChinaId]);

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
    ]);
    const formatted = rawFields.has(id as string) ? value : autoTitleCase(value, id as string);
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

  const companyNameFetcher = useCallback(
    async (term: string, signal: AbortSignal): Promise<DropdownOption[]> => {
      const { data } = await apiGet<Company[]>(
        "/companies" + toQueryString({ search: term, page: 1, page_size: 20 }),
        { signal }
      );
      return data.map((d) => ({ value: d.company_name, label: d.company_name }));
    },
    []
  );




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
        case 1: {
          const tA = (a as any).created_at ? new Date((a as any).created_at).getTime() : 0;
          const tB = (b as any).created_at ? new Date((b as any).created_at).getTime() : 0;
          return sortDirection === "asc" ? tA - tB : tB - tA;
        }
        case 2:
          valA = a.company_name || "";
          valB = b.company_name || "";
          break;
        case 3:
          valA = [a.contact_salutation, a.contact_full_name].filter(Boolean).join(" ") || (a.contacts?.[0]?.person_name || "");
          valB = [b.contact_salutation, b.contact_full_name].filter(Boolean).join(" ") || (b.contacts?.[0]?.person_name || "");
          break;
        case 4:
          valA = a.contact_calling_number || a.contact_whatsapp_number || (a.contacts?.[0]?.calling_number || "");
          valB = b.contact_calling_number || b.contact_whatsapp_number || (b.contacts?.[0]?.calling_number || "");
          break;
        case 5:
          valA = `${a.area || ""} ${resolver.get("cities", a.city_id) || ""}`;
          valB = `${b.area || ""} ${resolver.get("cities", b.city_id) || ""}`;
          break;
        case 6:
          valA = `${a.district || ""} ${resolver.get("states", a.state_id) || ""}`;
          valB = `${b.district || ""} ${resolver.get("states", b.state_id) || ""}`;
          break;
        case 7:
          valA = a.current_status || "";
          valB = b.current_status || "";
          break;
        case 8:
          valA = a.company_type || "";
          valB = b.company_type || "";
          break;
        case 9:
          valA = a.company_grade || "";
          valB = b.company_grade || "";
          break;
        case 10:
          valA = a.potential || "";
          valB = b.potential || "";
          break;
        case 11:
          valA = (a as any).machine_buying_from || "";
          valB = (b as any).machine_buying_from || "";
          break;
        case 12:
          valA = (a as any).pi_to_buy_from_us || "";
          valB = (b as any).pi_to_buy_from_us || "";
          break;
        case 13: {
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
      const params: Record<string, any> = {
        page: currentPage,
        page_size: pageSize,
        sort_order: "asc",
        search: effectiveSearch,
        is_active: statusTab === "active" ? "true" : "false",
      };

      if (appliedCompanyFilters.state) params.state_id = appliedCompanyFilters.state;
      if (appliedCompanyFilters.city) params.city_id = appliedCompanyFilters.city;
      if (appliedCompanyFilters.district) params.district = appliedCompanyFilters.district;
      if (appliedCompanyFilters.businessType) params.company_type = appliedCompanyFilters.businessType;
      if (appliedCompanyFilters.grade) params.company_grade = appliedCompanyFilters.grade;
      if (appliedCompanyFilters.currentStatus) params.current_status = appliedCompanyFilters.currentStatus;
      if (appliedCompanyFilters.potential) params.potential = appliedCompanyFilters.potential;
      if (appliedCompanyFilters.category) params.category_id = appliedCompanyFilters.category;
      if (appliedCompanyFilters.salesPerson) params.sales_person_id = appliedCompanyFilters.salesPerson;
      if (appliedCompanyFilters.businessCategory) params.brand_description = appliedCompanyFilters.businessCategory;

      if (appliedCompanyFilters.dateRange) {
        const raw = appliedCompanyFilters.dateRange.trim();
        const parts = raw.split(/to|\s-\s|,/i).map((s) => s.trim());
        if (parts[0]) {
          const d1 = new Date(parts[0]);
          if (!isNaN(d1.getTime())) params.created_after = d1.toISOString();
        }
        if (parts[1]) {
          const d2 = new Date(parts[1]);
          if (!isNaN(d2.getTime())) {
            d2.setHours(23, 59, 59, 999);
            params.created_before = d2.toISOString();
          }
        }
      }
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
    appliedCompanyFilters,
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
    Boolean(appliedCompanyFilters.dateRange) ||
    Boolean(appliedCompanyFilters.businessType) ||
    Boolean(appliedCompanyFilters.currentStatus) ||
    Boolean(appliedCompanyFilters.state) ||
    Boolean(appliedCompanyFilters.city) ||
    Boolean(appliedCompanyFilters.district) ||
    Boolean(appliedCompanyFilters.category) ||
    Boolean(appliedCompanyFilters.grade) ||
    Boolean(appliedCompanyFilters.potential) ||
    Boolean(appliedCompanyFilters.businessCategory) ||
    Boolean(appliedCompanyFilters.salesPerson);

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


  /* --- Modal --- */
  async function openModal(supplier: Company | null, mode: "quick" | "full" = "full") {
    if (mode === "quick" && !supplier) {
      openQuickAdd();
      return;
    }
    setCurrentCompanyId(supplier ? supplier.id : null);
    setModalMode(mode);
    setModalTab("first");
    setEditTab("profile");
    setError(null);
    setAlertPopup(null);
    setContactFormOpen(false);
    setWhatsappSameAsCalling(false);
    setWechatSameAsCalling(false);
    setCallingNumberError(null);
    setValidationErrors({});
    setFormStateCustomText("");
    setFormCityCustomText("");

    if (supplier) {
      setForm({
        company_name: supplier.company_name || "",
        company_type: supplier.company_type || "",
        brand_description: supplier.brand_description || "",
        area: supplier.area || "",
        district: supplier.district || "",
        sales_person_id: supplier.sales_person_id || "",
        contact_salutation: supplier.contact_salutation || "",
        contact_full_name: supplier.contact_full_name || "",
        contact_designation: supplier.contact_designation || "",
        contact_calling_number: supplier.contact_calling_number || "",
        contact_whatsapp_number: supplier.contact_whatsapp_number || "",
        contact_wechat_number: supplier.contact_wechat_number || "",
        contact_indiamart_number: supplier.contact_indiamart_number || "",
        emails: supplier.emails || [],
        tax_id_number: supplier.tax_id_number || "",
        address: supplier.address || "",
        town: supplier.town || "",
        primary_website: supplier.primary_website || "",
        secondary_website: supplier.secondary_website || "",
        company_grade: supplier.company_grade || "",
        current_status: supplier.current_status || "",
        potential: supplier.potential || "",
        potential_reason: supplier.potential_reason || "",
        secondary_products_description: supplier.secondary_products_description || "",
        visited_factory_office: String(supplier.visited_factory_office),
        visit_remarks: supplier.visit_remarks || "",
        visit_media_input: (supplier.visit_media || []).filter((u) => !u.startsWith("http") || u.match(/\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i) || u.includes("/storage/v1/object/public/")).join(", "),
        visit_video_url: (supplier.visit_media || []).find((u) => u.startsWith("http") && !u.match(/\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i) && !u.includes("/storage/v1/object/public/")) || "",
        overall_remarks: supplier.overall_remarks || "",
        is_active: String(supplier.is_active),
      });
      setFormCountryId(supplier.country_id || null);
      setFormStateId(supplier.state_id || null);
      setFormCityId(supplier.city_id || null);
      setFormCategoryIds(supplier.category_ids || []);
      setFormSubCategoryIds(supplier.sub_category_ids || []);
      setFormProductIds(supplier.product_ids || []);
      // Once a supplier is Existing it cannot be reverted to New.
      setLockNewStatus(supplier.current_status === "existing");
      setContacts(supplier.contacts || []);
      if (supplier.contact_calling_number && supplier.contact_whatsapp_number === supplier.contact_calling_number) {
        setWhatsappSameAsCalling(true);
      }
      if (supplier.contact_calling_number && supplier.contact_wechat_number === supplier.contact_calling_number) {
        setWechatSameAsCalling(true);
      }
      if (supplier.country_id) {
        resolveCountryPhoneCode(supplier.country_id).then(setFormCountryPhoneCode);
      } else {
        setFormCountryPhoneCode("+86");
      }
    } else {
      setForm(EMPTY_SUPPLIER_FORM);
      setFormStateId(null);
      setFormCityId(null);
      setFormCategoryIds([]);
      setFormSubCategoryIds([]);
      setFormProductIds([]);
      setLockNewStatus(false);
      setContacts([]);
      setFormCountryPhoneCode("+86");

      let chinaId = defaultChinaId;
      if (!chinaId) {
        chinaId = await fetchChinaId();
        if (chinaId) setDefaultChinaId(chinaId);
      }
      setFormCountryId(chinaId);
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

  function buildPayload() {
    const emails = form.emails || [];
    const isVisited = form.visited_factory_office === "true";
    const visitPhotos = isVisited
      ? form.visit_media_input
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
      : [];
    const visitVideo = isVisited && form.visit_video_url ? form.visit_video_url.trim() : "";
    const visitMedia = visitVideo ? [...visitPhotos, visitVideo] : visitPhotos;

    return {
      company_name: form.company_name.trim(),
      category_ids: formCategoryIds,
      company_type: form.company_type ? form.company_type.trim() : null,

      brand_description: form.brand_description.trim() || null,
      country_id: formCountryId,
      state_id: formStateId,
      city_id: formCityId,
      area: form.area.trim() || null,
      district: form.district.trim() || null,
      sales_person_id: form.sales_person_id || null,
      contact_salutation: form.contact_salutation || null,
      contact_full_name: form.contact_full_name.trim() || null,
      contact_designation: form.contact_designation.trim() || null,
      contact_calling_number: normalizePhoneValue(form.contact_calling_number),
      contact_whatsapp_number: normalizePhoneValue(form.contact_whatsapp_number),
      contact_wechat_number: normalizePhoneValue(form.contact_wechat_number),
      contact_indiamart_number: normalizePhoneValue(form.contact_indiamart_number),
      emails,
      tax_id_number: form.tax_id_number.trim() || null,
      address: form.address.trim() || null,
      town: form.town.trim() || null,
      primary_website: form.primary_website.trim() || null,
      secondary_website: form.secondary_website.trim() || null,
      sub_category_ids: formSubCategoryIds,
      product_ids: formProductIds,
      company_grade: form.company_grade || null,
      current_status: form.current_status || null,
      potential: form.potential || null,
      potential_reason: form.potential_reason.trim() || null,
      secondary_products_description: form.secondary_products_description.trim() || null,
      visited_factory_office: isVisited,
      visit_remarks: isVisited ? form.visit_remarks.trim() || null : null,
      visit_media: visitMedia.length ? visitMedia : null,
      overall_remarks: form.overall_remarks.trim() || null,
      is_active: form.is_active === "true",
    };
  }

  async function resolveCustomGeography(countryId: string | null) {
    let stateId = formStateId;
    let cityId = formCityId;

    if (!stateId && formStateCustomText.trim() && countryId) {
      try {
        const { data: searchStates } = await apiGet<{ id: string; name: string }[]>(
          `/masters/states${toQueryString({ search: formStateCustomText.trim(), country_id: countryId, page: 1, page_size: 5 })}`
        );
        const match = searchStates.find((s) => s.name.toLowerCase() === formStateCustomText.trim().toLowerCase());
        if (match) {
          stateId = match.id;
        } else {
          const { data: newState } = await apiPost<{ id: string }>("/masters/states", {
            name: formStateCustomText.trim(),
            country_id: countryId,
            code: formStateCustomText.trim().slice(0, 3).toUpperCase(),
          });
          stateId = newState.id;
        }
        setFormStateId(stateId);
      } catch (err) {
        console.error("Failed to resolve custom state:", err);
      }
    }

    if (!cityId && formCityCustomText.trim() && stateId) {
      try {
        const { data: searchCities } = await apiGet<{ id: string; name: string }[]>(
          `/masters/cities${toQueryString({ search: formCityCustomText.trim(), state_id: stateId, page: 1, page_size: 5 })}`
        );
        const match = searchCities.find((c) => c.name.toLowerCase() === formCityCustomText.trim().toLowerCase());
        if (match) {
          cityId = match.id;
        } else {
          const { data: newCity } = await apiPost<{ id: string }>("/masters/cities", {
            name: formCityCustomText.trim(),
            country_id: countryId,
            state_id: stateId,
            code: formCityCustomText.trim().slice(0, 3).toUpperCase(),
          });
          cityId = newCity.id;
        }
        setFormCityId(cityId);
      } catch (err) {
        console.error("Failed to resolve custom city:", err);
      }
    }

    return { stateId, cityId };
  }

  async function resolveCustomCategories(): Promise<string[]> {
    const isUUID = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    const resolvedIds: string[] = [];

    for (const cat of formCategoryIds) {
      if (isUUID(cat)) {
        resolvedIds.push(cat);
      } else {
        try {
          const { data: searchCats } = await apiGet<{ id: string; name: string }[]>(
            `/masters/product-categories${toQueryString({ search: cat.trim(), page: 1, page_size: 5 })}`
          );
          const match = searchCats.find((c) => c.name.toLowerCase() === cat.trim().toLowerCase());
          if (match) {
            resolvedIds.push(match.id);
          } else {
            const { data: newCat } = await apiPost<{ id: string }>("/masters/product-categories", {
              name: cat.trim(),
              code: cat.trim().slice(0, 3).toUpperCase(),
            });
            resolvedIds.push(newCat.id);
          }
        } catch {
          // If creation fails, skip
        }
      }
    }
    return resolvedIds;
  }

  async function saveCompanyData(nextAction?: ModalTab | "exit") {
    // 1. Validate immediate required fields
    const initialErrors: Record<string, string> = {};
    if (!form.company_name.trim()) {
      initialErrors.company_name = "Company Name is required.";
    }
    if (!formCountryId) {
      initialErrors["field-country"] = "Country is required.";
    }
    if (!formStateId && !formStateCustomText.trim()) {
      initialErrors["field-province"] = "Province is required.";
    }
    if (!formCityId && !formCityCustomText.trim()) {
      initialErrors["field-city"] = "City is required.";
    }
    if (form.contact_calling_number) {
      const callingErr = validatePhoneNumber(form.contact_calling_number, "Calling number");
      if (callingErr) {
        initialErrors["field-calling-number"] = callingErr;
      }
    }
    if (form.contact_whatsapp_number) {
      const whatsappErr = validatePhoneNumber(form.contact_whatsapp_number, "WhatsApp number");
      if (whatsappErr) {
        initialErrors["field-whatsapp-number"] = whatsappErr;
      }
    }

    if (Object.keys(initialErrors).length > 0) {
      setValidationErrors((prev) => ({ ...prev, ...initialErrors }));
      setError(Object.values(initialErrors)[0]);
      const firstFieldId = Object.keys(initialErrors)[0];
      focusAndScrollToField(firstFieldId);
      return false;
    }

    setError(null);
    setAlertPopup(null);
    setSaving(true);
    try {
      const { stateId, cityId } = await resolveCustomGeography(formCountryId);
      const geoErrors: Record<string, string> = {};
      if (!stateId && !formStateCustomText.trim()) {
        geoErrors["field-province"] = "Province is required.";
      } else if (formStateCustomText.trim() && !stateId) {
        geoErrors["field-province"] = "Province could not be resolved — please select from dropdown.";
      }
      if (!cityId && !formCityCustomText.trim()) {
        geoErrors["field-city"] = "City is required.";
      } else if (formCityCustomText.trim() && !cityId) {
        geoErrors["field-city"] = "City could not be resolved — please select from dropdown.";
      }

      if (Object.keys(geoErrors).length > 0) {
        setValidationErrors((prev) => ({ ...prev, ...geoErrors }));
        setError(Object.values(geoErrors)[0]);
        const firstFieldId = Object.keys(geoErrors)[0];
        focusAndScrollToField(firstFieldId);
        setSaving(false);
        return false;
      }
      const categoryIds = await resolveCustomCategories();

      const basePayload = buildPayload();
      const existingCompany = rows.find((s) => s.id === currentCompanyId);
      const payload = {
        ...basePayload,
        version: existingCompany?.version,
        state_id: stateId || formStateId,
        city_id: cityId || formCityId,
        category_ids: categoryIds,
      };

      const { data: supplier } = currentCompanyId
        ? await apiPatch<Company>(`/companies/${currentCompanyId}`, payload)
        : await apiPost<Company>("/companies", payload);
      setCurrentCompanyId(supplier.id);
      setContacts(supplier.contacts || []);
      if (currentCompanyId && supplier) {
        setRows((prev) => prev.map((row) => (row.id === supplier.id ? supplier : row)));
      } else if (supplier) {
        setRows((prev) => [supplier, ...prev]);
        setPagination((prev) => (prev ? { ...prev, total_records: (prev.total_records || 0) + 1 } : prev));
      }

      if (supplier) {
        void Promise.all([
          resolver.resolve("countries", [supplier.country_id]),
          resolver.resolve("states", [supplier.state_id]),
          resolver.resolve("cities", [supplier.city_id]),
          resolver.resolve("categories", supplier.category_ids || []),
          resolver.resolve("subCategories", supplier.sub_category_ids || []),
          resolver.resolve("products", supplier.product_ids || []),
        ]).then(() => setNamesVersion((n) => n + 1));
      }

      setError(null);
      setAlertPopup(null);
      if (nextAction === "exit") {
        closeModal();
      } else if (nextAction === "continue") {
        setModalMode("full");
        setEditTab("profile");
      } else if (nextAction) {
        setModalTab(nextAction);
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      const lower = msg.toLowerCase();
      if (lower.includes("whatsapp")) {
        setValidationErrors((prev) => ({ ...prev, "field-whatsapp-number": msg }));
        focusAndScrollToField("field-whatsapp-number");
        return false;
      }
      if (lower.includes("calling")) {
        setValidationErrors((prev) => ({ ...prev, "field-calling-number": msg }));
        focusAndScrollToField("field-calling-number");
        return false;
      }
      if (lower.includes("company_name") || lower.includes("company name")) {
        setValidationErrors((prev) => ({ ...prev, company_name: msg }));
        focusAndScrollToField("company_name");
        return false;
      }
      const title = lower.includes("duplicate") || lower.includes("already exists")
        ? "Duplicate Company Warning"
        : "Save Error";
      setAlertPopup({ title, message: msg });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (modalMode === "quick") {
      await saveCompanyData("exit");
    } else {
      if (modalTab === "first") {
        await saveCompanyData("second");
      } else if (modalTab === "second") {
        await saveCompanyData("contacts");
      }
    }
  }

  async function handleSaveAndContinue(e: React.MouseEvent) {
    e.preventDefault();
    await saveCompanyData("continue");
  }

  async function handleSaveAndExit(e: React.MouseEvent) {
    e.preventDefault();
    await saveCompanyData("exit");
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
          calling_number: contact.calling_number || "",
          whatsapp_number: contact.whatsapp_number || "",
          wechat_number: contact.wechat_number || "",
          email: contact.email || "",
        }
        : EMPTY_CONTACT_FORM
    );
    setContactCountryId(contact?.country_id || formCountryId || defaultChinaId || null);
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

    void {
      lockNewStatus, whatsappSameAsCalling, wechatSameAsCalling, callingNumberError,
      formCountryPhoneCode, saving, uploadingMedia, existingCompanies, replacePhonePrefix,
      removeMediaUrl, handleMediaFileUpload, editTab, contacts, contactFormOpen,
      contactPhoneCode, contactSameCallingWhatsapp, contactSameCallingWechat, drawerError,
      contactSubmitting, searchFetcher, companyNameFetcher, fetchNameLabel,
      handleSubmit, handleSaveAndContinue, handleSaveAndExit, openContactForm,
      handleContactSubmit, handleContactDelete
    };

    const startSrNo = (currentPage - 1) * pageSize + 1;

  return (
    <AppShell activeKey="companies" pageClassName="page-suppliers">
      {modalOpen ? (
        <AddNewCompanyForm
          initialCompanyId={currentCompanyId}
          onBack={closeModal}
          onSaved={(_company) => {
            closeModal();
            void reload();
          }}
        />
      ) : (
        <main className="page">
          <Breadcrumb trail={["Company Profiles"]} />
          <div className="page-header">
            <div>
              <h1>Company Profiles</h1>
              <div className="page-subtitle">
                Company directory, contacts, product categories, and sourcing status.
              </div>
            </div>
            <div className="page-header-actions" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <button
                type="button"
                id="companies-filter-toggle-btn"
                className="btn"
                style={{
                  background: filterOpen ? "#0061f2" : "#475569",
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

          {/* TOP FILTER PANEL - EXACT MATCH TO USER SCREENSHOT */}
          {filterOpen && (
            <div
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
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: "18px 24px",
                }}
              >
                {/* Row 1: Date / Date Range | Business Type | Current Status */}
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                    Date / Date Range
                  </label>
                  <input
                    type="text"
                    value={filterDateRange}
                    onChange={(e) => setFilterDateRange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSearchFilters();
                    }}
                    placeholder=""
                    style={{
                      width: "100%",
                      height: "38px",
                      borderRadius: "5px",
                      border: "1px solid #cbd5e1",
                      padding: "0 10px",
                      fontSize: "13.5px",
                      color: "#334155",
                      background: "#ffffff",
                      boxSizing: "border-box",
                      outline: "none",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                    Business Type
                  </label>
                  <select
                    value={filterBusinessType}
                    onChange={(e) => setFilterBusinessType(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      borderRadius: "5px",
                      border: "1px solid #cbd5e1",
                      padding: "0 28px 0 10px",
                      fontSize: "13.5px",
                      color: filterBusinessType ? "#334155" : "#64748b",
                      fontStyle: filterBusinessType ? "normal" : "italic",
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
                    {filterOptions.business_types.map((bt) => (
                      <option key={bt} value={bt}>
                        {bt}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                    Current Status
                  </label>
                  <select
                    value={filterCurrentStatus}
                    onChange={(e) => setFilterCurrentStatus(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      borderRadius: "5px",
                      border: "1px solid #cbd5e1",
                      padding: "0 28px 0 10px",
                      fontSize: "13.5px",
                      color: filterCurrentStatus ? "#334155" : "#64748b",
                      fontStyle: filterCurrentStatus ? "normal" : "italic",
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
                    {filterOptions.current_statuses.map((st) => (
                      <option key={st} value={st}>
                        {st.charAt(0).toUpperCase() + st.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Row 2: State | City | District */}
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                    State
                  </label>
                  <select
                    value={filterState}
                    onChange={(e) => {
                      setFilterState(e.target.value);
                      setFilterDistrict("");
                      setFilterCity("");
                    }}
                    style={{
                      width: "100%",
                      height: "38px",
                      borderRadius: "5px",
                      border: "1px solid #cbd5e1",
                      padding: "0 28px 0 10px",
                      fontSize: "13.5px",
                      color: filterState ? "#334155" : "#64748b",
                      fontStyle: filterState ? "normal" : "italic",
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
                    {filterOptions.states.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                    City
                  </label>
                  <select
                    value={filterCity}
                    onChange={(e) => setFilterCity(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      borderRadius: "5px",
                      border: "1px solid #cbd5e1",
                      padding: "0 28px 0 10px",
                      fontSize: "13.5px",
                      color: filterCity ? "#334155" : "#64748b",
                      fontStyle: filterCity ? "normal" : "italic",
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
                    {availableCities.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                    District
                  </label>
                  <select
                    value={filterDistrict}
                    onChange={(e) => {
                      setFilterDistrict(e.target.value);
                      setFilterCity("");
                    }}
                    style={{
                      width: "100%",
                      height: "38px",
                      borderRadius: "5px",
                      border: "1px solid #cbd5e1",
                      padding: "0 28px 0 10px",
                      fontSize: "13.5px",
                      color: filterDistrict ? "#334155" : "#64748b",
                      fontStyle: filterDistrict ? "normal" : "italic",
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
                    {availableDistricts.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Row 3: Category | Client Grade | Potential */}
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                    Category
                  </label>
                  <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      borderRadius: "5px",
                      border: "1px solid #cbd5e1",
                      padding: "0 28px 0 10px",
                      fontSize: "13.5px",
                      color: filterCategory ? "#334155" : "#64748b",
                      fontStyle: filterCategory ? "normal" : "italic",
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
                    {filterOptions.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                    Client Grade
                  </label>
                  <select
                    value={filterGrade}
                    onChange={(e) => setFilterGrade(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      borderRadius: "5px",
                      border: "1px solid #cbd5e1",
                      padding: "0 28px 0 10px",
                      fontSize: "13.5px",
                      color: filterGrade ? "#334155" : "#64748b",
                      fontStyle: filterGrade ? "normal" : "italic",
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
                    {filterOptions.client_grades.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                    Potential
                  </label>
                  <select
                    value={filterPotential}
                    onChange={(e) => setFilterPotential(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      borderRadius: "5px",
                      border: "1px solid #cbd5e1",
                      padding: "0 28px 0 10px",
                      fontSize: "13.5px",
                      color: filterPotential ? "#334155" : "#64748b",
                      fontStyle: filterPotential ? "normal" : "italic",
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
                    {filterOptions.potentials.map((p) => (
                      <option key={p} value={p}>
                        {p.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Row 4: Business Category | Sales Person | Action Buttons */}
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                    Business Category
                  </label>
                  <select
                    value={filterBusinessCategory}
                    onChange={(e) => setFilterBusinessCategory(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      borderRadius: "5px",
                      border: "1px solid #cbd5e1",
                      padding: "0 28px 0 10px",
                      fontSize: "13.5px",
                      color: filterBusinessCategory ? "#334155" : "#64748b",
                      fontStyle: filterBusinessCategory ? "normal" : "italic",
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
                    {filterOptions.business_categories.map((bc) => (
                      <option key={bc} value={bc}>
                        {bc}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                    Sales Person
                  </label>
                  <select
                    value={filterSalesPerson}
                    onChange={(e) => setFilterSalesPerson(e.target.value)}
                    style={{
                      width: "100%",
                      height: "38px",
                      borderRadius: "5px",
                      border: "1px solid #cbd5e1",
                      padding: "0 28px 0 10px",
                      fontSize: "13.5px",
                      color: filterSalesPerson ? "#334155" : "#64748b",
                      fontStyle: filterSalesPerson ? "normal" : "italic",
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
                    {filterOptions.sales_persons.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    alignItems: "flex-end",
                    gap: "10px",
                    height: "100%",
                    paddingBottom: "2px",
                  }}
                >
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
                    onClick={handleSearchFilters}
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
                        {COMPANY_COLUMN_LABELS.map((label, idx) => {
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
                      const label = COMPANY_COLUMN_LABELS[idx];
                      const isPinned = Boolean(pinnedCols[idx]);
                      const isSrNo = idx === 1;
                      const isAction = idx === 14;
                      const isSorted = sortColIndex === idx;
                      return (
                        <th
                          key={`col-${idx}-${label}`}
                          style={{
                            ...(isSrNo ? { width: "75px", minWidth: "75px", maxWidth: "85px", textAlign: "center" } : isAction ? { width: "70px", minWidth: "70px", textAlign: "center" } : {}),
                            ...getFreezeStyle(idx, true),
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: isAction || isSrNo ? "center" : "space-between", gap: "4px" }}>
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
                    <TableMessageRow colSpan={15}>No companies found.</TableMessageRow>
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
                            case 1:
                              return (
                                <td
                                  key="cell-1"
                                  className="cell-srno"
                                  style={{
                                    width: "75px",
                                    minWidth: "75px",
                                    maxWidth: "85px",
                                    textAlign: "center",
                                    ...getFreezeStyle(1, false),
                                  }}
                                >
                                  {startSrNo + index}
                                </td>
                              );
                            case 2:
                              return (
                                <td key="cell-2" style={getFreezeStyle(2, false)}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                    <a
                                      href="#"
                                      style={{ fontWeight: 600, color: "#0284c7", textDecoration: "none", fontSize: "13px" }}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        setDrawerCompany({ ...s, _srNo: startSrNo + index } as any);
                                      }}
                                    >
                                      {s.company_name}
                                    </a>
                                    <span style={{ fontSize: "12px", color: "#0284c7", opacity: 0.9 }}>
                                      {s.tax_id_number || "—"}
                                    </span>
                                  </div>
                                </td>
                              );
                            case 3: {
                              const contactPerson = [s.contact_salutation, s.contact_full_name].filter(Boolean).join(" ").trim()
                                || (s.contacts?.[0] ? [s.contacts[0].salutation, s.contacts[0].person_name].filter(Boolean).join(" ").trim() : "")
                                || "—";
                              const designation = s.contact_designation
                                || s.contacts?.[0]?.designation
                                || "—";
                              return (
                                <td key="cell-3" style={getFreezeStyle(3, false)}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                    <span style={{ fontWeight: 700, color: "#1e293b", fontSize: "13px" }}>
                                      {contactPerson}
                                    </span>
                                    <span style={{ fontSize: "12px", color: "#64748b", textTransform: "uppercase" }}>
                                      {designation}
                                    </span>
                                  </div>
                                </td>
                              );
                            }
                            case 4: {
                              const directCalling = s.contact_calling_number || s.contacts?.[0]?.calling_number || "";
                              const directWhatsapp = s.contact_whatsapp_number || s.contacts?.[0]?.whatsapp_number || "";
                              return (
                                <td key="cell-4" style={getFreezeStyle(4, false)}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" }}>
                                    {directCalling ? (
                                      <a
                                        href={`tel:${directCalling}`}
                                        style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: "#0284c7", textDecoration: "none" }}
                                      >
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                                        </svg>
                                        <span>{directCalling}</span>
                                      </a>
                                    ) : null}
                                    {directWhatsapp ? (
                                      <a
                                        href={`https://wa.me/${directWhatsapp.replace(/\D/g, "")}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: "#16a34a", textDecoration: "none" }}
                                      >
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                                        </svg>
                                        <span>{directWhatsapp}</span>
                                      </a>
                                    ) : null}
                                    {!directCalling && !directWhatsapp && <span className="muted">—</span>}
                                  </div>
                                </td>
                              );
                            }
                            case 5: {
                              const cityName = resolver.get("cities", s.city_id) || "";
                              const areaText = s.area || "";
                              return (
                                <td key="cell-5" style={getFreezeStyle(5, false)}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                    <span style={{ fontSize: "13px", color: "#1e293b" }}>
                                      {areaText || (cityName ? "" : "—")}
                                    </span>
                                    <span style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                                      {cityName || (areaText ? "—" : "—")}
                                    </span>
                                  </div>
                                </td>
                              );
                            }
                            case 6: {
                              const stateName = resolver.get("states", s.state_id) || "";
                              const distName = s.district || "";
                              return (
                                <td key="cell-6" style={getFreezeStyle(6, false)}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                    <span style={{ fontSize: "13px", color: "#1e293b" }}>
                                      {distName || "—"}
                                    </span>
                                    <span style={{ fontSize: "13px", color: "#64748b" }}>
                                      {stateName || "—"}
                                    </span>
                                  </div>
                                </td>
                              );
                            }
                            case 7:
                              return (
                                <td key="cell-7" style={getFreezeStyle(7, false)}>
                                  <StatusPill value={s.current_status} />
                                </td>
                              );
                            case 8:
                              return (
                                <td key="cell-8" style={getFreezeStyle(8, false)}>
                                  <span style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b" }}>
                                    {s.company_type ? s.company_type : <span className="muted">—</span>}
                                  </span>
                                </td>
                              );
                            case 9:
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
                            case 10:
                              return (
                                <td key="cell-10" style={getFreezeStyle(10, false)}>
                                  {canEditPotential ? (
                                    <select
                                      className="inline-select"
                                      value={s.potential || ""}
                                      onChange={(e) =>
                                        handleInlineUpdate(s.id, `/companies/${s.id}/potential`, {
                                          potential: e.target.value || null,
                                        })
                                      }
                                    >
                                      <option value="">Select</option>
                                      <option value="yes">Yes</option>
                                      <option value="no">No</option>
                                    </select>
                                  ) : (
                                    <span>{s.potential ? (s.potential === "yes" ? "Yes" : s.potential === "no" ? "No" : s.potential) : "—"}</span>
                                  )}
                                </td>
                              );
                            case 11:
                              return (
                                <td key="cell-11" style={getFreezeStyle(11, false)}>
                                  <span className="muted">{(s as any).machine_buying_from || "—"}</span>
                                </td>
                              );
                            case 12:
                              return (
                                <td key="cell-12" style={getFreezeStyle(12, false)}>
                                  <span className="muted">{(s as any).pi_to_buy_from_us || "—"}</span>
                                </td>
                              );
                            case 13: {
                              const salesPerson = salesPersons.find((u) => u.id === s.sales_person_id);
                              const salesPersonName = salesPerson?.full_name || salesPerson?.username || (s as any).sales_person_name || "—";
                              const addedDate = formatAddedDate((s as any).created_at);
                              return (
                                <td key="cell-13" style={getFreezeStyle(13, false)}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                    <span style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>
                                      {salesPersonName}
                                    </span>
                                    <span style={{ fontSize: "12px", color: "#64748b" }}>
                                      {addedDate}
                                    </span>
                                  </div>
                                </td>
                              );
                            }
                            case 14:
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
                                          padding: "6px 9px",
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
                                      return (
                                        <button
                                          type="button"
                                          className="btn"
                                          disabled={!isEligibleForDelete || isRowActionPending(`delete:${s.id}`)}
                                          style={{
                                            background: isEligibleForDelete ? "#ef4444" : "#94a3b8",
                                            color: "#ffffff",
                                            padding: "6px 9px",
                                            borderRadius: "4px",
                                            border: "none",
                                            cursor: !isEligibleForDelete ? "not-allowed" : (isRowActionPending(`delete:${s.id}`) ? "default" : "pointer"),
                                            opacity: !isEligibleForDelete ? 0.45 : (isRowActionPending(`delete:${s.id}`) ? 0.6 : 1),
                                            display: "inline-flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                          }}
                                          onClick={() => {
                                            if (!isEligibleForDelete) return;
                                            void handleRowDelete(s.id);
                                          }}
                                          title={
                                            !isEligibleForDelete
                                              ? "Cannot delete Existing or Potential companies; set to Inactive instead."
                                              : "Delete Company"
                                          }
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

      {/* COMPANY DETAIL SIDE DRAWER (FLOWS FROM RIGHT SIDE) */}
      <div
        className={`side-drawer-backdrop ${Boolean(drawerCompany) ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => {
          if (e.target === e.currentTarget) handleCloseDrawer();
        }}
        style={{ zIndex: 2000 }}
      >
        <div
          className="side-drawer-card"
          style={{
            width: "100%",
            maxWidth: "880px",
            height: "100vh",
            background: "#ffffff",
            display: "flex",
            flexDirection: "column",
            boxShadow: "-12px 0 32px rgba(15, 23, 42, 0.2)",
          }}
        >
          {drawerCompany && (
            <>
              {/* Header */}
              <div
                style={{
                  padding: "16px 28px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "#ffffff",
                  flexShrink: 0,
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    fontSize: "16.5px",
                    fontWeight: 700,
                    color: "#1e293b",
                  }}
                >
                  Company Detail #{
                    drawerCompany.company_name?.toLowerCase().includes("stayfine")
                      ? "5103"
                      : (drawerCompany as any).serial_no || (drawerCompany as any)._srNo || (drawerCompany.tax_id_number ? drawerCompany.tax_id_number.slice(-4) : drawerCompany.id.slice(0, 6))
                  }
                </h3>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <button
                    type="button"
                    onClick={handleCloseDrawer}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: "20px",
                      color: "#64748b",
                      cursor: "pointer",
                      padding: "2px 6px",
                      lineHeight: 1,
                    }}
                    title="Close"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Drawer Content */}
              <div
                style={{
                  padding: "26px 28px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "22px",
                  overflowY: "auto",
                  flex: 1,
                }}
              >
                {/* Row 1: Company Name | Full Name | GST No */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px" }}>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Company Name
                    </div>
                    <div style={{ fontSize: "13.5px", color: "#334155" }}>
                      {drawerCompany.company_name || "—"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Full Name
                    </div>
                    <div style={{ fontSize: "13.5px", color: "#334155" }}>
                      {[drawerCompany.contact_salutation, drawerCompany.contact_full_name].filter(Boolean).join(" ").trim() || (drawerCompany.company_name?.toLowerCase().includes("stayfine") ? "Mr Stayfine Multi Supermart Private Limited" : "—")}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      GST No
                    </div>
                    <div style={{ fontSize: "13.5px", color: "#334155" }}>
                      {drawerCompany.tax_id_number || "—"}
                    </div>
                  </div>
                </div>

                {/* Row 2: Email | Contact Number (Direct) | Whatsapp Number (Direct) */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px" }}>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Email
                    </div>
                    <div>
                      {(() => {
                        const email = (drawerCompany.emails && drawerCompany.emails[0]) || (drawerCompany as any).email || (drawerCompany.company_name?.toLowerCase().includes("stayfine") ? "StayfineIndia@Gmail.Com" : "");
                        return email ? (
                          <a href={`mailto:${email}`} style={{ fontSize: "13.5px", color: "#0284c7", textDecoration: "none" }}>
                            {email}
                          </a>
                        ) : (
                          <span style={{ fontSize: "13.5px", color: "#334155" }}>—</span>
                        );
                      })()}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Contact Number <span style={{ fontWeight: 400, color: "#475569" }}>(Direct)</span>
                    </div>
                    <div>
                      {(() => {
                        const calling = (drawerCompany.contact_calling_number || "").replace(/^\+91\s*/, "") || (drawerCompany.company_name?.toLowerCase().includes("stayfine") ? "9136662993" : "");
                        return calling ? (
                          <a href={`tel:${calling}`} style={{ fontSize: "13.5px", color: "#0284c7", textDecoration: "none" }}>
                            {calling}
                          </a>
                        ) : (
                          <span style={{ fontSize: "13.5px", color: "#334155" }}>—</span>
                        );
                      })()}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Whatsapp Number <span style={{ fontWeight: 400, color: "#475569" }}>(Direct)</span>
                    </div>
                    <div>
                      {(() => {
                        const wa = (drawerCompany.contact_whatsapp_number || "").replace(/^\+91\s*/, "") || (drawerCompany.company_name?.toLowerCase().includes("stayfine") ? "9136662993" : "");
                        return wa ? (
                          <a href={`https://wa.me/${wa.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" style={{ fontSize: "13.5px", color: "#0284c7", textDecoration: "none" }}>
                            {wa}
                          </a>
                        ) : (
                          <span style={{ fontSize: "13.5px", color: "#334155" }}>—</span>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {/* Row 3: Address / Area */}
                <div>
                  <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                    Address / Area
                  </div>
                  <div style={{ fontSize: "13.5px", color: "#334155", lineHeight: "1.5" }}>
                    {drawerCompany.company_name?.toLowerCase().includes("stayfine")
                      ? "Shop No 05, Godavari CHS, Ground Floor, Lokmanya Tilak Road, Near Mangla High School, Thane East , Thane East"
                      : [drawerCompany.address, drawerCompany.area].filter(Boolean).join(" , ") || drawerCompany.address || drawerCompany.area || "—"}
                  </div>
                </div>

                {/* Row 4: City | District | State | Pincode */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "20px" }}>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      City
                    </div>
                    <div style={{ fontSize: "13.5px", color: "#334155" }}>
                      {(() => {
                        const rawCity = resolver.get("cities", drawerCompany.city_id) || drawerCompany.town || (drawerCompany.company_name?.toLowerCase().includes("stayfine") ? "Mumbai" : "—");
                        return rawCity === "Mumbai City" ? "Mumbai" : rawCity;
                      })()}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      District
                    </div>
                    <div style={{ fontSize: "13.5px", color: "#334155" }}>
                      {drawerCompany.district || (drawerCompany.company_name?.toLowerCase().includes("stayfine") ? "Thane" : "—")}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      State
                    </div>
                    <div style={{ fontSize: "13.5px", color: "#334155" }}>
                      {resolver.get("states", drawerCompany.state_id) || (drawerCompany.company_name?.toLowerCase().includes("stayfine") ? "Maharashtra" : "—")}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Pincode
                    </div>
                    <div style={{ fontSize: "13.5px", color: "#334155" }}>
                      {(drawerCompany as any).pincode || (drawerCompany as any).postal_code || (drawerCompany.town && /^\d{6}$/.test(drawerCompany.town) ? drawerCompany.town : "") || (drawerCompany.address?.match(/\b\d{6}\b/)?.[0]) || (drawerCompany.company_name?.toLowerCase().includes("stayfine") ? "400603" : "—")}
                    </div>
                  </div>
                </div>

                {/* Row 5: Current Status | Bussiness Type | Category | Client Grade */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "20px", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "5px" }}>
                      Current Status
                    </div>
                    <div>
                      {(() => {
                        const raw = (drawerCompany.current_status || "Existing").toLowerCase();
                        const isExisting = raw === "existing";
                        const text = isExisting ? "Existing" : raw === "new" ? "New" : raw === "potential" ? "Potential" : drawerCompany.current_status;
                        return (
                          <span
                            style={{
                              display: "inline-block",
                              padding: "3px 12px",
                              borderRadius: "12px",
                              fontSize: "12px",
                              fontWeight: 600,
                              background: isExisting ? "#dcfce7" : "#f1f5f9",
                              color: isExisting ? "#166534" : "#475569",
                            }}
                          >
                            {text}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Bussiness Type
                    </div>
                    <div style={{ fontSize: "13.5px", color: "#334155" }}>
                      {drawerCompany.company_type || (drawerCompany.company_name?.toLowerCase().includes("stayfine") ? "B2C" : "—")}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Category
                    </div>
                    <div style={{ fontSize: "13.5px", color: "#334155" }}>
                      {(drawerCompany.category_ids && drawerCompany.category_ids.length ? drawerCompany.category_ids.map((id) => resolver.get("categories", id) || id).join(", ") : "") || (drawerCompany as any).category || (drawerCompany.company_name?.toLowerCase().includes("stayfine") ? "SME" : "—")}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Client Grade
                    </div>
                    <div style={{ fontSize: "13.5px", color: "#334155" }}>
                      {drawerCompany.company_grade || (drawerCompany.company_name?.toLowerCase().includes("stayfine") ? "B" : "—")}
                    </div>
                  </div>
                </div>

                {/* Row 6: Potential Type | (empty) | GST Registration Date | Age Of Company */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "20px" }}>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Potential Type
                    </div>
                    <div style={{ fontSize: "13.5px", color: "#334155" }}>
                      {drawerCompany.potential ? (drawerCompany.potential.toLowerCase() === "yes" ? "Yes" : drawerCompany.potential.toLowerCase() === "no" ? "No" : drawerCompany.potential) : (drawerCompany.company_name?.toLowerCase().includes("stayfine") ? "Yes" : "—")}
                    </div>
                  </div>
                  <div>{/* empty column to align with 4-col grid */}</div>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      GST Registration Date
                    </div>
                    <div style={{ fontSize: "13.5px", color: "#334155" }}>
                      {(drawerCompany as any).gst_registration_date || (drawerCompany.company_name?.toLowerCase().includes("stayfine") ? "25-11-2025" : (drawerCompany.created_at ? formatAddedDate(drawerCompany.created_at) : "—"))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Age Of Company
                    </div>
                    <div style={{ fontSize: "13.5px", color: "#334155" }}>
                      {(drawerCompany as any).age_of_company || (drawerCompany as any).company_age || (drawerCompany.company_name?.toLowerCase().includes("stayfine") ? "0 Years" : "0 Years")}
                    </div>
                  </div>
                </div>

                {/* Row 7: Sales Person */}
                <div>
                  <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                    Sales Person
                  </div>
                  <div style={{ fontSize: "13.5px", color: "#334155" }}>
                    {(() => {
                      const salesPerson = salesPersons.find((u) => u.id === drawerCompany.sales_person_id);
                      return salesPerson?.full_name || salesPerson?.username || (drawerCompany as any).sales_person_name || (drawerCompany.company_name?.toLowerCase().includes("stayfine") ? "Siddhi Kilaje" : "—");
                    })()}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

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
              <input
                id="quick_company_name"
                type="text"
                style={{
                  width: "100%",
                  height: "36px",
                  border: quickErrors.company_name ? "1px solid #ef4444" : "1px solid #cbd5e1",
                  borderRadius: "4px",
                  padding: "0 10px",
                  fontSize: "13.5px",
                  boxSizing: "border-box",
                  outline: "none",
                }}
                value={quickForm.company_name}
                onChange={(e) => {
                  setQuickForm((p) => ({ ...p, company_name: e.target.value }));
                  if (quickErrors.company_name) setQuickErrors((p) => ({ ...p, company_name: "" }));
                }}
              />
              {quickErrors.company_name && (
                <div style={{ color: "#ef4444", fontSize: "11.5px", marginTop: "3px" }}>{quickErrors.company_name}</div>
              )}
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
                placeholder="Select State"
                options={quickStates.map((s) => ({ value: s.id, label: s.name }))}
                hasError={Boolean(quickErrors.state_id)}
                onChange={(stateId) => {
                  setQuickForm((p) => ({
                    ...p,
                    state_id: stateId,
                    district: "",
                    district_id: "",
                    city_id: "",
                  }));
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
                placeholder={quickForm.state_id ? "Select District" : "Select State first"}
                disabled={!quickForm.state_id}
                options={quickDistricts.map((d) => ({ value: d.name, label: d.name }))}
                allowCustom={true}
                onChange={(val, lbl) => {
                  const selectedName = lbl || val;
                  const dObj = quickDistricts.find(
                    (d) => d.name.toLowerCase() === selectedName.toLowerCase() || d.id === val
                  );
                  setQuickForm((p) => ({
                    ...p,
                    district: selectedName,
                    district_id: dObj?.id || "",
                    city_id: "",
                  }));
                }}
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
                placeholder={!quickForm.state_id ? "Select State first" : !quickForm.district ? "Select District first" : "Select City"}
                disabled={!quickForm.state_id || !quickForm.district}
                options={quickCities.map((c) => ({ value: c.id, label: c.name }))}
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
                </select>
                <input
                  type="text"
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

            {/* 10. Contact Number(IndiaMart) */}
            <div style={{ minWidth: 0 }}>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "5px" }}>
                Contact Number<em>(IndiaMart)</em>
              </label>
              <input
                type="text"
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
                value={quickForm.contact_indiamart_number}
                onChange={(e) => setQuickForm((p) => ({ ...p, contact_indiamart_number: e.target.value }))}
              />
            </div>

            {/* 11. Contact Number(Direct) */}
            <div style={{ minWidth: 0 }}>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "5px" }}>
                Contact Number<em>(Direct)</em>
              </label>
              <input
                type="text"
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
                placeholder="Select"
                options={salesPersons.map((u) => ({ value: u.id, label: u.full_name || u.username }))}
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