import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RbacPage } from "../Rbac";
import { UsersPage } from "../Users";
import { groupPermissionsByModule, groupPermissionsIntoNavSections, MODULE_NAMES } from "@/lib/permissionLabels";
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

const MIXED_PERMS = [
  { id: "1", code: "trash.view", module: "trash", page: "trash", action: "view" },
  { id: "2", code: "socialmedia.view", module: "socialmedia", page: "masters-social-media", action: "view" },
  { id: "3", code: "saleorder.accounts", module: "saleorder", page: "sales-process", action: "accounts" },
  { id: "4", code: "proforma.manage", module: "proforma", page: "proforma-invoice", action: "manage" },
  { id: "5", code: "proforma.view", module: "proforma", page: "proforma-invoice", action: "view" },
  { id: "6", code: "proforma.create", module: "proforma", page: "proforma-invoice", action: "create" },
  { id: "7", code: "product.view", module: "product", page: "masters-products", action: "view" },
  { id: "8", code: "company.view", module: "company", page: "companies", action: "view" },
  { id: "9", code: "task.view", module: "task", page: "tasks", action: "view" },
  { id: "10", code: "feed.view", module: "feed", page: "feed", action: "view" },
  { id: "11", code: "supplier.view", module: "supplier", page: "suppliers", action: "view" },
  { id: "12", code: "user.view", module: "user", page: "users", action: "view" },
];

const ROLES = [
  { id: "r1", name: "Sales", description: "", is_system: false, permissions: [], created_at: "2026-11-24T10:00:00Z" },
];

const USERS = [
  {
    id: "u-1",
    username: "sales1",
    display_name: "Sales User",
    full_name: "Sales User",
    email: "sales1@example.com",
    roles: ["Sales"],
    is_active: true,
    status: "ACTIVE",
  },
];

describe("Inhyma RBAC left-sidebar navigation alignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(api, "apiGet").mockImplementation(async (url: string) => {
      if (url === "/rbac/permissions") return { data: MIXED_PERMS } as any;
      if (url === "/rbac/roles") return { data: ROLES } as any;
      if (url.startsWith("/rbac/roles/") && url.endsWith("/hierarchy")) return { data: { parents: [], children: [] } } as any;
      if (url.startsWith("/users?")) return { data: { items: USERS, pagination: { page: 1, page_size: 50, total: 1, total_pages: 1 } } } as any;
      if (url === "/positions") return { data: [] } as any;
      if (url === "/rbac/users/u-1/effective-permissions") {
        return {
          data: {
            is_super_admin: false,
            role_permissions: [],
            user_grants: [],
            user_denies: [],
            effective_permissions: [],
            user_info: { system_roles: ["Sales"], employee_name: "Sales User" },
          },
        } as any;
      }
      if (url === "/rbac/users/u-1/permissions") return { data: [] } as any;
      return { data: [] } as any;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("groups modules in exact left-sidebar navigation order and humanizes friendly names", () => {
    const groups = groupPermissionsByModule(MIXED_PERMS as any);
    const sections = groupPermissionsIntoNavSections(groups);

    expect(sections.map((s) => s.title)).toEqual([
      "DASHBOARD",
      "TASK",
      "CONTACT",
      "INVENTORY",
      "SALE",
      "PURCHASE",
      "USER MANAGEMENT",
      "SETTINGS — MASTERS",
      "SETTINGS — SYSTEM",
    ]);
    expect(sections.find((s) => s.id === "sale")?.moduleKeys).toEqual(["proforma", "saleorder"]);
    expect(groups.proforma.map((p) => p.code)).toEqual(["proforma.view", "proforma.create", "proforma.manage"]);
    expect(MODULE_NAMES.saleorder).toBe("Sales Process & Orders");
    expect(MODULE_NAMES.socialmedia).toBe("Social Media");
  });

  it("renders permission cards in left-sidebar navigation order on /rbac and Users Overrides modal", async () => {
    const { unmount } = render(
      <MemoryRouter>
        <RbacPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Sales")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Actions|⋮/i }));
    fireEvent.click(screen.getByText(/View/i));

    await waitFor(() => expect(screen.getByText("Department: Sales")).toBeTruthy());

    const renderedTitles = Array.from(document.querySelectorAll(".permission-group-title")).map((el) =>
      el.textContent?.trim()
    );
    expect(renderedTitles).toEqual([
      "Feed",
      "Tasks & Work Management",
      "Companies",
      "Product Master",
      "Proforma Invoices",
      "Sales Process & Orders",
      "Suppliers",
      "Users & Accounts",
      "Social Media",
      "Trash",
    ]);

    // Verify permission search bar filters Department Permissions by module, section, or permission code and clears cleanly
    const permSearch = screen.getByLabelText("Search permissions") as HTMLInputElement;
    fireEvent.change(permSearch, { target: { value: "proforma" } });
    expect(screen.getByText("Proforma Invoices")).toBeTruthy();
    expect(screen.queryByText("Tasks & Work Management")).toBeNull();
    expect(screen.getByText("proforma.view")).toBeTruthy();
    expect(screen.getByText("proforma.create")).toBeTruthy();

    fireEvent.change(permSearch, { target: { value: "saleorder.accounts" } });
    expect(screen.getByText("Sales Process & Orders")).toBeTruthy();
    expect(screen.queryByText("Proforma Invoices")).toBeNull();

    fireEvent.change(permSearch, { target: { value: "no-such-perm-xyz" } });
    expect(screen.getByText(/No permissions match/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Clear search/i }));
    expect(screen.getByText("Tasks & Work Management")).toBeTruthy();

    // Verify permission code nodes wrap long identifiers instead of overflowing their card
    const codeNode = screen.getByText("proforma.view") as HTMLElement;
    expect(codeNode.style.overflowWrap).toBe("anywhere");
    expect(codeNode.style.wordBreak).toBe("break-word");

    unmount();

    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Sales User")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Actions|⋮/i }));
    fireEvent.click(screen.getByText(/Permission Overrides/i));
    await waitFor(() => expect(screen.getByText(/Manage Permission Overrides — Sales User/i)).toBeTruthy());

    const modalTitles = Array.from(document.querySelectorAll(".permission-group-title")).map((el) =>
      el.textContent?.trim()
    );
    expect(modalTitles).toEqual([
      "Tasks & Work Management",
      "Companies",
      "Product Master",
      "Proforma Invoices",
      "Sales Process & Orders",
      "Suppliers",
      "Users & Accounts",
      "Social Media",
      "Trash",
    ]);
  });
});
