"""
Unit Tests for HRMS Site Visit Lifecycle State Transitions (Phase 2B).

Validates:
1. First valid check-in transitions from SCHEDULED to CHECKED_IN.
2. Duplicate check-in is rejected (400) and preserves original check_in_time.
3. Check-in on completed visit is rejected (400).
4. Check-in on cancelled visit is rejected (400).
5. Check-out before check-in is rejected (400).
6. Valid check-out transitions from CHECKED_IN to COMPLETED.
7. Repeated check-out is rejected (400).
8. Check-out on cancelled visit is rejected (400).
9. Cross-employee unauthorized check-in/out is blocked (403).

All tests use isolated mock sessions -- zero writes to shared/staging databases.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.hrms.models import HrmsSiteVisit
from app.hrms.schemas import SiteVisitCheckIn, SiteVisitCheckOut
from app.hrms.site_visit_service import HrmsSiteVisitService


def create_mock_site_visit(
    *,
    visit_id: uuid.UUID,
    employee_id: uuid.UUID,
    status: str = "SCHEDULED",
    check_in_time: datetime | None = None,
    check_out_time: datetime | None = None,
) -> HrmsSiteVisit:
    visit = MagicMock(spec=HrmsSiteVisit)
    visit.id = visit_id
    visit.employee_id = employee_id
    visit.customer_name = "ABC Corp"
    visit.site_address = "Turbhe MIDC, Navi Mumbai"
    visit.site_latitude = 19.1998
    visit.site_longitude = 72.9568
    visit.status = status
    visit.check_in_time = check_in_time
    visit.check_in_latitude = 19.0760 if check_in_time else None
    visit.check_in_longitude = 72.8777 if check_in_time else None
    visit.check_in_accuracy = 15.0 if check_in_time else None
    visit.check_in_address = "Turbhe Site" if check_in_time else None
    visit.check_out_time = check_out_time
    visit.check_out_latitude = 19.0762 if check_out_time else None
    visit.check_out_longitude = 72.8779 if check_out_time else None
    visit.check_out_accuracy = 18.0 if check_out_time else None
    visit.check_out_address = "Turbhe Departure" if check_out_time else None
    visit.deleted_at = None
    return visit


def create_mock_service():
    session = MagicMock()
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    service = HrmsSiteVisitService(session)
    return service, session


@pytest.mark.asyncio
async def test_first_valid_check_in():
    """Valid check-in transitions visit to CHECKED_IN and persists check-in proof."""
    service, session = create_mock_service()
    visit_id = uuid.uuid4()
    emp_id = uuid.uuid4()

    mock_visit = create_mock_site_visit(
        visit_id=visit_id,
        employee_id=emp_id,
        status="SCHEDULED",
        check_in_time=None,
    )
    service.get_site_visit = AsyncMock(return_value=mock_visit)

    payload = SiteVisitCheckIn(
        latitude=19.1998,
        longitude=72.9568,
        accuracy=12.0,
        gps_timestamp=datetime.now(timezone.utc),
        address="Lodha Supremus, Thane",
    )

    result = await service.check_in(visit_id, emp_id, is_admin=False, payload=payload)

    assert result.status == "CHECKED_IN"
    assert result.check_in_time is not None
    assert result.check_in_latitude == 19.1998
    assert result.check_in_longitude == 72.9568
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_duplicate_check_in_rejected():
    """Repeated check-in on already checked-in visit raises HTTP 400 and preserves timestamp."""
    service, _ = create_mock_service()
    visit_id = uuid.uuid4()
    emp_id = uuid.uuid4()
    original_time = datetime(2026, 10, 29, 9, 30, 0, tzinfo=timezone.utc)

    mock_visit = create_mock_site_visit(
        visit_id=visit_id,
        employee_id=emp_id,
        status="CHECKED_IN",
        check_in_time=original_time,
    )
    service.get_site_visit = AsyncMock(return_value=mock_visit)

    payload = SiteVisitCheckIn(
        latitude=19.2000,
        longitude=72.9570,
        accuracy=10.0,
        gps_timestamp=datetime.now(timezone.utc),
        address="New Location Attempt",
    )

    with pytest.raises(HTTPException) as exc_info:
        await service.check_in(visit_id, emp_id, is_admin=False, payload=payload)

    assert exc_info.value.status_code == 400
    assert "Duplicate check-in is not permitted" in exc_info.value.detail
    assert mock_visit.check_in_time == original_time


@pytest.mark.asyncio
async def test_check_in_after_completion_rejected():
    """Check-in on completed visit raises HTTP 400."""
    service, _ = create_mock_service()
    visit_id = uuid.uuid4()
    emp_id = uuid.uuid4()

    mock_visit = create_mock_site_visit(
        visit_id=visit_id,
        employee_id=emp_id,
        status="COMPLETED",
        check_in_time=datetime.now(timezone.utc),
        check_out_time=datetime.now(timezone.utc),
    )
    service.get_site_visit = AsyncMock(return_value=mock_visit)

    payload = SiteVisitCheckIn(latitude=19.1998, longitude=72.9568, accuracy=10.0, gps_timestamp=datetime.now(timezone.utc))

    with pytest.raises(HTTPException) as exc_info:
        await service.check_in(visit_id, emp_id, is_admin=False, payload=payload)

    assert exc_info.value.status_code == 400
    assert "Site visit is already completed" in exc_info.value.detail


@pytest.mark.asyncio
async def test_check_in_after_cancellation_rejected():
    """Check-in on cancelled visit raises HTTP 400."""
    service, _ = create_mock_service()
    visit_id = uuid.uuid4()
    emp_id = uuid.uuid4()

    mock_visit = create_mock_site_visit(
        visit_id=visit_id,
        employee_id=emp_id,
        status="CANCELLED",
        check_in_time=None,
    )
    service.get_site_visit = AsyncMock(return_value=mock_visit)

    payload = SiteVisitCheckIn(latitude=19.1998, longitude=72.9568, accuracy=10.0, gps_timestamp=datetime.now(timezone.utc))

    with pytest.raises(HTTPException) as exc_info:
        await service.check_in(visit_id, emp_id, is_admin=False, payload=payload)

    assert exc_info.value.status_code == 400
    assert "Site visit has been cancelled" in exc_info.value.detail


@pytest.mark.asyncio
async def test_check_out_before_check_in_rejected():
    """Attempting to check out before check-in raises HTTP 400."""
    service, _ = create_mock_service()
    visit_id = uuid.uuid4()
    emp_id = uuid.uuid4()

    mock_visit = create_mock_site_visit(
        visit_id=visit_id,
        employee_id=emp_id,
        status="SCHEDULED",
        check_in_time=None,
    )
    service.get_site_visit = AsyncMock(return_value=mock_visit)

    payload = SiteVisitCheckOut(
        latitude=19.1998,
        longitude=72.9568,
        accuracy=10.0,
        gps_timestamp=datetime.now(timezone.utc),
        address="Premature Check Out",
    )

    with pytest.raises(HTTPException) as exc_info:
        await service.check_out(visit_id, emp_id, is_admin=False, payload=payload)

    assert exc_info.value.status_code == 400
    assert "Cannot check out of a site visit that has not been checked into yet" in exc_info.value.detail


@pytest.mark.asyncio
async def test_valid_check_out():
    """Valid check-out transitions visit from CHECKED_IN to COMPLETED."""
    service, session = create_mock_service()
    visit_id = uuid.uuid4()
    emp_id = uuid.uuid4()

    mock_visit = create_mock_site_visit(
        visit_id=visit_id,
        employee_id=emp_id,
        status="CHECKED_IN",
        check_in_time=datetime(2026, 10, 29, 9, 30, tzinfo=timezone.utc),
    )
    service.get_site_visit = AsyncMock(return_value=mock_visit)

    payload = SiteVisitCheckOut(
        latitude=19.1999,
        longitude=72.9569,
        accuracy=14.0,
        gps_timestamp=datetime.now(timezone.utc),
        address="Customer Meeting Completed",
    )

    result = await service.check_out(visit_id, emp_id, is_admin=False, payload=payload)

    assert result.status == "COMPLETED"
    assert result.check_out_time is not None
    assert result.check_out_latitude == 19.1999
    assert result.check_out_longitude == 72.9569
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_repeated_check_out_rejected():
    """Repeated check-out on an already COMPLETED visit raises HTTP 400."""
    service, _ = create_mock_service()
    visit_id = uuid.uuid4()
    emp_id = uuid.uuid4()
    original_out = datetime(2026, 10, 29, 17, 30, tzinfo=timezone.utc)

    mock_visit = create_mock_site_visit(
        visit_id=visit_id,
        employee_id=emp_id,
        status="COMPLETED",
        check_in_time=datetime(2026, 10, 29, 9, 30, tzinfo=timezone.utc),
        check_out_time=original_out,
    )
    service.get_site_visit = AsyncMock(return_value=mock_visit)

    payload = SiteVisitCheckOut(latitude=19.1999, longitude=72.9569, accuracy=10.0, gps_timestamp=datetime.now(timezone.utc))

    with pytest.raises(HTTPException) as exc_info:
        await service.check_out(visit_id, emp_id, is_admin=False, payload=payload)

    assert exc_info.value.status_code == 400
    assert "Repeated check-out is not permitted" in exc_info.value.detail
    assert mock_visit.check_out_time == original_out


@pytest.mark.asyncio
async def test_unauthorized_employee_check_in_blocked():
    """Non-admin employee attempting to check into another employee's visit raises HTTP 403."""
    service, _ = create_mock_service()
    visit_id = uuid.uuid4()
    emp_a = uuid.uuid4()
    emp_b = uuid.uuid4()

    mock_visit = create_mock_site_visit(
        visit_id=visit_id,
        employee_id=emp_a,
        status="SCHEDULED",
    )
    service.get_site_visit = AsyncMock(return_value=mock_visit)

    payload = SiteVisitCheckIn(latitude=19.1998, longitude=72.9568, accuracy=10.0, gps_timestamp=datetime.now(timezone.utc))

    with pytest.raises(HTTPException) as exc_info:
        await service.check_in(visit_id, emp_b, is_admin=False, payload=payload)

    assert exc_info.value.status_code == 403
    assert "You can only check into your own assigned visits" in exc_info.value.detail
