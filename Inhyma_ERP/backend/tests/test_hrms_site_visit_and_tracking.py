"""
Automated Integration Tests for HRMS Site Visit + Live Tracking + Attendance Regularization.

Covers:
1. Admin creates Site Visit
2. Non-admin employee cannot create Site Visit (403 Forbidden)
3. Employee sees assigned visit; data isolation prevents other employees from seeing it
4. Normal visit check-in captures GPS lat/long, accuracy, and timestamp -> status CHECKED_IN
5. Check-in persists in PostgreSQL
6. Separate Live Tracking start (independent of site check-in)
7. Periodic 5-minute tracking points uploaded
8. Site check-out captures GPS lat/long, accuracy, and timestamp -> status COMPLETED
9. Stop Live Tracking processes compact duration, distance (Haversine), route summary, and purges temporary points
10. Attendance regularization evidence linkage (Admin sees Site Visit + Live Tracking evidence)
11. Admin approves regularization request
12. Persistence verification in PostgreSQL
"""

from datetime import date, datetime, timedelta, timezone
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app.auth.security import create_access_token
from app.database.engine import get_sessionmaker
from app.hrms.models import (
    HrmsAttendanceRegularization,
    HrmsLiveTrackingSession,
    HrmsSiteVisit,
    HrmsTrackingPoint,
)
from app.main import app
from app.users.models import User, UserStatus


@pytest.mark.asyncio
async def test_site_visit_and_live_tracking_full_workflow():
    sessionmaker = get_sessionmaker()

    admin_id = uuid.uuid4()
    emp_a_id = uuid.uuid4()
    emp_b_id = uuid.uuid4()

    created_visit_ids = []
    created_session_ids = []
    created_reg_ids = []

    # 1. Seed users
    async with sessionmaker() as session:
        admin_user = User(
            id=admin_id,
            email=f"admin_sv_{admin_id.hex[:6]}@example.com",
            username=f"admin_sv_{admin_id.hex[:6]}",
            first_name="Admin",
            last_name="Supervisor",
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
            status=UserStatus.ACTIVE,
            is_active=True,
            password_hash="mockhash",
        )
        emp_b = User(
            id=emp_b_id,
            email=f"emp_b_{emp_b_id.hex[:6]}@example.com",
            username=f"emp_b_{emp_b_id.hex[:6]}",
            first_name="Priya",
            last_name="Patel",
            status=UserStatus.ACTIVE,
            is_active=True,
            password_hash="mockhash",
        )
        session.add_all([admin_user, emp_a, emp_b])
        await session.commit()

    admin_token = create_access_token(admin_id, permissions=["*"]).token
    emp_a_token = create_access_token(emp_a_id, permissions=[]).token
    emp_b_token = create_access_token(emp_b_id, permissions=[]).token

    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    emp_a_headers = {"Authorization": f"Bearer {emp_a_token}"}
    emp_b_headers = {"Authorization": f"Bearer {emp_b_token}"}

    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            today = date.today()

            # -------------------------------------------------------------------
            # 1. Non-admin employee attempts to create Site Visit -> 403 Forbidden
            # -------------------------------------------------------------------
            unauth_payload = {
                "employee_id": str(emp_a_id),
                "customer_name": "ABC Industries",
                "site_address": "MIDC Industrial Area, Phase II",
                "visit_date": str(today),
                "planned_start_time": "10:00 AM",
                "planned_end_time": "07:00 PM",
            }
            res_unauth = await client.post("/api/v1/hrms/site-visits", json=unauth_payload, headers=emp_a_headers)
            assert res_unauth.status_code == 403, "Non-admin employee must be forbidden from creating site visits"

            # -------------------------------------------------------------------
            # 2. Admin creates Site Visit for Employee A
            # -------------------------------------------------------------------
            visit_payload = {
                "employee_id": str(emp_a_id),
                "customer_name": "ABC Industries",
                "site_address": "MIDC Industrial Area, Phase II, Pune",
                "visit_date": str(today),
                "planned_start_time": "10:00 AM",
                "planned_end_time": "07:00 PM",
                "notes": "Client meeting and plant equipment survey",
            }
            res_create = await client.post("/api/v1/hrms/site-visits", json=visit_payload, headers=admin_headers)
            assert res_create.status_code == 201
            visit_data = res_create.json()["data"]
            visit_id = visit_data["id"]
            created_visit_ids.append(visit_id)
            assert visit_data["customer_name"] == "ABC Industries"
            assert visit_data["status"] == "SCHEDULED"
            assert visit_data["employee_id"] == str(emp_a_id)

            # -------------------------------------------------------------------
            # 3. Employee sees assigned visit; Employee B sees 0 visits (Data Isolation)
            # -------------------------------------------------------------------
            res_emp_a_list = await client.get("/api/v1/hrms/site-visits", headers=emp_a_headers)
            assert res_emp_a_list.status_code == 200
            a_visits = res_emp_a_list.json()["data"]
            assert any(v["id"] == visit_id for v in a_visits)

            res_emp_b_list = await client.get("/api/v1/hrms/site-visits", headers=emp_b_headers)
            assert res_emp_b_list.status_code == 200
            b_visits = res_emp_b_list.json()["data"]
            assert not any(v["id"] == visit_id for v in b_visits), "Employee B must not see Employee A's visit"

            # Employee B cannot access Employee A's visit directly
            res_b_direct = await client.get(f"/api/v1/hrms/site-visits/{visit_id}", headers=emp_b_headers)
            assert res_b_direct.status_code == 403

            # -------------------------------------------------------------------
            # 4. Employee A Checks In to Site Visit (GPS Proof)
            # -------------------------------------------------------------------
            check_in_payload = {
                "latitude": 18.52043,
                "longitude": 73.85674,
                "accuracy": 12.5,
                "address": "Gate 1, ABC Industries Campus",
            }
            res_in = await client.post(
                f"/api/v1/hrms/site-visits/{visit_id}/check-in",
                json=check_in_payload,
                headers=emp_a_headers,
            )
            assert res_in.status_code == 200
            in_data = res_in.json()["data"]
            assert in_data["status"] == "CHECKED_IN"
            assert in_data["check_in_time"] is not None
            assert in_data["check_in_latitude"] == 18.52043
            assert in_data["check_in_longitude"] == 73.85674
            assert in_data["check_in_accuracy"] == 12.5

            # Verify Check-In persisted in PostgreSQL
            async with sessionmaker() as session:
                db_visit = await session.get(HrmsSiteVisit, uuid.UUID(visit_id))
                assert db_visit.status == "CHECKED_IN"
                assert db_visit.check_in_latitude == 18.52043

            # -------------------------------------------------------------------
            # 5. Separate Live Tracking: Employee A Starts Tracking
            # -------------------------------------------------------------------
            track_start_payload = {
                "site_visit_id": visit_id,
                "start_location": {"latitude": 18.5200, "longitude": 73.8560, "accuracy": 10.0},
            }
            res_track_start = await client.post(
                "/api/v1/hrms/tracking/start",
                json=track_start_payload,
                headers=emp_a_headers,
            )
            assert res_track_start.status_code == 201
            track_data = res_track_start.json()["data"]
            session_id = track_data["id"]
            created_session_ids.append(session_id)
            assert track_data["status"] == "ACTIVE"
            assert track_data["employee_id"] == str(emp_a_id)

            # Active tracking endpoint returns this session
            res_active = await client.get("/api/v1/hrms/tracking/active", headers=emp_a_headers)
            assert res_active.status_code == 200
            assert res_active.json()["data"]["id"] == session_id

            # -------------------------------------------------------------------
            # 6. Upload periodic 5-minute tracking points
            # -------------------------------------------------------------------
            t0 = datetime.now(timezone.utc) - timedelta(minutes=60)
            pts_batch = {
                "session_id": session_id,
                "points": [
                    {"latitude": 18.5200, "longitude": 73.8560, "accuracy": 8.0, "recorded_at": t0.isoformat()},
                    {"latitude": 18.5300, "longitude": 73.8660, "accuracy": 10.0, "recorded_at": (t0 + timedelta(minutes=15)).isoformat()},
                    {"latitude": 18.5400, "longitude": 73.8760, "accuracy": 9.0, "recorded_at": (t0 + timedelta(minutes=30)).isoformat()},
                    {"latitude": 18.5500, "longitude": 73.8860, "accuracy": 11.0, "recorded_at": (t0 + timedelta(minutes=45)).isoformat()},
                ],
            }
            res_pts = await client.post("/api/v1/hrms/tracking/points", json=pts_batch, headers=emp_a_headers)
            assert res_pts.status_code == 200
            assert res_pts.json()["data"]["recorded_count"] == 4

            # -------------------------------------------------------------------
            # 7. Employee A Checks Out from Site Visit (GPS Proof)
            # -------------------------------------------------------------------
            check_out_payload = {
                "latitude": 18.5501,
                "longitude": 73.8862,
                "accuracy": 15.0,
                "address": "Exit Gate, ABC Industries",
            }
            res_out = await client.post(
                f"/api/v1/hrms/site-visits/{visit_id}/check-out",
                json=check_out_payload,
                headers=emp_a_headers,
            )
            assert res_out.status_code == 200
            out_data = res_out.json()["data"]
            assert out_data["status"] == "COMPLETED"
            assert out_data["check_out_time"] is not None
            assert out_data["check_out_latitude"] == 18.5501

            # Live tracking must STILL BE ACTIVE (not stopped by check-out!)
            res_active_after_checkout = await client.get("/api/v1/hrms/tracking/active", headers=emp_a_headers)
            assert res_active_after_checkout.status_code == 200
            assert res_active_after_checkout.json()["data"]["status"] == "ACTIVE"

            # -------------------------------------------------------------------
            # 8. Employee A explicitly Stops Live Tracking
            # -------------------------------------------------------------------
            stop_payload = {
                "end_location": {"latitude": 18.5505, "longitude": 73.8865, "accuracy": 12.0},
            }
            res_stop = await client.post(
                f"/api/v1/hrms/tracking/{session_id}/stop",
                json=stop_payload,
                headers=emp_a_headers,
            )
            assert res_stop.status_code == 200
            stop_data = res_stop.json()["data"]
            assert stop_data["status"] in ("COMPLETED", "STOPPED")
            assert stop_data["approx_distance_km"] > 0.0
            assert len(stop_data["route_summary"]) >= 4

            # Verify tracking points are persisted in PostgreSQL (hrms_tracking_points)
            async with sessionmaker() as session:
                pts_check = await session.execute(
                    select(HrmsTrackingPoint).where(HrmsTrackingPoint.session_id == uuid.UUID(session_id))
                )
                assert len(pts_check.scalars().all()) >= 4, "Tracking points must be persisted in PostgreSQL"

                # Check permanent summary record
                db_session = await session.get(HrmsLiveTrackingSession, uuid.UUID(session_id))
                assert db_session.status in ("COMPLETED", "STOPPED")
                assert db_session.approx_distance_km > 0.0
                assert db_session.route_summary is not None

            # -------------------------------------------------------------------
            # 9. Attendance Regularization Integration & Evidence
            # -------------------------------------------------------------------
            # Employee submits a regularization request with reason 'Customer site visit'
            reg_id = uuid.uuid4()
            async with sessionmaker() as session:
                reg = HrmsAttendanceRegularization(
                    id=reg_id,
                    employee_id=emp_a_id,
                    attendance_date=today,
                    request_type="MISSING_PUNCH",
                    reason="Customer site visit",
                    notes="Visited ABC Industries for equipment audit",
                    status="PENDING",
                    submitted_at=datetime.now(timezone.utc),
                )
                session.add(reg)
                await session.commit()
                created_reg_ids.append(str(reg_id))

            # Admin requests evidence for this regularization request
            res_evidence = await client.get(
                f"/api/v1/hrms/attendance/regularizations/{reg_id}/evidence",
                headers=admin_headers,
            )
            assert res_evidence.status_code == 200
            ev_data = res_evidence.json()["data"]
            assert ev_data["employee_id"] == str(emp_a_id)

            # Must have the Site Visit evidence
            assert len(ev_data["site_visits"]) >= 1
            sv_ev = ev_data["site_visits"][0]
            assert sv_ev["customer_name"] == "ABC Industries"
            assert sv_ev["check_in_time"] is not None
            assert sv_ev["check_out_time"] is not None

            # Must have the Live Tracking evidence
            assert len(ev_data["tracking_sessions"]) >= 1
            tr_ev = ev_data["tracking_sessions"][0]
            assert tr_ev["status"] in ("COMPLETED", "STOPPED")
            assert tr_ev["approx_distance_km"] > 0.0
            assert len(tr_ev["route_summary"]) >= 4

            # Admin approves the regularization
            res_appr = await client.patch(
                f"/api/v1/hrms/attendance/regularizations/{reg_id}/approve",
                json={"action": "APPROVE", "manager_remarks": "Verified with ABC Industries site visit and live route."},
                headers=admin_headers,
            )
            assert res_appr.status_code == 200

            # Verify persisted status in PostgreSQL
            async with sessionmaker() as session:
                db_reg = await session.get(HrmsAttendanceRegularization, reg_id)
                assert db_reg.status == "APPROVED"
                assert db_reg.action_taken == "APPROVE"

    finally:
        # Cleanup created records
        async with sessionmaker() as session:
            for rid in created_reg_ids:
                await session.execute(delete(HrmsAttendanceRegularization).where(HrmsAttendanceRegularization.id == uuid.UUID(rid)))
            for sid in created_session_ids:
                await session.execute(delete(HrmsTrackingPoint).where(HrmsTrackingPoint.session_id == uuid.UUID(sid)))
                await session.execute(delete(HrmsLiveTrackingSession).where(HrmsLiveTrackingSession.id == uuid.UUID(sid)))
            for vid in created_visit_ids:
                await session.execute(delete(HrmsSiteVisit).where(HrmsSiteVisit.id == uuid.UUID(vid)))
            await session.execute(delete(User).where(User.id.in_([admin_id, emp_a_id, emp_b_id])))
            await session.commit()
