import React, { useState, useRef, useEffect, useMemo } from "react";

export interface DateRangePickerProps {
  value: string; // "MM/DD/YYYY - MM/DD/YYYY"
  onChange: (val: string) => void;
  onApply?: (val: string) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  style?: React.CSSProperties;
  align?: "left" | "right";
  "data-testid"?: string;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const PRESETS = [
  "Today",
  "Yesterday",
  "Last 7 Days",
  "Last 30 Days",
  "This Month",
  "Last Month",
  "Custom Range",
];

function formatMDY(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function parseAnyDate(s: string): Date | null {
  if (!s) return null;
  const str = s.trim();
  if (str.includes("/")) {
    const parts = str.split("/");
    if (parts.length === 3) {
      const m = parseInt(parts[0], 10) - 1;
      const d = parseInt(parts[1], 10);
      const y = parseInt(parts[2], 10);
      if (!isNaN(m) && !isNaN(d) && !isNaN(y)) return new Date(y, m, d);
    }
  }
  if (str.includes("-")) {
    const parts = str.split("-");
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        // YYYY-MM-DD
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      } else {
        // DD-MM-YYYY
        return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
      }
    }
  }
  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function parseRange(rangeStr: string): { start: Date | null; end: Date | null } {
  if (!rangeStr || !rangeStr.includes("-")) return { start: null, end: null };
  const [s1, s2] = rangeStr.split("-").map((s) => s.trim());
  return { start: parseAnyDate(s1), end: parseAnyDate(s2) };
}

function isSameDay(d1: Date | null, d2: Date | null): boolean {
  if (!d1 || !d2) return false;
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function isBetween(target: Date, start: Date | null, end: Date | null): boolean {
  if (!start || !end) return false;
  const t = target.getTime();
  const s = start.getTime();
  const e = end.getTime();
  return t >= Math.min(s, e) && t <= Math.max(s, e);
}

export function DateRangePicker({
  value,
  onChange,
  onApply,
  placeholder = "MM/DD/YYYY - MM/DD/YYYY",
  id,
  className = "adjustment-filter-input",
  style,
  align = "left",
  "data-testid": dataTestId,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reference base date (current date)
  const baseDate = useMemo(() => new Date(), []);

  const parsed = useMemo(() => parseRange(value), [value]);

  const defaultRange = useMemo(() => {
    const end = new Date(baseDate);
    const start = new Date(baseDate);
    start.setDate(start.getDate() - 29);
    return { start, end };
  }, [baseDate]);

  const [draftStart, setDraftStart] = useState<Date | null>(() => parsed.start || defaultRange.start);
  const [draftEnd, setDraftEnd] = useState<Date | null>(() => parsed.end || defaultRange.end);
  const [activePreset, setActivePreset] = useState<string>("Last 30 Days");

  // Navigation months:
  // Right calendar = current/end month, Left calendar = preceding month
  const [rightMonth, setRightMonth] = useState<number>(() => {
    const d = parsed.end || defaultRange.end;
    return d.getMonth();
  });
  const [rightYear, setRightYear] = useState<number>(() => {
    const d = parsed.end || defaultRange.end;
    return d.getFullYear();
  });
  const [leftMonth, setLeftMonth] = useState<number>(() => {
    const d = parsed.end || defaultRange.end;
    const m = d.getMonth();
    return m === 0 ? 11 : m - 1;
  });
  const [leftYear, setLeftYear] = useState<number>(() => {
    const d = parsed.end || defaultRange.end;
    const m = d.getMonth();
    const y = d.getFullYear();
    return m === 0 ? y - 1 : y;
  });

  // Sync draft state with external value changes
  useEffect(() => {
    const p = parseRange(value);
    if (p.start && p.end) {
      setDraftStart(p.start);
      setDraftEnd(p.end);
      const rm = p.end.getMonth();
      const ry = p.end.getFullYear();
      setRightMonth(rm);
      setRightYear(ry);
      setLeftMonth(rm === 0 ? 11 : rm - 1);
      setLeftYear(rm === 0 ? ry - 1 : ry);
    }
  }, [value]);

  // Close when clicking outside
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

  // Navigate left month
  const handlePrevMonth = () => {
    if (leftMonth === 0) {
      setLeftMonth(11);
      setLeftYear((y) => y - 1);
    } else {
      setLeftMonth((m) => m - 1);
    }
    if (rightMonth === 0) {
      setRightMonth(11);
      setRightYear((y) => y - 1);
    } else {
      setRightMonth((m) => m - 1);
    }
  };

  // Navigate right month
  const handleNextMonth = () => {
    if (leftMonth === 11) {
      setLeftMonth(0);
      setLeftYear((y) => y + 1);
    } else {
      setLeftMonth((m) => m + 1);
    }
    if (rightMonth === 11) {
      setRightMonth(0);
      setRightYear((y) => y + 1);
    } else {
      setRightMonth((m) => m + 1);
    }
  };

  // Preset click handler
  const handlePresetClick = (preset: string) => {
    setActivePreset(preset);
    let start: Date;
    let end: Date = new Date(baseDate);

    if (preset === "Today") {
      start = new Date(baseDate);
      end = new Date(baseDate);
    } else if (preset === "Yesterday") {
      start = new Date(baseDate);
      start.setDate(start.getDate() - 1);
      end = new Date(start);
    } else if (preset === "Last 7 Days") {
      start = new Date(baseDate);
      start.setDate(start.getDate() - 6);
      end = new Date(baseDate);
    } else if (preset === "Last 30 Days") {
      start = new Date(baseDate);
      start.setDate(start.getDate() - 29);
      end = new Date(baseDate);
    } else if (preset === "This Month") {
      start = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
      end = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0);
    } else if (preset === "Last Month") {
      start = new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, 1);
      end = new Date(baseDate.getFullYear(), baseDate.getMonth(), 0);
    } else {
      // Custom Range
      return;
    }

    setDraftStart(start);
    setDraftEnd(end);

    const rm = end.getMonth();
    const ry = end.getFullYear();
    setRightMonth(rm);
    setRightYear(ry);
    setLeftMonth(rm === 0 ? 11 : rm - 1);
    setLeftYear(rm === 0 ? ry - 1 : ry);
  };

  // Day click handler
  const handleDayClick = (dayDate: Date) => {
    if (!draftStart || (draftStart && draftEnd)) {
      setDraftStart(dayDate);
      setDraftEnd(null);
      setActivePreset("Custom Range");
    } else {
      if (dayDate.getTime() < draftStart.getTime()) {
        setDraftEnd(draftStart);
        setDraftStart(dayDate);
      } else {
        setDraftEnd(dayDate);
      }
      setActivePreset("Custom Range");
    }
  };

  // Apply button
  const handleApply = () => {
    if (draftStart && draftEnd) {
      const formatted = `${formatMDY(draftStart)} - ${formatMDY(draftEnd)}`;
      onChange(formatted);
      if (onApply) onApply(formatted);
    } else if (draftStart) {
      const formatted = `${formatMDY(draftStart)} - ${formatMDY(draftStart)}`;
      onChange(formatted);
      if (onApply) onApply(formatted);
    }
    setIsOpen(false);
  };

  // Clear button
  const handleClear = () => {
    setDraftStart(null);
    setDraftEnd(null);
    setActivePreset("Custom Range");
    onChange("");
    if (onApply) onApply("");
    setIsOpen(false);
  };

  // Helper to generate 42 calendar day cells for a given month/year
  const getCalendarDays = (year: number, month: number) => {
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 is Sunday
    const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const cells: { date: Date; isCurrentMonth: boolean }[] = [];

    // Prev month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      cells.push({
        date: new Date(year, month - 1, daysInPrevMonth - i),
        isCurrentMonth: false,
      });
    }

    // Current month days
    for (let i = 1; i <= daysInCurrentMonth; i++) {
      cells.push({
        date: new Date(year, month, i),
        isCurrentMonth: true,
      });
    }

    // Next month padding to fill 42 cells (6 rows x 7 cols)
    const remaining = 42 - cells.length;
    for (let i = 1; i <= remaining; i++) {
      cells.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false,
      });
    }

    return cells;
  };

  const leftDays = useMemo(() => getCalendarDays(leftYear, leftMonth), [leftYear, leftMonth]);
  const rightDays = useMemo(() => getCalendarDays(rightYear, rightMonth), [rightYear, rightMonth]);

  const displayRangeString = useMemo(() => {
    if (draftStart && draftEnd) {
      return `${formatMDY(draftStart)} - ${formatMDY(draftEnd)}`;
    }
    if (draftStart) {
      return `${formatMDY(draftStart)} - ...`;
    }
    return "";
  }, [draftStart, draftEnd]);

  return (
    <div className="date-range-container" ref={containerRef} style={{ position: "relative" }}>
      <input
        id={id}
        type="text"
        className={className}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={() => setIsOpen(true)}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        readOnly
        style={{ cursor: "pointer", ...style }}
        data-testid={dataTestId || (id ? `date-range-input-${id}` : "date-range-input")}
      />

      {isOpen && (
        <div
          className="date-range-popover"
          data-testid="date-range-popover"
          style={align === "right" ? { left: "auto", right: 0 } : undefined}
        >
          <div className="date-range-body">
            {/* Left Sidebar Presets */}
            <div className="date-range-sidebar">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`date-range-preset-btn ${activePreset === p ? "active" : ""}`}
                  onClick={() => handlePresetClick(p)}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Calendars Container */}
            <div className="date-range-calendars">
              {/* Left Calendar */}
              <div className="date-range-calendar">
                <div className="date-range-cal-header">
                  <button
                    type="button"
                    className="date-range-nav-btn"
                    onClick={handlePrevMonth}
                    title="Previous month"
                  >
                    &lt;
                  </button>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <select
                      className="date-range-cal-select"
                      value={leftMonth}
                      onChange={(e) => setLeftMonth(Number(e.target.value))}
                    >
                      {MONTH_NAMES.map((name, idx) => (
                        <option key={name} value={idx}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <select
                      className="date-range-cal-select"
                      value={leftYear}
                      onChange={(e) => setLeftYear(Number(e.target.value))}
                    >
                      {[2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030].map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ width: "20px" }} />
                </div>

                <div className="date-range-weekdays">
                  <span>Su</span>
                  <span>Mo</span>
                  <span>Tu</span>
                  <span>We</span>
                  <span>Th</span>
                  <span>Fr</span>
                  <span>Sa</span>
                </div>

                <div className="date-range-days">
                  {leftDays.map(({ date, isCurrentMonth }, i) => {
                    const isStart = isSameDay(date, draftStart);
                    const isEnd = isSameDay(date, draftEnd);
                    const inRange = isBetween(date, draftStart, draftEnd);

                    return (
                      <div
                        key={i}
                        className={`date-range-day ${!isCurrentMonth ? "out-of-month" : ""} ${
                          inRange ? "in-range" : ""
                        } ${isStart ? "range-start" : ""} ${isEnd ? "range-end" : ""}`}
                        onClick={() => handleDayClick(date)}
                      >
                        {date.getDate()}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Calendar */}
              <div className="date-range-calendar">
                <div className="date-range-cal-header">
                  <div style={{ width: "20px" }} />
                  <div style={{ display: "flex", gap: "4px" }}>
                    <select
                      className="date-range-cal-select"
                      value={rightMonth}
                      onChange={(e) => setRightMonth(Number(e.target.value))}
                    >
                      {MONTH_NAMES.map((name, idx) => (
                        <option key={name} value={idx}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <select
                      className="date-range-cal-select"
                      value={rightYear}
                      onChange={(e) => setRightYear(Number(e.target.value))}
                    >
                      {[2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030].map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="date-range-nav-btn"
                    onClick={handleNextMonth}
                    title="Next month"
                  >
                    &gt;
                  </button>
                </div>

                <div className="date-range-weekdays">
                  <span>Su</span>
                  <span>Mo</span>
                  <span>Tu</span>
                  <span>We</span>
                  <span>Th</span>
                  <span>Fr</span>
                  <span>Sa</span>
                </div>

                <div className="date-range-days">
                  {rightDays.map(({ date, isCurrentMonth }, i) => {
                    const isStart = isSameDay(date, draftStart);
                    const isEnd = isSameDay(date, draftEnd);
                    const inRange = isBetween(date, draftStart, draftEnd);

                    return (
                      <div
                        key={i}
                        className={`date-range-day ${!isCurrentMonth ? "out-of-month" : ""} ${
                          inRange ? "in-range" : ""
                        } ${isStart ? "range-start" : ""} ${isEnd ? "range-end" : ""}`}
                        onClick={() => handleDayClick(date)}
                      >
                        {date.getDate()}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Footer Bar */}
          <div className="date-range-footer">
            <span className="date-range-footer-text">{displayRangeString}</span>
            <div className="date-range-footer-actions">
              <button
                type="button"
                className="date-range-btn-clear"
                onClick={handleClear}
              >
                Clear
              </button>
              <button
                type="button"
                className="date-range-btn-apply"
                onClick={handleApply}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DateRangePicker;
