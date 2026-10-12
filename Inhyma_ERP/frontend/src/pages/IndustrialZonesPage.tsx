/**
 * IndustrialZonesPage — Industrial Zones Directory & Territory Management.
 *
 * Implements the exact UI design and workflow shown in reference screenshots:
 * - AppShell with activeKey="industrial-zones"
 * - Breadcrumb: Home / Contact / Industrial Zones
 * - Header Action Bar: Filter Toggle button, "+ ADD NEW", "DELETE" (bulk delete)
 * - 4-Control Filter Card:
 *     Grade (Select/All/A/B), State, City, District
 *     [Reset] (gray) & [Search] (amber/gold) action buttons
 * - Main Table Card:
 *     50 Items/Page selector, Search input
 *     Columns: Checkbox, Sr. No., Zone Name, Nearby City, Dist. / State, No. Of Ind., Grade, Pote. Cate. Of Machi., Action
 * - Add / Edit Drawer:
 *     Industrial Zone Name * (with live duplication detection),
 *     State *, District *, Nearby Major City, Distance From Major City (KM),
 *     Number Of Industries, Zone Grade (Radio: A / B),
 *     Type Of Industries, Potential Category Of Machines To Target, Remarks,
 *     [Submit] blue full-width action button.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { IconFilter, IconTrash, IconPlus } from "@/components/icons";

export interface IndustrialZoneItem {
  id: string;
  zone_name: string;
  state: string;
  district: string;
  nearby_city?: string | null;
  distance_km?: number | null;
  num_industries?: number | null;
  zone_grade?: string | null; // "A" or "B"
  industry_types?: string | null;
  potential_machine_categories?: string | null;
  remarks?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface FilterState {
  grade: string;
  state: string;
  city: string;
  district: string;
}

const INITIAL_FILTERS: FilterState = {
  grade: "",
  state: "",
  city: "",
  district: "",
};

interface FormState {
  zone_name: string;
  state: string;
  district: string;
  nearby_city: string;
  distance_km: string;
  num_industries: string;
  zone_grade: string; // "A" or "B"
  industry_types: string;
  potential_machine_categories: string;
  remarks: string;
}

const EMPTY_FORM: FormState = {
  zone_name: "",
  state: "",
  district: "",
  nearby_city: "",
  distance_km: "",
  num_industries: "",
  zone_grade: "A",
  industry_types: "",
  potential_machine_categories: "",
  remarks: "",
};

export function IndustrialZonesPage() {
  const showToast = useToast();

  // Data states
  const [zones, setZones] = useState<IndustrialZoneItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filter & Search states
  const [showFilters, setShowFilters] = useState<boolean>(true);
  const [filterDraft, setFilterDraft] = useState<FilterState>(INITIAL_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [sortField, setSortField] = useState<keyof IndustrialZoneItem>("zone_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Drawer states
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [editingZone, setEditingZone] = useState<IndustrialZoneItem | null>(null);
  const [formData, setFormData] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState<boolean>(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Cascading Location Masters
  const [masterStates, setMasterStates] = useState<string[]>([]);
  const [masterDistricts, setMasterDistricts] = useState<string[]>([]);
  const [masterCities, setMasterCities] = useState<string[]>([]);

  // Load zones from API
  const fetchZones = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (appliedFilters.grade) params.append("grade", appliedFilters.grade);
      if (appliedFilters.state) params.append("state", appliedFilters.state);
      if (appliedFilters.district) params.append("district", appliedFilters.district);
      if (appliedFilters.city) params.append("city", appliedFilters.city);
      if (searchTerm) params.append("search", searchTerm);
      params.append("limit", "500");

      const res = await apiGet<IndustrialZoneItem[]>(
        `/api/v1/industrial-zones?${params.toString()}`
      );
      if (res && Array.isArray(res.data)) {
        setZones(res.data);
      }
    } catch (err: any) {
      console.warn("Could not load industrial zones from API:", err);
      // Fallback sample data if offline
      if (zones.length === 0) {
        setZones([
          {
            id: "iz-01",
            zone_name: "Narol Vatwa Industrial Estate",
            state: "Gujarat",
            district: "Ahmedabad",
            nearby_city: "Ahmedabad",
            distance_km: 12.5,
            num_industries: 850,
            zone_grade: "A",
            industry_types: "Textiles, Chemicals, Heavy Machinery",
            potential_machine_categories: "Flow Wrap, Pouch Packing, Conveyors",
            remarks: "Major industrial hub on Narol-Vatwa road.",
          },
          {
            id: "iz-02",
            zone_name: "GIDC Sanand Industrial Area",
            state: "Gujarat",
            district: "Ahmedabad",
            nearby_city: "Ahmedabad",
            distance_km: 25.0,
            num_industries: 420,
            zone_grade: "A",
            industry_types: "Automobile, FMCG, Engineering",
            potential_machine_categories: "Shrink Wrap, Web Sealer, Vacuum Packaging",
            remarks: "High growth potential with multi-national factories.",
          },
          {
            id: "iz-03",
            zone_name: "Wagle Industrial Estate",
            state: "Maharashtra",
            district: "Thane",
            nearby_city: "Thane",
            distance_km: 5.0,
            num_industries: 600,
            zone_grade: "A",
            industry_types: "Pharma, Food Processing, Precision Tools",
            potential_machine_categories: "Liquid Fillers, Capping Machines, Labeling",
            remarks: "Prime location in Thane city limits.",
          },
          {
            id: "iz-04",
            zone_name: "Pithampur Industrial Area Sector 3",
            state: "Madhya Pradesh",
            district: "Dhar",
            nearby_city: "Indore",
            distance_km: 35.0,
            num_industries: 350,
            zone_grade: "B",
            industry_types: "Automotive, Fabrication, Packaging",
            potential_machine_categories: "Carton Sealers, Strapping Machines",
            remarks: "Key auto corridor of Central India.",
          },
        ]);
      }
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, searchTerm]);

  useEffect(() => {
    fetchZones();
  }, [fetchZones]);

  // Load location masters for dropdowns
  useEffect(() => {
    async function loadMasters() {
      try {
        const [statesRes, districtsRes, citiesRes] = await Promise.all([
          apiGet<Array<{ name: string }>>("/api/v1/masters/states?limit=500").catch(() => null),
          apiGet<Array<{ name: string }>>("/api/v1/masters/districts?limit=500").catch(() => null),
          apiGet<Array<{ name: string }>>("/api/v1/masters/cities?limit=500").catch(() => null),
        ]);

        if (statesRes?.data && Array.isArray(statesRes.data)) {
          setMasterStates(statesRes.data.map((s: { name: string }) => s.name).sort());
        } else {
          setMasterStates(["Gujarat", "Maharashtra", "Madhya Pradesh", "Rajasthan", "Karnataka", "Tamil Nadu", "Delhi", "Uttar Pradesh", "Haryana", "Punjab"]);
        }

        if (districtsRes?.data && Array.isArray(districtsRes.data)) {
          setMasterDistricts(districtsRes.data.map((d: { name: string }) => d.name).sort());
        } else {
          setMasterDistricts(["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Thane", "Mumbai", "Pune", "Indore", "Dhar", "Bhopal"]);
        }

        if (citiesRes?.data && Array.isArray(citiesRes.data)) {
          setMasterCities(citiesRes.data.map((c: { name: string }) => c.name).sort());
        } else {
          setMasterCities(["Ahmedabad", "Surat", "Vadodara", "Thane", "Mumbai", "Pune", "Indore", "Bhopal", "Nagpur", "Nashik"]);
        }
      } catch (err) {
        // fallback defaults
      }
    }
    loadMasters();
  }, []);

  // Filter & Search handling
  const handleSearchClick = () => {
    setAppliedFilters({ ...filterDraft });
    setCurrentPage(1);
  };

  const handleResetFilters = () => {
    setFilterDraft(INITIAL_FILTERS);
    setAppliedFilters(INITIAL_FILTERS);
    setSearchTerm("");
    setCurrentPage(1);
  };

  // Sort and filter in-memory for smooth rendering
  const filteredZones = useMemo(() => {
    let result = [...zones];

    if (appliedFilters.grade && appliedFilters.grade !== "Select" && appliedFilters.grade !== "All") {
      result = result.filter(
        (z) => z.zone_grade?.toLowerCase() === appliedFilters.grade.toLowerCase()
      );
    }
    if (appliedFilters.state && appliedFilters.state !== "All") {
      result = result.filter(
        (z) => z.state?.toLowerCase() === appliedFilters.state.toLowerCase()
      );
    }
    if (appliedFilters.district && appliedFilters.district !== "All") {
      result = result.filter(
        (z) => z.district?.toLowerCase() === appliedFilters.district.toLowerCase()
      );
    }
    if (appliedFilters.city && appliedFilters.city !== "All") {
      result = result.filter(
        (z) => z.nearby_city?.toLowerCase() === appliedFilters.city.toLowerCase()
      );
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(
        (z) =>
          z.zone_name.toLowerCase().includes(q) ||
          z.nearby_city?.toLowerCase().includes(q) ||
          z.district?.toLowerCase().includes(q) ||
          z.state?.toLowerCase().includes(q) ||
          z.potential_machine_categories?.toLowerCase().includes(q) ||
          z.industry_types?.toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      const valA = (a[sortField] ?? "").toString().toLowerCase();
      const valB = (b[sortField] ?? "").toString().toLowerCase();
      if (valA < valB) return sortDir === "asc" ? -1 : 1;
      if (valA > valB) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [zones, appliedFilters, searchTerm, sortField, sortDir]);

  // Pagination
  const totalRecords = filteredZones.length;
  const totalPages = Math.ceil(totalRecords / pageSize) || 1;
  const paginatedZones = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredZones.slice(start, start + pageSize);
  }, [filteredZones, currentPage, pageSize]);

  // Checkbox selection
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(new Set(paginatedZones.map((z) => z.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectRow = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  // Open Drawer for Add
  const handleOpenAdd = () => {
    setEditingZone(null);
    setFormData(EMPTY_FORM);
    setNameError(null);
    setDrawerOpen(true);
  };

  // Open Drawer for Edit
  const handleOpenEdit = (zone: IndustrialZoneItem) => {
    setEditingZone(zone);
    setFormData({
      zone_name: zone.zone_name,
      state: zone.state,
      district: zone.district,
      nearby_city: zone.nearby_city || "",
      distance_km: zone.distance_km != null ? String(zone.distance_km) : "",
      num_industries: zone.num_industries != null ? String(zone.num_industries) : "",
      zone_grade: zone.zone_grade || "A",
      industry_types: zone.industry_types || "",
      potential_machine_categories: zone.potential_machine_categories || "",
      remarks: zone.remarks || "",
    });
    setNameError(null);
    setDrawerOpen(true);
  };

  // Duplicate name live check
  const handleZoneNameChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setFormData((prev) => ({ ...prev, zone_name: val }));
    setNameError(null);

    if (val.trim().length > 2) {
      try {
        const excludeParam = editingZone?.id ? `&exclude_id=${editingZone.id}` : "";
        const res = await apiGet<{ exists: boolean }>(
          `/api/v1/industrial-zones/check-name?name=${encodeURIComponent(val.trim())}${excludeParam}`
        );
        if (res?.data?.exists) {
          setNameError("This Industrial Zone name already exists");
        }
      } catch (err) {
        // quiet fallback
      }
    }
  };

  // Save (Create or Update)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.zone_name.trim()) {
      setNameError("Industrial Zone Name is required");
      return;
    }
    if (!formData.state.trim()) {
      showToast("State is required", "error");
      return;
    }
    if (!formData.district.trim()) {
      showToast("District is required", "error");
      return;
    }
    if (nameError) {
      showToast(nameError, "error");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        zone_name: formData.zone_name.trim(),
        state: formData.state.trim(),
        district: formData.district.trim(),
        nearby_city: formData.nearby_city.trim() || null,
        distance_km: formData.distance_km ? parseFloat(formData.distance_km) : null,
        num_industries: formData.num_industries ? parseInt(formData.num_industries, 10) : null,
        zone_grade: formData.zone_grade || "A",
        industry_types: formData.industry_types.trim() || null,
        potential_machine_categories: formData.potential_machine_categories.trim() || null,
        remarks: formData.remarks.trim() || null,
      };

      if (editingZone) {
        await apiPut(`/api/v1/industrial-zones/${editingZone.id}`, payload);
        showToast("Industrial zone updated successfully.", "success");
      } else {
        await apiPost(`/api/v1/industrial-zones`, payload);
        showToast("Industrial zone created successfully.", "success");
      }

      setDrawerOpen(false);
      fetchZones();
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || "Failed to save industrial zone";
      showToast(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  // Single Delete
  const handleDelete = async (zone: IndustrialZoneItem) => {
    if (!window.confirm(`Are you sure you want to delete '${zone.zone_name}'?`)) return;
    try {
      await apiDelete(`/api/v1/industrial-zones/${zone.id}`);
      showToast("Industrial zone removed successfully.", "success");
      fetchZones();
    } catch (err: any) {
      showToast("Failed to delete industrial zone.", "error");
    }
  };

  // Bulk Delete
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) {
      showToast("Please select records to delete.", "warning");
      return;
    }
    if (!window.confirm(`Are you sure you want to delete ${selectedIds.size} selected zone(s)?`)) return;

    try {
      await apiPost(`/api/v1/industrial-zones/bulk-delete`, { ids: Array.from(selectedIds) });
      showToast(`${selectedIds.size} zone(s) deleted.`, "success");
      setSelectedIds(new Set());
      fetchZones();
    } catch (err: any) {
      showToast("Failed to perform bulk delete.", "error");
    }
  };

  return (
    <AppShell activeKey="industrial-zones">
      <main
        className="page"
        style={{
          background: "#f4f6f9",
          minHeight: "calc(100vh - 60px)",
          padding: "20px 28px",
          color: "#1e293b",
        }}
      >
        {/* Top Header & Breadcrumb */}
        <div style={{ marginBottom: "16px" }}>
          <Breadcrumb trail={["Contact", "Industrial Zones"]} />
        </div>

        {/* Page Title & Action Controls */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0, color: "#1e293b" }}>
            Industrial Zones
          </h1>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* Filter Toggle Button (matches screenshot 3) */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              style={{
                background: showFilters ? "#475569" : "#64748b",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                padding: "8px 12px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              }}
              title="Toggle Filters"
            >
              <IconFilter style={{ width: "16px", height: "16px" }} />
            </button>

            {/* + ADD NEW Button (matches screenshot 3) */}
            <button
              onClick={handleOpenAdd}
              style={{
                background: "#0061f2",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: 600,
                letterSpacing: "0.4px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 2px 4px rgba(0,97,242,0.25)",
              }}
            >
              <IconPlus style={{ width: "14px", height: "14px" }} />
              + ADD NEW
            </button>

            {/* DELETE Button (matches screenshot 3 green button) */}
            <button
              onClick={handleBulkDelete}
              style={{
                background: "#10b981",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: 600,
                letterSpacing: "0.4px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 2px 4px rgba(16,185,129,0.25)",
              }}
            >
              <IconTrash style={{ width: "14px", height: "14px" }} />
              DELETE
            </button>
          </div>
        </div>

        {/* Filter Card (matches Screenshot 3: Grade, State, City, District + Reset/Search) */}
        {showFilters && (
          <div
            style={{
              background: "#fff",
              borderRadius: "6px",
              padding: "20px 24px",
              marginBottom: "16px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              border: "1px solid #e2e8f0",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "18px 24px",
                marginBottom: "16px",
              }}
            >
              {/* Grade */}
              <div>
                <label style={{ display: "block", fontSize: "13px", color: "#475569", marginBottom: "6px" }}>
                  Grade
                </label>
                <select
                  value={filterDraft.grade}
                  onChange={(e) => setFilterDraft({ ...filterDraft, grade: e.target.value })}
                  style={{
                    width: "100%",
                    height: "38px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    padding: "0 10px",
                    fontSize: "13px",
                    background: "#fff",
                    color: "#334155",
                  }}
                >
                  <option value="">Select</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>
              </div>

              {/* State */}
              <div>
                <label style={{ display: "block", fontSize: "13px", color: "#475569", marginBottom: "6px" }}>
                  State
                </label>
                <select
                  value={filterDraft.state}
                  onChange={(e) => setFilterDraft({ ...filterDraft, state: e.target.value })}
                  style={{
                    width: "100%",
                    height: "38px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    padding: "0 10px",
                    fontSize: "13px",
                    background: "#fff",
                    color: "#334155",
                  }}
                >
                  <option value="">All</option>
                  {masterStates.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              {/* City */}
              <div>
                <label style={{ display: "block", fontSize: "13px", color: "#475569", marginBottom: "6px" }}>
                  City
                </label>
                <select
                  value={filterDraft.city}
                  onChange={(e) => setFilterDraft({ ...filterDraft, city: e.target.value })}
                  style={{
                    width: "100%",
                    height: "38px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    padding: "0 10px",
                    fontSize: "13px",
                    background: "#fff",
                    color: "#334155",
                  }}
                >
                  <option value="">All</option>
                  {masterCities.map((ct) => (
                    <option key={ct} value={ct}>
                      {ct}
                    </option>
                  ))}
                </select>
              </div>

              {/* District */}
              <div>
                <label style={{ display: "block", fontSize: "13px", color: "#475569", marginBottom: "6px" }}>
                  District
                </label>
                <select
                  value={filterDraft.district}
                  onChange={(e) => setFilterDraft({ ...filterDraft, district: e.target.value })}
                  style={{
                    width: "100%",
                    height: "38px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    padding: "0 10px",
                    fontSize: "13px",
                    background: "#fff",
                    color: "#334155",
                  }}
                >
                  <option value="">All</option>
                  {masterDistricts.map((dst) => (
                    <option key={dst} value={dst}>
                      {dst}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Action buttons: Reset (gray) and Search (amber/yellow) matching screenshot 3 */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                onClick={handleResetFilters}
                style={{
                  background: "#64748b",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  padding: "7px 20px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Reset
              </button>
              <button
                onClick={handleSearchClick}
                style={{
                  background: "#eab308",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  padding: "7px 24px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "0 1px 3px rgba(234,179,8,0.3)",
                }}
              >
                Search
              </button>
            </div>
          </div>
        )}

        {/* Main Data Table Card */}
        <div
          style={{
            background: "#fff",
            borderRadius: "6px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            border: "1px solid #e2e8f0",
            overflow: "hidden",
          }}
        >
          {/* Table Toolbar */}
          <div
            style={{
              padding: "16px 20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid #f1f5f9",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                style={{
                  height: "34px",
                  borderRadius: "4px",
                  border: "1px solid #cbd5e1",
                  padding: "0 8px",
                  fontSize: "13px",
                  background: "#fff",
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span style={{ fontSize: "13px", color: "#64748b" }}>Items/Page</span>
            </div>

            <div>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search..."
                style={{
                  height: "34px",
                  width: "220px",
                  borderRadius: "4px",
                  border: "1px solid #cbd5e1",
                  padding: "0 12px",
                  fontSize: "13px",
                }}
              />
            </div>
          </div>

          {/* Table (matching screenshot 3 columns) */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr
                  style={{
                    background: "#f8fafc",
                    borderBottom: "1px solid #e2e8f0",
                    color: "#475569",
                    textAlign: "left",
                    fontWeight: 600,
                  }}
                >
                  <th style={{ padding: "12px 14px", width: "40px", textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={paginatedZones.length > 0 && paginatedZones.every((z) => selectedIds.has(z.id))}
                      onChange={handleSelectAll}
                    />
                  </th>
                  <th
                    onClick={() => {
                      setSortField("zone_name");
                      setSortDir(sortDir === "asc" ? "desc" : "asc");
                    }}
                    style={{ padding: "12px 14px", width: "70px", cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    Sr. No. ▾
                  </th>
                  <th
                    onClick={() => {
                      setSortField("zone_name");
                      setSortDir(sortDir === "asc" ? "desc" : "asc");
                    }}
                    style={{ padding: "12px 14px", cursor: "pointer" }}
                  >
                    Zone Name +
                  </th>
                  <th
                    onClick={() => {
                      setSortField("nearby_city");
                      setSortDir(sortDir === "asc" ? "desc" : "asc");
                    }}
                    style={{ padding: "12px 14px", cursor: "pointer" }}
                  >
                    Nearby City +
                  </th>
                  <th
                    onClick={() => {
                      setSortField("district");
                      setSortDir(sortDir === "asc" ? "desc" : "asc");
                    }}
                    style={{ padding: "12px 14px", cursor: "pointer" }}
                  >
                    Dist. / State +
                  </th>
                  <th
                    onClick={() => {
                      setSortField("num_industries");
                      setSortDir(sortDir === "asc" ? "desc" : "asc");
                    }}
                    style={{ padding: "12px 14px", cursor: "pointer" }}
                  >
                    No. Of Ind. +
                  </th>
                  <th
                    onClick={() => {
                      setSortField("zone_grade");
                      setSortDir(sortDir === "asc" ? "desc" : "asc");
                    }}
                    style={{ padding: "12px 14px", width: "80px", cursor: "pointer" }}
                  >
                    Grade +
                  </th>
                  <th style={{ padding: "12px 14px" }}>Pote. Cate. Of Machi.</th>
                  <th style={{ padding: "12px 14px", width: "100px", textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} style={{ padding: "32px", textAlign: "center", color: "#64748b" }}>
                      Loading Industrial Zones...
                    </td>
                  </tr>
                ) : paginatedZones.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: "32px", textAlign: "center", color: "#94a3b8" }}>
                      No Data Available In Table
                    </td>
                  </tr>
                ) : (
                  paginatedZones.map((zone, idx) => {
                    const isSelected = selectedIds.has(zone.id);
                    return (
                      <tr
                        key={zone.id}
                        style={{
                          borderBottom: "1px solid #f1f5f9",
                          background: isSelected ? "#eff6ff" : "transparent",
                          transition: "background 0.15s ease",
                        }}
                      >
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleSelectRow(zone.id)}
                          />
                        </td>
                        <td style={{ padding: "12px 14px", color: "#64748b" }}>
                          {(currentPage - 1) * pageSize + idx + 1}
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <button
                            onClick={() => handleOpenEdit(zone)}
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              color: "#0061f2",
                              fontWeight: 600,
                              cursor: "pointer",
                              textAlign: "left",
                              textDecoration: "underline",
                            }}
                          >
                            {zone.zone_name}
                          </button>
                        </td>
                        <td style={{ padding: "12px 14px", color: "#334155" }}>
                          {zone.nearby_city || "—"}
                        </td>
                        <td style={{ padding: "12px 14px", color: "#334155" }}>
                          {zone.district} / {zone.state}
                        </td>
                        <td style={{ padding: "12px 14px", color: "#334155" }}>
                          {zone.num_industries != null ? zone.num_industries : "—"}
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: "4px",
                              fontSize: "12px",
                              fontWeight: 700,
                              background: zone.zone_grade === "A" ? "#dcfce7" : "#fef3c7",
                              color: zone.zone_grade === "A" ? "#15803d" : "#b45309",
                            }}
                          >
                            {zone.zone_grade || "—"}
                          </span>
                        </td>
                        <td style={{ padding: "12px 14px", color: "#475569", maxWidth: "240px" }}>
                          {zone.potential_machine_categories || "—"}
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>
                          <div style={{ display: "inline-flex", gap: "8px" }}>
                            <button
                              onClick={() => handleOpenEdit(zone)}
                              title="Edit"
                              style={{
                                background: "#f1f5f9",
                                border: "1px solid #cbd5e1",
                                borderRadius: "4px",
                                padding: "4px 8px",
                                fontSize: "12px",
                                color: "#0061f2",
                                cursor: "pointer",
                              }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(zone)}
                              title="Delete"
                              style={{
                                background: "#fef2f2",
                                border: "1px solid #fecaca",
                                borderRadius: "4px",
                                padding: "4px 8px",
                                fontSize: "12px",
                                color: "#ef4444",
                                cursor: "pointer",
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div
            style={{
              padding: "14px 20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderTop: "1px solid #f1f5f9",
              fontSize: "13px",
              color: "#64748b",
            }}
          >
            <div>
              Showing {totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1} To{" "}
              {Math.min(currentPage * pageSize, totalRecords)} Of {totalRecords} Entries
            </div>

            <div style={{ display: "flex", gap: "6px" }}>
              <button
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => p - 1)}
                style={{
                  padding: "6px 14px",
                  borderRadius: "4px",
                  border: "1px solid #cbd5e1",
                  background: currentPage <= 1 ? "#f8fafc" : "#fff",
                  color: currentPage <= 1 ? "#94a3b8" : "#334155",
                  cursor: currentPage <= 1 ? "not-allowed" : "pointer",
                }}
              >
                Previous
              </button>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => p + 1)}
                style={{
                  padding: "6px 14px",
                  borderRadius: "4px",
                  border: "1px solid #cbd5e1",
                  background: currentPage >= totalPages ? "#f8fafc" : "#fff",
                  color: currentPage >= totalPages ? "#94a3b8" : "#334155",
                  cursor: currentPage >= totalPages ? "not-allowed" : "pointer",
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        {/* Add / Edit Industrial Zone Drawer (matches Screenshot 4) */}
        {drawerOpen && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 1000,
              display: "flex",
              justifyContent: "flex-end",
              background: "rgba(15, 23, 42, 0.45)",
            }}
          >
            <div
              style={{
                width: "480px",
                maxWidth: "100%",
                background: "#fff",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                boxShadow: "-4px 0 20px rgba(0,0,0,0.15)",
                overflowY: "auto",
              }}
            >
              {/* Drawer Header */}
              <div
                style={{
                  padding: "18px 24px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "#1e293b" }}>
                  {editingZone ? "Edit Industrial Zone" : "Add Industrial Zone"}
                </h2>
                <button
                  onClick={() => setDrawerOpen(false)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "20px",
                    color: "#94a3b8",
                    cursor: "pointer",
                    padding: "4px",
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Form Body (exact layout from screenshot 4) */}
              <form onSubmit={handleSubmit} style={{ padding: "20px 24px", flex: 1 }}>
                {/* Industrial Zone Name * */}
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px" }}>
                    Industrial Zone Name <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.zone_name}
                    onChange={handleZoneNameChange}
                    placeholder="Enter zone name"
                    style={{
                      width: "100%",
                      height: "38px",
                      borderRadius: "4px",
                      border: `1px solid ${nameError ? "#ef4444" : "#cbd5e1"}`,
                      padding: "0 12px",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                  {nameError && (
                    <div style={{ color: "#ef4444", fontSize: "12px", marginTop: "4px" }}>
                      {nameError}
                    </div>
                  )}
                </div>

                {/* State * & District * */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "16px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px" }}>
                      State <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    <select
                      required
                      value={formData.state}
                      onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                      style={{
                        width: "100%",
                        height: "38px",
                        borderRadius: "4px",
                        border: "1px solid #cbd5e1",
                        padding: "0 10px",
                        fontSize: "13px",
                        background: "#fff",
                        boxSizing: "border-box",
                      }}
                    >
                      <option value="">Select</option>
                      {masterStates.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px" }}>
                      District <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    <select
                      required
                      value={formData.district}
                      onChange={(e) => setFormData({ ...formData, district: e.target.value })}
                      style={{
                        width: "100%",
                        height: "38px",
                        borderRadius: "4px",
                        border: "1px solid #cbd5e1",
                        padding: "0 10px",
                        fontSize: "13px",
                        background: "#fff",
                        boxSizing: "border-box",
                      }}
                    >
                      <option value="">Select</option>
                      {masterDistricts.map((dst) => (
                        <option key={dst} value={dst}>
                          {dst}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Nearby Major City & Distance */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "16px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px" }}>
                      Nearby Major City
                    </label>
                    <select
                      value={formData.nearby_city}
                      onChange={(e) => setFormData({ ...formData, nearby_city: e.target.value })}
                      style={{
                        width: "100%",
                        height: "38px",
                        borderRadius: "4px",
                        border: "1px solid #cbd5e1",
                        padding: "0 10px",
                        fontSize: "13px",
                        background: "#fff",
                        boxSizing: "border-box",
                      }}
                    >
                      <option value="">Select City</option>
                      {masterCities.map((ct) => (
                        <option key={ct} value={ct}>
                          {ct}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px" }}>
                      Distance From Major City (KM)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.distance_km}
                      onChange={(e) => setFormData({ ...formData, distance_km: e.target.value })}
                      placeholder="e.g. 15"
                      style={{
                        width: "100%",
                        height: "38px",
                        borderRadius: "4px",
                        border: "1px solid #cbd5e1",
                        padding: "0 12px",
                        fontSize: "13px",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>

                {/* Number Of Industries & Zone Grade (Radio A / B) */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "16px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px" }}>
                      Number Of Industries
                    </label>
                    <input
                      type="number"
                      value={formData.num_industries}
                      onChange={(e) => setFormData({ ...formData, num_industries: e.target.value })}
                      placeholder="e.g. 250"
                      style={{
                        width: "100%",
                        height: "38px",
                        borderRadius: "4px",
                        border: "1px solid #cbd5e1",
                        padding: "0 12px",
                        fontSize: "13px",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px" }}>
                      Zone Grade
                    </label>
                    <div style={{ display: "flex", gap: "16px", alignItems: "center", height: "38px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="zone_grade"
                          value="A"
                          checked={formData.zone_grade === "A"}
                          onChange={(e) => setFormData({ ...formData, zone_grade: e.target.value })}
                        />
                        A
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="zone_grade"
                          value="B"
                          checked={formData.zone_grade === "B"}
                          onChange={(e) => setFormData({ ...formData, zone_grade: e.target.value })}
                        />
                        B
                      </label>
                    </div>
                  </div>
                </div>

                {/* Type Of Industries */}
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px" }}>
                    Type Of Industries
                  </label>
                  <input
                    type="text"
                    value={formData.industry_types}
                    onChange={(e) => setFormData({ ...formData, industry_types: e.target.value })}
                    placeholder="e.g. Textiles, Chemicals, Food Processing"
                    style={{
                      width: "100%",
                      height: "38px",
                      borderRadius: "4px",
                      border: "1px solid #cbd5e1",
                      padding: "0 12px",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                {/* Potential Category Of Machines To Target */}
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px" }}>
                    Potential Category Of Machines To Target
                  </label>
                  <input
                    type="text"
                    value={formData.potential_machine_categories}
                    onChange={(e) => setFormData({ ...formData, potential_machine_categories: e.target.value })}
                    placeholder="e.g. Flow Wrap, Shrink, Form Fill Seal"
                    style={{
                      width: "100%",
                      height: "38px",
                      borderRadius: "4px",
                      border: "1px solid #cbd5e1",
                      padding: "0 12px",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                {/* Remarks */}
                <div style={{ marginBottom: "24px" }}>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px" }}>
                    Remarks
                  </label>
                  <textarea
                    rows={3}
                    value={formData.remarks}
                    onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                    placeholder="Enter additional remarks or territory notes..."
                    style={{
                      width: "100%",
                      borderRadius: "4px",
                      border: "1px solid #cbd5e1",
                      padding: "8px 12px",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                {/* Submit Button */}
                <div>
                  <button
                    type="submit"
                    disabled={saving}
                    style={{
                      width: "100%",
                      height: "42px",
                      background: "#0061f2",
                      color: "#fff",
                      border: "none",
                      borderRadius: "4px",
                      fontSize: "14px",
                      fontWeight: 600,
                      cursor: saving ? "not-allowed" : "pointer",
                      boxShadow: "0 2px 4px rgba(0,97,242,0.25)",
                    }}
                  >
                    {saving ? "Saving..." : "Submit"}
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

export default IndustrialZonesPage;
