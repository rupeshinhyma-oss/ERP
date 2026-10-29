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
    sanitizeEnvMatchedUrl(landing?.control_plane_url, { ensureDashboardPath: true }) ||
    (typeof window !== "undefined" && window.location.origin ? `${window.location.origin}/dashboard` : "");

  const rawControlPlaneApi =
    import.meta.env.VITE_CONTROL_PLANE_API_URL ||
    (import.meta.env.VITE_API_ORIGIN ? `${import.meta.env.VITE_API_ORIGIN.replace(/\/+$/, "")}/api/v1` : "");
  const controlPlaneApi = sanitizeEnvMatchedUrl(rawControlPlaneApi).replace(/\/+$/, "") || undefined;

  const yinglimaHost =
    sanitizeEnvMatchedUrl(import.meta.env.VITE_YINGLIMA_URL, { ensureDashboardPath: true }) ||
    sanitizeEnvMatchedUrl(landingUrlForKey("yinglima", landing), { ensureDashboardPath: true });
  const yinglimaApi = sanitizeEnvMatchedUrl(import.meta.env.VITE_YINGLIMA_API_URL).replace(/\/+$/, "") || undefined;

  const inhymaHost =
    sanitizeEnvMatchedUrl(import.meta.env.VITE_INHYMA_URL, { ensureDashboardPath: true }) ||
    sanitizeEnvMatchedUrl(landingUrlForKey("inhyma", landing), { ensureDashboardPath: true });
  const inhymaApi = sanitizeEnvMatchedUrl(import.meta.env.VITE_INHYMA_API_URL).replace(/\/+$/, "") || undefined;

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
 * Resolves the environment-matched dashboard URL for a target ERP key, prioritizing `.env` (`VITE_*_URL`)
 * and falling back to an environment-compatible landing/registry URL.
 */
export function resolveErpTargetUrl(erpKey: string, fallbackUrl?: string | null, landing?: Landing | null): string {
  const raw = (erpKey || "").trim().toLowerCase();
  if (!raw) return sanitizeEnvMatchedUrl(fallbackUrl, { ensureDashboardPath: true });
  const cleanKey = raw.includes("yinglima")
    ? "yinglima"
    : raw.includes("inhyma")
      ? "inhyma"
      : raw;
  const fromConfig = getEcosystemErps(landing).find((e) => e.key.toLowerCase() === cleanKey)?.hostUrl || "";
  if (fromConfig) return fromConfig;
  return sanitizeEnvMatchedUrl(fallbackUrl, { ensureDashboardPath: true });
}

/**
 * Creates an SSO handover launch URL targeting any registered ERP.
 * Automatically passes the active unified session_id.
 */
export function createSsoHandoverUrl(
  targetBaseUrl: string,
  targetPath?: string,
  userOverride?: { email?: string; user?: string; role?: string | null; allowed_erps?: string[]; session_id?: string }
): string {
  const safeBaseUrl = sanitizeEnvMatchedUrl(targetBaseUrl);
  if (!safeBaseUrl) return "#";

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

/**
 * Resolves direct SSO handover launch URL for a single assigned ERP membership.
 */
export function resolveSingleErpDirectUrl(
  membership: {
    erp_key?: string;
    erp_name?: string;
    erp_display_name?: string;
    erp_instance_id?: string;
    base_url?: string;
  },
  userContext?: {
    email?: string;
    display_name?: string;
    role?: string | null;
    session_id?: string;
    allowed_erps?: string[];
  }
): string | null {
  let erpKey = (membership.erp_key || membership.erp_display_name || membership.erp_name || "").toLowerCase().trim();
  if (!erpKey && userContext?.allowed_erps) {
    const fromContext = userContext.allowed_erps.find((k) => k && k !== "*" && k !== "control-plane");
    if (fromContext) {
      erpKey = fromContext.toLowerCase().trim();
    }
  }

  if (!erpKey) return null;

  const cleanErpKey = erpKey.includes("yinglima")
    ? "yinglima"
    : erpKey.includes("inhyma")
      ? "inhyma"
      : (getEcosystemErps().find(
          (e) =>
            e.key !== "control-plane" &&
            (e.key.toLowerCase() === erpKey || e.key.toLowerCase().includes(erpKey) || erpKey.includes(e.key.toLowerCase()))
        )?.key || erpKey);

  const targetHostUrl = resolveErpTargetUrl(cleanErpKey, membership.base_url);
  if (!targetHostUrl || !cleanErpKey) return null;

  const handoverUrl = createSsoHandoverUrl(
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
  return handoverUrl === "#" ? null : handoverUrl;
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
 */
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
    return "not-logged-in";
  }

  if (!hasValidToken && cookieSession) {
    targetSessionId = cookieSession.session_id;
    targetRole = cookieSession.role || "super_admin";
    targetEmail = cookieSession.email || "admin@example.com";
    allowedErps = cookieSession.allowed_erps || ["*"];
  }

  // 2. If already logged in locally, ensure session_id is aligned.
  if (Auth.isLoggedIn()) {
    const profile = Auth.getProfile();
    const currentLocalEmail = (
      (profile && ("primary_email" in profile ? profile.primary_email : profile.email)) || ""
    ).toLowerCase();
    const currentSessionId = Auth.getSessionId();
    const sameEmail = !targetEmail || !currentLocalEmail || currentLocalEmail === targetEmail.toLowerCase();
    if (!hasValidToken) {
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
      Auth.clear();
    } else if (sameEmail && targetSessionId && currentSessionId === targetSessionId) {
      return "already-logged-in";
    } else {
      Auth.clear();
    }
  }

  // 3. Sign THIS person in to ERP_Main.
  if (!targetSessionId || targetSessionId.startsWith("ihm-sess-")) {
    return "not-logged-in";
  }
  try {
    const exchange = () =>
      apiPost<ExchangeResult>("/global/ecosystem-session/exchange", {
        session_id: targetSessionId as string,
        email: targetEmail,
      });
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
    if (status === 401) clearEcosystemCookie(targetSessionId);
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
    return { ok: false, message: "This sign-in is only valid here. Sign out and sign in again to switch between ERPs." };
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
