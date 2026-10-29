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

const getHost = () => (typeof window !== "undefined" && window.location.hostname ? window.location.hostname : "");

const isLoopbackHost = (hostname: string): boolean => {
  const h = (hostname || "").trim().toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1" || h === "[::1]";
};

const isPrivateLanIpv4 = (hostname: string): boolean => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec((hostname || "").trim());
  if (!m) return false;
  const [a, b, c, d] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if ([a, b, c, d].some((n) => n < 0 || n > 255)) return false;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
};

export const isLocalNetworkHost = (hostname: string): boolean => {
  const h = (hostname || "").trim().toLowerCase();
  if (!h) return false;
  if (isLoopbackHost(h) || h.endsWith(".local")) return true;
  return isPrivateLanIpv4(h);
};

/**
 * Validates that a candidate URL belongs to the same environment class as the current browser tab
 * (local/LAN vs hosted domain) and adapts loopback hostnames to the active LAN IP when accessed over LAN.
 */
export function sanitizeEnvMatchedUrl(
  candidateUrl: string | null | undefined,
  options?: { ensureDashboardPath?: boolean },
): string {
  const trimmed = (candidateUrl || "").trim();
  if (!trimmed || trimmed === "#") return "";
  try {
    const base = typeof window !== "undefined" && window.location.origin ? window.location.origin : undefined;
    const parsed = base ? new URL(trimmed, base) : new URL(trimmed);
    const browserHost = getHost();
    if (browserHost) {
      if (isLocalNetworkHost(browserHost) !== isLocalNetworkHost(parsed.hostname)) {
        return "";
      }
      if (isLocalNetworkHost(browserHost) && isLoopbackHost(parsed.hostname) && !isLoopbackHost(browserHost)) {
        parsed.hostname = browserHost;
      }
    }
    if (options?.ensureDashboardPath && (parsed.pathname === "" || parsed.pathname === "/")) {
      parsed.pathname = "/dashboard";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

/** What ERP_Main decided about where a person belongs (see ERP_Main global_auth/landing.py). */
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

export interface EcosystemErpEntry {
  key: string;
  id: string;
  name: string;
  hostUrl: string;
  apiUrl?: string;
  badge: string;
}

const landingUrlForKey = (key: string, landing?: Landing | null): string => {
  const k = key.toLowerCase();
  if (k === "control-plane") {
    return landing?.control_plane_url || "";
  }
  return (
    landing?.erps?.find((e) => e.key.toLowerCase() === k)?.url ||
    (landing?.target?.key?.toLowerCase() === k ? landing.target.url || "" : "")
  );
};

export const getEcosystemErps = (landing?: Landing | null): EcosystemErpEntry[] => {
  const controlPlaneHost =
    sanitizeEnvMatchedUrl(import.meta.env.VITE_CONTROL_PLANE_URL, { ensureDashboardPath: true }) ||
    sanitizeEnvMatchedUrl(landing?.control_plane_url, { ensureDashboardPath: true });
  const controlPlaneApi =
    sanitizeEnvMatchedUrl(import.meta.env.VITE_CONTROL_PLANE_API_URL).replace(/\/+$/, "") || undefined;

  const yinglimaHost =
    sanitizeEnvMatchedUrl(import.meta.env.VITE_YINGLIMA_URL, { ensureDashboardPath: true }) ||
    sanitizeEnvMatchedUrl(landingUrlForKey("yinglima", landing), { ensureDashboardPath: true }) ||
    (typeof window !== "undefined" && window.location.origin ? `${window.location.origin}/dashboard` : "");
  const rawYinglimaApi =
    import.meta.env.VITE_YINGLIMA_API_URL ||
    (import.meta.env.VITE_API_ORIGIN ? `${import.meta.env.VITE_API_ORIGIN.replace(/\/+$/, "")}/api/v1` : "");
  const yinglimaApi = sanitizeEnvMatchedUrl(rawYinglimaApi).replace(/\/+$/, "") || undefined;

  const inhymaHost =
    sanitizeEnvMatchedUrl(import.meta.env.VITE_INHYMA_URL, { ensureDashboardPath: true }) ||
    sanitizeEnvMatchedUrl(landingUrlForKey("inhyma", landing), { ensureDashboardPath: true });
  const inhymaApi =
    sanitizeEnvMatchedUrl(import.meta.env.VITE_INHYMA_API_URL).replace(/\/+$/, "") || undefined;

  const entries: EcosystemErpEntry[] = [
    { key: "control-plane", id: "control-plane", name: "ERP Dashboard", hostUrl: controlPlaneHost, apiUrl: controlPlaneApi, badge: "Control Plane" },
    { key: "yinglima", id: "erp-02", name: "ERP 2", hostUrl: yinglimaHost, apiUrl: yinglimaApi, badge: "Yinglima ERP" },
    { key: "inhyma", id: "erp-01", name: "ERP 1", hostUrl: inhymaHost, apiUrl: inhymaApi, badge: "Inhyma ERP" },
  ];

  if (landing?.erps) {
    for (const extra of landing.erps) {
      const k = (extra.key || "").trim().toLowerCase();
      if (!k || entries.some((e) => e.key === k)) continue;
      const hostUrl = sanitizeEnvMatchedUrl(extra.url, { ensureDashboardPath: true });
      entries.push({
        key: k,
        id: k,
        name: extra.name || k,
        hostUrl,
        badge: extra.name || k,
      });
    }
  }

  return entries;
};

export const ECOSYSTEM_ERPS = getEcosystemErps();

/**
 * Creates an SSO handover URL for switching to another ERP or Global Control Panel.
 * Carries the unified session_id across origins.
 */
export function createSsoHandoverUrl(targetBaseUrl: string, targetPath?: string): string {
  const safeBaseUrl = sanitizeEnvMatchedUrl(targetBaseUrl);
  if (!safeBaseUrl) return "#";

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
    const url = new URL(safeBaseUrl, window.location.origin);
    if (targetPath) {
      url.pathname = targetPath;
    }
    url.searchParams.set("sso_handover", btoa(JSON.stringify(payload)));
    return url.toString();
  } catch {
    const separator = safeBaseUrl.includes("?") ? "&" : "?";
    return `${safeBaseUrl}${separator}sso_handover=${encodeURIComponent(btoa(JSON.stringify(payload)))}`;
  }
}

/** The parts of a central (ERP_Main) session that routing needs. */
export interface CentralSessionLike {
  session_id?: string;
  email?: string;
  display_name?: string;
  role?: string;
  allowed_erps?: string[];
  landing?: Landing | null;
}

/** The ERP Dashboard's address: from `.env` configuration first, else an environment-compatible landing URL. */
export function controlPlaneUrl(s?: CentralSessionLike | null): string {
  const fromConfig = getEcosystemErps(s?.landing).find((e) => e.key === "control-plane")?.hostUrl || "";
  if (fromConfig) return fromConfig;
  return sanitizeEnvMatchedUrl(s?.landing?.control_plane_url, { ensureDashboardPath: true });
}

/** An ERP's dashboard address: from `.env` configuration first, else an environment-compatible landing URL. */
export function erpUrlFor(key: string, s?: CentralSessionLike | null): string {
  const k = key.toLowerCase();
  const fromConfig = getEcosystemErps(s?.landing).find((e) => e.key.toLowerCase() === k)?.hostUrl || "";
  if (fromConfig && fromConfig !== "#") return fromConfig;
  const rawLanding = landingUrlForKey(k, s?.landing);
  return sanitizeEnvMatchedUrl(rawLanding, { ensureDashboardPath: true });
}

/**
 * Builds an SSO handover link from an explicit central session (used at sign-in time, before this
 * app has its own local session). The receiving app verifies the session with ERP_Main itself.
 */
export function createSsoHandoverUrlFromSession(targetBaseUrl: string, s: CentralSessionLike): string {
  const safeBaseUrl = sanitizeEnvMatchedUrl(targetBaseUrl);
  if (!safeBaseUrl || !s.session_id) return "#";
  const payload = {
    role: s.role || "global_user",
    user: s.display_name || s.email || "",
    email: s.email || "",
    session_id: s.session_id,
    allowed_erps: s.allowed_erps || [],
    ts: Date.now(),
    sig: SSO_SIGNATURE,
  };
  const url = new URL(safeBaseUrl, window.location.origin);
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
 *  - Exactly one other ERP granted                -> straight to that ERP (within the same environment).
 *  - Two or more ERPs granted (not this one)      -> the ERP Dashboard, where the switcher lets them choose.
 *  - Nothing granted                              -> no access.
 */
export function routeForCentralSession(
  thisErpKey: string,
  s: CentralSessionLike,
  dashboardQuery?: Record<string, string>,
): CentralRoute {
  const here = thisErpKey.toLowerCase();
  const go = (url: string, toDashboard: boolean): CentralRoute => {
    const safeUrl = sanitizeEnvMatchedUrl(url);
    if (!safeUrl) return { kind: "none" };
    let target = safeUrl;
    if (toDashboard && dashboardQuery) {
      try {
        const u = new URL(safeUrl, window.location.origin);
        Object.entries(dashboardQuery).forEach(([k, v]) => u.searchParams.set(k, v));
        target = u.toString();
      } catch {
        /* keep the plain address */
      }
    }
    const handover = createSsoHandoverUrlFromSession(target, s);
    if (!handover || handover === "#") return { kind: "none" };
    return { kind: "redirect", url: handover };
  };

  // 1. ERP_Main's own decision wins for authorization; URLs are resolved strictly within the current environment.
  const L = s.landing;
  if (L && typeof L.mode === "string") {
    if (L.mode === "admin") return { kind: "stay" };
    const mine = (L.erps || []).some((e) => e.key.toLowerCase() === here);
    if (L.mode === "multi") return mine ? { kind: "stay" } : go(controlPlaneUrl(s), true);
    if (L.mode === "single") {
      if (mine) return { kind: "stay" };
      return go(L.target ? erpUrlFor(L.target.key, s) : "", false);
    }
    return go(controlPlaneUrl(s), true); // "dashboard": no ERP access
  }

  // 2. Older ERP_Main without a decision: same rules from the list of allowed ERPs.
  const allowed = (s.allowed_erps || []).map((k) => String(k).toLowerCase());
  if (allowed.includes("*") || allowed.includes(here)) return { kind: "stay" };
  const real = allowed.filter((k) => k !== "control-plane");
  if (real.length === 1) return go(erpUrlFor(real[0], s), false);
  return go(controlPlaneUrl(s), true);
}

/**
 * Re-checks, with ERP_Main, that this person may be in THIS ERP right now, and moves them to where they belong if not
 * (grants and revokes made after sign-in take effect). Throttled to once per 30 s per session and fail-open.
 */
export async function enforceCentralLanding(thisErpKey: string): Promise<"ok" | "redirected" | "unverified"> {
  const cookie = getEcosystemCookie();
  const sid = cookie?.session_id;
  if (!sid || sid.startsWith("ihm-sess-") || sid.startsWith("loc-")) return "unverified";
  const stamp = `ihm_landing_ok_${sid}`;
  try {
    const last = Number(sessionStorage.getItem(stamp) || 0);
    if (last && Date.now() - last < 30_000) return "ok";
  } catch {
    /* storage unavailable: just check */
  }
  const live = await verifyCentralEcosystemSession(sid);
  if (!live.session) return "unverified";
  const session = live.session as unknown as CentralSessionLike;
  if (Array.isArray(session.allowed_erps) && JSON.stringify(session.allowed_erps) !== JSON.stringify(cookie?.allowed_erps)) {
    setEcosystemCookie({ ...cookie, allowed_erps: session.allowed_erps } as EcosystemSessionData);
  }
  const route = routeForCentralSession(thisErpKey, { ...session, session_id: sid, email: session.email || cookie?.email });
  if (route.kind === "redirect" && typeof window !== "undefined") {
    if (Array.isArray(session.allowed_erps)) setEcosystemCookie({ ...cookie, allowed_erps: session.allowed_erps } as EcosystemSessionData);
    Auth.clear();
    window.location.replace(route.url);
    return "redirected";
  }
  try {
    sessionStorage.setItem(stamp, String(Date.now()));
  } catch {
    /* ignore */
  }
  return "ok";
}

type HandoverResult = "logged-in" | "already-logged-in" | "not-logged-in";
let handoverInFlight: Promise<HandoverResult> | null = null;

export function processIncomingSsoHandover(): Promise<HandoverResult> {
  if (!handoverInFlight) {
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
    return "not-logged-in";
  }

  if (!hasValidToken && cookieSession) {
    targetSessionId = cookieSession.session_id;
    targetRole = cookieSession.role || "super_admin";
    targetEmail = cookieSession.email || "admin@example.com";
    allowedErps = cookieSession.allowed_erps || ["*"];
  }

  // 1b. Ask ERP_Main what this session may currently access.
  let landing: Landing | null = null;
  if (targetSessionId && !targetSessionId.startsWith("ihm-sess-") && !targetSessionId.startsWith("loc-")) {
    const live = await verifyCentralEcosystemSession(targetSessionId);
    if (live.revoked === true) {
      clearEcosystemCookie(targetSessionId);
      try {
        sessionStorage.setItem("ihm_login_notice", "Your session has ended. Please sign in again.");
      } catch {
        /* storage unavailable: the login page simply shows no notice */
      }
      return "not-logged-in";
    }
    if (live.session) {
      const liveSession = live.session as unknown as CentralSessionLike;
      if (Array.isArray(liveSession.allowed_erps)) allowedErps = liveSession.allowed_erps;
      if (liveSession.role) targetRole = liveSession.role as typeof targetRole;
      landing = liveSession.landing ?? null;
    }
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
      landing,
    };
    const route = routeForCentralSession("yinglima", centralSession);
    if (route.kind === "redirect" && typeof window !== "undefined") {
      window.location.replace(route.url);
    }
    return "not-logged-in";
  }

  // 3. A fresh handover ticket ALWAYS wins over stale local state.
  if (Auth.isLoggedIn()) {
    const currentLocalEmail = Auth.getProfile()?.email?.toLowerCase();
    const currentSessionId = Auth.getSessionId();
    const sameEmail = !targetEmail || !currentLocalEmail || currentLocalEmail === targetEmail.toLowerCase();
    if (!hasValidToken) {
      if (sameEmail) {
        if (targetSessionId && !currentSessionId) {
          Auth.setSessionId(targetSessionId);
        }
        return "already-logged-in";
      }
      Auth.clear();
    } else if (sameEmail && targetSessionId && currentSessionId === targetSessionId) {
      return "already-logged-in";
    } else {
      Auth.clear();
    }
  }

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
    if (Auth.isLoggedIn() && (!targetSessionId || Auth.getSessionId() === targetSessionId)) {
      return "already-logged-in";
    }
    console.warn("Automatic sign-in failed:", status, err);
    const transient = status === undefined || status >= 500;
    if (!transient) Auth.clear();
    const failureReason = String((err as { message?: string })?.message || "").trim();
    const accountProblem = /no account exists|deleted or disabled in this erp|account is not active|must explicitly grant access/i.test(failureReason);
    const centralSessionEnded = status === 401 && !accountProblem;

    let notice: string;
    if (transient) notice = "The sign-in service is temporarily unavailable. Please try again in a moment.";
    else if (status === 401) notice = centralSessionEnded ? "Your session has ended. Please sign in again." : failureReason || "Sign-in was refused. Please sign in again.";
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
    if (status === 401 && centralSessionEnded) clearEcosystemCookie(targetSessionId);

    if (status === 403 && typeof window !== "undefined") {
      const centralCookie = getEcosystemCookie();
      let centralSession: CentralSessionLike = {
        session_id: centralCookie?.session_id || targetSessionId,
        role: centralCookie?.role || targetRole,
        email: centralCookie?.email || targetEmail,
        allowed_erps: centralCookie?.allowed_erps || allowedErps,
      };
      try {
        const sid = centralSession.session_id;
        if (sid && !sid.startsWith("ihm-sess-") && !sid.startsWith("loc-")) {
          const live = await verifyCentralEcosystemSession(sid);
          if (live.session) centralSession = { ...centralSession, ...(live.session as unknown as CentralSessionLike) };
        }
      } catch {
        /* use the cookie's view */
      }
      const route = routeForCentralSession("yinglima", centralSession, {
        sso_error: "no_access",
        sso_erp: "yinglima",
        sso_reason: failureReason.slice(0, 400),
      });
      if (route.kind === "redirect") window.location.replace(route.url);
    }
    return "not-logged-in";
  }

  return "not-logged-in";
}

export type SwitchPlan = { ok: true; url: string } | { ok: false; message: string; sessionEnded?: boolean };

/**
 * Check BEFORE leaving the page that a switch can work: the address must be configured for this environment,
 * the sign-in must be a central session, and that session must not have ended.
 */
export async function planSwitch(targetBaseUrl: string, targetPath?: string): Promise<SwitchPlan> {
  const safeBaseUrl = sanitizeEnvMatchedUrl(targetBaseUrl);
  if (!safeBaseUrl) {
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
    url = createSsoHandoverUrl(safeBaseUrl, targetPath);
  } catch {
    url = "";
  }
  if (!url || url === "#") return { ok: false, message: "Could not prepare the switch. Please try again." };
  return { ok: true, url };
}

/** Best-effort wake-up of the other services (hosted free tiers sleep) while the switcher is open. */
export function warmPeerServices(landing?: Landing | null): void {
  try {
    for (const erp of getEcosystemErps(landing)) {
      if (erp.apiUrl) void fetch(`${erp.apiUrl}/health/live`, { mode: "no-cors", cache: "no-store" }).catch(() => undefined);
    }
  } catch {
    /* warming is optional */
  }
}
