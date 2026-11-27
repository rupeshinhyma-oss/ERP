import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { EscalateTaskModal } from "../EscalateTaskModal";
import { TaskDrawer } from "../TaskDrawer";
import * as tasksApiModule from "@/lib/tasksApi";

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

vi.mock("@/lib/useRealtimeEvents", () => ({
  useRealtimeEvents: () => {},
}));

vi.mock("@/lib/tasksApi", () => ({
  escalateTask: vi.fn(),
  fetchEscalateOptions: vi.fn(),
  getAvailableAssignees: vi.fn(),
  tasksApi: {
    getTasks: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 }),
    getTask: vi.fn(),
    getAvailableAssignees: vi.fn().mockResolvedValue([]),
    fetchTaskDepartments: vi.fn().mockResolvedValue([]),
    fetchLabels: vi.fn().mockResolvedValue([]),
    fetchSprints: vi.fn().mockResolvedValue([]),
    fetchTaskTimeline: vi.fn().mockResolvedValue([]),
  },
}));

describe("EscalateTaskModal Hook-Order & Escalation Workflow Regression (NEW-BUG-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.isSuperAdmin = false;
    mockAuthState.permissions = ["task.view", "task.escalate"];
    mockAuthState.profile = { id: "u-esc", full_name: "Authorized Escalator" };

    vi.mocked(tasksApiModule.fetchEscalateOptions).mockResolvedValue({
      reporting_managers: [],
      department_managers: [
        {
          user_id: "u-ops-mgr",
          name: "Suresh OpsManager",
          email: null,
          category: "DEPARTMENT_MANAGER",
          detail: "FM_Operations",
        },
      ],
      organization_users: [
        {
          user_id: "u-sales-mgr",
          name: "Vikram SalesManager",
          email: null,
          category: "ORGANIZATION_USER",
          detail: "FM_Sales",
        },
        {
          user_id: "u-sales-emp",
          name: "Amit Salesperson",
          email: null,
          category: "ORGANIZATION_USER",
          detail: "FM_Sales",
        },
      ],
    });
    vi.mocked(tasksApiModule.getAvailableAssignees).mockResolvedValue([
      { id: "u-ops-mgr", full_name: "Suresh OpsManager", display_name: "Suresh OpsManager", department: "FM_Operations" },
      { id: "u-sales-mgr", full_name: "Vikram SalesManager", display_name: "Vikram SalesManager", department: "FM_Sales" },
    ]);
    vi.mocked(tasksApiModule.escalateTask).mockResolvedValue({ id: "esc-1" } as any);
  });

  afterEach(() => {
    cleanup();
  });

  it("mounts with isOpen=false and toggles false -> true -> false -> true without React hook-order errors", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onClose = vi.fn();
    const onSuccess = vi.fn();

    try {
      // 1. Mount with isOpen=false
      const { rerender } = render(
        <EscalateTaskModal
          taskId="task-1"
          taskTitle="Critical Delivery Task"
          isOpen={false}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      );
      expect(screen.queryByText("Escalate Task")).toBeNull();

      // 2. Rerender false -> true (previously crashed with "Rendered more hooks than during the previous render")
      rerender(
        <EscalateTaskModal
          taskId="task-1"
          taskTitle="Critical Delivery Task"
          isOpen={true}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      );
      await waitFor(() => expect(screen.getByText("Escalate Task")).toBeTruthy());
      await waitFor(() => expect(screen.getByText("Suresh OpsManager")).toBeTruthy());

      // 3. Rerender true -> false
      rerender(
        <EscalateTaskModal
          taskId="task-1"
          taskTitle="Critical Delivery Task"
          isOpen={false}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      );
      expect(screen.queryByText("Escalate Task")).toBeNull();

      // 4. Rerender false -> true again
      rerender(
        <EscalateTaskModal
          taskId="task-1"
          taskTitle="Critical Delivery Task"
          isOpen={true}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      );
      await waitFor(() => expect(screen.getByText("Escalate Task")).toBeTruthy());

      // Zero React hooks-order warnings/errors
      const hookErrors = consoleErrorSpy.mock.calls.filter((args) =>
        String(args[0] || "").toLowerCase().includes("hook")
      );
      expect(hookErrors.length).toBe(0);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("shows cross-department organization users without exposing emails and submits exactly one escalation", async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();

    const { rerender } = render(
      <EscalateTaskModal
        taskId="task-99"
        taskTitle="SLA Escalation Task"
        isOpen={false}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );
    rerender(
      <EscalateTaskModal
        taskId="task-99"
        taskTitle="SLA Escalation Task"
        isOpen={true}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    await waitFor(() => expect(screen.getByText("Suresh OpsManager")).toBeTruthy());

    // Switch to Organization User category -> cross-department Sales users available without email leakage
    fireEvent.click(screen.getByRole("button", { name: /Organization User/i }));
    const searchInput = (await waitFor(() => {
      const el = document.querySelector('input[type="text"]') as HTMLInputElement | null;
      expect(el).not.toBeNull();
      return el!;
    })) as HTMLInputElement;
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: "Sales" } });

    await waitFor(() => expect(screen.getByText("Vikram SalesManager")).toBeTruthy());
    expect(screen.getByText("Amit Salesperson")).toBeTruthy();
    expect(document.body.textContent).not.toContain("@");

    // Pick cross-department user Vikram SalesManager
    const salesMgrOption = screen.getByText("Vikram SalesManager");
    fireEvent.mouseDown(salesMgrOption);
    fireEvent.click(salesMgrOption);

    // Fill reason & SLA due date and submit
    fireEvent.change(screen.getByPlaceholderText(/Explain the blocker/i), {
      target: { value: "Blocked waiting on Sales sign-off" },
    });
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-12-15" } });

    fireEvent.click(screen.getByRole("button", { name: /Submit Escalation/i }));

    await waitFor(() => {
      expect(tasksApiModule.escalateTask).toHaveBeenCalledTimes(1);
    });
    expect(tasksApiModule.escalateTask).toHaveBeenCalledWith(
      "task-99",
      "u-sales-mgr",
      "Blocked waiting on Sales sign-off",
      "ORGANIZATION_USER",
      "2026-12-15"
    );
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides escalation controls in TaskDrawer for unauthorized users lacking task.escalate and task.manage", async () => {
    mockAuthState.isSuperAdmin = false;
    mockAuthState.permissions = ["task.view"];
    mockAuthState.profile = { id: "u-plain-emp", full_name: "Plain Employee" };

    vi.mocked(tasksApiModule.tasksApi.getTask).mockResolvedValue({
      id: "task-emp-1",
      title: "Employee Own Task",
      description: "Normal task",
      priority: "MEDIUM",
      status: "IN_PROGRESS",
      issue_type: "TASK",
      approval_status: "NOT_REQUIRED",
      created_by: "u-plain-emp",
      creator: { id: "u-plain-emp", full_name: "Plain Employee" },
      created_at: "2026-11-19T10:00:00Z",
      updated_at: "2026-11-19T10:00:00Z",
      version: 1,
      assignees: [{ id: "a1", task_id: "task-emp-1", user_id: "u-plain-emp", assignment_role: "ASSIGNEE" }],
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
    } as any);

    render(
      <TaskDrawer
        taskId="task-emp-1"
        isOpen={true}
        onClose={vi.fn()}
        onTaskUpdated={vi.fn()}
        onEscalateRequest={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText("Employee Own Task")).toBeTruthy());
    // Escalate button must NOT be shown to plain task.view employee
    expect(screen.queryByRole("button", { name: /^⚡\s*Escalate$/i })).toBeNull();
  });
});
