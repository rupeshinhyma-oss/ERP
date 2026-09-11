/**
 * ERP Switcher & Launcher for ERP_Main Control Plane.
 *
 * Implements membership-aware ERP discovery, display of ERP runtime instances,
 * and direct host endpoint launching for Yinglima and Inhyma.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "@/lib/api";
import { useGlobalSession } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { StatusBadge, Banner, EmptyState, SkeletonFleetGrid } from "@/components/ui";
import { ICONS } from "@/components/icons";
import { createSsoHandoverUrl } from "@/lib/ssoBridge";
import type { ErpInstance, ErpMembership } from "@/types";

/**
 * Fallback host URL resolver if base_url is unset in database.
 */
export function getErpHostUrl(erp: Partial<ErpInstance>): string {
  if (erp.base_url) return erp.base_url;
  const key = (erp.erp_key || (erp as any).key || "").toLowerCase();
  if (key === "inhyma") return "http://localhost:5174/dashboard";
  if (key === "yinglima") return "http://localhost:5173/dashboard";
  return "";
}

export function ErpLauncher() {
  const { currentUser, userType, memberships: sessionMemberships } = useGlobalSession();
  const isSuperAdmin = userType === "platform_admin";

  const [erps, setErps] = useState<ErpInstance[]>([]);
  const [memberships, setMemberships] = useState<ErpMembership[]>(sessionMemberships);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const loadData = async () => {
      try {
        const erpsRes = await apiGet<ErpInstance[]>("/global/erps");
        const rawErps = (erpsRes as any)?.data ?? erpsRes;
        const erpsList = Array.isArray(rawErps) ? rawErps : [];

        let memsList: ErpMembership[] = sessionMemberships;

        // If memberships not yet in context and we have a user, fetch directly
        if ((!memsList || memsList.length === 0) && currentUser?.id) {
          try {
            const memsRes = await apiGet<ErpMembership[]>(`/global/users/${currentUser.id}/memberships`);
            const rawMems = (memsRes as any)?.data ?? memsRes;
            if (Array.isArray(rawMems)) {
              memsList = rawMems;
            }
          } catch {
            memsList = [];
          }
        }

        if (!cancelled) {
          setErps(erpsList);
          setMemberships(memsList);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadData();

    const handleFocus = () => {
      loadData();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
    };
  }, [currentUser?.id, sessionMemberships]);

  // Authorized ERPs determination:
  // - Platform Super Admins can see all registered ERPs
  // - Global Users see ERPs where they have an ACTIVE membership
  const authorizedErps = erps.filter((erp) => {
    if (isSuperAdmin) {
      return erp.status !== "DECOMMISSIONED";
    }
    const hasActiveMembership = memberships.some(
      (m) => m.erp_instance_id === erp.id && m.status === "ACTIVE"
    );
    return hasActiveMembership && erp.status !== "DECOMMISSIONED";
  });

  const getMembershipForErp = (erpId: string) => {
    return memberships.find((m) => m.erp_instance_id === erpId);
  };

  const handleCopy = (erpId: string, url: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url);
      setCopiedId(erpId);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  return (
    <AppShell
      activeKey="erp-switcher"
      pageTitle="ERP Switcher"
      breadcrumbs={["ERP Management", "ERP Switcher"]}
    >
      <Banner error={error} />

      <div style={{ marginBottom: "24px" }}>
        <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#1e293b", margin: "0 0 6px" }}>
          ERP Switcher
        </h2>
        <p style={{ margin: 0, fontSize: "14px", color: "var(--color-muted, #64748b)", maxWidth: "680px" }}>
          Seamlessly switch between connected ERP applications in the fleet. Each ERP operates with autonomous
          workspaces and its own dedicated host address.
        </p>
      </div>

      {loading ? (
        <SkeletonFleetGrid count={2} />
      ) : authorizedErps.length === 0 ? (
        <EmptyState
          title="No Authorized ERPs Available"
          description="You currently do not have active memberships in any registered ERP instances. Please contact your platform administrator."
        />
      ) : (
        <div
          className="erp-launcher-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: "24px",
          }}
        >
          {authorizedErps.map((erp) => {
            const membership = getMembershipForErp(erp.id);
            const isUnavailable = erp.status !== "ACTIVE";
            const hostUrl = getErpHostUrl(erp);

            return (
              <div
                key={erp.id}
                className="card erp-card"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  padding: "24px",
                  borderRadius: "10px",
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
                  transition: "box-shadow 0.2s ease, transform 0.2s ease",
                }}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: "12px",
                      marginBottom: "12px",
                    }}
                  >
                    <div>
                      <h3
                        style={{
                          fontSize: "18px",
                          fontWeight: 700,
                          color: "#1e293b",
                          margin: "0 0 4px",
                        }}
                      >
                        {erp.name}
                      </h3>
                      <span
                        style={{
                          fontSize: "12px",
                          color: "#64748b",
                          fontFamily: "monospace",
                          background: "#f1f5f9",
                          padding: "2px 6px",
                          borderRadius: "4px",
                        }}
                      >
                        {erp.erp_key || (erp as any).key}
                      </span>
                    </div>
                    <StatusBadge status={erp.status} />
                  </div>

                  <p
                    style={{
                      fontSize: "13px",
                      color: "#64748b",
                      margin: "0 0 16px",
                      lineHeight: "1.5",
                      minHeight: "40px",
                    }}
                  >
                    {erp.description || `Autonomous ERP application running version v${erp.version || "1.0"}.`}
                  </p>

                  {/* Prominent Host URL Box */}
                  <div
                    style={{
                      marginBottom: "16px",
                      padding: "10px 12px",
                      background: "#f8fafc",
                      borderRadius: "8px",
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "4px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                          color: "#64748b",
                        }}
                      >
                        Host URL
                      </span>
                      {hostUrl && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            handleCopy(erp.id, hostUrl);
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            padding: "2px 6px",
                            fontSize: "11px",
                            color: copiedId === erp.id ? "#16a34a" : "#64748b",
                            cursor: "pointer",
                            borderRadius: "4px",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                          title="Copy Host URL"
                        >
                          {copiedId === erp.id ? (
                            <>
                              <ICONS.check width={12} height={12} />
                              <span>Copied!</span>
                            </>
                          ) : (
                            <>
                              <ICONS.copy width={12} height={12} />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    {hostUrl ? (
                      <a
                        href={hostUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "13px",
                          fontFamily: "monospace",
                          color: "#0061f2",
                          textDecoration: "none",
                          fontWeight: 600,
                          wordBreak: "break-all",
                        }}
                      >
                        <span>{hostUrl}</span>
                        <ICONS.externalLink width={13} height={13} />
                      </a>
                    ) : (
                      <span style={{ fontSize: "12px", color: "#94a3b8", fontStyle: "italic" }}>
                        Host URL not configured
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      marginBottom: "20px",
                    }}
                  >
                    {membership && (
                      <span
                        style={{
                          fontSize: "12px",
                          color: "#0284c7",
                          background: "#e0f2fe",
                          padding: "3px 8px",
                          borderRadius: "4px",
                          fontWeight: 500,
                        }}
                      >
                        Local Account: {membership.local_user_id}
                      </span>
                    )}
                    {isSuperAdmin && (
                      <span
                        style={{
                          fontSize: "12px",
                          color: "#7c3aed",
                          background: "#f3e8ff",
                          padding: "3px 8px",
                          borderRadius: "4px",
                          fontWeight: 500,
                        }}
                      >
                        Platform Admin Access
                      </span>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: "auto",
                    paddingTop: "14px",
                    borderTop: "1px solid #f1f5f9",
                    display: "flex",
                    gap: "10px",
                    alignItems: "center",
                  }}
                >
                  <a
                    id={`btn-launch-${erp.erp_key || (erp as any).key}`}
                    href={hostUrl ? (isSuperAdmin ? createSsoHandoverUrl(hostUrl) : hostUrl) : "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary"
                    style={{
                      flex: 1,
                      padding: "10px 16px",
                      backgroundColor: isUnavailable ? "#94a3b8" : "#0061f2",
                      color: "#ffffff",
                      fontSize: "14px",
                      fontWeight: 600,
                      borderRadius: "6px",
                      border: "none",
                      textDecoration: "none",
                      cursor: isUnavailable ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      pointerEvents: isUnavailable ? "none" : "auto",
                      transition: "background 0.2s ease",
                    }}
                  >
                    <span>Open {erp.name}</span>
                    <ICONS.externalLink width={15} height={15} />
                  </a>

                  <Link
                    to={`/erps/${erp.id}`}
                    className="btn btn-secondary"
                    style={{
                      padding: "10px 14px",
                      fontSize: "13px",
                      fontWeight: 500,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      textDecoration: "none",
                      borderRadius: "6px",
                    }}
                    title="View ERP Details and Config"
                  >
                    <ICONS.settings width={14} height={14} />
                    <span>Details</span>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

export default ErpLauncher;
