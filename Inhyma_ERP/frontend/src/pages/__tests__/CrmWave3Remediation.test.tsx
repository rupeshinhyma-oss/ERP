import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { CrmLeadsPage, CrmLeadListItem, CrmSalesQuotationRead } from "../crm/CrmLeadsPage";
import { SalespersonDistributionPage, SalespersonDistributionItem } from "../crm/SalespersonDistributionPage";
import { App } from "@/App";
import * as apiModule from "@/lib/api";
import { Auth, auth } from "@/lib/auth";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

const mockToast = vi.fn();
vi.mock("@/lib/toast", () => ({
  useToast: () => mockToast,
}));

const MOCK_STATES = [
  { id: "state-1", name: "Maharashtra", code: "MH" },
  { id: "state-2", name: "Gujarat", code: "GJ" },
  { id: "state-3", name: "Karnataka", code: "KA" },
];

const MOCK_SALESPEOPLE: SalespersonDistributionItem[] = [
  {
    user_id: "sp-1",
    username: "sp1",
    display_name: "Rep One",
    employee_code: "EMP-101",
    email: "sp1@inhyma.test",
    is_active_user: true,
    user_status: "ACTIVE",
    department: "Sales",
    is_eligible: true,
    priority: 1,
    max_lead_capacity: 20,
    is_active_config: true,
    notes: "West zone",
    territories: [{ id: "t-1", state_id: "state-1", state_name: "Maharashtra", state_code: "MH" }],
    active_lead_count: 2,
    total_assigned_lead_count: 8,
    last_assigned_at: "2026-10-10T12:00:00Z",
    updated_at: "2026-10-10T12:00:00Z",
  },
  {
    user_id: "sp-2",
    username: "sp2",
    display_name: "Wildcard Rep",
    employee_code: "EMP-102",
    email: "sp2@inhyma.test",
    is_active_user: true,
    user_status: "ACTIVE",
    department: "Sales",
    is_eligible: true,
    priority: 2,
    max_lead_capacity: null,
    is_active_config: true,
    notes: null,
    territories: [],
    active_lead_count: 1,
    total_assigned_lead_count: 4,
    last_assigned_at: "2026-10-11T12:00:00Z",
    updated_at: "2026-10-11T12:00:00Z",
  },
];

const OWN_LEAD: CrmLeadListItem = {
  id: "lead-own",
  lead_code: "LD-W3-001",
  name: "Own Assigned Prospect",
  original_phone: "+919876500001",
  email: "own@prospect.test",
  company_name: "Own Co",
  campaign: "Inbound",
  source_type: "website",
  pipeline_id: "pipe-1",
  pipeline_name: "Direct Sales",
  stage_id: "stage-1",
  stage_name: "New",
  assigned_to: "sp-user-1",
  created_by: "mgr-user-1",
  assigned_salesperson_name: "Rep One",
  status: "new",
  priority: "high",
  assignment_status: "assigned",
  created_at: "2026-10-15T10:00:00Z",
};

const PEER_LEAD: CrmLeadListItem = {
  ...OWN_LEAD,
  id: "lead-peer",
  lead_code: "LD-W3-002",
  name: "Peer Assigned Prospect",
  assigned_to: "sp-user-2",
  created_by: "sp-user-1", // Reassigned away from sp-user-1
  assigned_salesperson_name: "Rep Two",
};

const MOCK_QUOTE: CrmSalesQuotationRead = {
  id: "q-1",
  quotation_number: "QT-202611-0001",
  lead_id: "lead-own",
  company_id: null,
  version: 1,
  status: "draft",
  quotation_date: "2026-11-20T10:00:00Z",
  valid_until: null,
  currency: "INR",
  customer_name_snapshot: "Own Assigned Prospect",
  customer_phone_snapshot: "+919876500001",
  customer_email_snapshot: "own@prospect.test",
  company_name_snapshot: "Own Co",
  subtotal: 10000,
  discount_total: 0,
  tax_total: 1800,
  total_amount: 11800,
  notes: null,
  terms_and_conditions: null,
  created_at: "2026-11-20T10:00:00Z",
  created_by_name: "Rep One",
  items: [],
};

describe("Lead Management Phase 2 / Wave 3 Remediation Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // LM-DEF-008 + LM-DEF-018: Salesperson quotation actions, CRM product lookup & zero unauthorized background 403s
  // -------------------------------------------------------------------------
  it("LM-DEF-008 & LM-DEF-018: Salesperson (crm.leads.view only) sees quotation actions on own lead, searches /api/v1/crm/products/lookup, and triggers zero unauthorized /masters/uom or /distribution calls", async () => {
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(false);
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "sp-user-1",
      username: "sp1",
      full_name: "Rep One",
      roles: ["Salesperson"],
      permissions: ["crm.leads.view", "crm.pipelines.view"],
    } as any);
    vi.spyOn(Auth, "hasPermission").mockImplementation((perm?: string | null) =>
      Boolean(perm && ["crm.leads.view", "crm.pipelines.view"].includes(perm))
    );

    const requestedUrls: string[] = [];
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string): any => {
      requestedUrls.push(url);
      if (url.includes("/crm/products/lookup")) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "prod-1",
                product_code: "CRM-001",
                product_name: "Pad Printer X1",
                uom: "Nos",
                standard_price: 50000,
                gst_percent: 18,
                is_sellable: true,
                status: "active",
              },
            ],
            total: 1,
          },
        });
      }
      if (url.includes("/crm/pipelines")) {
        return Promise.resolve({
          data: [{ id: "pipe-1", name: "Direct Sales", stages: [{ id: "stage-1", name: "New", stage_order: 1, is_active: true }] }],
        });
      }
      if (url.match(/\/crm\/leads\/lead-own\/quotations/)) {
        return Promise.resolve({ data: { items: [MOCK_QUOTE], total: 1 } });
      }
      if (url.match(/\/crm\/leads\/lead-own$/)) {
        return Promise.resolve({ data: OWN_LEAD });
      }
      if (url.includes("/crm/leads")) {
        return Promise.resolve({ data: { items: [OWN_LEAD], total: 1, page: 1, page_size: 25, total_pages: 1 } });
      }
      return Promise.resolve({ data: { items: [], total: 0 } });
    });

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => expect(screen.getAllByText("Own Assigned Prospect").length).toBeGreaterThanOrEqual(1));

    // LM-DEF-018: zero unauthorized background requests
    expect(requestedUrls.some((u) => u.includes("/masters/uom"))).toBe(false);
    expect(requestedUrls.some((u) => u.includes("/crm/distribution/salespeople"))).toBe(false);

    // Open drawer -> Quotations tab
    fireEvent.click(screen.getAllByRole("button", { name: /^History & Details$/i })[0]);
    await waitFor(() => expect(screen.getByText(/Quotations/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/Quotations/i));

    // LM-DEF-008: Salesperson sees + New Quotation, Edit Draft, Mark Sent
    await waitFor(() => {
      expect(screen.getByTestId("crm-new-quotation-btn")).toBeTruthy();
      expect(screen.getByRole("button", { name: /Edit Draft/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Mark Sent/i })).toBeTruthy();
    });

    // Open Create Quotation modal and search product -> MUST hit /api/v1/crm/products/lookup, NOT /masters/products
    fireEvent.click(screen.getByTestId("crm-new-quotation-btn"));
    await screen.findByRole("heading", { name: "Create Quotation" });

    const searchInput = screen.getByPlaceholderText(/Search Product Master by product name or code/i);
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: "Pad Printer" } });

    await waitFor(() => {
      expect(screen.getByText("Pad Printer X1")).toBeTruthy();
    });
    expect(requestedUrls.some((u) => u.includes("/api/v1/crm/products/lookup"))).toBe(true);
    expect(requestedUrls.some((u) => u.includes("/masters/products"))).toBe(false);
  });

  it("LM-DEF-008: Salesperson does NOT see quotation mutation buttons on peer or reassigned lead", async () => {
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(false);
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "sp-user-1",
      username: "sp1",
      full_name: "Rep One",
      roles: ["Salesperson"],
      permissions: ["crm.leads.view"],
    } as any);
    vi.spyOn(Auth, "hasPermission").mockImplementation((perm?: string | null) => perm === "crm.leads.view");

    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string): any => {
      if (url.includes("/crm/pipelines")) {
        return Promise.resolve({ data: [{ id: "pipe-1", name: "Direct Sales" }] });
      }
      if (url.match(/\/crm\/leads\/lead-peer\/quotations/)) {
        return Promise.resolve({ data: { items: [], total: 0 } });
      }
      if (url.match(/\/crm\/leads\/lead-peer$/)) {
        return Promise.resolve({ data: PEER_LEAD });
      }
      if (url.includes("/crm/leads")) {
        return Promise.resolve({ data: { items: [PEER_LEAD], total: 1, page: 1, page_size: 25, total_pages: 1 } });
      }
      return Promise.resolve({ data: { items: [], total: 0 } });
    });

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => expect(screen.getAllByText("Peer Assigned Prospect").length).toBeGreaterThanOrEqual(1));
    fireEvent.click(screen.getAllByRole("button", { name: /^History & Details$/i })[0]);
    await waitFor(() => expect(screen.getByText(/Quotations/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/Quotations/i));

    await waitFor(() => expect(screen.getByText(/No Quotations Created Yet/i)).toBeTruthy());
    expect(screen.queryByTestId("crm-new-quotation-btn")).toBeNull();
    expect(screen.queryByTestId("crm-create-first-quotation-btn")).toBeNull();
  });

  it("LM-DEF-018: Authorized user with uom.view and crm.distribution.view DOES fetch both endpoints cleanly", async () => {
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(false);
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "mgr-1",
      username: "mgr1",
      full_name: "Manager One",
      roles: ["Sales Manager"],
      permissions: ["crm.leads.view", "crm.leads.manage", "crm.distribution.view", "uom.view"],
    } as any);
    vi.spyOn(Auth, "hasPermission").mockImplementation((perm?: string | null) =>
      Boolean(perm && ["crm.leads.view", "crm.leads.manage", "crm.distribution.view", "uom.view"].includes(perm))
    );

    const requestedUrls: string[] = [];
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string): any => {
      requestedUrls.push(url);
      if (url.includes("/masters/uom")) return Promise.resolve({ data: [{ id: "u1", code: "NOS", name: "Nos" }] });
      if (url.includes("/crm/distribution/salespeople")) return Promise.resolve({ data: [] });
      if (url.includes("/crm/leads")) return Promise.resolve({ data: { items: [], total: 0, page: 1, page_size: 25, total_pages: 0 } });
      return Promise.resolve({ data: [] });
    });

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(requestedUrls.some((u) => u.includes("/masters/uom"))).toBe(true);
      expect(requestedUrls.some((u) => u.includes("/crm/distribution/salespeople"))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // LM-DEF-014: Lead Detail Drawer Follow-Ups Tab fetches status=all
  // -------------------------------------------------------------------------
  it("LM-DEF-014: Lead Detail Drawer Follow-Ups tab requests status=all and displays pending, completed, and cancelled follow-ups", async () => {
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(true);
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
    vi.spyOn(Auth, "getProfile").mockReturnValue({ id: "admin-1", roles: ["admin"], permissions: ["*"] } as any);

    const followUpUrls: string[] = [];
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string): any => {
      if (url.includes("/crm/pipelines")) {
        return Promise.resolve({ data: [{ id: "pipe-1", name: "Direct Sales" }] });
      }
      if (url.includes("/crm/follow-ups")) {
        followUpUrls.push(url);
        if (url.includes("status=all")) {
          return Promise.resolve({
            data: {
              items: [
                { id: "f1", lead_id: "lead-own", follow_up_type: "call", due_at: "2026-11-25T10:00:00Z", status: "pending", priority: "high", notes: "Pending Call Task", created_at: "2026-11-20T10:00:00Z", updated_at: "2026-11-20T10:00:00Z" },
                { id: "f2", lead_id: "lead-own", follow_up_type: "email", due_at: "2026-11-19T10:00:00Z", status: "completed", priority: "medium", notes: "Completed Email Task", created_at: "2026-11-18T10:00:00Z", updated_at: "2026-11-19T10:00:00Z" },
                { id: "f3", lead_id: "lead-own", follow_up_type: "meeting", due_at: "2026-11-18T10:00:00Z", status: "cancelled", priority: "low", notes: "Cancelled Meeting Task", created_at: "2026-11-17T10:00:00Z", updated_at: "2026-11-18T10:00:00Z" },
              ],
              total: 3,
              page: 1,
              page_size: 50,
              total_pages: 1,
            },
          });
        }
        return Promise.resolve({
          data: {
            items: [
              { id: "f1", lead_id: "lead-own", follow_up_type: "call", due_at: "2026-11-25T10:00:00Z", status: "pending", priority: "high", notes: "Pending Call Task", created_at: "2026-11-20T10:00:00Z", updated_at: "2026-11-20T10:00:00Z" },
            ],
            total: 1,
            page: 1,
            page_size: 50,
            total_pages: 1,
          },
        });
      }
      if (url.match(/\/crm\/leads\/lead-own$/)) return Promise.resolve({ data: OWN_LEAD });
      if (url.includes("/crm/leads")) return Promise.resolve({ data: { items: [OWN_LEAD], total: 1, page: 1, page_size: 25, total_pages: 1 } });
      return Promise.resolve({ data: { items: [], total: 0 } });
    });

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => expect(screen.getAllByText("Own Assigned Prospect").length).toBeGreaterThanOrEqual(1));
    fireEvent.click(screen.getAllByRole("button", { name: /^History & Details$/i })[0]);
    await waitFor(() => expect(screen.getByText(/^Follow-ups/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/^Follow-ups/i));

    await waitFor(() => {
      expect(followUpUrls.some((u) => u.includes("lead_id=lead-own") && u.includes("status=all"))).toBe(true);
      expect(screen.getAllByText("Pending Call Task").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Completed Email Task")).toBeTruthy();
      expect(screen.getByText("Cancelled Meeting Task")).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // LM-DEF-009 + LM-DEF-032 + LM-DEF-031(c): Distribution states lookup, All Territories wildcard [], stale banner removed
  // -------------------------------------------------------------------------
  it("LM-DEF-009, LM-DEF-032 & LM-DEF-031(c): Distribution page fetches /masters/states/lookup, saves territory_state_ids: [] for All Territories, and removes stale Phase-2 copy", async () => {
    vi.spyOn(auth, "hasPermission").mockImplementation((perm?: string | null) =>
      Boolean(perm && ["crm.distribution.view", "crm.distribution.manage"].includes(perm))
    );

    const requestedUrls: string[] = [];
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string): any => {
      requestedUrls.push(url);
      if (url.includes("/masters/states/lookup")) {
        return Promise.resolve({ data: MOCK_STATES });
      }
      if (url.includes("/crm/distribution/salespeople")) {
        return Promise.resolve({ data: MOCK_SALESPEOPLE });
      }
      return Promise.resolve({ data: [] });
    });

    const putSpy = vi.spyOn(apiModule, "apiPut").mockImplementation((_url: string, payload: any) =>
      Promise.resolve({
        data: {
          ...MOCK_SALESPEOPLE[0],
          ...payload,
          territories: (payload.territory_state_ids || []).map((id: string) => ({
            id: `terr-${id}`,
            state_id: id,
            state_name: MOCK_STATES.find((s) => s.id === id)?.name || id,
          })),
        },
      })
    );

    render(
      <BrowserRouter>
        <SalespersonDistributionPage />
      </BrowserRouter>
    );

    await waitFor(() => expect(screen.getByText("Rep One")).toBeTruthy());

    // LM-DEF-009: MUST use /masters/states/lookup and NEVER /masters/states?limit=...
    expect(requestedUrls.some((u) => u === "/masters/states/lookup")).toBe(true);
    expect(requestedUrls.some((u) => u.startsWith("/masters/states?"))).toBe(false);

    // LM-DEF-031(c): Stale Phase-2 banner text removed
    expect(screen.queryByText(/Leads are not automatically distributed or reassigned in this phase/i)).toBeNull();

    // LM-DEF-032: Wildcard Rep (territories: []) displays "All Territories" badge
    expect(screen.getByText("All Territories", { selector: "span" })).toBeTruthy();

    // Switch Rep One from Specific (Maharashtra) -> All Territories and Save -> MUST send territory_state_ids: []
    const configureButtons = screen.getAllByRole("button", { name: /configure/i });
    fireEvent.click(configureButtons[0]);

    // Stale drawer copy also removed
    expect(screen.queryByText(/Leads are not assigned immediately or automatically in this phase/i)).toBeNull();

    const allRadio = screen.getByRole("radio", { name: /all territories/i });
    fireEvent.click(allRadio);

    fireEvent.click(screen.getByRole("button", { name: /save configuration/i }));

    await waitFor(() => {
      expect(putSpy).toHaveBeenCalledWith(
        "/crm/distribution/salespeople/sp-1",
        expect.objectContaining({
          territory_state_ids: [],
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // LM-DEF-031(d): Kanban page_size=100 truncation warning
  // -------------------------------------------------------------------------
  it("LM-DEF-031(d): Kanban board displays clear truncation warning when total exceeds loaded 100 leads", async () => {
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(true);
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
    vi.spyOn(Auth, "getProfile").mockReturnValue({ id: "admin-1", roles: ["admin"], permissions: ["*"] } as any);

    const hundredLeads: CrmLeadListItem[] = Array.from({ length: 100 }, (_, i) => ({
      ...OWN_LEAD,
      id: `lead-k-${i}`,
      lead_code: `LD-K-${i}`,
      name: `Kanban Lead ${i}`,
    }));

    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string): any => {
      if (url.match(/\/crm\/pipelines\/pipe-1/)) {
        return Promise.resolve({
          data: {
            id: "pipe-1",
            name: "Direct Sales",
            stages: [{ id: "stage-1", pipeline_id: "pipe-1", name: "New", stage_order: 1, stage_type: "open", is_initial: true, is_active: true }],
          },
        });
      }
      if (url.includes("/crm/pipelines")) {
        return Promise.resolve({ data: [{ id: "pipe-1", name: "Direct Sales" }] });
      }
      if (url.includes("page_size=100")) {
        return Promise.resolve({
          data: { items: hundredLeads, total: 145, page: 1, page_size: 100, total_pages: 2 },
        });
      }
      if (url.includes("/crm/leads")) {
        return Promise.resolve({ data: { items: [OWN_LEAD], total: 145, page: 1, page_size: 25, total_pages: 6 } });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => expect(screen.getByRole("button", { name: /Pipeline Kanban/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Pipeline Kanban/i }));

    await waitFor(() => {
      const warning = screen.getByTestId("kanban-truncation-warning");
      expect(warning).toBeTruthy();
      expect(warning.textContent).toContain("100");
      expect(warning.textContent).toContain("145");
    });
  });

  // -------------------------------------------------------------------------
  // LM-DEF-031(b): /masters/lead-sources route enforces permission="lead_source.view"
  // -------------------------------------------------------------------------
  it("LM-DEF-031(b): /masters/lead-sources blocks users without lead_source.view permission", async () => {
    vi.spyOn(auth, "isLoggedIn").mockReturnValue(true);
    vi.spyOn(auth, "isSuperAdmin").mockReturnValue(false);
    vi.spyOn(auth, "hasPermission").mockImplementation((perm?: string | null) => perm !== "lead_source.view");
    vi.spyOn(auth, "getProfile").mockReturnValue({
      id: "sp-1",
      username: "sp1",
      roles: ["Salesperson"],
      permissions: ["crm.leads.view"],
    } as any);
    vi.spyOn(apiModule, "apiGet").mockResolvedValue({ data: [] } as any);

    render(
      <MemoryRouter initialEntries={["/masters/lead-sources"]}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/403|Access Denied|Forbidden|don't have permission/i)).toBeTruthy();
    });
  });
});
