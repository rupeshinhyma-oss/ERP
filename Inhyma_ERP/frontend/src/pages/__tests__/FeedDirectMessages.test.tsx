import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { FeedDirectMessages } from "../feed/FeedDirectMessages";
import { feedApi } from "@/lib/feedApi";

vi.mock("@/lib/feedApi", () => ({
  feedApi: {
    listConversations: vi.fn(),
    getUnreadDirectMessagesCount: vi.fn(),
    startConversation: vi.fn(),
    getConversation: vi.fn(),
    listMessages: vi.fn(),
    sendMessage: vi.fn(),
    updateMessage: vi.fn(),
    deleteMessage: vi.fn(),
    markConversationRead: vi.fn(),
    getEligibleRecipients: vi.fn(),
  },
}));

const mockShowToast = vi.fn();
vi.mock("@/lib/toast", () => ({
  useToast: () => mockShowToast,
}));

afterEach(() => {
  cleanup();
});

const sampleConversations = [
  {
    id: "conv-1",
    created_at: "2026-10-26T10:00:00Z",
    updated_at: "2026-10-26T10:05:00Z",
    unread_count: 2,
    participants: [],
    other_participant: {
      user_id: "user-2",
      display_name: "Bob Colleague",
      email: "bob@example.com",
      department_name: "Sales",
    },
    last_message: {
      id: "msg-1",
      conversation_id: "conv-1",
      sender_id: "user-2",
      sender_display_name: "Bob Colleague",
      sender_email: "bob@example.com",
      content: "Hey, do you have a minute?",
      is_edited: false,
      is_sender: false,
      created_at: "2026-10-26T10:05:00Z",
      updated_at: "2026-10-26T10:05:00Z",
    },
  },
];

const sampleMessages = [
  {
    id: "msg-1",
    conversation_id: "conv-1",
    sender_id: "user-2",
    sender_display_name: "Bob Colleague",
    sender_email: "bob@example.com",
    content: "Hey, do you have a minute?",
    is_edited: false,
    is_sender: false,
    created_at: "2026-10-26T10:05:00Z",
    updated_at: "2026-10-26T10:05:00Z",
  },
  {
    id: "msg-2",
    conversation_id: "conv-1",
    sender_id: "user-1",
    sender_display_name: "Alice Current",
    sender_email: "alice@example.com",
    content: "Yes, I am available now.",
    is_edited: false,
    is_sender: true,
    created_at: "2026-10-26T10:06:00Z",
    updated_at: "2026-10-26T10:06:00Z",
  },
];

describe("FeedDirectMessages Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (feedApi.listConversations as any).mockResolvedValue({
      data: { items: sampleConversations, total: 1 },
    });
    (feedApi.getUnreadDirectMessagesCount as any).mockResolvedValue({
      data: { unread_count: 2 },
    });
    (feedApi.listMessages as any).mockResolvedValue({
      data: { items: sampleMessages, total: 2 },
    });
    (feedApi.markConversationRead as any).mockResolvedValue({
      data: { is_read: true },
    });
  });

  it("renders conversation list with unread badge and participant name", async () => {
    render(<FeedDirectMessages currentUserId="user-1" />);

    await waitFor(() => {
      expect(screen.getAllByText("Bob Colleague").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Sales").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("2")).toBeDefined(); // unread badge
    });
  });

  it("loads and displays message history for selected conversation", async () => {
    render(<FeedDirectMessages currentUserId="user-1" />);

    await waitFor(() => {
      expect(screen.getAllByText("Hey, do you have a minute?").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Yes, I am available now.")).toBeDefined();
    });

    // Check accurate non-E2EE privacy tag (FEED-AUD-10)
    expect(screen.getByText(/Participants Only/i)).toBeDefined();
    expect(screen.queryByText(/End-to-end/i)).toBeNull();
  });

  it("resolves deep-linked initialConversationId and handles 403 unauthorized safely", async () => {
    const error403 = new Error("Forbidden");
    (error403 as any).status = 403;
    (feedApi.getConversation as any).mockRejectedValueOnce(error403);

    render(
      <FeedDirectMessages
        currentUserId="user-1"
        initialConversationId="conv-forbidden-99"
      />
    );

    await waitFor(() => {
      expect(feedApi.getConversation).toHaveBeenCalledWith("conv-forbidden-99");
      expect(mockShowToast).toHaveBeenCalledWith(
        "You do not have permission to view this conversation.",
        "error"
      );
    });
  });

  it("hides message creation controls when canCreateMessage is false (feed.view only)", async () => {
    render(<FeedDirectMessages currentUserId="user-1" canCreateMessage={false} />);

    await waitFor(() => {
      expect(screen.getAllByText("Bob Colleague").length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.queryByTestId("start-dm-btn")).toBeNull();
    expect(screen.queryByTestId("dm-message-input")).toBeNull();
  });

  it("rejects oversized direct messages exceeding 5,000 characters", async () => {
    render(<FeedDirectMessages currentUserId="user-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("dm-message-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("dm-message-input"), {
      target: { value: "x".repeat(5001) },
    });
    fireEvent.click(screen.getByTestId("dm-send-btn"));

    expect(mockShowToast).toHaveBeenCalledWith(
      "Message content must not exceed 5,000 characters.",
      "warning"
    );
    expect(feedApi.sendMessage).not.toHaveBeenCalled();
  });

  it("sends a new private message to active conversation", async () => {
    (feedApi.sendMessage as any).mockResolvedValueOnce({
      data: {
        id: "msg-3",
        conversation_id: "conv-1",
        sender_id: "user-1",
        sender_display_name: "Alice Current",
        sender_email: "alice@example.com",
        content: "New update sent.",
        is_edited: false,
        is_sender: true,
        created_at: "2026-10-26T10:08:00Z",
        updated_at: "2026-10-26T10:08:00Z",
      },
    });

    render(<FeedDirectMessages currentUserId="user-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("dm-message-input")).toBeDefined();
    });

    const input = screen.getByTestId("dm-message-input");
    fireEvent.change(input, { target: { value: "New update sent." } });

    const sendBtn = screen.getByTestId("dm-send-btn");
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(feedApi.sendMessage).toHaveBeenCalledWith("conv-1", "New update sent.");
      expect(screen.getByText("New update sent.")).toBeDefined();
    });
  });

  it("allows sender to delete their own message", async () => {
    (feedApi.deleteMessage as any).mockResolvedValueOnce({
      data: { id: "msg-2", deleted: true },
    });

    render(<FeedDirectMessages currentUserId="user-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("delete-msg-msg-2")).toBeDefined();
    });

    // Own message has delete button; incoming message does not
    expect(screen.queryByTestId("delete-msg-msg-1")).toBeNull();

    fireEvent.click(screen.getByTestId("delete-msg-msg-2"));

    await waitFor(() => {
      expect(feedApi.deleteMessage).toHaveBeenCalledWith("msg-2");
    });
  });

  it("opens modal and searches eligible employees to start chat", async () => {
    (feedApi.getEligibleRecipients as any).mockResolvedValueOnce({
      data: [
        {
          id: "user-3",
          display_name: "Charlie HR",
          email: "charlie@example.com",
          department_name: "HR",
        },
      ],
    });

    render(<FeedDirectMessages currentUserId="user-1" />);

    const startBtn = screen.getByTestId("start-dm-btn");
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(screen.getByTestId("new-dm-modal")).toBeDefined();
    });

    const searchInput = screen.getByTestId("dm-recipient-search-input");
    fireEvent.change(searchInput, { target: { value: "Charlie" } });

    await waitFor(() => {
      expect(screen.getByText("Charlie HR")).toBeDefined();
    });
  });
});
