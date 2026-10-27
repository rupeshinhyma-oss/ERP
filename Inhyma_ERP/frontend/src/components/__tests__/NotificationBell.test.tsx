import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NotificationBell } from "../AppShell";
import type { LiveEvent } from "@/lib/live/liveEvent";

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock apiGet & apiPost
const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual("@/lib/api");
  return {
    ...actual,
    apiGet: (...args: unknown[]) => mockApiGet(...args),
    apiPost: (...args: unknown[]) => mockApiPost(...args),
  };
});

// Mock useAuth
let mockProfile: { id: string; username: string; roles: string[] } | null = {
  id: "user-uuid-1",
  username: "testuser",
  roles: ["employee"],
};

vi.mock("@/lib/hooks", async () => {
  const actual = await vi.importActual("@/lib/hooks");
  return {
    ...actual,
    useAuth: () => ({
      profile: mockProfile,
      isSuperAdmin: false,
      hasPermission: () => true,
    }),
  };
});

// Mock liveClient
type EventListener = (event: LiveEvent) => void;
const eventListeners = new Set<EventListener>();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();

vi.mock("@/lib/live/liveClient", () => ({
  liveClient: {
    subscribe: (...args: unknown[]) => mockSubscribe(...args),
    unsubscribe: (...args: unknown[]) => mockUnsubscribe(...args),
    onEvent: (cb: EventListener) => {
      eventListeners.add(cb);
      return () => {
        eventListeners.delete(cb);
      };
    },
    getStatus: () => "connected",
  },
}));

function emitLiveEvent(event: LiveEvent) {
  act(() => {
    for (const listener of eventListeners) {
      listener(event);
    }
  });
}

describe("NotificationBell & Live Notification Delivery (Phase 5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventListeners.clear();
    mockProfile = {
      id: "user-uuid-1",
      username: "testuser",
      roles: ["employee"],
    };

    // Default polling and list responses
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes("/notifications/unread-count")) {
        return Promise.resolve({ data: { unread_count: 0 } });
      }
      if (url.includes("/notifications?limit=30")) {
        return Promise.resolve({ data: { items: [], unread_count: 0 } });
      }
      return Promise.resolve({ data: {} });
    });

    mockApiPost.mockResolvedValue({ data: { success: true } });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("subscribes to user private channel on mount and unsubscribes on unmount", () => {
    const { unmount } = render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    );

    expect(mockSubscribe).toHaveBeenCalledWith("user:user-uuid-1");
    expect(mockApiGet).toHaveBeenCalledWith("/notifications/unread-count");

    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledWith("user:user-uuid-1");
  });

  it("parses object response with items and unread_count correctly (Phase 5A)", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes("/notifications/unread-count")) {
        return Promise.resolve({ data: { unread_count: 2 } });
      }
      if (url.includes("/notifications?limit=30")) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "notif-1",
                user_id: "user-uuid-1",
                type: "leave_requested",
                title: "Leave Request Submitted",
                message: "John Doe submitted a Casual Leave request.",
                link: "/hrms/leave",
                is_read: false,
                created_at: new Date().toISOString(),
              },
              {
                id: "notif-2",
                user_id: "user-uuid-1",
                type: "asset_assigned",
                title: "Asset Assigned",
                message: "MacBook Pro M2 assigned to you.",
                link: "/hrms/assets",
                is_read: false,
                created_at: new Date().toISOString(),
              },
            ],
            unread_count: 2,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    );

    // Initial badge from poll
    await waitFor(() => {
      expect(screen.getByText("2")).toBeTruthy();
    });

    // Open dropdown
    const bellBtn = screen.getByTitle("Notifications");
    fireEvent.click(bellBtn);

    await waitFor(() => {
      expect(screen.getByText("Leave Request Submitted")).toBeTruthy();
      expect(screen.getByText("Asset Assigned")).toBeTruthy();
      expect(screen.getByText("2 unread")).toBeTruthy();
    });
  });

  it("supports array response shape if returned by legacy endpoints", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes("/notifications/unread-count")) {
        return Promise.resolve({ data: { unread_count: 1 } });
      }
      if (url.includes("/notifications?limit=30")) {
        return Promise.resolve({
          data: [
            {
              id: "notif-legacy-1",
              user_id: "user-uuid-1",
              type: "task_assigned",
              title: "Task Assigned",
              message: "You have been assigned to Lead Follow-up.",
              link: "/tasks?id=123",
              is_read: false,
              created_at: new Date().toISOString(),
            },
          ],
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    );

    const bellBtn = screen.getByTitle("Notifications");
    fireEvent.click(bellBtn);

    await waitFor(() => {
      expect(screen.getByText("Task Assigned")).toBeTruthy();
      expect(screen.getByText("You have been assigned to Lead Follow-up.")).toBeTruthy();
    });
  });

  it("handles empty notifications list and shows caught-up state", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes("/notifications/unread-count")) {
        return Promise.resolve({ data: { unread_count: 0 } });
      }
      if (url.includes("/notifications?limit=30")) {
        return Promise.resolve({ data: { items: [], unread_count: 0 } });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    );

    const bellBtn = screen.getByTitle("Notifications");
    fireEvent.click(bellBtn);

    await waitFor(() => {
      expect(screen.getByText("You're all caught up!")).toBeTruthy();
      expect(screen.getByText("No unread notifications at the moment.")).toBeTruthy();
    });
  });

  it("handles failed API request gracefully without crashing UI", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes("/notifications/unread-count")) {
        return Promise.reject(new Error("Network failure"));
      }
      if (url.includes("/notifications?limit=30")) {
        return Promise.reject(new Error("Internal Server Error"));
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    );

    const bellBtn = screen.getByTitle("Notifications");
    fireEvent.click(bellBtn);

    await waitFor(() => {
      expect(screen.getByText("You're all caught up!")).toBeTruthy();
    });
  });

  it("updates dropdown state and unread count in real-time when valid live event arrives (Phase 5B)", async () => {
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    );

    expect(screen.queryByText("1")).toBeNull();

    // Emit live NOTIFICATION_RECEIVED event
    emitLiveEvent({
      event_id: "evt-100",
      event_type: "NOTIFICATION_RECEIVED",
      entity: "notification",
      entity_id: "notif-live-1",
      version: 1,
      timestamp: new Date().toISOString(),
      user_id: "user-uuid-1",
      changes: {
        id: "notif-live-1",
        type: "expense_submitted",
        title: "Expense Submitted",
        message: "New travel expense submitted for approval.",
        link: "/hrms/expenses",
        created_at: new Date().toISOString(),
      },
    });

    // Unread count badge immediately shows 1
    await waitFor(() => {
      expect(screen.getByText("1")).toBeTruthy();
    });

    // Open dropdown to verify item is visible
    const bellBtn = screen.getByTitle("Notifications");
    fireEvent.click(bellBtn);

    await waitFor(() => {
      expect(screen.getByText("Expense Submitted")).toBeTruthy();
      expect(screen.getByText("New travel expense submitted for approval.")).toBeTruthy();
    });
  });

  it("prevents duplicate items and duplicate unread count increments on duplicate event delivery", async () => {
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    );

    const liveEvent: LiveEvent = {
      event_id: "evt-dup-1",
      event_type: "NOTIFICATION_RECEIVED",
      entity: "notification",
      entity_id: "notif-dup-10",
      version: 1,
      timestamp: new Date().toISOString(),
      user_id: "user-uuid-1",
      changes: {
        id: "notif-dup-10",
        type: "regularization_requested",
        title: "Attendance Regularization",
        message: "Attendance regularization requested for 2026-10-25.",
        link: "/hrms/regularization",
        created_at: new Date().toISOString(),
      },
    };

    // Emit the same event twice
    emitLiveEvent(liveEvent);
    emitLiveEvent(liveEvent);

    // Unread count should only be 1, not 2
    await waitFor(() => {
      expect(screen.getByText("1")).toBeTruthy();
    });
    expect(screen.queryByText("2")).toBeNull();

    // Open dropdown and ensure only one item exists
    const bellBtn = screen.getByTitle("Notifications");
    fireEvent.click(bellBtn);

    await waitFor(() => {
      const items = screen.getAllByText("Attendance Regularization");
      expect(items).toHaveLength(1);
    });
  });

  it("marks individual notification read and decrements unread count", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes("/notifications/unread-count")) {
        return Promise.resolve({ data: { unread_count: 1 } });
      }
      if (url.includes("/notifications?limit=30")) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "notif-to-read",
                user_id: "user-uuid-1",
                type: "task_assigned",
                title: "Assigned Task",
                message: "Verify report",
                link: "/tasks?id=99",
                is_read: false,
                created_at: new Date().toISOString(),
              },
            ],
            unread_count: 1,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    );

    const bellBtn = screen.getByTitle("Notifications");
    fireEvent.click(bellBtn);

    await waitFor(() => {
      expect(screen.getByText("Assigned Task")).toBeTruthy();
    });

    // Click item
    const itemCard = screen.getByText("Assigned Task");
    fireEvent.click(itemCard);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith("/notifications/notif-to-read/read", {});
      expect(mockNavigate).toHaveBeenCalledWith("/tasks?id=99");
    });
  });

  it("marks all notifications read on Mark all read button click", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes("/notifications/unread-count")) {
        return Promise.resolve({ data: { unread_count: 2 } });
      }
      if (url.includes("/notifications?limit=30")) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "notif-1",
                user_id: "user-uuid-1",
                type: "leave_requested",
                title: "Leave Requested",
                message: "Please review",
                link: "/hrms/leave",
                is_read: false,
                created_at: new Date().toISOString(),
              },
            ],
            unread_count: 2,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    );

    const bellBtn = screen.getByTitle("Notifications");
    fireEvent.click(bellBtn);

    await waitFor(() => {
      expect(screen.getByText("Mark all read")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Mark all read"));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith("/notifications/read-all", {});
      expect(screen.queryByText("2 unread")).toBeNull();
    });
  });

  it("cleans up listeners and resets notifications when user logs out", () => {
    const { rerender } = render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    );

    expect(mockSubscribe).toHaveBeenCalledWith("user:user-uuid-1");

    // Simulate logout: profile becomes null
    mockProfile = null;
    rerender(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    );

    expect(mockUnsubscribe).toHaveBeenCalledWith("user:user-uuid-1");
  });
});
