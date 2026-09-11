import { describe, it, expect, beforeEach, vi } from "vitest";
import { Auth, initials, roleLabel } from "../lib/auth";

describe("Auth Store", () => {
  beforeEach(() => {
    localStorage.clear();
    Auth.clear();
  });

  it("handles token persistence and session state", () => {
    expect(Auth.isLoggedIn()).toBe(false);
    expect(Auth.getAccessToken()).toBeNull();

    Auth.setSession("test-access-token", {
      id: "admin-1",
      email: "admin@platform.local",
      display_name: "Platform Admin",
      role: "SUPER_ADMIN",
      is_active: true,
      created_at: new Date().toISOString(),
    });

    expect(Auth.isLoggedIn()).toBe(true);
    expect(Auth.getAccessToken()).toBe("test-access-token");
    expect(Auth.getPlatformAdmin()?.email).toBe("admin@platform.local");
    expect(Auth.isSuperAdmin()).toBe(true);

    Auth.clear();
    expect(Auth.isLoggedIn()).toBe(false);
    expect(Auth.getAccessToken()).toBeNull();
    expect(Auth.getProfile()).toBeNull();
  });

  it("notifies subscribers when profile updates", () => {
    const listener = vi.fn();
    const unsubscribe = Auth.subscribe(listener);

    Auth.setSession("token-123", {
      id: "admin-2",
      email: "operator@platform.local",
      display_name: "Operator User",
      role: "OPERATOR",
      is_active: true,
      created_at: new Date().toISOString(),
    });

    expect(listener).toHaveBeenCalled();
    expect(Auth.isSuperAdmin()).toBe(false);

    unsubscribe();
  });

  it("formats initials correctly", () => {
    expect(initials("John Doe")).toBe("JD");
    expect(initials("Alice")).toBe("AL");
    expect(initials("")).toBe("CP");
    expect(initials(undefined)).toBe("CP");
  });

  it("formats role labels correctly", () => {
    expect(roleLabel("SUPER_ADMIN")).toBe("Platform Super Admin");
    expect(roleLabel("PLATFORM_ADMIN")).toBe("Platform Admin");
    expect(roleLabel("AUDITOR")).toBe("Platform Auditor");
    expect(roleLabel(undefined)).toBe("Platform Administrator");
  });
});
