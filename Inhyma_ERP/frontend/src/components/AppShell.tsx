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
import { API_BASE, apiGet, apiPatch, apiPost } from "@/lib/api";
import { Auth, initials, roleLabel } from "@/lib/auth";
import { liveClient } from "@/lib/live/liveClient";
import { useAuth } from "@/lib/hooks";
import {
  NAV_ITEMS_BY_KEY,
  NAV_SECTIONS,
  PAGE_TITLES,
  DEFAULT_BRAND_NAME,
} from "@/lib/nav";
import { getCachedBrandName, resolveBrandName, subscribeBrandName } from "@/lib/brand";
import { ICONS, IconBell } from "./icons";
import { UniversalSearch } from "./UniversalSearch";
import { EcosystemSwitcher } from "./EcosystemSwitcher";
import { processIncomingSsoHandover } from "@/lib/ssoBridge";
import { globalEcosystemLogout, initEcosystemSessionWatcher } from "@/lib/ecosystemSession";
import { ErrorBanner } from "./ui";
import type { Profile } from "@/types";
import { tasksApi } from "@/lib/tasksApi";

const NAV_SCROLL_KEY = "erp_sidebar_nav_scroll";

/* ------------------------------------------------------------------ */
/* Notifications                                                      */
/* ------------------------------------------------------------------ */

interface InAppNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  link?: string | null;
  is_read: boolean;
  created_at: string;
}

type NotificationCategory = "all" | "deadlines" | "escalations" | "team";

function getNotificationCategoryMeta(n: InAppNotification) {
  const type = (n.type || "").toLowerCase();
  const title = (n.title || "").toLowerCase();

  const isOverdue = type.includes("overdue") || title.includes("overdue");
  const isDeadlineToday = type.includes("deadline_today") || title.includes("due today");
  const isDeadlineSoon = type.includes("approaching") || title.includes("due tomorrow") || title.includes("due soon");
  const isEscalation = type.includes("escalat") || title.includes("escalat");
  const isDeadline = isOverdue || isDeadlineToday || isDeadlineSoon || type.includes("deadline") || title.includes("deadline");
  const isMention = type.includes("mention") || title.includes("mention");
  const isAssigned = type.includes("assigned") || title.includes("assigned");
  const isSubtask = type.includes("subtask") || title.includes("subtask");
  const isHold = type.includes("hold") || title.includes("hold");
  const isCompleted = type.includes("completed") || title.includes("completed") || type.includes("done");

  const isTeam = isMention || isAssigned || isSubtask || type.includes("watcher") || isHold || isCompleted || (!isDeadline && !isEscalation);

  let badgeLabel = "TASK";
  let badgeBg = "#f1f5f9";
  let badgeColor = "#475569";
  let badgeBorder = "#cbd5e1";

  if (isOverdue) {
    badgeLabel = "⚠️ OVERDUE";
    badgeBg = "#fef2f2";
    badgeColor = "#dc2626";
    badgeBorder = "#fecaca";
  } else if (isDeadlineToday) {
    badgeLabel = "📅 DUE TODAY";
    badgeBg = "#fffbeb";
    badgeColor = "#d97706";
    badgeBorder = "#fde68a";
  } else if (isDeadlineSoon) {
    badgeLabel = "⏰ DUE SOON";
    badgeBg = "#fef3c7";
    badgeColor = "#b45309";
    badgeBorder = "#fcd34d";
  } else if (isEscalation) {
    badgeLabel = "⚡ ESCALATION";
    badgeBg = "#fff1f2";
    badgeColor = "#e11d48";
    badgeBorder = "#fecdd3";
  } else if (isMention) {
    badgeLabel = "💬 MENTION";
    badgeBg = "#f5f3ff";
    badgeColor = "#7c3aed";
    badgeBorder = "#ddd6fe";
  } else if (isAssigned) {
    badgeLabel = "👤 ASSIGNED";
    badgeBg = "#eff6ff";
    badgeColor = "#2563eb";
    badgeBorder = "#bfdbfe";
  } else if (isCompleted) {
    badgeLabel = "✓ DONE";
    badgeBg = "#f0fdf4";
    badgeColor = "#16a34a";
    badgeBorder = "#bbf7d0";
  } else if (isHold) {
    badgeLabel = "⏸️ ON HOLD";
    badgeBg = "#fff7ed";
    badgeColor = "#ea580c";
    badgeBorder = "#fed7aa";
  }

  return {
    isDeadline,
    isEscalation,
    isTeam,
    badgeLabel,
    badgeBg,
    badgeColor,
    badgeBorder,
  };
}

function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return "just now";
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeCategory, setActiveCategory] = useState<NotificationCategory>("all");
  const [isChecking, setIsChecking] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const loadNotifications = useCallback(async () => {
    try {
      const res = await apiGet<{ items: InAppNotification[]; unread_count: number }>("/notifications?limit=40");
      if (res.data) {
        setNotifications(res.data.items || []);
        setUnreadCount(res.data.unread_count ?? 0);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const handleSyncDeadlines = useCallback(async () => {
    setIsChecking(true);
    try {
      await tasksApi.checkTaskDeadlines();
      await loadNotifications();
    } catch {
      // Non-fatal
    } finally {
      setIsChecking(false);
    }
  }, [loadNotifications]);

  useEffect(() => {
    loadNotifications();
    // Run deadline checks for current user on mount
    tasksApi.checkTaskDeadlines().then(() => loadNotifications()).catch(() => {});
  }, [loadNotifications]);

  // Live WebSocket updates
  useEffect(() => {
    const user = Auth.getProfile();
    if (user?.id) {
      liveClient.subscribe(`user:${user.id}`);
    }
    liveClient.subscribe("notifications");

    const unsub = liveClient.onEvent((event) => {
      if (
        event.event_type === "NOTIFICATION_RECEIVED" ||
        event.event_type.startsWith("TASK_")
      ) {
        loadNotifications();
      }
    });

    return () => {
      unsub();
    };
  }, [loadNotifications]);

  // Any click outside the bell closes the dropdown.
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

  const handleNotificationClick = async (n: InAppNotification) => {
    if (!n.is_read) {
      apiPatch(`/notifications/${n.id}/read`).catch(() => {});
      setNotifications((prev) =>
        prev.map((item) => (item.id === n.id ? { ...item, is_read: true } : item))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
    setOpen(false);
    if (n.link) {
      navigate(n.link);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await apiPost("/notifications/read-all");
      setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));
      setUnreadCount(0);
    } catch {
      // Non-fatal
    }
  };

  // Enriched notifications with category tags
  const enrichedNotifications = useMemo(() => {
    return notifications.map((n) => ({
      ...n,
      meta: getNotificationCategoryMeta(n),
    }));
  }, [notifications]);

  const filteredNotifications = useMemo(() => {
    if (activeCategory === "deadlines") {
      return enrichedNotifications.filter((n) => n.meta.isDeadline);
    }
    if (activeCategory === "escalations") {
      return enrichedNotifications.filter((n) => n.meta.isEscalation);
    }
    if (activeCategory === "team") {
      return enrichedNotifications.filter((n) => n.meta.isTeam);
    }
    return enrichedNotifications;
  }, [enrichedNotifications, activeCategory]);

  const categoryCounts = useMemo(() => {
    let deadlines = 0;
    let escalations = 0;
    let team = 0;
    for (const n of enrichedNotifications) {
      if (n.meta.isDeadline) deadlines++;
      if (n.meta.isEscalation) escalations++;
      if (n.meta.isTeam) team++;
    }
    return {
      all: enrichedNotifications.length,
      deadlines,
      escalations,
      team,
    };
  }, [enrichedNotifications]);

  return (
    <div style={{ position: "relative" }} ref={wrapperRef}>
      <button
        className="icon-btn"
        title="Notifications"
        style={{ position: "relative", cursor: "pointer" }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <IconBell />
        {unreadCount > 0 && (
          <span
            style={{
              display: "inline-block",
              position: "absolute",
              top: "-2px",
              right: "-2px",
              background: "#dc2626",
              color: "#ffffff",
              fontSize: "10px",
              fontWeight: 800,
              padding: "1px 5px",
              borderRadius: "10px",
              minWidth: "16px",
              textAlign: "center",
              border: "2px solid #ffffff",
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      <div
        style={{
          display: open ? "block" : "none",
          position: "absolute",
          right: 0,
          top: "42px",
          width: "420px",
          maxWidth: "calc(100vw - 24px)",
          background: "#ffffff",
          border: "1px solid #cbd5e1",
          borderRadius: "12px",
          boxShadow: "0 16px 36px rgba(15, 23, 42, 0.16)",
          zIndex: 99999,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#f8fafc",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#0f172a", fontWeight: 700, fontSize: "14px" }}>Notifications</span>
            {unreadCount > 0 && (
              <span
                style={{
                  fontSize: "11px",
                  background: "#fee2e2",
                  color: "#dc2626",
                  padding: "1px 7px",
                  fontWeight: 700,
                  borderRadius: "10px",
                }}
              >
                {unreadCount} unread
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              onClick={handleSyncDeadlines}
              disabled={isChecking}
              title="Check deadlines for tasks and escalations assigned to you"
              style={{
                background: "transparent",
                border: "none",
                color: isChecking ? "#94a3b8" : "#2563eb",
                fontSize: "11px",
                fontWeight: 600,
                cursor: isChecking ? "wait" : "pointer",
                padding: "3px 6px",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <span style={{ display: "inline-block", transform: isChecking ? "rotate(180deg)" : "none", transition: "transform 0.5s ease" }}>
                🔄
              </span>
              {isChecking ? "Checking..." : "Sync"}
            </button>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#64748b",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: "3px 6px",
                }}
              >
                Mark all read
              </button>
            )}
          </div>
        </div>

        {/* Category Tabs */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            padding: "8px 12px",
            background: "#ffffff",
            borderBottom: "1px solid #f1f5f9",
            overflowX: "auto",
          }}
        >
          <button
            type="button"
            onClick={() => setActiveCategory("all")}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              border: activeCategory === "all" ? "1px solid #2563eb" : "1px solid #e2e8f0",
              background: activeCategory === "all" ? "#eff6ff" : "#ffffff",
              color: activeCategory === "all" ? "#1d4ed8" : "#64748b",
              fontSize: "11.5px",
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            All ({categoryCounts.all})
          </button>
          <button
            type="button"
            onClick={() => setActiveCategory("deadlines")}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              border: activeCategory === "deadlines" ? "1px solid #d97706" : "1px solid #e2e8f0",
              background: activeCategory === "deadlines" ? "#fffbeb" : "#ffffff",
              color: activeCategory === "deadlines" ? "#b45309" : "#64748b",
              fontSize: "11.5px",
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            ⏰ Deadlines ({categoryCounts.deadlines})
          </button>
          <button
            type="button"
            onClick={() => setActiveCategory("escalations")}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              border: activeCategory === "escalations" ? "1px solid #e11d48" : "1px solid #e2e8f0",
              background: activeCategory === "escalations" ? "#fff1f2" : "#ffffff",
              color: activeCategory === "escalations" ? "#be123c" : "#64748b",
              fontSize: "11.5px",
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            ⚡ Escalations ({categoryCounts.escalations})
          </button>
          <button
            type="button"
            onClick={() => setActiveCategory("team")}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              border: activeCategory === "team" ? "1px solid #7c3aed" : "1px solid #e2e8f0",
              background: activeCategory === "team" ? "#f5f3ff" : "#ffffff",
              color: activeCategory === "team" ? "#6d28d9" : "#64748b",
              fontSize: "11.5px",
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            👤 Team ({categoryCounts.team})
          </button>
        </div>

        {/* Notifications List */}
        <div style={{ maxHeight: "380px", overflowY: "auto" }}>
          {filteredNotifications.length === 0 ? (
            <div style={{ padding: "36px 20px", textAlign: "center", color: "#64748b", fontSize: "13px" }}>
              <div style={{ fontSize: "24px", marginBottom: "8px" }}>
                {activeCategory === "deadlines" ? "⏰" : activeCategory === "escalations" ? "⚡" : activeCategory === "team" ? "👥" : "🔔"}
              </div>
              <div style={{ fontWeight: 600, color: "#334155" }}>
                {activeCategory === "deadlines"
                  ? "No task deadlines"
                  : activeCategory === "escalations"
                  ? "No escalation notifications"
                  : activeCategory === "team"
                  ? "No team activity"
                  : "No notifications yet"}
              </div>
              <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>
                {activeCategory === "deadlines"
                  ? "Approaching or overdue tasks assigned to you will appear here."
                  : activeCategory === "escalations"
                  ? "Escalations assigned to you will trigger alerts here."
                  : "You are all caught up!"}
              </div>
            </div>
          ) : (
            filteredNotifications.map((n) => (
              <div
                key={n.id}
                style={{
                  padding: "11px 14px",
                  borderBottom: "1px solid #f1f5f9",
                  cursor: "pointer",
                  background: n.is_read ? "#ffffff" : "#f8faff",
                  transition: "background 0.15s ease",
                  display: "flex",
                  gap: "10px",
                  alignItems: "flex-start",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = "#f1f5f9";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = n.is_read ? "#ffffff" : "#f8faff";
                }}
                onClick={() => handleNotificationClick(n)}
              >
                {/* Unread indicator */}
                <div style={{ paddingTop: "4px", width: "8px", flexShrink: 0 }}>
                  {!n.is_read ? (
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: "#2563eb",
                        display: "inline-block",
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: "#cbd5e1",
                        display: "inline-block",
                      }}
                    />
                  )}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                      marginBottom: "3px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden" }}>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          padding: "1.5px 5px",
                          borderRadius: "4px",
                          background: n.meta.badgeBg,
                          color: n.meta.badgeColor,
                          border: `1px solid ${n.meta.badgeBorder}`,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {n.meta.badgeLabel}
                      </span>
                      <span
                        style={{
                          fontSize: "12.5px",
                          fontWeight: n.is_read ? 600 : 700,
                          color: n.is_read ? "#334155" : "#0f172a",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={n.title}
                      >
                        {n.title}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: "10.5px",
                        color: "#94a3b8",
                        fontWeight: 400,
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {formatRelativeTime(n.created_at)}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#475569",
                      lineHeight: "1.4",
                      wordBreak: "break-word",
                    }}
                  >
                    {n.message}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
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
  brandName: _brandName,
  collapsed,
  onToggleSidebar,
}: {
  activeKey: string;
  brandName: string;
  collapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const { isSuperAdmin, hasPermission } = useAuth();
  const navRef = useRef<HTMLElement>(null);

  const visibleSections = useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          if (item.superAdminOnly && !isSuperAdmin) return false;
          return !item.permission || hasPermission(item.permission);
        }),
      })).filter((section) => section.items.length > 0),
    [isSuperAdmin, hasPermission]
  );

  useEffect(() => {
    const navEl = navRef.current;
    if (!navEl) return;

    const maxScroll = Math.max(0, navEl.scrollHeight - navEl.clientHeight);
    if (maxScroll === 0) return;

    const saved = parseInt(sessionStorage.getItem(NAV_SCROLL_KEY) || "", 10);
    if (Number.isFinite(saved) && saved > 0) {
      navEl.scrollTop = Math.min(saved, maxScroll);
    }

    const active = navEl.querySelector(".nav-item.active");
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
          <Link to="/dashboard" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", cursor: "pointer" }}>
            <img src="/logo.png" alt="IHM Logo" style={{ height: "38px", width: "auto", objectFit: "contain" }} />
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
              const Icon = ICONS[item.icon];
              return (
                <Link
                  key={item.key}
                  to={item.path}
                  className={`nav-item ${item.key === activeKey ? "active" : ""}`}
                  title={collapsed ? item.label : undefined}
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

  function handleEditProfile() {
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
      <UniversalSearch />
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

            {/* Edit Profile */}
            <button
              type="button"
              onClick={handleEditProfile}
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
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
              Edit Profile
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
    if (!loggedIn) return;
    apiGet<Profile>("/auth/profile")
      .then((res) => {
        if (res && res.data) Auth.updateProfile(res.data);
      })
      .catch(() => {
        /* profile refresh fallback */
      });
  }, [loggedIn]);

  useEffect(() => subscribeBrandName(setBrandName), []);

  useEffect(() => {
    let cancelled = false;
    if (!loggedIn) return;
    resolveBrandName().then((name) => {
      if (!cancelled) setBrandName(name);
    });
    return () => {
      cancelled = true;
    };
  }, [loggedIn]);

  useEffect(() => {
    const titlePrefix = PAGE_TITLES[activeKey] || "ERP";
    document.title = `${titlePrefix} — ${brandName || DEFAULT_BRAND_NAME}`;
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

  useEffect(() => {
    if (!loggedIn) {
      processIncomingSsoHandover().then((ok) => {
        if (ok) {
          window.location.reload();
        }
      });
    }
  }, [loggedIn]);

  const hasSsoHandover = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("sso_handover");
  if (!loggedIn) {
    if (hasSsoHandover) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 36, height: 36, margin: "0 auto 16px", border: "3px solid #e2e8f0", borderTopColor: "#0284c7", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <div style={{ fontSize: 14, color: "#64748b", fontWeight: 500 }}>Authorizing Super Admin Single Sign-On...</div>
          </div>
        </div>
      );
    }
    return <Navigate to={`/login${location.search}`} replace state={{ from: location.pathname }} />;
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
      <Sidebar activeKey={activeKey} brandName={brandName} collapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />
      <div className="main-column">
        <Topbar />
        {children}
      </div>
      {mustChangePassword && <ForcePasswordChangeModal onDone={handlePasswordDone} />}
    </div>
  );
}
