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
import { InlineTextSkeleton } from "@/components/Skeleton";


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

const SubtaskCollaborationSection: React.FC<{ subtaskId: string; readOnly?: boolean }> = ({
  subtaskId,
  readOnly = false,
}) => {
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
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }} aria-hidden="true">
              <span className="skeleton-line" style={{ width: "60%", height: 12 }} />
              <span className="skeleton-line" style={{ width: "80%", height: 12 }} />
            </div>
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
              {!readOnly && (
                <CommentComposer
                  placeholder="Comment on this subtask or attach files..."
                  onSubmit={handleSendComment}
                  isSubmitting={submitting}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const EscalationCollaborationSection: React.FC<{ escalationId: string; readOnly?: boolean }> = ({
  escalationId,
  readOnly = false,
}) => {
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
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }} aria-hidden="true">
              <span className="skeleton-line" style={{ width: "50%", height: 12 }} />
              <span className="skeleton-line" style={{ width: "75%", height: 12 }} />
            </div>
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

          {!readOnly && (
            <CommentComposer
              placeholder="Discuss resolution for this escalation..."
              onSubmit={handleSendComment}
              isSubmitting={submitting}
            />
          )}
        </div>
      )}
    </div>
  );
};

interface TaskDrawerProps {
  taskId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onTaskUpdated: () => void;
  onEscalateRequest?: (task: TaskDetail) => void;
  initialTab?: "details" | "subtasks" | "dependencies" | "escalations" | "comments" | "timeline";
}


export const TaskDrawer: React.FC<TaskDrawerProps> = ({
  taskId,
  isOpen,
  onClose,
  onTaskUpdated,
  onEscalateRequest,
  initialTab,
}) => {
  const { hasPermission, isSuperAdmin, profile } = useAuth();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active drawer tab
  const [drawerTab, setDrawerTab] = useState<
    "details" | "subtasks" | "dependencies" | "escalations" | "comments" | "timeline"
  >(initialTab || "details");

  useEffect(() => {
    if (initialTab) {
      setDrawerTab(initialTab);
    }
  }, [initialTab]);

  // V2.0 Dependencies, Labels, Sprints, Approvals
  const [availableLabels, setAvailableLabels] = useState<TaskLabel[]>([]);
  const [availableSprints, setAvailableSprints] = useState<TaskSprint[]>([]);
  const [availableCandidateTasks, setAvailableCandidateTasks] = useState<{ id: string; title: string }[]>([]);
  const [isAddingDependency, setIsAddingDependency] = useState(false);
  const [depTaskId, setDepTaskId] = useState("");
  const [depType, setDepType] = useState<DependencyType>("BLOCKED_BY");
  const [dependencyError, setDependencyError] = useState<string | null>(null);

  // Inline editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");

  // On Hold State
  const [isHoldModalOpen, setIsHoldModalOpen] = useState(false);
  const [holdReasonDraft, setHoldReasonDraft] = useState("");
  const [holdUntilDraft, setHoldUntilDraft] = useState("");

  // Approval Workflow State (BUG-12)
  const [showSubmitApprovalForm, setShowSubmitApprovalForm] = useState(false);
  const [selectedApproverId, setSelectedApproverId] = useState("");
  const [approvalNotesDraft, setApprovalNotesDraft] = useState("");
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);

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
  const [managedDeptIds, setManagedDeptIds] = useState<string[]>([]);
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
      const [labels, sprints, tasksRes, depts] = await Promise.all([
        tasksApi.fetchLabels().catch(() => []),
        tasksApi.fetchSprints().catch(() => []),
        tasksApi.getTasks({ limit: 100 }).catch(() => ({ items: [] })),
        tasksApi.fetchTaskDepartments ? tasksApi.fetchTaskDepartments().catch(() => []) : Promise.resolve([]),
      ]);
      setAvailableLabels(labels);
      setAvailableSprints(sprints);
      setAvailableCandidateTasks(tasksRes.items || []);
      setManagedDeptIds((depts || []).filter((d) => d.is_managed).map((d) => d.id));
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
      setShowSubmitApprovalForm(false);
      setSelectedApproverId("");
      setApprovalNotesDraft("");
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
      setShowSubmitApprovalForm(false);
      setSelectedApproverId("");
      setApprovalNotesDraft("");
    }
  }, [isOpen, taskId]);

  // Global ESC key listener & body scroll lock for TaskDrawer & its sub-modals
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isHoldModalOpen) {
          setIsHoldModalOpen(false);
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
  }, [isOpen, isHoldModalOpen, onClose]);

  const updateTaskOptimistically = async (
    patch: Parameters<typeof tasksApi.updateTask>[1],
    fallbackError: string
  ): Promise<TaskDetail | null> => {
    if (!task) return null;
    try {
      const updated = await tasksApi.updateTask(task.id, {
        ...patch,
        version: task.version,
      });
      setTask(updated);
      onTaskUpdated();
      return updated;
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      const msg = err?.message || err?.response?.data?.detail || fallbackError;
      alert(msg);
      if (status === 409) {
        await loadTask(task.id);
      }
      return null;
    }
  };

  const handleIssueTypeChange = async (newType: IssueType) => {
    if (!task) return;
    const updated = await updateTaskOptimistically({ issue_type: newType }, "Failed to update issue type");
    if (updated) loadTimeline(task.id);
  };

  const handleParentTaskChange = async (parentId: string | null) => {
    if (!task) return;
    const updated = await updateTaskOptimistically({ parent_task_id: parentId }, "Failed to update parent task");
    if (updated) loadTimeline(task.id);
  };

  const handleSprintChange = async (sprintId: string | null) => {
    if (!task) return;
    const updated = await updateTaskOptimistically({ sprint_id: sprintId }, "Failed to update sprint");
    if (updated) loadTimeline(task.id);
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
    setDependencyError(null);
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
      const errMsg = err?.response?.data?.detail || err?.message || "Failed to add dependency link";
      setDependencyError(errMsg);
      await loadTask(task.id);
    }
  };

  const handleDeleteDependency = async (depId: string) => {
    if (!task) return;
    if (!confirm("Are you sure you want to remove this dependency?")) return;
    setDependencyError(null);
    try {
      await tasksApi.deleteTaskDependency(depId);
      await loadTask(task.id);
      loadTimeline(task.id);
      onTaskUpdated();
    } catch (err: any) {
      const errMsg = err?.response?.data?.detail || err?.message || "Failed to remove dependency";
      setDependencyError(errMsg);
      await loadTask(task.id);
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
    if (newStatus === "DONE") {
      const blockers = (task.dependencies || []).filter(
        (d) => d.dependency_type === "BLOCKED_BY" && d.depends_on_task_status && d.depends_on_task_status !== "DONE"
      );
      if (blockers.length > 0) {
        alert(
          `Cannot complete task. Blocked by: ${blockers
            .map((b) => b.depends_on_task_title || "Linked Task")
            .join(", ")}`
        );
        return;
      }
    }
    const updated = await updateTaskOptimistically({ status: newStatus }, "Failed to update status");
    if (updated) loadTimeline(task.id);
  };

  const handleConfirmHold = async () => {
    if (!task) return;
    if (!holdReasonDraft.trim()) {
      alert("A valid, non-empty hold reason is required when placing a task ON_HOLD.");
      return;
    }
    const updated = await updateTaskOptimistically(
      {
        status: "ON_HOLD",
        hold_reason: holdReasonDraft.trim(),
        hold_until: holdUntilDraft || null,
      },
      "Failed to put task on hold"
    );
    if (updated) {
      setIsHoldModalOpen(false);
      loadTimeline(task.id);
    }
  };

  const handleResumeFromHold = async () => {
    if (!task) return;
    const updated = await updateTaskOptimistically({ status: "IN_PROGRESS" }, "Failed to resume task");
    if (updated) loadTimeline(task.id);
  };

  const handleSubmitForApproval = async () => {
    if (!task || !selectedApproverId || approvalSubmitting) return;
    setApprovalSubmitting(true);
    try {
      const updated = await tasksApi.submitTaskForApproval(task.id, {
        approver_id: selectedApproverId,
        notes: approvalNotesDraft.trim() || undefined,
      });
      setTask(updated);
      setShowSubmitApprovalForm(false);
      setSelectedApproverId("");
      setApprovalNotesDraft("");
      onTaskUpdated();
      loadTimeline(task.id);
    } catch (err: any) {
      alert(err?.message || err?.response?.data?.detail || "Failed to submit task for approval");
    } finally {
      setApprovalSubmitting(false);
    }
  };

  const handleApprovalAction = async (approved: boolean) => {
    if (!task || approvalSubmitting) return;
    setApprovalSubmitting(true);
    try {
      const updated = await tasksApi.actionTaskApproval(task.id, {
        approved,
        notes: approvalNotesDraft.trim() || undefined,
      });
      setTask(updated);
      setApprovalNotesDraft("");
      onTaskUpdated();
      loadTimeline(task.id);
    } catch (err: any) {
      alert(err?.message || err?.response?.data?.detail || "Failed to process approval action");
    } finally {
      setApprovalSubmitting(false);
    }
  };


  const handlePriorityChange = async (newPriority: TaskPriority) => {
    await updateTaskOptimistically({ priority: newPriority }, "Failed to update priority");
  };

  const handleStartDateChange = async (dateStr: string) => {
    await updateTaskOptimistically({ start_date: dateStr ? dateStr : null }, "Failed to update start date");
  };

  const handleDueDateChange = async (dateStr: string) => {
    await updateTaskOptimistically({ due_date: dateStr ? dateStr : null }, "Failed to update due date");
  };

  const handleSaveTitle = async () => {
    if (!task || !titleDraft.trim()) return;
    const updated = await updateTaskOptimistically({ title: titleDraft.trim() }, "Failed to save title");
    if (updated) setIsEditingTitle(false);
  };

  const handleSaveDesc = async () => {
    if (!task) return;
    const updated = await updateTaskOptimistically({ description: descDraft }, "Failed to save description");
    if (updated) setIsEditingDesc(false);
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

  const isCreator = Boolean(task && profile?.id && task.created_by === profile.id);
  const isActiveAssignee = Boolean(
    task && profile?.id && assigneesList.some((a) => a.user_id === profile.id)
  );
  const isCreatorOrAssignee = isCreator || isActiveAssignee;
  const isActiveDeptManagerOfTask = Boolean(
    task &&
      !canManage &&
      !hasPermission("task.all_view") &&
      (hasPermission("task.create") || hasPermission("task.assign")) &&
      (task as any).department_id &&
      managedDeptIds.includes((task as any).department_id)
  );
  const canEditTask = Boolean(
    task && (canManage || isCreatorOrAssignee || isActiveDeptManagerOfTask)
  );
  // Strict assignee-change authorization: active assignees CANNOT reassign tasks;
  // only Admin / task.manage, original creator (with task.assign), or active Dept Manager (with task.assign).
  const canChangeAssignee = Boolean(
    task &&
      (typeof task.can_change_assignee === "boolean"
        ? task.can_change_assignee
        : canManage || (canAssign && (isCreator || isActiveDeptManagerOfTask)))
  );
  const isPreviousAssigneeReadOnly = Boolean(task && task.is_previously_assigned && !canEditTask);
  const canCollaborate = Boolean(
    task &&
      (canEditTask ||
        watchersList.some((w) => w.user_id === profile?.id) ||
        (profile?.id && task.approver_id === profile.id))
  );
  const canApproveTask = Boolean(
    task &&
      task.status === "PENDING_APPROVAL" &&
      (canManage || (profile?.id && task.approver_id === profile.id && !isCreatorOrAssignee))
  );
  const approverCandidates = availableUsers.filter((u) => u.id !== profile?.id);

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
                  background:
                    task?.status === "DONE"
                      ? "#dcfce7"
                      : task?.status === "IN_PROGRESS"
                      ? "#eff6ff"
                      : task?.status === "ON_HOLD"
                      ? "#fef3c7"
                      : task?.status === "PENDING_APPROVAL"
                      ? "#f3e8ff"
                      : task?.status === "REVIEW"
                      ? "#e0f2fe"
                      : "#f1f5f9",
                  color:
                    task?.status === "DONE"
                      ? "#166534"
                      : task?.status === "IN_PROGRESS"
                      ? "#1e40af"
                      : task?.status === "ON_HOLD"
                      ? "#92400e"
                      : task?.status === "PENDING_APPROVAL"
                      ? "#6b21a8"
                      : task?.status === "REVIEW"
                      ? "#0369a1"
                      : "#475569",
                  border: "1px solid #cbd5e1",
                  borderRadius: "12px",
                  padding: "2px 8px",
                  fontSize: "11px",
                  fontWeight: 700,
                }}
              >
                {task?.status === "ON_HOLD"
                  ? "⏸️ ON HOLD"
                  : task?.status === "PENDING_APPROVAL"
                  ? "⏳ PENDING APPROVAL"
                  : task?.status?.replace(/_/g, " ")}
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
                disabled={!canEditTask}
                onChange={(e) => handleIssueTypeChange(e.target.value as IssueType)}
                style={{
                  padding: "2px 8px",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontWeight: 700,
                  border: "1px solid #c7d2fe",
                  background: "#e0e7ff",
                  color: "#3730a3",
                  cursor: canEditTask ? "pointer" : "not-allowed",
                  opacity: canEditTask ? 1 : 0.75,
                }}
              >
                <option value="TASK">TASK</option>
                <option value="BUG">BUG</option>
                <option value="IMPROVEMENT">IMPROVEMENT</option>
                <option value="STORY">STORY</option>
                <option value="EPIC">EPIC</option>
              </select>

              {task && !canEditTask && (
                <span
                  data-testid="task-drawer-readonly-badge"
                  style={{
                    background: "#f1f5f9",
                    color: "#475569",
                    border: "1px solid #cbd5e1",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    fontSize: "11px",
                    fontWeight: 700,
                  }}
                >
                  🔒 Read-Only
                </span>
              )}

              {overdue && (
                <span style={{ background: "#fee2e2", color: "#991b1b", padding: "2px 8px", borderRadius: "12px", fontSize: "11px", fontWeight: 700 }}>
                  ⚠️ OVERDUE
                </span>
              )}
            </div>

            {isEditingTitle && canEditTask ? (
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
                onClick={() => canEditTask && setIsEditingTitle(true)}
                title={canEditTask ? "Click to edit title" : undefined}
                style={{
                  margin: 0,
                  fontSize: "17px",
                  fontWeight: 700,
                  color: "#0f172a",
                  cursor: canEditTask ? "pointer" : "default",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {task?.title ? task.title : <InlineTextSkeleton width={220} height={22} />}
                {canEditTask && <span style={{ fontSize: "12px", color: "#94a3b8" }}>✏️</span>}
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
                    {canEditTask && (
                      <button
                        type="button"
                        onClick={() => handleRemoveLabel(l.id)}
                        title="Remove label"
                        style={{ background: "none", border: "none", cursor: "pointer", color: l.color, padding: 0, fontSize: "10px" }}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ))}
              {canEditTask && availableLabels.filter((al) => !task?.labels?.some((tl) => tl.id === al.id)).length > 0 && (
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
                  disabled={!canCollaborate}
                />
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {canEscalate && onEscalateRequest && task && !isPreviousAssigneeReadOnly && (
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
              className={`task-drawer-tab-btn ${drawerTab === tab.key ? "active" : ""}`}
              style={{
                outline: "none",
                boxShadow: "none",
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Drawer Content Area */}
        <div style={{ padding: "20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "18px" }}>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }} aria-hidden="true">
              <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <span className="skeleton-line" style={{ width: "40%", height: 16, marginBottom: 8 }} />
                <span className="skeleton-box" style={{ width: "100%", height: 8, borderRadius: 4 }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <span className="skeleton-line" style={{ width: "70%", height: 20 }} />
                <span className="skeleton-line" style={{ width: "95%", height: 14 }} />
                <span className="skeleton-line" style={{ width: "85%", height: 14 }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div style={{ padding: "10px", border: "1px solid #e2e8f0", borderRadius: 6 }}>
                  <span className="skeleton-line" style={{ width: "50%", height: 12, marginBottom: 6 }} />
                  <span className="skeleton-line" style={{ width: "70%", height: 14 }} />
                </div>
                <div style={{ padding: "10px", border: "1px solid #e2e8f0", borderRadius: 6 }}>
                  <span className="skeleton-line" style={{ width: "50%", height: 12, marginBottom: 6 }} />
                  <span className="skeleton-line" style={{ width: "70%", height: 14 }} />
                </div>
              </div>
            </div>
          ) : !task ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#ef4444" }}>{error || "Task not found."}</div>
          ) : drawerTab === "details" ? (
            <>
              {/* Previously Assigned Historical Visibility Banner */}
              {isPreviousAssigneeReadOnly && (
                <div
                  data-testid="previously-assigned-banner"
                  style={{
                    background: "#fffbeb",
                    border: "1px solid #fcd34d",
                    borderRadius: "8px",
                    padding: "12px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#92400e", fontSize: "13px" }}>
                    🕘 Previously Assigned to You (Read-Only History)
                  </div>
                  <div style={{ fontSize: "12px", color: "#78350f" }}>
                    This task is no longer actively assigned to you
                    {task.reassigned_at
                      ? ` — reassigned on ${new Date(task.reassigned_at).toLocaleString()}`
                      : ""}
                    {task.reassigned_by_name ? ` by ${task.reassigned_by_name}` : ""}. You retain read-only visibility in your task history.
                  </div>
                </div>
              )}

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
                    {canEditTask && (
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
                    )}
                  </div>
                  {task.hold_reason && (
                    <div style={{ fontSize: "12.5px", color: "#78350f", background: "#ffffff", padding: "8px 10px", borderRadius: "6px", border: "1px solid #fef08a" }}>
                      <strong>Hold Reason:</strong> {task.hold_reason}
                    </div>
                  )}
                </div>
              )}

              {/* Approval Workflow Banner & Controls (BUG-12) */}
              {task.status === "PENDING_APPROVAL" && (
                <div
                  data-testid="task-approval-banner"
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
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "18px" }}>⏳</span>
                      <div>
                        <div style={{ fontWeight: 700, color: "#6b21a8", fontSize: "13.5px" }}>
                          Pending Approval
                        </div>
                        <div style={{ fontSize: "11.5px", color: "#7e22ce" }}>
                          Approver: <strong>{task.approver?.full_name || "Designated Approver"}</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                  {task.approval_notes && (
                    <div style={{ fontSize: "12px", color: "#581c87", background: "#ffffff", padding: "8px 10px", borderRadius: "6px", border: "1px solid #e9d5ff" }}>
                      <strong>Submission Notes:</strong> {task.approval_notes}
                    </div>
                  )}
                  {canApproveTask ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <input
                        type="text"
                        placeholder="Optional approval / rejection notes..."
                        value={approvalNotesDraft}
                        onChange={(e) => setApprovalNotesDraft(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "6px 10px",
                          borderRadius: "6px",
                          border: "1px solid #d8b4fe",
                          fontSize: "12.5px",
                          boxSizing: "border-box",
                        }}
                      />
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          type="button"
                          disabled={approvalSubmitting}
                          onClick={() => handleApprovalAction(true)}
                          className="btn btn-small btn-primary"
                          style={{ background: "#16a34a", borderColor: "#15803d", fontSize: "12px" }}
                        >
                          ✅ Approve
                        </button>
                        <button
                          type="button"
                          disabled={approvalSubmitting}
                          onClick={() => handleApprovalAction(false)}
                          className="btn btn-small"
                          style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", fontSize: "12px", fontWeight: 600 }}
                        >
                          ❌ Reject
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: "11.5px", color: "#6b21a8", fontStyle: "italic" }}>
                      Awaiting review by the designated approver.
                    </div>
                  )}
                </div>
              )}

              {task.status !== "PENDING_APPROVAL" && task.status !== "DONE" && canEditTask && (
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                    <div style={{ fontSize: "12px", color: "#475569" }}>
                      <strong>Approval Workflow</strong>
                      {task.approval_status === "REJECTED" && (
                        <span style={{ marginLeft: "8px", color: "#b91c1c", fontWeight: 600 }}>
                          (Previously Rejected{task.approval_notes ? `: ${task.approval_notes}` : ""})
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => setShowSubmitApprovalForm(!showSubmitApprovalForm)}
                      style={{
                        background: showSubmitApprovalForm ? "#f3e8ff" : "#ffffff",
                        color: "#6b21a8",
                        border: "1px solid #d8b4fe",
                        fontWeight: 600,
                        fontSize: "11.5px",
                      }}
                    >
                      {showSubmitApprovalForm ? "Cancel" : "📤 Submit for Approval"}
                    </button>
                  </div>
                  {showSubmitApprovalForm && (
                    <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                      <select
                        aria-label="Select Approver"
                        value={selectedApproverId}
                        onChange={(e) => setSelectedApproverId(e.target.value)}
                        style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px" }}
                      >
                        <option value="">Select approver...</option>
                        {approverCandidates.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.display_name || u.full_name} ({u.department || "General"})
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        placeholder="Optional notes for approver..."
                        value={approvalNotesDraft}
                        onChange={(e) => setApprovalNotesDraft(e.target.value)}
                        style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12.5px", boxSizing: "border-box" }}
                      />
                      <div>
                        <button
                          type="button"
                          disabled={!selectedApproverId || approvalSubmitting}
                          onClick={handleSubmitForApproval}
                          className="btn btn-small btn-primary"
                          style={{ background: "#7c3aed", borderColor: "#6d28d9", fontSize: "12px" }}
                        >
                          {approvalSubmitting ? "Submitting..." : "Confirm Submit for Approval"}
                        </button>
                      </div>
                    </div>
                  )}
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
                    disabled={!canEditTask}
                    onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
                    style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", opacity: canEditTask ? 1 : 0.7 }}
                  >
                    <option value="TODO">To Do</option>
                    <option value="IN_PROGRESS">In Progress</option>
                    <option value="REVIEW">In Review</option>
                    <option value="ON_HOLD">⏸️ On Hold</option>
                    <option value="PENDING_APPROVAL" disabled>
                      ⏳ Pending Approval
                    </option>
                    <option value="DONE" disabled={task.status === "PENDING_APPROVAL" && !canManage}>
                      Completed
                    </option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                    Priority
                  </label>
                  <select
                    value={task.priority}
                    disabled={!canEditTask}
                    onChange={(e) => handlePriorityChange(e.target.value as TaskPriority)}
                    style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", opacity: canEditTask ? 1 : 0.7 }}
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
                    disabled={!canEditTask}
                    onChange={(e) => handleParentTaskChange(e.target.value || null)}
                    style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", opacity: canEditTask ? 1 : 0.7 }}
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
                    disabled={!canEditTask}
                    onChange={(e) => handleSprintChange(e.target.value || null)}
                    style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", opacity: canEditTask ? 1 : 0.7 }}
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
                    disabled={!canEditTask}
                    value={task.start_date || ""}
                    onChange={(e) => handleStartDateChange(e.target.value)}
                    style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", opacity: canEditTask ? 1 : 0.7 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                    Due Date
                  </label>
                  <input
                    type="date"
                    disabled={!canEditTask}
                    value={task.due_date || ""}
                    onChange={(e) => handleDueDateChange(e.target.value)}
                    style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", opacity: canEditTask ? 1 : 0.7 }}
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
                  {canChangeAssignee && (
                    <button
                      type="button"
                      data-testid="add-assignee-btn"
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

                {canChangeAssignee && showAddAssignee && (
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
                          {canChangeAssignee && (
                            <button
                              type="button"
                              data-testid={`remove-assignee-${a.user_id}`}
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

                {/* Immutable Assignment History */}
                {task.assignment_history && task.assignment_history.length > 0 && (
                  <div
                    data-testid="task-assignment-history"
                    style={{
                      marginTop: "10px",
                      paddingTop: "8px",
                      borderTop: "1px dashed #e2e8f0",
                      display: "flex",
                      flexDirection: "column",
                      gap: "5px",
                    }}
                  >
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                      Assignment History ({task.assignment_history.length})
                    </span>
                    {task.assignment_history.map((h) => {
                      const assigneeName =
                        h.user?.full_name ||
                        availableUsers.find((u) => u.id === h.user_id)?.full_name ||
                        "User";
                      const reassignedToName =
                        h.reassigned_to_user?.full_name ||
                        (h.reassigned_to_user_id
                          ? availableUsers.find((u) => u.id === h.reassigned_to_user_id)?.full_name
                          : null);
                      const isCurrent = !h.unassigned_at;
                      return (
                        <div
                          key={h.id}
                          style={{
                            fontSize: "11.5px",
                            color: "#475569",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "6px",
                            background: isCurrent ? "#f0fdf4" : "#f8fafc",
                            border: isCurrent ? "1px solid #bbf7d0" : "1px solid #e2e8f0",
                            borderRadius: "6px",
                            padding: "5px 8px",
                          }}
                        >
                          <div>
                            <strong style={{ color: "#1e293b" }}>{assigneeName}</strong>
                            <span style={{ color: "#64748b", marginLeft: "6px" }}>
                              assigned {new Date(h.assigned_at).toLocaleDateString()}
                            </span>
                            {h.unassigned_at && (
                              <span style={{ color: "#92400e", marginLeft: "6px" }}>
                                • {reassignedToName ? `reassigned to ${reassignedToName}` : "unassigned"} on{" "}
                                {new Date(h.unassigned_at).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 700,
                              padding: "1px 6px",
                              borderRadius: "10px",
                              background: isCurrent ? "#dcfce7" : "#fef3c7",
                              color: isCurrent ? "#15803d" : "#92400e",
                            }}
                          >
                            {isCurrent ? "CURRENT" : "PREVIOUS"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Watchers */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b" }}>
                    👁️ WATCHERS ({watchersList.length})
                  </span>
                  {canEditTask && (
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
                  )}
                </div>

                {canEditTask && showAddWatcher && (
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
                          {canEditTask && (
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
                          )}
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
                  {canEditTask && !isEditingDesc && (
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

                {canEditTask && isEditingDesc ? (
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
                  {canEditTask && (
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
                  )}
                </div>

                <AttachmentList
                  attachments={task.attachments || []}
                  onDelete={(item) => item.id && handleDeleteTaskAttachment(item.id)}
                  canDelete={canEditTask && (canManage || task.created_by === profile?.id)}
                />
              </div>

              {/* Task Voice Notes Section */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b" }}>
                    🎤 VOICE NOTES ({task.voice_notes?.length || 0})
                  </span>
                  {canEditTask && (
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
                  )}
                </div>

                {canEditTask && showVoiceRecorder && (
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
                {canEditTask && (
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    onClick={() => setIsAddingSubtask(!isAddingSubtask)}
                    style={{ fontSize: "12px" }}
                  >
                    {isAddingSubtask ? "Cancel" : "+ Add Mini-Task"}
                  </button>
                )}
              </div>

              {/* Inline Subtask Form */}
              {canEditTask && isAddingSubtask && (
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
                    const isSubAssignee = Boolean(
                      profile?.id &&
                        (s.assignee_id === profile.id ||
                          (s.assignees || []).some((sa) => sa.user_id === profile.id))
                    );
                    const canToggleSub = canEditTask || isSubAssignee;
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
                          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: canToggleSub ? "pointer" : "default", flex: 1, minWidth: 0 }}>
                            <input
                              type="checkbox"
                              checked={isDone}
                              disabled={!canToggleSub}
                              onChange={() => canToggleSub && handleToggleSubtask(s.id, isDone)}
                              style={{ cursor: canToggleSub ? "pointer" : "not-allowed", width: "16px", height: "16px" }}
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
                            {canEditTask && (
                              <button
                                type="button"
                                onClick={() => handleDeleteSubtask(s.id)}
                                style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "13px" }}
                              >
                                ✕
                              </button>
                            )}
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
                        <SubtaskCollaborationSection subtaskId={s.id} readOnly={!canCollaborate && !isSubAssignee} />
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
                {canEditTask && (
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
                )}
              </div>

              {/* Add Dependency Form */}
              {canEditTask && isAddingDependency && (
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
                  {dependencyError && (
                    <div style={{ color: "#ef4444", fontSize: "12px", marginTop: "4px", fontWeight: 500 }}>
                      {dependencyError}
                    </div>
                  )}
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

                      {canEditTask && (
                        <button
                          type="button"
                          onClick={() => handleDeleteDependency(dep.id)}
                          style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "14px" }}
                          title="Remove dependency link"
                        >
                          ✕
                        </button>
                      )}
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
                {canEscalate && onEscalateRequest && (
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
                      <EscalationCollaborationSection
                        escalationId={esc.id}
                        readOnly={!canCollaborate && esc.from_user !== profile?.id && esc.to_user !== profile?.id}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : drawerTab === "comments" ? (
            /* Comments Tab */
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {canCollaborate ? (
                <CommentComposer
                  placeholder="Write a comment, attach files or record a voice note..."
                  onSubmit={handleCreateTaskComment}
                  isSubmitting={postingComment}
                />
              ) : (
                <div
                  data-testid="comments-readonly-notice"
                  style={{
                    padding: "10px 12px",
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "6px",
                    fontSize: "12px",
                    color: "#64748b",
                  }}
                >
                  🔒 Read-only view — commenting and reactions are disabled for non-participants.
                </div>
              )}

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
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "10px",
                        padding: "12px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        boxShadow: "0 1px 2px rgba(0, 0, 0, 0.03)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div
                            style={{
                              width: "24px",
                              height: "24px",
                              borderRadius: "50%",
                              background: "#eff6ff",
                              color: "#2563eb",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "11px",
                              fontWeight: 700,
                            }}
                          >
                            {(c.user?.full_name || "T").charAt(0).toUpperCase()}
                          </div>
                          <span style={{ fontWeight: 600, fontSize: "13px", color: "#1e293b" }}>
                            {c.user?.full_name || "Team Member"}
                          </span>
                        </div>
                        <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                          {new Date(c.created_at).toLocaleString()}
                        </span>
                      </div>
                      {c.message && (
                        <div style={{ fontSize: "13px", color: "#334155", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
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
                      <div style={{ marginTop: "4px", display: "flex", alignItems: "center" }}>
                        <ReactionPicker
                          size="sm"
                          reactions={c.reactions}
                          onToggleReaction={(emoji) => handleToggleCommentReaction(c.id, emoji)}
                          disabled={!canCollaborate}
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
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", paddingLeft: "16px", borderLeft: "2px solid #e2e8f0" }} aria-hidden="true">
                  {[1, 2, 3].map((n) => (
                    <div key={n} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span className="skeleton-line" style={{ width: "30%", height: 12 }} />
                      <span className="skeleton-line" style={{ width: "75%", height: 14 }} />
                    </div>
                  ))}
                </div>
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
                          background: evt.event_type.includes("COMPLETED")
                            ? "#16a34a"
                            : evt.event_type.includes("ESCALATED")
                            ? "#dc2626"
                            : evt.event_type === "USER_REASSIGNED" || evt.event_type === "USER_UNASSIGNED"
                            ? "#d97706"
                            : evt.event_type === "USER_ASSIGNED"
                            ? "#7c3aed"
                            : "#3b82f6",
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
    </div>
  );
};
