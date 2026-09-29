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
import { apiDelete, apiGet, apiPatch, apiPost, ApiError, errorMessage } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { AppShell } from "@/components/AppShell";
import { SectionNavTabs } from "@/components/SectionNavTabs";
import { ACCESS_SECTION_TABS } from "@/lib/nav";
import {
  Banner,
  SkeletonTable,
  Modal,
  StatusBadge,
  ConfirmDialog,
} from "@/components/ui";
import { ICONS } from "@/components/icons";
import type {
  PlatformPermission,
  PlatformRole,
} from "@/types";

export function PlatformAuthz() {
  const toast = useToast();

  const [roles, setRoles] = useState<PlatformRole[]>([]);
  const [permissions, setPermissions] = useState<PlatformPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // --- TAB 1: Roles State ---
  const [createRoleModalOpen, setCreateRoleModalOpen] = useState(false);
  const [newRoleKey, setNewRoleKey] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);

  const [editRoleModalOpen, setEditRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<PlatformRole | null>(null);
  const [editRoleName, setEditRoleName] = useState("");
  const [editRoleActive, setEditRoleActive] = useState(true);
  const [updatingRole, setUpdatingRole] = useState(false);

  // Role deletion state
  const [deletingRoleTarget, setDeletingRoleTarget] = useState<PlatformRole | null>(null);
  const [deletingRoleLoading, setDeletingRoleLoading] = useState(false);

  // Role Access Policy Modal State
  const [managePolicyRole, setManagePolicyRole] = useState<PlatformRole | null>(null);
  const [policySearch, setPolicySearch] = useState("");
  const [policyDomainFilter, setPolicyDomainFilter] = useState("ALL");

  const [permissionToggling, setPermissionToggling] = useState<string | null>(null); // "roleId:permKey"
  const [roleSearch, setRoleSearch] = useState("");

  // Fetch all base data
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        apiGet<PlatformRole[]>("/global/authz/roles").catch(() => []),
        apiGet<PlatformPermission[]>("/global/authz/permissions").catch(() => []),
      ]);

      const roleList = Array.isArray(rolesRes) ? rolesRes : ((rolesRes as any)?.data || []);
      const permList = Array.isArray(permsRes) ? permsRes : ((permsRes as any)?.data || []);

      setRoles(roleList);
      setPermissions(permList);
    } catch (err) {
      setError(err);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Revalidate when user returns to this tab without background periodic polling
    const handleFocus = () => {
      fetchData(true);
    };
    window.addEventListener("focus", handleFocus);

    return () => window.removeEventListener("focus", handleFocus);
  }, [fetchData]);

  // Helper to identify fixed system roles (Admin is the fixed platform administrative role)
  const isFixedRole = (role: PlatformRole | null) => {
    if (!role) return false;
    const k = (role.role_key || "").toUpperCase();
    return k === "PLATFORM_ADMIN" || k === "ADMIN";
  };

  // --- TAB 1 Actions: Create & Edit Roles ---
  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = newRoleKey.trim().toUpperCase();
    if (!cleanKey || !newRoleName.trim()) {
      toast("Role Key and Display Name are required.", "warning");
      return;
    }
    if (
      cleanKey === "PLATFORM_SUPER_ADMIN" ||
      cleanKey === "SUPER_ADMIN" ||
      cleanKey === "PLATFORM_ADMIN" ||
      cleanKey === "ADMIN"
    ) {
      toast("Admin and Super Admin are reserved platform administrative identities and cannot be created as custom RBAC roles.", "warning");
      return;
    }
    setCreatingRole(true);
    try {
      await apiPost("/global/authz/roles", {
        role_key: cleanKey,
        display_name: newRoleName.trim(),
      });
      toast(`Role ${cleanKey} created successfully.`, "success");
      setCreateRoleModalOpen(false);
      setNewRoleKey("");
      setNewRoleName("");
      await fetchData();
    } catch (err) {
      // Surface the real cause plainly: which HTTP status came back
      // (409 = this role_key already exists, 403 = missing permission,
      // 401 = session expired, anything else = unexpected/network) so
      // "nothing happened" is never the only signal the user gets.
      const status = err instanceof ApiError ? err.status : undefined;
      const detail = errorMessage(err, "An unexpected error occurred.");
      const prefix =
        status === 409
          ? `A role with key "${cleanKey}" already exists.`
          : status === 403
            ? "You don't have permission to create platform roles."
            : status === 401
              ? "Your session has expired. Please sign in again."
              : "Failed to create role.";
      toast(`${prefix} (${detail})`, "error", 6000);
      // eslint-disable-next-line no-console
      console.error("Create Role failed:", { status, cleanKey, err });
    } finally {
      setCreatingRole(false);
    }
  };

  const handleOpenEditRole = (role: PlatformRole) => {
    setEditingRole(role);
    setEditRoleName(role.display_name);
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
        is_active: isFixedRole(editingRole) ? true : editRoleActive,
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

  const handleDeleteRole = async () => {
    if (!deletingRoleTarget || isFixedRole(deletingRoleTarget)) return;
    setDeletingRoleLoading(true);
    try {
      await apiDelete(`/global/authz/roles/${deletingRoleTarget.id}`);
      toast(`Role ${deletingRoleTarget.display_name} (${deletingRoleTarget.role_key}) deleted successfully.`, "info");
      setDeletingRoleTarget(null);
      await fetchData(true);
    } catch (err) {
      toast("Failed to delete role: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setDeletingRoleLoading(false);
    }
  };

  // Domain categorization helper
  // Domain categorization helper
  const getPermissionDomain = (key: string): string => {
    const k = key.toLowerCase();
    if (k.startsWith("platform.audit")) return "Audit & Security";
    if (k.startsWith("platform.user")) return "Global Users & Identity";
    const parts = key.split(".");
    if (parts.length >= 2) {
      const sub = parts[1].toLowerCase();
      return sub.charAt(0).toUpperCase() + sub.slice(1);
    }
    return "Core Platform";
  };

  // Only permissions for active dashboard modules are exposed for platform role assignment
  const activePermissions = useMemo(() => {
    return permissions.filter((p) => {
      const k = (p.permission_key || "").toLowerCase();
      return k.startsWith("platform.audit.") || k.startsWith("platform.user.");
    });
  }, [permissions]);

  const domains = useMemo(() => {
    const set = new Set<string>();
    activePermissions.forEach((p) => set.add(getPermissionDomain(p.permission_key)));
    return Array.from(set).sort();
  }, [activePermissions]);

  const groupedPolicyPermissions = useMemo(() => {
    const q = policySearch.trim().toLowerCase();
    const filtered = activePermissions.filter((p) => {
      const domain = getPermissionDomain(p.permission_key);
      if (policyDomainFilter !== "ALL" && domain !== policyDomainFilter) return false;
      if (q) {
        return (
          p.permission_key.toLowerCase().includes(q) ||
          (p.description || "").toLowerCase().includes(q) ||
          domain.toLowerCase().includes(q)
        );
      }
      return true;
    });

    const groups: Record<string, PlatformPermission[]> = {};
    const domainOrder: string[] = [];
    filtered.forEach((p) => {
      const d = getPermissionDomain(p.permission_key);
      if (!groups[d]) {
        groups[d] = [];
        domainOrder.push(d);
      }
      groups[d].push(p);
    });

    return domainOrder.map((d) => [d, groups[d]] as [string, PlatformPermission[]]);
  }, [activePermissions, policySearch, policyDomainFilter]);

  const activeGrantedKeys = useMemo(() => {
    if (!managePolicyRole) return [];
    return (managePolicyRole.permission_keys || []).filter((k) =>
      activePermissions.some((p) => p.permission_key === k)
    );
  }, [managePolicyRole, activePermissions]);



  const handleToggleRolePermission = async (role: PlatformRole, permKey: string) => {
    const hasPerm = (role.permission_keys || []).includes(permKey);
    const keyId = `${role.id}:${permKey}`;
    setPermissionToggling(keyId);

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
      setPermissionToggling(null);
    }
  };


  // Exclude Super Admin and Admin from customizable RBAC roles (Super Admin and Admin are built-in platform administrative users, not customizable RBAC roles)
  const baseRoles = useMemo(() => {
    return roles.filter((r) => {
      const k = (r.role_key || "").toUpperCase();
      return (
        k !== "PLATFORM_SUPER_ADMIN" &&
        k !== "SUPER_ADMIN" &&
        k !== "PLATFORM_ADMIN" &&
        k !== "ADMIN"
      );
    });
  }, [roles]);

  const filteredRoles = useMemo(() => {
    if (!roleSearch.trim()) return baseRoles;
    const q = roleSearch.toLowerCase();
    return baseRoles.filter(
      (r) =>
        r.display_name.toLowerCase().includes(q) ||
        r.role_key.toLowerCase().includes(q)
    );
  }, [baseRoles, roleSearch]);

  const sectionActiveKey = useMemo(() => {
    return "roles";
  }, []);

  const pageTitle = "Roles & Access Policies";

  return (
    <AppShell
      activeKey={sectionActiveKey}
      pageTitle={pageTitle}
      breadcrumbs={["Users & Access", pageTitle]}
      actions={
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setCreateRoleModalOpen(true)}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <ICONS.plus width={14} height={14} />
            Create Role
          </button>
        </div>
      }
    >
      <SectionNavTabs items={ACCESS_SECTION_TABS} activeKey={sectionActiveKey} />

      <Banner error={error} />

      {loading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Controls Bar: Search & Count */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ position: "relative", minWidth: "260px", maxWidth: "360px", flex: 1 }}>
              <span
                style={{
                  position: "absolute",
                  left: "10px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--color-muted)",
                  display: "flex",
                  alignItems: "center",
                  pointerEvents: "none",
                }}
              >
                <ICONS.search width={14} height={14} />
              </span>
              <input
                type="text"
                autoComplete="off"
                className="form-input"
                placeholder="Search platform roles..."
                style={{ paddingLeft: "32px", height: "36px", fontSize: "13px", width: "100%" }}
                value={roleSearch}
                onChange={(e) => setRoleSearch(e.target.value)}
              />
            </div>
            <div style={{ fontSize: "13px", color: "var(--color-muted)" }}>
              Showing <strong>{filteredRoles.length}</strong> of <strong>{baseRoles.length}</strong> platform roles
            </div>
          </div>

          {/* Roles List Table */}
          {filteredRoles.length === 0 ? (
            <div className="card" style={{ padding: "40px 20px", textAlign: "center" }}>
              <p style={{ margin: 0, color: "var(--color-muted)", fontSize: "14px" }}>
                {roleSearch
                  ? "No platform roles matched your search criteria."
                  : "No platform roles configured."}
              </p>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div className="table-responsive">
                <table className="table" style={{ margin: 0, width: "100%" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                      <th style={{ width: "40%", padding: "12px 16px", fontSize: "11.5px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Platform Role
                      </th>
                      <th style={{ width: "26%", padding: "12px 16px", fontSize: "11.5px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Access Policy
                      </th>
                      <th style={{ width: "12%", padding: "12px 16px", fontSize: "11.5px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Status
                      </th>
                      <th style={{ width: "22%", padding: "12px 16px", fontSize: "11.5px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right" }}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRoles.map((role) => {
                      const roleActiveKeys = (role.permission_keys || []).filter((k) =>
                        activePermissions.some((p) => p.permission_key === k)
                      );
                      const permCount = roleActiveKeys.length;
                      const fixed = isFixedRole(role);
                      return (
                        <tr
                          key={role.id}
                          style={{ transition: "background-color 0.12s ease" }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f8fafc")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          <td style={{ padding: "12px 16px", verticalAlign: "middle" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                              <div
                                style={{
                                  width: "36px",
                                  height: "36px",
                                  borderRadius: "8px",
                                  background: fixed
                                    ? "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)"
                                    : role.is_active
                                      ? "linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)"
                                      : "#f1f5f9",
                                  color: fixed ? "#b45309" : role.is_active ? "#0369a1" : "#94a3b8",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flexShrink: 0,
                                }}
                              >
                                {fixed ? <ICONS.lock width={18} height={18} /> : <ICONS.shield width={18} height={18} />}
                              </div>
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                  <span style={{ fontWeight: 600, color: "var(--color-text)", fontSize: "14px" }}>
                                    {role.display_name}
                                  </span>
                                  {fixed && (
                                    <span
                                      className="badge"
                                      style={{
                                        backgroundColor: "#fef3c7",
                                        color: "#92400e",
                                        border: "1px solid #fde68a",
                                        fontSize: "10px",
                                        padding: "1px 6px",
                                        fontWeight: 600,
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "3px",
                                      }}
                                    >
                                      Fixed System Role
                                    </span>
                                  )}
                                </div>
                                <div style={{ marginTop: "3px" }}>
                                  <span
                                    className="badge"
                                    style={{
                                      backgroundColor: "#f1f5f9",
                                      color: "#475569",
                                      fontFamily: "monospace",
                                      fontSize: "10.5px",
                                      padding: "1px 6px",
                                    }}
                                  >
                                    {role.role_key}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: "12px 16px", verticalAlign: "middle" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span
                                  className="badge"
                                  style={{
                                    backgroundColor: permCount > 0 ? "#f0fdf4" : "#f8fafc",
                                    color: permCount > 0 ? "#166534" : "#64748b",
                                    border: permCount > 0 ? "1px solid #bbf7d0" : "1px solid #e2e8f0",
                                    fontSize: "11px",
                                    fontWeight: 600,
                                  }}
                                >
                                  {permCount} {permCount === 1 ? "Permission" : "Permissions"}
                                </span>
                              </div>
                              {permCount > 0 && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "2px" }}>
                                  {roleActiveKeys.slice(0, 2).map((pKey) => (
                                    <span
                                      key={pKey}
                                      style={{
                                        fontFamily: "monospace",
                                        fontSize: "10.5px",
                                        padding: "1px 5px",
                                        borderRadius: "3px",
                                        backgroundColor: "#f8fafc",
                                        color: "#64748b",
                                        border: "1px solid #e2e8f0",
                                      }}
                                    >
                                      {pKey}
                                    </span>
                                  ))}
                                  {permCount > 2 && (
                                    <span
                                      style={{
                                        fontSize: "10.5px",
                                        color: "var(--color-muted)",
                                        alignSelf: "center",
                                      }}
                                    >
                                      +{permCount - 2} more
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: "12px 16px", verticalAlign: "middle" }}>
                            <StatusBadge isActive={role.is_active} />
                          </td>
                          <td style={{ padding: "12px 16px", verticalAlign: "middle", textAlign: "right" }}>
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px", alignItems: "center" }}>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline"
                                style={{
                                  color: "#166534",
                                  borderColor: "#86efac",
                                  backgroundColor: "#f0fdf4",
                                  fontSize: "12px",
                                  padding: "5px 11px",
                                  fontWeight: 600,
                                  whiteSpace: "nowrap",
                                }}
                                onClick={() => {
                                  setManagePolicyRole(role);
                                  setPolicySearch("");
                                  setPolicyDomainFilter("ALL");
                                }}
                                title={`Manage permissions policy for ${role.display_name}`}
                              >
                                Manage Policy
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-secondary"
                                style={{ fontSize: "12px", padding: "5px 11px", whiteSpace: "nowrap" }}
                                onClick={() => handleOpenEditRole(role)}
                                title={`Edit ${role.display_name}`}
                              >
                                Edit Role
                              </button>
                              {!fixed && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-danger"
                                  style={{
                                    fontSize: "12px",
                                    padding: "5px 10px",
                                    whiteSpace: "nowrap",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                  }}
                                  onClick={() => setDeletingRoleTarget(role)}
                                  title={`Delete role ${role.display_name}`}
                                >
                                  <ICONS.trash width={13} height={13} />
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
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODALS                                                                    */}
      {/* ========================================================================= */}

      {/* Manage Access Policy Modal */}
      <Modal
        open={!!managePolicyRole}
        onClose={() => setManagePolicyRole(null)}
        title={
          managePolicyRole ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "8px",
                  background: isFixedRole(managePolicyRole) ? "#fef3c7" : "#e0f2fe",
                  color: isFixedRole(managePolicyRole) ? "#b45309" : "#0284c7",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {isFixedRole(managePolicyRole) ? <ICONS.lock width={16} height={16} /> : <ICONS.shield width={16} height={16} />}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span>Access Policy: {managePolicyRole.display_name}</span>
                <span
                  className="badge"
                  style={{
                    fontFamily: "monospace",
                    fontSize: "11px",
                    padding: "2px 7px",
                    backgroundColor: "#f1f5f9",
                    color: "#475569",
                  }}
                >
                  {managePolicyRole.role_key}
                </span>
                {isFixedRole(managePolicyRole) && (
                  <span
                    className="badge"
                    style={{
                      backgroundColor: "#fef3c7",
                      color: "#92400e",
                      border: "1px solid #fde68a",
                      fontSize: "10.5px",
                      padding: "2px 7px",
                      fontWeight: 600,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "3px",
                    }}
                  >
                    <ICONS.lock width={10} height={10} />
                    Fixed System Role
                  </span>
                )}
              </div>
            </div>
          ) : (
            "Access Policy"
          )
        }
        subtitle="Configure granted platform permissions for this role. Permissions take effect immediately."
        variant="center"
        cardStyle={{
          maxWidth: "760px",
          height: "85vh",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
        }}
        bodyStyle={{
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          padding: "20px 24px",
        }}
        footer={
          managePolicyRole && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
              <div style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                <strong>{activeGrantedKeys.length}</strong> of <strong>{activePermissions.length}</strong> platform permissions granted
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ padding: "6px 18px", fontSize: "13px", fontWeight: 600 }}
                onClick={() => setManagePolicyRole(null)}
              >
                Done
              </button>
            </div>
          )
        }
      >
        {managePolicyRole && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px", flex: 1, minHeight: 0, overflow: "hidden" }}>
            {/* Top Stats Overview Card */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                backgroundColor: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                gap: "16px",
                flexWrap: "wrap",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    backgroundColor:
                      activeGrantedKeys.length > 0 ? "#10b981" : "#94a3b8",
                  }}
                />
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>
                  {activeGrantedKeys.length} of {activePermissions.length} Permissions Active
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, maxWidth: "220px" }}>
                <div
                  style={{
                    flex: 1,
                    height: "6px",
                    borderRadius: "3px",
                    backgroundColor: "#e2e8f0",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${activePermissions.length ? (activeGrantedKeys.length / activePermissions.length) * 100 : 0}%`,
                      height: "100%",
                      backgroundColor:
                        activeGrantedKeys.length === activePermissions.length
                          ? "#10b981"
                          : "var(--color-primary)",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#64748b" }}>
                  {activePermissions.length
                    ? Math.round(
                      (activeGrantedKeys.length / activePermissions.length) * 100
                    )
                    : 0}
                  %
                </span>
              </div>
            </div>

            {/* Search and Domain Filter Controls */}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", flexShrink: 0 }}>
              <div style={{ position: "relative", flex: 1, minWidth: "220px" }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search permissions by key, description, or domain..."
                  style={{
                    width: "100%",
                    height: "38px",
                    fontSize: "13px",
                    paddingLeft: "34px",
                    borderRadius: "8px",
                  }}
                  value={policySearch}
                  onChange={(e) => setPolicySearch(e.target.value)}
                />
                <div
                  style={{
                    position: "absolute",
                    left: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#94a3b8",
                    pointerEvents: "none",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <ICONS.search width={15} height={15} />
                </div>
                {policySearch && (
                  <button
                    type="button"
                    onClick={() => setPolicySearch("")}
                    style={{
                      position: "absolute",
                      right: "10px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      border: "none",
                      background: "transparent",
                      color: "#94a3b8",
                      cursor: "pointer",
                      padding: "2px",
                      fontSize: "12px",
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              <select
                className="form-input"
                style={{ width: "210px", height: "38px", fontSize: "13px", borderRadius: "8px" }}
                value={policyDomainFilter}
                onChange={(e) => setPolicyDomainFilter(e.target.value)}
              >
                <option value="ALL">All Domains ({activePermissions.length})</option>
                {domains.map((d) => {
                  const count = activePermissions.filter((p) => getPermissionDomain(p.permission_key) === d).length;
                  return (
                    <option key={d} value={d}>
                      {d} ({count})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Grouped Permissions Scrollable List */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                border: "1px solid var(--color-border)",
                borderRadius: "10px",
                padding: "10px",
                backgroundColor: "#f8fafc",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              {groupedPolicyPermissions.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--color-muted)" }}>
                  <p style={{ margin: 0, fontSize: "14px", fontWeight: 500 }}>No permissions match your search or filter.</p>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ marginTop: "10px", fontSize: "12px" }}
                    onClick={() => {
                      setPolicySearch("");
                      setPolicyDomainFilter("ALL");
                    }}
                  >
                    Clear Filter
                  </button>
                </div>
              ) : (
                groupedPolicyPermissions.map(([domainName, perms]) => {
                  const domainGrantedCount = perms.filter((p) =>
                    (managePolicyRole.permission_keys || []).includes(p.permission_key)
                  ).length;

                  return (
                    <div
                      key={domainName}
                      style={{
                        backgroundColor: "#ffffff",
                        borderRadius: "8px",
                        border: "1px solid #e2e8f0",
                        overflow: "hidden",
                        flexShrink: 0,
                      }}
                    >
                      {/* Domain Header */}
                      <div
                        style={{
                          padding: "10px 14px",
                          backgroundColor: "#f1f5f9",
                          borderBottom: "1px solid #e2e8f0",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          flexShrink: 0,
                        }}
                      >
                        <span style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b" }}>
                          {domainName}
                        </span>
                        <span
                          className="badge"
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "2px 8px",
                            backgroundColor:
                              domainGrantedCount === perms.length
                                ? "#dcfce7"
                                : domainGrantedCount > 0
                                  ? "#e0f2fe"
                                  : "#f1f5f9",
                            color:
                              domainGrantedCount === perms.length
                                ? "#166534"
                                : domainGrantedCount > 0
                                  ? "#0369a1"
                                  : "#64748b",
                            border:
                              domainGrantedCount === perms.length
                                ? "1px solid #bbf7d0"
                                : domainGrantedCount > 0
                                  ? "1px solid #bae6fd"
                                  : "1px solid #e2e8f0",
                          }}
                        >
                          {domainGrantedCount} of {perms.length} granted
                        </span>
                      </div>

                      {/* Domain Permissions */}
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        {perms.map((perm, idx) => {
                          const hasPerm = (managePolicyRole.permission_keys || []).includes(perm.permission_key);
                          const isToggling = permissionToggling === `${managePolicyRole.id}:${perm.permission_key}`;

                          return (
                            <div
                              key={perm.id}
                              onClick={async () => {
                                if (isToggling) return;
                                await handleToggleRolePermission(managePolicyRole, perm.permission_key);
                                setManagePolicyRole((prev) => {
                                  if (!prev) return null;
                                  const keys = prev.permission_keys || [];
                                  const nextKeys = keys.includes(perm.permission_key)
                                    ? keys.filter((k) => k !== perm.permission_key)
                                    : [...keys, perm.permission_key];
                                  return { ...prev, permission_keys: nextKeys };
                                });
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "10px 14px",
                                borderBottom: idx < perms.length - 1 ? "1px solid #f1f5f9" : "none",
                                backgroundColor: hasPerm ? "#fafffb" : "#ffffff",
                                cursor: isToggling ? "wait" : "pointer",
                                transition: "background-color 0.15s ease",
                                flexShrink: 0,
                              }}
                            >
                              <div style={{ flex: 1, paddingRight: "16px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <span
                                    style={{
                                      fontFamily: "monospace",
                                      fontSize: "12px",
                                      fontWeight: 700,
                                      color: hasPerm ? "#15803d" : "#0f172a",
                                    }}
                                  >
                                    {perm.permission_key}
                                  </span>
                                </div>
                                {perm.description && (
                                  <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px", lineHeight: 1.4 }}>
                                    {perm.description}
                                  </div>
                                )}
                              </div>

                              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                                <span
                                  style={{
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    padding: "2px 8px",
                                    borderRadius: "12px",
                                    backgroundColor: hasPerm ? "#dcfce7" : "#f1f5f9",
                                    color: hasPerm ? "#166534" : "#94a3b8",
                                    border: hasPerm ? "1px solid #bbf7d0" : "1px solid #e2e8f0",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "3px",
                                  }}
                                >
                                  {hasPerm ? (
                                    <>
                                      <ICONS.check width={11} height={11} /> Granted
                                    </>
                                  ) : (
                                    "Not Granted"
                                  )}
                                </span>
                                <input
                                  type="checkbox"
                                  checked={hasPerm}
                                  disabled={isToggling}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={async () => {
                                    await handleToggleRolePermission(managePolicyRole, perm.permission_key);
                                    setManagePolicyRole((prev) => {
                                      if (!prev) return null;
                                      const keys = prev.permission_keys || [];
                                      const nextKeys = keys.includes(perm.permission_key)
                                        ? keys.filter((k) => k !== perm.permission_key)
                                        : [...keys, perm.permission_key];
                                      return { ...prev, permission_keys: nextKeys };
                                    });
                                  }}
                                  style={{
                                    width: "18px",
                                    height: "18px",
                                    cursor: isToggling ? "wait" : "pointer",
                                    accentColor: "var(--color-primary)",
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </Modal>

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
              autoComplete="off"
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
              autoComplete="off"
              className="form-input"
              placeholder="e.g. Compliance Auditor"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              required
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
              autoComplete="off"
              className="form-input"
              value={editRoleName}
              onChange={(e) => setEditRoleName(e.target.value)}
              required
            />
          </div>

          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginTop: "4px" }}>
            <input
              id="edit-role-active"
              type="checkbox"
              checked={editRoleActive}
              disabled={editingRole ? isFixedRole(editingRole) : false}
              onChange={(e) => setEditRoleActive(e.target.checked)}
              style={{ width: "16px", height: "16px", marginTop: "2px", accentColor: "var(--color-primary)" }}
            />
            <label htmlFor="edit-role-active" style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text)", cursor: editingRole && isFixedRole(editingRole) ? "not-allowed" : "pointer" }}>
              Active (Role can be assigned and held by users)
              {editingRole && isFixedRole(editingRole) && (
                <span style={{ display: "block", fontSize: "11px", color: "var(--color-muted)", fontWeight: 400, marginTop: "2px" }}>
                  Fixed system role must always remain active.
                </span>
              )}
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

      {/* Delete Role Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deletingRoleTarget)}
        title="Delete Platform Role"
        message={
          <span>
            Are you sure you want to delete the platform role <strong>{deletingRoleTarget?.display_name}</strong> (<code>{deletingRoleTarget?.role_key}</code>)?
            <br />
            <br />
            This action cannot be undone. Any platform user currently assigned to this role will immediately lose access granted by its access policy.
          </span>
        }
        confirmLabel="Delete Role"
        danger
        loading={deletingRoleLoading}
        onConfirm={handleDeleteRole}
        onCancel={() => setDeletingRoleTarget(null)}
      />



    </AppShell>
  );
}