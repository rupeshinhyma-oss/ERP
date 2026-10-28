import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TasksPage } from "../TasksPage";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

// Mock TaskDrawer so we can inspect its props directly
vi.mock("../TaskDrawer", () => ({
  TaskDrawer: ({ taskId, isOpen, onClose }: any) =>
    isOpen ? (
      <div data-testid="mock-task-drawer" data-task-id={taskId}>
        <span>Task Drawer for {taskId}</span>
        <button data-testid="mock-close-drawer" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null,
}));

vi.mock("@/lib/tasksApi", () => ({
  tasksApi: {
    getTasks: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 50 }),
    getAvailableAssignees: vi.fn().mockResolvedValue([
      { id: "u-1", name: "Admin", department: "Management", email: "admin@example.com" },
    ]),
    fetchTaskDepartments: vi.fn().mockResolvedValue([]),
    fetchLabels: vi.fn().mockResolvedValue([]),
    fetchSavedFilters: vi.fn().mockResolvedValue([]),
    fetchSprints: vi.fn().mockResolvedValue([]),
    checkTaskDeadlines: vi.fn().mockResolvedValue({ notifications_sent: 0 }),
    updateTask: vi.fn().mockResolvedValue({ id: "t-1", status: "DONE" }),
  },
}));

vi.mock("@/lib/hooks", () => ({
  useAuth: () => ({
    profile: { id: "u-1", username: "admin", roles: ["admin"] },
    isSuperAdmin: true,
    hasPermission: () => true,
  }),
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

describe("TasksPage Deep-Linking (/tasks?id, ?taskId, ?task_id)", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens TaskDrawer when ?id=task-123 is provided", () => {
    render(
      <MemoryRouter initialEntries={["/tasks?id=task-123"]}>
        <TasksPage />
      </MemoryRouter>
    );

    const drawer = screen.getByTestId("mock-task-drawer");
    expect(drawer).toBeDefined();
    expect(drawer.getAttribute("data-task-id")).toBe("task-123");
  });

  it("opens TaskDrawer when ?taskId=task-456 is provided", () => {
    render(
      <MemoryRouter initialEntries={["/tasks?taskId=task-456"]}>
        <TasksPage />
      </MemoryRouter>
    );

    const drawer = screen.getByTestId("mock-task-drawer");
    expect(drawer).toBeDefined();
    expect(drawer.getAttribute("data-task-id")).toBe("task-456");
  });

  it("opens TaskDrawer when ?task_id=task-789 is provided (compatibility format)", () => {
    render(
      <MemoryRouter initialEntries={["/tasks?task_id=task-789"]}>
        <TasksPage />
      </MemoryRouter>
    );

    const drawer = screen.getByTestId("mock-task-drawer");
    expect(drawer).toBeDefined();
    expect(drawer.getAttribute("data-task-id")).toBe("task-789");
  });

  it("respects parameter precedence (taskId > id > task_id)", () => {
    // When taskId and id and task_id are all present
    const { unmount } = render(
      <MemoryRouter initialEntries={["/tasks?taskId=p-taskid&id=p-id&task_id=p-task_id"]}>
        <TasksPage />
      </MemoryRouter>
    );

    let drawer = screen.getByTestId("mock-task-drawer");
    expect(drawer.getAttribute("data-task-id")).toBe("p-taskid");
    unmount();

    // When id and task_id are present (taskId absent)
    render(
      <MemoryRouter initialEntries={["/tasks?id=p-id&task_id=p-task_id"]}>
        <TasksPage />
      </MemoryRouter>
    );

    drawer = screen.getByTestId("mock-task-drawer");
    expect(drawer.getAttribute("data-task-id")).toBe("p-id");
  });

  it("does not open TaskDrawer when no task ID query param is present", () => {
    render(
      <MemoryRouter initialEntries={["/tasks"]}>
        <TasksPage />
      </MemoryRouter>
    );

    expect(screen.queryByTestId("mock-task-drawer")).toBeNull();
  });

  it("allows closing the TaskDrawer", () => {
    render(
      <MemoryRouter initialEntries={["/tasks?task_id=task-close-test"]}>
        <TasksPage />
      </MemoryRouter>
    );

    const drawer = screen.getByTestId("mock-task-drawer");
    expect(drawer).toBeDefined();

    const closeBtn = screen.getByTestId("mock-close-drawer");
    fireEvent.click(closeBtn);

    expect(screen.queryByTestId("mock-task-drawer")).toBeNull();
  });
});
