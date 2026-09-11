/**
 * Functional ERP Launcher ("My ERPs") for ERP_Main.
 *
 * Implements membership-aware ERP discovery, dynamic fleet resolution,
 * and secure Phase 4 federation / SSO launch with PKCE and state protection.
 */

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { useGlobalSession } from "@/lib/session";
import { authorizeErpLaunch } from "@/lib/federation";
import { AppShell } from "@/components/AppShell";
import { SectionNavTabs } from "@/components/SectionNavTabs";
import { StatusBadge, Banner, EmptyState, SkeletonFleetGrid } from "@/components/ui";
import { ICONS } from "@/components/icons";
import type { ErpInstance, ErpMembership, FederationClientRead } from "@/types";

export function ErpLauncher() {
  const { currentUser, userType, memberships: sessionMemberships } = useGlobalSession();
  const isSuperAdmin = userType === "platform_admin";

  const [erps, setErps] = useState<ErpInstance[]>([]);
  const [memberships, setMemberships] = useState<ErpMembership[]>(sessionMemberships);
  const [loading, setLoading] = useState(true);
  const [launchingErpId, setLaunchingErpId] = useState<string | null>(null);
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
            // Fallback for platform admins or restricted permissions
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

    // Revalidate when user returns to this tab without background periodic polling
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
  // - Platform Super Admins can see all active or registered ERPs
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

  const handleLaunch = async (erp: ErpInstance) => {
    if (erp.status !== "ACTIVE") {
      setError(`This ERP instance is currently ${erp.status.toLowerCase()} and cannot be launched.`);
      return;
    }

    if (!erp.base_url) {
      setError(`ERP ${erp.name} does not have a configured base URL.`);
      return;
    }

    setLaunchingErpId(erp.id);
    setError(null);

    try {
      // 1. Fetch registered federation client to obtain authorized redirect URI
      let customRedirectUri: string | undefined;
      try {
        const clientRes = await apiGet<FederationClientRead>(`/global/erps/${erp.id}/federation`);
        if (clientRes?.redirect_uris && clientRes.redirect_uris.length > 0) {
          customRedirectUri = clientRes.redirect_uris[0];
        }
      } catch {
        // Fallback: authorizeErpLaunch will use default /auth/callback on erp.base_url
      }

      // 2. Perform secure authorization code request with PKCE and state protection
      const { launchUrl } = await authorizeErpLaunch(erp, customRedirectUri);

      // 3. Securely navigate the user to the destination ERP
      window.location.href = launchUrl;
    } catch (err: unknown) {
      setLaunchingErpId(null);
      const msg = (err as Error)?.message || "";
      if (msg.includes("active membership") || msg.includes("membership_not_active")) {
        setError("You no longer have access to this ERP.");
      } else if (msg.includes("decommissioned") || msg.includes("INACTIVE")) {
        setError("This ERP is currently unavailable.");
      } else {
        setError(`Unable to open ${erp.name}. Please try again.`);
      }
    }
  };

  return (
    <AppShell
      activeKey="my-erps"
      pageTitle="My ERP Applications"
      breadcrumbs={["ERP Management", "My ERPs"]}
    >
      <SectionNavTabs
        items={[
          { key: "switcher", label: "ERP Switcher", path: "/erps/switcher", icon: "layers" },
          { key: "registry", label: "ERP Registry", path: "/erps/registry", icon: "server" },
          { key: "instances", label: "ERP Instances", path: "/erps/instances", icon: "cpu" },
          { key: "modules", label: "ERP Modules", path: "/erps/modules", icon: "sliders" },
        ]}
        activeKey="switcher"
      />

      <Banner error={error} />

      <div style={{ marginBottom: "24px" }}>
        <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#1e293b", margin: "0 0 6px" }}>
          My ERP Applications
        </h2>
        <p style={{ margin: 0, fontSize: "14px", color: "var(--color-muted, #64748b)", maxWidth: "680px" }}>
          Access your authorized business ERP applications. Business transactions and organization
          workspaces remain strictly isolated within each independent ERP.
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
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: "24px",
          }}
        >
          {authorizedErps.map((erp) => {
            const membership = getMembershipForErp(erp.id);
            const isLaunching = launchingErpId === erp.id;
            const isUnavailable = erp.status !== "ACTIVE";

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
                      marginBottom: "14px",
                    }}
                  >
                    <div>
                      <h3
                        style={{
                          fontSize: "17px",
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
                        {erp.erp_key}
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
                    }}
                  >
                    {erp.description || `Independent Business ERP running version v${erp.version || "1.0"}.`}
                  </p>

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

                <div style={{ marginTop: "auto", paddingTop: "14px", borderTop: "1px solid #f1f5f9" }}>
                  <button
                    type="button"
                    id={`btn-launch-${erp.erp_key}`}
                    disabled={isUnavailable || isLaunching}
                    onClick={() => handleLaunch(erp)}
                    style={{
                      width: "100%",
                      padding: "10px 16px",
                      backgroundColor: isUnavailable ? "#94a3b8" : isLaunching ? "#1e40af" : "#0061f2",
                      color: "#ffffff",
                      fontSize: "14px",
                      fontWeight: 600,
                      borderRadius: "6px",
                      border: "none",
                      cursor: isUnavailable || isLaunching ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      transition: "background 0.2s ease",
                    }}
                  >
                    {isLaunching ? (
                      <>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          style={{ animation: "spin 0.8s linear infinite" }}
                        >
                          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                        <span>Initiating Secure SSO...</span>
                      </>
                    ) : (
                      <>
                        <span>Open {erp.name}</span>
                        <ICONS.externalLink width={15} height={15} />
                      </>
                    )}
                  </button>
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
