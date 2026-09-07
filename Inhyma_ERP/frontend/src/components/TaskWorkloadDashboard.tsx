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

  return (
    <div className="space-y-6">
      {/* Top Stat Cards */}
      {workloadData && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
            <div className="text-xs font-semibold uppercase text-slate-500 tracking-wider">Total Open Tasks</div>
            <div className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">
              {totalOpen}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
            <div className="text-xs font-semibold uppercase text-indigo-500 tracking-wider">In Progress</div>
            <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
              {totalInProgress}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
            <div className="text-xs font-semibold uppercase text-rose-500 tracking-wider">Overdue Tasks</div>
            <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">
              {totalOverdue}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
            <div className="text-xs font-semibold uppercase text-slate-500 tracking-wider">Active Team Members</div>
            <div className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">
              {workloadData.users.length}
            </div>
          </div>
        </div>
      )}

      {/* Sub-tabs: Workload Table vs Capacity Grid */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("workload")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === "workload"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            Team Workload Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("capacity")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === "capacity"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            Capacity &amp; Availability Matrix
          </button>
        </div>

        {activeTab === "capacity" && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Timeline:</span>
            {[7, 14, 30].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setCapacityDays(days)}
                className={`px-2.5 py-1 rounded text-xs font-medium border ${
                  capacityDays === days
                    ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-500 dark:text-indigo-300"
                    : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400"
                }`}
              >
                {days} Days
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-500 text-sm">Loading team data...</div>
      ) : activeTab === "workload" ? (
        /* Team Workload Table */
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/30 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Member</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4 text-center">Open Tasks</th>
                <th className="py-3 px-4 text-center">In Progress</th>
                <th className="py-3 px-4 text-center">Overdue</th>
                <th className="py-3 px-4 text-center">Completed</th>
                <th className="py-3 px-4">Load Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
              {workloadData?.users.map((u) => {
                const userName = u.user_name || u.full_name || "Team Member";
                const userEmail = u.user_email || u.email || "";
                const openCount = u.open_tasks_count ?? u.open_tasks ?? 0;
                const inProgressCount = u.in_progress_tasks_count ?? u.in_progress_tasks ?? 0;
                const overdueCount = u.overdue_tasks_count ?? u.overdue_tasks ?? 0;
                const completedCount = u.completed_tasks_count ?? u.completed_tasks_last_30d ?? 0;
                const totalActive = openCount + inProgressCount;
                const statusColor =
                  totalActive > 8
                    ? "bg-rose-500"
                    : totalActive > 4
                    ? "bg-amber-500"
                    : "bg-emerald-500";
                const statusLabel =
                  totalActive > 8 ? "Heavy" : totalActive > 4 ? "Moderate" : "Optimal";

                return (
                  <tr key={u.user_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-100">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-bold">
                          {userName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div>{userName}</div>
                          <div className="text-[11px] text-slate-400 font-normal">{userEmail}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                      {u.department_name || "General"}
                    </td>
                    <td className="py-3 px-4 text-center font-semibold text-slate-700 dark:text-slate-300">
                      {openCount}
                    </td>
                    <td className="py-3 px-4 text-center font-semibold text-indigo-600 dark:text-indigo-400">
                      {inProgressCount}
                    </td>
                    <td className="py-3 px-4 text-center font-semibold text-rose-600 dark:text-rose-400">
                      {overdueCount}
                    </td>
                    <td className="py-3 px-4 text-center font-semibold text-emerald-600 dark:text-emerald-400">
                      {completedCount}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${statusColor}`} />
                        <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                          {statusLabel} ({totalActive} tasks)
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(!workloadData?.users || workloadData.users.length === 0) && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    No active team members found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Capacity Calendar Grid */
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
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
