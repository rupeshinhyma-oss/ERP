import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Dashboard } from "../pages/Dashboard";
import { Auth } from "../lib/auth";
import { GlobalSessionProvider } from "../lib/session";
import { ToastProvider } from "../lib/toast";
import * as apiModule from "../lib/api";

describe("Dashboard Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Auth.setSession(
      "mock-admin-token",
      {
        id: "admin-id",
        display_name: "Platform SuperAdmin",
        email: "admin@erp-main.local",
        role: "SUPER_ADMIN",
        is_active: true,
        created_at: new Date().toISOString(),
      },
      "platform_admin"
    );

    vi.spyOn(apiModule, "apiGet").mockImplementation(async (url: string) => {
      if (url.startsWith("/auth/sessions/current")) {
        return { is_valid: true };
      }
      return null;
    });
  });

  const renderDashboard = () => {
    return render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <GlobalSessionProvider>
          <ToastProvider>
            <Dashboard />
          </ToastProvider>
        </GlobalSessionProvider>
      </MemoryRouter>
    );
  };

  it("renders clean welcome greeting with Super Admin", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Welcome To Super Admin/i })).toBeDefined();
    });
  });

  it("does not render deprecated fleet cards, projection tables, or kpis", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.queryByText("Active ERP Instances")).toBeNull();
      expect(screen.queryByText("Registered ERP Fleet Status")).toBeNull();
      expect(screen.queryByText("Projection Sync Health")).toBeNull();
      expect(screen.queryByText("Recent Control Panel Audit Events")).toBeNull();
      expect(screen.queryByRole("button", { name: /Rebuild Projections/i })).toBeNull();
    });
  });

  it("falls back to default title if user profile has no display name", async () => {
    Auth.setSession(
      "mock-admin-token",
      {
        id: "admin-id",
        email: "",
        role: "SUPER_ADMIN",
        is_active: true,
        created_at: new Date().toISOString(),
      } as any,
      "platform_admin"
    );

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Welcome To Super Admin/i })).toBeDefined();
    });
  });
});
