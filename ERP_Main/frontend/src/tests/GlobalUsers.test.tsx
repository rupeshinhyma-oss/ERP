import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GlobalUsers } from "../pages/GlobalUsers";
import { Auth } from "../lib/auth";
import * as apiModule from "../lib/api";

describe("GlobalUsers Page", () => {
  const mockUsers = [
    {
      id: "u-1",
      display_name: "Alice Wang",
      primary_email: "alice@company.com",
      status: "ACTIVE",
      external_identity_id: "EXT-001",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "u-2",
      display_name: "Bob Smith",
      primary_email: "bob@company.com",
      status: "SUSPENDED",
      external_identity_id: null,
      created_at: "2026-01-02T00:00:00Z",
    },
  ];

  const mockErps = [
    {
      id: "erp-1",
      erp_key: "YINGLIMA_TEST",
      name: "Yinglima ERP",
      status: "ACTIVE",
      version: "2.1.0",
      base_url: "http://localhost:8000",
      capabilities: ["SSO"],
      created_at: "2026-01-01T00:00:00Z",
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    Auth.setSession("test-token", {
      id: "admin-1",
      email: "admin@platform.local",
      display_name: "Platform Admin",
      role: "SUPER_ADMIN",
      is_active: true,
      created_at: new Date().toISOString(),
    });
    vi.restoreAllMocks();
  });

  it("renders global users table and statistics accurately", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/users")) {
        return Promise.resolve(mockUsers);
      }
      if (url.includes("/global/erps")) {
        return Promise.resolve(mockErps);
      }
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <GlobalUsers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Alice Wang")).toBeDefined();
      expect(screen.getByText("alice@company.com")).toBeDefined();
      expect(screen.getByText("Bob Smith")).toBeDefined();
      expect(screen.getByText("bob@company.com")).toBeDefined();
    });

    // Check status badges
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Suspended").length).toBeGreaterThan(0);


    // Check action buttons
    expect(screen.getAllByText("Details").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Provision").length).toBeGreaterThan(0);
  });


  it("filters users by search query", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/users")) return Promise.resolve(mockUsers);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <GlobalUsers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Alice Wang")).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText("Search by name, email or external ID...");
    fireEvent.change(searchInput, { target: { value: "Bob" } });

    expect(screen.queryByText("Alice Wang")).toBeNull();
    expect(screen.getByText("Bob Smith")).toBeDefined();
  });

  it("opens create user modal and submits with primary_email", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/users")) return Promise.resolve(mockUsers);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      return Promise.resolve([]);
    });

    const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      id: "u-3",
      display_name: "Charlie Brown",
      primary_email: "charlie@company.com",
      status: "ACTIVE",
    });

    render(
      <MemoryRouter>
        <GlobalUsers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Alice Wang")).toBeDefined();
    });

    // Click "Create Global User"
    const newBtn = screen.getByText("Create Global User");
    fireEvent.click(newBtn);


    expect(screen.getByRole("heading", { name: "Create Global User" })).toBeDefined();

    // Fill form
    const nameInput = screen.getByLabelText(/Full Name/i);
    const emailInput = screen.getByLabelText(/Primary Email/i);

    fireEvent.change(nameInput, { target: { value: "Charlie Brown" } });
    fireEvent.change(emailInput, { target: { value: "charlie@company.com" } });

    const submitBtn = screen.getByRole("button", { name: "Create User" });
    fireEvent.click(submitBtn);


    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/global/users", {
        display_name: "Charlie Brown",
        primary_email: "charlie@company.com",
        external_identity_id: null,
      });
    });
  });

  it("opens detail drawer and displays access summary tabs", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/users?")) return Promise.resolve(mockUsers);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      if (url.includes("/memberships")) {
        return Promise.resolve([
          {
            id: "mem-1",
            global_user_id: "u-1",
            erp_instance_id: "erp-1",
            local_user_id: "loc-999",
            status: "ACTIVE",
            created_at: "2026-01-01T00:00:00Z",
          },
        ]);
      }
      if (url.includes("/roles")) {
        return Promise.resolve([
          {
            id: "assign-1",
            global_user_id: "u-1",
            role_id: "r-1",
            role_key: "PLATFORM_ADMIN",
            scope: "GLOBAL",
            is_active: true,
            created_at: "2026-01-01T00:00:00Z",
          },
        ]);
      }
      if (url.includes("/effective-permissions")) {
        return Promise.resolve({
          global_user_id: "u-1",
          global_permissions: ["platform.users.read", "platform.erp.read"],
          erp_permissions: {},
        });
      }
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <GlobalUsers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Alice Wang")).toBeDefined();
    });

    // Click "Details" on Alice Wang
    const detailsBtns = screen.getAllByText("Details");
    fireEvent.click(detailsBtns[0]);


    await waitFor(() => {
      expect(screen.getByText("Global User: Alice Wang")).toBeDefined();
      expect(screen.getByText("Memberships (1)")).toBeDefined();
      expect(screen.getByText("Platform Roles (1)")).toBeDefined();
      expect(screen.getByText("Access Summary")).toBeDefined();
    });


    // Switch to Access Summary Tab
    const accessTab = screen.getByText("Access Summary");
    fireEvent.click(accessTab);

    await waitFor(() => {
      expect(screen.getByText("Live Access Summary")).toBeDefined();
      expect(screen.getByText("platform.users.read")).toBeDefined();
      expect(screen.getByText("platform.erp.read")).toBeDefined();
    });
  });
});

