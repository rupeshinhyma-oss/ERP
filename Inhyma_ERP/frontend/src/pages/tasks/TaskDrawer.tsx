import React, { useEffect, useState, useRef } from "react";
import type {
  AvailableUser,
  DependencyType,
  IssueType,
  TaskDetail,
  TaskEscalationComment,
  TaskLabel,
  TaskPriority,
  TaskSprint,
  TaskStatus,
  TaskSubtaskAttachment,
  TaskSubtaskComment,
  TaskTimelineItem,
} from "@/types/tasks";
import { isTaskOverdue } from "@/types/tasks";
import { tasksApi } from "@/lib/tasksApi";
import { useAuth } from "@/lib/hooks";
import { SearchableUserSelect } from "@/components/SearchableUserSelect";
import { VoiceNoteRecorder } from "@/components/VoiceNoteRecorder";
import { AttachmentList } from "@/components/AttachmentList";
import { CommentComposer, type CommentSubmitData } from "@/components/CommentComposer";
import { ReactionPicker } from "@/components/ReactionPicker";

interface TaskDrawerProps {
  taskId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onTaskUpdated: () => void;
  onEscalateRequest?: (task: TaskDetail) => void;
}

function getUserDepartment(user?: { department?: string; roles?: string[] } | null): string {
  if (!user) return "Staff";
  if (user.department) return user.department;
  if (user.roles && user.roles.length > 0) {
    const valid = user.roles.filter((r) => r !== "user" && r !== "super_admin");
    if (valid.length > 0) return valid[0];
    if (user.roles.includes("super_admin")) return "Admin";
  }
  return "Staff";
}

function getUserInitials(name?: string | null): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

const SubtaskCollaborationSection: React.FC<{ subtaskId: string }> = ({ subtaskId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [comments, setComments] = useState<TaskSubtaskComment[]>([]);
  const [attachments, setAttachments] = useState<TaskSubtaskAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [cList, aList] = await Promise.all([
        tasksApi.fetchSubtaskComments(subtaskId),
        tasksApi.fetchSubtaskAttachments(subtaskId),
      ]);
      setComments(cList);
      setAttachments(aList);
    } catch (e) {
      console.error("Failed to load subtask collaboration", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, subtaskId]);

  const handleSendComment = async (data: CommentSubmitData) => {
    if (!data.message.trim() && (!data.attachments || data.attachments.length === 0)) return;
    setSubmitting(true);
    try {
      if (data.message.trim()) {
        await tasksApi.addSubtaskComment(subtaskId, data.message.trim(), data.audio_url);
      }
      if (data.attachments && data.attachments.length > 0) {
        for (const att of data.attachments) {
          await tasksApi.addSubtaskAttachment(subtaskId, att);
        }
      }
      await loadData();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to update subtask collaboration");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ marginTop: "6px", borderTop: "1px dashed #e2e8f0", paddingTop: "6px", marginLeft: "24px" }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: "none",
          border: "none",
          color: "#2563eb",
          cursor: "pointer",
          fontSize: "11.5px",
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "2px 0",
        }}
      >
        💬 Subtask Collaboration ({comments.length} comments, {attachments.length} files) {isOpen ? "▲" : "▼"}
      </button>

      {isOpen && (
        <div style={{ marginTop: "8px", background: "#f8fafc", borderRadius: "6px", padding: "10px", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: "10px" }}>
          {loading ? (
            <div style={{ fontSize: "11px", color: "#64748b" }}>Loading subtask discussion...</div>
          ) : (
            <>
              {/* Attachments */}
              <div>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#475569", display: "block", marginBottom: "4px" }}>
                  📎 Subtask Attachments ({attachments.length})
                </span>
                {attachments.length > 0 ? (
                  <AttachmentList attachments={attachments} />
                ) : (
                  <div style={{ fontSize: "11px", color: "#94a3b8", fontStyle: "italic" }}>No attachments on this subtask.</div>
                )}
              </div>

              {/* Comments */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#475569" }}>
                  💬 Discussion ({comments.length})
                </span>
                {comments.length === 0 ? (
                  <div style={{ fontSize: "11px", color: "#94a3b8", fontStyle: "italic" }}>No comments on this subtask yet.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "160px", overflowY: "auto" }}>
                    {comments.map((sc) => (
                      <div key={sc.id} style={{ background: "#ffffff", padding: "6px 8px", borderRadius: "4px", border: "1px solid #e2e8f0", fontSize: "11.5px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                          <strong style={{ color: "#1e293b" }}>{sc.user?.full_name || "Member"}</strong>
                          <span style={{ color: "#94a3b8", fontSize: "10px" }}>{new Date(sc.created_at).toLocaleString()}</span>
                        </div>
                        <div style={{ color: "#334155", whiteSpace: "pre-wrap" }}>{sc.message}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Composer */}
              <CommentComposer
                placeholder="Comment on this subtask or attach files..."
                onSubmit={handleSendComment}
                isSubmitting={submitting}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};

const EscalationCollaborationSection: React.FC<{ escalationId: string }> = ({ escalationId }) => {
  const [isOpen, setIsOpen] = useState(true);
  const [comments, setComments] = useState<TaskEscalationComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const cList = await tasksApi.fetchEscalationComments(escalationId);
      setComments(cList);
    } catch (e) {
      console.error("Failed to load escalation comments", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [escalationId]);

  const handleSendComment = async (data: CommentSubmitData) => {
    if (!data.message.trim()) return;
    setSubmitting(true);
    try {
      await tasksApi.addEscalationComment(escalationId, data.message.trim());
      await loadData();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to post comment on escalation");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ marginTop: "8px", borderTop: "1px solid #fed7d7", paddingTop: "8px" }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: "none",
          border: "none",
          color: "#991b1b",
          cursor: "pointer",
          fontSize: "11.5px",
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: 0,
          marginBottom: "6px",
        }}
      >
        💬 Escalation Discussion ({comments.length}) {isOpen ? "▲" : "▼"}
      </button>

      {isOpen && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {loading ? (
            <div style={{ fontSize: "11px", color: "#991b1b" }}>Loading discussion...</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "180px", overflowY: "auto" }}>
              {comments.length === 0 ? (
                <div style={{ fontSize: "11px", color: "#991b1b", fontStyle: "italic" }}>
                  No messages on this escalation yet. Use composer below to discuss resolution.
                </div>
              ) : (
                comments.map((ec) => (
                  <div key={ec.id} style={{ background: "#ffffff", padding: "6px 8px", borderRadius: "4px", border: "1px solid #fca5a5", fontSize: "11.5px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                      <strong style={{ color: "#7f1d1d" }}>{ec.user?.full_name || "User"}</strong>
                      <span style={{ color: "#991b1b", fontSize: "10px" }}>{new Date(ec.created_at).toLocaleString()}</span>
                    </div>
                    <div style={{ color: "#450a0a", whiteSpace: "pre-wrap" }}>{ec.message}</div>
                  </div>
                ))
              )}
            </div>
          )}

          <CommentComposer
            placeholder="Discuss resolution for this escalation..."
            onSubmit={handleSendComment}
            isSubmitting={submitting}
          />
        </div>
      )}
    </div>
  );
};

export const TaskDrawer: React.FC<TaskDrawerProps> = ({
  taskId,
  isOpen,
  onClose,
  onTaskUpdated,
  onEscalateRequest,
}) => {
  const { hasPermission, isSuperAdmin, profile } = useAuth();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active drawer tab
  const [drawerTab, setDrawerTab] = useState<
    "details" | "subtasks" | "dependencies" | "escalations" | "comments" | "timeline"
  >("details");

  // V2.0 Dependencies, Labels, Sprints, Approvals
  const [availableLabels, setAvailableLabels] = useState<TaskLabel[]>([]);
  const [availableSprints, setAvailableSprints] = useState<TaskSprint[]>([]);
  const [availableCandidateTasks, setAvailableCandidateTasks] = useState<{ id: string; title: string }[]>([]);
  const [isAddingDependency, setIsAddingDependency] = useState(false);
  const [depTaskId, setDepTaskId] = useState("");
  const [depType, setDepType] = useState<DependencyType>("BLOCKED_BY");
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState("");
  const [actioningApproval, setActioningApproval] = useState(false);

  // Inline editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");

  // On Hold State
  const [isHoldModalOpen, setIsHoldModalOpen] = useState(false);
  const [holdReasonDraft, setHoldReasonDraft] = useState("");
  const [holdUntilDraft, setHoldUntilDraft] = useState("");

  // Subtask creation state
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskDesc, setSubtaskDesc] = useState("");
  const [subtaskPriority, setSubtaskPriority] = useState<TaskPriority>("MEDIUM");
  const [subtaskStartDate, setSubtaskStartDate] = useState("");
  const [subtaskDueDate, setSubtaskDueDate] = useState("");
  const [subtaskAssigneeIds, setSubtaskAssigneeIds] = useState<string[]>([]);
  const [subtaskSubmitting, setSubtaskSubmitting] = useState(false);

  // Comment creation state
  const [postingComment, setPostingComment] = useState(false);

  // Attachments & Voice notes state
  const taskFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);

  // Assignee & Watcher add state with SearchableUserSelect
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);
  const [showAddAssignee, setShowAddAssignee] = useState(false);
  const [showAddWatcher, setShowAddWatcher] = useState(false);

  // Activity Timeline state
  const [timeline, setTimeline] = useState<TaskTimelineItem[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  const canManage = hasPermission("task.manage") || isSuperAdmin;
  const canAssign = hasPermission("task.assign") || canManage;
  const canEscalate = hasPermission("task.escalate") || canManage;

  const loadTask = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await tasksApi.getTask(id);
      setTask(data);
      setTitleDraft(data.title);
      setDescDraft(data.description || "");
      setHoldReasonDraft(data.hold_reason || "");
      setHoldUntilDraft(data.hold_until || "");
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Failed to load task details");
    } finally {
      setLoading(false);
    }
  };

  const loadTimeline = async (id: string) => {
    setLoadingTimeline(true);
    try {
      const items = await tasksApi.fetchTaskTimeline(id);
      setTimeline(items);
    } catch (err) {
      console.error("Failed to load timeline", err);
    } finally {
      setLoadingTimeline(false);
    }
  };

  const loadAvailableUsers = async () => {
    try {
      const users = await tasksApi.getAvailableAssignees();
      setAvailableUsers(users);
    } catch (err) {
      console.error("Failed to load users", err);
    }
  };

  const loadV2Data = async () => {
    try {
      const [labels, sprints, tasksRes] = await Promise.all([
        tasksApi.fetchLabels().catch(() => []),
        tasksApi.fetchSprints().catch(() => []),
        tasksApi.getTasks({ limit: 100 }).catch(() => ({ items: [] })),
      ]);
      setAvailableLabels(labels);
      setAvailableSprints(sprints);
      setAvailableCandidateTasks(tasksRes.items || []);
    } catch (err) {
      console.error("Failed to load V2 options", err);
    }
  };

  useEffect(() => {
    if (isOpen && taskId) {
      loadTask(taskId);
      loadAvailableUsers();
      loadTimeline(taskId);
      loadV2Data();
      setDrawerTab("details");
      setShowAddAssignee(false);
      setShowAddWatcher(false);
      setIsHoldModalOpen(false);
      setIsAddingDependency(false);
      setIsApprovalModalOpen(false);
    } else {
      setTask(null);
      setIsEditingTitle(false);
      setIsEditingDesc(false);
      setShowVoiceRecorder(false);
      setIsAddingSubtask(false);
      setShowAddAssignee(false);
      setShowAddWatcher(false);
      setIsHoldModalOpen(false);
      setIsAddingDependency(false);
      setIsApprovalModalOpen(false);
    }
  }, [isOpen, taskId]);

  // Global ESC key listener & body scroll lock for TaskDrawer & its sub-modals
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isHoldModalOpen) {
          setIsHoldModalOpen(false);
        } else if (isApprovalModalOpen) {
          setIsApprovalModalOpen(false);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, isHoldModalOpen, isApprovalModalOpen, onClose]);

  const handleIssueTypeChange = async (newType: IssueType) => {
    if (!task) return;
    try {
      const updated = await tasksApi.updateTask(task.id, { issue_type: newType });
      setTask(updated);
      onTaskUpdated();
      loadTimeline(task.id);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to update issue type");
    }
  };

  const handleParentTaskChange = async (parentId: string | null) => {
    if (!task) return;
    try {
      const updated = await tasksApi.updateTask(task.id, { parent_task_id: parentId });
      setTask(updated);
      onTaskUpdated();
      loadTimeline(task.id);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to update parent task");
    }
  };

  const handleSprintChange = async (sprintId: string | null) => {
    if (!task) return;
    try {
      const updated = await tasksApi.updateTask(task.id, { sprint_id: sprintId });
      setTask(updated);
      onTaskUpdated();
      loadTimeline(task.id);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to update sprint");
    }
  };

  const handleAddLabel = async (labelId: string) => {
    if (!task) return;
    try {
      await tasksApi.executeBulkAction({
        task_ids: [task.id],
        action: "ADD_LABEL",
        value: labelId,
      });
      loadTask(task.id);
      onTaskUpdated();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to add label");
    }
  };

  const handleRemoveLabel = async (labelId: string) => {
    if (!task) return;
    try {
      await tasksApi.executeBulkAction({
        task_ids: [task.id],
        action: "REMOVE_LABEL",
        value: labelId,
      });
      loadTask(task.id);
      onTaskUpdated();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to remove label");
    }
  };

  const handleToggleTaskReaction = async (emoji: string) => {
    if (!task) return;
    try {
      await tasksApi.toggleTaskReaction(task.id, emoji);
      await loadTask(task.id);
    } catch (err: any) {
      console.error("Failed to toggle reaction", err);
    }
  };

  const handleToggleCommentReaction = async (commentId: string, emoji: string) => {
    if (!task) return;
    try {
      await tasksApi.toggleCommentReaction(commentId, emoji);
      await loadTask(task.id);
    } catch (err: any) {
      console.error("Failed to toggle comment reaction", err);
    }
  };

  const handleAddDependency = async () => {
    if (!task || !depTaskId) return;
    try {
      await tasksApi.addTaskDependency(task.id, {
        depends_on_task_id: depTaskId,
        dependency_type: depType,
      });
      setIsAddingDependency(false);
      setDepTaskId("");
      await loadTask(task.id);
      loadTimeline(task.id);
      onTaskUpdated();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to add dependency link");
    }
  };

  const handleDeleteDependency = async (depId: string) => {
    if (!task) return;
    if (!confirm("Are you sure you want to remove this dependency?")) return;
    try {
      await tasksApi.deleteTaskDependency(depId);
      await loadTask(task.id);
      loadTimeline(task.id);
      onTaskUpdated();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to remove dependency");
    }
  };

  const handleSubmitApproval = async () => {
    if (!task) return;
    setActioningApproval(true);
    try {
      const updated = await tasksApi.submitTaskForApproval(task.id, {
        notes: approvalNotes.trim() || undefined,
      });
      setTask(updated);
      setIsApprovalModalOpen(false);
      setApprovalNotes("");
      loadTimeline(task.id);
      onTaskUpdated();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to submit for approval");
    } finally {
      setActioningApproval(false);
    }
  };

  const handleActionApproval = async (action: "APPROVE" | "REJECT") => {
    if (!task) return;
    setActioningApproval(true);
    try {
      const updated = await tasksApi.actionTaskApproval(task.id, {
        action,
        notes: approvalNotes.trim() || undefined,
      });
      setTask(updated);
      setApprovalNotes("");
      loadTimeline(task.id);
      onTaskUpdated();
    } catch (err: any) {
      alert(err?.response?.data?.detail || `Failed to ${action.toLowerCase()} task`);
    } finally {
      setActioningApproval(false);
    }
  };

  if (!isOpen) return null;

  const handleStatusChange = async (newStatus: TaskStatus) => {
    if (!task) return;
    if (newStatus === "ON_HOLD") {
      setHoldReasonDraft(task.hold_reason || "");
      setHoldUntilDraft(task.hold_until || "");
      setIsHoldModalOpen(true);
      return;
    }
    try {
      const updated = await tasksApi.updateTask(task.id, { status: newStatus });
      setTask(updated);
      onTaskUpdated();
      loadTimeline(task.id);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to update status");
    }
  };

  const handleConfirmHold = async () => {
    if (!task) return;
    try {
      const updated = await tasksApi.updateTask(task.id, {
        status: "ON_HOLD",
        hold_reason: holdReasonDraft.trim() || null,
        hold_until: holdUntilDraft || null,
      });
      setTask(updated);
      setIsHoldModalOpen(false);
      onTaskUpdated();
      loadTimeline(task.id);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to put task on hold");
    }
  };

  const handleResumeFromHold = async () => {
    if (!task) return;
    try {
      const updated = await tasksApi.updateTask(task.id, {
        status: "IN_PROGRESS",
      });
      setTask(updated);
      onTaskUpdated();
      loadTimeline(task.id);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to resume task");
    }
  };


  const handlePriorityChange = async (newPriority: TaskPriority) => {
    if (!task) return;
    try {
      const updated = await tasksApi.updateTask(task.id, { priority: newPriority });
      setTask(updated);
      onTaskUpdated();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to update priority");
    }
  };

  const handleStartDateChange = async (dateStr: string) => {
    if (!task) return;
    try {
      const updated = await tasksApi.updateTask(task.id, {
        start_date: dateStr ? dateStr : null,
      });
      setTask(updated);
      onTaskUpdated();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to update start date");
    }
  };

  const handleDueDateChange = async (dateStr: string) => {
    if (!task) return;
    try {
      const updated = await tasksApi.updateTask(task.id, {
        due_date: dateStr ? dateStr : null,
      });
      setTask(updated);
      onTaskUpdated();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to update due date");
    }
  };

  const handleSaveTitle = async () => {
    if (!task || !titleDraft.trim()) return;
    try {
      const updated = await tasksApi.updateTask(task.id, { title: titleDraft.trim() });
      setTask(updated);
      setIsEditingTitle(false);
      onTaskUpdated();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to save title");
    }
  };

  const handleSaveDesc = async () => {
    if (!task) return;
    try {
      const updated = await tasksApi.updateTask(task.id, { description: descDraft });
      setTask(updated);
      setIsEditingDesc(false);
      onTaskUpdated();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to save description");
    }
  };

  const handleAddAssignee = async (userId: string) => {
    if (!task || !userId) return;
    const currentAssigneeIds = task.assignees
      .filter((a) => a.assignment_role !== "WATCHER")
      .map((a) => a.user_id);
    if (currentAssigneeIds.includes(userId)) return;

    try {
      const updated = await tasksApi.assignTask(task.id, [...currentAssigneeIds, userId], "ASSIGNEE");
      setTask(updated);
      onTaskUpdated();
      loadTimeline(task.id);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to add assignee");
    }
  };

  const handleRemoveAssignee = async (userId: string) => {
    if (!task) return;
    const currentAssigneeIds = task.assignees
      .filter((a) => a.assignment_role !== "WATCHER")
      .map((a) => a.user_id)
      .filter((id) => id !== userId);

    try {
      const updated = await tasksApi.assignTask(task.id, currentAssigneeIds, "ASSIGNEE");
      setTask(updated);
      onTaskUpdated();
      loadTimeline(task.id);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to remove assignee");
    }
  };

  const handleAddWatcher = async (userId: string) => {
    if (!task || !userId) return;
    const currentWatcherIds = task.assignees
      .filter((a) => a.assignment_role === "WATCHER")
      .map((a) => a.user_id);
    if (currentWatcherIds.includes(userId)) return;

    try {
      const updated = await tasksApi.assignTask(task.id, [...currentWatcherIds, userId], "WATCHER");
      setTask(updated);
      onTaskUpdated();
      loadTimeline(task.id);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to add watcher");
    }
  };

  const handleRemoveWatcher = async (userId: string) => {
    if (!task) return;
    const currentWatcherIds = task.assignees
      .filter((a) => a.assignment_role === "WATCHER")
      .map((a) => a.user_id)
      .filter((id) => id !== userId);

    try {
      const updated = await tasksApi.assignTask(task.id, currentWatcherIds, "WATCHER");
      setTask(updated);
      onTaskUpdated();
      loadTimeline(task.id);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to remove watcher");
    }
  };

  const handleToggleSubtask = async (subtaskId: string, currentCompleted: boolean) => {
    if (!task) return;
    try {
      await tasksApi.updateSubtask(subtaskId, { completed: !currentCompleted });
      await loadTask(task.id);
      onTaskUpdated();
      loadTimeline(task.id);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to toggle subtask");
    }
  };

  const handleCreateSubtaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task || !subtaskTitle.trim() || subtaskSubmitting) return;

    setSubtaskSubmitting(true);
    try {
      await tasksApi.addSubtask(task.id, {
        title: subtaskTitle.trim(),
        description: subtaskDesc.trim() || undefined,
        priority: subtaskPriority,
        status: "TODO",
        start_date: subtaskStartDate || undefined,
        due_date: subtaskDueDate || undefined,
        assignee_ids: subtaskAssigneeIds.length > 0 ? subtaskAssigneeIds : undefined,
      });

      setSubtaskTitle("");
      setSubtaskDesc("");
      setSubtaskStartDate("");
      setSubtaskDueDate("");
      setSubtaskAssigneeIds([]);
      setIsAddingSubtask(false);

      await loadTask(task.id);
      onTaskUpdated();
      loadTimeline(task.id);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to add mini-task subtask");
    } finally {
      setSubtaskSubmitting(false);
    }
  };

  const handleDeleteSubtask = async (subtaskId: string) => {
    if (!task) return;
    if (!confirm("Are you sure you want to delete this subtask?")) return;
    try {
      await tasksApi.deleteSubtask(subtaskId);
      await loadTask(task.id);
      onTaskUpdated();
      loadTimeline(task.id);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to delete subtask");
    }
  };

  const handleUploadTaskAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!task || !files || files.length === 0) return;
    setUploadingAttachment(true);
    try {
      for (const file of Array.from(files)) {
        const uploaded = await tasksApi.uploadTaskFile(file);
        await tasksApi.addTaskAttachment(task.id, {
          file_url: uploaded.file_url,
          file_name: uploaded.file_name,
          file_size: uploaded.file_size,
          file_type: uploaded.file_type,
        });
      }
      await loadTask(task.id);
      loadTimeline(task.id);
      onTaskUpdated();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to upload file attachment");
    } finally {
      setUploadingAttachment(false);
      if (taskFileInputRef.current) taskFileInputRef.current.value = "";
    }
  };

  const handleDeleteTaskAttachment = async (attachmentId: string) => {
    if (!task) return;
    if (!confirm("Are you sure you want to remove this attachment?")) return;
    try {
      await tasksApi.deleteTaskAttachment(attachmentId);
      await loadTask(task.id);
      loadTimeline(task.id);
      onTaskUpdated();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to delete attachment");
    }
  };

  const handleSaveTaskVoiceNote = async (audioBlob: Blob, durationSeconds: number) => {
    if (!task) return;
    try {
      const uploaded = await tasksApi.uploadTaskFile(audioBlob, `voice_note_${Date.now()}.webm`);
      await tasksApi.addTaskVoiceNote(task.id, {
        audio_url: uploaded.file_url,
        duration_seconds: durationSeconds,
      });
      setShowVoiceRecorder(false);
      await loadTask(task.id);
      loadTimeline(task.id);
      onTaskUpdated();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to save voice note");
    }
  };

  const handleCreateTaskComment = async (data: CommentSubmitData) => {
    if (!task) return;
    setPostingComment(true);
    try {
      await tasksApi.addComment(task.id, {
        message: data.message.trim() || undefined,
        audio_url: data.audio_url,
        attachments: data.attachments,
      });

      await loadTask(task.id);
      loadTimeline(task.id);
      onTaskUpdated();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to post comment");
    } finally {
      setPostingComment(false);
    }
  };

  // Extract assignees vs watchers
  const assigneesList = task?.assignees.filter((a) => a.assignment_role !== "WATCHER") || [];
  const watchersList = task?.assignees.filter((a) => a.assignment_role === "WATCHER") || [];

  const subtaskCount = task?.subtasks.length || 0;
  const completedCount = task?.subtasks.filter((s) => s.completed || s.status === "DONE").length || 0;
  const progressPercent = subtaskCount > 0 ? Math.round((completedCount / subtaskCount) * 100) : 0;

  const overdue = isTaskOverdue(task?.due_date, task?.status);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(15, 23, 42, 0.4)",
        backdropFilter: "blur(2px)",
        zIndex: 9999,
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "680px",
          maxWidth: "100%",
          height: "100%",
          background: "#ffffff",
          boxShadow: "-8px 0 25px rgba(0,0,0,0.15)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid #e2e8f0",
            background: "#f8fafc",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "12px",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
              <span
                style={{
                  background: task?.status === "DONE" ? "#dcfce7" : task?.status === "IN_PROGRESS" ? "#eff6ff" : task?.status === "ON_HOLD" ? "#fef3c7" : "#f1f5f9",
                  color: task?.status === "DONE" ? "#166534" : task?.status === "IN_PROGRESS" ? "#1e40af" : task?.status === "ON_HOLD" ? "#92400e" : "#475569",
                  border: "1px solid #cbd5e1",
                  borderRadius: "12px",
                  padding: "2px 8px",
                  fontSize: "11px",
                  fontWeight: 700,
                }}
              >
                {task?.status === "ON_HOLD" ? "⏸️ ON HOLD" : task?.status?.replace("_", " ")}
              </span>
              <span
                style={{
                  background: task?.priority === "CRITICAL" ? "#ef4444" : task?.priority === "HIGH" ? "#f97316" : "#3b82f6",
                  color: "#ffffff",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontWeight: 700,
                }}
              >
                {task?.priority}
              </span>

              {/* Issue Type Badge / Selector */}
              <select
                value={task?.issue_type || "TASK"}
                onChange={(e) => handleIssueTypeChange(e.target.value as IssueType)}
                style={{
                  padding: "2px 8px",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontWeight: 700,
                  border: "1px solid #c7d2fe",
                  background: "#e0e7ff",
                  color: "#3730a3",
                  cursor: "pointer",
                }}
              >
                <option value="TASK">TASK</option>
                <option value="BUG">BUG</option>
                <option value="IMPROVEMENT">IMPROVEMENT</option>
                <option value="STORY">STORY</option>
                <option value="EPIC">EPIC</option>
                <option value="APPROVAL">APPROVAL</option>
              </select>

              {overdue && (
                <span style={{ background: "#fee2e2", color: "#991b1b", padding: "2px 8px", borderRadius: "12px", fontSize: "11px", fontWeight: 700 }}>
                  ⚠️ OVERDUE
                </span>
              )}
            </div>

            {isEditingTitle ? (
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "4px 8px",
                    fontSize: "15px",
                    fontWeight: 700,
                    borderRadius: "4px",
                    border: "1px solid #3b82f6",
                  }}
                  autoFocus
                />
                <button type="button" className="btn btn-small btn-primary" onClick={handleSaveTitle}>
                  Save
                </button>
                <button type="button" className="btn btn-small" onClick={() => setIsEditingTitle(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <h2
                onClick={() => setIsEditingTitle(true)}
                title="Click to edit title"
                style={{
                  margin: 0,
                  fontSize: "17px",
                  fontWeight: 700,
                  color: "#0f172a",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {task?.title || "Loading task..."}
                <span style={{ fontSize: "12px", color: "#94a3b8" }}>✏️</span>
              </h2>
            )}

            {/* Hierarchy & Sprints */}
            {(task?.parent_task_title || task?.sprint?.name || task?.sprint_name) && (
              <div style={{ display: "flex", gap: "10px", marginTop: "4px", fontSize: "11.5px" }}>
                {task.parent_task_title && (
                  <span style={{ color: "#4f46e5", fontWeight: 600 }}>
                    ↳ Epic / Parent: {task.parent_task_title}
                  </span>
                )}
                {(task.sprint?.name || task.sprint_name) && (
                  <span style={{ color: "#64748b" }}>
                    🏃 Sprint: {task.sprint?.name || task.sprint_name}
                  </span>
                )}
              </div>
            )}

            {/* Labels */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "6px", alignItems: "center" }}>
              {task?.labels &&
                task.labels.map((l) => (
                  <span
                    key={l.id}
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "1px 8px",
                      borderRadius: "10px",
                      border: `1px solid ${l.color}`,
                      color: l.color,
                      background: `${l.color}15`,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    {l.name}
                    <button
                      type="button"
                      onClick={() => handleRemoveLabel(l.id)}
                      title="Remove label"
                      style={{ background: "none", border: "none", cursor: "pointer", color: l.color, padding: 0, fontSize: "10px" }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              {availableLabels.filter((al) => !task?.labels?.some((tl) => tl.id === al.id)).length > 0 && (
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      handleAddLabel(e.target.value);
                      e.target.value = "";
                    }
                  }}
                  style={{
                    fontSize: "11px",
                    padding: "1px 6px",
                    borderRadius: "10px",
                    border: "1px dashed #cbd5e1",
                    background: "#f8fafc",
                    color: "#64748b",
                    cursor: "pointer",
                  }}
                >
                  <option value="" disabled>
                    + Label
                  </option>
                  {availableLabels
                    .filter((al) => !task?.labels?.some((tl) => tl.id === al.id))
                    .map((al) => (
                      <option key={al.id} value={al.id}>
                        {al.name}
                      </option>
                    ))}
                </select>
              )}
            </div>

            {/* Reactions on Task */}
            {task && (
              <div style={{ marginTop: "8px" }}>
                <ReactionPicker
                  reactions={task.reactions}
                  onToggleReaction={handleToggleTaskReaction}
                />
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {canEscalate && onEscalateRequest && task && (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => onEscalateRequest(task)}
                style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", fontWeight: 600, fontSize: "12px" }}
              >
                ⚡ Escalate
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                fontSize: "20px",
                cursor: "pointer",
                color: "#64748b",
                padding: "2px",
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Drawer Tabs Navigation */}
        <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", background: "#ffffff" }}>
          {[
            { key: "details", label: "Overview", icon: "📋" },
            { key: "subtasks", label: `Mini-Tasks (${subtaskCount})`, icon: "✅" },
            { key: "dependencies", label: `Dependencies (${task?.dependencies?.length || 0})`, icon: "🔗" },
            { key: "escalations", label: `Escalations (${task?.escalations.length || 0})`, icon: "⚡" },
            { key: "comments", label: `Comments (${task?.comments.length || 0})`, icon: "💬" },
            { key: "timeline", label: "Timeline", icon: "🕒" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setDrawerTab(tab.key as any)}
              style={{
                flex: 1,
                padding: "10px 4px",
                fontSize: "12.5px",
                fontWeight: 600,
                background: "transparent",
                border: "none",
                borderBottom: drawerTab === tab.key ? "2px solid #2563eb" : "2px solid transparent",
                color: drawerTab === tab.key ? "#2563eb" : "#64748b",
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Drawer Content Area */}
        <div style={{ padding: "20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "18px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>Loading details...</div>
          ) : !task ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#ef4444" }}>{error || "Task not found."}</div>
          ) : drawerTab === "details" ? (
            <>
              {/* Progress Bar */}
              <div style={{ background: "#f8fafc", padding: "12px 14px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px", fontSize: "12.5px" }}>
                  <span style={{ fontWeight: 600, color: "#334155" }}>Overall Task Progress</span>
                  <span style={{ fontWeight: 700, color: progressPercent === 100 ? "#16a34a" : "#2563eb" }}>
                    {progressPercent}% ({completedCount}/{subtaskCount} Subtasks Done)
                  </span>
                </div>
                <div style={{ height: "7px", background: "#e2e8f0", borderRadius: "4px", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${progressPercent}%`,
                      background: progressPercent === 100 ? "#16a34a" : "#2563eb",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>

              {/* On Hold Banner */}
              {task.status === "ON_HOLD" && (
                <div
                  style={{
                    background: "#fffbeb",
                    border: "1px solid #fde68a",
                    borderRadius: "8px",
                    padding: "14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "18px" }}>⏸️</span>
                      <div>
                        <span style={{ fontWeight: 700, color: "#92400e", fontSize: "13.5px" }}>
                          This Task is Currently On Hold
                        </span>
                        {task.hold_until && (
                          <div style={{ fontSize: "11.5px", color: "#a16207" }}>
                            Scheduled until: <strong>{task.hold_until}</strong>
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        type="button"
                        onClick={() => setIsHoldModalOpen(true)}
                        className="btn btn-small"
                        style={{ fontSize: "11.5px", padding: "3px 8px", background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}
                      >
                        ✏️ Edit Hold
                      </button>
                      <button
                        type="button"
                        onClick={handleResumeFromHold}
                        className="btn btn-small btn-primary"
                        style={{ fontSize: "11.5px", padding: "3px 10px", background: "#16a34a", borderColor: "#15803d" }}
                      >
                        ▶️ Resume Task
                      </button>
                    </div>
                  </div>
                  {task.hold_reason && (
                    <div style={{ fontSize: "12.5px", color: "#78350f", background: "#ffffff", padding: "8px 10px", borderRadius: "6px", border: "1px solid #fef08a" }}>
                      <strong>Hold Reason:</strong> {task.hold_reason}
                    </div>
                  )}
                </div>
              )}

              {/* Approval Workflow Banner & Actions */}
              {(task.status === "PENDING_APPROVAL" || task.approval_status === "PENDING_APPROVAL") && (
                <div
                  style={{
                    background: "#faf5ff",
                    border: "1px solid #d8b4fe",
                    borderRadius: "8px",
                    padding: "14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "18px" }}>⏳</span>
                      <div>
                        <span style={{ fontWeight: 700, color: "#6b21a8", fontSize: "13.5px" }}>
                          Pending Manager Approval
                        </span>
                        {task.approval_notes && (
                          <div style={{ fontSize: "11.5px", color: "#7e22ce", marginTop: "2px" }}>
                            Submission Note: "{task.approval_notes}"
                          </div>
                        )}
                      </div>
                    </div>
                    <span style={{ fontSize: "11px", fontWeight: 700, background: "#f3e8ff", color: "#7e22ce", padding: "2px 8px", borderRadius: "10px" }}>
                      APPROVAL REQUIRED
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: "8px", paddingTop: "4px" }}>
                    <button
                      type="button"
                      onClick={() => handleActionApproval("APPROVE")}
                      disabled={actioningApproval}
                      style={{
                        padding: "6px 14px",
                        background: "#16a34a",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {actioningApproval ? "Processing..." : "✓ Approve & Complete"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleActionApproval("REJECT")}
                      disabled={actioningApproval}
                      style={{
                        padding: "6px 14px",
                        background: "#dc2626",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {actioningApproval ? "Processing..." : "✕ Reject Task"}
                    </button>
                  </div>
                </div>
              )}

              {/* Submit for Approval Button if not already pending */}
              {task.status !== "PENDING_APPROVAL" && task.status !== "DONE" && (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => setIsApprovalModalOpen(true)}
                    style={{
                      background: "#ede9fe",
                      color: "#6d28d9",
                      border: "1px solid #ddd6fe",
                      borderRadius: "6px",
                      padding: "5px 12px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>📬 Submit for Approval</span>
                  </button>
                </div>
              )}

              {/* Status & Priority Selectors */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                    Status
                  </label>
                  <select
                    value={task.status}
                    onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
                    style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                  >
                    <option value="TODO">To Do</option>
                    <option value="IN_PROGRESS">In Progress</option>
                    <option value="ON_HOLD">⏸️ On Hold</option>
                    <option value="DONE">Completed</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                    Priority
                  </label>
                  <select
                    value={task.priority}
                    onChange={(e) => handlePriorityChange(e.target.value as TaskPriority)}
                    style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
              </div>

              {/* Parent / Epic and Sprint Row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                    Parent / Epic
                  </label>
                  <select
                    value={task.parent_task_id || ""}
                    onChange={(e) => handleParentTaskChange(e.target.value || null)}
                    style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                  >
                    <option value="">None (Standalone / Epic)</option>
                    {availableCandidateTasks
                      .filter((ct) => ct.id !== task.id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                    Sprint Bucket
                  </label>
                  <select
                    value={task.sprint_id || ""}
                    onChange={(e) => handleSprintChange(e.target.value || null)}
                    style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                  >
                    <option value="">📦 Product Backlog</option>
                    {availableSprints.map((s) => (
                      <option key={s.id} value={s.id}>
                        🏃 {s.name} ({s.status})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Dates */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={task.start_date || ""}
                    onChange={(e) => handleStartDateChange(e.target.value)}
                    style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={task.due_date || ""}
                    onChange={(e) => handleDueDateChange(e.target.value)}
                    style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                  />
                </div>
              </div>

              {/* Owner */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 14px" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "6px" }}>
                  TASK CREATOR / OWNER
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#475569", fontSize: "13px" }}>
                    {task.creator?.full_name ? task.creator.full_name[0].toUpperCase() : "U"}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: "#1e293b", fontSize: "13.5px" }}>
                      {task.creator?.full_name || "ERP User"}
                    </div>
                    {task.creator?.email && (
                      <div style={{ fontSize: "11.5px", color: "#64748b" }}>{task.creator.email}</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Assignees */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b" }}>
                    👥 ASSIGNEES ({assigneesList.length})
                  </span>
                  {canAssign && (
                    <button
                      type="button"
                      onClick={() => setShowAddAssignee(!showAddAssignee)}
                      style={{
                        background: showAddAssignee ? "#eff6ff" : "transparent",
                        border: "1px solid #bfdbfe",
                        borderRadius: "4px",
                        color: "#2563eb",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: 600,
                        padding: "2px 8px",
                      }}
                    >
                      {showAddAssignee ? "Cancel" : "+ Add Assignee"}
                    </button>
                  )}
                </div>

                {showAddAssignee && (
                  <div style={{ marginBottom: "10px" }}>
                    <SearchableUserSelect
                      users={availableUsers}
                      selectedUserIds={[]}
                      onChange={(ids) => {
                        if (ids.length > 0) {
                          handleAddAssignee(ids[0]);
                          setShowAddAssignee(false);
                        }
                      }}
                      multiple={false}
                      placeholder="Search team member to assign..."
                    />
                  </div>
                )}

                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {assigneesList.length === 0 ? (
                    <span style={{ fontSize: "12.5px", color: "#94a3b8", fontStyle: "italic" }}>No assignees yet.</span>
                  ) : (
                    assigneesList.map((a) => {
                      const u = availableUsers.find((user) => user.id === a.user_id) || a.user;
                      const name = u?.full_name || a.user?.full_name || "User";
                      const dept = getUserDepartment(u as any);
                      return (
                        <span
                          key={a.id}
                          style={{
                            background: "#eff6ff",
                            border: "1px solid #bfdbfe",
                            borderRadius: "16px",
                            padding: "3px 10px",
                            fontSize: "12px",
                            fontWeight: 500,
                            color: "#1e40af",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <span
                            style={{
                              width: "18px",
                              height: "18px",
                              borderRadius: "50%",
                              background: "#3b82f6",
                              color: "#ffffff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "9px",
                              fontWeight: 700,
                            }}
                          >
                            {getUserInitials(name)}
                          </span>
                          <span>{name}</span>
                          <span style={{ fontSize: "11px", color: "#64748b" }}>({dept})</span>
                          {canAssign && (
                            <button
                              type="button"
                              onClick={() => handleRemoveAssignee(a.user_id)}
                              style={{
                                border: "none",
                                background: "transparent",
                                color: "#3b82f6",
                                cursor: "pointer",
                                fontSize: "12px",
                                lineHeight: 1,
                                fontWeight: "bold",
                              }}
                              title={`Remove ${name}`}
                            >
                              ✕
                            </button>
                          )}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Watchers */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b" }}>
                    👁️ WATCHERS ({watchersList.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAddWatcher(!showAddWatcher)}
                    style={{
                      background: showAddWatcher ? "#faf5ff" : "transparent",
                      border: "1px solid #e9d5ff",
                      borderRadius: "4px",
                      color: "#9333ea",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: 600,
                      padding: "2px 8px",
                    }}
                  >
                    {showAddWatcher ? "Cancel" : "+ Add Watcher"}
                  </button>
                </div>

                {showAddWatcher && (
                  <div style={{ marginBottom: "10px" }}>
                    <SearchableUserSelect
                      users={availableUsers}
                      selectedUserIds={[]}
                      onChange={(ids) => {
                        if (ids.length > 0) {
                          handleAddWatcher(ids[0]);
                          setShowAddWatcher(false);
                        }
                      }}
                      multiple={false}
                      placeholder="Search user to add as watcher..."
                    />
                  </div>
                )}

                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {watchersList.length === 0 ? (
                    <span style={{ fontSize: "12.5px", color: "#94a3b8", fontStyle: "italic" }}>No watchers added.</span>
                  ) : (
                    watchersList.map((w) => {
                      const u = availableUsers.find((user) => user.id === w.user_id) || w.user;
                      const name = u?.full_name || w.user?.full_name || "User";
                      const dept = getUserDepartment(u as any);
                      return (
                        <span
                          key={w.id}
                          style={{
                            background: "#faf5ff",
                            border: "1px solid #e9d5ff",
                            borderRadius: "16px",
                            padding: "3px 10px",
                            fontSize: "12px",
                            fontWeight: 500,
                            color: "#6b21a8",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <span
                            style={{
                              width: "18px",
                              height: "18px",
                              borderRadius: "50%",
                              background: "#8b5cf6",
                              color: "#ffffff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "9px",
                              fontWeight: 700,
                            }}
                          >
                            {getUserInitials(name)}
                          </span>
                          <span>{name}</span>
                          <span style={{ fontSize: "11px", color: "#64748b" }}>({dept})</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveWatcher(w.user_id)}
                            style={{
                              border: "none",
                              background: "transparent",
                              color: "#9333ea",
                              cursor: "pointer",
                              fontSize: "12px",
                              lineHeight: 1,
                              fontWeight: "bold",
                            }}
                            title={`Remove ${name}`}
                          >
                            ✕
                          </button>
                        </span>
                      );
                    })
                  )}
                </div>
              </div>


              {/* Description */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b" }}>DESCRIPTION</span>
                  {!isEditingDesc && (
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => setIsEditingDesc(true)}
                      style={{ fontSize: "11px", padding: "2px 8px" }}
                    >
                      ✏️ Edit
                    </button>
                  )}
                </div>

                {isEditingDesc ? (
                  <div>
                    <textarea
                      rows={4}
                      value={descDraft}
                      onChange={(e) => setDescDraft(e.target.value)}
                      style={{ width: "100%", padding: "8px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px" }}
                    />
                    <div style={{ display: "flex", gap: "8px", marginTop: "6px", justifyContent: "flex-end" }}>
                      <button type="button" className="btn btn-small" onClick={() => setIsEditingDesc(false)}>
                        Cancel
                      </button>
                      <button type="button" className="btn btn-small btn-primary" onClick={handleSaveDesc}>
                        Save Description
                      </button>
                    </div>
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: "13.5px", color: task.description ? "#334155" : "#94a3b8", whiteSpace: "pre-wrap" }}>
                    {task.description || "No description provided."}
                  </p>
                )}
              </div>

              {/* Task Attachments Section */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b" }}>
                    📎 TASK ATTACHMENTS ({task.attachments?.length || 0})
                  </span>
                  <div>
                    <input
                      type="file"
                      ref={taskFileInputRef}
                      style={{ display: "none" }}
                      multiple
                      onChange={handleUploadTaskAttachment}
                    />
                    <button
                      type="button"
                      disabled={uploadingAttachment}
                      onClick={() => taskFileInputRef.current?.click()}
                      style={{
                        background: "#eff6ff",
                        border: "1px solid #bfdbfe",
                        borderRadius: "4px",
                        color: "#2563eb",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: 600,
                        padding: "2px 8px",
                      }}
                    >
                      {uploadingAttachment ? "Uploading..." : "+ Add Files"}
                    </button>
                  </div>
                </div>

                <AttachmentList
                  attachments={task.attachments || []}
                  onDelete={(item) => item.id && handleDeleteTaskAttachment(item.id)}
                  canDelete={canManage || task.created_by === profile?.id}
                />
              </div>

              {/* Task Voice Notes Section */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b" }}>
                    🎤 VOICE NOTES ({task.voice_notes?.length || 0})
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowVoiceRecorder(!showVoiceRecorder)}
                    style={{
                      background: showVoiceRecorder ? "#fee2e2" : "#f0fdf4",
                      border: showVoiceRecorder ? "1px solid #fca5a5" : "1px solid #bbf7d0",
                      borderRadius: "4px",
                      color: showVoiceRecorder ? "#dc2626" : "#16a34a",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: 600,
                      padding: "2px 8px",
                    }}
                  >
                    {showVoiceRecorder ? "Cancel" : "🎤 Record Voice Note"}
                  </button>
                </div>

                {showVoiceRecorder && (
                  <div style={{ marginBottom: "12px" }}>
                    <VoiceNoteRecorder
                      onRecordingComplete={handleSaveTaskVoiceNote}
                      onCancel={() => setShowVoiceRecorder(false)}
                    />
                  </div>
                )}

                {(!task.voice_notes || task.voice_notes.length === 0) ? (
                  <span style={{ fontSize: "12.5px", color: "#94a3b8", fontStyle: "italic" }}>
                    No voice notes recorded yet.
                  </span>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {task.voice_notes.map((vn) => (
                      <div
                        key={vn.id}
                        style={{
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          borderRadius: "6px",
                          padding: "8px 12px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "#64748b" }}>
                          <span style={{ fontWeight: 600, color: "#334155" }}>
                            Recorded by {vn.uploader?.full_name || "Team Member"}
                          </span>
                          <span>{new Date(vn.created_at).toLocaleString()}</span>
                        </div>
                        <audio controls src={vn.audio_url} style={{ width: "100%", height: "36px" }} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : drawerTab === "subtasks" ? (
            /* Subtasks (Mini-Tasks) Tab */
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b" }}>
                  Mini-Task Subtasks ({task.subtasks.length})
                </span>
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={() => setIsAddingSubtask(!isAddingSubtask)}
                  style={{ fontSize: "12px" }}
                >
                  {isAddingSubtask ? "Cancel" : "+ Add Mini-Task"}
                </button>
              </div>

              {/* Inline Subtask Form */}
              {isAddingSubtask && (
                <form
                  onSubmit={handleCreateSubtaskSubmit}
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #bfdbfe",
                    borderRadius: "8px",
                    padding: "14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <h4 style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#1e40af" }}>
                    Create Mini-Task
                  </h4>
                  <input
                    type="text"
                    placeholder="Mini-task title (e.g. Login API endpoint)"
                    value={subtaskTitle}
                    onChange={(e) => setSubtaskTitle(e.target.value)}
                    required
                    style={{ padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                  />
                  <input
                    type="text"
                    placeholder="Optional notes or details"
                    value={subtaskDesc}
                    onChange={(e) => setSubtaskDesc(e.target.value)}
                    style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px" }}
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                    <select
                      value={subtaskPriority}
                      onChange={(e) => setSubtaskPriority(e.target.value as TaskPriority)}
                      style={{ padding: "6px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                    >
                      <option value="LOW">Low Priority</option>
                      <option value="MEDIUM">Medium Priority</option>
                      <option value="HIGH">High Priority</option>
                      <option value="CRITICAL">Critical Priority</option>
                    </select>
                    <input
                      type="date"
                      value={subtaskStartDate}
                      onChange={(e) => setSubtaskStartDate(e.target.value)}
                      title="Start date"
                      style={{ padding: "5px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                    />
                    <input
                      type="date"
                      value={subtaskDueDate}
                      onChange={(e) => setSubtaskDueDate(e.target.value)}
                      title="Due date"
                      style={{ padding: "5px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                    />
                  </div>

                  {/* Multi-assign for subtask */}
                  <div>
                    <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                      Assignees:
                    </label>
                    <SearchableUserSelect
                      users={availableUsers}
                      selectedUserIds={subtaskAssigneeIds}
                      onChange={setSubtaskAssigneeIds}
                      multiple={true}
                      placeholder="Search subtask team members..."
                    />
                  </div>


                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" }}>
                    <button type="button" className="btn btn-small" onClick={() => setIsAddingSubtask(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-small btn-primary" disabled={subtaskSubmitting}>
                      {subtaskSubmitting ? "Adding..." : "Add Mini-Task"}
                    </button>
                  </div>
                </form>
              )}

              {/* Subtasks List */}
              {task.subtasks.length === 0 ? (
                <div style={{ textAlign: "center", padding: "30px", color: "#94a3b8", fontSize: "13px", border: "1px dashed #cbd5e1", borderRadius: "8px" }}>
                  No subtasks on this task yet. Click "+ Add Mini-Task" above.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {task.subtasks.map((s) => {
                    const isDone = s.completed || s.status === "DONE";
                    return (
                      <div
                        key={s.id}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: "8px",
                          padding: "10px 14px",
                          background: isDone ? "#f8fafc" : "#ffffff",
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", flex: 1, minWidth: 0 }}>
                            <input
                              type="checkbox"
                              checked={isDone}
                              onChange={() => handleToggleSubtask(s.id, isDone)}
                              style={{ cursor: "pointer", width: "16px", height: "16px" }}
                            />
                            <span
                              style={{
                                fontSize: "13.5px",
                                fontWeight: 600,
                                color: isDone ? "#94a3b8" : "#1e293b",
                                textDecoration: isDone ? "line-through" : "none",
                              }}
                            >
                              {s.title}
                            </span>
                          </label>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            {s.priority && (
                              <span style={{ fontSize: "10.5px", padding: "1px 6px", borderRadius: "4px", background: "#f1f5f9", color: "#475569", fontWeight: 600 }}>
                                {s.priority}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteSubtask(s.id)}
                              style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "13px" }}
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        {s.description && (
                          <div style={{ fontSize: "12px", color: "#64748b", marginLeft: "24px" }}>
                            {s.description}
                          </div>
                        )}

                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginLeft: "24px", fontSize: "11px", color: "#64748b" }}>
                          <div>
                            {s.due_date && <span>📅 Due: {s.due_date}</span>}
                          </div>
                          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                            {s.assignees && s.assignees.length > 0 ? (
                              s.assignees.map((sa) => (
                                <span key={sa.id} style={{ background: "#e0f2fe", color: "#0369a1", padding: "1px 5px", borderRadius: "10px", fontSize: "10px" }}>
                                  {sa.user?.full_name || "Assignee"}
                                </span>
                              ))
                            ) : s.assignee ? (
                              <span style={{ background: "#e0f2fe", color: "#0369a1", padding: "1px 5px", borderRadius: "10px", fontSize: "10px" }}>
                                {s.assignee.full_name}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        {/* Stage-Level Subtask Collaboration */}
                        <SubtaskCollaborationSection subtaskId={s.id} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : drawerTab === "dependencies" ? (
            /* Dependencies & Blockers Tab */
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b" }}>
                  Linked Dependencies &amp; Blockers ({task.dependencies?.length || 0})
                </span>
                <button
                  type="button"
                  onClick={() => setIsAddingDependency(!isAddingDependency)}
                  style={{
                    background: "#e0e7ff",
                    color: "#4338ca",
                    border: "1px solid #c7d2fe",
                    fontWeight: 600,
                    fontSize: "12px",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  {isAddingDependency ? "Cancel" : "+ Link Task"}
                </button>
              </div>

              {/* Add Dependency Form */}
              {isAddingDependency && (
                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                    padding: "12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: "10px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                        Relationship
                      </label>
                      <select
                        value={depType}
                        onChange={(e) => setDepType(e.target.value as DependencyType)}
                        style={{ width: "100%", padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "12px" }}
                      >
                        <option value="BLOCKED_BY">This task is BLOCKED BY</option>
                        <option value="BLOCKS">This task BLOCKS</option>
                        <option value="RELATES_TO">This task RELATES TO</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                        Target Task
                      </label>
                      <select
                        value={depTaskId}
                        onChange={(e) => setDepTaskId(e.target.value)}
                        style={{ width: "100%", padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "12px" }}
                      >
                        <option value="" disabled>
                          Select candidate task...
                        </option>
                        {availableCandidateTasks
                          .filter((t) => t.id !== task.id)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.title}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddDependency}
                    disabled={!depTaskId}
                    style={{
                      alignSelf: "flex-end",
                      padding: "6px 14px",
                      background: depTaskId ? "#4f46e5" : "#cbd5e1",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: depTaskId ? "pointer" : "not-allowed",
                    }}
                  >
                    Add Dependency Link
                  </button>
                </div>
              )}

              {/* Dependency Links List */}
              {(!task.dependencies || task.dependencies.length === 0) ? (
                <div style={{ textAlign: "center", padding: "30px", color: "#94a3b8", fontSize: "13px", border: "1px dashed #cbd5e1", borderRadius: "8px" }}>
                  No dependencies or blockers linked to this task.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {task.dependencies.map((dep) => (
                    <div
                      key={dep.id}
                      style={{
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        padding: "10px 12px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            padding: "2px 6px",
                            borderRadius: "4px",
                            background:
                              dep.dependency_type === "BLOCKED_BY"
                                ? "#fee2e2"
                                : dep.dependency_type === "BLOCKS"
                                ? "#fef3c7"
                                : "#e0e7ff",
                            color:
                              dep.dependency_type === "BLOCKED_BY"
                                ? "#991b1b"
                                : dep.dependency_type === "BLOCKS"
                                ? "#92400e"
                                : "#3730a3",
                          }}
                        >
                          {dep.dependency_type?.replace(/_/g, " ")}
                        </span>
                        <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#1e293b" }}>
                          {dep.depends_on_task_title || "Linked Task"}
                        </span>
                        {dep.depends_on_task_status && (
                          <span style={{ fontSize: "10px", color: "#64748b", background: "#f1f5f9", padding: "1px 5px", borderRadius: "4px" }}>
                            {dep.depends_on_task_status}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteDependency(dep.id)}
                        style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "14px" }}
                        title="Remove dependency link"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : drawerTab === "escalations" ? (
            /* Escalation History Tab */
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b" }}>
                  Unlimited Escalation Records ({task.escalations.length})
                </span>
                {onEscalateRequest && (
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => onEscalateRequest(task)}
                    style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", fontWeight: 600, fontSize: "12px" }}
                  >
                    ⚡ + New Escalation
                  </button>
                )}
              </div>

              {task.escalations.length === 0 ? (
                <div style={{ textAlign: "center", padding: "30px", color: "#94a3b8", fontSize: "13px", border: "1px dashed #cbd5e1", borderRadius: "8px" }}>
                  No escalations recorded for this task.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {task.escalations.map((esc, idx) => (
                    <div
                      key={esc.id}
                      style={{
                        background: "#fff5f5",
                        border: "1px solid #fed7d7",
                        borderRadius: "8px",
                        padding: "12px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, color: "#991b1b", fontSize: "12.5px" }}>
                          #{idx + 1} Escalated to {esc.to_user_rel?.full_name || "Manager"}
                        </span>
                        <span style={{ fontSize: "11px", color: "#7f1d1d", background: "#fee2e2", padding: "1px 6px", borderRadius: "4px" }}>
                          {esc.escalation_type?.replace(/_/g, " ") || "ORGANIZATION"}
                        </span>
                      </div>
                      <div style={{ fontSize: "13px", color: "#450a0a" }}>
                        "{esc.reason}"
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#991b1b" }}>
                        <span>From: {esc.from_user_rel?.full_name || "User"}</span>
                        <span>{new Date(esc.created_at).toLocaleString()}</span>
                      </div>
                      {esc.due_date && (
                        <div style={{ fontSize: "11.5px", fontWeight: 600, color: "#b91c1c" }}>
                          🎯 Resolution Due: {esc.due_date}
                        </div>
                      )}

                      {/* Independent Escalation Discussion */}
                      <EscalationCollaborationSection escalationId={esc.id} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : drawerTab === "comments" ? (
            /* Comments Tab */
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <CommentComposer
                placeholder="Write a comment, attach files or record a voice note..."
                onSubmit={handleCreateTaskComment}
                isSubmitting={postingComment}
              />

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {task.comments.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "24px", color: "#94a3b8", fontSize: "13px" }}>
                    No comments yet. Start the discussion above.
                  </div>
                ) : (
                  task.comments.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        padding: "10px 12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 600, fontSize: "12.5px", color: "#1e293b" }}>
                          {c.user?.full_name || "Team Member"}
                        </span>
                        <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                          {new Date(c.created_at).toLocaleString()}
                        </span>
                      </div>
                      {c.message && (
                        <div style={{ fontSize: "13px", color: "#334155", whiteSpace: "pre-wrap" }}>
                          {c.message}
                        </div>
                      )}
                      {c.audio_url && (
                        <div style={{ marginTop: "4px" }}>
                          <audio controls src={c.audio_url} style={{ width: "100%", height: "36px" }} />
                        </div>
                      )}
                      {c.attachments && c.attachments.length > 0 && (
                        <div style={{ marginTop: "4px" }}>
                          <AttachmentList attachments={c.attachments} />
                        </div>
                      )}
                      {/* Comment Emoji Reaction */}
                      <div style={{ marginTop: "4px" }}>
                        <ReactionPicker
                          size="sm"
                          reactions={c.reactions}
                          onToggleReaction={(emoji) => handleToggleCommentReaction(c.id, emoji)}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            /* Timeline Tab */
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <span style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b" }}>
                Chronological Activity Stream
              </span>

              {loadingTimeline ? (
                <div style={{ textAlign: "center", padding: "30px", color: "#64748b" }}>Loading timeline...</div>
              ) : timeline.length === 0 ? (
                <div style={{ textAlign: "center", padding: "30px", color: "#94a3b8", fontSize: "13px" }}>
                  No timeline events recorded.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", position: "relative", paddingLeft: "16px", borderLeft: "2px solid #e2e8f0" }}>
                  {timeline.map((evt) => (
                    <div key={evt.id} style={{ position: "relative", display: "flex", flexDirection: "column", gap: "2px" }}>
                      <div
                        style={{
                          position: "absolute",
                          left: "-22px",
                          top: "4px",
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          background: evt.event_type.includes("COMPLETED") ? "#16a34a" : evt.event_type.includes("ESCALATED") ? "#dc2626" : "#3b82f6",
                          border: "2px solid #ffffff",
                        }}
                      />
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11.5px" }}>
                        <span style={{ fontWeight: 600, color: "#1e293b" }}>
                          {evt.actor_name || evt.user?.full_name || "System"}
                        </span>
                        <span style={{ color: "#94a3b8", fontSize: "11px" }}>
                          {new Date(evt.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <div style={{ fontSize: "12.5px", color: "#475569" }}>
                        {evt.description}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* On Hold Modal Dialog */}
      {isHoldModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.55)",
            backdropFilter: "blur(3px)",
            zIndex: 10005,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
          onClick={() => setIsHoldModalOpen(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "12px",
              width: "480px",
              maxWidth: "100%",
              padding: "20px",
              boxShadow: "0 20px 30px rgba(0,0,0,0.22)",
              border: "1px solid #fde68a",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "20px" }}>⏸️</span>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#92400e" }}>
                  Put Task On Hold
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsHoldModalOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: "18px",
                  cursor: "pointer",
                  color: "#92400e",
                  lineHeight: 1,
                  padding: "4px",
                }}
                title="Close"
              >
                ✕
              </button>
            </div>
            <p style={{ fontSize: "12.5px", color: "#78350f", margin: "0 0 14px" }}>
              Specify a reason for placing this task on hold and an optional expected resume date. All assignees and watchers will be notified.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Reason for Hold <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Awaiting client review, pending vendor delivery, external blocker..."
                  value={holdReasonDraft}
                  onChange={(e) => setHoldReasonDraft(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Hold Until Date (Optional)
                </label>
                <input
                  type="date"
                  value={holdUntilDraft}
                  onChange={(e) => setHoldUntilDraft(e.target.value)}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "6px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsHoldModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ background: "#d97706", borderColor: "#b45309" }}
                  onClick={handleConfirmHold}
                  disabled={!holdReasonDraft.trim()}
                >
                  Confirm On Hold
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Submit for Approval Modal Dialog */}
      {isApprovalModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.55)",
            backdropFilter: "blur(3px)",
            zIndex: 10005,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
          onClick={() => setIsApprovalModalOpen(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "12px",
              width: "480px",
              maxWidth: "100%",
              padding: "20px",
              boxShadow: "0 20px 30px rgba(0,0,0,0.22)",
              border: "1px solid #ddd6fe",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "20px" }}>📬</span>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#6b21a8" }}>
                  Submit Task for Approval
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsApprovalModalOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: "18px",
                  cursor: "pointer",
                  color: "#6b21a8",
                  lineHeight: 1,
                  padding: "4px",
                }}
                title="Close"
              >
                ✕
              </button>
            </div>
            <p style={{ fontSize: "12.5px", color: "#6b21a8", margin: "0 0 14px" }}>
              Submit this task for manager sign-off. The status will update to PENDING_APPROVAL and the manager will be alerted.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Notes / Summary for Approver
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. All deliverables completed, tested and verified. Ready for sign-off."
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "6px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsApprovalModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ background: "#7c3aed", borderColor: "#6d28d9" }}
                  onClick={handleSubmitApproval}
                  disabled={actioningApproval}
                >
                  {actioningApproval ? "Submitting..." : "Submit for Approval"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
