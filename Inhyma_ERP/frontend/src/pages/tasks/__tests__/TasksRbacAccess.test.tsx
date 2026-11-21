import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TasksPage } from "../TasksPage";
import { tasksApi } from "@/lib/tasksApi";
import {
  DEPRECATED_PERMISSION_CODES,
  filterActivePermissions,
  friendlyPermissionLabel,
  groupPermissionsByModule,
} from "@/lib/permissionLabels";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

vi.mock("@/lib/tasksApi", () => ({
  tasksApi: {
    getTasks: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 }),
    getAvailableAssignees: vi.fn().mockResolvedValue([]),
    fetchTaskDepartments: vi.fn().mockResolvedValue([]),
    fetchLabels: vi.fn().mockResolvedValue([]),
    fetchSavedFilters: vi.fn().mockResolvedValue([]),
    fetchSprints: vi.fn().mockResolvedValue([]),
    checkTaskDeadlines: vi.fn().mockResolvedValue({ notifications_sent: 0 }),
    updateTask: vi.fn().mockResolvedValue({ id: "t-1", status: "DONE" }),
  },
}));

vi.mock("@/lib/api", () => ({
  API_BASE: "http://localhost:8002/api/v1",
  apiGet: vi.fn().mockResolvedValue({ data: [] }),
  apiPost: vi.fn().mockResolvedValue({ data: {} }),
  apiPatch: vi.fn().mockResolvedValue({ data: {} }),
}));

vi.mock("@/lib/live/liveClient", () => ({
  liveClient: {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onEvent: () => () => {},
  },
}));

const mockHasPermission = vi.hoisted(() => vi.fn());
const mockIsSuperAdmin = vi.hoisted(() => vi.fn());

vi.mock("@/lib/hooks", () => ({
  useAuth: () => ({
    profile: { id: "u-test", username: "tester" },
    isSuperAdmin: Boolean(mockIsSuperAdmin()),
    hasPermission: (perm?: string | null) => Boolean(mockHasPermission(perm)),
  }),
}));

describe("TasksPage RBAC & Role-Based View Scope Simplification", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(tasksApi.getTasks).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 });
    vi.mocked(tasksApi.fetchTaskDepartments).mockResolvedValue([]);
    vi.mocked(tasksApi.getAvailableAssignees).mockResolvedValue([]);
  });

  it("renders Access Denied state when user lacks task.view permission", () => {
    mockIsSuperAdmin.mockReturnValue(false);
    mockHasPermission.mockReturnValue(false);

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Access Denied")).toBeDefined();
    expect(
      screen.getByText("You do not have permission to view or manage tasks. Please contact your system administrator to request access.")
    ).toBeDefined();
    expect(screen.queryByText("+ New Task")).toBeNull();
  });

  it("Employee (task.view only): shows My Tasks only, hides + New Task, Department, Organization, and Permission Scope banner", async () => {
    mockIsSuperAdmin.mockReturnValue(false);
    mockHasPermission.mockImplementation((perm?: string | null) => perm === "task.view");

    render(
      <MemoryRouter initialEntries={["/tasks"]}>
        <TasksPage />
      </MemoryRouter>
    );

    expect(screen.queryByText("Access Denied")).toBeNull();
    expect(screen.getByText("Tasks")).toBeDefined();
    expect(screen.queryByText("+ New Task")).toBeNull();

    // Only My Tasks tab (no Department, no All Tasks, no Organization, no scope switcher, no Permission Scope label)
    expect(screen.getByTestId("tasks-tab-my")).toBeDefined();
    expect(screen.queryByTestId("tasks-tab-department")).toBeNull();
    expect(screen.queryByTestId("tasks-tab-all")).toBeNull();
    expect(screen.queryByTestId("tasks-scope-switcher")).toBeNull();
    expect(screen.queryByTestId("tasks-dept-filter")).toBeNull();
    expect(screen.queryByTestId("tasks-assignee-filter")).toBeNull();
    expect(screen.queryByText(/Organization/i)).toBeNull();
    expect(screen.queryByText(/Permission Scope/i)).toBeNull();

    await waitFor(() => {
      expect(tasksApi.getTasks).toHaveBeenCalledWith(expect.objectContaining({ view: "my" }));
    });
  });

  it("Employee with obsolete task.organization_view still sees My Tasks only (legacy permission ignored)", async () => {
    mockIsSuperAdmin.mockReturnValue(false);
    mockHasPermission.mockImplementation(
      (perm?: string | null) => perm === "task.view" || perm === "task.organization_view"
    );

    render(
      <MemoryRouter initialEntries={["/tasks?tab=organization"]}>
        <TasksPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId("tasks-tab-my")).toBeDefined();
    expect(screen.queryByTestId("tasks-tab-all")).toBeNull();
    expect(screen.queryByTestId("tasks-tab-department")).toBeNull();
    expect(screen.queryByText(/Organization/i)).toBeNull();

    await waitFor(() => {
      expect(tasksApi.getTasks).toHaveBeenCalledWith(expect.objectContaining({ view: "my" }));
    });
  });

  it("renders + New Task when user has both task.view and task.create", () => {
    mockIsSuperAdmin.mockReturnValue(false);
    mockHasPermission.mockImplementation(
      (perm?: string | null) => perm === "task.view" || perm === "task.create"
    );

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>
    );

    expect(screen.queryByText("Access Denied")).toBeNull();
    expect(screen.getByText("+ New Task")).toBeDefined();
  });

  it("Department Manager (task.department_view / managed dept): shows My Tasks and Department, NO Organization, All Tasks, or Department filter", async () => {
    mockIsSuperAdmin.mockReturnValue(false);
    mockHasPermission.mockImplementation(
      (perm?: string | null) =>
        perm === "task.view" || perm === "task.department_view" || perm === "task.create"
    );
    vi.mocked(tasksApi.fetchTaskDepartments).mockResolvedValue([
      { id: "dept-ops", name: "Operations", code: "OPS", is_managed: true },
      { id: "dept-ops-sub", name: "Operations Sub", code: "OPSS", is_managed: true },
    ]);

    render(
      <MemoryRouter initialEntries={["/tasks"]}>
        <TasksPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("tasks-scope-switcher")).toBeDefined();
    });

    expect(screen.getByTestId("scope-my-btn")).toBeDefined();
    expect(screen.getByTestId("scope-dept-btn")).toBeDefined();
    expect(screen.queryByTestId("scope-all-btn")).toBeNull();
    expect(screen.getByTestId("tasks-tab-my")).toBeDefined();
    expect(screen.getByTestId("tasks-tab-department")).toBeDefined();
    expect(screen.queryByTestId("tasks-tab-all")).toBeNull();
    expect(screen.queryByText(/Organization/i)).toBeNull();
    expect(screen.queryByText(/Permission Scope/i)).toBeNull();

    // My Tasks: NO Department filter and NO Assignee filter in DOM
    expect(screen.queryByTestId("tasks-dept-filter")).toBeNull();
    expect(screen.queryByTestId("tasks-assignee-filter")).toBeNull();

    // Switching to Department scope queries backend with view: "department" and STILL has NO Department dropdown
    fireEvent.click(screen.getByTestId("scope-dept-btn"));
    await waitFor(() => {
      expect(tasksApi.getTasks).toHaveBeenCalledWith(expect.objectContaining({ view: "department" }));
    });
    expect(screen.queryByTestId("tasks-dept-filter")).toBeNull();
    expect(screen.getByTestId("tasks-assignee-filter")).toBeDefined();
  });

  it("Admin (Super Admin): defaults to All Tasks with Department filter, and switching to My Tasks removes Department filter from DOM", async () => {
    mockIsSuperAdmin.mockReturnValue(true);
    mockHasPermission.mockReturnValue(false);
    vi.mocked(tasksApi.fetchTaskDepartments).mockResolvedValue([
      { id: "dept-ops", name: "Operations", code: "OPS", is_managed: true },
      { id: "dept-sales", name: "Sales", code: "SLS", is_managed: true },
    ]);

    render(
      <MemoryRouter initialEntries={["/tasks"]}>
        <TasksPage />
      </MemoryRouter>
    );

    expect(screen.queryByText("Access Denied")).toBeNull();
    expect(screen.getByText("+ New Task")).toBeDefined();
    expect(screen.getByTestId("tasks-tab-all")).toBeDefined();
    expect(screen.getByTestId("tasks-tab-my")).toBeDefined();
    expect(screen.queryByTestId("tasks-tab-department")).toBeNull();
    expect(screen.getByTestId("scope-all-btn")).toBeDefined();
    expect(screen.getByTestId("scope-my-btn")).toBeDefined();
    expect(screen.queryByTestId("scope-dept-btn")).toBeNull();
    expect(screen.getByTestId("tasks-dept-filter")).toBeDefined();
    expect(screen.getByTestId("tasks-assignee-filter")).toBeDefined();
    expect(screen.queryByText(/Organization/i)).toBeNull();
    expect(screen.queryByText(/Permission Scope/i)).toBeNull();

    await waitFor(() => {
      expect(tasksApi.getTasks).toHaveBeenCalledWith(expect.objectContaining({ view: "all" }));
    });

    // Switch to My Tasks -> Department filter & Assignee filter MUST be conditionally removed from DOM
    fireEvent.click(screen.getByTestId("scope-my-btn"));
    await waitFor(() => {
      expect(tasksApi.getTasks).toHaveBeenCalledWith(expect.objectContaining({ view: "my" }));
    });
    expect(screen.queryByTestId("tasks-dept-filter")).toBeNull();
    expect(screen.queryByTestId("tasks-assignee-filter")).toBeNull();

    // Switch back to All Tasks -> Department filter returns
    fireEvent.click(screen.getByTestId("scope-all-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("tasks-dept-filter")).toBeDefined();
    });
  });

  it("Admin-approved read-only user (task.all_view without task.manage): All Tasks has Department filter, My Tasks hides it, and NO create/manage actions", async () => {
    mockIsSuperAdmin.mockReturnValue(false);
    mockHasPermission.mockImplementation(
      (perm?: string | null) => perm === "task.view" || perm === "task.all_view"
    );
    vi.mocked(tasksApi.fetchTaskDepartments).mockResolvedValue([
      { id: "dept-ops", name: "Operations", code: "OPS", is_managed: true },
      { id: "dept-sales", name: "Sales", code: "SLS", is_managed: true },
    ]);
    vi.mocked(tasksApi.getTasks).mockResolvedValue({
      items: [
        {
          id: "t-foreign",
          title: "Sales Confidential Task",
          status: "TODO",
          priority: "HIGH",
          issue_type: "TASK",
          created_by: "u-other-manager",
          assignees: [{ user_id: "u-other-emp", assignment_role: "ASSIGNEE", user: { id: "u-other-emp", full_name: "Other Emp" } }],
          labels: [],
          subtask_total: 0,
          subtask_completed: 0,
          created_at: "2026-11-19T00:00:00Z",
          updated_at: "2026-11-19T00:00:00Z",
        } as any,
      ],
      total: 1,
      page: 1,
      page_size: 20,
    });

    render(
      <MemoryRouter initialEntries={["/tasks"]}>
        <TasksPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId("tasks-tab-all")).toBeDefined();
    expect(screen.getByTestId("tasks-tab-my")).toBeDefined();
    expect(screen.getByTestId("tasks-dept-filter")).toBeDefined();
    expect(screen.queryByText("+ New Task")).toBeNull();
    expect(screen.queryByText(/Organization/i)).toBeNull();
    expect(screen.queryByText(/Permission Scope/i)).toBeNull();

    await waitFor(() => {
      expect(screen.getByText("Sales Confidential Task")).toBeDefined();
    });
    // Read-only task.all_view user does NOT get Mark as Completed / Delete / Escalate on foreign task
    expect(screen.queryByTitle("Mark as Completed")).toBeNull();
    expect(screen.queryByTitle("Delete Task")).toBeNull();
    expect(screen.queryByTitle("Escalate Task")).toBeNull();

    // Switching to My Tasks removes Department filter from DOM
    fireEvent.click(screen.getByTestId("scope-my-btn"));
    await waitFor(() => {
      expect(tasksApi.getTasks).toHaveBeenCalledWith(expect.objectContaining({ view: "my" }));
    });
    expect(screen.queryByTestId("tasks-dept-filter")).toBeNull();
  });

  it("Admin-approved user with task.manage: receives All Tasks view with Department filter and hides it in My Tasks", async () => {
    mockIsSuperAdmin.mockReturnValue(false);
    mockHasPermission.mockImplementation(
      (perm?: string | null) => perm === "task.view" || perm === "task.manage"
    );
    vi.mocked(tasksApi.fetchTaskDepartments).mockResolvedValue([
      { id: "dept-ops", name: "Operations", code: "OPS", is_managed: true },
      { id: "dept-sales", name: "Sales", code: "SLS", is_managed: true },
    ]);

    render(
      <MemoryRouter initialEntries={["/tasks"]}>
        <TasksPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId("tasks-tab-all")).toBeDefined();
    expect(screen.getByTestId("tasks-tab-my")).toBeDefined();
    expect(screen.getByTestId("tasks-dept-filter")).toBeDefined();
    expect(screen.getByText("+ New Task")).toBeDefined();
    expect(screen.queryByText(/Organization/i)).toBeNull();
    expect(screen.queryByText(/Permission Scope/i)).toBeNull();

    await waitFor(() => {
      expect(tasksApi.getTasks).toHaveBeenCalledWith(expect.objectContaining({ view: "all" }));
    });

    fireEvent.click(screen.getByTestId("scope-my-btn"));
    expect(screen.queryByTestId("tasks-dept-filter")).toBeNull();
  });

  it("Permission labels & grouping exclude obsolete task.organization_view and expose task.all_view", () => {
    expect(DEPRECATED_PERMISSION_CODES.has("task.organization_view")).toBe(true);
    expect(friendlyPermissionLabel("task.all_view")).toBe("All Tasks View (Read-Only)");

    const rawCatalog: any[] = [
      { id: "1", code: "task.view", module: "task", description: "View own tasks" },
      { id: "2", code: "task.department_view", module: "task", description: "Dept view" },
      { id: "3", code: "task.all_view", module: "task", description: "All view" },
      { id: "4", code: "task.organization_view", module: "task", description: "Obsolete" },
      { id: "5", code: "task.manage", module: "task", description: "Manage tasks" },
    ];

    const active = filterActivePermissions(rawCatalog);
    expect(active.map((p) => p.code)).not.toContain("task.organization_view");
    expect(active.map((p) => p.code)).toContain("task.all_view");

    const grouped = groupPermissionsByModule(rawCatalog);
    expect(grouped.task.map((p) => p.code)).not.toContain("task.organization_view");
    expect(grouped.task.map((p) => p.code)).toContain("task.all_view");
  });
});
