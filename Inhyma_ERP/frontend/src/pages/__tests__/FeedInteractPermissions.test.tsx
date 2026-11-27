import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeedPage } from "../feed/FeedPage";
import { feedApi } from "@/lib/feedApi";
import { Auth } from "@/lib/auth";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

const mockToast = vi.fn();
vi.mock("@/lib/toast", () => ({
  useToast: () => mockToast,
}));

let mockAuthState = {
  profile: {
    id: "emp-1",
    display_name: "Rohan Employee",
    email: "emp@example.com",
    permissions: ["feed.view", "feed.interact"],
  },
  isSuperAdmin: false,
  hasPermission: (perm: string) => ["feed.view", "feed.interact"].includes(perm),
};

vi.mock("@/lib/hooks", () => ({
  useAuth: () => mockAuthState,
  useBodyScrollLock: vi.fn(),
}));

vi.mock("@/lib/feedApi", () => ({
  feedApi: {
    listPosts: vi.fn(),
    getPost: vi.fn(),
    createPost: vi.fn(),
    updatePost: vi.fn(),
    deletePost: vi.fn(),
    getEligibleRecipients: vi.fn(),
    getEligibleDepartments: vi.fn(),
    toggleReaction: vi.fn(),
    listComments: vi.fn(),
    addComment: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    markAsRead: vi.fn(),
    getReadership: vi.fn(),
    listConversations: vi.fn(),
    getUnreadDirectMessagesCount: vi.fn(),
    startConversation: vi.fn(),
    getConversation: vi.fn(),
    listMessages: vi.fn(),
    sendMessage: vi.fn(),
    updateMessage: vi.fn(),
    deleteMessage: vi.fn(),
    markConversationRead: vi.fn(),
  },
}));

const samplePost = {
  id: "post-101",
  author_id: "mgr-1",
  author: {
    id: "mgr-1",
    display_name: "Suresh OpsManager",
    full_name: "Suresh OpsManager",
    email: "mgr@example.com",
  },
  title: "Shift Handover Notice",
  content: "Please acknowledge the updated shift checklist.",
  audience_type: "ALL",
  status: "PUBLISHED",
  created_at: "2026-11-19T05:00:00Z",
  updated_at: "2026-11-19T05:00:00Z",
  published_at: "2026-11-19T05:00:00Z",
  recipients: [],
  targeted_departments: [],
  is_author: false,
  can_edit: false,
  can_delete: false,
  is_read: true,
  comments_count: 0,
  reactions_summary: {
    counts: { like: 0, celebrate: 0, support: 0, total: 0 },
    user_reaction: null,
  },
};

const sampleConversation = {
  id: "conv-101",
  created_at: "2026-11-19T05:00:00Z",
  updated_at: "2026-11-19T05:05:00Z",
  unread_count: 1,
  participants: [],
  other_participant: {
    user_id: "mgr-1",
    display_name: "Suresh OpsManager",
    email: "mgr@example.com",
    department_name: "FM_Operations",
  },
  last_message: {
    id: "dm-1",
    conversation_id: "conv-101",
    sender_id: "mgr-1",
    sender_display_name: "Suresh OpsManager",
    sender_email: "mgr@example.com",
    content: "Please confirm receipt.",
    is_edited: false,
    is_sender: false,
    created_at: "2026-11-19T05:05:00Z",
    updated_at: "2026-11-19T05:05:00Z",
  },
};

describe("Company Feed — feed.interact vs feed.create Frontend RBAC (KNOWN-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (feedApi.listPosts as any).mockResolvedValue({
      data: { items: [samplePost], total: 1, page: 1, page_size: 10, total_pages: 1 },
    });
    (feedApi.getEligibleDepartments as any).mockResolvedValue({ data: [] });
    (feedApi.getEligibleRecipients as any).mockResolvedValue({ data: [] });
    (feedApi.listComments as any).mockResolvedValue({
      data: { items: [], total: 0, page: 1, page_size: 50, total_pages: 1, has_more: false },
    });
    (feedApi.toggleReaction as any).mockResolvedValue({
      data: {
        counts: { like: 1, celebrate: 0, support: 0, total: 1 },
        user_reaction: "LIKE",
      },
    });
    (feedApi.addComment as any).mockResolvedValue({
      data: {
        id: "cmt-emp-1",
        post_id: "post-101",
        author_id: "emp-1",
        author: { id: "emp-1", display_name: "Rohan Employee", email: "emp@example.com" },
        content: "Acknowledged!",
        created_at: "2026-11-19T05:10:00Z",
        updated_at: "2026-11-19T05:10:00Z",
        is_author: true,
        can_delete: true,
      },
    });
    (feedApi.getUnreadDirectMessagesCount as any).mockResolvedValue({ data: { unread_count: 1 } });
    (feedApi.listConversations as any).mockResolvedValue({
      data: { items: [sampleConversation], total: 1 },
    });
    (feedApi.listMessages as any).mockResolvedValue({
      data: { items: [sampleConversation.last_message], total: 1 },
    });
    (feedApi.markConversationRead as any).mockResolvedValue({ data: { is_read: true } });
    (feedApi.sendMessage as any).mockResolvedValue({
      data: {
        id: "dm-reply-1",
        conversation_id: "conv-101",
        sender_id: "emp-1",
        sender_display_name: "Rohan Employee",
        sender_email: "emp@example.com",
        content: "Confirmed, thanks!",
        is_edited: false,
        is_sender: true,
        created_at: "2026-11-19T05:12:00Z",
        updated_at: "2026-11-19T05:12:00Z",
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("Employee (feed.view + feed.interact, NO feed.create) can like, comment, and reply in own DM while broadcast composer & +New DM remain hidden", async () => {
    mockAuthState = {
      profile: {
        id: "emp-1",
        display_name: "Rohan Employee",
        email: "emp@example.com",
        permissions: ["feed.view", "feed.interact"],
      },
      isSuperAdmin: false,
      hasPermission: (perm: string) => ["feed.view", "feed.interact"].includes(perm),
    };

    const { unmount } = render(
      <MemoryRouter initialEntries={["/feed"]}>
        <FeedPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Shift Handover Notice")).toBeDefined();
    });

    // Broadcast composer must stay hidden (no feed.create!)
    expect(screen.queryByTestId("feed-composer")).toBeNull();
    expect(screen.queryByTestId("new-broadcast-btn")).toBeNull();

    // Like button is enabled and triggers reaction API
    const likeBtn = screen.getByTestId("reaction-like-post-101") as HTMLButtonElement;
    expect(likeBtn.disabled).toBe(false);
    fireEvent.click(likeBtn);
    await waitFor(() => {
      expect(feedApi.toggleReaction).toHaveBeenCalledWith("post-101", "LIKE");
    });

    // Comment drawer shows comment input and submits comment
    fireEvent.click(screen.getByTestId("toggle-comments-post-101"));
    await waitFor(() => {
      expect(screen.getByTestId("comment-input-post-101")).toBeDefined();
    });
    fireEvent.change(screen.getByTestId("comment-input-post-101"), {
      target: { value: "Acknowledged!" },
    });
    fireEvent.click(screen.getByTestId("comment-submit-post-101"));
    await waitFor(() => {
      expect(feedApi.addComment).toHaveBeenCalledWith("post-101", "Acknowledged!");
    });
    unmount();

    // Direct Messages tab: +New DM button is hidden, but reply box is visible and sends reply
    render(
      <MemoryRouter initialEntries={["/feed?tab=messages"]}>
        <FeedPage />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByTestId("dm-message-input")).toBeDefined();
    });
    expect(screen.queryByTestId("start-dm-btn")).toBeNull();

    fireEvent.change(screen.getByTestId("dm-message-input"), {
      target: { value: "Confirmed, thanks!" },
    });
    fireEvent.click(screen.getByTestId("dm-send-btn"));
    await waitFor(() => {
      expect(feedApi.sendMessage).toHaveBeenCalledWith("conv-101", "Confirmed, thanks!");
    });
  });

  it("Strictly read-only user (feed.view ONLY) has disabled reactions, no comment input, and no DM reply input", async () => {
    mockAuthState = {
      profile: {
        id: "ro-1",
        display_name: "Read Only",
        email: "ro@example.com",
        permissions: ["feed.view"],
      },
      isSuperAdmin: false,
      hasPermission: (perm: string) => perm === "feed.view",
    };

    const { unmount } = render(
      <MemoryRouter initialEntries={["/feed"]}>
        <FeedPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Shift Handover Notice")).toBeDefined();
    });

    const likeBtn = screen.getByTestId("reaction-like-post-101") as HTMLButtonElement;
    expect(likeBtn.disabled).toBe(true);
    expect(likeBtn.title).toBe("Requires feed.interact permission to react");

    fireEvent.click(screen.getByTestId("toggle-comments-post-101"));
    await waitFor(() => {
      expect(feedApi.listComments).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("comment-input-post-101")).toBeNull();
    unmount();

    render(
      <MemoryRouter initialEntries={["/feed?tab=messages"]}>
        <FeedPage />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getAllByText("Suresh OpsManager").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByTestId("start-dm-btn")).toBeNull();
    expect(screen.queryByTestId("dm-message-input")).toBeNull();
  });

  it("Explicit deny:feed.interact disables interactions and DM reply even when feed.create is present", async () => {
    mockAuthState = {
      profile: {
        id: "deny-1",
        display_name: "Denied Interact",
        email: "deny@example.com",
        permissions: ["feed.view", "feed.create", "deny:feed.interact"],
      },
      isSuperAdmin: false,
      hasPermission: (perm: string) => ["feed.view", "feed.create"].includes(perm),
    };

    const { unmount } = render(
      <MemoryRouter initialEntries={["/feed"]}>
        <FeedPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Shift Handover Notice")).toBeDefined();
    });
    const likeBtn = screen.getByTestId("reaction-like-post-101") as HTMLButtonElement;
    expect(likeBtn.disabled).toBe(true);
    unmount();

    render(
      <MemoryRouter initialEntries={["/feed?tab=messages"]}>
        <FeedPage />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getAllByText("Suresh OpsManager").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByTestId("dm-message-input")).toBeNull();
  });

  it("Manager (feed.view + feed.create) sees broadcast composer, enabled reactions, +New DM, and DM reply", async () => {
    mockAuthState = {
      profile: {
        id: "mgr-1",
        display_name: "Suresh OpsManager",
        email: "mgr@example.com",
        permissions: ["feed.view", "feed.create"],
      },
      isSuperAdmin: false,
      hasPermission: (perm: string) => ["feed.view", "feed.create"].includes(perm),
    };

    const { unmount } = render(
      <MemoryRouter initialEntries={["/feed"]}>
        <FeedPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Shift Handover Notice")).toBeDefined();
    });
    expect(screen.getByTestId("feed-composer")).toBeDefined();
    expect((screen.getByTestId("reaction-like-post-101") as HTMLButtonElement).disabled).toBe(false);
    unmount();

    render(
      <MemoryRouter initialEntries={["/feed?tab=messages"]}>
        <FeedPage />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByTestId("dm-message-input")).toBeDefined();
      expect(screen.getByTestId("start-dm-btn")).toBeDefined();
    });
  });

  it("Unauthorized user without feed.view sees Access Restricted state", () => {
    mockAuthState = {
      profile: {
        id: "unauth-1",
        display_name: "No Feed",
        email: "nofeed@example.com",
        permissions: [],
      },
      isSuperAdmin: false,
      hasPermission: () => false,
    };

    render(
      <MemoryRouter initialEntries={["/feed"]}>
        <FeedPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId("feed-forbidden-state")).toBeDefined();
    expect(feedApi.listPosts).not.toHaveBeenCalled();
  });
});

describe("Auth.hasPermission universal Feed availability for all Inhyma users", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("grants feed.view and feed.interact to any authenticated user (including custom department & HR roles without explicit feed grants) while keeping feed.create/feed.manage gated", () => {
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "dept-user-1",
      username: "usera",
      roles: ["Test"],
      permissions: [],
    } as any);

    expect(Auth.hasPermission("feed.view")).toBe(true);
    expect(Auth.hasPermission("feed.interact")).toBe(true);
    expect(Auth.hasPermission("feed.create")).toBe(false);
    expect(Auth.hasPermission("feed.manage")).toBe(false);

    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "hr-user-1",
      username: "hr1",
      roles: ["HR"],
      permissions: ["hrms.attendance"],
    } as any);

    expect(Auth.hasPermission("feed.view")).toBe(true);
    expect(Auth.hasPermission("feed.interact")).toBe(true);
    expect(Auth.hasPermission("feed.create")).toBe(false);
  });

  it("still honors explicit deny:feed.view and deny:feed.interact overrides", () => {
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "denied-view-1",
      username: "blocked",
      roles: ["Test"],
      permissions: ["deny:feed.view"],
    } as any);

    expect(Auth.hasPermission("feed.view")).toBe(false);
    expect(Auth.hasPermission("feed.interact")).toBe(false);

    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "denied-interact-1",
      username: "readonly",
      roles: ["Test"],
      permissions: ["deny:feed.interact"],
    } as any);

    expect(Auth.hasPermission("feed.view")).toBe(true);
    expect(Auth.hasPermission("feed.interact")).toBe(false);
  });
});
