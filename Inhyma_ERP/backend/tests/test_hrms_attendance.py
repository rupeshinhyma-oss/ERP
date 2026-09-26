"""
Tests for HRMS Attendance Module (Day 3).

Validates:
- Configurable Attendance Policy (defaults & updates)
- Assigned Office Resolution (Inhyma Thane Office)
- Punch inside geofence (allowed)
- Punch outside geofence (blocked)
- Duplicate Punch In blocked
- Policy time checks:
    - 10:44 AM -> PRESENT
    - 10:46 AM -> LATE
    - 11:31 AM -> HALF_DAY
- Punch Out & Working session calculation
- Attendance lock (duplicate punch out blocked)
- Monthly Calendar & selective regularization rule:
    - Normal PRESENT has can_regularize = False
    - Irregular/Late/Half-day/Missing has can_regularize = True
- Regularization request submission
"""

import uuid
from datetime import datetime, timezone
import pytest
from httpx import AsyncClient

from app.database.engine import get_sessionmaker
from app.hrms.models import HrmsAttendance
from sqlalchemy import delete

# Thane office coordinates
THANE_LAT = 19.199824
THANE_LNG = 72.956795

# 500 meters outside Thane office
OUTSIDE_LAT = 19.204320
OUTSIDE_LNG = 72.956795


@pytest.mark.asyncio
async def test_attendance_policy_flow(client: AsyncClient):
    # 1. Fetch default policy
    res = await client.get("/api/v1/hrms/attendance/policy")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["shift_start_time"] == "10:30"
    assert data["shift_end_time"] == "19:00"
    assert data["grace_period_minutes"] == 15
    assert data["half_day_threshold_minutes"] == 60
    assert data["geofence_radius_meters"] == 150.0

    # 2. Update policy
    put_res = await client.put(
        "/api/v1/hrms/attendance/policy",
        json={"grace_period_minutes": 20, "half_day_threshold_minutes": 75},
    )
    assert put_res.status_code == 200
    updated = put_res.json()["data"]
    assert updated["grace_period_minutes"] == 20
    assert updated["half_day_threshold_minutes"] == 75

    # Revert back to standard Day 3 defaults
    await client.put(
        "/api/v1/hrms/attendance/policy",
        json={"grace_period_minutes": 15, "half_day_threshold_minutes": 60},
    )


@pytest.mark.asyncio
async def test_assigned_office(client: AsyncClient):
    res = await client.get("/api/v1/hrms/attendance/assigned-office")
    assert res.status_code == 200
    data = res.json()["data"]
    assert "Thane" in data["name"]
    assert data["radius_meters"] == 150.0
    assert abs(data["latitude"] - THANE_LAT) < 0.001
    assert abs(data["longitude"] - THANE_LNG) < 0.001


@pytest.mark.asyncio
async def test_punch_geofence_enforcement(client: AsyncClient):
    # 1. Punch outside geofence (blocked)
    outside_payload = {
        "latitude": OUTSIDE_LAT,
        "longitude": OUTSIDE_LNG,
        "timestamp": "2026-09-26T05:00:00Z",  # 10:30 AM IST
    }
    res_outside = await client.post("/api/v1/hrms/attendance/punch-in", json=outside_payload)
    assert res_outside.status_code == 400
    assert "Outside geofence" in res_outside.json()["message"]


@pytest.mark.asyncio
async def test_policy_status_calculations(client: AsyncClient):
    # Reset attendance records for test repeatability
    maker = get_sessionmaker()
    async with maker() as session:
        await session.execute(delete(HrmsAttendance))
        await session.commit()

    # Test 10:44 AM IST -> PRESENT (within 15 min grace of 10:30 AM)
    # 10:44 AM IST is 05:14 UTC
    t_10_44 = "2026-09-27T05:14:00Z"
    res_1 = await client.post(
        "/api/v1/hrms/attendance/punch-in",
        json={"latitude": THANE_LAT, "longitude": THANE_LNG, "timestamp": t_10_44},
    )
    assert res_1.status_code == 201
    rec_1 = res_1.json()["data"]
    assert rec_1["status"] == "PRESENT"
    assert rec_1["late_minutes"] == 0
    assert rec_1["is_irregular"] is False
    assert rec_1["can_regularize"] is False

    # Test Duplicate Punch In blocked
    res_dup = await client.post(
        "/api/v1/hrms/attendance/punch-in",
        json={"latitude": THANE_LAT, "longitude": THANE_LNG, "timestamp": t_10_44},
    )
    assert res_dup.status_code == 400
    assert "Already punched in" in res_dup.json()["message"]

    # Test Punch Out on same day
    # Punch out at 19:15 IST (after shift end 19:00 -> no early exit)
    t_19_15 = "2026-09-27T13:45:00Z"
    res_out = await client.post(
        "/api/v1/hrms/attendance/punch-out",
        json={"latitude": THANE_LAT, "longitude": THANE_LNG, "timestamp": t_19_15},
    )
    assert res_out.status_code == 200
    out_data = res_out.json()["data"]
    assert out_data["punch_out"] is not None
    assert out_data["working_minutes"] > 0
    assert out_data["early_exit_minutes"] == 0

    # Duplicate Punch Out blocked (Attendance locked)
    res_out_dup = await client.post(
        "/api/v1/hrms/attendance/punch-out",
        json={"latitude": THANE_LAT, "longitude": THANE_LNG, "timestamp": t_19_15},
    )
    assert res_out_dup.status_code == 400
    assert "already punched out" in res_out_dup.json()["message"].lower()

    # Test 10:46 AM IST -> LATE (after 10:45 AM, 16 mins late)
    # 10:46 AM IST is 05:16 UTC
    t_10_46 = "2026-09-28T05:16:00Z"
    res_2 = await client.post(
        "/api/v1/hrms/attendance/punch-in",
        json={"latitude": THANE_LAT, "longitude": THANE_LNG, "timestamp": t_10_46},
    )
    assert res_2.status_code == 201
    rec_2 = res_2.json()["data"]
    assert rec_2["status"] == "LATE"
    assert rec_2["late_minutes"] == 16
    assert rec_2["is_irregular"] is True
    assert rec_2["can_regularize"] is True

    # Test 11:31 AM IST -> HALF_DAY (after 11:30 AM)
    # 11:31 AM IST is 06:01 UTC
    t_11_31 = "2026-09-29T06:01:00Z"
    res_3 = await client.post(
        "/api/v1/hrms/attendance/punch-in",
        json={"latitude": THANE_LAT, "longitude": THANE_LNG, "timestamp": t_11_31},
    )
    assert res_3.status_code == 201
    rec_3 = res_3.json()["data"]
    assert rec_3["status"] == "HALF_DAY"
    assert rec_3["is_irregular"] is True
    assert rec_3["can_regularize"] is True


@pytest.mark.asyncio
async def test_calendar_and_regularization(client: AsyncClient):
    # 1. Fetch calendar for September 2026
    res = await client.get("/api/v1/hrms/attendance/calendar?year=2026&month=9")
    assert res.status_code == 200
    calendar_days = res.json()["data"]
    assert len(calendar_days) == 30

    # 2. Check 2026-09-27 (PRESENT record) -> can_regularize MUST be False
    day_27 = next(d for d in calendar_days if d["date"] == "2026-09-27")
    assert day_27["status"] == "PRESENT"
    assert day_27["can_regularize"] is False

    # 3. Check 2026-09-28 (LATE record) -> can_regularize MUST be True
    day_28 = next(d for d in calendar_days if d["date"] == "2026-09-28")
    assert day_28["status"] == "LATE"
    assert day_28["can_regularize"] is True

    # 4. Submit regularization request for day 28
    reg_payload = {
        "date": "2026-09-28",
        "reason": "Traffic congestion on Eastern Express Highway",
        "note": "Train was delayed by 25 minutes",
    }
    reg_res = await client.post("/api/v1/hrms/attendance/regularization", json=reg_payload)
    assert reg_res.status_code == 200
    reg_data = reg_res.json()["data"]
    assert reg_data["regularization_status"] == "PENDING"
    assert reg_data["regularization_reason"] == "Traffic congestion on Eastern Express Highway"

    # 5. Verify calendar reflects PENDING regularization
    cal_res_again = await client.get("/api/v1/hrms/attendance/calendar?year=2026&month=9")
    day_28_again = next(d for d in cal_res_again.json()["data"] if d["date"] == "2026-09-28")
    assert day_28_again["regularization_status"] == "PENDING"


@pytest.mark.asyncio
async def test_regularization_approval_and_rejection_workflow(client: AsyncClient):
    """
    Test complete lifecycle of attendance regularization:
    1. Employee submits Late Punch regularization via /regularize
    2. Request is retrieved via GET /regularizations
    3. Supervisor approves request via PATCH /regularizations/{id}/approve
    4. Calendar and attendance status update to PRESENT/APPROVED
    5. Missing punch submission and rejection (Mark LOP) via PATCH /regularizations/{id}/reject
    6. Admin direct regularization workflow
    """
    # 1. Submit Late Punch via /regularize
    submit_payload = {
        "date": "2026-09-28",
        "request_type": "LATE_PUNCH",
        "reason": "Severe rainfall and local train disruption",
        "notes": "Arrived at office at 11:15 AM after train delay",
    }
    submit_res = await client.post("/api/v1/hrms/attendance/regularize", json=submit_payload)
    assert submit_res.status_code == 200
    req_data = submit_res.json()["data"]
    req_id = req_data["id"]
    assert req_data["status"] == "PENDING"
    assert req_data["request_type"] == "LATE_PUNCH"
    assert req_data["attendance_date"] == "2026-09-28"

    # 2. List regularizations
    list_res = await client.get("/api/v1/hrms/attendance/regularizations?status=PENDING")
    assert list_res.status_code == 200
    pending_list = list_res.json()["data"]
    assert any(r["id"] == req_id for r in pending_list)

    # 3. Approve regularization
    approve_res = await client.patch(
        f"/api/v1/hrms/attendance/regularizations/{req_id}/approve",
        json={"action": "APPROVE", "manager_remarks": "Approved. Delay verified with transit advisory."},
    )
    assert approve_res.status_code == 200
    approved_data = approve_res.json()["data"]
    assert approved_data["status"] == "APPROVED"
    assert approved_data["manager_remarks"] == "Approved. Delay verified with transit advisory."

    # 4. Verify calendar updated to APPROVED
    cal_res = await client.get("/api/v1/hrms/attendance/calendar?year=2026&month=9")
    day_28 = next(d for d in cal_res.json()["data"] if d["date"] == "2026-09-28")
    assert day_28["regularization_status"] == "APPROVED"

    # 5. Submit Missing Punch for 2026-09-20 and Reject (Mark LOP)
    miss_payload = {
        "date": "2026-09-20",
        "request_type": "MISSING_PUNCH",
        "reason": "Forgot badge and failed mobile punch",
        "notes": "Was in office whole day",
    }
    miss_res = await client.post("/api/v1/hrms/attendance/regularize", json=miss_payload)
    assert miss_res.status_code == 200
    miss_id = miss_res.json()["data"]["id"]

    reject_res = await client.patch(
        f"/api/v1/hrms/attendance/regularizations/{miss_id}/reject",
        json={"action": "REJECT_LOP", "manager_remarks": "No badge entry found in security turnstile. Marked LOP."},
    )
    assert reject_res.status_code == 200
    assert reject_res.json()["data"]["status"] == "REJECTED"

    # 6. Admin Direct Regularization workflow
    direct_payload = {
        "date": "2026-09-21",
        "request_type": "WORK_FROM_HOME",
        "reason": "Client onsite escalation",
        "notes": "Directly approved by HR admin",
        "direct_regularize": True,
    }
    direct_res = await client.post("/api/v1/hrms/attendance/regularize", json=direct_payload)
    assert direct_res.status_code == 200
    direct_data = direct_res.json()["data"]
    assert direct_data["status"] == "APPROVED"
    assert direct_data["action_taken"] == "DIRECT_REGULARIZE"


@pytest.mark.asyncio
async def test_day_3_5_attendance_policy_engine(client: AsyncClient):
    """
    Day 3.5: Attendance Policy Engine Configurable Tests.
    Verifies full policy editing, automatic grace and late start calculation,
    and PostgreSQL persistence.
    """
    # 1. Update policy with complete Day 3.5 configuration
    update_payload = {
        "shift_name": "Inhyma General Shift",
        "shift_start_time": "10:30",
        "shift_end_time": "19:00",
        "weekly_off": "Sunday",
        "payroll_cycle": "1st-End of Month",
        "geofence_radius_meters": 150.0,
        "enable_grace": True,
        "grace_period_minutes": 15,
        "enable_late_marks": True,
        "count_late_monthly": True,
        "monthly_late_limit": 3,
        "third_late_action": "Half Day",
        "enable_direct_half_day": True,
        "direct_half_day_time": "11:31",
        "enable_early_exit": True,
        "early_exit_buffer_minutes": 15,
        "mark_early_exit": True,
        "auto_regularization_early_exit": True,
        "missing_punch_out": True,
        "missing_punch_in": True,
        "auto_mark_irregular": True,
        "require_regularization": True,
        "consecutive_late_warning": False,
        "auto_email_notification": True,
        "auto_manager_notification": True,
    }
    put_res = await client.put("/api/v1/hrms/attendance/policy", json=update_payload)
    assert put_res.status_code == 200
    p = put_res.json()["data"]
    assert p["shift_name"] == "Inhyma General Shift"
    assert p["shift_start_time"] == "10:30"
    assert p["grace_period_minutes"] == 15
    assert p["grace_end_time"] == "10:45"
    assert p["late_start_time"] == "10:46"
    assert p["monthly_late_limit"] == 3
    assert p["third_late_action"] == "Half Day"
    assert p["direct_half_day_time"] == "11:31"
    assert p["weekly_off"] == "Sunday"

    # 2. Verify GET reflects persisted values
    get_res = await client.get("/api/v1/hrms/attendance/policy")
    assert get_res.status_code == 200
    fetched = get_res.json()["data"]
    assert fetched["shift_name"] == "Inhyma General Shift"
    assert fetched["grace_end_time"] == "10:45"
    assert fetched["late_start_time"] == "10:46"
    assert fetched["weekly_off"] == "Sunday"


@pytest.mark.asyncio
async def test_day_3_5_weekly_off_calendar_logic(client: AsyncClient):
    """
    Day 3.5: Fix Weekend Logic.
    Saturday must NOT be a weekend when policy weekly_off is 'Sunday'.
    Only Sunday is marked as WEEKEND.
    """
    # Ensure policy weekly_off is Sunday only
    await client.put("/api/v1/hrms/attendance/policy", json={"weekly_off": "Sunday"})

    # Clean attendance records for clean calendar view
    maker = get_sessionmaker()
    async with maker() as session:
        await session.execute(delete(HrmsAttendance))
        await session.commit()

    # In September 2026:
    # 2026-09-05 is Saturday
    # 2026-09-06 is Sunday
    cal_res = await client.get("/api/v1/hrms/attendance/calendar?year=2026&month=9")
    assert cal_res.status_code == 200
    days = cal_res.json()["data"]

    sat_day = next(d for d in days if d["date"] == "2026-09-05")
    sun_day = next(d for d in days if d["date"] == "2026-09-06")

    # Saturday must NOT be WEEKEND (it is a normal working day)
    assert sat_day["status"] != "WEEKEND"
    # Sunday MUST be WEEKEND
    assert sun_day["status"] == "WEEKEND"


@pytest.mark.asyncio
async def test_day_3_5_monthly_late_counter_and_third_late(client: AsyncClient):
    """
    Day 3.5: Monthly Late Counter & Third Late Conversion.
    1st late -> LATE
    2nd late -> LATE
    3rd late -> HALF_DAY
    Direct punch at 11:31 -> HALF_DAY (does not increment monthly late counter)
    """
    maker = get_sessionmaker()
    async with maker() as session:
        await session.execute(delete(HrmsAttendance))
        await session.commit()

    # Policy: monthly_late_limit = 3, third_late_action = "Half Day"
    await client.put(
        "/api/v1/hrms/attendance/policy",
        json={"monthly_late_limit": 3, "third_late_action": "Half Day", "enable_late_marks": True},
    )

    # Late punch #1: 2026-09-02 at 10:46 AM IST (05:16 UTC)
    res_1 = await client.post(
        "/api/v1/hrms/attendance/punch-in",
        json={"latitude": THANE_LAT, "longitude": THANE_LNG, "timestamp": "2026-09-02T05:16:00Z"},
    )
    assert res_1.status_code == 201
    assert res_1.json()["data"]["status"] == "LATE"

    # Late punch #2: 2026-09-03 at 10:46 AM IST
    res_2 = await client.post(
        "/api/v1/hrms/attendance/punch-in",
        json={"latitude": THANE_LAT, "longitude": THANE_LNG, "timestamp": "2026-09-03T05:16:00Z"},
    )
    assert res_2.status_code == 201
    assert res_2.json()["data"]["status"] == "LATE"

    # Late punch #3: 2026-09-04 at 10:46 AM IST -> Must trigger Third Late Action -> HALF_DAY!
    res_3 = await client.post(
        "/api/v1/hrms/attendance/punch-in",
        json={"latitude": THANE_LAT, "longitude": THANE_LNG, "timestamp": "2026-09-04T05:16:00Z"},
    )
    assert res_3.status_code == 201
    assert res_3.json()["data"]["status"] == "HALF_DAY"
    assert res_3.json()["data"]["is_irregular"] is True


@pytest.mark.asyncio
async def test_day_3_5_regularization_with_timings(client: AsyncClient):
    """
    Day 3.5: Regularization includes Punch In, Punch Out, Total Hours,
    and reflects them in Approval and Calendar.
    """
    payload = {
        "date": "2026-09-15",
        "request_type": "LATE_PUNCH",
        "reason": "Traffic Delay",
        "notes": "Highway heavy traffic due to vehicle breakdown",
        "punch_in": "10:52 AM",
        "punch_out": "07:01 PM",
        "total_hours": "8h09m",
    }
    submit_res = await client.post("/api/v1/hrms/attendance/regularize", json=payload)
    assert submit_res.status_code == 200
    data = submit_res.json()["data"]
    req_id = data["id"]
    assert data["punch_in"] == "10:52 AM"
    assert data["punch_out"] == "07:01 PM"
    assert data["total_hours"] == "8h09m"
    assert data["status"] == "PENDING"

    # List regularizations - verify columns
    list_res = await client.get("/api/v1/hrms/attendance/regularizations?status=PENDING")
    assert list_res.status_code == 200
    item = next(r for r in list_res.json()["data"] if r["id"] == req_id)
    assert item["punch_in"] == "10:52 AM"
    assert item["punch_out"] == "07:01 PM"
    assert item["total_hours"] == "8h09m"

    # Approve with manager remarks
    approve_res = await client.patch(
        f"/api/v1/hrms/attendance/regularizations/{req_id}/approve",
        json={"action": "APPROVE", "manager_remarks": "Traffic verified, approved."},
    )
    assert approve_res.status_code == 200
    approved = approve_res.json()["data"]
    assert approved["status"] == "APPROVED"
    assert approved["manager_remarks"] == "Traffic verified, approved."

    # Verify linked calendar day
    cal_res = await client.get("/api/v1/hrms/attendance/calendar?year=2026&month=9")
    day_15 = next(d for d in cal_res.json()["data"] if d["date"] == "2026-09-15")
    assert day_15["regularization_status"] == "APPROVED"
    assert day_15["status"] == "PRESENT"
    # Approved day should NOT show edit icon
    assert day_15["can_regularize"] is False

