/**
 * HRMS Dashboard Landing Page (/hrms/dashboard)
 *
 * Keeps existing ERP dashboard structure and spacing:
 * 1. Greeting & Employee summary card (welcome-section)
 * 2. Attendance Summary KPIs (Present today, working hours, month attendance, leave balance)
 * 3. Quick Actions panel (Punch In/Out, Mark/Regularize Attendance, Review Approvals, Setup)
 * 4. Holiday Calendar Widget (Month navigation, gazetted/public/restricted holidays list)
 */

import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import {
  IconCalendar,
  IconClock,
  IconBriefcase,
  IconCheckSquare,
  IconPin,
  IconBuilding,
  IconShield,
  IconFileText,
  IconDashboard,
} from "@/components/icons";
import { useAuth } from "@/lib/hooks";

interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
  type: "Gazetted" | "Restricted" | "Public";
}

const MOCK_HOLIDAYS: Holiday[] = [
  { date: "2026-01-26", name: "Republic Day", type: "Gazetted" },
  { date: "2026-03-03", name: "Holi", type: "Gazetted" },
  { date: "2026-03-21", name: "Id-ul-Fitr", type: "Gazetted" },
  { date: "2026-04-03", name: "Good Friday", type: "Gazetted" },
  { date: "2026-04-14", name: "Dr. B.R. Ambedkar Jayanti", type: "Public" },
  { date: "2026-05-01", name: "Maharashtra Day / Labour Day", type: "Public" },
  { date: "2026-08-15", name: "Independence Day", type: "Gazetted" },
  { date: "2026-08-28", name: "Raksha Bandhan", type: "Restricted" },
  { date: "2026-09-04", name: "Janmashtami", type: "Gazetted" },
  { date: "2026-09-15", name: "Ganesh Chaturthi", type: "Public" },
  { date: "2026-09-24", name: "Milad-un-Nabi", type: "Gazetted" },
  { date: "2026-10-02", name: "Mahatma Gandhi Jayanti", type: "Gazetted" },
  { date: "2026-10-20", name: "Dussehra (Vijayadashami)", type: "Gazetted" },
  { date: "2026-11-08", name: "Diwali (Deepavali)", type: "Gazetted" },
  { date: "2026-11-09", name: "Govardhan Puja", type: "Restricted" },
  { date: "2026-11-24", name: "Guru Nanak Jayanti", type: "Gazetted" },
  { date: "2026-12-25", name: "Christmas Day", type: "Gazetted" },
];

export function HrmsLandingDashboardPage() {
  const navigate = useNavigate();
  const { profile, isSuperAdmin } = useAuth();

  const isHrAdmin = useMemo(() => {
    if (isSuperAdmin) return true;
    const userRole = String(profile?.role || "").toLowerCase();
    const roles = Array.isArray(profile?.roles)
      ? profile.roles.map((r) => String(r).toLowerCase())
      : [];
    return (
      ["admin", "hr", "hr_manager", "super_admin"].includes(userRole) ||
      roles.some((r) => ["admin", "hr", "hr_manager", "super_admin"].includes(r))
    );
  }, [profile, isSuperAdmin]);

  // Greeting based on current time
  const greeting = useMemo(() => {
    const hr = new Date().getHours();
    if (hr < 12) return "Good Morning";
    if (hr < 17) return "Good Afternoon";
    return "Good Evening";
  }, []);

  const todayFormatted = useMemo(() => {
    return new Date().toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }, []);

  // Holiday calendar widget state
  const [calendarDate, setCalendarDate] = useState<Date>(() => new Date());
  const calYear = calendarDate.getFullYear();
  const calMonth = calendarDate.getMonth();
  const monthName = calendarDate.toLocaleString("en-US", { month: "long" });

  const calendarCells = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(calYear, calMonth, 0).getDate();

    const todayStr = new Date().toISOString().slice(0, 10);
    const cells: Array<{
      dayNum: number;
      dateKey: string;
      isCurrentMonth: boolean;
      isToday: boolean;
      holiday?: Holiday;
    }> = [];

    // Leading padding days from previous month
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevDate = new Date(calYear, calMonth - 1, d);
      const prevMonthNum = String(prevDate.getMonth() + 1).padStart(2, "0");
      const dayNumStr = String(d).padStart(2, "0");
      const key = `${prevDate.getFullYear()}-${prevMonthNum}-${dayNumStr}`;
      const hol = MOCK_HOLIDAYS.find((h) => h.date === key);
      cells.push({ dayNum: d, dateKey: key, isCurrentMonth: false, isToday: key === todayStr, holiday: hol });
    }

    // Days in current month
    const monthNum = String(calMonth + 1).padStart(2, "0");
    for (let d = 1; d <= daysInMonth; d++) {
      const dayNumStr = String(d).padStart(2, "0");
      const key = `${calYear}-${monthNum}-${dayNumStr}`;
      const hol = MOCK_HOLIDAYS.find((h) => h.date === key);
      cells.push({ dayNum: d, dateKey: key, isCurrentMonth: true, isToday: key === todayStr, holiday: hol });
    }

    // Trailing padding days
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const nextDate = new Date(calYear, calMonth + 1, d);
      const nextMonthNum = String(nextDate.getMonth() + 1).padStart(2, "0");
      const dayNumStr = String(d).padStart(2, "0");
      const key = `${nextDate.getFullYear()}-${nextMonthNum}-${dayNumStr}`;
      const hol = MOCK_HOLIDAYS.find((h) => h.date === key);
      cells.push({ dayNum: d, dateKey: key, isCurrentMonth: false, isToday: key === todayStr, holiday: hol });
    }

    return cells;
  }, [calYear, calMonth]);

  const currentMonthHolidays = useMemo(() => {
    const prefix = `${calYear}-${String(calMonth + 1).padStart(2, "0")}`;
    return MOCK_HOLIDAYS.filter((h) => h.date.startsWith(prefix)).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
  }, [calYear, calMonth]);

  return (
    <AppShell activeKey="hrms">
      <main className="page" style={{ maxWidth: "1240px", margin: "0 auto", padding: "20px 24px" }}>
        <Breadcrumb trail={["Dashboard", "HRMS", "Overview"]} />

        {/* 1. GREETING & EMPLOYEE SUMMARY HERO */}
        <div
          data-testid="welcome-section"
          style={{
            background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
            color: "#ffffff",
            padding: "20px 24px",
            borderRadius: "var(--radius-sm, 8px)",
            marginBottom: "20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "16px",
          }}
        >
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#ffffff", margin: 0, letterSpacing: "-0.02em" }}>
              {greeting}, {profile?.full_name || "Employee"}!
            </h1>
            <div style={{ fontSize: "13px", color: "#94a3b8", marginTop: "4px" }}>
              <span>{profile?.role || "General Staff"}</span>
              <span style={{ margin: "0 8px" }}>•</span>
              <span>Employee Code: {profile?.employee_code || "EMP-007"}</span>
              <span style={{ margin: "0 8px" }}>•</span>
              <span>{todayFormatted}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span
              style={{
                padding: "6px 14px",
                borderRadius: "20px",
                fontSize: "12.5px",
                fontWeight: 600,
                background: "rgba(34, 197, 94, 0.2)",
                color: "#4ade80",
                border: "1px solid rgba(34, 197, 94, 0.4)",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#22c55e" }} />
              <span>Shift Active</span>
            </span>
          </div>
        </div>

        {/* 2. ATTENDANCE SUMMARY KPIS */}
        <section
          data-testid="attendance-summary-section"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
            gap: "16px",
            marginBottom: "20px",
          }}
        >
          <div className="card" style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--color-muted)" }}>
              Present Today
            </div>
            <div style={{ marginTop: "10px", display: "flex", alignItems: "baseline", gap: "8px" }}>
              <span style={{ fontSize: "26px", fontWeight: 700, color: "var(--color-text)" }}>1</span>
              <span className="badge badge-active" style={{ fontSize: "11.5px" }}>On Time</span>
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "6px" }}>
              Assigned: Mumbai BKC Office
            </div>
          </div>

          <div className="card" style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--color-muted)" }}>
              Working Hours Today
            </div>
            <div style={{ marginTop: "10px", display: "flex", alignItems: "baseline", gap: "8px" }}>
              <span style={{ fontSize: "26px", fontWeight: 700, color: "var(--color-text)" }}>7h 45m</span>
              <span className="badge badge-info" style={{ fontSize: "11.5px" }}>Standard: 9h</span>
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "6px" }}>
              Shift: 09:00 AM – 06:00 PM
            </div>
          </div>

          <div className="card" style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--color-muted)" }}>
              This Month Attendance
            </div>
            <div style={{ marginTop: "10px", display: "flex", alignItems: "baseline", gap: "8px" }}>
              <span style={{ fontSize: "26px", fontWeight: 700, color: "var(--color-text)" }}>22 / 24 Days</span>
              <span className="badge badge-active" style={{ fontSize: "11.5px" }}>91.6%</span>
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "6px" }}>
              September 2026 Cycle
            </div>
          </div>

          <div className="card" style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--color-muted)" }}>
              Leave Balance
            </div>
            <div style={{ marginTop: "10px", display: "flex", alignItems: "baseline", gap: "8px" }}>
              <span style={{ fontSize: "26px", fontWeight: 700, color: "var(--color-text)" }}>14 Days</span>
              <span className="badge badge-warning" style={{ fontSize: "11.5px" }}>Annual Quota</span>
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "6px" }}>
              CL: 6 | SL: 4 | EL: 4
            </div>
          </div>
        </section>

        {/* 3. QUICK ACTIONS PANEL */}
        <section
          className="card"
          data-testid="quick-actions-section"
          style={{ marginBottom: "20px", padding: "18px 20px" }}
        >
          <h2
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: "var(--color-text)",
              margin: "0 0 14px 0",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <IconClock width={16} height={16} />
            <span>Quick Actions</span>
          </h2>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate("/hrms/attendance?tab=view")}
              data-testid="action-open-attendance-btn"
              style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "9px 18px", fontWeight: 600 }}
            >
              <IconClock width={16} height={16} />
              <span>Punch & View Attendance</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate("/hrms/attendance?tab=approval")}
              data-testid="action-open-approvals-btn"
              style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "9px 18px" }}
            >
              <IconCheckSquare width={16} height={16} />
              <span>{isHrAdmin ? "Review Approvals" : "My Requests"}</span>
            </button>

            {isHrAdmin && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate("/hrms/setup")}
                data-testid="action-open-setup-btn"
                style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "9px 18px" }}
              >
                <IconBuilding width={16} height={16} />
                <span>HRMS Setup</span>
              </button>
            )}
          </div>
        </section>

        {/* 4. HOLIDAY CALENDAR WIDGET */}
        <section
          className="card"
          data-testid="holiday-calendar-section"
          style={{ marginBottom: "20px", padding: "18px 20px" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <h2
              style={{
                fontSize: "15px",
                fontWeight: 600,
                color: "var(--color-text)",
                margin: 0,
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <IconCalendar width={16} height={16} />
              <span>Holiday Calendar — {monthName} {calYear}</span>
            </h2>

            <div style={{ display: "flex", gap: "6px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "4px 10px", fontSize: "12px" }}
                onClick={() => setCalendarDate(new Date(calYear, calMonth - 1, 1))}
              >
                &larr; Prev
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "4px 10px", fontSize: "12px" }}
                onClick={() => setCalendarDate(new Date())}
              >
                Today
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "4px 10px", fontSize: "12px" }}
                onClick={() => setCalendarDate(new Date(calYear, calMonth + 1, 1))}
              >
                Next &rarr;
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>
            {/* Calendar Grid */}
            <div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, 1fr)",
                  textAlign: "center",
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "var(--color-muted)",
                  marginBottom: "8px",
                }}
              >
                <div>Sun</div>
                <div>Mon</div>
                <div>Tue</div>
                <div>Wed</div>
                <div>Thu</div>
                <div>Fri</div>
                <div>Sat</div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, 1fr)",
                  gap: "4px",
                }}
              >
                {calendarCells.map((cell, idx) => {
                  const isHoliday = Boolean(cell.holiday);
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: "8px 4px",
                        textAlign: "center",
                        borderRadius: "var(--radius-sm, 6px)",
                        fontSize: "12px",
                        background: cell.isToday
                          ? "var(--color-primary-soft, #eff6ff)"
                          : isHoliday
                          ? "#fef2f2"
                          : "transparent",
                        border: cell.isToday
                          ? "1px solid var(--color-primary)"
                          : isHoliday
                          ? "1px solid #fecaca"
                          : "1px solid transparent",
                        opacity: cell.isCurrentMonth ? 1 : 0.4,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: cell.isToday ? 700 : 500,
                          color: isHoliday
                            ? "var(--color-danger)"
                            : cell.isToday
                            ? "var(--color-primary)"
                            : "var(--color-text)",
                        }}
                      >
                        {cell.dayNum}
                      </span>
                      {cell.holiday && (
                        <div
                          style={{
                            fontSize: "9px",
                            color: "var(--color-danger)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            marginTop: "2px",
                          }}
                          title={cell.holiday.name}
                        >
                          {cell.holiday.name}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* List of holidays in current month */}
            <div
              style={{
                borderLeft: "1px solid var(--color-border)",
                paddingLeft: "20px",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <h3 style={{ fontSize: "13.5px", fontWeight: 600, margin: "0 0 12px 0", color: "var(--color-text)" }}>
                Holidays in {monthName}
              </h3>
              {currentMonthHolidays.length === 0 ? (
                <div style={{ fontSize: "12.5px", color: "var(--color-muted)" }}>
                  No gazetted holidays for this month.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {currentMonthHolidays.map((h, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "var(--radius-sm, 6px)",
                        background: "var(--color-bg)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--color-text)" }}>
                          {h.name}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                          {new Date(h.date).toLocaleDateString("en-IN", {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: "10px",
                          background: h.type === "Gazetted" ? "#fee2e2" : "#f1f5f9",
                          color: h.type === "Gazetted" ? "#b91c1c" : "#475569",
                        }}
                      >
                        {h.type}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
