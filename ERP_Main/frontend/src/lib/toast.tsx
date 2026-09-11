/**
 * Global Toast Notifications for ERP_Main Control Plane.
 *
 * Adapts the exact same toast notification system used across
 * Yinglima and Inhyma ERPs.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastType = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  visible: boolean;
}

type ShowToast = (message: string, type?: ToastType, duration?: number) => void;

const ToastContext = createContext<ShowToast>(() => {
  /* no-op until provider mounts */
});

function iconFor(type: ToastType): string {
  return type === "success" ? "✓ " : type === "error" ? "✕ " : "ℹ ";
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    []
  );

  const showToast = useCallback<ShowToast>((message, type = "info", duration = 3500) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, type, visible: false }]);

    requestAnimationFrame(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, visible: true } : t)));
    });

    const hideTimer = setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, visible: false } : t)));
      const removeTimer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 300);
      timers.current.push(removeTimer);
    }, duration);
    timers.current.push(hideTimer);
  }, []);

  const value = useMemo(() => showToast, [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.type}${t.visible ? " toast-visible" : ""}`}
          >
            {iconFor(t.type)}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  return useContext(ToastContext);
}
