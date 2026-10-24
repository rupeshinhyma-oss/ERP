import { useState, useEffect } from "react";
import { Modal } from "@/components/ui";
import { feedApi } from "@/lib/feedApi";
import { useToast } from "@/lib/toast";
import { errorMessage } from "@/lib/api";
import type { FeedPost } from "@/types/feed";

interface FeedEditModalProps {
  post: FeedPost | null;
  open: boolean;
  onClose: () => void;
  onPostUpdated: () => void;
}

export function FeedEditModal({
  post,
  open,
  onClose,
  onPostUpdated,
}: FeedEditModalProps) {
  const showToast = useToast();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [publishNow, setPublishNow] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (post) {
      setTitle(post.title || "");
      setContent(post.content || "");
      setPublishNow(false);
    }
  }, [post]);

  if (!post) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) {
      showToast("Message content is required.", "warning");
      return;
    }

    setSubmitting(true);
    try {
      const payload: { title?: string; content: string; status?: "PUBLISHED" | "DRAFT" } = {
        title: title.trim() || undefined,
        content: content.trim(),
      };

      if (post.status === "DRAFT" && publishNow) {
        payload.status = "PUBLISHED";
      }

      await feedApi.updatePost(post.id, payload);
      showToast("Announcement updated successfully.", "success");
      onPostUpdated();
      onClose();
    } catch (err) {
      showToast(errorMessage(err) || "Failed to update announcement.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Edit Announcement"
      onClose={onClose}
      variant="center"
      cardStyle={{ maxWidth: "600px", width: "100%" }}
      locked={submitting}
    >
      <form onSubmit={handleSubmit} data-testid="feed-edit-form">
        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
            Title
          </label>
          <input
            type="text"
            className="feed-composer-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={submitting}
            maxLength={255}
            data-testid="feed-edit-title"
          />
        </div>

        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
            Message Content <span style={{ color: "#ef4444" }}>*</span>
          </label>
          <textarea
            className="feed-composer-textarea"
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={submitting}
            required
            data-testid="feed-edit-content"
          />
        </div>

        {post.status === "DRAFT" && (
          <div style={{ marginBottom: "20px", display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="checkbox"
              id="publishNowCheckbox"
              checked={publishNow}
              onChange={(e) => setPublishNow(e.target.checked)}
              disabled={submitting}
              data-testid="feed-edit-publish-now"
            />
            <label htmlFor="publishNowCheckbox" style={{ fontSize: "13.5px", color: "#1e293b", cursor: "pointer" }}>
              Publish immediately to audience
            </label>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "24px" }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
            data-testid="feed-edit-save-btn"
            style={{ background: "#0061f2", color: "#ffffff" }}
          >
            {submitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
