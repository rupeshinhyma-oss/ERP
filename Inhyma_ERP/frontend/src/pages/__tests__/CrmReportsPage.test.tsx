import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { CrmReportsPage } from "../crm/CrmReportsPage";
import * as apiModule from "@/lib/api";
import { Auth } from "@/lib/auth";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

vi.mock("@/lib/toast", () => ({
  useToast: () => vi.fn(),
}));

const MOCK_ANALYTICS_DATA = {
  start_date: "2026-10-01",
  end_date: "2026-10-15",
  timezone: "Asia/Kolkata",
  role_type: "super_admin",
  scope_type: "company",
  pipeline_id: null,
  salesperson_id: null,
  overview: {
    total_leads_in_range: 45,
    total_active_leads: 25,
    total_all_time_leads: 45,
    won_count: 12,
    lost_count: 6,
    closed_count: 18,
    conversion_rate: 66.7,
    win_rate_on_new: 26.7,
    assigned_count: 40,
    unassigned_count: 5,
    total_follow_ups: 35,
    overdue_follow_ups: 3,
    total_activities: 110,
  },
  pipelines: [
    {
      pipeline_id: "pipe-1",
      pipeline_name: "Domestic Sales",
      lead_count: 36,
      won_count: 12,
      lost_count: 6,
      active_count: 18,
      stages: [
        { stage_id: "stg-1", stage_name: "New Lead", lead_count: 8, order_index: 0, stage_type: "open" },
        { stage_id: "stg-2", stage_name: "Contacted", lead_count: 10, order_index: 1, stage_type: "open" },
        { stage_id: "stg-3", stage_name: "Closed Won", lead_count: 12, order_index: 2, stage_type: "won" },
        { stage_id: "stg-4", stage_name: "Closed Lost", lead_count: 6, order_index: 3, stage_type: "lost" },
      ],
    },
  ],
  campaigns: [
    {
      campaign: "Google Search Ads",
      total_leads: 20,
      won_leads: 8,
      lost_leads: 2,
      active_leads: 10,
      conversion_rate: 80.0,
    },
    {
      campaign: "Direct Referral",
      total_leads: 10,
      won_leads: 4,
      lost_leads: 4,
      active_leads: 2,
      conversion_rate: 50.0,
    },
  ],
  sources: [
    { source_type: "google_ads", total_leads: 20, won_leads: 8, conversion_rate: 40.0 },
    { source_type: "referral", total_leads: 15, won_leads: 4, conversion_rate: 26.7 },
  ],
  reps: [
    {
      salesperson_id: "rep-1",
      salesperson_name: "John Salesperson",
      salesperson_email: "john@inhyma.com",
      assigned_leads: 25,
      active_leads: 15,
      new_leads_in_range: 10,
      won_count: 8,
      lost_count: 2,
      conversion_rate: 80.0,
      total_follow_ups: 20,
      overdue_follow_ups: 1,
      activities_count: 70,
      max_capacity: 50,
    },
  ],
  trends: [
    { date: "2026-10-10", new_leads: 4, won_leads: 2, lost_leads: 0, activities_count: 15 },
    { date: "2026-10-11", new_leads: 5, won_leads: 1, lost_leads: 1, activities_count: 18 },
  ],
};

const MOCK_PIPELINES = [
  { id: "pipe-1", name: "Domestic Sales", is_default: true },
  { id: "pipe-2", name: "Export Pipeline", is_default: false },
];

const MOCK_REPS = [
  { user_id: "rep-1", display_name: "John Salesperson", email: "john@inhyma.com" },
  { user_id: "rep-2", display_name: "Alice Rep", email: "alice@inhyma.com" },
];

describe("CrmReportsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(true);
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "admin-1",
      role: "admin",
      roles: ["admin"],
      username: "admin",
      display_name: "Admin User",
      permissions: ["*"],
    } as any);

    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/crm/pipelines")) {
        return Promise.resolve({ data: MOCK_PIPELINES, meta: undefined } as any);
      }
      if (url.includes("/crm/distribution/salespeople")) {
        return Promise.resolve({ data: MOCK_REPS, meta: undefined } as any);
      }
      if (url.includes("/crm/reports/analytics")) {
        return Promise.resolve({ data: MOCK_ANALYTICS_DATA, meta: undefined } as any);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders overview metrics and filters for Admin", async () => {
    render(
      <BrowserRouter>
        <CrmReportsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("CRM Reports & Analytics")).toBeDefined();
    });

    // Check KPI cards
    await waitFor(() => {
      expect(screen.getByTestId("kpi-total-leads").textContent).toBe("45");
      expect(screen.getByTestId("kpi-won-deals").textContent).toBe("12");
      expect(screen.getByTestId("kpi-conversion-rate").textContent).toBe("66.7%");
      expect(screen.getByTestId("kpi-overdue-followups").textContent).toBe("3");
    });

    // Pipeline and Rep filters are visible for Admin
    expect(screen.getByLabelText(/Pipeline/i)).toBeDefined();
    expect(screen.getByLabelText(/Sales Rep/i)).toBeDefined();

    // Check rep performance and attribution sections rendered
    expect(screen.getByText("Sales Representative Performance & Workload")).toBeDefined();
    expect(screen.getAllByText("John Salesperson").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Google Search Ads")).toBeDefined();
  });

  it("restricts filters for Salesperson and displays personal performance card", async () => {
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(false);
    vi.spyOn(Auth, "hasPermission").mockImplementation((perm) => perm !== "crm.leads.manage");
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "rep-1",
      role: "salesperson",
      roles: ["salesperson"],
      username: "john_rep",
      display_name: "John Salesperson",
      permissions: ["crm.leads.view"],
    } as any);

    render(
      <BrowserRouter>
        <CrmReportsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("CRM Reports & Analytics")).toBeDefined();
    });

    // Sales rep dropdown should NOT be present for Salesperson
    expect(screen.queryByLabelText(/Sales Rep/i)).toBeNull();

    // Personal performance section should be present
    await waitFor(() => {
      expect(screen.getByText("My Sales Performance & Workload")).toBeDefined();
    });
  });

  it("handles empty / zero-conversion datasets with 'N/A' conversion rate", async () => {
    const zeroClosedData = {
      ...MOCK_ANALYTICS_DATA,
      overview: {
        ...MOCK_ANALYTICS_DATA.overview,
        total_leads_in_range: 5,
        total_active_leads: 5,
        won_count: 0,
        lost_count: 0,
        closed_count: 0,
        conversion_rate: null, // Denominator is 0
      },
    };

    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/crm/pipelines")) return Promise.resolve({ data: MOCK_PIPELINES, meta: undefined } as any);
      if (url.includes("/crm/distribution/salespeople")) return Promise.resolve({ data: MOCK_REPS, meta: undefined } as any);
      if (url.includes("/crm/reports/analytics")) return Promise.resolve({ data: zeroClosedData, meta: undefined } as any);
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    render(
      <BrowserRouter>
        <CrmReportsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("N/A")).toBeDefined();
    });
    // Won/Closed should be "No closed deals in range"
    expect(screen.getByText("No closed deals in range")).toBeDefined();
  });

  it("handles date preset selection and re-fetches analytics", async () => {
    const apiGetSpy = vi.spyOn(apiModule, "apiGet");

    render(
      <BrowserRouter>
        <CrmReportsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("CRM Reports & Analytics")).toBeDefined();
    });

    // Click "Last 7 Days"
    const last7DaysBtn = screen.getByRole("button", { name: "Last 7 Days" });
    fireEvent.click(last7DaysBtn);

    await waitFor(() => {
      expect(apiGetSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/v1\/crm\/reports\/analytics\?.*start_date=.*/)
      );
    });
  });
});
