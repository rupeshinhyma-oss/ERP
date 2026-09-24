/**
 * Attendance Policy Engine (Admin Configurable)
 *
 * Implements rule evaluation for shift timings, grace periods,
 * progressive late marks, and direct half-day cutoffs.
 */

export interface AttendancePolicyConfig {
  shiftStart: string; // e.g. "10:30 AM"
  shiftEnd: string; // e.g. "07:00 PM"
  graceUntil: string; // e.g. "10:45 AM"
  lateStartsAfter: string; // e.g. "10:45 AM"
  directHalfDayAfter: string; // e.g. "11:30 AM"
  lateMarksBeforeHalfDay: number; // e.g. 3
  payrollCycle: string; // e.g. "1st to 31st of Month"
  employmentType: string; // e.g. "Full Time Permanent"
}

export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicyConfig = {
  shiftStart: "10:30 AM",
  shiftEnd: "07:00 PM",
  graceUntil: "10:45 AM",
  lateStartsAfter: "10:45 AM",
  directHalfDayAfter: "11:30 AM",
  lateMarksBeforeHalfDay: 3,
  payrollCycle: "1st to 31st of Month",
  employmentType: "Full Time Permanent",
};

/**
 * Parses time strings like "10:30 AM", "07:00 PM", or "10:46" into minutes from midnight.
 */
export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const clean = timeStr.trim().toUpperCase();

  const match = clean.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/);
  if (!match) return 0;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridian = match[3];

  if (meridian === "PM" && hours < 12) hours += 12;
  if (meridian === "AM" && hours === 12) hours = 0;

  return hours * 60 + minutes;
}

export interface AttendanceEvaluationResult {
  status: "Present" | "Late Punch" | "Half Day" | "Absent";
  lateMarkCount: number;
  isHalfDay: boolean;
  isLate: boolean;
  ruleTriggered: string;
}

/**
 * Evaluates punch-in time against configurable policy rules:
 * - Before or at graceUntil -> Present
 * - After directHalfDayAfter -> Direct Half Day (no late mark count)
 * - Between lateStartsAfter and directHalfDayAfter -> Late Mark (if lateMarkCount reaches threshold -> becomes Half Day)
 */
export function evaluatePunchTime(
  punchTimeStr: string,
  policy: AttendancePolicyConfig = DEFAULT_ATTENDANCE_POLICY,
  currentLateCount = 0
): AttendanceEvaluationResult {
  const punchMinutes = parseTimeToMinutes(punchTimeStr);
  const graceMinutes = parseTimeToMinutes(policy.graceUntil);
  const directHalfDayMinutes = parseTimeToMinutes(policy.directHalfDayAfter);

  // 1. Within Grace Period
  if (punchMinutes <= graceMinutes) {
    return {
      status: "Present",
      lateMarkCount: currentLateCount,
      isHalfDay: false,
      isLate: false,
      ruleTriggered: `Arrived on time within grace cutoff (${policy.graceUntil})`,
    };
  }

  // 2. After Direct Half-Day Cutoff (e.g. 11:31 AM)
  if (punchMinutes > directHalfDayMinutes) {
    return {
      status: "Half Day",
      lateMarkCount: currentLateCount,
      isHalfDay: true,
      isLate: true,
      ruleTriggered: `Arrived after ${policy.directHalfDayAfter} -> Direct Half Day`,
    };
  }

  // 3. Between Grace and Direct Half Day -> Progressive Late Mark
  const newLateCount = currentLateCount + 1;
  const reachedThreshold = newLateCount >= policy.lateMarksBeforeHalfDay;

  return {
    status: reachedThreshold ? "Half Day" : "Late Punch",
    lateMarkCount: newLateCount,
    isHalfDay: reachedThreshold,
    isLate: true,
    ruleTriggered: reachedThreshold
      ? `Late Mark ${newLateCount} (Threshold ${policy.lateMarksBeforeHalfDay}) -> Converted to Half Day`
      : `Late Mark ${newLateCount} (Arrived after ${policy.lateStartsAfter})`,
  };
}
