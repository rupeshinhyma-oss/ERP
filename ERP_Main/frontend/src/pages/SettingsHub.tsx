/**
 * Settings Hub Page for ERP_Main Control Plane.
 *
 * Configures platform-wide control plane behavior:
 * - ERP_Main Settings (Ecosystem environment, titles, session limits)
 */

import { useState } from "react";
import { useToast } from "@/lib/toast";
import { AppShell } from "@/components/AppShell";
import { ICONS } from "@/components/icons";

export function SettingsHub() {
  const toast = useToast();

  // General Settings State
  const [appName, setAppName] = useState("ERP_Main Control Plane");
  const [envName, setEnvName] = useState("Production Cluster");
  const [tokenTtl, setTokenTtl] = useState(60);
  const [sessionTimeout, setSessionTimeout] = useState(15);

  const handleSaveGeneral = (e: React.FormEvent) => {
    e.preventDefault();
    toast("Control plane settings saved successfully.", "success");
  };

  return (
    <AppShell
      activeKey="settings-general"
      pageTitle="ERP_Main System Settings"
      breadcrumbs={["Settings", "ERP_Main Settings"]}
    >
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
            <ICONS.settings width={20} height={20} />
          </div>
          <div>
            <div style={{ fontWeight: 600, color: "var(--color-text)", marginBottom: "4px" }}>
              Control Plane Configuration Boundary
            </div>
            <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
              These settings govern central ERP_Main infrastructure and control plane session timeout rules. Business operational settings (tax rates, invoice numbering, warehouse rules) remain strictly managed inside <strong>Yinglima ERP</strong> and <strong>Inhyma ERP</strong>.
            </div>
          </div>
        </div>
      </div>

      {/* General Settings Form */}
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
    </AppShell>
  );
}
