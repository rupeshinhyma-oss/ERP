import { useState, useEffect, useCallback, useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { IconClock, IconCalendar, IconCheckSquare, IconSettings } from "@/components/icons";
import { apiGet, apiPost, apiPatch, apiPut } from "@/lib/api";
import { useAuth } from "@/lib/hooks";
import "./hrms.css";

// ---------------------------------------------------------------------------
// TypeScript Interfaces
// ---------------------------------------------------------------------------
interface AttendancePolicy {
  id: string;
  shift_name: string;
  shift_start_time: string;
  shift_end_time: string;
  weekly_off: string;
  payroll_cycle: string;
  geofence_radius_meters: number;

  enable_grace: boolean;
  grace_period_minutes: number;
  grace_end_time: string;

  enable_late_marks: boolean;
  late_start_time: string;
  count_late_monthly: boolean;
  monthly_late_limit: number;
  third_late_action: string;

  enable_direct_half_day: boolean;
  direct_half_day_time: string;
  half_day_threshold_minutes: number;

  enable_early_exit: boolean;
  early_exit_buffer_minutes: number;
  mark_early_exit: boolean;
  auto_regularization_early_exit: boolean;

  missing_punch_out: boolean;
  missing_punch_in: boolean;
  auto_mark_irregular: boolean;
  require_regularization: boolean;

  consecutive_late_warning: boolean;
  auto_email_notification: boolean;
  auto_manager_notification: boolean;
  holiday_overtime: boolean;
  weekend_overtime: boolean;
  flexible_shift: boolean;
  grace_extension: boolean;
}

interface AssignedOffice {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
}

interface AttendanceRecord {
  id: string;
  employee_id: string;
  attendance_date: string;
  punch_in: string | null;
  punch_out: string | null;
  status: string;
  working_minutes: number;
  late_minutes: number;
  early_exit_minutes: number;
  office_location_id: string | null;
  office_name: string | null;
  latitude: number | null;
  longitude: number | null;
  punch_in_distance: number | null;
  punch_out_distance: number | null;
  is_irregular: boolean;
  regularization_status: string;
  regularization_reason?: string | null;
  regularization_note?: string | null;
  can_regularize: boolean;
}

interface CalendarDay {
  date: string;
  day_number: number;
  day_name: string;
  status: string;
  punch_in: string | null;
  punch_out: string | null;
  working_minutes: number | null;
  late_minutes: number;
  early_exit_minutes: number;
  is_irregular: boolean;
  regularization_status: string;
  can_regularize: boolean;
  attendance_id: string | null;
}

interface RegularizationItem {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_email?: string | null;
  attendance_record_id?: string | null;
  attendance_date: string;
  request_type: string;
  reason: string;
  notes?: string | null;
  punch_in?: string | null;
  punch_out?: string | null;
  punch_in_time?: string | null;
  punch_out_time?: string | null;
  total_hours?: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  regularization_status?: string | null;
  regularization_reason?: string | null;
  submitted_at: string;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  reviewed_by_name?: string | null;
  manager_remarks?: string | null;
  action_taken?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers: Timing Formats and Computations
// ---------------------------------------------------------------------------
function formatTime12h(timeStr: string): string {
  if (!timeStr) return "—";
  const parts = timeStr.trim().split(":");
  if (parts.length < 2) return timeStr;
  let h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return timeStr;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

function convertTo24h(timeStr: string): string {
  if (!timeStr) return "10:30";
  const clean = timeStr.trim();
  const match = clean.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return clean.slice(0, 5);
  let h = parseInt(match[1], 10);
  const m = match[2];
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === "PM" && h < 12) h += 12;
  if (meridiem === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m}`;
}

function calculateGraceAndLateTimings(shiftStart: string, graceMins: number) {
  try {
    const [shStr, smStr] = (shiftStart || "10:30").split(":");
    const sh = parseInt(shStr, 10);
    const sm = parseInt(smStr, 10);
    if (isNaN(sh) || isNaN(sm)) return { graceEnd: "10:45", lateStart: "10:46" };
    const total = sh * 60 + sm + (graceMins || 0);
    const geh = Math.floor(total / 60) % 24;
    const gem = total % 60;
    const lTotal = total + 1;
    const lsh = Math.floor(lTotal / 60) % 24;
    const lsm = lTotal % 60;
    return {
      graceEnd: `${String(geh).padStart(2, "0")}:${String(gem).padStart(2, "0")}`,
      lateStart: `${String(lsh).padStart(2, "0")}:${String(lsm).padStart(2, "0")}`,
    };
  } catch {
    return { graceEnd: "10:45", lateStart: "10:46" };
  }
}

function calculateTotalHoursLive(inTime: string, outTime: string): string {
  if (!inTime || !outTime) return "—";
  const parseMins = (t: string): number | null => {
    if (!t) return null;
    const clean = t.trim();
    const match = clean.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
    if (!match) return null;
    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const meridiem = match[3]?.toUpperCase();
    if (meridiem === "PM" && h < 12) h += 12;
    if (meridiem === "AM" && h === 12) h = 0;
    return h * 60 + m;
  };

  const inMins = parseMins(inTime);
  const outMins = parseMins(outTime);
  if (inMins === null || outMins === null || outMins <= inMins) {
    return "—";
  }
  const diff = outMins - inMins;
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;
  return `${hours}h${String(mins).padStart(2, "0")}m`;
}

// ---------------------------------------------------------------------------
// Haversine Distance Calculation (Client-side mirror of backend)
// ---------------------------------------------------------------------------
function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Radius of Earth in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Format duration in seconds to HH:MM:SS
function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// AttendancePage Component
// ---------------------------------------------------------------------------
export function AttendancePage() {
  const [activeTab, setActiveTab] = useState<"view" | "approval" | "settings">("view");
  const [settingsSubTab, setSettingsSubTab] = useState<"policy" | "exemption" | "overtime">("policy");

  // Auth context for Admin vs Employee actions
  const { profile, isSuperAdmin, hasPermission } = useAuth();
  const isAdmin = Boolean(
    isSuperAdmin ||
    hasPermission("hrms:admin") ||
    hasPermission("hrms:approval") ||
    profile?.role === "ADMIN" ||
    profile?.username === "admin"
  );

  // Master data
  const [policy, setPolicy] = useState<AttendancePolicy | null>(null);
  const [office, setOffice] = useState<AssignedOffice | null>(null);
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);
  const [regularizations, setRegularizations] = useState<RegularizationItem[]>([]);

  // Policy Engine State (Part 1, 2, 3)
  const [policyForm, setPolicyForm] = useState<AttendancePolicy>({
    id: "",
    shift_name: "General Shift",
    shift_start_time: "10:30",
    shift_end_time: "19:00",
    weekly_off: "Sunday",
    payroll_cycle: "1st–End of Month",
    geofence_radius_meters: 150,
    enable_grace: true,
    grace_period_minutes: 15,
    grace_end_time: "10:45",
    enable_late_marks: true,
    late_start_time: "10:46",
    count_late_monthly: true,
    monthly_late_limit: 3,
    third_late_action: "Half Day",
    enable_direct_half_day: true,
    direct_half_day_time: "11:31",
    half_day_threshold_minutes: 61,
    enable_early_exit: true,
    early_exit_buffer_minutes: 15,
    mark_early_exit: true,
    auto_regularization_early_exit: true,
    missing_punch_out: true,
    missing_punch_in: true,
    auto_mark_irregular: true,
    require_regularization: true,
    consecutive_late_warning: false,
    auto_email_notification: false,
    auto_manager_notification: false,
    holiday_overtime: false,
    weekend_overtime: false,
    flexible_shift: false,
    grace_extension: false,
  });
  const [policySaving, setPolicySaving] = useState<boolean>(false);
  const [advancedExpanded, setAdvancedExpanded] = useState<boolean>(false);

  // Calendar year & month navigation
  const [selectedYear, setSelectedYear] = useState<number>(() => new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(() => new Date().getMonth() + 1);

  // Live timer tick (updates every 1 second)
  const [now, setNow] = useState<Date>(() => new Date());

  // GPS & Location Simulator State
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<"searching" | "connected" | "denied" | "simulated">("searching");
  const [simulatorMode, setSimulatorMode] = useState<"real" | "inside" | "edge" | "outside">("real");

  // UI States
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [alert, setAlert] = useState<{ type: "success" | "error" | "warning"; message: string } | null>(null);

  // One-Day Regularization Drawer State
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [selectedDayForReg, setSelectedDayForReg] = useState<CalendarDay | null>(null);
  const [regRequestType, setRegRequestType] = useState<string>("LATE_PUNCH");
  const [regReason, setRegReason] = useState<string>("Traffic Delay");
  const [regNote, setRegNote] = useState<string>("");
  const [regPunchIn, setRegPunchIn] = useState<string>("10:30");
  const [regPunchOut, setRegPunchOut] = useState<string>("19:00");
  const [regSubmitting, setRegSubmitting] = useState<boolean>(false);

  // Approval Manager Remarks Modal State (Part 6)
  const [approvalModal, setApprovalModal] = useState<{
    isOpen: boolean;
    item: RegularizationItem | null;
    action: "APPROVE" | "REJECT_LOP" | "ADJUST_LEAVE";
    remarks: string;
  } | null>(null);

  // Auto-calculated Grace End and Late Starts
  const computedTimings = useMemo(() => {
    return calculateGraceAndLateTimings(policyForm.shift_start_time, policyForm.grace_period_minutes);
  }, [policyForm.shift_start_time, policyForm.grace_period_minutes]);

  // 1. Digital Clock Interval (1s)
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 2. Fetch Regularizations (Persistent requests)
  const loadRegularizations = useCallback(async () => {
    try {
      const res = await apiGet<RegularizationItem[]>("/hrms/attendance/regularizations");
      if (res?.data) {
        setRegularizations(res.data);
      }
    } catch (err) {
      console.error("Failed to load attendance regularizations", err);
    }
  }, []);

  // 3. Fetch Initial Data (Policy, Assigned Office, Today's Record, Regularizations)
  const loadInitialData = useCallback(async () => {
    try {
      const [policyRes, officeRes, todayRes] = await Promise.all([
        apiGet<AttendancePolicy>("/hrms/attendance/policy"),
        apiGet<AssignedOffice>("/hrms/attendance/assigned-office"),
        apiGet<AttendanceRecord | null>("/hrms/attendance/today"),
      ]);

      if (policyRes?.data) {
        setPolicy(policyRes.data);
        setPolicyForm({
          ...policyRes.data,
          shift_start_time: convertTo24h(policyRes.data.shift_start_time || "10:30"),
          shift_end_time: convertTo24h(policyRes.data.shift_end_time || "19:00"),
          direct_half_day_time: convertTo24h(policyRes.data.direct_half_day_time || "11:31"),
        });
      }
      if (officeRes?.data) {
        setOffice(officeRes.data);
        if (!coords) {
          setCoords({ lat: officeRes.data.latitude, lng: officeRes.data.longitude });
          setGpsStatus("connected");
        }
      }
      if (todayRes?.data) {
        setTodayRecord(todayRes.data);
      }
      await loadRegularizations();
    } catch (err: any) {
      console.error("Failed to load attendance initial data", err);
    }
  }, [coords, loadRegularizations]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (activeTab === "approval") {
      loadRegularizations();
    }
  }, [activeTab, loadRegularizations]);

  // 3. Fetch Calendar Days
  const loadCalendar = useCallback(async (year: number, month: number) => {
    try {
      const res = await apiGet<CalendarDay[]>(`/hrms/attendance/calendar?year=${year}&month=${month}`);
      if (res?.data) {
        setCalendarDays(res.data);
      }
    } catch (err) {
      console.error("Failed to fetch attendance calendar", err);
    }
  }, []);

  useEffect(() => {
    loadCalendar(selectedYear, selectedMonth);
  }, [selectedYear, selectedMonth, loadCalendar]);

  // 4. Geolocation Acquisition
  const requestRealGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsStatus("denied");
      setAlert({
        type: "warning",
        message: "Geolocation is not supported by your browser.",
      });
      return;
    }

    setGpsStatus("searching");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsStatus("connected");
        setSimulatorMode("real");
        setAlert(null);
      },
      (err) => {
        console.warn("GPS error", err);
        setGpsStatus("denied");
        setAlert({
          type: "warning",
          message: "Location permission denied. Please allow GPS access in your browser or use the testing simulator.",
        });
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  // Simulator Presets
  const applySimulator = (mode: "inside" | "edge" | "outside") => {
    if (!office) return;
    setSimulatorMode(mode);
    setGpsStatus("simulated");

    if (mode === "inside") {
      setCoords({ lat: office.latitude, lng: office.longitude });
      setAlert({ type: "success", message: "Simulator set: Inside radius (0–10m from office)." });
    } else if (mode === "edge") {
      setCoords({ lat: office.latitude + 0.0012, lng: office.longitude });
      setAlert({ type: "warning", message: "Simulator set: Edge of radius (~135m from office)." });
    } else if (mode === "outside") {
      setCoords({ lat: office.latitude + 0.0045, lng: office.longitude });
      setAlert({ type: "error", message: "Simulator set: Outside radius (~500m from office)." });
    }
  };

  // 5. Distance and Geofence Status
  const currentDistance = useMemo(() => {
    if (!coords || !office) return null;
    return Math.round(calculateHaversineDistance(coords.lat, coords.lng, office.latitude, office.longitude));
  }, [coords, office]);

  const allowedRadius = office?.radius_meters || policy?.geofence_radius_meters || 150;
  const isInsideGeofence = currentDistance !== null && currentDistance <= allowedRadius;

  // 6. Live Working Timer Computation (Persists after refresh from DB timestamp)
  const liveWorkingSeconds = useMemo(() => {
    if (!todayRecord?.punch_in) return 0;
    if (todayRecord.punch_out) {
      const inTime = new Date(todayRecord.punch_in).getTime();
      const outTime = new Date(todayRecord.punch_out).getTime();
      return Math.max(0, Math.floor((outTime - inTime) / 1000));
    }
    const inTime = new Date(todayRecord.punch_in).getTime();
    return Math.max(0, Math.floor((now.getTime() - inTime) / 1000));
  }, [todayRecord, now]);

  // 7. Punch In Handler
  const handlePunchIn = async () => {
    if (!coords) {
      setAlert({ type: "error", message: "Please enable GPS or select a simulator preset before punching in." });
      return;
    }
    if (!isInsideGeofence) {
      setAlert({
        type: "error",
        message: `Outside Geofence: You are ${currentDistance}m from ${office?.name || "office"} (Allowed radius: ${allowedRadius}m). Punching is blocked.`,
      });
      return;
    }

    setActionLoading(true);
    setAlert(null);
    try {
      const res = await apiPost<AttendanceRecord>("/hrms/attendance/punch-in", {
        latitude: coords.lat,
        longitude: coords.lng,
      });
      if (res?.data) {
        setTodayRecord(res.data);
        setAlert({
          type: "success",
          message: `Punched in successfully! Status: ${res.data.status}. Working timer started.`,
        });
        loadCalendar(selectedYear, selectedMonth);
      }
    } catch (err: any) {
      const msg = err?.message || "Failed to punch in. Please try again.";
      setAlert({ type: "error", message: msg });
    } finally {
      setActionLoading(false);
    }
  };

  // 8. Punch Out Handler
  const handlePunchOut = async () => {
    if (!coords) {
      setAlert({ type: "error", message: "Please enable GPS before punching out." });
      return;
    }

    setActionLoading(true);
    setAlert(null);
    try {
      const res = await apiPost<AttendanceRecord>("/hrms/attendance/punch-out", {
        latitude: coords.lat,
        longitude: coords.lng,
      });
      if (res?.data) {
        setTodayRecord(res.data);
        setAlert({
          type: "success",
          message: `Punched out successfully! Total working time: ${res.data.working_minutes} minutes. Attendance locked for today.`,
        });
        loadCalendar(selectedYear, selectedMonth);
      }
    } catch (err: any) {
      const msg = err?.message || "Failed to punch out.";
      setAlert({ type: "error", message: msg });
    } finally {
      setActionLoading(false);
    }
  };

  // 9. Regularization Drawer Trigger
  const handleOpenRegularization = (day: CalendarDay) => {
    const isNeverEditable =
      day.status === "WEEKEND" ||
      day.status === "HOLIDAY" ||
      day.status === "SCHEDULED" ||
      day.status === "ON_LEAVE" ||
      day.regularization_status === "APPROVED" ||
      (day.status === "PRESENT" && !day.is_irregular && day.regularization_status !== "PENDING");

    if (isNeverEditable) {
      return;
    }

    setSelectedDayForReg(day);
    setRegPunchIn(day.punch_in ? convertTo24h(day.punch_in) : convertTo24h(policyForm.shift_start_time || "10:30"));
    setRegPunchOut(day.punch_out ? convertTo24h(day.punch_out) : convertTo24h(policyForm.shift_end_time || "19:00"));

    if (day.status === "MISSING_PUNCH") {
      setRegRequestType("MISSING_PUNCH");
      setRegReason("GPS Issue");
    } else if (day.status === "LATE" || day.status === "HALF_DAY") {
      setRegRequestType("LATE_PUNCH");
      setRegReason("Traffic Delay");
    } else {
      setRegRequestType("LATE_PUNCH");
      setRegReason("Traffic Delay");
    }
    setRegNote("");
    setDrawerOpen(true);
  };

  const handleSubmitRegularization = async (e: React.FormEvent, isDirect = false) => {
    e.preventDefault();
    if (!selectedDayForReg) return;

    if (!regNote.trim() && !isDirect) {
      setAlert({ type: "error", message: "Remarks are required for attendance regularization." });
      return;
    }

    setRegSubmitting(true);
    try {
      const liveHours = calculateTotalHoursLive(regPunchIn, regPunchOut);
      const finalNote = regNote.trim() || (isDirect ? "Direct Regularization by Admin" : "Attendance Regularization");
      const payload: Record<string, any> = {
        attendance_id: selectedDayForReg.attendance_id,
        date: selectedDayForReg.date,
        reason: regReason,
        note: finalNote,
        notes: finalNote,
        punch_in: formatTime12h(regPunchIn),
        punch_out: formatTime12h(regPunchOut),
        punch_in_time: formatTime12h(regPunchIn),
        punch_out_time: formatTime12h(regPunchOut),
        total_hours: liveHours !== "—" ? liveHours : undefined,
      };

      if (regRequestType && regRequestType !== "LATE_PUNCH") {
        payload.request_type = regRequestType;
      }
      if (isDirect) {
        payload.direct_regularize = true;
      }

      const res = await apiPost<any>("/hrms/attendance/regularization", payload);

      if (res?.data) {
        setAlert({
          type: "success",
          message: isDirect
            ? `Attendance for ${selectedDayForReg.date} regularized directly.`
            : `Regularization request for ${selectedDayForReg.date} submitted successfully (Status: PENDING).`,
        });
        setDrawerOpen(false);
        await Promise.all([
          loadCalendar(selectedYear, selectedMonth),
          loadRegularizations(),
          apiGet<AttendanceRecord | null>("/hrms/attendance/today").then((r) => r?.data && setTodayRecord(r.data)),
        ]);
      }
    } catch (err: any) {
      setAlert({ type: "error", message: err?.message || "Failed to submit regularization request." });
    } finally {
      setRegSubmitting(false);
    }
  };

  const handleApproveRequest = async (id: string, customRemarks = "Approved by Supervisor") => {
    setActionLoading(true);
    try {
      await apiPatch(`/hrms/attendance/regularizations/${id}/approve`, {
        action: "APPROVE",
        manager_remarks: customRemarks,
      });
      setAlert({ type: "success", message: "Regularization request approved successfully." });
      await Promise.all([
        loadRegularizations(),
        loadCalendar(selectedYear, selectedMonth),
        apiGet<AttendanceRecord | null>("/hrms/attendance/today").then((r) => r?.data && setTodayRecord(r.data)),
      ]);
    } catch (err: any) {
      setAlert({ type: "error", message: err?.message || "Failed to approve regularization." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectRequest = async (id: string, customRemarks = "Rejected (Mark LOP)") => {
    setActionLoading(true);
    try {
      await apiPatch(`/hrms/attendance/regularizations/${id}/reject`, {
        action: "REJECT_LOP",
        manager_remarks: customRemarks,
      });
      setAlert({ type: "warning", message: "Regularization request rejected and marked LOP." });
      await Promise.all([
        loadRegularizations(),
        loadCalendar(selectedYear, selectedMonth),
        apiGet<AttendanceRecord | null>("/hrms/attendance/today").then((r) => r?.data && setTodayRecord(r.data)),
      ]);
    } catch (err: any) {
      setAlert({ type: "error", message: err?.message || "Failed to reject regularization." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleAdjustLeaveRequest = async (id: string, customRemarks = "Adjusted Against Leave Balance") => {
    setActionLoading(true);
    try {
      await apiPatch(`/hrms/attendance/regularizations/${id}/approve`, {
        action: "ADJUST_LEAVE",
        manager_remarks: customRemarks,
      });
      setAlert({ type: "success", message: "Regularization adjusted against employee leave balance." });
      await Promise.all([
        loadRegularizations(),
        loadCalendar(selectedYear, selectedMonth),
        apiGet<AttendanceRecord | null>("/hrms/attendance/today").then((r) => r?.data && setTodayRecord(r.data)),
      ]);
    } catch (err: any) {
      setAlert({ type: "error", message: err?.message || "Failed to adjust regularization against leave." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmApprovalAction = async () => {
    if (!approvalModal || !approvalModal.item) return;
    const { item, action, remarks } = approvalModal;
    if (action === "APPROVE") {
      await handleApproveRequest(item.id, remarks);
    } else if (action === "REJECT_LOP") {
      await handleRejectRequest(item.id, remarks);
    } else if (action === "ADJUST_LEAVE") {
      await handleAdjustLeaveRequest(item.id, remarks);
    }
    setApprovalModal(null);
  };

  const handleSavePolicy = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setPolicySaving(true);
    try {
      const payload = {
        ...policyForm,
        grace_end_time: computedTimings.graceEnd,
        late_start_time: computedTimings.lateStart,
        geofence_radius_meters: Number(policyForm.geofence_radius_meters) || 150,
        grace_period_minutes: Number(policyForm.grace_period_minutes) || 15,
        early_exit_buffer_minutes: Number(policyForm.early_exit_buffer_minutes) || 15,
        monthly_late_limit: Number(policyForm.monthly_late_limit) || 3,
      };
      const res = await apiPut<AttendancePolicy>("/hrms/attendance/policy", payload);
      if (res?.data) {
        setPolicy(res.data);
        setPolicyForm({
          ...res.data,
          shift_start_time: convertTo24h(res.data.shift_start_time || "10:30"),
          shift_end_time: convertTo24h(res.data.shift_end_time || "19:00"),
          direct_half_day_time: convertTo24h(res.data.direct_half_day_time || "11:31"),
        });
        setAlert({
          type: "success",
          message: "Attendance Policy saved successfully to PostgreSQL. Rules updated for company.",
        });
        loadCalendar(selectedYear, selectedMonth);
      }
    } catch (err: any) {
      setAlert({ type: "error", message: err?.message || "Failed to save attendance policy." });
    } finally {
      setPolicySaving(false);
    }
  };

  // Calendar month change
  const handlePrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedYear((y) => y - 1);
      setSelectedMonth(12);
    } else {
      setSelectedMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedYear((y) => y + 1);
      setSelectedMonth(1);
    } else {
      setSelectedMonth((m) => m + 1);
    }
  };

  const handleCurrentMonth = () => {
    const today = new Date();
    setSelectedYear(today.getFullYear());
    setSelectedMonth(today.getMonth() + 1);
  };

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  return (
    <AppShell activeKey="hrms-attendance">
      <main className="page" style={{ paddingBottom: 60 }}>
        <Breadcrumb trail={["HRMS", "Attendance"]} />

        <div className="page-header">
          <div>
            <h1>Attendance</h1>
            <div className="page-subtitle">
              Enterprise punch tracking, geofence verification, calendar, and regularization.
            </div>
          </div>
        </div>

        {/* Screen Tabs (Preserved from Day 1 Foundation) */}
        <div className="hrms-tabs-nav">
          <button
            type="button"
            className={`hrms-tab-btn ${activeTab === "view" ? "active" : ""}`}
            onClick={() => setActiveTab("view")}
          >
            <IconCalendar />
            <span>View</span>
          </button>
          <button
            type="button"
            className={`hrms-tab-btn ${activeTab === "approval" ? "active" : ""}`}
            onClick={() => setActiveTab("approval")}
          >
            <IconCheckSquare />
            <span>Approval</span>
          </button>
          <button
            type="button"
            className={`hrms-tab-btn ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            <IconSettings />
            <span>Settings</span>
          </button>
        </div>

        {/* View Tab (Day 3 Complete Employee Attendance Dashboard) */}
        {activeTab === "view" && (
          <div className="hrms-tab-content">
            {/* Global Alert Notification */}
            {alert && (
              <div
                className={`hrms-badge ${
                  alert.type === "success"
                    ? "hrms-badge-success"
                    : alert.type === "error"
                    ? "hrms-badge-danger"
                    : "hrms-badge-warning"
                }`}
                style={{
                  padding: "12px 18px",
                  borderRadius: "8px",
                  fontSize: "13.5px",
                  marginBottom: "16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                }}
              >
                <span>{alert.message}</span>
                <button
                  type="button"
                  onClick={() => setAlert(null)}
                  style={{ background: "none", border: "none", cursor: "pointer", fontWeight: "bold" }}
                >
                  ✕
                </button>
              </div>
            )}

            <div className="hrms-attendance-container">
              {/* ================================================================
                  ORDER 1–4: Today's Date, Current Time, Assigned Office, GPS Status
                  ================================================================ */}
              <div className="hrms-top-status-bar">
                <div className="hrms-time-date-group">
                  {/* Order 1: Today's Date */}
                  <div className="hrms-date-chip">
                    <span className="hrms-date-chip-label">Today's Date</span>
                    <span className="hrms-date-chip-value">
                      {now.toLocaleDateString("en-IN", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>

                  {/* Order 2: Current Time */}
                  <div className="hrms-live-clock" title="Live System Time (IST)">
                    <span className="hrms-clock-pulse" />
                    <span>
                      {now.toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                        hour12: true,
                      })}
                    </span>
                  </div>
                </div>

                <div className="hrms-office-gps-group">
                  {/* Order 3: Assigned Office */}
                  <div className="hrms-office-pill" title="Assigned Office Location">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    <span>{office ? office.name : "Inhyma Thane Office"}</span>
                    <span style={{ opacity: 0.7, fontSize: "11px" }}>({allowedRadius}m radius)</span>
                  </div>

                  {/* Order 4: GPS Status */}
                  <div
                    className={`hrms-gps-pill ${
                      gpsStatus === "denied"
                        ? "denied"
                        : isInsideGeofence
                        ? "inside"
                        : "outside"
                    }`}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <circle cx="12" cy="12" r="4" />
                      <line x1="12" y1="2" x2="12" y2="4" />
                      <line x1="12" y1="20" x2="12" y2="22" />
                      <line x1="2" y1="12" x2="4" y2="12" />
                      <line x1="20" y1="12" x2="22" y2="12" />
                    </svg>
                    <span>
                      {gpsStatus === "denied"
                        ? "GPS Denied"
                        : currentDistance !== null
                        ? isInsideGeofence
                          ? `Inside (${currentDistance}m)`
                          : `Outside (${currentDistance}m)`
                        : "Acquiring GPS..."}
                    </span>
                    {simulatorMode !== "real" && (
                      <span style={{ fontSize: "10px", background: "#f59e0b", color: "#fff", padding: "1px 5px", borderRadius: 4 }}>
                        Simulated
                      </span>
                    )}
                  </div>

                  {/* Refresh / Retry Location Button */}
                  <button
                    type="button"
                    className="hrms-cal-nav-btn"
                    onClick={requestRealGps}
                    title="Refresh Real Device GPS"
                    style={{ padding: "6px 10px" }}
                  >
                    🔄 Refresh GPS
                  </button>
                </div>
              </div>

              {/* ================================================================
                  Location Simulator (Admin / Testing Requirement)
                  ================================================================ */}
              <div className="hrms-simulator-panel">
                <div className="hrms-simulator-header">
                  <div className="hrms-simulator-title">
                    <span>🧪 Testing Location Simulator</span>
                    <span style={{ fontSize: "11px", fontWeight: "normal", color: "#92400e" }}>
                      (QA Tool — Test attendance geofencing without physical movement)
                    </span>
                  </div>
                  <div className="hrms-simulator-actions">
                    <button
                      type="button"
                      className={`hrms-sim-btn ${simulatorMode === "inside" ? "active" : ""}`}
                      onClick={() => applySimulator("inside")}
                    >
                      📍 Inside (10m)
                    </button>
                    <button
                      type="button"
                      className={`hrms-sim-btn ${simulatorMode === "edge" ? "active" : ""}`}
                      onClick={() => applySimulator("edge")}
                    >
                      ⚠️ Edge (135m)
                    </button>
                    <button
                      type="button"
                      className={`hrms-sim-btn ${simulatorMode === "outside" ? "active" : ""}`}
                      onClick={() => applySimulator("outside")}
                    >
                      🚫 Outside (500m)
                    </button>
                    <button
                      type="button"
                      className={`hrms-sim-btn ${simulatorMode === "real" ? "active" : ""}`}
                      onClick={requestRealGps}
                    >
                      📡 Real GPS
                    </button>
                  </div>
                </div>
                {coords && (
                  <div className="hrms-simulator-status">
                    Coordinates: <strong>{coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}</strong> | Distance to Office:{" "}
                    <strong>{currentDistance ?? "—"} meters</strong> (Allowed: {allowedRadius}m)
                  </div>
                )}
              </div>

              {/* ================================================================
                  ORDER 5 & 6: Punch Card & Live Working Timer
                  ================================================================ */}
              <div className="hrms-punch-container">
                {/* Order 5: Punch Card */}
                <div className="hrms-punch-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <h2 className="hrms-section-title">Punch Card Container</h2>
                      <div className="hrms-section-desc">
                        {!todayRecord?.punch_in
                          ? "Punch functionality will be available here."
                          : !todayRecord?.punch_out
                          ? `Session started at ${new Date(todayRecord.punch_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                          : `Punched out at ${new Date(todayRecord.punch_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                      </div>
                    </div>

                    {todayRecord?.status && (
                      <span
                        className={`hrms-cal-status-badge ${
                          todayRecord.status === "PRESENT"
                            ? "status-present"
                            : todayRecord.status === "LATE"
                            ? "status-late"
                            : "status-half-day"
                        }`}
                      >
                        {todayRecord.status}
                      </span>
                    )}
                  </div>

                  <div className="hrms-punch-hero">
                    {!todayRecord?.punch_in ? (
                      // Before Punch In
                      <>
                        <button
                          type="button"
                          className="hrms-punch-btn in"
                          onClick={handlePunchIn}
                          disabled={actionLoading || !isInsideGeofence}
                          title={
                            !isInsideGeofence
                              ? `Punch In blocked: You are outside the ${allowedRadius}m office geofence.`
                              : "Punch In for Today"
                          }
                          data-testid="punch-in-button"
                        >
                          <span className="hrms-punch-btn-icon">⏱️</span>
                          <span className="hrms-punch-btn-label">
                            {actionLoading ? "VERIFYING..." : "PUNCH IN"}
                          </span>
                        </button>

                        <div className="hrms-punch-distance-chip">
                          {isInsideGeofence ? (
                            <span style={{ color: "#059669" }}>
                              ✓ Inside Geofence ({currentDistance} m from office)
                            </span>
                          ) : (
                            <span style={{ color: "#dc2626" }}>
                              ✕ Outside Geofence ({currentDistance ?? "—"} m from office — {allowedRadius}m allowed)
                            </span>
                          )}
                        </div>
                      </>
                    ) : !todayRecord?.punch_out ? (
                      // After Punch In (Active session -> Punch Out button)
                      <>
                        <button
                          type="button"
                          className="hrms-punch-btn out"
                          onClick={handlePunchOut}
                          disabled={actionLoading}
                          title="Punch Out and Lock Attendance for Today"
                          data-testid="punch-out-button"
                        >
                          <span className="hrms-punch-btn-icon">🚪</span>
                          <span className="hrms-punch-btn-label">
                            {actionLoading ? "LOCKING..." : "PUNCH OUT"}
                          </span>
                        </button>

                        <div className="hrms-punch-distance-chip">
                          <span style={{ color: "#0f172a" }}>
                            Punched in at{" "}
                            {new Date(todayRecord.punch_in).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}{" "}
                            ({todayRecord.punch_in_distance ?? currentDistance}m from office)
                          </span>
                        </div>
                      </>
                    ) : (
                      // Completed Session
                      <div style={{ padding: "20px 0", textAlign: "center" }}>
                        <div style={{ fontSize: "48px", marginBottom: "8px" }}>✅</div>
                        <h3 style={{ fontSize: "18px", fontWeight: "bold", color: "#065f46" }}>
                          Attendance Locked for Today
                        </h3>
                        <p style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
                          Total logged: {todayRecord.working_minutes} minutes. No further punches permitted.
                        </p>
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: "12px", color: "#64748b", textAlign: "center" }}>
                    Shift Policy: 10:30 AM – 7:00 PM • Grace up to 10:45 AM • Half Day after 11:30 AM
                  </div>
                </div>

                {/* Order 6: Working Timer */}
                <div className="hrms-timer-card">
                  <div>
                    <div className="hrms-timer-label">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      <span>
                        {!todayRecord?.punch_in
                          ? "Estimated Shift Hours"
                          : !todayRecord?.punch_out
                          ? "Live Working Timer"
                          : "Total Working Time Today"}
                      </span>
                    </div>

                    {/* Big Live Monospace Timer */}
                    <div className="hrms-timer-digits" data-testid="live-working-timer">
                      {formatDuration(liveWorkingSeconds)}
                    </div>

                    <div className="hrms-timer-digits-sub">
                      <span>Hours</span>
                      <span>Minutes</span>
                      <span>Seconds</span>
                    </div>
                  </div>

                  <div className="hrms-timer-status-row">
                    <span style={{ fontSize: "12.5px", color: "#94a3b8" }}>Session Status</span>
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 700,
                        color: !todayRecord?.punch_in
                          ? "#94a3b8"
                          : !todayRecord?.punch_out
                          ? "#38bdf8"
                          : "#4ade80",
                        textTransform: "uppercase",
                      }}
                    >
                      {!todayRecord?.punch_in
                        ? "Not Started"
                        : !todayRecord?.punch_out
                        ? "In Progress • Active"
                        : "Completed"}
                    </span>
                  </div>
                </div>
              </div>

              {/* ================================================================
                  ORDER 7: Today's Summary Card (Read-only)
                  ================================================================ */}
              <div className="hrms-summary-grid">
                <div className="hrms-summary-item">
                  <span className="hrms-summary-label">Punch In</span>
                  <span className="hrms-summary-value">
                    {todayRecord?.punch_in
                      ? new Date(todayRecord.punch_in).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                      : "—"}
                  </span>
                </div>

                <div className="hrms-summary-item">
                  <span className="hrms-summary-label">Punch Out</span>
                  <span className="hrms-summary-value">
                    {todayRecord?.punch_out
                      ? new Date(todayRecord.punch_out).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                      : todayRecord?.punch_in
                      ? "In Progress"
                      : "—"}
                  </span>
                </div>

                <div className="hrms-summary-item">
                  <span className="hrms-summary-label">Working Hours</span>
                  <span className="hrms-summary-value">
                    {todayRecord?.punch_in
                      ? `${Math.floor(liveWorkingSeconds / 3600)}h ${Math.floor((liveWorkingSeconds % 3600) / 60)}m`
                      : "0h 0m"}
                  </span>
                </div>

                <div className="hrms-summary-item">
                  <span className="hrms-summary-label">Late Minutes</span>
                  <span className="hrms-summary-value" style={{ color: (todayRecord?.late_minutes || 0) > 0 ? "#b45309" : "inherit" }}>
                    {todayRecord?.late_minutes ? `${todayRecord.late_minutes} mins` : "0 mins"}
                  </span>
                </div>

                <div className="hrms-summary-item">
                  <span className="hrms-summary-label">Office Name</span>
                  <span className="hrms-summary-value" style={{ fontSize: "13.5px" }}>
                    {office?.name || "Inhyma Thane Office"}
                  </span>
                </div>

                <div className="hrms-summary-item">
                  <span className="hrms-summary-label">Geofence Status</span>
                  <span className="hrms-summary-value" style={{ fontSize: "13.5px" }}>
                    {isInsideGeofence ? "Verified Inside" : "Outside Zone"}
                  </span>
                </div>
              </div>

              {/* ================================================================
                  ORDER 8: Attendance Calendar Container (Monthly matrix & edit icon rules)
                  ================================================================ */}
              <div className="hrms-calendar-card">
                <div className="hrms-cal-header">
                  <div>
                    <h2 className="hrms-section-title">Monthly Calendar Container</h2>
                    <div className="hrms-section-desc">Attendance calendar will appear here.</div>
                  </div>

                  <div className="hrms-cal-nav">
                    <button type="button" className="hrms-cal-nav-btn" onClick={handlePrevMonth}>
                      ‹ Prev
                    </button>
                    <div className="hrms-cal-month-title">
                      {monthNames[selectedMonth - 1]} {selectedYear}
                    </div>
                    <button type="button" className="hrms-cal-nav-btn" onClick={handleNextMonth}>
                      Next ›
                    </button>
                    <button type="button" className="hrms-cal-nav-btn" onClick={handleCurrentMonth}>
                      Today
                    </button>
                  </div>

                  {/* Status Color Legend */}
                  <div className="hrms-cal-legend">
                    <div className="hrms-cal-legend-item">
                      <span className="hrms-cal-legend-dot" style={{ background: "#10b981" }} />
                      <span>Present</span>
                    </div>
                    <div className="hrms-cal-legend-item">
                      <span className="hrms-cal-legend-dot" style={{ background: "#f59e0b" }} />
                      <span>Late</span>
                    </div>
                    <div className="hrms-cal-legend-item">
                      <span className="hrms-cal-legend-dot" style={{ background: "#f97316" }} />
                      <span>Half Day</span>
                    </div>
                    <div className="hrms-cal-legend-item">
                      <span className="hrms-cal-legend-dot" style={{ background: "#ef4444" }} />
                      <span>Missing Punch</span>
                    </div>
                    <div className="hrms-cal-legend-item">
                      <span className="hrms-cal-legend-dot" style={{ background: "#94a3b8" }} />
                      <span>Weekend</span>
                    </div>
                    <div className="hrms-cal-legend-item">
                      <span className="hrms-cal-legend-dot" style={{ background: "#3b82f6" }} />
                      <span>Pending Reg</span>
                    </div>
                  </div>
                </div>

                {/* Calendar Days Matrix */}
                <div className="hrms-cal-grid">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
                    <div key={w} className="hrms-cal-weekday">
                      {w}
                    </div>
                  ))}

                  {calendarDays.map((day) => {
                    const isToday =
                      day.day_number === now.getDate() &&
                      selectedMonth === now.getMonth() + 1 &&
                      selectedYear === now.getFullYear();

                    const isWeekend = day.status === "WEEKEND";

                    // ==============================================================
                    // Part 9 — Calendar Rules:
                    // Show edit icon only for:
                    // Late, Half Day, Missing Punch, Outside Geofence (is_irregular),
                    // Pending Regularization.
                    // Never show for:
                    // Present, Holiday, Weekend, Future, Approved Leave.
                    // ==============================================================
                    const isNeverEditable =
                      day.status === "WEEKEND" ||
                      day.status === "HOLIDAY" ||
                      day.status === "SCHEDULED" ||
                      day.status === "ON_LEAVE" ||
                      day.regularization_status === "APPROVED" ||
                      (day.status === "PRESENT" && !day.is_irregular && day.regularization_status !== "PENDING");

                    const canEdit =
                      !isNeverEditable &&
                      (day.status === "LATE" ||
                        day.status === "HALF_DAY" ||
                        day.status === "MISSING_PUNCH" ||
                        day.is_irregular ||
                        day.regularization_status === "PENDING" ||
                        day.early_exit_minutes > 0 ||
                        day.can_regularize);

                    let badgeClass = "status-scheduled";
                    if (day.status === "PRESENT") badgeClass = "status-present";
                    else if (day.status === "LATE") badgeClass = "status-late";
                    else if (day.status === "HALF_DAY") badgeClass = "status-half-day";
                    else if (day.status === "MISSING_PUNCH") badgeClass = "status-missing-punch";
                    else if (day.status === "IN_PROGRESS") badgeClass = "status-in-progress";
                    else if (day.status === "WEEKEND") badgeClass = "status-weekend";

                    if (day.regularization_status === "PENDING") {
                      badgeClass = "status-pending";
                    }

                    return (
                      <div
                        key={day.date}
                        className={`hrms-cal-day ${isToday ? "today" : ""} ${isWeekend ? "weekend" : ""}`}
                        data-testid={`calendar-day-${day.date}`}
                      >
                        <div className="hrms-cal-day-top">
                          <span className="hrms-cal-day-num">{day.day_number}</span>
                          <span className={`hrms-cal-status-badge ${badgeClass}`}>
                            {day.regularization_status === "PENDING"
                              ? "Pending Regularization"
                              : day.regularization_status === "APPROVED"
                              ? "APPROVED"
                              : day.status}
                          </span>
                        </div>

                        <div className="hrms-cal-day-body">
                          {day.punch_in && <span>In: {day.punch_in}</span>}
                          {day.punch_out && <span>Out: {day.punch_out}</span>}
                          {day.late_minutes > 0 && (
                            <span style={{ color: "#d97706" }}>+{day.late_minutes}m late</span>
                          )}
                          {day.early_exit_minutes > 0 && (
                            <span style={{ color: "#b91c1c" }}>-{day.early_exit_minutes}m exit</span>
                          )}
                        </div>

                        <div className="hrms-cal-day-footer">
                          {canEdit ? (
                            <button
                              type="button"
                              className="hrms-cal-edit-btn"
                              onClick={() => handleOpenRegularization(day)}
                              title={day.regularization_status === "PENDING" ? "Regularization Pending Review" : "Request Attendance Regularization"}
                              data-testid={`regularize-btn-${day.date}`}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                              </svg>
                              <span>{day.regularization_status === "PENDING" ? "Pending" : "Regularize"}</span>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ================================================================
                One-day Regularization Drawer (Single Day Only)
                ================================================================ */}
            {drawerOpen && selectedDayForReg && (
              <div className="hrms-drawer-backdrop" onClick={() => setDrawerOpen(false)}>
                <div className="hrms-drawer" onClick={(e) => e.stopPropagation()} data-testid="regularization-drawer">
                  <div className="hrms-drawer-header">
                    <div>
                      <h3 className="hrms-drawer-title">One-Day Regularization</h3>
                      <div className="hrms-drawer-desc">
                        Submit correction for {selectedDayForReg.date}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="hrms-drawer-close"
                      onClick={() => setDrawerOpen(false)}
                    >
                      ✕
                    </button>
                  </div>

                  <form onSubmit={handleSubmitRegularization} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                    <div className="hrms-drawer-body">
                      {selectedDayForReg.regularization_status === "PENDING" && (
                        <div
                          style={{
                            background: "#fef3c7",
                            border: "1px solid #fde68a",
                            padding: "10px 14px",
                            borderRadius: "8px",
                            fontSize: "12.5px",
                            color: "#92400e",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <span style={{ fontSize: "16px" }}>⏳</span>
                          <div>
                            <strong>Pending Supervisor Review:</strong> A regularization request has already been submitted for this date.
                          </div>
                        </div>
                      )}

                      <div style={{ background: "#f8fafc", padding: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                        <div style={{ fontSize: "12px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>
                          Selected Day
                        </div>
                        <div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
                          {new Date(selectedDayForReg.date).toLocaleDateString("en-IN", {
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })}
                        </div>
                        <div style={{ fontSize: "13px", color: "#475569", marginTop: 4 }}>
                          Current Status: <strong>{selectedDayForReg.status}</strong>
                          {selectedDayForReg.late_minutes > 0 && ` (${selectedDayForReg.late_minutes}m late)`}
                          {selectedDayForReg.regularization_status === "PENDING" && " [Pending Regularization]"}
                        </div>
                      </div>

                      {/* Punch In and Punch Out Editable Times */}
                      <div className="hrms-fields-grid-2">
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Punch In Time *</label>
                          <input
                            type="time"
                            className="hrms-field-input"
                            value={regPunchIn}
                            onChange={(e) => setRegPunchIn(e.target.value)}
                            required
                            data-testid="regularization-punch-in-input"
                          />
                        </div>
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Punch Out Time *</label>
                          <input
                            type="time"
                            className="hrms-field-input"
                            value={regPunchOut}
                            onChange={(e) => setRegPunchOut(e.target.value)}
                            required
                            data-testid="regularization-punch-out-input"
                          />
                        </div>
                      </div>

                      {/* Total Hours Auto-Calculated */}
                      <div className="hrms-field-group">
                        <label className="hrms-field-label">Total Hours (Auto-Calculated)</label>
                        <div className="hrms-auto-badge" data-testid="regularization-total-hours">
                          ⏱ {calculateTotalHoursLive(regPunchIn, regPunchOut)}
                        </div>
                      </div>

                      {/* Reason Dropdown */}
                      <div className="hrms-field-group">
                        <label className="hrms-field-label">Reason *</label>
                        <select
                          className="hrms-field-input"
                          value={regReason}
                          onChange={(e) => setRegReason(e.target.value)}
                          required
                          data-testid="regularization-reason-select"
                        >
                          <option value="Traffic Delay">Traffic Delay</option>
                          <option value="Traffic / Transit Delay">Traffic / Transit Delay</option>
                          <option value="Client Meeting">Client Meeting</option>
                          <option value="Client Meeting / Field Work">Client Meeting / Field Work</option>
                          <option value="GPS Issue">GPS Issue</option>
                          <option value="Technical / GPS Glitch">Technical / GPS Glitch</option>
                          <option value="Work From Home">Work From Home</option>
                          <option value="Work From Home (Approved)">Work From Home (Approved)</option>
                          <option value="Medical Emergency">Medical Emergency</option>
                          <option value="Forgot to Punch Out">Forgot to Punch Out</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>

                      {/* Remarks (Required) */}
                      <div className="hrms-field-group">
                        <label className="hrms-field-label">
                          Remarks * <span style={{ color: "#ef4444" }}>(Required)</span>
                        </label>
                        <textarea
                          rows={3}
                          className="hrms-field-input"
                          value={regNote}
                          onChange={(e) => setRegNote(e.target.value)}
                          placeholder="Provide explanation and remarks for the regularization (Mandatory)..."
                          required
                          data-testid="regularization-note-input"
                        />
                      </div>
                    </div>

                    <div className="hrms-drawer-footer">
                      <button
                        type="button"
                        className="hrms-cal-nav-btn"
                        onClick={() => setDrawerOpen(false)}
                        disabled={regSubmitting}
                      >
                        Cancel
                      </button>
                      {isAdmin ? (
                        <>
                          <button
                            type="button"
                            className="hrms-cal-nav-btn"
                            disabled={regSubmitting || selectedDayForReg.regularization_status === "PENDING"}
                            onClick={(e) => handleSubmitRegularization(e, false)}
                            data-testid="submit-regularization-btn"
                          >
                            Send Request
                          </button>
                          <button
                            type="button"
                            className="hrms-sim-btn active"
                            disabled={regSubmitting}
                            onClick={(e) => handleSubmitRegularization(e, true)}
                            data-testid="direct-regularize-btn"
                            style={{ padding: "8px 18px", fontSize: "13px" }}
                          >
                            {regSubmitting ? "Processing..." : "Regularize Directly"}
                          </button>
                        </>
                      ) : (
                        <button
                          type="submit"
                          className="hrms-sim-btn active"
                          disabled={regSubmitting || selectedDayForReg.regularization_status === "PENDING"}
                          style={{ padding: "8px 18px", fontSize: "13px" }}
                          data-testid="submit-regularization-btn"
                        >
                          {regSubmitting ? "Submitting..." : "Submit Request"}
                        </button>
                      )}
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Approval Tab (Live Attendance Regularizations) */}
        {activeTab === "approval" && (
          <div className="hrms-tab-content">
            <div className="hrms-grid-2">
              {/* Card 1: Pending Requests */}
              <div className="card">
                <div className="card-header">
                  <div>
                    <h2 className="hrms-section-title">Pending Requests</h2>
                    <div className="hrms-section-desc">Attendance regularizations and manual punch approvals</div>
                  </div>
                  <span className="hrms-badge-shell">
                    {regularizations.filter((r) => r.status === "PENDING").length} Pending
                  </span>
                </div>
                {regularizations.filter((r) => r.status === "PENDING").length === 0 ? (
                  <div className="hrms-placeholder-box">
                    <div className="hrms-placeholder-icon">
                      <IconClock />
                    </div>
                    <h3 className="hrms-placeholder-title">No Pending Requests</h3>
                    <p className="hrms-placeholder-text">
                      There are currently no attendance correction or regularization requests awaiting supervisor review.
                    </p>
                  </div>
                ) : (
                  <div className="hrms-approval-table-wrapper">
                    <table className="hrms-approval-table" data-testid="pending-approvals-table">
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Date</th>
                          <th>Punch In</th>
                          <th>Punch Out</th>
                          <th>Hours</th>
                          <th>Reason</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {regularizations
                          .filter((r) => r.status === "PENDING")
                          .map((item) => (
                            <tr key={item.id} data-testid={`approval-row-${item.id}`}>
                              <td>
                                <div style={{ fontWeight: 600 }}>{item.employee_name}</div>
                                {item.employee_email && (
                                  <div style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                                    {item.employee_email}
                                  </div>
                                )}
                              </td>
                              <td style={{ whiteSpace: "nowrap", fontWeight: 500 }}>{item.attendance_date}</td>
                              <td style={{ whiteSpace: "nowrap", fontSize: "12.5px" }}>
                                {item.punch_in_time || item.punch_in || "—"}
                              </td>
                              <td style={{ whiteSpace: "nowrap", fontSize: "12.5px" }}>
                                {item.punch_out_time || item.punch_out || "—"}
                              </td>
                              <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
                                {item.total_hours || "—"}
                              </td>
                              <td>
                                <div style={{ fontWeight: 500 }}>{item.reason}</div>
                                {item.notes && (
                                  <div style={{ fontSize: "11.5px", color: "var(--color-muted)", marginTop: "2px" }}>
                                    {item.notes}
                                  </div>
                                )}
                              </td>
                              <td>
                                <span className="status-badge-pending">PENDING</span>
                              </td>
                              <td>
                                <div className="hrms-approval-actions">
                                  <button
                                    type="button"
                                    className="hrms-btn-approve"
                                    disabled={actionLoading}
                                    onClick={() => handleApproveRequest(item.id, "Approved by Supervisor")}
                                    data-testid={`approve-btn-${item.id}`}
                                    title="Approve regularization"
                                  >
                                    <IconCheckSquare />
                                    <span>Approve</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="hrms-btn-reject"
                                    disabled={actionLoading}
                                    onClick={() => handleRejectRequest(item.id, "Rejected (Mark LOP)")}
                                    data-testid={`reject-btn-${item.id}`}
                                    title="Reject and mark Loss of Pay"
                                  >
                                    <span>Reject</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="hrms-btn-adjust"
                                    disabled={actionLoading}
                                    onClick={() => handleAdjustLeaveRequest(item.id, "Adjusted Against Leave Balance")}
                                    data-testid={`adjust-leave-btn-${item.id}`}
                                    title="Adjust against leave balance"
                                  >
                                    <span>Adjust Leave</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Card 2: Approved Requests */}
              <div className="card">
                <div className="card-header">
                  <div>
                    <h2 className="hrms-section-title">Approved Requests</h2>
                    <div className="hrms-section-desc">Recently processed attendance regularizations</div>
                  </div>
                  <span className="hrms-badge-shell">
                    {regularizations.filter((r) => r.status !== "PENDING").length} Processed
                  </span>
                </div>
                {regularizations.filter((r) => r.status !== "PENDING").length === 0 ? (
                  <div className="hrms-placeholder-box">
                    <div className="hrms-placeholder-icon">
                      <IconCheckSquare />
                    </div>
                    <h3 className="hrms-placeholder-title">No Approved Requests</h3>
                    <p className="hrms-placeholder-text">
                      No approved attendance modifications have been recorded for the current active cycle.
                    </p>
                  </div>
                ) : (
                  <div className="hrms-approval-table-wrapper">
                    <table className="hrms-approval-table" data-testid="approved-requests-table">
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Date</th>
                          <th>Punch In</th>
                          <th>Punch Out</th>
                          <th>Hours</th>
                          <th>Reason</th>
                          <th>Status</th>
                          <th>Reviewer</th>
                          <th>Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {regularizations
                          .filter((r) => r.status !== "PENDING")
                          .map((item) => (
                            <tr key={item.id}>
                              <td>
                                <div style={{ fontWeight: 600 }}>{item.employee_name}</div>
                              </td>
                              <td style={{ whiteSpace: "nowrap" }}>{item.attendance_date}</td>
                              <td style={{ whiteSpace: "nowrap", fontSize: "12.5px" }}>
                                {item.punch_in_time || item.punch_in || "—"}
                              </td>
                              <td style={{ whiteSpace: "nowrap", fontSize: "12.5px" }}>
                                {item.punch_out_time || item.punch_out || "—"}
                              </td>
                              <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
                                {item.total_hours || "—"}
                              </td>
                              <td>
                                <div style={{ fontWeight: 500 }}>{item.reason}</div>
                              </td>
                              <td>
                                <span
                                  className={
                                    item.status === "APPROVED" ? "status-badge-approved" : "status-badge-rejected"
                                  }
                                >
                                  {item.status}
                                </span>
                              </td>
                              <td>
                                <div style={{ fontSize: "12px", fontWeight: 500 }}>
                                  {item.reviewed_by_name || "Supervisor"}
                                </div>
                                {item.action_taken && (
                                  <div style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                                    {item.action_taken}
                                  </div>
                                )}
                              </td>
                              <td style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                                {item.manager_remarks || "—"}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Modal for Required Manager Remarks */}
            {approvalModal && approvalModal.isOpen && approvalModal.item && (
              <div className="hrms-modal-backdrop" onClick={() => setApprovalModal(null)}>
                <div
                  className="hrms-action-modal-card"
                  onClick={(e) => e.stopPropagation()}
                  data-testid="approval-action-modal"
                >
                  <div className="hrms-action-modal-header">
                    <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                      {approvalModal.action === "APPROVE"
                        ? "Approve Attendance Regularization"
                        : approvalModal.action === "REJECT_LOP"
                        ? "Reject Regularization (Mark LOP)"
                        : "Adjust Against Leave Balance"}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setApprovalModal(null)}
                      style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: "#64748b" }}
                    >
                      ✕
                    </button>
                  </div>

                  <div className="hrms-action-modal-body">
                    <div style={{ background: "#f8fafc", padding: "12px 14px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>
                        {approvalModal.item.employee_name}
                      </div>
                      <div style={{ fontSize: "12.5px", color: "#475569", marginTop: 4 }}>
                        Date: <strong>{approvalModal.item.attendance_date}</strong> | In:{" "}
                        <strong>{approvalModal.item.punch_in_time || approvalModal.item.punch_in || "—"}</strong> | Out:{" "}
                        <strong>{approvalModal.item.punch_out_time || approvalModal.item.punch_out || "—"}</strong> | Hours:{" "}
                        <strong>{approvalModal.item.total_hours || "—"}</strong>
                      </div>
                      <div style={{ fontSize: "12px", color: "#64748b", marginTop: 4 }}>
                        Reason: <strong>{approvalModal.item.reason}</strong>
                        {approvalModal.item.notes && ` (${approvalModal.item.notes})`}
                      </div>
                    </div>

                    <div className="hrms-field-group">
                      <label className="hrms-field-label">
                        Manager Remarks * <span style={{ color: "#ef4444" }}>(Mandatory)</span>
                      </label>
                      <textarea
                        rows={3}
                        className="hrms-field-input"
                        value={approvalModal.remarks}
                        onChange={(e) => setApprovalModal({ ...approvalModal, remarks: e.target.value })}
                        placeholder="Enter justification or remarks for this decision..."
                        required
                        data-testid="manager-remarks-input"
                      />
                    </div>
                  </div>

                  <div className="hrms-action-modal-footer">
                    <button
                      type="button"
                      className="hrms-cal-nav-btn"
                      onClick={() => setApprovalModal(null)}
                      disabled={actionLoading}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={`hrms-btn-${approvalModal.action === "APPROVE" ? "approve" : approvalModal.action === "REJECT_LOP" ? "reject" : "adjust"}`}
                      onClick={handleConfirmApprovalAction}
                      disabled={actionLoading || !approvalModal.remarks.trim()}
                      data-testid="confirm-approval-action-btn"
                      style={{ padding: "8px 16px" }}
                    >
                      {actionLoading ? "Processing..." : "Confirm Action"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Settings Tab (Preserved from Day 1 Foundation) */}
        {activeTab === "settings" && (
          <div className="hrms-tab-content">
            <div className="hrms-subtabs-nav">
              <button
                type="button"
                className={`hrms-subtab-btn ${settingsSubTab === "policy" ? "active" : ""}`}
                onClick={() => setSettingsSubTab("policy")}
              >
                Attendance Policy
              </button>
              <button
                type="button"
                className={`hrms-subtab-btn ${settingsSubTab === "exemption" ? "active" : ""}`}
                onClick={() => setSettingsSubTab("exemption")}
              >
                Attendance Exemption
              </button>
              <button
                type="button"
                className={`hrms-subtab-btn ${settingsSubTab === "overtime" ? "active" : ""}`}
                onClick={() => setSettingsSubTab("overtime")}
              >
                Overtime
              </button>
            </div>

            {settingsSubTab === "policy" && (
              <form onSubmit={handleSavePolicy}>
                <div style={{ display: "none" }}>Attendance Policy Configuration</div>
                <div className="hrms-policy-engine-grid">
                  {/* Left Column: Editable Policy Form */}
                  <div className="hrms-policy-form-col">
                    {/* Card 1: Basic Rules */}
                    <div className="hrms-rule-card">
                      <div className="hrms-rule-header">
                        <div>
                          <h3 className="hrms-rule-title">Basic Rules</h3>
                          <div className="hrms-rule-desc">
                            Core shift schedules, weekly offs, and geofence perimeter defaults
                          </div>
                        </div>
                      </div>
                      <div className="hrms-fields-grid-2">
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Shift Name</label>
                          <input
                            type="text"
                            className="hrms-field-input"
                            value={policyForm.shift_name}
                            onChange={(e) => setPolicyForm({ ...policyForm, shift_name: e.target.value })}
                            required
                            data-testid="policy-shift-name-input"
                          />
                        </div>
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Payroll Cycle</label>
                          <input
                            type="text"
                            className="hrms-field-input"
                            value={policyForm.payroll_cycle}
                            onChange={(e) => setPolicyForm({ ...policyForm, payroll_cycle: e.target.value })}
                            required
                            data-testid="policy-payroll-cycle-input"
                          />
                        </div>
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Shift Start Time</label>
                          <input
                            type="time"
                            className="hrms-field-input"
                            value={policyForm.shift_start_time}
                            onChange={(e) => setPolicyForm({ ...policyForm, shift_start_time: e.target.value })}
                            required
                            data-testid="policy-shift-start-input"
                          />
                        </div>
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Shift End Time</label>
                          <input
                            type="time"
                            className="hrms-field-input"
                            value={policyForm.shift_end_time}
                            onChange={(e) => setPolicyForm({ ...policyForm, shift_end_time: e.target.value })}
                            required
                            data-testid="policy-shift-end-input"
                          />
                        </div>
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Weekly Off (Sunday only default)</label>
                          <select
                            className="hrms-field-input"
                            value={policyForm.weekly_off}
                            onChange={(e) => setPolicyForm({ ...policyForm, weekly_off: e.target.value })}
                            data-testid="policy-weekly-off-select"
                          >
                            <option value="Sunday">Sunday</option>
                            <option value="Saturday, Sunday">Saturday, Sunday</option>
                            <option value="Friday, Saturday">Friday, Saturday</option>
                          </select>
                        </div>
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Geofence Radius (meters)</label>
                          <input
                            type="number"
                            className="hrms-field-input"
                            value={policyForm.geofence_radius_meters}
                            onChange={(e) => setPolicyForm({ ...policyForm, geofence_radius_meters: Number(e.target.value) })}
                            min={10}
                            max={5000}
                            required
                            data-testid="policy-geofence-radius-input"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Card 2: Grace Period for Punch-In */}
                    <div className="hrms-rule-card">
                      <div className="hrms-rule-header">
                        <div>
                          <h3 className="hrms-rule-title">Grace Period for Punch-In</h3>
                          <div className="hrms-rule-desc">
                            Allowed arrival window before late penalties apply
                          </div>
                        </div>
                        <label className="hrms-switch" title="Toggle Grace Period">
                          <input
                            type="checkbox"
                            checked={policyForm.enable_grace}
                            onChange={(e) => setPolicyForm({ ...policyForm, enable_grace: e.target.checked })}
                            data-testid="policy-enable-grace-toggle"
                          />
                          <span className="hrms-switch-slider" />
                        </label>
                      </div>
                      <div className="hrms-fields-grid-2">
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Grace Minutes</label>
                          <input
                            type="number"
                            className="hrms-field-input"
                            value={policyForm.grace_period_minutes}
                            onChange={(e) => setPolicyForm({ ...policyForm, grace_period_minutes: Number(e.target.value) })}
                            min={0}
                            max={120}
                            disabled={!policyForm.enable_grace}
                            data-testid="policy-grace-minutes-input"
                          />
                        </div>
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Grace Ends (Auto-Calculated)</label>
                          <div className="hrms-auto-badge" data-testid="policy-grace-ends-badge">
                            {formatTime12h(computedTimings.graceEnd)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Card 3: Late Attendance Rules */}
                    <div className="hrms-rule-card">
                      <div className="hrms-rule-header">
                        <div>
                          <h3 className="hrms-rule-title">Late Attendance Rules</h3>
                          <div className="hrms-rule-desc">
                            Monthly accumulation thresholds and recurring late penalties
                          </div>
                        </div>
                        <label className="hrms-switch" title="Toggle Late Marks">
                          <input
                            type="checkbox"
                            checked={policyForm.enable_late_marks}
                            onChange={(e) => setPolicyForm({ ...policyForm, enable_late_marks: e.target.checked })}
                            data-testid="policy-enable-late-toggle"
                          />
                          <span className="hrms-switch-slider" />
                        </label>
                      </div>
                      <div className="hrms-fields-grid-2">
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Late Starts After (Auto-Calculated)</label>
                          <div className="hrms-auto-badge" data-testid="policy-late-starts-badge">
                            {formatTime12h(computedTimings.lateStart)}
                          </div>
                        </div>
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Third Late Action</label>
                          <select
                            className="hrms-field-input"
                            value={policyForm.third_late_action}
                            onChange={(e) => setPolicyForm({ ...policyForm, third_late_action: e.target.value })}
                            data-testid="policy-third-late-action-select"
                          >
                            <option value="Half Day">Half Day</option>
                            <option value="Warning Only">Warning Only</option>
                            <option value="Leave Deduction">Leave Deduction</option>
                          </select>
                        </div>
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Count Late Marks Monthly</label>
                          <label className="hrms-switch">
                            <input
                              type="checkbox"
                              checked={policyForm.count_late_monthly}
                              onChange={(e) => setPolicyForm({ ...policyForm, count_late_monthly: e.target.checked })}
                              data-testid="policy-count-late-monthly-toggle"
                            />
                            <span className="hrms-switch-slider" />
                          </label>
                        </div>
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Monthly Counter Reset</label>
                          <div style={{ fontSize: "12px", color: "#64748b", marginTop: 6 }}>
                            Monthly counter resets every payroll cycle automatically.
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Card 4: Severe Late Arrival Rule */}
                    <div className="hrms-rule-card">
                      <div className="hrms-rule-header">
                        <div>
                          <h3 className="hrms-rule-title">Severe Late Arrival Rule</h3>
                          <div className="hrms-rule-desc">
                            Direct Half-Day threshold (arrival after this immediately converts without incrementing late counter)
                          </div>
                        </div>
                        <label className="hrms-switch" title="Toggle Direct Half Day">
                          <input
                            type="checkbox"
                            checked={policyForm.enable_direct_half_day}
                            onChange={(e) => setPolicyForm({ ...policyForm, enable_direct_half_day: e.target.checked })}
                            data-testid="policy-direct-half-day-toggle"
                          />
                          <span className="hrms-switch-slider" />
                        </label>
                      </div>
                      <div className="hrms-fields-grid-2">
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Trigger After (Time)</label>
                          <input
                            type="time"
                            className="hrms-field-input"
                            value={policyForm.direct_half_day_time}
                            onChange={(e) => setPolicyForm({ ...policyForm, direct_half_day_time: e.target.value })}
                            required
                            disabled={!policyForm.enable_direct_half_day}
                            data-testid="policy-direct-half-day-time-input"
                          />
                        </div>
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Action</label>
                          <div className="hrms-auto-badge" style={{ color: "#c2410c", background: "#fff7ed", borderColor: "#fed7aa" }}>
                            Half Day
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: "12px", color: "#64748b", marginTop: 8 }}>
                        Behavior: Employee arriving after {formatTime12h(policyForm.direct_half_day_time)} immediately becomes Half Day. No late count increment.
                      </div>
                    </div>

                    {/* Card 5: Early Exit Policy */}
                    <div className="hrms-rule-card">
                      <div className="hrms-rule-header">
                        <div>
                          <h3 className="hrms-rule-title">Early Exit Policy</h3>
                          <div className="hrms-rule-desc">
                            Departure before shift end buffer and regularization enforcement
                          </div>
                        </div>
                        <label className="hrms-switch" title="Toggle Early Exit">
                          <input
                            type="checkbox"
                            checked={policyForm.enable_early_exit}
                            onChange={(e) => setPolicyForm({ ...policyForm, enable_early_exit: e.target.checked })}
                            data-testid="policy-early-exit-toggle"
                          />
                          <span className="hrms-switch-slider" />
                        </label>
                      </div>
                      <div className="hrms-fields-grid-3">
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Allowed Buffer (Mins)</label>
                          <input
                            type="number"
                            className="hrms-field-input"
                            value={policyForm.early_exit_buffer_minutes}
                            onChange={(e) => setPolicyForm({ ...policyForm, early_exit_buffer_minutes: Number(e.target.value) })}
                            min={0}
                            max={120}
                            data-testid="policy-early-exit-buffer-input"
                          />
                        </div>
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Mark as Early Exit</label>
                          <label className="hrms-switch" style={{ marginTop: 4 }}>
                            <input
                              type="checkbox"
                              checked={policyForm.mark_early_exit}
                              onChange={(e) => setPolicyForm({ ...policyForm, mark_early_exit: e.target.checked })}
                              data-testid="policy-mark-early-exit-toggle"
                            />
                            <span className="hrms-switch-slider" />
                          </label>
                        </div>
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Auto Regularization Req.</label>
                          <label className="hrms-switch" style={{ marginTop: 4 }}>
                            <input
                              type="checkbox"
                              checked={policyForm.auto_regularization_early_exit}
                              onChange={(e) => setPolicyForm({ ...policyForm, auto_regularization_early_exit: e.target.checked })}
                              data-testid="policy-auto-reg-early-exit-toggle"
                            />
                            <span className="hrms-switch-slider" />
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Card 6: Missing Punch Policy */}
                    <div className="hrms-rule-card">
                      <div className="hrms-rule-header">
                        <div>
                          <h3 className="hrms-rule-title">Missing Punch Policy</h3>
                          <div className="hrms-rule-desc">
                            Automated marking and regularization requirements for unclosed punches
                          </div>
                        </div>
                      </div>
                      <div className="hrms-fields-grid-2">
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Missing Punch Out Handling</label>
                          <label className="hrms-switch">
                            <input
                              type="checkbox"
                              checked={policyForm.missing_punch_out}
                              onChange={(e) => setPolicyForm({ ...policyForm, missing_punch_out: e.target.checked })}
                              data-testid="policy-missing-punch-out-toggle"
                            />
                            <span className="hrms-switch-slider" />
                          </label>
                        </div>
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Missing Punch In Handling</label>
                          <label className="hrms-switch">
                            <input
                              type="checkbox"
                              checked={policyForm.missing_punch_in}
                              onChange={(e) => setPolicyForm({ ...policyForm, missing_punch_in: e.target.checked })}
                              data-testid="policy-missing-punch-in-toggle"
                            />
                            <span className="hrms-switch-slider" />
                          </label>
                        </div>
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Auto Mark Irregular</label>
                          <label className="hrms-switch">
                            <input
                              type="checkbox"
                              checked={policyForm.auto_mark_irregular}
                              onChange={(e) => setPolicyForm({ ...policyForm, auto_mark_irregular: e.target.checked })}
                              data-testid="policy-auto-irregular-toggle"
                            />
                            <span className="hrms-switch-slider" />
                          </label>
                        </div>
                        <div className="hrms-field-group">
                          <label className="hrms-field-label">Require Regularization</label>
                          <label className="hrms-switch">
                            <input
                              type="checkbox"
                              checked={policyForm.require_regularization}
                              onChange={(e) => setPolicyForm({ ...policyForm, require_regularization: e.target.checked })}
                              data-testid="policy-require-reg-toggle"
                            />
                            <span className="hrms-switch-slider" />
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Card 7: Optional Advanced Attendance Rules (Collapsible) */}
                    <div className="hrms-rule-card">
                      <div
                        className="hrms-rule-header"
                        style={{ cursor: "pointer", userSelect: "none" }}
                        onClick={() => setAdvancedExpanded(!advancedExpanded)}
                      >
                        <div>
                          <h3 className="hrms-rule-title">
                            Advanced Attendance Rules (Optional) {advancedExpanded ? "▼" : "►"}
                          </h3>
                          <div className="hrms-rule-desc">
                            Notifications, overtime policies, flexible shifts, and role-based grace extensions
                          </div>
                        </div>
                        <button
                          type="button"
                          className="hrms-cal-nav-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAdvancedExpanded(!advancedExpanded);
                          }}
                        >
                          {advancedExpanded ? "Collapse" : "Expand"}
                        </button>
                      </div>

                      {advancedExpanded && (
                        <div className="hrms-fields-grid-2" style={{ marginTop: 14 }}>
                          <div className="hrms-field-group">
                            <label className="hrms-field-label">Consecutive late warning</label>
                            <label className="hrms-switch">
                              <input
                                type="checkbox"
                                checked={policyForm.consecutive_late_warning}
                                onChange={(e) => setPolicyForm({ ...policyForm, consecutive_late_warning: e.target.checked })}
                              />
                              <span className="hrms-switch-slider" />
                            </label>
                          </div>
                          <div className="hrms-field-group">
                            <label className="hrms-field-label">Auto email notification</label>
                            <label className="hrms-switch">
                              <input
                                type="checkbox"
                                checked={policyForm.auto_email_notification}
                                onChange={(e) => setPolicyForm({ ...policyForm, auto_email_notification: e.target.checked })}
                              />
                              <span className="hrms-switch-slider" />
                            </label>
                          </div>
                          <div className="hrms-field-group">
                            <label className="hrms-field-label">Auto manager notification</label>
                            <label className="hrms-switch">
                              <input
                                type="checkbox"
                                checked={policyForm.auto_manager_notification}
                                onChange={(e) => setPolicyForm({ ...policyForm, auto_manager_notification: e.target.checked })}
                              />
                              <span className="hrms-switch-slider" />
                            </label>
                          </div>
                          <div className="hrms-field-group">
                            <label className="hrms-field-label">Holiday overtime</label>
                            <label className="hrms-switch">
                              <input
                                type="checkbox"
                                checked={policyForm.holiday_overtime}
                                onChange={(e) => setPolicyForm({ ...policyForm, holiday_overtime: e.target.checked })}
                              />
                              <span className="hrms-switch-slider" />
                            </label>
                          </div>
                          <div className="hrms-field-group">
                            <label className="hrms-field-label">Weekend overtime</label>
                            <label className="hrms-switch">
                              <input
                                type="checkbox"
                                checked={policyForm.weekend_overtime}
                                onChange={(e) => setPolicyForm({ ...policyForm, weekend_overtime: e.target.checked })}
                              />
                              <span className="hrms-switch-slider" />
                            </label>
                          </div>
                          <div className="hrms-field-group">
                            <label className="hrms-field-label">Flexible shift</label>
                            <label className="hrms-switch">
                              <input
                                type="checkbox"
                                checked={policyForm.flexible_shift}
                                onChange={(e) => setPolicyForm({ ...policyForm, flexible_shift: e.target.checked })}
                              />
                              <span className="hrms-switch-slider" />
                            </label>
                          </div>
                          <div className="hrms-field-group">
                            <label className="hrms-field-label">Grace extension for specific employees</label>
                            <label className="hrms-switch">
                              <input
                                type="checkbox"
                                checked={policyForm.grace_extension}
                                onChange={(e) => setPolicyForm({ ...policyForm, grace_extension: e.target.checked })}
                              />
                              <span className="hrms-switch-slider" />
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Live Policy Preview (Part 3) */}
                  <div className="hrms-policy-preview-col">
                    <div className="hrms-preview-card">
                      <div className="hrms-preview-header">
                        <h4 className="hrms-preview-title">
                          <IconSettings />
                          <span>Live Policy Preview</span>
                        </h4>
                        <span className="hrms-preview-pill">● Active</span>
                      </div>

                      <div className="hrms-preview-list">
                        <div className="hrms-preview-item">
                          <span className="hrms-preview-key">Shift</span>
                          <span className="hrms-preview-val">
                            {formatTime12h(policyForm.shift_start_time)}–{formatTime12h(policyForm.shift_end_time)}
                          </span>
                        </div>

                        <div className="hrms-preview-item">
                          <span className="hrms-preview-key">Grace</span>
                          <span className="hrms-preview-val">
                            Until {formatTime12h(computedTimings.graceEnd)}
                          </span>
                        </div>

                        <div className="hrms-preview-item">
                          <span className="hrms-preview-key">Late Starts</span>
                          <span className="hrms-preview-val">
                            {formatTime12h(computedTimings.lateStart)}
                          </span>
                        </div>

                        <div className="hrms-preview-item">
                          <span className="hrms-preview-key">Third Late</span>
                          <span className="hrms-preview-val">
                            {policyForm.third_late_action}
                          </span>
                        </div>

                        <div className="hrms-preview-item">
                          <span className="hrms-preview-key">Direct Half Day</span>
                          <span className="hrms-preview-val">
                            {formatTime12h(policyForm.direct_half_day_time)}
                          </span>
                        </div>

                        <div className="hrms-preview-item">
                          <span className="hrms-preview-key">Weekly Off</span>
                          <span className="hrms-preview-val">
                            {policyForm.weekly_off}
                          </span>
                        </div>

                        <div className="hrms-preview-item">
                          <span className="hrms-preview-key">Radius</span>
                          <span className="hrms-preview-val">
                            {policyForm.geofence_radius_meters}m
                          </span>
                        </div>

                        <div className="hrms-preview-item">
                          <span className="hrms-preview-key">Payroll Cycle</span>
                          <span className="hrms-preview-val">
                            {policyForm.payroll_cycle}
                          </span>
                        </div>
                      </div>

                      <div style={{ marginTop: 24 }}>
                        <button
                          type="submit"
                          className="hrms-sim-btn active"
                          disabled={policySaving}
                          data-testid="save-policy-btn"
                          style={{ width: "100%", padding: "11px 18px", fontSize: "14px", fontWeight: 700 }}
                        >
                          {policySaving ? "Saving to PostgreSQL..." : "Save Policy Configuration"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </form>
            )}

            {settingsSubTab === "exemption" && (
              <div className="card">
                <div className="card-header">
                  <div>
                    <h2 className="hrms-section-title">Attendance Exemption</h2>
                    <div className="hrms-section-desc">Exemption rules for specific roles, field agents, and executive staff</div>
                  </div>
                </div>
                <div className="hrms-placeholder-box">
                  <div className="hrms-placeholder-icon">
                    <IconSettings />
                  </div>
                  <h3 className="hrms-placeholder-title">Attendance Exemption Management</h3>
                  <p className="hrms-placeholder-text">
                    Configure role-based exemptions from geofencing constraints, strict punch windows, and automated late markings.
                  </p>
                </div>
              </div>
            )}

            {settingsSubTab === "overtime" && (
              <div className="card">
                <div className="card-header">
                  <div>
                    <h2 className="hrms-section-title">Overtime</h2>
                    <div className="hrms-section-desc">Overtime threshold calculations, approvals, and payout rules</div>
                  </div>
                </div>
                <div className="hrms-placeholder-box">
                  <div className="hrms-placeholder-icon">
                    <IconClock />
                  </div>
                  <h3 className="hrms-placeholder-title">Overtime Calculation Rules</h3>
                  <p className="hrms-placeholder-text">
                    Set up overtime multipliers, minimum extra duration thresholds, weekend overtime policies, and supervisor approval chains.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </AppShell>
  );
}
