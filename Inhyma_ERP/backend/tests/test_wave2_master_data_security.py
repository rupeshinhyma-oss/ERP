"""Wave 2 regression tests for BUG-002 (Agents) and BUG-005 (Industrial Zones).

Verifies:
- Unauthenticated requests across all CRUD, duplicate-check, and bulk-delete endpoints return HTTP 401.
- Authenticated users without agent.* / zone.* permissions receive HTTP 403.
- Read vs write vs delete vs bulk-delete RBAC boundaries are strictly enforced server-side.
- Authorized users retain full CRUD, duplicate-check, and bulk-delete functionality.
- Bootstrap seed registers agent.* and zone.* permission codes matching existing RBAC conventions.
- OpenAPI declares bearer security on every Agents and Industrial Zones operation.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.agents.models import Agent
from app.agents.routes import router as agents_router
from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.exception_handlers import register_exception_handlers
from app.database.base import Base
from app.database.session import get_db_session
from app.industrial_zones.models import IndustrialZone
from app.industrial_zones.routes import router as zones_router
from scripts.seed import BOOTSTRAP_PERMISSIONS

TABLES = [Agent.__table__, IndustrialZone.__table__]

UNPRIVILEGED_USER = CurrentUser(
    id=uuid.uuid4(),
    username="plain_employee",
    permissions={"user.view", "company.view", "task.view"},
)
AGENT_VIEW_ONLY = CurrentUser(id=uuid.uuid4(), username="agent_reader", permissions={"agent.view"})
AGENT_WRITER = CurrentUser(
    id=uuid.uuid4(),
    username="agent_writer",
    permissions={"agent.view", "agent.create", "agent.update"},
)
AGENT_BULK_ADMIN = CurrentUser(
    id=uuid.uuid4(),
    username="agent_deleter",
    permissions={"agent.view", "agent.delete", "agent.bulk_action"},
)
ZONE_VIEW_ONLY = CurrentUser(id=uuid.uuid4(), username="zone_reader", permissions={"zone.view"})
ZONE_WRITER = CurrentUser(
    id=uuid.uuid4(),
    username="zone_writer",
    permissions={"zone.view", "zone.create", "zone.update"},
)
ZONE_BULK_ADMIN = CurrentUser(
    id=uuid.uuid4(),
    username="zone_deleter",
    permissions={"zone.view", "zone.delete", "zone.bulk_action"},
)
SUPER_ADMIN = CurrentUser(id=uuid.uuid4(), username="admin", is_super_admin=True)


@pytest_asyncio.fixture
async def contacts_sec_env():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TABLES))

    maker = async_sessionmaker(engine, expire_on_commit=False)

    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(agents_router, prefix="/api/v1/agents")
    app.include_router(agents_router, prefix="/api/v1/agent", include_in_schema=False)
    app.include_router(zones_router, prefix="/api/v1/industrial-zones")
    app.include_router(zones_router, prefix="/api/v1/industrial/zones", include_in_schema=False)

    state: dict[str, CurrentUser | None] = {"user": None}

    async def _db():
        async with maker() as session:
            try:
                yield session
                await session.commit()
            except BaseException:
                await session.rollback()
                raise

    app.dependency_overrides[get_db_session] = _db

    def _set_user(user: CurrentUser | None) -> None:
        state["user"] = user
        if user is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = lambda: state["user"]  # type: ignore[return-value]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield {"app": app, "client": client, "set_user": _set_user}

    await engine.dispose()


@pytest.mark.asyncio
async def test_bug002_agents_unauthenticated_and_unauthorized_rejected(contacts_sec_env):
    client: AsyncClient = contacts_sec_env["client"]
    zero_id = "00000000-0000-0000-0000-000000000000"
    agent_payload = {
        "full_name": "Synthetic QA Agent",
        "agent_type": "Commission Agent",
        "calling_number": "9000011111",
        "state": "Gujarat",
        "district": "Ahmedabad",
        "city": "Ahmedabad",
    }

    # 1. Unauthenticated -> 401 across all Agents endpoints and aliases
    contacts_sec_env["set_user"](None)
    assert (await client.get("/api/v1/agents")).status_code == 401
    assert (await client.get("/api/v1/agents/list")).status_code == 401
    assert (await client.get("/api/v1/agent")).status_code == 401
    assert (await client.get("/api/v1/agents/check-duplicate?calling_number=9000011111")).status_code == 401
    assert (await client.get(f"/api/v1/agents/{zero_id}")).status_code == 401
    assert (await client.post("/api/v1/agents", json=agent_payload)).status_code == 401
    assert (await client.put(f"/api/v1/agents/{zero_id}", json={"agent_grade": "A"})).status_code == 401
    assert (await client.delete(f"/api/v1/agents/{zero_id}")).status_code == 401
    assert (await client.post("/api/v1/agents/bulk-delete", json={"ids": [zero_id]})).status_code == 401

    # 2. Authenticated without agent.* permissions -> 403
    contacts_sec_env["set_user"](UNPRIVILEGED_USER)
    assert (await client.get("/api/v1/agents")).status_code == 403
    assert (await client.get("/api/v1/agents/check-duplicate?calling_number=9000011111")).status_code == 403
    assert (await client.get(f"/api/v1/agents/{zero_id}")).status_code == 403
    assert (await client.post("/api/v1/agents", json=agent_payload)).status_code == 403
    assert (await client.put(f"/api/v1/agents/{zero_id}", json={"agent_grade": "A"})).status_code == 403
    assert (await client.delete(f"/api/v1/agents/{zero_id}")).status_code == 403
    assert (await client.post("/api/v1/agents/bulk-delete", json={"ids": [zero_id]})).status_code == 403


@pytest.mark.asyncio
async def test_bug002_agents_read_write_delete_boundaries_and_crud_workflow(contacts_sec_env):
    client: AsyncClient = contacts_sec_env["client"]
    agent_payload = {
        "full_name": "Synthetic QA Agent One",
        "agent_type": "Commission Agent",
        "calling_number": "9000022222",
        "whatsapp_number": "9000022222",
        "state": "Maharashtra",
        "district": "Mumbai",
        "city": "Mumbai",
    }

    # View-only user can list & check duplicates, but cannot create/update/delete/bulk-delete
    contacts_sec_env["set_user"](AGENT_VIEW_ONLY)
    list_res = await client.get("/api/v1/agents")
    assert list_res.status_code == 200
    assert list_res.json()["data"] == []
    assert (await client.get("/api/v1/agents/check-duplicate?calling_number=9000022222")).status_code == 200
    assert (await client.post("/api/v1/agents", json=agent_payload)).status_code == 403

    # Writer can create & update, but cannot delete or bulk-delete
    contacts_sec_env["set_user"](AGENT_WRITER)
    created_res = await client.post("/api/v1/agents", json=agent_payload)
    assert created_res.status_code == 201, created_res.text
    agent_id = created_res.json()["data"]["id"]

    upd_res = await client.put(f"/api/v1/agents/{agent_id}", json={"agent_grade": "A"})
    assert upd_res.status_code == 200
    assert upd_res.json()["data"]["agent_grade"] == "A"

    assert (await client.delete(f"/api/v1/agents/{agent_id}")).status_code == 403
    assert (await client.post("/api/v1/agents/bulk-delete", json={"ids": [agent_id]})).status_code == 403

    # Bulk/delete authorized user can bulk-delete
    contacts_sec_env["set_user"](AGENT_BULK_ADMIN)
    bulk_res = await client.post("/api/v1/agents/bulk-delete", json={"ids": [agent_id]})
    assert bulk_res.status_code == 200
    assert bulk_res.json()["data"]["deleted_count"] == 1
    assert (await client.get("/api/v1/agents")).json()["data"] == []


@pytest.mark.asyncio
async def test_bug005_industrial_zones_unauthenticated_and_unauthorized_rejected(contacts_sec_env):
    client: AsyncClient = contacts_sec_env["client"]
    zero_id = "00000000-0000-0000-0000-000000000000"
    zone_payload = {
        "zone_name": "Synthetic QA Zone Phase I",
        "state": "Gujarat",
        "district": "Ahmedabad",
    }

    # 1. Unauthenticated -> 401 across all Industrial Zones endpoints and aliases
    contacts_sec_env["set_user"](None)
    assert (await client.get("/api/v1/industrial-zones")).status_code == 401
    assert (await client.get("/api/v1/industrial-zones/list")).status_code == 401
    assert (await client.get("/api/v1/industrial/zones")).status_code == 401
    assert (await client.get("/api/v1/industrial-zones/check-name?name=TestZone")).status_code == 401
    assert (await client.get(f"/api/v1/industrial-zones/{zero_id}")).status_code == 401
    assert (await client.post("/api/v1/industrial-zones", json=zone_payload)).status_code == 401
    assert (await client.put(f"/api/v1/industrial-zones/{zero_id}", json={"zone_grade": "B"})).status_code == 401
    assert (await client.delete(f"/api/v1/industrial-zones/{zero_id}")).status_code == 401
    assert (await client.post("/api/v1/industrial-zones/bulk-delete", json={"ids": [zero_id]})).status_code == 401

    # 2. Authenticated without zone.* permissions -> 403
    contacts_sec_env["set_user"](UNPRIVILEGED_USER)
    assert (await client.get("/api/v1/industrial-zones")).status_code == 403
    assert (await client.get("/api/v1/industrial-zones/check-name?name=TestZone")).status_code == 403
    assert (await client.get(f"/api/v1/industrial-zones/{zero_id}")).status_code == 403
    assert (await client.post("/api/v1/industrial-zones", json=zone_payload)).status_code == 403
    assert (await client.put(f"/api/v1/industrial-zones/{zero_id}", json={"zone_grade": "B"})).status_code == 403
    assert (await client.delete(f"/api/v1/industrial-zones/{zero_id}")).status_code == 403
    assert (await client.post("/api/v1/industrial-zones/bulk-delete", json={"ids": [zero_id]})).status_code == 403


@pytest.mark.asyncio
async def test_bug005_industrial_zones_read_write_delete_boundaries_and_crud_workflow(contacts_sec_env):
    client: AsyncClient = contacts_sec_env["client"]
    zone_payload = {
        "zone_name": "Synthetic QA Zone Phase II",
        "state": "Gujarat",
        "district": "Vadodara",
        "zone_grade": "A",
    }

    contacts_sec_env["set_user"](ZONE_VIEW_ONLY)
    assert (await client.get("/api/v1/industrial-zones")).status_code == 200
    assert (await client.get("/api/v1/industrial-zones/check-name?name=Synthetic")).status_code == 200
    assert (await client.post("/api/v1/industrial-zones", json=zone_payload)).status_code == 403

    contacts_sec_env["set_user"](ZONE_WRITER)
    created_res = await client.post("/api/v1/industrial-zones", json=zone_payload)
    assert created_res.status_code == 201, created_res.text
    zone_id = created_res.json()["data"]["id"]

    upd_res = await client.put(f"/api/v1/industrial-zones/{zone_id}", json={"zone_grade": "B"})
    assert upd_res.status_code == 200
    assert upd_res.json()["data"]["zone_grade"] == "B"

    assert (await client.delete(f"/api/v1/industrial-zones/{zone_id}")).status_code == 403
    assert (await client.post("/api/v1/industrial-zones/bulk-delete", json={"ids": [zone_id]})).status_code == 403

    contacts_sec_env["set_user"](ZONE_BULK_ADMIN)
    bulk_res = await client.post("/api/v1/industrial-zones/bulk-delete", json={"ids": [zone_id]})
    assert bulk_res.status_code == 200
    assert bulk_res.json()["data"]["deleted_count"] == 1
    assert (await client.get("/api/v1/industrial-zones")).json()["data"] == []


def test_wave2_seed_permissions_and_openapi_security_metadata(contacts_sec_env):
    seeded_codes = {row[0] for row in BOOTSTRAP_PERMISSIONS}
    for expected_perm in (
        "agent.view",
        "agent.create",
        "agent.update",
        "agent.delete",
        "agent.bulk_action",
        "zone.view",
        "zone.create",
        "zone.update",
        "zone.delete",
        "zone.bulk_action",
    ):
        assert expected_perm in seeded_codes, f"Missing bootstrap permission {expected_perm}"

    schema = contacts_sec_env["app"].openapi()
    paths = schema["paths"]
    for route_path, method in (
        ("/api/v1/agents", "get"),
        ("/api/v1/agents/list", "get"),
        ("/api/v1/agents/check-duplicate", "get"),
        ("/api/v1/agents/{id}", "get"),
        ("/api/v1/agents", "post"),
        ("/api/v1/agents/{id}", "put"),
        ("/api/v1/agents/{id}", "delete"),
        ("/api/v1/agents/bulk-delete", "post"),
        ("/api/v1/industrial-zones", "get"),
        ("/api/v1/industrial-zones/list", "get"),
        ("/api/v1/industrial-zones/check-name", "get"),
        ("/api/v1/industrial-zones/{id}", "get"),
        ("/api/v1/industrial-zones", "post"),
        ("/api/v1/industrial-zones/{id}", "put"),
        ("/api/v1/industrial-zones/{id}", "delete"),
        ("/api/v1/industrial-zones/bulk-delete", "post"),
    ):
        op = paths[route_path][method]
        assert op.get("security"), f"OpenAPI missing security on {method.upper()} {route_path}"
