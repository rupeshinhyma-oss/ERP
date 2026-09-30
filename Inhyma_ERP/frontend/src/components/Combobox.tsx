import React, { useState, useRef, useEffect, useMemo } from "react";

export interface ComboboxProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
  required?: boolean;
}

export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder = "Select or type...",
  ariaLabel,
  disabled = false,
  style,
  inputStyle,
  required,
}: ComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isTyping, setIsTyping] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const prevValueRef = useRef(value);

  // Clean options to eliminate any dummy 'Select' placeholders from the dropdown menu
  const cleanOptions = useMemo(() => {
    return options.filter(
      (opt) => opt && opt.trim() && opt !== "Select" && opt !== "-- Select Charge --"
    );
  }, [options]);

  // Sync internal query when value changes externally or when disabled
  useEffect(() => {
    if (disabled) {
      setIsTyping(false);
      setIsOpen(false);
      setQuery(value === "Select" ? "" : (value || ""));
      prevValueRef.current = value;
      return;
    }
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      setIsTyping(false);
      setQuery(value === "Select" ? "" : (value || ""));
    } else if (!isTyping) {
      setQuery(value === "Select" ? "" : (value || ""));
    }
  }, [value, isTyping, disabled]);

  // Filter options based on typed query when actively typing; show all clean options when browsing
  const filteredOptions = useMemo(() => {
    if (!isTyping || !query.trim() || query === "Select") {
      return cleanOptions;
    }
    const q = query.toLowerCase().trim();
    const matched = cleanOptions.filter((opt) => opt.toLowerCase().includes(q));
    // If no exact match and query is not empty, include typed query as custom option at top
    if (!matched.some((opt) => opt.toLowerCase() === q)) {
      return [query, ...matched];
    }
    return matched;
  }, [cleanOptions, query, isTyping]);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsTyping(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (opt: string) => {
    onChange(opt);
    setQuery(opt);
    setIsTyping(false);
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    onChange(val);
    setIsTyping(true);
    setIsOpen(true);
    setHighlightedIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(0);
      } else {
        setHighlightedIndex((prev) =>
          prev < filteredOptions.length - 1 ? prev + 1 : 0
        );
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (isOpen) {
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredOptions.length - 1
        );
      }
    } else if (e.key === "Enter") {
      if (isOpen && highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        e.preventDefault();
        handleSelect(filteredOptions[highlightedIndex]);
      } else {
        setIsOpen(false);
        setIsTyping(false);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setIsTyping(false);
    }
  };

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", ...style }}
    >
      <input
        id={id}
        ref={inputRef}
        type="text"
        required={required}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setIsTyping(false);
            setIsOpen(true);
          }
        }}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        style={{
          width: "100%",
          height: "38px",
          border: isOpen ? "1px solid #0061f2" : "1px solid #cbd5e1",
          borderRadius: "6px",
          padding: "0 32px 0 12px",
          fontSize: "13.5px",
          background: disabled ? "#f8fafc" : "#ffffff",
          color: disabled ? "#94a3b8" : "#1e293b",
          outline: "none",
          boxShadow: isOpen ? "0 0 0 2px rgba(0, 97, 242, 0.15)" : "none",
          cursor: disabled ? "not-allowed" : "text",
          transition: "border-color 0.15s ease, box-shadow 0.15s ease",
          boxSizing: "border-box",
          ...inputStyle,
        }}
      />

      {/* Dropdown toggle button */}
      <button
        type="button"
        id={id ? `${id}-toggle` : undefined}
        aria-label={ariaLabel ? `Toggle ${ariaLabel} options` : "Toggle options"}
        disabled={disabled}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) {
            setIsTyping(false);
            setIsOpen((prev) => !prev);
            if (!isOpen) {
              inputRef.current?.focus();
            }
          }
        }}
        style={{
          position: "absolute",
          right: "1px",
          top: "1px",
          bottom: "1px",
          width: "32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          color: "#64748b",
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Options Dropdown Menu */}
      {isOpen && (
        <div
          data-testid="combobox-options"
          style={{
            position: "absolute",
            top: "calc(100% + 2px)",
            left: 0,
            right: 0,
            zIndex: 1000,
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: "4px",
            boxShadow: "0 4px 14px rgba(0, 0, 0, 0.12)",
            maxHeight: "220px",
            overflowY: "auto",
          }}
        >
          {filteredOptions.length === 0 ? (
            <div
              style={{
                padding: "8px 12px",
                fontSize: "12.5px",
                color: "#94a3b8",
                fontStyle: "italic",
              }}
            >
              No matching options
            </div>
          ) : (
            filteredOptions.map((opt, idx) => {
              const isSelected = opt === value;
              const isHighlighted = idx === highlightedIndex;

              return (
                <div
                  key={`${opt}-${idx}`}
                  onClick={() => handleSelect(opt)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  style={{
                    padding: "8px 12px",
                    fontSize: "13px",
                    cursor: "pointer",
                    color: isSelected ? "#0061f2" : "#1e293b",
                    fontWeight: isSelected ? 600 : 400,
                    background: isSelected
                      ? "#eff6ff"
                      : isHighlighted
                      ? "#f8fafc"
                      : "#ffffff",
                    borderBottom:
                      idx < filteredOptions.length - 1
                        ? "1px solid #f1f5f9"
                        : "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{opt}</span>
                  {isSelected && (
                    <span style={{ color: "#0061f2", fontSize: "12px" }}>✓</span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
