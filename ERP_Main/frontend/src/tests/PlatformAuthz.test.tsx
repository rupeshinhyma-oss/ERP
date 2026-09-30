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
      role_key: "ADMIN",
      display_name: "Admin",
      description: "Fixed platform administrative role",
      is_active: true,
      permission_keys: ["platform.user.read"],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "role-2",
      role_key: "AUDITOR",
      display_name: "Compliance Auditor",
      description: "Read audit logs only",
      is_active: true,
      permission_keys: ["platform.audit.view"],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "role-super-admin",
      role_key: "SUPER_ADMIN",
      display_name: "Super Administrator",
      description: "Reserved for platform owner user, should be excluded from roles table",
      is_active: true,
      permission_keys: ["platform.user.read"],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ];

  const mockPermissions = [
    {
      id: "p-1",
      permission_key: "platform.audit.view",
      description: "View the audit module and platform audit logs.",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "p-2",
      permission_key: "platform.user.read",
      description: "View Global User accounts.",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "p-3",
      permission_key: "platform.user.create",
      description: "Create a Global User account.",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "p-4",
      permission_key: "platform.user.update",
      description: "Update a Global User account.",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "p-5",
      permission_key: "platform.user.disable",
      description: "Disable a Global User account.",
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
      email: "admin@example.com",
      display_name: "Admin",
      role: "SUPER_ADMIN",
      is_active: true,
      created_at: new Date().toISOString(),
    });
    vi.restoreAllMocks();
  });

  it("renders platform roles tab with Auditor, excluding Admin and Super Admin from roles list", async () => {
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
      expect(screen.queryByText("Control Plane Authorization (Platform RBAC) vs. ERP Local RBAC")).toBeNull();
      expect(screen.getByText("Platform Role")).toBeDefined();
      expect(screen.getByPlaceholderText("Search platform roles...")).toBeDefined();
      expect(screen.getByText("Compliance Auditor")).toBeDefined();
      expect(screen.getByText("AUDITOR")).toBeDefined();
      // Admin and Super Admin are strictly system platform identities, excluded from customizable RBAC roles
      expect(screen.queryByText("ADMIN")).toBeNull();
      expect(screen.queryByText("PLATFORM_ADMIN")).toBeNull();
      expect(screen.queryByText("Super Administrator")).toBeNull();
      expect(screen.queryByText("SUPER_ADMIN")).toBeNull();
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
      expect(screen.getByText("Compliance Auditor")).toBeDefined();
    });

    const createBtn = screen.getByText("Create Role");
    fireEvent.click(createBtn);

    expect(screen.getByText("Role Key (UPPERCASE_SNAKE_CASE) *")).toBeDefined();

    const keyInput = screen.getByPlaceholderText(/e.g. AUDITOR, SECURITY_ADMIN/i);
    const nameInput = screen.getByPlaceholderText(/e.g. Compliance Auditor/i);

    fireEvent.change(keyInput, { target: { value: "OPERATOR" } });
    fireEvent.change(nameInput, { target: { value: "Integration Operator" } });
    const createRoleBtns = screen.getAllByRole("button", { name: "Create Role" });
    const submitBtn = createRoleBtns[createRoleBtns.length - 1];
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/global/authz/roles", {
        role_key: "OPERATOR",
        display_name: "Integration Operator",
      });
    });
  });

  it("rejects creating a role with key SUPER_ADMIN, PLATFORM_SUPER_ADMIN, ADMIN, or PLATFORM_ADMIN", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/authz/roles")) return Promise.resolve(mockRoles);
      if (url.includes("/global/authz/permissions")) return Promise.resolve(mockPermissions);
      return Promise.resolve([]);
    });

    const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({});

    render(
      <MemoryRouter>
        <PlatformAuthz />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Compliance Auditor")).toBeDefined();
    });

    const createBtn = screen.getByText("Create Role");
    fireEvent.click(createBtn);

    const keyInput = screen.getByPlaceholderText(/e.g. AUDITOR, SECURITY_ADMIN/i);
    const nameInput = screen.getByPlaceholderText(/e.g. Compliance Auditor/i);

    fireEvent.change(keyInput, { target: { value: "ADMIN" } });
    fireEvent.change(nameInput, { target: { value: "Admin" } });
    const createRoleBtns = screen.getAllByRole("button", { name: "Create Role" });
    const submitBtn = createRoleBtns[createRoleBtns.length - 1];
    fireEvent.click(submitBtn);

    // postSpy should NOT be called because ADMIN is reserved
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("allows flexible role deletion for operational roles like Auditor", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/authz/roles")) return Promise.resolve(mockRoles);
      if (url.includes("/global/authz/permissions")) return Promise.resolve(mockPermissions);
      return Promise.resolve([]);
    });

    const deleteSpy = vi.spyOn(apiModule, "apiDelete").mockResolvedValue({ success: true });

    render(
      <MemoryRouter>
        <PlatformAuthz />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Compliance Auditor")).toBeDefined();
    });

    const deleteButtons = screen.getAllByRole("button", { name: /Delete/i });
    expect(deleteButtons.length).toBe(1);

    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Delete Platform Role/i)).toBeDefined();
    });

    const confirmBtn = screen.getByRole("button", { name: "Delete Role" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith("/global/authz/roles/role-2");
    });
  });

  it("does not render redundant Platform Permissions catalog tab and maintains roles overview", async () => {
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
      expect(screen.getByText("Compliance Auditor")).toBeDefined();
    });

    expect(screen.queryByText(/Platform Permissions \(/i)).toBeNull();
  });

  it("does not render redundant User Role Assignments and shows roles overview", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/authz/roles")) return Promise.resolve(mockRoles);
      if (url.includes("/global/authz/permissions")) return Promise.resolve(mockPermissions);
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <PlatformAuthz />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Compliance Auditor")).toBeDefined();
    });

    expect(screen.queryByText("User Role Assignments")).toBeNull();
    expect(screen.queryByText("Live Computed Effective Permissions")).toBeNull();
  });

  it("does not render redundant Role-Permission Matrix and toggles permission in Manage Policy modal", async () => {
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
      expect(screen.getByText("Compliance Auditor")).toBeDefined();
    });

    // Verify matrix tab is removed
    expect(screen.queryByText("Role-Permission Matrix")).toBeNull();

    // Click "Manage Policy" on Compliance Auditor
    const managePolicyBtns = screen.getAllByRole("button", { name: "Manage Policy" });
    fireEvent.click(managePolicyBtns[0]);

    await waitFor(() => {
      expect(screen.getByText(/Access Policy: Compliance Auditor/i)).toBeDefined();
    });

    // In mockRoles, AUDITOR has platform.audit.view checked
    // Audit & Security is the first domain, so checkbox 0 is platform.audit.view
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(5);

    // Uncheck platform.audit.view from AUDITOR
    fireEvent.click(checkboxes[0]);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith(
        expect.stringContaining("/global/authz/roles/role-2/permissions/platform.audit.view")
      );
    });

    // Verify removed modules are NOT present
    expect(screen.queryByText("ERP Registry")).toBeNull();
    expect(screen.queryByText("SSO & Federation")).toBeNull();
    expect(screen.queryByText("ERP Memberships")).toBeNull();
    expect(screen.queryByText("Projections & Sync")).toBeNull();
    expect(screen.queryByText("Cross-ERP Reports")).toBeNull();
    expect(screen.queryByText("Global Search")).toBeNull();
    expect(screen.queryByText("Service Identities")).toBeNull();
    expect(screen.queryByText("Platform Governance")).toBeNull();
    expect(screen.queryByText("ERP Capabilities")).toBeNull();
  });
});
