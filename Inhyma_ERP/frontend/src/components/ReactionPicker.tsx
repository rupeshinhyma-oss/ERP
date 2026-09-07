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

  const btnClasses =
    size === "sm"
      ? "px-1.5 py-0.5 text-xs rounded-full"
      : "px-2.5 py-1 text-xs rounded-full";

  return (
    <div className={`relative inline-flex items-center flex-wrap gap-1 ${className}`} ref={pickerRef}>
      {/* Existing Reactions */}
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onToggleReaction(r.emoji)}
          className={`inline-flex items-center gap-1 font-medium transition-colors border ${btnClasses} ${
            (r.has_reacted || r.user_reacted)
              ? "bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-950/50 dark:border-indigo-600 dark:text-indigo-300"
              : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
          }`}
          title={`${r.count} reaction${r.count > 1 ? "s" : ""}`}
        >
          <span>{r.emoji}</span>
          <span className="text-[11px] opacity-80">{r.count}</span>
        </button>
      ))}

      {/* Add Reaction Button */}
      <button
        type="button"
        onClick={() => setShowPicker(!showPicker)}
        className={`inline-flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-700 transition-colors ${btnClasses}`}
        title="Add reaction"
      >
        <span className="text-sm leading-none">+</span>
        <span className="text-[11px] ml-0.5">😀</span>
      </button>

      {/* Popover */}
      {showPicker && (
        <div className="absolute left-0 bottom-full mb-1 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg p-1.5 flex items-center gap-1">
          {COMMON_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleSelectEmoji(emoji)}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-base transition-transform hover:scale-125"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
