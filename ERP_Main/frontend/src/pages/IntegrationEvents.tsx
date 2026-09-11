/**
 * Integration Control Plane for ERP_Main.
 *
 * Provides production-grade visibility and operations over cross-ERP event flows:
 * - Integration fleet health and synchronization lag
 * - Ingested event pipeline (Inbox, routed, ignored, failed)
 * - Dead-letter recovery with authorized operator replay
 * - Capability-aware routing subscriptions & transactional outbox architecture
 * - Buyer projection reconciliation with honest external state reporting
 * - Safe payload inspection with server-side credential redaction
 */

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { apiGet, apiPost, apiPatch, errorMessage } from "@/lib/api";
import { useGlobalSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { AppShell } from "@/components/AppShell";
import { SectionNavTabs } from "@/components/SectionNavTabs";
import { INTEGRATION_SECTION_TABS } from "@/lib/nav";
import { StatusBadge, LoadingSpinner, SkeletonTable, Banner, Modal } from "@/components/ui";
import { Pagination } from "@/components/Pagination";
import { ICONS } from "@/components/icons";
import type {
  IntegrationInboxEvent,
  IntegrationDeadLetter,
  IntegrationSubscription,
  ReconciliationResult,
  GlobalDashboard,
  ErpInstance,
} from "@/types";

type ActiveTab = "overview" | "events" | "dead_letters" | "subscriptions" | "reconciliation";

export function IntegrationEvents() {
  const { isSuperAdmin, userType } = useGlobalSession();
  const showToast = useToast();

  const canManage = isSuperAdmin || userType === "platform_admin";
  const canReconcile = isSuperAdmin || userType === "platform_admin";

  const location = useLocation();

  const resolveTabFromPath = useCallback((): ActiveTab => {
    if (location.pathname.includes("/subscriptions")) return "subscriptions";
    if (location.pathname.includes("/dlq")) return "dead_letters";
    if (
      location.pathname.includes("/events") ||
      location.pathname.includes("/deliveries") ||
      location.pathname.includes("/failed")
    )
      return "events";
    return "overview";
  }, [location.pathname]);

  // Tab & Data State
  const [activeTab, setActiveTab] = useState<ActiveTab>(resolveTabFromPath);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    setActiveTab(resolveTabFromPath());
    if (location.pathname.includes("/failed")) {
      setStatusFilter("FAILED");
    }
  }, [resolveTabFromPath, location.pathname]);

  // Core Data
  const [dashboard, setDashboard] = useState<GlobalDashboard | null>(null);
  const [inboxEvents, setInboxEvents] = useState<IntegrationInboxEvent[]>([]);
  const [deadLetters, setDeadLetters] = useState<IntegrationDeadLetter[]>([]);
  const [subscriptions, setSubscriptions] = useState<IntegrationSubscription[]>([]);
  const [erps, setErps] = useState<ErpInstance[]>([]);
  const [reconciliations, setReconciliations] = useState<Record<string, ReconciliationResult>>({});

  // Filtering for Events Tab
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("");
  const [correlationIdFilter, setCorrelationIdFilter] = useState<string>("");
  const [eventPage, setEventPage] = useState(1);
  const pageSize = 15;

  // Drawer / Inspection State
  const [inspectingEvent, setInspectingEvent] = useState<IntegrationInboxEvent | null>(null);
  const [inspectingPayloadLoading, setInspectingPayloadLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Action Modals State
  const [replayingDeadLetter, setReplayingDeadLetter] = useState<IntegrationDeadLetter | null>(null);
  const [replayingSubmitting, setReplayingSubmitting] = useState(false);

  const [togglingSub, setTogglingSub] = useState<IntegrationSubscription | null>(null);
  const [togglingSubmitting, setTogglingSubmitting] = useState(false);

  const [reconcilingErpId, setReconcilingErpId] = useState<string | null>(null);

  // Map of ERPs for fast name lookup
  const erpMap = useMemo(() => {
    const map = new Map<string, ErpInstance>();
    for (const erp of erps) {
      map.set(erp.id, erp);
      map.set(erp.erp_key, erp);
    }
    return map;
  }, [erps]);

  const resolveErpName = useCallback(
    (idOrKey: string) => {
      const match = erpMap.get(idOrKey);
      return match ? match.name : idOrKey;
    },
    [erpMap]
  );

  // Copy helper
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(text);
      showToast(`${label} copied to clipboard`, "info", 2000);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const inFlightRef = useRef(false);

  // Load all integration control-plane resources
  const fetchAllData = useCallback(async (isSilentRefresh = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!isSilentRefresh) {
      setLoading(true);
    }
    setError(null);

    try {
      const [dashRes, erpsRes, deadLettersRes, subsRes] = await Promise.all([
        apiGet<GlobalDashboard>("/global/dashboard").catch(() => null),
        apiGet<ErpInstance[]>("/global/erps").catch(() => []),
        apiGet<IntegrationDeadLetter[]>("/global/integration/dead-letters?limit=100").catch(() => []),
        apiGet<IntegrationSubscription[]>("/global/integration/subscriptions").catch(() => []),
      ]);

      if (dashRes) setDashboard(dashRes);
      setErps(Array.isArray(erpsRes) ? erpsRes : []);
      setDeadLetters(Array.isArray(deadLettersRes) ? deadLettersRes : []);
      setSubscriptions(Array.isArray(subsRes) ? subsRes : []);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err);
    } finally {
      inFlightRef.current = false;
      if (!isSilentRefresh) {
        setLoading(false);
      }
    }
  }, []);

  // Fetch inbox events with active filters
  const fetchInboxEvents = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.append("limit", "100");
      if (statusFilter) params.append("status_filter", statusFilter);
      if (eventTypeFilter.trim()) params.append("event_type", eventTypeFilter.trim());
      if (correlationIdFilter.trim()) params.append("correlation_id", correlationIdFilter.trim());

      const res = await apiGet<IntegrationInboxEvent[]>(`/global/integration/inbox?${params.toString()}`);
      setInboxEvents(Array.isArray(res) ? res : []);
      setEventPage(1);
    } catch (err) {
      // Don't override main error if page already loaded
      console.error("Failed to load inbox events:", err);
    }
  }, [statusFilter, eventTypeFilter, correlationIdFilter]);

  useEffect(() => {
    fetchAllData();

    // Conservative 30s monitoring poll that pauses when hidden
    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      fetchAllData(true);
      fetchInboxEvents();
    }, 30000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchAllData(true);
        fetchInboxEvents();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchAllData, fetchInboxEvents]);

  useEffect(() => {
    fetchInboxEvents();
  }, [fetchInboxEvents]);

  // Inspect event detail & load sanitized payload
  const handleInspect = async (event: IntegrationInboxEvent) => {
    setInspectingEvent(event);
    setInspectingPayloadLoading(true);
    try {
      const detail = await apiGet<IntegrationInboxEvent>(`/global/integration/inbox/${event.event_id || event.id}`);
      if (detail && detail.payload !== undefined) {
        setInspectingEvent(detail);
      }
    } catch (err) {
      console.warn("Could not load full event payload:", err);
    } finally {
      setInspectingPayloadLoading(false);
    }
  };

  // Trace correlation ID
  const handleTraceCorrelation = (correlationId: string) => {
    setCorrelationIdFilter(correlationId);
    setActiveTab("events");
    if (inspectingEvent) setInspectingEvent(null);
    showToast(`Filtering events by correlation ID ${correlationId.slice(0, 8)}...`, "info");
  };

  // Replay Dead Letter Handler
  const handleReplayConfirm = async () => {
    if (!replayingDeadLetter) return;
    setReplayingSubmitting(true);
    try {
      await apiPost(`/global/integration/dead-letters/${replayingDeadLetter.id}/replay`);
      showToast("Dead-lettered event replay initiated successfully.", "success");
      setReplayingDeadLetter(null);
      // Refresh dead letters and inbox
      const [updatedDeadLetters] = await Promise.all([
        apiGet<IntegrationDeadLetter[]>("/global/integration/dead-letters?limit=100").catch(() => []),
        fetchInboxEvents(),
      ]);
      setDeadLetters(updatedDeadLetters);
    } catch (err) {
      showToast(errorMessage(err, "Failed to replay dead-lettered event."), "error");
    } finally {
      setReplayingSubmitting(false);
    }
  };

  // Toggle Subscription Handler
  const handleToggleSubscriptionConfirm = async () => {
    if (!togglingSub) return;
    setTogglingSubmitting(true);
    try {
      const updated = await apiPatch<IntegrationSubscription>(
        `/global/integration/subscriptions/${togglingSub.id}`,
        { enabled: !togglingSub.enabled }
      );
      showToast(
        `Subscription for "${togglingSub.event_type}" ${updated.enabled ? "enabled" : "disabled"}.`,
        "success"
      );
      setSubscriptions((prev) => prev.map((s) => (s.id === togglingSub.id ? updated : s)));
      setTogglingSub(null);
    } catch (err) {
      showToast(errorMessage(err, "Failed to update subscription."), "error");
    } finally {
      setTogglingSubmitting(false);
    }
  };

  // Run Reconciliation Handler
  const handleRunReconciliation = async (erpId: string, erpName: string) => {
    setReconcilingErpId(erpId);
    try {
      const result = await apiPost<ReconciliationResult>(`/global/reconciliation/erps/${erpId}`);
      setReconciliations((prev) => ({ ...prev, [erpId]: result }));
      showToast(
        `Reconciliation pass completed for ${erpName}. Status: ${result.status}`,
        result.status === "MATCHED" ? "success" : "info"
      );
    } catch (err) {
      showToast(errorMessage(err, `Reconciliation failed for ${erpName}.`), "error");
    } finally {
      setReconcilingErpId(null);
    }
  };

  // Pagination slice for Events tab
  const paginatedEvents = useMemo(() => {
    const start = (eventPage - 1) * pageSize;
    return inboxEvents.slice(start, start + pageSize);
  }, [inboxEvents, eventPage, pageSize]);

  const totalEventPages = Math.ceil(inboxEvents.length / pageSize) || 1;

  const sectionKey = useMemo(() => {
    if (location.pathname.includes("/subscriptions")) return "subscriptions";
    if (location.pathname.includes("/dlq")) return "dead-letter-queue";
    if (location.pathname.includes("/deliveries")) return "delivery-status";
    if (location.pathname.includes("/failed")) return "failed-events";
    if (location.pathname.includes("/events")) return "integration-events";
    return "integrations";
  }, [location.pathname]);

  const pageTitle = useMemo(() => {
    if (sectionKey === "subscriptions") return "Event Routing Subscriptions";
    if (sectionKey === "dead-letter-queue") return "Dead Letter Queue & Recovery";
    if (sectionKey === "delivery-status") return "Event Delivery Lifecycle Status";
    if (sectionKey === "failed-events") return "Failed Integration Events";
    if (sectionKey === "integration-events") return "Integration Events Directory";
    return "ERP Integration Network";
  }, [sectionKey]);

  const tabItems = useMemo(() => {
    return INTEGRATION_SECTION_TABS.map((tab) => {
      if (tab.key === "dead-letter-queue") {
        return { ...tab, badge: deadLetters.length > 0 ? deadLetters.length : undefined };
      }
      if (tab.key === "integration-events") {
        return { ...tab, badge: inboxEvents.length > 0 ? inboxEvents.length : undefined };
      }
      if (tab.key === "subscriptions") {
        return { ...tab, badge: subscriptions.length > 0 ? subscriptions.length : undefined };
      }
      return tab;
    });
  }, [deadLetters.length, inboxEvents.length, subscriptions.length]);

  return (
    <AppShell
      activeKey={sectionKey}
      pageTitle={pageTitle}
      breadcrumbs={["Integrations", pageTitle]}
      actions={
        lastUpdated ? (
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>
              Auto-refreshed: {lastUpdated.toLocaleTimeString()}
            </span>
          </div>
        ) : undefined
      }
    >
      <SectionNavTabs items={tabItems} activeKey={sectionKey} />

      <Banner error={error} />

      {/* Global Control Plane Principle Banner */}
      <div
        style={{
          background: "linear-gradient(90deg, #eff6ff 0%, #f8fafc 100%)",
          border: "1px solid #bfdbfe",
          borderRadius: "var(--radius)",
          padding: "12px 16px",
          marginBottom: "20px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          fontSize: "13px",
          color: "#1e3a8a",
        }}
      >
        <div
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            background: "#dbeafe",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: "#1d4ed8",
          }}
        >
          <ICONS.shield width={18} height={18} />
        </div>
        <div style={{ lineHeight: 1.4 }}>
          <strong>Global Integration Control Plane:</strong> ERP_Main orchestrates capability-aware routing,
          transactional inboxing, deduplication, and dead-letter recovery. Independent ERPs (Yinglima, Inhyma) maintain
          their own transactional outboxes and business data without database sharing.
        </div>
      </div>

      {/* Main Tabs Container */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {/* Navigation Tabs Bar */}
        <div className="integration-tabs-bar">
          <button
            type="button"
            className={`integration-tab-btn ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            <ICONS.dashboard width={16} height={16} />
            Overview & Fleet Health
          </button>

          <button
            type="button"
            className={`integration-tab-btn ${activeTab === "events" ? "active" : ""}`}
            onClick={() => setActiveTab("events")}
          >
            <ICONS.activity width={16} height={16} />
            Events Directory
            <span className="integration-tab-count">{inboxEvents.length}</span>
          </button>

          <button
            type="button"
            className={`integration-tab-btn ${activeTab === "dead_letters" ? "active" : ""}`}
            onClick={() => setActiveTab("dead_letters")}
          >
            <ICONS.alertTriangle width={16} height={16} />
            Dead Letters & Replay
            {deadLetters.length > 0 && (
              <span className="integration-tab-count" style={{ background: "#ef4444", color: "#fff" }}>
                {deadLetters.length}
              </span>
            )}
          </button>

          <button
            type="button"
            className={`integration-tab-btn ${activeTab === "subscriptions" ? "active" : ""}`}
            onClick={() => setActiveTab("subscriptions")}
          >
            <ICONS.server width={16} height={16} />
            Routing Subscriptions & Outbox
            <span className="integration-tab-count">{subscriptions.length}</span>
          </button>

          <button
            type="button"
            className={`integration-tab-btn ${activeTab === "reconciliation" ? "active" : ""}`}
            onClick={() => setActiveTab("reconciliation")}
          >
            <ICONS.check width={16} height={16} />
            Reconciliation & Sync
          </button>
        </div>

        {/* TAB 1: OVERVIEW & FLEET HEALTH */}
        {activeTab === "overview" && (
          <div style={{ padding: "24px" }}>
            {loading ? (
              <LoadingSpinner text="Loading integration fleet metrics..." />
            ) : (
              <>
                {/* Metric Summary Grid */}
                <div className="cp-stat-grid">
                  <div className="cp-stat-card">
                    <div className="cp-stat-icon-wrapper" style={{ background: "#e0edff", color: "#0061f2" }}>
                      <ICONS.server width={24} height={24} />
                    </div>
                    <div className="cp-stat-info">
                      <span className="cp-stat-value">{dashboard?.active_erps ?? erps.length}</span>
                      <span className="cp-stat-label">Active ERP Instances</span>
                    </div>
                  </div>

                  <div className="cp-stat-card">
                    <div className="cp-stat-icon-wrapper" style={{ background: "#ecfdf5", color: "#10b981" }}>
                      <ICONS.activity width={24} height={24} />
                    </div>
                    <div className="cp-stat-info">
                      <span className="cp-stat-value">{dashboard?.events_received_total ?? 0}</span>
                      <span className="cp-stat-label">Total Ingested Events</span>
                    </div>
                  </div>

                  <div className="cp-stat-card">
                    <div className="cp-stat-icon-wrapper" style={{ background: "#fef2f2", color: "#ef4444" }}>
                      <ICONS.alertTriangle width={24} height={24} />
                    </div>
                    <div className="cp-stat-info">
                      <span className="cp-stat-value">
                        {dashboard?.events_dead_lettered_total ?? deadLetters.length}
                      </span>
                      <span className="cp-stat-label">Dead Letters (Exhausted)</span>
                    </div>
                  </div>

                  <div className="cp-stat-card">
                    <div className="cp-stat-icon-wrapper" style={{ background: "#f5f3ff", color: "#7c3aed" }}>
                      <ICONS.layers width={24} height={24} />
                    </div>
                    <div className="cp-stat-info">
                      <span className="cp-stat-value">
                        {dashboard?.projection_health?.[0]?.lag_seconds !== undefined &&
                        dashboard?.projection_health?.[0]?.lag_seconds !== null
                          ? `${dashboard.projection_health[0].lag_seconds.toFixed(1)}s`
                          : "0.0s"}
                      </span>
                      <span className="cp-stat-label">Projection Sync Lag</span>
                    </div>
                  </div>
                </div>

                {/* ERP Fleet Health Cards */}
                <h3 style={{ fontSize: "16px", fontWeight: 700, margin: "24px 0 12px" }}>
                  Registered ERP Integration Status
                </h3>
                {dashboard?.erp_health && dashboard.erp_health.length > 0 ? (
                  <div className="sync-grid">
                    {dashboard.erp_health.map((eh) => (
                      <div key={eh.erp_id} className="sync-card">
                        <div className="sync-card-header">
                          <span className="sync-card-title">
                            <ICONS.server width={16} height={16} />
                            {eh.display_name}
                          </span>
                          <StatusBadge status={eh.api_health} />
                        </div>

                        <div className="sync-card-body">
                          <div className="sync-meta-row">
                            <span style={{ color: "var(--color-muted)" }}>ERP Key:</span>
                            <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{eh.erp_key}</span>
                          </div>

                          <div className="sync-meta-row">
                            <span style={{ color: "var(--color-muted)" }}>Registration Status:</span>
                            <StatusBadge status={eh.status} />
                          </div>

                          <div className="sync-meta-row">
                            <span style={{ color: "var(--color-muted)" }}>Last Seen:</span>
                            <span>{eh.last_seen_at ? new Date(eh.last_seen_at).toLocaleTimeString() : "Never"}</span>
                          </div>

                          <div className="sync-meta-row">
                            <span style={{ color: "var(--color-muted)" }}>Buyer Projections:</span>
                            <span style={{ fontWeight: 700 }}>{eh.buyer_projection_count} synced</span>
                          </div>

                          <div style={{ marginTop: "6px" }}>
                            <span style={{ fontSize: "11px", color: "var(--color-muted)", display: "block", marginBottom: "4px" }}>
                              Declared Capabilities:
                            </span>
                            <div className="capability-pills">
                              {eh.enabled_capabilities && eh.enabled_capabilities.length > 0 ? (
                                eh.enabled_capabilities.map((cap) => (
                                  <span key={cap} className="capability-pill">
                                    {cap}
                                  </span>
                                ))
                              ) : (
                                <span style={{ fontSize: "11px", color: "var(--color-muted)" }}>None declared</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: "32px", textAlign: "center", color: "var(--color-muted)" }}>
                    No ERP health summaries available.
                  </div>
                )}

                {/* Projection Health Summary */}
                {dashboard?.projection_health && dashboard.projection_health.length > 0 && (
                  <div style={{ marginTop: "24px" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>
                      Projection Consumer Pipelines
                    </h3>
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Projection Type</th>
                            <th>Events Processed</th>
                            <th>Error Count</th>
                            <th>Sync Lag</th>
                            <th>Last Processed</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dashboard.projection_health.map((ph) => (
                            <tr key={ph.projection_type}>
                              <td style={{ fontWeight: 600 }}>{ph.projection_type}</td>
                              <td>{ph.events_processed_count}</td>
                              <td style={{ color: ph.error_count > 0 ? "var(--color-danger)" : "inherit" }}>
                                {ph.error_count}
                              </td>
                              <td>{ph.lag_seconds !== null ? `${ph.lag_seconds.toFixed(1)}s` : "Unknown"}</td>
                              <td style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                                {ph.last_processed_at ? new Date(ph.last_processed_at).toLocaleString() : "Never"}
                              </td>
                              <td>
                                <StatusBadge status={ph.error_count === 0 ? "HEALTHY" : "FAILED"} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* TAB 2: EVENTS DIRECTORY */}
        {activeTab === "events" && (
          <div>
            {/* Filter Bar */}
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                display: "flex",
                flexWrap: "wrap",
                gap: "12px",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              {/* Status Filter Buttons */}
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {(["", "ROUTED", "RECEIVED", "IGNORED", "FAILED", "DEAD_LETTER"] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={`btn btn-sm ${statusFilter === st ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setStatusFilter(st)}
                  >
                    {st === "" ? "All Statuses" : st === "ROUTED" ? "Routed (Processed)" : st}
                  </button>
                ))}
              </div>

              {/* Text Search & Filter Inputs */}
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Filter event type..."
                    value={eventTypeFilter}
                    onChange={(e) => setEventTypeFilter(e.target.value)}
                    style={{ fontSize: "12px", padding: "6px 10px", width: "180px" }}
                  />
                </div>

                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Correlation ID..."
                    value={correlationIdFilter}
                    onChange={(e) => setCorrelationIdFilter(e.target.value)}
                    style={{ fontSize: "12px", padding: "6px 10px", width: "180px", fontFamily: "monospace" }}
                  />
                </div>

                {(statusFilter || eventTypeFilter || correlationIdFilter) && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setStatusFilter("");
                      setEventTypeFilter("");
                      setCorrelationIdFilter("");
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Active Correlation Notice */}
            {correlationIdFilter && (
              <div
                style={{
                  padding: "8px 20px",
                  background: "#eff6ff",
                  borderBottom: "1px solid #dbeafe",
                  fontSize: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  color: "#1e40af",
                }}
              >
                <span>
                  Showing events scoped to trace correlation ID:{" "}
                  <code style={{ fontWeight: 700 }}>{correlationIdFilter}</code>
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => setCorrelationIdFilter("")}
                  style={{ fontSize: "11px", padding: "2px 8px" }}
                >
                  Reset Trace Filter
                </button>
              </div>
            )}

            {/* Events Table */}
            {loading ? (
              <SkeletonTable rows={6} cols={6} />
            ) : paginatedEvents.length === 0 ? (
              <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--color-muted)" }}>
                <ICONS.activity width={32} height={32} style={{ opacity: 0.5, marginBottom: "8px" }} />
                <p style={{ margin: 0, fontWeight: 600 }}>No integration events match the selected criteria.</p>
                <span style={{ fontSize: "12px" }}>
                  Incoming cross-ERP events will appear here once dispatched from business ERP outbox queues.
                </span>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Event Type</th>
                      <th>Event ID</th>
                      <th>Source ERP</th>
                      <th>Routed Target(s)</th>
                      <th>Status</th>
                      <th>Attempts</th>
                      <th>Timestamp</th>
                      <th>Correlation ID</th>
                      <th style={{ textAlign: "right" }}>Inspect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedEvents.map((evt) => {
                      const sourceName = resolveErpName(evt.source_erp_id);
                      return (
                        <tr
                          key={evt.id}
                          className={
                            evt.status === "DEAD_LETTER"
                              ? "event-row-deadletter"
                              : evt.status === "FAILED"
                              ? "event-row-inbox"
                              : ""
                          }
                        >
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span
                                style={{
                                  fontFamily: "monospace",
                                  fontWeight: 700,
                                  color: "var(--color-primary)",
                                  fontSize: "13px",
                                }}
                              >
                                {evt.event_type}
                              </span>
                              <span
                                style={{
                                  fontSize: "10px",
                                  padding: "1px 4px",
                                  borderRadius: "4px",
                                  background: "#f1f5f9",
                                  color: "#64748b",
                                }}
                              >
                                v{evt.event_version}
                              </span>
                            </div>
                            <div style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                              {evt.source_entity_type}: {evt.source_entity_id.slice(0, 8)}...
                            </div>
                          </td>

                          <td>
                            <button
                              type="button"
                              className="trace-code-btn"
                              title="Click to copy full Event ID"
                              onClick={() => handleCopy(evt.event_id, "Event ID")}
                            >
                              {evt.event_id.slice(0, 8)}...
                              <ICONS.copy width={10} height={10} />
                            </button>
                          </td>

                          <td>
                            <span style={{ fontWeight: 600, fontSize: "13px" }}>{sourceName}</span>
                          </td>

                          <td>
                            {evt.routed_to && evt.routed_to.length > 0 ? (
                              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                                {evt.routed_to.map((target) => (
                                  <span
                                    key={target}
                                    style={{
                                      fontSize: "11px",
                                      fontFamily: "monospace",
                                      padding: "1px 6px",
                                      borderRadius: "4px",
                                      background: "#ecfdf5",
                                      color: "#047857",
                                      border: "1px solid #a7f3d0",
                                    }}
                                  >
                                    {target}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                                {evt.status === "IGNORED" ? "Ignored (no sub)" : "None"}
                              </span>
                            )}
                          </td>

                          <td>
                            <StatusBadge status={evt.status} />
                          </td>

                          <td>
                            <div style={{ fontSize: "12px" }}>
                              {evt.attempt_count}
                              {evt.last_error && (
                                <span
                                  title={evt.last_error}
                                  style={{
                                    marginLeft: "4px",
                                    color: "var(--color-danger)",
                                    cursor: "help",
                                  }}
                                >
                                  ⚠
                                </span>
                              )}
                            </div>
                          </td>

                          <td style={{ fontSize: "12px", color: "var(--color-muted)", whiteSpace: "nowrap" }}>
                            {new Date(evt.created_at).toLocaleTimeString()}
                          </td>

                          <td>
                            <button
                              type="button"
                              className={`trace-code-btn ${
                                correlationIdFilter === evt.correlation_id ? "active" : ""
                              }`}
                              title="Click to filter by this trace correlation ID"
                              onClick={() => handleTraceCorrelation(evt.correlation_id)}
                            >
                              {evt.correlation_id.slice(0, 8)}...
                              <ICONS.search width={10} height={10} />
                            </button>
                          </td>

                          <td style={{ textAlign: "right" }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => handleInspect(evt)}
                              style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                            >
                              <ICONS.eye width={12} height={12} />
                              Inspect
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {inboxEvents.length > pageSize && (
              <div style={{ padding: "12px 20px", borderTop: "1px solid var(--color-border)" }}>
                <Pagination
                  pagination={{
                    current_page: eventPage,
                    total_pages: totalEventPages,
                    total_records: inboxEvents.length,
                    page_size: pageSize,
                    has_previous: eventPage > 1,
                    has_next: eventPage < totalEventPages,
                  }}
                  onPageChange={(p) => setEventPage(p)}
                />
              </div>
            )}
          </div>
        )}

        {/* TAB 3: DEAD LETTERS & REPLAY */}
        {activeTab === "dead_letters" && (
          <div style={{ padding: "24px" }}>
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "var(--radius)",
                padding: "14px 18px",
                marginBottom: "20px",
                display: "flex",
                alignItems: "flex-start",
                gap: "12px",
                fontSize: "13px",
                color: "#991b1b",
              }}
            >
              <ICONS.alertTriangle width={20} height={20} style={{ flexShrink: 0, marginTop: "2px" }} />
              <div>
                <strong>Dead-Letter Queue Operations:</strong> Events that have failed routing across 5 recorded attempts
                are dead-lettered to prevent infinite retry loops. Operators holding{" "}
                <code style={{ fontWeight: 700 }}>platform.system.manage</code> authorization can inspect the failure
                diagnostic and replay routing.
              </div>
            </div>

            {loading ? (
              <SkeletonTable rows={5} cols={5} />
            ) : deadLetters.length === 0 ? (
              <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--color-muted)" }}>
                <ICONS.check width={36} height={36} style={{ color: "#10b981", marginBottom: "8px" }} />
                <p style={{ margin: 0, fontWeight: 700, color: "var(--color-text)" }}>
                  No dead-lettered events in queue.
                </p>
                <span style={{ fontSize: "12px" }}>All cross-ERP integration pipelines are healthy.</span>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Event ID</th>
                      <th>Event Type</th>
                      <th>Source ERP</th>
                      <th>Attempts</th>
                      <th>Diagnostic / Last Error</th>
                      <th>Failed At</th>
                      <th style={{ textAlign: "right" }}>Operator Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deadLetters.map((dl) => {
                      const sourceName = resolveErpName(dl.source_erp_id);
                      return (
                        <tr key={dl.id}>
                          <td>
                            <button
                              type="button"
                              className="trace-code-btn"
                              title="Copy full Event ID"
                              onClick={() => handleCopy(dl.event_id, "Event ID")}
                            >
                              {dl.event_id.slice(0, 8)}...
                              <ICONS.copy width={10} height={10} />
                            </button>
                          </td>

                          <td>
                            <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#dc2626" }}>
                              {dl.event_type}
                            </span>
                          </td>

                          <td>
                            <strong>{sourceName}</strong>
                          </td>

                          <td>
                            <span className="badge badge-danger">{dl.attempt_count} attempts</span>
                          </td>

                          <td>
                            <div
                              style={{
                                fontSize: "12px",
                                fontFamily: "monospace",
                                maxWidth: "340px",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                color: "#991b1b",
                              }}
                              title={dl.last_error}
                            >
                              {dl.last_error}
                            </div>
                          </td>

                          <td style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                            {new Date(dl.failed_at).toLocaleString()}
                          </td>

                          <td style={{ textAlign: "right" }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => setReplayingDeadLetter(dl)}
                              disabled={!canManage}
                              title={!canManage ? "Requires platform.system.manage permission" : "Replay Event"}
                              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                            >
                              <ICONS.refresh width={12} height={12} />
                              Replay
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: ROUTING SUBSCRIPTIONS & OUTBOX */}
        {activeTab === "subscriptions" && (
          <div style={{ padding: "24px" }}>
            {/* Outbox Architecture Explanation */}
            <div
              style={{
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                padding: "16px 20px",
                marginBottom: "20px",
              }}
            >
              <h4 style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: 700 }}>
                Transactional Outbox & Capability Routing Model
              </h4>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
                Business ERPs (Yinglima & Inhyma) generate integration events within their local database transactions
                via <code style={{ fontWeight: 600 }}>integration_outbox_events</code> tables. Local workers poll and
                dispatch them to ERP_Main's ingestion endpoint. ERP_Main evaluates the subscriptions below to route
                events to matching target ERPs based on declared capabilities.
              </p>
            </div>

            {loading ? (
              <SkeletonTable rows={5} cols={5} />
            ) : subscriptions.length === 0 ? (
              <div style={{ padding: "32px", textAlign: "center", color: "var(--color-muted)" }}>
                No routing subscriptions configured in the control plane.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Event Type</th>
                      <th>Source ERP</th>
                      <th>Target Kind</th>
                      <th>Destination ERP</th>
                      <th>Required Capability</th>
                      <th>Status</th>
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptions.map((sub) => {
                      const sourceName = resolveErpName(sub.source_erp_id);
                      const targetName = sub.target_erp_id ? resolveErpName(sub.target_erp_id) : "Broadcast (All)";
                      return (
                        <tr key={sub.id}>
                          <td>
                            <span style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--color-primary)" }}>
                              {sub.event_type}
                            </span>
                          </td>

                          <td>
                            <strong>{sourceName}</strong>
                          </td>

                          <td>
                            <span
                              style={{
                                fontSize: "11px",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                background: sub.target_kind === "BROADCAST" ? "#fef3c7" : "#e0e7ff",
                                color: sub.target_kind === "BROADCAST" ? "#92400e" : "#3730a3",
                                fontWeight: 600,
                              }}
                            >
                              {sub.target_kind}
                            </span>
                          </td>

                          <td>{targetName}</td>

                          <td>
                            {sub.required_capability ? (
                              <span className="capability-pill">{sub.required_capability}</span>
                            ) : (
                              <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>None required</span>
                            )}
                          </td>

                          <td>
                            <StatusBadge status={sub.enabled ? "ACTIVE" : "INACTIVE"} />
                          </td>

                          <td style={{ textAlign: "right" }}>
                            <button
                              type="button"
                              className={`btn btn-sm ${sub.enabled ? "btn-secondary" : "btn-primary"}`}
                              onClick={() => setTogglingSub(sub)}
                              disabled={!canManage}
                              title={!canManage ? "Requires platform.system.manage permission" : "Toggle Subscription"}
                            >
                              {sub.enabled ? "Disable" : "Enable"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: RECONCILIATION & SYNCHRONIZATION */}
        {activeTab === "reconciliation" && (
          <div style={{ padding: "24px" }}>
            <div
              style={{
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: "var(--radius)",
                padding: "14px 18px",
                marginBottom: "20px",
                fontSize: "13px",
                color: "#166534",
                lineHeight: 1.5,
              }}
            >
              <strong>Data Boundary & Honest Reconciliation:</strong> ERP_Main does not directly query business ERP
              databases via cross-database connections. When a reconciliation pass is run, projection counts are compared
              against available external signals. If an external producer's outbox is unqueried, the status is
              reported honestly as <code style={{ fontWeight: 700 }}>UNKNOWN</code> rather than fabricating a matched
              count.
            </div>

            {loading ? (
              <SkeletonTable rows={4} cols={5} />
            ) : erps.length === 0 ? (
              <div style={{ padding: "32px", textAlign: "center", color: "var(--color-muted)" }}>
                No registered ERP instances found.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>ERP Instance</th>
                      <th>Buyer Projections</th>
                      <th>Source Outbox Count</th>
                      <th>Reconciliation Status</th>
                      <th>Last Signal</th>
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {erps.map((erp) => {
                      const recon = reconciliations[erp.id];
                      const eh = dashboard?.erp_health?.find((h) => h.erp_id === erp.id);
                      const isReconciling = reconcilingErpId === erp.id;

                      const status = recon ? recon.status : "UNKNOWN";
                      const projectionCount = recon ? recon.projection_count : eh?.buyer_projection_count ?? 0;
                      const outboxCount = recon?.outbox_published_count !== undefined && recon?.outbox_published_count !== null
                        ? recon.outbox_published_count
                        : "Unknown";

                      return (
                        <tr key={erp.id}>
                          <td>
                            <div style={{ fontWeight: 700 }}>{erp.name}</div>
                            <div style={{ fontSize: "11px", color: "var(--color-muted)", fontFamily: "monospace" }}>
                              {erp.erp_key}
                            </div>
                          </td>

                          <td>
                            <strong style={{ fontSize: "14px" }}>{projectionCount}</strong> records
                          </td>

                          <td>
                            {outboxCount === "Unknown" ? (
                              <span style={{ fontSize: "12px", color: "var(--color-muted)", fontStyle: "italic" }}>
                                Unknown (Unqueried)
                              </span>
                            ) : (
                              <strong>{outboxCount}</strong>
                            )}
                          </td>

                          <td>
                            <StatusBadge status={status} />
                          </td>

                          <td style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                            {eh?.last_seen_at ? new Date(eh.last_seen_at).toLocaleTimeString() : "No signal"}
                          </td>

                          <td style={{ textAlign: "right" }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => handleRunReconciliation(erp.id, erp.name)}
                              disabled={isReconciling || !canReconcile}
                              title={!canReconcile ? "Requires platform.reconciliation.execute permission" : "Reconcile"}
                              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                            >
                              <span style={{ display: "inline-flex", animation: isReconciling ? "spin 1s linear infinite" : "none" }}>
                                <ICONS.refresh width={12} height={12} />
                              </span>
                              {isReconciling ? "Reconciling..." : "Reconcile"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* EVENT DETAIL & SANITIZED PAYLOAD DRAWER */}
      <Modal
        open={Boolean(inspectingEvent)}
        onClose={() => setInspectingEvent(null)}
        title={
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontFamily: "monospace", fontWeight: 700 }}>
              {inspectingEvent?.event_type || "Event Details"}
            </span>
            {inspectingEvent && <StatusBadge status={inspectingEvent.status} />}
          </div>
        }
        variant="drawer"
        cardStyle={{ width: "620px" }}
      >
        {inspectingEvent && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Metadata Section */}
            <div
              style={{
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
                padding: "12px 14px",
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "10px",
                fontSize: "12px",
              }}
            >
              <div>
                <span style={{ color: "var(--color-muted)", display: "block" }}>Event ID:</span>
                <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{inspectingEvent.event_id}</span>
              </div>

              <div>
                <span style={{ color: "var(--color-muted)", display: "block" }}>Source ERP:</span>
                <span style={{ fontWeight: 600 }}>{resolveErpName(inspectingEvent.source_erp_id)}</span>
              </div>

              <div>
                <span style={{ color: "var(--color-muted)", display: "block" }}>Source Entity:</span>
                <span style={{ fontFamily: "monospace" }}>
                  {inspectingEvent.source_entity_type}: {inspectingEvent.source_entity_id}
                </span>
              </div>

              <div>
                <span style={{ color: "var(--color-muted)", display: "block" }}>Created At:</span>
                <span>{new Date(inspectingEvent.created_at).toLocaleString()}</span>
              </div>

              <div style={{ gridColumn: "span 2" }}>
                <span style={{ color: "var(--color-muted)", display: "block" }}>Correlation ID (Trace):</span>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
                  <code style={{ fontSize: "11px", fontWeight: 600 }}>{inspectingEvent.correlation_id}</code>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    style={{ fontSize: "10px", padding: "2px 6px" }}
                    onClick={() => handleTraceCorrelation(inspectingEvent.correlation_id)}
                  >
                    Trace in Directory
                  </button>
                </div>
              </div>

              {inspectingEvent.last_error && (
                <div style={{ gridColumn: "span 2", color: "var(--color-danger)" }}>
                  <span style={{ fontWeight: 700, display: "block" }}>Last Error:</span>
                  <div
                    style={{
                      fontFamily: "monospace",
                      background: "#fef2f2",
                      padding: "6px 8px",
                      borderRadius: "4px",
                      border: "1px solid #fecaca",
                      marginTop: "4px",
                      wordBreak: "break-word",
                    }}
                  >
                    {inspectingEvent.last_error}
                  </div>
                </div>
              )}
            </div>

            {/* Sanitized Payload Display */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "6px",
                }}
              >
                <span style={{ fontSize: "13px", fontWeight: 700 }}>Sanitized Payload</span>
                <span style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                  Sensitive keys (passwords, tokens, credentials) are redacted
                </span>
              </div>

              {inspectingPayloadLoading ? (
                <LoadingSpinner text="Retrieving sanitized payload..." />
              ) : (
                <div style={{ position: "relative" }}>
                  <pre className="json-preview" style={{ maxHeight: "360px", overflow: "auto" }}>
                    {inspectingEvent.payload
                      ? JSON.stringify(inspectingEvent.payload, null, 2)
                      : '{\n  "status": "Payload not stored or empty"\n}'}
                  </pre>
                  {inspectingEvent.payload && (
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => handleCopy(JSON.stringify(inspectingEvent.payload, null, 2), "Payload")}
                      style={{
                        position: "absolute",
                        top: "10px",
                        right: "10px",
                        fontSize: "11px",
                        padding: "3px 8px",
                        background: "rgba(30, 41, 59, 0.8)",
                        color: "#fff",
                        borderColor: "#475569",
                      }}
                    >
                      {copiedId === JSON.stringify(inspectingEvent.payload, null, 2) ? "Copied!" : "Copy JSON"}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setInspectingEvent(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* CONFIRM REPLAY MODAL */}
      <Modal
        open={Boolean(replayingDeadLetter)}
        onClose={() => setReplayingDeadLetter(null)}
        title="Replay Dead-Lettered Event?"
        variant="center"
        cardStyle={{ maxWidth: "480px" }}
      >
        {replayingDeadLetter && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
              This operation will reset the attempt budget for event{" "}
              <code style={{ fontWeight: 700 }}>{replayingDeadLetter.event_id}</code> (
              {replayingDeadLetter.event_type}) and re-attempt routing through configured subscriptions.
            </p>

            <div
              style={{
                fontSize: "12px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                color: "#991b1b",
              }}
            >
              <strong>Audit Notice:</strong> Replay actions are permanently recorded in the Global Audit Log with your
              operator principal identity.
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setReplayingDeadLetter(null)}
                disabled={replayingSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleReplayConfirm}
                disabled={replayingSubmitting}
              >
                {replayingSubmitting ? "Replaying..." : "Confirm Replay"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* CONFIRM TOGGLE SUBSCRIPTION MODAL */}
      <Modal
        open={Boolean(togglingSub)}
        onClose={() => setTogglingSub(null)}
        title={`${togglingSub?.enabled ? "Disable" : "Enable"} Routing Subscription?`}
        variant="center"
        cardStyle={{ maxWidth: "480px" }}
      >
        {togglingSub && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
              Are you sure you want to {togglingSub.enabled ? "disable" : "enable"} routing for{" "}
              <strong>{togglingSub.event_type}</strong> from{" "}
              <strong>{resolveErpName(togglingSub.source_erp_id)}</strong>?
            </p>

            {togglingSub.enabled && (
              <div
                style={{
                  fontSize: "12px",
                  background: "#fffbeb",
                  border: "1px solid #fef3c7",
                  padding: "8px 12px",
                  borderRadius: "var(--radius-sm)",
                  color: "#92400e",
                }}
              >
                When disabled, new incoming events of this type will be marked as <code>IGNORED</code> and will not be
                routed to target consumers.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setTogglingSub(null)}
                disabled={togglingSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${togglingSub.enabled ? "btn-danger" : "btn-primary"}`}
                onClick={handleToggleSubscriptionConfirm}
                disabled={togglingSubmitting}
              >
                {togglingSubmitting
                  ? "Updating..."
                  : togglingSub.enabled
                  ? "Disable Subscription"
                  : "Enable Subscription"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
