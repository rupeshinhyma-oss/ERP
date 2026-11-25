import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoriesPage } from "../masters/Categories";
import * as api from "@/lib/api";
import { friendlyPermissionLabel } from "@/lib/permissionLabels";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

const authState = {
  perms: [] as string[],
};

const stableProfile = { id: "u-1", username: "testuser", display_name: "Test User", full_name: "Test User" };
const stableHasPermission = (code?: string | null) =>
  !code ||
  authState.perms.includes("*") ||
  authState.perms.includes(code) ||
  (code.endsWith(".view") && authState.perms.includes(code.replace(/\.view$/, ".manage")));

vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    useAuth: () => ({
      hasPermission: stableHasPermission,
      isSuperAdmin: false,
      profile: stableProfile,
    }),
    useSrNoJump: () => ({ request: vi.fn(), clear: vi.fn(), applyTo: vi.fn() }),
    useModalHistorySync: vi.fn(),
  };
});

const SAMPLE_CATEGORIES = [
  {
    id: "cat-1",
    name: "Chemicals",
    code: "CHEM",
    status: "active",
  },
];

describe("CategoriesPage granular RBAC permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(api, "apiGet").mockImplementation(async (url: string) => {
      if (url.startsWith("/masters/product-categories/cat-1")) {
        return { data: SAMPLE_CATEGORIES[0], success: true } as any;
      }
      if (url.startsWith("/masters/product-categories")) {
        return {
          data: SAMPLE_CATEGORIES,
          meta: { pagination: { page: 1, page_size: 50, total_records: 1, total_pages: 1 } },
          success: true,
        } as any;
      }
      return { data: [], success: true } as any;
    });
    vi.spyOn(api, "apiPost").mockResolvedValue({ data: SAMPLE_CATEGORIES[0], success: true } as any);
  });

  afterEach(() => {
    cleanup();
  });

  it("exposes friendly permission labels for all 9 Product Categories permissions", () => {
    expect(friendlyPermissionLabel("category.view")).toBe("View");
    expect(friendlyPermissionLabel("category.manage")).toBe("Manage All");
    expect(friendlyPermissionLabel("category.create")).toBe("+ Add New (Create)");
    expect(friendlyPermissionLabel("category.import")).toBe("Import (Sample + Import)");
    expect(friendlyPermissionLabel("category.export")).toBe("Export");
    expect(friendlyPermissionLabel("category.bulk_action")).toBe("Bulk Actions");
    expect(friendlyPermissionLabel("category.status_edit")).toBe("Status");
    expect(friendlyPermissionLabel("category.update")).toBe("Action: Edit");
    expect(friendlyPermissionLabel("category.delete")).toBe("Action: Delete");
  });

  it("shows read-only list when only category.view is granted (hides CTAs, checkboxes, ACTION column, and disables Status toggle)", async () => {
    authState.perms = ["category.view", "product.manage"];

    render(
      <MemoryRouter>
        <CategoriesPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Chemicals")).toBeTruthy());

    expect(screen.queryByRole("button", { name: /\+ ADD NEW/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Imp \/ Exp|Import|Export/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Bulk Actions/i })).toBeNull();
    expect(screen.queryByText("ACTION")).toBeNull();
    expect(screen.queryByTitle("Edit")).toBeNull();
    expect(screen.queryByTitle("Delete")).toBeNull();
    expect(screen.queryAllByRole("checkbox").length).toBe(0);

    const statusSwitch = screen.getByRole("switch") as HTMLButtonElement;
    expect(statusSwitch.disabled).toBe(true);
  });

  it("controls + ADD NEW, Import (Sample + Import), and Export independently", async () => {
    authState.perms = ["category.view", "category.create"];
    render(
      <MemoryRouter>
        <CategoriesPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Chemicals")).toBeTruthy());
    expect(screen.getByRole("button", { name: /\+ ADD NEW/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Imp \/ Exp|Import|Export/i })).toBeNull();

    cleanup();
    authState.perms = ["category.view", "category.import"];
    render(
      <MemoryRouter>
        <CategoriesPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Chemicals")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /\+ ADD NEW/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Import$/i }));
    expect(screen.getByRole("menuitem", { name: "SAMPLE FILE" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "IMPORT" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "EXPORT" })).toBeNull();

    cleanup();
    authState.perms = ["category.view", "category.export"];
    render(
      <MemoryRouter>
        <CategoriesPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Chemicals")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Export$/i }));
    expect(screen.queryByRole("menuitem", { name: "SAMPLE FILE" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "IMPORT" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "EXPORT" })).toBeTruthy();

    cleanup();
    authState.perms = ["category.view", "category.import", "category.export"];
    render(
      <MemoryRouter>
        <CategoriesPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Chemicals")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Imp \/ Exp/i }));
    expect(screen.getByRole("menuitem", { name: "SAMPLE FILE" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "IMPORT" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "EXPORT" })).toBeTruthy();
  });

  it("controls Status, Edit, Delete in Actions, Bulk Actions, and Manage All independently", async () => {
    // 1. category.status_edit enables Status switch without Action Edit/Delete or Bulk Actions
    authState.perms = ["category.view", "category.status_edit"];
    const { rerender } = render(
      <MemoryRouter>
        <CategoriesPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Chemicals")).toBeTruthy());
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("ACTION")).toBeNull();
    expect(screen.queryByTitle("Edit")).toBeNull();
    expect(screen.queryByTitle("Delete")).toBeNull();
    expect(screen.queryByRole("button", { name: /Bulk Actions/i })).toBeNull();

    // 2. category.update shows Edit only (Status switch remains disabled without category.status_edit)
    authState.perms = ["category.view", "category.update"];
    rerender(
      <MemoryRouter>
        <CategoriesPage />
      </MemoryRouter>
    );
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("ACTION")).toBeTruthy();
    expect(screen.getByTitle("Edit")).toBeTruthy();
    expect(screen.queryByTitle("Delete")).toBeNull();

    // 3. category.delete shows Delete only
    authState.perms = ["category.view", "category.delete"];
    rerender(
      <MemoryRouter>
        <CategoriesPage />
      </MemoryRouter>
    );
    expect(screen.getByText("ACTION")).toBeTruthy();
    expect(screen.queryByTitle("Edit")).toBeNull();
    expect(screen.getByTitle("Delete")).toBeTruthy();

    // 4. category.bulk_action shows checkboxes + Bulk Actions (Bulk Activate / Bulk Inactive; Bulk Delete hidden without category.delete)
    authState.perms = ["category.view", "category.bulk_action"];
    rerender(
      <MemoryRouter>
        <CategoriesPage />
      </MemoryRouter>
    );
    expect(screen.queryByText("ACTION")).toBeNull();
    expect(screen.getByRole("button", { name: /Bulk Actions/i })).toBeTruthy();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(2);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole("button", { name: /Bulk Actions/i }));
    expect(screen.getByText(/Bulk Activate/i)).toBeTruthy();
    expect(screen.getByText(/Bulk Inactive/i)).toBeTruthy();
    expect(screen.queryByText(/Bulk Delete/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Bulk Actions/i }));

    // 5. category.manage grants everything
    authState.perms = ["category.manage"];
    rerender(
      <MemoryRouter>
        <CategoriesPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /\+ ADD NEW/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Imp \/ Exp/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bulk Actions/i })).toBeTruthy();
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTitle("Edit")).toBeTruthy();
    expect(screen.getByTitle("Delete")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Bulk Actions/i }));
    expect(screen.getByText(/Bulk Delete/i)).toBeTruthy();
  });
});
