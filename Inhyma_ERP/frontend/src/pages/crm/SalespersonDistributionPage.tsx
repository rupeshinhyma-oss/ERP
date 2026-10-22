/**
 * SalespersonDistributionPage — Inhyma CRM Salesperson Configuration Setup.
 *
 * Implements CRM Salesperson Configuration:
 * - AppShell with activeKey="crm-distribution"
 * - Breadcrumb: Home / CRM / Salesperson Configuration
 * - Clear distinction: Configuration only, no active lead routing or reallocation.
 * - Table fitted to viewport at desktop resolutions without horizontal scrollbar.
 * - Single-scroll configuration drawer with 100dvh viewport-aware height:
 *     1. Fixed Header (Salesperson, employee code, department, close button)
 *     2. Single flexible vertical scroll container (overflow-y: auto, min-height: 0,
 *        generous bottom padding buffer so Advanced Settings & Notes are fully reachable)
 *     3. Fixed Footer (Cancel & Save Configuration)
 * - useBodyScrollLock ensures the background page does not scroll while drawer is open.
 * - Section A: Compact "Eligible for Automatic Assignment" switch with explanations
 * - Section B: "All Territories" vs "Specific Territories" with searchable multi-select checkboxes & chips
 * - Section C: Collapsed-by-default "Advanced Settings" (Priority, Capacity, Internal Routing Notes)
 * - Bulk eligibility configuration modal with explicit confirmation.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { apiGet, apiPut, apiPost, errorMessage } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { auth } from "@/lib/auth";
import { useBodyScrollLock } from "@/lib/hooks";
import { Modal, ErrorBanner } from "@/components/ui";
import {
  IconRefresh,
  IconEdit,
  IconMap,
} from "@/components/icons";

export interface TerritoryItem {
  id: string;
  state_id: string;
  state_name: string;
  state_code?: string | null;
}

export interface SalespersonDistributionItem {
  user_id: string;
  username: string;
  display_name: string;
  employee_code?: string | null;
  email?: string | null;
  is_active_user: boolean;
  user_status: string;
  department?: string | null;

  // Configuration
  is_eligible: boolean;
  priority: number;
  max_lead_capacity?: number | null;
  remaining_capacity?: number | null;
  ineligibility_reasons?: string[];
  is_active_config: boolean;
  notes?: string | null;
  territories: TerritoryItem[];

  // Reliable CRM lead statistics from database
  active_lead_count: number;
  total_assigned_lead_count: number;
  last_assigned_at?: string | null;

  updated_at?: string | null;
}

interface StateMasterItem {
  id: string;
  name: string;
  code?: string | null;
}

interface InitialFormState {
  eligible: boolean;
  territoryMode: "ALL" | "SPECIFIC";
  stateIds: string[];
  priority: number;
  capacity: string;
  notes: string;
}

export function SalespersonDistributionPage() {
  const showToast = useToast();

  const [salespeople, setSalespeople] = useState<SalespersonDistributionItem[]>([]);
  const [availableStates, setAvailableStates] = useState<StateMasterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("ALL");
  const [eligibilityFilter, setEligibilityFilter] = useState<"ALL" | "ELIGIBLE" | "INELIGIBLE">("ALL");
  const [territoryFilter, setTerritoryFilter] = useState("ALL");

  // Selection for bulk actions
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkTargetEligibility, setBulkTargetEligibility] = useState<boolean>(true);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  // Edit Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<SalespersonDistributionItem | null>(null);
  const [initialFormState, setInitialFormState] = useState<InitialFormState | null>(null);

  const [editEligible, setEditEligible] = useState(false);
  const [territoryMode, setTerritoryMode] = useState<"ALL" | "SPECIFIC">("SPECIFIC");
  const [editTerritoryStateIds, setEditTerritoryStateIds] = useState<string[]>([]);
  const [territorySearch, setTerritorySearch] = useState("");

  // Advanced settings (collapsed by default)
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [editPriority, setEditPriority] = useState<number>(1);
  const [editCapacity, setEditCapacity] = useState<string>("");
  const [editNotes, setEditNotes] = useState("");

  const [drawerSaving, setDrawerSaving] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  // Lock background body scrolling while drawer is active
  useBodyScrollLock(drawerOpen);

  // Authorization check
  const canManage = auth.hasPermission("crm.distribution.manage");

  // Fetch States from ERP master
  const fetchStates = useCallback(async () => {
    try {
      const res = await apiGet<any>("/masters/states?limit=500&page_size=500&status=active");
      const dataPayload = (res as any)?.data ?? res;
      const list = Array.isArray(dataPayload) ? dataPayload : dataPayload?.items || dataPayload?.data || [];
      const mapped: StateMasterItem[] = list.map((s: any) => ({
        id: s.id,
        name: s.name,
        code: s.code,
      }));
      mapped.sort((a, b) => a.name.localeCompare(b.name));
      setAvailableStates(mapped);
    } catch (err) {
      console.warn("Could not load states master:", err);
    }
  }, []);

  // Fetch Salespeople configuration list
  const fetchSalespeople = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await apiGet<any>("/crm/distribution/salespeople");
      const data: SalespersonDistributionItem[] = res?.data || (Array.isArray(res) ? res : []);
      setSalespeople(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchStates();
    fetchSalespeople();
  }, [fetchStates, fetchSalespeople]);

  // Unique departments for filter dropdown
  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    salespeople.forEach((u) => {
      if (u.department) set.add(u.department);
    });
    return Array.from(set).sort();
  }, [salespeople]);

  // Filtered salespeople list
  const filteredSalespeople = useMemo(() => {
    return salespeople.filter((u) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const name = (u.display_name || "").toLowerCase();
        const uname = u.username.toLowerCase();
        const code = (u.employee_code || "").toLowerCase();
        const email = (u.email || "").toLowerCase();
        if (!name.includes(q) && !uname.includes(q) && !code.includes(q) && !email.includes(q)) {
          return false;
        }
      }

      // Department
      if (departmentFilter !== "ALL") {
        if (!u.department || u.department.toLowerCase() !== departmentFilter.toLowerCase()) {
          return false;
        }
      }

      // Eligibility
      if (eligibilityFilter === "ELIGIBLE" && !u.is_eligible) return false;
      if (eligibilityFilter === "INELIGIBLE" && u.is_eligible) return false;

      // Territory
      if (territoryFilter !== "ALL") {
        const hasState = u.territories.some((t) => t.state_id === territoryFilter);
        if (!hasState) return false;
      }

      return true;
    });
  }, [salespeople, searchQuery, departmentFilter, eligibilityFilter, territoryFilter]);

  // Summary Metrics
  const summaryMetrics = useMemo(() => {
    const totalInScope = salespeople.length;
    const eligibleCount = salespeople.filter((u) => u.is_eligible).length;
    const uniqueTerritories = new Set<string>();
    let totalActiveLeads = 0;

    salespeople.forEach((u) => {
      if (u.is_eligible) {
        u.territories.forEach((t) => uniqueTerritories.add(t.state_id));
      }
      totalActiveLeads += u.active_lead_count || 0;
    });

    return {
      totalInScope,
      eligibleCount,
      territoriesCount: uniqueTerritories.size,
      totalActiveLeads,
    };
  }, [salespeople]);

  // Selection handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedUserIds(filteredSalespeople.map((u) => u.user_id));
    } else {
      setSelectedUserIds([]);
    }
  };

  const handleToggleRow = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  // Open Edit Drawer
  const handleOpenDrawer = (user: SalespersonDistributionItem) => {
    setSelectedUser(user);

    // Determine initial territory mode: if all available states are covered, set mode to ALL
    const hasAllStates =
      availableStates.length > 0 &&
      user.territories.length >= availableStates.length &&
      availableStates.every((s) => user.territories.some((t) => t.state_id === s.id));

    const initialMode: "ALL" | "SPECIFIC" = hasAllStates ? "ALL" : "SPECIFIC";
    const initialIds = hasAllStates
      ? availableStates.map((s) => s.id)
      : user.territories.map((t) => t.state_id);

    const initial: InitialFormState = {
      eligible: user.is_eligible,
      territoryMode: initialMode,
      stateIds: initialIds,
      priority: user.priority || 1,
      capacity:
        user.max_lead_capacity !== null && user.max_lead_capacity !== undefined
          ? String(user.max_lead_capacity)
          : "",
      notes: user.notes || "",
    };

    setInitialFormState(initial);
    setEditEligible(initial.eligible);
    setTerritoryMode(initial.territoryMode);
    setEditTerritoryStateIds(initial.stateIds);
    setEditPriority(initial.priority);
    setEditCapacity(initial.capacity);
    setEditNotes(initial.notes);
    setTerritorySearch("");
    setAdvancedOpen(false);
    setDrawerError(null);
    setDrawerOpen(true);
  };

  // Dirty check: are there unsaved changes in the drawer?
  const isDrawerDirty = useMemo(() => {
    if (!initialFormState) return false;
    if (editEligible !== initialFormState.eligible) return true;
    if (territoryMode !== initialFormState.territoryMode) return true;
    if (editPriority !== initialFormState.priority) return true;
    if (editCapacity !== initialFormState.capacity) return true;
    if (editNotes !== initialFormState.notes) return true;

    if (territoryMode === "SPECIFIC") {
      const currentSet = new Set(editTerritoryStateIds);
      const initialSet = new Set(initialFormState.stateIds);
      if (currentSet.size !== initialSet.size) return true;
      for (const id of currentSet) {
        if (!initialSet.has(id)) return true;
      }
    }
    return false;
  }, [
    initialFormState,
    editEligible,
    territoryMode,
    editPriority,
    editCapacity,
    editNotes,
    editTerritoryStateIds,
  ]);

  const handleCloseDrawer = () => {
    if (drawerSaving) return;
    if (isDrawerDirty) {
      const discard = window.confirm("You have unsaved configuration changes. Discard changes?");
      if (!discard) return;
    }
    setDrawerOpen(false);
    setSelectedUser(null);
    setInitialFormState(null);
    setDrawerError(null);
  };

  // Specific territory toggles
  const toggleTerritory = (stateId: string) => {
    setEditTerritoryStateIds((prev) =>
      prev.includes(stateId) ? prev.filter((id) => id !== stateId) : [...prev, stateId]
    );
  };

  const handleSelectAllFilteredTerritories = () => {
    const q = territorySearch.toLowerCase().trim();
    const matchingIds = availableStates
      .filter((s) => s.name.toLowerCase().includes(q) || (s.code && s.code.toLowerCase().includes(q)))
      .map((s) => s.id);
    setEditTerritoryStateIds((prev) => Array.from(new Set([...prev, ...matchingIds])));
  };

  const handleClearTerritories = () => {
    setEditTerritoryStateIds([]);
  };

  // Save Salesperson Configuration
  const handleSaveConfiguration = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedUser) return;

    setDrawerSaving(true);
    setDrawerError(null);

    try {
      // Validate capacity
      const parsedCapacity = editCapacity.trim() ? parseInt(editCapacity.trim(), 10) : null;
      if (parsedCapacity !== null && (isNaN(parsedCapacity) || parsedCapacity < 0)) {
        throw new Error("Maximum capacity must be a positive integer or left blank.");
      }

      // Validate territory selection
      let finalStateIds: string[] = [];
      if (territoryMode === "ALL") {
        finalStateIds = availableStates.map((s) => s.id);
      } else {
        if (editTerritoryStateIds.length === 0) {
          throw new Error(
            "Under Specific Territories, you must select at least one territory. Choose 'All Territories' if nationwide coverage is intended."
          );
        }
        finalStateIds = editTerritoryStateIds;
      }

      const payload = {
        is_eligible: editEligible,
        priority: editPriority,
        max_lead_capacity: parsedCapacity,
        notes: editNotes.trim() || null,
        territory_state_ids: finalStateIds,
      };

      const res = await apiPut<any>(`/crm/distribution/salespeople/${selectedUser.user_id}`, payload);
      const updated: SalespersonDistributionItem = res?.data || res;

      showToast("Salesperson configuration saved successfully.", "success");

      // Update local state table
      setSalespeople((prev) =>
        prev.map((u) => (u.user_id === updated.user_id ? updated : u))
      );
      setInitialFormState(null);
      setDrawerOpen(false);
      setSelectedUser(null);
    } catch (err: any) {
      setDrawerError(errorMessage(err));
    } finally {
      setDrawerSaving(false);
    }
  };

  // Bulk Eligibility Action
  const handleConfirmBulk = async () => {
    if (selectedUserIds.length === 0) return;
    setBulkSubmitting(true);

    try {
      const payload = {
        user_ids: selectedUserIds,
        is_eligible: bulkTargetEligibility,
      };

      await apiPost("/crm/distribution/salespeople/bulk-eligibility", payload);
      showToast(
        `Successfully ${bulkTargetEligibility ? "enabled" : "disabled"} assignment eligibility for ${selectedUserIds.length} user(s).`,
        "success"
      );
      setSelectedUserIds([]);
      setBulkModalOpen(false);
      fetchSalespeople();
    } catch (err) {
      showToast(errorMessage(err), "error");
    } finally {
      setBulkSubmitting(false);
    }
  };

  // Filtered available states in drawer multi-select
  const filteredDrawerStates = useMemo(() => {
    const q = territorySearch.toLowerCase().trim();
    if (!q) return availableStates;
    return availableStates.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.code && s.code.toLowerCase().includes(q))
    );
  }, [availableStates, territorySearch]);

  return (
    <AppShell activeKey="crm-distribution">
      <div className="crm-configuration-page" style={{ padding: "1.5rem", maxWidth: "1400px", margin: "0 auto", boxSizing: "border-box" }}>
        {/* Breadcrumb */}
        <Breadcrumb trail={["CRM", "Salesperson Configuration"]} />

        {/* Page Header */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "1rem",
            marginBottom: "1.5rem",
            gap: "1rem",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                color: "var(--color-text, #0f172a)",
                margin: 0,
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <IconMap style={{ width: "24px", height: "24px", color: "var(--color-primary, #2563eb)" }} />
              Salesperson Configuration
            </h1>
            <p style={{ margin: "0.25rem 0 0 0", color: "#64748b", fontSize: "0.875rem" }}>
              Configure salesperson eligibility and assignment preferences for future CRM lead allocation.
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => fetchSalespeople(true)}
              disabled={refreshing || loading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                fontSize: "0.875rem",
                padding: "0.5rem 0.875rem",
                borderRadius: "0.375rem",
                backgroundColor: "#fff",
                border: "1px solid #cbd5e1",
                cursor: refreshing ? "not-allowed" : "pointer",
                fontWeight: 500,
              }}
            >
              <IconRefresh
                style={{
                  width: "16px",
                  height: "16px",
                  animation: refreshing ? "spin 1s linear infinite" : "none",
                }}
              />
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {/* Summary Metric Cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "0.5rem",
              border: "1px solid #e2e8f0",
              padding: "1rem 1.25rem",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ fontSize: "0.8125rem", color: "#64748b", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.025em" }}>
              Eligible Salespeople
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginTop: "0.375rem" }}>
              <span style={{ fontSize: "1.75rem", fontWeight: 700, color: "#16a34a" }}>
                {summaryMetrics.eligibleCount}
              </span>
              <span style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>
                / {summaryMetrics.totalInScope} active in scope
              </span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.35rem" }}>
              Configured for future lead routing
            </div>
          </div>

          <div
            style={{
              background: "#fff",
              borderRadius: "0.5rem",
              border: "1px solid #e2e8f0",
              padding: "1rem 1.25rem",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ fontSize: "0.8125rem", color: "#64748b", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.025em" }}>
              Territories Covered
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginTop: "0.375rem" }}>
              <span style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--color-primary, #2563eb)" }}>
                {summaryMetrics.territoriesCount}
              </span>
              <span style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>
                / {availableStates.length} master states
              </span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.35rem" }}>
              Mapped across eligible salespeople
            </div>
          </div>

          <div
            style={{
              background: "#fff",
              borderRadius: "0.5rem",
              border: "1px solid #e2e8f0",
              padding: "1rem 1.25rem",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ fontSize: "0.8125rem", color: "#64748b", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.025em" }}>
              Active Lead Workload
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginTop: "0.375rem" }}>
              <span style={{ fontSize: "1.75rem", fontWeight: 700, color: "#0f172a" }}>
                {summaryMetrics.totalActiveLeads}
              </span>
              <span style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>
                leads currently owned in CRM
              </span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.35rem" }}>
              Reflects database lead records
            </div>
          </div>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div style={{ marginBottom: "1.5rem" }}>
            <ErrorBanner error={error} />
          </div>
        )}

        {/* Search, Filter & Bulk Action Toolbar */}
        <div
          style={{
            background: "#fff",
            borderRadius: "0.5rem",
            border: "1px solid #e2e8f0",
            padding: "1rem 1.25rem",
            marginBottom: "1.5rem",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
            {/* Search Input */}
            <div style={{ flex: "1 1 240px", minWidth: "220px" }}>
              <input
                type="text"
                placeholder="Search by name, employee code, or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.875rem",
                  border: "1px solid #cbd5e1",
                  borderRadius: "0.375rem",
                  outline: "none",
                }}
              />
            </div>

            {/* Department Filter */}
            <div style={{ minWidth: "160px" }}>
              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.875rem",
                  border: "1px solid #cbd5e1",
                  borderRadius: "0.375rem",
                  backgroundColor: "#fff",
                }}
              >
                <option value="ALL">All Departments</option>
                {departmentOptions.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>

            {/* Eligibility Filter */}
            <div style={{ minWidth: "150px" }}>
              <select
                value={eligibilityFilter}
                onChange={(e) => setEligibilityFilter(e.target.value as any)}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.875rem",
                  border: "1px solid #cbd5e1",
                  borderRadius: "0.375rem",
                  backgroundColor: "#fff",
                }}
              >
                <option value="ALL">All Eligibility</option>
                <option value="ELIGIBLE">Eligible Only</option>
                <option value="INELIGIBLE">Not Eligible</option>
              </select>
            </div>

            {/* Territory Filter */}
            <div style={{ minWidth: "160px" }}>
              <select
                value={territoryFilter}
                onChange={(e) => setTerritoryFilter(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.875rem",
                  border: "1px solid #cbd5e1",
                  borderRadius: "0.375rem",
                  backgroundColor: "#fff",
                }}
              >
                <option value="ALL">All Territories</option>
                {availableStates.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Reset Filters Button */}
            {(searchQuery || departmentFilter !== "ALL" || eligibilityFilter !== "ALL" || territoryFilter !== "ALL") && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setSearchQuery("");
                  setDepartmentFilter("ALL");
                  setEligibilityFilter("ALL");
                  setTerritoryFilter("ALL");
                }}
                style={{
                  fontSize: "0.8125rem",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.375rem",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#fff",
                  color: "#475569",
                  cursor: "pointer",
                }}
              >
                Clear Filters
              </button>
            )}
          </div>

          {/* Bulk Action Bar */}
          {selectedUserIds.length > 0 && canManage && (
            <div
              style={{
                marginTop: "0.875rem",
                paddingTop: "0.875rem",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "0.5rem",
              }}
            >
              <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#0f172a" }}>
                {selectedUserIds.length} salesperson(s) selected
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => {
                    setBulkTargetEligibility(true);
                    setBulkModalOpen(true);
                  }}
                  style={{
                    padding: "0.35rem 0.75rem",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    borderRadius: "0.375rem",
                    backgroundColor: "#ecfdf5",
                    color: "#065f46",
                    border: "1px solid #a7f3d0",
                    cursor: "pointer",
                  }}
                >
                  Enable Assignment
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBulkTargetEligibility(false);
                    setBulkModalOpen(true);
                  }}
                  style={{
                    padding: "0.35rem 0.75rem",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    borderRadius: "0.375rem",
                    backgroundColor: "#fef2f2",
                    color: "#991b1b",
                    border: "1px solid #fecaca",
                    cursor: "pointer",
                  }}
                >
                  Disable Assignment
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedUserIds([])}
                  style={{
                    padding: "0.35rem 0.65rem",
                    fontSize: "0.8125rem",
                    borderRadius: "0.375rem",
                    backgroundColor: "#fff",
                    color: "#64748b",
                    border: "1px solid #cbd5e1",
                    cursor: "pointer",
                  }}
                >
                  Deselect All
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Salespeople Table — Compact, viewport-fitted with clean column proportions */}
        <div
          style={{
            background: "#fff",
            borderRadius: "0.5rem",
            border: "1px solid #e2e8f0",
            overflow: "hidden",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
                fontSize: "0.8125rem",
                tableLayout: "auto",
              }}
            >
              <thead>
                <tr
                  style={{
                    backgroundColor: "#f8fafc",
                    borderBottom: "1px solid #e2e8f0",
                    color: "#475569",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {canManage && (
                    <th style={{ padding: "0.625rem 0.5rem", width: "36px", textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={
                          filteredSalespeople.length > 0 &&
                          selectedUserIds.length === filteredSalespeople.length
                        }
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        style={{ cursor: "pointer" }}
                      />
                    </th>
                  )}
                  <th style={{ padding: "0.625rem 0.75rem" }}>Salesperson</th>
                  <th style={{ padding: "0.625rem 0.75rem" }}>Department</th>
                  <th style={{ padding: "0.625rem 0.75rem" }}>Eligibility</th>
                  <th style={{ padding: "0.625rem 0.75rem" }}>Territory Coverage</th>
                  <th style={{ padding: "0.625rem 0.5rem" }}>Priority</th>
                  <th style={{ padding: "0.625rem 0.5rem" }}>Capacity</th>
                  <th style={{ padding: "0.625rem 0.5rem", textAlign: "center" }} title="Active leads assigned in CRM database">Active</th>
                  <th style={{ padding: "0.625rem 0.5rem", textAlign: "center" }} title="Total leads ever assigned in CRM">Total</th>
                  <th style={{ padding: "0.625rem 0.75rem", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={canManage ? 10 : 9}
                      style={{ padding: "3rem 1rem", textAlign: "center", color: "#64748b" }}
                    >
                      Loading salesperson configuration data...
                    </td>
                  </tr>
                ) : filteredSalespeople.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canManage ? 10 : 9}
                      style={{ padding: "3rem 1rem", textAlign: "center", color: "#64748b" }}
                    >
                      <div style={{ maxWidth: "360px", margin: "0 auto" }}>
                        <IconMap style={{ width: "36px", height: "36px", color: "#94a3b8", margin: "0 auto 0.5rem" }} />
                        <div style={{ fontWeight: 600, color: "#0f172a", fontSize: "0.9375rem" }}>
                          No salespeople found
                        </div>
                        <p style={{ fontSize: "0.8125rem", color: "#64748b", marginTop: "0.25rem" }}>
                          No users matched your current search and filter criteria within your authorized scope.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredSalespeople.map((u) => {
                    const isSelected = selectedUserIds.includes(u.user_id);
                    const isAllTerritories =
                      availableStates.length > 0 &&
                      u.territories.length >= availableStates.length &&
                      availableStates.every((s) => u.territories.some((t) => t.state_id === s.id));

                    return (
                      <tr
                        key={u.user_id}
                        style={{
                          borderBottom: "1px solid #f1f5f9",
                          backgroundColor: isSelected ? "#eff6ff" : "transparent",
                          transition: "background-color 0.15s",
                        }}
                      >
                        {canManage && (
                          <td style={{ padding: "0.625rem 0.5rem", textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleRow(u.user_id)}
                              style={{ cursor: "pointer" }}
                            />
                          </td>
                        )}

                        {/* Salesperson Identifier */}
                        <td style={{ padding: "0.625rem 0.75rem" }}>
                          <div style={{ fontWeight: 600, color: "#0f172a", lineHeight: 1.3, wordBreak: "break-word" }}>
                            {u.display_name || u.username}
                          </div>
                          <div style={{ display: "flex", gap: "0.35rem", alignItems: "center", marginTop: "0.15rem", flexWrap: "wrap" }}>
                            {u.employee_code && (
                              <span
                                style={{
                                  fontSize: "0.7rem",
                                  color: "#475569",
                                  backgroundColor: "#f1f5f9",
                                  padding: "0.05rem 0.3rem",
                                  borderRadius: "0.25rem",
                                  fontFamily: "monospace",
                                }}
                              >
                                {u.employee_code}
                              </span>
                            )}
                            {u.email && (
                              <span style={{ fontSize: "0.7rem", color: "#94a3b8", wordBreak: "break-all" }}>
                                {u.email}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Department */}
                        <td style={{ padding: "0.625rem 0.75rem" }}>
                          <span
                            title={u.department || "General"}
                            style={{
                              display: "inline-block",
                              padding: "0.15rem 0.45rem",
                              borderRadius: "0.25rem",
                              fontSize: "0.75rem",
                              fontWeight: 500,
                              backgroundColor: "#f1f5f9",
                              color: "#334155",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {u.department || "General"}
                          </span>
                        </td>

                        {/* Eligibility Status */}
                        <td style={{ padding: "0.625rem 0.75rem" }}>
                          {u.is_eligible ? (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.25rem",
                                padding: "0.15rem 0.45rem",
                                borderRadius: "9999px",
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                backgroundColor: "#ecfdf5",
                                color: "#065f46",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#10b981" }} />
                              Eligible
                            </span>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.25rem",
                                  padding: "0.15rem 0.45rem",
                                  borderRadius: "9999px",
                                  fontSize: "0.75rem",
                                  fontWeight: 500,
                                  backgroundColor: "#fef2f2",
                                  color: "#991b1b",
                                  border: "1px solid #fecaca",
                                  whiteSpace: "nowrap",
                                  width: "fit-content",
                                }}
                              >
                                <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#ef4444" }} />
                                Not Eligible
                              </span>
                              {u.ineligibility_reasons && u.ineligibility_reasons.length > 0 && (
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.1rem" }}>
                                  {u.ineligibility_reasons.map((reason, rIdx) => (
                                    <span
                                      key={rIdx}
                                      style={{
                                        fontSize: "0.6875rem",
                                        color: "#b91c1c",
                                        lineHeight: 1.25,
                                      }}
                                    >
                                      • {reason}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Assigned Territories */}
                        <td style={{ padding: "0.625rem 0.75rem" }}>
                          {isAllTerritories ? (
                            <span
                              style={{
                                display: "inline-block",
                                padding: "0.15rem 0.45rem",
                                borderRadius: "0.25rem",
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                backgroundColor: "#eff6ff",
                                color: "#1e40af",
                                whiteSpace: "nowrap",
                              }}
                            >
                              All ({u.territories.length})
                            </span>
                          ) : u.territories.length === 0 ? (
                            <span style={{ color: "#94a3b8", fontSize: "0.8125rem" }}>—</span>
                          ) : (
                            <div
                              style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", alignItems: "center" }}
                              title={u.territories.map((t) => t.state_name).join(", ")}
                            >
                              {u.territories.slice(0, 2).map((t) => (
                                <span
                                  key={t.id}
                                  style={{
                                    display: "inline-block",
                                    padding: "0.1rem 0.35rem",
                                    borderRadius: "0.25rem",
                                    fontSize: "0.7rem",
                                    fontWeight: 500,
                                    backgroundColor: "#f1f5f9",
                                    color: "#334155",
                                    border: "1px solid #e2e8f0",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {t.state_name}
                                </span>
                              ))}
                              {u.territories.length > 2 && (
                                <span
                                  style={{
                                    display: "inline-block",
                                    padding: "0.1rem 0.3rem",
                                    borderRadius: "0.25rem",
                                    fontSize: "0.7rem",
                                    color: "#64748b",
                                    backgroundColor: "#f8fafc",
                                    border: "1px solid #e2e8f0",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  +{u.territories.length - 2}
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Priority */}
                        <td style={{ padding: "0.625rem 0.5rem" }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "0.15rem 0.4rem",
                              borderRadius: "0.25rem",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              backgroundColor: "#fef3c7",
                              color: "#92400e",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Priority {u.priority}
                          </span>
                        </td>

                        {/* Capacity */}
                        <td style={{ padding: "0.625rem 0.5rem", color: "#475569", whiteSpace: "nowrap" }}>
                          {u.max_lead_capacity !== null && u.max_lead_capacity !== undefined ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                              <span style={{ fontWeight: 500 }}>{u.max_lead_capacity} max</span>
                              {(() => {
                                const rem = u.remaining_capacity ?? Math.max(0, u.max_lead_capacity - u.active_lead_count);
                                return (
                                  <span
                                    style={{
                                      fontSize: "0.7rem",
                                      fontWeight: 600,
                                      color: rem > 0 ? "#16a34a" : "#dc2626",
                                    }}
                                  >
                                    {rem} remaining
                                  </span>
                                );
                              })()}
                            </div>
                          ) : (
                            <span style={{ color: "#94a3b8" }}>Unlimited</span>
                          )}
                        </td>

                        {/* Active CRM Leads */}
                        <td style={{ padding: "0.625rem 0.5rem", textAlign: "center" }}>
                          <span
                            title="Active CRM leads"
                            style={{
                              display: "inline-block",
                              fontWeight: u.active_lead_count > 0 ? 600 : 400,
                              color: u.active_lead_count > 0 ? "#0f172a" : "#94a3b8",
                            }}
                          >
                            {u.active_lead_count}
                          </span>
                        </td>

                        {/* Total Assigned */}
                        <td style={{ padding: "0.625rem 0.5rem", textAlign: "center", color: "#64748b" }}>
                          <span title="Total CRM leads">{u.total_assigned_lead_count}</span>
                        </td>

                        {/* Actions */}
                        <td style={{ padding: "0.625rem 0.75rem", textAlign: "right" }}>
                          <button
                            type="button"
                            onClick={() => handleOpenDrawer(u)}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.25rem",
                              padding: "0.3rem 0.65rem",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              borderRadius: "0.375rem",
                              border: "1px solid #cbd5e1",
                              backgroundColor: "#fff",
                              color: "#334155",
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <IconEdit style={{ width: "13px", height: "13px" }} />
                            Configure
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Informational Scope Notice */}
        <div
          style={{
            marginTop: "1.5rem",
            padding: "0.875rem 1rem",
            borderRadius: "0.5rem",
            backgroundColor: "#f8fafc",
            border: "1px solid #e2e8f0",
            fontSize: "0.8125rem",
            color: "#64748b",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <span style={{ fontWeight: 600, color: "#334155" }}>Notice:</span>
          This page manages salesperson configuration settings for future lead assignment. Leads are not automatically distributed or reassigned in this phase.
        </div>
      </div>

      {/* ========================================================================= */}
      {/* Configure Salesperson Drawer (Single Scroll Container Architecture)      */}
      {/* ========================================================================= */}
      {drawerOpen && selectedUser && (
        <div
          data-testid="salesperson-drawer-backdrop"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.4)",
            backdropFilter: "blur(2px)",
            WebkitBackdropFilter: "blur(2px)",
            zIndex: 1050,
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "stretch",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseDrawer();
          }}
        >
          <div
            data-testid="salesperson-drawer-card"
            className="crm-salesperson-drawer-card"
            style={{
              width: "100%",
              maxWidth: "560px",
              height: "100dvh",
              maxHeight: "100dvh",
              backgroundColor: "#ffffff",
              boxShadow: "-8px 0 30px rgba(0, 0, 0, 0.15)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* 1. Fixed Drawer Header */}
            <div
              style={{
                flexShrink: 0,
                padding: "1rem 1.5rem",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                backgroundColor: "#ffffff",
              }}
            >
              <div>
                <h2 style={{ fontSize: "1.125rem", fontWeight: 700, margin: 0, color: "#0f172a" }}>
                  Salesperson Configuration
                </h2>
                <div style={{ marginTop: "0.35rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, color: "#334155", fontSize: "0.875rem" }}>
                    {selectedUser.display_name || selectedUser.username}
                  </span>
                  {selectedUser.employee_code && (
                    <span
                      style={{
                        backgroundColor: "#f1f5f9",
                        color: "#475569",
                        fontSize: "0.75rem",
                        padding: "0.1rem 0.4rem",
                        borderRadius: "0.25rem",
                        fontFamily: "monospace",
                      }}
                    >
                      {selectedUser.employee_code}
                    </span>
                  )}
                  <span
                    style={{
                      backgroundColor: "#eff6ff",
                      color: "#1e40af",
                      fontSize: "0.75rem",
                      padding: "0.1rem 0.4rem",
                      borderRadius: "0.25rem",
                      fontWeight: 500,
                    }}
                  >
                    {selectedUser.department || "General"}
                  </span>
                </div>
                {selectedUser.last_assigned_at && (
                  <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>
                    Last lead assigned in CRM: {new Date(selectedUser.last_assigned_at).toLocaleDateString()}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleCloseDrawer}
                disabled={drawerSaving}
                aria-label="Close configuration drawer"
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: "1.5rem",
                  color: "#94a3b8",
                  cursor: "pointer",
                  lineHeight: 1,
                  padding: "0.25rem",
                }}
              >
                ×
              </button>
            </div>

            {/* 2. Scrollable Middle Body (Single Primary Scroll Container) */}
            <div
              data-testid="salesperson-drawer-scroll-body"
              tabIndex={0}
              style={{
                flex: "1 1 0%",
                minHeight: 0,
                overflowY: "auto",
                overflowX: "hidden",
                WebkitOverflowScrolling: "touch",
                padding: "1.25rem 1.5rem 3.5rem 1.5rem", // Generous bottom padding buffer so last field is never covered by footer
                display: "flex",
                flexDirection: "column",
                gap: "1.25rem",
              }}
            >
              {drawerError && <ErrorBanner error={drawerError} />}

              {/* ------------------------------------------------------------- */}
              {/* Section A: Assignment Eligibility                             */}
              {/* ------------------------------------------------------------- */}
              <div
                style={{
                  backgroundColor: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  padding: "1rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                  <div>
                    <label
                      htmlFor="eligibility-toggle"
                      style={{
                        fontSize: "0.9375rem",
                        fontWeight: 600,
                        color: "#0f172a",
                        display: "block",
                        cursor: "pointer",
                      }}
                    >
                      Eligible for Automatic Assignment
                    </label>
                    <p style={{ margin: "0.35rem 0 0 0", fontSize: "0.8125rem", color: "#475569", lineHeight: 1.4 }}>
                      Prepares this user for future lead assignment. Leads are not assigned immediately or automatically in this phase.
                    </p>
                    <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.75rem", color: "#64748b" }}>
                      Disabling eligibility retains previously saved territory and priority preferences, and does not alter existing lead ownership.
                    </p>
                  </div>
                  <label
                    style={{
                      position: "relative",
                      display: "inline-block",
                      width: "48px",
                      height: "26px",
                      flexShrink: 0,
                      cursor: !canManage || !selectedUser.is_active_user ? "not-allowed" : "pointer",
                    }}
                  >
                    <input
                      id="eligibility-toggle"
                      type="checkbox"
                      checked={editEligible}
                      disabled={!canManage || !selectedUser.is_active_user}
                      onChange={(e) => setEditEligible(e.target.checked)}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span
                      style={{
                        position: "absolute",
                        cursor: "pointer",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: editEligible ? "#10b981" : "#cbd5e1",
                        transition: "0.2s",
                        borderRadius: "26px",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          content: "''",
                          height: "20px",
                          width: "20px",
                          left: editEligible ? "25px" : "3px",
                          bottom: "3px",
                          backgroundColor: "#fff",
                          transition: "0.2s",
                          borderRadius: "50%",
                        }}
                      />
                    </span>
                  </label>
                </div>

                {!selectedUser.is_active_user && (
                  <div
                    style={{
                      marginTop: "0.75rem",
                      padding: "0.5rem",
                      backgroundColor: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: "0.375rem",
                      fontSize: "0.75rem",
                      color: "#b91c1c",
                      fontWeight: 500,
                    }}
                  >
                    This ERP user account is currently inactive. Inactive accounts cannot be enabled for lead assignment.
                  </div>
                )}
              </div>

              {/* ------------------------------------------------------------- */}
              {/* Section B: Territory Coverage                                 */}
              {/* ------------------------------------------------------------- */}
              <div>
                <label style={{ fontSize: "0.875rem", fontWeight: 700, color: "#0f172a", display: "block", marginBottom: "0.5rem" }}>
                  Territory Coverage
                </label>

                {/* All Territories vs Specific Territories Selector */}
                <div
                  style={{
                    display: "flex",
                    gap: "1.5rem",
                    marginBottom: "0.75rem",
                    padding: "0.5rem 0.75rem",
                    backgroundColor: "#f8fafc",
                    borderRadius: "0.375rem",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.875rem", cursor: "pointer", fontWeight: 500, color: "#334155" }}>
                    <input
                      type="radio"
                      name="territoryMode"
                      value="ALL"
                      checked={territoryMode === "ALL"}
                      disabled={!canManage}
                      onChange={() => setTerritoryMode("ALL")}
                    />
                    All Territories
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.875rem", cursor: "pointer", fontWeight: 500, color: "#334155" }}>
                    <input
                      type="radio"
                      name="territoryMode"
                      value="SPECIFIC"
                      checked={territoryMode === "SPECIFIC"}
                      disabled={!canManage}
                      onChange={() => setTerritoryMode("SPECIFIC")}
                    />
                    Specific Territories
                  </label>
                </div>

                {territoryMode === "ALL" ? (
                  <div
                    style={{
                      padding: "0.875rem 1rem",
                      backgroundColor: "#eff6ff",
                      border: "1px solid #bfdbfe",
                      borderRadius: "0.375rem",
                      fontSize: "0.8125rem",
                      color: "#1e40af",
                    }}
                  >
                    <strong>Nationwide Coverage:</strong> This salesperson is eligible to receive leads from all {availableStates.length} registered states and territories.
                  </div>
                ) : (
                  <div>
                    {/* Toolbar: Search, Select All Filtered, Clear */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                      <span style={{ fontSize: "0.8125rem", color: "#64748b", fontWeight: 500 }}>
                        Selected: <strong>{editTerritoryStateIds.length}</strong> state(s)
                      </span>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button
                          type="button"
                          onClick={handleSelectAllFilteredTerritories}
                          disabled={!canManage}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--color-primary, #2563eb)",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            cursor: canManage ? "pointer" : "not-allowed",
                            padding: 0,
                          }}
                        >
                          Select All Filtered
                        </button>
                        <span style={{ color: "#cbd5e1" }}>|</span>
                        <button
                          type="button"
                          onClick={handleClearTerritories}
                          disabled={!canManage}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#ef4444",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            cursor: canManage ? "pointer" : "not-allowed",
                            padding: 0,
                          }}
                        >
                          Clear Selection
                        </button>
                      </div>
                    </div>

                    {/* Selected Territory Chips */}
                    <div
                      style={{
                        minHeight: "38px",
                        maxHeight: "96px",
                        overflowY: "auto",
                        padding: "0.4rem 0.5rem",
                        border: "1px solid #cbd5e1",
                        borderRadius: "0.375rem",
                        backgroundColor: "#fafafa",
                        marginBottom: "0.75rem",
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "0.35rem",
                        alignItems: "center",
                      }}
                    >
                      {editTerritoryStateIds.length === 0 ? (
                        <span style={{ fontSize: "0.8125rem", color: "#94a3b8", fontStyle: "italic" }}>
                          No specific territories selected. Please select at least one territory below.
                        </span>
                      ) : (
                        editTerritoryStateIds.map((sId) => {
                          const stateObj = availableStates.find((s) => s.id === sId);
                          return (
                            <span
                              key={sId}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.25rem",
                                backgroundColor: "#ecfdf5",
                                border: "1px solid #a7f3d0",
                                color: "#065f46",
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                padding: "0.15rem 0.45rem",
                                borderRadius: "0.25rem",
                              }}
                            >
                              {stateObj?.name || "Selected State"}
                              {canManage && (
                                <button
                                  type="button"
                                  onClick={() => toggleTerritory(sId)}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    color: "#065f46",
                                    cursor: "pointer",
                                    padding: 0,
                                    fontSize: "0.875rem",
                                    lineHeight: 1,
                                  }}
                                >
                                  ×
                                </button>
                              )}
                            </span>
                          );
                        })
                      )}
                    </div>

                    {/* Search Input for States */}
                    <input
                      type="text"
                      placeholder="Filter states by name or code..."
                      value={territorySearch}
                      onChange={(e) => setTerritorySearch(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "0.45rem 0.75rem",
                        fontSize: "0.8125rem",
                        border: "1px solid #cbd5e1",
                        borderRadius: "0.375rem",
                        marginBottom: "0.5rem",
                      }}
                    />

                    {/* Checkbox List — Natural scrolling without trapping overall drawer scrolling */}
                    <div
                      style={{
                        maxHeight: "160px",
                        overflowY: "auto",
                        border: "1px solid #e2e8f0",
                        borderRadius: "0.375rem",
                        backgroundColor: "#fff",
                      }}
                    >
                      {filteredDrawerStates.length === 0 ? (
                        <div style={{ padding: "0.75rem", fontSize: "0.8125rem", color: "#94a3b8", textAlign: "center" }}>
                          No states match "{territorySearch}"
                        </div>
                      ) : (
                        filteredDrawerStates.map((s) => {
                          const isSelected = editTerritoryStateIds.includes(s.id);
                          return (
                            <label
                              key={s.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "0.4rem 0.75rem",
                                borderBottom: "1px solid #f1f5f9",
                                cursor: canManage ? "pointer" : "not-allowed",
                                backgroundColor: isSelected ? "#f0fdf4" : "transparent",
                                fontSize: "0.8125rem",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  disabled={!canManage}
                                  onChange={() => toggleTerritory(s.id)}
                                />
                                <span style={{ fontWeight: isSelected ? 600 : 400, color: "#0f172a" }}>
                                  {s.name}
                                </span>
                              </div>
                              {s.code && (
                                <span
                                  style={{
                                    fontSize: "0.7rem",
                                    color: "#64748b",
                                    backgroundColor: "#f1f5f9",
                                    padding: "0.05rem 0.3rem",
                                    borderRadius: "0.2rem",
                                    fontFamily: "monospace",
                                  }}
                                >
                                  {s.code}
                                </span>
                              )}
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ------------------------------------------------------------- */}
              {/* Section C: Advanced Settings (Expands naturally, NO clipping) */}
              {/* ------------------------------------------------------------- */}
              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  backgroundColor: "#ffffff",
                }}
              >
                <button
                  type="button"
                  onClick={() => setAdvancedOpen(!advancedOpen)}
                  style={{
                    width: "100%",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0.75rem 1rem",
                    backgroundColor: "#f8fafc",
                    border: "none",
                    borderBottom: advancedOpen ? "1px solid #e2e8f0" : "none",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    color: "#334155",
                    textAlign: "left",
                  }}
                >
                  <span>
                    {advancedOpen ? "▼" : "▶"} Advanced Settings (Priority, Capacity, Notes)
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 400 }}>
                    {advancedOpen ? "Click to collapse" : "Click to expand"}
                  </span>
                </button>

                {advancedOpen && (
                  <div
                    style={{
                      padding: "1.25rem 1rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "1.25rem",
                    }}
                  >
                    {/* Assignment Priority */}
                    <div>
                      <label style={{ fontSize: "0.875rem", fontWeight: 600, color: "#334155", display: "block" }}>
                        Assignment Priority Rank
                      </label>
                      <div style={{ marginTop: "0.35rem" }}>
                        <input
                          type="number"
                          min={1}
                          max={1000}
                          value={editPriority}
                          disabled={!canManage}
                          onChange={(e) => setEditPriority(Math.max(1, parseInt(e.target.value, 10) || 1))}
                          style={{
                            width: "120px",
                            padding: "0.5rem 0.75rem",
                            fontSize: "0.875rem",
                            border: "1px solid #cbd5e1",
                            borderRadius: "0.375rem",
                          }}
                        />
                        <p style={{ margin: "0.35rem 0 0 0", fontSize: "0.75rem", color: "#64748b", lineHeight: 1.4 }}>
                          Priority rank used when multiple eligible salespeople cover the same territory. Lower number indicates higher assignment precedence (e.g. Priority 1 is evaluated before Priority 2).
                        </p>
                      </div>
                    </div>

                    {/* Maximum Lead Capacity */}
                    <div>
                      <label style={{ fontSize: "0.875rem", fontWeight: 600, color: "#334155", display: "block" }}>
                        Maximum Active Lead Capacity (Optional)
                      </label>
                      <div style={{ marginTop: "0.35rem" }}>
                        <input
                          type="number"
                          min={0}
                          placeholder="Unlimited"
                          value={editCapacity}
                          disabled={!canManage}
                          onChange={(e) => setEditCapacity(e.target.value)}
                          style={{
                            width: "160px",
                            padding: "0.5rem 0.75rem",
                            fontSize: "0.875rem",
                            border: "1px solid #cbd5e1",
                            borderRadius: "0.375rem",
                          }}
                        />
                        <p style={{ margin: "0.35rem 0 0 0", fontSize: "0.75rem", color: "#64748b", lineHeight: 1.4 }}>
                          Maximum active leads this salesperson may hold concurrently in future routing. Leave blank for unlimited capacity.
                        </p>
                      </div>
                    </div>

                    {/* Internal Routing Notes */}
                    <div>
                      <label htmlFor="internal-routing-notes" style={{ fontSize: "0.875rem", fontWeight: 600, color: "#334155", display: "block" }}>
                        Internal Routing Notes
                      </label>
                      <div style={{ marginTop: "0.35rem" }}>
                        <textarea
                          id="internal-routing-notes"
                          rows={3}
                          value={editNotes}
                          disabled={!canManage}
                          onChange={(e) => setEditNotes(e.target.value)}
                          placeholder="Internal configuration notes or coverage specializations (e.g. enterprise accounts, industrial sector focus)."
                          style={{
                            width: "100%",
                            padding: "0.5rem 0.75rem",
                            fontSize: "0.875rem",
                            border: "1px solid #cbd5e1",
                            borderRadius: "0.375rem",
                            resize: "vertical",
                            minHeight: "72px",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 3. Fixed Drawer Footer */}
            <div
              style={{
                flexShrink: 0,
                padding: "1rem 1.5rem",
                borderTop: "1px solid #e2e8f0",
                backgroundColor: "#f8fafc",
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: "0.75rem",
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCloseDrawer}
                disabled={drawerSaving}
                style={{
                  padding: "0.5rem 1rem",
                  fontSize: "0.875rem",
                  borderRadius: "0.375rem",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#ffffff",
                  color: "#334155",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>

              {canManage && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveConfiguration}
                  disabled={drawerSaving}
                  style={{
                    padding: "0.5rem 1.25rem",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    borderRadius: "0.375rem",
                    backgroundColor: "var(--color-primary, #2563eb)",
                    color: "#ffffff",
                    border: "none",
                    cursor: drawerSaving ? "not-allowed" : "pointer",
                  }}
                >
                  {drawerSaving ? "Saving..." : "Save Configuration"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* Bulk Action Confirmation Modal                                           */}
      {/* ========================================================================= */}
      <Modal
        open={bulkModalOpen}
        variant="center"
        onClose={() => !bulkSubmitting && setBulkModalOpen(false)}
        title={bulkTargetEligibility ? "Enable Lead Assignment for Selected Users" : "Disable Lead Assignment for Selected Users"}
      >
        <div style={{ padding: "0.5rem 0" }}>
          <p style={{ fontSize: "0.9375rem", color: "#334155", lineHeight: 1.5, margin: 0 }}>
            Are you sure you want to <strong>{bulkTargetEligibility ? "ENABLE" : "DISABLE"}</strong> lead assignment eligibility for the{" "}
            <strong>{selectedUserIds.length}</strong> selected salesperson(s)?
          </p>

          <p style={{ fontSize: "0.8125rem", color: "#64748b", marginTop: "0.75rem" }}>
            {bulkTargetEligibility
              ? "This updates eligibility configuration for future CRM lead allocation. No leads will be allocated or reassigned at this time."
              : "Disabled users will not be eligible for future automated routing. Existing leads already assigned to these users will remain unaffected."}
          </p>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "0.75rem",
              marginTop: "1.5rem",
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setBulkModalOpen(false)}
              disabled={bulkSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              onClick={handleConfirmBulk}
              disabled={bulkSubmitting}
              style={{
                backgroundColor: bulkTargetEligibility ? "#059669" : "#dc2626",
                color: "#fff",
                fontWeight: 600,
              }}
            >
              {bulkSubmitting ? "Updating..." : bulkTargetEligibility ? "Confirm Enable" : "Confirm Disable"}
            </button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
