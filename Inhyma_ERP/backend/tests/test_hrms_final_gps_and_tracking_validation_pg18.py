"""
HRMS Final GPS Accuracy, Geofencing, Live Tracking, Site Visit & Performance Validation Suite (PG18).

Covers:
  1. Controlled GPS Distance & Accuracy Matrix (5m, 10m, 25m, 50m, 100m, 150m, 0m, 18.6km, 1150km, antipode)
     against 100m office geofence, 100m accuracy threshold, 60s freshness, +10s future tolerance,
     and invalid coordinate rejection ((0,0), out-of-range, negative accuracy, missing fields).
  2. Live Tracking Lifecycle & Active Route Reconstruction (DEF-04):
     START -> concurrent/duplicate START -> periodic pings -> live GET /tracking/active route_summary & distance ->
     stationary stop detection -> poor-accuracy GPS drift filtering -> stationary micro-jitter measurement ->
     out-of-order & duplicate retry ingestion -> multi-user simultaneous isolation -> RBAC/IDOR ->
     STOP -> duplicate STOP -> final duration/distance/route/stops verification.
  3. Complete Geofencing Matrix:
     Exact boundary (radius - 1m, radius, radius + 1m), primary + additional permitted offices,
     inactive location rejection, revoked assignment rejection with historical attendance preservation,
     heartbeat exit -> return timer -> expiry -> return resolution, and 5-way concurrent exit single-violation atomicity.
  4. Site Visit End-to-End Lifecycle & RBAC/IDOR:
     Create -> edit -> reassign -> cancel -> proximity/accuracy/freshness/(0,0) check-in validation ->
     duplicate check-in/out prevention -> live tracking linkage -> manager/HR/employee isolation.
  5. GPS Ping Performance, Query Count, Concurrency, Event-Loop Stall & 250-Point Long Session Reconstruction:
     Measures p50/p95/max API latency, SQL query count per ping, 20-way concurrent ping throughput,
     zero duplicate writes, event-loop lag, and 250-point active/stop reconstruction latency.

Safety:
  - Strictly executes against isolated local PostgreSQL 18 (127.0.0.1).
  - Refuses to execute against Supabase or non-local databases.
  - Cleans up 100% of synthetic records in `finally:`.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import time
import uuid

from httpx import ASGITransport, AsyncClient
import pytest
import pytest_asyncio
from sqlalchemy import delete, event, func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.auth.security import create_access_token, hash_password
from app.core.config import settings
from app.hrms.attendance_service import haversine_distance
from app.hrms.models import (
    HrmsAttendance,
    HrmsAttendancePolicy,
    HrmsEmployeeLocation,
    HrmsGeofenceViolation,
    HrmsLiveTrackingSession,
    HrmsLocation,
    HrmsSiteVisit,
    HrmsSiteVisitCheckIn,
    HrmsTrackingPoint,
    HrmsTrackingSettings,
    HrmsTrackingStop,
)
from app.hrms.site_visit_service import haversine_distance_km, haversine_distance_meters
from app.main import create_application
from app.notifications.models import Notification
from app.rbac.models import Permission, Role, RoleAssignmentStatus, RolePermission, UserRole
from app.users.models import EmploymentStatus, EmploymentType, User, UserStatus

PG_TEST_URL = os.environ.get(
    "HRMS_PG_TEST_URL",
    os.environ.get("DATABASE_URL", "postgresql+asyncpg://postgres:root@127.0.0.1:5432/inhyma_test_db"),
)

METRICS_OUT_ENV = os.environ.get("HRMS_FINAL_GPS_METRICS_OUT", "")


def _ensure_safe_local_pg(url: str) -> None:
    lower = url.lower()
    if "supabase.com" in lower or "supabase.co" in lower:
        pytest.skip("Refusing to execute GPS validation suite against Supabase.")
    if "127.0.0.1" not in lower and "localhost" not in lower:
        pytest.skip("GPS validation suite requires isolated local PostgreSQL.")


def _offset_point(lat: float, lon: float, distance_m: float, bearing_deg: float = 0.0) -> tuple[float, float]:
    """Compute exact spherical destination coordinate at given distance (meters) and bearing."""
    r = 6371000.0
    lat_r = math.radians(lat)
    lon_r = math.radians(lon)
    br_r = math.radians(bearing_deg)
    dr = distance_m / r
    new_lat = math.asin(math.sin(lat_r) * math.cos(dr) + math.cos(lat_r) * math.sin(dr) * math.cos(br_r))
    new_lon = lon_r + math.atan2(
        math.sin(br_r) * math.sin(dr) * math.cos(lat_r),
        math.cos(dr) - math.sin(lat_r) * math.sin(new_lat),
    )
    return math.degrees(new_lat), math.degrees(new_lon)


def _wgs84_vincenty_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Independent WGS-84 ellipsoidal geodesic reference distance (meters) for accuracy verification."""
    if abs(lat1 - lat2) < 1e-12 and abs(lon1 - lon2) < 1e-12:
        return 0.0
    a = 6378137.0
    f = 1 / 298.257223563
    b = (1 - f) * a
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    L = math.radians(lon2 - lon1)
    U1 = math.atan((1 - f) * math.tan(phi1))
    U2 = math.atan((1 - f) * math.tan(phi2))
    sinU1, cosU1 = math.sin(U1), math.cos(U1)
    sinU2, cosU2 = math.sin(U2), math.cos(U2)

    lam = L
    for _ in range(100):
        sinLam, cosLam = math.sin(lam), math.cos(lam)
        sinSigma = math.sqrt((cosU2 * sinLam) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosLam) ** 2)
        if sinSigma == 0:
            return 0.0
        cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLam
        sigma = math.atan2(sinSigma, cosSigma)
        sinAlpha = cosU1 * cosU2 * sinLam / sinSigma
        cosSqAlpha = 1 - sinAlpha ** 2
        cos2SigmaM = cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha if cosSqAlpha != 0 else 0.0
        C = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha))
        lam_prev = lam
        lam = L + (1 - C) * f * sinAlpha * (
            sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2))
        )
        if abs(lam - lam_prev) < 1e-12:
            break

    uSq = cosSqAlpha * (a ** 2 - b ** 2) / (b ** 2)
    A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)))
    B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)))
    deltaSigma = B * sinSigma * (
        cos2SigmaM
        + (B / 4)
        * (
            cosSigma * (-1 + 2 * cos2SigmaM ** 2)
            - (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)
        )
    )
    return b * A * (sigma - deltaSigma)


def _record_metrics(section: str, payload: dict) -> None:
    if not METRICS_OUT_ENV:
        return
    out_path = Path(METRICS_OUT_ENV)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    data = {}
    if out_path.exists():
        try:
            data = json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:
            data = {}
    data[section] = payload
    out_path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")


@pytest_asyncio.fixture
async def gps_env():
    """Provision isolated local PG18 multi-role GPS test fixtures and tear down cleanly."""
    _ensure_safe_local_pg(PG_TEST_URL)

    prev_db_url = str(settings.DATABASE_URL)
    os.environ["DATABASE_URL"] = PG_TEST_URL
    os.environ["DIRECT_URL"] = PG_TEST_URL
    os.environ["SUPABASE_URL"] = ""
    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = ""
    os.environ["SUPABASE_ANON_KEY"] = ""
    object.__setattr__(settings, "DATABASE_URL", PG_TEST_URL)

    import app.database.engine as engine_module

    await engine_module.dispose_engine()
    engine: AsyncEngine = create_async_engine(PG_TEST_URL, pool_size=25, max_overflow=30)
    SessionFactory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    tag = uuid.uuid4().hex[:8]
    created_user_ids: list[uuid.UUID] = []
    created_role_ids: list[uuid.UUID] = []
    created_loc_ids: list[uuid.UUID] = []

    async with SessionFactory() as db:
        perms = {p.code: p for p in (await db.execute(select(Permission))).scalars().all()}
        role_by_name = {r.name.lower(): r for r in (await db.execute(select(Role))).scalars().all()}
        super_admin_role = role_by_name.get("super_admin") or role_by_name.get("admin")
        hr_role = role_by_name.get("hr")
        emp_role = role_by_name.get("employee") or role_by_name.get("user")
        role_dept_mgr = Role(
            name=f"GpsDeptManager_{tag}",
            code=f"GDM{tag[:4].upper()}",
            description="GPS validation department manager",
            is_system=False,
        )
        db.add(role_dept_mgr)
        await db.flush()
        created_role_ids.append(role_dept_mgr.id)

        async def mk_user(
            label: str,
            role: Role | None = None,
            is_super: bool = False,
            manager_id: uuid.UUID | None = None,
            office_id: uuid.UUID | None = None,
        ) -> User:
            u = User(
                username=f"gps_{label}_{tag}",
                email=f"gps_{label}_{tag}@local.test",
                password_hash=hash_password("TestPass123!"),
                first_name=label.capitalize(),
                last_name=f"Gps{tag[:4]}",
                display_name=f"{label.capitalize()} Gps{tag[:4]}",
                employee_code=f"GPS-{label.upper()}-{tag[:4].upper()}",
                status=UserStatus.ACTIVE,
                employment_status=EmploymentStatus.ACTIVE,
                employment_type=EmploymentType.FULL_TIME,
                is_active=True,
                manager_id=manager_id,
                date_of_joining=date(2025, 1, 1),
            )
            db.add(u)
            await db.flush()
            created_user_ids.append(u.id)
            assigned_role = super_admin_role if is_super else role
            if assigned_role is not None:
                db.add(
                    UserRole(
                        user_id=u.id,
                        role_id=assigned_role.id,
                        is_primary=True,
                        status=RoleAssignmentStatus.ACTIVE,
                    )
                )
            if office_id is not None:
                db.add(
                    HrmsEmployeeLocation(
                        user_id=u.id,
                        location_id=office_id,
                        is_primary=True,
                    )
                )
            await db.flush()
            return u

        # Offices: Primary 100m geofence (Thane HQ), Secondary 150m (BKC), Inactive 200m (Closed Branch)
        office_primary = HrmsLocation(
            name=f"GPS HQ Thane {tag}",
            location_type="Office",
            address="Lodha Supremus, Wagle Estate, Thane West",
            latitude=19.199824,
            longitude=72.956795,
            radius_meters=100.0,
            is_active=True,
        )
        office_secondary = HrmsLocation(
            name=f"GPS Branch BKC {tag}",
            location_type="Office",
            address="Bandra Kurla Complex, Mumbai",
            latitude=19.065280,
            longitude=72.867720,
            radius_meters=150.0,
            is_active=True,
        )
        office_inactive = HrmsLocation(
            name=f"GPS Closed Office {tag}",
            location_type="Office",
            address="Inactive Branch, Pune",
            latitude=18.520430,
            longitude=73.856743,
            radius_meters=200.0,
            is_active=False,
        )
        db.add_all([office_primary, office_secondary, office_inactive])
        await db.flush()
        created_loc_ids.extend([office_primary.id, office_secondary.id, office_inactive.id])

        admin = await mk_user("admin", is_super=True, office_id=office_primary.id)
        hr = await mk_user("hr", role=hr_role, office_id=office_primary.id)
        mgr = await mk_user("mgr", role=role_dept_mgr, office_id=office_primary.id)
        emp_a = await mk_user("emp_a", role=emp_role, manager_id=mgr.id, office_id=office_primary.id)
        emp_b = await mk_user("emp_b", role=emp_role, office_id=office_primary.id)
        emp_c = await mk_user("emp_c", role=emp_role, office_id=office_primary.id)

        # Grant emp_a additional secondary office
        db.add(
            HrmsEmployeeLocation(
                user_id=emp_a.id,
                location_id=office_secondary.id,
                is_primary=False,
            )
        )

        # Enable detailed tracking with 50m max accuracy, 5m stationary threshold, 50m stationary radius for emp_a & emp_b
        for emp_u in (emp_a, emp_b, emp_c):
            db.add(
                HrmsTrackingSettings(
                    employee_id=emp_u.id,
                    is_active=True,
                    is_detailed_tracking_enabled=True,
                    detailed_interval_minutes=2,
                    detailed_stop_threshold_minutes=5.0,
                    stop_detection_radius_meters=50.0,
                    max_gps_accuracy_meters=50.0,
                )
            )

        await db.commit()

    app = create_application()
    transport = ASGITransport(app=app)

    def tok(u: User) -> dict[str, str]:
        return {"Authorization": f"Bearer {create_access_token(u.id, permissions=[]).token}"}

    try:
        yield {
            "transport": transport,
            "engine": engine,
            "SessionFactory": SessionFactory,
            "tok": tok,
            "tag": tag,
            "admin": admin,
            "hr": hr,
            "mgr": mgr,
            "emp_a": emp_a,
            "emp_b": emp_b,
            "emp_c": emp_c,
            "office_primary": office_primary,
            "office_secondary": office_secondary,
            "office_inactive": office_inactive,
        }
    finally:
        async with SessionFactory() as db:
            for model in (
                HrmsTrackingStop,
                HrmsTrackingPoint,
                HrmsLiveTrackingSession,
                HrmsSiteVisitCheckIn,
                HrmsSiteVisit,
                HrmsGeofenceViolation,
                HrmsAttendance,
                HrmsEmployeeLocation,
                HrmsTrackingSettings,
            ):
                if hasattr(model, "employee_id"):
                    await db.execute(delete(model).where(model.employee_id.in_(created_user_ids)))
                elif hasattr(model, "user_id"):
                    await db.execute(delete(model).where(model.user_id.in_(created_user_ids)))
            await db.execute(delete(Notification).where(Notification.user_id.in_(created_user_ids)))
            await db.execute(delete(UserRole).where(UserRole.user_id.in_(created_user_ids)))
            await db.execute(delete(RolePermission).where(RolePermission.role_id.in_(created_role_ids)))
            await db.execute(delete(User).where(User.id.in_(created_user_ids)))
            await db.execute(delete(Role).where(Role.id.in_(created_role_ids)))
            await db.execute(delete(HrmsLocation).where(HrmsLocation.id.in_(created_loc_ids)))
            await db.commit()

        await engine.dispose()
        await engine_module.dispose_engine()
        os.environ["DATABASE_URL"] = prev_db_url
        object.__setattr__(settings, "DATABASE_URL", prev_db_url)


@pytest.mark.asyncio
async def test_01_controlled_gps_distance_accuracy_and_validation_matrix(gps_env):
    """Sections 4A, 4B, 4C: Controlled 5m..150m + long-range distances, 100m accuracy matrix, freshness, invalid coords."""
    tok = gps_env["tok"]
    emp_a = gps_env["emp_a"]
    office = gps_env["office_primary"]  # radius = 100.0m
    SessionFactory = gps_env["SessionFactory"]

    distance_rows = []
    # 1. Pure Haversine vs independent WGS-84 Vincenty across all 10+ required boundary cases:
    #    0m, 5m, 10m, 25m, 50m, 99.0m, 99.9m, exact 100.0m (<=100.0), 100.0m+0.25nm IEEE-754 overshoot (>100.0),
    #    100.1m, 101.0m, 150.0m
    lat_100_raw, lng_100_raw = _offset_point(office.latitude, office.longitude, 100.0, 0.0)
    # Exact coordinate at 100.0m boundary with haversine_distance <= 100.0 (zero tolerance; at most 1-2 IEEE-754 ULPs ~1e-10m)
    lat_100_exact = lat_100_raw
    while haversine_distance(office.latitude, office.longitude, lat_100_exact, office.longitude) > 100.0:
        lat_100_exact = math.nextafter(lat_100_exact, office.latitude)

    controlled_cases = [
        ("0m_stationary", 0.0, 0.0, True, None),
        ("5m_inside", 5.0, 45.0, True, None),
        ("10m_inside", 10.0, 90.0, True, None),
        ("25m_inside", 25.0, 135.0, True, None),
        ("50m_inside", 50.0, 180.0, True, None),
        ("99.0m_inside", 99.0, 225.0, True, None),
        ("99.9m_inside", 99.9, 0.0, True, None),
        ("100.0m_exact_inclusive", 100.0, 0.0, True, (lat_100_exact, office.longitude)),
        ("100.0m_plus_ieee754_overshoot", 100.0, 0.0, False, (lat_100_raw, lng_100_raw)),
        ("100.1m_outside", 100.1, 0.0, False, None),
        ("101.0m_outside", 101.0, 315.0, False, None),
        ("150.0m_outside", 150.0, 0.0, False, None),
    ]

    async with AsyncClient(transport=gps_env["transport"], base_url="http://test") as client:
        for label, target_m, bearing, expect_accept, explicit_coord in controlled_cases:
            # Clear today's attendance before each punch-in probe
            async with SessionFactory() as db:
                await db.execute(delete(HrmsAttendance).where(HrmsAttendance.employee_id == emp_a.id))
                await db.commit()

            lat, lng = explicit_coord if explicit_coord is not None else _offset_point(office.latitude, office.longitude, target_m, bearing)
            calc_att_m = haversine_distance(office.latitude, office.longitude, lat, lng)
            calc_sv_m = haversine_distance_meters(office.latitude, office.longitude, lat, lng)
            calc_sv_km = haversine_distance_km(office.latitude, office.longitude, lat, lng)
            vincenty_m = _wgs84_vincenty_m(office.latitude, office.longitude, lat, lng)
            err_vs_target_m = abs(calc_att_m - target_m)
            err_vs_wgs84_m = abs(calc_att_m - vincenty_m)

            assert err_vs_target_m < 0.05, f"{label}: spherical error {err_vs_target_m}m too high"
            assert abs(calc_att_m - calc_sv_m) < 1e-6
            assert abs(calc_sv_km * 1000.0 - calc_sv_m) < 1e-6
            # Haversine vs WGS-84 ellipsoid tolerance (<0.55% on Earth)
            assert err_vs_wgs84_m <= max(0.8, vincenty_m * 0.006)

            gps_ts = datetime.now(timezone.utc) - timedelta(seconds=2)
            resp = await client.post(
                "/api/v1/hrms/attendance/punch-in",
                headers=tok(emp_a),
                json={
                    "latitude": lat,
                    "longitude": lng,
                    "accuracy": 8.0,
                    "gps_timestamp": gps_ts.isoformat(),
                },
            )
            accepted = resp.status_code in (200, 201)
            assert accepted == expect_accept, f"{label}: expected accept={expect_accept}, got {resp.status_code}: {resp.text}"

            api_msg = ""
            try:
                api_msg = resp.json().get("message", "")
            except Exception:
                api_msg = resp.text[:120]

            distance_rows.append(
                {
                    "case": label,
                    "expected_coord": [round(office.latitude, 8), round(office.longitude, 8)],
                    "captured_coord": [round(lat, 8), round(lng, 8)],
                    "coord_delta": [round(lat - office.latitude, 9), round(lng - office.longitude, 9)],
                    "configured_radius_m": office.radius_meters,
                    "reported_accuracy_m": 8.0,
                    "expected_distance_m": round(target_m, 4),
                    "wgs84_geodesic_m": round(vincenty_m, 4),
                    "calculated_haversine_m": round(calc_att_m, 12),
                    "error_vs_expected_m": round(err_vs_target_m, 12),
                    "error_vs_wgs84_m": round(err_vs_wgs84_m, 4),
                    "reading_age_s": 2.0,
                    "result": "ACCEPTED" if accepted else "REJECTED",
                    "http_status": resp.status_code,
                    "reason": api_msg if not accepted else f"dist ({calc_att_m:.9f}m) <= radius ({office.radius_meters}m)",
                }
            )

        # Long distances & antipode stability (DEF-03)
        long_cases = [
            ("18.6km_thane_to_bkc", (19.199824, 72.956795), (19.065280, 72.867720)),
            ("1150km_mumbai_to_delhi", (19.076090, 72.877426), (28.613939, 77.209023)),
        ]
        long_rows = []
        for label, (la1, lo1), (la2, lo2) in long_cases:
            hav_m = haversine_distance(la1, lo1, la2, lo2)
            vin_m = _wgs84_vincenty_m(la1, lo1, la2, lo2)
            rel_err_pct = abs(hav_m - vin_m) / vin_m * 100.0
            assert rel_err_pct < 0.6, f"{label}: Haversine vs WGS-84 relative error {rel_err_pct:.3f}% exceeded 0.6%"
            long_rows.append(
                {
                    "case": label,
                    "wgs84_geodesic_km": round(vin_m / 1000.0, 3),
                    "calculated_haversine_km": round(hav_m / 1000.0, 3),
                    "relative_error_pct": round(rel_err_pct, 4),
                }
            )
        # Antipodal domain safety (DEF-03)
        antipode_m = haversine_distance(19.199824, 72.956795, -19.199824, 72.956795 - 180.0)
        assert math.isfinite(antipode_m) and abs(antipode_m - 20015086.796) < 1.0

        # 2. Accuracy threshold matrix around 100m
        accuracy_rows = []
        for acc, expect_accept in [
            (5.0, True),
            (25.0, True),
            (50.0, True),
            (99.0, True),
            (100.0, True),
            (100.1, False),
            (101.0, False),
            (150.0, False),
            (500.0, False),
            (-5.0, False),
            (None, False),
        ]:
            async with SessionFactory() as db:
                await db.execute(delete(HrmsAttendance).where(HrmsAttendance.employee_id == emp_a.id))
                await db.commit()
            body = {
                "latitude": office.latitude,
                "longitude": office.longitude,
                "gps_timestamp": datetime.now(timezone.utc).isoformat(),
            }
            if acc is not None:
                body["accuracy"] = acc
            resp = await client.post("/api/v1/hrms/attendance/punch-in", headers=tok(emp_a), json=body)
            accepted = resp.status_code in (200, 201)
            assert accepted == expect_accept, f"accuracy={acc}: expected {expect_accept}, got {resp.status_code}: {resp.text}"
            accuracy_rows.append({"accuracy_m": acc, "expected_accept": expect_accept, "http_status": resp.status_code})

        # 3. Freshness & future tolerance matrix (max age 60s, max future +10s)
        freshness_rows = []
        for offset_s, expect_accept in [
            (0, True),
            (-30, True),
            (-58, True),
            (8, True),
            (-62, False),
            (-180, False),
            (12, False),
            (None, False),
        ]:
            async with SessionFactory() as db:
                await db.execute(delete(HrmsAttendance).where(HrmsAttendance.employee_id == emp_a.id))
                await db.commit()
            body = {
                "latitude": office.latitude,
                "longitude": office.longitude,
                "accuracy": 10.0,
            }
            if offset_s is not None:
                body["gps_timestamp"] = (datetime.now(timezone.utc) + timedelta(seconds=offset_s)).isoformat()
            resp = await client.post("/api/v1/hrms/attendance/punch-in", headers=tok(emp_a), json=body)
            accepted = resp.status_code in (200, 201)
            assert accepted == expect_accept, f"offset_s={offset_s}: expected {expect_accept}, got {resp.status_code}: {resp.text}"
            freshness_rows.append({"offset_s": offset_s, "expected_accept": expect_accept, "http_status": resp.status_code})

        # 4. Invalid coordinates matrix across punch-in, geofence-status, and tracking points (DEF-02)
        invalid_coord_rows = []
        now_iso = datetime.now(timezone.utc).isoformat()
        for label, bad_lat, bad_lng in [
            ("null_island_0_0", 0.0, 0.0),
            ("lat_gt_90", 91.0, 72.95),
            ("lat_lt_neg90", -91.0, 72.95),
            ("lng_gt_180", 19.20, 181.0),
            ("lng_lt_neg180", 19.20, -181.0),
        ]:
            r_pi = await client.post(
                "/api/v1/hrms/attendance/punch-in",
                headers=tok(emp_a),
                json={"latitude": bad_lat, "longitude": bad_lng, "accuracy": 10.0, "gps_timestamp": now_iso},
            )
            r_geo = await client.post(
                "/api/v1/hrms/attendance/geofence-status",
                headers=tok(emp_a),
                json={"latitude": bad_lat, "longitude": bad_lng, "accuracy": 10.0, "gps_timestamp": now_iso},
            )
            assert r_pi.status_code in (400, 422), f"{label} punch-in got {r_pi.status_code}"
            assert r_geo.status_code in (400, 422), f"{label} geofence-status got {r_geo.status_code}"
            invalid_coord_rows.append({"case": label, "punch_in_status": r_pi.status_code, "geofence_status": r_geo.status_code})

    _record_metrics(
        "controlled_gps_matrix",
        {
            "distance_cases": distance_rows,
            "long_distance_cases": long_rows,
            "accuracy_cases": accuracy_rows,
            "freshness_cases": freshness_rows,
            "invalid_coord_cases": invalid_coord_rows,
        },
    )


@pytest.mark.asyncio
async def test_02_live_tracking_lifecycle_active_reconstruction_drift_and_isolation(gps_env):
    """Sections 4C & 4D + DEF-04: Complete START -> live active reconstruction -> drift filter -> stationary stop -> multi-user -> STOP."""
    tok = gps_env["tok"]
    emp_a = gps_env["emp_a"]
    emp_b = gps_env["emp_b"]
    mgr = gps_env["mgr"]
    admin = gps_env["admin"]
    SessionFactory = gps_env["SessionFactory"]

    async with AsyncClient(transport=gps_env["transport"], base_url="http://test") as client:
        # 1. Start tracking concurrently for emp_a (5 simultaneous START calls -> 1 session)
        start_payload_a = {
            "start_location": {
                "latitude": 19.199824,
                "longitude": 72.956795,
                "accuracy": 10.0,
                "address": "Thane Start",
            }
        }
        starts_a = await asyncio.gather(
            *[client.post("/api/v1/hrms/tracking/start", headers=tok(emp_a), json=start_payload_a) for _ in range(5)]
        )
        assert all(r.status_code in (200, 201) for r in starts_a)
        session_ids_a = {r.json()["data"]["id"] for r in starts_a}
        assert len(session_ids_a) == 1
        sid_a = next(iter(session_ids_a))

        # Simultaneous independent tracking session for emp_b (multi-user isolation)
        start_b = await client.post(
            "/api/v1/hrms/tracking/start",
            headers=tok(emp_b),
            json={"start_location": {"latitude": 19.06528, "longitude": 72.86772, "accuracy": 12.0}},
        )
        assert start_b.status_code in (200, 201)
        sid_b = start_b.json()["data"]["id"]
        assert sid_b != sid_a

        # 2. Upload out-of-order pings + duplicate retry + poor-accuracy 150m & 5000m outliers + stationary cluster (7 min)
        now = datetime.now(timezone.utc)
        t0 = now - timedelta(minutes=14)
        # Note start_tracking already inserted t=now; use chronological timestamps after or before carefully:
        # Let's build clean chronological route: p0 (start at 19.199824), p1 (+500m N), p2 (+1000m N),
        # p3..p5 stationary cluster (~6m jitter over 6.5 min), p6 (+1500m N)
        lat1, lng1 = _offset_point(19.199824, 72.956795, 500.0, 0.0)
        lat2, lng2 = _offset_point(19.199824, 72.956795, 1000.0, 0.0)
        lat3, lng3 = _offset_point(lat2, lng2, 4.0, 45.0)
        lat4, lng4 = _offset_point(lat2, lng2, 6.0, 180.0)
        lat5, lng5 = _offset_point(lat2, lng2, 3.0, 270.0)
        lat6, lng6 = _offset_point(19.199824, 72.956795, 1500.0, 0.0)

        # Backdate session start & start point slightly so all waypoints are chronologically after start
        async with SessionFactory() as db:
            sess_row = await db.get(HrmsLiveTrackingSession, uuid.UUID(sid_a))
            sess_row.start_time = t0 - timedelta(minutes=1)
            pts_start = (
                await db.execute(select(HrmsTrackingPoint).where(HrmsTrackingPoint.session_id == uuid.UUID(sid_a)))
            ).scalars().all()
            for sp in pts_start:
                sp.recorded_at = t0 - timedelta(minutes=1)
            await db.commit()

        p1 = {"latitude": lat1, "longitude": lng1, "accuracy": 10.0, "recorded_at": (t0 + timedelta(minutes=1)).isoformat()}
        p2 = {"latitude": lat2, "longitude": lng2, "accuracy": 12.0, "recorded_at": (t0 + timedelta(minutes=3)).isoformat()}
        p3 = {"latitude": lat3, "longitude": lng3, "accuracy": 11.0, "recorded_at": (t0 + timedelta(minutes=5)).isoformat()}
        p4 = {"latitude": lat4, "longitude": lng4, "accuracy": 14.0, "recorded_at": (t0 + timedelta(minutes=7, seconds=30)).isoformat()}
        p5 = {"latitude": lat5, "longitude": lng5, "accuracy": 9.0, "recorded_at": (t0 + timedelta(minutes=9, seconds=45)).isoformat()}
        p6 = {"latitude": lat6, "longitude": lng6, "accuracy": 10.0, "recorded_at": (t0 + timedelta(minutes=12)).isoformat()}
        # Poor-accuracy outliers (>50m max_gps_accuracy_meters) -> MUST be filtered out!
        p_drift_150 = {"latitude": 19.500, "longitude": 73.200, "accuracy": 150.0, "recorded_at": (t0 + timedelta(minutes=4)).isoformat()}
        p_drift_5000 = {"latitude": 28.6139, "longitude": 77.2090, "accuracy": 5000.0, "recorded_at": (t0 + timedelta(minutes=8)).isoformat()}

        # Batch 1: out-of-order + drift outliers
        r_b1 = await client.post(
            "/api/v1/hrms/tracking/points",
            headers=tok(emp_a),
            json={"session_id": sid_a, "points": [p2, p_drift_150, p1, p_drift_5000]},
        )
        assert r_b1.status_code == 200
        assert r_b1.json()["data"]["recorded_count"] == 2

        # Batch 2: simulated offline reconnect retry containing duplicate p1, p2 + remaining out-of-order points
        r_b2 = await client.post(
            "/api/v1/hrms/tracking/points",
            headers=tok(emp_a),
            json={"session_id": sid_a, "points": [p1, p6, p4, p2, p5, p3, p3]},
        )
        assert r_b2.status_code == 200
        assert r_b2.json()["data"]["recorded_count"] == 4

        # 3. Verify DEF-04 FIX: GET /tracking/active reconstructs live sorted route_summary & distance BEFORE STOP!
        r_active = await client.get("/api/v1/hrms/tracking/active", headers=tok(emp_a))
        assert r_active.status_code == 200
        active_dto = r_active.json()["data"]
        assert active_dto["status"] == "ACTIVE"
        assert active_dto["total_points"] == 7  # start + p1..p6 (0 drift, 0 duplicates)
        assert len(active_dto["route_summary"]) == 7, f"DEF-04 regression: got {len(active_dto['route_summary'])} route pts"
        # Strict chronological ordering verified
        route_times = [datetime.fromisoformat(p["time"]) for p in active_dto["route_summary"]]
        assert route_times == sorted(route_times), "Active route_summary not chronologically sorted!"
        # Live distance (~1.51 km, NOT 0.0 km and NOT poisoned by Delhi 1150km outlier!)
        assert 1.45 <= active_dto["approx_distance_km"] <= 1.60, f"Unexpected live distance {active_dto['approx_distance_km']}km"
        assert abs(active_dto["end_latitude"] - lat6) < 1e-5

        # Stationary stop detected (>5 mins within 50m)
        r_stops = await client.get(f"/api/v1/hrms/tracking/{sid_a}/stops", headers=tok(emp_a))
        assert r_stops.status_code == 200
        assert len(r_stops.json()["data"]) >= 1

        # 4. Privacy & RBAC isolation checks
        assert (await client.post("/api/v1/hrms/tracking/points", headers=tok(emp_b), json={"session_id": sid_a, "points": [p1]})).status_code == 403
        assert (await client.post(f"/api/v1/hrms/tracking/{sid_a}/stop", headers=tok(emp_b), json={})).status_code == 403
        assert (await client.get(f"/api/v1/hrms/tracking/{sid_a}/stops", headers=tok(emp_b))).status_code == 403
        assert (await client.get(f"/api/v1/hrms/tracking/sessions?employee_id={emp_a.id}", headers=tok(emp_b))).status_code == 403

        # Department Manager sees direct report emp_a, blocked from non-report emp_b
        r_mgr_a = await client.get(f"/api/v1/hrms/tracking/sessions?employee_id={emp_a.id}", headers=tok(mgr))
        assert r_mgr_a.status_code == 200 and any(s["id"] == sid_a for s in r_mgr_a.json()["data"])
        r_mgr_b = await client.get(f"/api/v1/hrms/tracking/sessions?employee_id={emp_b.id}", headers=tok(mgr))
        assert r_mgr_b.status_code == 403

        # Admin sees BOTH simultaneous sessions
        r_adm = await client.get("/api/v1/hrms/tracking/sessions", headers=tok(admin))
        adm_ids = {s["id"] for s in r_adm.json()["data"]}
        assert sid_a in adm_ids and sid_b in adm_ids

        # 5. STOP + duplicate STOP idempotency
        r_stop1 = await client.post(f"/api/v1/hrms/tracking/{sid_a}/stop", headers=tok(emp_a), json={})
        r_stop2 = await client.post(f"/api/v1/hrms/tracking/{sid_a}/stop", headers=tok(emp_a), json={})
        assert r_stop1.status_code == 200 and r_stop2.status_code == 200
        s1 = r_stop1.json()["data"]
        assert s1["status"] == "COMPLETED"
        assert s1["approx_distance_km"] == active_dto["approx_distance_km"]
        assert s1["total_duration_minutes"] >= 14

        # Stop emp_b (zero-movement session -> 0.0 km)
        r_stop_b = await client.post(f"/api/v1/hrms/tracking/{sid_b}/stop", headers=tok(emp_b), json={})
        assert r_stop_b.status_code == 200
        assert r_stop_b.json()["data"]["approx_distance_km"] == 0.0

        # Measure stationary micro-jitter honesty: exact distance between p2->p3->p4->p5
        jitter_m = (
            haversine_distance(lat2, lng2, lat3, lng3)
            + haversine_distance(lat3, lng3, lat4, lng4)
            + haversine_distance(lat4, lng4, lat5, lng5)
        )
        _record_metrics(
            "live_tracking_lifecycle",
            {
                "active_points_reconstructed": len(active_dto["route_summary"]),
                "active_distance_km": active_dto["approx_distance_km"],
                "completed_distance_km": s1["approx_distance_km"],
                "poor_accuracy_outliers_filtered": 2,
                "stationary_stops_detected": len(r_stops.json()["data"]),
                "stationary_cluster_micro_jitter_m": round(jitter_m, 2),
                "zero_movement_session_km": r_stop_b.json()["data"]["approx_distance_km"],
            },
        )


@pytest.mark.asyncio
async def test_03_complete_geofencing_matrix_and_heartbeat_violations(gps_env):
    """Section 4E: Primary+additional, exact boundary, inactive, revoked+historical preservation, concurrent exit violations."""
    tok = gps_env["tok"]
    emp_a = gps_env["emp_a"]
    office_primary = gps_env["office_primary"]      # 100m
    office_secondary = gps_env["office_secondary"]  # 150m
    office_inactive = gps_env["office_inactive"]    # 200m inactive
    SessionFactory = gps_env["SessionFactory"]

    async with AsyncClient(transport=gps_env["transport"], base_url="http://test") as client:
        now_iso = datetime.now(timezone.utc).isoformat()

        # 1. Punch in at additional permitted office (secondary)
        r_sec_in = await client.post(
            "/api/v1/hrms/attendance/punch-in",
            headers=tok(emp_a),
            json={
                "latitude": office_secondary.latitude,
                "longitude": office_secondary.longitude,
                "accuracy": 10.0,
                "gps_timestamp": now_iso,
            },
        )
        assert r_sec_in.status_code in (200, 201), r_sec_in.text
        att_id = r_sec_in.json()["data"]["id"]
        assert r_sec_in.json()["data"]["office_location_id"] == str(office_secondary.id)

        # 2. Revoke secondary office assignment -> historical attendance record MUST retain original office!
        async with SessionFactory() as db:
            await db.execute(
                delete(HrmsEmployeeLocation).where(
                    HrmsEmployeeLocation.user_id == emp_a.id,
                    HrmsEmployeeLocation.location_id == office_secondary.id,
                )
            )
            await db.commit()

        r_today = await client.get("/api/v1/hrms/attendance/today", headers=tok(emp_a))
        assert r_today.status_code == 200
        assert r_today.json()["data"]["office_location_id"] == str(office_secondary.id)

        # Now punch-out at revoked secondary office MUST be rejected (400)
        r_revoked_out = await client.post(
            "/api/v1/hrms/attendance/punch-out",
            headers=tok(emp_a),
            json={
                "latitude": office_secondary.latitude,
                "longitude": office_secondary.longitude,
                "accuracy": 10.0,
                "gps_timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )
        assert r_revoked_out.status_code == 400

        # Inactive office MUST be rejected (400)
        r_inact = await client.post(
            "/api/v1/hrms/attendance/punch-out",
            headers=tok(emp_a),
            json={
                "latitude": office_inactive.latitude,
                "longitude": office_inactive.longitude,
                "accuracy": 10.0,
                "gps_timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )
        assert r_inact.status_code == 400

        # 3. Heartbeat geofence check: 5-way concurrent exit outside primary -> EXACTLY 1 open violation!
        lat_out, lng_out = _offset_point(office_primary.latitude, office_primary.longitude, 250.0, 90.0)
        exit_resps = await asyncio.gather(
            *[
                client.post(
                    "/api/v1/hrms/attendance/geofence-status",
                    headers=tok(emp_a),
                    json={
                        "latitude": lat_out,
                        "longitude": lng_out,
                        "accuracy": 10.0,
                        "gps_timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                )
                for _ in range(5)
            ]
        )
        assert all(r.status_code == 200 for r in exit_resps)
        assert all(r.json()["data"]["is_inside"] is False for r in exit_resps)

        async with SessionFactory() as db:
            open_viols = (
                await db.execute(
                    select(HrmsGeofenceViolation).where(
                        HrmsGeofenceViolation.employee_id == emp_a.id,
                        HrmsGeofenceViolation.return_time.is_(None),
                    )
                )
            ).scalars().all()
            assert len(open_viols) == 1, f"Expected 1 open geofence violation, got {len(open_viols)}"
            viol_id = open_viols[0].id

        # 4. Return inside primary office -> resolves violation to RETURNED
        r_ret = await client.post(
            "/api/v1/hrms/attendance/geofence-status",
            headers=tok(emp_a),
            json={
                "latitude": office_primary.latitude,
                "longitude": office_primary.longitude,
                "accuracy": 10.0,
                "gps_timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )
        assert r_ret.status_code == 200
        assert r_ret.json()["data"]["is_inside"] is True

        async with SessionFactory() as db:
            v_after = await db.get(HrmsGeofenceViolation, viol_id)
            assert v_after.status == "RESOLVED_RETURNED"
            assert v_after.return_time is not None

        # 5. Punch out cleanly at primary office
        r_out = await client.post(
            "/api/v1/hrms/attendance/punch-out",
            headers=tok(emp_a),
            json={
                "latitude": office_primary.latitude,
                "longitude": office_primary.longitude,
                "accuracy": 10.0,
                "gps_timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )
        assert r_out.status_code == 200


@pytest.mark.asyncio
async def test_04_site_visit_e2e_lifecycle_proximity_and_rbac(gps_env):
    """Section 6: Site Visit create, edit, reassign, cancel, proximity/accuracy/freshness/(0,0) check-in/out, RBAC & tracking linkage."""
    tok = gps_env["tok"]
    hr = gps_env["hr"]
    mgr = gps_env["mgr"]
    emp_a = gps_env["emp_a"]
    emp_b = gps_env["emp_b"]

    site_lat, site_lng = 19.120000, 72.900000
    today_str = date.today().isoformat()

    async with AsyncClient(transport=gps_env["transport"], base_url="http://test") as client:
        # 1. HR creates visit for emp_b, edits & reassigns to emp_a, cancels it
        r_create1 = await client.post(
            "/api/v1/hrms/site-visits",
            headers=tok(hr),
            json={
                "employee_id": str(emp_b.id),
                "customer_name": "Acme Field Client",
                "site_address": "MIDC Andheri East, Mumbai",
                "site_latitude": site_lat,
                "site_longitude": site_lng,
                "visit_date": today_str,
                "planned_start_time": "10:00",
                "planned_end_time": "12:00",
                "notes": "Initial inspection",
            },
        )
        assert r_create1.status_code in (200, 201), r_create1.text
        v1_id = r_create1.json()["data"]["id"]

        r_edit = await client.put(
            f"/api/v1/hrms/site-visits/{v1_id}",
            headers=tok(hr),
            json={"employee_id": str(emp_a.id), "notes": "Reassigned to emp_a"},
        )
        assert r_edit.status_code == 200
        assert r_edit.json()["data"]["employee_id"] == str(emp_a.id)

        r_cancel = await client.post(
            f"/api/v1/hrms/site-visits/{v1_id}/cancel",
            headers=tok(hr),
            json={"reason": "Client rescheduled"},
        )
        assert r_cancel.status_code == 200
        assert r_cancel.json()["data"]["status"] == "CANCELLED"

        # Cancelled visit cannot be checked into
        r_canc_ci = await client.post(
            f"/api/v1/hrms/site-visits/{v1_id}/check-in",
            headers=tok(emp_a),
            json={
                "latitude": site_lat,
                "longitude": site_lng,
                "accuracy": 10.0,
                "gps_timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )
        assert r_canc_ci.status_code == 400

        # 2. Create active visit for emp_a
        r_create2 = await client.post(
            "/api/v1/hrms/site-visits",
            headers=tok(hr),
            json={
                "employee_id": str(emp_a.id),
                "customer_name": "Beta Site Verification",
                "site_address": "Powai Tech Park, Mumbai",
                "site_latitude": site_lat,
                "site_longitude": site_lng,
                "visit_date": today_str,
                "planned_start_time": "14:00",
                "planned_end_time": "16:00",
            },
        )
        assert r_create2.status_code in (200, 201)
        v2_id = r_create2.json()["data"]["id"]

        # Unauthorized emp_b cannot check into emp_a's visit (403)
        assert (
            await client.post(
                f"/api/v1/hrms/site-visits/{v2_id}/check-in",
                headers=tok(emp_b),
                json={
                    "latitude": site_lat,
                    "longitude": site_lng,
                    "accuracy": 10.0,
                    "gps_timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
        ).status_code == 403

        # DEF-02: (0,0) Null-Island check-in rejected (422)
        assert (
            await client.post(
                f"/api/v1/hrms/site-visits/{v2_id}/check-in",
                headers=tok(emp_a),
                json={
                    "latitude": 0.0,
                    "longitude": 0.0,
                    "accuracy": 10.0,
                    "gps_timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
        ).status_code in (400, 422)

        # Outside 300m proximity (350m away) -> rejected (400)
        far_lat, far_lng = _offset_point(site_lat, site_lng, 350.0, 90.0)
        assert (
            await client.post(
                f"/api/v1/hrms/site-visits/{v2_id}/check-in",
                headers=tok(emp_a),
                json={
                    "latitude": far_lat,
                    "longitude": far_lng,
                    "accuracy": 10.0,
                    "gps_timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
        ).status_code == 400

        # Poor accuracy (>100m) -> rejected (422)
        assert (
            await client.post(
                f"/api/v1/hrms/site-visits/{v2_id}/check-in",
                headers=tok(emp_a),
                json={
                    "latitude": site_lat,
                    "longitude": site_lng,
                    "accuracy": 150.0,
                    "gps_timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
        ).status_code in (400, 422)

        # Stale GPS (>60s) -> rejected (400)
        assert (
            await client.post(
                f"/api/v1/hrms/site-visits/{v2_id}/check-in",
                headers=tok(emp_a),
                json={
                    "latitude": site_lat,
                    "longitude": site_lng,
                    "accuracy": 10.0,
                    "gps_timestamp": (datetime.now(timezone.utc) - timedelta(seconds=90)).isoformat(),
                },
            )
        ).status_code == 400

        # Valid check-in inside 300m (285m away) -> succeeds
        in_lat, in_lng = _offset_point(site_lat, site_lng, 285.0, 45.0)
        r_ci = await client.post(
            f"/api/v1/hrms/site-visits/{v2_id}/check-in",
            headers=tok(emp_a),
            json={
                "latitude": in_lat,
                "longitude": in_lng,
                "accuracy": 12.0,
                "gps_timestamp": datetime.now(timezone.utc).isoformat(),
                "address": "Powai Gate",
            },
        )
        assert r_ci.status_code == 200
        assert r_ci.json()["data"]["status"] == "CHECKED_IN"

        # Duplicate check-in -> rejected (400)
        assert (
            await client.post(
                f"/api/v1/hrms/site-visits/{v2_id}/check-in",
                headers=tok(emp_a),
                json={
                    "latitude": in_lat,
                    "longitude": in_lng,
                    "accuracy": 12.0,
                    "gps_timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
        ).status_code == 400

        # Linked tracking session
        r_ts = await client.post(
            "/api/v1/hrms/tracking/start",
            headers=tok(emp_a),
            json={"site_visit_id": v2_id, "start_location": {"latitude": in_lat, "longitude": in_lng, "accuracy": 10.0}},
        )
        assert r_ts.status_code in (200, 201)
        ts_id = r_ts.json()["data"]["id"]
        await client.post(f"/api/v1/hrms/tracking/{ts_id}/stop", headers=tok(emp_a), json={})

        # Valid check-out -> COMPLETED; duplicate check-out rejected
        r_co = await client.post(
            f"/api/v1/hrms/site-visits/{v2_id}/check-out",
            headers=tok(emp_a),
            json={
                "latitude": in_lat,
                "longitude": in_lng,
                "accuracy": 10.0,
                "gps_timestamp": datetime.now(timezone.utc).isoformat(),
                "address": "Powai Exit",
            },
        )
        assert r_co.status_code == 200
        assert r_co.json()["data"]["status"] == "COMPLETED"
        assert (
            await client.post(
                f"/api/v1/hrms/site-visits/{v2_id}/check-out",
                headers=tok(emp_a),
                json={
                    "latitude": in_lat,
                    "longitude": in_lng,
                    "accuracy": 10.0,
                    "gps_timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
        ).status_code == 400

        # Manager sees direct report emp_a's site visit; emp_b does NOT
        r_mgr_sv = await client.get("/api/v1/hrms/site-visits", headers=tok(mgr))
        assert any(v["id"] == v2_id for v in r_mgr_sv.json()["data"])
        r_b_sv = await client.get("/api/v1/hrms/site-visits", headers=tok(emp_b))
        assert all(v["id"] != v2_id for v in r_b_sv.json()["data"])


@pytest.mark.asyncio
async def test_05_gps_ping_performance_concurrency_event_loop_and_long_session(gps_env):
    """Section 4F: Ping latency, SQL query count, 20-way concurrent ping throughput, event-loop lag, 250-pt long session."""
    tok = gps_env["tok"]
    emp_c = gps_env["emp_c"]
    SessionFactory = gps_env["SessionFactory"]

    import app.database.engine as engine_module

    async with AsyncClient(transport=gps_env["transport"], base_url="http://test") as client:
        r_start = await client.post(
            "/api/v1/hrms/tracking/start",
            headers=tok(emp_c),
            json={"start_location": {"latitude": 19.199824, "longitude": 72.956795, "accuracy": 10.0}},
        )
        assert r_start.status_code in (200, 201)
        sid = r_start.json()["data"]["id"]

        # Ensure engine is initialized for SQL counting
        app_engine = engine_module.get_engine()
        sql_counts: list[int] = []
        current_count = 0

        def _before_exec(conn, cursor, statement, parameters, context, executemany):
            nonlocal current_count
            current_count += 1

        event.listen(app_engine.sync_engine, "before_cursor_execute", _before_exec)
        try:
            # 1. Single sequential ping latency & query count (10 pings)
            now = datetime.now(timezone.utc)
            seq_latencies_ms: list[float] = []
            for i in range(10):
                lat, lng = _offset_point(19.199824, 72.956795, (i + 1) * 40.0, 0.0)
                pt_ts = (now - timedelta(minutes=30) + timedelta(seconds=i * 15)).isoformat()
                current_count = 0
                t0 = time.perf_counter()
                r = await client.post(
                    "/api/v1/hrms/tracking/points",
                    headers=tok(emp_c),
                    json={
                        "session_id": sid,
                        "points": [{"latitude": lat, "longitude": lng, "accuracy": 10.0, "recorded_at": pt_ts}],
                    },
                )
                elapsed_ms = (time.perf_counter() - t0) * 1000.0
                assert r.status_code == 200, r.text
                seq_latencies_ms.append(elapsed_ms)
                sql_counts.append(current_count)
        finally:
            event.remove(app_engine.sync_engine, "before_cursor_execute", _before_exec)

        # 2. 20-way concurrent ping wave + event-loop lag monitor + duplicate resilience
        loop_lags_ms: list[float] = []
        stop_monitor = False

        async def _lag_monitor():
            target_step = 0.02
            while not stop_monitor:
                t_a = time.perf_counter()
                await asyncio.sleep(target_step)
                lag = max(0.0, (time.perf_counter() - t_a - target_step) * 1000.0)
                loop_lags_ms.append(lag)

        monitor_task = asyncio.create_task(_lag_monitor())
        t_conc_start = time.perf_counter()
        conc_tasks = []
        for i in range(20):
            # Intentionally repeat 5 points across concurrent requests to verify zero duplicate writes!
            idx_key = i if i < 15 else i - 5
            lat, lng = _offset_point(19.199824, 72.956795, 500.0 + idx_key * 35.0, 30.0)
            pt_ts = (now - timedelta(minutes=20) + timedelta(seconds=idx_key * 12)).isoformat()
            conc_tasks.append(
                client.post(
                    "/api/v1/hrms/tracking/points",
                    headers=tok(emp_c),
                    json={
                        "session_id": sid,
                        "points": [{"latitude": lat, "longitude": lng, "accuracy": 12.0, "recorded_at": pt_ts}],
                    },
                )
            )
        conc_resps = await asyncio.gather(*conc_tasks)
        conc_total_ms = (time.perf_counter() - t_conc_start) * 1000.0
        stop_monitor = True
        await monitor_task

        assert all(r.status_code == 200 for r in conc_resps), [r.status_code for r in conc_resps]

        # Verify EXACT deduplicated count: 1 start + 10 sequential + 15 unique concurrent = 26 rows!
        async with SessionFactory() as db:
            db_count = (
                await db.execute(
                    select(func.count(HrmsTrackingPoint.id)).where(HrmsTrackingPoint.session_id == uuid.UUID(sid))
                )
            ).scalar()
            assert db_count == 26, f"Duplicate or lost writes under 20-way concurrency: expected 26, got {db_count}"

        # 3. Long-running tracking session (250 points total): batch insert + active reconstruction + STOP latency
        batch_224 = []
        for i in range(224):
            lat, lng = _offset_point(19.199824, 72.956795, 1100.0 + i * 25.0, 45.0)
            pt_ts = (now - timedelta(minutes=15) + timedelta(seconds=i * 3)).isoformat()
            batch_224.append({"latitude": lat, "longitude": lng, "accuracy": 11.0, "recorded_at": pt_ts})

        t_batch = time.perf_counter()
        r_batch = await client.post(
            "/api/v1/hrms/tracking/points",
            headers=tok(emp_c),
            json={"session_id": sid, "points": batch_224},
        )
        batch_224_ms = (time.perf_counter() - t_batch) * 1000.0
        assert r_batch.status_code == 200
        assert r_batch.json()["data"]["recorded_count"] == 224

        t_active = time.perf_counter()
        r_act = await client.get("/api/v1/hrms/tracking/active", headers=tok(emp_c))
        active_250_ms = (time.perf_counter() - t_active) * 1000.0
        assert r_act.status_code == 200
        assert len(r_act.json()["data"]["route_summary"]) == 250

        t_stop = time.perf_counter()
        r_stop = await client.post(f"/api/v1/hrms/tracking/{sid}/stop", headers=tok(emp_c), json={})
        stop_250_ms = (time.perf_counter() - t_stop) * 1000.0
        assert r_stop.status_code == 200
        assert len(r_stop.json()["data"]["route_summary"]) == 250

        sorted_lat = sorted(seq_latencies_ms)
        p50_ms = sorted_lat[len(sorted_lat) // 2]
        p95_ms = sorted_lat[int(len(sorted_lat) * 0.95)]
        max_ms = sorted_lat[-1]
        conc_rps = 20.0 / (conc_total_ms / 1000.0)
        max_lag_ms = max(loop_lags_ms) if loop_lags_ms else 0.0

        _record_metrics(
            "gps_performance",
            {
                "single_ping_p50_ms": round(p50_ms, 2),
                "single_ping_p95_ms": round(p95_ms, 2),
                "single_ping_max_ms": round(max_ms, 2),
                "sql_queries_per_ping_min": min(sql_counts),
                "sql_queries_per_ping_max": max(sql_counts),
                "concurrent_20_total_ms": round(conc_total_ms, 2),
                "concurrent_20_throughput_rps": round(conc_rps, 2),
                "concurrent_20_duplicate_writes": 0,
                "max_event_loop_lag_ms": round(max_lag_ms, 2),
                "batch_224_points_ms": round(batch_224_ms, 2),
                "active_250_point_reconstruction_ms": round(active_250_ms, 2),
                "stop_250_point_summary_ms": round(stop_250_ms, 2),
            },
        )
