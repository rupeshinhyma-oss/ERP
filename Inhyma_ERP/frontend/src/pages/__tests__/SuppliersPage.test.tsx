import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SuppliersPage, SUPPLIER_TABLE_COLUMNS } from "../Suppliers";
import { apiGet, apiPost } from "@/lib/api";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

// Real helpers stay (toQueryString); only the network functions are faked
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  apiPostMultipart: vi.fn(),
  downloadExport: vi.fn(),
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

const supplier = (id: string, name: string, city: string, state: string, type: string) => ({
  id, company_name: name, supplier_type: type, supplier_grade: "A", current_status: "existing", potential: "yes",
  city_name: city, state_name: state, is_active: true, category_ids: [], sub_category_ids: [], product_ids: [],
  tax_id_number: `GST-${id}`,
});
const SUPPLIERS = [
  supplier("1", "Zenith Packaging Co", "Pune", "Maharashtra", "trader"),
  supplier("2", "Alpha Impex India", "Ahmedabad", "Gujarat", "importer"),
  supplier("3", "Midway Machines", "Mumbai", "Maharashtra", "manufacturer"),
];
const pagination = (n: number) => ({ current_page: 1, page_size: 10, total_records: n, total_pages: 1, has_next: false, has_previous: false });

const listUrl = () => (apiGet as any).mock.calls.map((c: any[]) => String(c[0])).filter((u: string) => u.startsWith("/suppliers?"));

beforeEach(() => {
  vi.clearAllMocks();
  // the page scrolls the first invalid field into view; jsdom has no layout, so stub it
  Element.prototype.scrollIntoView = vi.fn();
  (apiGet as any).mockImplementation((url: string) => {
    if (url.startsWith("/suppliers")) return Promise.resolve({ data: SUPPLIERS, meta: { pagination: pagination(SUPPLIERS.length) } });
    return Promise.resolve({ data: [] });
  });
  (apiPost as any).mockResolvedValue({ data: { id: "new" } });
});

afterEach(() => cleanup());

const renderPage = () =>
  render(
    <BrowserRouter>
      <SuppliersPage />
    </BrowserRouter>
  );

describe("SuppliersPage (/suppliers & /supplier/list)", () => {
  it("renders page title Suppliers, Active/Inactive tabs, and action buttons", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /^Suppliers$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Active$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Inactive$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /\+ ADD NEW/i })).toBeTruthy();
  });

  it("renders the 10 table headers", () => {
    renderPage();
    expect(SUPPLIER_TABLE_COLUMNS).toHaveLength(10);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.length).toBe(10);
    expect(within(headers[0]).getByRole("checkbox")).toBeTruthy();
    for (const [i, label] of [[1, "Company Name"], [2, "Product Category"], [3, "Product Sub Category"], [4, "City / State"], [5, "Grade"],
      [6, "Type"], [7, "Current Status"], [8, "Potential"], [9, "Action"]] as [number, string][]) {
      expect(within(headers[i]).getByText(label)).toBeTruthy();
    }
  });

  it("renders the suppliers the API returned, with City / State, Type and an Edit button each", async () => {
    renderPage();
    await screen.findByText("Zenith Packaging Co");
    expect(screen.getByText("Alpha Impex India")).toBeTruthy();
    expect(screen.getByText("Midway Machines")).toBeTruthy();
    expect(screen.getAllByText("Maharashtra").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Gujarat").length).toBeGreaterThan(0);
    for (const type of [/^trader$/i, /^importer$/i, /^manufacturer$/i]) expect(screen.getAllByText(type).length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("Edit Supplier").length).toBe(3);
  });

  it("shows no suppliers (and none are invented) when the database has none", async () => {
    (apiGet as any).mockImplementation((url: string) =>
      Promise.resolve(url.startsWith("/suppliers") ? { data: [], meta: { pagination: pagination(0) } } : { data: [] })
    );
    renderPage();
    await waitFor(() => expect(listUrl().length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
    expect(screen.queryAllByTitle("Edit Supplier").length).toBe(0);
    // names that used to be built into the page as sample suppliers
    for (const old of ["WELCOME ELECTRICALS SOLUTION", "Shree Kalika Industries", "Darsh Impex India LLP Mumbai", "MULTI FILL IMPEX"]) {
      expect(screen.queryByText(old)).toBeNull();
    }
  });

  it("shows the server's error, not sample suppliers, when the list cannot be loaded", async () => {
    (apiGet as any).mockImplementation((url: string) =>
      url.startsWith("/suppliers") ? Promise.reject(new Error("Database is down")) : Promise.resolve({ data: [] })
    );
    renderPage();
    expect(await screen.findByText(/Database is down/)).toBeTruthy();
    expect(screen.queryAllByTitle("Edit Supplier").length).toBe(0);
    expect(screen.queryByText("WELCOME ELECTRICALS SOLUTION")).toBeNull();
  });

  it("searches on the server when typing in the search input", async () => {
    renderPage();
    await screen.findByText("Zenith Packaging Co");
    fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "Kalika" } });
    await waitFor(() => expect(listUrl().some((u: string) => u.includes("search=Kalika"))).toBe(true));
  });

  it("sorts by Company Name when its header is clicked", async () => {
    renderPage();
    await screen.findByText("Zenith Packaging Co");
    fireEvent.click(screen.getByText("Company Name"));
    await waitFor(() => {
      const names = screen.getAllByRole("link").map((l) => l.textContent).filter((t) => SUPPLIERS.some((s) => s.company_name === t));
      expect(names[0]).toBe("Alpha Impex India");
    });
  });
});

describe("SuppliersPage: GST number is mandatory (Add Supplier spec)", () => {
  it("shows a required GST Number field on the Add Supplier form", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ ADD NEW/i }));
    const gst = await screen.findByLabelText(/GST Number/i);
    expect(gst).toBeTruthy();
    expect(screen.queryByLabelText(/^Tax ID Number$/i)).toBeNull(); // the old, optional field is gone
  });

  it("refuses to save without a GST number and does not call the API", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ ADD NEW/i }));
    await screen.findByLabelText(/GST Number/i);
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(await screen.findByText("GST number is required.")).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("types the GST number in upper case", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ ADD NEW/i }));
    const gst = (await screen.findByLabelText(/GST Number/i)) as HTMLInputElement;
    fireEvent.change(gst, { target: { value: "27abcde1234f1z5" } });
    expect(gst.value).toBe("27ABCDE1234F1Z5");
  });
});

describe("SuppliersPage: Calling Number is mandatory (Add Supplier spec)", () => {
  it("marks Calling Number as required on the Add Supplier form", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ ADD NEW/i }));
    expect(await screen.findByText("Calling Number")).toBeTruthy();
  });

  it("refuses to save without a calling number and does not call the API", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /\+ ADD NEW/i }));
    await screen.findByLabelText(/GST Number/i);
    fireEvent.change(screen.getByLabelText(/GST Number/i), { target: { value: "27ABCDE1234F1Z5" } });
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(await screen.findByText("Calling number is required.")).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
  });
});
