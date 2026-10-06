import React, { useEffect } from "react";

export interface PayrollDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  category?: string;
  width?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onSubmit?: (e: React.FormEvent) => void;
  headerRight?: React.ReactNode;
  bodyStyle?: React.CSSProperties;
}

/**
 * Standardized Right-Side Offcanvas Drawer for all HRMS Payroll operations.
 * Enforces consistent width, fixed right positioning, full viewport height,
 * non-intrusive backdrop, scrollable body, and fixed pinned footer across:
 * - Setup (Add / Edit Earning & Deduction)
 * - Salary (Configure / Edit Employee Salary)
 * - Monthly Payroll (View Details & Edit Corrections)
 * - Administrative Actions (Reopen Payroll, etc.)
 */
export function PayrollDrawer({
  isOpen,
  onClose,
  title,
  subtitle,
  category,
  width = "480px",
  children,
  footer,
  onSubmit,
  headerRight,
  bodyStyle,
}: PayrollDrawerProps) {
  // Lock body scroll when drawer is open
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const content = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Drawer Header */}
      <div
        style={{
          flexShrink: 0,
          padding: "18px 24px",
          borderBottom: "1px solid #e2e8f0",
          background: "#ffffff",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "12px",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {category && (
            <div
              style={{
                fontSize: "11px",
                textTransform: "uppercase",
                fontWeight: 700,
                color: "#64748b",
                letterSpacing: "0.5px",
                marginBottom: "2px",
              }}
            >
              {category}
            </div>
          )}
          <h3
            style={{
              margin: 0,
              fontSize: "17px",
              fontWeight: 700,
              color: "#0f172a",
              lineHeight: 1.3,
            }}
          >
            {title}
          </h3>
          {subtitle && (
            <div
              style={{
                fontSize: "12px",
                color: "#64748b",
                marginTop: "3px",
                lineHeight: 1.4,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          {headerRight}
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={onClose}
            aria-label="Close drawer"
            style={{
              width: "32px",
              height: "32px",
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "15px",
              lineHeight: 1,
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Scrollable Body */}
      <div
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
          ...bodyStyle,
        }}
      >
        {children}
      </div>

      {/* Pinned Fixed Footer */}
      {footer && (
        <div
          style={{
            flexShrink: 0,
            padding: "16px 24px",
            borderTop: "1px solid #e2e8f0",
            background: "#f8fafc",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: "10px",
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );

  return (
    <div
      className="payroll-drawer-backdrop"
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(2px)",
        zIndex: 2500,
        display: "flex",
        justifyContent: "flex-end",
        animation: "payrollBackdropFadeIn 0.2s ease-out",
      }}
    >
      <div
        className="payroll-drawer-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: width,
          maxWidth: "100vw",
          height: "100vh",
          background: "#ffffff",
          boxShadow: "-12px 0 32px rgba(15, 23, 42, 0.2)",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          animation: "payrollDrawerSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {onSubmit ? (
          <form
            onSubmit={onSubmit}
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              minHeight: 0,
              margin: 0,
            }}
          >
            {content}
          </form>
        ) : (
          content
        )}
      </div>
    </div>
  );
}
