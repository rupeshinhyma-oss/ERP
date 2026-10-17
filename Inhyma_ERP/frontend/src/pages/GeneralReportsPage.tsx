/**
 * General Reports Page.
 *
 * Consolidates organization-wide reports into the REPORTS section:
 * 1. Technical Call Log Report: all call / visit logs across technical tasks with filters and server-side pagination.
 * 2. Monthly Summary (Open vs Closed): month-by-month tasks raised vs completed with visual metrics and breakdown.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Pagination } from "@/components/Pagination";
import { errorMessage } from "@/lib/api";
import { fetchCallLogReport, fetchMonthlySummary } from "@/lib/technicalTasksApi";
import type { TechnicalCallLogReportRow, TechnicalMonthlySummary } from "@/types/technicalTasks";

const CALL_TYPES = [
  "Telecall",
  "Physical Visit",
  "Completion",
  "Cancellation",
  "Reopen / Reassign",
  "Approver Override",
  "Payment Collected",
];

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "#334155",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 38,
  borderRadius: 5,
  border: "1px solid #cbd5e1",
  padding: "0 10px",
  fontSize: 13.5,
  color: "#334155",
  background: "#fff",
  boxSizing: "border-box",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  fontSize: 12,
  textTransform: "uppercase",
  color: "#475569",
  background: "#f8fafc",
  borderBottom: "1px solid #e2e8f0",
  position: "sticky",
  top: 0,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  color: "#1e293b",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "top",
};

export function GeneralReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") || "call-logs";

  const handleTabChange = (tabKey: string) => {
    setSearchParams({ tab: tabKey });
  };

  // ---------------------------------------------------------------------------
  // Tab 1: Technical Call Logs State
  // ---------------------------------------------------------------------------
  const [rows, setRows] = useState<TechnicalCallLogReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [capped, setCapped] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [callType, setCallType] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const loadLogs = useCallback(async () => {
    setLoadingLogs(true);
    setLogsError(null);
    try {
      const res = await fetchCallLogReport({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        call_type: callType || undefined,
        created_by: createdBy.trim() || undefined,
        search: debouncedSearch || undefined,
        page,
        page_size: pageSize,
      });
      setRows(res.data || []);
      const meta = res.meta as any;
      setTotal(meta?.pagination?.total_records ?? meta?.total ?? (res.data || []).length);
      setCapped(Boolean(meta?.total_capped));
    } catch (err) {
      setLogsError(errorMessage(err));
    } finally {
      setLoadingLogs(false);
    }
  }, [dateFrom, dateTo, callType, createdBy, debouncedSearch, page, pageSize]);

  useEffect(() => {
    if (currentTab === "call-logs") {
      void loadLogs();
    }
  }, [currentTab, loadLogs]);

  const resetFilters = () => {
    setDateFrom("");
    setDateTo("");
    setCallType("");
    setCreatedBy("");
    setSearch("");
    setPage(1);
  };
  const totalPages = Math.ceil(total / pageSize) || 1;

  // ---------------------------------------------------------------------------
  // Tab 2: Monthly Summary State
  // ---------------------------------------------------------------------------
  const [summaryMonths, setSummaryMonths] = useState(12);
  const [summaryData, setSummaryData] = useState<TechnicalMonthlySummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    setSummaryError(null);
    try {
      const data = await fetchMonthlySummary(summaryMonths);
      setSummaryData(data);
    } catch (err) {
      setSummaryError(errorMessage(err));
    } finally {
      setLoadingSummary(false);
    }
  }, [summaryMonths]);

  useEffect(() => {
    if (currentTab === "monthly-summary") {
      void loadSummary();
    }
  }, [currentTab, loadSummary]);

  const maxChartValue = useMemo(() => {
    return Math.max(1, ...(summaryData?.months || []).map((m) => Math.max(m.created, m.completed)));
  }, [summaryData]);

  const totalRaisedInPeriod = useMemo(() => {
    return (summaryData?.months || []).reduce((acc, m) => acc + m.created, 0);
  }, [summaryData]);

  const totalCompletedInPeriod = useMemo(() => {
    return (summaryData?.months || []).reduce((acc, m) => acc + m.completed, 0);
  }, [summaryData]);

  return (
    <AppShell activeKey="reports-general">
      <main className="page" style={{ padding: "20px 24px" }}>
        <Breadcrumb trail={["Reports", "General Reports"]} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 0 20px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#1e293b" }}>General Reports</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "#64748b" }}>
              Consolidated operational reports, technical call logs, and monthly lifecycle summaries.
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div
          role="tablist"
          style={{
            display: "flex",
            gap: "8px",
            borderBottom: "2px solid #e2e8f0",
            marginBottom: "20px",
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === "call-logs"}
            data-testid="tab-call-logs"
            onClick={() => handleTabChange("call-logs")}
            style={{
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 600,
              background: "none",
              border: "none",
              borderBottom: currentTab === "call-logs" ? "2px solid #0061f2" : "2px solid transparent",
              marginBottom: "-2px",
              color: currentTab === "call-logs" ? "#0061f2" : "#64748b",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              transition: "all 0.15s ease",
            }}
          >
            <span>📋</span>
            <span>Technical Call Log Report</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={currentTab === "monthly-summary"}
            data-testid="tab-monthly-summary"
            onClick={() => handleTabChange("monthly-summary")}
            style={{
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 600,
              background: "none",
              border: "none",
              borderBottom: currentTab === "monthly-summary" ? "2px solid #0061f2" : "2px solid transparent",
              marginBottom: "-2px",
              color: currentTab === "monthly-summary" ? "#0061f2" : "#64748b",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              transition: "all 0.15s ease",
            }}
          >
            <span>📊</span>
            <span>Open vs Closed Monthly Summary</span>
          </button>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Tab 1: Technical Call Log Report */}
        {/* ---------------------------------------------------------------- */}
        {currentTab === "call-logs" && (
          <div data-testid="section-call-logs">
            <div
              style={{
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "16px 20px",
                marginBottom: 16,
                boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                  gap: "14px 18px",
                }}
              >
                <div>
                  <label style={labelStyle}>Call Date From</label>
                  <input
                    type="date"
                    aria-label="Call date from"
                    style={inputStyle}
                    value={dateFrom}
                    max={dateTo || undefined}
                    onChange={(e) => {
                      setDateFrom(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Call Date To</label>
                  <input
                    type="date"
                    aria-label="Call date to"
                    style={inputStyle}
                    value={dateTo}
                    min={dateFrom || undefined}
                    onChange={(e) => {
                      setDateTo(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Call Type</label>
                  <select
                    style={inputStyle}
                    value={callType}
                    onChange={(e) => {
                      setCallType(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All Call Types</option>
                    {CALL_TYPES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Logged By</label>
                  <input
                    type="text"
                    style={inputStyle}
                    placeholder="Exact user / technician name"
                    value={createdBy}
                    onChange={(e) => {
                      setCreatedBy(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Search</label>
                  <input
                    type="text"
                    style={inputStyle}
                    placeholder="Company, machine, contact, serial..."
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button
                    type="button"
                    onClick={resetFilters}
                    style={{
                      background: "#5c6f84",
                      color: "#fff",
                      border: "none",
                      borderRadius: 5,
                      height: 38,
                      padding: "0 18px",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    Reset Filters
                  </button>
                </div>
              </div>
            </div>

            {logsError && (
              <div
                role="alert"
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  color: "#991b1b",
                  padding: "10px 14px",
                  borderRadius: 6,
                  marginBottom: 12,
                }}
              >
                {logsError}{" "}
                <button
                  type="button"
                  onClick={() => void loadLogs()}
                  style={{ marginLeft: 8, cursor: "pointer", fontWeight: 600 }}
                >
                  Retry
                </button>
              </div>
            )}

            <div className="card" style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }}>
              <div style={{ overflow: "auto", maxHeight: "calc(100vh - 380px)" }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      {[
                        "Call Date",
                        "Company",
                        "City",
                        "Machine & Model",
                        "Contact Person",
                        "Call Type",
                        "Remarks / Feedback",
                        "Logged By",
                        "Task Status",
                        "Technician",
                      ].map((h) => (
                        <th key={h} style={thStyle}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loadingLogs && rows.length === 0 && (
                      <tr>
                        <td colSpan={10} style={{ ...tdStyle, color: "#64748b", textAlign: "center", padding: 32 }}>
                          Loading call logs...
                        </td>
                      </tr>
                    )}
                    {!loadingLogs && rows.length === 0 && !logsError && (
                      <tr>
                        <td colSpan={10} style={{ ...tdStyle, color: "#64748b", textAlign: "center", padding: 32 }}>
                          No call logs found for the selected filters.
                        </td>
                      </tr>
                    )}
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{r.call_date}</td>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{r.company_name}</td>
                        <td style={tdStyle}>{r.city}</td>
                        <td style={tdStyle}>{r.machine_model}</td>
                        <td style={tdStyle}>
                          {r.contact_person_name || "—"}
                          {r.contact_phone ? <div style={{ color: "#64748b", fontSize: 12 }}>{r.contact_phone}</div> : null}
                        </td>
                        <td style={tdStyle}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 600,
                              background:
                                r.call_type === "Physical Visit"
                                  ? "#e0e7ff"
                                  : r.call_type === "Payment Collected"
                                  ? "#dcfce7"
                                  : r.call_type === "Cancellation"
                                  ? "#fee2e2"
                                  : "#f1f5f9",
                              color:
                                r.call_type === "Physical Visit"
                                  ? "#3730a3"
                                  : r.call_type === "Payment Collected"
                                  ? "#166534"
                                  : r.call_type === "Cancellation"
                                  ? "#991b1b"
                                  : "#334155",
                            }}
                          >
                            {r.call_type}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, minWidth: 260, whiteSpace: "pre-wrap" }}>{r.remarks}</td>
                        <td style={tdStyle}>{r.created_by}</td>
                        <td style={tdStyle}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 600,
                              background:
                                r.task_status === "Completed"
                                  ? "#dcfce7"
                                  : r.task_status === "Approved"
                                  ? "#dbeafe"
                                  : r.task_status === "Pending"
                                  ? "#fef3c7"
                                  : "#fee2e2",
                              color:
                                r.task_status === "Completed"
                                  ? "#166534"
                                  : r.task_status === "Approved"
                                  ? "#1e40af"
                                  : r.task_status === "Pending"
                                  ? "#92400e"
                                  : "#991b1b",
                            }}
                          >
                            {r.task_status}
                          </span>
                        </td>
                        <td style={tdStyle}>{r.task_allotted_to || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {capped && (
                <div style={{ padding: "6px 16px", fontSize: 12, color: "#92400e", background: "#fffbeb" }}>
                  More than {total.toLocaleString()} logs match - narrow the date range or filters to see the rest.
                </div>
              )}
              <div style={{ padding: "8px 16px", borderTop: "1px solid #e2e8f0" }}>
                <Pagination
                  pagination={{
                    current_page: page,
                    page_size: pageSize,
                    total_records: total,
                    total_pages: totalPages,
                    has_previous: page > 1,
                    has_next: page < totalPages,
                  }}
                  pageSize={pageSize}
                  onPageChange={(p) => setPage(p)}
                  onPageSizeChange={(sz) => {
                    setPageSize(sz);
                    setPage(1);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Tab 2: Monthly Summary (Open vs Closed) */}
        {/* ---------------------------------------------------------------- */}
        {currentTab === "monthly-summary" && (
          <div data-testid="section-monthly-summary">
            {/* Top Metrics Cards */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "16px",
                marginBottom: "20px",
              }}
            >
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "16px 20px",
                  borderLeft: "4px solid #f59e0b",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                  Open Tasks (Current)
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#f59e0b", marginTop: 4 }}>
                  {summaryData ? summaryData.open_now.toLocaleString() : "—"}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                  Pending, Approved & Payment Pending
                </div>
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "16px 20px",
                  borderLeft: "4px solid #16a34a",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                  Closed Tasks (Current)
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#16a34a", marginTop: 4 }}>
                  {summaryData ? summaryData.closed_now.toLocaleString() : "—"}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                  Completed & Cancelled
                </div>
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "16px 20px",
                  borderLeft: "4px solid #3b82f6",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                  Tasks Raised in Period
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#3b82f6", marginTop: 4 }}>
                  {summaryData ? totalRaisedInPeriod.toLocaleString() : "—"}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                  Last {summaryMonths} months total
                </div>
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "16px 20px",
                  borderLeft: "4px solid #059669",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                  Tasks Completed in Period
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#059669", marginTop: 4 }}>
                  {summaryData ? totalCompletedInPeriod.toLocaleString() : "—"}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                  Last {summaryMonths} months total
                </div>
              </div>
            </div>

            {/* Visual Bar Chart */}
            <div
              data-testid="technical-monthly-summary"
              style={{
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "20px 24px",
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1e293b" }}>
                    Monthly Tasks Comparison (Raised vs Completed)
                  </h3>
                  <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 4 }}>
                    Hover over bars to inspect numbers for each month.
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <select
                    aria-label="Months"
                    value={summaryMonths}
                    onChange={(e) => setSummaryMonths(Number(e.target.value))}
                    style={{
                      height: 34,
                      borderRadius: 5,
                      border: "1px solid #cbd5e1",
                      padding: "0 10px",
                      fontSize: 13,
                      color: "#334155",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    {[6, 12, 24, 36].map((m) => (
                      <option key={m} value={m}>
                        Last {m} months
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {summaryError && (
                <div role="alert" style={{ color: "#991b1b", fontSize: 13, padding: "8px 0" }}>
                  {summaryError}
                </div>
              )}
              {loadingSummary && !summaryData && (
                <div style={{ color: "#64748b", fontSize: 13, padding: "30px 0", textAlign: "center" }}>
                  Loading monthly summary...
                </div>
              )}

              {summaryData && (
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-end",
                    overflowX: "auto",
                    padding: "20px 0 10px",
                    borderBottom: "1px solid #f1f5f9",
                  }}
                >
                  {summaryData.months.map((m) => (
                    <div key={m.month} style={{ minWidth: 54, textAlign: "center" }}>
                      <div
                        style={{
                          height: 150,
                          display: "flex",
                          gap: 4,
                          alignItems: "flex-end",
                          justifyContent: "center",
                          padding: "0 4px",
                        }}
                      >
                        <div
                          title={`Month: ${m.month} | Raised: ${m.created}`}
                          style={{
                            width: 18,
                            height: `${(m.created / maxChartValue) * 100}%`,
                            minHeight: m.created ? 3 : 0,
                            background: "#3b82f6",
                            borderRadius: "4px 4px 0 0",
                            transition: "height 0.2s ease",
                          }}
                        />
                        <div
                          title={`Month: ${m.month} | Completed: ${m.completed}`}
                          style={{
                            width: 18,
                            height: `${(m.completed / maxChartValue) * 100}%`,
                            minHeight: m.completed ? 3 : 0,
                            background: "#16a34a",
                            borderRadius: "4px 4px 0 0",
                            transition: "height 0.2s ease",
                          }}
                        />
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginTop: 8 }}>
                        {m.month}
                      </div>
                      <div style={{ fontSize: 11, color: "#1e293b", marginTop: 2 }}>
                        <span style={{ color: "#2563eb", fontWeight: 600 }}>{m.created}</span> /{" "}
                        <span style={{ color: "#16a34a", fontWeight: 600 }}>{m.completed}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  gap: 16,
                  alignItems: "center",
                  fontSize: 12,
                  color: "#64748b",
                  marginTop: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ display: "inline-block", width: 12, height: 12, background: "#3b82f6", borderRadius: 2 }} />
                  <span>Tasks Raised</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ display: "inline-block", width: 12, height: 12, background: "#16a34a", borderRadius: 2 }} />
                  <span>Tasks Completed</span>
                </div>
              </div>
            </div>

            {/* Monthly Breakdown Table */}
            {summaryData && summaryData.months.length > 0 && (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "16px 20px",
                }}
              >
                <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#1e293b" }}>
                  Detailed Month-by-Month Breakdown
                </h3>
                <div style={{ overflow: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        {["Month", "Tasks Raised", "Tasks Completed", "Net Completion Difference"].map((h) => (
                          <th key={h} style={thStyle}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {summaryData.months.map((m) => {
                        const diff = m.completed - m.created;
                        return (
                          <tr key={m.month}>
                            <td style={{ ...tdStyle, fontWeight: 600 }}>{m.month}</td>
                            <td style={{ ...tdStyle, color: "#2563eb", fontWeight: 600 }}>{m.created}</td>
                            <td style={{ ...tdStyle, color: "#16a34a", fontWeight: 600 }}>{m.completed}</td>
                            <td style={tdStyle}>
                              <span
                                style={{
                                  fontWeight: 600,
                                  color: diff > 0 ? "#16a34a" : diff < 0 ? "#ea580c" : "#64748b",
                                }}
                              >
                                {diff > 0 ? `+${diff} (Backlog cleared)` : diff < 0 ? `${diff} (Open increased)` : "0 (Balanced)"}
                              </span>
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
      </main>
    </AppShell>
  );
}

export default GeneralReportsPage;
