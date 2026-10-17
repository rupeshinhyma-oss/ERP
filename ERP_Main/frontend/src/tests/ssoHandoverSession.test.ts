import { describe, it, expect, beforeEach, vi } from "vitest";
import * as apiModule from "../lib/api";
import { Auth } from "../lib/auth";
import { planSwitch, processIncomingSsoHandover, resetIncomingSsoHandoverForTests } from "../lib/ssoBridge";
import * as ecosystemModule from "../lib/ecosystemSession";
import { clearEcosystemCookie, getEcosystemCookie, setEcosystemCookie } from "../lib/ecosystemSession";

const ticket = (sid: string, email = "u@x.com") =>
  btoa(JSON.stringify({ sig: "ihm_erp_sso_v1", ts: Date.now(), session_id: sid, email, user: email, role: "global_user", allowed_erps: ["*"] }));
const exchanged = (sid: string) => ({ data: { principal_type: "global_user", access_token: "A-" + sid, expires_at: "2099-01-01T00:00:00Z", session: { email: "u@x.com", display_name: "U", role: "global_user", user_type: "global_user", allowed_erps: ["*"] } } });
const arrive = (t: string) => window.history.pushState({}, "", "/login?sso_handover=" + t);
const wipeCookies = () => document.cookie.split(";").forEach((c) => { document.cookie = c.split("=")[0].trim() + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/"; });

describe("arriving at the dashboard from an ERP: a fresh handover always wins, and failures explain themselves", () => {
  beforeEach(() => { resetIncomingSsoHandoverForTests(); localStorage.clear(); sessionStorage.clear(); wipeCookies(); window.history.pushState({}, "", "/login"); vi.restoreAllMocks(); vi.spyOn(apiModule, "apiGet").mockResolvedValue({ data: {} } as never); });

  it("a stale saved dashboard session does NOT block a new handover", async () => {
    Auth.setSession("STALE", { email: "u@x.com" } as never, "global_user", undefined, "OLD-SESSION");
    const post = vi.spyOn(apiModule, "apiPost").mockResolvedValue(exchanged("NEW-SESSION") as never);
    arrive(ticket("NEW-SESSION"));
    expect(await processIncomingSsoHandover()).toBe("logged-in");
    expect(post).toHaveBeenCalledTimes(1);
    expect(Auth.getAccessToken()).toBe("A-NEW-SESSION");
    expect(Auth.getSessionId()).toBe("NEW-SESSION");
  });

  it("the very same login already open is left alone", async () => {
    Auth.setSession("T", { email: "u@x.com" } as never, "global_user", undefined, "SAME");
    const post = vi.spyOn(apiModule, "apiPost");
    arrive(ticket("SAME"));
    expect(await processIncomingSsoHandover()).toBe("already-logged-in");
    expect(post).not.toHaveBeenCalled();
  });

  it("a refused handover leaves a clear notice and is not retried", async () => {
    const post = vi.spyOn(apiModule, "apiPost").mockRejectedValue(Object.assign(new Error("Unauthorized request."), { status: 401 }));
    arrive(ticket("DEAD"));
    expect(await processIncomingSsoHandover()).toBe("not-logged-in");
    expect(sessionStorage.getItem("ihm_login_notice")).toMatch(/could not be verified|ended/i);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("a transient failure is retried once", async () => {
    const post = vi.spyOn(apiModule, "apiPost").mockRejectedValueOnce(Object.assign(new Error("waking up"), { status: 503 })).mockResolvedValueOnce(exchanged("RETRY") as never);
    arrive(ticket("RETRY"));
    expect(await processIncomingSsoHandover()).toBe("logged-in");
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe("signing out one login never wipes another login's shared cookie", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); wipeCookies(); });
  const cookieFor = (sid: string) => ({ session_id: sid, email: "u@x.com", display_name: "U", role: "global_user", user_type: "global_user", allowed_erps: ["*"] }) as never;
  it("keeps the cookie when it belongs to a different session", () => { setEcosystemCookie(cookieFor("LOGIN-B")); clearEcosystemCookie("LOGIN-A"); expect(getEcosystemCookie()?.session_id).toBe("LOGIN-B"); });
  it("removes the cookie when it is this login's own", () => { setEcosystemCookie(cookieFor("LOGIN-A")); clearEcosystemCookie("LOGIN-A"); expect(getEcosystemCookie()).toBeNull(); });
});

describe("reliability: one shared handover, no blind redirects, honest messages", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); wipeCookies(); window.history.pushState({}, "", "/login"); vi.restoreAllMocks(); resetIncomingSsoHandoverForTests(); });

  it("simultaneous callers (App, AppShell, Login, StrictMode) share ONE exchange", async () => {
    const post = vi.spyOn(apiModule, "apiPost").mockResolvedValue(exchanged("ONCE") as never);
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
      expect(post).toHaveBeenCalledTimes(4); // first try + 3 retries
      expect(sessionStorage.getItem("ihm_login_notice")).toMatch(/temporarily unavailable/i);
      expect(getEcosystemCookie()?.session_id).toBe("KEEP"); // the session is fine; only the service is down
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
    Object.defineProperty(window, "location", { value: { ...window.location, replace, assign: vi.fn(), href: window.location.href, search: window.location.search, pathname: window.location.pathname, hash: "", hostname: "app.example.com", origin: "https://app.example.com" }, writable: true });
    vi.spyOn(apiModule, "apiGet").mockResolvedValue({ data: {} } as never);
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
    }
  });
});

describe("planSwitch: say what is wrong BEFORE leaving the page", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); wipeCookies(); vi.restoreAllMocks(); });
  const signIn = (sid: string) => Auth.setSession("T", { email: "u@x.com" } as never, "global_user", undefined, sid);

  it("refuses when the target address is not configured", async () => {
    signIn("S1");
    const plan = await planSwitch("");
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.message).toMatch(/not configured/i);
  });

  it("refuses an ERP-only (local) sign-in with a clear instruction", async () => {
    signIn("ihm-sess-123");
    const plan = await planSwitch("http://localhost:5173/dashboard");
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.message).toMatch(/sign in again/i);
  });

  it("tells the person when their session has already ended", async () => {
    signIn("S2");
    vi.spyOn(ecosystemModule, "verifyCentralEcosystemSession").mockResolvedValue({ active: false, revoked: true } as never);
    const plan = await planSwitch("http://localhost:5173/dashboard");
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.sessionEnded).toBe(true);
  });

  it("returns a handover URL for a live central session", async () => {
    signIn("S3");
    vi.spyOn(ecosystemModule, "verifyCentralEcosystemSession").mockResolvedValue({ active: true, revoked: false } as never);
    const plan = await planSwitch("http://localhost:5173/dashboard");
    expect(plan.ok).toBe(true);
    expect(plan.ok && plan.url).toContain("sso_handover=");
  });
});
