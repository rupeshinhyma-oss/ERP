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
  type TechnicalTaskListParams,
} from "@/lib/technicalTasksApi";
import type {
  TechnicalTask,
  TechnicalTaskCounts,
  TechnicalTaskCreatePayload,
} from "@/types/technicalTasks";
import { apiGet, errorMessage } from "@/lib/api";
import { Banner, Modal } from "@/components/ui";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import "@/styles/technicalTasks.css";

const TASK_TYPE_OPTIONS = [
  "Telecall",
  "Onsite Visit - Client Location",
  "Onsite Visit - Third-Party Location",
  "In-house",
];

const CALL_TYPE_OPTIONS = [
  "Demo",
  "Repair",
  "Trial",
];

const PRIORITY_OPTIONS = ["A", "B", "C"];
const SERVICE_TYPE_OPTIONS = ["Chargeable", "Free"];
const STATUS_OPTIONS = ["Pending", "Approved", "Completed", "Cancel"];

const DEFAULT_CITIES = [
  "Ahmedabad",
  "Surat",
  "Rajkot",
  "Vadodara",
  "Mumbai",
  "Pune",
  "Delhi",
  "Bengaluru",
];

const DEFAULT_TECHNICIANS = [
  "Devendra Marade",
  "Sushant Dhawade",
  "Admin Technician",
];

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

  // Modals
  const [detailTask, setDetailTask] = useState<TechnicalTask | null>(null);
  const [addEditModalOpen, setAddEditModalOpen] = useState<boolean>(false);
  const [editingTask, setEditingTask] = useState<TechnicalTask | null>(null);
  const [statusModalTask, setStatusModalTask] = useState<TechnicalTask | null>(null);
  const [newStatusValue, setNewStatusValue] = useState<string>("Approved");
  const [statusRemarks, setStatusRemarks] = useState<string>("");

  // Form State for Add / Edit
  const [formData, setFormData] = useState<TechnicalTaskCreatePayload>({
    company_name: "",
    task_type: "",
    city: "",
    third_party: "",
    priority: "A",
    machine_model: "",
    task_description: "",
    contact_person_name: "",
    contact_designation: "",
    contact_phone: "",
    service_type: "",
    service_charge: 0,
    call_type: "",
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
      setOpenActionMenuId(null);
    }
    document.addEventListener("click", handleDocClick);
    return () => document.removeEventListener("click", handleDocClick);
  }, []);

  // Load Lookups on mount with graceful fallback systems
  useEffect(() => {
    async function loadLookups() {
      try {
        const cityRes = await apiGet<any[]>("/masters/cities?page=1&page_size=200");
        const cities = cityRes?.data?.map((c: any) => c.name || c.city_name).filter(Boolean) || [];
        setCityOptions(cities.length > 0 ? cities : DEFAULT_CITIES);
      } catch (err) {
        console.warn("Could not load cities lookup, using fallback defaults:", err);
        setCityOptions(DEFAULT_CITIES);
      }

      try {
        const techRes = await apiGet<any[]>("/masters/technicians?page=1&page_size=100");
        const techs = techRes?.data?.map((t: any) => t.name || t.technician_name).filter(Boolean) || [];
        setTechnicianOptions(techs.length > 0 ? techs : DEFAULT_TECHNICIANS);
      } catch (err) {
        console.warn("Could not load technicians lookup, using fallback defaults:", err);
        setTechnicianOptions(DEFAULT_TECHNICIANS);
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

  // Open Add New Task
  const handleOpenAdd = () => {
    setEditingTask(null);
    setFormData({
      company_name: "",
      task_type: "",
      city: "",
      third_party: "",
      priority: "A",
      machine_model: "",
      task_description: "",
      contact_person_name: "",
      contact_designation: "",
      contact_phone: "",
      service_type: "",
      service_charge: 0,
      call_type: "",
      task_allotted_to: "",
      payment_status: "Pending",
      status: "Pending",
    });
    setFormError(null);
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
      priority: task.priority || "A",
      machine_model: task.machine_model,
      task_description: task.task_description || "",
      contact_person_name: task.contact_person_name || "",
      contact_designation: task.contact_designation || "",
      contact_phone: task.contact_phone || "",
      service_type: task.service_type,
      service_charge: task.service_charge || 0,
      call_type: task.call_type,
      task_allotted_to: task.task_allotted_to || "",
      payment_status: task.payment_status || "Pending",
      status: task.status,
    });
    setFormError(null);
    setAddEditModalOpen(true);
  };

  // Submit Form (Add or Edit) with Screenshot Fields Validation
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
      await updateTechnicalTaskStatus(statusModalTask.id, newStatusValue, statusRemarks);
      showSuccess(`Status updated to ${newStatusValue} for ${statusModalTask.company_name}.`);
      setStatusModalTask(null);
      setStatusRemarks("");
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
                                          }}
                                        >
                                          <span>👁</span>
                                          <span>View Details</span>
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
                                          }}
                                        >
                                          <span>✏️</span>
                                          <span>Edit</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setStatusModalTask(task);
                                            setNewStatusValue(task.status);
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
                                          }}
                                        >
                                          <span>🔄</span>
                                          <span>Change Status</span>
                                        </button>
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

              {/* Company Name * */}
              <div>
                <label style={fieldLabelStyle}>
                  Company Name <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Search for Company Name"
                  value={formData.company_name}
                  onChange={(e) =>
                    setFormData({ ...formData, company_name: e.target.value })
                  }
                  style={inputStyle}
                />
              </div>

              {/* Contact Person & Contact Number * */}
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
                  <label style={fieldLabelStyle}>
                    Contact Number <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder=""
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
              </div>

              {/* Task Type * & City (and Third-Party if selected) */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    formData.task_type === "Onsite Visit - Third-Party Location"
                      ? "1fr 1fr 1fr"
                      : "1fr 1fr",
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
                {formData.task_type === "Onsite Visit - Third-Party Location" && (
                  <div>
                    <label style={fieldLabelStyle}>
                      Third-Party <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Enter Third-Party Location"
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
                )}
              </div>

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

              {/* Machine & Model * */}
              <div>
                <label style={fieldLabelStyle}>
                  Machine & Model <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Search Product..."
                  value={formData.machine_model}
                  onChange={(e) =>
                    setFormData({ ...formData, machine_model: e.target.value })
                  }
                  style={inputStyle}
                />
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

              {/* Conditional Service Charge (₹) if Chargeable */}
              {formData.service_type === "Chargeable" && (
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
              )}
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
                  <h2>Change Status — {statusModalTask.company_name}</h2>
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
                    <label>Select New Status</label>
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
                  <div className="field">
                    <label>Remarks / Notes (Optional)</label>
                    <textarea
                      rows={3}
                      placeholder="Add completion notes or update remarks"
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

