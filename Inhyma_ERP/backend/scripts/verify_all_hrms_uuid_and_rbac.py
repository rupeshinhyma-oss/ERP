import asyncio
import os
import sys
import uuid
import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from datetime import date
from sqlalchemy import select, delete
from app.database.session import get_sessionmaker
from app.users.models import User, UserStatus
from app.hrms.models import HrmsMonthlyPayroll, HrmsMonthlyPayrollItem
from app.auth.security import create_access_token
from app.main import create_application

async def run_verification():
    app = create_application()
    transport = httpx.ASGITransport(app=app)

    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            sessionmaker = get_sessionmaker()
            async with sessionmaker() as session:
                # 1. Authoritative Admin User
                users_stmt = select(User).where(User.deleted_at.is_(None), User.is_active.is_(True)).order_by(User.id)
                users = list((await session.execute(users_stmt)).scalars().all())
                admin = next((u for u in users if u.employee_code == "EMP-000" or u.username in ("admin", "superadmin")), users[0])
                print(f"[AUTH] Authoritative Admin: UUID={admin.id}, Code={admin.employee_code}, Username={admin.username}")

                # 2. Real Payroll Record
                items_stmt = select(HrmsMonthlyPayrollItem, HrmsMonthlyPayroll, User).join(
                    HrmsMonthlyPayroll, HrmsMonthlyPayroll.id == HrmsMonthlyPayrollItem.payroll_id
                ).join(
                    User, User.id == HrmsMonthlyPayrollItem.employee_id
                ).where(HrmsMonthlyPayrollItem.status == "APPROVED").order_by(HrmsMonthlyPayrollItem.created_at.desc())
                payroll_row = (await session.execute(items_stmt)).first()
                if payroll_row:
                    pay_item, pay_header, pay_user = payroll_row
                    print(f"[PAYROLL] Real Approved Payroll: Emp={pay_user.first_name} ({pay_user.employee_code}), Month={pay_header.payroll_month}, Gross={pay_item.gross_amount}, Deductions={pay_item.total_deductions}, Net={pay_item.net_salary}")
                else:
                    print("[PAYROLL] Warning: No approved payroll row found.")

                # 3. Create a temporary regular employee without admin/HR role
                temp_emp_id = uuid.uuid4()
                temp_emp = User(
                    id=temp_emp_id,
                    email=f"temp_emp_{temp_emp_id.hex[:6]}@example.com",
                    username=f"temp_emp_{temp_emp_id.hex[:6]}",
                    first_name="Temp",
                    last_name="Employee",
                    employee_code=f"EMP-T-{temp_emp_id.hex[:4]}",
                    status=UserStatus.ACTIVE,
                    is_active=True,
                    password_hash="plainpass",
                )
                session.add(temp_emp)
                await session.commit()

            admin_token = create_access_token(admin.id, permissions=["*"]).token
            admin_headers = {"Authorization": f"Bearer {admin_token}"}

            emp_token = create_access_token(temp_emp_id, permissions=[]).token
            emp_headers = {"Authorization": f"Bearer {emp_token}"}

            try:
                print("\n=== STEP 1: VERIFYING IDENTIFIER RESOLUTION (ADMIN) ===")
                # A. Direct UUID lookup
                r_uuid = await client.get(f"/api/v1/hrms/attendance/calendar?year=2026&month=10&employee_id={admin.id}", headers=admin_headers)
                assert r_uuid.status_code == 200, f"Failed UUID lookup: {r_uuid.status_code} {r_uuid.text}"
                print("  [PASS] /attendance/calendar?employee_id=<UUID> -> 200 OK")

                # B. Employee code lookup ("EMP-000")
                r_code = await client.get(f"/api/v1/hrms/attendance/calendar?year=2026&month=10&employee_id={admin.employee_code}", headers=admin_headers)
                assert r_code.status_code == 200, f"Failed Employee Code lookup: {r_code.status_code} {r_code.text}"
                print(f"  [PASS] /attendance/calendar?employee_id={admin.employee_code} -> 200 OK (resolved to UUID)")

                # C. Username lookup ("admin")
                r_user = await client.get(f"/api/v1/hrms/attendance/calendar?year=2026&month=10&employee_id={admin.username}", headers=admin_headers)
                assert r_user.status_code == 200, f"Failed Username lookup: {r_user.status_code} {r_user.text}"
                print(f"  [PASS] /attendance/calendar?employee_id={admin.username} -> 200 OK (resolved to UUID)")

                # D. Nonexistent employee code -> 404
                r_404 = await client.get("/api/v1/hrms/attendance/calendar?year=2026&month=10&employee_id=NONEXISTENT_CODE_XYZ", headers=admin_headers)
                assert r_404.status_code == 404, f"Expected 404, got: {r_404.status_code}"
                print("  [PASS] /attendance/calendar?employee_id=NONEXISTENT_CODE_XYZ -> 404 Not Found with clean message")

                # E. All-calendar with search filter
                r_all_search = await client.get(f"/api/v1/hrms/attendance/all-calendar?year=2026&month=10&search={admin.employee_code}", headers=admin_headers)
                assert r_all_search.status_code == 200
                data_matrix = r_all_search.json()["data"]["employees"]
                assert any(e.get("employee_code") == admin.employee_code or "EMP-000" in e.get("employee_id", "") for e in data_matrix)
                print(f"  [PASS] /attendance/all-calendar?search={admin.employee_code} -> 200 OK (matrix filtered)")

                # F. Attendance Export with employee code
                r_att_exp = await client.get(f"/api/v1/hrms/attendance/export?year=2026&month=10&employee_id={admin.employee_code}", headers=admin_headers)
                assert r_att_exp.status_code == 200
                assert len(r_att_exp.content) > 1000
                print(f"  [PASS] /attendance/export?employee_id={admin.employee_code} -> 200 OK (Excel generated)")

                # G. Payroll Export with employee code
                r_pay_exp = await client.get(f"/api/v1/hrms/payroll/export?payroll_month=2026-10&employee_id={admin.employee_code}", headers=admin_headers)
                assert r_pay_exp.status_code == 200
                assert len(r_pay_exp.content) > 1000
                print(f"  [PASS] /payroll/export?employee_id={admin.employee_code} -> 200 OK (Excel generated)")

                # H. Payslips with employee code
                r_slips = await client.get(f"/api/v1/hrms/payroll/payslips?payroll_month=2026-10&employee_id={admin.employee_code}", headers=admin_headers)
                assert r_slips.status_code == 200
                print(f"  [PASS] /payroll/payslips?employee_id={admin.employee_code} -> 200 OK")

                # I. Salary history with employee code
                r_sal_hist = await client.get(f"/api/v1/hrms/payroll/salary/history/{admin.employee_code}", headers=admin_headers)
                assert r_sal_hist.status_code == 200
                print(f"  [PASS] /payroll/salary/history/{admin.employee_code} -> 200 OK")

                print("\n=== STEP 2: VERIFYING RBAC SCOPING & SECURITY ===")
                # Unauthorized employee trying to access Admin attendance via UUID -> 403 Forbidden
                r_unauth_uuid = await client.get(f"/api/v1/hrms/attendance/calendar?year=2026&month=10&employee_id={admin.id}", headers=emp_headers)
                assert r_unauth_uuid.status_code == 403, f"Expected 403, got {r_unauth_uuid.status_code}"
                print("  [PASS] Employee accessing admin attendance via UUID -> 403 Forbidden")

                # Unauthorized employee trying to access Admin attendance via Code -> 403 Forbidden
                r_unauth_code = await client.get(f"/api/v1/hrms/attendance/calendar?year=2026&month=10&employee_id={admin.employee_code}", headers=emp_headers)
                assert r_unauth_code.status_code == 403, f"Expected 403, got {r_unauth_code.status_code}"
                print("  [PASS] Employee accessing admin attendance via Code -> 403 Forbidden")

                # Unauthorized employee trying to export admin payroll -> 403 Forbidden
                r_unauth_pay = await client.get(f"/api/v1/hrms/payroll/export?payroll_month=2026-10&employee_id={admin.id}", headers=emp_headers)
                assert r_unauth_pay.status_code == 403, f"Expected 403, got {r_unauth_pay.status_code}"
                print("  [PASS] Employee exporting admin payroll -> 403 Forbidden")

                # Unauthorized employee trying to view admin payslips -> 403 Forbidden
                r_unauth_slip = await client.get(f"/api/v1/hrms/payroll/payslips?payroll_month=2026-10&employee_id={admin.id}", headers=emp_headers)
                assert r_unauth_slip.status_code == 403, f"Expected 403, got {r_unauth_slip.status_code}"
                print("  [PASS] Employee querying admin payslips -> 403 Forbidden")

                # Unauthorized employee trying to view admin salary history -> 403 Forbidden
                r_unauth_hist = await client.get(f"/api/v1/hrms/payroll/salary/history/{admin.id}", headers=emp_headers)
                assert r_unauth_hist.status_code == 403, f"Expected 403, got {r_unauth_hist.status_code}"
                print("  [PASS] Employee querying admin salary history -> 403 Forbidden")

                print("\nALL BACKEND IDENTIFIER RESOLUTION & RBAC CHECKS PASSED!")

            finally:
                async with sessionmaker() as session:
                    await session.execute(delete(User).where(User.id == temp_emp_id))
                    await session.commit()

if __name__ == "__main__":
    asyncio.run(run_verification())
