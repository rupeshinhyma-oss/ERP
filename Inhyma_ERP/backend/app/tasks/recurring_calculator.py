"""
Pure date calculation utilities for recurring tasks.

Supports:
- Monthly: Specific Months or Every Month, specific day of month (clamped to month-end),
  LAST_DAY, or LAST_WORKING_DAY (Monday through Saturday; Sunday is non-working).
- Quarterly: Configurable selection of Q1–Q4, customizable due months/days or Last Working Day
  per quarter without hardcoded statutory assumptions.
- Yearly: Calendar Year (Jan–Dec) or Financial Year (custom start month, e.g. April 1),
  specific month/day or Last Working Day within the selected month.
- Working Calendar: Monday through Saturday. Sunday is non-working.
  Public holidays are not considered as no company holiday calendar is configured.
- Idempotent period key generation (e.g., '2026-10', '2026-Q4', 'FY2026-27').
- Timeline preview: Next due date, reminder start date, escalation date, and hold suppression.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta
from typing import Any


def clamp_day_to_month(year: int, month: int, target_day: int) -> date:
    """Return date with target_day clamped to the maximum days available in month."""
    max_days = calendar.monthrange(year, month)[1]
    day = min(max(1, target_day), max_days)
    return date(year, month, day)


def get_last_day_of_month(year: int, month: int) -> date:
    """Return the final calendar date of the specified year and month."""
    max_days = calendar.monthrange(year, month)[1]
    return date(year, month, max_days)


def get_last_working_day_of_month(year: int, month: int) -> date:
    """
    Return the final company working day (Monday through Saturday) of the specified month.
    The company working week is Monday through Saturday. Sunday is non-working.
    If the last calendar day is Sunday (weekday == 6), step back 1 day to Saturday.
    Public holidays are not considered in this calculation.
    """
    d = get_last_day_of_month(year, month)
    # weekday(): Monday is 0, Saturday is 5, Sunday is 6
    if d.weekday() == 6:  # Sunday
        return d - timedelta(days=1)
    return d


def calculate_monthly_due_date(year: int, month: int, config: dict[str, Any]) -> date:
    """
    Calculate due date for a specific year and month based on monthly config.
    config keys:
      - day_type: 'SPECIFIC_DAY' | 'LAST_DAY' | 'LAST_WORKING_DAY' (default 'SPECIFIC_DAY')
      - day_of_month: int (1..31)
    """
    day_type = config.get("day_type", "SPECIFIC_DAY")
    if day_type == "LAST_WORKING_DAY":
        return get_last_working_day_of_month(year, month)
    elif day_type == "LAST_DAY":
        return get_last_day_of_month(year, month)
    else:
        target_day = int(config.get("day_of_month") or config.get("day") or 1)
        return clamp_day_to_month(year, month, target_day)


def get_quarter_for_month(month: int) -> str:
    """Return Q1, Q2, Q3, or Q4 based on calendar month (1-12)."""
    if 1 <= month <= 3:
        return "Q1"
    elif 4 <= month <= 6:
        return "Q2"
    elif 7 <= month <= 9:
        return "Q3"
    else:
        return "Q4"


def calculate_quarterly_due_date(year: int, quarter: str, config: dict[str, Any]) -> date:
    """
    Calculate due date for a specific year and quarter based on config.
    Default quarter preset:
      - Q1: Month 3 (Mar)
      - Q2: Month 6 (Jun)
      - Q3: Month 9 (Sep)
      - Q4: Month 12 (Dec)
    Config can specify quarter_dates / quarter_schedules per quarter:
      {
        "month": 3,
        "day_type": "SPECIFIC_DAY" | "LAST_DAY" | "LAST_WORKING_DAY",
        "day": 31,
      }
    """
    preset_months = {"Q1": 3, "Q2": 6, "Q3": 9, "Q4": 12}
    q_map = config.get("quarter_dates") or config.get("quarter_schedules") or {}
    q_cfg = q_map.get(quarter) or {}

    m = int(q_cfg.get("month") or preset_months.get(quarter, 3))
    day_type = q_cfg.get("day_type", config.get("day_type", "SPECIFIC_DAY"))

    if day_type == "LAST_WORKING_DAY":
        return get_last_working_day_of_month(year, m)
    elif day_type == "LAST_DAY":
        return get_last_day_of_month(year, m)
    else:
        target_day = int(q_cfg.get("day") or q_cfg.get("day_of_month") or config.get("day_of_month", 31))
        return clamp_day_to_month(year, m, target_day)


def calculate_yearly_due_date(year: int, config: dict[str, Any]) -> date:
    """
    Calculate due date for a given year based on yearly config.
    config keys:
      - year_type: 'CALENDAR' | 'FINANCIAL'
      - fy_start_month: int (e.g. 4 for April)
      - month / due_month: int (1..12, default 12)
      - day_type: 'SPECIFIC_DAY' | 'LAST_DAY' | 'LAST_WORKING_DAY' (default 'SPECIFIC_DAY')
      - day / due_day: int (1..31, default 31)
    """
    m = int(config.get("due_month") or config.get("month") or 12)
    day_type = config.get("day_type", "SPECIFIC_DAY")

    if day_type == "LAST_WORKING_DAY":
        return get_last_working_day_of_month(year, m)
    elif day_type == "LAST_DAY":
        return get_last_day_of_month(year, m)
    else:
        target_day = int(config.get("due_day") or config.get("day") or config.get("day_of_month", 31))
        return clamp_day_to_month(year, m, target_day)


def calculate_next_occurrence(
    frequency: str,
    config: dict[str, Any],
    after_date: date,
    effective_start_date: date | None = None,
    effective_end_date: date | None = None,
) -> tuple[date, str] | None:
    """
    Calculate the next occurrence on or after after_date (inclusive).
    Returns (due_date, period_key) or None if expired.
    """
    start = effective_start_date or after_date
    search_date = max(after_date, start)

    freq = frequency.upper()

    if freq == "MONTHLY":
        month_mode = config.get("month_mode", "EVERY_MONTH")
        selected_months = config.get("months") or []
        if month_mode == "SPECIFIC_MONTHS" and selected_months:
            allowed_months = set(int(x) for x in selected_months)
        else:
            allowed_months = set(range(1, 13))

        curr_year = search_date.year
        curr_month = search_date.month
        for _ in range(48):  # search up to 4 years for specific month cycles
            if curr_month in allowed_months:
                due = calculate_monthly_due_date(curr_year, curr_month, config)
                period_key = f"{curr_year:04d}-{curr_month:02d}"
                if due >= search_date:
                    if effective_end_date and due > effective_end_date:
                        return None
                    return due, period_key

            # Step to next month
            if curr_month == 12:
                curr_month = 1
                curr_year += 1
            else:
                curr_month += 1

    elif freq == "QUARTERLY":
        # Search next 16 quarters
        applicable_quarters = config.get("quarters") or ["Q1", "Q2", "Q3", "Q4"]
        curr_year = search_date.year
        curr_quarter_idx = ["Q1", "Q2", "Q3", "Q4"].index(get_quarter_for_month(search_date.month))

        for _ in range(16):
            q_code = ["Q1", "Q2", "Q3", "Q4"][curr_quarter_idx]
            if q_code in applicable_quarters:
                due = calculate_quarterly_due_date(curr_year, q_code, config)
                period_key = f"{curr_year:04d}-{q_code}"
                if due >= search_date:
                    if effective_end_date and due > effective_end_date:
                        return None
                    return due, period_key

            # Step to next quarter
            if curr_quarter_idx == 3:
                curr_quarter_idx = 0
                curr_year += 1
            else:
                curr_quarter_idx += 1

    elif freq == "YEARLY":
        # Search next 10 years
        year_type = config.get("year_type", "CALENDAR")
        fy_start_month = int(config.get("fy_start_month") or config.get("financial_year_start_month") or 4)
        m = int(config.get("due_month") or config.get("month") or 12)
        curr_year = search_date.year

        for y in range(curr_year, curr_year + 10):
            due = calculate_yearly_due_date(y, config)
            if year_type == "FINANCIAL":
                if m >= fy_start_month:
                    period_key = f"FY{y:04d}-{str(y + 1)[-2:]}"
                else:
                    period_key = f"FY{y - 1:04d}-{str(y)[-2:]}"
            else:
                period_key = f"{y:04d}"

            if due >= search_date:
                if effective_end_date and due > effective_end_date:
                    return None
                return due, period_key

    return None


def calculate_upcoming_occurrences(
    frequency: str,
    config: dict[str, Any],
    start_date: date,
    count: int = 5,
    effective_end_date: date | None = None,
) -> list[dict[str, Any]]:
    """
    Generate the next N occurrences starting on or after start_date.
    Returns list of dicts: {'period': '2026-10', 'due_date': date, 'formatted_due_date': '31 Oct 2026'}
    """
    results: list[dict[str, Any]] = []
    current_search = start_date

    while len(results) < count:
        nxt = calculate_next_occurrence(
            frequency=frequency,
            config=config,
            after_date=current_search,
            effective_start_date=start_date,
            effective_end_date=effective_end_date,
        )
        if not nxt:
            break
        due, period_key = nxt
        results.append({
            "period": period_key,
            "due_date": due.isoformat(),
            "formatted_due_date": due.strftime("%d %b %Y"),
        })
        # Advance current_search by 1 day past due date
        current_search = due + timedelta(days=1)

    return results


def calculate_preview_details(
    frequency: str,
    config: dict[str, Any],
    start_date: date,
    reminder_lead_days: int = 3,
    escalation_timing_type: str = "ON_DUE_DATE",
    escalation_offset_days: int = 0,
    escalation_repeat_interval_days: int = 7,
    hold_until: date | None = None,
    effective_end_date: date | None = None,
) -> dict[str, Any]:
    """
    Calculate full occurrence timeline details for preview.
    Includes exact next due date, reminder start date, manager escalation date,
    and hold suppression status.
    """
    nxt = calculate_next_occurrence(
        frequency=frequency,
        config=config,
        after_date=start_date,
        effective_start_date=start_date,
        effective_end_date=effective_end_date,
    )
    if not nxt:
        return {
            "frequency": frequency,
            "next_period": None,
            "next_due_date": None,
            "formatted_due_date": None,
            "reminder_date": None,
            "formatted_reminder_date": None,
            "escalation_date": None,
            "formatted_escalation_date": None,
            "repeat_escalation_interval": f"Every {escalation_repeat_interval_days} days while incomplete",
            "hold_active": False,
            "explanation": "No upcoming occurrences found within the effective period.",
        }

    due, period_key = nxt

    # Reminder date
    lead = max(0, int(reminder_lead_days or 0))
    reminder_d = due - timedelta(days=lead)

    # Escalation date
    timing = (escalation_timing_type or "ON_DUE_DATE").upper()
    offset = max(0, int(escalation_offset_days or 0))
    if timing == "BEFORE_DUE_DATE":
        escalation_d = due - timedelta(days=offset)
        escalation_desc = f"{offset} day{'s' if offset != 1 else ''} before due date"
    elif timing == "AFTER_DUE_DATE":
        escalation_d = due + timedelta(days=offset)
        escalation_desc = f"{offset} day{'s' if offset != 1 else ''} after due date (overdue SLA)"
    else:  # ON_DUE_DATE
        escalation_d = due
        escalation_desc = "On due date"

    # Hold suppression
    is_held = False
    if hold_until and due <= hold_until:
        is_held = True

    # Descriptive explanation
    cal_rule = config.get("day_type", "SPECIFIC_DAY")
    rule_text = (
        "Last Working Day (Mon-Sat)"
        if cal_rule == "LAST_WORKING_DAY"
        else "Last Calendar Day"
        if cal_rule == "LAST_DAY"
        else f"Day {config.get('day_of_month') or config.get('day') or 1}"
    )

    explanation = (
        f"Period {period_key} due on {due.strftime('%d %b %Y')} ({rule_text}). "
        f"Reminder starts on {reminder_d.strftime('%d %b %Y')} ({lead}d prior). "
        f"Manager escalation on {escalation_d.strftime('%d %b %Y')} ({escalation_desc})."
    )
    if is_held:
        explanation += f" [Note: On hold until {hold_until.strftime('%d %b %Y')}; reminders suppressed until hold expires]."

    return {
        "frequency": frequency,
        "next_period": period_key,
        "next_due_date": due.isoformat(),
        "formatted_due_date": due.strftime("%d %b %Y"),
        "reminder_date": reminder_d.isoformat(),
        "formatted_reminder_date": reminder_d.strftime("%d %b %Y"),
        "escalation_date": escalation_d.isoformat(),
        "formatted_escalation_date": escalation_d.strftime("%d %b %Y"),
        "repeat_escalation_interval": f"Every {escalation_repeat_interval_days} days while incomplete",
        "hold_active": is_held,
        "explanation": explanation,
    }
