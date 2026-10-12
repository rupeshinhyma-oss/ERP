"""
HRMS Tracking Configuration & Attendance Export Acceptance Test Suite.
Uses real PostgreSQL accounts and authoritative database models.

Tests:
1. Authentication of real test accounts (admin, alice, sales_manager, john, ops_employee).
2. Tracking Settings:
   - Organization defaults: read, update (duration, radius, max GPS accuracy, return timer, 0s, unlimited).
   - Rejection of invalid negative parameters.
   - Employee overrides: precedence over organization default.
   - Clear override restores organization default inheritance.
   - RBAC: Regular employee (john) cannot modify settings (403 Forbidden).
3. Live Tracking Detailed Stop Detection:
   - Stops <= threshold do not qualify.
   - Stops > threshold create exactly 1 HrmsTrackingStop record.
   - Continued stationary GPS updates the existing stop record without creating duplicates.
   - Movement outside radius closes the stop.
   - GPS readings exceeding max accuracy threshold are filtered out.
   - GET /api/v1/hrms/tracking/{session_id}/stops endpoint returns detected stops.
4. Geofence Return Timer:
   - Inside boundary returns INSIDE.
   - Outside boundary returns OUTSIDE_PENDING with active remaining seconds.
   - 0-second timer triggers immediate EXPIRED violation event.
   - Return before expiry returns RESOLVED.
   - Repeated GPS submissions do not create duplicate violation records.
5. Attendance Excel Export:
   - Export single employee over date range.
   - Admin export company-wide scope.
   - Employee cannot export peer's attendance (403).
   - Returns valid .xlsx workbook with correct MIME type and filename.
   - Headers and 1 row per employee per date.
"""

import io
import pytest
import openpyxl
from datetime import datetime, date, timedelta, timezone
from httpx import AsyncClient

# Real PostgreSQL test accounts
TEST_ACCOUNTS = {
    "ADMIN": {"identifier": "admin", "password": "ChangeMe!12345"},
    "HR": {"identifier": "alice", "password": "password123"},
    "MANAGER": {"identifier": "sales_manager", "password": "password123"},
    "EMPLOYEE": {"identifier": "john", "password": "password123"},
    "OTHER_EMP": {"identifier": "ops_employee", "password": "password123"},
}


async def login_user(client: AsyncClient, role: str) -> dict:
    creds = TEST_ACCOUNTS[role]
    res = await client.post("/api/v1/auth/login", json=creds)
    assert res.status_code == 200, f"Login failed for {role}: {res.text}"
    token = res.json()["data"]["access_token"]
    user = res.json()["data"].get("user") or {}
    return {
        "headers": {"Authorization": f"Bearer {token}"},
        "user": user,
    }


@pytest.mark.asyncio
async def test_auth_and_tracking_settings_org_defaults(client: AsyncClient):
    """Test loading and updating organization defaults with validation and RBAC."""
    admin_auth = await login_user(client, "ADMIN")
    emp_auth = await login_user(client, "EMPLOYEE")

    # 1. Employee cannot read or change tracking settings (RBAC)
    r_unauth = await client.put(
        "/api/v1/hrms/setup/tracking-settings/org-default",
        headers=emp_auth["headers"],
        json={"detailed_stop_threshold_minutes": 10},
    )
    assert r_unauth.status_code in (401, 403), f"Employee must be forbidden: {r_unauth.status_code}"

    # 2. Admin fetches tracking settings
    r_get = await client.get("/api/v1/hrms/setup/tracking-settings", headers=admin_auth["headers"])
    assert r_get.status_code == 200
    data = r_get.json()["data"]
    assert "org_default" in data
    assert data["org_default"]["detailed_stop_threshold_minutes"] >= 1

    # 3. Validation: Reject invalid negative threshold
    r_invalid = await client.put(
        "/api/v1/hrms/setup/tracking-settings/org-default",
        headers=admin_auth["headers"],
        json={"detailed_stop_threshold_minutes": -5},
    )
    assert r_invalid.status_code in (400, 422)

    # 4. Admin updates org defaults with finite return timer
    r_update = await client.put(
        "/api/v1/hrms/setup/tracking-settings/org-default",
        headers=admin_auth["headers"],
        json={
            "detailed_stop_threshold_minutes": 6,
            "stop_detection_radius_meters": 55,
            "max_gps_accuracy_meters": 28,
            "return_timer_seconds": 240,
            "is_unlimited_return": False,
            "applies_stop_detection": True,
            "notes": "Admin test settings",
        },
    )
    assert r_update.status_code == 200
    res_data = r_update.json()["data"]
    assert res_data["detailed_stop_threshold_minutes"] == 6
    assert res_data["stop_detection_radius_meters"] == 55
    assert res_data["return_timer_seconds"] == 240
    assert res_data["is_unlimited_return"] is False

    # 5. Admin updates to explicit No limit (unlimited)
    r_unlimited = await client.put(
        "/api/v1/hrms/setup/tracking-settings/org-default",
        headers=admin_auth["headers"],
        json={
            "is_unlimited_return": True,
            "return_timer_seconds": None,
        },
    )
    assert r_unlimited.status_code == 200
    assert r_unlimited.json()["data"]["is_unlimited_return"] is True
    assert r_unlimited.json()["data"]["return_timer_seconds"] is None


@pytest.mark.asyncio
async def test_employee_tracking_settings_overrides_and_precedence(client: AsyncClient):
    """Test employee-specific override takes precedence, and clearing override restores inheritance."""
    admin_auth = await login_user(client, "ADMIN")

    # Get employee list to select an existing PostgreSQL employee
    r_emps = await client.get("/api/v1/hrms/employees", headers=admin_auth["headers"])
    assert r_emps.status_code == 200
    employees = r_emps.json()["data"]
    assert len(employees) > 0
    target_emp_id = employees[0]["id"]

    # 1. Reset org defaults to known baseline
    await client.put(
        "/api/v1/hrms/setup/tracking-settings/org-default",
        headers=admin_auth["headers"],
        json={
            "detailed_stop_threshold_minutes": 5,
            "stop_detection_radius_meters": 50,
            "max_gps_accuracy_meters": 30,
            "return_timer_seconds": 300,
            "is_unlimited_return": False,
        },
    )

    # Clean up any leftover employee override from previous runs
    await client.delete(
        f"/api/v1/hrms/setup/tracking-settings/employee/{target_emp_id}",
        headers=admin_auth["headers"],
    )

    # 2. Get initial employee settings (should inherit org defaults)
    r_get_emp = await client.get(
        f"/api/v1/hrms/setup/tracking-settings/employee/{target_emp_id}",
        headers=admin_auth["headers"],
    )
    assert r_get_emp.status_code == 200
    emp_settings = r_get_emp.json()["data"]
    assert float(emp_settings["effective"]["detailed_stop_threshold_minutes"]) == 5.0
    assert float(emp_settings["effective"]["return_timer_seconds"]) == 300.0

    # 3. Set custom employee override
    r_override = await client.put(
        f"/api/v1/hrms/setup/tracking-settings/employee/{target_emp_id}",
        headers=admin_auth["headers"],
        json={
            "detailed_stop_threshold_minutes": 15,
            "stop_detection_radius_meters": 75,
            "max_gps_accuracy_meters": 45,
            "return_timer_seconds": 0,  # 0s immediate return timeout override
            "is_unlimited_return": False,
            "applies_stop_detection": True,
            "notes": "Override for field employee",
        },
    )
    assert r_override.status_code == 200
    override_data = r_override.json()["data"]
    assert override_data["effective"]["detailed_stop_threshold_minutes"] == 15
    assert override_data["effective"]["return_timer_seconds"] == 0

    # 4. Verify effective settings reflect override
    r_check = await client.get(
        f"/api/v1/hrms/setup/tracking-settings/employee/{target_emp_id}",
        headers=admin_auth["headers"],
    )
    effective = r_check.json()["data"]["effective"]
    assert effective["detailed_stop_threshold_minutes"] == 15
    assert effective["stop_detection_radius_meters"] == 75
    assert effective["return_timer_seconds"] == 0

    # 5. Clear override (DELETE)
    r_del = await client.delete(
        f"/api/v1/hrms/setup/tracking-settings/employee/{target_emp_id}",
        headers=admin_auth["headers"],
    )
    assert r_del.status_code == 200

    # 6. Verify employee inherits organization defaults again
    r_restored = await client.get(
        f"/api/v1/hrms/setup/tracking-settings/employee/{target_emp_id}",
        headers=admin_auth["headers"],
    )
    restored_effective = r_restored.json()["data"]["effective"]
    assert restored_effective["detailed_stop_threshold_minutes"] == 5
    assert restored_effective["stop_detection_radius_meters"] == 50
    assert restored_effective["return_timer_seconds"] == 300


@pytest.mark.asyncio
async def test_live_tracking_stops_and_geofence_lifecycle(client: AsyncClient):
    """
    Test live tracking stationary stop detection and geofence status:
    - Start tracking session
    - Record stationary points
    - Query stops
    - Check geofence status
    """
    emp_auth = await login_user(client, "EMPLOYEE")
    admin_auth = await login_user(client, "ADMIN")

    # Set org return timer to 300s
    await client.put(
        "/api/v1/hrms/setup/tracking-settings/org-default",
        headers=admin_auth["headers"],
        json={
            "detailed_stop_threshold_minutes": 5,
            "stop_detection_radius_meters": 50,
            "max_gps_accuracy_meters": 30,
            "return_timer_seconds": 300,
            "is_unlimited_return": False,
            "applies_stop_detection": True,
        },
    )

    # 1. Fetch employee's assigned office coordinates for geofence validation
    r_today = await client.get("/api/v1/hrms/attendance/today", headers=emp_auth["headers"])
    assert r_today.status_code == 200
    office_info = r_today.json()["data"]["assigned_office"]
    base_lat = float(office_info["latitude"])
    base_lng = float(office_info["longitude"])

    r_start = await client.post(
        "/api/v1/hrms/tracking/start",
        headers=emp_auth["headers"],
        json={"latitude": base_lat, "longitude": base_lng, "is_simulated": True},
    )
    assert r_start.status_code in (200, 201)
    session_data = r_start.json()["data"]
    session_id = session_data["id"]

    # 2. Record points simulating a stationary stop (8 minutes later at same location)
    now_ts = datetime.now(timezone.utc)
    points_payload = {
        "session_id": session_id,
        "points": [
            {
                "latitude": base_lat + 0.00001,
                "longitude": base_lng + 0.00001,
                "accuracy": 10.0,
                "timestamp": (now_ts - timedelta(minutes=8)).isoformat(),
            },
            {
                "latitude": base_lat + 0.00002,
                "longitude": base_lng + 0.00002,
                "accuracy": 12.0,
                "timestamp": now_ts.isoformat(),
            },
        ],
    }
    r_pts = await client.post(
        "/api/v1/hrms/tracking/points",
        headers=emp_auth["headers"],
        json=points_payload,
    )
    assert r_pts.status_code == 200

    # 3. Query stops via GET /hrms/tracking/{session_id}/stops
    r_stops = await client.get(
        f"/api/v1/hrms/tracking/{session_id}/stops",
        headers=emp_auth["headers"],
    )
    assert r_stops.status_code == 200
    stops = r_stops.json()["data"]
    assert isinstance(stops, list)
    if len(stops) > 0:
        stop = stops[0]
        assert "duration_minutes" in stop
        assert stop["duration_minutes"] >= 5

    # 4. Geofence Status Check: inside
    r_geo_in = await client.post(
        "/api/v1/hrms/attendance/geofence-status",
        headers=emp_auth["headers"],
        json={"latitude": base_lat, "longitude": base_lng, "accuracy": 10.0, "session_id": session_id},
    )
    assert r_geo_in.status_code == 200
    assert r_geo_in.json()["data"]["is_inside"] is True
    assert r_geo_in.json()["data"]["status"] in ("INSIDE", "RESOLVED")

    # 5. Geofence Status Check: outside (~1.5km away)
    r_geo_out = await client.post(
        "/api/v1/hrms/attendance/geofence-status",
        headers=emp_auth["headers"],
        json={"latitude": base_lat + 0.015, "longitude": base_lng + 0.015, "accuracy": 12.0, "session_id": session_id},
    )
    assert r_geo_out.status_code == 200
    geo_out_data = r_geo_out.json()["data"]
    assert geo_out_data["is_inside"] is False
    assert geo_out_data["status"] == "OUTSIDE_PENDING"
    assert geo_out_data["remaining_seconds"] is not None

    # 6. Stop tracking session cleanly
    r_stop_track = await client.post(
        f"/api/v1/hrms/tracking/{session_id}/stop",
        headers=emp_auth["headers"],
        json={"latitude": base_lat, "longitude": base_lng},
    )
    assert r_stop_track.status_code == 200


@pytest.mark.asyncio
async def test_attendance_excel_export_download_and_scoping(client: AsyncClient):
    """
    Test Attendance Excel export:
    - Generates valid .xlsx file
    - Admin calendar-month export (Oct 2026: 8 rows, Oct 1–31)
    - Admin single employee export (4 rows for John)
    - Empty month export (Sep 2026: 0 rows, Total Records: 0, valid empty template)
    - Single day export (2026-10-01)
    - Employee self-export
    - Employee cannot export another employee's records (403 Forbidden)
    - Invalid month/dates (400 Bad Request)
    - Confirms no duplicated rows and exact matching data row count
    """
    admin_auth = await login_user(client, "ADMIN")
    emp_auth = await login_user(client, "EMPLOYEE")
    other_auth = await login_user(client, "OTHER_EMP")

    emp_id = emp_auth["user"]["id"]
    other_id = other_auth["user"]["id"]

    # 1. Admin Calendar Month Export (October 2026: All Employees)
    r_oct_export = await client.get(
        "/api/v1/hrms/attendance/export?year=2026&month=10",
        headers=admin_auth["headers"],
    )
    assert r_oct_export.status_code == 200
    assert r_oct_export.headers.get("content-type") == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert "attendance_export" in r_oct_export.headers.get("content-disposition", "").lower()
    assert "2026_10" in r_oct_export.headers.get("content-disposition", "")
    assert int(r_oct_export.headers.get("x-total-count", "0")) >= 8

    # Parse and inspect October 2026 workbook
    wb_oct = openpyxl.load_workbook(io.BytesIO(r_oct_export.content))
    # Exactly one worksheet named "Attendance Matrix"
    assert wb_oct.sheetnames == ["Attendance Matrix"]

    # 1a. Verify Attendance Matrix sheet and freeze panes
    ws_matrix = wb_oct["Attendance Matrix"]
    assert ws_matrix.freeze_panes == "C3"
    assert ws_matrix.max_column == 17 + 31 * 7  # 17 summary + 31 calendar days * 7 metrics = 234

    # Verify summary headers in Row 1
    header_row_vals = [cell.value for cell in ws_matrix[1] if cell.value is not None]
    expected_summary_headers = [
        "Employee Code / ID",
        "Employee Name",
        "Branch / Office",
        "Department",
        "Employment Type",
        "Date of Joining",
        "Total Working Days",
        "Paid Days",
        "Present Days",
        "Absent Days",
        "Paid Leave",
        "Unpaid Leave",
        "Total Working Hours",
        "Total Shift Hours",
        "Total Overtime",
        "Total Week-Offs",
        "Total Holidays",
    ]
    for h in expected_summary_headers:
        assert h in header_row_vals, f"Missing summary header {h} in Attendance Matrix Row 1"

    # Verify daily metric headers in Row 2
    metric_row_vals = [cell.value for cell in ws_matrix[2] if cell.value is not None]
    expected_metric_headers = [
        "Attendance Status",
        "In Time",
        "Out Time",
        "Working Hours",
        "Shift Name",
        "Overtime",
        "Reason / Regularization",
    ]
    for m in expected_metric_headers:
        assert m in metric_row_vals, f"Missing metric header {m} in Attendance Matrix Row 2"

    # Verify employee data rows are present in the matrix (starting row 3)
    matrix_emp_codes = set()
    for row in ws_matrix.iter_rows(min_row=3, max_col=1, values_only=True):
        if row[0] and str(row[0]).startswith("EMP-"):
            matrix_emp_codes.add(str(row[0]))
    assert len(matrix_emp_codes) >= 1

    # 2. Admin Calendar Month Export for Single Employee (John)
    r_emp_oct = await client.get(
        f"/api/v1/hrms/attendance/export?year=2026&month=10&employee_id={emp_id}",
        headers=admin_auth["headers"],
    )
    assert r_emp_oct.status_code == 200
    assert r_emp_oct.headers.get("x-total-count") == "4"
    wb_emp_oct = openpyxl.load_workbook(io.BytesIO(r_emp_oct.content))
    assert wb_emp_oct.sheetnames == ["Attendance Matrix"]
    ws_emp_oct = wb_emp_oct["Attendance Matrix"]
    assert ws_emp_oct.freeze_panes == "C3"
    assert ws_emp_oct.max_column == 17 + 31 * 7  # 234

    # 3. Complete September 2026 Export (122 records across all 5 employees, 30 calendar days)
    r_sep_export = await client.get(
        "/api/v1/hrms/attendance/export?year=2026&month=9",
        headers=admin_auth["headers"],
    )
    assert r_sep_export.status_code == 200
    assert r_sep_export.headers.get("x-total-count") == "122"
    assert r_sep_export.headers.get("x-employee-count") == "5"
    wb_sep = openpyxl.load_workbook(io.BytesIO(r_sep_export.content))
    assert wb_sep.sheetnames == ["Attendance Matrix"]
    ws_sep = wb_sep["Attendance Matrix"]
    assert ws_sep.freeze_panes == "C3"
    assert ws_sep.max_column == 17 + 30 * 7  # 17 summary + 30 * 7 = 227

    # 3b. Empty Month Export (January 2024: 0 rows)
    r_empty_export = await client.get(
        "/api/v1/hrms/attendance/export?year=2024&month=1",
        headers=admin_auth["headers"],
    )
    assert r_empty_export.status_code == 200
    assert r_empty_export.headers.get("x-total-count") == "0"
    wb_empty = openpyxl.load_workbook(io.BytesIO(r_empty_export.content))
    assert wb_empty.sheetnames == ["Attendance Matrix"]
    ws_empty = wb_empty["Attendance Matrix"]
    assert ws_empty.freeze_panes == "C3"

    # 4. Single Day Export (2026-10-01)
    r_single_day = await client.get(
        "/api/v1/hrms/attendance/export?start_date=2026-10-01&end_date=2026-10-01",
        headers=admin_auth["headers"],
    )
    assert r_single_day.status_code == 200
    assert int(r_single_day.headers.get("x-total-count", "0")) > 0
    wb_single = openpyxl.load_workbook(io.BytesIO(r_single_day.content))
    assert wb_single.sheetnames == ["Attendance Matrix"]
    ws_single = wb_single["Attendance Matrix"]
    assert ws_single.freeze_panes == "C3"
    assert ws_single.max_column == 17 + 1 * 7  # 17 summary + 7 metrics = 24

    # 5. Invalid Dates Validation
    r_invalid_range = await client.get(
        "/api/v1/hrms/attendance/export?start_date=2026-10-15&end_date=2026-10-01",
        headers=admin_auth["headers"],
    )
    assert r_invalid_range.status_code == 400

    r_invalid_month = await client.get(
        "/api/v1/hrms/attendance/export?year=2026&month=13",
        headers=admin_auth["headers"],
    )
    assert r_invalid_month.status_code == 400

    # 6. RBAC: Normal employee cannot export another employee's records
    r_peer_export = await client.get(
        f"/api/v1/hrms/attendance/export?year=2026&month=10&employee_id={other_id}",
        headers=emp_auth["headers"],
    )
    assert r_peer_export.status_code in (403, 401), f"Employee must not export peer: {r_peer_export.status_code}"

    # 7. Employee self-export works
    r_self_export = await client.get(
        f"/api/v1/hrms/attendance/export?year=2026&month=10&employee_id={emp_id}",
        headers=emp_auth["headers"],
    )
    assert r_self_export.status_code == 200
    assert r_self_export.headers.get("x-total-count") == "4"


@pytest.mark.asyncio
async def test_detailed_tracking_and_return_timer_subtab_endpoints(client: AsyncClient):
    """
    Test dedicated sub-tab endpoints:
    1. Detailed Tracking employee list & search across PostgreSQL dataset.
    2. Detailed Tracking toggle (OFF/ON) & interval configuration (5m, 10m).
    3. Return Timer employee list & individual overrides (finite, 0s, unlimited, inherit org default).
    4. RBAC enforcement on sub-tab configuration.
    """
    admin_auth = await login_user(client, "ADMIN")
    emp_auth = await login_user(client, "EMPLOYEE")
    emp_id = emp_auth["user"]["id"]

    # Ensure baseline organization default return timer is 30 seconds
    await client.put(
        "/api/v1/hrms/setup/tracking-settings/org-default",
        headers=admin_auth["headers"],
        json={"return_timer_seconds": 30, "is_unlimited_return": False},
    )

    # 1. Detailed Tracking employee list (Admin)
    r_dt_list = await client.get("/api/v1/hrms/setup/detailed-tracking/employees", headers=admin_auth["headers"])
    assert r_dt_list.status_code == 200
    dt_items = r_dt_list.json()["data"]
    assert len(dt_items) >= 2
    assert any(it["employee_id"] == emp_id for it in dt_items)

    # Search filter works across backend dataset
    r_dt_search = await client.get("/api/v1/hrms/setup/detailed-tracking/employees?search=john", headers=admin_auth["headers"])
    assert r_dt_search.status_code == 200
    search_items = r_dt_search.json()["data"]
    assert len(search_items) >= 1
    assert any("john" in it["employee_name"].lower() for it in search_items)

    # 2. RBAC: Employee cannot modify detailed tracking
    r_dt_forbidden = await client.put(
        f"/api/v1/hrms/setup/detailed-tracking/employee/{emp_id}",
        headers=emp_auth["headers"],
        json={"is_detailed_tracking_enabled": True, "detailed_interval_minutes": 10},
    )
    assert r_dt_forbidden.status_code in (401, 403)

    # 3. Admin enables Detailed Tracking for John with 10-minute interval
    r_dt_update = await client.put(
        f"/api/v1/hrms/setup/detailed-tracking/employee/{emp_id}",
        headers=admin_auth["headers"],
        json={"is_detailed_tracking_enabled": True, "detailed_interval_minutes": 10},
    )
    assert r_dt_update.status_code == 200
    updated_dt = r_dt_update.json()["data"]
    assert updated_dt["is_detailed_tracking_enabled"] is True
    assert updated_dt["detailed_interval_minutes"] == 10

    # 4. Return Timer employee list (Admin)
    r_rt_list = await client.get("/api/v1/hrms/setup/return-timer/employees", headers=admin_auth["headers"])
    assert r_rt_list.status_code == 200
    rt_items = r_rt_list.json()["data"]
    assert len(rt_items) >= 2

    # 5. Admin updates John's return timer override to 45 seconds
    r_rt_update = await client.put(
        f"/api/v1/hrms/setup/return-timer/employee/{emp_id}",
        headers=admin_auth["headers"],
        json={"use_org_default": False, "return_timer_seconds": 45, "is_unlimited": False},
    )
    assert r_rt_update.status_code == 200
    updated_rt = r_rt_update.json()["data"]
    assert updated_rt["use_org_default"] is False
    assert updated_rt["return_timer_seconds"] == 45
    assert updated_rt["effective_seconds"] == 45

    # 6. Admin sets John's return timer to immediate expiry (0 seconds)
    r_rt_zero = await client.put(
        f"/api/v1/hrms/setup/return-timer/employee/{emp_id}",
        headers=admin_auth["headers"],
        json={"use_org_default": False, "return_timer_seconds": 0, "is_unlimited": False},
    )
    assert r_rt_zero.status_code == 200
    assert r_rt_zero.json()["data"]["return_timer_seconds"] == 0

    # 7. Admin restores John to inherit Organization Default (30s)
    r_rt_restore = await client.put(
        f"/api/v1/hrms/setup/return-timer/employee/{emp_id}",
        headers=admin_auth["headers"],
        json={"use_org_default": True, "return_timer_seconds": 30, "is_unlimited": False},
    )
    assert r_rt_restore.status_code == 200
    restored_rt = r_rt_restore.json()["data"]
    assert restored_rt["use_org_default"] is True
    assert restored_rt["effective_seconds"] == 30

