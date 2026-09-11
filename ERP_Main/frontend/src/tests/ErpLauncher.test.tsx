import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ErpLauncher } from "../pages/ErpLauncher";
import { GlobalSessionProvider } from "../lib/session";
import { Auth } from "../lib/auth";
import * as apiModule from "../lib/api";

describe("ErpLauncher Component", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    Auth.setSession("test-token", {
      id: "admin-1",
      email: "admin@platform.local",
      display_name: "Admin",
      role: "SUPER_ADMIN",
      is_active: true,
      created_at: new Date().toISOString(),
    }, "platform_admin");
  });

  it("renders authorized ERP launch cards", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((endpoint: string) => {
      if (endpoint === "/global/erps") {
        return Promise.resolve({
          data: [
            {
              id: "erp-1",
              erp_key: "yinglima",
              name: "Yinglima ERP",
              status: "ACTIVE",
              version: "1.0.0",
              base_url: "http://localhost:8001",
              capabilities: ["buyers", "suppliers"],
              created_at: new Date().toISOString(),
            },
          ],
        });
      }
      if (endpoint.includes("/memberships")) {
        return Promise.resolve({
          data: [
            {
              id: "mem-1",
              global_user_id: "admin-1",
              erp_instance_id: "erp-1",
              local_user_id: "u-101",
              status: "ACTIVE",
              created_at: new Date().toISOString(),
            },
          ],
        });
      }
      if (endpoint === "/global/auth/me") {
        return Promise.resolve({
          data: {
            id: "admin-1",
            email: "admin@platform.local",
            display_name: "Admin",
            role: "SUPER_ADMIN",
            is_active: true,
            created_at: new Date().toISOString(),
          },
        });
      }
      return Promise.resolve({ data: null });
    });

    render(
      <MemoryRouter>
        <GlobalSessionProvider>
          <ErpLauncher />
        </GlobalSessionProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Yinglima ERP")).toBeDefined();
      expect(screen.getByText("Open Yinglima ERP")).toBeDefined();
      expect(screen.getByText("http://localhost:8001")).toBeDefined();
    });
  });

  it("renders both Inhyma and Yinglima with their respective host URLs", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((endpoint: string) => {
      if (endpoint === "/global/erps") {
        return Promise.resolve({
          data: [
            {
              id: "erp-yinglima",
              erp_key: "yinglima",
              name: "Yinglima ERP",
              status: "ACTIVE",
              base_url: "http://localhost:5173/dashboard",
            },
            {
              id: "erp-inhyma",
              erp_key: "inhyma",
              name: "Inhyma ERP",
              status: "ACTIVE",
              base_url: "http://localhost:5174/dashboard",
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <MemoryRouter>
        <GlobalSessionProvider>
          <ErpLauncher />
        </GlobalSessionProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Yinglima ERP")).toBeDefined();
      expect(screen.getByText("Inhyma ERP")).toBeDefined();
      expect(screen.getByText("http://localhost:5173/dashboard")).toBeDefined();
      expect(screen.getByText("http://localhost:5174/dashboard")).toBeDefined();
      expect(screen.getByText("Open Yinglima ERP")).toBeDefined();
      expect(screen.getByText("Open Inhyma ERP")).toBeDefined();
    });
  });
});
