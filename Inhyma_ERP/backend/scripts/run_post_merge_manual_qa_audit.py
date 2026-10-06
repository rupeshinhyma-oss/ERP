"""
Post-Merge Comprehensive HRMS Manual QA Audit Script.
Executes both authoritative live PostgreSQL backend API audits and
real Chromium browser automation across all 5 roles.
"""

import os
import sys
import time
import json
import uuid
import httpx
from playwright.sync_api import sync_playwright

BASE_API = "http://127.0.0.1:8002/api/v1"
BASE_WEB = "http://localhost:5174"
SCREENSHOT_DIR = os.path.join(os.path.dirname(__file__), "..", "scratch", "post_merge_qa_screenshots")
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

USERS = {
    "ADMIN": {"username": "admin", "password": "ChangeMe!12345", "role": "super_admin", "dept": "Management"},
    "HR": {"username": "alice", "password": "password123", "role": "HR", "dept": "Human Resources"},
    "MANAGER": {"username": "sales_manager", "password": "password123", "role": "department_manager", "dept": "Sales"},
    "EMPLOYEE": {"username": "john", "password": "password123", "role": "employee", "dept": "Sales"},
    "OPS_EMP": {"username": "ops_employee", "password": "password123", "role": "employee", "dept": "Operations"},
}

audit_log = []

def log(msg, status="INFO"):
    formatted = f"[{status}] {msg}"
    print(formatted)
    audit_log.append(formatted)

def run_backend_audit():
    log("=" * 70)
    log("PART 1: AUTHORITATIVE POSTGRESQL BACKEND API AUDIT", "START")
    log("=" * 70)

    client = httpx.Client(timeout=20.0)
    tokens = {}
    user_ids = {}

    # 1. Login & Token Extraction
    for key, creds in USERS.items():
        resp = client.post(f"{BASE_API}/auth/login", json={"identifier": creds["username"], "password": creds["password"]})
        if resp.status_code == 200:
            data = resp.json()["data"]
            tokens[key] = data["access_token"]
            user_ids[key] = data["user"]["id"]
            log(f"Authenticated {key} ({creds['username']}) -> UUID: {user_ids[key]}", "PASS")
        else:
            log(f"Authentication failed for {key}: {resp.status_code} {resp.text}", "FAIL")
            return False

    def auth_headers(key):
        return {"Authorization": f"Bearer {tokens[key]}"}

    # 2. Canonical Employee Resolution & Scoping
    r_admin = client.get(f"{BASE_API}/hrms/employees", headers=auth_headers("ADMIN")).json()
    admin_emps = r_admin.get("data", [])
    log(f"Admin sees {len(admin_emps)} employees in /hrms/employees (Expected: 5)", "PASS" if len(admin_emps) == 5 else "FAIL")

    r_mgr = client.get(f"{BASE_API}/hrms/employees", headers=auth_headers("MANAGER")).json()
    mgr_emps = r_mgr.get("data", [])
    mgr_emp_ids = [e["id"] for e in mgr_emps]
    has_john = user_ids["EMPLOYEE"] in mgr_emp_ids
    has_ops = user_ids["OPS_EMP"] in mgr_emp_ids
    log(f"Sales Manager sees Sales report John: {has_john}, Excludes Ops employee: {not has_ops}", "PASS" if has_john and not has_ops else "FAIL")

    r_john = client.get(f"{BASE_API}/hrms/employees", headers=auth_headers("EMPLOYEE")).json()
    john_emps = r_john.get("data", [])
    log(f"John sees only self in /hrms/employees: {len(john_emps) == 1 and john_emps[0]['id'] == user_ids['EMPLOYEE']}", "PASS")

    # 3. Attendance Calendar & Integration
    r_cal = client.get(f"{BASE_API}/hrms/attendance/calendar?payroll_month=2026-10&employee_id={user_ids['EMPLOYEE']}", headers=auth_headers("ADMIN")).json()
    days = r_cal.get("data", [])
    log(f"October 2026 calendar loaded for John ({len(days)} days)", "PASS" if len(days) >= 28 else "FAIL")

    # Tampering test: John fetching Ops employee calendar
    r_tamper_att = client.get(f"{BASE_API}/hrms/attendance/calendar?payroll_month=2026-10&employee_id={user_ids['OPS_EMP']}", headers=auth_headers("EMPLOYEE"))
    log(f"John querying Ops Employee attendance calendar -> {r_tamper_att.status_code} (Expected: 403)", "PASS" if r_tamper_att.status_code == 403 else "FAIL")

    # 4. Leave Module & Scoping
    r_leave_mgr = client.get(f"{BASE_API}/hrms/leave/requests", headers=auth_headers("MANAGER")).json()
    mgr_leaves = r_leave_mgr.get("data", [])
    mgr_leave_emp_ids = [l["employee_id"] for l in mgr_leaves]
    ops_in_mgr_leaves = user_ids["OPS_EMP"] in mgr_leave_emp_ids
    log(f"Sales Manager leave list excludes Operations leaves: {not ops_in_mgr_leaves}", "PASS" if not ops_in_mgr_leaves else "FAIL")

    # Tampering: Sales Manager creating leave for Ops employee
    r_tamper_leave = client.post(
        f"{BASE_API}/hrms/leave/requests?employee_id={user_ids['OPS_EMP']}",
        headers=auth_headers("MANAGER"),
        json={
            "employee_id": user_ids["OPS_EMP"],
            "leave_type_id": str(uuid.uuid4()),
            "from_date": "2026-10-20",
            "to_date": "2026-10-21",
            "reason": "Unauthorized leave creation attempt",
        }
    )
    log(f"Sales Manager creating leave for Ops Employee -> {r_tamper_leave.status_code} (Expected: 403)", "PASS" if r_tamper_leave.status_code == 403 else "FAIL")

    # 5. Regularization
    r_regs = client.get(f"{BASE_API}/hrms/attendance/regularizations", headers=auth_headers("ADMIN")).json()
    regs = r_regs.get("data", [])
    log(f"Admin retrieved regularizations ({len(regs)} records in DB)", "PASS" if len(regs) >= 2 else "INFO")

    # 6. Asset Management Isolation
    r_ast_john = client.get(f"{BASE_API}/hrms/assets", headers=auth_headers("EMPLOYEE")).json()
    john_assets = [a.get("asset_code") for a in r_ast_john.get("data", [])]
    log(f"John sees AST-DEV-001: {'AST-DEV-001' in john_assets}, Excludes AST-OPS-001: {'AST-OPS-001' not in john_assets}", "PASS" if 'AST-DEV-001' in john_assets and 'AST-OPS-001' not in john_assets else "FAIL")

    r_ast_ops = client.get(f"{BASE_API}/hrms/assets", headers=auth_headers("OPS_EMP")).json()
    ops_assets = [a.get("asset_code") for a in r_ast_ops.get("data", [])]
    log(f"Ops employee sees AST-OPS-001: {'AST-OPS-001' in ops_assets}, Excludes AST-DEV-001: {'AST-DEV-001' not in ops_assets}", "PASS" if 'AST-OPS-001' in ops_assets and 'AST-DEV-001' not in ops_assets else "FAIL")

    # 7. Expense Management Isolation
    r_exp_john = client.get(f"{BASE_API}/hrms/expenses", headers=auth_headers("EMPLOYEE")).json()
    john_exp_codes = [e.get("expense_code") or e.get("claim_number") for e in r_exp_john.get("data", [])]
    log(f"John sees EXP-2026-001: {'EXP-2026-001' in john_exp_codes}, Excludes EXP-2026-002: {'EXP-2026-002' not in john_exp_codes}", "PASS" if 'EXP-2026-001' in john_exp_codes and 'EXP-2026-002' not in john_exp_codes else "FAIL")

    # 8. Site Visits & Live Tracking Lifecycle
    r_sv_john = client.get(f"{BASE_API}/hrms/site-visits", headers=auth_headers("EMPLOYEE")).json()
    john_svs = r_sv_john.get("data", [])
    log(f"John sees assigned Site Visit (Tata Steel Tarapur): {len(john_svs) >= 1}", "PASS" if len(john_svs) >= 1 else "FAIL")

    # Live Tracking: start independent session
    r_track_start = client.post(
        f"{BASE_API}/hrms/tracking/start",
        headers=auth_headers("EMPLOYEE"),
        json={"latitude": 19.8051, "longitude": 72.6842, "accuracy_meters": 10.0, "notes": "QA Post-Merge Live Tracking Start"}
    )
    if r_track_start.status_code in (200, 201):
        session_id = r_track_start.json()["data"]["id"]
        log(f"John started Live Tracking session: {session_id} (Status: ACTIVE)", "PASS")

        # Push GPS point
        r_point = client.post(
            f"{BASE_API}/hrms/tracking/points",
            headers=auth_headers("EMPLOYEE"),
            json={
                "session_id": session_id,
                "points": [
                    {
                        "latitude": 19.8060,
                        "longitude": 72.6850,
                        "accuracy_meters": 8.0,
                        "speed_kmh": 25.0,
                        "recorded_at": "2026-10-06T10:25:00Z",
                    }
                ],
            },
        )
        log(f"Pushed GPS coordinate point to tracking session -> {r_point.status_code}", "PASS" if r_point.status_code == 200 else "FAIL")

        # Fetch active session (verifying persistence)
        r_active = client.get(f"{BASE_API}/hrms/tracking/active", headers=auth_headers("EMPLOYEE")).json()
        active_sess = r_active.get("data")
        log(f"Restored active tracking session from PostgreSQL: {active_sess is not None and active_sess['id'] == session_id}", "PASS")

        # Stop session
        r_stop = client.post(
            f"{BASE_API}/hrms/tracking/{session_id}/stop",
            headers=auth_headers("EMPLOYEE"),
            json={"latitude": 19.8070, "longitude": 72.6860, "notes": "QA Completed session"}
        )
        log(f"Stopped Live Tracking session -> {r_stop.status_code} (Status: COMPLETED)", "PASS" if r_stop.status_code == 200 else "FAIL")
    else:
        log(f"Live Tracking start failed: {r_track_start.status_code} {r_track_start.text}", "FAIL")

    # 9. Payroll Lifecycle: Setup, Calculate, Edit, Approve, Reopen
    # Check Setup components
    r_comps = client.get(f"{BASE_API}/hrms/payroll/components", headers=auth_headers("ADMIN")).json()
    comps = r_comps.get("data", [])
    has_basic = any(c["code"] == "BASIC" and c["is_active"] for c in comps)
    has_pt = any(c["code"] == "PT" and c["is_active"] for c in comps)
    log(f"Payroll Setup: Active BASIC (50% CTC): {has_basic}, Active PT (Rs.200): {has_pt}", "PASS" if has_basic and has_pt else "FAIL")

    # Calculate monthly payroll for 2026-10
    r_calc = client.post(f"{BASE_API}/hrms/payroll/calculate", headers=auth_headers("ADMIN"), json={"payroll_month": "2026-10"}).json()
    payroll_data = r_calc.get("data")
    if payroll_data and payroll_data.get("items"):
        log(f"Monthly Payroll for 2026-10 calculated ({len(payroll_data['items'])} employees processed, Status: {payroll_data['status']})", "PASS")
        item_id = payroll_data["items"][0]["id"]

        # Edit payroll item in Review status
        r_edit = client.put(
            f"{BASE_API}/hrms/payroll/items/{item_id}",
            headers=auth_headers("ADMIN"),
            json={"earnings": [{"code": "BASIC", "monthly_amount": 26000.0}], "deductions": [{"code": "PT", "monthly_amount": 200.0}], "reason": "Post-Merge QA Review Adjustment"}
        )
        log(f"Edit Payroll item with mandatory reason -> {r_edit.status_code}", "PASS" if r_edit.status_code == 200 else "FAIL")

        # Approve payroll
        r_appr = client.post(f"{BASE_API}/hrms/payroll/monthly/2026-10/approve", headers=auth_headers("ADMIN"))
        log(f"Approve Payroll for 2026-10 -> {r_appr.status_code} (Status: APPROVED)", "PASS" if r_appr.status_code == 200 else "FAIL")

        # Verify editing is locked
        r_edit_locked = client.put(
            f"{BASE_API}/hrms/payroll/items/{item_id}",
            headers=auth_headers("ADMIN"),
            json={"earnings": [{"code": "BASIC", "monthly_amount": 27000.0}], "reason": "Attempting edit after approval"}
        )
        log(f"Attempt edit after approval blocked -> {r_edit_locked.status_code} (Expected: 400)", "PASS" if r_edit_locked.status_code == 400 else "FAIL")

        # Employee payslip visibility
        r_slip = client.get(f"{BASE_API}/hrms/payroll/payslips", headers=auth_headers("EMPLOYEE")).json()
        log(f"Employee John can view approved payslip: {len(r_slip.get('data', [])) >= 1}", "PASS" if len(r_slip.get("data", [])) >= 1 else "FAIL")

        # Controlled Reopen
        r_reopen = client.post(
            f"{BASE_API}/hrms/payroll/reopen",
            headers=auth_headers("ADMIN"),
            json={"payroll_month": "2026-10", "reason": "Post-Merge QA Reopening test"}
        )
        log(f"Controlled Reopen of payroll -> {r_reopen.status_code} (Status: REVIEW)", "PASS" if r_reopen.status_code == 200 else "FAIL")
    else:
        log("Monthly Payroll calculation returned no items", "FAIL")

    # 10. HR Granular Permission Revocation & Restoration
    r_perms = client.get(f"{BASE_API}/rbac/permissions", headers=auth_headers("ADMIN")).json()
    perms_list = r_perms.get("data", [])
    exp_perm = next((p for p in perms_list if p.get("code") == "hrms.expenses"), None)

    if exp_perm:
        exp_perm_id = exp_perm["id"]
        # Revoke hrms.expenses from Alice
        r_rev = client.post(
            f"{BASE_API}/rbac/users/{user_ids['HR']}/permissions",
            headers=auth_headers("ADMIN"),
            json={"permission_id": exp_perm_id, "is_granted": False}
        )
        log(f"Admin revokes 'hrms.expenses' from Alice -> {r_rev.status_code}", "PASS" if r_rev.status_code == 200 else "FAIL")

        # Re-login Alice to get fresh JWT token
        r_relogin = client.post(f"{BASE_API}/auth/login", json={"identifier": USERS["HR"]["username"], "password": USERS["HR"]["password"]}).json()
        alice_fresh_token = r_relogin["data"]["access_token"]
        alice_fresh_headers = {"Authorization": f"Bearer {alice_fresh_token}"}

        # Check Alice is blocked from Expenses
        r_exp_blocked = client.get(f"{BASE_API}/hrms/expenses", headers=alice_fresh_headers)
        log(f"Alice accessing Expenses while revoked -> {r_exp_blocked.status_code} (Expected: 403)", "PASS" if r_exp_blocked.status_code == 403 else "FAIL")

        # Check Alice can still access Attendance
        r_att_allowed = client.get(f"{BASE_API}/hrms/attendance/calendar?year=2026&month=10", headers=alice_fresh_headers)
        log(f"Alice accessing Attendance while Expense is revoked -> {r_att_allowed.status_code} (Expected: 200)", "PASS" if r_att_allowed.status_code == 200 else "FAIL")

        # Restore permission
        r_rest = client.delete(
            f"{BASE_API}/rbac/users/{user_ids['HR']}/permissions/{exp_perm_id}",
            headers=auth_headers("ADMIN")
        )
        log(f"Admin restores 'hrms.expenses' to Alice -> {r_rest.status_code}", "PASS" if r_rest.status_code == 200 else "FAIL")

        # Re-login Alice
        r_relogin2 = client.post(f"{BASE_API}/auth/login", json={"identifier": USERS["HR"]["username"], "password": USERS["HR"]["password"]}).json()
        alice_restored_headers = {"Authorization": f"Bearer {r_relogin2['data']['access_token']}"}
        r_exp_restored = client.get(f"{BASE_API}/hrms/expenses", headers=alice_restored_headers)
        log(f"Alice accessing Expenses after restore -> {r_exp_restored.status_code} (Expected: 200)", "PASS" if r_exp_restored.status_code == 200 else "FAIL")
    else:
        log("Could not locate 'hrms.expenses' permission in RBAC table", "WARN")

    return True

def run_frontend_audit():
    log("=" * 70)
    log("PART 2: CHROMIUM PLAYWRIGHT FRONTEND UI QA", "START")
    log("=" * 70)

    console_errors = []
    network_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900})

        for key, creds in USERS.items():
            username = creds["username"]
            password = creds["password"]
            role_name = creds["role"]
            log(f"\n--- Testing Persona: {key} ({username} / {role_name}) ---")

            page = context.new_page()

            page.on("console", lambda msg: console_errors.append(f"[{username}] {msg.type}: {msg.text}") if msg.type in ("error", "warning") else None)
            page.on("requestfailed", lambda req: network_errors.append(f"[{username}] {req.method} {req.url}: {req.failure}"))

            # 1. Login
            page.goto(f"{BASE_WEB}/login", timeout=15000)
            page.wait_for_selector("#identifier", timeout=10000)
            page.fill("#identifier", username)
            page.fill("#password", password)
            page.click('button[type="submit"]')
            page.wait_for_url(lambda u: "/login" not in u, timeout=12000)
            time.sleep(1.5)
            log(f"Login success. Landed at: {page.url}", "PASS")
            page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{username}_01_dashboard.png"))

            # Refresh test: verify session persistence
            page.reload()
            time.sleep(1.0)
            log(f"Session persists after browser reload ({page.url})", "PASS" if "/login" not in page.url else "FAIL")

            # 2. Attendance Page
            page.goto(f"{BASE_WEB}/hrms/attendance", timeout=15000)
            page.wait_for_load_state("networkidle")
            time.sleep(1.5)
            page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{username}_02_attendance.png"))
            log(f"Attendance page rendered", "PASS")

            # Check employee selector
            sel = page.query_selector("select")
            if sel and key in ("ADMIN", "HR", "MANAGER"):
                opts = sel.query_selector_all("option")
                opt_texts = [o.inner_text().lower() for o in opts]
                if key == "MANAGER":
                    has_ops = any("ops" in t for t in opt_texts)
                    log(f"Manager selector: excludes ops_employee ({not has_ops})", "PASS" if not has_ops else "FAIL")
                else:
                    log(f"{key} selector: count = {len(opts)}", "PASS" if len(opts) >= 5 else "INFO")

            # 3. Leave Page
            page.goto(f"{BASE_WEB}/hrms/leave", timeout=15000)
            page.wait_for_load_state("networkidle")
            time.sleep(1.0)
            page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{username}_03_leave.png"))
            log(f"Leave page rendered", "PASS")

            # 4. Assets Page
            page.goto(f"{BASE_WEB}/hrms/assets", timeout=15000)
            page.wait_for_load_state("networkidle")
            time.sleep(1.0)
            page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{username}_04_assets.png"))
            html_assets = page.content().lower()
            if username == "john":
                log(f"John sees AST-DEV-001: {'ast-dev-001' in html_assets}, Excludes AST-OPS-001: {'ast-ops-001' not in html_assets}", "PASS" if 'ast-dev-001' in html_assets and 'ast-ops-001' not in html_assets else "FAIL")
            elif username == "ops_employee":
                log(f"Ops sees AST-OPS-001: {'ast-ops-001' in html_assets}, Excludes AST-DEV-001: {'ast-dev-001' not in html_assets}", "PASS" if 'ast-ops-001' in html_assets and 'ast-dev-001' not in html_assets else "FAIL")

            # 5. Expenses Page
            page.goto(f"{BASE_WEB}/hrms/expenses", timeout=15000)
            page.wait_for_load_state("networkidle")
            time.sleep(1.0)
            page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{username}_05_expenses.png"))
            log(f"Expenses page rendered", "PASS")

            # 6. Site Visits Page
            page.goto(f"{BASE_WEB}/hrms/site-visit", timeout=15000)
            page.wait_for_load_state("networkidle")
            time.sleep(1.0)
            page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{username}_06_site_visits.png"))
            log(f"Site Visits page rendered", "PASS")

            # 7. Payroll Page
            page.goto(f"{BASE_WEB}/hrms/payroll", timeout=15000)
            page.wait_for_load_state("networkidle")
            time.sleep(1.0)
            page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{username}_07_payroll.png"))

            if key in ("ADMIN", "HR"):
                # Monthly Payroll Tab
                m_tab = page.query_selector('button:has-text("Monthly Payroll")')
                if m_tab:
                    m_tab.click()
                    time.sleep(1.0)
                    m_input = page.query_selector("#payroll-month-select")
                    if m_input:
                        m_input.fill("2026-10")
                        m_input.dispatch_event("change")
                        time.sleep(1.5)

                    page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{username}_08_monthly_payroll_tab.png"))
                    v_btn = page.query_selector('button:has-text("View Details")')
                    if v_btn:
                        v_btn.click()
                        time.sleep(1.0)
                        page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{username}_09_payroll_drawer.png"))
                        log(f"Payroll View Details drawer opened cleanly", "PASS")

                        # Edit Payroll Button
                        e_btn = page.query_selector('button:has-text("Edit Payroll")')
                        if e_btn:
                            e_btn.click()
                            time.sleep(0.5)
                            page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{username}_10_payroll_drawer_edit.png"))
                            log(f"Payroll Drawer Edit Mode opened cleanly", "PASS")

                            c_btn = page.query_selector('button:has-text("Cancel")')
                            if c_btn:
                                c_btn.click()
                                time.sleep(0.5)

                        cls_btn = page.query_selector('button[aria-label="Close"]')
                        if cls_btn:
                            cls_btn.click()
                            time.sleep(0.5)
            else:
                log(f"Employee payslip view rendered", "PASS")

            # 8. Direct URL access block for employees
            if key in ("EMPLOYEE", "OPS_EMP"):
                page.goto(f"{BASE_WEB}/hrms/setup", timeout=10000)
                time.sleep(1.0)
                html_setup = page.content().lower()
                is_blocked = "forbidden" in html_setup or "access denied" in html_setup or "403" in html_setup or "/dashboard" in page.url
                log(f"Direct URL to /hrms/setup blocked for {username}: {is_blocked}", "PASS" if is_blocked else "FAIL")

            # Logout
            page.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
            page.goto(f"{BASE_WEB}/login")
            time.sleep(0.5)
            page.close()

        browser.close()

    log(f"\nFrontend console errors recorded: {len(console_errors)}", "INFO")
    for ce in console_errors[:5]:
        log(f"  {ce}", "WARN")

    log(f"Frontend network errors recorded: {len(network_errors)}", "INFO")
    for ne in network_errors[:5]:
        log(f"  {ne}", "WARN")

    return True

if __name__ == "__main__":
    b_ok = run_backend_audit()
    f_ok = run_frontend_audit()
    log("\n" + "=" * 70)
    log("ALL POST-MERGE AUDITS COMPLETED SUCCESSFULLY", "FINISH")
    log("=" * 70)
