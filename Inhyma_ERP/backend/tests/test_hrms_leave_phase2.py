"""
HRMS Leave Management Phase 2 Tests.

Validates all 14 Phase 2 requirements:
1. Employee can create leave request
2. Employee cannot create request for another employee
3. Invalid date range rejected
4. Leave type not applicable rejected
5. Insufficient balance rejected
6. Leave Without Pay does not require paid balance
7. Maximum consecutive days enforced
8. Overlapping PENDING request rejected
9. Overlapping APPROVED request rejected
10. REJECTED request does not incorrectly consume balance
11. New PENDING request does not consume balance
12. Employee can cancel PENDING request
13. Employee cannot cancel APPROVED request
14. Leave request appears in employee's own list
Plus attachment upload and employee data isolation security.
"""

from __future__ import annotations

import uuid
from datetime import date
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.auth.security import create_access_token
from app.database.engine import get_sessionmaker
from app.hrms.models import (
    HrmsEmployeeLeaveBalance,
    HrmsLeavePlan,
    HrmsLeavePlanType,
    HrmsLeaveRequest,
    HrmsLeaveType,
)
from app.users.models import User, UserStatus


@pytest.mark.asyncio
async def test_hrms_leave_phase2_comprehensive_workflow(client: AsyncClient):
    sessionmaker = get_sessionmaker()

    # 1. Create two regular employee users without admin roles
    emp1_id = uuid.uuid4()
    emp2_id = uuid.uuid4()
    emp1_email = f"emp1.{uuid.uuid4().hex[:6]}@inhyma.com"
    emp2_email = f"emp2.{uuid.uuid4().hex[:6]}@inhyma.com"

    async with sessionmaker() as session:
        user1 = User(
            id=emp1_id,
            email=emp1_email,
            username=f"emp1_{uuid.uuid4().hex[:6]}",
            first_name="Rohan",
            last_name="Sharma",
            employee_code=f"EMP_{uuid.uuid4().hex[:4]}",
            password_hash="mock_hash",
            has_login=True,
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        user2 = User(
            id=emp2_id,
            email=emp2_email,
            username=f"emp2_{uuid.uuid4().hex[:6]}",
            first_name="Pooja",
            last_name="Patil",
            employee_code=f"EMP_{uuid.uuid4().hex[:4]}",
            password_hash="mock_hash",
            has_login=True,
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        session.add_all([user1, user2])
        await session.commit()

    token1 = create_access_token(emp1_id).token
    token2 = create_access_token(emp2_id).token
    headers1 = {"Authorization": f"Bearer {token1}"}
    headers2 = {"Authorization": f"Bearer {token2}"}

    # Fetch applicable leave types for emp1
    types_res = await client.get("/api/v1/hrms/leave/applicable-types", headers=headers1)
    assert types_res.status_code == 200, types_res.text
    types_data = types_res.json()["data"]
    assert len(types_data) > 0

    casual_lt = next((t for t in types_data if t["name"] == "Casual Leave"), None)
    assert casual_lt is not None
    cl_id = casual_lt["id"]

    lwp_lt = next((t for t in types_data if t["name"] == "Leave Without Pay"), None)
    assert lwp_lt is not None
    lwp_id = lwp_lt["id"]

    # Initialize / fetch balances for emp1
    bal_res1 = await client.get("/api/v1/hrms/leave/balances?year=2026", headers=headers1)
    assert bal_res1.status_code == 200
    bal1 = next(b for b in bal_res1.json()["data"] if b["leave_type_id"] == cl_id)
    initial_available = bal1["available"]
    initial_consumed = bal1["consumed"]
    assert initial_available >= 3.0

    # -----------------------------------------------------------------------
    # Requirement 1 & 11: Employee can create leave request & PENDING does NOT consume balance
    # -----------------------------------------------------------------------
    req1_payload = {
        "leave_type_id": cl_id,
        "from_date": "2026-10-05",  # Monday
        "to_date": "2026-10-07",    # Wednesday (3 working days)
        "reason": "Personal medical appointment and rest",
        "attachment": "https://storage.inhyma.com/leave/med1.pdf",
    }
    create_res = await client.post("/api/v1/hrms/leave/requests", json=req1_payload, headers=headers1)
    assert create_res.status_code == 201, create_res.text
    req1 = create_res.json()["data"]
    req1_id = req1["id"]
    assert req1["status"] == "PENDING"
    assert req1["approval_status"] == "PENDING"
    assert req1["number_of_days"] == 3.0
    assert req1["attachment"] == req1_payload["attachment"]

    # Requirement 11: Balance remains completely unchanged for PENDING request
    bal_res_after = await client.get("/api/v1/hrms/leave/balances?year=2026", headers=headers1)
    bal1_after = next(b for b in bal_res_after.json()["data"] if b["leave_type_id"] == cl_id)
    assert bal1_after["consumed"] == initial_consumed
    assert bal1_after["available"] == initial_available

    # -----------------------------------------------------------------------
    # Requirement 2: Employee cannot create request for another employee (HTTP 403)
    # -----------------------------------------------------------------------
    rogue_payload = {
        "leave_type_id": cl_id,
        "from_date": "2026-10-12",
        "to_date": "2026-10-13",
        "reason": "Impersonation test",
    }
    rogue_res = await client.post(
        f"/api/v1/hrms/leave/requests?employee_id={emp2_id}",
        json=rogue_payload,
        headers=headers1,
    )
    assert rogue_res.status_code == 403

    # Employee cannot view another employee's balances
    bal_rogue_res = await client.get(
        f"/api/v1/hrms/leave/balances?employee_id={emp2_id}&year=2026",
        headers=headers1,
    )
    assert bal_rogue_res.status_code == 403

    # -----------------------------------------------------------------------
    # Requirement 3: Invalid date range rejected (from_date > to_date)
    # -----------------------------------------------------------------------
    invalid_dates_payload = {
        "leave_type_id": cl_id,
        "from_date": "2026-10-20",
        "to_date": "2026-10-18",
        "reason": "Invalid dates test",
    }
    invalid_res = await client.post("/api/v1/hrms/leave/requests", json=invalid_dates_payload, headers=headers1)
    assert invalid_res.status_code == 400
    assert "From Date cannot be after To Date" in invalid_res.text

    # -----------------------------------------------------------------------
    # Requirement 4: Leave type not applicable rejected
    # -----------------------------------------------------------------------
    # Create an unassigned leave type not in any active plan for emp1
    unassigned_lt_payload = {
        "name": f"Unassigned Quota {uuid.uuid4().hex[:6]}",
        "code": "UQ",
        "leave_type": "REGULAR",
        "is_paid": True,
        "annual_balance": 5.0,
        "is_active": True,
    }
    unassigned_res = await client.post("/api/v1/hrms/leave/types", json=unassigned_lt_payload)
    assert unassigned_res.status_code == 201
    unassigned_id = unassigned_res.json()["data"]["id"]

    not_app_payload = {
        "leave_type_id": unassigned_id,
        "from_date": "2026-10-15",
        "to_date": "2026-10-16",
        "reason": "Not applicable test",
    }
    not_app_res = await client.post("/api/v1/hrms/leave/requests", json=not_app_payload, headers=headers1)
    assert not_app_res.status_code == 400
    assert "This leave type is not currently available under your active leave plan." in not_app_res.text

    # -----------------------------------------------------------------------
    # Requirement 5: Insufficient balance rejected
    # -----------------------------------------------------------------------
    # Artificially set Casual Leave balance to 1 day for emp2
    await client.get("/api/v1/hrms/leave/balances?year=2026", headers=headers2)
    async with sessionmaker() as session:
        emp2_cl_bal = await session.scalar(
            select(HrmsEmployeeLeaveBalance).where(
                HrmsEmployeeLeaveBalance.employee_id == emp2_id,
                HrmsEmployeeLeaveBalance.leave_type_id == cl_id,
                HrmsEmployeeLeaveBalance.year == 2026,
            )
        )
        if emp2_cl_bal:
            emp2_cl_bal.allocated = 1.0
            emp2_cl_bal.consumed = 0.0
            emp2_cl_bal.adjusted = 0.0
            await session.commit()

    insufficient_payload = {
        "leave_type_id": cl_id,
        "from_date": "2026-10-12",  # Monday
        "to_date": "2026-10-14",    # Wednesday = 3 days > 1 day available
        "reason": "Asking for more than available",
    }
    insufficient_res = await client.post("/api/v1/hrms/leave/requests", json=insufficient_payload, headers=headers2)
    assert insufficient_res.status_code == 400
    assert "Insufficient Casual Leave balance. Available: 1 days." in insufficient_res.text

    # -----------------------------------------------------------------------
    # Requirement 6: Leave Without Pay does not require paid balance
    # -----------------------------------------------------------------------
    lwp_payload = {
        "leave_type_id": lwp_id,
        "from_date": "2026-10-12",
        "to_date": "2026-10-14",
        "reason": "Approved leave without pay test",
    }
    lwp_res = await client.post("/api/v1/hrms/leave/requests", json=lwp_payload, headers=headers2)
    assert lwp_res.status_code == 201, lwp_res.text
    assert lwp_res.json()["data"]["status"] == "PENDING"

    # -----------------------------------------------------------------------
    # Requirement 7: Maximum consecutive days enforced
    # -----------------------------------------------------------------------
    # Casual Leave max_consecutive_days = 3
    excessive_consec_payload = {
        "leave_type_id": cl_id,
        "from_date": "2026-10-19",  # Monday
        "to_date": "2026-10-23",    # Friday = 5 working days > 3 max consecutive
        "reason": "Excessive consecutive days test",
    }
    consec_res = await client.post("/api/v1/hrms/leave/requests", json=excessive_consec_payload, headers=headers1)
    assert consec_res.status_code == 400
    assert "Maximum 3 consecutive days are allowed for Casual Leave." in consec_res.text

    # -----------------------------------------------------------------------
    # Requirement 8: Overlapping PENDING request rejected
    # -----------------------------------------------------------------------
    # req1 is 2026-10-05 to 2026-10-07 (PENDING)
    overlap_pending_payload = {
        "leave_type_id": cl_id,
        "from_date": "2026-10-06",
        "to_date": "2026-10-08",
        "reason": "Overlapping pending",
    }
    overlap_res1 = await client.post("/api/v1/hrms/leave/requests", json=overlap_pending_payload, headers=headers1)
    assert overlap_res1.status_code == 400
    assert "already have an overlapping leave request" in overlap_res1.text

    # -----------------------------------------------------------------------
    # Requirement 9 & 10: Overlapping APPROVED rejected & REJECTED does not consume balance
    # -----------------------------------------------------------------------
    # Approve a separate request for emp1 on 2026-11-02 -> 2026-11-03
    approved_test_payload = {
        "leave_type_id": cl_id,
        "from_date": "2026-11-02",
        "to_date": "2026-11-03",
        "reason": "To be approved",
    }
    app_test_res = await client.post("/api/v1/hrms/leave/requests", json=approved_test_payload, headers=headers1)
    assert app_test_res.status_code == 201
    approved_req_id = app_test_res.json()["data"]["id"]

    # Admin approves it
    app_res = await client.patch(
        f"/api/v1/hrms/leave/approvals/{approved_req_id}/approve",
        json={"approval_remarks": "Approved by HR"},
    )
    assert app_res.status_code == 200

    # Overlapping with APPROVED request is blocked
    overlap_approved_payload = {
        "leave_type_id": cl_id,
        "from_date": "2026-11-03",
        "to_date": "2026-11-04",
        "reason": "Overlapping approved",
    }
    overlap_res2 = await client.post("/api/v1/hrms/leave/requests", json=overlap_approved_payload, headers=headers1)
    assert overlap_res2.status_code == 400
    assert "already have an overlapping leave request" in overlap_res2.text

    # Requirement 10: Rejected request does not consume balance
    bal_before_reject = (
        await client.get("/api/v1/hrms/leave/balances?year=2026", headers=headers1)
    ).json()["data"]
    cl_before_rej = next(b for b in bal_before_reject if b["leave_type_id"] == cl_id)

    to_reject_payload = {
        "leave_type_id": cl_id,
        "from_date": "2026-11-16",
        "to_date": "2026-11-17",
        "reason": "To be rejected",
    }
    rej_req_res = await client.post("/api/v1/hrms/leave/requests", json=to_reject_payload, headers=headers1)
    rej_req_id = rej_req_res.json()["data"]["id"]

    await client.patch(
        f"/api/v1/hrms/leave/approvals/{rej_req_id}/reject",
        json={"approval_remarks": "Rejection test"},
    )

    bal_after_reject = (
        await client.get("/api/v1/hrms/leave/balances?year=2026", headers=headers1)
    ).json()["data"]
    cl_after_rej = next(b for b in bal_after_reject if b["leave_type_id"] == cl_id)
    assert cl_after_rej["consumed"] == cl_before_rej["consumed"]
    assert cl_after_rej["available"] == cl_before_rej["available"]

    # -----------------------------------------------------------------------
    # Requirement 12: Employee can cancel PENDING request
    # -----------------------------------------------------------------------
    cancel_res = await client.patch(f"/api/v1/hrms/leave/requests/{req1_id}/cancel", headers=headers1)
    assert cancel_res.status_code == 200, cancel_res.text
    cancelled_data = cancel_res.json()["data"]
    assert cancelled_data["status"] == "CANCELLED"
    assert cancelled_data["approval_status"] == "CANCELLED"

    # Verify still in history
    single_res = await client.get(f"/api/v1/hrms/leave/requests/{req1_id}", headers=headers1)
    assert single_res.status_code == 200
    assert single_res.json()["data"]["status"] == "CANCELLED"

    # -----------------------------------------------------------------------
    # Requirement 13: Employee cannot cancel APPROVED request
    # -----------------------------------------------------------------------
    cancel_approved_res = await client.patch(
        f"/api/v1/hrms/leave/requests/{approved_req_id}/cancel",
        headers=headers1,
    )
    assert cancel_approved_res.status_code == 400
    assert "Cannot cancel an approved leave request" in cancel_approved_res.text

    # Employee cannot cancel another employee's request
    other_cancel_res = await client.patch(
        f"/api/v1/hrms/leave/requests/{rej_req_id}/cancel",
        headers=headers2,
    )
    assert other_cancel_res.status_code == 403

    # -----------------------------------------------------------------------
    # Requirement 14: Leave request appears in employee's own list only
    # -----------------------------------------------------------------------
    my_list_res = await client.get("/api/v1/hrms/leave/requests", headers=headers1)
    assert my_list_res.status_code == 200
    emp1_ids = [r["id"] for r in my_list_res.json()["data"]]
    assert req1_id in emp1_ids
    assert approved_req_id in emp1_ids

    # Emp2's list does not contain emp1's requests
    other_list_res = await client.get("/api/v1/hrms/leave/requests", headers=headers2)
    assert other_list_res.status_code == 200
    emp2_ids = [r["id"] for r in other_list_res.json()["data"]]
    assert req1_id not in emp2_ids
    assert approved_req_id not in emp2_ids

    # -----------------------------------------------------------------------
    # Attachment upload test
    # -----------------------------------------------------------------------
    test_file_content = b"%PDF-1.4 simulated pdf test content for leave attachment"
    upload_res = await client.post(
        "/api/v1/hrms/leave/upload-attachment",
        files={"file": ("medical_cert.pdf", test_file_content, "application/pdf")},
        headers=headers1,
    )
    assert upload_res.status_code == 200
    upload_data = upload_res.json()["data"]
    assert "file_url" in upload_data
    assert upload_data["file_name"] == "medical_cert.pdf"
