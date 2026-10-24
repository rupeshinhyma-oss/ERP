/**
 * Global in-app Confirmation Dialog Provider & Hook.
 *
 * Replaces unstyled native browser `window.confirm()` popups with a beautiful,
 * modern white card confirmation modal matching the ERP's design system.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useBodyScrollLock } from "./hooks";

export interface ConfirmOptions {
  title?: string;
  message?: ReactNode;
  itemName?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "primary";
}

type ConfirmFunction = (options: string | ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFunction>(async () => false);

export function useConfirm(): ConfirmFunction {
  return useContext(ConfirmContext);
}

interface DialogState {
  title: string;
  message: ReactNode;
  itemName?: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: "danger" | "warning" | "primary";
  resolve: (value: boolean) => void;
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  useBodyScrollLock(Boolean(dialog));

  // Escape key cancels dialog, Enter key confirms dialog
  useEffect(() => {
    if (!dialog) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        dialog?.resolve(false);
        setDialog(null);
      } else if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        e.preventDefault();
        dialog?.resolve(true);
        setDialog(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dialog]);

  const confirm = useCallback<ConfirmFunction>((opts) => {
    return new Promise<boolean>((resolve) => {
      const options: ConfirmOptions = typeof opts === "string" ? { message: opts } : opts;
      setDialog({
        title: options.title || "Delete Confirmation",
        message: options.message || "Are you sure you want to proceed with this deletion?",
        itemName: options.itemName,
        confirmLabel: options.confirmLabel || "Delete",
        cancelLabel: options.cancelLabel || "Cancel",
        variant: options.variant || "danger",
        resolve,
      });
    });
  }, []);

  const handleConfirm = () => {
    dialog?.resolve(true);
    setDialog(null);
  };

  const handleCancel = () => {
    dialog?.resolve(false);
    setDialog(null);
  };

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {dialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999999,
            backgroundColor: "rgba(15, 23, 42, 0.55)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            animation: "fadeIn 0.15s ease-out",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCancel();
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "16px",
              maxWidth: "440px",
              width: "100%",
              boxShadow:
                "0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
              border: "1px solid #f1f5f9",
              overflow: "hidden",
              textAlign: "center",
              padding: "28px 24px 20px 24px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Icon Badge */}
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                backgroundColor:
                  dialog.variant === "danger"
                    ? "#fee2e2"
                    : dialog.variant === "warning"
                    ? "#fef3c7"
                    : "#dbeafe",
                color:
                  dialog.variant === "danger"
                    ? "#dc2626"
                    : dialog.variant === "warning"
                    ? "#d97706"
                    : "#2563eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "16px",
                flexShrink: 0,
              }}
            >
              {dialog.variant === "danger" ? (
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              ) : dialog.variant === "warning" ? (
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              ) : (
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              )}
            </div>

            {/* Title */}
            <h3
              id="confirm-dialog-title"
              style={{
                fontSize: "19px",
                fontWeight: 700,
                color: "#0f172a",
                margin: "0 0 8px 0",
              }}
            >
              {dialog.title}
            </h3>

            {/* Optional Item Highlight Pill */}
            {dialog.itemName && (
              <div
                style={{
                  display: "inline-block",
                  backgroundColor: "#f1f5f9",
                  padding: "4px 12px",
                  borderRadius: "6px",
                  fontWeight: 700,
                  fontSize: "13px",
                  color: "#334155",
                  border: "1px solid #e2e8f0",
                  marginBottom: "12px",
                  maxWidth: "90%",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                }}
              >
                {dialog.itemName}
              </div>
            )}

            {/* Message */}
            <p
              style={{
                fontSize: "14px",
                color: "#64748b",
                lineHeight: "1.55",
                margin: "0 0 24px 0",
                padding: "0 8px",
              }}
            >
              {dialog.message}
            </p>

            {/* Footer Buttons */}
            <div
              style={{
                display: "flex",
                gap: "12px",
                width: "100%",
                borderTop: "1px solid #f1f5f9",
                paddingTop: "16px",
              }}
            >
              <button
                type="button"
                onClick={handleCancel}
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#ffffff",
                  color: "#475569",
                  fontWeight: 600,
                  fontSize: "14px",
                  cursor: "pointer",
                  transition: "background-color 0.15s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f8fafc")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#ffffff")}
              >
                {dialog.cancelLabel}
              </button>

              <button
                type="button"
                onClick={handleConfirm}
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor:
                    dialog.variant === "danger"
                      ? "#dc2626"
                      : dialog.variant === "warning"
                      ? "#f59e0b"
                      : "#2563eb",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: "14px",
                  cursor: "pointer",
                  boxShadow:
                    dialog.variant === "danger"
                      ? "0 2px 4px rgba(220, 38, 38, 0.25)"
                      : dialog.variant === "warning"
                      ? "0 2px 4px rgba(245, 158, 11, 0.25)"
                      : "0 2px 4px rgba(37, 99, 235, 0.25)",
                  transition: "background-color 0.15s ease",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor =
                    dialog.variant === "danger"
                      ? "#b91c1c"
                      : dialog.variant === "warning"
                      ? "#d97706"
                      : "#1d4ed8")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor =
                    dialog.variant === "danger"
                      ? "#dc2626"
                      : dialog.variant === "warning"
                      ? "#f59e0b"
                      : "#2563eb")
                }
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
