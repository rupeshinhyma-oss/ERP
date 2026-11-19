import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeedPage } from "../feed/FeedPage";
import { NAV_SECTIONS, PAGE_TITLES } from "@/lib/nav";
import { feedApi } from "@/lib/feedApi";
import type { FeedPost, EligibleRecipient, EligibleDepartment } from "@/types/feed";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

// Mock useToast
const mockToast = vi.fn();
vi.mock("@/lib/toast", () => ({
  useToast: () => mockToast,
}));

// Mock useAuth
let mockAuthState = {
  profile: { id: "user-author-1", display_name: "Author User", email: "author@example.com" },
  isSuperAdmin: false,
  hasPermission: (perm: string) => ["feed.view", "feed.create"].includes(perm),
};

vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    useAuth: () => mockAuthState,
    useBodyScrollLock: vi.fn(),
  };
});

// Mock feedApi
vi.mock("@/lib/feedApi", () => ({
  feedApi: {
    listPosts: vi.fn(),
    getPost: vi.fn(),
    createPost: vi.fn(),
    updatePost: vi.fn(),
    deletePost: vi.fn(),
    getEligibleRecipients: vi.fn(),
    getEligibleDepartments: vi.fn(),
    addComment: vi.fn(),
    listComments: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    toggleReaction: vi.fn(),
    markAsRead: vi.fn(),
    getReadership: vi.fn(),
    listConversations: vi.fn().mockResolvedValue({ data: { items: [], total: 0 } }),
    getUnreadDirectMessagesCount: vi.fn().mockResolvedValue({ data: { unread_count: 0 } }),
    startConversation: vi.fn(),
    getConversation: vi.fn(),
    listMessages: vi.fn().mockResolvedValue({ data: { items: [], total: 0 } }),
    sendMessage: vi.fn(),
    updateMessage: vi.fn(),
    deleteMessage: vi.fn(),
    markConversationRead: vi.fn().mockResolvedValue({ data: { is_read: true } }),
  },
}));

const sampleDepartments: EligibleDepartment[] = [
  { id: "dept-hr", name: "Human Resources", code: "HR", member_count: 5 },
  { id: "dept-it", name: "Information Technology", code: "IT", member_count: 8 },
  { id: "dept-sales", name: "Sales", code: "SALES", member_count: 12 },
];

const samplePosts: FeedPost[] = [
  {
    id: "post-1",
    author_id: "user-author-1",
    author: {
      id: "user-author-1",
      display_name: "Author User",
      email: "author@example.com",
      employee_code: "EMP-001",
    },
    title: "Company Townhall Q4",
    content: "Please join us this Friday at 4 PM for the townhall.",
    audience_type: "ALL",
    status: "PUBLISHED",
    published_at: "2026-10-22T10:00:00Z",
    created_at: "2026-10-22T10:00:00Z",
    updated_at: "2026-10-22T10:00:00Z",
    targeted_departments: [],
    recipients: [],
    is_author: true,
  },
  {
    id: "post-2",
    author_id: "user-other-2",
    author: {
      id: "user-other-2",
      display_name: "Manager Smith",
      email: "smith@example.com",
      employee_code: "EMP-002",
    },
    title: "Targeted Strategy Note",
    content: "Confidential briefing for project leads.",
    audience_type: "SELECTED",
    status: "PUBLISHED",
    published_at: "2026-10-22T09:30:00Z",
    created_at: "2026-10-22T09:30:00Z",
    updated_at: "2026-10-22T09:30:00Z",
    targeted_departments: [
      { department_id: "dept-it", name: "Information Technology", code: "IT" },
    ],
    recipients: [
      {
        id: "rec-1",
        recipient_id: "user-author-1",
        recipient: {
          id: "user-author-1",
          display_name: "Author User",
          email: "author@example.com",
          employee_code: "EMP-001",
        },
      },
    ],
    is_author: false,
  },
];

const eligibleEmployees: EligibleRecipient[] = [
  {
    id: "emp-101",
    display_name: "Alice Developer",
    email: "alice@example.com",
    employee_code: "EMP-101",
    username: "alice",
    department_name: "Engineering",
  },
  {
    id: "emp-102",
    display_name: "Bob Designer",
    email: "bob@example.com",
    employee_code: "EMP-102",
    username: "bob",
    department_name: "Design",
  },
];

describe("Feed & Broadcast Messaging — Phase 2 & 3 Frontend Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState = {
      profile: { id: "user-author-1", display_name: "Author User", email: "author@example.com" },
      isSuperAdmin: false,
      hasPermission: (perm: string) => ["feed.view", "feed.create"].includes(perm),
    };

    (feedApi.listPosts as any).mockResolvedValue({
      data: {
        items: samplePosts,
        total: 2,
        page: 1,
        page_size: 10,
        total_pages: 1,
      },
    });

    (feedApi.getEligibleRecipients as any).mockResolvedValue({
      data: eligibleEmployees,
    });

    (feedApi.getEligibleDepartments as any).mockResolvedValue({
      data: sampleDepartments,
    });

    (feedApi.markAsRead as any).mockResolvedValue({
      data: { post_id: "post-1", is_read: true },
    });

    (feedApi.listComments as any).mockResolvedValue({
      items: [],
      total: 0,
    });

    (feedApi.toggleReaction as any).mockResolvedValue({
      counts: { like: 1, celebrate: 0, support: 0, total: 1 },
      user_reaction: "LIKE",
    });
  });

  afterEach(() => {
    cleanup();
  });

  /* -------------------------------------------------------------------------- */
  /* 1. Navigation & RBAC Structure                                             */
  /* -------------------------------------------------------------------------- */
  describe("1. Navigation & RBAC Integration", () => {
    it("ensures Feed navigation item is registered under DASHBOARD section with feed.view permission", () => {
      const dashboardSection = NAV_SECTIONS.find((sec) => sec.label === "DASHBOARD");
      expect(dashboardSection).toBeDefined();

      const feedItems = NAV_SECTIONS.flatMap((sec) => sec.items).filter((i) => i.key === "feed" || i.path === "/feed");
      expect(feedItems.length).toBe(1);

      const feedItem = dashboardSection?.items.find((i) => i.key === "feed");
      expect(feedItem).toBeDefined();
      expect(feedItem?.path).toBe("/feed");
      expect(feedItem?.label).toBe("Feed");
      expect(feedItem?.icon).toBe("messageSquare");
      expect(feedItem?.permission).toBe("feed.view");
    });

    it("ensures PAGE_TITLES registers feed with descriptive title", () => {
      expect(PAGE_TITLES["feed"]).toBe("Feed & Broadcasts");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. Page Loading, Empty & Error States                                      */
  /* -------------------------------------------------------------------------- */
  describe("2. Loading, Empty, and Error States", () => {
    it("renders feed posts list successfully after loading", async () => {
      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Company Townhall Q4")).toBeDefined();
        expect(screen.getByText("Targeted Strategy Note")).toBeDefined();
      });

      // Verify audience badges
      expect(screen.getByTestId("audience-all-badge")).toBeDefined();
      expect(screen.getByTestId("audience-selected-badge")).toBeDefined();
    });

    it("renders empty state when no announcements are present", async () => {
      (feedApi.listPosts as any).mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, page_size: 10, total_pages: 1 },
      });

      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feed-empty-state")).toBeDefined();
        expect(screen.getByText("No announcements yet")).toBeDefined();
      });
    });

    it("renders error state on API failure and allows retry", async () => {
      (feedApi.listPosts as any).mockRejectedValueOnce(new Error("Network failure"));

      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feed-error-state")).toBeDefined();
        expect(screen.getByText("Network failure")).toBeDefined();
      });

      // Clicking Try Again
      (feedApi.listPosts as any).mockResolvedValueOnce({
        data: { items: samplePosts, total: 2, page: 1, page_size: 10, total_pages: 1 },
      });

      fireEvent.click(screen.getByTestId("feed-retry-btn"));

      await waitFor(() => {
        expect(screen.getByText("Company Townhall Q4")).toBeDefined();
      });
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. Company-Wide Post Publishing                                            */
  /* -------------------------------------------------------------------------- */
  describe("3. Company-wide (Everyone) Announcement Publishing", () => {
    it("publishes a company-wide post successfully", async () => {
      (feedApi.createPost as any).mockResolvedValueOnce({
        data: {
          id: "new-post-1",
          author_id: "user-author-1",
          title: "New Policy Update",
          content: "Effective Monday, all departments follow the new procedure.",
          audience_type: "ALL",
          status: "PUBLISHED",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          targeted_departments: [],
          recipients: [],
          is_author: true,
        },
      });

      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feed-composer")).toBeDefined();
      });

      fireEvent.change(screen.getByTestId("feed-composer-title"), {
        target: { value: "New Policy Update" },
      });
      fireEvent.change(screen.getByTestId("feed-composer-content"), {
        target: { value: "Effective Monday, all departments follow the new procedure." },
      });

      // Confirm audience is ALL by default
      expect(screen.getByTestId("audience-confirm-notice").textContent).toContain("Everyone in Inhyma ERP");

      fireEvent.click(screen.getByTestId("publish-btn"));

      await waitFor(() => {
        expect(feedApi.createPost).toHaveBeenCalledWith({
          title: "New Policy Update",
          content: "Effective Monday, all departments follow the new procedure.",
          audience_type: "ALL",
          status: "PUBLISHED",
          department_ids: undefined,
        });
        expect(mockToast).toHaveBeenCalledWith(
          "Announcement broadcast published successfully!",
          "success"
        );
      });
    });

    it("saves a draft announcement when Save Draft is clicked", async () => {
      (feedApi.createPost as any).mockResolvedValueOnce({
        data: {
          id: "draft-1",
          author_id: "user-author-1",
          title: "Draft In Progress",
          content: "Work in progress draft content.",
          audience_type: "ALL",
          status: "DRAFT",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          targeted_departments: [],
          recipients: [],
          is_author: true,
        },
      });

      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feed-composer")).toBeDefined();
      });

      fireEvent.change(screen.getByTestId("feed-composer-title"), {
        target: { value: "Draft In Progress" },
      });
      fireEvent.change(screen.getByTestId("feed-composer-content"), {
        target: { value: "Work in progress draft content." },
      });

      fireEvent.click(screen.getByTestId("save-draft-btn"));

      await waitFor(() => {
        expect(feedApi.createPost).toHaveBeenCalledWith({
          title: "Draft In Progress",
          content: "Work in progress draft content.",
          audience_type: "ALL",
          status: "DRAFT",
          department_ids: undefined,
        });
        expect(mockToast).toHaveBeenCalledWith(
          "Draft announcement saved successfully.",
          "success"
        );
      });
    });

    it("hides department picker when Everyone is selected and exposes only Everyone and Departments options", async () => {
      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feed-composer")).toBeDefined();
      });

      // Individual Employees and Combined options must NOT exist in the announcement composer
      expect(screen.getByTestId("audience-all-btn")).toBeDefined();
      expect(screen.getByTestId("audience-dept-btn")).toBeDefined();
      expect(screen.queryByTestId("audience-emp-btn")).toBeNull();
      expect(screen.queryByTestId("audience-combined-btn")).toBeNull();
      expect(screen.queryByText("Individual Employees")).toBeNull();
      expect(screen.queryByText("Combined")).toBeNull();

      // Switch to Departments mode first
      fireEvent.click(screen.getByTestId("audience-dept-btn"));
      expect(screen.getByTestId("department-picker-section")).toBeDefined();
      expect(screen.queryByTestId("recipient-picker-section")).toBeNull();

      // Switch to Everyone mode
      fireEvent.click(screen.getByTestId("audience-all-btn"));
      expect(screen.getByTestId("audience-confirm-notice")).toBeDefined();
      expect(screen.queryByTestId("department-picker-section")).toBeNull();
      expect(screen.queryByTestId("recipient-picker-section")).toBeNull();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. Content Validation & Announcement / DM Separation                       */
  /* -------------------------------------------------------------------------- */
  describe("4. Announcement Validation & Audience Separation from Direct Messages", () => {
    it("validates empty content and prevents submission", async () => {
      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feed-composer")).toBeDefined();
      });

      fireEvent.click(screen.getByTestId("publish-btn"));

      expect(mockToast).toHaveBeenCalledWith("Message content is required.", "warning");
      expect(feedApi.createPost).not.toHaveBeenCalled();
    });

    it("does not expose Individual Employees or Combined audience controls and preserves historical recipient rendering", async () => {
      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feed-composer")).toBeDefined();
        expect(screen.getByText("Targeted Strategy Note")).toBeDefined();
      });

      // Composer offers only Everyone and Departments; never calls individual recipient search
      expect(screen.queryByTestId("audience-emp-btn")).toBeNull();
      expect(screen.queryByTestId("audience-combined-btn")).toBeNull();
      expect(screen.queryByTestId("recipient-picker-section")).toBeNull();
      expect(feedApi.getEligibleRecipients).not.toHaveBeenCalled();

      // Historical targeted post (`samplePosts[1]`) with legacy explicit recipients still renders cleanly
      const selectedBadges = screen.getAllByTestId("audience-selected-badge");
      expect(selectedBadges.length).toBeGreaterThanOrEqual(1);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 5. Department-based Audience Targeting (Phase 3)                           */
  /* -------------------------------------------------------------------------- */
  describe("5. Department-based Audience Targeting (Phase 3)", () => {
    it("renders eligible departments with live member counts and publishes to multiple departments", async () => {
      (feedApi.createPost as any).mockResolvedValueOnce({
        data: {
          id: "post-dept-1",
          author_id: "user-author-1",
          content: "Engineering and HR cross-functional notice.",
          audience_type: "SELECTED",
          status: "PUBLISHED",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          targeted_departments: [
            { department_id: "dept-hr", name: "Human Resources", code: "HR" },
            { department_id: "dept-it", name: "Information Technology", code: "IT" },
          ],
          recipients: [],
          is_author: true,
        },
      });

      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feed-composer")).toBeDefined();
      });

      fireEvent.change(screen.getByTestId("feed-composer-content"), {
        target: { value: "Engineering and HR cross-functional notice." },
      });

      // Switch to Departments mode
      fireEvent.click(screen.getByTestId("audience-dept-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("department-picker-section")).toBeDefined();
      });

      // Summary before selecting any department
      const summaryText = screen.getByTestId("estimated-reach-text");
      expect(summaryText.textContent).toContain("0 departments selected");

      // Open department dropdown
      fireEvent.focus(screen.getByTestId("dept-search-input"));

      await waitFor(() => {
        expect(screen.getByTestId("dept-dropdown")).toBeDefined();
        expect(screen.getByText("Human Resources")).toBeDefined();
        expect(screen.getByText("5 members")).toBeDefined();
        expect(screen.getByText("Information Technology")).toBeDefined();
        expect(screen.getByText("8 members")).toBeDefined();
      });

      // Select HR
      fireEvent.click(screen.getByTestId("dept-item-dept-hr"));
      expect(screen.getByTestId("dept-chip-dept-hr")).toBeDefined();

      // Open dropdown again and Select IT
      fireEvent.focus(screen.getByTestId("dept-search-input"));
      fireEvent.click(screen.getByTestId("dept-item-dept-it"));
      expect(screen.getByTestId("dept-chip-dept-it")).toBeDefined();

      // Verify audience summary shows 2 departments and 13 members
      expect(summaryText.textContent).toContain("13 employee(s) across 2 department(s)");

      // Remove IT department
      const removeItBtn = screen.getByLabelText("Remove Information Technology");
      fireEvent.click(removeItBtn);
      expect(screen.queryByTestId("dept-chip-dept-it")).toBeNull();
      expect(summaryText.textContent).toContain("5 employee(s) across 1 department(s)");

      // Re-add IT department
      fireEvent.focus(screen.getByTestId("dept-search-input"));
      fireEvent.click(screen.getByTestId("dept-item-dept-it"));

      // Publish
      fireEvent.click(screen.getByTestId("publish-btn"));

      await waitFor(() => {
        expect(feedApi.createPost).toHaveBeenCalledWith({
          title: undefined,
          content: "Engineering and HR cross-functional notice.",
          audience_type: "SELECTED",
          status: "PUBLISHED",
          department_ids: ["dept-hr", "dept-it"],
        });
      });
    });

    it("validates empty departments when Department audience mode is chosen", async () => {
      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feed-composer")).toBeDefined();
      });

      fireEvent.change(screen.getByTestId("feed-composer-content"), {
        target: { value: "Test department empty validation." },
      });

      fireEvent.click(screen.getByTestId("audience-dept-btn"));
      fireEvent.click(screen.getByTestId("publish-btn"));

      expect(mockToast).toHaveBeenCalledWith(
        "Please select at least one department for a targeted post.",
        "warning"
      );
      expect(feedApi.createPost).not.toHaveBeenCalled();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 7. Post Display & Department Badges                                        */
  /* -------------------------------------------------------------------------- */
  describe("7. Feed Post Card with Department Badges", () => {
    it("renders targeted department badges and chips on targeted post cards", async () => {
      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Targeted Strategy Note")).toBeDefined();
      });

      // Verify Department Badge on Post 2
      expect(screen.getByTestId("audience-dept-badge").textContent).toContain("Information Technology");
      expect(screen.getByTestId("post-dept-chip-dept-it").textContent).toContain("Information Technology");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 8. Post Actions (Edit & Delete) & RBAC Visibility                         */
  /* -------------------------------------------------------------------------- */
  describe("8. Post Actions & Role-Based Access Controls", () => {
    it("allows author to see Edit and Delete on their own post, but hides from others", async () => {
      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Company Townhall Q4")).toBeDefined();
      });

      // Post 1 is authored by current user -> buttons exist
      expect(screen.getByTestId("edit-post-post-1")).toBeDefined();
      expect(screen.getByTestId("delete-post-post-1")).toBeDefined();

      // Post 2 is NOT authored by current user and user lacks feed.manage -> buttons hidden
      expect(screen.queryByTestId("edit-post-post-2")).toBeNull();
      expect(screen.queryByTestId("delete-post-post-2")).toBeNull();
    });

    it("allows feed.manage moderator to delete published posts while keeping Edit strictly author-only, and hides Delete when feed.manage is absent", async () => {
      mockAuthState = {
        profile: { id: "user-moderator", display_name: "Moderator User", email: "mod@example.com" },
        isSuperAdmin: false,
        hasPermission: (perm: string) => ["feed.view", "feed.manage"].includes(perm),
      };

      const { unmount } = render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Targeted Strategy Note")).toBeDefined();
      });

      // Moderator never sees Edit on another user's post, but DOES see Delete for moderation
      expect(screen.queryByTestId("edit-post-post-2")).toBeNull();
      expect(screen.getByTestId("delete-post-post-2")).toBeDefined();
      unmount();

      // Admin-labeled user WITHOUT feed.manage does NOT see Delete on another user's post
      mockAuthState = {
        profile: { id: "user-hr-admin", display_name: "HR Admin", email: "hradmin@example.com" },
        isSuperAdmin: false,
        hasPermission: (perm: string) => ["feed.view", "feed.create"].includes(perm),
      };

      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Targeted Strategy Note")).toBeDefined();
      });

      expect(screen.queryByTestId("edit-post-post-2")).toBeNull();
      expect(screen.queryByTestId("delete-post-post-2")).toBeNull();
    });

    it("blocks access when feed.view is missing/denied and hides composer when user has feed.view only", async () => {
      mockAuthState = {
        profile: { id: "user-no-perms", display_name: "Restricted User", email: "restricted@example.com" },
        isSuperAdmin: false,
        hasPermission: () => false,
      };

      const { unmount } = render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      expect(screen.getByTestId("feed-forbidden-state")).toBeDefined();
      expect(feedApi.listPosts).not.toHaveBeenCalled();
      unmount();

      // User with feed.view ONLY sees announcements but NOT the composer
      mockAuthState = {
        profile: { id: "user-view-only", display_name: "Reader Employee", email: "reader@example.com" },
        isSuperAdmin: false,
        hasPermission: (perm: string) => perm === "feed.view",
      };

      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Company Townhall Q4")).toBeDefined();
      });
      expect(screen.queryByTestId("feed-composer")).toBeNull();
    });

    it("opens Edit modal and submits update", async () => {
      (feedApi.updatePost as any).mockResolvedValueOnce({
        data: {
          ...samplePosts[0],
          title: "Updated Townhall Q4",
          content: "Updated meeting content.",
        },
      });

      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("edit-post-post-1")).toBeDefined();
      });

      fireEvent.click(screen.getByTestId("edit-post-post-1"));

      await waitFor(() => {
        expect(screen.getByTestId("feed-edit-form")).toBeDefined();
      });

      fireEvent.change(screen.getByTestId("feed-edit-title"), {
        target: { value: "Updated Townhall Q4" },
      });
      fireEvent.change(screen.getByTestId("feed-edit-content"), {
        target: { value: "Updated meeting content." },
      });

      fireEvent.click(screen.getByTestId("feed-edit-save-btn"));

      await waitFor(() => {
        expect(feedApi.updatePost).toHaveBeenCalledWith("post-1", {
          title: "Updated Townhall Q4",
          content: "Updated meeting content.",
        });
        expect(mockToast).toHaveBeenCalledWith("Announcement updated successfully.", "success");
      });
    });

    it("opens Delete confirmation modal and deletes post", async () => {
      (feedApi.deletePost as any).mockResolvedValueOnce({
        data: { message: "Feed post deleted successfully", id: "post-1" },
      });

      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("delete-post-post-1")).toBeDefined();
      });

      fireEvent.click(screen.getByTestId("delete-post-post-1"));

      await waitFor(() => {
        expect(screen.getByTestId("delete-confirm-modal")).toBeDefined();
      });

      fireEvent.click(screen.getByTestId("confirm-delete-btn"));

      await waitFor(() => {
        expect(feedApi.deletePost).toHaveBeenCalledWith("post-1");
        expect(mockToast).toHaveBeenCalledWith("Announcement deleted successfully.", "success");
      });
    });
  });

  describe("9. Deep-Link Resolution (/feed?post_id={id})", () => {
    it("highlights post if already present on current page", async () => {
      render(
        <MemoryRouter initialEntries={["/feed?post_id=post-1"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        const card = screen.getByTestId("feed-post-card-post-1");
        expect(card).toBeDefined();
        expect(card.className).toContain("feed-post-highlighted");
        expect(screen.getByTestId("highlighted-badge")).toBeDefined();
      });
    });

    it("fetches single post by ID when not on current page and highlights it", async () => {
      const remotePost: FeedPost = {
        id: "post-remote-99",
        author_id: "user-author-1",
        author: {
          id: "user-author-1",
          display_name: "Author User",
          email: "author@example.com",
        },
        title: "Remote Deep-Linked Announcement",
        content: "Content from page 3 of announcements.",
        audience_type: "ALL",
        status: "PUBLISHED",
        published_at: "2026-10-20T10:00:00Z",
        created_at: "2026-10-20T10:00:00Z",
        updated_at: "2026-10-20T10:00:00Z",
        targeted_departments: [],
        recipients: [],
        is_author: true,
      };

      (feedApi.getPost as any).mockResolvedValueOnce({ data: remotePost });

      render(
        <MemoryRouter initialEntries={["/feed?post_id=post-remote-99"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(feedApi.getPost).toHaveBeenCalledWith("post-remote-99");
        const card = screen.getByTestId("feed-post-card-post-remote-99");
        expect(card).toBeDefined();
        expect(card.className).toContain("feed-post-highlighted");
        expect(screen.getByText("Remote Deep-Linked Announcement")).toBeDefined();
      });
    });

    it("displays error toast when target announcement is forbidden (403)", async () => {
      const error403 = new Error("Forbidden");
      (error403 as any).status = 403;
      (feedApi.getPost as any).mockRejectedValueOnce(error403);

      render(
        <MemoryRouter initialEntries={["/feed?post_id=forbidden-post"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(feedApi.getPost).toHaveBeenCalledWith("forbidden-post");
        expect(mockToast).toHaveBeenCalledWith("You do not have permission to view this announcement.", "error");
      });
    });

    it("displays error toast when target announcement is not found (404)", async () => {
      const error404 = new Error("Not Found");
      (error404 as any).status = 404;
      (feedApi.getPost as any).mockRejectedValueOnce(error404);

      render(
        <MemoryRouter initialEntries={["/feed?post_id=nonexistent-post"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(feedApi.getPost).toHaveBeenCalledWith("nonexistent-post");
        expect(mockToast).toHaveBeenCalledWith("The requested announcement could not be found or has been removed.", "error");
      });
    });
  });

  describe("10. Pagination, Content Validation & Direct Messages Integration", () => {
    it("renders multi-page pagination controls and fetches page 2 on Next click", async () => {
      (feedApi.listPosts as any)
        .mockResolvedValueOnce({
          data: {
            items: samplePosts,
            total: 17,
            page: 1,
            page_size: 10,
            total_pages: 2,
          },
        })
        .mockResolvedValueOnce({
          data: {
            items: [samplePosts[0]],
            total: 17,
            page: 2,
            page_size: 10,
            total_pages: 2,
          },
        });

      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feed-pagination")).toBeDefined();
        expect(screen.getByText(/Page 1 of 2/i)).toBeDefined();
      });

      const nextBtn = screen.getByRole("button", { name: "Next" });
      expect((nextBtn as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(nextBtn);

      await waitFor(() => {
        expect(feedApi.listPosts).toHaveBeenCalledWith({
          page: 2,
          page_size: 10,
          search: undefined,
        });
        expect(screen.getByText(/Page 2 of 2/i)).toBeDefined();
      });
    });

    it("mounts Direct Messages view when ?tab=messages&conversation_id=... deep-link is opened", async () => {
      (feedApi.getUnreadDirectMessagesCount as any).mockResolvedValue({
        data: { unread_count: 3 },
      });
      (feedApi.getConversation as any).mockResolvedValueOnce({
        data: {
          id: "conv-deep-42",
          created_at: "2026-11-16T10:00:00Z",
          updated_at: "2026-11-16T10:05:00Z",
          unread_count: 1,
          participants: [],
          other_participant: {
            user_id: "emp-101",
            display_name: "Alice Developer",
            email: "alice@example.com",
            department_name: "Engineering",
          },
          last_message_preview: "Deep-linked message preview",
          last_message_at: "2026-11-16T10:05:00Z",
        },
      });

      render(
        <MemoryRouter initialEntries={["/feed?tab=messages&conversation_id=conv-deep-42"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feed-dm-container")).toBeDefined();
        expect(feedApi.getConversation).toHaveBeenCalledWith("conv-deep-42");
        expect(screen.getAllByText("Alice Developer").length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText("Deep-linked message preview")).toBeDefined();
      });
    });

    it("rejects oversized post content (> 20,000 chars) and displays accurate privacy copy", async () => {
      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feed-composer")).toBeDefined();
      });

      fireEvent.click(screen.getByTestId("audience-dept-btn"));
      expect(screen.queryByText(/and administrators/i)).toBeNull();
      expect(
        screen.getByText(/current members of targeted departments and the author/i)
      ).toBeDefined();

      fireEvent.click(screen.getByTestId("audience-all-btn"));
      fireEvent.change(screen.getByTestId("feed-composer-content"), {
        target: { value: "Z".repeat(20001) },
      });
      fireEvent.click(screen.getByTestId("publish-btn"));

      expect(mockToast).toHaveBeenCalledWith(
        "Message content must not exceed 20,000 characters.",
        "warning"
      );
      expect(feedApi.createPost).not.toHaveBeenCalled();
    });
  });
});
