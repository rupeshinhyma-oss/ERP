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
  isExplicitlyLoggedOut,
  clearEcosystemCookie,
  verifyCentralEcosystemSession,
  type EcosystemSessionData,
} from "./ecosystemSession";
import type { PlatformAdmin } from "@/types";

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

/** What ERP_Main decided about where a person belongs (see backend global_auth/landing.py). */
export interface LandingErp {
  key: string;
  name: string;
  url?: string | null;
}
export interface Landing {
  mode: "admin" | "dashboard" | "single" | "multi";
  target: LandingErp | null;
  erps: LandingErp[];
  control_plane_url?: string | null;
}

/**
 * ERP_Main's own LIVE decision for the signed-in session (null when it cannot be had: local standalone session,
 * network trouble, older server). Also refreshes the shared cookie's ERP list, which the ERP switcher reads.
 */
export async function fetchLanding(): Promise<Landing | null> {
  const sid = Auth.getSessionId() || getEcosystemCookie()?.session_id;
  if (!sid || sid.startsWith("ihm-sess-") || sid.startsWith("loc-")) return null;
  const live = await verifyCentralEcosystemSession(sid);
  const session = live.session as unknown as { allowed_erps?: string[]; landing?: Landing | null } | undefined;
  if (!session) return null;
  const cookie = getEcosystemCookie();
  if (cookie && Array.isArray(session.allowed_erps)) {
    setEcosystemCookie({ ...cookie, allowed_erps: session.allowed_erps } as EcosystemSessionData);
  }
  return session.landing ?? null;
}

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

  const controlPlaneHost =
    import.meta.env.VITE_CONTROL_PLANE_URL ||
    (typeof window !== "undefined" && window.location.origin
      ? `${window.location.origin}/dashboard`
      : isLocal
        ? `http://${host}:5170/dashboard`
        : "#");

  const controlPlaneApi =
    import.meta.env.VITE_CONTROL_PLANE_API_URL ||
    (import.meta.env.VITE_API_ORIGIN
      ? `${import.meta.env.VITE_API_ORIGIN.replace(/\/+$/, "")}/api/v1`
      : isLocal
        ? `http://${host}:8000/api/v1`
        : undefined);

  const yinglimaHost =
    import.meta.env.VITE_YINGLIMA_URL || (isLocal ? `http://${host}:5173/dashboard` : "");
  const yinglimaApi =
    import.meta.env.VITE_YINGLIMA_API_URL || (isLocal ? `http://${host}:8001/api/v1` : undefined);

  const inhymaHost =
    import.meta.env.VITE_INHYMA_URL || (isLocal ? `http://${host}:5174/dashboard` : "");
  const inhymaApi =
    import.meta.env.VITE_INHYMA_API_URL || (isLocal ? `http://${host}:8002/api/v1` : undefined);

  return [
    { key: "control-plane", id: "control-plane", name: "ERP Dashboard", hostUrl: controlPlaneHost, apiUrl: controlPlaneApi, badge: "Control Plane" },
    { key: "yinglima", id: "erp-02", name: "ERP 2", hostUrl: yinglimaHost, apiUrl: yinglimaApi, badge: "Yinglima ERP" },
    { key: "inhyma", id: "erp-01", name: "ERP 1", hostUrl: inhymaHost, apiUrl: inhymaApi, badge: "Inhyma ERP" },
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
  userOverride?: { email?: string; user?: string; role?: string | null; allowed_erps?: string[]; session_id?: string }
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

/**
 * Resolves direct SSO handover launch URL for a single assigned ERP membership.
 */
export function resolveSingleErpDirectUrl(
  membership: {
    erp_key?: string;
    erp_name?: string;
    erp_display_name?: string;
    erp_instance_id?: string;
  },
  userContext?: {
    email?: string;
    display_name?: string;
    role?: string | null;
    session_id?: string;
    allowed_erps?: string[];
  }
): string | null {
  const host = typeof window !== "undefined" && window.location.hostname ? window.location.hostname : "127.0.0.1";
  const isLocal = isLocalhost(host);

  let erpKey = (membership.erp_key || membership.erp_display_name || membership.erp_name || "").toLowerCase().trim();
  if (!erpKey && userContext?.allowed_erps) {
    const fromContext = userContext.allowed_erps.find((k) => k && k !== "*" && k !== "control-plane");
    if (fromContext) {
      erpKey = fromContext.toLowerCase().trim();
    }
  }

  if (!erpKey) return null;

  let targetHostUrl = "";
  let cleanErpKey = "";
  if (erpKey.includes("yinglima")) {
    targetHostUrl = import.meta.env.VITE_YINGLIMA_URL || (isLocal ? `http://${host}:5173/dashboard` : "");
    cleanErpKey = "yinglima";
  } else if (erpKey.includes("inhyma")) {
    targetHostUrl = import.meta.env.VITE_INHYMA_URL || (isLocal ? `http://${host}:5174/dashboard` : "");
    cleanErpKey = "inhyma";
  } else {
    const matched = getEcosystemErps().find(
      (e) => e.key !== "control-plane" && (e.key.toLowerCase() === erpKey || e.key.toLowerCase().includes(erpKey) || erpKey.includes(e.key.toLowerCase()))
    );
    if (matched) {
      targetHostUrl = matched.hostUrl;
      cleanErpKey = matched.key;
    }
  }

  if (!targetHostUrl || !cleanErpKey) return null;
  return createSsoHandoverUrl(
    targetHostUrl,
    undefined,
    userContext
      ? {
        email: userContext.email,
        user: userContext.display_name,
        role: userContext.role || undefined,
        session_id: userContext.session_id,
        allowed_erps: [cleanErpKey],
      }
      : {
        allowed_erps: [cleanErpKey],
      }
  );
}

interface ExchangeResult {
  principal_type: "platform_admin" | "global_user";
  access_token: string;
  expires_at?: string;
  session?: Partial<EcosystemSessionData>;
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
type HandoverResult = "logged-in" | "already-logged-in" | "not-logged-in";
let handoverInFlight: Promise<HandoverResult> | null = null;

/**
 * App, AppShell and Login all ask for the handover on the same page load (and React's development mode runs effects
 * twice).  The exchange runs ONCE per arrival and every caller shares its result, so one caller's redirect can never
 * abort another caller's request.
 */
export function processIncomingSsoHandover(): Promise<HandoverResult> {
  if (!handoverInFlight) {
    // Let the login page show "Signing you in..." while a ticket is being exchanged (a sleeping service can take a while).
    try {
      if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("sso_handover")) {
        sessionStorage.setItem("ihm_handover_pending", "1");
      }
    } catch {
      /* storage unavailable: no progress banner */
    }
    handoverInFlight = runIncomingSsoHandover().finally(() => {
      try {
        sessionStorage.removeItem("ihm_handover_pending");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        handoverInFlight = null;
      }, 1500);
    });
  }
  return handoverInFlight;
}

/** Tests only: forget the shared result so the next call runs a fresh exchange. */
export function resetIncomingSsoHandoverForTests(): void {
  handoverInFlight = null;
}

async function runIncomingSsoHandover(): Promise<HandoverResult> {
  if (typeof window === "undefined") return "not-logged-in";

  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("sso_handover");
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
  const isExplicitLogout = isExplicitlyLoggedOut(targetSessionId);
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
    const profile = Auth.getProfile();
    const currentLocalEmail = (
      (profile && ("primary_email" in profile ? profile.primary_email : profile.email)) || ""
    ).toLowerCase();
    const currentSessionId = Auth.getSessionId();
    const sameEmail = !targetEmail || !currentLocalEmail || currentLocalEmail === targetEmail.toLowerCase();
    if (!hasValidToken) {
      // Only the shared cookie is present (no new ticket).
      if (sameEmail) {
        if (targetSessionId && !currentSessionId) {
          const currentProfile = Auth.getProfile();
          const currentToken = Auth.getAccessToken();
          if (currentToken) {
            Auth.setSession(currentToken, currentProfile || undefined, Auth.getPrincipalType() || undefined, undefined, targetSessionId);
          }
        }
        return "already-logged-in";
      }
      Auth.clear(); // User isolation: the cookie belongs to a different person
    } else if (sameEmail && targetSessionId && currentSessionId === targetSessionId) {
      return "already-logged-in"; // this very login is already open here
    } else {
      // A fresh handover ALWAYS wins: it is a new login (or a different person).  Stale or foreign saved state is
      // cleared so an old, ended session can never block -- or silently replace -- the sign-in just made.
      Auth.clear();
    }
  }

  // 3. Sign THIS person in to ERP_Main.  The handover only carries a central session id; ERP_Main
  //    verifies it server-side and issues a token for that same person (an admin gets an admin token, a
  //    normal user gets a token with exactly their own access) -- never a shared/hard-coded login.
  if (!targetSessionId || targetSessionId.startsWith("ihm-sess-")) {
    return "not-logged-in";
  }
  try {
    const exchange = () =>
      apiPost<ExchangeResult>("/global/ecosystem-session/exchange", {
        session_id: targetSessionId as string,
        email: targetEmail,
      });
    // Retry only TEMPORARY failures (network, 5xx/503) with growing waits; a clear answer (401/403) is final.
    let res: Awaited<ReturnType<typeof exchange>> | undefined;
    const retryDelaysMs = [700, 2500, 6000];
    for (let attempt = 0; ; attempt++) {
      try {
        res = await exchange();
        break;
      } catch (attemptError) {
        const attemptStatus = (attemptError as { status?: number })?.status;
        const retryable = attemptStatus === undefined || attemptStatus >= 500;
        if (!retryable || attempt >= retryDelaysMs.length) throw attemptError;
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
      }
    }
    const data = (res as { data?: ExchangeResult })?.data || (res as unknown as ExchangeResult);
    if (data?.access_token) {
      const principal = data.principal_type === "platform_admin" ? "platform_admin" : "global_user";
      Auth.setSession(data.access_token, undefined, principal, data.expires_at, targetSessionId);
      try {
        const profileRes = await apiGet<Record<string, unknown>>(
          principal === "platform_admin" ? "/global/auth/me" : "/global/user-auth/me"
        );
        const profile = ((profileRes as { data?: unknown })?.data || profileRes) as PlatformAdmin;
        Auth.updateProfile(profile);
      } catch {
        /* the session is valid; the profile loads on the next refresh */
      }

      const live = data.session;
      const sessionData: EcosystemSessionData = {
        session_id: targetSessionId,
        email: live?.email || targetEmail,
        display_name: live?.display_name || "User",
        role: (live?.role as EcosystemSessionData["role"]) || targetRole,
        user_type:
          (live?.user_type as EcosystemSessionData["user_type"]) ||
          (principal === "platform_admin" ? "platform_admin" : "global_user"),
        allowed_erps: live?.allowed_erps || allowedErps,
      };
      setEcosystemCookie(sessionData);
      return "logged-in";
    }
  } catch (err) {
    const status = (err as { status?: number })?.status;
    // Another caller may have completed this very sign-in in the meantime: nothing to report then.
    if (Auth.isLoggedIn() && Auth.getSessionId() === targetSessionId) return "already-logged-in";
    console.warn("Could not sign in to ERP_Main from the central session:", status, err);
    const transient = status === undefined || status >= 500;
    let notice: string;
    if (transient) notice = "The sign-in service is temporarily unavailable. Please try again in a moment.";
    else if (status === 401 || status === 403) notice = "Your session has ended or could not be verified. Please sign in again.";
    else {
      const reason = String((err as { message?: string })?.message || "").trim();
      notice = reason ? `Automatic sign-in did not complete: ${reason}` : "Automatic sign-in did not complete. Please sign in.";
    }
    try {
      sessionStorage.setItem("ihm_login_notice", notice);
    } catch {
      /* storage unavailable: the login page simply shows no notice */
    }
    if (status === 401) clearEcosystemCookie(targetSessionId); // that central session is gone: do not try it again
  }

  return "not-logged-in";
}

export type SwitchPlan = { ok: true; url: string } | { ok: false; message: string; sessionEnded?: boolean };

/**
 * Check BEFORE leaving the page that a switch can work, so the person gets a clear message here instead of landing on
 * the other ERP's login page: the address must be configured, the sign-in must be a central session, and that
 * session must not have ended.
 */
export async function planSwitch(targetBaseUrl: string, targetPath?: string): Promise<SwitchPlan> {
  if (!targetBaseUrl) {
    return { ok: false, message: "This ERP's address is not configured for this site. Please contact your administrator." };
  }
  const sid = Auth.getSessionId() || getEcosystemCookie()?.session_id;
  if (!sid || sid.startsWith("ihm-sess-") || sid.startsWith("loc-")) {
    return { ok: false, message: "This sign-in is only valid here. Sign out and sign in again to switch between ERPs." };
  }
  const state = await verifyCentralEcosystemSession(sid);
  if (state.revoked === true) {
    return { ok: false, sessionEnded: true, message: "Your session has ended. Please sign in again." };
  }
  let url = "";
  try {
    url = createSsoHandoverUrl(targetBaseUrl, targetPath);
  } catch {
    url = "";
  }
  if (!url || url === "#") return { ok: false, message: "Could not prepare the switch. Please try again." };
  return { ok: true, url };
}

/** Best-effort wake-up of the other services (hosted free tiers sleep) while the switcher is open. */
export function warmPeerServices(): void {
  try {
    for (const erp of ECOSYSTEM_ERPS) {
      if (erp.apiUrl) void fetch(`${erp.apiUrl}/health/live`, { mode: "no-cors", cache: "no-store" }).catch(() => undefined);
    }
  } catch {
    /* warming is optional */
  }
}