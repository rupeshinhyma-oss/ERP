"""Option Lists Master Module.

Generic, DB-backed store for every dropdown / fixed-choice list that used to be
hardcoded in the frontend (statuses, priorities, delivery types, ...).
"""

from __future__ import annotations

from app.masters.option_lists.models import OptionList

__all__ = ["OptionList"]
