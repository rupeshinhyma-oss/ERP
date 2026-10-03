import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import {
  IconCalendar,
  IconCreditCard,
  IconPin,
} from "@/components/icons";
import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from "@/lib/api";
import {
  loadGoogleMapsSdk,
  searchGooglePlaces,
  fetchGooglePlaceDetails,
  reverseGeocodeGoogle,
  UnifiedPlacePrediction,
} from "@/lib/googleMaps";
import "./hrms.css";

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

interface HrmsLocation {
  id: string;
  name: string;
  location_type: string;
  address: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active: boolean;
  employees_assigned: number;
  created_at: string;
  updated_at: string;
  version: number;
}

interface HrmsLeaveType {
  id: string;
  name: string;
  code?: string;
  description?: string;
  leave_type: string;
  is_paid: boolean;
  annual_balance: number;
  carry_forward_allowed?: boolean;
  carry_forward_days: number;
  max_consecutive_days: number;
  monthly_accrual: boolean;
  accrual_amount?: number;
  min_notice_days?: number;
  allow_half_day?: boolean;
  allow_backdated?: boolean;
  require_attachment?: boolean;
  attendance_based_accrual?: boolean;
  attendance_based_condition?: string;
  attendance_based_reward?: number;
  attendance_based_departments?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  version: number;
}

interface HrmsExpenseCategory {
  id: string;
  name: string;
  code?: string;
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  version: number;
}

interface HrmsExpenseSettings {
  id?: string;
  approval_team_lead: boolean;
  approval_manager: boolean;
  approval_accounts: boolean;
  max_claim_amount: number;
  receipt_required: boolean;
  auto_approval_limit: number;
  submission_window_days: number;
}

const RADIUS_OPTIONS = [50, 100, 150, 200, 250, 500, 1000];

// Default Inhyma Thane coordinates (Lodha Supremus, Wagle Estate)
const DEFAULT_THANE_LAT = 19.199824;
const DEFAULT_THANE_LNG = 72.956795;

export function SetupPage() {
  const [activeTab, setActiveTab] = useState<"leaveTypes" | "expenseSettings" | "geoFencing">("leaveTypes");

  // Notifications
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setErrorMessage(null);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const showError = (msg: string) => {
    setErrorMessage(msg);
    setSuccessMessage(null);
    setTimeout(() => setErrorMessage(null), 6000);
  };

  // -------------------------------------------------------------------------
  // TAB 1: LEAVE TYPES STATE & HANDLERS
  // -------------------------------------------------------------------------
  const [leaveTypes, setLeaveTypes] = useState<HrmsLeaveType[]>([]);
  const [loadingLeaves, setLoadingLeaves] = useState(false);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [editingLeave, setEditingLeave] = useState<HrmsLeaveType | null>(null);

  const defaultLeaveForm = {
    name: "",
    code: "",
    description: "",
    leave_type: "REGULAR",
    is_paid: true,
    annual_balance: 12,
    monthly_accrual: false,
    accrual_amount: 1,
    max_consecutive_days: 5,
    min_notice_days: 0,
    allow_half_day: true,
    allow_backdated: false,
    require_attachment: false,
    carry_forward_allowed: false,
    carry_forward_days: 0,
    attendance_based_accrual: false,
    attendance_based_condition: "Full Month Present",
    attendance_based_reward: 1,
    attendance_based_departments: "All Departments",
    is_active: true,
  };

  const [leaveForm, setLeaveForm] = useState(defaultLeaveForm);

  const fetchLeaveTypes = async () => {
    setLoadingLeaves(true);
    try {
      const res = await apiGet<HrmsLeaveType[]>("/hrms/setup/leave-types");
      if (res.data) setLeaveTypes(res.data);
    } catch (err: any) {
      showError(err.message || "Failed to load leave types.");
    } finally {
      setLoadingLeaves(false);
    }
  };

  const openAddLeaveModal = () => {
    setEditingLeave(null);
    setLeaveForm(defaultLeaveForm);
    setLeaveModalOpen(true);
  };

  const openEditLeaveModal = (item: HrmsLeaveType) => {
    setEditingLeave(item);
    setLeaveForm({
      name: item.name,
      code: item.code || "",
      description: item.description || "",
      leave_type: item.leave_type || "REGULAR",
      is_paid: item.is_paid,
      annual_balance: item.annual_balance ?? 12,
      monthly_accrual: Boolean(item.monthly_accrual),
      accrual_amount: item.accrual_amount ?? 1,
      max_consecutive_days: item.max_consecutive_days ?? 5,
      min_notice_days: item.min_notice_days ?? 0,
      allow_half_day: item.allow_half_day ?? true,
      allow_backdated: item.allow_backdated ?? false,
      require_attachment: item.require_attachment ?? false,
      carry_forward_allowed: Boolean(item.carry_forward_allowed || (item.carry_forward_days && item.carry_forward_days > 0)),
      carry_forward_days: item.carry_forward_days ?? 0,
      attendance_based_accrual: Boolean(item.attendance_based_accrual),
      attendance_based_condition: item.attendance_based_condition || "Full Month Present",
      attendance_based_reward: item.attendance_based_reward ?? 1,
      attendance_based_departments: item.attendance_based_departments || "All Departments",
      is_active: item.is_active,
    });
    setLeaveModalOpen(true);
  };

  const handleSaveLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveForm.name.trim()) {
      showError("Please enter a leave name.");
      return;
    }

    try {
      if (editingLeave) {
        await apiPut(`/hrms/setup/leave-types/${editingLeave.id}`, leaveForm);
        showSuccess(`Leave type "${leaveForm.name}" updated successfully.`);
      } else {
        await apiPost("/hrms/setup/leave-types", leaveForm);
        showSuccess(`Leave type "${leaveForm.name}" added successfully.`);
      }
      setLeaveModalOpen(false);
      fetchLeaveTypes();
    } catch (err: any) {
      showError(err.message || "Failed to save leave type.");
    }
  };

  const toggleLeaveStatus = async (item: HrmsLeaveType) => {
    try {
      await apiPatch(`/hrms/setup/leave-types/${item.id}/status`, { is_active: !item.is_active });
      showSuccess(`Leave type "${item.name}" ${!item.is_active ? "enabled" : "disabled"}.`);
      fetchLeaveTypes();
    } catch (err: any) {
      showError(err.message || "Failed to update leave type status.");
    }
  };

  const handleDeleteLeave = async (item: HrmsLeaveType) => {
    if (!window.confirm(`Are you sure you want to remove "${item.name}"?`)) return;
    try {
      await apiDelete(`/hrms/setup/leave-types/${item.id}`);
      showSuccess(`Leave type "${item.name}" removed successfully.`);
      fetchLeaveTypes();
    } catch (err: any) {
      showError(err.message || "Failed to remove leave type.");
    }
  };

  // -------------------------------------------------------------------------
  // TAB 2: EXPENSE SETTINGS STATE & HANDLERS
  // -------------------------------------------------------------------------
  const [expenseCategories, setExpenseCategories] = useState<HrmsExpenseCategory[]>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<HrmsExpenseCategory | null>(null);

  const [categoryForm, setCategoryForm] = useState({
    name: "",
    code: "",
    description: "",
    is_active: true,
  });

  const [expenseSettings, setExpenseSettings] = useState<HrmsExpenseSettings>({
    approval_team_lead: true,
    approval_manager: true,
    approval_accounts: true,
    max_claim_amount: 50000,
    receipt_required: true,
    auto_approval_limit: 500,
    submission_window_days: 30,
  });
  const [savingSettings, setSavingSettings] = useState(false);

  const fetchExpenseData = async () => {
    setLoadingExpenses(true);
    try {
      const [catsRes, setRes] = await Promise.all([
        apiGet<HrmsExpenseCategory[]>("/hrms/setup/expense-categories"),
        apiGet<HrmsExpenseSettings>("/hrms/setup/expense-settings"),
      ]);
      if (catsRes.data) setExpenseCategories(catsRes.data);
      if (setRes.data) setExpenseSettings(setRes.data);
    } catch (err: any) {
      showError(err.message || "Failed to load expense settings.");
    } finally {
      setLoadingExpenses(false);
    }
  };

  const openAddCategoryModal = () => {
    setEditingCategory(null);
    setCategoryForm({ name: "", code: "", description: "", is_active: true });
    setCategoryModalOpen(true);
  };

  const openEditCategoryModal = (cat: HrmsExpenseCategory) => {
    setEditingCategory(cat);
    setCategoryForm({
      name: cat.name,
      code: cat.code || "",
      description: cat.description || "",
      is_active: cat.is_active,
    });
    setCategoryModalOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryForm.name.trim()) {
      showError("Please enter a category name.");
      return;
    }

    try {
      if (editingCategory) {
        await apiPut(`/hrms/setup/expense-categories/${editingCategory.id}`, categoryForm);
        showSuccess(`Category "${categoryForm.name}" updated successfully.`);
      } else {
        await apiPost("/hrms/setup/expense-categories", categoryForm);
        showSuccess(`Category "${categoryForm.name}" added successfully.`);
      }
      setCategoryModalOpen(false);
      fetchExpenseData();
    } catch (err: any) {
      showError(err.message || "Failed to save category.");
    }
  };

  const toggleCategoryStatus = async (cat: HrmsExpenseCategory) => {
    try {
      await apiPatch(`/hrms/setup/expense-categories/${cat.id}/status`, { is_active: !cat.is_active });
      showSuccess(`Category "${cat.name}" ${!cat.is_active ? "enabled" : "disabled"}.`);
      fetchExpenseData();
    } catch (err: any) {
      showError(err.message || "Failed to update category status.");
    }
  };

  const handleDeleteCategory = async (cat: HrmsExpenseCategory) => {
    if (!window.confirm(`Are you sure you want to remove "${cat.name}"?`)) return;
    try {
      await apiDelete(`/hrms/setup/expense-categories/${cat.id}`);
      showSuccess(`Category "${cat.name}" removed successfully.`);
      fetchExpenseData();
    } catch (err: any) {
      showError(err.message || "Failed to remove category.");
    }
  };

  const handleSaveExpenseSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await apiPut<HrmsExpenseSettings>("/hrms/setup/expense-settings", expenseSettings);
      if (res.data) setExpenseSettings(res.data);
      showSuccess("Expense workflow and claim rules updated successfully.");
    } catch (err: any) {
      showError(err.message || "Failed to save expense settings.");
    } finally {
      setSavingSettings(false);
    }
  };

  // -------------------------------------------------------------------------
  // TAB 3: GEO FENCING (OFFICE LOCATIONS) STATE & HANDLERS
  // -------------------------------------------------------------------------
  const [locations, setLocations] = useState<HrmsLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [officeModalOpen, setOfficeModalOpen] = useState(false);
  const [editingOffice, setEditingOffice] = useState<HrmsLocation | null>(null);

  // Office Form State
  const [officeForm, setOfficeForm] = useState({
    name: "",
    address: "",
    latitude: DEFAULT_THANE_LAT,
    longitude: DEFAULT_THANE_LNG,
    radius_meters: 150,
    is_active: true,
  });

  // Places Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [predictions, setPredictions] = useState<UnifiedPlacePrediction[]>([]);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [loadingMapSdk, setLoadingMapSdk] = useState(false);
  const [selectedOffice, setSelectedOffice] = useState<HrmsLocation | null>(null);

  // Map Refs & Objects
  const mapCanvasRef = useRef<HTMLDivElement | null>(null);
  const googleMapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerInstanceRef = useRef<google.maps.Marker | null>(null);
  const circleInstanceRef = useRef<google.maps.Circle | null>(null);

  const fetchLocations = async () => {
    setLoadingLocations(true);
    try {
      const res = await apiGet<HrmsLocation[]>("/hrms/setup/locations");
      if (res.data) {
        setLocations(res.data);
        if (res.data.length > 0) {
          setSelectedOffice((prev) => {
            if (prev) {
              const found = res.data.find((l) => l.id === prev.id);
              return found || null;
            }
            return null;
          });
        } else {
          setSelectedOffice(null);
        }
      }
    } catch (err: any) {
      showError(err.message || "Failed to load office locations.");
    } finally {
      setLoadingLocations(false);
    }
  };

  // Open modal for Adding an office
  const openAddOfficeModal = () => {
    setEditingOffice(null);
    setSearchQuery("");
    setPredictions([]);
    setOfficeForm({
      name: "",
      address: "Office No 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
      latitude: DEFAULT_THANE_LAT,
      longitude: DEFAULT_THANE_LNG,
      radius_meters: 150,
      is_active: true,
    });
    setOfficeModalOpen(true);
  };

  // Open modal for Editing an office
  const openEditOfficeModal = (loc: HrmsLocation) => {
    setEditingOffice(loc);
    setSearchQuery("");
    setPredictions([]);
    setOfficeForm({
      name: loc.name,
      address: loc.address,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radius_meters: loc.radius_meters,
      is_active: loc.is_active,
    });
    setOfficeModalOpen(true);
  };

  // Initialize or update Google Map in Modal
  useEffect(() => {
    if (!officeModalOpen) return;

    let isMounted = true;

    const initMap = async () => {
      setLoadingMapSdk(true);
      try {
        const maps = await loadGoogleMapsSdk();
        if (!isMounted || !mapCanvasRef.current) return;

        const centerPos = { lat: officeForm.latitude, lng: officeForm.longitude };

        // 1. Create or re-center Map (only once per modal open)
        let map = googleMapInstanceRef.current;
        if (!map) {
          map = new maps.Map(mapCanvasRef.current, {
            center: centerPos,
            zoom: 16,
            disableDefaultUI: false,
            zoomControl: true,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            gestureHandling: "cooperative",
          });
          googleMapInstanceRef.current = map;
        } else {
          map.setCenter(centerPos);
          map.setZoom(16);
        }

        // 2. Create or move Draggable Marker
        let marker = markerInstanceRef.current;
        if (!marker) {
          marker = new maps.Marker({
            position: centerPos,
            map,
            draggable: true,
            title: "Drag marker to refine exact office center",
          });
          markerInstanceRef.current = marker;

          // Drag event: smoothly sync circle & coordinates in real time
          marker.addListener("drag", () => {
            const pos = marker?.getPosition();
            if (pos) {
              const curLat = typeof pos.lat === "function" ? pos.lat() : (pos.lat as unknown as number);
              const curLng = typeof pos.lng === "function" ? pos.lng() : (pos.lng as unknown as number);
              if (circleInstanceRef.current) {
                circleInstanceRef.current.setCenter({ lat: curLat, lng: curLng });
              }
              setOfficeForm((prev) => ({ ...prev, latitude: curLat, longitude: curLng }));
            }
          });

          // Drag end event: update coordinates & reverse geocode for address
          marker.addListener("dragend", async () => {
            const pos = marker?.getPosition();
            if (pos) {
              const newLat = typeof pos.lat === "function" ? pos.lat() : (pos.lat as unknown as number);
              const newLng = typeof pos.lng === "function" ? pos.lng() : (pos.lng as unknown as number);
              setOfficeForm((prev) => ({ ...prev, latitude: newLat, longitude: newLng }));
              if (circleInstanceRef.current) {
                circleInstanceRef.current.setCenter({ lat: newLat, lng: newLng });
              }
              try {
                const geoRes = await reverseGeocodeGoogle(newLat, newLng);
                if (geoRes?.formatted_address) {
                  setOfficeForm((prev) => ({ ...prev, address: geoRes.formatted_address }));
                }
              } catch {
                // Silently retain current address if reverse geocoding is unavailable
              }
            }
          });
        } else {
          marker.setPosition(centerPos);
        }

        // 3. Create or update Geofence Circle
        let circle = circleInstanceRef.current;
        if (!circle) {
          circle = new maps.Circle({
            map,
            center: centerPos,
            radius: officeForm.radius_meters,
            fillColor: "#0061f2",
            fillOpacity: 0.16,
            strokeColor: "#0061f2",
            strokeOpacity: 0.85,
            strokeWeight: 2,
          });
          circleInstanceRef.current = circle;
        } else {
          circle.setCenter(centerPos);
          circle.setRadius(officeForm.radius_meters);
        }
      } catch (mapErr) {
        console.warn("Google Maps SDK could not be initialized inside modal canvas:", mapErr);
      } finally {
        if (isMounted) {
          setLoadingMapSdk(false);
        }
      }
    };

    // Initialize cleanly on animation frame for immediate, jank-free modal render
    const frameId = requestAnimationFrame(() => {
      initMap();
    });

    return () => {
      isMounted = false;
      cancelAnimationFrame(frameId);
    };
  }, [officeModalOpen]);

  // Update circle radius when radius buttons clicked — strictly alters circle, does NOT recreate map
  const handleRadiusChange = (meters: number) => {
    setOfficeForm((prev) => ({ ...prev, radius_meters: meters }));
    if (circleInstanceRef.current) {
      circleInstanceRef.current.setRadius(meters);
    }
  };

  // Google Places Autocomplete search (fast 180ms debounce)
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

  // Handle selection of a Place prediction — instantly updates map, marker, circle, address & coords
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
        setOfficeForm((prev) => ({
          ...prev,
          address: formattedAddress,
          latitude: lat,
          longitude: lng,
        }));

        // Instantly re-center map, marker, and circle
        if (googleMapInstanceRef.current) {
          googleMapInstanceRef.current.setCenter({ lat, lng });
          googleMapInstanceRef.current.setZoom(17);
        }
        if (markerInstanceRef.current) {
          markerInstanceRef.current.setPosition({ lat, lng });
        }
        if (circleInstanceRef.current) {
          circleInstanceRef.current.setCenter({ lat, lng });
        }
      }
    } catch {
      showError("Could not resolve location coordinates for selected place.");
    }
  };

  // Save Office
  const handleSaveOffice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!officeForm.name.trim()) {
      showError("Please enter an office name.");
      return;
    }
    if (!officeForm.address.trim()) {
      showError("Please enter or search for an office address.");
      return;
    }

    try {
      if (editingOffice) {
        await apiPut(`/hrms/setup/locations/${editingOffice.id}`, officeForm);
        showSuccess(`Office "${officeForm.name}" updated successfully.`);
      } else {
        await apiPost("/hrms/setup/locations", officeForm);
        showSuccess(`Office "${officeForm.name}" created successfully.`);
      }
      setOfficeModalOpen(false);
      googleMapInstanceRef.current = null;
      markerInstanceRef.current = null;
      circleInstanceRef.current = null;
      fetchLocations();
    } catch (err: any) {
      showError(err.message || "Failed to save office location.");
    }
  };

  const toggleLocationStatus = async (loc: HrmsLocation) => {
    try {
      await apiPatch(`/hrms/setup/locations/${loc.id}/status`, { is_active: !loc.is_active });
      showSuccess(`Office "${loc.name}" ${!loc.is_active ? "enabled" : "disabled"}.`);
      fetchLocations();
    } catch (err: any) {
      showError(err.message || "Failed to update office status.");
    }
  };

  const handleDeleteLocation = async (loc: HrmsLocation) => {
    if (!window.confirm(`Are you sure you want to remove "${loc.name}"? Inactive offices are excluded from attendance.`)) {
      return;
    }
    try {
      await apiDelete(`/hrms/setup/locations/${loc.id}`);
      showSuccess(`Office "${loc.name}" soft-deleted successfully.`);
      fetchLocations();
    } catch (err: any) {
      showError(err.message || "Failed to delete office location.");
    }
  };

  // Initial load based on tab
  useEffect(() => {
    if (activeTab === "leaveTypes") fetchLeaveTypes();
    else if (activeTab === "expenseSettings") fetchExpenseData();
    else if (activeTab === "geoFencing") fetchLocations();
  }, [activeTab]);

  return (
    <AppShell activeKey="hrms-setup">
      <main className="page">
        <Breadcrumb trail={["HRMS", "Setup"]} />

        <div className="page-header">
          <div>
            <h1>HRMS Setup</h1>
            <div className="page-subtitle">
              Configure HRMS global policies, leave types, expense limits, and geofencing parameters.
            </div>
          </div>
        </div>

        {/* Global Feedback Banners */}
        {successMessage && (
          <div
            style={{
              padding: "12px 18px",
              background: "#ecfdf5",
              border: "1px solid #a7f3d0",
              borderRadius: "8px",
              color: "#065f46",
              marginBottom: "16px",
              fontWeight: 600,
              fontSize: "13.5px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span>✓</span>
            <span>{successMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div
            style={{
              padding: "12px 18px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "8px",
              color: "#991b1b",
              marginBottom: "16px",
              fontWeight: 600,
              fontSize: "13.5px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span>⚠</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Setup Internal Screen Tabs */}
        <div className="hrms-tabs-nav">
          <button
            type="button"
            className={`hrms-tab-btn ${activeTab === "leaveTypes" ? "active" : ""}`}
            onClick={() => setActiveTab("leaveTypes")}
          >
            <IconCalendar />
            <span>Leave Types</span>
          </button>
          <button
            type="button"
            className={`hrms-tab-btn ${activeTab === "expenseSettings" ? "active" : ""}`}
            onClick={() => setActiveTab("expenseSettings")}
          >
            <IconCreditCard />
            <span>Expense Settings</span>
          </button>
          <button
            type="button"
            className={`hrms-tab-btn ${activeTab === "geoFencing" ? "active" : ""}`}
            onClick={() => setActiveTab("geoFencing")}
          >
            <IconPin />
            <span>Geo Fencing</span>
          </button>
        </div>

        {/* ================================================================= */}
        {/* TAB 1: LEAVE TYPES                                                */}
        {/* ================================================================= */}
        {activeTab === "leaveTypes" && (
          <div className="hrms-tab-content">
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="hrms-section-title">Leave Types & Entitlements</h2>
                  <div className="hrms-section-desc">Manage standard organizational leave categories and accrual rules</div>
                </div>
                <button type="button" className="btn btn-primary" onClick={openAddLeaveModal}>
                  + Add Leave Type
                </button>
              </div>

              {loadingLeaves ? (
                <div style={{ padding: "40px", textAlign: "center", color: "var(--color-muted)" }}>
                  Loading leave types...
                </div>
              ) : leaveTypes.length === 0 ? (
                <div className="hrms-placeholder-box">
                  <div className="hrms-placeholder-icon">
                    <IconCalendar />
                  </div>
                  <h3 className="hrms-placeholder-title">No Leave Types Configured</h3>
                  <p className="hrms-placeholder-text">Click "+ Add Leave Type" to set up your corporate leave policies.</p>
                </div>
              ) : (
                <div className="hrms-table-container">
                  <table className="hrms-table">
                    <thead>
                      <tr>
                        <th>Leave Name</th>
                        <th>Code</th>
                        <th>Category</th>
                        <th>Annual Balance</th>
                        <th>Max Consecutive</th>
                        <th>Carry Forward</th>
                        <th>Status</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaveTypes.map((item) => (
                        <tr key={item.id}>
                          <td style={{ fontWeight: 600 }}>{item.name}</td>
                          <td>
                            <span className="hrms-badge hrms-badge-info" style={{ fontFamily: "monospace" }}>
                              {item.code || "—"}
                            </span>
                          </td>
                          <td>
                            <span className="hrms-badge hrms-badge-neutral">{item.leave_type}</span>
                          </td>
                          <td>
                            {item.is_paid ? (
                              <span className="hrms-badge hrms-badge-success">Paid</span>
                            ) : (
                              <span className="hrms-badge hrms-badge-neutral">Unpaid</span>
                            )}
                          </td>
                          <td>
                            <div>
                              <strong>{item.annual_balance} days</strong>
                              {item.monthly_accrual && (
                                <span style={{ fontSize: 11, color: "var(--color-muted)", display: "block" }}>
                                  ({item.accrual_amount ?? 1}d/mo)
                                </span>
                              )}
                              {item.attendance_based_accrual && (
                                <span style={{ fontSize: 10, background: "#e0f2fe", color: "#0369a1", padding: "1px 5px", borderRadius: 4, display: "inline-block", marginTop: 2 }}>
                                  +{item.attendance_based_reward ?? 1}d Attn Reward
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <strong>{item.max_consecutive_days}</strong> days
                          </td>
                          <td>{item.carry_forward_days > 0 ? `${item.carry_forward_days} days` : "No"}</td>
                          <td>
                            {item.is_active ? (
                              <span className="hrms-badge hrms-badge-success">Active</span>
                            ) : (
                              <span className="hrms-badge hrms-badge-danger">Inactive</span>
                            )}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <div style={{ display: "inline-flex", gap: "6px" }}>
                              <button
                                type="button"
                                className="hrms-btn-action"
                                onClick={() => openEditLeaveModal(item)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="hrms-btn-action"
                                onClick={() => toggleLeaveStatus(item)}
                              >
                                {item.is_active ? "Disable" : "Enable"}
                              </button>
                              <button
                                type="button"
                                className="hrms-btn-action btn-danger"
                                onClick={() => handleDeleteLeave(item)}
                              >
                                Delete
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
        {/* TAB 2: EXPENSE SETTINGS                                           */}
        {/* ================================================================= */}
        {activeTab === "expenseSettings" && (
          <div className="hrms-tab-content">
            {/* Section A: Expense Categories */}
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="hrms-section-title">Expense Categories</h2>
                  <div className="hrms-section-desc">Manage reimbursable expense codes and classifications</div>
                </div>
                <button type="button" className="btn btn-primary" onClick={openAddCategoryModal}>
                  + Add Category
                </button>
              </div>

              {loadingExpenses ? (
                <div style={{ padding: "30px", textAlign: "center", color: "var(--color-muted)" }}>
                  Loading expense categories...
                </div>
              ) : expenseCategories.length === 0 ? (
                <div className="hrms-placeholder-box">
                  <div className="hrms-placeholder-icon">
                    <IconCreditCard />
                  </div>
                  <h3 className="hrms-placeholder-title">No Expense Categories</h3>
                  <p className="hrms-placeholder-text">Click "+ Add Category" to define expense codes.</p>
                </div>
              ) : (
                <div className="hrms-table-container">
                  <table className="hrms-table">
                    <thead>
                      <tr>
                        <th>Category Name</th>
                        <th>Code</th>
                        <th>Description</th>
                        <th>Status</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenseCategories.map((cat) => (
                        <tr key={cat.id}>
                          <td style={{ fontWeight: 600 }}>{cat.name}</td>
                          <td>
                            <span className="hrms-badge hrms-badge-info">{cat.code || "—"}</span>
                          </td>
                          <td style={{ color: "var(--color-muted)", maxWidth: "340px" }}>
                            {cat.description || "—"}
                          </td>
                          <td>
                            {cat.is_active ? (
                              <span className="hrms-badge hrms-badge-success">Active</span>
                            ) : (
                              <span className="hrms-badge hrms-badge-danger">Inactive</span>
                            )}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <div style={{ display: "inline-flex", gap: "6px" }}>
                              <button
                                type="button"
                                className="hrms-btn-action"
                                onClick={() => openEditCategoryModal(cat)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="hrms-btn-action"
                                onClick={() => toggleCategoryStatus(cat)}
                              >
                                {cat.is_active ? "Disable" : "Enable"}
                              </button>
                              <button
                                type="button"
                                className="hrms-btn-action btn-danger"
                                onClick={() => handleDeleteCategory(cat)}
                              >
                                Delete
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

            {/* Section B & C: Approval Workflow & Claim Rules */}
            <form onSubmit={handleSaveExpenseSettings}>
              <div className="hrms-grid-2">
                {/* Approval Workflow */}
                <div className="card">
                  <div className="card-header">
                    <div>
                      <h2 className="hrms-section-title">Approval Workflow</h2>
                      <div className="hrms-section-desc">Multi-tier hierarchy for claim verification and sign-off</div>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "8px" }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "12px 14px",
                        background: expenseSettings.approval_team_lead ? "#eff6ff" : "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "8px",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(expenseSettings.approval_team_lead)}
                        onChange={(e) =>
                          setExpenseSettings((prev) => ({ ...prev, approval_team_lead: e.target.checked }))
                        }
                        style={{ width: "18px", height: "18px", cursor: "pointer" }}
                      />
                      <div>
                        <div style={{ fontWeight: 600, color: "var(--color-text)" }}>Level 1: Team Lead Review</div>
                        <div style={{ fontSize: "12.5px", color: "var(--color-muted)" }}>
                          Initial check by the employee's direct reporting lead
                        </div>
                      </div>
                    </label>

                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "12px 14px",
                        background: expenseSettings.approval_manager ? "#eff6ff" : "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "8px",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(expenseSettings.approval_manager)}
                        onChange={(e) =>
                          setExpenseSettings((prev) => ({ ...prev, approval_manager: e.target.checked }))
                        }
                        style={{ width: "18px", height: "18px", cursor: "pointer" }}
                      />
                      <div>
                        <div style={{ fontWeight: 600, color: "var(--color-text)" }}>Level 2: Department Manager</div>
                        <div style={{ fontSize: "12.5px", color: "var(--color-muted)" }}>
                          Departmental budget authorization and project alignment
                        </div>
                      </div>
                    </label>

                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "12px 14px",
                        background: expenseSettings.approval_accounts ? "#eff6ff" : "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "8px",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(expenseSettings.approval_accounts)}
                        onChange={(e) =>
                          setExpenseSettings((prev) => ({ ...prev, approval_accounts: e.target.checked }))
                        }
                        style={{ width: "18px", height: "18px", cursor: "pointer" }}
                      />
                      <div>
                        <div style={{ fontWeight: 600, color: "var(--color-text)" }}>Level 3: Accounts & Finance</div>
                        <div style={{ fontSize: "12.5px", color: "var(--color-muted)" }}>
                          Tax verification, invoice audit, and reimbursement disbursement
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Claim Rules */}
                <div className="card">
                  <div className="card-header">
                    <div>
                      <h2 className="hrms-section-title">Claim Rules</h2>
                      <div className="hrms-section-desc">Monetary thresholds, receipt obligations, and deadlines</div>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div className="hrms-form-group">
                      <label>Maximum Single Claim Amount (₹)</label>
                      <input
                        type="number"
                        min="0"
                        value={expenseSettings.max_claim_amount ?? 0}
                        onChange={(e) =>
                          setExpenseSettings((prev) => ({ ...prev, max_claim_amount: Number(e.target.value) }))
                        }
                      />
                    </div>

                    <div className="hrms-form-group">
                      <label>Auto-Approval Threshold (₹)</label>
                      <input
                        type="number"
                        min="0"
                        value={expenseSettings.auto_approval_limit ?? 0}
                        onChange={(e) =>
                          setExpenseSettings((prev) => ({ ...prev, auto_approval_limit: Number(e.target.value) }))
                        }
                      />
                      <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                        Claims below this amount bypass intermediate manager reviews.
                      </span>
                    </div>

                    <div className="hrms-form-group">
                      <label>Submission Window (Days)</label>
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={expenseSettings.submission_window_days ?? 30}
                        onChange={(e) =>
                          setExpenseSettings((prev) => ({
                            ...prev,
                            submission_window_days: Number(e.target.value),
                          }))
                        }
                      />
                      <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                        Maximum allowed days from expense date to submission.
                      </span>
                    </div>

                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        cursor: "pointer",
                        marginTop: "4px",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(expenseSettings.receipt_required)}
                        onChange={(e) =>
                          setExpenseSettings((prev) => ({ ...prev, receipt_required: e.target.checked }))
                        }
                        style={{ width: "17px", height: "17px" }}
                      />
                      <span style={{ fontWeight: 600, fontSize: "13px" }}>Mandatory Receipt / Tax Invoice Upload</span>
                    </label>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "20px" }}>
                <button type="submit" className="btn btn-primary" disabled={savingSettings}>
                  {savingSettings ? "Saving Settings..." : "Save Expense Settings"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 3: GEO FENCING (OFFICE LOCATIONS)                             */}
        {/* ================================================================= */}
        {activeTab === "geoFencing" && (
          <div className="hrms-tab-content">
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="hrms-section-title">Geo Fencing Parameters</h2>
                  <div className="hrms-section-desc">Office boundary coordinates, GPS radius, and geofenced punch enforcement</div>
                </div>
                <button type="button" className="btn btn-primary" onClick={openAddOfficeModal}>
                  + Add Office
                </button>
              </div>

              {/* Part 5 — Verified Summary Card for Inspected / Selected Office */}
              {selectedOffice && (
                <div className="hrms-summary-card" style={{ marginBottom: "16px", marginTop: "4px" }}>
                  <div className="hrms-summary-header">
                    <div className="hrms-summary-title">
                      <IconPin />
                      <span>{selectedOffice.name}</span>
                    </div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <span className="hrms-verified-badge">
                        ✓ GPS Verified
                      </span>
                      <button
                        type="button"
                        className="hrms-btn-action"
                        onClick={() => openEditOfficeModal(selectedOffice)}
                      >
                        Edit Geofence
                      </button>
                    </div>
                  </div>
                  <div className="hrms-summary-address">
                    {selectedOffice.address}
                  </div>
                  <div className="hrms-summary-meta">
                    <div className="hrms-summary-coords">
                      Lat: {selectedOffice.latitude.toFixed(6)}, Lng: {selectedOffice.longitude.toFixed(6)}
                    </div>
                    <div className="hrms-summary-radius">
                      Geofence Radius: <strong>{selectedOffice.radius_meters}m</strong>
                    </div>
                    <div style={{ color: "var(--color-muted)" }}>
                      {selectedOffice.employees_assigned} assigned
                    </div>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${selectedOffice.latitude},${selectedOffice.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hrms-summary-link"
                    >
                      View on Google Maps ↗
                    </a>
                  </div>
                </div>
              )}

              {loadingLocations ? (
                <div style={{ padding: "40px", textAlign: "center", color: "var(--color-muted)" }}>
                  Loading office locations...
                </div>
              ) : locations.length === 0 ? (
                <div className="hrms-placeholder-box">
                  <div className="hrms-placeholder-icon">
                    <IconPin />
                  </div>
                  <h3 className="hrms-placeholder-title">No Office Locations Configured</h3>
                  <p className="hrms-placeholder-text">
                    Add your company office or branches to establish geofenced attendance boundaries.
                  </p>
                </div>
              ) : (
                <div className="hrms-table-container">
                  <table className="hrms-table">
                    <thead>
                      <tr>
                        <th>Office Name</th>
                        <th style={{ minWidth: "280px" }}>Address & Coordinates</th>
                        <th className="hrms-th-center">Radius</th>
                        <th>Employees Assigned</th>
                        <th>Status</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locations.map((loc) => {
                        const isSelected = selectedOffice?.id === loc.id;
                        return (
                          <tr
                            key={loc.id}
                            onClick={() => setSelectedOffice(loc)}
                            style={{
                              cursor: "pointer",
                              background: isSelected ? "#f8fafc" : undefined,
                            }}
                          >
                            <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <IconPin />
                                <span>{loc.name}</span>
                              </div>
                            </td>
                            <td
                              style={{
                                maxWidth: "380px",
                                wordBreak: "break-word",
                                whiteSpace: "normal",
                                lineHeight: 1.45,
                              }}
                            >
                              <div style={{ color: "var(--color-text)" }}>{loc.address}</div>
                              <div className="hrms-table-coords">
                                <span>📍</span>
                                <span>{loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}</span>
                              </div>
                            </td>
                            <td className="hrms-td-center">
                              <span className="hrms-badge hrms-badge-info hrms-radius-pill">{loc.radius_meters} m</span>
                            </td>
                            <td style={{ color: "var(--color-muted)" }}>
                              {loc.employees_assigned} assigned
                            </td>
                            <td>
                              {loc.is_active ? (
                                <span className="hrms-badge hrms-badge-success">
                                  <span className="hrms-status-dot active" />
                                  Active
                                </span>
                              ) : (
                                <span className="hrms-badge hrms-badge-danger">
                                  <span className="hrms-status-dot inactive" />
                                  Inactive
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                              <div style={{ display: "inline-flex", gap: "6px" }}>
                                <button
                                  type="button"
                                  className="hrms-btn-action"
                                  onClick={() => openEditOfficeModal(loc)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="hrms-btn-action"
                                  onClick={() => toggleLocationStatus(loc)}
                                >
                                  {loc.is_active ? "Disable" : "Enable"}
                                </button>
                                <button
                                  type="button"
                                  className="hrms-btn-action btn-danger"
                                  onClick={() => handleDeleteLocation(loc)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL 1: ADD / EDIT LEAVE TYPE                                    */}
        {/* ================================================================= */}
        {leaveModalOpen && (
          <div className="hrms-modal-backdrop" onClick={() => setLeaveModalOpen(false)}>
            <div className="hrms-modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="hrms-modal-header">
                <h3>{editingLeave ? "Edit Leave Type" : "Add Leave Type"}</h3>
                <button
                  type="button"
                  className="hrms-modal-close-btn"
                  onClick={() => setLeaveModalOpen(false)}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveLeave} className="hrms-modal-form">
                <div className="hrms-modal-body" style={{ maxHeight: "72vh", overflowY: "auto", paddingRight: 8 }}>
                  {/* Section 1: Basic Information */}
                  <div style={{ marginBottom: 16 }}>
                    <h4 style={{ margin: "0 0 10px 0", fontSize: 13, fontWeight: 700, color: "var(--color-primary, #0284c7)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Basic Information
                    </h4>
                    <div className="hrms-form-row">
                      <div className="hrms-form-group" style={{ flex: 2 }}>
                        <label>Leave Name *</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Casual Leave, Sick Leave, Earned Leave"
                          value={leaveForm.name}
                          onChange={(e) => setLeaveForm({ ...leaveForm, name: e.target.value })}
                        />
                      </div>
                      <div className="hrms-form-group" style={{ flex: 1 }}>
                        <label>Leave Code</label>
                        <input
                          type="text"
                          placeholder="e.g. CL, SL, EL"
                          value={leaveForm.code}
                          onChange={(e) => setLeaveForm({ ...leaveForm, code: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="hrms-form-row">
                      <div className="hrms-form-group">
                        <label>Category</label>
                        <select
                          value={leaveForm.leave_type}
                          onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value })}
                        >
                          <option value="REGULAR">Regular</option>
                          <option value="MEDICAL">Medical / Sick</option>
                          <option value="EARNED">Earned / Privilege</option>
                          <option value="SPECIAL">Special / Maternity</option>
                        </select>
                      </div>
                      <div className="hrms-form-group">
                        <label>Compensation</label>
                        <select
                          value={leaveForm.is_paid ? "paid" : "unpaid"}
                          onChange={(e) => setLeaveForm({ ...leaveForm, is_paid: e.target.value === "paid" })}
                        >
                          <option value="paid">Paid Leave</option>
                          <option value="unpaid">Unpaid Leave</option>
                        </select>
                      </div>
                    </div>

                    <div className="hrms-form-group">
                      <label>Description</label>
                      <textarea
                        rows={2}
                        placeholder="Purpose, policy context, or notes for employees..."
                        value={leaveForm.description}
                        onChange={(e) => setLeaveForm({ ...leaveForm, description: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Section 2: Entitlement & Accrual */}
                  <div style={{ marginBottom: 16, borderTop: "1px solid var(--color-border, #e2e8f0)", paddingTop: 14 }}>
                    <h4 style={{ margin: "0 0 10px 0", fontSize: 13, fontWeight: 700, color: "var(--color-primary, #0284c7)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Entitlement & Accrual
                    </h4>
                    <div className="hrms-form-row">
                      <div className="hrms-form-group">
                        <label>Annual Quota (Days) *</label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          required
                          value={leaveForm.annual_balance}
                          onChange={(e) =>
                            setLeaveForm({ ...leaveForm, annual_balance: Number(e.target.value) })
                          }
                        />
                      </div>
                      <div className="hrms-form-group">
                        <label>Monthly Accrual Amount (Days/mo)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.25"
                          disabled={!leaveForm.monthly_accrual}
                          value={leaveForm.accrual_amount}
                          onChange={(e) =>
                            setLeaveForm({ ...leaveForm, accrual_amount: Number(e.target.value) })
                          }
                        />
                      </div>
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginBottom: 6 }}>
                      <input
                        type="checkbox"
                        checked={leaveForm.monthly_accrual}
                        onChange={(e) => setLeaveForm({ ...leaveForm, monthly_accrual: e.target.checked })}
                        style={{ width: "16px", height: "16px" }}
                      />
                      <span style={{ fontSize: "13px", fontWeight: 500 }}>
                        Enable Monthly Accrual (Distribute quota monthly rather than lump-sum)
                      </span>
                    </label>
                  </div>

                  {/* Section 3: Rules & Policy Constraints */}
                  <div style={{ marginBottom: 16, borderTop: "1px solid var(--color-border, #e2e8f0)", paddingTop: 14 }}>
                    <h4 style={{ margin: "0 0 10px 0", fontSize: 13, fontWeight: 700, color: "var(--color-primary, #0284c7)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Rules & Application Constraints
                    </h4>
                    <div className="hrms-form-row">
                      <div className="hrms-form-group">
                        <label>Maximum Consecutive Days *</label>
                        <input
                          type="number"
                          min="1"
                          required
                          placeholder="e.g. 3, 5, 15, 30"
                          value={leaveForm.max_consecutive_days}
                          onChange={(e) =>
                            setLeaveForm({ ...leaveForm, max_consecutive_days: Number(e.target.value) })
                          }
                        />
                        <span style={{ fontSize: 11, color: "var(--color-muted)" }}>Fully configurable limit per leave type</span>
                      </div>
                      <div className="hrms-form-group">
                        <label>Minimum Notice Days</label>
                        <input
                          type="number"
                          min="0"
                          value={leaveForm.min_notice_days}
                          onChange={(e) =>
                            setLeaveForm({ ...leaveForm, min_notice_days: Number(e.target.value) })
                          }
                        />
                        <span style={{ fontSize: 11, color: "var(--color-muted)" }}>Days before leave start date</span>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={leaveForm.allow_half_day}
                          onChange={(e) => setLeaveForm({ ...leaveForm, allow_half_day: e.target.checked })}
                          style={{ width: "16px", height: "16px" }}
                        />
                        <span style={{ fontSize: "13px" }}>Allow Half Day</span>
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={leaveForm.allow_backdated}
                          onChange={(e) => setLeaveForm({ ...leaveForm, allow_backdated: e.target.checked })}
                          style={{ width: "16px", height: "16px" }}
                        />
                        <span style={{ fontSize: "13px" }}>Allow Backdated Leave</span>
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={leaveForm.require_attachment}
                          onChange={(e) => setLeaveForm({ ...leaveForm, require_attachment: e.target.checked })}
                          style={{ width: "16px", height: "16px" }}
                        />
                        <span style={{ fontSize: "13px" }}>Require Attachment / Proof</span>
                      </label>
                    </div>
                  </div>

                  {/* Section 4: Carry Forward */}
                  <div style={{ marginBottom: 16, borderTop: "1px solid var(--color-border, #e2e8f0)", paddingTop: 14 }}>
                    <h4 style={{ margin: "0 0 10px 0", fontSize: 13, fontWeight: 700, color: "var(--color-primary, #0284c7)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Carry Forward
                    </h4>
                    <div className="hrms-form-row" style={{ alignItems: "center" }}>
                      <div className="hrms-form-group">
                        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={leaveForm.carry_forward_allowed}
                            onChange={(e) => setLeaveForm({ ...leaveForm, carry_forward_allowed: e.target.checked })}
                            style={{ width: "16px", height: "16px" }}
                          />
                          <span style={{ fontSize: "13px", fontWeight: 600 }}>Allow Carry Forward to Next Year</span>
                        </label>
                      </div>
                      <div className="hrms-form-group">
                        <label>Max Carry Forward Days</label>
                        <input
                          type="number"
                          min="0"
                          disabled={!leaveForm.carry_forward_allowed}
                          value={leaveForm.carry_forward_days}
                          onChange={(e) =>
                            setLeaveForm({ ...leaveForm, carry_forward_days: Number(e.target.value) })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section 5: Attendance-Based Extra Leave Accrual (Requirement 8) */}
                  <div style={{ marginBottom: 16, borderTop: "1px solid var(--color-border, #e2e8f0)", paddingTop: 14, background: "#f8fafc", padding: "12px 14px", borderRadius: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#0369a1", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        Attendance-Based Extra Leave Accrual
                      </h4>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={leaveForm.attendance_based_accrual}
                          onChange={(e) => setLeaveForm({ ...leaveForm, attendance_based_accrual: e.target.checked })}
                          style={{ width: "16px", height: "16px" }}
                        />
                        <span style={{ fontSize: "12px", fontWeight: 700, color: leaveForm.attendance_based_accrual ? "#059669" : "var(--color-muted)" }}>
                          {leaveForm.attendance_based_accrual ? "ENABLED" : "DISABLED"}
                        </span>
                      </label>
                    </div>
                    {leaveForm.attendance_based_accrual && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 8 }}>
                        <div className="hrms-form-group">
                          <label style={{ fontSize: 11 }}>Eligibility Condition</label>
                          <input
                            type="text"
                            placeholder="Full Month Present"
                            value={leaveForm.attendance_based_condition}
                            onChange={(e) => setLeaveForm({ ...leaveForm, attendance_based_condition: e.target.value })}
                          />
                        </div>
                        <div className="hrms-form-group">
                          <label style={{ fontSize: 11 }}>Reward (Days)</label>
                          <input
                            type="number"
                            min="0.5"
                            step="0.5"
                            value={leaveForm.attendance_based_reward}
                            onChange={(e) => setLeaveForm({ ...leaveForm, attendance_based_reward: Number(e.target.value) })}
                          />
                        </div>
                        <div className="hrms-form-group">
                          <label style={{ fontSize: 11 }}>Applicable Departments</label>
                          <input
                            type="text"
                            placeholder="All Departments or Technical, Operations"
                            value={leaveForm.attendance_based_departments}
                            onChange={(e) => setLeaveForm({ ...leaveForm, attendance_based_departments: e.target.value })}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Section 6: Status */}
                  <div className="hrms-form-group" style={{ borderTop: "1px solid var(--color-border, #e2e8f0)", paddingTop: 14 }}>
                    <label>Status</label>
                    <select
                      value={leaveForm.is_active ? "active" : "inactive"}
                      onChange={(e) =>
                        setLeaveForm({ ...leaveForm, is_active: e.target.value === "active" })
                      }
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                <div className="hrms-modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setLeaveModalOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    {editingLeave ? "Save Changes" : "Create Leave Type"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL 2: ADD / EDIT EXPENSE CATEGORY                              */}
        {/* ================================================================= */}
        {categoryModalOpen && (
          <div className="hrms-modal-backdrop" onClick={() => setCategoryModalOpen(false)}>
            <div className="hrms-modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="hrms-modal-header">
                <h3>{editingCategory ? "Edit Expense Category" : "Add Expense Category"}</h3>
                <button
                  type="button"
                  className="hrms-modal-close-btn"
                  onClick={() => setCategoryModalOpen(false)}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveCategory} className="hrms-modal-form">
                <div className="hrms-modal-body">
                  <div className="hrms-form-group">
                    <label>Category Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Travel, Meals, Fuel, Lodging"
                      value={categoryForm.name}
                      onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                    />
                  </div>

                  <div className="hrms-form-row">
                    <div className="hrms-form-group">
                      <label>Category Code</label>
                      <input
                        type="text"
                        placeholder="e.g. TRV, MLS"
                        value={categoryForm.code}
                        onChange={(e) => setCategoryForm({ ...categoryForm, code: e.target.value })}
                      />
                    </div>

                    <div className="hrms-form-group">
                      <label>Status</label>
                      <select
                        value={categoryForm.is_active ? "active" : "inactive"}
                        onChange={(e) =>
                          setCategoryForm({ ...categoryForm, is_active: e.target.value === "active" })
                        }
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>

                  <div className="hrms-form-group">
                    <label>Description</label>
                    <textarea
                      rows={3}
                      placeholder="Explain what expenses qualify under this category..."
                      value={categoryForm.description}
                      onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                    />
                  </div>
                </div>

                <div className="hrms-modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setCategoryModalOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    {editingCategory ? "Save Changes" : "Create Category"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL 3: ADD / EDIT OFFICE (GEO FENCING)                          */}
        {/* ================================================================= */}
        {officeModalOpen && (
          <div className="hrms-modal-backdrop" onClick={() => setOfficeModalOpen(false)}>
            <div className="hrms-modal-card hrms-office-modal" onClick={(e) => e.stopPropagation()}>
              <div className="hrms-modal-header">
                <h3>{editingOffice ? "Edit Office Location" : "Add Office Location"}</h3>
                <button
                  type="button"
                  className="hrms-modal-close-btn"
                  onClick={() => {
                    setOfficeModalOpen(false);
                    googleMapInstanceRef.current = null;
                    markerInstanceRef.current = null;
                    circleInstanceRef.current = null;
                  }}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveOffice} className="hrms-modal-form">
                <div className="hrms-modal-body">
                  <div className="hrms-form-row">
                    <div className="hrms-form-group">
                      <label>Office Name *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Inhyma Thane Office, Pune Branch"
                        value={officeForm.name}
                        onChange={(e) => setOfficeForm({ ...officeForm, name: e.target.value })}
                      />
                    </div>

                    <div className="hrms-form-group">
                      <label>Status</label>
                      <select
                        value={officeForm.is_active ? "active" : "inactive"}
                        onChange={(e) =>
                          setOfficeForm({ ...officeForm, is_active: e.target.value === "active" })
                        }
                      >
                        <option value="active">Active (Available for Attendance)</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>

                  {/* Address Search via Google Places */}
                  <div className="hrms-form-group">
                    <label>Search Address (Google Maps Places)</label>
                    <div className="hrms-autocomplete-container">
                      <input
                        type="text"
                        placeholder="Search street, building, or landmark..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          style={{
                            position: "absolute",
                            right: searchingPlaces ? "90px" : "12px",
                            top: "50%",
                            transform: "translateY(-50%)",
                            background: "transparent",
                            border: "none",
                            color: "var(--color-muted)",
                            cursor: "pointer",
                            fontSize: "14px",
                            padding: "4px",
                          }}
                          onClick={() => {
                            setSearchQuery("");
                            setPredictions([]);
                          }}
                          title="Clear search"
                        >
                          ✕
                        </button>
                      )}
                      {searchingPlaces && (
                        <div
                          style={{
                            position: "absolute",
                            right: "12px",
                            top: "50%",
                            transform: "translateY(-50%)",
                            fontSize: "12px",
                            color: "var(--color-muted)",
                          }}
                        >
                          Searching...
                        </div>
                      )}
                      {predictions.length > 0 && (
                        <div className="hrms-suggestions-dropdown">
                          {predictions.map((p) => {
                            const mainText = p.structured_formatting?.main_text || p.description;
                            const subText = p.structured_formatting?.secondary_text || "";
                            return (
                              <div
                                key={p.place_id}
                                className="hrms-suggestion-item"
                                onClick={() => handleSelectPrediction(p)}
                              >
                                <IconPin />
                                <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                                  <span className="hrms-suggestion-main">{mainText}</span>
                                  {subText && <span className="hrms-suggestion-sub">{subText}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Google Map Container with Draggable Marker & Live Circle & Skeleton */}
                  <div className="hrms-form-group">
                    <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>Interactive Geofence Map</span>
                      <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                        Drag marker to refine exact office center
                      </span>
                    </label>
                    <div className="hrms-map-wrapper">
                      {loadingMapSdk && (
                        <div className="hrms-map-skeleton">
                          <div className="hrms-map-skeleton-icon">
                            <IconPin />
                          </div>
                          <div style={{ fontWeight: 600, fontSize: "13.5px", color: "var(--color-text)" }}>
                            Connecting to Google Maps Platform...
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                            Loading interactive geofence canvas
                          </div>
                        </div>
                      )}
                      <div ref={mapCanvasRef} className="hrms-map-canvas" />
                    </div>
                  </div>

                  {/* Radius Selection Buttons */}
                  <div className="hrms-form-group">
                    <label>
                      Geofence Radius: <strong>{officeForm.radius_meters} meters</strong>
                    </label>
                    <div className="hrms-radius-buttons-group">
                      {RADIUS_OPTIONS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          className={`hrms-radius-btn ${officeForm.radius_meters === r ? "active" : ""}`}
                          onClick={() => handleRadiusChange(r)}
                        >
                          {r}m
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Physical Address Text */}
                  <div className="hrms-form-group">
                    <label>Physical Address *</label>
                    <textarea
                      rows={2}
                      required
                      placeholder="Full physical address..."
                      value={officeForm.address}
                      onChange={(e) => setOfficeForm({ ...officeForm, address: e.target.value })}
                    />
                  </div>

                  {/* Coordinates Preview (Latitude / Longitude) */}
                  <div className="hrms-coords-preview">
                    <div>
                      Lat: <strong>{officeForm.latitude.toFixed(6)}</strong>
                    </div>
                    <div>
                      Lng: <strong>{officeForm.longitude.toFixed(6)}</strong>
                    </div>
                  </div>

                  {/* Part 5 — Verified Summary Card inside Modal */}
                  {officeForm.address && officeForm.latitude && officeForm.longitude && (
                    <div className="hrms-summary-card">
                      <div className="hrms-summary-header">
                        <div className="hrms-summary-title">
                          <IconPin />
                          <span>{officeForm.name.trim() || "Target Location Preview"}</span>
                        </div>
                        <span className="hrms-verified-badge">
                          ✓ GPS Verified
                        </span>
                      </div>
                      <div className="hrms-summary-address">
                        {officeForm.address}
                      </div>
                      <div className="hrms-summary-meta">
                        <div className="hrms-summary-coords">
                          Lat: {officeForm.latitude.toFixed(6)}, Lng: {officeForm.longitude.toFixed(6)}
                        </div>
                        <div className="hrms-summary-radius">
                          Radius: <strong>{officeForm.radius_meters}m</strong>
                        </div>
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${officeForm.latitude},${officeForm.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hrms-summary-link"
                        >
                          View on Google Maps ↗
                        </a>
                      </div>
                    </div>
                  )}
                </div>

                <div className="hrms-modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setOfficeModalOpen(false);
                      googleMapInstanceRef.current = null;
                      markerInstanceRef.current = null;
                      circleInstanceRef.current = null;
                    }}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    {editingOffice ? "Save Changes" : "Save Office"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
