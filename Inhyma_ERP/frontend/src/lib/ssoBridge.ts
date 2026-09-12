/**
 * Cross-ERP Unified Single Sign-On (SSO) Bridge for Inhyma ERP.
 *
 * Automatically handles seamless login when Super Admin or Global User switches in from
 * ERP_Main or another ERP, provides quick switching back to the Global Control Panel,
 * and maintains a single unified session_id across the fleet.
 */

import { Auth } from "./auth";
import { apiPost } from "./api";
import {
  getEcosystemCookie,
  setEcosystemCookie,
  type EcosystemSessionData,
} from "./ecosystemSession";
import type { TokenPair } from "@/types";

export interface SsoHandoverPayload {
  role: "super_admin" | "admin" | "global_user";
  user: string;
  email: string;
  session_id?: string;
  allowed_erps?: string[];
  ts: number;
  sig: string;
}

const SSO_SIGNATURE = "ihm_erp_sso_v1";
const SSO_VALIDITY_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export const ECOSYSTEM_ERPS = [
  { key: "control-plane", name: "Global Control Panel", hostUrl: "http://localhost:5170/erps/switcher", badge: "Control Plane" },
  { key: "yinglima", name: "Yinglima ERP", hostUrl: "http://localhost:5173/dashboard", badge: "Active Port 5173" },
  { key: "inhyma", name: "Inhyma ERP", hostUrl: "http://localhost:5174/dashboard", badge: "Active Port 5174" },
];

/**
 * Creates an SSO handover URL for switching to another ERP or Global Control Panel.
 * Carries the unified session_id across origins.
 */
export function createSsoHandoverUrl(targetBaseUrl: string, targetPath?: string): string {
  if (!targetBaseUrl) return "#";

  const currentSessionId = Auth.getSessionId() || getEcosystemCookie()?.session_id;
  const currentCookie = getEcosystemCookie();

  const payload: SsoHandoverPayload = {
    role: currentCookie?.role || "super_admin",
    user: currentCookie?.email || "admin",
    email: currentCookie?.email || "admin@example.com",
    session_id: currentSessionId || undefined,
    allowed_erps: currentCookie?.allowed_erps || ["*"],
    ts: Date.now(),
    sig: SSO_SIGNATURE,
  };

  try {
    const url = new URL(targetBaseUrl, window.location.origin);
    if (targetPath) {
      url.pathname = targetPath;
    }
    url.searchParams.set("sso_handover", btoa(JSON.stringify(payload)));
    return url.toString();
  } catch {
    const separator = targetBaseUrl.includes("?") ? "&" : "?";
    return `${targetBaseUrl}${separator}sso_handover=${encodeURIComponent(btoa(JSON.stringify(payload)))}`;
  }
}

/**
 * Consumes an incoming SSO handover ticket or shared ecosystem session cookie.
 * Automatically logs in as local Admin/User with the matching session_id.
 *
 * Returns "already-logged-in" (rather than a plain boolean) when Auth was
 * already logged in on entry -- no new session was actually established,
 * so nothing changed and there is nothing for a caller to react to.
 * Distinguishing this from a genuine fresh auto-login matters: a caller
 * that reloads the page whenever this resolves truthy would otherwise
 * reload on every call once logged in, including calls made right after
 * a reload it just triggered -- an infinite reload loop that repeats the
 * whole login -> establish -> fetch sequence forever. Only "logged-in"
 * (a real state change) should ever trigger a reload/navigation.
 */
export async function processIncomingSsoHandover(): Promise<
  "logged-in" | "already-logged-in" | "not-logged-in"
> {
  if (typeof window === "undefined") return "not-logged-in";

  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("sso_handover");
  const isExplicitLogout = typeof sessionStorage !== "undefined" && sessionStorage.getItem("ihm_explicit_logout") === "true";

  let hasValidToken = false;
  let targetSessionId: string | undefined;
  let targetRole: "super_admin" | "admin" | "global_user" = "super_admin";
  let targetEmail = "admin@example.com";
  let allowedErps = ["*"];

  // 1. Process URL Token if present
  if (token) {
    try {
      const json = atob(token);
      const payload: SsoHandoverPayload = JSON.parse(json);

      if (payload.sig === SSO_SIGNATURE && Date.now() - payload.ts < SSO_VALIDITY_WINDOW_MS) {
        hasValidToken = true;
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.removeItem("ihm_explicit_logout");
        }
        if (payload.session_id) {
          targetSessionId = payload.session_id;
        }
        if (payload.role) {
          targetRole = payload.role;
        }
        if (payload.email) {
          targetEmail = payload.email;
        }
        if (payload.allowed_erps) {
          allowedErps = payload.allowed_erps;
        }

        // Clean query parameter from address bar
        urlParams.delete("sso_handover");
        const newQuery = urlParams.toString() ? `?${urlParams.toString()}` : "";
        window.history.replaceState(null, "", `${window.location.pathname}${newQuery}${window.location.hash}`);
      }
    } catch (err) {
      console.warn("Could not parse sso_handover token:", err);
    }
  }

  // If user explicitly logged out and no new SSO token was provided in the URL, DO NOT auto-login
  if (isExplicitLogout && !hasValidToken) {
    return "not-logged-in";
  }

  const cookieSession = getEcosystemCookie();
  const hasValidCookie = Boolean(cookieSession?.session_id);

  if (!hasValidToken && !hasValidCookie) {
    // Neither an incoming handover ticket nor an active ecosystem session cookie exists:
    // DO NOT auto-login. Remain on the login page.
    return "not-logged-in";
  }

  if (!hasValidToken && cookieSession) {
    targetSessionId = cookieSession.session_id;
    targetRole = cookieSession.role || "super_admin";
    targetEmail = cookieSession.email || "admin@example.com";
    allowedErps = cookieSession.allowed_erps || ["*"];
  }

  // 2. Check if user has permission to access Inhyma ERP
  const hasAccess =
    targetRole === "super_admin" ||
    allowedErps.includes("*") ||
    allowedErps.includes("inhyma");

  if (!hasAccess && !Auth.isLoggedIn()) {
    console.warn("User is not authorized for Inhyma ERP");
    return "not-logged-in";
  }

  // 3. Establish or hydrate local session if already logged in or via valid SSO credentials
  if (Auth.isLoggedIn()) {
    // If already logged in locally, ensure session_id is saved. Nothing
    // about the local session actually changed here, so this reports
    // "already-logged-in" rather than "logged-in" -- a caller reloading
    // the page on every truthy result would otherwise reload every time
    // this runs while already logged in, forever.
    if (targetSessionId && !Auth.getSessionId()) {
      Auth.setSessionId(targetSessionId);
    }
    return "already-logged-in";
  }

  try {
    const { data: tokens } = await apiPost<TokenPair>("/auth/login", {
      identifier: "admin",
      password: "ChangeMe!12345",
    });

    if (tokens?.access_token) {
      const finalSessionId = targetSessionId || `ihm-sess-${Date.now()}`;
      Auth.setSession(tokens, tokens.user, finalSessionId);

      // Sync cookie
      const sessionData: EcosystemSessionData = {
        session_id: finalSessionId,
        email: targetEmail,
        display_name: tokens.user?.username || "Admin",
        role: targetRole,
        user_type: targetRole === "super_admin" ? "platform_admin" : "global_user",
        allowed_erps: allowedErps,
      };
      setEcosystemCookie(sessionData);
      return "logged-in";
    }
  } catch (err) {
    console.warn("Auto-login in Inhyma ERP failed:", err);
  }

  return "not-logged-in";
}