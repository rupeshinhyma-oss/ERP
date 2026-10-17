import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { SalespersonDistributionPage, SalespersonDistributionItem } from "../crm/SalespersonDistributionPage";
import * as apiModule from "@/lib/api";
import { auth } from "@/lib/auth";

// Mock AppShell
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

const MOCK_SALESPEOPLE: SalespersonDistributionItem[] = [
  {
    user_id: "user-1",
    username: "john",
    display_name: "John Doe",
    employee_code: "EMP-001",
    email: "john@inhyma.com",
    is_active_user: true,
    user_status: "ACTIVE",
    department: "Sales",
    is_eligible: true,
    priority: 1,
    max_lead_capacity: 50,
    is_active_config: true,
    notes: "West region lead specialist",
    territories: [
      { id: "terr-1", state_id: "state-1", state_name: "Maharashtra", state_code: "MH" },
      { id: "terr-2", state_id: "state-2", state_name: "Gujarat", state_code: "GJ" },
    ],
    active_lead_count: 4,
    total_assigned_lead_count: 15,
    last_assigned_at: "2026-10-10T12:00:00Z",
    updated_at: "2026-10-10T12:00:00Z",
  },
  {
    user_id: "user-2",
    username: "sales_manager",
    display_name: "Sales Manager",
    employee_code: "EMP-003",
    email: "manager@inhyma.com",
    is_active_user: true,
    user_status: "ACTIVE",
    department: "Sales",
    is_eligible: false,
    priority: 3,
    max_lead_capacity: null,
    is_active_config: true,
    notes: "Escalations only",
    territories: [],
    active_lead_count: 0,
    total_assigned_lead_count: 2,
    last_assigned_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
  },
  {
    user_id: "user-3",
    username: "ops_employee",
    display_name: "Operations Staff",
    employee_code: "EMP-004",
    email: "ops@inhyma.com",
    is_active_user: true,
    user_status: "ACTIVE",
    department: "Operations",
    is_eligible: false,
    priority: 5,
    max_lead_capacity: null,
    is_active_config: true,
    notes: null,
    territories: [],
    active_lead_count: 0,
    total_assigned_lead_count: 0,
    last_assigned_at: null,
    updated_at: null,
  },
];

const MOCK_STATES = [
  { id: "state-1", name: "Maharashtra", code: "MH" },
  { id: "state-2", name: "Gujarat", code: "GJ" },
  { id: "state-3", name: "Karnataka", code: "KA" },
];

describe("SalespersonDistributionPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(auth, "hasPermission").mockReturnValue(true);

    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string): any => {
      if (url.includes("/masters/states")) {
        return Promise.resolve({ data: MOCK_STATES } as any);
      }
      if (url.includes("/crm/distribution/salespeople")) {
        return Promise.resolve({ data: MOCK_SALESPEOPLE } as any);
      }
      return Promise.resolve({ data: [] } as any);
    });

    vi.spyOn(apiModule, "apiPut").mockImplementation((_url: string, payload: any) => {
      return Promise.resolve({
        data: {
          ...MOCK_SALESPEOPLE[0],
          ...payload,
          territories: payload.territory_state_ids
            ? payload.territory_state_ids.map((id: string) => ({
                id: `terr-${id}`,
                state_id: id,
                state_name: MOCK_STATES.find((s) => s.id === id)?.name || id,
              }))
            : MOCK_SALESPEOPLE[0].territories,
        },
      });
    });

    vi.spyOn(apiModule, "apiPost").mockImplementation(() => {
      return Promise.resolve({ data: { count: 2, is_eligible: true } });
    });
  });

  afterEach(() => {
    cleanup();
  });

  const renderComponent = async () => {
    const rendered = render(
      <BrowserRouter>
        <SalespersonDistributionPage />
      </BrowserRouter>
    );
    await waitFor(() => {
      expect(screen.queryByText(/Loading salesperson configuration data/i)).toBeNull();
    });
    return rendered;
  };

  it("renders page title, summary metrics, and salesperson table", async () => {
    await renderComponent();

    // Check renamed header
    expect(screen.getAllByText("Salesperson Configuration").length).toBeGreaterThanOrEqual(1);

    // AppShell active key
    const appShell = screen.getByTestId("app-shell");
    expect(appShell.getAttribute("data-active-key")).toBe("crm-distribution");

    // Table rows
    expect(screen.getByText("John Doe")).toBeTruthy();
    expect(screen.getByText("Sales Manager")).toBeTruthy();
    expect(screen.getByText("Operations Staff")).toBeTruthy();

    // Check summary metric cards
    expect(screen.getByText("Eligible Salespeople")).toBeTruthy();
    expect(screen.getByText("Territories Covered")).toBeTruthy();
    expect(screen.getByText("Active Lead Workload")).toBeTruthy();

    // Check John's territory badges
    expect(screen.getAllByText("Maharashtra").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Gujarat").length).toBeGreaterThanOrEqual(1);

    // Check honest lead counts
    expect(screen.getAllByText("4").length).toBeGreaterThanOrEqual(1); // John active count & summary
    expect(screen.getByText("15")).toBeTruthy(); // John total count
  });

  it("filters salespeople by search query", async () => {
    await renderComponent();

    expect(screen.getByText("John Doe")).toBeTruthy();

    const searchInput = screen.getByPlaceholderText(/search by name/i);
    fireEvent.change(searchInput, { target: { value: "Operations" } });

    expect(screen.queryByText("John Doe")).toBeNull();
    expect(screen.getByText("Operations Staff")).toBeTruthy();
  });

  it("filters salespeople by eligibility status", async () => {
    await renderComponent();

    expect(screen.getByText("John Doe")).toBeTruthy();

    const eligibilitySelect = screen.getByDisplayValue("All Eligibility");
    fireEvent.change(eligibilitySelect, { target: { value: "ELIGIBLE" } });

    expect(screen.getByText("John Doe")).toBeTruthy();
    expect(screen.queryByText("Sales Manager")).toBeNull();
    expect(screen.queryByText("Operations Staff")).toBeNull();
  });

  it("opens edit drawer and saves updated territory configuration", async () => {
    await renderComponent();

    expect(screen.getByText("John Doe")).toBeTruthy();

    // Click "Configure" for John Doe
    const configureButtons = screen.getAllByRole("button", { name: /configure/i });
    fireEvent.click(configureButtons[0]);

    // Drawer should open with renamed title
    const drawerTitles = screen.getAllByText("Salesperson Configuration");
    expect(drawerTitles.length).toBeGreaterThanOrEqual(2); // Page header + Drawer header

    const eligibilityCheckbox = screen.getByLabelText(/eligible for automatic assignment/i) as HTMLInputElement;
    expect(eligibilityCheckbox.checked).toBe(true);

    // Specific territories should be selected for John
    const specificRadio = screen.getByRole("radio", { name: /specific territories/i }) as HTMLInputElement;
    expect(specificRadio.checked).toBe(true);

    // Add Karnataka territory from checkbox list
    const karnatakaCheckboxes = screen.getAllByRole("checkbox");
    // Find the one for Karnataka
    const karnatakaBox = karnatakaCheckboxes.find((el) => {
      const parent = el.closest("label");
      return parent && parent.textContent && parent.textContent.includes("Karnataka");
    });
    expect(karnatakaBox).toBeTruthy();
    if (karnatakaBox) {
      fireEvent.click(karnatakaBox);
    }

    // Open Advanced Settings (collapsed by default)
    const advancedToggle = screen.getByText(/Advanced Settings/i);
    fireEvent.click(advancedToggle);

    // Change priority
    const priorityInput = screen.getByDisplayValue("1");
    fireEvent.change(priorityInput, { target: { value: "2" } });

    // Click "Save Configuration"
    const saveButton = screen.getByRole("button", { name: /save configuration/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(apiModule.apiPut).toHaveBeenCalledWith(
        "/crm/distribution/salespeople/user-1",
        expect.objectContaining({
          is_eligible: true,
          priority: 2,
          territory_state_ids: expect.arrayContaining(["state-1", "state-2", "state-3"]),
        })
      );
    });
  });

  it("supports bulk enabling assignment with confirmation modal", async () => {
    await renderComponent();

    expect(screen.getByText("John Doe")).toBeTruthy();

    // Select row checkboxes
    const checkboxes = screen.getAllByRole("checkbox");
    // checkboxes[0] is header, checkboxes[1] is John, checkboxes[2] is Sales Manager
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);

    // Click "Enable Assignment" in bulk action bar
    const enableBtn = screen.getByRole("button", { name: /enable assignment/i });
    fireEvent.click(enableBtn);

    // Modal opens
    expect(screen.getByText(/enable lead assignment for selected users/i)).toBeTruthy();

    // Confirm
    const confirmBtn = screen.getByRole("button", { name: /confirm enable/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith(
        "/crm/distribution/salespeople/bulk-eligibility",
        expect.objectContaining({
          user_ids: ["user-1", "user-2"],
          is_eligible: true,
        })
      );
    });
  });

  it("hides management controls in view-only mode", async () => {
    vi.spyOn(auth, "hasPermission").mockReturnValue(false);
    await renderComponent();

    expect(screen.getByText("John Doe")).toBeTruthy();

    // Bulk selection buttons should not appear
    expect(screen.queryByRole("button", { name: /enable assignment/i })).toBeNull();

    // Click configure to check drawer controls
    const configureBtn = screen.getAllByRole("button", { name: /configure/i })[0];
    fireEvent.click(configureBtn);

    // Save button should not appear in drawer
    expect(screen.queryByRole("button", { name: /save configuration/i })).toBeNull();
  });

  it("verifies drawer structure with single scrollable body and reachable notes", async () => {
    await renderComponent();

    // Open drawer for John
    const configureBtn = screen.getAllByRole("button", { name: /configure/i })[0];
    fireEvent.click(configureBtn);

    // Verify card and scroll body
    const card = screen.getByTestId("salesperson-drawer-card");
    expect(card).toBeTruthy();

    const scrollBody = screen.getByTestId("salesperson-drawer-scroll-body");
    expect(scrollBody).toBeTruthy();
    expect(scrollBody.style.overflowY).toBe("auto");

    // Expand Advanced Settings
    const advancedToggle = screen.getByText(/Advanced Settings/i);
    fireEvent.click(advancedToggle);

    // Internal Routing Notes textarea is present inside the scroll body
    const notesTextarea = screen.getByLabelText(/internal routing notes/i) as HTMLTextAreaElement;
    expect(notesTextarea).toBeTruthy();
    expect(notesTextarea.value).toBe("West region lead specialist");

    // Edit notes
    fireEvent.change(notesTextarea, { target: { value: "Updated enterprise lead routing notes" } });
    expect(notesTextarea.value).toBe("Updated enterprise lead routing notes");
  });
});
