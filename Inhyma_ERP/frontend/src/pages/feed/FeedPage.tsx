import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Pagination } from "@/components/Pagination";
import { Modal } from "@/components/ui";
import { useAuth } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import { feedApi } from "@/lib/feedApi";
import { errorMessage } from "@/lib/api";
import { FeedComposer } from "./FeedComposer";
import { FeedPostCard } from "./FeedPostCard";
import { FeedEditModal } from "./FeedEditModal";
import type { FeedPost } from "@/types/feed";
import "@/styles/feed.css";

export function FeedPage() {
  const [searchParams] = useSearchParams();
  const targetPostId = searchParams.get("post_id");
  const { profile } = useAuth();
  const showToast = useToast();

  // Deep-link target post highlight & resolution state
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null);
  const [targetPostLoading, setTargetPostLoading] = useState(false);
  const resolvedTargetRef = useRef<string | null>(null);

  // Every authenticated employee can create announcements (Phase 1)
  const canCreate = Boolean(profile?.id);

  // Posts state
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Search state
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  // Composer expanded state
  const [composerOpen, setComposerOpen] = useState(true);

  // Edit / Delete Modal state
  const [editingPost, setEditingPost] = useState<FeedPost | null>(null);
  const [deletingPost, setDeletingPost] = useState<FeedPost | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // Fetch posts from API
  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await feedApi.listPosts({
        page,
        page_size: pageSize,
        search: appliedSearch.trim() || undefined,
      });

      const data = res.data;
      setPosts(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(data.total_pages || 1);
    } catch (err) {
      setError(errorMessage(err) || "Failed to load feed announcements.");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, appliedSearch]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // Clear sensitive Feed state when user identity changes
  useEffect(() => {
    setPosts([]);
    setPage(1);
    resolvedTargetRef.current = null;
    setHighlightedPostId(null);
  }, [profile?.id]);

  // Deep-link resolution for /feed?post_id={id}
  useEffect(() => {
    if (!targetPostId) {
      resolvedTargetRef.current = null;
      setHighlightedPostId(null);
      return;
    }

    if (resolvedTargetRef.current === targetPostId && highlightedPostId === targetPostId) {
      return;
    }

    // Wait if initial page load is still underway
    if (loading) return;

    let isMounted = true;

    const resolveTarget = async () => {
      // 1. Check if post is already present in current page items
      const found = posts.some((p) => p.id === targetPostId);
      if (found) {
        resolvedTargetRef.current = targetPostId;
        setHighlightedPostId(targetPostId);
        setTimeout(() => {
          if (typeof document !== "undefined") {
            const el = document.getElementById(`feed-post-${targetPostId}`);
            if (el && typeof el.scrollIntoView === "function") {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }
        }, 150);
        return;
      }

      // 2. Fetch directly by ID if not in the current page
      setTargetPostLoading(true);
      try {
        const res = await feedApi.getPost(targetPostId);
        const singlePost: FeedPost = (res as any)?.data ?? res;
        if (!isMounted) return;

        if (singlePost && singlePost.id) {
          resolvedTargetRef.current = targetPostId;
          setPosts((prev) => {
            if (prev.some((p) => p.id === singlePost.id)) return prev;
            return [singlePost, ...prev];
          });
          setHighlightedPostId(singlePost.id);
          setTimeout(() => {
            if (typeof document !== "undefined") {
              const el = document.getElementById(`feed-post-${singlePost.id}`);
              if (el && typeof el.scrollIntoView === "function") {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }
          }, 150);
        }
      } catch (err: any) {
        if (!isMounted) return;
        resolvedTargetRef.current = targetPostId;
        const status = err?.status ?? err?.response?.status;
        if (status === 403) {
          showToast("You do not have permission to view this announcement.", "error");
        } else if (status === 404) {
          showToast("The requested announcement could not be found or has been removed.", "error");
        } else {
          showToast(errorMessage(err) || "Failed to load the requested announcement.", "error");
        }
      } finally {
        if (isMounted) {
          setTargetPostLoading(false);
        }
      }
    };

    void resolveTarget();

    return () => {
      isMounted = false;
    };
  }, [targetPostId, loading, posts, highlightedPostId, showToast]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setAppliedSearch(search);
  };

  const handleClearSearch = () => {
    setSearch("");
    setAppliedSearch("");
    setPage(1);
  };

  // Delete action
  const confirmDelete = async () => {
    if (!deletingPost) return;
    setDeleteSubmitting(true);
    try {
      await feedApi.deletePost(deletingPost.id);
      showToast("Announcement deleted successfully.", "success");
      setDeletingPost(null);
      fetchPosts();
    } catch (err) {
      showToast(errorMessage(err) || "Failed to delete announcement.", "error");
    } finally {
      setDeleteSubmitting(false);
    }
  };

  return (
    <AppShell activeKey="feed">
      <div className="feed-page-container">
        {/* Header */}
        <header className="feed-header">
          <div className="feed-title-block">
            <h1>Feed & Broadcast Messaging</h1>
            <p>Publish company announcements and targeted updates to employees</p>
          </div>

          <div className="feed-header-actions">
            {/* Search */}
            <form onSubmit={handleSearchSubmit} className="feed-search-bar">
              <span className="feed-search-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </span>
              <input
                type="text"
                className="feed-search-input"
                placeholder="Search announcements..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="feed-search-input"
              />
              {search && (
                <button
                  type="button"
                  className="feed-search-clear"
                  onClick={handleClearSearch}
                  title="Clear search"
                  data-testid="feed-search-clear-btn"
                >
                  ✕
                </button>
              )}
            </form>

            {/* Toggle Composer button */}
            {canCreate && !composerOpen && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setComposerOpen(true)}
                data-testid="new-broadcast-btn"
                style={{ background: "#0061f2", color: "#ffffff", display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <span>+</span>
                <span>New Announcement</span>
              </button>
            )}
          </div>
        </header>

        {/* Composer */}
        {canCreate && composerOpen && (
          <FeedComposer
            currentUserName={String(profile?.display_name || profile?.full_name || "Me")}
            onPostCreated={() => {
              setPage(1);
              fetchPosts();
            }}
            onCancel={() => setComposerOpen(false)}
          />
        )}

        {/* Feed List */}
        <section aria-label="Announcements Feed">
              {loading ? (
                <div className="feed-posts-list" data-testid="feed-loading-state">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="feed-skeleton-card">
                      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                        <div className="feed-skeleton-line" style={{ width: "36px", height: "36px", borderRadius: "50%" }} />
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "180px" }}>
                          <div className="feed-skeleton-line" style={{ height: "14px", width: "100%" }} />
                          <div className="feed-skeleton-line" style={{ height: "10px", width: "60%" }} />
                        </div>
                      </div>
                      <div className="feed-skeleton-line" style={{ height: "18px", width: "70%", marginTop: "6px" }} />
                      <div className="feed-skeleton-line" style={{ height: "48px", width: "100%" }} />
                    </div>
                  ))}
                </div>
              ) : error ? (
                <div className="feed-error-state" data-testid="feed-error-state">
                  <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: "8px" }}>
                    Unable to load feed
                  </div>
                  <p style={{ margin: "0 0 16px 0", fontSize: "13.5px" }}>{error}</p>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={fetchPosts}
                    data-testid="feed-retry-btn"
                  >
                    Try Again
                  </button>
                </div>
              ) : posts.length === 0 ? (
                <div className="feed-empty-state" data-testid="feed-empty-state">
                  <div className="feed-empty-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                  </div>
                  <div className="feed-empty-title">
                    {appliedSearch ? "No announcements matching your search" : "No announcements yet"}
                  </div>
                  <div className="feed-empty-desc">
                    {appliedSearch
                      ? `We couldn't find any announcements matching "${appliedSearch}". Try clearing your search filter.`
                      : "Broadcast announcements and targeted updates published to you or everyone in the company will appear here."}
                  </div>
                  {appliedSearch ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleClearSearch}
                    >
                      Clear Search
                    </button>
                  ) : canCreate && !composerOpen ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setComposerOpen(true)}
                      style={{ background: "#0061f2", color: "#ffffff" }}
                    >
                      Create First Announcement
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="feed-posts-list" data-testid="feed-posts-list">
                  {targetPostLoading && (
                    <div
                      style={{
                        padding: "12px 16px",
                        marginBottom: "16px",
                        background: "#eff6ff",
                        border: "1px solid #bfdbfe",
                        borderRadius: "8px",
                        fontSize: "13px",
                        color: "#1d4ed8",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                      data-testid="target-post-loading"
                    >
                      <span>🔍</span>
                      <span>Locating linked announcement...</span>
                    </div>
                  )}
                  {posts.map((post) => {
                    const isAuthor = Boolean(post.is_author);
                    const userCanEdit = isAuthor;
                    const userCanDelete = isAuthor;

                    return (
                      <FeedPostCard
                        key={post.id}
                        post={post}
                        isHighlighted={post.id === highlightedPostId}
                        canEdit={userCanEdit}
                        canDelete={userCanDelete}
                        onEdit={(p) => setEditingPost(p)}
                        onDelete={(p) => setDeletingPost(p)}
                      />
                    );
                  })}
                </div>
              )}

              {/* Pagination */}
              {!loading && !error && total > 0 && (
                <div style={{ marginTop: "24px" }} data-testid="feed-pagination">
                  <Pagination
                    pagination={{
                      current_page: page,
                      total_pages: totalPages,
                      total_records: total,
                      page_size: pageSize,
                    }}
                    pageSize={pageSize}
                    onPageChange={(newPage) => setPage(newPage)}
                    onPageSizeChange={(newSize) => {
                      setPageSize(newSize);
                      setPage(1);
                    }}
                  />
                </div>
              )}
            </section>

        {/* Edit Modal */}
        <FeedEditModal
          post={editingPost}
          open={Boolean(editingPost)}
          onClose={() => setEditingPost(null)}
          onPostUpdated={fetchPosts}
        />

        {/* Delete Confirmation Modal */}
        <Modal
          open={Boolean(deletingPost)}
          title="Delete Announcement"
          onClose={() => setDeletingPost(null)}
          variant="center"
          cardStyle={{ maxWidth: "460px" }}
          locked={deleteSubmitting}
        >
          <div data-testid="delete-confirm-modal">
            <p style={{ fontSize: "14px", color: "#334155", margin: "0 0 20px 0", lineHeight: 1.5 }}>
              Are you sure you want to delete this announcement? This action will permanently remove it from the feed.
            </p>
            {deletingPost?.title && (
              <div style={{ padding: "8px 12px", background: "#f8fafc", borderRadius: "6px", fontSize: "13px", fontWeight: 600, color: "#0f172a", marginBottom: "20px" }}>
                "{deletingPost.title}"
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeletingPost(null)}
                disabled={deleteSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmDelete}
                disabled={deleteSubmitting}
                data-testid="confirm-delete-btn"
                style={{ background: "#ef4444", color: "#ffffff", border: "none" }}
              >
                {deleteSubmitting ? "Deleting..." : "Delete Announcement"}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </AppShell>
  );
}
export default FeedPage;

