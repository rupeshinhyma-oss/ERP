/**
 * Technical module dashboard card: "Open vs Closed monthwise" (Dashboard workflow doc, item 11).
 * Per month: tasks raised vs tasks completed, plus how many are open / closed right now.
 */
import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/api";
import { fetchMonthlySummary } from "@/lib/technicalTasksApi";
import type { TechnicalMonthlySummary } from "@/types/technicalTasks";

export function TechnicalTaskMonthlySummary() {
  const [months, setMonths] = useState(12);
  const [data, setData] = useState<TechnicalMonthlySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchMonthlySummary(months)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(errorMessage(e)); });
    return () => { cancelled = true; };
  }, [months]);

  const max = Math.max(1, ...(data?.months || []).map((m) => Math.max(m.created, m.completed)));
  const chip = (label: string, value: number, color: string) => (
    <span style={{ background: color, color: "#fff", borderRadius: 14, padding: "3px 12px", fontSize: 12.5, fontWeight: 600 }}>
      {label}: {value.toLocaleString()}
    </span>
  );

  return (
    <div data-testid="technical-monthly-summary" style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 18px", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <div style={{ fontWeight: 700, color: "#1e293b" }}>Open vs Closed - Month-wise</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {data && chip("Open now", data.open_now, "#f59e0b")}
          {data && chip("Closed", data.closed_now, "#16a34a")}
          <select aria-label="Months" value={months} onChange={(e) => setMonths(Number(e.target.value))}
            style={{ height: 30, borderRadius: 5, border: "1px solid #cbd5e1" }}>
            {[6, 12, 24].map((m) => <option key={m} value={m}>Last {m} months</option>)}
          </select>
        </div>
      </div>
      {error && <div role="alert" style={{ color: "#991b1b", fontSize: 13 }}>{error}</div>}
      {!data && !error && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", overflowX: "auto", paddingBottom: 4, height: 140 }} aria-hidden="true">
          {[45, 75, 60, 90, 40, 70, 85, 55, 65, 80, 50, 75].slice(0, months).map((h, i) => (
            <div key={i} style={{ minWidth: 46, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ height: 110, display: "flex", gap: 3, alignItems: "flex-end", justifyContent: "center" }}>
                <span className="skeleton-box" style={{ width: 16, height: `${h}%`, borderRadius: "3px 3px 0 0" }} />
                <span className="skeleton-box" style={{ width: 16, height: `${Math.round(h * 0.7)}%`, borderRadius: "3px 3px 0 0" }} />
              </div>
              <span className="skeleton-line" style={{ width: 32, height: 10 }} />
              <span className="skeleton-line" style={{ width: 24, height: 10 }} />
            </div>
          ))}
        </div>
      )}
      {data && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", overflowX: "auto", paddingBottom: 4 }}>
          {data.months.map((m) => (
            <div key={m.month} style={{ minWidth: 46, textAlign: "center" }}>
              <div style={{ height: 110, display: "flex", gap: 3, alignItems: "flex-end", justifyContent: "center" }}>
                <div title={`Raised: ${m.created}`} style={{ width: 16, height: `${(m.created / max) * 100}%`, minHeight: m.created ? 2 : 0, background: "#3b82f6", borderRadius: "3px 3px 0 0" }} />
                <div title={`Completed: ${m.completed}`} style={{ width: 16, height: `${(m.completed / max) * 100}%`, minHeight: m.completed ? 2 : 0, background: "#16a34a", borderRadius: "3px 3px 0 0" }} />
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{m.month.slice(2)}</div>
              <div style={{ fontSize: 11, color: "#1e293b" }}>{m.created}/{m.completed}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 6 }}>
        <span style={{ color: "#3b82f6" }}>■</span> Raised &nbsp; <span style={{ color: "#16a34a" }}>■</span> Completed (raised/completed under each month)
      </div>
    </div>
  );
}

export default TechnicalTaskMonthlySummary;
