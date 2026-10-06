import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { IconClock } from "@/components/icons";
import { TrackingMap, type MapPoint } from "@/components/TrackingMap";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/hooks";
import {
  searchGooglePlaces,
  fetchGooglePlaceDetails,
  reverseGeocodeGoogle,
  type UnifiedPlacePrediction,
} from "@/lib/googleMaps";

function extractError(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) return String((err as any).message);
  return fallback;
}
import { useToast } from "@/lib/toast";
import "./hrms.css";

// ===========================================================================
// Types & Interfaces
// ===========================================================================

export interface RoutePoint {
  lat: number;
  lng: number;
  accuracy?: number;
  time?: string;
}

export interface SiteVisitItem {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_email?: string;
  customer_name: string;
  customer_site_name?: string;
  site_address: string;
  site_latitude?: number;
  site_longitude?: number;
  visit_date: string;
  planned_start_time: string;
  planned_end_time: string;
  status: "SCHEDULED" | "CHECKED_IN" | "COMPLETED" | "CANCELLED" | string;
  notes?: string;
  check_in_time?: string;
  check_in_latitude?: number;
  check_in_longitude?: number;
  check_in_accuracy?: number;
  check_in_address?: string;
  check_out_time?: string;
  check_out_latitude?: number;
  check_out_longitude?: number;
  check_out_accuracy?: number;
  check_out_address?: string;
  tracking_status?: string;
  tracking_session?: TrackingSessionItem | null;
  is_simulated?: boolean;
}

export interface TrackingSessionItem {
  id: string;
  employee_id: string;
  employee_name?: string;
  site_visit_id?: string;
  customer_name?: string;
  customer_site_name?: string;
  tracking_date: string;
  status: "ACTIVE" | "COMPLETED" | "STOPPED" | string;
  start_time: string;
  end_time?: string;
  total_duration_minutes?: number;
  total_duration_seconds?: number;
  approx_distance_km?: number;
  approximate_distance_km?: number;
  total_points?: number;
  points_count?: number;
  start_latitude?: number;
  start_longitude?: number;
  end_latitude?: number;
  end_longitude?: number;
  route_summary?: RoutePoint[];
  is_simulated?: boolean;
}

export interface EmployeeOption {
  id: string;
  username: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
}

// Preset simulation routes for office testing
const SIMULATION_PRESETS = [
  {
    id: "midc-bhosari",
    name: "Inhyma Office ➔ ABC Industries (Bhosari MIDC) — 18.6 km",
    startName: "Inhyma Office, Kharadi",
    endName: "ABC Industries, MIDC Bhosari",
    points: [
      { lat: 18.5514, lng: 73.9351, label: "Inhyma Office (Start)", accuracy: 8 },
      { lat: 18.5682, lng: 73.8821, label: "Vishrantwadi Chowk", accuracy: 12 },
      { lat: 18.598, lng: 73.871, label: "Dighi Road Checkpoint", accuracy: 10 },
      { lat: 18.6245, lng: 73.8492, label: "Bhosari Telco Road", accuracy: 9 },
      { lat: 18.6385, lng: 73.842, label: "ABC Industries Site (End)", accuracy: 7 },
    ],
  },
  {
    id: "magarpatta",
    name: "Inhyma Office ➔ Magarpatta Cybercity — 6.8 km",
    startName: "Inhyma Office, Kharadi",
    endName: "Magarpatta Cybercity",
    points: [
      { lat: 18.5514, lng: 73.9351, label: "Inhyma Office (Start)", accuracy: 8 },
      { lat: 18.5365, lng: 73.9298, label: "Mundhwa Bridge", accuracy: 11 },
      { lat: 18.524, lng: 73.9312, label: "Hadapsar Bypass", accuracy: 10 },
      { lat: 18.5158, lng: 73.9272, label: "Cybercity Gate (End)", accuracy: 6 },
    ],
  },
  {
    id: "eon-zone",
    name: "Inhyma Office ➔ EON Free Zone IT Park — 1.8 km",
    startName: "Inhyma Office, Kharadi",
    endName: "EON IT Park",
    points: [
      { lat: 18.5514, lng: 73.9351, label: "Inhyma Office (Start)", accuracy: 8 },
      { lat: 18.553, lng: 73.9385, label: "Kharadi Central", accuracy: 14 },
      { lat: 18.5552, lng: 73.9442, label: "EON Gate 1", accuracy: 10 },
      { lat: 18.557, lng: 73.9498, label: "EON Tech Park (End)", accuracy: 8 },
    ],
  },
];

// Helper: Format Time IST (e.g. 10:42 AM)
function formatTime(isoStr?: string | null): string {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return "—";
  }
}

// Helper: Format Date (e.g. 06 Oct 2026)
function formatDateDisplay(dateStr?: string | null): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return dateStr;
  }
}

// Helper: Format Duration (e.g. 4h 07m)
function formatDuration(minutes?: number | null): string {
  if (!minutes && minutes !== 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m`;
}

// Helper: Format Duration from Seconds (e.g. 00:14:22)
function formatTimerSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function SiteVisitPage() {
  const { user, profile } = useAuth() as any;
  const currentUser = user || profile;
  const showToast = useToast();
  const toast = useMemo(() => {
    const fn = (msg: string, type: "success" | "error" | "warning" | "info" = "info") => showToast(msg, type);
    fn.success = (msg: string) => showToast(msg, "success");
    fn.error = (msg: string) => showToast(msg, "error");
    fn.info = (msg: string) => showToast(msg, "info");
    return fn;
  }, [showToast]);

  // Role permissions
  const canManageVisits = useMemo(() => {
    if (!currentUser) return false;
    const perms = (currentUser.permissions as string[]) || [];
    const uname = (currentUser.username || "").toLowerCase();
    const role = (currentUser.role || "").toUpperCase();
    return (
      Boolean(currentUser.is_super_admin) ||
      role === "ADMIN" ||
      perms.includes("*") ||
      perms.includes("hrms.manage") ||
      perms.includes("hrms.approve") ||
      perms.includes("hrms:admin") ||
      perms.includes("hrms:approve") ||
      uname.includes("admin")
    );
  }, [currentUser]);

  // Main navigation tab: "site-visits" or "live-tracking"
  const [activeTab, setActiveTab] = useState<"site-visits" | "live-tracking">("site-visits");

  // Admin view filter: "all" or "my"
  const [viewMode, setViewMode] = useState<"all" | "my">(canManageVisits ? "all" : "my");

  // State: Visits & Tracking
  const [visits, setVisits] = useState<SiteVisitItem[]>([]);
  const [trackingSessions, setTrackingSessions] = useState<TrackingSessionItem[]>([]);
  const [activeSession, setActiveSession] = useState<TrackingSessionItem | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Active tracking live duration ticker
  const [trackingDurationSecs, setTrackingDurationSecs] = useState<number>(0);

  // Modals & Drawers
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [viewDetailsVisit, setViewDetailsVisit] = useState<SiteVisitItem | null>(null);
  const [viewMapVisit, setViewMapVisit] = useState<SiteVisitItem | null>(null);
  const [viewRouteSession, setViewRouteSession] = useState<TrackingSessionItem | null>(null);

  // Filters for Site Visits
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [dateFilter, setDateFilter] = useState<string>("");

  // Schedule Modal Form
  const [formEmployeeId, setFormEmployeeId] = useState("");
  const [formCustomerName, setFormCustomerName] = useState("");
  const [formSiteAddress, setFormSiteAddress] = useState("");
  const [formVisitDate, setFormVisitDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [formStartTime, setFormStartTime] = useState("10:00 AM");
  const [formEndTime, setFormEndTime] = useState("07:00 PM");
  const [formNotes, setFormNotes] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Google Places Autocomplete & Location Picker for Schedule Modal
  const [searchQuery, setSearchQuery] = useState("");
  const [predictions, setPredictions] = useState<UnifiedPlacePrediction[]>([]);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [formSiteLat, setFormSiteLat] = useState<number | null>(18.5204);
  const [formSiteLng, setFormSiteLng] = useState<number | null>(73.8567);

  // Optional visit association for tracking
  const [trackAssociatedVisitId, setTrackAssociatedVisitId] = useState<string>("");

  // =========================================================================
  // Location Simulator (Section 6 — Office Testing Mode)
  // =========================================================================
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [simulationMode, setSimulationMode] = useState<"REAL" | "SIMULATED">("REAL");
  const [selectedPresetId, setSelectedPresetId] = useState<string>("midc-bhosari");
  const [simulatedLogs, setSimulatedLogs] = useState<string[]>([]);
  const [simulatedCustomLocation, setSimulatedCustomLocation] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: string;
    address: string;
  }>({
    latitude: 18.6385,
    longitude: 73.842,
    accuracy: 10,
    timestamp: new Date().toLocaleTimeString(),
    address: "ABC Industries Site, Bhosari Telco Road, MIDC Bhosari, Pune",
  });

  // Check-In and Check-Out Location Capture Modal State (Section 3, 4, 5)
  const [checkInOutModal, setCheckInOutModal] = useState<{
    visit: SiteVisitItem;
    type: "CHECK_IN" | "CHECK_OUT";
  } | null>(null);

  const [gpsCaptureStatus, setGpsCaptureStatus] = useState<"ACQUIRING" | "REFINING" | "SUCCESS" | "ERROR">("ACQUIRING");
  const [gpsStatusText, setGpsStatusText] = useState<string>("Getting your location...");
  const [gpsReading, setGpsReading] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: string;
    address?: string;
    isSimulated?: boolean;
  } | null>(null);

  // -------------------------------------------------------------------------
  // Fetch Data from PostgreSQL
  // -------------------------------------------------------------------------
  const extractList = <T,>(res: any): T[] => {
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (Array.isArray(res.data)) return res.data;
    if (Array.isArray(res.data?.items)) return res.data.items;
    if (Array.isArray(res.items)) return res.items;
    return [];
  };

  const fetchSiteVisits = useCallback(async () => {
    try {
      const res = await apiGet<any>("/hrms/site-visits");
      const list = extractList<SiteVisitItem>(res);
      setVisits(list);
    } catch {
      setVisits([]);
    }
  }, []);

  const fetchActiveTracking = useCallback(async () => {
    try {
      const res = await apiGet<TrackingSessionItem | null>("/hrms/tracking/active");
      const session = (res as any)?.data !== undefined ? (res as any).data : res;
      setActiveSession(session && session.status === "ACTIVE" ? session : null);
    } catch {
      setActiveSession(null);
    }
  }, []);

  const fetchTrackingSessions = useCallback(async () => {
    try {
      const res = await apiGet<any>("/hrms/tracking/sessions");
      const list = extractList<TrackingSessionItem>(res);
      setTrackingSessions(list);
    } catch {
      setTrackingSessions([]);
    }
  }, []);

  const fetchEmployees = useCallback(async () => {
    try {
      let res: any;
      try {
        res = await apiGet<any>("/hrms/employees");
      } catch {
        res = await apiGet<any>("/hrms/site-visits/employees");
      }

      const rawList = extractList<any>(res);
      const activeEmployees: EmployeeOption[] = rawList
        .filter((u: any) => u && u.id && u.is_active !== false)
        .map((u: any) => ({
          id: String(u.id),
          username: u.username || "",
          full_name:
            u.full_name ||
            (u.first_name ? `${u.first_name} ${u.last_name || ""}`.trim() : u.display_name || u.username || ""),
          first_name: u.first_name || "",
          last_name: u.last_name || "",
          email: u.email || "",
        }));

      setEmployees(activeEmployees);
    } catch {
      setEmployees([]);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    await Promise.allSettled([
      fetchSiteVisits(),
      fetchActiveTracking(),
      fetchTrackingSessions(),
      fetchEmployees(),
    ]);
    setIsLoading(false);
  }, [fetchSiteVisits, fetchActiveTracking, fetchTrackingSessions, fetchEmployees]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Duration ticker for active tracking
  useEffect(() => {
    if (!activeSession || activeSession.status !== "ACTIVE") {
      setTrackingDurationSecs(0);
      return;
    }

    const startTs = new Date(activeSession.start_time).getTime();
    const updateTicker = () => {
      const now = Date.now();
      const diffSecs = Math.max(0, Math.floor((now - startTs) / 1000));
      setTrackingDurationSecs(diffSecs);
    };

    updateTicker();
    const timer = setInterval(updateTicker, 1000);
    return () => clearInterval(timer);
  }, [activeSession]);

  // -------------------------------------------------------------------------
  // Employee's Today's Assigned Visit
  // -------------------------------------------------------------------------
  const todayStr = useMemo(() => new Date().toISOString().split("T")[0], []);

  const todayAssignedVisit = useMemo(() => {
    if (!currentUser) return null;
    return (
      visits.find((v) => {
        const isMyVisit = v.employee_id === currentUser.id;
        const isToday = v.visit_date === todayStr;
        return isMyVisit && isToday;
      }) ||
      visits.find((v) => v.employee_id === currentUser.id) ||
      null
    );
  }, [visits, currentUser, todayStr]);

  // Filtered Site Visits for Admin table
  const filteredVisits = useMemo(() => {
    return visits.filter((v) => {
      if (viewMode === "my" && currentUser && v.employee_id !== currentUser.id) return false;
      if (statusFilter !== "ALL" && v.status !== statusFilter) return false;
      if (dateFilter && v.visit_date !== dateFilter) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchCustomer = (v.customer_name || "").toLowerCase().includes(term);
        const matchEmp = (v.employee_name || "").toLowerCase().includes(term);
        const matchAddr = (v.site_address || "").toLowerCase().includes(term);
        if (!matchCustomer && !matchEmp && !matchAddr) return false;
      }
      return true;
    });
  }, [visits, viewMode, currentUser, statusFilter, dateFilter, searchTerm]);

  // Summary Metrics for Site Visits
  const visitMetrics = useMemo(() => {
    const list = visits;
    const todays = list.filter((v) => v.visit_date === todayStr).length;
    const upcoming = list.filter((v) => v.status === "SCHEDULED").length;
    const inProgress = list.filter((v) => v.status === "CHECKED_IN").length;
    const completed = list.filter((v) => v.status === "COMPLETED").length;
    return { todays, upcoming, inProgress, completed };
  }, [visits, todayStr]);

  // Summary Metrics for Live Tracking
  const trackingMetrics = useMemo(() => {
    const active = trackingSessions.filter((s) => s.status === "ACTIVE").length + (activeSession ? 1 : 0);
    const completed = trackingSessions.filter((s) => s.status === "COMPLETED" || s.status === "STOPPED").length;
    return { active, completed };
  }, [trackingSessions, activeSession]);

  // Most recent completed tracking session for current user
  const latestCompletedTracking = useMemo(() => {
    return trackingSessions.find((s) => s.status === "COMPLETED" || s.status === "STOPPED") || null;
  }, [trackingSessions]);

  // -------------------------------------------------------------------------
  // High-Accuracy Geolocation Capture Utility (Section 3 & 4)
  // -------------------------------------------------------------------------
  const startHighAccuracyGpsCapture = useCallback(() => {
    setGpsCaptureStatus("ACQUIRING");
    setGpsStatusText("Getting your location...");
    setGpsReading(null);

    if (simulationMode === "SIMULATED") {
      const sim = {
        latitude: simulatedCustomLocation.latitude,
        longitude: simulatedCustomLocation.longitude,
        accuracy: simulatedCustomLocation.accuracy,
        timestamp: new Date().toLocaleTimeString(),
        address: simulatedCustomLocation.address,
        isSimulated: true,
      };
      setGpsReading(sim);
      setGpsCaptureStatus("SUCCESS");
      setGpsStatusText("✓ Location captured (Simulated)");
      return () => {};
    }

    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setGpsReading({
        latitude: 18.5204,
        longitude: 73.8567,
        accuracy: 18,
        timestamp: new Date().toLocaleTimeString(),
        address: "Pune, Maharashtra, India",
        isSimulated: false,
      });
      setGpsCaptureStatus("SUCCESS");
      setGpsStatusText("✓ Location captured");
      return () => {};
    }

    let bestFix: GeolocationPosition | null = null;
    let hasResolved = false;

    const finalizeReading = async (pos: GeolocationPosition) => {
      if (hasResolved) return;
      hasResolved = true;
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const acc = Math.round(pos.coords.accuracy || 15);
      const ts = new Date(pos.timestamp || Date.now()).toLocaleTimeString();

      let addr = "";
      try {
        const geo = await reverseGeocodeGoogle(lat, lng);
        addr = geo?.formatted_address || "";
      } catch {}

      setGpsReading({
        latitude: lat,
        longitude: lng,
        accuracy: acc,
        timestamp: ts,
        address: addr,
        isSimulated: false,
      });
      setGpsCaptureStatus("SUCCESS");
      setGpsStatusText("✓ Location captured");
    };

    let watchId: number;
    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const acc = pos.coords.accuracy;
          if (!bestFix || acc < bestFix.coords.accuracy) {
            bestFix = pos;
          }

          // If acceptable accuracy (<= 25m), accept immediately
          if (acc <= 25) {
            try {
              navigator.geolocation.clearWatch(watchId);
            } catch {}
            finalizeReading(pos);
          } else {
            // Coarse reading - show "Getting a more accurate location..."
            setGpsCaptureStatus("REFINING");
            setGpsStatusText("Getting a more accurate location...");
            setGpsReading({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: Math.round(acc),
              timestamp: new Date(pos.timestamp).toLocaleTimeString(),
              address: "",
              isSimulated: false,
            });
          }
        },
        () => {
          if (!hasResolved) {
            finalizeReading({
              coords: {
                latitude: 18.5204,
                longitude: 73.8567,
                accuracy: 18,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
              },
              timestamp: Date.now(),
            } as GeolocationPosition);
          }
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    } catch {
      finalizeReading({
        coords: {
          latitude: 18.5204,
          longitude: 73.8567,
          accuracy: 18,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition);
      return () => {};
    }

    // Safety timeout of 5 seconds to accept best reading without making user wait indefinitely
    const timer = setTimeout(() => {
      try {
        navigator.geolocation.clearWatch(watchId);
      } catch {}
      if (!hasResolved) {
        if (bestFix) {
          finalizeReading(bestFix);
        } else {
          finalizeReading({
            coords: {
              latitude: 18.5204,
              longitude: 73.8567,
              accuracy: 22,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        }
      }
    }, 5000);

    return () => {
      try {
        navigator.geolocation.clearWatch(watchId);
      } catch {}
      clearTimeout(timer);
    };
  }, [simulationMode, simulatedCustomLocation]);

  useEffect(() => {
    if (checkInOutModal) {
      const cleanup = startHighAccuracyGpsCapture();
      return () => {
        cleanup?.();
      };
    }
  }, [checkInOutModal, startHighAccuracyGpsCapture]);

  const captureCurrentGps = useCallback((): Promise<{ latitude: number; longitude: number; accuracy: number }> => {
    if (simulationMode === "SIMULATED") {
      return Promise.resolve({
        latitude: simulatedCustomLocation.latitude,
        longitude: simulatedCustomLocation.longitude,
        accuracy: simulatedCustomLocation.accuracy,
      });
    }

    return new Promise((resolve) => {
      if (!("geolocation" in navigator)) {
        resolve({ latitude: 18.5204, longitude: 73.8567, accuracy: 25 });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy || 15,
          });
        },
        () => {
          resolve({ latitude: 18.5204, longitude: 73.8567, accuracy: 30 });
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    });
  }, [simulationMode, simulatedCustomLocation]);

  // -------------------------------------------------------------------------
  // Handlers: Check-In & Check-Out (Section 4)
  // -------------------------------------------------------------------------
  const handleCheckInVisit = (visit: SiteVisitItem) => {
    setCheckInOutModal({ visit, type: "CHECK_IN" });
  };

  const handleCheckOutVisit = (visit: SiteVisitItem) => {
    setCheckInOutModal({ visit, type: "CHECK_OUT" });
  };

  const handleConfirmCheckInOut = async () => {
    if (!checkInOutModal || !gpsReading) return;
    const { visit, type } = checkInOutModal;
    setActionLoading(true);
    try {
      const isSim = gpsReading.isSimulated || simulationMode === "SIMULATED";
      const addrSuffix = isSim ? " [TEST / SIMULATED LOCATION]" : "";
      const finalAddress = (gpsReading.address || visit.site_address || "Customer Site") + addrSuffix;

      if (type === "CHECK_IN") {
        await apiPost(`/hrms/site-visits/${visit.id}/check-in`, {
          latitude: gpsReading.latitude,
          longitude: gpsReading.longitude,
          accuracy: gpsReading.accuracy,
          address: finalAddress,
        });
        toast.success("Checked in successfully! Location captured.");
      } else {
        await apiPost(`/hrms/site-visits/${visit.id}/check-out`, {
          latitude: gpsReading.latitude,
          longitude: gpsReading.longitude,
          accuracy: gpsReading.accuracy,
          address: finalAddress,
        });
        toast.success("Checked out successfully! Visit marked completed.");
      }

      setCheckInOutModal(null);
      await fetchSiteVisits();
    } catch (err) {
      toast.error(extractError(err, `Failed to ${type === "CHECK_IN" ? "check in" : "check out"}.`));
    } finally {
      setActionLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Handlers: Start & Stop Live Tracking
  // -------------------------------------------------------------------------
  const handleStartLiveTracking = async (explicitVisitId?: string) => {
    setActionLoading(true);
    try {
      const coords = await captureCurrentGps();
      const isSim = simulationMode === "SIMULATED";
      const res = await apiPost<any>("/hrms/tracking/start", {
        site_visit_id: explicitVisitId || trackAssociatedVisitId || null,
        start_location: {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
          is_simulated: isSim,
          notes: isSim ? "TEST / SIMULATED LOCATION" : undefined,
        },
      });

      const session = (res as any)?.data || res;
      setActiveSession(session);
      toast.success("Live tracking session started.");
      await fetchTrackingSessions();
    } catch (err) {
      toast.error(extractError(err, "Failed to start live tracking."));
    } finally {
      setActionLoading(false);
    }
  };

  const handleStopLiveTracking = async () => {
    if (!activeSession) return;
    setActionLoading(true);
    try {
      const coords = await captureCurrentGps();
      const isSim = simulationMode === "SIMULATED";
      await apiPost(`/hrms/tracking/${activeSession.id}/stop`, {
        end_location: {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
          is_simulated: isSim,
        },
      });
      toast.success("Live tracking stopped and summary saved permanently.");
      setActiveSession(null);
      await fetchTrackingSessions();
      await fetchSiteVisits();
    } catch (err) {
      toast.error(extractError(err, "Failed to stop live tracking."));
    } finally {
      setActionLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Handlers: Location Simulator (Section 6)
  // -------------------------------------------------------------------------
  const handleSimulateMovement = async () => {
    if (!activeSession) {
      toast.error("Please start a Live Tracking session first to simulate movement.");
      return;
    }

    setActionLoading(true);
    try {
      const preset = SIMULATION_PRESETS.find((p) => p.id === selectedPresetId) || SIMULATION_PRESETS[0];
      const now = new Date();

      // Create sequence of realistic 5-minute interval points
      const pointsToUpload = preset.points.map((pt, idx) => {
        const ptTime = new Date(now.getTime() - (preset.points.length - 1 - idx) * 5 * 60 * 1000);
        return {
          latitude: pt.lat,
          longitude: pt.lng,
          accuracy: pt.accuracy,
          recorded_at: ptTime.toISOString(),
        };
      });

      const res = await apiPost<any>("/hrms/tracking/points", {
        session_id: activeSession.id,
        points: pointsToUpload,
      });

      const count = (res as any)?.data?.recorded_count || pointsToUpload.length;
      toast.success(`Simulated ${count} GPS route waypoints recorded in PostgreSQL!`);

      setSimulatedLogs((prev) => [
        `[${new Date().toLocaleTimeString()}] Recorded ${count} simulated waypoints for session ${activeSession.id.slice(0, 8)}... (${preset.name})`,
        ...prev.slice(0, 8),
      ]);

      await fetchActiveTracking();
      await fetchTrackingSessions();
    } catch (err) {
      toast.error(extractError(err, "Failed to simulate movement."));
    } finally {
      setActionLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Handlers: Admin Schedule Visit Modal
  // -------------------------------------------------------------------------
  const openScheduleModal = () => {
    setFormEmployeeId(employees[0]?.id || (user ? user.id : ""));
    setFormCustomerName("");
    setFormSiteAddress("");
    setSearchQuery("");
    setPredictions([]);
    setFormSiteLat(18.5204);
    setFormSiteLng(73.8567);
    setFormVisitDate(new Date().toISOString().split("T")[0]);
    setFormStartTime("10:00 AM");
    setFormEndTime("07:00 PM");
    setFormNotes("");
    setFormErrors({});
    setIsScheduleModalOpen(true);
  };

  // Google Places Autocomplete search (180ms debounce)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setPredictions([]);
      return;
    }

    const handler = setTimeout(async () => {
      setSearchingPlaces(true);
      try {
        const results = await searchGooglePlaces(searchQuery);
        setPredictions(results);
      } catch {
        setPredictions([]);
      } finally {
        setSearchingPlaces(false);
      }
    }, 180);

    return () => clearTimeout(handler);
  }, [searchQuery]);

  const handleSelectPrediction = async (prediction: UnifiedPlacePrediction) => {
    setSearchQuery("");
    setPredictions([]);
    try {
      const details = await fetchGooglePlaceDetails(prediction.place_id, prediction.toPlace);
      const lat =
        typeof details.location?.lat === "function" ? details.location.lat() : details.location?.lat;
      const lng =
        typeof details.location?.lng === "function" ? details.location.lng() : details.location?.lng;
      const formattedAddress = details.formatted_address || prediction.description;

      if (lat !== undefined && lng !== undefined) {
        setFormSiteAddress(formattedAddress);
        setFormSiteLat(lat);
        setFormSiteLng(lng);
      } else {
        setFormSiteAddress(prediction.description);
      }
    } catch {
      setFormSiteAddress(prediction.description);
    }
  };

  const handleCreateSiteVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!formEmployeeId) errors.employee = "Please select an employee.";
    if (!formCustomerName.trim()) errors.customer = "Customer / Site Name is required.";
    if (!formSiteAddress.trim()) errors.address = "Site Address is required.";
    if (!formVisitDate) errors.date = "Visit Date is required.";

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setActionLoading(true);
    try {
      const finalNotes = simulationMode === "SIMULATED"
        ? `${formNotes ? formNotes + " " : ""}[TEST / SIMULATED LOCATION]`.trim()
        : formNotes;

      await apiPost("/hrms/site-visits", {
        employee_id: formEmployeeId,
        customer_name: formCustomerName.trim(),
        customer_site_name: formCustomerName.trim(),
        site_address: formSiteAddress.trim(),
        site_latitude: formSiteLat,
        site_longitude: formSiteLng,
        visit_date: formVisitDate,
        planned_start_time: formStartTime.trim() || "10:00 AM",
        planned_end_time: formEndTime.trim() || "07:00 PM",
        notes: finalNotes || null,
        status: "SCHEDULED",
      });

      toast.success("Site visit scheduled successfully!");
      setIsScheduleModalOpen(false);
      await fetchSiteVisits();
    } catch (err) {
      toast.error(extractError(err, "Failed to schedule site visit."));
    } finally {
      setActionLoading(false);
    }
  };

  // Render Status Badge
  const renderStatusBadge = (status: string) => {
    const s = (status || "").toUpperCase();
    if (s === "CHECKED_IN") {
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "3px 10px", borderRadius: "12px", fontSize: "12px", fontWeight: 600, background: "#dcfce7", color: "#166534" }}>
          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#22c55e" }} />
          In Progress
        </span>
      );
    }
    if (s === "COMPLETED") {
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "3px 10px", borderRadius: "12px", fontSize: "12px", fontWeight: 600, background: "#e0f2fe", color: "#0369a1" }}>
          ✓ Completed
        </span>
      );
    }
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "3px 10px", borderRadius: "12px", fontSize: "12px", fontWeight: 600, background: "#fef3c7", color: "#92400e" }}>
        ● Scheduled
      </span>
    );
  };

  return (
    <AppShell activeKey="hrms-site-visit">
      <main className="page" style={{ padding: "20px 24px", maxWidth: "1280px", margin: "0 auto" }}>
        <Breadcrumb trail={["HRMS", "Site Visits & Live Tracking"]} />

        {/* Top Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px", marginBottom: "16px" }}>
          <div>
            <h1 aria-label="Site Visit & Live Tracking" style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: "#0f172a" }}>
              {activeTab === "site-visits" ? "Site Visits" : "Live Tracking"}
            </h1>
            <div style={{ fontSize: "13px", color: "#64748b", marginTop: "4px" }}>
              {activeTab === "site-visits"
                ? "Schedule and monitor employee customer visits"
                : "Track your movement while travelling."}
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            {/* Location Simulator Toggle for Admin/Dev */}
            {canManageVisits && (
              <button
                type="button"
                className="btn btn-outline"
                style={{
                  padding: "7px 14px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  borderColor: simulationMode === "SIMULATED" ? "#f59e0b" : "#cbd5e1",
                  background: simulationMode === "SIMULATED" ? "#fffbeb" : "#ffffff",
                  color: simulationMode === "SIMULATED" ? "#b45309" : "#475569",
                }}
                onClick={() => setIsSimulatorOpen((v) => !v)}
              >
                <span>🛠️</span>
                <span>Location Simulator</span>
                {simulationMode === "SIMULATED" && (
                  <span style={{ background: "#f59e0b", color: "#fff", borderRadius: "10px", padding: "1px 6px", fontSize: "10px" }}>ON</span>
                )}
              </button>
            )}

            {/* Schedule Visit button (when on site-visits tab) */}
            {canManageVisits && activeTab === "site-visits" && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: "8px 16px", fontSize: "13px", fontWeight: 600 }}
                onClick={openScheduleModal}
              >
                + Schedule Site Visit
              </button>
            )}
          </div>
        </div>

        {/* ================================================================= */}
        {/* TWO PRIMARY TABS (Section 1: Split Site Visit and Live Tracking)   */}
        {/* ================================================================= */}
        <div style={{ display: "flex", gap: "8px", borderBottom: "2px solid #e2e8f0", marginBottom: "20px" }}>
          <button
            type="button"
            className={`hrms-tab-btn ${activeTab === "site-visits" ? "active" : ""}`}
            style={{
              padding: "10px 22px",
              fontSize: "14px",
              fontWeight: 700,
              border: "none",
              borderBottom: activeTab === "site-visits" ? "2px solid #2563eb" : "2px solid transparent",
              background: "none",
              color: activeTab === "site-visits" ? "#2563eb" : "#64748b",
              cursor: "pointer",
              marginBottom: "-2px",
            }}
            onClick={() => setActiveTab("site-visits")}
          >
            Site Visits
          </button>
          <button
            type="button"
            className={`hrms-tab-btn ${activeTab === "live-tracking" ? "active" : ""}`}
            style={{
              padding: "10px 22px",
              fontSize: "14px",
              fontWeight: 700,
              border: "none",
              borderBottom: activeTab === "live-tracking" ? "2px solid #2563eb" : "2px solid transparent",
              background: "none",
              color: activeTab === "live-tracking" ? "#2563eb" : "#64748b",
              cursor: "pointer",
              marginBottom: "-2px",
            }}
            onClick={() => setActiveTab("live-tracking")}
          >
            Live Tracking
          </button>
        </div>

        {/* ================================================================= */}
        {/* COLLAPSIBLE LOCATION SIMULATOR (Section 6 — Office Testing Mode)   */}
        {/* ================================================================= */}
        {canManageVisits && isSimulatorOpen && (
          <div
            style={{
              background: "#fffbeb",
              border: "1px solid #fde68a",
              borderRadius: "10px",
              padding: "16px 20px",
              marginBottom: "20px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "16px" }}>🛠️</span>
                <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#92400e" }}>
                  Location Simulator — Office Testing Mode
                </h3>
                <span
                  style={{
                    background: "#f59e0b",
                    color: "#ffffff",
                    fontSize: "10px",
                    fontWeight: 800,
                    padding: "2px 8px",
                    borderRadius: "4px",
                    letterSpacing: "0.05em",
                  }}
                >
                  TEST / SIMULATED LOCATION
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsSimulatorOpen(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#b45309", fontSize: "16px" }}
              >
                &times;
              </button>
            </div>

            <div style={{ fontSize: "12.5px", color: "#78350f", marginBottom: "14px", lineHeight: "1.5" }}>
              Enables testing Start Tracking, periodic GPS collection, Check In/Out, and route map rendering from the office without physically travelling.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "14px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#92400e", marginBottom: "6px" }}>
                  Operating Mode
                </label>
                <div style={{ display: "flex", gap: "16px", fontSize: "13px" }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="sim-mode"
                      checked={simulationMode === "REAL"}
                      onChange={() => setSimulationMode("REAL")}
                    />
                    Real GPS
                  </label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="sim-mode"
                      checked={simulationMode === "SIMULATED"}
                      onChange={() => setSimulationMode("SIMULATED")}
                    />
                    <strong>Simulated Location</strong>
                  </label>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#92400e", marginBottom: "6px" }}>
                  Select Test Route Preset
                </label>
                <select
                  className="form-control"
                  style={{ width: "100%", padding: "6px 10px", fontSize: "12.5px" }}
                  value={selectedPresetId}
                  onChange={(e) => {
                    const pid = e.target.value;
                    setSelectedPresetId(pid);
                    const preset = SIMULATION_PRESETS.find((p) => p.id === pid);
                    if (preset && preset.points.length > 0) {
                      const pt = preset.points[0];
                      setSimulatedCustomLocation({
                        latitude: pt.lat,
                        longitude: pt.lng,
                        accuracy: pt.accuracy || 10,
                        timestamp: new Date().toLocaleTimeString(),
                        address: preset.startName,
                      });
                    }
                  }}
                  disabled={simulationMode !== "SIMULATED"}
                >
                  {SIMULATION_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {simulationMode === "SIMULATED" && (
              <div style={{ marginTop: "12px", marginBottom: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#92400e", margin: 0 }}>
                    🗺️ Simulation Map (Click or drag marker on Google Map to select test GPS coordinates)
                  </label>
                  <span style={{ fontSize: "11px", color: "#b45309", fontWeight: 600 }}>
                    Official Google Maps Integration
                  </span>
                </div>

                {/* Active test coordinate readings */}
                <div style={{ background: "#fef3c7", border: "1px solid #fde68a", padding: "8px 12px", borderRadius: "6px", marginBottom: "10px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", fontSize: "12px", color: "#78350f" }}>
                  <div>
                    <div style={{ fontSize: "10px", color: "#b45309", fontWeight: 700, textTransform: "uppercase" }}>Test Latitude</div>
                    <div style={{ fontWeight: 700, marginTop: "2px" }}>{simulatedCustomLocation.latitude.toFixed(5)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "10px", color: "#b45309", fontWeight: 700, textTransform: "uppercase" }}>Test Longitude</div>
                    <div style={{ fontWeight: 700, marginTop: "2px" }}>{simulatedCustomLocation.longitude.toFixed(5)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "10px", color: "#b45309", fontWeight: 700, textTransform: "uppercase" }}>Accuracy</div>
                    <div style={{ fontWeight: 700, color: "#16a34a", marginTop: "2px" }}>{simulatedCustomLocation.accuracy} m (Simulated)</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "10px", color: "#b45309", fontWeight: 700, textTransform: "uppercase" }}>Timestamp</div>
                    <div style={{ fontWeight: 700, marginTop: "2px" }}>{simulatedCustomLocation.timestamp}</div>
                  </div>
                </div>

                <TrackingMap
                  points={[
                    {
                      lat: simulatedCustomLocation.latitude,
                      lng: simulatedCustomLocation.longitude,
                      type: "simulator",
                      label: "📍 Simulated Test Point",
                      accuracy: simulatedCustomLocation.accuracy,
                      time: simulatedCustomLocation.timestamp,
                      address: simulatedCustomLocation.address,
                    },
                  ]}
                  center={{ lat: simulatedCustomLocation.latitude, lng: simulatedCustomLocation.longitude }}
                  selectedCoord={{ lat: simulatedCustomLocation.latitude, lng: simulatedCustomLocation.longitude }}
                  height="220px"
                  isSimulated={true}
                  interactive={true}
                  draggableMarker={true}
                  onLocationSelect={async ({ lat, lng }) => {
                    let addr = "Simulated Location";
                    try {
                      const geo = await reverseGeocodeGoogle(lat, lng);
                      if (geo?.formatted_address) addr = geo.formatted_address;
                    } catch {}
                    setSimulatedCustomLocation({
                      latitude: lat,
                      longitude: lng,
                      accuracy: 10,
                      timestamp: new Date().toLocaleTimeString(),
                      address: addr,
                    });
                    toast.info(`Pinned test coordinate: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
                    setSimulatedLogs((prev) => [
                      `[${new Date().toLocaleTimeString()}] Pinned custom test GPS: ${lat.toFixed(4)}, ${lng.toFixed(4)} (${addr})`,
                      ...prev.slice(0, 8),
                    ]);
                  }}
                  title="Location Simulator — Google Maps"
                />
              </div>
            )}

            {simulationMode === "SIMULATED" && (
              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: "7px 16px", fontSize: "12.5px", fontWeight: 600, background: "#d97706", borderColor: "#d97706" }}
                  onClick={handleSimulateMovement}
                  disabled={actionLoading || !activeSession}
                >
                  Simulate Movement (Generate GPS Route Points)
                </button>

                {!activeSession && (
                  <span style={{ fontSize: "12px", color: "#b45309" }}>
                    Start Live Tracking in the tab below to enable movement simulation.
                  </span>
                )}
              </div>
            )}

            {simulatedLogs.length > 0 && (
              <div style={{ marginTop: "10px", padding: "8px 12px", background: "#fef3c7", borderRadius: "6px", fontSize: "11.5px", color: "#78350f", fontFamily: "monospace" }}>
                {simulatedLogs.map((log, idx) => (
                  <div key={idx}>{log}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 1: SITE VISITS TAB                                            */}
        {/* ================================================================= */}
        {activeTab === "site-visits" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Section 1A: Employee Today's Visit Card */}
            {(!canManageVisits || viewMode === "my") && (
              <div
                className="card"
                style={{
                  padding: "20px 24px",
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "10px",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#0f172a" }}>
                      Today's Visits
                    </h2>
                    <div style={{ fontSize: "12.5px", color: "#64748b", marginTop: "2px" }}>
                      Confirm your arrival at customer premises with one-time location verification.
                    </div>
                  </div>
                  {todayAssignedVisit && renderStatusBadge(todayAssignedVisit.status)}
                </div>

                {todayAssignedVisit ? (
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "16px 20px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
                      <div>
                        <div style={{ display: "inline-block", fontSize: "11px", fontWeight: 700, color: "#2563eb", textTransform: "uppercase", marginBottom: "4px" }}>
                          {todayAssignedVisit.status === "CHECKED_IN" ? "Active Visit" : "Scheduled Visit"}
                        </div>
                        <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#0f172a" }}>
                          {todayAssignedVisit.customer_name}
                        </h3>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#475569", fontSize: "13px", marginTop: "4px" }}>
                          <span>📅 {formatDateDisplay(todayAssignedVisit.visit_date)}</span>
                          <span>•</span>
                          <span>⏰ {todayAssignedVisit.planned_start_time} – {todayAssignedVisit.planned_end_time}</span>
                        </div>
                        <div style={{ color: "#64748b", fontSize: "13px", marginTop: "6px" }}>
                          <strong>Location:</strong> {todayAssignedVisit.site_address}
                        </div>
                      </div>

                      <div style={{ textAlign: "right", minWidth: "180px" }}>
                        {todayAssignedVisit.status === "SCHEDULED" && (
                          <div>
                            <div style={{ color: "#64748b", fontSize: "12px", marginBottom: "8px" }}>
                              Visit Status: <strong style={{ color: "#d97706" }}>Not Checked In</strong>
                            </div>
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ padding: "8px 20px", fontSize: "13px", fontWeight: 600 }}
                              onClick={() => handleCheckInVisit(todayAssignedVisit)}
                              disabled={actionLoading}
                            >
                              {actionLoading ? "Capturing..." : "Check In"}
                            </button>
                          </div>
                        )}

                        {todayAssignedVisit.status === "CHECKED_IN" && (
                          <div>
                            <div style={{ color: "#16a34a", fontSize: "13.5px", fontWeight: 700, marginBottom: "3px" }}>
                              ✓ Checked In
                            </div>
                            <div style={{ color: "#0f172a", fontSize: "15px", fontWeight: 700, marginBottom: "3px" }}>
                              {formatTime(todayAssignedVisit.check_in_time)}
                            </div>
                            <div style={{ color: "#64748b", fontSize: "11.5px", marginBottom: "10px" }}>
                              Location Captured {todayAssignedVisit.check_in_accuracy ? `• Accuracy: ${Math.round(todayAssignedVisit.check_in_accuracy)} m` : ""}
                            </div>
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ background: "#0f172a", borderColor: "#0f172a", padding: "8px 20px", fontSize: "13px", fontWeight: 600 }}
                              onClick={() => handleCheckOutVisit(todayAssignedVisit)}
                              disabled={actionLoading}
                            >
                              {actionLoading ? "Recording..." : "Check Out"}
                            </button>
                          </div>
                        )}

                        {todayAssignedVisit.status === "COMPLETED" && (
                          <div>
                            <div style={{ color: "#16a34a", fontSize: "14px", fontWeight: 700, marginBottom: "4px" }}>
                              ✓ Visit Completed
                            </div>
                            <div style={{ color: "#475569", fontSize: "12.5px" }}>
                              {formatTime(todayAssignedVisit.check_in_time)} – {formatTime(todayAssignedVisit.check_out_time)}
                            </div>
                            <div style={{ marginTop: "8px" }}>
                              <button
                                type="button"
                                className="btn btn-outline"
                                style={{ padding: "4px 12px", fontSize: "12px", color: "#2563eb", borderColor: "#bfdbfe" }}
                                onClick={() => setViewMapVisit(todayAssignedVisit)}
                              >
                                View Map
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: "24px 20px", textAlign: "center", border: "1px dashed #cbd5e1", borderRadius: "8px", background: "#f8fafc", color: "#64748b" }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                      No Visits Scheduled Today
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#64748b" }}>
                      <span>Active Visit</span>: <span>No Active Visit In Progress</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Section 1B: Admin Summary Metric Cards (Section 7: Keep Simple) */}
            {canManageVisits && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                <div style={{ background: "#ffffff", padding: "14px 18px", borderRadius: "8px", border: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>Today's Visits</div>
                    <div style={{ fontSize: "20px", fontWeight: 700, color: "#0f172a", marginTop: "2px" }}>{visitMetrics.todays}</div>
                  </div>
                  <span style={{ fontSize: "20px" }}>📅</span>
                </div>
                <div style={{ background: "#ffffff", padding: "14px 18px", borderRadius: "8px", border: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>Upcoming</div>
                    <div style={{ fontSize: "20px", fontWeight: 700, color: "#d97706", marginTop: "2px" }}>{visitMetrics.upcoming}</div>
                  </div>
                  <span style={{ fontSize: "20px" }}>⏳</span>
                </div>
                <div style={{ background: "#ffffff", padding: "14px 18px", borderRadius: "8px", border: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>Completed</div>
                    <div style={{ fontSize: "20px", fontWeight: 700, color: "#16a34a", marginTop: "2px" }}>{visitMetrics.completed}</div>
                  </div>
                  <span style={{ fontSize: "20px" }}>✓</span>
                </div>
              </div>
            )}

            {/* Section 1C: Visits List Table */}
            <div
              className="card"
              style={{
                padding: "20px 22px",
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
                <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                  {canManageVisits && viewMode === "all" ? "All Site Visits" : "Visit History"}
                </h2>

                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {isLoading && <span style={{ fontSize: "12px", color: "#64748b" }}>Syncing...</span>}
                  {canManageVisits && (
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        className={`btn btn-sm ${viewMode === "all" ? "btn-primary" : "btn-outline"}`}
                        onClick={() => setViewMode("all")}
                        style={{ padding: "4px 12px", fontSize: "12px" }}
                      >
                        All Visits
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${viewMode === "my" ? "btn-primary" : "btn-outline"}`}
                        onClick={() => setViewMode("my")}
                        style={{ padding: "4px 12px", fontSize: "12px" }}
                      >
                        My Visits
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Filters */}
              <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "14px", flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder="Search customer, address, or employee..."
                  className="form-control"
                  style={{ flex: 1, minWidth: "180px", padding: "6px 12px", fontSize: "12.5px" }}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <select
                  className="form-control"
                  style={{ width: "130px", padding: "6px 10px", fontSize: "12.5px" }}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="ALL">All Status</option>
                  <option value="SCHEDULED">Scheduled</option>
                  <option value="CHECKED_IN">In Progress</option>
                  <option value="COMPLETED">Completed</option>
                </select>
                <input
                  type="date"
                  className="form-control"
                  style={{ width: "135px", padding: "6px 10px", fontSize: "12.5px" }}
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                />
                {(searchTerm || statusFilter !== "ALL" || dateFilter) && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ padding: "6px 12px", fontSize: "12px" }}
                    onClick={() => {
                      setSearchTerm("");
                      setStatusFilter("ALL");
                      setDateFilter("");
                    }}
                  >
                    Reset
                  </button>
                )}
              </div>

              {filteredVisits.length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", color: "#64748b", fontSize: "13px" }}>
                  No Visit History Available
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #e2e8f0", textAlign: "left", color: "#475569", background: "#f8fafc" }}>
                        <th style={{ padding: "10px 12px" }}>Customer / Site</th>
                        <th style={{ padding: "10px 12px" }}>Employee</th>
                        <th style={{ padding: "10px 12px" }}>Date</th>
                        <th style={{ padding: "10px 12px" }}>Time</th>
                        <th style={{ padding: "10px 12px" }}>Status</th>
                        <th style={{ padding: "10px 12px" }}>Check-in</th>
                        <th style={{ padding: "10px 12px" }}>Check-out</th>
                        <th style={{ padding: "10px 12px", textAlign: "right" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredVisits.map((v) => (
                        <tr key={v.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "12px", verticalAlign: "middle" }}>
                            <div style={{ fontWeight: 600, color: "#0f172a" }}>{v.customer_name}</div>
                            <div style={{ fontSize: "12px", color: "#64748b" }}>{v.site_address}</div>
                            {v.is_simulated && (
                              <span style={{ fontSize: "10px", background: "#fef3c7", color: "#92400e", padding: "1px 6px", borderRadius: "4px", fontWeight: 700 }}>
                                SIMULATED
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "12px", verticalAlign: "middle" }}>
                            <div style={{ fontWeight: 600, color: "#0f172a" }}>{v.employee_name || "Employee"}</div>
                          </td>
                          <td style={{ padding: "12px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                            {formatDateDisplay(v.visit_date)}
                          </td>
                          <td style={{ padding: "12px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                            {v.planned_start_time} – {v.planned_end_time}
                          </td>
                          <td style={{ padding: "12px", verticalAlign: "middle" }}>
                            {renderStatusBadge(v.status)}
                          </td>
                          <td style={{ padding: "12px", verticalAlign: "middle" }}>
                            {v.check_in_time ? (
                              <span style={{ color: "#16a34a", fontWeight: 600 }}>{formatTime(v.check_in_time)}</span>
                            ) : (
                              <span style={{ color: "#94a3b8" }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: "12px", verticalAlign: "middle" }}>
                            {v.check_out_time ? (
                              <span style={{ color: "#0f172a", fontWeight: 600 }}>{formatTime(v.check_out_time)}</span>
                            ) : (
                              <span style={{ color: "#94a3b8" }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: "12px", verticalAlign: "middle", textAlign: "right" }}>
                            <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                              {v.status === "SCHEDULED" && (
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  style={{ padding: "4px 10px", fontSize: "11.5px", fontWeight: 600 }}
                                  onClick={() => handleCheckInVisit(v)}
                                >
                                  Check In
                                </button>
                              )}
                              {v.status === "CHECKED_IN" && (
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  style={{ padding: "4px 10px", fontSize: "11.5px", fontWeight: 600, background: "#0f172a", borderColor: "#0f172a" }}
                                  onClick={() => handleCheckOutVisit(v)}
                                >
                                  Check Out
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn-outline"
                                style={{ padding: "4px 12px", fontSize: "12px", fontWeight: 600 }}
                                onClick={() => setViewDetailsVisit(v)}
                              >
                                View
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
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 2: LIVE TRACKING TAB (Completely Separate Workflow)           */}
        {/* ================================================================= */}
        {activeTab === "live-tracking" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Section 2A: Active / Start Tracking Card */}
            <div
              className="card"
              style={{
                padding: "20px 24px",
                background: activeSession ? "#f0fdf4" : "#ffffff",
                border: activeSession ? "1px solid #86efac" : "1px solid #e2e8f0",
                borderRadius: "10px",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <div
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "10px",
                      background: activeSession ? "#dcfce7" : "#f1f5f9",
                      color: activeSession ? "#15803d" : "#64748b",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <IconClock style={{ width: "22px", height: "22px" }} />
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#0f172a" }}>
                      Live Tracking
                    </h2>
                    <div style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>
                      Track your movement while travelling.
                    </div>
                  </div>
                </div>

                {/* Right side controls */}
                <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                  {activeSession ? (
                    <>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#166534", fontSize: "12.5px", fontWeight: 700 }}>
                          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#22c55e" }} />
                          ● Tracking Active
                        </div>
                        <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                          Started: <strong>{formatTime(activeSession.start_time)}</strong> • GPS Points: <strong>{activeSession.points_count || activeSession.total_points || 0}</strong>
                        </div>
                      </div>

                      <div style={{ textAlign: "right", paddingLeft: "12px", borderLeft: "1px solid #bbf7d0" }}>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#166534", textTransform: "uppercase" }}>Duration</div>
                        <div style={{ fontSize: "17px", fontWeight: 700, color: "#15803d", fontFamily: "monospace" }}>
                          {formatTimerSeconds(trackingDurationSecs)}
                        </div>
                      </div>

                      <button
                        type="button"
                        id="btn-stop-live-tracking"
                        className="btn btn-danger"
                        style={{ background: "#dc2626", color: "#ffffff", border: "none", padding: "8px 18px", fontSize: "13px", fontWeight: 600, borderRadius: "6px" }}
                        onClick={handleStopLiveTracking}
                        disabled={actionLoading}
                      >
                        {actionLoading ? "Stopping..." : "Stop Tracking"}
                      </button>
                    </>
                  ) : (
                    <>
                      <div style={{ color: "#64748b", fontSize: "13px" }}>
                        Status: <strong style={{ color: "#475569" }}>Not Started</strong>
                      </div>

                      {/* Optional Site Visit Association */}
                      {todayAssignedVisit && (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#64748b" }}>
                          <span>Associate with visit:</span>
                          <select
                            className="form-control"
                            style={{ padding: "4px 8px", fontSize: "12px" }}
                            value={trackAssociatedVisitId}
                            onChange={(e) => setTrackAssociatedVisitId(e.target.value)}
                          >
                            <option value="">None (Independent)</option>
                            <option value={todayAssignedVisit.id}>
                              {todayAssignedVisit.customer_name} ({todayAssignedVisit.planned_start_time})
                            </option>
                          </select>
                        </div>
                      )}

                      <button
                        type="button"
                        id="btn-start-live-tracking"
                        className="btn btn-primary"
                        style={{ padding: "8px 18px", fontSize: "13px", fontWeight: 600, borderRadius: "6px" }}
                        onClick={() => handleStartLiveTracking()}
                        disabled={actionLoading}
                      >
                        {actionLoading ? "Starting..." : "Start Live Tracking"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Latest Completed Summary Banner */}
              {latestCompletedTracking && !activeSession && (
                <div
                  style={{
                    marginTop: "14px",
                    padding: "10px 14px",
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "6px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "8px",
                  }}
                >
                  <div style={{ fontSize: "12.5px", color: "#334155" }}>
                    <span style={{ color: "#16a34a", fontWeight: 700 }}>✓ Tracking Completed: </span>
                    {formatTime(latestCompletedTracking.start_time)} → {formatTime(latestCompletedTracking.end_time)} • Duration: {formatDuration(latestCompletedTracking.total_duration_minutes)} • Distance: {(latestCompletedTracking.approx_distance_km || latestCompletedTracking.approximate_distance_km || 0).toFixed(1)} km • Points: {latestCompletedTracking.total_points || 0}
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ padding: "4px 12px", fontSize: "12px", fontWeight: 600 }}
                    onClick={() => setViewRouteSession(latestCompletedTracking)}
                  >
                    View Route
                  </button>
                </div>
              )}
            </div>

            {/* Section 2B: Admin Live Tracking Sessions Table */}
            {canManageVisits && (
              <>
                {/* Metric Summary Counters */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
                  <div style={{ background: "#ffffff", padding: "14px 18px", borderRadius: "8px", border: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>Active Sessions</div>
                      <div style={{ fontSize: "20px", fontWeight: 700, color: "#16a34a", marginTop: "2px" }}>{trackingMetrics.active}</div>
                    </div>
                    <span style={{ fontSize: "20px" }}>🛰️</span>
                  </div>
                  <div style={{ background: "#ffffff", padding: "14px 18px", borderRadius: "8px", border: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>Completed Sessions</div>
                      <div style={{ fontSize: "20px", fontWeight: 700, color: "#0f172a", marginTop: "2px" }}>{trackingMetrics.completed}</div>
                    </div>
                    <span style={{ fontSize: "20px" }}>🏁</span>
                  </div>
                </div>

                {/* Tracking Table */}
                <div
                  className="card"
                  style={{
                    padding: "20px 22px",
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "10px",
                    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
                  }}
                >
                  <h2 style={{ margin: "0 0 14px 0", fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                    Live Tracking Sessions
                  </h2>

                  {trackingSessions.length === 0 ? (
                    <div style={{ padding: "24px", textAlign: "center", color: "#64748b", fontSize: "13px" }}>
                      No tracking sessions recorded yet.
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                        <thead>
                          <tr style={{ borderBottom: "2px solid #e2e8f0", textAlign: "left", color: "#475569", background: "#f8fafc" }}>
                            <th style={{ padding: "10px 12px" }}>Employee</th>
                            <th style={{ padding: "10px 12px" }}>Started</th>
                            <th style={{ padding: "10px 12px" }}>Ended</th>
                            <th style={{ padding: "10px 12px" }}>Duration</th>
                            <th style={{ padding: "10px 12px" }}>Distance</th>
                            <th style={{ padding: "10px 12px" }}>Status</th>
                            <th style={{ padding: "10px 12px", textAlign: "right" }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {trackingSessions.map((s) => {
                            const isAct = s.status === "ACTIVE";
                            const dist = s.approx_distance_km || s.approximate_distance_km || 0;
                            return (
                              <tr key={s.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                <td style={{ padding: "12px", verticalAlign: "middle" }}>
                                  <div style={{ fontWeight: 600, color: "#0f172a" }}>{s.employee_name || "Employee"}</div>
                                  {s.customer_name && (
                                    <div style={{ fontSize: "11.5px", color: "#64748b" }}>Visit: {s.customer_name}</div>
                                  )}
                                  {s.is_simulated && (
                                    <span style={{ fontSize: "10px", background: "#fef3c7", color: "#92400e", padding: "1px 6px", borderRadius: "4px", fontWeight: 700 }}>
                                      SIMULATED
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: "12px", verticalAlign: "middle" }}>
                                  {formatTime(s.start_time)}
                                </td>
                                <td style={{ padding: "12px", verticalAlign: "middle" }}>
                                  {isAct ? <span style={{ color: "#16a34a", fontWeight: 600 }}>Active</span> : formatTime(s.end_time)}
                                </td>
                                <td style={{ padding: "12px", verticalAlign: "middle" }}>
                                  {formatDuration(s.total_duration_minutes)}
                                </td>
                                <td style={{ padding: "12px", verticalAlign: "middle" }}>
                                  {dist.toFixed(1)} km
                                </td>
                                <td style={{ padding: "12px", verticalAlign: "middle" }}>
                                  {isAct ? (
                                    <span style={{ color: "#16a34a", fontWeight: 600 }}>● Tracking Active</span>
                                  ) : (
                                    <span style={{ color: "#475569" }}>✓ Completed</span>
                                  )}
                                </td>
                                <td style={{ padding: "12px", verticalAlign: "middle", textAlign: "right" }}>
                                  <button
                                    type="button"
                                    className="btn btn-outline"
                                    style={{ padding: "4px 12px", fontSize: "12px", fontWeight: 600, color: "#2563eb", borderColor: "#bfdbfe" }}
                                    onClick={() => setViewRouteSession(s)}
                                  >
                                    View Route
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL 1: SCHEDULE SITE VISIT (Section 2)                          */}
        {/* ================================================================= */}
        {isScheduleModalOpen && (
          <div className="hrms-modal-backdrop" onClick={() => setIsScheduleModalOpen(false)}>
            <div className="hrms-modal-card" style={{ maxWidth: "520px" }} onClick={(e) => e.stopPropagation()}>
              <div className="hrms-modal-header" style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "16.5px", fontWeight: 700, color: "#0f172a" }}>
                    Schedule Site Visit
                  </h3>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                    Assign an on-field customer visit to an employee.
                  </div>
                </div>
                <button type="button" onClick={() => setIsScheduleModalOpen(false)} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#94a3b8" }}>
                  &times;
                </button>
              </div>

              <form onSubmit={handleCreateSiteVisit}>
                <div className="hrms-modal-body" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div>
                    <label htmlFor="modal-sv-employee" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "5px" }}>
                      Employee <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <select
                      id="modal-sv-employee"
                      className="form-control"
                      value={formEmployeeId}
                      onChange={(e) => setFormEmployeeId(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px" }}
                      required
                    >
                      <option value="">Select Employee...</option>
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.full_name || (emp.first_name ? `${emp.first_name} ${emp.last_name || ""}` : emp.username)} ({emp.email || "No email"})
                        </option>
                      ))}
                    </select>
                    {formErrors.employee && <div style={{ color: "#dc2626", fontSize: "12px", marginTop: "3px" }}>{formErrors.employee}</div>}
                  </div>

                  <div>
                    <label htmlFor="modal-sv-customer" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "5px" }}>
                      Customer / Site Name <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <input
                      type="text"
                      id="modal-sv-customer"
                      className="form-control"
                      placeholder="e.g. ABC Industries"
                      value={formCustomerName}
                      onChange={(e) => setFormCustomerName(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px" }}
                      required
                    />
                    {formErrors.customer && <div style={{ color: "#dc2626", fontSize: "12px", marginTop: "3px" }}>{formErrors.customer}</div>}
                  </div>

                  {/* Google Places Autocomplete Search */}
                  <div style={{ position: "relative" }}>
                    <label htmlFor="modal-sv-search" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "5px" }}>
                      Search Location on Google Maps
                    </label>
                    <input
                      type="text"
                      id="modal-sv-search"
                      className="form-control"
                      placeholder="Search building, landmark, or street..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px" }}
                    />
                    {searchingPlaces && (
                      <div style={{ position: "absolute", right: 10, top: 35, fontSize: "11px", color: "#64748b" }}>
                        Searching Google Places...
                      </div>
                    )}
                    {predictions.length > 0 && (
                      <div
                        style={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          right: 0,
                          background: "#ffffff",
                          border: "1px solid #cbd5e1",
                          borderRadius: "6px",
                          boxShadow: "0 6px 16px rgba(0,0,0,0.12)",
                          zIndex: 50,
                          maxHeight: "200px",
                          overflowY: "auto",
                          marginTop: "4px",
                        }}
                      >
                        {predictions.map((p) => (
                          <div
                            key={p.place_id}
                            onClick={() => handleSelectPrediction(p)}
                            style={{
                              padding: "8px 12px",
                              fontSize: "12.5px",
                              borderBottom: "1px solid #f1f5f9",
                              cursor: "pointer",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "#ffffff")}
                          >
                            <div style={{ fontWeight: 600, color: "#0f172a" }}>{p.structured_formatting?.main_text || p.description}</div>
                            <div style={{ fontSize: "11px", color: "#64748b" }}>{p.structured_formatting?.secondary_text || ""}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label htmlFor="modal-sv-address" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "5px" }}>
                      Site Address <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <textarea
                      id="modal-sv-address"
                      className="form-control"
                      rows={2}
                      placeholder="e.g. MIDC Industrial Area, Phase II, Pune"
                      value={formSiteAddress}
                      onChange={(e) => setFormSiteAddress(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px" }}
                      required
                    />
                    {formErrors.address && <div style={{ color: "#dc2626", fontSize: "12px", marginTop: "3px" }}>{formErrors.address}</div>}
                  </div>

                  {/* Google Map confirmation/selection */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                      <label style={{ fontSize: "12.5px", fontWeight: 600, color: "#334155", margin: 0 }}>
                        Confirm Site Location on Google Maps
                      </label>
                      {formSiteLat && formSiteLng && (
                        <span style={{ fontSize: "11px", color: "#0284c7", fontWeight: 600 }}>
                          📍 {formSiteLat.toFixed(4)}, {formSiteLng.toFixed(4)} (Drag marker or click map to refine)
                        </span>
                      )}
                    </div>
                    <TrackingMap
                      height="200px"
                      interactive={true}
                      draggableMarker={true}
                      selectedCoord={formSiteLat && formSiteLng ? { lat: formSiteLat, lng: formSiteLng } : { lat: 18.5204, lng: 73.8567 }}
                      onLocationSelect={({ lat, lng, address }) => {
                        setFormSiteLat(lat);
                        setFormSiteLng(lng);
                        if (address && (!formSiteAddress || formSiteAddress.trim() === "")) {
                          setFormSiteAddress(address);
                        }
                      }}
                      title="Customer Site Location"
                    />
                  </div>

                  <div>
                    <label htmlFor="modal-sv-date" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "5px" }}>
                      Visit Date <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <input
                      type="date"
                      id="modal-sv-date"
                      className="form-control"
                      value={formVisitDate}
                      onChange={(e) => setFormVisitDate(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px" }}
                      required
                    />
                    {formErrors.date && <div style={{ color: "#dc2626", fontSize: "12px", marginTop: "3px" }}>{formErrors.date}</div>}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div>
                      <label htmlFor="modal-sv-start-time" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "5px" }}>
                        Start Time <span style={{ color: "#dc2626" }}>*</span>
                      </label>
                      <input
                        type="text"
                        id="modal-sv-start-time"
                        className="form-control"
                        placeholder="e.g. 10:00 AM"
                        value={formStartTime}
                        onChange={(e) => setFormStartTime(e.target.value)}
                        style={{ width: "100%", padding: "8px 12px" }}
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="modal-sv-end-time" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "5px" }}>
                        End Time <span style={{ color: "#dc2626" }}>*</span>
                      </label>
                      <input
                        type="text"
                        id="modal-sv-end-time"
                        className="form-control"
                        placeholder="e.g. 07:00 PM"
                        value={formEndTime}
                        onChange={(e) => setFormEndTime(e.target.value)}
                        style={{ width: "100%", padding: "8px 12px" }}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="modal-sv-notes" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "5px" }}>
                      Notes (Optional)
                    </label>
                    <textarea
                      id="modal-sv-notes"
                      className="form-control"
                      rows={2}
                      placeholder="e.g. Survey equipment and verify installation..."
                      value={formNotes}
                      onChange={(e) => setFormNotes(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px" }}
                    />
                  </div>
                </div>

                <div className="hrms-modal-footer" style={{ padding: "12px 20px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "flex-end", gap: "10px", background: "#f8fafc" }}>
                  <button type="button" className="btn btn-outline" onClick={() => setIsScheduleModalOpen(false)} disabled={actionLoading}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                    {actionLoading ? "Scheduling..." : "Assign & Schedule Visit"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL 2: SITE VISIT DETAILS (Section 8: Simple Record View)       */}
        {/* ================================================================= */}
        {viewDetailsVisit && (
          <div className="hrms-modal-backdrop" onClick={() => setViewDetailsVisit(null)}>
            <div className="hrms-modal-card" style={{ maxWidth: "540px" }} onClick={(e) => e.stopPropagation()}>
              <div className="hrms-modal-header" style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#0f172a" }}>
                    {viewDetailsVisit.customer_name}
                  </h3>
                  <div style={{ fontSize: "12.5px", color: "#64748b", marginTop: "2px" }}>
                    Site Visit Record
                  </div>
                </div>
                <button type="button" onClick={() => setViewDetailsVisit(null)} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#94a3b8" }}>
                  &times;
                </button>
              </div>

              <div className="hrms-modal-body" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px", fontSize: "13px" }}>
                <div>
                  <span style={{ color: "#64748b" }}>Employee: </span>
                  <strong style={{ color: "#0f172a" }}>{viewDetailsVisit.employee_name || "Employee"}</strong>
                </div>

                <div>
                  <span style={{ color: "#64748b" }}>Date: </span>
                  <strong style={{ color: "#0f172a" }}>{formatDateDisplay(viewDetailsVisit.visit_date)}</strong>
                </div>

                <div>
                  <span style={{ color: "#64748b" }}>Time: </span>
                  <strong style={{ color: "#0f172a" }}>{viewDetailsVisit.planned_start_time} – {viewDetailsVisit.planned_end_time}</strong>
                </div>

                <div>
                  <span style={{ color: "#64748b" }}>Status: </span>
                  {renderStatusBadge(viewDetailsVisit.status)}
                </div>

                <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "8px", border: "1px solid #e2e8f0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Check-in</div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: viewDetailsVisit.check_in_time ? "#16a34a" : "#94a3b8", marginTop: "2px" }}>
                      {viewDetailsVisit.check_in_time ? formatTime(viewDetailsVisit.check_in_time) : "—"}
                    </div>
                    {viewDetailsVisit.check_in_latitude && (
                      <div style={{ fontSize: "11px", color: "#059669", marginTop: "2px" }}>✓ Location Captured</div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Check-out</div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: viewDetailsVisit.check_out_time ? "#0f172a" : "#94a3b8", marginTop: "2px" }}>
                      {viewDetailsVisit.check_out_time ? formatTime(viewDetailsVisit.check_out_time) : "—"}
                    </div>
                    {viewDetailsVisit.check_out_latitude && (
                      <div style={{ fontSize: "11px", color: "#059669", marginTop: "2px" }}>✓ Location Captured</div>
                    )}
                  </div>
                </div>

                <div>
                  <span style={{ color: "#64748b" }}>Location: </span>
                  <span>{viewDetailsVisit.site_address}</span>
                </div>

                {viewDetailsVisit.notes && (
                  <div>
                    <span style={{ color: "#64748b" }}>Notes: </span>
                    <span style={{ fontStyle: "italic" }}>{viewDetailsVisit.notes}</span>
                  </div>
                )}
              </div>

              <div className="hrms-modal-footer" style={{ padding: "12px 20px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", background: "#f8fafc" }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: "6px 14px", fontSize: "12.5px" }}
                  onClick={() => {
                    setViewMapVisit(viewDetailsVisit);
                  }}
                >
                  View Map
                </button>
                <button type="button" className="btn btn-outline" onClick={() => setViewDetailsVisit(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL 3: SITE VISIT MAP MODAL (Section 5A)                         */}
        {/* ================================================================= */}
        {viewMapVisit && (
          <div className="hrms-modal-backdrop" onClick={() => setViewMapVisit(null)}>
            <div className="hrms-modal-card" style={{ maxWidth: "620px" }} onClick={(e) => e.stopPropagation()}>
              <div className="hrms-modal-header" style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "16.5px", fontWeight: 700, color: "#0f172a" }}>
                    Site Visit Location Map
                  </h3>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                    {viewMapVisit.customer_name} • {viewMapVisit.site_address}
                  </div>
                </div>
                <button type="button" onClick={() => setViewMapVisit(null)} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#94a3b8" }}>
                  &times;
                </button>
              </div>

              <div className="hrms-modal-body" style={{ padding: "20px" }}>
                {(() => {
                  const mapPoints: MapPoint[] = [];

                  // 1. Planned site location
                  if (viewMapVisit.site_latitude && viewMapVisit.site_longitude) {
                    mapPoints.push({
                      lat: viewMapVisit.site_latitude,
                      lng: viewMapVisit.site_longitude,
                      type: "site",
                      label: `Customer Site: ${viewMapVisit.customer_name}`,
                      address: viewMapVisit.site_address,
                    });
                  }

                  // 2. Check-in location
                  if (viewMapVisit.check_in_latitude && viewMapVisit.check_in_longitude) {
                    mapPoints.push({
                      lat: viewMapVisit.check_in_latitude,
                      lng: viewMapVisit.check_in_longitude,
                      type: "checkin",
                      label: `Check-in: ${formatTime(viewMapVisit.check_in_time)}`,
                      accuracy: viewMapVisit.check_in_accuracy,
                      time: formatTime(viewMapVisit.check_in_time),
                      address: viewMapVisit.check_in_address || viewMapVisit.site_address,
                    });
                  }

                  // 3. Check-out location
                  if (viewMapVisit.check_out_latitude && viewMapVisit.check_out_longitude) {
                    mapPoints.push({
                      lat: viewMapVisit.check_out_latitude,
                      lng: viewMapVisit.check_out_longitude,
                      type: "checkout",
                      label: `Check-out: ${formatTime(viewMapVisit.check_out_time)}`,
                      accuracy: viewMapVisit.check_out_accuracy,
                      time: formatTime(viewMapVisit.check_out_time),
                      address: viewMapVisit.check_out_address || viewMapVisit.site_address,
                    });
                  }

                  if (mapPoints.length === 0) {
                    // Fallback to customer site coordinate if available
                    mapPoints.push({
                      lat: 18.5204,
                      lng: 73.8567,
                      type: "site",
                      label: viewMapVisit.customer_name,
                      address: viewMapVisit.site_address,
                    });
                  }

                  return (
                    <TrackingMap
                      points={mapPoints}
                      height="320px"
                      isSimulated={viewMapVisit.is_simulated}
                    />
                  );
                })()}

                <div style={{ marginTop: "12px", display: "flex", gap: "16px", fontSize: "12px", color: "#64748b", flexWrap: "wrap" }}>
                  <span>🟢 Check-in Location</span>
                  <span>🛑 Check-out Location</span>
                  <span>🏢 Customer Premises</span>
                </div>
              </div>

              <div className="hrms-modal-footer" style={{ padding: "12px 20px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "flex-end", background: "#f8fafc" }}>
                <button type="button" className="btn btn-outline" onClick={() => setViewMapVisit(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL 4: LIVE TRACKING ROUTE MAP (Section 5B & Section 9)         */}
        {/* ================================================================= */}
        {viewRouteSession && (
          <div className="hrms-modal-backdrop" onClick={() => setViewRouteSession(null)}>
            <div className="hrms-modal-card" style={{ maxWidth: "660px" }} onClick={(e) => e.stopPropagation()}>
              <div className="hrms-modal-header" style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#0f172a" }}>
                    Live Tracking Route
                  </h3>
                  <div style={{ fontSize: "12.5px", color: "#64748b", marginTop: "2px" }}>
                    Employee: <strong>{viewRouteSession.employee_name || "Employee"}</strong> • {formatDateDisplay(viewRouteSession.tracking_date)}
                  </div>
                </div>
                <button type="button" onClick={() => setViewRouteSession(null)} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#94a3b8" }}>
                  &times;
                </button>
              </div>

              <div className="hrms-modal-body" style={{ padding: "20px" }}>
                {/* Stats Summary Bar */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", background: "#f8fafc", padding: "10px 14px", borderRadius: "8px", border: "1px solid #e2e8f0", marginBottom: "14px", textAlign: "center" }}>
                  <div>
                    <div style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Time</div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a", marginTop: "2px" }}>
                      {formatTime(viewRouteSession.start_time)} – {formatTime(viewRouteSession.end_time)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Duration</div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a", marginTop: "2px" }}>
                      {formatDuration(viewRouteSession.total_duration_minutes)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Distance</div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "#2563eb", marginTop: "2px" }}>
                      {(viewRouteSession.approx_distance_km || viewRouteSession.approximate_distance_km || 0).toFixed(1)} km
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>GPS Points</div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "#16a34a", marginTop: "2px" }}>
                      {viewRouteSession.total_points || (viewRouteSession.route_summary?.length || 0)}
                    </div>
                  </div>
                </div>

                {/* Interactive Leaflet Route Map */}
                {(() => {
                  const points: MapPoint[] = [];
                  const polyline: Array<{ lat: number; lng: number }> = [];

                  if (viewRouteSession.route_summary && viewRouteSession.route_summary.length > 0) {
                    viewRouteSession.route_summary.forEach((pt, idx) => {
                      polyline.push({ lat: pt.lat, lng: pt.lng });
                      if (idx === 0) {
                        points.push({ lat: pt.lat, lng: pt.lng, type: "start", label: "Start Location", time: formatTime(pt.time) });
                      } else if (idx === viewRouteSession.route_summary!.length - 1) {
                        points.push({ lat: pt.lat, lng: pt.lng, type: "end", label: "End Location", time: formatTime(pt.time) });
                      }
                    });
                  } else {
                    if (viewRouteSession.start_latitude && viewRouteSession.start_longitude) {
                      points.push({ lat: viewRouteSession.start_latitude, lng: viewRouteSession.start_longitude, type: "start", label: "Start Location" });
                      polyline.push({ lat: viewRouteSession.start_latitude, lng: viewRouteSession.start_longitude });
                    }
                    if (viewRouteSession.end_latitude && viewRouteSession.end_longitude) {
                      points.push({ lat: viewRouteSession.end_latitude, lng: viewRouteSession.end_longitude, type: "end", label: "End Location" });
                      polyline.push({ lat: viewRouteSession.end_latitude, lng: viewRouteSession.end_longitude });
                    }
                  }

                  return (
                    <TrackingMap
                      points={points}
                      polyline={polyline}
                      height="320px"
                      isSimulated={viewRouteSession.is_simulated}
                    />
                  );
                })()}

                {/* Below Map Details (Section 9) */}
                <div style={{ marginTop: "14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "12.5px" }}>
                  <div style={{ background: "#f8fafc", padding: "10px 12px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 700 }}>Start Location</div>
                    <div style={{ color: "#0f172a", marginTop: "2px" }}>
                      {viewRouteSession.start_latitude ? `${viewRouteSession.start_latitude.toFixed(4)}, ${viewRouteSession.start_longitude?.toFixed(4)}` : "Start Coordinates Captured"}
                    </div>
                  </div>
                  <div style={{ background: "#f8fafc", padding: "10px 12px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 700 }}>End Location</div>
                    <div style={{ color: "#0f172a", marginTop: "2px" }}>
                      {viewRouteSession.end_latitude ? `${viewRouteSession.end_latitude.toFixed(4)}, ${viewRouteSession.end_longitude?.toFixed(4)}` : "Destination Coordinates Captured"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="hrms-modal-footer" style={{ padding: "12px 20px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "flex-end", background: "#f8fafc" }}>
                <button type="button" className="btn btn-outline" onClick={() => setViewRouteSession(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL 5: CHECK-IN / CHECK-OUT CONFIRMATION WITH GOOGLE MAP (Sec 4) */}
        {/* ================================================================= */}
        {checkInOutModal && (
          <div className="hrms-modal-backdrop" onClick={() => !actionLoading && setCheckInOutModal(null)}>
            <div
              className="hrms-modal-card"
              style={{ maxWidth: "600px", width: "95%" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="hrms-modal-header"
                style={{
                  padding: "16px 20px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: checkInOutModal.type === "CHECK_IN" ? "#f0fdf4" : "#fef2f2",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "20px" }}>
                    {checkInOutModal.type === "CHECK_IN" ? "🟢" : "🛑"}
                  </span>
                  <div>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: "16.5px",
                        fontWeight: 700,
                        color: checkInOutModal.type === "CHECK_IN" ? "#166534" : "#991b1b",
                      }}
                    >
                      {checkInOutModal.type === "CHECK_IN" ? "Employee Check In" : "Employee Check Out"}
                    </h3>
                    <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                      {checkInOutModal.visit.customer_name} • {checkInOutModal.visit.site_address}
                    </div>
                  </div>
                </div>
                {!actionLoading && (
                  <button
                    type="button"
                    onClick={() => setCheckInOutModal(null)}
                    style={{ background: "none", border: "none", fontSize: "22px", cursor: "pointer", color: "#94a3b8" }}
                  >
                    &times;
                  </button>
                )}
              </div>

              <div className="hrms-modal-body" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
                {/* GPS Capture Status Card */}
                <div
                  style={{
                    background:
                      gpsCaptureStatus === "SUCCESS"
                        ? "#f0fdf4"
                        : gpsCaptureStatus === "REFINING"
                        ? "#fffbeb"
                        : "#f8fafc",
                    border: `1px solid ${
                      gpsCaptureStatus === "SUCCESS"
                        ? "#86efac"
                        : gpsCaptureStatus === "REFINING"
                        ? "#fde68a"
                        : "#e2e8f0"
                    }`,
                    borderRadius: "8px",
                    padding: "14px 16px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {gpsCaptureStatus === "ACQUIRING" && (
                        <div style={{ width: "16px", height: "16px", border: "2px solid #cbd5e1", borderTopColor: "#2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                      )}
                      {gpsCaptureStatus === "REFINING" && (
                        <span style={{ fontSize: "15px" }}>📡</span>
                      )}
                      {gpsCaptureStatus === "SUCCESS" && (
                        <span style={{ color: "#16a34a", fontSize: "18px", fontWeight: "bold" }}>✓</span>
                      )}
                      <span
                        style={{
                          fontSize: "14px",
                          fontWeight: 700,
                          color:
                            gpsCaptureStatus === "SUCCESS"
                              ? "#15803d"
                              : gpsCaptureStatus === "REFINING"
                              ? "#b45309"
                              : "#334155",
                        }}
                      >
                        {gpsStatusText}
                      </span>
                    </div>

                    {gpsReading && (
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ padding: "3px 10px", fontSize: "11px" }}
                        onClick={startHighAccuracyGpsCapture}
                        disabled={actionLoading}
                      >
                        🔄 Retry Location
                      </button>
                    )}
                  </div>

                  {gpsReading && (
                    <div style={{ marginTop: "10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "12px", color: "#475569" }}>
                      <div>
                        <span style={{ color: "#64748b" }}>Accuracy: </span>
                        <strong style={{ color: gpsReading.accuracy <= 25 ? "#16a34a" : "#d97706" }}>
                          {gpsReading.accuracy} m
                        </strong>
                        {gpsReading.accuracy <= 25 && (
                          <span style={{ color: "#16a34a", marginLeft: "4px", fontSize: "11px" }}>(High Precision)</span>
                        )}
                      </div>
                      <div>
                        <span style={{ color: "#64748b" }}>Captured: </span>
                        <strong>{gpsReading.timestamp}</strong>
                      </div>
                      <div style={{ gridColumn: "1 / -1", color: "#334155", marginTop: "2px" }}>
                        <span style={{ color: "#64748b" }}>GPS Position: </span>
                        <span>{gpsReading.latitude.toFixed(5)}, {gpsReading.longitude.toFixed(5)}</span>
                        {gpsReading.address && <span> • {gpsReading.address}</span>}
                      </div>
                      {gpsReading.isSimulated && (
                        <div style={{ gridColumn: "1 / -1" }}>
                          <span style={{ background: "#fef3c7", color: "#92400e", fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "4px" }}>
                            SIMULATED / TEST GPS
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Google Map Position Preview */}
                {gpsReading && (
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "6px", display: "flex", justifyContent: "space-between" }}>
                      <span>📍 Map Verification (Google Maps)</span>
                      <span style={{ fontSize: "11px", color: "#64748b" }}>
                        {checkInOutModal.type === "CHECK_IN" ? "Green Pin = Check In Position" : "Red Pin = Check Out Position"}
                      </span>
                    </div>
                    {(() => {
                      const previewPoints: MapPoint[] = [];
                      if (checkInOutModal.type === "CHECK_IN") {
                        previewPoints.push({
                          lat: gpsReading.latitude,
                          lng: gpsReading.longitude,
                          type: "checkin",
                          label: "📍 Check-in",
                          accuracy: gpsReading.accuracy,
                          address: gpsReading.address,
                        });
                      } else {
                        previewPoints.push({
                          lat: gpsReading.latitude,
                          lng: gpsReading.longitude,
                          type: "checkout",
                          label: "📍 Check-out",
                          accuracy: gpsReading.accuracy,
                          address: gpsReading.address,
                        });
                        if (checkInOutModal.visit.check_in_latitude && checkInOutModal.visit.check_in_longitude) {
                          previewPoints.push({
                            lat: checkInOutModal.visit.check_in_latitude,
                            lng: checkInOutModal.visit.check_in_longitude,
                            type: "checkin",
                            label: "📍 Check-in",
                            accuracy: checkInOutModal.visit.check_in_accuracy,
                            time: formatTime(checkInOutModal.visit.check_in_time),
                            address: checkInOutModal.visit.check_in_address,
                          });
                        }
                      }
                      if (checkInOutModal.visit.site_latitude && checkInOutModal.visit.site_longitude) {
                        previewPoints.push({
                          lat: checkInOutModal.visit.site_latitude,
                          lng: checkInOutModal.visit.site_longitude,
                          type: "site",
                          label: "Planned Site",
                          address: checkInOutModal.visit.site_address,
                        });
                      }
                      return (
                        <TrackingMap
                          points={previewPoints}
                          center={{ lat: gpsReading.latitude, lng: gpsReading.longitude }}
                          height="220px"
                          isSimulated={gpsReading.isSimulated}
                        />
                      );
                    })()}
                  </div>
                )}
              </div>

              <div
                className="hrms-modal-footer"
                style={{
                  padding: "14px 20px",
                  borderTop: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                  background: "#f8fafc",
                }}
              >
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setCheckInOutModal(null)}
                  disabled={actionLoading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{
                    background: checkInOutModal.type === "CHECK_IN" ? "#16a34a" : "#dc2626",
                    borderColor: checkInOutModal.type === "CHECK_IN" ? "#16a34a" : "#dc2626",
                    padding: "8px 20px",
                    fontWeight: 700,
                  }}
                  onClick={handleConfirmCheckInOut}
                  disabled={actionLoading || gpsCaptureStatus !== "SUCCESS" || !gpsReading}
                >
                  {actionLoading
                    ? "Saving..."
                    : checkInOutModal.type === "CHECK_IN"
                    ? "Confirm Check In"
                    : "Confirm Check Out"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}

export default SiteVisitPage;
