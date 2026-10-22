import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { CrmLeadsPage, CrmLeadListItem } from "../crm/CrmLeadsPage";
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

const PIPELINES = [
  { id: "pipe-1", name: "Direct Sales Pipeline" },
  { id: "pipe-2", name: "Channel Partner Pipeline" },
];

const PIPE_1_STAGES = [
  { id: "st-1-1", pipeline_id: "pipe-1", name: "Prospecting", stage_order: 1, stage_type: "open", is_initial: true, is_active: true },
  { id: "st-1-2", pipeline_id: "pipe-1", name: "Qualified", stage_order: 2, stage_type: "open", is_initial: false, is_active: true },
  { id: "st-1-3", pipeline_id: "pipe-1", name: "Deal Won", stage_order: 3, stage_type: "won", is_initial: false, is_active: true },
  { id: "st-1-4", pipeline_id: "pipe-1", name: "Deal Lost", stage_order: 4, stage_type: "lost", is_initial: false, is_active: true },
];

const PIPE_2_STAGES = [
  { id: "st-2-1", pipeline_id: "pipe-2", name: "Inbound Referral", stage_order: 1, stage_type: "open", is_initial: true, is_active: true },
  { id: "st-2-2", pipeline_id: "pipe-2", name: "Partner Review", stage_order: 2, stage_type: "open", is_initial: false, is_active: true },
  { id: "st-2-3", pipeline_id: "pipe-2", name: "Converted", stage_order: 3, stage_type: "won", is_initial: false, is_active: true },
];

const PIPE_1_LEADS: CrmLeadListItem[] = [
  {
    id: "lead-1",
    lead_code: "LD-2026-001",
    name: "Alpha Corp",
    original_phone: "+919876543210",
    email: "alpha@corp.com",
    company_name: "Alpha Corporation",
    source_type: "website",
    pipeline_id: "pipe-1",
    pipeline_name: "Direct Sales Pipeline",
    stage_id: "st-1-1",
    stage_name: "Prospecting",
    stage_type: "open",
    assigned_to: "user-rep-1",
    assigned_salesperson_name: "John Doe",
    status: "in_progress",
    priority: "high",
    assignment_status: "assigned",
    created_at: "2026-10-12T10:00:00Z",
  },
  {
    id: "lead-2",
    lead_code: "LD-2026-002",
    name: "Beta Logistics",
    original_phone: "+919876543211",
    email: "beta@logistics.com",
    company_name: "Beta Logistics Ltd",
    source_type: "referral",
    pipeline_id: "pipe-1",
    pipeline_name: "Direct Sales Pipeline",
    stage_id: "st-1-2",
    stage_name: "Qualified",
    stage_type: "open",
    assigned_to: "user-rep-2",
    assigned_salesperson_name: "Jane Smith",
    status: "in_progress",
    priority: "medium",
    assignment_status: "assigned",
    created_at: "2026-10-13T10:00:00Z",
  },
];

const PIPE_2_LEADS: CrmLeadListItem[] = [
  {
    id: "lead-3",
    lead_code: "LD-2026-003",
    name: "Gamma Tech",
    original_phone: "+919876543212",
    email: "gamma@tech.com",
    company_name: "Gamma Technologies",
    source_type: "partner",
    pipeline_id: "pipe-2",
    pipeline_name: "Channel Partner Pipeline",
    stage_id: "st-2-1",
    stage_name: "Inbound Referral",
    stage_type: "open",
    assigned_to: "user-rep-1",
    assigned_salesperson_name: "John Doe",
    status: "in_progress",
    priority: "urgent",
    assignment_status: "assigned",
    created_at: "2026-10-14T10:00:00Z",
  },
];

describe("CrmKanbanDragAndDrop (Phase 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(true);
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "user-admin",
      username: "admin",
      roles: ["super_admin"],
    } as any);

    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/crm/pipelines/pipe-1")) {
        return Promise.resolve({
          data: {
            id: "pipe-1",
            name: "Direct Sales Pipeline",
            stages: PIPE_1_STAGES,
          },
        });
      }
      if (url.includes("/crm/pipelines/pipe-2")) {
        return Promise.resolve({
          data: {
            id: "pipe-2",
            name: "Channel Partner Pipeline",
            stages: PIPE_2_STAGES,
          },
        });
      }
      if (url.includes("/crm/pipelines")) {
        return Promise.resolve({ data: PIPELINES });
      }
      if (url.includes("/crm/leads") && url.includes("pipeline_id=pipe-2")) {
        return Promise.resolve({
          data: {
            items: PIPE_2_LEADS,
            total: PIPE_2_LEADS.length,
            page: 1,
            page_size: 100,
            total_pages: 1,
          },
        });
      }
      if (url.includes("/crm/leads")) {
        return Promise.resolve({
          data: {
            items: PIPE_1_LEADS,
            total: PIPE_1_LEADS.length,
            page: 1,
            page_size: 100,
            total_pages: 1,
          },
        });
      }
      if (url.includes("/crm/distribution/salespeople")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Kanban board with dynamic columns and stage counts for the selected pipeline", async () => {
    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    // Switch to Kanban tab
    const kanbanTabBtn = screen.getByRole("button", { name: /Pipeline Kanban/i });
    fireEvent.click(kanbanTabBtn);

    // Verify dynamic columns for Pipe 1
    await waitFor(() => {
      expect(screen.getByText("Prospecting")).toBeTruthy();
      expect(screen.getByText("Qualified")).toBeTruthy();
      expect(screen.getByText("Deal Won")).toBeTruthy();
      expect(screen.getByText("Deal Lost")).toBeTruthy();
    });

    // Verify stage counts
    expect(screen.getByTestId("stage-count-st-1-1").textContent).toBe("1");
    expect(screen.getByTestId("stage-count-st-1-2").textContent).toBe("1");
    expect(screen.getByTestId("stage-count-st-1-3").textContent).toBe("0");
    expect(screen.getByTestId("stage-count-st-1-4").textContent).toBe("0");

    // Verify cards rendered
    expect(screen.getByText("Alpha Corp")).toBeTruthy();
    expect(screen.getByText("Beta Logistics")).toBeTruthy();
    expect(screen.getByTestId("kanban-total-leads").textContent).toBe("2");
  });

  it("switches pipelines and dynamically updates columns and leads", async () => {
    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /Pipeline Kanban/i }));

    await waitFor(() => {
      expect(screen.getByTestId("kanban-pipeline-select")).toBeTruthy();
    });

    // Switch to Channel Partner Pipeline
    const select = screen.getByTestId("kanban-pipeline-select");
    fireEvent.change(select, { target: { value: "pipe-2" } });

    // Verify Pipe 2 stages and leads loaded
    await waitFor(() => {
      expect(screen.getByText("Inbound Referral")).toBeTruthy();
      expect(screen.getByText("Partner Review")).toBeTruthy();
      expect(screen.getByText("Converted")).toBeTruthy();
      expect(screen.getByText("Gamma Tech")).toBeTruthy();
      expect(screen.queryByText("Alpha Corp")).toBeNull();
    });
  });

  it("drags and drops a card to another valid stage with optimistic update and API invocation", async () => {
    const apiPostSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      data: {
        ...PIPE_1_LEADS[0],
        stage_id: "st-1-2",
        stage_name: "Qualified",
      },
    });

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /Pipeline Kanban/i }));

    await waitFor(() => {
      expect(screen.getByTestId("kanban-card-lead-1")).toBeTruthy();
    });

    const card = screen.getByTestId("kanban-card-lead-1");
    const targetColumn = screen.getByTestId("kanban-column-st-1-2");

    // Drag start
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("lead-1"),
      effectAllowed: "move",
      dropEffect: "move",
    };
    fireEvent.dragStart(card, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "lead-1");

    // Drag over target column
    fireEvent.dragOver(targetColumn, { dataTransfer });

    // Drop on target column
    fireEvent.drop(targetColumn, { dataTransfer });

    // Verify API called
    await waitFor(() => {
      expect(apiPostSpy).toHaveBeenCalledWith("/api/v1/crm/leads/lead-1/stage", {
        stage_id: "st-1-2",
        reason: "Moved to Qualified via Kanban",
      });
    });

    expect(mockToast).toHaveBeenCalledWith("Lead moved to 'Qualified'", "success");
  });

  it("drops into a lost stage and prompts for mandatory lost reason before transitioning", async () => {
    const apiPostSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      data: {
        ...PIPE_1_LEADS[0],
        stage_id: "st-1-4",
        stage_name: "Deal Lost",
        status: "lost",
        lost_reason: "Price was too high for client budget",
      },
    });

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /Pipeline Kanban/i }));

    await waitFor(() => {
      expect(screen.getByTestId("kanban-card-lead-1")).toBeTruthy();
    });

    const card = screen.getByTestId("kanban-card-lead-1");
    const lostColumn = screen.getByTestId("kanban-column-st-1-4");

    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("lead-1"),
      effectAllowed: "move",
      dropEffect: "move",
    };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(lostColumn, { dataTransfer });

    // Verify Lost Reason modal opened
    await waitFor(() => {
      expect(screen.getByText("Change Lead Stage")).toBeTruthy();
      expect(screen.getByLabelText(/Lost Reason \*/i)).toBeTruthy();
    });

    // Provide lost reason and submit
    const lostInput = screen.getByLabelText(/Lost Reason \*/i);
    fireEvent.change(lostInput, { target: { value: "Price was too high for client budget" } });

    const confirmBtn = screen.getByRole("button", { name: /^Confirm Stage Change$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiPostSpy).toHaveBeenCalledWith("/api/v1/crm/leads/lead-1/stage", {
        stage_id: "st-1-4",
        reason: null,
        lost_reason: "Price was too high for client budget",
      });
    });
  });

  it("reverts card to original stage and displays toast error if API call fails", async () => {
    vi.spyOn(apiModule, "apiPost").mockRejectedValue(new Error("Network error during stage move"));

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /Pipeline Kanban/i }));

    await waitFor(() => {
      expect(screen.getByTestId("kanban-card-lead-1")).toBeTruthy();
    });

    const card = screen.getByTestId("kanban-card-lead-1");
    const wonColumn = screen.getByTestId("kanban-column-st-1-3");

    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("lead-1"),
      effectAllowed: "move",
      dropEffect: "move",
    };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(wonColumn, { dataTransfer });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith("Network error during stage move", "error");
    });

    // Verify card is still in original stage (st-1-1 Prospecting)
    expect(screen.getByTestId("stage-count-st-1-1").textContent).toBe("1");
    expect(screen.getByTestId("stage-count-st-1-3").textContent).toBe("0");
  });

  it("enforces salesperson permissions: cannot drag leads owned by other reps", async () => {
    // Configure as Salesperson (rep-1) without distribution/manager permissions
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(false);
    vi.spyOn(Auth, "hasPermission").mockImplementation((p) => p === "crm.leads.view");
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "user-rep-1",
      username: "rep1",
      roles: ["salesperson"],
    } as any);

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /Pipeline Kanban/i }));

    await waitFor(() => {
      expect(screen.getByTestId("kanban-card-lead-1")).toBeTruthy();
      expect(screen.getByTestId("kanban-card-lead-2")).toBeTruthy();
    });

    // Lead 1 is assigned to user-rep-1 -> draggable
    const lead1Card = screen.getByTestId("kanban-card-lead-1");
    expect(lead1Card.getAttribute("draggable")).toBe("true");
    expect(screen.getByTestId("move-stage-btn-lead-1")).toBeTruthy();

    // Lead 2 is assigned to user-rep-2 -> NOT draggable for user-rep-1
    const lead2Card = screen.getByTestId("kanban-card-lead-2");
    expect(lead2Card.getAttribute("draggable")).toBe("false");
    expect(screen.getByText("🔒 View only")).toBeTruthy();
    expect(screen.queryByTestId("move-stage-btn-lead-2")).toBeNull();
  });

  it("supports accessible stage transition via Move Stage button", async () => {
    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /Pipeline Kanban/i }));

    await waitFor(() => {
      expect(screen.getByTestId("move-stage-btn-lead-1")).toBeTruthy();
    });

    // Click Move Stage button
    fireEvent.click(screen.getByTestId("move-stage-btn-lead-1"));

    // Modal opens with accessible stage selector
    await waitFor(() => {
      expect(screen.getByText("Change Lead Stage")).toBeTruthy();
      expect(screen.getByLabelText(/Select New Stage \*/i)).toBeTruthy();
    });
  });

  it("maintains seamless switching between Kanban and Leads list view without regression", async () => {
    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    // Starts on leads table
    expect(screen.getByRole("button", { name: /^All Leads$/i })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("LD-2026-001")).toBeTruthy();
    });

    // Switch to Kanban
    fireEvent.click(screen.getByRole("button", { name: /Pipeline Kanban/i }));
    await waitFor(() => {
      expect(screen.getByTestId("kanban-board")).toBeTruthy();
    });

    // Switch back to All Leads
    fireEvent.click(screen.getByRole("button", { name: /^All Leads$/i }));
    await waitFor(() => {
      expect(screen.getByText("LD-2026-001")).toBeTruthy();
      expect(screen.queryByTestId("kanban-board")).toBeNull();
    });
  });
});
