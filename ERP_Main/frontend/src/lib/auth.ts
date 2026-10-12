/**
 * Session + Authentication Store for ERP_Main Control Plane.
 *
 * Supports both Global Users (Phase 4 /user-auth) and Platform Administrators (Phase 3 /auth).
 * Implements reactive pub/sub so session and permission changes immediately
 * notify active UI components.
 */

import type { GlobalUserProfile, PlatformAdmin, PrincipalType } from "@/types";

const ACCESS_TOKEN_KEY = "erp_main_access_token";
const PROFILE_KEY = "erp_main_profile";
const PRINCIPAL_TYPE_KEY = "erp_main_principal_type";
const EXPIRES_AT_KEY = "erp_main_expires_at";
const SESSION_ID_KEY = "erp_main_session_id";

export type CurrentUser = GlobalUserProfile | PlatformAdmin;

type SessionListener = (profile: CurrentUser | null) => void;
type ExpiryListener = () => void;

const sessionListeners = new Set<SessionListener>();
const expiryListeners = new Set<ExpiryListener>();

function notifySession(profile: CurrentUser | null): void {
  sessionListeners.forEach((listener) => listener(profile));
}

function notifyExpiry(): void {
  expiryListeners.forEach((listener) => listener());
}

export const Auth = {
  subscribe(listener: SessionListener): () => void {
    sessionListeners.add(listener);
    return () => sessionListeners.delete(listener);
  },

  onExpire(listener: ExpiryListener): () => void {
    expiryListeners.add(listener);
    return () => expiryListeners.delete(listener);
  },

  getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  },

  getPrincipalType(): PrincipalType | null {
    return (localStorage.getItem(PRINCIPAL_TYPE_KEY) as PrincipalType) || null;
  },

  getSessionId(): string | null {
    return localStorage.getItem(SESSION_ID_KEY);
  },

  setSessionId(sessionId: string): void {
    localStorage.setItem(SESSION_ID_KEY, sessionId);
  },

  getExpiresAt(): Date | null {
    const raw = localStorage.getItem(EXPIRES_AT_KEY);
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  },

  isExpired(): boolean {
    // Sessions never expire automatically - they only end when user explicitly logs out.
    return false;
  },

  getProfile(): CurrentUser | null {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as CurrentUser;
      if (
        parsed &&
        typeof parsed === "object" &&
        "display_name" in parsed &&
        ((parsed as any).display_name === "Platform Super Admin" ||
          (parsed as any).display_name === "Platform SuperAdmin")
      ) {
        (parsed as any).display_name = "Super Admin";
      }
      return parsed;
    } catch {
      return null;
    }
  },

  getGlobalUser(): GlobalUserProfile | null {
    if (this.getPrincipalType() === "global_user") {
      return this.getProfile() as GlobalUserProfile | null;
    }
    return null;
  },

  getPlatformAdmin(): PlatformAdmin | null {
    if (this.getPrincipalType() === "platform_admin") {
      return this.getProfile() as PlatformAdmin | null;
    }
    return null;
  },

  setSession(
    token: string,
    profile?: CurrentUser,
    principalType?: PrincipalType,
    expiresAt?: string,
    sessionId?: string
  ): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
    const resolvedType =
      principalType || (profile && "role" in profile ? "platform_admin" : "global_user");
    localStorage.setItem(PRINCIPAL_TYPE_KEY, resolvedType);

    // Sessions are persistent until user logs out - store far-future expiry
    const perpetualExp = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000).toISOString();
    localStorage.setItem(EXPIRES_AT_KEY, expiresAt || perpetualExp);

    if (sessionId) {
      localStorage.setItem(SESSION_ID_KEY, sessionId);
    }

    if (profile) {
      this.updateProfile(profile);
    } else {
      notifySession(null);
    }
  },

  updateProfile(profile: CurrentUser): void {
    if (
      profile &&
      typeof profile === "object" &&
      "display_name" in profile &&
      ((profile as any).display_name === "Platform Super Admin" ||
        (profile as any).display_name === "Platform SuperAdmin")
    ) {
      (profile as any).display_name = "Super Admin";
    }
    const oldRaw = localStorage.getItem(PROFILE_KEY);
    const nextRaw = JSON.stringify(profile);
    localStorage.setItem(PROFILE_KEY, nextRaw);
    if (oldRaw !== nextRaw) {
      notifySession(profile);
    }
  },

  triggerExpired(): void {
    notifyExpiry();
  },

  clear(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(PRINCIPAL_TYPE_KEY);
    localStorage.removeItem(EXPIRES_AT_KEY);
    localStorage.removeItem(SESSION_ID_KEY);
    notifySession(null);
  },

  isLoggedIn(): boolean {
    return Boolean(this.getAccessToken());
  },

  isSuperAdmin(): boolean {
    const profile = this.getProfile();
    if (!profile) return false;
    if ("role" in profile && (profile.role === "SUPER_ADMIN" || profile.role === "PLATFORM_SUPER_ADMIN")) {
      return true;
    }
    const userRole = (profile as any).role || (profile as any).metadata?.role;
    if (userRole === "PLATFORM_SUPER_ADMIN" || userRole === "SUPER_ADMIN") {
      return true;
    }
    if (Array.isArray((profile as any).permissions) && (profile as any).permissions.includes("*")) {
      return true;
    }
    return false;
  },

  hasPermission(permissionKey?: string | null): boolean {
    // If no permission is required (e.g. Dashboard), access is granted
    if (!permissionKey) return true;
    if (this.isSuperAdmin()) return true;

    const profile = this.getProfile();
    if (!profile) return false;

    // Check explicit permissions array in profile if present
    if (Array.isArray((profile as any).permissions)) {
      const perms = (profile as any).permissions as string[];
      if (perms.includes("*") || perms.includes(permissionKey)) {
        return true;
      }
    }

    // PlatformAdmin principal
    const admin = this.getPlatformAdmin();
    if (admin && admin.is_active) {
      if (admin.role === "SUPER_ADMIN") return true;
      if (admin.role === "PLATFORM_ADMIN") {
        return permissionKey.startsWith("platform.user.") || permissionKey === "platform.audit.view";
      }
      if (admin.role === "OPERATOR") {
        return (permissionKey.startsWith("platform.user.") && permissionKey !== "platform.user.disable") || permissionKey === "platform.audit.view";
      }
      if (admin.role === "AUDITOR") {
        return permissionKey === "platform.user.read" || permissionKey === "platform.audit.view";
      }
    }

    // GlobalUser principal
    const user = this.getGlobalUser();
    if (user && user.status === "ACTIVE") {
      const role = (user as any).role || (user as any).metadata?.role;
      // If user has NO role / "NONE" / "" -> strictly NO platform permissions!
      if (!role || role === "NONE" || role === "none" || role === "") {
        return false;
      }
      if (role === "PLATFORM_SUPER_ADMIN" || role === "SUPER_ADMIN") return true;
      if (role === "PLATFORM_ADMIN") {
        return permissionKey.startsWith("platform.user.") || permissionKey === "platform.audit.view";
      }
      if (role === "PLATFORM_OPERATOR") {
        return (permissionKey.startsWith("platform.user.") && permissionKey !== "platform.user.disable") || permissionKey === "platform.audit.view";
      }
      if (role === "PLATFORM_VIEWER") {
        return permissionKey === "platform.user.read" || permissionKey === "platform.audit.view";
      }
    }

    return false;
  },
};

export function initials(name?: string | null): string {
  if (!name) return "CP";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function roleLabel(role?: string | null, principalType?: PrincipalType | null): string {
  if (!role || role === "NONE" || role === "none" || role === "") {
    return principalType === "global_user" ? "• None" : "Platform Administrator";
  }
  if (role === "SUPER_ADMIN" || role === "PLATFORM_SUPER_ADMIN") return "Super Admin";
  if (role === "PLATFORM_ADMIN") return "Platform Admin";
  if (role === "AUDITOR") return "Platform Auditor";
  if (role === "OPERATOR" || role === "PLATFORM_OPERATOR") return "Platform Operator";
  if (role === "PLATFORM_VIEWER") return "Platform Viewer";
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
