import React, { useEffect, useState } from "react";
import { tasksApi } from "@/lib/tasksApi";
import type { CapacityViewResponse, WorkloadDashboardResponse } from "@/types/tasks";

interface TaskWorkloadDashboardProps {
  onSelectTask?: (taskId: string) => void;
}

export const TaskWorkloadDashboard: React.FC<TaskWorkloadDashboardProps> = ({ onSelectTask: _onSelectTask }) => {
  const [activeTab, setActiveTab] = useState<"workload" | "capacity">("workload");
  const [loading, setLoading] = useState(true);
  const [workloadData, setWorkloadData] = useState<WorkloadDashboardResponse | null>(null);
  const [capacityData, setCapacityData] = useState<CapacityViewResponse | null>(null);

  // Date range for capacity view (defaults to next 14 days)
  const [capacityDays, setCapacityDays] = useState<number>(14);

  const loadData = async () => {
    try {
      setLoading(true);
      const wl = await tasksApi.fetchWorkloadDashboard();
      setWorkloadData(wl);

      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + capacityDays);
      const startStr = start.toISOString().split("T")[0];
      const endStr = end.toISOString().split("T")[0];

      const cap = await tasksApi.fetchCapacityView(startStr, endStr);
      setCapacityData(cap);
    } catch (err) {
      console.error("Failed to load workload/capacity data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [capacityDays]);

  const getCapacityColor = (taskCount: number) => {
    if (taskCount === 0) return "bg-slate-50 text-slate-400 dark:bg-slate-800/30";
    if (taskCount <= 2) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 font-medium";
    if (taskCount <= 5) return "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 font-semibold";
    return "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 font-bold";
  };

  const totalOpen =
    workloadData?.total_open_tasks ??
    workloadData?.users.reduce((acc, u) => acc + (u.open_tasks_count ?? u.open_tasks ?? 0), 0) ??
    0;
  const totalInProgress =
    workloadData?.total_in_progress_tasks ??
    workloadData?.users.reduce((acc, u) => acc + (u.in_progress_tasks_count ?? u.in_progress_tasks ?? 0), 0) ??
    0;
  const totalOverdue =
    workloadData?.total_overdue_tasks ??
    workloadData?.users.reduce((acc, u) => acc + (u.overdue_tasks_count ?? u.overdue_tasks ?? 0), 0) ??
    0;
  const totalCompleted =
    workloadData?.users.reduce((acc, u) => acc + (u.completed_tasks_count ?? u.completed_tasks_last_30d ?? 0), 0) ??
    0;
  const totalTasks =
    workloadData?.total_tasks ?? (totalOpen + totalInProgress + totalCompleted);

  // Team capacity %: ratio of completed work or capacity utilization
  const teamCapacityPercent =
    totalTasks > 0
      ? Math.round(((totalTasks - totalOverdue) / totalTasks) * 100)
      : 100;

  const getLoadBadge = (activeCount: number) => {
    if (activeCount >= 15) {
      return {
        label: "Overloaded",
        className: "load-badge load-badge-overloaded",
        dotColor: "#dc2626",
      };
    }
    if (activeCount >= 10) {
      return {
        label: "Heavy",
        className: "load-badge load-badge-heavy",
        dotColor: "#ea580c",
      };
    }
    if (activeCount >= 5) {
      return {
        label: "Medium",
        className: "load-badge load-badge-medium",
        dotColor: "#ca8a04",
      };
    }
    return {
      label: "Light",
      className: "load-badge load-badge-light",
      dotColor: "#16a34a",
    };
  };

  return (
    <div className="space-y-6" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* 5 Summary Metric Cards */}
      {workloadData && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "14px",
          }}
        >
          <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#64748b", letterSpacing: "0.04em" }}>Total Tasks</div>
            <div style={{ fontSize: "26px", fontWeight: 800, color: "#0f172a", marginTop: "6px" }}>{totalTasks}</div>
            <div style={{ fontSize: "11.5px", color: "#94a3b8", marginTop: "2px" }}>Across all members</div>
          </div>

          <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#ea580c", letterSpacing: "0.04em" }}>In Progress</div>
            <div style={{ fontSize: "26px", fontWeight: 800, color: "#ea580c", marginTop: "6px" }}>{totalInProgress}</div>
            <div style={{ fontSize: "11.5px", color: "#94a3b8", marginTop: "2px" }}>Active execution</div>
          </div>

          <div style={{ background: "#ffffff", border: "1px solid #fee2e2", borderRadius: "10px", padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#dc2626", letterSpacing: "0.04em" }}>Overdue</div>
            <div style={{ fontSize: "26px", fontWeight: 800, color: "#dc2626", marginTop: "6px" }}>{totalOverdue}</div>
            <div style={{ fontSize: "11.5px", color: "#f87171", marginTop: "2px" }}>Requires escalation</div>
          </div>

          <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#16a34a", letterSpacing: "0.04em" }}>Completed</div>
            <div style={{ fontSize: "26px", fontWeight: 800, color: "#16a34a", marginTop: "6px" }}>{totalCompleted}</div>
            <div style={{ fontSize: "11.5px", color: "#86efac", marginTop: "2px" }}>Delivered tasks</div>
          </div>

          <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#2563eb", letterSpacing: "0.04em" }}>Team Capacity %</div>
            <div style={{ fontSize: "26px", fontWeight: 800, color: "#2563eb", marginTop: "6px" }}>{teamCapacityPercent}%</div>
            <div style={{ fontSize: "11.5px", color: "#93c5fd", marginTop: "2px" }}>On-track delivery</div>
          </div>
        </div>
      )}

      {/* Sub-tabs: Workload Table vs Capacity Grid */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e2e8f0", paddingBottom: "12px" }}>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setActiveTab("workload")}
            style={{
              padding: "7px 14px",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              border: "none",
              background: activeTab === "workload" ? "#2563eb" : "#f1f5f9",
              color: activeTab === "workload" ? "#ffffff" : "#475569",
              boxShadow: activeTab === "workload" ? "0 1px 2px rgba(37,99,235,0.2)" : "none",
            }}
          >
            👥 Team Workload Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("capacity")}
            style={{
              padding: "7px 14px",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              border: "none",
              background: activeTab === "capacity" ? "#2563eb" : "#f1f5f9",
              color: activeTab === "capacity" ? "#ffffff" : "#475569",
              boxShadow: activeTab === "capacity" ? "0 1px 2px rgba(37,99,235,0.2)" : "none",
            }}
          >
            📅 Capacity &amp; Availability Matrix
          </button>
        </div>

        {activeTab === "capacity" && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#64748b" }}>
            <span>Timeline:</span>
            {[7, 14, 30].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setCapacityDays(days)}
                style={{
                  padding: "4px 10px",
                  borderRadius: "4px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: capacityDays === days ? "1px solid #2563eb" : "1px solid #cbd5e1",
                  background: capacityDays === days ? "#eff6ff" : "#ffffff",
                  color: capacityDays === days ? "#1d4ed8" : "#475569",
                }}
              >
                {days} Days
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ padding: "48px 0", textAlign: "center", color: "#64748b", fontSize: "14px" }}>Loading team data...</div>
      ) : activeTab === "workload" ? (
        /* Team Workload Table */
        <div className="card" style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div className="table-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                  <th className="table-sticky-col" style={{ padding: "12px 16px", fontWeight: 700 }}>Team Member</th>
                  <th style={{ padding: "12px 16px", fontWeight: 700 }}>Department</th>
                  <th style={{ padding: "12px 16px", fontWeight: 700, textAlign: "center" }}>Open</th>
                  <th style={{ padding: "12px 16px", fontWeight: 700, textAlign: "center" }}>In Progress</th>
                  <th style={{ padding: "12px 16px", fontWeight: 700, textAlign: "center" }}>Overdue</th>
                  <th style={{ padding: "12px 16px", fontWeight: 700, textAlign: "center" }}>Completed</th>
                  <th style={{ padding: "12px 16px", fontWeight: 700, minWidth: "160px" }}>Completion Progress</th>
                  <th style={{ padding: "12px 16px", fontWeight: 700 }}>Load Status</th>
                </tr>
              </thead>
              <tbody>
                {workloadData?.users.map((u) => {
                  const userName = u.user_name || u.full_name || "Team Member";
                  const userEmail = u.user_email || u.email || "";
                  const openCount = u.open_tasks_count ?? u.open_tasks ?? 0;
                  const inProgressCount = u.in_progress_tasks_count ?? u.in_progress_tasks ?? 0;
                  const overdueCount = u.overdue_tasks_count ?? u.overdue_tasks ?? 0;
                  const completedCount = u.completed_tasks_count ?? u.completed_tasks_last_30d ?? 0;
                  const totalActive = openCount + inProgressCount;
                  const memberTotal = totalActive + completedCount;
                  const progressPct = memberTotal > 0 ? Math.round((completedCount / memberTotal) * 100) : 0;
                  const load = getLoadBadge(totalActive);

                  return (
                    <tr key={u.user_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td className="table-sticky-col" style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <div
                            style={{
                              width: "32px",
                              height: "32px",
                              borderRadius: "50%",
                              background: "#eff6ff",
                              color: "#2563eb",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "13px",
                              fontWeight: 700,
                              border: "1px solid #bfdbfe",
                              flexShrink: 0,
                            }}
                          >
                            {userName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: "#0f172a" }}>{userName}</div>
                            <div style={{ fontSize: "11px", color: "#64748b" }}>{userEmail}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px", color: "#475569" }}>
                        {u.department_name || "General"}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "center", fontWeight: 600, color: "#334155" }}>
                        {openCount}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "center", fontWeight: 600, color: "#ea580c" }}>
                        {inProgressCount}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "center", fontWeight: 700, color: overdueCount > 0 ? "#dc2626" : "#64748b" }}>
                        {overdueCount}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "center", fontWeight: 600, color: "#16a34a" }}>
                        {completedCount}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ width: "36px", fontSize: "11.5px", fontWeight: 700, color: "#334155" }}>{progressPct}%</span>
                          <div style={{ flex: 1, height: "6px", background: "#e2e8f0", borderRadius: "3px", overflow: "hidden" }}>
                            <div
                              style={{
                                width: `${progressPct}%`,
                                height: "100%",
                                background: progressPct === 100 ? "#16a34a" : "#2563eb",
                                transition: "width 0.3s ease",
                              }}
                            />
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <span className={load.className}>
                          <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: load.dotColor }} />
                          <span>{load.label} ({totalActive} active)</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {(!workloadData?.users || workloadData.users.length === 0) && (
                  <tr>
                    <td colSpan={8} style={{ padding: "32px", textAlign: "center", color: "#94a3b8" }}>
                      No active team members found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Capacity Calendar Grid */
        <div className="card" style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div className="table-scroll">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/30 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4 w-48 sticky left-0 bg-slate-50 dark:bg-slate-950 z-10 border-r border-slate-200 dark:border-slate-800">
                    Team Member
                  </th>
                  {(capacityData?.users[0]?.allocations || capacityData?.users[0]?.days || []).map((d, idx) => {
                    const dateObj = new Date(d.date);
                    return (
                      <th
                        key={idx}
                        className="py-2 px-2 text-center min-w-[50px] border-r border-slate-100 dark:border-slate-800"
                      >
                        <div className="text-[10px] text-slate-400">
                          {dateObj.toLocaleDateString("en-US", { weekday: "narrow" })}
                        </div>
                        <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {dateObj.getDate()}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                {capacityData?.users.map((u) => {
                  const uName = u.user_name || u.full_name || "Team Member";
                  const daysList = u.allocations || u.days || [];
                  return (
                    <tr key={u.user_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-100 sticky left-0 bg-white dark:bg-slate-900 z-10 border-r border-slate-200 dark:border-slate-800 truncate max-w-[180px]">
                        {uName}
                      </td>
                      {daysList.map((d, idx) => (
                        <td
                          key={idx}
                          className={`py-2 px-1 text-center border-r border-slate-100 dark:border-slate-800/60 text-xs ${getCapacityColor(
                            d.task_count
                          )}`}
                          title={`${uName}: ${d.task_count} task(s) on ${d.date}`}
                        >
                          {d.task_count > 0 ? d.task_count : "-"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
