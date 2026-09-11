/**
 * 403 Forbidden Access Denied Page for ERP_Main Control Plane.
 */

import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { ICONS } from "@/components/icons";

export function Forbidden() {
  return (
    <AppShell activeKey="dashboard" pageTitle="Access Denied">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "64px 20px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "50%",
            background: "#fef2f2",
            color: "#ef4444",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "16px",
          }}
        >
          <ICONS.shield width={32} height={32} />
        </div>

        <h2 style={{ fontSize: "22px", fontWeight: 800, color: "var(--color-text)", margin: "0 0 8px" }}>
          403 — Access Denied
        </h2>

        <p style={{ fontSize: "14px", color: "var(--color-muted)", maxWidth: "480px", margin: "0 0 24px" }}>
          Your platform identity does not hold the necessary platform role or permission grant to access this
          control plane resource.
        </p>

        <Link to="/dashboard" className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          Return to Dashboard
        </Link>
      </div>
    </AppShell>
  );
}
