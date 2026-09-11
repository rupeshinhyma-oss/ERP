/**
 * Platform Authorization & RBAC Management for ERP_Main Control Plane.
 *
 * Implements full platform RBAC administration:
 * - Platform Roles (create, update metadata, active status)
 * - Platform Permissions (catalog, domain grouping, definition)
 * - Role-Permission Assignment Matrix (dynamic grant & revoke)
 * - User Role Assignments (GLOBAL and ERP scoped assignments, revocation)
 * - Live Effective Platform Permissions computation
 *
 * Architectural Boundary:
 * Platform RBAC strictly governs ERP_Main control plane APIs and infrastructure.
 * Business permissions within Yinglima ERP and Inhyma ERP are authoritative locally.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { AppShell } from "@/components/AppShell";
import { SectionNavTabs } from "@/components/SectionNavTabs";
import { ACCESS_SECTION_TABS } from "@/lib/nav";
import {
  Banner,
  ConfirmDialog,
  LoadingSpinner,
  SkeletonTable,
  Modal,
  StatusBadge,
} from "@/components/ui";
import { ICONS } from "@/components/icons";
import type {
  AuthorizationScope,
  EffectivePermissions,
  ErpInstance,
  GlobalUser,
  PlatformPermission,
  PlatformRole,
  PlatformRoleAssignment,
} from "@/types";

type ActiveTab = "roles" | "permissions" | "assignments" | "matrix";

interface PlatformAuthzProps {
  defaultTab?: ActiveTab;
}

export function PlatformAuthz({ defaultTab }: PlatformAuthzProps = {}) {
  const toast = useToast();
  const location = useLocation();

  const resolveInitialTab = useCallback((): ActiveTab => {
    if (defaultTab) return defaultTab;
    if (location.pathname.includes("/permissions")) return "permissions";
    if (location.pathname.includes("/policies")) return "matrix";
    if (location.pathname.includes("/roles")) return "roles";
    return "roles";
  }, [defaultTab, location.pathname]);

  const [activeTab, setActiveTab] = useState<ActiveTab>(resolveInitialTab);

  useEffect(() => {
    setActiveTab(resolveInitialTab());
  }, [resolveInitialTab]);

  const [roles, setRoles] = useState<PlatformRole[]>([]);
  const [permissions, setPermissions] = useState<PlatformPermission[]>([]);
  const [users, setUsers] = useState<GlobalUser[]>([]);
  const [erps, setErps] = useState<ErpInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // --- TAB 1: Roles State ---
  const [createRoleModalOpen, setCreateRoleModalOpen] = useState(false);
  const [newRoleKey, setNewRoleKey] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);

  const [editRoleModalOpen, setEditRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<PlatformRole | null>(null);
  const [editRoleName, setEditRoleName] = useState("");
  const [editRoleDescription, setEditRoleDescription] = useState("");
  const [editRoleActive, setEditRoleActive] = useState(true);
  const [updatingRole, setUpdatingRole] = useState(false);

  // --- TAB 2: Permissions State ---
  const [permissionDomainFilter, setPermissionDomainFilter] = useState("ALL");
  const [permissionSearch, setPermissionSearch] = useState("");
  const [createPermModalOpen, setCreatePermModalOpen] = useState(false);
  const [newPermKey, setNewPermKey] = useState("");
  const [newPermDescription, setNewPermDescription] = useState("");
  const [creatingPerm, setCreatingPerm] = useState(false);

  // --- TAB 3: User Role Assignments State ---
  const [selectedAssignmentUserId, setSelectedAssignmentUserId] = useState("");
  const [userAssignments, setUserAssignments] = useState<PlatformRoleAssignment[]>([]);
  const [effectivePerms, setEffectivePerms] = useState<EffectivePermissions | null>(null);
  const [loadingUserAuthz, setLoadingUserAuthz] = useState(false);

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignRoleKey, setAssignRoleKey] = useState("");
  const [assignScope, setAssignScope] = useState<AuthorizationScope>("GLOBAL");
  const [assignErpId, setAssignErpId] = useState("");
  const [assigningRole, setAssigningRole] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<PlatformRoleAssignment | null>(null);
  const [revokingAssignment, setRevokingAssignment] = useState(false);

  // --- TAB 4: Role-Permission Matrix State ---
  const [matrixToggling, setMatrixToggling] = useState<string | null>(null); // "roleId:permKey"

  // Fetch all base data
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const [rolesRes, permsRes, usersRes, erpsRes] = await Promise.all([
        apiGet<PlatformRole[]>("/global/authz/roles").catch(() => []),
        apiGet<PlatformPermission[]>("/global/authz/permissions").catch(() => []),
        apiGet<GlobalUser[]>("/global/users?limit=500&offset=0").catch(() => []),
        apiGet<ErpInstance[]>("/global/erps").catch(() => []),
      ]);

      const roleList = Array.isArray(rolesRes) ? rolesRes : ((rolesRes as any)?.data || []);
      const permList = Array.isArray(permsRes) ? permsRes : ((permsRes as any)?.data || []);
      const userList = Array.isArray(usersRes) ? usersRes : ((usersRes as any)?.data || []);
      const erpList = Array.isArray(erpsRes) ? erpsRes : ((erpsRes as any)?.data || []);

      setRoles(roleList);
      setPermissions(permList);
      setUsers(userList);
      setErps(erpList.filter((e: ErpInstance) => e.status !== "DECOMMISSIONED"));

      // Set initial user for assignments if none selected
      if (!selectedAssignmentUserId && userList.length > 0) {
        setSelectedAssignmentUserId(userList[0].id);
      }
    } catch (err) {
      setError(err);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [selectedAssignmentUserId]);

  useEffect(() => {
    fetchData();

    // Revalidate when user returns to this tab without background periodic polling
    const handleFocus = () => {
      fetchData(true);
    };
    window.addEventListener("focus", handleFocus);

    return () => window.removeEventListener("focus", handleFocus);
  }, [fetchData]);

  // Fetch specific user authorization details when selectedAssignmentUserId changes
  const fetchUserAuthzDetails = useCallback(async (userId: string) => {
    if (!userId) return;
    setLoadingUserAuthz(true);
    try {
      const [assignmentsRes, effectiveRes] = await Promise.all([
        apiGet<PlatformRoleAssignment[]>(`/global/authz/users/${userId}/roles`).catch(() => []),
        apiGet<EffectivePermissions>(`/global/authz/users/${userId}/effective-permissions`).catch(() => null),
      ]);

      const aList = Array.isArray(assignmentsRes) ? assignmentsRes : ((assignmentsRes as any)?.data || []);
      const ePerms = (effectiveRes as any)?.data ?? effectiveRes;

      setUserAssignments(aList);
      setEffectivePerms(ePerms || null);
    } catch (err) {
      toast("Failed to load user role details: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setLoadingUserAuthz(false);
    }
  }, [toast]);

  useEffect(() => {
    if (selectedAssignmentUserId) {
      fetchUserAuthzDetails(selectedAssignmentUserId);
    }
  }, [selectedAssignmentUserId, fetchUserAuthzDetails]);

  // --- TAB 1 Actions: Create & Edit Roles ---
  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = newRoleKey.trim().toUpperCase();
    if (!cleanKey || !newRoleName.trim()) {
      toast("Role Key and Display Name are required.", "warning");
      return;
    }
    setCreatingRole(true);
    try {
      await apiPost("/global/authz/roles", {
        role_key: cleanKey,
        display_name: newRoleName.trim(),
        description: newRoleDescription.trim() || null,
      });
      toast(`Role ${cleanKey} created successfully.`, "success");
      setCreateRoleModalOpen(false);
      setNewRoleKey("");
      setNewRoleName("");
      setNewRoleDescription("");
      await fetchData();
    } catch (err) {
      toast("Failed to create role: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setCreatingRole(false);
    }
  };

  const handleOpenEditRole = (role: PlatformRole) => {
    setEditingRole(role);
    setEditRoleName(role.display_name);
    setEditRoleDescription(role.description || "");
    setEditRoleActive(role.is_active);
    setEditRoleModalOpen(true);
  };

  const handleUpdateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRole) return;
    setUpdatingRole(true);
    try {
      await apiPatch(`/global/authz/roles/${editingRole.id}`, {
        display_name: editRoleName.trim(),
        description: editRoleDescription.trim() || null,
        is_active: editRoleActive,
      });
      toast(`Role ${editingRole.role_key} updated.`, "success");
      setEditRoleModalOpen(false);
      setEditingRole(null);
      await fetchData();
    } catch (err) {
      toast("Failed to update role: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setUpdatingRole(false);
    }
  };

  // --- TAB 2 Actions: Define Permission ---
  const handleCreatePermission = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = newPermKey.trim().toLowerCase();
    if (!cleanKey) {
      toast("Permission Key is required.", "warning");
      return;
    }
    setCreatingPerm(true);
    try {
      await apiPost("/global/authz/permissions", {
        permission_key: cleanKey,
        description: newPermDescription.trim() || null,
      });
      toast(`Permission ${cleanKey} defined successfully.`, "success");
      setCreatePermModalOpen(false);
      setNewPermKey("");
      setNewPermDescription("");
      await fetchData();
    } catch (err) {
      toast("Failed to define permission: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setCreatingPerm(false);
    }
  };

  // Domain categorization helper
  const getPermissionDomain = (key: string): string => {
    const parts = key.split(".");
    if (parts.length >= 2) {
      const sub = parts[1];
      switch (sub) {
        case "erp":
          return "ERP Registry";
        case "users":
        case "identity":
          return "Identity & Users";
        case "conflicts":
          return "Identity Conflicts";
        case "system":
        case "authz":
          return "Platform Governance";
        case "audit":
          return "Global Audit";
        case "integration":
          return "Integration Outbox";
        case "reporting":
          return "Cross-ERP Reports";
        default:
          return sub.toUpperCase();
      }
    }
    return "Core";
  };

  const domains = useMemo(() => {
    const set = new Set<string>();
    permissions.forEach((p) => set.add(getPermissionDomain(p.permission_key)));
    return Array.from(set).sort();
  }, [permissions]);

  const filteredPermissions = useMemo(() => {
    return permissions.filter((p) => {
      const domain = getPermissionDomain(p.permission_key);
      if (permissionDomainFilter !== "ALL" && domain !== permissionDomainFilter) {
        return false;
      }
      if (permissionSearch.trim()) {
        const q = permissionSearch.toLowerCase();
        return (
          p.permission_key.toLowerCase().includes(q) ||
          (p.description || "").toLowerCase().includes(q) ||
          domain.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [permissions, permissionDomainFilter, permissionSearch]);

  // --- TAB 3 Actions: Assign & Revoke Roles ---
  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssignmentUserId || !assignRoleKey) {
      toast("Please select a role.", "warning");
      return;
    }
    if (assignScope === "ERP" && !assignErpId) {
      toast("Please select a target ERP instance for ERP-scoped role.", "warning");
      return;
    }

    setAssigningRole(true);
    try {
      await apiPost(`/global/authz/users/${selectedAssignmentUserId}/roles`, {
        role_key: assignRoleKey,
        scope: assignScope,
        erp_instance_id: assignScope === "ERP" ? assignErpId : null,
      });
      toast("Platform role assigned successfully.", "success");
      setAssignModalOpen(false);
      setAssignRoleKey("");
      setAssignScope("GLOBAL");
      setAssignErpId("");
      await fetchUserAuthzDetails(selectedAssignmentUserId);
    } catch (err) {
      toast("Failed to assign role: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setAssigningRole(false);
    }
  };

  const handleRevokeAssignment = async () => {
    if (!revokeTarget) return;
    setRevokingAssignment(true);
    try {
      await apiPost(`/global/authz/assignments/${revokeTarget.id}/revoke`);
      toast(`Assignment for ${revokeTarget.role_key} revoked.`, "info");
      setRevokeTarget(null);
      if (selectedAssignmentUserId) {
        await fetchUserAuthzDetails(selectedAssignmentUserId);
      }
    } catch (err) {
      toast("Failed to revoke assignment: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setRevokingAssignment(false);
    }
  };

  // --- TAB 4 Actions: Matrix Grant / Revoke ---
  const handleToggleMatrixPermission = async (role: PlatformRole, permKey: string) => {
    const hasPerm = (role.permission_keys || []).includes(permKey);
    const keyId = `${role.id}:${permKey}`;
    setMatrixToggling(keyId);

    try {
      if (hasPerm) {
        // Revoke
        await apiDelete(`/global/authz/roles/${role.id}/permissions/${encodeURIComponent(permKey)}`);
        toast(`Revoked ${permKey} from ${role.role_key}.`, "info");
      } else {
        // Grant
        await apiPost(`/global/authz/roles/${role.id}/permissions`, {
          permission_key: permKey,
        });
        toast(`Granted ${permKey} to ${role.role_key}.`, "success");
      }
      // Optimistic update
      setRoles((prev) =>
        prev.map((r) => {
          if (r.id !== role.id) return r;
          const updatedKeys = hasPerm
            ? r.permission_keys.filter((k) => k !== permKey)
            : [...r.permission_keys, permKey];
          return { ...r, permission_keys: updatedKeys };
        })
      );
    } catch (err) {
      toast("Failed to update role permission: " + (err instanceof Error ? err.message : String(err)), "error");
      await fetchData();
    } finally {
      setMatrixToggling(null);
    }
  };

  const selectedUser = useMemo(() => {
    return users.find((u) => u.id === selectedAssignmentUserId);
  }, [users, selectedAssignmentUserId]);

  const getErpName = (id?: string | null) => {
    if (!id) return "N/A";
    const found = erps.find((e) => e.id === id);
    return found ? found.name : id;
  };

  const sectionActiveKey = useMemo(() => {
    if (activeTab === "permissions") return "permissions";
    if (activeTab === "matrix") return "access-policies";
    return "roles";
  }, [activeTab]);

  const pageTitle = useMemo(() => {
    if (activeTab === "permissions") return "Platform Permissions";
    if (activeTab === "matrix") return "Platform Access Policies";
    if (activeTab === "assignments") return "User Role Assignments";
    return "Platform Roles";
  }, [activeTab]);

  return (
    <AppShell
      activeKey={sectionActiveKey}
      pageTitle={pageTitle}
      breadcrumbs={["Users & Access", pageTitle]}
      actions={
        <div style={{ display: "flex", gap: "8px" }}>
          {activeTab === "roles" && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setCreateRoleModalOpen(true)}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <ICONS.plus width={14} height={14} />
              Create Role
            </button>
          )}
          {activeTab === "permissions" && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setCreatePermModalOpen(true)}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <ICONS.plus width={14} height={14} />
              Define Permission
            </button>
          )}
          {activeTab === "assignments" && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setAssignModalOpen(true)}
              disabled={!selectedAssignmentUserId}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <ICONS.plus width={14} height={14} />
              Assign Role
            </button>
          )}
        </div>
      }
    >
      <SectionNavTabs items={ACCESS_SECTION_TABS} activeKey={sectionActiveKey} />

      <Banner error={error} />

      {/* Architectural Callout */}
      <div
        className="card"
        style={{
          marginBottom: "20px",
          padding: "16px 20px",
          background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
          border: "1px solid var(--color-border)",
          borderLeft: "4px solid var(--color-primary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              backgroundColor: "rgba(14, 116, 144, 0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-primary)",
              flexShrink: 0,
            }}
          >
            <ICONS.shield width={20} height={20} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-text)", marginBottom: "4px" }}>
              Control Plane Authorization (Platform RBAC) vs. ERP Local RBAC
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.55 }}>
              Platform Roles and Permissions govern operations inside <strong>ERP_Main</strong> (e.g. ERP registry,
              global user lifecycle, cross-ERP routing, audit logs, and conflict resolution). They do{" "}
              <strong>not</strong> govern business domain permissions inside Yinglima or Inhyma ERP (e.g. quote
              creation, warehouse stock moves, customer invoices), which are evaluated autonomously by local ERP engines.
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Bar */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--color-border)",
          marginBottom: "20px",
          gap: "8px",
        }}
      >
        <button
          type="button"
          className="btn"
          style={{
            background: "none",
            border: "none",
            borderRadius: 0,
            borderBottom: activeTab === "roles" ? "2px solid var(--color-primary)" : "2px solid transparent",
            color: activeTab === "roles" ? "var(--color-primary)" : "var(--color-text-secondary)",
            fontWeight: activeTab === "roles" ? 700 : 500,
            padding: "10px 16px",
            fontSize: "14px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
          onClick={() => setActiveTab("roles")}
        >
          <ICONS.shield width={16} height={16} />
          Platform Roles ({roles.length})
        </button>

        <button
          type="button"
          className="btn"
          style={{
            background: "none",
            border: "none",
            borderRadius: 0,
            borderBottom: activeTab === "permissions" ? "2px solid var(--color-primary)" : "2px solid transparent",
            color: activeTab === "permissions" ? "var(--color-primary)" : "var(--color-text-secondary)",
            fontWeight: activeTab === "permissions" ? 700 : 500,
            padding: "10px 16px",
            fontSize: "14px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
          onClick={() => setActiveTab("permissions")}
        >
          <ICONS.key width={16} height={16} />
          Platform Permissions ({permissions.length})
        </button>

        <button
          type="button"
          className="btn"
          style={{
            background: "none",
            border: "none",
            borderRadius: 0,
            borderBottom: activeTab === "assignments" ? "2px solid var(--color-primary)" : "2px solid transparent",
            color: activeTab === "assignments" ? "var(--color-primary)" : "var(--color-text-secondary)",
            fontWeight: activeTab === "assignments" ? 700 : 500,
            padding: "10px 16px",
            fontSize: "14px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
          onClick={() => setActiveTab("assignments")}
        >
          <ICONS.user width={16} height={16} />
          User Role Assignments
        </button>

        <button
          type="button"
          className="btn"
          style={{
            background: "none",
            border: "none",
            borderRadius: 0,
            borderBottom: activeTab === "matrix" ? "2px solid var(--color-primary)" : "2px solid transparent",
            color: activeTab === "matrix" ? "var(--color-primary)" : "var(--color-text-secondary)",
            fontWeight: activeTab === "matrix" ? 700 : 500,
            padding: "10px 16px",
            fontSize: "14px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
          onClick={() => setActiveTab("matrix")}
        >
          <ICONS.check width={16} height={16} />
          Role-Permission Matrix
        </button>
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : (
        <>
          {/* ========================================================================= */}
          {/* TAB 1: Platform Roles                                                     */}
          {/* ========================================================================= */}
          {activeTab === "roles" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
                  gap: "18px",
                }}
              >
                {roles.map((role) => (
                  <div
                    key={role.id}
                    className="card"
                    style={{
                      padding: "20px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      borderTop: `4px solid ${role.is_active ? "var(--color-primary)" : "var(--color-muted)"}`,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          marginBottom: "8px",
                        }}
                      >
                        <div>
                          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "var(--color-text)" }}>
                            {role.display_name}
                          </h3>
                          <span
                            className="badge"
                            style={{
                              backgroundColor: "#e0f2fe",
                              color: "#0369a1",
                              fontFamily: "monospace",
                              fontSize: "11px",
                              marginTop: "4px",
                            }}
                          >
                            {role.role_key}
                          </span>
                        </div>
                        <StatusBadge isActive={role.is_active} />
                      </div>

                      <p
                        style={{
                          margin: "12px 0 16px",
                          fontSize: "13px",
                          color: "var(--color-text-secondary)",
                          lineHeight: 1.5,
                          minHeight: "40px",
                        }}
                      >
                        {role.description || "No description provided."}
                      </p>

                      <div style={{ marginBottom: "16px" }}>
                        <div
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color: "var(--color-muted)",
                            textTransform: "uppercase",
                            marginBottom: "8px",
                          }}
                        >
                          Granted Permissions ({role.permission_keys?.length || 0})
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", maxHeight: "110px", overflowY: "auto" }}>
                          {(role.permission_keys || []).length === 0 ? (
                            <span style={{ fontSize: "12px", color: "var(--color-muted)", fontStyle: "italic" }}>
                              No permissions granted yet.
                            </span>
                          ) : (
                            role.permission_keys.map((pKey) => (
                              <span
                                key={pKey}
                                style={{
                                  fontFamily: "monospace",
                                  fontSize: "11px",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  backgroundColor: "#f1f5f9",
                                  color: "var(--color-text)",
                                  border: "1px solid #e2e8f0",
                                }}
                              >
                                {pKey}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        paddingTop: "14px",
                        borderTop: "1px solid var(--color-border)",
                      }}
                    >
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleOpenEditRole(role)}
                      >
                        Edit Role
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        style={{ color: "var(--color-primary)", borderColor: "var(--color-primary)" }}
                        onClick={() => setActiveTab("matrix")}
                      >
                        Manage Permissions ➔
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: Platform Permissions Catalog                                       */}
          {/* ========================================================================= */}
          {activeTab === "permissions" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Filter / Search Bar */}
              <div
                className="card"
                style={{
                  padding: "16px 20px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", flex: 1 }}>
                  <div style={{ position: "relative", minWidth: "260px" }}>
                    <input
                      type="text"
                      className="form-input"
                      style={{ paddingLeft: "34px", height: "36px", fontSize: "13px" }}
                      placeholder="Search permission key or description..."
                      value={permissionSearch}
                      onChange={(e) => setPermissionSearch(e.target.value)}
                    />
                    <div
                      style={{
                        position: "absolute",
                        left: "10px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "var(--color-muted)",
                      }}
                    >
                      <ICONS.search width={14} height={14} />
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-secondary)" }}>
                      Domain:
                    </span>
                    <select
                      className="form-select"
                      style={{ width: "auto", height: "36px", fontSize: "13px" }}
                      value={permissionDomainFilter}
                      onChange={(e) => setPermissionDomainFilter(e.target.value)}
                    >
                      <option value="ALL">All Domains ({permissions.length})</option>
                      {domains.map((dom) => (
                        <option key={dom} value={dom}>
                          {dom}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ fontSize: "13px", color: "var(--color-muted)" }}>
                  Showing <strong>{filteredPermissions.length}</strong> of <strong>{permissions.length}</strong> permissions
                </div>
              </div>

              {/* Permissions Table */}
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Permission Key</th>
                        <th>Functional Domain</th>
                        <th>Description</th>
                        <th>Defined At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPermissions.map((perm) => (
                        <tr key={perm.id}>
                          <td>
                            <code
                              style={{
                                fontFamily: "monospace",
                                fontSize: "12px",
                                fontWeight: 700,
                                color: "var(--color-primary)",
                                backgroundColor: "#f0fdf4",
                                border: "1px solid #bbf7d0",
                                padding: "3px 7px",
                                borderRadius: "4px",
                              }}
                            >
                              {perm.permission_key}
                            </code>
                          </td>
                          <td>
                            <span
                              className="badge"
                              style={{
                                backgroundColor: "#f1f5f9",
                                color: "var(--color-text)",
                                fontWeight: 600,
                                fontSize: "11px",
                              }}
                            >
                              {getPermissionDomain(perm.permission_key)}
                            </span>
                          </td>
                          <td style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                            {perm.description || "No description provided."}
                          </td>
                          <td style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                            {new Date(perm.created_at).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 3: User Role Assignments                                              */}
          {/* ========================================================================= */}
          {activeTab === "assignments" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* User Selection Card */}
              <div className="card" style={{ padding: "18px 22px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: "260px" }}>
                    <label className="form-label" htmlFor="authz-user-select" style={{ marginBottom: "6px" }}>
                      Select Global User Identity to Inspect & Assign Platform Roles:
                    </label>
                    <select
                      id="authz-user-select"
                      className="form-select"
                      value={selectedAssignmentUserId}
                      onChange={(e) => setSelectedAssignmentUserId(e.target.value)}
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.display_name} &mdash; {u.primary_email || u.email} ({u.status})
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedUser && (
                    <div style={{ display: "flex", gap: "10px", alignItems: "center", paddingTop: "18px" }}>
                      <StatusBadge status={selectedUser.status} />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => setAssignModalOpen(true)}
                        style={{ display: "flex", alignItems: "center", gap: "6px" }}
                      >
                        <ICONS.plus width={14} height={14} />
                        Assign Role
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {loadingUserAuthz ? (
                <LoadingSpinner text="Loading role assignments and effective permissions..." />
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
                  {/* Active & Revoked Role Assignments */}
                  <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                    <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border)" }}>
                      <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "var(--color-text)" }}>
                        Assigned Platform Roles for {selectedUser?.display_name}
                      </h3>
                      <div style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "2px" }}>
                        Roles can be scoped globally (all platform services) or restricted to a specific ERP instance.
                      </div>
                    </div>

                    {userAssignments.length === 0 ? (
                      <div style={{ padding: "32px", textAlign: "center", color: "var(--color-muted)" }}>
                        No platform roles assigned to this user.
                      </div>
                    ) : (
                      <div className="table-wrap">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Role Key</th>
                              <th>Scope</th>
                              <th>Target ERP</th>
                              <th>Status</th>
                              <th>Assigned Date</th>
                              <th style={{ textAlign: "right" }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {userAssignments.map((a) => (
                              <tr key={a.id}>
                                <td>
                                  <span
                                    className="badge"
                                    style={{
                                      backgroundColor: "#e0f2fe",
                                      color: "#0369a1",
                                      fontFamily: "monospace",
                                      fontSize: "12px",
                                    }}
                                  >
                                    {a.role_key}
                                  </span>
                                </td>
                                <td>
                                  <span
                                    className="badge"
                                    style={{
                                      backgroundColor: a.scope === "GLOBAL" ? "#fef3c7" : "#f1f5f9",
                                      color: a.scope === "GLOBAL" ? "#b45309" : "var(--color-text)",
                                      fontSize: "11px",
                                    }}
                                  >
                                    {a.scope}
                                  </span>
                                </td>
                                <td>
                                  {a.erp_instance_id ? (
                                    <span style={{ fontWeight: 600, color: "var(--color-text)" }}>
                                      {getErpName(a.erp_instance_id)}
                                    </span>
                                  ) : (
                                    <span style={{ color: "var(--color-muted)" }}>All ERPs (Global)</span>
                                  )}
                                </td>
                                <td>
                                  <StatusBadge
                                    status={a.is_active ? "ACTIVE" : "REVOKED"}
                                    isActive={a.is_active}
                                  />
                                </td>
                                <td style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                                  {new Date(a.created_at).toLocaleDateString()}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  {a.is_active && (
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline"
                                      style={{ color: "var(--color-danger)", borderColor: "#fecaca" }}
                                      onClick={() => setRevokeTarget(a)}
                                    >
                                      Revoke
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Computed Effective Platform Permissions */}
                  <div className="card" style={{ padding: "20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                      <ICONS.shield width={18} height={18} style={{ color: "var(--color-success)" }} />
                      <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "var(--color-text)" }}>
                        Live Computed Effective Permissions
                      </h3>
                    </div>
                    <p style={{ margin: "0 0 16px", fontSize: "12px", color: "var(--color-text-secondary)" }}>
                      Aggregated union of all active role grants held by this identity across the control plane.
                    </p>

                    {/* Global Scope */}
                    <div style={{ marginBottom: "16px" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text)", marginBottom: "8px" }}>
                        Global Permissions (Platform-wide):
                      </div>
                      {(effectivePerms?.global_permissions || []).length === 0 ? (
                        <div style={{ fontSize: "12px", color: "var(--color-muted)", fontStyle: "italic" }}>
                          No global permissions held.
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {effectivePerms?.global_permissions.map((p) => (
                            <code
                              key={p}
                              style={{
                                fontFamily: "monospace",
                                fontSize: "11px",
                                backgroundColor: "#f0fdf4",
                                color: "#15803d",
                                border: "1px solid #bbf7d0",
                                padding: "3px 8px",
                                borderRadius: "4px",
                              }}
                            >
                              {p}
                            </code>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ERP-Scoped */}
                    {effectivePerms?.erp_permissions && Object.keys(effectivePerms.erp_permissions).length > 0 && (
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text)", marginBottom: "8px" }}>
                          ERP-Scoped Permissions:
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                          {Object.entries(effectivePerms.erp_permissions).map(([erpId, permList]) => (
                            <div
                              key={erpId}
                              style={{
                                padding: "10px 14px",
                                backgroundColor: "#f8fafc",
                                border: "1px solid #e2e8f0",
                                borderRadius: "6px",
                              }}
                            >
                              <div style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-primary)", marginBottom: "6px" }}>
                                {getErpName(erpId)}:
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                {permList.map((p) => (
                                  <code
                                    key={p}
                                    style={{
                                      fontFamily: "monospace",
                                      fontSize: "11px",
                                      backgroundColor: "#ffffff",
                                      color: "var(--color-text)",
                                      border: "1px solid #cbd5e1",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                    }}
                                  >
                                    {p}
                                  </code>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 4: Role-Permission Matrix                                             */}
          {/* ========================================================================= */}
          {activeTab === "matrix" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div
                className="card"
                style={{
                  padding: "14px 18px",
                  backgroundColor: "#f8fafc",
                  fontSize: "13px",
                  color: "var(--color-text-secondary)",
                }}
              >
                Click any checkbox to grant or revoke that platform permission from a role. Changes are audited and
                take effect immediately on the control plane.
              </div>

              <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                <table className="table" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ minWidth: "260px" }}>Permission Key / Domain</th>
                      {roles.map((role) => (
                        <th key={role.id} style={{ textAlign: "center", minWidth: "140px" }}>
                          <div style={{ fontWeight: 700, color: "var(--color-text)" }}>{role.display_name}</div>
                          <div style={{ fontSize: "11px", color: "var(--color-muted)", fontFamily: "monospace" }}>
                            {role.role_key}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {permissions.map((perm) => (
                      <tr key={perm.id}>
                        <td>
                          <div style={{ fontFamily: "monospace", fontSize: "12px", fontWeight: 700, color: "var(--color-primary)" }}>
                            {perm.permission_key}
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--color-muted)", marginTop: "2px" }}>
                            {perm.description || getPermissionDomain(perm.permission_key)}
                          </div>
                        </td>
                        {roles.map((role) => {
                          const hasPerm = (role.permission_keys || []).includes(perm.permission_key);
                          const isToggling = matrixToggling === `${role.id}:${perm.permission_key}`;

                          return (
                            <td key={role.id} style={{ textAlign: "center" }}>
                              <label
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  cursor: isToggling ? "wait" : "pointer",
                                  padding: "6px",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={hasPerm}
                                  disabled={isToggling}
                                  onChange={() => handleToggleMatrixPermission(role, perm.permission_key)}
                                  style={{
                                    width: "18px",
                                    height: "18px",
                                    cursor: isToggling ? "wait" : "pointer",
                                    accentColor: "var(--color-primary)",
                                  }}
                                />
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ========================================================================= */}
      {/* MODALS                                                                    */}
      {/* ========================================================================= */}

      {/* Create Role Modal */}
      <Modal
        open={createRoleModalOpen}
        onClose={() => setCreateRoleModalOpen(false)}
        title="Create Platform Role"
        variant="center"
        cardStyle={{ maxWidth: "500px" }}
      >
        <form onSubmit={handleCreateRole} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="form-group">
            <label className="form-label" htmlFor="new-role-key">
              Role Key (UPPERCASE_SNAKE_CASE) *
            </label>
            <input
              id="new-role-key"
              type="text"
              className="form-input"
              placeholder="e.g. AUDITOR, SECURITY_ADMIN"
              value={newRoleKey}
              onChange={(e) => setNewRoleKey(e.target.value.toUpperCase())}
              required
            />
            <span className="form-helper">
              Unique identifier used in access evaluations and API policies.
            </span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="new-role-name">
              Display Name *
            </label>
            <input
              id="new-role-name"
              type="text"
              className="form-input"
              placeholder="e.g. Compliance Auditor"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="new-role-desc">
              Description
            </label>
            <textarea
              id="new-role-desc"
              className="form-input"
              rows={3}
              placeholder="Describe the operational responsibilities of this role..."
              value={newRoleDescription}
              onChange={(e) => setNewRoleDescription(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCreateRoleModalOpen(false)}
              disabled={creatingRole}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={creatingRole}>
              {creatingRole ? "Creating..." : "Create Role"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Role Modal */}
      <Modal
        open={editRoleModalOpen}
        onClose={() => setEditRoleModalOpen(false)}
        title={`Edit Role: ${editingRole?.role_key || ""}`}
        variant="center"
        cardStyle={{ maxWidth: "500px" }}
      >
        <form onSubmit={handleUpdateRole} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="form-group">
            <label className="form-label" htmlFor="edit-role-name">
              Display Name *
            </label>
            <input
              id="edit-role-name"
              type="text"
              className="form-input"
              value={editRoleName}
              onChange={(e) => setEditRoleName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="edit-role-desc">
              Description
            </label>
            <textarea
              id="edit-role-desc"
              className="form-input"
              rows={3}
              value={editRoleDescription}
              onChange={(e) => setEditRoleDescription(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
            <input
              id="edit-role-active"
              type="checkbox"
              checked={editRoleActive}
              onChange={(e) => setEditRoleActive(e.target.checked)}
              style={{ width: "16px", height: "16px", accentColor: "var(--color-primary)" }}
            />
            <label htmlFor="edit-role-active" style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text)", cursor: "pointer" }}>
              Active (Role can be assigned and held by users)
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setEditRoleModalOpen(false)}
              disabled={updatingRole}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={updatingRole}>
              {updatingRole ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Define Permission Modal */}
      <Modal
        open={createPermModalOpen}
        onClose={() => setCreatePermModalOpen(false)}
        title="Define Platform Permission"
        variant="center"
        cardStyle={{ maxWidth: "500px" }}
      >
        <form onSubmit={handleCreatePermission} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="form-group">
            <label className="form-label" htmlFor="new-perm-key">
              Permission Key (lowercase.dot.delimited) *
            </label>
            <input
              id="new-perm-key"
              type="text"
              className="form-input"
              placeholder="e.g. platform.security.scan"
              value={newPermKey}
              onChange={(e) => setNewPermKey(e.target.value.toLowerCase())}
              required
            />
            <span className="form-helper">
              Must start with a letter and contain only lowercase letters, digits, and dots.
            </span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="new-perm-desc">
              Description
            </label>
            <textarea
              id="new-perm-desc"
              className="form-input"
              rows={3}
              placeholder="Describe the exact action this permission authorizes..."
              value={newPermDescription}
              onChange={(e) => setNewPermDescription(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCreatePermModalOpen(false)}
              disabled={creatingPerm}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={creatingPerm}>
              {creatingPerm ? "Defining..." : "Define Permission"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Assign Role Modal */}
      <Modal
        open={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        title={`Assign Platform Role to ${selectedUser?.display_name || "User"}`}
        variant="center"
        cardStyle={{ maxWidth: "520px" }}
      >
        <form onSubmit={handleAssignRole} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="form-group">
            <label className="form-label" htmlFor="assign-role-select">
              Platform Role *
            </label>
            <select
              id="assign-role-select"
              className="form-select"
              value={assignRoleKey}
              onChange={(e) => setAssignRoleKey(e.target.value)}
              required
            >
              <option value="">-- Select Platform Role --</option>
              {roles
                .filter((r) => r.is_active)
                .map((r) => (
                  <option key={r.id} value={r.role_key}>
                    {r.display_name} ({r.role_key})
                  </option>
                ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Authorization Scope *</label>
            <div style={{ display: "flex", gap: "20px", marginTop: "4px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="assign-scope"
                  value="GLOBAL"
                  checked={assignScope === "GLOBAL"}
                  onChange={() => setAssignScope("GLOBAL")}
                />
                <span style={{ fontSize: "13px", fontWeight: 600 }}>Global (All Platform Operations)</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="assign-scope"
                  value="ERP"
                  checked={assignScope === "ERP"}
                  onChange={() => setAssignScope("ERP")}
                />
                <span style={{ fontSize: "13px", fontWeight: 600 }}>ERP-Scoped (Target ERP Only)</span>
              </label>
            </div>
          </div>

          {assignScope === "ERP" && (
            <div className="form-group">
              <label className="form-label" htmlFor="assign-erp-select">
                Target ERP Instance *
              </label>
              <select
                id="assign-erp-select"
                className="form-select"
                value={assignErpId}
                onChange={(e) => setAssignErpId(e.target.value)}
                required={assignScope === "ERP"}
              >
                <option value="">-- Select Target ERP --</option>
                {erps.map((erp) => (
                  <option key={erp.id} value={erp.id}>
                    {erp.name} ({erp.erp_key})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setAssignModalOpen(false)}
              disabled={assigningRole}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={assigningRole}>
              {assigningRole ? "Assigning..." : "Assign Role"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Revoke Assignment Confirmation */}
      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title="Revoke Platform Role Assignment"
        message={
          <span>
            Are you sure you want to revoke the role <strong>{revokeTarget?.role_key}</strong> from{" "}
            <strong>{selectedUser?.display_name}</strong>?
            <br />
            <br />
            The user will immediately lose any platform permissions granted through this assignment.
            Audit logs will retain this assignment record for compliance.
          </span>
        }
        confirmLabel="Revoke Role Assignment"
        danger
        loading={revokingAssignment}
        onConfirm={handleRevokeAssignment}
        onCancel={() => setRevokeTarget(null)}
      />
    </AppShell>
  );
}
