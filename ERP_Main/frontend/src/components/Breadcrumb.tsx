/**
 * Breadcrumb trail for ERP_Main Control Plane.
 */

import { Link } from "react-router-dom";

export function Breadcrumb({ trail }: { trail: string[] }) {
  return (
    <div className="breadcrumb" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--color-muted)", marginBottom: "8px" }}>
      <Link to="/dashboard" style={{ color: "var(--color-primary)", textDecoration: "none" }}>
        Dashboard
      </Link>
      {trail.map((segment, index) => (
        <span key={`${segment}-${index}`} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span className="sep" style={{ color: "var(--color-border-strong)" }}>/</span>
          <span className="current" style={{ color: "var(--color-text-secondary)", fontWeight: 500 }}>
            {segment}
          </span>
        </span>
      ))}
    </div>
  );
}
