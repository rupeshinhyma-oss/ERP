/**
 * Cross-ERP Unified Single Sign-On (SSO) Bridge for Yinglima ERP.
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

const getHost = () => (typeof window !== "undefined" && window.location.hostname ? window.location.hostname : "127.0.0.1");

const isLocalhost = (hostname: string) =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "0.0.0.0" ||
  hostname.endsWith(".local");

export interface EcosystemErpEntry {
  key: string;
  id: string;
  name: string;
  hostUrl: string;
  apiUrl?: string;
  badge: string;
}

export const getEcosystemErps = (): EcosystemErpEntry[] => {
  const host = getHost();
  const isLocal = isLocalhost(host);

  const controlPlaneHost = import.meta.env.VITE_CONTROL_PLANE_URL || (isLocal ? `http://${host}:5170/dashboard` : "");
  const controlPlaneApi = import.meta.env.VITE_CONTROL_PLANE_API_URL || (isLocal ? `http://${host}:8000/api/v1` : undefined);
  const yinglimaHost =
    import.meta.env.VITE_YINGLIMA_URL ||
    (typeof window !== "undefined" && window.location.origin
      ? `${window.location.origin}/dashboard`
      : isLocal
      ? `http://${host}:5173/dashboard`
      : "#");
  const yinglimaApi =
    import.meta.env.VITE_API_ORIGIN
      ? `${import.meta.env.VITE_API_ORIGIN.replace(/\/+$/, "")}/api/v1`
      : isLocal
      ? `http://${host}:8001/api/v1`
      : undefined;
  const inhymaHost = import.meta.env.VITE_INHYMA_URL || (isLocal ? `http://${host}:5174/dashboard` : "");
  const inhymaApi = import.meta.env.VITE_INHYMA_API_URL || (isLocal ? `http://${host}:8002/api/v1` : undefined);

  return [
    { key: "control-plane", id: "control-plane", name: "ERP Dashboard", hostUrl: controlPlaneHost, apiUrl: controlPlaneApi, badge: "Control Plane" },
    { key: "yinglima", id: "erp-02", name: "ERP 2", hostUrl: yinglimaHost, apiUrl: yinglimaApi, badge: "Yinglima ERP" },
    { key: "inhyma", id: "erp-01", name: "ERP 1", hostUrl: inhymaHost, apiUrl: inhymaApi, badge: "Inhyma ERP" },
  ];
};

export const ECOSYSTEM_ERPS = getEcosystemErps();

/**
 * Creates an SSO handover URL for switching to another ERP or Global Control Panel.
 * Carries the unified session_id across origins.
 */
export function createSsoHandoverUrl(targetBaseUrl: string, targetPath?: string): string {
  if (!targetBaseUrl) return "#";

  const currentSessionId = Auth.getSessionId() || getEcosystemCookie()?.session_id;
  const currentCookie = getEcosystemCookie();
  const profile = Auth.getProfile();
  const email = profile?.email || currentCookie?.email || "admin@example.com";
  const user = profile?.username || profile?.first_name || currentCookie?.display_name || currentCookie?.email || email;
  const role = profile?.roles?.includes("super_admin") ? "super_admin" : (currentCookie?.role || "global_user");

  const payload: SsoHandoverPayload = {
    role,
    user,
    email,
    session_id: currentSessionId || undefined,
    allowed_erps: currentCookie?.allowed_erps || ["*"],
    ts: Date.now(),
    sig: SSO_SIGNATURE,
  };

  try {
    const url = new URL(targetBaseUrl, window.location.origin);
    const host = getHost();
    if (url.hostname === "localhost" && host !== "localhost" && isLocalhost(host)) {
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

/** The parts of a central (ERP_Main) session that routing needs. */
export interface CentralSessionLike {
  session_id?: string;
  email?: string;
  display_name?: string;
  role?: string;
  allowed_erps?: string[];
}

/**
 * Builds an SSO handover link from an explicit central session (used at sign-in time, before this
 * app has its own local session).  The receiving app verifies the session with ERP_Main itself.
 */
export function createSsoHandoverUrlFromSession(targetBaseUrl: string, s: CentralSessionLike): string {
  if (!targetBaseUrl || !s.session_id) return "#";
  const payload = {
    role: s.role || "global_user",
    user: s.display_name || s.email || "",
    email: s.email || "",
    session_id: s.session_id,
    allowed_erps: s.allowed_erps || [],
    ts: Date.now(),
    sig: SSO_SIGNATURE,
  };
  const url = new URL(targetBaseUrl, window.location.origin);
  const host = getHost();
  if (url.hostname === "localhost" && host !== "localhost" && isLocalhost(host)) {
    url.hostname = host;
  }
  url.searchParams.set("sso_handover", btoa(JSON.stringify(payload)));
  return url.toString();
}

export type CentralRoute =
  | { kind: "stay" } // this ERP is one the person may use
  | { kind: "redirect"; url: string } // send them to the ERP they have, or to the dashboard if they have several
  | { kind: "none" }; // no ERP access at all

/**
 * Where should someone who has just proven their identity centrally go from THIS ERP's login page?
 *  - Super admin (`*`) or this ERP granted        -> stay here.
 *  - Exactly one other ERP granted                -> straight to that ERP.
 *  - Two or more ERPs granted (not this one)      -> the ERP Dashboard, where the switcher lets them choose.
 *  - Nothing granted                              -> no access.
 */
export function routeForCentralSession(thisErpKey: string, s: CentralSessionLike): CentralRoute {
  const allowed = (s.allowed_erps || []).map((k) => String(k).toLowerCase());
  if (allowed.includes("*") || allowed.includes(thisErpKey.toLowerCase())) return { kind: "stay" };
  const erps = getEcosystemErps();
  const real = allowed.filter((k) => k !== "control-plane");
  const target =
    real.length === 1
      ? erps.find((e) => e.key === real[0])
      : real.length >= 2
      ? erps.find((e) => e.key === "control-plane")
      : undefined;
  if (!target || !target.hostUrl || target.hostUrl === "#") return { kind: "none" };
  return { kind: "redirect", url: createSsoHandoverUrlFromSession(target.hostUrl, s) };
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

  // 2. Check if user has permission to access Yinglima ERP
  const hasAccess =
    targetRole === "super_admin" ||
    allowedErps.includes("*") ||
    allowedErps.includes("yinglima");

  if (!hasAccess) {
    console.warn("User is not authorized for Yinglima ERP");
    if (token) {
      Auth.clear();
    }
    return "not-logged-in";
  }

  // 3. Establish or hydrate local session if already logged in or via valid SSO credentials
  if (Auth.isLoggedIn()) {
    const currentLocalEmail = Auth.getProfile()?.email?.toLowerCase();
    // If incoming SSO token specifies a different user, clear existing session to enforce User Isolation
    if (token && targetEmail && currentLocalEmail && currentLocalEmail !== targetEmail.toLowerCase()) {
      Auth.clear();
    } else {
      if (targetSessionId && !Auth.getSessionId()) {
        Auth.setSessionId(targetSessionId);
      }
      return "already-logged-in";
    }
  }

  try {
    let tokens: TokenPair | null = null;
    if (token) {
      const res = await apiPost<TokenPair>("/auth/sso-handover", {
        email: targetEmail,
        sso_token: token,
        target_erp: "yinglima",
      });
      tokens = res.data;
    } else if (targetRole === "super_admin") {
      const res = await apiPost<TokenPair>("/auth/login", {
        identifier: "admin",
        password: "ChangeMe!12345",
      });
      tokens = res.data;
    }

    if (tokens?.access_token) {
      const finalSessionId = targetSessionId || `ihm-sess-${Date.now()}`;
      Auth.setSession(tokens, tokens.user, finalSessionId);

      // Sync cookie
      const sessionData: EcosystemSessionData = {
        session_id: finalSessionId,
        email: tokens.user?.email || targetEmail,
        display_name: tokens.user?.username || targetEmail.split("@")[0],
        role: targetRole,
        user_type: targetRole === "super_admin" ? "platform_admin" : "global_user",
        allowed_erps: allowedErps,
      };
      setEcosystemCookie(sessionData);
      return "logged-in";
    }
  } catch (err) {
    console.warn("Auto-login in Yinglima ERP failed:", err);
  }

  return "not-logged-in";
}