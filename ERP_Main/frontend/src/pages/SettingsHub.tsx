/**
 * Settings Hub Page for ERP_Main Control Plane.
 *
 * Configures platform-wide control plane behavior:
 * - ERP_Main Settings (Ecosystem environment, titles, session limits)
 */

import { useState } from "react";
import { useToast } from "@/lib/toast";
import { AppShell } from "@/components/AppShell";

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
    >
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
