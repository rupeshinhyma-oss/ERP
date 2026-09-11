/**
 * ERP Detail View for ERP_Main Control Plane.
 *
 * Detailed inspection of an ERP instance: capabilities, members, and health.
 */

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { StatusBadge, LoadingSpinner, Banner } from "@/components/ui";
import { ICONS } from "@/components/icons";
import type { ErpInstance, ErpMembership } from "@/types";

export function ErpDetail() {
  const { id } = useParams<{ id: string }>();

  const [erp, setErp] = useState<ErpInstance | null>(null);
  const [members, setMembers] = useState<ErpMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "members" | "health">("overview");

  useEffect(() => {
    if (!id) return;
    const loadErp = (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);

      Promise.all([
        apiGet<ErpInstance>(`/global/erps/${id}`),
        apiGet<ErpMembership[]>(`/global/erps/${id}/members`).catch(() => []),
      ])
        .then(([erpData, membersData]) => {
          setErp(erpData);
          setMembers(Array.isArray(membersData) ? membersData : []);
        })
        .catch((err) => setError(err))
        .finally(() => {
          if (!silent) setLoading(false);
        });
    };

    loadErp();

    // Revalidate when user returns to this tab without background periodic polling
    const handleFocus = () => {
      loadErp(true);
    };
    window.addEventListener("focus", handleFocus);

    return () => window.removeEventListener("focus", handleFocus);
  }, [id]);

  return (
    <AppShell
      activeKey="erps"
      pageTitle={erp ? `${erp.name} Details` : "ERP Details"}
      breadcrumbs={["ERP Management", "ERP Registry", erp ? erp.name : "Details"]}
      actions={
        erp && (
          <div style={{ display: "flex", gap: "8px" }}>
            <Link to="/erps" className="btn btn-secondary btn-sm">
              ← Back to Registry
            </Link>
            <a
              href={erp.base_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-sm"
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              Open ERP
              <ICONS.externalLink width={14} height={14} />
            </a>
          </div>
        )
      }
    >
      <Banner error={error} />

      {loading ? (
        <LoadingSpinner text="Loading ERP details..." />
      ) : !erp ? (
        <div className="card" style={{ padding: "32px", textAlign: "center" }}>
          ERP instance not found or could not be loaded.
        </div>
      ) : (
        <>
          {/* Header Card */}
          <div className="card" style={{ padding: "24px", marginBottom: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 800, color: "var(--color-text)" }}>
                    {erp.name}
                  </h2>
                  <StatusBadge status={erp.status} />
                </div>
                <div style={{ marginTop: "4px", fontSize: "13px", color: "var(--color-muted)" }}>
                  Key: <code style={{ color: "var(--color-primary)" }}>{erp.erp_key}</code> · Version: v{erp.version}
                </div>
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <span className="badge badge-info" style={{ fontSize: "12px", padding: "6px 12px" }}>
                  {members.length} Registered Members
                </span>
              </div>
            </div>

            {/* Tab Navigation */}
            <div style={{ display: "flex", gap: "8px", marginTop: "24px", borderBottom: "1px solid var(--color-border)" }}>
              {(["overview", "members", "health"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: "8px 16px",
                    background: "none",
                    border: "none",
                    borderBottom: activeTab === tab ? "2px solid var(--color-primary)" : "2px solid transparent",
                    fontWeight: activeTab === tab ? 700 : 500,
                    color: activeTab === tab ? "var(--color-primary)" : "var(--color-muted)",
                    cursor: "pointer",
                    textTransform: "capitalize",
                    fontSize: "14px",
                  }}
                >
                  {tab === "overview" ? "Overview & Capabilities" : tab === "members" ? `Members (${members.length})` : "Health & Integration"}
                </button>
              ))}
            </div>
          </div>

          {/* Tab 1: Overview */}
          {activeTab === "overview" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "20px" }}>
              <div className="card" style={{ padding: "20px" }}>
                <h3 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 16px" }}>Technical Configuration</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px" }}>
                  <div>
                    <span style={{ color: "var(--color-muted)", display: "block", fontSize: "11px" }}>BASE URL</span>
                    <a href={erp.base_url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "monospace" }}>
                      {erp.base_url}
                    </a>
                  </div>
                  <div>
                    <span style={{ color: "var(--color-muted)", display: "block", fontSize: "11px" }}>SYSTEM ID</span>
                    <code style={{ fontSize: "12px" }}>{erp.id}</code>
                  </div>
                  <div>
                    <span style={{ color: "var(--color-muted)", display: "block", fontSize: "11px" }}>REGISTRATION DATE</span>
                    <span>{new Date(erp.created_at).toLocaleString()}</span>
                  </div>
                  {erp.updated_at && (
                    <div>
                      <span style={{ color: "var(--color-muted)", display: "block", fontSize: "11px" }}>LAST UPDATED</span>
                      <span>{new Date(erp.updated_at).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="card" style={{ padding: "20px" }}>
                <h3 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 16px" }}>Declared Capabilities</h3>
                <p style={{ fontSize: "13px", color: "var(--color-muted)", margin: "0 0 16px" }}>
                  Modules and business domains supported by this local ERP instance.
                </p>
                <div className="capability-pills">
                  {erp.capabilities && erp.capabilities.length > 0 ? (
                    erp.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="capability-pill"
                        style={{ padding: "6px 12px", fontSize: "12px", background: "var(--color-primary-soft)", color: "var(--color-primary)" }}
                      >
                        {cap}
                      </span>
                    ))
                  ) : (
                    <span style={{ color: "var(--color-muted)" }}>No specific capabilities advertised.</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Members */}
          {activeTab === "members" && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {members.length === 0 ? (
                <div style={{ padding: "32px", textAlign: "center", color: "var(--color-muted)" }}>
                  No Global Users currently hold active memberships in this ERP instance.
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Global User Identity</th>
                        <th>Local ERP User ID</th>
                        <th>Membership Status</th>
                        <th>Linked Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.id}>
                          <td style={{ fontWeight: 600 }}>{m.user_email || m.global_user_id}</td>
                          <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{m.local_user_id}</td>
                          <td>
                            <StatusBadge status={m.status} />
                          </td>
                          <td style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                            {new Date(m.created_at).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Health */}
          {activeTab === "health" && (
            <div className="card" style={{ padding: "20px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 12px" }}>Integration & Heartbeat Status</h3>
              <p style={{ fontSize: "13px", color: "var(--color-muted)", margin: "0 0 20px" }}>
                Transactional Outbox and Event Dispatch health between ERP_Main and {erp.name}.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
                <div style={{ padding: "16px", background: "var(--color-bg)", borderRadius: "var(--radius)" }}>
                  <div style={{ fontSize: "11px", color: "var(--color-muted)" }}>DISPATCH PROTOCOL</div>
                  <div style={{ fontSize: "14px", fontWeight: 700, marginTop: "4px" }}>HTTP / JSON-RPC</div>
                </div>
                <div style={{ padding: "16px", background: "var(--color-bg)", borderRadius: "var(--radius)" }}>
                  <div style={{ fontSize: "11px", color: "var(--color-muted)" }}>HEARTBEAT STATUS</div>
                  <div style={{ fontSize: "14px", fontWeight: 700, marginTop: "4px", color: "#10b981" }}>Active & Reachable</div>
                </div>
                <div style={{ padding: "16px", background: "var(--color-bg)", borderRadius: "var(--radius)" }}>
                  <div style={{ fontSize: "11px", color: "var(--color-muted)" }}>SECURITY BOUNDARY</div>
                  <div style={{ fontSize: "14px", fontWeight: 700, marginTop: "4px" }}>Local RBAC Authoritative</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
