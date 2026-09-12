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
  { key: "PENDING_APPROVAL", label: "Pending Approval", color: "#8b5cf6" },
  { key: "ON_HOLD", label: "On Hold", color: "#6b7280" },
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

  // Hold Modal state
  const [isHoldModalOpen, setIsHoldModalOpen] = useState(false);
  const [holdTargetTaskId, setHoldTargetTaskId] = useState<string | null>(null);
  const [holdReasonDraft, setHoldReasonDraft] = useState("");
  const [holdUntilDraft, setHoldUntilDraft] = useState("");

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

    if (targetStatus === "ON_HOLD") {
      setHoldTargetTaskId(taskId);
      setHoldReasonDraft(task.hold_reason || "");
      setHoldUntilDraft(task.hold_until || "");
      setIsHoldModalOpen(true);
      return;
    }

    // Optimistic UI update
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: targetStatus } : t))
    );

    try {
      await tasksApi.updateTask(taskId, { status: targetStatus });
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || "Failed to update status on drop";
      alert(msg);
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

      {/* Hold Reason Modal for Kanban */}
      {isHoldModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.5)",
            backdropFilter: "blur(2px)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
          onClick={() => {
            setIsHoldModalOpen(false);
            setHoldTargetTaskId(null);
            fetchTasks();
          }}
        >
          <div
            style={{
              background: "var(--bg-surface, #ffffff)",
              color: "var(--text-primary, #1e293b)",
              borderRadius: "12px",
              width: "480px",
              maxWidth: "100%",
              boxShadow: "0 20px 40px rgba(0,0,0,0.25)",
              border: "1px solid var(--border-color, #e2e8f0)",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--border-color, #e2e8f0)",
                background: "var(--bg-muted, #f8fafc)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700 }}>
                ⏸️ Place Task On Hold
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsHoldModalOpen(false);
                  setHoldTargetTaskId(null);
                  fetchTasks();
                }}
                style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "18px" }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                  Hold Reason <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Explain why this task is being put on hold (required)..."
                  value={holdReasonDraft}
                  onChange={(e) => setHoldReasonDraft(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-color, #cbd5e1)",
                    background: "var(--bg-surface, #ffffff)",
                    color: "var(--text-primary, #1e293b)",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                  Hold Until Date (Optional)
                </label>
                <input
                  type="date"
                  value={holdUntilDraft}
                  onChange={(e) => setHoldUntilDraft(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-color, #cbd5e1)",
                    background: "var(--bg-surface, #ffffff)",
                    color: "var(--text-primary, #1e293b)",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
            <div
              style={{
                padding: "12px 18px",
                borderTop: "1px solid var(--border-color, #e2e8f0)",
                background: "var(--bg-muted, #f8fafc)",
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px",
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setIsHoldModalOpen(false);
                  setHoldTargetTaskId(null);
                  fetchTasks();
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  if (!holdReasonDraft.trim()) {
                    alert("A valid, non-empty hold reason is required.");
                    return;
                  }
                  if (!holdTargetTaskId) return;
                  try {
                    await tasksApi.updateTask(holdTargetTaskId, {
                      status: "ON_HOLD",
                      hold_reason: holdReasonDraft.trim(),
                      hold_until: holdUntilDraft || null,
                    });
                    setIsHoldModalOpen(false);
                    setHoldTargetTaskId(null);
                    fetchTasks();
                  } catch (err: any) {
                    alert(err?.response?.data?.detail || "Failed to put task on hold");
                  }
                }}
              >
                Confirm Hold
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
