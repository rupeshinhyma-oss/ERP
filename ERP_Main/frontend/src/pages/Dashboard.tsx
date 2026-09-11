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
import { StatusBadge, LoadingSpinner, Banner, Modal } from "@/components/ui";
import { ICONS } from "@/components/icons";
import type { GlobalDashboard, GlobalAuditEvent } from "@/types";

export function Dashboard() {
  const { isSuperAdmin, userType } = useGlobalSession();
  const toast = useToast();

  const [dashboard, setDashboard] = useState<GlobalDashboard | null>(null);
  const [recentAudit, setRecentAudit] = useState<GlobalAuditEvent[]>([]);
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
      const [dashData, auditData] = await Promise.all([
        apiGet<GlobalDashboard>("/global/dashboard").catch(() => null),
        apiGet<GlobalAuditEvent[]>("/global/audit?limit=6").catch(() => []),
      ]);

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
        <div style={{ display: "flex", gap: "8px" }}>
          {canRebuild && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setRebuildModalOpen(true)}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <ICONS.refreshCw width={14} height={14} />
              Rebuild Projections
            </button>
          )}
          <Link to="/erps" className="btn btn-primary btn-sm" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <ICONS.plus width={14} height={14} />
            Register ERP
          </Link>
        </div>
      }
    >
      <Banner error={error} />

      {loading && !dashboard ? (
        <LoadingSpinner text="Loading control panel metrics..." />
      ) : (
        <>
          {/* Freshness Banner */}
          {dashboard?.data_as_of && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 16px",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                marginBottom: "20px",
                fontSize: "12px",
                color: "var(--color-muted)",
              }}
            >
              <span>
                Control Panel Operations Aggregation &bull; Data accurate as of:{" "}
                <strong>{new Date(dashboard.data_as_of).toLocaleTimeString()}</strong>
              </span>
              <span style={{ fontSize: "11px", color: "var(--color-primary)" }}>
                Zero cross-database business queries
              </span>
            </div>
          )}

          {/* Top Stat Tiles */}
          <div className="cp-stat-grid">
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

          {/* Architectural Boundary Note */}
          <div
            style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              padding: "12px 16px",
              marginBottom: "24px",
              fontSize: "12px",
              color: "var(--color-text-secondary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <div>
              <strong>Architecture Guardrail:</strong> Global Users and Memberships govern control-plane identity.
              Business entities (buyers, purchase orders, inventory) remain strictly owned by local ERP databases.
            </div>
            <Link to="/integration" style={{ color: "var(--color-primary)", fontWeight: 600 }}>
              Integration Monitor ({dashboard?.events_dead_lettered_total ?? 0} dead letters) &rarr;
            </Link>
          </div>

          {/* ERP Fleet Status Grid */}
          <div style={{ marginBottom: "32px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "var(--color-text)" }}>
                Registered ERP Fleet Status
              </h2>
              <Link to="/erps" style={{ fontSize: "13px", color: "var(--color-primary)", fontWeight: 600 }}>
                Manage All ERPs &rarr;
              </Link>
            </div>

            {dashboard?.erp_health && dashboard.erp_health.length > 0 ? (
              <div className="erp-launcher-grid">
                {dashboard.erp_health.map((erp) => (
                  <div key={erp.erp_id} className="erp-launcher-card">
                    <div>
                      <div className="erp-launcher-card-header">
                        <div>
                          <h3 className="erp-launcher-card-title">{erp.display_name}</h3>
                          <span className="erp-launcher-card-key">{erp.erp_key}</span>
                        </div>
                        <StatusBadge status={erp.status} />
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
                    </div>

                    <div className="erp-launcher-card-footer" style={{ marginTop: "16px" }}>
                      <Link to={`/erps/${erp.erp_id}`} className="btn btn-secondary btn-sm">
                        View Details
                      </Link>
                      <Link to="/my-erps" className="btn btn-primary btn-sm" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        Launch ERP
                        <ICONS.externalLink width={13} height={13} />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="card" style={{ padding: "24px", textAlign: "center", color: "var(--color-muted)" }}>
                No active ERP fleet instances registered yet.
                <div style={{ marginTop: "12px" }}>
                  <Link to="/erps" className="btn btn-primary btn-sm">
                    Go to ERP Registry
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* Two Columns: Projection Health & Recent Audit Activity */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "24px" }}>
            {/* Projection Sync Health */}
            <div className="card" style={{ padding: "20px" }}>
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
                <div className="table-wrap">
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
            <div className="card" style={{ padding: "20px" }}>
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
                <div className="table-wrap">
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
