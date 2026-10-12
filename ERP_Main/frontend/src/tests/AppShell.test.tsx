import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
