/**
 * Buyer (Client) Profiles.
 * Implements the "Add Buyer (Client) Data Form" specification document:
 *  - Top Filter Bar matching Suppliers & Product Master design with Funnel Icon Button, Imp/Exp, and Bulk Actions.
 *  - Single-row toolbar: Items/Page, 📌 Freeze Columns popover (fixed header, scrollable middle list, fixed footer "Clear All Freezes"), Search Input ✕.
 *  - Contiguous sticky column snapping on left edge with header zIndex & background layering fix.
 *  - Tabbed Add/Edit View matching Supplier Master layout:
 *      * Tab 1: 👤 Profile (Identity, Location, Primary Contact, Pipeline Status, Product Range)
 *      * Tab 2: 📇 Contacts (Full Team Contact Persons Management with Add/Edit/Delete actions)
 *  - Single-select dropdowns (Buyer Type, Country, Status, Potential, Grade, Title) use SelectField with top "Search / Type here..." search bar inside dropdown popup menu.
 *  - Multi-select dropdowns (Product Category, Sub Category) use SearchableDropdownMultiPanel with top "Search / Type here..." search bar & checkboxes panel that STAYS OPEN while selecting multiple items.
 *  - Auto-synced Primary Contact -> Contacts sub-panel.
 *  - 1-Way Status Lock ("Existing" status cannot be changed back to "New").
 *  - Delete protection: records with "Existing" status OR "Yes" potential cannot be deleted.
 *  - 3-Way Duplicate Alert (Company Name + Calling Number + WhatsApp Number).
 *  - Dynamic Buyer Types Master integration extracted from /masters/buyer-types.
 *  - Real-time Company Name Autocomplete Suggestions.
 *  - Bulk Actions (Bulk Activate, Bulk Deactivate, Bulk Delete).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Banner } from "@/components/ui";
import { Pagination } from "@/components/Pagination";
import { SearchableDropdown, SearchableFilterDropdown, SearchableDropdownMultiPanel, type DropdownOption } from "@/components/SearchableDropdown";
import { EmailTagInput, PhoneGroupField, SelectField, TextAreaField, TextField, WebsiteTagInput, autoTitleCase } from "@/components/fields";
import { SideDrawer, DetailFieldGrid } from "@/components/SideDrawer";
import { ItemPopoverCell } from "@/components/ItemPopoverCell";
import { TrashConflictModal, type TrashConflictInfo } from "@/components/TrashConflictModal";
import { ImpExpDropdown, BulkActionsDropdown, ImportSummaryPanel, downloadSampleCsv, parseFile, WizardModal, type SheetRow } from "@/components/ImportWizard";
import { apiDelete, apiGet, apiPatch, apiPost, downloadExport, toQueryString } from "@/lib/api";
import { useLookup, useLookupNames } from "@/lib/lookups";
import { usePendingGuard, useModalHistorySync, useAuth } from "@/lib/hooks";
import { useConfirm } from "@/lib/confirm";
import { handleFormEnterKeyNavigation } from "@/lib/formUtils";
import { useLiveConnectionStatus, useLiveModule } from "@/lib/live/useLive";
import { useLiveList } from "@/lib/live/useLiveList";
import type { Country, ImportHeader, ImportSummary, ProductCategory, ProductSubCategory, State } from "@/types";
import type { Buyer, BuyerContact } from "@/types/buyers";

const BUYER_IMPORT_HEADERS: ImportHeader[] = [
  { key: "company_name", label: "Company Name", required: true },
  { key: "buyer_type", label: "Buyer Type", required: false },
  { key: "category_names", label: "Product Categories", required: false },
  { key: "sub_category_names", label: "Product Sub Categories", required: false },
  { key: "country", label: "Country", required: true },
  { key: "state", label: "State / Province", required: false },
  { key: "city", label: "City", required: false },
  { key: "address", label: "Address", required: false },
  { key: "contact_salutation", label: "Contact Salutation", required: false },
  { key: "contact_full_name", label: "Contact Person Name", required: false },
  { key: "contact_designation", label: "Designation", required: false },
  { key: "contact_calling_number", label: "Calling Number", required: false },
  { key: "contact_whatsapp_number", label: "WhatsApp Number", required: false },
  { key: "contact_person_2", label: "Contact Person 2", required: false },
  { key: "designation_2", label: "Designation 2", required: false },
  { key: "calling_number_2", label: "Calling Number 2", required: false },
  { key: "whatsapp_number_2", label: "WhatsApp Number 2", required: false },
  { key: "emails", label: "Emails", required: false },
  { key: "tax_id_number", label: "Tax ID / GST Number", required: false },
  { key: "website", label: "Website", required: false },
  { key: "current_status", label: "Current Status", required: false },
  { key: "buyer_grade", label: "Buyer Grade", required: false },
  { key: "potential", label: "Potential", required: false },
  { key: "potential_reason", label: "Potential Reason", required: false },
  { key: "product_range", label: "Product Range", required: false },
  { key: "currently_buying_from", label: "Currently Buying From", required: false },
  { key: "overall_remarks", label: "Overall Remarks", required: false },
  { key: "status", label: "Status", required: false },
];

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

const EMPTY_BUYER_FORM = {
  company_name: "",
  country_id: "",
  state_id: "",
  buyer_type: "",
  city: "",
  address: "",
  contact_salutation: "",
  contact_full_name: "",
  contact_designation: "",
  contact_calling_number: "",
  contact_whatsapp_number: "",
  emails: [] as string[],
  tax_id_number: "",
  website: "",
  current_status: "",
  product_range: "",
  potential: "",
  potential_reason: "",
  buyer_grade: "",
  currently_buying_from: "",
  overall_remarks: "",
  is_active: "true",
};

const EMPTY_CONTACT_FORM = {
  salutation: "",
  person_name: "",
  designation: "",
  calling_number: "",
  whatsapp_number: "",
  country_id: "",
  email: "",
  emails: [] as string[],
  is_primary: false,
};

type ModalMode = "create" | "edit" | "import" | null;

const selectFilterStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  fontSize: 13,
  background: "#ffffff",
  color: "#0f172a",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  color: "#1e293b",
  borderBottom: "2px solid #e2e8f0",
  paddingBottom: "6px",
  marginTop: "8px",
  marginBottom: "14px",
};

function extractSubscriberNumber(val: string | undefined | null): string {
  if (!val) return "";
  const trimmed = val.trim();
  if (trimmed.startsWith("+")) {
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx !== -1) {
      return trimmed.slice(spaceIdx + 1).replace(/\D/g, "");
    }
    return ""; // Only prefix (e.g. "+256" or "+91") with no actual number!
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
  if (!val) return null;
  const subscriber = extractSubscriberNumber(val);
  // If the subscriber digits are empty (only country prefix exists), it is valid/blank (optional).
  if (!subscriber) return null;

  const digits = val.replace(/\D/g, "");
  if (digits.length < 7) {
    return `${fieldLabel} must have at least 7 digits (including country code).`;
  }
  if (digits.length > 15) {
    return `${fieldLabel} cannot exceed 15 digits (including country code).`;
  }
  return null;
}

function BuyerSkeletonRows({
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
        <tr key={`buyer-sk-row-${rowIndex}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
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
                  <div
                    className="skeleton-line"
                    style={{
                      width: nameWidths[rowIndex % nameWidths.length],
                      height: "15px",
                      borderRadius: "4px",
                    }}
                  />
                );
                break;
              case 3:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "55px", height: "20px", borderRadius: "10px" }}
                  />
                );
                break;
              case 4:
                content = (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div style={{ display: "inline-flex", gap: "4px", alignItems: "center" }}>
                      <div className="skeleton-line" style={{ width: "75px", height: "18px", borderRadius: "10px" }} />
                      <div className="skeleton-line" style={{ width: "28px", height: "18px", borderRadius: "10px" }} />
                    </div>
                    <div style={{ display: "inline-flex", gap: "4px", alignItems: "center" }}>
                      <div className="skeleton-line" style={{ width: "70px", height: "18px", borderRadius: "10px" }} />
                    </div>
                  </div>
                );
                break;
              case 5:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "60px", height: "14px", borderRadius: "4px" }}
                  />
                );
                break;
              case 6:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "60px", height: "20px", borderRadius: "12px" }}
                  />
                );
                break;
              case 7:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "45px", height: "20px", borderRadius: "12px" }}
                  />
                );
                break;
              case 8:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "35px", height: "20px", borderRadius: "4px" }}
                  />
                );
                break;
              case 9:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "70px", height: "14px", borderRadius: "4px" }}
                  />
                );
                break;
              case 10:
                content = (
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <div
                      className="skeleton-line"
                      style={{ width: "30px", height: "30px", borderRadius: "4px" }}
                    />
                    <div
                      className="skeleton-line"
                      style={{ width: "30px", height: "30px", borderRadius: "4px" }}
                    />
                  </div>
                );
                break;
              default:
                content = <div className="skeleton-line" style={{ height: "14px" }} />;
            }

            return (
              <td
                key={`buyer-sk-cell-${colIdx}`}
                style={{
                  padding: colIdx === 0 || colIdx === 1 ? "10px 8px" : "10px 14px",
                  verticalAlign: "middle",
                  width: colIdx === 0 ? "40px" : colIdx === 1 ? "65px" : colIdx === 2 ? "240px" : colIdx === 4 ? "240px" : undefined,
                  minWidth: colIdx === 0 ? "40px" : colIdx === 1 ? "65px" : colIdx === 2 ? "160px" : colIdx === 4 ? "220px" : undefined,
                  maxWidth: colIdx === 0 ? "45px" : colIdx === 1 ? "75px" : colIdx === 2 ? "240px" : colIdx === 4 ? "300px" : undefined,
                  textAlign: colIdx === 0 || colIdx === 1 ? "center" : "left",
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

interface BuyerListCacheEntry {
  rows: Buyer[];
  totalRecords: number;
  timestamp: number;
}
const buyerListCache = new Map<string, BuyerListCacheEntry>();

export function BuyersPage() {
  const { hasPermission } = useAuth();
  const confirm = useConfirm();
  const canCreate = hasPermission("buyer.create");
  const canUpdate = hasPermission("buyer.update");
  const canDelete = hasPermission("buyer.delete");
  const canExport = hasPermission("buyer.export");
  const canImport = hasPermission("buyer.import");
  const canBulkAction = hasPermission("buyer.bulk_action");
  const canEditCurrentStatus = hasPermission("buyer.currentstatus");
  const canEditPotential = hasPermission("buyer.potential");
  const canEditClientGrade = hasPermission("buyer.clientgrade");

  const initialCache = buyerListCache.get("default");
  const [rows, setRows] = useState<Buyer[]>(() => initialCache?.rows || []);
  const [totalRecords, setTotalRecords] = useState(() => initialCache?.totalRecords || 0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(() => !initialCache);
  const [error, setError] = useState<unknown>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  /* Live Real-time cross-tab synchronization */
  useLiveModule("buyers", () => {
    setReloadCounter((k) => k + 1);
  });

  const [statusTab, setStatusTab] = useState<"active" | "inactive">("active");
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  /* Phase 7: double-submit guards. `formSubmitting`/`contactSubmitting` cover
     the two single-instance modal forms (like every other page's `submitting`
     flag); `rowAction` is keyed so per-row/per-bulk actions (Delete, Bulk
     Activate, ...) only disable the ONE button that was clicked rather than
     freezing the whole list while any one request is in flight. */
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const { isPending: isRowActionPending, guard: guardRowAction } = usePendingGuard<string>();

  /* Import / Export State */
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importMode, setImportMode] = useState<"create" | "update">("create");
  const [wizardPending, setWizardPending] = useState<{
    file: File;
    rows: SheetRow[];
    sheetColumns: string[];
  } | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  /* Lookups for filter labels & options */
  const countries = useLookup<Country>("/masters/countries", 250);
  const states = useLookup<State>("/masters/states", 500);
  const categories = useLookup<ProductCategory>("/masters/product-categories", 250);
  const subCategories = useLookup<ProductSubCategory>("/masters/product-sub-categories", 500);
  // Permission-free name-only fallback: a user with access to Buyers but not
  // to the Categories/Sub-Categories master modules still needs to see the
  // NAME of a category already linked to a buyer they're allowed to view.
  // The full lookups above return empty for that user (403 on ".view"), so
  // renderChips falls back to these to avoid showing raw UUIDs. See
  // app.masters.product_categories.routes.lookup_categories on the backend.
  const categoryNamesFallback = useLookupNames("/masters/product-categories");
  const subCategoryNamesFallback = useLookupNames("/masters/product-sub-categories");
  const buyerTypes = useLookup<{ id: string; name: string }>("/masters/buyer-types", 250);
  const allBuyersLookup = useLookup<Buyer>("/buyers", 1000);

  /* Modal state for viewing full list of categories/subcategories via Eye Icon */
  const [chipModalData, setChipModalData] = useState<{ title: string; items: string[] } | null>(null);


  /* Top Filters */
  const [searchInput, setSearchInput] = useState("");
  const [effectiveSearch, setEffectiveSearch] = useState("");
  const [buyerTypeFilter, setBuyerTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [potentialFilter, setPotentialFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [subCategoryFilter, setSubCategoryFilter] = useState("");
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

  /* Sorting State */
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
          valA = a.buyer_type || "";
          valB = b.buyer_type || "";
          break;
        case 4:
          valA = [
            ...(a.category_ids || []).map((id) => categories.items.find((c) => c.id === id)?.name || categoryNamesFallback.items.find((c) => c.id === id)?.name || ""),
            ...(a.sub_category_ids || []).map((id) => subCategories.items.find((sc) => sc.id === id)?.name || subCategoryNamesFallback.items.find((sc) => sc.id === id)?.name || ""),
          ].filter(Boolean).join(", ");
          valB = [
            ...(b.category_ids || []).map((id) => categories.items.find((c) => c.id === id)?.name || categoryNamesFallback.items.find((c) => c.id === id)?.name || ""),
            ...(b.sub_category_ids || []).map((id) => subCategories.items.find((sc) => sc.id === id)?.name || subCategoryNamesFallback.items.find((sc) => sc.id === id)?.name || ""),
          ].filter(Boolean).join(", ");
          break;
        case 5:
          valA = countries.items.find((c) => c.id === a.country_id)?.name || "";
          valB = countries.items.find((c) => c.id === b.country_id)?.name || "";
          break;
        case 6:
          valA = a.current_status || "";
          valB = b.current_status || "";
          break;
        case 7:
          valA = a.potential || "";
          valB = b.potential || "";
          break;
        case 8:
          valA = a.buyer_grade || "";
          valB = b.buyer_grade || "";
          break;
        case 9: {
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
  }, [rows, sortColIndex, sortDirection, categories.items, subCategories.items, countries.items, categoryNamesFallback.items, subCategoryNamesFallback.items]);

  /* Selection & Detail View */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailBuyer, setDetailBuyer] = useState<Buyer | null>(null);

  /* Form & Tabs State */
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [trashConflict, setTrashConflict] = useState<TrashConflictInfo | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkBuyerId = searchParams.get("id");
  const activeFetchBuyerIdRef = useRef<string | null>(null);

  const handleCloseDetailBuyer = useCallback(() => {
    setDetailBuyer(null);
    activeFetchBuyerIdRef.current = null;
    setSearchParams((prev) => {
      if (!prev.has("id")) return prev;
      const next = new URLSearchParams(prev);
      next.delete("id");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const [detailLoading, setDetailLoading] = useState(false);

  const handleOpenDetail = useCallback(async (buyer: Buyer) => {
    setDetailBuyer(buyer);
    setDetailLoading(true);
    try {
      const { data } = await apiGet<Buyer>(`/buyers/${buyer.id}`);
      if (data) {
        setDetailBuyer(data);
      }
    } catch (err) {
      console.error("Failed to load full buyer detail for drawer:", err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Sync browser back arrow with modal & drawer: close them instead of
  // navigating back to Dashboard.
  useModalHistorySync(Boolean(modalMode), () => setModalMode(null));
  useModalHistorySync(Boolean(detailBuyer), handleCloseDetailBuyer);

  // When user clicks "Buyers" in the sidebar while already on the buyers page,
  // return to the original buyer list/table page.
  useEffect(() => {
    const handleNavActiveClick = (e: Event) => {
      const customEvent = e as CustomEvent<{ key?: string }>;
      if (customEvent.detail?.key === "buyers") {
        setModalMode(null);
        handleCloseDetailBuyer();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    };
    window.addEventListener("erp:nav-active-click", handleNavActiveClick);
    return () => window.removeEventListener("erp:nav-active-click", handleNavActiveClick);
  }, [handleCloseDetailBuyer]);

  // Universal search deep-link: `?id=` opens that buyer's detail drawer
  // directly, so clicking a Buyers result in the topbar search lands on the
  // actual record instead of just the bare list.
  useEffect(() => {
    if (!deepLinkBuyerId) return;
    if (activeFetchBuyerIdRef.current === deepLinkBuyerId) return;
    const targetId = deepLinkBuyerId;
    activeFetchBuyerIdRef.current = targetId;

    // Immediately replace URL in history so history.back() never returns to ?id=
    setSearchParams((prev) => {
      if (!prev.has("id")) return prev;
      const next = new URLSearchParams(prev);
      next.delete("id");
      return next;
    }, { replace: true });

    (async () => {
      try {
        const { data } = await apiGet<Buyer>(`/buyers/${targetId}`);
        if (activeFetchBuyerIdRef.current === targetId) {
          setDetailBuyer(data);
        }
      } catch (err) {
        console.error("Failed to load buyer detail for deep-link:", err);
      }
    })();
  }, [deepLinkBuyerId, setSearchParams]);
  const [editTab, setEditTab] = useState<"profile" | "contacts">("profile");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_BUYER_FORM);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [subCategoryIds, setSubCategoryIds] = useState<string[]>([]);
  const [formCityId, setFormCityId] = useState<string | null>(null);
  const [formStateId, setFormStateId] = useState<string | null>(null);
  const [isCompanyInputFocused, setIsCompanyInputFocused] = useState(false);
  const [whatsappSameAsCalling, setWhatsappSameAsCalling] = useState(false);

  /* Contacts State */
  const [contacts, setContacts] = useState<BuyerContact[]>([]);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState(EMPTY_CONTACT_FORM);

  const [pinnedCols, setPinnedCols] = useState<Record<number, "left" | "right">>(() => {
    const saved = localStorage.getItem("buyers_pinned_cols");
    if (saved !== null) {
      try {
        const parsed = JSON.parse(saved);
        const cleaned: Record<number, "left" | "right"> = {};
        for (const [k, v] of Object.entries(parsed)) {
          const num = Number(k);
          if (num >= 0 && num < 11 && (v === "left" || v === "right")) {
            cleaned[num] = v;
          }
        }
        return cleaned;
      } catch {
        // fallback
      }
    }
    return { 0: "left", 1: "left", 2: "left" };
  });

  useEffect(() => {
    localStorage.setItem("buyers_pinned_cols", JSON.stringify(pinnedCols));
  }, [pinnedCols]);

  const [colLeftOffsets, setColLeftOffsets] = useState<Record<number, number>>({});
  const [colRightOffsets, setColRightOffsets] = useState<Record<number, number>>({});
  const [pinMenuOpen, setPinMenuOpen] = useState(false);
  const pinMenuRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const reload = () => setReloadCounter((n) => n + 1);

  /* Close Freeze menu on click outside */
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
        next[colIdx] = colIdx >= 9 ? "right" : "left";
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
  }, [displayOrder, pinnedCols, rows, loading]);

  /* Debounce Search Input */
  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentPage(1);
      setEffectiveSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  /* Fetch Data */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params: Record<string, string | number | boolean | null | undefined> = {
        search: effectiveSearch,
        page: currentPage,
        page_size: pageSize,
        is_active: statusTab === "active",
        buyer_type: buyerTypeFilter || undefined,
        current_status: statusFilter || undefined,
        potential: potentialFilter || undefined,
        buyer_grade: gradeFilter || undefined,
        country_id: countryFilter || undefined,
        category_id: categoryFilter || undefined,
        sub_category_id: subCategoryFilter || undefined,
      };

      const queryKey = toQueryString(params);
      const cached = buyerListCache.get(queryKey) || buyerListCache.get("default");
      if (!cached && rows.length === 0) {
        setLoading(true);
      }
      setError(null);
      try {
        const { data, meta } = await apiGet<Buyer[]>("/buyers" + toQueryString(params));
        if (!cancelled) {
          const list = data || [];
          const total = meta?.pagination?.total_records ?? list.length ?? 0;
          setRows(list);
          setTotalRecords(total);
          buyerListCache.set(queryKey, { rows: list, totalRecords: total, timestamp: Date.now() });
          buyerListCache.set("default", { rows: list, totalRecords: total, timestamp: Date.now() });
        }
      } catch (err) {
        if (!cancelled && !cached) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    effectiveSearch,
    currentPage,
    pageSize,
    statusTab,
    buyerTypeFilter,
    statusFilter,
    potentialFilter,
    gradeFilter,
    countryFilter,
    categoryFilter,
    subCategoryFilter,
    reloadCounter,
  ]);

  const handleResetFilters = () => {
    setSearchInput("");
    setEffectiveSearch("");
    setBuyerTypeFilter("");
    setStatusFilter("");
    setPotentialFilter("");
    setGradeFilter("");
    setCountryFilter("");
    setCategoryFilter("");
    setSubCategoryFilter("");
    setCurrentPage(1);
  };

  /**
   * Live sync (Phase 2, consolidated onto the shared `useLiveList`
   * pattern in Phase 6 -- see `frontend/src/lib/live/useLiveList.ts`).
   * Buyers is one of the two reference integrations (Buyers + Planning)
   * this shared hook was extracted FROM, so this block is now the same
   * few lines any future module's page would write, not a bespoke
   * hand-rolled subscription.
   *
   * Everything above (fetch effect, filters, pagination, create/update/
   * delete handlers) is completely untouched -- this only ADDS a
   * subscription on top.
   */
  const hasActiveFilterOrSearch =
    Boolean(effectiveSearch) ||
    Boolean(buyerTypeFilter) ||
    Boolean(statusFilter) ||
    Boolean(potentialFilter) ||
    Boolean(gradeFilter) ||
    Boolean(countryFilter) ||
    Boolean(categoryFilter) ||
    Boolean(subCategoryFilter);

  useLiveList<Buyer>({
    moduleName: "buyers",
    setRecords: setRows,
    // Every filter above is applied SERVER-SIDE (see the fetch effect's
    // `params`), so replicating that same filter logic here just to
    // decide "does this live-patched record still belong in view" would
    // duplicate it and risk drifting out of sync with the server's own
    // rules over time. Deliberately conservative instead: while ANY
    // filter/search is active, or the view isn't showing page 1, live
    // patching is skipped entirely and the list simply stays exactly as
    // the last REST fetch left it (i.e. behaves exactly as it did before
    // this Phase 2 integration existed) -- correctness over
    // completeness. Unfiltered page 1 is the one case where "does this
    // record belong in view" has an unambiguous, filter-free answer.
    shouldSkip: () => hasActiveFilterOrSearch || currentPage !== 1,
    // No buildFromEvent: `changes` is deliberately a small partial
    // payload (see Event's own docstring), not a full Buyer record, so a
    // live `buyer.created` for a row not already loaded is safely
    // ignored rather than inserting an incomplete row -- the person will
    // see it on their next natural page load/refresh.
    onApplied: (result) => {
      if (result.action === "created" || result.action === "deleted") {
        setTotalRecords((prevTotal) => (result.action === "created" ? prevTotal + 1 : Math.max(0, prevTotal - 1)));
      }
    },
  });

  /**
   * Reconnect synchronization (Phase 2 brief section 17): this ERP's
   * backend has no missed-event/replay mechanism (Phase 1 was
   * infrastructure-only -- see PHASE1_EVENTS.md's "What's intentionally
   * NOT in Phase 1"), so the safe fallback is exactly what the brief
   * calls for: re-run the normal REST fetch once the connection comes
   * back, rather than assuming the 3 changes that happened while
   * offline are already known. Only refreshes THIS page's own active
   * dataset (via the existing `reload()`/`reloadCounter` the fetch
   * effect above already depends on) -- not a blanket app-wide reload.
   */
  const liveConnectionStatus = useLiveConnectionStatus();
  const hasConnectedBeforeRef = useRef(false);
  const wasDisconnectedRef = useRef(false);
  useEffect(() => {
    if (liveConnectionStatus === "connected") {
      // Only treat this as a RECOVERY (and therefore worth an extra
      // fetch) if we had previously been connected at least once and
      // then dropped -- not on the very first connect after this page
      // mounts, which would otherwise double-fetch redundantly right
      // alongside the page's own initial REST load.
      if (hasConnectedBeforeRef.current && wasDisconnectedRef.current) {
        reload();
      }
      hasConnectedBeforeRef.current = true;
      wasDisconnectedRef.current = false;
    } else if (hasConnectedBeforeRef.current) {
      wasDisconnectedRef.current = true;
    }
  }, [liveConnectionStatus]);

  /* Default Country Uganda Lookup */
  const defaultUgandaId = useMemo(() => {
    const found = countries.items.find((c) => c.name.toLowerCase() === "uganda");
    return found ? found.id : "";
  }, [countries.items]);

  /* Search Fetchers for Dropdowns */
  const searchFetcher = useCallback(
    (apiBase: string, extraParamsFn?: () => Record<string, string>) =>
      async (term: string, signal: AbortSignal): Promise<DropdownOption[]> => {
        const extra = extraParamsFn ? extraParamsFn() : {};
        const { data } = await apiGet<{ id: string; name: string }[]>(
          apiBase + toQueryString({ search: term, page: 1, page_size: 250, sort_order: "asc", status: "active", ...extra }),
          { signal }
        );
        return (data || []).map((d) => ({ value: d.id, label: d.name }));
      },
    []
  );

  const fetchNameLabel = useCallback(
    (apiBase: string) => async (id: string) => {
      if (apiBase === "/masters/product-categories") {
        const found = categories.items.find((c) => c.id === id) || categoryNamesFallback.items.find((c) => c.id === id);
        if (found) return found.name;
      } else if (apiBase === "/masters/product-sub-categories") {
        const found = subCategories.items.find((sc) => sc.id === id) || subCategoryNamesFallback.items.find((sc) => sc.id === id);
        if (found) return found.name;
      } else if (apiBase === "/masters/buyer-types") {
        const found = buyerTypes.items.find((b) => b.id === id);
        if (found) return found.name;
      } else if (apiBase === "/masters/countries") {
        const found = countries.items.find((c) => c.id === id);
        if (found) return found.name;
      }
      try {
        const { data } = await apiGet<{ name?: string }>(`${apiBase}/${id}`);
        return data?.name || "";
      } catch {
        return "";
      }
    },
    [categories.items, categoryNamesFallback.items, subCategories.items, subCategoryNamesFallback.items, buyerTypes.items, countries.items]
  );

  const fetchCategoryOptions = useCallback(
    async (query: string): Promise<DropdownOption[]> => {
      const q = query.trim().toLowerCase();
      let items = categories.items;
      if (items.length === 0 && !categories.loaded) {
        try {
          const { data } = await apiGet<ProductCategory[]>(
            "/masters/product-categories" + toQueryString({ page: 1, page_size: 250, sort_order: "asc", status: "active" })
          );
          items = data || [];
        } catch {
          items = [];
        }
      }
      if (q) {
        items = items.filter(
          (c) => c.name.toLowerCase().includes(q) || (c.code && c.code.toLowerCase().includes(q))
        );
      }
      return items.map((c) => ({ value: c.id, label: c.name }));
    },
    [categories.items, categories.loaded]
  );

  const fetchCategoryLabel = useCallback(
    async (id: string): Promise<string> => {
      const found = categories.items.find((c) => c.id === id) || categoryNamesFallback.items.find((c) => c.id === id);
      if (found) return found.name;
      try {
        const { data } = await apiGet<{ name?: string }>(`/masters/product-categories/${id}`);
        return data?.name || "";
      } catch {
        return "";
      }
    },
    [categories.items, categoryNamesFallback.items]
  );

  const fetchSubCategoryOptions = useCallback(
    async (query: string): Promise<DropdownOption[]> => {
      if (categoryIds.length === 0) {
        return [];
      }
      const q = query.trim().toLowerCase();
      let items = subCategories.items.filter((sc) => categoryIds.includes(sc.category_id));
      items = [...items].sort((a, b) => {
        const idxA = categoryIds.indexOf(a.category_id);
        const idxB = categoryIds.indexOf(b.category_id);
        if (idxA !== idxB) return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
        return a.name.localeCompare(b.name);
      });
      if (q) {
        items = items.filter(
          (sc) => sc.name.toLowerCase().includes(q) || (sc.code && sc.code.toLowerCase().includes(q))
        );
      }
      const catMap = new Map<string, string>();
      categories.items.forEach((c) => catMap.set(c.id, c.name));
      categoryNamesFallback.items.forEach((c) => {
        if (!catMap.has(c.id)) catMap.set(c.id, c.name);
      });
      return items.map((sc) => ({
        value: sc.id,
        label: sc.name,
        group: catMap.get(sc.category_id) || "Other Categories",
      }));
    },
    [categoryIds, subCategories.items, categories.items, categoryNamesFallback.items]
  );

  const fetchSubCategoryLabel = useCallback(
    async (id: string): Promise<string> => {
      const found = subCategories.items.find((sc) => sc.id === id) || subCategoryNamesFallback.items.find((sc) => sc.id === id);
      if (found) return found.name;
      try {
        const { data } = await apiGet<{ name?: string }>(`/masters/product-sub-categories/${id}`);
        return data?.name || "";
      } catch {
        return "";
      }
    },
    [subCategories.items, subCategoryNamesFallback.items]
  );

  /* Chip / Popover Render Helper */
  function renderChips(
    ids: string[] | undefined,
    itemsList: Array<{ id: string; name: string }>,
    fieldTitle = "Selected Items",
    fallbackItemsList?: Array<{ id: string; name: string }>,
    icon = "🏷️",
    maxWidth = "175px"
  ) {
    if (!ids || !ids.length) return <span style={{ color: "#94a3b8" }}>—</span>;
    const names = ids
      .map(
        (id) =>
          itemsList.find((x) => x.id === id)?.name ||
          fallbackItemsList?.find((x) => x.id === id)?.name ||
          id
      )
      .filter(Boolean);

    return (
      <ItemPopoverCell
        items={names}
        icon={icon}
        itemIcon={icon}
        title={`📍 ${fieldTitle}`}
        badgeIcon="📍"
        maxWidth={maxWidth}
      />
    );
  }

  function openCreate() {
    const initCountryId = defaultUgandaId || (countries.items[0]?.id ?? "");
    const initCountry = countries.items.find((c) => c.id === initCountryId);
    const initPhoneCode = initCountry?.phone_code ? `+${initCountry.phone_code.trim().replace(/^\+/, "")} ` : "";

    setModalMode("create");
    setEditTab("profile");
    setEditingId(null);
    setError(null);
    setWhatsappSameAsCalling(false);
    setValidationErrors({});
    setForm({
      ...EMPTY_BUYER_FORM,
      country_id: initCountryId,
      state_id: "",
      contact_calling_number: initPhoneCode,
      contact_whatsapp_number: initPhoneCode,
      is_active: "true",
    });
    setCategoryIds([]);
    setSubCategoryIds([]);
    setFormStateId(null);
    setFormCityId(null);
    setContacts([]);
    setIsCompanyInputFocused(false);
  }

  async function openEdit(buyer: Buyer) {
    setModalMode("edit");
    setEditTab("profile");
    setEditingId(buyer.id);
    setError(null);
    setValidationErrors({});

    // 1. POPULATE FORM IMMEDIATELY AT 0ms FROM LOCAL ROW
    setWhatsappSameAsCalling(
      Boolean(buyer.contact_calling_number && buyer.contact_calling_number === buyer.contact_whatsapp_number)
    );
    setForm({
      company_name: buyer.company_name || "",
      buyer_type: buyer.buyer_type || "",
      country_id: buyer.country_id,
      state_id: buyer.state_id || "",
      city: buyer.city || "",
      address: buyer.address || "",
      contact_salutation: buyer.contact_salutation || "",
      contact_full_name: buyer.contact_full_name || "",
      contact_designation: buyer.contact_designation || "",
      contact_calling_number: buyer.contact_calling_number || "",
      contact_whatsapp_number: buyer.contact_whatsapp_number || "",
      emails: buyer.emails || [],
      tax_id_number: buyer.tax_id_number || "",
      website: buyer.website || "",
      current_status: buyer.current_status || "",
      product_range: buyer.product_range || "",
      potential: buyer.potential || "",
      potential_reason: buyer.potential_reason || "",
      buyer_grade: buyer.buyer_grade || "",
      currently_buying_from: buyer.currently_buying_from || "",
      overall_remarks: buyer.overall_remarks || "",
      is_active: buyer.is_active !== false ? "true" : "false",
    });
    setCategoryIds(buyer.category_ids || []);
    setSubCategoryIds(buyer.sub_category_ids || []);
    setFormStateId(buyer.state_id || null);
    setFormCityId(null);
    setIsCompanyInputFocused(false);
    if (buyer.city && buyer.country_id) {
      void (async () => {
        try {
          const res = await apiGet<Array<{ id: string; name: string }>>(
            `/masters/cities${toQueryString({ search: buyer.city, country_id: buyer.country_id, page: 1, page_size: 5 })}`
          );
          const matched = res.data?.find(
            (c) => c.name.toLowerCase() === buyer.city?.toLowerCase() || c.id === buyer.city
          );
          if (matched) {
            setFormCityId(matched.id);
          }
        } catch {
          // ignore
        }
      })();
    }

    // 2. Fetch full buyer profile in background and enrich silently
    try {
      const { data } = await apiGet<Buyer>(`/buyers/${buyer.id}`);
      if (data) {
        setForm((f) => ({
          ...f,
          company_name: data.company_name || f.company_name,
          buyer_type: data.buyer_type || f.buyer_type,
          country_id: data.country_id || f.country_id,
          state_id: data.state_id || f.state_id,
          city: data.city || f.city,
          address: data.address || f.address,
          contact_salutation: data.contact_salutation || f.contact_salutation,
          contact_full_name: data.contact_full_name || f.contact_full_name,
          contact_designation: data.contact_designation || f.contact_designation,
          contact_calling_number: data.contact_calling_number || f.contact_calling_number,
          contact_whatsapp_number: data.contact_whatsapp_number || f.contact_whatsapp_number,
          emails: data.emails && data.emails.length ? data.emails : f.emails,
          tax_id_number: data.tax_id_number || f.tax_id_number,
          website: data.website || f.website,
          current_status: data.current_status || f.current_status,
          product_range: data.product_range || f.product_range,
          potential: data.potential || f.potential,
          potential_reason: data.potential_reason || f.potential_reason,
          buyer_grade: data.buyer_grade || f.buyer_grade,
          currently_buying_from: data.currently_buying_from || f.currently_buying_from,
          overall_remarks: data.overall_remarks || f.overall_remarks,
          is_active: data.is_active !== false ? "true" : "false",
        }));
        if (data.category_ids) setCategoryIds(data.category_ids);
        if (data.sub_category_ids) setSubCategoryIds(data.sub_category_ids);
      }
    } catch (err) {
      console.error("Failed to load full buyer profile for editing:", err);
    }
    try {
      const { data } = await apiGet<BuyerContact[]>(`/buyers/${buyer.id}/contacts`);
      setContacts(data || []);
    } catch {
      setContacts([]);
    }
  }

  function setField(id: keyof typeof EMPTY_BUYER_FORM, value: string) {
    setForm((prev) => {
      const next = { ...prev, [id]: value };
      if (id === "potential" && value !== "no") next.potential_reason = "";
      if (id === "state_id") {
        next.city = "";
        setFormCityId(null);
      }
      if (id === "country_id") {
        next.state_id = "";
        next.city = "";
        setFormStateId(null);
        setFormCityId(null);

        const selCountry = countries.items.find((c) => c.id === value);
        if (selCountry?.phone_code) {
          const rawCode = selCountry.phone_code.trim().replace(/^\+/, "");
          const newPrefix = `+${rawCode}`;

          const updateNumber = (currNum: string) => {
            if (!currNum || /^\+?\d*\s*$/.test(currNum.trim())) {
              return newPrefix ? `${newPrefix} ` : "";
            }
            const cleanDigits = currNum.replace(/^\+\d+\s*/, "").trim();
            return newPrefix ? `${newPrefix} ${cleanDigits}` : cleanDigits;
          };

          next.contact_calling_number = updateNumber(prev.contact_calling_number);
          if (whatsappSameAsCalling) {
            next.contact_whatsapp_number = next.contact_calling_number;
          } else {
            next.contact_whatsapp_number = updateNumber(prev.contact_whatsapp_number);
          }
        } else {
          next.contact_calling_number = "";
          next.contact_whatsapp_number = "";
        }
      }

      if (id === "contact_calling_number" && whatsappSameAsCalling) {
        next.contact_whatsapp_number = value;
      }
      return next;
    });

    if (validationErrors[id as string]) {
      setValidationErrors((prev) => ({ ...prev, [id as string]: "" }));
    }
  }

  function focusAndScrollField(elementId: string, errorMsg: string) {
    setValidationErrors((prev) => ({ ...prev, [elementId]: errorMsg }));
    const el = document.getElementById(elementId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => el.focus(), 250);
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (formSubmitting) return; // Phase 7: ignore a second click while the first save is still in flight
    setError(null);

    // 1. Required field validation & phone number digit checks (max 15 digits including country code)
    const initialErrors: Record<string, string> = {};
    if (!form.company_name.trim()) {
      initialErrors["company_name"] = "Company Name is required.";
    }
    if (!form.country_id) {
      initialErrors["country_id"] = "Country is required.";
    }
    if (form.contact_calling_number) {
      const callingErr = validatePhoneNumber(form.contact_calling_number, "Calling number");
      if (callingErr) initialErrors["contact_calling_number"] = callingErr;
    }
    if (form.contact_whatsapp_number) {
      const whatsappErr = validatePhoneNumber(form.contact_whatsapp_number, "WhatsApp number");
      if (whatsappErr) initialErrors["contact_whatsapp_number"] = whatsappErr;
    }

    // 2. Real-time Field-level Duplicate checks
    if (fieldDuplicates.companyWarning) {
      initialErrors["company_name"] = fieldDuplicates.companyWarning;
    }
    if (fieldDuplicates.callingWarning) {
      initialErrors["contact_calling_number"] = fieldDuplicates.callingWarning;
    }
    if (fieldDuplicates.whatsappWarning) {
      initialErrors["contact_whatsapp_number"] = fieldDuplicates.whatsappWarning;
    }

    if (Object.keys(initialErrors).length > 0) {
      setValidationErrors((prev) => ({ ...prev, ...initialErrors }));
      setError(Object.values(initialErrors)[0]);
      const firstField = Object.keys(initialErrors)[0];
      focusAndScrollField(firstField, initialErrors[firstField]);
      return;
    }

    const existingBuyer = rows.find((b) => b.id === editingId);
    const payload = {
      version: existingBuyer?.version,
      company_name: form.company_name.trim(),
      country_id: form.country_id,
      state_id: form.state_id || formStateId || null,
      buyer_type: form.buyer_type.trim() || null,
      city: form.city.trim() || null,
      address: form.address.trim() || null,
      contact_salutation: form.contact_salutation.trim() || null,
      contact_full_name: form.contact_full_name.trim() || null,
      contact_designation: form.contact_designation.trim() || null,
      contact_calling_number: normalizePhoneValue(form.contact_calling_number),
      contact_whatsapp_number: normalizePhoneValue(form.contact_whatsapp_number),
      emails: form.emails,
      tax_id_number: form.tax_id_number.trim() || null,
      website: form.website.trim() || null,
      current_status: form.current_status ? form.current_status.toLowerCase() : null,
      product_range: form.product_range.trim() || null,
      potential: form.potential ? form.potential.toLowerCase() : null,
      potential_reason: form.potential?.toLowerCase() === "no" ? (form.potential_reason.trim() || null) : null,
      buyer_grade: form.buyer_grade ? form.buyer_grade.replace(/^Grade\s+/i, "").trim() : null,
      currently_buying_from: form.currently_buying_from.trim() || null,
      overall_remarks: form.overall_remarks.trim() || null,
      category_ids: categoryIds,
      sub_category_ids: subCategoryIds,
      is_active: form.is_active === "true",
    };

    setFormSubmitting(true);
    try {
      if (modalMode === "create") {
        const { data: newBuyer } = await apiPost<Buyer>("/buyers", payload);
        if (newBuyer) {
          setRows((prev) => [newBuyer, ...prev]);
          setTotalRecords((prev) => prev + 1);
        } else {
          reload();
        }
      } else if (editingId) {
        const { data: updatedBuyer } = await apiPatch<Buyer>(`/buyers/${editingId}`, payload);
        if (updatedBuyer) {
          setRows((prev) => prev.map((b) => (b.id === editingId ? updatedBuyer : b)));
          if (detailBuyer?.id === editingId) {
            setDetailBuyer(updatedBuyer);
          }
        } else {
          reload();
        }
      }
      allBuyersLookup.reload?.();
      setError(null);
      setModalMode(null);
    } catch (err: any) {
      if (err?.details?.in_trash) {
        setTrashConflict(err.details);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err || "");
      const lower = msg.toLowerCase();
      if (lower.includes("company name") || lower.includes("company_name")) {
        focusAndScrollField("company_name", msg);
      } else if (lower.includes("calling number") || lower.includes("contact_calling_number")) {
        focusAndScrollField("contact_calling_number", msg);
      } else if (lower.includes("whatsapp")) {
        focusAndScrollField("contact_whatsapp_number", msg);
      }
      setError(err);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setFormSubmitting(false);
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

  async function handleDelete(buyer: Buyer) {
    const isExisting = buyer.current_status === "existing";
    const isPotentialYes = buyer.potential === "yes";

    if (isExisting || isPotentialYes) {
      alert(
        `Cannot DELETE buyer "${buyer.company_name}"!\n\n` +
        `Document Rule: Buyers with Current Status 'Existing' or Potential 'Yes' cannot be deleted. You can make it 'Inactive' instead.`
      );
      return;
    }

    const confirmed = await confirm({
      title: "Delete Buyer Profile",
      message: `Are you sure you want to delete buyer "${buyer.company_name}"? This action cannot be undone.`,
      itemName: buyer.company_name,
      confirmLabel: "Delete Buyer",
      variant: "danger",
    });
    if (!confirmed) return;
    await guardRowAction(`delete:${buyer.id}`, async () => {
      try {
        await apiDelete(`/buyers/${buyer.id}`);
        setRows((prev) => prev.filter((b) => b.id !== buyer.id));
        setTotalRecords((prev) => Math.max(0, prev - 1));
      } catch (err) {
        setError(err);
      }
    });
  }

  /* Contact Person Handlers */
  async function refreshBuyerProfileAfterContactChange(buyerId: string) {
    try {
      const [buyerRes, contactsRes] = await Promise.all([
        apiGet<Buyer>(`/buyers/${buyerId}`),
        apiGet<BuyerContact[]>(`/buyers/${buyerId}/contacts`),
      ]);
      if (buyerRes.data) {
        const fullBuyer = buyerRes.data;
        setForm((prev) => ({
          ...prev,
          contact_salutation: fullBuyer.contact_salutation || "",
          contact_full_name: fullBuyer.contact_full_name || "",
          contact_designation: fullBuyer.contact_designation || "",
          contact_calling_number: fullBuyer.contact_calling_number || "",
          contact_whatsapp_number: fullBuyer.contact_whatsapp_number || "",
          emails: fullBuyer.emails || [],
        }));
        if (detailBuyer?.id === buyerId) {
          setDetailBuyer(fullBuyer);
        }
        setRows((prev) =>
          prev.map((r) =>
            r.id === buyerId
              ? {
                  ...r,
                  contact_salutation: fullBuyer.contact_salutation || null,
                  contact_full_name: fullBuyer.contact_full_name || null,
                  contact_designation: fullBuyer.contact_designation || null,
                  contact_calling_number: fullBuyer.contact_calling_number || null,
                  contact_whatsapp_number: fullBuyer.contact_whatsapp_number || null,
                  emails: fullBuyer.emails || [],
                }
              : r
          )
        );
      }
      if (contactsRes.data) {
        setContacts(contactsRes.data);
      }
    } catch (err) {
      console.error("Failed to re-sync buyer profile after contact change:", err);
    }
  }

  function openAddContact() {
    setEditingContactId(null);
    const hasExistingPrimary = contacts.some((c) => c.is_primary);
    setContactForm({
      ...EMPTY_CONTACT_FORM,
      country_id: form.country_id || defaultUgandaId,
      emails: [],
      is_primary: !hasExistingPrimary,
    });
    setContactFormOpen(true);
  }

  function openEditContact(c: BuyerContact) {
    setEditingContactId(c.id);
    const parsedEmails = c.email
      ? c.email.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean)
      : [];
    setContactForm({
      salutation: c.salutation || "",
      person_name: c.person_name || "",
      designation: c.designation || "",
      country_id: c.country_id || form.country_id || defaultUgandaId,
      calling_number: c.calling_number || "",
      whatsapp_number: c.whatsapp_number || "",
      email: c.email || "",
      emails: parsedEmails,
      is_primary: Boolean(c.is_primary),
    });
    setContactFormOpen(true);
  }

  async function handleSaveContact(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    if (contactSubmitting) return; // Phase 7: ignore a second click while the first save is still in flight
    if (!contactForm.person_name.trim()) {
      alert("Contact Full Name is required.");
      return;
    }
    if (contactForm.calling_number) {
      const err = validatePhoneNumber(contactForm.calling_number, "Calling number");
      if (err) {
        alert(err);
        return;
      }
    }
    if (contactForm.whatsapp_number) {
      const err = validatePhoneNumber(contactForm.whatsapp_number, "WhatsApp number");
      if (err) {
        alert(err);
        return;
      }
    }
    const finalEmail =
      contactForm.emails && contactForm.emails.length > 0
        ? contactForm.emails.join(", ")
        : contactForm.email?.trim() || null;
    const payload = {
      salutation: contactForm.salutation?.trim() || null,
      person_name: contactForm.person_name.trim(),
      designation: contactForm.designation?.trim() || null,
      calling_number: normalizePhoneValue(contactForm.calling_number),
      whatsapp_number: normalizePhoneValue(contactForm.whatsapp_number),
      email: finalEmail,
      country_id: contactForm.country_id || form.country_id || null,
      is_primary: contactForm.is_primary,
    };
    setContactSubmitting(true);
    try {
      if (editingContactId) {
        await apiPatch<BuyerContact>(`/buyers/${editingId}/contacts/${editingContactId}`, payload);
      } else {
        await apiPost<BuyerContact>(`/buyers/${editingId}/contacts`, payload);
      }
      setContactForm(EMPTY_CONTACT_FORM);
      setEditingContactId(null);
      setContactFormOpen(false);
      await refreshBuyerProfileAfterContactChange(editingId);
    } catch (err) {
      setError(err);
    } finally {
      setContactSubmitting(false);
    }
  }

  async function handleMakePrimaryContact(contactId: string) {
    if (!editingId) return;
    await guardRowAction(`primary-contact:${contactId}`, async () => {
      try {
        await apiPost(`/buyers/${editingId}/contacts/${contactId}/make-primary`);
        await refreshBuyerProfileAfterContactChange(editingId);
      } catch (err) {
        setError(err);
      }
    });
  }

  async function handleDeleteContact(contactId: string) {
    if (!editingId) return;
    const confirmed = await confirm({
      title: "Remove Contact Person",
      message: "Are you sure you want to remove this contact person? This action cannot be undone.",
      confirmLabel: "Remove Contact",
      variant: "danger",
    });
    if (!confirmed) return;
    await guardRowAction(`delete-contact:${contactId}`, async () => {
      try {
        await apiDelete(`/buyers/${editingId}/contacts/${contactId}`);
        await refreshBuyerProfileAfterContactChange(editingId);
      } catch (err) {
        setError(err);
      }
    });
  }

  /* Bulk Actions Handlers */
  async function handleBulkActivate() {
    if (!selectedIds.length) return;
    const idsToActivate = [...selectedIds];
    const previousRows = [...rows];

    // 1. INSTANT 0ms OPTIMISTIC CUT-OFF
    setSelectedIds([]);
    if (statusTab === "inactive") {
      setRows((prev) => prev.filter((r) => !idsToActivate.includes(r.id)));
    } else {
      setRows((prev) => prev.map((r) => (idsToActivate.includes(r.id) ? { ...r, is_active: true } : r)));
    }

    // 2. Server persistence
    await guardRowAction("bulk-activate", async () => {
      try {
        await Promise.all(idsToActivate.map((id) => apiPost(`/buyers/${id}/activate`)));
        reload();
      } catch (err) {
        setRows(previousRows);
        setSelectedIds(idsToActivate);
        setError(err);
      }
    });
  }

  async function handleBulkDeactivate() {
    if (!selectedIds.length) return;
    const idsToDeactivate = [...selectedIds];
    const previousRows = [...rows];

    // 1. INSTANT 0ms OPTIMISTIC CUT-OFF
    setSelectedIds([]);
    if (statusTab === "active") {
      setRows((prev) => prev.filter((r) => !idsToDeactivate.includes(r.id)));
    } else {
      setRows((prev) => prev.map((r) => (idsToDeactivate.includes(r.id) ? { ...r, is_active: false } : r)));
    }

    // 2. Server persistence
    await guardRowAction("bulk-deactivate", async () => {
      try {
        await Promise.all(idsToDeactivate.map((id) => apiPost(`/buyers/${id}/deactivate`)));
        reload();
      } catch (err) {
        setRows(previousRows);
        setSelectedIds(idsToDeactivate);
        setError(err);
      }
    });
  }

  async function handleBulkDelete() {
    if (!selectedIds.length) return;

    const restricted = rows.filter(
      (r) => selectedIds.includes(r.id) && (r.current_status === "existing" || r.potential === "yes")
    );
    if (restricted.length > 0) {
      alert(
        `Cannot delete ${restricted.length} selected buyer(s)!\n\n` +
        `Document Rule: Buyers with Current Status 'Existing' or Potential 'Yes' cannot be deleted. You can deactivate them instead.`
      );
      return;
    }

    const confirmed = await confirm({
      title: "Delete Selected Buyers",
      message: `Delete ${selectedIds.length} selected buyer(s)? This action cannot be undone.`,
      confirmLabel: "Delete Selected",
      variant: "danger",
    });
    if (!confirmed) return;
    await guardRowAction("bulk-delete", async () => {
      try {
        await Promise.all(selectedIds.map((id) => apiDelete(`/buyers/${id}`)));
        setRows((prev) => prev.filter((r) => !selectedIds.includes(r.id)));
        setTotalRecords((prev) => Math.max(0, prev - selectedIds.length));
        setSelectedIds([]);
      } catch (err) {
        setError(err);
      }
    });
  }

  async function handleInlineUpdate(buyerId: string, path: string, updates: Record<string, unknown>) {
    // 1. Optimistic live update in memory (0ms dynamic UI reaction)
    setRows((prev) =>
      prev.map((b) => (b.id === buyerId ? { ...b, ...updates } : b))
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
      await downloadExport("/buyers", format, "buyers");
    } catch (err) {
      setError(err);
    }
  }

  /* Sticky cell style generator with proper zIndex & background layering (Row 1 Header frozen top: 0 permanently) */
  const getFreezeStyle = useCallback(
    (colIdx: number, isHeader = false): React.CSSProperties => {
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
          boxShadow: isLastLeft ? "inset -2px 0 0 0 #64748b, 4px 0 8px -2px rgba(0, 0, 0, 0.15)" : "none",
          borderRight: isLastLeft ? "2px solid #64748b" : undefined,
        };
      }

      const right = colRightOffsets[colIdx] ?? 0;
      return {
        ...headerTopStyle,
        position: "sticky",
        right: `${right}px`,
        zIndex: isHeader ? 35 : 10,
        backgroundColor: isHeader ? "#f8fafc" : "#ffffff",
        boxShadow: isFirstRight ? "inset 2px 0 0 0 #64748b, -4px 0 8px -2px rgba(0, 0, 0, 0.15)" : "none",
        borderLeft: isFirstRight ? "2px solid #64748b" : undefined,
      };
    },
    [pinnedCols, colLeftOffsets, colRightOffsets, displayOrder]
  );

  /* Real-time Field-level Duplicate Warnings */
  const fieldDuplicates = useMemo(() => {
    const cleanCompany = form.company_name.trim().toLowerCase().replace(/[\s-]/g, "");
    const cleanCalling = extractSubscriberNumber(form.contact_calling_number) ? form.contact_calling_number.trim().replace(/\D/g, "") : "";
    const cleanWhatsapp = extractSubscriberNumber(form.contact_whatsapp_number) ? form.contact_whatsapp_number.trim().replace(/\D/g, "") : "";

    let companyWarning: string | null = null;
    let callingWarning: string | null = null;
    let whatsappWarning: string | null = null;

    if (!cleanCompany && !cleanCalling && !cleanWhatsapp) {
      return { companyWarning, callingWarning, whatsappWarning };
    }

    const buyerPool = allBuyersLookup.items.length > 0 ? allBuyersLookup.items : rows;
    for (const r of buyerPool) {
      if (modalMode === "edit" && r.id === editingId) continue;

      const rComp = r.company_name.toLowerCase().replace(/[\s-]/g, "");
      const rCall = (r.contact_calling_number || "").replace(/\D/g, "");
      const rWhats = (r.contact_whatsapp_number || "").replace(/\D/g, "");

      // 1. Company Name Warning
      if (cleanCompany && !companyWarning && rComp === cleanCompany) {
        companyWarning = `Company name '${r.company_name}' already exists in Master.`;
      }

      // 2. Calling Number Warning (matches calling or whatsapp of any existing buyer)
      if (cleanCalling && cleanCalling.length >= 6 && !callingWarning) {
        if ((rCall && rCall === cleanCalling) || (rWhats && rWhats === cleanCalling)) {
          callingWarning = `Calling number already exists (used by '${r.company_name}').`;
        }
      }

      // 3. WhatsApp Number Warning (matches calling or whatsapp of any existing buyer)
      if (cleanWhatsapp && cleanWhatsapp.length >= 6 && !whatsappWarning) {
        if ((rCall && rCall === cleanWhatsapp) || (rWhats && rWhats === cleanWhatsapp)) {
          whatsappWarning = `WhatsApp number already exists (used by '${r.company_name}').`;
        }
      }
    }

    return { companyWarning, callingWarning, whatsappWarning };
  }, [form.company_name, form.contact_calling_number, form.contact_whatsapp_number, rows, allBuyersLookup.items, modalMode, editingId]);

  /* ------------------------------------------------------------------------- */
  /* RENDER: DEDICATED FULL-PAGE IMPORT BUYERS VIEW (Matching Image 1)         */
  /* ------------------------------------------------------------------------- */
  if (modalMode === "import") {
    return (
      <AppShell activeKey="buyers">
        <main className="page" style={{ width: "100%", padding: "16px 24px", boxSizing: "border-box" }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <div>
              <h1 className="page-title">Import Buyers</h1>
            </div>
            <button
              type="button"
              onClick={() => {
                setModalMode(null);
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
                    Upload only brand new buyer accounts. Any rows with duplicate company names, phone numbers, or WhatsApp numbers will be safely skipped.
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
                    Update existing buyers matching company names. <strong>Zero Data Loss:</strong> Blank cells in your file are ignored and will never erase existing fields.
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
                  onClick={() => downloadSampleCsv("buyer", BUYER_IMPORT_HEADERS)}
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
                <li>Mandatory Columns: <strong>Company Name</strong> And <strong>Country</strong>.</li>
                <li><strong>Company Name</strong> Must Be Unique.</li>
                <li><strong>Country, Product Category, Product Sub Category, And Buyer Type</strong> Must Already Exist In The System.</li>
                <li><strong>Product Sub Category</strong> Must Belong To The Selected <strong>Product Category</strong>.</li>
                <li><strong>3-Way Duplicate Check:</strong> Duplicate rows are detected by <strong>Company Name</strong>, <strong>Calling Number</strong>, And <strong>WhatsApp Number</strong>.</li>
                <li><strong>Calling Number</strong> And <strong>WhatsApp Number</strong> Must Include Country Code (Maximum 15 Digits Total).</li>
                <li>Multiple <strong>Emails</strong>, <strong>Product Categories</strong>, And <strong>Product Sub Categories</strong> Can Be Separated By Comma (,).</li>
                <li><strong>Current Status</strong> Must Be <em>Existing</em> Or <em>New</em>; <strong>Potential</strong> Must Be <em>Yes</em> Or <em>No</em>; <strong>Client Grade</strong> Must Be <em>A</em>, <em>B</em>, Or <em>C</em>.</li>
                <li>No Blank Rows, Merged Cells, Or Excel Formulas Allowed.</li>
                <li>Buyer Import May Take <strong>Several Seconds</strong> Depending On The Number Of Rows And Server Load. Please Do Not Refresh The Page During Import.</li>
              </ul>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "32px", borderTop: "1px solid #f1f5f9", paddingTop: "20px", gap: "12px" }}>
              <button
                type="button"
                onClick={() => {
                  setModalMode(null);
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

          {/* Column Mapping Wizard Modal (Matches Supplier Master) */}
          {wizardPending && (
            <WizardModal
              file={wizardPending.file}
              rows={wizardPending.rows}
              sheetColumns={wizardPending.sheetColumns}
              apiBase="/buyers"
              entityName="buyer"
              importHeaders={BUYER_IMPORT_HEADERS}
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

  /* ------------------------------------------------------------------------- */
  /* RENDER: TABBED ADD / EDIT BUYER FORM (Supplier & Product Master Style)    */
  /* ------------------------------------------------------------------------- */
  if (modalMode) {
    return (
      <AppShell activeKey="buyers">
        <main className="page" style={{ width: "100%", padding: "16px 24px", boxSizing: "border-box" }}>
          {/* Form Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <h1 className="page-title">
                {modalMode === "create" ? "Add Buyer (Client) Profile" : `Edit Buyer Profile: ${form.company_name}`}
              </h1>
            </div>
            <button
              type="button"
              onClick={() => setModalMode(null)}
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
              ← BACK TO BUYERS
            </button>
          </div>

          <Banner error={error} />

          {/* Main Workspace Card */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #cbd5e1",
              padding: "24px 28px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            {/* Top Navigation Tabs */}
            <div style={{ display: "flex", gap: "24px", borderBottom: "2px solid #e2e8f0", marginBottom: "24px" }}>
              <button
                type="button"
                onClick={() => setEditTab("profile")}
                style={{
                  padding: "10px 18px",
                  background: "none",
                  border: "none",
                  borderBottom: editTab === "profile" ? "3px solid #2563eb" : "3px solid transparent",
                  color: editTab === "profile" ? "#2563eb" : "#64748b",
                  fontWeight: editTab === "profile" ? 700 : 600,
                  fontSize: "14.5px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "-2px",
                }}
              >
                <span style={{ fontSize: "16px" }}>👤</span> Profile
              </button>

              {modalMode === "edit" && (
                <button
                  type="button"
                  onClick={() => setEditTab("contacts")}
                  style={{
                    padding: "10px 18px",
                    background: "none",
                    border: "none",
                    borderBottom: editTab === "contacts" ? "3px solid #2563eb" : "3px solid transparent",
                    color: editTab === "contacts" ? "#2563eb" : "#64748b",
                    fontWeight: editTab === "contacts" ? 700 : 600,
                    fontSize: "14.5px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "-2px",
                  }}
                >
                  <span style={{ fontSize: "16px" }}>📇</span> Contacts
                  <span
                    style={{
                      background: editTab === "contacts" ? "#dbeafe" : "#f1f5f9",
                      color: editTab === "contacts" ? "#1d4ed8" : "#64748b",
                      fontSize: "12px",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: "12px",
                    }}
                  >
                    {contacts.length}
                  </span>
                </button>
              )}
            </div>

            {/* TAB 1: PROFILE FORM */}
            {editTab === "profile" && (
              <form onSubmit={handleSubmit} onKeyDown={handleFormEnterKeyNavigation} noValidate style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                {/* 1. Identity & Business Profile */}
                <div>
                  <div style={sectionTitleStyle}>Identity &amp; Business Profile</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>

                    {/* Company Name with Untouchable / Non-selectable suggestions (matching Suppliers) */}
                    <div style={{ position: "relative" }}>
                      <label style={{ fontSize: "13px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>
                        Name of Company <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <input
                        id="company_name"
                        type="text"
                        value={form.company_name}
                        onChange={(e) => {
                          const val = autoTitleCase(e.target.value, "company_name");
                          setField("company_name", val);
                          if (validationErrors["company_name"]) setValidationErrors((prev) => ({ ...prev, company_name: "" }));
                        }}
                        placeholder="Name of Company"
                        autoComplete="off"
                        style={{
                          width: "100%",
                          height: "38px",
                          padding: "0 12px",
                          fontSize: "13px",
                          borderRadius: "6px",
                          border: validationErrors["company_name"] ? "1.5px solid #ef4444" : "1px solid #cbd5e1",
                          backgroundColor: validationErrors["company_name"] ? "#fff5f5" : "#ffffff",
                          boxShadow: validationErrors["company_name"] ? "0 0 0 3px rgba(239, 68, 68, 0.15)" : "none",
                          color: "#0f172a",
                          outline: "none",
                          boxSizing: "border-box",
                          transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                        }}
                        onFocus={(e) => {
                          setIsCompanyInputFocused(true);
                          if (!validationErrors["company_name"]) {
                            e.target.style.borderColor = "#2563eb";
                            e.target.style.boxShadow = "0 0 0 3px rgba(37, 99, 235, 0.15)";
                          }
                        }}
                        onBlur={(e) => {
                          setTimeout(() => setIsCompanyInputFocused(false), 200);
                          if (!validationErrors["company_name"]) {
                            e.target.style.borderColor = "#cbd5e1";
                            e.target.style.boxShadow = "none";
                          }
                        }}
                      />
                      {validationErrors["company_name"] && (
                        <div style={{ color: "#ef4444", fontSize: "12px", fontWeight: 600, marginTop: "5px", display: "flex", alignItems: "center", gap: "4px" }}>
                          <span>⚠️</span> {validationErrors["company_name"]}
                        </div>
                      )}
                      {(() => {
                        const typed = (form.company_name || "").trim();
                        if (!typed) return null;
                        const cleanTyped = typed.toLowerCase().replace(/[\s-]/g, "");

                        const pool = allBuyersLookup.items.length > 0 ? allBuyersLookup.items : rows;

                        const exact = pool.find((b) => {
                          if (editingId && String(b.id).toLowerCase() === String(editingId).toLowerCase()) return false;
                          const bName = (b.company_name || "").toLowerCase().replace(/[\s-]/g, "");
                          return bName === cleanTyped;
                        });

                        const matches = pool
                          .filter((b) => {
                            if (editingId && String(b.id).toLowerCase() === String(editingId).toLowerCase()) return false;
                            const bName = (b.company_name || "").toLowerCase().replace(/[\s-]/g, "");
                            return bName.includes(cleanTyped);
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
                                    <span>Buyer "{exact.company_name}" already exists in Master! Cannot save duplicate.</span>
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
                                  {matches.map((b) => {
                                    const isThisExact = (b.company_name || "").trim().toLowerCase() === typed.toLowerCase();
                                    return (
                                      <div
                                        key={b.id || b.company_name}
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
                                          <span style={{ fontWeight: isThisExact ? 700 : 500 }}>{b.company_name}</span>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                          {b.buyer_type && (
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
                                              {b.buyer_type}
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
                                <span>⛔</span> Buyer "{exact.company_name}" already exists in Buyer Master! Cannot save duplicate.
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    {/* Buyer Type Dropdown with Search / Type here... */}
                    <SelectField
                      id="buyer_type"
                      label="Buyer Type"
                      value={form.buyer_type}
                      onChange={(v) => setField("buyer_type", v)}
                    >
                      <option value="">-- Select Buyer Type --</option>
                      {buyerTypes.items.map((bt) => (
                        <option key={bt.id} value={bt.name.toLowerCase()}>
                          {bt.name}
                        </option>
                      ))}
                      {!buyerTypes.items.some((bt) => bt.name.toLowerCase() === "manufacturer") && (
                        <option value="manufacturer">Manufacturer</option>
                      )}
                      {!buyerTypes.items.some((bt) => bt.name.toLowerCase() === "dealer / trader" || bt.name.toLowerCase() === "trader") && (
                        <option value="trader">Dealer / Trader</option>
                      )}
                      {!buyerTypes.items.some((bt) => bt.name.toLowerCase() === "agent") && (
                        <option value="agent">Agent</option>
                      )}
                      {!buyerTypes.items.some((bt) => bt.name.toLowerCase() === "importer") && (
                        <option value="importer">Importer</option>
                      )}
                      {form.buyer_type &&
                        !buyerTypes.items.some((bt) => bt.name.toLowerCase() === form.buyer_type.toLowerCase()) &&
                        !["manufacturer", "trader", "dealer / trader", "dealer", "agent", "importer"].includes(form.buyer_type.toLowerCase()) && (
                          <option value={form.buyer_type.toLowerCase()}>{form.buyer_type.toUpperCase()}</option>
                        )}
                    </SelectField>

                    <TextField id="tax_id_number" label="Tax ID Number (TIN / GST)" placeholder="e.g. Tax / GST / TIN Number" value={form.tax_id_number} onChange={(v) => setField("tax_id_number", v)} />
                  </div>
                </div>

                {/* 2. Classification & Product Categories (MultiPanel: Multi-Select with Search & Checkboxes that stay open) */}
                <div>
                  <div style={sectionTitleStyle}>Classification &amp; Product Interest</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                    <div>
                      <label style={{ fontSize: "13px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>Category</label>
                      <SearchableDropdownMultiPanel
                        values={categoryIds}
                        onChange={(newCatIds) => {
                          setCategoryIds(newCatIds);
                          // Auto-prune any subCategoryIds that no longer belong to selected categories
                          if (newCatIds.length === 0) {
                            setSubCategoryIds([]);
                          } else {
                            setSubCategoryIds((prevSubIds) => {
                              const validCategorySubIds = subCategories.items
                                .filter((sc) => newCatIds.includes(sc.category_id))
                                .map((sc) => sc.id);
                              return prevSubIds.filter((id) => validCategorySubIds.includes(id));
                            });
                          }
                        }}
                        placeholder="-- Select Categories --"
                        fetchOptions={fetchCategoryOptions}
                        fetchLabelForValue={fetchCategoryLabel}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "13px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>Sub Category</label>
                      <SearchableDropdownMultiPanel
                        values={subCategoryIds}
                        onChange={setSubCategoryIds}
                        disabled={categoryIds.length === 0}
                        placeholder={categoryIds.length > 0 ? "-- Select Sub Categories --" : "-- Please select Category first --"}
                        fetchOptions={fetchSubCategoryOptions}
                        fetchLabelForValue={fetchSubCategoryLabel}
                      />
                    </div>
                  </div>
                </div>

                {/* 3. Location Details */}
                <div>
                  <div style={sectionTitleStyle}>Location Details</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "16px" }}>
                    <SelectField
                      id="country_id"
                      label="Country *"
                      required
                      value={form.country_id}
                      onChange={(v) => setField("country_id", v)}
                      hasError={Boolean(validationErrors["country_id"])}
                      hint={
                        validationErrors["country_id"] ? (
                          <span style={{ color: "#dc2626", fontWeight: 600, fontSize: "12px" }}>
                            ⚠️ {validationErrors["country_id"]}
                          </span>
                        ) : undefined
                      }
                    >
                      <option value="">-- Select Country --</option>
                      {countries.items.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </SelectField>

                    <div>
                      <label style={{ fontSize: "13px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>
                        State / Province <span style={{ fontSize: "11.5px", fontWeight: 400, color: "#64748b" }}>(Optional)</span>
                      </label>
                      <SearchableDropdown
                        key={`buyer-state-${form.country_id}`}
                        id="state_id"
                        value={formStateId}
                        onChange={(v) => {
                          setFormStateId(v);
                          setField("state_id", v || "");
                          setFormCityId(null);
                          setField("city", "");
                        }}
                        disabled={!form.country_id}
                        placeholder={form.country_id ? "Search state / province from Master..." : "-- Please select Country first --"}
                        fetchOptions={searchFetcher("/masters/states", (): Record<string, string> =>
                          form.country_id ? { country_id: form.country_id } : {}
                        )}
                        fetchLabelForValue={fetchNameLabel("/masters/states")}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: "13px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>
                        City <span style={{ fontSize: "11.5px", fontWeight: 400, color: "#64748b" }}>(Optional)</span>
                      </label>
                      <SearchableDropdown
                        key={`buyer-city-${form.country_id}-${formStateId || ""}`}
                        id="city"
                        value={formCityId}
                        onChange={(v, label) => {
                          setFormCityId(v);
                          setField("city", v ? (label || "") : "");
                        }}
                        disabled={!formStateId}
                        placeholder={
                          !form.country_id
                            ? "-- Please select Country first --"
                            : !formStateId
                            ? "-- Please select State / Province first --"
                            : "Search city from Master..."
                        }
                        fetchOptions={
                          !formStateId
                            ? async () => []
                            : searchFetcher("/masters/cities", (): Record<string, string> => {
                                const p: Record<string, string> = { state_id: formStateId };
                                if (form.country_id) p.country_id = form.country_id;
                                return p;
                              })
                        }
                        fetchLabelForValue={fetchNameLabel("/masters/cities")}
                      />
                    </div>
                  </div>
                  <TextAreaField id="address" label="Address" rows={2} placeholder="Full postal address details…" value={form.address} onChange={(v) => setField("address", v)} />
                </div>

                {/* 4. Primary Contact Person */}
                <div>
                  <div style={sectionTitleStyle}>Primary Contact Person</div>
                  <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr", gap: "16px", marginBottom: "16px" }}>
                    <SelectField
                      id="contact_salutation"
                      label="Title"
                      value={form.contact_salutation}
                      onChange={(v) => setField("contact_salutation", v)}
                    >
                      <option value="">Title</option>
                      <option value="Mr.">Mr.</option>
                      <option value="Mrs.">Mrs.</option>
                      <option value="Ms.">Ms.</option>
                    </SelectField>
                    <TextField id="contact_full_name" label="Full Name" placeholder="Contact Person Full Name" value={form.contact_full_name} onChange={(v) => setField("contact_full_name", v)} />
                    <TextField id="contact_designation" label="Designation" placeholder="e.g. Purchase Manager / Owner" value={form.contact_designation} onChange={(v) => setField("contact_designation", v)} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                    <PhoneGroupField
                      id="contact_calling_number"
                      label="Calling Number (with country code, max 15 digits)"
                      placeholder="700000000"
                      value={form.contact_calling_number}
                      onChange={(v) => setField("contact_calling_number", v)}
                      hasError={Boolean(validationErrors["contact_calling_number"])}
                      hint={
                        validationErrors["contact_calling_number"] ? (
                          <span style={{ color: "#dc2626", fontWeight: 600, fontSize: "12px" }}>
                            ⚠️ {validationErrors["contact_calling_number"]}
                          </span>
                        ) : fieldDuplicates.callingWarning ? (
                          <span style={{ color: "#dc2626", fontWeight: 600, fontSize: "12px" }}>
                            ⚠️ {fieldDuplicates.callingWarning}
                          </span>
                        ) : undefined
                      }
                    />
                    <PhoneGroupField
                      id="contact_whatsapp_number"
                      label={
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span>WhatsApp Number (with country code, max 15 digits)</span>
                          <label style={{ fontSize: "11px", color: "#64748b", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <input
                              type="checkbox"
                              checked={whatsappSameAsCalling}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setWhatsappSameAsCalling(checked);
                                if (checked) {
                                  setField("contact_whatsapp_number", form.contact_calling_number);
                                }
                              }}
                            />
                            Same as calling
                          </label>
                        </div>
                      }
                      placeholder="700000000"
                      value={form.contact_whatsapp_number}
                      onChange={(v) => {
                        setWhatsappSameAsCalling(false);
                        setField("contact_whatsapp_number", v);
                      }}
                      hasError={Boolean(validationErrors["contact_whatsapp_number"])}
                      hint={
                        validationErrors["contact_whatsapp_number"] ? (
                          <span style={{ color: "#dc2626", fontWeight: 600, fontSize: "12px" }}>
                            ⚠️ {validationErrors["contact_whatsapp_number"]}
                          </span>
                        ) : fieldDuplicates.whatsappWarning ? (
                          <span style={{ color: "#dc2626", fontWeight: 600, fontSize: "12px" }}>
                            ⚠️ {fieldDuplicates.whatsappWarning}
                          </span>
                        ) : undefined
                      }
                    />
                  </div>
                </div>

                {/* 5. Online & Digital Channels */}
                <div>
                  <div style={sectionTitleStyle}>Digital Channels &amp; Emails</div>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "16px" }}>
                    <EmailTagInput
                      id="emails"
                      label="Email IDs (Multiple)"
                      emails={form.emails}
                      onChange={(newEmails) => setForm((prev) => ({ ...prev, emails: newEmails }))}
                      placeholder="Type email address and press Enter..."
                    />
                    <WebsiteTagInput
                      id="website"
                      label="Website (Multiple)"
                      placeholder="Type website and press Enter..."
                      value={form.website}
                      onChange={(v) => setField("website", v)}
                    />
                  </div>
                </div>

                {/* 6. Pipeline Status & Potential */}
                <div>
                  <div style={sectionTitleStyle}>Sales Pipeline Status &amp; Potential</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
                    <SelectField
                      id="current_status"
                      label="Current Status"
                      value={form.current_status}
                      disabled={Boolean(editingId && !canEditCurrentStatus)}
                      onChange={(v) => setField("current_status", v)}
                    >
                      <option value="">-- Select Status --</option>
                      {(!rows.find((b) => b.id === editingId) || rows.find((b) => b.id === editingId)?.current_status !== "existing") && (
                        <option value="new">New</option>
                      )}
                      <option value="existing">Existing</option>
                    </SelectField>

                    <SelectField
                      id="potential"
                      label="Potential"
                      value={form.potential}
                      disabled={Boolean(editingId && !canEditPotential)}
                      onChange={(v) => setField("potential", v)}
                    >
                      <option value="">-- Select Potential --</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </SelectField>

                    <SelectField
                      id="buyer_grade"
                      label="Client Grade"
                      value={form.buyer_grade}
                      disabled={Boolean(editingId && !canEditClientGrade)}
                      onChange={(v) => setField("buyer_grade", v)}
                    >
                      <option value="">-- Select Grade --</option>
                      <option value="A">Grade A</option>
                      <option value="B">Grade B</option>
                      <option value="C">Grade C</option>
                    </SelectField>

                    <SelectField
                      id="is_active"
                      label="Status"
                      value={form.is_active}
                      onChange={(v) => setField("is_active", v)}
                    >
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </SelectField>
                  </div>

                  {/* Conditional Potential Reason */}
                  {form.potential === "no" && (
                    <div style={{ marginTop: "14px" }}>
                      <TextAreaField id="potential_reason" label="If Potential is No, Reason *" rows={2} placeholder="Specify detailed reason why potential is No…" value={form.potential_reason} onChange={(v) => setField("potential_reason", v)} />
                    </div>
                  )}
                </div>

                {/* 7. Product Range & Remarks */}
                <div>
                  <div style={sectionTitleStyle}>Product Range &amp; Remarks</div>
                  <TextAreaField id="product_range" label="Product Range (Manufactured or Supplied)" rows={2} placeholder="Products they supply or manufacture…" value={form.product_range} onChange={(v) => setField("product_range", v)} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "14px" }}>
                    <TextAreaField id="currently_buying_from" label="Currently Buying From" rows={2} placeholder="Competitors or suppliers they currently buy from…" value={form.currently_buying_from} onChange={(v) => setField("currently_buying_from", v)} />
                    <TextAreaField id="overall_remarks" label="Overall Observation / Remarks" rows={2} placeholder="General observation remarks…" value={form.overall_remarks} onChange={(v) => setField("overall_remarks", v)} />
                  </div>
                </div>

                {/* Form Action Buttons */}
                <div style={{ borderTop: "2px solid #e2e8f0", paddingTop: "16px", marginTop: "12px", display: "flex", justifyContent: "flex-end", gap: "12px" }}>
                  <button
                    type="button"
                    onClick={() => setModalMode(null)}
                    style={{ padding: "9px 20px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#ffffff", fontWeight: 600, fontSize: "13.5px", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formSubmitting}
                    style={{ padding: "9px 24px", borderRadius: "6px", background: "#2563eb", color: "#ffffff", border: "none", fontWeight: 600, fontSize: "13.5px", cursor: formSubmitting ? "default" : "pointer", opacity: formSubmitting ? 0.7 : 1 }}
                  >
                    {formSubmitting ? "Saving…" : modalMode === "create" ? "Save Buyer Profile" : "Update Buyer Profile"}
                  </button>
                </div>
              </form>
            )}

            {/* TAB 2: CONTACTS MANAGEMENT TAB (Matching Supplier Contacts Tab Layout) */}
            {editTab === "contacts" && modalMode === "edit" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                  <div>
                    <h3 style={{ fontSize: "17px", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                      Buyer Contact Persons ({contacts.length})
                    </h3>
                    <div style={{ fontSize: "13px", color: "#64748b", marginTop: "3px" }}>
                      Manage contact persons, designations, numbers, and email addresses for {form.company_name}.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={openAddContact}
                    style={{
                      background: "#2563eb",
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
                    + Add New Contact
                  </button>
                </div>

                {/* Contacts List Table */}
                <div style={{ border: "1px solid #e2e8f0", borderRadius: "8px", overflow: "hidden", background: "#ffffff" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                        <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700 }}>NAME / DESIGNATION</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700 }}>CALLING / WHATSAPP</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700 }}>EMAIL</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700 }}>TAG</th>
                        <th style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700 }}>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ textAlign: "center", padding: "32px", color: "#94a3b8", fontStyle: "italic" }}>
                            No contact persons added yet. Click "+ Add New Contact" to add key contacts.
                          </td>
                        </tr>
                      ) : (
                        contacts.map((c) => (
                          <tr key={c.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "12px 16px" }}>
                              <div style={{ fontWeight: 700, color: "#0f172a" }}>
                                {c.salutation} {c.person_name}
                              </div>
                              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                                {c.designation || "No Designation"}
                              </div>
                            </td>
                            <td style={{ padding: "12px 16px", verticalAlign: "middle" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                <div style={{ color: "#334155", display: "flex", alignItems: "center", gap: "6px" }}>
                                  <span>📞</span>
                                  {c.calling_number ? (
                                    <a
                                      href={`tel:${c.calling_number}`}
                                      style={{ color: "#1e293b", textDecoration: "none", fontWeight: 500 }}
                                      title="Call"
                                    >
                                      {c.calling_number}
                                    </a>
                                  ) : (
                                    <span style={{ color: "#94a3b8" }}>—</span>
                                  )}
                                </div>
                                <div style={{ color: "#334155", display: "flex", alignItems: "center", gap: "6px" }}>
                                  <WhatsAppIcon size={14} />
                                  {c.whatsapp_number ? (
                                    <a
                                      href={`https://wa.me/${c.whatsapp_number.replace(/[^0-9]/g, "")}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ color: "#16a34a", textDecoration: "none", fontWeight: 500 }}
                                      title="Open WhatsApp"
                                    >
                                      {c.whatsapp_number}
                                    </a>
                                  ) : (
                                    <span style={{ color: "#94a3b8" }}>—</span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: "12px 16px" }}>
                              {c.email ? (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                  {c.email
                                    .split(/[\s,;]+/)
                                    .map((em) => em.trim())
                                    .filter(Boolean)
                                    .map((em, eIdx) => (
                                      <a
                                        key={`${em}-${eIdx}`}
                                        href={`mailto:${em}`}
                                        style={{
                                          color: "#2563eb",
                                          background: "#eff6ff",
                                          border: "1px solid #dbeafe",
                                          padding: "2px 6px",
                                          borderRadius: "4px",
                                          textDecoration: "none",
                                          fontWeight: 500,
                                          fontSize: "12px",
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: "4px",
                                        }}
                                        title={`Send email to ${em}`}
                                      >
                                        <span>✉️</span> {em}
                                      </a>
                                    ))}
                                </div>
                              ) : (
                                <span style={{ color: "#94a3b8" }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: "12px 16px" }}>
                              {c.is_primary ? (
                                <span style={{ padding: "3px 9px", borderRadius: "12px", background: "#dbeafe", color: "#1d4ed8", fontSize: "11.5px", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                  ★ Primary Contact
                                </span>
                              ) : (
                                <span style={{ padding: "3px 9px", borderRadius: "12px", background: "#f1f5f9", color: "#64748b", fontSize: "11.5px", fontWeight: 500 }}>
                                  Team Member
                                </span>
                              )}
                            </td>
                            <td style={{ padding: "12px 16px", textAlign: "right" }}>
                              <div style={{ display: "inline-flex", gap: "8px" }}>
                                {!c.is_primary && (
                                  <button
                                    type="button"
                                    disabled={isRowActionPending(`primary-contact:${c.id}`)}
                                    onClick={() => handleMakePrimaryContact(c.id)}
                                    style={{
                                      padding: "4px 10px",
                                      fontSize: "12px",
                                      borderRadius: "4px",
                                      border: "1px solid #bfdbfe",
                                      background: "#eff6ff",
                                      color: "#1d4ed8",
                                      cursor: isRowActionPending(`primary-contact:${c.id}`) ? "default" : "pointer",
                                      fontWeight: 600,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "4px",
                                      opacity: isRowActionPending(`primary-contact:${c.id}`) ? 0.6 : 1,
                                    }}
                                    title="Promote this contact person to Primary Contact"
                                  >
                                    {isRowActionPending(`primary-contact:${c.id}`) ? "Updating…" : "★ Make Primary"}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openEditContact(c)}
                                  style={{ padding: "4px 10px", fontSize: "12px", borderRadius: "4px", border: "1px solid #cbd5e1", background: "#ffffff", color: "#0f172a", cursor: "pointer", fontWeight: 600 }}
                                >
                                  Edit
                                </button>
                                {!c.is_primary && (
                                  <button
                                    type="button"
                                    disabled={isRowActionPending(`delete-contact:${c.id}`)}
                                    onClick={() => handleDeleteContact(c.id)}
                                    style={{ padding: "4px 10px", fontSize: "12px", borderRadius: "4px", border: "1px solid #fee2e2", background: "#fff1f2", color: "#e11d48", cursor: isRowActionPending(`delete-contact:${c.id}`) ? "default" : "pointer", fontWeight: 600, opacity: isRowActionPending(`delete-contact:${c.id}`) ? 0.6 : 1 }}
                                  >
                                    {isRowActionPending(`delete-contact:${c.id}`) ? "Removing…" : "Delete"}
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

                {/* SIDE DRAWER FOR ADD / EDIT CONTACT */}
                {contactFormOpen && (
                  <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", justifyContent: "flex-end" }}>
                    <div
                      onClick={() => setContactFormOpen(false)}
                      style={{ position: "absolute", inset: 0, background: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(2px)" }}
                    />
                    <div
                      style={{
                        position: "relative",
                        width: "600px",
                        maxWidth: "94vw",
                        height: "100%",
                        background: "#ffffff",
                        boxShadow: "-8px 0 30px rgba(0,0,0,0.18)",
                        display: "flex",
                        flexDirection: "column",
                        zIndex: 10000,
                        overflowX: "hidden",
                      }}
                    >
                      <div style={{ padding: "18px 24px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h3 style={{ fontSize: "17px", fontWeight: 700, margin: 0, color: "#0f172a" }}>
                          {editingContactId ? "Edit Contact Person" : "Add Contact Person"}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setContactFormOpen(false)}
                          style={{ border: "none", background: "none", fontSize: "18px", color: "#64748b", cursor: "pointer" }}
                        >
                          ✕
                        </button>
                      </div>

                      <form onSubmit={handleSaveContact} onKeyDown={handleFormEnterKeyNavigation} style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px", flex: 1, overflowY: "auto", overflowX: "hidden" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "14px" }}>
                          <SelectField
                            id="salutation"
                            label="Title"
                            value={contactForm.salutation}
                            onChange={(v) => setContactForm((prev) => ({ ...prev, salutation: v }))}
                          >
                            <option value="">Select</option>
                            <option value="Mr.">Mr.</option>
                            <option value="Mrs.">Mrs.</option>
                            <option value="Ms.">Ms.</option>
                          </SelectField>
                          <TextField id="person_name" label="Full Name *" required placeholder="Contact Name" value={contactForm.person_name} onChange={(v) => setContactForm((prev) => ({ ...prev, person_name: v }))} />
                        </div>

                        <TextField id="designation" label="Designation" placeholder="e.g. Purchase Director" value={contactForm.designation} onChange={(v) => setContactForm((prev) => ({ ...prev, designation: v }))} />

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                          <PhoneGroupField
                            id="contact_calling"
                            label={
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                <span>📞</span> Calling Number
                              </span>
                            }
                            placeholder="700000000"
                            value={contactForm.calling_number}
                            onChange={(v) => setContactForm((prev) => ({ ...prev, calling_number: v }))}
                          />
                          <PhoneGroupField
                            id="contact_whatsapp"
                            label={
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                <WhatsAppIcon size={15} /> WhatsApp Number
                              </span>
                            }
                            placeholder="700000000"
                            value={contactForm.whatsapp_number}
                            onChange={(v) => setContactForm((prev) => ({ ...prev, whatsapp_number: v }))}
                          />
                        </div>

                        <EmailTagInput
                          id="contact_emails"
                          label={
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                              <span>✉️</span> Email IDs (Multiple)
                            </span>
                          }
                          emails={contactForm.emails || []}
                          onChange={(newEmails) =>
                            setContactForm((prev) => ({
                              ...prev,
                              emails: newEmails,
                              email: newEmails.join(", "),
                            }))
                          }
                          placeholder="Type email address and press Enter..."
                        />

                        <SelectField
                          id="country_id"
                          label="Country"
                          value={contactForm.country_id}
                          onChange={(v) => setContactForm((prev) => ({ ...prev, country_id: v }))}
                        >
                          <option value="">-- Select Country --</option>
                          {countries.items.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </SelectField>

                        <label
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "10px",
                            fontSize: "13px",
                            fontWeight: 600,
                            color: "#1e293b",
                            cursor: "pointer",
                            padding: "10px 14px",
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0",
                            borderRadius: "6px",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(contactForm.is_primary)}
                            onChange={(e) => setContactForm((prev) => ({ ...prev, is_primary: e.target.checked }))}
                            style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "#2563eb" }}
                          />
                          <span>★ Set as Primary Contact Person (syncs directly to Profile tab)</span>
                        </label>

                        <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "16px", marginTop: "auto", display: "flex", justifyContent: "flex-end", gap: "12px" }}>
                          <button
                            type="button"
                            onClick={() => setContactFormOpen(false)}
                            style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#ffffff", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={contactSubmitting}
                            style={{ padding: "8px 20px", borderRadius: "6px", background: "#2563eb", color: "#ffffff", border: "none", fontWeight: 600, fontSize: "13px", cursor: contactSubmitting ? "default" : "pointer", opacity: contactSubmitting ? 0.7 : 1 }}
                          >
                            {contactSubmitting ? "Saving…" : editingContactId ? "Update Contact" : "Save Contact"}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <TrashConflictModal
            isOpen={Boolean(trashConflict)}
            conflictInfo={trashConflict}
            onClose={() => setTrashConflict(null)}
            onRestored={async () => {
              setTrashConflict(null);
              setModalMode(null);
              reload();
            }}
          />
        </main>
      </AppShell>
    );
  }

  /* ------------------------------------------------------------------------- */
  /* RENDER: MAIN BUYER MASTER LIST VIEW                                        */
  /* ------------------------------------------------------------------------- */
  return (
    <AppShell activeKey="buyers">
      <main className="page" style={{ width: "100%", padding: "16px 24px", boxSizing: "border-box" }}>
        {/* Page Header matching Supplier Master Top Header Bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h1 className="page-title">Buyer Profiles</h1>
          </div>

          {/* Action Header Button Bar matching Supplier Master */}
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {/* Funnel Filter Icon Button (Matching Products Master) */}
            <button
              type="button"
              className={`btn btn-header-filter ${isFilterPanelOpen ? "active" : ""}`}
              onClick={() => setIsFilterPanelOpen((v) => !v)}
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                background: isFilterPanelOpen ? "#0061f2" : "#475569",
                color: "#ffffff",
                border: "none",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
              }}
              title="Toggle Filter Options"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
              </svg>
            </button>

            {/* Add New Buyer */}
            {canCreate && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={openCreate}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  background: "#2563eb",
                  color: "#ffffff",
                  fontWeight: 600,
                  fontSize: "13.5px",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                + ADD NEW BUYER
              </button>
            )}

            {/* Import / Export Dropdown */}
            <ImpExpDropdown
              apiBase="/buyers"
              entityName="buyer"
              importHeaders={BUYER_IMPORT_HEADERS}
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
                setModalMode("import");
              }}
            />

            {/* Bulk Actions Dropdown (Bulk Activate, Bulk Deactivate, Bulk Delete) */}
            {canBulkAction && (
              <BulkActionsDropdown
                selectedCount={selectedIds.length}
                onBulkActivate={canUpdate ? handleBulkActivate : undefined}
                onBulkDeactivate={canUpdate ? handleBulkDeactivate : undefined}
                onBulkDelete={canDelete ? handleBulkDelete : undefined}
              />
            )}
          </div>
        </div>

        <Banner error={error} />
        <ImportSummaryPanel summary={importSummary} error={importError} />

        {/* Top Filters Panel */}
        {isFilterPanelOpen && (
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: "8px",
              padding: "16px 20px",
              marginBottom: "16px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>Buyer Type</label>
                <SearchableFilterDropdown
                  value={buyerTypeFilter || null}
                  onChange={(_val, lbl) => {
                    setCurrentPage(1);
                    setBuyerTypeFilter(lbl ? lbl.toLowerCase() : "");
                  }}
                  placeholder="All"
                  allLabel="All"
                  fetchOptions={searchFetcher("/masters/buyer-types")}
                  fetchLabelForValue={fetchNameLabel("/masters/buyer-types")}
                />
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>Current Status</label>
                <select value={statusFilter} onChange={(e) => { setCurrentPage(1); setStatusFilter(e.target.value); }} style={{ ...selectFilterStyle, width: "100%" }}>
                  <option value="">All Status</option>
                  <option value="new">New</option>
                  <option value="existing">Existing</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>Potential</label>
                <select value={potentialFilter} onChange={(e) => { setCurrentPage(1); setPotentialFilter(e.target.value); }} style={{ ...selectFilterStyle, width: "100%" }}>
                  <option value="">Any Potential</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>Client Grade</label>
                <select value={gradeFilter} onChange={(e) => { setCurrentPage(1); setGradeFilter(e.target.value); }} style={{ ...selectFilterStyle, width: "100%" }}>
                  <option value="">Any Grade</option>
                  <option value="A">Grade A</option>
                  <option value="B">Grade B</option>
                  <option value="C">Grade C</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>Country</label>
                <SearchableFilterDropdown
                  value={countryFilter || null}
                  onChange={(val) => {
                    setCurrentPage(1);
                    setCountryFilter(val || "");
                  }}
                  placeholder="All"
                  allLabel="All"
                  fetchOptions={searchFetcher("/masters/countries")}
                  fetchLabelForValue={fetchNameLabel("/masters/countries")}
                />
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>Product Category</label>
                <SearchableFilterDropdown
                  value={categoryFilter || null}
                  onChange={(val) => {
                    setCurrentPage(1);
                    setCategoryFilter(val || "");
                    if (!val) setSubCategoryFilter("");
                  }}
                  placeholder="All"
                  allLabel="All"
                  fetchOptions={async (term) => {
                    const q = term.trim().toLowerCase();
                    const list = categories.items.filter((c) => !q || c.name.toLowerCase().includes(q));
                    return list.map((c) => ({ value: c.id, label: c.name }));
                  }}
                  fetchLabelForValue={async (id) => {
                    return categories.items.find((c) => c.id === id)?.name || categoryNamesFallback.items.find((c) => c.id === id)?.name || "";
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>Sub Category</label>
                <SearchableFilterDropdown
                  value={subCategoryFilter || null}
                  onChange={(val) => {
                    setCurrentPage(1);
                    setSubCategoryFilter(val || "");
                  }}
                  placeholder="All"
                  allLabel="All"
                  fetchOptions={async (term) => {
                    const q = term.trim().toLowerCase();
                    let list = subCategories.items;
                    if (categoryFilter) {
                      list = list.filter((sc) => sc.category_id === categoryFilter);
                    }
                    if (q) {
                      list = list.filter((sc) => sc.name.toLowerCase().includes(q) || (sc.code && sc.code.toLowerCase().includes(q)));
                    }
                    return list.map((sc) => ({ value: sc.id, label: sc.name }));
                  }}
                  fetchLabelForValue={async (id) => {
                    return subCategories.items.find((sc) => sc.id === id)?.name || subCategoryNamesFallback.items.find((sc) => sc.id === id)?.name || "";
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Main Table Card & Single-Row Toolbar */}
        <div style={{ background: "#ffffff", borderRadius: "8px", border: "1px solid #cbd5e1", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          {/* Active / Inactive Top Tabs */}
          <div style={{ display: "flex", gap: "24px", borderBottom: "1px solid #e2e8f0", padding: "0 20px", marginTop: "12px" }}>
            <button
              type="button"
              style={{
                background: "none",
                border: "none",
                borderBottom: statusTab === "active" ? "2.5px solid #0061f2" : "2.5px solid transparent",
                color: statusTab === "active" ? "#0061f2" : "#64748b",
                fontWeight: 700,
                fontSize: "14px",
                paddingBottom: "10px",
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
                fontSize: "14px",
                paddingBottom: "10px",
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

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid #e2e8f0", flexWrap: "wrap", gap: "12px" }}>
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

              {/* Freeze Columns Popover */}
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
                      minWidth: "220px",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#475569", marginBottom: "8px", borderBottom: "1px solid #f1f5f9", paddingBottom: "6px" }}>
                      Toggle Frozen Columns
                    </div>
                    <div style={{ maxHeight: "200px", overflowY: "auto", paddingRight: "4px" }}>
                      {[
                        "Checkbox",
                        "Sr. No.",
                        "Name of Company",
                        "Buyer Type",
                        "Category & Sub-Category",
                        "Country",
                        "Current Status",
                        "Potential",
                        "Client Grade",
                        "Added On / By",
                        "Action",
                      ].map((label, idx) => {
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

            {/* Right Search Input */}
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <input
                placeholder="Search company, country, contact, city, phone..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                style={{ padding: "7px 32px 7px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px", width: "240px" }}
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  style={{ position: "absolute", right: "8px", background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: "14px" }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="table-scroll" style={{ maxHeight: "calc(100vh - 220px)", overflowY: "auto", overflowX: "auto" }}>
            <table ref={tableRef} style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                  {displayOrder.map((colIdx) => {
                    const label = [
                      "Checkbox",
                      "Sr. No.",
                      "Name of Company",
                      "Buyer Type",
                      "Category & Sub-Category",
                      "Country",
                      "Current Status",
                      "Potential",
                      "Client Grade",
                      "Added On / By",
                      "Action",
                    ][colIdx];
                    const isPinned = Boolean(pinnedCols[colIdx]);
                    const isSorted = sortColIndex === colIdx;
                    const isSortable = colIdx >= 1 && colIdx <= 9;
                    return (
                      <th
                        key={colIdx}
                        style={{
                          padding: colIdx === 0 || colIdx === 1 ? "10px 8px" : "10px 14px",
                          width: colIdx === 0 ? "40px" : colIdx === 1 ? "75px" : colIdx === 2 ? "240px" : colIdx === 4 ? "240px" : undefined,
                          minWidth: colIdx === 0 ? "40px" : colIdx === 1 ? "75px" : colIdx === 2 ? "160px" : colIdx === 4 ? "220px" : undefined,
                          maxWidth: colIdx === 0 ? "45px" : colIdx === 1 ? "85px" : colIdx === 2 ? "240px" : colIdx === 4 ? "300px" : undefined,
                          textAlign: colIdx === 0 || colIdx === 1 ? "center" : colIdx === 10 ? "center" : "left",
                          fontWeight: 700,
                          color: "#475569",
                          whiteSpace: "nowrap",
                          ...getFreezeStyle(colIdx, true),
                        }}
                      >
                        {colIdx === 0 ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.length > 0 && selectedIds.length === rows.length}
                            onChange={(e) => setSelectedIds(e.target.checked ? rows.map((r) => r.id) : [])}
                            style={{ cursor: "pointer", width: "16px", height: "16px" }}
                          />
                        ) : isSortable ? (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: colIdx === 1 ? "center" : "space-between", gap: "4px" }}>
                            <div
                              onClick={() => handleHeaderSort(colIdx)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "5px",
                                cursor: "pointer",
                                userSelect: "none",
                                flex: colIdx === 1 ? undefined : 1,
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
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePin(colIdx);
                              }}
                              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "11px", opacity: isPinned ? 1 : 0.3, padding: "0 2px", flexShrink: 0 }}
                              title={isPinned ? "Unfreeze column" : "Freeze column"}
                            >
                              📌
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}>
                            <span>{label}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePin(colIdx);
                              }}
                              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "11px", opacity: isPinned ? 1 : 0.3, padding: "0 2px", flexShrink: 0 }}
                              title={isPinned ? "Unfreeze column" : "Freeze column"}
                            >
                              📌
                            </button>
                          </div>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <BuyerSkeletonRows count={8} displayOrder={displayOrder} getFreezeStyle={getFreezeStyle} />
                ) : sortedRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ textAlign: "center", padding: "30px", color: "#64748b" }}>
                      No buyer profiles found.
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((r, rowIndex) => {
                    const countryName = countries.items.find((c) => c.id === r.country_id)?.name || "—";
                    const isExisting = r.current_status === "existing";
                    const isPotentialYes = r.potential === "yes";
                    const cannotDelete = isExisting || isPotentialYes;

                    const rowCells: Record<number, React.ReactNode> = {
                      0: (
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(r.id)}
                          onChange={(e) => setSelectedIds((prev) => (e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id)))}
                        />
                      ),
                      1: (currentPage - 1) * pageSize + rowIndex + 1,
                      2: (
                        <a
                          href="#"
                          title={r.company_name}
                          onClick={(e) => {
                            e.preventDefault();
                            handleOpenDetail(r);
                          }}
                          style={{
                            color: "#2563eb",
                            fontWeight: 600,
                            textDecoration: "none",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            wordBreak: "break-word",
                            lineHeight: "1.35",
                            maxHeight: "2.7em",
                          }}
                        >
                          {r.company_name}
                        </a>
                      ),
                      3: r.buyer_type ? r.buyer_type.toUpperCase() : "—",
                      4: (
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <div>
                            {renderChips(r.category_ids, categories.items, "Product Categories", categoryNamesFallback.items, "🏷️", "175px")}
                          </div>
                          {r.sub_category_ids && r.sub_category_ids.length > 0 && (
                            <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                              <span style={{ color: "#94a3b8", fontSize: "11px", userSelect: "none", fontWeight: 700 }}>↳</span>
                              {renderChips(r.sub_category_ids, subCategories.items, "Product Sub-Categories", subCategoryNamesFallback.items, "📁", "175px")}
                            </div>
                          )}
                        </div>
                      ),
                      5: countryName,
                      6: canEditCurrentStatus ? (
                        <select
                          className="inline-select"
                          value={r.current_status || ""}
                          onChange={(e) =>
                            handleInlineUpdate(r.id, `/buyers/${r.id}/current-status`, {
                              current_status: e.target.value || null,
                            })
                          }
                          style={{
                            padding: "3px 6px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            fontWeight: 600,
                            border: "1px solid #cbd5e1",
                            background: r.current_status === "existing" ? "#dcfce7" : "#fef9c3",
                            color: r.current_status === "existing" ? "#15803d" : "#854d0e",
                            cursor: "pointer",
                          }}
                        >
                          <option value="">SELECT</option>
                          {r.current_status !== "existing" && <option value="new">NEW</option>}
                          <option value="existing">EXISTING</option>
                        </select>
                      ) : (
                        <span
                          style={{
                            padding: "3px 8px",
                            borderRadius: "12px",
                            fontSize: "11.5px",
                            fontWeight: 600,
                            background: r.current_status === "existing" ? "#dcfce7" : "#fef9c3",
                            color: r.current_status === "existing" ? "#15803d" : "#854d0e",
                          }}
                        >
                          {r.current_status ? r.current_status.toUpperCase() : "SELECT"}
                        </span>
                      ),
                      7: canEditPotential ? (
                        <select
                          className="inline-select"
                          value={r.potential || ""}
                          onChange={(e) =>
                            handleInlineUpdate(r.id, `/buyers/${r.id}/potential`, {
                              potential: e.target.value || null,
                            })
                          }
                          style={{
                            padding: "3px 6px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            fontWeight: 600,
                            border: "1px solid #cbd5e1",
                            background: r.potential === "yes" ? "#dbeafe" : r.potential === "no" ? "#fee2e2" : "#f1f5f9",
                            color: r.potential === "yes" ? "#1d4ed8" : r.potential === "no" ? "#b91c1c" : "#475569",
                            cursor: "pointer",
                          }}
                        >
                          <option value="">SELECT</option>
                          <option value="yes">YES</option>
                          <option value="no">NO</option>
                        </select>
                      ) : (
                        <span
                          style={{
                            padding: "3px 8px",
                            borderRadius: "12px",
                            fontSize: "11.5px",
                            fontWeight: 600,
                            background: r.potential === "yes" ? "#dbeafe" : r.potential === "no" ? "#fee2e2" : "#f1f5f9",
                            color: r.potential === "yes" ? "#1d4ed8" : r.potential === "no" ? "#b91c1c" : "#475569",
                          }}
                        >
                          {r.potential ? r.potential.toUpperCase() : "SELECT"}
                        </span>
                      ),
                      8: canEditClientGrade ? (
                        <select
                          className="inline-select"
                          value={r.buyer_grade || ""}
                          onChange={(e) =>
                            handleInlineUpdate(r.id, `/buyers/${r.id}/grade`, {
                              buyer_grade: e.target.value || null,
                            })
                          }
                          style={{
                            padding: "3px 6px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            border: "1px solid #cbd5e1",
                            background: "#ffffff",
                            cursor: "pointer",
                          }}
                        >
                          <option value="">Select</option>
                          <option value="A">Grade A</option>
                          <option value="B">Grade B</option>
                          <option value="C">Grade C</option>
                        </select>
                      ) : (
                        <span>{r.buyer_grade ? `Grade ${r.buyer_grade}` : "—"}</span>
                      ),
                      9: (
                        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
                          <span>{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</span>
                          <span style={{ fontSize: "11.5px", color: "#64748b" }}>by {r.created_by_name || "—"}</span>
                        </div>
                      ),
                      10: (
                        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                          {canUpdate && (
                            <button
                              type="button"
                              onClick={() => openEdit(r)}
                              title="Edit Buyer"
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
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => handleDelete(r)}
                              title={cannotDelete ? "Cannot delete buyer with Existing status or Yes potential (document rule)" : "Delete buyer"}
                              disabled={cannotDelete || isRowActionPending(`delete:${r.id}`)}
                              style={{
                                background: cannotDelete ? "#cbd5e1" : "#ef4444",
                                color: "#ffffff",
                                padding: "6px 9px",
                                borderRadius: "4px",
                                border: "none",
                                cursor: cannotDelete ? "not-allowed" : "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                opacity: cannotDelete ? 0.6 : 1,
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                <line x1="10" y1="11" x2="10" y2="17" />
                                <line x1="14" y1="11" x2="14" y2="17" />
                              </svg>
                            </button>
                          )}
                        </div>
                      ),
                    };

                    return (
                      <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        {displayOrder.map((colIdx) => (
                          <td
                            key={colIdx}
                            style={{
                              padding: colIdx === 0 || colIdx === 1 ? "10px 8px" : "10px 14px",
                              width: colIdx === 0 ? "40px" : colIdx === 1 ? "65px" : colIdx === 2 ? "240px" : colIdx === 4 ? "240px" : undefined,
                              minWidth: colIdx === 0 ? "40px" : colIdx === 1 ? "65px" : colIdx === 2 ? "160px" : colIdx === 4 ? "220px" : undefined,
                              maxWidth: colIdx === 0 ? "45px" : colIdx === 1 ? "75px" : colIdx === 2 ? "240px" : colIdx === 4 ? "300px" : undefined,
                              textAlign: colIdx === 0 || colIdx === 1 ? "center" : colIdx === 10 ? "center" : "left",
                              whiteSpace: colIdx === 2 || colIdx === 4 ? "normal" : "nowrap",
                              height: colIdx === 2 || colIdx === 4 ? "auto" : undefined,
                              verticalAlign: "middle",
                              ...getFreezeStyle(colIdx, false),
                            }}
                          >
                            {rowCells[colIdx]}
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ padding: "12px 20px", borderTop: "1px solid #e2e8f0" }}>
            <Pagination
              pagination={{
                current_page: currentPage,
                total_pages: Math.ceil(totalRecords / pageSize) || 1,
                total_records: totalRecords,
                page_size: pageSize,
              }}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
            />
          </div>
        </div>

        {/* View Details Drawer (720px 2-Column Executive Layout) */}
        {detailBuyer && (
          <SideDrawer
            open={Boolean(detailBuyer)}
            title={`Buyer Detail #${detailBuyer.company_name}`}
            subtitle={
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "3px" }}>
                <span>Buyer Type: {detailBuyer.buyer_type ? detailBuyer.buyer_type.toUpperCase() : "—"}</span>
                <span>•</span>
                <span>Status: {detailBuyer.is_active ? "Active" : "Inactive"}</span>
                {detailLoading && (
                  <span style={{ fontSize: "11.5px", color: "#0284c7", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span>⏳</span> Loading full details...
                  </span>
                )}
              </div>
            }
            onClose={handleCloseDetailBuyer}
            onEdit={
              canUpdate
                ? () => {
                  const b = detailBuyer;
                  handleCloseDetailBuyer();
                  openEdit(b);
                }
                : undefined
            }
            editLabel="✏️ Edit Buyer"
            cardStyle={{ maxWidth: "860px", width: "100%" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "18px", paddingBottom: "24px" }}>
              {/* CARD 1: Company Profile & Classification */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <h4 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 12px 0", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                  🏢 Company Profile &amp; Classification
                </h4>
                <DetailFieldGrid
                  fields={[
                    { label: "Company Name", value: detailBuyer.company_name, fullWidth: true },
                    { label: "Buyer Type", value: detailBuyer.buyer_type ? detailBuyer.buyer_type.toUpperCase() : "—" },
                    { label: "Tax ID (TIN / GST)", value: detailBuyer.tax_id_number || "—" },
                    { label: "Country", value: countries.items.find((c) => c.id === detailBuyer.country_id)?.name || "—" },
                    { label: "State / Province", value: states.items.find((s) => s.id === detailBuyer.state_id)?.name || "—" },
                    { label: "City", value: detailBuyer.city || "—", fullWidth: true },
                    {
                      label: "Product Categories",
                      value: renderChips(detailBuyer.category_ids, categories.items, "Product Categories", categoryNamesFallback.items, "🏷️", "240px"),
                    },
                    {
                      label: "Product Sub-Categories",
                      value: renderChips(detailBuyer.sub_category_ids, subCategories.items, "Product Sub-Categories", subCategoryNamesFallback.items, "📂", "240px"),
                    },
                    { label: "Currently Buying From", value: detailBuyer.currently_buying_from || "—", fullWidth: true },
                    { label: "Product Range (Manufactured / Supplied)", value: detailBuyer.product_range || "—", fullWidth: true },
                    { label: "Overall Observations / Remarks", value: detailBuyer.overall_remarks || "—", fullWidth: true },
                  ]}
                />
              </div>

              {/* CARD 2: Primary Contact Information */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <h4 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 12px 0", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                  👤 Primary Contact Information
                </h4>
                <DetailFieldGrid
                  fields={[
                    {
                      label: "Contact Person",
                      value: `${detailBuyer.contact_salutation || ""} ${detailBuyer.contact_full_name || ""}`.trim() || "—",
                    },
                    { label: "Designation", value: detailBuyer.contact_designation || "—" },
                    {
                      label: "Calling Number",
                      value: detailBuyer.contact_calling_number ? (
                        <a href={`tel:${detailBuyer.contact_calling_number}`} style={{ color: "#0061f2", textDecoration: "none", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          📞 {detailBuyer.contact_calling_number}
                        </a>
                      ) : (
                        "—"
                      ),
                    },
                    {
                      label: "WhatsApp Number",
                      value: detailBuyer.contact_whatsapp_number ? (
                        <a
                          href={`https://wa.me/${detailBuyer.contact_whatsapp_number.replace(/[^0-9]/g, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "#16a34a", textDecoration: "none", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: "6px" }}
                        >
                          <WhatsAppIcon size={16} /> {detailBuyer.contact_whatsapp_number} ↗
                        </a>
                      ) : (
                        "—"
                      ),
                    },
                    {
                      label: "Email Addresses",
                      value:
                        detailBuyer.emails && detailBuyer.emails.length ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {detailBuyer.emails.map((em) => (
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
                        ) : (
                          "—"
                        ),
                      fullWidth: true,
                    },
                    {
                      label: "Websites",
                      value: detailBuyer.website ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {detailBuyer.website.split(",").map((rawUrl, idx) => {
                            const clean = rawUrl.trim();
                            if (!clean) return null;
                            const href = clean.startsWith("http") ? clean : `https://${clean}`;
                            return (
                              <a
                                key={idx}
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  color: "#0369a1",
                                  background: "#e0f2fe",
                                  border: "1px solid #bae6fd",
                                  borderRadius: "4px",
                                  padding: "2px 8px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  textDecoration: "none",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                🌐 {clean.replace(/^https?:\/\/(www\.)?/, "")} ↗
                              </a>
                            );
                          })}
                        </div>
                      ) : (
                        "—"
                      ),
                      fullWidth: true,
                    },
                  ]}
                />
              </div>

              {/* CARD 3: Location Details & Postal Address */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <h4 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 12px 0", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                  📍 Location &amp; Postal Delivery Address
                </h4>
                <DetailFieldGrid
                  columns={3}
                  fields={[
                    { label: "Country", value: countries.items.find((c) => c.id === detailBuyer.country_id)?.name || "—" },
                    { label: "State / Province", value: states.items.find((s) => s.id === detailBuyer.state_id)?.name || "—" },
                    { label: "City", value: detailBuyer.city || "—" },
                    { label: "Full Postal Address", value: detailBuyer.address || "—", fullWidth: true },
                  ]}
                />
              </div>

              {/* CARD 4: Pipeline Status & Commercial Evaluation */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <h4 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 12px 0", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                  📊 Pipeline Status &amp; Commercial Evaluation
                </h4>
                <DetailFieldGrid
                  fields={[
                    {
                      label: "Client Grade",
                      value: detailBuyer.buyer_grade ? (
                        <span style={{ background: "#f1f5f9", color: "#1e293b", padding: "2px 8px", borderRadius: "4px", fontWeight: 700, fontSize: "12px", border: "1px solid #cbd5e1" }}>
                          GRADE {detailBuyer.buyer_grade.toUpperCase()}
                        </span>
                      ) : (
                        "—"
                      ),
                    },
                    {
                      label: "Current Status",
                      value: detailBuyer.current_status ? (
                        <span
                          style={{
                            background: detailBuyer.current_status.toLowerCase() === "existing" ? "#dcfce7" : "#fef3c7",
                            color: detailBuyer.current_status.toLowerCase() === "existing" ? "#166534" : "#92400e",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontWeight: 700,
                            fontSize: "12px",
                          }}
                        >
                          {detailBuyer.current_status.toUpperCase()}
                        </span>
                      ) : (
                        "—"
                      ),
                    },
                    {
                      label: "Potential (Yes / No)",
                      value: detailBuyer.potential ? (
                        <span
                          style={{
                            background: detailBuyer.potential.toLowerCase() === "yes" ? "#dcfce7" : "#fee2e2",
                            color: detailBuyer.potential.toLowerCase() === "yes" ? "#166534" : "#991b1b",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            fontWeight: 700,
                          }}
                        >
                          {detailBuyer.potential.toUpperCase()}
                        </span>
                      ) : (
                        "—"
                      ),
                    },
                    { label: "Reason for Potential Status", value: detailBuyer.potential_reason || "—", fullWidth: true },
                  ]}
                />
              </div>

              {/* CARD 5: Additional Contacts Roster */}
              {detailBuyer.contacts && detailBuyer.contacts.length > 0 && (
                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                  <h4 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 12px 0", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                    👥 Additional Contacts ({detailBuyer.contacts.length})
                  </h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {detailBuyer.contacts.map((c, i) => (
                      <div key={c.id || i} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 16px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                          <div>
                            <span style={{ fontWeight: 700, color: "#0f172a", fontSize: "13.5px" }}>
                              {c.salutation ? `${c.salutation} ` : ""}{c.person_name}
                            </span>
                            {c.designation && <span style={{ color: "#64748b", fontSize: "12.5px", marginLeft: "6px" }}>• {c.designation}</span>}
                          </div>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", fontSize: "12.5px", color: "#334155" }}>
                          {c.calling_number && (
                            <a href={`tel:${c.calling_number}`} style={{ color: "#0061f2", textDecoration: "none", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: "4px" }}>
                              📞 {c.calling_number}
                            </a>
                          )}
                          {c.whatsapp_number && (
                            <a href={`https://wa.me/${c.whatsapp_number.replace(/[^0-9]/g, "")}`} target="_blank" rel="noopener noreferrer" style={{ color: "#16a34a", textDecoration: "none", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: "5px" }}>
                              <WhatsAppIcon size={14} /> {c.whatsapp_number} ↗
                            </a>
                          )}
                          {c.email && (
                            <a href={`mailto:${c.email}`} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: "4px" }}>
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
        )}

        {chipModalData && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 23, 42, 0.5)",
              backdropFilter: "blur(2px)",
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "20px",
            }}
            onClick={() => setChipModalData(null)}
          >
            <div
              style={{
                background: "#ffffff",
                borderRadius: "12px",
                padding: "20px 24px",
                maxWidth: "420px",
                width: "100%",
                boxShadow: "0 20px 25px -5px rgba(0,0,0,0.2), 0 10px 10px -5px rgba(0,0,0,0.04)",
                border: "1px solid #e2e8f0",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", borderBottom: "1px solid #f1f5f9", paddingBottom: "10px" }}>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>👁️</span> {chipModalData.title} ({chipModalData.items.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setChipModalData(null)}
                  style={{ background: "#f1f5f9", border: "none", borderRadius: "50%", width: "28px", height: "28px", fontSize: "14px", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  ✕
                </button>
              </div>
              <div style={{ maxHeight: "280px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px", paddingRight: "4px" }}>
                {chipModalData.items.map((item, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "6px",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "#1e293b",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <span style={{ color: "#2563eb", fontWeight: 700 }}>•</span> {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <TrashConflictModal
          isOpen={Boolean(trashConflict)}
          conflictInfo={trashConflict}
          onClose={() => setTrashConflict(null)}
          onRestored={async () => {
            setTrashConflict(null);
            setModalMode(null);
            reload();
          }}
        />
      </main>
    </AppShell>
  );
}