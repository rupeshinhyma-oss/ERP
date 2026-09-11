/**
 * Cross-ERP Unified Single Sign-On (SSO) Bridge for Yinglima ERP.
 *
 * Automatically handles seamless login when Super Admin switches in from
 * ERP_Main or another ERP, and provides quick switching back to the Global Control Panel.
 */

import { Auth } from "./auth";
import { apiPost } from "./api";
import type { TokenPair } from "@/types";

export interface SsoHandoverPayload {
  role: "super_admin" | "admin" | "platform_admin";
  user: string;
  email: string;
  ts: number;
  sig: string;
}

const SSO_SIGNATURE = "ihm_erp_sso_v1";
const SSO_VALIDITY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export const ECOSYSTEM_ERPS = [
  { key: "control-plane", name: "Global Control Panel", hostUrl: "http://localhost:5170/erps/switcher", badge: "Control Plane" },
  { key: "yinglima", name: "Yinglima ERP", hostUrl: "http://localhost:5173/dashboard", badge: "Active Port 5173" },
  { key: "inhyma", name: "Inhyma ERP", hostUrl: "http://localhost:5174/dashboard", badge: "Active Port 5174" },
];

/**
 * Creates an SSO handover URL for switching to another ERP or Global Control Panel.
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
 * Consumes an incoming SSO handover ticket when switching into Yinglima ERP.
 * Automatically logs in as local Admin and stores session tokens.
 */
export async function processIncomingSsoHandover(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("sso_handover");
  if (!token) return false;

  try {
    const json = atob(token);
    const payload: SsoHandoverPayload = JSON.parse(json);

    if (payload.sig === SSO_SIGNATURE && Date.now() - payload.ts < SSO_VALIDITY_WINDOW_MS) {
      // If not already logged in as super_admin, establish local session
      if (!Auth.isLoggedIn() || !Auth.isSuperAdmin()) {
        const { data: tokens } = await apiPost<TokenPair>("/auth/login", {
          identifier: "admin",
          password: "ChangeMe!12345",
        });

        if (tokens?.access_token) {
          Auth.setSession(tokens, tokens.user);
        }
      }

      // Clean the query parameter from address bar
      urlParams.delete("sso_handover");
      const newQuery = urlParams.toString() ? `?${urlParams.toString()}` : "";
      window.history.replaceState(null, "", `${window.location.pathname}${newQuery}${window.location.hash}`);
      return true;
    }
  } catch (err) {
    console.warn("Could not process SSO handover in Yinglima ERP:", err);
  }

  return false;
}
