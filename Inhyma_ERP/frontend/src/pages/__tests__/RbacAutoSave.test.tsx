import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RbacPage } from "../Rbac";
import { UsersPage } from "../Users";
import * as api from "@/lib/api";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    useAuth: () => ({
      hasPermission: () => true,
      isSuperAdmin: true,
      profile: { id: "admin-1", username: "admin", display_name: "Admin" },
    }),
    useModalHistorySync: vi.fn(),
    usePendingGuard: () => ({ isPending: () => false, guard: (fn: any) => fn }),
  };
});

const PERMS = [
  { id: "p-view", code: "company.view", module: "company", page: "companies", action: "view", description: "View" },
  { id: "p-create", code: "company.create", module: "company", page: "companies", action: "create", description: "Create" },
  { id: "p-task", code: "task.view", module: "task", page: "tasks", action: "view", description: "Task View" },
];

const ROLES = [
  {
    id: "role-test",
    name: "Test",
    description: "",
    is_system: false,
    permissions: ["company.view"],
    created_at: "2026-11-20T10:00:00Z",
  },
];

const USERS = [
  {
    id: "u-mgr",
    username: "mgr1",
    display_name: "Manager One",
    full_name: "Manager One",
    email: "mgr@example.com",
    roles: ["Test"],
    manager_id: null,
    is_active: true,
    status: "ACTIVE",
  },
  {
    id: "u-staff",
    username: "staff1",
    display_name: "Staff One",
    full_name: "Staff One",
    email: "staff@example.com",
    roles: ["Test"],
    manager_id: "u-mgr",
    is_active: true,
    status: "ACTIVE",
  },
];

describe("RBAC & Permission Overrides Auto-Save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(api, "apiGet").mockImplementation(async (url: string) => {
      if (url === "/rbac/permissions") return { data: PERMS } as any;
      if (url === "/rbac/roles") return { data: ROLES } as any;
      if (url.startsWith("/rbac/roles/") && url.endsWith("/hierarchy")) {
        return { data: { parents: [], children: [] } } as any;
      }
      if (url.startsWith("/users?")) {
        return { data: { items: USERS, pagination: { page: 1, page_size: 50, total: 2, total_pages: 1 } } } as any;
      }
      if (url === "/positions") return { data: [] } as any;
      if (url === "/rbac/users/u-mgr/effective-permissions" || url === "/rbac/users/u-staff/effective-permissions") {
        return {
          data: {
            is_super_admin: false,
            role_permissions: ["company.view"],
            user_grants: [],
            user_denies: [],
            effective_permissions: ["company.view"],
            user_info: { system_roles: ["Test"], employee_name: "Test Employee" },
          },
        } as any;
      }
      if (url === "/rbac/users/u-mgr/permissions" || url === "/rbac/users/u-staff/permissions") {
        return { data: [] } as any;
      }
      return { data: [] } as any;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("RbacPage auto-saves Department single toggles, Select Group, Select All, and Manager Overrides immediately without Save", async () => {
    const postSpy = vi.spyOn(api, "apiPost").mockResolvedValue({ data: { granted: true } } as any);
    const delSpy = vi.spyOn(api, "apiDelete").mockResolvedValue({ data: { revoked: true } } as any);
    const putSpy = vi.spyOn(api, "apiPut").mockResolvedValue({ data: { count: 2 } } as any);

    render(
      <MemoryRouter>
        <RbacPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Test")).toBeTruthy());

    // Open Test department via action dropdown
    const actionBtn = screen.getByRole("button", { name: /Actions|⋮/i });
    fireEvent.click(actionBtn);
    fireEvent.click(screen.getByText(/View/i));

    await waitFor(() => expect(screen.getByText("Department: Test")).toBeTruthy());
    expect(screen.getByText("Auto-saves on change")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Save Department/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Cancel$/i })).toBeNull();

    // 1. Single permission grant -> POST /rbac/roles/role-test/permissions without clicking Save Department
    const companiesCard = screen.getByText("Companies").closest(".permission-group") as HTMLElement;
    const companyCheckboxes = Array.from(companiesCard.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    // Find unchecked company.create inside the Companies module card
    const createCb = companyCheckboxes.find((cb) => !cb.checked)!;
    fireEvent.click(createCb);
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(
        "/rbac/roles/role-test/permissions",
        { permission_id: "p-create" },
        {},
        { idempotent: true }
      )
    );
    await waitFor(() => expect(screen.getByText("Auto-saved")).toBeTruthy());

    // 2. Toggle it off -> DELETE /rbac/roles/role-test/permissions/p-create
    fireEvent.click(createCb);
    await waitFor(() => expect(delSpy).toHaveBeenCalledWith("/rbac/roles/role-test/permissions/p-create"));

    // 3. Select Group -> PUT /rbac/roles/role-test/permissions/bulk (click Companies' Select Group; TASK renders above CONTACT)
    const companySelectGroupBtn = companiesCard.querySelector("button.toggle-btn") as HTMLButtonElement;
    fireEvent.click(companySelectGroupBtn);
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith(
        "/rbac/roles/role-test/permissions/bulk",
        {
          permission_ids: expect.arrayContaining(["p-view", "p-create"]),
        },
        {},
        { idempotent: true }
      )
    );

    // 4. Select All -> PUT /rbac/roles/role-test/permissions/bulk
    fireEvent.click(screen.getByRole("button", { name: /^Select All$/i }));
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith(
        "/rbac/roles/role-test/permissions/bulk",
        {
          permission_ids: expect.arrayContaining(["p-view", "p-create", "p-task"]),
        },
        {},
        { idempotent: true }
      )
    );

    // 5. Open Manager "Edit permissions" override modal -> auto-saves immediately, no Save button
    fireEvent.click(screen.getByRole("button", { name: /Edit permissions/i }));
    await waitFor(() => expect(screen.getByText(/Manage Permission Overrides/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Save Permission Overrides/i })).toBeNull();

    // Click Grant All inside Manager Override modal -> immediate PUT bulk
    fireEvent.click(screen.getByRole("button", { name: /Grant All/i }));
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith("/rbac/users/u-mgr/permissions/bulk", {
        overrides: expect.arrayContaining([
          { permission_id: "p-create", is_granted: true },
          { permission_id: "p-task", is_granted: true },
        ]),
      })
    );
  });

  it("UsersPage Permission Overrides auto-saves on click, Grant All, Deny All, and Reset without Save button", async () => {
    const putSpy = vi.spyOn(api, "apiPut").mockResolvedValue({ data: { count: 1 } } as any);

    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Staff One")).toBeTruthy());

    const rowActionBtns = screen.getAllByRole("button", { name: /Actions|⋮/i });
    fireEvent.click(rowActionBtns[1]);
    fireEvent.click(screen.getByText(/Permission Overrides/i));

    await waitFor(() => expect(screen.getByText(/Manage Permission Overrides — Staff One/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Save Permission Overrides/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^Done$/i })).toBeTruthy();

    // Toggle company.create on -> immediate PUT bulk with p-create granted
    const createCb = screen.getByText("company.create").closest("label")!.querySelector("input[type='checkbox']") as HTMLInputElement;
    expect(createCb.checked).toBe(false);
    fireEvent.click(createCb);
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith("/rbac/users/u-staff/permissions/bulk", {
        overrides: [{ permission_id: "p-create", is_granted: true }],
      })
    );

    // Click Deny All -> immediate PUT bulk denying role-inherited company.view
    fireEvent.click(screen.getByRole("button", { name: /Deny All/i }));
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith("/rbac/users/u-staff/permissions/bulk", {
        overrides: [{ permission_id: "p-view", is_granted: false }],
      })
    );

    // Click Reset to Departments -> immediate PUT bulk with empty overrides
    fireEvent.click(screen.getByRole("button", { name: /Reset to Departments/i }));
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith("/rbac/users/u-staff/permissions/bulk", {
        overrides: [],
      })
    );
  });
});
