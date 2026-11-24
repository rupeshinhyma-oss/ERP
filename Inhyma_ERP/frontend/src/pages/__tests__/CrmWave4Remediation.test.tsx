import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { CrmLeadsPage, CrmLeadListItem, CrmSalesQuotationRead } from "../crm/CrmLeadsPage";
import * as apiModule from "@/lib/api";
import { Auth } from "@/lib/auth";

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

const SAMPLE_LEAD: CrmLeadListItem = {
  id: "lead-w4-1",
  lead_code: "LD-W4-001",
  name: "Wave4 Test Prospect",
  original_phone: "+919876500111",
  email: "prospect@w4.test",
  company_name: "Wave4 Corp",
  campaign: "Q4",
  source_type: "manual_entry",
  pipeline_id: "pipe-1",
  pipeline_name: "Direct Sales",
  stage_id: "stage-1",
  stage_name: "New",
  assigned_to: "user-1",
  created_by: "mgr-1",
  assigned_salesperson_name: "Rep One",
  status: "new",
  priority: "medium",
  assignment_status: "assigned",
  created_at: "2026-11-20T10:00:00Z",
};

const USD_QUOTE: CrmSalesQuotationRead = {
  id: "q-usd-1",
  quotation_number: "SQ-202611-0099",
  lead_id: "lead-w4-1",
  company_id: null,
  version: 1,
  status: "draft",
  quotation_date: "2026-11-20T10:00:00Z",
  valid_until: null,
  currency: "USD",
  customer_name_snapshot: "Wave4 Test Prospect",
  customer_phone_snapshot: "+919876500111",
  customer_email_snapshot: "prospect@w4.test",
  company_name_snapshot: "Wave4 Corp",
  subtotal: 333.57,
  discount_total: 0,
  tax_total: 60.04,
  total_amount: 393.61,
  notes: null,
  terms_and_conditions: null,
  created_at: "2026-11-20T10:00:00Z",
  created_by_name: "Rep One",
  items: [],
};

function setupDefaultApi(quotations: CrmSalesQuotationRead[] = []) {
  return vi.spyOn(apiModule, "apiGet").mockImplementation((url: string): any => {
    if (url.includes("/crm/products/lookup")) {
      return Promise.resolve({
        data: {
          items: [
            {
              id: "p-kg",
              product_code: "INK-KG-01",
              product_name: "Industrial Ink 1KG",
              uom: "KG",
              standard_price: 1500,
              gst_percent: 18,
              is_sellable: true,
              status: "active",
            },
            {
              id: "p-set",
              product_code: "PAD-SET-02",
              product_name: "Ceramic Pad Assembly",
              uom: "SET",
              standard_price: 12000,
              gst_percent: 18,
              is_sellable: true,
              status: "active",
            },
          ],
          total: 2,
        },
      });
    }
    if (url.includes("/crm/pipelines")) {
      return Promise.resolve({
        data: [{ id: "pipe-1", name: "Direct Sales", stages: [{ id: "stage-1", name: "New", stage_order: 1, stage_type: "open", is_initial: true, is_active: true }] }],
      });
    }
    if (url.includes("/crm/distribution/salespeople")) {
      return Promise.resolve({ data: [{ user_id: "user-1", display_name: "Rep One", username: "rep1", is_eligible: true }] });
    }
    if (url.match(/\/crm\/leads\/lead-w4-1\/quotations/)) {
      return Promise.resolve({ data: { items: quotations, total: quotations.length } });
    }
    if (url.match(/\/crm\/leads\/lead-w4-1$/)) {
      return Promise.resolve({ data: SAMPLE_LEAD });
    }
    if (url.includes("/crm/leads")) {
      return Promise.resolve({ data: { items: [SAMPLE_LEAD], total: 1, page: 1, page_size: 25, total_pages: 1 } });
    }
    return Promise.resolve({ data: { items: [], total: 0 } });
  });
}

describe("Lead Management Phase 2 / Wave 4 Frontend Remediation Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // LM-DEF-024: Permission-based manager detection (no role-name substring checks)
  // -------------------------------------------------------------------------
  it("LM-DEF-024: User with manager-like role label ('Office Manager') but ONLY crm.leads.view does NOT get manager tabs, Reassign, Salesperson Workload, or All Salespeople filter", async () => {
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(false);
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "user-1",
      username: "office_mgr",
      roles: ["Office Manager", "Facilities Admin"],
      permissions: ["crm.leads.view", "crm.pipelines.view"],
    } as any);
    vi.spyOn(Auth, "hasPermission").mockImplementation((perm?: string | null) =>
      Boolean(perm && ["crm.leads.view", "crm.pipelines.view"].includes(perm))
    );
    const getSpy = setupDefaultApi();

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => expect(screen.getAllByText("Wave4 Test Prospect").length).toBeGreaterThanOrEqual(1));

    // Must NOT see manager tabs or manager toolbar/filter controls
    expect(screen.queryByRole("button", { name: /^Team Oversight$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Unassigned Leads/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Assignment History/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Salesperson Workload/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Reassign$/i })).toBeNull();
    expect(screen.queryByDisplayValue("All Salespeople")).toBeNull();

    // Must NOT fire unauthorized /crm/distribution/salespeople call
    expect(getSpy.mock.calls.some(([u]) => String(u).includes("/crm/distribution/salespeople"))).toBe(false);
  });

  it("LM-DEF-024: User with crm.leads.manage & crm.distribution.view and unexpected role label ('LeadOps_Tier2') DOES get manager tabs and toolbar controls", async () => {
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(false);
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "ops-1",
      username: "leadops",
      roles: ["LeadOps_Tier2"],
      permissions: ["crm.leads.view", "crm.leads.manage", "crm.distribution.view"],
    } as any);
    vi.spyOn(Auth, "hasPermission").mockImplementation((perm?: string | null) =>
      Boolean(perm && ["crm.leads.view", "crm.leads.manage", "crm.distribution.view"].includes(perm))
    );
    setupDefaultApi();

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => expect(screen.getAllByText("Wave4 Test Prospect").length).toBeGreaterThanOrEqual(1));

    expect(screen.getByRole("button", { name: /^Team Oversight$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Unassigned Leads/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Salesperson Workload/i })).toBeTruthy();
    expect(screen.getByDisplayValue("All Salespeople")).toBeTruthy();
  });

  it("LM-DEF-024: Explicitly denied user sees no manager tabs or workload controls", async () => {
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(false);
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "denied-1",
      username: "denied_mgr",
      roles: ["Sales Manager"],
      permissions: [],
    } as any);
    vi.spyOn(Auth, "hasPermission").mockReturnValue(false);
    setupDefaultApi();

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => expect(screen.getAllByText("Wave4 Test Prospect").length).toBeGreaterThanOrEqual(1));
    expect(screen.queryByRole("button", { name: /^Team Oversight$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Salesperson Workload/i })).toBeNull();
    expect(screen.queryByDisplayValue("All Salespeople")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // LM-DEF-025: Frontend manual lead creation email format validation
  // -------------------------------------------------------------------------
  it("LM-DEF-025: Create Lead modal rejects malformed email client-side and allows valid or blank optional email", async () => {
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(true);
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
    vi.spyOn(Auth, "getProfile").mockReturnValue({ id: "admin-1", roles: ["super_admin"], permissions: ["*"] } as any);
    setupDefaultApi();
    const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({ data: SAMPLE_LEAD } as any);

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => expect(screen.getAllByText("Wave4 Test Prospect").length).toBeGreaterThanOrEqual(1));
    fireEvent.click(screen.getAllByRole("button", { name: /\+ Add Lead/i })[0]);
    await screen.findByRole("dialog");

    fireEvent.change(screen.getByTestId("create-lead-name"), { target: { value: "Email Check Prospect" } });
    fireEvent.change(screen.getByTestId("create-lead-phone"), { target: { value: "9876543210" } });
    fireEvent.change(screen.getByTestId("create-lead-email"), { target: { value: "not-an-email" } });

    const submitBtn = screen.getByRole("button", { name: /Create Lead/i });
    fireEvent.submit(submitBtn.closest("form")!);

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/valid email/i);
    });
    expect(postSpy).not.toHaveBeenCalled();

    // Valid email submits cleanly
    fireEvent.change(screen.getByTestId("create-lead-email"), { target: { value: "Alice@sub.example.com" } });
    fireEvent.submit(submitBtn.closest("form")!);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        "/api/v1/crm/leads",
        expect.objectContaining({ email: "Alice@sub.example.com" })
      );
    });
  });

  // -------------------------------------------------------------------------
  // LM-DEF-026 & LM-DEF-027: Actual Product UOMs in Quotation Modal & USD Currency Display
  // -------------------------------------------------------------------------
  it("LM-DEF-026 & LM-DEF-027: Quotation modal preserves actual product UOMs (KG, SET) across lines and quotation card displays non-INR currency (USD) accurately", async () => {
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(true);
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
    vi.spyOn(Auth, "getProfile").mockReturnValue({ id: "admin-1", roles: ["super_admin"], permissions: ["*"] } as any);
    setupDefaultApi([USD_QUOTE]);

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => expect(screen.getAllByText("Wave4 Test Prospect").length).toBeGreaterThanOrEqual(1));
    fireEvent.click(screen.getAllByRole("button", { name: /^History & Details$/i })[0]);
    await waitFor(() => expect(screen.getByText(/Quotations/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/Quotations/i));

    // LM-DEF-027: USD quotation card shows USD 393.61 (NOT ₹393.61!)
    await waitFor(() => {
      expect(screen.getByText("SQ-202611-0099")).toBeTruthy();
      expect(screen.getByText(/USD\s*393\.61/)).toBeTruthy();
    });
    expect(screen.queryByText(/₹393\.61/)).toBeNull();

    // LM-DEF-026: Open Create Quotation -> select KG product & SET product -> verify actual UOM values!
    fireEvent.click(screen.getByTestId("crm-new-quotation-btn"));
    await screen.findByRole("heading", { name: "Create Quotation" });

    const searchInput = screen.getByPlaceholderText(/Search Product Master by product name or code/i);
    fireEvent.change(searchInput, { target: { value: "Ink" } });
    await waitFor(() => expect(screen.getAllByText("+ Select").length).toBeGreaterThanOrEqual(2));
    fireEvent.click(screen.getAllByText("+ Select")[0]);
    await waitFor(() => expect(screen.getByText("KG")).toBeTruthy());

    // Search again for second product (dropdown clears after selecting first product)
    fireEvent.change(searchInput, { target: { value: "Pad" } });
    await waitFor(() => expect(screen.getAllByText("+ Select").length).toBeGreaterThanOrEqual(2));
    fireEvent.click(screen.getAllByText("+ Select")[1]);

    await waitFor(() => {
      expect(screen.getByText("KG")).toBeTruthy();
      expect(screen.getByText("SET")).toBeTruthy();
    });
  });
});
