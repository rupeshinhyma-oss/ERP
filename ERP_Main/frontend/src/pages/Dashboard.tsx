/**
 * Control Plane Dashboard for ERP_Main (Phase 7).
 *
 * Visualizes the unified global control plane: fleet status, global identity,
 * integration throughput, projection sync health, and real audit activity.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "@/lib/api";
import { useGlobalSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { AppShell } from "@/components/AppShell";
import { StatusBadge, Banner, Modal, SkeletonDashboard } from "@/components/ui";
import { ICONS } from "@/components/icons";
import { authorizeErpLaunch, getErpHostUrl } from "@/lib/federation";
import type { GlobalDashboard, GlobalAuditEvent, ErpInstance, ErpMembership } from "@/types";

export function Dashboard() {
  const { currentUser, isSuperAdmin, userType, memberships: sessionMemberships } = useGlobalSession();
  const toast = useToast();

  const [dashboard, setDashboard] = useState<GlobalDashboard | null>(null);
  const [recentAudit, setRecentAudit] = useState<GlobalAuditEvent[]>([]);
  const [erps, setErps] = useState<ErpInstance[]>([]);
  const [memberships, setMemberships] = useState<ErpMembership[]>(sessionMemberships || []);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Projection Rebuild Modal
  const [rebuildModalOpen, setRebuildModalOpen] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const canRebuild = isSuperAdmin || userType === "platform_admin";

  const inFlightRef = useRef(false);

  const loadData = async (silent = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const [dashData, auditData, erpsRes] = await Promise.all([
        apiGet<GlobalDashboard>("/global/dashboard").catch(() => null),
        apiGet<GlobalAuditEvent[]>("/global/audit?limit=6").catch(() => []),
        apiGet<ErpInstance[]>("/global/erps").catch(() => []),
      ]);

      const rawErps = (erpsRes as any)?.data ?? erpsRes;
      if (Array.isArray(rawErps)) {
        setErps(rawErps);
      }

      let memsList: ErpMembership[] = sessionMemberships || [];
      if ((!memsList || memsList.length === 0) && currentUser?.id) {
        try {
          const memsRes = await apiGet<ErpMembership[]>(`/global/users/${currentUser.id}/memberships`);
          const rawMems = (memsRes as any)?.data ?? memsRes;
          if (Array.isArray(rawMems)) {
            memsList = rawMems;
          }
        } catch {
          memsList = [];
        }
      }
      setMemberships(memsList);

      if (dashData) {
        setDashboard(dashData);
      } else {
        setDashboard({
          active_erps: 0,
          total_erps: 0,
          global_users: 0,
          active_memberships: 0,
          events_received_total: 0,
          events_dead_lettered_total: 0,
          erp_health: [],
          projection_health: [],
          data_as_of: new Date().toISOString(),
        });
      }

      if (Array.isArray(auditData)) {
        setRecentAudit(auditData);
      }
    } catch (err) {
      setError(err);
    } finally {
      inFlightRef.current = false;
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const handleCopy = (erpId: string, url: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url);
      setCopiedId(erpId);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const handleLaunchErp = async (erpKey: string, erpId: string, displayName: string) => {
    const matched = erps.find((e) => e.erp_key === erpKey || e.id === erpId);
    const baseUrl = matched?.base_url || getErpHostUrl({ erp_key: erpKey, base_url: matched?.base_url });
    if (!baseUrl) {
      setLaunchError((prev) => ({ ...prev, [erpId]: `No host URL configured for ${displayName}.` }));
      return;
    }

    const instance: ErpInstance = {
      id: matched?.id || erpId,
      name: matched?.name || displayName,
      erp_key: erpKey,
      base_url: baseUrl,
      status: (matched?.status as any) || "ACTIVE",
      version: matched?.version || "1.0",
      description: matched?.description,
      capabilities: matched?.capabilities || [],
      created_at: "",
      updated_at: "",
    };

    setLaunchError((prev) => {
      const next = { ...prev };
      delete next[erpId];
      return next;
    });
    setLaunchingId(erpId);

    try {
      const { launchUrl } = await authorizeErpLaunch(instance);
      window.location.assign(launchUrl);
    } catch (err) {
      setLaunchingId(null);
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message?: unknown }).message)
          : `Could not launch ${displayName}. Please try again.`;
      setLaunchError((prev) => ({ ...prev, [erpId]: message }));
    }
  };

  useEffect(() => {
    loadData();

    // Conservative 30s monitoring poll that pauses when hidden
    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      loadData(true);
    }, 30000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadData(true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const handleRebuildProjections = async () => {
    setRebuilding(true);
    try {
      const res = await apiPost<{ fetched: number; processed: number; errors: number }>(
        "/global/projections/buyers/rebuild",
        {}
      );
      toast(
        `Buyer projections rebuilt successfully: ${res?.processed ?? 0} processed, ${res?.errors ?? 0} errors.`,
        "success"
      );
      setRebuildModalOpen(false);
      await loadData();
    } catch (err) {
      toast("Failed to rebuild buyer projections: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <AppShell
      activeKey="dashboard"
      pageTitle="ERP Dashboard"
      actions={
        canRebuild ? (
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setRebuildModalOpen(true)}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <ICONS.refreshCw width={14} height={14} />
              Rebuild Projections
            </button>
          </div>
        ) : undefined
      }
    >
      <Banner error={error} />

      {loading && !dashboard ? (
        <SkeletonDashboard />
      ) : (
        <>
          {/* Top Stat Tiles */}
          <div className="cp-stat-grid" style={{ marginBottom: "32px" }}>
            <div className="cp-stat-card">
              <div className="cp-stat-icon-wrapper" style={{ background: "#e0edff", color: "#0061f2" }}>
                <ICONS.server width={24} height={24} />
              </div>
              <div className="cp-stat-info">
                <span className="cp-stat-value">
                  {dashboard?.active_erps ?? 0}
                  <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--color-muted)" }}>
                    {" "}/ {dashboard?.total_erps ?? 0}
                  </span>
                </span>
                <span className="cp-stat-label">Active ERP Instances</span>
              </div>
            </div>

            <div className="cp-stat-card">
              <div className="cp-stat-icon-wrapper" style={{ background: "#ecfdf5", color: "#10b981" }}>
                <ICONS.users width={24} height={24} />
              </div>
              <div className="cp-stat-info">
                <span className="cp-stat-value">{dashboard?.global_users ?? 0}</span>
                <span className="cp-stat-label">Global User Accounts</span>
              </div>
            </div>

            <div className="cp-stat-card">
              <div className="cp-stat-icon-wrapper" style={{ background: "#eff6ff", color: "#3b82f6" }}>
                <ICONS.link width={24} height={24} />
              </div>
              <div className="cp-stat-info">
                <span className="cp-stat-value">{dashboard?.active_memberships ?? 0}</span>
                <span className="cp-stat-label">Active ERP Memberships</span>
              </div>
            </div>

            <div className="cp-stat-card">
              <div className="cp-stat-icon-wrapper" style={{ background: "#fef3c7", color: "#d97706" }}>
                <ICONS.activity width={24} height={24} />
              </div>
              <div className="cp-stat-info">
                <span className="cp-stat-value">{dashboard?.events_received_total ?? 0}</span>
                <span className="cp-stat-label">Ingested Inbox Events</span>
              </div>
            </div>
          </div>

          {/* ERP Fleet Status Grid */}
          <div style={{ marginBottom: "32px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "var(--color-text)" }}>
                Registered ERP Fleet Status
              </h2>
            </div>

            {dashboard?.erp_health && dashboard.erp_health.length > 0 ? (
              <div className="erp-launcher-grid">
                {dashboard.erp_health.map((erp) => {
                  const matched = erps.find((e) => e.erp_key === erp.erp_key || e.id === erp.erp_id);
                  const hostUrl = getErpHostUrl({
                    base_url: matched?.base_url,
                    erp_key: erp.erp_key,
                  });
                  const membership = memberships.find(
                    (m) => m.erp_instance_id === matched?.id || m.erp_instance_id === erp.erp_id
                  );
                  const isUnavailable = erp.status !== "ACTIVE";
                  const isLaunching = launchingId === erp.erp_id;

                  return (
                    <div
                      key={erp.erp_id}
                      className="erp-launcher-card"
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                      }}
                    >
                      <div>
                        <div className="erp-launcher-card-header">
                          <div>
                            <h3 className="erp-launcher-card-title">{erp.display_name}</h3>
                            <span className="erp-launcher-card-key">{erp.erp_key}</span>
                          </div>
                          <StatusBadge status={erp.status} />
                        </div>

                        {/* Prominent Host URL Box */}
                        {hostUrl && (
                          <div
                            style={{
                              margin: "12px 0 10px",
                              padding: "8px 12px",
                              background: "#f8fafc",
                              borderRadius: "8px",
                              border: "1px solid #e2e8f0",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginBottom: "4px",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  textTransform: "uppercase",
                                  letterSpacing: "0.5px",
                                  color: "#64748b",
                                }}
                              >
                                Host URL
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleCopy(erp.erp_id, hostUrl);
                                }}
                                style={{
                                  background: "none",
                                  border: "none",
                                  padding: "2px 6px",
                                  fontSize: "11px",
                                  color: copiedId === erp.erp_id ? "#16a34a" : "#64748b",
                                  cursor: "pointer",
                                  borderRadius: "4px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                                title="Copy Host URL"
                              >
                                {copiedId === erp.erp_id ? (
                                  <>
                                    <ICONS.check width={12} height={12} />
                                    <span>Copied!</span>
                                  </>
                                ) : (
                                  <>
                                    <ICONS.copy width={12} height={12} />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                            <a
                              href={hostUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                fontSize: "12px",
                                fontFamily: "monospace",
                                color: "#0061f2",
                                textDecoration: "none",
                                fontWeight: 600,
                                wordBreak: "break-all",
                              }}
                            >
                              <span>{hostUrl}</span>
                              <ICONS.externalLink width={12} height={12} />
                            </a>
                          </div>
                        )}

                        {/* Local Account & Super Admin Badges */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
                          {membership && (
                            <span
                              style={{
                                fontSize: "11px",
                                color: "#0284c7",
                                background: "#e0f2fe",
                                padding: "2px 8px",
                                borderRadius: "4px",
                                fontWeight: 500,
                              }}
                            >
                              Local Account: {membership.local_user_id}
                            </span>
                          )}
                          {isSuperAdmin && (
                            <span
                              style={{
                                fontSize: "11px",
                                color: "#7c3aed",
                                background: "#f3e8ff",
                                padding: "2px 8px",
                                borderRadius: "4px",
                                fontWeight: 500,
                              }}
                            >
                              Platform Admin Access
                            </span>
                          )}
                        </div>

                        <div className="erp-launcher-card-meta">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ color: "var(--color-muted)" }}>API Health:</span>
                            <StatusBadge status={erp.api_health} />
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--color-muted)" }}>Buyer Projections:</span>
                            <span style={{ fontWeight: 600 }}>{erp.buyer_projection_count} records</span>
                          </div>
                          {erp.last_seen_at && (
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ color: "var(--color-muted)" }}>Heartbeat:</span>
                              <span>{new Date(erp.last_seen_at).toLocaleTimeString()}</span>
                            </div>
                          )}
                          {erp.enabled_capabilities && erp.enabled_capabilities.length > 0 && (
                            <div style={{ marginTop: "6px" }}>
                              <span style={{ fontSize: "11px", color: "var(--color-muted)", display: "block", marginBottom: "4px" }}>
                                CAPABILITIES:
                              </span>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                {erp.enabled_capabilities.map((cap) => (
                                  <span
                                    key={cap}
                                    style={{
                                      fontSize: "10px",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      background: "#f1f5f9",
                                      fontFamily: "monospace",
                                    }}
                                  >
                                    {cap}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {launchError[erp.erp_id] && (
                          <div
                            style={{
                              marginTop: "10px",
                              padding: "8px 12px",
                              borderRadius: "6px",
                              background: "#fee2e2",
                              border: "1px solid #fca5a5",
                              color: "#b91c1c",
                              fontSize: "12px",
                            }}
                          >
                            {launchError[erp.erp_id]}
                          </div>
                        )}
                      </div>

                      <div className="erp-launcher-card-footer" style={{ marginTop: "16px", display: "flex", gap: "8px" }}>
                        <Link to={`/erps/${erp.erp_id}`} className="btn btn-secondary btn-sm" style={{ flex: 1, textAlign: "center" }}>
                          View Details
                        </Link>
                        <button
                          type="button"
                          id={`btn-launch-${erp.erp_key}`}
                          onClick={() => handleLaunchErp(erp.erp_key, erp.erp_id, erp.display_name)}
                          disabled={isUnavailable || isLaunching || !hostUrl}
                          className="btn btn-primary btn-sm"
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            cursor: isUnavailable || isLaunching || !hostUrl ? "not-allowed" : "pointer",
                            opacity: isLaunching ? 0.75 : 1,
                          }}
                        >
                          <span>{isLaunching ? "Signing you in…" : "Launch ERP"}</span>
                          {!isLaunching && <ICONS.externalLink width={13} height={13} />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="card" style={{ padding: "24px", textAlign: "center", color: "var(--color-muted)" }}>
                No active ERP fleet instances registered yet.
              </div>
            )}
          </div>

          {/* Two Columns: Projection Health & Recent Audit Activity */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
              gap: "24px",
              minWidth: 0,
              width: "100%",
            }}
          >
            {/* Projection Sync Health */}
            <div className="card" style={{ padding: "20px", minWidth: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ fontSize: "15px", fontWeight: 700, margin: 0, color: "var(--color-text)" }}>
                    Projection Sync Health
                  </h3>
                  <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                    Decentralized read models populated from integration events
                  </span>
                </div>
                <Link to="/reporting" style={{ fontSize: "12px", color: "var(--color-primary)", fontWeight: 600 }}>
                  View Reports &rarr;
                </Link>
              </div>

              {dashboard?.projection_health && dashboard.projection_health.length > 0 ? (
                <div className="table-wrap" style={{ width: "100%", maxWidth: "100%", overflowX: "auto" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Projection Type</th>
                        <th>Processed</th>
                        <th>Sync Lag</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.projection_health.map((proj) => (
                        <tr key={proj.projection_type}>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: "13px" }}>
                              {proj.projection_type.replace(/_/g, " ").toUpperCase()}
                            </div>
                            {proj.last_processed_at && (
                              <div style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                                Last sync: {new Date(proj.last_processed_at).toLocaleTimeString()}
                              </div>
                            )}
                          </td>
                          <td>{proj.events_processed_count} events</td>
                          <td>{proj.lag_seconds != null ? `${proj.lag_seconds.toFixed(1)}s` : "0.0s"}</td>
                          <td>
                            <StatusBadge status={proj.error_count > 0 ? "FAILED" : "HEALTHY"} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: "32px", textAlign: "center", color: "var(--color-muted)", fontSize: "13px" }}>
                  All projections synchronized with zero outbox lag.
                </div>
              )}

              {/* Honest Capability Callout for Planned Projections */}
              <div
                style={{
                  marginTop: "16px",
                  padding: "12px",
                  background: "#f8fafc",
                  borderRadius: "var(--radius)",
                  border: "1px dashed var(--color-border)",
                  fontSize: "12px",
                  color: "var(--color-muted)",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: "4px", color: "var(--color-text)" }}>
                  Capability Status &bull; Phase 7 Read Models:
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
                  <span className="badge badge-active" style={{ fontSize: "11px" }}>Buyers (Supported)</span>
                  <span className="badge badge-neutral" style={{ fontSize: "11px" }}>Suppliers (Pending Event Stream)</span>
                  <span className="badge badge-neutral" style={{ fontSize: "11px" }}>Products (Pending Event Stream)</span>
                  <span className="badge badge-neutral" style={{ fontSize: "11px" }}>Quotations (Pending Event Stream)</span>
                  <span className="badge badge-neutral" style={{ fontSize: "11px" }}>Planning (Pending Event Stream)</span>
                </div>
              </div>
            </div>

            {/* Recent Audit Actions Feed */}
            <div className="card" style={{ padding: "20px", minWidth: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ fontSize: "15px", fontWeight: 700, margin: 0, color: "var(--color-text)" }}>
                    Recent Control Panel Audit Events
                  </h3>
                  <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                    Immutable log of security and administrative operations
                  </span>
                </div>
                <Link to="/audit" style={{ fontSize: "12px", color: "var(--color-primary)", fontWeight: 600 }}>
                  Full Audit Log &rarr;
                </Link>
              </div>

              {recentAudit.length > 0 ? (
                <div className="table-wrap" style={{ width: "100%", maxWidth: "100%", overflowX: "auto" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Event Type</th>
                        <th>Actor</th>
                        <th>Target</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentAudit.map((evt) => (
                        <tr key={evt.id}>
                          <td style={{ fontSize: "12px", color: "var(--color-muted)", whiteSpace: "nowrap" }}>
                            {new Date(evt.created_at || evt.occurred_at || "").toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td>
                            <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-primary)" }}>
                              {(evt.event_type || evt.action || "").replace(/_/g, " ")}
                            </span>
                          </td>
                          <td style={{ fontSize: "12px" }}>
                            {evt.actor_label || evt.actor_email || evt.actor_type}
                          </td>
                          <td style={{ fontSize: "12px" }}>
                            {evt.target_type || "N/A"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: "32px", textAlign: "center", color: "var(--color-muted)", fontSize: "13px" }}>
                  No recent audit events recorded.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Confirmation Modal for Rebuild Projections */}
      <Modal
        open={rebuildModalOpen}
        onClose={() => setRebuildModalOpen(false)}
        title="Rebuild Global Buyer Projections"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontSize: "14px" }}>
          <p style={{ margin: 0, color: "var(--color-text)" }}>
            Are you sure you want to rebuild the <strong>Global Buyer Projection</strong> catalog?
          </p>
          <div
            style={{
              padding: "12px",
              background: "#fffbeb",
              border: "1px solid #fef3c7",
              borderRadius: "var(--radius)",
              color: "#92400e",
              fontSize: "13px",
            }}
          >
            <strong>Note:</strong> This operation resets the projection checkpoint and re-processes all stored
            <code>buyer.created</code> events in ERP_Main&apos;s local inbox. It does not query or mutate Yinglima or
            Inhyma databases.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setRebuildModalOpen(false)}
              disabled={rebuilding}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleRebuildProjections}
              disabled={rebuilding}
            >
              {rebuilding ? "Rebuilding..." : "Confirm Rebuild"}
            </button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
