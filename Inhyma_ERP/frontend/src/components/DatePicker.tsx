import React, { useState, useRef, useEffect, useMemo } from "react";

export interface DatePickerProps {
  id?: string;
  value: string; // "DD-MM-YYYY"
  onChange: (val: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
}

const MONTH_NAMES = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
];

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function parseDDMMYYYY(val: string): Date | null {
  if (!val || typeof val !== "string") return null;
  const trimmed = val.trim();
  if (trimmed.includes("-")) {
    const parts = trimmed.split("-");
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        // YYYY-MM-DD
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const d = parseInt(parts[2], 10);
        if (!isNaN(y) && !isNaN(m) && !isNaN(d)) return new Date(y, m, d);
      } else {
        // DD-MM-YYYY
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const y = parseInt(parts[2], 10);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return new Date(y, m, d);
      }
    }
  } else if (trimmed.includes("/")) {
    const parts = trimmed.split("/");
    if (parts.length === 3) {
      const d = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const y = parseInt(parts[2], 10);
      if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return new Date(y, m, d);
    }
  }
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDDMMYYYY(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export function DatePicker({
  id,
  value,
  onChange,
  placeholder = "DD-MM-YYYY",
  ariaLabel = "Expected Delivery Date",
  disabled = false,
  style,
  inputStyle,
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const parsedDate = useMemo(() => parseDDMMYYYY(value), [value]);

  const [viewYear, setViewYear] = useState<number>(() => {
    return parsedDate ? parsedDate.getFullYear() : 2026;
  });
  const [viewMonth, setViewMonth] = useState<number>(() => {
    return parsedDate ? parsedDate.getMonth() : 8; // September
  });

  // When value updates from outside, update viewed month/year if open or changed
  useEffect(() => {
    if (parsedDate) {
      setViewYear(parsedDate.getFullYear());
      setViewMonth(parsedDate.getMonth());
    }
  }, [value]);

  // Click outside listener to close popup
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleSelectDay = (day: number, monthOffset: number = 0) => {
    let targetYear = viewYear;
    let targetMonth = viewMonth + monthOffset;
    if (targetMonth < 0) {
      targetMonth = 11;
      targetYear -= 1;
    } else if (targetMonth > 11) {
      targetMonth = 0;
      targetYear += 1;
    }
    const newDate = new Date(targetYear, targetMonth, day);
    onChange(formatDDMMYYYY(newDate));
    setIsOpen(false);
  };

  // Generate calendar grid cells
  const calendarCells = useMemo(() => {
    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sunday
    const daysInCurrentMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const cells: {
      day: number;
      isCurrentMonth: boolean;
      monthOffset: number;
      isSelected: boolean;
    }[] = [];

    // Prev month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      cells.push({
        day: daysInPrevMonth - i,
        isCurrentMonth: false,
        monthOffset: -1,
        isSelected: false,
      });
    }

    // Current month days
    for (let d = 1; d <= daysInCurrentMonth; d++) {
      const isSelected =
        !!parsedDate &&
        parsedDate.getFullYear() === viewYear &&
        parsedDate.getMonth() === viewMonth &&
        parsedDate.getDate() === d;
      cells.push({
        day: d,
        isCurrentMonth: true,
        monthOffset: 0,
        isSelected,
      });
    }

    // Next month padding to fill grid
    const remaining = (7 - (cells.length % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      cells.push({
        day: d,
        isCurrentMonth: false,
        monthOffset: 1,
        isSelected: false,
      });
    }

    return cells;
  }, [viewYear, viewMonth, parsedDate]);

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", ...style }}
    >
      <input
        id={id}
        type="text"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        onChange={(e) => {
          onChange(e.target.value);
          const p = parseDDMMYYYY(e.target.value);
          if (p) {
            setViewYear(p.getFullYear());
            setViewMonth(p.getMonth());
          }
        }}
        style={{
          width: "100%",
          height: "36px",
          border: isOpen ? "1px solid #3b82f6" : "1px solid #cbd5e1",
          borderRadius: "4px",
          padding: "0 10px",
          fontSize: "13px",
          background: "#ffffff",
          color: "#1e293b",
          outline: "none",
          boxShadow: isOpen ? "0 0 0 2px rgba(59, 130, 246, 0.15)" : "none",
          cursor: disabled ? "not-allowed" : "text",
          transition: "border-color 0.15s ease, box-shadow 0.15s ease",
          ...inputStyle,
        }}
      />

      {isOpen && (
        <div
          data-testid="datepicker-dropdown"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 1000,
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: "6px",
            boxShadow: "0 4px 18px rgba(0, 0, 0, 0.14)",
            width: "260px",
            padding: "10px 12px 14px",
            userSelect: "none",
          }}
        >
          {/* Header with Prev, Month Year, Next */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "10px",
              padding: "0 4px",
            }}
          >
            <button
              type="button"
              aria-label="Previous Month"
              onClick={handlePrevMonth}
              style={{
                background: "#f1f5f9",
                border: "1px solid #e2e8f0",
                borderRadius: "50%",
                width: "26px",
                height: "26px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "#475569",
                fontSize: "13px",
                fontWeight: "bold",
                lineHeight: 1,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#e2e8f0")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#f1f5f9")}
            >
              ‹
            </button>

            <span
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "#1e293b",
                letterSpacing: "0.6px",
                textTransform: "uppercase",
              }}
            >
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>

            <button
              type="button"
              aria-label="Next Month"
              onClick={handleNextMonth}
              style={{
                background: "#f1f5f9",
                border: "1px solid #e2e8f0",
                borderRadius: "50%",
                width: "26px",
                height: "26px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "#475569",
                fontSize: "13px",
                fontWeight: "bold",
                lineHeight: 1,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#e2e8f0")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#f1f5f9")}
            >
              ›
            </button>
          </div>

          {/* Weekday headers row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              textAlign: "center",
              marginBottom: "6px",
            }}
          >
            {WEEKDAYS.map((wd) => (
              <span
                key={wd}
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "#64748b",
                  padding: "2px 0",
                }}
              >
                {wd}
              </span>
            ))}
          </div>

          {/* Scrollable / Fixed Height Calendar grid matching screenshot */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: "2px",
              maxHeight: "190px",
              overflowY: "auto",
              paddingRight: "2px",
            }}
          >
            {calendarCells.map((cell, idx) => {
              const { day, isCurrentMonth, monthOffset, isSelected } = cell;

              let bg = "transparent";
              let textColor = isCurrentMonth ? "#334155" : "#cbd5e1";
              let fontWeight = 400;

              if (isSelected) {
                bg = "#0061f2";
                textColor = "#ffffff";
                fontWeight = 700;
              }

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectDay(day, monthOffset)}
                  style={{
                    background: bg,
                    color: textColor,
                    fontWeight,
                    border: "none",
                    borderRadius: "4px",
                    height: "28px",
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    cursor: "pointer",
                    transition: "background 0.1s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = "#f1f5f9";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
