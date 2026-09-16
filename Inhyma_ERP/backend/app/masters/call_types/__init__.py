"""Call Types Master Module."""

from __future__ import annotations

from app.masters.call_types.models import CallType
from app.masters.call_types.repository import CallTypeRepository
from app.masters.call_types.service import CallTypeService

__all__ = [
    "CallType",
    "CallTypeRepository",
    "CallTypeService",
]
