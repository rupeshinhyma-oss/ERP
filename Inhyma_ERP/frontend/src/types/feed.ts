/**
 * Inhyma ERP — Feed & Broadcast Messaging Types (Phase 3)
 */

export type FeedAudienceType = "ALL" | "SELECTED";
export type FeedPostStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface FeedAuthor {
  id: string;
  display_name: string;
  full_name?: string | null;
  email: string;
  employee_code?: string | null;
}

export interface FeedRecipientUser {
  id: string;
  display_name: string;
  full_name?: string | null;
  email: string;
  employee_code?: string | null;
  department_name?: string | null;
}

export interface FeedRecipient {
  id: string;
  recipient_id: string;
  recipient?: FeedRecipientUser | null;
}

export interface FeedDepartmentRead {
  department_id: string;
  name: string;
  code?: string | null;
}

export interface EligibleDepartment {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  member_count: number;
}

export type FeedReactionType = "LIKE" | "CELEBRATE" | "SUPPORT";

export interface FeedReactionCounts {
  like: number;
  celebrate: number;
  support: number;
  total: number;
}

export interface FeedReactionSummary {
  counts: FeedReactionCounts;
  user_reaction?: FeedReactionType | string | null;
}

export interface FeedComment {
  id: string;
  post_id: string;
  author_id: string;
  author: FeedAuthor;
  content: string;
  created_at: string;
  updated_at: string;
  is_author: boolean;
  can_delete: boolean;
}

export interface FeedCommentListResponse {
  items: FeedComment[];
  total: number;
}

export interface FeedReader {
  user_id: string;
  display_name?: string | null;
  full_name: string;
  email?: string | null;
  employee_code?: string | null;
  read_at: string;
}

export interface FeedReadershipResponse {
  post_id: string;
  total_readers: number;
  readers: FeedReader[];
}

export interface FeedPost {
  id: string;
  author_id: string;
  author?: FeedAuthor | null;
  title?: string | null;
  content: string;
  audience_type: FeedAudienceType;
  status: FeedPostStatus;
  published_at?: string | null;
  created_at: string;
  updated_at: string;
  targeted_departments?: FeedDepartmentRead[];
  recipients: FeedRecipient[];
  is_author?: boolean;
  comments_count?: number;
  reactions_summary?: FeedReactionSummary;
  is_read?: boolean;
  read_count?: number | null;
}

export interface FeedPostListResponse {
  items: FeedPost[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface EligibleRecipient {
  id: string;
  display_name: string;
  full_name?: string | null;
  email: string;
  employee_code?: string | null;
  username?: string | null;
  department_name?: string | null;
}

export interface FeedPostCreatePayload {
  title?: string;
  content: string;
  audience_type: FeedAudienceType;
  status?: FeedPostStatus;
  department_ids?: string[];
  recipient_ids?: string[];
}

export interface FeedPostUpdatePayload {
  title?: string;
  content?: string;
  status?: FeedPostStatus;
  department_ids?: string[];
  recipient_ids?: string[];
}

export interface ConversationParticipant {
  user_id: string;
  display_name: string;
  email: string;
  department_name?: string | null;
  last_read_at?: string | null;
}

export interface DirectMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_display_name: string;
  sender_email: string;
  content: string;
  is_edited: boolean;
  is_sender: boolean;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  created_at: string;
  updated_at: string;
  participants: ConversationParticipant[];
  other_participant?: ConversationParticipant | null;
  last_message?: DirectMessage | null;
  unread_count: number;
}

export interface ConversationListResponse {
  items: Conversation[];
  total: number;
}

export interface DirectMessageListResponse {
  items: DirectMessage[];
  total: number;
}

