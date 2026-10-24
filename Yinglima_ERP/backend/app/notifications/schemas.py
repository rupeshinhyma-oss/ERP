"""
Notification Pydantic Schemas.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class NotificationRuleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_key: str
    title: str
    description: str | None = None
    module: str
    role_ids: list[str] = Field(default_factory=list)
    user_ids: list[str] = Field(default_factory=list)
    is_active: bool = True
    created_at: datetime
    updated_at: datetime


class NotificationRuleUpdate(BaseModel):
    role_ids: list[str] | None = None
    user_ids: list[str] | None = None
    is_active: bool | None = None


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    sender_id: uuid.UUID | None = None
    type: str
    module: str | None = None
    title: str
    message: str
    link: str | None = None
    is_read: bool = False
    created_at: datetime


class NotificationUnreadCountRead(BaseModel):
    unread_count: int
