/**
 * API client helpers for Standalone Tasks Module.
 */

import { apiDelete, apiGet, apiPatch, apiPost, apiPostMultipart } from "@/lib/api";
import type {
  ApprovalStatus,
  AvailableUser,
  CapacityViewResponse,
  DependencyType,
  IssueType,
  MiniSubtaskInput,
  SprintStatus,
  TaskAttachment,
  TaskBulkActionRequest,
  TaskComment,
  TaskDependency,
  TaskDetail,
  TaskDuplicateRequest,
  TaskEscalateOptionsResponse,
  TaskEscalation,
  TaskEscalationComment,
  TaskInitialEscalationInput,
  TaskLabel,
  TaskListResponse,
  TaskPriority,
  TaskSavedFilter,
  TaskSprint,
  TaskStatus,
  TaskSubtask,
  TaskSubtaskAttachment,
  TaskSubtaskComment,
  TaskTemplate,
  TaskTimelineItem,
  TaskVoiceNote,
  WorkloadDashboardResponse,
} from "@/types/tasks";

export interface TaskQueryParams {
  view?: "all" | "my" | "kanban" | "calendar" | "department" | "organization";
  status?: TaskStatus;
  priority?: TaskPriority;
  issue_type?: IssueType | string;
  parent_task_id?: string;
  sprint_id?: string;
  is_backlog?: boolean;
  label_id?: string;
  approval_status?: ApprovalStatus | string;
  assignee_id?: string;
  department_id?: string;
  due_date_from?: string;
  due_date_to?: string;
  search?: string;
  is_overdue?: boolean;
  page?: number;
  page_size?: number;
  skip?: number;
  limit?: number;
}

export async function fetchTasks(params: TaskQueryParams = {}): Promise<TaskListResponse> {
  const query = new URLSearchParams();
  if (params.view) query.set("view", params.view);
  if (params.status) query.set("status", params.status);
  if (params.priority) query.set("priority", params.priority);
  if (params.issue_type) query.set("issue_type", params.issue_type);
  if (params.parent_task_id) query.set("parent_task_id", params.parent_task_id);
  if (params.sprint_id) query.set("sprint_id", params.sprint_id);
  if (params.is_backlog !== undefined) query.set("is_backlog", String(params.is_backlog));
  if (params.label_id) query.set("label_id", params.label_id);
  if (params.approval_status) query.set("approval_status", params.approval_status);
  if (params.assignee_id) query.set("assignee_id", params.assignee_id);
  if (params.department_id) query.set("department_id", params.department_id);
  if (params.due_date_from) query.set("due_date_from", params.due_date_from);
  if (params.due_date_to) query.set("due_date_to", params.due_date_to);
  if (params.search) query.set("search", params.search);

  const page = params.page || (params.skip !== undefined && params.limit ? Math.floor(params.skip / params.limit) + 1 : 1);
  const pageSize = params.page_size || params.limit || 50;

  query.set("page", String(page));
  query.set("page_size", String(pageSize));

  const qs = query.toString();
  const res = await apiGet<TaskListResponse>(`/tasks${qs ? `?${qs}` : ""}`);
  return res.data || { items: [], total: 0, page: 1, page_size: pageSize };
}

export async function fetchTaskById(id: string): Promise<TaskDetail> {
  const res = await apiGet<TaskDetail>(`/tasks/${id}`);
  return res.data!;
}

export async function createTask(payload: {
  title: string;
  description?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  issue_type?: IssueType | string;
  parent_task_id?: string | null;
  sprint_id?: string | null;
  approver_id?: string | null;
  label_ids?: string[];
  labels?: string[];
  hold_reason?: string;
  hold_until?: string;
  start_date?: string;
  due_date?: string;
  assignee_ids?: string[];
  watcher_ids?: string[];
  subtasks?: (MiniSubtaskInput | string)[];
  initial_escalation?: TaskInitialEscalationInput | null;
  attachments?: { file_name: string; file_url: string; file_size: number; file_type?: string }[];
  voice_notes?: { audio_url: string; duration_seconds: number; file_size?: number; mime_type?: string; title?: string }[];
}): Promise<TaskDetail> {
  const res = await apiPost<TaskDetail>("/tasks", payload);
  return res.data!;
}

export async function updateTask(
  id: string,
  payload: {
    title?: string;
    description?: string;
    priority?: TaskPriority;
    status?: TaskStatus;
    issue_type?: IssueType | string;
    parent_task_id?: string | null;
    sprint_id?: string | null;
    approval_status?: ApprovalStatus | string;
    approver_id?: string | null;
    approval_notes?: string | null;
    hold_reason?: string | null;
    hold_until?: string | null;
    start_date?: string | null;
    due_date?: string | null;
  }
): Promise<TaskDetail> {
  const res = await apiPatch<TaskDetail>(`/tasks/${id}`, payload);
  return res.data!;
}

export async function deleteTask(id: string): Promise<void> {
  await apiDelete(`/tasks/${id}`);
}

export async function assignTask(
  id: string,
  userIds: string[],
  role: string = "ASSIGNEE"
): Promise<TaskDetail> {
  const res = await apiPost<TaskDetail>(`/tasks/${id}/assign`, {
    user_ids: userIds,
    assignment_role: role,
  });
  return res.data!;
}

export async function uploadTaskFile(
  file: File | Blob,
  filename?: string
): Promise<{ file_url: string; file_name: string; file_size: number; file_type: string }> {
  const formData = new FormData();
  if (file instanceof File) {
    formData.append("file", file, filename || file.name);
  } else {
    formData.append("file", file, filename || "voice_note.webm");
  }
  const res = await apiPostMultipart<{ file_url: string; file_name: string; file_size: number; file_type: string }>(
    "/tasks/upload-file",
    formData
  );
  return res.data!;
}

export async function addTaskAttachment(
  taskId: string,
  payload: { file_name: string; file_url: string; file_size: number; file_type?: string }
): Promise<TaskAttachment> {
  const res = await apiPost<TaskAttachment>(`/tasks/${taskId}/attachments`, payload);
  return res.data!;
}

export async function deleteTaskAttachment(attachmentId: string): Promise<void> {
  await apiDelete(`/tasks/attachments/${attachmentId}`);
}

export async function addTaskVoiceNote(
  taskId: string,
  payload: { audio_url: string; duration_seconds: number; file_size?: number; mime_type?: string; title?: string }
): Promise<TaskVoiceNote> {
  const res = await apiPost<TaskVoiceNote>(`/tasks/${taskId}/voice-notes`, payload);
  return res.data!;
}

export async function addComment(
  id: string,
  messageOrPayload:
    | string
    | {
        message?: string;
        audio_url?: string;
        attachments?: { file_name: string; file_url: string; file_size: number; file_type?: string }[];
      },
  options?: {
    audio_url?: string;
    attachments?: { file_name: string; file_url: string; file_size: number; file_type?: string }[];
  }
): Promise<TaskComment> {
  let message = "";
  let audio_url = options?.audio_url;
  let attachments = options?.attachments;

  if (typeof messageOrPayload === "string") {
    message = messageOrPayload;
  } else if (messageOrPayload) {
    message = messageOrPayload.message || "";
    audio_url = messageOrPayload.audio_url || audio_url;
    attachments = messageOrPayload.attachments || attachments;
  }

  const res = await apiPost<TaskComment>(`/tasks/${id}/comment`, {
    message,
    audio_url,
    attachments,
  });
  return res.data!;
}

export async function fetchSubtaskComments(subtaskId: string): Promise<TaskSubtaskComment[]> {
  const res = await apiGet<TaskSubtaskComment[]>(`/tasks/subtasks/${subtaskId}/comments`);
  return res.data || [];
}

export async function addSubtaskComment(
  subtaskId: string,
  message: string,
  audioUrl?: string
): Promise<TaskSubtaskComment> {
  const res = await apiPost<TaskSubtaskComment>(`/tasks/subtasks/${subtaskId}/comments`, {
    message,
    audio_url: audioUrl,
  });
  return res.data!;
}

export async function fetchSubtaskAttachments(subtaskId: string): Promise<TaskSubtaskAttachment[]> {
  const res = await apiGet<TaskSubtaskAttachment[]>(`/tasks/subtasks/${subtaskId}/attachments`);
  return res.data || [];
}

export async function addSubtaskAttachment(
  subtaskId: string,
  payload: { file_name: string; file_url: string; file_size: number; file_type?: string }
): Promise<TaskSubtaskAttachment> {
  const res = await apiPost<TaskSubtaskAttachment>(`/tasks/subtasks/${subtaskId}/attachments`, payload);
  return res.data!;
}

export async function fetchEscalationComments(escalationId: string): Promise<TaskEscalationComment[]> {
  const res = await apiGet<TaskEscalationComment[]>(`/tasks/escalations/${escalationId}/comments`);
  return res.data || [];
}

export async function addEscalationComment(
  escalationId: string,
  message: string,
  audioUrl?: string
): Promise<TaskEscalationComment> {
  const res = await apiPost<TaskEscalationComment>(`/tasks/escalations/${escalationId}/comments`, {
    message,
    audio_url: audioUrl,
  });
  return res.data!;
}

export async function escalateTask(
  id: string,
  toUserId: string,
  reason: string,
  escalationType: string = "ORGANIZATION_USER",
  dueDate?: string | null
): Promise<TaskEscalation> {
  const res = await apiPost<TaskEscalation>(`/tasks/${id}/escalate`, {
    to_user: toUserId,
    reason,
    escalation_type: escalationType,
    due_date: dueDate || null,
  });
  return res.data!;
}

export async function fetchEscalateOptions(): Promise<TaskEscalateOptionsResponse> {
  const res = await apiGet<TaskEscalateOptionsResponse>("/tasks/escalate-options");
  return res.data || { reporting_managers: [], department_managers: [], organization_users: [] };
}

export async function fetchTaskTimeline(id: string): Promise<TaskTimelineItem[]> {
  const res = await apiGet<TaskTimelineItem[]>(`/tasks/${id}/timeline`);
  return res.data || [];
}

export async function addSubtask(
  taskId: string,
  payload: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    status?: TaskStatus;
    start_date?: string;
    due_date?: string;
    assignee_id?: string;
    assignee_ids?: string[];
  } | string
): Promise<TaskSubtask> {
  const body = typeof payload === "string" ? { title: payload } : payload;
  const res = await apiPost<TaskSubtask>(`/tasks/${taskId}/subtasks`, body);
  return res.data!;
}

export async function updateSubtask(
  subtaskId: string,
  payload: {
    title?: string;
    description?: string;
    priority?: TaskPriority;
    status?: TaskStatus;
    start_date?: string | null;
    due_date?: string | null;
    completed?: boolean;
    assignee_id?: string | null;
    assignee_ids?: string[];
    order_index?: number;
  }
): Promise<TaskSubtask> {
  const res = await apiPatch<TaskSubtask>(`/tasks/subtasks/${subtaskId}`, payload);
  return res.data!;
}

export async function deleteSubtask(subtaskId: string): Promise<void> {
  await apiDelete(`/tasks/subtasks/${subtaskId}`);
}

export async function checkExpiredHolds(): Promise<{ processed: number; message: string }> {
  const res = await apiPost<{ processed: number; message: string }>("/tasks/check-holds", {});
  return res.data || { processed: 0, message: "" };
}

export async function getAvailableAssignees(): Promise<AvailableUser[]> {
  try {
    const res = await apiGet<any>("/users?page_size=200");
    const items = res.data?.items || res.data || [];
    return items.map((u: any) => ({
      id: u.id,
      full_name: u.full_name || u.display_name || u.username || "Team Member",
      username: u.username,
      email: u.email,
      department: u.position_name || (u.roles && u.roles[0]) || "",
      roles: u.roles || [],
    }));
  } catch (err) {
    console.error("Failed to load available assignees", err);
    return [];
  }
}

export async function fetchLabels(): Promise<TaskLabel[]> {
  const res = await apiGet<TaskLabel[]>("/tasks/labels");
  return res.data || [];
}

export async function createLabel(payload: {
  name: string;
  color?: string;
  description?: string;
}): Promise<TaskLabel> {
  const res = await apiPost<TaskLabel>("/tasks/labels", payload);
  return res.data!;
}

export async function fetchSprints(status?: SprintStatus): Promise<TaskSprint[]> {
  const qs = status ? `?status=${status}` : "";
  const res = await apiGet<TaskSprint[]>(`/tasks/sprints${qs}`);
  return res.data || [];
}

export async function createSprint(payload: {
  name: string;
  goal?: string;
  start_date?: string;
  end_date?: string;
  status?: SprintStatus;
}): Promise<TaskSprint> {
  const res = await apiPost<TaskSprint>("/tasks/sprints", payload);
  return res.data!;
}

export async function updateSprint(
  sprintId: string,
  payload: {
    name?: string;
    goal?: string;
    start_date?: string;
    end_date?: string;
    status?: SprintStatus;
  }
): Promise<TaskSprint> {
  const res = await apiPatch<TaskSprint>(`/tasks/sprints/${sprintId}`, payload);
  return res.data!;
}

export async function deleteSprint(sprintId: string): Promise<void> {
  await apiDelete(`/tasks/sprints/${sprintId}`);
}

export async function fetchTemplates(category?: string): Promise<TaskTemplate[]> {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  const res = await apiGet<TaskTemplate[]>(`/tasks/templates${qs}`);
  return res.data || [];
}

export async function createTemplate(payload: {
  name: string;
  description?: string;
  issue_type?: IssueType;
  default_priority?: TaskPriority;
  category?: string;
  subtask_templates?: { title: string; priority?: TaskPriority }[];
  default_labels?: string[];
}): Promise<TaskTemplate> {
  const res = await apiPost<TaskTemplate>("/tasks/templates", payload);
  return res.data!;
}

export async function updateTemplate(
  templateId: string,
  payload: {
    name?: string;
    description?: string;
    issue_type?: IssueType;
    default_priority?: TaskPriority;
    category?: string;
    subtask_templates?: { title: string; priority?: TaskPriority }[];
    default_labels?: string[];
  }
): Promise<TaskTemplate> {
  const res = await apiPatch<TaskTemplate>(`/tasks/templates/${templateId}`, payload);
  return res.data!;
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await apiDelete(`/tasks/templates/${templateId}`);
}

export async function fetchSavedFilters(): Promise<TaskSavedFilter[]> {
  const res = await apiGet<TaskSavedFilter[]>("/tasks/saved-filters");
  return res.data || [];
}

export async function createSavedFilter(payload: {
  name: string;
  filter_json: Record<string, any>;
  is_default?: boolean;
}): Promise<TaskSavedFilter> {
  const res = await apiPost<TaskSavedFilter>("/tasks/saved-filters", payload);
  return res.data!;
}

export async function updateSavedFilter(
  filterId: string,
  payload: {
    name?: string;
    filter_json?: Record<string, any>;
    is_default?: boolean;
  }
): Promise<TaskSavedFilter> {
  const res = await apiPatch<TaskSavedFilter>(`/tasks/saved-filters/${filterId}`, payload);
  return res.data!;
}

export async function deleteSavedFilter(filterId: string): Promise<void> {
  await apiDelete(`/tasks/saved-filters/${filterId}`);
}

export async function executeBulkAction(
  payload: TaskBulkActionRequest
): Promise<{ updated_count: number; message: string }> {
  const res = await apiPost<{ updated_count: number; message: string }>("/tasks/bulk-action", payload);
  return res.data || { updated_count: 0, message: "" };
}

export async function duplicateTask(
  taskId: string,
  payload: TaskDuplicateRequest = {}
): Promise<TaskDetail> {
  const res = await apiPost<TaskDetail>(`/tasks/${taskId}/duplicate`, payload);
  return res.data!;
}

export async function addTaskDependency(
  taskId: string,
  payload: {
    depends_on_task_id: string;
    dependency_type?: DependencyType;
  }
): Promise<TaskDependency> {
  const res = await apiPost<TaskDependency>(`/tasks/${taskId}/dependencies`, payload);
  return res.data!;
}

export async function deleteTaskDependency(dependencyId: string): Promise<void> {
  await apiDelete(`/tasks/dependencies/${dependencyId}`);
}

export async function toggleTaskReaction(
  taskId: string,
  emoji: string
): Promise<{ added: boolean; emoji: string }> {
  const res = await apiPost<{ added: boolean; emoji: string }>(`/tasks/${taskId}/reactions`, { emoji });
  return res.data!;
}

export async function toggleCommentReaction(
  commentId: string,
  emoji: string
): Promise<{ added: boolean; emoji: string }> {
  const res = await apiPost<{ added: boolean; emoji: string }>(`/tasks/comments/${commentId}/reactions`, { emoji });
  return res.data!;
}

export async function submitTaskForApproval(
  taskId: string,
  payload: { approver_id?: string; notes?: string } = {}
): Promise<TaskDetail> {
  const res = await apiPost<TaskDetail>(`/tasks/${taskId}/submit-approval`, payload);
  return res.data!;
}

export async function actionTaskApproval(
  taskId: string,
  payload: { action: "APPROVE" | "REJECT"; notes?: string }
): Promise<TaskDetail> {
  const res = await apiPost<TaskDetail>(`/tasks/${taskId}/action-approval`, payload);
  return res.data!;
}

export async function fetchWorkloadDashboard(departmentId?: string): Promise<WorkloadDashboardResponse> {
  const qs = departmentId ? `?department_id=${departmentId}` : "";
  const res = await apiGet<WorkloadDashboardResponse>(`/tasks/workload${qs}`);
  return res.data || { users: [], total_open_tasks: 0, total_in_progress_tasks: 0, total_overdue_tasks: 0 };
}

export async function fetchCapacityView(
  startDate: string,
  endDate: string,
  departmentId?: string
): Promise<CapacityViewResponse> {
  const query = new URLSearchParams({ start_date: startDate, end_date: endDate });
  if (departmentId) query.set("department_id", departmentId);
  const res = await apiGet<CapacityViewResponse>(`/tasks/capacity?${query.toString()}`);
  return res.data || { start_date: startDate, end_date: endDate, users: [] };
}

export const tasksApi = {
  getTasks: fetchTasks,
  getMyTasks: (params?: TaskQueryParams) => fetchTasks({ ...params, view: "my" }),
  getTask: fetchTaskById,
  createTask,
  updateTask,
  deleteTask,
  assignTask,
  uploadTaskFile,
  addTaskAttachment,
  deleteTaskAttachment,
  addTaskVoiceNote,
  addComment,
  fetchSubtaskComments,
  addSubtaskComment,
  fetchSubtaskAttachments,
  addSubtaskAttachment,
  escalateTask,
  fetchEscalationComments,
  addEscalationComment,
  fetchEscalateOptions,
  fetchTaskTimeline,
  addSubtask,
  updateSubtask,
  deleteSubtask,
  checkExpiredHolds,
  getAvailableAssignees,
  fetchLabels,
  createLabel,
  fetchSprints,
  createSprint,
  updateSprint,
  deleteSprint,
  fetchTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  fetchSavedFilters,
  createSavedFilter,
  updateSavedFilter,
  deleteSavedFilter,
  executeBulkAction,
  duplicateTask,
  addTaskDependency,
  deleteTaskDependency,
  toggleTaskReaction,
  toggleCommentReaction,
  submitTaskForApproval,
  actionTaskApproval,
  fetchWorkloadDashboard,
  fetchCapacityView,
};


