import asyncio
import app.users.models
from httpx import AsyncClient, ASGITransport
from app.main import create_application

async def run_tests():
    app = create_application()
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        # Get users
        tokens = {}
        user_ids = {}
        for uname, pwd in [
            ('admin', 'ChangeMe!12345'),
            ('alice', 'password123'),
            ('sales_manager', 'password123'),
            ('john', 'password123'),
            ('ops_employee', 'password123')
        ]:
            res = await client.post('/api/v1/auth/login', json={'identifier': uname, 'password': pwd})
            assert res.status_code == 200, f"Login failed for {uname}: {res.text}"
            data = res.json()['data']
            tokens[uname] = data['access_token']
            user_ids[uname] = data['user']['id']
            print(f"Logged in: {uname} -> {user_ids[uname]}")

        john_id = user_ids['john']
        ops_id = user_ids['ops_employee']

        h_mgr = {'Authorization': f"Bearer {tokens['sales_manager']}"}
        h_john = {'Authorization': f"Bearer {tokens['john']}"}
        h_ops = {'Authorization': f"Bearer {tokens['ops_employee']}"}
        h_hr = {'Authorization': f"Bearer {tokens['alice']}"}
        h_admin = {'Authorization': f"Bearer {tokens['admin']}"}

        print("\n--- 1. EMPLOYEE SELECTOR SCOPE ---")
        res_admin = await client.get('/api/v1/hrms/employees', headers=h_admin)
        assert len(res_admin.json()['data']) == 5, f"Admin should see 5 employees, got {len(res_admin.json()['data'])}"
        print("PASS: Admin sees all 5 employees")

        res_hr = await client.get('/api/v1/hrms/employees', headers=h_hr)
        assert len(res_hr.json()['data']) == 5, f"HR should see 5 employees, got {len(res_hr.json()['data'])}"
        print("PASS: HR sees all 5 employees")

        res_mgr = await client.get('/api/v1/hrms/employees', headers=h_mgr)
        mgr_emps = [e['username'] for e in res_mgr.json()['data']]
        assert 'john' in mgr_emps and 'sales_manager' in mgr_emps and 'ops_employee' not in mgr_emps, f"Manager saw {mgr_emps}"
        print("PASS: Sales Manager sees only Sales employees (John, Sales Manager), NOT ops_employee")

        res_john = await client.get('/api/v1/hrms/employees', headers=h_john)
        john_emps = [e['username'] for e in res_john.json()['data']]
        assert john_emps == ['john'], f"John saw {john_emps}"
        print("PASS: John sees only John")

        res_ops = await client.get('/api/v1/hrms/employees', headers=h_ops)
        ops_emps = [e['username'] for e in res_ops.json()['data']]
        assert ops_emps == ['ops_employee'], f"ops_employee saw {ops_emps}"
        print("PASS: ops_employee sees only ops_employee")

        print("\n--- 2. ATTENDANCE ISOLATION & DIRECT URL/API TAMPERING ---")
        # Manager trying to view ops_employee's attendance calendar
        res_mgr_ops_att = await client.get(f'/api/v1/hrms/attendance/calendar?employee_id={ops_id}&year=2026&month=10', headers=h_mgr)
        assert res_mgr_ops_att.status_code == 403, f"Manager querying ops_employee attendance should be 403, got {res_mgr_ops_att.status_code}"
        print("PASS: Sales Manager viewing ops_employee attendance calendar -> 403 Forbidden")

        # John trying to view ops_employee's attendance
        res_john_ops_att = await client.get(f'/api/v1/hrms/attendance/calendar?employee_id={ops_id}&year=2026&month=10', headers=h_john)
        assert res_john_ops_att.status_code == 403, f"John querying ops_employee attendance should be 403, got {res_john_ops_att.status_code}"
        print("PASS: John viewing ops_employee attendance calendar -> 403 Forbidden")

        # ops_employee trying to view John's attendance
        res_ops_john_att = await client.get(f'/api/v1/hrms/attendance/calendar?employee_id={john_id}&year=2026&month=10', headers=h_ops)
        assert res_ops_john_att.status_code == 403, f"ops_employee querying John attendance should be 403, got {res_ops_john_att.status_code}"
        print("PASS: ops_employee viewing John attendance calendar -> 403 Forbidden")

        # Manager viewing John's attendance -> 200 OK
        res_mgr_john_att = await client.get(f'/api/v1/hrms/attendance/calendar?employee_id={john_id}&year=2026&month=10', headers=h_mgr)
        assert res_mgr_john_att.status_code == 200, f"Manager querying John attendance should be 200, got {res_mgr_john_att.status_code}"
        print("PASS: Sales Manager viewing John attendance calendar -> 200 OK")

        print("\n--- 3. LEAVE ISOLATION & DIRECT API TAMPERING ---")
        # Manager requesting leave for ops_employee
        res_mgr_ops_leave = await client.post('/api/v1/hrms/leave/requests', headers=h_mgr, json={
            'employee_id': str(ops_id),
            'leave_type_id': 'a2b9d359-8aec-44f0-9816-11102efc0602',
            'from_date': '2026-10-22',
            'to_date': '2026-10-22',
            'number_of_days': 1.0,
            'reason': 'Cross department tamper'
        })
        assert res_mgr_ops_leave.status_code == 403, f"Expected 403, got {res_mgr_ops_leave.status_code}"
        print("PASS: Sales Manager creating leave request for ops_employee -> 403 Forbidden")

        # John requesting leave for ops_employee
        res_john_ops_leave = await client.post('/api/v1/hrms/leave/requests', headers=h_john, json={
            'employee_id': str(ops_id),
            'leave_type_id': 'a2b9d359-8aec-44f0-9816-11102efc0602',
            'from_date': '2026-10-22',
            'to_date': '2026-10-22',
            'number_of_days': 1.0,
            'reason': 'Cross employee tamper'
        })
        assert res_john_ops_leave.status_code == 403, f"Expected 403, got {res_john_ops_leave.status_code}"
        print("PASS: John creating leave request for ops_employee -> 403 Forbidden")

        print("\n--- 4. ASSETS ISOLATION ---")
        # John listing assets: must only contain John's assigned assets
        res_john_assets = await client.get('/api/v1/hrms/assets', headers=h_john)
        assert res_john_assets.status_code == 200
        john_asset_items = res_john_assets.json()['data']
        for a in john_asset_items:
            assert a.get('assigned_to_user_id') == str(john_id), f"John saw asset assigned to {a.get('assigned_to_user_id')}"
        print(f"PASS: John only sees own assets ({len(john_asset_items)} assets)")

        # ops_employee listing assets: must only contain ops_employee's assets
        res_ops_assets = await client.get('/api/v1/hrms/assets', headers=h_ops)
        assert res_ops_assets.status_code == 200
        ops_asset_items = res_ops_assets.json()['data']
        for a in ops_asset_items:
            assert a.get('assigned_to_user_id') == str(ops_id), f"ops_employee saw asset assigned to {a.get('assigned_to_user_id')}"
        print(f"PASS: ops_employee only sees own assets ({len(ops_asset_items)} assets)")

        # Manager listing assets: must NOT contain ops_employee's asset
        res_mgr_assets = await client.get('/api/v1/hrms/assets', headers=h_mgr)
        assert res_mgr_assets.status_code == 200
        mgr_asset_items = res_mgr_assets.json()['data']
        for a in mgr_asset_items:
            assert a.get('assigned_to_user_id') != str(ops_id), "Sales Manager saw ops_employee asset!"
        print(f"PASS: Sales Manager does NOT see ops_employee's assets (saw {len(mgr_asset_items)} assets)")

        # Admin & HR see both
        res_admin_assets = await client.get('/api/v1/hrms/assets', headers=h_admin)
        assert res_admin_assets.status_code == 200 and len(res_admin_assets.json()['data']) >= 2
        print(f"PASS: Admin sees company-wide assets ({len(res_admin_assets.json()['data'])} assets)")

        print("\n--- 5. EXPENSES ISOLATION ---")
        # John listing expenses: only John's expenses
        res_john_exp = await client.get('/api/v1/hrms/expenses', headers=h_john)
        assert res_john_exp.status_code == 200
        for e in res_john_exp.json()['data']:
            assert e['employee_id'] == str(john_id), "John saw someone else's expense!"
        print("PASS: John only sees own expenses")

        # ops_employee listing expenses: only ops_employee's expenses
        res_ops_exp = await client.get('/api/v1/hrms/expenses', headers=h_ops)
        assert res_ops_exp.status_code == 200
        for e in res_ops_exp.json()['data']:
            assert e['employee_id'] == str(ops_id), "ops_employee saw someone else's expense!"
        print("PASS: ops_employee only sees own expenses")

        # Sales Manager listing expenses: does NOT contain ops_employee's expenses
        res_mgr_exp = await client.get('/api/v1/hrms/expenses', headers=h_mgr)
        assert res_mgr_exp.status_code == 200
        for e in res_mgr_exp.json()['data']:
            assert e['employee_id'] != str(ops_id), "Sales Manager saw ops_employee expense!"
        print("PASS: Sales Manager does NOT see ops_employee's expenses")

        print("\n--- 6. SITE VISITS ISOLATION ---")
        res_john_sv = await client.get('/api/v1/hrms/site-visits', headers=h_john)
        assert res_john_sv.status_code == 200
        for s in res_john_sv.json()['data']:
            assert s['employee_id'] == str(john_id), "John saw someone else's site visit!"
        print("PASS: John only sees own site visits")

        res_ops_sv = await client.get('/api/v1/hrms/site-visits', headers=h_ops)
        assert res_ops_sv.status_code == 200
        for s in res_ops_sv.json()['data']:
            assert s['employee_id'] == str(ops_id), "ops_employee saw someone else's site visit!"
        print("PASS: ops_employee only sees own site visits")

        res_mgr_sv = await client.get('/api/v1/hrms/site-visits', headers=h_mgr)
        assert res_mgr_sv.status_code == 200
        for s in res_mgr_sv.json()['data']:
            assert s['employee_id'] != str(ops_id), "Sales Manager saw ops_employee site visit!"
        print("PASS: Sales Manager does NOT see ops_employee's site visits")

        print("\n--- 7. PAYROLL & SETUP ACCESS RESTRICTION ---")
        # Normal employee / manager cannot access Payroll Setup:
        res_john_setup = await client.get('/api/v1/hrms/payroll/components', headers=h_john)
        assert res_john_setup.status_code == 403, f"Expected 403, got {res_john_setup.status_code}"
        print("PASS: John accessing Payroll Setup components -> 403 Forbidden")

        res_mgr_setup = await client.get('/api/v1/hrms/payroll/components', headers=h_mgr)
        assert res_mgr_setup.status_code == 403, f"Expected 403, got {res_mgr_setup.status_code}"
        print("PASS: Sales Manager accessing Payroll Setup components -> 403 Forbidden")

        # HR and Admin CAN access Payroll Setup:
        res_hr_setup = await client.get('/api/v1/hrms/payroll/components', headers=h_hr)
        assert res_hr_setup.status_code == 200
        print("PASS: HR accessing Payroll Setup components -> 200 OK")

        # John viewing own payslips
        res_john_payslips = await client.get('/api/v1/hrms/payroll/payslips', headers=h_john)
        assert res_john_payslips.status_code == 200
        print(f"PASS: John viewing own payslips -> 200 OK ({len(res_john_payslips.json()['data'])} payslips)")

        print("\n=== ALL RBAC ISOLATION & API SECURITY CHECKS PASSED ===")

if __name__ == '__main__':
    asyncio.run(run_tests())
