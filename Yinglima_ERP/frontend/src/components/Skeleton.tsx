/**
 * Reusable Ghost / Shimmer Skeleton Loading Primitives.
 *
 * Uses the global `.skeleton-line`, `.skeleton-box`, `.skeleton-circle`, and
 * `.skeleton-badge` shimmer utility classes defined in `styles/style.css`.
 */

import React from "react";

const DEFAULT_WIDTHS = ["72%", "58%", "84%", "64%", "78%", "52%", "68%", "45%"];

export interface TableSkeletonRowsProps {
  colCount: number;
  rowCount?: number;
  widths?: string[];
  testId?: string;
  cellPadding?: string;
}

export function TableSkeletonRows({
  colCount,
  rowCount = 8,
  widths = DEFAULT_WIDTHS,
  testId = "skeleton-row",
  cellPadding = "12px 14px",
}: TableSkeletonRowsProps) {
  return (
    <>
      {Array.from({ length: rowCount }).map((_, rIdx) => (
        <tr
          key={`sk-row-${rIdx}`}
          data-testid={testId}
          aria-hidden="true"
          style={{ borderBottom: "1px solid #f1f5f9" }}
        >
          {Array.from({ length: colCount }).map((__, cIdx) => {
            const w = widths[(rIdx + cIdx) % widths.length];
            return (
              <td key={`sk-cell-${rIdx}-${cIdx}`} style={{ padding: cellPadding }}>
                <div
                  className="skeleton-line"
                  style={{ width: w, height: "14px", borderRadius: "4px" }}
                />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

export interface CardGridSkeletonProps {
  count?: number;
  minWidth?: number;
  lines?: number;
  showAvatar?: boolean;
}

export function CardGridSkeleton({
  count = 6,
  minWidth = 260,
  lines = 3,
  showAvatar = false,
}: CardGridSkeletonProps) {
  return (
    <div
      data-testid="skeleton-card-grid"
      aria-hidden="true"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
        gap: "14px",
      }}
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={`sk-card-${idx}`}
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "10px",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {showAvatar && (
              <div
                className="skeleton-circle"
                style={{ width: "32px", height: "32px", flexShrink: 0 }}
              />
            )}
            <div
              className="skeleton-line"
              style={{ width: `${60 + (idx % 3) * 12}%`, height: "16px", borderRadius: "4px" }}
            />
          </div>
          {Array.from({ length: Math.max(1, lines - 1) }).map((__, lIdx) => (
            <div
              key={`sk-card-line-${idx}-${lIdx}`}
              className="skeleton-line"
              style={{
                width: lIdx === lines - 2 ? "48%" : `${75 + ((idx + lIdx) % 2) * 15}%`,
                height: "12px",
                borderRadius: "4px",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export interface DetailSkeletonProps {
  stripCount?: number;
  rows?: number;
  dark?: boolean;
}

export function DetailSkeleton({
  stripCount = 6,
  rows = 5,
  dark = false,
}: DetailSkeletonProps) {
  const cardBg = dark ? "rgba(255, 255, 255, 0.08)" : "#ffffff";
  const borderCol = dark ? "rgba(255, 255, 255, 0.14)" : "#e2e8f0";
  const shimmerStyle: React.CSSProperties = dark
    ? { opacity: 0.25, borderRadius: "4px" }
    : { borderRadius: "4px" };

  return (
    <div
      data-testid="skeleton-detail"
      aria-hidden="true"
      style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "16px" }}
    >
      <div
        style={{
          background: cardBg,
          border: `1px solid ${borderCol}`,
          borderRadius: "10px",
          padding: "16px 20px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "14px",
        }}
      >
        {Array.from({ length: stripCount }).map((_, i) => (
          <div key={`sk-strip-${i}`} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div className="skeleton-line" style={{ ...shimmerStyle, width: "55%", height: "11px" }} />
            <div className="skeleton-line" style={{ ...shimmerStyle, width: "85%", height: "15px" }} />
          </div>
        ))}
      </div>

      <div
        style={{
          background: cardBg,
          border: `1px solid ${borderCol}`,
          borderRadius: "10px",
          padding: "18px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <div className="skeleton-line" style={{ ...shimmerStyle, width: "32%", height: "18px" }} />
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={`sk-detail-row-${r}`}
            className="skeleton-line"
            style={{
              ...shimmerStyle,
              width: `${92 - (r % 3) * 11}%`,
              height: "14px",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export interface InlineListSkeletonProps {
  count?: number;
  showAvatar?: boolean;
  compact?: boolean;
}

export function InlineListSkeleton({
  count = 4,
  showAvatar = false,
  compact = false,
}: InlineListSkeletonProps) {
  return (
    <div
      data-testid="skeleton-inline-list"
      aria-hidden="true"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: compact ? "8px" : "12px",
        padding: compact ? "8px 10px" : "10px 4px",
      }}
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div key={`sk-list-${idx}`} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {showAvatar && (
            <div
              className="skeleton-circle"
              style={{ width: compact ? "24px" : "30px", height: compact ? "24px" : "30px", flexShrink: 0 }}
            />
          )}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "5px" }}>
            <div
              className="skeleton-line"
              style={{ width: `${65 + (idx % 3) * 12}%`, height: compact ? "12px" : "14px", borderRadius: "4px" }}
            />
            {!compact && (
              <div
                className="skeleton-line"
                style={{ width: `${40 + (idx % 2) * 18}%`, height: "10px", borderRadius: "4px" }}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function InlineTextSkeleton({
  width = 76,
  height = 14,
}: {
  width?: number | string;
  height?: number | string;
}) {
  return (
    <span
      className="skeleton-line"
      aria-hidden="true"
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        width,
        height,
        borderRadius: "4px",
      }}
    />
  );
}
