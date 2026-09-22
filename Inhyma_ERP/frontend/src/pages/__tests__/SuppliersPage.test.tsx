import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SuppliersPage, INITIAL_SUPPLIERS, SUPPLIER_TABLE_COLUMNS } from "../Suppliers";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

// Mock API
vi.mock("@/lib/api", () => ({
  API_ORIGIN: "http://localhost:8000",
  apiGet: vi.fn().mockResolvedValue({ data: [] }),
  apiPost: vi.fn().mockResolvedValue({ data: { success: true } }),
  apiPatch: vi.fn().mockResolvedValue({ data: { success: true } }),
  apiDelete: vi.fn().mockResolvedValue({ data: { success: true } }),
  apiPostMultipart: vi.fn().mockResolvedValue({ data: { success: true } }),
  downloadExport: vi.fn(),
  toQueryString: vi.fn(() => ""),
}));

// Mock auth hook
vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    useAuth: () => ({
      hasPermission: () => true,
      user: { id: "1", username: "admin", role: "admin" },
    }),
    useSrNoJump: () => ({ request: vi.fn(), clear: vi.fn(), applyTo: vi.fn() }),
    isSrNoQuery: () => false,
    usePendingGuard: () => ({ isPending: () => false, guard: (fn: any) => fn }),
    useModalHistorySync: vi.fn(),
  };
});

describe("SuppliersPage (/suppliers & /supplier/list)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders page title Suppliers, Active/Inactive tabs, and action buttons", () => {
    render(
      <BrowserRouter>
        <SuppliersPage />
      </BrowserRouter>
    );

    expect(screen.getByRole("heading", { name: /^Suppliers$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Active$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Inactive$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /\+ ADD NEW/i })).toBeTruthy();
  });

  it("renders the exact 10 table headers matching the production screenshot", () => {
    render(
      <BrowserRouter>
        <SuppliersPage />
      </BrowserRouter>
    );

    expect(SUPPLIER_TABLE_COLUMNS).toHaveLength(10);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.length).toBe(10);

    // Verify all 10 headers match the production screenshot
    expect(within(headers[0]).getByRole("checkbox")).toBeTruthy();
    expect(within(headers[1]).getByText("Company Name")).toBeTruthy();
    expect(within(headers[2]).getByText("Product Category")).toBeTruthy();
    expect(within(headers[3]).getByText("Product Sub Category")).toBeTruthy();
    expect(within(headers[4]).getByText("City / State")).toBeTruthy();
    expect(within(headers[5]).getByText("Grade")).toBeTruthy();
    expect(within(headers[6]).getByText("Type")).toBeTruthy();
    expect(within(headers[7]).getByText("Current Status")).toBeTruthy();
    expect(within(headers[8]).getByText("Potential")).toBeTruthy();
    expect(within(headers[9]).getByText("Action")).toBeTruthy();
  });

  it("renders authentic supplier records with City / State, Type, and Edit action button", async () => {
    render(
      <BrowserRouter>
        <SuppliersPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("WELCOME ELECTRICALS SOLUTION")).toBeTruthy();
    });

    // Check company names from screenshot
    expect(screen.getByText("Shree Kalika Industries")).toBeTruthy();
    expect(screen.getByText("Universal Packaging Solutions")).toBeTruthy();
    expect(screen.getByText("Darsh Impex India LLP Mumbai")).toBeTruthy();
    expect(screen.getByText("MULTI FILL IMPEX")).toBeTruthy();

    // Check two-line City / State rendering
    expect(screen.getAllByText("Mumbai").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Maharashtra").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ahmedabad").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Gujarat").length).toBeGreaterThan(0);

    // Check Type values
    expect(screen.getAllByText("Trader").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Importer").length).toBeGreaterThan(0);

    // Check Edit buttons in Action column
    const editButtons = screen.getAllByTitle("Edit Supplier");
    expect(editButtons.length).toBe(10);
  });

  it("filters suppliers when typing in the search input", async () => {
    render(
      <BrowserRouter>
        <SuppliersPage />
      </BrowserRouter>
    );

    const searchInput = screen.getByPlaceholderText("Search...");
    expect(searchInput).toBeTruthy();

    fireEvent.change(searchInput, { target: { value: "Kalika" } });

    await waitFor(() => {
      expect(screen.getByText("Shree Kalika Industries")).toBeTruthy();
      expect(screen.queryByText("WELCOME ELECTRICALS SOLUTION")).toBeNull();
    });
  });

  it("handles sorting when clicking sortable header columns", async () => {
    render(
      <BrowserRouter>
        <SuppliersPage />
      </BrowserRouter>
    );

    const companyNameHeader = screen.getByText("Company Name");
    fireEvent.click(companyNameHeader);

    await waitFor(() => {
      // Ascending sort by Company Name: Darsh Impex should appear before WELCOME
      const links = screen.getAllByRole("link");
      const companyLinks = links.filter((l) =>
        INITIAL_SUPPLIERS.some((s) => s.company_name === l.textContent)
      );
      expect(companyLinks[0].textContent).toContain("Darsh Impex");
    });
  });
});
