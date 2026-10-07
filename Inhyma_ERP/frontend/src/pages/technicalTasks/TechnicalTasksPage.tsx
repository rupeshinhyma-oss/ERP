import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Pagination } from "@/components/Pagination";
import {
  fetchTechnicalTasks,
  fetchTechnicalTaskCounts,
  createTechnicalTask,
  updateTechnicalTask,
  updateTechnicalTaskStatus,
  deleteTechnicalTask,
  bulkDeleteTechnicalTasks,
  fetchTaskCallLogs,
  createTaskCallLog,
  uploadPaymentScreenshot,
  type TechnicalTaskListParams,
} from "@/lib/technicalTasksApi";
import type {
  TechnicalTask,
  TechnicalTaskCallLog,
  TechnicalTaskCounts,
  TechnicalTaskCreatePayload,
} from "@/types/technicalTasks";
import { ClientNameAutocomplete } from "@/components/ClientNameAutocomplete";
import { apiGet, errorMessage } from "@/lib/api";
import { useOptions, optionValues } from "@/lib/options";
import { Banner, Modal } from "@/components/ui";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import "@/styles/technicalTasks.css";

const TECHNICAL_TASK_OPTION_GROUPS = [
  "technical_task.task_type",
  "technical_task.priority",
  "technical_task.service_type",
  "technical_task.status",
] as const;

const TECHNICAL_TASK_COLUMN_LABELS = [
  "", // 0: Checkbox
  "SR. NO.", // 1: SR. NO.
  "COMPANY", // 2: COMPANY
  "TASK TYPE", // 3: TASK TYPE
  "CITY", // 4: CITY
  "THIRD-PARTY", // 5: THIRD-PARTY
  "PRIORITY", // 6: PRIORITY
  "MACHINE & MODEL", // 7: MACHINE & MODEL
  "DESC. OF TASK", // 8: DESC. OF TASK
  "CONTACT PERSON", // 9: CONTACT PERSON
  "TASK CREATED DATE & TASK BY", // 10: TASK CREATED DATE & TASK BY
  "SERVICE TYPE", // 11: SERVICE TYPE
  "CALL TYPE", // 12: CALL TYPE
  "TASK APPROVED BY", // 13: TASK APPROVED BY
  "TASK ALLOTTED TO", // 14: TASK ALLOTTED TO
  "PAYMENT", // 15: PAYMENT
  "STATUS", // 16: STATUS
  "ACTION", // 17: ACTION
];

const TOTAL_COLS_COUNT = TECHNICAL_TASK_COLUMN_LABELS.length;

/**
 * Skeleton placeholder rows for technical tasks table loading state.
 * Emulates the exact column widths, alignments, and freeze styles of the real rows.
 */
function TechnicalTaskSkeletonRows({
  count = 6,
  displayOrder,
  getFreezeStyle,
}: {
  count?: number;
  displayOrder: number[];
  getFreezeStyle: (colIdx: number, isHeader?: boolean) => React.CSSProperties;
}) {
  const rowIndexes = Array.from({ length: count }, (_, i) => i);
  const companyWidths = ["75%", "88%", "65%", "82%", "90%", "70%"];
  const modelWidths = ["80%", "65%", "85%", "70%", "90%", "75%"];
  const descWidths = ["90%", "75%", "85%", "95%", "80%", "70%"];

  return (
    <>
      {rowIndexes.map((rowIndex) => (
        <tr
          key={`tech-skeleton-row-${rowIndex}`}
          className="skeleton-row"
          data-testid="skeleton-row"
          style={{ borderBottom: "1px solid #f1f5f9" }}
        >
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
                        width: companyWidths[rowIndex % companyWidths.length],
                        height: "15px",
                        borderRadius: "4px",
                      }}
                    />
                    <div
                      className="skeleton-line"
                      style={{ width: "85px", height: "12px", borderRadius: "3px" }}
                    />
                  </div>
                );
                break;
              case 3:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "80px", height: "22px", borderRadius: "4px" }}
                  />
                );
                break;
              case 4:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "65px", height: "14px", borderRadius: "3px" }}
                  />
                );
                break;
              case 5:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "50px", height: "14px", borderRadius: "3px" }}
                  />
                );
                break;
              case 6:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "24px", height: "20px", borderRadius: "10px", margin: "0 auto" }}
                  />
                );
                break;
              case 7:
                content = (
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <div
                      className="skeleton-line"
                      style={{
                        width: modelWidths[rowIndex % modelWidths.length],
                        height: "14px",
                        borderRadius: "4px",
                      }}
                    />
                    <div
                      className="skeleton-line"
                      style={{ width: "70px", height: "12px", borderRadius: "3px" }}
                    />
                  </div>
                );
                break;
              case 8:
                content = (
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <div
                      className="skeleton-line"
                      style={{
                        width: descWidths[rowIndex % descWidths.length],
                        height: "13px",
                        borderRadius: "3px",
                      }}
                    />
                    <div
                      className="skeleton-line"
                      style={{ width: "45%", height: "11px", borderRadius: "3px" }}
                    />
                  </div>
                );
                break;
              case 9:
                content = (
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <div
                      className="skeleton-line"
                      style={{ width: "95px", height: "14px", borderRadius: "3px" }}
                    />
                    <div
                      className="skeleton-line"
                      style={{ width: "80px", height: "12px", borderRadius: "3px" }}
                    />
                  </div>
                );
                break;
              case 10:
                content = (
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <div
                      className="skeleton-line"
                      style={{ width: "75px", height: "13px", borderRadius: "3px" }}
                    />
                    <div
                      className="skeleton-line"
                      style={{ width: "85px", height: "12px", borderRadius: "3px" }}
                    />
                  </div>
                );
                break;
              case 11:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "65px", height: "20px", borderRadius: "12px" }}
                  />
                );
                break;
              case 12:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "55px", height: "20px", borderRadius: "12px" }}
                  />
                );
                break;
              case 13:
                content = (
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <div
                      className="skeleton-line"
                      style={{ width: "85px", height: "13px", borderRadius: "3px" }}
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
                    style={{ width: "90px", height: "14px", borderRadius: "3px" }}
                  />
                );
                break;
              case 15:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "55px", height: "20px", borderRadius: "12px" }}
                  />
                );
                break;
              case 16:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "75px", height: "22px", borderRadius: "12px" }}
                  />
                );
                break;
              case 17:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "34px", height: "26px", borderRadius: "4px", margin: "0 auto" }}
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
                  width: colIdx === 0 ? "40px" : colIdx === 1 ? "75px" : colIdx === 17 ? "70px" : undefined,
                  minWidth: colIdx === 0 ? "40px" : colIdx === 1 ? "75px" : colIdx === 17 ? "70px" : undefined,
                  maxWidth: colIdx === 0 ? "45px" : colIdx === 1 ? "85px" : undefined,
                  textAlign: colIdx === 0 || colIdx === 1 || colIdx === 6 || colIdx === 17 ? "center" : "left",
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

/**
 * Typable & Selectable Combobox.
 * Allows the user to type freely (to filter or enter a custom value)
 * as well as open a dropdown menu to select from predefined options.
 */
function TypableCombobox({
  value,
  onChange,
  options,
  placeholder = "Select or type...",
  style,
  id,
}: {
  value: string;
  onChange: (val: string) => void;
  options: string[];
  placeholder?: string;
  style?: React.CSSProperties;
  id?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter options based on typed input
  const filteredOptions = useMemo(() => {
    if (!value) return options;
    const clean = value.trim().toLowerCase();
    return options.filter((opt) => opt.toLowerCase().includes(clean));
  }, [options, value]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(0);
      } else {
        setHighlightedIndex((prev) =>
          prev < filteredOptions.length - 1 ? prev + 1 : 0
        );
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(filteredOptions.length - 1);
      } else {
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredOptions.length - 1
        );
      }
    } else if (e.key === "Enter") {
      if (isOpen && highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        e.preventDefault();
        handleSelect(filteredOptions[highlightedIndex]);
      } else {
        setIsOpen(false);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", ...style }}
    >
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input
          id={id}
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            if (!isOpen) setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          style={{
            width: "100%",
            height: "38px",
            borderRadius: "5px",
            border: "1px solid #cbd5e1",
            padding: "0 34px 0 12px",
            fontSize: "13.5px",
            color: "#1e293b",
            background: "#ffffff",
            boxSizing: "border-box",
            outline: "none",
            transition: "border-color 0.2s, box-shadow 0.2s",
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            setIsOpen((prev) => !prev);
            inputRef.current?.focus();
          }}
          style={{
            position: "absolute",
            right: "2px",
            top: "2px",
            bottom: "2px",
            width: "30px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#64748b",
            fontSize: "10px",
            userSelect: "none",
          }}
          title="Toggle dropdown"
        >
          {isOpen ? "▲" : "▼"}
        </button>
      </div>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: "220px",
            overflowY: "auto",
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: "6px",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
            zIndex: 1050,
            padding: "4px 0",
          }}
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt, idx) => {
              const isSelected = opt.toLowerCase() === (value || "").toLowerCase();
              const isHighlighted = idx === highlightedIndex;
              return (
                <div
                  key={opt}
                  onClick={() => handleSelect(opt)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  style={{
                    padding: "8px 12px",
                    fontSize: "13px",
                    cursor: "pointer",
                    background: isHighlighted
                      ? "#eff6ff"
                      : isSelected
                        ? "#f8fafc"
                        : "transparent",
                    color: isSelected ? "#0061f2" : "#1e293b",
                    fontWeight: isSelected ? 600 : 400,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>{opt}</span>
                  {isSelected && <span style={{ color: "#0061f2", fontSize: "12px" }}>✓</span>}
                </div>
              );
            })
          ) : (
            <div
              style={{
                padding: "8px 12px",
                fontSize: "12.5px",
                color: "#64748b",
                fontStyle: "italic",
              }}
            >
              {value ? `Use "${value}" as custom city` : "No cities available"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TechnicalTasksPageContent() {
  // Tabs & Data State
  const [activeTab, setActiveTab] = useState<string>("all");
  const [tasks, setTasks] = useState<TechnicalTask[]>([]);
  const [counts, setCounts] = useState<TechnicalTaskCounts>({
    all: 0,
    pending: 0,
    approved: 0,
    completed: 0,
    cancel: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("created_at");
  const [sortDesc, setSortDesc] = useState<boolean>(true);

  // Top Filter Panel (identical to Companies.tsx)
  const [filterOpen, setFilterOpen] = useState<boolean>(false);
  const [filterDateRange, setFilterDateRange] = useState<string>("");
  const [filterTaskType, setFilterTaskType] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterCity, setFilterCity] = useState<string>("");
  const [filterCallType, setFilterCallType] = useState<string>("");
  const [filterServiceType, setFilterServiceType] = useState<string>("");
  const [filterTechnician, setFilterTechnician] = useState<string>("");
  const [filterPriority, setFilterPriority] = useState<string>("");

  // Master lookups
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const [technicianOptions, setTechnicianOptions] = useState<string[]>([]);
  const [callTypeOptions, setCallTypeOptions] = useState<string[]>([]);
  const { options: optionGroups } = useOptions(TECHNICAL_TASK_OPTION_GROUPS);
  const TASK_TYPE_OPTIONS = optionValues(optionGroups, "technical_task.task_type");
  const CALL_TYPE_OPTIONS = callTypeOptions;
  const PRIORITY_OPTIONS = optionValues(optionGroups, "technical_task.priority");
  const SERVICE_TYPE_OPTIONS = optionValues(optionGroups, "technical_task.service_type");
  const baseStatusOptions = optionValues(optionGroups, "technical_task.status");
  const STATUS_OPTIONS = useMemo(() => {
    const list = baseStatusOptions.length > 0 ? [...baseStatusOptions] : ["Pending", "Approved", "Completed", "Cancel"];
    if (!list.some((s) => s.toLowerCase() === "payment pending")) {
      const compIdx = list.findIndex((s) => s.toLowerCase() === "completed");
      if (compIdx !== -1) {
        list.splice(compIdx, 0, "Payment Pending");
      } else {
        list.push("Payment Pending");
      }
    }
    return list;
  }, [baseStatusOptions]);

  // Feedback and Error Handling States
  const [apiError, setApiError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const showSuccess = useCallback((msg: string) => {
    setActionSuccess(msg);
    setActionError(null);
    setTimeout(() => {
      setActionSuccess((curr) => (curr === msg ? null : curr));
    }, 4000);
  }, []);

  // Freeze Columns State (Default to 3 frozen columns on the left: Checkbox, Sr. No, Company)
  const [pinnedCols, setPinnedCols] = useState<Record<number, "left" | "right">>({
    0: "left",
    1: "left",
    2: "left",
  });
  const [pinMenuOpen, setPinMenuOpen] = useState<boolean>(false);
  const pinMenuRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [colLeftOffsets, setColLeftOffsets] = useState<Record<number, number>>({});
  const [colRightOffsets, setColRightOffsets] = useState<Record<number, number>>({});

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Header dropdown menus
  const [impExpOpen, setImpExpOpen] = useState<boolean>(false);
  const [bulkActionsOpen, setBulkActionsOpen] = useState<boolean>(false);
  const impExpRef = useRef<HTMLDivElement>(null);
  const bulkActionsRef = useRef<HTMLDivElement>(null);

  // Action Menu Dropdown inside table cell
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  // Modals & Stage Management
  const [detailTask, setDetailTask] = useState<TechnicalTask | null>(null);
  const [addEditModalOpen, setAddEditModalOpen] = useState<boolean>(false);
  const [editingTask, setEditingTask] = useState<TechnicalTask | null>(null);
  const [statusModalTask, setStatusModalTask] = useState<TechnicalTask | null>(null);
  const [newStatusValue, setNewStatusValue] = useState<string>("Approved");
  const [statusRemarks, setStatusRemarks] = useState<string>("");
  const [statusAllottedTo, setStatusAllottedTo] = useState<string>("");
  const [statusVisitDate, setStatusVisitDate] = useState<string>("");
  const [statusPaymentCollected, setStatusPaymentCollected] = useState<boolean>(true);
  const [statusPaymentMode, setStatusPaymentMode] = useState<string>("Company Acc");
  const [statusScreenshotFile, setStatusScreenshotFile] = useState<File | null>(null);
  const [statusScreenshotUrl, setStatusScreenshotUrl] = useState<string>("");
  const [uploadingScreenshot, setUploadingScreenshot] = useState<boolean>(false);

  // Cancellation Modal State (Mandatory Remarks)
  const [cancelModalTask, setCancelModalTask] = useState<TechnicalTask | null>(null);
  const [cancelRemarks, setCancelRemarks] = useState<string>("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [submittingCancel, setSubmittingCancel] = useState<boolean>(false);

  // Call Logs Modal State
  const [callLogModalTask, setCallLogModalTask] = useState<TechnicalTask | null>(null);
  const [callLogsList, setCallLogsList] = useState<TechnicalTaskCallLog[]>([]);
  const [loadingCallLogs, setLoadingCallLogs] = useState<boolean>(false);
  const [newCallLogType, setNewCallLogType] = useState<string>("Telecall");
  const [newCallLogRemarks, setNewCallLogRemarks] = useState<string>("");
  const [callLogError, setCallLogError] = useState<string | null>(null);
  const [submittingCallLog, setSubmittingCallLog] = useState<boolean>(false);

  // Product Autocomplete State for Machine & Model
  const [productSuggestions, setProductSuggestions] = useState<Array<{ id: string; product_name: string; product_code?: string }>>([]);
  const [showProductDropdown, setShowProductDropdown] = useState<boolean>(false);
  const productSearchRef = useRef<HTMLDivElement>(null);

  // Form State for Add / Edit
  const [formData, setFormData] = useState<TechnicalTaskCreatePayload>({
    company_name: "",
    task_type: "",
    city: "",
    third_party: "",
    third_party_city: "",
    third_party_contact_name: "",
    third_party_contact_phone: "",
    priority: "A",
    machine_model: "",
    task_description: "",
    contact_person_name: "",
    contact_designation: "",
    contact_phone: "",
    service_type: "",
    service_charge: 0,
    payment_terms: "",
    call_type: "",
    creator_remarks: "",
    task_allotted_to: "",
    payment_status: "Pending",
    status: "Pending",
  });
  const [formSubmitting, setFormSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Close menus on document click
  useEffect(() => {
    function handleDocClick(e: MouseEvent) {
      if (pinMenuRef.current && !pinMenuRef.current.contains(e.target as Node)) {
        setPinMenuOpen(false);
      }
      if (impExpRef.current && !impExpRef.current.contains(e.target as Node)) {
        setImpExpOpen(false);
      }
      if (bulkActionsRef.current && !bulkActionsRef.current.contains(e.target as Node)) {
        setBulkActionsOpen(false);
      }
      if (productSearchRef.current && !productSearchRef.current.contains(e.target as Node)) {
        setShowProductDropdown(false);
      }
      setOpenActionMenuId(null);
    }
    document.addEventListener("click", handleDocClick);
    return () => document.removeEventListener("click", handleDocClick);
  }, []);

  // Load lookups from their master tables (no hardcoded fallbacks)
  useEffect(() => {
    async function loadLookups() {
      try {
        const cityRes = await apiGet<any[]>("/masters/cities?page=1&page_size=200&status=active");
        setCityOptions(cityRes?.data?.map((c: any) => c.name || c.city_name).filter(Boolean) || []);
      } catch (err) {
        console.warn("Could not load cities lookup:", err);
        setCityOptions([]);
      }

      try {
        const techRes = await apiGet<any[]>("/masters/technicians?page=1&page_size=100&status=active");
        setTechnicianOptions(techRes?.data?.map((t: any) => t.name || t.technician_name).filter(Boolean) || []);
      } catch (err) {
        console.warn("Could not load technicians lookup:", err);
        setTechnicianOptions([]);
      }

      try {
        const callRes = await apiGet<any[]>("/masters/call-types?page=1&page_size=100&status=active");
        setCallTypeOptions(callRes?.data?.map((c: any) => c.name).filter(Boolean) || []);
      } catch (err) {
        console.warn("Could not load call types lookup:", err);
        setCallTypeOptions([]);
      }
    }
    loadLookups();
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch counts
  const loadCounts = useCallback(async () => {
    try {
      const c = await fetchTechnicalTaskCounts();
      setCounts(c);
    } catch (err) {
      console.error("Error fetching counts:", err);
    }
  }, []);

  // Fetch Tasks
  const loadTasks = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    try {
      const params: TechnicalTaskListParams = {
        page: currentPage,
        page_size: pageSize,
        sort_by: sortBy,
        sort_desc: sortDesc,
      };

      if (filterStatus) {
        params.status = filterStatus.toLowerCase();
      } else if (activeTab && activeTab.toLowerCase() !== "all") {
        params.status = activeTab.toLowerCase();
      }
      if (debouncedSearch) {
        params.search = debouncedSearch;
      }
      if (filterCity) {
        params.city = filterCity;
      }
      if (filterTaskType) {
        params.task_type = filterTaskType;
      }
      if (filterCallType) {
        params.call_type = filterCallType;
      }
      if (filterTechnician) {
        params.task_allotted_to = filterTechnician;
      }
      if (filterPriority) {
        params.priority = filterPriority;
      }

      const res = await fetchTechnicalTasks(params);
      setTasks(res.data || []);
      const total =
        res.meta?.pagination?.total_records ??
        res.meta?.pagination?.total_items ??
        (res.meta as any)?.total ??
        (Array.isArray(res.data) ? res.data.length : 0);
      setTotalCount(total);
    } catch (err) {
      console.error("Error fetching technical tasks:", err);
      setApiError(err);
    } finally {
      setLoading(false);
    }
  }, [
    currentPage,
    pageSize,
    sortBy,
    sortDesc,
    activeTab,
    debouncedSearch,
    filterCity,
    filterTaskType,
    filterCallType,
    filterTechnician,
    filterPriority,
    filterStatus,
  ]);

  useEffect(() => {
    loadTasks();
    loadCounts();
  }, [loadTasks, loadCounts]);

  // Sorting
  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortDesc(!sortDesc);
    } else {
      setSortBy(field);
      setSortDesc(false);
    }
    setCurrentPage(1);
  };

  // Selection
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const allIds = new Set(tasks.map((t) => t.id));
      setSelectedIds(allIds);
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  // Bulk Delete
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const confirmed = window.confirm(
      `Are you sure you want to delete ${count} selected technical task${count > 1 ? "s" : ""}?`
    );
    if (!confirmed) return;

    try {
      setActionError(null);
      await bulkDeleteTechnicalTasks(Array.from(selectedIds));
      showSuccess(`Successfully deleted ${count} technical task${count > 1 ? "s" : ""}.`);
      setSelectedIds(new Set());
      await Promise.all([loadTasks(), loadCounts()]);
    } catch (err) {
      setActionError(err);
    }
  };

  // Bulk Status Change
  const handleBulkStatusChange = async (targetStatus: string) => {
    if (selectedIds.size === 0) return;
    try {
      setActionError(null);
      for (const id of Array.from(selectedIds)) {
        await updateTechnicalTaskStatus(id, targetStatus, `Bulk update to ${targetStatus}`);
      }
      showSuccess(`Successfully updated ${selectedIds.size} task${selectedIds.size > 1 ? "s" : ""} to ${targetStatus}.`);
      setSelectedIds(new Set());
      await Promise.all([loadTasks(), loadCounts()]);
    } catch (err) {
      setActionError(err);
    }
  };

  // Single Delete
  const handleDeleteSingle = async (id: string) => {
    const confirmed = window.confirm("Are you sure you want to delete this technical task?");
    if (!confirmed) return;

    try {
      setActionError(null);
      await deleteTechnicalTask(id);
      showSuccess("Technical task deleted successfully.");
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await Promise.all([loadTasks(), loadCounts()]);
    } catch (err) {
      setActionError(err);
    }
  };

  // CSV Export
  const handleExportCsv = () => {
    if (!tasks.length) {
      alert("No tasks to export.");
      return;
    }
    const headers = [
      "Sr No",
      "Company Name",
      "Task Type",
      "City",
      "Third Party",
      "Priority",
      "Machine & Model",
      "Description",
      "Contact Person",
      "Contact Designation",
      "Contact Phone",
      "Task Created Date",
      "Task Created By",
      "Service Type",
      "Service Charge",
      "Call Type",
      "Task Approved By",
      "Task Approved Date",
      "Task Allotted To",
      "Payment Status",
      "Status",
    ];

    const csvRows = tasks.map((t, idx) => [
      idx + 1,
      `"${(t.company_name || "").replace(/"/g, '""')}"`,
      `"${(t.task_type || "").replace(/"/g, '""')}"`,
      `"${(t.city || "").replace(/"/g, '""')}"`,
      `"${(t.third_party || "").replace(/"/g, '""')}"`,
      `"${(t.priority || "").replace(/"/g, '""')}"`,
      `"${(t.machine_model || "").replace(/"/g, '""')}"`,
      `"${(t.task_description || "").replace(/"/g, '""')}"`,
      `"${(t.contact_person_name || "").replace(/"/g, '""')}"`,
      `"${(t.contact_designation || "").replace(/"/g, '""')}"`,
      `"${(t.contact_phone || "").replace(/"/g, '""')}"`,
      `"${(t.task_created_date || "").replace(/"/g, '""')}"`,
      `"${(t.created_by_name || "").replace(/"/g, '""')}"`,
      `"${(t.service_type || "").replace(/"/g, '""')}"`,
      t.service_charge || 0,
      `"${(t.call_type || "").replace(/"/g, '""')}"`,
      `"${(t.task_approved_by || "").replace(/"/g, '""')}"`,
      `"${(t.task_approved_date || "").replace(/"/g, '""')}"`,
      `"${(t.task_allotted_to || "").replace(/"/g, '""')}"`,
      `"${(t.payment_status || "").replace(/"/g, '""')}"`,
      `"${(t.status || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(","), ...csvRows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `technical_tasks_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Product Search handler for Machine & Model
  const handleProductSearch = async (val: string) => {
    if (!val.trim()) {
      setProductSuggestions([]);
      setShowProductDropdown(false);
      return;
    }
    try {
      const res = await apiGet<any[] | { items: any[] }>(
        `/masters/products?is_active=true&search=${encodeURIComponent(val.trim())}&limit=20`
      );
      const prods = Array.isArray(res?.data) ? res.data : (res?.data?.items || []);
      const mapped = prods.map((p: any) => ({
        id: String(p.id),
        product_name: String(p.product_name || p.name || ""),
        product_code: String(p.product_code || ""),
      }));
      setProductSuggestions(mapped);
      setShowProductDropdown(mapped.length > 0);
    } catch {
      setProductSuggestions([]);
      setShowProductDropdown(false);
    }
  };

  // Open Call Logs modal
  const handleOpenCallLogs = async (task: TechnicalTask) => {
    setCallLogModalTask(task);
    setNewCallLogRemarks("");
    setNewCallLogType("Telecall");
    setCallLogError(null);
    setLoadingCallLogs(true);
    try {
      const logs = await fetchTaskCallLogs(task.id);
      setCallLogsList(logs);
    } catch (err: any) {
      setCallLogError(errorMessage(err));
    } finally {
      setLoadingCallLogs(false);
    }
  };

  // Submit New Call Log
  const handleCreateCallLogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!callLogModalTask) return;
    if (!newCallLogRemarks.trim()) {
      setCallLogError("Remarks / Feedback by technician is required.");
      return;
    }
    setSubmittingCallLog(true);
    setCallLogError(null);
    try {
      await createTaskCallLog(callLogModalTask.id, {
        call_type: newCallLogType,
        remarks: newCallLogRemarks.trim(),
      });
      showSuccess("Call log recorded successfully.");
      setNewCallLogRemarks("");
      const refreshed = await fetchTaskCallLogs(callLogModalTask.id);
      setCallLogsList(refreshed);
    } catch (err: any) {
      setCallLogError(errorMessage(err));
    } finally {
      setSubmittingCallLog(false);
    }
  };

  // Cancel Task Submit with Mandatory Remarks
  const handleCancelTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelModalTask) return;
    if (!cancelRemarks.trim()) {
      setCancelError("Remarks are mandatory when cancelling a technical task.");
      return;
    }
    setSubmittingCancel(true);
    setCancelError(null);
    try {
      await updateTechnicalTaskStatus(cancelModalTask.id, "Cancel", cancelRemarks.trim(), {
        cancel_remarks: cancelRemarks.trim(),
      });
      showSuccess(`Task cancelled for ${cancelModalTask.company_name}.`);
      setCancelModalTask(null);
      setCancelRemarks("");
      await Promise.all([loadTasks(), loadCounts()]);
    } catch (err: any) {
      setCancelError(errorMessage(err));
    } finally {
      setSubmittingCancel(false);
    }
  };

  // Stage Modal Openers
  const openApproveModal = (task: TechnicalTask) => {
    setStatusModalTask(task);
    setNewStatusValue("Approved");
    setStatusAllottedTo(task.task_allotted_to || "");
    setStatusVisitDate(task.scheduled_visit_date || task.task_approved_date || "");
    setStatusRemarks(task.approver_remarks || "");
  };

  const openCompleteModal = (task: TechnicalTask) => {
    setStatusModalTask(task);
    setNewStatusValue("Completed");
    setStatusPaymentCollected(task.payment_status?.toLowerCase() === "paid");
    setStatusPaymentMode(task.payment_mode || "Company Acc");
    setStatusScreenshotUrl(task.payment_screenshot || "");
    setStatusScreenshotFile(null);
    setStatusRemarks(task.approver_remarks || "");
  };

  const openReopenModal = (task: TechnicalTask) => {
    setStatusModalTask(task);
    setNewStatusValue("Approved");
    setStatusAllottedTo(task.task_allotted_to || "");
    setStatusVisitDate("");
    setStatusRemarks("");
  };

  // Open Add New Task
  const handleOpenAdd = () => {
    setEditingTask(null);
    setFormData({
      company_name: "",
      task_type: "",
      city: "",
      third_party: "",
      third_party_city: "",
      third_party_contact_name: "",
      third_party_contact_phone: "",
      priority: "A",
      machine_model: "",
      task_description: "",
      contact_person_name: "",
      contact_designation: "",
      contact_phone: "",
      service_type: "",
      service_charge: 0,
      payment_terms: "",
      call_type: "",
      creator_remarks: "",
      task_allotted_to: "",
      payment_status: "Pending",
      status: "Pending",
    });
    setFormError(null);
    setShowProductDropdown(false);
    setAddEditModalOpen(true);
  };

  // Open Edit Task
  const handleOpenEdit = (task: TechnicalTask) => {
    setEditingTask(task);
    setFormData({
      company_name: task.company_name,
      task_type: task.task_type,
      city: task.city,
      third_party: task.third_party || "",
      third_party_city: task.third_party_city || "",
      third_party_contact_name: task.third_party_contact_name || "",
      third_party_contact_phone: task.third_party_contact_phone || "",
      priority: task.priority || "A",
      machine_model: task.machine_model,
      task_description: task.task_description || "",
      contact_person_name: task.contact_person_name || "",
      contact_designation: task.contact_designation || "",
      contact_phone: task.contact_phone || "",
      service_type: task.service_type,
      service_charge: task.service_charge || 0,
      payment_terms: task.payment_terms || "",
      call_type: task.call_type,
      creator_remarks: task.creator_remarks || "",
      task_allotted_to: task.task_allotted_to || "",
      payment_status: task.payment_status || "Pending",
      status: task.status,
    });
    setFormError(null);
    setShowProductDropdown(false);
    setAddEditModalOpen(true);
  };

  // Submit Form (Add or Edit)
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.company_name.trim()) {
      setFormError("Company Name is required.");
      return;
    }
    if (!formData.contact_phone?.trim()) {
      setFormError("Contact Number is required.");
      return;
    }
    if (!formData.task_type || formData.task_type === "Select") {
      setFormError("Task Type is required.");
      return;
    }
    if (
      formData.task_type === "Onsite Visit - Third-Party Location" &&
      !formData.third_party_city?.trim() &&
      !formData.third_party?.trim()
    ) {
      setFormError("Third-Party City is required for third-party onsite visits.");
      return;
    }
    if (!formData.machine_model.trim()) {
      setFormError("Machine & Model is required.");
      return;
    }
    if (!formData.task_description?.trim()) {
      setFormError("Description (Nature Of Complain) is required.");
      return;
    }
    if (!formData.service_type || formData.service_type === "Select") {
      setFormError("Service Type is required.");
      return;
    }
    if (formData.service_type === "Chargeable" && !formData.payment_terms?.trim()) {
      setFormError("Payment Terms are required for chargeable tasks.");
      return;
    }
    if (!formData.call_type || formData.call_type === "Select") {
      setFormError("Call Type is required.");
      return;
    }

    setFormSubmitting(true);
    setFormError(null);
    try {
      if (editingTask) {
        await updateTechnicalTask(editingTask.id, formData);
        showSuccess("Technical task updated successfully.");
      } else {
        await createTechnicalTask(formData);
        showSuccess("New technical task created successfully.");
      }
      setAddEditModalOpen(false);
      await Promise.all([loadTasks(), loadCounts()]);
    } catch (err: any) {
      setFormError(errorMessage(err));
    } finally {
      setFormSubmitting(false);
    }
  };

  // Status Change Submit
  const handleStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModalTask) return;

    try {
      setActionError(null);
      let targetStatus = newStatusValue;
      let targetPaymentStatus: string | undefined = undefined;
      let uploadedScreenshotUrl = statusScreenshotUrl;

      if (
        newStatusValue === "Completed" &&
        (statusModalTask.service_type === "Chargeable" || (statusModalTask.service_charge ?? 0) > 0)
      ) {
        if (!statusPaymentCollected) {
          targetStatus = "Payment Pending";
          targetPaymentStatus = "Pending";
        } else {
          targetPaymentStatus = "Paid";
          if (statusScreenshotFile) {
            setUploadingScreenshot(true);
            try {
              const uploadRes = await uploadPaymentScreenshot(statusScreenshotFile);
              uploadedScreenshotUrl = uploadRes.file_url;
            } catch (upErr) {
              console.warn("Screenshot upload warning:", upErr);
            } finally {
              setUploadingScreenshot(false);
            }
          }
        }
      }

      await updateTechnicalTaskStatus(statusModalTask.id, targetStatus, statusRemarks, {
        task_allotted_to: targetStatus === "Approved" ? (statusAllottedTo || undefined) : undefined,
        task_approved_date: targetStatus === "Approved" ? (statusVisitDate || undefined) : undefined,
        scheduled_visit_date: targetStatus === "Approved" ? (statusVisitDate || undefined) : undefined,
        payment_status: targetPaymentStatus,
        payment_mode: targetPaymentStatus === "Paid" ? statusPaymentMode : undefined,
        payment_screenshot: targetPaymentStatus === "Paid" ? (uploadedScreenshotUrl || undefined) : undefined,
      });

      showSuccess(`Status updated to ${targetStatus} for ${statusModalTask.company_name}.`);
      setStatusModalTask(null);
      setStatusRemarks("");
      setStatusAllottedTo("");
      setStatusVisitDate("");
      setStatusScreenshotFile(null);
      setStatusScreenshotUrl("");
      await Promise.all([loadTasks(), loadCounts()]);
    } catch (err) {
      setActionError(err);
    }
  };

  // Freeze Columns Logic (Exact match to Companies.tsx)
  const togglePin = useCallback((colIdx: number) => {
    setPinnedCols((prev) => {
      const next = { ...prev };
      if (next[colIdx]) {
        delete next[colIdx];
      } else {
        if (colIdx >= 17) {
          next[colIdx] = "right";
        } else {
          next[colIdx] = "left";
        }
      }
      return next;
    });
  }, []);

  const displayOrder = useMemo(() => {
    const allIndices = Array.from({ length: TOTAL_COLS_COUNT }, (_, i) => i);
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

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => updateOffsets());
      ro.observe(tableEl);
      return () => ro.disconnect();
    }
  }, [displayOrder, pinnedCols, tasks, loading]);

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
  }, [displayOrder, pinnedCols, colLeftOffsets, colRightOffsets]);

  // Reset Filters
  const handleResetFilters = () => {
    setFilterDateRange("");
    setFilterTaskType("");
    setFilterStatus("");
    setFilterCity("");
    setFilterCallType("");
    setFilterServiceType("");
    setFilterTechnician("");
    setFilterPriority("");
    setCurrentPage(1);
  };

  // Search / Apply Filters
  const handleSearchFilters = () => {
    setCurrentPage(1);
    loadTasks();
  };

  // Badges
  const renderTaskTypeBadge = (type: string) => {
    if (!type) return <span>—</span>;
    let cls = "badge-tech";
    const lower = type.toLowerCase();
    if (lower.includes("in-house") || lower.includes("inhouse")) {
      cls += " badge-inhouse";
    } else if (lower.includes("third-party") || lower.includes("third party")) {
      cls += " badge-onsite-third-party";
    } else if (lower.includes("onsite")) {
      cls += " badge-onsite";
    } else if (lower.includes("telecall")) {
      cls += " badge-telecall";
    }
    return <span className={cls}>{type}</span>;
  };

  const renderServiceTypeBadge = (task: TechnicalTask) => {
    if (task.service_type === "Free") {
      return <span className="badge-tech badge-free">Free</span>;
    }
    return (
      <div className="badge-chargeable-box">
        <span className="badge-tech badge-chargeable">Chargeable</span>
        {task.service_charge !== undefined && task.service_charge !== null && (
          <span className="charge-amount">
            ₹ {task.service_charge.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </span>
        )}
      </div>
    );
  };

  const renderStatusBadge = (task: TechnicalTask) => {
    const s = task.status.toLowerCase();
    let badgeClass = "badge-tech";
    if (s === "pending") badgeClass += " badge-status-pending";
    else if (s === "approved") badgeClass += " badge-status-approved";
    else if (s === "payment_pending" || s === "payment pending") badgeClass += " badge-status-payment-pending";
    else if (s === "completed") badgeClass += " badge-status-completed";
    else if (s === "cancel") badgeClass += " badge-status-cancel";

    return (
      <div className="status-wrapper">
        <span className={badgeClass}>{task.status}</span>
        {s === "completed" && task.completed_date && (
          <span className="status-date">{task.completed_date}</span>
        )}
      </div>
    );
  };

  const renderPaymentBadge = (status?: string | null) => {
    if (!status || status === "-") return <span>—</span>;
    const lower = status.toLowerCase();
    if (lower === "pending") {
      return <span className="badge-tech badge-payment-pending">Pending</span>;
    }
    if (lower === "paid") {
      return <span className="badge-tech badge-payment-paid">Paid</span>;
    }
    return <span>{status}</span>;
  };

  const paginationMeta = {
    current_page: currentPage,
    page_size: pageSize,
    total_records: totalCount,
    total_pages: Math.ceil(totalCount / pageSize) || 1,
    has_previous: currentPage > 1,
    has_next: currentPage < (Math.ceil(totalCount / pageSize) || 1),
  };

  const selectStyle: React.CSSProperties = {
    width: "100%",
    height: "38px",
    borderRadius: "5px",
    border: "1px solid #cbd5e1",
    padding: "0 28px 0 10px",
    fontSize: "13.5px",
    color: "#334155",
    background: "#ffffff url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>\") no-repeat right 10px center",
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
    boxSizing: "border-box",
    outline: "none",
    cursor: "pointer",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: "38px",
    borderRadius: "5px",
    border: "1px solid #cbd5e1",
    padding: "0 12px",
    fontSize: "13.5px",
    color: "#334155",
    boxSizing: "border-box",
    outline: "none",
  };

  const fieldLabelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "12px",
    fontWeight: 600,
    color: "#475569",
    marginBottom: "6px",
  };


  return (
    <AppShell activeKey="technical-tasks">
      <main className="page">
        {/* Breadcrumb Trail matching Companies.tsx */}
        <Breadcrumb trail={["Technical Task List"]} />

        {/* Page Header (Exact Match to Companies.tsx) */}
        <div className="page-header">
          <div>
            <h1>Technical Task List</h1>
            <div className="page-subtitle">
              Technical tasks list, client visits, repair calls, and technician allotting.
            </div>
          </div>
          <div className="page-header-actions" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {/* Filter Toggle Button */}
            <button
              type="button"
              id="technical-tasks-filter-toggle-btn"
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
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
            </button>

            {/* + ADD NEW */}
            <button
              type="button"
              className="btn btn-add-new"
              onClick={handleOpenAdd}
            >
              + ADD NEW
            </button>

            {/* Imp / Exp ▾ */}
            <div ref={impExpRef} style={{ position: "relative", display: "inline-block" }}>
              <button
                type="button"
                className="btn btn-imp-exp"
                onClick={(e) => {
                  e.stopPropagation();
                  setImpExpOpen((v) => !v);
                }}
              >
                Imp / Exp ▾
              </button>
              {impExpOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    marginTop: "4px",
                    background: "#ffffff",
                    borderRadius: "6px",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
                    border: "1px solid #e2e8f0",
                    zIndex: 1000,
                    minWidth: "160px",
                    overflow: "hidden",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setImpExpOpen(false);
                      handleExportCsv();
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 14px",
                      fontSize: "13.5px",
                      color: "#334155",
                      fontWeight: 600,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    📤 Export to CSV
                  </button>
                </div>
              )}
            </div>

            {/* Bulk Actions ▾ */}
            <div ref={bulkActionsRef} style={{ position: "relative", display: "inline-block" }}>
              <button
                type="button"
                className="btn btn-bulk-actions"
                onClick={(e) => {
                  e.stopPropagation();
                  setBulkActionsOpen((v) => !v);
                }}
              >
                Bulk Actions {selectedIds.size > 0 ? `(${selectedIds.size})` : ""} ▾
              </button>
              {bulkActionsOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    marginTop: "4px",
                    background: "#ffffff",
                    borderRadius: "6px",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
                    border: "1px solid #e2e8f0",
                    zIndex: 1000,
                    minWidth: "190px",
                    overflow: "hidden",
                  }}
                >
                  {selectedIds.size === 0 ? (
                    <div style={{ padding: "10px 14px", fontSize: "12.5px", color: "#64748b", fontStyle: "italic" }}>
                      Select 1 or more tasks first
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setBulkActionsOpen(false);
                          handleBulkStatusChange("Approved");
                        }}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "10px 14px",
                          fontSize: "13.5px",
                          color: "#0284c7",
                          fontWeight: 600,
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        ✓ Bulk Mark Approved ({selectedIds.size})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBulkActionsOpen(false);
                          handleBulkStatusChange("Completed");
                        }}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "10px 14px",
                          fontSize: "13.5px",
                          color: "#059669",
                          fontWeight: 600,
                          background: "none",
                          border: "none",
                          borderTop: "1px solid #f1f5f9",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        🏁 Bulk Mark Completed ({selectedIds.size})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBulkActionsOpen(false);
                          handleBulkDelete();
                        }}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "10px 14px",
                          fontSize: "13.5px",
                          color: "#dc2626",
                          fontWeight: 600,
                          background: "none",
                          border: "none",
                          borderTop: "1px solid #f1f5f9",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        🗑️ Bulk Delete ({selectedIds.size})
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Alerts & Feedback Banner */}
        <div style={{ marginBottom: "16px" }}>
          <Banner error={apiError || actionError} success={actionSuccess} />
        </div>

        {/* TOP FILTER PANEL - EXACT MATCH TO COMPANIES SCREENSHOT */}
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
              {/* Row 1: Date Range | Task Type | Current Status */}
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
                  placeholder="e.g. 17-09-2026"
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
                  Task Type
                </label>
                <select
                  value={filterTaskType}
                  onChange={(e) => setFilterTaskType(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">All</option>
                  {TASK_TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                  Current Status
                </label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">All</option>
                  {STATUS_OPTIONS.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              {/* Row 2: City | Call Type | Service Type */}
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                  City
                </label>
                <TypableCombobox
                  value={filterCity}
                  onChange={(city) => setFilterCity(city)}
                  options={cityOptions}
                  placeholder="All / Select or type city..."
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                  Call Type
                </label>
                <select
                  value={filterCallType}
                  onChange={(e) => setFilterCallType(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">All</option>
                  {CALL_TYPE_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c === "Trial" ? "trial" : c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                  Service Type
                </label>
                <select
                  value={filterServiceType}
                  onChange={(e) => setFilterServiceType(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">All</option>
                  {SERVICE_TYPE_OPTIONS.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              {/* Row 3: Technician | Priority | Buttons */}
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                  Task Allotted To
                </label>
                <select
                  value={filterTechnician}
                  onChange={(e) => setFilterTechnician(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">All</option>
                  {technicianOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                  Priority
                </label>
                <select
                  value={filterPriority}
                  onChange={(e) => setFilterPriority(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">All</option>
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
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

        {/* CARD CONTAINER (EXACT MATCH TO COMPANIES SCREENSHOT) */}
        <div className="card">
          {/* Active / Inactive / Status Top Tabs */}
          <div style={{ display: "flex", gap: "20px", borderBottom: "1px solid #e2e8f0", padding: "6px 16px 0", overflowX: "auto" }}>
            {[
              { key: "all", label: `All (${counts.all})` },
              { key: "pending", label: `Pending (${counts.pending})` },
              { key: "approved", label: `Approved (${counts.approved})` },
              { key: "payment_pending", label: `Payment Pending (${counts.payment_pending ?? 0})` },
              { key: "completed", label: `Completed (${counts.completed})` },
              { key: "cancel", label: `Cancel (${counts.cancel})` },
            ].map((tab) => {
              const isActive = activeTab.toLowerCase() === tab.key.toLowerCase();
              return (
                <button
                  key={tab.key}
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    borderBottom: isActive ? "2.5px solid #0061f2" : "2.5px solid transparent",
                    color: isActive ? "#0061f2" : "#64748b",
                    fontWeight: 700,
                    fontSize: "13.5px",
                    paddingBottom: "6px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                  onClick={() => {
                    setCurrentPage(1);
                    setSelectedIds(new Set());
                    setFilterStatus("");
                    setActiveTab(tab.key);
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Sub-toolbar: Items per page, Freeze Columns, Search */}
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

              {/* Freeze Columns Popover Button */}
              <div ref={pinMenuRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPinMenuOpen((v) => !v);
                  }}
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
                    onClick={(e) => e.stopPropagation()}
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
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#475569", marginBottom: "8px", borderBottom: "1px solid #f1f5f9", paddingBottom: "6px" }}>
                      Toggle Frozen Columns
                    </div>
                    <div style={{ maxHeight: "220px", overflowY: "auto", paddingRight: "4px" }}>
                      {TECHNICAL_TASK_COLUMN_LABELS.map((label, idx) => {
                        if (!label) return null;
                        const isPinned = Boolean(pinnedCols[idx]);
                        return (
                          <label key={label} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer", padding: "4px 0" }}>
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

            {/* Search Input */}
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: "320px", padding: "8px 36px 8px 14px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
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

          {/* TABLE CONTAINER */}
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
                            checked={tasks.length > 0 && tasks.every((t) => selectedIds.has(t.id))}
                            onChange={handleSelectAll}
                            style={{ cursor: "pointer", width: "16px", height: "16px" }}
                          />
                        </th>
                      );
                    }

                    const label = TECHNICAL_TASK_COLUMN_LABELS[idx];
                    const isPinned = Boolean(pinnedCols[idx]);
                    const isSrNo = idx === 1;
                    const isAction = idx === 17;

                    let sortField = "";
                    if (idx === 2) sortField = "company_name";
                    else if (idx === 4) sortField = "city";
                    else if (idx === 6) sortField = "priority";
                    else if (idx === 16) sortField = "status";

                    const isSorted = sortField && sortBy === sortField;

                    return (
                      <th
                        key={`col-${idx}-${label}`}
                        style={{
                          ...(isSrNo ? { width: "75px", minWidth: "75px", maxWidth: "85px", textAlign: "center" } : isAction ? { width: "70px", minWidth: "70px", textAlign: "center" } : {}),
                          ...getFreezeStyle(idx, true),
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: isAction || isSrNo ? "center" : "space-between", gap: "4px" }}>
                          {sortField ? (
                            <div
                              onClick={() => handleSort(sortField)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: isSrNo ? "center" : "flex-start",
                                gap: "5px",
                                cursor: "pointer",
                                userSelect: "none",
                                flex: 1,
                                minWidth: 0,
                                padding: "2px 0",
                              }}
                              title={`Click to sort by ${label}`}
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
                                  {sortDesc ? "▼" : "▲"}
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
                          ) : (
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {label}
                            </span>
                          )}

                          {!isAction && !isSrNo && (
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
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TechnicalTaskSkeletonRows
                    count={Math.min(pageSize, 6)}
                    displayOrder={displayOrder}
                    getFreezeStyle={getFreezeStyle}
                  />
                ) : apiError ? (
                  <tr>
                    <td
                      colSpan={TOTAL_COLS_COUNT}
                      style={{
                        textAlign: "left",
                        padding: "48px 24px 48px 120px",
                        background: "#fffaf0",
                      }}
                    >
                      <div
                        style={{
                          display: "inline-flex",
                          flexDirection: "column",
                          alignItems: "center",
                          textAlign: "center",
                          maxWidth: "460px",
                          gap: "12px",
                        }}
                      >
                        <div
                          style={{
                            width: "48px",
                            height: "48px",
                            borderRadius: "50%",
                            background: "#fee2e2",
                            color: "#dc2626",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "22px",
                            boxShadow: "0 2px 6px rgba(220, 38, 38, 0.15)",
                          }}
                        >
                          ⚠️
                        </div>
                        <div style={{ fontSize: "16px", fontWeight: 700, color: "#991b1b" }}>
                          Failed to Load Technical Tasks
                        </div>
                        <div style={{ fontSize: "13.5px", color: "#7f1d1d", opacity: 0.9, lineHeight: 1.4 }}>
                          {errorMessage(apiError)}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setApiError(null);
                            loadTasks();
                            loadCounts();
                          }}
                          className="btn"
                          style={{
                            marginTop: "6px",
                            backgroundColor: "#dc2626",
                            color: "#ffffff",
                            fontWeight: 600,
                            padding: "8px 20px",
                            borderRadius: "6px",
                            border: "none",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            boxShadow: "0 2px 4px rgba(220, 38, 38, 0.2)",
                          }}
                        >
                          🔄 Try Again
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : tasks.length === 0 ? (
                  <tr>
                    <td
                      colSpan={TOTAL_COLS_COUNT}
                      style={{ textAlign: "left", padding: "50px 24px 50px 120px", color: "#64748b" }}
                    >
                      {Boolean(
                        debouncedSearch ||
                        filterCity ||
                        filterTaskType ||
                        filterStatus ||
                        filterCallType ||
                        filterServiceType ||
                        filterTechnician ||
                        filterPriority ||
                        filterDateRange ||
                        activeTab !== "all"
                      ) ? (
                        <div
                          style={{
                            display: "inline-flex",
                            flexDirection: "column",
                            alignItems: "center",
                            textAlign: "center",
                            maxWidth: "460px",
                            gap: "12px",
                          }}
                        >
                          <div
                            style={{
                              width: "48px",
                              height: "48px",
                              borderRadius: "50%",
                              background: "#f1f5f9",
                              color: "#64748b",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "22px",
                            }}
                          >
                            🔍
                          </div>
                          <div style={{ fontSize: "15px", fontWeight: 600, color: "#334155" }}>
                            No technical tasks found matching your filters
                          </div>
                          <div style={{ fontSize: "13px", color: "#64748b" }}>
                            Try adjusting or resetting your search and filter parameters.
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              handleResetFilters();
                              setSearchQuery("");
                              setDebouncedSearch("");
                              setActiveTab("all");
                            }}
                            className="btn"
                            style={{
                              backgroundColor: "#0061f2",
                              color: "#ffffff",
                              fontWeight: 600,
                              padding: "7px 18px",
                              borderRadius: "6px",
                              border: "none",
                              cursor: "pointer",
                              fontSize: "13px",
                              marginTop: "4px",
                            }}
                          >
                            Clear All Filters
                          </button>
                        </div>
                      ) : (
                        <div
                          style={{
                            display: "inline-flex",
                            flexDirection: "column",
                            alignItems: "center",
                            textAlign: "center",
                            maxWidth: "460px",
                            gap: "12px",
                          }}
                        >
                          <div
                            style={{
                              width: "48px",
                              height: "48px",
                              borderRadius: "50%",
                              background: "#e0f2fe",
                              color: "#0284c7",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "22px",
                            }}
                          >
                            📋
                          </div>
                          <div style={{ fontSize: "15px", fontWeight: 600, color: "#1e293b" }}>
                            No technical tasks in the system yet
                          </div>
                          <div style={{ fontSize: "13px", color: "#64748b" }}>
                            Get started by creating your first technical task.
                          </div>
                          <button
                            type="button"
                            onClick={handleOpenAdd}
                            className="btn"
                            style={{
                              backgroundColor: "#0061f2",
                              color: "#ffffff",
                              fontWeight: 600,
                              padding: "8px 20px",
                              borderRadius: "6px",
                              border: "none",
                              cursor: "pointer",
                              fontSize: "13px",
                              marginTop: "4px",
                            }}
                          >
                            + Add New Task
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  tasks.map((task, index) => {
                    const isSelected = selectedIds.has(task.id);
                    const srNo = (currentPage - 1) * pageSize + index + 1;

                    return (
                      <tr
                        key={task.id}
                        style={{
                          background: isSelected ? "#f0f7ff" : undefined,
                        }}
                      >
                        {displayOrder.map((idx) => {
                          switch (idx) {
                            case 0:
                              return (
                                <td
                                  key="cell-0"
                                  style={{
                                    width: "40px",
                                    minWidth: "40px",
                                    maxWidth: "45px",
                                    textAlign: "center",
                                    ...getFreezeStyle(0, false),
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => handleToggleSelect(task.id)}
                                    style={{ cursor: "pointer", width: "16px", height: "16px" }}
                                  />
                                </td>
                              );
                            case 1:
                              return (
                                <td
                                  key="cell-1"
                                  style={{
                                    width: "75px",
                                    minWidth: "75px",
                                    maxWidth: "85px",
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
                                <td key="cell-2" style={{ ...getFreezeStyle(2, false) }}>
                                  <button
                                    type="button"
                                    className="company-link"
                                    onClick={() => setDetailTask(task)}
                                    style={{
                                      background: "none",
                                      border: "none",
                                      padding: 0,
                                      color: "#0061f2",
                                      fontWeight: 700,
                                      fontSize: "13.5px",
                                      textAlign: "left",
                                      cursor: "pointer",
                                    }}
                                  >
                                    {task.company_name}
                                  </button>
                                </td>
                              );
                            case 3:
                              return (
                                <td key="cell-3" style={{ ...getFreezeStyle(3, false) }}>
                                  {renderTaskTypeBadge(task.task_type)}
                                </td>
                              );
                            case 4:
                              return (
                                <td key="cell-4" style={{ ...getFreezeStyle(4, false) }}>
                                  <span style={{ fontWeight: 600, color: "#1e293b" }}>{task.city || "—"}</span>
                                </td>
                              );
                            case 5:
                              return (
                                <td key="cell-5" style={{ ...getFreezeStyle(5, false) }}>
                                  {task.third_party || "—"}
                                </td>
                              );
                            case 6:
                              return (
                                <td key="cell-6" style={{ fontWeight: 700, color: "#1e293b", ...getFreezeStyle(6, false) }}>
                                  {task.priority}
                                </td>
                              );
                            case 7:
                              return (
                                <td key="cell-7" style={{ ...getFreezeStyle(7, false) }}>
                                  {task.machine_model || "—"}
                                </td>
                              );
                            case 8:
                              return (
                                <td key="cell-8" style={{ ...getFreezeStyle(8, false) }}>
                                  <button
                                    type="button"
                                    className="btn-detail-eye"
                                    onClick={() => setDetailTask(task)}
                                    style={{
                                      background: "none",
                                      border: "none",
                                      padding: 0,
                                      color: "#0061f2",
                                      fontSize: "12.5px",
                                      fontWeight: 600,
                                      cursor: "pointer",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "4px",
                                    }}
                                  >
                                    <span>Detail</span>
                                    <span style={{ fontSize: "12px" }}>👁</span>
                                  </button>
                                </td>
                              );
                            case 9:
                              return (
                                <td key="cell-9" style={{ ...getFreezeStyle(9, false) }}>
                                  {/* EXACT MATCH TO SCREENSHOT CONTACT PERSON COLUMN */}
                                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "180px" }}>
                                    <span style={{ fontWeight: 700, color: "#1e293b", fontSize: "13px" }}>
                                      {task.contact_person_name || "—"}
                                    </span>
                                    <span style={{ fontSize: "11.5px", color: "#64748b" }}>
                                      {task.contact_designation || "—"}
                                    </span>
                                    {task.contact_phone ? (
                                      <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: "2px" }}>
                                        <a
                                          href={`tel:${task.contact_phone}`}
                                          style={{
                                            color: "#0284c7",
                                            textDecoration: "none",
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: "4px",
                                            fontSize: "12px",
                                            fontWeight: 500,
                                          }}
                                        >
                                          <span>📞</span>
                                          <span>{task.contact_phone}</span>
                                        </a>
                                        <a
                                          href={`https://wa.me/${task.contact_phone.replace(/[^0-9]/g, "")}`}
                                          target="_blank"
                                          rel="noreferrer"
                                          style={{
                                            color: "#16a34a",
                                            textDecoration: "none",
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: "4px",
                                            fontSize: "12px",
                                            fontWeight: 500,
                                          }}
                                        >
                                          <span>💬</span>
                                          <span>{task.contact_phone}</span>
                                        </a>
                                      </div>
                                    ) : (
                                      <span style={{ color: "#94a3b8" }}>—</span>
                                    )}
                                  </div>
                                </td>
                              );
                            case 10:
                              return (
                                <td key="cell-10" style={{ ...getFreezeStyle(10, false) }}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                    <span style={{ fontWeight: 600, color: "#1e293b", fontSize: "12.5px" }}>
                                      {task.task_created_date}
                                    </span>
                                    <span style={{ fontSize: "12px", color: "#64748b" }}>
                                      {task.created_by_name}
                                    </span>
                                  </div>
                                </td>
                              );
                            case 11:
                              return (
                                <td key="cell-11" style={{ ...getFreezeStyle(11, false) }}>
                                  {renderServiceTypeBadge(task)}
                                </td>
                              );
                            case 12:
                              return (
                                <td key="cell-12" style={{ ...getFreezeStyle(12, false) }}>
                                  {task.call_type || "—"}
                                </td>
                              );
                            case 13:
                              return (
                                <td key="cell-13" style={{ ...getFreezeStyle(13, false) }}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                    <span style={{ fontWeight: 600, color: "#1e293b", fontSize: "12.5px" }}>
                                      {task.task_approved_by || "—"}
                                    </span>
                                    {task.task_approved_date && (
                                      <span style={{ fontSize: "12px", color: "#64748b" }}>
                                        {task.task_approved_date}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              );
                            case 14:
                              return (
                                <td key="cell-14" style={{ ...getFreezeStyle(14, false) }}>
                                  <span style={{ fontWeight: 600, color: "#1e293b" }}>
                                    {task.task_allotted_to || "—"}
                                  </span>
                                </td>
                              );
                            case 15:
                              return (
                                <td key="cell-15" style={{ ...getFreezeStyle(15, false) }}>
                                  {renderPaymentBadge(task.payment_status)}
                                </td>
                              );
                            case 16:
                              return (
                                <td key="cell-16" style={{ ...getFreezeStyle(16, false) }}>
                                  {renderStatusBadge(task)}
                                </td>
                              );
                            case 17:
                              return (
                                <td key="cell-17" style={{ textAlign: "center", ...getFreezeStyle(17, false) }}>
                                  <div style={{ position: "relative", display: "inline-block" }}>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenActionMenuId(
                                          openActionMenuId === task.id ? null : task.id
                                        );
                                      }}
                                      style={{
                                        background: "#ffffff",
                                        border: "1px solid #cbd5e1",
                                        borderRadius: "4px",
                                        padding: "4px 8px",
                                        fontSize: "16px",
                                        lineHeight: 1,
                                        cursor: "pointer",
                                        color: "#334155",
                                      }}
                                    >
                                      ⋮
                                    </button>

                                    {openActionMenuId === task.id && (
                                      <div
                                        onClick={(e) => e.stopPropagation()}
                                        style={{
                                          position: "absolute",
                                          right: 0,
                                          top: "100%",
                                          marginTop: "4px",
                                          background: "#ffffff",
                                          border: "1px solid #cbd5e1",
                                          borderRadius: "6px",
                                          boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                                          zIndex: 100,
                                          minWidth: "150px",
                                          display: "flex",
                                          flexDirection: "column",
                                          overflow: "hidden",
                                        }}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setDetailTask(task);
                                            setOpenActionMenuId(null);
                                          }}
                                          style={{
                                            padding: "8px 12px",
                                            background: "none",
                                            border: "none",
                                            textAlign: "left",
                                            fontSize: "13px",
                                            cursor: "pointer",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "6px",
                                            color: "#334155",
                                          }}
                                        >
                                          <span>👁</span>
                                          <span>View Details</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            handleOpenCallLogs(task);
                                            setOpenActionMenuId(null);
                                          }}
                                          style={{
                                            padding: "8px 12px",
                                            background: "none",
                                            border: "none",
                                            textAlign: "left",
                                            fontSize: "13px",
                                            cursor: "pointer",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "6px",
                                            color: "#0284c7",
                                          }}
                                        >
                                          <span>📞</span>
                                          <span>Call Logs</span>
                                        </button>

                                        {/* Stage 1: Pending -> Approve, Edit, Delete */}
                                        {task.status.toLowerCase() === "pending" && (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                openApproveModal(task);
                                                setOpenActionMenuId(null);
                                              }}
                                              style={{
                                                padding: "8px 12px",
                                                background: "none",
                                                border: "none",
                                                textAlign: "left",
                                                fontSize: "13px",
                                                cursor: "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "6px",
                                                color: "#16a34a",
                                                fontWeight: 600,
                                              }}
                                            >
                                              <span>✅</span>
                                              <span>Approve</span>
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                handleOpenEdit(task);
                                                setOpenActionMenuId(null);
                                              }}
                                              style={{
                                                padding: "8px 12px",
                                                background: "none",
                                                border: "none",
                                                textAlign: "left",
                                                fontSize: "13px",
                                                cursor: "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "6px",
                                                color: "#334155",
                                              }}
                                            >
                                              <span>✏️</span>
                                              <span>Edit</span>
                                            </button>
                                          </>
                                        )}

                                        {/* Stage 2: Approved -> Complete Task, Cancel Task, Edit, Delete */}
                                        {task.status.toLowerCase() === "approved" && (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                openCompleteModal(task);
                                                setOpenActionMenuId(null);
                                              }}
                                              style={{
                                                padding: "8px 12px",
                                                background: "none",
                                                border: "none",
                                                textAlign: "left",
                                                fontSize: "13px",
                                                cursor: "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "6px",
                                                color: "#16a34a",
                                                fontWeight: 600,
                                              }}
                                            >
                                              <span>✔️</span>
                                              <span>Complete Task</span>
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setCancelModalTask(task);
                                                setCancelRemarks("");
                                                setCancelError(null);
                                                setOpenActionMenuId(null);
                                              }}
                                              style={{
                                                padding: "8px 12px",
                                                background: "none",
                                                border: "none",
                                                textAlign: "left",
                                                fontSize: "13px",
                                                cursor: "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "6px",
                                                color: "#ea580c",
                                                fontWeight: 500,
                                              }}
                                            >
                                              <span>❌</span>
                                              <span>Cancel Task</span>
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                handleOpenEdit(task);
                                                setOpenActionMenuId(null);
                                              }}
                                              style={{
                                                padding: "8px 12px",
                                                background: "none",
                                                border: "none",
                                                textAlign: "left",
                                                fontSize: "13px",
                                                cursor: "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "6px",
                                                color: "#334155",
                                              }}
                                            >
                                              <span>✏️</span>
                                              <span>Edit</span>
                                            </button>
                                          </>
                                        )}

                                        {/* Stage 3: Cancel / Payment Pending -> Reopen / Reassign Task, Delete */}
                                        {(task.status.toLowerCase() === "cancel" ||
                                          task.status.toLowerCase() === "cancelled" ||
                                          task.status.toLowerCase() === "payment pending") && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              openReopenModal(task);
                                              setOpenActionMenuId(null);
                                            }}
                                            style={{
                                              padding: "8px 12px",
                                              background: "none",
                                              border: "none",
                                              textAlign: "left",
                                              fontSize: "13px",
                                              cursor: "pointer",
                                              display: "flex",
                                              alignItems: "center",
                                              gap: "6px",
                                              color: "#4f46e5",
                                              fontWeight: 600,
                                            }}
                                          >
                                            <span>🔄</span>
                                            <span>Reopen / Reassign</span>
                                          </button>
                                        )}

                                        {/* Universal Delete */}
                                        <div style={{ borderTop: "1px solid #f1f5f9" }} />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            handleDeleteSingle(task.id);
                                            setOpenActionMenuId(null);
                                          }}
                                          style={{
                                            padding: "8px 12px",
                                            background: "none",
                                            border: "none",
                                            textAlign: "left",
                                            fontSize: "13px",
                                            color: "#dc2626",
                                            cursor: "pointer",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "6px",
                                          }}
                                        >
                                          <span>🗑️</span>
                                          <span>Delete</span>
                                        </button>
                                      </div>
                                    )}
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

          {/* Standard Inhyma Pagination Footer */}
          <div style={{ padding: "8px 16px", borderTop: "1px solid #e2e8f0" }}>
            <Pagination
              pagination={paginationMeta}
              pageSize={pageSize}
              onPageChange={(p) => setCurrentPage(p)}
              onPageSizeChange={(sz) => {
                setPageSize(sz);
                setCurrentPage(1);
              }}
            />
          </div>
        </div>

        {/* VIEW DETAIL DRAWER (Matches live ERP screenshot) */}
        <Modal
          open={Boolean(detailTask)}
          onClose={() => setDetailTask(null)}
          title={`View Detail #${detailTask?.id ? (/^\d+$/.test(detailTask.id) ? detailTask.id : detailTask.id.includes("-") ? detailTask.id.slice(0, 8) : detailTask.id) : ""}`}
          cardStyle={{ maxWidth: "480px", background: "#ffffff" }}
        >
          {detailTask && (
            <div
              style={{
                padding: "24px 28px",
                overflowY: "auto",
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: "18px",
                background: "#ffffff",
              }}
            >
              {/* Row 1: Task Type & Current Status */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "20px",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#64748b",
                      marginBottom: "6px",
                    }}
                  >
                    Task Type
                  </div>
                  <div>{renderTaskTypeBadge(detailTask.task_type)}</div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#64748b",
                      marginBottom: "6px",
                    }}
                  >
                    Current Status
                  </div>
                  <div>
                    <span className={`badge-tech badge-status-${detailTask.status.toLowerCase()}`}>
                      {detailTask.status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Row 2: Company Name */}
              <div>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#64748b",
                    marginBottom: "4px",
                  }}
                >
                  Company Name
                </div>
                <div
                  style={{
                    fontSize: "13.5px",
                    fontWeight: 600,
                    color: "#0f172a",
                    textTransform: "uppercase",
                  }}
                >
                  {detailTask.company_name}
                </div>
              </div>

              {/* Row 3: City & Priority */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "20px",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#64748b",
                      marginBottom: "4px",
                    }}
                  >
                    City
                  </div>
                  <div style={{ fontSize: "13.5px", color: "#334155" }}>
                    {detailTask.city || "—"}
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#64748b",
                      marginBottom: "4px",
                    }}
                  >
                    Priority
                  </div>
                  <div
                    style={{
                      fontSize: "13.5px",
                      color: "#334155",
                      fontWeight: 600,
                    }}
                  >
                    {detailTask.priority || "—"}
                  </div>
                </div>
              </div>

              {/* Row 4: Contact Person Detail & Contact Number */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "20px",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#64748b",
                      marginBottom: "4px",
                    }}
                  >
                    Contact Person Detail
                  </div>
                  <div style={{ fontSize: "13.5px", color: "#334155" }}>
                    {detailTask.contact_person_name || "—"}
                  </div>
                  {detailTask.contact_phone && (
                    <div
                      style={{
                        fontSize: "12.5px",
                        color: "#64748b",
                        marginTop: "2px",
                      }}
                    >
                      {detailTask.contact_phone}
                    </div>
                  )}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#64748b",
                      marginBottom: "4px",
                    }}
                  >
                    Contact Number
                  </div>
                  {detailTask.contact_phone ? (
                    <a
                      href={`tel:${detailTask.contact_phone}`}
                      style={{
                        color: "#0061f2",
                        textDecoration: "none",
                        fontSize: "13.5px",
                        fontWeight: 600,
                      }}
                    >
                      {detailTask.contact_phone}
                    </a>
                  ) : (
                    <span style={{ fontSize: "13.5px", color: "#64748b" }}>
                      —
                    </span>
                  )}
                </div>
              </div>

              {/* Row 5: Service Type & Call Type */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "20px",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#64748b",
                      marginBottom: "6px",
                    }}
                  >
                    Service Type
                  </div>
                  <div>{renderServiceTypeBadge(detailTask)}</div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#64748b",
                      marginBottom: "4px",
                    }}
                  >
                    Call Type
                  </div>
                  <div style={{ fontSize: "13.5px", color: "#334155" }}>
                    {detailTask.call_type || "—"}
                  </div>
                </div>
              </div>

              {/* Row 6: Task Date & By & Machine & Model */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "20px",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#64748b",
                      marginBottom: "4px",
                    }}
                  >
                    Task Date & By
                  </div>
                  <div style={{ fontSize: "13px", color: "#334155" }}>
                    {detailTask.task_created_date || "—"}
                  </div>
                  {detailTask.created_by_name && (
                    <div
                      style={{
                        fontSize: "12.5px",
                        color: "#64748b",
                        marginTop: "2px",
                      }}
                    >
                      {detailTask.created_by_name}
                    </div>
                  )}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#64748b",
                      marginBottom: "4px",
                    }}
                  >
                    Machine & Model
                  </div>
                  <div style={{ fontSize: "13.5px", color: "#334155" }}>
                    {detailTask.machine_model || "—"}
                  </div>
                </div>
              </div>

              {/* Row 7: Desc Of Task */}
              <div>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#64748b",
                    marginBottom: "4px",
                  }}
                >
                  Desc Of Task
                </div>
                <div
                  style={{
                    fontSize: "13.5px",
                    color: "#334155",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {detailTask.task_description || "—"}
                </div>
              </div>

              {/* Conditional Third-Party Site Details */}
              {(detailTask.third_party ||
                detailTask.third_party_city ||
                detailTask.third_party_contact_name ||
                detailTask.task_type === "Onsite Visit - Third-Party Location") && (
                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "6px",
                    padding: "12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#475569",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    🏢 Third-Party Location Details
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <div>
                      <span style={{ fontSize: "11px", color: "#64748b" }}>Location / Name:</span>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>
                        {detailTask.third_party || "—"}
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: "11px", color: "#64748b" }}>City:</span>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>
                        {detailTask.third_party_city || "—"}
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: "11px", color: "#64748b" }}>Contact Person:</span>
                      <div style={{ fontSize: "12.5px", color: "#334155" }}>
                        {detailTask.third_party_contact_name || "—"}
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: "11px", color: "#64748b" }}>Contact Mobile:</span>
                      <div style={{ fontSize: "12.5px", color: "#334155" }}>
                        {detailTask.third_party_contact_phone || "—"}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Approval & Scheduled Visit Date */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "20px",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#64748b",
                      marginBottom: "4px",
                    }}
                  >
                    Task Allotted To
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>
                    {detailTask.task_allotted_to || "—"}
                  </div>
                  {detailTask.task_approved_by && (
                    <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
                      Approved by: {detailTask.task_approved_by}
                    </div>
                  )}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#64748b",
                      marginBottom: "4px",
                    }}
                  >
                    Scheduled Visit Date
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>
                    {detailTask.scheduled_visit_date || detailTask.task_approved_date || "—"}
                  </div>
                </div>
              </div>

              {/* Payment Details (Charge, Terms, Mode, Screenshot) */}
              {(detailTask.service_type === "Chargeable" || (detailTask.service_charge ?? 0) > 0) && (
                <div
                  style={{
                    background: "#fefce8",
                    border: "1px solid #fef08a",
                    borderRadius: "6px",
                    padding: "12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#854d0e",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    💰 Chargeable Payment Details
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <div>
                      <span style={{ fontSize: "11px", color: "#713f12" }}>Service Charge:</span>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#854d0e" }}>
                        ₹{detailTask.service_charge || 0}
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: "11px", color: "#713f12" }}>Payment Status:</span>
                      <div>{renderPaymentBadge(detailTask.payment_status)}</div>
                    </div>
                  </div>
                  {detailTask.payment_terms && (
                    <div>
                      <span style={{ fontSize: "11px", color: "#713f12" }}>Payment Terms:</span>
                      <div style={{ fontSize: "12.5px", color: "#451a03", marginTop: "2px" }}>
                        {detailTask.payment_terms}
                      </div>
                    </div>
                  )}
                  {detailTask.payment_mode && (
                    <div style={{ display: "flex", gap: "14px", alignItems: "center", marginTop: "4px" }}>
                      <span style={{ fontSize: "11.5px", color: "#713f12" }}>
                        Mode: <strong>{detailTask.payment_mode}</strong>
                      </span>
                      {detailTask.payment_screenshot && (
                        <a
                          href={detailTask.payment_screenshot}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "#0061f2",
                            textDecoration: "underline",
                          }}
                        >
                          View Receipt / Screenshot ↗
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Combined Remarks Box */}
              <div
                style={{
                  background: "#f1f5f9",
                  borderRadius: "6px",
                  padding: "12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
                  Combined Activity Remarks
                </div>
                {detailTask.creator_remarks && (
                  <div>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b" }}>Creator: </span>
                    <span style={{ fontSize: "12.5px", color: "#1e293b" }}>{detailTask.creator_remarks}</span>
                  </div>
                )}
                {detailTask.approver_remarks && (
                  <div>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b" }}>Approver: </span>
                    <span style={{ fontSize: "12.5px", color: "#1e293b" }}>{detailTask.approver_remarks}</span>
                  </div>
                )}
                {detailTask.cancel_remarks && (
                  <div>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#dc2626" }}>Cancellation: </span>
                    <span style={{ fontSize: "12.5px", color: "#991b1b" }}>{detailTask.cancel_remarks}</span>
                  </div>
                )}
                {!detailTask.creator_remarks && !detailTask.approver_remarks && !detailTask.cancel_remarks && (
                  <span style={{ fontSize: "12px", color: "#94a3b8", fontStyle: "italic" }}>
                    No additional remarks recorded.
                  </span>
                )}
              </div>

              {/* Quick Call Logs button */}
              <div style={{ marginTop: "4px" }}>
                <button
                  type="button"
                  onClick={() => {
                    handleOpenCallLogs(detailTask);
                  }}
                  style={{
                    width: "100%",
                    padding: "8px",
                    background: "#f0fdf4",
                    color: "#166534",
                    border: "1px solid #bbf7d0",
                    borderRadius: "6px",
                    fontWeight: 600,
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  <span>📞</span>
                  <span>View / Log Call Logs</span>
                </button>
              </div>
            </div>
          )}
        </Modal>


        {/* ADD / EDIT TECHNICAL TASK DRAWER (Matches live ERP screenshot) */}
        <Modal
          open={addEditModalOpen}
          onClose={() => setAddEditModalOpen(false)}
          title={editingTask ? "Edit Technical Task" : "Add Technical Task"}
          cardStyle={{ maxWidth: "480px", background: "#ffffff" }}
        >
          <form
            onSubmit={handleFormSubmit}
            style={{
              display: "flex",
              flexDirection: "column",
              height: "calc(100vh - 57px)",
              margin: 0,
            }}
          >
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              {formError && (
                <div
                  style={{
                    background: "#fee2e2",
                    color: "#991b1b",
                    padding: "10px 14px",
                    borderRadius: "6px",
                    fontSize: "13px",
                  }}
                >
                  {formError}
                </div>
              )}

              {/* Company Name * with Keyword Autocomplete */}
              <div>
                <label style={fieldLabelStyle}>
                  Company Name <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <ClientNameAutocomplete
                  value={formData.company_name}
                  onChange={(val) => setFormData({ ...formData, company_name: val })}
                  onSelectCompany={(item) => {
                    setFormData((prev) => ({
                      ...prev,
                      company_name: item.company_name,
                      city: item.city_name || prev.city,
                      contact_person_name: item.contact_full_name || prev.contact_person_name,
                      contact_designation: item.contact_designation || prev.contact_designation,
                      contact_phone: item.contact_calling_number || item.contact_whatsapp_number || prev.contact_phone,
                    }));
                  }}
                  placeholder="Search for Company Name"
                  inputStyle={inputStyle}
                />
              </div>

              {/* Contact Person & Contact Designation */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "14px",
                }}
              >
                <div>
                  <label style={fieldLabelStyle}>Contact Person</label>
                  <input
                    type="text"
                    placeholder="Contact Person"
                    value={formData.contact_person_name || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        contact_person_name: e.target.value,
                      })
                    }
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Designation</label>
                  <input
                    type="text"
                    placeholder="Designation e.g. Manager"
                    value={formData.contact_designation || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        contact_designation: e.target.value,
                      })
                    }
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Contact Number * */}
              <div>
                <label style={fieldLabelStyle}>
                  Contact Number <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Mobile / Calling Number"
                  value={formData.contact_phone || ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      contact_phone: e.target.value,
                    })
                  }
                  style={inputStyle}
                />
              </div>

              {/* Task Type * & City */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "14px",
                }}
              >
                <div>
                  <label style={fieldLabelStyle}>
                    Task Type <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <select
                    required
                    value={formData.task_type}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        task_type: e.target.value,
                        third_party:
                          e.target.value === "Onsite Visit - Third-Party Location"
                            ? formData.third_party
                            : "",
                        third_party_city:
                          e.target.value === "Onsite Visit - Third-Party Location"
                            ? formData.third_party_city
                            : "",
                        third_party_contact_name:
                          e.target.value === "Onsite Visit - Third-Party Location"
                            ? formData.third_party_contact_name
                            : "",
                        third_party_contact_phone:
                          e.target.value === "Onsite Visit - Third-Party Location"
                            ? formData.third_party_contact_phone
                            : "",
                      })
                    }
                    style={selectStyle}
                  >
                    <option value="">Select</option>
                    {TASK_TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={fieldLabelStyle}>City</label>
                  <TypableCombobox
                    value={formData.city}
                    onChange={(city) =>
                      setFormData({ ...formData, city })
                    }
                    options={cityOptions}
                    placeholder="Select or type city..."
                  />
                </div>
              </div>

              {/* Conditional Third-Party Site Details */}
              {formData.task_type === "Onsite Visit - Third-Party Location" && (
                <div
                  style={{
                    background: "#f8fafc",
                    padding: "14px",
                    borderRadius: "6px",
                    border: "1px solid #e2e8f0",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#1e293b",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Third-Party Site Details
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div>
                      <label style={fieldLabelStyle}>
                        Third-Party Location / Name <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Third-Party Location"
                        value={formData.third_party || ""}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            third_party: e.target.value,
                          })
                        }
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={fieldLabelStyle}>
                        Third-Party City <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <TypableCombobox
                        value={formData.third_party_city || ""}
                        onChange={(third_party_city) =>
                          setFormData({ ...formData, third_party_city })
                        }
                        options={cityOptions}
                        placeholder="Select or type city..."
                      />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div>
                      <label style={fieldLabelStyle}>Third-Party Contact Person</label>
                      <input
                        type="text"
                        placeholder="Contact Person"
                        value={formData.third_party_contact_name || ""}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            third_party_contact_name: e.target.value,
                          })
                        }
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={fieldLabelStyle}>Third-Party Contact Mobile</label>
                      <input
                        type="text"
                        placeholder="Mobile Number"
                        value={formData.third_party_contact_phone || ""}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            third_party_contact_phone: e.target.value,
                          })
                        }
                        style={inputStyle}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Priority */}
              <div>
                <label style={fieldLabelStyle}>Priority</label>
                <div
                  style={{
                    display: "flex",
                    gap: "24px",
                    alignItems: "center",
                    marginTop: "4px",
                  }}
                >
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "13px",
                      color: "#334155",
                      cursor: "pointer",
                      fontWeight: 500,
                    }}
                  >
                    <input
                      type="radio"
                      name="priority"
                      value="A"
                      checked={formData.priority === "A"}
                      onChange={(e) =>
                        setFormData({ ...formData, priority: e.target.value })
                      }
                      style={{
                        margin: 0,
                        cursor: "pointer",
                        accentColor: "#0061f2",
                      }}
                    />
                    A
                  </label>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "13px",
                      color: "#334155",
                      cursor: "pointer",
                      fontWeight: 500,
                    }}
                  >
                    <input
                      type="radio"
                      name="priority"
                      value="B"
                      checked={formData.priority === "B"}
                      onChange={(e) =>
                        setFormData({ ...formData, priority: e.target.value })
                      }
                      style={{
                        margin: 0,
                        cursor: "pointer",
                        accentColor: "#0061f2",
                      }}
                    />
                    B
                  </label>
                </div>
              </div>

              {/* Machine & Model * with Product Master Keyword Autocomplete */}
              <div ref={productSearchRef} style={{ position: "relative" }}>
                <label style={fieldLabelStyle}>
                  Machine & Model <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Search Product..."
                  value={formData.machine_model}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormData({ ...formData, machine_model: val });
                    handleProductSearch(val);
                  }}
                  onFocus={() => {
                    if (formData.machine_model) {
                      handleProductSearch(formData.machine_model);
                    }
                  }}
                  style={inputStyle}
                />
                {showProductDropdown && productSuggestions.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      background: "#ffffff",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                      zIndex: 1100,
                      maxHeight: "180px",
                      overflowY: "auto",
                      marginTop: "4px",
                    }}
                  >
                    {productSuggestions.map((prod) => (
                      <div
                        key={prod.id}
                        onClick={() => {
                          setFormData({ ...formData, machine_model: prod.product_name });
                          setShowProductDropdown(false);
                        }}
                        style={{
                          padding: "8px 12px",
                          fontSize: "13px",
                          cursor: "pointer",
                          borderBottom: "1px solid #f1f5f9",
                          color: "#1e293b",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#eff6ff")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        <div style={{ fontWeight: 600 }}>{prod.product_name}</div>
                        {prod.product_code && (
                          <div style={{ fontSize: "11px", color: "#64748b" }}>Code: {prod.product_code}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Description (Nature Of Complain) * */}
              <div>
                <label style={fieldLabelStyle}>
                  Description (Nature Of Complain){" "}
                  <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder=""
                  value={formData.task_description}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      task_description: e.target.value,
                    })
                  }
                  style={{
                    width: "100%",
                    borderRadius: "5px",
                    border: "1px solid #cbd5e1",
                    padding: "10px 12px",
                    fontSize: "13.5px",
                    color: "#334155",
                    boxSizing: "border-box",
                    outline: "none",
                    resize: "vertical",
                    fontFamily: "inherit",
                    lineHeight: 1.5,
                  }}
                />
              </div>

              {/* Service Type * & Call Type * */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "14px",
                }}
              >
                <div>
                  <label style={fieldLabelStyle}>
                    Service Type <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <select
                    required
                    value={formData.service_type}
                    onChange={(e) =>
                      setFormData({ ...formData, service_type: e.target.value })
                    }
                    style={selectStyle}
                  >
                    <option value="">Select</option>
                    {SERVICE_TYPE_OPTIONS.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={fieldLabelStyle}>
                    Call Type <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <select
                    required
                    value={formData.call_type}
                    onChange={(e) =>
                      setFormData({ ...formData, call_type: e.target.value })
                    }
                    style={selectStyle}
                  >
                    <option value="">Select</option>
                    {CALL_TYPE_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c === "Trial" ? "trial" : c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Conditional Service Charge (₹) & Mandatory Payment Terms if Chargeable */}
              {formData.service_type === "Chargeable" && (
                <div
                  style={{
                    background: "#fefce8",
                    padding: "14px",
                    borderRadius: "6px",
                    border: "1px solid #fef08a",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <div>
                    <label style={fieldLabelStyle}>
                      Service Charge (₹) <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="Enter charge e.g. 2000"
                      value={formData.service_charge || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          service_charge: parseFloat(e.target.value) || 0,
                        })
                      }
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={fieldLabelStyle}>
                      Payment Terms <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    <textarea
                      required
                      rows={2}
                      placeholder="Enter payment terms description (e.g. 100% advance or collect on-site)"
                      value={formData.payment_terms || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          payment_terms: e.target.value,
                        })
                      }
                      style={{
                        width: "100%",
                        borderRadius: "5px",
                        border: "1px solid #cbd5e1",
                        padding: "8px 12px",
                        fontSize: "13px",
                        color: "#334155",
                        boxSizing: "border-box",
                        outline: "none",
                        resize: "vertical",
                        fontFamily: "inherit",
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Creator Remarks */}
              <div>
                <label style={fieldLabelStyle}>Creator Remarks / Task Notes</label>
                <textarea
                  rows={2}
                  placeholder="Remarks or special instructions by task creator"
                  value={formData.creator_remarks || ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      creator_remarks: e.target.value,
                    })
                  }
                  style={{
                    width: "100%",
                    borderRadius: "5px",
                    border: "1px solid #cbd5e1",
                    padding: "8px 12px",
                    fontSize: "13px",
                    color: "#334155",
                    boxSizing: "border-box",
                    outline: "none",
                    resize: "vertical",
                    fontFamily: "inherit",
                  }}
                />
              </div>
            </div>

            {/* Bottom Sticky Submit Button matching screenshot */}
            <div
              className="form-actions"
              style={{
                padding: "16px 24px",
                borderTop: "1px solid #e2e8f0",
                background: "#ffffff",
                display: "flex",
              }}
            >
              <button
                type="submit"
                style={{
                  width: "100%",
                  height: "42px",
                  background: "#0061f2",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "14px",
                  cursor: formSubmitting ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                disabled={formSubmitting}
              >
                {formSubmitting ? "Submitting..." : "Submit"}
              </button>
            </div>
          </form>
        </Modal>

        {/* STATUS MODAL */}
        {statusModalTask && (
          <div className="tech-modal-overlay" onClick={() => setStatusModalTask(null)}>
            <div
              className="tech-modal-card"
              style={{ maxWidth: "480px" }}
              onClick={(e) => e.stopPropagation()}
            >
              <form onSubmit={handleStatusSubmit}>
                <div className="tech-modal-header">
                  <h2>
                    {newStatusValue === "Approved"
                      ? "Approve & Allot Task"
                      : newStatusValue === "Completed"
                        ? "Complete Technical Task"
                        : "Change Status"}{" "}
                    — {statusModalTask.company_name}
                  </h2>
                  <button
                    type="button"
                    className="btn-close-modal"
                    onClick={() => setStatusModalTask(null)}
                  >
                    ✕
                  </button>
                </div>
                <div className="tech-modal-body">
                  <div className="field">
                    <label>Select Status</label>
                    <select
                      value={newStatusValue}
                      onChange={(e) => setNewStatusValue(e.target.value)}
                    >
                      {STATUS_OPTIONS.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>

                  {newStatusValue === "Approved" && (
                    <>
                      <div className="field" style={{ marginTop: "12px" }}>
                        <label>Allot Technician</label>
                        <select
                          value={statusAllottedTo}
                          onChange={(e) => setStatusAllottedTo(e.target.value)}
                        >
                          <option value="">-- Select Technician --</option>
                          {technicianOptions.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                      {/* Conditionally visible based on task type: only for Onsite / Client / Third-Party visits */}
                      {(statusModalTask.task_type?.toLowerCase().includes("onsite") ||
                        statusModalTask.task_type?.toLowerCase().includes("client location") ||
                        statusModalTask.task_type?.toLowerCase().includes("third-party") ||
                        statusModalTask.task_type?.toLowerCase().includes("visit")) && (
                        <div className="field" style={{ marginTop: "12px" }}>
                          <label>Scheduled / Visit Date</label>
                          <input
                            type="date"
                            value={statusVisitDate}
                            onChange={(e) => setStatusVisitDate(e.target.value)}
                          />
                        </div>
                      )}
                    </>
                  )}

                  {newStatusValue === "Completed" &&
                    (statusModalTask.service_type === "Chargeable" || (statusModalTask.service_charge ?? 0) > 0) && (
                      <div
                        style={{
                          marginTop: "14px",
                          padding: "12px",
                          background: "#fef3c7",
                          border: "1px solid #fde68a",
                          borderRadius: "6px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: "13px", color: "#92400e" }}>
                          💰 Chargeable Task Payment Collection:
                        </div>
                        <div style={{ fontSize: "12.5px", color: "#78350f" }}>
                          Did you collect payment of ₹{statusModalTask.service_charge || 0} from the client?
                        </div>
                        <div style={{ display: "flex", gap: "16px" }}>
                          <label
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              cursor: "pointer",
                              fontSize: "13px",
                              fontWeight: 600,
                              color: "#166534",
                            }}
                          >
                            <input
                              type="radio"
                              name="paymentCollected"
                              checked={statusPaymentCollected === true}
                              onChange={() => setStatusPaymentCollected(true)}
                            />
                            Yes (Payment Collected)
                          </label>
                          <label
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              cursor: "pointer",
                              fontSize: "13px",
                              fontWeight: 600,
                              color: "#b45309",
                            }}
                          >
                            <input
                              type="radio"
                              name="paymentCollected"
                              checked={statusPaymentCollected === false}
                              onChange={() => setStatusPaymentCollected(false)}
                            />
                            No (Move to Payment Pending)
                          </label>
                        </div>

                        {statusPaymentCollected && (
                          <div
                            style={{
                              marginTop: "6px",
                              paddingTop: "8px",
                              borderTop: "1px dashed #fde68a",
                              display: "flex",
                              flexDirection: "column",
                              gap: "10px",
                            }}
                          >
                            <div>
                              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#78350f", marginBottom: "4px" }}>
                                Payment Collection Mode
                              </label>
                              <div style={{ display: "flex", gap: "20px" }}>
                                <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12.5px", cursor: "pointer" }}>
                                  <input
                                    type="radio"
                                    name="paymentMode"
                                    value="Company Acc"
                                    checked={statusPaymentMode === "Company Acc"}
                                    onChange={(e) => setStatusPaymentMode(e.target.value)}
                                  />
                                  Company Acc (Bank / Online)
                                </label>
                                <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12.5px", cursor: "pointer" }}>
                                  <input
                                    type="radio"
                                    name="paymentMode"
                                    value="Self collect"
                                    checked={statusPaymentMode === "Self collect"}
                                    onChange={(e) => setStatusPaymentMode(e.target.value)}
                                  />
                                  Self collect (Technician)
                                </label>
                              </div>
                            </div>

                            <div>
                              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#78350f", marginBottom: "4px" }}>
                                Payment Screenshot / Receipt (Optional)
                              </label>
                              <input
                                type="file"
                                accept="image/*,.pdf"
                                onChange={(e) => setStatusScreenshotFile(e.target.files?.[0] || null)}
                                style={{ fontSize: "12px" }}
                              />
                              {statusScreenshotFile && (
                                <div style={{ fontSize: "11.5px", color: "#166534", marginTop: "2px" }}>
                                  Selected: {statusScreenshotFile.name}
                                </div>
                              )}
                              {uploadingScreenshot && (
                                <div style={{ fontSize: "11.5px", color: "#0284c7", marginTop: "2px" }}>
                                  Uploading screenshot...
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                  <div className="field" style={{ marginTop: "12px" }}>
                    <label>
                      {newStatusValue === "Approved" ? "Approver Remarks" : "Remarks / Notes (Optional)"}
                    </label>
                    <textarea
                      rows={3}
                      placeholder={
                        newStatusValue === "Approved"
                          ? "Add instructions for allotted technician"
                          : "Add completion notes or update remarks"
                      }
                      value={statusRemarks}
                      onChange={(e) => setStatusRemarks(e.target.value)}
                    />
                  </div>
                </div>
                <div className="tech-modal-footer">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setStatusModalTask(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Save Status
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* CANCEL TASK MODAL (Mandatory Remarks) */}
        {cancelModalTask && (
          <div className="tech-modal-overlay" onClick={() => setCancelModalTask(null)}>
            <div
              className="tech-modal-card"
              style={{ maxWidth: "480px" }}
              onClick={(e) => e.stopPropagation()}
            >
              <form onSubmit={handleCancelTaskSubmit}>
                <div className="tech-modal-header" style={{ borderBottom: "1px solid #fee2e2", background: "#fef2f2" }}>
                  <h2 style={{ color: "#991b1b" }}>Cancel Technical Task</h2>
                  <button
                    type="button"
                    className="btn-close-modal"
                    onClick={() => setCancelModalTask(null)}
                  >
                    ✕
                  </button>
                </div>
                <div className="tech-modal-body" style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "20px" }}>
                  {cancelError && (
                    <div style={{ background: "#fee2e2", color: "#991b1b", padding: "8px 12px", borderRadius: "6px", fontSize: "13px" }}>
                      {cancelError}
                    </div>
                  )}
                  <div style={{ fontSize: "13.5px", color: "#334155", lineHeight: 1.5 }}>
                    Are you sure you want to cancel the technical task for <strong>{cancelModalTask.company_name}</strong>?
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                      Reason / Cancellation Remarks <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    <textarea
                      required
                      rows={4}
                      placeholder="Provide a mandatory reason for cancelling this task..."
                      value={cancelRemarks}
                      onChange={(e) => setCancelRemarks(e.target.value)}
                      style={{
                        width: "100%",
                        borderRadius: "5px",
                        border: "1px solid #cbd5e1",
                        padding: "10px 12px",
                        fontSize: "13px",
                        color: "#1e293b",
                        boxSizing: "border-box",
                        outline: "none",
                        fontFamily: "inherit",
                      }}
                    />
                  </div>
                </div>
                <div className="tech-modal-footer">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setCancelModalTask(null)}
                    disabled={submittingCancel}
                  >
                    Keep Task
                  </button>
                  <button
                    type="submit"
                    className="btn"
                    style={{ background: "#dc2626", color: "#ffffff", border: "none" }}
                    disabled={submittingCancel}
                  >
                    {submittingCancel ? "Cancelling..." : "Confirm Cancellation"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* CALL LOGS MODAL (Combined Remarks Summary, Add Call Log, Call History Table) */}
        {callLogModalTask && (
          <div className="tech-modal-overlay" onClick={() => setCallLogModalTask(null)}>
            <div
              className="tech-modal-card"
              style={{ maxWidth: "760px", width: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="tech-modal-header">
                <div>
                  <h2>Technical Call Logs</h2>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                    {callLogModalTask.company_name} — #{callLogModalTask.id.slice(0, 8)}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-close-modal"
                  onClick={() => setCallLogModalTask(null)}
                >
                  ✕
                </button>
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
                {/* Top Summary: 3 Combined Remarks */}
                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "14px 16px",
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: "14px",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#64748b", marginBottom: "4px" }}>
                      1. Creator Remarks
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#1e293b", whiteSpace: "pre-wrap" }}>
                      {callLogModalTask.creator_remarks || "—"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#64748b", marginBottom: "4px" }}>
                      2. Approver Remarks
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#1e293b", whiteSpace: "pre-wrap" }}>
                      {callLogModalTask.approver_remarks || "—"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#64748b", marginBottom: "4px" }}>
                      3. Completion / Cancel Remarks
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#1e293b", whiteSpace: "pre-wrap" }}>
                      {callLogModalTask.cancel_remarks || (callLogsList.length > 0 ? callLogsList[0].remarks : "—")}
                    </div>
                  </div>
                </div>

                {/* Add New Call Log Form */}
                <form
                  onSubmit={handleCreateCallLogSubmit}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                    padding: "16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "13.5px", color: "#0f172a" }}>
                    Add Call Log / Visit Update
                  </div>
                  {callLogError && (
                    <div style={{ background: "#fee2e2", color: "#991b1b", padding: "8px 12px", borderRadius: "6px", fontSize: "12.5px" }}>
                      {callLogError}
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", alignItems: "center" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                        Call / Visit Type
                      </label>
                      <div style={{ display: "flex", gap: "20px" }}>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
                          <input
                            type="radio"
                            name="callLogType"
                            value="Telecall"
                            checked={newCallLogType === "Telecall"}
                            onChange={(e) => setNewCallLogType(e.target.value)}
                          />
                          📞 Telecall
                        </label>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
                          <input
                            type="radio"
                            name="callLogType"
                            value="Physical Visit"
                            checked={newCallLogType === "Physical Visit"}
                            onChange={(e) => setNewCallLogType(e.target.value)}
                          />
                          🏢 Physical Visit
                        </label>
                      </div>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                        Date
                      </label>
                      <div style={{ fontSize: "13px", color: "#334155", fontWeight: 500 }}>
                        {new Date().toLocaleDateString("en-GB")} (System Date)
                      </div>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                      Feedback / Remarks by Technician <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    <textarea
                      required
                      rows={3}
                      placeholder="Enter discussion summary, technical findings, or next steps..."
                      value={newCallLogRemarks}
                      onChange={(e) => setNewCallLogRemarks(e.target.value)}
                      style={{
                        width: "100%",
                        borderRadius: "5px",
                        border: "1px solid #cbd5e1",
                        padding: "8px 12px",
                        fontSize: "13px",
                        color: "#1e293b",
                        boxSizing: "border-box",
                        outline: "none",
                        fontFamily: "inherit",
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={submittingCallLog}
                      style={{ padding: "8px 18px", fontSize: "13px" }}
                    >
                      {submittingCallLog ? "Saving Log..." : "+ Add Call Log"}
                    </button>
                  </div>
                </form>

                {/* Call Logs History List */}
                <div>
                  <div style={{ fontWeight: 600, fontSize: "13.5px", color: "#0f172a", marginBottom: "10px" }}>
                    Call Logs History ({callLogsList.length})
                  </div>

                  {loadingCallLogs ? (
                    <div style={{ textAlign: "center", padding: "20px", color: "#64748b", fontSize: "13px" }}>
                      Loading call logs...
                    </div>
                  ) : callLogsList.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "24px", color: "#94a3b8", background: "#f8fafc", borderRadius: "6px", fontSize: "13px" }}>
                      No call logs recorded yet.
                    </div>
                  ) : (
                    <div style={{ border: "1px solid #e2e8f0", borderRadius: "6px", overflow: "hidden" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                        <thead>
                          <tr style={{ background: "#f1f5f9", textAlign: "left", color: "#475569" }}>
                            <th style={{ padding: "8px 12px", width: "40px" }}>#</th>
                            <th style={{ padding: "8px 12px", width: "110px" }}>Type</th>
                            <th style={{ padding: "8px 12px", width: "130px" }}>Date & Time</th>
                            <th style={{ padding: "8px 12px", width: "130px" }}>Logged By</th>
                            <th style={{ padding: "8px 12px" }}>Remarks / Feedback</th>
                          </tr>
                        </thead>
                        <tbody>
                          {callLogsList.map((log, idx) => (
                            <tr key={log.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                              <td style={{ padding: "10px 12px", color: "#64748b" }}>{idx + 1}</td>
                              <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                                <span
                                  style={{
                                    padding: "2px 8px",
                                    borderRadius: "12px",
                                    fontSize: "11px",
                                    background: log.call_type === "Physical Visit" ? "#e0f2fe" : "#f1f5f9",
                                    color: log.call_type === "Physical Visit" ? "#0369a1" : "#475569",
                                  }}
                                >
                                  {log.call_type}
                                </span>
                              </td>
                              <td style={{ padding: "10px 12px", color: "#334155" }}>
                                {log.call_date || (log.created_at ? new Date(log.created_at).toLocaleString("en-GB") : "—")}
                              </td>
                              <td style={{ padding: "10px 12px", color: "#334155", fontWeight: 500 }}>
                                {log.created_by || "System"}
                              </td>
                              <td style={{ padding: "10px 12px", color: "#1e293b", whiteSpace: "pre-wrap" }}>
                                {log.remarks}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div className="tech-modal-footer">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setCallLogModalTask(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}

/**
 * TechnicalTasksPage with ErrorBoundary and Fallback System.
 * Ensures that unexpected rendering crashes are caught cleanly and
 * displayed with a recovery UI ("Try Again" and "Reload Page").
 */
export function TechnicalTasksPage() {
  return (
    <ErrorBoundary title="Failed to render Technical Tasks">
      <TechnicalTasksPageContent />
    </ErrorBoundary>
  );
}