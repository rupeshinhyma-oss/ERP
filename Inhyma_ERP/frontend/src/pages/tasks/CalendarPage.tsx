import React, { useEffect, useState, useCallback } from "react";
import type {
  TaskSummary,
  TaskDetail,
} from "@/types/tasks";
import { isTaskOverdue } from "@/types/tasks";
import { tasksApi } from "@/lib/tasksApi";
import { useAuth } from "@/lib/hooks";
import { liveClient } from "@/lib/live/liveClient";
import { CreateTaskModal } from "./CreateTaskModal";
import { EscalateTaskModal } from "./EscalateTaskModal";
import { TaskDrawer } from "./TaskDrawer";
import {
  IconPlus,
  IconRefresh,
} from "@/components/icons";

export const CalendarPage: React.FC = () => {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<TaskSummary[]>([]);

  // Month navigation: current active month & year
  const [currentDate, setCurrentDate] = useState(() => new Date());

  // Modals & Drawer
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [escalatingTask, setEscalatingTask] = useState<TaskDetail | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth(); // 0-indexed

  const fetchTasks = useCallback(async () => {
    try {
      const res = await tasksApi.getTasks({ limit: 300 });
      setTasks(res.items);
    } catch (err) {
      console.error("Failed to load tasks for calendar", err);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Live updates
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

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const handleDayClick = () => {
    setIsCreateOpen(true);
  };

  // Build calendar matrix (35 or 42 cells)
  const firstDayOfMonth = new Date(year, month, 1);
  const startingDayOfWeek = firstDayOfMonth.getDay(); // 0 for Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  interface CalendarCell {
    date: Date;
    dayNum: number;
    isCurrentMonth: boolean;
    isToday: boolean;
    dateKey: string; // YYYY-MM-DD
    tasks: TaskSummary[];
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  // Group tasks with due date by YYYY-MM-DD
  const tasksByDate = new Map<string, TaskSummary[]>();
  const unscheduledTasks: TaskSummary[] = [];

  tasks.forEach((t) => {
    if (t.due_date) {
      const key = String(t.due_date).slice(0, 10);
      const list = tasksByDate.get(key) || [];
      list.push(t);
      tasksByDate.set(key, list);
    } else {
      unscheduledTasks.push(t);
    }
  });

  const cells: CalendarCell[] = [];

  // Previous month trailing days
  for (let i = startingDayOfWeek - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const cellDate = new Date(year, month - 1, d);
    const key = cellDate.toISOString().slice(0, 10);
    cells.push({
      date: cellDate,
      dayNum: d,
      isCurrentMonth: false,
      isToday: key === todayStr,
      dateKey: key,
      tasks: tasksByDate.get(key) || [],
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const cellDate = new Date(year, month, d);
    const monthFormatted = String(month + 1).padStart(2, "0");
    const dayFormatted = String(d).padStart(2, "0");
    const key = `${year}-${monthFormatted}-${dayFormatted}`;
    cells.push({
      date: cellDate,
      dayNum: d,
      isCurrentMonth: true,
      isToday: key === todayStr,
      dateKey: key,
      tasks: tasksByDate.get(key) || [],
    });
  }

  // Next month leading days to complete grid (up to 35 or 42)
  const totalCellsNeeded = cells.length > 35 ? 42 : 35;
  const remaining = totalCellsNeeded - cells.length;
  for (let d = 1; d <= remaining; d++) {
    const cellDate = new Date(year, month + 1, d);
    const key = cellDate.toISOString().slice(0, 10);
    cells.push({
      date: cellDate,
      dayNum: d,
      isCurrentMonth: false,
      isToday: key === todayStr,
      dateKey: key,
      tasks: tasksByDate.get(key) || [],
    });
  }

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  return (
    <div className="ihm-page task-management-page">
      {/* Header */}
      <div className="ihm-page-header">
        <div>
          <h1 className="ihm-page-title">Task Calendar</h1>
          <p className="ihm-page-subtitle">
            Schedule deadlines, visualize milestone dates, and track timelines
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

      {/* Calendar Navigation Bar */}
      <div className="task-calendar-nav">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <h2 className="task-calendar-month-title">
            {monthNames[month]} {year}
          </h2>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleToday}
          >
            Today
          </button>
        </div>

        <div style={{ display: "flex", gap: "6px" }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handlePrevMonth}
            title="Previous month"
          >
            &larr; Prev
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleNextMonth}
            title="Next month"
          >
            Next &rarr;
          </button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="task-calendar-wrapper">
        {/* Day of Week Headers */}
        <div className="task-calendar-header-row">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="task-calendar-header-cell">
              {day}
            </div>
          ))}
        </div>

        {/* 35 or 42 Days Grid */}
        <div className="task-calendar-grid">
          {cells.map((cell) => (
            <div
              key={cell.dateKey}
              className={`task-calendar-day-cell ${
                !cell.isCurrentMonth ? "outside-month" : ""
              } ${cell.isToday ? "today" : ""}`}
              onClick={() => handleDayClick()}
            >
              <div className="task-calendar-day-header">
                <span className={`task-calendar-day-number ${cell.isToday ? "today-badge" : ""}`}>
                  {cell.dayNum}
                </span>
                <span className="task-calendar-add-btn" title="Add task on this date">
                  +
                </span>
              </div>

              <div className="task-calendar-pills">
                {cell.tasks.slice(0, 3).map((t) => {
                  const overdue = isTaskOverdue(t.due_date, t.status);
                  return (
                    <div
                      key={t.id}
                      className={`task-calendar-pill status-${t.status.toLowerCase()} ${
                        overdue ? "pill-overdue" : ""
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTaskId(t.id);
                      }}
                      title={`${t.title} (${t.status})`}
                    >
                      <span className="task-pill-dot" />
                      <span className="task-pill-title">{t.title}</span>
                    </div>
                  );
                })}

                {cell.tasks.length > 3 && (
                  <div
                    className="task-calendar-more"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDayClick();
                    }}
                  >
                    +{cell.tasks.length - 3} more
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Unscheduled Tasks Section */}
      {unscheduledTasks.length > 0 && (
        <div className="task-card-container" style={{ marginTop: "24px" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "12px" }}>
            Unscheduled Tasks ({unscheduledTasks.length})
          </h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {unscheduledTasks.map((t) => (
              <div
                key={t.id}
                className="task-unscheduled-pill"
                onClick={() => setSelectedTaskId(t.id)}
              >
                <span>{t.title}</span>
                <span className="task-badge" style={{ fontSize: "0.7rem", padding: "1px 6px" }}>
                  {t.status.replace("_", " ")}
                </span>
              </div>
            ))}
          </div>
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
