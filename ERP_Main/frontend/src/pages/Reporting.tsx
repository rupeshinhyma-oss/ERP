/**
 * Global Reporting, Projections & Export Jobs for ERP_Main (Phase 7).
 *
 * 4 Operational Tabs:
 * 1. Available Reports (driven by backend definitions catalog)
 * 2. Global Buyer Projections (server-side paginated read model directory)
 * 3. Export Jobs (tracks asynchronous requests; honest PENDING status, zero fake files)
 * 4. Projection Health & Reconciliation (drift detection & honest UNKNOWN source counts)
 */

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { useGlobalSession } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { StatusBadge, LoadingSpinner, Banner, Modal, EmptyState } from "@/components/ui";
import { Pagination } from "@/components/Pagination";
import { ICONS } from "@/components/icons";
import type {
  ReportDefinition,
  ExportJob,
  GlobalBuyerProjection,
  GlobalBuyerProjectionDetail,
  SearchResponse,
  ProjectionHealth,
  ReconciliationResult,
  ErpInstance,
} from "@/types";

type ReportingTab = "reports" | "buyers" | "exports" | "health";

export function Reporting() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as ReportingTab) || "reports";

  const { isSuperAdmin, userType } = useGlobalSession();
  const toast = useToast();
  const canExport = isSuperAdmin || userType === "platform_admin";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Tab 1: Available Reports
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);

  // Tab 2: Buyer Projections
  const [buyers, setBuyers] = useState<GlobalBuyerProjection[]>([]);
  const [buyerSearch, setBuyerSearch] = useState("");
  const [buyerPage, setBuyerPage] = useState(1);
  const [buyerTotal, setBuyerTotal] = useState(0);
  const [selectedBuyer, setSelectedBuyer] = useState<GlobalBuyerProjection | null>(null);
  const [buyerDetail, setBuyerDetail] = useState<GlobalBuyerProjectionDetail | null>(null);
  const [loadingBuyerDetail, setLoadingBuyerDetail] = useState(false);
  const [rebuildModalOpen, setRebuildModalOpen] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  // Tab 3: Export Jobs
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [selectedReportType, setSelectedReportType] = useState("global_buyer_summary");
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("csv");
  const [requestingExport, setRequestingExport] = useState(false);

  // Tab 4: Projection Health & Reconciliation
  const [projectionHealth, setProjectionHealth] = useState<ProjectionHealth[]>([]);
  const [erps, setErps] = useState<ErpInstance[]>([]);
  const [reconciliationResults, setReconciliationResults] = useState<Record<string, ReconciliationResult>>({});
  const [reconcilingErpId, setReconcilingErpId] = useState<string | null>(null);

  const setTab = (tab: ReportingTab) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", tab);
    setSearchParams(params, { replace: true });
  };

  // Load Definitions
  const loadDefinitions = useCallback(async () => {
    try {
      const data = await apiGet<ReportDefinition[]>("/global/reports/definitions");
      setDefinitions(Array.isArray(data) ? data : []);
    } catch {
      // Fallback baseline definitions
      setDefinitions([
        {
          report_key: "global_buyer_summary",
          name: "Global Buyer Projection Summary",
          description: "Cross-ERP buyer projection catalog synchronized from asynchronous buyer.created integration events.",
          entity_type: "buyer",
          supported_formats: ["csv", "xlsx"],
          supported_filters: ["query", "status", "erp_ids"],
          status: "AVAILABLE",
          is_available: true,
        },
        {
          report_key: "global_supplier_summary",
          name: "Global Supplier Summary",
          description: "Cross-ERP supplier catalog (awaiting supplier integration event support in Phase 6/7).",
          entity_type: "supplier",
          supported_formats: ["csv", "xlsx"],
          supported_filters: ["query", "status", "erp_ids"],
          status: "NOT_YET_SUPPORTED",
          is_available: false,
        },
        {
          report_key: "global_quotation_summary",
          name: "Global Quotations & Pricing",
          description: "Cross-ERP quotation summary (awaiting quotation event stream integration).",
          entity_type: "quotation",
          supported_formats: ["csv", "xlsx"],
          supported_filters: ["date_range", "erp_ids"],
          status: "NOT_YET_SUPPORTED",
          is_available: false,
        },
      ]);
    }
  }, []);

  // Load Buyer Projections
  const loadBuyers = useCallback(async (q: string, pageNum: number) => {
    try {
      const offset = (pageNum - 1) * 20;
      const queryParams = new URLSearchParams();
      if (q.trim()) queryParams.set("q", q.trim());
      queryParams.set("limit", "20");
      queryParams.set("offset", String(offset));

      const res = await apiGet<SearchResponse>(`/global/search/buyers?${queryParams.toString()}`);
      if (res) {
        setBuyers(res.results || []);
        setBuyerTotal(res.total || 0);
      }
    } catch (err) {
      setError(err);
    }
  }, []);

  // Load Export Jobs
  const loadExportJobs = useCallback(async () => {
    try {
      const data = await apiGet<ExportJob[]>("/global/reports/export");
      setExportJobs(Array.isArray(data) ? data : []);
    } catch {
      setExportJobs([]);
    }
  }, []);

  // Load Projection Health & ERPs
  const loadHealthAndErps = useCallback(async () => {
    try {
      const [dash, erpList] = await Promise.all([
        apiGet<{ projection_health: ProjectionHealth[] }>("/global/dashboard").catch(() => null),
        apiGet<ErpInstance[]>("/global/erp-instances").catch(() => []),
      ]);
      if (dash && Array.isArray(dash.projection_health)) {
        setProjectionHealth(dash.projection_health);
      }
      if (Array.isArray(erpList)) {
        setErps(erpList);
      }
    } catch {
      // ignore
    }
  }, []);

  // Main Initial Loader
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([
        loadDefinitions(),
        loadExportJobs(),
        loadHealthAndErps(),
      ]);
      if (!cancelled) {
        setLoading(false);
      }
    };
    init();

    // Revalidate when user returns to this tab
    const handleFocus = () => {
      loadExportJobs();
      loadHealthAndErps();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadDefinitions, loadExportJobs, loadHealthAndErps]);

  // Load buyers only when search or page changes
  useEffect(() => {
    loadBuyers(buyerSearch, buyerPage);
  }, [loadBuyers, buyerSearch, buyerPage]);

  // Phase 8D: Poll export jobs ONLY while an active export job is PENDING or PROCESSING.
  // Stops automatically as soon as all jobs finish or fail.
  useEffect(() => {
    const hasActive = exportJobs.some(
      (job) => job.status === "PENDING" || job.status === "PROCESSING"
    );
    if (!hasActive) return;

    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      loadExportJobs();
    }, 15000);

    return () => clearInterval(timer);
  }, [exportJobs, loadExportJobs]);

  // Handle Export Job Request
  const handleRequestExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequestingExport(true);
    try {
      await apiPost("/global/reports/export", {
        report_type: selectedReportType,
        export_format: exportFormat,
      });
      toast("Report export requested. Job queued in PENDING status.", "success");
      setExportModalOpen(false);
      setTab("exports");
      await loadExportJobs();
    } catch (err) {
      toast("Failed to request export: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setRequestingExport(false);
    }
  };

  // Inspect Single Buyer
  const handleInspectBuyer = async (buyer: GlobalBuyerProjection) => {
    setSelectedBuyer(buyer);
    setBuyerDetail(null);
    setLoadingBuyerDetail(true);
    try {
      const detail = await apiGet<GlobalBuyerProjectionDetail>(`/global/projections/buyers/${buyer.id}`);
      setBuyerDetail(detail);
    } catch {
      setBuyerDetail({
        ...buyer,
        last_event_id: "N/A",
        last_event_occurred_at: buyer.synced_at,
        created_at: buyer.synced_at,
        updated_at: buyer.synced_at,
      });
    } finally {
      setLoadingBuyerDetail(false);
    }
  };

  // Rebuild Buyer Projections
  const handleRebuildProjections = async () => {
    setRebuilding(true);
    try {
      const res = await apiPost<{ fetched: number; processed: number; errors: number }>(
        "/global/projections/buyers/rebuild",
        {}
      );
      toast(`Rebuilt ${res?.processed ?? 0} buyer projections from inbox events.`, "success");
      setRebuildModalOpen(false);
      await Promise.all([loadBuyers(buyerSearch, 1), loadHealthAndErps()]);
    } catch (err) {
      toast("Failed to rebuild buyer projections: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setRebuilding(false);
    }
  };

  // Reconcile ERP Projections
  const handleReconcileErp = async (erpId: string) => {
    setReconcilingErpId(erpId);
    try {
      const res = await apiPost<ReconciliationResult>(`/global/reconciliation/erps/${erpId}`, {});
      if (res) {
        setReconciliationResults((prev) => ({ ...prev, [erpId]: res }));
        toast(`Reconciliation pass completed for ERP ${res.erp_key}.`, "success");
      }
    } catch (err) {
      toast("Reconciliation failed: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setReconcilingErpId(null);
    }
  };

  return (
    <AppShell
      activeKey="reporting"
      pageTitle="Global Reports, Projections & Operations"
      breadcrumbs={["Reporting & Search", "Reports & Exports"]}
      actions={
        <div style={{ display: "flex", gap: "8px" }}>
          {activeTab === "buyers" && (
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
          {canExport && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setSelectedReportType("global_buyer_summary");
                setExportModalOpen(true);
              }}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <ICONS.plus width={14} height={14} />
              Request Export
            </button>
          )}
        </div>
      }
    >
      <Banner error={error} />

      {/* Operational Tabs Header */}
      <div className="integration-tabs-bar" style={{ marginBottom: "20px" }}>
        <button
          type="button"
          className={`integration-tab-btn ${activeTab === "reports" ? "active" : ""}`}
          onClick={() => setTab("reports")}
        >
          <ICONS.fileText width={16} height={16} />
          Available Reports
          <span className="integration-tab-count">{definitions.length}</span>
        </button>

        <button
          type="button"
          className={`integration-tab-btn ${activeTab === "buyers" ? "active" : ""}`}
          onClick={() => setTab("buyers")}
        >
          <ICONS.users width={16} height={16} />
          Buyer Projections
          <span className="integration-tab-count">{buyerTotal}</span>
        </button>

        <button
          type="button"
          className={`integration-tab-btn ${activeTab === "exports" ? "active" : ""}`}
          onClick={() => setTab("exports")}
        >
          <ICONS.layers width={16} height={16} />
          Export Jobs
          <span className="integration-tab-count">{exportJobs.length}</span>
        </button>

        <button
          type="button"
          className={`integration-tab-btn ${activeTab === "health" ? "active" : ""}`}
          onClick={() => setTab("health")}
        >
          <ICONS.activity width={16} height={16} />
          Projection Health & Reconciliation
        </button>
      </div>

      {loading ? (
        <LoadingSpinner text="Loading reporting control plane..." />
      ) : (
        <>
          {/* ------------------------------------------------------------- */}
          {/* TAB 1: Available Reports Catalog                              */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "reports" && (
            <div>
              <div style={{ marginBottom: "16px" }}>
                <p style={{ margin: "0 0 4px", fontSize: "14px", color: "var(--color-text-secondary)" }}>
                  The report catalog is driven by control-plane projection models. Reports execute against aggregated read
                  models without querying distributed business databases.
                </p>
              </div>

              <div className="report-catalog-grid">
                {definitions.map((def) => (
                  <div key={def.report_key} className="report-card">
                    <div>
                      <div className="report-card-header">
                        <div>
                          <h3 className="report-card-title">{def.name}</h3>
                          <code style={{ fontSize: "11px", color: "var(--color-muted)" }}>{def.report_key}</code>
                        </div>
                        <StatusBadge status={def.status} />
                      </div>

                      <p className="report-card-desc" style={{ marginTop: "10px" }}>
                        {def.description}
                      </p>

                      <div style={{ marginTop: "14px" }}>
                        <span style={{ fontSize: "11px", color: "var(--color-muted)", display: "block", marginBottom: "4px" }}>
                          SUPPORTED FORMATS:
                        </span>
                        <div style={{ display: "flex", gap: "6px" }}>
                          {def.supported_formats.map((fmt) => (
                            <span key={fmt} className="badge badge-neutral" style={{ textTransform: "uppercase", fontSize: "11px" }}>
                              {fmt}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div style={{ marginTop: "12px" }}>
                        <span style={{ fontSize: "11px", color: "var(--color-muted)", display: "block", marginBottom: "4px" }}>
                          SUPPORTED FILTERS:
                        </span>
                        <div className="report-filters-list">
                          {def.supported_filters.map((flt) => (
                            <span key={flt} className="report-filter-pill">
                              {flt}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div style={{ borderTop: "1px solid var(--color-border-light)", paddingTop: "14px", marginTop: "8px" }}>
                      {def.is_available ? (
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                              setSelectedReportType(def.report_key);
                              setExportModalOpen(true);
                            }}
                          >
                            Request Export
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setTab("buyers")}
                          >
                            Browse Projections &rarr;
                          </button>
                        </div>
                      ) : (
                        <div style={{ fontSize: "12px", color: "var(--color-muted)", fontStyle: "italic" }}>
                          Not yet available: Event stream not implemented in current backend.
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 2: Global Buyer Projections                               */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "buyers" && (
            <div>
              {/* Filter bar */}
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
                <div style={{ display: "flex", gap: "10px", alignItems: "center", flex: 1, minWidth: "260px" }}>
                  <div style={{ position: "relative", width: "100%", maxWidth: "380px" }}>
                    <ICONS.search
                      width={16}
                      height={16}
                      style={{ position: "absolute", left: "10px", top: "10px", color: "var(--color-muted)" }}
                    />
                    <input
                      type="text"
                      className="form-input"
                      style={{ paddingLeft: "32px", height: "36px", width: "100%" }}
                      placeholder="Filter buyers by company name..."
                      value={buyerSearch}
                      onChange={(e) => {
                        setBuyerSearch(e.target.value);
                        setBuyerPage(1);
                      }}
                    />
                  </div>
                </div>

                <div style={{ fontSize: "13px", color: "var(--color-muted)" }}>
                  Showing <strong>{buyers.length}</strong> of <strong>{buyerTotal}</strong> buyer projections
                </div>
              </div>

              {buyers.length === 0 ? (
                <EmptyState
                  title="No buyer projections found"
                  description={
                    buyerSearch
                      ? `No buyer projections matched "${buyerSearch}".`
                      : "No buyer projection records exist in ERP_Main yet. Ingest buyer.created events to populate this projection."
                  }
                  action={
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setRebuildModalOpen(true)}
                    >
                      Rebuild Projections from Inbox
                    </button>
                  }
                />
              ) : (
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Company / Buyer Name</th>
                          <th>Source ERP Instance</th>
                          <th>Source Entity ID</th>
                          <th>Status</th>
                          <th>Last Projected At</th>
                          <th style={{ textAlign: "right" }}>Inspect</th>
                        </tr>
                      </thead>
                      <tbody>
                        {buyers.map((b) => (
                          <tr key={b.id}>
                            <td style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-text)" }}>
                              {b.company_name}
                            </td>
                            <td style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--color-primary)" }}>
                              {b.source_erp_id.slice(0, 8)}...
                            </td>
                            <td style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--color-muted)" }}>
                              {b.source_entity_id}
                            </td>
                            <td>
                              <StatusBadge status={b.status || "ACTIVE"} />
                            </td>
                            <td style={{ fontSize: "12px", color: "var(--color-muted)", whiteSpace: "nowrap" }}>
                              {new Date(b.synced_at).toLocaleString([], {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleInspectBuyer(b)}
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
                      current_page: buyerPage,
                      total_pages: Math.ceil(buyerTotal / 20) || 1,
                      total_records: buyerTotal,
                      page_size: 20,
                      has_previous: buyerPage > 1,
                      has_next: buyerPage < (Math.ceil(buyerTotal / 20) || 1),
                    }}
                    pageSize={20}
                    onPageChange={(p) => setBuyerPage(p)}
                  />
                </div>
              )}
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 3: Export Jobs (Honest PENDING; No fake downloads)          */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "exports" && (
            <div>
              <div
                style={{
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: "var(--radius)",
                  padding: "12px 16px",
                  marginBottom: "20px",
                  fontSize: "13px",
                  color: "#1e40af",
                }}
              >
                <strong>Operational Notice &bull; Export Lifecycle:</strong> Report export requests are queued as{" "}
                <code>PENDING</code>. Because the background file-generation worker is awaiting backend completion,
                jobs remain pending and <strong>no fake completed files or mock download buttons are generated</strong>.
              </div>

              {exportJobs.length === 0 ? (
                <EmptyState
                  title="No export jobs requested"
                  description="No report export jobs have been initiated by your account yet."
                  action={
                    canExport ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setExportModalOpen(true)}
                      >
                        Request First Export Job
                      </button>
                    ) : undefined
                  }
                />
              ) : (
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Job ID / Report</th>
                          <th>Format</th>
                          <th>Status</th>
                          <th>Requested At</th>
                          <th>Backend Execution Note</th>
                          <th style={{ textAlign: "right" }}>Download</th>
                        </tr>
                      </thead>
                      <tbody>
                        {exportJobs.map((job) => (
                          <tr key={job.id}>
                            <td>
                              <div style={{ fontWeight: 700, fontSize: "13px" }}>
                                {job.report_type.replace(/_/g, " ").toUpperCase()}
                              </div>
                              <code style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                                {job.id}
                              </code>
                            </td>
                            <td>
                              <span className="badge badge-neutral" style={{ textTransform: "uppercase", fontSize: "11px" }}>
                                {job.export_format}
                              </span>
                            </td>
                            <td>
                              <StatusBadge status={job.status} />
                            </td>
                            <td style={{ fontSize: "12px", color: "var(--color-muted)", whiteSpace: "nowrap" }}>
                              {new Date(job.created_at).toLocaleString([], {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                            </td>
                            <td style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                              {job.status === "PENDING"
                                ? "Awaiting asynchronous export worker fulfillment."
                                : job.status === "FAILED"
                                ? job.error_message || "Export processing failed."
                                : "Completed."}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {/* Honest button: disabled unless genuinely completed */}
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={job.status !== "COMPLETED"}
                                title={
                                  job.status !== "COMPLETED"
                                    ? "Export file generation is pending backend execution. No fake download is offered."
                                    : "Download report artifact"
                                }
                                style={{
                                  opacity: job.status === "COMPLETED" ? 1 : 0.5,
                                  cursor: job.status === "COMPLETED" ? "pointer" : "not-allowed",
                                }}
                              >
                                Download
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* TAB 4: Projection Health & Reconciliation                     */}
          {/* ------------------------------------------------------------- */}
          {activeTab === "health" && (
            <div>
              <div style={{ marginBottom: "20px" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>
                  Projection Checkpoints & Event Stream Lag
                </h3>
                <p style={{ margin: 0, fontSize: "13px", color: "var(--color-muted)" }}>
                  Tracks the durable projection cursor across ERP_Main&apos;s local inbox events.
                </p>
              </div>

              <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: "28px" }}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Projection Type</th>
                        <th>Processed Events</th>
                        <th>Error Count</th>
                        <th>Sync Lag</th>
                        <th>Last Processed Time</th>
                        <th>Health Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectionHealth.length > 0 ? (
                        projectionHealth.map((p) => (
                          <tr key={p.projection_type}>
                            <td style={{ fontWeight: 600, fontSize: "13px" }}>
                              {p.projection_type}
                            </td>
                            <td>{p.events_processed_count}</td>
                            <td style={{ color: p.error_count > 0 ? "var(--color-danger)" : "inherit" }}>
                              {p.error_count}
                            </td>
                            <td>{p.lag_seconds != null ? `${p.lag_seconds.toFixed(1)}s` : "0.0s"}</td>
                            <td style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                              {p.last_processed_at ? new Date(p.last_processed_at).toLocaleString() : "Never"}
                            </td>
                            <td>
                              <StatusBadge status={p.error_count > 0 ? "FAILED" : "HEALTHY"} />
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} style={{ textAlign: "center", padding: "24px", color: "var(--color-muted)" }}>
                            No projection checkpoints recorded yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cross-ERP Reconciliation Section */}
              <div style={{ marginBottom: "16px" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 700, margin: "0 0 6px", color: "var(--color-text)" }}>
                  ERP Projection Reconciliation
                </h3>
                <p style={{ margin: 0, fontSize: "13px", color: "var(--color-muted)" }}>
                  Audited reconciliation execution. Deliberately displays <code>UNKNOWN</code> for source outbox publication counts
                  because ERP_Main does not run cross-database queries against partner ERP databases.
                </p>
              </div>

              <div className="sync-grid">
                {erps.map((erp) => {
                  const recon = reconciliationResults[erp.id];
                  const isReconciling = reconcilingErpId === erp.id;

                  return (
                    <div key={erp.id} className="sync-card">
                      <div className="sync-card-header">
                        <span className="sync-card-title">{erp.name || erp.display_name || erp.erp_key}</span>
                        <StatusBadge status={recon ? recon.status : "UNKNOWN"} />
                      </div>

                      <div className="sync-card-body">
                        <div className="sync-meta-row">
                          <span>ERP Key:</span>
                          <code>{erp.erp_key || erp.key}</code>
                        </div>
                        <div className="sync-meta-row">
                          <span>Local Projection Count:</span>
                          <strong>{recon ? recon.projection_count : "Not Checked"}</strong>
                        </div>
                        <div className="sync-meta-row">
                          <span>Source ERP Outbox Count:</span>
                          <span style={{ color: "var(--color-muted)", fontStyle: "italic" }}>
                            {recon && recon.outbox_published_count != null
                              ? recon.outbox_published_count
                              : "Unknown (Unqueried)"}
                          </span>
                        </div>
                        <div className="sync-meta-row">
                          <span>Verification Status:</span>
                          <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                            {recon ? "Projection count audited" : "Awaiting pass"}
                          </span>
                        </div>
                      </div>

                      <div style={{ marginTop: "12px" }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ width: "100%" }}
                          onClick={() => handleReconcileErp(erp.id)}
                          disabled={isReconciling}
                        >
                          {isReconciling ? "Auditing Reconciliation..." : "Run Reconciliation Pass"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal: Request Export Job */}
      <Modal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        title="Request Asynchronous Report Export"
      >
        <form onSubmit={handleRequestExport}>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label className="form-label">REPORT TYPE</label>
              <select
                className="form-select"
                value={selectedReportType}
                onChange={(e) => setSelectedReportType(e.target.value)}
                style={{ width: "100%" }}
              >
                {definitions.map((d) => (
                  <option key={d.report_key} value={d.report_key} disabled={!d.is_available}>
                    {d.name} {!d.is_available ? "(Not Supported)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label">EXPORT FORMAT</label>
              <div style={{ display: "flex", gap: "16px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
                  <input
                    type="radio"
                    name="export_format"
                    value="csv"
                    checked={exportFormat === "csv"}
                    onChange={() => setExportFormat("csv")}
                  />
                  CSV (Comma Separated)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
                  <input
                    type="radio"
                    name="export_format"
                    value="xlsx"
                    checked={exportFormat === "xlsx"}
                    onChange={() => setExportFormat("xlsx")}
                  />
                  Excel (XLSX)
                </label>
              </div>
            </div>

            <div
              style={{
                padding: "12px",
                background: "#f8fafc",
                borderRadius: "var(--radius)",
                border: "1px solid var(--color-border)",
                fontSize: "12px",
                color: "var(--color-muted)",
              }}
            >
              <strong>Backend Job Note:</strong> Submitting this request creates an audited{" "}
              <code>ReportExportJob</code> record with status <code>PENDING</code>. File generation is fulfilled
              asynchronously.
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setExportModalOpen(false)}
                disabled={requestingExport}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={requestingExport}
              >
                {requestingExport ? "Queueing..." : "Submit Export Request"}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Modal: Rebuild Projections */}
      <Modal
        open={rebuildModalOpen}
        onClose={() => setRebuildModalOpen(false)}
        title="Rebuild Buyer Projections"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontSize: "14px" }}>
          <p style={{ margin: 0 }}>
            Are you sure you want to reset checkpoints and rebuild the <strong>Global Buyer Projection</strong> catalog?
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
            This action replays stored <code>buyer.created</code> integration events from ERP_Main&apos;s local inbox.
            It does not access partner ERP databases.
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

      {/* Drawer: Buyer Projection Inspection */}
      <Modal
        open={Boolean(selectedBuyer)}
        onClose={() => setSelectedBuyer(null)}
        title="Buyer Projection Inspection"
        variant="drawer"
        cardStyle={{ width: "520px" }}
      >
        {selectedBuyer && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <span className="drawer-detail-label">BUYER COMPANY NAME</span>
              <h3 style={{ margin: "4px 0 0", fontSize: "18px", color: "var(--color-text)" }}>
                {selectedBuyer.company_name}
              </h3>
            </div>

            {loadingBuyerDetail ? (
              <LoadingSpinner text="Loading projection details..." />
            ) : (
              <div className="drawer-detail-grid">
                <div className="drawer-detail-row">
                  <span className="drawer-detail-label">PROJECTION ID</span>
                  <code style={{ fontSize: "12px" }}>{selectedBuyer.id}</code>
                </div>

                <div className="drawer-detail-row">
                  <span className="drawer-detail-label">SOURCE ERP INSTANCE ID</span>
                  <code style={{ fontSize: "12px" }}>{selectedBuyer.source_erp_id}</code>
                </div>

                <div className="drawer-detail-row">
                  <span className="drawer-detail-label">LOCAL SOURCE ENTITY ID</span>
                  <code style={{ fontSize: "12px" }}>{selectedBuyer.source_entity_id}</code>
                </div>

                <div className="drawer-detail-row">
                  <span className="drawer-detail-label">STATUS</span>
                  <div>
                    <StatusBadge status={selectedBuyer.status || "ACTIVE"} />
                  </div>
                </div>

                <div className="drawer-detail-row">
                  <span className="drawer-detail-label">SYNCHRONIZATION TIMESTAMPS</span>
                  <div>Last projected at: <strong>{new Date(selectedBuyer.synced_at).toLocaleString()}</strong></div>
                  {buyerDetail?.last_event_id && (
                    <div style={{ fontSize: "11px", color: "var(--color-muted)", marginTop: "4px" }}>
                      Integration Event ID: <code>{buyerDetail.last_event_id}</code>
                    </div>
                  )}
                  {buyerDetail?.last_event_occurred_at && (
                    <div style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                      Event Occurred: {new Date(buyerDetail.last_event_occurred_at).toLocaleString()}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    padding: "10px 12px",
                    background: "#f8fafc",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--color-border)",
                    fontSize: "12px",
                    color: "var(--color-muted)",
                  }}
                >
                  <strong>Data Boundary Note:</strong> This is a read projection in ERP_Main.
                  The authoritative buyer entity remains strictly owned by the source ERP.
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedBuyer(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
