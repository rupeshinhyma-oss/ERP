"""
PostgreSQL 18 Integration, RBAC, Distribution, Timeline & Explicit-Deny Suite for
Lead Management Phase 2 / Wave 3.

Verifies Wave 3 backend defects and end-to-end RBAC invariants against the isolated
local PostgreSQL 18 test database (`inhyma_test_db`), cleaning up 100% of synthetic
records in a `finally` block:
- LM-DEF-008: Salesperson quotation workflow & /api/v1/crm/products/lookup without product.view
- LM-DEF-009: /api/v1/masters/states/lookup without state.view + distribution RBAC
- LM-DEF-013: PUT /api/v1/crm/distribution/salespeople/{id} null clearing vs omitted preservation
- LM-DEF-014: GET /api/v1/crm/follow-ups?lead_id=...&status=all returns pending/completed/cancelled
- LM-DEF-017: GET /api/v1/crm/assignment-history null-owner cross-department privacy
- LM-DEF-019: Reassignment writes activity_type='reassignment' & single timeline entry + historical dedup
- LM-DEF-020: load_explicit_crm_denies evaluates CurrentUser.permissions deny prefixes for SuperAdmin
- LM-DEF-031(b): /api/v1/masters/lead-sources permission enforcement
- LM-DEF-032: All Territories wildcard territory_state_ids=[] persists and covers newly added states
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import os
import time
import uuid

from httpx import ASGITransport, AsyncClient
import pytest
import pytest_asyncio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.audit.models import AuditLog
from app.auth.dependencies import get_current_user
from app.auth.models import Session as AuthSession
from app.auth.security import create_access_token, hash_password
from app.auth.service import AdminPermissionSet, CurrentUser
from app.core.constants import RecordStatus
from app.crm.assignment_service import CrmAssignmentEngineService
from app.crm.dependencies import load_explicit_crm_denies
from app.crm.models import (
    CrmActivity,
    CrmAssignmentHistory,
    CrmFollowUp,
    CrmLead,
    CrmLeadProduct,
    CrmPipeline,
    CrmPipelineStage,
    CrmQuotationItem,
    CrmQuotationVersion,
    CrmRoundRobinCursor,
    CrmSalespersonConfig,
    CrmSalespersonTerritory,
    CrmSalesQuotation,
    CrmStageHistory,
)
from app.database.base import _utcnow
from app.database.session import get_db_session
from app.main import app
from app.masters.countries.models import Country
from app.masters.product_categories.models import ProductCategory
from app.masters.products.models import Product
from app.masters.states.models import State
from app.masters.uom.models import UnitOfMeasurement
from app.notifications.models import Notification
from app.org_structure.models import DepartmentLeadershipAssignment, LeadershipType, OrgRecordStatus
from app.rbac.models import Permission, Role, RoleAssignmentStatus, RolePermission, UserPermission, UserRole
from app.users.models import User, UserStatus

TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://postgres:root@127.0.0.1:5432/inhyma_test_db",
)


def _auth_headers(user: User, session_id: str) -> dict[str, str]:
    tok = create_access_token(user.id, session_id=session_id)
    return {"Authorization": f"Bearer {tok.token}"}


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def wave3_env():
    """Provision an isolated synthetic Wave 3 dataset in local PG18 and tear down 100% cleanly."""
    assert "127.0.0.1" in TEST_DB_URL or "localhost" in TEST_DB_URL, (
        f"Refusing to run against non-local database URL: {TEST_DB_URL}"
    )

    engine = create_async_engine(TEST_DB_URL, echo=False, pool_size=10, max_overflow=10)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with SessionLocal() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db_session] = override_get_db

    tracked: dict[str, list[uuid.UUID]] = {
        "users": [],
        "roles": [],
        "perms": [],
        "pipelines": [],
        "leads": [],
        "quotations": [],
        "products": [],
        "categories": [],
        "uoms": [],
        "states": [],
        "countries": [],
    }

    ts = int(time.time())
    tag = f"{ts % 100000:05d}"
    pw_hash = hash_password("Wave3Test@2026!")

    try:
        async with SessionLocal() as db:
            perm_codes = [
                "crm.pipelines.view",
                "crm.pipelines.manage",
                "crm.leads.view",
                "crm.leads.manage",
                "crm.distribution.view",
                "crm.distribution.manage",
                "lead_source.view",
            ]
            perms: dict[str, Permission] = {}
            for code in perm_codes:
                p = (await db.execute(select(Permission).where(Permission.code == code))).scalar_one_or_none()
                if not p:
                    parts = code.split(".")
                    p = Permission(code=code, module=parts[0], action=parts[-1], description=code)
                    db.add(p)
                    await db.flush()
                    tracked["perms"].append(p.id)
                perms[code] = p

            sa_role = (await db.execute(select(Role).where(Role.name == "super_admin", Role.deleted_at.is_(None)))).scalar_one_or_none()
            if not sa_role:
                sa_role = Role(name="super_admin", code=f"W3SA{tag}", description="Super Admin")
                db.add(sa_role)
                await db.flush()
                tracked["roles"].append(sa_role.id)

            dept_a = Role(name=f"W3_DeptA_{tag}", code=f"W3DA{tag}", description="Wave3 Dept A")
            dept_b = Role(name=f"W3_DeptB_{tag}", code=f"W3DB{tag}", description="Wave3 Dept B")
            role_mgr = Role(name=f"W3_Mgr_{tag}", code=f"W3MG{tag}", description="Wave3 Manager Role")
            role_sp = Role(name=f"W3_Rep_{tag}", code=f"W3RP{tag}", description="Wave3 Rep Role")
            db.add_all([dept_a, dept_b, role_mgr, role_sp])
            await db.flush()
            tracked["roles"].extend([dept_a.id, dept_b.id, role_mgr.id, role_sp.id])

            # Manager: crm.leads.view/manage + crm.distribution.view/manage (NO state.view, NO product.view, NO lead_source.view)
            for c in ("crm.pipelines.view", "crm.leads.view", "crm.leads.manage", "crm.distribution.view", "crm.distribution.manage"):
                db.add(RolePermission(role_id=role_mgr.id, permission_id=perms[c].id))

            # Salesperson: crm.leads.view + crm.pipelines.view ONLY
            for c in ("crm.pipelines.view", "crm.leads.view"):
                db.add(RolePermission(role_id=role_sp.id, permission_id=perms[c].id))

            async def mk_user(uname: str, dname: str, roles: list[Role], *, manager_id: uuid.UUID | None = None) -> User:
                u = User(
                    username=uname,
                    email=f"{uname}@w3.inhyma.local",
                    display_name=dname,
                    password_hash=pw_hash,
                    has_login=True,
                    is_active=True,
                    status=UserStatus.ACTIVE,
                    manager_id=manager_id,
                )
                db.add(u)
                await db.flush()
                tracked["users"].append(u.id)
                for idx, r in enumerate(roles):
                    db.add(UserRole(user_id=u.id, role_id=r.id, status=RoleAssignmentStatus.ACTIVE, is_primary=(idx == 0)))
                return u

            u_sa = await mk_user(f"w3_sa_{tag}", "Wave3 SuperAdmin", [sa_role])
            u_mgr_a = await mk_user(f"w3_mgra_{tag}", "Wave3 Manager A", [dept_a, role_mgr])
            u_mgr_b = await mk_user(f"w3_mgrb_{tag}", "Wave3 Manager B", [dept_b, role_mgr])
            u_sp_a1 = await mk_user(f"w3_spa1_{tag}", "Wave3 Salesperson A1", [dept_a, role_sp], manager_id=u_mgr_a.id)
            u_sp_a2 = await mk_user(f"w3_spa2_{tag}", "Wave3 Salesperson A2", [dept_a, role_sp], manager_id=u_mgr_a.id)
            u_sp_b1 = await mk_user(f"w3_spb1_{tag}", "Wave3 Salesperson B1", [dept_b, role_sp], manager_id=u_mgr_b.id)
            u_denied = await mk_user(f"w3_den_{tag}", "Wave3 Denied User", [dept_a, role_mgr])

            db.add_all([
                DepartmentLeadershipAssignment(
                    department_id=dept_a.id,
                    employee_id=u_mgr_a.id,
                    leadership_type=LeadershipType.DEPARTMENT_HEAD,
                    is_primary=True,
                    status=OrgRecordStatus.ACTIVE,
                ),
                DepartmentLeadershipAssignment(
                    department_id=dept_b.id,
                    employee_id=u_mgr_b.id,
                    leadership_type=LeadershipType.DEPARTMENT_HEAD,
                    is_primary=True,
                    status=OrgRecordStatus.ACTIVE,
                ),
                UserPermission(user_id=u_denied.id, permission_id=perms["crm.leads.view"].id, is_granted=False),
                UserPermission(user_id=u_denied.id, permission_id=perms["crm.distribution.view"].id, is_granted=False),
            ])

            sessions: dict[uuid.UUID, str] = {}
            for usr in (u_sa, u_mgr_a, u_mgr_b, u_sp_a1, u_sp_a2, u_sp_b1, u_denied):
                sid = str(uuid.uuid4())
                db.add(
                    AuthSession(
                        id=uuid.UUID(sid),
                        user_id=usr.id,
                        refresh_token_jti=f"w3_{sid}",
                        expires_at=_utcnow() + timedelta(hours=2),
                    )
                )
                sessions[usr.id] = sid

            country = (await db.execute(select(Country).where(Country.deleted_at.is_(None)).limit(1))).scalar_one_or_none()
            if not country:
                country = Country(name=f"W3Country_{tag}", code=f"W{tag[:2]}", status=RecordStatus.ACTIVE)
                db.add(country)
                await db.flush()
                tracked["countries"].append(country.id)

            state_1 = State(name=f"W3StateOne_{tag}", code=f"S1{tag[:3]}", country_id=country.id, status=RecordStatus.ACTIVE)
            state_2 = State(name=f"W3StateTwo_{tag}", code=f"S2{tag[:3]}", country_id=country.id, status=RecordStatus.ACTIVE)
            db.add_all([state_1, state_2])
            await db.flush()
            tracked["states"].extend([state_1.id, state_2.id])

            cat = ProductCategory(code=f"W3CAT{tag}", name=f"W3 Cat {tag}", status=RecordStatus.ACTIVE)
            uom = UnitOfMeasurement(code=f"W3U{tag}", name=f"W3 Unit {tag}", short_name="U", status=RecordStatus.ACTIVE)
            db.add_all([cat, uom])
            await db.flush()
            tracked["categories"].append(cat.id)
            tracked["uoms"].append(uom.id)

            prod = Product(
                product_code=f"W3PROD-{tag}",
                product_name=f"Wave3 Sellable Machine {tag}",
                product_name_tally=f"Wave3 Sellable Machine {tag}",
                category_id=cat.id,
                uom_id=uom.id,
                standard_price=Decimal("25000.00"),
                is_sellable=True,
                status=RecordStatus.ACTIVE,
            )
            db.add(prod)
            await db.flush()
            tracked["products"].append(prod.id)

            pipe = CrmPipeline(name=f"W3 Pipeline {tag}", is_default=False, is_active=True, created_by=u_sa.id)
            db.add(pipe)
            await db.flush()
            tracked["pipelines"].append(pipe.id)

            st_open = CrmPipelineStage(pipeline_id=pipe.id, name="New", stage_order=1, stage_type="open", is_initial=True, is_active=True)
            st_won = CrmPipelineStage(pipeline_id=pipe.id, name="Won", stage_order=2, stage_type="won", is_initial=False, is_active=True)
            db.add_all([st_open, st_won])
            await db.flush()

            db.add_all([
                CrmSalespersonConfig(user_id=u_sp_a1.id, is_eligible=True, priority=1, max_lead_capacity=5, is_active=True, notes="Initial A1 note"),
                CrmSalespersonConfig(user_id=u_sp_a2.id, is_eligible=True, priority=2, max_lead_capacity=10, is_active=True, notes="Initial A2 note"),
                CrmSalespersonConfig(user_id=u_sp_b1.id, is_eligible=True, priority=1, max_lead_capacity=10, is_active=True, notes="Initial B1 note"),
            ])

            lead_a1 = CrmLead(
                lead_code=f"W3-A1-{tag}",
                name="Wave3 Lead A1",
                original_phone=f"+9192100{tag}",
                normalized_phone=f"+9192100{tag}",
                pipeline_id=pipe.id,
                stage_id=st_open.id,
                assigned_to=u_sp_a1.id,
                created_by=u_mgr_a.id,
                status="new",
            )
            lead_a2 = CrmLead(
                lead_code=f"W3-A2-{tag}",
                name="Wave3 Lead A2",
                original_phone=f"+9192200{tag}",
                normalized_phone=f"+9192200{tag}",
                pipeline_id=pipe.id,
                stage_id=st_open.id,
                assigned_to=u_sp_a2.id,
                created_by=u_mgr_a.id,
                status="new",
            )
            lead_b1 = CrmLead(
                lead_code=f"W3-B1-{tag}",
                name="Wave3 Lead B1",
                original_phone=f"+9192300{tag}",
                normalized_phone=f"+9192300{tag}",
                pipeline_id=pipe.id,
                stage_id=st_open.id,
                assigned_to=u_sp_b1.id,
                created_by=u_mgr_b.id,
                status="new",
            )
            lead_b_unassigned = CrmLead(
                lead_code=f"W3-BU-{tag}",
                name="Wave3 Dept B Unassigned",
                original_phone=f"+9192400{tag}",
                normalized_phone=f"+9192400{tag}",
                pipeline_id=pipe.id,
                stage_id=st_open.id,
                assigned_to=None,
                created_by=u_mgr_b.id,
                status="new",
            )
            lead_a_unassigned = CrmLead(
                lead_code=f"W3-AU-{tag}",
                name="Wave3 Dept A Unassigned",
                original_phone=f"+9192500{tag}",
                normalized_phone=f"+9192500{tag}",
                pipeline_id=pipe.id,
                stage_id=st_open.id,
                assigned_to=None,
                created_by=u_mgr_a.id,
                status="new",
            )
            lead_timeline = CrmLead(
                lead_code=f"W3-TL-{tag}",
                name="Wave3 Timeline Lead",
                original_phone=f"+9192600{tag}",
                normalized_phone=f"+9192600{tag}",
                pipeline_id=pipe.id,
                stage_id=st_open.id,
                assigned_to=u_sp_a1.id,
                created_by=u_mgr_a.id,
                status="new",
            )
            db.add_all([lead_a1, lead_a2, lead_b1, lead_b_unassigned, lead_a_unassigned, lead_timeline])
            await db.flush()
            tracked["leads"].extend([lead_a1.id, lead_a2.id, lead_b1.id, lead_b_unassigned.id, lead_a_unassigned.id, lead_timeline.id])

            # Assignment history for LM-DEF-017 (chronological: initial import row BEFORE manual unassignment)
            db.add_all([
                CrmAssignmentHistory(
                    lead_id=lead_b_unassigned.id,
                    previous_owner_id=None,
                    new_owner_id=None,
                    assignment_method="import",
                    assigned_by=None,
                    reason="Dept B system unassignment",
                    created_at=_utcnow() - timedelta(minutes=5),
                ),
                CrmAssignmentHistory(
                    lead_id=lead_b_unassigned.id,
                    previous_owner_id=u_sp_b1.id,
                    new_owner_id=None,
                    assignment_method="manual",
                    assigned_by=u_mgr_b.id,
                    reason="Dept B confidential unassignment",
                    created_at=_utcnow(),
                ),
                CrmAssignmentHistory(
                    lead_id=lead_a_unassigned.id,
                    previous_owner_id=u_sp_a1.id,
                    new_owner_id=None,
                    assignment_method="manual",
                    assigned_by=u_mgr_a.id,
                    reason="Dept A legitimate unassignment",
                    created_at=_utcnow(),
                ),
            ])

            # Follow-ups for LM-DEF-014
            now = _utcnow()
            db.add_all([
                CrmFollowUp(
                    lead_id=lead_a1.id,
                    assigned_to=u_sp_a1.id,
                    created_by=u_sp_a1.id,
                    follow_up_type="call",
                    due_at=now + timedelta(days=1),
                    status="pending",
                    notes="W3 pending follow-up",
                ),
                CrmFollowUp(
                    lead_id=lead_a1.id,
                    assigned_to=u_sp_a1.id,
                    created_by=u_sp_a1.id,
                    follow_up_type="email",
                    due_at=now - timedelta(days=1),
                    status="completed",
                    completed_at=now - timedelta(hours=2),
                    notes="W3 completed follow-up",
                ),
                CrmFollowUp(
                    lead_id=lead_a1.id,
                    assigned_to=u_sp_a1.id,
                    created_by=u_sp_a1.id,
                    follow_up_type="meeting",
                    due_at=now - timedelta(days=2),
                    status="cancelled",
                    notes="W3 cancelled follow-up",
                ),
                CrmFollowUp(
                    lead_id=lead_a2.id,
                    assigned_to=u_sp_a2.id,
                    created_by=u_sp_a2.id,
                    follow_up_type="call",
                    due_at=now + timedelta(days=2),
                    status="pending",
                    notes="Other lead A2 follow-up",
                ),
            ])

            # Normal activities + legacy historical reassignment note on lead_timeline (LM-DEF-019)
            db.add_all([
                CrmActivity(
                    lead_id=lead_timeline.id,
                    activity_type="note",
                    subject="Customer Budget Note",
                    description="Client confirmed Rs 5L budget.",
                    performed_by=u_sp_a1.id,
                ),
                CrmActivity(
                    lead_id=lead_timeline.id,
                    activity_type="call",
                    subject="Intro Discovery Call",
                    description="Spoke to buyer.",
                    performed_by=u_sp_a1.id,
                ),
                CrmActivity(
                    lead_id=lead_timeline.id,
                    activity_type="note",
                    subject="Lead Reassigned",
                    description="Historical pre-Wave3 duplicate reassignment activity row.",
                    performed_by=u_mgr_a.id,
                ),
            ])
            await db.commit()

        yield {
            "SessionLocal": SessionLocal,
            "tracked": tracked,
            "tag": tag,
            "perms": perms,
            "role_mgr": role_mgr,
            "country": country,
            "state_1": state_1,
            "state_2": state_2,
            "prod": prod,
            "pipe": pipe,
            "st_open": st_open,
            "u_sa": u_sa,
            "u_mgr_a": u_mgr_a,
            "u_mgr_b": u_mgr_b,
            "u_sp_a1": u_sp_a1,
            "u_sp_a2": u_sp_a2,
            "u_sp_b1": u_sp_b1,
            "u_denied": u_denied,
            "lead_a1": lead_a1,
            "lead_a2": lead_a2,
            "lead_b1": lead_b1,
            "lead_b_unassigned": lead_b_unassigned,
            "lead_a_unassigned": lead_a_unassigned,
            "lead_timeline": lead_timeline,
            "hdr_sa": _auth_headers(u_sa, sessions[u_sa.id]),
            "hdr_mgr_a": _auth_headers(u_mgr_a, sessions[u_mgr_a.id]),
            "hdr_mgr_b": _auth_headers(u_mgr_b, sessions[u_mgr_b.id]),
            "hdr_sp_a1": _auth_headers(u_sp_a1, sessions[u_sp_a1.id]),
            "hdr_sp_a2": _auth_headers(u_sp_a2, sessions[u_sp_a2.id]),
            "hdr_sp_b1": _auth_headers(u_sp_b1, sessions[u_sp_b1.id]),
            "hdr_denied": _auth_headers(u_denied, sessions[u_denied.id]),
        }
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db_session, None)

        async with SessionLocal() as db:
            if tracked["quotations"]:
                await db.execute(delete(CrmQuotationVersion).where(CrmQuotationVersion.quotation_id.in_(tracked["quotations"])))
                await db.execute(delete(CrmQuotationItem).where(CrmQuotationItem.quotation_id.in_(tracked["quotations"])))
            if tracked["leads"]:
                await db.execute(delete(CrmSalesQuotation).where(CrmSalesQuotation.lead_id.in_(tracked["leads"])))
                await db.execute(delete(CrmLeadProduct).where(CrmLeadProduct.lead_id.in_(tracked["leads"])))
                await db.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_(tracked["leads"])))
                await db.execute(delete(CrmFollowUp).where(CrmFollowUp.lead_id.in_(tracked["leads"])))
                await db.execute(delete(CrmStageHistory).where(CrmStageHistory.lead_id.in_(tracked["leads"])))
                await db.execute(delete(CrmAssignmentHistory).where(CrmAssignmentHistory.lead_id.in_(tracked["leads"])))
                await db.execute(delete(CrmLead).where(CrmLead.id.in_(tracked["leads"])))
            if tracked["users"]:
                cfg_ids = list(
                    (await db.execute(select(CrmSalespersonConfig.id).where(CrmSalespersonConfig.user_id.in_(tracked["users"])))).scalars().all()
                )
                if cfg_ids:
                    await db.execute(delete(CrmSalespersonTerritory).where(CrmSalespersonTerritory.salesperson_config_id.in_(cfg_ids)))
                    await db.execute(delete(CrmSalespersonConfig).where(CrmSalespersonConfig.id.in_(cfg_ids)))
                await db.execute(delete(CrmRoundRobinCursor).where(CrmRoundRobinCursor.last_assigned_user_id.in_(tracked["users"])))
                await db.execute(delete(Notification).where(Notification.user_id.in_(tracked["users"])))
                await db.execute(delete(AuditLog).where(AuditLog.user_id.in_(tracked["users"])))
                await db.execute(delete(DepartmentLeadershipAssignment).where(DepartmentLeadershipAssignment.employee_id.in_(tracked["users"])))
                await db.execute(delete(UserPermission).where(UserPermission.user_id.in_(tracked["users"])))
                await db.execute(delete(UserRole).where(UserRole.user_id.in_(tracked["users"])))
                await db.execute(delete(AuthSession).where(AuthSession.user_id.in_(tracked["users"])))
            if tracked["pipelines"]:
                await db.execute(delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id.in_(tracked["pipelines"])))
                await db.execute(delete(CrmPipeline).where(CrmPipeline.id.in_(tracked["pipelines"])))
            if tracked["products"]:
                await db.execute(delete(Product).where(Product.id.in_(tracked["products"])))
            if tracked["categories"]:
                await db.execute(delete(ProductCategory).where(ProductCategory.id.in_(tracked["categories"])))
            if tracked["uoms"]:
                await db.execute(delete(UnitOfMeasurement).where(UnitOfMeasurement.id.in_(tracked["uoms"])))
            if tracked["states"]:
                await db.execute(delete(State).where(State.id.in_(tracked["states"])))
            if tracked["countries"]:
                await db.execute(delete(Country).where(Country.id.in_(tracked["countries"])))
            if tracked["users"]:
                await db.execute(delete(User).where(User.id.in_(tracked["users"])))
            if tracked["roles"]:
                await db.execute(delete(RolePermission).where(RolePermission.role_id.in_(tracked["roles"])))
                await db.execute(delete(Role).where(Role.id.in_(tracked["roles"])))
            if tracked["perms"]:
                await db.execute(delete(Permission).where(Permission.id.in_(tracked["perms"])))
            await db.commit()
        await engine.dispose()


@pytest.mark.asyncio(loop_scope="module")
async def test_lm_def_008_salesperson_quotation_and_product_lookup(wave3_env):
    env = wave3_env
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        # Salesperson without product.view CAN search via /api/v1/crm/products/lookup
        r_lookup = await client.get(f"/api/v1/crm/products/lookup?q=W3PROD-{env['tag']}", headers=env["hdr_sp_a1"])
        assert r_lookup.status_code == 200, r_lookup.text
        assert any(i["id"] == str(env["prod"].id) for i in r_lookup.json()["data"]["items"])

        # /masters/products remains 403 for salesperson without product.view
        assert (await client.get("/api/v1/masters/products?limit=5", headers=env["hdr_sp_a1"])).status_code == 403

        # Denied user blocked on CRM product lookup
        assert (await client.get("/api/v1/crm/products/lookup?q=W3PROD", headers=env["hdr_denied"])).status_code == 403

        quote_payload = {
            "currency": "INR",
            "notes": "Wave3 salesperson quotation",
            "items": [
                {
                    "product_id": str(env["prod"].id),
                    "product_name": env["prod"].product_name,
                    "product_code": env["prod"].product_code,
                    "uom": "Nos",
                    "quantity": 1,
                    "unit_price": 25000,
                    "unit_discount": 0,
                    "tax_rate": 18,
                }
            ],
        }
        # Salesperson A1 (crm.leads.view only) creates quotation on own assigned lead -> 201
        r_own = await client.post(f"/api/v1/crm/leads/{env['lead_a1'].id}/quotations", json=quote_payload, headers=env["hdr_sp_a1"])
        assert r_own.status_code == 201, r_own.text
        qid = uuid.UUID(r_own.json()["data"]["id"])
        env["tracked"]["quotations"].append(qid)

        # Salesperson A1 updates draft & transitions draft -> sent -> 200
        r_sent = await client.patch(f"/api/v1/crm/quotations/{qid}/status", json={"status": "sent"}, headers=env["hdr_sp_a1"])
        assert r_sent.status_code == 200, r_sent.text

        # Unauthorized personas blocked: peer A2, cross-dept B1, explicitly denied user
        assert (await client.post(f"/api/v1/crm/leads/{env['lead_a1'].id}/quotations", json=quote_payload, headers=env["hdr_sp_a2"])).status_code == 403
        assert (await client.post(f"/api/v1/crm/leads/{env['lead_a1'].id}/quotations", json=quote_payload, headers=env["hdr_sp_b1"])).status_code == 403
        assert (await client.post(f"/api/v1/crm/leads/{env['lead_a1'].id}/quotations", json=quote_payload, headers=env["hdr_denied"])).status_code == 403


@pytest.mark.asyncio(loop_scope="module")
async def test_lm_def_009_states_lookup_and_distribution_rbac(wave3_env):
    env = wave3_env
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        # Manager A without state.view: /masters/states is 403, /masters/states/lookup is 200
        assert (await client.get("/api/v1/masters/states?limit=500&status=active", headers=env["hdr_mgr_a"])).status_code == 403
        r_lookup = await client.get("/api/v1/masters/states/lookup", headers=env["hdr_mgr_a"])
        assert r_lookup.status_code == 200, r_lookup.text
        ids = {s["id"] for s in r_lookup.json()["data"]}
        assert str(env["state_1"].id) in ids and str(env["state_2"].id) in ids

        # Admin also succeeds
        assert (await client.get("/api/v1/masters/states/lookup", headers=env["hdr_sa"])).status_code == 200

        # Unauthorized salesperson & denied user blocked on distribution endpoint
        assert (await client.get("/api/v1/crm/distribution/salespeople", headers=env["hdr_sp_a1"])).status_code == 403
        assert (await client.get("/api/v1/crm/distribution/salespeople", headers=env["hdr_denied"])).status_code == 403


@pytest.mark.asyncio(loop_scope="module")
async def test_lm_def_013_clear_distribution_fields_to_null(wave3_env):
    env = wave3_env
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        url = f"/api/v1/crm/distribution/salespeople/{env['u_sp_a1'].id}"

        # 1. Explicit max_lead_capacity: null clears to None while preserving omitted notes
        r1 = await client.put(url, json={"max_lead_capacity": None}, headers=env["hdr_mgr_a"])
        assert r1.status_code == 200, r1.text
        assert r1.json()["data"]["max_lead_capacity"] is None, f"LM-DEF-013 REPRO: capacity stayed {r1.json()['data']['max_lead_capacity']}"
        assert r1.json()["data"]["notes"] == "Initial A1 note"

        # 2. Set valid capacity=12, then explicitly clear notes: null while preserving omitted capacity
        r2 = await client.put(url, json={"max_lead_capacity": 12}, headers=env["hdr_mgr_a"])
        assert r2.status_code == 200 and r2.json()["data"]["max_lead_capacity"] == 12

        r3 = await client.put(url, json={"notes": None}, headers=env["hdr_mgr_a"])
        assert r3.status_code == 200, r3.text
        assert r3.json()["data"]["notes"] is None, f"LM-DEF-013 REPRO: notes stayed {r3.json()['data']['notes']}"
        assert r3.json()["data"]["max_lead_capacity"] == 12

        # 3. Omitting both capacity & notes preserves existing values
        await client.put(url, json={"notes": "Keep me"}, headers=env["hdr_mgr_a"])
        r4 = await client.put(url, json={"priority": 3}, headers=env["hdr_mgr_a"])
        assert r4.status_code == 200
        d4 = r4.json()["data"]
        assert d4["priority"] == 3 and d4["max_lead_capacity"] == 12 and d4["notes"] == "Keep me"

        # 4. Invalid negative capacity -> 422
        assert (await client.put(url, json={"max_lead_capacity": -1}, headers=env["hdr_mgr_a"])).status_code == 422

        # 5. Cross-dept & unauthorized salesperson blocked -> 403
        assert (await client.put(f"/api/v1/crm/distribution/salespeople/{env['u_sp_b1'].id}", json={"priority": 2}, headers=env["hdr_mgr_a"])).status_code == 403
        assert (await client.put(url, json={"priority": 2}, headers=env["hdr_sp_a1"])).status_code == 403


@pytest.mark.asyncio(loop_scope="module")
async def test_lm_def_032_all_territories_wildcard_and_future_state(wave3_env):
    env = wave3_env
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        url_a1 = f"/api/v1/crm/distribution/salespeople/{env['u_sp_a1'].id}"
        url_a2 = f"/api/v1/crm/distribution/salespeople/{env['u_sp_a2'].id}"

        # Select specific state -> persists [state_1]
        r_spec = await client.put(url_a1, json={"is_eligible": True, "territory_state_ids": [str(env["state_1"].id)]}, headers=env["hdr_mgr_a"])
        assert r_spec.status_code == 200
        assert [t["state_id"] for t in r_spec.json()["data"]["territories"]] == [str(env["state_1"].id)]

        # Switch to All Territories wildcard [] -> clears previous territory IDs
        r_wild = await client.put(url_a1, json={"is_eligible": True, "territory_state_ids": []}, headers=env["hdr_mgr_a"])
        assert r_wild.status_code == 200
        assert r_wild.json()["data"]["territories"] == []

        # Restrict sp_a2 to state_1 only
        assert (await client.put(url_a2, json={"is_eligible": True, "territory_state_ids": [str(env["state_1"].id)]}, headers=env["hdr_mgr_a"])).status_code == 200

        # Add brand-new state in isolated PG18 fixture and verify wildcard salesperson remains eligible & receives assignment
        async with env["SessionLocal"]() as db:
            st_new = State(name=f"W3Future_{env['tag']}", code=f"SF{env['tag'][:3]}", country_id=env["country"].id, status=RecordStatus.ACTIVE)
            db.add(st_new)
            await db.flush()
            env["tracked"]["states"].append(st_new.id)

            lead_fut = CrmLead(
                lead_code=f"W3-FUT-{env['tag']}",
                name="Wave3 Future State Lead",
                original_phone=f"+9192700{env['tag']}",
                normalized_phone=f"+9192700{env['tag']}",
                pipeline_id=env["pipe"].id,
                stage_id=env["st_open"].id,
                assigned_to=None,
                created_by=env["u_mgr_a"].id,
                status="new",
                custom_fields={"state_id": str(st_new.id)},
            )
            db.add(lead_fut)
            await db.flush()
            env["tracked"]["leads"].append(lead_fut.id)

            mgr_actor = CurrentUser(
                id=env["u_mgr_a"].id,
                username=env["u_mgr_a"].username,
                display_name=env["u_mgr_a"].display_name or "",
                is_super_admin=False,
                permissions={"crm.leads.view", "crm.leads.manage", "crm.distribution.view", "crm.distribution.manage"},
            )
            svc = CrmAssignmentEngineService(db)
            candidates = await svc.get_eligible_candidates(actor=mgr_actor)
            sp1_cand = next((c for c in candidates if c.user_id == env["u_sp_a1"].id), None)
            assert sp1_cand is not None and sp1_cand.territory_state_ids == set()

            res = await svc.assign_lead(lead_fut, actor=mgr_actor, commit=True)
            assert res.assigned is True and res.assigned_to in {env["u_sp_a1"].id, env["u_sp_a2"].id}

        # Switch from All Territories -> specific state_2 removes wildcard
        r_back = await client.put(url_a1, json={"is_eligible": True, "territory_state_ids": [str(env["state_2"].id)]}, headers=env["hdr_mgr_a"])
        assert r_back.status_code == 200
        assert [t["state_id"] for t in r_back.json()["data"]["territories"]] == [str(env["state_2"].id)]

        # Unauthorized cross-dept territory modification blocked
        assert (await client.put(f"/api/v1/crm/distribution/salespeople/{env['u_sp_b1'].id}", json={"territory_state_ids": []}, headers=env["hdr_mgr_a"])).status_code == 403


@pytest.mark.asyncio(loop_scope="module")
async def test_lm_def_014_follow_ups_status_all(wave3_env):
    env = wave3_env
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        r = await client.get(f"/api/v1/crm/follow-ups?lead_id={env['lead_a1'].id}&status=all&page_size=50", headers=env["hdr_sp_a1"])
        assert r.status_code == 200, r.text
        items = r.json()["data"]["items"]
        assert {"pending", "completed", "cancelled"}.issubset({it["status"] for it in items})
        assert all(it["lead_id"] == str(env["lead_a1"].id) for it in items)

        # Cross-department manager blocked
        assert (await client.get(f"/api/v1/crm/follow-ups?lead_id={env['lead_a1'].id}&status=all", headers=env["hdr_mgr_b"])).status_code == 403


@pytest.mark.asyncio(loop_scope="module")
async def test_lm_def_017_assignment_history_null_owner_privacy(wave3_env):
    env = wave3_env
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        # Dept Manager A must NOT see Dept B null-owner unassignment history, MUST see Dept A's
        r_a = await client.get("/api/v1/crm/assignment-history?page_size=100", headers=env["hdr_mgr_a"])
        assert r_a.status_code == 200, r_a.text
        ids_a = {it["lead_id"] for it in r_a.json()["data"]["items"]}
        assert str(env["lead_b_unassigned"].id) not in ids_a, "LM-DEF-017 REPRO: Manager A leaked Dept B null-owner history!"
        assert str(env["lead_a_unassigned"].id) in ids_a

        # Dept Manager B must NOT see Dept A null-owner unassignment history, MUST see Dept B's
        r_b = await client.get("/api/v1/crm/assignment-history?page_size=100", headers=env["hdr_mgr_b"])
        assert r_b.status_code == 200
        ids_b = {it["lead_id"] for it in r_b.json()["data"]["items"]}
        assert str(env["lead_a_unassigned"].id) not in ids_b, "LM-DEF-017 REPRO: Manager B leaked Dept A null-owner history!"
        assert str(env["lead_b_unassigned"].id) in ids_b

        # SuperAdmin sees both
        r_sa = await client.get("/api/v1/crm/assignment-history?page_size=100", headers=env["hdr_sa"])
        assert r_sa.status_code == 200
        ids_sa = {it["lead_id"] for it in r_sa.json()["data"]["items"]}
        assert str(env["lead_a_unassigned"].id) in ids_sa and str(env["lead_b_unassigned"].id) in ids_sa

        # Denied user blocked
        assert (await client.get("/api/v1/crm/assignment-history", headers=env["hdr_denied"])).status_code == 403


@pytest.mark.asyncio(loop_scope="module")
async def test_lm_def_019_reassignment_single_timeline_entry(wave3_env):
    env = wave3_env
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        r_re = await client.post(
            f"/api/v1/crm/leads/{env['lead_timeline'].id}/reassign",
            json={
                "new_salesperson_id": str(env["u_sp_a2"].id),
                "reason": "Balancing territory load across Dept A team",
            },
            headers=env["hdr_mgr_a"],
        )
        assert r_re.status_code == 200, r_re.text

        # Check stored activity_type == 'reassignment'
        async with env["SessionLocal"]() as db:
            acts = (
                await db.execute(
                    select(CrmActivity).where(
                        CrmActivity.lead_id == env["lead_timeline"].id,
                        CrmActivity.description.ilike("%Balancing territory load%"),
                    )
                )
            ).scalars().all()
            assert len(acts) == 1
            assert acts[0].activity_type == "reassignment", (
                f"LM-DEF-019 REPRO: reassign_lead wrote activity_type={acts[0].activity_type!r}"
            )

        # Unified timeline must contain EXACTLY 1 reassignment entry (neither new nor legacy duplicate note!)
        r_tl = await client.get(f"/api/v1/crm/leads/{env['lead_timeline'].id}/timeline", headers=env["hdr_mgr_a"])
        assert r_tl.status_code == 200, r_tl.text
        tl_items = r_tl.json()["data"]["items"]

        re_entries = [
            it for it in tl_items
            if it["timeline_type"] == "assignment_history"
            or (it["timeline_type"] == "activity" and (it.get("title") or "").strip().lower() == "lead reassigned")
        ]
        assert len(re_entries) == 1, f"LM-DEF-019 REPRO: Got {len(re_entries)} reassignment entries: {[(x['timeline_type'], x['title']) for x in re_entries]}"
        assert re_entries[0]["timeline_type"] == "assignment_history"

        # Normal user notes & calls remain visible
        titles = {it["title"] for it in tl_items}
        assert "Customer Budget Note" in titles and "Intro Discovery Call" in titles

        # Repeated read does not mutate; former owner (sp_a1) and cross-dept (mgr_b) blocked
        assert len((await client.get(f"/api/v1/crm/leads/{env['lead_timeline'].id}/timeline", headers=env["hdr_mgr_a"])).json()["data"]["items"]) == len(tl_items)
        assert (await client.get(f"/api/v1/crm/leads/{env['lead_timeline'].id}/timeline", headers=env["hdr_sp_a1"])).status_code == 403
        assert (await client.get(f"/api/v1/crm/leads/{env['lead_timeline'].id}/timeline", headers=env["hdr_mgr_b"])).status_code == 403
        assert (await client.get(f"/api/v1/crm/assignment-history?lead_id={env['lead_timeline'].id}", headers=env["hdr_sp_a1"])).status_code == 403


@pytest.mark.asyncio(loop_scope="module")
async def test_lm_def_020_superadmin_explicit_deny_precedence(wave3_env):
    env = wave3_env
    async with env["SessionLocal"]() as db:
        assert await load_explicit_crm_denies(db, env["u_sa"].id, {"*"}, is_super_admin=True) == set()
        for prefix in ("deny:", "block:", "!", "-"):
            denies = await load_explicit_crm_denies(db, env["u_sa"].id, {"*", f"{prefix}crm.leads.view"}, is_super_admin=True)
            assert "crm.leads.view" in denies, f"LM-DEF-020 REPRO: SuperAdmin deny prefix {prefix!r} bypassed!"

    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        for prefix in ("deny:", "block:", "!", "-"):
            def _make_dep(pfx: str = prefix):
                async def _dep():
                    return CurrentUser(
                        id=env["u_sa"].id,
                        username=env["u_sa"].username,
                        display_name=env["u_sa"].display_name or "",
                        is_super_admin=True,
                        permissions=AdminPermissionSet({"*", f"{pfx}crm.leads.view"}),
                    )
                return _dep

            app.dependency_overrides[get_current_user] = _make_dep()
            try:
                r = await client.get("/api/v1/crm/leads")
                assert r.status_code == 403, f"LM-DEF-020 REPRO: HTTP allowed SuperAdmin with {prefix}crm.leads.view ({r.status_code})"
            finally:
                app.dependency_overrides.pop(get_current_user, None)

        # Normal SuperAdmin without deny -> 200
        assert (await client.get("/api/v1/crm/leads", headers=env["hdr_sa"])).status_code == 200

        # DB user_permissions(is_granted=False) on SuperAdmin -> 403
        async with env["SessionLocal"]() as db:
            db.add(UserPermission(user_id=env["u_sa"].id, permission_id=env["perms"]["crm.leads.view"].id, is_granted=False))
            await db.commit()
        try:
            assert (await client.get("/api/v1/crm/leads", headers=env["hdr_sa"])).status_code == 403
        finally:
            async with env["SessionLocal"]() as db:
                await db.execute(delete(UserPermission).where(UserPermission.user_id == env["u_sa"].id, UserPermission.permission_id == env["perms"]["crm.leads.view"].id))
                await db.commit()


@pytest.mark.asyncio(loop_scope="module")
async def test_lm_def_031b_lead_sources_backend_permission(wave3_env):
    env = wave3_env
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        assert (await client.get("/api/v1/masters/lead-sources", headers=env["hdr_sp_a1"])).status_code == 403
        assert (await client.get("/api/v1/masters/lead-sources", headers=env["hdr_sa"])).status_code == 200
