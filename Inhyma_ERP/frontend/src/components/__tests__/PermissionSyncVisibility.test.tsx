import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../AppShell";
import { Auth } from "@/lib/auth";
import * as api from "@/lib/api";
import { liveClient } from "@/lib/live/liveClient";

vi.mock("@/lib/ssoBridge", () => ({
  enforceCentralLanding: vi.fn(),
  processIncomingSsoHandover: vi.fn().mockResolvedValue("already-logged-in"),
}));

vi.mock("@/lib/ecosystemSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ecosystemSession")>();
  return {
    ...actual,
    globalEcosystemLogout: vi.fn(),
    initEcosystemSessionWatcher: () => () => {},
    isExplicitlyLoggedOut: () => false,
    getEcosystemCookie: () => null,
  };
});

vi.mock("@/components/EcosystemSwitcher", () => ({
  EcosystemSwitcher: () => <div data-testid="ecosystem-switcher" />,
}));

vi.mock("@/lib/brand", () => ({
  getCachedBrandName: () => "Inhyma ERP",
  getCachedBrandLogo: () => null,
  resolveBrandInfo: vi.fn().mockResolvedValue({ name: "Inhyma ERP", logoUrl: null }),
  resolveImageUrl: (u: string) => u,
  subscribeBrandLogo: () => () => {},
  subscribeBrandName: () => () => {},
}));

describe("Permission sync & zero-permission module visibility", () => {
  beforeEach(() => {
    localStorage.clear();
    Auth.resetProfileSyncCooldown();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("hides Companies from sidebar and redirects to /403 when live profile has 0 permissions or PERMISSIONS_UPDATED arrives", async () => {
    Auth.setSession(
      { access_token: "tok-1", refresh_token: "ref-1", token_type: "bearer" } as any,
      {
        id: "usera-1",
        username: "usera",
        display_name: "User A",
        roles: ["Test"],
        permissions: ["company.view"],
      } as any
    );

    let serverPermissions: string[] = ["company.view"];
    vi.spyOn(api, "apiGet").mockImplementation(async (url: string) => {
      if (url === "/auth/profile") {
        return {
          data: {
            id: "usera-1",
            username: "usera",
            display_name: "User A",
            roles: ["Test"],
            permissions: serverPermissions,
          },
        } as any;
      }
      if (url.startsWith("/notifications")) {
        return { data: { items: [], unread_count: 0 } } as any;
      }
      return { data: [] } as any;
    });

    const listeners = new Set<(ev: any) => void>();
    vi.spyOn(liveClient, "subscribe").mockImplementation(() => {});
    vi.spyOn(liveClient, "unsubscribe").mockImplementation(() => {});
    vi.spyOn(liveClient, "onEvent").mockImplementation((cb: any) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    });

    render(
      <MemoryRouter initialEntries={["/companies"]}>
        <Routes>
          <Route
            path="/companies"
            element={
              <AppShell activeKey="companies">
                <div>Companies Content</div>
              </AppShell>
            }
          />
          <Route path="/403" element={<div>Forbidden 403 Redirected</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Companies Content")).toBeTruthy());
    expect(screen.getByText("Companies")).toBeTruthy();

    // Admin revokes all permissions on backend & broadcasts PERMISSIONS_UPDATED
    serverPermissions = [];
    for (const cb of listeners) {
      cb({ event_type: "PERMISSIONS_UPDATED", module: "rbac", entity: "user_permissions", entity_id: "usera-1" });
    }

    await waitFor(() => expect(screen.getByText("Forbidden 403 Redirected")).toBeTruthy());
    expect(Auth.getProfile()?.permissions).toEqual([]);
  });
});
