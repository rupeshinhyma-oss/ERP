import React, { useEffect, useState } from "react";
import { escalateTask, fetchEscalateOptions, getAvailableAssignees } from "@/lib/tasksApi";
import { SearchableUserSelect } from "@/components/SearchableUserSelect";
import type { AvailableUser, TaskEscalateCandidate, TaskEscalateOptionsResponse } from "@/types/tasks";

interface EscalateTaskModalProps {
  taskId: string;
  taskTitle: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const EscalateTaskModal: React.FC<EscalateTaskModalProps> = ({
  taskId,
  taskTitle,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [options, setOptions] = useState<TaskEscalateOptionsResponse>({
    reporting_managers: [],
    department_managers: [],
    organization_users: [],
  });
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);

  const [targetType, setTargetType] = useState<"REPORTING_MANAGER" | "DEPARTMENT_MANAGER" | "ORGANIZATION_USER">("REPORTING_MANAGER");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [dueDate, setDueDate] = useState("");

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setReason("");
    setDueDate("");
    setSelectedUserId("");

    Promise.all([
      fetchEscalateOptions(),
      getAvailableAssignees(),
    ])
      .then(([data, users]) => {
        setOptions(data);
        setAvailableUsers(users);
        if (data.reporting_managers.length > 0) {
          setTargetType("REPORTING_MANAGER");
          setSelectedUserId(data.reporting_managers[0].user_id);
        } else if (data.department_managers.length > 0) {
          setTargetType("DEPARTMENT_MANAGER");
          setSelectedUserId(data.department_managers[0].user_id);
        } else if (data.organization_users.length > 0) {
          setTargetType("ORGANIZATION_USER");
          setSelectedUserId(data.organization_users[0].user_id);
        }
      })
      .catch(() => {
        setError("Failed to load escalation candidate users.");
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  // ESC key listener & body scroll lock
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const getCandidateList = (): TaskEscalateCandidate[] => {
    switch (targetType) {
      case "REPORTING_MANAGER":
        return options.reporting_managers;
      case "DEPARTMENT_MANAGER":
        return options.department_managers;
      case "ORGANIZATION_USER":
        return options.organization_users;
      default:
        return [];
    }
  };

  const currentCandidates = getCandidateList();


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) {
      setError("Please select a manager or user to escalate this task to.");
      return;
    }
    if (!reason.trim()) {
      setError("Please enter a clear reason for this escalation.");
      return;
    }
    if (!dueDate) {
      setError("Target SLA resolution due date is required for escalation.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await escalateTask(taskId, selectedUserId, reason.trim(), targetType, dueDate);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to escalate task.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(15, 23, 42, 0.55)",
        backdropFilter: "blur(4px)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: "14px",
          width: "560px",
          maxWidth: "100%",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 40px rgba(0,0,0,0.22)",
          overflow: "hidden",
          border: "1px solid #e2e8f0",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid #fecaca",
            background: "#fef2f2",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "20px" }}>⚡</span>
            <div>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#991b1b" }}>
                Escalate Task
              </h3>
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#b91c1c", fontWeight: 500 }}>
                {taskTitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              fontSize: "20px",
              cursor: "pointer",
              color: "#64748b",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
          <div style={{ padding: "18px 20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "14px" }}>
            {error && (
              <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "6px", padding: "8px 12px", color: "#991b1b", fontSize: "12.5px" }}>
                {error}
              </div>
            )}

            {/* Target Options Tabs */}
            <div>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                Escalation Target Type
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.2fr", gap: "6px" }}>
                <button
                  type="button"
                  onClick={() => {
                    setTargetType("REPORTING_MANAGER");
                    if (options.reporting_managers.length > 0) {
                      setSelectedUserId(options.reporting_managers[0].user_id);
                    }
                  }}
                  style={{
                    padding: "7px 8px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    border: targetType === "REPORTING_MANAGER" ? "2px solid #ef4444" : "1px solid #cbd5e1",
                    background: targetType === "REPORTING_MANAGER" ? "#fef2f2" : "#ffffff",
                    color: targetType === "REPORTING_MANAGER" ? "#991b1b" : "#475569",
                  }}
                >
                  👔 Reporting Manager ({options.reporting_managers.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTargetType("DEPARTMENT_MANAGER");
                    if (options.department_managers.length > 0) {
                      setSelectedUserId(options.department_managers[0].user_id);
                    }
                  }}
                  style={{
                    padding: "7px 8px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    border: targetType === "DEPARTMENT_MANAGER" ? "2px solid #ef4444" : "1px solid #cbd5e1",
                    background: targetType === "DEPARTMENT_MANAGER" ? "#fef2f2" : "#ffffff",
                    color: targetType === "DEPARTMENT_MANAGER" ? "#991b1b" : "#475569",
                  }}
                >
                  🏛️ Dept Manager ({options.department_managers.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTargetType("ORGANIZATION_USER");
                    if (options.organization_users.length > 0 && !selectedUserId) {
                      setSelectedUserId(options.organization_users[0].user_id);
                    }
                  }}
                  style={{
                    padding: "7px 8px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    border: targetType === "ORGANIZATION_USER" ? "2px solid #ef4444" : "1px solid #cbd5e1",
                    background: targetType === "ORGANIZATION_USER" ? "#fef2f2" : "#ffffff",
                    color: targetType === "ORGANIZATION_USER" ? "#991b1b" : "#475569",
                  }}
                >
                  🏢 Organization User
                </button>
              </div>
            </div>

            {/* Target User Picker */}
            <div>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                Select Recipient <span style={{ color: "#ef4444" }}>*</span>
              </label>

              {loading ? (
                <div style={{ padding: "12px", color: "#64748b", fontSize: "13px" }}>Loading candidate users...</div>
              ) : targetType === "ORGANIZATION_USER" ? (
                <SearchableUserSelect
                  users={availableUsers}
                  selectedUserIds={selectedUserId ? [selectedUserId] : []}
                  onChange={(ids) => setSelectedUserId(ids[0] || "")}
                  multiple={false}
                  placeholder="Search team member by name, department, or role..."
                />
              ) : currentCandidates.length === 0 ? (
                <div style={{ padding: "12px", color: "#64748b", fontSize: "12.5px", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                  No candidate found in this category. You can switch to "Organization User" to choose any team member.
                </div>
              ) : (
                <div style={{ maxHeight: "160px", overflowY: "auto", border: "1px solid #cbd5e1", borderRadius: "6px" }}>
                  {currentCandidates.map((c) => {
                    const isSelected = selectedUserId === c.user_id;
                    return (
                      <div
                        key={c.user_id}
                        onClick={() => setSelectedUserId(c.user_id)}
                        style={{
                          padding: "8px 12px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          cursor: "pointer",
                          background: isSelected ? "#fee2e2" : "#ffffff",
                          borderBottom: "1px solid #f1f5f9",
                        }}
                      >
                        <div>
                          <span style={{ fontWeight: 600, color: isSelected ? "#991b1b" : "#1e293b", fontSize: "13px" }}>
                            {c.name}
                          </span>
                          {c.detail && (
                            <span style={{ marginLeft: "6px", fontSize: "11px", color: "#64748b", background: "#f1f5f9", padding: "1px 5px", borderRadius: "4px" }}>
                              {c.detail}
                            </span>
                          )}
                          {c.email && (
                            <div style={{ fontSize: "11.5px", color: "#64748b" }}>{c.email}</div>
                          )}
                        </div>
                        <input
                          type="radio"
                          name="escalation_user"
                          checked={isSelected}
                          onChange={() => setSelectedUserId(c.user_id)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>


            {/* Escalation Reason */}
            <div>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                Reason for Escalation <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <textarea
                placeholder="Explain the blocker, urgency, decisions required, or business risk..."
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Mandatory Due Date */}
            <div>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "var(--text-primary, #334155)", marginBottom: "6px" }}>
                Target SLA Resolution Due Date <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  border: "1px solid var(--border-color, #cbd5e1)",
                  borderRadius: "6px",
                  fontSize: "13px",
                  boxSizing: "border-box",
                  background: "var(--bg-surface, #ffffff)",
                  color: "var(--text-primary, #1e293b)",
                }}
              />
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "12px 20px",
              borderTop: "1px solid var(--border-color, #e2e8f0)",
              background: "var(--bg-muted, #f8fafc)",
              display: "flex",
              justifyContent: "flex-end",
              gap: "10px",
            }}
          >
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ background: "#dc2626", borderColor: "#b91c1c" }}
              disabled={submitting || !selectedUserId || !reason.trim()}
            >
              {submitting ? "Escalating..." : "Submit Escalation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
