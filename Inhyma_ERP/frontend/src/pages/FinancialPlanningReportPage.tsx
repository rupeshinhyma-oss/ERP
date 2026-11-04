/**
 * Financial Planning Report Page.
 *
 * Route: /reports/financial-planning (aliases: /financial-planning-report, /financial-planning-report/list, /finance-planning-report/list)
 * Sidebar Section: REPORTS (permission: report.view)
 *
 * Live 3-Module Stage Wiring (GET /api/v1/financial-planning):
 * 1. Import Purchase (`import_purchases`):
 *    - Reflects automatically whenever `status` reaches confirmed stage (`confirmed`, `received`, `closed`).
 *    - Emits Overseas `Supplier` row (`USD` $ or `INR` ₹) + paired `Total Taxes (INR)` row (`INR` ₹) when duty/tax > 0.
 * 2. Local Purchase (`local_purchases`):
 *    - Reflects automatically whenever `status` reaches `confirmed`.
 *    - Emits Local `Supplier` row (`INR` ₹).
 * 3. Sales Process (`sales_orders`):
 *    - Reflects automatically whenever `status` reaches `Acc. Confirmed` (`acc_confirmed` and downstream active stages).
 *    - Emits `Customer` row (`INR` ₹ default, or `USD` $ if exported in USD).
 *
 * Default currency is strictly Indian Rupees (₹ / INR) — never UGX — alongside USD ($) for overseas supplier invoices.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { DatePicker } from "@/components/DatePicker";
import { DateRangePicker } from "@/components/DateRangePicker";
import { Pagination } from "@/components/Pagination";
import { SortHeader } from "@/components/SortHeader";
import { Modal } from "@/components/ui";
import { apiGet, apiPatch, apiPost, apiPostMultipart, errorMessage, isAbortError } from "@/lib/api";
import { Auth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import type { PaginationMeta } from "@/types";

export type FinancialPlanningCurrency = "INR" | "USD";
export type FinancialPlanningPartyType = "Supplier" | "Taxes" | "Customer";
export type FinancialPlanningStatus = "Pending" | "Cleared";
export type FinancialPlanningSourceModule = "import_purchase" | "local_purchase" | "sales_process";

export interface FinancialPlanningPaymentHistoryItem {
  id?: string;
  amount: number;
  payment_mode?: string | null;
  payment_date?: string | null;
  reference_no?: string | null;
  remarks?: string | null;
  recorded_by?: string | null;
  recorded_at?: string | null;
}

export interface FinancialPlanningRecord {
  id: string;
  entry_key?: string;
  party_name: string;
  party_type: FinancialPlanningPartyType;
  invoice_no: string;
  invoice_attachment_url?: string | null;
  invoice_attachment_name?: string | null;
  allow_invoice_upload?: boolean;
  payment_terms?: string | null;
  payment_attachment_url?: string | null;
  payment_attachment_name?: string | null;
  /** Defaults to "INR" (Rupees ₹) whenever omitted. */
  currency?: FinancialPlanningCurrency;
  total_amount: number;
  paid_amount: number;
  balance_amount?: number;
  /** Display date in DD-MM-YYYY or ISO YYYY-MM-DD */
  due_date?: string | null;
  status: FinancialPlanningStatus;
  remarks?: string | null;
  source_module?: FinancialPlanningSourceModule | string | null;
  source_label?: string | null;
  source_stage?: string | null;
  source_record_id?: string | null;
  payments_history?: FinancialPlanningPaymentHistoryItem[];
}

interface FinancialPlanningListResponse {
  items: FinancialPlanningRecord[];
  payment_terms_options?: string[];
}

export interface FinancialPlanningReportPageProps {
  initialRecords?: FinancialPlanningRecord[];
}

const DEFAULT_PAYMENT_TERMS_OPTIONS = [
  "100% Advance",
  "CAD",
  "30 Days Credit",
  "45 Days Credit",
  "60 Days Credit",
  "90 Days Credit",
  "LC",
];

const PAYMENT_MODES = [
  "Bank Transfer / NEFT / RTGS",
  "Wire Transfer / SWIFT",
  "UPI",
  "Cheque / DD",
  "Letter of Credit (LC)",
  "Cash",
];

export function normalizeCurrency(currency?: string | null): FinancialPlanningCurrency {
  const upper = (currency || "INR").trim().toUpperCase();
  if (upper === "USD" || upper === "$") return "USD";
  return "INR";
}

export function formatPlanningAmount(
  amount: number | null | undefined,
  currency: FinancialPlanningCurrency = "INR",
): string {
  const safe = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  if (currency === "USD") {
    return `$ ${safe.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `₹ ${safe.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizePartyDisplayName(record: FinancialPlanningRecord): string {
  const raw = (record.party_name || "").trim();
  if (!raw) {
    return record.party_type === "Taxes" ? "Total Taxes (INR)" : "—";
  }
  // Ensure any legacy UGX tax label normalizes cleanly to INR (Rupees default)
  return raw.replace(/\(UGX\)/gi, "(INR)");
}

function parseDisplayOrIsoDate(value?: string | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // DD-MM-YYYY
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = Number(dmy[2]) - 1;
    const yyyy = Number(dmy[3]);
    const dt = new Date(yyyy, mm, dd);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  // MM/DD/YYYY (from DateRangePicker)
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (mdy) {
    const mm = Number(mdy[1]) - 1;
    const dd = Number(mdy[2]);
    const yyyy = Number(mdy[3]);
    const dt = new Date(yyyy, mm, dd);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  // YYYY-MM-DD
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) {
    const dt = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  return null;
}

function formatDueDate(value?: string | null): string {
  if (!value) return "—";
  const trimmed = value.trim();
  if (!trimmed) return "—";
  if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) return trimmed;
  const dt = parseDisplayOrIsoDate(trimmed);
  if (!dt) return trimmed;
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function computeBalance(record: FinancialPlanningRecord): number {
  if (typeof record.balance_amount === "number" && Number.isFinite(record.balance_amount)) {
    return Math.max(0, record.balance_amount);
  }
  const total = Number(record.total_amount || 0);
  const paid = Number(record.paid_amount || 0);
  return Math.max(0, Number((total - paid).toFixed(2)));
}

function resolveAttachmentHref(url?: string | null): string {
  if (!url) return "#";
  if (url.startsWith("/uploads/private/") || url.startsWith("/api/v1/")) {
    const token =
      Auth.getAccessToken() ||
      (typeof localStorage !== "undefined" ? localStorage.getItem("erp_access_token") : null);
    return token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url;
  }
  return url;
}

function getEntryKey(rec: FinancialPlanningRecord): string | null {
  if (rec.entry_key && rec.entry_key.includes(":")) return rec.entry_key;
  if (rec.id && rec.id.includes(":")) return rec.id;
  return null;
}

function resolvePartyBadgeColors(partyType: FinancialPlanningPartyType): {
  bg: string;
  fg: string;
  border: string;
} {
  if (partyType === "Taxes") {
    return { bg: "#fee2e2", fg: "#dc2626", border: "1px solid #fecaca" };
  }
  if (partyType === "Customer") {
    return { bg: "#e0f2fe", fg: "#0369a1", border: "1px solid #bae6fd" };
  }
  return { bg: "#fef3c7", fg: "#b45309", border: "1px solid #fde68a" };
}

function resolveSourceDisplay(rec: FinancialPlanningRecord): string | null {
  if (rec.source_label) {
    if (rec.source_module === "sales_process" && rec.source_stage) {
      return `${rec.source_label} • ${rec.source_stage}`;
    }
    return rec.source_label;
  }
  if (rec.source_module === "import_purchase") return "Import Purchase";
  if (rec.source_module === "local_purchase") return "Local Purchase";
  if (rec.source_module === "sales_process") {
    return rec.source_stage ? `Sales Process • ${rec.source_stage}` : "Sales Process";
  }
  return null;
}

type SortKey =
  | "party_name"
  | "invoice_no"
  | "payment_terms"
  | "total_amount"
  | "paid_amount"
  | "balance_amount"
  | "due_date";

export function FinancialPlanningReportPage({
  initialRecords,
}: FinancialPlanningReportPageProps = {}) {
  const showToast = useToast();
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const isPropControlled = initialRecords !== undefined;

  const [records, setRecords] = useState<FinancialPlanningRecord[]>(() => initialRecords ?? []);
  const [serverPaymentTerms, setServerPaymentTerms] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (initialRecords !== undefined) {
      setRecords(initialRecords);
    }
  }, [initialRecords]);

  const fetchReport = useCallback(
    async (signal?: AbortSignal) => {
      if (isPropControlled) return;
      setLoading(true);
      try {
        const res = await apiGet<FinancialPlanningListResponse>("/financial-planning", { signal });
        if (signal?.aborted) return;
        if (res?.data) {
          setRecords(Array.isArray(res.data.items) ? res.data.items : []);
          if (Array.isArray(res.data.payment_terms_options)) {
            setServerPaymentTerms(res.data.payment_terms_options);
          }
        }
      } catch (err) {
        if (isAbortError(err) || signal?.aborted) return;
        // Only surface toast when an authenticated session encountered a genuine server error
        if (Auth.getAccessToken()) {
          showToastRef.current(errorMessage(err), "error");
        }
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [isPropControlled],
  );

  useEffect(() => {
    if (isPropControlled) return;
    const controller = new AbortController();
    void fetchReport(controller.signal);
    return () => controller.abort();
  }, [isPropControlled, fetchReport]);

  // Stage Tabs: Pending | Cleared
  const [activeTab, setActiveTab] = useState<"pending" | "cleared">("pending");

  // Collapsible Filter Panel (collapsed by default)
  const [filterOpen, setFilterOpen] = useState(false);
  const [dueDateRange, setDueDateRange] = useState("");
  const [sourceModuleFilter, setSourceModuleFilter] = useState("");
  const [partyTypeFilter, setPartyTypeFilter] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [paymentTermsFilter, setPaymentTermsFilter] = useState("");

  const [appliedFilters, setAppliedFilters] = useState({
    dueDateRange: "",
    sourceModule: "",
    partyType: "",
    currency: "",
    paymentTerms: "",
  });

  // Table Toolbar & Pagination (50 items/page default matching reference screenshot)
  const [perPage, setPerPage] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Column Sorting
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Row Action Menu (rendered via portal with position: fixed to escape table overflowX clipping & td nowrap)
  const [openActionRowId, setOpenActionRowId] = useState<string | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState<{
    top?: number;
    bottom?: number;
    left: number;
  } | null>(null);
  const actionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const actionMenuPortalRef = useRef<HTMLDivElement | null>(null);

  const closeActionMenu = useCallback(() => {
    setOpenActionRowId(null);
    setActionMenuPosition(null);
  }, []);

  const toggleActionMenu = useCallback(
    (recId: string, btnEl: HTMLButtonElement) => {
      if (openActionRowId === recId) {
        closeActionMenu();
        return;
      }
      actionTriggerRef.current = btnEl;
      const rect = btnEl.getBoundingClientRect();
      const MENU_WIDTH = 210;
      const MENU_EST_HEIGHT = 185;
      const VIEWPORT_PAD = 10;

      if (rect.width === 0 && rect.height === 0) {
        setActionMenuPosition({ top: 100, left: 100 });
      } else {
        const vw = window.innerWidth || 1280;
        const vh = window.innerHeight || 800;
        let left = rect.right - MENU_WIDTH;
        left = Math.max(VIEWPORT_PAD, Math.min(left, vw - MENU_WIDTH - VIEWPORT_PAD));

        const spaceBelow = vh - rect.bottom;
        if (spaceBelow < MENU_EST_HEIGHT && rect.top > MENU_EST_HEIGHT) {
          setActionMenuPosition({
            bottom: vh - rect.top + 4,
            left,
          });
        } else {
          setActionMenuPosition({
            top: rect.bottom + 4,
            left,
          });
        }
      }
      setOpenActionRowId(recId);
    },
    [openActionRowId, closeActionMenu],
  );

  const [detailRecord, setDetailRecord] = useState<FinancialPlanningRecord | null>(null);
  const [editTermsRecord, setEditTermsRecord] = useState<FinancialPlanningRecord | null>(null);
  const [editTermsValue, setEditTermsValue] = useState("");
  const [editDueDateValue, setEditDueDateValue] = useState("");
  const [editRemarksValue, setEditRemarksValue] = useState("");
  const [editTermsAttachmentFile, setEditTermsAttachmentFile] = useState<File | null>(null);

  const [recordPaymentTarget, setRecordPaymentTarget] = useState<FinancialPlanningRecord | null>(null);
  const [paymentInputAmount, setPaymentInputAmount] = useState("");
  const [paymentModeInput, setPaymentModeInput] = useState(PAYMENT_MODES[0]);
  const [paymentRefInput, setPaymentRefInput] = useState("");
  const [paymentDateInput, setPaymentDateInput] = useState("");
  const [paymentRemarksInput, setPaymentRemarksInput] = useState("");
  const [paymentReceiptFile, setPaymentReceiptFile] = useState<File | null>(null);

  const [uploadInvoiceTarget, setUploadInvoiceTarget] = useState<FinancialPlanningRecord | null>(null);
  const [selectedInvoiceFile, setSelectedInvoiceFile] = useState<File | null>(null);
  const [selectedInvoiceFileName, setSelectedInvoiceFileName] = useState("");
  const [selectedInvoiceObjectUrl, setSelectedInvoiceObjectUrl] = useState("");

  // Close row action menu on outside click, Escape, scroll, or window resize
  useEffect(() => {
    if (!openActionRowId) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (actionTriggerRef.current?.contains(target)) return;
      if (actionMenuPortalRef.current?.contains(target)) return;
      closeActionMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeActionMenu();
    };
    const onScroll = (e: Event) => {
      if (e.target && actionMenuPortalRef.current?.contains(e.target as Node)) return;
      closeActionMenu();
    };
    const onResize = () => closeActionMenu();

    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [openActionRowId, closeActionMenu]);

  const paymentTermsOptions = useMemo(() => {
    const set = new Set<string>(DEFAULT_PAYMENT_TERMS_OPTIONS);
    for (const term of serverPaymentTerms) {
      const clean = (term || "").trim();
      if (clean) set.add(clean);
    }
    for (const r of records) {
      const term = (r.payment_terms || "").trim();
      if (term) set.add(term);
    }
    return Array.from(set);
  }, [records, serverPaymentTerms]);

  const handleApplyFilters = () => {
    setAppliedFilters({
      dueDateRange,
      sourceModule: sourceModuleFilter,
      partyType: partyTypeFilter,
      currency: currencyFilter,
      paymentTerms: paymentTermsFilter,
    });
    setCurrentPage(1);
  };

  const handleResetFilters = () => {
    setDueDateRange("");
    setSourceModuleFilter("");
    setPartyTypeFilter("");
    setCurrencyFilter("");
    setPaymentTermsFilter("");
    setAppliedFilters({
      dueDateRange: "",
      sourceModule: "",
      partyType: "",
      currency: "",
      paymentTerms: "",
    });
    setCurrentPage(1);
  };

  // Filtered records (before Pending/Cleared tab split so KPIs & tab counts reflect active filters/search)
  const baseFilteredRecords = useMemo(() => {
    let rangeStart: Date | null = null;
    let rangeEnd: Date | null = null;
    if (appliedFilters.dueDateRange.includes("-")) {
      const [rawStart, rawEnd] = appliedFilters.dueDateRange.split("-").map((p) => p.trim());
      rangeStart = parseDisplayOrIsoDate(rawStart);
      rangeEnd = parseDisplayOrIsoDate(rawEnd);
      if (rangeEnd) {
        rangeEnd = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate(), 23, 59, 59, 999);
      }
    }

    const q = searchQuery.trim().toLowerCase();

    return records.filter((rec) => {
      const rowCurrency = normalizeCurrency(rec.currency);
      const displayParty = normalizePartyDisplayName(rec);
      const sourceText = resolveSourceDisplay(rec) || "";

      if (appliedFilters.sourceModule && rec.source_module !== appliedFilters.sourceModule) {
        return false;
      }
      if (appliedFilters.partyType && rec.party_type !== appliedFilters.partyType) {
        return false;
      }
      if (appliedFilters.currency && rowCurrency !== appliedFilters.currency) {
        return false;
      }
      if (
        appliedFilters.paymentTerms &&
        (rec.payment_terms || "").trim().toLowerCase() !== appliedFilters.paymentTerms.trim().toLowerCase()
      ) {
        return false;
      }
      if (rangeStart && rangeEnd) {
        const dueDt = parseDisplayOrIsoDate(rec.due_date);
        if (!dueDt || dueDt < rangeStart || dueDt > rangeEnd) {
          return false;
        }
      }

      if (q) {
        const haystack = [
          displayParty,
          rec.party_type,
          sourceText,
          rec.invoice_no || "",
          rec.payment_terms || "",
          formatDueDate(rec.due_date),
          rec.status,
          rowCurrency,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [records, appliedFilters, searchQuery]);

  // Dual-Currency KPI Aggregations: Rupees (INR default) + USD ($)
  const kpis = useMemo(() => {
    let inrAll = 0;
    let inrPaid = 0;
    let inrBalance = 0;
    let inrCount = 0;

    let usdAll = 0;
    let usdPaid = 0;
    let usdBalance = 0;
    let usdCount = 0;

    for (const rec of baseFilteredRecords) {
      const curr = normalizeCurrency(rec.currency);
      const total = Number(rec.total_amount || 0);
      const paid = Number(rec.paid_amount || 0);
      const balance = computeBalance(rec);

      if (curr === "USD") {
        usdAll += total;
        usdPaid += paid;
        usdBalance += balance;
        usdCount += 1;
      } else {
        inrAll += total;
        inrPaid += paid;
        inrBalance += balance;
        inrCount += 1;
      }
    }

    return {
      inrAll,
      inrPaid,
      inrBalance,
      inrCount,
      usdAll,
      usdPaid,
      usdBalance,
      usdCount,
    };
  }, [baseFilteredRecords]);

  // Tab Counts
  const { pendingCount, clearedCount } = useMemo(() => {
    let pending = 0;
    let cleared = 0;
    for (const rec of baseFilteredRecords) {
      if (rec.status === "Cleared") cleared += 1;
      else pending += 1;
    }
    return { pendingCount: pending, clearedCount: cleared };
  }, [baseFilteredRecords]);

  // Active Tab Slicing
  const tabRecords = useMemo(() => {
    return baseFilteredRecords.filter((rec) =>
      activeTab === "cleared" ? rec.status === "Cleared" : rec.status !== "Cleared",
    );
  }, [baseFilteredRecords, activeTab]);

  // Sorting
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else {
        setSortKey(null);
        setSortDirection("asc");
      }
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  const sortedRecords = useMemo(() => {
    if (!sortKey) return tabRecords;
    const copy = [...tabRecords];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "party_name":
          cmp = normalizePartyDisplayName(a).localeCompare(normalizePartyDisplayName(b));
          break;
        case "invoice_no":
          cmp = (a.invoice_no || "").localeCompare(b.invoice_no || "");
          break;
        case "payment_terms":
          cmp = (a.payment_terms || "").localeCompare(b.payment_terms || "");
          break;
        case "total_amount":
          cmp = Number(a.total_amount || 0) - Number(b.total_amount || 0);
          break;
        case "paid_amount":
          cmp = Number(a.paid_amount || 0) - Number(b.paid_amount || 0);
          break;
        case "balance_amount":
          cmp = computeBalance(a) - computeBalance(b);
          break;
        case "due_date": {
          const dA = parseDisplayOrIsoDate(a.due_date)?.getTime() ?? 0;
          const dB = parseDisplayOrIsoDate(b.due_date)?.getTime() ?? 0;
          cmp = dA - dB;
          break;
        }
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [tabRecords, sortKey, sortDirection]);

  // Pagination
  const totalRecords = sortedRecords.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / perPage));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedRecords = useMemo(() => {
    const start = (safePage - 1) * perPage;
    return sortedRecords.slice(start, start + perPage);
  }, [sortedRecords, safePage, perPage]);

  const paginationMeta: PaginationMeta = useMemo(
    () => ({
      current_page: safePage,
      page_size: perPage,
      total_records: totalRecords,
      total_items: totalRecords,
      total_pages: totalPages,
      has_previous: safePage > 1,
      has_next: safePage < totalPages,
    }),
    [safePage, perPage, totalRecords, totalPages],
  );

  const activeActionRecord = useMemo(
    () =>
      openActionRowId
        ? paginatedRecords.find((r) => r.id === openActionRowId) ??
          records.find((r) => r.id === openActionRowId) ??
          null
        : null,
    [openActionRowId, paginatedRecords, records],
  );

  // CSV Export (UTF-8 BOM)
  const handleExportCsv = useCallback(() => {
    const headers = [
      "Party Name",
      "Party Type",
      "Source Module",
      "Source Stage",
      "Invoice / Cons. No.",
      "Payment Terms",
      "Currency",
      "Total Amount",
      "Paid Amount",
      "Balance Amount",
      "Due Date",
      "Status",
    ];

    const escapeCsv = (val: string | number) => {
      const str = String(val ?? "");
      return `"${str.replace(/"/g, '""')}"`;
    };

    const rows = sortedRecords.map((rec) => {
      const curr = normalizeCurrency(rec.currency);
      return [
        escapeCsv(normalizePartyDisplayName(rec)),
        escapeCsv(rec.party_type),
        escapeCsv(rec.source_label || rec.source_module || "-"),
        escapeCsv(rec.source_stage || "-"),
        escapeCsv(rec.invoice_no || "-"),
        escapeCsv(rec.payment_terms || "-"),
        escapeCsv(curr === "INR" ? "INR (₹)" : "USD ($)"),
        Number(rec.total_amount || 0).toFixed(2),
        Number(rec.paid_amount || 0).toFixed(2),
        computeBalance(rec).toFixed(2),
        escapeCsv(formatDueDate(rec.due_date)),
        escapeCsv(rec.status),
      ].join(",");
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Financial_Planning_Report_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [sortedRecords]);

  // Helper to upload a file to /api/v1/financial-planning/upload
  const uploadPlanningFile = async (file: File): Promise<{ file_url: string; file_name: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await apiPostMultipart<{ file_url: string; file_name: string }>(
      "/financial-planning/upload",
      fd,
    );
    return res.data;
  };

  // Modal Handlers (persisted to PostgreSQL via /api/v1/financial-planning/entries/* when live)
  const openEditTermsModal = (rec: FinancialPlanningRecord) => {
    setEditTermsRecord(rec);
    setEditTermsValue(rec.payment_terms || "");
    setEditDueDateValue(formatDueDate(rec.due_date) === "—" ? "" : formatDueDate(rec.due_date));
    setEditRemarksValue(rec.remarks || "");
    setEditTermsAttachmentFile(null);
    closeActionMenu();
  };

  const handleSaveTerms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTermsRecord) return;
    const entryKey = getEntryKey(editTermsRecord);

    if (!isPropControlled && entryKey) {
      setSubmitting(true);
      try {
        let uploadedUrl: string | undefined;
        let uploadedName: string | undefined;
        if (editTermsAttachmentFile) {
          const uploaded = await uploadPlanningFile(editTermsAttachmentFile);
          uploadedUrl = uploaded.file_url;
          uploadedName = uploaded.file_name;
        }
        const res = await apiPatch<FinancialPlanningRecord>(
          `/financial-planning/entries/${encodeURIComponent(entryKey)}/terms`,
          {
            payment_terms: editTermsValue.trim() || null,
            due_date: editDueDateValue.trim() || null,
            remarks: editRemarksValue.trim() || null,
            ...(uploadedUrl !== undefined
              ? {
                  payment_attachment_url: uploadedUrl,
                  payment_attachment_name: uploadedName,
                }
              : {}),
          },
        );
        if (res?.data) {
          setRecords((prev) =>
            prev.map((item) => (item.id === editTermsRecord.id ? res.data : item)),
          );
        }
        showToast("Payment terms updated.", "success");
        setEditTermsRecord(null);
      } catch (err) {
        showToast(errorMessage(err), "error");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setRecords((prev) =>
      prev.map((item) =>
        item.id === editTermsRecord.id
          ? {
              ...item,
              payment_terms: editTermsValue.trim() || null,
              due_date: editDueDateValue.trim() || null,
              remarks: editRemarksValue.trim() || null,
            }
          : item,
      ),
    );
    showToast("Payment terms updated.", "success");
    setEditTermsRecord(null);
  };

  const openRecordPaymentModal = (rec: FinancialPlanningRecord) => {
    setRecordPaymentTarget(rec);
    setPaymentInputAmount(String(computeBalance(rec) || ""));
    setPaymentModeInput(PAYMENT_MODES[0]);
    setPaymentRefInput("");
    setPaymentDateInput("");
    setPaymentRemarksInput("");
    setPaymentReceiptFile(null);
    closeActionMenu();
  };

  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recordPaymentTarget) return;
    const addAmt = Number(paymentInputAmount);
    if (!Number.isFinite(addAmt) || addAmt <= 0) {
      showToast("Please enter a valid payment amount greater than 0.", "error");
      return;
    }

    const entryKey = getEntryKey(recordPaymentTarget);
    if (!isPropControlled && entryKey) {
      setSubmitting(true);
      try {
        let uploadedUrl: string | undefined;
        let uploadedName: string | undefined;
        if (paymentReceiptFile) {
          const uploaded = await uploadPlanningFile(paymentReceiptFile);
          uploadedUrl = uploaded.file_url;
          uploadedName = uploaded.file_name;
        }
        const res = await apiPost<FinancialPlanningRecord>(
          `/financial-planning/entries/${encodeURIComponent(entryKey)}/record-payment`,
          {
            amount: addAmt,
            payment_mode: paymentModeInput || null,
            payment_date: paymentDateInput.trim() || null,
            reference_no: paymentRefInput.trim() || null,
            remarks: paymentRemarksInput.trim() || null,
            payment_attachment_url: uploadedUrl || null,
            payment_attachment_name: uploadedName || null,
          },
        );
        if (res?.data) {
          setRecords((prev) =>
            prev.map((item) => (item.id === recordPaymentTarget.id ? res.data : item)),
          );
        }
        showToast("Payment recorded.", "success");
        setRecordPaymentTarget(null);
      } catch (err) {
        showToast(errorMessage(err), "error");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setRecords((prev) =>
      prev.map((item) => {
        if (item.id !== recordPaymentTarget.id) return item;
        const nextPaid = Math.min(Number(item.total_amount || 0), Number(item.paid_amount || 0) + addAmt);
        const nextBalance = Math.max(0, Number((Number(item.total_amount || 0) - nextPaid).toFixed(2)));
        return {
          ...item,
          paid_amount: nextPaid,
          balance_amount: nextBalance,
          status: nextBalance <= 0 ? "Cleared" : "Pending",
        };
      }),
    );
    showToast("Payment recorded.", "success");
    setRecordPaymentTarget(null);
  };

  const openUploadInvoiceModal = (rec: FinancialPlanningRecord) => {
    setUploadInvoiceTarget(rec);
    setSelectedInvoiceFile(null);
    setSelectedInvoiceFileName(rec.invoice_attachment_name || "");
    setSelectedInvoiceObjectUrl(rec.invoice_attachment_url || "");
    closeActionMenu();
  };

  const handleSaveInvoiceAttachment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadInvoiceTarget || (!selectedInvoiceFile && !selectedInvoiceObjectUrl)) {
      showToast("Please select a file to attach.", "error");
      return;
    }

    const entryKey = getEntryKey(uploadInvoiceTarget);
    if (!isPropControlled && entryKey && selectedInvoiceFile) {
      setSubmitting(true);
      try {
        const uploaded = await uploadPlanningFile(selectedInvoiceFile);
        const res = await apiPatch<FinancialPlanningRecord>(
          `/financial-planning/entries/${encodeURIComponent(entryKey)}/attachment`,
          {
            attachment_type: "invoice",
            file_url: uploaded.file_url,
            file_name: uploaded.file_name,
          },
        );
        if (res?.data) {
          setRecords((prev) =>
            prev.map((item) => (item.id === uploadInvoiceTarget.id ? res.data : item)),
          );
        }
        showToast("Invoice attachment added.", "success");
        setUploadInvoiceTarget(null);
      } catch (err) {
        showToast(errorMessage(err), "error");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setRecords((prev) =>
      prev.map((item) =>
        item.id === uploadInvoiceTarget.id
          ? {
              ...item,
              invoice_attachment_url: selectedInvoiceObjectUrl,
              invoice_attachment_name: selectedInvoiceFileName || "Invoice_Attachment",
            }
          : item,
      ),
    );
    showToast("Invoice attachment added.", "success");
    setUploadInvoiceTarget(null);
  };

  return (
    <AppShell activeKey="reports-financial-planning">
      <main className="page">
        <div style={{ marginBottom: "10px" }}>
          <Breadcrumb trail={["Reports", "Financial Planning Report"]} />
        </div>

        {/* Page Header: Title + Refresh + Filter Funnel (#556987) + Golden-Amber Export (#f59e0b) */}
        <div
          className="page-header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "14px",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#0f172a" }}>
              Financial Planning Report
            </h1>
            {loading && (
              <span
                data-testid="fp-sync-indicator"
                style={{
                  fontSize: "11.5px",
                  fontWeight: 600,
                  color: "#0284c7",
                  background: "#e0f2fe",
                  padding: "2px 8px",
                  borderRadius: "999px",
                }}
              >
                Syncing...
              </span>
            )}
          </div>

          <div className="page-header-actions" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {!isPropControlled && (
              <button
                type="button"
                className="btn"
                data-testid="fp-btn-refresh"
                aria-label="Refresh"
                title="Refresh live records from Import Purchase, Local Purchase & Sales Process"
                disabled={loading}
                onClick={() => void fetchReport()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "35px",
                  background: "#ffffff",
                  color: "#334155",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  padding: "8px 12px",
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </button>
            )}

            <button
              type="button"
              className="btn btn-filter-toggle"
              data-testid="fp-btn-toggle-filter"
              aria-label="Filter"
              title="Toggle Filter Panel"
              onClick={() => setFilterOpen((prev) => !prev)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                height: "35px",
                background: "#556987",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                padding: "8px 14px",
                cursor: "pointer",
                boxShadow: "0 1px 3px rgba(15, 23, 42, 0.12)",
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
            </button>

            <button
              type="button"
              className="btn btn-imp-exp"
              data-testid="fp-btn-export"
              onClick={handleExportCsv}
              title="Export Financial Planning Report to CSV"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                height: "35px",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Export</span>
            </button>
          </div>
        </div>

        {/* Collapsible Filter Panel (Universal Filter-Above-KPI Placement Hierarchy) */}
        {filterOpen && (
          <div
            data-testid="fp-filter-panel"
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              padding: "16px 20px",
              marginBottom: "16px",
              boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                gap: "16px",
              }}
            >
              <div>
                <label
                  htmlFor="fp-filter-due-date-range"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                  }}
                >
                  Due Date Range
                </label>
                <DateRangePicker
                  id="fp-filter-due-date-range"
                  value={dueDateRange}
                  onChange={(val) => setDueDateRange(val)}
                  onApply={(val) => setDueDateRange(val)}
                  placeholder="Select due date range"
                />
              </div>

              <div>
                <label
                  htmlFor="fp-filter-source-module"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                  }}
                >
                  Source Module
                </label>
                <select
                  id="fp-filter-source-module"
                  aria-label="Source Module"
                  value={sourceModuleFilter}
                  onChange={(e) => setSourceModuleFilter(e.target.value)}
                  style={{
                    width: "100%",
                    height: "36px",
                    padding: "0 10px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#1e293b",
                  }}
                >
                  <option value="">All Modules</option>
                  <option value="import_purchase">Import Purchase (Confirmed)</option>
                  <option value="local_purchase">Local Purchase (Confirmed)</option>
                  <option value="sales_process">Sales Process (Acc. Confirmed)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="fp-filter-party-type"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                  }}
                >
                  Party Type
                </label>
                <select
                  id="fp-filter-party-type"
                  aria-label="Party Type"
                  value={partyTypeFilter}
                  onChange={(e) => setPartyTypeFilter(e.target.value)}
                  style={{
                    width: "100%",
                    height: "36px",
                    padding: "0 10px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#1e293b",
                  }}
                >
                  <option value="">All</option>
                  <option value="Supplier">Supplier</option>
                  <option value="Taxes">Taxes</option>
                  <option value="Customer">Customer (Sales)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="fp-filter-currency"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                  }}
                >
                  Currency
                </label>
                <select
                  id="fp-filter-currency"
                  aria-label="Currency"
                  value={currencyFilter}
                  onChange={(e) => setCurrencyFilter(e.target.value)}
                  style={{
                    width: "100%",
                    height: "36px",
                    padding: "0 10px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#1e293b",
                  }}
                >
                  <option value="">All</option>
                  <option value="INR">Rupees (₹ / INR)</option>
                  <option value="USD">US Dollar ($ / USD)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="fp-filter-payment-terms"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                  }}
                >
                  Payment Terms
                </label>
                <select
                  id="fp-filter-payment-terms"
                  aria-label="Payment Terms"
                  value={paymentTermsFilter}
                  onChange={(e) => setPaymentTermsFilter(e.target.value)}
                  style={{
                    width: "100%",
                    height: "36px",
                    padding: "0 10px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#1e293b",
                  }}
                >
                  <option value="">All</option>
                  {paymentTermsOptions.map((term) => (
                    <option key={term} value={term}>
                      {term}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
              <button type="button" className="btn-filter-reset" onClick={handleResetFilters}>
                Reset
              </button>
              <button type="button" className="btn-filter-search" onClick={handleApplyFilters}>
                Search
              </button>
            </div>
          </div>
        )}

        {/* 6 Top KPI Metric Cards: Rupees (₹ default) [ALL, PAID, BALANCE] + USD ($) [ALL, PAID, BALANCE] */}
        <div
          data-testid="fp-kpi-strip"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
            gap: "12px",
            marginBottom: "16px",
          }}
        >
          {/* Card 1: ALL (Rupees ₹ default) */}
          <div
            data-testid="fp-kpi-inr-all"
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              padding: "14px 16px",
              boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: "0.4px",
                marginBottom: "6px",
              }}
            >
              ALL
            </div>
            <div style={{ fontSize: "15.5px", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap" }}>
              {formatPlanningAmount(kpis.inrAll, "INR")} ({kpis.inrCount})
            </div>
          </div>

          {/* Card 2: PAID (Rupees ₹ default) */}
          <div
            data-testid="fp-kpi-inr-paid"
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              padding: "14px 16px",
              boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: "0.4px",
                marginBottom: "6px",
              }}
            >
              PAID
            </div>
            <div style={{ fontSize: "15.5px", fontWeight: 700, color: "#16a34a", whiteSpace: "nowrap" }}>
              {formatPlanningAmount(kpis.inrPaid, "INR")}
            </div>
          </div>

          {/* Card 3: BALANCE (Rupees ₹ default) */}
          <div
            data-testid="fp-kpi-inr-balance"
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              padding: "14px 16px",
              boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: "0.4px",
                marginBottom: "6px",
              }}
            >
              BALANCE
            </div>
            <div style={{ fontSize: "15.5px", fontWeight: 700, color: "#dc2626", whiteSpace: "nowrap" }}>
              {formatPlanningAmount(kpis.inrBalance, "INR")}
            </div>
          </div>

          {/* Card 4: ALL (USD $) */}
          <div
            data-testid="fp-kpi-usd-all"
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              padding: "14px 16px",
              boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: "0.4px",
                marginBottom: "6px",
              }}
            >
              ALL
            </div>
            <div style={{ fontSize: "15.5px", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap" }}>
              {formatPlanningAmount(kpis.usdAll, "USD")} ({kpis.usdCount})
            </div>
          </div>

          {/* Card 5: PAID (USD $) */}
          <div
            data-testid="fp-kpi-usd-paid"
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              padding: "14px 16px",
              boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: "0.4px",
                marginBottom: "6px",
              }}
            >
              PAID
            </div>
            <div style={{ fontSize: "15.5px", fontWeight: 700, color: "#16a34a", whiteSpace: "nowrap" }}>
              {formatPlanningAmount(kpis.usdPaid, "USD")}
            </div>
          </div>

          {/* Card 6: BALANCE (USD $) */}
          <div
            data-testid="fp-kpi-usd-balance"
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              padding: "14px 16px",
              boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: "0.4px",
                marginBottom: "6px",
              }}
            >
              BALANCE
            </div>
            <div style={{ fontSize: "15.5px", fontWeight: 700, color: "#dc2626", whiteSpace: "nowrap" }}>
              {formatPlanningAmount(kpis.usdBalance, "USD")}
            </div>
          </div>
        </div>

        {/* Main Card Container: Pending / Cleared Tabs + Toolbar + 10-Column Table + Pagination */}
        <div
          className="card"
          data-testid="financial-planning-report-card"
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            padding: "0 16px 16px",
            boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
          }}
        >
          {/* Stage Tabs: Pending | Cleared */}
          <div
            role="tablist"
            aria-label="Financial Planning Status Tabs"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              borderBottom: "1px solid #e2e8f0",
              marginBottom: "14px",
              paddingTop: "6px",
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "pending"}
              data-testid="fp-tab-pending"
              onClick={() => {
                setActiveTab("pending");
                setCurrentPage(1);
              }}
              style={{
                background: "none",
                border: "none",
                borderBottom: activeTab === "pending" ? "2px solid #0061f2" : "2px solid transparent",
                color: activeTab === "pending" ? "#0061f2" : "#64748b",
                fontWeight: activeTab === "pending" ? 700 : 500,
                fontSize: "13px",
                padding: "10px 14px",
                cursor: "pointer",
              }}
            >
              Pending ({pendingCount})
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "cleared"}
              data-testid="fp-tab-cleared"
              onClick={() => {
                setActiveTab("cleared");
                setCurrentPage(1);
              }}
              style={{
                background: "none",
                border: "none",
                borderBottom: activeTab === "cleared" ? "2px solid #0061f2" : "2px solid transparent",
                color: activeTab === "cleared" ? "#0061f2" : "#64748b",
                fontWeight: activeTab === "cleared" ? 700 : 500,
                fontSize: "13px",
                padding: "10px 14px",
                cursor: "pointer",
              }}
            >
              Cleared ({clearedCount})
            </button>
          </div>

          {/* Sub-Toolbar: 50 items/page + Search... */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <select
                aria-label="Items per page"
                data-testid="fp-items-per-page"
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: "4px",
                  border: "1px solid #cbd5e1",
                  fontSize: "12.5px",
                  color: "#334155",
                  background: "#ffffff",
                  cursor: "pointer",
                }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span style={{ fontSize: "12.5px", color: "#64748b" }}>items/page</span>
            </div>

            <div style={{ minWidth: "220px" }}>
              <input
                type="text"
                data-testid="fp-search-input"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                style={{
                  width: "100%",
                  padding: "6px 12px",
                  borderRadius: "4px",
                  border: "1px solid #cbd5e1",
                  fontSize: "12.5px",
                  outline: "none",
                  background: "#ffffff",
                  color: "#0f172a",
                }}
              />
            </div>
          </div>

          {/* 10-Column Data Table */}
          <div
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              overflowX: "auto",
            }}
          >
            <table
              data-testid="fp-table"
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
                fontSize: "12.5px",
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "#f8fafc",
                    borderBottom: "1px solid #e2e8f0",
                    color: "#334155",
                    fontWeight: 700,
                  }}
                >
                  <th style={{ padding: "10px 12px", minWidth: "230px", borderRight: "1px solid #f1f5f9" }}>
                    <SortHeader
                      label="Party Name"
                      isSorted={sortKey === "party_name"}
                      sortDirection={sortDirection}
                      onSort={() => handleSort("party_name")}
                    />
                  </th>
                  <th style={{ padding: "10px 12px", minWidth: "155px", borderRight: "1px solid #f1f5f9" }}>
                    <SortHeader
                      label="Invoice / Cons. No."
                      isSorted={sortKey === "invoice_no"}
                      sortDirection={sortDirection}
                      onSort={() => handleSort("invoice_no")}
                    />
                  </th>
                  <th style={{ padding: "10px 12px", minWidth: "110px", borderRight: "1px solid #f1f5f9" }}>
                    <div style={{ lineHeight: 1.25 }}>
                      Invoice
                      <br />
                      Attachment
                    </div>
                  </th>
                  <th style={{ padding: "10px 12px", minWidth: "135px", borderRight: "1px solid #f1f5f9" }}>
                    <SortHeader
                      label="Payment Terms"
                      isSorted={sortKey === "payment_terms"}
                      sortDirection={sortDirection}
                      onSort={() => handleSort("payment_terms")}
                    />
                  </th>
                  <th style={{ padding: "10px 12px", minWidth: "125px", borderRight: "1px solid #f1f5f9" }}>
                    <SortHeader
                      label="Total Amount"
                      isSorted={sortKey === "total_amount"}
                      sortDirection={sortDirection}
                      onSort={() => handleSort("total_amount")}
                    />
                  </th>
                  <th style={{ padding: "10px 12px", minWidth: "125px", borderRight: "1px solid #f1f5f9" }}>
                    <SortHeader
                      label="Paid Amount"
                      isSorted={sortKey === "paid_amount"}
                      sortDirection={sortDirection}
                      onSort={() => handleSort("paid_amount")}
                    />
                  </th>
                  <th style={{ padding: "10px 12px", minWidth: "130px", borderRight: "1px solid #f1f5f9" }}>
                    <SortHeader
                      label="Balance Amount"
                      isSorted={sortKey === "balance_amount"}
                      sortDirection={sortDirection}
                      onSort={() => handleSort("balance_amount")}
                    />
                  </th>
                  <th style={{ padding: "10px 12px", minWidth: "105px", borderRight: "1px solid #f1f5f9" }}>
                    <SortHeader
                      label="Due Date"
                      isSorted={sortKey === "due_date"}
                      sortDirection={sortDirection}
                      onSort={() => handleSort("due_date")}
                    />
                  </th>
                  <th style={{ padding: "10px 12px", minWidth: "90px", borderRight: "1px solid #f1f5f9" }}>
                    Status
                  </th>
                  <th style={{ padding: "10px 12px", width: "68px", textAlign: "center" }}>
                    Action
                  </th>
                </tr>
              </thead>

              <tbody>
                {paginatedRecords.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      data-testid="fp-empty-state"
                      style={{
                        padding: "44px 16px",
                        textAlign: "center",
                        color: "#64748b",
                        fontSize: "13px",
                      }}
                    >
                      No Data Available In Table
                    </td>
                  </tr>
                ) : (
                  paginatedRecords.map((rec) => {
                    const curr = normalizeCurrency(rec.currency);
                    const balance = computeBalance(rec);
                    const isTaxesRow = rec.party_type === "Taxes";
                    const displayParty = normalizePartyDisplayName(rec);
                    const isCleared = rec.status === "Cleared";
                    const badgeStyle = resolvePartyBadgeColors(rec.party_type);
                    const sourceBadge = resolveSourceDisplay(rec);

                    return (
                      <tr
                        key={rec.id}
                        data-testid={`fp-row-${rec.id}`}
                        style={{
                          background: isTaxesRow ? "#f1f5f9" : "#ffffff",
                          borderBottom: "1px solid #e2e8f0",
                          verticalAlign: "middle",
                        }}
                      >
                        {/* 1. Party Name + Supplier / Taxes / Customer + Source Module Badge */}
                        <td style={{ padding: "10px 12px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "4px" }}>
                            {displayParty}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                            <span
                              style={{
                                display: "inline-block",
                                fontSize: "10.5px",
                                fontWeight: 600,
                                padding: "1px 8px",
                                borderRadius: "4px",
                                background: badgeStyle.bg,
                                color: badgeStyle.fg,
                                border: badgeStyle.border,
                              }}
                            >
                              {rec.party_type}
                            </span>

                            {sourceBadge && (
                              <span
                                style={{
                                  display: "inline-block",
                                  fontSize: "10px",
                                  fontWeight: 600,
                                  padding: "1px 7px",
                                  borderRadius: "4px",
                                  background: "#f8fafc",
                                  color: "#475569",
                                  border: "1px solid #cbd5e1",
                                }}
                              >
                                {sourceBadge}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 2. Invoice / Cons. No. */}
                        <td style={{ padding: "10px 12px", color: "#1e293b", borderRight: "1px solid #e2e8f0" }}>
                          {rec.invoice_no || "—"}
                        </td>

                        {/* 3. Invoice Attachment */}
                        <td style={{ padding: "10px 12px", borderRight: "1px solid #e2e8f0" }}>
                          {rec.invoice_attachment_url ? (
                            <a
                              href={resolveAttachmentHref(rec.invoice_attachment_url)}
                              target="_blank"
                              rel="noreferrer"
                              title={rec.invoice_attachment_name || "Download Invoice Attachment"}
                              aria-label="Download Invoice Attachment"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "#2563eb",
                                padding: "4px",
                                borderRadius: "4px",
                              }}
                            >
                              <svg
                                width="15"
                                height="15"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                            </a>
                          ) : rec.allow_invoice_upload !== false ? (
                            <button
                              type="button"
                              onClick={() => openUploadInvoiceModal(rec)}
                              data-testid={`fp-add-invoice-${rec.id}`}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "3px",
                                fontSize: "11px",
                                fontWeight: 600,
                                padding: "3px 8px",
                                borderRadius: "4px",
                                border: "1px solid #16a34a",
                                background: "#f0fdf4",
                                color: "#15803d",
                                cursor: "pointer",
                              }}
                            >
                              + Add
                            </button>
                          ) : (
                            <span style={{ color: "#94a3b8" }}>—</span>
                          )}
                        </td>

                        {/* 4. Payment Terms + Download / Edit Icons */}
                        <td style={{ padding: "10px 12px", borderRight: "1px solid #e2e8f0" }}>
                          {rec.payment_terms && (
                            <div style={{ color: "#1e293b", fontWeight: 500, marginBottom: "5px" }}>
                              {rec.payment_terms}
                            </div>
                          )}
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                            {rec.payment_attachment_url && (
                              <a
                                href={resolveAttachmentHref(rec.payment_attachment_url)}
                                target="_blank"
                                rel="noreferrer"
                                title={rec.payment_attachment_name || "Download Payment Attachment"}
                                aria-label="Download Payment Attachment"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "#2563eb",
                                }}
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                  <polyline points="7 10 12 15 17 10" />
                                  <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                              </a>
                            )}

                            <button
                              type="button"
                              title="Edit Payment Terms"
                              aria-label="Edit Payment Terms"
                              data-testid={`fp-edit-terms-${rec.id}`}
                              onClick={() => openEditTermsModal(rec)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: "22px",
                                height: "22px",
                                borderRadius: "4px",
                                border: "1px solid #16a34a",
                                background: "#ffffff",
                                color: "#16a34a",
                                cursor: "pointer",
                                padding: 0,
                              }}
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                              </svg>
                            </button>
                          </div>
                        </td>

                        {/* 5. Total Amount (Rupees ₹ default) */}
                        <td
                          style={{
                            padding: "10px 12px",
                            fontWeight: 600,
                            color: "#0f172a",
                            whiteSpace: "nowrap",
                            borderRight: "1px solid #e2e8f0",
                          }}
                        >
                          {formatPlanningAmount(rec.total_amount, curr)}
                        </td>

                        {/* 6. Paid Amount (Emerald Green) */}
                        <td
                          style={{
                            padding: "10px 12px",
                            fontWeight: 600,
                            color: "#16a34a",
                            whiteSpace: "nowrap",
                            borderRight: "1px solid #e2e8f0",
                          }}
                        >
                          {formatPlanningAmount(rec.paid_amount, curr)}
                        </td>

                        {/* 7. Balance Amount (Crimson Red) */}
                        <td
                          style={{
                            padding: "10px 12px",
                            fontWeight: 600,
                            color: "#dc2626",
                            whiteSpace: "nowrap",
                            borderRight: "1px solid #e2e8f0",
                          }}
                        >
                          {formatPlanningAmount(balance, curr)}
                        </td>

                        {/* 8. Due Date */}
                        <td
                          style={{
                            padding: "10px 12px",
                            color: "#1e293b",
                            whiteSpace: "nowrap",
                            borderRight: "1px solid #e2e8f0",
                          }}
                        >
                          {formatDueDate(rec.due_date)}
                        </td>

                        {/* 9. Status Pill */}
                        <td style={{ padding: "10px 12px", borderRight: "1px solid #e2e8f0" }}>
                          <span
                            style={{
                              display: "inline-block",
                              fontSize: "11px",
                              fontWeight: 600,
                              padding: "2px 10px",
                              borderRadius: "4px",
                              background: isCleared ? "#dbeafe" : "#fef3c7",
                              color: isCleared ? "#1d4ed8" : "#b45309",
                            }}
                          >
                            {rec.status}
                          </span>
                        </td>

                        {/* 10. Action (⋮) */}
                        <td style={{ padding: "10px 12px", textAlign: "center" }}>
                          <button
                            type="button"
                            aria-label="Row actions"
                            aria-haspopup="menu"
                            aria-expanded={openActionRowId === rec.id}
                            data-testid={`fp-action-btn-${rec.id}`}
                            className="btn-payment-action"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleActionMenu(rec.id, e.currentTarget);
                            }}
                            style={{
                              background: openActionRowId === rec.id ? "#f1f5f9" : "transparent",
                              border: "none",
                              cursor: "pointer",
                              padding: "4px 8px",
                              borderRadius: "6px",
                              color: openActionRowId === rec.id ? "#0f172a" : "#334155",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              transition: "background 0.15s ease, color 0.15s ease",
                            }}
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <circle cx="12" cy="5" r="2" />
                              <circle cx="12" cy="12" r="2" />
                              <circle cx="12" cy="19" r="2" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <Pagination
            pagination={paginationMeta}
            pageSize={perPage}
            onPageChange={(nextPage) => setCurrentPage(nextPage)}
          />
        </div>

        {/* Row Action Menu Portal (escapes table overflowX: auto clipping & td white-space: nowrap) */}
        {activeActionRecord &&
          actionMenuPosition &&
          createPortal(
            <div
              ref={actionMenuPortalRef}
              role="menu"
              data-testid="fp-action-menu"
              style={{
                position: "fixed",
                top: actionMenuPosition.top,
                bottom: actionMenuPosition.bottom,
                left: actionMenuPosition.left,
                width: "210px",
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                gap: "2px",
                background: "#ffffff",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
                boxShadow:
                  "0 10px 25px -5px rgba(15, 23, 42, 0.16), 0 8px 10px -6px rgba(15, 23, 42, 0.08)",
                zIndex: 99999,
                padding: "5px",
                textAlign: "left",
                whiteSpace: "normal",
              }}
            >
              <button
                type="button"
                role="menuitem"
                className="action-dropdown-item"
                onClick={() => {
                  setDetailRecord(activeActionRecord);
                  closeActionMenu();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "9px",
                  width: "100%",
                  boxSizing: "border-box",
                  background: "none",
                  border: "none",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  fontSize: "12.5px",
                  fontWeight: 500,
                  color: "#1e293b",
                  textAlign: "left",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#475569"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ flexShrink: 0 }}
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>View Details</span>
              </button>

              <button
                type="button"
                role="menuitem"
                className="action-dropdown-item"
                onClick={() => openEditTermsModal(activeActionRecord)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "9px",
                  width: "100%",
                  boxSizing: "border-box",
                  background: "none",
                  border: "none",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  fontSize: "12.5px",
                  fontWeight: 500,
                  color: "#1e293b",
                  textAlign: "left",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#475569"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ flexShrink: 0 }}
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                <span>Update Payment Terms</span>
              </button>

              {activeActionRecord.status !== "Cleared" && (
                <button
                  type="button"
                  role="menuitem"
                  className="action-dropdown-item"
                  onClick={() => openRecordPaymentModal(activeActionRecord)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "9px",
                    width: "100%",
                    boxSizing: "border-box",
                    background: "none",
                    border: "none",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    color: "#15803d",
                    textAlign: "left",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#15803d"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ flexShrink: 0 }}
                  >
                    <rect x="2" y="5" width="20" height="14" rx="2" />
                    <line x1="2" y1="10" x2="22" y2="10" />
                  </svg>
                  <span>Record Payment</span>
                </button>
              )}

              <div
                aria-hidden="true"
                style={{
                  height: "1px",
                  background: "#e2e8f0",
                  margin: "2px 4px",
                }}
              />

              <button
                type="button"
                role="menuitem"
                className="action-dropdown-item"
                onClick={() => openUploadInvoiceModal(activeActionRecord)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "9px",
                  width: "100%",
                  boxSizing: "border-box",
                  background: "none",
                  border: "none",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  fontSize: "12.5px",
                  fontWeight: 500,
                  color: "#2563eb",
                  textAlign: "left",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ flexShrink: 0 }}
                >
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                <span>Attach Invoice</span>
              </button>
            </div>,
            document.body,
          )}

        {/* View Details Drawer Modal */}
        <Modal
          open={Boolean(detailRecord)}
          title="Financial Planning Entry Details"
          onClose={() => setDetailRecord(null)}
        >
          {detailRecord && (() => {
            const detailCurr = normalizeCurrency(detailRecord.currency);
            const detailBalance = computeBalance(detailRecord);
            const detailBadge = resolvePartyBadgeColors(detailRecord.party_type);
            const detailSource = resolveSourceDisplay(detailRecord);
            const detailIsCleared = detailRecord.status === "Cleared";

            return (
              <>
                <div
                  className="drawer-content-scroll"
                  data-testid="fp-detail-modal-body"
                  style={{
                    padding: "20px 24px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                    fontSize: "13px",
                    color: "#1e293b",
                  }}
                >
                  {/* Top Party & Status Summary Card */}
                  <div
                    style={{
                      background: "#ffffff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      padding: "16px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: "12px",
                      }}
                    >
                      <div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a", lineHeight: 1.35 }}>
                        {normalizePartyDisplayName(detailRecord)}
                      </div>
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: "11.5px",
                          fontWeight: 600,
                          padding: "3px 10px",
                          borderRadius: "999px",
                          background: detailIsCleared ? "#dbeafe" : "#fef3c7",
                          color: detailIsCleared ? "#1d4ed8" : "#b45309",
                          flexShrink: 0,
                        }}
                      >
                        {detailRecord.status}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: "11px",
                          fontWeight: 600,
                          padding: "2px 9px",
                          borderRadius: "4px",
                          background: detailBadge.bg,
                          color: detailBadge.fg,
                          border: detailBadge.border,
                        }}
                      >
                        {detailRecord.party_type}
                      </span>
                      {detailSource && (
                        <span
                          style={{
                            display: "inline-block",
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "2px 9px",
                            borderRadius: "4px",
                            background: "#f8fafc",
                            color: "#475569",
                            border: "1px solid #cbd5e1",
                          }}
                        >
                          {detailSource}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 3-Column Financial KPI Strip */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                      gap: "10px",
                    }}
                  >
                    <div
                      style={{
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        padding: "12px 14px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 700,
                          color: "#64748b",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          marginBottom: "4px",
                        }}
                      >
                        Total Amount
                      </div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>
                        {formatPlanningAmount(detailRecord.total_amount, detailCurr)}
                      </div>
                    </div>

                    <div
                      style={{
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        padding: "12px 14px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 700,
                          color: "#64748b",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          marginBottom: "4px",
                        }}
                      >
                        Paid Amount
                      </div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#16a34a" }}>
                        {formatPlanningAmount(detailRecord.paid_amount, detailCurr)}
                      </div>
                    </div>

                    <div
                      style={{
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        padding: "12px 14px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 700,
                          color: "#64748b",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          marginBottom: "4px",
                        }}
                      >
                        Balance Amount
                      </div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#dc2626" }}>
                        {formatPlanningAmount(detailBalance, detailCurr)}
                      </div>
                    </div>
                  </div>

                  {/* Entry Metadata Card */}
                  <div
                    style={{
                      background: "#ffffff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      padding: "16px",
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: "14px 16px",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", marginBottom: "3px" }}>
                        Invoice / Cons. No.
                      </div>
                      <div style={{ fontWeight: 600, color: "#0f172a", wordBreak: "break-word" }}>
                        {detailRecord.invoice_no || "—"}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", marginBottom: "3px" }}>
                        Currency
                      </div>
                      <div style={{ fontWeight: 600, color: "#0f172a" }}>
                        {detailCurr === "INR" ? "Rupees (₹ / INR)" : "US Dollar ($ / USD)"}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", marginBottom: "3px" }}>
                        Payment Terms
                      </div>
                      <div style={{ fontWeight: 600, color: "#0f172a" }}>
                        {detailRecord.payment_terms || "—"}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", marginBottom: "3px" }}>
                        Due Date
                      </div>
                      <div style={{ fontWeight: 600, color: "#0f172a" }}>
                        {formatDueDate(detailRecord.due_date)}
                      </div>
                    </div>

                    {(detailRecord.invoice_attachment_url || detailRecord.payment_attachment_url) && (
                      <div style={{ gridColumn: "1 / -1", paddingTop: "4px", borderTop: "1px solid #f1f5f9" }}>
                        <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", marginBottom: "6px" }}>
                          Documents & Attachments
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                          {detailRecord.invoice_attachment_url && (
                            <a
                              href={resolveAttachmentHref(detailRecord.invoice_attachment_url)}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "5px 10px",
                                borderRadius: "6px",
                                background: "#eff6ff",
                                border: "1px solid #bfdbfe",
                                color: "#1d4ed8",
                                fontSize: "12px",
                                fontWeight: 600,
                                textDecoration: "none",
                              }}
                            >
                              <span>{detailRecord.invoice_attachment_name || "Download Invoice"}</span>
                            </a>
                          )}
                          {detailRecord.payment_attachment_url && (
                            <a
                              href={resolveAttachmentHref(detailRecord.payment_attachment_url)}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "5px 10px",
                                borderRadius: "6px",
                                background: "#f0fdf4",
                                border: "1px solid #bbf7d0",
                                color: "#15803d",
                                fontSize: "12px",
                                fontWeight: 600,
                                textDecoration: "none",
                              }}
                            >
                              <span>{detailRecord.payment_attachment_name || "Payment Advice"}</span>
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    <div style={{ gridColumn: "1 / -1", paddingTop: "4px", borderTop: "1px solid #f1f5f9" }}>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", marginBottom: "4px" }}>
                        Remarks
                      </div>
                      <div
                        style={{
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          borderRadius: "6px",
                          padding: "8px 12px",
                          color: detailRecord.remarks ? "#334155" : "#94a3b8",
                          lineHeight: 1.45,
                        }}
                      >
                        {detailRecord.remarks || "No remarks recorded."}
                      </div>
                    </div>
                  </div>

                  {/* Recorded Payments History Card */}
                  <div
                    style={{
                      background: "#ffffff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      padding: "16px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#0f172a",
                        marginBottom: "10px",
                      }}
                    >
                      Recorded Payments
                    </div>
                    {Array.isArray(detailRecord.payments_history) && detailRecord.payments_history.length > 0 ? (
                      <div
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: "6px",
                          overflowX: "auto",
                        }}
                      >
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                          <thead>
                            <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                              <th style={{ padding: "8px 10px", textAlign: "left" }}>Date</th>
                              <th style={{ padding: "8px 10px", textAlign: "left" }}>Mode</th>
                              <th style={{ padding: "8px 10px", textAlign: "left" }}>Reference</th>
                              <th style={{ padding: "8px 10px", textAlign: "right" }}>Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailRecord.payments_history.map((pmt, idx) => (
                              <tr key={pmt.id || idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                <td style={{ padding: "8px 10px" }}>{pmt.payment_date || "—"}</td>
                                <td style={{ padding: "8px 10px" }}>{pmt.payment_mode || "—"}</td>
                                <td style={{ padding: "8px 10px" }}>{pmt.reference_no || "—"}</td>
                                <td
                                  style={{
                                    padding: "8px 10px",
                                    textAlign: "right",
                                    fontWeight: 600,
                                    color: "#16a34a",
                                  }}
                                >
                                  {formatPlanningAmount(pmt.amount, detailCurr)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: "12.5px",
                          color: "#64748b",
                          background: "#f8fafc",
                          border: "1px dashed #cbd5e1",
                          borderRadius: "6px",
                          padding: "12px",
                          textAlign: "center",
                        }}
                      >
                        No payments recorded against this entry yet.
                      </div>
                    )}
                  </div>
                </div>

                {/* Fixed Drawer Footer */}
                <div
                  className="drawer-footer-fixed"
                  style={{
                    padding: "14px 24px",
                    gap: "10px",
                  }}
                >
                  <button type="button" className="btn" onClick={() => setDetailRecord(null)}>
                    Close
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const target = detailRecord;
                      setDetailRecord(null);
                      openEditTermsModal(target);
                    }}
                  >
                    Update Terms
                  </button>
                  {!detailIsCleared && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        const target = detailRecord;
                        setDetailRecord(null);
                        openRecordPaymentModal(target);
                      }}
                    >
                      Record Payment
                    </button>
                  )}
                </div>
              </>
            );
          })()}
        </Modal>

        {/* Update Payment Terms & Due Date Modal */}
        <Modal
          open={Boolean(editTermsRecord)}
          title="Update Payment Terms & Due Date"
          onClose={() => setEditTermsRecord(null)}
        >
          {editTermsRecord && (
            <form onSubmit={handleSaveTerms}>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    fontSize: "13px",
                    color: "#334155",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: "#0f172a" }}>
                      {normalizePartyDisplayName(editTermsRecord)}
                    </div>
                    <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                      Invoice / Cons. No.: <strong>{editTermsRecord.invoice_no || "—"}</strong>
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, color: "#0f172a" }}>
                    {formatPlanningAmount(
                      editTermsRecord.total_amount,
                      normalizeCurrency(editTermsRecord.currency),
                    )}
                  </div>
                </div>

                <div
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "16px",
                    display: "grid",
                    gap: "14px",
                  }}
                >
                  <div>
                    <label
                      htmlFor="fp-edit-terms-select"
                      style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}
                    >
                      Payment Terms
                    </label>
                    <input
                      id="fp-edit-terms-select"
                      list="fp-payment-terms-datalist"
                      value={editTermsValue}
                      onChange={(e) => setEditTermsValue(e.target.value)}
                      placeholder="e.g. 100% Advance, CAD, 30 Days Credit"
                      style={{
                        width: "100%",
                        height: "38px",
                        padding: "0 12px",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                        fontSize: "13px",
                      }}
                    />
                    <datalist id="fp-payment-terms-datalist">
                      {paymentTermsOptions.map((term) => (
                        <option key={term} value={term} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label
                      htmlFor="fp-edit-due-date"
                      style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}
                    >
                      Due Date
                    </label>
                    <DatePicker
                      id="fp-edit-due-date"
                      value={editDueDateValue}
                      onChange={(val) => setEditDueDateValue(val)}
                      placeholder="DD-MM-YYYY"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="fp-edit-payment-doc"
                      style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}
                    >
                      Payment Terms / Advice Attachment (Optional)
                    </label>
                    <input
                      id="fp-edit-payment-doc"
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.doc,.docx"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setEditTermsAttachmentFile(file);
                      }}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="fp-edit-remarks"
                      style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}
                    >
                      Remarks
                    </label>
                    <textarea
                      id="fp-edit-remarks"
                      rows={3}
                      value={editRemarksValue}
                      onChange={(e) => setEditRemarksValue(e.target.value)}
                      placeholder="Optional payment planning notes"
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                        fontSize: "13px",
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={submitting}
                  onClick={() => setEditTermsRecord(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          )}
        </Modal>

        {/* Record Payment Modal */}
        <Modal
          open={Boolean(recordPaymentTarget)}
          title="Record Payment"
          onClose={() => setRecordPaymentTarget(null)}
        >
          {recordPaymentTarget && (
            <form onSubmit={handleSavePayment}>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    fontSize: "13px",
                    color: "#334155",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: "#0f172a" }}>
                      {normalizePartyDisplayName(recordPaymentTarget)}
                    </div>
                    <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                      Invoice / Cons. No.: <strong>{recordPaymentTarget.invoice_no || "—"}</strong>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b" }}>Outstanding Balance</div>
                    <div style={{ fontSize: "14px", color: "#dc2626", fontWeight: 700 }}>
                      {formatPlanningAmount(
                        computeBalance(recordPaymentTarget),
                        normalizeCurrency(recordPaymentTarget.currency),
                      )}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "16px",
                    display: "grid",
                    gap: "14px",
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div>
                      <label
                        htmlFor="fp-record-payment-amount"
                        style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}
                      >
                        Amount Paid ({normalizeCurrency(recordPaymentTarget.currency) === "INR" ? "₹" : "$"}) *
                      </label>
                      <input
                        id="fp-record-payment-amount"
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={paymentInputAmount}
                        onChange={(e) => setPaymentInputAmount(e.target.value)}
                        style={{
                          width: "100%",
                          height: "38px",
                          padding: "0 12px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "13px",
                        }}
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="fp-record-payment-mode"
                        style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}
                      >
                        Payment Mode
                      </label>
                      <select
                        id="fp-record-payment-mode"
                        value={paymentModeInput}
                        onChange={(e) => setPaymentModeInput(e.target.value)}
                        style={{
                          width: "100%",
                          height: "38px",
                          padding: "0 12px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "13px",
                          background: "#ffffff",
                        }}
                      >
                        {PAYMENT_MODES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div>
                      <label
                        htmlFor="fp-record-payment-ref"
                        style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}
                      >
                        UTR / Reference No.
                      </label>
                      <input
                        id="fp-record-payment-ref"
                        type="text"
                        value={paymentRefInput}
                        onChange={(e) => setPaymentRefInput(e.target.value)}
                        placeholder="e.g. UTR / SWIFT / Cheque No."
                        style={{
                          width: "100%",
                          height: "38px",
                          padding: "0 12px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "13px",
                        }}
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="fp-record-payment-date"
                        style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}
                      >
                        Payment Date
                      </label>
                      <DatePicker
                        id="fp-record-payment-date"
                        value={paymentDateInput}
                        onChange={(val) => setPaymentDateInput(val)}
                        placeholder="DD-MM-YYYY"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="fp-record-payment-receipt"
                      style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}
                    >
                      Payment Receipt / Advice (Optional)
                    </label>
                    <input
                      id="fp-record-payment-receipt"
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.doc,.docx"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setPaymentReceiptFile(file);
                      }}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="fp-record-payment-remarks"
                      style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}
                    >
                      Remarks
                    </label>
                    <input
                      id="fp-record-payment-remarks"
                      type="text"
                      value={paymentRemarksInput}
                      onChange={(e) => setPaymentRemarksInput(e.target.value)}
                      placeholder="Optional payment settlement notes"
                      style={{
                        width: "100%",
                        height: "38px",
                        padding: "0 12px",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                        fontSize: "13px",
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={submitting}
                  onClick={() => setRecordPaymentTarget(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? "Saving..." : "Save Payment"}
                </button>
              </div>
            </form>
          )}
        </Modal>

        {/* Upload / Attach Invoice Modal */}
        <Modal
          open={Boolean(uploadInvoiceTarget)}
          title="Attach Invoice Document"
          onClose={() => setUploadInvoiceTarget(null)}
        >
          {uploadInvoiceTarget && (
            <form onSubmit={handleSaveInvoiceAttachment}>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    fontSize: "13px",
                    color: "#334155",
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#0f172a" }}>
                    {normalizePartyDisplayName(uploadInvoiceTarget)}
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                    Invoice / Cons. No.: <strong>{uploadInvoiceTarget.invoice_no || "—"}</strong>
                  </div>
                </div>

                <div
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "16px",
                    display: "grid",
                    gap: "12px",
                  }}
                >
                  <label
                    htmlFor="fp-attach-invoice-file"
                    style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#1e293b" }}
                  >
                    Select Invoice / Tax Challan Document *
                  </label>
                  <input
                    id="fp-attach-invoice-file"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.doc,.docx"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setSelectedInvoiceFile(file);
                      setSelectedInvoiceFileName(file.name);
                      setSelectedInvoiceObjectUrl(URL.createObjectURL(file));
                    }}
                  />
                  <div style={{ fontSize: "11.5px", color: "#64748b" }}>
                    Supported formats: PDF, PNG, JPG, WEBP, XLSX, DOC/DOCX
                  </div>
                  {selectedInvoiceFileName && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#15803d",
                        background: "#f0fdf4",
                        border: "1px solid #bbf7d0",
                        borderRadius: "6px",
                        padding: "6px 10px",
                      }}
                    >
                      Selected: <strong>{selectedInvoiceFileName}</strong>
                    </div>
                  )}
                </div>
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={submitting}
                  onClick={() => setUploadInvoiceTarget(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? "Uploading..." : "Save Attachment"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      </main>
    </AppShell>
  );
}
