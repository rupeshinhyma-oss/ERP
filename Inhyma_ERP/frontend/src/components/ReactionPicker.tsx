import React, { useState, useRef, useEffect } from "react";
import type { TaskReactionSummary } from "@/types/tasks";

interface ReactionPickerProps {
  reactions?: TaskReactionSummary[];
  onToggleReaction: (emoji: string) => Promise<void> | void;
  size?: "sm" | "md";
  className?: string;
}

const COMMON_EMOJIS = ["👍", "❤️", "👀", "🚀", "🎉", "🔥", "👏", "✅"];

export const ReactionPicker: React.FC<ReactionPickerProps> = ({
  reactions = [],
  onToggleReaction,
  size = "md",
  className = "",
}) => {
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setShowPicker(false);
      }
    }
    if (showPicker) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showPicker]);

  const handleSelectEmoji = async (emoji: string) => {
    setShowPicker(false);
    await onToggleReaction(emoji);
  };

  const isSmall = size === "sm";

  return (
    <div className={`task-reaction-container ${className}`} ref={pickerRef}>
      {/* Existing Reactions */}
      {reactions.map((r) => {
        const isReacted = Boolean(r.has_reacted || r.user_reacted);
        return (
          <button
            key={r.emoji}
            type="button"
            onClick={() => onToggleReaction(r.emoji)}
            className={`task-reaction-chip ${isReacted ? "reacted" : ""}`}
            style={{
              padding: isSmall ? "1.5px 6px" : "2.5px 8.5px",
              fontSize: isSmall ? "11px" : "12px",
            }}
            title={`${r.count} reaction${r.count > 1 ? "s" : ""}`}
          >
            <span>{r.emoji}</span>
            <span style={{ fontSize: isSmall ? "10px" : "11px", opacity: 0.85 }}>{r.count}</span>
          </button>
        );
      })}

      {/* Add Reaction Button */}
      <button
        type="button"
        onClick={() => setShowPicker(!showPicker)}
        className="task-reaction-add-btn"
        style={{
          padding: isSmall ? "1.5px 6px" : "2.5px 8.5px",
          fontSize: isSmall ? "11px" : "12px",
        }}
        title="Add reaction"
      >
        <span style={{ fontSize: isSmall ? "12px" : "13px", lineHeight: 1, fontWeight: 700 }}>+</span>
        <span style={{ fontSize: isSmall ? "11px" : "12px", marginLeft: "2px" }}>😀</span>
      </button>

      {/* Popover */}
      {showPicker && (
        <div className="task-reaction-popover">
          {COMMON_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleSelectEmoji(emoji)}
              className="task-reaction-emoji-btn"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
