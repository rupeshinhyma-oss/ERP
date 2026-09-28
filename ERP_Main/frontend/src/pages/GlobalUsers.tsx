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
import { useNavigate, useParams } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { AppShell } from "@/components/AppShell";
import { SectionNavTabs } from "@/components/SectionNavTabs";
import { ACCESS_SECTION_TABS } from "@/lib/nav";
import {
  Banner,
  ConfirmDialog,
  EmptyState,
  LoadingSpinner,
  SkeletonTable,
  Modal,
  StatusBadge,
} from "@/components/ui";
import { ICONS } from "@/components/icons";
import type {
  ErpInstance,
  ErpMembership,
  GlobalUser,
  PlatformRoleAssignment,
} from "@/types";

const STATUS_FILTERS = [
  { value: "ALL", label: "All Statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "DISABLED", label: "Disabled" },
];

export function GlobalUsers() {
  const toast = useToast();
  const { id: routeUserId } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  const [users, setUsers] = useState<GlobalUser[]>([]);
  const [erps, setErps] = useState<ErpInstance[]>([]);
  const [allMemberships, setAllMemberships] = useState<ErpMembership[]>([]);
  const [activeConflicts, setActiveConflicts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Filters & Search
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [erpFilter, setErpFilter] = useState("ALL");

  // Create User Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createDisplayName, setCreateDisplayName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [createRole, setCreateRole] = useState("PLATFORM_ADMIN");
  const [createGrantYinglima, setCreateGrantYinglima] = useState(false);
  const [createGrantInhyma, setCreateGrantInhyma] = useState(false);
  const [creating, setCreating] = useState(false);

  // Edit User Modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<GlobalUser | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [editRole, setEditRole] = useState("PLATFORM_ADMIN");
  const [editGrantYinglima, setEditGrantYinglima] = useState(false);
  const [editGrantInhyma, setEditGrantInhyma] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // Drawer Password Visibility
  const [showDrawerPassword, setShowDrawerPassword] = useState(false);


  // User Detail Drawer / Modal
  const [detailUser, setDetailUser] = useState<GlobalUser | null>(null);
  const [userMemberships, setUserMemberships] = useState<ErpMembership[]>([]);
  const [userRoles, setUserRoles] = useState<PlatformRoleAssignment[]>([]);
  const [loadingDetailSubdata, setLoadingDetailSubdata] = useState(false);

  // Quick Disable Confirmation for regular users
  const [confirmDisableUser, setConfirmDisableUser] = useState<GlobalUser | null>(null);
  const [disablingUser, setDisablingUser] = useState(false);

  const fetchUsers = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const [usersRes, erpsRes, memsRes, conflictsRes] = await Promise.all([
        apiGet<GlobalUser[]>("/global/users?limit=250&offset=0"),
        apiGet<ErpInstance[]>("/global/erps").catch(() => []),
        apiGet<ErpMembership[]>("/global/memberships?limit=1000&offset=0").catch(() => []),
        apiGet<any[]>("/global/identity/conflicts?status=PENDING_REVIEW").catch(() => []),
      ]);
      const usersList = Array.isArray(usersRes) ? usersRes : ((usersRes as any)?.data || []);
      const erpsList = Array.isArray(erpsRes) ? erpsRes : ((erpsRes as any)?.data || []);
      const memsList = Array.isArray(memsRes) ? memsRes : ((memsRes as any)?.data || []);
      const conflictsList = Array.isArray(conflictsRes) ? conflictsRes : ((conflictsRes as any)?.data || []);
      setUsers(usersList);
      setErps(erpsList.filter((e: ErpInstance) => e.status !== "DECOMMISSIONED"));
      setAllMemberships(memsList);
      setActiveConflicts(conflictsList);
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
      const [memsRes, rolesRes] = await Promise.all([
        apiGet<ErpMembership[]>(`/global/users/${userId}/memberships`).catch(() => []),
        apiGet<PlatformRoleAssignment[]>(`/global/authz/users/${userId}/roles`).catch(() => []),
      ]);
      const rawMems = (memsRes as any)?.data ?? memsRes;
      const rawRoles = (rolesRes as any)?.data ?? rolesRes;

      setUserMemberships(Array.isArray(rawMems) ? rawMems : []);
      setUserRoles(Array.isArray(rawRoles) ? rawRoles : []);
    } catch {
      // Non-blocking
    } finally {
      setLoadingDetailSubdata(false);
    }
  }, []);

  const handleOpenDetail = (user: GlobalUser) => {
    setDetailUser(user);
    loadUserDetailData(user.id);
  };

  const handleCloseDetail = () => {
    setDetailUser(null);
    if (routeUserId) {
      navigate("/access/users", { replace: true });
    }
  };

  useEffect(() => {
    if (routeUserId && users.length > 0) {
      const found = users.find((u) => u.id === routeUserId);
      if (found) {
        setDetailUser(found);
        loadUserDetailData(found.id);
      }
    }
  }, [routeUserId, users, loadUserDetailData]);

  // Spoke ERP Resolution
  const yinglimaErp = useMemo(
    () => erps.find((e) => (e.erp_key || e.key || "").toLowerCase().includes("yinglima")),
    [erps]
  );
  const inhymaErp = useMemo(
    () => erps.find((e) => (e.erp_key || e.key || "").toLowerCase().includes("inhyma")),
    [erps]
  );

  const spokeErps = useMemo(() => {
    const list: ErpInstance[] = [];
    if (yinglimaErp) list.push(yinglimaErp);
    if (inhymaErp && inhymaErp.id !== yinglimaErp?.id) list.push(inhymaErp);
    for (const e of erps) {
      if (!list.some((x) => x.id === e.id)) {
        list.push(e);
      }
    }
    return list;
  }, [erps, yinglimaErp, inhymaErp]);

  const getUserMembershipForErp = useCallback(
    (userId: string, erpInstance?: ErpInstance | null) => {
      if (!erpInstance) return undefined;
      return allMemberships.find(
        (m) =>
          m.global_user_id === userId &&
          (m.erp_instance_id === erpInstance.id ||
            (m.erp_key || "").toLowerCase() === (erpInstance.erp_key || erpInstance.key || "").toLowerCase())
      );
    },
    [allMemberships]
  );

  const userHasConflictForErp = useCallback(
    (userId: string, erpInstance?: ErpInstance | null) => {
      if (!erpInstance) return false;
      return activeConflicts.some(
        (c) =>
          (c.global_user_id === userId || c.globalUserId === userId) &&
          (c.erp_instance_id === erpInstance.id || c.erpInstanceId === erpInstance.id)
      );
    },
    [activeConflicts]
  );

  // Check if a given user is Admin / Super Admin (who has complete platform access)
  const isRowUserAdmin = useCallback((u?: GlobalUser | null) => {
    if (!u) return false;
    const email = (u.primary_email || u.email || "").toLowerCase();
    const name = (u.display_name || "").toLowerCase();
    return (
      email === "admin@example.com" ||
      email.startsWith("admin@") ||
      name.includes("super admin") ||
      name === "admin" ||
      name === "administrator"
    );
  }, []);

  const renderErpAccessBadge = (userId: string, erp?: ErpInstance | null, userObj?: GlobalUser | null) => {
    if (!erp) return <span style={{ color: "#94a3b8", fontSize: "12px" }}>—</span>;
    if (userObj && isRowUserAdmin(userObj)) {
      return (
        <span
          className="badge badge-active"
          style={{
            backgroundColor: "#ecfdf5",
            color: "#065f46",
            border: "1px solid #a7f3d0",
            fontSize: "11px",
            fontWeight: 600,
          }}
          title="Super Admin has full platform access"
        >
          Active
        </span>
      );
    }
    const hasConflict = userHasConflictForErp(userId, erp);
    if (hasConflict) {
      return (
        <span
          className="badge"
          style={{
            backgroundColor: "#fef2f2",
            color: "#b91c1c",
            border: "1px solid #f87171",
            fontSize: "11px",
            fontWeight: 600,
          }}
          title="Identity conflict requires administrative resolution"
        >
          ⚠️ Conflict
        </span>
      );
    }
    const m = getUserMembershipForErp(userId, erp);
    if (!m || m.status === "REVOKED") {
      return (
        <span
          className="badge"
          style={{
            backgroundColor: "#f1f5f9",
            color: "#64748b",
            border: "1px solid #e2e8f0",
            fontSize: "11px",
          }}
          title="No access to this ERP"
        >
          None
        </span>
      );
    }
    if (m.status === "ACTIVE") {
      return (
        <span
          className="badge badge-active"
          style={{
            backgroundColor: "#ecfdf5",
            color: "#065f46",
            border: "1px solid #a7f3d0",
            fontSize: "11px",
            fontWeight: 600,
          }}
          title="Active access granted"
        >
          Active
        </span>
      );
    }
    if (m.status === "PENDING") {
      const isRetryable = m.metadata_json?.is_retryable || m.metadata_json?.sync_status === "FAILED";
      return (
        <span
          className="badge"
          style={{
            backgroundColor: isRetryable ? "#fef2f2" : "#fffbeb",
            color: isRetryable ? "#b91c1c" : "#92400e",
            border: `1px solid ${isRetryable ? "#fecaca" : "#fde68a"}`,
            fontSize: "11px",
          }}
          title={m.metadata_json?.sync_error ? `Sync error: ${m.metadata_json.sync_error}` : "Provisioning pending"}
        >
          {isRetryable ? "Pending (Retry)" : "Pending"}
        </span>
      );
    }
    if (m.status === "SUSPENDED") {
      return (
        <span
          className="badge"
          style={{
            backgroundColor: "#fff7ed",
            color: "#c2410c",
            border: "1px solid #fed7aa",
            fontSize: "11px",
          }}
          title="Access suspended"
        >
          Suspended
        </span>
      );
    }
    return <StatusBadge status={m.status} />;
  };

  const renderUserErpAccessCell = (u: GlobalUser) => {
    if (spokeErps.length === 0) {
      return <span style={{ color: "#94a3b8", fontSize: "12px" }}>No ERPs registered</span>;
    }

    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
        {spokeErps.map((erp) => {
          const erpFullName = erp.name || erp.display_name || erp.erp_key;
          const erpLabel = erpFullName.replace(/\s+ERP$/i, "");
          const isAdmin = isRowUserAdmin(u);
          const hasConflict = userHasConflictForErp(u.id, erp);
          const membership = getUserMembershipForErp(u.id, erp);
          const isActive = isAdmin || (membership?.status === "ACTIVE");

          let chipBg = "#f8fafc";
          let chipBorder = "#e2e8f0";
          let labelColor = "#475569";

          if (hasConflict) {
            chipBg = "#fef2f2";
            chipBorder = "#fca5a5";
            labelColor = "#991b1b";
          } else if (isActive) {
            chipBg = "#f0fdf4";
            chipBorder = "#bbf7d0";
            labelColor = "#166534";
          } else if (membership?.status === "PENDING") {
            chipBg = "#fffbeb";
            chipBorder = "#fde68a";
            labelColor = "#92400e";
          } else if (membership?.status === "SUSPENDED") {
            chipBg = "#fff7ed";
            chipBorder = "#fed7aa";
            labelColor = "#9a3412";
          }

          return (
            <div
              key={erp.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "2px 7px",
                borderRadius: "6px",
                backgroundColor: chipBg,
                border: `1px solid ${chipBorder}`,
                fontSize: "11px",
              }}
              title={`${erpFullName}: ${hasConflict ? "Conflict" : isActive ? "Active" : membership?.status || "No Access"}`}
            >
              <span style={{ fontWeight: 600, color: labelColor }}>{erpLabel}:</span>
              {renderErpAccessBadge(u.id, erp, u)}
            </div>
          );
        })}
      </div>
    );
  };


  // Check if detailUser is an Admin / Super Admin with full permanent platform access
  const isDetailUserAdmin = useMemo(() => {
    if (!detailUser) return false;
    if (isRowUserAdmin(detailUser)) return true;
    return userRoles.some(
      (r) =>
        r.is_active &&
        (r.role_key.toUpperCase() === "SUPER_ADMIN" ||
          r.role_key.toUpperCase() === "ADMIN" ||
          r.role_key.toUpperCase() === "PLATFORM_SUPER_ADMIN" ||
          r.role_key.toUpperCase() === "PLATFORM_ADMIN")
    );
  }, [detailUser, userRoles, isRowUserAdmin]);

  // Filtered Users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchesStatus =
        statusFilter === "ALL"
          ? true
          : statusFilter === "ACTIVE"
          ? u.status === "ACTIVE"
          : u.status === "DISABLED" || u.status === "SUSPENDED";
      const query = search.trim().toLowerCase();
      const email = (u.primary_email || u.email || "").toLowerCase();
      const name = (u.display_name || "").toLowerCase();
      const userRole = ((u as any).metadata?.role || "").toLowerCase();
      const matchesSearch = !query || name.includes(query) || email.includes(query) || userRole.includes(query);

      let matchesErp = true;
      if (erpFilter === "NONE") {
        if (isRowUserAdmin(u)) {
          matchesErp = false;
        } else {
          const hasAnyErpAccess =
            spokeErps.some((erp) => {
              const m = getUserMembershipForErp(u.id, erp);
              return !!m && m.status !== "REVOKED";
            }) ||
            allMemberships.some(
              (m) => m.global_user_id === u.id && m.status !== "REVOKED"
            );
          matchesErp = !hasAnyErpAccess;
        }
      } else if (erpFilter !== "ALL") {
        if (isRowUserAdmin(u)) {
          matchesErp = true;
        } else {
          const selectedErp = erps.find((e) => e.id === erpFilter);
          const m = getUserMembershipForErp(u.id, selectedErp);
          matchesErp = !!m && m.status !== "REVOKED";
        }
      }

      return matchesStatus && matchesSearch && matchesErp;
    });
  }, [users, statusFilter, erpFilter, search, isRowUserAdmin, erps, spokeErps, allMemberships, getUserMembershipForErp]);

  // Create User with optional initial ERP access grants
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createEmail.trim() || !createDisplayName.trim()) return;
    setCreating(true);
    let createdUser: GlobalUser | null = null;
    try {
      const res = await apiPost<GlobalUser>("/global/users", {
        primary_email: createEmail.trim().toLowerCase(),
        display_name: createDisplayName.trim(),
        external_identity_id: null,
      });
      createdUser = (res as any)?.data ?? res;
      toast("Global user created successfully.", "success");
    } catch (err) {
      toast("Failed to create user: " + (err instanceof Error ? err.message : String(err)), "error");
      setCreating(false);
      return;
    }

    if (createdUser && createdUser.id) {
      // Save password and role metadata
      if (createPassword.trim() || createRole) {
        try {
          await apiPatch(`/global/users/${createdUser.id}`, {
            metadata: {
              ...(createPassword.trim() ? { default_password: createPassword.trim() } : {}),
              role: createRole,
            },
          });
        } catch {
          // Non-blocking metadata save
        }
      }

      // Assign platform role in authz
      if (createRole) {
        try {
          await apiPost(`/global/authz/users/${createdUser.id}/roles`, {
            role_key: createRole,
            scope: "GLOBAL",
          });
        } catch {
          // Non-blocking
        }
      }

      if (createGrantYinglima && yinglimaErp) {
        try {
          await apiPost(`/global/users/${createdUser.id}/provision`, { erp_instance_id: yinglimaErp.id });
          toast("Provisioned into Yinglima ERP.", "success");
        } catch (pErr) {
          toast(`Yinglima provisioning warning: ${pErr instanceof Error ? pErr.message : String(pErr)}`, "warning");
        }
      }
      if (createGrantInhyma && inhymaErp) {
        try {
          await apiPost(`/global/users/${createdUser.id}/provision`, { erp_instance_id: inhymaErp.id });
          toast("Provisioned into Inhyma ERP.", "success");
        } catch (pErr) {
          toast(`Inhyma provisioning warning: ${pErr instanceof Error ? pErr.message : String(pErr)}`, "warning");
        }
      }
    }

    setCreateModalOpen(false);
    setCreateDisplayName("");
    setCreateEmail("");
    setCreatePassword("");
    setShowCreatePassword(false);
    setCreateRole("PLATFORM_ADMIN");
    setCreateGrantYinglima(false);
    setCreateGrantInhyma(false);
    setCreating(false);
    await fetchUsers(true);
  };

  // Edit User
  const handleOpenEdit = (user: GlobalUser) => {
    setEditingUser(user);
    setEditDisplayName(user.display_name || "");
    setEditEmail(user.primary_email || user.email || "");
    const userMeta = (user as any).metadata || (user as any).metadata_json || {};
    const isAdmin = isRowUserAdmin(user);
    setEditPassword(userMeta.default_password || userMeta.password || (isAdmin ? "ChangeMe!12345" : ""));
    setShowEditPassword(false);
    setEditRole(userMeta.role || (isAdmin ? "PLATFORM_SUPER_ADMIN" : "PLATFORM_ADMIN"));

    if (isAdmin) {
      setEditGrantYinglima(true);
      setEditGrantInhyma(true);
    } else {
      const yinglimaMem = getUserMembershipForErp(user.id, yinglimaErp);
      const inhymaMem = getUserMembershipForErp(user.id, inhymaErp);
      setEditGrantYinglima(!!yinglimaMem && yinglimaMem.status !== "REVOKED");
      setEditGrantInhyma(!!inhymaMem && inhymaMem.status !== "REVOKED");
    }

    setEditModalOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSavingEdit(true);
    try {
      const existingMeta = (editingUser as any).metadata || (editingUser as any).metadata_json || {};
      const updatedMeta = {
        ...existingMeta,
        default_password: editPassword.trim(),
        role: editRole,
      };

      await apiPatch(`/global/users/${editingUser.id}`, {
        display_name: editDisplayName.trim() || undefined,
        primary_email: !isRowUserAdmin(editingUser) ? (editEmail.trim().toLowerCase() || undefined) : undefined,
        metadata: updatedMeta,
      });

      if (editRole) {
        try {
          await apiPost(`/global/authz/users/${editingUser.id}/roles`, {
            role_key: editRole,
            scope: "GLOBAL",
          });
        } catch {
          // Non-blocking
        }
      }

      // Handle ERP Access Grants changes
      if (!isRowUserAdmin(editingUser)) {
        const yinglimaMem = getUserMembershipForErp(editingUser.id, yinglimaErp);
        if (editGrantYinglima && (!yinglimaMem || yinglimaMem.status === "REVOKED") && yinglimaErp) {
          try {
            await apiPost(`/global/users/${editingUser.id}/provision`, { erp_instance_id: yinglimaErp.id });
          } catch (err) {
            toast(`Yinglima provisioning warning: ${err instanceof Error ? err.message : String(err)}`, "warning");
          }
        } else if (!editGrantYinglima && yinglimaMem) {
          try {
            await apiDelete(`/global/memberships/${yinglimaMem.id}`);
          } catch (delErr) {
            console.error("Failed to delete Yinglima membership:", delErr);
            // Fallback: try revoking if delete endpoint fails
            try {
              await apiPost(`/global/memberships/${yinglimaMem.id}/revoke`, { reason: "Access removed" });
            } catch {
              // Ignore fallback error
            }
          }
        }

        const inhymaMem = getUserMembershipForErp(editingUser.id, inhymaErp);
        if (editGrantInhyma && (!inhymaMem || inhymaMem.status === "REVOKED") && inhymaErp) {
          try {
            await apiPost(`/global/users/${editingUser.id}/provision`, { erp_instance_id: inhymaErp.id });
          } catch (err) {
            toast(`Inhyma provisioning warning: ${err instanceof Error ? err.message : String(err)}`, "warning");
          }
        } else if (!editGrantInhyma && inhymaMem) {
          try {
            await apiDelete(`/global/memberships/${inhymaMem.id}`);
          } catch (delErr) {
            console.error("Failed to delete Inhyma membership:", delErr);
            // Fallback: try revoking if delete endpoint fails
            try {
              await apiPost(`/global/memberships/${inhymaMem.id}/revoke`, { reason: "Access removed" });
            } catch {
              // Ignore fallback error
            }
          }
        }
      }

      toast("Global user updated successfully.", "success");
      setEditModalOpen(false);
      setEditingUser(null);
      await fetchUsers(true);
      if (detailUser && detailUser.id === editingUser.id) {
        setDetailUser((prev) => (prev ? { 
          ...prev, 
          display_name: editDisplayName,
          primary_email: !isRowUserAdmin(editingUser) ? editEmail.trim().toLowerCase() : prev.primary_email,
          metadata: updatedMeta,
          metadata_json: updatedMeta,
        } : null));
        await loadUserDetailData(editingUser.id);
      }
    } catch (err) {
      toast("Failed to update user: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setSavingEdit(false);
    }
  };

  // Quick Disable / Enable for Added/Regular Users
  const handleExecuteDisable = async () => {
    if (!confirmDisableUser || isRowUserAdmin(confirmDisableUser)) return;
    setDisablingUser(true);
    try {
      await apiPatch(`/global/users/${confirmDisableUser.id}/status`, {
        status: "DISABLED",
      });
      toast(`User ${confirmDisableUser.display_name} has been disabled.`, "info");
      setConfirmDisableUser(null);
      await fetchUsers(true);
      if (detailUser && detailUser.id === confirmDisableUser.id) {
        setDetailUser((prev) => (prev ? { ...prev, status: "DISABLED" } : null));
      }
    } catch (err) {
      toast("Failed to disable user: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setDisablingUser(false);
    }
  };

  const handleEnableUser = async (u: GlobalUser) => {
    try {
      await apiPatch(`/global/users/${u.id}/status`, {
        status: "ACTIVE",
      });
      toast(`User ${u.display_name} enabled and restored to active status.`, "success");
      await fetchUsers(true);
      if (detailUser && detailUser.id === u.id) {
        setDetailUser((prev) => (prev ? { ...prev, status: "ACTIVE" } : null));
      }
    } catch (err) {
      toast("Failed to enable user: " + (err instanceof Error ? err.message : String(err)), "error");
    }
  };

  return (
    <AppShell
      activeKey="users"
      pageTitle="Global Users"
      pageSubtitle="Manage global platform identities, authentication status, and ERP memberships."
      breadcrumbs={["User & Access", "Global Users"]}
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
      <SectionNavTabs items={ACCESS_SECTION_TABS} activeKey="users" />

      <Banner error={error} />

      {/* Unified Table Card with Integrated Search Toolbar */}
      <div className="card" style={{ padding: 0, overflow: "hidden", border: "1px solid var(--color-border, #e2e8f0)", borderRadius: "10px", boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)" }}>
        {/* Filter and Search Bar */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--color-border, #e2e8f0)",
            background: "var(--color-surface, #ffffff)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <div style={{ position: "relative", width: "320px" }}>
              <span
                style={{
                  position: "absolute",
                  left: "11px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--color-muted, #94a3b8)",
                  display: "flex",
                  pointerEvents: "none",
                }}
              >
                <ICONS.search width={15} height={15} />
              </span>
              <input
                type="text"
                id="input-search-users"
                placeholder="Search by name, email or ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: "100%",
                  height: "36px",
                  paddingLeft: "34px",
                  paddingRight: search ? "28px" : "12px",
                  fontSize: "13px",
                  color: "var(--color-text, #1e293b)",
                  background: "var(--color-surface, #ffffff)",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  outline: "none",
                  boxSizing: "border-box",
                  transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  style={{
                    position: "absolute",
                    right: "8px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#94a3b8",
                    padding: "2px",
                    display: "flex",
                  }}
                  title="Clear search"
                >
                  <ICONS.x width={14} height={14} />
                </button>
              )}
            </div>

            <select
              id="select-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                width: "140px",
                height: "36px",
                fontSize: "13px",
                color: "#334155",
                background: "#ffffff",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                paddingLeft: "10px",
                paddingRight: "30px",
                cursor: "pointer",
                outline: "none",
                boxSizing: "border-box",
              }}
            >
              {STATUS_FILTERS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <select
              id="select-erp-filter"
              value={erpFilter}
              onChange={(e) => setErpFilter(e.target.value)}
              title="Filter by ERP"
              style={{
                width: "150px",
                height: "36px",
                fontSize: "13px",
                color: "#334155",
                background: "#ffffff",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                paddingLeft: "10px",
                paddingRight: "25px",
                cursor: "pointer",
                outline: "none",
                boxSizing: "border-box",
              }}
            >
              <option value="ALL">All ERP's</option>
              {spokeErps.map((erp) => (
                <option key={erp.id} value={erp.id}>
                  {erp.name || erp.display_name || erp.erp_key}
                </option>
              ))}
              <option value="NONE">None</option>
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "13px", color: "var(--color-muted, #64748b)", fontWeight: 500 }}>
              Showing <strong style={{ color: "var(--color-text, #1e293b)" }}>{filteredUsers.length}</strong> {filteredUsers.length === 1 ? "user" : "users"}
            </span>
          </div>
        </div>

        {/* Users Table */}
        {loading ? (
          <div style={{ padding: "20px" }}>
            <SkeletonTable rows={8} cols={6} />
          </div>
        ) : filteredUsers.length === 0 ? (
          <div style={{ padding: "40px 20px" }}>
            <EmptyState
              title="No Global Users Found"
              description={
                search || statusFilter !== "ALL" || erpFilter !== "ALL"
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
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table" style={{ margin: 0 }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                  <th style={{ width: "22%", padding: "12px 16px", fontSize: "11.5px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>Global Identity</th>
                  <th style={{ width: "18%", padding: "12px 16px", fontSize: "11.5px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>Primary Email</th>
                  <th style={{ width: "10%", padding: "12px 16px", fontSize: "11.5px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>Status</th>
                  <th style={{ width: "26%", padding: "12px 16px", fontSize: "11.5px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>ERP's Access</th>
                  <th style={{ width: "10%", padding: "12px 16px", fontSize: "11.5px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>Updated</th>
                  <th style={{ width: "14%", padding: "12px 16px", fontSize: "11.5px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right" }}>Actions</th>
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
                    <tr
                      key={u.id}
                      id={`user-row-${u.id}`}
                      style={{ transition: "background-color 0.12s ease" }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f8fafc")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div
                            style={{
                              width: "36px",
                              height: "36px",
                              borderRadius: "8px",
                              background: "linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)",
                              color: "#3730a3",
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
                              onMouseEnter={(e) => (e.currentTarget.style.color = "#2563eb")}
                              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text)")}
                            >
                              {u.display_name}
                            </div>
                            {(() => {
                              const isAdmin = isRowUserAdmin(u);
                              const userRole = (u as any).metadata?.role || (isAdmin ? "PLATFORM_SUPER_ADMIN" : "PLATFORM_ADMIN");
                              const roleBadgeLabel = isAdmin || userRole === "PLATFORM_SUPER_ADMIN"
                                ? "👑 Super Admin"
                                : userRole === "PLATFORM_ADMIN"
                                ? "🛡️ Platform Admin"
                                : userRole === "PLATFORM_OPERATOR"
                                ? "⚡ Operator"
                                : "👁️ Viewer";
                              return (
                                <span
                                  style={{
                                    display: "inline-block",
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    color: isAdmin ? "#4f46e5" : "#64748b",
                                    marginTop: "1px",
                                  }}
                                >
                                  {roleBadgeLabel}
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontFamily: "monospace", fontSize: "13px", color: "var(--color-text)" }}>{email}</span>
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
                              display: "flex",
                            }}
                          >
                            <ICONS.copy width={12} height={12} />
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <StatusBadge status={u.status} />
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        {renderUserErpAccessCell(u)}
                      </td>
                      <td style={{ fontSize: "12px", color: "var(--color-muted)", padding: "12px 16px" }}>
                        {u.updated_at
                          ? new Date(u.updated_at).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : u.created_at
                          ? new Date(u.created_at).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—"}
                      </td>
                      <td style={{ textAlign: "right", padding: "12px 16px" }}>
                        <div style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleOpenDetail(u)}
                            title="View User Details & Ecosystem Access"
                            style={{ fontSize: "12px", padding: "4px 10px", borderRadius: "5px", fontWeight: 500 }}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleOpenEdit(u)}
                            title="Edit user profile"
                            style={{ fontSize: "12px", padding: "4px 10px", borderRadius: "5px", fontWeight: 500 }}
                          >
                            Edit
                          </button>
                          {!isRowUserAdmin(u) && (
                            u.status === "DISABLED" || u.status === "SUSPENDED" ? (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleEnableUser(u)}
                                title="Enable user account"
                                style={{
                                  fontSize: "12px",
                                  padding: "4px 10px",
                                  borderRadius: "5px",
                                  fontWeight: 500,
                                  color: "#059669",
                                  borderColor: "#a7f3d0",
                                  backgroundColor: "#ecfdf5",
                                  cursor: "pointer",
                                }}
                              >
                                Enable
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => setConfirmDisableUser(u)}
                                title="Disable user account"
                                style={{
                                  fontSize: "12px",
                                  padding: "4px 10px",
                                  borderRadius: "5px",
                                  fontWeight: 500,
                                  color: "#dc2626",
                                  borderColor: "#fecaca",
                                  backgroundColor: "#fef2f2",
                                  cursor: "pointer",
                                }}
                              >
                                Disable
                              </button>
                            )
                          )}
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

      {/* CREATE USER MODAL */}
      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create Global User"
        variant="drawer"
        cardStyle={{ maxWidth: "540px" }}
      >
        <form onSubmit={handleCreateUser}>
          <div className="modal-form-content">
            <div className="form-group">
              <label className="form-label" htmlFor="create-display-name">
                Full Name / Display Name <span style={{ color: "var(--color-danger, #ef4444)" }}>*</span>
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

            <div className="form-group">
              <label className="form-label" htmlFor="create-email">
                Primary Email <span style={{ color: "var(--color-danger, #ef4444)" }}>*</span>
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
              <span className="form-helper">
                Global human identity identifier. Email is normalized and deduplicated across the ecosystem.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="create-password">
                Password
              </label>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input
                  type={showCreatePassword ? "text" : "password"}
                  id="create-password"
                  className="form-control"
                  placeholder="Enter initial password"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  style={{ paddingRight: "40px", fontFamily: showCreatePassword ? "inherit" : "monospace" }}
                />
                <button
                  type="button"
                  onClick={() => setShowCreatePassword(!showCreatePassword)}
                  style={{
                    position: "absolute",
                    right: "8px",
                    background: "transparent",
                    border: "none",
                    color: "#64748b",
                    cursor: "pointer",
                    padding: "4px",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title={showCreatePassword ? "Hide password" : "Show password"}
                >
                  {showCreatePassword ? <ICONS.eyeOff width={16} height={16} /> : <ICONS.eye width={16} height={16} />}
                </button>
              </div>
              <span className="form-helper">
                Initial password assigned to this user for platform and single sign-on access.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="create-role">
                Platform Role <span style={{ color: "var(--color-danger, #ef4444)" }}>*</span>
              </label>
              <select
                id="create-role"
                className="form-control"
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value)}
              >
                <option value="PLATFORM_SUPER_ADMIN">👑 Platform Super Admin (Full Root System Access)</option>
                <option value="PLATFORM_ADMIN">🛡️ Platform Admin (Manage Users & Configuration)</option>
                <option value="PLATFORM_OPERATOR">⚡ Platform Operator (Monitor & Manage Sync/ERPs)</option>
                <option value="PLATFORM_VIEWER">👁️ Platform Viewer (Read-only System Auditing)</option>
              </select>
              <span className="form-helper">
                Central role governing access level across the ERP_Main control plane.
              </span>
            </div>

            <div className="form-group" style={{ marginTop: "16px", borderTop: "1px solid #f1f5f9", paddingTop: "14px" }}>
              <label className="form-label" style={{ marginBottom: "8px", fontWeight: 600 }}>
                ERP Access Grants
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    id="create-grant-yinglima"
                    checked={createGrantYinglima}
                    onChange={(e) => setCreateGrantYinglima(e.target.checked)}
                    disabled={!yinglimaErp}
                  />
                  <span>
                    Grant <strong>Yinglima ERP</strong> Access {yinglimaErp ? `(${yinglimaErp.erp_key || yinglimaErp.key})` : "(Not registered)"}
                  </span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    id="create-grant-inhyma"
                    checked={createGrantInhyma}
                    onChange={(e) => setCreateGrantInhyma(e.target.checked)}
                    disabled={!inhymaErp}
                  />
                  <span>
                    Grant <strong>Inhyma ERP</strong> Access {inhymaErp ? `(${inhymaErp.erp_key || inhymaErp.key})` : "(Not registered)"}
                  </span>
                </label>
              </div>
              <span className="form-helper" style={{ marginTop: "6px" }}>
                Select which ERP systems this user is granted access to. Unselected ERPs will not be accessible to this user.
              </span>
            </div>
          </div>

          <div className="modal-footer form-actions">
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
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Edit Global User Metadata"
        variant="drawer"
        cardStyle={{ maxWidth: "540px" }}
        zIndex={2300}
      >
        <form onSubmit={handleSaveEdit}>
          <div className="modal-form-content">
            <div className="form-group">
              <label className="form-label" htmlFor="edit-display-name">
                Display Name <span style={{ color: "var(--color-danger, #ef4444)" }}>*</span>
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

            <div className="form-group">
              {isRowUserAdmin(editingUser) ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                    <label className="form-label" htmlFor="edit-email" style={{ margin: 0 }}>
                      Primary Email <span style={{ color: "var(--color-danger, #ef4444)" }}>*</span>
                    </label>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "#64748b",
                        backgroundColor: "#f1f5f9",
                        padding: "2px 6px",
                        borderRadius: "4px",
                      }}
                    >
                      <ICONS.lock width={11} height={11} color="#64748b" />
                      Locked (Super Admin)
                    </span>
                  </div>
                  <div style={{ position: "relative" }}>
                    <input
                      type="email"
                      id="edit-email"
                      readOnly
                      disabled
                      className="form-control"
                      value={editEmail}
                      style={{
                        backgroundColor: "#f8fafc",
                        borderColor: "#e2e8f0",
                        color: "#475569",
                        cursor: "not-allowed",
                        paddingRight: "36px",
                        fontWeight: 500,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        right: "10px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "#94a3b8",
                        display: "flex",
                        alignItems: "center",
                      }}
                      title="Super Admin email is locked for ecosystem identity integrity"
                    >
                      <ICONS.lock width={14} height={14} />
                    </div>
                  </div>
                  <span className="form-helper">
                    Super Admin primary identity email is permanently protected to guarantee platform access.
                  </span>
                </>
              ) : (
                <>
                  <label className="form-label" htmlFor="edit-email">
                    Primary Email <span style={{ color: "var(--color-danger, #ef4444)" }}>*</span>
                  </label>
                  <input
                    type="email"
                    id="edit-email"
                    required
                    className="form-control"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="e.g. user@company.com"
                  />
                  <span className="form-helper">
                    Primary identity email used for ecosystem SSO and authentication.
                  </span>
                </>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="edit-password">
                Password
              </label>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input
                  type={showEditPassword ? "text" : "password"}
                  id="edit-password"
                  className="form-control"
                  placeholder="Enter user password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  style={{ paddingRight: "76px", fontFamily: showEditPassword ? "inherit" : "monospace" }}
                />
                <div style={{ position: "absolute", right: "6px", display: "flex", alignItems: "center", gap: "2px" }}>
                  <button
                    type="button"
                    onClick={() => setShowEditPassword(!showEditPassword)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#64748b",
                      cursor: "pointer",
                      padding: "5px",
                      display: "flex",
                      alignItems: "center",
                      borderRadius: "4px",
                    }}
                    title={showEditPassword ? "Hide password" : "Show password"}
                  >
                    {showEditPassword ? <ICONS.eyeOff width={16} height={16} /> : <ICONS.eye width={16} height={16} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (editPassword) {
                        navigator.clipboard.writeText(editPassword);
                        toast("Password copied to clipboard.", "info");
                      }
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#64748b",
                      cursor: "pointer",
                      padding: "5px",
                      display: "flex",
                      alignItems: "center",
                      borderRadius: "4px",
                    }}
                    title="Copy password"
                  >
                    <ICONS.copy width={14} height={14} />
                  </button>
                </div>
              </div>
              <span className="form-helper">
                User authentication password for ecosystem logins and single sign-on access.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="edit-role">
                Platform Role <span style={{ color: "var(--color-danger, #ef4444)" }}>*</span>
              </label>
              <select
                id="edit-role"
                className="form-control"
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
              >
                <option value="PLATFORM_SUPER_ADMIN">👑 Platform Super Admin (Full Root System Access)</option>
                <option value="PLATFORM_ADMIN">🛡️ Platform Admin (Manage Users & Configuration)</option>
                <option value="PLATFORM_OPERATOR">⚡ Platform Operator (Monitor & Manage Sync/ERPs)</option>
                <option value="PLATFORM_VIEWER">👁️ Platform Viewer (Read-only System Auditing)</option>
              </select>
              <span className="form-helper">
                Central role governing authorization level across ERP_Main control plane.
              </span>
            </div>

            <div className="form-group" style={{ marginTop: "16px", borderTop: "1px solid #f1f5f9", paddingTop: "14px" }}>
              <label className="form-label" style={{ marginBottom: "8px", fontWeight: 600 }}>
                ERP Access Grants
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", cursor: isRowUserAdmin(editingUser) ? "default" : "pointer" }}>
                  <input
                    type="checkbox"
                    id="edit-grant-yinglima"
                    checked={editGrantYinglima}
                    onChange={(e) => setEditGrantYinglima(e.target.checked)}
                    disabled={!yinglimaErp || isRowUserAdmin(editingUser)}
                  />
                  <span>
                    Grant <strong>Yinglima ERP</strong> Access {yinglimaErp ? `(${yinglimaErp.erp_key || yinglimaErp.key})` : "(Not registered)"}
                    {isRowUserAdmin(editingUser) && " — Full Root Access"}
                  </span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", cursor: isRowUserAdmin(editingUser) ? "default" : "pointer" }}>
                  <input
                    type="checkbox"
                    id="edit-grant-inhyma"
                    checked={editGrantInhyma}
                    onChange={(e) => setEditGrantInhyma(e.target.checked)}
                    disabled={!inhymaErp || isRowUserAdmin(editingUser)}
                  />
                  <span>
                    Grant <strong>Inhyma ERP</strong> Access {inhymaErp ? `(${inhymaErp.erp_key || inhymaErp.key})` : "(Not registered)"}
                    {isRowUserAdmin(editingUser) && " — Full Root Access"}
                  </span>
                </label>
              </div>
              <span className="form-helper" style={{ marginTop: "6px" }}>
                {isRowUserAdmin(editingUser)
                  ? "Platform Super Admin possesses global root authority across all connected ERPs."
                  : "Select which ERP systems this user is granted access to. Removing access completely deprovisions and removes the user from that ERP."}
              </span>
            </div>
          </div>

          <div className="modal-footer form-actions">
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

      {/* USER DETAIL MODAL / DRAWER (VIEW ONLY WITH EDIT) */}
      {detailUser && (
        <Modal
          open={Boolean(detailUser)}
          onClose={handleCloseDetail}
          title={`Global User: ${detailUser.display_name}`}
          subtitle="Platform Identity & Unified Access Control"
          headerAction={
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleOpenEdit(detailUser)}
                style={{
                  fontSize: "12px",
                  padding: "5px 12px",
                  borderRadius: "6px",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  backgroundColor: "#ffffff",
                  border: "1px solid #cbd5e1",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                  cursor: "pointer",
                }}
                title="Edit this user profile"
              >
                <ICONS.edit width={13} height={13} />
                Edit Profile
              </button>
            </div>
          }
        >
          <div>
            {loadingDetailSubdata ? (
              <LoadingSpinner text="Loading user details..." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    {/* Hero Identity Card */}
                    <div
                      style={{
                        background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
                        border: "1px solid #e2e8f0",
                        borderRadius: "10px",
                        padding: "16px 20px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "16px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                        <div
                          style={{
                            width: "48px",
                            height: "48px",
                            borderRadius: "50%",
                            background: isDetailUserAdmin
                              ? "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)"
                              : "linear-gradient(135deg, #0284c7 0%, #2563eb 100%)",
                            color: "#ffffff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 700,
                            fontSize: "16px",
                            boxShadow: "0 2px 6px rgba(0, 97, 242, 0.2)",
                            flexShrink: 0,
                          }}
                        >
                          {detailUser.display_name
                            ? detailUser.display_name
                                .trim()
                                .split(/\s+/)
                                .map((n) => n[0])
                                .slice(0, 2)
                                .join("")
                                .toUpperCase()
                            : "GU"}
                        </div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <h4 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                              {detailUser.display_name}
                            </h4>
                            <StatusBadge status={detailUser.status} />
                            {isDetailUserAdmin && (
                              <span
                                style={{
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  padding: "2px 8px",
                                  borderRadius: "4px",
                                  backgroundColor: "#ede9fe",
                                  color: "#5b21b6",
                                  border: "1px solid #ddd6fe",
                                }}
                              >
                                👑 System Admin
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                            <span style={{ fontSize: "13px", color: "#475569", fontWeight: 500 }}>
                              {detailUser.primary_email || detailUser.email || "—"}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const emailToCopy = detailUser.primary_email || detailUser.email || "";
                                if (emailToCopy) {
                                  navigator.clipboard.writeText(emailToCopy);
                                  toast("Email copied to clipboard.", "info");
                                }
                              }}
                              style={{
                                background: "transparent",
                                border: "none",
                                color: "#94a3b8",
                                cursor: "pointer",
                                padding: "2px",
                                display: "inline-flex",
                                alignItems: "center",
                              }}
                              title="Copy email to clipboard"
                            >
                              <ICONS.copy width={12} height={12} />
                            </button>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleOpenEdit(detailUser)}
                        style={{
                          fontSize: "12px",
                          padding: "6px 14px",
                          borderRadius: "6px",
                          fontWeight: 600,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          backgroundColor: "#ffffff",
                          border: "1px solid #cbd5e1",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      >
                        <ICONS.edit width={13} height={13} />
                        Edit Profile
                      </button>
                    </div>

                    {/* Security & Identity Card */}
                    <div
                      style={{
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "10px",
                        padding: "16px 20px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "14px",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid #f1f5f9", paddingBottom: "10px" }}>
                        <ICONS.shield width={15} height={15} color="#0061f2" />
                        <strong style={{ fontSize: "12.5px", color: "#334155", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          Platform Identity & Security
                        </strong>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 20px" }}>
                        <div>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                            Platform User ID
                          </span>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                            <code
                              style={{
                                fontFamily: "monospace",
                                fontSize: "11.5px",
                                background: "#f8fafc",
                                padding: "3px 8px",
                                borderRadius: "4px",
                                border: "1px solid #e2e8f0",
                                color: "#334155",
                                wordBreak: "break-all",
                              }}
                            >
                              {detailUser.id}
                            </code>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(detailUser.id);
                                toast("Platform User ID copied.", "info");
                              }}
                              style={{
                                background: "transparent",
                                border: "none",
                                color: "#94a3b8",
                                cursor: "pointer",
                                padding: "2px",
                                display: "inline-flex",
                              }}
                              title="Copy Platform User ID"
                            >
                              <ICONS.copy width={12} height={12} />
                            </button>
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                            Password
                          </span>
                          <div style={{ marginTop: "4px", fontSize: "12.5px", color: "#1e293b", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontFamily: "monospace", fontSize: "13px", letterSpacing: showDrawerPassword ? "0.02em" : "0.15em", color: "#334155" }}>
                              {showDrawerPassword
                                ? ((detailUser as any)?.metadata?.default_password || (isRowUserAdmin(detailUser) ? "ChangeMe!12345" : "—"))
                                : "••••••••••••"}
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowDrawerPassword(!showDrawerPassword)}
                              style={{
                                background: "transparent",
                                border: "none",
                                color: "#64748b",
                                cursor: "pointer",
                                padding: "2px 4px",
                                display: "inline-flex",
                                alignItems: "center",
                                borderRadius: "4px",
                              }}
                              title={showDrawerPassword ? "Hide password" : "Show password"}
                            >
                              {showDrawerPassword ? <ICONS.eyeOff width={13} height={13} /> : <ICONS.eye width={13} height={13} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const pwd = (detailUser as any)?.metadata?.default_password || (isRowUserAdmin(detailUser) ? "ChangeMe!12345" : "");
                                if (pwd) {
                                  navigator.clipboard.writeText(pwd);
                                  toast("Password copied to clipboard.", "info");
                                } else {
                                  toast("No password configured for this user.", "warning");
                                }
                              }}
                              style={{
                                background: "transparent",
                                border: "none",
                                color: "#64748b",
                                cursor: "pointer",
                                padding: "2px 4px",
                                display: "inline-flex",
                                alignItems: "center",
                                borderRadius: "4px",
                              }}
                              title="Copy password"
                            >
                              <ICONS.copy width={12} height={12} />
                            </button>
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                            Platform Role
                          </span>
                          <div style={{ marginTop: "4px", fontSize: "12.5px", color: "#1e293b", fontWeight: 600 }}>
                            {isDetailUserAdmin ? (
                              <span style={{ color: "#4f46e5", display: "inline-flex", alignItems: "center", gap: "5px" }}>
                                👑 Super Admin
                              </span>
                            ) : (
                              <span style={{ color: "#0369a1", display: "inline-flex", alignItems: "center", gap: "5px" }}>
                                🛡️ {((detailUser as any)?.metadata?.role || "PLATFORM_ADMIN").replace("PLATFORM_", "")}
                              </span>
                            )}
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                            Created At
                          </span>
                          <div style={{ marginTop: "4px", fontSize: "12.5px", color: "#334155" }}>
                            {detailUser.created_at ? new Date(detailUser.created_at).toLocaleString() : "—"}
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                            Updated At
                          </span>
                          <div style={{ marginTop: "4px", fontSize: "12.5px", color: "#334155" }}>
                            {detailUser.updated_at ? new Date(detailUser.updated_at).toLocaleString() : "—"}
                          </div>
                        </div>
                      </div>

                      {/* Status Governance Footer */}
                      <div
                        style={{
                          marginTop: "2px",
                          paddingTop: "12px",
                          borderTop: "1px solid #f1f5f9",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          gap: "10px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                            Account Status:
                          </span>
                          <StatusBadge status={detailUser.status} />
                        </div>

                        {!isDetailUserAdmin ? (
                          detailUser.status === "DISABLED" || detailUser.status === "SUSPENDED" ? (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleEnableUser(detailUser)}
                              style={{
                                fontSize: "12px",
                                padding: "4px 12px",
                                borderRadius: "5px",
                                fontWeight: 600,
                                color: "#059669",
                                borderColor: "#a7f3d0",
                                backgroundColor: "#ecfdf5",
                                cursor: "pointer",
                              }}
                            >
                              Enable Account
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setConfirmDisableUser(detailUser)}
                              style={{
                                fontSize: "12px",
                                padding: "4px 12px",
                                borderRadius: "5px",
                                fontWeight: 600,
                                color: "#dc2626",
                                borderColor: "#fecaca",
                                backgroundColor: "#fef2f2",
                                cursor: "pointer",
                              }}
                            >
                              Disable Account
                            </button>
                          )
                        ) : (
                          <span style={{ fontSize: "12px", color: "#059669", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "5px" }}>
                            <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#10b981" }} />
                            Protected Platform Administrator
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Ecosystem Footprint Card */}
                    <div
                      style={{
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "10px",
                        padding: "16px 20px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <ICONS.globe width={15} height={15} color="#0061f2" />
                          <strong style={{ fontSize: "12.5px", color: "#334155", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            Ecosystem Footprint
                          </strong>
                        </div>
                        <span style={{ fontSize: "12px", color: "#64748b" }}>
                          {userMemberships.length} linked environment{userMemberships.length === 1 ? "" : "s"}
                        </span>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                        {/* ERP Memberships summary */}
                        <div
                          style={{
                            padding: "12px 14px",
                            background: "#f8fafc",
                            borderRadius: "8px",
                            border: "1px solid #e2e8f0",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                            <span style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>
                              Linked ERPs ({userMemberships.length})
                            </span>
                          </div>
                          {userMemberships.length === 0 ? (
                            <div style={{ fontSize: "12px", color: "#94a3b8" }}>No ERP memberships linked yet.</div>
                          ) : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                              {userMemberships.map((m) => {
                                const erp = erps.find((e) => e.id === m.erp_instance_id);
                                return (
                                  <span
                                    key={m.id}
                                    style={{
                                      fontSize: "11px",
                                      padding: "3px 8px",
                                      borderRadius: "4px",
                                      backgroundColor: "#ffffff",
                                      border: "1px solid #cbd5e1",
                                      color: "#334155",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "4px",
                                    }}
                                  >
                                    <span style={{ width: "5px", height: "5px", borderRadius: "50%", backgroundColor: m.status === "ACTIVE" ? "#10b981" : "#f59e0b" }} />
                                    {erp?.name || m.erp_name || "Business ERP"}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Platform Roles summary */}
                        <div
                          style={{
                            padding: "12px 14px",
                            background: "#f8fafc",
                            borderRadius: "8px",
                            border: "1px solid #e2e8f0",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                            <span style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>
                              Platform Roles ({userRoles.filter((r) => r.is_active).length})
                            </span>
                          </div>
                          {userRoles.filter((r) => r.is_active).length === 0 ? (
                            <div style={{ fontSize: "12px", color: "#94a3b8" }}>Standard baseline permissions.</div>
                          ) : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                              {userRoles.filter((r) => r.is_active).map((r) => (
                                <span
                                  key={r.id}
                                  style={{
                                    fontSize: "11px",
                                    padding: "3px 8px",
                                    borderRadius: "4px",
                                    backgroundColor: r.scope === "GLOBAL" ? "#ede9fe" : "#fef3c7",
                                    color: r.scope === "GLOBAL" ? "#5b21b6" : "#92400e",
                                    border: `1px solid ${r.scope === "GLOBAL" ? "#ddd6fe" : "#fde68a"}`,
                                    fontWeight: 600,
                                  }}
                                >
                                  {r.role_key}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
            )}
          </div>
        </Modal>
      )}

      {/* CONFIRM DISABLE USER MODAL */}
      <ConfirmDialog
        open={Boolean(confirmDisableUser)}
        title="Disable User Account?"
        message={
          confirmDisableUser
            ? `Are you sure you want to disable ${confirmDisableUser.display_name} (${confirmDisableUser.primary_email || confirmDisableUser.email})? The user will be blocked from logging into the platform and accessing linked ERP accounts.`
            : ""
        }
        confirmLabel="Disable User"
        danger
        loading={disablingUser}
        onConfirm={handleExecuteDisable}
        onCancel={() => setConfirmDisableUser(null)}
      />


    </AppShell>
  );
}
