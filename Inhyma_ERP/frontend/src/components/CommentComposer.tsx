import React, { useEffect, useRef, useState } from "react";
import { tasksApi } from "@/lib/tasksApi";
import { VoiceNoteRecorder } from "@/components/VoiceNoteRecorder";
import type { AvailableUser } from "@/types/tasks";

export interface CommentSubmitData {
  message: string;
  audio_url?: string;
  attachments?: { file_name: string; file_url: string; file_size: number; file_type?: string }[];
}

interface CommentComposerProps {
  onSubmit: (data: CommentSubmitData) => Promise<void> | void;
  placeholder?: string;
  isSubmitting?: boolean;
  buttonLabel?: string;
  users?: AvailableUser[];
}

export const CommentComposer: React.FC<CommentComposerProps> = ({
  onSubmit,
  placeholder = "Type your comment or update... (@ to mention, paste screenshot)",
  isSubmitting = false,
  buttonLabel = "Send",
  users,
}) => {
  const [message, setMessage] = useState<string>("");
  const [attachments, setAttachments] = useState<
    { file_name: string; file_url: string; file_size: number; file_type?: string }[]
  >([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [showRecorder, setShowRecorder] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Mention State
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>(users || []);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState<number>(-1);
  const [filteredUsers, setFilteredUsers] = useState<AvailableUser[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (users && users.length > 0) {
      setAvailableUsers(users);
    } else {
      tasksApi.getAvailableAssignees().then((u) => setAvailableUsers(u));
    }
  }, [users]);

  // Handle Mentions typing
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const cursorPos = e.target.selectionStart;
    setMessage(val);

    // Look backwards from cursor for @
    const textBeforeCursor = val.slice(0, cursorPos);
    const match = textBeforeCursor.match(/@([a-zA-Z0-9_.@-]*)$/);

    if (match) {
      const q = match[1].toLowerCase();
      setMentionQuery(q);
      const matches = availableUsers.filter(
        (u) =>
          u.full_name.toLowerCase().includes(q) ||
          (u.username && u.username.toLowerCase().includes(q)) ||
          (u.email ? u.email.toLowerCase().includes(q) : false)
      );
      setFilteredUsers(matches.slice(0, 6));
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  };

  const insertMention = (user: AvailableUser) => {
    if (!textareaRef.current) return;
    const cursorPos = textareaRef.current.selectionStart;
    const textBefore = message.slice(0, cursorPos);
    const textAfter = message.slice(cursorPos);

    const atPos = textBefore.lastIndexOf("@");
    if (atPos === -1) return;

    const mentionText = `@${user.username || user.full_name.replace(/\s+/g, "_")} `;
    const newText = textBefore.slice(0, atPos) + mentionText + textAfter;
    setMessage(newText);
    setMentionQuery(null);

    setTimeout(() => {
      if (textareaRef.current) {
        const nextPos = atPos + mentionText.length;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(nextPos, nextPos);
      }
    }, 10);
  };

  const handleUploadFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    setUploadError(null);

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
      setUploadError(err.message || "Failed to upload file.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleUploadFiles(e.target.files);
    }
  };

  // Clipboard Screenshot Paste
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf("image") !== -1) {
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(
            new File([file], `screenshot_${Date.now()}.png`, { type: file.type })
          );
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      handleUploadFiles(imageFiles);
    }
  };

  // Drag & Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUploadFiles(e.dataTransfer.files);
    }
  };

  const handleVoiceRecordingComplete = async (blob: Blob, _durationSeconds: number) => {
    setIsUploading(true);
    setUploadError(null);
    try {
      const res = await tasksApi.uploadTaskFile(blob, "voice_note.webm");
      setAudioUrl(res.file_url);
      setShowRecorder(false);
    } catch (err: any) {
      console.error("Failed to upload voice note:", err);
      setUploadError(err.message || "Failed to upload voice recording.");
    } finally {
      setIsUploading(false);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const removeAudio = () => {
    setAudioUrl(null);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed && !audioUrl && attachments.length === 0) return;

    await onSubmit({
      message: trimmed || (audioUrl ? "Voice note attached" : "Attachment uploaded"),
      audio_url: audioUrl || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    setMessage("");
    setAttachments([]);
    setAudioUrl(null);
    setShowRecorder(false);
    setUploadError(null);
    setMentionQuery(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && filteredUsers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % filteredUsers.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + filteredUsers.length) % filteredUsers.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredUsers[mentionIndex >= 0 ? mentionIndex : 0]);
        return;
      }
      if (e.key === "Escape") {
        setMentionQuery(null);
        return;
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const hasContent = message.trim().length > 0 || !!audioUrl || attachments.length > 0;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex flex-col gap-2 bg-white dark:bg-slate-900 border rounded-xl p-3 shadow-sm transition-all ${
        isDragging
          ? "border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-900 bg-indigo-50/20"
          : "border-slate-200 dark:border-slate-800"
      }`}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        style={{ display: "none" }}
      />

      {/* Upload error banner */}
      {uploadError && (
        <div className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/40 p-2 rounded-md">
          {uploadError}
        </div>
      )}

      {/* Main text area */}
      <textarea
        ref={textareaRef}
        value={message}
        onChange={handleTextChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={placeholder}
        rows={2}
        disabled={isSubmitting || isUploading}
        className="w-full resize-y min-h-[48px] max-h-[180px] border-none outline-none text-xs text-slate-800 dark:text-slate-100 bg-transparent p-1 focus:ring-0"
      />

      {/* Mention Popup */}
      {mentionQuery !== null && filteredUsers.length > 0 && (
        <div className="absolute left-3 bottom-12 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-1 max-w-[260px] w-full divide-y divide-slate-100 dark:divide-slate-800">
          <div className="px-2.5 py-1 text-[10px] uppercase font-semibold text-slate-400">
            Mention Team Member
          </div>
          {filteredUsers.map((u, idx) => (
            <button
              key={u.id}
              type="button"
              onClick={() => insertMention(u)}
              className={`w-full text-left px-2.5 py-1.5 flex items-center gap-2 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-xs transition-colors ${
                idx === mentionIndex ? "bg-indigo-50 dark:bg-indigo-950/40 font-semibold text-indigo-600" : "text-slate-700 dark:text-slate-200"
              }`}
            >
              <div className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-[10px] font-bold">
                {u.full_name.charAt(0)}
              </div>
              <div className="truncate">
                <div>{u.full_name}</div>
                {u.username && <div className="text-[10px] text-slate-400">@{u.username}</div>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Attached Voice Note Preview Chip */}
      {audioUrl && (
        <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg w-fit">
          <audio src={audioUrl} controls className="h-6 max-w-[200px]" />
          <button
            type="button"
            onClick={removeAudio}
            title="Remove voice note"
            className="text-slate-400 hover:text-rose-500"
          >
            &times;
          </button>
        </div>
      )}

      {/* Attached Files Chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((att, idx) => (
            <div
              key={idx}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs max-w-[220px]"
            >
              <span className="truncate text-slate-700 dark:text-slate-200">{att.file_name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(idx)}
                className="text-slate-400 hover:text-rose-500 font-bold ml-1"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Voice Recorder Inline Component */}
      {showRecorder && (
        <div className="my-1">
          <VoiceNoteRecorder
            onRecordingComplete={handleVoiceRecordingComplete}
            onCancel={() => setShowRecorder(false)}
            isUploading={isUploading}
          />
        </div>
      )}

      {/* Action Bar */}
      <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2 text-xs">
        <div className="flex items-center gap-2">
          {/* Attach file button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSubmitting || isUploading}
            title="Attach file (or drag & drop)"
            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <span>📎 Attach</span>
          </button>

          {/* Record voice note button */}
          <button
            type="button"
            onClick={() => setShowRecorder((prev) => !prev)}
            disabled={isSubmitting || isUploading || !!audioUrl}
            title="Record voice note"
            className={`inline-flex items-center gap-1 px-2 py-1 rounded transition-colors ${
              showRecorder
                ? "bg-rose-50 text-rose-600 dark:bg-rose-950/40"
                : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <span>🎙️ Voice</span>
          </button>

          <span className="text-[11px] text-slate-400 hidden sm:inline">
            Paste screenshot directly with Ctrl+V
          </span>
        </div>

        {/* Send button */}
        <button
          type="button"
          onClick={() => handleSubmit()}
          disabled={!hasContent || isSubmitting || isUploading}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-white transition-colors ${
            hasContent && !isSubmitting && !isUploading
              ? "bg-indigo-600 hover:bg-indigo-700 shadow-sm"
              : "bg-slate-300 dark:bg-slate-700 cursor-not-allowed"
          }`}
        >
          {isSubmitting || isUploading ? "Sending..." : buttonLabel}
        </button>
      </div>
    </div>
  );
};
