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
    it("ensures Feed navigation item is registered under DASHBOARD section with messageSquare icon", () => {
      const dashboardSection = NAV_SECTIONS.find((sec) => sec.label === "DASHBOARD");
      expect(dashboardSection).toBeDefined();

      const feedItem = dashboardSection?.items.find((i) => i.key === "feed");
      expect(feedItem).toBeDefined();
      expect(feedItem?.path).toBe("/feed");
      expect(feedItem?.label).toBe("Feed");
      expect(feedItem?.icon).toBe("messageSquare");
      expect(feedItem?.permission).toBeUndefined();
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
          recipient_ids: undefined,
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
          recipient_ids: undefined,
        });
        expect(mockToast).toHaveBeenCalledWith(
          "Draft announcement saved successfully.",
          "success"
        );
      });
    });

    it("hides department and employee pickers when Everyone is selected", async () => {
      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feed-composer")).toBeDefined();
      });

      // Switch to Departments mode first
      fireEvent.click(screen.getByTestId("audience-dept-btn"));
      expect(screen.getByTestId("department-picker-section")).toBeDefined();

      // Switch to Everyone mode
      fireEvent.click(screen.getByTestId("audience-all-btn"));
      expect(screen.getByTestId("audience-confirm-notice")).toBeDefined();
      expect(screen.queryByTestId("department-picker-section")).toBeNull();
      expect(screen.queryByTestId("recipient-picker-section")).toBeNull();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. Selected-Employee Targeting & Recipient Picker                          */
  /* -------------------------------------------------------------------------- */
  describe("4. Selected-Employee Targeting & Recipient Management", () => {
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

    it("validates empty recipients when Individual Employees audience is chosen", async () => {
      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feed-composer")).toBeDefined();
      });

      fireEvent.change(screen.getByTestId("feed-composer-content"), {
        target: { value: "Confidential message." },
      });

      // Switch to Individual Employees audience
      fireEvent.click(screen.getByTestId("audience-emp-btn"));

      fireEvent.click(screen.getByTestId("publish-btn"));

      expect(mockToast).toHaveBeenCalledWith(
        "Please select at least one recipient for a targeted post.",
        "warning"
      );
      expect(feedApi.createPost).not.toHaveBeenCalled();
    });

    it("searches employees, adds multiple chips, removes a chip, and publishes", async () => {
      (feedApi.createPost as any).mockResolvedValueOnce({
        data: {
          id: "post-sel-1",
          author_id: "user-author-1",
          content: "Targeted announcement.",
          audience_type: "SELECTED",
          status: "PUBLISHED",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          targeted_departments: [],
          recipients: [{ id: "r-1", recipient_id: "emp-101" }],
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
        target: { value: "Targeted announcement." },
      });

      // Switch to Individual Employees audience
      fireEvent.click(screen.getByTestId("audience-emp-btn"));
      expect(screen.getByTestId("recipient-picker-section")).toBeDefined();

      // Search input triggers autocomplete dropdown
      fireEvent.change(screen.getByTestId("recipient-search-input"), {
        target: { value: "alice" },
      });

      await waitFor(() => {
        expect(screen.getByTestId("recipient-dropdown")).toBeDefined();
        expect(screen.getByText("Alice Developer")).toBeDefined();
        expect(screen.getByText("🏢 Engineering")).toBeDefined();
      });

      // Add Alice Developer
      fireEvent.click(screen.getByTestId("recipient-item-emp-101"));

      // Add Bob Designer
      fireEvent.change(screen.getByTestId("recipient-search-input"), {
        target: { value: "bob" },
      });
      await waitFor(() => {
        expect(screen.getByText("Bob Designer")).toBeDefined();
        expect(screen.getByText("🏢 Design")).toBeDefined();
      });
      fireEvent.click(screen.getByTestId("recipient-item-emp-102"));

      // Verify both chips are rendered with department meta
      expect(screen.getByTestId("chip-emp-101")).toBeDefined();
      expect(screen.getByTestId("chip-emp-101").textContent).toContain("Engineering");
      expect(screen.getByTestId("chip-emp-102")).toBeDefined();
      expect(screen.getByTestId("chip-emp-102").textContent).toContain("Design");

      // Remove Bob Designer
      const removeBobBtn = screen.getByLabelText("Remove Bob Designer");
      fireEvent.click(removeBobBtn);

      expect(screen.queryByTestId("chip-emp-102")).toBeNull();
      expect(screen.getByTestId("chip-emp-101")).toBeDefined();

      // Publish
      fireEvent.click(screen.getByTestId("publish-btn"));

      await waitFor(() => {
        expect(feedApi.createPost).toHaveBeenCalledWith({
          title: undefined,
          content: "Targeted announcement.",
          audience_type: "SELECTED",
          status: "PUBLISHED",
          department_ids: [],
          recipient_ids: ["emp-101"],
        });
      });
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
      const summaryText = screen.getByTestId("estimated-reach-text");
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
          recipient_ids: [],
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
  /* 6. Combined Audience Targeting (Phase 3)                                    */
  /* -------------------------------------------------------------------------- */
  describe("6. Combined Audience Targeting (Departments + Individuals)", () => {
    it("allows publisher to combine departments and individual employees in a single broadcast", async () => {
      (feedApi.createPost as any).mockResolvedValueOnce({
        data: {
          id: "post-combined-1",
          author_id: "user-author-1",
          title: "Quarterly Strategy Alignment",
          content: "HR team plus project lead Bob Designer.",
          audience_type: "SELECTED",
          status: "PUBLISHED",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          targeted_departments: [
            { department_id: "dept-hr", name: "Human Resources", code: "HR" },
          ],
          recipients: [{ id: "r-2", recipient_id: "emp-102" }],
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
        target: { value: "Quarterly Strategy Alignment" },
      });
      fireEvent.change(screen.getByTestId("feed-composer-content"), {
        target: { value: "HR team plus project lead Bob Designer." },
      });

      // Switch to Combined mode
      fireEvent.click(screen.getByTestId("audience-combined-btn"));

      // Verify both picker sections are present
      expect(screen.getByTestId("department-picker-section")).toBeDefined();
      expect(screen.getByTestId("recipient-picker-section")).toBeDefined();

      // Pick HR department
      fireEvent.focus(screen.getByTestId("dept-search-input"));
      await waitFor(() => {
        expect(screen.getByTestId("dept-item-dept-hr")).toBeDefined();
      });
      fireEvent.click(screen.getByTestId("dept-item-dept-hr"));
      expect(screen.getByTestId("dept-chip-dept-hr")).toBeDefined();

      // Pick Bob Designer individually
      fireEvent.change(screen.getByTestId("recipient-search-input"), {
        target: { value: "bob" },
      });
      await waitFor(() => {
        expect(screen.getByTestId("recipient-item-emp-102")).toBeDefined();
      });
      fireEvent.click(screen.getByTestId("recipient-item-emp-102"));
      expect(screen.getByTestId("chip-emp-102")).toBeDefined();

      // Check estimated reach
      const summaryText = screen.getByTestId("estimated-reach-text");
      expect(summaryText.textContent).toContain("~6 employee(s) (approx. union)");

      // Publish
      fireEvent.click(screen.getByTestId("publish-btn"));

      await waitFor(() => {
        expect(feedApi.createPost).toHaveBeenCalledWith({
          title: "Quarterly Strategy Alignment",
          content: "HR team plus project lead Bob Designer.",
          audience_type: "SELECTED",
          status: "PUBLISHED",
          department_ids: ["dept-hr"],
          recipient_ids: ["emp-102"],
        });
      });
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

    it("enforces author-only edit/delete and hides controls from administrator on other users' posts", async () => {
      mockAuthState = {
        profile: { id: "user-admin", display_name: "Admin User", email: "admin@example.com" },
        isSuperAdmin: true,
        hasPermission: () => true,
      };

      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Targeted Strategy Note")).toBeDefined();
      });

      // Admin does NOT see edit or delete buttons on post-2 because admin is not the author
      expect(screen.queryByTestId("edit-post-post-2")).toBeNull();
      expect(screen.queryByTestId("delete-post-post-2")).toBeNull();
    });

    it("allows ordinary users without feed.create or feed.manage to see composer and publish", async () => {
      mockAuthState = {
        profile: { id: "user-ordinary", display_name: "Ordinary Employee", email: "emp@example.com" },
        isSuperAdmin: false,
        hasPermission: () => false,
      };

      render(
        <MemoryRouter initialEntries={["/feed"]}>
          <FeedPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Company Townhall Q4")).toBeDefined();
      });

      // Ordinary employee CAN see the composer (open access for all authenticated employees)
      expect(screen.getByTestId("feed-composer")).toBeDefined();
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
});
