/**
 * ERP Runtime Instances View.
 *
 * Displays deployment/runtime instances separately across environments,
 * application versions, health status, and last seen / heartbeat timestamps.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { SectionNavTabs } from "@/components/SectionNavTabs";
import { StatusBadge, SkeletonTable } from "@/components/ui";
import { ICONS } from "@/components/icons";
import type { ErpInstance } from "@/types";

const ERP_TABS = [
  { key: "switcher", label: "ERP Switcher", path: "/erps/switcher", icon: "layers" as const },
  { key: "registry", label: "ERP Registry", path: "/erps/registry", icon: "server" as const },
  { key: "instances", label: "ERP Instances", path: "/erps/instances", icon: "cpu" as const },
  { key: "modules", label: "ERP Modules", path: "/erps/modules", icon: "sliders" as const },
];

interface RuntimeInstance extends ErpInstance {
  environment?: string;
  last_seen_at?: string;
}

export function ErpInstances() {
  const [instances, setInstances] = useState<RuntimeInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [envFilter, setEnvFilter] = useState("ALL");

  const fetchInstances = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<ErpInstance[]>("/global/erps");
      setInstances(Array.isArray(res) ? res : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load ERP instances.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInstances();
  }, []);

  const filtered = instances.filter((inst) => {
    const key = inst.erp_key || inst.key || "";
    const matchQuery =
      inst.name.toLowerCase().includes(search.toLowerCase()) ||
      key.toLowerCase().includes(search.toLowerCase()) ||
      (inst.base_url || "").toLowerCase().includes(search.toLowerCase());
    const matchEnv = envFilter === "ALL" || (inst.environment || "production").toUpperCase() === envFilter;
    return matchQuery && matchEnv;
  });

  return (
    <AppShell activeKey="erp-instances" pageTitle="ERP Runtime Instances">
      <SectionNavTabs items={ERP_TABS} activeKey="instances" />

      {/* Header Info */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 4px", color: "var(--color-text)" }}>
            Deployment & Runtime Instances
          </h2>
          <p style={{ fontSize: "13px", color: "var(--color-muted)", margin: 0 }}>
            Inspect environment placement, reported versions, endpoints, and live availability across ERP deployments.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={fetchInstances}
          style={{ display: "flex", alignItems: "center", gap: "6px" }}
        >
          <ICONS.refresh width={14} height={14} />
          Refresh
        </button>
      </div>

      {/* Filters Bar */}
      <div
        className="card"
        style={{
          padding: "16px",
          marginBottom: "20px",
          display: "flex",
          gap: "12px",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: "220px" }}>
          <input
            type="text"
            className="input"
            placeholder="Filter instances by name, key, or URL..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <select
            className="input"
            value={envFilter}
            onChange={(e) => setEnvFilter(e.target.value)}
            style={{ minWidth: "140px" }}
          >
            <option value="ALL">All Environments</option>
            <option value="PRODUCTION">Production</option>
            <option value="STAGING">Staging</option>
            <option value="DEVELOPMENT">Development</option>
            <option value="LOCAL">Local</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <SkeletonTable rows={4} cols={6} />
      ) : error ? (
        <div className="card" style={{ padding: "24px", color: "var(--color-danger)" }}>
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: "48px", textAlign: "center", color: "var(--color-muted)" }}>
          No ERP runtime instances found matching your criteria.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ERP Instance</th>
                  <th>Key / ID</th>
                  <th>Environment</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Endpoint (Base URL)</th>
                  <th>Last Seen / Heartbeat</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inst) => {
                  const isAlive = inst.last_seen_at && new Date(inst.last_seen_at).getTime() > Date.now() - 3600000;
                  return (
                    <tr key={inst.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: "var(--color-text)" }}>{inst.display_name || inst.name}</div>
                        <div style={{ fontSize: "12px", color: "var(--color-muted)" }}>{inst.description || "Autonomous Tenant"}</div>
                      </td>
                      <td>
                        <code style={{ fontSize: "12px", background: "var(--color-bg)", padding: "2px 6px", borderRadius: "4px" }}>
                          {inst.erp_key || inst.key}
                        </code>
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: "12px",
                            background: "var(--color-bg)",
                            border: "1px solid var(--color-border)",
                            textTransform: "uppercase",
                          }}
                        >
                          {inst.environment || "production"}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                          v{inst.version || "1.0.0"}
                        </span>
                      </td>
                      <td>
                        <StatusBadge status={inst.status} />
                      </td>
                      <td>
                        {inst.base_url ? (
                          <a
                            href={inst.base_url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              fontSize: "12px",
                              color: "var(--color-primary)",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              textDecoration: "none",
                            }}
                          >
                            {inst.base_url}
                            <ICONS.externalLink width={11} height={11} />
                          </a>
                        ) : (
                          <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>Not configured</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
                          <span
                            style={{
                              width: "8px",
                              height: "8px",
                              borderRadius: "50%",
                              background: isAlive ? "var(--color-success, #10b981)" : "var(--color-muted, #94a3b8)",
                            }}
                          />
                          <span>{inst.last_seen_at ? new Date(inst.last_seen_at).toLocaleString() : "Never reported"}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Link to={`/erps/${inst.id}`} className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: "12px" }}>
                          Inspect
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
