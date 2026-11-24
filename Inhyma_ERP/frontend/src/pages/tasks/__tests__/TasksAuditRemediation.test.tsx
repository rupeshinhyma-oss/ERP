import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TaskDrawer } from "../TaskDrawer";
import { TasksPage } from "../TasksPage";
import { RecurringTasksTab } from "../RecurringTasksTab";
import { tasksApi } from "@/lib/tasksApi";

const mockAuthState = {
  isSuperAdmin: false,
  permissions: [] as string[],
  profile: { id: "u-current", full_name: "Current User" },
};

vi.mock("@/lib/hooks", () => ({
  useAuth: () => ({
    hasPermission: (p: string) => mockAuthState.isSuperAdmin || mockAuthState.permissions.includes(p),
    isSuperAdmin: mockAuthState.isSuperAdmin,
    profile: mockAuthState.profile,
  }),
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

vi.mock("@/lib/live/liveClient", () => ({
  liveClient: {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onEvent: () => () => {},
  },
}));

vi.mock("@/lib/useRealtimeEvents", () => ({
  useRealtimeEvents: () => {},
}));

vi.mock("@/lib/tasksApi", () => ({
  tasksApi: {
    getTasks: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 }),
    getTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    assignTask: vi.fn(),
    getAvailableAssignees: vi.fn().mockResolvedValue([
      { id: "u-mgr", full_name: "Ops Manager", display_name: "Ops Manager", department: "Operations" },
      { id: "u-creator", full_name: "Task Creator", display_name: "Task Creator", department: "Operations" },
    ]),
    fetchTaskDepartments: vi.fn().mockResolvedValue([]),
    fetchLabels: vi.fn().mockResolvedValue([]),
    fetchSprints: vi.fn().mockResolvedValue([]),
    fetchSavedFilters: vi.fn().mockResolvedValue([]),
    fetchTaskTimeline: vi.fn().mockResolvedValue([]),
    checkTaskDeadlines: vi.fn().mockResolvedValue({ notifications_sent: 0 }),
    submitTaskForApproval: vi.fn(),
    actionTaskApproval: vi.fn(),
    toggleTaskReaction: vi.fn(),
    toggleCommentReaction: vi.fn(),
    fetchRecurringSchedules: vi.fn().mockResolvedValue([]),
    fetchRecurringInstances: vi.fn().mockResolvedValue([]),
  },
}));

describe("Enterprise Tasks Audit Remediation UI Tests (BUG-12, BUG-16, BUG-17, BUG-18)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.isSuperAdmin = false;
    mockAuthState.permissions = [];
    mockAuthState.profile = { id: "u-current", full_name: "Current User" };
  });

  afterEach(() => {
    cleanup();
  });

  it("BUG-12: TaskDrawer displays Pending Approval accurately and restricts Approve/Reject to designated non-creator approver", async () => {
    const pendingTask: any = {
      id: "task-appr-1",
      title: "Approval Workflow Task",
      description: "Needs sign-off",
      priority: "HIGH",
      status: "PENDING_APPROVAL",
      issue_type: "TASK",
      approval_status: "PENDING_APPROVAL",
      approver_id: "u-mgr",
      approver: { id: "u-mgr", full_name: "Ops Manager" },
      approval_notes: "Please review Q4 numbers",
      created_by: "u-creator",
      creator: { id: "u-creator", full_name: "Task Creator" },
      created_at: "2026-11-19T10:00:00Z",
      updated_at: "2026-11-19T10:00:00Z",
      version: 2,
      assignees: [{ id: "a1", task_id: "task-appr-1", user_id: "u-creator", assignment_role: "ASSIGNEE" }],
      subtasks: [],
      comments: [],
      escalations: [],
      attachments: [],
      voice_notes: [],
      labels: [],
      dependencies: [],
      reactions: [],
      child_tasks: [],
      progress_percent: 0,
    };

    vi.mocked(tasksApi.getTask).mockResolvedValue(pendingTask);
    vi.mocked(tasksApi.actionTaskApproval).mockResolvedValue({
      ...pendingTask,
      status: "DONE",
      approval_status: "APPROVED",
      version: 3,
    });

    // 1. Creator opens PENDING_APPROVAL task -> sees "Pending Approval", CANNOT see Approve/Reject buttons (anti-self-approval)
    mockAuthState.profile = { id: "u-creator", full_name: "Task Creator" };
    mockAuthState.permissions = ["task.view", "task.create"];
    const { unmount } = render(
      <TaskDrawer taskId="task-appr-1" isOpen={true} onClose={vi.fn()} onTaskUpdated={vi.fn()} />
    );

    await waitFor(() => expect(screen.getByTestId("task-approval-banner")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Approve/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reject/i })).toBeNull();
    // Status select value must be PENDING_APPROVAL (NOT silently To Do)
    const statusSelect = screen.getByDisplayValue(/Pending Approval/i) as HTMLSelectElement;
    expect(statusSelect.value).toBe("PENDING_APPROVAL");
    unmount();

    // 2. Designated approver (u-mgr) opens task -> sees Approve & Reject and clicking Approve submits { approved: true }
    mockAuthState.profile = { id: "u-mgr", full_name: "Ops Manager" };
    mockAuthState.permissions = ["task.view", "task.department_view"];
    render(<TaskDrawer taskId="task-appr-1" isOpen={true} onClose={vi.fn()} onTaskUpdated={vi.fn()} />);

    const approveBtn = await screen.findByRole("button", { name: /Approve/i });
    expect(screen.getByRole("button", { name: /Reject/i })).toBeTruthy();
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(tasksApi.actionTaskApproval).toHaveBeenCalledWith("task-appr-1", {
        approved: true,
        notes: undefined,
      });
    });
  });

  it("BUG-16: Read-only task.all_view viewer sees Read-Only badge and all edit/collaboration controls disabled or hidden", async () => {
    mockAuthState.profile = { id: "u-readonly-av", full_name: "Read Only Viewer" };
    mockAuthState.permissions = ["task.view", "task.all_view"];

    vi.mocked(tasksApi.getTask).mockResolvedValue({
      id: "task-foreign-1",
      title: "Foreign Sales Task",
      description: "Read-only content",
      priority: "MEDIUM",
      status: "IN_PROGRESS",
      issue_type: "TASK",
      approval_status: "NOT_REQUIRED",
      created_by: "u-sales-mgr",
      creator: { id: "u-sales-mgr", full_name: "Sales Manager" },
      created_at: "2026-11-19T10:00:00Z",
      updated_at: "2026-11-19T10:00:00Z",
      version: 1,
      assignees: [{ id: "a1", task_id: "task-foreign-1", user_id: "u-sales-emp", assignment_role: "ASSIGNEE" }],
      subtasks: [],
      comments: [],
      escalations: [],
      attachments: [],
      voice_notes: [],
      labels: [],
      dependencies: [],
      reactions: [{ emoji: "👍", count: 1, user_ids: ["u-sales-emp"], has_reacted: false }],
      child_tasks: [],
      progress_percent: 0,
    } as any);

    render(<TaskDrawer taskId="task-foreign-1" isOpen={true} onClose={vi.fn()} onTaskUpdated={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("task-drawer-readonly-badge")).toBeTruthy());
    expect(screen.queryByText(/\+ Add Watcher/i)).toBeNull();
    expect(screen.queryByText(/\+ Add Files/i)).toBeNull();
    expect(screen.queryByText(/Record Voice Note/i)).toBeNull();
    expect(screen.queryByTitle("Add reaction")).toBeNull();

    // All selects and date inputs in drawer are disabled
    const statusSelect = screen.getByDisplayValue("In Progress") as HTMLSelectElement;
    expect(statusSelect.disabled).toBe(true);
    const prioritySelect = screen.getByDisplayValue("Medium") as HTMLSelectElement;
    expect(prioritySelect.disabled).toBe(true);

    // Switch to Comments tab -> composer replaced by read-only notice
    fireEvent.click(screen.getByRole("button", { name: /Comments/i }));
    await waitFor(() => expect(screen.getByTestId("comments-readonly-notice")).toBeTruthy());
  });

  it("BUG-17 & BUG-18: Kanban shows all 6 columns including REVIEW and PENDING_APPROVAL, displays truncation banner, hides employee bulk checkboxes", async () => {
    mockAuthState.profile = { id: "u-emp", full_name: "Plain Employee" };
    mockAuthState.permissions = ["task.view"];

    vi.mocked(tasksApi.getTasks).mockResolvedValue({
      items: [
        {
          id: "t-rev",
          title: "In Review Task",
          priority: "MEDIUM",
          status: "REVIEW",
          issue_type: "TASK",
          approval_status: "NOT_REQUIRED",
          created_by: "u-emp",
          created_at: "2026-11-19T10:00:00Z",
          updated_at: "2026-11-19T10:00:00Z",
          assignees: [{ user_id: "u-emp", assignment_role: "ASSIGNEE", user: { id: "u-emp", full_name: "Plain Employee" } }],
          labels: [],
          reactions: [],
          subtask_total: 0,
          subtask_completed: 0,
          child_task_count: 0,
          child_task_completed: 0,
          progress_percent: 0,
          comment_count: 0,
          escalation_count: 0,
          attachment_count: 0,
          voice_note_count: 0,
        },
        {
          id: "t-pend",
          title: "Pending Approval Task",
          priority: "HIGH",
          status: "PENDING_APPROVAL",
          issue_type: "TASK",
          approval_status: "PENDING_APPROVAL",
          created_by: "u-emp",
          created_at: "2026-11-19T10:00:00Z",
          updated_at: "2026-11-19T10:00:00Z",
          assignees: [{ user_id: "u-emp", assignment_role: "ASSIGNEE", user: { id: "u-emp", full_name: "Plain Employee" } }],
          labels: [],
          reactions: [],
          subtask_total: 0,
          subtask_completed: 0,
          child_task_count: 0,
          child_task_completed: 0,
          progress_percent: 0,
          comment_count: 0,
          escalation_count: 0,
          attachment_count: 0,
          voice_note_count: 0,
        },
      ] as any,
      total: 350,
      page: 1,
      page_size: 250,
    });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <MemoryRouter initialEntries={["/tasks?tab=my"]}>
          <TasksPage />
        </MemoryRouter>
      );

      await waitFor(() => expect(screen.getByText("In Review Task")).toBeTruthy());
      // BUG-18: Employee without bulk permission must NOT see row selection checkboxes
      expect(document.querySelectorAll('input[type="checkbox"]').length).toBe(0);

      // BUG-18: Zero React missing-key warnings
      const keyWarnings = consoleErrorSpy.mock.calls.filter((args) =>
        String(args[0] || "").includes('unique "key" prop')
      );
      expect(keyWarnings.length).toBe(0);

      // BUG-17: Switch to Kanban -> both REVIEW and PENDING_APPROVAL columns & cards visible + truncation banner shown
      fireEvent.click(screen.getByRole("button", { name: /Kanban/i }));
      await waitFor(() => expect(screen.getByTestId("tasks-truncation-banner")).toBeTruthy());
      expect(screen.getByText(/Showing first 2 of 350 matching tasks/i)).toBeTruthy();
      expect(screen.getByText("In Review")).toBeTruthy();
      expect(screen.getByText("Pending Approval")).toBeTruthy();
      expect(screen.getByText("In Review Task")).toBeTruthy();
      expect(screen.getByText("Pending Approval Task")).toBeTruthy();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("BUG-18: RecurringTasksTab renders backend next_run_date in NEXT DUE DATE column", async () => {
    vi.mocked(tasksApi.fetchRecurringSchedules).mockResolvedValue([
      {
        id: "sch-1",
        title: "Monthly GST Filing",
        frequency: "MONTHLY",
        recurrence_config: { day_of_month: 20 },
        priority: "HIGH",
        status: "ACTIVE",
        department: "Finance",
        next_run_date: "2026-12-20",
        effective_start_date: "2026-11-01",
        reminder_lead_days: 3,
        escalation_timing_type: "ON_DUE_DATE",
        escalation_offset_days: 0,
        escalation_repeat_interval_days: 7,
        issue_type: "TASK",
        created_at: "2026-11-01T00:00:00Z",
        updated_at: "2026-11-01T00:00:00Z",
      },
    ] as any);

    render(<RecurringTasksTab onSelectTask={vi.fn()} availableUsers={[]} canManageTasks={true} />);

    await waitFor(() => expect(screen.getByText("Monthly GST Filing")).toBeTruthy());
    expect(screen.getByText("2026-12-20")).toBeTruthy();
  });
});
