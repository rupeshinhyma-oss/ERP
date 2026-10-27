import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TasksPage } from "../TasksPage";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

vi.mock("@/lib/tasksApi", () => ({
  tasksApi: {
    getTasks: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 50 }),
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

describe("TasksPage RBAC Access Control", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders 🔒 Access Denied state when user lacks task.view permission", () => {
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

  it("renders Tasks view when user has task.view permission, but hides + New Task when lacking task.create", () => {
    mockIsSuperAdmin.mockReturnValue(false);
    mockHasPermission.mockImplementation((perm?: string | null) => perm === "task.view");

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>
    );

    expect(screen.queryByText("Access Denied")).toBeNull();
    expect(screen.getByText("Tasks")).toBeDefined();
    expect(screen.queryByText("+ New Task")).toBeNull();
  });

  it("renders + New Task when user has both task.view and task.create", () => {
    mockIsSuperAdmin.mockReturnValue(false);
    mockHasPermission.mockImplementation((perm?: string | null) =>
      perm === "task.view" || perm === "task.create"
    );

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>
    );

    expect(screen.queryByText("Access Denied")).toBeNull();
    expect(screen.getByText("+ New Task")).toBeDefined();
  });

  it("allows full access to Super Admin including + New Task", () => {
    mockIsSuperAdmin.mockReturnValue(true);
    mockHasPermission.mockReturnValue(false);

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>
    );

    expect(screen.queryByText("Access Denied")).toBeNull();
    expect(screen.getByText("+ New Task")).toBeDefined();
  });
});
