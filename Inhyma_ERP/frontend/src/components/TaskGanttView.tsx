import React, { useMemo, useState } from "react";
import type { AvailableUser, TaskSummary } from "@/types/tasks";

interface TaskGanttViewProps {
  tasks: TaskSummary[];
  onSelectTask: (taskId: string) => void;
  availableUsers?: AvailableUser[];
  colorByDepartment?: boolean;
}

interface GanttVisibleItem {
  task: TaskSummary;
  isEpic: boolean;
  isChild: boolean;
  childCount: number;
}

export const TaskGanttView: React.FC<TaskGanttViewProps> = ({
  tasks,
  onSelectTask,
  availableUsers = [],
  colorByDepartment = false,
}) => {
  const [zoomLevel, setZoomLevel] = useState<"week" | "month">("week");
  const [collapsedEpics, setCollapsedEpics] = useState<Set<string>>(new Set());

  // Toggle collapse/expand for an Epic
  const toggleEpicCollapse = (epicId: string) => {
    setCollapsedEpics((prev) => {
      const next = new Set(prev);
      if (next.has(epicId)) {
        next.delete(epicId);
      } else {
        next.add(epicId);
      }
      return next;
    });
  };

  // Organize tasks into Epic hierarchy
  const { epics, childrenByParentId, standaloneTasks } = useMemo(() => {
    const epicMap = new Map<string, TaskSummary>();
    const childMap = new Map<string, TaskSummary[]>();
    const standalone: TaskSummary[] = [];

    // First pass: identify explicit Epics or parents
    tasks.forEach((t) => {
      if (t.issue_type === "EPIC") {
        epicMap.set(t.id, t);
      }
    });

    tasks.forEach((t) => {
      if (t.parent_task_id && epicMap.has(t.parent_task_id)) {
        const list = childMap.get(t.parent_task_id) || [];
        list.push(t);
        childMap.set(t.parent_task_id, list);
      } else if (t.issue_type !== "EPIC") {
        standalone.push(t);
      }
    });

    return {
      epics: Array.from(epicMap.values()),
      childrenByParentId: childMap,
      standaloneTasks: standalone,
    };
  }, [tasks]);

  // Flattened visible items list based on collapsed state
  const visibleItems = useMemo<GanttVisibleItem[]>(() => {
    const list: GanttVisibleItem[] = [];

    epics.forEach((epic) => {
      const children = childrenByParentId.get(epic.id) || [];
      list.push({
        task: epic,
        isEpic: true,
        isChild: false,
        childCount: children.length,
      });

      if (!collapsedEpics.has(epic.id)) {
        children.forEach((child) => {
          list.push({
            task: child,
            isEpic: false,
            isChild: true,
            childCount: 0,
          });
        });
      }
    });

    standaloneTasks.forEach((t) => {
      list.push({
        task: t,
        isEpic: false,
        isChild: false,
        childCount: 0,
      });
    });

    return list;
  }, [epics, childrenByParentId, standaloneTasks, collapsedEpics]);

  // Map task ID to row index in visibleItems for SVG dependency lines
  const taskRowIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    visibleItems.forEach((item, index) => {
      map.set(item.task.id, index);
    });
    return map;
  }, [visibleItems]);

  // Calculate timeline range
  const { timelineStart, timelineEnd, totalDays, dates } = useMemo(() => {
    let minTime = Number.POSITIVE_INFINITY;
    let maxTime = Number.NEGATIVE_INFINITY;

    tasks.forEach((t) => {
      const s = t.start_date ? new Date(t.start_date).getTime() : new Date(t.created_at).getTime();
      const d = t.due_date ? new Date(t.due_date).getTime() : s + 3 * 24 * 60 * 60 * 1000;
      if (s < minTime) minTime = s;
      if (d > maxTime) maxTime = d;
    });

    const now = Date.now();
    if (!Number.isFinite(minTime)) {
      minTime = now - 7 * 24 * 60 * 60 * 1000;
      maxTime = now + 28 * 24 * 60 * 60 * 1000;
    } else {
      // Pad by 5 days before and 10 days after
      minTime = Math.min(minTime, now - 3 * 24 * 60 * 60 * 1000) - 5 * 24 * 60 * 60 * 1000;
      maxTime = Math.max(maxTime, now + 7 * 24 * 60 * 60 * 1000) + 10 * 24 * 60 * 60 * 1000;
    }

    const startDate = new Date(minTime);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(maxTime);
    endDate.setHours(23, 59, 59, 999);

    const diffDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));

    const dateList: Date[] = [];
    for (let i = 0; i < diffDays; i++) {
      const cur = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      dateList.push(cur);
    }

    return {
      timelineStart: startDate.getTime(),
      timelineEnd: endDate.getTime(),
      totalDays: diffDays,
      dates: dateList,
    };
  }, [tasks]);

  const columnWidth = zoomLevel === "week" ? 42 : 22;
  const chartWidth = totalDays * columnWidth;
  const rowHeight = 46;
  const totalChartHeight = visibleItems.length * rowHeight;

  const getPositionX = (timestamp: number) => {
    const clamped = Math.max(timelineStart, Math.min(timelineEnd, timestamp));
    const pct = (clamped - timelineStart) / (timelineEnd - timelineStart);
    return pct * chartWidth;
  };

  const todayX = getPositionX(Date.now());

  const getStatusFill = (status: string) => {
    switch (status) {
      case "DONE":
        return "#16a34a";
      case "IN_PROGRESS":
        return "#2563eb";
      case "REVIEW":
        return "#9333ea";
      case "PENDING_APPROVAL":
        return "#8b5cf6";
      case "ON_HOLD":
        return "#64748b";
      default:
        return "#3b82f6";
    }
  };

  const getIssueBadgeStyle = (type?: string) => {
    switch (type) {
      case "BUG":
        return { background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" };
      case "STORY":
        return { background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0" };
      case "EPIC":
        return { background: "#f3e8ff", color: "#6b21a8", border: "1px solid #e9d5ff" };
      case "IMPROVEMENT":
        return { background: "#e0f2fe", color: "#075985", border: "1px solid #bae6fd" };
      case "APPROVAL":
        return { background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" };
      default:
        return { background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" };
    }
  };

  const getTaskDepartment = (t: TaskSummary) => {
    const INVALID_DEPTS = new Set(["staff", "super_admin", "admin", "user"]);
    const assignees = t.assignees.filter((a) => a.assignment_role !== "WATCHER");
    for (const a of assignees) {
      const u = availableUsers.find((user) => user.id === a.user_id);
      if (u?.department && !INVALID_DEPTS.has(u.department.toLowerCase())) return u.department;
    }
    if (t.created_by) {
      const creator = availableUsers.find((u) => u.id === t.created_by);
      if (creator?.department && !INVALID_DEPTS.has(creator.department.toLowerCase())) return creator.department;
    }
    return "General";
  };

  const getDepartmentBarColor = (deptName: string) => {
    const palette: Record<string, string> = {
      Frontend: "#2563eb",
      Backend: "#16a34a",
      "Cloud Setup": "#0284c7",
      IT: "#7c3aed",
      Director: "#9333ea",
      Management: "#c026d3",
      Design: "#e11d48",
      QA: "#ea580c",
      Sales: "#d97706",
      Operations: "#0d9488",
      Finance: "#475569",
      HR: "#db2777",
    };
    if (palette[deptName]) return palette[deptName];
    let hash = 0;
    for (let i = 0; i < deptName.length; i++) {
      hash = deptName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 45%)`;
  };

  // Compute dependency connector paths between visible tasks
  const dependencyPaths = useMemo(() => {
    const paths: { id: string; d: string; fromTitle: string; toTitle: string }[] = [];

    visibleItems.forEach((targetItem, targetRowIdx) => {
      const targetTask = targetItem.task;
      const depIds = targetTask.depends_on_task_ids || [];

      depIds.forEach((sourceId) => {
        const sourceRowIdx = taskRowIndexMap.get(sourceId);
        if (sourceRowIdx === undefined) return;

        const sourceItem = visibleItems[sourceRowIdx];
        if (!sourceItem) return;

        // Source end point (right of source task bar)
        const sStart = sourceItem.task.start_date
          ? new Date(sourceItem.task.start_date).getTime()
          : new Date(sourceItem.task.created_at).getTime();
        const sDue = sourceItem.task.due_date
          ? new Date(sourceItem.task.due_date).getTime()
          : sStart + 3 * 24 * 60 * 60 * 1000;
        const sourceRightX = Math.max(getPositionX(sDue), getPositionX(sStart) + 40);
        const sourceY = sourceRowIdx * rowHeight + rowHeight / 2;

        // Target start point (left of target task bar)
        const tStart = targetTask.start_date
          ? new Date(targetTask.start_date).getTime()
          : new Date(targetTask.created_at).getTime();
        const targetLeftX = getPositionX(tStart);
        const targetY = targetRowIdx * rowHeight + rowHeight / 2;

        // Draw bezier curve connector
        const deltaX = Math.max(16, Math.abs(targetLeftX - sourceRightX) / 2);
        const d = `M ${sourceRightX} ${sourceY} C ${sourceRightX + deltaX} ${sourceY}, ${targetLeftX - deltaX} ${targetY}, ${targetLeftX} ${targetY}`;

        paths.push({
          id: `${sourceId}->${targetTask.id}`,
          d,
          fromTitle: sourceItem.task.title,
          toTitle: targetTask.title,
        });
      });
    });

    return paths;
  }, [visibleItems, taskRowIndexMap, columnWidth, timelineStart, timelineEnd]);

  return (
    <div
      className="card"
      style={{
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: "10px",
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      {/* Top Controls Toolbar */}
      <div
        style={{
          padding: "12px 18px",
          borderBottom: "1px solid #e2e8f0",
          background: "#f8fafc",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b" }}>📈 Interactive Gantt Timeline</span>
          <span style={{ fontSize: "12px", color: "#64748b" }}>
            {tasks.length} task{tasks.length === 1 ? "" : "s"} &bull; {totalDays} days
          </span>
          {epics.length > 0 && (
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                background: "#f3e8ff",
                color: "#7e22ce",
                padding: "2px 8px",
                borderRadius: "10px",
              }}
            >
              👑 {epics.length} Epics
            </span>
          )}
        </div>

        {/* Zoom & View Toggles */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>Zoom:</span>
          <div
            style={{
              display: "inline-flex",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              padding: "2px",
            }}
          >
            <button
              type="button"
              onClick={() => setZoomLevel("week")}
              style={{
                padding: "4px 12px",
                borderRadius: "4px",
                fontSize: "12px",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                background: zoomLevel === "week" ? "#2563eb" : "transparent",
                color: zoomLevel === "week" ? "#ffffff" : "#475569",
              }}
            >
              Week View
            </button>
            <button
              type="button"
              onClick={() => setZoomLevel("month")}
              style={{
                padding: "4px 12px",
                borderRadius: "4px",
                fontSize: "12px",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                background: zoomLevel === "month" ? "#2563eb" : "transparent",
                color: zoomLevel === "month" ? "#ffffff" : "#475569",
              }}
            >
              Month View
            </button>
          </div>
        </div>
      </div>

      {/* Main Split Layout: Sticky Left Task Column + Scrollable SVG Timeline */}
      <div className="table-scroll" style={{ display: "flex", overflowX: "auto", position: "relative" }}>
        {/* Left Column (Sticky Task List with Epic Hierarchy) */}
        <div
          style={{
            width: "320px",
            minWidth: "320px",
            flexShrink: 0,
            position: "sticky",
            left: 0,
            background: "#ffffff",
            borderRight: "2px solid #e2e8f0",
            zIndex: 20,
            boxShadow: "2px 0 6px rgba(0,0,0,0.03)",
          }}
        >
          {/* Header */}
          <div
            style={{
              height: "48px",
              borderBottom: "1px solid #e2e8f0",
              padding: "0 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "12px",
              fontWeight: 700,
              color: "#475569",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              background: "#f8fafc",
            }}
          >
            <span>Hierarchy &amp; Task</span>
            <span>Progress</span>
          </div>

          {/* Rows */}
          <div>
            {visibleItems.map((item) => {
              const { task, isEpic, isChild, childCount } = item;
              const isCollapsed = collapsedEpics.has(task.id);
              const progress = task.progress_percent !== undefined
                ? Math.round(task.progress_percent)
                : task.subtask_total > 0
                ? Math.round((task.subtask_completed / task.subtask_total) * 100)
                : task.status === "DONE"
                ? 100
                : 0;

              return (
                <div
                  key={task.id}
                  onClick={() => onSelectTask(task.id)}
                  style={{
                    height: `${rowHeight}px`,
                    padding: isChild ? "0 14px 0 32px" : "0 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderBottom: "1px solid #f1f5f9",
                    background: isEpic ? "#faf5ff" : "#ffffff",
                    cursor: "pointer",
                    transition: "background 0.15s ease",
                  }}
                  title={task.title}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                    {isEpic && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleEpicCollapse(task.id);
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: "11px",
                          color: "#7e22ce",
                          padding: "2px",
                          display: "flex",
                          alignItems: "center",
                        }}
                        title={isCollapsed ? "Expand Epic" : "Collapse Epic"}
                      >
                        {isCollapsed ? "▶" : "▼"}
                      </button>
                    )}

                    <span
                      style={{
                        fontSize: "9.5px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        padding: "1px 5px",
                        borderRadius: "4px",
                        flexShrink: 0,
                        ...getIssueBadgeStyle(task.issue_type),
                      }}
                    >
                      {task.issue_type || "TASK"}
                    </span>

                    <span
                      style={{
                        fontSize: "12.5px",
                        fontWeight: isEpic ? 700 : 500,
                        color: isEpic ? "#581c87" : "#0f172a",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {task.title}
                    </span>

                    {colorByDepartment && (
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 600,
                          padding: "1px 6px",
                          borderRadius: "10px",
                          background: "#eff6ff",
                          color: "#1d4ed8",
                          border: "1px solid #bfdbfe",
                          flexShrink: 0,
                        }}
                      >
                        {getTaskDepartment(task)}
                      </span>
                    )}

                    {isEpic && childCount > 0 && (
                      <span style={{ fontSize: "10.5px", color: "#9333ea", fontWeight: 700 }}>
                        ({childCount})
                      </span>
                    )}
                  </div>

                  <span style={{ fontSize: "11px", fontWeight: 700, color: progress === 100 ? "#16a34a" : "#64748b", flexShrink: 0 }}>
                    {progress}%
                  </span>
                </div>
              );
            })}
            {visibleItems.length === 0 && (
              <div style={{ padding: "32px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
                No tasks available for Gantt display.
              </div>
            )}
          </div>
        </div>

        {/* Right Scrollable Timeline Canvas */}
        <div style={{ width: `${chartWidth}px`, position: "relative", flexShrink: 0 }}>
          {/* Header Row */}
          <div
            style={{
              height: "48px",
              borderBottom: "1px solid #e2e8f0",
              display: "flex",
              background: "#f8fafc",
              position: "sticky",
              top: 0,
              zIndex: 10,
            }}
          >
            {dates.map((d, idx) => {
              const isToday =
                d.getDate() === new Date().getDate() &&
                d.getMonth() === new Date().getMonth() &&
                d.getFullYear() === new Date().getFullYear();
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;

              return (
                <div
                  key={idx}
                  style={{
                    width: `${columnWidth}px`,
                    flexShrink: 0,
                    borderRight: "1px solid #e2e8f0",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "10px",
                    background: isToday ? "#eff6ff" : isWeekend ? "#f1f5f9" : "transparent",
                    color: isToday ? "#2563eb" : isWeekend ? "#94a3b8" : "#475569",
                    fontWeight: isToday ? 700 : 500,
                  }}
                >
                  <span style={{ fontSize: "9px" }}>{d.toLocaleDateString("en-US", { weekday: "narrow" })}</span>
                  <span style={{ fontSize: "11px", fontWeight: 700 }}>{d.getDate()}</span>
                </div>
              );
            })}
          </div>

          {/* Today Vertical Guideline */}
          {todayX >= 0 && todayX <= chartWidth && (
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${todayX}px`,
                width: "2px",
                background: "#2563eb",
                zIndex: 15,
                pointerEvents: "none",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: "2px",
                  left: "-16px",
                  background: "#2563eb",
                  color: "#ffffff",
                  fontSize: "9px",
                  fontWeight: 700,
                  padding: "1px 5px",
                  borderRadius: "4px",
                }}
              >
                Today
              </span>
            </div>
          )}

          {/* Grid Background Columns */}
          <div
            style={{
              position: "absolute",
              top: "48px",
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              pointerEvents: "none",
            }}
          >
            {dates.map((d, idx) => {
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <div
                  key={idx}
                  style={{
                    width: `${columnWidth}px`,
                    flexShrink: 0,
                    borderRight: "1px solid #f1f5f9",
                    height: "100%",
                    background: isWeekend ? "rgba(241, 245, 249, 0.4)" : "transparent",
                  }}
                />
              );
            })}
          </div>

          {/* SVG Overlay: Dependency Connector Lines & Arrow Markers */}
          <svg
            style={{
              position: "absolute",
              top: "48px",
              left: 0,
              width: `${chartWidth}px`,
              height: `${totalChartHeight}px`,
              pointerEvents: "none",
              zIndex: 12,
            }}
          >
            <defs>
              <marker
                id="gantt-arrow"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#6366f1" />
              </marker>
            </defs>

            {dependencyPaths.map((p) => (
              <path
                key={p.id}
                d={p.d}
                fill="none"
                stroke="#6366f1"
                strokeWidth="2"
                strokeDasharray="4,2"
                markerEnd="url(#gantt-arrow)"
              />
            ))}
          </svg>

          {/* Task Bar Rows */}
          <div style={{ position: "relative", zIndex: 11 }}>
            {visibleItems.map((item) => {
              const { task, isEpic } = item;
              const sTime = task.start_date
                ? new Date(task.start_date).getTime()
                : new Date(task.created_at).getTime();
              const dTime = task.due_date
                ? new Date(task.due_date).getTime()
                : sTime + 3 * 24 * 60 * 60 * 1000;

              const leftX = getPositionX(sTime);
              const rightX = Math.max(getPositionX(dTime), leftX + 44);
              const barWidth = Math.max(36, rightX - leftX);
              const progress = task.progress_percent !== undefined
                ? Math.round(task.progress_percent)
                : task.subtask_total > 0
                ? Math.round((task.subtask_completed / task.subtask_total) * 100)
                : task.status === "DONE"
                ? 100
                : 0;

              return (
                <div
                  key={task.id}
                  style={{
                    height: `${rowHeight}px`,
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    borderBottom: "1px solid #f1f5f9",
                    background: isEpic ? "rgba(250, 245, 255, 0.5)" : "transparent",
                  }}
                >
                  {/* Gantt Bar */}
                  <div
                    onClick={() => onSelectTask(task.id)}
                    style={{
                      position: "absolute",
                      left: `${leftX}px`,
                      width: `${barWidth}px`,
                      height: isEpic ? "30px" : "26px",
                      borderRadius: isEpic ? "6px" : "4px",
                      background: isEpic
                        ? "#7e22ce"
                        : colorByDepartment
                        ? getDepartmentBarColor(getTaskDepartment(task))
                        : getStatusFill(task.status),
                      color: "#ffffff",
                      cursor: "pointer",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.12)",
                      display: "flex",
                      alignItems: "center",
                      overflow: "hidden",
                      transition: "transform 0.1s ease",
                    }}
                    title={`${task.title} (${task.status}) - ${progress}% complete`}
                  >
                    {/* Inner Progress Fill Bar */}
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: 0,
                        width: `${progress}%`,
                        background: "rgba(0, 0, 0, 0.22)",
                      }}
                    />

                    {/* Bar Label */}
                    <div
                      style={{
                        position: "relative",
                        padding: "0 8px",
                        fontSize: "11px",
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <span>{task.title}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
