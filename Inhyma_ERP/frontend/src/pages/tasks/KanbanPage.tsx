import React, { useEffect, useState, useCallback } from "react";
import type {
  TaskSummary,
  TaskStatus,
  TaskPriority,
  TaskDetail,
  AvailableUser,
  TaskAssignee,
} from "@/types/tasks";
import { isTaskOverdue } from "@/types/tasks";
import { tasksApi } from "@/lib/tasksApi";
import { useAuth } from "@/lib/hooks";
import { liveClient } from "@/lib/live/liveClient";
import { CreateTaskModal } from "./CreateTaskModal";
import { EscalateTaskModal } from "./EscalateTaskModal";
import { TaskDrawer } from "./TaskDrawer";
import {
  IconCheckSquare,
  IconClock,
  IconPlus,
  IconSearch,
  IconRefresh,
} from "@/components/icons";

interface ColumnDef {
  key: TaskStatus;
  label: string;
  color: string;
}

const COLUMNS: ColumnDef[] = [
  { key: "TODO", label: "To Do", color: "#64748b" },
  { key: "IN_PROGRESS", label: "In Progress", color: "#3b82f6" },
  { key: "REVIEW", label: "In Review", color: "#f59e0b" },
  { key: "DONE", label: "Completed", color: "#10b981" },
];

export const KanbanPage: React.FC = () => {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "">("");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("");
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);

  // Modals & Drawer
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [escalatingTask, setEscalatingTask] = useState<TaskDetail | null>(null);

  // Drag-and-drop state
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  const loadUsers = async () => {
    try {
      const u = await tasksApi.getAvailableAssignees();
      setAvailableUsers(u);
    } catch (err) {
      console.error("Failed to fetch assignees", err);
    }
  };

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const res = await tasksApi.getTasks({
        search: searchQuery.trim() || undefined,
        priority: priorityFilter || undefined,
        assignee_id: assigneeFilter || undefined,
        limit: 200, // Load enough tasks for the board
      });
      setTasks(res.items);
    } catch (err) {
      console.error("Failed to load tasks for Kanban", err);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, priorityFilter, assigneeFilter]);

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Live WebSocket updates
  useEffect(() => {
    liveClient.subscribe("tasks");
    if (profile?.id) {
      liveClient.subscribe(`user:${profile.id}`);
    }
    const unsub = liveClient.onEvent((event) => {
      if (
        event.entity === "task" ||
        event.event_type.startsWith("TASK_") ||
        (profile?.id && event.user_id === profile.id)
      ) {
        fetchTasks();
      }
    });
    return () => unsub();
  }, [profile?.id, fetchTasks]);

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", id);
    setDraggedTaskId(id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: TaskStatus) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain") || draggedTaskId;
    setDraggedTaskId(null);
    if (!taskId) return;

    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === targetStatus) return;

    // Optimistic UI update
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: targetStatus } : t))
    );

    try {
      await tasksApi.updateTask(taskId, { status: targetStatus });
    } catch (err: any) {
      console.error("Failed to update status on drop", err);
      // Revert
      fetchTasks();
    }
  };

  const getPriorityBadgeClass = (priority: TaskPriority) => {
    switch (priority) {
      case "CRITICAL":
        return "badge-priority-critical";
      case "HIGH":
        return "badge-priority-high";
      case "MEDIUM":
        return "badge-priority-medium";
      default:
        return "badge-priority-low";
    }
  };

  return (
    <div className="ihm-page task-management-page">
      {/* Header */}
      <div className="ihm-page-header">
        <div>
          <h1 className="ihm-page-title">Task Kanban Board</h1>
          <p className="ihm-page-subtitle">
            Visual workflow pipeline — drag and drop cards across lifecycle states
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={fetchTasks}
            title="Refresh board"
          >
            <IconRefresh />
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setIsCreateOpen(true)}
          >
            <IconPlus /> New Task
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="task-filter-bar">
        <div className="task-search-wrapper" style={{ flex: "1 1 240px" }}>
          <IconSearch />
          <input
            type="text"
            className="form-control form-control-sm"
            placeholder="Search board cards..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <select
          className="form-control form-control-sm"
          style={{ width: "140px" }}
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | "")}
        >
          <option value="">All Priorities</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </select>

        <select
          className="form-control form-control-sm"
          style={{ width: "180px" }}
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
        >
          <option value="">All Assignees</option>
          {availableUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name}
            </option>
          ))}
        </select>
      </div>

      {/* Kanban Board Container */}
      {loading && tasks.length === 0 ? (
        <div className="task-card-container">
          <div className="task-empty-state">Loading Kanban board...</div>
        </div>
      ) : (
        <div className="task-kanban-board">
          {COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.key);
            return (
              <div
                key={col.key}
                className="task-kanban-column"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, col.key)}
              >
                {/* Column Header */}
                <div className="task-kanban-column-header">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: col.color,
                      }}
                    />
                    <span className="task-kanban-column-title">{col.label}</span>
                    <span className="task-kanban-count">{colTasks.length}</span>
                  </div>

                  {col.key === "TODO" && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={() => setIsCreateOpen(true)}
                      title="Add task to To Do"
                    >
                      <IconPlus />
                    </button>
                  )}
                </div>

                {/* Column Cards Drop Area */}
                <div className="task-kanban-card-list">
                  {colTasks.length === 0 ? (
                    <div className="task-kanban-empty-drop">
                      Drop tasks here
                    </div>
                  ) : (
                    colTasks.map((t) => {
                      const overdue = isTaskOverdue(t.due_date, t.status);
                      return (
                        <div
                          key={t.id}
                          className={`task-kanban-card ${
                            draggedTaskId === t.id ? "dragging" : ""
                          }`}
                          draggable
                          onDragStart={(e) => handleDragStart(e, t.id)}
                          onClick={() => setSelectedTaskId(t.id)}
                        >
                          {/* Card Top Row */}
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginBottom: "6px" }}>
                            <span className={`task-badge ${getPriorityBadgeClass(t.priority)}`}>
                              {t.priority}
                            </span>
                            {overdue && (
                              <span className="task-badge badge-overdue">OVERDUE</span>
                            )}
                          </div>

                          {/* Card Title */}
                          <h4
                            className={`task-kanban-card-title ${
                              t.status === "DONE" ? "task-row-title-done" : ""
                            }`}
                          >
                            {t.title}
                          </h4>

                          {/* Card Meta Footer */}
                          <div className="task-kanban-card-footer">
                            <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "0.78rem" }}>
                              {t.due_date && (
                                <span
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    color: overdue ? "var(--danger)" : "var(--text-muted)",
                                  }}
                                >
                                  <IconClock />
                                  {new Date(t.due_date).toLocaleDateString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                  })}
                                </span>
                              )}

                              {t.subtask_total > 0 && (
                                <span
                                  style={{
                                    color: "var(--text-muted)",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "3px",
                                  }}
                                >
                                  <IconCheckSquare />
                                  {t.subtask_completed}/{t.subtask_total}
                                </span>
                              )}
                            </div>

                            <div className="task-avatar-group">
                              {t.assignees &&
                                t.assignees.slice(0, 3).map((a: TaskAssignee) => {
                                  const name = a.user?.full_name || a.user?.username || "U";
                                  return (
                                    <span
                                      key={a.id}
                                      className="task-avatar"
                                      title={name}
                                    >
                                      {name.slice(0, 2).toUpperCase()}
                                    </span>
                                  );
                                })}
                              {t.assignees && t.assignees.length > 3 && (
                                <span className="task-avatar" style={{ fontSize: "0.65rem" }}>
                                  +{t.assignees.length - 3}
                                </span>
                              )}
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
      )}

      {/* Create Task Modal */}
      <CreateTaskModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={() => {
          setIsCreateOpen(false);
          fetchTasks();
        }}
      />

      {/* Escalate Task Modal */}
      {escalatingTask && (
        <EscalateTaskModal
          isOpen={!!escalatingTask}
          taskId={escalatingTask.id}
          taskTitle={escalatingTask.title}
          onClose={() => setEscalatingTask(null)}
          onSuccess={() => {
            setEscalatingTask(null);
            fetchTasks();
          }}
        />
      )}

      {/* Task Drawer */}
      <TaskDrawer
        taskId={selectedTaskId}
        isOpen={!!selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
        onTaskUpdated={fetchTasks}
        onEscalateRequest={(taskDetail) => {
          setEscalatingTask(taskDetail);
        }}
      />
    </div>
  );
};
