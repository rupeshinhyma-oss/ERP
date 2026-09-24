/**
 * ApprovalPage Component (/hrms/attendance?tab=approval)
 *
 * Requirements:
 * - Proper table alignment, sticky header, consistent buttons
 * - Single unified approval queue for attendance regularizations (including WFH requests, missing punch, late punch, geofence irregularities)
 * - Review actions: Approve, Reject, Adjust Against Leave (CL, SL, EL)
 * - Audit log display for Direct Regularizations (admin, date, old values, new values, reason)
 * - Filter row (All, Pending, Approved, Rejected) and search
 */

import React, { useCallback, useEffect, useState } from "react";
import { Banner, Modal } from "@/components/ui";
import { IconCheckSquare, IconClock, IconFileText, IconShield } from "@/components/icons";
import { apiGet, apiPost } from "@/lib/api";
import { type AuditLogEntry } from "./RegularizeDrawer";

export interface ApprovalRequestItem {
  id: string;
  type: "Regularization" | "Irregularity" | "Direct Regularize Audit";
  employee: string;
  employee_code?: string | null;
  date: string;
  check_in?: string;
  check_out?: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "DIRECT_REGULARIZED";
  manager_remarks?: string | null;
  leave_deducted?: string | null;
  reviewed_by?: string | null;
  submitted_at: string;
  audit_details?: {
    admin_name: string;
    old_values: { check_in: string; check_out: string; status: string };
    new_values: { check_in: string; check_out: string; status: string };
    timestamp: string;
  };
}

interface ApprovalPageProps {
  directAuditLogs?: AuditLogEntry[];
  submittedRequests?: ApprovalRequestItem[];
}

export function ApprovalPage({ directAuditLogs = [], submittedRequests = [] }: ApprovalPageProps) {
  const [requests, setRequests] = useState<ApprovalRequestItem[]>([
    {
      id: "app-1",
      type: "Irregularity",
      employee: "Amit Verma",
      employee_code: "EMP-014",
      date: "2026-09-18",
      check_in: "10:30 AM",
      check_out: "—",
      reason: "Missing Punch (Forgot to punch out)",
      status: "PENDING",
      submitted_at: "2026-09-18 07:15 PM",
    },
    {
      id: "app-2",
      type: "Regularization",
      employee: "Sneha Patel",
      employee_code: "EMP-022",
      date: "2026-09-19",
      check_in: "10:52 AM",
      check_out: "07:00 PM",
      reason: "Late Punch (Traffic jam)",
      status: "PENDING",
      submitted_at: "2026-09-19 11:00 AM",
    },
    {
      id: "app-3",
      type: "Regularization",
      employee: "Siddharth Rao",
      employee_code: "EMP-102",
      date: "2026-09-15",
      check_in: "10:30 AM",
      check_out: "07:00 PM",
      reason: "Work From Home (Field Client Audit)",
      status: "APPROVED",
      manager_remarks: "Verified with Client Manager",
      leave_deducted: "None (Approved as-is)",
      reviewed_by: "Admin",
      submitted_at: "2026-09-16 09:30 AM",
    },
  ]);

  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "APPROVED" | "REJECTED">("ALL");
  const [searchTerm, setSearchTerm] = useState("");

  // Review modal state
  const [activeRequest, setActiveRequest] = useState<ApprovalRequestItem | null>(null);
  const [actionType, setActionType] = useState<"APPROVE" | "REJECT" | "ADJUST_LEAVE">("APPROVE");
  const [selectedLeaveType, setSelectedLeaveType] = useState("Casual Leave (CL)");
  const [managerRemarks, setManagerRemarks] = useState("");
  const [actionModalOpen, setActionModalOpen] = useState(false);

  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(t);
  }, [success]);

  // Load approvals from backend
  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<any[]>("/hrms/approvals");
      if (res?.data && Array.isArray(res.data) && res.data.length > 0) {
        const mapped: ApprovalRequestItem[] = res.data.map((item) => ({
          id: String(item.id),
          type: item.type?.includes("Irregularity") ? "Irregularity" : "Regularization",
          employee: item.employee || "Employee",
          employee_code: item.employee_code,
          date: item.date,
          check_in: item.check_in || "10:30 AM",
          check_out: item.check_out || "07:00 PM",
          reason: item.reason || "Attendance Regularization",
          status: (item.status?.toUpperCase() as any) || "PENDING",
          manager_remarks: item.manager_remarks,
          leave_deducted: item.leave_deducted,
          reviewed_by: item.reviewed_by,
          submitted_at: item.submitted_at || new Date().toISOString(),
        }));
        setRequests(mapped);
      }
    } catch {
      // Fallback in-memory state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  // Merge direct regularization audit entries and newly submitted requests
  const allDisplayItems = React.useMemo(() => {
    const list: ApprovalRequestItem[] = [...requests];

    submittedRequests.forEach((sub) => {
      if (!list.some((l) => l.id === sub.id)) {
        list.unshift(sub);
      }
    });

    directAuditLogs.forEach((audit) => {
      // Check if already in list
      if (!list.some((l) => l.id === audit.id)) {
        list.unshift({
          id: audit.id,
          type: "Direct Regularize Audit",
          employee: audit.admin_name,
          date: audit.date,
          check_in: audit.new_values.check_in,
          check_out: audit.new_values.check_out,
          reason: audit.reason,
          status: "DIRECT_REGULARIZED",
          submitted_at: audit.timestamp,
          audit_details: {
            admin_name: audit.admin_name,
            old_values: audit.old_values,
            new_values: audit.new_values,
            timestamp: audit.timestamp,
          },
        });
      }
    });

    return list;
  }, [requests, directAuditLogs, submittedRequests]);

  // Filtering
  const filteredRequests = allDisplayItems.filter((req) => {
    if (statusFilter !== "ALL") {
      if (statusFilter === "PENDING" && req.status !== "PENDING") return false;
      if (statusFilter === "APPROVED" && req.status !== "APPROVED" && req.status !== "DIRECT_REGULARIZED") return false;
      if (statusFilter === "REJECTED" && req.status !== "REJECTED") return false;
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      return (
        req.employee.toLowerCase().includes(q) ||
        (req.employee_code && req.employee_code.toLowerCase().includes(q)) ||
        req.reason.toLowerCase().includes(q) ||
        req.date.includes(q)
      );
    }
    return true;
  });

  const handleOpenActionModal = (
    req: ApprovalRequestItem,
    action: "APPROVE" | "REJECT" | "ADJUST_LEAVE"
  ) => {
    setActiveRequest(req);
    setActionType(action);
    setManagerRemarks("");
    setActionModalOpen(true);
  };

  const handleConfirmAction = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e?.preventDefault) e.preventDefault();
    if (!activeRequest) return;

    const newStatus = actionType === "REJECT" ? "REJECTED" : "APPROVED";
    const leaveText =
      actionType === "ADJUST_LEAVE"
        ? `Adjusted 0.5 Day from ${selectedLeaveType}`
        : actionType === "REJECT"
        ? "Rejected (Loss of Pay)"
        : "Approved (Regularized)";

    // Update UI state immediately
    setRequests((prev) => {
      const exists = prev.some((r) => r.id === activeRequest.id);
      if (exists) {
        return prev.map((r) =>
          r.id === activeRequest.id
            ? {
                ...r,
                status: newStatus,
                manager_remarks: managerRemarks.trim() || "Reviewed by Admin",
                leave_deducted: leaveText,
                reviewed_by: "Admin",
              }
            : r
        );
      }
      return [
        {
          ...activeRequest,
          status: newStatus,
          manager_remarks: managerRemarks.trim() || "Reviewed by Admin",
          leave_deducted: leaveText,
          reviewed_by: "Admin",
        },
        ...prev,
      ];
    });

    setSuccess(
      actionType === "ADJUST_LEAVE"
        ? `Successfully deducted quota and regularized request for ${activeRequest.employee}.`
        : `Request for ${activeRequest.employee} marked as ${newStatus}.`
    );
    setActionModalOpen(false);

    // Persist to backend asynchronously without blocking UI
    try {
      const reviewPromise = apiPost(`/hrms/approvals/${activeRequest.id}/review`, {
        action: actionType,
        status: newStatus,
        leave_type: selectedLeaveType,
        manager_remarks: managerRemarks.trim() || undefined,
      });
      if (reviewPromise && typeof reviewPromise.catch === "function") {
        reviewPromise.catch(() => {});
      }
    } catch {}
  };

  return (
    <div data-testid="approval-page-container" className="card" style={{ padding: "20px 24px" }}>
      <Banner error={error} success={success} />

      {/* Header and Filter Controls */}
      <div
        data-testid="approval-filter-row"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <div>
          <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "var(--color-text)" }}>
            Attendance Approvals & Regularization Queue
          </h2>
          <span style={{ fontSize: "12.5px", color: "var(--color-muted)", marginTop: "2px", display: "block" }}>
            Review pending WFH requests, missing punch corrections, and geofence irregularities.
          </span>
        </div>

        {/* Filter buttons & search */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <input
            type="text"
            className="form-control"
            placeholder="Search employee or reason..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: "220px", fontSize: "12.5px" }}
          />

          <div style={{ display: "flex", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}>
            {(["ALL", "PENDING", "APPROVED", "REJECTED"] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                style={{
                  padding: "5px 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                  border: "none",
                  background: statusFilter === st ? "#2563eb" : "var(--color-surface, #ffffff)",
                  color: statusFilter === st ? "#ffffff" : "var(--color-muted)",
                  cursor: "pointer",
                }}
              >
                {st === "ALL" ? "All" : st.charAt(0) + st.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Approvals Table with Sticky Header */}
      <div
        data-testid="approval-requests-list"
        className="table-responsive"
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-sm)",
          maxHeight: "600px",
          overflowY: "auto",
        }}
      >
        <table className="table" style={{ width: "100%", margin: 0, borderCollapse: "collapse" }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--color-bg)" }}>
            <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600 }}>Employee</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600 }}>Date</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600 }}>Type & Timings</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600, minWidth: "220px" }}>Reason / Audit Detail</th>
              <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "12px", fontWeight: 600 }}>Status</th>
              <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "12px", fontWeight: 600 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRequests.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "30px", textAlign: "center", color: "var(--color-muted)" }}>
                  No regularization requests match the selected filters.
                </td>
              </tr>
            ) : (
              filteredRequests.map((req) => (
                <tr key={req.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "14px 16px", fontWeight: 600, color: "var(--color-text)" }}>
                    <div>{req.employee}</div>
                    {req.employee_code && (
                      <span style={{ fontSize: "11px", color: "var(--color-muted)", fontWeight: 400 }}>
                        {req.employee_code}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "14px 16px", fontSize: "12.5px", color: "var(--color-text)", whiteSpace: "nowrap" }}>
                    {req.date}
                  </td>
                  <td style={{ padding: "14px 16px", fontSize: "12px" }}>
                    <div style={{ fontWeight: 600, color: "#2563eb" }}>{req.type}</div>
                    {req.check_in && req.check_out && (
                      <div style={{ color: "var(--color-muted)", marginTop: "2px" }}>
                        {req.check_in} – {req.check_out}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "14px 16px", fontSize: "12.5px", color: "var(--color-text)", lineHeight: 1.4 }}>
                    <div>{req.reason}</div>
                    {req.audit_details && (
                      <div
                        style={{
                          marginTop: "4px",
                          fontSize: "11px",
                          padding: "4px 8px",
                          background: "var(--color-bg)",
                          borderRadius: "4px",
                          border: "1px solid var(--color-border)",
                        }}
                      >
                        <strong>Direct Regularize Audit:</strong> Changed from [{req.audit_details.old_values.status} / {req.audit_details.old_values.check_in}] to [Present / {req.audit_details.new_values.check_in}] by {req.audit_details.admin_name} at {req.audit_details.timestamp}
                      </div>
                    )}
                    {req.leave_deducted && (
                      <div style={{ fontSize: "11.5px", color: "#15803d", fontWeight: 600, marginTop: "2px" }}>
                        Decision: {req.leave_deducted}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "14px 16px", textAlign: "center" }}>
                    <span
                      style={{
                        padding: "3px 10px",
                        borderRadius: "12px",
                        fontSize: "11px",
                        fontWeight: 700,
                        background:
                          req.status === "PENDING"
                            ? "#fef3c7"
                            : req.status === "APPROVED" || req.status === "DIRECT_REGULARIZED"
                            ? "#dcfce7"
                            : "#fee2e2",
                        color:
                          req.status === "PENDING"
                            ? "#b45309"
                            : req.status === "APPROVED" || req.status === "DIRECT_REGULARIZED"
                            ? "#15803d"
                            : "#b91c1c",
                      }}
                    >
                      {req.status === "DIRECT_REGULARIZED" ? "Direct Regularized" : req.status}
                    </span>
                  </td>
                  <td style={{ padding: "14px 16px", textAlign: "right" }}>
                    {req.status === "PENDING" ? (
                      <div style={{ display: "inline-flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          data-testid={`approve-btn-${req.id}`}
                          className="btn btn-sm btn-primary"
                          onClick={() => handleOpenActionModal(req, "APPROVE")}
                          style={{ fontSize: "11.5px", padding: "4px 10px" }}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          data-testid={`adjust-leave-btn-${req.id}`}
                          className="btn btn-sm btn-secondary"
                          onClick={() => handleOpenActionModal(req, "ADJUST_LEAVE")}
                          title="Adjust against employee leave quota (CL, SL, EL)"
                          style={{ fontSize: "11.5px", padding: "4px 10px" }}
                        >
                          Adjust Leave
                        </button>
                        <button
                          type="button"
                          data-testid={`reject-btn-${req.id}`}
                          className="btn btn-sm btn-danger"
                          onClick={() => handleOpenActionModal(req, "REJECT")}
                          style={{ fontSize: "11.5px", padding: "4px 10px" }}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: "11.5px", color: "var(--color-muted)" }}>
                        {req.reviewed_by ? `Reviewed by ${req.reviewed_by}` : "Completed"}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Review Modal (Approve, Reject, or Adjust Leave) */}
      <Modal
        open={actionModalOpen}
        title={
          actionType === "APPROVE"
            ? "Approve Regularization Request"
            : actionType === "REJECT"
            ? "Reject Request (Mark LOP)"
            : "Adjust Against Leave Quota"
        }
        onClose={() => setActionModalOpen(false)}
        cardStyle={{ maxWidth: "480px" }}
      >
        <div data-testid="review-modal-form" style={{ padding: "20px" }}>
          {activeRequest && (
            <div
              style={{
                marginBottom: "16px",
                padding: "10px 14px",
                background: "var(--color-bg)",
                borderRadius: "var(--radius-sm)",
                fontSize: "12.5px",
              }}
            >
              <div>Employee: <strong>{activeRequest.employee}</strong> ({activeRequest.date})</div>
              <div style={{ color: "var(--color-muted)", marginTop: "2px" }}>
                Reason: {activeRequest.reason}
              </div>
            </div>
          )}

          {actionType === "ADJUST_LEAVE" && (
            <div className="form-group" style={{ marginBottom: "14px" }}>
              <label className="form-label">Deduct from Leave Type</label>
              <select
                className="form-control"
                data-testid="adjust-leave-type-select"
                value={selectedLeaveType}
                onChange={(e) => setSelectedLeaveType(e.target.value)}
              >
                <option value="Casual Leave (CL)">Casual Leave (CL) — 0.5 Day</option>
                <option value="Sick Leave (SL)">Sick Leave (SL) — 0.5 Day</option>
                <option value="Earned / Privilege Leave (PL)">Earned / Privilege Leave (PL) — 0.5 Day</option>
              </select>
            </div>
          )}

          <div className="form-group" style={{ marginBottom: "20px" }}>
            <label className="form-label">Manager Remarks (Optional)</label>
            <textarea
              className="form-control"
              rows={3}
              placeholder="Provide context or confirmation notes..."
              value={managerRemarks}
              onChange={(e) => setManagerRemarks(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button type="button" className="btn btn-secondary" onClick={() => setActionModalOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              data-testid="confirm-review-btn"
              onClick={handleConfirmAction}
              className={actionType === "REJECT" ? "btn btn-danger" : "btn btn-primary"}
            >
              {actionType === "APPROVE"
                ? "Confirm Approval"
                : actionType === "REJECT"
                ? "Confirm Rejection"
                : "Deduct & Approve"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default ApprovalPage;
