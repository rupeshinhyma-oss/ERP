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
      email: "admin@platform.local",
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
    expect(screen.getByText("Global Control Panel")).toBeDefined();
    expect(screen.getByText("ERP Registry")).toBeDefined();
    expect(screen.getByText("Global Users")).toBeDefined();
    expect(screen.getByText("ERP Memberships")).toBeDefined();
    expect(screen.getByText("Identity Conflicts")).toBeDefined();
  });
});
