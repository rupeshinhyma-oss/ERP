import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GlobalAudit } from "../pages/GlobalAudit";
import { Auth } from "../lib/auth";
import { GlobalSessionProvider } from "../lib/session";
import { ToastProvider } from "../lib/toast";
import * as apiModule from "../lib/api";

describe("GlobalAudit Page", () => {
  const mockAuditLogs = [
    {
      id: "audit-1",
      event_type: "GLOBAL_USER_CREATED",
      actor_type: "HUMAN_ADMIN",
      actor_id: "admin-1",
      actor_label: "admin@erp-main.local",
      target_type: "global_user",
      target_id: "user-uuid-1234",
      details: { email: "newuser@example.com", primary: true },
      created_at: "2026-09-08T10:00:00Z",
    },
    {
      id: "audit-2",
      event_type: "INTEGRATION_EVENT_ROUTED",
      actor_type: "SYSTEM",
      actor_id: null,
      actor_label: "System Dispatcher",
      target_type: "integration_event",
      target_id: "evt-uuid-5678",
      details: { route: "inhyma", duration_ms: 12 },
      created_at: "2026-09-08T09:45:00Z",
    },
    {
      id: "audit-3",
      event_type: "SECURITY_INVALID_REDIRECT_URI",
      actor_type: "SYSTEM",
      actor_id: null,
      actor_label: "Federation Guard",
      target_type: "federation_request",
      target_id: null,
      details: { attempted_uri: "http://malicious.example.com" },
      created_at: "2026-09-08T09:30:00Z",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Auth.setSession(
      "mock-admin-token",
      {
        id: "admin-id",
        display_name: "Security Admin",
        email: "secadmin@erp-main.local",
        role: "PLATFORM_ADMIN",
        is_active: true,
        created_at: new Date().toISOString(),
      },
      "platform_admin"
    );

    vi.spyOn(apiModule, "apiGet").mockImplementation(async (url: string) => {
      if (url.startsWith("/global/audit")) {
        return mockAuditLogs;
      }
      if (url.startsWith("/auth/sessions/current")) {
        return { is_valid: true };
      }
      return null;
    });
  });

  const renderAudit = () => {
    return render(
      <MemoryRouter initialEntries={["/audit"]}>
        <GlobalSessionProvider>
          <ToastProvider>
            <GlobalAudit />
          </ToastProvider>
        </GlobalSessionProvider>
      </MemoryRouter>
    );
  };

  it("renders audit log table with event types and actors", async () => {
    renderAudit();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Global Audit Log/i })).toBeDefined();
      expect(screen.getByText("GLOBAL USER CREATED")).toBeDefined();
      expect(screen.getByText("INTEGRATION EVENT ROUTED")).toBeDefined();
      expect(screen.getByText("SECURITY INVALID REDIRECT URI")).toBeDefined();
      expect(screen.getByText("admin@erp-main.local")).toBeDefined();
      expect(screen.getByText("System Dispatcher")).toBeDefined();
    });
  });

  it("filters audit log entries by category", async () => {
    renderAudit();

    await waitFor(() => {
      expect(screen.getByText("GLOBAL USER CREATED")).toBeDefined();
    });

    const categorySelect = screen.getByRole("combobox");
    fireEvent.change(categorySelect, { target: { value: "SECURITY" } });

    await waitFor(() => {
      expect(screen.getByText("SECURITY INVALID REDIRECT URI")).toBeDefined();
      expect(screen.queryByText("GLOBAL USER CREATED")).toBeNull();
    });
  });

  it("opens audit event detail drawer and shows metadata", async () => {
    renderAudit();

    await waitFor(() => {
      expect(screen.getByText("GLOBAL USER CREATED")).toBeDefined();
    });

    const inspectButtons = screen.getAllByRole("button", { name: /^Inspect$/i });
    fireEvent.click(inspectButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Audit Event Inspection")).toBeDefined();
      expect(screen.getByText("newuser@example.com", { exact: false })).toBeDefined();
      expect(screen.getByText("UUID: user-uuid-1234")).toBeDefined();
    });
  });
});
