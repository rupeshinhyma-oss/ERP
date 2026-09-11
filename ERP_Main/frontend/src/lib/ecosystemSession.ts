/**
 * Unified Ecosystem Session Management.
 *
 * Provides synchronized Session ID, Single Sign-On (SSO), and
 * Global Single Sign-Out (SLO) across ERP_Main, Yinglima ERP, Inhyma ERP,
 * and any future attached ERP instances.
 */

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
}

const COOKIE_NAME = "ihm_ecosystem_session";
const LOCAL_STORAGE_KEY = "ihm_ecosystem_session";
const BROADCAST_CHANNEL_NAME = "ihm_ecosystem_auth";
export const CENTRAL_AUTH_API = "http://localhost:8000/api/v1/global/ecosystem-session";

/* ------------------------------------------------------------------ */
/* Cookie & Storage Helpers (Shared across localhost ports)            */
/* ------------------------------------------------------------------ */

export function setEcosystemCookie(session: EcosystemSessionData): void {
  if (typeof document === "undefined") return;
  try {
    const serialized = encodeURIComponent(JSON.stringify(session));
    // Cookies on localhost are shared across all ports (:5170, :5173, :5174, etc.)
    document.cookie = `${COOKIE_NAME}=${serialized}; path=/; max-age=604800; SameSite=Lax`;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(session));
  } catch (err) {
    console.warn("Could not write ecosystem session cookie:", err);
  }
}

export function getEcosystemCookie(): EcosystemSessionData | null {
  if (typeof document === "undefined") return null;
  try {
    // 1. Try reading cookie
    const match = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${COOKIE_NAME}=`));
    if (match) {
      const val = match.split("=")[1];
      if (val) {
        return JSON.parse(decodeURIComponent(val));
      }
    }

    // 2. Fallback to localStorage
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (err) {
    console.warn("Could not read ecosystem session cookie:", err);
  }
  return null;
}

export function clearEcosystemCookie(): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
    localStorage.removeItem(LOCAL_STORAGE_KEY);
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
  try {
    const res = await fetch(`${CENTRAL_AUTH_API}/${sessionId}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      return { active: false };
    }

    const body = await res.json();
    const data = body.data || body;
    if (data?.revoked || data?.active === false) {
      return { active: false, revoked: true };
    }
    return { active: true, session: data };
  } catch {
    // If backend unreachable, return active if cookie is fresh
    return { active: true };
  }
}

/**
 * Global Single Sign-Out: Revokes session centrally, clears shared cookies,
 * and notifies all open tabs in all ERP applications.
 */
export async function globalEcosystemLogout(sessionId?: string): Promise<void> {
  const current = getEcosystemCookie();
  const idToRevoke = sessionId || current?.session_id;

  clearEcosystemCookie();

  // Notify all open tabs across all ports immediately (0ms perceived latency)
  broadcastEcosystemEvent({ type: "LOGOUT", session_id: idToRevoke });

  if (idToRevoke) {
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

export function initEcosystemSessionWatcher(
  currentSessionId: string | null,
  onSessionRevoked: () => void
): () => void {
  if (typeof window === "undefined") return () => {};

  const ch = getAuthChannel();

  const handleMessage = (msg: MessageEvent) => {
    if (msg.data?.type === "LOGOUT") {
      clearEcosystemCookie();
      onSessionRevoked();
    }
  };

  if (ch) {
    ch.addEventListener("message", handleMessage);
  }

  // Also check on window focus (e.g. user returns to this ERP tab)
  const handleFocus = async () => {
    const cookie = getEcosystemCookie();
    if (!cookie) {
      // Cookie was cleared in another ERP tab
      onSessionRevoked();
      return;
    }

    if (currentSessionId) {
      const res = await verifyCentralEcosystemSession(currentSessionId);
      if (res.revoked) {
        clearEcosystemCookie();
        onSessionRevoked();
      }
    }
  };

  window.addEventListener("focus", handleFocus);

  // Periodic heartbeat every 15 seconds
  const intervalId = setInterval(async () => {
    if (currentSessionId) {
      const cookie = getEcosystemCookie();
      if (!cookie) {
        onSessionRevoked();
        return;
      }
      const res = await verifyCentralEcosystemSession(currentSessionId);
      if (res.revoked) {
        clearEcosystemCookie();
        onSessionRevoked();
      }
    }
  }, 15000);

  return () => {
    if (ch) {
      ch.removeEventListener("message", handleMessage);
    }
    window.removeEventListener("focus", handleFocus);
    clearInterval(intervalId);
  };
}
