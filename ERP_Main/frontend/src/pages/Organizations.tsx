/**
 * Organizations Section for ERP_Main Control Plane.
 *
 * Implements ecosystem organizational governance across:
 * - Companies (Operating enterprise legal entities mapped to ERP nodes)
 * - Organizations (Multi-tenant organizational structure & boundaries)
 * - Departments (Child ERP department boundaries & local authority)
 * - Business Units (Cross-ERP functional business divisions)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiGet } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { SectionNavTabs } from "@/components/SectionNavTabs";
import { ORG_SECTION_TABS } from "@/lib/nav";
import {
  Banner,
  SkeletonTable,
  StatusBadge,
} from "@/components/ui";
import { ICONS } from "@/components/icons";
import type { ErpInstance } from "@/types";

type OrgTab = "companies" | "organizations" | "departments" | "business-units";

export function Organizations() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeTab = useMemo<OrgTab>(() => {
    if (location.pathname.includes("/companies")) return "companies";
    if (location.pathname.includes("/departments")) return "departments";
    if (location.pathname.includes("/business-units")) return "business-units";
    return "organizations";
  }, [location.pathname]);

  const [erps, setErps] = useState<ErpInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<ErpInstance[]>("/global/erps");
      setErps(data || []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredErps = useMemo(() => {
    if (!search.trim()) return erps;
    const q = search.toLowerCase();
    return erps.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.erp_key.toLowerCase().includes(q) ||
        (e.base_url && e.base_url.toLowerCase().includes(q))
    );
  }, [erps, search]);

  const pageTitle = useMemo(() => {
    switch (activeTab) {
      case "companies":
        return "Operating Companies";
      case "departments":
        return "Department Directory";
      case "business-units":
        return "Business Units";
      default:
        return "Ecosystem Organizations";
    }
  }, [activeTab]);

  return (
    <AppShell
      activeKey={activeTab === "organizations" ? "organizations" : activeTab}
      pageTitle={pageTitle}
      breadcrumbs={["Organizations", pageTitle]}
    >
      <SectionNavTabs items={ORG_SECTION_TABS} activeKey={activeTab} />

      <Banner error={error} />

      {/* Architectural Isolation Notice */}
      <div
        className="card"
        style={{
          marginBottom: "20px",
          padding: "16px 20px",
          background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
          border: "1px solid var(--color-border)",
          borderLeft: "4px solid var(--color-primary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              backgroundColor: "rgba(14, 116, 144, 0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-primary)",
              flexShrink: 0,
            }}
          >
            <ICONS.building width={20} height={20} />
          </div>
          <div>
            <div style={{ fontWeight: 600, color: "var(--color-text)", marginBottom: "4px" }}>
              Enterprise Organization Boundary Architecture
            </div>
            <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
              ERP_Main coordinates global entity identity and organizational mapping across the federation.
              Child ERPs (<strong>Yinglima ERP</strong> and <strong>Inhyma ERP</strong>) maintain autonomous
              operational companies, internal department trees, and transactional business units within their
              dedicated PostgreSQL schemas.
            </div>
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
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
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: "260px" }}>
          <div style={{ position: "relative", width: "100%", maxWidth: "360px" }}>
            <ICONS.search
              width={16}
              height={16}
              style={{ position: "absolute", left: "10px", top: "10px", color: "var(--color-muted)" }}
            />
            <input
              type="text"
              id="input-org-search"
              className="form-input"
              style={{ paddingLeft: "32px", height: "36px", width: "100%" }}
              placeholder={`Search ${activeTab}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div style={{ fontSize: "13px", color: "var(--color-muted)" }}>
          Showing <strong>{filteredErps.length}</strong> active ERP nodes
        </div>
      </div>

      {/* Tab Content */}
      {loading ? (
        <SkeletonTable rows={5} cols={5} />
      ) : activeTab === "companies" ? (
        /* COMPANIES TAB */
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="data-table" id="table-companies">
            <thead>
              <tr>
                <th>Company / Node</th>
                <th>System Key</th>
                <th>Deployment URL</th>
                <th>Status</th>
                <th>Capabilities</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredErps.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "32px" }}>
                    No companies registered in the ecosystem.
                  </td>
                </tr>
              ) : (
                filteredErps.map((erp) => (
                  <tr key={erp.id} id={`company-row-${erp.erp_key}`}>
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--color-text)" }}>{erp.name}</div>
                      <div style={{ fontSize: "12px", color: "var(--color-muted)" }}>Node ID: {erp.id.slice(0, 8)}...</div>
                    </td>
                    <td>
                      <span className="badge badge-outline" style={{ fontFamily: "monospace" }}>
                        {erp.erp_key}
                      </span>
                    </td>
                    <td>
                      <a
                        href={erp.base_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--color-primary)", textDecoration: "none", fontSize: "13px" }}
                      >
                        {erp.base_url}
                      </a>
                    </td>
                    <td>
                      <StatusBadge status={erp.status} />
                    </td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {(erp.capabilities || []).slice(0, 4).map((cap) => (
                          <span
                            key={cap}
                            style={{
                              fontSize: "11px",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              background: "#f1f5f9",
                              color: "#475569",
                            }}
                          >
                            {cap}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <a
                        href={erp.base_url}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-secondary btn-sm"
                        style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                      >
                        <span>Open ERP</span>
                        <ICONS.externalLink width={12} height={12} />
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : activeTab === "departments" ? (
        /* DEPARTMENTS TAB */
        <div>
          <div
            className="card"
            style={{
              padding: "24px",
              marginBottom: "20px",
              backgroundColor: "#fff",
            }}
          >
            <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
              Child ERP Department Federations
            </h3>
            <p style={{ fontSize: "13px", color: "var(--color-muted)", marginBottom: "20px" }}>
              Per Phase 6 & Phase 10 organizational guidelines, departmental structures (Merchandising, Commercial,
              Fabric, Production, QA, HR) are mastered directly inside each child ERP's local database.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
              {erps.map((erp) => (
                <div
                  key={erp.id}
                  className="card"
                  style={{
                    padding: "16px",
                    border: "1px solid var(--color-border)",
                    borderRadius: "8px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <div style={{ fontWeight: 600, fontSize: "14px" }}>{erp.name} Departments</div>
                    <StatusBadge status={erp.status} />
                  </div>
                  <p style={{ fontSize: "12px", color: "var(--color-muted)", marginBottom: "16px" }}>
                    Hierarchical designations, teams, and approval escalation tiers are managed natively in this node.
                  </p>
                  <a
                    href={`${erp.base_url}/settings/organization`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary btn-sm"
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    Manage {erp.name} Departments &rarr;
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : activeTab === "business-units" ? (
        /* BUSINESS UNITS TAB */
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="data-table" id="table-business-units">
            <thead>
              <tr>
                <th>Business Unit</th>
                <th>Responsible ERP Node</th>
                <th>Domain Scope</th>
                <th>Governance Status</th>
                <th style={{ textAlign: "right" }}>Node Health</th>
              </tr>
            </thead>
            <tbody>
              {erps.map((erp) => (
                <tr key={erp.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{erp.name} Business Unit</div>
                    <div style={{ fontSize: "12px", color: "var(--color-muted)" }}>Unit Key: BU-{erp.erp_key.toUpperCase()}</div>
                  </td>
                  <td>
                    <span className="badge badge-outline">{erp.erp_key}</span>
                  </td>
                  <td>
                    <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                      {(erp.capabilities || []).join(", ") || "Full Enterprise Business Operations"}
                    </span>
                  </td>
                  <td>
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#059669",
                        backgroundColor: "#ecfdf5",
                        padding: "3px 8px",
                        borderRadius: "12px",
                      }}
                    >
                      Federated Autonomous
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <StatusBadge status={erp.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* ORGANIZATIONS TAB (DEFAULT) */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "20px" }}>
          {filteredErps.map((erp) => (
            <div
              key={erp.id}
              className="card"
              id={`org-card-${erp.erp_key}`}
              style={{
                padding: "20px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                height: "100%",
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                  <div>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, margin: "0 0 4px 0" }}>{erp.name}</h3>
                    <div style={{ fontSize: "12px", color: "var(--color-muted)", fontFamily: "monospace" }}>
                      Key: {erp.erp_key} &bull; v{erp.version || "1.0.0"}
                    </div>
                  </div>
                  <StatusBadge status={erp.status} />
                </div>

                <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "16px" }}>
                  Autonomous operational organization node connected to the central control plane with full sync and identity federation.
                </p>

                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase", marginBottom: "6px" }}>
                    Enabled Domain Capabilities
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {(erp.capabilities || []).map((cap) => (
                      <span
                        key={cap}
                        style={{
                          fontSize: "11px",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          backgroundColor: "rgba(14, 116, 144, 0.08)",
                          color: "var(--color-primary)",
                          fontWeight: 500,
                        }}
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: "8px", borderTop: "1px solid var(--color-border)", paddingTop: "14px" }}>
                <a
                  href={erp.base_url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-primary btn-sm"
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  Launch ERP
                </a>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => navigate(`/erps/instances`)}
                >
                  Inspect Node
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
