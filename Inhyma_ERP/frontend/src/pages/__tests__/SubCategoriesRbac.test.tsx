import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubCategoriesPage } from "../masters/SubCategories";
import * as api from "@/lib/api";
import { friendlyPermissionLabel } from "@/lib/permissionLabels";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

vi.mock("@/lib/lookups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/lookups")>();
  return {
    ...actual,
    useLookup: () => ({
      items: [{ id: "cat-1", name: "Machines", status: "active" }],
      loaded: true,
    }),
  };
});

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

const SAMPLE_SUBCATEGORIES = [
  {
    id: "sub-1",
    category_id: "cat-1",
    name: "Auto Machines",
    code: "AUTO",
    status: "active",
  },
];

describe("SubCategoriesPage granular RBAC permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(api, "apiGet").mockImplementation(async (url: string) => {
      if (url.startsWith("/masters/product-sub-categories/sub-1")) {
        return { data: SAMPLE_SUBCATEGORIES[0], success: true } as any;
      }
      if (url.startsWith("/masters/product-sub-categories")) {
        return {
          data: SAMPLE_SUBCATEGORIES,
          meta: { pagination: { page: 1, page_size: 50, total_records: 1, total_pages: 1 } },
          success: true,
        } as any;
      }
      return { data: [], success: true } as any;
    });
    vi.spyOn(api, "apiPost").mockResolvedValue({ data: SAMPLE_SUBCATEGORIES[0], success: true } as any);
  });

  afterEach(() => {
    cleanup();
  });

  it("exposes friendly permission labels for all 9 Product Sub-Categories permissions", () => {
    expect(friendlyPermissionLabel("subcategory.view")).toBe("View");
    expect(friendlyPermissionLabel("subcategory.manage")).toBe("Manage All");
    expect(friendlyPermissionLabel("subcategory.create")).toBe("+ Add New (Create)");
    expect(friendlyPermissionLabel("subcategory.import")).toBe("Import (Sample + Import)");
    expect(friendlyPermissionLabel("subcategory.export")).toBe("Export");
    expect(friendlyPermissionLabel("subcategory.bulk_action")).toBe("Bulk Actions");
    expect(friendlyPermissionLabel("subcategory.status_edit")).toBe("Status");
    expect(friendlyPermissionLabel("subcategory.update")).toBe("Action: Edit");
    expect(friendlyPermissionLabel("subcategory.delete")).toBe("Action: Delete");
  });

  it("shows read-only list when only subcategory.view is granted (hides CTAs, checkboxes, ACTION column, and disables Status toggle)", async () => {
    authState.perms = ["subcategory.view", "category.manage"];

    render(
      <MemoryRouter>
        <SubCategoriesPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Auto Machines")).toBeTruthy());

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
    authState.perms = ["subcategory.view", "subcategory.create"];
    render(
      <MemoryRouter>
        <SubCategoriesPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Auto Machines")).toBeTruthy());
    expect(screen.getByRole("button", { name: /\+ ADD NEW/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Imp \/ Exp|Import|Export/i })).toBeNull();

    cleanup();
    authState.perms = ["subcategory.view", "subcategory.import"];
    render(
      <MemoryRouter>
        <SubCategoriesPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Auto Machines")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /\+ ADD NEW/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Import$/i }));
    expect(screen.getByRole("menuitem", { name: "SAMPLE FILE" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "IMPORT" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "EXPORT" })).toBeNull();

    cleanup();
    authState.perms = ["subcategory.view", "subcategory.export"];
    render(
      <MemoryRouter>
        <SubCategoriesPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Auto Machines")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Export$/i }));
    expect(screen.queryByRole("menuitem", { name: "SAMPLE FILE" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "IMPORT" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "EXPORT" })).toBeTruthy();

    cleanup();
    authState.perms = ["subcategory.view", "subcategory.import", "subcategory.export"];
    render(
      <MemoryRouter>
        <SubCategoriesPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Auto Machines")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Imp \/ Exp/i }));
    expect(screen.getByRole("menuitem", { name: "SAMPLE FILE" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "IMPORT" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "EXPORT" })).toBeTruthy();
  });

  it("controls Status, Edit, Delete in Actions, Bulk Actions, and Manage All independently", async () => {
    authState.perms = ["subcategory.view", "subcategory.status_edit"];
    const { rerender } = render(
      <MemoryRouter>
        <SubCategoriesPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Auto Machines")).toBeTruthy());
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("ACTION")).toBeNull();
    expect(screen.queryByTitle("Edit")).toBeNull();
    expect(screen.queryByTitle("Delete")).toBeNull();
    expect(screen.queryByRole("button", { name: /Bulk Actions/i })).toBeNull();

    authState.perms = ["subcategory.view", "subcategory.update"];
    rerender(
      <MemoryRouter>
        <SubCategoriesPage />
      </MemoryRouter>
    );
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("ACTION")).toBeTruthy();
    expect(screen.getByTitle("Edit")).toBeTruthy();
    expect(screen.queryByTitle("Delete")).toBeNull();

    authState.perms = ["subcategory.view", "subcategory.delete"];
    rerender(
      <MemoryRouter>
        <SubCategoriesPage />
      </MemoryRouter>
    );
    expect(screen.getByText("ACTION")).toBeTruthy();
    expect(screen.queryByTitle("Edit")).toBeNull();
    expect(screen.getByTitle("Delete")).toBeTruthy();

    authState.perms = ["subcategory.view", "subcategory.bulk_action"];
    rerender(
      <MemoryRouter>
        <SubCategoriesPage />
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

    authState.perms = ["subcategory.manage"];
    rerender(
      <MemoryRouter>
        <SubCategoriesPage />
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
