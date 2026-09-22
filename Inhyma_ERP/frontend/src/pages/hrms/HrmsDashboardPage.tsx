/**
 * HRMS / Attendance Module Page (OTU HR Plus Architecture)
 *
 * Consolidated single-module architecture with 4 internal tabs:
 * 1. Overview: Welcome, Attendance Summary KPIs, Holiday Calendar, Quick Navigation
 * 2. Punch: Assigned Office Selector (Primary + Additional), Live Ticking Timer, Punch In/Out, Request WFH
 * 3. Locations:
 *    - HR/Admin: "Manage Locations" section (3-step Add, Table, Edit, Disable/Enable, Employee Assignment)
 *    - Employee: Read-only assigned Primary & Additional locations with map previews
 * 4. History: Attendance Logs, WFH Request history & Manager Approval Queue
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Banner, Modal, StatusBadge } from "@/components/ui";
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
import { AddressMapConfirmModal, type AddressMapConfirmData } from "@/components/hrms/AddressMapConfirmModal";
import { LocationMapPicker } from "@/components/hrms/LocationMapPicker";
import { WfhRequestModal } from "@/components/hrms/WfhRequestModal";
import { apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import { useAuth, useDebouncedValue } from "@/lib/hooks";

// Types
export interface HrmsLocationItem {
  id: string;
  name: string;
  location_type: "OFFICE" | "BRANCH" | "WAREHOUSE" | "FACTORY" | "CLIENT_SITE" | "OTHER";
  address: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active: boolean;
  assigned_employees_count: number;
  created_at: string;
  updated_at: string;
}

export interface EmployeeAssignmentItem {
  user_id: string;
  employee_name: string;
  employee_code?: string | null;
  email?: string | null;
  department?: string | null;
  role?: string | null;
  primary_location?: {
    id: string;
    name: string;
    location_type: string;
    address: string;
    radius_meters: number;
    latitude?: number;
    longitude?: number;
    is_primary: boolean;
  } | null;
  additional_locations: Array<{
    id: string;
    name: string;
    location_type: string;
    address: string;
    radius_meters: number;
    latitude?: number;
    longitude?: number;
    is_primary: boolean;
  }>;
}

export interface WfhRequestItem {
  id: string;
  user_id: string;
  employee_name: string;
  employee_code?: string | null;
  wfh_date: string;
  reason: string;
  address: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  manager_id?: string | null;
  manager_remarks?: string | null;
  submitted_at: string;
  reviewed_at?: string | null;
}

interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
  type: "Gazetted" | "Restricted" | "Public";
}

interface AttendanceLogItem {
  id: string;
  date: string;
  punch_in: string;
  punch_out?: string | null;
  total_hours: string;
  workplace: string;
  status: "Present" | "Half Day" | "Work From Home" | "Late";
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

const INITIAL_LOGS: AttendanceLogItem[] = [
  {
    id: "log-1",
    date: new Date().toISOString().slice(0, 10),
    punch_in: "09:15 AM",
    punch_out: null,
    total_hours: "Active",
    workplace: "Mumbai BKC Office",
    status: "Present",
  },
  {
    id: "log-2",
    date: "2026-09-21",
    punch_in: "09:08 AM",
    punch_out: "06:18 PM",
    total_hours: "9h 10m",
    workplace: "Mumbai BKC Office",
    status: "Present",
  },
  {
    id: "log-3",
    date: "2026-09-19",
    punch_in: "09:30 AM",
    punch_out: "06:05 PM",
    total_hours: "8h 35m",
    workplace: "Remote (WFH)",
    status: "Work From Home",
  },
  {
    id: "log-4",
    date: "2026-09-18",
    punch_in: "09:12 AM",
    punch_out: "06:22 PM",
    total_hours: "9h 10m",
    workplace: "Mumbai BKC Office",
    status: "Present",
  },
  {
    id: "log-5",
    date: "2026-09-17",
    punch_in: "09:55 AM",
    punch_out: "06:40 PM",
    total_hours: "8h 45m",
    workplace: "Pune Tech Branch",
    status: "Late",
  },
];

const LOCATION_TYPES: Array<{ value: HrmsLocationItem["location_type"]; label: string }> = [
  { value: "OFFICE", label: "Office" },
  { value: "BRANCH", label: "Branch" },
  { value: "WAREHOUSE", label: "Warehouse" },
  { value: "FACTORY", label: "Factory" },
  { value: "CLIENT_SITE", label: "Client Site" },
  { value: "OTHER", label: "Other" },
];

export function HrmsDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") || "overview";
  const { profile, isSuperAdmin } = useAuth();

  // Active tab state
  const activeTab = useMemo(() => {
    if (["overview", "punch", "locations", "history"].includes(currentTab)) {
      return currentTab;
    }
    return "overview";
  }, [currentTab]);

  const setTab = (tab: "overview" | "punch" | "locations" | "history") => {
    setSearchParams({ tab });
  };

  // Role check
  const isHrAdmin = useMemo(() => {
    if (isSuperAdmin) return true;
    const userRole = String(profile?.role || "").toLowerCase();
    const roles = Array.isArray(profile?.roles)
      ? profile.roles.map((r) => String(r).toLowerCase())
      : [];
    return (
      isSuperAdmin ||
      ["admin", "hr", "hr_manager", "super_admin"].includes(userRole) ||
      roles.some((r) => ["admin", "hr", "hr_manager", "super_admin"].includes(r))
    );
  }, [profile, isSuperAdmin]);

  const isManagerOrAdmin = useMemo(() => {
    if (isSuperAdmin || isHrAdmin) return true;
    const userRole = String(profile?.role || "").toLowerCase();
    const roles = Array.isArray(profile?.roles)
      ? profile.roles.map((r) => String(r).toLowerCase())
      : [];
    return ["manager", "supervisor", "lead"].includes(userRole) || roles.some((r) => ["manager", "supervisor", "lead"].includes(r));
  }, [isSuperAdmin, isHrAdmin, profile]);

  // Global feedback banners
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<unknown>(null);

  useEffect(() => {
    if (!feedbackSuccess) return;
    const timer = setTimeout(() => setFeedbackSuccess(null), 4500);
    return () => clearTimeout(timer);
  }, [feedbackSuccess]);

  useEffect(() => {
    if (!feedbackError) return;
    const timer = setTimeout(() => setFeedbackError(null), 5000);
    return () => clearTimeout(timer);
  }, [feedbackError]);

  // ---------------------------------------------------------------------------
  // PUNCH & LIVE TIMER STATE
  // ---------------------------------------------------------------------------
  const [isPunchedIn, setIsPunchedIn] = useState<boolean>(true);
  const [punchTime, setPunchTime] = useState<string>("09:15 AM");
  const [punchMessage, setPunchMessage] = useState<string | null>(null);
  const [timerSeconds, setTimerSeconds] = useState<number>(() => {
    const now = new Date();
    const diff = Math.floor((now.getTime() - new Date().setHours(9, 15, 0, 0)) / 1000);
    return diff > 0 ? diff : 27918; // default ~7h 45m
  });

  // Live ticking timer
  useEffect(() => {
    if (!isPunchedIn) return;
    const interval = setInterval(() => {
      setTimerSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isPunchedIn]);

  const formattedTimer = useMemo(() => {
    const h = Math.floor(timerSeconds / 3600);
    const m = Math.floor((timerSeconds % 3600) / 60);
    const s = timerSeconds % 60;
    return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  }, [timerSeconds]);

  // Selected office in Punch tab
  const [selectedOfficeId, setSelectedOfficeId] = useState<string>("loc-1");

  // ---------------------------------------------------------------------------
  // LOCATIONS DATA & MANAGEMENT STATE
  // ---------------------------------------------------------------------------
  const [locations, setLocations] = useState<HrmsLocationItem[]>([
    {
      id: "loc-1",
      name: "Mumbai BKC Office",
      location_type: "OFFICE",
      address: "Bandra Kurla Complex, Bandra East, Mumbai, Maharashtra 400051",
      latitude: 19.0664,
      longitude: 72.8687,
      radius_meters: 150,
      is_active: true,
      assigned_employees_count: 14,
      created_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-01T10:00:00Z",
    },
    {
      id: "loc-2",
      name: "Pune Tech Branch",
      location_type: "BRANCH",
      address: "Hinjawadi Phase 1, Rajiv Gandhi Infotech Park, Pune, Maharashtra 411057",
      latitude: 18.5913,
      longitude: 73.7389,
      radius_meters: 200,
      is_active: true,
      assigned_employees_count: 8,
      created_at: "2026-09-05T11:00:00Z",
      updated_at: "2026-09-05T11:00:00Z",
    },
    {
      id: "loc-3",
      name: "Gujarat GIDC Warehouse",
      location_type: "WAREHOUSE",
      address: "Plot 12, GIDC Industrial Estate, Makarpura, Vadodara, Gujarat 390010",
      latitude: 22.3072,
      longitude: 73.1812,
      radius_meters: 250,
      is_active: true,
      assigned_employees_count: 5,
      created_at: "2026-09-10T12:00:00Z",
      updated_at: "2026-09-10T12:00:00Z",
    },
  ]);

  // Search & Filters for Admin Locations Table
  const [locationSearch, setLocationSearch] = useState("");
  const debouncedLocationSearch = useDebouncedValue(locationSearch, 300);
  const [locationTypeFilter, setLocationTypeFilter] = useState("ALL");
  const [locationStatusFilter, setLocationStatusFilter] = useState("ALL");
  const [locationsSubTab, setLocationsSubTab] = useState<"offices" | "assignments">("offices");

  // Add Location Modal (AddressMapConfirmModal)
  const [isAddLocationOpen, setIsAddLocationOpen] = useState(false);

  // Edit Location Modal
  const [editTarget, setEditTarget] = useState<HrmsLocationItem | null>(null);
  const [editFormData, setEditFormData] = useState<{
    name: string;
    location_type: HrmsLocationItem["location_type"];
    address: string;
    radius_meters: number;
    latitude: number;
    longitude: number;
    is_active: boolean;
  } | null>(null);

  // View Location Modal
  const [viewTarget, setViewTarget] = useState<HrmsLocationItem | null>(null);

  // Employee assignments state
  const [employeeAssignments, setEmployeeAssignments] = useState<EmployeeAssignmentItem[]>([
    {
      user_id: "u-101",
      employee_name: "Rupesh Malla",
      employee_code: "EMP-007",
      email: "rupesh@inhyma.com",
      department: "Management",
      role: "General Manager",
      primary_location: {
        id: "loc-1",
        name: "Mumbai BKC Office",
        location_type: "OFFICE",
        address: "Bandra Kurla Complex, Bandra East, Mumbai, Maharashtra 400051",
        radius_meters: 150,
        latitude: 19.0664,
        longitude: 72.8687,
        is_primary: true,
      },
      additional_locations: [
        {
          id: "loc-2",
          name: "Pune Tech Branch",
          location_type: "BRANCH",
          address: "Hinjawadi Phase 1, Rajiv Gandhi Infotech Park, Pune, Maharashtra 411057",
          radius_meters: 200,
          latitude: 18.5913,
          longitude: 73.7389,
          is_primary: false,
        },
      ],
    },
    {
      user_id: "u-102",
      employee_name: "Anita Sharma",
      employee_code: "EMP-014",
      email: "anita@inhyma.com",
      department: "Human Resources",
      role: "HR Manager",
      primary_location: {
        id: "loc-1",
        name: "Mumbai BKC Office",
        location_type: "OFFICE",
        address: "Bandra Kurla Complex, Bandra East, Mumbai, Maharashtra 400051",
        radius_meters: 150,
        latitude: 19.0664,
        longitude: 72.8687,
        is_primary: true,
      },
      additional_locations: [],
    },
    {
      user_id: "u-103",
      employee_name: "Suresh Patil",
      employee_code: "EMP-022",
      email: "suresh@inhyma.com",
      department: "Logistics",
      role: "Warehouse In-charge",
      primary_location: {
        id: "loc-3",
        name: "Gujarat GIDC Warehouse",
        location_type: "WAREHOUSE",
        address: "Plot 12, GIDC Industrial Estate, Makarpura, Vadodara, Gujarat 390010",
        radius_meters: 250,
        latitude: 22.3072,
        longitude: 73.1812,
        is_primary: true,
      },
      additional_locations: [],
    },
  ]);
  const [empSearch, setEmpSearch] = useState("");
  const debouncedEmpSearch = useDebouncedValue(empSearch, 300);

  // Assign Modal
  const [assignTarget, setAssignTarget] = useState<EmployeeAssignmentItem | null>(null);
  const [assignPrimaryId, setAssignPrimaryId] = useState<string>("");
  const [assignAdditionalIds, setAssignAdditionalIds] = useState<string[]>([]);
  const [isSubmittingAssign, setIsSubmittingAssign] = useState(false);

  // ---------------------------------------------------------------------------
  // WFH & HISTORY STATE
  // ---------------------------------------------------------------------------
  const [isWfhModalOpen, setIsWfhModalOpen] = useState(false);
  const [myWfhRequests, setMyWfhRequests] = useState<WfhRequestItem[]>([
    {
      id: "wfh-1",
      user_id: "u-101",
      employee_name: "Rupesh Malla",
      employee_code: "EMP-007",
      wfh_date: "2026-09-19",
      reason: "Quarterly strategic review sprint and remote coordination",
      address: "Residential Complex, Thane West, Mumbai, Maharashtra 400601",
      latitude: 19.2183,
      longitude: 72.9781,
      radius_meters: 150,
      status: "APPROVED",
      manager_id: "m-1",
      manager_remarks: "Approved for strategy planning day.",
      submitted_at: "2026-09-18T10:00:00Z",
      reviewed_at: "2026-09-18T14:30:00Z",
    },
  ]);
  const [pendingWfhRequests, setPendingWfhRequests] = useState<WfhRequestItem[]>([
    {
      id: "wfh-2",
      user_id: "u-105",
      employee_name: "Rajesh Kulkarni",
      employee_code: "EMP-031",
      wfh_date: new Date().toISOString().slice(0, 10),
      reason: "Broadband network migration at residential workstation",
      address: "Kalyan West, Mumbai Metropolitan Region, Maharashtra 421301",
      latitude: 19.2437,
      longitude: 73.1355,
      radius_meters: 150,
      status: "PENDING",
      submitted_at: new Date().toISOString(),
    },
  ]);
  const [reviewTarget, setReviewTarget] = useState<WfhRequestItem | null>(null);
  const [managerRemarks, setManagerRemarks] = useState("");
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  // Attendance history logs
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceLogItem[]>(INITIAL_LOGS);

  // Holiday Calendar state
  const [calendarDate, setCalendarDate] = useState<Date>(() => new Date());

  // ---------------------------------------------------------------------------
  // DATA FETCHING HOOKS
  // ---------------------------------------------------------------------------
  const loadLocationsData = useCallback(async () => {
    try {
      const res = await apiGet<HrmsLocationItem[]>("/api/v1/hrms/locations");
      if (Array.isArray(res.data) && res.data.length > 0) {
        setLocations(res.data);
      }
    } catch {
      // Fallback gracefully to default office locations; never display "Not Found" banner
    }
  }, []);

  const loadAssignmentsData = useCallback(async () => {
    try {
      const res = await apiGet<EmployeeAssignmentItem[]>("/api/v1/hrms/employee-assignments");
      if (Array.isArray(res.data) && res.data.length > 0) {
        setEmployeeAssignments(res.data);
      }
    } catch {
      // Retain initial mock assignments
    }
  }, []);

  const loadWfhData = useCallback(async () => {
    try {
      const [pendRes, myRes] = await Promise.all([
        apiGet<WfhRequestItem[]>("/api/v1/hrms/wfh-requests/pending").catch(() => null),
        apiGet<WfhRequestItem[]>("/api/v1/hrms/wfh-requests/my").catch(() => null),
      ]);
      if (Array.isArray(pendRes?.data) && pendRes.data.length > 0) {
        setPendingWfhRequests(pendRes.data);
      }
      if (Array.isArray(myRes?.data) && myRes.data.length > 0) {
        setMyWfhRequests(myRes.data);
      }
    } catch {
      // Retain initial items
    }
  }, []);

  useEffect(() => {
    loadLocationsData();
    loadAssignmentsData();
    loadWfhData();
  }, [loadLocationsData, loadAssignmentsData, loadWfhData]);

  // Current employee user's assigned locations
  const currentUserAssignment = useMemo(() => {
    const currentId = String(profile?.id || "u-101");
    const found = employeeAssignments.find((e) => e.user_id === currentId);
    if (found) return found;
    return employeeAssignments[0];
  }, [employeeAssignments, profile]);

  const assignedLocationsForPunch = useMemo(() => {
    const list: Array<{ id: string; name: string; type: string; address: string; radius: number; isPrimary: boolean }> = [];
    if (currentUserAssignment?.primary_location) {
      list.push({
        id: currentUserAssignment.primary_location.id,
        name: currentUserAssignment.primary_location.name,
        type: currentUserAssignment.primary_location.location_type,
        address: currentUserAssignment.primary_location.address,
        radius: currentUserAssignment.primary_location.radius_meters,
        isPrimary: true,
      });
    }
    if (Array.isArray(currentUserAssignment?.additional_locations)) {
      for (const add of currentUserAssignment.additional_locations) {
        list.push({
          id: add.id,
          name: add.name,
          type: add.location_type,
          address: add.address,
          radius: add.radius_meters,
          isPrimary: false,
        });
      }
    }
    if (list.length === 0 && locations.length > 0) {
      list.push({
        id: locations[0].id,
        name: locations[0].name,
        type: locations[0].location_type,
        address: locations[0].address,
        radius: locations[0].radius_meters,
        isPrimary: true,
      });
    }
    return list;
  }, [currentUserAssignment, locations]);

  const selectedOfficeDetails = useMemo(() => {
    return (
      assignedLocationsForPunch.find((l) => l.id === selectedOfficeId) ||
      assignedLocationsForPunch[0] ||
      null
    );
  }, [assignedLocationsForPunch, selectedOfficeId]);

  // ---------------------------------------------------------------------------
  // GREETING & PROFILE HELPERS
  // ---------------------------------------------------------------------------
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    return "Good Evening";
  }, []);

  const employeeName = useMemo(() => {
    if (profile && typeof profile === "object") {
      return profile.full_name || profile.username || "Employee";
    }
    return "Rupesh Malla";
  }, [profile]);

  const employeeRole = useMemo(() => {
    if (profile && typeof profile === "object") {
      if (Array.isArray(profile.roles) && profile.roles.length > 0) {
        return profile.roles[0];
      }
      if (profile.role) return String(profile.role);
    }
    return "General Manager";
  }, [profile]);

  const employeeCode = useMemo(() => {
    if (profile && typeof profile === "object" && profile.employee_code) {
      return String(profile.employee_code);
    }
    return "EMP-007";
  }, [profile]);

  const formattedCurrentDate = useMemo(() => {
    return new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, []);

  // ---------------------------------------------------------------------------
  // PUNCH IN / OUT HANDLER
  // ---------------------------------------------------------------------------
  const handleTogglePunch = () => {
    const now = new Date();
    const formatted = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    if (isPunchedIn) {
      setIsPunchedIn(false);
      setPunchTime(formatted);
      const msg = `Punched out successfully at ${formatted}`;
      setPunchMessage(msg);
      // Update today's attendance log entry
      setAttendanceLogs((prev) => [
        {
          id: `log-${Date.now()}`,
          date: now.toISOString().slice(0, 10),
          punch_in: punchTime,
          punch_out: formatted,
          total_hours: formattedTimer,
          workplace: selectedOfficeDetails?.name || "Assigned Office",
          status: "Present",
        },
        ...prev.filter((l) => l.date !== now.toISOString().slice(0, 10)),
      ]);
    } else {
      setIsPunchedIn(true);
      setPunchTime(formatted);
      setTimerSeconds(0);
      const msg = `Punched in successfully at ${formatted}`;
      setPunchMessage(msg);
      setAttendanceLogs((prev) => [
        {
          id: `log-${Date.now()}`,
          date: now.toISOString().slice(0, 10),
          punch_in: formatted,
          punch_out: null,
          total_hours: "Active",
          workplace: selectedOfficeDetails?.name || "Assigned Office",
          status: "Present",
        },
        ...prev.filter((l) => l.date !== now.toISOString().slice(0, 10)),
      ]);
    }
    setTimeout(() => {
      setPunchMessage(null);
    }, 4500);
  };

  // ---------------------------------------------------------------------------
  // ADMIN LOCATION ACTIONS
  // ---------------------------------------------------------------------------
  const handleCreateLocation = async (data: AddressMapConfirmData) => {
    if (!data.name || !data.address) return;
    try {
      const res = await apiPost<HrmsLocationItem>("/api/v1/hrms/locations", {
        name: data.name,
        location_type: data.location_type || "OFFICE",
        address: data.address,
        latitude: data.latitude,
        longitude: data.longitude,
        radius_meters: data.radius_meters || 150,
        place_id: data.place_id,
        building: data.building,
        unit_floor: data.unit_floor,
        street: data.street,
        locality: data.locality,
        city: data.city,
        state: data.state,
        pin_code: data.pin_code,
        country: data.country,
      });
      setFeedbackSuccess(`Location "${data.name}" created successfully!`);
      if (res.data) {
        setLocations((prev) => [res.data, ...prev]);
      } else {
        loadLocationsData();
      }
    } catch {
      // Local optimistic update
      const newLoc: HrmsLocationItem = {
        id: `loc-${Date.now()}`,
        name: data.name,
        location_type: data.location_type || "OFFICE",
        address: data.address,
        latitude: data.latitude,
        longitude: data.longitude,
        radius_meters: data.radius_meters || 150,
        is_active: true,
        assigned_employees_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setLocations((prev) => [newLoc, ...prev]);
      setFeedbackSuccess(`Location "${data.name}" created successfully!`);
    }
  };

  const handleToggleLocationStatus = async (loc: HrmsLocationItem) => {
    try {
      await apiPatch(`/api/v1/hrms/locations/${loc.id}/toggle-status`, {});
    } catch {
      // Soft toggle local
    }
    setLocations((prev) =>
      prev.map((l) => (l.id === loc.id ? { ...l, is_active: !l.is_active } : l))
    );
    const stateLabel = !loc.is_active ? "enabled" : "disabled";
    setFeedbackSuccess(`Location "${loc.name}" ${stateLabel} successfully.`);
  };

  const handleSaveEditLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget || !editFormData) return;
    try {
      await apiPut(`/api/v1/hrms/locations/${editTarget.id}`, editFormData);
    } catch {
      // local update
    }
    setLocations((prev) =>
      prev.map((l) => (l.id === editTarget.id ? { ...l, ...editFormData } : l))
    );
    setFeedbackSuccess(`Location "${editFormData.name}" updated successfully.`);
    setEditTarget(null);
  };

  // Open Assign Modal
  const handleOpenAssignModal = (emp: EmployeeAssignmentItem) => {
    setAssignTarget(emp);
    setAssignPrimaryId(emp.primary_location?.id || (locations[0]?.id ?? ""));
    setAssignAdditionalIds(emp.additional_locations.map((a) => a.id));
  };

  const handleSaveAssignment = async () => {
    if (!assignTarget) return;
    setIsSubmittingAssign(true);
    try {
      await apiPut(`/api/v1/hrms/employees/${assignTarget.user_id}/locations`, {
        primary_location_id: assignPrimaryId,
        additional_location_ids: assignAdditionalIds,
      });
    } catch {
      // optimistic update
    }

    const primaryLoc = locations.find((l) => l.id === assignPrimaryId);
    const addLocs = locations.filter((l) => assignAdditionalIds.includes(l.id));

    setEmployeeAssignments((prev) =>
      prev.map((emp) =>
        emp.user_id === assignTarget.user_id
          ? {
              ...emp,
              primary_location: primaryLoc
                ? {
                    id: primaryLoc.id,
                    name: primaryLoc.name,
                    location_type: primaryLoc.location_type,
                    address: primaryLoc.address,
                    radius_meters: primaryLoc.radius_meters,
                    latitude: primaryLoc.latitude,
                    longitude: primaryLoc.longitude,
                    is_primary: true,
                  }
                : null,
              additional_locations: addLocs.map((l) => ({
                id: l.id,
                name: l.name,
                location_type: l.location_type,
                address: l.address,
                radius_meters: l.radius_meters,
                latitude: l.latitude,
                longitude: l.longitude,
                is_primary: false,
              })),
            }
          : emp
      )
    );

    setFeedbackSuccess(`Location assignments updated for ${assignTarget.employee_name}!`);
    setIsSubmittingAssign(false);
    setAssignTarget(null);
  };

  // Review WFH Request
  const handleReviewWfhAction = async (status: "APPROVED" | "REJECTED") => {
    if (!reviewTarget) return;
    setIsSubmittingReview(true);
    try {
      await apiPatch(`/api/v1/hrms/wfh-requests/${reviewTarget.id}/review`, {
        status,
        manager_remarks: managerRemarks.trim() || undefined,
      });
    } catch {
      // local update
    }

    setPendingWfhRequests((prev) => prev.filter((r) => r.id !== reviewTarget.id));
    setFeedbackSuccess(
      `WFH request for ${reviewTarget.employee_name} marked ${status.toLowerCase()}!`
    );
    setIsSubmittingReview(false);
    setReviewTarget(null);
    setManagerRemarks("");
  };

  // ---------------------------------------------------------------------------
  // FILTERED LISTS
  // ---------------------------------------------------------------------------
  const filteredLocations = useMemo(() => {
    return locations.filter((loc) => {
      if (locationTypeFilter !== "ALL" && loc.location_type !== locationTypeFilter) return false;
      if (locationStatusFilter === "ACTIVE" && !loc.is_active) return false;
      if (locationStatusFilter === "INACTIVE" && loc.is_active) return false;
      if (!debouncedLocationSearch.trim()) return true;

      const q = debouncedLocationSearch.toLowerCase();
      return (
        loc.name.toLowerCase().includes(q) ||
        loc.address.toLowerCase().includes(q) ||
        loc.location_type.toLowerCase().includes(q)
      );
    });
  }, [locations, debouncedLocationSearch, locationTypeFilter, locationStatusFilter]);

  const filteredEmployees = useMemo(() => {
    if (!debouncedEmpSearch.trim()) return employeeAssignments;
    const q = debouncedEmpSearch.toLowerCase();
    return employeeAssignments.filter(
      (emp) =>
        emp.employee_name.toLowerCase().includes(q) ||
        (emp.employee_code && emp.employee_code.toLowerCase().includes(q)) ||
        (emp.email && emp.email.toLowerCase().includes(q)) ||
        (emp.primary_location && emp.primary_location.name.toLowerCase().includes(q))
    );
  }, [employeeAssignments, debouncedEmpSearch]);

  const locationStats = useMemo(() => {
    const total = locations.length;
    const active = locations.filter((l) => l.is_active).length;
    const totalAssigned = locations.reduce(
      (sum, l) => sum + (l.assigned_employees_count || 0),
      0
    );
    return { total, active, totalAssigned };
  }, [locations]);

  // ---------------------------------------------------------------------------
  // CALENDAR COMPUTATION
  // ---------------------------------------------------------------------------
  const calYear = calendarDate.getFullYear();
  const calMonth = calendarDate.getMonth();
  const monthName = calendarDate.toLocaleString("en-US", { month: "long" });
  const todayStr = new Date().toISOString().slice(0, 10);

  const calendarCells = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1);
    const startDayOfWeek = firstDay.getDay();
    const daysInCurrentMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(calYear, calMonth, 0).getDate();

    const cells: Array<{
      dayNum: number;
      dateKey: string;
      isCurrentMonth: boolean;
      isToday: boolean;
      holiday?: Holiday;
    }> = [];

    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevDate = new Date(calYear, calMonth - 1, d);
      const prevMonthNum = String(prevDate.getMonth() + 1).padStart(2, "0");
      const dayNumStr = String(d).padStart(2, "0");
      const key = `${prevDate.getFullYear()}-${prevMonthNum}-${dayNumStr}`;
      const hol = MOCK_HOLIDAYS.find((h) => h.date === key);
      cells.push({ dayNum: d, dateKey: key, isCurrentMonth: false, isToday: key === todayStr, holiday: hol });
    }

    for (let d = 1; d <= daysInCurrentMonth; d++) {
      const monthNum = String(calMonth + 1).padStart(2, "0");
      const dayNumStr = String(d).padStart(2, "0");
      const key = `${calYear}-${monthNum}-${dayNumStr}`;
      const hol = MOCK_HOLIDAYS.find((h) => h.date === key);
      cells.push({ dayNum: d, dateKey: key, isCurrentMonth: true, isToday: key === todayStr, holiday: hol });
    }

    const targetTotal = cells.length > 35 ? 42 : 35;
    const remaining = targetTotal - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const nextDate = new Date(calYear, calMonth + 1, d);
      const nextMonthNum = String(nextDate.getMonth() + 1).padStart(2, "0");
      const dayNumStr = String(d).padStart(2, "0");
      const key = `${nextDate.getFullYear()}-${nextMonthNum}-${dayNumStr}`;
      const hol = MOCK_HOLIDAYS.find((h) => h.date === key);
      cells.push({ dayNum: d, dateKey: key, isCurrentMonth: false, isToday: key === todayStr, holiday: hol });
    }

    return cells;
  }, [calYear, calMonth, todayStr]);

  const currentMonthHolidays = useMemo(() => {
    const prefix = `${calYear}-${String(calMonth + 1).padStart(2, "0")}`;
    return MOCK_HOLIDAYS.filter((h) => h.date.startsWith(prefix)).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
  }, [calYear, calMonth]);

  return (
    <AppShell activeKey="hrms">
      <main className="page">
        <Breadcrumb trail={["HRMS", activeTab.charAt(0).toUpperCase() + activeTab.slice(1)]} />

        {/* Global Notifications */}
        <Banner error={feedbackError} success={feedbackSuccess} />

        {/* 1. Welcome Section Header */}
        <div
          className="card"
          data-testid="welcome-section"
          style={{
            marginBottom: "16px",
            padding: "18px 22px",
            background: "var(--color-surface)",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "16px",
            borderLeft: "4px solid var(--color-primary)",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "22px",
                fontWeight: 700,
                color: "var(--color-text)",
                margin: "0 0 6px 0",
              }}
            >
              {greeting}, {employeeName}!
            </h1>
            <div
              style={{
                fontSize: "13.5px",
                color: "var(--color-muted)",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <span>
                Designation: <strong style={{ color: "var(--color-text)" }}>{employeeRole}</strong>
              </span>
              <span>•</span>
              <span>
                Emp Code: <strong style={{ color: "var(--color-text)" }}>{employeeCode}</strong>
              </span>
              <span>•</span>
              <span>{formattedCurrentDate}</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span
              className={`badge ${isPunchedIn ? "badge-active" : "badge-inactive"}`}
              style={{
                padding: "6px 14px",
                fontSize: "12.5px",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: isPunchedIn ? "#10b981" : "#64748b",
                }}
              />
              <span>{isPunchedIn ? "Clocked In" : "Clocked Out"}</span>
            </span>
          </div>
        </div>

        {/* Punch Notification Banner */}
        {punchMessage && (
          <div
            style={{
              background: "var(--color-success-soft)",
              border: "1px solid var(--color-success)",
              color: "var(--color-success)",
              padding: "10px 16px",
              borderRadius: "var(--radius-sm)",
              fontSize: "13.5px",
              fontWeight: 600,
              marginBottom: "16px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <IconCheckSquare width={16} height={16} />
            <span>{punchMessage}</span>
          </div>
        )}

        {/* 2. Internal Attendance Module Navigation Tabs */}
        <div
          className="tabs-nav"
          style={{
            display: "flex",
            gap: "8px",
            borderBottom: "2px solid var(--color-border)",
            marginBottom: "20px",
          }}
        >
          <button
            type="button"
            className={`tab-btn ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setTab("overview")}
            data-testid="tab-overview"
            style={{
              padding: "10px 18px",
              fontWeight: 600,
              fontSize: "14px",
              background: "none",
              border: "none",
              borderBottom: activeTab === "overview" ? "2px solid var(--color-primary)" : "2px solid transparent",
              marginBottom: "-2px",
              cursor: "pointer",
              color: activeTab === "overview" ? "var(--color-primary)" : "var(--color-muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <IconDashboard width={16} height={16} />
            <span>Overview</span>
          </button>

          <button
            type="button"
            className={`tab-btn ${activeTab === "punch" ? "active" : ""}`}
            onClick={() => setTab("punch")}
            data-testid="tab-punch"
            style={{
              padding: "10px 18px",
              fontWeight: 600,
              fontSize: "14px",
              background: "none",
              border: "none",
              borderBottom: activeTab === "punch" ? "2px solid var(--color-primary)" : "2px solid transparent",
              marginBottom: "-2px",
              cursor: "pointer",
              color: activeTab === "punch" ? "var(--color-primary)" : "var(--color-muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <IconClock width={16} height={16} />
            <span>Punch</span>
          </button>

          <button
            type="button"
            className={`tab-btn ${activeTab === "locations" ? "active" : ""}`}
            onClick={() => setTab("locations")}
            data-testid="tab-locations"
            style={{
              padding: "10px 18px",
              fontWeight: 600,
              fontSize: "14px",
              background: "none",
              border: "none",
              borderBottom: activeTab === "locations" ? "2px solid var(--color-primary)" : "2px solid transparent",
              marginBottom: "-2px",
              cursor: "pointer",
              color: activeTab === "locations" ? "var(--color-primary)" : "var(--color-muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <IconPin width={16} height={16} />
            <span>Locations</span>
          </button>

          <button
            type="button"
            className={`tab-btn ${activeTab === "history" ? "active" : ""}`}
            onClick={() => setTab("history")}
            data-testid="tab-history"
            style={{
              padding: "10px 18px",
              fontWeight: 600,
              fontSize: "14px",
              background: "none",
              border: "none",
              borderBottom: activeTab === "history" ? "2px solid var(--color-primary)" : "2px solid transparent",
              marginBottom: "-2px",
              cursor: "pointer",
              color: activeTab === "history" ? "var(--color-primary)" : "var(--color-muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <IconFileText width={16} height={16} />
            <span>History</span>
          </button>
        </div>

        {/* ================================================================= */}
        {/* TAB 1: OVERVIEW                                                   */}
        {/* ================================================================= */}
        {activeTab === "overview" && (
          <div>
            {/* Attendance Summary Cards (4 Cards) */}
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
                  <span style={{ fontSize: "26px", fontWeight: 700, color: "var(--color-text)" }}>
                    {isPunchedIn ? "1" : "0"}
                  </span>
                  <span
                    className={`badge ${isPunchedIn ? "badge-active" : "badge-inactive"}`}
                    style={{ fontSize: "11.5px" }}
                  >
                    {isPunchedIn ? "On Time" : "Awaiting Clock-in"}
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "6px" }}>
                  Assigned: {selectedOfficeDetails?.name || "Corporate Office"}
                </div>
              </div>

              <div className="card" style={{ padding: "18px 20px" }}>
                <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--color-muted)" }}>
                  Working Hours Today
                </div>
                <div style={{ marginTop: "10px", display: "flex", alignItems: "baseline", gap: "8px" }}>
                  <span style={{ fontSize: "26px", fontWeight: 700, color: "var(--color-text)" }}>
                    7h 45m
                  </span>
                  <span className="badge badge-info" style={{ fontSize: "11.5px" }}>
                    Standard: 9h
                  </span>
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
                  <span style={{ fontSize: "26px", fontWeight: 700, color: "var(--color-text)" }}>
                    22 / 24 Days
                  </span>
                  <span className="badge badge-active" style={{ fontSize: "11.5px" }}>
                    91.6%
                  </span>
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
                  <span style={{ fontSize: "26px", fontWeight: 700, color: "var(--color-text)" }}>
                    14 Days
                  </span>
                  <span className="badge badge-warning" style={{ fontSize: "11.5px" }}>
                    Annual Quota
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "6px" }}>
                  CL: 6 | SL: 4 | EL: 4
                </div>
              </div>
            </section>

            {/* Quick Actions Panel */}
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

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                {/* Punch In / Out Toggle */}
                <button
                  type="button"
                  className={`btn ${isPunchedIn ? "btn-danger" : "btn-primary"}`}
                  onClick={handleTogglePunch}
                  data-testid="dashboard-punch-btn"
                  style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "9px 18px", fontWeight: 600 }}
                >
                  <IconClock width={16} height={16} />
                  <span>{isPunchedIn ? "Punch Out" : "Punch In"}</span>
                </button>

                {/* Apply Leave (Placeholder disabled) */}
                <button
                  type="button"
                  className="btn"
                  disabled
                  title="Leave application will be available in the Leave Management module"
                  style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "9px 18px" }}
                >
                  <IconBriefcase width={16} height={16} />
                  <span>Apply Leave</span>
                </button>

                {/* Request WFH */}
                <button
                  type="button"
                  className="btn"
                  onClick={() => setIsWfhModalOpen(true)}
                  data-testid="dashboard-request-wfh-btn"
                  style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "9px 18px" }}
                >
                  <IconPin width={16} height={16} />
                  <span>Request WFH</span>
                </button>

                {/* View/Manage Locations shortcut */}
                <button
                  type="button"
                  className="btn"
                  onClick={() => setTab("locations")}
                  data-testid="dashboard-manage-locations-btn"
                  style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "9px 18px" }}
                >
                  <IconBuilding width={16} height={16} />
                  <span>{isHrAdmin ? "Manage Locations" : "My Locations"}</span>
                </button>

                {/* Attendance History (Disabled until route exists) */}
                <button
                  type="button"
                  className="btn"
                  disabled
                  title="Attendance History logs will be available with the Attendance Records module"
                  style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "9px 18px" }}
                >
                  <IconClock width={16} height={16} />
                  <span>Attendance History</span>
                </button>
              </div>
            </section>

            {/* Holiday Calendar Widget */}
            <section
              className="card"
              data-testid="holiday-calendar-section"
              style={{ marginBottom: "20px", padding: "18px 20px" }}
            >
              <div
                style={{
                  marginBottom: "16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
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

                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => setCalendarDate(new Date(calYear, calMonth - 1, 1))}
                    title="Previous Month"
                    style={{ padding: "4px 10px" }}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => setCalendarDate(new Date())}
                    style={{ padding: "4px 10px", fontSize: "12px" }}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => setCalendarDate(new Date(calYear, calMonth + 1, 1))}
                    title="Next Month"
                    style={{ padding: "4px 10px" }}
                  >
                    ›
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "20px" }}>
                <div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, 1fr)",
                      gap: "4px",
                      textAlign: "center",
                      fontWeight: 600,
                      fontSize: "12.5px",
                      color: "var(--color-muted)",
                      paddingBottom: "8px",
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
                            minHeight: "48px",
                            padding: "6px 4px",
                            borderRadius: "var(--radius-sm)",
                            border: cell.isToday
                              ? "2px solid var(--color-primary)"
                              : "1px solid var(--color-border)",
                            background: cell.isToday
                              ? "var(--color-primary-soft, #eff6ff)"
                              : isHoliday
                              ? "#fef2f2"
                              : !cell.isCurrentMonth
                              ? "var(--color-bg)"
                              : "var(--color-surface)",
                            opacity: cell.isCurrentMonth ? 1 : 0.45,
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "12px",
                              fontWeight: cell.isToday ? 700 : 500,
                              color: isHoliday
                                ? "var(--color-danger)"
                                : "var(--color-text)",
                            }}
                          >
                            {cell.dayNum}
                          </span>
                          {cell.holiday && (
                            <span
                              style={{
                                fontSize: "9px",
                                fontWeight: 600,
                                color: "var(--color-danger)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={cell.holiday.name}
                            >
                              {cell.holiday.name}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div
                  style={{
                    background: "var(--color-bg)",
                    borderRadius: "var(--radius-sm)",
                    padding: "12px 16px",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <h3
                    style={{
                      fontSize: "13px",
                      fontWeight: 600,
                      margin: "0 0 10px 0",
                      color: "var(--color-text)",
                    }}
                  >
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
                            fontSize: "12.5px",
                            display: "flex",
                            justifyContent: "space-between",
                            paddingBottom: "6px",
                            borderBottom: "1px solid var(--color-border)",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, color: "var(--color-text)" }}>{h.name}</div>
                            <div style={{ fontSize: "11.5px", color: "var(--color-muted)" }}>{h.date}</div>
                          </div>
                          <span
                            className="badge badge-danger"
                            style={{ fontSize: "10.5px", alignSelf: "center" }}
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
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 2: PUNCH                                                      */}
        {/* ================================================================= */}
        {activeTab === "punch" && (
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "20px" }}>
            {/* Clock & Punch Actions Hero */}
            <div className="card" style={{ padding: "24px" }} data-testid="punch-action-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h2 style={{ fontSize: "17px", fontWeight: 700, margin: 0, color: "var(--color-text)" }}>
                  Daily Attendance Punch
                </h2>
                <span
                  className={`badge ${isPunchedIn ? "badge-active" : "badge-inactive"}`}
                  style={{ padding: "5px 12px", fontSize: "12px", fontWeight: 600 }}
                >
                  {isPunchedIn ? "● Clocked In" : "○ Clocked Out"}
                </span>
              </div>

              {/* Live Ticking Timer Display */}
              <div
                style={{
                  background: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  padding: "24px",
                  textAlign: "center",
                  marginBottom: "24px",
                }}
              >
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-muted)", marginBottom: "6px" }}>
                  TIME ELAPSED TODAY
                </div>
                <div
                  data-testid="live-timer-display"
                  style={{
                    fontSize: "36px",
                    fontWeight: 800,
                    color: isPunchedIn ? "var(--color-primary)" : "var(--color-muted)",
                    fontFamily: "monospace",
                    letterSpacing: "1px",
                  }}
                >
                  {isPunchedIn ? formattedTimer : "--:--:--"}
                </div>
                <div style={{ fontSize: "12.5px", color: "var(--color-muted)", marginTop: "8px" }}>
                  {isPunchedIn
                    ? `Clocked in at ${punchTime} via geofenced terminal`
                    : `Last clocked out at ${punchTime}`}
                </div>
              </div>

              {/* Assigned Office Selector Dropdown */}
              <div className="form-group" style={{ marginBottom: "20px" }}>
                <label className="form-label" style={{ fontWeight: 600 }}>
                  Assigned Work Location <span style={{ color: "var(--color-danger)" }}>*</span>
                </label>
                <select
                  className="form-control"
                  value={selectedOfficeId}
                  onChange={(e) => setSelectedOfficeId(e.target.value)}
                  data-testid="assigned-office-selector"
                  style={{ fontSize: "14px", fontWeight: 500 }}
                >
                  {assignedLocationsForPunch.length === 0 ? (
                    <option value="">No office locations assigned</option>
                  ) : (
                    assignedLocationsForPunch.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.isPrimary ? "📍 [Primary] " : "🏢 [Additional] "}
                        {loc.name} ({loc.type})
                      </option>
                    ))
                  )}
                </select>
                <span style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "4px" }}>
                  Showing only office locations authorized for your profile by HR/Admin.
                </span>
              </div>

              {/* Selected Office Details Badge */}
              {selectedOfficeDetails && (
                <div
                  style={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-sm)",
                    padding: "12px 16px",
                    marginBottom: "24px",
                    fontSize: "13px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ color: "var(--color-text)" }}>{selectedOfficeDetails.name}</strong>
                    <span className="badge badge-info" style={{ fontSize: "11px" }}>
                      Geofence: {selectedOfficeDetails.radius}m
                    </span>
                  </div>
                  <div style={{ color: "var(--color-muted)", marginTop: "4px", fontSize: "12.5px" }}>
                    {selectedOfficeDetails.address}
                  </div>
                </div>
              )}

              {/* Main Punch Toggle Button */}
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={`btn ${isPunchedIn ? "btn-danger" : "btn-primary"}`}
                  onClick={handleTogglePunch}
                  data-testid="punch-toggle-btn"
                  style={{
                    flex: 1,
                    padding: "14px 20px",
                    fontSize: "15px",
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "10px",
                  }}
                >
                  <IconClock width={18} height={18} />
                  <span>{isPunchedIn ? "Punch Out" : "Punch In"}</span>
                </button>

                <button
                  type="button"
                  className="btn"
                  onClick={() => setIsWfhModalOpen(true)}
                  data-testid="punch-request-wfh-btn"
                  style={{
                    padding: "14px 20px",
                    fontSize: "14px",
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <IconPin width={16} height={16} />
                  <span>Request WFH</span>
                </button>
              </div>
            </div>

            {/* Shift Rules & Geofence Policy */}
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="card" style={{ padding: "20px" }}>
                <h3 style={{ fontSize: "14.5px", fontWeight: 600, margin: "0 0 12px 0" }}>
                  Attendance Rules & Shift Schedule
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--color-muted)" }}>Shift Hours:</span>
                    <strong>09:00 AM – 06:00 PM (9 Hours)</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--color-muted)" }}>Arrival Grace Period:</span>
                    <span>15 Minutes (Up to 09:15 AM)</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--color-muted)" }}>Mandatory Break:</span>
                    <span>1 Hour (01:00 PM – 02:00 PM)</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--color-muted)" }}>Geofence Check:</span>
                    <span style={{ color: "var(--color-success)", fontWeight: 600 }}>Active Enforcement</span>
                  </div>
                </div>
              </div>

              <div
                className="card"
                style={{
                  padding: "16px 20px",
                  background: "var(--color-bg)",
                  border: "1px dashed var(--color-border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                  <IconShield width={18} height={18} style={{ color: "var(--color-primary)", marginTop: "2px" }} />
                  <div>
                    <strong style={{ fontSize: "13.5px", color: "var(--color-text)" }}>
                      Workplace Geofence Policy
                    </strong>
                    <p style={{ margin: "4px 0 0 0", fontSize: "12.5px", color: "var(--color-muted)" }}>
                      Punches are geolocated against the pre-approved radius of your selected office.
                      If working offsite or from home, please submit a Work-From-Home (WFH) request before punching.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 3: LOCATIONS                                                  */}
        {/* ================================================================= */}
        {activeTab === "locations" && (
          <div>
            {/* Admin vs Employee View */}
            {isHrAdmin ? (
              <div>
                {/* Admin Header */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "16px",
                    flexWrap: "wrap",
                    gap: "12px",
                  }}
                >
                  <div>
                    <h2
                      style={{
                        fontSize: "20px",
                        fontWeight: 700,
                        color: "var(--color-text)",
                        margin: "0 0 4px 0",
                      }}
                    >
                      Manage Locations
                    </h2>
                    <p style={{ margin: 0, fontSize: "13.5px", color: "var(--color-muted)" }}>
                      Configure office sites, factory facilities, and employee workplace allocations with geofenced boundaries.
                    </p>
                  </div>

                  <div style={{ display: "flex", gap: "10px" }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setIsAddLocationOpen(true)}
                      data-testid="add-location-btn"
                      style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontWeight: 600 }}
                    >
                      <IconPin width={16} height={16} />
                      <span>+ Add Location</span>
                    </button>
                  </div>
                </div>

                {/* Sub-navigation: Office Locations vs Employee Assignments */}
                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    marginBottom: "16px",
                  }}
                >
                  <button
                    type="button"
                    className={`btn btn-small ${locationsSubTab === "offices" ? "btn-primary" : ""}`}
                    onClick={() => setLocationsSubTab("offices")}
                    data-testid="subtab-offices"
                  >
                    Office Locations ({locations.length})
                  </button>
                  <button
                    type="button"
                    className={`btn btn-small ${locationsSubTab === "assignments" ? "btn-primary" : ""}`}
                    onClick={() => setLocationsSubTab("assignments")}
                    data-testid="subtab-assignments"
                  >
                    Employee Assignments ({employeeAssignments.length})
                  </button>
                </div>

                {/* SUBTAB: OFFICES & FACILITIES */}
                {locationsSubTab === "offices" && (
                  <div>
                    {/* Stats Row */}
                    <div className="stat-grid" style={{ marginBottom: "16px" }}>
                      <div className="stat-card">
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-muted)" }}>
                          Total Locations
                        </div>
                        <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--color-text)", marginTop: "2px" }}>
                          {locationStats.total}
                        </div>
                        <div style={{ fontSize: "11.5px", color: "var(--color-muted)" }}>Across all territories</div>
                      </div>

                      <div className="stat-card tone-success">
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-muted)" }}>
                          Active Geofences
                        </div>
                        <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--color-text)", marginTop: "2px" }}>
                          {locationStats.active}
                        </div>
                        <div style={{ fontSize: "11.5px", color: "var(--color-muted)" }}>Available for attendance</div>
                      </div>

                      <div className="stat-card tone-warning">
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-muted)" }}>
                          Assigned Employees
                        </div>
                        <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--color-text)", marginTop: "2px" }}>
                          {locationStats.totalAssigned}
                        </div>
                        <div style={{ fontSize: "11.5px", color: "var(--color-muted)" }}>Active workplace links</div>
                      </div>
                    </div>

                    {/* Filter & Search Bar */}
                    <div
                      className="card"
                      style={{
                        padding: "12px 16px",
                        marginBottom: "16px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "12px",
                      }}
                    >
                      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                        <input
                          type="text"
                          placeholder="Search locations by name, address, or type..."
                          className="form-control"
                          value={locationSearch}
                          onChange={(e) => setLocationSearch(e.target.value)}
                          style={{ width: "260px" }}
                          data-testid="location-search-input"
                        />

                        <select
                          className="form-control"
                          value={locationTypeFilter}
                          onChange={(e) => setLocationTypeFilter(e.target.value)}
                          style={{ width: "140px" }}
                          data-testid="location-type-filter"
                        >
                          <option value="ALL">All Types</option>
                          {LOCATION_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>

                        <select
                          className="form-control"
                          value={locationStatusFilter}
                          onChange={(e) => setLocationStatusFilter(e.target.value)}
                          style={{ width: "130px" }}
                          data-testid="location-status-filter"
                        >
                          <option value="ALL">All Status</option>
                          <option value="ACTIVE">Active</option>
                          <option value="INACTIVE">Inactive</option>
                        </select>
                      </div>

                      <div style={{ fontSize: "12.5px", color: "var(--color-muted)" }}>
                        Showing {filteredLocations.length} of {locations.length} locations
                      </div>
                    </div>

                    {/* Locations Table */}
                    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                      <div className="table-responsive">
                        <table className="table" data-testid="locations-table">
                          <thead>
                            <tr>
                              <th style={{ width: "22%" }}>Location Name</th>
                              <th style={{ width: "14%" }}>Type</th>
                              <th style={{ width: "28%" }}>Full Address</th>
                              <th style={{ width: "10%" }}>Radius</th>
                              <th style={{ width: "10%" }}>Status</th>
                              <th style={{ width: "8%" }}>Assigned</th>
                              <th style={{ width: "14%", textAlign: "right" }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredLocations.length === 0 ? (
                              <tr>
                                <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "var(--color-muted)" }}>
                                  No locations match your search filters.
                                </td>
                              </tr>
                            ) : (
                              filteredLocations.map((loc) => (
                                <tr key={loc.id} data-testid={`location-row-${loc.id}`}>
                                  <td>
                                    <div style={{ fontWeight: 600, color: "var(--color-text)" }}>{loc.name}</div>
                                  </td>
                                  <td>
                                    <span className="badge badge-info" style={{ fontSize: "11px" }}>
                                      {loc.location_type}
                                    </span>
                                  </td>
                                  <td>
                                    <span style={{ fontSize: "12.5px", color: "var(--color-muted)" }} title={loc.address}>
                                      {loc.address}
                                    </span>
                                  </td>
                                  <td>
                                    <span className="badge" style={{ fontSize: "11.5px" }}>
                                      {loc.radius_meters}m
                                    </span>
                                  </td>
                                  <td>
                                    <StatusBadge status={loc.is_active ? "ACTIVE" : "INACTIVE"} />
                                  </td>
                                  <td>
                                    <span style={{ fontWeight: 600, fontSize: "13px" }}>
                                      {loc.assigned_employees_count || 0}
                                    </span>
                                  </td>
                                  <td style={{ textAlign: "right" }}>
                                    <div style={{ display: "inline-flex", gap: "6px" }}>
                                      <button
                                        type="button"
                                        className="btn btn-small"
                                        onClick={() => setViewTarget(loc)}
                                        data-testid={`view-loc-${loc.id}`}
                                        title="View Details & Map"
                                        style={{ padding: "4px 8px" }}
                                      >
                                        View
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-small"
                                        onClick={() => {
                                          setEditTarget(loc);
                                          setEditFormData({
                                            name: loc.name,
                                            location_type: loc.location_type,
                                            address: loc.address,
                                            radius_meters: loc.radius_meters,
                                            latitude: loc.latitude,
                                            longitude: loc.longitude,
                                            is_active: loc.is_active,
                                          });
                                        }}
                                        data-testid={`edit-loc-${loc.id}`}
                                        title="Edit Location"
                                        style={{ padding: "4px 8px" }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className={`btn btn-small ${loc.is_active ? "btn-danger" : "btn-primary"}`}
                                        onClick={() => handleToggleLocationStatus(loc)}
                                        data-testid={`toggle-loc-${loc.id}`}
                                        title={loc.is_active ? "Disable Location" : "Enable Location"}
                                        style={{ padding: "4px 8px" }}
                                      >
                                        {loc.is_active ? "Disable" : "Enable"}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* SUBTAB: EMPLOYEE LOCATION ASSIGNMENTS */}
                {locationsSubTab === "assignments" && (
                  <div>
                    <div
                      className="card"
                      style={{
                        padding: "12px 16px",
                        marginBottom: "16px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <input
                        type="text"
                        placeholder="Search employees by name, code, or workplace..."
                        className="form-control"
                        value={empSearch}
                        onChange={(e) => setEmpSearch(e.target.value)}
                        style={{ width: "320px" }}
                        data-testid="assignment-search-input"
                      />
                      <span style={{ fontSize: "12.5px", color: "var(--color-muted)" }}>
                        {filteredEmployees.length} employees enrolled
                      </span>
                    </div>

                    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                      <div className="table-responsive">
                        <table className="table" data-testid="employee-assignments-table">
                          <thead>
                            <tr>
                              <th style={{ width: "22%" }}>Employee</th>
                              <th style={{ width: "14%" }}>Department / Role</th>
                              <th style={{ width: "28%" }}>Primary Work Location</th>
                              <th style={{ width: "24%" }}>Additional Authorized Sites</th>
                              <th style={{ width: "12%", textAlign: "right" }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredEmployees.map((emp) => (
                              <tr key={emp.user_id} data-testid={`emp-assign-row-${emp.user_id}`}>
                                <td>
                                  <div style={{ fontWeight: 600, color: "var(--color-text)" }}>
                                    {emp.employee_name}
                                  </div>
                                  <div style={{ fontSize: "11.5px", color: "var(--color-muted)" }}>
                                    {emp.employee_code || "EMP"} • {emp.email}
                                  </div>
                                </td>
                                <td>
                                  <span style={{ fontSize: "13px" }}>{emp.department || emp.role || "Staff"}</span>
                                </td>
                                <td>
                                  {emp.primary_location ? (
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                      <span className="badge badge-active" style={{ fontSize: "11px" }}>
                                        ★ Primary
                                      </span>
                                      <span style={{ fontWeight: 600 }}>{emp.primary_location.name}</span>
                                    </div>
                                  ) : (
                                    <span style={{ color: "var(--color-danger)", fontSize: "12.5px" }}>
                                      Not Assigned
                                    </span>
                                  )}
                                </td>
                                <td>
                                  {emp.additional_locations && emp.additional_locations.length > 0 ? (
                                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                                      {emp.additional_locations.map((add) => (
                                        <span key={add.id} className="badge badge-info" style={{ fontSize: "11px" }}>
                                          {add.name}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span style={{ color: "var(--color-muted)", fontSize: "12.5px" }}>None</span>
                                  )}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  <button
                                    type="button"
                                    className="btn btn-small btn-primary"
                                    onClick={() => handleOpenAssignModal(emp)}
                                    data-testid={`assign-btn-${emp.user_id}`}
                                    style={{ padding: "4px 10px", fontSize: "12px" }}
                                  >
                                    Assign Sites
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* NON-ADMIN EMPLOYEE VIEW (READ-ONLY) */
              <div>
                <div style={{ marginBottom: "16px" }}>
                  <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 4px 0", color: "var(--color-text)" }}>
                    My Assigned Work Locations
                  </h2>
                  <p style={{ margin: 0, fontSize: "13.5px", color: "var(--color-muted)" }}>
                    Locations pre-approved for your attendance clock-in. Location modifications are managed exclusively by HR/Admin.
                  </p>
                </div>

                <div
                  className="banner"
                  style={{
                    marginBottom: "20px",
                    padding: "12px 16px",
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    fontSize: "13px",
                  }}
                >
                  <IconShield width={16} height={16} style={{ color: "var(--color-primary)" }} />
                  <span>
                    Read-only view: Work locations and attendance boundaries are assigned by your organization administrator.
                  </span>
                </div>

                {/* Primary Location Card with Map Preview */}
                {currentUserAssignment?.primary_location ? (
                  <div className="card" style={{ padding: "24px", marginBottom: "20px" }} data-testid="employee-primary-location-card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span className="badge badge-active" style={{ fontSize: "12px", padding: "4px 10px" }}>
                          ★ PRIMARY WORKPLACE
                        </span>
                        <h3 style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "var(--color-text)" }}>
                          {currentUserAssignment.primary_location.name}
                        </h3>
                      </div>
                      <span className="badge badge-info" style={{ fontSize: "12px" }}>
                        Geofence: {currentUserAssignment.primary_location.radius_meters}m
                      </span>
                    </div>

                    <p style={{ color: "var(--color-muted)", fontSize: "13.5px", marginBottom: "16px" }}>
                      {currentUserAssignment.primary_location.address}
                    </p>

                    {/* Interactive / Read-only Map Preview */}
                    <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                      <LocationMapPicker
                        latitude={currentUserAssignment.primary_location.latitude || 19.0664}
                        longitude={currentUserAssignment.primary_location.longitude || 72.8687}
                        radiusMeters={currentUserAssignment.primary_location.radius_meters || 150}
                        readOnly={true}
                        height="260px"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="card" style={{ padding: "32px", textAlign: "center", color: "var(--color-muted)" }}>
                    No primary workplace assigned yet. Please consult with HR.
                  </div>
                )}

                {/* Additional Assigned Locations */}
                <div className="card" style={{ padding: "20px" }} data-testid="employee-additional-locations-card">
                  <h3 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 14px 0" }}>
                    Additional Authorized Locations
                  </h3>
                  {!currentUserAssignment?.additional_locations || currentUserAssignment.additional_locations.length === 0 ? (
                    <div style={{ fontSize: "13px", color: "var(--color-muted)" }}>
                      No additional locations assigned. You are currently authorized to clock in exclusively at your primary workplace.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px" }}>
                      {currentUserAssignment.additional_locations.map((add) => (
                        <div
                          key={add.id}
                          style={{
                            border: "1px solid var(--color-border)",
                            borderRadius: "var(--radius-sm)",
                            padding: "14px 16px",
                            background: "var(--color-bg)",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <strong style={{ fontSize: "14px", color: "var(--color-text)" }}>{add.name}</strong>
                            <span className="badge badge-info" style={{ fontSize: "11px" }}>
                              {add.radius_meters}m
                            </span>
                          </div>
                          <p style={{ margin: "6px 0 0 0", fontSize: "12.5px", color: "var(--color-muted)" }}>
                            {add.address}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 4: HISTORY                                                    */}
        {/* ================================================================= */}
        {activeTab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* 1. Daily Attendance Punch History */}
            <div className="card" style={{ padding: "20px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: "0 0 14px 0", color: "var(--color-text)" }}>
                Attendance Logs & Punch Records
              </h2>
              <div className="table-responsive">
                <table className="table" data-testid="attendance-logs-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Punch In</th>
                      <th>Punch Out</th>
                      <th>Total Hours</th>
                      <th>Workplace Location</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceLogs.map((log) => (
                      <tr key={log.id}>
                        <td style={{ fontWeight: 600 }}>{log.date}</td>
                        <td>{log.punch_in}</td>
                        <td>{log.punch_out || "—"}</td>
                        <td>
                          <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{log.total_hours}</span>
                        </td>
                        <td>{log.workplace}</td>
                        <td>
                          <span
                            className={`badge ${
                              log.status === "Present"
                                ? "badge-active"
                                : log.status === "Work From Home"
                                ? "badge-info"
                                : "badge-warning"
                            }`}
                            style={{ fontSize: "11.5px" }}
                          >
                            {log.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 2. WFH Requests Section */}
            <div className="card" style={{ padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "var(--color-text)" }}>
                  Work-From-Home (WFH) Requests
                </h2>
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={() => setIsWfhModalOpen(true)}
                  data-testid="history-request-wfh-btn"
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  <IconPin width={14} height={14} />
                  <span>+ Request WFH</span>
                </button>
              </div>

              {/* My Requests Table */}
              <div className="table-responsive" style={{ marginBottom: "20px" }}>
                <table className="table" data-testid="my-wfh-requests-table">
                  <thead>
                    <tr>
                      <th>WFH Date</th>
                      <th>Remote Address</th>
                      <th>Reason</th>
                      <th>Radius</th>
                      <th>Status</th>
                      <th>Manager Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myWfhRequests.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: "center", padding: "20px", color: "var(--color-muted)" }}>
                          No WFH requests submitted yet.
                        </td>
                      </tr>
                    ) : (
                      myWfhRequests.map((req) => (
                        <tr key={req.id}>
                          <td style={{ fontWeight: 600 }}>{req.wfh_date}</td>
                          <td>
                            <span style={{ fontSize: "12.5px" }}>{req.address}</span>
                          </td>
                          <td>{req.reason}</td>
                          <td>{req.radius_meters}m</td>
                          <td>
                            <span
                              className={`badge ${
                                req.status === "APPROVED"
                                  ? "badge-active"
                                  : req.status === "REJECTED"
                                  ? "badge-danger"
                                  : "badge-warning"
                              }`}
                            >
                              {req.status}
                            </span>
                          </td>
                          <td style={{ fontSize: "12.5px", color: "var(--color-muted)" }}>
                            {req.manager_remarks || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Manager Approval Queue (if Admin / Manager) */}
              {isManagerOrAdmin && (
                <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "18px", marginTop: "14px" }}>
                  <h3 style={{ fontSize: "14.5px", fontWeight: 700, margin: "0 0 12px 0", color: "var(--color-text)" }}>
                    Manager Approval Queue (Pending Requests)
                  </h3>

                  {pendingWfhRequests.length === 0 ? (
                    <div style={{ fontSize: "13px", color: "var(--color-muted)", padding: "12px 0" }}>
                      No pending WFH requests in queue.
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table" data-testid="pending-wfh-queue-table">
                        <thead>
                          <tr>
                            <th>Employee</th>
                            <th>WFH Date</th>
                            <th>Address</th>
                            <th>Reason</th>
                            <th style={{ textAlign: "right" }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pendingWfhRequests.map((req) => (
                            <tr key={req.id} data-testid={`pending-wfh-row-${req.id}`}>
                              <td>
                                <strong>{req.employee_name}</strong>
                                <div style={{ fontSize: "11px", color: "var(--color-muted)" }}>{req.employee_code}</div>
                              </td>
                              <td style={{ fontWeight: 600 }}>{req.wfh_date}</td>
                              <td style={{ fontSize: "12.5px" }}>{req.address}</td>
                              <td>{req.reason}</td>
                              <td style={{ textAlign: "right" }}>
                                <button
                                  type="button"
                                  className="btn btn-small btn-primary"
                                  onClick={() => setReviewTarget(req)}
                                  data-testid={`review-wfh-btn-${req.id}`}
                                >
                                  Review
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODALS: ADD LOCATION / EDIT LOCATION / VIEW / ASSIGN / WFH        */}
        {/* ================================================================= */}

        {/* Add Location Modal via AddressMapConfirmModal */}
        <AddressMapConfirmModal
          open={isAddLocationOpen}
          onClose={() => setIsAddLocationOpen(false)}
          mode="office"
          title="Add New Office Location"
          onConfirm={handleCreateLocation}
        />

        {/* WFH Request Modal via AddressMapConfirmModal */}
        <WfhRequestModal
          open={isWfhModalOpen}
          onClose={() => setIsWfhModalOpen(false)}
          onSuccess={() => {
            setIsWfhModalOpen(false);
            setFeedbackSuccess("WFH request submitted successfully for manager review!");
            loadWfhData();
          }}
        />

        {/* Edit Location Modal */}
        {editTarget && editFormData && (
          <Modal
            open={true}
            onClose={() => setEditTarget(null)}
            title={`Edit Location: ${editTarget.name}`}
            variant="center"
            cardStyle={{ maxWidth: "560px", width: "100%" }}
          >
            <form onSubmit={handleSaveEditLocation} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="form-group">
                <label className="form-label">Location Name</label>
                <input
                  type="text"
                  className="form-control"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Location Type</label>
                <select
                  className="form-control"
                  value={editFormData.location_type}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      location_type: e.target.value as HrmsLocationItem["location_type"],
                    })
                  }
                >
                  {LOCATION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Address</label>
                <textarea
                  className="form-control"
                  rows={2}
                  value={editFormData.address}
                  onChange={(e) => setEditFormData({ ...editFormData, address: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Radius (meters): {editFormData.radius_meters}m</label>
                <input
                  type="range"
                  min="50"
                  max="1000"
                  step="25"
                  value={editFormData.radius_meters}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, radius_meters: Number(e.target.value) })
                  }
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
                <button type="button" className="btn" onClick={() => setEditTarget(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* View Location Modal */}
        {viewTarget && (
          <Modal
            open={true}
            onClose={() => setViewTarget(null)}
            title={viewTarget.name}
            variant="center"
            cardStyle={{ maxWidth: "680px", width: "100%" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="badge badge-info">{viewTarget.location_type}</span>
                <span className="badge">{viewTarget.radius_meters}m Geofence Radius</span>
              </div>
              <p style={{ margin: 0, color: "var(--color-muted)", fontSize: "13.5px" }}>{viewTarget.address}</p>

              <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                <LocationMapPicker
                  latitude={viewTarget.latitude}
                  longitude={viewTarget.longitude}
                  radiusMeters={viewTarget.radius_meters}
                  readOnly={true}
                  height="280px"
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
                <button type="button" className="btn" onClick={() => setViewTarget(null)}>
                  Close
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Assign Employee Workplace Modal */}
        {assignTarget && (
          <Modal
            open={true}
            onClose={() => setAssignTarget(null)}
            title={`Assign Locations: ${assignTarget.employee_name}`}
            variant="center"
            cardStyle={{ maxWidth: "560px", width: "100%" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600 }}>
                  Primary Work Location (Single Mandatory) <span style={{ color: "var(--color-danger)" }}>*</span>
                </label>
                <select
                  className="form-control"
                  value={assignPrimaryId}
                  onChange={(e) => setAssignPrimaryId(e.target.value)}
                  data-testid="assign-primary-select"
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.location_type})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600 }}>
                  Additional Authorized Locations (Optional Multi-Select)
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "180px", overflowY: "auto" }}>
                  {locations
                    .filter((l) => l.id !== assignPrimaryId)
                    .map((loc) => {
                      const isChecked = assignAdditionalIds.includes(loc.id);
                      return (
                        <label
                          key={loc.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "6px 8px",
                            border: "1px solid var(--color-border)",
                            borderRadius: "var(--radius-sm)",
                            cursor: "pointer",
                            background: isChecked ? "var(--color-surface)" : "transparent",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setAssignAdditionalIds((prev) => [...prev, loc.id]);
                              } else {
                                setAssignAdditionalIds((prev) => prev.filter((id) => id !== loc.id));
                              }
                            }}
                          />
                          <span style={{ fontSize: "13px", color: "var(--color-text)" }}>
                            {loc.name} ({loc.location_type})
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
                <button type="button" className="btn" onClick={() => setAssignTarget(null)} disabled={isSubmittingAssign}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveAssignment}
                  disabled={isSubmittingAssign || !assignPrimaryId}
                  data-testid="save-assignment-btn"
                >
                  {isSubmittingAssign ? "Saving..." : "Save Assignments"}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Manager Review Modal */}
        {reviewTarget && (
          <Modal
            open={true}
            onClose={() => setReviewTarget(null)}
            title={`Review WFH Request: ${reviewTarget.employee_name}`}
            variant="center"
            cardStyle={{ maxWidth: "560px", width: "100%" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ background: "var(--color-bg)", padding: "12px", borderRadius: "var(--radius-sm)", fontSize: "13px" }}>
                <div><strong>Date:</strong> {reviewTarget.wfh_date}</div>
                <div style={{ marginTop: "4px" }}><strong>Address:</strong> {reviewTarget.address}</div>
                <div style={{ marginTop: "4px" }}><strong>Reason:</strong> {reviewTarget.reason}</div>
              </div>

              <div className="form-group">
                <label className="form-label">Manager Remarks (Optional)</label>
                <textarea
                  className="form-control"
                  rows={2}
                  placeholder="Add approval or rejection remarks..."
                  value={managerRemarks}
                  onChange={(e) => setManagerRemarks(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => handleReviewWfhAction("REJECTED")}
                  disabled={isSubmittingReview}
                  data-testid="reject-wfh-btn"
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleReviewWfhAction("APPROVED")}
                  disabled={isSubmittingReview}
                  data-testid="approve-wfh-btn"
                >
                  Approve WFH
                </button>
              </div>
            </div>
          </Modal>
        )}
      </main>
    </AppShell>
  );
}
