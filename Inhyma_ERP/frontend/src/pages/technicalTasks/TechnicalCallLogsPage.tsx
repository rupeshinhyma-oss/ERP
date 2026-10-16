/**
 * Technical Call Log Report.
 *
 * Workflow doc: "Technical Call log report to provide separate, not under call log form (to keep similar like
 * followup / lead call log)". Lists every call / visit log across all technical tasks with the task's details,
 * newest first. Server-side filtered and paginated (works at millions of logs: capped total, indexed filters).
 */
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Pagination } from "@/components/Pagination";
import { errorMessage } from "@/lib/api";
import { fetchCallLogReport } from "@/lib/technicalTasksApi";
import type { TechnicalCallLogReportRow } from "@/types/technicalTasks";

const CALL_TYPES = ["Telecall", "Physical Visit", "Completion", "Cancellation", "Reopen / Reassign", "Approver Override", "Payment Collected"];

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 6 };
const inputStyle: React.CSSProperties = {
  width: "100%", height: 38, borderRadius: 5, border: "1px solid #cbd5e1", padding: "0 10px",
  fontSize: 13.5, color: "#334155", background: "#fff", boxSizing: "border-box",
};
const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "10px 12px", fontSize: 12, textTransform: "uppercase", color: "#475569",
  background: "#f8fafc", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, whiteSpace: "nowrap",
};
const tdStyle: React.CSSProperties = { padding: "10px 12px", fontSize: 13, color: "#1e293b", borderBottom: "1px solid #f1f5f9", verticalAlign: "top" };

export function TechnicalCallLogsPage() {
  const [rows, setRows] = useState<TechnicalCallLogReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [capped, setCapped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
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
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, callType, createdBy, debouncedSearch, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetFilters = () => {
    setDateFrom(""); setDateTo(""); setCallType(""); setCreatedBy(""); setSearch(""); setPage(1);
  };
  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <AppShell activeKey="technical-call-logs">
      <main className="page">
        <div className="page-header">
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1e293b" }}>Technical Call Log Report</h1>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "16px 20px", marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "14px 18px" }}>
            <div>
              <label style={labelStyle}>Call Date From</label>
              <input type="date" aria-label="Call date from" style={inputStyle} value={dateFrom} max={dateTo || undefined}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
            </div>
            <div>
              <label style={labelStyle}>Call Date To</label>
              <input type="date" aria-label="Call date to" style={inputStyle} value={dateTo} min={dateFrom || undefined}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
            </div>
            <div>
              <label style={labelStyle}>Call Type</label>
              <select style={inputStyle} value={callType} onChange={(e) => { setCallType(e.target.value); setPage(1); }}>
                <option value="">All</option>
                {CALL_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Logged By</label>
              <input type="text" style={inputStyle} placeholder="Exact user / technician name" value={createdBy}
                onChange={(e) => { setCreatedBy(e.target.value); setPage(1); }} />
            </div>
            <div>
              <label style={labelStyle}>Search (company, machine, contact, serial)</label>
              <input type="text" style={inputStyle} placeholder="Search..." value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button type="button" onClick={resetFilters}
                style={{ background: "#5c6f84", color: "#fff", border: "none", borderRadius: 5, height: 38, padding: "0 18px", cursor: "pointer" }}>
                Reset
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div role="alert" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "10px 14px", borderRadius: 6, marginBottom: 12 }}>
            {error}{" "}
            <button type="button" onClick={() => void load()} style={{ marginLeft: 8, cursor: "pointer" }}>Retry</button>
          </div>
        )}

        <div className="card">
          <div style={{ overflow: "auto", maxHeight: "calc(100vh - 360px)" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  {["Call Date", "Company", "City", "Machine & Model", "Contact Person", "Call Type", "Remarks / Feedback", "Logged By", "Task Status", "Technician"].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 && (
                  <tr><td colSpan={10} style={{ ...tdStyle, color: "#64748b" }}>Loading call logs...</td></tr>
                )}
                {!loading && rows.length === 0 && !error && (
                  <tr><td colSpan={10} style={{ ...tdStyle, color: "#64748b", padding: 32 }}>No call logs found for the selected filters.</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{r.call_date}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{r.company_name}</td>
                    <td style={tdStyle}>{r.city}</td>
                    <td style={tdStyle}>{r.machine_model}</td>
                    <td style={tdStyle}>
                      {r.contact_person_name || "—"}
                      {r.contact_phone ? <div style={{ color: "#64748b" }}>{r.contact_phone}</div> : null}
                    </td>
                    <td style={tdStyle}>{r.call_type}</td>
                    <td style={{ ...tdStyle, minWidth: 260, whiteSpace: "pre-wrap" }}>{r.remarks}</td>
                    <td style={tdStyle}>{r.created_by}</td>
                    <td style={tdStyle}>{r.task_status}</td>
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
                current_page: page, page_size: pageSize, total_records: total, total_pages: totalPages,
                has_previous: page > 1, has_next: page < totalPages,
              }}
              pageSize={pageSize}
              onPageChange={(p) => setPage(p)}
              onPageSizeChange={(sz) => { setPageSize(sz); setPage(1); }}
            />
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export default TechnicalCallLogsPage;
