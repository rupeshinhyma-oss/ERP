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
import { FeedDirectMessages } from "./FeedDirectMessages";
import type { FeedPost } from "@/types/feed";
import "@/styles/feed.css";

type FeedTab = "announcements" | "messages";

export function FeedPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: FeedTab = searchParams.get("tab") === "messages" ? "messages" : "announcements";
  const targetPostId = searchParams.get("post_id");
  const targetConversationId = searchParams.get("conversation_id");

  const { profile, hasPermission } = useAuth();
  const showToast = useToast();

  // Enforce Feed RBAC permission contract (matching backend routes & AppShell)
  const rawPerms = Array.isArray(profile?.permissions) ? profile.permissions : [];
  const isInteractDenied =
    rawPerms.includes("deny:feed.interact") || rawPerms.includes("block:feed.interact");
  const canView = Boolean(profile?.id) && hasPermission("feed.view");
  const canCreate = canView && hasPermission("feed.create");
  const canInteract =
    canView &&
    !isInteractDenied &&
    (hasPermission("feed.interact") || hasPermission("feed.create"));
  const canManage = canView && hasPermission("feed.manage");

  // Unread DM badge state
  const [dmUnreadCount, setDmUnreadCount] = useState<number>(0);

  // Deep-link target post highlight & resolution state
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null);
  const [targetPostLoading, setTargetPostLoading] = useState(false);
  const resolvedTargetRef = useRef<string | null>(null);

  // Posts state
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination state (synced with ?page= query param so browser refresh preserves page)
  const initialUrlPage = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const [page, setPage] = useState<number>(initialUrlPage);
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

  const handlePageChange = useCallback(
    (nextPage: number) => {
      const safePage = Math.max(1, nextPage);
      setPage(safePage);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (safePage > 1) {
            next.set("page", String(safePage));
          } else {
            next.delete("page");
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const handleSwitchTab = useCallback(
    (tab: FeedTab) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (tab === "messages") {
          next.set("tab", "messages");
          next.delete("post_id");
          next.delete("page");
        } else {
          next.delete("tab");
          next.delete("conversation_id");
        }
        return next;
      });
    },
    [setSearchParams]
  );

  const handleConversationSelect = useCallback(
    (conversationId: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", "messages");
          if (conversationId) {
            next.set("conversation_id", conversationId);
          } else {
            next.delete("conversation_id");
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  // Fetch unread direct message count for tab badge
  useEffect(() => {
    if (!canView || typeof feedApi.getUnreadDirectMessagesCount !== "function") return;
    let active = true;
    feedApi
      .getUnreadDirectMessagesCount()
      .then((res) => {
        if (active && typeof res?.data?.unread_count === "number") {
          setDmUnreadCount(res.data.unread_count);
        }
      })
      .catch(() => {
        /* ignore non-fatal unread count errors */
      });
    return () => {
      active = false;
    };
  }, [canView, profile?.id]);

  // Fetch posts from API
  const fetchPosts = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await feedApi.listPosts({
        page,
        page_size: pageSize,
        search: appliedSearch.trim() || undefined,
      });

      const data = res.data;
      const items = data.items || [];
      const totalRecords = data.total || 0;
      const resolvedPages = Math.max(1, data.total_pages ?? data.pages ?? 1);

      if (items.length === 0 && totalRecords > 0 && page > resolvedPages) {
        handlePageChange(resolvedPages);
        return;
      }

      setPosts(items);
      setTotal(totalRecords);
      setTotalPages(resolvedPages);
    } catch (err) {
      setError(errorMessage(err) || "Failed to load feed announcements.");
    } finally {
      setLoading(false);
    }
  }, [canView, page, pageSize, appliedSearch, handlePageChange]);

  useEffect(() => {
    if (activeTab === "announcements") {
      void fetchPosts();
    }
  }, [activeTab, fetchPosts]);

  // Clear sensitive Feed state when user identity changes
  useEffect(() => {
    setPosts([]);
    setPage(1);
    setDmUnreadCount(0);
    resolvedTargetRef.current = null;
    setHighlightedPostId(null);
  }, [profile?.id]);

  // Deep-link resolution for /feed?post_id={id}
  useEffect(() => {
    if (!canView || activeTab !== "announcements" || !targetPostId) {
      resolvedTargetRef.current = null;
      setHighlightedPostId(null);
      return;
    }

    if (resolvedTargetRef.current === targetPostId && highlightedPostId === targetPostId) {
      return;
    }

    if (loading) return;

    let isMounted = true;

    const resolveTarget = async () => {
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
  }, [canView, activeTab, targetPostId, loading, posts, highlightedPostId, showToast]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handlePageChange(1);
    setAppliedSearch(search);
  };

  const handleClearSearch = () => {
    setSearch("");
    setAppliedSearch("");
    handlePageChange(1);
  };

  const confirmDelete = async () => {
    if (!deletingPost) return;
    setDeleteSubmitting(true);
    try {
      await feedApi.deletePost(deletingPost.id);
      showToast("Announcement deleted successfully.", "success");
      setDeletingPost(null);
      void fetchPosts();
    } catch (err) {
      showToast(errorMessage(err) || "Failed to delete announcement.", "error");
    } finally {
      setDeleteSubmitting(false);
    }
  };

  if (!canView) {
    return (
      <AppShell activeKey="feed">
        <div className="feed-page-container">
          <div className="feed-error-state" data-testid="feed-forbidden-state">
            <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: "8px" }}>
              Access Restricted
            </div>
            <p style={{ margin: 0, fontSize: "13.5px" }}>
              You do not have permission (`feed.view`) to access Feed & Broadcasts.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell activeKey="feed">
      <div className="feed-page-container">
        {/* Header */}
        <header className="feed-header">
          <div className="feed-title-block">
            <h1>Feed & Broadcast Messaging</h1>
            <p>Publish company announcements, targeted updates, and direct colleague messages</p>
          </div>

          {activeTab === "announcements" && (
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
          )}
        </header>

        {/* Sub-view Navigation Tabs (Announcements vs Direct Messages) */}
        <nav className="feed-nav-tabs" aria-label="Feed Views" data-testid="feed-nav-tabs">
          <button
            type="button"
            className={`feed-nav-tab-btn ${activeTab === "announcements" ? "active" : ""}`}
            onClick={() => handleSwitchTab("announcements")}
            data-testid="feed-tab-announcements"
          >
            <span>📢</span>
            <span>Announcements</span>
          </button>
          <button
            type="button"
            className={`feed-nav-tab-btn ${activeTab === "messages" ? "active" : ""}`}
            onClick={() => handleSwitchTab("messages")}
            data-testid="feed-tab-messages"
          >
            <span>💬</span>
            <span>Direct Messages</span>
            {dmUnreadCount > 0 && (
              <span className="feed-nav-badge" data-testid="feed-dm-tab-badge">
                {dmUnreadCount}
              </span>
            )}
          </button>
        </nav>

        {activeTab === "messages" ? (
          <section aria-label="Direct Messages">
            <FeedDirectMessages
              currentUserId={profile?.id}
              initialConversationId={targetConversationId}
              canCreateMessage={canCreate}
              canReplyMessage={canInteract}
              onConversationSelect={handleConversationSelect}
              onUnreadCountChange={setDmUnreadCount}
            />
          </section>
        ) : (
          <>
            {/* Composer */}
            {canCreate && composerOpen && (
              <FeedComposer
                currentUserName={String(
                  profile?.display_name ||
                    profile?.full_name ||
                    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
                    "Me"
                )}
                onPostCreated={() => {
                  handlePageChange(1);
                  void fetchPosts();
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
                    onClick={() => void fetchPosts()}
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
                    const userCanEdit = post.can_edit ?? (isAuthor && canCreate);
                    const userCanDelete =
                      post.can_delete ??
                      ((isAuthor && (canCreate || canManage)) ||
                        (canManage && post.status === "PUBLISHED"));

                    return (
                      <FeedPostCard
                        key={post.id}
                        post={post}
                        isHighlighted={post.id === highlightedPostId}
                        canEdit={userCanEdit}
                        canDelete={userCanDelete}
                        canInteract={canInteract}
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
                    onPageChange={handlePageChange}
                    onPageSizeChange={(newSize) => {
                      setPageSize(newSize);
                      handlePageChange(1);
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
                    onClick={() => void confirmDelete()}
                    disabled={deleteSubmitting}
                    data-testid="confirm-delete-btn"
                    style={{ background: "#ef4444", color: "#ffffff", border: "none" }}
                  >
                    {deleteSubmitting ? "Deleting..." : "Delete Announcement"}
                  </button>
                </div>
              </div>
            </Modal>
          </>
        )}
      </div>
    </AppShell>
  );
}
export default FeedPage;
