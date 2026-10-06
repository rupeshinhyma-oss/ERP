import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import {
  IconBox,
  IconClose,
  IconPlus,
  IconSearch,
  IconWrench,
} from "@/components/icons";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { useToast } from "@/lib/toast";
import "./hrms.css";

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export interface AssetHistoryItem {
  id: string;
  asset_id: string;
  action: string;
  previous_value: string | null;
  new_value: string | null;
  user_id?: string | null;
  user_name?: string | null;
  performed_by: string | null;
  performed_by_name: string | null;
  notes: string | null;
  created_at: string;
}

export interface AssetAssignmentItem {
  id: string;
  asset_id: string;
  employee_id: string;
  employee_name?: string | null;
  employee_code?: string | null;
  employee_department?: string | null;
  employee_branch?: string | null;
  assigned_at: string;
  returned_at?: string | null;
  expected_return_date?: string | null;
  assignment_status: string;
  condition_at_assignment?: string | null;
  condition_at_return?: string | null;
  assignment_notes?: string | null;
  return_notes?: string | null;
  created_at: string;
}

export interface AssetSummaryData {
  total: number;
  available: number;
  assigned: number;
  maintenance: number;
  damaged: number;
  lost: number;
  retired: number;
}

export interface Asset {
  id: string;
  asset_code: string;
  asset_name: string;
  asset_category: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  purchase_date: string | null;
  purchase_cost: number | null;
  vendor: string | null;
  warranty_expiry: string | null;
  status: "AVAILABLE" | "ASSIGNED" | "MAINTENANCE" | "UNDER_MAINTENANCE" | "DAMAGED" | "LOST" | "RETIRED" | string;
  condition: "NEW" | "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | "DAMAGED" | string;
  location_id: string | null;
  location_name: string | null;
  branch_name?: string | null;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  assigned_to_code: string | null;
  assigned_to_department: string | null;
  assigned_to_branch?: string | null;
  assigned_date: string | null;
  expected_return_date?: string | null;
  description: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  updated_by?: string | null;
  updated_by_name?: string | null;
  created_at: string;
  updated_at: string;
  history?: AssetHistoryItem[];
  assignments?: AssetAssignmentItem[];
}

export interface DbLocation {
  id: string;
  name: string;
  location_type?: string;
}

export interface DbUser {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  employee_code?: string | null;
  email?: string | null;
  is_active?: boolean;
  department?: string | null;
  branch?: string | null;
  roles?: string[];
}

const CATEGORY_OPTIONS = [
  "Laptop",
  "Desktop",
  "Mobile Phone",
  "Tablet",
  "Monitor",
  "Printer",
  "Networking Equipment",
  "Office Equipment",
  "Furniture",
  "Vehicle",
  "Other",
];

const STATUS_OPTIONS = [
  { value: "ALL", label: "All Statuses" },
  { value: "AVAILABLE", label: "Available" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "DAMAGED", label: "Damaged" },
  { value: "RETIRED", label: "Retired" },
];

const CONDITION_OPTIONS = ["NEW", "EXCELLENT", "GOOD", "FAIR", "POOR", "DAMAGED"];

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AssetPage() {
  const showToast = useToast();

  // Primary data state
  const [assets, setAssets] = useState<Asset[]>([]);
  const [locations, setLocations] = useState<DbLocation[]>([]);
  const [employees, setEmployees] = useState<DbUser[]>([]);
  const [backendSummary, setBackendSummary] = useState<AssetSummaryData | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Simplified Filters
  const [search, setSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [branchFilter, setBranchFilter] = useState<string>("ALL");
  const [assignmentFilter, setAssignmentFilter] = useState<string>("ALL");

  // Modals state
  const [isAddOpen, setIsAddOpen] = useState<boolean>(false);
  const [isEditOpen, setIsEditOpen] = useState<boolean>(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);

  const [isAssignOpen, setIsAssignOpen] = useState<boolean>(false);
  const [assigningAsset, setAssigningAsset] = useState<Asset | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState<string>("");

  const [isReturnOpen, setIsReturnOpen] = useState<boolean>(false);
  const [returningAsset, setReturningAsset] = useState<Asset | null>(null);

  const [isStatusOpen, setIsStatusOpen] = useState<boolean>(false);
  const [statusAsset, setStatusAsset] = useState<Asset | null>(null);

  // Form states
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Add form fields
  const [addForm, setAddForm] = useState({
    asset_name: "",
    asset_category: "Laptop",
    asset_code: "",
    brand: "",
    model: "",
    serial_number: "",
    purchase_date: "",
    purchase_cost: "",
    vendor: "",
    warranty_expiry: "",
    condition: "GOOD",
    location_id: "",
    description: "",
  });

  // Edit form fields
  const [editForm, setEditForm] = useState({
    asset_name: "",
    asset_category: "Laptop",
    brand: "",
    model: "",
    serial_number: "",
    purchase_date: "",
    purchase_cost: "",
    vendor: "",
    warranty_expiry: "",
    condition: "GOOD",
    location_id: "",
    description: "",
  });

  // Assignment form fields
  const [assignForm, setAssignForm] = useState({
    employee_id: "",
    assigned_date: new Date().toISOString().split("T")[0],
    notes: "",
  });

  // Return form fields
  const [returnForm, setReturnForm] = useState({
    return_date: new Date().toISOString().split("T")[0],
    condition_after_return: "GOOD",
    notes: "",
  });

  // Status form fields
  const [statusForm, setStatusForm] = useState({
    status: "AVAILABLE",
    notes: "",
  });

  // 1. Fetch Assets and Summary
  const fetchAssets = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiGet<Asset[]>("/hrms/assets");
      setAssets(res.data || []);
    } catch (err: any) {
      console.error("Failed to load assets:", err);
      setError("Unable to load assets. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const sumRes = await apiGet<AssetSummaryData>("/hrms/assets/summary");
      if (sumRes.data) {
        setBackendSummary(sumRes.data);
      }
    } catch (err) {
      console.warn("Could not load backend summary metrics:", err);
    }
  }, []);

  // 2. Fetch Supporting Data (Locations & Active Employees from users DB)
  const fetchSupportingData = useCallback(async () => {
    try {
      const locRes = await apiGet<DbLocation[]>("/hrms/setup/locations");
      setLocations(locRes.data || []);
    } catch (err) {
      console.warn("Could not load branches / locations:", err);
    }

    try {
      const userRes = await apiGet<any[]>("/hrms/employees");
      const activeUsers = (userRes.data || []).filter((u: any) => u.is_active !== false);
      setEmployees(activeUsers);
    } catch (err) {
      console.warn("Could not load database users:", err);
    }
  }, []);

  useEffect(() => {
    fetchAssets();
    fetchSummary();
    fetchSupportingData();
  }, [fetchAssets, fetchSummary, fetchSupportingData]);

  // Filtered Employees for Assign Modal
  const filteredEmployees = useMemo(() => {
    if (!employeeSearch.trim()) return employees;
    const q = employeeSearch.toLowerCase();
    return employees.filter((emp) => {
      const fullName = `${emp.first_name || ""} ${emp.last_name || ""}`.toLowerCase();
      const uName = (emp.username || "").toLowerCase();
      const code = (emp.employee_code || "").toLowerCase();
      const email = (emp.email || "").toLowerCase();
      return fullName.includes(q) || uName.includes(q) || code.includes(q) || email.includes(q);
    });
  }, [employees, employeeSearch]);

  // Selected Employee Details for Assign Modal
  const selectedAssignEmployee = useMemo(() => {
    return employees.find((e) => e.id === assignForm.employee_id) || null;
  }, [employees, assignForm.employee_id]);

  // Assigned Employee Details for Edit Modal
  const currentAssignedUser = useMemo(() => {
    if (!editingAsset || !editingAsset.assigned_to_user_id) return null;
    return employees.find((e) => e.id === editingAsset.assigned_to_user_id) || null;
  }, [editingAsset, employees]);

  // Filtered Assets Computation
  const filteredAssets = useMemo(() => {
    return assets.filter((a) => {
      // Search
      if (search.trim()) {
        const q = search.toLowerCase();
        const codeMatch = (a.asset_code || "").toLowerCase().includes(q);
        const nameMatch = (a.asset_name || "").toLowerCase().includes(q);
        const serialMatch = (a.serial_number || "").toLowerCase().includes(q);
        const empNameMatch = (a.assigned_to_name || "").toLowerCase().includes(q);
        const empCodeMatch = (a.assigned_to_code || "").toLowerCase().includes(q);
        if (!codeMatch && !nameMatch && !serialMatch && !empNameMatch && !empCodeMatch) {
          return false;
        }
      }

      // Status
      if (statusFilter !== "ALL") {
        const s = a.status.toUpperCase();
        if (statusFilter === "MAINTENANCE") {
          if (s !== "MAINTENANCE" && s !== "UNDER_MAINTENANCE") return false;
        } else if (s !== statusFilter) {
          return false;
        }
      }

      // Category
      if (categoryFilter !== "ALL" && a.asset_category !== categoryFilter) {
        return false;
      }

      // Branch
      if (branchFilter !== "ALL") {
        const bMatch =
          a.location_id === branchFilter ||
          a.location_name === branchFilter ||
          a.branch_name === branchFilter ||
          a.assigned_to_branch === branchFilter;
        if (!bMatch) return false;
      }

      // Assignment
      if (assignmentFilter === "ASSIGNED" && !a.assigned_to_user_id) {
        return false;
      }
      if (assignmentFilter === "UNASSIGNED" && a.assigned_to_user_id) {
        return false;
      }

      return true;
    });
  }, [assets, search, statusFilter, categoryFilter, branchFilter, assignmentFilter]);

  // -------------------------------------------------------------------------
  // Handlers: Add Submit
  // -------------------------------------------------------------------------
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.asset_name.trim() || !addForm.asset_category) {
      showToast("Please provide asset name and category", "error");
      return;
    }

    setSubmitting(true);
    try {
      const payload: any = {
        asset_name: addForm.asset_name.trim(),
        asset_category: addForm.asset_category,
        brand: addForm.brand.trim() || undefined,
        model: addForm.model.trim() || undefined,
        serial_number: addForm.serial_number.trim() || undefined,
        vendor: addForm.vendor.trim() || undefined,
        purchase_date: addForm.purchase_date || undefined,
        purchase_cost: addForm.purchase_cost ? parseFloat(addForm.purchase_cost) : undefined,
        warranty_expiry: addForm.warranty_expiry || undefined,
        condition: addForm.condition,
        location_id: addForm.location_id || undefined,
        description: addForm.description.trim() || undefined,
      };
      if (addForm.asset_code.trim()) {
        payload.asset_code = addForm.asset_code.trim();
      }

      await apiPost("/hrms/assets", payload);
      showToast("Asset created successfully", "success");
      setIsAddOpen(false);
      setAddForm({
        asset_name: "",
        asset_category: "Laptop",
        asset_code: "",
        brand: "",
        model: "",
        serial_number: "",
        purchase_date: "",
        purchase_cost: "",
        vendor: "",
        warranty_expiry: "",
        condition: "GOOD",
        location_id: "",
        description: "",
      });
      await fetchAssets();
      await fetchSummary();
    } catch (err: any) {
      showToast(err?.message || "Failed to create asset", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Handlers: Edit Submit
  // -------------------------------------------------------------------------
  const openEditModal = (asset: Asset) => {
    setEditingAsset(asset);
    setEditForm({
      asset_name: asset.asset_name || "",
      asset_category: asset.asset_category || "Laptop",
      brand: asset.brand || "",
      model: asset.model || "",
      serial_number: asset.serial_number || "",
      purchase_date: asset.purchase_date || "",
      purchase_cost: asset.purchase_cost != null ? String(asset.purchase_cost) : "",
      vendor: asset.vendor || "",
      warranty_expiry: asset.warranty_expiry || "",
      condition: asset.condition || "GOOD",
      location_id: asset.location_id || "",
      description: asset.description || "",
    });
    setIsEditOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAsset) return;

    setSubmitting(true);
    try {
      const payload: any = {
        asset_name: editForm.asset_name.trim(),
        asset_category: editForm.asset_category,
        brand: editForm.brand.trim() || undefined,
        model: editForm.model.trim() || undefined,
        serial_number: editForm.serial_number.trim() || undefined,
        vendor: editForm.vendor.trim() || undefined,
        purchase_date: editForm.purchase_date || undefined,
        purchase_cost: editForm.purchase_cost ? parseFloat(editForm.purchase_cost) : undefined,
        warranty_expiry: editForm.warranty_expiry || undefined,
        condition: editForm.condition,
        location_id: editForm.location_id || undefined,
        description: editForm.description.trim() || undefined,
      };

      await apiPatch(`/hrms/assets/${editingAsset.id}`, payload);
      showToast("Asset updated successfully", "success");
      setIsEditOpen(false);
      setEditingAsset(null);
      await fetchAssets();
      await fetchSummary();
    } catch (err: any) {
      showToast(err?.message || "Failed to update asset", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Handlers: Simple Assignment
  // -------------------------------------------------------------------------
  const openAssignModal = (asset: Asset) => {
    setAssigningAsset(asset);
    setEmployeeSearch("");
    setAssignForm({
      employee_id: "",
      assigned_date: new Date().toISOString().split("T")[0],
      notes: "",
    });
    setIsAssignOpen(true);
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningAsset) return;
    if (!assignForm.employee_id) {
      showToast("Please choose an employee from the database", "error");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        employee_id: assignForm.employee_id,
        assigned_date: assignForm.assigned_date,
        notes: assignForm.notes.trim() || undefined,
      };

      await apiPost(`/hrms/assets/${assigningAsset.id}/assign`, payload);
      showToast("Asset assigned successfully", "success");
      setIsAssignOpen(false);
      setAssigningAsset(null);
      await fetchAssets();
      await fetchSummary();
    } catch (err: any) {
      showToast(err?.message || "Failed to assign asset", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Handlers: Simple Return
  // -------------------------------------------------------------------------
  const openReturnModal = (asset: Asset) => {
    setReturningAsset(asset);
    setReturnForm({
      return_date: new Date().toISOString().split("T")[0],
      condition_after_return: "GOOD",
      notes: "",
    });
    setIsReturnOpen(true);
  };

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returningAsset) return;

    setSubmitting(true);
    try {
      const payload = {
        return_date: returnForm.return_date,
        condition_after_return: returnForm.condition_after_return,
        notes: returnForm.notes.trim() || undefined,
      };

      await apiPost(`/hrms/assets/${returningAsset.id}/return`, payload);
      showToast("Asset returned successfully", "success");
      setIsReturnOpen(false);
      setReturningAsset(null);
      await fetchAssets();
      await fetchSummary();
    } catch (err: any) {
      showToast(err?.message || "Failed to return asset", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Handlers: Direct Status Change
  // -------------------------------------------------------------------------
  const openStatusModal = (asset: Asset) => {
    setStatusAsset(asset);
    setStatusForm({
      status: asset.status,
      notes: "",
    });
    setIsStatusOpen(true);
  };

  const handleStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusAsset) return;

    setSubmitting(true);
    try {
      await apiPatch(`/hrms/assets/${statusAsset.id}/status`, {
        status: statusForm.status,
        notes: statusForm.notes.trim() || undefined,
      });

      showToast("Asset status updated successfully", "success");
      setIsStatusOpen(false);
      setStatusAsset(null);
      await fetchAssets();
      await fetchSummary();
    } catch (err: any) {
      showToast(err?.message || "Failed to update status", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Handlers: Soft-Delete / Retire
  // -------------------------------------------------------------------------
  const handleDeleteAsset = async (asset: Asset) => {
    if (!window.confirm(`Are you sure you want to retire asset '${asset.asset_name}' (${asset.asset_code})?`)) {
      return;
    }

    try {
      await apiDelete(`/hrms/assets/${asset.id}`);
      showToast("Asset retired successfully", "success");
      await fetchAssets();
      await fetchSummary();
    } catch (err: any) {
      showToast(err?.message || "Failed to retire asset", "error");
    }
  };

  // -------------------------------------------------------------------------
  // 4 Dashboard Summary Metrics (Simplified & DB-driven)
  // -------------------------------------------------------------------------
  const totalCount = backendSummary?.total ?? assets.length;
  const availableCount = backendSummary?.available ?? assets.filter((a) => a.status === "AVAILABLE").length;
  const assignedCount = backendSummary?.assigned ?? assets.filter((a) => a.status === "ASSIGNED" || a.status === "IN_USE").length;
  const maintenanceCount = backendSummary?.maintenance ?? assets.filter((a) => a.status === "MAINTENANCE" || a.status === "UNDER_MAINTENANCE").length;
  const damagedCount = backendSummary?.damaged ?? assets.filter((a) => a.status === "DAMAGED").length;
  const maintenanceDamagedCount = maintenanceCount + damagedCount;

  return (
    <AppShell activeKey="hrms-assets">
      <main className="page" style={{ paddingBottom: 60 }}>
        {/* Breadcrumb & Header */}
        <Breadcrumb trail={["HRMS", "Asset Management"]} />

        <div className="page-header" style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "var(--color-text, #0f172a)" }}>
                Asset Management
              </h1>
              <div className="page-subtitle" style={{ marginTop: 4, color: "var(--color-muted, #64748b)", fontSize: 13.5 }}>
                Track hardware, devices, IT equipment, and corporate workforce assignments.
              </div>
            </div>

            <div className="page-header-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setIsAddOpen(true)}
              >
                <IconPlus style={{ width: 15, height: 15 }} />
                <span>Add Asset</span>
              </button>
            </div>
          </div>
        </div>

        {/* 4 Focused Summary Cards */}
        <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 16 }}>
          <div className="stat-card">
            <div>
              <div className="stat-value">{totalCount}</div>
              <div className="stat-label">Total Assets</div>
            </div>
            <div className="stat-icon">
              <IconBox style={{ width: 20, height: 20 }} />
            </div>
          </div>

          <div className="stat-card tone-success">
            <div>
              <div className="stat-value" style={{ color: "#059669" }}>{availableCount}</div>
              <div className="stat-label">Available</div>
            </div>
            <div className="stat-icon">
              <IconBox style={{ width: 20, height: 20 }} />
            </div>
          </div>

          <div className="stat-card">
            <div>
              <div className="stat-value" style={{ color: "#0061f2" }}>{assignedCount}</div>
              <div className="stat-label">Assigned</div>
            </div>
            <div className="stat-icon">
              <IconBox style={{ width: 20, height: 20 }} />
            </div>
          </div>

          <div className="stat-card tone-warning">
            <div>
              <div className="stat-value" style={{ color: "#d97706" }}>{maintenanceDamagedCount}</div>
              <div className="stat-label">Maintenance / Damaged</div>
            </div>
            <div className="stat-icon">
              <IconWrench style={{ width: 20, height: 20 }} />
            </div>
          </div>
        </div>

        {/* Search + Filters Row */}
        <div className="card" style={{ padding: "14px 18px", marginBottom: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, flex: 1, minWidth: 260 }}>
              {/* Search */}
              <div style={{ position: "relative", minWidth: 240, flex: 1, maxWidth: 360 }}>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Search asset code, name or serial number"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ paddingLeft: 34, height: 38 }}
                />
                <span style={{ position: "absolute", left: 10, top: 11, color: "var(--color-muted, #94a3b8)", pointerEvents: "none", display: "flex", alignItems: "center" }}>
                  <IconSearch style={{ width: 15, height: 15 }} />
                </span>
              </div>

              {/* Category Filter */}
              <select
                className="form-control"
                style={{ width: "auto", minWidth: 140, height: 38 }}
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="ALL">All Categories</option>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              {/* Status Filter */}
              <select
                className="form-control"
                style={{ width: "auto", minWidth: 135, height: 38 }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                {STATUS_OPTIONS.map((st) => (
                  <option key={st.value} value={st.value}>
                    {st.label}
                  </option>
                ))}
              </select>

              {/* Branch Filter */}
              <select
                className="form-control"
                style={{ width: "auto", minWidth: 140, height: 38 }}
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
              >
                <option value="ALL">All Branches</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>

              {/* Assignment Filter */}
              <select
                className="form-control"
                style={{ width: "auto", minWidth: 140, height: 38 }}
                value={assignmentFilter}
                onChange={(e) => setAssignmentFilter(e.target.value)}
              >
                <option value="ALL">All Assignments</option>
                <option value="ASSIGNED">Assigned Only</option>
                <option value="UNASSIGNED">Unassigned Only</option>
              </select>
            </div>

            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-muted, #64748b)", whiteSpace: "nowrap" }}>
              {filteredAssets.length} {filteredAssets.length === 1 ? "Asset" : "Assets"}
            </div>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div style={{ padding: "12px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#991b1b", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13.5 }}>
            <span>{error}</span>
            <button type="button" onClick={fetchAssets} className="btn" style={{ padding: "4px 10px", fontSize: 12 }}>
              Try Again
            </button>
          </div>
        )}

        {/* Main Asset Table */}
        <div className="hrms-table-container">
          {loading ? (
            <div style={{ padding: "50px 24px", textAlign: "center", color: "var(--color-muted, #64748b)" }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>Loading assets from PostgreSQL database...</div>
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="hrms-placeholder-box" style={{ margin: 24 }}>
              <div className="hrms-placeholder-icon">
                <IconBox style={{ width: 26, height: 26 }} />
              </div>
              <div className="hrms-placeholder-title">No assets found</div>
              <div className="hrms-placeholder-text">
                {assets.length === 0
                  ? "Get started by registering a new company asset."
                  : "No assets match your search or filter criteria."}
              </div>
              {assets.length === 0 && (
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setIsAddOpen(true)}
                  >
                    <IconPlus style={{ width: 14, height: 14 }} />
                    <span>Add Asset</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <table className="hrms-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 100 }}>Asset Code</th>
                  <th style={{ minWidth: 160 }}>Asset Name</th>
                  <th style={{ minWidth: 120 }}>Category</th>
                  <th style={{ minWidth: 130 }}>Serial Number</th>
                  <th style={{ minWidth: 160 }}>Assigned To</th>
                  <th style={{ minWidth: 130 }}>Branch</th>
                  <th style={{ minWidth: 110 }}>Status</th>
                  <th style={{ minWidth: 100 }}>Condition</th>
                  <th style={{ minWidth: 180, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map((asset) => {
                  const isAssigned = !!asset.assigned_to_user_id;
                  const rawStatus = (asset.status || "").toUpperCase();
                  const canAssign =
                    !isAssigned &&
                    rawStatus !== "RETIRED" &&
                    rawStatus !== "LOST" &&
                    rawStatus !== "DAMAGED";

                  return (
                    <tr key={asset.id}>
                      <td style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--color-primary, #0061f2)", fontSize: 13 }}>
                        {asset.asset_code}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: "var(--color-text, #0f172a)" }}>{asset.asset_name}</div>
                        {asset.brand && (
                          <div style={{ fontSize: 12, color: "var(--color-muted, #64748b)", marginTop: 2 }}>
                            {asset.brand} {asset.model || ""}
                          </div>
                        )}
                      </td>
                      <td>{asset.asset_category}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 12.5, color: "var(--color-muted, #64748b)" }}>
                        {asset.serial_number || "—"}
                      </td>
                      <td>
                        {isAssigned ? (
                          <div>
                            <div style={{ fontWeight: 600, color: "var(--color-text, #0f172a)" }}>{asset.assigned_to_name}</div>
                            {asset.assigned_to_code && (
                              <div style={{ fontSize: 11.5, color: "var(--color-muted, #64748b)", fontFamily: "monospace" }}>
                                {asset.assigned_to_code}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: "var(--color-muted, #94a3b8)", fontStyle: "italic" }}>Unassigned</span>
                        )}
                      </td>
                      <td>{asset.location_name || asset.branch_name || asset.assigned_to_branch || "—"}</td>
                      <td>
                        <StatusBadge status={asset.status} />
                      </td>
                      <td>
                        <ConditionBadge condition={asset.condition} />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            onClick={() => openEditModal(asset)}
                            title="Edit Asset Details"
                            className="hrms-btn-action"
                          >
                            Edit
                          </button>

                          {isAssigned ? (
                            <button
                              type="button"
                              onClick={() => openReturnModal(asset)}
                              title="Return Asset"
                              className="hrms-btn-action"
                              style={{ color: "#d97706", borderColor: "#fde68a", background: "#fffbeb" }}
                            >
                              Return
                            </button>
                          ) : canAssign ? (
                            <button
                              type="button"
                              onClick={() => openAssignModal(asset)}
                              title="Assign to Employee"
                              className="hrms-btn-action"
                              style={{ color: "#0061f2", borderColor: "#bfdbfe", background: "#eff6ff" }}
                            >
                              Assign
                            </button>
                          ) : null}

                          <button
                            type="button"
                            onClick={() => openStatusModal(asset)}
                            title="Change Status"
                            className="hrms-btn-action"
                          >
                            Status
                          </button>

                          {rawStatus !== "RETIRED" && (
                            <button
                              type="button"
                              onClick={() => handleDeleteAsset(asset)}
                              title="Delete / Retire Asset"
                              className="hrms-btn-action btn-danger"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* =================================================================== */}
        {/* 1. ADD ASSET MODAL */}
        {/* =================================================================== */}
        {isAddOpen && (
          <div className="hrms-modal-overlay">
            <div className="hrms-action-modal-card" style={{ maxWidth: 620 }}>
              <div className="hrms-action-modal-header">
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--color-text, #0f172a)" }}>
                  Add New Company Asset
                </h3>
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-muted, #64748b)", display: "flex", alignItems: "center" }}
                >
                  <IconClose style={{ width: 18, height: 18 }} />
                </button>
              </div>

              <form onSubmit={handleAddSubmit}>
                <div className="hrms-action-modal-body" style={{ maxHeight: "calc(88vh - 120px)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Asset Name <span style={{ color: "#dc2626" }}>*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. ThinkPad X1 Carbon"
                        value={addForm.asset_name}
                        onChange={(e) => setAddForm({ ...addForm, asset_name: e.target.value })}
                        className="form-control"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Category <span style={{ color: "#dc2626" }}>*</span>
                      </label>
                      <select
                        value={addForm.asset_category}
                        onChange={(e) => setAddForm({ ...addForm, asset_category: e.target.value })}
                        className="form-control"
                      >
                        {CATEGORY_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Asset Code (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="Leave blank to auto-generate (AST-XXXX)"
                        value={addForm.asset_code}
                        onChange={(e) => setAddForm({ ...addForm, asset_code: e.target.value })}
                        className="form-control"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Serial Number
                      </label>
                      <input
                        type="text"
                        placeholder="Hardware SN / IMEI"
                        value={addForm.serial_number}
                        onChange={(e) => setAddForm({ ...addForm, serial_number: e.target.value })}
                        className="form-control"
                        style={{ fontFamily: "monospace" }}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Brand
                      </label>
                      <input
                        type="text"
                        placeholder="Apple, Dell, HP..."
                        value={addForm.brand}
                        onChange={(e) => setAddForm({ ...addForm, brand: e.target.value })}
                        className="form-control"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Model
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Latitude 5420"
                        value={addForm.model}
                        onChange={(e) => setAddForm({ ...addForm, model: e.target.value })}
                        className="form-control"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Vendor / Supplier
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. CloudTech Solutions Ltd"
                        value={addForm.vendor}
                        onChange={(e) => setAddForm({ ...addForm, vendor: e.target.value })}
                        className="form-control"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Warranty Expiry Date
                      </label>
                      <input
                        type="date"
                        value={addForm.warranty_expiry}
                        onChange={(e) => setAddForm({ ...addForm, warranty_expiry: e.target.value })}
                        className="form-control"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Purchase Date
                      </label>
                      <input
                        type="date"
                        value={addForm.purchase_date}
                        onChange={(e) => setAddForm({ ...addForm, purchase_date: e.target.value })}
                        className="form-control"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Purchase Cost (₹)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={addForm.purchase_cost}
                        onChange={(e) => setAddForm({ ...addForm, purchase_cost: e.target.value })}
                        className="form-control"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Branch / Location
                      </label>
                      <select
                        value={addForm.location_id}
                        onChange={(e) => setAddForm({ ...addForm, location_id: e.target.value })}
                        className="form-control"
                      >
                        <option value="">Select Office Branch...</option>
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Condition
                      </label>
                      <select
                        value={addForm.condition}
                        onChange={(e) => setAddForm({ ...addForm, condition: e.target.value })}
                        className="form-control"
                      >
                        {CONDITION_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-group" style={{ marginTop: 10 }}>
                    <label className="form-label" style={{ fontWeight: 600 }}>
                      Description
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Specifications, accessories included..."
                      value={addForm.description}
                      onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
                      className="form-control"
                    />
                  </div>
                </div>

                <div className="hrms-action-modal-footer">
                  <button
                    type="button"
                    onClick={() => setIsAddOpen(false)}
                    className="btn"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn btn-primary"
                  >
                    {submitting ? "Saving..." : "Save Asset"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* 2. EDIT ASSET MODAL (Asset Core Data + Assignment Section) */}
        {/* =================================================================== */}
        {isEditOpen && editingAsset && (
          <div className="hrms-modal-overlay">
            <div className="hrms-action-modal-card" style={{ maxWidth: 620 }}>
              <div className="hrms-action-modal-header">
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--color-text, #0f172a)" }}>
                    Edit Asset
                  </h3>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0061f2", marginTop: 2 }}>
                    {editingAsset.asset_code}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditOpen(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-muted, #64748b)", display: "flex", alignItems: "center" }}
                >
                  <IconClose style={{ width: 18, height: 18 }} />
                </button>
              </div>

              <form onSubmit={handleEditSubmit}>
                <div className="hrms-action-modal-body" style={{ maxHeight: "calc(88vh - 120px)" }}>
                  {/* EMPLOYEE ASSIGNMENT SECTION (Required) */}
                  <div
                    style={{
                      padding: "12px 14px",
                      background: editingAsset.assigned_to_user_id ? "#eff6ff" : "var(--color-bg, #f8fafc)",
                      border: "1px solid " + (editingAsset.assigned_to_user_id ? "#bfdbfe" : "var(--color-border, #e2e8f0)"),
                      borderRadius: 8,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--color-muted, #64748b)" }}>
                        Assignment Section:
                      </div>
                      <div style={{ fontWeight: 600, color: "var(--color-text, #0f172a)", marginTop: 2, fontSize: 13.5 }}>
                        {editingAsset.assigned_to_user_id ? (
                          <>
                            Assigned To: {editingAsset.assigned_to_name} ({editingAsset.assigned_to_code || "No Code"})
                            {currentAssignedUser?.email && (
                              <span style={{ fontWeight: 400, color: "var(--color-muted, #64748b)", marginLeft: 6, fontSize: 12.5 }}>
                                • {currentAssignedUser.email}
                              </span>
                            )}
                          </>
                        ) : (
                          <span style={{ color: "#059669" }}>Status: Currently Unassigned</span>
                        )}
                      </div>
                    </div>

                    <div>
                      {editingAsset.assigned_to_user_id ? (
                        <button
                          type="button"
                          className="btn"
                          style={{ fontSize: 12, padding: "5px 12px", borderColor: "#fde68a", color: "#d97706", background: "#fffbeb" }}
                          onClick={() => {
                            setIsEditOpen(false);
                            openReturnModal(editingAsset);
                          }}
                        >
                          Return Asset
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn"
                          style={{ fontSize: 12, padding: "5px 12px", borderColor: "#bfdbfe", color: "#0061f2", background: "#eff6ff" }}
                          onClick={() => {
                            setIsEditOpen(false);
                            openAssignModal(editingAsset);
                          }}
                        >
                          Assign Asset
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Asset Core Information Fields */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Asset Name <span style={{ color: "#dc2626" }}>*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={editForm.asset_name}
                        onChange={(e) => setEditForm({ ...editForm, asset_name: e.target.value })}
                        className="form-control"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Category <span style={{ color: "#dc2626" }}>*</span>
                      </label>
                      <select
                        value={editForm.asset_category}
                        onChange={(e) => setEditForm({ ...editForm, asset_category: e.target.value })}
                        className="form-control"
                      >
                        {CATEGORY_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Serial Number
                      </label>
                      <input
                        type="text"
                        value={editForm.serial_number}
                        onChange={(e) => setEditForm({ ...editForm, serial_number: e.target.value })}
                        className="form-control"
                        style={{ fontFamily: "monospace" }}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Brand
                      </label>
                      <input
                        type="text"
                        value={editForm.brand}
                        onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })}
                        className="form-control"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Model
                      </label>
                      <input
                        type="text"
                        value={editForm.model}
                        onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                        className="form-control"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Vendor / Supplier
                      </label>
                      <input
                        type="text"
                        value={editForm.vendor}
                        onChange={(e) => setEditForm({ ...editForm, vendor: e.target.value })}
                        className="form-control"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Warranty Expiry Date
                      </label>
                      <input
                        type="date"
                        value={editForm.warranty_expiry}
                        onChange={(e) => setEditForm({ ...editForm, warranty_expiry: e.target.value })}
                        className="form-control"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Purchase Date
                      </label>
                      <input
                        type="date"
                        value={editForm.purchase_date}
                        onChange={(e) => setEditForm({ ...editForm, purchase_date: e.target.value })}
                        className="form-control"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Purchase Cost (₹)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editForm.purchase_cost}
                        onChange={(e) => setEditForm({ ...editForm, purchase_cost: e.target.value })}
                        className="form-control"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Branch / Location
                      </label>
                      <select
                        value={editForm.location_id}
                        onChange={(e) => setEditForm({ ...editForm, location_id: e.target.value })}
                        className="form-control"
                      >
                        <option value="">Select Office Branch...</option>
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600 }}>
                        Condition
                      </label>
                      <select
                        value={editForm.condition}
                        onChange={(e) => setEditForm({ ...editForm, condition: e.target.value })}
                        className="form-control"
                      >
                        {CONDITION_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: 600 }}>
                      Description
                    </label>
                    <textarea
                      rows={2}
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      className="form-control"
                    />
                  </div>
                </div>

                <div className="hrms-action-modal-footer">
                  <button
                    type="button"
                    onClick={() => setIsEditOpen(false)}
                    className="btn"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn btn-primary"
                  >
                    {submitting ? "Updating..." : "Update Asset"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* 3. SIMPLE ASSIGN ASSET MODAL */}
        {/* =================================================================== */}
        {isAssignOpen && assigningAsset && (
          <div className="hrms-modal-overlay">
            <div className="hrms-action-modal-card" style={{ maxWidth: 480 }}>
              <div className="hrms-action-modal-header" style={{ background: "#eff6ff" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--color-text, #0f172a)" }}>
                    Assign Asset
                  </h3>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#1e40af", marginTop: 2 }}>
                    Asset: {assigningAsset.asset_name} ({assigningAsset.asset_code})
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAssignOpen(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-muted, #64748b)", display: "flex", alignItems: "center" }}
                >
                  <IconClose style={{ width: 18, height: 18 }} />
                </button>
              </div>

              <form onSubmit={handleAssignSubmit}>
                <div className="hrms-action-modal-body">
                  {/* Real Database Employee Search & Dropdown */}
                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: 600 }}>
                      Employee <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Search existing employees..."
                      value={employeeSearch}
                      onChange={(e) => setEmployeeSearch(e.target.value)}
                      className="form-control"
                      style={{ marginBottom: 6, fontSize: 12.5 }}
                    />
                    <select
                      required
                      value={assignForm.employee_id}
                      onChange={(e) => setAssignForm({ ...assignForm, employee_id: e.target.value })}
                      className="form-control"
                    >
                      <option value="">-- Choose employee from database --</option>
                      {filteredEmployees.map((emp) => {
                        const fullName = `${emp.first_name || ""} ${emp.last_name || ""}`.trim() || emp.username || "Employee";
                        const code = emp.employee_code || "No Code";
                        return (
                          <option key={emp.id} value={emp.id}>
                            {fullName} ({code})
                          </option>
                        );
                      })}
                    </select>

                    {selectedAssignEmployee && (
                      <div style={{ marginTop: 8, padding: "8px 12px", background: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12 }}>
                        <div><strong>Name:</strong> {selectedAssignEmployee.first_name} {selectedAssignEmployee.last_name}</div>
                        <div><strong>Code:</strong> {selectedAssignEmployee.employee_code || "—"}</div>
                        <div><strong>Email:</strong> {selectedAssignEmployee.email || "—"}</div>
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: 600 }}>
                      Assignment Date <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={assignForm.assigned_date}
                      onChange={(e) => setAssignForm({ ...assignForm, assigned_date: e.target.value })}
                      className="form-control"
                    />
                  </div>
                </div>

                <div className="hrms-action-modal-footer">
                  <button
                    type="button"
                    onClick={() => setIsAssignOpen(false)}
                    className="btn"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn btn-primary"
                  >
                    {submitting ? "Assigning..." : "Confirm Assignment"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* 4. SIMPLE RETURN ASSET MODAL */}
        {/* =================================================================== */}
        {isReturnOpen && returningAsset && (
          <div className="hrms-modal-overlay">
            <div className="hrms-action-modal-card" style={{ maxWidth: 480 }}>
              <div className="hrms-action-modal-header" style={{ background: "#fffbeb" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--color-text, #0f172a)" }}>
                    Return Asset
                  </h3>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#92400e", marginTop: 2 }}>
                    Asset: {returningAsset.asset_name} ({returningAsset.asset_code})
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsReturnOpen(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-muted, #64748b)", display: "flex", alignItems: "center" }}
                >
                  <IconClose style={{ width: 18, height: 18 }} />
                </button>
              </div>

              <form onSubmit={handleReturnSubmit}>
                <div className="hrms-action-modal-body">
                  <div style={{ padding: "12px 14px", background: "var(--color-bg, #f8fafc)", border: "1px solid var(--color-border, #e2e8f0)", borderRadius: 8, fontSize: 13 }}>
                    <div style={{ fontSize: 11.5, textTransform: "uppercase", fontWeight: 700, color: "var(--color-muted, #64748b)" }}>
                      Currently Assigned To:
                    </div>
                    <div style={{ fontWeight: 600, color: "var(--color-text, #0f172a)", marginTop: 4 }}>
                      {returningAsset.assigned_to_name}
                      {returningAsset.assigned_to_code && (
                        <span style={{ fontFamily: "monospace", color: "var(--color-muted, #64748b)", marginLeft: 6, fontWeight: 400 }}>
                          ({returningAsset.assigned_to_code})
                        </span>
                      )}
                    </div>
                    {returningAsset.assigned_date && (
                      <div style={{ fontSize: 12, color: "var(--color-muted, #64748b)", marginTop: 4 }}>
                        Assignment Date: {returningAsset.assigned_date}
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: 600 }}>
                      Return Date <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={returnForm.return_date}
                      onChange={(e) => setReturnForm({ ...returnForm, return_date: e.target.value })}
                      className="form-control"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: 600 }}>
                      Condition At Return
                    </label>
                    <select
                      value={returnForm.condition_after_return}
                      onChange={(e) => setReturnForm({ ...returnForm, condition_after_return: e.target.value })}
                      className="form-control"
                    >
                      <option value="GOOD">GOOD (Returns to Available)</option>
                      <option value="FAIR">FAIR (Returns to Available)</option>
                      <option value="DAMAGED">DAMAGED (Marks as Damaged)</option>
                      <option value="LOST">LOST (Marks as Lost)</option>
                    </select>
                  </div>
                </div>

                <div className="hrms-action-modal-footer">
                  <button
                    type="button"
                    onClick={() => setIsReturnOpen(false)}
                    className="btn"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn"
                    style={{ background: "#d97706", borderColor: "#d97706", color: "#ffffff", fontWeight: 700 }}
                  >
                    {submitting ? "Returning..." : "Confirm Return"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* 5. DIRECT STATUS CHANGE MODAL */}
        {/* =================================================================== */}
        {isStatusOpen && statusAsset && (
          <div className="hrms-modal-overlay">
            <div className="hrms-action-modal-card" style={{ maxWidth: 460 }}>
              <div className="hrms-action-modal-header" style={{ background: "#f5f3ff" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--color-text, #0f172a)" }}>
                    Change Status
                  </h3>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#6d28d9", marginTop: 2 }}>
                    {statusAsset.asset_name} ({statusAsset.asset_code})
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsStatusOpen(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-muted, #64748b)", display: "flex", alignItems: "center" }}
                >
                  <IconClose style={{ width: 18, height: 18 }} />
                </button>
              </div>

              <form onSubmit={handleStatusSubmit}>
                <div className="hrms-action-modal-body">
                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: 600 }}>
                      Target Status <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <select
                      value={statusForm.status}
                      onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value })}
                      className="form-control"
                    >
                      <option value="AVAILABLE">Available</option>
                      <option value="UNDER_MAINTENANCE">Under Maintenance</option>
                      <option value="DAMAGED">Damaged</option>
                      <option value="LOST">Lost</option>
                      <option value="RETIRED">Retired</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: 600 }}>
                      Reason / Notes
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Explain reason for status change..."
                      value={statusForm.notes}
                      onChange={(e) => setStatusForm({ ...statusForm, notes: e.target.value })}
                      className="form-control"
                    />
                  </div>
                </div>

                <div className="hrms-action-modal-footer">
                  <button
                    type="button"
                    onClick={() => setIsStatusOpen(false)}
                    className="btn"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn btn-primary"
                  >
                    {submitting ? "Updating..." : "Update Status"}
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

// ---------------------------------------------------------------------------
// Sub-components: Badges
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const s = (status || "").toUpperCase();
  switch (s) {
    case "AVAILABLE":
      return <span className="hrms-badge hrms-badge-success">Available</span>;
    case "ASSIGNED":
    case "IN_USE":
      return <span className="hrms-badge hrms-badge-info">Assigned</span>;
    case "MAINTENANCE":
    case "UNDER_MAINTENANCE":
      return (
        <span
          className="hrms-badge"
          style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}
        >
          Maintenance
        </span>
      );
    case "DAMAGED":
      return <span className="hrms-badge hrms-badge-danger">Damaged</span>;
    case "LOST":
      return (
        <span
          className="hrms-badge"
          style={{ background: "#fee2e2", color: "#7f1d1d", border: "1px solid #fca5a5" }}
        >
          Lost
        </span>
      );
    case "RETIRED":
      return <span className="hrms-badge hrms-badge-neutral">Retired</span>;
    default:
      return <span className="hrms-badge hrms-badge-neutral">{status}</span>;
  }
}

function ConditionBadge({ condition }: { condition: string }) {
  const c = (condition || "").toUpperCase();
  switch (c) {
    case "NEW":
    case "EXCELLENT":
      return (
        <span
          className="hrms-badge"
          style={{ background: "#ecfdf5", color: "#065f46", border: "1px solid #a7f3d0" }}
        >
          {condition}
        </span>
      );
    case "GOOD":
      return (
        <span
          className="hrms-badge"
          style={{ background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe" }}
        >
          {condition}
        </span>
      );
    case "FAIR":
      return (
        <span
          className="hrms-badge"
          style={{ background: "#fef9c3", color: "#854d0e", border: "1px solid #fef08a" }}
        >
          {condition}
        </span>
      );
    case "POOR":
    case "DAMAGED":
      return (
        <span
          className="hrms-badge"
          style={{ background: "#fff1f2", color: "#be123c", border: "1px solid #fecdd3" }}
        >
          {condition}
        </span>
      );
    default:
      return (
        <span className="hrms-badge hrms-badge-neutral">
          {condition}
        </span>
      );
  }
}
