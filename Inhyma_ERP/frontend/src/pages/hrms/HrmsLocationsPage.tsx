/**
 * HRMS Location Management Page.
 *
 * Provides Office/Facility Location administration:
 * - Table view with Name, Type, Address, Radius, Status, Assigned Employees count, Actions
 * - 3-Step "Add Location" Wizard (Step 1: Address & Details -> Step 2: Map & Pin Confirm -> Step 3: Save)
 * - "Edit Location" modal with map re-confirmation
 * - "View Location" modal with interactive map preview and assigned personnel
 * - Soft-disable/enable toggling (no hard deletion)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Banner, Modal, StatusBadge } from "@/components/ui";
import {
  IconBuilding,
  IconMap,
  IconPin,
  IconUsers,
} from "@/components/icons";
import { LocationMapPicker } from "@/components/hrms/LocationMapPicker";
import { apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import { useAuth, useDebouncedValue } from "@/lib/hooks";

export interface HrmsLocationItem {
  id: string;
  name: string;
  location_type: "OFFICE" | "BRANCH" | "WAREHOUSE" | "FACTORY" | "CLIENT_SITE";
  address: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active: boolean;
  assigned_employees_count: number;
  created_at: string;
  updated_at: string;
}

const LOCATION_TYPES: Array<{ value: HrmsLocationItem["location_type"]; label: string }> = [
  { value: "OFFICE", label: "Office" },
  { value: "BRANCH", label: "Branch" },
  { value: "WAREHOUSE", label: "Warehouse" },
  { value: "FACTORY", label: "Factory" },
  { value: "CLIENT_SITE", label: "Client Site" },
];

export function HrmsLocationsPage() {
  const { profile, isSuperAdmin } = useAuth();
  const [locations, setLocations] = useState<HrmsLocationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebouncedValue(searchTerm, 300);
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Add Location Wizard Modal state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [formData, setFormData] = useState<{
    name: string;
    location_type: HrmsLocationItem["location_type"];
    address: string;
    radius_meters: number;
    latitude: number;
    longitude: number;
    finalAddress: string;
  }>({
    name: "",
    location_type: "OFFICE",
    address: "",
    radius_meters: 150,
    latitude: 19.076090,
    longitude: 72.877426,
    finalAddress: "",
  });
  const [isResolvingAddress, setIsResolvingAddress] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit Modal state
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

  // View Modal state
  const [viewTarget, setViewTarget] = useState<HrmsLocationItem | null>(null);

  // Check HR/Admin role
  const isHrAdmin = useMemo(() => {
    if (isSuperAdmin) return true;
    const userRole = String(profile?.role || "").toLowerCase();
    const roles = Array.isArray(profile?.roles) ? profile.roles.map((r) => String(r).toLowerCase()) : [];
    return isSuperAdmin || ["admin", "hr", "hr_manager", "super_admin"].includes(userRole) || roles.some((r) => ["admin", "hr", "hr_manager", "super_admin"].includes(r));
  }, [profile, isSuperAdmin]);

  // Load locations
  const fetchLocations = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiGet<HrmsLocationItem[]>("/api/v1/hrms/locations");
      setLocations(res.data || []);
    } catch (err: any) {
      console.warn("Locations load note:", err);
      if (err?.status !== 404) {
        setError(err);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  // Auto-dismiss success notifications
  useEffect(() => {
    if (!successMsg) return;
    const timer = setTimeout(() => setSuccessMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [successMsg]);

  // Filtered locations
  const filteredLocations = useMemo(() => {
    return locations.filter((loc) => {
      if (typeFilter !== "ALL" && loc.location_type !== typeFilter) return false;
      if (statusFilter === "ACTIVE" && !loc.is_active) return false;
      if (statusFilter === "INACTIVE" && loc.is_active) return false;
      if (!debouncedSearch.trim()) return true;

      const q = debouncedSearch.toLowerCase();
      return (
        loc.name.toLowerCase().includes(q) ||
        loc.address.toLowerCase().includes(q) ||
        loc.location_type.toLowerCase().includes(q)
      );
    });
  }, [locations, debouncedSearch, typeFilter, statusFilter]);

  // Total statistics
  const stats = useMemo(() => {
    const total = locations.length;
    const active = locations.filter((l) => l.is_active).length;
    const totalAssigned = locations.reduce((sum, l) => sum + (l.assigned_employees_count || 0), 0);
    return { total, active, totalAssigned };
  }, [locations]);

  // Open Add Modal
  const handleOpenAdd = () => {
    setFormData({
      name: "",
      location_type: "OFFICE",
      address: "",
      radius_meters: 150,
      latitude: 19.076090,
      longitude: 72.877426,
      finalAddress: "",
    });
    setWizardStep(1);
    setIsAddOpen(true);
  };

  // Step 1 -> Step 2: Resolve address on map
  const handleProceedToMap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.address.trim()) {
      setError(new Error("Please enter Location Name and Address."));
      return;
    }

    setIsResolvingAddress(true);
    setError(null);
    try {
      const res = await apiPost<{
        latitude: number;
        longitude: number;
        display_name: string;
      }>("/api/v1/hrms/geocode", {
        address: formData.address.trim(),
      });

      setFormData((prev) => ({
        ...prev,
        latitude: res.data.latitude,
        longitude: res.data.longitude,
        finalAddress: res.data.display_name || prev.address,
      }));
      setWizardStep(2);
    } catch (err) {
      console.warn("Geocoding service note:", err);
      // Even if network lookup has an issue, proceed to map with default center
      setFormData((prev) => ({
        ...prev,
        finalAddress: prev.address,
      }));
      setWizardStep(2);
    } finally {
      setIsResolvingAddress(false);
    }
  };

  // Step 3: Save confirmed location
  const handleSaveLocation = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await apiPost("/api/v1/hrms/locations", {
        name: formData.name.trim(),
        location_type: formData.location_type,
        address: formData.finalAddress || formData.address.trim(),
        latitude: formData.latitude,
        longitude: formData.longitude,
        radius_meters: Number(formData.radius_meters) || 150,
      });

      setSuccessMsg(`Location "${formData.name}" created successfully!`);
      setIsAddOpen(false);
      fetchLocations();
    } catch (err) {
      console.error("Failed to save location:", err);
      setError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (loc: HrmsLocationItem) => {
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
  };

  // Save Edit
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget || !editFormData) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await apiPut(`/api/v1/hrms/locations/${editTarget.id}`, {
        name: editFormData.name.trim(),
        location_type: editFormData.location_type,
        address: editFormData.address.trim(),
        radius_meters: Number(editFormData.radius_meters),
        latitude: editFormData.latitude,
        longitude: editFormData.longitude,
        is_active: editFormData.is_active,
      });

      setSuccessMsg(`Location "${editFormData.name}" updated successfully!`);
      setEditTarget(null);
      fetchLocations();
    } catch (err) {
      console.error("Failed to update location:", err);
      setError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle Status (Soft-disable / enable)
  const handleToggleStatus = async (loc: HrmsLocationItem) => {
    const actionText = loc.is_active ? "disable" : "enable";
    if (!window.confirm(`Are you sure you want to ${actionText} location "${loc.name}"?`)) {
      return;
    }
    try {
      await apiPatch(`/api/v1/hrms/locations/${loc.id}/toggle-status`, {});
      setSuccessMsg(`Location "${loc.name}" ${loc.is_active ? "disabled" : "enabled"} successfully.`);
      fetchLocations();
    } catch (err) {
      console.error("Failed to toggle location status:", err);
      setError(err);
    }
  };

  return (
    <AppShell activeKey="hrms">
      <main className="page" data-testid="hrms-locations-page">
        <Breadcrumb trail={["HRMS", "Location Management"]} />

        <Banner error={error} success={successMsg} />

        {/* Page Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "22px",
                fontWeight: 700,
                color: "var(--color-text)",
                margin: "0 0 4px 0",
              }}
            >
              Office Location Management
            </h1>
            <p style={{ margin: 0, fontSize: "13.5px", color: "var(--color-muted)" }}>
              Manage corporate offices, branches, factories, and warehouses with interactive geofencing.
            </p>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleOpenAdd}
              disabled={!isHrAdmin}
              title={isHrAdmin ? "Add Office Location" : "HR/Admin privileges required"}
              data-testid="add-location-btn"
              style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontWeight: 600 }}
            >
              <IconPin width={16} height={16} />
              <span>Add Location</span>
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="stat-grid" style={{ marginBottom: "20px" }}>
          <div className="stat-card">
            <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--color-muted)" }}>
              Total Locations
            </div>
            <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--color-text)", marginTop: "4px" }}>
              {stats.total}
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "4px" }}>
              {stats.active} Active across regions
            </div>
          </div>

          <div className="stat-card tone-success">
            <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--color-muted)" }}>
              Active Geofences
            </div>
            <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--color-text)", marginTop: "4px" }}>
              {stats.active}
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "4px" }}>
              Operational attendance zones
            </div>
          </div>

          <div className="stat-card tone-warning">
            <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--color-muted)" }}>
              Staff Assigned
            </div>
            <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--color-text)", marginTop: "4px" }}>
              {stats.totalAssigned}
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "4px" }}>
              Total employee-location linkages
            </div>
          </div>
        </div>

        {/* Filter / Search Bar */}
        <div
          className="card"
          style={{
            padding: "14px 18px",
            marginBottom: "16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="text"
              placeholder="Search by name, address, or type..."
              className="form-control"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: "280px" }}
              data-testid="location-search-input"
            />

            <select
              className="form-control"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              style={{ width: "150px" }}
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
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
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
                  <th style={{ width: "30%" }}>Address</th>
                  <th style={{ width: "10%" }}>Radius</th>
                  <th style={{ width: "10%" }}>Status</th>
                  <th style={{ width: "12%" }}>Assigned Staff</th>
                  <th style={{ width: "12%", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "40px" }}>
                      <div className="skeleton-line" style={{ width: "200px", margin: "0 auto 10px" }} />
                      <div style={{ color: "var(--color-muted)", fontSize: "13px" }}>Loading locations...</div>
                    </td>
                  </tr>
                ) : filteredLocations.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "40px" }}>
                      <IconMap width={32} height={32} style={{ color: "var(--color-muted)", marginBottom: "8px" }} />
                      <div style={{ fontWeight: 600, color: "var(--color-text)", marginBottom: "4px" }}>
                        No locations found
                      </div>
                      <div style={{ fontSize: "13px", color: "var(--color-muted)" }}>
                        {searchTerm ? "No locations match your search." : "Add your first office location to begin."}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredLocations.map((loc) => (
                    <tr key={loc.id} data-testid={`location-row-${loc.id}`}>
                      <td>
                        <div style={{ fontWeight: 600, color: "var(--color-text)" }}>{loc.name}</div>
                        <div style={{ fontSize: "11px", color: "var(--color-muted)", fontFamily: "monospace" }}>
                          {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                        </div>
                      </td>
                      <td>
                        <span className="badge" style={{ background: "var(--color-surface-subtle)", border: "1px solid var(--color-border)" }}>
                          {loc.location_type}
                        </span>
                      </td>
                      <td>
                        <div
                          title={loc.address}
                          style={{
                            maxWidth: "280px",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            fontSize: "13px",
                            color: "var(--color-text)",
                          }}
                        >
                          {loc.address}
                        </div>
                      </td>
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            fontSize: "12.5px",
                            fontWeight: 600,
                            color: "var(--color-primary)",
                          }}
                        >
                          {loc.radius_meters} m
                        </span>
                      </td>
                      <td>
                        <StatusBadge isActive={loc.is_active} />
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <IconUsers width={14} height={14} style={{ color: "var(--color-muted)" }} />
                          <span style={{ fontWeight: 600 }}>{loc.assigned_employees_count}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: "6px" }}>
                          {/* View */}
                          <button
                            type="button"
                            className="btn btn-sm"
                            title="View on Map"
                            onClick={() => setViewTarget(loc)}
                            data-testid={`view-btn-${loc.id}`}
                            style={{ padding: "4px 8px" }}
                          >
                            View
                          </button>

                          {/* Edit */}
                          <button
                            type="button"
                            className="btn btn-sm"
                            title="Edit Location"
                            onClick={() => handleOpenEdit(loc)}
                            data-testid={`edit-btn-${loc.id}`}
                            style={{ padding: "4px 8px" }}
                          >
                            Edit
                          </button>

                          {/* Disable / Enable (Soft-disable) */}
                          <button
                            type="button"
                            className="btn btn-sm"
                            title={loc.is_active ? "Disable Location" : "Enable Location"}
                            onClick={() => handleToggleStatus(loc)}
                            data-testid={`toggle-status-btn-${loc.id}`}
                            style={{
                              padding: "4px 8px",
                              color: loc.is_active ? "var(--color-danger, #ef4444)" : "var(--color-success, #10b981)",
                            }}
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

        {/* ================================================================= */}
        {/* ADD LOCATION MODAL (3-STEP WIZARD)                                */}
        {/* ================================================================= */}
        <Modal
          open={isAddOpen}
          variant="center"
          cardStyle={{ width: "100%", maxWidth: "720px" }}
          title={
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <IconPin width={20} height={20} style={{ color: "var(--color-primary)" }} />
              <span>Add Office Location — Step {wizardStep} of 2</span>
            </div>
          }
          onClose={() => !isSubmitting && setIsAddOpen(false)}
        >
          {wizardStep === 1 ? (
            /* STEP 1: Details & Address */
            <form onSubmit={handleProceedToMap} data-testid="add-location-step1-form">
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "16px 0" }}>
                <div>
                  <label className="form-label">
                    Location Name <span style={{ color: "red" }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. Mumbai Corporate Headquarters"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    data-testid="input-location-name"
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                  <div>
                    <label className="form-label">
                      Location Type <span style={{ color: "red" }}>*</span>
                    </label>
                    <select
                      className="form-control"
                      value={formData.location_type}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          location_type: e.target.value as HrmsLocationItem["location_type"],
                        })
                      }
                      data-testid="select-location-type"
                    >
                      {LOCATION_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="form-label">
                      Geofence Radius (meters) <span style={{ color: "red" }}>*</span>
                    </label>
                    <input
                      type="number"
                      className="form-control"
                      min={10}
                      max={5000}
                      step={10}
                      required
                      value={formData.radius_meters}
                      onChange={(e) => setFormData({ ...formData, radius_meters: Number(e.target.value) })}
                      data-testid="input-radius-meters"
                    />
                    <div style={{ fontSize: "11px", color: "var(--color-muted)", marginTop: "4px" }}>
                      Default is 150m for standard premises.
                    </div>
                  </div>
                </div>

                <div>
                  <label className="form-label">
                    Full Address <span style={{ color: "red" }}>*</span>
                  </label>
                  <textarea
                    className="form-control"
                    rows={3}
                    placeholder="e.g. Platina Tower, Bandra Kurla Complex, Bandra East, Mumbai, Maharashtra 400051"
                    required
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    data-testid="input-address"
                  />
                  <div style={{ fontSize: "11px", color: "var(--color-muted)", marginTop: "4px" }}>
                    The system will resolve this address onto an interactive map in the next step.
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                  paddingTop: "16px",
                  borderTop: "1px solid var(--color-border)",
                }}
              >
                <button
                  type="button"
                  className="btn"
                  onClick={() => setIsAddOpen(false)}
                  disabled={isResolvingAddress}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isResolvingAddress || !formData.name.trim() || !formData.address.trim()}
                  data-testid="proceed-to-map-btn"
                >
                  {isResolvingAddress ? "Resolving Address..." : "Proceed to Map →"}
                </button>
              </div>
            </form>
          ) : (
            /* STEP 2: Interactive Map & Pin Confirmation */
            <div data-testid="add-location-step2-container">
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px 0" }}>
                <div
                  style={{
                    background: "var(--color-primary-soft, rgba(37,99,235,0.08))",
                    border: "1px solid var(--color-primary)",
                    borderRadius: "var(--radius-sm, 6px)",
                    padding: "10px 14px",
                    fontSize: "12.5px",
                    color: "var(--color-text)",
                  }}
                >
                  <strong>Confirm Pin Position:</strong> We resolved your address. You can drag the pin or click on the map to slightly adjust the exact entrance or premises boundary before saving.
                </div>

                {/* Final Address display */}
                <div>
                  <label className="form-label" style={{ fontSize: "12px" }}>
                    Final Resolved Address
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.finalAddress || formData.address}
                    onChange={(e) => setFormData({ ...formData, finalAddress: e.target.value })}
                    style={{ fontSize: "12.5px" }}
                    data-testid="input-final-address"
                  />
                </div>

                {/* Radius Adjuster on Map */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <label className="form-label" style={{ margin: 0, fontSize: "12px", whiteSpace: "nowrap" }}>
                    Radius: <strong>{formData.radius_meters}m</strong>
                  </label>
                  <input
                    type="range"
                    min={20}
                    max={1000}
                    step={10}
                    value={formData.radius_meters}
                    onChange={(e) => setFormData({ ...formData, radius_meters: Number(e.target.value) })}
                    style={{ flex: 1 }}
                    data-testid="slider-radius"
                  />
                </div>

                {/* Map Picker Component */}
                <LocationMapPicker
                  latitude={formData.latitude}
                  longitude={formData.longitude}
                  radiusMeters={formData.radius_meters}
                  height="340px"
                  onChange={(coords) => {
                    setFormData((prev) => ({
                      ...prev,
                      latitude: coords.latitude,
                      longitude: coords.longitude,
                      finalAddress: coords.address || prev.finalAddress,
                    }));
                  }}
                />
              </div>

              {/* Wizard Controls */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "10px",
                  paddingTop: "16px",
                  borderTop: "1px solid var(--color-border)",
                  marginTop: "8px",
                }}
              >
                <button
                  type="button"
                  className="btn"
                  onClick={() => setWizardStep(1)}
                  disabled={isSubmitting}
                >
                  ← Back to Details
                </button>

                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setIsAddOpen(false)}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSaveLocation}
                    disabled={isSubmitting}
                    data-testid="confirm-save-location-btn"
                  >
                    {isSubmitting ? "Saving Location..." : "Confirm & Save Location"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </Modal>

        {/* ================================================================= */}
        {/* EDIT LOCATION MODAL                                               */}
        {/* ================================================================= */}
        {editTarget && editFormData && (
          <Modal
            open={Boolean(editTarget)}
            variant="center"
            cardStyle={{ width: "100%", maxWidth: "720px" }}
            title={`Edit Location — ${editTarget.name}`}
            onClose={() => !isSubmitting && setEditTarget(null)}
          >
            <form onSubmit={handleSaveEdit} data-testid="edit-location-form">
              <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "14px 0" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "12px" }}>
                  <div>
                    <label className="form-label">Location Name</label>
                    <input
                      type="text"
                      className="form-control"
                      required
                      value={editFormData.name}
                      onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                      data-testid="edit-location-name"
                    />
                  </div>

                  <div>
                    <label className="form-label">Type</label>
                    <select
                      className="form-control"
                      value={editFormData.location_type}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          location_type: e.target.value as HrmsLocationItem["location_type"],
                        })
                      }
                      data-testid="edit-location-type"
                    >
                      {LOCATION_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "12px" }}>
                  <div>
                    <label className="form-label">Full Address</label>
                    <input
                      type="text"
                      className="form-control"
                      required
                      value={editFormData.address}
                      onChange={(e) => setEditFormData({ ...editFormData, address: e.target.value })}
                      data-testid="edit-location-address"
                    />
                  </div>

                  <div>
                    <label className="form-label">Radius (meters)</label>
                    <input
                      type="number"
                      className="form-control"
                      min={10}
                      max={5000}
                      step={10}
                      required
                      value={editFormData.radius_meters}
                      onChange={(e) => setEditFormData({ ...editFormData, radius_meters: Number(e.target.value) })}
                      data-testid="edit-radius-meters"
                    />
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="checkbox"
                    id="edit-is-active"
                    checked={editFormData.is_active}
                    onChange={(e) => setEditFormData({ ...editFormData, is_active: e.target.checked })}
                    data-testid="edit-is-active"
                  />
                  <label htmlFor="edit-is-active" style={{ fontSize: "13px", margin: 0, cursor: "pointer" }}>
                    Active (Enabled for employee attendance and assignments)
                  </label>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: "12px" }}>
                    Pin Position & Geofence Preview
                  </label>
                  <LocationMapPicker
                    latitude={editFormData.latitude}
                    longitude={editFormData.longitude}
                    radiusMeters={editFormData.radius_meters}
                    height="280px"
                    onChange={(coords) => {
                      setEditFormData((prev) =>
                        prev
                          ? {
                              ...prev,
                              latitude: coords.latitude,
                              longitude: coords.longitude,
                              address: coords.address || prev.address,
                            }
                          : null
                      );
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                  paddingTop: "14px",
                  borderTop: "1px solid var(--color-border)",
                }}
              >
                <button
                  type="button"
                  className="btn"
                  onClick={() => setEditTarget(null)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmitting}
                  data-testid="save-edit-location-btn"
                >
                  {isSubmitting ? "Updating..." : "Save Changes"}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* ================================================================= */}
        {/* VIEW LOCATION MODAL                                               */}
        {/* ================================================================= */}
        {viewTarget && (
          <Modal
            open={Boolean(viewTarget)}
            variant="center"
            cardStyle={{ width: "100%", maxWidth: "680px" }}
            title={
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <IconBuilding width={18} height={18} style={{ color: "var(--color-primary)" }} />
                <span>{viewTarget.name}</span>
              </div>
            }
            onClose={() => setViewTarget(null)}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "14px 0" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: "12px",
                  padding: "12px 14px",
                  background: "var(--color-surface-subtle)",
                  borderRadius: "var(--radius-sm, 6px)",
                  fontSize: "12.5px",
                }}
              >
                <div>
                  <div style={{ color: "var(--color-muted)" }}>Type</div>
                  <div style={{ fontWeight: 600, marginTop: "2px" }}>{viewTarget.location_type}</div>
                </div>
                <div>
                  <div style={{ color: "var(--color-muted)" }}>Status</div>
                  <div style={{ marginTop: "2px" }}>
                    <StatusBadge isActive={viewTarget.is_active} />
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--color-muted)" }}>Geofence Radius</div>
                  <div style={{ fontWeight: 600, marginTop: "2px" }}>{viewTarget.radius_meters} meters</div>
                </div>
                <div>
                  <div style={{ color: "var(--color-muted)" }}>Assigned Staff</div>
                  <div style={{ fontWeight: 600, marginTop: "2px" }}>
                    {viewTarget.assigned_employees_count} employees
                  </div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: "12px", color: "var(--color-muted)", marginBottom: "4px" }}>Address</div>
                <div style={{ fontSize: "13.5px", color: "var(--color-text)", fontWeight: 500 }}>
                  {viewTarget.address}
                </div>
              </div>

              <div>
                <div style={{ fontSize: "12px", color: "var(--color-muted)", marginBottom: "6px" }}>
                  Geofence Map View
                </div>
                <LocationMapPicker
                  latitude={viewTarget.latitude}
                  longitude={viewTarget.longitude}
                  radiusMeters={viewTarget.radius_meters}
                  readOnly={true}
                  height="300px"
                />
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                paddingTop: "14px",
                borderTop: "1px solid var(--color-border)",
              }}
            >
              <button type="button" className="btn" onClick={() => setViewTarget(null)}>
                Close
              </button>
            </div>
          </Modal>
        )}
      </main>
    </AppShell>
  );
}
