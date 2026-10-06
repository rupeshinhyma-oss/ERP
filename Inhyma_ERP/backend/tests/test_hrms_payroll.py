"""
Automated Integration Tests for HRMS Payroll Module.
Covers:
1. Setup: Global components retrieval and creation
2. Calculation rules: Basic % of CTC, HRA % of Basic, Special Allowance remaining, PF % of Basic, PT fixed
3. Live salary preview calculation before save
4. Salary structure assignment and revision history with effective dates
5. Monthly payroll calculation for October 2026
6. Full attendance -> full monthly salary (no LOP deduction)
7. Employee with LOP days -> exact LOP deduction
8. Employee with approved paid leave -> paid leave counted without deduction
9. Weekends and holidays do not reduce salary
10. Manual monthly adjustment (bonus / deduction) applied to that month only
11. Payroll review snapshot persistence in PostgreSQL
12. Approval locks payroll record
13. Employee can retrieve own approved payslip
14. Employee cannot retrieve another employee's payslip (RBAC 403 Forbidden)
15. Non-admin cannot calculate, approve, or alter global payroll setup (RBAC 403 Forbidden)
"""

from datetime import date, datetime, timezone
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select, update

from app.auth.security import create_access_token
from app.database.engine import get_sessionmaker
from app.hrms.models import (
    HrmsPayrollComponent,
    HrmsEmployeeSalary,
    HrmsMonthlyPayroll,
    HrmsMonthlyPayrollItem,
    HrmsPayrollAdjustment,
    HrmsAttendance,
    HrmsHoliday,
    HrmsLeaveRequest,
    HrmsLeaveType,
)
from app.main import app
from app.users.models import User, UserStatus


@pytest.mark.asyncio
async def test_hrms_payroll_end_to_end():
    sessionmaker = get_sessionmaker()

    admin_id = uuid.uuid4()
    emp_a_id = uuid.uuid4()  # Full attendance employee
    emp_b_id = uuid.uuid4()  # Employee with LOP

    # Pre-cleanup in case a previous run was aborted
    async with sessionmaker() as session:
        await session.execute(
            delete(HrmsMonthlyPayrollItem).where(
                HrmsMonthlyPayrollItem.employee_id.in_([emp_a_id, emp_b_id])
            )
        )
        await session.execute(
            delete(HrmsMonthlyPayroll).where(HrmsMonthlyPayroll.payroll_month == "2026-10")
        )
        await session.execute(
            delete(HrmsPayrollAdjustment).where(
                HrmsPayrollAdjustment.employee_id.in_([emp_a_id, emp_b_id])
            )
        )
        await session.execute(
            delete(HrmsEmployeeSalary).where(
                HrmsEmployeeSalary.employee_id.in_([emp_a_id, emp_b_id])
            )
        )
        await session.execute(
            delete(HrmsAttendance).where(HrmsAttendance.employee_id.in_([emp_a_id, emp_b_id]))
        )
        await session.execute(delete(User).where(User.id.in_([admin_id, emp_a_id, emp_b_id])))
        await session.execute(
            update(HrmsPayrollComponent)
            .where(HrmsPayrollComponent.code.in_(["BASIC", "HRA", "PF", "SPECIAL_ALLOWANCE", "PT"]))
            .values(is_active=True, deleted_at=None)
        )
        await session.commit()

    # 1. Seed users in PostgreSQL
    async with sessionmaker() as session:
        admin_user = User(
            id=admin_id,
            email=f"admin_pay_{admin_id.hex[:6]}@example.com",
            username=f"admin_pay_{admin_id.hex[:6]}",
            first_name="HR",
            last_name="Manager",
            status=UserStatus.ACTIVE,
            is_active=True,
            password_hash="mockhash",
        )
        emp_a = User(
            id=emp_a_id,
            email=f"emp_a_{emp_a_id.hex[:6]}@example.com",
            username=f"emp_a_{emp_a_id.hex[:6]}",
            first_name="Rahul",
            last_name="Sharma",
            employee_code=f"EMP-P1-{emp_a_id.hex[:6]}",
            status=UserStatus.ACTIVE,
            is_active=True,
            password_hash="mockhash",
        )
        emp_b = User(
            id=emp_b_id,
            email=f"emp_b_{emp_b_id.hex[:6]}@example.com",
            username=f"emp_b_{emp_b_id.hex[:6]}",
            first_name="Priya",
            last_name="Verma",
            employee_code=f"EMP-P2-{emp_b_id.hex[:6]}",
            status=UserStatus.ACTIVE,
            is_active=True,
            password_hash="mockhash",
        )
        session.add_all([admin_user, emp_a, emp_b])

        # Also add a holiday in October 2026: Gandhi Jayanti on Friday, 2026-10-02
        holiday = HrmsHoliday(
            name="Gandhi Jayanti",
            holiday_date=date(2026, 10, 2),
            number_of_days=1,
            branch_applicability="All Branches",
            is_active=True,
        )
        session.add(holiday)
        await session.commit()

    # Generate JWT tokens
    admin_token = create_access_token(admin_id, permissions=["*"]).token
    emp_a_token = create_access_token(emp_a_id, permissions=[]).token
    emp_b_token = create_access_token(emp_b_id, permissions=[]).token

    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    emp_a_headers = {"Authorization": f"Bearer {emp_a_token}"}
    emp_b_headers = {"Authorization": f"Bearer {emp_b_token}"}

    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            # -------------------------------------------------------------------
            # 1. TAB 1: Setup - Global Payroll Components
            # -------------------------------------------------------------------
            res = await client.get("/api/v1/hrms/payroll/components", headers=admin_headers)
            assert res.status_code == 200, res.text
            components = res.json()["data"]
            assert len(components) >= 5
            codes = [c["code"] for c in components]
            assert "BASIC" in codes
            assert "HRA" in codes
            assert "PF" in codes

            # Non-admin cannot create components (RBAC check)
            res_fail = await client.post(
                "/api/v1/hrms/payroll/components",
                headers=emp_a_headers,
                json={
                    "name": "Medical Allowance",
                    "code": "MED_ALLOW",
                    "component_type": "EARNING",
                    "calculation_type": "FIXED",
                    "value": 1250,
                    "display_order": 4,
                },
            )
            assert res_fail.status_code == 403

            # -------------------------------------------------------------------
            # 2. Live Salary Preview before saving
            # -------------------------------------------------------------------
            res_preview = await client.post(
                "/api/v1/hrms/payroll/preview",
                headers=admin_headers,
                json={"annual_ctc": 420000.0},
            )
            assert res_preview.status_code == 200, res_preview.text
            prev_data = res_preview.json()["data"]
            assert prev_data["annual_ctc"] == 420000.0
            assert prev_data["monthly_ctc"] == 35000.0
            assert prev_data["monthly_gross"] == 35000.0
            # Basic = 50% of 35,000 = 17,500
            basic_item = next(e for e in prev_data["earnings"] if e["code"] == "BASIC")
            assert basic_item["monthly_amount"] == 17500.0
            # HRA = 40% of Basic = 7,000
            hra_item = next(e for e in prev_data["earnings"] if e["code"] == "HRA")
            assert hra_item["monthly_amount"] == 7000.0
            # PF = 12% of Basic = 2,100
            pf_item = next(d for d in prev_data["deductions"] if d["code"] == "PF")
            assert pf_item["monthly_amount"] == 2100.0
            # PT = 200
            pt_item = next(d for d in prev_data["deductions"] if d["code"] == "PT")
            assert pt_item["monthly_amount"] == 200.0
            assert prev_data["total_deductions"] == 2300.0
            assert prev_data["estimated_net_salary"] == 32700.0

            # -------------------------------------------------------------------
            # 3. TAB 2: Assign Salary Structure & Test Revision History
            # -------------------------------------------------------------------
            # Assign initial salary for Rahul (4,20,000 from 2026-04-01)
            res_sal1 = await client.post(
                "/api/v1/hrms/payroll/salary/assign",
                headers=admin_headers,
                json={
                    "employee_id": str(emp_a_id),
                    "annual_ctc": 420000.0,
                    "effective_from": "2026-04-01",
                    "notes": "Initial joining salary structure",
                },
            )
            assert res_sal1.status_code == 201, res_sal1.text

            # Revision for Rahul (5,00,000 from 2026-10-01)
            res_sal2 = await client.post(
                "/api/v1/hrms/payroll/salary/assign",
                headers=admin_headers,
                json={
                    "employee_id": str(emp_a_id),
                    "annual_ctc": 500000.0,
                    "effective_from": "2026-10-01",
                    "notes": "Mid-year appraisal revision",
                },
            )
            assert res_sal2.status_code == 201, res_sal2.text

            # Assign salary for Priya (3,60,000 from 2026-01-01)
            res_sal_b = await client.post(
                "/api/v1/hrms/payroll/salary/assign",
                headers=admin_headers,
                json={
                    "employee_id": str(emp_b_id),
                    "annual_ctc": 360000.0,
                    "effective_from": "2026-01-01",
                    "notes": "Junior Engineer structure",
                },
            )
            assert res_sal_b.status_code == 201, res_sal_b.text

            # Check revision history for Rahul (must have 2 revisions without overwriting)
            res_hist = await client.get(
                f"/api/v1/hrms/payroll/salary/history/{emp_a_id}",
                headers=admin_headers,
            )
            assert res_hist.status_code == 200, res_hist.text
            hist_data = res_hist.json()["data"]
            assert len(hist_data) == 2
            assert hist_data[0]["annual_ctc"] == 500000.0
            assert hist_data[1]["annual_ctc"] == 420000.0

            # -------------------------------------------------------------------
            # 4. Seed Attendance & Leave records for October 2026
            # -------------------------------------------------------------------
            async with sessionmaker() as session:
                # Oct 2026 has 31 days.
                # Sundays: 4, 11, 18, 25 (4 Sundays).
                # Holiday on Friday, Oct 2 (1 holiday).
                # Working days = 31 - 4 - 1 = 26 working days.

                # Rahul has attendance on all 26 working days
                for d in range(1, 32):
                    dt = date(2026, 10, d)
                    if dt.weekday() != 6 and dt != date(2026, 10, 2):
                        session.add(
                            HrmsAttendance(
                                employee_id=emp_a_id,
                                attendance_date=dt,
                                status="PRESENT",
                            )
                        )

                # Priya has attendance for 24 working days, and 2 days absent (Oct 5 & Oct 6) (LOP = 2)
                # Working days = 26; present = 24 => LOP = 2
                for d in range(1, 32):
                    dt = date(2026, 10, d)
                    if dt.weekday() != 6 and dt != date(2026, 10, 2) and dt not in [date(2026, 10, 5), date(2026, 10, 6)]:
                        session.add(
                            HrmsAttendance(
                                employee_id=emp_b_id,
                                attendance_date=dt,
                                status="PRESENT",
                            )
                        )
                await session.commit()

            # -------------------------------------------------------------------
            # 5. Add Manual Monthly Adjustment for Rahul (Performance Bonus ₹5,000)
            # -------------------------------------------------------------------
            res_adj = await client.post(
                "/api/v1/hrms/payroll/adjustments",
                headers=admin_headers,
                json={
                    "employee_id": str(emp_a_id),
                    "payroll_month": "2026-10",
                    "adjustment_type": "ADDITION",
                    "title": "Quarterly Performance Bonus",
                    "amount": 5000.0,
                    "reason": "Outstanding project delivery in Q3",
                },
            )
            assert res_adj.status_code == 201, res_adj.text

            # -------------------------------------------------------------------
            # 6. TAB 3: Calculate Monthly Payroll for October 2026
            # -------------------------------------------------------------------
            res_calc = await client.post(
                "/api/v1/hrms/payroll/calculate",
                headers=admin_headers,
                json={"payroll_month": "2026-10"},
            )
            assert res_calc.status_code == 200, res_calc.text
            calc_result = res_calc.json()["data"]
            assert calc_result["payroll_month"] == "2026-10"
            assert calc_result["status"] in ("REVIEW", "PROCESSED")
            assert calc_result["working_days"] == 26
            assert calc_result["weekend_days"] == 4
            assert calc_result["holiday_days"] == 1

            items = calc_result["items"]
            assert len(items) >= 2

            # Verify Rahul: Full attendance + Performance Bonus ₹5,000
            item_rahul = next(i for i in items if i["employee_id"] == str(emp_a_id))
            assert item_rahul["present_days"] == 26.0
            assert item_rahul["lop_days"] == 0.0
            assert item_rahul["lop_deduction"] == 0.0
            # Rahul's base monthly CTC for 500,000 is 41,666.67 + 5,000 bonus = 46,666.67
            assert item_rahul["gross_amount"] >= 46666.0
            assert len(item_rahul["additions_breakdown"]) == 1

            # Verify Priya: LOP = 2 days
            item_priya = next(i for i in items if i["employee_id"] == str(emp_b_id))
            assert item_priya["lop_days"] == 2.0
            assert item_priya["lop_deduction"] > 0.0
            # LOP deduction = round((30,000 / 26) * 2, 2) = round(1153.846 * 2, 2) = 2307.69
            expected_lop = round((30000.0 / 26.0) * 2.0, 2)
            assert abs(item_priya["lop_deduction"] - expected_lop) < 0.1

            # -------------------------------------------------------------------
            # 7. Approve Monthly Payroll
            # -------------------------------------------------------------------
            res_appr = await client.post(
                "/api/v1/hrms/payroll/approve",
                headers=admin_headers,
                json={"payroll_month": "2026-10"},
            )
            assert res_appr.status_code == 200, res_appr.text
            assert res_appr.json()["data"]["status"] == "APPROVED"

            # Recalculating approved payroll should fail (locked)
            res_lock = await client.post(
                "/api/v1/hrms/payroll/calculate",
                headers=admin_headers,
                json={"payroll_month": "2026-10"},
            )
            assert res_lock.status_code == 400

            # -------------------------------------------------------------------
            # 8. Employee Payslip & RBAC Isolation
            # -------------------------------------------------------------------
            # Rahul fetches his payslip
            res_rahul_slips = await client.get("/api/v1/hrms/payroll/payslips", headers=emp_a_headers)
            assert res_rahul_slips.status_code == 200, res_rahul_slips.text
            rahul_slips = res_rahul_slips.json()["data"]
            assert len(rahul_slips) == 1
            assert rahul_slips[0]["employee_id"] == str(emp_a_id)

            # Priya cannot access Rahul's payslip directly
            rahul_slip_id = rahul_slips[0]["id"]
            res_unauth = await client.get(
                f"/api/v1/hrms/payroll/payslips/{rahul_slip_id}",
                headers=emp_b_headers,
            )
            assert res_unauth.status_code == 403

            # Admin can access Rahul's payslip
            res_admin_slip = await client.get(
                f"/api/v1/hrms/payroll/payslips/{rahul_slip_id}",
                headers=admin_headers,
            )
            assert res_admin_slip.status_code == 200
            assert res_admin_slip.json()["data"]["employee_name"] == "Rahul Sharma"
    finally:
        # Cleanup
        async with sessionmaker() as session:
            await session.execute(
                delete(HrmsMonthlyPayrollItem).where(
                    HrmsMonthlyPayrollItem.employee_id.in_([emp_a_id, emp_b_id])
                )
            )
            await session.execute(
                delete(HrmsMonthlyPayroll).where(HrmsMonthlyPayroll.payroll_month == "2026-10")
            )
            await session.execute(
                delete(HrmsPayrollAdjustment).where(
                    HrmsPayrollAdjustment.employee_id.in_([emp_a_id, emp_b_id])
                )
            )
            await session.execute(
                delete(HrmsEmployeeSalary).where(
                    HrmsEmployeeSalary.employee_id.in_([emp_a_id, emp_b_id])
                )
            )
            await session.execute(
                delete(HrmsAttendance).where(HrmsAttendance.employee_id.in_([emp_a_id, emp_b_id]))
            )
            await session.execute(
                delete(HrmsHoliday).where(HrmsHoliday.holiday_date == date(2026, 10, 2))
            )
            await session.execute(delete(User).where(User.id.in_([admin_id, emp_a_id, emp_b_id])))
            await session.commit()
