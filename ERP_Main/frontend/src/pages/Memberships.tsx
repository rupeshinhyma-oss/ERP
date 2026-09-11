/**
 * ERP Memberships Management Page for ERP_Main Control Plane.
 *
 * Manages identity bindings between Global Users (Control Plane) and Local ERP Accounts.
 * Strict Architecture: GlobalUser != ErpMembership != Local ERP User.
 *
 * Local ERP RBAC remains authoritative for business transactions and domain permissions.
 * Memberships control identity federation, SSO handoff, and cross-launch authorization.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
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
  ErpInstance,
  ErpMembership,
  GlobalUser,
} from "@/types";

const MEMBERSHIP_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "ALL", label: "All Statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "PENDING", label: "Pending" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "REVOKED", label: "Revoked" },
];

export function Memberships() {
  const toast = useToast();

  const [memberships, setMemberships] = useState<ErpMembership[]>([]);

  const [erps, setErps] = useState<ErpInstance[]>([]);
  const [users, setUsers] = useState<GlobalUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Filters & Search
  const [search, setSearch] = useState("");
  const [selectedErpFilter, setSelectedErpFilter] = useState("ALL");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState("ALL");

  // Link Membership Modal
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedErpId, setSelectedErpId] = useState("");
  const [localUserId, setLocalUserId] = useState("");
  const [linking, setLinking] = useState(false);

  // Unlink Confirmation
  const [unlinkTarget, setUnlinkTarget] = useState<ErpMembership | null>(null);
  const [unlinking, setUnlinking] = useState(false);

  // Status Action Confirmation (Verify, Suspend, Restore, Revoke)
  const [actionTarget, setActionTarget] = useState<{
    membership: ErpMembership;
    action: "verify" | "suspend" | "restore" | "revoke";
  } | null>(null);
  const [performingAction, setPerformingAction] = useState(false);

  // Membership Detail Drawer
  const [detailMembership, setDetailMembership] = useState<ErpMembership | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const [memsRes, erpsRes, usersRes] = await Promise.all([
        apiGet<ErpMembership[]>("/global/memberships?limit=500&offset=0").catch(() => []),
        apiGet<ErpInstance[]>("/global/erps").catch(() => []),
        apiGet<GlobalUser[]>("/global/users?limit=500&offset=0").catch(() => []),
      ]);

      const memList = Array.isArray(memsRes) ? memsRes : ((memsRes as any)?.data || []);
      const erpList = Array.isArray(erpsRes) ? erpsRes : ((erpsRes as any)?.data || []);
      const userList = Array.isArray(usersRes) ? usersRes : ((usersRes as any)?.data || []);

      setMemberships(memList);
      setErps(erpList);
      setUsers(userList);

      // Keep detailMembership up to date if currently open
      if (detailMembership) {
        const updated = memList.find((m: ErpMembership) => m.id === detailMembership.id);
        if (updated) setDetailMembership(updated);
      }
    } catch (err) {
      setError(err);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [detailMembership?.id]);

  useEffect(() => {
    fetchData();

    // Revalidate when user returns to this tab without background periodic polling
    const handleFocus = () => {
      fetchData(true);
    };
    window.addEventListener("focus", handleFocus);

    return () => window.removeEventListener("focus", handleFocus);
  }, [fetchData]);

  // Helper resolvers
  const getUserById = useCallback(
    (id: string) => users.find((u) => u.id === id),
    [users]
  );

  const getErpById = useCallback(
    (id: string) => erps.find((e) => e.id === id),
    [erps]
  );

  // Create / Link Membership
  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || !selectedErpId || !localUserId.trim()) {
      toast("Please select a Global User, target ERP, and provide a Local User ID.", "warning");
      return;
    }

    setLinking(true);
    try {
      await apiPost("/global/identity/link", {
        global_user_id: selectedUserId,
        erp_instance_id: selectedErpId,
        local_user_id: localUserId.trim(),
      });
      toast("ERP membership linked successfully.", "success");
      setLinkModalOpen(false);
      setSelectedUserId("");
      setSelectedErpId("");
      setLocalUserId("");
      await fetchData();
    } catch (err) {
      toast(
        "Failed to link membership: " + (err instanceof Error ? err.message : String(err)),
        "error"
      );
    } finally {
      setLinking(false);
    }
  };

  // Safe Unlink Membership
  const handleUnlink = async () => {
    if (!unlinkTarget) return;
    setUnlinking(true);
    try {
      await apiDelete(`/global/identity/memberships/${unlinkTarget.id}/link`);
      toast("Membership unlinked safely. Target ERP local account remains intact.", "info");
      if (detailMembership?.id === unlinkTarget.id) {
        setDetailMembership(null);
      }
      setUnlinkTarget(null);
      await fetchData();
    } catch (err) {
      toast(
        "Failed to unlink membership: " + (err instanceof Error ? err.message : String(err)),
        "error"
      );
    } finally {
      setUnlinking(false);
    }
  };

  // Lifecycle Action (Verify, Suspend, Restore, Revoke)
  const handleExecuteLifecycleAction = async () => {
    if (!actionTarget) return;
    const { membership, action } = actionTarget;
    setPerformingAction(true);
    try {
      await apiPost(`/global/memberships/${membership.id}/${action}`);
      const actionNames: Record<string, string> = {
        verify: "verified",
        suspend: "suspended",
        restore: "restored to active",
        revoke: "revoked",
      };
      toast(`Membership successfully ${actionNames[action]}.`, "success");
      setActionTarget(null);
      await fetchData();
    } catch (err) {
      toast(
        `Failed to ${action} membership: ${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    } finally {
      setPerformingAction(false);
    }
  };

  // Filtered memberships
  const filtered = useMemo(() => {
    return memberships.filter((m) => {
      // ERP Filter
      if (selectedErpFilter !== "ALL" && m.erp_instance_id !== selectedErpFilter) {
        return false;
      }
      // Status Filter
      if (selectedStatusFilter !== "ALL" && m.status !== selectedStatusFilter) {
        return false;
      }
      // Search query
      if (search.trim()) {
        const q = search.toLowerCase();
        const user = getUserById(m.global_user_id);
        const erp = getErpById(m.erp_instance_id);

        const emailMatch = (m.user_email || user?.primary_email || user?.email || "").toLowerCase().includes(q);
        const nameMatch = (m.user_display_name || user?.display_name || "").toLowerCase().includes(q);
        const erpMatch = (m.erp_name || erp?.name || m.erp_key || erp?.erp_key || "").toLowerCase().includes(q);
        const localIdMatch = m.local_user_id.toLowerCase().includes(q);
        const memIdMatch = m.id.toLowerCase().includes(q);

        if (!emailMatch && !nameMatch && !erpMatch && !localIdMatch && !memIdMatch) {
          return false;
        }
      }
      return true;
    });
  }, [memberships, selectedErpFilter, selectedStatusFilter, search, getUserById, getErpById]);

  // Statistics
  const stats = useMemo(() => {
    return {
      total: memberships.length,
      active: memberships.filter((m) => m.status === "ACTIVE").length,
      pending: memberships.filter((m) => m.status === "PENDING").length,
      suspended: memberships.filter((m) => m.status === "SUSPENDED").length,
      revoked: memberships.filter((m) => m.status === "REVOKED").length,
    };
  }, [memberships]);

  return (
    <AppShell
      activeKey="memberships"
      pageTitle="ERP Memberships"
      breadcrumbs={["Identity & Access", "ERP Memberships"]}
      actions={
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setLinkModalOpen(true)}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <ICONS.plus width={14} height={14} />
            Link Membership
          </button>
        </div>
      }
    >
      <Banner error={error} />

      {/* Architecture Context Banner */}
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
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-text)", marginBottom: "4px" }}>
              Decoupled Identity & Authoritative Local RBAC Architecture
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.55 }}>
              <span style={{ fontWeight: 600, color: "var(--color-primary)" }}>Global User</span> (Control Plane)
              {" ➔ "}
              <span style={{ fontWeight: 600, color: "var(--color-text)" }}>ERP Membership</span> (Identity Link)
              {" ➔ "}
              <span style={{ fontWeight: 600, color: "var(--color-text)" }}>Target ERP</span>
              {" ➔ "}
              <span style={{ fontWeight: 600, color: "var(--color-success)" }}>Local ERP User</span> (Business Account).
              ERP_Main does not own business permissions (inventory, quotes, ledger). Each registered ERP evaluates its own
              local roles and permissions autonomously.
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "14px",
          marginBottom: "20px",
        }}
      >
        <div className="card" style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", fontWeight: 600 }}>
            Total Bindings
          </div>
          <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--color-text)", marginTop: "4px" }}>
            {stats.total}
          </div>
        </div>
        <div className="card" style={{ padding: "14px 18px", borderLeft: "4px solid var(--color-success)" }}>
          <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", fontWeight: 600 }}>
            Active Bindings
          </div>
          <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--color-success)", marginTop: "4px" }}>
            {stats.active}
          </div>
        </div>
        <div className="card" style={{ padding: "14px 18px", borderLeft: "4px solid #eab308" }}>
          <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", fontWeight: 600 }}>
            Pending Verification
          </div>
          <div style={{ fontSize: "24px", fontWeight: 800, color: "#ca8a04", marginTop: "4px" }}>
            {stats.pending}
          </div>
        </div>
        <div className="card" style={{ padding: "14px 18px", borderLeft: "4px solid #f97316" }}>
          <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", fontWeight: 600 }}>
            Suspended
          </div>
          <div style={{ fontSize: "24px", fontWeight: 800, color: "#ea580c", marginTop: "4px" }}>
            {stats.suspended}
          </div>
        </div>
        <div className="card" style={{ padding: "14px 18px", borderLeft: "4px solid var(--color-danger)" }}>
          <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", fontWeight: 600 }}>
            Revoked
          </div>
          <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--color-danger)", marginTop: "4px" }}>
            {stats.revoked}
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div
        className="card"
        style={{
          padding: "16px 20px",
          marginBottom: "20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", flex: 1 }}>
          {/* Search */}
          <div style={{ position: "relative", minWidth: "260px" }}>
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: "34px", height: "36px", fontSize: "13px" }}
              placeholder="Search user, local ID, ERP..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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

          {/* ERP Instance Filter */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-secondary)" }}>
              ERP:
            </span>
            <select
              className="form-select"
              style={{ width: "auto", height: "36px", fontSize: "13px" }}
              value={selectedErpFilter}
              onChange={(e) => setSelectedErpFilter(e.target.value)}
            >
              <option value="ALL">All ERPs</option>
              {erps.map((erp) => (
                <option key={erp.id} value={erp.id}>
                  {erp.name} ({erp.erp_key})
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-secondary)" }}>
              Status:
            </span>
            <select
              className="form-select"
              style={{ width: "auto", height: "36px", fontSize: "13px" }}
              value={selectedStatusFilter}
              onChange={(e) => setSelectedStatusFilter(e.target.value)}
            >
              {MEMBERSHIP_STATUS_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ fontSize: "13px", color: "var(--color-muted)" }}>
          Showing <strong>{filtered.length}</strong> of <strong>{memberships.length}</strong> bindings
        </div>
      </div>

      {loading ? (
        <LoadingSpinner text="Loading membership bindings..." />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No memberships found"
          description={
            search || selectedErpFilter !== "ALL" || selectedStatusFilter !== "ALL"
              ? "No memberships match your filter criteria."
              : "No ERP memberships have been established yet."
          }
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setSearch("");
                setSelectedErpFilter("ALL");
                setSelectedStatusFilter("ALL");
                setLinkModalOpen(true);
              }}
            >
              Link First Membership
            </button>
          }
        />
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Global User Identity</th>
                  <th>Target ERP Instance</th>
                  <th>Local ERP User ID</th>
                  <th>Status</th>
                  <th>Verification</th>
                  <th>Linked Date</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const user = getUserById(m.global_user_id);
                  const erp = getErpById(m.erp_instance_id);
                  const userDisplay =
                    user?.display_name || m.user_display_name || "Unknown Global User";
                  const userEmail =
                    user?.primary_email || user?.email || m.user_email || m.global_user_id;
                  const erpName = erp?.name || m.erp_name || "Unknown ERP";
                  const erpKey = erp?.erp_key || m.erp_key || "";

                  return (
                    <tr
                      key={m.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => setDetailMembership(m)}
                    >
                      <td>
                        <div style={{ fontWeight: 700, color: "var(--color-text)", fontSize: "14px" }}>
                          {userDisplay}
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                          {userEmail}
                        </div>
                        <div
                          style={{
                            fontSize: "11px",
                            color: "var(--color-muted)",
                            fontFamily: "monospace",
                            marginTop: "2px",
                          }}
                        >
                          Global ID: {m.global_user_id}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: "var(--color-text)", fontSize: "13px" }}>
                          {erpName}
                        </div>
                        {erpKey && (
                          <span
                            className="badge"
                            style={{
                              backgroundColor: "#e0f2fe",
                              color: "#0369a1",
                              fontSize: "11px",
                              marginTop: "2px",
                            }}
                          >
                            {erpKey}
                          </span>
                        )}
                      </td>
                      <td>
                        <code
                          style={{
                            fontFamily: "monospace",
                            fontSize: "12px",
                            color: "var(--color-primary)",
                            backgroundColor: "#f8fafc",
                            padding: "3px 6px",
                            borderRadius: "4px",
                            border: "1px solid #e2e8f0",
                            display: "inline-block",
                          }}
                        >
                          {m.local_user_id}
                        </code>
                      </td>
                      <td>
                        <StatusBadge status={m.status} />
                      </td>
                      <td>
                        {m.verified_at ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--color-success)", fontSize: "12px" }}>
                            <ICONS.check width={13} height={13} />
                            <span>Verified</span>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "#ca8a04", fontSize: "12px" }}>
                            <ICONS.alert width={13} height={13} />
                            <span>Unverified</span>
                          </div>
                        )}
                        {m.last_seen_at && (
                          <div style={{ fontSize: "11px", color: "var(--color-muted)", marginTop: "2px" }}>
                            Seen: {new Date(m.last_seen_at).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                        {new Date(m.created_at || m.linked_at || Date.now()).toLocaleDateString()}
                      </td>
                      <td
                        style={{ textAlign: "right" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
                          {/* Quick Lifecycle Actions */}
                          {m.status === "PENDING" && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              style={{ color: "var(--color-success)", borderColor: "#bbf7d0", fontSize: "11px", padding: "3px 8px" }}
                              onClick={() => setActionTarget({ membership: m, action: "verify" })}
                              title="Verify membership"
                            >
                              Verify
                            </button>
                          )}
                          {m.status === "ACTIVE" && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              style={{ color: "#ea580c", borderColor: "#fed7aa", fontSize: "11px", padding: "3px 8px" }}
                              onClick={() => setActionTarget({ membership: m, action: "suspend" })}
                              title="Suspend membership"
                            >
                              Suspend
                            </button>
                          )}
                          {m.status === "SUSPENDED" && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              style={{ color: "var(--color-primary)", borderColor: "#bae6fd", fontSize: "11px", padding: "3px 8px" }}
                              onClick={() => setActionTarget({ membership: m, action: "restore" })}
                              title="Restore membership"
                            >
                              Restore
                            </button>
                          )}
                          {m.status !== "REVOKED" && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              style={{ color: "var(--color-danger)", borderColor: "#fecaca", fontSize: "11px", padding: "3px 8px" }}
                              onClick={() => setActionTarget({ membership: m, action: "revoke" })}
                              title="Revoke membership"
                            >
                              Revoke
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            style={{ color: "var(--color-text-secondary)", fontSize: "11px", padding: "3px 8px" }}
                            onClick={() => setDetailMembership(m)}
                            title="Inspect details"
                          >
                            Details
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            style={{ color: "var(--color-danger)", borderColor: "#fecaca", fontSize: "11px", padding: "3px 8px" }}
                            onClick={() => setUnlinkTarget(m)}
                            title="Unlink membership safely"
                          >
                            Unlink
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

      {/* Link Membership Modal */}
      <Modal
        open={linkModalOpen}
        onClose={() => setLinkModalOpen(false)}
        title="Link Global User to Local ERP Account"
        variant="center"
        cardStyle={{ maxWidth: "540px" }}
      >
        <form onSubmit={handleLink} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div
            style={{
              padding: "10px 14px",
              backgroundColor: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              fontSize: "12px",
              color: "var(--color-text-secondary)",
              lineHeight: 1.5,
            }}
          >
            <strong>Note:</strong> Linking establishes an identity association in ERP_Main. It allows
            this Global User to authenticate and launch the target ERP via SSO. Business roles and data
            permissions are managed locally in the target ERP.
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="link-userId">
              Global User Identity *
            </label>
            <select
              id="link-userId"
              className="form-select"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              required
            >
              <option value="">-- Select Global User --</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name} ({u.primary_email || u.email})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="link-erpSelect">
              Target ERP Instance *
            </label>
            <select
              id="link-erpSelect"
              className="form-select"
              value={selectedErpId}
              onChange={(e) => setSelectedErpId(e.target.value)}
              required
            >
              <option value="">-- Select Target ERP --</option>
              {erps
                .filter((erp) => erp.status !== "DECOMMISSIONED")
                .map((erp) => (
                  <option key={erp.id} value={erp.id}>
                    {erp.name} ({erp.erp_key}) &mdash; {erp.base_url}
                  </option>
                ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="link-localId">
              Local ERP User ID (UUID / String Identifier) *
            </label>
            <input
              id="link-localId"
              type="text"
              className="form-input"
              placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
              value={localUserId}
              onChange={(e) => setLocalUserId(e.target.value)}
              required
            />
            <span className="form-helper">
              The internal primary key identifying this user inside the target ERP&apos;s database.
              Must be unique per ERP instance.
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setLinkModalOpen(false)}
              disabled={linking}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={linking}>
              {linking ? "Linking..." : "Establish Membership"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Unlink Confirmation */}
      <ConfirmDialog
        open={Boolean(unlinkTarget)}
        title="Unlink ERP Membership"
        message={
          <span>
            Are you sure you want to unlink membership for{" "}
            <strong>
              {unlinkTarget
                ? getUserById(unlinkTarget.global_user_id)?.display_name ||
                  unlinkTarget.user_email ||
                  unlinkTarget.global_user_id
                : ""}
            </strong>{" "}
            from{" "}
            <strong>
              {unlinkTarget
                ? getErpById(unlinkTarget.erp_instance_id)?.name ||
                  unlinkTarget.erp_name ||
                  unlinkTarget.erp_instance_id
                : ""}
            </strong>
            ?
            <br />
            <br />
            <strong>Safe Unlink Architecture:</strong> The local ERP user record (Local ID:{" "}
            <code>{unlinkTarget?.local_user_id}</code>) will remain intact in the target ERP database,
            but the global SSO association will be severed.
          </span>
        }
        confirmLabel="Unlink Membership"
        danger
        loading={unlinking}
        onConfirm={handleUnlink}
        onCancel={() => setUnlinkTarget(null)}
      />

      {/* Lifecycle Action Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(actionTarget)}
        title={
          actionTarget?.action === "verify"
            ? "Verify ERP Membership"
            : actionTarget?.action === "suspend"
            ? "Suspend ERP Membership"
            : actionTarget?.action === "restore"
            ? "Restore ERP Membership"
            : "Revoke ERP Membership"
        }
        message={
          <span>
            {actionTarget?.action === "verify" && (
              <>
                Confirm verification of membership binding for{" "}
                <strong>{actionTarget.membership.local_user_id}</strong>? This marks the link verified
                for global access.
              </>
            )}
            {actionTarget?.action === "suspend" && (
              <>
                Are you sure you want to suspend this membership? The user will be unable to
                cross-launch this ERP via SSO until restored. Local credentials (if any) remain intact.
              </>
            )}
            {actionTarget?.action === "restore" && (
              <>
                Restore this suspended membership back to <strong>ACTIVE</strong> status?
              </>
            )}
            {actionTarget?.action === "revoke" && (
              <>
                Permanently revoke this membership link? The local ERP account will remain intact, but
                this global binding will be closed.
              </>
            )}
          </span>
        }
        confirmLabel={
          actionTarget?.action === "verify"
            ? "Verify"
            : actionTarget?.action === "suspend"
            ? "Suspend"
            : actionTarget?.action === "restore"
            ? "Restore"
            : "Revoke"
        }
        danger={actionTarget?.action === "suspend" || actionTarget?.action === "revoke"}
        loading={performingAction}
        onConfirm={handleExecuteLifecycleAction}
        onCancel={() => setActionTarget(null)}
      />

      {/* Membership Detail Drawer */}
      {detailMembership && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1050,
            display: "flex",
            justifyContent: "flex-end",
            backgroundColor: "rgba(15, 23, 42, 0.45)",
          }}
          onClick={() => setDetailMembership(null)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "560px",
              height: "100%",
              backgroundColor: "#ffffff",
              boxShadow: "-8px 0 24px rgba(0, 0, 0, 0.15)",
              display: "flex",
              flexDirection: "column",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid var(--color-border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                backgroundColor: "#f8fafc",
              }}
            >
              <div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-primary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Membership Binding Inspector
                </div>
                <h3 style={{ margin: "4px 0 0", fontSize: "18px", color: "var(--color-text)" }}>
                  {getErpById(detailMembership.erp_instance_id)?.name || detailMembership.erp_name || "ERP Membership"}
                </h3>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setDetailMembership(null)}
              >
                Close
              </button>
            </div>

            {/* Drawer Content */}
            <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px", flex: 1 }}>
              {/* Status Header Pill */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 16px",
                  borderRadius: "8px",
                  backgroundColor: "#f1f5f9",
                }}
              >
                <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text)" }}>
                  Current Binding Status:
                </span>
                <StatusBadge status={detailMembership.status} />
              </div>

              {/* Global User Details */}
              <div className="card" style={{ padding: "16px" }}>
                <div style={{ fontWeight: 700, fontSize: "13px", color: "var(--color-text)", marginBottom: "12px" }}>
                  Global User Identity (Control Plane)
                </div>
                {(() => {
                  const user = getUserById(detailMembership.global_user_id);
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: "8px", fontSize: "13px" }}>
                      <span style={{ color: "var(--color-text-secondary)" }}>Display Name:</span>
                      <strong style={{ color: "var(--color-text)" }}>
                        {user?.display_name || detailMembership.user_display_name || "Unknown"}
                      </strong>

                      <span style={{ color: "var(--color-text-secondary)" }}>Primary Email:</span>
                      <strong style={{ color: "var(--color-text)" }}>
                        {user?.primary_email || user?.email || detailMembership.user_email || "Unknown"}
                      </strong>

                      <span style={{ color: "var(--color-text-secondary)" }}>Global User ID:</span>
                      <code style={{ fontSize: "11px", wordBreak: "break-all" }}>
                        {detailMembership.global_user_id}
                      </code>

                      <span style={{ color: "var(--color-text-secondary)" }}>Global Status:</span>
                      <span>
                        {user ? <StatusBadge status={user.status} /> : "Unknown"}
                      </span>
                    </div>
                  );
                })()}
              </div>

              {/* Target ERP Details */}
              <div className="card" style={{ padding: "16px" }}>
                <div style={{ fontWeight: 700, fontSize: "13px", color: "var(--color-text)", marginBottom: "12px" }}>
                  Target ERP Instance
                </div>
                {(() => {
                  const erp = getErpById(detailMembership.erp_instance_id);
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: "8px", fontSize: "13px" }}>
                      <span style={{ color: "var(--color-text-secondary)" }}>ERP Name:</span>
                      <strong style={{ color: "var(--color-text)" }}>
                        {erp?.name || detailMembership.erp_name || "Unknown"}
                      </strong>

                      <span style={{ color: "var(--color-text-secondary)" }}>ERP Key:</span>
                      <span>
                        <span className="badge" style={{ backgroundColor: "#e0f2fe", color: "#0369a1" }}>
                          {erp?.erp_key || detailMembership.erp_key || "N/A"}
                        </span>
                      </span>

                      <span style={{ color: "var(--color-text-secondary)" }}>Base URL:</span>
                      <a
                        href={erp?.base_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--color-primary)", textDecoration: "none", fontSize: "12px" }}
                      >
                        {erp?.base_url || "N/A"}
                      </a>

                      <span style={{ color: "var(--color-text-secondary)" }}>ERP Status:</span>
                      <span>
                        {erp ? <StatusBadge status={erp.status} /> : "Unknown"}
                      </span>
                    </div>
                  );
                })()}
              </div>

              {/* Local Account Mapping */}
              <div className="card" style={{ padding: "16px" }}>
                <div style={{ fontWeight: 700, fontSize: "13px", color: "var(--color-text)", marginBottom: "8px" }}>
                  Local Account Identification
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "12px" }}>
                  This opaque identifier uniquely pins this Global User to their specific employee or account record
                  in the ERP&apos;s database.
                </div>
                <div
                  style={{
                    backgroundColor: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "6px",
                    padding: "10px 14px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <code style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-primary)" }}>
                    {detailMembership.local_user_id}
                  </code>
                </div>
              </div>

              {/* Timestamps & Lifecycle */}
              <div className="card" style={{ padding: "16px" }}>
                <div style={{ fontWeight: 700, fontSize: "13px", color: "var(--color-text)", marginBottom: "12px" }}>
                  Lifecycle & Audit Timestamps
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "8px", fontSize: "12px" }}>
                  <span style={{ color: "var(--color-text-secondary)" }}>Membership ID:</span>
                  <code style={{ fontSize: "11px", wordBreak: "break-all" }}>{detailMembership.id}</code>

                  <span style={{ color: "var(--color-text-secondary)" }}>Linked At:</span>
                  <span>{detailMembership.linked_at ? new Date(detailMembership.linked_at).toLocaleString() : "N/A"}</span>

                  <span style={{ color: "var(--color-text-secondary)" }}>Verified At:</span>
                  <span>{detailMembership.verified_at ? new Date(detailMembership.verified_at).toLocaleString() : "Pending"}</span>

                  <span style={{ color: "var(--color-text-secondary)" }}>Last SSO Seen:</span>
                  <span>{detailMembership.last_seen_at ? new Date(detailMembership.last_seen_at).toLocaleString() : "Never"}</span>

                  <span style={{ color: "var(--color-text-secondary)" }}>Created At:</span>
                  <span>{new Date(detailMembership.created_at).toLocaleString()}</span>
                </div>
              </div>

              {/* Lifecycle Actions */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase" }}>
                  Membership Actions
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                  {detailMembership.status === "PENDING" && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => setActionTarget({ membership: detailMembership, action: "verify" })}
                    >
                      Verify Membership
                    </button>
                  )}
                  {detailMembership.status === "ACTIVE" && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ color: "#ea580c" }}
                      onClick={() => setActionTarget({ membership: detailMembership, action: "suspend" })}
                    >
                      Suspend Membership
                    </button>
                  )}
                  {detailMembership.status === "SUSPENDED" && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => setActionTarget({ membership: detailMembership, action: "restore" })}
                    >
                      Restore to Active
                    </button>
                  )}
                  {detailMembership.status !== "REVOKED" && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ color: "var(--color-danger)" }}
                      onClick={() => setActionTarget({ membership: detailMembership, action: "revoke" })}
                    >
                      Revoke Membership
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    style={{ color: "var(--color-danger)", borderColor: "#fecaca" }}
                    onClick={() => setUnlinkTarget(detailMembership)}
                  >
                    Unlink Membership
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
