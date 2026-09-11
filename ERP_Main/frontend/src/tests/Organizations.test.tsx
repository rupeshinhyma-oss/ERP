/**
 * Test Suite for Organizations Component in ERP_Main.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Organizations } from "@/pages/Organizations";
import { Auth } from "@/lib/auth";
import { GlobalSessionProvider } from "@/lib/session";
import { ToastProvider } from "@/lib/toast";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
}));

describe("Organizations Page Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Auth.setSession("mock-admin-token", {
      id: "admin-id",
      display_name: "Platform SuperAdmin",
      email: "admin@erp-main.local",
      role: "SUPER_ADMIN",
      is_active: true,
      created_at: new Date().toISOString(),
    });
  });

  it("renders operating ERP companies and architectural boundary banner", async () => {
    vi.mocked(api.apiGet).mockResolvedValueOnce([
      {
        id: "erp-1",
        name: "Yinglima ERP",
        erp_key: "yinglima",
        status: "ACTIVE",
        version: "1.0.0",
        base_url: "http://localhost:5173",
        capabilities: ["buyers", "planning"],
        created_at: new Date().toISOString(),
      },
      {
        id: "erp-2",
        name: "Inhyma ERP",
        erp_key: "inhyma",
        status: "ACTIVE",
        version: "1.0.0",
        base_url: "http://localhost:5174",
        capabilities: ["suppliers", "tasks"],
        created_at: new Date().toISOString(),
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/organizations/companies"]}>
        <GlobalSessionProvider>
          <ToastProvider>
            <Organizations />
          </ToastProvider>
        </GlobalSessionProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Yinglima ERP")).toBeDefined();
      expect(screen.getByText("Inhyma ERP")).toBeDefined();
    });

    expect(screen.getByText("Enterprise Organization Boundary Architecture")).toBeDefined();
    expect(screen.getByText("active ERP nodes", { exact: false })).toBeDefined();
  });

  it("renders honest architectural empty state for internal departments", async () => {
    vi.mocked(api.apiGet).mockResolvedValueOnce([]);

    render(
      <MemoryRouter initialEntries={["/organizations/departments"]}>
        <GlobalSessionProvider>
          <ToastProvider>
            <Organizations />
          </ToastProvider>
        </GlobalSessionProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByText("Child ERP Department Federations")
      ).toBeDefined();
    });
  });
});
