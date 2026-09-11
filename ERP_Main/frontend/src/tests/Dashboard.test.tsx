import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Dashboard } from "../pages/Dashboard";
import { Auth } from "../lib/auth";
import { GlobalSessionProvider } from "../lib/session";
import { ToastProvider } from "../lib/toast";
import * as apiModule from "../lib/api";

describe("Dashboard Page", () => {
  const mockDashboardData = {
    active_erps: 2,
    total_erps: 2,
    global_users: 25,
    active_memberships: 18,
    events_received_total: 154,
    events_dead_lettered_total: 2,
    erp_health: [
      {
        erp_id: "erp-uuid-1",
        erp_key: "yinglima",
        display_name: "Yinglima ERP",
        status: "ACTIVE",
        last_seen_at: "2026-09-08T10:00:00Z",
        api_health: "HEALTHY",
        enabled_capabilities: ["buyer_catalog", "orders"],
        buyer_projection_count: 42,
      },
      {
        erp_id: "erp-uuid-2",
        erp_key: "inhyma",
        display_name: "Inhyma ERP",
        status: "ACTIVE",
        last_seen_at: "2026-09-08T09:30:00Z",
        api_health: "STALE",
        enabled_capabilities: ["buyer_catalog"],
        buyer_projection_count: 15,
      },
    ],
    projection_health: [
      {
        projection_type: "global_buyer_projection",
        last_processed_at: "2026-09-08T10:00:00Z",
        events_processed_count: 57,
        error_count: 0,
        last_error: null,
        lag_seconds: 1.2,
      },
    ],
    data_as_of: "2026-09-08T10:00:00Z",
  };

  const mockAuditData = [
    {
      id: "audit-1",
      event_type: "GLOBAL_LOGIN_SUCCESS",
      actor_type: "HUMAN_ADMIN",
      actor_id: "admin-1",
      actor_label: "admin@erp-main.local",
      target_type: "global_user",
      target_id: "user-1",
      details: { method: "password" },
      created_at: "2026-09-08T09:59:00Z",
    },
    {
      id: "audit-2",
      event_type: "RECONCILIATION_EXECUTED",
      actor_type: "HUMAN_ADMIN",
      actor_id: "admin-1",
      actor_label: "admin@erp-main.local",
      target_type: "erp_instance",
      target_id: "erp-uuid-1",
      details: { projection_count: 42 },
      created_at: "2026-09-08T09:55:00Z",
    },
  ];

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
      if (url === "/global/dashboard") {
        return mockDashboardData;
      }
      if (url.startsWith("/global/audit")) {
        return mockAuditData;
      }
      if (url.startsWith("/auth/sessions/current")) {
        return { is_valid: true };
      }
      return null;
    });

    vi.spyOn(apiModule, "apiPost").mockImplementation(async (url: string) => {
      if (url === "/global/projections/buyers/rebuild") {
        return { fetched: 10, processed: 10, errors: 0 };
      }
      return {};
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

  it("renders dashboard KPIs and data freshness correctly", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /ERP Dashboard/i })).toBeDefined();
      expect(screen.getByText("25")).toBeDefined(); // Global users
      expect(screen.getByText("18")).toBeDefined(); // Active memberships
      expect(screen.getByText("154")).toBeDefined(); // Ingested events
    });
  });

  it("renders ERP fleet health cards with capabilities and projection counts", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getAllByText("Yinglima ERP").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Inhyma ERP").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("42 records")).toBeDefined();
      expect(screen.getByText("15 records")).toBeDefined();
      expect(screen.getAllByText("buyer_catalog").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders projection sync health table with events processed count", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Projection Sync Health")).toBeDefined();
      expect(screen.getByText("GLOBAL BUYER PROJECTION")).toBeDefined();
      expect(screen.getByText("57 events")).toBeDefined();
      expect(screen.getByText("1.2s")).toBeDefined();
    });
  });

  it("renders recent platform audit events feed accurately", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Recent Control Panel Audit Events")).toBeDefined();
      expect(screen.getByText("GLOBAL LOGIN SUCCESS")).toBeDefined();
      expect(screen.getByText("RECONCILIATION EXECUTED")).toBeDefined();
      expect(screen.getAllByText("admin@erp-main.local").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("opens rebuild projection modal and triggers rebuild endpoint on confirm", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Rebuild Projections/i })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: /Rebuild Projections/i }));

    await waitFor(() => {
      expect(screen.getByText(/Are you sure you want to rebuild the/i)).toBeDefined();
    });

    const confirmBtn = screen.getByRole("button", { name: /^Confirm Rebuild$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith("/global/projections/buyers/rebuild", {});
    });
  });
});
