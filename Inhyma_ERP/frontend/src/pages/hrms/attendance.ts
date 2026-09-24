/**
 * HRMS Attendance Core Types and Domain Functions.
 *
 * Defines the real attendance data contracts, status classifications,
 * calendar generation rules (past = record/absent, today = in progress/present, future = empty),
 * and regularize icon logic.
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

export interface AttendanceDay {
  date: string; // YYYY-MM-DD
  dayNumber: number;
  weekday: string; // "Sun", "Mon", etc.
  status: AttendanceStatus;
  punch_in: string | null;
  punch_out: string | null;
  total_hours: string | null;
  is_irregular: boolean;
  notes?: string;
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
}

/**
 * Evaluates whether a calendar day cell should render the small pencil (✏️) icon
 * at the top-right corner to allow regularization.
 *
 * Rules:
 * - True for: Late Punch, Missing Punch, Early Exit, Outside Geofence, Work From Home,
 *   is_irregular, or any manual correction required.
 * - NEVER for: Normal Present, Leave, Holiday, Weekend (without irregularity),
 *   Future dates, or active In Progress.
 */
export function shouldShowRegularizeIcon(
  day: AttendanceDay | { date: string; status?: string; is_irregular?: boolean; punch_in?: string | null; punch_out?: string | null; weekday?: string },
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

  // 8. Explicit irregular flag
  if (day.is_irregular) {
    return true;
  }

  // 9. Irregular status names
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
 * Generates calendar month days from real database records.
 *
 * Production Calendar Rules:
 * - Past with record: Show record status (Present, Late Punch, Missing Punch, etc.)
 * - Past without record: Absent (or Holiday/Weekend)
 * - Today with record & uncompleted: In Progress
 * - Today with record & completed: Present / Late Punch / Half Day
 * - Today without record: Empty ("")
 * - Future date: EMPTY ("") - NEVER copy previous day's status, NEVER mark as Present!
 */
export function generateMonthDays(
  monthStr: string,
  recordsByDate: Record<string, any> = {},
  serverDate?: string
): AttendanceDay[] {
  const [yrStr, moStr] = monthStr.split("-");
  const yr = parseInt(yrStr, 10);
  const mo = parseInt(moStr, 10);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const todayStr = serverDate || new Date().toISOString().slice(0, 10);

  const days: AttendanceDay[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = String(d).padStart(2, "0");
    const date = `${monthStr}-${dayStr}`;
    const dateObj = new Date(yr, mo - 1, d);
    const weekday = weekdays[dateObj.getDay()];
    const isWeekend = weekday === "Sun" || weekday === "Sat";
    const rec = recordsByDate[date];

    if (rec) {
      const isToday = date === todayStr;
      const isPast = date < todayStr;

      let status: AttendanceStatus;
      let isIrregular = false;

      if (isToday) {
        if (rec.punch_in && !rec.punch_out && rec.status !== "CLOSED") {
          status = "In Progress";
        } else {
          status = (rec.final_status || rec.status || (rec.late_mark ? "Late Punch" : "Present")) as AttendanceStatus;
        }
      } else if (isPast) {
        if (rec.punch_in && !rec.punch_out && rec.status !== "CLOSED") {
          status = "Missing Punch";
          isIrregular = true;
        } else {
          status = (rec.final_status || rec.status || (rec.late_mark ? "Late Punch" : "Present")) as AttendanceStatus;
        }
      } else {
        // Future date with explicit record (e.g. approved leave)
        status = (rec.final_status || rec.status || "") as AttendanceStatus;
      }

      if (!isIrregular) {
        isIrregular = Boolean(
          rec.is_irregular ||
          rec.irregularity_type ||
          rec.late_mark ||
          status === "Late Punch" ||
          status === "Missing Punch" ||
          status === "Early Exit" ||
          status === "Outside Geofence" ||
          status === "Work From Home" ||
          rec.regularization_status === "PENDING"
        );
      }

      days.push({
        date,
        dayNumber: d,
        weekday,
        status,
        punch_in: rec.punch_in || rec.check_in_time || null,
        punch_out: rec.punch_out || rec.check_out_time || null,
        total_hours:
          rec.total_hours ||
          (rec.total_work_minutes
            ? `${Math.floor(rec.total_work_minutes / 60)}h ${String(rec.total_work_minutes % 60).padStart(2, "0")}m`
            : null),
        is_irregular: isIrregular,
      });
    } else if (date < todayStr) {
      // Past without record -> Absent or Weekend/Holiday
      days.push({
        date,
        dayNumber: d,
        weekday,
        status: isWeekend ? "Holiday" : "Absent",
        punch_in: null,
        punch_out: null,
        total_hours: null,
        is_irregular: false,
      });
    } else {
      // Today without record OR Future date without record -> EMPTY!
      // Future dates must NEVER be Present or inherit previous status!
      days.push({
        date,
        dayNumber: d,
        weekday,
        status: "",
        punch_in: null,
        punch_out: null,
        total_hours: null,
        is_irregular: false,
      });
    }
  }
  return days;
}
