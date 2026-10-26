import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { Auth } from "../lib/auth";

describe("AppShell Component", () => {
  beforeEach(() => {
    localStorage.clear();
    Auth.clear();
  });

  it("redirects unauthenticated users to login", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AppShell activeKey="dashboard">
          <div>Dashboard Content</div>
        </AppShell>
      </MemoryRouter>
    );

    // Unauthenticated user should not see protected content
    expect(screen.queryByText("Dashboard Content")).toBeNull();
  });

  it("renders sidebar navigation and brand when authenticated", () => {
    Auth.setSession("valid-test-token", {
      id: "admin-1",
      email: "admin@example.com",
      display_name: "Master Admin",
      role: "SUPER_ADMIN",
      is_active: true,
      created_at: new Date().toISOString(),
    });

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AppShell activeKey="dashboard" pageTitle="ERP Dashboard" breadcrumbs={["Overview"]}>
          <div>Protected Dashboard Content</div>
        </AppShell>
      </MemoryRouter>
    );

    expect(screen.getByText("Protected Dashboard Content")).toBeDefined();
    expect(screen.getAllByText("ERP Dashboard").length).toBeGreaterThan(0);
    expect(document.getElementById("header-erp-switcher-btn")?.textContent).toContain("ERP Dashboard");
    expect(screen.getByText("User & Access")).toBeDefined();
    expect(screen.queryByText("Sync Policies")).toBeNull();
    expect(screen.getByText("Global Audit Logs")).toBeDefined();
    expect(screen.queryByText("System Health")).toBeNull();
  });

  it("shows only Dashboard module when authenticated as a user with None role / no platform permissions", () => {
    Auth.setSession(
      "valid-none-user-token",
      {
        id: "user-none-1",
        primary_email: "noneuser@example.com",
        display_name: "Regular Spoke User",
        role: "NONE",
        status: "ACTIVE",
        permissions: [],
        created_at: new Date().toISOString(),
      },
      "global_user"
    );

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AppShell activeKey="dashboard" pageTitle="ERP Dashboard">
          <div>Protected Dashboard Content</div>
        </AppShell>
      </MemoryRouter>
    );

    expect(screen.getByText("Protected Dashboard Content")).toBeDefined();
    expect(screen.getAllByText("ERP Dashboard").length).toBeGreaterThan(0);

    // Dashboard must be visible
    expect(screen.getByText("Dashboard")).toBeDefined();

    // All other modules must NOT be visible
    expect(screen.queryByText("User & Access")).toBeNull();
    expect(screen.queryByText("USERS & ACCESS")).toBeNull();
    expect(screen.queryByText("Global Audit Logs")).toBeNull();
    expect(screen.queryByText("MONITORING & AUDIT")).toBeNull();
    expect(screen.queryByText("ERP_Main Settings")).toBeNull();
    expect(screen.queryByText("SETTINGS")).toBeNull();

    // Role badge should show None
    expect(screen.getByText("• None")).toBeDefined();
  });
});

describe("AppShell: a single-ERP user whose ERP refused the sign-in", () => {
  const memberships = [{ status: "ACTIVE", erp_key: "inhyma", erp_name: "Inhyma ERP" }];

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    Auth.clear();
    Auth.setSession(
      "global-user-token",
      { id: "u-b", primary_email: "userb@gmail.com", display_name: "User B", role: "NONE", status: "ACTIVE", permissions: [], created_at: new Date().toISOString() },
      "global_user"
    );
  });

  async function mountWith(search: string) {
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.doMock("../lib/session", () => ({
      useGlobalSession: () => ({ userType: "global_user", memberships, loading: false, logout: vi.fn() }),
    }));
    window.history.pushState({}, "", `/dashboard${search}`);
    const { AppShell: Shell } = await import("../components/AppShell");
    const { Auth: A } = await import("../lib/auth");
    A.setSession(
      "global-user-token",
      { id: "u-b", primary_email: "userb@gmail.com", display_name: "User B", role: "NONE", status: "ACTIVE", permissions: [], created_at: new Date().toISOString() },
      "global_user"
    );
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Shell activeKey="dashboard">
          <div>Dashboard Content</div>
        </Shell>
      </MemoryRouter>
    );
  }

  it("shows the ERP's reason and the Try again / Sign out buttons instead of an endless spinner", async () => {
    await mountWith("?sso_error=no_access&sso_erp=inhyma&sso_reason=ERP_Main%20grants%20access%20to%20%5B'erp_09'%5D");
    expect(screen.getByRole("alert").textContent).toContain("We could not open inhyma");
    expect(screen.getByRole("alert").textContent).toContain("ERP_Main grants access to ['erp_09']");
    expect(screen.getByText("Try again")).toBeDefined();
    expect(screen.getByText("Sign out")).toBeDefined();
    expect(screen.queryByText(/Redirecting directly to your authorized ERP/)).toBeNull();
  });

  it("still shows the redirect message when there is no error", async () => {
    await mountWith("");
    expect(screen.getByText(/Redirecting directly to your authorized ERP/)).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("AppShell: where a signed-in Global User belongs is ERP_Main's live decision", () => {
  const REAL_LOCATION = window.location;
  const member = (key: string) => ({ status: "ACTIVE", erp_key: key, erp_name: key });
  let assign: ReturnType<typeof vi.fn>;

  async function mount(landing: unknown, memberships: unknown[]) {
    const { vi: v } = await import("vitest");
    v.resetModules();
    assign = v.fn();
    Object.defineProperty(window, "location", {
      value: { ...REAL_LOCATION, assign, replace: v.fn(), href: "http://localhost:5170/dashboard", search: "", pathname: "/dashboard", hash: "", hostname: "erp.example.com", origin: "https://erp.example.com" },
      writable: true,
      configurable: true,
    });
    v.doMock("../lib/session", () => ({
      useGlobalSession: () => ({ userType: "global_user", memberships, loading: false, logout: v.fn() }),
    }));
    v.doMock("../lib/ssoBridge", async (orig) => ({
      ...(await orig<typeof import("../lib/ssoBridge")>()),
      fetchLanding: async () => landing,
    }));
    const { AppShell: Shell } = await import("../components/AppShell");
    const { Auth: A } = await import("../lib/auth");
    A.setSession(
      "t",
      { id: "u-b", primary_email: "userb@gmail.com", display_name: "User B", role: "NONE", status: "ACTIVE", permissions: [], created_at: new Date().toISOString() },
      "global_user",
    );
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Shell activeKey="dashboard">
          <div>Dashboard Content</div>
        </Shell>
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(window, "location", { value: REAL_LOCATION, writable: true, configurable: true });
  });

  const inh = { key: "inhyma", name: "Inhyma ERP", url: "https://inh.example.com/dashboard" };

  it("exactly one ERP -> goes straight to THAT ERP's registry address (nothing hard-coded)", async () => {
    await mount({ mode: "single", target: inh, erps: [inh], control_plane_url: "https://erp.example.com/dashboard" }, [member("inhyma")]);
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const url = new URL(String(assign.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://inh.example.com/dashboard");
    expect(JSON.parse(atob(url.searchParams.get("sso_handover")!)).allowed_erps).toEqual(["inhyma"]);
  });

  it("no usable ERP -> stays on the dashboard, with NO endless spinner (even if a membership row exists)", async () => {
    await mount({ mode: "dashboard", target: { key: "control-plane", name: "ERP Dashboard", url: "https://erp.example.com/dashboard" }, erps: [] }, [member("inhyma")]);
    await waitFor(() => expect(screen.getByText("Dashboard Content")).toBeDefined());
    expect(assign).not.toHaveBeenCalled();
    expect(screen.queryByText(/Redirecting directly to your authorized ERP/)).toBeNull();
  });

  it("several ERPs -> stays on the dashboard to switch, no redirect", async () => {
    const yl = { key: "yinglima", name: "Yinglima ERP", url: "https://yl.example.com/dashboard" };
    await mount({ mode: "multi", target: null, erps: [inh, yl] }, [member("inhyma"), member("yinglima")]);
    await waitFor(() => expect(screen.getByText("Dashboard Content")).toBeDefined());
    expect(assign).not.toHaveBeenCalled();
  });

  it("a future ERP key works the same way (single -> its own registry address)", async () => {
    const f3 = { key: "erp_03", name: "Future ERP", url: "https://f3.example.com/dashboard" };
    await mount({ mode: "single", target: f3, erps: [f3] }, [member("erp_03")]);
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(String(assign.mock.calls[0][0])).toContain("https://f3.example.com/");
  });

  it("never leaves the person on a spinner: if the decision never arrives, the dashboard shows after 8 s", async () => {
    vi.useFakeTimers();
    try {
      await mount(new Promise(() => undefined) as unknown, [member("inhyma")]);
      expect(screen.queryByText("Dashboard Content")).toBeNull(); // spinner while undecided
      await vi.advanceTimersByTimeAsync(8100);
      expect(screen.getByText("Dashboard Content")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});