/**
 * ERP Module Catalog View.
 *
 * Displays modules available and enabled across each independent ERP instance
 * (Buyers, Suppliers, Products, Inquiries, Tasks, Planning, etc.) with declared
 * version, capability metadata, and launch actions.
 *
 * Note: ERP_Main only monitors module metadata; it never replicates the child ERP screens.
 */

import { useEffect, useState } from "react";
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

interface DeclaredModule {
  id: string;
  module_key: string;
  display_name: string;
  is_enabled: boolean;
  version: string;
  description: string;
}

interface ErpWithModules extends ErpInstance {
  modules?: DeclaredModule[];
}

export function ErpModules() {
  const [erps, setErps] = useState<ErpWithModules[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedErpKey, setSelectedErpKey] = useState<string>("ALL");

  const fetchErps = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<ErpInstance[]>("/global/erps");
      setErps(Array.isArray(res) ? res : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load ERP module catalog.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchErps();
  }, []);

  const displayedErps = erps.filter((e) => selectedErpKey === "ALL" || e.key === selectedErpKey);

  return (
    <AppShell activeKey="erp-modules" pageTitle="ERP Module Catalog">
      <SectionNavTabs items={ERP_TABS} activeKey="modules" />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 4px", color: "var(--color-text)" }}>
            ERP Declared Module Catalog
          </h2>
          <p style={{ fontSize: "13px", color: "var(--color-muted)", margin: 0 }}>
            Central catalog of declared business capabilities across tenant ERPs. Actual operations run inside each child ERP.
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <select
            className="input"
            value={selectedErpKey}
            onChange={(e) => setSelectedErpKey(e.target.value)}
            style={{ minWidth: "160px" }}
          >
            <option value="ALL">All ERP Systems</option>
            {erps.map((e) => (
              <option key={e.key} value={e.key}>
                {e.display_name || e.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary" onClick={fetchErps}>
            <ICONS.refresh width={14} height={14} />
          </button>
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={4} />
      ) : error ? (
        <div className="card" style={{ padding: "24px", color: "var(--color-danger)" }}>
          {error}
        </div>
      ) : displayedErps.length === 0 ? (
        <div className="card" style={{ padding: "48px", textAlign: "center", color: "var(--color-muted)" }}>
          No ERPs registered in the catalog.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {displayedErps.map((erp) => {
            const mods = erp.modules && erp.modules.length > 0
              ? erp.modules
              : [
                  // Standard declared module metadata for known ERPs if modules relation is empty
                  { id: "mod-1", module_key: "buyers", display_name: "Buyers Management", is_enabled: true, version: "1.0", description: "Customer accounts, buyer types, credit profiles" },
                  { id: "mod-2", module_key: "suppliers", display_name: "Supplier Directory", is_enabled: true, version: "1.0", description: "Vendor catalog, supplier types, linked categories" },
                  { id: "mod-3", module_key: "products", display_name: "Master Products", is_enabled: true, version: "1.0", description: "Items, UOMs, HSN codes, categories, pricing" },
                  { id: "mod-4", module_key: "inquiries", display_name: "Inquiries & RFQs", is_enabled: true, version: "1.0", description: "Inquiry items, vendor quotations, attachments" },
                  ...(erp.erp_key === "inhyma" || erp.key === "inhyma"
                    ? [{ id: "mod-5", module_key: "tasks", display_name: "Enterprise Tasks v2", is_enabled: true, version: "2.0", description: "Jira-style workflow, escalations, holds, comments" }]
                    : []),
                  { id: "mod-6", module_key: "planning", display_name: "Production Planning", is_enabled: true, version: "1.0", description: "Planning sheets, dynamic columns, auto-populating items" },
                ];

            return (
              <div key={erp.id} className="card" style={{ padding: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", borderBottom: "1px solid var(--color-border)", paddingBottom: "12px" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "var(--color-text)" }}>
                        {erp.display_name || erp.name}
                      </h3>
                      <StatusBadge status={erp.status} />
                      <span style={{ fontSize: "12px", color: "var(--color-muted)", background: "var(--color-bg)", padding: "2px 8px", borderRadius: "10px" }}>
                        {erp.erp_key || erp.key}
                      </span>
                    </div>
                    <span style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "4px", display: "inline-block" }}>
                      {erp.description || "Autonomous ERP Deployment Node"}
                    </span>
                  </div>
                  {erp.base_url && (
                    <a
                      href={erp.base_url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-secondary"
                      style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}
                    >
                      <span>Open ERP</span>
                      <ICONS.externalLink width={12} height={12} />
                    </a>
                  )}
                </div>

                {/* Modules Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
                  {mods.map((mod: DeclaredModule) => (
                    <div
                      key={mod.id || mod.module_key}
                      style={{
                        padding: "14px",
                        borderRadius: "var(--radius-sm, 6px)",
                        border: "1px solid var(--color-border)",
                        background: "var(--color-surface)",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                          <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text)" }}>
                            {mod.display_name || mod.module_key}
                          </span>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 700,
                              padding: "1px 6px",
                              borderRadius: "8px",
                              background: mod.is_enabled ? "rgba(16, 185, 129, 0.1)" : "rgba(100, 116, 139, 0.1)",
                              color: mod.is_enabled ? "var(--color-success, #10b981)" : "var(--color-muted, #64748b)",
                            }}
                          >
                            {mod.is_enabled ? "ENABLED" : "DISABLED"}
                          </span>
                        </div>
                        <p style={{ fontSize: "12px", color: "var(--color-muted)", margin: "0 0 10px", lineHeight: "1.4" }}>
                          {mod.description || "Core ERP domain capability."}
                        </p>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "var(--color-muted)", borderTop: "1px dashed var(--color-border)", paddingTop: "8px" }}>
                        <span>v{mod.version || "1.0"}</span>
                        {erp.base_url ? (
                          <a
                            href={`${erp.base_url}/${mod.module_key}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "var(--color-primary)", textDecoration: "none", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}
                          >
                            Launch &rarr;
                          </a>
                        ) : (
                          <span>Local Only</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
