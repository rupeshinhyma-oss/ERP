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

export type TabKey =
  | "my"
  | "department"
  | "organization"
  | "backlog"
  | "kanban"
  | "calendar"
  | "gantt";

export type ScopeViewKey = "my" | "department" | "organization";

export const DEPARTMENT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Frontend: { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" },
  Backend: { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" },
  "Cloud Setup": { bg: "#ecfeff", text: "#0e7490", border: "#a5f3fc" },
  IT: { bg: "#f5f3ff", text: "#6d28d9", border: "#ddd6fe" },
  Director: { bg: "#faf5ff", text: "#7e22ce", border: "#e9d5ff" },
  Management: { bg: "#fdf4ff", text: "#a21caf", border: "#f5d0fe" },
  Design: { bg: "#fff1f2", text: "#be123c", border: "#fecdd3" },
  QA: { bg: "#fff7ed", text: "#c2410c", border: "#ffedd5" },
  Sales: { bg: "#fefce8", text: "#a16207", border: "#fef08a" },
  Operations: { bg: "#f0fdfa", text: "#0f766e", border: "#99f6e4" },
  Finance: { bg: "#f8fafc", text: "#334155", border: "#cbd5e1" },
  HR: { bg: "#fdf2f8", text: "#be185d", border: "#fbcfe8" },
};

export function getDepartmentColor(deptName: string): { bg: string; text: string; border: string } {
  if (!deptName) return { bg: "#f1f5f9", text: "#475569", border: "#cbd5e1" };
  if (DEPARTMENT_COLORS[deptName]) return DEPARTMENT_COLORS[deptName];
  let hash = 0;
  for (let i = 0; i < deptName.length; i++) {
    hash = deptName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return {
    bg: `hsl(${hue}, 85%, 96%)`,
    text: `hsl(${hue}, 85%, 26%)`,
    border: `hsl(${hue}, 60%, 82%)`,
  };
}

export function getTaskDepartment(task: TaskSummary, availableUsers: AvailableUser[] = []): string {
  const INVALID_DEPTS = new Set(["staff", "super_admin", "admin", "user"]);
  const assignees = (task.assignees || []).filter((a) => a.assignment_role !== "WATCHER");
  for (const a of assignees) {
    const u = availableUsers.find((user) => user.id === a.user_id);
    if (u?.department && !INVALID_DEPTS.has(u.department.toLowerCase())) return u.department;
  }
  if (task.created_by) {
    const creator = availableUsers.find((u) => u.id === task.created_by);
    if (creator?.department && !INVALID_DEPTS.has(creator.department.toLowerCase())) return creator.department;
  }
  return "General";
}

export const DepartmentBadge: React.FC<{ department: string; style?: React.CSSProperties }> = ({
  department,
  style,
}) => {
  const colors = getDepartmentColor(department);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 8px",
        borderRadius: "12px",
        fontSize: "11px",
        fontWeight: 700,
        background: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        whiteSpace: "nowrap",
        letterSpacing: "0.2px",
        ...style,
      }}
    >
      <span style={{ fontSize: "10px" }}>🏛️</span>
      {department || "General"}
    </span>
  );
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  REVIEW: "In Review",
  DONE: "Completed",
  ON_HOLD: "⏸️ On Hold",
  PENDING_APPROVAL: "⏳ Pending Approval",
};

const KANBAN_COLUMNS: { key: TaskStatus; label: string; color: string; bg: string }[] = [
  { key: "TODO", label: "To Do", color: "#64748b", bg: "#f1f5f9" },
  { key: "IN_PROGRESS", label: "In Progress", color: "#2563eb", bg: "#eff6ff" },
  { key: "ON_HOLD", label: "On Hold", color: "#d97706", bg: "#fffbeb" },
  { key: "DONE", label: "Completed", color: "#16a34a", bg: "#f0fdf4" },
];

export type ScopeKey = "OWN" | "SELECTED_DEPT" | "MULTI_DEPT" | "ENTIRE_ORG";

export const TasksPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission, isSuperAdmin, profile } = useAuth();

  // Tab state synced with URL ?tab=...
  const tabParam = (searchParams.get("tab") as TabKey) || "my";
  const [activeTab, setActiveTab] = useState<TabKey>(tabParam);

  // Permission-Based Scope View state: 'my' | 'department' | 'organization'
  const initialScopeView: ScopeViewKey =
    tabParam === "department"
      ? "department"
      : tabParam === "organization"
      ? "organization"
      : "my";
  const [scopeView, setScopeView] = useState<ScopeViewKey>(initialScopeView);

  // RBAC Permission Scope State
  const [_scope, setScope] = useState<ScopeKey>(
    initialScopeView === "organization"
      ? "ENTIRE_ORG"
      : initialScopeView === "department"
      ? "SELECTED_DEPT"
      : "OWN"
  );
  const [departmentFilter, setDepartmentFilter] = useState<string>("");
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());

  // Kanban Drag-and-Drop state
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<TaskStatus | null>(null);

  // Calendar Click Date & Hover/Popover state
  const [createTaskDates, setCreateTaskDates] = useState<{ start?: string; due?: string }>({});
  const [calendarPopoverDay, setCalendarPopoverDay] = useState<{
    dateKey: string;
    dayNum: number;
    tasks: TaskSummary[];
  } | null>(null);

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

  // Quick Views: 'all' | 'overdue' | 'due_today' | 'due_this_week'
  const [quickFilter, setQuickFilter] = useState<
    "all" | "overdue" | "due_today" | "due_this_week"
  >("all");

  // Labels, Saved Filters, Selection, Sprints
  const [availableLabels, setAvailableLabels] = useState<TaskLabel[]>([]);
  const [availableSprints, setAvailableSprints] = useState<TaskSprint[]>([]);
  const [savedFilters, setSavedFilters] = useState<TaskSavedFilter[]>([]);
  const [selectedSavedFilterId, setSelectedSavedFilterId] = useState<string | null>(null);

  const [issueTypeFilter, setIssueTypeFilter] = useState<IssueType | "">("");
  const [labelFilter, setLabelFilter] = useState<string>("");

  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);

  // Modals & Drawer
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [initialDrawerTab, setInitialDrawerTab] = useState<any>(undefined);
  const [escalatingTask, setEscalatingTask] = useState<TaskDetail | null>(null);

  // Deep linking: open TaskDrawer from URL ?id=... or ?taskId=...
  useEffect(() => {
    const urlTaskId = searchParams.get("taskId") || searchParams.get("id");
    const drawerTabParam = searchParams.get("drawerTab");
    if (urlTaskId) {
      setSelectedTaskId(urlTaskId);
      if (drawerTabParam) {
        setInitialDrawerTab(drawerTabParam);
      }
    }
  }, [searchParams]);

  // Users for filter dropdowns
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);

  // Calendar specific state
  const [calendarDate, setCalendarDate] = useState(() => new Date());

  // User roles & scopes
  const userRoles = React.useMemo(() => {
    return (profile?.roles || []).map((x: string) => x.toLowerCase());
  }, [profile]);

  const isDirector = React.useMemo(() => {
    return Boolean(
      userRoles.some((r: string) => r.includes("director")) ||
      ((profile as any)?.position_name || "").toLowerCase().includes("director")
    );
  }, [userRoles, profile]);

  const isDeptManager = React.useMemo(() => {
    return Boolean(
      isDirector ||
      userRoles.some((r: string) => r.includes("manager") || r.includes("lead")) ||
      hasPermission("task.department_view") ||
      hasPermission("task.manage")
    );
  }, [isDirector, userRoles, hasPermission]);

  const canViewDept =
    hasPermission("task.department_view") ||
    hasPermission("task.organization_view") ||
    hasPermission("task.manage") ||
    isDeptManager ||
    isDirector ||
    isSuperAdmin;

  const canViewOrg =
    hasPermission("task.organization_view") ||
    hasPermission("task.manage") ||
    isSuperAdmin;

  // Resolve user's own department
  const userDepartment = React.useMemo(() => {
    const INVALID_DEPTS = new Set(["staff", "super_admin", "admin", "user", "general"]);
    if (profile?.id && availableUsers.length > 0) {
      const matched = availableUsers.find((u) => u.id === profile.id);
      if (matched?.department && !INVALID_DEPTS.has(matched.department.toLowerCase())) {
        return matched.department;
      }
    }
    const rawDept = (profile as any)?.department || (profile as any)?.position_name || "";
    if (rawDept && !INVALID_DEPTS.has(rawDept.toLowerCase())) {
      return rawDept;
    }
    return isSuperAdmin ? "Management" : "";
  }, [profile, availableUsers, isSuperAdmin]);

  // Allowed view options in View Switcher
  const allowedViews: ScopeViewKey[] = React.useMemo(() => {
    if (isSuperAdmin) {
      return ["my", "department", "organization"];
    }
    if (isDirector) {
      const views: ScopeViewKey[] = ["my", "department"];
      if (canViewOrg) views.push("organization");
      return views;
    }
    if (isDeptManager || canViewDept) {
      return ["my", "department"];
    }
    return ["my"];
  }, [isSuperAdmin, isDirector, isDeptManager, canViewDept, canViewOrg]);

  // Role display label in Permission Banner
  const roleDisplayName = React.useMemo(() => {
    if (isSuperAdmin) return "Super Administrator";
    if (isDirector) return "Director";
    if (isDeptManager) return "Department Manager";
    return "Employee";
  }, [isSuperAdmin, isDirector, isDeptManager]);

  // Access scope display in Permission Banner
  const accessScopeDisplayName = React.useMemo(() => {
    if (isSuperAdmin || canViewOrg) return "All Organization Tasks";
    if (canViewDept) return "Department Tasks";
    return "Personal Tasks Only";
  }, [isSuperAdmin, canViewOrg, canViewDept]);

  // Derived list of unique departments from ERP team members + defaults
  const departmentsList = React.useMemo(() => {
    const depts = new Set<string>();
    const INVALID_DEPTS = new Set(["staff", "super_admin", "admin", "user", "general"]);
    availableUsers.forEach((u) => {
      if (u.department && !INVALID_DEPTS.has(u.department.toLowerCase())) {
        depts.add(u.department);
      }
    });
    ["Frontend", "Backend", "Cloud Setup", "IT", "Management", "Director"].forEach((d) => depts.add(d));
    return Array.from(depts).sort();
  }, [availableUsers]);

  // Default department filter on initial load (only initialize once, never overwrite user selection)
  const hasInitializedDept = React.useRef(false);
  useEffect(() => {
    if (!hasInitializedDept.current && departmentsList.length > 0) {
      hasInitializedDept.current = true;
      if (userDepartment && departmentsList.includes(userDepartment)) {
        setDepartmentFilter(userDepartment);
      } else if (departmentsList.length > 0) {
        setDepartmentFilter(departmentsList[0]);
      }
    }
  }, [userDepartment, departmentsList]);

  // Sync tab with URL and enforce permission gating
  useEffect(() => {
    const t = searchParams.get("tab") as TabKey;
    if (t) {
      if (t === "department" && !canViewDept) {
        handleTabChange("my");
      } else if (t === "organization" && !canViewOrg) {
        handleTabChange("my");
      } else if (
        [
          "my",
          "department",
          "organization",
          "backlog",
          "kanban",
          "calendar",
          "gantt",
        ].includes(t)
      ) {
        setActiveTab(t);
        if (t === "my") {
          setScope("OWN");
          setScopeView("my");
        } else if (t === "department") {
          setScope("SELECTED_DEPT");
          setScopeView("department");
        } else if (t === "organization") {
          setScope("ENTIRE_ORG");
          setScopeView("organization");
        }
      } else {
        handleTabChange("my");
      }
    }
  }, [searchParams, canViewDept, canViewOrg]);

  const handleTabChange = (nextTab: TabKey) => {
    if (nextTab === "department" && !canViewDept) {
      nextTab = "my";
    }
    if (nextTab === "organization" && !canViewOrg) {
      nextTab = "my";
    }
    setActiveTab(nextTab);
    if (nextTab === "my") {
      setScope("OWN");
      setScopeView("my");
    } else if (nextTab === "department") {
      setScope("SELECTED_DEPT");
      setScopeView("department");
    } else if (nextTab === "organization") {
      setScope("ENTIRE_ORG");
      setScopeView("organization");
    }
    setSearchParams((prev) => {
      prev.set("tab", nextTab);
      return prev;
    });
    setPage(1);
  };

  const handleSelectScopeView = (nextScope: ScopeViewKey) => {
    if (!allowedViews.includes(nextScope)) return;
    setScopeView(nextScope);

    if (nextScope === "my") {
      setScope("OWN");
      if (activeTab === "department" || activeTab === "organization") {
        handleTabChange("my");
      }
    } else if (nextScope === "department") {
      setScope("SELECTED_DEPT");
      if (!departmentFilter) {
        if (userDepartment && departmentsList.includes(userDepartment)) {
          setDepartmentFilter(userDepartment);
        } else if (departmentsList.length > 0) {
          setDepartmentFilter(departmentsList[0]);
        }
      }
      if (activeTab === "my" || activeTab === "organization") {
        handleTabChange("department");
      }
    } else if (nextScope === "organization") {
      setScope("ENTIRE_ORG");
      if (activeTab === "my" || activeTab === "department") {
        handleTabChange("organization");
      }
    }
    setPage(1);
  };

  // Calendar keyboard navigation (ArrowLeft: previous month, ArrowRight: next month)
  useEffect(() => {
    if (activeTab !== "calendar") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") {
        setCalendarDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
      } else if (e.key === "ArrowRight") {
        setCalendarDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab]);

  const todayStr = React.useMemo(() => new Date().toISOString().slice(0, 10), []);

  const weekRange = React.useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diffToMonday));
    const sunday = new Date(now.setDate(diffToMonday + 6));
    return {
      start: monday.toISOString().slice(0, 10),
      end: sunday.toISOString().slice(0, 10),
    };
  }, []);

  // Load available ERP users and V2.0 options
  useEffect(() => {
    Promise.all([
      tasksApi.getAvailableAssignees().catch(() => []),
      tasksApi.fetchLabels().catch(() => []),
      tasksApi.fetchSavedFilters().catch(() => []),
      tasksApi.fetchSprints().catch(() => []),
    ])
      .then(([users, labels, filters, sprints]) => {
        setAvailableUsers(users);
        setAvailableLabels(labels);
        setSavedFilters(filters);
        setAvailableSprints(sprints);
      })
      .catch((err) => console.error("Failed to load task metadata", err));
  }, []);

  // Fetch tasks according to current tab, scopeView & filters
  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Determine backend view mode
      let viewMode: "all" | "my" | "department" | "kanban" | "calendar" = "all";
      if (scopeView === "my") viewMode = "my";
      else if (scopeView === "department" || activeTab === "department") {
        viewMode = isSuperAdmin || canViewOrg || canViewDept ? "all" : "department";
      } else {
        viewMode = "all";
      }

      if (activeTab === "kanban") viewMode = "kanban";
      else if (activeTab === "calendar") viewMode = "calendar";

      const limit =
        activeTab === "kanban" ||
        activeTab === "calendar" ||
        activeTab === "gantt" ||
        scopeView === "organization" ||
        scopeView === "department" ||
        activeTab === "department" ||
        Boolean(departmentFilter)
          ? 250
          : pageSize;

      const res = await tasksApi.getTasks({
        view: viewMode,
        search: searchQuery.trim() || undefined,
        status: statusFilter || undefined,
        priority: priorityFilter || undefined,
        issue_type: issueTypeFilter || undefined,
        label_id: labelFilter || undefined,
        is_backlog: activeTab === "backlog" ? true : undefined,
        assignee_id: assigneeFilter || undefined,
        due_date_to: dueDateFilter || undefined,
        page:
          activeTab === "kanban" ||
          activeTab === "calendar" ||
          activeTab === "gantt" ||
          scopeView === "organization"
            ? 1
            : page,
        page_size: limit,
      });

      let filteredItems = res.items;

      // Ensure scope view constraints
      if (scopeView === "my" && profile?.id) {
        filteredItems = filteredItems.filter((t) => {
          return (
            t.created_by === profile.id ||
            t.assignees.some((a) => a.user_id === profile.id)
          );
        });
      }

      // Department filter
      if (departmentFilter) {
        filteredItems = filteredItems.filter((t) => {
          const taskDept = getTaskDepartment(t, availableUsers);
          return taskDept.toLowerCase() === departmentFilter.toLowerCase();
        });
      }

      // Quick filter client-side refinement
      if (quickFilter === "overdue") {
        filteredItems = filteredItems.filter((t) => isTaskOverdue(t.due_date, t.status));
      } else if (quickFilter === "due_today") {
        filteredItems = filteredItems.filter((t) => t.due_date === todayStr);
      } else if (quickFilter === "due_this_week") {
        filteredItems = filteredItems.filter(
          (t) => t.due_date && t.due_date >= weekRange.start && t.due_date <= weekRange.end
        );
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
    scopeView,
    searchQuery,
    statusFilter,
    priorityFilter,
    issueTypeFilter,
    labelFilter,
    assigneeFilter,
    dueDateFilter,
    departmentFilter,
    availableUsers,
    profile?.id,
    quickFilter,
    todayStr,
    weekRange,
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
    const previousTasks = [...tasks];
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
    );
    try {
      await tasksApi.updateTask(taskId, { status: newStatus });
      fetchTasks();
    } catch (err: any) {
      setTasks(previousTasks);
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

  // Active view determination
  const isTableActive =
    activeTab === "my" ||
    activeTab === "department" ||
    activeTab === "backlog" ||
    activeTab === "organization";

  const isKanbanActive = activeTab === "kanban";

  const isCalendarActive = activeTab === "calendar";

  // Group tasks by department for Organization View
  const tasksByDepartment = React.useMemo(() => {
    const map = new Map<string, TaskSummary[]>();

    departmentsList.forEach((d) => {
      map.set(d, []);
    });

    tasks.forEach((t) => {
      const d = getTaskDepartment(t, availableUsers);
      if (!map.has(d)) {
        map.set(d, []);
      }
      map.get(d)!.push(t);
    });

    const result: { department: string; tasks: TaskSummary[] }[] = [];
    map.forEach((taskList, deptName) => {
      if (taskList.length > 0) {
        result.push({ department: deptName, tasks: taskList });
      }
    });

    result.sort((a, b) => a.department.localeCompare(b.department));
    return result;
  }, [tasks, departmentsList, availableUsers]);

  const toggleDeptCollapse = (dept: string) => {
    setCollapsedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  };

  const handleExpandAllDepts = () => {
    setCollapsedDepts(new Set());
  };

  const handleCollapseAllDepts = () => {
    setCollapsedDepts(new Set(tasksByDepartment.map((g) => g.department)));
  };

  const handleQuickViewClick = (
    filterType: "all" | "overdue" | "due_today" | "due_this_week"
  ) => {
    setQuickFilter(filterType);
    setSelectedSavedFilterId(null);
    setPage(1);

    if (filterType === "all") {
      setSearchQuery("");
      setStatusFilter("");
      setPriorityFilter("");
      setIssueTypeFilter("");
      setLabelFilter("");
      setAssigneeFilter("");
      setDueDateFilter("");
    } else {
      setStatusFilter("");
      setIssueTypeFilter("");
      setPriorityFilter("");
    }
  };

  const renderEmptyState = (viewType: "my" | "department" | "organization") => {
    let title = "No tasks found matching your filters.";
    let description = "Try changing filters or create a new task.";
    let icon = "📋";

    if (viewType === "my") {
      title = "You're all caught up.";
      description = "No tasks assigned to you with the current filters.";
      icon = "🎉";
    } else if (viewType === "department") {
      title = `No tasks in ${departmentFilter || "this department"}.`;
      description = "Try changing filters or create a new task.";
      icon = "🏛️";
    } else if (viewType === "organization") {
      title = "No organization tasks match these filters.";
      description = "Try changing filters or create a new task.";
      icon = "🏢";
    }

    return (
      <div
        style={{
          textAlign: "center",
          padding: "56px 24px",
          background: "#ffffff",
          borderRadius: "8px",
        }}
      >
        <div style={{ fontSize: "44px", marginBottom: "12px" }}>{icon}</div>
        <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: "0 0 6px 0" }}>
          {title}
        </h3>
        <p
          style={{
            fontSize: "13.5px",
            color: "#64748b",
            margin: "0 0 18px 0",
            maxWidth: "420px",
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {description}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setCreateTaskDates({});
            setIsCreateOpen(true);
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontWeight: 600,
            padding: "8px 16px",
          }}
        >
          + New Task
        </button>
      </div>
    );
  };

  const renderTableMarkup = (taskList: TaskSummary[]) => {
    return (
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13.5px" }}>
        <thead>
          <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
            <th style={{ padding: "12px 14px", width: "36px", textAlign: "center" }}>
              <input
                type="checkbox"
                checked={taskList.length > 0 && taskList.every((t) => selectedTaskIds.includes(t.id))}
                onChange={() => {
                  const allSelected = taskList.every((t) => selectedTaskIds.includes(t.id));
                  if (allSelected) {
                    setSelectedTaskIds((prev) => prev.filter((id) => !taskList.some((t) => t.id === id)));
                  } else {
                    const newIds = new Set([...selectedTaskIds, ...taskList.map((t) => t.id)]);
                    setSelectedTaskIds(Array.from(newIds));
                  }
                }}
                title="Select all tasks in table"
                style={{ cursor: "pointer" }}
              />
            </th>
            <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569", width: "95px" }}>Type</th>
            <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>Task</th>
            <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569", width: "90px" }}>Priority</th>
            <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569", width: "125px" }}>Status</th>
            <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569", width: "110px" }}>Assignee</th>
            <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569", width: "130px" }}>Department</th>
            <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569", width: "115px" }}>Due Date</th>
            <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569", width: "110px" }}>Progress</th>
            <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569", textAlign: "right", width: "140px" }}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {taskList.map((t) => {
            const isOverdue = isTaskOverdue(t.due_date, t.status);
            const progress =
              t.subtask_total > 0 ? Math.round((t.subtask_completed / t.subtask_total) * 100) : 0;
            const assignees = t.assignees.filter((a) => a.assignment_role !== "WATCHER");
            const taskDept = getTaskDepartment(t, availableUsers);

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
                          : "#bfdbfe"
                      }`,
                    }}
                  >
                    {t.issue_type === "BUG" && "🐞 "}
                    {t.issue_type === "EPIC" && "⚡ "}
                    {t.issue_type === "STORY" && "📖 "}
                    {t.issue_type === "IMPROVEMENT" && "🚀 "}
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
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#64748b",
                        marginTop: "2px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "280px",
                      }}
                    >
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
                      background:
                        t.priority === "CRITICAL"
                          ? "#fee2e2"
                          : t.priority === "HIGH"
                          ? "#fef3c7"
                          : "#f1f5f9",
                      color:
                        t.priority === "CRITICAL"
                          ? "#991b1b"
                          : t.priority === "HIGH"
                          ? "#92400e"
                          : "#475569",
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
                    {assignees.length === 0 ? (
                      <span style={{ color: "#94a3b8", fontSize: "12px" }}>Unassigned</span>
                    ) : (
                      <>
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
                      </>
                    )}
                  </div>
                </td>
                <td style={{ padding: "12px 14px" }}>
                  <DepartmentBadge department={taskDept} />
                </td>
                <td style={{ padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span
                      style={{
                        color: isOverdue ? "#dc2626" : "#475569",
                        fontWeight: isOverdue ? 700 : 500,
                        fontSize: "12.5px",
                      }}
                    >
                      {t.due_date || "—"}
                    </span>
                    {isOverdue && (
                      <span
                        style={{
                          background: "#fee2e2",
                          color: "#991b1b",
                          padding: "1px 6px",
                          borderRadius: "10px",
                          fontSize: "10.5px",
                          fontWeight: 700,
                        }}
                      >
                        OVERDUE
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ padding: "12px 14px" }}>
                  {t.subtask_total > 0 ? (
                    <div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "11px",
                          color: "#64748b",
                          marginBottom: "3px",
                        }}
                      >
                        <span>
                          {t.subtask_completed}/{t.subtask_total} Done
                        </span>
                        <span>{progress}%</span>
                      </div>
                      <div
                        style={{
                          width: "90px",
                          height: "5px",
                          background: "#e2e8f0",
                          borderRadius: "3px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${progress}%`,
                            height: "100%",
                            background: progress === 100 ? "#16a34a" : "#2563eb",
                          }}
                        />
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
                      style={{
                        padding: "3px 6px",
                        fontSize: "11px",
                        color: "#2563eb",
                        background: "#eff6ff",
                        border: "1px solid #bfdbfe",
                      }}
                    >
                      +Me
                    </button>
                    {t.status !== "DONE" && (
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={(e) => handleComplete(e, t.id)}
                        title="Mark as Completed"
                        style={{
                          padding: "3px 6px",
                          fontSize: "11px",
                          color: "#16a34a",
                          background: "#f0fdf4",
                          border: "1px solid #bbf7d0",
                        }}
                      >
                        ✓
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={(e) => handleDuplicate(e, t.id)}
                      title="Duplicate Task"
                      style={{
                        padding: "3px 6px",
                        fontSize: "11px",
                        color: "#475569",
                        background: "#f8fafc",
                        border: "1px solid #cbd5e1",
                      }}
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
                      style={{
                        padding: "3px 6px",
                        fontSize: "11px",
                        color: "#b91c1c",
                        background: "#fef2f2",
                      }}
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
          })}
        </tbody>
      </table>
    );
  };

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
              onClick={() => {
                setCreateTaskDates({});
                setIsCreateOpen(true);
              }}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 600 }}
            >
              + New Task
            </button>
          </div>
        </div>

        <Banner error={error} />

        {/* ERP Permission Scope & Segmented View Switcher */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "10px",
            padding: "12px 20px",
            marginBottom: "16px",
            flexWrap: "wrap",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          {/* Left: Permission Scope & Role Info */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                🛡️ Permission Scope:
              </span>
              <span
                style={{
                  fontSize: "12.5px",
                  fontWeight: 700,
                  padding: "4px 12px",
                  borderRadius: "14px",
                  background: isSuperAdmin
                    ? "#faf5ff"
                    : canViewOrg
                    ? "#eff6ff"
                    : canViewDept
                    ? "#f0fdf4"
                    : "#f8fafc",
                  color: isSuperAdmin
                    ? "#6b21a8"
                    : canViewOrg
                    ? "#1d4ed8"
                    : canViewDept
                    ? "#15803d"
                    : "#475569",
                  border: "1px solid",
                  borderColor: isSuperAdmin
                    ? "#e9d5ff"
                    : canViewOrg
                    ? "#bfdbfe"
                    : canViewDept
                    ? "#bbf7d0"
                    : "#cbd5e1",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>{roleDisplayName}</span>
                <span style={{ opacity: 0.6 }}>•</span>
                <span style={{ fontWeight: 600 }}>{accessScopeDisplayName}</span>
              </span>
            </div>
          </div>

          {/* Right: Segmented View Switcher & Department Picker */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#64748b" }}>
              View Scope:
            </span>

            {/* Segmented Control */}
            <div
              style={{
                display: "inline-flex",
                background: "#f1f5f9",
                borderRadius: "8px",
                padding: "3px",
                border: "1px solid #e2e8f0",
                gap: "2px",
              }}
            >
              {allowedViews.includes("my") && (
                <button
                  type="button"
                  onClick={() => handleSelectScopeView("my")}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "6px",
                    border: "none",
                    fontSize: "12.5px",
                    fontWeight: scopeView === "my" ? 700 : 500,
                    color: scopeView === "my" ? "#0f172a" : "#64748b",
                    background: scopeView === "my" ? "#ffffff" : "transparent",
                    boxShadow: scopeView === "my" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  👤 My Tasks
                </button>
              )}

              {allowedViews.includes("department") && (
                <button
                  type="button"
                  onClick={() => handleSelectScopeView("department")}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "6px",
                    border: "none",
                    fontSize: "12.5px",
                    fontWeight: scopeView === "department" ? 700 : 500,
                    color: scopeView === "department" ? "#0f172a" : "#64748b",
                    background: scopeView === "department" ? "#ffffff" : "transparent",
                    boxShadow: scopeView === "department" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  🏛️ Department
                </button>
              )}

              {allowedViews.includes("organization") && (
                <button
                  type="button"
                  onClick={() => handleSelectScopeView("organization")}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "6px",
                    border: "none",
                    fontSize: "12.5px",
                    fontWeight: scopeView === "organization" ? 700 : 500,
                    color: scopeView === "organization" ? "#0f172a" : "#64748b",
                    background: scopeView === "organization" ? "#ffffff" : "transparent",
                    boxShadow: scopeView === "organization" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  🏢 Organization
                </button>
              )}
            </div>

            {/* Department Dropdown (Active when in Department view, or accessible for authorized users) */}
            {(scopeView === "department" || activeTab === "department") && departmentsList.length > 0 && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>Dept:</span>
                <select
                  value={departmentFilter}
                  onChange={(e) => {
                    setDepartmentFilter(e.target.value);
                    setPage(1);
                  }}
                  style={{
                    padding: "6px 10px",
                    border: "1px solid #bfdbfe",
                    borderRadius: "6px",
                    fontSize: "12.5px",
                    background: "#eff6ff",
                    color: "#1e40af",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                  title="Switch Active Department"
                >
                  <option value="">All Departments</option>
                  {departmentsList.map((d) => (
                    <option key={d} value={d}>
                      {d} {d === userDepartment ? "(Yours)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Quick Views Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            overflowX: "auto",
            padding: "2px 0",
            marginBottom: "14px",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Quick Views:
          </span>
          <button
            type="button"
            onClick={() => handleQuickViewClick("all")}
            style={{
              padding: "4px 12px",
              borderRadius: "16px",
              fontSize: "12px",
              fontWeight: quickFilter === "all" && !selectedSavedFilterId ? 700 : 500,
              background: quickFilter === "all" && !selectedSavedFilterId ? "#e0e7ff" : "#f1f5f9",
              color: quickFilter === "all" && !selectedSavedFilterId ? "#3730a3" : "#475569",
              border: quickFilter === "all" && !selectedSavedFilterId ? "1px solid #c7d2fe" : "1px solid #cbd5e1",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => handleQuickViewClick("overdue")}
            style={{
              padding: "4px 12px",
              borderRadius: "16px",
              fontSize: "12px",
              fontWeight: quickFilter === "overdue" ? 700 : 500,
              background: quickFilter === "overdue" ? "#fef2f2" : "#f1f5f9",
              color: quickFilter === "overdue" ? "#dc2626" : "#475569",
              border: quickFilter === "overdue" ? "1px solid #fecaca" : "1px solid #cbd5e1",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            ⚠️ Overdue
          </button>
          <button
            type="button"
            onClick={() => handleQuickViewClick("due_today")}
            style={{
              padding: "4px 12px",
              borderRadius: "16px",
              fontSize: "12px",
              fontWeight: quickFilter === "due_today" ? 700 : 500,
              background: quickFilter === "due_today" ? "#eff6ff" : "#f1f5f9",
              color: quickFilter === "due_today" ? "#1d4ed8" : "#475569",
              border: quickFilter === "due_today" ? "1px solid #bfdbfe" : "1px solid #cbd5e1",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            📅 Due Today
          </button>
          <button
            type="button"
            onClick={() => handleQuickViewClick("due_this_week")}
            style={{
              padding: "4px 12px",
              borderRadius: "16px",
              fontSize: "12px",
              fontWeight: quickFilter === "due_this_week" ? 700 : 500,
              background: quickFilter === "due_this_week" ? "#f0fdf4" : "#f1f5f9",
              color: quickFilter === "due_this_week" ? "#15803d" : "#475569",
              border: "1px solid #bbf7d0",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            📆 Due This Week
          </button>

          {/* User Custom Saved Filters */}
          {savedFilters.map((f) => (
            <div key={f.id} style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>
              <button
                type="button"
                onClick={() => handleApplySavedFilter(f)}
                style={{
                  padding: "4px 10px",
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
              padding: "4px 10px",
              borderRadius: "14px",
              fontSize: "12px",
              fontWeight: 500,
              background: "#ffffff",
              color: "#64748b",
              border: "1px dashed #cbd5e1",
              cursor: "pointer",
            }}
            title="Save current filters as custom view"
          >
            + Save Filter
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
                  setAssigneeFilter("");
                  setDueDateFilter("");
                  setSelectedSavedFilterId(null);
                  setQuickFilter("all");
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
              overflowX: "auto",
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
                whiteSpace: "nowrap",
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
                  whiteSpace: "nowrap",
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
                  whiteSpace: "nowrap",
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
                whiteSpace: "nowrap",
              }}
            >
              📦 Backlog
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
                whiteSpace: "nowrap",
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
                whiteSpace: "nowrap",
              }}
            >
              🗓️ Calendar
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
                whiteSpace: "nowrap",
              }}
            >
              📈 Gantt
            </button>
          </div>

          {/* TAB CONTENT: Table Views (My Tasks, Department List, Organization, Backlog) */}
          {isTableActive ? (
            <div>
              {loading ? (
                <div style={{ padding: "56px 24px", textAlign: "center", color: "#64748b" }}>
                  <div style={{ fontSize: "28px", marginBottom: "8px" }}>⏳</div>
                  <div style={{ fontWeight: 600, fontSize: "14px", color: "#334155" }}>Loading tasks...</div>
                </div>
              ) : scopeView === "organization" ? (
                /* Organization View: Grouped by Department with Collapsible Accordions */
                <div>
                  {/* Organization Header Bar */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "12px 18px",
                      background: "#f8fafc",
                      borderBottom: "1px solid #e2e8f0",
                      flexWrap: "wrap",
                      gap: "8px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontWeight: 700, fontSize: "14px", color: "#0f172a" }}>
                        🏢 Enterprise Organization Overview
                      </span>
                      <span
                        style={{
                          background: "#e0f2fe",
                          color: "#0369a1",
                          padding: "2px 8px",
                          borderRadius: "12px",
                          fontSize: "11.5px",
                          fontWeight: 700,
                        }}
                      >
                        {tasks.length} total tasks across {tasksByDepartment.length} departments
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={handleExpandAllDepts}
                        style={{ fontSize: "11.5px", padding: "4px 10px" }}
                      >
                        ▼ Expand All
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={handleCollapseAllDepts}
                        style={{ fontSize: "11.5px", padding: "4px 10px" }}
                      >
                        ▶ Collapse All
                      </button>
                    </div>
                  </div>

                  {tasksByDepartment.length === 0 ? (
                    renderEmptyState("organization")
                  ) : (
                    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
                      {tasksByDepartment.map((group) => {
                        const isCollapsed = collapsedDepts.has(group.department);
                        const colors = getDepartmentColor(group.department);

                        return (
                          <div
                            key={group.department}
                            style={{
                              border: "1px solid #e2e8f0",
                              borderRadius: "8px",
                              overflow: "hidden",
                              background: "#ffffff",
                              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                            }}
                          >
                            {/* Department Accordion Header */}
                            <div
                              onClick={() => toggleDeptCollapse(group.department)}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                padding: "10px 16px",
                                background: isCollapsed ? "#ffffff" : "#f8fafc",
                                borderBottom: isCollapsed ? "none" : "1px solid #e2e8f0",
                                cursor: "pointer",
                                userSelect: "none",
                                transition: "background 0.15s ease",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                <span style={{ fontSize: "13px", color: "#64748b" }}>
                                  {isCollapsed ? "▶" : "▼"}
                                </span>
                                <DepartmentBadge department={group.department} />
                                <span style={{ fontWeight: 700, fontSize: "13.5px", color: "#0f172a" }}>
                                  {group.department}
                                </span>
                                <span
                                  style={{
                                    background: colors.bg,
                                    color: colors.text,
                                    border: `1px solid ${colors.border}`,
                                    padding: "1px 7px",
                                    borderRadius: "10px",
                                    fontSize: "11px",
                                    fontWeight: 700,
                                  }}
                                >
                                  {group.tasks.length} task{group.tasks.length !== 1 ? "s" : ""}
                                </span>
                              </div>

                              <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 500 }}>
                                {isCollapsed ? "Click to view tasks" : "Click to collapse"}
                              </span>
                            </div>

                            {/* Department Tasks Table */}
                            {!isCollapsed && (
                              <div className="table-scroll" style={{ overflowX: "auto" }}>
                                {renderTableMarkup(group.tasks)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : tasks.length === 0 ? (
                renderEmptyState(scopeView)
              ) : (
                <div className="table-scroll" style={{ overflowX: "auto" }}>
                  {renderTableMarkup(tasks)}
                </div>
              )}

              {/* Pagination */}
              <div style={{ padding: "12px 18px", borderTop: "1px solid #e2e8f0" }}>
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
            <div className="table-scroll" style={{ padding: "16px" }}>
              <div className="kanban-board-grid">
                {KANBAN_COLUMNS.map((col) => {
                  const colTasks = tasks.filter((t) => t.status === col.key);
                  const isColOver = dragOverCol === col.key;
                  return (
                    <div
                      key={col.key}
                      className={`kanban-column-dropzone ${isColOver ? "drag-over" : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragOverCol !== col.key) setDragOverCol(col.key);
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          setDragOverCol(null);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverCol(null);
                        const droppedId = e.dataTransfer.getData("text/plain") || draggingTaskId;
                        if (droppedId) {
                          handleQuickStatusChange(droppedId, col.key);
                        }
                        setDraggingTaskId(null);
                      }}
                    >
                      {/* Column Header */}
                      <div
                        style={{
                          padding: "12px 14px",
                          borderBottom: `2px solid ${col.color}`,
                          background: "#ffffff",
                          borderRadius: "10px 10px 0 0",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: col.color }} />
                          <span style={{ fontWeight: 700, fontSize: "13.5px", color: "#1e293b" }}>{col.label}</span>
                        </div>
                        <span
                          style={{
                            background: "#f1f5f9",
                            color: "#475569",
                            padding: "2px 8px",
                            borderRadius: "10px",
                            fontSize: "11px",
                            fontWeight: 700,
                          }}
                        >
                          {colTasks.length}
                        </span>
                      </div>

                      {/* Column Card List */}
                      <div
                        style={{
                          padding: "12px",
                          overflowY: "auto",
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                          flex: 1,
                        }}
                      >
                        {colTasks.length === 0 ? (
                          <div style={{ textAlign: "center", padding: "36px 12px", color: "#94a3b8", fontSize: "12.5px" }}>
                            Drag tasks here
                          </div>
                        ) : (
                          colTasks.map((t) => {
                            const isOverdue = isTaskOverdue(t.due_date, t.status);
                            const progress =
                              t.subtask_total > 0
                                ? Math.round((t.subtask_completed / t.subtask_total) * 100)
                                : t.status === "DONE"
                                ? 100
                                : 0;

                            return (
                              <div
                                key={t.id}
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData("text/plain", t.id);
                                  e.dataTransfer.effectAllowed = "move";
                                  setDraggingTaskId(t.id);
                                }}
                                onDragEnd={() => {
                                  setDraggingTaskId(null);
                                  setDragOverCol(null);
                                }}
                                onClick={() => setSelectedTaskId(t.id)}
                                className={`kanban-card-draggable ${draggingTaskId === t.id ? "is-dragging" : ""}`}
                              >
                                {/* Top Row: Issue Type, Priority, Department, and Reopen */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                                    <span
                                      style={{
                                        fontSize: "10px",
                                        fontWeight: 700,
                                        textTransform: "uppercase",
                                        padding: "1px 6px",
                                        borderRadius: "4px",
                                        background:
                                          t.issue_type === "BUG"
                                            ? "#fee2e2"
                                            : t.issue_type === "EPIC"
                                            ? "#f3e8ff"
                                            : t.issue_type === "STORY"
                                            ? "#dcfce7"
                                            : "#f1f5f9",
                                        color:
                                          t.issue_type === "BUG"
                                            ? "#991b1b"
                                            : t.issue_type === "EPIC"
                                            ? "#6b21a8"
                                            : t.issue_type === "STORY"
                                            ? "#166534"
                                            : "#475569",
                                        border: "1px solid #cbd5e1",
                                      }}
                                    >
                                      {t.issue_type === "BUG"
                                        ? "🐞 Bug"
                                        : t.issue_type === "EPIC"
                                        ? "👑 Epic"
                                        : t.issue_type === "STORY"
                                        ? "💡 Story"
                                        : "📋 Task"}
                                    </span>

                                    <span
                                      style={{
                                        background:
                                          t.priority === "CRITICAL"
                                            ? "#fee2e2"
                                            : t.priority === "HIGH"
                                            ? "#fef3c7"
                                            : "#f1f5f9",
                                        color:
                                          t.priority === "CRITICAL"
                                            ? "#991b1b"
                                            : t.priority === "HIGH"
                                            ? "#92400e"
                                            : "#475569",
                                        padding: "1px 6px",
                                        borderRadius: "4px",
                                        fontSize: "10px",
                                        fontWeight: 700,
                                      }}
                                    >
                                      {t.priority}
                                    </span>

                                    <DepartmentBadge
                                      department={getTaskDepartment(t, availableUsers)}
                                      style={{ fontSize: "10px", padding: "1px 6px" }}
                                    />
                                  </div>

                                  {t.status === "DONE" && (
                                    <button
                                      type="button"
                                      className="btn-reopen"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleQuickStatusChange(t.id, "TODO");
                                      }}
                                      title="Reopen completed task"
                                    >
                                      ↺ Reopen
                                    </button>
                                  )}
                                </div>

                                {/* Task Title */}
                                <div style={{ fontWeight: 600, fontSize: "13.5px", color: "#0f172a", lineHeight: 1.35 }}>
                                  {t.title}
                                </div>

                                {/* On Hold Details */}
                                {t.status === "ON_HOLD" && (
                                  <div
                                    style={{
                                      background: "#fffbeb",
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

                                {/* Label Chips */}
                                {t.labels && t.labels.length > 0 && (
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                    {t.labels.map((lbl) => (
                                      <span
                                        key={lbl.id}
                                        style={{
                                          fontSize: "10px",
                                          fontWeight: 600,
                                          background: "#eff6ff",
                                          color: "#1d4ed8",
                                          padding: "1px 6px",
                                          borderRadius: "10px",
                                          border: "1px solid #bfdbfe",
                                        }}
                                      >
                                        #{lbl.name}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {/* Subtask Progress */}
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

                                {/* Footer: Due Date & Assignees */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                                  <span>
                                    {t.due_date ? (
                                      <span style={{ color: isOverdue ? "#dc2626" : "inherit", fontWeight: isOverdue ? 700 : 500 }}>
                                        📅 {t.due_date} {isOverdue && "⚠️"}
                                      </span>
                                    ) : (
                                      "—"
                                    )}
                                  </span>

                                  <div style={{ display: "flex", gap: "3px" }}>
                                    {t.assignees.filter((a) => a.assignment_role !== "WATCHER").slice(0, 3).map((a) => (
                                      <span
                                        key={a.id}
                                        title={a.user?.full_name || "Assignee"}
                                        style={{
                                          width: "22px",
                                          height: "22px",
                                          borderRadius: "50%",
                                          background: "#eff6ff",
                                          color: "#1d4ed8",
                                          border: "1px solid #bfdbfe",
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
            /* TAB CONTENT: Redesigned ERP Card-Based Calendar View */
            <div style={{ padding: "16px" }}>
              {/* Calendar Month Navigation & Legend Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "16px",
                  background: "#f8fafc",
                  padding: "10px 16px",
                  borderRadius: "8px",
                  border: "1px solid #e2e8f0",
                  flexWrap: "wrap",
                  gap: "10px",
                }}
              >
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => setCalendarDate(new Date(calYear, calMonth - 1, 1))}
                    title="Previous month (or press Left Arrow)"
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
                    title="Next month (or press Right Arrow)"
                  >
                    Next ▶
                  </button>
                </div>

                <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#0f172a" }}>
                  {calendarDate.toLocaleString("default", { month: "long" })} {calYear}
                </h3>

                {/* Status Color Legend */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "11.5px", flexWrap: "wrap" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#2563eb" }} /> Todo
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ea580c" }} /> In Progress
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#9333ea" }} /> Review
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#16a34a" }} /> Done
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#64748b" }} /> On Hold
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#dc2626" }} /> Overdue
                  </span>
                </div>
              </div>

              {/* 7-Column Day Names Header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, 1fr)",
                  gap: "8px",
                  marginBottom: "8px",
                }}
              >
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName) => (
                  <div
                    key={dayName}
                    style={{
                      background: "#f1f5f9",
                      padding: "8px",
                      textAlign: "center",
                      fontWeight: 700,
                      fontSize: "12px",
                      color: "#475569",
                      borderRadius: "6px",
                    }}
                  >
                    {dayName}
                  </div>
                ))}
              </div>

              {/* 7-Column Calendar Days Grid */}
              <div className="calendar-card-grid">
                {calendarCells.map((cell, idx) => {
                  const dayTasks = cell.dateKey
                    ? tasks.filter((t) => t.due_date === cell.dateKey || t.start_date === cell.dateKey)
                    : [];
                  const isToday = cell.dateKey === todayStr;
                  const visiblePills = dayTasks.slice(0, 3);
                  const overflowCount = dayTasks.length - 3;

                  return (
                    <div
                      key={idx}
                      className={`calendar-day-card ${!cell.currentMonth ? "other-month" : ""} ${isToday ? "is-today" : ""}`}
                      onClick={(e) => {
                        if (
                          (e.target as HTMLElement).closest(".task-pill") ||
                          (e.target as HTMLElement).closest(".calendar-more-btn")
                        ) {
                          return;
                        }
                        if (cell.dateKey) {
                          setCreateTaskDates({ start: cell.dateKey, due: cell.dateKey });
                          setIsCreateOpen(true);
                        }
                      }}
                      title={cell.dateKey ? `Click to create task for ${cell.dateKey}` : ""}
                    >
                      {/* Day Number and Today Badge */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2px" }}>
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: isToday ? 800 : 600,
                            color: isToday ? "#2563eb" : cell.currentMonth ? "#1e293b" : "#94a3b8",
                          }}
                        >
                          {cell.day}
                        </span>
                        {isToday && (
                          <span
                            style={{
                              fontSize: "9px",
                              background: "#2563eb",
                              color: "#ffffff",
                              padding: "1px 5px",
                              borderRadius: "4px",
                              fontWeight: 700,
                            }}
                          >
                            TODAY
                          </span>
                        )}
                      </div>

                      {/* Colored Task Pills */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "3px", flex: 1 }}>
                        {visiblePills.map((t) => {
                          const isOverdue = isTaskOverdue(t.due_date, t.status);
                          let pillClass = "task-pill task-pill-todo";
                          if (isOverdue) pillClass = "task-pill task-pill-overdue";
                          else if (t.status === "DONE") pillClass = "task-pill task-pill-done";
                          else if (t.status === "IN_PROGRESS") pillClass = "task-pill task-pill-in-progress";
                          else if (t.status === "REVIEW") pillClass = "task-pill task-pill-review";
                          else if (t.status === "ON_HOLD") pillClass = "task-pill task-pill-on-hold";

                          return (
                            <div
                              key={t.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTaskId(t.id);
                              }}
                              className={pillClass}
                              title={`${t.title}\nStatus: ${STATUS_LABELS[t.status]}\nPriority: ${t.priority}\nDue: ${t.due_date || "None"}`}
                            >
                              {t.status === "DONE" ? "✓ " : t.status === "ON_HOLD" ? "⏸ " : ""}
                              {t.title}
                            </div>
                          );
                        })}

                        {/* Overflow "+X more" button */}
                        {overflowCount > 0 && (
                          <button
                            type="button"
                            className="calendar-more-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCalendarPopoverDay({
                                dateKey: cell.dateKey,
                                dayNum: cell.day,
                                tasks: dayTasks,
                              });
                            }}
                          >
                            +{overflowCount} more
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Day Tasks Overflow Popover Modal */}
              {calendarPopoverDay && (
                <div
                  style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(15, 23, 42, 0.4)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 1000,
                  }}
                  onClick={() => setCalendarPopoverDay(null)}
                >
                  <div
                    style={{
                      background: "#ffffff",
                      borderRadius: "10px",
                      boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
                      border: "1px solid #cbd5e1",
                      width: "420px",
                      maxWidth: "92vw",
                      maxHeight: "80vh",
                      overflowY: "auto",
                      padding: "18px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e2e8f0", paddingBottom: "10px" }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>
                          Tasks on {calendarPopoverDay.dateKey}
                        </h4>
                        <div style={{ fontSize: "12px", color: "#64748b" }}>
                          {calendarPopoverDay.tasks.length} task(s) scheduled
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCalendarPopoverDay(null)}
                        style={{
                          background: "none",
                          border: "none",
                          fontSize: "18px",
                          color: "#64748b",
                          cursor: "pointer",
                        }}
                      >
                        &times;
                      </button>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {calendarPopoverDay.tasks.map((t) => {
                        const isOverdue = isTaskOverdue(t.due_date, t.status);
                        let pillClass = "task-pill task-pill-todo";
                        if (isOverdue) pillClass = "task-pill task-pill-overdue";
                        else if (t.status === "DONE") pillClass = "task-pill task-pill-done";
                        else if (t.status === "IN_PROGRESS") pillClass = "task-pill task-pill-in-progress";
                        else if (t.status === "REVIEW") pillClass = "task-pill task-pill-review";
                        else if (t.status === "ON_HOLD") pillClass = "task-pill task-pill-on-hold";

                        return (
                          <div
                            key={t.id}
                            onClick={() => {
                              setSelectedTaskId(t.id);
                              setCalendarPopoverDay(null);
                            }}
                            style={{
                              padding: "10px",
                              borderRadius: "6px",
                              border: "1px solid #e2e8f0",
                              background: "#f8fafc",
                              cursor: "pointer",
                              display: "flex",
                              flexDirection: "column",
                              gap: "4px",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span className={pillClass} style={{ maxWidth: "200px" }}>
                                {STATUS_LABELS[t.status]}
                              </span>
                              <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b" }}>
                                {t.priority}
                              </span>
                            </div>
                            <div style={{ fontWeight: 600, fontSize: "13px", color: "#0f172a" }}>
                              {t.title}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setCreateTaskDates({
                          start: calendarPopoverDay.dateKey,
                          due: calendarPopoverDay.dateKey,
                        });
                        setCalendarPopoverDay(null);
                        setIsCreateOpen(true);
                      }}
                      style={{ marginTop: "4px", fontSize: "12.5px" }}
                    >
                      + Add Task for this date
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === "gantt" ? (
            <TaskGanttView
              tasks={tasks}
              onSelectTask={(id) => setSelectedTaskId(id)}
              availableUsers={availableUsers}
              colorByDepartment={scopeView === "organization"}
            />
          ) : null}
        </div>

        {/* Modals & Slide-over Drawer */}
        <CreateTaskModal
          isOpen={isCreateOpen}
          onClose={() => {
            setIsCreateOpen(false);
            setCreateTaskDates({});
          }}
          onSuccess={() => {
            fetchTasks();
            setCreateTaskDates({});
          }}
          initialStartDate={createTaskDates.start}
          initialDueDate={createTaskDates.due}
        />

        <TaskDrawer
          taskId={selectedTaskId}
          isOpen={Boolean(selectedTaskId)}
          initialTab={initialDrawerTab}
          onClose={() => {
            setSelectedTaskId(null);
            setInitialDrawerTab(undefined);
          }}
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
