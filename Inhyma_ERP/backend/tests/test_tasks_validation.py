"""
Unit tests for Task date, parent, and sprint validations.
"""

import pytest
import uuid
from datetime import date, timedelta
from pydantic import ValidationError

from app.tasks.schemas import TaskCreate, TaskUpdate
from app.tasks.models import TaskPriority, TaskStatus, IssueType


def test_task_create_date_validation():
    today = date.today()
    yesterday = today - timedelta(days=1)
    tomorrow = today + timedelta(days=1)

    # Valid dates: due_date > start_date
    valid = TaskCreate(
        title="Valid Task",
        start_date=today,
        due_date=tomorrow,
    )
    assert valid.start_date == today
    assert valid.due_date == tomorrow

    # Valid dates: due_date == start_date
    same_day = TaskCreate(
        title="Same Day Task",
        start_date=today,
        due_date=today,
    )
    assert same_day.start_date == same_day.due_date

    # Invalid dates: due_date < start_date must raise ValidationError
    with pytest.raises(ValidationError) as exc_info:
        TaskCreate(
            title="Invalid Task",
            start_date=today,
            due_date=yesterday,
        )
    assert "Due date cannot be earlier than start date." in str(exc_info.value)


def test_task_update_date_validation():
    today = date.today()
    yesterday = today - timedelta(days=1)
    tomorrow = today + timedelta(days=1)

    # Valid update
    valid = TaskUpdate(
        start_date=today,
        due_date=tomorrow,
    )
    assert valid.due_date == tomorrow

    # Invalid update: due_date < start_date
    with pytest.raises(ValidationError) as exc_info:
        TaskUpdate(
            start_date=today,
            due_date=yesterday,
        )
    assert "Due date cannot be earlier than start date." in str(exc_info.value)
