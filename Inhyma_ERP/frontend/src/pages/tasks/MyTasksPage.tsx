import React, { useEffect, useState, useCallback } from "react";
import type { TaskSummary, TaskStatus, TaskPriority, TaskDetail } from "@/types/tasks";
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

type TabFilter = "ALL" | TaskStatus | "OVERDUE";

export const MyTasksPage: React.FC = () => {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<TabFilter>("ALL");

  // Modal & Drawer states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [escalatingTask, setEscalatingTask] = useState<TaskDetail | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const res = await tasksApi.getMyTasks({
        search: searchQuery.trim() || undefined,
        status: activeTab === "ALL" || activeTab === "OVERDUE" ? undefined : (activeTab as TaskStatus),
      });

      let items = res.items;
      if (activeTab === "OVERDUE") {
        items = items.filter((t: TaskSummary) => isTaskOverdue(t.due_date, t.status));
      }
      setTasks(items);
    } catch (err) {
      console.error("Failed to fetch my tasks", err);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, activeTab]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Live updates via WebSocket
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

  const handleQuickToggleDone = async (e: React.MouseEvent, task: TaskSummary) => {
    e.stopPropagation();
    try {
      const newStatus: TaskStatus = task.status === "DONE" ? "TODO" : "DONE";
      await tasksApi.updateTask(task.id, { status: newStatus });
      fetchTasks();
    } catch (err) {
      console.error("Failed to toggle task completion", err);
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

  const getStatusBadgeClass = (status: TaskStatus) => {
    switch (status) {
      case "DONE":
        return "badge-status-done";
      case "IN_PROGRESS":
        return "badge-status-in-progress";
      case "REVIEW":
        return "badge-status-review";
      default:
        return "badge-status-todo";
    }
  };

  return (
    <div className="ihm-page task-management-page">
      {/* Top Header */}
      <div className="ihm-page-header">
        <div>
          <h1 className="ihm-page-title">My Tasks</h1>
          <p className="ihm-page-subtitle">
            Tasks assigned directly to you across all projects and departments
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={fetchTasks}
            title="Refresh"
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

      {/* Tabs & Search Controls */}
      <div className="task-page-controls">
        <div className="task-filter-tabs">
          {(["ALL", "TODO", "IN_PROGRESS", "REVIEW", "DONE", "OVERDUE"] as TabFilter[]).map(
            (tab) => (
              <button
                key={tab}
                type="button"
                className={`task-tab-btn ${activeTab === tab ? "active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab.replace("_", " ")}
              </button>
            )
          )}
        </div>

        <div className="task-search-wrapper">
          <IconSearch />
          <input
            type="text"
            className="form-control form-control-sm"
            placeholder="Search my tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Tasks Table / Card List */}
      <div className="task-card-container">
        {loading ? (
          <div className="task-empty-state">Loading your tasks...</div>
        ) : tasks.length === 0 ? (
          <div className="task-empty-state">
            <IconCheckSquare />
            <p style={{ marginTop: "12px", fontSize: "1.05rem", fontWeight: 500 }}>
              No tasks found in this view
            </p>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              {activeTab === "ALL"
                ? "You have no active tasks assigned to you right now."
                : `No tasks matching status "${activeTab}".`}
            </p>
            <button
              className="btn btn-primary btn-sm"
              style={{ marginTop: "16px" }}
              onClick={() => setIsCreateOpen(true)}
            >
              <IconPlus /> Create a Task
            </button>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table task-table">
              <thead>
                <tr>
                  <th style={{ width: "40px" }}></th>
                  <th>Task</th>
                  <th style={{ width: "120px" }}>Status</th>
                  <th style={{ width: "100px" }}>Priority</th>
                  <th style={{ width: "120px" }}>Subtasks</th>
                  <th style={{ width: "140px" }}>Due Date</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const overdue = isTaskOverdue(t.due_date, t.status);
                  return (
                    <tr
                      key={t.id}
                      className="task-table-row"
                      onClick={() => setSelectedTaskId(t.id)}
                    >
                      <td onClick={(e) => handleQuickToggleDone(e, t)}>
                        <input
                          type="checkbox"
                          className="task-checkbox"
                          checked={t.status === "DONE"}
                          onChange={() => {}}
                        />
                      </td>
                      <td>
                        <div className="task-row-title-container">
                          <span
                            className={`task-row-title ${
                              t.status === "DONE" ? "task-row-title-done" : ""
                            }`}
                          >
                            {t.title}
                          </span>
                          {overdue && (
                            <span className="task-badge badge-overdue">OVERDUE</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={`task-badge ${getStatusBadgeClass(t.status)}`}>
                          {t.status.replace("_", " ")}
                        </span>
                      </td>
                      <td>
                        <span className={`task-badge ${getPriorityBadgeClass(t.priority)}`}>
                          {t.priority}
                        </span>
                      </td>
                      <td>
                        {t.subtask_total > 0 ? (
                          <span className="task-subtask-indicator">
                            {t.subtask_completed}/{t.subtask_total}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>—</span>
                        )}
                      </td>
                      <td>
                        {t.due_date ? (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              fontSize: "0.85rem",
                              color: overdue ? "var(--danger)" : "var(--text-secondary)",
                            }}
                          >
                            <IconClock />
                            <span>{new Date(t.due_date).toLocaleDateString()}</span>
                          </div>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>No due date</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
