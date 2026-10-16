"""Age of Company, derived from the GST registration date (spec: "Age of Company (in years) - auto computed")."""

from __future__ import annotations

import re
from datetime import date, datetime


def parse_registration_date(value: date | str | None) -> date | None:
    """Accept a date, ``YYYY-MM-DD`` (the calendar input) or ``DD-MM-YYYY`` / ``DD/MM/YYYY``."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?", text)
    if m:
        y, mo, d = (int(g) for g in m.groups())
    else:
        m = re.fullmatch(r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})", text)
        if not m:
            return None
        d, mo, y = (int(g) for g in m.groups())
    try:
        return date(y, mo, d)
    except ValueError:
        return None


def compute_company_age(registration: date | str | None, today: date | None = None) -> str | None:
    """Completed years since the registration date as text ("0" for a company under a year old).

    ``None`` when there is no usable date or the date is in the future.
    """
    reg = parse_registration_date(registration)
    if reg is None:
        return None
    today = today or date.today()
    if reg > today:
        return None
    years = today.year - reg.year - ((today.month, today.day) < (reg.month, reg.day))
    return str(years)
