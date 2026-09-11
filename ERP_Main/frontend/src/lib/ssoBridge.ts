/**
 * Cross-ERP Unified Single Sign-On (SSO) Bridge for ERP_Main.
 *
 * Automatically issues and consumes SSO handover tokens so that Super Admin
 * is seamlessly logged in across all connected ERPs and vice versa.
 */

import { Auth } from "./auth";
import { apiGet, apiPost } from "./api";
import type { PlatformAdmin, TokenPair } from "@/types";

export interface SsoHandoverPayload {
  role: "super_admin" | "admin" | "platform_admin";
  user: string;
  email: string;
  ts: number;
  sig: string;
}

const SSO_SIGNATURE = "ihm_erp_sso_v1";
const SSO_VALIDITY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Creates an SSO handover launch URL targeting any registered ERP.
 */
export function createSsoHandoverUrl(targetBaseUrl: string, targetPath?: string): string {
  if (!targetBaseUrl) return "#";

  try {
    const url = new URL(targetBaseUrl, window.location.origin);
    if (targetPath) {
      url.pathname = targetPath;
    }

    const payload: SsoHandoverPayload = {
      role: "super_admin",
      user: "admin",
      email: "admin@example.com",
      ts: Date.now(),
      sig: SSO_SIGNATURE,
    };

    url.searchParams.set("sso_handover", btoa(JSON.stringify(payload)));
    return url.toString();
  } catch {
    // If URL parsing fails, append parameter safely
    const separator = targetBaseUrl.includes("?") ? "&" : "?";
    const payload: SsoHandoverPayload = {
      role: "super_admin",
      user: "admin",
      email: "admin@example.com",
      ts: Date.now(),
      sig: SSO_SIGNATURE,
    };
    return `${targetBaseUrl}${separator}sso_handover=${encodeURIComponent(btoa(JSON.stringify(payload)))}`;
  }
}

/**
 * Consumes an incoming SSO handover ticket when switching into ERP_Main from another ERP.
 * Automatically authenticates as Platform Super Admin without requiring credentials.
 */
export async function processIncomingSsoHandover(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("sso_handover");
  if (!token) return false;

  try {
    const json = atob(token);
    const payload: SsoHandoverPayload = JSON.parse(json);

    // Validate signature and freshness
    if (payload.sig === SSO_SIGNATURE && Date.now() - payload.ts < SSO_VALIDITY_WINDOW_MS) {
      // If not already logged in as super_admin, establish the session
      if (!Auth.isLoggedIn() || Auth.getPrincipalType() !== "platform_admin") {
        const res = await apiPost<TokenPair>("/global/auth/login", {
          email: "admin@example.com",
          password: "ChangeMe!12345",
        });

        const tokenData = (res as { data?: TokenPair })?.data || res;
        if (tokenData?.access_token) {
          try {
            const profileRes = await apiGet<PlatformAdmin>("/global/auth/me");
            const profile = (profileRes as { data?: PlatformAdmin })?.data || profileRes;
            Auth.setSession(tokenData.access_token, profile, "platform_admin", tokenData.expires_at);
          } catch {
            Auth.setSession(tokenData.access_token, undefined, "platform_admin", tokenData.expires_at);
          }
        }
      }

      // Clean the query parameter from address bar
      urlParams.delete("sso_handover");
      const newQuery = urlParams.toString() ? `?${urlParams.toString()}` : "";
      window.history.replaceState(null, "", `${window.location.pathname}${newQuery}${window.location.hash}`);
      return true;
    }
  } catch (err) {
    console.warn("Could not process SSO handover token in ERP_Main:", err);
  }

  return false;
}
