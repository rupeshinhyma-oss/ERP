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

/**
 * Creates an SSO handover launch URL targeting any registered ERP.
 * Automatically passes the active unified session_id.
 */
export function createSsoHandoverUrl(targetBaseUrl: string, targetPath?: string): string {
  if (!targetBaseUrl) return "#";

  const currentSessionId = Auth.getSessionId() || getEcosystemCookie()?.session_id;
  const currentCookie = getEcosystemCookie();

  const payload: SsoHandoverPayload = {
    role: (currentCookie?.role as any) || "super_admin",
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
 * Automatically authenticates as Platform Super Admin or Global User without requiring credentials.
 */
export async function processIncomingSsoHandover(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("sso_handover");
  const cookieSession = getEcosystemCookie();

  let targetSessionId = cookieSession?.session_id;
  let targetRole = cookieSession?.role || "super_admin";
  let targetEmail = cookieSession?.email || "admin@example.com";
  let allowedErps = cookieSession?.allowed_erps || ["*"];

  // 1. Process URL token if present
  if (token) {
    try {
      const json = atob(token);
      const payload: SsoHandoverPayload = JSON.parse(json);

      if (payload.sig === SSO_SIGNATURE && Date.now() - payload.ts < SSO_VALIDITY_WINDOW_MS) {
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

  // 2. Establish local session in ERP_Main if not already authenticated
  if (!Auth.isLoggedIn()) {
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
          display_name: "Platform Super Admin",
          role: targetRole,
          user_type: "platform_admin",
          allowed_erps: allowedErps,
        };
        setEcosystemCookie(sessionData);
        return true;
      }
    } catch (err) {
      console.warn("Auto-login in ERP_Main failed:", err);
    }
  } else {
    if (targetSessionId && !Auth.getSessionId()) {
      const currentProfile = Auth.getProfile();
      const currentToken = Auth.getAccessToken();
      if (currentToken) {
        Auth.setSession(currentToken, currentProfile || undefined, Auth.getPrincipalType() || undefined, undefined, targetSessionId);
      }
    }
    return true;
  }

  return false;
}
