import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import { Auth } from "@/lib/auth";
import * as apiMod from "@/lib/api";

vi.mock("@/lib/ssoBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ssoBridge")>();
  return {
    ...actual,
    processIncomingSsoHandover: vi.fn().mockResolvedValue("none"),
    enforceCentralLanding: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/live/liveConnectionLifecycle", () => ({
  LiveConnectionLifecycle: () => null,
}));

describe("Wave 1 & Wave 2 Route Security Guards (BUG-001, BUG-002, BUG-005)", () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.restoreAllMocks();
    const ssoMod = await import("@/lib/ssoBridge");
    (ssoMod.processIncomingSsoHandover as any).mockResolvedValue("none");
    (ssoMod.enforceCentralLanding as any).mockResolvedValue(undefined);
    vi.spyOn(apiMod, "setUnauthorizedHandler").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("blocks unauthenticated navigation to /discount-payments/list, /agents, and /industrial/zones/list without firing module API calls", async () => {
    const getSpy = vi.spyOn(apiMod, "apiGet").mockResolvedValue({ data: [] } as any);

    for (const protectedPath of ["/discount-payments/list", "/agents", "/industrial/zones/list"]) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[protectedPath]}>
          <App />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(getSpy).not.toHaveBeenCalledWith(expect.stringMatching(/\/sales\/discount-payments|\/agents|\/industrial-zones/));
      });
      unmount();
    }
  });

  it("renders 403 Forbidden for authenticated employee lacking agent.view or zone.view", async () => {
    const getSpy = vi.spyOn(apiMod, "apiGet").mockResolvedValue({ data: { unread_count: 0 } } as any);
    Auth.setSession(
      { access_token: "synth-token", refresh_token: "synth-refresh" },
      {
        id: "00000000-0000-0000-0000-000000000099",
        username: "basic_emp",
        email: "emp@example.test",
        roles: ["user"],
        permissions: ["user.view", "task.view"],
      } as any
    );

    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/403 - Access Denied/i)).toBeTruthy();
    });
    expect(getSpy).not.toHaveBeenCalledWith(expect.stringContaining("/api/v1/agents"));
  });

  it("permits authorized user with agent.view and zone.view to load AgentsPage and IndustrialZonesPage", async () => {
    vi.spyOn(apiMod, "apiGet").mockImplementation(async (url: string) => {
      if (url.includes("/agents")) {
        return {
          data: [
            {
              id: "ag-synth-1",
              full_name: "Synthetic Authorized Agent",
              agent_type: "Commission Agent",
              calling_number: "9000099999",
              state: "Gujarat",
              district: "Ahmedabad",
              city: "Ahmedabad",
              current_status: "Existing",
              potential: "Yes",
            },
          ],
        } as any;
      }
      if (url.includes("/industrial-zones")) {
        return {
          data: [
            {
              id: "zn-synth-1",
              zone_name: "Synthetic Authorized GIDC",
              state: "Gujarat",
              district: "Ahmedabad",
              zone_grade: "A",
            },
          ],
        } as any;
      }
      return { data: [] } as any;
    });

    Auth.setSession(
      { access_token: "synth-token-auth", refresh_token: "synth-refresh-auth" },
      {
        id: "00000000-0000-0000-0000-000000000088",
        username: "contacts_mgr",
        email: "mgr@example.test",
        roles: ["user"],
        permissions: ["agent.view", "zone.view"],
      } as any
    );

    const { unmount } = render(
      <MemoryRouter initialEntries={["/agents"]}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText("Synthetic Authorized Agent")).toBeTruthy();
    });
    unmount();

    render(
      <MemoryRouter initialEntries={["/industrial/zones/list"]}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText("Synthetic Authorized GIDC")).toBeTruthy();
    });
  });
});
