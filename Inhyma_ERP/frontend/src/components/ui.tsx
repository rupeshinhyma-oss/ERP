/**
 * Small shared UI primitives.
 *
 * These replace imperative helpers from the original api.js / masters-common.js
 * (showError(), openModalShell()/closeModalShell(), MasterPage.badge()) with
 * declarative components. The rendered markup and class names are unchanged.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { isAbortError, errorMessage } from "@/lib/api";
import { useAuth, useBodyScrollLock } from "@/lib/hooks";
import { useToast } from "@/lib/toast";

/* ------------------------------------------------------------------ */
/* Banners -> Floating Toast Notifications Standard                   */
/* ------------------------------------------------------------------ */

/**
 * Error notification component. Automatically dispatches a top-right floating
 * toast notification. Never renders a disruptive static block in the page layout.
 */
export function ErrorBanner({ error }: { error: unknown }) {
  const showToast = useToast();
  const lastErrorRef = useRef<unknown>(null);

  useEffect(() => {
    if (!error || isAbortError(error)) return;
    if (error !== lastErrorRef.current) {
      lastErrorRef.current = error;
      showToast(errorMessage(error), "error");
    }
  }, [error, showToast]);

  if (!error || isAbortError(error)) return null;
  return (
    <div
      className="error-banner"
      role="alert"
      style={{
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: 0,
        margin: "-1px",
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      {errorMessage(error)}
    </div>
  );
}

/**
 * Success notification component. Automatically dispatches a top-right floating
 * toast notification matching Department CRM standard.
 */
export function SuccessBanner({ message }: { message?: string | null }) {
  const showToast = useToast();
  const lastMsgRef = useRef<string | null>(null);

  useEffect(() => {
    if (!message) return;
    if (message !== lastMsgRef.current) {
      lastMsgRef.current = message;
      showToast(message, "success");
    }
  }, [message, showToast]);

  if (!message) return null;
  return (
    <div
      className="success-banner"
      role="status"
      style={{
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: 0,
        margin: "-1px",
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      {message}
    </div>
  );
}

/**
 * Universal feedback banner slot. Routes errors and successes directly to the
 * top-right floating toast notification engine instead of rendering disruptive
 * in-page static green/red banners.
 */
export function Banner({
  error,
  success,
}: {
  error?: unknown;
  success?: string | null;
}) {
  return (
    <>
      <ErrorBanner error={error} />
      {!error && <SuccessBanner message={success} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Badges                                                             */
/* ------------------------------------------------------------------ */

/** active/inactive/suspended/locked status pill */
export function StatusBadge({ status, isActive }: { status?: string; isActive?: boolean }) {
  const s = (status || "").toLowerCase();
  let cls = "badge-inactive";
  let display = status || "Inactive";
  if (s === "active" || (isActive === true && !s)) {
    cls = "badge-active";
    display = "Active";
  } else if (s === "suspended") {
    cls = "badge-danger";
    display = "Suspended";
  } else if (s === "locked") {
    cls = "badge-warning";
    display = "Locked";
  } else if (s === "pending") {
    cls = "badge-info";
    display = "Pending";
  } else if (s === "password_change_required") {
    cls = "badge-warning";
    display = "Password Change Req.";
  } else if (s === "inactive" || isActive === false) {
    cls = "badge-inactive";
    display = "Inactive";
  }
  return <span className={`badge ${cls}`}>{display}</span>;
}

export { StatusToggle, type StatusToggleProps } from "./StatusToggle";

/* ------------------------------------------------------------------ */
/* Modal                                                              */
/* ------------------------------------------------------------------ */

export interface ModalProps {
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** "drawer" (right slide-over panel, default) or "center" (centered dialog modal) */
  variant?: "drawer" | "center";
  /** Extra classes for the .modal-card element (e.g. import-wizard-card). */
  cardClassName?: string;
  /** Inline overrides some pages applied, e.g. max-width: 820px. */
  cardStyle?: React.CSSProperties;
  /** Set false to suppress the default header (Audit detail supplies its own). */
  showHeader?: boolean;
  /** Disables the X button and backdrop dismissal while an action is running. */
  locked?: boolean;
  /** Extra classes for the backdrop (import wizard uses iw-locked). */
  backdropClassName?: string;
}

/**
 * The `.modal-backdrop > .modal-card` shell used by pages.
 * Supports both right offcanvas drawers ("drawer") and centered dialog popups ("center").
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  variant = "drawer",
  cardClassName = "",
  cardStyle,
  showHeader = true,
  locked = false,
  backdropClassName = "",
}: ModalProps) {
  useBodyScrollLock(open);

  if (!open) return null;

  const isCenter = variant === "center";
  const finalBackdropClass = `modal-backdrop ${isCenter ? "modal-centered-backdrop" : ""} ${backdropClassName}`.trim();
  const finalCardClass = `modal-card ${isCenter ? "modal-dialog-card" : ""} ${cardClassName}`.trim();

  return (
    <div
      className={finalBackdropClass}
      style={isCenter ? { display: "flex", justifyContent: "center", alignItems: "center", padding: "20px" } : { display: "flex" }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !locked) onClose();
      }}
    >
      <div className={finalCardClass} style={cardStyle}>
        {showHeader && (
          <div className="modal-header">
            <h2>{title}</h2>
            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              disabled={locked}
            >
              &times;
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Permission gate                                                    */
/* ------------------------------------------------------------------ */

/**
 * Renders children only if the permission is held.
 *
 * The original marked controls with `data-permission="..."` and then removed
 * or hid them in a post-render sweep (Auth.applyPermissionVisibility). Gating
 * at render time gets the same result without the flash of a control that is
 * about to be pulled, and it re-evaluates automatically when permissions
 * change because it reads from the Auth store.
 */
export function Can({
  permission,
  superAdminOnly = false,
  children,
}: {
  permission?: string | null;
  superAdminOnly?: boolean;
  children: ReactNode;
}) {
  const { hasPermission, isSuperAdmin } = useAuth();
  if (superAdminOnly && !isSuperAdmin) return null;
  if (!hasPermission(permission)) return null;
  return <>{children}</>;
}

/* ------------------------------------------------------------------ */
/* Table & Skeleton helpers                                           */
/* ------------------------------------------------------------------ */

/** Full-width muted message row used for loading / empty states. */
export function TableMessageRow({
  colSpan,
  children,
  className = "",
  style,
}: {
  colSpan: number;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className={`muted ${className}`.trim()}
        style={{
          textAlign: "center",
          padding: "36px 16px",
          color: "#64748b",
          fontSize: "14px",
          ...style,
        }}
      >
        {children ?? "No Data"}
      </td>
    </tr>
  );
}

export function SkeletonLine({
  width = "100%",
  height = "14px",
  style,
  className = "",
}: {
  width?: string | number;
  height?: string | number;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={`skeleton-line ${className}`.trim()}
      style={{ width, height, ...style }}
    />
  );
}

export function SkeletonCircle({
  size = 32,
  style,
  className = "",
}: {
  size?: number | string;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={`skeleton-circle ${className}`.trim()}
      style={{ width: size, height: size, minWidth: size, minHeight: size, ...style }}
    />
  );
}

export function SkeletonBox({
  width = "100%",
  height = "100%",
  style,
  className = "",
}: {
  width?: string | number;
  height?: string | number;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={`skeleton-box ${className}`.trim()}
      style={{ width, height, ...style }}
    />
  );
}

export function SkeletonBadge({
  width = "60px",
  height = "20px",
  style,
  className = "",
}: {
  width?: string | number;
  height?: string | number;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={`skeleton-badge ${className}`.trim()}
      style={{ width, height, ...style }}
    />
  );
}

export function SkeletonTableRows({
  count = 6,
  colSpan = 6,
  cellHeights = "14px",
  cellWidths = ["30%", "70%", "50%", "40%", "60%", "35%"],
}: {
  count?: number;
  colSpan?: number;
  cellHeights?: string;
  cellWidths?: string[];
}) {
  return (
    <>
      {Array.from({ length: count }).map((_, rIdx) => (
        <tr key={`sk-row-${rIdx}`}>
          {Array.from({ length: colSpan }).map((_, cIdx) => (
            <td key={`sk-cell-${rIdx}-${cIdx}`} style={{ padding: "12px 14px" }}>
              <div
                className="skeleton-line"
                style={{
                  height: cellHeights,
                  width: cellWidths[(rIdx + cIdx) % cellWidths.length],
                }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Em dash placeholder, matching the original `value || "—"` pattern. */
export function dash(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

/* ------------------------------------------------------------------ */
/* Custom ERP Modal Popup Alert                                       */
/* ------------------------------------------------------------------ */

export function ModalAlert({
  isOpen,
  title = "Validation Error",
  message,
  onClose,
}: {
  isOpen: boolean;
  title?: string;
  message: string;
  onClose: () => void;
}) {
  useBodyScrollLock(isOpen);
  if (!isOpen || !message) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 99999,
        background: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "440px",
          padding: "28px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.3)",
          border: "1px solid #e2e8f0",
          textAlign: "center",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            background: "#fef2f2",
            border: "1px solid #fee2e2",
            color: "#dc2626",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "26px",
            margin: "0 auto 16px auto",
          }}
        >
          ⚠️
        </div>
        <h3 style={{ fontSize: "19px", fontWeight: 700, color: "#0f172a", margin: "0 0 10px 0" }}>
          {title}
        </h3>
        <div
          style={{
            fontSize: "13.5px",
            color: "#334155",
            lineHeight: 1.6,
            margin: "0 0 24px 0",
            padding: "14px 16px",
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: "10px",
            maxHeight: "260px",
            overflowY: "auto",
            overflowX: "auto",
            wordBreak: "break-word",
            overflowWrap: "anywhere",
            textAlign: message.includes("\n") || message.length > 50 ? "left" : "center",
            whiteSpace: "pre-wrap",
          }}
        >
          {message}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            padding: "12px 20px",
            background: "#0061f2",
            color: "#ffffff",
            fontWeight: 700,
            fontSize: "14px",
            borderRadius: "8px",
            border: "none",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0, 97, 242, 0.25)",
            transition: "all 0.15s ease",
          }}
        >
          OK, GOT IT
        </button>
      </div>
    </div>
  );
}
