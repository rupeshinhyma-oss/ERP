/**
 * Shared UI Primitives for ERP_Main Control Plane.
 *
 * Implements StatusBadge, Banners, Modals, Loading Spinners, Skeletons,
 * and Empty States matching Yinglima/Inhyma ERP styles.
 */

import { type CSSProperties, type ReactNode } from "react";
import { isAbortError, errorMessage } from "@/lib/api";
import { useBodyScrollLock } from "@/lib/hooks";
import { IconAlertTriangle, IconX } from "./icons";

/* ------------------------------------------------------------------ */
/* Banners                                                            */
/* ------------------------------------------------------------------ */

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error || isAbortError(error)) return null;
  return <div className="error-banner">{errorMessage(error)}</div>;
}

export function SuccessBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return <div className="success-banner">{message}</div>;
}

export function Banner({
  error,
  success,
}: {
  error?: unknown;
  success?: string | null;
}) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <ErrorBanner error={error} />
      {!error && <SuccessBanner message={success} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Badges                                                             */
/* ------------------------------------------------------------------ */

export function StatusBadge({ status, isActive }: { status?: string | null; isActive?: boolean }) {
  const s = (status || "").toUpperCase();
  let cls = "badge-inactive";
  let display = status || "Inactive";

  if (s === "ACTIVE" || s === "ROUTED" || s === "MATCHED" || s === "AVAILABLE" || (isActive === true && !s)) {
    cls = "badge-active";
    display = s === "ROUTED" ? "Routed" : s === "MATCHED" ? "Matched" : s === "AVAILABLE" ? "Available" : "Active";
  } else if (s === "SUSPENDED" || s === "DEAD_LETTERED" || s === "DEAD_LETTER" || s === "FAILED") {
    cls = "badge-danger";
    display = s === "DEAD_LETTERED" || s === "DEAD_LETTER" ? "Dead Letter" : s === "FAILED" ? "Failed" : "Suspended";
  } else if (s === "DECOMMISSIONED" || s === "REVOKED" || s === "IGNORED" || s === "UNKNOWN" || s === "NOT_YET_SUPPORTED") {
    cls = "badge-neutral";
    display = s === "DECOMMISSIONED" ? "Decommissioned" : s === "REVOKED" ? "Revoked" : s === "IGNORED" ? "Ignored" : s === "NOT_YET_SUPPORTED" ? "Not Yet Supported" : "Unknown";
  } else if (s === "PENDING" || s === "PROCESSING" || s === "RUNNING" || s === "RECEIVED" || s === "STALE" || s === "RECONCILIATION_REQUIRED") {
    cls = "badge-warning";
    display = s === "PROCESSING" || s === "RUNNING" ? "Processing" : s === "RECEIVED" ? "Received" : s === "STALE" ? "Stale" : s === "RECONCILIATION_REQUIRED" ? "Reconcile Req" : "Pending";
  } else if (s === "RESOLVED" || s === "PUBLISHED" || s === "PROCESSED" || s === "COMPLETED" || s === "HEALTHY") {
    cls = "badge-active";
    display = s === "PUBLISHED" ? "Published" : s === "PROCESSED" ? "Processed" : s === "COMPLETED" ? "Completed" : s === "HEALTHY" ? "Healthy" : "Resolved";
  } else if (s === "CONFLICT" || s === "AMBIGUOUS_MATCH") {
    cls = "badge-danger";
    display = s === "AMBIGUOUS_MATCH" ? "Ambiguous Match" : "Conflict";
  } else if (s === "INACTIVE" || isActive === false) {
    cls = "badge-inactive";
    display = "Inactive";
  }

  return <span className={`badge ${cls}`}>{display}</span>;
}

/* ------------------------------------------------------------------ */
/* Modal / Drawer                                                     */
/* ------------------------------------------------------------------ */

export interface ModalProps {
  open?: boolean;
  isOpen?: boolean;
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  variant?: "drawer" | "center";
  cardClassName?: string;
  cardStyle?: CSSProperties;
  showHeader?: boolean;
  locked?: boolean;
}

export function Modal({
  open,
  isOpen,
  title,
  onClose,
  children,
  variant = "drawer",
  cardClassName = "",
  cardStyle,
  showHeader = true,
  locked = false,
}: ModalProps) {
  const isModalOpen = Boolean(open ?? isOpen);
  useBodyScrollLock(isModalOpen);

  if (!isModalOpen) return null;

  return (
    <div
      className={`modal-backdrop ${variant === "center" ? "modal-backdrop-center" : ""}`}
      onClick={(e) => {
        if (!locked && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={`modal-card ${variant === "center" ? "modal-card-center" : "modal-card-drawer"} ${cardClassName}`}
        style={cardStyle}
      >
        {showHeader && (
          <div className="modal-header">
            <h3 className="modal-title">{title}</h3>
            {!locked && (
              <button
                type="button"
                className="icon-btn"
                onClick={onClose}
                aria-label="Close dialog"
                style={{ cursor: "pointer" }}
              >
                <IconX width={18} height={18} />
              </button>
            )}
          </div>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confirm Dialog                                                     */
/* ------------------------------------------------------------------ */

export function ConfirmDialog({
  open,
  title = "Are you sure?",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  danger = false,
  loading = false,
}: {
  open: boolean;
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onCancel} variant="center" title={title} locked={loading} cardStyle={{ maxWidth: "440px" }}>
      <div style={{ marginBottom: "20px", color: "var(--color-text-secondary)", fontSize: "14px", lineHeight: 1.5 }}>
        {message}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? "Processing..." : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Loading States & Skeletons                                         */
/* ------------------------------------------------------------------ */

export function LoadingSpinner({ text = "Loading..." }: { text?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 0" }}>
      <div className="spinner" style={{ width: "32px", height: "32px", marginBottom: "12px" }} />
      <span style={{ color: "var(--color-muted)", fontSize: "14px" }}>{text}</span>
    </div>
  );
}

export {
  SkeletonLine,
  SkeletonCircle,
  SkeletonBox,
  SkeletonStatCard,
  SkeletonStatGrid,
  SkeletonFleetCard,
  SkeletonFleetGrid,
  SkeletonTable,
  SkeletonTabs,
  SkeletonDashboard,
  SkeletonPage,
} from "./Skeleton";


/* ------------------------------------------------------------------ */
/* Empty State                                                        */
/* ------------------------------------------------------------------ */

export function EmptyState({
  title = "No records found",
  description,
  icon,
  action,
}: {
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state" style={{ textAlign: "center", padding: "48px 24px" }}>
      <div style={{ fontSize: "36px", color: "var(--color-muted)", marginBottom: "12px" }}>
        {icon || <IconAlertTriangle width={40} height={40} style={{ margin: "0 auto", opacity: 0.6 }} />}
      </div>
      <h3 style={{ margin: "0 0 6px", fontSize: "16px", fontWeight: 700, color: "var(--color-text)" }}>
        {title}
      </h3>
      {description && (
        <p style={{ margin: "0 0 16px", color: "var(--color-muted)", fontSize: "13px", maxWidth: "420px", marginLeft: "auto", marginRight: "auto" }}>
          {description}
        </p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
}
