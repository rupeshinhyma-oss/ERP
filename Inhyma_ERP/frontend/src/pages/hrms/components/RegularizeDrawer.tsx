/**
 * RegularizeDrawer Component
 *
 * Sliding right-side drawer (1/3 screen desktop, full mobile)
 * Supporting:
 * - Employee role: Can only submit request via "Submit Request"
 * - Admin/HR role: Can submit request via "Send Request" OR click "Regularize Directly" to update attendance
 *   immediately without approval queue, creating an audit log.
 * - Reasons include: "Work From Home", "Missing Punch", "Late Punch", "Early Exit", "Other"
 * - Dynamic hours calculation
 */

import { useMemo, useState, useEffect } from "react";
import { Modal } from "@/components/ui";

export interface AttendanceRecordForRegularize {
  date: string;
  dayNumber: number;
  status: string;
  punch_in?: string | null;
  punch_out?: string | null;
  total_hours?: string | null;
}

export interface AuditLogEntry {
  id: string;
  admin_name: string;
  date: string;
  old_values: { check_in: string; check_out: string; status: string };
  new_values: { check_in: string; check_out: string; status: string };
  reason: string;
  timestamp: string;
}

interface RegularizeDrawerProps {
  open: boolean;
  onClose: () => void;
  day: AttendanceRecordForRegularize | null;
  isAdmin: boolean;
  adminName?: string;
  employeeName?: string;
  employeeCode?: string;
  onSubmitRequest: (payload: {
    date: string;
    checkIn: string;
    checkOut: string;
    totalHours: string;
    reason: string;
    remarks: string;
  }) => void;
  onDirectRegularize?: (payload: {
    date: string;
    checkIn: string;
    checkOut: string;
    totalHours: string;
    reason: string;
    remarks: string;
    auditLog: AuditLogEntry;
  }) => void;
}

function to24HourTime(str?: string | null, defaultTime = "10:30"): string {
  if (!str) return defaultTime;
  const trimmed = str.trim();
  const isPM = /pm/i.test(trimmed);
  const isAM = /am/i.test(trimmed);
  const match = trimmed.match(/(\d{1,2}):(\d{2})/);
  if (match) {
    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (isPM && h < 12) h += 12;
    if (isAM && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return defaultTime;
}

export function RegularizeDrawer({
  open,
  onClose,
  day,
  isAdmin,
  adminName = "Admin",
  employeeName,
  employeeCode,
  onSubmitRequest,
  onDirectRegularize,
}: RegularizeDrawerProps) {
  const [checkIn, setCheckIn] = useState("10:30");
  const [checkOut, setCheckOut] = useState("19:00");
  const [reason, setReason] = useState<
    "Work From Home" | "Missing Punch" | "Late Punch" | "Early Exit" | "Other"
  >("Work From Home");
  const [remarks, setRemarks] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!day) return;
    setCheckIn(to24HourTime(day.punch_in, "10:30"));
    setCheckOut(to24HourTime(day.punch_out, "19:00"));
    if (day.status === "Late Punch") setReason("Late Punch");
    else if (day.status === "Missing Punch") setReason("Missing Punch");
    else if (day.status === "Early Exit") setReason("Early Exit");
    else setReason("Work From Home");
    setRemarks("");
  }, [day]);

  // Dynamic hours calculation
  const autoTotalHours = useMemo(() => {
    try {
      const [inH, inM] = checkIn.split(":").map(Number);
      const [outH, outM] = checkOut.split(":").map(Number);
      const totalMinutes = outH * 60 + outM - (inH * 60 + inM);
      if (totalMinutes <= 0 || isNaN(totalMinutes)) return "0h 00m (Invalid)";
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      return `${h}h ${String(m).padStart(2, "0")}m`;
    } catch {
      return "0h 00m";
    }
  }, [checkIn, checkOut]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!day) return;
    if (autoTotalHours.includes("Invalid")) {
      alert("Invalid punch timings: Check-out must be after check-in.");
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmitRequest({
        date: day.date,
        checkIn,
        checkOut,
        totalHours: autoTotalHours,
        reason,
        remarks,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDirectRegularize = async () => {
    if (!day || !onDirectRegularize) return;
    if (autoTotalHours.includes("Invalid")) {
      alert("Invalid punch timings: Check-out must be after check-in.");
      return;
    }
    setIsSubmitting(true);
    try {
      const auditLog: AuditLogEntry = {
        id: `audit-${Date.now()}`,
        admin_name: adminName,
        date: day.date,
        old_values: {
          check_in: day.punch_in || "None",
          check_out: day.punch_out || "None",
          status: day.status || "Irregular",
        },
        new_values: {
          check_in: checkIn,
          check_out: checkOut,
          status: "Present",
        },
        reason: `${reason}${remarks ? ` — ${remarks}` : ""}`,
        timestamp: new Date().toISOString(),
      };

      await onDirectRegularize({
        date: day.date,
        checkIn,
        checkOut,
        totalHours: autoTotalHours,
        reason,
        remarks,
        auditLog,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Regularize Request"
      variant="drawer"
    >
      <div data-testid="regularize-drawer" style={{ padding: "8px 0" }}>
        {/* Header employee info */}
        <div
          style={{
            background: "var(--color-bg)",
            padding: "12px 16px",
            borderRadius: "var(--radius-sm)",
            marginBottom: "16px",
            fontSize: "13px",
            lineHeight: 1.5,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
            <div>
              <span style={{ color: "var(--color-muted)" }}>Employee: </span>
              <strong>{employeeName || "Employee"}</strong>
              {employeeCode && (
                <span style={{ color: "var(--color-muted)", marginLeft: "6px" }}>({employeeCode})</span>
              )}
            </div>
            <div>
              <span style={{ color: "var(--color-muted)" }}>Date: </span>
              <strong data-testid="reg-drawer-date-display">{day?.date || ""}</strong>
            </div>
            <div>
              <span style={{ color: "var(--color-muted)" }}>Original Status: </span>
              <strong style={{ color: "#dc2626" }}>{day?.status || "Irregular"}</strong>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: "14px" }}>
            <label className="form-label">Attendance Date</label>
            <input
              type="text"
              className="form-control"
              data-testid="reg-attendance-date"
              value={day?.date || ""}
              readOnly
              style={{ background: "var(--color-bg)", cursor: "not-allowed" }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
            <div className="form-group">
              <label className="form-label">Check-In</label>
              <input
                type="time"
                className="form-control"
                data-testid="reg-check-in"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Check-Out</label>
              <input
                type="time"
                className="form-control"
                data-testid="reg-check-out"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                required
              />
            </div>
          </div>

          <div
            style={{
              background: "var(--color-bg)",
              padding: "10px 14px",
              borderRadius: "var(--radius-sm)",
              marginBottom: "14px",
              fontSize: "13px",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span style={{ color: "var(--color-muted)" }}>Total Calculated Hours:</span>
            <strong data-testid="reg-total-hours" style={{ color: "#2563eb" }}>
              {autoTotalHours}
            </strong>
          </div>

          <div className="form-group" style={{ marginBottom: "14px" }}>
            <label className="form-label">Reason</label>
            <select
              className="form-control"
              data-testid="reg-reason-select"
              value={reason}
              onChange={(e) => setReason(e.target.value as any)}
            >
              <option value="Work From Home">Work From Home</option>
              <option value="Missing Punch">Missing Punch</option>
              <option value="Late Punch">Late Punch</option>
              <option value="Early Exit">Early Exit</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: "20px" }}>
            <label className="form-label">
              Remarks / Explanation <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <textarea
              className="form-control"
              rows={3}
              data-testid="reg-remarks"
              placeholder="Explain the reason for regularization (required)..."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap" }}>
            <button
              type="button"
              data-testid="reg-cancel-btn"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>

            {/* Employee sees "Submit Request", Admin sees "Send Request" */}
            <button
              type="submit"
              data-testid="reg-send-btn"
              className="btn btn-primary"
              disabled={isSubmitting || autoTotalHours.includes("Invalid")}
            >
              {isSubmitting ? "Submitting..." : isAdmin ? "Send Request" : "Submit Request"}
            </button>

            {/* Admin only: Regularize Directly without approval queue */}
            {isAdmin && (
              <button
                type="button"
                data-testid="reg-direct-btn"
                className="btn btn-secondary"
                style={{ background: "#dcfce7", color: "#15803d", borderColor: "#86efac", fontWeight: 600 }}
                onClick={handleDirectRegularize}
                disabled={isSubmitting || autoTotalHours.includes("Invalid")}
                title="Immediately updates attendance and logs admin audit entry"
              >
                Regularize Directly
              </button>
            )}
          </div>
        </form>
      </div>
    </Modal>
  );
}
