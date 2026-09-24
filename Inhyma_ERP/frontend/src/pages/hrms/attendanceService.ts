/**
 * HRMS Attendance API Service.
 *
 * Backend integration for real persistent attendance records:
 * - GET /hrms/attendance/today
 * - GET /hrms/attendance/month?month=YYYY-MM
 * - GET /hrms/locations/assigned
 * - POST /hrms/attendance/punch-in
 * - POST /hrms/attendance/punch-out
 * - POST /hrms/regularizations
 */

import { apiGet, apiPost } from "@/lib/api";
import { AssignedOffice, TodayAttendanceResponse } from "./attendance";

export interface PunchInPayload {
  latitude: number;
  longitude: number;
  office_id?: string | null;
}

export interface PunchOutPayload {
  latitude?: number | null;
  longitude?: number | null;
}

export interface RegularizeRequestPayload {
  attendance_date: string;
  check_in: string;
  check_out: string;
  total_hours: string;
  reason: string;
  remarks?: string;
}

export const attendanceService = {
  /**
   * Fetches today's attendance state, current punch session, server time and shift.
   */
  async getTodayAttendance(): Promise<TodayAttendanceResponse | null> {
    try {
      const res = await apiGet<TodayAttendanceResponse>("/hrms/attendance/today");
      return res?.data || null;
    } catch (err) {
      console.warn("attendanceService: getTodayAttendance error", err);
      return null;
    }
  },

  /**
   * Fetches calendar month attendance records from PostgreSQL database.
   */
  async getMonthAttendance(monthStr: string): Promise<any[]> {
    try {
      const res = await apiGet<any[]>(`/hrms/attendance/month?month=${encodeURIComponent(monthStr)}`);
      return Array.isArray(res?.data) ? res.data : [];
    } catch (err) {
      console.warn("attendanceService: getMonthAttendance error", err);
      return [];
    }
  },

  /**
   * Fetches employee's assigned office geofence card (Inhyma Thane Office).
   */
  async getAssignedLocation(): Promise<AssignedOffice | null> {
    try {
      const res = await apiGet<AssignedOffice>("/hrms/locations/assigned");
      if (res?.data && res.data.name) {
        return res.data;
      }
      return null;
    } catch (err) {
      console.warn("attendanceService: getAssignedLocation error", err);
      return null;
    }
  },

  /**
   * Records employee Punch In against assigned geofence coordinates.
   */
  async punchIn(payload: PunchInPayload): Promise<any> {
    const res = await apiPost<any>("/hrms/attendance/punch-in", payload);
    return res?.data;
  },

  /**
   * Records employee Punch Out.
   */
  async punchOut(payload?: PunchOutPayload): Promise<any> {
    const res = await apiPost<any>("/hrms/attendance/punch-out", payload || {});
    return res?.data;
  },

  /**
   * Submits regularize request to manager approval queue.
   */
  async submitRegularize(payload: RegularizeRequestPayload): Promise<any> {
    const res = await apiPost<any>("/hrms/regularizations", payload);
    return res?.data;
  },
};
