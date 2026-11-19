import { useState, useEffect, useRef, useMemo } from "react";
import { feedApi } from "@/lib/feedApi";
import { useToast } from "@/lib/toast";
import { errorMessage } from "@/lib/api";
import {
  MAX_FEED_POST_CONTENT_LENGTH,
  type EligibleDepartment,
  type FeedPostStatus,
} from "@/types/feed";

type ComposerAudienceMode = "ALL" | "DEPARTMENTS";

interface FeedComposerProps {
  currentUserName?: string;
  onPostCreated: () => void;
  onCancel?: () => void;
}

export function FeedComposer({
  currentUserName = "Me",
  onPostCreated,
  onCancel,
}: FeedComposerProps) {
  const showToast = useToast();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [audienceMode, setAudienceMode] = useState<ComposerAudienceMode>("ALL");

  // Department targeting state (real ERP departments)
  const [departmentsList, setDepartmentsList] = useState<EligibleDepartment[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<EligibleDepartment[]>([]);
  const [deptSearchQuery, setDeptSearchQuery] = useState("");
  const [deptDropdownOpen, setDeptDropdownOpen] = useState(false);
  const deptContainerRef = useRef<HTMLDivElement>(null);

  // Submission state
  const [submitting, setSubmitting] = useState(false);

  // Fetch real ERP departments on mount
  useEffect(() => {
    let active = true;
    feedApi
      .getEligibleDepartments()
      .then((res) => {
        if (active && res.data) {
          setDepartmentsList(res.data);
        }
      })
      .catch(() => {
        /* Retry gracefully */
      });

    return () => {
      active = false;
    };
  }, []);

  // Click outside listener for department dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        deptContainerRef.current &&
        !deptContainerRef.current.contains(e.target as Node)
      ) {
        setDeptDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Department handling
  const handleAddDepartment = (dept: EligibleDepartment) => {
    if (!selectedDepartments.some((d) => d.id === dept.id)) {
      setSelectedDepartments((prev) => [...prev, dept]);
    }
    setDeptSearchQuery("");
    setDeptDropdownOpen(false);
  };

  const handleRemoveDepartment = (deptId: string) => {
    setSelectedDepartments((prev) => prev.filter((d) => d.id !== deptId));
  };

  // Estimated reach calculation based on real backend member counts
  const estimatedReach = useMemo(() => {
    if (audienceMode === "ALL") return "All company employees";

    if (selectedDepartments.length > 0) {
      const deptMemberSum = selectedDepartments.reduce((acc, d) => acc + (d.member_count || 0), 0);
      return `${deptMemberSum} employee(s) across ${selectedDepartments.length} department(s)`;
    }
    return "0 departments selected";
  }, [audienceMode, selectedDepartments]);

  const filteredDepartments = useMemo(() => {
    if (!deptSearchQuery.trim()) return departmentsList;
    const term = deptSearchQuery.toLowerCase().trim();
    return departmentsList.filter(
      (d) =>
        d.name.toLowerCase().includes(term) ||
        (d.code && d.code.toLowerCase().includes(term))
    );
  }, [departmentsList, deptSearchQuery]);

  const handleSubmit = async (targetStatus: FeedPostStatus) => {
    if (!content.trim()) {
      showToast("Message content is required.", "warning");
      return;
    }

    if (content.length > MAX_FEED_POST_CONTENT_LENGTH) {
      showToast(
        `Message content must not exceed ${MAX_FEED_POST_CONTENT_LENGTH.toLocaleString()} characters.`,
        "warning"
      );
      return;
    }

    if (audienceMode === "DEPARTMENTS" && selectedDepartments.length === 0) {
      showToast("Please select at least one department for a targeted post.", "warning");
      return;
    }

    setSubmitting(true);
    try {
      const isAll = audienceMode === "ALL";
      await feedApi.createPost({
        title: title.trim() || undefined,
        content: content.trim(),
        audience_type: isAll ? "ALL" : "SELECTED",
        status: targetStatus,
        department_ids: !isAll ? selectedDepartments.map((d) => d.id) : undefined,
      });

      showToast(
        targetStatus === "DRAFT"
          ? "Draft announcement saved successfully."
          : "Announcement broadcast published successfully!",
        "success"
      );

      // Reset form
      setTitle("");
      setContent("");
      setAudienceMode("ALL");
      setSelectedDepartments([]);
      setDeptSearchQuery("");
      onPostCreated();
    } catch (err) {
      showToast(errorMessage(err) || "Failed to publish announcement.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const authorInitials =
    currentUserName
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "ME";

  return (
    <div className="feed-composer-card" data-testid="feed-composer">
      {/* Composer Top: Author and Hint */}
      <div className="feed-composer-top-bar">
        <div className="feed-composer-author-meta">
          <div className="feed-composer-avatar" title={currentUserName}>
            {authorInitials}
          </div>
          <div className="feed-composer-header-text">
            <span className="feed-composer-user-name">{currentUserName}</span>
            <span className="feed-composer-subtitle">Broadcast announcement to Inhyma workforce</span>
          </div>
        </div>
      </div>

      {/* Main Message Writing Area (Primary Focus) */}
      <div className="feed-composer-input-container">
        {/* Optional Secondary Subject/Title */}
        <input
          type="text"
          className="feed-composer-title-input"
          placeholder="Subject or title (optional)..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={submitting}
          maxLength={255}
          data-testid="feed-composer-title"
        />

        {/* Message Content Textarea */}
        <textarea
          className="feed-composer-textarea"
          placeholder="What would you like to broadcast to your team? Write your message here..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={submitting}
          rows={3}
          data-testid="feed-composer-content"
        />
      </div>

      {/* Compact Audience Selector (Segmented Pills) */}
      <div className="feed-audience-section">
        <div className="feed-audience-compact-bar">
          <span className="feed-audience-label">Audience:</span>
          <div className="feed-audience-options">
            <button
              type="button"
              className={`feed-audience-option-btn ${audienceMode === "ALL" ? "active" : ""}`}
              onClick={() => {
                setAudienceMode("ALL");
                setSelectedDepartments([]);
              }}
              disabled={submitting}
              data-testid="audience-all-btn"
            >
              <span>🌐</span>
              <span>Everyone in Inhyma ERP</span>
            </button>

            <button
              type="button"
              className={`feed-audience-option-btn ${audienceMode === "DEPARTMENTS" ? "active" : ""}`}
              onClick={() => setAudienceMode("DEPARTMENTS")}
              disabled={submitting}
              data-testid="audience-dept-btn"
            >
              <span>🏢</span>
              <span>Departments</span>
            </button>
          </div>
        </div>

        {/* Conditional Audience Controls */}

        {/* 1. Everyone Mode: Simple Inline Confirmation */}
        {audienceMode === "ALL" && (
          <div className="feed-audience-confirm-notice" data-testid="audience-confirm-notice">
            <span style={{ fontSize: "14px" }}>📢</span>
            <span>Broadcast mode: Announcement will be delivered to <strong>Everyone in Inhyma ERP</strong>.</span>
          </div>
        )}

        {/* 2. Departments Picker */}
        {audienceMode === "DEPARTMENTS" && (
          <div className="feed-recipient-picker" ref={deptContainerRef} data-testid="department-picker-section">
            <div className="feed-picker-header">
              <span className="feed-picker-title">Target Departments:</span>
              {selectedDepartments.length > 0 && (
                <span className="feed-picker-count">
                  {selectedDepartments.length} department{selectedDepartments.length === 1 ? "" : "s"} selected
                </span>
              )}
            </div>

            <div className="feed-recipient-search-wrap">
              <input
                type="text"
                className="feed-recipient-search-input"
                placeholder="Search ERP departments (e.g. Sales, HR, IT)..."
                value={deptSearchQuery}
                onChange={(e) => setDeptSearchQuery(e.target.value)}
                onFocus={() => setDeptDropdownOpen(true)}
                disabled={submitting}
                data-testid="dept-search-input"
              />

              {deptDropdownOpen && (
                <div className="feed-recipient-dropdown" data-testid="dept-dropdown">
                  {filteredDepartments.length === 0 ? (
                    <div className="feed-dropdown-empty">
                      No matching departments found in ERP database.
                    </div>
                  ) : (
                    filteredDepartments.map((dept) => {
                      const isAlreadySelected = selectedDepartments.some((d) => d.id === dept.id);
                      return (
                        <div
                          key={dept.id}
                          className={`feed-recipient-item ${isAlreadySelected ? "feed-recipient-item-selected" : ""}`}
                          onClick={() => {
                            if (!isAlreadySelected) handleAddDepartment(dept);
                          }}
                          data-testid={`dept-item-${dept.id}`}
                        >
                          <div className="feed-item-info">
                            <span className="feed-item-name">{dept.name}</span>
                            {dept.code && (
                              <span className="feed-item-code">({dept.code})</span>
                            )}
                            <span className="feed-item-dept-tag">
                              {dept.member_count} member{dept.member_count === 1 ? "" : "s"}
                            </span>
                          </div>
                          <span className="feed-item-action">
                            {isAlreadySelected ? "Added" : "+ Add"}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Department Chips */}
            {selectedDepartments.length > 0 && (
              <div className="feed-recipient-chips-container" data-testid="dept-chips-container">
                {selectedDepartments.map((dept) => (
                  <div key={dept.id} className="feed-dept-chip" data-testid={`dept-chip-${dept.id}`}>
                    <span>🏢 {dept.name}</span>
                    <span className="feed-chip-count">({dept.member_count} members)</span>
                    <button
                      type="button"
                      className="feed-dept-chip-remove"
                      onClick={() => handleRemoveDepartment(dept.id)}
                      disabled={submitting}
                      title={`Remove ${dept.name}`}
                      aria-label={`Remove ${dept.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 3. Streamlined Audience Summary Strip */}
        <div className="feed-audience-summary-card" data-testid="audience-summary-card">
          <div className="feed-summary-row">
            <span className="feed-summary-label">Target Audience:</span>
            <span className="feed-summary-total" data-testid="estimated-reach-text">
              {estimatedReach}
            </span>
          </div>
          {audienceMode === "DEPARTMENTS" && (
            <div className="feed-summary-subnote">
              🔒 Visible only to current members of targeted departments and the author.
            </div>
          )}
        </div>
      </div>

      {/* Composer Action Buttons */}
      <div className="feed-composer-actions">
        {onCancel && (
          <button
            type="button"
            className="feed-btn-ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          className="feed-btn-secondary"
          onClick={() => handleSubmit("DRAFT")}
          disabled={submitting}
          data-testid="save-draft-btn"
        >
          {submitting ? "Saving..." : "Save Draft"}
        </button>
        <button
          type="button"
          className="feed-btn-primary"
          onClick={() => handleSubmit("PUBLISHED")}
          disabled={submitting}
          data-testid="publish-btn"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
          <span>{submitting ? "Publishing..." : "Publish Announcement"}</span>
        </button>
      </div>
    </div>
  );
}
