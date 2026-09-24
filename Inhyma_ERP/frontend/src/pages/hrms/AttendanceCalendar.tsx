/**
 * AttendanceCalendar Component.
 *
 * Full month 7-column calendar grid (Sunday to Saturday) driven entirely
 * by real database records.
 *
 * Requirements:
 * 1. Bug 1: Evaluate shouldShowRegularizeIcon() on every day cell.
 *    If true, renders small pencil (✏️) icon fixed at top-right to open RegularizeDrawer.
 *    Never renders icon for: Present, Leave, Holiday, Weekend, Future dates, In Progress.
 * 2. Bug 3 & 4: Only show status if a record actually exists.
 *    Future dates remain completely EMPTY (no "Present" status).
 *    Every cell displays real In, Out, Hours, and Status.
 */

import React, { useMemo } from "react";
import { AttendanceDay, shouldShowRegularizeIcon } from "./attendance";

export interface AttendanceCalendarProps {
  selectedMonth: string; // YYYY-MM
  onMonthChange: (month: string) => void;
  calendarDays: AttendanceDay[];
  serverDate?: string | null;
  onOpenRegularize: (day: AttendanceDay) => void;
}

export function AttendanceCalendar({
  selectedMonth,
  onMonthChange,
  calendarDays,
  serverDate,
  onOpenRegularize,
}: AttendanceCalendarProps) {
  const formattedMonthTitle = useMemo(() => {
    const [yr, mo] = selectedMonth.split("-").map(Number);
    const d = new Date(yr, mo - 1, 1);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [selectedMonth]);

  const monthStartOffset = useMemo(() => {
    const [yr, mo] = selectedMonth.split("-").map(Number);
    return new Date(yr, mo - 1, 1).getDay();
  }, [selectedMonth]);

  const handleNavigateMonth = (delta: number) => {
    const [yr, mo] = selectedMonth.split("-").map(Number);
    const d = new Date(yr, mo - 1 + delta, 1);
    const nextYr = d.getFullYear();
    const nextMo = String(d.getMonth() + 1).padStart(2, "0");
    onMonthChange(`${nextYr}-${nextMo}`);
  };

  const handleSetCurrentMonth = () => {
    const d = new Date();
    const curMonthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    onMonthChange(curMonthStr);
  };

  const todayIso = serverDate || new Date().toISOString().slice(0, 10);

  return (
    <div className="card" style={{ padding: "20px 24px" }}>
      {/* Calendar Header with Month Navigation */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "14px",
          marginBottom: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <h2 style={{ fontSize: "17px", fontWeight: 700, margin: 0, color: "var(--color-text)" }}>
            {formattedMonthTitle}
          </h2>
          <span
            style={{
              fontSize: "12px",
              color: "var(--color-muted)",
              background: "var(--color-bg)",
              padding: "2px 8px",
              borderRadius: "12px",
              border: "1px solid var(--color-border)",
            }}
          >
            Live Database Sync
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleNavigateMonth(-1)}
            style={{ padding: "6px 12px", fontSize: "12.5px" }}
          >
            ‹ Previous
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleSetCurrentMonth}
            style={{ padding: "6px 12px", fontSize: "12.5px" }}
          >
            Today
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleNavigateMonth(1)}
            style={{ padding: "6px 12px", fontSize: "12.5px" }}
          >
            Next ›
          </button>
        </div>
      </div>

      {/* 7-Column Sunday - Saturday Layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: "8px",
        }}
      >
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName) => (
          <div
            key={dayName}
            style={{
              padding: "8px 4px",
              textAlign: "center",
              fontSize: "12px",
              fontWeight: 700,
              color: dayName === "Sun" || dayName === "Sat" ? "#ef4444" : "var(--color-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            {dayName}
          </div>
        ))}

        {/* Start day offset blanks */}
        {Array.from({ length: monthStartOffset }).map((_, idx) => (
          <div key={`offset-${idx}`} style={{ minHeight: "100px" }} />
        ))}

        {/* Day Cells */}
        {calendarDays.map((d) => {
          const isToday = d.date === todayIso;
          const isFuture = d.date > todayIso;

          // In Progress only for active uncompleted today
          const displayStatus =
            isToday && d.punch_in && !d.punch_out
              ? "In Progress"
              : d.status;

          // Evaluate shouldShowRegularizeIcon() on every day cell
          const isActionRequired = shouldShowRegularizeIcon(d, displayStatus);

          return (
            <div
              key={d.date}
              data-testid={`cal-day-${d.dayNumber}`}
              style={{
                minHeight: "100px",
                padding: "8px 10px",
                border: isToday
                  ? "2px solid #2563eb"
                  : isActionRequired
                  ? "1.5px solid #f59e0b"
                  : "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm, 6px)",
                background: isToday
                  ? "rgba(37, 99, 235, 0.04)"
                  : displayStatus === "Present" && !isActionRequired
                  ? "var(--color-surface, #ffffff)"
                  : displayStatus === "Holiday"
                  ? "var(--color-bg)"
                  : isActionRequired
                  ? "#fffdf5"
                  : "var(--color-surface, #ffffff)",
                boxShadow: isToday ? "0 0 0 1px rgba(37, 99, 235, 0.2)" : "none",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                position: "relative",
              }}
            >
              {/* Top Row: Day Number, Today Badge & Pencil Regularize Icon */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span
                    style={{
                      fontSize: "13px",
                      fontWeight: 700,
                      color: isToday ? "#2563eb" : isFuture ? "var(--color-muted)" : "var(--color-text)",
                    }}
                  >
                    {d.dayNumber}
                  </span>
                  {isToday && (
                    <span
                      style={{
                        fontSize: "9px",
                        fontWeight: 700,
                        background: "#2563eb",
                        color: "#ffffff",
                        padding: "1px 5px",
                        borderRadius: "8px",
                        textTransform: "uppercase",
                        letterSpacing: "0.4px",
                      }}
                    >
                      Today
                    </span>
                  )}
                </div>

                {/* Bug 1: Pencil icon fixed at top-right for irregular days */}
                {isActionRequired && (
                  <button
                    type="button"
                    data-testid={`edit-irregular-${d.dayNumber}`}
                    aria-label={`Regularize ${d.date}`}
                    onClick={() => onOpenRegularize(d)}
                    title={`Regularize irregular attendance for ${d.date}`}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#2563eb",
                      cursor: "pointer",
                      padding: "0 2px",
                      fontSize: "13px",
                      lineHeight: 1,
                    }}
                  >
                    ✏️
                  </button>
                )}
              </div>

              {/* Status Badge: Render ONLY if a real status exists */}
              <div style={{ marginTop: "4px", minHeight: "18px" }}>
                {displayStatus && displayStatus !== "" ? (
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 6px",
                      borderRadius: "8px",
                      fontSize: "10px",
                      fontWeight: 700,
                      background:
                        displayStatus === "Present"
                          ? "#dcfce7"
                          : displayStatus === "In Progress"
                          ? "#e0e7ff"
                          : displayStatus === "Late Punch"
                          ? "#fef3c7"
                          : displayStatus === "Missing Punch" || displayStatus === "Early Exit"
                          ? "#fee2e2"
                          : displayStatus === "Outside Geofence" || displayStatus === "Work From Home"
                          ? "#ffedd5"
                          : displayStatus === "Leave"
                          ? "#eff6ff"
                          : "#f3f4f6",
                      color:
                        displayStatus === "Present"
                          ? "#16a34a"
                          : displayStatus === "In Progress"
                          ? "#4338ca"
                          : displayStatus === "Late Punch"
                          ? "#b45309"
                          : displayStatus === "Missing Punch" || displayStatus === "Early Exit"
                          ? "#dc2626"
                          : displayStatus === "Outside Geofence" || displayStatus === "Work From Home"
                          ? "#c2410c"
                          : displayStatus === "Leave"
                          ? "#2563eb"
                          : "#6b7280",
                    }}
                  >
                    {displayStatus}
                  </span>
                ) : null}
              </div>

              {/* Punch Timings & Work Hours from DB Records */}
              <div
                style={{
                  fontSize: "10.5px",
                  color: "var(--color-muted)",
                  lineHeight: "1.4",
                  marginTop: "6px",
                }}
              >
                <div>
                  In: <span style={{ color: d.punch_in ? "var(--color-text)" : "inherit", fontWeight: d.punch_in ? 500 : 400 }}>{d.punch_in || "—"}</span>
                </div>
                <div>
                  Out: <span style={{ color: d.punch_out ? "var(--color-text)" : "inherit", fontWeight: d.punch_out ? 500 : 400 }}>{d.punch_out || "—"}</span>
                </div>
                <div>
                  Hours: <span style={{ color: d.total_hours ? "var(--color-text)" : "inherit", fontWeight: d.total_hours ? 500 : 400 }}>{d.total_hours || "—"}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
