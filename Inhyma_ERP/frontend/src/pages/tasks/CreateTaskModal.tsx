import React, { useEffect, useRef, useState } from "react";
import { createTask, getAvailableAssignees, fetchEscalateOptions, tasksApi } from "@/lib/tasksApi";
import { SearchableUserSelect } from "@/components/SearchableUserSelect";
import { VoiceNoteRecorder } from "@/components/VoiceNoteRecorder";
import { AttachmentList } from "@/components/AttachmentList";
import type {
  AvailableUser,
  IssueType,
  MiniSubtaskInput,
  TaskEscalateOptionsResponse,
  TaskInitialEscalationInput,
  TaskLabel,
  TaskPriority,
  TaskSprint,
  TaskStatus,
  TaskTemplate,
} from "@/types/tasks";

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (taskId?: string) => void;
  defaultStatus?: TaskStatus;
  initialStartDate?: string;
  initialDueDate?: string;
}

export const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialStartDate,
  initialDueDate,
}) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [issueType, setIssueType] = useState<IssueType>("TASK");
  const [parentTaskId, setParentTaskId] = useState<string | null>(null);
  const [sprintId, setSprintId] = useState<string | null>(null);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(initialStartDate || "");
  const [dueDate, setDueDate] = useState(initialDueDate || "");

  useEffect(() => {
    if (isOpen) {
      if (initialStartDate) setStartDate(initialStartDate);
      if (initialDueDate) setDueDate(initialDueDate);
    }
  }, [isOpen, initialStartDate, initialDueDate]);

  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const [selectedWatcherIds, setSelectedWatcherIds] = useState<string[]>([]);

  // V2.0 Sprints, Labels, Templates, Parents
  const [availableLabels, setAvailableLabels] = useState<TaskLabel[]>([]);
  const [availableSprints, setAvailableSprints] = useState<TaskSprint[]>([]);
  const [availableTemplates, setAvailableTemplates] = useState<TaskTemplate[]>([]);
  const [parentCandidateTasks, setParentCandidateTasks] = useState<{ id: string; title: string; issue_type?: string }[]>([]);

  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#6366f1");
  const [showNewLabelInput, setShowNewLabelInput] = useState(false);
  const [creatingLabel, setCreatingLabel] = useState(false);

  // Attachments & Voice Notes
  const [attachments, setAttachments] = useState<
    { file_name: string; file_url: string; file_size: number; file_type?: string }[]
  >([]);
  const [voiceNotes, setVoiceNotes] = useState<
    { audio_url: string; duration_seconds: number; file_size?: number; mime_type?: string; title?: string }[]
  >([]);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Mini-Task Subtasks state
  const [subtasks, setSubtasks] = useState<MiniSubtaskInput[]>([]);

  // Initial Escalation state (Optional)
  const [enableEscalation, setEnableEscalation] = useState(false);
  const [escalationType, setEscalationType] = useState<
    "REPORTING_MANAGER" | "DEPARTMENT_MANAGER" | "ORGANIZATION_USER"
  >("REPORTING_MANAGER");
  const [escalatedToId, setEscalatedToId] = useState<string>("");
  const [escalationReason, setEscalationReason] = useState("");
  const [escalationDueDate, setEscalationDueDate] = useState("");
  const [escalateOptions, setEscalateOptions] = useState<TaskEscalateOptionsResponse>({
    reporting_managers: [],
    department_managers: [],
    organization_users: [],
  });

  const [loadingUsers, setLoadingUsers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTitle("");
    setDescription("");
    setPriority("MEDIUM");
    setIssueType("TASK");
    setParentTaskId(null);
    setSprintId(null);
    setSelectedLabelIds([]);
    setStartDate("");
    setDueDate("");
    setSelectedAssigneeIds([]);
    setSelectedWatcherIds([]);
    setSubtasks([]);
    setAttachments([]);
    setVoiceNotes([]);
    setShowVoiceRecorder(false);
    setIsUploadingAttachment(false);
    setEnableEscalation(false);
    setEscalationType("REPORTING_MANAGER");
    setEscalatedToId("");
    setEscalationReason("");
    setEscalationDueDate("");
    setError(null);

    setLoadingUsers(true);
    Promise.all([
      getAvailableAssignees(),
      fetchEscalateOptions().catch(() => ({
        reporting_managers: [],
        department_managers: [],
        organization_users: [],
      })),
      tasksApi.fetchLabels().catch(() => []),
      tasksApi.fetchSprints().catch(() => []),
      tasksApi.fetchTemplates().catch(() => []),
      tasksApi.getTasks({ limit: 100 }).catch(() => ({ items: [] })),
    ])
      .then(([users, escOpts, labels, sprints, templates, tasksRes]) => {
        setAvailableUsers(users);
        setEscalateOptions(escOpts);
        setAvailableLabels(labels);
        setAvailableSprints(sprints);
        setAvailableTemplates(templates);
        setParentCandidateTasks(tasksRes.items || []);
        // Default target if reporting manager exists
        if (escOpts.reporting_managers.length > 0) {
          setEscalatedToId(escOpts.reporting_managers[0].user_id);
        } else if (escOpts.department_managers.length > 0) {
          setEscalatedToId(escOpts.department_managers[0].user_id);
        }
      })
      .catch((err) => console.error("Failed to load ERP users / escalation options", err))
      .finally(() => setLoadingUsers(false));
  }, [isOpen]);

  // Sync selected target when escalationType changes
  useEffect(() => {
    if (!enableEscalation) return;
    if (escalationType === "REPORTING_MANAGER" && escalateOptions.reporting_managers.length > 0) {
      setEscalatedToId(escalateOptions.reporting_managers[0].user_id);
    } else if (
      escalationType === "DEPARTMENT_MANAGER" &&
      escalateOptions.department_managers.length > 0
    ) {
      setEscalatedToId(escalateOptions.department_managers[0].user_id);
    }
  }, [escalationType, enableEscalation, escalateOptions]);

  const handleApplyTemplate = (templateId: string) => {
    const tpl = availableTemplates.find((t) => t.id === templateId);
    if (!tpl) return;
    const tData = tpl.template_data || {};
    if (!title) setTitle(tpl.name);
    if (!description && tpl.description) setDescription(tpl.description);
    const issType = tpl.issue_type || tData.issue_type;
    if (issType) setIssueType(issType);
    const defPri = tpl.default_priority || tData.default_priority;
    if (defPri) setPriority(defPri);
    const subTemplates = tpl.subtask_templates || tData.subtask_templates;
    if (subTemplates && subTemplates.length > 0) {
      setSubtasks(
        subTemplates.map((st: any) => ({
          title: typeof st === "string" ? st : st.title,
          priority: typeof st === "object" && st.priority ? st.priority : "MEDIUM",
          status: "TODO",
        }))
      );
    }
    const defLabels: string[] = tpl.default_labels || tData.default_labels;
    if (defLabels && defLabels.length > 0) {
      const matched = availableLabels
        .filter((l) => defLabels.includes(l.name))
        .map((l) => l.id);
      setSelectedLabelIds((prev) => Array.from(new Set([...prev, ...matched])));
    }
  };

  const handleCreateLabel = async () => {
    if (!newLabelName.trim()) return;
    setCreatingLabel(true);
    try {
      const created = await tasksApi.createLabel({
        name: newLabelName.trim(),
        color: newLabelColor,
      });
      setAvailableLabels((prev) => [...prev, created]);
      setSelectedLabelIds((prev) => [...prev, created.id]);
      setNewLabelName("");
      setShowNewLabelInput(false);
    } catch (err: any) {
      console.error("Failed to create label", err);
      setError(err.message || "Failed to create label");
    } finally {
      setCreatingLabel(false);
    }
  };

  const handleToggleLabel = (labelId: string) => {
    setSelectedLabelIds((prev) =>
      prev.includes(labelId) ? prev.filter((id) => id !== labelId) : [...prev, labelId]
    );
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf("image") !== -1) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          setIsUploadingAttachment(true);
          try {
            const res = await tasksApi.uploadTaskFile(file, `screenshot_${Date.now()}.png`);
            setAttachments((prev) => [
              ...prev,
              {
                file_name: res.file_name,
                file_url: res.file_url,
                file_size: res.file_size,
                file_type: res.file_type,
              },
            ]);
          } catch (err: any) {
            setError(err.message || "Failed to upload screenshot");
          } finally {
            setIsUploadingAttachment(false);
          }
        }
      }
    }
  };

  const handleAddSubtask = () => {
    setSubtasks((prev) => [
      ...prev,
      {
        title: "",
        description: "",
        priority: "MEDIUM",
        status: "TODO",
        start_date: "",
        due_date: "",
        assignee_ids: [],
      },
    ]);
  };

  const handleUpdateSubtask = (index: number, updates: Partial<MiniSubtaskInput>) => {
    setSubtasks((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  };

  const handleRemoveSubtask = (index: number) => {
    setSubtasks((prev) => prev.filter((_, i) => i !== index));
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploadingAttachment(true);
    setError(null);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const res = await tasksApi.uploadTaskFile(file);
        setAttachments((prev) => [
          ...prev,
          {
            file_name: res.file_name,
            file_url: res.file_url,
            file_size: res.file_size,
            file_type: res.file_type,
          },
        ]);
      }
    } catch (err: any) {
      console.error("Failed to upload attachment:", err);
      setError(err.message || "Failed to upload file.");
    } finally {
      setIsUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleVoiceRecordingComplete = async (blob: Blob, durationSeconds: number) => {
    setIsUploadingAttachment(true);
    setError(null);
    try {
      const res = await tasksApi.uploadTaskFile(blob, "voice_brief.webm");
      setVoiceNotes((prev) => [
        ...prev,
        {
          audio_url: res.file_url,
          duration_seconds: durationSeconds,
          file_size: res.file_size,
          mime_type: res.file_type,
          title: `Voice Brief (${durationSeconds}s)`,
        },
      ]);
      setShowVoiceRecorder(false);
    } catch (err: any) {
      console.error("Failed to upload voice recording:", err);
      setError(err.message || "Failed to upload voice recording.");
    } finally {
      setIsUploadingAttachment(false);
    }
  };

  const handleRemoveAttachment = (_item: any, index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRemoveVoiceNote = (index: number) => {
    setVoiceNotes((prev) => prev.filter((_, i) => i !== index));
  };

  // ESC key listener & body scroll lock
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Task title is required.");
      return;
    }

    if (startDate && dueDate && dueDate < startDate) {
      setError("Due date cannot be earlier than start date.");
      return;
    }

    if (enableEscalation) {
      if (!escalatedToId) {
        setError("Please select a target user or manager for the initial escalation.");
        return;
      }
      if (!escalationReason.trim()) {
        setError("Please provide a reason for the initial escalation.");
        return;
      }
    }

    setSubmitting(true);
    setError(null);

    try {
      const validSubtasks = subtasks
        .filter((s) => s.title.trim())
        .map((s) => ({
          title: s.title.trim(),
          description: s.description?.trim() || undefined,
          priority: s.priority,
          status: s.status,
          start_date: s.start_date || undefined,
          due_date: s.due_date || undefined,
          assignee_ids: s.assignee_ids && s.assignee_ids.length > 0 ? s.assignee_ids : undefined,
        }));

      let initialEscalationPayload: TaskInitialEscalationInput | undefined = undefined;
      if (enableEscalation && escalatedToId && escalationReason.trim()) {
        initialEscalationPayload = {
          escalation_type: escalationType,
          escalated_to_id: escalatedToId,
          reason: escalationReason.trim(),
          due_date: escalationDueDate || undefined,
        };
      }

      const created = await createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        status: "TODO",
        issue_type: issueType,
        parent_task_id: parentTaskId || undefined,
        sprint_id: sprintId || undefined,
        label_ids: selectedLabelIds.length > 0 ? selectedLabelIds : undefined,
        start_date: startDate || undefined,
        due_date: dueDate || undefined,
        assignee_ids: selectedAssigneeIds,
        watcher_ids: selectedWatcherIds,
        subtasks: validSubtasks.length > 0 ? validSubtasks : undefined,
        initial_escalation: initialEscalationPayload,
        attachments: attachments.length > 0 ? attachments : undefined,
        voice_notes: voiceNotes.length > 0 ? voiceNotes : undefined,
      });

      onSuccess(created.id);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create task.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(15, 23, 42, 0.55)",
        backdropFilter: "blur(4px)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--color-surface, #ffffff)",
          color: "var(--color-text, #0f172a)",
          borderRadius: "14px",
          width: "820px",
          maxWidth: "100%",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          overflow: "hidden",
          border: "1px solid var(--color-border, #e2e8f0)",
        }}
        onClick={(e) => e.stopPropagation()}
        onPaste={handlePaste}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid var(--color-border, #e2e8f0)",
            background: "var(--color-bg, #f8fafc)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "var(--color-text, #0f172a)" }}>
              + Create New Task
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: "12.5px", color: "var(--color-muted, #64748b)" }}>
              Enterprise work item with Issue Types, Epic hierarchy, Sprints, Labels, Assignees, and Escalation.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              fontSize: "20px",
              cursor: "pointer",
              color: "#64748b",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}
        >
          <div
            style={{
              padding: "20px 24px",
              overflowY: "auto",
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "18px",
            }}
          >
            {error && (
              <div
                style={{
                  background: "#fee2e2",
                  border: "1px solid #fca5a5",
                  borderRadius: "6px",
                  padding: "10px 14px",
                  color: "#991b1b",
                  fontSize: "13px",
                  fontWeight: 500,
                }}
              >
                {error}
              </div>
            )}

            {/* Template Quick-Start */}
            {availableTemplates.length > 0 && (
              <div
                style={{
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "16px" }}>⚡</span>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#166534" }}>
                      Prefill from Template
                    </div>
                    <div style={{ fontSize: "11px", color: "#15803d" }}>
                      Quickly apply issue type, subtasks, and labels
                    </div>
                  </div>
                </div>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) handleApplyTemplate(e.target.value);
                  }}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid #86efac",
                    fontSize: "12px",
                    background: "#ffffff",
                    color: "#14532d",
                    cursor: "pointer",
                  }}
                >
                  <option value="" disabled>
                    Choose template...
                  </option>
                  {availableTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.issue_type || t.template_data?.issue_type || "TASK"})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Task Title */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#334155",
                  marginBottom: "6px",
                }}
              >
                Task Title <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Website Redesign"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  fontSize: "14px",
                  color: "#0f172a",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Issue Type, Parent / Epic, Sprint Row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#475569",
                    marginBottom: "5px",
                  }}
                >
                  Issue Type
                </label>
                <select
                  value={issueType}
                  onChange={(e) => setIssueType(e.target.value as IssueType)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    fontSize: "13px",
                    background: "#ffffff",
                  }}
                >
                  <option value="TASK">Task</option>
                  <option value="BUG">Bug</option>
                  <option value="IMPROVEMENT">Improvement</option>
                  <option value="STORY">Story</option>
                  <option value="EPIC">Epic</option>
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#475569",
                    marginBottom: "5px",
                  }}
                >
                  Parent / Epic
                </label>
                <select
                  value={parentTaskId || ""}
                  onChange={(e) => setParentTaskId(e.target.value || null)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    fontSize: "13px",
                    background: "#ffffff",
                  }}
                >
                  <option value="">None (Standalone / Epic)</option>
                  {parentCandidateTasks.map((p) => (
                    <option key={p.id} value={p.id}>
                      [{p.issue_type || "TASK"}] {p.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#475569",
                    marginBottom: "5px",
                  }}
                >
                  Sprint Bucket
                </label>
                <select
                  value={sprintId || ""}
                  onChange={(e) => setSprintId(e.target.value || null)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    fontSize: "13px",
                    background: "#ffffff",
                  }}
                >
                  <option value="">Backlog (No Sprint)</option>
                  {availableSprints.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.status})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Labels Section */}
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "12px 14px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <label style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                  🏷️ Labels ({selectedLabelIds.length})
                </label>
                <button
                  type="button"
                  onClick={() => setShowNewLabelInput(!showNewLabelInput)}
                  style={{
                    fontSize: "11px",
                    color: "#4f46e5",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  {showNewLabelInput ? "Cancel" : "+ New Label"}
                </button>
              </div>

              {/* Inline Label Creation */}
              {showNewLabelInput && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "10px",
                    padding: "8px",
                    background: "#ffffff",
                    border: "1px dashed #cbd5e1",
                    borderRadius: "6px",
                  }}
                >
                  <input
                    type="text"
                    placeholder="Label name (e.g. Backend, Urgent Fix)"
                    value={newLabelName}
                    onChange={(e) => setNewLabelName(e.target.value)}
                    style={{
                      flex: 1,
                      padding: "5px 8px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      fontSize: "12px",
                    }}
                  />
                  <input
                    type="color"
                    value={newLabelColor}
                    onChange={(e) => setNewLabelColor(e.target.value)}
                    style={{
                      width: "28px",
                      height: "28px",
                      padding: 0,
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                    title="Pick label color"
                  />
                  <button
                    type="button"
                    onClick={handleCreateLabel}
                    disabled={creatingLabel || !newLabelName.trim()}
                    style={{
                      padding: "5px 12px",
                      background: "#4f46e5",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "4px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {creatingLabel ? "Adding..." : "Add"}
                  </button>
                </div>
              )}

              {/* Label Chips */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {availableLabels.map((l) => {
                  const isSelected = selectedLabelIds.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => handleToggleLabel(l.id)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "4px 10px",
                        borderRadius: "16px",
                        fontSize: "12px",
                        fontWeight: 600,
                        border: isSelected ? `2px solid ${l.color}` : "1px solid #cbd5e1",
                        background: isSelected ? `${l.color}22` : "#ffffff",
                        color: isSelected ? l.color : "#475569",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: l.color,
                        }}
                      />
                      <span>{l.name}</span>
                      {isSelected && <span>✓</span>}
                    </button>
                  );
                })}
                {availableLabels.length === 0 && !showNewLabelInput && (
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                    No labels yet. Click "+ New Label" to create one.
                  </span>
                )}
              </div>
            </div>

            {/* Description */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#334155",
                  marginBottom: "6px",
                }}
              >
                Description
              </label>
              <textarea
                placeholder="Provide detailed instructions, context, or specifications..."
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  fontSize: "13.5px",
                  color: "#0f172a",
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                  resize: "vertical",
                }}
              />
            </div>

            {/* Grid: Priority, Start Date, Due Date (Default Status is strictly TODO, no status picker) */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#475569",
                    marginBottom: "5px",
                  }}
                >
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    fontSize: "13px",
                    background: "#ffffff",
                  }}
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#475569",
                    marginBottom: "5px",
                  }}
                >
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    fontSize: "13px",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#475569",
                    marginBottom: "5px",
                  }}
                >
                  Due Date
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    fontSize: "13px",
                  }}
                />
              </div>
            </div>

            {/* Universal Searchable Dropdown: Assignees */}
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "14px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <label
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "#1e293b",
                    margin: 0,
                  }}
                >
                  👥 Task Assignees ({selectedAssigneeIds.length}){" "}
                  {loadingUsers && (
                    <span style={{ fontSize: "11px", fontWeight: 400, color: "#64748b" }}>
                      (Loading...)
                    </span>
                  )}
                </label>
                <span style={{ fontSize: "11.5px", color: "#64748b" }}>
                  Assigned members receive instant notifications &amp; manage task progress
                </span>
              </div>
              <SearchableUserSelect
                users={availableUsers}
                selectedUserIds={selectedAssigneeIds}
                onChange={setSelectedAssigneeIds}
                multiple={true}
                placeholder="Search team members by name, email, or department..."
              />
            </div>

            {/* Universal Searchable Dropdown: Watchers */}
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "14px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <label
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "#1e293b",
                    margin: 0,
                  }}
                >
                  👁️ Task Watchers ({selectedWatcherIds.length})
                </label>
                <span style={{ fontSize: "11.5px", color: "#64748b" }}>
                  Watchers are kept in the loop on comments, status changes &amp; escalations
                </span>
              </div>
              <SearchableUserSelect
                users={availableUsers}
                selectedUserIds={selectedWatcherIds}
                onChange={setSelectedWatcherIds}
                multiple={true}
                placeholder="Search users to add as watchers..."
              />
            </div>

            {/* Initial Escalation Section (Optional) */}
            <div
              style={{
                background: enableEscalation ? "#fffbeb" : "#f8fafc",
                border: enableEscalation ? "1px solid #fde68a" : "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "14px",
                transition: "all 0.2s ease",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="checkbox"
                    id="enableEscalationCheckbox"
                    checked={enableEscalation}
                    onChange={(e) => setEnableEscalation(e.target.checked)}
                    style={{ width: "16px", height: "16px", cursor: "pointer" }}
                  />
                  <label
                    htmlFor="enableEscalationCheckbox"
                    style={{
                      fontSize: "13px",
                      fontWeight: 700,
                      color: enableEscalation ? "#92400e" : "#334155",
                      cursor: "pointer",
                      margin: 0,
                    }}
                  >
                    ⚡ Add Initial Escalation (Optional)
                  </label>
                </div>
                <span style={{ fontSize: "11.5px", color: "#64748b" }}>
                  Immediately escalate task upon creation with priority tracking
                </span>
              </div>

              {enableEscalation && (
                <div
                  style={{
                    marginTop: "12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    paddingTop: "12px",
                    borderTop: "1px dashed #fcd34d",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "12px",
                      alignItems: "flex-start",
                    }}
                  >
                    <div>
                      <label
                        style={{
                          display: "block",
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "#78350f",
                          marginBottom: "4px",
                        }}
                      >
                        Escalation Target Type
                      </label>
                      <select
                        value={escalationType}
                        onChange={(e) =>
                          setEscalationType(
                            e.target.value as
                              | "REPORTING_MANAGER"
                              | "DEPARTMENT_MANAGER"
                              | "ORGANIZATION_USER"
                          )
                        }
                        style={{
                          width: "100%",
                          padding: "7px 10px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "13px",
                          background: "#ffffff",
                        }}
                      >
                        <option value="REPORTING_MANAGER">Reporting Manager</option>
                        <option value="DEPARTMENT_MANAGER">Department Manager</option>
                        <option value="ORGANIZATION_USER">Select User (Specific Person)</option>
                      </select>
                    </div>

                    <div>
                      <label
                        style={{
                          display: "block",
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "#78350f",
                          marginBottom: "4px",
                        }}
                      >
                        Escalated To User <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      {escalationType === "REPORTING_MANAGER" &&
                      escalateOptions.reporting_managers.length > 0 ? (
                        <select
                          value={escalatedToId}
                          onChange={(e) => setEscalatedToId(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "7px 10px",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            fontSize: "13px",
                            background: "#ffffff",
                          }}
                        >
                          {escalateOptions.reporting_managers.map((m) => (
                            <option key={m.user_id} value={m.user_id}>
                              {m.name} ({m.detail || "Manager"})
                            </option>
                          ))}
                        </select>
                      ) : escalationType === "DEPARTMENT_MANAGER" &&
                        escalateOptions.department_managers.length > 0 ? (
                        <select
                          value={escalatedToId}
                          onChange={(e) => setEscalatedToId(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "7px 10px",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            fontSize: "13px",
                            background: "#ffffff",
                          }}
                        >
                          {escalateOptions.department_managers.map((m) => (
                            <option key={m.user_id} value={m.user_id}>
                              {m.name} ({m.detail || "Dept Head"})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <SearchableUserSelect
                          users={availableUsers}
                          selectedUserIds={escalatedToId ? [escalatedToId] : []}
                          onChange={(ids) => setEscalatedToId(ids[0] || "")}
                          multiple={false}
                          placeholder="Search user to escalate to..."
                        />
                      )}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: "12px" }}>
                    <div>
                      <label
                        style={{
                          display: "block",
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "#78350f",
                          marginBottom: "4px",
                        }}
                      >
                        Escalation Reason <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Why is this task being escalated initially?"
                        value={escalationReason}
                        onChange={(e) => setEscalationReason(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "7px 10px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "13px",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          display: "block",
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "#78350f",
                          marginBottom: "4px",
                        }}
                      >
                        Escalation Due Date
                      </label>
                      <input
                        type="date"
                        value={escalationDueDate}
                        onChange={(e) => setEscalationDueDate(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "6px 10px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "13px",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Subtasks (Mini-Tasks Builder) */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "14px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "12px",
                }}
              >
                <div>
                  <h4
                    style={{
                      margin: 0,
                      fontSize: "13.5px",
                      fontWeight: 700,
                      color: "#1e293b",
                    }}
                  >
                    📋 Subtasks / Mini-Tasks ({subtasks.length})
                  </h4>
                  <p style={{ margin: "2px 0 0", fontSize: "11.5px", color: "#64748b" }}>
                    Each subtask is a mini-task with independent assignees, start/due dates, and priority.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddSubtask}
                  className="btn btn-secondary btn-small"
                  style={{ fontSize: "12px", padding: "4px 10px" }}
                >
                  + Add Subtask
                </button>
              </div>

              {subtasks.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "16px",
                    color: "#94a3b8",
                    fontSize: "12.5px",
                    border: "1px dashed #cbd5e1",
                    borderRadius: "6px",
                  }}
                >
                  No subtasks added. Click <strong>"+ Add Subtask"</strong> to create structured mini-tasks.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {subtasks.map((st, idx) => (
                    <div
                      key={idx}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        padding: "12px",
                        background: "#fafafa",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                      }}
                    >
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: 700,
                            color: "#64748b",
                          }}
                        >
                          #{idx + 1}
                        </span>
                        <input
                          type="text"
                          placeholder="Subtask title (e.g. Homepage Wireframes)"
                          value={st.title}
                          onChange={(e) => handleUpdateSubtask(idx, { title: e.target.value })}
                          style={{
                            flex: 1,
                            padding: "6px 8px",
                            border: "1px solid #cbd5e1",
                            borderRadius: "4px",
                            fontSize: "13px",
                            background: "#ffffff",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveSubtask(idx)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#ef4444",
                            cursor: "pointer",
                            fontSize: "14px",
                            padding: "0 4px",
                          }}
                          title="Remove Subtask"
                        >
                          ✕
                        </button>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 110px 110px 125px 125px",
                          gap: "8px",
                          alignItems: "center",
                        }}
                      >
                        <input
                          type="text"
                          placeholder="Optional notes / description"
                          value={st.description || ""}
                          onChange={(e) =>
                            handleUpdateSubtask(idx, { description: e.target.value })
                          }
                          style={{
                            padding: "5px 8px",
                            border: "1px solid #cbd5e1",
                            borderRadius: "4px",
                            fontSize: "12px",
                            background: "#ffffff",
                          }}
                        />
                        <select
                          value={st.priority}
                          onChange={(e) =>
                            handleUpdateSubtask(idx, { priority: e.target.value as TaskPriority })
                          }
                          style={{
                            padding: "5px",
                            fontSize: "12px",
                            borderRadius: "4px",
                            border: "1px solid #cbd5e1",
                          }}
                        >
                          <option value="LOW">Low</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="HIGH">High</option>
                          <option value="CRITICAL">Critical</option>
                        </select>
                        <select
                          value={st.status}
                          onChange={(e) =>
                            handleUpdateSubtask(idx, { status: e.target.value as TaskStatus })
                          }
                          style={{
                            padding: "5px",
                            fontSize: "12px",
                            borderRadius: "4px",
                            border: "1px solid #cbd5e1",
                          }}
                        >
                          <option value="TODO">To Do</option>
                          <option value="IN_PROGRESS">In Progress</option>
                          <option value="DONE">Completed</option>
                        </select>
                        <input
                          type="date"
                          value={st.start_date || ""}
                          onChange={(e) =>
                            handleUpdateSubtask(idx, { start_date: e.target.value })
                          }
                          title="Subtask Start Date"
                          style={{
                            padding: "4px 6px",
                            fontSize: "11.5px",
                            borderRadius: "4px",
                            border: "1px solid #cbd5e1",
                          }}
                        />
                        <input
                          type="date"
                          value={st.due_date || ""}
                          onChange={(e) =>
                            handleUpdateSubtask(idx, { due_date: e.target.value })
                          }
                          title="Subtask Due Date"
                          style={{
                            padding: "4px 6px",
                            fontSize: "11.5px",
                            borderRadius: "4px",
                            border: "1px solid #cbd5e1",
                          }}
                        />
                      </div>

                      {/* Subtask Assignees via SearchableUserSelect */}
                      <div>
                        <label
                          style={{
                            display: "block",
                            fontSize: "11.5px",
                            fontWeight: 600,
                            color: "#64748b",
                            marginBottom: "4px",
                          }}
                        >
                          Assignees for this subtask:
                        </label>
                        <SearchableUserSelect
                          users={availableUsers}
                          selectedUserIds={st.assignee_ids || []}
                          onChange={(ids) => handleUpdateSubtask(idx, { assignee_ids: ids })}
                          multiple={true}
                          placeholder="Search subtask assignees..."
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* --- Attachments & Voice Notes Section --- */}
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "16px",
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                style={{ display: "none" }}
              />

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "10px",
                }}
              >
                <div>
                  <h4 style={{ margin: 0, fontSize: "13.5px", fontWeight: 700, color: "#1e293b" }}>
                    Attachments & Voice Brief
                  </h4>
                  <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#64748b" }}>
                    Attach documents, images, specs, or record an audio briefing
                  </p>
                </div>

                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingAttachment || submitting}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      padding: "5px 10px",
                      fontSize: "12px",
                      fontWeight: 600,
                      background: "#ffffff",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      color: "#334155",
                      cursor: isUploadingAttachment || submitting ? "not-allowed" : "pointer",
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                    <span>+ Add Files</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowVoiceRecorder((prev) => !prev)}
                    disabled={isUploadingAttachment || submitting}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      padding: "5px 10px",
                      fontSize: "12px",
                      fontWeight: 600,
                      background: showVoiceRecorder ? "rgba(239, 68, 68, 0.1)" : "#ffffff",
                      border: showVoiceRecorder ? "1px solid rgba(239, 68, 68, 0.3)" : "1px solid #cbd5e1",
                      borderRadius: "6px",
                      color: showVoiceRecorder ? "#ef4444" : "#334155",
                      cursor: isUploadingAttachment || submitting ? "not-allowed" : "pointer",
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    </svg>
                    <span>{showVoiceRecorder ? "Close Mic" : "🎤 Record Voice"}</span>
                  </button>
                </div>
              </div>

              {/* Uploading indicator */}
              {isUploadingAttachment && (
                <div style={{ fontSize: "12px", color: "#4f46e5", padding: "6px 0", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>Uploading files, please wait...</span>
                </div>
              )}

              {/* Voice Note Recorder Inline */}
              {showVoiceRecorder && (
                <div style={{ marginBottom: "12px" }}>
                  <VoiceNoteRecorder
                    onRecordingComplete={handleVoiceRecordingComplete}
                    onCancel={() => setShowVoiceRecorder(false)}
                    isUploading={isUploadingAttachment}
                  />
                </div>
              )}

              {/* Recorded Voice Notes List */}
              {voiceNotes.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "10px" }}>
                  <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                    Voice Notes ({voiceNotes.length})
                  </span>
                  {voiceNotes.map((vn, vIdx) => (
                    <div
                      key={vIdx}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 10px",
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1 }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2">
                          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        </svg>
                        <audio src={vn.audio_url} controls style={{ height: "30px", flex: 1, maxWidth: "340px" }} />
                        <span style={{ fontSize: "11.5px", color: "#64748b" }}>{vn.duration_seconds}s</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveVoiceNote(vIdx)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#94a3b8",
                          cursor: "pointer",
                          padding: "2px 6px",
                          fontSize: "14px",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Attachments List */}
              {attachments.length > 0 && (
                <div style={{ marginTop: "6px" }}>
                  <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                    Files ({attachments.length})
                  </span>
                  <AttachmentList
                    attachments={attachments}
                    onDelete={handleRemoveAttachment}
                    canDelete={true}
                  />
                </div>
              )}

              {attachments.length === 0 && voiceNotes.length === 0 && !showVoiceRecorder && (
                <div
                  style={{
                    fontSize: "12px",
                    color: "#94a3b8",
                    fontStyle: "italic",
                    textAlign: "center",
                    padding: "10px 0",
                  }}
                >
                  No attachments or voice notes added yet.
                </div>
              )}
            </div>
          </div>

          {/* Modal Footer */}
          <div
            style={{
              padding: "14px 24px",
              borderTop: "1px solid #e2e8f0",
              background: "#f8fafc",
              display: "flex",
              justifyContent: "flex-end",
              gap: "10px",
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Creating Task..." : "Create Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
