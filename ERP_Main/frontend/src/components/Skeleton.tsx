/**
 * Modern Shimmer Skeleton Loading Components for ERP_Main Control Plane.
 *
 * Provides granular and composite skeleton placeholders matching the exact
 * layout, geometry, and design system of the control plane.
 */

import { type CSSProperties } from "react";

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  style?: CSSProperties;
  className?: string;
}

export function SkeletonLine({
  width = "100%",
  height = "14px",
  borderRadius = "4px",
  style,
  className = "",
}: SkeletonProps) {
  return (
    <div
      className={`skeleton-line ${className}`}
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  );
}

export function SkeletonCircle({
  size = 32,
  style,
  className = "",
}: {
  size?: number | string;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={`skeleton-circle ${className}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        ...style,
      }}
    />
  );
}

export function SkeletonBox({
  width = "100%",
  height = "100%",
  borderRadius = "8px",
  style,
  className = "",
}: SkeletonProps) {
  return (
    <div
      className={`skeleton-box ${className}`}
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  );
}

/**
 * Skeleton placeholder for Dashboard & Reporting Stat Cards.
 */
export function SkeletonStatCard() {
  return (
    <div className="cp-stat-card" style={{ cursor: "default" }}>
      <SkeletonCircle size={44} style={{ borderRadius: "10px" }} />
      <div className="cp-stat-info" style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
        <SkeletonLine width="45%" height="24px" borderRadius="6px" />
        <SkeletonLine width="75%" height="13px" borderRadius="4px" />
      </div>
    </div>
  );
}

export function SkeletonStatGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="cp-stat-grid" style={{ marginBottom: "32px" }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonStatCard key={i} />
      ))}
    </div>
  );
}

/**
 * Skeleton placeholder for ERP Fleet Cards (Dashboard & Registry).
 */
export function SkeletonFleetCard() {
  return (
    <div
      style={{
        background: "var(--color-surface, #ffffff)",
        border: "1px solid var(--color-border, #e2e8f0)",
        borderRadius: "var(--radius-lg, 12px)",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "50%" }}>
          <SkeletonLine width="70%" height="20px" borderRadius="6px" />
          <SkeletonLine width="40%" height="12px" />
        </div>
        <SkeletonLine width="64px" height="22px" borderRadius="12px" />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <SkeletonLine width="25%" height="13px" />
          <SkeletonLine width="30%" height="13px" />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <SkeletonLine width="35%" height="13px" />
          <SkeletonLine width="20%" height="13px" />
        </div>
      </div>

      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        <SkeletonLine width="48px" height="20px" borderRadius="4px" />
        <SkeletonLine width="56px" height="20px" borderRadius="4px" />
        <SkeletonLine width="68px" height="20px" borderRadius="4px" />
        <SkeletonLine width="52px" height="20px" borderRadius="4px" />
      </div>

      <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
        <SkeletonLine width="40%" height="36px" borderRadius="6px" />
        <SkeletonLine width="60%" height="36px" borderRadius="6px" />
      </div>
    </div>
  );
}

export function SkeletonFleetGrid({ count = 2 }: { count?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
        gap: "20px",
        marginBottom: "32px",
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonFleetCard key={i} />
      ))}
    </div>
  );
}

/**
 * Modern Shimmer Skeleton Table for list views.
 */
export function SkeletonTable({
  rows = 5,
  cols = 5,
  showHeader = true,
}: {
  rows?: number;
  cols?: number;
  showHeader?: boolean;
}) {
  const widths = ["75%", "50%", "65%", "40%", "85%", "60%", "45%"];

  return (
    <div className="table-wrap" style={{ border: "1px solid var(--color-border, #e2e8f0)", borderRadius: "var(--radius, 8px)" }}>
      <table className="table" style={{ margin: 0 }}>
        {showHeader && (
          <thead>
            <tr>
              {Array.from({ length: cols }).map((_, i) => (
                <th key={i} style={{ height: "42px", background: "var(--color-bg, #f8fafc)" }}>
                  <SkeletonLine width={widths[i % widths.length]} height="12px" />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} style={{ height: "50px", verticalAlign: "middle" }}>
                  <SkeletonLine
                    width={widths[(r + c) % widths.length]}
                    height="13px"
                    style={{ opacity: 0.85 + ((r + c) % 3) * 0.05 }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Skeleton placeholder for Sub-navigation Tabs.
 */
export function SkeletonTabs({ count = 4 }: { count?: number }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        borderBottom: "1px solid var(--color-border, #e2e8f0)",
        paddingBottom: "12px",
        marginBottom: "24px",
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonLine key={i} width="110px" height="34px" borderRadius="6px" />
      ))}
    </div>
  );
}

/**
 * Complete Composite Skeleton for the ERP Dashboard.
 */
export function SkeletonDashboard() {
  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      {/* 4 Stat Cards */}
      <SkeletonStatGrid count={4} />

      {/* Fleet Status Section */}
      <div style={{ marginBottom: "32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <SkeletonLine width="200px" height="20px" borderRadius="6px" />
          <SkeletonLine width="100px" height="14px" />
        </div>
        <SkeletonFleetGrid count={2} />
      </div>

      {/* Dual Table Section */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: "24px" }}>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <SkeletonLine width="160px" height="18px" borderRadius="4px" />
            <SkeletonLine width="80px" height="13px" />
          </div>
          <SkeletonTable rows={4} cols={4} />
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <SkeletonLine width="190px" height="18px" borderRadius="4px" />
            <SkeletonLine width="80px" height="13px" />
          </div>
          <SkeletonTable rows={4} cols={3} />
        </div>
      </div>
    </div>
  );
}

/**
 * Composite Page Skeleton for Standard Hub & List Pages.
 */
export function SkeletonPage({
  tabs = 0,
  stats = 0,
  tableRows = 6,
  tableCols = 5,
}: {
  tabs?: number;
  stats?: number;
  tableRows?: number;
  tableCols?: number;
}) {
  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      {tabs > 0 && <SkeletonTabs count={tabs} />}
      {stats > 0 && <SkeletonStatGrid count={stats} />}

      <div style={{ background: "var(--color-surface, #ffffff)", borderRadius: "var(--radius, 8px)", padding: "16px", border: "1px solid var(--color-border, #e2e8f0)", marginBottom: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
          <SkeletonLine width="220px" height="34px" borderRadius="6px" />
          <div style={{ display: "flex", gap: "8px" }}>
            <SkeletonLine width="80px" height="34px" borderRadius="6px" />
            <SkeletonLine width="100px" height="34px" borderRadius="6px" />
          </div>
        </div>
        <SkeletonTable rows={tableRows} cols={tableCols} />
      </div>
    </div>
  );
}
