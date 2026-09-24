import { describe, it, expect } from "vitest";
import {
  DEFAULT_ATTENDANCE_POLICY,
  evaluatePunchTime,
  parseTimeToMinutes,
} from "../attendancePolicy";

describe("Attendance Policy Engine", () => {
  it("parses various time formats to minutes accurately", () => {
    expect(parseTimeToMinutes("10:30 AM")).toBe(630);
    expect(parseTimeToMinutes("10:45 AM")).toBe(645);
    expect(parseTimeToMinutes("11:30 AM")).toBe(690);
    expect(parseTimeToMinutes("07:00 PM")).toBe(1140);
  });

  it("verifies the exact policy table from specifications", () => {
    // 10:32 -> Present
    const r1 = evaluatePunchTime("10:32 AM", DEFAULT_ATTENDANCE_POLICY, 0);
    expect(r1.status).toBe("Present");
    expect(r1.isLate).toBe(false);
    expect(r1.isHalfDay).toBe(false);

    // 10:44 -> Present
    const r2 = evaluatePunchTime("10:44 AM", DEFAULT_ATTENDANCE_POLICY, 0);
    expect(r2.status).toBe("Present");
    expect(r2.isLate).toBe(false);
    expect(r2.isHalfDay).toBe(false);

    // 10:46 -> Late Mark 1
    const r3 = evaluatePunchTime("10:46 AM", DEFAULT_ATTENDANCE_POLICY, 0);
    expect(r3.status).toBe("Late Punch");
    expect(r3.lateMarkCount).toBe(1);
    expect(r3.isHalfDay).toBe(false);

    // 10:50 -> Late Mark 2
    const r4 = evaluatePunchTime("10:50 AM", DEFAULT_ATTENDANCE_POLICY, 1);
    expect(r4.status).toBe("Late Punch");
    expect(r4.lateMarkCount).toBe(2);
    expect(r4.isHalfDay).toBe(false);

    // 10:55 -> Late Mark 3 -> Half Day
    const r5 = evaluatePunchTime("10:55 AM", DEFAULT_ATTENDANCE_POLICY, 2);
    expect(r5.status).toBe("Half Day");
    expect(r5.lateMarkCount).toBe(3);
    expect(r5.isHalfDay).toBe(true);

    // 11:31 -> Direct Half Day
    const r6 = evaluatePunchTime("11:31 AM", DEFAULT_ATTENDANCE_POLICY, 0);
    expect(r6.status).toBe("Half Day");
    expect(r6.isHalfDay).toBe(true);
    expect(r6.ruleTriggered).toContain("Direct Half Day");
  });

  it("respects customized policy thresholds set by Admin", () => {
    const customPolicy = {
      ...DEFAULT_ATTENDANCE_POLICY,
      graceUntil: "09:15 AM",
      directHalfDayAfter: "10:00 AM",
      lateMarksBeforeHalfDay: 2,
    };

    // 09:14 AM is Present
    expect(evaluatePunchTime("09:14 AM", customPolicy).status).toBe("Present");

    // 09:20 AM with 1 prior late mark becomes Half Day
    const res = evaluatePunchTime("09:20 AM", customPolicy, 1);
    expect(res.status).toBe("Half Day");
    expect(res.lateMarkCount).toBe(2);

    // 10:05 AM is direct Half Day
    expect(evaluatePunchTime("10:05 AM", customPolicy).status).toBe("Half Day");
  });
});
