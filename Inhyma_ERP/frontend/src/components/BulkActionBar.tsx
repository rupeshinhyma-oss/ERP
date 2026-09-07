import React, { useState } from "react";
import type {
  AvailableUser,
  IssueType,
  TaskBulkActionRequest,
  TaskLabel,
  TaskPriority,
  TaskSprint,
  TaskStatus,
} from "@/types/tasks";

interface BulkActionBarProps {
  selectedIds?: string[];
  selectedTaskIds?: string[];
  onClearSelection: () => void;
  onExecute?: (action: TaskBulkActionRequest) => Promise<void>;
  onExecuteBulkAction?: (action: TaskBulkActionRequest) => Promise<void>;
  availableUsers: AvailableUser[];
  availableLabels: TaskLabel[];
  availableSprints: TaskSprint[];
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedIds,
  selectedTaskIds,
  onClearSelection,
  onExecute,
  onExecuteBulkAction,
  availableUsers,
  availableLabels,
  availableSprints,
}) => {
  const [loading, setLoading] = useState(false);
  const activeIds = selectedTaskIds || selectedIds || [];
  const executeFn = onExecuteBulkAction || onExecute;

  if (activeIds.length === 0) return null;

  const handleAction = async (actionName: string, value: any) => {
    if (!executeFn) return;
    try {
      setLoading(true);
      await executeFn({
        task_ids: activeIds,
        action: actionName,
        value: value,
      });
      onClearSelection();
    } catch (err) {
      console.error("Bulk action failed", err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as TaskStatus;
    if (val) handleAction("STATUS", val);
    e.target.value = "";
  };

  const handlePriorityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as TaskPriority;
    if (val) handleAction("PRIORITY", val);
    e.target.value = "";
  };

  const handleIssueTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as IssueType;
    if (val) handleAction("ISSUE_TYPE", val);
    e.target.value = "";
  };

  const handleAssigneeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val) handleAction("ASSIGN", val);
    e.target.value = "";
  };

  const handleSprintChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === "backlog") {
      handleAction("SET_SPRINT", null);
    } else if (val) {
      handleAction("SET_SPRINT", val);
    }
    e.target.value = "";
  };

  const handleLabelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val) handleAction("ADD_LABEL", val);
    e.target.value = "";
  };

  const handleDelete = () => {
    if (window.confirm(`Are you sure you want to delete ${activeIds.length} tasks?`)) {
      handleAction("DELETE", null);
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 backdrop-blur text-white px-5 py-3 rounded-2xl shadow-2xl border border-slate-700/80 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5 duration-200">
      <div className="flex items-center gap-2 pr-3 border-r border-slate-700">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold">
          {activeIds.length}
        </span>
        <span className="text-xs font-medium text-slate-300">Selected</span>
        <button
          type="button"
          onClick={onClearSelection}
          className="text-xs text-slate-400 hover:text-white underline ml-1"
        >
          Deselect
        </button>
      </div>

      {loading ? (
        <div className="text-xs text-slate-300 flex items-center gap-2">
          <span className="inline-block w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          Processing...
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {/* Status Select */}
          <select
            defaultValue=""
            onChange={handleStatusChange}
            className="bg-slate-800 text-slate-200 border border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
          >
            <option value="" disabled>
              Set Status...
            </option>
            <option value="TODO">To Do</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="IN_REVIEW">In Review</option>
            <option value="PENDING_APPROVAL">Pending Approval</option>
            <option value="COMPLETED">Completed</option>
            <option value="ON_HOLD">On Hold</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          {/* Priority Select */}
          <select
            defaultValue=""
            onChange={handlePriorityChange}
            className="bg-slate-800 text-slate-200 border border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
          >
            <option value="" disabled>
              Set Priority...
            </option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>

          {/* Issue Type Select */}
          <select
            defaultValue=""
            onChange={handleIssueTypeChange}
            className="bg-slate-800 text-slate-200 border border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
          >
            <option value="" disabled>
              Set Issue Type...
            </option>
            <option value="TASK">Task</option>
            <option value="BUG">Bug</option>
            <option value="IMPROVEMENT">Improvement</option>
            <option value="STORY">Story</option>
            <option value="EPIC">Epic</option>
            <option value="APPROVAL">Approval</option>
          </select>

          {/* Assignee Select */}
          {availableUsers.length > 0 && (
            <select
              defaultValue=""
              onChange={handleAssigneeChange}
              className="bg-slate-800 text-slate-200 border border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer max-w-[140px] truncate"
            >
              <option value="" disabled>
                Assign to...
              </option>
              {availableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
            </select>
          )}

          {/* Sprint Select */}
          <select
            defaultValue=""
            onChange={handleSprintChange}
            className="bg-slate-800 text-slate-200 border border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer max-w-[140px] truncate"
          >
            <option value="" disabled>
              Sprint / Backlog...
            </option>
            <option value="backlog">Move to Backlog</option>
            {availableSprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.status})
              </option>
            ))}
          </select>

          {/* Label Select */}
          {availableLabels.length > 0 && (
            <select
              defaultValue=""
              onChange={handleLabelChange}
              className="bg-slate-800 text-slate-200 border border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer max-w-[130px] truncate"
            >
              <option value="" disabled>
                Add Label...
              </option>
              {availableLabels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}

          {/* Delete Button */}
          <button
            type="button"
            onClick={handleDelete}
            className="bg-rose-600/90 hover:bg-rose-600 text-white font-medium rounded-lg px-2.5 py-1.5 transition-colors"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};
