"""
Attendance Service Layer.
Encapsulates attendance business logic, punch session handling,
assigned office lookup, and calendar history queries.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession

from app.hrms.service import HrmsService


class AttendanceService(HrmsService):
    """Attendance-specific service extending HrmsService."""

    def __init__(self, db: AsyncSession) -> None:
        super().__init__(db)
