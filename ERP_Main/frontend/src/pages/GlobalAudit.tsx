/**
 * Global Audit Log Explorer for ERP_Main Control Plane (Phase 7).
 *
 * Provides a tamper-evident audit trail of all security, identity,
 * integration, and operational actions executed across the control plane.
 */

import { useEffect, useRef, useState, useMemo } from "react";
import { apiGet } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, Banner, Modal, EmptyState } from "@/components/ui";
import { Pagination } from "@/components/Pagination";
import { ICONS } from "@/components/icons";
import type { GlobalAuditEvent } from "@/types";

// Categorized Event Groups for Operational Filtering
const EVENT_CATEGORIES: Record<string, string[]> = {
  ALL: [],
  IDENTITY: [
    "GLOBAL_USER_CREATED",
    "GLOBAL_USER_UPDATED",
    "GLOBAL_USER_SUSPENDED",
    "GLOBAL_USER_REGISTERED",
    "GLOBAL_LOGIN_SUCCESS",
    "GLOBAL_LOGIN_FAILURE",
    "GLOBAL_LOGOUT",
    "MEMBERSHIP_CREATED",
    "MEMBERSHIP_VERIFIED",
    "MEMBERSHIP_SUSPENDED",
    "MEMBERSHIP_RESTORED",
    "MEMBERSHIP_REVOKED",
    "GLOBAL_USER_LINKED",
    "GLOBAL_USER_UNLINKED",
    "IDENTITY_CONFLICT_CREATED",
    "IDENTITY_CONFLICT_RESOLVED",
    "MEMBERSHIP_AUTO_PROVISIONED",
  ],
  AUTHZ: [
    "PLATFORM_ROLE_CREATED",
    "PLATFORM_ROLE_UPDATED",
    "PLATFORM_PERMISSION_CREATED",
    "PLATFORM_ROLE_PERMISSION_GRANTED",
    "PLATFORM_ROLE_PERMISSION_REVOKED",
    "PLATFORM_AUTHORIZATION_DENIED",
    "PLATFORM_ROLE_DELETED",
    "PLATFORM_ROLE_ASSIGNED",
    "SYSTEM_PERMISSIONS_SEEDED",
  ],
  SYSTEM: [
    "SYSTEM_BOOTSTRAP_SUPERADMIN",
    "DATA_SEED_COMPLETED",
    "ERP_REGISTERED",
    "ERP_DECOMMISSIONED",
    "ERP_REACTIVATED",
  ],
  INTEGRATION: [
    "INTEGRATION_EVENT_RECEIVED",
    "INTEGRATION_EVENT_DUPLICATE",
    "INTEGRATION_EVENT_ROUTED",
    "INTEGRATION_EVENT_DEAD_LETTERED",
    "INTEGRATION_EVENT_REPLAYED",
    "INTEGRATION_SUBSCRIPTION_CREATED",
    "INTEGRATION_SUBSCRIPTION_UPDATED",
    "CROSS_ERP_EVENT_RECEIVED",
    "CROSS_ERP_EVENT_ROUTED",
    "CROSS_ERP_EVENT_FAILED",
    "CROSS_ERP_EVENT_DEAD_LETTERED",
    "DEAD_LETTER_REPLAYED",
  ],
  REPORTING: [
    "RECONCILIATION_EXECUTED",
    "PROJECTION_REBUILD_EXECUTED",
    "REPORT_EXPORT_REQUESTED",
  ],
  SECURITY: [
    "SECURITY_INVALID_REDIRECT_URI",
    "SECURITY_INVALID_STATE",
    "SECURITY_INVALID_NONCE",
    "SECURITY_INVALID_AUDIENCE",
    "SECURITY_EXPIRED_TOKEN",
    "SECURITY_REPLAY_ATTEMPT",
  ],
  PROJECTIONS: [
    "BUYER_PROJECTION_UPSERTED",
    "BUYER_PROJECTION_REBUILT",
    "BUYER_PROJECTION_RECONCILED",
  ],
};

export function GlobalAudit() {
  const [events, setEvents] = useState<GlobalAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const inFlightRef = useRef(false);

  // Filters
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Detail Inspection Drawer
  const [selectedAudit, setSelectedAudit] = useState<GlobalAuditEvent | null>(null);

  const fetchAudit = async (silent = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await apiGet<GlobalAuditEvent[]>("/global/audit?limit=200");
      setEvents(Array.isArray(data) ? data : []);
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
    fetchAudit();

    // Conservative 30s monitoring poll that pauses when hidden
    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      fetchAudit(true);
    }, 30000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchAudit(true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const filtered = useMemo(() => {
    return events.filter((evt) => {
      const eventType = evt.event_type || evt.action || "";
      const actor = evt.actor_label || evt.actor_email || evt.actor_type || "";
      const targetType = evt.target_type || "";
      const targetId = evt.target_id || "";

      // Category filter
      if (categoryFilter !== "ALL") {
        const allowedTypes = EVENT_CATEGORIES[categoryFilter] || [];
        if (!allowedTypes.includes(eventType)) return false;
      }

      // Search match
      if (search.trim() !== "") {
        const q = search.toLowerCase();
        const matchesType = eventType.toLowerCase().includes(q);
        const matchesActor = actor.toLowerCase().includes(q);
        const matchesTarget = targetType.toLowerCase().includes(q) || targetId.toLowerCase().includes(q);
        if (!matchesType && !matchesActor && !matchesTarget) return false;
      }

      return true;
    });
  }, [events, categoryFilter, search]);

  const pagedEvents = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  return (
    <AppShell
      activeKey="audit"
      pageTitle="Global Audit Log"
      breadcrumbs={["Audit & Compliance", "Global Audit"]}
    >
      <Banner error={error} />

      {/* Filter Bar */}
      <div
        className="card"
        style={{
          padding: "16px 20px",
          marginBottom: "20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", flex: 1 }}>
          <div style={{ position: "relative", minWidth: "260px", maxWidth: "400px" }}>
            <ICONS.search
              width={16}
              height={16}
              style={{ position: "absolute", left: "10px", top: "10px", color: "var(--color-muted)" }}
            />
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: "32px", height: "36px", width: "100%" }}
              placeholder="Search by event type, actor, or target..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <select
            className="form-select"
            style={{ width: "auto", height: "36px" }}
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">All Categories</option>
            <option value="IDENTITY">Identity &amp; Users</option>
            <option value="AUTHZ">Platform RBAC</option>
            <option value="INTEGRATION">Cross-ERP Integration</option>
            <option value="REPORTING">Reporting &amp; Reconciliation</option>
            <option value="SECURITY">Security Warnings</option>
          </select>
        </div>

        <div style={{ fontSize: "13px", color: "var(--color-muted)" }}>
          Showing <strong>{filtered.length}</strong> of <strong>{events.length}</strong> logged control plane events
        </div>
      </div>

      {loading ? (
        <LoadingSpinner text="Loading global audit log..." />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No Audit Events Found"
          description={
            search || categoryFilter !== "ALL"
              ? "No audit records matched your current filters."
              : "No audit events recorded in the control plane yet."
          }
        />
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: "20px" }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Event Type</th>
                  <th>Actor</th>
                  <th>Actor Type</th>
                  <th>Target Type</th>
                  <th>Target ID</th>
                  <th style={{ textAlign: "right" }}>Inspect</th>
                </tr>
              </thead>
              <tbody>
                {pagedEvents.map((evt) => (
                  <tr key={evt.id}>
                    <td style={{ fontSize: "12px", color: "var(--color-muted)", whiteSpace: "nowrap" }}>
                      {new Date(evt.created_at || evt.occurred_at || "").toLocaleString([], {
                        dateStyle: "short",
                        timeStyle: "medium",
                      })}
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--color-primary)" }}>
                        {(evt.event_type || evt.action || "").replace(/_/g, " ")}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontWeight: 600, fontSize: "13px" }}>
                        {evt.actor_label || evt.actor_email || "System"}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-neutral" style={{ textTransform: "uppercase", fontSize: "11px" }}>
                        {evt.actor_type}
                      </span>
                    </td>
                    <td style={{ fontSize: "13px" }}>{evt.target_type || "N/A"}</td>
                    <td>
                      <code style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                        {evt.target_id ? `${evt.target_id.slice(0, 8)}...` : "—"}
                      </code>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => setSelectedAudit(evt)}
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            pagination={{
              current_page: page,
              total_pages: Math.ceil(filtered.length / pageSize) || 1,
              total_records: filtered.length,
              page_size: pageSize,
              has_previous: page > 1,
              has_next: page < (Math.ceil(filtered.length / pageSize) || 1),
            }}
            pageSize={pageSize}
            onPageChange={(p) => setPage(p)}
          />
        </div>
      )}

      {/* Audit Event Detail Drawer */}
      <Modal
        open={Boolean(selectedAudit)}
        onClose={() => setSelectedAudit(null)}
        title="Audit Event Inspection"
        variant="drawer"
        cardStyle={{ width: "520px" }}
      >
        {selectedAudit && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontSize: "13px" }}>
            <div>
              <span className="drawer-detail-label">EVENT TYPE</span>
              <h3 style={{ margin: "4px 0 0", fontSize: "17px", color: "var(--color-primary)" }}>
                {(selectedAudit.event_type || selectedAudit.action || "").replace(/_/g, " ")}
              </h3>
            </div>

            <div className="drawer-detail-grid">
              <div className="drawer-detail-row">
                <span className="drawer-detail-label">TIMESTAMP</span>
                <div>{new Date(selectedAudit.created_at || selectedAudit.occurred_at || "").toLocaleString()}</div>
              </div>

              <div className="drawer-detail-row">
                <span className="drawer-detail-label">ACTOR</span>
                <div style={{ fontWeight: 600 }}>{selectedAudit.actor_label || selectedAudit.actor_email || "System"}</div>
                <div style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                  Type: {selectedAudit.actor_type} &bull; ID: {selectedAudit.actor_id || "N/A"}
                </div>
              </div>

              <div className="drawer-detail-row">
                <span className="drawer-detail-label">TARGET ENTITY</span>
                <div>Type: <strong>{selectedAudit.target_type || "N/A"}</strong></div>
                {selectedAudit.target_id && (
                  <code style={{ fontSize: "11px" }}>UUID: {selectedAudit.target_id}</code>
                )}
              </div>

              <div className="drawer-detail-row" style={{ borderBottom: "none" }}>
                <span className="drawer-detail-label" style={{ marginBottom: "6px" }}>
                  AUDIT EVENT METADATA
                </span>
                <pre className="json-preview" style={{ maxHeight: "240px", overflow: "auto" }}>
                  {selectedAudit.details && Object.keys(selectedAudit.details).length > 0
                    ? JSON.stringify(selectedAudit.details, null, 2)
                    : "No structured metadata recorded with this audit entry."}
                </pre>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedAudit(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
