"""
Phase 2 Diagnostic Script for HRMS Attendance Endpoints.
Verifies all 5 endpoints against the running FastAPI application with database session:
1. GET /api/v1/hrms/attendance/today
2. GET /api/v1/hrms/attendance/month
3. GET /api/v1/hrms/locations/assigned
4. POST /api/v1/hrms/attendance/punch-in
5. POST /api/v1/hrms/attendance/punch-out
"""

import asyncio
import json
import uuid
from httpx import ASGITransport, AsyncClient

from app.main import create_application
from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.database.session import get_db_session
from app.users.models import User
from sqlalchemy import select


async def run_diagnostics():
    app = create_application()

    # Get a real user from DB
    async for db in get_db_session():
        stmt = select(User).limit(1)
        res = await db.execute(stmt)
        real_user = res.scalar_one_or_none()
        break

    if not real_user:
        print("No users found in database!")
        return

    test_user_id = real_user.id
    mock_user = CurrentUser(
        id=test_user_id,
        username=real_user.username,
        permissions={"*"},
        is_super_admin=True,
    )
    app.dependency_overrides[get_current_user] = lambda: mock_user

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        async with app.router.lifespan_context(app):
            print("==================================================================")
            print("PHASE 2 DIAGNOSTICS: Verifying Real Attendance API Endpoints")
            print("==================================================================")

            # 1. GET /api/v1/hrms/attendance/today
            r1 = await client.get("/api/v1/hrms/attendance/today")
            print(f"\n1. GET /api/v1/hrms/attendance/today -> HTTP {r1.status_code}")
            print(json.dumps(r1.json(), indent=2))

            # 2. GET /api/v1/hrms/attendance/month
            r2 = await client.get("/api/v1/hrms/attendance/month")
            print(f"\n2. GET /api/v1/hrms/attendance/month -> HTTP {r2.status_code}")
            print(json.dumps(r2.json(), indent=2))

            # 3. GET /api/v1/hrms/locations/assigned
            r3 = await client.get("/api/v1/hrms/locations/assigned")
            print(f"\n3. GET /api/v1/hrms/locations/assigned -> HTTP {r3.status_code}")
            print(json.dumps(r3.json(), indent=2))

            assigned_loc = r3.json().get("data", {})
            lat = assigned_loc.get("latitude", 19.198300) if assigned_loc else 19.198300
            lon = assigned_loc.get("longitude", 72.948300) if assigned_loc else 72.948300
            office_id = assigned_loc.get("id") if assigned_loc else None

            # 4. POST /api/v1/hrms/attendance/punch-in
            r4 = await client.post(
                "/api/v1/hrms/attendance/punch-in",
                json={
                    "latitude": lat,
                    "longitude": lon,
                    "office_id": office_id,
                }
            )
            print(f"\n4. POST /api/v1/hrms/attendance/punch-in -> HTTP {r4.status_code}")
            print(json.dumps(r4.json(), indent=2))

            # 1b. Check GET /api/v1/hrms/attendance/today after punch in
            r1b = await client.get("/api/v1/hrms/attendance/today")
            print(f"\n1b. GET /api/v1/hrms/attendance/today (while OPEN) -> HTTP {r1b.status_code}")
            print(json.dumps(r1b.json(), indent=2))

            # 5. POST /api/v1/hrms/attendance/punch-out
            r5 = await client.post(
                "/api/v1/hrms/attendance/punch-out",
                json={
                    "latitude": lat,
                    "longitude": lon,
                }
            )
            print(f"\n5. POST /api/v1/hrms/attendance/punch-out -> HTTP {r5.status_code}")
            print(json.dumps(r5.json(), indent=2))

            # 1c. Check GET /api/v1/hrms/attendance/today after punch out
            r1c = await client.get("/api/v1/hrms/attendance/today")
            print(f"\n1c. GET /api/v1/hrms/attendance/today (after CLOSED) -> HTTP {r1c.status_code}")
            print(json.dumps(r1c.json(), indent=2))

            print("\n==================================================================")
            print("PHASE 2 DIAGNOSTICS COMPLETE")
            print("==================================================================")


if __name__ == "__main__":
    asyncio.run(run_diagnostics())
