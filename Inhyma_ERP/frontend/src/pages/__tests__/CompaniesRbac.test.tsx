import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompaniesPage } from "../Companies";
import * as api from "@/lib/api";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

const authState = {
  perms: [] as string[],
};

const stableUser = { id: "u-1", username: "testuser", display_name: "Test User", role: "user" };
const stableProfile = { id: "u-1", username: "testuser", display_name: "Test User", full_name: "Test User" };
const stableHasPermission = (code: string) =>
  authState.perms.includes("*") ||
  authState.perms.includes(code) ||
  (code.endsWith(".view") && authState.perms.includes(code.replace(/\.view$/, ".manage")));

vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    useAuth: () => ({
      hasPermission: stableHasPermission,
      user: stableUser,
      profile: stableProfile,
    }),
    useSrNoJump: () => ({ request: vi.fn(), clear: vi.fn(), applyTo: vi.fn() }),
    isSrNoQuery: () => false,
    usePendingGuard: () => ({ isPending: () => false, guard: (fn: any) => fn }),
    useModalHistorySync: vi.fn(),
  };
});

const SAMPLE_COMPANIES = [
  {
    id: "comp-1",
    company_name: "Apex Packaging Ltd",
    company_grade: "A",
    potential: "yes",
    current_status: "New",
    company_type: "End User",
    is_active: true,
    created_at: "2026-11-19T10:00:00Z",
    contacts: [],
    emails: [],
  },
];

describe("CompaniesPage granular RBAC permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(api, "apiGet").mockImplementation(async (url: string) => {
      if (url.startsWith("/companies/sales-persons")) {
        return { data: [{ id: "u-1", display_name: "Test User", full_name: "Test User", username: "testuser" }] } as any;
      }
      if (url.startsWith("/companies")) {
        return {
          data: SAMPLE_COMPANIES,
          meta: { page: 1, page_size: 50, total_records: 1, total_pages: 1 },
        } as any;
      }
      return { data: [] } as any;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows read-only list when only company.view is granted (hides CTAs, checkboxes, ACTION column, and inline selects)", async () => {
    authState.perms = ["company.view", "supplier.manage"];

    render(
      <MemoryRouter>
        <CompaniesPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Apex Packaging Ltd")).toBeTruthy());

    expect(screen.queryByRole("button", { name: /\+ QUICK ADD/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /\+ ADD NEW/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Imp \/ Exp|Import|Export/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Bulk Actions/i })).toBeNull();
    expect(screen.queryByTitle("Edit Company")).toBeNull();
    expect(screen.queryByText("Action")).toBeNull();
    expect(screen.queryAllByRole("checkbox").length).toBe(0);

    // Inline GRADE / POTENTIAL are read-only text (only the page-size <select> exists)
    const selects = document.querySelectorAll("select.inline-select");
    expect(selects.length).toBe(0);
  });

  it("controls + QUICK ADD and + ADD NEW independently", async () => {
    authState.perms = ["company.view", "company.quick_add"];
    const { rerender } = render(
      <MemoryRouter>
        <CompaniesPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Apex Packaging Ltd")).toBeTruthy());

    expect(screen.getByRole("button", { name: /\+ QUICK ADD/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /\+ ADD NEW/i })).toBeNull();

    // Opening Quick Add without company.update hides "Save & Continue" and shows "Save & Exit"
    fireEvent.click(screen.getByRole("button", { name: /\+ QUICK ADD/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Save & Exit/i })).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Save & Continue/i })).toBeNull();

    authState.perms = ["company.view", "company.create"];
    rerender(
      <MemoryRouter>
        <CompaniesPage />
      </MemoryRouter>
    );
    expect(screen.queryByRole("button", { name: /\+ QUICK ADD/i })).toBeNull();
    expect(screen.getByRole("button", { name: /\+ ADD NEW/i })).toBeTruthy();
  });

  it("controls Import (Sample + Import) and Export independently and hides parent button when neither is granted", async () => {
    authState.perms = ["company.view", "company.import"];
    render(
      <MemoryRouter>
        <CompaniesPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Apex Packaging Ltd")).toBeTruthy());

    const impBtn = screen.getByRole("button", { name: /^Import$/i });
    fireEvent.click(impBtn);
    expect(screen.getByRole("menuitem", { name: "SAMPLE FILE" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "IMPORT" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "EXPORT" })).toBeNull();

    cleanup();
    authState.perms = ["company.view", "company.export"];
    render(
      <MemoryRouter>
        <CompaniesPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Apex Packaging Ltd")).toBeTruthy());
    const expBtn = screen.getByRole("button", { name: /^Export$/i });
    fireEvent.click(expBtn);
    expect(screen.queryByRole("menuitem", { name: "SAMPLE FILE" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "IMPORT" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "EXPORT" })).toBeTruthy();

    cleanup();
    authState.perms = ["company.view", "company.import", "company.export"];
    render(
      <MemoryRouter>
        <CompaniesPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Apex Packaging Ltd")).toBeTruthy());
    const bothBtn = screen.getByRole("button", { name: /Imp \/ Exp/i });
    fireEvent.click(bothBtn);
    expect(screen.getByRole("menuitem", { name: "SAMPLE FILE" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "IMPORT" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "EXPORT" })).toBeTruthy();
  });

  it("controls Grade Edit, Potential Edit, Bulk Action, Edit in Action, and Manage All cleanly without Update leakage", async () => {
    // company.update ALONE shows Action > Edit, NOT Grade/Potential inline selects or Bulk Actions
    authState.perms = ["company.view", "company.update"];
    const { rerender } = render(
      <MemoryRouter>
        <CompaniesPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Apex Packaging Ltd")).toBeTruthy());
    expect(screen.getByText("Action")).toBeTruthy();
    expect(screen.getByTitle("Edit Company")).toBeTruthy();
    expect(document.querySelectorAll("select.inline-select").length).toBe(0);
    expect(screen.queryByRole("button", { name: /Bulk Actions/i })).toBeNull();

    // Grade Edit + Potential Edit + Bulk Action without company.update
    authState.perms = ["company.view", "company.grade_edit", "company.potential_edit", "company.bulk_action"];
    rerender(
      <MemoryRouter>
        <CompaniesPage />
      </MemoryRouter>
    );
    expect(screen.queryByText("Action")).toBeNull();
    expect(screen.queryByTitle("Edit Company")).toBeNull();
    expect(document.querySelectorAll("select.inline-select").length).toBe(2);
    expect(screen.getByRole("button", { name: /Bulk Actions/i })).toBeTruthy();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(2);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole("button", { name: /Bulk Actions/i }));
    expect(screen.getByText(/Bulk Inactive/i)).toBeTruthy();
    expect(screen.queryByText(/Bulk Delete/i)).toBeNull();

    // company.manage grants everything
    authState.perms = ["company.manage"];
    rerender(
      <MemoryRouter>
        <CompaniesPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /\+ QUICK ADD/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /\+ ADD NEW/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Imp \/ Exp/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bulk Actions/i })).toBeTruthy();
    expect(screen.getByTitle("Edit Company")).toBeTruthy();
    expect(document.querySelectorAll("select.inline-select").length).toBe(2);
  });
});
