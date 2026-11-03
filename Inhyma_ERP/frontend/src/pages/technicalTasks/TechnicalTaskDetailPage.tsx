/**
 * TechnicalTaskDetailPage — Dedicated Technical Task Call Logs & Task Log Summary Page.
 *
 * Route: /technical-task/detail/:id
 * Displays:
 *  - Header: "Technical Task #<number>" + "+ ADD NEW CALL LOG" action button
 *  - Left Column:
 *      1. Task Details card (Status badge, Nature Of Complain / Description, Task Type,
 *         Machine & Model, Priority, Created By, Created At, Assign To)
 *      2. Company Details card (Company Name, Contact Person, Phone Number)
 *  - Right Column:
 *      - Tab 1: "Call Log Summary" (Items/Page selector, live Search, sortable table:
 *               Sr. No., Name, Remarks, Task Type, Call Date, pagination footer)
 *      - Tab 2: "Task Log Summary" (Updated By + timestamp, Title, Status badge)
 *  - Right-Side Slide-Over Drawer: "Add Call Log" (Task Type: Telecall / Physical Visit,
 *      Remarks textarea, full-width Submit button)
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { errorMessage } from "@/lib/api";
import { useAuth, useBodyScrollLock } from "@/lib/hooks";
import {
  createTaskCallLog,
  fetchTaskCallLogs,
  fetchTaskLogs,
  fetchTechnicalTask,
} from "@/lib/technicalTasksApi";
import type {
  TechnicalTask,
  TechnicalTaskCallLog,
  TechnicalTaskLog,
} from "@/types/technicalTasks";

type SummaryTab = "call_logs" | "task_logs";
type CallLogSortKey = "sr_no" | "created_by" | "remarks" | "call_type" | "call_date";
type SortDir = "asc" | "desc";

/** Internal status-workflow notes stored in technical_task_call_logs for audit compatibility; excluded from Call Log Summary. */
const SYSTEM_WORKFLOW_CALL_TYPES = new Set([
  "reopen / reassign",
  "approver override",
  "reopen",
  "cancellation",
  "completion",
  "payment pending",
  "payment collected",
]);

function formatLongDate(dateValue?: string | null, fallbackIso?: string | null): string {
  const raw = (dateValue || fallbackIso || "").trim();
  if (!raw) return "-";
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const parsed = dateOnlyMatch
    ? new Date(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]))
    : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatCallDate(callDate?: string | null, createdAt?: string | null): string {
  if (createdAt) {
    const dt = new Date(createdAt);
    if (!Number.isNaN(dt.getTime())) {
      const dd = String(dt.getDate()).padStart(2, "0");
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const yyyy = dt.getFullYear();
      let hrs = dt.getHours();
      const mins = String(dt.getMinutes()).padStart(2, "0");
      const ampm = hrs >= 12 ? "PM" : "AM";
      hrs = hrs % 12 || 12;
      return `${dd}-${mm}-${yyyy} ${String(hrs).padStart(2, "0")}:${mins} ${ampm}`;
    }
  }
  if (callDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(callDate.trim());
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return callDate;
  }
  return "-";
}

function formatTaskLogTimestamp(iso?: string | null): string {
  if (!iso) return "-";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  let hrs = dt.getHours();
  const mins = String(dt.getMinutes()).padStart(2, "0");
  const ampm = hrs >= 12 ? "PM" : "AM";
  hrs = hrs % 12 || 12;
  return `${dd}-${mm}-${yyyy} ${String(hrs).padStart(2, "0")}:${mins} ${ampm}`;
}

function renderStatusPill(statusRaw?: string | null) {
  const status = (statusRaw || "Pending").trim();
  const lower = status.toLowerCase();
  let bg = "#fef3c7";
  let fg = "#92400e";
  if (lower === "approved") {
    bg = "#dcfce7";
    fg = "#166534";
  } else if (lower === "payment pending" || lower === "payment_pending") {
    bg = "#ffedd5";
    fg = "#9a3412";
  } else if (lower === "completed") {
    bg = "#d1fae5";
    fg = "#065f46";
  } else if (lower === "cancel" || lower === "cancelled") {
    bg = "#fee2e2";
    fg = "#991b1b";
  }
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 12px",
        borderRadius: "6px",
        fontSize: "12px",
        fontWeight: 600,
        background: bg,
        color: fg,
        lineHeight: 1.3,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span
      aria-hidden="true"
      style={{
        marginLeft: "6px",
        fontSize: "10px",
        color: active ? "#0d6efd" : "#cbd5e1",
        display: "inline-flex",
        flexDirection: "column",
        lineHeight: 0.85,
        verticalAlign: "middle",
      }}
    >
      <span style={{ opacity: active && dir === "asc" ? 1 : 0.45 }}>▲</span>
      <span style={{ opacity: active && dir === "desc" ? 1 : 0.45 }}>▼</span>
    </span>
  );
}

function TechnicalTaskDetailPageContent() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as { srNo?: number } | null) || null;

  const { isSuperAdmin, hasPermission } = useAuth();
  const isAdminLevel = isSuperAdmin || hasPermission("technicaltask.manage");
  const canAddCallLog =
    isAdminLevel || hasPermission("technicaltask.update") || hasPermission("technicaltask.create");

  const [task, setTask] = useState<TechnicalTask | null>(null);
  const [callLogs, setCallLogs] = useState<TechnicalTaskCallLog[]>([]);
  const [taskLogs, setTaskLogs] = useState<TechnicalTaskLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<SummaryTab>("call_logs");
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortKey, setSortKey] = useState<CallLogSortKey>("sr_no");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Right-side "Add Call Log" drawer state
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [callLogTaskType, setCallLogTaskType] = useState<"Telecall" | "Physical Visit">("Telecall");
  const [callLogRemarks, setCallLogRemarks] = useState<string>("");
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useBodyScrollLock(drawerOpen);

  const loadAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [taskData, callLogRows, taskLogRows] = await Promise.all([
        fetchTechnicalTask(id),
        fetchTaskCallLogs(id),
        fetchTaskLogs(id).catch(() => [] as TechnicalTaskLog[]),
      ]);
      setTask(taskData);
      setCallLogs(callLogRows || []);
      if (taskLogRows && taskLogRows.length > 0) {
        setTaskLogs(taskLogRows);
      } else {
        setTaskLogs([
          {
            id: taskData.id,
            task_id: taskData.id,
            updated_by: taskData.created_by_name || "Admin",
            title: "Create Technical Task",
            status: "Pending",
            created_at: taskData.created_at,
          },
        ]);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Only show user/technician call logs (Telecall / Physical Visit) in Call Log Summary
  const visibleCallLogs = useMemo(() => {
    return callLogs.filter(
      (log) => !SYSTEM_WORKFLOW_CALL_TYPES.has((log.call_type || "").trim().toLowerCase())
    );
  }, [callLogs]);

  const filteredAndSortedCallLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base = visibleCallLogs.map((item, idx) => ({ item, originalIndex: idx + 1 }));
    const filtered = q
      ? base.filter(({ item }) => {
          const formattedDate = formatCallDate(item.call_date, item.created_at).toLowerCase();
          return (
            (item.created_by || "").toLowerCase().includes(q) ||
            (item.remarks || "").toLowerCase().includes(q) ||
            (item.call_type || "").toLowerCase().includes(q) ||
            formattedDate.includes(q)
          );
        })
      : base;

    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "sr_no") {
        cmp = a.originalIndex - b.originalIndex;
      } else if (sortKey === "created_by") {
        cmp = (a.item.created_by || "").localeCompare(b.item.created_by || "");
      } else if (sortKey === "remarks") {
        cmp = (a.item.remarks || "").localeCompare(b.item.remarks || "");
      } else if (sortKey === "call_type") {
        cmp = (a.item.call_type || "").localeCompare(b.item.call_type || "");
      } else if (sortKey === "call_date") {
        const ta = new Date(a.item.created_at || a.item.call_date || 0).getTime();
        const tb = new Date(b.item.created_at || b.item.call_date || 0).getTime();
        cmp = ta - tb;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [visibleCallLogs, searchQuery, sortKey, sortDir]);

  const totalEntries = filteredAndSortedCallLogs.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const paginatedRows = filteredAndSortedCallLogs.slice(startIdx, startIdx + pageSize);
  const showingFrom = totalEntries === 0 ? 0 : startIdx + 1;
  const showingTo = totalEntries === 0 ? 0 : Math.min(startIdx + pageSize, totalEntries);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize]);

  const handleSort = (key: CallLogSortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const handleOpenAddDrawer = () => {
    setCallLogTaskType("Telecall");
    setCallLogRemarks("");
    setDrawerError(null);
    setDrawerOpen(true);
  };

  const handleSubmitCallLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    if (!callLogRemarks.trim()) {
      setDrawerError("Remarks are required.");
      return;
    }
    setSubmitting(true);
    setDrawerError(null);
    try {
      const targetRef = task?.id || id;
      await createTaskCallLog(targetRef, {
        call_type: callLogTaskType,
        remarks: callLogRemarks.trim(),
      });
      const refreshedLogs = await fetchTaskCallLogs(targetRef);
      setCallLogs(refreshedLogs || []);
      setActiveTab("call_logs");
      setDrawerOpen(false);
      setCallLogRemarks("");
      setCallLogTaskType("Telecall");
    } catch (err) {
      setDrawerError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const displayTaskNumber =
    task?.task_number ??
    navState?.srNo ??
    (id && /^\d+$/.test(id) ? Number(id) : task?.id ? task.id.slice(0, 8) : "");

  const machineModelDisplay = useMemo(() => {
    if (!task?.machine_model) return "-";
    if (task.serial_number && task.serial_number.trim()) {
      return `${task.machine_model} | ${task.serial_number.trim()}`;
    }
    return task.machine_model;
  }, [task]);

  return (
    <AppShell activeKey="technical-tasks">
      <main
        className="page-content"
        style={{
          padding: "20px 24px 36px 24px",
          background: "#f8fafc",
          minHeight: "calc(100vh - 64px)",
        }}
      >
        {/* Top Header Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            marginBottom: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              onClick={() => navigate("/technical-task/list")}
              title="Back to Technical Task List"
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                width: "34px",
                height: "34px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "#334155",
                fontSize: "16px",
              }}
            >
              ←
            </button>
            <h1
              style={{
                margin: 0,
                fontSize: "20px",
                fontWeight: 700,
                color: "#1e293b",
              }}
            >
              {displayTaskNumber ? `Technical Task #${displayTaskNumber}` : "Technical Task"}
            </h1>
          </div>

          {canAddCallLog && !loading && task && (
            <button
              type="button"
              data-testid="btn-open-add-call-log"
              onClick={handleOpenAddDrawer}
              style={{
                background: "#0d6efd",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                padding: "9px 18px",
                fontSize: "12.5px",
                fontWeight: 700,
                letterSpacing: "0.3px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 1px 2px rgba(13, 110, 253, 0.25)",
              }}
            >
              + ADD NEW CALL LOG
            </button>
          )}
        </div>

        {loading ? (
          <div
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              padding: "48px 24px",
              textAlign: "center",
              color: "#64748b",
              fontSize: "14px",
            }}
          >
            Loading technical task details...
          </div>
        ) : error || !task ? (
          <div
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #fecaca",
              padding: "32px 24px",
              textAlign: "center",
            }}
          >
            <div style={{ color: "#b91c1c", fontWeight: 600, fontSize: "14.5px", marginBottom: "12px" }}>
              {error || "Technical task not found."}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: "10px" }}>
              <button type="button" className="btn btn-primary" onClick={() => void loadAll()}>
                Retry
              </button>
              <button type="button" className="btn" onClick={() => navigate("/technical-task/list")}>
                Back to List
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(290px, 360px) minmax(0, 1fr)",
              gap: "24px",
              alignItems: "start",
            }}
            className="tech-task-detail-grid"
          >
            <style>{`
              @media (max-width: 960px) {
                .tech-task-detail-grid {
                  grid-template-columns: 1fr !important;
                }
              }
            `}</style>

            {/* LEFT COLUMN: Task Details + Company Details */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Card 1: Task Details */}
              <section
                style={{
                  background: "#ffffff",
                  borderRadius: "8px",
                  border: "1px solid #e2e8f0",
                  boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
                }}
              >
                <div
                  style={{
                    padding: "16px 20px",
                    borderBottom: "1px solid #f1f5f9",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                  }}
                >
                  <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                    Task Details
                  </h2>
                  {renderStatusPill(task.status)}
                </div>

                {/* Nature Of Complain / Description */}
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9" }}>
                  <div style={{ fontSize: "12.5px", color: "#475569", fontWeight: 500 }}>
                    Nature Of Complain / Description
                  </div>
                  <div
                    style={{
                      marginTop: "6px",
                      fontSize: "13.5px",
                      fontWeight: 700,
                      color: "#0f172a",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {task.task_description || "-"}
                  </div>
                </div>

                {/* 6 Key-Value Rows */}
                <div style={{ padding: "6px 20px 14px 20px" }}>
                  {[
                    { label: "Task Type", value: task.task_type || "-" },
                    { label: "Machine & Model", value: machineModelDisplay },
                    { label: "Priority", value: task.priority || "-" },
                    { label: "Created By", value: task.created_by_name || "-" },
                    {
                      label: "Created At",
                      value: formatLongDate(task.task_created_date, task.created_at),
                    },
                    { label: "Assign To", value: task.task_allotted_to || "-" },
                  ].map((row, idx, arr) => (
                    <div
                      key={row.label}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: "14px",
                        padding: "9px 0",
                        borderBottom: idx < arr.length - 1 ? "1px solid #f8fafc" : "none",
                      }}
                    >
                      <span style={{ fontSize: "12.5px", color: "#475569", flexShrink: 0 }}>
                        {row.label}
                      </span>
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: 700,
                          color: "#0f172a",
                          textAlign: "right",
                          wordBreak: "break-word",
                        }}
                      >
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Card 2: Company Details */}
              <section
                style={{
                  background: "#ffffff",
                  borderRadius: "8px",
                  border: "1px solid #e2e8f0",
                  boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
                }}
              >
                <div
                  style={{
                    padding: "16px 20px",
                    borderBottom: "1px solid #f1f5f9",
                  }}
                >
                  <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                    Company Details
                  </h2>
                </div>

                <div style={{ padding: "18px 20px" }}>
                  <div
                    style={{
                      fontSize: "15px",
                      fontWeight: 700,
                      color: "#0f172a",
                      textTransform: "uppercase",
                      wordBreak: "break-word",
                    }}
                  >
                    {task.company_name || "-"}
                  </div>

                  <div
                    style={{
                      marginTop: "12px",
                      fontSize: "13px",
                      color: "#334155",
                      fontWeight: 500,
                    }}
                  >
                    {task.contact_person_name || "-"}
                  </div>

                  <div
                    style={{
                      marginTop: "12px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "13px",
                      color: "#1e293b",
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      style={{ color: "#0f172a", flexShrink: 0 }}
                      aria-hidden="true"
                    >
                      <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1C10.07 21 3 13.93 3 5a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.24 1.01l-2.21 2.2z" />
                    </svg>
                    {task.contact_phone ? (
                      <a
                        href={`tel:${task.contact_phone}`}
                        style={{ color: "#1e293b", textDecoration: "none", fontWeight: 500 }}
                      >
                        {task.contact_phone}
                      </a>
                    ) : (
                      <span>-</span>
                    )}
                  </div>
                </div>
              </section>
            </div>

            {/* RIGHT COLUMN: Call Log Summary & Task Log Summary */}
            <section
              style={{
                background: "#ffffff",
                borderRadius: "8px",
                border: "1px solid #e2e8f0",
                padding: "20px",
                boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
              }}
            >
              {/* Tabs */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setActiveTab("call_logs")}
                  style={{
                    padding: "9px 18px",
                    borderRadius: "6px",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    background: activeTab === "call_logs" ? "#0d6efd" : "transparent",
                    color: activeTab === "call_logs" ? "#ffffff" : "#475569",
                    transition: "all 0.15s ease",
                  }}
                >
                  Call Log Summary
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("task_logs")}
                  style={{
                    padding: "9px 18px",
                    borderRadius: "6px",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    background: activeTab === "task_logs" ? "#0d6efd" : "transparent",
                    color: activeTab === "task_logs" ? "#ffffff" : "#475569",
                    transition: "all 0.15s ease",
                  }}
                >
                  Task Log Summary
                </button>
              </div>

              {activeTab === "call_logs" ? (
                <div style={{ marginTop: "18px" }}>
                  {/* Sub-toolbar: Items/Page + Search */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "12px",
                      marginBottom: "14px",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <select
                        aria-label="Items per page"
                        value={pageSize}
                        onChange={(e) => setPageSize(Number(e.target.value))}
                        style={{
                          padding: "6px 28px 6px 12px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "13px",
                          color: "#1e293b",
                          background: "#ffffff",
                          width: "84px",
                          cursor: "pointer",
                        }}
                      >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                      <span style={{ fontSize: "12px", color: "#475569" }}>Items/Page</span>
                    </div>

                    <div>
                      <input
                        type="text"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                          padding: "7px 12px",
                          borderRadius: "6px",
                          border: "1px solid #e2e8f0",
                          fontSize: "13px",
                          color: "#1e293b",
                          minWidth: "200px",
                          outline: "none",
                        }}
                      />
                    </div>
                  </div>

                  {/* Call Log Summary Table */}
                  <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "4px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ background: "#ffffff", borderBottom: "1px solid #e2e8f0" }}>
                          <th
                            onClick={() => handleSort("sr_no")}
                            style={{
                              padding: "12px 14px",
                              textAlign: "left",
                              fontWeight: 700,
                              color: "#1e293b",
                              borderRight: "1px solid #e2e8f0",
                              width: "70px",
                              cursor: "pointer",
                              userSelect: "none",
                            }}
                          >
                            Sr. No.
                            <SortIcon active={sortKey === "sr_no"} dir={sortDir} />
                          </th>
                          <th
                            onClick={() => handleSort("created_by")}
                            style={{
                              padding: "12px 14px",
                              textAlign: "left",
                              fontWeight: 700,
                              color: "#1e293b",
                              borderRight: "1px solid #e2e8f0",
                              width: "160px",
                              cursor: "pointer",
                              userSelect: "none",
                            }}
                          >
                            Name
                            <SortIcon active={sortKey === "created_by"} dir={sortDir} />
                          </th>
                          <th
                            onClick={() => handleSort("remarks")}
                            style={{
                              padding: "12px 14px",
                              textAlign: "left",
                              fontWeight: 700,
                              color: "#1e293b",
                              borderRight: "1px solid #e2e8f0",
                              cursor: "pointer",
                              userSelect: "none",
                            }}
                          >
                            Remarks
                            <SortIcon active={sortKey === "remarks"} dir={sortDir} />
                          </th>
                          <th
                            onClick={() => handleSort("call_type")}
                            style={{
                              padding: "12px 14px",
                              textAlign: "left",
                              fontWeight: 700,
                              color: "#1e293b",
                              borderRight: "1px solid #e2e8f0",
                              width: "140px",
                              cursor: "pointer",
                              userSelect: "none",
                            }}
                          >
                            Task Type
                            <SortIcon active={sortKey === "call_type"} dir={sortDir} />
                          </th>
                          <th
                            onClick={() => handleSort("call_date")}
                            style={{
                              padding: "12px 14px",
                              textAlign: "left",
                              fontWeight: 700,
                              color: "#1e293b",
                              width: "170px",
                              cursor: "pointer",
                              userSelect: "none",
                            }}
                          >
                            Call Date
                            <SortIcon active={sortKey === "call_date"} dir={sortDir} />
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedRows.length === 0 ? (
                          <tr>
                            <td
                              colSpan={5}
                              style={{
                                padding: "14px",
                                textAlign: "center",
                                background: "#ebeef2",
                                color: "#334155",
                                fontSize: "13px",
                              }}
                            >
                              No Data Available In Table
                            </td>
                          </tr>
                        ) : (
                          paginatedRows.map(({ item, originalIndex }, idx) => (
                            <tr
                              key={item.id}
                              style={{
                                borderTop: idx > 0 ? "1px solid #e2e8f0" : "none",
                                background: idx % 2 === 1 ? "#f8fafc" : "#ffffff",
                              }}
                            >
                              <td
                                style={{
                                  padding: "12px 14px",
                                  borderRight: "1px solid #e2e8f0",
                                  color: "#334155",
                                }}
                              >
                                {originalIndex}
                              </td>
                              <td
                                style={{
                                  padding: "12px 14px",
                                  borderRight: "1px solid #e2e8f0",
                                  color: "#0f172a",
                                  fontWeight: 500,
                                }}
                              >
                                {item.created_by || "-"}
                              </td>
                              <td
                                style={{
                                  padding: "12px 14px",
                                  borderRight: "1px solid #e2e8f0",
                                  color: "#1e293b",
                                  whiteSpace: "pre-wrap",
                                  wordBreak: "break-word",
                                }}
                              >
                                {item.remarks || "-"}
                              </td>
                              <td
                                style={{
                                  padding: "12px 14px",
                                  borderRight: "1px solid #e2e8f0",
                                  color: "#334155",
                                }}
                              >
                                {item.call_type || "-"}
                              </td>
                              <td style={{ padding: "12px 14px", color: "#334155" }}>
                                {formatCallDate(item.call_date, item.created_at)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination Footer */}
                  <div
                    style={{
                      marginTop: "14px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "12px",
                    }}
                  >
                    <div style={{ fontSize: "12.5px", color: "#334155" }}>
                      Showing {showingFrom} To {showingTo} Of {totalEntries} Entries
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <button
                        type="button"
                        disabled={safePage <= 1 || totalEntries === 0}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        style={{
                          padding: "6px 14px",
                          borderRadius: "4px",
                          border: "1px solid #e2e8f0",
                          background: safePage <= 1 || totalEntries === 0 ? "#ebeef2" : "#ffffff",
                          color: safePage <= 1 || totalEntries === 0 ? "#64748b" : "#1e293b",
                          fontSize: "12.5px",
                          cursor: safePage <= 1 || totalEntries === 0 ? "not-allowed" : "pointer",
                        }}
                      >
                        Previous
                      </button>
                      {totalEntries > 0 && (
                        <span
                          style={{
                            padding: "6px 12px",
                            borderRadius: "4px",
                            background: "#0d6efd",
                            color: "#ffffff",
                            fontSize: "12.5px",
                            fontWeight: 600,
                          }}
                        >
                          {safePage}
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={safePage >= totalPages || totalEntries === 0}
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        style={{
                          padding: "6px 14px",
                          borderRadius: "4px",
                          border: "1px solid #e2e8f0",
                          background:
                            safePage >= totalPages || totalEntries === 0 ? "#ebeef2" : "#ffffff",
                          color:
                            safePage >= totalPages || totalEntries === 0 ? "#64748b" : "#1e293b",
                          fontSize: "12.5px",
                          cursor:
                            safePage >= totalPages || totalEntries === 0
                              ? "not-allowed"
                              : "pointer",
                        }}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Tab 2: Task Log Summary */
                <div style={{ marginTop: "18px", overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ background: "#dfe3e8", color: "#1e293b" }}>
                        <th
                          style={{
                            padding: "11px 16px",
                            textAlign: "left",
                            fontWeight: 600,
                            width: "32%",
                          }}
                        >
                          Updated By
                        </th>
                        <th
                          style={{
                            padding: "11px 16px",
                            textAlign: "left",
                            fontWeight: 600,
                            width: "48%",
                          }}
                        >
                          Title
                        </th>
                        <th
                          style={{
                            padding: "11px 16px",
                            textAlign: "left",
                            fontWeight: 600,
                            width: "20%",
                          }}
                        >
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {taskLogs.length === 0 ? (
                        <tr>
                          <td
                            colSpan={3}
                            style={{
                              padding: "16px",
                              textAlign: "center",
                              color: "#64748b",
                              borderBottom: "1px solid #f1f5f9",
                            }}
                          >
                            No Task Logs Available
                          </td>
                        </tr>
                      ) : (
                        taskLogs.map((log) => (
                          <tr key={log.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "14px 16px", verticalAlign: "top" }}>
                              <div style={{ fontWeight: 500, color: "#334155", fontSize: "13px" }}>
                                {log.updated_by || "Admin"}
                              </div>
                              <div
                                style={{
                                  marginTop: "3px",
                                  fontStyle: "italic",
                                  color: "#64748b",
                                  fontSize: "12px",
                                }}
                              >
                                {formatTaskLogTimestamp(log.created_at)}
                              </div>
                            </td>
                            <td
                              style={{
                                padding: "14px 16px",
                                verticalAlign: "top",
                                color: "#1e293b",
                                fontWeight: 500,
                              }}
                            >
                              {log.title}
                            </td>
                            <td style={{ padding: "14px 16px", verticalAlign: "top" }}>
                              {renderStatusPill(log.status)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {/* Right-Side Slide-Over Drawer: Add Call Log */}
        {drawerOpen && (
          <div
            data-testid="add-call-log-drawer-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget && !submitting) {
                setDrawerOpen(false);
              }
            }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 23, 42, 0.45)",
              zIndex: 1200,
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <form
              onSubmit={handleSubmitCallLog}
              style={{
                width: "440px",
                maxWidth: "100vw",
                height: "100vh",
                background: "#ffffff",
                display: "flex",
                flexDirection: "column",
                boxShadow: "-8px 0 28px rgba(15, 23, 42, 0.16)",
              }}
            >
              {/* Drawer Header */}
              <div
                style={{
                  padding: "18px 22px",
                  borderBottom: "1px solid #f1f5f9",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                  Add Call Log
                </h3>
                <button
                  type="button"
                  aria-label="Close Add Call Log"
                  disabled={submitting}
                  onClick={() => setDrawerOpen(false)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "20px",
                    color: "#64748b",
                    cursor: "pointer",
                    lineHeight: 1,
                    padding: "4px",
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Drawer Body */}
              <div style={{ flex: 1, overflowY: "auto", padding: "22px" }}>
                {drawerError && (
                  <div
                    style={{
                      marginBottom: "16px",
                      padding: "10px 12px",
                      borderRadius: "6px",
                      background: "#fee2e2",
                      color: "#991b1b",
                      fontSize: "12.5px",
                      fontWeight: 500,
                    }}
                  >
                    {drawerError}
                  </div>
                )}

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "#334155",
                      marginBottom: "8px",
                    }}
                  >
                    Task Type
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "7px",
                        fontSize: "13.5px",
                        color: "#1e293b",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name="addCallLogTaskType"
                        value="Telecall"
                        checked={callLogTaskType === "Telecall"}
                        onChange={() => setCallLogTaskType("Telecall")}
                        style={{ accentColor: "#0d6efd", cursor: "pointer" }}
                      />
                      Telecall
                    </label>
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "7px",
                        fontSize: "13.5px",
                        color: "#1e293b",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name="addCallLogTaskType"
                        value="Physical Visit"
                        checked={callLogTaskType === "Physical Visit"}
                        onChange={() => setCallLogTaskType("Physical Visit")}
                        style={{ accentColor: "#0d6efd", cursor: "pointer" }}
                      />
                      Physical Visit
                    </label>
                  </div>
                </div>

                <div style={{ marginTop: "20px" }}>
                  <label
                    htmlFor="add-call-log-remarks"
                    style={{
                      display: "block",
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "#334155",
                      marginBottom: "8px",
                    }}
                  >
                    Remarks
                  </label>
                  <textarea
                    id="add-call-log-remarks"
                    rows={4}
                    value={callLogRemarks}
                    onChange={(e) => setCallLogRemarks(e.target.value)}
                    style={{
                      width: "100%",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      padding: "10px 12px",
                      fontSize: "13.5px",
                      color: "#0f172a",
                      boxSizing: "border-box",
                      fontFamily: "inherit",
                      resize: "vertical",
                      outline: "none",
                    }}
                  />
                </div>
              </div>

              {/* Drawer Sticky Footer */}
              <div
                style={{
                  padding: "14px 18px",
                  borderTop: "1px solid #f1f5f9",
                  background: "#ffffff",
                }}
              >
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    width: "100%",
                    padding: "11px 16px",
                    borderRadius: "6px",
                    border: "none",
                    background: "#0d6efd",
                    color: "#ffffff",
                    fontSize: "13.5px",
                    fontWeight: 600,
                    cursor: submitting ? "not-allowed" : "pointer",
                    opacity: submitting ? 0.75 : 1,
                  }}
                >
                  {submitting ? "Submitting..." : "Submit"}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </AppShell>
  );
}

export function TechnicalTaskDetailPage() {
  return (
    <ErrorBoundary title="Failed to render Technical Task Detail">
      <TechnicalTaskDetailPageContent />
    </ErrorBoundary>
  );
}
