/**
 * Inhyma ERP — Feed & Broadcast Messaging API Client
 */

import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import type {
  FeedPost,
  FeedPostListResponse,
  EligibleRecipient,
  EligibleDepartment,
  FeedPostCreatePayload,
  FeedPostUpdatePayload,
  FeedComment,
  FeedCommentListResponse,
  FeedReactionSummary,
  FeedReactionType,
  FeedReadershipResponse,
  Conversation,
  ConversationListResponse,
  DirectMessage,
  DirectMessageListResponse,
} from "@/types/feed";

export const feedApi = {
  /**
   * Fetch paginated list of feed posts visible to the authenticated user.
   */
  async listPosts(params?: { page?: number; page_size?: number; search?: string }) {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.page_size) qs.set("page_size", String(params.page_size));
    if (params?.search) qs.set("search", params.search);
    const endpoint = `/feed/posts${qs.toString() ? `?${qs.toString()}` : ""}`;
    return apiGet<FeedPostListResponse>(endpoint);
  },

  /**
   * Fetch a single feed post by ID.
   */
  async getPost(postId: string) {
    return apiGet<FeedPost>(`/feed/posts/${postId}`);
  },

  /**
   * Publish or save a draft announcement.
   */
  async createPost(payload: FeedPostCreatePayload) {
    return apiPost<FeedPost>("/feed/posts", payload);
  },

  /**
   * Edit post title, content, or publication status.
   */
  async updatePost(postId: string, payload: FeedPostUpdatePayload) {
    return apiPatch<FeedPost>(`/feed/posts/${postId}`, payload);
  },

  /**
   * Soft-delete a feed post.
   */
  async deletePost(postId: string) {
    return apiDelete<{ message: string; id: string }>(`/feed/posts/${postId}`);
  },

  /**
   * Search active eligible ERP employees for targeted recipient selection.
   */
  async getEligibleRecipients(query?: string, limit: number = 30) {
    const qs = new URLSearchParams();
    if (query) qs.set("query", query);
    if (limit) qs.set("limit", String(limit));
    const endpoint = `/feed/recipients/eligible${qs.toString() ? `?${qs.toString()}` : ""}`;
    return apiGet<EligibleRecipient[]>(endpoint);
  },

  /**
   * Fetch active departments and live member counts for targeted audience selection.
   */
  async getEligibleDepartments() {
    return apiGet<EligibleDepartment[]>("/feed/departments/eligible");
  },

  /**
   * Add a comment to an announcement.
   */
  async addComment(postId: string, content: string) {
    return apiPost<FeedComment>(`/feed/posts/${postId}/comments`, { content });
  },

  /**
   * List comments for an announcement.
   */
  async listComments(postId: string) {
    return apiGet<FeedCommentListResponse>(`/feed/posts/${postId}/comments`);
  },

  /**
   * Update an existing comment.
   */
  async updateComment(postId: string, commentId: string, content: string) {
    return apiPatch<FeedComment>(`/feed/posts/${postId}/comments/${commentId}`, { content });
  },

  /**
   * Delete a comment.
   */
  async deleteComment(postId: string, commentId: string) {
    return apiDelete<{ id: string; deleted: boolean }>(`/feed/posts/${postId}/comments/${commentId}`);
  },

  /**
   * Toggle a reaction on an announcement (LIKE, CELEBRATE, SUPPORT).
   */
  async toggleReaction(postId: string, reactionType: FeedReactionType) {
    return apiPost<FeedReactionSummary>(`/feed/posts/${postId}/reactions`, {
      reaction_type: reactionType,
    });
  },

  /**
   * Mark an announcement as read.
   */
  async markAsRead(postId: string) {
    return apiPost<{ post_id: string; is_read: boolean }>(`/feed/posts/${postId}/read`, {});
  },

  /**
   * Fetch announcement readership details (Author/Admin only).
   */
  async getReadership(postId: string) {
    return apiGet<FeedReadershipResponse>(`/feed/posts/${postId}/readership`);
  },

  /* -------------------------------------------------------------------------- */
  /* Direct Messaging / Conversations                                            */
  /* -------------------------------------------------------------------------- */

  /**
   * List 1-to-1 conversations for the authenticated employee.
   */
  async listConversations(page: number = 1, pageSize: number = 50) {
    return apiGet<ConversationListResponse>(`/feed/conversations?page=${page}&page_size=${pageSize}`);
  },

  /**
   * Get total unread direct message count for badge indicator.
   */
  async getUnreadDirectMessagesCount() {
    return apiGet<{ unread_count: number }>("/feed/conversations/unread-count");
  },

  /**
   * Get or start a conversation with a specific employee.
   */
  async startConversation(recipientId: string) {
    return apiPost<Conversation>("/feed/conversations", { recipient_id: recipientId });
  },

  /**
   * Fetch conversation details by ID.
   */
  async getConversation(conversationId: string) {
    return apiGet<Conversation>(`/feed/conversations/${conversationId}`);
  },

  /**
   * List messages in a conversation.
   */
  async listMessages(conversationId: string, page: number = 1, pageSize: number = 50) {
    return apiGet<DirectMessageListResponse>(
      `/feed/conversations/${conversationId}/messages?page=${page}&page_size=${pageSize}`
    );
  },

  /**
   * Send a private direct message.
   */
  async sendMessage(conversationId: string, content: string) {
    return apiPost<DirectMessage>(`/feed/conversations/${conversationId}/messages`, { content });
  },

  /**
   * Edit own private message.
   */
  async updateMessage(messageId: string, content: string) {
    return apiPatch<DirectMessage>(`/feed/messages/${messageId}`, { content });
  },

  /**
   * Delete own private message.
   */
  async deleteMessage(messageId: string) {
    return apiDelete<{ id: string; deleted: boolean }>(`/feed/messages/${messageId}`);
  },

  /**
   * Mark conversation as read.
   */
  async markConversationRead(conversationId: string) {
    return apiPost<{ is_read: boolean }>(`/feed/conversations/${conversationId}/read`, {});
  },
};

