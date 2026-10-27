/**
 * Shared sidebar + topbar shell.
 *
 * Ported from renderShell() in nav.js. Each page renders
 * `<AppShell activeKey="masters-countries">…</AppShell>`, mirroring the old
 * `renderShell('masters-countries')` call, and gets:
 *
 *  - the login guard,
 *  - a background /auth/profile sync that refreshes cached permissions,
 *  - the forced password-change modal,
 *  - the page-level access check that bounces to /403 with the module name,
 *  - the permission-filtered sidebar (groups with no visible items disappear),
 *  - the topbar with its notification bell and logout button,
 *  - document.title kept as "<Page> — <Company>".
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { API_BASE, apiGet, apiPost } from "@/lib/api";
import { Auth, initials, roleLabel } from "@/lib/auth";
import { useAuth } from "@/lib/hooks";
import {
  NAV_ITEMS_BY_KEY,
  NAV_SECTIONS,
  PAGE_TITLES,
  DEFAULT_BRAND_NAME,
} from "@/lib/nav";
import {
  getCachedBrandLogo,
  getCachedBrandName,
  resolveBrandInfo,
  resolveImageUrl,
  subscribeBrandLogo,
  subscribeBrandName,
} from "@/lib/brand";
import { ICONS, IconBell, IconChevronDown, IconChevronRight } from "./icons";
import { EcosystemSwitcher } from "./EcosystemSwitcher";
import { enforceCentralLanding, processIncomingSsoHandover } from "@/lib/ssoBridge";
import { globalEcosystemLogout, initEcosystemSessionWatcher, isExplicitlyLoggedOut } from "@/lib/ecosystemSession";
import { liveClient } from "@/lib/live/liveClient";
import { userChannel, type LiveEvent } from "@/lib/live/liveEvent";

import { ErrorBanner } from "./ui";
import type { Profile } from "@/types";

const NAV_SCROLL_KEY = "erp_sidebar_nav_scroll";

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Notifications                                                      */
/* ------------------------------------------------------------------ */

export interface NotificationItem {
  id: string;
  user_id: string;
  sender_id?: string | null;
  type: string;
  module?: string | null;
  title: string;
  message: string;
  link?: string | null;
  is_read: boolean;
  created_at: string;
}

export interface NotificationApiResponse {
  items?: NotificationItem[];
  data?: NotificationItem[];
  unread_count?: number;
}

function formatRelativeTime(dateStr: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return "";
  }
}

function getNotificationIcon(type: string, module?: string | null): string {
  if (type === "shipment_requirement_raised") return "📦";
  if (type === "shipment_status_ordered") return "🔵";
  if (type === "sale_process_created" || module === "sales") return "💼";
  if (type === "local_purchase_created" || module === "purchases") return "🛒";
  if (type === "inquiry_created" || module === "inquiries") return "📩";
  return "🔔";
}

function cleanNotificationTitle(text: string): string {
  if (!text) return "";
  return text.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, "").trim();
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const seenNotifIdsRef = useRef<Set<string>>(new Set());
  const navigate = useNavigate();
  const { profile } = useAuth();
  const userId = profile?.id;

  // Periodic poll for unread notification count
  const pollUnreadCount = useCallback(async () => {
    try {
      const res = await apiGet<{ unread_count: number }>("/notifications/unread-count");
      if (res && res.data && typeof res.data.unread_count === "number") {
        setUnreadCount(res.data.unread_count);
      }
    } catch {
      /* ignore background poll errors */
    }
  }, []);

  useEffect(() => {
    void pollUnreadCount();
    const interval = setInterval(pollUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [pollUnreadCount]);

  // Load full notification list when opened
  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<NotificationItem[] | NotificationApiResponse>("/notifications?limit=30");
      let list: NotificationItem[] = [];
      if (Array.isArray(res.data)) {
        list = res.data;
      } else if (res.data && typeof res.data === "object") {
        if (Array.isArray(res.data.items)) {
          list = res.data.items;
        } else if (Array.isArray(res.data.data)) {
          list = res.data.data;
        }
        if (typeof res.data.unread_count === "number") {
          setUnreadCount(res.data.unread_count);
        }
      }
      list.forEach((item) => {
        if (item?.id) {
          seenNotifIdsRef.current.add(String(item.id));
        }
      });
      setNotifications(list);
    } catch {
      /* best effort -- do not crash, keep UI usable */
    } finally {
      setLoading(false);
    }
  }, []);

  // Live WebSocket subscription per authenticated user
  useEffect(() => {
    if (!userId) {
      seenNotifIdsRef.current.clear();
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    const channel = userChannel(userId);
    liveClient.subscribe(channel);

    const unsubscribe = liveClient.onEvent((event: LiveEvent) => {
      try {
        if (!event || event.event_type !== "NOTIFICATION_RECEIVED") return;
        const changes = (event.changes && typeof event.changes === "object") ? event.changes : {};
        const notifId = String(changes.id || event.entity_id || "");
        if (!notifId) return;

        // Prevent duplicate addition and duplicate unread count increments
        if (seenNotifIdsRef.current.has(notifId)) {
          return;
        }
        seenNotifIdsRef.current.add(notifId);

        const newNotif: NotificationItem = {
          id: notifId,
          user_id: userId,
          type: typeof changes.type === "string" ? changes.type : "notification",
          title: typeof changes.title === "string" ? changes.title : "Notification",
          message: typeof changes.message === "string" ? changes.message : "",
          link: typeof changes.link === "string" ? changes.link : null,
          is_read: false,
          created_at: typeof changes.created_at === "string" ? changes.created_at : new Date().toISOString(),
        };

        setNotifications((prev) => {
          if (prev.some((n) => n.id === newNotif.id)) {
            return prev;
          }
          return [newNotif, ...prev];
        });

        setUnreadCount((c) => c + 1);
      } catch (err) {
        console.warn("[NotificationBell] Error handling live notification event:", err);
      }
    });

    return () => {
      liveClient.unsubscribe(channel);
      unsubscribe();
    };
  }, [userId]);

  useEffect(() => {
    if (open) {
      void loadNotifications();
      void pollUnreadCount();
    }
  }, [open, loadNotifications, pollUnreadCount]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  const handleMarkAllRead = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiPost("/notifications/read-all", {});
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {
      /* best effort */
    }
  };

  const handleItemClick = async (notif: NotificationItem) => {
    if (!notif.is_read) {
      try {
        await apiPost(`/notifications/${notif.id}/read`, {});
        setNotifications((prev) =>
          prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n))
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        /* best effort */
      }
    }
    setOpen(false);
    if (notif.link) {
      navigate(notif.link);
    }
  };

  return (
    <div style={{ position: "relative" }} ref={wrapperRef}>
      <button
        className="icon-btn"
        title="Notifications"
        style={{ position: "relative", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <IconBell />
        {unreadCount > 0 && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              position: "absolute",
              top: "-3px",
              right: "-3px",
              background: "#ef4444",
              color: "#ffffff",
              fontSize: "10.5px",
              fontWeight: 800,
              padding: "1px 5px",
              borderRadius: "10px",
              minWidth: "18px",
              height: "18px",
              boxShadow: "0 2px 5px rgba(239,68,68,0.4)",
              border: "2px solid #ffffff",
              lineHeight: 1,
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "42px",
            width: "380px",
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: "12px",
            boxShadow: "0 14px 34px rgba(0,0,0,0.18)",
            zIndex: 99999,
            overflow: "hidden",
            animation: "fadeIn 0.15s ease",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid #e2e8f0",
              fontWeight: 700,
              fontSize: "13.5px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "#f8fafc",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: "#1e293b" }}>Notifications</span>
              {unreadCount > 0 && (
                <span
                  style={{
                    fontSize: "11px",
                    background: "#fee2e2",
                    color: "#dc2626",
                    padding: "2px 8px",
                    fontWeight: 700,
                    borderRadius: "10px",
                  }}
                >
                  {unreadCount} unread
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                style={{
                  background: "none",
                  border: "none",
                  color: "#2563eb",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: "2px 6px",
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ maxHeight: "360px", overflowY: "auto" }}>
            {loading && notifications.length === 0 ? (
              <div style={{ padding: "28px", textAlign: "center", color: "#64748b", fontSize: "13px" }}>
                Loading alerts...
              </div>
            ) : notifications.length === 0 ? (
              <div style={{ padding: "36px 20px", textAlign: "center", color: "#64748b", fontSize: "13px" }}>
                <div style={{ fontSize: "28px", marginBottom: "8px" }}>🎉</div>
                <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "4px" }}>You're all caught up!</div>
                <div style={{ fontSize: "12px", color: "#94a3b8" }}>No unread notifications at the moment.</div>
              </div>
            ) : (
              notifications.map((n) => {
                const icon = getNotificationIcon(n.type, n.module);
                return (
                  <div
                    key={n.id}
                    onClick={() => void handleItemClick(n)}
                    style={{
                      padding: "12px 16px",
                      borderBottom: "1px solid #f1f5f9",
                      cursor: "pointer",
                      background: n.is_read ? "#ffffff" : "#f0f7ff",
                      transition: "background 0.15s ease",
                      display: "flex",
                      gap: "12px",
                      alignItems: "flex-start",
                      position: "relative",
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.background = n.is_read ? "#f8fafc" : "#e0f2fe";
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.background = n.is_read ? "#ffffff" : "#f0f7ff";
                    }}
                  >
                    <div
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "8px",
                        background: n.is_read ? "#f1f5f9" : "#eff6ff",
                        border: n.is_read ? "1px solid #e2e8f0" : "1px solid #bfdbfe",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "17px",
                        flexShrink: 0,
                      }}
                    >
                      {icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: n.is_read ? 600 : 700,
                          color: "#0f172a",
                          marginBottom: "2px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {cleanNotificationTitle(n.title)}
                        </span>
                        <span style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 400, flexShrink: 0, marginLeft: "8px" }}>
                          {formatRelativeTime(n.created_at)}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "#475569",
                          lineHeight: "1.4",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                        }}
                      >
                        {n.message}
                      </div>
                    </div>
                    {!n.is_read && (
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: "#2563eb",
                          flexShrink: 0,
                          marginTop: "6px",
                        }}
                        title="Unread"
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "10px 16px",
              background: "#f8fafc",
              borderTop: "1px solid #e2e8f0",
              textAlign: "center",
            }}
          >
            <Link
              to="/notification-settings"
              onClick={() => setOpen(false)}
              style={{
                fontSize: "12px",
                color: "#2563eb",
                fontWeight: 600,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              ⚙️ Configure Notification Rules & Alerts
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Forced password change                                             */
/* ------------------------------------------------------------------ */

function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ForcePasswordChangeModal({ onDone }: { onDone: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #cbd5e0",
    borderRadius: "6px",
    fontSize: "14px",
    boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "13px",
    fontWeight: 500,
    marginBottom: "6px",
    color: "#2d3748",
  };
  const eyeButtonStyle: React.CSSProperties = {
    position: "absolute",
    right: "10px",
    top: "50%",
    transform: "translateY(-50%)",
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#718096",
    padding: "4px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(new Error("New password and confirm password do not match."));
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      const profile = Auth.getProfile();
      if (profile) {
        Auth.updateProfile({ ...profile, must_change_password: false });
      }
      onDone();
    } catch (err) {
      setSubmitting(false);
      setError(err);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.75)",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "12px",
          padding: "32px",
          maxWidth: "440px",
          width: "100%",
          boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)",
        }}
      >
        <h2 style={{ margin: "0 0 8px 0", fontSize: "20px", fontWeight: 600, color: "#1a202c" }}>
          Password Change Required
        </h2>
        <p style={{ margin: "0 0 20px 0", fontSize: "14px", color: "#4a5568" }}>
          Your account requires a password change before continuing to the ERP.
        </p>
        <div style={{ marginBottom: "12px" }}>
          <ErrorBanner error={error} />
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "16px" }}>
            <label style={labelStyle}>Current / Temporary Password</label>
            <div style={{ position: "relative" }}>
              <input
                type={showCurrent ? "text" : "password"}
                required
                style={{ ...inputStyle, paddingRight: "40px" }}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter temporary password"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                style={eyeButtonStyle}
                aria-label={showCurrent ? "Hide password" : "Show password"}
              >
                <EyeIcon visible={showCurrent} />
              </button>
            </div>
          </div>
          <div style={{ marginBottom: "16px" }}>
            <label style={labelStyle}>New Password</label>
            <div style={{ position: "relative" }}>
              <input
                type={showNew ? "text" : "password"}
                required
                style={{ ...inputStyle, paddingRight: "40px" }}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                style={eyeButtonStyle}
                aria-label={showNew ? "Hide password" : "Show password"}
              >
                <EyeIcon visible={showNew} />
              </button>
            </div>
          </div>
          <div style={{ marginBottom: "24px" }}>
            <label style={labelStyle}>Confirm New Password</label>
            <div style={{ position: "relative" }}>
              <input
                type={showConfirm ? "text" : "password"}
                required
                style={{ ...inputStyle, paddingRight: "40px" }}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                style={eyeButtonStyle}
                aria-label={showConfirm ? "Hide password" : "Show password"}
              >
                <EyeIcon visible={showConfirm} />
              </button>
            </div>
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
            style={{
              width: "100%",
              padding: "12px",
              fontSize: "14px",
              fontWeight: 600,
              borderRadius: "6px",
              cursor: "pointer",
              justifyContent: "center",
            }}
          >
            {submitting ? "Updating..." : "Update Password & Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                            */
/* ------------------------------------------------------------------ */

function Sidebar({
  activeKey,
  brandName,
  brandLogo,
  collapsed,
  onToggleSidebar,
}: {
  activeKey: string;
  brandName: string;
  brandLogo?: string | null;
  collapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const { isSuperAdmin, hasPermission } = useAuth();
  const navRef = useRef<HTMLElement>(null);

  const visibleSections = useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items
          .map((item) => {
            if (item.children) {
              const visibleChildren = item.children.filter((child) => {
                if (child.superAdminOnly && !isSuperAdmin) return false;
                return !child.permission || hasPermission(child.permission);
              });
              return { ...item, children: visibleChildren };
            }
            return item;
          })
          .filter((item) => {
            if (item.children) return item.children.length > 0;
            if (item.superAdminOnly && !isSuperAdmin) return false;
            return !item.permission || hasPermission(item.permission);
          }),
      })).filter((section) => section.items.length > 0),
    [isSuperAdmin, hasPermission]
  );

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        if (item.children && item.children.some((c) => c.key === activeKey)) {
          initial[item.key] = true;
        }
      }
    }
    return initial;
  });

  useEffect(() => {
    for (const section of visibleSections) {
      for (const item of section.items) {
        if (item.children && item.children.some((c) => c.key === activeKey)) {
          setOpenGroups((prev) => ({ ...prev, [item.key]: true }));
        }
      }
    }
  }, [activeKey, visibleSections]);

  useEffect(() => {
    const navEl = navRef.current;
    if (!navEl) return;

    const maxScroll = Math.max(0, navEl.scrollHeight - navEl.clientHeight);
    if (maxScroll === 0) return;

    const saved = parseInt(sessionStorage.getItem(NAV_SCROLL_KEY) || "", 10);
    if (Number.isFinite(saved) && saved > 0) {
      navEl.scrollTop = Math.min(saved, maxScroll);
    }

    const active = navEl.querySelector(".nav-item.active, .nav-sub-item.active");
    if (active) {
      const navBox = navEl.getBoundingClientRect();
      const itemBox = active.getBoundingClientRect();
      if (itemBox.top < navBox.top || itemBox.bottom > navBox.bottom) {
        const centreOffset = (navEl.clientHeight - itemBox.height) / 2;
        navEl.scrollTop = Math.min(
          maxScroll,
          Math.max(0, navEl.scrollTop + (itemBox.top - navBox.top) - centreOffset)
        );
      }
    }
  }, [activeKey, visibleSections]);

  useEffect(() => {
    const navEl = navRef.current;
    if (!navEl) return;

    const save = () => {
      try {
        sessionStorage.setItem(NAV_SCROLL_KEY, String(Math.round(navEl.scrollTop)));
      } catch {
        /* storage may be unavailable */
      }
    };

    let queued = false;
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        save();
      });
    };

    navEl.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("beforeunload", save);
    return () => {
      navEl.removeEventListener("scroll", onScroll);
      window.removeEventListener("beforeunload", save);
      save();
    };
  }, []);

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div
        className="sidebar-brand"
        style={{
          height: "64px",
          padding: collapsed ? "0 8px" : "0 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          boxSizing: "border-box",
          gap: "6px",
        }}
      >
        {!collapsed && (
          <Link to="/dashboard" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", cursor: "pointer", maxHeight: "44px" }}>
            <img
              src={resolveImageUrl(brandLogo) || "/logo.png"}
              alt={`${brandName || "ERP"} Logo`}
              onError={(e) => {
                if (e.currentTarget.src !== window.location.origin + "/logo.png") {
                  e.currentTarget.src = "/logo.png";
                }
              }}
              style={{ maxHeight: "38px", maxWidth: "160px", width: "auto", objectFit: "contain" }}
            />
          </Link>
        )}
        <button
          type="button"
          style={{
            background: collapsed ? "#e2e8f0" : "none",
            border: collapsed ? "1px solid #cbd5e0" : "none",
            fontSize: "20px",
            color: "#1e293b",
            cursor: "pointer",
            padding: collapsed ? "6px 12px" : "4px 8px",
            borderRadius: "6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: collapsed ? "100%" : "auto",
            lineHeight: 1,
          }}
          onClick={onToggleSidebar}
          title={collapsed ? "Open Sidebar Menu" : "Collapse Sidebar Menu"}
        >
          ≡
        </button>
      </div>
      <nav className="sidebar-nav" ref={navRef}>
        {visibleSections.map((section) => (
          <div className="nav-group" key={section.label}>
            <div className="nav-group-label">{section.label}</div>
            {section.items.map((item) => {
              if (item.children) {
                const isOpen = Boolean(openGroups[item.key]);
                const isAnyChildActive = item.children.some((c) => c.key === activeKey);
                const Icon = ICONS[item.icon];
                return (
                  <div key={item.key} className="nav-group-item-container">
                    <button
                      type="button"
                      className={`nav-item nav-item-accordion ${isAnyChildActive ? "active-parent" : ""}`}
                      onClick={() => {
                        if (collapsed) {
                          onToggleSidebar();
                          setOpenGroups((prev) => ({ ...prev, [item.key]: true }));
                        } else {
                          setOpenGroups((prev) => ({ ...prev, [item.key]: !prev[item.key] }));
                        }
                      }}
                      title={collapsed ? item.label : undefined}
                      style={{
                        width: "100%",
                        background: isAnyChildActive && !collapsed ? "#eff6ff" : "none",
                        border: "none",
                        textAlign: "left",
                        cursor: "pointer",
                        outline: "none",
                        font: "inherit",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "9px 12px",
                        borderRadius: "6px",
                      }}
                    >
                      <Icon />
                      <span className="nav-label">{item.label}</span>
                      {!collapsed && (
                        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", opacity: 0.65 }}>
                          {isOpen ? <IconChevronDown /> : <IconChevronRight />}
                        </span>
                      )}
                    </button>
                    {isOpen && !collapsed && (
                      <div
                        className="nav-sub-items"
                        style={{
                          paddingLeft: "32px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "1px",
                          marginTop: "2px",
                          marginBottom: "4px",
                        }}
                      >
                        {item.children.map((child) => {
                          const isChildActive = child.key === activeKey;
                          return (
                            <Link
                              key={child.key}
                              to={child.path}
                              className={`nav-sub-item ${isChildActive ? "active" : ""}`}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                padding: "6px 12px",
                                fontSize: "13px",
                                color: isChildActive ? "#0061f2" : "#64748b",
                                fontWeight: isChildActive ? 700 : 500,
                                textDecoration: "none",
                                borderRadius: "5px",
                                background: isChildActive ? "#e0edff" : "transparent",
                                transition: "all 0.12s ease",
                              }}
                              onClick={() => {
                                if (isChildActive) {
                                  window.dispatchEvent(
                                    new CustomEvent("erp:nav-active-click", {
                                      detail: { key: child.key, path: child.path },
                                    })
                                  );
                                }
                              }}
                            >
                              <span>{child.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              const Icon = ICONS[item.icon];
              const isItemActive = item.key === activeKey;
              return (
                <Link
                  key={item.key}
                  to={item.path || "#"}
                  className={`nav-item ${isItemActive ? "active" : ""}`}
                  title={collapsed ? item.label : undefined}
                  onClick={() => {
                    if (isItemActive) {
                      window.dispatchEvent(
                        new CustomEvent("erp:nav-active-click", {
                          detail: { key: item.key, path: item.path },
                        })
                      );
                    }
                  }}
                >
                  <Icon />
                  <span className="nav-label">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Topbar                                                             */
/* ------------------------------------------------------------------ */

function Topbar() {
  const navigate = useNavigate();
  const { profile, isSuperAdmin } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    if (profileOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [profileOpen]);

  function handleLogout() {
    setProfileOpen(false);
    const refreshToken = Auth.getRefreshToken();
    const accessToken = Auth.getAccessToken();
    const sessionId = Auth.getSessionId() || undefined;

    // 1. Immediately revoke ecosystem session globally and clear local state (0ms perceived lag)
    globalEcosystemLogout(sessionId);
    Auth.clear();
    navigate("/login", { replace: true });

    // 2. Best-effort background revocation on server with keepalive
    if (refreshToken && accessToken) {
      try {
        fetch(`${API_BASE}/auth/logout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ refresh_token: refreshToken }),
          keepalive: true,
        }).catch(() => {
          /* background revocation best-effort */
        });
      } catch {
        /* ignore */
      }
    }
  }

  function handleProfile() {
    setProfileOpen(false);
    navigate("/profile");
  }

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  const displayName =
    fullName ||
    (typeof profile?.full_name === "string" && profile.full_name ? profile.full_name : "") ||
    profile?.username ||
    "User";
  const userInitials = initials(displayName);
  const displayRole = isSuperAdmin ? "Super Admin" : roleLabel(profile);

  return (
    <header className="topbar">
      <div className="topbar-spacer" />
      <div className="topbar-actions" ref={popoverRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: "10px" }}>
        <EcosystemSwitcher currentKey="inhyma" />
        <NotificationBell />
        <button
          type="button"
          onClick={() => setProfileOpen((v) => !v)}
          style={{
            background: profileOpen ? "#eff6ff" : "transparent",
            border: profileOpen ? "1.5px solid #3b82f6" : "1px solid #cbd5e1",
            borderRadius: "24px",
            padding: "4px 10px 4px 5px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          title={`${displayName} (${displayRole})`}
          aria-label="User Profile Menu"
        >
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
              border: "1.5px solid #bfdbfe",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#1d4ed8",
              fontWeight: 700,
              fontSize: "12px",
              flexShrink: 0,
            }}
          >
            {userInitials}
          </div>
          <span
            style={{
              fontSize: "13.5px",
              fontWeight: 600,
              color: "#1e293b",
              maxWidth: "140px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {displayName}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#64748b"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: profileOpen ? "rotate(180deg)" : "none",
              transition: "transform 0.15s ease",
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {profileOpen && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              background: "#ffffff",
              borderRadius: "12px",
              boxShadow: "0 10px 30px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.04)",
              border: "1px solid #e2e8f0",
              zIndex: 1000,
              width: "220px",
              padding: "16px 0 8px 0",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            {/* User Avatar Circle */}
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
                border: "2px solid #bfdbfe",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#1d4ed8",
                fontSize: "20px",
                fontWeight: 700,
                letterSpacing: "0.5px",
                marginBottom: "10px",
                boxShadow: "0 2px 8px rgba(37, 99, 235, 0.12)",
              }}
            >
              {userInitials}
            </div>

            {/* User Name & Details */}
            <div
              style={{
                width: "100%",
                padding: "0 16px",
                textAlign: "center",
                boxSizing: "border-box",
                marginBottom: "10px",
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "14.5px",
                  color: "#0f172a",
                  lineHeight: 1.3,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={displayName}
              >
                {displayName}
              </div>

              {profile?.email && (
                <div
                  style={{
                    fontSize: "12px",
                    color: "#64748b",
                    marginTop: "3px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={profile.email}
                >
                  {profile.email}
                </div>
              )}

              <div
                style={{
                  display: "inline-block",
                  marginTop: "6px",
                  padding: "2px 8px",
                  borderRadius: "10px",
                  fontSize: "11px",
                  fontWeight: 600,
                  background: isSuperAdmin ? "#fef3c7" : "#f1f5f9",
                  color: isSuperAdmin ? "#b45309" : "#475569",
                  border: isSuperAdmin ? "1px solid #fde68a" : "1px solid #e2e8f0",
                }}
              >
                {displayRole}
              </div>
            </div>

            <div style={{ width: "100%", height: "1px", background: "#f1f5f9", margin: "2px 0 6px 0" }} />

            {/* Profile */}
            <button
              type="button"
              onClick={handleProfile}
              style={{
                width: "100%",
                padding: "9px 16px",
                background: "none",
                border: "none",
                textAlign: "left",
                fontSize: "13px",
                color: "#334155",
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                transition: "background 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#64748b" }}>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              Profile
            </button>

            {/* Sign Out */}
            <button
              type="button"
              onClick={handleLogout}
              style={{
                width: "100%",
                padding: "9px 16px",
                background: "none",
                border: "none",
                textAlign: "left",
                fontSize: "13px",
                color: "#dc2626",
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                transition: "background 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#fef2f2")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              Sign Out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                              */
/* ------------------------------------------------------------------ */

export interface AppShellProps {
  activeKey: string;
  children: ReactNode;
  /** Extra class on the main column wrapper, for page-scoped CSS. */
  pageClassName?: string;
}

export function AppShell({ activeKey, children, pageClassName }: AppShellProps) {
  const { profile, isSuperAdmin, hasPermission } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [brandName, setBrandName] = useState(() => getCachedBrandName());
  const [brandLogo, setBrandLogo] = useState<string | null>(() => getCachedBrandLogo());
  const [passwordModalDismissed, setPasswordModalDismissed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("erp_sidebar_collapsed") === "true"
  );

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("erp_sidebar_collapsed", String(next));
      return next;
    });
  }, []);

  const loggedIn = Auth.isLoggedIn();

  useEffect(() => {
    if (!loggedIn || !Auth.shouldSyncProfile()) return;
    apiGet<Profile>("/auth/profile")
      .then((res) => {
        if (res && res.data) {
          Auth.updateProfile(res.data);
          Auth.markProfileSynced();
        }
      })
      .catch(() => {
        /* profile refresh fallback */
      });
  }, [loggedIn]);

  useEffect(() => subscribeBrandName(setBrandName), []);
  useEffect(() => subscribeBrandLogo(setBrandLogo), []);

  useEffect(() => {
    let cancelled = false;
    if (!loggedIn) return;
    resolveBrandInfo().then((info) => {
      if (!cancelled) {
        setBrandName(info.name);
        setBrandLogo(info.logoUrl);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loggedIn]);

  useEffect(() => {
    const pageLabel = NAV_ITEMS_BY_KEY[activeKey]?.label || PAGE_TITLES[activeKey] || "Dashboard";
    const companyName = (brandName || DEFAULT_BRAND_NAME).trim();
    document.title = `${pageLabel} - ${companyName}`;
  }, [activeKey, brandName]);

  const handlePasswordDone = useCallback(() => {
    setPasswordModalDismissed(true);
    window.location.reload();
  }, []);

  // Synchronize remote logout across all ERPs in real-time
  useEffect(() => {
    if (!loggedIn) return;
    const cleanup = initEcosystemSessionWatcher(Auth.getSessionId(), () => {
      Auth.clear();
      navigate("/login", { replace: true });
    });
    return cleanup;
  }, [loggedIn, navigate]);

  // Whether an automatic-login mechanism might still resolve before we
  // should give up and bounce to /login. This covers two cases:
  //  1. A legacy `sso_handover` token is present in the URL right now.
  //  2. `processIncomingSsoHandover()` hasn't reported its result yet
  //     for THIS mount -- e.g. it found a still-valid ecosystem cookie
  //     and is in the middle of exchanging it. Gating on "has it
  //     settled" rather than only "is the query param present right
  //     now" is what closes the original race: previously, a mount
  //     with no `sso_handover` param in the URL (or one already
  //     stripped by an earlier effect) fell straight through to the
  //     /login redirect even while an auto-login was genuinely still
  //     in flight, logging out users -- including Super Admins -- who
  //     had a perfectly valid session about to be established.
  const [ssoCheckPending, setSsoCheckPending] = useState(
    () => !loggedIn && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("sso_handover")
  );

  useEffect(() => {
    if (loggedIn) {
      const currentSid = Auth.getSessionId();
      if (isExplicitlyLoggedOut(currentSid || undefined)) {
        Auth.clear();
        navigate("/login", { replace: true });
        return;
      }
      setSsoCheckPending(false);
      // Where this person may be is ERP_Main's live decision (grants / revokes made after sign-in apply here): one ERP -> that
      // ERP only, no ERP -> the dashboard, several -> this ERP if it is one of them. Fail-open and throttled.
      void enforceCentralLanding("inhyma");
      return;
    }
    let cancelled = false;
    setSsoCheckPending(true);
    processIncomingSsoHandover().then((result) => {
      if (cancelled) return;
      // Only a genuine fresh auto-login (a real state change) warrants a
      // reload. "already-logged-in" means Auth was already logged in by
      // the time this ran (e.g. AppShell remounting on a route change
      // right after a previous reload) -- reloading again here would
      // just repeat the same effect on the next mount, forever.
      if (result === "logged-in") {
        window.location.reload();
        return; // leave ssoCheckPending true through the reload -- no flash to /login in the interim
      }
      setSsoCheckPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loggedIn]);

  if (!loggedIn) {
    if (ssoCheckPending) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 36, height: 36, margin: "0 auto 16px", border: "3px solid #e2e8f0", borderTopColor: "#0284c7", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <div style={{ fontSize: 14, color: "#64748b", fontWeight: 500 }}>Checking your session…</div>
          </div>
        </div>
      );
    }
    const cleanParams = new URLSearchParams(location.search);
    cleanParams.delete("sso_handover");
    const cleanSearch = cleanParams.toString() ? `?${cleanParams.toString()}` : "";
    return <Navigate to={`/login${cleanSearch}`} replace state={{ from: location.pathname }} />;
  }

  const navItem = NAV_ITEMS_BY_KEY[activeKey];
  if (navItem && activeKey !== "403") {
    const deniedBySuperAdmin = navItem.superAdminOnly && !isSuperAdmin;
    const deniedByPermission = navItem.permission && !hasPermission(navItem.permission);
    if (deniedBySuperAdmin || deniedByPermission) {
      const moduleName = PAGE_TITLES[activeKey] || activeKey;
      return <Navigate to={`/403?module=${encodeURIComponent(moduleName)}`} replace />;
    }
  }

  const mustChangePassword = Boolean(profile?.must_change_password) && !passwordModalDismissed;

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${pageClassName || ""}`.trim()}
    >
      <Sidebar activeKey={activeKey} brandName={brandName} brandLogo={brandLogo} collapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />
      <div className="main-column">
        <Topbar />
        {children}
      </div>
      {mustChangePassword && <ForcePasswordChangeModal onDone={handlePasswordDone} />}
    </div>
  );
}