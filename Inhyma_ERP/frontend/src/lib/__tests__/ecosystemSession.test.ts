import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  verifyCentralEcosystemSession,
  initEcosystemSessionWatcher,
} from "../ecosystemSession";

describe("Inhyma Ecosystem Session Resilience", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = "ihm_ecosystem_session=; path=/; max-age=0";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never queries central API for local standalone sessions (ihm-sess-*)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await verifyCentralEcosystemSession("ihm-sess-1726550000000");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.active).toBe(true);
    expect(res.revoked).toBe(false);
  });

  it("does not treat notFound: true as revoked", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { active: false, session_id: "non-existent-uuid", notFound: true },
      }),
    } as Response);

    const res = await verifyCentralEcosystemSession("c248eb3a-67a6-4b82-8495-a4f66a87799b");
    expect(res.active).toBe(true);
    expect(res.revoked).toBe(false);
  });

  it("only marks revoked if data.revoked === true", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { active: false, session_id: "revoked-uuid", revoked: true },
      }),
    } as Response);

    const res = await verifyCentralEcosystemSession("c248eb3a-67a6-4b82-8495-a4f66a87799b");
    expect(res.active).toBe(false);
    expect(res.revoked).toBe(true);
  });

  it("does not log out when ecosystem cookie is missing or cleared", async () => {
    const onRevoked = vi.fn();
    const cleanup = initEcosystemSessionWatcher("ihm-sess-test", onRevoked);

    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 20));

    expect(onRevoked).not.toHaveBeenCalled();
    cleanup();
  });

  it("clears stale ihm_explicit_logout on watcher init and focus", async () => {
    sessionStorage.setItem("ihm_explicit_logout", "true");

    const onRevoked = vi.fn();
    const cleanup = initEcosystemSessionWatcher("ihm-sess-test", onRevoked);

    expect(sessionStorage.getItem("ihm_explicit_logout")).toBeNull();

    sessionStorage.setItem("ihm_explicit_logout", "true");
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 20));

    expect(sessionStorage.getItem("ihm_explicit_logout")).toBeNull();
    expect(onRevoked).not.toHaveBeenCalled();
    cleanup();
  });
});
