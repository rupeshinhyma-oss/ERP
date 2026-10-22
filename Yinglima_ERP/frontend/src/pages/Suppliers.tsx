/**
 * Supplier Profiles. Ported from suppliers.html + suppliers.js.
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
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Banner, ModalAlert, TableMessageRow } from "@/components/ui";
import { SideDrawer, DetailFieldGrid } from "@/components/SideDrawer";
import { Pagination } from "@/components/Pagination";
import { TrashConflictModal, type TrashConflictInfo } from "@/components/TrashConflictModal";
import { ItemPopoverCell, TextPopoverCell } from "@/components/ItemPopoverCell";
import { ImpExpDropdown, BulkActionsDropdown, ImportSummaryPanel, downloadSampleCsv, parseFile, WizardModal, type SheetRow } from "@/components/ImportWizard";
import {
  SearchableDropdown,
  SearchableFilterDropdown,
  SearchableDropdownMultiPanel,
  type DropdownOption,
} from "@/components/SearchableDropdown";
import { EmailTagInput, PhoneGroupField, SelectField, TextAreaField, TextField, WebsiteField, VideoTagInput, autoTitleCase } from "@/components/fields";
import { useLookup, useLookupNames } from "@/lib/lookups";
import { useBodyScrollLock } from "@/lib/hooks";
import { useLiveModule } from "@/lib/live/useLive";
import { useConfirm } from "@/lib/confirm";
import { handleFormEnterKeyNavigation } from "@/lib/formUtils";

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
  Product,
  ProductCategory,
  ProductSubCategory,
  Supplier,
  SupplierContact,
} from "@/types";

const WhatsAppIcon = ({ size = 15, style = {} }: { size?: number; style?: React.CSSProperties }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="#25D366"
    style={{ flexShrink: 0, verticalAlign: "middle", ...style }}
  >
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.414-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
  </svg>
);

const WeChatIcon = ({ size = 16, style = {} }: { size?: number; style?: React.CSSProperties }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="#07C160"
    style={{ flexShrink: 0, verticalAlign: "middle", ...style }}
  >
    <path d="M8.691 2.188C3.891 2.188 0 5.478 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.538 2.002c-.044.164.12.302.264.223l2.457-1.343a.62.62 0 01.442-.057c1.03.3 2.124.463 3.251.463.313 0 .62-.014.925-.04-.51-.976-.798-2.073-.798-3.233 0-4.053 3.89-7.343 8.69-7.343.344 0 .683.02 1.016.052C17.65 4.542 13.524 2.188 8.691 2.188zm-2.32 3.655c.64 0 1.157.518 1.157 1.157 0 .64-.518 1.157-1.157 1.157-.64 0-1.157-.518-1.157-1.157 0-.64.518-1.157 1.157-1.157zm4.637 0c.64 0 1.157.518 1.157 1.157 0 .64-.518 1.157-1.157 1.157-.64 0-1.157-.518-1.157-1.157 0-.64.518-1.157 1.157-1.157zm5.798 5.068c-4.001 0-7.243 2.74-7.243 6.12 0 1.843.974 3.502 2.502 4.625a.49.49 0 01.177.553l-.448 1.668c-.036.136.1.252.22.186l2.048-1.119a.52.52 0 01.368-.047c.758.212 1.562.328 2.376.328 4.001 0 7.243-2.74 7.243-6.12 0-3.38-3.242-6.12-7.243-6.12zm-2.028 3.06c.533 0 .964.432.964.965 0 .533-.431.964-.964.964-.533 0-.964-.431-.964-.964 0-.533.431-.965.964-.965zm4.055 0c.533 0 .964.432.964.965 0 .533-.431.964-.964.964-.533 0-.965-.431-.965-.964 0-.533.432-.965.965-.965z" />
  </svg>
);

/** Document rule: show 5 chips inline, the rest behind a "+N more" expander. */
/** Import field list for Suppliers, shared by the Import Wizard button and the Sample Template downloader so the two can never drift apart. */
const SUPPLIER_IMPORT_HEADERS: ImportHeader[] = [
  { key: "Company Name", label: "Company Name", required: true },
  { key: "Product Categories", label: "Product Categories" },
  { key: "Key Strength Sub-Categories", label: "Key Strength Sub-Categories" },
  { key: "Products Supplied", label: "Products Supplied" },
  { key: "Secondary Products", label: "Secondary Products" },
  { key: "Country", label: "Country", required: true },
  { key: "State / Province", label: "State / Province", required: true },
  { key: "City", label: "City", required: true },
  { key: "Address", label: "Address" },
  { key: "Brand Description", label: "Brand Description" },
  { key: "Supplier Type", label: "Supplier Type" },
  { key: "Current Status", label: "Current Status" },
  { key: "Supplier Grade", label: "Supplier Grade" },
  { key: "Potential", label: "Potential" },
  { key: "Potential Reason", label: "Potential Reason" },
  { key: "Contact Person", label: "Contact Person" },
  { key: "Designation", label: "Designation" },
  { key: "Calling Number", label: "Calling Number" },
  { key: "WhatsApp Number", label: "WhatsApp Number" },
  { key: "WeChat Number", label: "WeChat Number" },
  { key: "Contact Person 2", label: "Contact Person 2" },
  { key: "Designation 2", label: "Designation 2" },
  { key: "Calling Number 2", label: "Calling Number 2" },
  { key: "WhatsApp Number 2", label: "WhatsApp Number 2" },
  { key: "WeChat Number 2", label: "WeChat Number 2" },
  { key: "Emails", label: "Emails" },
  { key: "Tax ID / GST Number", label: "Tax ID / GST Number" },
  { key: "Primary Website", label: "Primary Website" },
  { key: "Secondary Website", label: "Secondary Website" },
  { key: "Visited Factory/Office", label: "Visited Factory/Office" },
  { key: "Visit Remarks", label: "Visit Remarks" },
  { key: "Overall Remarks", label: "Overall Remarks" },
  { key: "Status", label: "Status" },
];

/** 11-column table layout: merged Company Name & Brand, Category & Sub-Category, Products Supplied & Secondary, hidden Country column */
const SUPPLIER_TABLE_COLUMNS = [
  "Checkbox",
  "Sr. No.",
  "Company Name & Brand",
  "Category & Sub-Category",
  "Products Supplied & Secondary",
  "City, Province",
  "Supplier Type",
  "Current Status",
  "Grade",
  "Potential",
  "Action",
];

type ModalTab = "first" | "second" | "contacts" | "continue";

const EMPTY_SUPPLIER_FORM = {
  company_name: "",
  supplier_type: "",
  brand_description: "",
  contact_salutation: "",
  contact_full_name: "",
  contact_designation: "",
  contact_calling_number: "",
  contact_whatsapp_number: "",
  contact_wechat_number: "",
  emails: [] as string[],
  tax_id_number: "",
  address: "",
  primary_website: "",
  secondary_website: "",
  supplier_grade: "",
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
  is_primary: false,
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

function getMediaBadge(url: string) {
  const lower = url.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) {
    return { icon: "▶️", label: "YouTube Video", bg: "#fef2f2", border: "#fecaca", text: "#b91c1c" };
  }
  if (lower.includes("drive.google.com")) {
    return { icon: "📁", label: "Google Drive", bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" };
  }
  if (lower.includes("onedrive") || lower.includes("sharepoint.com")) {
    return { icon: "📂", label: "OneDrive", bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d" };
  }
  if (lower.includes("vimeo.com")) {
    return { icon: "🎬", label: "Vimeo", bg: "#faf5ff", border: "#e9d5ff", text: "#7e22ce" };
  }
  return { icon: "🎥", label: "Video Link", bg: "#f8fafc", border: "#cbd5e1", text: "#334155" };
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

function SupplierSkeletonRows({
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
  const catWidths = ["80px", "65px", "90px", "75px", "85px", "70px", "82px", "68px"];

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
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
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
                      style={{ width: "80px", height: "12px", borderRadius: "3px" }}
                    />
                  </div>
                );
                break;
              case 3:
                content = (
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <div style={{ display: "inline-flex", gap: "4px", alignItems: "center" }}>
                      <div
                        className="skeleton-line"
                        style={{
                          width: catWidths[rowIndex % catWidths.length],
                          height: "18px",
                          borderRadius: "10px",
                        }}
                      />
                      <div
                        className="skeleton-line"
                        style={{ width: "32px", height: "18px", borderRadius: "10px" }}
                      />
                    </div>
                    <div
                      className="skeleton-line"
                      style={{ width: "65px", height: "14px", borderRadius: "4px" }}
                    />
                  </div>
                );
                break;
              case 4:
                content = (
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <div
                      className="skeleton-line"
                      style={{ width: "70px", height: "14px", borderRadius: "4px" }}
                    />
                    <div
                      className="skeleton-line"
                      style={{ width: "55px", height: "12px", borderRadius: "3px" }}
                    />
                  </div>
                );
                break;
              case 5:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "85px", height: "14px", borderRadius: "4px" }}
                  />
                );
                break;
              case 6:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "75px", height: "14px", borderRadius: "4px" }}
                  />
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
                    style={{ width: "42px", height: "22px", borderRadius: "4px" }}
                  />
                );
                break;
              case 9:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "50px", height: "20px", borderRadius: "12px" }}
                  />
                );
                break;
              case 10:
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
                  width: colIdx === 0 ? "40px" : colIdx === 1 ? "65px" : colIdx === 2 ? "260px" : undefined,
                  minWidth: colIdx === 0 ? "40px" : colIdx === 1 ? "65px" : colIdx === 2 ? "200px" : undefined,
                  maxWidth: colIdx === 0 ? "45px" : colIdx === 1 ? "75px" : colIdx === 2 ? "270px" : undefined,
                  textAlign: colIdx === 0 || colIdx === 1 || colIdx === 10 ? "center" : "left",
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

export function SuppliersPage() {
  const { hasPermission } = useAuth();
  const confirm = useConfirm();
  const canCreate = hasPermission("supplier.create");
  const canUpdate = hasPermission("supplier.update");
  const canDelete = hasPermission("supplier.delete");
  const canExport = hasPermission("supplier.export");
  const canImport = hasPermission("supplier.import");
  const canBulkAction = hasPermission("supplier.bulk_action");
  const canEditGrade = hasPermission("supplier.grade_edit");
  const canEditPotential = hasPermission("supplier.potential_edit");
  const canEditCurrentStatus = hasPermission("supplier.currentstatus") || hasPermission("supplier.update");

  const [rows, setRows] = useState<Supplier[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [reloadCounter, setReloadCounter] = useState(0);
  const [namesVersion, setNamesVersion] = useState(0);

  /* Live Real-time cross-tab synchronization for Suppliers */
  useLiveModule("suppliers", () => {
    setReloadCounter((k) => k + 1);
  });

  const [searchInput, setSearchInput] = useState("");
  const [effectiveSearch, setEffectiveSearch] = useState("");
  const srNoJump = useSrNoJump();
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);

  /* Status Tab (Active vs Inactive) */
  const [statusTab, setStatusTab] = useState<"active" | "inactive">("active");

  /* Filters */
  const [filterOpen, setFilterOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [subCategoryFilter, setSubCategoryFilter] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState<string | null>(null);
  const [countryFilter, setCountryFilter] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [supplierTypeFilter, setSupplierTypeFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [potentialFilter, setPotentialFilter] = useState("");
  const [visitedFilter, setVisitedFilter] = useState("");

  const handleResetFilters = () => {
    setCategoryFilter(null);
    setSubCategoryFilter(null);
    setProductFilter(null);
    setCountryFilter(null);
    setStateFilter(null);
    setCityFilter(null);
    setSupplierTypeFilter("");
    setGradeFilter("");
    setStatusFilter("");
    setPotentialFilter("");
    setVisitedFilter("");
    setCurrentPage(1);
  };

  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImportPageOpen, setIsImportPageOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importMode, setImportMode] = useState<"create" | "update">("create");
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
  const [drawerSupplier, setDrawerSupplier] = useState<Supplier | null>(null);
  const [pinnedCols, setPinnedCols] = useState<Record<number, "left" | "right">>(() => {
    const saved = localStorage.getItem("suppliers_pinned_cols_v3");
    if (saved !== null) {
      try {
        const parsed = JSON.parse(saved);
        const sanitized: Record<number, "left" | "right"> = {};
        for (const [k, v] of Object.entries(parsed)) {
          const numKey = Number(k);
          if (numKey >= 0 && numKey < 11 && (v === "left" || v === "right")) {
            sanitized[numKey] = v;
          }
        }
        return sanitized;
      } catch {
        // fallback
      }
    }
    return { 0: "left", 1: "left", 2: "left" };
  });

  useEffect(() => {
    localStorage.setItem("suppliers_pinned_cols_v3", JSON.stringify(pinnedCols));
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
        if (colIdx >= 9) {
          next[colIdx] = "right";
        } else {
          next[colIdx] = "left";
        }
      }
      return next;
    });
  }, []);

  const displayOrder = useMemo(() => {
    const allIndices = Array.from({ length: 11 }, (_, i) => i);
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
  const [trashConflict, setTrashConflict] = useState<TrashConflictInfo | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkSupplierId = searchParams.get("id");
  const activeFetchSupplierIdRef = useRef<string | null>(null);

  const handleCloseDrawer = useCallback(() => {
    setDrawerSupplier(null);
    activeFetchSupplierIdRef.current = null;
    setSearchParams((prev) => {
      if (!prev.has("id")) return prev;
      const next = new URLSearchParams(prev);
      next.delete("id");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleOpenDrawer = useCallback(async (supplier: Supplier) => {
    setDrawerSupplier(supplier);
    try {
      const { data } = await apiGet<Supplier>(`/suppliers/${supplier.id}`);
      if (data) {
        setDrawerSupplier(data);
      }
    } catch (err) {
      console.error("Failed to load full supplier detail for drawer:", err);
    }
  }, []);

  // Sync browser back arrow with modal & drawer so it closes them instead of
  // navigating back to Dashboard.
  useModalHistorySync(modalOpen, () => setModalOpen(false));
  useModalHistorySync(Boolean(drawerSupplier), handleCloseDrawer);
  useModalHistorySync(isImportPageOpen, () => setIsImportPageOpen(false));

  // When user clicks "Suppliers" in the sidebar while already on the suppliers page,
  // return to the original supplier list/table page.
  useEffect(() => {
    const handleNavActiveClick = (e: Event) => {
      const customEvent = e as CustomEvent<{ key?: string }>;
      if (customEvent.detail?.key === "suppliers") {
        setModalOpen(false);
        setCurrentSupplierId(null);
        setError(null);
        setAlertPopup(null);
        setValidationErrors({});
        handleCloseDrawer();
        setIsImportPageOpen(false);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    };
    window.addEventListener("erp:nav-active-click", handleNavActiveClick);
    return () => window.removeEventListener("erp:nav-active-click", handleNavActiveClick);
  }, [handleCloseDrawer]);

  // Universal search deep-link: `?id=` opens that supplier's detail drawer
  // directly, so clicking a Suppliers result in the topbar search lands on
  // the actual record instead of just the bare list.
  useEffect(() => {
    if (!deepLinkSupplierId) return;
    if (activeFetchSupplierIdRef.current === deepLinkSupplierId) return;
    const targetId = deepLinkSupplierId;
    activeFetchSupplierIdRef.current = targetId;

    // Immediately replace URL in history so history.back() never returns to ?id=
    setSearchParams((prev) => {
      if (!prev.has("id")) return prev;
      const next = new URLSearchParams(prev);
      next.delete("id");
      return next;
    }, { replace: true });

    (async () => {
      try {
        const { data } = await apiGet<Supplier>(`/suppliers/${targetId}`);
        if (activeFetchSupplierIdRef.current === targetId) {
          setDrawerSupplier(data);
        }
      } catch (err) {
        console.error("Failed to load supplier detail for deep-link:", err);
      }
    })();
  }, [deepLinkSupplierId, setSearchParams]);
  const [modalMode, setModalMode] = useState<"quick" | "full">("full");
  const [modalTab, setModalTab] = useState<ModalTab>("first");
  const [currentSupplierId, setCurrentSupplierId] = useState<string | null>(null);
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
  const [isCompanyInputFocused, setIsCompanyInputFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const existingSuppliers = useLookup<Supplier>("/suppliers", 500);
  const categoriesLookup = useLookup<ProductCategory>("/masters/product-categories", 500);
  const subCategoriesLookup = useLookup<ProductSubCategory>("/masters/product-sub-categories", 500);
  const categoryNamesFallback = useLookupNames("/masters/product-categories");
  const subCategoryNamesFallback = useLookupNames("/masters/product-sub-categories");
  const productsLookup = useLookup<Product>("/masters/products", 500);

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
  const [contacts, setContacts] = useState<SupplierContact[]>([]);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [contactForm, setContactForm] = useState(EMPTY_CONTACT_FORM);
  const [contactCountryId, setContactCountryId] = useState<string | null>(null);
  const [contactPhoneCode, setContactPhoneCode] = useState<string>("");
  const [contactSameCallingWhatsapp, setContactSameCallingWhatsapp] = useState(false);
  const [contactSameCallingWechat, setContactSameCallingWechat] = useState(false);
  const [drawerError, setDrawerError] = useState<unknown>(null);
  const [contactSubmitting, setContactSubmitting] = useState(false);

  // Lock background scroll when contact drawer is active
  useBodyScrollLock(contactFormOpen);

  // Close contact drawer on Escape key
  useEffect(() => {
    if (!contactFormOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContactFormOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [contactFormOpen]);

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
      "supplier_grade",
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

  const productLabelCacheRef = useRef<Map<string, string>>(new Map());

  const fetchProductLabel = useCallback(
    async (id: string) => {
      if (productLabelCacheRef.current.has(id)) {
        return productLabelCacheRef.current.get(id)!;
      }
      const local = productsLookup.items.find((p) => p.id === id);
      if (local) {
        const lbl = `${local.product_code} — ${local.product_name || local.product_name_tally || "Product"}`;
        productLabelCacheRef.current.set(id, lbl);
        return lbl;
      }
      try {
        const { data } = await apiGet<Product>(`/masters/products/${id}`);
        const lbl = data ? `${data.product_code} — ${data.product_name || data.product_name_tally || "Product"}` : id;
        productLabelCacheRef.current.set(id, lbl);
        return lbl;
      } catch {
        return id;
      }
    },
    [productsLookup.items]
  );

  const fetchSubCategoryOptions = useCallback(
    async (query: string, signal?: AbortSignal) => {
      if (formCategoryIds.length === 0) return [];
      const q = query.trim().toLowerCase();
      let items = subCategoriesLookup.items;
      if (items.length === 0) {
        try {
          const { data } = await apiGet<{ id: string; name: string; code?: string; category_id: string }[]>(
            "/masters/product-sub-categories?page=1&page_size=500&sort_order=asc&status=active",
            { signal }
          );
          if (data) items = data as ProductSubCategory[];
        } catch {
          // fallback
        }
      }
      let filtered = items.filter((sc) => formCategoryIds.includes(sc.category_id));
      filtered = [...filtered].sort((a, b) => {
        const idxA = formCategoryIds.indexOf(a.category_id);
        const idxB = formCategoryIds.indexOf(b.category_id);
        if (idxA !== idxB) return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
        return a.name.localeCompare(b.name);
      });
      if (q) {
        filtered = filtered.filter(
          (sc) => sc.name.toLowerCase().includes(q) || (sc.code && sc.code.toLowerCase().includes(q))
        );
      }
      const catMap = new Map<string, string>();
      categoriesLookup.items.forEach((c) => catMap.set(c.id, c.name));

      return filtered.map((sc) => ({
        value: sc.id,
        label: sc.name,
        group: catMap.get(sc.category_id) || "Other Categories",
      }));
    },
    [formCategoryIds, subCategoriesLookup.items, categoriesLookup.items]
  );

  const fetchSuppliedProductOptions = useCallback(
    async (query: string, signal?: AbortSignal) => {
      if (formCategoryIds.length === 0 || formSubCategoryIds.length === 0) {
        return [];
      }
      const q = query.trim();

      try {
        const { data } = await apiGet<Product[]>(
          "/masters/products" +
            toQueryString({
              category_id: formCategoryIds.join(","),
              sub_category_id: formSubCategoryIds.join(","),
              search: q || undefined,
              status: "active",
              page: 1,
              page_size: 250,
              sort_order: "asc",
            }),
          { signal }
        );

        const list = Array.isArray(data) ? data : [];
        if (list.length === 0) return [];

        // Cache resolved product labels for instant label display
        list.forEach((p) => {
          if (p.id) {
            productLabelCacheRef.current.set(
              p.id,
              `${p.product_code} — ${p.product_name || p.product_name_tally || "Product"}`
            );
          }
        });

        // Map category and subcategory names for grouping
        const catMap = new Map<string, string>();
        categoriesLookup.items.forEach((c) => catMap.set(c.id, c.name));

        const subCatMap = new Map<string, string>();
        subCategoriesLookup.items.forEach((sc) => subCatMap.set(sc.id, sc.name));
        subCategoryNamesFallback.items.forEach((sc) => {
          if (!subCatMap.has(sc.id)) subCatMap.set(sc.id, sc.name);
        });

        // Sort products by Category selection order -> Sub-Category selection order -> Product Code
        const sorted = [...list].sort((a, b) => {
          const catIdxA = formCategoryIds.indexOf(a.category_id);
          const catIdxB = formCategoryIds.indexOf(b.category_id);
          if (catIdxA !== catIdxB) {
            return (catIdxA === -1 ? 999 : catIdxA) - (catIdxB === -1 ? 999 : catIdxB);
          }

          const subA = a.sub_category_id || "";
          const subB = b.sub_category_id || "";
          const subIdxA = formSubCategoryIds.indexOf(subA);
          const subIdxB = formSubCategoryIds.indexOf(subB);
          if (subIdxA !== subIdxB) {
            return (subIdxA === -1 ? 999 : subIdxA) - (subIdxB === -1 ? 999 : subIdxB);
          }

          return (a.product_code || "").localeCompare(b.product_code || "");
        });

        return sorted.map((p) => {
          const catName = catMap.get(p.category_id) || "Category";
          const subCatName = (p.sub_category_id ? subCatMap.get(p.sub_category_id) : "") || "Sub-Category";
          const groupTitle = formCategoryIds.length > 1 ? `${catName} › ${subCatName}` : subCatName;

          return {
            value: p.id,
            label: `${p.product_code} — ${p.product_name || p.product_name_tally || "Product"}`,
            group: groupTitle,
          };
        });
      } catch (err: any) {
        if (signal?.aborted) return [];
        console.error("Failed to fetch supplied products:", err);
        return [];
      }
    },
    [formCategoryIds, formSubCategoryIds, categoriesLookup.items, subCategoriesLookup.items, subCategoryNamesFallback.items]
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
          valA = `${a.company_name || ""} ${a.brand_description || ""}`;
          valB = `${b.company_name || ""} ${b.brand_description || ""}`;
          break;
        case 3: {
          const catA = (a.category_ids || []).map((id) => resolver.get("categories", id) || "").filter(Boolean).join(", ");
          const catB = (b.category_ids || []).map((id) => resolver.get("categories", id) || "").filter(Boolean).join(", ");
          const subA = (a.sub_category_ids || []).map((id) => resolver.get("subCategories", id) || "").filter(Boolean).join(", ");
          const subB = (b.sub_category_ids || []).map((id) => resolver.get("subCategories", id) || "").filter(Boolean).join(", ");
          valA = `${catA} ${subA}`;
          valB = `${catB} ${subB}`;
          break;
        }
        case 4: {
          const prodA = (a.product_ids || []).map((id) => resolver.get("products", id) || "").filter(Boolean).join(", ");
          const prodB = (b.product_ids || []).map((id) => resolver.get("products", id) || "").filter(Boolean).join(", ");
          valA = `${prodA} ${a.secondary_products_description || ""}`;
          valB = `${prodB} ${b.secondary_products_description || ""}`;
          break;
        }
        case 5:
          valA = `${resolver.get("cities", a.city_id) || ""}, ${resolver.get("states", a.state_id) || ""}`;
          valB = `${resolver.get("cities", b.city_id) || ""}, ${resolver.get("states", b.state_id) || ""}`;
          break;
        case 6:
          valA = a.supplier_type || "";
          valB = b.supplier_type || "";
          break;
        case 7:
          valA = a.current_status || "";
          valB = b.current_status || "";
          break;
        case 8:
          valA = a.supplier_grade || "";
          valB = b.supplier_grade || "";
          break;
        case 9:
          valA = a.potential || "";
          valB = b.potential || "";
          break;
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
      const params = {
        page: currentPage,
        page_size: pageSize,
        sort_order: "asc",
        search: effectiveSearch,
        is_active: statusTab === "active" ? "true" : "false",
        country_id: countryFilter || "",
        state_id: stateFilter || "",
        city_id: cityFilter || "",
        supplier_type: supplierTypeFilter,
        supplier_grade: gradeFilter,
        current_status: statusFilter,
        potential: potentialFilter,
        visited_factory_office: visitedFilter,
        category_id: categoryFilter || "",
        sub_category_id: subCategoryFilter || "",
        product_id: productFilter || "",
      };
      try {
        const { data, meta } = await apiGet<Supplier[]>("/suppliers" + toQueryString(params));
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
        setLoading(false);
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
    supplierTypeFilter,
    gradeFilter,
    statusFilter,
    potentialFilter,
    visitedFilter,
    categoryFilter,
    subCategoryFilter,
    productFilter,
    reloadCounter,
    resolver,
  ]);

  useEffect(() => {
    if (!loading) srNoJump.applyTo(tableBodyRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, rows]);

  const reload = () => setReloadCounter((n) => n + 1);

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
  const hasActiveSupplierFilterOrSearch =
    Boolean(effectiveSearch) ||
    Boolean(categoryFilter) ||
    Boolean(subCategoryFilter) ||
    Boolean(productFilter) ||
    Boolean(countryFilter) ||
    Boolean(stateFilter) ||
    Boolean(cityFilter) ||
    Boolean(supplierTypeFilter) ||
    Boolean(gradeFilter) ||
    Boolean(statusFilter) ||
    Boolean(potentialFilter) ||
    Boolean(visitedFilter);

  useLiveList<Supplier>({
    moduleName: "suppliers",
    setRecords: setRows,
    shouldSkip: () => hasActiveSupplierFilterOrSearch || currentPage !== 1,
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

  function renderTruncatedText(text: string | null | undefined, maxLen = 22, modalTitle = "Details", icon = "📍") {
    return (
      <TextPopoverCell
        text={text}
        maxLen={maxLen}
        title={modalTitle}
        icon={icon}
        maxWidth="150px"
        emptyText="—"
      />
    );
  }

  function chipList(
    ids: string[] | undefined,
    tableKey: string,
    modalTitle = "Selected Items",
    icon = "🏷️"
  ) {
    if (!ids || !ids.length) return <span className="muted">—</span>;
    const resolvedNames = ids.map((id) => {
      const fromResolver = resolver.get(tableKey, id);
      if (fromResolver) return fromResolver;
      if (tableKey === "categories") {
        const fb = categoryNamesFallback.items.find((c) => c.id === id)?.name || categoriesLookup.items.find((c) => c.id === id)?.name;
        if (fb) {
          resolver.set(tableKey, id, fb);
          return fb;
        }
      }
      if (tableKey === "subCategories") {
        const fb = subCategoryNamesFallback.items.find((sc) => sc.id === id)?.name || subCategoriesLookup.items.find((sc) => sc.id === id)?.name;
        if (fb) {
          resolver.set(tableKey, id, fb);
          return fb;
        }
      }
      if (tableKey === "products") {
        const fb = productsLookup.items.find((p) => p.id === id)?.product_name;
        if (fb) {
          resolver.set(tableKey, id, fb);
          return fb;
        }
      }
      return null;
    });

    const hasUnresolved = resolvedNames.some((n) => !n);
    if (hasUnresolved) {
      void resolver.resolve(tableKey, ids).then(() => setNamesVersion((n) => n + 1));
    }

    const cleanNames = resolvedNames.map((n, idx) => n || ids[idx]).filter(Boolean);

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
  async function openModal(supplier: Supplier | null, mode: "quick" | "full" = "full") {
    setCurrentSupplierId(supplier ? supplier.id : null);
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
      const primaryContact = (supplier.contacts || []).find((c) => c.is_primary) || (supplier.contacts && supplier.contacts.length > 0 ? supplier.contacts[0] : null);
      const initialName = (supplier.contact_full_name || "").trim() || (primaryContact?.person_name || "");
      const initialSalutation = (supplier.contact_salutation || "").trim() || (primaryContact?.salutation || "");
      const initialDesignation = (supplier.contact_designation || "").trim() || (primaryContact?.designation || "");
      const initialCalling = (supplier.contact_calling_number || "").trim() || (primaryContact?.calling_number || "");
      const initialWhatsapp = (supplier.contact_whatsapp_number || "").trim() || (primaryContact?.whatsapp_number || "");
      const initialWechat = (supplier.contact_wechat_number || "").trim() || (primaryContact?.wechat_number || "");
      const initialEmails = (supplier.emails && supplier.emails.length > 0)
        ? supplier.emails
        : (primaryContact?.email ? [primaryContact.email] : []);

      setForm({
        company_name: supplier.company_name || "",
        supplier_type: supplier.supplier_type || "",
        brand_description: supplier.brand_description || "",
        contact_salutation: initialSalutation,
        contact_full_name: initialName,
        contact_designation: initialDesignation,
        contact_calling_number: initialCalling,
        contact_whatsapp_number: initialWhatsapp,
        contact_wechat_number: initialWechat,
        emails: initialEmails,
        tax_id_number: supplier.tax_id_number || "",
        address: supplier.address || "",
        primary_website: supplier.primary_website || "",
        secondary_website: supplier.secondary_website || "",
        supplier_grade: supplier.supplier_grade || "",
        current_status: supplier.current_status || "",
        potential: supplier.potential ? supplier.potential.toLowerCase() : "",
        potential_reason: supplier.potential_reason || "",
        secondary_products_description: supplier.secondary_products_description || "",
        visited_factory_office: String(supplier.visited_factory_office),
        visit_remarks: supplier.visit_remarks || "",
        visit_media_input: (supplier.visit_media || []).filter((u) => !u.startsWith("http") || u.match(/\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i) || u.includes("/storage/v1/object/public/")).join(", "),
        visit_video_url: (supplier.visit_media || []).filter((u) => u.startsWith("http") && !u.match(/\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i) && !u.includes("/storage/v1/object/public/")).join(", "),
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
      if (initialCalling && initialWhatsapp === initialCalling) {
        setWhatsappSameAsCalling(true);
      }
      if (initialCalling && initialWechat === initialCalling) {
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
    setCurrentSupplierId(null);
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
    const videoLinks = isVisited && form.visit_video_url
      ? form.visit_video_url.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const visitMedia = [...visitPhotos, ...videoLinks];

    return {
      company_name: form.company_name.trim(),
      category_ids: formCategoryIds,
      supplier_type: form.supplier_type ? form.supplier_type.toLowerCase() : null,

      brand_description: form.brand_description.trim() || null,
      country_id: formCountryId,
      state_id: formStateId,
      city_id: formCityId,
      contact_salutation: form.contact_salutation || null,
      contact_full_name: form.contact_full_name.trim() || null,
      contact_designation: form.contact_designation.trim() || null,
      contact_calling_number: normalizePhoneValue(form.contact_calling_number),
      contact_whatsapp_number: normalizePhoneValue(form.contact_whatsapp_number),
      contact_wechat_number: normalizePhoneValue(form.contact_wechat_number),
      emails,
      tax_id_number: form.tax_id_number.trim() || null,
      address: form.address.trim() || null,
      primary_website: form.primary_website.trim() || null,
      secondary_website: form.secondary_website.trim() || null,
      sub_category_ids: formSubCategoryIds,
      product_ids: formProductIds,
      supplier_grade: form.supplier_grade || null,
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

  async function saveSupplierData(nextAction?: ModalTab | "exit") {
    // 1. Validate immediate required fields
    const initialErrors: Record<string, string> = {};
    if (!form.company_name.trim()) {
      initialErrors.company_name = "Company Name is required.";
    } else {
      const cleanTyped = form.company_name.trim().toLowerCase().replace(/[\s-]/g, "");
      const localDuplicate = existingSuppliers.items.find((s) => {
        if (currentSupplierId && String(s.id).toLowerCase() === String(currentSupplierId).toLowerCase()) return false;
        const sName = (s.company_name || "").toLowerCase().replace(/[\s-]/g, "");
        return sName === cleanTyped;
      });
      if (localDuplicate) {
        initialErrors.company_name = `Supplier "${localDuplicate.company_name}" already exists in Supplier Master. Cannot save duplicate.`;
      }
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

    // Check full database via server search if not already caught locally
    if (!initialErrors.company_name && form.company_name.trim()) {
      try {
        const { data: searchResults } = await apiGet<Supplier[]>(
          "/suppliers" + toQueryString({ search: form.company_name.trim(), page: 1, page_size: 10 })
        );
        const cleanTyped = form.company_name.trim().toLowerCase().replace(/[\s-]/g, "");
        const serverDuplicate = (searchResults || []).find((s) => {
          if (currentSupplierId && String(s.id).toLowerCase() === String(currentSupplierId).toLowerCase()) return false;
          const sName = (s.company_name || "").toLowerCase().replace(/[\s-]/g, "");
          return sName === cleanTyped;
        });
        if (serverDuplicate) {
          initialErrors.company_name = `Supplier "${serverDuplicate.company_name}" already exists in Supplier Master. Cannot save duplicate.`;
        }
      } catch {
        // Fallback to backend POST/PATCH validation
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
      const existingSupplier = rows.find((s) => s.id === currentSupplierId);
      const payload = {
        ...basePayload,
        version: existingSupplier?.version,
        state_id: stateId || formStateId,
        city_id: cityId || formCityId,
        category_ids: categoryIds,
      };

      const { data: supplier } = currentSupplierId
        ? await apiPatch<Supplier>(`/suppliers/${currentSupplierId}`, payload)
        : await apiPost<Supplier>("/suppliers", payload);
      setCurrentSupplierId(supplier.id);
      setContacts(supplier.contacts || []);
      if (currentSupplierId && supplier) {
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
    } catch (err: any) {
      if (err?.details?.in_trash) {
        setTrashConflict(err.details);
        return false;
      }
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
      if (
        lower.includes("company_name") ||
        lower.includes("company name") ||
        lower.includes("supplier '") ||
        lower.includes("already exists in supplier master") ||
        lower.includes("already exists in the trash")
      ) {
        setValidationErrors((prev) => ({ ...prev, company_name: msg }));
        focusAndScrollToField("company_name");
        return false;
      }
      const title = lower.includes("duplicate") || lower.includes("already exists")
        ? "Duplicate Supplier Warning"
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
      await saveSupplierData("exit");
    } else {
      if (modalTab === "first") {
        await saveSupplierData("second");
      } else if (modalTab === "second") {
        await saveSupplierData("contacts");
      }
    }
  }

  async function handleSaveAndContinue(e: React.MouseEvent) {
    e.preventDefault();
    await saveSupplierData("continue");
  }

  async function handleSaveAndExit(e: React.MouseEvent) {
    e.preventDefault();
    await saveSupplierData("exit");
  }

  async function refreshSupplierProfileAfterContactChange(supplierId: string) {
    try {
      const [supplierRes, contactsRes] = await Promise.all([
        apiGet<Supplier>(`/suppliers/${supplierId}`),
        apiGet<SupplierContact[]>(`/suppliers/${supplierId}/contacts`),
      ]);
      if (supplierRes.data) {
        const fullSupplier = supplierRes.data;
        setForm((prev) => ({
          ...prev,
          contact_salutation: fullSupplier.contact_salutation || "",
          contact_full_name: fullSupplier.contact_full_name || "",
          contact_designation: fullSupplier.contact_designation || "",
          contact_calling_number: fullSupplier.contact_calling_number || "",
          contact_whatsapp_number: fullSupplier.contact_whatsapp_number || "",
          contact_wechat_number: fullSupplier.contact_wechat_number || "",
          emails: fullSupplier.emails || [],
        }));
        setRows((prev) =>
          prev.map((r) =>
            r.id === supplierId
              ? {
                  ...r,
                  contact_salutation: fullSupplier.contact_salutation || null,
                  contact_full_name: fullSupplier.contact_full_name || null,
                  contact_designation: fullSupplier.contact_designation || null,
                  contact_calling_number: fullSupplier.contact_calling_number || null,
                  contact_whatsapp_number: fullSupplier.contact_whatsapp_number || null,
                  contact_wechat_number: fullSupplier.contact_wechat_number || null,
                  emails: fullSupplier.emails || [],
                }
              : r
          )
        );
      }
      if (contactsRes.data) {
        setContacts(contactsRes.data);
      }
    } catch (err) {
      console.error("Failed to re-sync supplier profile after contact change:", err);
    }
  }

  async function refreshContacts() {
    if (!currentSupplierId) return;
    await refreshSupplierProfileAfterContactChange(currentSupplierId);
  }

  function openContactForm(contact: SupplierContact | null) {
    setDrawerError(null);
    setContactSubmitting(false);
    const hasExistingPrimary = contacts.some((c) => c.is_primary);
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
          is_primary: Boolean(contact.is_primary),
        }
        : {
          ...EMPTY_CONTACT_FORM,
          is_primary: !hasExistingPrimary || !form.contact_full_name.trim(),
        }
    );
    setContactCountryId(contact?.country_id || formCountryId || defaultChinaId || null);
    setContactSameCallingWhatsapp(false);
    setContactSameCallingWechat(false);
    setContactFormOpen(true);
  }

  async function handleContactSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setDrawerError(null);

    if (!currentSupplierId) return;

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
      is_primary: contactForm.is_primary,
    };

    setContactSubmitting(true);
    try {
      if (contactForm.id) {
        await apiPatch(`/suppliers/${currentSupplierId}/contacts/${contactForm.id}`, payload);
      } else {
        await apiPost(`/suppliers/${currentSupplierId}/contacts`, payload);
      }
      setContactFormOpen(false);
      await refreshSupplierProfileAfterContactChange(currentSupplierId);
    } catch (err) {
      setDrawerError(err);
    } finally {
      setContactSubmitting(false);
    }
  }

  async function handleMakePrimaryContact(contactId: string) {
    if (!currentSupplierId) return;
    await guardRowAction(`primary-contact:${contactId}`, async () => {
      try {
        await apiPost(`/suppliers/${currentSupplierId}/contacts/${contactId}/make-primary`, {});
        await refreshSupplierProfileAfterContactChange(currentSupplierId);
      } catch (err) {
        setError(err);
      }
    });
  }

  async function handleContactDelete(contactId: string) {
    const confirmed = await confirm({
      title: "Delete Contact Person",
      message: "Are you sure you want to remove this contact person? This action cannot be undone.",
      confirmLabel: "Delete Contact",
      variant: "danger",
    });
    if (!confirmed) return;
    await guardRowAction(`delete-contact:${contactId}`, async () => {
      try {
        await apiDelete(`/suppliers/${currentSupplierId}/contacts/${contactId}`);
        await refreshContacts();
      } catch (err) {
        setError(err);
      }
    });
  }

  async function handleRowEdit(id: string) {
    try {
      const { data } = await apiGet<Supplier>(`/suppliers/${id}`);
      await openModal(data);
    } catch (err) {
      setError(err);
    }
  }

  async function handleRowDelete(id: string) {
    const row = rows.find((r) => r.id === id);
    const suppName = row?.company_name || "this supplier";
    const confirmed = await confirm({
      title: "Delete Supplier",
      message: `Are you sure you want to delete supplier "${suppName}"? This action cannot be undone.`,
      itemName: suppName,
      confirmLabel: "Delete Supplier",
      variant: "danger",
    });
    if (!confirmed) return;
    await guardRowAction(`delete:${id}`, async () => {
      try {
        await apiDelete(`/suppliers/${id}`);
        setRows((prev) => prev.filter((r) => r.id !== id));
        setPagination((prev) => (prev ? { ...prev, total_records: Math.max(0, (prev.total_records || 1) - 1) } : prev));
      } catch (err) {
        setError(err);
      }
    });
  }

  async function handleBulkDelete() {
    if (!selectedIds.length) return;
    const confirmed = await confirm({
      title: "Delete Selected Suppliers",
      message: `Delete ${selectedIds.length} selected supplier(s)? This action cannot be undone.`,
      confirmLabel: "Delete Selected",
      variant: "danger",
    });
    if (!confirmed) return;
    await guardRowAction("bulk-delete", async () => {
      try {
        await Promise.all(selectedIds.map((id) => apiDelete(`/suppliers/${id}`)));
        setRows((prev) => prev.filter((r) => !selectedIds.includes(r.id)));
        setSelectedIds([]);
      } catch (err) {
        setError(err);
      }
    });
  }

  async function handleBulkDeactivate() {
    if (!selectedIds.length) return;
    const confirmed = await confirm({
      title: "Deactivate Selected Suppliers",
      message: `Deactivate ${selectedIds.length} selected supplier(s)? They can be reactivated anytime.`,
      confirmLabel: "Deactivate",
      variant: "warning",
    });
    if (!confirmed) return;
    await guardRowAction("bulk-deactivate", async () => {
      try {
        await Promise.all(selectedIds.map((id) => apiPost(`/suppliers/${id}/deactivate`, {})));
        setSelectedIds([]);
        reload();
      } catch (err) {
        setError(err);
      }
    });
  }

  async function handleBulkActivate() {
    if (!selectedIds.length) return;
    const confirmed = await confirm({
      title: "Activate Selected Suppliers",
      message: `Activate ${selectedIds.length} selected supplier(s)?`,
      confirmLabel: "Activate",
      variant: "primary",
    });
    if (!confirmed) return;
    await guardRowAction("bulk-activate", async () => {
      try {
        await Promise.all(selectedIds.map((id) => apiPost(`/suppliers/${id}/activate`, {})));
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
      await downloadExport("/suppliers", format, "suppliers");
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
      <AppShell activeKey="suppliers" pageClassName="page-suppliers">
        <main className="page" style={{ width: "100%", padding: "16px 24px", boxSizing: "border-box" }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <div>
              <h1 className="page-title">Import Suppliers</h1>
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
                    Upload only brand new supplier accounts. Any rows with duplicate supplier names or contact numbers will be safely skipped.
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
                    Update existing suppliers matching supplier names. <strong>Zero Data Loss:</strong> Blank cells in your file are ignored and will never erase existing fields.
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
                    ? "Strict creation mode: Existing database records remain untouched. Any duplicate rows will be reported."
                    : "Safe non-destructive update: Only columns with values in your uploaded file will update matching records. Empty columns are kept intact."}
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
                  onClick={() => downloadSampleCsv("supplier", SUPPLIER_IMPORT_HEADERS)}
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
                <li><strong>Country, Province / State, City, Product Category, Key Strength Sub Category, And Supplier Type</strong> Must Already Exist In The System.</li>
                <li><strong>Key Strength Sub Category</strong> Must Belong To The Selected <strong>Product Category</strong>.</li>
                <li><strong>Calling Number</strong>, <strong>WhatsApp Number</strong>, And <strong>WeChat Number</strong> Must Include Country Code (Maximum 15 Digits Total).</li>
                <li>Multiple <strong>Emails</strong>, <strong>Product Categories</strong>, And <strong>Key Strength Sub Categories</strong> Can Be Separated By Comma (,).</li>
                <li><strong>Visited Factory/Office</strong> Must Be <em>Yes</em> Or <em>No</em>; If <em>Yes</em>, <strong>Visit Remarks</strong> Can Be Provided.</li>
                <li><strong>Current Status</strong> Must Be <em>Existing</em> Or <em>New</em>; <strong>Potential</strong> Must Be <em>Yes</em> Or <em>No</em>; <strong>Supplier Grade</strong> Must Be <em>A</em>, <em>B</em>, Or <em>C</em>.</li>
                <li>No Blank Rows, Merged Cells, Or Excel Formulas Allowed.</li>
                <li>Supplier Import May Take <strong>Several Seconds</strong> Depending On The Number Of Rows And Server Load. Please Do Not Refresh The Page During Import.</li>
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
                {importLoading
                  ? "Importing..."
                  : importMode === "update"
                  ? "Proceed with Update"
                  : "Import"}
              </button>
            </div>
          </div>

          {/* Column Mapping Wizard Modal (Matches Supplier & Buyer Master) */}
          {wizardPending && (
            <WizardModal
              file={wizardPending.file}
              rows={wizardPending.rows}
              sheetColumns={wizardPending.sheetColumns}
              apiBase="/suppliers"
              entityName="supplier"
              importHeaders={SUPPLIER_IMPORT_HEADERS}
              initialMode={importMode}
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

  return (
    <AppShell activeKey="suppliers" pageClassName="page-suppliers">
      {modalOpen ? (
        <main className="page" style={{ width: "100%", padding: "20px 24px" }}>
          {/* Header Bar with Back Button */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <div>
              <h1 className="page-title">
                {modalMode === "quick" ? "Add Supplier (Quick)" : (currentSupplierId ? "Edit Supplier" : "Add Supplier")}
              </h1>
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
              ← BACK TO SUPPLIERS
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
                {currentSupplierId && (
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
            {/* TAB 1: PROFILE FORM (SAME ORIGINAL DATA & FIELDS) */}
            {(editTab === "profile" || modalMode === "quick") && (
              <form onSubmit={handleSubmit} onKeyDown={handleFormEnterKeyNavigation} noValidate>
                {/* SECTION 1: General & Primary Contact Info (First Data Form) */}
                <div style={{ marginBottom: "24px" }}>
                  <h3 style={{ fontSize: "16px", fontWeight: 700, margin: "0 0 16px 0", color: "#0f172a" }}>
                    1. General Information
                  </h3>
                  {/* Row 1: Company Name + Category (2 columns) */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px", marginBottom: "18px" }}>
                    <div className="field" style={{ position: "relative" }}>
                      <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>
                        Name of Company <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <input
                        id="company_name"
                        type="text"
                        value={form.company_name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setField("company_name", val);
                          if (validationErrors.company_name) setValidationErrors((prev) => ({ ...prev, company_name: "" }));
                        }}
                        placeholder="Enter supplier company name..."
                        autoComplete="off"
                        style={{
                          width: "100%",
                          height: "38px",
                          padding: "0 12px",
                          fontSize: "13px",
                          borderRadius: "6px",
                          border: validationErrors.company_name ? "1.5px solid #ef4444" : "1px solid #cbd5e1",
                          backgroundColor: validationErrors.company_name ? "#fff5f5" : "#ffffff",
                          boxShadow: validationErrors.company_name ? "0 0 0 3px rgba(239, 68, 68, 0.15)" : "none",
                          color: "#0f172a",
                          outline: "none",
                          boxSizing: "border-box",
                          transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                        }}
                        onFocus={(e) => {
                          setIsCompanyInputFocused(true);
                          if (!validationErrors.company_name) {
                            e.target.style.borderColor = "#2563eb";
                            e.target.style.boxShadow = "0 0 0 3px rgba(37, 99, 235, 0.15)";
                          }
                        }}
                        onBlur={(e) => {
                          setTimeout(() => setIsCompanyInputFocused(false), 200);
                          if (!validationErrors.company_name) {
                            e.target.style.borderColor = "#cbd5e1";
                            e.target.style.boxShadow = "none";
                          }
                        }}
                      />
                      {validationErrors.company_name && (
                        <div style={{ color: "#ef4444", fontSize: "12px", fontWeight: 600, marginTop: "5px", display: "flex", alignItems: "center", gap: "4px" }}>
                          <span>⚠️</span> {validationErrors.company_name}
                        </div>
                      )}
                      {(() => {
                        const typed = (form.company_name || "").trim();
                        if (!typed) return null;
                        const cleanTyped = typed.toLowerCase().replace(/[\s-]/g, "");

                        const exact = existingSuppliers.items.find((s) => {
                          if (currentSupplierId && String(s.id).toLowerCase() === String(currentSupplierId).toLowerCase()) return false;
                          const sName = (s.company_name || "").toLowerCase().replace(/[\s-]/g, "");
                          return sName === cleanTyped;
                        });

                        const matches = existingSuppliers.items
                          .filter((s) => {
                            if (currentSupplierId && String(s.id).toLowerCase() === String(currentSupplierId).toLowerCase()) return false;
                            const sName = (s.company_name || "").toLowerCase().replace(/[\s-]/g, "");
                            return sName.includes(cleanTyped);
                          })
                          .sort((a, b) => {
                            const aClean = (a.company_name || "").toLowerCase().replace(/[\s-]/g, "");
                            const bClean = (b.company_name || "").toLowerCase().replace(/[\s-]/g, "");
                            const aStarts = aClean.startsWith(cleanTyped);
                            const bStarts = bClean.startsWith(cleanTyped);
                            if (aStarts && !bStarts) return -1;
                            if (!aStarts && bStarts) return 1;
                            return (a.company_name || "").localeCompare(b.company_name || "");
                          })
                          .slice(0, 8);

                        return (
                          <>
                            {/* Floating Suggestion Dropdown (Untouchable / Non-selectable suggestions) */}
                            {isCompanyInputFocused && matches.length > 0 && (
                              <div
                                onMouseDown={(e) => e.preventDefault()}
                                style={{
                                  position: "absolute",
                                  top: "calc(100% + 4px)",
                                  left: 0,
                                  right: 0,
                                  backgroundColor: "#ffffff",
                                  borderRadius: "8px",
                                  border: "1px solid #cbd5e1",
                                  boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.12), 0 8px 10px -6px rgba(15, 23, 42, 0.08)",
                                  zIndex: 100,
                                  maxHeight: "280px",
                                  overflowY: "auto",
                                  padding: 0,
                                }}
                              >
                                {exact && (
                                  <div
                                    style={{
                                      padding: "8px 12px",
                                      background: "#fef2f2",
                                      borderBottom: "1px solid #fee2e2",
                                      color: "#dc2626",
                                      fontSize: "12px",
                                      fontWeight: 600,
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "6px",
                                    }}
                                  >
                                    <span>⛔</span>
                                    <span>Supplier "{exact.company_name}" already exists in Master! Cannot save duplicate.</span>
                                  </div>
                                )}
                                <div
                                  style={{
                                    padding: "7px 12px",
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.05em",
                                    color: "#64748b",
                                    borderBottom: "1px solid #f1f5f9",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    background: "#f8fafc",
                                  }}
                                >
                                  <span>Existing in Master ({matches.length})</span>
                                  <span
                                    style={{
                                      fontSize: "10px",
                                      fontWeight: 600,
                                      background: "#f1f5f9",
                                      color: "#64748b",
                                      padding: "1px 6px",
                                      borderRadius: "4px",
                                      textTransform: "none",
                                    }}
                                  >
                                    Reference Only (Non-selectable)
                                  </span>
                                </div>
                                <div style={{ padding: "4px 0" }}>
                                  {matches.map((s) => {
                                    const isThisExact = (s.company_name || "").trim().toLowerCase() === typed.toLowerCase();
                                    return (
                                      <div
                                        key={s.id}
                                        style={{
                                          padding: "8px 12px",
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "space-between",
                                          fontSize: "12.5px",
                                          color: isThisExact ? "#dc2626" : "#334155",
                                          backgroundColor: isThisExact ? "#fff5f5" : "transparent",
                                          borderLeft: isThisExact ? "3px solid #ef4444" : "3px solid transparent",
                                          userSelect: "none",
                                          pointerEvents: "none",
                                          cursor: "default",
                                        }}
                                      >
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                          <span style={{ color: "#94a3b8", fontSize: "13px" }}>🏢</span>
                                          <span style={{ fontWeight: isThisExact ? 700 : 500 }}>{s.company_name}</span>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                          {s.supplier_type && (
                                            <span
                                              style={{
                                                fontSize: "10.5px",
                                                padding: "1px 6px",
                                                borderRadius: "4px",
                                                background: "#f1f5f9",
                                                color: "#475569",
                                                fontWeight: 500,
                                              }}
                                            >
                                              {s.supplier_type}
                                            </span>
                                          )}
                                          <span style={{ fontSize: "10px", color: "#94a3b8", fontStyle: "italic" }}>
                                            (In master)
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                <div
                                  style={{
                                    padding: "6px 12px",
                                    borderTop: "1px solid #f1f5f9",
                                    fontSize: "11px",
                                    color: "#64748b",
                                    background: "#f8fafc",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "4px",
                                  }}
                                >
                                  <span>ℹ️</span>
                                  <span>Existing master suggestions. You can type freely without selecting.</span>
                                </div>
                              </div>
                            )}

                            {/* Static alert when input blurred or exact match duplicate */}
                            {exact && !isCompanyInputFocused && (
                              <div
                                style={{
                                  marginTop: "6px",
                                  fontSize: "12.5px",
                                  color: "#dc2626",
                                  fontWeight: 700,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  background: "#fef2f2",
                                  padding: "6px 10px",
                                  borderRadius: "6px",
                                  border: "1px solid #fecaca",
                                }}
                              >
                                <span>⛔</span> Supplier "{exact.company_name}" already exists in Supplier Master! Cannot save duplicate.
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    <div className="field">
                      <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>Category</label>
                      <SearchableDropdownMultiPanel
                        values={formCategoryIds}
                        onChange={(newCatIds) => {
                          setFormCategoryIds(newCatIds);
                          // Auto-prune any subCategoryIds and productIds that no longer belong to selected categories
                          if (newCatIds.length === 0) {
                            setFormSubCategoryIds([]);
                            setFormProductIds([]);
                          } else {
                            const validCategorySubIds = subCategoriesLookup.items
                              .filter((sc) => newCatIds.includes(sc.category_id))
                              .map((sc) => sc.id);
                            setFormSubCategoryIds((prevSubIds) =>
                              prevSubIds.filter((id) => validCategorySubIds.includes(id))
                            );
                            setFormProductIds((prevProdIds) =>
                              prevProdIds.filter((pId) => {
                                const prod = productsLookup.items.find((p) => p.id === pId);
                                if (!prod) return true;
                                return newCatIds.includes(prod.category_id) && (!prod.sub_category_id || validCategorySubIds.includes(prod.sub_category_id));
                              })
                            );
                          }
                        }}
                        placeholder="-- Select Categories --"
                        fetchOptions={searchFetcher("/masters/product-categories")}
                        fetchLabelForValue={fetchNameLabel("/masters/product-categories")}
                      />
                    </div>
                  </div>

                  {/* Row 1.5: Key Strength Sub-Category + Products Supplied (2 columns) */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px", marginBottom: "18px" }}>
                    <div className="field">
                      <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>Sub Category (key strength)</label>
                      <SearchableDropdownMultiPanel
                        values={formSubCategoryIds}
                        onChange={(newSubIds) => {
                          setFormSubCategoryIds(newSubIds);
                          // Auto-prune any productIds that no longer belong to selected sub-categories
                          if (newSubIds.length === 0) {
                            setFormProductIds([]);
                          } else {
                            setFormProductIds((prevProdIds) =>
                              prevProdIds.filter((pId) => {
                                const prod = productsLookup.items.find((p) => p.id === pId);
                                if (!prod) return true;
                                return prod.sub_category_id ? newSubIds.includes(prod.sub_category_id) : true;
                              })
                            );
                          }
                        }}
                        disabled={formCategoryIds.length === 0}
                        placeholder={formCategoryIds.length > 0 ? "-- Select Sub-Categories --" : "-- Please select Category first --"}
                        fetchOptions={fetchSubCategoryOptions}
                        fetchLabelForValue={fetchNameLabel("/masters/product-sub-categories")}
                      />
                    </div>
                    <div className="field">
                      <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>Products Supplied (multiple)</label>
                      <SearchableDropdownMultiPanel
                        values={formProductIds}
                        onChange={setFormProductIds}
                        disabled={formCategoryIds.length === 0 || formSubCategoryIds.length === 0}
                        placeholder={
                          formCategoryIds.length === 0
                            ? "-- Please select Category first --"
                            : formSubCategoryIds.length === 0
                            ? "-- Please select Sub-Categories first --"
                            : "-- Select Products Supplied --"
                        }
                        fetchOptions={fetchSuppliedProductOptions}
                        fetchLabelForValue={fetchProductLabel}
                      />
                    </div>
                  </div>

                  {/* Row 2: Supplier Type + Brand of Supplier's Products (2 columns) */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px", marginBottom: "18px" }}>
                    <div className="field">
                      <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>Supplier Type</label>
                      <SearchableDropdown
                        value={form.supplier_type ? form.supplier_type : null}
                        onChange={(_v, label) => setField("supplier_type", label || _v || "")}
                        allowCustomText={true}
                        onTextChange={(text) => setField("supplier_type", text)}
                        placeholder="Search or select supplier type..."
                        fetchOptions={searchFetcher("/masters/supplier-types")}
                        fetchLabelForValue={async (val) => val}
                      />
                    </div>
                    <TextField id="brand_description" label="Brand of Supplier's Products" placeholder="Description..." value={form.brand_description} onChange={(v) => setField("brand_description", v)} />
                  </div>



                  {/* Row 3: Country + Province + City (3 columns) */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px", marginBottom: "24px" }}>
                    <div className="field">
                      <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>
                        Country <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <SearchableDropdown
                        id="field-country"
                        hasError={Boolean(validationErrors["field-country"])}
                        value={formCountryId}
                        onChange={async (v) => {
                          setFormCountryId(v);
                          setFormStateId(null);
                          setFormCityId(null);
                          setFormStateCustomText("");
                          setFormCityCustomText("");
                          setValidationErrors((prev) => ({ ...prev, "field-country": "", "field-province": "", "field-city": "" }));
                          const newCode = await resolveCountryPhoneCode(v);
                          setFormCountryPhoneCode(newCode);
                          setForm((prev) => ({
                            ...prev,
                            contact_calling_number: replacePhonePrefix(prev.contact_calling_number, newCode),
                            contact_whatsapp_number: replacePhonePrefix(prev.contact_whatsapp_number, newCode),
                            contact_wechat_number: replacePhonePrefix(prev.contact_wechat_number, newCode),
                          }));
                        }}
                        placeholder="Search country..."
                        fetchOptions={searchFetcher("/masters/countries")}
                        fetchLabelForValue={fetchNameLabel("/masters/countries")}
                      />
                      {validationErrors["field-country"] && (
                        <div style={{ color: "#ef4444", fontSize: "12px", fontWeight: 600, marginTop: "5px", display: "flex", alignItems: "center", gap: "4px" }}>
                          <span>⚠️</span> {validationErrors["field-country"]}
                        </div>
                      )}
                    </div>
                    <div className="field">
                      <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>
                        Province <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <SearchableDropdown
                        key={`field-province-${formCountryId || ""}`}
                        id="field-province"
                        hasError={Boolean(validationErrors["field-province"])}
                        value={formStateId}
                        onChange={(v) => {
                          setFormStateId(v);
                          setFormCityId(null);
                          setValidationErrors((prev) => ({ ...prev, "field-province": "", "field-city": "" }));
                        }}
                        placeholder="Search province from Master..."
                        fetchOptions={searchFetcher("/masters/states", (): Record<string, string> =>
                          formCountryId ? { country_id: formCountryId } : {}
                        )}
                        fetchLabelForValue={fetchNameLabel("/masters/states")}
                      />
                      {validationErrors["field-province"] && (
                        <div style={{ color: "#ef4444", fontSize: "12px", fontWeight: 600, marginTop: "5px", display: "flex", alignItems: "center", gap: "4px" }}>
                          <span>⚠️</span> {validationErrors["field-province"]}
                        </div>
                      )}
                    </div>
                    <div className="field">
                      <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>
                        City <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <SearchableDropdown
                        key={`field-city-${formCountryId || ""}-${formStateId || ""}`}
                        id="field-city"
                        disabled={!formStateId}
                        hasError={Boolean(validationErrors["field-city"])}
                        value={formCityId}
                        onChange={(v, label) => {
                          setFormCityId(v);
                          setFormCityCustomText(v ? label : "");
                          setValidationErrors((prev) => ({ ...prev, "field-city": "" }));
                        }}
                        placeholder={formStateId ? "Search city from Master..." : "Select a province first..."}
                        fetchOptions={
                          !formStateId
                            ? async () => []
                            : searchFetcher("/masters/cities", (): Record<string, string> => ({
                              state_id: formStateId,
                            }))
                        }
                        fetchLabelForValue={fetchNameLabel("/masters/cities")}
                      />
                      {validationErrors["field-city"] && (
                        <div style={{ color: "#ef4444", fontSize: "12px", fontWeight: 600, marginTop: "5px", display: "flex", alignItems: "center", gap: "4px" }}>
                          <span>⚠️</span> {validationErrors["field-city"]}
                        </div>
                      )}
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <TextField
                        id="address"
                        label="Address"
                        maxLength={500}
                        placeholder="Street address, building, floor, room..."
                        value={form.address}
                        onChange={(v) => setField("address", v)}
                      />
                    </div>
                  </div>

                  <h4 style={{ fontSize: "14.5px", fontWeight: 700, margin: "0 0 14px 0", color: "#0f172a" }}>
                    Primary Contact Information
                  </h4>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px" }}>
                    <div className="field">
                      <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>Mr. / Mrs / Ms - Full Name</label>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <select
                          value={form.contact_salutation}
                          onChange={(e) => setField("contact_salutation", e.target.value)}
                          style={{
                            padding: "8px",
                            fontSize: "13.5px",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            background: "#ffffff",
                            color: "#334155",
                          }}
                        >
                          <option value="">—</option>
                          <option value="Mr.">Mr.</option>
                          <option value="Mrs.">Mrs.</option>
                          <option value="Ms.">Ms.</option>
                        </select>
                        <input
                          type="text"
                          maxLength={150}
                          placeholder="Full Name"
                          value={form.contact_full_name}
                          onChange={(e) => setField("contact_full_name", e.target.value)}
                          style={{
                            flex: 1,
                            padding: "8px 11px",
                            fontSize: "13.5px",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            outline: "none",
                          }}
                        />
                      </div>
                    </div>

                    <TextField id="contact_designation" label="Designation" placeholder="e.g. Sales Manager" maxLength={150} value={form.contact_designation} onChange={(v) => setField("contact_designation", v)} />

                    <PhoneGroupField
                      id="field-calling-number"
                      label="Calling Number"
                      defaultPrefix={formCountryPhoneCode}
                      value={form.contact_calling_number}
                      hasError={Boolean(validationErrors["field-calling-number"] || callingNumberError)}
                      hint={
                        validationErrors["field-calling-number"] || callingNumberError ? (
                          <span>
                            <span>⚠️</span> {validationErrors["field-calling-number"] || callingNumberError}
                          </span>
                        ) : undefined
                      }
                      onChange={(val) => {
                        setField("contact_calling_number", val);
                        const err = validatePhoneNumber(val, "Calling number");
                        setCallingNumberError(err);
                        setValidationErrors((prev) => ({ ...prev, "field-calling-number": err || "" }));
                        if (whatsappSameAsCalling) {
                          setField("contact_whatsapp_number", val);
                          const wErr = validatePhoneNumber(val, "WhatsApp number");
                          setValidationErrors((prev) => ({ ...prev, "field-whatsapp-number": wErr || "" }));
                        }
                        if (wechatSameAsCalling) {
                          setField("contact_wechat_number", val);
                        }
                      }}
                      placeholder="13800000000"
                    />

                    <PhoneGroupField
                      id="field-whatsapp-number"
                      defaultPrefix={formCountryPhoneCode}
                      label={
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: "12px", fontWeight: 600, color: "#475569" }}>WhatsApp Number</span>
                          <label style={{ fontSize: "11px", color: "#64748b", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 500 }}>
                            <input
                              type="checkbox"
                              checked={whatsappSameAsCalling}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setWhatsappSameAsCalling(checked);
                                if (checked) {
                                  setField("contact_whatsapp_number", form.contact_calling_number);
                                  const wErr = validatePhoneNumber(form.contact_calling_number, "WhatsApp number");
                                  setValidationErrors((prev) => ({ ...prev, "field-whatsapp-number": wErr || "" }));
                                }
                              }}
                            />
                            Same as calling
                          </label>
                        </div>
                      }
                      value={form.contact_whatsapp_number}
                      hasError={Boolean(validationErrors["field-whatsapp-number"])}
                      hint={
                        validationErrors["field-whatsapp-number"] ? (
                          <span>
                            <span>⚠️</span> {validationErrors["field-whatsapp-number"]}
                          </span>
                        ) : undefined
                      }
                      onChange={(val) => {
                        setWhatsappSameAsCalling(false);
                        setField("contact_whatsapp_number", val);
                        const err = validatePhoneNumber(val, "WhatsApp number");
                        setValidationErrors((prev) => ({ ...prev, "field-whatsapp-number": err || "" }));
                      }}
                      placeholder="13800000000"
                    />

                    <PhoneGroupField
                      id="field-wechat-number"
                      defaultPrefix={formCountryPhoneCode}
                      label={
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: "12px", fontWeight: 600, color: "#475569" }}>WeChat Number</span>
                          <label style={{ fontSize: "11px", color: "#64748b", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 500 }}>
                            <input
                              type="checkbox"
                              checked={wechatSameAsCalling}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setWechatSameAsCalling(checked);
                                if (checked) setField("contact_wechat_number", form.contact_calling_number);
                              }}
                            />
                            Same as calling
                          </label>
                        </div>
                      }
                      value={form.contact_wechat_number}
                      hasError={Boolean(validationErrors["field-wechat-number"])}
                      hint={
                        validationErrors["field-wechat-number"] ? (
                          <span>
                            <span>⚠️</span> {validationErrors["field-wechat-number"]}
                          </span>
                        ) : undefined
                      }
                      onChange={(val) => {
                        setWechatSameAsCalling(false);
                        setField("contact_wechat_number", val);
                        if (validationErrors["field-wechat-number"]) {
                          setValidationErrors((prev) => ({ ...prev, "field-wechat-number": "" }));
                        }
                      }}
                      placeholder="13800000000"
                    />

                    <EmailTagInput
                      id="emails"
                      label="Email IDs (Multiple)"
                      emails={form.emails}
                      onChange={(newEmails) => setForm((prev) => ({ ...prev, emails: newEmails }))}
                      placeholder="Type email address and press Enter..."
                    />
                  </div>
                </div>

                {/* SECTION 2: Supplier Profile & Verification Details */}
                {modalMode === "full" && (
                  <div style={{ marginBottom: "24px", borderTop: "1px solid #e2e8f0", paddingTop: "24px" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, margin: "0 0 16px 0", color: "#0f172a" }}>
                      2. Supplier Profile &amp; Verification Details
                    </h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px", marginBottom: "18px" }}>
                      <TextField id="tax_id_number" label="Tax ID Number" maxLength={100} value={form.tax_id_number} onChange={(v) => setField("tax_id_number", v)} />
                      <WebsiteField id="primary_website" label="Primary Website" placeholder="https://..." value={form.primary_website} onChange={(v) => setField("primary_website", v)} />
                      <WebsiteField id="secondary_website" label="Secondary Website" placeholder="https://..." value={form.secondary_website} onChange={(v) => setField("secondary_website", v)} />
                      <SelectField id="supplier_grade" label="Supplier Grade" value={form.supplier_grade} onChange={(v) => setField("supplier_grade", v)}>
                        <option value="">Select Grade</option>
                        <option value="A">Grade A</option>
                        <option value="B">Grade B</option>
                        <option value="C">Grade C</option>
                      </SelectField>
                      <SelectField id="current_status" label="Current Status" value={form.current_status} onChange={(v) => setField("current_status", v)}>
                        <option value="">Select</option>
                        <option value="new" disabled={lockNewStatus}>New</option>
                        <option value="existing">Existing</option>
                      </SelectField>
                      <SelectField id="potential" label="Potential (Yes / No)" value={form.potential ? form.potential.toLowerCase() : ""} onChange={(v) => setField("potential", v.toLowerCase())}>
                        <option value="">Select Potential</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </SelectField>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px", marginBottom: "18px" }}>
                      <TextAreaField
                        id="potential_reason"
                        label="Reason for Potential Status"
                        placeholder="Explain why..."
                        rows={2}
                        value={form.potential_reason}
                        onChange={(v) => setField("potential_reason", v)}
                      />
                      <TextAreaField
                        id="secondary_products_description"
                        label="Secondary Products Description"
                        placeholder="Secondary products..."
                        rows={2}
                        value={form.secondary_products_description}
                        onChange={(v) => setField("secondary_products_description", v)}
                      />
                    </div>

                    <div style={{ marginBottom: "18px" }}>
                      <SelectField id="visited_factory_office" label="Visited Factory / Office?" value={String(form.visited_factory_office).toLowerCase() === "true" ? "true" : "false"} onChange={(v) => setField("visited_factory_office", v)}>
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </SelectField>
                    </div>

                    {String(form.visited_factory_office).toLowerCase() === "true" && (
                      <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "8px", border: "1px solid #e2e8f0", marginBottom: "18px" }}>
                        <div style={{ marginBottom: "16px" }}>
                          <TextField
                            id="visit_remarks"
                            label="Visit Remarks / Summary"
                            placeholder="Key observations from factory/office visit..."
                            value={form.visit_remarks}
                            onChange={(v) => setField("visit_remarks", v)}
                          />
                        </div>

                        <div style={{ marginBottom: "16px" }}>
                          <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "6px", display: "block" }}>
                            Visit Photos (Factory / Office)
                          </label>
                          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
                            <label
                              className="btn btn-small"
                              style={{
                                background: "#0061f2",
                                color: "#ffffff",
                                border: "none",
                                borderRadius: "6px",
                                padding: "7px 14px",
                                fontWeight: 600,
                                fontSize: "12.5px",
                                cursor: uploadingMedia ? "not-allowed" : "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                              }}
                            >
                              📁 {uploadingMedia ? "Uploading..." : "Select Photos"}
                              <input
                                type="file"
                                multiple
                                accept="image/*"
                                onChange={(e) => void handleMediaFileUpload(e.target.files)}
                                disabled={uploadingMedia}
                                style={{ display: "none" }}
                              />
                            </label>
                            {uploadingMedia && (
                              <span style={{ fontSize: "12px", color: "#64748b" }}>
                                Uploading photos, please wait...
                              </span>
                            )}
                          </div>

                          {mediaList.length > 0 && (
                            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "8px" }}>
                              {mediaList.map((url, idx) => (
                                <div
                                  key={idx}
                                  style={{
                                    position: "relative",
                                    width: "100px",
                                    height: "80px",
                                    borderRadius: "6px",
                                    overflow: "hidden",
                                    border: "1px solid #cbd5e1",
                                    background: "#ffffff",
                                  }}
                                >
                                  <img
                                    src={resolveImageUrl(url)}
                                    alt={`Visit photo ${idx + 1}`}
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeMediaUrl(url)}
                                    title="Remove photo"
                                    style={{
                                      position: "absolute",
                                      top: "4px",
                                      right: "4px",
                                      width: "22px",
                                      height: "22px",
                                      borderRadius: "50%",
                                      background: "rgba(239, 68, 68, 0.9)",
                                      color: "#ffffff",
                                      border: "none",
                                      cursor: "pointer",
                                      fontSize: "12px",
                                      fontWeight: 700,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div>
                          <VideoTagInput
                            id="visit_video_url"
                            label="Factory Video / Inspection Folder Link (Optional)"
                            placeholder="Paste YouTube, Drive or OneDrive links and press Enter or comma..."
                            value={form.visit_video_url}
                            onChange={(v) => setField("visit_video_url", v)}
                          />
                        </div>
                      </div>
                    )}

                    <div style={{ marginBottom: "16px" }}>
                      <TextAreaField id="overall_remarks" label="Overall Remarks / Key Strengths" rows={2} value={form.overall_remarks} onChange={(v) => setField("overall_remarks", v)} />
                    </div>
                  </div>
                )}

                {Boolean(error) && (
                  <div style={{ marginTop: "20px" }}>
                    <Banner error={error} />
                  </div>
                )}

                {/* FORM FOOTER ACTION BUTTONS */}
                <div style={{ paddingTop: "24px", marginTop: "28px", borderTop: "1px solid #e2e8f0", display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                  <button type="button" className="btn" onClick={closeModal} style={{ background: "#ffffff", border: "1px solid #cbd5e1", color: "#475569", padding: "10px 20px", borderRadius: "6px", fontWeight: 600, fontSize: "14px" }}>
                    Cancel
                  </button>
                  {modalMode === "quick" ? (
                    <>
                      <button
                        type="button"
                        className="btn"
                        disabled={saving}
                        style={{
                          background: "#ffffff",
                          border: "1px solid #cbd5e1",
                          color: "#334155",
                          padding: "10px 24px",
                          borderRadius: "6px",
                          fontWeight: 600,
                          fontSize: "14px",
                          cursor: saving ? "not-allowed" : "pointer",
                          opacity: saving ? 0.7 : 1,
                        }}
                        onClick={handleSaveAndExit}
                      >
                        {saving ? "Saving..." : "Save & Exit"}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={saving}
                        style={{
                          background: "#0061f2",
                          color: "#ffffff",
                          padding: "10px 24px",
                          borderRadius: "6px",
                          fontWeight: 600,
                          fontSize: "14px",
                          border: "none",
                          cursor: saving ? "not-allowed" : "pointer",
                          opacity: saving ? 0.7 : 1,
                          boxShadow: "0 2px 6px rgba(0, 97, 242, 0.25)",
                        }}
                        onClick={handleSaveAndContinue}
                      >
                        {saving ? "Saving..." : "Save & Continue"}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      disabled={saving}
                      style={{
                        background: "#0061f2",
                        color: "#ffffff",
                        padding: "10px 24px",
                        borderRadius: "6px",
                        fontWeight: 600,
                        fontSize: "14px",
                        border: "none",
                        cursor: saving ? "not-allowed" : "pointer",
                        opacity: saving ? 0.7 : 1,
                        boxShadow: "0 2px 6px rgba(0, 97, 242, 0.25)",
                      }}
                      onClick={handleSaveAndExit}
                    >
                      {saving ? "Saving..." : (currentSupplierId ? "Save Changes" : "Save Supplier")}
                    </button>
                  )}
                </div>
              </form>
            )}

            {/* TAB 2: CONTACTS TAB VIEW */}
            {modalMode === "full" && currentSupplierId && editTab === "contacts" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                  <div>
                    <h3 style={{ fontSize: "17px", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                      Supplier Contacts
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
                {contactFormOpen &&
                  createPortal(
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-label={contactForm.id ? "Edit Contact Person" : "Add New Contact"}
                      style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 99999,
                        display: "flex",
                        justifyContent: "flex-end",
                      }}
                    >
                      {/* Dark Backdrop Overlay with smooth fade */}
                      <div
                        onClick={() => setContactFormOpen(false)}
                        style={{
                          position: "absolute",
                          inset: 0,
                          background: "rgba(15, 23, 42, 0.45)",
                          backdropFilter: "blur(2px)",
                          animation: "backdropFadeIn 0.2s ease forwards",
                        }}
                      />

                      {/* Side Drawer Panel with smooth slide-in */}
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
                          zIndex: 100000,
                          animation: "slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards",
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
                          id="supplier-contact-drawer-form"
                          autoComplete="none"
                          onSubmit={(e) => { void handleContactSubmit(e); }}
                          onKeyDown={handleFormEnterKeyNavigation}
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

                        {/* Primary Contact Option */}
                        <div style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                          <label style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "8px", margin: 0 }}>
                            <input
                              type="checkbox"
                              checked={Boolean(contactForm.is_primary)}
                              onChange={(e) => setContactForm((prev) => ({ ...prev, is_primary: e.target.checked }))}
                              style={{ width: "16px", height: "16px", cursor: "pointer" }}
                            />
                            <span>★ Set as Primary Contact <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 400 }}>(Reflects into Supplier Profile)</span></span>
                          </label>
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
                          type="submit"
                          form="supplier-contact-drawer-form"
                          disabled={contactSubmitting}
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
                  </div>,
                  document.body
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
                        <th style={{ padding: "12px 14px", textAlign: "center", fontSize: "12px", fontWeight: 700, color: "#475569", textTransform: "uppercase", minWidth: "220px", width: "230px" }}>ACTION</th>
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
                              <div style={{ fontWeight: 700, color: "#0f172a", fontSize: "13.5px", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                <span>{c.salutation ? `${c.salutation} ` : ""}{c.person_name}</span>
                                {c.is_primary ? (
                                  <span style={{ background: "#dbeafe", color: "#1d4ed8", fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                    ★ Primary
                                  </span>
                                ) : (
                                  <span style={{ background: "#f1f5f9", color: "#64748b", fontSize: "11px", fontWeight: 500, padding: "2px 6px", borderRadius: "4px" }}>
                                    Secondary
                                  </span>
                                )}
                              </div>
                              {c.designation ? (
                                <div style={{ fontSize: "12.5px", color: "#64748b", marginTop: "2px" }}>{c.designation}</div>
                              ) : (
                                <div style={{ fontSize: "12px", color: "#cbd5e1" }}>—</div>
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
                              <div style={{ display: "flex", gap: "8px", justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
                                {!c.is_primary && (
                                  <button
                                    type="button"
                                    disabled={isRowActionPending(`primary-contact:${c.id}`)}
                                    onClick={() => handleMakePrimaryContact(c.id)}
                                    style={{
                                      background: "#eff6ff",
                                      color: "#1d4ed8",
                                      border: "1px solid #bfdbfe",
                                      borderRadius: "5px",
                                      padding: "5px 10px",
                                      fontSize: "12px",
                                      fontWeight: 600,
                                      cursor: isRowActionPending(`primary-contact:${c.id}`) ? "default" : "pointer",
                                      opacity: isRowActionPending(`primary-contact:${c.id}`) ? 0.6 : 1,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "4px",
                                    }}
                                    title="Set this contact as Primary (syncs to Supplier Profile)"
                                  >
                                    {isRowActionPending(`primary-contact:${c.id}`) ? "Updating…" : "★ Make Primary"}
                                  </button>
                                )}
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
          <div className="page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
            <div>
              <h1 className="page-title">Supplier Profiles</h1>
            </div>
            <div className="page-header-actions" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <button
                type="button"
                className={`btn btn-header-filter ${filterOpen ? "active" : ""}`}
                style={{
                  background: filterOpen ? "#0061f2" : "#475569",
                  color: "#ffffff",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                }}
                onClick={() => setFilterOpen((v) => !v)}
                title="Toggle Filter Options"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                </svg>
              </button>
              {canCreate && (
                <button className="btn btn-quick-add" onClick={() => openModal(null, "quick")}>
                  + QUICK ADD
                </button>
              )}
              {canCreate && (
                <button className="btn btn-add-new" onClick={() => openModal(null, "full")}>
                  + ADD NEW
                </button>
              )}
              <ImpExpDropdown
                apiBase="/suppliers"
                entityName="supplier"
                importHeaders={SUPPLIER_IMPORT_HEADERS}
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
                padding: "20px",
                borderRadius: "10px",
                border: "1px solid #cbd5e1",
                marginBottom: "16px",
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <div style={{ fontWeight: 600, fontSize: "14px", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                  </svg>
                  Filter Options
                </div>
                <button
                  type="button"
                  className="btn btn-small"
                  style={{ background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}
                  onClick={handleResetFilters}
                >
                  Reset Filters
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "14px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>Category</label>
                  <SearchableFilterDropdown
                    value={categoryFilter}
                    onChange={(v) => {
                      setCurrentPage(1);
                      setCategoryFilter(v);
                      if (v !== categoryFilter) {
                        setSubCategoryFilter(null);
                      }
                    }}
                    allLabel="All"
                    placeholder="All"
                    fetchOptions={searchFetcher("/masters/product-categories")}
                    fetchLabelForValue={fetchNameLabel("/masters/product-categories")}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>Product Sub Category</label>
                  <SearchableFilterDropdown
                    value={subCategoryFilter}
                    onChange={(v) => {
                      setCurrentPage(1);
                      setSubCategoryFilter(v);
                    }}
                    allLabel="All"
                    placeholder="All"
                    fetchOptions={
                      categoryFilter
                        ? searchFetcher("/masters/product-sub-categories", (): Record<string, string> => ({
                            category_id: categoryFilter,
                          }))
                        : searchFetcher("/masters/product-sub-categories")
                    }
                    fetchLabelForValue={fetchNameLabel("/masters/product-sub-categories")}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>Product</label>
                  <SearchableFilterDropdown
                    value={productFilter}
                    onChange={(v) => {
                      setCurrentPage(1);
                      setProductFilter(v);
                    }}
                    allLabel="All"
                    placeholder={subCategoryFilter ? "All (in sub-category)" : categoryFilter ? "All (in category)" : "All"}
                    fetchOptions={async (term, signal) => {
                      const params: Record<string, string> = {
                        search: term,
                        page: "1",
                        page_size: "100",
                        sort_order: "asc",
                        status: "active",
                      };
                      if (categoryFilter) params.category_id = categoryFilter;
                      if (subCategoryFilter) params.sub_category_id = subCategoryFilter;
                      const { data } = await apiGet<Product[]>("/masters/products" + toQueryString(params), { signal });
                      return (data || []).map((d) => ({
                        value: d.id,
                        label: `${d.product_code} — ${d.product_name || d.product_name_tally || "Product"}`,
                      }));
                    }}
                    fetchLabelForValue={fetchProductLabel}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>Country</label>
                  <SearchableFilterDropdown
                    value={countryFilter}
                    onChange={(v) => {
                      setCountryFilter(v);
                      setStateFilter(null);
                      setCityFilter(null);
                      setCurrentPage(1);
                    }}
                    allLabel="All"
                    placeholder="All"
                    fetchOptions={searchFetcher("/masters/countries")}
                    fetchLabelForValue={fetchNameLabel("/masters/countries")}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>Province / State</label>
                  <SearchableFilterDropdown
                    value={stateFilter}
                    onChange={(v) => {
                      setStateFilter(v);
                      setCityFilter(null);
                      setCurrentPage(1);
                    }}
                    allLabel="All"
                    placeholder="All"
                    fetchOptions={
                      countryFilter
                        ? searchFetcher("/masters/states", (): Record<string, string> => ({
                            country_id: countryFilter,
                          }))
                        : searchFetcher("/masters/states")
                    }
                    fetchLabelForValue={fetchNameLabel("/masters/states")}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>City</label>
                  <SearchableFilterDropdown
                    value={cityFilter}
                    onChange={(v) => {
                      setCityFilter(v);
                      setCurrentPage(1);
                    }}
                    allLabel="All"
                    placeholder="All"
                    fetchOptions={
                      stateFilter || countryFilter
                        ? searchFetcher("/masters/cities", (): Record<string, string> => {
                            const p: Record<string, string> = {};
                            if (stateFilter) p.state_id = stateFilter;
                            else if (countryFilter) p.country_id = countryFilter;
                            return p;
                          })
                        : searchFetcher("/masters/cities")
                    }
                    fetchLabelForValue={fetchNameLabel("/masters/cities")}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>Supplier Type</label>
                  <SearchableFilterDropdown
                    value={supplierTypeFilter || null}
                    onChange={(_v, label) => {
                      setCurrentPage(1);
                      setSupplierTypeFilter(_v ? (label || _v) : "");
                    }}
                    allLabel="All"
                    placeholder="All"
                    fetchOptions={searchFetcher("/masters/supplier-types")}
                    fetchLabelForValue={async (val) => val}
                  />
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>Supplier's Grade</label>
                  <select
                    value={gradeFilter}
                    onChange={(e) => {
                      setCurrentPage(1);
                      setGradeFilter(e.target.value);
                    }}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  >
                    <option value="">Grade: All</option>
                    <option value="A">Grade A</option>
                    <option value="B">Grade B</option>
                    <option value="C">Grade C</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>Current Status</label>
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setCurrentPage(1);
                      setStatusFilter(e.target.value);
                    }}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  >
                    <option value="">Current Status: All</option>
                    <option value="new">New</option>
                    <option value="existing">Existing</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>Potential</label>
                  <select
                    value={potentialFilter}
                    onChange={(e) => {
                      setCurrentPage(1);
                      setPotentialFilter(e.target.value);
                    }}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  >
                    <option value="">Potential: All</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>Visited Factory/Office?</label>
                  <select
                    value={visitedFilter}
                    onChange={(e) => {
                      setCurrentPage(1);
                      setVisitedFilter(e.target.value);
                    }}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  >
                    <option value="">Visited Factory/Office: All</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
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
                        {SUPPLIER_TABLE_COLUMNS.map((label, idx) => {
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
                  placeholder="Search company, country, contact, city, phone..."
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
                      const label = SUPPLIER_TABLE_COLUMNS[idx];
                      const isPinned = Boolean(pinnedCols[idx]);
                      const isSrNo = idx === 1;
                      const isAction = idx === 10;
                      const isSorted = sortColIndex === idx;
                      return (
                        <th
                          key={`col-${idx}-${label}`}
                          style={{
                            height: "auto",
                            minHeight: "36px",
                            whiteSpace: "normal",
                            verticalAlign: "middle",
                            padding: "6px 8px",
                            ...(isSrNo
                              ? { width: "75px", minWidth: "75px", maxWidth: "85px", textAlign: "center" }
                              : isAction
                              ? { textAlign: "center" }
                              : idx === 2
                              ? { width: "260px", minWidth: "200px", maxWidth: "270px" }
                              : idx === 7
                              ? { width: "105px", minWidth: "95px", maxWidth: "115px" }
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
                                <span style={{ whiteSpace: "normal", wordBreak: "normal", lineHeight: 1.25 }}>
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
                    <SupplierSkeletonRows count={8} displayOrder={displayOrder} getFreezeStyle={getFreezeStyle} />
                  ) : sortedRows.length === 0 ? (
                    <TableMessageRow colSpan={11}>No suppliers found.</TableMessageRow>
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
                                <td key="cell-1" className="cell-srno" style={{ width: "65px", minWidth: "65px", maxWidth: "75px", textAlign: "center", ...getFreezeStyle(1, false) }}>
                                  {startSrNo + index}
                                </td>
                              );
                            case 2:
                              return (
                                <td
                                  key="cell-2"
                                  style={{
                                    width: "260px",
                                    minWidth: "200px",
                                    maxWidth: "270px",
                                    whiteSpace: "normal",
                                    height: "auto",
                                    verticalAlign: "middle",
                                    ...getFreezeStyle(2, false),
                                  }}
                                >
                                  <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                    <a
                                      href="#"
                                      title={s.company_name}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        void handleOpenDrawer(s);
                                      }}
                                      style={{
                                        display: "-webkit-box",
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: "vertical",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        wordBreak: "break-word",
                                        lineHeight: "1.35",
                                        maxHeight: "2.7em",
                                        fontWeight: 600,
                                        color: "#0061f2",
                                        textDecoration: "none",
                                      }}
                                    >
                                      {s.company_name}
                                    </a>
                                    {s.brand_description ? (
                                      <div
                                        title={`Brand: ${s.brand_description}`}
                                        style={{
                                          fontSize: "11px",
                                          color: "#475569",
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: "4px",
                                          lineHeight: 1.2,
                                        }}
                                      >
                                        <span
                                          style={{
                                            background: "#f1f5f9",
                                            color: "#334155",
                                            padding: "1px 6px",
                                            borderRadius: "3px",
                                            fontWeight: 600,
                                            border: "1px solid #e2e8f0",
                                            maxWidth: "230px",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                            display: "inline-block",
                                          }}
                                        >
                                          🏷️ {s.brand_description}
                                        </span>
                                      </div>
                                    ) : null}
                                  </div>
                                </td>
                              );
                            case 3:
                              return (
                                <td key="cell-3" style={getFreezeStyle(3, false)}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                    <div>
                                      {chipList(s.category_ids, "categories", "Categories", "🏷️")}
                                    </div>
                                    {s.sub_category_ids && s.sub_category_ids.length > 0 && (
                                      <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                                        <span style={{ color: "#94a3b8", fontSize: "11px", userSelect: "none", fontWeight: 700 }}>↳</span>
                                        {chipList(s.sub_category_ids, "subCategories", "Sub-Categories", "📂")}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              );
                            case 4: {
                              const hasProducts = s.product_ids && s.product_ids.length > 0;
                              const hasSecondary = Boolean(s.secondary_products_description && s.secondary_products_description.trim());

                              if (!hasProducts && !hasSecondary) {
                                return (
                                  <td key="cell-4" style={getFreezeStyle(4, false)}>
                                    <span className="muted">—</span>
                                  </td>
                                );
                              }

                              return (
                                <td key="cell-4" style={getFreezeStyle(4, false)}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                    {hasProducts && (
                                      <div>
                                        {chipList(s.product_ids, "products", "Products Supplied", "📦")}
                                      </div>
                                    )}
                                    {hasSecondary && (
                                      <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                                        {hasProducts && <span style={{ color: "#94a3b8", fontSize: "11px", userSelect: "none", fontWeight: 700 }}>↳</span>}
                                        {renderTruncatedText(s.secondary_products_description, 20, "Secondary Products", "📦")}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              );
                            }
                            case 5:
                              return (
                                <td key="cell-5" style={getFreezeStyle(5, false)}>
                                  {resolver.get("cities", s.city_id) || "…"},{" "}
                                  {resolver.get("states", s.state_id) || "…"}
                                </td>
                              );
                            case 6:
                              return (
                                <td key="cell-6" style={getFreezeStyle(6, false)}>
                                  {s.supplier_type ? s.supplier_type : <span className="muted">—</span>}
                                </td>
                              );
                            case 7: {
                              const currStatus = (s.current_status || "").toLowerCase();
                              const isExisting = currStatus === "existing";
                              const isNew = currStatus === "new";
                              const statusBg = isExisting ? "#dcfce7" : isNew ? "#fef9c3" : "#f8fafc";
                              const statusColor = isExisting ? "#15803d" : isNew ? "#854d0e" : "#64748b";

                              return (
                                <td key="cell-7" style={{ width: "115px", minWidth: "105px", maxWidth: "125px", ...getFreezeStyle(7, false) }}>
                                  {canEditCurrentStatus ? (
                                    <select
                                      className="inline-select"
                                      value={currStatus}
                                      onChange={(e) =>
                                        handleInlineUpdate(s.id, `/suppliers/${s.id}/current-status`, {
                                          current_status: e.target.value || null,
                                        })
                                      }
                                      style={{
                                        padding: "3px 6px",
                                        borderRadius: "4px",
                                        fontSize: "12px",
                                        fontWeight: 600,
                                        border: "1px solid #cbd5e1",
                                        background: statusBg,
                                        color: statusColor,
                                        cursor: "pointer",
                                      }}
                                    >
                                      <option value="">SELECT</option>
                                      {!isExisting && <option value="new">NEW</option>}
                                      <option value="existing">EXISTING</option>
                                    </select>
                                  ) : (
                                    <span
                                      style={{
                                        padding: "3px 8px",
                                        borderRadius: "12px",
                                        fontSize: "11.5px",
                                        fontWeight: 600,
                                        background: statusBg,
                                        color: statusColor,
                                        display: "inline-block",
                                      }}
                                    >
                                      {s.current_status ? s.current_status.toUpperCase() : "SELECT"}
                                    </span>
                                  )}
                                </td>
                              );
                            }
                            case 8:
                              return (
                                <td key="cell-8" style={getFreezeStyle(8, false)}>
                                  {canEditGrade ? (
                                    <select
                                      className="inline-select"
                                      value={s.supplier_grade || ""}
                                      onChange={(e) =>
                                        handleInlineUpdate(s.id, `/suppliers/${s.id}/grade`, {
                                          supplier_grade: e.target.value || null,
                                        })
                                      }
                                    >
                                      <option value="">Select</option>
                                      <option value="A">A</option>
                                      <option value="B">B</option>
                                      <option value="C">C</option>
                                    </select>
                                  ) : (
                                    <span>{s.supplier_grade || "—"}</span>
                                  )}
                                </td>
                              );
                            case 9:
                              return (
                                <td key="cell-9" style={getFreezeStyle(9, false)}>
                                  {canEditPotential ? (
                                    <select
                                      className="inline-select"
                                      value={s.potential || ""}
                                      onChange={(e) =>
                                        handleInlineUpdate(s.id, `/suppliers/${s.id}/potential`, {
                                          potential: e.target.value || null,
                                        })
                                      }
                                    >
                                      <option value="">Select</option>
                                      <option value="yes">Yes</option>
                                      <option value="no">No</option>
                                    </select>
                                  ) : (
                                    <span>{s.potential ? s.potential.toUpperCase() : "—"}</span>
                                  )}
                                </td>
                              );
                            case 10:
                              return (
                                <td key="cell-10" className="actions" style={{ textAlign: "center", ...getFreezeStyle(10, false) }}>
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
                                        title="Edit Supplier"
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
                                              ? "Cannot delete Existing or Potential suppliers; set to Inactive instead."
                                              : "Delete Supplier"
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

      {drawerSupplier && (() => {
        const visitMediaRaw = drawerSupplier.visit_media || [];
        const photoUrls = visitMediaRaw.filter((u) => !u.startsWith("http") || u.match(/\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i) || u.includes("/storage/v1/object/public/"));
        const videoUrls = visitMediaRaw.filter((u) => u.startsWith("http") && !u.match(/\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i) && !u.includes("/storage/v1/object/public/"));

        return (
          <SideDrawer
            open={Boolean(drawerSupplier)}
            title={`Supplier Detail #${drawerSupplier.company_name}`}
            subtitle={`Supplier Type: ${drawerSupplier.supplier_type || "—"} | Status: ${drawerSupplier.is_active ? "Active" : "Inactive"}`}
            onClose={handleCloseDrawer}
            cardStyle={{ maxWidth: "720px", width: "100%" }}
            onEdit={
              canUpdate
                ? () => {
                  const id = drawerSupplier.id;
                  handleCloseDrawer();
                  void handleRowEdit(id);
                }
                : undefined
            }
            editLabel="✏️ Edit Supplier"
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* CARD 1: Company Profile & Classification */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <h4 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 12px 0", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                  🏢 Company Profile &amp; Classification
                </h4>
                <DetailFieldGrid
                  fields={[
                    { label: "Company Name", value: drawerSupplier.company_name, fullWidth: true },
                    { label: "Supplier Type", value: drawerSupplier.supplier_type ? drawerSupplier.supplier_type.toUpperCase() : "—" },
                    { label: "Brand Description", value: drawerSupplier.brand_description || "—" },
                    { label: "Tax ID / GST Number", value: drawerSupplier.tax_id_number || "—" },
                    { label: "Country", value: resolver.get("countries", drawerSupplier.country_id) || "—" },
                    { label: "Province / State", value: resolver.get("states", drawerSupplier.state_id) || "—" },
                    { label: "City", value: resolver.get("cities", drawerSupplier.city_id) || "—" },
                    { label: "Address", value: drawerSupplier.address || "—", fullWidth: true },
                    { label: "Product Categories", value: chipList(drawerSupplier.category_ids, "categories"), fullWidth: true },
                    { label: "Sub-Categories", value: chipList(drawerSupplier.sub_category_ids, "subCategories"), fullWidth: true },
                    { label: "Products Supplied", value: chipList(drawerSupplier.product_ids, "products"), fullWidth: true },
                    { label: "Secondary Products", value: drawerSupplier.secondary_products_description || "—", fullWidth: true },
                  ]}
                />
              </div>

              {/* CARD 2: Primary Contact & Websites */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <h4 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 12px 0", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                  👤 Primary Contact Information
                </h4>
                <DetailFieldGrid
                  fields={[
                    {
                      label: "Contact Person",
                      value: `${drawerSupplier.contact_salutation || ""} ${drawerSupplier.contact_full_name || ""}`.trim() || "—",
                    },
                    { label: "Designation", value: drawerSupplier.contact_designation || "—" },
                    {
                      label: "Calling Number",
                      value: drawerSupplier.contact_calling_number ? (
                        <a href={`tel:${drawerSupplier.contact_calling_number}`} style={{ color: "#0061f2", textDecoration: "none", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          📞 {drawerSupplier.contact_calling_number}
                        </a>
                      ) : "—",
                    },
                    {
                      label: "WhatsApp Number",
                      value: drawerSupplier.contact_whatsapp_number ? (
                        <a
                          href={`https://wa.me/${drawerSupplier.contact_whatsapp_number.replace(/[^0-9]/g, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "#16a34a", textDecoration: "none", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: "6px" }}
                        >
                          <WhatsAppIcon size={16} /> {drawerSupplier.contact_whatsapp_number} ↗
                        </a>
                      ) : "—",
                    },
                    {
                      label: "WeChat Number",
                      value: drawerSupplier.contact_wechat_number ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#059669", fontWeight: 500 }}>
                          <WeChatIcon size={17} /> {drawerSupplier.contact_wechat_number}
                        </span>
                      ) : "—",
                    },
                    {
                      label: "Email Addresses",
                      value: drawerSupplier.emails && drawerSupplier.emails.length ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {drawerSupplier.emails.map((em) => (
                            <a
                              key={em}
                              href={`mailto:${em}`}
                              style={{
                                color: "#2563eb",
                                background: "#eff6ff",
                                border: "1px solid #bfdbfe",
                                borderRadius: "4px",
                                padding: "2px 8px",
                                fontSize: "12.5px",
                                fontWeight: 500,
                                textDecoration: "none",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              ✉️ {em}
                            </a>
                          ))}
                        </div>
                      ) : "—",
                      fullWidth: true,
                    },
                    {
                      label: "Primary Website",
                      value: drawerSupplier.primary_website ? (
                        <a
                          href={drawerSupplier.primary_website.startsWith("http") ? drawerSupplier.primary_website : `https://${drawerSupplier.primary_website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "#0284c7", textDecoration: "none", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "4px" }}
                        >
                          🌐 {drawerSupplier.primary_website.replace(/^https?:\/\/(www\.)?/, "")} ↗
                        </a>
                      ) : "—",
                    },
                    {
                      label: "Secondary Website",
                      value: drawerSupplier.secondary_website ? (
                        <a
                          href={drawerSupplier.secondary_website.startsWith("http") ? drawerSupplier.secondary_website : `https://${drawerSupplier.secondary_website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "#0284c7", textDecoration: "none", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "4px" }}
                        >
                          🌐 {drawerSupplier.secondary_website.replace(/^https?:\/\/(www\.)?/, "")} ↗
                        </a>
                      ) : "—",
                    },
                  ]}
                />
              </div>

              {/* CARD 3: Factory Visit & Media */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <h4 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 12px 0", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                  🏭 Factory Visit &amp; Inspection Media
                </h4>
                <DetailFieldGrid
                  fields={[
                    {
                      label: "Visited Factory / Office",
                      value: drawerSupplier.visited_factory_office ? (
                        <span style={{ background: "#dcfce7", color: "#15803d", padding: "2px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: 600 }}>
                          ✓ Yes, Visited
                        </span>
                      ) : (
                        <span style={{ background: "#f1f5f9", color: "#64748b", padding: "2px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: 600 }}>
                          No
                        </span>
                      ),
                    },
                    {
                      label: "Visit Remarks",
                      value: drawerSupplier.visit_remarks || "—",
                    },
                    {
                      label: "Factory Video / Inspection Folder Links",
                      value: videoUrls.length > 0 ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                          {videoUrls.map((url, idx) => {
                            const meta = getMediaBadge(url);
                            return (
                              <a
                                key={idx}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  background: meta.bg,
                                  border: `1px solid ${meta.border}`,
                                  color: meta.text,
                                  borderRadius: "6px",
                                  padding: "4px 10px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  textDecoration: "none",
                                }}
                              >
                                <span>{meta.icon}</span>
                                <span>{meta.label}</span>
                                <span style={{ fontSize: "11px", opacity: 0.8 }}>↗</span>
                              </a>
                            );
                          })}
                        </div>
                      ) : "—",
                      fullWidth: true,
                    },
                    ...(photoUrls.length > 0
                      ? [
                        {
                          label: "Factory Photos / Media Attachments",
                          value: (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                              {photoUrls.map((pUrl, pIdx) => (
                                <a
                                  key={pIdx}
                                  href={pUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    display: "inline-block",
                                    width: "68px",
                                    height: "68px",
                                    borderRadius: "6px",
                                    overflow: "hidden",
                                    border: "1px solid #cbd5e1",
                                  }}
                                >
                                  <img src={pUrl} alt={`Visit attachment ${pIdx + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                </a>
                              ))}
                            </div>
                          ),
                          fullWidth: true,
                        },
                      ]
                      : []),
                  ]}
                />
              </div>

              {/* CARD 4: Pipeline Status & Evaluation */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <h4 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 12px 0", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                  📊 Pipeline Status &amp; Commercial Evaluation
                </h4>
                <DetailFieldGrid
                  fields={[
                    { label: "Supplier Grade", value: drawerSupplier.supplier_grade ? `Grade ${drawerSupplier.supplier_grade.toUpperCase()}` : "—" },
                    { label: "Current Status", value: <StatusPill value={drawerSupplier.current_status} /> },
                    {
                      label: "Potential (Yes / No)",
                      value: drawerSupplier.potential ? (
                        <span
                          style={{
                            background: drawerSupplier.potential.toLowerCase() === "yes" ? "#dcfce7" : "#fee2e2",
                            color: drawerSupplier.potential.toLowerCase() === "yes" ? "#166534" : "#991b1b",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            fontWeight: 700,
                          }}
                        >
                          {drawerSupplier.potential.toUpperCase()}
                        </span>
                      ) : "—",
                    },
                    { label: "Reason for Potential Status", value: drawerSupplier.potential_reason || "—", fullWidth: true },
                    { label: "Overall Remarks / Key Strengths", value: drawerSupplier.overall_remarks || "—", fullWidth: true },
                  ]}
                />
              </div>

              {/* CARD 5: Additional Contacts */}
              {drawerSupplier.contacts && drawerSupplier.contacts.length > 0 && (
                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                  <h4 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 12px 0", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                    👥 Additional Contacts ({drawerSupplier.contacts.length})
                  </h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {drawerSupplier.contacts.map((c, i) => (
                      <div key={c.id || i} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 16px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                          <div>
                            <span style={{ fontWeight: 700, color: "#0f172a", fontSize: "13.5px" }}>
                              {c.salutation ? `${c.salutation} ` : ""}{c.person_name}
                            </span>
                            {c.designation && <span style={{ color: "#64748b", fontSize: "12.5px", marginLeft: "6px" }}>• {c.designation}</span>}
                          </div>
                          {c.handling_territory && (
                            <span style={{ fontSize: "11px", fontWeight: 600, background: "#e0f2fe", color: "#0369a1", padding: "1px 6px", borderRadius: "4px" }}>
                              📍 {c.handling_territory}
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", fontSize: "12.5px", color: "#334155" }}>
                          {c.calling_number && (
                            <a href={`tel:${c.calling_number}`} style={{ color: "#0061f2", textDecoration: "none", fontWeight: 500 }}>
                              📞 {c.calling_number}
                            </a>
                          )}
                          {c.whatsapp_number && (
                            <a href={`https://wa.me/${c.whatsapp_number.replace(/[^0-9]/g, "")}`} target="_blank" rel="noopener noreferrer" style={{ color: "#16a34a", textDecoration: "none", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: "5px" }}>
                              <WhatsAppIcon size={14} /> {c.whatsapp_number} ↗
                            </a>
                          )}
                          {c.wechat_number && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: "#059669", fontWeight: 500 }}>
                              <WeChatIcon size={15} /> {c.wechat_number}
                            </span>
                          )}
                          {c.email && (
                            <a href={`mailto:${c.email}`} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 500 }}>
                              ✉️ {c.email}
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SideDrawer>
        );
      })()}

      <TrashConflictModal
        isOpen={Boolean(trashConflict)}
        conflictInfo={trashConflict}
        onClose={() => setTrashConflict(null)}
        onRestored={async () => {
          setTrashConflict(null);
          closeModal();
          reload();
        }}
      />
    </AppShell>
  );
}