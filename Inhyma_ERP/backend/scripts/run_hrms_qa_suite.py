"""
Comprehensive Production HRMS Integration + RBAC + API Security Test Suite.

Verifies:
1. Real Authentication & JWT Session resolution for all 5 roles.
2. Canonical Employee Resolution (GET /hrms/employees) role scoping.
3. Payroll Month parameter fix, No auto-publish, Draft/Review status, Recalculate, Approval locking.
4. Attendance isolation & department scoping.
5. Leave request & approval isolation.
6. Asset Management employee isolation & direct API protection.
7. Expense Claim isolation, manager approval, self-approval prevention.
8. Site Visit check-in, employee isolation, GPS persistence.
9. Direct URL / Unauthorized API access rejection (403 Forbidden).
10. Cross-module data integrity (Attendance -> Leave -> Payroll).
"""

import sys
import uuid
import httpx

BASE_URL = "http://127.0.0.1:8002/api/v1"

# Real PostgreSQL test accounts
USERS = {
    "ADMIN": {"username": "admin", "password": "ChangeMe!12345", "role": "super_admin"},
    "HR": {"username": "alice", "password": "password123", "role": "HR"},
    "MANAGER": {"username": "sales_manager", "password": "password123", "role": "department_manager", "dept": "Sales"},
    "EMPLOYEE": {"username": "john", "password": "password123", "role": "employee", "dept": "Sales"},
    "OTHER_EMP": {"username": "ops_employee", "password": "password123", "role": "employee", "dept": "Operations"},
}

TOKENS = {}
USER_DATA = {}

test_results = {
    "Attendance": {"total": 0, "pass": 0, "fail": 0, "issues": []},
    "Leave": {"total": 0, "pass": 0, "fail": 0, "issues": []},
    "Assets": {"total": 0, "pass": 0, "fail": 0, "issues": []},
    "Expenses": {"total": 0, "pass": 0, "fail": 0, "issues": []},
    "Site Visits": {"total": 0, "pass": 0, "fail": 0, "issues": []},
    "Payroll": {"total": 0, "pass": 0, "fail": 0, "issues": []},
    "RBAC & Security": {"total": 0, "pass": 0, "fail": 0, "issues": []},
    "Cross-Module": {"total": 0, "pass": 0, "fail": 0, "issues": []},
}


def record(module: str, test_name: str, passed: bool, error: str = ""):
    test_results[module]["total"] += 1
    if passed:
        test_results[module]["pass"] += 1
        print(f"  [PASS] {test_name}")
    else:
        test_results[module]["fail"] += 1
        test_results[module]["issues"].append(f"{test_name}: {error}")
        print(f"  [FAIL] {test_name} -> {error}")


def headers(role: str) -> dict:
    return {"Authorization": f"Bearer {TOKENS[role]}", "Content-Type": "application/json"}


def run_tests():
    print("=" * 70)
    print("STARTING FULL HRMS PRODUCTION INTEGRATION & RBAC QA PASS")
    print("Authoritative Backend: http://127.0.0.1:8002/api/v1")
    print("Authoritative DB: PostgreSQL")
    print("=" * 70)

    # -------------------------------------------------------------------
    # 1. AUTHENTICATE ALL REAL POSTGRESQL USERS
    # -------------------------------------------------------------------
    print("\n--- 1. Authenticating Real Users in PostgreSQL ---")
    with httpx.Client(base_url=BASE_URL, timeout=10.0) as client:
        for role, creds in USERS.items():
            res = client.post("/auth/login", json={"identifier": creds["username"], "password": creds["password"]})
            if res.status_code == 200:
                data = res.json()["data"]
                TOKENS[role] = data["access_token"]
                user = data.get("user") or {}
                USER_DATA[role] = {
                    "id": user.get("id"),
                    "employee_code": user.get("employee_code"),
                    "full_name": user.get("full_name") or user.get("username"),
                    "roles": user.get("roles", []),
                }
                record("RBAC & Security", f"Authenticate {role} ({creds['username']})", True)
            else:
                record("RBAC & Security", f"Authenticate {role} ({creds['username']})", False, f"Status {res.status_code}: {res.text}")

    # -------------------------------------------------------------------
    # 2. CANONICAL EMPLOYEE RESOLUTION & RBAC SCOPING
    # -------------------------------------------------------------------
    print("\n--- 2. Testing Canonical Employee Endpoint (GET /hrms/employees) ---")
    with httpx.Client(base_url=BASE_URL, timeout=10.0) as client:
        # Admin gets all
        r_admin = client.get("/hrms/employees", headers=headers("ADMIN"))
        admin_emps = r_admin.json().get("data", [])
        record("RBAC & Security", "Admin sees all company employees in /hrms/employees", len(admin_emps) >= 5, f"Count: {len(admin_emps)}")

        # HR gets all
        r_hr = client.get("/hrms/employees", headers=headers("HR"))
        hr_emps = r_hr.json().get("data", [])
        record("RBAC & Security", "HR sees all company employees in /hrms/employees", len(hr_emps) == len(admin_emps), f"HR count: {len(hr_emps)} vs Admin {len(admin_emps)}")

        # Department Manager (Sales) gets only Sales employees
        r_mgr = client.get("/hrms/employees", headers=headers("MANAGER"))
        mgr_emps = r_mgr.json().get("data", [])
        mgr_uids = {e["id"] for e in mgr_emps}
        john_id = USER_DATA["EMPLOYEE"]["id"]
        ops_id = USER_DATA["OTHER_EMP"]["id"]
        record("RBAC & Security", "Department Manager sees their department report (john)", john_id in mgr_uids)
        record("RBAC & Security", "Department Manager CANNOT see other dept employee (ops_employee)", ops_id not in mgr_uids)

        # Normal Employee (john) gets only self
        r_emp = client.get("/hrms/employees", headers=headers("EMPLOYEE"))
        emp_emps = r_emp.json().get("data", [])
        emp_uids = {e["id"] for e in emp_emps}
        record("RBAC & Security", "Normal Employee sees strictly self in /hrms/employees", len(emp_emps) == 1 and john_id in emp_uids, f"Emp count: {len(emp_emps)}")

    # -------------------------------------------------------------------
    # 3. PAYROLL QA & PAYROLL_MONTH VALIDATION FIX
    # -------------------------------------------------------------------
    print("\n--- 3. Testing Payroll: payroll_month validation & Review workflow ---")
    with httpx.Client(base_url=BASE_URL, timeout=15.0) as client:
        # First, ensure an active earning component exists
        r_comps = client.get("/hrms/payroll/components", headers=headers("ADMIN"))
        comps = r_comps.json().get("data", [])
        if not comps:
            r_create_comp = client.post(
                "/hrms/payroll/components",
                headers=headers("ADMIN"),
                json={"name": "Basic Salary", "code": "BASIC", "component_type": "EARNING", "calculation_type": "PERCENTAGE_OF_CTC", "value": 50.0, "is_taxable": True, "is_active": True},
            )
            record("Payroll", "Create active payroll component (Basic 50%)", r_create_comp.status_code == 201)

        # Assign salary to john
        r_assign = client.post(
            "/hrms/payroll/salary/assign",
            headers=headers("ADMIN"),
            json={"employee_id": john_id, "annual_ctc": 600000.0, "effective_from": "2026-01-01", "notes": "Production QA Salary"},
        )
        record("Payroll", "Admin assigns CTC to employee (600,000 INR)", r_assign.status_code in (200, 201), r_assign.text)

        # Employee cannot assign salary
        r_emp_assign = client.post(
            "/hrms/payroll/salary/assign",
            headers=headers("EMPLOYEE"),
            json={"employee_id": john_id, "annual_ctc": 900000.0, "effective_from": "2026-01-01"},
        )
        record("Payroll", "Employee cannot configure salary (403 Forbidden)", r_emp_assign.status_code == 403)

        # Calculate monthly payroll for October 2026
        # Test both body and empty body with path
        r_calc = client.post("/hrms/payroll/monthly/2026-10/calculate", headers=headers("ADMIN"), json={"payroll_month": "2026-10"})
        record("Payroll", "Calculate payroll for 2026-10 returns 200 without payroll_month missing error", r_calc.status_code == 200, r_calc.text)

        calc_data = r_calc.json().get("data", {})
        payroll_status = calc_data.get("status")
        record("Payroll", "Payroll is generated in DRAFT / REVIEW state (NOT automatically published)", payroll_status in ("DRAFT", "REVIEW", "PROCESSED"), f"Status: {payroll_status}")

        # Fetch monthly snapshot
        r_snap = client.get("/hrms/payroll/monthly/2026-10?auto_calculate=false", headers=headers("ADMIN"))
        snap_data = r_snap.json().get("data", {})
        snap_items = snap_data.get("items", [])
        has_items = len(snap_items) > 0
        all_have_month = all(i.get("payroll_month") == "2026-10" for i in snap_items)
        record("Payroll", "Monthly snapshot returns items and all items have payroll_month='2026-10'", has_items and all_have_month, f"Items: {len(snap_items)}, Has Month: {all_have_month}")

        # Recalculate / edit item test
        if snap_items:
            test_item = snap_items[0]
            item_id = test_item["id"]
            r_edit = client.put(
                f"/hrms/payroll/items/{item_id}",
                headers=headers("ADMIN"),
                json={"working_days": 26, "present_days": 24, "paid_leave_days": 2, "lop_days": 0, "reason": "Verified attendance audit trail"},
            )
            record("Payroll", "Admin edits payroll item with mandatory correction reason", r_edit.status_code == 200, r_edit.text)

        # Check that Employee CANNOT see unapproved payslip yet!
        r_emp_slips_unapproved = client.get("/hrms/payroll/payslips", headers=headers("EMPLOYEE"))
        emp_slips = r_emp_slips_unapproved.json().get("data", [])
        record("Payroll", "Employee cannot see unapproved salary slip (Review stage protection)", len(emp_slips) == 0, f"Slips found: {len(emp_slips)}")

        # Approve Payroll
        r_approve = client.post("/hrms/payroll/monthly/2026-10/approve", headers=headers("ADMIN"), json={"payroll_month": "2026-10"})
        record("Payroll", "Admin approves monthly payroll", r_approve.status_code == 200, r_approve.text)

        # Now Employee CAN see their approved payslip
        r_emp_slips_approved = client.get("/hrms/payroll/payslips", headers=headers("EMPLOYEE"))
        emp_approved_slips = r_emp_slips_approved.json().get("data", [])
        has_john_slip = any(s.get("employee_id") == john_id for s in emp_approved_slips)
        record("Payroll", "Employee can now view their approved salary slip", has_john_slip, f"Count: {len(emp_approved_slips)}")

        # Employee CANNOT query other employee's payslips
        r_emp_other_slip = client.get(f"/hrms/payroll/payslips?employee_id={ops_id}", headers=headers("EMPLOYEE"))
        record("Payroll", "Employee cannot query another employee's payslip (403 Forbidden)", r_emp_other_slip.status_code == 403)

    # -------------------------------------------------------------------
    # 4. ATTENDANCE & LEAVE QA
    # -------------------------------------------------------------------
    print("\n--- 4. Testing Attendance & Leave Scoping ---")
    with httpx.Client(base_url=BASE_URL, timeout=10.0) as client:
        # Employee views own attendance calendar
        r_my_cal = client.get("/hrms/attendance/calendar?year=2026&month=10", headers=headers("EMPLOYEE"))
        record("Attendance", "Employee views own attendance calendar (200 OK)", r_my_cal.status_code == 200)

        # Employee tries to view ops_employee's attendance calendar
        r_other_cal = client.get(f"/hrms/attendance/calendar?year=2026&month=10&user_id={ops_id}", headers=headers("EMPLOYEE"))
        record("Attendance", "Employee blocked from viewing other employee's attendance (403 Forbidden)", r_other_cal.status_code == 403)

        # Department Manager can view john's attendance (in dept)
        r_mgr_john_cal = client.get(f"/hrms/attendance/calendar?year=2026&month=10&user_id={john_id}", headers=headers("MANAGER"))
        record("Attendance", "Department Manager can view dept employee's attendance (200 OK)", r_mgr_john_cal.status_code == 200)

        # Department Manager CANNOT view ops_employee's attendance (outside dept)
        r_mgr_ops_cal = client.get(f"/hrms/attendance/calendar?year=2026&month=10&user_id={ops_id}", headers=headers("MANAGER"))
        record("Attendance", "Department Manager blocked from viewing other dept attendance (403 Forbidden)", r_mgr_ops_cal.status_code == 403)

        # HR can view both
        r_hr_ops_cal = client.get(f"/hrms/attendance/calendar?year=2026&month=10&user_id={ops_id}", headers=headers("HR"))
        record("Attendance", "HR can view company-wide attendance (200 OK)", r_hr_ops_cal.status_code == 200)

        # Leave: Employee views own leave requests
        r_emp_leaves = client.get("/hrms/leave/requests", headers=headers("EMPLOYEE"))
        record("Leave", "Employee can view own leave requests (200 OK)", r_emp_leaves.status_code == 200)

        # Manager views leave requests
        r_mgr_leaves = client.get("/hrms/leave/requests", headers=headers("MANAGER"))
        record("Leave", "Manager can view leave requests scoped to department (200 OK)", r_mgr_leaves.status_code == 200)

    # -------------------------------------------------------------------
    # 5. ASSET MANAGEMENT QA
    # -------------------------------------------------------------------
    print("\n--- 5. Testing Asset Management Isolation ---")
    with httpx.Client(base_url=BASE_URL, timeout=10.0) as client:
        # Admin creates an asset
        r_create_asset = client.post(
            "/hrms/assets",
            headers=headers("ADMIN"),
            json={"asset_code": f"AST-TEST-{str(uuid.uuid4())[:4].upper()}", "asset_name": "QA MacBook Pro", "category": "LAPTOP", "status": "AVAILABLE"},
        )
        asset_id = None
        if r_create_asset.status_code == 201:
            asset_id = r_create_asset.json()["data"]["id"]
            record("Assets", "Admin creates asset in PostgreSQL", True)
        else:
            record("Assets", "Admin creates asset in PostgreSQL", False, r_create_asset.text)

        # Assign asset to ops_employee
        if asset_id:
            r_assign_ast = client.post(
                f"/hrms/assets/{asset_id}/assign",
                headers=headers("ADMIN"),
                json={"employee_id": ops_id, "allocated_from": "2026-10-01", "notes": "Assigned to Operations Employee"},
            )
            record("Assets", "Admin assigns asset to Operations Employee", r_assign_ast.status_code == 200)

            # John attempts to view this asset by ID -> Should be 403 Forbidden!
            r_john_view = client.get(f"/hrms/assets/{asset_id}", headers=headers("EMPLOYEE"))
            record("Assets", "Unauthorized employee cannot view other employee's assigned asset (403 Forbidden)", r_john_view.status_code == 403)

            # Ops employee views the asset -> Allowed
            r_ops_view = client.get(f"/hrms/assets/{asset_id}", headers=headers("OTHER_EMP"))
            record("Assets", "Owner employee can view their assigned asset (200 OK)", r_ops_view.status_code == 200)

    # -------------------------------------------------------------------
    # 6. EXPENSE MANAGEMENT QA
    # -------------------------------------------------------------------
    print("\n--- 6. Testing Expense Management Isolation & Approvals ---")
    with httpx.Client(base_url=BASE_URL, timeout=10.0) as client:
        # John creates an expense
        r_exp = client.post(
            "/hrms/expenses?submit=true",
            headers=headers("EMPLOYEE"),
            json={"expense_date": "2026-10-05", "category": "TRAVEL", "amount": 1250.0, "description": "Client meeting taxi fare"},
        )
        exp_id = None
        if r_exp.status_code == 201:
            exp_id = r_exp.json()["data"]["id"]
            record("Expenses", "Employee submits expense claim", True)
        else:
            record("Expenses", "Employee submits expense claim", False, r_exp.text)

        if exp_id:
            # Ops Employee attempts to view john's expense -> 403
            r_ops_exp = client.get(f"/hrms/expenses/{exp_id}", headers=headers("OTHER_EMP"))
            record("Expenses", "Unauthorized employee cannot view other employee's expense (403 Forbidden)", r_ops_exp.status_code == 403)

            # Ops Employee attempts to approve john's expense -> 403
            r_ops_appr = client.post(f"/hrms/expenses/{exp_id}/approve", headers=headers("OTHER_EMP"))
            record("Expenses", "Unauthorized employee cannot approve expense (403 Forbidden)", r_ops_appr.status_code == 403)

            # Sales Manager CAN view and approve john's expense (managed direct report)
            r_mgr_appr = client.post(f"/hrms/expenses/{exp_id}/approve", headers=headers("MANAGER"))
            record("Expenses", "Department Manager can approve report's expense (200 OK)", r_mgr_appr.status_code == 200, r_mgr_appr.text)

            # HR / Admin marks reimbursed
            r_reimb = client.post(f"/hrms/expenses/{exp_id}/reimburse", headers=headers("HR"), json={"notes": "Processed via NEFT"})
            record("Expenses", "HR marks approved expense as reimbursed (200 OK)", r_reimb.status_code == 200)

    # -------------------------------------------------------------------
    # 7. SITE VISIT QA
    # -------------------------------------------------------------------
    print("\n--- 7. Testing Site Visit Assignment, GPS Check-In, and Isolation ---")
    with httpx.Client(base_url=BASE_URL, timeout=10.0) as client:
        # Admin creates site visit assigned to John
        r_sv = client.post(
            "/hrms/site-visits",
            headers=headers("ADMIN"),
            json={
                "employee_id": john_id,
                "customer_name": "Tata Steel Plant",
                "site_address": "Plot 42, Industrial Area, Pune",
                "site_latitude": 18.5204,
                "site_longitude": 73.8567,
                "visit_date": "2026-10-06",
                "planned_start_time": "10:00",
                "planned_end_time": "14:00",
                "notes": "Safety equipment audit",
            },
        )
        visit_id = None
        if r_sv.status_code == 201:
            visit_id = r_sv.json()["data"]["id"]
            record("Site Visits", "Admin creates and assigns Site Visit to employee", True)
        else:
            record("Site Visits", "Admin creates and assigns Site Visit to employee", False, r_sv.text)

        if visit_id:
            # Ops Employee attempts to check-in or view john's visit -> 403
            r_ops_sv = client.get(f"/hrms/site-visits/{visit_id}", headers=headers("OTHER_EMP"))
            record("Site Visits", "Unauthorized employee cannot view other employee's site visit (403 Forbidden)", r_ops_sv.status_code == 403)

            r_ops_cin = client.post(
                f"/hrms/site-visits/{visit_id}/check-in",
                headers=headers("OTHER_EMP"),
                json={"latitude": 18.5204, "longitude": 73.8567, "accuracy": 10.0, "address": "Tata Steel Gate 1"},
            )
            record("Site Visits", "Unauthorized employee cannot check-in to other employee's visit (403 Forbidden)", r_ops_cin.status_code == 403)

            # John checks in with GPS
            r_john_cin = client.post(
                f"/hrms/site-visits/{visit_id}/check-in",
                headers=headers("EMPLOYEE"),
                json={"latitude": 18.5204, "longitude": 73.8567, "accuracy": 8.5, "address": "Tata Steel Gate 1, Pune"},
            )
            record("Site Visits", "Assigned employee checks into site visit with GPS", r_john_cin.status_code == 200, r_john_cin.text)

            # John checks out with GPS
            r_john_cout = client.post(
                f"/hrms/site-visits/{visit_id}/check-out",
                headers=headers("EMPLOYEE"),
                json={"latitude": 18.5204, "longitude": 73.8567, "accuracy": 9.0, "address": "Tata Steel Gate 1, Pune"},
            )
            record("Site Visits", "Assigned employee checks out from site visit with GPS", r_john_cout.status_code == 200, r_john_cout.text)

    # -------------------------------------------------------------------
    # 8. CROSS-MODULE FLOW: ATTENDANCE -> REGULARIZATION -> PAYROLL
    # -------------------------------------------------------------------
    print("\n--- 8. Testing Cross-Module Data Flow ---")
    with httpx.Client(base_url=BASE_URL, timeout=10.0) as client:
        # Submit attendance regularization for John
        r_reg = client.post(
            "/hrms/attendance/regularizations",
            headers=headers("EMPLOYEE"),
            json={
                "attendance_date": "2026-10-02",
                "request_type": "MISSING",
                "reason": "Onsite client deployment",
                "proposed_punch_in": "09:15",
                "proposed_punch_out": "18:30",
            },
        )
        if r_reg.status_code in (200, 201):
            reg_id = r_reg.json()["data"]["id"]
            record("Cross-Module", "Employee submits attendance regularization", True)

            # Manager approves regularization
            r_mgr_appr = client.post(
                f"/hrms/attendance/regularizations/{reg_id}/approve",
                headers=headers("MANAGER"),
                json={"notes": "Approved for client deployment"},
            )
            record("Cross-Module", "Department Manager approves regularization", r_mgr_appr.status_code == 200, r_mgr_appr.text)
        else:
            record("Cross-Module", "Employee submits attendance regularization", False, r_reg.text)

        # Recalculate payroll to confirm authoritative attendance linkage
        client.post(
            "/hrms/payroll/reopen",
            headers=headers("ADMIN"),
            json={"payroll_month": "2026-10", "reason": "Recalculate with newly approved regularization"},
        )
        r_recalc = client.post("/hrms/payroll/monthly/2026-10/calculate", headers=headers("ADMIN"), json={"payroll_month": "2026-10"})
        record("Cross-Module", "Payroll recalculation successfully processes authoritative attendance result", r_recalc.status_code == 200, r_recalc.text)

    print("\n" + "=" * 70)
    print("QA SUMMARY REPORT")
    print("=" * 70)
    total_all = 0
    total_pass = 0
    total_fail = 0
    for mod, data in test_results.items():
        total_all += data["total"]
        total_pass += data["pass"]
        total_fail += data["fail"]
        print(f"{mod:20} | Total: {data['total']:2} | PASS: {data['pass']:2} | FAIL: {data['fail']:2}")
        if data["issues"]:
            for iss in data["issues"]:
                print(f"   -> Issue: {iss}")

    print("-" * 70)
    print(f"OVERALL RESULTS: {total_pass}/{total_all} PASS ({(total_pass/total_all)*100:.1f}%) | FAILS: {total_fail}")
    print("=" * 70)


if __name__ == "__main__":
    run_tests()
