/**
 * Unified Ecosystem Session Management.
 *
 * Provides synchronized Session ID, Single Sign-On (SSO), and
 * Global Single Sign-Out (SLO) across ERP_Main, Yinglima ERP, Inhyma ERP,
 * and any future attached ERP instances.
 */

import { API_BASE } from "./api";

export interface EcosystemSessionData {
  session_id: string;
  email: string;
  display_name: string;
  role: "super_admin" | "admin" | "global_user";
  user_type: "platform_admin" | "global_user";
  allowed_erps: string[]; // ["*"] or list of authorized erp keys
  created_at?: string;
  expires_at?: string;
  revoked_at?: string | null;
  active?: boolean;
}

const COOKIE_NAME = "ihm_ecosystem_session";
const LOCAL_STORAGE_KEY = "ihm_ecosystem_session";
const LOGOUT_COOKIE_NAME = "ihm_ecosystem_logged_out";
const BROADCAST_CHANNEL_NAME = "ihm_ecosystem_auth";

const isLocalhost = (hostname: string) =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "0.0.0.0" ||
  hostname.endsWith(".local");

function clearCookieEverywhere(name: string): void {
  if (typeof document === "undefined") return;
  const domainAttr = import.meta.env.VITE_COOKIE_DOMAIN ? `; domain=${import.meta.env.VITE_COOKIE_DOMAIN}` : "";
  const host = typeof window !== "undefined" && window.location.hostname ? window.location.hostname : "";
  const domains = ["", "; domain=localhost", "; domain=127.0.0.1"];
  if (host && host !== "localhost" && host !== "127.0.0.1") {
    domains.push(`; domain=${host}`);
  }
  if (domainAttr && !domains.includes(domainAttr)) {
    domains.push(domainAttr);
  }
  for (const d of domains) {
    document.cookie = `${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${d}`;
  }
}

function setCookieEverywhere(name: string, value: string, maxAgeSeconds: number): void {
  if (typeof document === "undefined") return;
  const domainAttr = import.meta.env.VITE_COOKIE_DOMAIN ? `; domain=${import.meta.env.VITE_COOKIE_DOMAIN}` : "";
  const host = typeof window !== "undefined" && window.location.hostname ? window.location.hostname : "";
  const domains = ["", "; domain=localhost"];
  if (host && host !== "localhost") {
    domains.push(`; domain=${host}`);
  }
  if (domainAttr && !domains.includes(domainAttr)) {
    domains.push(domainAttr);
  }
  for (const d of domains) {
    document.cookie = `${name}=${value}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax${d}`;
  }
}

export function getRawEcosystemCookie(): EcosystemSessionData | null {
  if (typeof document === "undefined") return null;
  try {
    const match = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${COOKIE_NAME}=`));
    if (match) {
      const val = match.split("=")[1];
      if (val) {
        return JSON.parse(decodeURIComponent(val));
      }
    }
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    /* ignore parsing errors */
  }
  return null;
}

export function isExplicitlyLoggedOut(currentSessionId?: string): boolean {
  if (typeof window === "undefined") return false;

  // 1. If an incoming SSO handover ticket is in the URL, this is an explicit cross-ERP login or switch!
  // Any prior logout in this tab or cookie is superseded.
  if (typeof window !== "undefined" && window.location.search) {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has("sso_handover")) {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.removeItem("ihm_explicit_logout");
        }
        return false;
      }
    } catch {
      /* ignore */
    }
  }

  // 2. Check if a logout cookie exists
  if (typeof document !== "undefined") {
    const match = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${LOGOUT_COOKIE_NAME}=`));
    if (match) {
      const val = decodeURIComponent(match.split("=")[1] || "");
      // If the logout marker specifies a session ID and current session ID is different,
      // it means this is a newly authenticated session -> not logged out!
      if (val && val !== "1" && val !== "true" && currentSessionId && val !== currentSessionId) {
        return false;
      }
      // If there is an active session in cookies that has a session_id different from the logged-out one:
      const rawCookie = getRawEcosystemCookie();
      if (rawCookie?.session_id && val && val !== "1" && val !== "true" && rawCookie.session_id !== val) {
        return false;
      }
      return true;
    }
  }

  // 3. Check sessionStorage flag (tab-scoped)
  if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("ihm_explicit_logout") === "true") {
    // If an active session exists in cookies, then the sessionStorage flag is stale from a prior session!
    const rawCookie = getRawEcosystemCookie();
    if (rawCookie?.session_id) {
      sessionStorage.removeItem("ihm_explicit_logout");
      return false;
    }
    return true;
  }

  return false;
}

const getCentralAuthApi = (): string => {
  if (import.meta.env.VITE_CENTRAL_AUTH_API) {
    return import.meta.env.VITE_CENTRAL_AUTH_API;
  }
  if (import.meta.env.VITE_CONTROL_PLANE_API_URL) {
    return `${import.meta.env.VITE_CONTROL_PLANE_API_URL.replace(/\/+$/, "")}/global/ecosystem-session`;
  }
  // In ERP_Main, route directly through the configured backend API_BASE
  if (API_BASE) {
    return `${API_BASE}/global/ecosystem-session`;
  }
  const host = typeof window !== "undefined" && window.location.hostname ? window.location.hostname : "127.0.0.1";
  if (isLocalhost(host)) {
    return `http://${host}:8000/api/v1/global/ecosystem-session`;
  }
  return "";
};
export const CENTRAL_AUTH_API = getCentralAuthApi();

/* ------------------------------------------------------------------ */
/* Cookie & Storage Helpers (Shared across localhost ports)            */
/* ------------------------------------------------------------------ */

export function setEcosystemCookie(session: EcosystemSessionData): void {
  if (typeof document === "undefined") return;
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("ihm_explicit_logout");
    }
    // Completely clear any prior explicit logout flag across all domain permutations
    clearCookieEverywhere(LOGOUT_COOKIE_NAME);

    const serialized = encodeURIComponent(JSON.stringify(session));
    setCookieEverywhere(COOKIE_NAME, serialized, 604800);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(session));
  } catch (err) {
    console.warn("Could not write ecosystem session cookie:", err);
  }
}

export function getEcosystemCookie(): EcosystemSessionData | null {
  if (typeof document === "undefined") return null;
  const session = getRawEcosystemCookie();
  if (!session) return null;

  // Only consider null if THIS specific session was explicitly marked as logged out
  if (isExplicitlyLoggedOut(session.session_id)) {
    return null;
  }
  return session;
}

export function clearEcosystemCookie(sessionId?: string): void {
  if (typeof document === "undefined") return;
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem("ihm_explicit_logout", "true");
    }

    // The shared cookie describes ONE login.  Remove it only if it is THIS login's: another login in the same
    // browser (another person, another tab) keeps its own cookie, so signing one out never disturbs the other.
    const current = getRawEcosystemCookie();
    const belongsToThisLogin = !sessionId || !current?.session_id || current.session_id === sessionId;
    if (belongsToThisLogin) {
      clearCookieEverywhere(COOKIE_NAME);
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }

    // Marker with the exact session id that was signed out: other sessions are never mistaken for revoked.
    const logoutVal = encodeURIComponent(sessionId || "true");
    setCookieEverywhere(LOGOUT_COOKIE_NAME, logoutVal, 60);
  } catch (err) {
    console.warn("Could not clear ecosystem session cookie:", err);
  }
}



/* ------------------------------------------------------------------ */
/* Real-Time Multi-Tab Synchronization via BroadcastChannel            */
/* ------------------------------------------------------------------ */

let authChannel: BroadcastChannel | null = null;

function getAuthChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }
  if (!authChannel) {
    authChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  }
  return authChannel;
}

export function broadcastEcosystemEvent(event: { type: "LOGIN" | "LOGOUT"; session_id?: string; session?: EcosystemSessionData }): void {
  try {
    const ch = getAuthChannel();
    if (ch) {
      ch.postMessage(event);
    }
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Central API Interaction                                            */
/* ------------------------------------------------------------------ */

/**
 * Centrally registers or syncs an ecosystem session with ERP_Main.
 */
export async function establishCentralEcosystemSession(params: {
  email?: string;
  password?: string;
  source_erp: string;
  existing_session_id?: string;
}): Promise<EcosystemSessionData | null> {
  if (!CENTRAL_AUTH_API) return null;
  try {
    const res = await fetch(`${CENTRAL_AUTH_API}/establish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!res.ok) return null;
    const body = await res.json();
    const session: EcosystemSessionData = body.data || body;

    if (session?.session_id) {
      setEcosystemCookie(session);
      broadcastEcosystemEvent({ type: "LOGIN", session });
      return session;
    }
  } catch (err) {
    console.warn("Could not establish central ecosystem session:", err);
  }
  return null;
}

/**
 * Validates whether an ecosystem session is currently active or revoked.
 */
export async function verifyCentralEcosystemSession(sessionId: string): Promise<{ active: boolean; revoked?: boolean; session?: EcosystemSessionData }> {
  // Local standalone sessions (ihm-sess-*) are strictly internal to an ERP
  // and must NEVER be queried against ERP_Main or considered revoked.
  if (!sessionId || sessionId.startsWith("ihm-sess-") || !CENTRAL_AUTH_API) {
    return { active: true, revoked: false };
  }

  try {
    const res = await fetch(`${CENTRAL_AUTH_API}/${sessionId}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      // Offline, network hiccup, or non-200 from central server must never kill an active session
      return { active: true, revoked: false };
    }

    const body = await res.json();
    const data = body.data || body;
    // ONLY revoke if the central control plane explicitly confirmed revocation
    if (data?.revoked === true) {
      return { active: false, revoked: true };
    }
    return { active: true, session: data, revoked: false };
  } catch {
    // Central auth API offline / network failure -> maintain current session
    return { active: true, revoked: false };
  }
}

/**
 * Global Single Sign-Out: Revokes session centrally, clears shared cookies,
 * and notifies all open tabs in all ERP applications.
 */
export async function globalEcosystemLogout(sessionId?: string): Promise<void> {
  if (typeof window !== "undefined" && typeof sessionStorage !== "undefined") {
    sessionStorage.setItem("ihm_explicit_logout", "true");
  }

  const current = getRawEcosystemCookie();
  const idToRevoke =
    sessionId ||
    current?.session_id ||
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("erp_session_id") || localStorage.getItem("erp_main_session_id") || undefined
      : undefined);

  clearEcosystemCookie(idToRevoke);

  // Notify all open tabs across all ports immediately (0ms perceived latency)
  broadcastEcosystemEvent({ type: "LOGOUT", session_id: idToRevoke });

  if (idToRevoke && !idToRevoke.startsWith("ihm-sess-") && CENTRAL_AUTH_API) {
    try {
      await fetch(`${CENTRAL_AUTH_API}/${idToRevoke}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      });
    } catch {
      /* best effort background revoke */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Real-Time Session Watcher (Detects Remote Logout Across ERPs)      */
/* ------------------------------------------------------------------ */

/**
 * Module-level guard against duplicate watchers.
 */
let activeWatcherCleanup: (() => void) | null = null;

export function initEcosystemSessionWatcher(
  currentSessionId: string | null,
  onSessionRevoked: () => void
): () => void {
  if (typeof window === "undefined") return () => { };

  // Tear down any previously-registered watcher first
  if (activeWatcherCleanup) {
    activeWatcherCleanup();
    activeWatcherCleanup = null;
  }

  // Active session exists: clear any stale logout flags
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem("ihm_explicit_logout");
  }

  const ch = getAuthChannel();

  const handleMessage = (msg: MessageEvent) => {
    if (msg.data?.type === "LOGOUT") {
      const targetSessionId = msg.data?.session_id;
      // Only THIS login's tab reacts: a sign-out of another session (or one without a session id) is ignored.
      if (targetSessionId && currentSessionId && targetSessionId === currentSessionId) {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem("ihm_explicit_logout", "true");
        }
        clearEcosystemCookie(currentSessionId || undefined);
        onSessionRevoked();
      }
    }
  };

  if (ch) {
    ch.addEventListener("message", handleMessage);
  }

  const checkRevocation = async () => {
    // 1. If explicit logout was triggered across any tab/port for THIS session:
    if (isExplicitlyLoggedOut(currentSessionId || undefined)) {
      onSessionRevoked();
      return;
    }

    // 2. Only verify central ecosystem session if one was established (not local standalone)
    if (currentSessionId && !currentSessionId.startsWith("ihm-sess-")) {
      const res = await verifyCentralEcosystemSession(currentSessionId);
      if (res.revoked === true) {
        clearEcosystemCookie(currentSessionId);
        onSessionRevoked();
      }
    }
  };

  const handleFocus = async () => {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("ihm_explicit_logout");
    }
    await checkRevocation();
  };

  window.addEventListener("focus", handleFocus);
  document.addEventListener("visibilitychange", checkRevocation);

  // Poll every 2.5s for fast synchronization across localhost origins
  // Poll gently: every 30 s while the tab is visible, every 2 min while hidden.  Returning to the tab or regaining
  // focus checks immediately (listeners above), and the API's own 401 also signs the person out, so a longer interval
  // costs the person nothing -- but it is ~12x lighter on the server for every open tab.
  let timerId: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const scheduleNext = () => {
    if (stopped) return;
    const delay = document.visibilityState === "hidden" ? 120_000 : 30_000;
    timerId = setTimeout(async () => {
      await checkRevocation();
      scheduleNext();
    }, delay);
  };
  // Check once right away -- a tab opened after its session ended must not keep looking signed-in -- then on the
  // gentle schedule above.
  void checkRevocation();
  scheduleNext();

  const cleanup = () => {
    if (ch) {
      ch.removeEventListener("message", handleMessage);
    }
    window.removeEventListener("focus", handleFocus);
    document.removeEventListener("visibilitychange", checkRevocation);
    stopped = true;
    if (timerId) clearTimeout(timerId);
    if (activeWatcherCleanup === cleanup) {
      activeWatcherCleanup = null;
    }
  };
  activeWatcherCleanup = cleanup;
  return cleanup;
}