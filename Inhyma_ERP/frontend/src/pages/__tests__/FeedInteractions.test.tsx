import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { FeedPostCard } from "../feed/FeedPostCard";
import { feedApi } from "@/lib/feedApi";
import type { FeedPost } from "@/types/feed";

// Mock feedApi
vi.mock("@/lib/feedApi", () => ({
  feedApi: {
    toggleReaction: vi.fn(),
    addComment: vi.fn(),
    listComments: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    markAsRead: vi.fn(),
    getReadership: vi.fn(),
  },
}));

describe("Feed Interactions & Notifications — Frontend Tests (Phase 4)", () => {
  const mockPost: FeedPost = {
    id: "post-interaction-1",
    author_id: "author-user-id",
    author: {
      id: "author-user-id",
      display_name: "Sarah Director",
      full_name: "Sarah Director",
      email: "sarah@example.com",
      employee_code: "DIR-001",
    },
    title: "Q4 Strategy Announcement",
    content: "We are excited to share our strategic objectives for the upcoming quarter.",
    audience_type: "ALL",
    status: "PUBLISHED",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    published_at: new Date().toISOString(),
    recipients: [],
    is_author: true,
    comments_count: 2,
    reactions_summary: {
      counts: { like: 3, celebrate: 1, support: 0, total: 4 },
      user_reaction: "LIKE",
    },
    is_read: true,
    read_count: 12,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (feedApi.markAsRead as any).mockResolvedValue({ post_id: "post-interaction-1", is_read: true });
    (feedApi.toggleReaction as any).mockResolvedValue({
      counts: { like: 2, celebrate: 1, support: 0, total: 3 },
      user_reaction: null,
    });
    (feedApi.listComments as any).mockResolvedValue({
      items: [
        {
          id: "comment-1",
          post_id: "post-interaction-1",
          author_id: "author-user-id",
          author: {
            id: "author-user-id",
            display_name: "Sarah Director",
            full_name: "Sarah Director",
            email: "sarah@example.com",
          },
          content: "First comment here!",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_author: true,
          can_delete: true,
        },
      ],
      total: 1,
    });
    (feedApi.addComment as any).mockResolvedValue({
      id: "comment-2",
      post_id: "post-interaction-1",
      author_id: "author-user-id",
      author: {
        id: "author-user-id",
        display_name: "Sarah Director",
        full_name: "Sarah Director",
        email: "sarah@example.com",
      },
      content: "A fresh comment just added.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_author: true,
      can_delete: true,
    });
    (feedApi.updateComment as any).mockResolvedValue({
      id: "comment-1",
      post_id: "post-interaction-1",
      author_id: "author-user-id",
      author: {
        id: "author-user-id",
        display_name: "Sarah Director",
        full_name: "Sarah Director",
        email: "sarah@example.com",
      },
      content: "Edited comment content!",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_author: true,
      can_delete: true,
    });
    (feedApi.deleteComment as any).mockResolvedValue({ id: "comment-1", deleted: true });
    (feedApi.getReadership as any).mockResolvedValue({
      post_id: "post-interaction-1",
      total_readers: 2,
      readers: [
        {
          user_id: "user-1",
          display_name: "Alex Smith",
          full_name: "Alex Smith",
          employee_code: "EMP-010",
          read_at: new Date().toISOString(),
        },
        {
          user_id: "user-2",
          display_name: "Beth Jones",
          full_name: "Beth Jones",
          employee_code: "EMP-020",
          read_at: new Date().toISOString(),
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders reaction controls with counts and active state", () => {
    render(
      <FeedPostCard
        post={mockPost}
        canEdit={true}
        canDelete={true}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const likeBtn = screen.getByTestId("reaction-like-post-interaction-1");
    expect(likeBtn).toBeDefined();
    expect(likeBtn.className).toContain("feed-reaction-active");
    expect(screen.getByTestId("count-like-post-interaction-1").textContent).toBe("3");

    const celebrateBtn = screen.getByTestId("reaction-celebrate-post-interaction-1");
    expect(celebrateBtn).toBeDefined();
    expect(screen.getByTestId("count-celebrate-post-interaction-1").textContent).toBe("1");
  });

  it("toggles reaction on click and updates reaction state with ApiResult envelope", async () => {
    (feedApi.toggleReaction as any).mockResolvedValueOnce({
      data: {
        counts: { like: 2, celebrate: 1, support: 0, total: 3 },
        user_reaction: null,
      },
    });

    render(
      <FeedPostCard
        post={mockPost}
        canEdit={true}
        canDelete={true}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const likeBtn = screen.getByTestId("reaction-like-post-interaction-1");
    fireEvent.click(likeBtn);

    await waitFor(() => {
      expect(feedApi.toggleReaction).toHaveBeenCalledWith("post-interaction-1", "LIKE");
      // Like was un-toggled: count decrements from 3 to 2 and active class is removed
      expect(screen.getByTestId("count-like-post-interaction-1").textContent).toBe("2");
      expect(likeBtn.className).not.toContain("feed-reaction-active");
    });
  });

  it("toggles Celebrate and Support reactions separately with ApiResult envelopes", async () => {
    (feedApi.toggleReaction as any)
      .mockResolvedValueOnce({
        data: {
          counts: { like: 3, celebrate: 2, support: 0, total: 5 },
          user_reaction: "CELEBRATE",
        },
      })
      .mockResolvedValueOnce({
        data: {
          counts: { like: 3, celebrate: 1, support: 1, total: 5 },
          user_reaction: "SUPPORT",
        },
      });

    render(
      <FeedPostCard
        post={mockPost}
        canEdit={true}
        canDelete={true}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    // 1. Click Celebrate
    const celebrateBtn = screen.getByTestId("reaction-celebrate-post-interaction-1");
    fireEvent.click(celebrateBtn);

    await waitFor(() => {
      expect(feedApi.toggleReaction).toHaveBeenCalledWith("post-interaction-1", "CELEBRATE");
      expect(celebrateBtn.className).toContain("feed-reaction-active");
      expect(screen.getByTestId("count-celebrate-post-interaction-1").textContent).toBe("2");
    });

    // 2. Click Support
    const supportBtn = screen.getByTestId("reaction-support-post-interaction-1");
    fireEvent.click(supportBtn);

    await waitFor(() => {
      expect(feedApi.toggleReaction).toHaveBeenCalledWith("post-interaction-1", "SUPPORT");
      expect(supportBtn.className).toContain("feed-reaction-active");
      expect(screen.getByTestId("count-support-post-interaction-1").textContent).toBe("1");
    });
  });

  it("handles failed reaction API request gracefully without crashing or navigating", async () => {
    (feedApi.toggleReaction as any).mockRejectedValueOnce(new Error("Network disconnect"));

    render(
      <FeedPostCard
        post={mockPost}
        canEdit={true}
        canDelete={true}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const likeBtn = screen.getByTestId("reaction-like-post-interaction-1");
    fireEvent.click(likeBtn);

    await waitFor(() => {
      expect(feedApi.toggleReaction).toHaveBeenCalledWith("post-interaction-1", "LIKE");
      // Component remains completely intact and mounted without throwing an unhandled error
      expect(screen.getByTestId("interactions-bar-post-interaction-1")).toBeDefined();
      expect(likeBtn).toBeDefined();
    });
  });

  it("expands comment drawer, displays comments, and adds a new comment", async () => {
    render(
      <FeedPostCard
        post={mockPost}
        canEdit={true}
        canDelete={true}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    // 1. Expand comments
    const toggleBtn = screen.getByTestId("toggle-comments-post-interaction-1");
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(feedApi.listComments).toHaveBeenCalledWith("post-interaction-1");
      expect(screen.getByTestId("comment-item-comment-1")).toBeDefined();
      expect(screen.getByText("First comment here!")).toBeDefined();
    });

    // 2. Add new comment
    const input = screen.getByTestId("comment-input-post-interaction-1");
    fireEvent.change(input, { target: { value: "A fresh comment just added." } });

    const submitBtn = screen.getByTestId("comment-submit-post-interaction-1");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(feedApi.addComment).toHaveBeenCalledWith("post-interaction-1", "A fresh comment just added.");
      expect(screen.getByText("A fresh comment just added.")).toBeDefined();
    });
  });

  it("supports inline comment editing by comment author", async () => {
    render(
      <FeedPostCard
        post={mockPost}
        canEdit={true}
        canDelete={true}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    // Expand comments
    fireEvent.click(screen.getByTestId("toggle-comments-post-interaction-1"));

    await waitFor(() => {
      expect(screen.getByTestId("edit-comment-btn-comment-1")).toBeDefined();
    });

    // Click edit
    fireEvent.click(screen.getByTestId("edit-comment-btn-comment-1"));

    const editInput = screen.getByTestId("edit-comment-input-comment-1");
    expect(editInput).toBeDefined();
    fireEvent.change(editInput, { target: { value: "Edited comment content!" } });

    fireEvent.click(screen.getByTestId("save-comment-edit-comment-1"));

    await waitFor(() => {
      expect(feedApi.updateComment).toHaveBeenCalledWith(
        "post-interaction-1",
        "comment-1",
        "Edited comment content!"
      );
      expect(screen.getByText("Edited comment content!")).toBeDefined();
    });
  });

  it("supports comment deletion by author or admin", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <FeedPostCard
        post={mockPost}
        canEdit={true}
        canDelete={true}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("toggle-comments-post-interaction-1"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-comment-btn-comment-1")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("delete-comment-btn-comment-1"));

    await waitFor(() => {
      expect(feedApi.deleteComment).toHaveBeenCalledWith("post-interaction-1", "comment-1");
    });
  });

  it("marks unread post as read on mount", async () => {
    const unreadPost: FeedPost = {
      ...mockPost,
      id: "unread-post-99",
      is_author: false,
      is_read: false,
    };

    render(
      <FeedPostCard
        post={unreadPost}
        canEdit={false}
        canDelete={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(feedApi.markAsRead).toHaveBeenCalledWith("unread-post-99");
    });
  });

  it("displays readership button for author and opens readership modal", async () => {
    render(
      <FeedPostCard
        post={mockPost}
        canEdit={true}
        canDelete={true}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const readBtn = screen.getByTestId("readership-btn-post-interaction-1");
    expect(readBtn).toBeDefined();
    expect(readBtn.textContent).toContain("12 read");

    fireEvent.click(readBtn);

    await waitFor(() => {
      expect(feedApi.getReadership).toHaveBeenCalledWith("post-interaction-1");
      expect(screen.getByTestId("readership-modal-post-interaction-1")).toBeDefined();
      expect(screen.getByText("Alex Smith")).toBeDefined();
      expect(screen.getByText("Beth Jones")).toBeDefined();
    });
  });
});
