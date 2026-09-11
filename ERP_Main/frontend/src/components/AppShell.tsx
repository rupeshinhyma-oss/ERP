/**
 * Shared AppShell Layout for ERP_Main Control Plane.
 *
 * Implements the exact layout, header, sidebar, responsive drawer,
 * and user menu patterns from Yinglima and Inhyma ERPs.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { apiGet } from "@/lib/api";
import { Auth, initials, roleLabel } from "@/lib/auth";
import { useAuth, usePageTitle } from "@/lib/hooks";
import {
  DEFAULT_BRAND_NAME,
  NAV_ITEMS_BY_KEY,
  NAV_SECTIONS,
  PAGE_TITLES,
} from "@/lib/nav";
import { processIncomingSsoHandover } from "@/lib/ssoBridge";
import { globalEcosystemLogout } from "@/lib/ecosystemSession";
import { Breadcrumb } from "./Breadcrumb";
import { ICONS, IconBell } from "./icons";
import type { PlatformAdmin } from "@/types";

interface AppShellProps {
  activeKey: string;
  pageTitle?: string;
  breadcrumbs?: string[];
  actions?: ReactNode;
  children: ReactNode;
}

export function AppShell({
  activeKey,
  pageTitle,
  breadcrumbs,
  actions,
  children,
}: AppShellProps) {
  const { profile, isLoggedIn, isSuperAdmin } = useAuth();
  const userEmail = profile ? ("primary_email" in profile ? profile.primary_email : profile.email) : "";
  const userRole = profile ? ("role" in profile ? profile.role : "GLOBAL_USER") : "";
  const location = useLocation();
  const navigate = useNavigate();

  // Mobile drawer state
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // User profile dropdown
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close user menu on outside click
  useEffect(() => {
    if (!userDropdownOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserDropdownOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [userDropdownOpen]);

  // Sync profile on mount if missing
  useEffect(() => {
    if (isLoggedIn && !profile) {
      apiGet<PlatformAdmin>("/global/auth/me")
        .then((res) => {
          if (res) Auth.updateProfile(res);
        })
        .catch(() => {
          // Handled by 401 interceptor in api.ts
        });
    }
  }, [isLoggedIn, profile]);

  // Global '/' shortcut for Search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        navigate("/search");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  // Document title
  const currentTitle = pageTitle || PAGE_TITLES[location.pathname] || (NAV_ITEMS_BY_KEY[activeKey]?.label) || "Global Control Panel";
  usePageTitle(currentTitle);

  const handleLogout = useCallback(() => {
    const sid = Auth.getSessionId() || undefined;
    globalEcosystemLogout(sid);
    Auth.clear();
    navigate("/login");
  }, [navigate]);

  useEffect(() => {
    if (!isLoggedIn) {
      processIncomingSsoHandover().then((ok) => {
        if (ok) {
          window.location.reload();
        }
      });
    }
  }, [isLoggedIn]);

  const hasSsoHandover = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("sso_handover");
  // Redirect to login if unauthenticated
  if (!isLoggedIn) {
    if (hasSsoHandover) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 36, height: 36, margin: "0 auto 16px", border: "3px solid #e2e8f0", borderTopColor: "#0061f2", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <div style={{ fontSize: 14, color: "#64748b", fontWeight: 500 }}>Authorizing Platform Super Admin Single Sign-On...</div>
          </div>
        </div>
      );
    }
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  }

  return (
    <div className="app-shell" style={{ display: "flex", minHeight: "100vh", background: "var(--color-bg)" }}>
      {/* Mobile overlay backdrop */}
      {mobileNavOpen && (
        <div
          className="sidebar-overlay"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.4)",
            backdropFilter: "blur(2px)",
            zIndex: 998,
          }}
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Left Sidebar */}
      <aside
        className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}
        style={{
          width: "var(--sidebar-width, 248px)",
          background: "var(--sidebar-bg, #ffffff)",
          borderRight: "1px solid var(--sidebar-border, #e2e8f0)",
          display: "flex",
          flexDirection: "column",
          position: "fixed",
          top: 0,
          bottom: 0,
          left: 0,
          zIndex: 999,
          transition: "transform 0.2s ease",
        }}
      >
        {/* Brand header */}
        <Link
          to="/dashboard"
          className="sidebar-brand"
          onClick={() => setMobileNavOpen(false)}
          title="Go to ERP Dashboard"
          style={{
            height: "64px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "0 20px",
            borderBottom: "1px solid var(--sidebar-border, #e2e8f0)",
            textDecoration: "none",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "8px",
              background: "var(--color-primary, #0061f2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              fontWeight: 800,
              fontSize: "14px",
              flexShrink: 0,
            }}
          >
            CP
          </div>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span
              style={{
                fontSize: "14px",
                fontWeight: 700,
                color: "var(--color-text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {DEFAULT_BRAND_NAME}
            </span>
            <span style={{ fontSize: "11px", color: "var(--color-muted)", fontWeight: 500 }}>
              Global Control Panel
            </span>
          </div>
        </Link>

        {/* Sidebar Nav Items */}
        <div
          className="sidebar-nav"
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
          }}
        >
          {NAV_SECTIONS.map((section) => {
            const visibleItems = section.items.filter((item) => {
              if (item.superAdminOnly && !isSuperAdmin) return false;
              return true;
            });

            if (visibleItems.length === 0) return null;

            return (
              <div key={section.label} className="nav-group">
                <div
                  className="nav-group-title"
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    color: "var(--color-muted)",
                    padding: "0 8px 8px",
                    textTransform: "uppercase",
                  }}
                >
                  {section.label}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  {visibleItems.map((item) => {
                    const isActive = activeKey === item.key;
                    const IconComponent = ICONS[item.icon] || ICONS.dashboard;

                    return (
                      <Link
                        key={item.key}
                        to={item.path}
                        className={`nav-item ${isActive ? "active" : ""}`}
                        onClick={() => setMobileNavOpen(false)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "8px 10px",
                          borderRadius: "var(--radius-sm, 6px)",
                          fontSize: "13px",
                          fontWeight: isActive ? 600 : 500,
                          color: isActive ? "var(--sidebar-active-text, #0061f2)" : "var(--sidebar-text, #334155)",
                          background: isActive ? "var(--sidebar-active-bg, #e0edff)" : "transparent",
                          textDecoration: "none",
                          transition: "background 0.15s ease, color 0.15s ease",
                        }}
                      >
                        <IconComponent
                          width={18}
                          height={18}
                          style={{
                            color: isActive ? "var(--sidebar-active-text, #0061f2)" : "var(--color-muted)",
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.label}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Sidebar Footer */}
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--sidebar-border, #e2e8f0)",
            fontSize: "11px",
            color: "var(--color-muted)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>ERP_Main v1.0.0</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981" }} />
            Online
          </span>
        </div>
      </aside>

      {/* Main Content Area */}
      <div
        style={{
          flex: 1,
          marginLeft: "var(--sidebar-width, 248px)",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: "100vh",
        }}
      >
        {/* Topbar Header */}
        <header
          className="topbar"
          style={{
            height: "64px",
            background: "var(--color-surface, #ffffff)",
            borderBottom: "1px solid var(--color-border, #e2e8f0)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
            position: "sticky",
            top: 0,
            zIndex: 900,
          }}
        >
          {/* Left: Mobile hamburger & breadcrumb or title */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <button
              type="button"
              className="icon-btn mobile-menu-btn"
              onClick={() => setMobileNavOpen((prev) => !prev)}
              aria-label="Toggle navigation menu"
              style={{ display: "none", cursor: "pointer", background: "none", border: "none", padding: "6px" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text)" }}>
                {currentTitle}
              </span>
            </div>
          </div>

          {/* Right: Quick actions, notifications, user profile */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {/* Quick search button */}
            <Link
              to="/search"
              className="icon-btn"
              title="Universal Search (Press / to focus)"
              id="header-search-btn"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 12px",
                borderRadius: "var(--radius-sm, 6px)",
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-muted)",
                fontSize: "12px",
                textDecoration: "none",
              }}
            >
              <ICONS.search width={14} height={14} />
              <span style={{ display: "inline-block" }}>Search projections...</span>
              <kbd
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "1px 5px",
                  borderRadius: "4px",
                  background: "var(--color-surface, #ffffff)",
                  border: "1px solid var(--color-border, #cbd5e1)",
                  color: "var(--color-text-secondary, #64748b)",
                  lineHeight: 1.2,
                }}
              >
                /
              </kbd>
            </Link>

            {/* Notification Bell */}
            <button
              type="button"
              className="icon-btn"
              title="Notifications"
              style={{
                position: "relative",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "8px",
                color: "var(--color-muted)",
              }}
            >
              <IconBell width={18} height={18} />
            </button>

            {/* User Profile Dropdown */}
            <div style={{ position: "relative" }} ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setUserDropdownOpen((prev) => !prev)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 8px",
                  borderRadius: "var(--radius)",
                }}
              >
                <div
                  style={{
                    width: "34px",
                    height: "34px",
                    borderRadius: "50%",
                    background: "#0061f2",
                    color: "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "13px",
                    fontWeight: 700,
                  }}
                >
                  {initials(profile?.display_name || userEmail)}
                </div>
                <div style={{ textAlign: "left", display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text)" }}>
                    {profile?.display_name || userEmail || "Platform Admin"}
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                    {roleLabel(userRole, Auth.getPrincipalType())}
                  </span>
                </div>
                <ICONS.chevronDown width={14} height={14} style={{ color: "var(--color-muted)" }} />
              </button>

              {userDropdownOpen && (
                <div
                  className="user-dropdown-menu"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 8px)",
                    width: "220px",
                    background: "var(--color-surface, #ffffff)",
                    border: "1px solid var(--color-border, #e2e8f0)",
                    borderRadius: "var(--radius, 10px)",
                    boxShadow: "var(--shadow-pop)",
                    padding: "8px 0",
                    zIndex: 1000,
                  }}
                >
                  <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--color-border)" }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text)" }}>
                      {profile?.display_name || "Platform Admin"}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--color-muted)", wordBreak: "break-all" }}>
                      {userEmail}
                    </div>
                    <div style={{ marginTop: "4px" }}>
                      <span className="badge badge-info" style={{ fontSize: "10px" }}>
                        {userRole || "ADMIN"}
                      </span>
                    </div>
                  </div>

                  <div style={{ padding: "4px 0" }}>
                    <Link
                      to="/health"
                      onClick={() => setUserDropdownOpen(false)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "8px 16px",
                        fontSize: "13px",
                        color: "var(--color-text)",
                        textDecoration: "none",
                      }}
                    >
                      <ICONS.settings width={15} height={15} />
                      Platform Settings
                    </Link>
                  </div>

                  <div style={{ borderTop: "1px solid var(--color-border)", padding: "4px 0 0" }}>
                    <button
                      type="button"
                      onClick={handleLogout}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "8px 16px",
                        fontSize: "13px",
                        color: "var(--color-danger, #ef4444)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <ICONS.x width={15} height={15} />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Header slot & Content */}
        <main
          className="content"
          style={{
            flex: 1,
            padding: "24px 32px",
            maxWidth: "1440px",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumb trail={breadcrumbs} />}

          <div
            className="page-header"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "16px",
              marginBottom: "24px",
            }}
          >
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: "24px",
                  fontWeight: 800,
                  color: "var(--color-text)",
                  letterSpacing: "-0.02em",
                }}
              >
                {currentTitle}
              </h1>
            </div>
            {actions && <div className="page-actions" style={{ display: "flex", gap: "10px", alignItems: "center" }}>{actions}</div>}
          </div>

          {children}
        </main>
      </div>
    </div>
  );
}
