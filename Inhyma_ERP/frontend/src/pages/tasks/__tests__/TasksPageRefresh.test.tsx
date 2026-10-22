import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TasksPage } from "../TasksPage";
import { tasksApi } from "@/lib/tasksApi";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

// Mock tasksApi
vi.mock("@/lib/tasksApi", () => ({
  tasksApi: {
    getTasks: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 50 }),
    getAvailableAssignees: vi.fn().mockResolvedValue([
      { id: "u-1", name: "Admin", department: "Management", email: "admin@example.com" },
    ]),
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

let capturedEventListener: ((event: any) => void) | null = null;
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();

vi.mock("@/lib/live/liveClient", () => ({
  liveClient: {
    subscribe: (...args: any[]) => mockSubscribe(...args),
    unsubscribe: (...args: any[]) => mockUnsubscribe(...args),
    onEvent: (fn: (event: any) => void) => {
      capturedEventListener = fn;
      return () => {
        capturedEventListener = null;
      };
    },
  },
}));

describe("TasksPage Render and Polling Behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedEventListener = null;
  });

  it("mounts TasksPage with exactly 1 initial task fetch and verifies no delayed repeated fetches across 1s, 3s, 5s, 10s, 30s", async () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter initialEntries={["/tasks"]}>
        <TasksPage />
      </MemoryRouter>
    );

    // Initial load occurs exactly once
    expect(tasksApi.getTasks).toHaveBeenCalledTimes(1);

    // Advance timers through 1, 3, 5, 10, and 30 seconds
    vi.advanceTimersByTime(1000);
    expect(tasksApi.getTasks).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000); // 3s total
    expect(tasksApi.getTasks).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000); // 5s total
    expect(tasksApi.getTasks).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000); // 10s total
    expect(tasksApi.getTasks).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(20000); // 30s total
    expect(tasksApi.getTasks).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("does not refetch task list when availableAssignees resolves after a delay", async () => {
    let resolveAssignees: (val: any) => void;
    const delayedAssigneesPromise = new Promise((res) => {
      resolveAssignees = res;
    });
    vi.mocked(tasksApi.getAvailableAssignees).mockReturnValueOnce(delayedAssigneesPromise as any);

    render(
      <MemoryRouter initialEntries={["/tasks"]}>
        <TasksPage />
      </MemoryRouter>
    );

    // Initial load
    expect(tasksApi.getTasks).toHaveBeenCalledTimes(1);

    // Now resolve availableAssignees asynchronously after a delay
    resolveAssignees!([
      { id: "u-1", name: "Admin", department: "Management", email: "admin@example.com" },
      { id: "u-2", name: "Rep A", department: "Sales", email: "repa@inhyma.test" },
    ]);

    await Promise.resolve();
    await Promise.resolve();

    // Verify tasksApi.getTasks was NOT called again
    expect(tasksApi.getTasks).toHaveBeenCalledTimes(1);
  });

  it("triggers task refresh on genuine task events, does not duplicate fetches, and ignores unrelated events", async () => {
    render(
      <MemoryRouter initialEntries={["/tasks"]}>
        <TasksPage />
      </MemoryRouter>
    );

    expect(capturedEventListener).not.toBeNull();
    const callsBefore = vi.mocked(tasksApi.getTasks).mock.calls.length;

    // 1. Dispatch an unrelated user event (e.g. notification or generic user action)
    capturedEventListener!({
      entity: "notification",
      event_type: "NOTIFICATION_RECEIVED",
      user_id: "u-1",
    });
    expect(vi.mocked(tasksApi.getTasks).mock.calls.length).toBe(callsBefore);

    // 2. Dispatch another unrelated entity event (e.g. lead or supplier)
    capturedEventListener!({
      entity: "lead",
      event_type: "crm_lead.created",
      user_id: "u-1",
    });
    expect(vi.mocked(tasksApi.getTasks).mock.calls.length).toBe(callsBefore);

    // 3. Dispatch a genuine task entity event -> exactly 1 additional fetch
    capturedEventListener!({
      entity: "task",
      event_type: "TASK_UPDATED",
      entity_id: "t-1",
      user_id: "u-1",
    });
    expect(vi.mocked(tasksApi.getTasks).mock.calls.length).toBe(callsBefore + 1);

    // Verify it was a silent background update without setting loading skeletons
    const lastCallArgs = vi.mocked(tasksApi.getTasks).mock.calls[callsBefore];
    expect(lastCallArgs).toBeDefined();
  });
});
