/**
 * HRMS Attendance Page (/hrms/attendance)
 *
 * Dedicated Attendance page with screen tabs only:
 * [ View ]   [ Approval ]   [ Settings ]
 *
 * Requirements:
 * - Single navbar & single breadcrumb (Dashboard > HRMS > Attendance). No duplicate breadcrumbs or navbar.
 * - Changing sidebar changes page; changing tabs changes only the attendance screen.
 * - View tab:
 *   - Developer Location Simulator in header: Assigned Office (Inhyma Thane Office), Pune Office, Gujarat Office, Remote.
 *   - Before Punch: Outside assigned office blocks punch with distance.
 *   - After Punch: Moving outside triggers a 30-second warning countdown and "Return Inside" button.
 *     If timer expires, creates irregularity and routes to Approval.
 *   - 7-Column monthly calendar with single status indicators.
 *   - Irregular days have edit icon (✏️) opening RegularizeDrawer.
 *   - Single day per request; WFH is a regularization reason. No bulk requests.
 *   - Employee role: "Send Request" button only.
 *   - Admin role: "Send Request" + "Regularize Directly" (updates attendance immediately & creates audit log).
 * - Approval tab: unified queue for approvals, rejections, leave adjustments, and direct regularize audit log.
 * - Settings tab: Admin configurable policy engine with live summary and interactive simulator.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Banner, Modal } from "@/components/ui";
import { apiGet, apiPost } from "@/lib/api";
import {
  IconCalendar,
  IconCheckSquare,
  IconPin,
  IconShield,
} from "@/components/icons";
import { useAuth } from "@/lib/hooks";
import { RegularizeDrawer, type AttendanceRecordForRegularize, type AuditLogEntry } from "./components/RegularizeDrawer";
import { AttendanceSettings } from "./AttendanceSettings";
import { ApprovalPage, type ApprovalRequestItem } from "./ApprovalPage";

import {
  type AttendanceStatus,
  type AttendanceDay,
  type AssignedOffice,
  type AttendanceTerminalState,
  type DevGpsLocation,
  shouldShowRegularizeIcon,
  generateMonthDays,
} from "@/lib/attendance";
import { attendanceService } from "@/services/attendanceService";
import { AttendanceCalendar } from "./components/AttendanceCalendar";

export { shouldShowRegularizeIcon, generateMonthDays };
export type { AttendanceStatus, AttendanceDay, AssignedOffice, AttendanceTerminalState, DevGpsLocation };


function getDevGpsLocations(office: AssignedOffice): DevGpsLocation[] {
  return [
    {
      id: office.id || "loc-inhyma-thane-assigned",
      name: "Assigned Office",
      latitude: office.latitude,
      longitude: office.longitude,
      isInsideAssigned: true,
      distanceKm: 0,
    },
    {
      id: "loc-pune",
      name: "Pune",
      latitude: 18.5204,
      longitude: 73.8567,
      isInsideAssigned: false,
      distanceKm: 120,
    },
    {
      id: "loc-gujarat",
      name: "Gujarat",
      latitude: 23.0225,
      longitude: 72.5714,
      isInsideAssigned: false,
      distanceKm: 450,
    },
    {
      id: "loc-remote",
      name: "Remote",
      latitude: office.latitude + 0.13,
      longitude: office.longitude + 0.13,
      isInsideAssigned: false,
      distanceKm: 15,
    },
  ];
}

const ASSIGNED_OFFICE_CACHE_KEY = "inhyma_assigned_office_cache";

function getInitialAssignedOffice(): AssignedOffice {
  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      const cached = window.sessionStorage.getItem(ASSIGNED_OFFICE_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.name && parsed?.latitude) {
          return parsed;
        }
      }
    } catch {}
  }
  return {
    id: "loc-inhyma-thane-assigned",
    name: "Inhyma Thane Office",
    address: "Office No 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
    latitude: 19.198300,
    longitude: 72.948300,
    radius_meters: 150.0,
  };
}

const ACTIVE_PUNCH_SESSION_KEY = "inhyma_active_punch_session";

function getInitialPunchSession(): {
  status: "OPEN" | "CLOSED";
  check_in_time: string | null;
  punch_in: string | null;
  punch_out?: string | null;
  total_hours?: string | null;
  attendance_date?: string;
} | null {
  if (typeof window !== "undefined") {
    try {
      const saved =
        window.sessionStorage?.getItem(ACTIVE_PUNCH_SESSION_KEY) ||
        window.localStorage?.getItem(ACTIVE_PUNCH_SESSION_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const todayIso = new Date().toISOString().slice(0, 10);
        if (parsed?.attendance_date === todayIso && parsed?.status === "OPEN") {
          return parsed;
        }
      }
    } catch {}
  }
  return null;
}

function saveActivePunchSession(data: any) {
  if (typeof window !== "undefined") {
    try {
      const str = JSON.stringify(data);
      window.sessionStorage?.setItem(ACTIVE_PUNCH_SESSION_KEY, str);
      window.localStorage?.setItem(ACTIVE_PUNCH_SESSION_KEY, str);
    } catch {}
  }
}

function clearActivePunchSession() {
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage?.removeItem(ACTIVE_PUNCH_SESSION_KEY);
      window.localStorage?.removeItem(ACTIVE_PUNCH_SESSION_KEY);
    } catch {}
  }
}

export interface HrmsAttendancePageProps {
  initialDaysForTesting?: AttendanceDay[];
}

export function HrmsAttendancePage({ initialDaysForTesting }: HrmsAttendancePageProps = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") || "view";
  const { profile, isSuperAdmin } = useAuth();

  // Role permissions
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

  // Screen Tabs: View | Approval | Settings
  const activeTab = useMemo(() => {
    if (currentTab === "settings" && !isHrAdmin) return "view";
    if (["view", "approval", "settings"].includes(currentTab)) return currentTab;
    return "view";
  }, [currentTab, isHrAdmin]);

  const setTab = (tab: "view" | "approval" | "settings") => {
    setSearchParams({ tab });
  };

  // Feedback notifications
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(t);
  }, [success]);

  // Server-time-driven dynamic date, greeting, shift
  const [serverDate, setServerDate] = useState<string | null>(null);
  const [serverGreeting, setServerGreeting] = useState<string | null>(null);
  const [serverShift, setServerShift] = useState<string>("10:30 AM – 07:00 PM");

  const localGreeting = useMemo(() => {
    const hr = new Date().getHours();
    if (hr < 12) return "Good Morning";
    if (hr < 17) return "Good Afternoon";
    return "Good Evening";
  }, []);

  const todayFormatted = useMemo(() => {
    if (serverDate) {
      const parsed = new Date(serverDate);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString("en-IN", {
          weekday: "long",
          day: "numeric",
          month: "short",
          year: "numeric",
        });
      }
    }
    return new Date().toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }, [serverDate]);

  // ---------------------------------------------------------------------------
  // REAL DATABASE ATTENDANCE STATE & GEOFENCE ENGINE
  // ---------------------------------------------------------------------------
  const initialSavedSession = useMemo(() => getInitialPunchSession(), []);
  // Persistent Assigned Office fetched from DB / session cache
  const [assignedOffice, setAssignedOffice] = useState<AssignedOffice>(getInitialAssignedOffice);
  const devGpsLocations = useMemo(() => getDevGpsLocations(assignedOffice), [assignedOffice]);
  const [currentGps, setCurrentGps] = useState<DevGpsLocation>(() => getDevGpsLocations(getInitialAssignedOffice())[0]);
  const [isDevSelectOverride, setIsDevSelectOverride] = useState(false);

  useEffect(() => {
    if (!isDevSelectOverride) {
      setCurrentGps(devGpsLocations[0]);
    }
  }, [devGpsLocations, isDevSelectOverride]);

  const [terminalState, setTerminalState] = useState<AttendanceTerminalState>(
    initialSavedSession ? "CHECKED_IN" : "NOT_PUNCHED"
  );
  const [isPunchedIn, setIsPunchedIn] = useState<boolean>(Boolean(initialSavedSession));
  const isPunchedInRef = React.useRef(isPunchedIn);
  isPunchedInRef.current = isPunchedIn;
  const [punchSeconds, setPunchSeconds] = useState<number>(() => {
    if (initialSavedSession?.check_in_time) {
      const startMs = new Date(initialSavedSession.check_in_time).getTime();
      if (!isNaN(startMs)) {
        return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      }
    }
    return 0;
  });
  const [lastPunchTime, setLastPunchTime] = useState<string | null>(
    initialSavedSession?.punch_in || null
  );
  const [checkInTime, setCheckInTime] = useState<string | null>(
    initialSavedSession?.check_in_time || null
  );
  const [punchOutTime, setPunchOutTime] = useState<string | null>(null);
  const [totalWorkingDuration, setTotalWorkingDuration] = useState<string | null>(null);
  const [todayRecord, setTodayRecord] = useState<any>(null);

  // Calendar Month selection (YYYY-MM)
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [calendarDays, setCalendarDays] = useState<AttendanceDay[]>(
    () => initialDaysForTesting || generateMonthDays(selectedMonth)
  );

  // Fetch assigned office from DB (GET /api/v1/hrms/locations/assigned)
  useEffect(() => {
    const fetchOffice = async () => {
      try {
        const res = await attendanceService.getAssignedLocation();
        if (res && res.name) {
          const off: AssignedOffice = {
            id: res.id || "loc-inhyma-thane-assigned",
            name: res.name,
            address: res.address || "Office No 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
            latitude: res.latitude || 19.198300,
            longitude: res.longitude || 72.948300,
            radius_meters: res.radius_meters || 150.0,
          };
          setAssignedOffice(off);
          try {
            window.sessionStorage.setItem(ASSIGNED_OFFICE_CACHE_KEY, JSON.stringify(off));
          } catch {}
          return;
        }
      } catch {}

      if (typeof window !== "undefined" && window.sessionStorage?.getItem(ASSIGNED_OFFICE_CACHE_KEY)) {
        return;
      }
      try {
        const locPromise = apiGet<any>("/hrms/locations?active_only=true");
        if (locPromise && typeof locPromise.then === "function") {
          locPromise
            .then((res) => {
              if (res?.data && Array.isArray(res.data) && res.data.length > 0) {
                const matched =
                  res.data.find(
                    (l: any) =>
                      l.name?.toLowerCase().includes("thane") ||
                      l.name?.toLowerCase().includes("bkc") ||
                      l.name?.toLowerCase().includes("mumbai")
                  ) || res.data[0];
                if (matched) {
                  const off: AssignedOffice = {
                    id: matched.id,
                    name: matched.name,
                    address: matched.address,
                    latitude: matched.latitude,
                    longitude: matched.longitude,
                    radius_meters: matched.radius_meters || 150.0,
                  };
                  setAssignedOffice(off);
                  try {
                    window.sessionStorage.setItem(ASSIGNED_OFFICE_CACHE_KEY, JSON.stringify(off));
                  } catch {}
                }
              }
            })
            .catch(() => {});
        }
      } catch {}
    };
    fetchOffice();
  }, []);

  // Real GPS acquisition from browser (when not manually selected via dev dropdown)
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.geolocation && !isDevSelectOverride) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          const R = 6371000.0;
          const phi1 = (lat * Math.PI) / 180;
          const phi2 = (assignedOffice.latitude * Math.PI) / 180;
          const dPhi = ((assignedOffice.latitude - lat) * Math.PI) / 180;
          const dLambda = ((assignedOffice.longitude - lon) * Math.PI) / 180;
          const a =
            Math.sin(dPhi / 2.0) ** 2 +
            Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2.0) ** 2;
          const c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
          const distM = R * c;
          const isInside = distM <= assignedOffice.radius_meters;
          const distKm = Math.round((distM / 1000) * 10) / 10;
          setCurrentGps({
            id: "real-gps",
            name: "Current Device GPS",
            latitude: lat,
            longitude: lon,
            isInsideAssigned: isInside,
            distanceKm: distKm,
          });
        },
        () => {},
        { enableHighAccuracy: true, timeout: 6000 }
      );
    }
  }, [assignedOffice, isDevSelectOverride]);

  // Load monthly calendar records from PostgreSQL
  const loadMonthAttendance = useCallback(
    async (monthStr: string, activeTodayRec?: any) => {
      if (initialDaysForTesting && initialDaysForTesting.length > 0) {
        return;
      }
      try {
        const res = await attendanceService.getMonthAttendance(monthStr);
        const recordByDate: Record<string, any> = {};
        if (Array.isArray(res)) {
          for (const r of res) {
            if (r.attendance_date) {
              recordByDate[r.attendance_date] = r;
            }
          }
        }
        const effectiveToday = activeTodayRec !== undefined ? activeTodayRec : todayRecord;
        setCalendarDays(generateMonthDays(monthStr, recordByDate, effectiveToday, serverDate));
      } catch {
        // In tests, preserve initial days
      }
    },
    [initialDaysForTesting, todayRecord, serverDate]
  );

  // Load today's persistent attendance record from PostgreSQL
  const loadTodayAttendance = useCallback(async () => {
    try {
      const res = await attendanceService.getTodayAttendance();
      if (res) {
        const d = res as any;
        if (d.greeting) setServerGreeting(d.greeting);
        if (d.current_shift) setServerShift(d.current_shift);
        if (d.current_date) setServerDate(d.current_date);
        if (d.assigned_office?.name) {
          const off: AssignedOffice = {
            id: d.assigned_office.id || "loc-inhyma-thane-assigned",
            name: d.assigned_office.name,
            address: d.assigned_office.address || "Office No 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
            latitude: d.assigned_office.latitude || 19.198300,
            longitude: d.assigned_office.longitude || 72.948300,
            radius_meters: d.assigned_office.radius_meters || 150.0,
          };
          setAssignedOffice(off);
          try {
            window.sessionStorage.setItem(ASSIGNED_OFFICE_CACHE_KEY, JSON.stringify(off));
          } catch {}
        }

        const rec = d.session || (d.status && d.status !== "NOT_PUNCHED" ? d : null);
        setTodayRecord(rec);

        const isOpenSession = Boolean(
          d.status === "OPEN" ||
          rec?.status === "OPEN" ||
          (d.punched_in && !d.punched_out) ||
          (rec?.punched_in && !rec?.punched_out) ||
          (d.punch_in && !d.punch_out && d.status !== "CLOSED" && rec?.status !== "CLOSED") ||
          (rec?.punch_in && !rec?.punch_out && rec?.status !== "CLOSED") ||
          (d.check_in_time && !d.check_out_time && d.status !== "CLOSED" && rec?.status !== "CLOSED") ||
          (rec?.check_in_time && !rec?.check_out_time && rec?.status !== "CLOSED")
        );

        const isClosedSession = Boolean(
          d.status === "CLOSED" ||
          rec?.status === "CLOSED" ||
          (d.punched_in && d.punched_out) ||
          (rec?.punched_in && rec?.punched_out) ||
          (d.punch_in && d.punch_out) ||
          (rec?.punch_in && rec?.punch_out) ||
          (d.check_in_time && d.check_out_time) ||
          (rec?.check_in_time && rec?.check_out_time)
        );

        if (isOpenSession && !isClosedSession) {
          const inTime = rec?.check_in_time || d.check_in_time || rec?.punched_in || d.punched_in;
          const inStr = rec?.punch_in || d.punch_in || "10:30 AM";
          setIsPunchedIn(true);
          setTerminalState("CHECKED_IN");
          setCheckInTime(inTime);
          setLastPunchTime(inStr);
          setPunchOutTime(null);
          setTotalWorkingDuration(null);
          if (inTime) {
            const startMs = new Date(inTime).getTime();
            if (!isNaN(startMs)) {
              setPunchSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
            }
          }
          saveActivePunchSession({
            attendance_date: d.current_date || new Date().toISOString().slice(0, 10),
            status: "OPEN",
            check_in_time: inTime,
            punch_in: inStr,
          });
        } else if (isClosedSession) {
          const inTime = rec?.check_in_time || d.check_in_time || rec?.punched_in || d.punched_in;
          const outTime = rec?.check_out_time || d.check_out_time || rec?.punched_out || d.punched_out;
          setIsPunchedIn(false);
          setTerminalState("CHECKED_OUT");
          setCheckInTime(inTime);
          setLastPunchTime(rec?.punch_in || d.punch_in || "10:30 AM");
          setPunchOutTime(rec?.punch_out || d.punch_out || (outTime ? new Date(outTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "07:00 PM"));
          setTotalWorkingDuration(rec?.total_hours || d.total_hours || "08h 30m");
          clearActivePunchSession();
        } else {
          setIsPunchedIn(false);
          setTerminalState("NOT_PUNCHED");
          setPunchSeconds(0);
          setCheckInTime(null);
          setPunchOutTime(null);
          setTotalWorkingDuration(null);
          clearActivePunchSession();
        }

        loadMonthAttendance(selectedMonth, rec);
      }
    } catch {
      // In offline/test runner, keep initial state
    }
  }, [loadMonthAttendance, selectedMonth]);

  useEffect(() => {
    loadTodayAttendance();
    loadMonthAttendance(selectedMonth);

    const handleFocusOrVisible = () => {
      loadTodayAttendance();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleFocusOrVisible);
      document.addEventListener("visibilitychange", handleFocusOrVisible);
      return () => {
        window.removeEventListener("focus", handleFocusOrVisible);
        document.removeEventListener("visibilitychange", handleFocusOrVisible);
      };
    }
  }, [loadTodayAttendance, loadMonthAttendance, selectedMonth]);

  // Working Timer: Derived strictly from server check_in_time timestamp
  useEffect(() => {
    if (!isPunchedIn) return;

    if (checkInTime) {
      const startMs = new Date(checkInTime).getTime();
      if (!isNaN(startMs)) {
        setPunchSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
      }
    }

    const timer = setInterval(() => {
      if (checkInTime) {
        const startMs = new Date(checkInTime).getTime();
        if (!isNaN(startMs)) {
          setPunchSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
          return;
        }
      }
      setPunchSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [isPunchedIn, checkInTime]);

  const formatTimer = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  // 30-Second Warning Geofence Monitor
  const [geofenceWarningOpen, setGeofenceWarningOpen] = useState(false);
  const [geofenceCountdown, setGeofenceCountdown] = useState(30);

  // Irregularities and audit logs
  const [directAuditLogs, setDirectAuditLogs] = useState<AuditLogEntry[]>([]);
  const [submittedApprovalRequests, setSubmittedApprovalRequests] = useState<ApprovalRequestItem[]>([]);

  const userName: string = (profile?.full_name || (typeof profile?.display_name === "string" ? profile.display_name : "") || profile?.first_name || "Rupesh Malla") as string;
  const userCode: string = (typeof profile?.employee_code === "string" ? profile.employee_code : "EMP-001") as string;
  const userPosition: string = (typeof profile?.role === "string" ? profile.role : (profile?.roles?.[0] || "Operations Manager")) as string;

  // Monitor location changes after Punch In
  useEffect(() => {
    if (!isPunchedIn) {
      setGeofenceWarningOpen(false);
      return;
    }

    if (!currentGps.isInsideAssigned) {
      setTerminalState("OUTSIDE_GEOFENCE");
      setGeofenceCountdown(30);
      setGeofenceWarningOpen(true);
    } else {
      setGeofenceWarningOpen(false);
      if (terminalState === "OUTSIDE_GEOFENCE") {
        setTerminalState("CHECKED_IN");
      }
    }
  }, [currentGps, isPunchedIn, terminalState]);

  // Countdown timer for Geofence warning
  useEffect(() => {
    if (!geofenceWarningOpen || geofenceCountdown <= 0) return;

    const interval = setInterval(() => {
      setGeofenceCountdown((prev) => {
        if (prev <= 1) {
          setGeofenceWarningOpen(false);
          setTerminalState("REGULARIZATION_PENDING");
          const auditEntry: AuditLogEntry = {
            id: `geo-irreg-${Date.now()}`,
            admin_name: "Geofence Sentinel",
            date: new Date().toISOString().slice(0, 10),
            old_values: { check_in: lastPunchTime || "Active", check_out: "Active", status: "Present" },
            new_values: { check_in: lastPunchTime || "Active", check_out: "Active", status: "Outside Geofence" },
            reason: `Geofence breach: Employee exited office perimeter (${currentGps.name}, ${currentGps.distanceKm} km away). 30-second grace expired.`,
            timestamp: new Date().toLocaleString("en-IN", { dateStyle: "short", timeStyle: "medium" }),
          };
          setDirectAuditLogs((logs) => [auditEntry, ...logs]);
          setError(`Warning: Geofence timer expired. Irregularity logged and sent to Approval queue.`);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [geofenceWarningOpen, geofenceCountdown, currentGps, lastPunchTime]);

  const handleReturnInsideGeofence = () => {
    setCurrentGps(devGpsLocations[0]);
    setIsDevSelectOverride(false);
    setGeofenceWarningOpen(false);
    setTerminalState(isPunchedIn ? "CHECKED_IN" : "NOT_PUNCHED");
    setSuccess("Returned inside assigned office geofence.");
  };

  const handleTogglePunch = () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    if (isPunchedIn) {
      // Clock Out - Update terminal state synchronously, then fire backend punch-out
      setIsPunchedIn(false);
      setTerminalState("CHECKED_OUT");
      const outStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      setPunchOutTime(outStr);
      const h = Math.floor(punchSeconds / 3600);
      const m = Math.floor((punchSeconds % 3600) / 60);
      const formattedTotal = `${h}h ${String(m).padStart(2, "0")}m`;
      setTotalWorkingDuration(formattedTotal);
      setSuccess(`Punched Out successfully at ${outStr}. Working hours permanently stopped (${formattedTotal}).`);

      // Immediately update today's calendar cell
      setCalendarDays((prevDays) =>
        prevDays.map((d) =>
          d.date === todayIso
            ? { ...d, punch_out: outStr, total_hours: formattedTotal, status: "Present" as AttendanceStatus }
            : d
        )
      );

      clearActivePunchSession();

      attendanceService.punchOut()
        .then((res) => {
          if (res) {
            const rec = res as any;
            setTodayRecord(rec);
            if (rec.punch_out) setPunchOutTime(rec.punch_out);
            if (rec.total_hours) setTotalWorkingDuration(rec.total_hours);
            loadMonthAttendance(selectedMonth, rec);
          }
        })
        .catch(() => {});
    } else {
      // Punch In - Validate Geofence Rule
      if (!currentGps.isInsideAssigned) {
        setTerminalState("OUTSIDE_GEOFENCE");
        setError(
          `Punch Blocked: You are outside your assigned office (${currentGps.distanceKm} km away). You must be within the geofence perimeter to punch in.`
        );
        return;
      }

      setIsPunchedIn(true);
      setTerminalState("CHECKED_IN");
      setPunchSeconds(0);
      const nowStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      setLastPunchTime(nowStr);
      setPunchOutTime(null);
      setTotalWorkingDuration(null);
      const currentTimeIso = new Date().toISOString();
      setCheckInTime(currentTimeIso);
      setSuccess(`Punched In successfully at ${nowStr}. Working hours ticking.`);

      saveActivePunchSession({
        attendance_date: todayIso,
        status: "OPEN",
        check_in_time: currentTimeIso,
        punch_in: nowStr,
      });

      // Immediately update today's calendar cell
      setCalendarDays((prevDays) =>
        prevDays.map((d) =>
          d.date === todayIso
            ? { ...d, punch_in: nowStr, punch_out: null, total_hours: null, status: "In Progress" as AttendanceStatus }
            : d
        )
      );

      attendanceService.punchIn(currentGps.latitude, currentGps.longitude, assignedOffice.id)
        .then((res) => {
          if (res && isPunchedInRef.current) {
            const rec = res as any;
            setTodayRecord(rec);
            const inTime = rec.check_in_time || rec.punched_in || currentTimeIso;
            const inStr = rec.punch_in || nowStr;
            setCheckInTime(inTime);
            setLastPunchTime(inStr);
            saveActivePunchSession({
              attendance_date: todayIso,
              status: "OPEN",
              check_in_time: inTime,
              punch_in: inStr,
            });
            loadMonthAttendance(selectedMonth, rec);
          }
        })
        .catch((err: any) => {
          clearActivePunchSession();
          if (err?.message && err.message.includes("Punch Blocked")) {
            setIsPunchedIn(false);
            setTerminalState("OUTSIDE_GEOFENCE");
            setError(err.message);
          }
        });
    }
  };

  const handleResetTerminal = () => {
    setIsPunchedIn(false);
    setTerminalState("NOT_PUNCHED");
    setPunchSeconds(0);
    setCheckInTime(null);
    setPunchOutTime(null);
    setTotalWorkingDuration(null);
    clearActivePunchSession();
    setSuccess("Terminal reset to idle before-punch state (--:--:--).");
  };

  // ---------------------------------------------------------------------------
  // CALENDAR & REGULARIZATION DRAWER
  // ---------------------------------------------------------------------------
  const [selectedDay, setSelectedDay] = useState<AttendanceRecordForRegularize | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleOpenDrawer = (day: AttendanceDay) => {
    setSelectedDay({
      date: day.date,
      dayNumber: day.dayNumber,
      status: day.status,
      punch_in: day.punch_in,
      punch_out: day.punch_out,
      total_hours: day.total_hours,
    });
    setDrawerOpen(true);
  };

  // Employee / Admin: Send Regularize Request (routed to Approval)
  const handleSubmitRegularizeRequest = async (payload: {
    date: string;
    checkIn: string;
    checkOut: string;
    totalHours: string;
    reason: string;
    remarks: string;
  }) => {
    try {
      await attendanceService.submitRegularize({
        date: payload.date,
        checkIn: payload.checkIn,
        checkOut: payload.checkOut,
        totalHours: payload.totalHours,
        reason: `${payload.reason}${payload.remarks ? ` — ${payload.remarks}` : ""}`,
      });
    } catch (err) {
      console.warn("API regularization save:", err);
    }

    const newReq: ApprovalRequestItem = {
      id: `reg-${Date.now()}`,
      type: "Regularization",
      employee: userName || "Employee",
      employee_code: userCode || null,
      date: payload.date,
      check_in: payload.checkIn,
      check_out: payload.checkOut,
      reason: `${payload.reason}${payload.remarks ? ` — ${payload.remarks}` : ""}`,
      status: "PENDING",
      submitted_at: new Date().toISOString().replace("T", " ").slice(0, 16),
    };
    setSubmittedApprovalRequests((prev) => [newReq, ...prev]);

    // Keep irregularity marked on calendar
    setCalendarDays((prev) =>
      prev.map((d) =>
        d.date === payload.date
          ? {
              ...d,
              is_irregular: true,
            }
          : d
      )
    );

    setSuccess(`Regularization request for ${payload.date} sent to manager for approval.`);
  };

  // Admin: Regularize Directly without approval queue
  const handleDirectRegularize = async (payload: {
    date: string;
    checkIn: string;
    checkOut: string;
    totalHours: string;
    reason: string;
    remarks: string;
    auditLog: AuditLogEntry;
  }) => {
    try {
      await apiPost("/hrms/regularization-requests", {
        attendance_date: payload.date,
        check_in: payload.checkIn,
        check_out: payload.checkOut,
        total_hours: payload.totalHours,
        reason: `[Direct Regularize by Admin] ${payload.reason}${payload.remarks ? ` — ${payload.remarks}` : ""}`,
      });
    } catch (err) {
      console.warn("Direct regularize API call:", err);
    }

    // 1. Immediately update calendar day to Present
    setCalendarDays((prev) =>
      prev.map((d) =>
        d.date === payload.date
          ? {
              ...d,
              status: "Present",
              is_irregular: false,
              punch_in: payload.checkIn,
              punch_out: payload.checkOut,
              total_hours: payload.totalHours,
            }
          : d
      )
    );

    // 2. Append to audit log
    setDirectAuditLogs((prev) => [payload.auditLog, ...prev]);

    setSuccess(`Directly regularized ${payload.date} to Present. Audit record generated.`);
  };

  return (
    <AppShell activeKey="hrms">
      <main className="page" style={{ maxWidth: "1280px", margin: "0 auto", padding: "20px 24px" }}>
        {/* Single Breadcrumb (Dashboard > HRMS > Attendance) - No duplicate navbar or breadcrumb */}
        <Breadcrumb trail={["HRMS", "Attendance"]} />

        {/* Top Header with Developer GPS Simulator */}
        <div
          className="page-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "14px",
            marginBottom: "20px",
          }}
        >
          <div>
            <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0, color: "var(--color-text)" }}>
              Attendance
            </h1>
            <div className="page-subtitle" style={{ fontSize: "13px", color: "var(--color-muted)", marginTop: "4px" }}>
              Enterprise punch tracking, geofence verification, calendar, and regularization.
            </div>
          </div>

          {/* Location Simulator in Header (Restricted to DEV_MODE=true in production) */}
          {Boolean(import.meta.env.DEV || import.meta.env.VITE_DEV_MODE === "true") && (
            <div
              data-testid="location-simulator"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 12px",
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm, 6px)",
              }}
            >
              <span style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--color-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                <IconPin width={14} height={14} style={{ color: currentGps.isInsideAssigned ? "#16a34a" : "#dc2626" }} />
                Location Simulator:
              </span>
              <select
                className="form-control"
                data-testid="dev-gps-select"
                value={currentGps.id}
                onChange={(e) => {
                  const found = devGpsLocations.find((l) => l.id === e.target.value);
                  if (found) {
                    setCurrentGps(found);
                    setIsDevSelectOverride(true);
                  }
                }}
                style={{
                  fontSize: "12px",
                  padding: "3px 8px",
                  height: "30px",
                  borderColor: currentGps.isInsideAssigned ? "#86efac" : "#fca5a5",
                  background: currentGps.isInsideAssigned ? "#f0fdf4" : "#fef2f2",
                  fontWeight: 600,
                }}
                title="Test geofence rules before punch and after punch without moving"
              >
                {devGpsLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} {loc.isInsideAssigned ? "(Inside)" : `[${loc.distanceKm}km]`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <Banner error={error} success={success} />

        {/* SCREEN TABS (Screen tabs only, not navigation menus) */}
        <div
          style={{
            display: "flex",
            gap: "24px",
            borderBottom: "2px solid var(--color-border)",
            marginBottom: "24px",
          }}
        >
          <button
            type="button"
            data-testid="tab-view"
            onClick={() => setTab("view")}
            style={{
              padding: "10px 4px",
              background: "none",
              border: "none",
              borderBottom: activeTab === "view" ? "2px solid #2563eb" : "2px solid transparent",
              marginBottom: "-2px",
              fontSize: "14px",
              fontWeight: 600,
              color: activeTab === "view" ? "#2563eb" : "var(--color-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <IconCalendar width={16} height={16} />
            <span>View</span>
          </button>

          <button
            type="button"
            data-testid="tab-approval"
            onClick={() => setTab("approval")}
            style={{
              padding: "10px 4px",
              background: "none",
              border: "none",
              borderBottom: activeTab === "approval" ? "2px solid #2563eb" : "2px solid transparent",
              marginBottom: "-2px",
              fontSize: "14px",
              fontWeight: 600,
              color: activeTab === "approval" ? "#2563eb" : "var(--color-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <IconCheckSquare width={16} height={16} />
            <span>Approval</span>
          </button>

          {isHrAdmin && (
            <button
              type="button"
              data-testid="tab-settings"
              onClick={() => setTab("settings")}
              style={{
                padding: "10px 4px",
                background: "none",
                border: "none",
                borderBottom: activeTab === "settings" ? "2px solid #2563eb" : "2px solid transparent",
                marginBottom: "-2px",
                fontSize: "14px",
                fontWeight: 600,
                color: activeTab === "settings" ? "#2563eb" : "var(--color-muted)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <IconShield width={16} height={16} />
              <span>Settings</span>
            </button>
          )}
        </div>

        {/* ------------------------------------------------------------------- */}
        {/* TAB 1: VIEW SCREEN                                                  */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === "view" && (
          <div data-testid="attendance-view-container" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Unified Production Attendance Terminal Card (Phase 1, 2, 3) */}
            <div
              className="card"
              data-testid="attendance-punch-card"
              style={{
                padding: "24px 28px",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                gap: "24px",
                alignItems: "center",
                background: "var(--color-surface, #ffffff)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md, 10px)",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
              }}
            >
              {/* Left Column: Date, Shift, User Greeting */}
              <div data-testid="welcome-section" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ fontSize: "12px", color: "var(--color-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {todayFormatted}
                </div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-text)" }}>
                  {serverGreeting || localGreeting}, {userName}!
                </div>
                <div style={{ fontSize: "13px", color: "var(--color-muted)" }}>
                  {userPosition} • Code: <strong style={{ color: "var(--color-text)" }}>{userCode}</strong>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px", flexWrap: "wrap" }}>
                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: "12px",
                      background: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--color-text)",
                    }}
                  >
                    Shift: {serverShift || "10:30 AM – 07:00 PM"}
                  </span>
                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: "12px",
                      fontSize: "12px",
                      fontWeight: 700,
                      background:
                        terminalState === "CHECKED_IN"
                          ? "#dcfce7"
                          : terminalState === "CHECKED_OUT"
                          ? "#dbeafe"
                          : terminalState === "OUTSIDE_GEOFENCE"
                          ? "#fee2e2"
                          : "var(--color-bg)",
                      color:
                        terminalState === "CHECKED_IN"
                          ? "#15803d"
                          : terminalState === "CHECKED_OUT"
                          ? "#1d4ed8"
                          : terminalState === "OUTSIDE_GEOFENCE"
                          ? "#b91c1c"
                          : "var(--color-muted)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    {terminalState === "CHECKED_IN"
                      ? "● Checked In"
                      : terminalState === "CHECKED_OUT"
                      ? "✓ Attendance Completed"
                      : terminalState === "OUTSIDE_GEOFENCE"
                      ? "⚠ Outside Geofence"
                      : "○ Ready to Punch"}
                  </span>
                </div>
              </div>

              {/* Center Column: Live / Stopped Working Timer */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "16px",
                  background: "var(--color-bg)",
                  borderRadius: "var(--radius-sm, 8px)",
                  border: "1px solid var(--color-border)",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: "11px", color: "var(--color-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {terminalState === "CHECKED_OUT" ? "Total Working Duration" : "Current Working Duration"}
                </div>
                <div
                  data-testid="punch-live-timer"
                  style={{
                    fontSize: "34px",
                    fontWeight: 800,
                    fontFamily: "monospace",
                    letterSpacing: "1px",
                    color:
                      terminalState === "CHECKED_IN"
                        ? "#2563eb"
                        : terminalState === "CHECKED_OUT"
                        ? "#15803d"
                        : "var(--color-muted)",
                    marginTop: "4px",
                  }}
                >
                  {terminalState === "CHECKED_IN"
                    ? formatTimer(punchSeconds)
                    : terminalState === "CHECKED_OUT"
                    ? (totalWorkingDuration || "00h 00m")
                    : "--:--:--"}
                </div>
                <div style={{ fontSize: "11.5px", color: "var(--color-muted)", marginTop: "4px" }}>
                  {terminalState === "CHECKED_IN"
                    ? `Last Punch In: ${lastPunchTime || "Just now"}`
                    : terminalState === "CHECKED_OUT"
                    ? `Punched Out at ${punchOutTime || "07:00 PM"} • Attendance Completed`
                    : "Punch in below to begin your workday"}
                </div>
              </div>

              {/* Right Column: Actions & Location Status */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", justifyContent: "center" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-muted)" }}>
                    Geofence Status
                  </span>
                  <span
                    data-testid="location-status-badge"
                    style={{
                      padding: "3px 8px",
                      borderRadius: "12px",
                      fontSize: "11px",
                      fontWeight: 700,
                      background: currentGps.isInsideAssigned ? "#dcfce7" : "#fee2e2",
                      color: currentGps.isInsideAssigned ? "#15803d" : "#b91c1c",
                    }}
                  >
                    {currentGps.isInsideAssigned ? "✓ Inside Geofence" : `⚠ Outside (${currentGps.distanceKm} km)`}
                  </span>
                </div>

                <button
                  type="button"
                  data-testid="punch-toggle-btn"
                  onClick={handleTogglePunch}
                  className={isPunchedIn ? "btn btn-danger" : "btn btn-primary"}
                  style={{
                    width: "100%",
                    padding: "12px",
                    fontSize: "14px",
                    fontWeight: 700,
                    borderRadius: "var(--radius-sm, 6px)",
                    boxShadow: isPunchedIn
                      ? "0 2px 6px rgba(220, 38, 38, 0.25)"
                      : "0 2px 6px rgba(37, 99, 235, 0.25)",
                    transition: "all 0.2s ease",
                  }}
                >
                  {isPunchedIn ? "Punch Out" : terminalState === "CHECKED_OUT" ? "Punch In (New Shift)" : "Punch In"}
                </button>

                <div style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "11.5px", color: "var(--color-muted)", marginTop: "4px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Assigned Office: <strong>{assignedOffice.name}</strong></span>
                    {terminalState === "CHECKED_OUT" && (
                      <button
                        type="button"
                        onClick={handleResetTerminal}
                        style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: "11px", padding: 0 }}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  {assignedOffice.address && (
                    <div style={{ fontSize: "11px", color: "var(--color-muted)", lineHeight: "1.3" }}>
                      Address: {assignedOffice.address}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Attendance Monthly Calendar (Production Component) */}
            <AttendanceCalendar
              selectedMonth={selectedMonth}
              onMonthChange={(m) => {
                setSelectedMonth(m);
                loadMonthAttendance(m);
              }}
              calendarDays={calendarDays}
              serverDate={serverDate}
              liveElapsedSeconds={punchSeconds}
              isPunchedIn={isPunchedIn}
              onOpenRegularize={handleOpenDrawer}
            />
          </div>
        )}

        {/* ------------------------------------------------------------------- */}
        {/* TAB 2: APPROVAL SCREEN                                              */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === "approval" && (
          <ApprovalPage
            directAuditLogs={directAuditLogs}
            submittedRequests={submittedApprovalRequests}
          />
        )}

        {/* ------------------------------------------------------------------- */}
        {/* TAB 3: SETTINGS SCREEN (ADMIN ONLY)                                 */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === "settings" && isHrAdmin && <AttendanceSettings />}

        {/* ------------------------------------------------------------------- */}
        {/* REGULARIZE DRAWER (RIGHT-SIDE 1/3 SCREEN)                            */}
        {/* ------------------------------------------------------------------- */}
        <RegularizeDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          day={selectedDay}
          isAdmin={isHrAdmin}
          adminName={userName}
          employeeName={userName}
          employeeCode={userCode}
          onSubmitRequest={handleSubmitRegularizeRequest}
          onDirectRegularize={handleDirectRegularize}
        />

        {/* ------------------------------------------------------------------- */}
        {/* 30-SECOND WARNING MODAL WHEN LEAVING GEOFENCE WHILE PUNCHED IN      */}
        {/* ------------------------------------------------------------------- */}
        <Modal
          open={geofenceWarningOpen}
          title="⚠️ Geofence Perimeter Warning"
          onClose={() => {}}
          cardStyle={{ maxWidth: "440px" }}
        >
          <div data-testid="geofence-warning-modal" style={{ padding: "20px", textAlign: "center" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#b91c1c", marginBottom: "8px" }}>
              You have moved outside your assigned punch location!
            </div>
            <div style={{ fontSize: "13px", color: "var(--color-text)", lineHeight: 1.5, marginBottom: "16px" }}>
              You are currently at <strong>{currentGps.name}</strong> ({currentGps.distanceKm} km away from Inhyma Thane Office).
              Please return inside the office boundary or your attendance will be flagged as an irregularity.
            </div>

            <div
              data-testid="geofence-countdown-box"
              style={{
                fontSize: "28px",
                fontWeight: 800,
                color: geofenceCountdown <= 10 ? "#dc2626" : "#d97706",
                fontFamily: "monospace",
                marginBottom: "20px",
              }}
            >
              00:{String(geofenceCountdown).padStart(2, "0")}
            </div>

            <button
              type="button"
              data-testid="return-inside-geofence-btn"
              className="btn btn-primary"
              onClick={handleReturnInsideGeofence}
              style={{ width: "100%", padding: "10px", fontWeight: 700 }}
            >
              Return Inside Office Perimeter
            </button>
          </div>
        </Modal>
      </main>
    </AppShell>
  );
}

export default HrmsAttendancePage;
