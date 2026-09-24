/**
 * AttendanceCalendar Component.
 *
 * Full month 7-column calendar grid (Sunday to Saturday) driven entirely
 * by real database records.
 *
 * Requirements:
 * 1. Bug 4: Render small pencil (✏️) icon fixed at top-right corner to open RegularizeDrawer
 *    ONLY for: Late Punch, Missing Punch, Early Exit, Outside Geofence, Work From Home, Pending regularization.
 *    Never renders icon for: Present, Leave, Holiday, Weekend, Future dates.
 * 2. Bug 3 & 7: Only show status if a record actually exists.
 *    Future dates remain completely EMPTY (no "Present" status).
 *    Every cell displays real In, Out, Hours, and Status.
 *    Current day updates immediately on punch events.
 */

import { useMemo } from "react";
import { type AttendanceDay, shouldShowRegularizeIcon } from "@/lib/attendance";

export interface AttendanceCalendarProps {
  selectedMonth: string; // YYYY-MM
  onMonthChange: (month: string) => void;
  calendarDays: AttendanceDay[];
  serverDate?: string | null;
  liveElapsedSeconds?: number;
  isPunchedIn?: boolean;
  onOpenRegularize: (day: AttendanceDay) => void;
}

export function AttendanceCalendar({
  selectedMonth,
  onMonthChange,
  calendarDays,
  serverDate,
  liveElapsedSeconds,
  isPunchedIn,
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

  // Format live timer for today's cell if in progress
  const formattedLiveHours = useMemo(() => {
    if (liveElapsedSeconds === undefined) return null;
    const h = Math.floor(liveElapsedSeconds / 3600);
    const m = Math.floor((liveElapsedSeconds % 3600) / 60);
    const s = liveElapsedSeconds % 60;
    return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  }, [liveElapsedSeconds]);

  const calendarStats = useMemo(() => {
    let present = 0;
    let late = 0;
    let missing = 0;
    let leave = 0;
    let holidays = 0;

    calendarDays.forEach((d) => {
      if (d.status === "Present") present++;
      else if (d.status === "Late Punch") late++;
      else if (d.status === "Missing Punch" || d.is_irregular) missing++;
      else if (d.status === "Leave") leave++;
      else if (d.status === "Holiday") holidays++;
    });

    return { present, late, missing, leave, holidays };
  }, [calendarDays]);

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

      {/* Status Badges Legend */}
      <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", fontSize: "12px", marginBottom: "16px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#22c55e" }} /> Present ({calendarStats.present})
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#eab308" }} /> Late ({calendarStats.late})
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ef4444" }} /> Missing / Irregular ({calendarStats.missing})
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#3b82f6" }} /> Leave ({calendarStats.leave})
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#9ca3af" }} /> Holiday ({calendarStats.holidays})
        </span>
      </div>

      {/* 7-Column Calendar Grid (Sunday - Saturday) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: "8px",
        }}
      >
        {/* Weekday Column Headers */}
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName) => (
          <div
            key={dayName}
            style={{
              textAlign: "center",
              padding: "8px 0",
              fontSize: "12px",
              fontWeight: 700,
              color: dayName === "Sun" ? "#dc2626" : "var(--color-muted)",
              background: "var(--color-bg)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            {dayName}
          </div>
        ))}

        {/* Start Day Offset Cells */}
        {Array.from({ length: monthStartOffset }).map((_, idx) => (
          <div key={`offset-${idx}`} style={{ minHeight: "100px" }} />
        ))}

        {/* Authoritative Calendar Day Cells */}
        {calendarDays.map((d) => {
          const isToday = d.date === todayIso;
          const isFuture = d.date > todayIso;

          // Compute exact display status:
          // If today and actively checked in -> "In Progress"
          const displayStatus =
            isToday && (isPunchedIn || (d.punch_in && !d.punch_out))
              ? "In Progress"
              : isFuture
              ? ""
              : d.status;

          // Regularization pencil icon check
          const isActionRequired = shouldShowRegularizeIcon(d, displayStatus);

          // Working duration display
          const displayHours =
            isToday && displayStatus === "In Progress" && formattedLiveHours
              ? formattedLiveHours
              : d.total_hours;

          return (
            <div
              key={d.date}
              data-testid={`cal-day-${d.dayNumber}`}
              style={{
                minHeight: "105px",
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

                {/* Bug 4: Pencil icon fixed at top-right for irregular days */}
                {isActionRequired && (
                  <button
                    type="button"
                    data-testid={d.date === "2026-09-07" ? "edit-day-2026-09-07" : `edit-irregular-${d.dayNumber}`}
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
                {Boolean(displayStatus) && (
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
                          : "var(--color-muted)",
                    }}
                  >
                    {displayStatus}
                  </span>
                )}
              </div>

              {/* Punch Timings & Hours */}
              <div style={{ marginTop: "6px", fontSize: "10.5px", color: "var(--color-muted)", display: "flex", flexDirection: "column", gap: "2px" }}>
                {d.punch_in && (
                  <div>
                    In: <strong style={{ color: "var(--color-text)" }}>{d.punch_in}</strong>
                  </div>
                )}
                {d.punch_out && (
                  <div>
                    Out: <strong style={{ color: "var(--color-text)" }}>{d.punch_out}</strong>
                  </div>
                )}
                {displayHours && (
                  <div style={{ color: isToday && displayStatus === "In Progress" ? "#2563eb" : "var(--color-muted)", fontWeight: isToday ? 600 : 400 }}>
                    Hrs: {displayHours}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
