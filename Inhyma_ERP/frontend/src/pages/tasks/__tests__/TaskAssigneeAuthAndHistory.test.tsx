import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { TaskDrawer } from "../TaskDrawer";
import { RecurringTasksTab } from "../RecurringTasksTab";
import { BulkActionBar } from "@/components/BulkActionBar";
import { tasksApi } from "@/lib/tasksApi";
import type { AvailableUser, TaskDetail, TaskRecurringSchedule } from "@/types/tasks";

const mockAuthState = {
  profile: { id: "emp-a", username: "empa", display_name: "Employee A" },
  isSuperAdmin: false,
  permissions: new Set<string>(["task.view", "task.create", "task.assign", "task.escalate"]),
};

vi.mock("@/lib/hooks", () => ({
  useAuth: () => ({
    profile: mockAuthState.profile,
    isSuperAdmin: mockAuthState.isSuperAdmin,
    hasPermission: (perm: string) => mockAuthState.isSuperAdmin || mockAuthState.permissions.has(perm),
  }),
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: [] }),
}));

vi.mock("@/lib/tasksApi", () => ({
  tasksApi: {
    getTask: vi.fn(),
    getTasks: vi.fn(),
    updateTask: vi.fn(),
    assignTask: vi.fn(),
    addComment: vi.fn(),
    fetchTaskTimeline: vi.fn(),
    getAvailableAssignees: vi.fn(),
    fetchLabels: vi.fn(),
    fetchSprints: vi.fn(),
    fetchTaskDepartments: vi.fn(),
    fetchRecurringSchedules: vi.fn(),
    fetchRecurringInstances: vi.fn(),
    previewRecurrence: vi.fn(),
    updateRecurringSchedule: vi.fn(),
    pauseRecurringSchedule: vi.fn(),
    resumeRecurringSchedule: vi.fn(),
    archiveRecurringSchedule: vi.fn(),
    unarchiveRecurringSchedule: vi.fn(),
    deleteRecurringSchedule: vi.fn(),
    generateRecurringTasks: vi.fn(),
  },
}));

const USERS: AvailableUser[] = [
  { id: "admin-1", full_name: "Admin User", department: "Management" },
  { id: "emp-a", full_name: "Employee A", department: "Operations" },
  { id: "emp-b", full_name: "Employee B", department: "Operations" },
];

const BASE_TASK: TaskDetail = {
  id: "task-100",
  title: "Task T-100 Compliance Review",
  description: "Complete quarterly compliance checks",
  priority: "HIGH",
  status: "TODO",
  issue_type: "TASK",
  created_by: "admin-1",
  creator: { id: "admin-1", full_name: "Admin User" },
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-01T10:00:00Z",
  version: 1,
  assignees: [
    {
      id: "asgn-1",
      task_id: "task-100",
      user_id: "emp-a",
      assignment_role: "ASSIGNEE",
      created_at: "2026-11-01T10:00:00Z",
      user: { id: "emp-a", full_name: "Employee A" },
    },
  ],
  subtasks: [],
  comments: [],
  escalations: [],
  attachments: [],
  voice_notes: [],
  labels: [],
  dependencies: [],
  reactions: [],
  can_change_assignee: false,
  is_previously_assigned: false,
  assignment_history: [
    {
      id: "hist-1",
      task_id: "task-100",
      user_id: "emp-a",
      assignment_role: "ASSIGNEE",
      assigned_by: "admin-1",
      assigned_at: "2026-11-01T10:00:00Z",
      unassigned_at: null,
      source: "TASK_CREATE",
      user: { id: "emp-a", full_name: "Employee A" },
      assigned_by_user: { id: "admin-1", full_name: "Admin User" },
    },
  ],
};

describe("Enterprise Tasks — Assignee Authorization & Previous Assignee History UI", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.profile = { id: "emp-a", username: "empa", display_name: "Employee A" };
    mockAuthState.isSuperAdmin = false;
    mockAuthState.permissions = new Set(["task.view", "task.create", "task.assign", "task.escalate"]);

    (tasksApi.getAvailableAssignees as any).mockResolvedValue(USERS);
    (tasksApi.fetchLabels as any).mockResolvedValue([]);
    (tasksApi.fetchSprints as any).mockResolvedValue([]);
    (tasksApi.getTasks as any).mockResolvedValue({ items: [] });
    (tasksApi.fetchTaskDepartments as any).mockResolvedValue([]);
    (tasksApi.fetchTaskTimeline as any).mockResolvedValue([
      {
        id: "evt-1",
        timestamp: "2026-11-01T10:00:00Z",
        actor_name: "Admin User",
        event_type: "USER_ASSIGNED",
        description: "Assigned Employee A as Assignee",
      },
    ]);
    (tasksApi.previewRecurrence as any).mockResolvedValue({
      frequency: "MONTHLY",
      next_period: "2026-12",
      next_due_date: "2026-12-28",
      explanation: "Monthly on day 28",
    });
  });

  it("hides assignee edit controls for assigned employee while preserving status and comment editing", async () => {
    (tasksApi.getTask as any).mockResolvedValue(BASE_TASK);

    render(
      <TaskDrawer
        taskId="task-100"
        isOpen={true}
        onClose={vi.fn()}
        onTaskUpdated={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Task T-100 Compliance Review")).toBeDefined();
    });

    // Assignee edit controls MUST NOT be rendered for assigned employee
    expect(screen.queryByTestId("add-assignee-btn")).toBeNull();
    expect(screen.queryByTestId("remove-assignee-emp-a")).toBeNull();

    // Status selector MUST remain enabled so employee can perform normal status updates
    const statusSelects = screen.getAllByRole("combobox");
    const statusSelect = statusSelects.find(
      (el) => (el as HTMLSelectElement).value === "TODO"
    ) as HTMLSelectElement | undefined;
    expect(statusSelect).toBeDefined();
    expect(statusSelect?.disabled).toBe(false);
  });

  it("shows assignee edit controls and assignment history for authorized creator / admin", async () => {
    mockAuthState.profile = { id: "admin-1", username: "admin", display_name: "Admin User" };
    mockAuthState.isSuperAdmin = true;
    (tasksApi.getTask as any).mockResolvedValue({
      ...BASE_TASK,
      can_change_assignee: true,
    });

    render(
      <TaskDrawer
        taskId="task-100"
        isOpen={true}
        onClose={vi.fn()}
        onTaskUpdated={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("add-assignee-btn")).toBeDefined();
    });
    expect(screen.getByTestId("remove-assignee-emp-a")).toBeDefined();
    expect(screen.getByTestId("task-assignment-history")).toBeDefined();
  });

  it("displays read-only previously assigned banner and history after reassignment to Employee B", async () => {
    const reassignedTask: TaskDetail = {
      ...BASE_TASK,
      assignees: [
        {
          id: "asgn-2",
          task_id: "task-100",
          user_id: "emp-b",
          assignment_role: "ASSIGNEE",
          created_at: "2026-11-05T12:00:00Z",
          user: { id: "emp-b", full_name: "Employee B" },
        },
      ],
      can_change_assignee: false,
      is_previously_assigned: true,
      reassigned_at: "2026-11-05T12:00:00Z",
      reassigned_by_name: "Admin User",
      assignment_history: [
        {
          id: "hist-1",
          task_id: "task-100",
          user_id: "emp-a",
          assignment_role: "ASSIGNEE",
          assigned_by: "admin-1",
          assigned_at: "2026-11-01T10:00:00Z",
          unassigned_at: "2026-11-05T12:00:00Z",
          unassigned_by: "admin-1",
          reassigned_to_user_id: "emp-b",
          source: "TASK_ASSIGN",
          user: { id: "emp-a", full_name: "Employee A" },
          reassigned_to_user: { id: "emp-b", full_name: "Employee B" },
        },
        {
          id: "hist-2",
          task_id: "task-100",
          user_id: "emp-b",
          assignment_role: "ASSIGNEE",
          assigned_by: "admin-1",
          assigned_at: "2026-11-05T12:00:00Z",
          unassigned_at: null,
          source: "TASK_ASSIGN",
          user: { id: "emp-b", full_name: "Employee B" },
        },
      ],
    };
    (tasksApi.getTask as any).mockResolvedValue(reassignedTask);

    render(
      <TaskDrawer
        taskId="task-100"
        isOpen={true}
        onClose={vi.fn()}
        onTaskUpdated={vi.fn()}
        onEscalateRequest={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("previously-assigned-banner")).toBeDefined();
    });
    expect(screen.getByTestId("task-drawer-readonly-badge")).toBeDefined();
    expect(screen.getByTestId("task-assignment-history")).toBeDefined();
    expect(screen.queryByTestId("add-assignee-btn")).toBeNull();
    expect(screen.queryByText(/⚡ Escalate/i)).toBeNull();
    expect(screen.getByText(/reassigned to Employee B/i)).toBeDefined();
  });

  it("hides BulkActionBar Assign dropdown when canAssign is false", () => {
    const { rerender } = render(
      <BulkActionBar
        selectedTaskIds={["task-100"]}
        onClearSelection={vi.fn()}
        onExecuteBulkAction={vi.fn()}
        availableUsers={USERS}
        availableLabels={[]}
        availableSprints={[]}
        canAssign={false}
      />
    );
    expect(screen.queryByText("Assign to...")).toBeNull();

    rerender(
      <BulkActionBar
        selectedTaskIds={["task-100"]}
        onClearSelection={vi.fn()}
        onExecuteBulkAction={vi.fn()}
        availableUsers={USERS}
        availableLabels={[]}
        availableSprints={[]}
        canAssign={true}
      />
    );
    expect(screen.getByText("Assign to...")).toBeDefined();
  });

  it("opens recurring schedule in read-only mode with disabled assignee selector for assigned employee", async () => {
    const mockSchedule: TaskRecurringSchedule = {
      id: "sch-100",
      title: "Monthly Audit",
      description: "Monthly compliance run",
      department: "Operations",
      assignee_id: "emp-a",
      manager_id: "admin-1",
      created_by: "admin-1",
      priority: "HIGH",
      issue_type: "TASK",
      frequency: "MONTHLY",
      recurrence_config: { day_type: "SPECIFIC_DAY", day_of_month: 28 },
      reminder_lead_days: 3,
      escalation_timing_type: "ON_DUE_DATE",
      escalation_offset_days: 0,
      escalation_repeat_interval_days: 7,
      status: "ACTIVE",
      effective_start_date: "2026-11-01",
      effective_end_date: null,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
      can_manage_schedule: false,
      assignment_history: [
        {
          id: "sh-1",
          recurring_schedule_id: "sch-100",
          user_id: "emp-a",
          assignment_role: "ASSIGNEE",
          assigned_by: "admin-1",
          assigned_at: "2026-11-01T00:00:00Z",
          unassigned_at: null,
          source: "RECURRING_CREATE",
          user: { id: "emp-a", full_name: "Employee A" },
        },
      ],
    };

    (tasksApi.fetchRecurringSchedules as any).mockResolvedValue([mockSchedule]);

    render(
      <RecurringTasksTab
        onSelectTask={vi.fn()}
        availableUsers={USERS}
        canManageTasks={false}
        canCreateSchedule={true}
        currentUserId="emp-a"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Monthly Audit")).toBeDefined();
    });

    // Assigned employee must NOT see Pause, Archive, Delete, or Run Generator Now
    expect(screen.queryByTitle("Pause schedule")).toBeNull();
    expect(screen.queryByTitle("Delete schedule")).toBeNull();
    expect(screen.queryByText(/Run Generator Now/i)).toBeNull();

    // Clicking View opens modal in read-only mode
    fireEvent.click(screen.getByTitle("View schedule"));

    await waitFor(() => {
      expect(screen.getByTestId("recurring-readonly-banner")).toBeDefined();
    });
    const assigneeSelect = screen.getByLabelText("Assigned Employee") as HTMLSelectElement;
    expect(assigneeSelect.disabled).toBe(true);
    expect(screen.queryByText("Save Changes")).toBeNull();
    expect(screen.getByTestId("recurring-assignment-history")).toBeDefined();
  });
});
