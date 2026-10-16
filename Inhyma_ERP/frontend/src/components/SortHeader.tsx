import React from "react";

export interface SortIndicatorProps {
  isSorted: boolean;
  sortDirection?: "asc" | "desc";
  style?: React.CSSProperties;
}

export function SortIndicator({ isSorted, sortDirection = "asc", style }: SortIndicatorProps) {
  if (isSorted) {
    return (
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#0284c7",
          fontSize: "10px",
          fontWeight: 800,
          background: "#e0f2fe",
          padding: "1px 4px",
          borderRadius: "3px",
          border: "1px solid #bae6fd",
          lineHeight: 1,
          flexShrink: 0,
          ...style,
        }}
      >
        {sortDirection === "asc" ? "▲" : "▼"}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        fontSize: "10px",
        color: "#94a3b8",
        opacity: 0.45,
        lineHeight: 1,
        flexShrink: 0,
        ...style,
      }}
    >
      ↕
    </span>
  );
}

export interface SortHeaderProps {
  label: React.ReactNode;
  isSorted: boolean;
  sortDirection?: "asc" | "desc";
  onSort: () => void;
  align?: "left" | "center" | "right";
  style?: React.CSSProperties;
  title?: string;
}

export function SortHeader({
  label,
  isSorted,
  sortDirection = "asc",
  onSort,
  align = "left",
  style,
  title,
}: SortHeaderProps) {
  const defaultTitle = isSorted
    ? `Sorted (${sortDirection === "asc" ? "Ascending — click for Descending" : "Descending — click to reset"})`
    : `Click to sort (Ascending)`;

  return (
    <div
      onClick={onSort}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
        gap: "5px",
        cursor: "pointer",
        userSelect: "none",
        minWidth: 0,
        padding: "2px 0",
        ...style,
      }}
      title={title || defaultTitle}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <SortIndicator isSorted={isSorted} sortDirection={sortDirection} />
    </div>
  );
}
