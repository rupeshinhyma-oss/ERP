import React, { useEffect, useState } from "react";
import type {
  AvailableUser,
  TaskRecurringSchedule,
  TaskSummary,
} from "@/types/tasks";
import { tasksApi } from "@/lib/tasksApi";
import { RecurringScheduleModal } from "./RecurringScheduleModal";
import { DepartmentBadge } from "./TasksPage";

interface RecurringTasksTabProps {
  onSelectTask: (taskId: string) => void;
  availableUsers: AvailableUser[];
  canManageTasks?: boolean;
}

type SubViewKey = "schedules" | "due_upcoming" | "history";

export const RecurringTasksTab: React.FC<RecurringTasksTabProps> = ({
  onSelectTask,
  availableUsers,
  canManageTasks = true,
}) => {
  const [subView, setSubView] = useState<SubViewKey>("schedules");

  // Schedules state
  const [schedules, setSchedules] = useState<TaskRecurringSchedule[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Instances state
  const [instances, setInstances] = useState<TaskSummary[]>([]);
  const [instancesLoading, setInstancesLoading] = useState(false);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<TaskRecurringSchedule | null>(null);

  // Action status state
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // Load schedules
  const loadSchedules = async () => {
    setSchedulesLoading(true);
    try {
      const data = await tasksApi.fetchRecurringSchedules({
        status: statusFilter === "ALL" ? undefined : statusFilter,
        search: searchQuery.trim() || undefined,
      });
      setSchedules(data || []);
    } catch (err: any) {
      console.error("Failed to load schedules", err);
    } finally {
      setSchedulesLoading(false);
    }
  };

  // Load instances (upcoming vs history)
  const loadInstances = async (isHistory: boolean) => {
    setInstancesLoading(true);
    try {
      const data = await tasksApi.fetchRecurringInstances({
        history_only: isHistory,
      });
      setInstances(data || []);
    } catch (err: any) {
      console.error("Failed to load recurring instances", err);
    } finally {
      setInstancesLoading(false);
    }
  };

  useEffect(() => {
    if (subView === "schedules") {
      loadSchedules();
    } else if (subView === "due_upcoming") {
      loadInstances(false);
    } else if (subView === "history") {
      loadInstances(true);
    }
  }, [subView, statusFilter, searchQuery]);

  const handlePause = async (schedule: TaskRecurringSchedule) => {
    try {
      await tasksApi.pauseRecurringSchedule(schedule.id);
      setActionMessage(`Schedule "${schedule.title}" paused.`);
      loadSchedules();
    } catch (err: any) {
      alert(err.message || "Failed to pause schedule.");
    }
  };

  const handleResume = async (schedule: TaskRecurringSchedule) => {
    try {
      await tasksApi.resumeRecurringSchedule(schedule.id);
      setActionMessage(`Schedule "${schedule.title}" resumed.`);
      loadSchedules();
    } catch (err: any) {
      alert(err.message || "Failed to resume schedule.");
    }
  };

  const handleArchive = async (schedule: TaskRecurringSchedule) => {
    if (!window.confirm(`Archive schedule "${schedule.title}"? Generated tasks will remain preserved.`)) {
      return;
    }
    try {
      await tasksApi.archiveRecurringSchedule(schedule.id);
      setActionMessage(`Schedule "${schedule.title}" archived.`);
      loadSchedules();
    } catch (err: any) {
      alert(err.message || "Failed to archive schedule.");
    }
  };

  const handleRestore = async (schedule: TaskRecurringSchedule) => {
    try {
      const restored = await tasksApi.unarchiveRecurringSchedule(schedule.id);
      setActionMessage(`Schedule "${schedule.title}" restored as ${restored.status}.`);
      loadSchedules();
    } catch (err: any) {
      alert(err.message || "Failed to restore schedule.");
    }
  };

  const handleDelete = async (schedule: TaskRecurringSchedule) => {
    if (!window.confirm(`Delete recurring schedule "${schedule.title}"? Historical generated tasks will remain preserved.`)) {
      return;
    }
    try {
      await tasksApi.deleteRecurringSchedule(schedule.id);
      setActionMessage(`Schedule "${schedule.title}" deleted.`);
      loadSchedules();
    } catch (err: any) {
      alert(err.message || "Failed to delete schedule.");
    }
  };

  const handleTriggerGenerator = async () => {
    setGenerating(true);
    try {
      const res = await tasksApi.generateRecurringTasks();
      setActionMessage(
        `Generated ${res.generated_count} task instances for active schedules.`
      );
      if (subView === "due_upcoming") loadInstances(false);
      else loadSchedules();
    } catch (err: any) {
      alert(err.message || "Failed to trigger generator.");
    } finally {
      setGenerating(false);
    }
  };

  const getUserName = (userId?: string | null): string => {
    if (!userId) return "Unassigned";
    const u = availableUsers.find((user) => user.id === userId);
    return u?.full_name || "Unknown User";
  };

  const formatScheduleRule = (s: TaskRecurringSchedule): string => {
    const cfg = s.recurrence_config || {};
    if (s.frequency === "MONTHLY") {
      if (cfg.day_type === "LAST_DAY") return "Monthly (Last Day)";
      if (cfg.day_type === "LAST_WORKING_DAY") return "Monthly (Last Working Day)";
      return `Monthly (Day ${cfg.day_of_month || 28})`;
    }
    if (s.frequency === "QUARTERLY") {
      const quarters = cfg.quarters?.join(", ") || "All Quarters";
      return `Quarterly (${quarters})`;
    }
    if (s.frequency === "YEARLY") {
      const m = cfg.due_month || 12;
      const d = cfg.due_day || 31;
      return `Yearly (${cfg.year_type === "FINANCIAL" ? "Financial Year" : "Calendar Year"} - Due ${m}/${d})`;
    }
    return s.frequency;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Action Notification Toast */}
      {actionMessage && (
        <div
          style={{
            padding: "10px 16px",
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: "6px",
            fontSize: "13px",
            color: "#1d4ed8",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>✨ {actionMessage}</span>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: "16px" }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Sub-navigation & Header Controls */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          borderBottom: "1px solid #e2e8f0",
          paddingBottom: "12px",
        }}
      >
        {/* View Switcher Buttons */}
        <div style={{ display: "flex", gap: "6px", background: "#f1f5f9", padding: "4px", borderRadius: "8px" }}>
          <button
            type="button"
            onClick={() => setSubView("schedules")}
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              border: "none",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              background: subView === "schedules" ? "#ffffff" : "transparent",
              color: subView === "schedules" ? "#0f172a" : "#64748b",
              boxShadow: subView === "schedules" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}
          >
            📋 Schedules ({schedules.length})
          </button>

          <button
            type="button"
            onClick={() => setSubView("due_upcoming")}
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              border: "none",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              background: subView === "due_upcoming" ? "#ffffff" : "transparent",
              color: subView === "due_upcoming" ? "#0f172a" : "#64748b",
              boxShadow: subView === "due_upcoming" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}
          >
            ⏳ Due / Upcoming
          </button>

          <button
            type="button"
            onClick={() => setSubView("history")}
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              border: "none",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              background: subView === "history" ? "#ffffff" : "transparent",
              color: subView === "history" ? "#0f172a" : "#64748b",
              boxShadow: subView === "history" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}
          >
            📜 History & Audit
          </button>
        </div>

        {/* Global Action Buttons */}
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            type="button"
            onClick={handleTriggerGenerator}
            disabled={generating}
            title="Immediately generate due task instances for active schedules"
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              color: "#334155",
              fontSize: "12.5px",
              fontWeight: 600,
              cursor: generating ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>🔄</span>
            {generating ? "Generating..." : "Run Generator Now"}
          </button>

          {canManageTasks && (
            <button
              type="button"
              onClick={() => {
                setEditingSchedule(null);
                setIsModalOpen(true);
              }}
              style={{
                padding: "6px 14px",
                borderRadius: "6px",
                border: "none",
                background: "#2563eb",
                color: "#ffffff",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              }}
            >
              <span>+</span> New Recurring Schedule
            </button>
          )}
        </div>
      </div>

      {/* --- SUBVIEW 1: SCHEDULES --- */}
      {subView === "schedules" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {/* Filters Bar */}
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="Search schedules by title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: 1,
                minWidth: "220px",
                padding: "7px 12px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                fontSize: "13px",
              }}
            />

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                padding: "7px 10px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                fontSize: "13px",
                background: "#ffffff",
              }}
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>

          {/* Table Container */}
          <div
            style={{
              overflowX: "auto",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              background: "#ffffff",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#64748b", fontSize: "12px" }}>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>SCHEDULE & FREQUENCY</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>RULE / CADENCE</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>ASSIGNEE</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>REVIEWER</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>NEXT DUE DATE</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>DEPARTMENT</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>STATUS</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600, textAlign: "right" }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {schedulesLoading ? (
                  <tr>
                    <td colSpan={8} style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
                      Loading schedules...
                    </td>
                  </tr>
                ) : schedules.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: "40px 20px", textAlign: "center", color: "#64748b" }}>
                      <div style={{ fontSize: "28px", marginBottom: "8px" }}>📅</div>
                      <div style={{ fontWeight: 600, color: "#1e293b", fontSize: "14px" }}>No recurring schedules found</div>
                      <div style={{ fontSize: "12px", marginTop: "4px" }}>
                        Click <strong>"+ New Recurring Schedule"</strong> to establish monthly, quarterly, or yearly task schedules.
                      </div>
                    </td>
                  </tr>
                ) : (
                  schedules.map((s) => (
                    <tr
                      key={s.id}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        transition: "background 0.15s ease",
                      }}
                    >
                      {/* Title & Frequency */}
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ fontWeight: 600, color: "#0f172a" }}>{s.title}</div>
                        <div style={{ display: "flex", gap: "6px", marginTop: "3px" }}>
                          <span
                            style={{
                              fontSize: "10.5px",
                              padding: "1px 6px",
                              borderRadius: "4px",
                              background:
                                s.frequency === "MONTHLY"
                                  ? "#eff6ff"
                                  : s.frequency === "QUARTERLY"
                                  ? "#fdf4ff"
                                  : "#fef3c7",
                              color:
                                s.frequency === "MONTHLY"
                                  ? "#1d4ed8"
                                  : s.frequency === "QUARTERLY"
                                  ? "#a21caf"
                                  : "#92400e",
                              fontWeight: 600,
                            }}
                          >
                            {s.frequency}
                          </span>
                          <span
                            style={{
                              fontSize: "10.5px",
                              padding: "1px 6px",
                              borderRadius: "4px",
                              background:
                                s.priority === "CRITICAL"
                                  ? "#fee2e2"
                                  : s.priority === "HIGH"
                                  ? "#ffedd5"
                                  : "#f1f5f9",
                              color:
                                s.priority === "CRITICAL"
                                  ? "#b91c1c"
                                  : s.priority === "HIGH"
                                  ? "#c2410c"
                                  : "#475569",
                              fontWeight: 600,
                            }}
                          >
                            {s.priority}
                          </span>
                        </div>
                      </td>

                      {/* Rule / Cadence */}
                      <td style={{ padding: "10px 14px", color: "#334155", fontSize: "12px" }}>
                        {formatScheduleRule(s)}
                      </td>

                      {/* Assignee */}
                      <td style={{ padding: "10px 14px", color: "#1e293b", fontSize: "12.5px" }}>
                        {getUserName(s.assignee_id)}
                      </td>

                      {/* Reviewer */}
                      <td style={{ padding: "10px 14px", color: "#475569", fontSize: "12.5px" }}>
                        {getUserName(s.manager_id)}
                      </td>

                      {/* Next Due Date */}
                      <td style={{ padding: "10px 14px", fontSize: "12.5px" }}>
                        {s.next_due_date ? (
                          <span style={{ fontWeight: 600, color: "#0f172a" }}>
                            {s.next_due_date}
                          </span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                        {s.next_period && (
                          <div style={{ fontSize: "10.5px", color: "#64748b" }}>
                            Period: {s.next_period}
                          </div>
                        )}
                      </td>

                      {/* Department */}
                      <td style={{ padding: "10px 14px" }}>
                        <DepartmentBadge department={s.department || "General"} />
                      </td>

                      {/* Status */}
                      <td style={{ padding: "10px 14px" }}>
                        <span
                          style={{
                            fontSize: "11px",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            fontWeight: 700,
                            background:
                              s.status === "ACTIVE"
                                ? "#dcfce7"
                                : s.status === "PAUSED"
                                ? "#fef3c7"
                                : "#f1f5f9",
                            color:
                              s.status === "ACTIVE"
                                ? "#15803d"
                                : s.status === "PAUSED"
                                ? "#b45309"
                                : "#64748b",
                          }}
                        >
                          {s.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: "6px" }}>
                          <button
                            type="button"
                            title={canManageTasks ? "Edit schedule" : "View schedule"}
                            onClick={() => {
                              setEditingSchedule(s);
                              setIsModalOpen(true);
                            }}
                            style={{
                              background: "#f8fafc",
                              border: "1px solid #cbd5e1",
                              borderRadius: "4px",
                              padding: "4px 8px",
                              cursor: "pointer",
                              fontSize: "12px",
                            }}
                          >
                            ✏️ {canManageTasks ? "Edit" : "View"}
                          </button>

                          {s.status === "ARCHIVED" ? (
                            canManageTasks && (
                              <button
                                type="button"
                                title="Restore schedule"
                                onClick={() => handleRestore(s)}
                                style={{
                                  background: "#eff6ff",
                                  border: "1px solid #bfdbfe",
                                  color: "#1d4ed8",
                                  borderRadius: "4px",
                                  padding: "4px 8px",
                                  cursor: "pointer",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                ♻️ Restore
                              </button>
                            )
                          ) : (
                            canManageTasks && (
                              <>
                                {s.status === "ACTIVE" ? (
                                  <button
                                    type="button"
                                    title="Pause schedule"
                                    onClick={() => handlePause(s)}
                                    style={{
                                      background: "#fef3c7",
                                      border: "1px solid #fde68a",
                                      color: "#b45309",
                                      borderRadius: "4px",
                                      padding: "4px 8px",
                                      cursor: "pointer",
                                      fontSize: "12px",
                                    }}
                                  >
                                    ⏸️ Pause
                                  </button>
                                ) : s.status === "PAUSED" ? (
                                  <button
                                    type="button"
                                    title="Resume schedule"
                                    onClick={() => handleResume(s)}
                                    style={{
                                      background: "#dcfce7",
                                      border: "1px solid #bbf7d0",
                                      color: "#15803d",
                                      borderRadius: "4px",
                                      padding: "4px 8px",
                                      cursor: "pointer",
                                      fontSize: "12px",
                                    }}
                                  >
                                    ▶️ Resume
                                  </button>
                                ) : null}

                                <button
                                  type="button"
                                  title="Archive schedule"
                                  onClick={() => handleArchive(s)}
                                  style={{
                                    background: "#f1f5f9",
                                    border: "1px solid #cbd5e1",
                                    color: "#64748b",
                                    borderRadius: "4px",
                                    padding: "4px 8px",
                                    cursor: "pointer",
                                    fontSize: "12px",
                                  }}
                                >
                                  📦
                                </button>
                              </>
                            )
                          )}

                          {canManageTasks && (
                            <button
                              type="button"
                              title="Delete schedule"
                              onClick={() => handleDelete(s)}
                              style={{
                                background: "#fee2e2",
                                border: "1px solid #fecaca",
                                color: "#b91c1c",
                                borderRadius: "4px",
                                padding: "4px 8px",
                                cursor: "pointer",
                                fontSize: "12px",
                              }}
                            >
                              🗑️
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

      {/* --- SUBVIEW 2: DUE / UPCOMING INSTANCES --- */}
      {subView === "due_upcoming" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ fontSize: "12.5px", color: "#64748b" }}>
            Active task instances generated from recurring schedules awaiting work, review, or verification. Click any row to open the Task Detail Drawer.
          </div>

          <div
            style={{
              overflowX: "auto",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              background: "#ffffff",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#64748b", fontSize: "12px" }}>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>TASK TITLE & RECURRENCE PERIOD</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>STATUS</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>PRIORITY</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>DUE DATE</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>ASSIGNEES</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>ESCALATIONS</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600, textAlign: "right" }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {instancesLoading ? (
                  <tr>
                    <td colSpan={7} style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
                      Loading upcoming instances...
                    </td>
                  </tr>
                ) : instances.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: "40px 20px", textAlign: "center", color: "#64748b" }}>
                      <div style={{ fontSize: "28px", marginBottom: "8px" }}>🎉</div>
                      <div style={{ fontWeight: 600, color: "#1e293b", fontSize: "14px" }}>No active recurring tasks due</div>
                      <div style={{ fontSize: "12px", marginTop: "4px" }}>
                        All current recurring tasks have been completed, or the next cycle has not yet arrived.
                      </div>
                    </td>
                  </tr>
                ) : (
                  instances.map((task) => (
                    <tr
                      key={task.id}
                      onClick={() => onSelectTask(task.id)}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        cursor: "pointer",
                        transition: "background 0.15s ease",
                      }}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#f8fafc")}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                    >
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ fontWeight: 600, color: "#0f172a" }}>{task.title}</div>
                        {task.recurrence_period && (
                          <span
                            style={{
                              display: "inline-block",
                              marginTop: "2px",
                              fontSize: "11px",
                              fontWeight: 600,
                              background: "#f1f5f9",
                              color: "#475569",
                              padding: "1px 6px",
                              borderRadius: "4px",
                            }}
                          >
                            Period: {task.recurrence_period}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <span
                          style={{
                            fontSize: "11px",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            fontWeight: 700,
                            background:
                              task.status === "IN_PROGRESS"
                                ? "#eff6ff"
                                : task.status === "REVIEW"
                                ? "#fdf4ff"
                                : task.status === "ON_HOLD"
                                ? "#fffbeb"
                                : "#f1f5f9",
                            color:
                              task.status === "IN_PROGRESS"
                                ? "#2563eb"
                                : task.status === "REVIEW"
                                ? "#a21caf"
                                : task.status === "ON_HOLD"
                                ? "#d97706"
                                : "#64748b",
                          }}
                        >
                          {task.status}
                        </span>
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: "12px" }}>
                        <span style={{ fontWeight: 600 }}>{task.priority}</span>
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: "12.5px" }}>
                        <span style={{ fontWeight: 600, color: "#0f172a" }}>{task.due_date || "—"}</span>
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: "12px", color: "#334155" }}>
                        {task.assignees?.map((a) => a.user?.full_name || a.user_id).join(", ") || "—"}
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: "12px" }}>
                        {task.escalation_count > 0 ? (
                          <span style={{ color: "#b91c1c", fontWeight: 700 }}>
                            ⚠️ {task.escalation_count} Escalate
                          </span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>None</span>
                        )}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectTask(task.id);
                          }}
                          style={{
                            background: "#eff6ff",
                            color: "#1d4ed8",
                            border: "1px solid #bfdbfe",
                            borderRadius: "4px",
                            padding: "4px 10px",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Open Task &rarr;
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- SUBVIEW 3: HISTORY & AUDIT --- */}
      {subView === "history" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ fontSize: "12.5px", color: "#64748b" }}>
            Completed and manager-verified historical recurring task periods. Each period is preserved with full audit trails.
          </div>

          <div
            style={{
              overflowX: "auto",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              background: "#ffffff",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#64748b", fontSize: "12px" }}>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>TASK TITLE & RECURRENCE PERIOD</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>PERIOD DUE DATE</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>COMPLETION STATUS</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>APPROVAL / VERIFICATION</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600 }}>ESCALATION HISTORY</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600, textAlign: "right" }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {instancesLoading ? (
                  <tr>
                    <td colSpan={6} style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
                      Loading history...
                    </td>
                  </tr>
                ) : instances.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: "40px 20px", textAlign: "center", color: "#64748b" }}>
                      <div style={{ fontSize: "28px", marginBottom: "8px" }}>📜</div>
                      <div style={{ fontWeight: 600, color: "#1e293b", fontSize: "14px" }}>No historical completed instances yet</div>
                      <div style={{ fontSize: "12px", marginTop: "4px" }}>
                        Completed instances from past monthly, quarterly, or yearly schedules will appear here.
                      </div>
                    </td>
                  </tr>
                ) : (
                  instances.map((task) => (
                    <tr
                      key={task.id}
                      onClick={() => onSelectTask(task.id)}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        cursor: "pointer",
                        transition: "background 0.15s ease",
                      }}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#f8fafc")}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                    >
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ fontWeight: 600, color: "#0f172a" }}>{task.title}</div>
                        {task.recurrence_period && (
                          <span
                            style={{
                              display: "inline-block",
                              marginTop: "2px",
                              fontSize: "11px",
                              fontWeight: 600,
                              background: "#f0fdf4",
                              color: "#166534",
                              padding: "1px 6px",
                              borderRadius: "4px",
                            }}
                          >
                            Period: {task.recurrence_period}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: "12.5px", color: "#334155" }}>
                        {task.due_date || "—"}
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <span
                          style={{
                            fontSize: "11px",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            fontWeight: 700,
                            background: "#dcfce7",
                            color: "#15803d",
                          }}
                        >
                          ✅ Completed
                        </span>
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <span
                          style={{
                            fontSize: "11px",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            fontWeight: 700,
                            background:
                              task.approval_status === "APPROVED"
                                ? "#dbeafe"
                                : task.approval_status === "PENDING_APPROVAL"
                                ? "#fef3c7"
                                : "#f1f5f9",
                            color:
                              task.approval_status === "APPROVED"
                                ? "#1d4ed8"
                                : task.approval_status === "PENDING_APPROVAL"
                                ? "#b45309"
                                : "#64748b",
                          }}
                        >
                          {task.approval_status === "APPROVED"
                            ? "Verified by Manager"
                            : task.approval_status === "PENDING_APPROVAL"
                            ? "Awaiting Verification"
                            : "Standard Completed"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: "12px", color: "#64748b" }}>
                        {task.escalation_count > 0 ? `${task.escalation_count} recorded` : "Clean SLA"}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectTask(task.id);
                          }}
                          style={{
                            background: "#f1f5f9",
                            color: "#334155",
                            border: "1px solid #cbd5e1",
                            borderRadius: "4px",
                            padding: "4px 10px",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          View Drawer &rarr;
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Schedule Create / Edit Modal */}
      {isModalOpen && (
        <RecurringScheduleModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setEditingSchedule(null);
          }}
          onSuccess={() => {
            loadSchedules();
            setActionMessage(
              editingSchedule
                ? `Schedule "${editingSchedule.title}" updated successfully.`
                : "New recurring task schedule created."
            );
          }}
          scheduleToEdit={editingSchedule}
          availableUsers={availableUsers}
        />
      )}
    </div>
  );
};
