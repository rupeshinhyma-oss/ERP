import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { CrmLeadsPage, CrmLeadListItem, CrmAssignmentHistoryItem } from "../crm/CrmLeadsPage";
import * as apiModule from "@/lib/api";
import { Auth } from "@/lib/auth";

// Mock AppShell
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

const MOCK_LEADS: CrmLeadListItem[] = [
  {
    id: "lead-1",
    lead_code: "LD-2026-001",
    name: "Acme Corporation",
    original_phone: "+919876543210",
    email: "contact@acme.com",
    company_name: "Acme Corp",
    campaign: "Q3 Inbound",
    source_type: "company_campaign",
    pipeline_id: "pipe-1",
    pipeline_name: "Direct Sales",
    stage_id: "stage-1",
    stage_name: "New Prospect",
    assigned_to: "user-1",
    assigned_salesperson_name: "John Doe",
    assigned_salesperson_email: "john@inhyma.com",
    status: "new",
    priority: "high",
    assignment_status: "assigned",
    created_at: "2026-10-12T10:00:00Z",
  },
  {
    id: "lead-2",
    lead_code: "LD-2026-002",
    name: "Stark Industries",
    original_phone: "+919876543211",
    email: "tony@stark.com",
    company_name: "Stark Industries",
    campaign: "Webinar Event",
    source_type: "import",
    pipeline_id: "pipe-1",
    pipeline_name: "Direct Sales",
    stage_id: "stage-1",
    stage_name: "New Prospect",
    assigned_to: null,
    status: "new",
    priority: "medium",
    assignment_status: "unassigned",
    unassigned_reason: "all_candidates_at_capacity",
    created_at: "2026-10-13T11:00:00Z",
  },
  {
    id: "lead-3",
    lead_code: "LD-2026-003",
    name: "Wayne Enterprises",
    original_phone: "+919876543212",
    email: "bruce@wayneenterprises.global",
    company_name: "Wayne Enterprises International Ltd",
    campaign: "Strategic Nationwide Enterprise Q3 Multi-Channel Inbound Campaign 2026",
    source_type: "enterprise_campaign",
    pipeline_id: "pipe-1",
    pipeline_name: "Direct Sales",
    stage_id: "stage-1",
    stage_name: "New Prospect",
    assigned_to: "user-2",
    assigned_salesperson_name: "Alexander Montgomery Senior Vice President of Strategic Sales",
    assigned_salesperson_email: "alexander.montgomery.strategic.sales@inhyma.corp.global",
    status: "new",
    priority: "high",
    assignment_status: "assigned",
    created_at: "2026-10-14T09:30:00Z",
  },
];

const MOCK_HISTORY: CrmAssignmentHistoryItem[] = [
  {
    id: "hist-1",
    lead_id: "lead-1",
    lead_code: "LD-2026-001",
    lead_name: "Acme Corporation",
    previous_owner_id: null,
    previous_owner_name: null,
    new_owner_id: "user-1",
    new_owner_name: "John Doe",
    assignment_method: "round_robin",
    assigned_by_name: "Admin User",
    batch_name: "Batch October 12",
    reason: "Automated distribution pool assignment",
    created_at: "2026-10-12T10:01:00Z",
  },
];

describe("CrmLeadsPage", () => {
  let apiGetSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(true);
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "admin-1",
      full_name: "Admin User",
      roles: ["admin", "manager"],
      permissions: ["*"],
    } as any);

    apiGetSpy = vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      // Specific pipeline with stages
      if (url.match(/\/crm\/pipelines\/[^?]+/)) {
        return Promise.resolve({
          data: {
            id: "pipe-1",
            name: "Direct Sales",
            stages: [
              { id: "stage-1", pipeline_id: "pipe-1", name: "New Prospect", stage_order: 1, stage_type: "open", is_initial: true, is_active: true },
              { id: "stage-2", pipeline_id: "pipe-1", name: "Qualified", stage_order: 2, stage_type: "open", is_initial: false, is_active: true },
              { id: "stage-3", pipeline_id: "pipe-1", name: "Closed Won", stage_order: 3, stage_type: "won", is_initial: false, is_active: true },
              { id: "stage-4", pipeline_id: "pipe-1", name: "Closed Lost", stage_order: 4, stage_type: "lost", is_initial: false, is_active: true },
            ],
          },
        });
      }
      if (url.includes("/crm/pipelines")) {
        return Promise.resolve({ data: [{ id: "pipe-1", name: "Direct Sales" }] });
      }
      if (url.includes("/crm/distribution/salespeople")) {
        return Promise.resolve({
          data: [
            { user_id: "user-1", display_name: "John Doe", username: "john", is_active: true, is_eligible: true, active_lead_count: 5, max_lead_capacity: 10, remaining_capacity: 5 },
            { user_id: "user-2", display_name: "Jane Smith", username: "jane", is_active: true, is_eligible: true, active_lead_count: 2, max_lead_capacity: 10, remaining_capacity: 8 },
            { user_id: "user-3", display_name: "Full Rep", username: "full", is_active: true, is_eligible: true, active_lead_count: 10, max_lead_capacity: 10, remaining_capacity: 0 },
          ],
        });
      }
      if (url.includes("/crm/assignment-history")) {
        return Promise.resolve({
          data: {
            items: MOCK_HISTORY,
            total: 1,
            page: 1,
            page_size: 25,
            total_pages: 1,
          },
        });
      }
      if (url.includes("/timeline")) {
        return Promise.resolve({
          data: {
            lead_id: "lead-1",
            lead_code: "LD-2026-001",
            lead_name: "Acme Corporation",
            items: [
              {
                id: "tl-act-1",
                timeline_type: "activity",
                title: "Discovery Call Completed",
                description: "Discussed Q3 CRM requirements with CEO",
                timestamp: "2026-10-14T11:00:00Z",
                actor_name: "John Doe",
                metadata: { outcome: "Interested" },
              },
              {
                id: "tl-fu-1",
                timeline_type: "follow_up",
                title: "Follow-Up (Call): Pending",
                description: "Send proposal and schedule deep-dive",
                timestamp: "2026-10-15T15:00:00Z",
                actor_name: "John Doe",
                metadata: { status: "pending", due_at: "2026-10-16T15:00:00Z" },
              },
              {
                id: "tl-stage-1",
                timeline_type: "stage_history",
                title: "Pipeline Stage Changed: Qualified",
                description: "Met initial qualification criteria",
                timestamp: "2026-10-13T14:00:00Z",
                actor_name: "John Doe",
                metadata: {},
              },
              {
                id: "tl-assign-1",
                timeline_type: "assignment_history",
                title: "Lead Ownership: Round_robin",
                description: "Automated distribution pool assignment",
                timestamp: "2026-10-12T10:01:00Z",
                actor_name: "Admin User",
                metadata: {},
              },
            ],
            total: 4,
          },
        });
      }
      if (url.includes("/crm/follow-ups")) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "fu-1",
                lead_id: "lead-1",
                lead_code: "LD-2026-001",
                lead_name: "Acme Corporation",
                follow_up_type: "call",
                due_at: "2026-10-16T15:00:00Z",
                status: "pending",
                priority: "high",
                notes: "Send proposal and schedule deep-dive",
                assigned_to: "user-1",
                assigned_to_name: "John Doe",
                created_at: "2026-10-14T12:00:00Z",
                updated_at: "2026-10-14T12:00:00Z",
              },
            ],
            total: 1,
            page: 1,
            page_size: 50,
            total_pages: 1,
          },
        });
      }
      if (url.match(/\/crm\/leads\/[a-zA-Z0-9_-]+$/)) {
        return Promise.resolve({ data: MOCK_LEADS[0] });
      }
      if (url.includes("/crm/daily-work/summary")) {
        return Promise.resolve({
          data: {
            salesperson_id: "user-1",
            salesperson_name: "John Doe",
            overdue_follow_ups: 3,
            due_today_follow_ups: 5,
            upcoming_follow_ups: 7,
            active_leads: 12,
          },
        });
      }
      if (url.includes("/crm/team-oversight")) {
        return Promise.resolve({
          data: {
            scope_type: "department",
            department_name: "Domestic Sales",
            total_active_leads: 24,
            total_overdue_follow_ups: 4,
            total_due_today_follow_ups: 8,
            total_month_won: 5,
            total_month_lost: 2,
            reps: [
              {
                salesperson_id: "user-1",
                salesperson_name: "John Doe",
                salesperson_email: "john@inhyma.com",
                active_lead_count: 14,
                overdue_follow_up_count: 2,
                due_today_follow_up_count: 5,
                month_won_count: 3,
                month_lost_count: 1,
                stage_distribution: [
                  { stage_id: "stage-1", stage_name: "New Prospect", count: 8 },
                  { stage_id: "stage-2", stage_name: "Qualified", count: 6 },
                ],
              },
              {
                salesperson_id: "user-2",
                salesperson_name: "Jane Smith",
                salesperson_email: "jane@inhyma.com",
                active_lead_count: 10,
                overdue_follow_up_count: 2,
                due_today_follow_up_count: 3,
                month_won_count: 2,
                month_lost_count: 1,
                stage_distribution: [
                  { stage_id: "stage-1", stage_name: "New Prospect", count: 10 },
                ],
              },
            ],
          },
        });
      }
      if (url.includes("/crm/leads")) {
        return Promise.resolve({
          data: {
            items: MOCK_LEADS,
            total: 2,
            page: 1,
            page_size: 25,
            total_pages: 1,
          },
        });
      }
      return Promise.resolve({ data: [] });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders page title and lead database table with ownership details", async () => {
    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    expect(screen.getByText("CRM Lead Database & Ownership")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Acme Corporation")).toBeTruthy();
      expect(screen.getByText("LD-2026-001")).toBeTruthy();
      expect(screen.getAllByText("John Doe").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Stark Industries")).toBeTruthy();
      expect(screen.getAllByText(/Unassigned/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("switches to Unassigned tab and filters leads", async () => {
    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    const unassignedTab = await screen.findByRole("button", { name: /Unassigned Leads/i });
    fireEvent.click(unassignedTab);

    await waitFor(() => {
      expect(apiGetSpy).toHaveBeenCalledWith(expect.stringContaining("unassigned_only=true"));
    });
  });

  it("switches to Assignment Audit History tab and renders audit records", async () => {
    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    const historyTab = await screen.findByRole("button", { name: /Assignment Audit History/i });
    fireEvent.click(historyTab);

    await waitFor(() => {
      expect(apiGetSpy).toHaveBeenCalledWith(expect.stringContaining("/crm/assignment-history"));
      expect(screen.getByText("round_robin")).toBeTruthy();
      expect(screen.getByText("Automated distribution pool assignment")).toBeTruthy();
    });
  });

  it("opens lead detail drawer and loads timeline on clicking History & Details", async () => {
    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Acme Corporation")).toBeTruthy();
    });

    const detailButtons = screen.getAllByText("History & Details");
    fireEvent.click(detailButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Assignment History Timeline")).toBeTruthy();
      expect(screen.getByText("Assigned to John Doe")).toBeTruthy();
    });
  });

  it("renders Reassign button for authorized users and opens modal", async () => {
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Acme Corporation")).toBeTruthy();
    });

    const reassignButtons = screen.getAllByRole("button", { name: /^Reassign$/i });
    expect(reassignButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(reassignButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(screen.getByText("Reassign Lead Ownership")).toBeTruthy();
    });
  });

  it("enforces reason validation (minimum 5 chars) and submits reassignment", async () => {
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
    const apiPostSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      data: { id: "lead-1", assigned_to: "user-2" } as any,
    });

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Acme Corporation")).toBeTruthy();
    });

    const reassignButtons = screen.getAllByRole("button", { name: /^Reassign$/i });
    fireEvent.click(reassignButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Reassign Lead Ownership")).toBeTruthy();
    });

    // Target Rep select
    const targetSelect = screen.getByLabelText(/Target Sales Representative/i);
    fireEvent.change(targetSelect, { target: { value: "user-2" } });

    // Submit button should be disabled when reason has < 5 characters
    const submitBtn = screen.getByRole("button", { name: /Confirm Reassignment/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    // Type short reason (< 5 chars)
    const reasonInput = screen.getByPlaceholderText(/Enter mandatory reason/i);
    fireEvent.change(reasonInput, { target: { value: "abc" } });
    expect(submitBtn.disabled).toBe(true);

    // Type valid reason (>= 5 chars)
    fireEvent.change(reasonInput, { target: { value: "Reassigned due to territory rebalance" } });
    expect(submitBtn.disabled).toBe(false);

    // Submit reassignment
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiPostSpy).toHaveBeenCalledWith("/api/v1/crm/leads/lead-1/reassign", {
        new_salesperson_id: "user-2",
        reason: "Reassigned due to territory rebalance",
      });
    });
  });

  it("verifies stable table layout and column wrapping for assignment reason", async () => {
    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Acme Corporation")).toBeTruthy();
    });

    // Check table headers have explicit widths and table has fixed layout
    const thReason = screen.getByText("Assignment Reason");
    expect(thReason).toBeTruthy();
    expect(thReason.style.width).toBe("230px");
    expect(thReason.style.minWidth).toBe("230px");

    const thActions = screen.getByText("Actions");
    expect(thActions).toBeTruthy();
    expect(thActions.style.width).toBe("230px");
    expect(thActions.style.minWidth).toBe("230px");

    // Unassigned reason text should wrap and not overlap
    const unassignedReasonSpan = screen.getByText("All salespeople have reached their maximum lead capacity cap");
    expect(unassignedReasonSpan).toBeTruthy();
    expect(unassignedReasonSpan.style.whiteSpace).toBe("normal");
    expect(unassignedReasonSpan.style.wordBreak).toBe("break-word");
  });

  it("disables reassignment and warns when selected target salesperson is at capacity cap", async () => {
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Acme Corporation")).toBeTruthy();
    });

    const reassignButtons = screen.getAllByRole("button", { name: /^Reassign$/i });
    fireEvent.click(reassignButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Reassign Lead Ownership")).toBeTruthy();
    });

    // Select user-3 who is at capacity (10/10)
    const targetSelect = screen.getByLabelText(/Target Sales Representative/i);
    fireEvent.change(targetSelect, { target: { value: "user-3" } });

    // Warning message should be displayed
    await waitFor(() => {
      expect(screen.getByText(/Salesperson has reached maximum lead capacity/i)).toBeTruthy();
    });

    // Reason input with >= 5 chars
    const reasonInput = screen.getByPlaceholderText(/Enter mandatory reason/i);
    fireEvent.change(reasonInput, { target: { value: "Attempting reassignment" } });

    // Confirm button must remain disabled
    const submitBtn = screen.getByRole("button", { name: /Confirm Reassignment/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it("safely wraps long campaigns and truncates long salesperson names with tooltips across viewports", async () => {
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);

    const viewports = [1440, 1280, 1024, 768];

    for (const width of viewports) {
      window.innerWidth = width;
      cleanup();

      render(
        <BrowserRouter>
          <CrmLeadsPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Wayne Enterprises")).toBeTruthy();
      });

      // 1. Long campaign element must wrap across multiple lines
      const campaignEl = screen.getByText("Strategic Nationwide Enterprise Q3 Multi-Channel Inbound Campaign 2026");
      expect(campaignEl).toBeTruthy();
      expect(campaignEl.style.whiteSpace).toBe("normal");
      expect(campaignEl.style.wordBreak).toBe("break-word");
      expect(campaignEl.style.overflowWrap).toBe("anywhere");

      // 2. Long salesperson name must truncate with ellipsis and provide full title tooltip
      const spNameEl = screen.getByTitle("Alexander Montgomery Senior Vice President of Strategic Sales");
      expect(spNameEl).toBeTruthy();
      expect(spNameEl.style.textOverflow).toBe("ellipsis");
      expect(spNameEl.style.whiteSpace).toBe("nowrap");

      // 3. Long salesperson email must truncate with ellipsis and provide full title tooltip
      const spEmailEl = screen.getByTitle("alexander.montgomery.strategic.sales@inhyma.corp.global");
      expect(spEmailEl).toBeTruthy();
      expect(spEmailEl.style.textOverflow).toBe("ellipsis");

      // 4. Action buttons must remain fully rendered with flexShrink 0
      const reassignBtns = screen.getAllByRole("button", { name: /^Reassign$/i });
      expect(reassignBtns.length).toBeGreaterThanOrEqual(2);
      expect(reassignBtns[0].style.flexShrink).toBe("0");

      const historyBtns = screen.getAllByRole("button", { name: /^History & Details$/i });
      expect(historyBtns.length).toBeGreaterThanOrEqual(2);
      expect(historyBtns[0].style.flexShrink).toBe("0");
    }
  });

  it("opens lead detail drawer, logs activity with subject, outcome, and refreshes timeline", async () => {
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
    const apiPostSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      data: { id: "act-new", activity_type: "call", subject: "Introductory Demo", outcome: "Qualified" } as any,
    });

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Acme Corporation")).toBeTruthy();
    });

    // Open drawer
    const detailButtons = screen.getAllByRole("button", { name: /^History & Details$/i });
    fireEvent.click(detailButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("+ Log Activity")).toBeTruthy();
    });

    // Click "+ Log Activity"
    fireEvent.click(screen.getByText("+ Log Activity"));

    // Fill form
    const subjectInput = screen.getByPlaceholderText(/Discovery call with procurement manager/i);
    fireEvent.change(subjectInput, { target: { value: "Introductory Demo" } });

    const outcomeInput = screen.getByPlaceholderText(/Interested, Scheduled demo/i);
    fireEvent.change(outcomeInput, { target: { value: "Qualified" } });

    const descInput = screen.getByPlaceholderText(/Details of the interaction/i);
    fireEvent.change(descInput, { target: { value: "Client interested in enterprise tier" } });

    // Submit
    const submitBtn = screen.getByRole("button", { name: /^Save Activity$/i });
    expect(submitBtn).toBeTruthy();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiPostSpy).toHaveBeenCalledWith("/api/v1/crm/leads/lead-1/activities", expect.objectContaining({
        activity_type: "call",
        subject: "Introductory Demo",
        outcome: "Qualified",
        description: "Client interested in enterprise tier",
      }));
    });
  });

  it("schedules follow-up with due date, priority, and notes", async () => {
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
    const apiPostSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      data: { id: "fu-new", follow_up_type: "task", due_at: "2026-10-20T10:00:00Z" } as any,
    });

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Acme Corporation")).toBeTruthy();
    });

    // Open drawer
    const detailButtons = screen.getAllByRole("button", { name: /^History & Details$/i });
    fireEvent.click(detailButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("+ Schedule Follow-Up")).toBeTruthy();
    });

    // Click "+ Schedule Follow-Up"
    fireEvent.click(screen.getByText("+ Schedule Follow-Up"));

    // Select type "task"
    const typeSelect = screen.getByLabelText(/Follow-up Type \*/i);
    fireEvent.change(typeSelect, { target: { value: "task" } });

    // Select priority "high"
    const prioritySelect = screen.getByLabelText(/Priority/i);
    fireEvent.change(prioritySelect, { target: { value: "high" } });

    // Due date
    const dueInput = screen.getByLabelText(/Due Date & Time \*/i);
    fireEvent.change(dueInput, { target: { value: "2026-10-20T10:00" } });

    // Notes
    const notesInput = screen.getByPlaceholderText(/Action items, agenda/i);
    fireEvent.change(notesInput, { target: { value: "Review contract details with legal" } });

    // Submit
    const submitBtn = screen.getByRole("button", { name: /^Schedule Follow-Up$/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiPostSpy).toHaveBeenCalledWith("/api/v1/crm/leads/lead-1/follow-ups", expect.objectContaining({
        follow_up_type: "task",
        notes: "Review contract details with legal",
        assigned_to: "user-1",
      }));
    });
  });

  it("views pending follow-up and marks it completed with notes", async () => {
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
    const apiPatchSpy = vi.spyOn(apiModule, "apiPatch").mockResolvedValue({
      data: { id: "fu-1", status: "completed", completion_notes: "Proposal sent via email" } as any,
    });

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Acme Corporation")).toBeTruthy();
    });

    const detailButtons = screen.getAllByRole("button", { name: /^History & Details$/i });
    fireEvent.click(detailButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Follow-ups")).toBeTruthy();
    });

    // Switch to Follow-ups tab
    fireEvent.click(screen.getByText("Follow-ups"));

    await waitFor(() => {
      expect(screen.getByText("Active Pending Follow-Ups")).toBeTruthy();
      expect(screen.getAllByText("Send proposal and schedule deep-dive").length).toBeGreaterThanOrEqual(1);
    });

    // Click "Mark Completed"
    const markCompletedBtn = screen.getByRole("button", { name: /^Mark Completed$/i });
    fireEvent.click(markCompletedBtn);

    // Type completion note in the inline input
    const completionInput = screen.getByPlaceholderText(/Enter completion notes/i);
    fireEvent.change(completionInput, { target: { value: "Proposal sent via email" } });

    // Click "Confirm Complete"
    const confirmCompleteBtn = screen.getByRole("button", { name: /^Confirm Complete$/i });
    fireEvent.click(confirmCompleteBtn);

    await waitFor(() => {
      expect(apiPatchSpy).toHaveBeenCalledWith("/api/v1/crm/follow-ups/fu-1/status", {
        status: "completed",
        completion_notes: "Proposal sent via email",
      });
    });
  });

  it("restricts stage change to lead's pipeline and enforces mandatory lost reason for lost stages", async () => {
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
    const apiPostSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      data: { id: "lead-1", stage_id: "stage-4", stage_name: "Closed Lost", status: "lost" } as any,
    });

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Acme Corporation")).toBeTruthy();
    });

    // Open drawer
    const detailButtons = screen.getAllByRole("button", { name: /^History & Details$/i });
    fireEvent.click(detailButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Change Stage")).toBeTruthy();
    });

    // Click "Change Stage"
    fireEvent.click(screen.getByText("Change Stage"));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /Change Lead Stage/i })).toBeTruthy();
    });

    // Select target stage
    const stageSelect = screen.getByLabelText(/Select New Stage \*/i);
    // Select stage-4 (Closed Lost)
    fireEvent.change(stageSelect, { target: { value: "stage-4" } });

    // Check that lost reason field appears and validation warning shows
    await waitFor(() => {
      expect(screen.getByLabelText(/Lost Reason \*/i)).toBeTruthy();
      expect(screen.getByText(/Minimum 3 characters required/i)).toBeTruthy();
    });

    // Submit button should be disabled when lost reason is empty or < 3 chars
    const confirmStageBtn = screen.getByRole("button", { name: /^Confirm Stage Change$/i }) as HTMLButtonElement;
    expect(confirmStageBtn.disabled).toBe(true);

    const lostReasonInput = screen.getByPlaceholderText(/Budget constraints, chose competitor/i);
    fireEvent.change(lostReasonInput, { target: { value: "No" } });
    expect(confirmStageBtn.disabled).toBe(true);

    // Enter valid lost reason (>= 3 chars)
    fireEvent.change(lostReasonInput, { target: { value: "Client opted for competitor solution" } });
    expect(confirmStageBtn.disabled).toBe(false);

    // Submit stage change
    fireEvent.click(confirmStageBtn);

    await waitFor(() => {
      expect(apiPostSpy).toHaveBeenCalledWith("/api/v1/crm/leads/lead-1/stage", {
        stage_id: "stage-4",
        reason: null,
        lost_reason: "Client opted for competitor solution",
      });
    });
  });

  it("filters timeline items across tabs (All Timeline, Activities, Follow-ups, Assignments)", async () => {
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Acme Corporation")).toBeTruthy();
    });

    // Open drawer
    const detailButtons = screen.getAllByRole("button", { name: /^History & Details$/i });
    fireEvent.click(detailButtons[0]);

    // In All Timeline, events of different types should be visible
    await waitFor(() => {
      expect(screen.getByText("Discovery Call Completed")).toBeTruthy();
      expect(screen.getByText("Pipeline Stage Changed: Qualified")).toBeTruthy();
      expect(screen.getByText("Lead Ownership: Round_robin")).toBeTruthy();
    });

    // Switch to "Activities & Calls"
    fireEvent.click(screen.getByText("Activities & Calls"));

    await waitFor(() => {
      expect(screen.getByText("Discovery Call Completed")).toBeTruthy();
      // Stage change event should not be in Activities & Calls tab
      expect(screen.queryByText("Pipeline Stage Changed: Qualified")).toBeNull();
    });

    // Switch to "Assignment History Timeline"
    fireEvent.click(screen.getByText("Assignment History Timeline"));

    await waitFor(() => {
      expect(screen.getAllByText("Assignment History Timeline").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Assigned to John Doe").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("disables mutation actions for users lacking crm.leads.manage permission", async () => {
    vi.spyOn(Auth, "hasPermission").mockReturnValue(false);
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(false);
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "viewer-1",
      full_name: "Viewer User",
      roles: ["viewer"],
      permissions: [],
    } as any);

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Acme Corporation")).toBeTruthy();
    });

    // Open drawer
    const detailButtons = screen.getAllByRole("button", { name: /^History & Details$/i });
    fireEvent.click(detailButtons[0]);

    await waitFor(() => {
      const logActBtn = screen.getByRole("button", { name: /^\+ Log Activity$/i }) as HTMLButtonElement;
      const schedFuBtn = screen.getByRole("button", { name: /^\+ Schedule Follow-Up$/i }) as HTMLButtonElement;
      const changeStgBtn = screen.getByRole("button", { name: /^Change Stage$/i }) as HTMLButtonElement;

      expect(logActBtn.disabled).toBe(true);
      expect(schedFuBtn.disabled).toBe(true);
      expect(changeStgBtn.disabled).toBe(true);

      // Reassign button inside drawer should not be present for unauthorized user
      expect(screen.queryByRole("button", { name: /^Reassign Lead$/i })).toBeNull();
    });
  });

  it("cancels a pending follow-up on user confirmation", async () => {
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const apiPatchSpy = vi.spyOn(apiModule, "apiPatch").mockResolvedValue({
      data: { id: "fu-1", status: "cancelled" } as any,
    });

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Acme Corporation")).toBeTruthy();
    });

    const detailButtons = screen.getAllByRole("button", { name: /^History & Details$/i });
    fireEvent.click(detailButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Follow-ups")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Follow-ups"));

    await waitFor(() => {
      expect(screen.getAllByText("Send proposal and schedule deep-dive").length).toBeGreaterThanOrEqual(1);
    });

    const cancelBtn = screen.getByRole("button", { name: /^Cancel$/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(apiPatchSpy).toHaveBeenCalledWith("/api/v1/crm/follow-ups/fu-1/status", expect.objectContaining({
        status: "cancelled",
      }));
    });
  });

  it("handles activity logging server error gracefully without closing drawer", async () => {
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
    vi.spyOn(apiModule, "apiPost").mockRejectedValue(new Error("Lead has been locked by another user."));

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Acme Corporation")).toBeTruthy();
    });

    const detailButtons = screen.getAllByRole("button", { name: /^History & Details$/i });
    fireEvent.click(detailButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("+ Log Activity")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("+ Log Activity"));

    const subjectInput = screen.getByPlaceholderText(/Discovery call with procurement manager/i);
    fireEvent.change(subjectInput, { target: { value: "Follow-up discussion" } });

    const submitBtn = screen.getByRole("button", { name: /^Save Activity$/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("Lead has been locked"), "error");
      expect(screen.getAllByText("Acme Corporation").length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Phase 6 Step 3: Manager Team Oversight & Follow-ups Workflow", () => {
    it("renders Manager Team Oversight and allows drilling down into rep leads via View Leads", async () => {
      vi.spyOn(Auth, "hasPermission").mockReturnValue(true);

      render(
        <BrowserRouter>
          <CrmLeadsPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /^Team Oversight$/i })).toBeTruthy();
      });

      // Switch to Team Oversight tab
      fireEvent.click(screen.getByRole("button", { name: /^Team Oversight$/i }));

      // Verify Team Oversight header and metrics
      await waitFor(() => {
        expect(screen.getByText(/Manager Team Oversight/i)).toBeTruthy();
        expect(screen.getByText(/Team Active Leads/i)).toBeTruthy();
        expect(screen.getByText(/Domestic Sales/i)).toBeTruthy();
      });

      // Verify Reps in Table
      await waitFor(() => {
        expect(screen.getByText("John Doe")).toBeTruthy();
        expect(screen.getByText("Jane Smith")).toBeTruthy();
        expect(screen.getAllByRole("button", { name: /^View Leads$/i }).length).toBe(2);
      });

      // Click "View Leads" on John Doe
      const viewLeadsBtns = screen.getAllByRole("button", { name: /^View Leads$/i });
      fireEvent.click(viewLeadsBtns[0]);

      // Verifies that activeTab switched back to leads
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /^All Leads$/i })).toBeTruthy();
      });
    });

    it("hides Team Oversight, Unassigned Leads, and Assignment History tabs for regular salespeople", async () => {
      // Salesperson with only view permission (no manager or admin permissions)
      vi.spyOn(Auth, "hasPermission").mockImplementation((perm?: string | null) => {
        if (perm === "crm.leads.manage" || perm === "crm.admin" || perm === "crm.distribution.view") return false;
        return true;
      });
      vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(false);
      vi.spyOn(Auth, "getProfile").mockReturnValue({
        id: "user-1",
        full_name: "Salesperson User",
        roles: ["salesperson"],
        permissions: ["crm.leads.view"],
      } as any);

      render(
        <BrowserRouter>
          <CrmLeadsPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("My Leads")).toBeTruthy();
      });

      // Manager-only tabs should NOT exist
      expect(screen.queryByText("Team Oversight")).toBeNull();
      expect(screen.queryByText("Unassigned Leads")).toBeNull();
      expect(screen.queryByText("Assignment History")).toBeNull();
    });

    it("completes follow-up from Lead Detail Drawer and triggers status update", async () => {
      vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
      const apiPatchSpy = vi.spyOn(apiModule, "apiPatch").mockResolvedValue({
        data: { id: "fu-1", status: "completed" } as any,
      });

      render(
        <BrowserRouter>
          <CrmLeadsPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Acme Corporation")).toBeTruthy();
      });

      // Open drawer
      const detailButtons = screen.getAllByRole("button", { name: /^History & Details$/i });
      fireEvent.click(detailButtons[0]);

      // Switch to Follow-ups tab in drawer
      await waitFor(() => {
        expect(screen.getByText("Follow-ups")).toBeTruthy();
      });
      fireEvent.click(screen.getByText("Follow-ups"));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /^Mark Completed$/i })).toBeTruthy();
      });

      // Click Mark Completed to open inline completion form
      fireEvent.click(screen.getByRole("button", { name: /^Mark Completed$/i }));

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Enter completion notes/i)).toBeTruthy();
        expect(screen.getByRole("button", { name: /^Confirm Complete$/i })).toBeTruthy();
      });

      const notesInput = screen.getByPlaceholderText(/Enter completion notes/i);
      fireEvent.change(notesInput, { target: { value: "Connected with prospect and scheduled demo" } });

      fireEvent.click(screen.getByRole("button", { name: /^Confirm Complete$/i }));

      await waitFor(() => {
        expect(apiPatchSpy).toHaveBeenCalledWith(
          "/api/v1/crm/follow-ups/fu-1/status",
          expect.objectContaining({
            status: "completed",
            completion_notes: "Connected with prospect and scheduled demo",
          })
        );
      });
    });

    it("refreshes Team Oversight when Refresh button is clicked", async () => {
      vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
      const apiGetSpy = vi.spyOn(apiModule, "apiGet");

      render(
        <BrowserRouter>
          <CrmLeadsPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /^Team Oversight$/i })).toBeTruthy();
      });

      fireEvent.click(screen.getByRole("button", { name: /^Team Oversight$/i }));

      await waitFor(() => {
        expect(screen.getByText("Team Active Leads")).toBeTruthy();
      });

      const refreshBtns = screen.getAllByRole("button", { name: /^Refresh$/i });
      fireEvent.click(refreshBtns[0]);

      await waitFor(() => {
        expect(apiGetSpy).toHaveBeenCalledWith(expect.stringContaining("/crm/team-oversight"));
      });
    });
  });

  describe("Prompt 2: Role-Based Navigation, Drag-and-Drop Kanban, and Embedded CSV Import", () => {
    it("renders both All Leads (or My Leads) and Pipeline Kanban tabs for Salesperson role", async () => {
      vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(false);
      vi.spyOn(Auth, "hasPermission").mockReturnValue(false);
      vi.spyOn(Auth, "getProfile").mockReturnValue({
        id: "salesperson-1",
        full_name: "Sales Rep",
        roles: ["salesperson"],
        permissions: ["crm.leads.view"],
      } as any);

      render(
        <BrowserRouter>
          <CrmLeadsPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /My Leads/i })).toBeTruthy();
        expect(screen.getByRole("button", { name: /Pipeline Kanban/i })).toBeTruthy();
      });
    });

    it("opens embedded CSV import wizard modal when clicking Import Leads button and closes it on demand", async () => {
      render(
        <BrowserRouter>
          <CrmLeadsPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("crm-import-leads-btn")).toBeTruthy();
      });

      // Initially modal is not open
      expect(screen.queryByTestId("crm-import-modal-overlay")).toBeNull();

      // Click Import Leads button
      fireEvent.click(screen.getByTestId("crm-import-leads-btn"));

      // Modal overlay and container appear
      await waitFor(() => {
        expect(screen.getByTestId("crm-import-modal-overlay")).toBeTruthy();
        expect(screen.getByTestId("crm-import-modal-container")).toBeTruthy();
        expect(screen.getByText("Download CSV Template")).toBeTruthy();
      });

      // Click Close button
      const closeBtn = screen.getByRole("button", { name: /✕ Close/i });
      fireEvent.click(closeBtn);

      await waitFor(() => {
        expect(screen.queryByTestId("crm-import-modal-overlay")).toBeNull();
      });
    });

    it("opens embedded CSV import modal automatically when URL contains ?import=open", async () => {
      // Mock window.location.search with ?import=open
      delete (window as any).location;
      window.location = new URL("http://localhost:3000/crm/leads?import=open") as any;

      render(
        <BrowserRouter>
          <CrmLeadsPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("crm-import-modal-overlay")).toBeTruthy();
        expect(screen.getByTestId("crm-import-modal-container")).toBeTruthy();
      });
    });

    it("supports drag and drop between stages with backend stage update on drop", async () => {
      const apiPostSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
        data: {
          ...MOCK_LEADS[0],
          stage_id: "stage-2",
          stage_name: "Qualified",
          status: "in_progress",
        } as any,
      });

      render(
        <BrowserRouter>
          <CrmLeadsPage />
        </BrowserRouter>
      );

      // Switch to Kanban tab
      const kanbanTab = await screen.findByRole("button", { name: /Pipeline Kanban/i });
      fireEvent.click(kanbanTab);

      await waitFor(() => {
        expect(screen.getByTestId("kanban-board")).toBeTruthy();
        expect(screen.getByTestId("kanban-card-lead-1")).toBeTruthy();
      });

      // Drag lead-1
      const leadCard = screen.getByTestId("kanban-card-lead-1");
      const dataTransfer = {
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue("lead-1"),
        effectAllowed: "",
        dropEffect: "",
      };

      fireEvent.dragStart(leadCard, { dataTransfer });
      expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "lead-1");

      // Target column stage-2
      const targetColumn = screen.getByTestId("kanban-column-stage-2");
      fireEvent.dragOver(targetColumn, { dataTransfer });
      fireEvent.drop(targetColumn, { dataTransfer });

      await waitFor(() => {
        expect(apiPostSpy).toHaveBeenCalledWith("/api/v1/crm/leads/lead-1/stage", expect.objectContaining({
          stage_id: "stage-2",
        }));
      });
    });

    it("reverts card to original stage when backend stage transition fails", async () => {
      vi.spyOn(apiModule, "apiPost").mockRejectedValue(new Error("Stage transition validation failed"));

      render(
        <BrowserRouter>
          <CrmLeadsPage />
        </BrowserRouter>
      );

      const kanbanTab = await screen.findByRole("button", { name: /Pipeline Kanban/i });
      fireEvent.click(kanbanTab);

      await waitFor(() => {
        expect(screen.getByTestId("kanban-card-lead-1")).toBeTruthy();
      });

      const leadCard = screen.getByTestId("kanban-card-lead-1");
      const dataTransfer = {
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue("lead-1"),
        effectAllowed: "",
        dropEffect: "",
      };

      fireEvent.dragStart(leadCard, { dataTransfer });

      const targetColumn = screen.getByTestId("kanban-column-stage-2");
      fireEvent.dragOver(targetColumn, { dataTransfer });
      fireEvent.drop(targetColumn, { dataTransfer });

      // Check error toast was shown and card stays in original stage
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith("Stage transition validation failed", "error");
        expect(screen.getByTestId("kanban-card-lead-1")).toBeTruthy();
      });
    });
  });
});


