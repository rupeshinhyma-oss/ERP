import React, { useMemo, useState } from "react";
import type { TaskSummary } from "@/types/tasks";

interface TaskGanttViewProps {
  tasks: TaskSummary[];
  onSelectTask: (taskId: string) => void;
}

export const TaskGanttView: React.FC<TaskGanttViewProps> = ({ tasks, onSelectTask }) => {
  const [zoomLevel, setZoomLevel] = useState<"day" | "week">("day");

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
      maxTime = now + 21 * 24 * 60 * 60 * 1000;
    } else {
      // Pad by 3 days before and 7 days after
      minTime = Math.min(minTime, now - 3 * 24 * 60 * 60 * 1000) - 3 * 24 * 60 * 60 * 1000;
      maxTime = Math.max(maxTime, now + 7 * 24 * 60 * 60 * 1000) + 7 * 24 * 60 * 60 * 1000;
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

  const columnWidth = zoomLevel === "day" ? 44 : 24;
  const chartWidth = totalDays * columnWidth;

  const getPositionPercent = (timestamp: number) => {
    const clamped = Math.max(timelineStart, Math.min(timelineEnd, timestamp));
    return ((clamped - timelineStart) / (timelineEnd - timelineStart)) * 100;
  };

  const todayPercent = getPositionPercent(Date.now());

  const getStatusColor = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "bg-emerald-500 text-white";
      case "IN_PROGRESS":
        return "bg-indigo-500 text-white";
      case "IN_REVIEW":
        return "bg-amber-500 text-white";
      case "PENDING_APPROVAL":
        return "bg-purple-500 text-white";
      case "ON_HOLD":
        return "bg-slate-400 text-white";
      default:
        return "bg-blue-400 text-white";
    }
  };

  const getIssueBadge = (type?: string) => {
    switch (type) {
      case "BUG":
        return "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300";
      case "STORY":
        return "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300";
      case "EPIC":
        return "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300";
      case "IMPROVEMENT":
        return "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300";
      case "APPROVAL":
        return "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300";
      default:
        return "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300";
    }
  };

  return (
    <div className="flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
      {/* Top Controls */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Gantt Timeline</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {tasks.length} task{tasks.length === 1 ? "" : "s"} across {totalDays} days
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-700 p-0.5 text-xs bg-white dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setZoomLevel("day")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                zoomLevel === "day"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-600 dark:text-slate-300 hover:text-slate-900"
              }`}
            >
              Day
            </button>
            <button
              type="button"
              onClick={() => setZoomLevel("week")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                zoomLevel === "week"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-600 dark:text-slate-300 hover:text-slate-900"
              }`}
            >
              Compact
            </button>
          </div>
        </div>
      </div>

      {/* Main Split Layout: Left Frozen Task List, Right Scrollable Timeline */}
      <div className="flex overflow-hidden relative">
        {/* Left Column (Task List) */}
        <div className="w-80 flex-shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 z-10 shadow-sm">
          {/* Header */}
          <div className="h-12 border-b border-slate-200 dark:border-slate-800 px-4 flex items-center text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/70 dark:bg-slate-950/30">
            Task
          </div>
          {/* Rows */}
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {tasks.map((task) => (
              <div
                key={task.id}
                onClick={() => onSelectTask(task.id)}
                className="h-12 px-4 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border flex-shrink-0 ${getIssueBadge(
                      task.issue_type
                    )}`}
                  >
                    {task.issue_type || "TASK"}
                  </span>
                  <span className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate" title={task.title}>
                    {task.title}
                  </span>
                </div>
                {task.progress_percent !== undefined && (
                  <span className="text-[10px] font-semibold text-slate-400 flex-shrink-0">
                    {Math.round(task.progress_percent)}%
                  </span>
                )}
              </div>
            ))}
            {tasks.length === 0 && (
              <div className="p-6 text-center text-xs text-slate-400">No tasks in current view.</div>
            )}
          </div>
        </div>

        {/* Right Scrollable Timeline Area */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div style={{ width: `${chartWidth}px` }} className="relative">
            {/* Timeline Header */}
            <div className="h-12 border-b border-slate-200 dark:border-slate-800 flex bg-slate-50/70 dark:bg-slate-950/30">
              {dates.map((d, idx) => {
                const isToday =
                  d.getDate() === new Date().getDate() &&
                  d.getMonth() === new Date().getMonth() &&
                  d.getFullYear() === new Date().getFullYear();
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;

                return (
                  <div
                    key={idx}
                    style={{ width: `${columnWidth}px` }}
                    className={`flex-shrink-0 border-r border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center text-[10px] ${
                      isToday
                        ? "bg-indigo-50/60 dark:bg-indigo-950/30 text-indigo-600 font-bold"
                        : isWeekend
                        ? "bg-slate-100/40 dark:bg-slate-800/20 text-slate-400"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    <span className="leading-none">{d.toLocaleDateString("en-US", { weekday: "narrow" })}</span>
                    <span className="text-[11px] font-semibold mt-0.5">{d.getDate()}</span>
                  </div>
                );
              })}
            </div>

            {/* Today vertical guideline */}
            {todayPercent >= 0 && todayPercent <= 100 && (
              <div
                className="absolute top-0 bottom-0 z-20 border-l-2 border-indigo-500 pointer-events-none"
                style={{ left: `${todayPercent}%` }}
              >
                <span className="absolute -top-1 -left-3.5 bg-indigo-600 text-white text-[9px] px-1 rounded-sm font-semibold">
                  Today
                </span>
              </div>
            )}

            {/* Task Bar Rows */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {tasks.map((task) => {
                const sTime = task.start_date
                  ? new Date(task.start_date).getTime()
                  : new Date(task.created_at).getTime();
                const dTime = task.due_date
                  ? new Date(task.due_date).getTime()
                  : sTime + 3 * 24 * 60 * 60 * 1000;

                const leftPct = Math.max(0, getPositionPercent(sTime));
                const rightPct = Math.min(100, getPositionPercent(dTime));
                const widthPct = Math.max(1.5, rightPct - leftPct);
                const progress = task.progress_percent || 0;

                return (
                  <div
                    key={task.id}
                    className="h-12 relative flex items-center hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors"
                  >
                    {/* Background grid lines */}
                    <div className="absolute inset-0 flex pointer-events-none">
                      {dates.map((d, idx) => (
                        <div
                          key={idx}
                          style={{ width: `${columnWidth}px` }}
                          className={`flex-shrink-0 border-r border-slate-100 dark:border-slate-800/40 h-full ${
                            d.getDay() === 0 || d.getDay() === 6 ? "bg-slate-50/30 dark:bg-slate-900/40" : ""
                          }`}
                        />
                      ))}
                    </div>

                    {/* Gantt Bar */}
                    <div
                      onClick={() => onSelectTask(task.id)}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                      }}
                      className={`absolute h-7 rounded-md cursor-pointer shadow-sm hover:ring-2 hover:ring-indigo-400 overflow-hidden flex items-center transition-all z-10 ${getStatusColor(
                        task.status
                      )}`}
                      title={`${task.title} (${task.status}) - ${Math.round(progress)}% complete`}
                    >
                      {/* Progress fill bar */}
                      <div
                        style={{ width: `${progress}%` }}
                        className="absolute inset-y-0 left-0 bg-black/20"
                      />

                      <div className="relative px-2 flex items-center gap-1.5 w-full text-xs font-semibold drop-shadow-sm truncate">
                        <span className="truncate">{task.title}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
