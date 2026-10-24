import { useState, useEffect } from "react";
import type {
  FeedPost,
  FeedComment,
  FeedReactionType,
  FeedReactionSummary,
  FeedReadershipResponse,
  FeedCommentListResponse,
} from "@/types/feed";
import { feedApi } from "@/lib/feedApi";
import { useToast } from "@/lib/toast";
import { errorMessage } from "@/lib/api";

interface FeedPostCardProps {
  post: FeedPost;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (post: FeedPost) => void;
  onDelete: (post: FeedPost) => void;
}

export function FeedPostCard({
  post,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: FeedPostCardProps) {
  const showToast = useToast();
  const [showAllRecipients, setShowAllRecipients] = useState(false);

  // Read status tracking
  const [isRead, setIsRead] = useState<boolean>(Boolean(post.is_read || post.is_author));

  // Reactions state
  const [reactions, setReactions] = useState<FeedReactionSummary>(
    post.reactions_summary || {
      counts: { like: 0, celebrate: 0, support: 0, total: 0 },
      user_reaction: null,
    }
  );
  const [isReacting, setIsReacting] = useState(false);

  // Comments state
  const [commentsCount, setCommentsCount] = useState<number>(post.comments_count || 0);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [newCommentText, setNewCommentText] = useState("");
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  // Readership modal state (Author / Admin only)
  const [isReadershipOpen, setIsReadershipOpen] = useState(false);
  const [readershipData, setReadershipData] = useState<FeedReadershipResponse | null>(null);
  const [isLoadingReadership, setIsLoadingReadership] = useState(false);

  const authorName = post.author?.display_name || post.author?.full_name || "Unknown Author";
  const authorInitials = authorName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const formattedDate = post.published_at
    ? new Date(post.published_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : new Date(post.created_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

  const recipientCount = post.recipients?.length || 0;
  const displayedRecipients = showAllRecipients
    ? post.recipients
    : post.recipients?.slice(0, 5);

  const canViewReadership = Boolean(post.is_author);
  const reactionCounts = reactions?.counts ?? { like: 0, celebrate: 0, support: 0, total: 0 };
  const reactionUser = reactions?.user_reaction ?? null;

  // Automatically mark as read if published and not yet read
  useEffect(() => {
    if (!isRead && !post.is_author && post.status === "PUBLISHED" && typeof feedApi.markAsRead === "function") {
      feedApi.markAsRead(post.id)
        .then(() => setIsRead(true))
        .catch(() => {
          // Silent catch for read status
        });
    }
  }, [post.id, isRead, post.is_author, post.status]);

  // Handle reaction toggle
  const handleReaction = async (type: FeedReactionType) => {
    if (isReacting || post.status !== "PUBLISHED") return;
    setIsReacting(true);
    try {
      const res = await feedApi.toggleReaction(post.id, type);
      const summary: FeedReactionSummary = (res as any)?.data ?? res;
      if (summary) {
        setReactions({
          counts: {
            like: summary.counts?.like ?? 0,
            celebrate: summary.counts?.celebrate ?? 0,
            support: summary.counts?.support ?? 0,
            total: summary.counts?.total ?? 0,
          },
          user_reaction: summary.user_reaction ?? null,
        });
      }
    } catch (err) {
      console.error("Failed to toggle reaction:", err);
      showToast(errorMessage(err) || "Failed to update reaction.", "error");
    } finally {
      setIsReacting(false);
    }
  };

  // Toggle comments
  const handleToggleComments = async () => {
    const nextState = !isCommentsOpen;
    setIsCommentsOpen(nextState);
    if (nextState && comments.length === 0) {
      setIsLoadingComments(true);
      try {
        const res = await feedApi.listComments(post.id);
        const data: FeedCommentListResponse = (res as any)?.data ?? res;
        setComments(Array.isArray(data?.items) ? data.items : []);
        setCommentsCount(typeof data?.total === "number" ? data.total : (data?.items?.length ?? 0));
      } catch (err) {
        console.error("Failed to load comments:", err);
        showToast(errorMessage(err) || "Failed to load comments.", "error");
      } finally {
        setIsLoadingComments(false);
      }
    }
  };

  // Submit comment
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = newCommentText.trim();
    if (!content || isSubmittingComment) return;

    setIsSubmittingComment(true);
    try {
      const res = await feedApi.addComment(post.id, content);
      const created: FeedComment = (res as any)?.data ?? res;
      if (created && created.id) {
        setComments((prev) => [...prev, created]);
        setCommentsCount((prev) => prev + 1);
        setNewCommentText("");
      }
    } catch (err) {
      console.error("Failed to post comment:", err);
      showToast(errorMessage(err) || "Failed to post comment.", "error");
    } finally {
      setIsSubmittingComment(false);
    }
  };

  // Update comment
  const handleSaveEditComment = async (commentId: string) => {
    const content = editingText.trim();
    if (!content) return;
    try {
      const res = await feedApi.updateComment(post.id, commentId, content);
      const updated: FeedComment = (res as any)?.data ?? res;
      if (updated && updated.id) {
        setComments((prev) => prev.map((c) => (c.id === commentId ? updated : c)));
      }
      setEditingCommentId(null);
    } catch (err) {
      console.error("Failed to update comment:", err);
      showToast(errorMessage(err) || "Failed to update comment.", "error");
    }
  };

  // Delete comment
  const handleDeleteComment = async (commentId: string) => {
    if (!window.confirm("Are you sure you want to delete this comment?")) return;
    try {
      await feedApi.deleteComment(post.id, commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setCommentsCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Failed to delete comment:", err);
      showToast(errorMessage(err) || "Failed to delete comment.", "error");
    }
  };

  // Load readership
  const handleOpenReadership = async () => {
    setIsReadershipOpen(true);
    setIsLoadingReadership(true);
    try {
      const res = await feedApi.getReadership(post.id);
      const data: FeedReadershipResponse = (res as any)?.data ?? res;
      setReadershipData(data);
    } catch (err) {
      console.error("Failed to load readership:", err);
      showToast(errorMessage(err) || "Failed to load readership.", "error");
    } finally {
      setIsLoadingReadership(false);
    }
  };

  return (
    <article
      className={`feed-post-card ${!isRead && post.status === "PUBLISHED" ? "feed-post-unread" : ""}`}
      data-testid={`feed-post-card-${post.id}`}
    >
      <div className="feed-post-card-header">
        <div className="feed-post-author-row">
          <div className="feed-composer-avatar" title={authorName}>
            {authorInitials}
          </div>
          <div className="feed-post-author-info">
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span className="feed-post-author-name">{authorName}</span>
              {post.author?.employee_code && (
                <span style={{ fontSize: "11px", color: "#64748b", background: "#f1f5f9", padding: "1px 6px", borderRadius: "4px" }}>
                  {post.author.employee_code}
                </span>
              )}
            </div>
            <div className="feed-post-author-meta">
              <span>{formattedDate}</span>
              {post.status === "DRAFT" && (
                <span className="feed-badge feed-badge-draft" data-testid="draft-badge">
                  📝 Draft
                </span>
              )}
              {post.is_author && (
                <span className="feed-badge feed-badge-author">
                  Author
                </span>
              )}
              {!isRead && post.status === "PUBLISHED" && (
                <span className="feed-badge feed-badge-unread" data-testid="unread-badge">
                  🔵 Unread
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {/* Audience Badge */}
          <div className="feed-post-badges-row">
            {post.audience_type === "ALL" ? (
              <span className="feed-badge feed-badge-all" title="Company-wide announcement" data-testid="audience-all-badge">
                🌐 Everyone
              </span>
            ) : (
              <>
                <span className="feed-badge feed-badge-selected" title="Targeted broadcast" data-testid="audience-selected-badge">
                  🎯 Selected ({recipientCount})
                </span>
                {post.targeted_departments && post.targeted_departments.length > 0 && (
                  <span className="feed-badge feed-badge-dept" title="Targeted Departments" data-testid="audience-dept-badge">
                    🏢 {post.targeted_departments.map((d) => d.name).join(", ")}
                  </span>
                )}
              </>
            )}
          </div>

          {/* Action Buttons */}
          {(canEdit || canDelete) && (
            <div className="feed-post-actions-group" data-testid="post-actions-group">
              {canEdit && (
                <button
                  type="button"
                  className="feed-post-action-btn"
                  onClick={() => onEdit(post)}
                  title="Edit announcement"
                  data-testid={`edit-post-${post.id}`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9"></path>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                  </svg>
                  <span>Edit</span>
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  className="feed-post-action-btn feed-post-action-btn-danger"
                  onClick={() => onDelete(post)}
                  title="Delete announcement"
                  data-testid={`delete-post-${post.id}`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                  <span>Delete</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Post Title */}
      {post.title && <h2 className="feed-post-title" data-testid="post-title">{post.title}</h2>}

      {/* Post Body Content */}
      <div className="feed-post-content" data-testid="post-content">
        {post.content}
      </div>

      {/* Selected Audience Recipient Details */}
      {post.audience_type === "SELECTED" && (recipientCount > 0 || (post.targeted_departments && post.targeted_departments.length > 0)) && (
        <div className="feed-post-recipients-box" data-testid="post-recipients-box">
          {post.targeted_departments && post.targeted_departments.length > 0 && (
            <div style={{ marginBottom: recipientCount > 0 ? "10px" : "0" }}>
              <div className="feed-post-recipients-title" style={{ marginBottom: "6px" }}>
                Targeted Department{post.targeted_departments.length === 1 ? "" : "s"}:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {post.targeted_departments.map((dept) => (
                  <span
                    key={dept.department_id}
                    className="feed-dept-chip"
                    style={{ fontSize: "11.5px", padding: "2px 8px" }}
                    data-testid={`post-dept-chip-${dept.department_id}`}
                  >
                    🏢 {dept.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {post.is_author && recipientCount > 0 && (
            <>
              <div className="feed-post-recipients-title">
                Delivered to {recipientCount} recipient{recipientCount === 1 ? "" : "s"}:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {displayedRecipients?.map((rec) => {
                  const name = rec.recipient?.display_name || rec.recipient?.full_name || "Employee";
                  const code = rec.recipient?.employee_code;
                  const dept = rec.recipient?.department_name;
                  return (
                    <span
                      key={rec.id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        padding: "2px 8px",
                        borderRadius: "12px",
                        fontSize: "11.5px",
                        color: "#334155",
                      }}
                    >
                      <span>{name}</span>
                      {dept && <span style={{ opacity: 0.7, fontSize: "10.5px" }}>• {dept}</span>}
                      {code && <span style={{ opacity: 0.65, fontSize: "10.5px" }}>({code})</span>}
                    </span>
                  );
                })}
                {!showAllRecipients && recipientCount > 5 && (
                  <button
                    type="button"
                    onClick={() => setShowAllRecipients(true)}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: "11.5px",
                      color: "#0061f2",
                      cursor: "pointer",
                      fontWeight: 500,
                      padding: "2px 4px",
                    }}
                  >
                    +{recipientCount - 5} more
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Interactions Bar: Reactions & Comments Trigger & Readership */}
      {post.status === "PUBLISHED" && (
        <div className="feed-interactions-bar" data-testid={`interactions-bar-${post.id}`}>
          {/* Reaction Buttons */}
          <div className="feed-reactions-group">
            <button
              type="button"
              className={`feed-reaction-btn ${reactionUser === "LIKE" ? "feed-reaction-active" : ""}`}
              onClick={() => handleReaction("LIKE")}
              title="Like"
              data-testid={`reaction-like-${post.id}`}
            >
              <span>👍</span>
              <span>Like</span>
              {(reactionCounts.like ?? 0) > 0 && (
                <span className="feed-reaction-count" data-testid={`count-like-${post.id}`}>
                  {reactionCounts.like}
                </span>
              )}
            </button>

            <button
              type="button"
              className={`feed-reaction-btn ${reactionUser === "CELEBRATE" ? "feed-reaction-active" : ""}`}
              onClick={() => handleReaction("CELEBRATE")}
              title="Celebrate"
              data-testid={`reaction-celebrate-${post.id}`}
            >
              <span>🎉</span>
              <span>Celebrate</span>
              {(reactionCounts.celebrate ?? 0) > 0 && (
                <span className="feed-reaction-count" data-testid={`count-celebrate-${post.id}`}>
                  {reactionCounts.celebrate}
                </span>
              )}
            </button>

            <button
              type="button"
              className={`feed-reaction-btn ${reactionUser === "SUPPORT" ? "feed-reaction-active" : ""}`}
              onClick={() => handleReaction("SUPPORT")}
              title="Support"
              data-testid={`reaction-support-${post.id}`}
            >
              <span>❤️</span>
              <span>Support</span>
              {(reactionCounts.support ?? 0) > 0 && (
                <span className="feed-reaction-count" data-testid={`count-support-${post.id}`}>
                  {reactionCounts.support}
                </span>
              )}
            </button>
          </div>

          {/* Meta actions: Comments count & Readership */}
          <div className="feed-meta-actions-group">
            <button
              type="button"
              className={`feed-interaction-toggle-btn ${isCommentsOpen ? "feed-toggle-active" : ""}`}
              onClick={handleToggleComments}
              data-testid={`toggle-comments-${post.id}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
              <span>{commentsCount > 0 ? `${commentsCount} Comments` : "Comment"}</span>
            </button>

            {canViewReadership && (
              <button
                type="button"
                className="feed-readership-btn"
                onClick={handleOpenReadership}
                title="View announcement readership"
                data-testid={`readership-btn-${post.id}`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
                <span>{post.read_count ?? 0} read</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Expandable Comments Section */}
      {isCommentsOpen && post.status === "PUBLISHED" && (
        <section className="feed-comments-section" data-testid={`comments-section-${post.id}`}>
          {isLoadingComments ? (
            <div style={{ padding: "12px", textAlign: "center", color: "#64748b", fontSize: "12.5px" }}>
              Loading comments...
            </div>
          ) : (
            <div className="feed-comments-list">
              {comments.map((comment) => {
                const cAuthor = comment.author?.display_name || comment.author?.full_name || "Colleague";
                const cInitials = cAuthor.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
                const cTime = new Date(comment.created_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                });
                const isEditing = editingCommentId === comment.id;

                return (
                  <div key={comment.id} className="feed-comment-item" data-testid={`comment-item-${comment.id}`}>
                    <div className="feed-comment-avatar">{cInitials}</div>
                    <div className="feed-comment-body">
                      <div className="feed-comment-header">
                        <span className="feed-comment-author-name">{cAuthor}</span>
                        <span className="feed-comment-time">{cTime}</span>
                      </div>

                      {isEditing ? (
                        <div style={{ marginTop: "4px" }}>
                          <textarea
                            className="feed-comment-input"
                            style={{ width: "100%", minHeight: "56px" }}
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            data-testid={`edit-comment-input-${comment.id}`}
                          />
                          <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                            <button
                              type="button"
                              className="feed-comment-submit-btn"
                              style={{ padding: "4px 10px", fontSize: "11.5px" }}
                              onClick={() => handleSaveEditComment(comment.id)}
                              data-testid={`save-comment-edit-${comment.id}`}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="feed-comment-action-btn"
                              onClick={() => setEditingCommentId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="feed-comment-text" data-testid={`comment-content-${comment.id}`}>
                          {comment.content}
                        </div>
                      )}

                      {!isEditing && (comment.is_author || comment.can_delete) && (
                        <div className="feed-comment-actions">
                          {comment.is_author && (
                            <button
                              type="button"
                              className="feed-comment-action-btn"
                              onClick={() => {
                                setEditingCommentId(comment.id);
                                setEditingText(comment.content);
                              }}
                              data-testid={`edit-comment-btn-${comment.id}`}
                            >
                              Edit
                            </button>
                          )}
                          {comment.can_delete && (
                            <button
                              type="button"
                              className="feed-comment-action-btn feed-btn-danger"
                              onClick={() => handleDeleteComment(comment.id)}
                              data-testid={`delete-comment-btn-${comment.id}`}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add Comment Input Form */}
          <form className="feed-comment-input-row" onSubmit={handleAddComment}>
            <input
              type="text"
              className="feed-comment-input"
              placeholder="Write a comment..."
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
              data-testid={`comment-input-${post.id}`}
            />
            <button
              type="submit"
              className="feed-comment-submit-btn"
              disabled={!newCommentText.trim() || isSubmittingComment}
              data-testid={`comment-submit-${post.id}`}
            >
              {isSubmittingComment ? "Posting..." : "Post"}
            </button>
          </form>
        </section>
      )}

      {/* Readership Modal (Author & Admin Only) */}
      {isReadershipOpen && (
        <div
          className="feed-modal-backdrop"
          onClick={() => setIsReadershipOpen(false)}
          data-testid={`readership-modal-${post.id}`}
        >
          <div className="feed-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="feed-modal-header">
              <h3>Announcement Readership</h3>
              <button
                type="button"
                className="feed-modal-close-btn"
                onClick={() => setIsReadershipOpen(false)}
                data-testid={`close-readership-modal-${post.id}`}
              >
                &times;
              </button>
            </div>
            <div className="feed-modal-body">
              {isLoadingReadership ? (
                <div style={{ textAlign: "center", padding: "20px", color: "#64748b" }}>
                  Loading readership...
                </div>
              ) : readershipData && Array.isArray(readershipData.readers) && readershipData.readers.length > 0 ? (
                <div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "10px" }}>
                    Read by {readershipData.total_readers} team member{readershipData.total_readers === 1 ? "" : "s"}:
                  </div>
                  {readershipData.readers.map((reader) => {
                    const rName = reader.display_name || reader.full_name;
                    const rInitials = rName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
                    const rTime = new Date(reader.read_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    });
                    return (
                      <div key={reader.user_id} className="feed-reader-item">
                        <div className="feed-reader-avatar">{rInitials}</div>
                        <div className="feed-reader-info">
                          <div className="feed-reader-name">{rName}</div>
                          {reader.employee_code && (
                            <div className="feed-reader-meta">ID: {reader.employee_code}</div>
                          )}
                        </div>
                        <div className="feed-reader-time">{rTime}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "24px", color: "#64748b" }}>
                  No readership recorded yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
