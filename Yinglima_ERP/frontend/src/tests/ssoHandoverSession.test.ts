import { describe, it, expect, beforeEach, vi } from "vitest";
import * as apiModule from "../lib/api";
import { Auth } from "../lib/auth";
import {
  planSwitch,
  processIncomingSsoHandover,
  resetIncomingSsoHandoverForTests,
  routeForCentralSession,
} from "../lib/ssoBridge";
import * as ecosystemModule from "../lib/ecosystemSession";
import { clearEcosystemCookie, getEcosystemCookie, setEcosystemCookie } from "../lib/ecosystemSession";

const REAL_LOCATION = window.location;
const ticket = (sid: string, email = "u@x.com") =>
  btoa(JSON.stringify({ sig: "ihm_erp_sso_v1", ts: Date.now(), session_id: sid, email, user: email, role: "global_user", allowed_erps: ["*"] }));
const tokens = (sid: string) => ({ data: { access_token: "A-" + sid, refresh_token: "R-" + sid, session_id: sid, session_mode: "central", user: { email: "u@x.com" } } });
const arrive = (t: string) => window.history.pushState({}, "", "/login?sso_handover=" + t);
const wipeCookies = () => document.cookie.split(";").forEach((c) => { document.cookie = c.split("=")[0].trim() + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/"; });

describe("switching ERPs: a fresh handover always wins, and every failure explains itself", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", { value: REAL_LOCATION, writable: true, configurable: true });
    resetIncomingSsoHandoverForTests();
    localStorage.clear();
    sessionStorage.clear();
    wipeCookies();
    window.history.pushState({}, "", "/login");
    vi.restoreAllMocks();
  });

  it("a stale saved session does NOT block a new handover (the 'login page instead of direct login' bug)", async () => {
    Auth.setSession({ access_token: "STALE", refresh_token: "STALE" } as never, { email: "u@x.com" } as never, "OLD-SESSION");
    const post = vi.spyOn(apiModule, "apiPost").mockResolvedValue(tokens("NEW-SESSION") as never);
    arrive(ticket("NEW-SESSION"));
    expect(await processIncomingSsoHandover()).toBe("logged-in");
    expect(post).toHaveBeenCalledTimes(1);
    expect(Auth.getAccessToken()).toBe("A-NEW-SESSION");
    expect(Auth.getSessionId()).toBe("NEW-SESSION");
  });

  it("the very same login already open is left alone", async () => {
    Auth.setSession({ access_token: "T", refresh_token: "R" } as never, { email: "u@x.com" } as never, "SAME");
    const post = vi.spyOn(apiModule, "apiPost");
    arrive(ticket("SAME"));
    expect(await processIncomingSsoHandover()).toBe("already-logged-in");
    expect(post).not.toHaveBeenCalled();
  });

  it("a different person's saved session is replaced (user isolation)", async () => {
    Auth.setSession({ access_token: "OTHER", refresh_token: "OTHER" } as never, { email: "someone.else@x.com" } as never, "S0");
    vi.spyOn(apiModule, "apiPost").mockResolvedValue(tokens("S1") as never);
    arrive(ticket("S1"));
    expect(await processIncomingSsoHandover()).toBe("logged-in");
    expect(Auth.getAccessToken()).toBe("A-S1");
  });

  it("cookie-only auto sign-in goes through the verified handover exchange, never a stored password", async () => {
    setEcosystemCookie({ session_id: "COOKIE-SESSION", email: "u@x.com", display_name: "U", role: "global_user", user_type: "global_user", allowed_erps: ["*"] } as never);
    const post = vi.spyOn(apiModule, "apiPost").mockResolvedValue(tokens("COOKIE-SESSION") as never);
    expect(await processIncomingSsoHandover()).toBe("logged-in");
    expect(post.mock.calls.map((c) => c[0])).toEqual(["/auth/sso-handover"]);
  });

  it("a refused handover leaves a clear notice for the login page and is not retried", async () => {
    const post = vi.spyOn(apiModule, "apiPost").mockRejectedValue(Object.assign(new Error("Your central session is no longer active."), { status: 401 }));
    arrive(ticket("DEAD"));
    expect(await processIncomingSsoHandover()).toBe("not-logged-in");
    expect(sessionStorage.getItem("ihm_login_notice")).toMatch(/session has ended/i);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("a transient failure is retried once", async () => {
    const post = vi.spyOn(apiModule, "apiPost").mockRejectedValueOnce(Object.assign(new Error("waking up"), { status: 503 })).mockResolvedValueOnce(tokens("RETRY") as never);
    arrive(ticket("RETRY"));
    expect(await processIncomingSsoHandover()).toBe("logged-in");
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe("signing out one login never wipes another login's shared cookie", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", { value: REAL_LOCATION, writable: true, configurable: true });
    localStorage.clear();
    sessionStorage.clear();
    wipeCookies();
  });
  const cookieFor = (sid: string) => ({ session_id: sid, email: "u@x.com", display_name: "U", role: "global_user", user_type: "global_user", allowed_erps: ["*"] }) as never;

  it("keeps the cookie when it belongs to a different session", () => {
    setEcosystemCookie(cookieFor("LOGIN-B"));
    clearEcosystemCookie("LOGIN-A");
    expect(getEcosystemCookie()?.session_id).toBe("LOGIN-B");
  });

  it("removes the cookie when it is this login's own", () => {
    setEcosystemCookie(cookieFor("LOGIN-A"));
    clearEcosystemCookie("LOGIN-A");
    expect(getEcosystemCookie()).toBeNull();
  });
});

describe("reliability: one shared handover, no blind redirects, honest messages", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", { value: REAL_LOCATION, writable: true, configurable: true });
    localStorage.clear();
    sessionStorage.clear();
    wipeCookies();
    window.history.pushState({}, "", "/login");
    vi.restoreAllMocks();
    resetIncomingSsoHandoverForTests();
  });

  it("simultaneous callers (App, AppShell, Login, StrictMode) share ONE exchange", async () => {
    const post = vi.spyOn(apiModule, "apiPost").mockResolvedValue(tokens("ONCE") as never);
    arrive(ticket("ONCE"));
    const results = await Promise.all([processIncomingSsoHandover(), processIncomingSsoHandover(), processIncomingSsoHandover()]);
    expect(results).toEqual(["logged-in", "logged-in", "logged-in"]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("an outage that outlasts the retries says 'temporarily unavailable' and keeps the central cookie", async () => {
    vi.useFakeTimers();
    try {
      setEcosystemCookie({ session_id: "KEEP", email: "u@x.com", display_name: "U", role: "global_user", user_type: "global_user", allowed_erps: ["*"] } as never);
      const post = vi.spyOn(apiModule, "apiPost").mockRejectedValue(Object.assign(new Error("down"), { status: 503 }));
      const pending = processIncomingSsoHandover();
      await vi.advanceTimersByTimeAsync(12000);
      expect(await pending).toBe("not-logged-in");
      expect(post).toHaveBeenCalledTimes(4);
      expect(sessionStorage.getItem("ihm_login_notice")).toMatch(/temporarily unavailable/i);
      expect(getEcosystemCookie()?.session_id).toBe("KEEP");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an ended session (401) forgets that central session so it is not retried forever", async () => {
    setEcosystemCookie({ session_id: "ENDED", email: "u@x.com", display_name: "U", role: "global_user", user_type: "global_user", allowed_erps: ["*"] } as never);
    vi.spyOn(apiModule, "apiPost").mockRejectedValue(Object.assign(new Error("gone"), { status: 401 }));
    expect(await processIncomingSsoHandover()).toBe("not-logged-in");
    expect(getEcosystemCookie()?.session_id).not.toBe("ENDED");
    expect(sessionStorage.getItem("ihm_login_notice")).toMatch(/session has ended/i);
  });

  it("a failure never bounces the browser to a made-up dashboard address", async () => {
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...REAL_LOCATION, replace, assign: vi.fn(), href: REAL_LOCATION.href, search: REAL_LOCATION.search, pathname: REAL_LOCATION.pathname, hash: "", hostname: "app.example.com", origin: "https://app.example.com" },
      writable: true,
      configurable: true,
    });
    vi.spyOn(apiModule, "apiPost").mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    vi.useFakeTimers();
    try {
      arrive(ticket("X"));
      const pending = processIncomingSsoHandover();
      await vi.advanceTimersByTimeAsync(12000);
      await pending;
      expect(replace).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      Object.defineProperty(window, "location", { value: REAL_LOCATION, writable: true, configurable: true });
    }
  });
});

describe("planSwitch: say what is wrong BEFORE leaving the page", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", { value: REAL_LOCATION, writable: true, configurable: true });
    localStorage.clear();
    sessionStorage.clear();
    wipeCookies();
    vi.restoreAllMocks();
  });
  const signIn = (sid: string) => Auth.setSession({ access_token: "T", refresh_token: "R" } as never, { email: "u@x.com" } as never, sid);

  it("refuses when the target address is not configured", async () => {
    signIn("S1");
    const plan = await planSwitch("");
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.message).toMatch(/not configured/i);
  });

  it("refuses cross-environment navigation from localhost to hosted Render", async () => {
    signIn("S1-ENV");
    const plan = await planSwitch("https://inhyma-erp-frontend.onrender.com/dashboard");
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.message).toMatch(/not configured/i);
  });

  it("refuses an ERP-only (local) sign-in with a clear instruction", async () => {
    signIn("ihm-sess-123");
    const plan = await planSwitch("http://localhost:5174/dashboard");
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.message).toMatch(/sign in again/i);
  });

  it("tells the person when their session has already ended", async () => {
    signIn("S2");
    vi.spyOn(ecosystemModule, "verifyCentralEcosystemSession").mockResolvedValue({ active: false, revoked: true } as never);
    const plan = await planSwitch("http://localhost:5174/dashboard");
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.sessionEnded).toBe(true);
  });

  it("returns a handover URL for a live central session", async () => {
    signIn("S3");
    vi.spyOn(ecosystemModule, "verifyCentralEcosystemSession").mockResolvedValue({ active: true, revoked: false } as never);
    const plan = await planSwitch("http://localhost:5174/dashboard");
    expect(plan.ok).toBe(true);
    expect(plan.ok && plan.url).toContain("sso_handover=");
  });
});

describe("environment isolation: localhost never jumps to hosted Render URLs (and vice versa)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", { value: REAL_LOCATION, writable: true, configurable: true });
    localStorage.clear();
    sessionStorage.clear();
    wipeCookies();
    vi.restoreAllMocks();
  });

  it("on localhost:5173 (Yinglima), User D (Inhyma-only) redirects to http://localhost:5174/dashboard, NEVER onrender.com", () => {
    Object.defineProperty(window, "location", {
      value: { ...REAL_LOCATION, hostname: "localhost", origin: "http://localhost:5173", href: "http://localhost:5173/login" },
      writable: true,
      configurable: true,
    });
    const route = routeForCentralSession("yinglima", {
      session_id: "S-USERD",
      email: "userd@gmail.com",
      role: "global_user",
      allowed_erps: ["inhyma"],
      landing: {
        mode: "single",
        target: { key: "inhyma", name: "Inhyma ERP", url: "https://inhyma-erp-frontend.onrender.com/dashboard" },
        erps: [{ key: "inhyma", name: "Inhyma ERP", url: "https://inhyma-erp-frontend.onrender.com/dashboard" }],
        control_plane_url: "https://erp-main-frontend.onrender.com/dashboard",
      },
    });
    expect(route.kind).toBe("redirect");
    if (route.kind === "redirect") {
      const target = new URL(route.url);
      expect(target.origin + target.pathname).toBe("http://localhost:5174/dashboard");
      expect(route.url).not.toContain("onrender.com");
    }
  });

  it("on LAN IP, adapts the local .env URL to the LAN hostname and never jumps to hosted Render", () => {
    Object.defineProperty(window, "location", {
      value: { ...REAL_LOCATION, hostname: "192.168.1.50", origin: "http://192.168.1.50:5173", href: "http://192.168.1.50:5173/login" },
      writable: true,
      configurable: true,
    });
    const route = routeForCentralSession("yinglima", {
      session_id: "S-LAN",
      email: "userd@gmail.com",
      role: "global_user",
      allowed_erps: ["inhyma"],
      landing: {
        mode: "single",
        target: { key: "inhyma", name: "Inhyma ERP", url: "https://inhyma-erp-frontend.onrender.com/dashboard" },
        erps: [{ key: "inhyma", name: "Inhyma ERP", url: "https://inhyma-erp-frontend.onrender.com/dashboard" }],
      },
    });
    expect(route.kind).toBe("redirect");
    if (route.kind === "redirect") {
      const target = new URL(route.url);
      expect(target.origin + target.pathname).toBe("http://192.168.1.50:5174/dashboard");
    }
  });

  it("on hosted Render, ignores any localhost .env URL and uses the hosted landing URL", () => {
    Object.defineProperty(window, "location", {
      value: {
        ...REAL_LOCATION,
        hostname: "yinglima-erp-frontend.onrender.com",
        origin: "https://yinglima-erp-frontend.onrender.com",
        href: "https://yinglima-erp-frontend.onrender.com/login",
      },
      writable: true,
      configurable: true,
    });
    const route = routeForCentralSession("yinglima", {
      session_id: "S-PROD",
      email: "userd@gmail.com",
      role: "global_user",
      allowed_erps: ["inhyma"],
      landing: {
        mode: "single",
        target: { key: "inhyma", name: "Inhyma ERP", url: "https://inhyma-erp-frontend.onrender.com/dashboard" },
        erps: [{ key: "inhyma", name: "Inhyma ERP", url: "https://inhyma-erp-frontend.onrender.com/dashboard" }],
        control_plane_url: "https://erp-main-frontend.onrender.com/dashboard",
      },
    });
    expect(route.kind).toBe("redirect");
    if (route.kind === "redirect") {
      const target = new URL(route.url);
      expect(target.origin + target.pathname).toBe("https://inhyma-erp-frontend.onrender.com/dashboard");
      expect(route.url).not.toContain("localhost");
    }
  });
});
