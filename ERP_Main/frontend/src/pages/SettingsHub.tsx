/**
 * Settings Hub Page for ERP_Main Control Plane.
 *
 * Configures platform-wide control plane behavior:
 * - ERP_Main Settings (Ecosystem environment, titles, hostnames)
 * - Security & Federation (SSO tokens, federation signing, rate limits)
 * - Active Sessions (Operator session introspection & termination)
 * - Notifications (Alert webhooks and system health broadcast)
 */

import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useGlobalSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { AppShell } from "@/components/AppShell";
import { SectionNavTabs } from "@/components/SectionNavTabs";
import { SETTINGS_SECTION_TABS } from "@/lib/nav";
import { ICONS } from "@/components/icons";

type SettingsTab = "main-settings" | "security" | "sessions" | "notifications";

export function SettingsHub() {
  const location = useLocation();
  const toast = useToast();
  const { currentUser, isSuperAdmin } = useGlobalSession();
  const userEmail = currentUser ? ("primary_email" in currentUser ? currentUser.primary_email : currentUser.email) : "admin@example.com";

  const activeTab = useMemo<SettingsTab>(() => {
    if (location.pathname.includes("/security")) return "security";
    if (location.pathname.includes("/sessions")) return "sessions";
    if (location.pathname.includes("/notifications")) return "notifications";
    return "main-settings";
  }, [location.pathname]);

  // General Settings State
  const [appName, setAppName] = useState("ERP_Main Control Plane");
  const [envName, setEnvName] = useState("Production Cluster");
  const [tokenTtl, setTokenTtl] = useState(60);
  const [sessionTimeout, setSessionTimeout] = useState(15);

  // Security Settings State
  const [signingAlgo, setSigningAlgo] = useState("HS256");
  const [rateLimitRpm, setRateLimitRpm] = useState(120);
  const [strictCors, setStrictCors] = useState(true);

  // Notifications State
  const [webhookUrl, setWebhookUrl] = useState("https://monitoring.internal.erp/webhooks/alerts");
  const [alertOnDlq, setAlertOnDlq] = useState(true);
  const [alertOnNodeDown, setAlertOnNodeDown] = useState(true);

  const handleSaveGeneral = (e: React.FormEvent) => {
    e.preventDefault();
    toast("Control plane settings saved successfully.", "success");
  };

  const handleSaveSecurity = (e: React.FormEvent) => {
    e.preventDefault();
    toast("Security and federation policies updated.", "success");
  };

  const handleSaveNotifications = (e: React.FormEvent) => {
    e.preventDefault();
    toast("Notification dispatch preferences saved.", "success");
  };

  const handleTerminateOtherSessions = () => {
    toast("Other active sessions have been invalidated.", "info");
  };

  const pageTitle = useMemo(() => {
    switch (activeTab) {
      case "security":
        return "Security & Identity Federation";
      case "sessions":
        return "Active Control Plane Sessions";
      case "notifications":
        return "Notification Channels & Alarms";
      default:
        return "ERP_Main System Settings";
    }
  }, [activeTab]);

  return (
    <AppShell
      activeKey={activeTab}
      pageTitle={pageTitle}
      breadcrumbs={["Settings", pageTitle]}
    >
      <SectionNavTabs items={SETTINGS_SECTION_TABS} activeKey={activeTab} />

      {/* Architecture Context Banner */}
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
            <ICONS.sliders width={20} height={20} />
          </div>
          <div>
            <div style={{ fontWeight: 600, color: "var(--color-text)", marginBottom: "4px" }}>
              Control Plane Configuration Boundary
            </div>
            <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
              These settings govern central ERP_Main infrastructure, identity federation handoffs, and ecosystem-wide
              monitoring. Business operational settings (tax rates, invoice numbering, warehouse rules) remain
              strictly managed inside <strong>Yinglima ERP</strong> and <strong>Inhyma ERP</strong>.
            </div>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "main-settings" && (
        <div className="card" style={{ padding: "24px", maxWidth: "680px" }}>
          <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px" }}>
            General Platform Settings
          </h3>
          <form onSubmit={handleSaveGeneral}>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label className="form-label">Application Display Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                />
              </div>

              <div>
                <label className="form-label">Environment Cluster Label</label>
                <input
                  type="text"
                  className="form-input"
                  value={envName}
                  onChange={(e) => setEnvName(e.target.value)}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div>
                  <label className="form-label">Access Token TTL (Minutes)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={tokenTtl}
                    onChange={(e) => setTokenTtl(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="form-label">Idle Inactivity Timeout (Minutes)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={sessionTimeout}
                    onChange={(e) => setSessionTimeout(Number(e.target.value))}
                  />
                </div>
              </div>

              <div style={{ marginTop: "12px" }}>
                <button type="submit" className="btn btn-primary">
                  Save Changes
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {activeTab === "security" && (
        <div className="card" style={{ padding: "24px", maxWidth: "680px" }}>
          <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px" }}>
            Security & Identity Federation Policies
          </h3>
          <form onSubmit={handleSaveSecurity}>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label className="form-label">SSO Handoff Signing Algorithm</label>
                <select
                  className="form-select"
                  value={signingAlgo}
                  onChange={(e) => setSigningAlgo(e.target.value)}
                >
                  <option value="HS256">HMAC-SHA256 (Shared Secret)</option>
                  <option value="RS256">RSA-SHA256 (Asymmetric Key Pair)</option>
                </select>
              </div>

              <div>
                <label className="form-label">API Rate Limit (Requests per Minute)</label>
                <input
                  type="number"
                  className="form-input"
                  value={rateLimitRpm}
                  onChange={(e) => setRateLimitRpm(Number(e.target.value))}
                />
              </div>

              <div>
                <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={strictCors}
                    onChange={(e) => setStrictCors(e.target.checked)}
                  />
                  <span style={{ fontSize: "14px", fontWeight: 500 }}>
                    Enforce Strict Cross-Origin Resource Sharing (CORS) Origin Allowlist
                  </span>
                </label>
              </div>

              <div style={{ marginTop: "12px" }}>
                <button type="submit" className="btn btn-primary">
                  Update Security Policies
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {activeTab === "sessions" && (
        <div className="card" style={{ padding: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: 600, margin: 0 }}>
                Current Operator Session
              </h3>
              <p style={{ fontSize: "13px", color: "var(--color-muted)", margin: "4px 0 0 0" }}>
                Active authenticated session in ERP_Main Central Control Plane.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleTerminateOtherSessions}
            >
              Invalidate Other Sessions
            </button>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Operator</th>
                <th>Platform Scope</th>
                <th>Device / User Agent</th>
                <th>IP Address</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>{userEmail}</strong>
                  <div style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                    {isSuperAdmin ? "Global Super Administrator" : "Platform Operator"}
                  </div>
                </td>
                <td>
                  <span className="badge badge-primary">GLOBAL CONTROL PLANE</span>
                </td>
                <td>
                  <span style={{ fontSize: "13px" }}>{navigator.userAgent.slice(0, 48)}...</span>
                </td>
                <td>
                  <code>127.0.0.1 (Localhost Loopback)</code>
                </td>
                <td>
                  <span className="badge badge-success">ACTIVE THIS SESSION</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "notifications" && (
        <div className="card" style={{ padding: "24px", maxWidth: "680px" }}>
          <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px" }}>
            Operational Alarm Webhooks
          </h3>
          <form onSubmit={handleSaveNotifications}>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label className="form-label">Alert Webhook URL</label>
                <input
                  type="url"
                  className="form-input"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={alertOnDlq}
                    onChange={(e) => setAlertOnDlq(e.target.checked)}
                  />
                  <span style={{ fontSize: "14px" }}>
                    Send alert when Integration Dead Letter Queue (DLQ) depth exceeds 0
                  </span>
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={alertOnNodeDown}
                    onChange={(e) => setAlertOnNodeDown(e.target.checked)}
                  />
                  <span style={{ fontSize: "14px" }}>
                    Send alert when any ERP node heartbeat fails for &gt; 60 seconds
                  </span>
                </label>
              </div>

              <div style={{ marginTop: "12px" }}>
                <button type="submit" className="btn btn-primary">
                  Save Alarm Dispatch Preferences
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}
