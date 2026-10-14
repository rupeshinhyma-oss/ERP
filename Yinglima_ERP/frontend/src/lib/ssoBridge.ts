/**
 * Cross-ERP Unified Single Sign-On (SSO) Bridge for Yinglima ERP.
 *
 * Automatically handles seamless login when Super Admin or Global User switches in from
 * ERP_Main or another ERP, provides quick switching back to the Global Control Panel,
 * and maintains a single unified session_id across the fleet.
 */

import { Auth } from "./auth";
import { apiPost } from "./api";
import { clearEcosystemCookie, getEcosystemCookie, isExplicitlyLoggedOut, setEcosystemCookie, type EcosystemSessionData, verifyCentralEcosystemSession } from "./ecosystemSession";

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
      : erps.find((e) => e.key === "control-plane");
  if (!target || !target.hostUrl || target.hostUrl === "#") {
    const host = typeof window !== "undefined" && window.location.hostname ? window.location.hostname : "localhost";
    return { kind: "redirect", url: createSsoHandoverUrlFromSession(`http://${host}:5170/dashboard`, s) };
  }
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
type HandoverResult = "logged-in" | "already-logged-in" | "not-logged-in";
let handoverInFlight: Promise<HandoverResult> | null = null;

/**
 * Several components (App, AppShell, Login, AuthCallback) ask for the handover on the same page load, and React's
 * development mode runs effects twice.  The exchange runs ONCE per arrival and every caller shares its result, so a
 * redirect started by one caller can never abort another caller's request (that used to surface as "network
 * connection lost" and a flash of the login page).
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

  // 1. Process URL Token if present
  if (token) {
    if (typeof window !== "undefined") {
      urlParams.delete("sso_handover");
      const newQuery = urlParams.toString() ? `?${urlParams.toString()}` : "";
      window.history.replaceState(null, "", `${window.location.pathname}${newQuery}${window.location.hash}`);
    }
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
      }
    } catch (err) {
      console.warn("Could not parse sso_handover token:", err);
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

  // 2. Check if user has permission to access Yinglima ERP
  const hasAccess =
    targetRole === "super_admin" ||
    allowedErps.includes("*") ||
    allowedErps.includes("yinglima");

  if (!hasAccess) {
    console.warn("User is not authorized for Yinglima ERP");
    Auth.clear();
    const centralSession: CentralSessionLike = {
      session_id: targetSessionId,
      role: targetRole,
      email: targetEmail,
      allowed_erps: allowedErps,
    };
    const route = routeForCentralSession("yinglima", centralSession);
    if (route.kind === "redirect" && typeof window !== "undefined") {
      window.location.replace(route.url);
    }
    return "not-logged-in";
  }

  // 3. A fresh handover ticket ALWAYS wins over whatever is stored here (it is a new login, or a different person).
  //    Only the very same login (same session id) is left alone.  Stale or foreign state is cleared first, so an old,
  //    ended session can never block -- or silently replace -- the sign-in the person just made.
  if (Auth.isLoggedIn()) {
    const currentLocalEmail = Auth.getProfile()?.email?.toLowerCase();
    const currentSessionId = Auth.getSessionId();
    const sameEmail = !targetEmail || !currentLocalEmail || currentLocalEmail === targetEmail.toLowerCase();
    if (!hasValidToken) {
      // Only the shared cookie is present (no new ticket).
      if (sameEmail) {
        if (targetSessionId && !currentSessionId) {
          Auth.setSessionId(targetSessionId);
        }
        return "already-logged-in";
      }
      Auth.clear(); // User isolation: the cookie belongs to a different person
    } else if (sameEmail && targetSessionId && currentSessionId === targetSessionId) {
      return "already-logged-in"; // this very login is already open here
    } else {
      Auth.clear(); // a NEW login (or a different person) arrives: it replaces whatever is stored here
    }
  }

  // The ticket to exchange: the one in the URL or -- for cookie-only auto sign-in -- one built from the shared
  // cookie.  Either way THIS ERP asks ERP_Main to verify the central session; no password is ever stored or replayed.
  let ticket: string | null = token;
  if (
    !ticket &&
    targetSessionId &&
    !targetSessionId.startsWith("ihm-sess-") &&
    !targetSessionId.startsWith("loc-")
  ) {
    ticket = btoa(
      JSON.stringify({
        sig: SSO_SIGNATURE,
        ts: Date.now(),
        session_id: targetSessionId,
        email: targetEmail,
        user: targetEmail,
        role: targetRole,
        allowed_erps: allowedErps,
      }),
    );
  }
  if (!ticket) return "not-logged-in";

  try {
    let tokens: TokenPair | null = null;
    const exchange = () =>
      apiPost<TokenPair>("/auth/sso-handover", {
        email: targetEmail,
        sso_token: ticket as string,
        target_erp: "yinglima",
      });
    // Retry only TEMPORARY failures (network, 5xx/503) with growing waits, so a sleeping service has time to wake up.
    // A clear answer (401 ended, 403 no access) is final.
    const retryDelaysMs = [700, 2500, 6000];
    for (let attempt = 0; ; attempt++) {
      try {
        tokens = (await exchange()).data;
        break;
      } catch (attemptError) {
        const attemptStatus = (attemptError as { status?: number })?.status;
        const retryable = attemptStatus === undefined || attemptStatus >= 500;
        if (!retryable || attempt >= retryDelaysMs.length) throw attemptError;
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
      }
    }

    if (tokens?.access_token) {
      const finalSessionId = tokens.session_id || targetSessionId || `ihm-sess-${Date.now()}`;
      Auth.setSession(tokens, tokens.user, finalSessionId);

      // Sync cookie
      const sessionData: EcosystemSessionData = {
        session_id: finalSessionId,
        email: tokens.user?.email || targetEmail,
        display_name: tokens.user?.username || targetEmail.split("@")[0],
        role: targetRole,
        user_type: targetRole === "super_admin" ? "platform_admin" : "global_user",
        allowed_erps: Array.from(new Set([...allowedErps, "yinglima"])),
      };
      setEcosystemCookie(sessionData);
      return "logged-in";
    }
  } catch (err: any) {
    const status = (err as { status?: number })?.status;
    // Another caller may have completed this very sign-in in the meantime: nothing to report then.
    if (Auth.isLoggedIn() && (!targetSessionId || Auth.getSessionId() === targetSessionId)) {
      return "already-logged-in";
    }
    console.warn("Automatic sign-in failed:", status, err);
    const transient = status === undefined || status >= 500;
    if (!transient) Auth.clear();

    let notice: string;
    if (transient) notice = "The sign-in service is temporarily unavailable. Please try again in a moment.";
    else if (status === 401) notice = "Your session has ended. Please sign in again.";
    else if (status === 403) notice = "You do not have access to this ERP.";
    else {
      const reason = String(err?.message || "").trim();
      notice = reason ? `Automatic sign-in did not complete: ${reason}` : "Automatic sign-in did not complete. Please sign in.";
    }
    try {
      sessionStorage.setItem("ihm_login_notice", notice);
    } catch {
      /* storage unavailable: the login page simply shows no notice */
    }
    if (status === 401) clearEcosystemCookie(targetSessionId); // that central session is gone: do not try it again

    // Only a clear "no access to THIS ERP" re-routes the person to an ERP they CAN use; every other failure stays
    // here, on the login page, with the reason shown.
    if (status === 403 && typeof window !== "undefined") {
      const centralCookie = getEcosystemCookie();
      const effectiveAllowed = (centralCookie?.allowed_erps || allowedErps || []).map((k) => String(k).toLowerCase());
      const realAllowed = effectiveAllowed.filter((k) => k !== "control-plane" && k !== "*" && k !== "yinglima");
      const centralSession: CentralSessionLike = {
        session_id: centralCookie?.session_id || targetSessionId,
        role: centralCookie?.role || targetRole,
        email: centralCookie?.email || targetEmail,
        allowed_erps: centralCookie?.allowed_erps || allowedErps,
      };
      const erps = getEcosystemErps();
      const peer = realAllowed.length === 1 ? erps.find((e) => e.key === realAllowed[0]) : undefined;
      const control = erps.find((e) => e.key === "control-plane");
      const destination = peer?.hostUrl || control?.hostUrl;
      if (destination) {
        const sep = destination.includes("?") ? "&" : "?";
        window.location.replace(
          createSsoHandoverUrlFromSession(peer ? destination : `${destination}${sep}sso_error=no_access`, centralSession),
        );
      }
    }
    return "not-logged-in";
  }

  return "not-logged-in";
}

export type SwitchPlan = { ok: true; url: string } | { ok: false; message: string; sessionEnded?: boolean };

/**
 * Check BEFORE leaving the page that a switch can work, so the person gets a clear message here instead of landing on
 * the other ERP's login page: the address must be configured, the sign-in must be a central session (not an
 * ERP-only one), and that session must not have ended.
 */
export async function planSwitch(targetBaseUrl: string, targetPath?: string): Promise<SwitchPlan> {
  if (!targetBaseUrl) {
    return { ok: false, message: "This ERP's address is not configured for this site. Please contact your administrator." };
  }
  const sid = Auth.getSessionId() || getEcosystemCookie()?.session_id;
  if (!sid || sid.startsWith("ihm-sess-") || sid.startsWith("loc-")) {
    return {
      ok: false,
      message: "This sign-in is only valid inside this ERP. Sign out and sign in again to switch between ERPs.",
    };
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
    for (const erp of getEcosystemErps()) {
      if (erp.apiUrl) void fetch(`${erp.apiUrl}/health/live`, { mode: "no-cors", cache: "no-store" }).catch(() => undefined);
    }
  } catch {
    /* warming is optional */
  }
}
