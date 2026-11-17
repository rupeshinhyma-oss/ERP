import React, { useState, useEffect, useRef, useCallback } from "react";
import { feedApi } from "@/lib/feedApi";
import { errorMessage } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Modal } from "@/components/ui";
import {
  MAX_DIRECT_MESSAGE_LENGTH,
  type Conversation,
  type DirectMessage,
  type EligibleRecipient,
} from "@/types/feed";

interface FeedDirectMessagesProps {
  currentUserId?: string;
  initialConversationId?: string | null;
  canCreateMessage?: boolean;
  onConversationSelect?: (conversationId: string | null) => void;
  onUnreadCountChange?: (count: number) => void;
}

export function FeedDirectMessages({
  currentUserId,
  initialConversationId,
  canCreateMessage = true,
  onConversationSelect,
  onUnreadCountChange,
}: FeedDirectMessagesProps) {
  const showToast = useToast();
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const onUnreadCountChangeRef = useRef(onUnreadCountChange);
  onUnreadCountChangeRef.current = onUnreadCountChange;
  const onConversationSelectRef = useRef(onConversationSelect);
  onConversationSelectRef.current = onConversationSelect;

  // Conversations list state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [conversationFilter, setConversationFilter] = useState("");
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const resolvedDeepLinkRef = useRef<string | null>(null);

  // Active chat state
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [newMessageText, setNewMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);

  // Editing message state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Deleting message state
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);

  // New Message Modal state
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [recipientQuery, setRecipientQuery] = useState("");
  const [eligibleRecipients, setEligibleRecipients] = useState<EligibleRecipient[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [startingConv, setStartingConv] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);

  const selectConversation = useCallback((convId: string | null) => {
    setSelectedConvId(convId);
    if (onConversationSelectRef.current) {
      onConversationSelectRef.current(convId);
    }
  }, []);

  // Scroll to bottom of message list
  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({
        behavior: smooth ? "smooth" : "auto",
        block: "end",
      });
    }
  }, []);

  // Fetch unread count for badge
  const refreshUnreadCount = useCallback(async () => {
    try {
      const res = await feedApi.getUnreadDirectMessagesCount();
      if (onUnreadCountChangeRef.current && typeof res?.data?.unread_count === "number") {
        onUnreadCountChangeRef.current(res.data.unread_count);
      }
    } catch {
      // Non-fatal background fetch
    }
  }, []);

  // Load conversations
  const loadConversations = useCallback(
    async (selectFirstIfNone = false) => {
      try {
        setConversationsError(null);
        const res = await feedApi.listConversations(1, 100);
        const items = res.data?.items || [];
        setConversations(items);
        void refreshUnreadCount();

        if (selectFirstIfNone && !initialConversationId && items.length > 0 && !selectedConvId) {
          setSelectedConvId(items[0].id);
        }
      } catch (err) {
        const msg = errorMessage(err) || "Failed to load direct messages.";
        setConversationsError(msg);
        showToastRef.current(msg, "error");
      } finally {
        setLoadingConversations(false);
      }
    },
    [initialConversationId, selectedConvId, refreshUnreadCount]
  );

  // Initial load
  useEffect(() => {
    void loadConversations(true);
  }, []);

  // Resolve deep-linked `?conversation_id=...` safely (validating participant access)
  useEffect(() => {
    if (!initialConversationId) {
      resolvedDeepLinkRef.current = null;
      return;
    }
    if (loadingConversations) return;
    if (resolvedDeepLinkRef.current === initialConversationId && selectedConvId === initialConversationId) {
      return;
    }

    const inList = conversations.find((c) => c.id === initialConversationId);
    if (inList) {
      resolvedDeepLinkRef.current = initialConversationId;
      setSelectedConvId(inList.id);
      setActiveConv(inList);
      return;
    }

    let active = true;
    const resolveLinkedConversation = async () => {
      try {
        const res = await feedApi.getConversation(initialConversationId);
        const fetched = (res as any)?.data ?? res;
        if (!active) return;
        if (fetched && fetched.id) {
          resolvedDeepLinkRef.current = initialConversationId;
          setConversations((prev) =>
            prev.some((c) => c.id === fetched.id) ? prev : [fetched, ...prev]
          );
          setSelectedConvId(fetched.id);
          setActiveConv(fetched);
        }
      } catch (err: any) {
        if (!active) return;
        resolvedDeepLinkRef.current = initialConversationId;
        const status = err?.status ?? err?.response?.status;
        if (status === 403) {
          showToastRef.current("You do not have permission to view this conversation.", "error");
        } else if (status === 404 || status === 422) {
          showToastRef.current("The requested conversation could not be found or has been removed.", "error");
        } else {
          showToastRef.current(errorMessage(err) || "Unable to open the requested conversation.", "error");
        }
        setSelectedConvId((prev) => (prev === initialConversationId ? null : prev));
      }
    };

    void resolveLinkedConversation();
    return () => {
      active = false;
    };
  }, [initialConversationId, loadingConversations, conversations, selectedConvId]);

  // Keep activeConv in sync with conversations list or selectedConvId
  useEffect(() => {
    if (!selectedConvId) {
      setActiveConv(null);
      setMessages([]);
      return;
    }
    const found = conversations.find((c) => c.id === selectedConvId);
    if (found) {
      setActiveConv(found);
    }
  }, [selectedConvId, conversations]);

  // Load messages whenever active conversation changes
  const loadMessages = useCallback(
    async (convId: string) => {
      setLoadingMessages(true);
      try {
        const res = await feedApi.listMessages(convId, 1, 100);
        setMessages(res.data?.items || []);
        await feedApi.markConversationRead(convId);
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c))
        );
        void refreshUnreadCount();
        setTimeout(() => scrollToBottom(false), 50);
      } catch (err: any) {
        const status = err?.status ?? err?.response?.status;
        if (status === 403) {
          showToastRef.current("You do not have permission to view this conversation.", "error");
          setSelectedConvId(null);
          setActiveConv(null);
        } else if (status === 404) {
          showToastRef.current("Conversation not found.", "error");
          setSelectedConvId(null);
          setActiveConv(null);
        } else {
          showToastRef.current(errorMessage(err) || "Failed to load messages.", "error");
        }
      } finally {
        setLoadingMessages(false);
      }
    },
    [scrollToBottom, refreshUnreadCount]
  );

  useEffect(() => {
    if (selectedConvId) {
      void loadMessages(selectedConvId);
    }
  }, [selectedConvId, loadMessages]);

  // Soft polling every 12 seconds for active conversation and conversation list
  useEffect(() => {
    const interval = setInterval(() => {
      void loadConversations(false);
      if (selectedConvId) {
        feedApi
          .listMessages(selectedConvId, 1, 100)
          .then((res) => {
            setMessages(res.data?.items || []);
          })
          .catch(() => {});
      }
    }, 12000);
    return () => clearInterval(interval);
  }, [loadConversations, selectedConvId]);

  // Send message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canCreateMessage) return;
    const content = newMessageText.trim();
    if (!content || !selectedConvId || sendingMessage) return;
    if (newMessageText.length > MAX_DIRECT_MESSAGE_LENGTH) {
      showToast(
        `Message content must not exceed ${MAX_DIRECT_MESSAGE_LENGTH.toLocaleString()} characters.`,
        "warning"
      );
      return;
    }

    setSendingMessage(true);
    try {
      const res = await feedApi.sendMessage(selectedConvId, content);
      setMessages((prev) => [...prev, res.data]);
      setNewMessageText("");
      setTimeout(() => scrollToBottom(true), 50);
      void loadConversations(false);
    } catch (err) {
      showToast(errorMessage(err) || "Failed to send message.", "error");
    } finally {
      setSendingMessage(false);
      messageInputRef.current?.focus();
    }
  };

  // Keyboard shortcut: Enter to send, Shift+Enter for newline
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleStartEdit = (msg: DirectMessage) => {
    setEditingMessageId(msg.id);
    setEditingContent(msg.content);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingContent("");
  };

  const handleSaveEdit = async (msgId: string) => {
    const content = editingContent.trim();
    if (!content || savingEdit) return;
    if (editingContent.length > MAX_DIRECT_MESSAGE_LENGTH) {
      showToast(
        `Message content must not exceed ${MAX_DIRECT_MESSAGE_LENGTH.toLocaleString()} characters.`,
        "warning"
      );
      return;
    }

    setSavingEdit(true);
    try {
      const res = await feedApi.updateMessage(msgId, content);
      setMessages((prev) => prev.map((m) => (m.id === msgId ? res.data : m)));
      setEditingMessageId(null);
      setEditingContent("");
      showToast("Message updated.", "success");
      void loadConversations(false);
    } catch (err) {
      showToast(errorMessage(err) || "Failed to update message.", "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    setDeletingMessageId(msgId);
    try {
      await feedApi.deleteMessage(msgId);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      showToast("Message deleted.", "success");
      void loadConversations(false);
    } catch (err) {
      showToast(errorMessage(err) || "Failed to delete message.", "error");
    } finally {
      setDeletingMessageId(null);
    }
  };

  // Load eligible recipients for new chat dialog
  useEffect(() => {
    if (!newModalOpen || !canCreateMessage) return;
    const fetchRecipients = async () => {
      setLoadingRecipients(true);
      try {
        const res = await feedApi.getEligibleRecipients(recipientQuery || undefined, 40);
        const rows = (res.data || []).filter((emp) => emp.id !== currentUserId);
        setEligibleRecipients(rows);
      } catch {
        setEligibleRecipients([]);
      } finally {
        setLoadingRecipients(false);
      }
    };

    const timer = setTimeout(fetchRecipients, recipientQuery ? 250 : 0);
    return () => clearTimeout(timer);
  }, [newModalOpen, recipientQuery, canCreateMessage, currentUserId]);

  // Start conversation with selected colleague
  const handleSelectRecipient = async (recipient: EligibleRecipient) => {
    setStartingConv(true);
    try {
      const res = await feedApi.startConversation(recipient.id);
      const conv = res.data;
      setNewModalOpen(false);
      setRecipientQuery("");
      await loadConversations(false);
      selectConversation(conv.id);
      setActiveConv(conv);
    } catch (err) {
      showToast(errorMessage(err) || "Could not start conversation.", "error");
    } finally {
      setStartingConv(false);
    }
  };

  const formatTime = (isoString?: string | null) => {
    if (!isoString) return "";
    try {
      const date = new Date(isoString);
      const now = new Date();
      const isToday =
        date.getDate() === now.getDate() &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();

      if (isToday) {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  };

  const getOtherName = (conv?: Conversation | null) =>
    conv?.other_participant?.display_name ||
    conv?.other_participant?.full_name ||
    "Colleague";

  const getPreviewText = (conv: Conversation) =>
    conv.last_message?.content ?? conv.last_message_preview ?? null;

  const getPreviewSenderId = (conv: Conversation) =>
    conv.last_message?.sender_id ?? conv.last_message_sender_id ?? null;

  const getPreviewTime = (conv: Conversation) =>
    conv.last_message?.created_at || conv.last_message_at || conv.updated_at;

  const filteredConversations = conversations.filter((c) => {
    if (!conversationFilter.trim()) return true;
    const q = conversationFilter.toLowerCase();
    const otherName = getOtherName(c).toLowerCase();
    const otherDept = c.other_participant?.department_name?.toLowerCase() || "";
    const lastMsg = (getPreviewText(c) || "").toLowerCase();
    return otherName.includes(q) || otherDept.includes(q) || lastMsg.includes(q);
  });

  return (
    <div className="feed-dm-container" data-testid="feed-dm-container">
      {/* Sidebar: Conversations List */}
      <div className="feed-dm-sidebar">
        <div className="feed-dm-sidebar-header">
          <div className="feed-dm-sidebar-title-row">
            <h2 className="feed-dm-sidebar-title">Direct Messages</h2>
            {canCreateMessage && (
              <button
                type="button"
                className="feed-dm-new-btn"
                onClick={() => setNewModalOpen(true)}
                title="Start a new message"
                data-testid="start-dm-btn"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                <span>New</span>
              </button>
            )}
          </div>

          <div className="feed-dm-search-wrap">
            <input
              type="text"
              className="feed-dm-search-input"
              placeholder="Search conversations..."
              value={conversationFilter}
              onChange={(e) => setConversationFilter(e.target.value)}
              data-testid="dm-conversations-search"
            />
          </div>
        </div>

        {/* Conversation list items */}
        <div className="feed-dm-conv-list" data-testid="dm-conversations-list">
          {loadingConversations ? (
            <div className="feed-dm-loading">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="feed-dm-item-skeleton">
                  <div className="feed-skeleton-line" style={{ width: "36px", height: "36px", borderRadius: "50%" }} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div className="feed-skeleton-line" style={{ height: "12px", width: "65%" }} />
                    <div className="feed-skeleton-line" style={{ height: "10px", width: "85%" }} />
                  </div>
                </div>
              ))}
            </div>
          ) : conversationsError ? (
            <div className="feed-dm-empty-sidebar" data-testid="dm-error-state">
              <p style={{ color: "#991b1b" }}>{conversationsError}</p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void loadConversations(true)}
                style={{ fontSize: "12px", marginTop: "8px" }}
              >
                Retry
              </button>
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="feed-dm-empty-sidebar">
              <p>
                {conversationFilter
                  ? "No conversations match your search."
                  : "No conversations yet."}
              </p>
              {canCreateMessage && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setNewModalOpen(true)}
                  style={{ fontSize: "12px", marginTop: "8px" }}
                >
                  + Start Conversation
                </button>
              )}
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = conv.id === selectedConvId;
              const other = conv.other_participant;
              const otherName = getOtherName(conv);
              const initial = otherName.charAt(0).toUpperCase();
              const hasUnread = (conv.unread_count || 0) > 0;
              const previewText = getPreviewText(conv);
              const previewSenderId = getPreviewSenderId(conv);

              return (
                <div
                  key={conv.id}
                  className={`feed-dm-item ${isSelected ? "active" : ""} ${hasUnread ? "unread" : ""}`}
                  onClick={() => selectConversation(conv.id)}
                  data-testid={`dm-conv-${conv.id}`}
                >
                  <div className="feed-dm-avatar">{initial}</div>
                  <div className="feed-dm-item-body">
                    <div className="feed-dm-item-top">
                      <span className="feed-dm-item-name">{otherName}</span>
                      <span className="feed-dm-item-time">
                        {formatTime(getPreviewTime(conv))}
                      </span>
                    </div>
                    <div className="feed-dm-item-preview-row">
                      <span className="feed-dm-item-preview">
                        {previewText ? (
                          <>
                            {previewSenderId && previewSenderId === currentUserId ? (
                              <span style={{ color: "#64748b" }}>You: </span>
                            ) : null}
                            {previewText}
                          </>
                        ) : (
                          <span style={{ fontStyle: "italic", color: "#94a3b8" }}>No messages yet</span>
                        )}
                      </span>
                      {hasUnread && (
                        <span className="feed-dm-unread-badge" data-testid="dm-unread-badge">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                    {other?.department_name && (
                      <span className="feed-dm-dept-badge">{other.department_name}</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="feed-dm-chat">
        {selectedConvId && activeConv ? (
          <>
            {/* Chat Header */}
            <div className="feed-dm-chat-header" data-testid="dm-chat-header">
              <div className="feed-dm-chat-header-user">
                <div className="feed-dm-avatar">
                  {getOtherName(activeConv).charAt(0).toUpperCase()}
                </div>
                <div className="feed-dm-chat-header-info">
                  <div className="feed-dm-chat-header-name">
                    {getOtherName(activeConv)}
                  </div>
                  <div className="feed-dm-chat-header-sub">
                    {activeConv.other_participant?.department_name ? (
                      <span className="feed-dm-dept-badge">
                        {activeConv.other_participant.department_name}
                      </span>
                    ) : (
                      <span>Employee</span>
                    )}
                    <span className="feed-dm-privacy-tag" data-testid="dm-privacy-tag">
                      🔒 Participants Only
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Messages Thread */}
            <div className="feed-dm-messages-container" data-testid="dm-messages-thread">
              {loadingMessages ? (
                <div className="feed-dm-loading-messages">
                  <div className="feed-skeleton-line" style={{ height: "36px", width: "45%", alignSelf: "flex-start", borderRadius: "12px" }} />
                  <div className="feed-skeleton-line" style={{ height: "48px", width: "55%", alignSelf: "flex-end", borderRadius: "12px" }} />
                  <div className="feed-skeleton-line" style={{ height: "32px", width: "40%", alignSelf: "flex-start", borderRadius: "12px" }} />
                </div>
              ) : messages.length === 0 ? (
                <div className="feed-dm-empty-messages">
                  <div className="feed-dm-lock-icon">🔒</div>
                  <h4>Direct ERP Conversation</h4>
                  <p>
                    Messages in this conversation are visible only to you and{" "}
                    <strong>{getOtherName(activeConv)}</strong>.
                  </p>
                  <p style={{ fontSize: "12px", color: "#94a3b8" }}>
                    Say hello to start the conversation!
                  </p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isOwn = msg.is_sender || msg.sender_id === currentUserId;
                  const isEditingThis = editingMessageId === msg.id;

                  return (
                    <div
                      key={msg.id}
                      className={`feed-dm-message-row ${isOwn ? "own" : "incoming"}`}
                      data-testid={`dm-msg-${msg.id}`}
                    >
                      <div className="feed-dm-bubble-wrap">
                        <div className={`feed-dm-bubble ${isOwn ? "own-bubble" : "incoming-bubble"}`}>
                          {isEditingThis ? (
                            <div className="feed-dm-inline-edit">
                              <textarea
                                className="feed-dm-edit-textarea"
                                value={editingContent}
                                onChange={(e) => setEditingContent(e.target.value)}
                                autoFocus
                              />
                              <div className="feed-dm-inline-edit-actions">
                                <button
                                  type="button"
                                  className="btn btn-sm btn-secondary"
                                  onClick={handleCancelEdit}
                                  disabled={savingEdit}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  onClick={() => void handleSaveEdit(msg.id)}
                                  disabled={savingEdit || !editingContent.trim()}
                                >
                                  {savingEdit ? "Saving..." : "Save"}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="feed-dm-bubble-text">{msg.content}</div>
                              <div className="feed-dm-bubble-meta">
                                <span>{formatTime(msg.created_at)}</span>
                                {msg.is_edited && <span className="feed-dm-edited-tag">(edited)</span>}
                              </div>
                            </>
                          )}
                        </div>

                        {isOwn && !isEditingThis && canCreateMessage && (
                          <div className="feed-dm-msg-actions">
                            <button
                              type="button"
                              className="feed-dm-action-btn"
                              title="Edit message"
                              onClick={() => handleStartEdit(msg)}
                              data-testid={`edit-msg-${msg.id}`}
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              className="feed-dm-action-btn delete"
                              title="Delete message"
                              onClick={() => void handleDeleteMessage(msg.id)}
                              disabled={deletingMessageId === msg.id}
                              data-testid={`delete-msg-${msg.id}`}
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Composer Footer */}
            {canCreateMessage && (
              <form onSubmit={handleSendMessage} className="feed-dm-chat-footer">
                <textarea
                  ref={messageInputRef}
                  className="feed-dm-input"
                  placeholder={`Write a private message to ${getOtherName(activeConv)}... (Enter to send, Shift+Enter for newline)`}
                  value={newMessageText}
                  onChange={(e) => setNewMessageText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={2}
                  data-testid="dm-message-input"
                />
                <button
                  type="submit"
                  className="feed-dm-send-btn"
                  disabled={!newMessageText.trim() || sendingMessage}
                  data-testid="dm-send-btn"
                >
                  {sendingMessage ? (
                    <span>...</span>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                  )}
                </button>
              </form>
            )}
          </>
        ) : (
          <div className="feed-dm-no-selection" data-testid="dm-no-conv-selected">
            <div className="feed-dm-empty-chat-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
            </div>
            <h3>Your Messages</h3>
            <p>Select an existing conversation from the list or start a new direct conversation with an active colleague.</p>
            {canCreateMessage && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setNewModalOpen(true)}
                style={{ background: "#0061f2", color: "#ffffff", marginTop: "12px" }}
                data-testid="empty-start-dm-btn"
              >
                + Start New Conversation
              </button>
            )}
          </div>
        )}
      </div>

      {/* Start New Conversation Modal */}
      <Modal
        open={newModalOpen && canCreateMessage}
        title="Start Direct Message"
        onClose={() => {
          setNewModalOpen(false);
          setRecipientQuery("");
        }}
        variant="center"
        cardStyle={{ maxWidth: "520px" }}
      >
        <div className="feed-dm-recipient-modal" data-testid="new-dm-modal">
          <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 12px 0" }}>
            Search for an active ERP colleague to open a 1-to-1 conversation.
          </p>

          <input
            type="text"
            className="feed-recipient-search-input"
            placeholder="Type colleague name, code, or department..."
            value={recipientQuery}
            onChange={(e) => setRecipientQuery(e.target.value)}
            autoFocus
            data-testid="dm-recipient-search-input"
          />

          <div className="feed-dm-recipient-results">
            {loadingRecipients ? (
              <div style={{ padding: "16px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
                Searching colleagues...
              </div>
            ) : eligibleRecipients.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
                {recipientQuery ? "No colleagues found matching your query." : "Type above to search colleagues."}
              </div>
            ) : (
              eligibleRecipients.map((emp) => (
                <div
                  key={emp.id}
                  className="feed-dm-recipient-item"
                  onClick={() => void handleSelectRecipient(emp)}
                  data-testid={`dm-recipient-${emp.id}`}
                >
                  <div className="feed-dm-avatar small">
                    {(emp.display_name || emp.full_name || "E").charAt(0).toUpperCase()}
                  </div>
                  <div className="feed-dm-recipient-meta">
                    <div className="feed-dm-recipient-name">
                      {emp.display_name || emp.full_name}
                      {emp.employee_code && (
                        <span className="feed-item-code">{emp.employee_code}</span>
                      )}
                    </div>
                    <div className="feed-dm-recipient-dept">
                      {emp.department_name ? (
                        <span className="feed-item-dept-tag">{emp.department_name}</span>
                      ) : (
                        <span>{emp.email}</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={startingConv}
                  >
                    Chat
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
export default FeedDirectMessages;
