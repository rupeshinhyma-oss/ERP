/**
 * Global Users Directory for ERP_Main Control Plane.
 *
 * Implements full platform user management: list, search, status filters,
 * creation, metadata updates, status transitions (ACTIVE/SUSPENDED/DISABLED),
 * Flow A provisioning into ERPs, and deep multi-tab inspection with live
 * Access Summary & Effective Platform Permissions.
 *
 * Adopts the exact layout, table, card, tab, badge, and modal patterns from
 * Yinglima ERP and Inhyma ERP.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import { AppShell } from "@/components/AppShell";
import {
  Banner,
  ConfirmDialog,
  EmptyState,
  LoadingSpinner,
  Modal,
  StatusBadge,
} from "@/components/ui";
import { ICONS } from "@/components/icons";
import type {
  EffectivePermissions,
  ErpInstance,
  ErpMembership,
  GlobalUser,
  GlobalUserStatus,
  PlatformRole,
  PlatformRoleAssignment,
} from "@/types";

const STATUS_FILTERS = [
  { value: "ALL", label: "All Statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "DISABLED", label: "Disabled" },
];

export function GlobalUsers() {
  const toast = useToast();
  const { isSuperAdmin } = useAuth();

  const [users, setUsers] = useState<GlobalUser[]>([]);
  const [erps, setErps] = useState<ErpInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Filters & Search
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Create User Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createDisplayName, setCreateDisplayName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createExternalId, setCreateExternalId] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit User Modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<GlobalUser | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editExternalId, setEditExternalId] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Status Change Dialog
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [targetStatusUser, setTargetStatusUser] = useState<GlobalUser | null>(null);
  const [newStatus, setNewStatus] = useState<GlobalUserStatus>("ACTIVE");
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Flow A ERP Provisioning Modal
  const [provisionModalOpen, setProvisionModalOpen] = useState(false);
  const [targetProvisionUser, setTargetProvisionUser] = useState<GlobalUser | null>(null);
  const [selectedErpId, setSelectedErpId] = useState("");
  const [provisioning, setProvisioning] = useState(false);

  // User Detail Drawer / Modal
  const [detailUser, setDetailUser] = useState<GlobalUser | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "memberships" | "roles" | "access">("overview");
  const [userMemberships, setUserMemberships] = useState<ErpMembership[]>([]);
  const [userRoles, setUserRoles] = useState<PlatformRoleAssignment[]>([]);
  const [effectivePerms, setEffectivePerms] = useState<EffectivePermissions | null>(null);
  const [loadingDetailSubdata, setLoadingDetailSubdata] = useState(false);

  // Assign Role Modal (inside User Detail)
  const [assignRoleModalOpen, setAssignRoleModalOpen] = useState(false);
  const [availableRoles, setAvailableRoles] = useState<PlatformRole[]>([]);
  const [assignRoleKey, setAssignRoleKey] = useState("");
  const [assignScope, setAssignScope] = useState<"GLOBAL" | "ERP">("GLOBAL");
  const [assignErpId, setAssignErpId] = useState("");
  const [assigningRole, setAssigningRole] = useState(false);

  // Revoke Role Confirmation
  const [revokeAssignmentId, setRevokeAssignmentId] = useState<string | null>(null);
  const [revokingRole, setRevokingRole] = useState(false);

  const fetchUsers = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const [usersRes, erpsRes] = await Promise.all([
        apiGet<GlobalUser[]>("/global/users?limit=250&offset=0"),
        apiGet<ErpInstance[]>("/global/erps").catch(() => []),
      ]);
      const usersList = Array.isArray(usersRes) ? usersRes : ((usersRes as any)?.data || []);
      const erpsList = Array.isArray(erpsRes) ? erpsRes : ((erpsRes as any)?.data || []);
      setUsers(usersList);
      setErps(erpsList.filter((e: ErpInstance) => e.status !== "DECOMMISSIONED"));
    } catch (err) {
      setError(err);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchUsers();

    // Revalidate when user returns to this tab without background periodic polling
    const handleFocus = () => {
      fetchUsers(true);
    };
    window.addEventListener("focus", handleFocus);

    return () => window.removeEventListener("focus", handleFocus);
  }, [fetchUsers]);

  // Load subdata when Detail Drawer is opened
  const loadUserDetailData = useCallback(async (userId: string) => {
    setLoadingDetailSubdata(true);
    try {
      const [memsRes, rolesRes, permsRes] = await Promise.all([
        apiGet<ErpMembership[]>(`/global/users/${userId}/memberships`).catch(() => []),
        apiGet<PlatformRoleAssignment[]>(`/global/authz/users/${userId}/roles`).catch(() => []),
        apiGet<EffectivePermissions>(`/global/authz/users/${userId}/effective-permissions`).catch(() => null),
      ]);
      const rawMems = (memsRes as any)?.data ?? memsRes;
      const rawRoles = (rolesRes as any)?.data ?? rolesRes;
      const rawPerms = (permsRes as any)?.data ?? permsRes;

      setUserMemberships(Array.isArray(rawMems) ? rawMems : []);
      setUserRoles(Array.isArray(rawRoles) ? rawRoles : []);
      setEffectivePerms(rawPerms || null);
    } catch {
      // Non-blocking
    } finally {
      setLoadingDetailSubdata(false);
    }
  }, []);

  const handleOpenDetail = (user: GlobalUser) => {
    setDetailUser(user);
    setDetailTab("overview");
    loadUserDetailData(user.id);
  };

  // Filtered Users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchesStatus = statusFilter === "ALL" || u.status === statusFilter;
      const query = search.trim().toLowerCase();
      const email = (u.primary_email || u.email || "").toLowerCase();
      const name = (u.display_name || "").toLowerCase();
      const ext = (u.external_identity_id || "").toLowerCase();
      const matchesSearch = !query || name.includes(query) || email.includes(query) || ext.includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [users, statusFilter, search]);

  // Create User
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createEmail.trim() || !createDisplayName.trim()) return;
    setCreating(true);
    try {
      await apiPost("/global/users", {
        primary_email: createEmail.trim().toLowerCase(),
        display_name: createDisplayName.trim(),
        external_identity_id: createExternalId.trim() || null,
      });
      toast("Global user created successfully.", "success");
      setCreateModalOpen(false);
      setCreateDisplayName("");
      setCreateEmail("");
      setCreateExternalId("");
      await fetchUsers();
    } catch (err) {
      toast("Failed to create user: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setCreating(false);
    }
  };

  // Edit User
  const handleOpenEdit = (user: GlobalUser) => {
    setEditingUser(user);
    setEditDisplayName(user.display_name || "");
    setEditEmail(user.primary_email || user.email || "");
    setEditExternalId(user.external_identity_id || "");
    setEditModalOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSavingEdit(true);
    try {
      await apiPatch(`/global/users/${editingUser.id}`, {
        display_name: editDisplayName.trim() || undefined,
        primary_email: editEmail.trim().toLowerCase() || undefined,
        external_identity_id: editExternalId.trim() || null,
      });
      toast("Global user updated successfully.", "success");
      setEditModalOpen(false);
      setEditingUser(null);
      await fetchUsers();
      if (detailUser && detailUser.id === editingUser.id) {
        setDetailUser((prev) => (prev ? { ...prev, display_name: editDisplayName, primary_email: editEmail } : null));
      }
    } catch (err) {
      toast("Failed to update user: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setSavingEdit(false);
    }
  };

  // Change Status
  const handleOpenStatus = (user: GlobalUser) => {
    setTargetStatusUser(user);
    setNewStatus(user.status);
    setStatusModalOpen(true);
  };

  const handleUpdateStatus = async () => {
    if (!targetStatusUser) return;
    setUpdatingStatus(true);
    try {
      await apiPatch(`/global/users/${targetStatusUser.id}/status`, {
        status: newStatus,
      });
      toast(`User status changed to ${newStatus}.`, "success");
      setStatusModalOpen(false);
      setTargetStatusUser(null);
      await fetchUsers();
      if (detailUser && detailUser.id === targetStatusUser.id) {
        setDetailUser((prev) => (prev ? { ...prev, status: newStatus } : null));
      }
    } catch (err) {
      toast("Failed to change user status: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Flow A ERP Provisioning
  const handleOpenProvision = (user: GlobalUser) => {
    setTargetProvisionUser(user);
    setSelectedErpId(erps[0]?.id || "");
    setProvisionModalOpen(true);
  };

  const handleExecuteProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetProvisionUser || !selectedErpId) return;
    setProvisioning(true);
    try {
      await apiPost(`/global/users/${targetProvisionUser.id}/provision`, {
        erp_instance_id: selectedErpId,
      });
      toast("User provisioned into ERP successfully (Flow A).", "success");
      setProvisionModalOpen(false);
      setTargetProvisionUser(null);
      if (detailUser && detailUser.id === targetProvisionUser.id) {
        loadUserDetailData(detailUser.id);
      }
    } catch (err) {
      toast("Provisioning failed: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setProvisioning(false);
    }
  };

  // Membership Actions inside User Detail
  const handleMembershipAction = async (membershipId: string, action: "verify" | "suspend" | "restore" | "revoke" | "unlink") => {
    try {
      if (action === "verify") {
        await apiPost(`/global/memberships/${membershipId}/verify`, {});
        toast("Membership verified and activated.", "success");
      } else if (action === "suspend") {
        await apiPost(`/global/memberships/${membershipId}/suspend`, { reason: "Suspended by admin" });
        toast("Membership suspended.", "info");
      } else if (action === "restore") {
        await apiPost(`/global/memberships/${membershipId}/restore`, { reason: "Restored by admin" });
        toast("Membership restored to active.", "success");
      } else if (action === "revoke") {
        await apiPost(`/global/memberships/${membershipId}/revoke`, { reason: "Revoked by admin" });
        toast("Membership revoked.", "info");
      } else if (action === "unlink") {
        await apiDelete(`/global/identity/memberships/${membershipId}/link`);
        toast("Identity safely unlinked. Local ERP user untouched.", "info");
      }
      if (detailUser) {
        await loadUserDetailData(detailUser.id);
      }
    } catch (err) {
      toast("Action failed: " + (err instanceof Error ? err.message : String(err)), "error");
    }
  };

  // Open Assign Role Modal
  const handleOpenAssignRole = async () => {
    try {
      const rolesRes = await apiGet<PlatformRole[]>("/global/authz/roles");
      const rawRoles = (rolesRes as any)?.data ?? rolesRes;
      const list = Array.isArray(rawRoles) ? rawRoles : [];
      setAvailableRoles(list.filter((r) => r.is_active));
      setAssignRoleKey(list[0]?.role_key || "");
      setAssignScope("GLOBAL");
      setAssignErpId(erps[0]?.id || "");
      setAssignRoleModalOpen(true);
    } catch (err) {
      toast("Failed to load platform roles: " + (err instanceof Error ? err.message : String(err)), "error");
    }
  };

  const handleExecuteAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailUser || !assignRoleKey) return;
    setAssigningRole(true);
    try {
      await apiPost(`/global/authz/users/${detailUser.id}/roles`, {
        role_key: assignRoleKey,
        scope: assignScope,
        erp_instance_id: assignScope === "ERP" ? assignErpId : undefined,
      });
      toast(`Platform role ${assignRoleKey} assigned successfully.`, "success");
      setAssignRoleModalOpen(false);
      await loadUserDetailData(detailUser.id);
    } catch (err) {
      toast("Role assignment failed: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setAssigningRole(false);
    }
  };

  const handleRevokeRole = async () => {
    if (!revokeAssignmentId) return;
    setRevokingRole(true);
    try {
      await apiPost(`/global/authz/assignments/${revokeAssignmentId}/revoke`, {});
      toast("Platform role assignment revoked.", "info");
      setRevokeAssignmentId(null);
      if (detailUser) {
        await loadUserDetailData(detailUser.id);
      }
    } catch (err) {
      toast("Failed to revoke role assignment: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setRevokingRole(false);
    }
  };

  return (
    <AppShell
      activeKey="users"
      pageTitle="Global Users Directory"
      breadcrumbs={["Identity & Access", "Global Users"]}
      actions={
        <button
          type="button"
          id="btn-create-global-user"
          className="btn btn-primary"
          onClick={() => setCreateModalOpen(true)}
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
        >
          <ICONS.plus width={16} height={16} />
          <span>Create Global User</span>
        </button>
      }
    >
      <Banner error={error} />

      {/* Filter and Search Bar */}
      <div
        className="card"
        style={{
          padding: "16px 20px",
          marginBottom: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: "1 1 300px" }}>
          <div style={{ position: "relative", width: "100%", maxWidth: "380px" }}>
            <span
              style={{
                position: "absolute",
                left: "12px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--color-muted)",
              }}
            >
              <ICONS.search width={16} height={16} />
            </span>
            <input
              type="text"
              id="input-search-users"
              placeholder="Search by name, email or external ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-control"
              style={{ paddingLeft: "36px", height: "38px" }}
            />
          </div>

          <select
            id="select-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="form-control"
            style={{ width: "160px", height: "38px" }}
          >
            {STATUS_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "13px", color: "var(--color-muted)", fontWeight: 500 }}>
            Showing <strong>{filteredUsers.length}</strong> {filteredUsers.length === 1 ? "user" : "users"}
          </span>
        </div>
      </div>

      {/* Users Table */}
      {loading ? (
        <LoadingSpinner text="Loading Global Users directory..." />
      ) : filteredUsers.length === 0 ? (
        <EmptyState
          title="No Global Users Found"
          description={
            search || statusFilter !== "ALL"
              ? "No global users matched your filter criteria."
              : "No global platform identities exist yet. Create your first Global User to get started."
          }
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setCreateModalOpen(true)}
            >
              Create Global User
            </button>
          }
        />
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-responsive">
            <table className="table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: "30%" }}>Global Identity</th>
                  <th style={{ width: "25%" }}>Primary Email</th>
                  <th style={{ width: "15%" }}>Status</th>
                  <th style={{ width: "15%" }}>Created</th>
                  <th style={{ width: "15%", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const email = u.primary_email || u.email || "—";
                  const initials = u.display_name
                    ? u.display_name
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()
                    : "GU";

                  return (
                    <tr key={u.id} id={`user-row-${u.id}`}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div
                            style={{
                              width: "36px",
                              height: "36px",
                              borderRadius: "50%",
                              backgroundColor: "#e0e7ff",
                              color: "#4338ca",
                              fontWeight: 700,
                              fontSize: "13px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            {initials}
                          </div>
                          <div>
                            <div
                              style={{
                                fontWeight: 600,
                                color: "var(--color-text)",
                                cursor: "pointer",
                              }}
                              onClick={() => handleOpenDetail(u)}
                            >
                              {u.display_name}
                            </div>
                            {u.external_identity_id && (
                              <span
                                style={{
                                  fontSize: "11px",
                                  color: "var(--color-muted)",
                                  fontFamily: "monospace",
                                }}
                              >
                                ext: {u.external_identity_id}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontFamily: "monospace", fontSize: "13px" }}>{email}</span>
                          <button
                            type="button"
                            title="Copy email"
                            onClick={() => {
                              navigator.clipboard.writeText(email);
                              toast("Email copied to clipboard.", "info");
                            }}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              color: "var(--color-muted)",
                              padding: "2px",
                            }}
                          >
                            <ICONS.copy width={12} height={12} />
                          </button>
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={u.status} />
                      </td>
                      <td style={{ fontSize: "13px", color: "var(--color-muted)" }}>
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: "6px" }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleOpenDetail(u)}
                            title="View Details & Access"
                          >
                            Details
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleOpenEdit(u)}
                            title="Edit User"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleOpenStatus(u)}
                            title="Change Status"
                          >
                            Status
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleOpenProvision(u)}
                            title="Provision to ERP (Flow A)"
                          >
                            Provision
                          </button>
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

      {/* CREATE USER MODAL */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create Global User"
      >
        <form onSubmit={handleCreateUser}>
          <div className="form-group" style={{ marginBottom: "16px" }}>
            <label className="form-label" htmlFor="create-display-name">
              Full Name / Display Name <span style={{ color: "red" }}>*</span>
            </label>
            <input
              type="text"
              id="create-display-name"
              required
              className="form-control"
              placeholder="e.g. Eleanor Vance"
              value={createDisplayName}
              onChange={(e) => setCreateDisplayName(e.target.value)}
            />
          </div>

          <div className="form-group" style={{ marginBottom: "16px" }}>
            <label className="form-label" htmlFor="create-email">
              Primary Email <span style={{ color: "red" }}>*</span>
            </label>
            <input
              type="email"
              id="create-email"
              required
              className="form-control"
              placeholder="e.g. eleanor.vance@company.com"
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
            />
            <span style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "4px", display: "block" }}>
              Global human identity identifier. Email is normalized and deduplicated across the ecosystem.
            </span>
          </div>

          <div className="form-group" style={{ marginBottom: "24px" }}>
            <label className="form-label" htmlFor="create-ext-id">
              External Identity ID (Optional)
            </label>
            <input
              type="text"
              id="create-ext-id"
              className="form-control"
              placeholder="e.g. auth0|usr_123 or okta_987"
              value={createExternalId}
              onChange={(e) => setCreateExternalId(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCreateModalOpen(false)}
              disabled={creating}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={creating}
            >
              {creating ? "Creating User..." : "Create User"}
            </button>
          </div>
        </form>
      </Modal>

      {/* EDIT USER MODAL */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Edit Global User Metadata"
      >
        <form onSubmit={handleSaveEdit}>
          <div className="form-group" style={{ marginBottom: "16px" }}>
            <label className="form-label" htmlFor="edit-display-name">
              Display Name
            </label>
            <input
              type="text"
              id="edit-display-name"
              required
              className="form-control"
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
            />
          </div>

          <div className="form-group" style={{ marginBottom: "16px" }}>
            <label className="form-label" htmlFor="edit-email">
              Primary Email
            </label>
            <input
              type="email"
              id="edit-email"
              required
              className="form-control"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
            />
          </div>

          <div className="form-group" style={{ marginBottom: "24px" }}>
            <label className="form-label" htmlFor="edit-ext-id">
              External Identity ID
            </label>
            <input
              type="text"
              id="edit-ext-id"
              className="form-control"
              value={editExternalId}
              onChange={(e) => setEditExternalId(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setEditModalOpen(false)}
              disabled={savingEdit}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={savingEdit}
            >
              {savingEdit ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      {/* STATUS CHANGE MODAL */}
      <Modal
        isOpen={statusModalOpen}
        onClose={() => setStatusModalOpen(false)}
        title="Change Global User Status"
      >
        {targetStatusUser && (
          <div>
            <p style={{ fontSize: "14px", color: "var(--color-text)", marginBottom: "16px" }}>
              Update lifecycle status for <strong>{targetStatusUser.display_name}</strong> (
              <span style={{ fontFamily: "monospace" }}>{targetStatusUser.primary_email || targetStatusUser.email}</span>):
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
              {(["ACTIVE", "SUSPENDED", "DISABLED"] as GlobalUserStatus[]).map((st) => (
                <label
                  key={st}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px 14px",
                    borderRadius: "6px",
                    border: newStatus === st ? "1px solid #0061f2" : "1px solid #e2e8f0",
                    background: newStatus === st ? "#eff6ff" : "#ffffff",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="user-status"
                    value={st}
                    checked={newStatus === st}
                    onChange={() => setNewStatus(st)}
                  />
                  <div>
                    <strong style={{ fontSize: "13px" }}>{st}</strong>
                    <div style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                      {st === "ACTIVE" && "Full platform privileges and single sign-on access."}
                      {st === "SUSPENDED" && "Temporarily blocked from SSO and control plane operations."}
                      {st === "DISABLED" && "Deactivated platform identity. Local ERP accounts remain intact."}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStatusModalOpen(false)}
                disabled={updatingStatus}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleUpdateStatus}
                disabled={updatingStatus}
              >
                {updatingStatus ? "Updating..." : "Confirm Status"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* FLOW A PROVISION TO ERP MODAL */}
      <Modal
        isOpen={provisionModalOpen}
        onClose={() => setProvisionModalOpen(false)}
        title="Provision User to ERP (Flow A)"
      >
        {targetProvisionUser && (
          <form onSubmit={handleExecuteProvision}>
            <p style={{ fontSize: "14px", color: "var(--color-text)", marginBottom: "16px" }}>
              Provision <strong>{targetProvisionUser.display_name}</strong> into a registered business ERP.
              A minimal local account will be created and bound via an active ERP Membership.
            </p>

            <div className="form-group" style={{ marginBottom: "20px" }}>
              <label className="form-label" htmlFor="provision-select-erp">
                Target Business ERP <span style={{ color: "red" }}>*</span>
              </label>
              <select
                id="provision-select-erp"
                required
                className="form-control"
                value={selectedErpId}
                onChange={(e) => setSelectedErpId(e.target.value)}
              >
                {erps.map((erp) => (
                  <option key={erp.id} value={erp.id}>
                    {erp.name} ({erp.erp_key}) — v{erp.version}
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                backgroundColor: "#f8fafc",
                padding: "12px 14px",
                borderRadius: "6px",
                fontSize: "12px",
                color: "var(--color-muted)",
                marginBottom: "20px",
              }}
            >
              <strong>Architectural Note:</strong> Global provisioning uses the target ERP adapter API.
              Local organizational roles and business permissions remain strictly authoritative within that ERP.
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setProvisionModalOpen(false)}
                disabled={provisioning}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={provisioning || !selectedErpId}
              >
                {provisioning ? "Provisioning..." : "Provision to ERP"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* USER DETAIL MODAL / DRAWER */}
      {detailUser && (
        <Modal
          open={Boolean(detailUser)}
          onClose={() => setDetailUser(null)}
          title={`Global User: ${detailUser.display_name}`}
        >
          <div>
            {/* Header / Tabs */}
            <div
              style={{
                display: "flex",
                borderBottom: "1px solid #e2e8f0",
                marginBottom: "20px",
                gap: "8px",
              }}
            >
              {[
                { key: "overview", label: "Overview & Identity" },
                { key: "memberships", label: `Memberships (${userMemberships.length})` },
                { key: "roles", label: `Platform Roles (${userRoles.filter((r) => r.is_active).length})` },
                { key: "access", label: "Access Summary" },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  id={`tab-${t.key}`}
                  onClick={() => setDetailTab(t.key as any)}
                  style={{
                    padding: "8px 16px",
                    background: "none",
                    border: "none",
                    borderBottom: detailTab === t.key ? "2px solid #0061f2" : "2px solid transparent",
                    fontWeight: detailTab === t.key ? 700 : 500,
                    color: detailTab === t.key ? "#0061f2" : "var(--color-muted)",
                    cursor: "pointer",
                    fontSize: "13px",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {loadingDetailSubdata ? (
              <LoadingSpinner text="Loading user details..." />
            ) : (

              <>
                {/* TAB 1: OVERVIEW */}
                {detailTab === "overview" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                      <div>
                        <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>Platform User ID</span>
                        <div style={{ fontFamily: "monospace", fontSize: "12px" }}>{detailUser.id}</div>
                      </div>
                      <div>
                        <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>Status</span>
                        <div><StatusBadge status={detailUser.status} /></div>
                      </div>
                      <div>
                        <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>Primary Email</span>
                        <div style={{ fontWeight: 600 }}>{detailUser.primary_email || detailUser.email}</div>
                      </div>
                      <div>
                        <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>External Identity</span>
                        <div>{detailUser.external_identity_id || "None (Local Platform)"}</div>
                      </div>
                      <div>
                        <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>Created At</span>
                        <div style={{ fontSize: "13px" }}>
                          {detailUser.created_at ? new Date(detailUser.created_at).toLocaleString() : "—"}
                        </div>
                      </div>
                      <div>
                        <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>Updated At</span>
                        <div style={{ fontSize: "13px" }}>
                          {detailUser.updated_at ? new Date(detailUser.updated_at).toLocaleString() : "—"}
                        </div>
                      </div>
                    </div>

                    {detailUser.metadata && Object.keys(detailUser.metadata).length > 0 && (
                      <div>
                        <span style={{ fontSize: "12px", color: "var(--color-muted)", display: "block", marginBottom: "4px" }}>
                          Metadata Payload
                        </span>
                        <pre
                          style={{
                            background: "#f8fafc",
                            padding: "10px",
                            borderRadius: "6px",
                            fontSize: "11px",
                            overflow: "auto",
                            maxHeight: "150px",
                          }}
                        >
                          {JSON.stringify(detailUser.metadata, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: MEMBERSHIPS */}
                {detailTab === "memberships" && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                      <span style={{ fontSize: "13px", color: "var(--color-muted)" }}>
                        Linked ERP environments for this Global User
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleOpenProvision(detailUser)}
                      >
                        + Provision to New ERP
                      </button>
                    </div>

                    {userMemberships.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "24px", color: "var(--color-muted)", fontSize: "13px" }}>
                        No ERP memberships linked yet. Use "Provision to New ERP" or add via Memberships Hub.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {userMemberships.map((m) => {
                          const erp = erps.find((e) => e.id === m.erp_instance_id);
                          return (
                            <div
                              key={m.id}
                              style={{
                                border: "1px solid #e2e8f0",
                                borderRadius: "6px",
                                padding: "12px 16px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                backgroundColor: "#ffffff",
                              }}
                            >
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <strong style={{ fontSize: "14px" }}>{erp?.name || m.erp_name || "Business ERP"}</strong>
                                  <span style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--color-muted)" }}>
                                    {erp?.erp_key || m.erp_key}
                                  </span>
                                  <StatusBadge status={m.status} />
                                </div>
                                <div style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "4px" }}>
                                  Local User ID: <code style={{ color: "#0061f2" }}>{m.local_user_id}</code>
                                  {m.verified_at && ` • Verified: ${new Date(m.verified_at).toLocaleDateString()}`}
                                </div>
                              </div>

                              <div style={{ display: "flex", gap: "6px" }}>
                                {m.status === "PENDING" && (
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleMembershipAction(m.id, "verify")}
                                  >
                                    Verify
                                  </button>
                                )}
                                {m.status === "ACTIVE" && (
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleMembershipAction(m.id, "suspend")}
                                  >
                                    Suspend
                                  </button>
                                )}
                                {m.status === "SUSPENDED" && (
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleMembershipAction(m.id, "restore")}
                                  >
                                    Restore
                                  </button>
                                )}
                                {m.status !== "REVOKED" && (
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleMembershipAction(m.id, "revoke")}
                                  >
                                    Revoke
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  style={{ color: "#dc2626" }}
                                  onClick={() => handleMembershipAction(m.id, "unlink")}
                                  title="Safe unlinking (local user preserved)"
                                >
                                  Unlink
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 3: PLATFORM ROLES */}
                {detailTab === "roles" && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                      <span style={{ fontSize: "13px", color: "var(--color-muted)" }}>
                        Platform authorization roles assigned to this identity
                      </span>
                      {isSuperAdmin && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={handleOpenAssignRole}
                        >
                          + Assign Platform Role
                        </button>
                      )}
                    </div>

                    {userRoles.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "24px", color: "var(--color-muted)", fontSize: "13px" }}>
                        No platform roles assigned. User has standard baseline permissions.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {userRoles.map((r) => {
                          const erp = r.erp_instance_id ? erps.find((e) => e.id === r.erp_instance_id) : null;
                          return (
                            <div
                              key={r.id}
                              style={{
                                border: "1px solid #e2e8f0",
                                borderRadius: "6px",
                                padding: "12px 16px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                backgroundColor: r.is_active ? "#ffffff" : "#f8fafc",
                                opacity: r.is_active ? 1 : 0.7,
                              }}
                            >
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <strong style={{ fontSize: "14px" }}>{r.role_key}</strong>
                                  <span
                                    style={{
                                      fontSize: "11px",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      background: r.scope === "GLOBAL" ? "#e0e7ff" : "#fef3c7",
                                      color: r.scope === "GLOBAL" ? "#3730a3" : "#92400e",
                                      fontWeight: 600,
                                    }}
                                  >
                                    Scope: {r.scope} {erp ? `(${erp.name})` : ""}
                                  </span>
                                  <StatusBadge status={r.is_active ? "ACTIVE" : "INACTIVE"} />
                                </div>
                                <div style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "4px" }}>
                                  Assigned: {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                                  {r.revoked_at && ` • Revoked: ${new Date(r.revoked_at).toLocaleDateString()}`}
                                </div>
                              </div>

                              {r.is_active && isSuperAdmin && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  style={{ color: "#dc2626" }}
                                  onClick={() => setRevokeAssignmentId(r.id)}
                                >
                                  Revoke
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 4: ACCESS SUMMARY */}
                {detailTab === "access" && (
                  <div>
                    <div
                      style={{
                        backgroundColor: "#f8fafc",
                        padding: "16px",
                        borderRadius: "8px",
                        marginBottom: "16px",
                      }}
                    >
                      <h4 style={{ margin: "0 0 8px", fontSize: "14px", fontWeight: 700 }}>
                        Live Access Summary
                      </h4>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                        <div>
                          <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>Active Platform Roles</span>
                          <div style={{ fontWeight: 700, fontSize: "16px" }}>
                            {userRoles.filter((r) => r.is_active).length}
                          </div>
                        </div>
                        <div>
                          <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>Authorized ERP Workspaces</span>
                          <div style={{ fontWeight: 700, fontSize: "16px" }}>
                            {userMemberships.filter((m) => m.status === "ACTIVE").length} of {erps.length}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Global Effective Permissions */}
                    <div style={{ marginBottom: "16px" }}>
                      <strong style={{ fontSize: "13px", display: "block", marginBottom: "8px" }}>
                        Global Platform Permissions ({effectivePerms?.global_permissions.length || 0})
                      </strong>
                      {!effectivePerms || effectivePerms.global_permissions.length === 0 ? (
                        <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                          No global platform administrative permissions granted.
                        </span>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {effectivePerms.global_permissions.map((p) => (
                            <span
                              key={p}
                              style={{
                                fontSize: "12px",
                                fontFamily: "monospace",
                                padding: "2px 8px",
                                borderRadius: "4px",
                                background: "#eff6ff",
                                color: "#1d4ed8",
                                border: "1px solid #bfdbfe",
                              }}
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ERP-Scoped Effective Permissions */}
                    {effectivePerms?.erp_permissions && Object.keys(effectivePerms.erp_permissions).length > 0 && (
                      <div>
                        <strong style={{ fontSize: "13px", display: "block", marginBottom: "8px" }}>
                          ERP-Scoped Platform Permissions
                        </strong>
                        {Object.entries(effectivePerms.erp_permissions).map(([erpId, perms]) => {
                          const erp = erps.find((e) => e.id === erpId);
                          return (
                            <div key={erpId} style={{ marginBottom: "8px" }}>
                              <span style={{ fontSize: "12px", fontWeight: 600 }}>
                                {erp?.name || erpId}:
                              </span>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
                                {perms.map((p) => (
                                  <span
                                    key={p}
                                    style={{
                                      fontSize: "11px",
                                      fontFamily: "monospace",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      background: "#fef3c7",
                                      color: "#92400e",
                                    }}
                                  >
                                    {p}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </Modal>
      )}

      {/* ASSIGN ROLE MODAL */}
      <Modal
        isOpen={assignRoleModalOpen}
        onClose={() => setAssignRoleModalOpen(false)}
        title="Assign Platform Role"
      >
        <form onSubmit={handleExecuteAssignRole}>
          <div className="form-group" style={{ marginBottom: "16px" }}>
            <label className="form-label" htmlFor="select-role-key">
              Platform Role <span style={{ color: "red" }}>*</span>
            </label>
            <select
              id="select-role-key"
              required
              className="form-control"
              value={assignRoleKey}
              onChange={(e) => setAssignRoleKey(e.target.value)}
            >
              {availableRoles.map((r) => (
                <option key={r.id} value={r.role_key}>
                  {r.display_name} ({r.role_key})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: "16px" }}>
            <label className="form-label">Scope</label>
            <div style={{ display: "flex", gap: "16px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="assign-scope"
                  value="GLOBAL"
                  checked={assignScope === "GLOBAL"}
                  onChange={() => setAssignScope("GLOBAL")}
                />
                <span>GLOBAL (Platform Wide)</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="assign-scope"
                  value="ERP"
                  checked={assignScope === "ERP"}
                  onChange={() => setAssignScope("ERP")}
                />
                <span>ERP-Scoped</span>
              </label>
            </div>
          </div>

          {assignScope === "ERP" && (
            <div className="form-group" style={{ marginBottom: "20px" }}>
              <label className="form-label" htmlFor="select-assign-erp">
                Target ERP Instance <span style={{ color: "red" }}>*</span>
              </label>
              <select
                id="select-assign-erp"
                required
                className="form-control"
                value={assignErpId}
                onChange={(e) => setAssignErpId(e.target.value)}
              >
                {erps.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.erp_key})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setAssignRoleModalOpen(false)}
              disabled={assigningRole}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={assigningRole || !assignRoleKey}
            >
              {assigningRole ? "Assigning..." : "Assign Role"}
            </button>
          </div>
        </form>
      </Modal>

      {/* REVOKE ROLE CONFIRMATION */}
      <ConfirmDialog
        open={Boolean(revokeAssignmentId)}
        title="Revoke Platform Role Assignment?"
        message="This will immediately remove this platform role grant from the user. Their underlying global identity and local ERP accounts will remain intact."
        confirmLabel="Revoke Role"
        danger
        loading={revokingRole}
        onConfirm={handleRevokeRole}
        onCancel={() => setRevokeAssignmentId(null)}
      />

    </AppShell>
  );
}
