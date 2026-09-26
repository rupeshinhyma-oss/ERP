/**
 * Cross-ERP Unified Single Sign-On (SSO) Bridge for ERP_Main.
 *
 * Automatically issues and consumes SSO handover tokens so that Super Admin
 * and authorized users are seamlessly logged in across all connected ERPs and vice versa.
 */

import { Auth } from "./auth";
import { apiGet, apiPost } from "./api";
import {
  getEcosystemCookie,
  setEcosystemCookie,
  type EcosystemSessionData,
} from "./ecosystemSession";
import type { PlatformAdmin, TokenPair } from "@/types";

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

const getHost = () => (typeof window !== "undefined" && window.location.hostname ? window.location.hostname : "127.0.0.1");

export const getEcosystemErps = () => {
  const host = getHost();
  return [
    { key: "control-plane", name: "ERP Dashboard", hostUrl: `http://${host}:5170/dashboard`, badge: "Control Plane" },
    { key: "yinglima", name: "Yinglima ERP", hostUrl: `http://${host}:5173/dashboard`, badge: "Active Port 5173" },
    { key: "inhyma", name: "Inhyma ERP", hostUrl: `http://${host}:5174/dashboard`, badge: "Active Port 5174" },
  ];
};

export const ECOSYSTEM_ERPS = getEcosystemErps();

/**
 * Creates an SSO handover launch URL targeting any registered ERP.
 * Automatically passes the active unified session_id.
 */
export function createSsoHandoverUrl(
  targetBaseUrl: string,
  targetPath?: string,
  userOverride?: { email?: string; user?: string; role?: string; allowed_erps?: string[]; session_id?: string }
): string {
  if (!targetBaseUrl) return "#";

  const currentSessionId = userOverride?.session_id || Auth.getSessionId() || getEcosystemCookie()?.session_id;
  const currentCookie = getEcosystemCookie();
  const profile = Auth.getProfile();

  const activeEmail =
    userOverride?.email ||
    (profile ? ("primary_email" in profile ? profile.primary_email : (profile as any).email) : "") ||
    currentCookie?.email ||
    "";

  const activeUser =
    userOverride?.user ||
    (profile ? (profile.display_name || (profile as any).username || activeEmail.split("@")[0]) : "") ||
    currentCookie?.display_name ||
    activeEmail.split("@")[0] ||
    "user";

  const activeRole =
    userOverride?.role ||
    (profile ? ("role" in profile ? profile.role : (profile as any).role) : "") ||
    currentCookie?.role ||
    "global_user";

  const payload: SsoHandoverPayload = {
    role: (activeRole as any) || "global_user",
    user: activeUser,
    email: activeEmail,
    session_id: currentSessionId || undefined,
    allowed_erps: userOverride?.allowed_erps || currentCookie?.allowed_erps || ["*"],
    ts: Date.now(),
    sig: SSO_SIGNATURE,
  };

  try {
    const url = new URL(targetBaseUrl, window.location.origin);
    const host = typeof window !== "undefined" && window.location.hostname ? window.location.hostname : "127.0.0.1";
    if (url.hostname === "localhost" && host !== "localhost") {
      url.hostname = host;
    }
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
 * Resolves direct SSO handover launch URL for a single assigned ERP membership.
 */
export function resolveSingleErpDirectUrl(
  membership: {
    erp_key?: string;
    erp_name?: string;
    erp_instance_id?: string;
  },
  userContext?: {
    email?: string;
    display_name?: string;
    role?: string;
    session_id?: string;
    allowed_erps?: string[];
  }
): string | null {
  const host = typeof window !== "undefined" && window.location.hostname ? window.location.hostname : "127.0.0.1";
  const erpKey = (membership.erp_key || membership.erp_name || "").toLowerCase();

  let targetHostUrl = "";
  let cleanErpKey = "";
  if (erpKey.includes("yinglima")) {
    targetHostUrl = `http://${host}:5173/dashboard`;
    cleanErpKey = "yinglima";
  } else if (erpKey.includes("inhyma")) {
    targetHostUrl = `http://${host}:5174/dashboard`;
    cleanErpKey = "inhyma";
  } else {
    const matched = ECOSYSTEM_ERPS.find(
      (e) => e.key !== "control-plane" && (e.key.toLowerCase().includes(erpKey) || erpKey.includes(e.key.toLowerCase()))
    );
    if (matched) {
      targetHostUrl = matched.hostUrl;
      cleanErpKey = matched.key;
    }
  }

  if (!targetHostUrl) return null;
  return createSsoHandoverUrl(
    targetHostUrl,
    undefined,
    userContext
      ? {
          email: userContext.email,
          user: userContext.display_name,
          role: userContext.role,
          session_id: userContext.session_id,
          allowed_erps: userContext.allowed_erps || [cleanErpKey],
        }
      : {
          allowed_erps: [cleanErpKey],
        }
  );
}

/**
 * Consumes an incoming SSO handover ticket or shared ecosystem session cookie.
 * Automatically authenticates as Platform Super Admin or Global User without requiring credentials.
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

  // 1. Process URL token if present
  if (token) {
    try {
      const json = atob(token);
      const payload: SsoHandoverPayload = JSON.parse(json);

      if (payload.sig === SSO_SIGNATURE && Date.now() - payload.ts < SSO_VALIDITY_WINDOW_MS) {
        hasValidToken = true;
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.removeItem("ihm_explicit_logout");
        }
        if (payload.session_id) targetSessionId = payload.session_id;
        if (payload.role) targetRole = payload.role;
        if (payload.email) targetEmail = payload.email;
        if (payload.allowed_erps) allowedErps = payload.allowed_erps;

        // Clean query parameter from address bar
        urlParams.delete("sso_handover");
        const newQuery = urlParams.toString() ? `?${urlParams.toString()}` : "";
        window.history.replaceState(null, "", `${window.location.pathname}${newQuery}${window.location.hash}`);
      }
    } catch (err) {
      console.warn("Could not parse sso_handover in ERP_Main:", err);
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

  // 2. If already logged in locally, ensure session_id is aligned. Nothing
  // about the local session actually changed here, so this reports
  // "already-logged-in" rather than "logged-in" -- a caller reloading the
  // page on every truthy result would otherwise reload every time this
  // runs while already logged in, forever.
  if (Auth.isLoggedIn()) {
    if (targetSessionId && !Auth.getSessionId()) {
      const currentProfile = Auth.getProfile();
      const currentToken = Auth.getAccessToken();
      if (currentToken) {
        Auth.setSession(currentToken, currentProfile || undefined, Auth.getPrincipalType() || undefined, undefined, targetSessionId);
      }
    }
    return "already-logged-in";
  }

  // 3. Establish local session in ERP_Main via auto-login with valid SSO credentials
  try {
    const res = await apiPost<TokenPair>("/global/auth/login", {
      email: "admin@example.com",
      password: "ChangeMe!12345",
    });

    const tokenData = (res as { data?: TokenPair })?.data || res;
    if (tokenData?.access_token) {
      const finalSessionId = targetSessionId || `ihm-sess-${Date.now()}`;
      try {
        const profileRes = await apiGet<PlatformAdmin>("/global/auth/me");
        const profile = (profileRes as { data?: PlatformAdmin })?.data || profileRes;
        Auth.setSession(tokenData.access_token, profile, "platform_admin", tokenData.expires_at, finalSessionId);
      } catch {
        Auth.setSession(tokenData.access_token, undefined, "platform_admin", tokenData.expires_at, finalSessionId);
      }

      // Sync cookie
      const sessionData: EcosystemSessionData = {
        session_id: finalSessionId,
        email: targetEmail,
        display_name: "Super Admin",
        role: targetRole,
        user_type: "platform_admin",
        allowed_erps: allowedErps,
      };
      setEcosystemCookie(sessionData);
      return "logged-in";
    }
  } catch (err) {
    console.warn("Auto-login in ERP_Main failed:", err);
  }

  return "not-logged-in";
}