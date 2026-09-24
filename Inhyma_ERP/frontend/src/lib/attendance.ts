/**
 * HRMS Attendance Core Types and Domain Functions.
 *
 * Defines the real attendance data contracts, status classifications,
 * calendar generation rules (past = record/absent, today = in progress/present, future = empty),
 * geofence distance calculation, and regularize icon logic.
 */

export type AttendanceStatus =
  | "Present"
  | "In Progress"
  | "Late Punch"
  | "Half Day"
  | "Missing Punch"
  | "Early Exit"
  | "Outside Geofence"
  | "Work From Home"
  | "WFH"
  | "Leave"
  | "Holiday"
  | "Absent"
  | "";

export type AttendanceTerminalState =
  | "NOT_PUNCHED"
  | "CHECKED_IN"
  | "CHECKED_OUT"
  | "OUTSIDE_GEOFENCE"
  | "REGULARIZATION_PENDING";

export interface AttendanceDay {
  date: string; // YYYY-MM-DD
  dayNumber: number;
  weekday: string; // "Sun", "Mon", etc.
  status: AttendanceStatus;
  punch_in?: string | null;
  punch_out?: string | null;
  total_hours?: string | null;
  is_irregular: boolean;
  notes?: string;
  regularization_status?: string | null;
}

export interface AssignedOffice {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active?: boolean;
}

export interface TodayAttendanceRecord {
  id?: string;
  attendance_date?: string;
  punched_in?: string | null;
  punched_out?: string | null;
  punch_in?: string | null;
  punch_out?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  status?: string;
  final_status?: string;
  total_hours?: string | null;
  total_work_minutes?: number | null;
  workplace?: string;
  office_id?: string | null;
  office_name?: string | null;
  is_irregular?: boolean;
  late_mark?: boolean;
  half_day?: boolean;
  regularization_status?: string | null;
}

export interface TodayAttendanceResponse {
  server_time?: string;
  server_time_local?: string;
  current_date?: string;
  current_time?: string;
  greeting?: string;
  current_shift?: string;
  attendance_state?: string;
  assigned_office?: AssignedOffice;
  session?: TodayAttendanceRecord | null;
  punched_in?: string | null;
  punched_out?: string | null;
  punch_in?: string | null;
  punch_out?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  status?: string;
  final_status?: string;
  total_hours?: string | null;
  total_work_minutes?: number | null;
  is_irregular?: boolean;
  late_mark?: boolean;
  half_day?: boolean;
}

export interface DevGpsLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  isInsideAssigned: boolean;
  distanceKm: number;
}

/**
 * Calculates Haversine distance in meters between two coordinates.
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Formats elapsed seconds into "Xh YYm" or "Xh YYm ZZs".
 */
export function formatDurationHoursMins(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

/**
 * Evaluates whether a calendar day cell should render the small pencil (✏️) icon
 * at the top-right corner to allow regularization.
 *
 * Rules:
 * - True for: Late Punch, Missing Punch, Early Exit, Outside Geofence, Work From Home,
 *   Pending regularization, is_irregular.
 * - NEVER for: Normal Present, Leave, Holiday, Weekend, Future dates, or active In Progress.
 */
export function shouldShowRegularizeIcon(
  day: AttendanceDay | { date: string; status?: string; is_irregular?: boolean; punch_in?: string | null; punch_out?: string | null; weekday?: string; regularization_status?: string | null },
  displayStatus?: string
): boolean {
  const currentStatus = (displayStatus || day.status || "").trim();
  const todayIso = new Date().toISOString().slice(0, 10);

  // 1. Future dates: NEVER render
  if (day.date > todayIso) {
    return false;
  }

  // 2. Active In Progress: NEVER render
  if (currentStatus === "In Progress" || (day.date === todayIso && day.punch_in && !day.punch_out)) {
    return false;
  }

  // 3. Normal Present: NEVER render
  if (currentStatus === "Present" && !day.is_irregular) {
    return false;
  }

  // 4. Approved Leave: NEVER render
  if (currentStatus === "Leave") {
    return false;
  }

  // 5. Holiday: NEVER render
  if (currentStatus === "Holiday") {
    return false;
  }

  // 6. Normal Weekend without irregular punches: NEVER render
  const weekday = day.weekday || new Date(day.date).toLocaleDateString("en-US", { weekday: "short" });
  if ((weekday === "Sun" || weekday === "Sat") && !day.is_irregular && !day.punch_in) {
    return false;
  }

  // 7. Empty status: NEVER render
  if (!currentStatus) {
    return false;
  }

  // 8. Pending regularization status
  if (day.regularization_status === "PENDING" || currentStatus === "Pending Regularization") {
    return true;
  }

  // 9. Explicit irregular flag
  if (day.is_irregular) {
    return true;
  }

  // 10. Allowed irregular status names
  const irregularStatuses = [
    "Late Punch",
    "Missing Punch",
    "Early Exit",
    "Outside Geofence",
    "Work From Home",
    "WFH",
    "Half Day",
  ];
  return irregularStatuses.includes(currentStatus) || irregularStatuses.includes(day.status || "");
}

/**
 * Generates month calendar days purely from authoritative database records.
 *
 * Rules:
 * - Past with attendance: Actual record
 * - Past without attendance: Absent
 * - Today punched (OPEN): In Progress
 * - Today completed (CLOSED): Present / final status
 * - Future: Empty (status = "")
 */
export function generateMonthDays(
  monthStr: string,
  records: any[] | Record<string, any> = [],
  todaySessionOrDate: TodayAttendanceRecord | string | null = null,
  serverDateStr?: string | null
): AttendanceDay[] {
  const [yr, mo] = monthStr.split("-").map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const todayIso =
    (typeof todaySessionOrDate === "string" ? todaySessionOrDate : serverDateStr) ||
    new Date().toISOString().slice(0, 10);
  const todaySession =
    typeof todaySessionOrDate === "object" ? todaySessionOrDate : null;

  // Map database records by date (YYYY-MM-DD)
  const attendanceMap = new Map<string, any>();
  if (Array.isArray(records)) {
    for (const r of records) {
      const dStr = r.attendance_date || (r.check_in_time ? r.check_in_time.slice(0, 10) : "");
      if (dStr) {
        attendanceMap.set(dStr, r);
      }
    }
  } else if (records && typeof records === "object") {
    for (const [key, val] of Object.entries(records)) {
      const dStr = (val as any)?.attendance_date || key;
      attendanceMap.set(dStr, { ...(val as any), attendance_date: dStr });
    }
  }

  // Overlay today's live session if available
  if (todaySession) {
    const todaySessionDate = todaySession.attendance_date || todayIso;
    attendanceMap.set(todaySessionDate, {
      ...attendanceMap.get(todaySessionDate),
      ...todaySession,
    });
  }

  const days: AttendanceDay[] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(yr, mo - 1, d);
    const dateStr = `${yr}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const weekday = dateObj.toLocaleDateString("en-US", { weekday: "short" });
    const isWeekend = weekday === "Sun" || weekday === "Sat";

    const rec = attendanceMap.get(dateStr);
    const isFuture = dateStr > todayIso;
    const isToday = dateStr === todayIso;
    const isPast = dateStr < todayIso;

    let status: AttendanceStatus = "";
    let punch_in: string | null = null;
    let punch_out: string | null = null;
    let total_hours: string | null = null;
    let is_irregular = false;
    let regularization_status: string | null = null;

    if (isFuture) {
      // Future dates: ALWAYS EMPTY. Never inherit Present or status!
      status = "";
    } else if (isToday) {
      if (rec && (rec.status === "OPEN" || (rec.punched_in && !rec.punched_out && !rec.punch_out) || (rec.punch_in && !rec.punch_out && !rec.punched_out && rec.status !== "CLOSED"))) {
        // Active open session
        status = "In Progress";
        punch_in = rec.punch_in || (rec.check_in_time ? new Date(rec.check_in_time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : null);
        punch_out = null;
        total_hours = rec.total_hours || null;
        is_irregular = Boolean(rec.is_irregular || rec.late_mark);
        regularization_status = rec.regularization_status || null;
      } else if (rec && (rec.status === "CLOSED" || rec.punched_out || rec.punch_out || rec.final_status)) {
        // Today completed
        status = (rec.final_status || rec.status || "Present") as AttendanceStatus;
        punch_in = rec.punch_in || null;
        punch_out = rec.punch_out || null;
        total_hours = rec.total_hours || null;
        is_irregular = Boolean(rec.is_irregular || rec.late_mark || rec.half_day);
        regularization_status = rec.regularization_status || null;
      } else {
        // Today not punched yet: empty
        status = "";
      }
    } else if (isPast) {
      if (rec) {
        // Past with attendance: actual record
        status = (rec.final_status || rec.status || "Present") as AttendanceStatus;
        punch_in = rec.punch_in || null;
        punch_out = rec.punch_out || null;
        total_hours = rec.total_hours || null;
        is_irregular = Boolean(rec.is_irregular || rec.late_mark || rec.half_day);
        regularization_status = rec.regularization_status || null;
      } else {
        // Past without attendance: Weekend = Holiday, Weekday = Absent
        status = isWeekend ? "Holiday" : "Absent";
      }
    }

    days.push({
      date: dateStr,
      dayNumber: d,
      weekday,
      status,
      punch_in,
      punch_out,
      total_hours,
      is_irregular,
      regularization_status,
    });
  }

  return days;
}
