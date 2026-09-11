/**
 * Task Module Domain Types.
 */

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type TaskStatus = "TODO" | "IN_PROGRESS" | "REVIEW" | "ON_HOLD" | "PENDING_APPROVAL" | "DONE";
export type TaskAssignmentRole = "OWNER" | "ASSIGNEE" | "WATCHER" | "PRIMARY" | "COLLABORATOR" | "REVIEWER" | string;

export type IssueType = "TASK" | "BUG" | "IMPROVEMENT" | "STORY" | "EPIC" | "APPROVAL";
export type ApprovalStatus = "NONE" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "NOT_REQUIRED";
export type DependencyType = "BLOCKS" | "BLOCKED_BY" | "RELATES_TO";
export type SprintStatus = "PLANNED" | "ACTIVE" | "COMPLETED" | "FUTURE";

export interface TaskLabel {
  id: string;
  name: string;
  color: string;
  description?: string | null;
  created_at: string;
}

export interface TaskSprint {
  id: string;
  name: string;
  goal?: string | null;
  status: SprintStatus | string;
  start_date?: string | null;
  end_date?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  task_count?: number;
  completed_task_count?: number;
}

export interface TaskTemplate {
  id: string;
  name: string;
  category?: string | null;
  description?: string | null;
  template_data: Record<string, any>;
  issue_type?: IssueType;
  default_priority?: TaskPriority;
  subtask_templates?: Array<string | { title: string; priority?: TaskPriority }>;
  default_labels?: string[];
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskDependency {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  dependency_type: DependencyType | string;
  created_at: string;
  depends_on_task_title?: string | null;
  depends_on_task_status?: string | null;
}

export interface TaskReactionSummary {
  emoji: string;
  count: number;
  user_ids: string[];
  has_reacted: boolean;
  user_reacted?: boolean;
}

export interface TaskMention {
  id: string;
  task_id: string;
  comment_id?: string | null;
  mentioned_user_id: string;
  created_at: string;
  user?: UserMini | null;
}

export interface TaskSavedFilter {
  id: string;
  user_id: string;
  name: string;
  filter_config: Record<string, any>;
  filter_json?: Record<string, any>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserWorkloadSummary {
  user_id: string;
  user_name: string;
  full_name?: string;
  email?: string | null;
  user_email?: string | null;
  department_name?: string | null;
  open_tasks_count: number;
  in_progress_tasks_count: number;
  overdue_tasks_count: number;
  completed_tasks_count: number;
  high_priority_count: number;
  open_tasks?: number;
  in_progress_tasks?: number;
  overdue_tasks?: number;
  completed_tasks_last_30d?: number;
}

export interface WorkloadDashboardResponse {
  users: UserWorkloadSummary[];
  total_tasks: number;
  total_open_tasks?: number;
  total_in_progress_tasks?: number;
  total_overdue_tasks?: number;
}

export interface CapacityDayAllocation {
  date: string;
  task_ids: string[];
  task_count: number;
}

export interface UserCapacitySummary {
  user_id: string;
  user_name: string;
  full_name?: string;
  allocations: CapacityDayAllocation[];
  days?: CapacityDayAllocation[];
}

export interface CapacityViewResponse {
  users: UserCapacitySummary[];
  start_date: string;
  end_date: string;
}

export interface TaskDuplicateRequest {
  include_subtasks?: boolean;
  include_labels?: boolean;
  include_watchers?: boolean;
  include_attachments?: boolean;
  new_title?: string | null;
}

export interface TaskBulkActionRequest {
  task_ids: string[];
  action: "STATUS" | "PRIORITY" | "ASSIGN" | "ADD_WATCHER" | "ADD_LABEL" | "REMOVE_LABEL" | "SET_SPRINT" | "DELETE" | string;
  value?: any;
}

export interface UserMini {
  id: string;
  full_name?: string | null;
  username?: string | null;
  email?: string | null;
  profile_picture_url?: string | null;
}

export interface TaskAssignee {
  id: string;
  task_id: string;
  user_id: string;
  assignment_role: string;
  created_at: string;
  user?: UserMini | null;
}

export interface TaskSubtaskAssignee {
  id: string;
  subtask_id: string;
  user_id: string;
  created_at: string;
  user?: UserMini | null;
}

export interface TaskSubtask {
  id: string;
  task_id: string;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  start_date?: string | null;
  due_date?: string | null;
  completed: boolean;
  assignee_id?: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
  assignee?: UserMini | null;
  assignees?: TaskSubtaskAssignee[];
  comments?: TaskSubtaskComment[];
  attachments?: TaskSubtaskAttachment[];
}

export interface TaskCommentAttachment {
  id: string;
  comment_id: string;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  created_at: string;
  updated_at?: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  user_id: string;
  message: string;
  audio_url?: string | null;
  created_at: string;
  user?: UserMini | null;
  attachments?: TaskCommentAttachment[];
  reactions?: TaskReactionSummary[];
  mentions?: TaskMention[];
}

export interface TaskEscalationComment {
  id: string;
  escalation_id: string;
  user_id: string;
  message: string;
  audio_url?: string | null;
  created_at: string;
  updated_at?: string;
  user?: UserMini | null;
}

export interface TaskEscalation {
  id: string;
  task_id: string;
  from_user: string;
  to_user: string;
  reason: string;
  escalation_type?: string;
  due_date?: string | null;
  created_at: string;
  from_user_rel?: UserMini | null;
  to_user_rel?: UserMini | null;
  comments?: TaskEscalationComment[];
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  uploaded_by?: string | null;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  created_at: string;
  updated_at?: string;
  uploader?: UserMini | null;
}

export interface TaskVoiceNote {
  id: string;
  task_id: string;
  subtask_id?: string | null;
  comment_id?: string | null;
  uploaded_by?: string | null;
  file_name: string;
  audio_url: string;
  duration_seconds: number;
  created_at: string;
  updated_at?: string;
  uploader?: UserMini | null;
}

export interface TaskSubtaskComment {
  id: string;
  subtask_id: string;
  user_id: string;
  message: string;
  audio_url?: string | null;
  created_at: string;
  updated_at?: string;
  user?: UserMini | null;
}

export interface TaskSubtaskAttachment {
  id: string;
  subtask_id: string;
  uploaded_by?: string | null;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  created_at: string;
  updated_at?: string;
  uploader?: UserMini | null;
}

export interface TaskSummary {
  id: string;
  title: string;
  description?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  issue_type?: IssueType;
  parent_task?: { id: string; title: string } | null;
  parent_task_id?: string | null;
  parent_task_title?: string | null;
  sprint_id?: string | null;
  sprint_name?: string | null;
  approval_status?: ApprovalStatus;
  hold_reason?: string | null;
  hold_until?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  created_by?: string | null;
  creator?: UserMini | null;
  created_at: string;
  updated_at: string;
  assignees: TaskAssignee[];
  labels?: TaskLabel[];
  reactions?: TaskReactionSummary[];
  subtask_total: number;
  subtask_completed: number;
  child_task_count?: number;
  child_task_completed?: number;
  progress_percent?: number;
  comment_count: number;
  escalation_count: number;
  attachment_count?: number;
  voice_note_count?: number;
  depends_on_task_ids?: string[];
}

export interface TaskDetail {
  id: string;
  title: string;
  description?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  issue_type?: IssueType;
  parent_task_id?: string | null;
  parent_task_title?: string | null;
  sprint_id?: string | null;
  sprint_name?: string | null;
  sprint?: TaskSprint | null;
  approval_status?: ApprovalStatus;
  approver_id?: string | null;
  approver?: UserMini | null;
  approval_notes?: string | null;
  approved_at?: string | null;
  hold_reason?: string | null;
  hold_until?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  created_by?: string | null;
  creator?: UserMini | null;
  created_at: string;
  updated_at: string;
  version: number;
  assignees: TaskAssignee[];
  subtasks: TaskSubtask[];
  comments: TaskComment[];
  escalations: TaskEscalation[];
  attachments?: TaskAttachment[];
  voice_notes?: TaskVoiceNote[];
  labels?: TaskLabel[];
  dependencies?: TaskDependency[];
  reactions?: TaskReactionSummary[];
  child_tasks?: TaskSummary[];
  progress_percent?: number;
}

export interface TaskEscalateCandidate {
  user_id: string;
  name: string;
  email?: string | null;
  category: "REPORTING_MANAGER" | "DEPARTMENT_MANAGER" | "ORGANIZATION_USER";
  detail?: string | null;
}

export interface TaskEscalateOptionsResponse {
  reporting_managers: TaskEscalateCandidate[];
  department_managers: TaskEscalateCandidate[];
  organization_users: TaskEscalateCandidate[];
}

export interface TaskListResponse {
  items: TaskSummary[];
  total: number;
  page: number;
  page_size: number;
}

export type TaskListItem = TaskSummary;

export interface AvailableUser {
  id: string;
  full_name: string;
  username?: string;
  email?: string;
  department?: string;
  roles?: string[];
}

export interface TaskTimelineItem {
  id: string;
  timestamp: string;
  actor_id?: string | null;
  actor_name?: string | null;
  user?: { full_name?: string } | null;
  event_type: string;
  description: string;
  details?: Record<string, any> | null;
}

export interface MiniSubtaskInput {
  title: string;
  description?: string;
  priority: TaskPriority;
  status: TaskStatus;
  start_date?: string;
  due_date?: string;
  assignee_ids?: string[];
}

export interface TaskInitialEscalationInput {
  escalation_type: "REPORTING_MANAGER" | "DEPARTMENT_MANAGER" | "ORGANIZATION_USER" | string;
  escalated_to_id: string;
  reason: string;
  due_date?: string | null;
}

export function isTaskOverdue(dueDate?: string | null, status?: TaskStatus): boolean {
  if (!dueDate || status === "DONE" || status === "ON_HOLD") return false;
  const due = new Date(dueDate);
  // Compare end-of-day for due date
  due.setHours(23, 59, 59, 999);
  return due < new Date();
}

