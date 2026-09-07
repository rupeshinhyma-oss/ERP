import React, { useState, useRef, useEffect, useMemo } from "react";
import type { AvailableUser } from "@/types/tasks";

export interface SearchableUserSelectProps {
  users: AvailableUser[];
  selectedUserIds: string[];
  onChange: (userIds: string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  disabled?: boolean;
  autoCloseOnSelect?: boolean;
  className?: string;
  showChips?: boolean;
}

function getUserInitials(name?: string | null): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function getUserColor(name?: string | null): string {
  if (!name) return "#64748b";
  const colors = [
    "#3b82f6", // Blue
    "#10b981", // Emerald
    "#8b5cf6", // Purple
    "#f59e0b", // Amber
    "#ec4899", // Pink
    "#06b6d4", // Cyan
    "#6366f1", // Indigo
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getUserDepartment(user: AvailableUser): string {
  if (user.department) return user.department;
  if (user.roles && user.roles.length > 0) {
    const valid = user.roles.filter((r) => r !== "user" && r !== "super_admin");
    if (valid.length > 0) return valid[0];
    if (user.roles.includes("super_admin")) return "Admin";
  }
  return "Staff";
}

export const SearchableUserSelect: React.FC<SearchableUserSelectProps> = ({
  users,
  selectedUserIds,
  onChange,
  multiple = true,
  placeholder = "Search users...",
  disabled = false,
  autoCloseOnSelect = true,
  className = "",
  showChips = true,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Selected user objects
  const selectedUsers = useMemo(() => {
    return selectedUserIds
      .map((id) => users.find((u) => u.id === id))
      .filter((u): u is AvailableUser => Boolean(u));
  }, [selectedUserIds, users]);

  // Filtered candidate users for dropdown
  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const candidates = multiple
      ? users.filter((u) => !selectedUserIds.includes(u.id))
      : users;

    if (!term) return candidates;

    return candidates.filter((u) => {
      const name = (u.full_name || "").toLowerCase();
      const uname = (u.username || "").toLowerCase();
      const email = (u.email || "").toLowerCase();
      const dept = getUserDepartment(u).toLowerCase();
      return (
        name.includes(term) ||
        uname.includes(term) ||
        email.includes(term) ||
        dept.includes(term)
      );
    });
  }, [users, selectedUserIds, searchTerm, multiple]);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearchTerm("");
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleSelectUser = (user: AvailableUser) => {
    if (multiple) {
      if (!selectedUserIds.includes(user.id)) {
        onChange([...selectedUserIds, user.id]);
      }
    } else {
      onChange([user.id]);
    }

    setSearchTerm("");
    setHighlightedIndex(-1);
    if (autoCloseOnSelect) {
      setIsOpen(false);
    }
  };

  const handleRemoveUser = (userId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    onChange(selectedUserIds.filter((id) => id !== userId));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        setIsOpen(true);
        setHighlightedIndex(0);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < filteredUsers.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredUsers.length - 1
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < filteredUsers.length) {
        handleSelectUser(filteredUsers[highlightedIndex]);
      } else if (filteredUsers.length > 0) {
        handleSelectUser(filteredUsers[0]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      setSearchTerm("");
      setHighlightedIndex(-1);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`searchable-user-select-container ${className}`}
      style={{ position: "relative", width: "100%" }}
    >
      {/* Selected Users Chips (when showChips is true) */}
      {showChips && selectedUsers.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
            marginBottom: "8px",
          }}
        >
          {selectedUsers.map((user) => {
            const color = getUserColor(user.full_name || user.username);
            const dept = getUserDepartment(user);
            return (
              <span
                key={user.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: "16px",
                  padding: "3px 8px 3px 6px",
                  fontSize: "12px",
                  color: "#1e40af",
                  fontWeight: 500,
                  userSelect: "none",
                }}
              >
                <span
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    background: color,
                    color: "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "10px",
                    fontWeight: 700,
                  }}
                >
                  {getUserInitials(user.full_name || user.username)}
                </span>
                <span>{user.full_name || user.username}</span>
                <span style={{ fontSize: "11px", color: "#64748b" }}>
                  ({dept})
                </span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={(e) => handleRemoveUser(user.id, e)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#3b82f6",
                      cursor: "pointer",
                      fontWeight: "bold",
                      fontSize: "12px",
                      lineHeight: 1,
                      padding: "0 2px",
                    }}
                    title={`Remove ${user.full_name || user.username}`}
                  >
                    ✕
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Input box */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          border: isOpen ? "1px solid #3b82f6" : "1px solid #cbd5e1",
          borderRadius: "6px",
          padding: "6px 10px",
          background: disabled ? "#f1f5f9" : "#ffffff",
          boxShadow: isOpen ? "0 0 0 2px rgba(59,130,246,0.15)" : "none",
          transition: "border-color 0.15s, box-shadow 0.15s",
          cursor: disabled ? "not-allowed" : "text",
        }}
        onClick={() => {
          if (!disabled) {
            setIsOpen(true);
            inputRef.current?.focus();
          }
        }}
      >
        <span style={{ color: "#94a3b8", marginRight: "6px", fontSize: "13px" }}>
          🔍
        </span>
        <input
          ref={inputRef}
          type="text"
          value={searchTerm}
          placeholder={selectedUsers.length > 0 && !multiple ? `${selectedUsers[0].full_name || selectedUsers[0].username} (click to change)` : placeholder}
          disabled={disabled}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            if (!isOpen) setIsOpen(true);
            setHighlightedIndex(0);
          }}
          onFocus={() => {
            if (!disabled) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            width: "100%",
            fontSize: "13px",
            color: "#0f172a",
          }}
        />
        {searchTerm && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSearchTerm("");
              inputRef.current?.focus();
            }}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: "12px",
              padding: "0 4px",
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Dropdown Popover */}
      {isOpen && !disabled && (
        <div
          ref={listRef}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: "6px",
            boxShadow: "0 10px 25px rgba(0,0,0,0.12)",
            maxHeight: "220px",
            overflowY: "auto",
            zIndex: 99999,
          }}
        >
          {filteredUsers.length === 0 ? (
            <div
              style={{
                padding: "10px 14px",
                fontSize: "13px",
                color: "#64748b",
                textAlign: "center",
              }}
            >
              No team members match "{searchTerm}"
            </div>
          ) : (
            filteredUsers.map((u, idx) => {
              const isHighlighted = idx === highlightedIndex;
              const isSelected = selectedUserIds.includes(u.id);
              const color = getUserColor(u.full_name || u.username);
              const dept = getUserDepartment(u);

              return (
                <div
                  key={u.id}
                  style={{
                    padding: "8px 12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: isHighlighted
                      ? "#f1f5f9"
                      : isSelected
                      ? "#eff6ff"
                      : "#ffffff",
                    cursor: "pointer",
                    borderBottom:
                      idx < filteredUsers.length - 1
                        ? "1px solid #f8fafc"
                        : "none",
                    transition: "background-color 0.1s ease",
                  }}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  onMouseDown={(e) => {
                    // onMouseDown fires before blur, ensuring click registers
                    e.preventDefault();
                    handleSelectUser(u);
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        width: "28px",
                        height: "28px",
                        borderRadius: "50%",
                        background: color,
                        color: "#ffffff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "11px",
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {getUserInitials(u.full_name || u.username)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          color: "#1e293b",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {u.full_name || u.username}{" "}
                        <span
                          style={{
                            fontSize: "11.5px",
                            fontWeight: 500,
                            color: "#64748b",
                          }}
                        >
                          ({dept})
                        </span>
                      </div>
                      {u.email && (
                        <div
                          style={{
                            fontSize: "11px",
                            color: "#94a3b8",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {u.email}
                        </div>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <span
                      style={{
                        color: "#2563eb",
                        fontWeight: 700,
                        fontSize: "13px",
                      }}
                    >
                      ✓
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
