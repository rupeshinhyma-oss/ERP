/**
 * Technical Task Types master.
 *
 * Workflow doc: Task Type must be a dropdown that can be maintained in Masters (technicians log calls based on
 * it). Backed by the option-lists API (group "technical_task.task_type"), which the Technical Task form reads.
 */
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { apiDelete, apiGet, apiPost, apiPut, errorMessage } from "@/lib/api";
import { invalidateOptionsCache } from "@/lib/options";

const GROUP = "technical_task.task_type";

interface OptionRow {
  id: string;
  value: string;
  label: string;
  sort_order: number;
  status: "active" | "inactive";
}

const inputStyle: React.CSSProperties = { height: 36, borderRadius: 5, border: "1px solid #cbd5e1", padding: "0 10px", fontSize: 13.5, boxSizing: "border-box" };
const btn = (bg: string): React.CSSProperties => ({ background: bg, color: "#fff", border: "none", borderRadius: 5, height: 34, padding: "0 14px", cursor: "pointer", fontSize: 13 });

export function TechnicalTaskTypesPage() {
  const [rows, setRows] = useState<OptionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newValue, setNewValue] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<OptionRow[]>(`/masters/options?group_key=${encodeURIComponent(GROUP)}`);
      setRows((res.data || []).slice().sort((a, b) => a.sort_order - b.sort_order || a.value.localeCompare(b.value)));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      invalidateOptionsCache(GROUP);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const add = () => {
    const value = newValue.trim();
    if (!value) { setError("Enter a task type name."); return; }
    if (rows.some((r) => r.value.toLowerCase() === value.toLowerCase())) { setError("This task type already exists."); return; }
    void run(async () => {
      await apiPost("/masters/options", { group_key: GROUP, value, label: value, sort_order: (rows[rows.length - 1]?.sort_order ?? 0) + 1 });
      setNewValue("");
    });
  };

  const saveEdit = (row: OptionRow) => {
    const value = editValue.trim();
    if (!value) { setError("Task type name cannot be empty."); return; }
    void run(async () => {
      await apiPut(`/masters/options/${row.id}`, { value, label: value });
      setEditId(null);
    });
  };

  return (
    <AppShell activeKey="masters-technical-task-types">
      <main className="page">
        <div className="page-header">
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1e293b" }}>Technical Task Types</h1>
        </div>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>
          These values appear in the Task Type dropdown of the Technical Task form and filters. Names containing "Onsite" show
          the visit-date field; names containing "Third-Party" ask for the third-party city and contact.
        </div>
        {error && <div role="alert" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "10px 14px", borderRadius: 6, marginBottom: 12 }}>{error}</div>}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <input style={{ ...inputStyle, flex: 1, maxWidth: 380 }} placeholder="New task type, e.g. Remote Support"
              value={newValue} onChange={(e) => setNewValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
            <button type="button" style={btn("#0061f2")} onClick={add}>+ Add</button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Task Type", "Status", "Actions"].map((h) => <th key={h} style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, textTransform: "uppercase", color: "#475569", borderBottom: "1px solid #e2e8f0" }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && <tr><td colSpan={3} style={{ padding: 12, color: "#64748b" }}>Loading...</td></tr>}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>
                    {editId === r.id
                      ? <input style={{ ...inputStyle, width: "100%", maxWidth: 380 }} value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus />
                      : r.label || r.value}
                  </td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.status === "active" ? "Active" : "Inactive"}</td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9", display: "flex", gap: 8 }}>
                    {editId === r.id ? (
                      <>
                        <button type="button" style={btn("#16a34a")} onClick={() => saveEdit(r)}>Save</button>
                        <button type="button" style={btn("#64748b")} onClick={() => setEditId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button type="button" style={btn("#334155")} onClick={() => { setEditId(r.id); setEditValue(r.value); }}>Rename</button>
                        <button type="button" style={btn(r.status === "active" ? "#ea580c" : "#16a34a")}
                          onClick={() => void run(() => apiPut(`/masters/options/${r.id}`, { status: r.status === "active" ? "inactive" : "active" }))}>
                          {r.status === "active" ? "Deactivate" : "Activate"}
                        </button>
                        <button type="button" style={btn("#dc2626")}
                          onClick={() => { if (window.confirm(`Delete task type "${r.value}"? Existing tasks keep their value.`)) void run(() => apiDelete(`/masters/options/${r.id}`)); }}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </AppShell>
  );
}

export default TechnicalTaskTypesPage;
