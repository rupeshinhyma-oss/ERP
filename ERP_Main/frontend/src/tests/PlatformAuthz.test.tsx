import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PlatformAuthz } from "../pages/PlatformAuthz";
import { Auth } from "../lib/auth";
import * as apiModule from "../lib/api";

describe("PlatformAuthz Page", () => {
  const mockRoles = [
    {
      id: "role-1",
      role_key: "SUPER_ADMIN",
      display_name: "Super Administrator",
      description: "Root control plane operations",
      is_active: true,
      permission_keys: ["platform.users.read", "platform.erp.read"],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "role-2",
      role_key: "AUDITOR",
      display_name: "Compliance Auditor",
      description: "Read audit logs only",
      is_active: true,
      permission_keys: ["platform.audit.read"],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ];

  const mockPermissions = [
    {
      id: "p-1",
      permission_key: "platform.users.read",
      description: "Read global users and memberships",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "p-2",
      permission_key: "platform.audit.read",
      description: "Read global audit events",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];

  const mockUsers = [
    {
      id: "u-1",
      display_name: "Alice Wang",
      primary_email: "alice@company.com",
      status: "ACTIVE",
      created_at: "2026-01-01T00:00:00Z",
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
      display_name: "Admin",
      role: "SUPER_ADMIN",
      is_active: true,
      created_at: new Date().toISOString(),
    });
    vi.restoreAllMocks();
  });

  it("renders platform roles tab and decoupled authorization banner", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/authz/roles")) return Promise.resolve(mockRoles);
      if (url.includes("/global/authz/permissions")) return Promise.resolve(mockPermissions);
      if (url.includes("/global/users")) return Promise.resolve(mockUsers);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <PlatformAuthz />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Control Plane Authorization (Platform RBAC) vs. ERP Local RBAC")).toBeDefined();
      expect(screen.getByText("Super Administrator")).toBeDefined();
      expect(screen.getByText("Compliance Auditor")).toBeDefined();
      expect(screen.getByText("SUPER_ADMIN")).toBeDefined();
      expect(screen.getByText("AUDITOR")).toBeDefined();
    });
  });

  it("creates a new platform role", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/authz/roles")) return Promise.resolve(mockRoles);
      if (url.includes("/global/authz/permissions")) return Promise.resolve(mockPermissions);
      if (url.includes("/global/users")) return Promise.resolve(mockUsers);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      return Promise.resolve([]);
    });

    const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      id: "role-3",
      role_key: "OPERATOR",
      display_name: "Integration Operator",
      description: "Manages queues",
      is_active: true,
      permission_keys: [],
    });

    render(
      <MemoryRouter>
        <PlatformAuthz />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Super Administrator")).toBeDefined();
    });

    const createBtn = screen.getByText("Create Role");
    fireEvent.click(createBtn);

    expect(screen.getByText("Role Key (UPPERCASE_SNAKE_CASE) *")).toBeDefined();

    const keyInput = screen.getByPlaceholderText(/e.g. AUDITOR, SECURITY_ADMIN/i);
    const nameInput = screen.getByPlaceholderText(/e.g. Compliance Auditor/i);
    const descInput = screen.getByPlaceholderText(/Describe the operational responsibilities/i);

    fireEvent.change(keyInput, { target: { value: "OPERATOR" } });
    fireEvent.change(nameInput, { target: { value: "Integration Operator" } });
    fireEvent.change(descInput, { target: { value: "Manages queues" } });
    const createRoleBtns = screen.getAllByRole("button", { name: "Create Role" });
    const submitBtn = createRoleBtns[createRoleBtns.length - 1];
    fireEvent.click(submitBtn);



    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/global/authz/roles", {
        role_key: "OPERATOR",
        display_name: "Integration Operator",
        description: "Manages queues",
      });
    });
  });

  it("switches to Permissions tab and displays catalog", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/authz/roles")) return Promise.resolve(mockRoles);
      if (url.includes("/global/authz/permissions")) return Promise.resolve(mockPermissions);
      if (url.includes("/global/users")) return Promise.resolve(mockUsers);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <PlatformAuthz />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Super Administrator")).toBeDefined();
    });

    const permsTab = screen.getByText(/Platform Permissions/i);
    fireEvent.click(permsTab);

    await waitFor(() => {
      expect(screen.getByText("platform.users.read")).toBeDefined();
      expect(screen.getByText("platform.audit.read")).toBeDefined();
    });
  });

  it("switches to User Role Assignments tab and displays effective permissions", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/authz/roles")) return Promise.resolve(mockRoles);
      if (url.includes("/global/authz/permissions")) return Promise.resolve(mockPermissions);
      if (url.includes("/global/users")) return Promise.resolve(mockUsers);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      if (url.includes("/roles")) {
        return Promise.resolve([
          {
            id: "assign-1",
            global_user_id: "u-1",
            role_id: "role-1",
            role_key: "SUPER_ADMIN",
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
        <PlatformAuthz />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Super Administrator")).toBeDefined();
    });

    const assignmentsTab = screen.getByText("User Role Assignments");
    fireEvent.click(assignmentsTab);

    await waitFor(() => {
      expect(screen.getByText("Live Computed Effective Permissions")).toBeDefined();
      expect(screen.getByText("platform.users.read")).toBeDefined();
      expect(screen.getByText("platform.erp.read")).toBeDefined();
    });
  });

  it("toggles permission checkbox in Role-Permission Matrix tab", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/authz/roles")) return Promise.resolve(mockRoles);
      if (url.includes("/global/authz/permissions")) return Promise.resolve(mockPermissions);
      if (url.includes("/global/users")) return Promise.resolve(mockUsers);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      return Promise.resolve([]);
    });

    const deleteSpy = vi.spyOn(apiModule, "apiDelete").mockResolvedValue({ success: true });

    render(
      <MemoryRouter>
        <PlatformAuthz />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Super Administrator")).toBeDefined();
    });

    const matrixTab = screen.getByText("Role-Permission Matrix");
    fireEvent.click(matrixTab);

    await waitFor(() => {
      expect(screen.getByText("Permission Key / Domain")).toBeDefined();
    });

    // In mockRoles, SUPER_ADMIN has platform.users.read checked.
    // Finding all checkboxes
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThan(0);

    // Uncheck platform.users.read from SUPER_ADMIN
    fireEvent.click(checkboxes[0]);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith(
        expect.stringContaining("/global/authz/roles/role-1/permissions/platform.users.read")
      );
    });
  });
});
