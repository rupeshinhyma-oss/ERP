"""
HRMS Expense Management Functional Integration Tests.

Validates the complete expense lifecycle:
1. Create draft (status=DRAFT)
2. Draft persists in database across fetches
3. Submit expense (status=PENDING, submitted_at set)
4. Pending persists in database
5. Employee cannot access another employee's expense claim (403 Forbidden)
6. Admin sees pending expense in approvals view
7. Admin approves pending expense claim (status=APPROVED, reviewed_by and reviewed_at set)
8. Approved status persists
9. Admin rejects pending expense claim (status=REJECTED)
10. Rejection reason is required (empty reason returns 400/422)
11. Rejected status and reason persist
12. Reimbursed status and reimbursement notes persist (status=REIMBURSED)
13. Invalid amount (<= 0) rejected
14. Unauthorized approval rejected (employee cannot approve, cannot self-approve)
"""

from datetime import date, datetime, timezone
import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.auth.security import create_access_token
from app.database.engine import get_sessionmaker
from app.hrms.models import HrmsExpense
from app.users.models import User, UserStatus


@pytest.mark.asyncio
async def test_hrms_expense_full_workflow(client: AsyncClient):
    sessionmaker = get_sessionmaker()

    # 1. Setup Admin, Employee A, and Employee B in users table
    admin_id = uuid.uuid4()
    emp_a_id = uuid.uuid4()
    emp_b_id = uuid.uuid4()

    async with sessionmaker() as session:
        admin_user = User(
            id=admin_id,
            email=f"admin.{uuid.uuid4().hex[:6]}@example.com",
            username=f"admin_{uuid.uuid4().hex[:6]}",
            first_name="Expense",
            last_name="Admin",
            password_hash="mock_hash",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        session.add(admin_user)

        emp_a = User(
            id=emp_a_id,
            email=f"emp.a.{uuid.uuid4().hex[:6]}@example.com",
            username=f"emp_a_{uuid.uuid4().hex[:4]}",
            first_name="Ravi",
            last_name="Sharma",
            employee_code=f"EMP-EXP-{uuid.uuid4().hex[:4]}",
            password_hash="mock_hash",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        session.add(emp_a)

        emp_b = User(
            id=emp_b_id,
            email=f"emp.b.{uuid.uuid4().hex[:6]}@example.com",
            username=f"emp_b_{uuid.uuid4().hex[:4]}",
            first_name="Anita",
            last_name="Patel",
            employee_code=f"EMP-EXP-{uuid.uuid4().hex[:4]}",
            password_hash="mock_hash",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        session.add(emp_b)
        await session.commit()

    admin_token = create_access_token(admin_id, permissions=["*"]).token
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    emp_a_token = create_access_token(emp_a_id, permissions=[]).token
    emp_a_headers = {"Authorization": f"Bearer {emp_a_token}"}

    emp_b_token = create_access_token(emp_b_id, permissions=[]).token
    emp_b_headers = {"Authorization": f"Bearer {emp_b_token}"}

    created_expense_ids = []

    try:
        # -------------------------------------------------------------------
        # 1. Create Draft
        # -------------------------------------------------------------------
        draft_payload = {
            "expense_date": str(date.today()),
            "category": "Travel",
            "amount": 500.0,
            "description": "Client site visit cab fare",
            "is_submit": False,
        }
        res = await client.post("/api/v1/hrms/expenses", json=draft_payload, headers=emp_a_headers)
        assert res.status_code == 201, f"Create draft failed: {res.text}"
        data = res.json()["data"]
        exp_1_id = data["id"]
        created_expense_ids.append(exp_1_id)
        assert data["status"] == "DRAFT"
        assert data["amount"] == 500.0
        assert data["category"] == "Travel"
        assert data["expense_code"].startswith("EXP-")

        # -------------------------------------------------------------------
        # 2. Draft Persists
        # -------------------------------------------------------------------
        res_get = await client.get(f"/api/v1/hrms/expenses/{exp_1_id}", headers=emp_a_headers)
        assert res_get.status_code == 200
        assert res_get.json()["data"]["status"] == "DRAFT"
        assert res_get.json()["data"]["amount"] == 500.0

        # Verify directly in PostgreSQL
        async with sessionmaker() as session:
            db_exp = await session.get(HrmsExpense, uuid.UUID(exp_1_id))
            assert db_exp is not None
            assert db_exp.status == "DRAFT"
            assert db_exp.employee_id == emp_a_id

        # -------------------------------------------------------------------
        # 3. Submit
        # -------------------------------------------------------------------
        res_submit = await client.post(f"/api/v1/hrms/expenses/{exp_1_id}/submit", headers=emp_a_headers)
        assert res_submit.status_code == 200, f"Submit failed: {res_submit.text}"
        assert res_submit.json()["data"]["status"] == "PENDING"
        assert res_submit.json()["data"]["submitted_at"] is not None

        # -------------------------------------------------------------------
        # 4. Pending Persists
        # -------------------------------------------------------------------
        res_get_pending = await client.get(f"/api/v1/hrms/expenses/{exp_1_id}", headers=emp_a_headers)
        assert res_get_pending.status_code == 200
        assert res_get_pending.json()["data"]["status"] == "PENDING"

        async with sessionmaker() as session:
            db_exp = await session.get(HrmsExpense, uuid.UUID(exp_1_id))
            assert db_exp is not None
            assert db_exp.status == "PENDING"
            assert db_exp.submitted_at is not None

        # -------------------------------------------------------------------
        # 5. Employee Cannot Access Another Employee's Expense
        # -------------------------------------------------------------------
        res_b_access = await client.get(f"/api/v1/hrms/expenses/{exp_1_id}", headers=emp_b_headers)
        assert res_b_access.status_code == 403, "Employee B should be forbidden from accessing Employee A's claim"

        # -------------------------------------------------------------------
        # 6. Admin Sees Pending Expense
        # -------------------------------------------------------------------
        res_admin_list = await client.get("/api/v1/hrms/expenses?view_mode=approvals&status=PENDING", headers=admin_headers)
        assert res_admin_list.status_code == 200
        admin_items = res_admin_list.json()["data"]
        matching = [item for item in admin_items if item["id"] == exp_1_id]
        assert len(matching) == 1
        assert matching[0]["status"] == "PENDING"

        # -------------------------------------------------------------------
        # 7. Admin Approves
        # -------------------------------------------------------------------
        res_approve = await client.post(f"/api/v1/hrms/expenses/{exp_1_id}/approve", headers=admin_headers)
        assert res_approve.status_code == 200, f"Approve failed: {res_approve.text}"
        assert res_approve.json()["data"]["status"] == "APPROVED"
        assert res_approve.json()["data"]["reviewed_by"] == str(admin_id)

        # -------------------------------------------------------------------
        # 8. Status Persists
        # -------------------------------------------------------------------
        async with sessionmaker() as session:
            db_exp = await session.get(HrmsExpense, uuid.UUID(exp_1_id))
            assert db_exp is not None
            assert db_exp.status == "APPROVED"
            assert db_exp.reviewed_by == admin_id

        # -------------------------------------------------------------------
        # 9. Admin Rejects (Create second expense by emp_a to test rejection)
        # -------------------------------------------------------------------
        exp_2_payload = {
            "expense_date": str(date.today()),
            "category": "Food",
            "amount": 1250.0,
            "description": "Team lunch voucher",
            "is_submit": True,
        }
        res_2 = await client.post("/api/v1/hrms/expenses", json=exp_2_payload, headers=emp_a_headers)
        assert res_2.status_code == 201
        exp_2_id = res_2.json()["data"]["id"]
        created_expense_ids.append(exp_2_id)
        assert res_2.json()["data"]["status"] == "PENDING"

        # -------------------------------------------------------------------
        # 10. Rejection Reason Required
        # -------------------------------------------------------------------
        res_empty_reject = await client.post(
            f"/api/v1/hrms/expenses/{exp_2_id}/reject",
            json={"rejection_reason": "   "},
            headers=admin_headers,
        )
        assert res_empty_reject.status_code in (400, 422), "Rejection without reason must fail"

        # Now reject with valid reason
        res_reject = await client.post(
            f"/api/v1/hrms/expenses/{exp_2_id}/reject",
            json={"rejection_reason": "Incorrect receipt"},
            headers=admin_headers,
        )
        assert res_reject.status_code == 200, f"Reject failed: {res_reject.text}"
        assert res_reject.json()["data"]["status"] == "REJECTED"
        assert res_reject.json()["data"]["rejection_reason"] == "Incorrect receipt"

        # -------------------------------------------------------------------
        # 11. Rejected Status Persists
        # -------------------------------------------------------------------
        async with sessionmaker() as session:
            db_exp_2 = await session.get(HrmsExpense, uuid.UUID(exp_2_id))
            assert db_exp_2 is not None
            assert db_exp_2.status == "REJECTED"
            assert db_exp_2.rejection_reason == "Incorrect receipt"

        # -------------------------------------------------------------------
        # 12. Reimbursed Status Persists (on exp_1 which is APPROVED)
        # -------------------------------------------------------------------
        res_reimb = await client.post(
            f"/api/v1/hrms/expenses/{exp_1_id}/reimburse",
            json={"notes": "Paid via NEFT Ref #123456"},
            headers=admin_headers,
        )
        assert res_reimb.status_code == 200, f"Reimburse failed: {res_reimb.text}"
        assert res_reimb.json()["data"]["status"] == "REIMBURSED"
        assert res_reimb.json()["data"]["reimbursement_notes"] == "Paid via NEFT Ref #123456"

        async with sessionmaker() as session:
            db_exp_1 = await session.get(HrmsExpense, uuid.UUID(exp_1_id))
            assert db_exp_1 is not None
            assert db_exp_1.status == "REIMBURSED"
            assert db_exp_1.reimbursed_by == admin_id

        # -------------------------------------------------------------------
        # 13. Invalid Amount Rejected
        # -------------------------------------------------------------------
        res_invalid_zero = await client.post(
            "/api/v1/hrms/expenses",
            json={
                "expense_date": str(date.today()),
                "category": "Travel",
                "amount": 0.0,
                "description": "Zero amount",
            },
            headers=emp_a_headers,
        )
        assert res_invalid_zero.status_code in (400, 422), "Zero amount must be rejected"

        res_invalid_neg = await client.post(
            "/api/v1/hrms/expenses",
            json={
                "expense_date": str(date.today()),
                "category": "Travel",
                "amount": -50.0,
                "description": "Negative amount",
            },
            headers=emp_a_headers,
        )
        assert res_invalid_neg.status_code in (400, 422), "Negative amount must be rejected"

        # -------------------------------------------------------------------
        # 14. Unauthorized Approval Rejected (Permission-Based)
        # -------------------------------------------------------------------
        # Create a 3rd pending expense by emp_a
        res_3 = await client.post(
            "/api/v1/hrms/expenses",
            json={
                "expense_date": str(date.today()),
                "category": "Communication",
                "amount": 350.0,
                "description": "Mobile recharge",
                "is_submit": True,
            },
            headers=emp_a_headers,
        )
        assert res_3.status_code == 201
        exp_3_id = res_3.json()["data"]["id"]
        created_expense_ids.append(exp_3_id)

        # Employee A (no approval permissions) attempts to approve -> 403 Forbidden
        res_unauth_appr_a = await client.post(f"/api/v1/hrms/expenses/{exp_3_id}/approve", headers=emp_a_headers)
        assert res_unauth_appr_a.status_code == 403, "Non-approver employee must return 403 Forbidden"
        assert "permission" in res_unauth_appr_a.text.lower()
        assert "cannot approve their own" not in res_unauth_appr_a.text.lower()

        # Employee B (no approval permissions) attempts to approve -> 403 Forbidden
        res_unauth_appr_b = await client.post(f"/api/v1/hrms/expenses/{exp_3_id}/approve", headers=emp_b_headers)
        assert res_unauth_appr_b.status_code == 403, "Non-approver employee must return 403 Forbidden"

        # -------------------------------------------------------------------
        # 15. Authorized User CAN Approve Their Own Expense Claim
        # -------------------------------------------------------------------
        # Admin creates their own expense claim
        admin_exp_payload = {
            "expense_date": str(date.today()),
            "category": "Travel",
            "amount": 800.0,
            "description": "Admin regional client visit",
            "is_submit": True,
        }
        res_admin_create = await client.post("/api/v1/hrms/expenses", json=admin_exp_payload, headers=admin_headers)
        assert res_admin_create.status_code == 201
        admin_exp_id = res_admin_create.json()["data"]["id"]
        created_expense_ids.append(admin_exp_id)
        assert res_admin_create.json()["data"]["employee_id"] == str(admin_id)

        # Admin approves their OWN expense claim -> Must succeed! No self-approval restriction.
        res_admin_self_approve = await client.post(f"/api/v1/hrms/expenses/{admin_exp_id}/approve", headers=admin_headers)
        assert res_admin_self_approve.status_code == 200, f"Authorized self-approval must succeed: {res_admin_self_approve.text}"
        assert res_admin_self_approve.json()["data"]["status"] == "APPROVED"
        assert res_admin_self_approve.json()["data"]["reviewed_by"] == str(admin_id)

        # Verify persisted in PostgreSQL
        async with sessionmaker() as session:
            db_admin_exp = await session.get(HrmsExpense, uuid.UUID(admin_exp_id))
            assert db_admin_exp is not None
            assert db_admin_exp.status == "APPROVED"
            assert db_admin_exp.reviewed_by == admin_id

    finally:
        # Cleanup created records
        async with sessionmaker() as session:
            for eid in created_expense_ids:
                await session.execute(delete(HrmsExpense).where(HrmsExpense.id == uuid.UUID(eid)))
            await session.execute(delete(User).where(User.id.in_([admin_id, emp_a_id, emp_b_id])))
            await session.commit()
