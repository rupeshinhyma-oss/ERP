import React from "react";

export interface StatusToggleProps {
  /** Whether the status is currently active */
  checked: boolean;
  /** Callback fired when user clicks the toggle switch, receives the new state */
  onChange?: (nextChecked: boolean) => void;
  /** If true, interaction is blocked (e.g. user lacks update permissions) */
  disabled?: boolean;
  /** If true, a network action is pending (prevents re-clicking, shows subtle loading ring) */
  loading?: boolean;
  /** Optional custom tooltip */
  title?: string;
  /** Optional accessibility ID */
  id?: string;
  /** Optional custom class name */
  className?: string;
  /** Optional inline styles */
  style?: React.CSSProperties;
}

export function StatusToggle({
  checked,
  onChange,
  disabled = false,
  loading = false,
  title,
  id,
  className = "",
  style = {},
}: StatusToggleProps) {
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (disabled || loading || !onChange) return;
    onChange(!checked);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.stopPropagation();
      e.preventDefault();
      if (disabled || loading || !onChange) return;
      onChange(!checked);
    }
  };

  const defaultTitle = disabled
    ? "You do not have permission to modify this status."
    : loading
    ? "Updating status..."
    : checked
    ? "Active — Click to deactivate"
    : "Inactive — Click to activate";

  return (
    <div
      className={`status-toggle-wrapper ${className}`.trim()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        verticalAlign: "middle",
        userSelect: "none",
        ...style,
      }}
    >
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={checked ? "Active status toggle" : "Inactive status toggle"}
        title={title ?? defaultTitle}
        disabled={disabled || loading}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={`status-toggle-btn ${checked ? "is-active" : "is-inactive"} ${
          loading ? "is-loading" : ""
        }`}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          width: "42px",
          height: "22px",
          minWidth: "42px",
          maxWidth: "42px",
          padding: 0,
          borderRadius: "9999px",
          border: "none",
          outline: "none",
          cursor: disabled ? "not-allowed" : loading ? "wait" : "pointer",
          backgroundColor: checked ? "#10b981" : "#cbd5e1",
          boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.08)",
          transition:
            "background-color 0.22s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s ease, opacity 0.2s ease",
          opacity: disabled ? 0.55 : 1,
        }}
      >
        <span
          className="status-toggle-thumb"
          style={{
            position: "absolute",
            top: "3px",
            left: "3px",
            width: "16px",
            height: "16px",
            borderRadius: "50%",
            backgroundColor: "#ffffff",
            boxShadow:
              "0 1px 3px rgba(0, 0, 0, 0.2), 0 1px 2px rgba(0, 0, 0, 0.12)",
            transform: checked ? "translateX(20px)" : "translateX(0px)",
            transition: "transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {loading && (
            <span
              style={{
                width: "9px",
                height: "9px",
                borderRadius: "50%",
                border: `1.5px solid ${checked ? "#a7f3d0" : "#94a3b8"}`,
                borderTopColor: checked ? "#059669" : "#475569",
                animation: "status-toggle-spin 0.6s linear infinite",
              }}
            />
          )}
        </span>
      </button>
    </div>
  );
}
