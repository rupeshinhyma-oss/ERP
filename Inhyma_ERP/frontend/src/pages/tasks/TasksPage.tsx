import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Banner } from "@/components/ui";
import { Pagination } from "@/components/Pagination";
import { useAuth } from "@/lib/hooks";
import { liveClient } from "@/lib/live/liveClient";
import { tasksApi } from "@/lib/tasksApi";
import { BulkActionBar } from "@/components/BulkActionBar";
import { TaskGanttView } from "@/components/TaskGanttView";
import { TaskWorkloadDashboard } from "@/components/TaskWorkloadDashboard";
import type {
  AvailableUser,
  IssueType,
  TaskBulkActionRequest,
  TaskDetail,
  TaskLabel,
  TaskPriority,
  TaskSavedFilter,
  TaskSprint,
  TaskStatus,
  TaskSummary,
} from "@/types/tasks";
import { isTaskOverdue } from "@/types/tasks";
import { CreateTaskModal } from "./CreateTaskModal";
import { EscalateTaskModal } from "./EscalateTaskModal";
import { TaskDrawer } from "./TaskDrawer";

type TabKey =
  | "my"
  | "department"
  | "organization"
  | "backlog"
  | "sprint"
  | "future_sprint"
  | "gantt"
  | "workload"
  | "kanban"
  | "calendar";

const STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  ON_HOLD: "⏸️ On Hold",
  REVIEW: "In Review",
  PENDING_APPROVAL: "⏳ Pending Approval",
  DONE: "Completed",
};

const KANBAN_COLUMNS: { key: TaskStatus; label: string; color: string }[] = [
  { key: "TODO", label: "To Do", color: "#64748b" },
  { key: "IN_PROGRESS", label: "In Progress", color: "#2563eb" },
  { key: "ON_HOLD", label: "On Hold", color: "#d97706" },
  { key: "DONE", label: "Completed", color: "#16a34a" },
];

export type ScopeKey = "OWN" | "SELECTED_DEPT" | "MULTI_DEPT" | "ENTIRE_ORG";

export const TasksPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission, isSuperAdmin, profile } = useAuth();

  // Tab state synced with URL ?tab=...
  const tabParam = (searchParams.get("tab") as TabKey) || "my";
  const [activeTab, setActiveTab] = useState<TabKey>(tabParam);

  // RBAC Permission Scope State
  const [scope, setScope] = useState<ScopeKey>("OWN");
  const [departmentFilter, setDepartmentFilter] = useState<string>("");
  const [deptSubView, setDeptSubView] = useState<"list" | "kanban" | "calendar" | "analytics">("list");

  // Data & loading
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "">("");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("");
  const [dueDateFilter, setDueDateFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // V2.0 Sprints, Labels, Saved Filters, Selection
  const [availableLabels, setAvailableLabels] = useState<TaskLabel[]>([]);
  const [availableSprints, setAvailableSprints] = useState<TaskSprint[]>([]);
  const [savedFilters, setSavedFilters] = useState<TaskSavedFilter[]>([]);
  const [selectedSavedFilterId, setSelectedSavedFilterId] = useState<string | null>(null);

  const [issueTypeFilter, setIssueTypeFilter] = useState<IssueType | "">("");
  const [labelFilter, setLabelFilter] = useState<string>("");
  const [sprintFilter, setSprintFilter] = useState<string>("");

  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);

  // Modals & Drawer
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [escalatingTask, setEscalatingTask] = useState<TaskDetail | null>(null);

  // Users for filter dropdowns
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);

  // Calendar specific state
  const [calendarDate, setCalendarDate] = useState(() => new Date());

  // Permissions
  const canViewDept =
    hasPermission("task.department_view") ||
    hasPermission("task.organization_view") ||
    hasPermission("task.manage") ||
    isSuperAdmin;

  const canViewOrg =
    hasPermission("task.organization_view") ||
    hasPermission("task.manage") ||
    isSuperAdmin;

  // Derived list of unique departments from ERP team members
  const departmentsList = React.useMemo(() => {
    const depts = new Set<string>();
    availableUsers.forEach((u) => {
      if (u.department && u.department !== "Staff") {
        depts.add(u.department);
      }
    });
    return Array.from(depts).sort();
  }, [availableUsers]);

  // Sync tab with URL
  useEffect(() => {
    const t = searchParams.get("tab") as TabKey;
    if (t && ["my", "department", "organization", "kanban", "calendar"].includes(t)) {
      setActiveTab(t);
      if (t === "my") setScope("OWN");
      else if (t === "department") setScope("SELECTED_DEPT");
      else if (t === "organization") setScope("ENTIRE_ORG");
    }
  }, [searchParams]);

  const handleTabChange = (nextTab: TabKey) => {
    setActiveTab(nextTab);
    if (nextTab === "my") setScope("OWN");
    else if (nextTab === "department") setScope("SELECTED_DEPT");
    else if (nextTab === "organization") setScope("ENTIRE_ORG");
    setSearchParams((prev) => {
      prev.set("tab", nextTab);
      return prev;
    });
    setPage(1);
  };

  const handleScopeChange = (nextScope: ScopeKey) => {
    setScope(nextScope);
    if (nextScope === "OWN") handleTabChange("my");
    else if (nextScope === "SELECTED_DEPT" || nextScope === "MULTI_DEPT") handleTabChange("department");
    else if (nextScope === "ENTIRE_ORG") handleTabChange("organization");
  };

  // Load available ERP users and V2.0 options
  useEffect(() => {
    Promise.all([
      tasksApi.getAvailableAssignees().catch(() => []),
      tasksApi.fetchLabels().catch(() => []),
      tasksApi.fetchSprints().catch(() => []),
      tasksApi.fetchSavedFilters().catch(() => []),
    ])
      .then(([users, labels, sprints, filters]) => {
        setAvailableUsers(users);
        setAvailableLabels(labels);
        setAvailableSprints(sprints);
        setSavedFilters(filters);
      })
      .catch((err) => console.error("Failed to load task metadata", err));
  }, []);

  // Fetch tasks according to current tab & filters
  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Determine backend view mode
      let viewMode: "all" | "my" | "department" | "organization" | "kanban" | "calendar" = "all";
      if (activeTab === "my") viewMode = "my";
      else if (activeTab === "department") {
        if (deptSubView === "kanban") viewMode = "kanban";
        else if (deptSubView === "calendar") viewMode = "calendar";
        else viewMode = "department";
      }
      else if (activeTab === "organization") viewMode = "organization";
      else if (activeTab === "kanban") viewMode = "kanban";
      else if (activeTab === "calendar") viewMode = "calendar";

      let isBacklogVal: boolean | undefined = undefined;
      let sprintIdVal: string | undefined = sprintFilter || undefined;

      if (activeTab === "backlog") {
        isBacklogVal = true;
      } else if (activeTab === "sprint") {
        const activeSprint = availableSprints.find((s) => s.status === "ACTIVE");
        if (activeSprint) sprintIdVal = activeSprint.id;
      } else if (activeTab === "future_sprint") {
        const plannedSprint = availableSprints.find((s) => s.status === "PLANNED");
        if (plannedSprint) sprintIdVal = plannedSprint.id;
      }

      const limit =
        activeTab === "kanban" ||
        activeTab === "calendar" ||
        activeTab === "gantt" ||
        (activeTab === "department" && (deptSubView === "kanban" || deptSubView === "calendar"))
          ? 250
          : pageSize;

      const res = await tasksApi.getTasks({
        view: viewMode,
        search: searchQuery.trim() || undefined,
        status: statusFilter || undefined,
        priority: priorityFilter || undefined,
        issue_type: issueTypeFilter || undefined,
        label_id: labelFilter || undefined,
        sprint_id: sprintIdVal,
        is_backlog: isBacklogVal,
        assignee_id: assigneeFilter || undefined,
        due_date_to: dueDateFilter || undefined,
        page:
          activeTab === "kanban" ||
          activeTab === "calendar" ||
          activeTab === "gantt" ||
          (activeTab === "department" && deptSubView !== "list")
            ? 1
            : page,
        page_size: limit,
      });

      let filteredItems = res.items;
      if (departmentFilter) {
        filteredItems = filteredItems.filter((t) => {
          return t.assignees.some((a) => {
            const userObj = availableUsers.find((u) => u.id === a.user_id);
            return userObj?.department === departmentFilter;
          });
        });
      }

      setTasks(filteredItems);
      setTotalCount(departmentFilter ? filteredItems.length : res.total);
    } catch (err: unknown) {
      console.error("Failed to fetch tasks", err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [
    activeTab,
    deptSubView,
    searchQuery,
    statusFilter,
    priorityFilter,
    issueTypeFilter,
    labelFilter,
    sprintFilter,
    availableSprints,
    assigneeFilter,
    dueDateFilter,
    departmentFilter,
    availableUsers,
    page,
    pageSize,
  ]);

  const handleAssignMe = async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    if (!profile?.id) return;
    try {
      await tasksApi.assignTask(taskId, [profile.id]);
      fetchTasks();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to assign task");
    }
  };

  const handleComplete = async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    try {
      await tasksApi.updateTask(taskId, { status: "DONE" });
      fetchTasks();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to complete task");
    }
  };

  const handleDuplicate = async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    try {
      await tasksApi.duplicateTask(taskId);
      fetchTasks();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to duplicate task");
    }
  };

  const handleExecuteBulkAction = async (payload: TaskBulkActionRequest) => {
    try {
      await tasksApi.executeBulkAction(payload);
      setSelectedTaskIds([]);
      fetchTasks();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to execute bulk action");
    }
  };

  const handleSaveFilter = async () => {
    const name = window.prompt("Enter a name for this saved filter:", "My Custom Filter");
    if (!name || !name.trim()) return;
    try {
      const created = await tasksApi.createSavedFilter({
        name: name.trim(),
        filter_json: {
          searchQuery,
          statusFilter,
          priorityFilter,
          issueTypeFilter,
          labelFilter,
          assigneeFilter,
        },
      });
      setSavedFilters((prev) => [...prev, created]);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to save filter");
    }
  };

  const handleApplySavedFilter = (f: TaskSavedFilter) => {
    setSelectedSavedFilterId(f.id);
    const json = f.filter_config || f.filter_json || {};
    setSearchQuery(json.searchQuery || "");
    setStatusFilter(json.statusFilter || "");
    setPriorityFilter(json.priorityFilter || "");
    setIssueTypeFilter(json.issueTypeFilter || "");
    setLabelFilter(json.labelFilter || "");
    setAssigneeFilter(json.assigneeFilter || "");
  };

  const handleDeleteSavedFilter = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("Delete this saved filter?")) return;
    try {
      await tasksApi.deleteSavedFilter(id);
      setSavedFilters((prev) => prev.filter((f) => f.id !== id));
      if (selectedSavedFilterId === id) setSelectedSavedFilterId(null);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to delete filter");
    }
  };

  const handleToggleSelectTask = (taskId: string) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  };

  const handleSelectAllTasks = () => {
    if (selectedTaskIds.length === tasks.length) {
      setSelectedTaskIds([]);
    } else {
      setSelectedTaskIds(tasks.map((t) => t.id));
    }
  };


  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // WebSocket Live Updates
  useEffect(() => {
    liveClient.subscribe("tasks");
    if (profile?.id) {
      liveClient.subscribe(`user:${profile.id}`);
    }

    const unsub = liveClient.onEvent((event) => {
      if (
        event.entity === "task" ||
        event.event_type?.startsWith("TASK_") ||
        (profile?.id && event.user_id === profile.id)
      ) {
        fetchTasks();
      }
    });

    return () => unsub();
  }, [profile?.id, fetchTasks]);

  const handleDeleteTask = async (e: React.MouseEvent, t: TaskSummary) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete task "${t.title}"?`)) return;
    try {
      await tasksApi.deleteTask(t.id);
      fetchTasks();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to delete task");
    }
  };

  const handleOpenEscalate = (e: React.MouseEvent, t: TaskSummary) => {
    e.stopPropagation();
    tasksApi.getTask(t.id).then((detail) => {
      setEscalatingTask(detail);
    });
  };

  const handleQuickStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    try {
      await tasksApi.updateTask(taskId, { status: newStatus });
      fetchTasks();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to update status");
    }
  };

  // Calendar Helpers
  const calYear = calendarDate.getFullYear();
  const calMonth = calendarDate.getMonth();
  const firstDayOfMonth = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(calYear, calMonth, 0).getDate();

  const calendarCells = [];
  // Previous month trailing days
  for (let i = firstDayOfMonth - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    calendarCells.push({ day: d, currentMonth: false, dateKey: "" });
  }
  // Current month days
  for (let i = 1; i <= daysInMonth; i++) {
    const monthPadded = String(calMonth + 1).padStart(2, "0");
    const dayPadded = String(i).padStart(2, "0");
    const dateKey = `${calYear}-${monthPadded}-${dayPadded}`;
    calendarCells.push({ day: i, currentMonth: true, dateKey });
  }
  // Next month leading days
  const remainingCells = 42 - calendarCells.length;
  for (let i = 1; i <= remainingCells; i++) {
    calendarCells.push({ day: i, currentMonth: false, dateKey: "" });
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  // Active view determination
  const isTableActive =
    activeTab === "my" ||
    activeTab === "organization" ||
    activeTab === "backlog" ||
    activeTab === "sprint" ||
    activeTab === "future_sprint" ||
    (activeTab === "department" && deptSubView === "list");

  const isKanbanActive =
    activeTab === "kanban" ||
    (activeTab === "department" && deptSubView === "kanban");

  const isCalendarActive =
    activeTab === "calendar" ||
    (activeTab === "department" && deptSubView === "calendar");

  const isAnalyticsActive =
    activeTab === "department" && deptSubView === "analytics";

  // Analytics calculations for Department tab
  const analyticsData = React.useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "DONE").length;
    const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
    const onHold = tasks.filter((t) => t.status === "ON_HOLD").length;
    const todo = tasks.filter((t) => t.status === "TODO").length;
    const overdue = tasks.filter((t) => isTaskOverdue(t.due_date, t.status)).length;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

    const memberMap = new Map<
      string,
      { name: string; total: number; done: number; inProgress: number; onHold: number }
    >();
    tasks.forEach((t) => {
      t.assignees
        .filter((a) => a.assignment_role !== "WATCHER")
        .forEach((a) => {
          const uId = a.user_id;
          const name = a.user?.full_name || a.user?.username || "Team Member";
          if (!memberMap.has(uId)) {
            memberMap.set(uId, { name, total: 0, done: 0, inProgress: 0, onHold: 0 });
          }
          const item = memberMap.get(uId)!;
          item.total += 1;
          if (t.status === "DONE") item.done += 1;
          else if (t.status === "IN_PROGRESS") item.inProgress += 1;
          else if (t.status === "ON_HOLD") item.onHold += 1;
        });
    });

    return {
      total,
      completed,
      inProgress,
      onHold,
      todo,
      overdue,
      rate,
      members: Array.from(memberMap.values()).sort((a, b) => b.total - a.total),
    };
  }, [tasks]);

  return (
    <AppShell activeKey="tasks" pageClassName="page-tasks">
      <main className="page">
        {/* Breadcrumb matching ERP standard */}
        <Breadcrumb trail={["Dashboard", "Work Management", "Tasks"]} />

        {/* Page Header */}
        <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 700, color: "#0f172a" }}>Tasks</h1>
            <div className="page-subtitle" style={{ fontSize: "13px", color: "#64748b", marginTop: "4px" }}>
              Manage team tasks, subtasks and escalations.
            </div>
          </div>
          <div className="page-header-actions">
            <button
              className="btn btn-primary"
              onClick={() => setIsCreateOpen(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 600 }}
            >
              + New Task
            </button>
          </div>
        </div>

        <Banner error={error} />

        {/* Department & Organization Permission Scope Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            padding: "8px 14px",
            marginBottom: "14px",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>
            🔭 Permission Scope:
          </span>
          {[
            { key: "OWN", label: "Own Tasks", icon: "👤", allowed: true },
            { key: "SELECTED_DEPT", label: "Selected Department", icon: "🏛️", allowed: canViewDept },
            { key: "MULTI_DEPT", label: "Multiple Departments", icon: "📑", allowed: canViewDept },
            { key: "ENTIRE_ORG", label: "Entire Organization", icon: "🏢", allowed: canViewOrg },
          ]
            .filter((s) => s.allowed)
            .map((s) => {
              const isActive = scope === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => handleScopeChange(s.key as ScopeKey)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: "6px",
                    border: isActive ? "1px solid #2563eb" : "1px solid #cbd5e1",
                    background: isActive ? "#eff6ff" : "#ffffff",
                    color: isActive ? "#1d4ed8" : "#475569",
                    fontWeight: isActive ? 700 : 500,
                    fontSize: "12px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    boxShadow: isActive ? "0 1px 2px rgba(37,99,235,0.12)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span>{s.icon}</span>
                  <span>{s.label}</span>
                </button>
              );
            })}
        </div>

        {/* Saved Filters Quick Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            overflowX: "auto",
            padding: "6px 2px",
            marginBottom: "12px",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
            Quick Views:
          </span>
          <button
            type="button"
            onClick={() => {
              setSelectedSavedFilterId(null);
              setSearchQuery("");
              setStatusFilter("");
              setPriorityFilter("");
              setIssueTypeFilter("");
              setLabelFilter("");
              setSprintFilter("");
              setAssigneeFilter("");
            }}
            style={{
              padding: "3px 10px",
              borderRadius: "14px",
              fontSize: "12px",
              fontWeight: selectedSavedFilterId === null ? 700 : 500,
              background: selectedSavedFilterId === null ? "#e0e7ff" : "#f1f5f9",
              color: selectedSavedFilterId === null ? "#3730a3" : "#475569",
              border: "1px solid #cbd5e1",
              cursor: "pointer",
            }}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedSavedFilterId("bugs");
              setIssueTypeFilter("BUG");
              setPriorityFilter("HIGH");
            }}
            style={{
              padding: "3px 10px",
              borderRadius: "14px",
              fontSize: "12px",
              fontWeight: selectedSavedFilterId === "bugs" ? 700 : 500,
              background: selectedSavedFilterId === "bugs" ? "#fee2e2" : "#f1f5f9",
              color: selectedSavedFilterId === "bugs" ? "#991b1b" : "#475569",
              border: "1px solid #cbd5e1",
              cursor: "pointer",
            }}
          >
            🐞 Urgent Bugs
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedSavedFilterId("pending_approval");
              setStatusFilter("PENDING_APPROVAL" as any);
            }}
            style={{
              padding: "3px 10px",
              borderRadius: "14px",
              fontSize: "12px",
              fontWeight: selectedSavedFilterId === "pending_approval" ? 700 : 500,
              background: selectedSavedFilterId === "pending_approval" ? "#faf5ff" : "#f1f5f9",
              color: selectedSavedFilterId === "pending_approval" ? "#6b21a8" : "#475569",
              border: "1px solid #cbd5e1",
              cursor: "pointer",
            }}
          >
            ⏳ Pending Approval
          </button>

          {/* User Custom Saved Filters */}
          {savedFilters.map((f) => (
            <div key={f.id} style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>
              <button
                type="button"
                onClick={() => handleApplySavedFilter(f)}
                style={{
                  padding: "3px 10px",
                  borderRadius: "14px",
                  fontSize: "12px",
                  fontWeight: selectedSavedFilterId === f.id ? 700 : 500,
                  background: selectedSavedFilterId === f.id ? "#dbeafe" : "#f1f5f9",
                  color: selectedSavedFilterId === f.id ? "#1d4ed8" : "#475569",
                  border: "1px solid #cbd5e1",
                  cursor: "pointer",
                }}
              >
                ★ {f.name}
              </button>
              <button
                type="button"
                onClick={(e) => handleDeleteSavedFilter(e, f.id)}
                title="Delete filter"
                style={{
                  background: "none",
                  border: "none",
                  color: "#94a3b8",
                  cursor: "pointer",
                  fontSize: "12px",
                  padding: "0 2px",
                }}
              >
                &times;
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={handleSaveFilter}
            style={{
              padding: "3px 10px",
              borderRadius: "14px",
              fontSize: "12px",
              fontWeight: 600,
              background: "transparent",
              color: "#4f46e5",
              border: "1px dashed #818cf8",
              cursor: "pointer",
            }}
          >
            + Save Current View
          </button>
        </div>

        {/* Main Card Container */}
        <div className="card" style={{ background: "#ffffff", borderRadius: "8px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          {/* Filter Bar */}
          <div
            className="toolbar"
            style={{
              padding: "16px",
              borderBottom: "1px solid #e2e8f0",
              display: "flex",
              gap: "10px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: "220px", position: "relative" }}>
              <input
                type="text"
                placeholder="🔍 Search tasks by title or description..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  fontSize: "13.5px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Department Filter (Universal Department Picker) */}
            {departmentsList.length > 0 && (
              <select
                value={departmentFilter}
                onChange={(e) => {
                  setDepartmentFilter(e.target.value);
                  setPage(1);
                }}
                style={{
                  padding: "8px 10px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  fontSize: "13px",
                  maxWidth: "180px",
                  background: departmentFilter ? "#eff6ff" : "#ffffff",
                  borderColor: departmentFilter ? "#bfdbfe" : "#cbd5e1",
                  color: departmentFilter ? "#1e40af" : "#0f172a",
                  fontWeight: departmentFilter ? 600 : 400,
                }}
              >
                <option value="">🏛️ All Departments</option>
                {departmentsList.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            )}

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as TaskStatus);
                setPage(1);
              }}
              style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px" }}
            >
              <option value="">All Statuses</option>
              <option value="TODO">To Do</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="ON_HOLD">On Hold</option>
              <option value="REVIEW">In Review</option>
              <option value="PENDING_APPROVAL">Pending Approval</option>
              <option value="DONE">Completed</option>
            </select>

            {/* Issue Type Filter */}
            <select
              value={issueTypeFilter}
              onChange={(e) => {
                setIssueTypeFilter(e.target.value as IssueType);
                setPage(1);
              }}
              style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px" }}
            >
              <option value="">All Issue Types</option>
              <option value="TASK">Task</option>
              <option value="BUG">Bug</option>
              <option value="IMPROVEMENT">Improvement</option>
              <option value="STORY">Story</option>
              <option value="EPIC">Epic</option>
              <option value="APPROVAL">Approval</option>
            </select>

            {/* Priority Filter */}
            <select
              value={priorityFilter}
              onChange={(e) => {
                setPriorityFilter(e.target.value as TaskPriority);
                setPage(1);
              }}
              style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px" }}
            >
              <option value="">All Priorities</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>

            {/* Label Filter */}
            {availableLabels.length > 0 && (
              <select
                value={labelFilter}
                onChange={(e) => {
                  setLabelFilter(e.target.value);
                  setPage(1);
                }}
                style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px", maxWidth: "150px" }}
              >
                <option value="">All Labels</option>
                {availableLabels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}

            {/* Sprint Filter */}
            {availableSprints.length > 0 && (
              <select
                value={sprintFilter}
                onChange={(e) => {
                  setSprintFilter(e.target.value);
                  setPage(1);
                }}
                style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px", maxWidth: "160px" }}
              >
                <option value="">All Sprints</option>
                {availableSprints.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.status})
                  </option>
                ))}
              </select>
            )}

            <select
              value={assigneeFilter}
              onChange={(e) => {
                setAssigneeFilter(e.target.value);
                setPage(1);
              }}
              style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px", maxWidth: "180px" }}
            >
              <option value="">All Assignees</option>
              {availableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} {u.department ? `(${u.department})` : ""}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={dueDateFilter}
              onChange={(e) => {
                setDueDateFilter(e.target.value);
                setPage(1);
              }}
              title="Filter by due date"
              style={{ padding: "7px 10px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px" }}
            />

            {(searchQuery ||
              departmentFilter ||
              statusFilter ||
              priorityFilter ||
              issueTypeFilter ||
              labelFilter ||
              sprintFilter ||
              assigneeFilter ||
              dueDateFilter) && (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => {
                  setSearchQuery("");
                  setDepartmentFilter("");
                  setStatusFilter("");
                  setPriorityFilter("");
                  setIssueTypeFilter("");
                  setLabelFilter("");
                  setSprintFilter("");
                  setAssigneeFilter("");
                  setDueDateFilter("");
                  setSelectedSavedFilterId(null);
                  setPage(1);
                }}
                style={{ fontSize: "12px", padding: "6px 12px" }}
              >
                Reset
              </button>
            )}
          </div>


          {/* Navigation Tabs Bar */}
          <div
            style={{
              display: "flex",
              gap: "4px",
              borderBottom: "2px solid #e2e8f0",
              padding: "0 16px",
              background: "#fafafa",
            }}
          >
            <button
              type="button"
              onClick={() => handleTabChange("my")}
              style={{
                padding: "10px 16px",
                fontWeight: 600,
                fontSize: "13.5px",
                background: "none",
                border: "none",
                borderBottom: activeTab === "my" ? "2px solid #2563eb" : "2px solid transparent",
                marginBottom: "-2px",
                cursor: "pointer",
                color: activeTab === "my" ? "#2563eb" : "#64748b",
              }}
            >
              👤 My Tasks
            </button>

            {canViewDept && (
              <button
                type="button"
                onClick={() => handleTabChange("department")}
                style={{
                  padding: "10px 16px",
                  fontWeight: 600,
                  fontSize: "13.5px",
                  background: "none",
                  border: "none",
                  borderBottom: activeTab === "department" ? "2px solid #2563eb" : "2px solid transparent",
                  marginBottom: "-2px",
                  cursor: "pointer",
                  color: activeTab === "department" ? "#2563eb" : "#64748b",
                }}
              >
                🏛️ Department
              </button>
            )}

            {canViewOrg && (
              <button
                type="button"
                onClick={() => handleTabChange("organization")}
                style={{
                  padding: "10px 16px",
                  fontWeight: 600,
                  fontSize: "13.5px",
                  background: "none",
                  border: "none",
                  borderBottom: activeTab === "organization" ? "2px solid #2563eb" : "2px solid transparent",
                  marginBottom: "-2px",
                  cursor: "pointer",
                  color: activeTab === "organization" ? "#2563eb" : "#64748b",
                }}
              >
                🏢 Organization
              </button>
            )}

            <button
              type="button"
              onClick={() => handleTabChange("backlog")}
              style={{
                padding: "10px 16px",
                fontWeight: 600,
                fontSize: "13.5px",
                background: "none",
                border: "none",
                borderBottom: activeTab === "backlog" ? "2px solid #2563eb" : "2px solid transparent",
                marginBottom: "-2px",
                cursor: "pointer",
                color: activeTab === "backlog" ? "#2563eb" : "#64748b",
              }}
            >
              📦 Backlog
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("sprint")}
              style={{
                padding: "10px 16px",
                fontWeight: 600,
                fontSize: "13.5px",
                background: "none",
                border: "none",
                borderBottom: activeTab === "sprint" ? "2px solid #2563eb" : "2px solid transparent",
                marginBottom: "-2px",
                cursor: "pointer",
                color: activeTab === "sprint" ? "#2563eb" : "#64748b",
              }}
            >
              🏃 Current Sprint
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("future_sprint")}
              style={{
                padding: "10px 16px",
                fontWeight: 600,
                fontSize: "13.5px",
                background: "none",
                border: "none",
                borderBottom: activeTab === "future_sprint" ? "2px solid #2563eb" : "2px solid transparent",
                marginBottom: "-2px",
                cursor: "pointer",
                color: activeTab === "future_sprint" ? "#2563eb" : "#64748b",
              }}
            >
              📅 Future Sprints
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("gantt")}
              style={{
                padding: "10px 16px",
                fontWeight: 600,
                fontSize: "13.5px",
                background: "none",
                border: "none",
                borderBottom: activeTab === "gantt" ? "2px solid #2563eb" : "2px solid transparent",
                marginBottom: "-2px",
                cursor: "pointer",
                color: activeTab === "gantt" ? "#2563eb" : "#64748b",
              }}
            >
              📈 Gantt Timeline
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("workload")}
              style={{
                padding: "10px 16px",
                fontWeight: 600,
                fontSize: "13.5px",
                background: "none",
                border: "none",
                borderBottom: activeTab === "workload" ? "2px solid #2563eb" : "2px solid transparent",
                marginBottom: "-2px",
                cursor: "pointer",
                color: activeTab === "workload" ? "#2563eb" : "#64748b",
              }}
            >
              👥 Team Workload
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("kanban")}
              style={{
                padding: "10px 16px",
                fontWeight: 600,
                fontSize: "13.5px",
                background: "none",
                border: "none",
                borderBottom: activeTab === "kanban" ? "2px solid #2563eb" : "2px solid transparent",
                marginBottom: "-2px",
                cursor: "pointer",
                color: activeTab === "kanban" ? "#2563eb" : "#64748b",
              }}
            >
              📊 Kanban
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("calendar")}
              style={{
                padding: "10px 16px",
                fontWeight: 600,
                fontSize: "13.5px",
                background: "none",
                border: "none",
                borderBottom: activeTab === "calendar" ? "2px solid #2563eb" : "2px solid transparent",
                marginBottom: "-2px",
                cursor: "pointer",
                color: activeTab === "calendar" ? "#2563eb" : "#64748b",
              }}
            >
              🗓️ Calendar
            </button>
          </div>

          {/* Department Sub-view Selector */}
          {activeTab === "department" && (
            <div
              style={{
                display: "flex",
                gap: "8px",
                padding: "8px 16px",
                background: "#f1f5f9",
                borderBottom: "1px solid #e2e8f0",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#475569", marginRight: "4px" }}>
                Department View:
              </span>
              {[
                { key: "list", label: "📋 List" },
                { key: "kanban", label: "📊 Kanban" },
                { key: "calendar", label: "📅 Calendar" },
                { key: "analytics", label: "📈 Analytics" },
              ].map((sv) => (
                <button
                  key={sv.key}
                  type="button"
                  onClick={() => setDeptSubView(sv.key as any)}
                  style={{
                    padding: "4px 12px",
                    borderRadius: "6px",
                    border: deptSubView === sv.key ? "1px solid #2563eb" : "1px solid #cbd5e1",
                    background: deptSubView === sv.key ? "#2563eb" : "#ffffff",
                    color: deptSubView === sv.key ? "#ffffff" : "#334155",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {sv.label}
                </button>
              ))}
            </div>
          )}

          {/* TAB CONTENT: Table Views (My Tasks, Department List, Organization) */}
          {isTableActive ? (
            <div>
              <div className="table-scroll" style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13.5px" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
                      <th style={{ padding: "12px 14px", width: "36px", textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={tasks.length > 0 && selectedTaskIds.length === tasks.length}
                          onChange={handleSelectAllTasks}
                          title="Select all tasks"
                          style={{ cursor: "pointer" }}
                        />
                      </th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569", width: "95px" }}>Type</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>Task</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>Priority</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>Status</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>Assignees &amp; Watchers</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>Start Date</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>Due Date</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>Subtask Progress</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={10} style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                          Loading tasks...
                        </td>
                      </tr>
                    ) : tasks.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                          No tasks found matching your filters.
                        </td>
                      </tr>
                    ) : (
                      tasks.map((t) => {
                        const isOverdue = isTaskOverdue(t.due_date, t.status);
                        const progress = t.subtask_total > 0 ? Math.round((t.subtask_completed / t.subtask_total) * 100) : 0;
                        const assignees = t.assignees.filter((a) => a.assignment_role !== "WATCHER");
                        const watchers = t.assignees.filter((a) => a.assignment_role === "WATCHER");

                        return (
                          <tr
                            key={t.id}
                            onClick={() => setSelectedTaskId(t.id)}
                            style={{
                              borderBottom: "1px solid #f1f5f9",
                              cursor: "pointer",
                              background: selectedTaskIds.includes(t.id) ? "#f0f9ff" : "transparent",
                              transition: "background 0.15s",
                            }}
                            onMouseEnter={(e) => {
                              if (!selectedTaskIds.includes(t.id)) e.currentTarget.style.background = "#f8fafc";
                            }}
                            onMouseLeave={(e) => {
                              if (!selectedTaskIds.includes(t.id)) e.currentTarget.style.background = "#ffffff";
                            }}
                          >
                            <td style={{ padding: "12px 14px", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedTaskIds.includes(t.id)}
                                onChange={() => handleToggleSelectTask(t.id)}
                                style={{ cursor: "pointer" }}
                              />
                            </td>
                            <td style={{ padding: "12px 14px" }}>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "3px",
                                  padding: "2px 7px",
                                  borderRadius: "10px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  background:
                                    t.issue_type === "BUG"
                                      ? "#fef2f2"
                                      : t.issue_type === "EPIC"
                                      ? "#fffbeb"
                                      : t.issue_type === "STORY"
                                      ? "#f5f3ff"
                                      : t.issue_type === "IMPROVEMENT"
                                      ? "#ecfdf5"
                                      : t.issue_type === "APPROVAL"
                                      ? "#f0f9ff"
                                      : "#eff6ff",
                                  color:
                                    t.issue_type === "BUG"
                                      ? "#dc2626"
                                      : t.issue_type === "EPIC"
                                      ? "#b45309"
                                      : t.issue_type === "STORY"
                                      ? "#7c3aed"
                                      : t.issue_type === "IMPROVEMENT"
                                      ? "#059669"
                                      : t.issue_type === "APPROVAL"
                                      ? "#0284c7"
                                      : "#2563eb",
                                  border: `1px solid ${
                                    t.issue_type === "BUG"
                                      ? "#fecaca"
                                      : t.issue_type === "EPIC"
                                      ? "#fde68a"
                                      : t.issue_type === "STORY"
                                      ? "#ddd6fe"
                                      : t.issue_type === "IMPROVEMENT"
                                      ? "#a7f3d0"
                                      : t.issue_type === "APPROVAL"
                                      ? "#bae6fd"
                                      : "#bfdbfe"
                                  }`,
                                }}
                              >
                                {t.issue_type === "BUG" && "🐞 "}
                                {t.issue_type === "EPIC" && "⚡ "}
                                {t.issue_type === "STORY" && "📖 "}
                                {t.issue_type === "IMPROVEMENT" && "🚀 "}
                                {t.issue_type === "APPROVAL" && "🛡️ "}
                                {t.issue_type || "TASK"}
                              </span>
                            </td>
                            <td style={{ padding: "12px 14px" }}>
                              {(t.parent_task?.title || t.parent_task_title) && (
                                <div style={{ fontSize: "11px", color: "#6366f1", fontWeight: 600, marginBottom: "2px" }}>
                                  ↳ Epic: {t.parent_task?.title || t.parent_task_title}
                                </div>
                              )}
                              <div style={{ fontWeight: 600, color: "#0f172a", fontSize: "14px" }}>{t.title}</div>
                              {t.description && (
                                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "260px" }}>
                                  {t.description}
                                </div>
                              )}
                              {t.labels && t.labels.length > 0 && (
                                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "4px" }}>
                                  {t.labels.map((l) => (
                                    <span
                                      key={l.id}
                                      style={{
                                        fontSize: "10px",
                                        fontWeight: 600,
                                        padding: "1px 6px",
                                        borderRadius: "10px",
                                        background: `${l.color}18`,
                                        color: l.color,
                                        border: `1px solid ${l.color}40`,
                                      }}
                                    >
                                      {l.name}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: "12px 14px" }}>
                              <span
                                style={{
                                  background: t.priority === "CRITICAL" ? "#fee2e2" : t.priority === "HIGH" ? "#fef3c7" : "#f1f5f9",
                                  color: t.priority === "CRITICAL" ? "#991b1b" : t.priority === "HIGH" ? "#92400e" : "#475569",
                                  padding: "2px 8px",
                                  borderRadius: "12px",
                                  fontSize: "11.5px",
                                  fontWeight: 700,
                                }}
                              >
                                {t.priority}
                              </span>
                            </td>
                            <td style={{ padding: "12px 14px" }}>
                              <span
                                style={{
                                  background:
                                    t.status === "DONE"
                                      ? "#dcfce7"
                                      : t.status === "IN_PROGRESS"
                                      ? "#eff6ff"
                                      : t.status === "ON_HOLD"
                                      ? "#fef3c7"
                                      : "#f1f5f9",
                                  color:
                                    t.status === "DONE"
                                      ? "#166534"
                                      : t.status === "IN_PROGRESS"
                                      ? "#1e40af"
                                      : t.status === "ON_HOLD"
                                      ? "#b45309"
                                      : "#475569",
                                  padding: "2px 8px",
                                  borderRadius: "12px",
                                  fontSize: "11.5px",
                                  fontWeight: 700,
                                }}
                              >
                                {STATUS_LABELS[t.status] || t.status}
                              </span>
                              {t.status === "ON_HOLD" && t.hold_reason && (
                                <div
                                  style={{
                                    fontSize: "11px",
                                    color: "#b45309",
                                    marginTop: "3px",
                                    maxWidth: "160px",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                  title={t.hold_reason}
                                >
                                  {t.hold_reason}
                                </div>
                              )}
                              {t.status === "ON_HOLD" && t.hold_until && (
                                <div style={{ fontSize: "10.5px", color: "#92400e", marginTop: "1px" }}>
                                  Until {t.hold_until}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: "12px 14px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                {assignees.slice(0, 3).map((a) => (
                                  <span
                                    key={a.id}
                                    title={a.user?.full_name || "Assignee"}
                                    style={{
                                      width: "24px",
                                      height: "24px",
                                      borderRadius: "50%",
                                      background: "#e0f2fe",
                                      color: "#0369a1",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: "11px",
                                      fontWeight: 700,
                                    }}
                                  >
                                    {a.user?.full_name ? a.user.full_name[0].toUpperCase() : "U"}
                                  </span>
                                ))}
                                {assignees.length > 3 && (
                                  <span style={{ fontSize: "11px", color: "#64748b" }}>+{assignees.length - 3}</span>
                                )}
                                {watchers.length > 0 && (
                                  <span
                                    title={`${watchers.length} Watcher(s)`}
                                    style={{ background: "#faf5ff", color: "#6b21a8", border: "1px solid #e9d5ff", padding: "1px 5px", borderRadius: "10px", fontSize: "11px" }}
                                  >
                                    👁️ {watchers.length}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: "12px 14px", color: "#475569", fontSize: "12.5px" }}>
                              {t.start_date || "—"}
                            </td>
                            <td style={{ padding: "12px 14px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span style={{ color: isOverdue ? "#dc2626" : "#475569", fontWeight: isOverdue ? 700 : 500, fontSize: "12.5px" }}>
                                  {t.due_date || "—"}
                                </span>
                                {isOverdue && (
                                  <span style={{ background: "#fee2e2", color: "#991b1b", padding: "1px 6px", borderRadius: "10px", fontSize: "10.5px", fontWeight: 700 }}>
                                    OVERDUE
                                  </span>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: "12px 14px" }}>
                              {t.subtask_total > 0 ? (
                                <div>
                                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#64748b", marginBottom: "3px" }}>
                                    <span>{t.subtask_completed}/{t.subtask_total} Done</span>
                                    <span>{progress}%</span>
                                  </div>
                                  <div style={{ width: "100px", height: "5px", background: "#e2e8f0", borderRadius: "3px", overflow: "hidden" }}>
                                    <div style={{ width: `${progress}%`, height: "100%", background: progress === 100 ? "#16a34a" : "#2563eb" }} />
                                  </div>
                                </div>
                              ) : (
                                <span style={{ color: "#94a3b8", fontSize: "12px" }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: "12px 14px", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                              <div style={{ display: "inline-flex", gap: "5px", alignItems: "center" }}>
                                <button
                                  type="button"
                                  className="btn btn-small"
                                  onClick={(e) => handleAssignMe(e, t.id)}
                                  title="Assign to Me"
                                  style={{ padding: "3px 6px", fontSize: "11px", color: "#2563eb", background: "#eff6ff", border: "1px solid #bfdbfe" }}
                                >
                                  +Me
                                </button>
                                {t.status !== "DONE" && (
                                  <button
                                    type="button"
                                    className="btn btn-small"
                                    onClick={(e) => handleComplete(e, t.id)}
                                    title="Mark as Completed"
                                    style={{ padding: "3px 6px", fontSize: "11px", color: "#16a34a", background: "#f0fdf4", border: "1px solid #bbf7d0" }}
                                  >
                                    ✓
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="btn btn-small"
                                  onClick={(e) => handleDuplicate(e, t.id)}
                                  title="Duplicate Task"
                                  style={{ padding: "3px 6px", fontSize: "11px", color: "#475569", background: "#f8fafc", border: "1px solid #cbd5e1" }}
                                >
                                  📄
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-small"
                                  onClick={() => setSelectedTaskId(t.id)}
                                  title="View Details in Drawer"
                                  style={{ padding: "3px 6px", fontSize: "11px" }}
                                >
                                  👁️
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-small"
                                  onClick={(e) => handleOpenEscalate(e, t)}
                                  title="Escalate Task"
                                  style={{ padding: "3px 6px", fontSize: "11px", color: "#b91c1c", background: "#fef2f2" }}
                                >
                                  ⚡
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-small"
                                  onClick={(e) => handleDeleteTask(e, t)}
                                  title="Delete Task"
                                  style={{ padding: "3px 6px", fontSize: "11px", color: "#ef4444" }}
                                >
                                  🗑️
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div style={{ padding: "12px 16px", borderTop: "1px solid #e2e8f0" }}>
                <Pagination
                  pageSize={pageSize}
                  onPageChange={(p) => setPage(p)}
                  pagination={{
                    current_page: page,
                    total_pages: Math.max(1, Math.ceil(totalCount / pageSize)),
                    total_records: totalCount,
                    page_size: pageSize,
                  }}
                />
              </div>
            </div>
          ) : isKanbanActive ? (
            /* TAB CONTENT: Kanban Board View */
            <div style={{ padding: "16px", overflowX: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(260px, 1fr))", gap: "16px" }}>
                {KANBAN_COLUMNS.map((col) => {
                  const colTasks = tasks.filter((t) => t.status === col.key);
                  return (
                    <div
                      key={col.key}
                      style={{
                        background: "#f8fafc",
                        borderRadius: "8px",
                        border: "1px solid #e2e8f0",
                        display: "flex",
                        flexDirection: "column",
                        maxHeight: "75vh",
                      }}
                    >
                      <div
                        style={{
                          padding: "12px 14px",
                          borderBottom: "2px solid",
                          borderBottomColor: col.color,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontWeight: 700,
                          color: "#1e293b",
                          fontSize: "13.5px",
                        }}
                      >
                        <span>{col.label}</span>
                        <span style={{ background: "#e2e8f0", color: "#475569", padding: "1px 7px", borderRadius: "10px", fontSize: "12px" }}>
                          {colTasks.length}
                        </span>
                      </div>

                      <div style={{ padding: "12px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
                        {colTasks.length === 0 ? (
                          <div style={{ textAlign: "center", padding: "20px", color: "#94a3b8", fontSize: "12.5px" }}>
                            No tasks
                          </div>
                        ) : (
                          colTasks.map((t) => {
                            const isOverdue = isTaskOverdue(t.due_date, t.status);
                            const progress = t.subtask_total > 0 ? Math.round((t.subtask_completed / t.subtask_total) * 100) : 0;
                            return (
                              <div
                                key={t.id}
                                onClick={() => setSelectedTaskId(t.id)}
                                style={{
                                  background: "#ffffff",
                                  borderRadius: "6px",
                                  border: "1px solid #cbd5e1",
                                  padding: "12px",
                                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                                  cursor: "pointer",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "8px",
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <span
                                    style={{
                                      background: t.priority === "CRITICAL" ? "#fee2e2" : t.priority === "HIGH" ? "#fef3c7" : "#f1f5f9",
                                      color: t.priority === "CRITICAL" ? "#991b1b" : t.priority === "HIGH" ? "#92400e" : "#475569",
                                      padding: "1px 6px",
                                      borderRadius: "4px",
                                      fontSize: "11px",
                                      fontWeight: 700,
                                    }}
                                  >
                                    {t.priority}
                                  </span>

                                  {/* Quick move dropdown */}
                                  <select
                                    value={t.status}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => handleQuickStatusChange(t.id, e.target.value as TaskStatus)}
                                    style={{ fontSize: "11px", padding: "1px 4px", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                                  >
                                    <option value="TODO">To Do</option>
                                    <option value="IN_PROGRESS">In Progress</option>
                                    <option value="ON_HOLD">On Hold</option>
                                    <option value="DONE">Completed</option>
                                  </select>
                                </div>

                                <div style={{ fontWeight: 600, fontSize: "13.5px", color: "#0f172a" }}>
                                  {t.title}
                                </div>

                                {t.status === "ON_HOLD" && (
                                  <div
                                    style={{
                                      background: "#fef3c7",
                                      border: "1px solid #fde68a",
                                      borderRadius: "4px",
                                      padding: "4px 8px",
                                      fontSize: "11px",
                                      color: "#92400e",
                                    }}
                                  >
                                    <div style={{ fontWeight: 700 }}>⏸️ On Hold</div>
                                    {t.hold_reason && <div style={{ fontStyle: "italic", marginTop: "1px" }}>"{t.hold_reason}"</div>}
                                    {t.hold_until && <div style={{ fontSize: "10px", marginTop: "1px" }}>Until {t.hold_until}</div>}
                                  </div>
                                )}

                                {t.subtask_total > 0 && (
                                  <div>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#64748b", marginBottom: "3px" }}>
                                      <span>Subtasks: {t.subtask_completed}/{t.subtask_total}</span>
                                      <span>{progress}%</span>
                                    </div>
                                    <div style={{ height: "4px", background: "#e2e8f0", borderRadius: "2px", overflow: "hidden" }}>
                                      <div style={{ width: `${progress}%`, height: "100%", background: progress === 100 ? "#16a34a" : "#2563eb" }} />
                                    </div>
                                  </div>
                                )}

                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "#64748b" }}>
                                  <span>
                                    {t.due_date ? (
                                      <span style={{ color: isOverdue ? "#dc2626" : "inherit", fontWeight: isOverdue ? 700 : 500 }}>
                                        📅 {t.due_date} {isOverdue && "⚠️"}
                                      </span>
                                    ) : (
                                      "—"
                                    )}
                                  </span>

                                  <div style={{ display: "flex", gap: "2px" }}>
                                    {t.assignees.filter((a) => a.assignment_role !== "WATCHER").slice(0, 3).map((a) => (
                                      <span
                                        key={a.id}
                                        style={{
                                          width: "20px",
                                          height: "20px",
                                          borderRadius: "50%",
                                          background: "#e0f2fe",
                                          color: "#0369a1",
                                          display: "inline-flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          fontSize: "10px",
                                          fontWeight: 700,
                                        }}
                                      >
                                        {a.user?.full_name ? a.user.full_name[0].toUpperCase() : "U"}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : isCalendarActive ? (
            /* TAB CONTENT: Calendar View */
            <div style={{ padding: "16px" }}>
              {/* Calendar Month Navigation Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => setCalendarDate(new Date(calYear, calMonth - 1, 1))}
                  >
                    ◀ Prev
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => setCalendarDate(new Date())}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => setCalendarDate(new Date(calYear, calMonth + 1, 1))}
                  >
                    Next ▶
                  </button>
                </div>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#1e293b" }}>
                  {calendarDate.toLocaleString("default", { month: "long" })} {calYear}
                </h3>
                <div style={{ fontSize: "12px", color: "#64748b" }}>
                  🟢 Start Date &bull; 🔴 Due Date &bull; ⏸️ Hold Until
                </div>
              </div>

              {/* 7-column Calendar Matrix */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "1px", background: "#e2e8f0", border: "1px solid #e2e8f0", borderRadius: "8px", overflow: "hidden" }}>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName) => (
                  <div key={dayName} style={{ background: "#f8fafc", padding: "8px", textAlign: "center", fontWeight: 700, fontSize: "12px", color: "#475569" }}>
                    {dayName}
                  </div>
                ))}

                {calendarCells.map((cell, idx) => {
                  const dayTasksDue = cell.dateKey ? tasks.filter((t) => t.due_date === cell.dateKey) : [];
                  const dayTasksStart = cell.dateKey ? tasks.filter((t) => t.start_date === cell.dateKey) : [];
                  const dayTasksHold = cell.dateKey ? tasks.filter((t) => t.hold_until === cell.dateKey) : [];
                  const isToday = cell.dateKey === todayStr;

                  return (
                    <div
                      key={idx}
                      style={{
                        background: cell.currentMonth ? (isToday ? "#eff6ff" : "#ffffff") : "#f8fafc",
                        minHeight: "90px",
                        padding: "6px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "11px", fontWeight: isToday ? 700 : 500, color: cell.currentMonth ? (isToday ? "#2563eb" : "#334155") : "#94a3b8" }}>
                          {cell.day}
                        </span>
                        {isToday && (
                          <span style={{ fontSize: "9px", background: "#2563eb", color: "#ffffff", padding: "1px 4px", borderRadius: "4px" }}>
                            TODAY
                          </span>
                        )}
                      </div>

                      {/* Start Date Events */}
                      {dayTasksStart.map((t) => (
                        <div
                          key={`start-${t.id}`}
                          onClick={() => setSelectedTaskId(t.id)}
                          style={{
                            background: "#dcfce7",
                            color: "#166534",
                            border: "1px solid #bbf7d0",
                            borderRadius: "4px",
                            padding: "2px 4px",
                            fontSize: "10.5px",
                            fontWeight: 600,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={`Start: ${t.title}`}
                        >
                          🟢 {t.title}
                        </div>
                      ))}

                      {/* Due Date Events */}
                      {dayTasksDue.map((t) => (
                        <div
                          key={`due-${t.id}`}
                          onClick={() => setSelectedTaskId(t.id)}
                          style={{
                            background: "#fee2e2",
                            color: "#991b1b",
                            border: "1px solid #fecaca",
                            borderRadius: "4px",
                            padding: "2px 4px",
                            fontSize: "10.5px",
                            fontWeight: 600,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={`Due: ${t.title}`}
                        >
                          🔴 {t.title}
                        </div>
                      ))}

                      {/* Hold Until Events */}
                      {dayTasksHold.map((t) => (
                        <div
                          key={`hold-${t.id}`}
                          onClick={() => setSelectedTaskId(t.id)}
                          style={{
                            background: "#fef3c7",
                            color: "#92400e",
                            border: "1px solid #fde68a",
                            borderRadius: "4px",
                            padding: "2px 4px",
                            fontSize: "10.5px",
                            fontWeight: 600,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={`Hold Until: ${t.title} (${t.hold_reason || "On Hold"})`}
                        >
                          ⏸️ {t.title}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : isAnalyticsActive ? (
            /* TAB CONTENT: Department Analytics View */
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Summary Metric Cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "14px",
                }}
              >
                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "16px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                  <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>Total Department Tasks</div>
                  <div style={{ fontSize: "26px", fontWeight: 800, color: "#0f172a", marginTop: "4px" }}>{analyticsData.total}</div>
                </div>
                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "16px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                  <div style={{ fontSize: "12px", color: "#2563eb", fontWeight: 600 }}>In Progress</div>
                  <div style={{ fontSize: "26px", fontWeight: 800, color: "#2563eb", marginTop: "4px" }}>{analyticsData.inProgress}</div>
                </div>
                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "16px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                  <div style={{ fontSize: "12px", color: "#d97706", fontWeight: 600 }}>On Hold</div>
                  <div style={{ fontSize: "26px", fontWeight: 800, color: "#d97706", marginTop: "4px" }}>{analyticsData.onHold}</div>
                </div>
                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "16px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                  <div style={{ fontSize: "12px", color: "#16a34a", fontWeight: 600 }}>Completed</div>
                  <div style={{ fontSize: "26px", fontWeight: 800, color: "#16a34a", marginTop: "4px" }}>{analyticsData.completed}</div>
                </div>
                <div style={{ background: "#ffffff", border: "1px solid #fee2e2", borderRadius: "8px", padding: "16px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                  <div style={{ fontSize: "12px", color: "#dc2626", fontWeight: 600 }}>Overdue</div>
                  <div style={{ fontSize: "26px", fontWeight: 800, color: "#dc2626", marginTop: "4px" }}>{analyticsData.overdue}</div>
                </div>
              </div>

              {/* Completion Progress Bar Card */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "18px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontWeight: 700, fontSize: "14px", color: "#1e293b" }}>Department Completion Rate</span>
                  <span style={{ fontWeight: 800, fontSize: "16px", color: analyticsData.rate === 100 ? "#16a34a" : "#2563eb" }}>
                    {analyticsData.rate}%
                  </span>
                </div>
                <div style={{ width: "100%", height: "10px", background: "#e2e8f0", borderRadius: "5px", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${analyticsData.rate}%`,
                      height: "100%",
                      background: analyticsData.rate === 100 ? "#16a34a" : "#2563eb",
                      transition: "width 0.4s ease",
                    }}
                  />
                </div>
              </div>

              {/* Team Workload Table */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", fontWeight: 700, color: "#1e293b", fontSize: "14px" }}>
                  Team Member Workload &amp; Delivery
                </div>
                {analyticsData.members.length === 0 ? (
                  <div style={{ padding: "24px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
                    No assigned tasks recorded for team members in this department.
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", textAlign: "left", color: "#475569" }}>
                        <th style={{ padding: "10px 16px", fontWeight: 600 }}>Team Member</th>
                        <th style={{ padding: "10px 16px", fontWeight: 600 }}>Total Assigned</th>
                        <th style={{ padding: "10px 16px", fontWeight: 600 }}>In Progress</th>
                        <th style={{ padding: "10px 16px", fontWeight: 600 }}>On Hold</th>
                        <th style={{ padding: "10px 16px", fontWeight: 600 }}>Completed</th>
                        <th style={{ padding: "10px 16px", fontWeight: 600 }}>Completion %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analyticsData.members.map((m) => {
                        const mRate = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
                        return (
                          <tr key={m.name} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "10px 16px", fontWeight: 600, color: "#0f172a" }}>{m.name}</td>
                            <td style={{ padding: "10px 16px", color: "#334155" }}>{m.total}</td>
                            <td style={{ padding: "10px 16px", color: "#2563eb", fontWeight: 600 }}>{m.inProgress}</td>
                            <td style={{ padding: "10px 16px", color: "#d97706", fontWeight: 600 }}>{m.onHold}</td>
                            <td style={{ padding: "10px 16px", color: "#16a34a", fontWeight: 600 }}>{m.done}</td>
                            <td style={{ padding: "10px 16px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ width: "35px", fontSize: "12px", fontWeight: 700, color: "#334155" }}>{mRate}%</span>
                                <div style={{ width: "80px", height: "6px", background: "#e2e8f0", borderRadius: "3px", overflow: "hidden" }}>
                                  <div style={{ width: `${mRate}%`, height: "100%", background: mRate === 100 ? "#16a34a" : "#2563eb" }} />
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : activeTab === "gantt" ? (
            <TaskGanttView tasks={tasks} onSelectTask={(id) => setSelectedTaskId(id)} />
          ) : activeTab === "workload" ? (
            <TaskWorkloadDashboard onSelectTask={(id) => setSelectedTaskId(id)} />
          ) : null}
        </div>

        {/* Modals & Slide-over Drawer */}
        <CreateTaskModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onSuccess={() => fetchTasks()}
        />

        <TaskDrawer
          taskId={selectedTaskId}
          isOpen={Boolean(selectedTaskId)}
          onClose={() => setSelectedTaskId(null)}
          onTaskUpdated={() => fetchTasks()}
          onEscalateRequest={(taskDetail) => {
            setEscalatingTask(taskDetail);
          }}
        />

        <EscalateTaskModal
          taskId={escalatingTask?.id || ""}
          taskTitle={escalatingTask?.title || ""}
          isOpen={Boolean(escalatingTask)}
          onClose={() => setEscalatingTask(null)}
          onSuccess={() => {
            fetchTasks();
            if (selectedTaskId) setSelectedTaskId(selectedTaskId);
          }}
        />

        {/* Bulk Action Bar */}
        <BulkActionBar
          selectedTaskIds={selectedTaskIds}
          availableSprints={availableSprints}
          availableLabels={availableLabels}
          availableUsers={availableUsers}
          onClearSelection={() => setSelectedTaskIds([])}
          onExecuteBulkAction={handleExecuteBulkAction}
        />
      </main>
    </AppShell>
  );
};
