"""
INHYMA ERP — Lead Management Phase 2 / Wave 5: Cross-Department Privacy Remediation
Live PostgreSQL 18 Adversarial Verification Suite (25 Scenarios covering BLK-01, BLK-02, BLK-03).

Runs strictly against isolated local PostgreSQL 18 (`127.0.0.1:5432/inhyma_test_db`),
never touches production/staging, and cleans up 100% of synthetic test records.
"""
from __future__ import annotations

from datetime import timedelta
import os
import time
import uuid

from httpx import ASGITransport, AsyncClient
import pytest
import pytest_asyncio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth.models import Session as AuthSession
from app.auth.security import create_access_token, hash_password
from app.companies.models import Company
from app.crm.models import (
    CrmActivity,
    CrmAssignmentHistory,
    CrmFollowUp,
    CrmImportBatch,
    CrmLead,
    CrmPipeline,
    CrmPipelineStage,
    CrmSalespersonConfig,
    CrmStageHistory,
)
from app.database.base import _utcnow
from app.database.session import get_db_session
from app.main import app
from app.org_structure.models import DepartmentLeadershipAssignment, LeadershipType, OrgRecordStatus
from app.rbac.models import Permission, Role, RoleAssignmentStatus, RolePermission, UserPermission, UserRole
from app.users.models import User, UserStatus

TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://postgres:root@127.0.0.1:5432/inhyma_test_db",
)

pytestmark = [pytest.mark.asyncio(loop_scope="module"), pytest.mark.postgres]


def _auth_headers(user: User, session_id: str) -> dict[str, str]:
    tok = create_access_token(user.id, session_id=session_id)
    return {"Authorization": f"Bearer {tok.token}"}


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def wave5_env():
    assert "127.0.0.1" in TEST_DB_URL or "localhost" in TEST_DB_URL, (
        f"Refusing to run against non-local database URL: {TEST_DB_URL}"
    )

    engine = create_async_engine(TEST_DB_URL, echo=False, pool_size=15, max_overflow=15)
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

    tag = f"{int(time.time()) % 100000:05d}"
    tracked: dict[str, list[uuid.UUID]] = {
        "users": [],
        "roles": [],
        "pipelines": [],
        "leads": [],
        "batches": [],
        "companies": [],
    }

    try:
        async with SessionLocal() as db:
            perm_codes = [
                "crm.pipelines.view",
                "crm.leads.view",
                "crm.leads.manage",
                "crm.leads.import",
                "crm.distribution.view",
                "crm.distribution.manage",
            ]
            perms = {
                p.code: p
                for p in (await db.execute(select(Permission).where(Permission.code.in_(perm_codes)))).scalars().all()
            }
            sa_role = (await db.execute(select(Role).where(Role.name == "super_admin", Role.deleted_at.is_(None)))).scalar_one()

            dept_a = Role(name=f"W5_DeptA_{tag}", code=f"W5DA{tag}", description="Wave5 Dept A")
            dept_b = Role(name=f"W5_DeptB_{tag}", code=f"W5DB{tag}", description="Wave5 Dept B")
            role_mgr = Role(name=f"W5_Mgr_{tag}", code=f"W5MG{tag}", description="Wave5 Manager")
            role_sp = Role(name=f"W5_Rep_{tag}", code=f"W5SP{tag}", description="Wave5 Salesperson")
            db.add_all([dept_a, dept_b, role_mgr, role_sp])
            await db.flush()
            tracked["roles"].extend([dept_a.id, dept_b.id, role_mgr.id, role_sp.id])

            for c in perm_codes:
                db.add(RolePermission(role_id=role_mgr.id, permission_id=perms[c].id))
            for c in ("crm.pipelines.view", "crm.leads.view", "crm.leads.import"):
                db.add(RolePermission(role_id=role_sp.id, permission_id=perms[c].id))

            pw_hash = hash_password("Wave5Priv@123")

            async def mk_user(uname: str, dname: str, roles: list[Role], *, manager_id: uuid.UUID | None = None) -> User:
                u = User(
                    username=uname,
                    email=f"{uname}@w5.inhyma.local",
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

            u_admin = await mk_user(f"w5_sa_{tag}", "Wave5 SuperAdmin", [sa_role])
            u_admin_denied = await mk_user(f"w5_sa_den_{tag}", "Wave5 Denied SuperAdmin", [sa_role])
            u_mgr_a = await mk_user(f"w5_mgra_{tag}", "Wave5 Manager A", [dept_a, role_mgr])
            u_mgr_b = await mk_user(f"w5_mgrb_{tag}", "Wave5 Manager B", [dept_b, role_mgr])
            u_sp_a1 = await mk_user(f"w5_spa1_{tag}", "Wave5 Salesperson A1", [dept_a, role_sp], manager_id=u_mgr_a.id)
            u_sp_b1 = await mk_user(f"w5_spb1_{tag}", "Wave5 Salesperson B1", [dept_b, role_sp], manager_id=u_mgr_b.id)
            u_sp_b2 = await mk_user(f"w5_spb2_{tag}", "Wave5 Salesperson B2", [dept_b, role_sp], manager_id=u_mgr_b.id)
            u_denied_mgr = await mk_user(f"w5_den_{tag}", "Wave5 Denied Manager", [dept_a, role_mgr])

            db.add_all([
                DepartmentLeadershipAssignment(
                    department_id=dept_a.id, employee_id=u_mgr_a.id,
                    leadership_type=LeadershipType.DEPARTMENT_HEAD, is_primary=True, status=OrgRecordStatus.ACTIVE,
                ),
                DepartmentLeadershipAssignment(
                    department_id=dept_b.id, employee_id=u_mgr_b.id,
                    leadership_type=LeadershipType.DEPARTMENT_HEAD, is_primary=True, status=OrgRecordStatus.ACTIVE,
                ),
                CrmSalespersonConfig(user_id=u_sp_a1.id, is_eligible=True, is_active=True, priority=1),
                CrmSalespersonConfig(user_id=u_sp_b1.id, is_eligible=True, is_active=True, priority=1),
                CrmSalespersonConfig(user_id=u_sp_b2.id, is_eligible=True, is_active=True, priority=2),
            ])
            # Explicit denies on both denied manager AND denied SuperAdmin
            for denied_usr in (u_denied_mgr, u_admin_denied):
                for code in ("crm.leads.view", "crm.leads.manage", "crm.distribution.view", "crm.distribution.manage"):
                    db.add(UserPermission(user_id=denied_usr.id, permission_id=perms[code].id, is_granted=False))

            sids: dict[uuid.UUID, str] = {}
            for usr in (u_admin, u_admin_denied, u_mgr_a, u_mgr_b, u_sp_a1, u_sp_b1, u_sp_b2, u_denied_mgr):
                sid = str(uuid.uuid4())
                db.add(AuthSession(id=uuid.UUID(sid), user_id=usr.id, refresh_token_jti=f"w5_{sid}", expires_at=_utcnow() + timedelta(hours=2)))
                sids[usr.id] = sid

            comp_a = Company(company_name=f"W5 Dept A Client {tag}", is_active=True)
            comp_b = Company(company_name=f"W5 Dept B Client {tag}", is_active=True)
            db.add_all([comp_a, comp_b])
            await db.flush()
            tracked["companies"].extend([comp_a.id, comp_b.id])

            pipe = CrmPipeline(name=f"W5 Privacy Pipe {tag}", is_default=False, is_active=True, created_by=u_admin.id)
            db.add(pipe)
            await db.flush()
            tracked["pipelines"].append(pipe.id)
            st_open = CrmPipelineStage(pipeline_id=pipe.id, name="New", stage_order=1, stage_type="open", is_initial=True, is_active=True)
            st_qual = CrmPipelineStage(pipeline_id=pipe.id, name="Qualified", stage_order=2, stage_type="open", is_initial=False, is_active=True)
            db.add_all([st_open, st_qual])
            await db.flush()
            await db.commit()

        yield {
            "engine": engine,
            "SessionLocal": SessionLocal,
            "tag": tag,
            "tracked": tracked,
            "pipe": pipe,
            "st_open": st_open,
            "st_qual": st_qual,
            "comp_a": comp_a,
            "comp_b": comp_b,
            "u_admin": u_admin,
            "u_admin_denied": u_admin_denied,
            "u_mgr_a": u_mgr_a,
            "u_mgr_b": u_mgr_b,
            "u_sp_a1": u_sp_a1,
            "u_sp_b1": u_sp_b1,
            "u_sp_b2": u_sp_b2,
            "u_denied_mgr": u_denied_mgr,
            "hdr_admin": _auth_headers(u_admin, sids[u_admin.id]),
            "hdr_admin_denied": _auth_headers(u_admin_denied, sids[u_admin_denied.id]),
            "hdr_mgr_a": _auth_headers(u_mgr_a, sids[u_mgr_a.id]),
            "hdr_mgr_b": _auth_headers(u_mgr_b, sids[u_mgr_b.id]),
            "hdr_sp_a1": _auth_headers(u_sp_a1, sids[u_sp_a1.id]),
            "hdr_sp_b1": _auth_headers(u_sp_b1, sids[u_sp_b1.id]),
            "hdr_sp_b2": _auth_headers(u_sp_b2, sids[u_sp_b2.id]),
            "hdr_denied": _auth_headers(u_denied_mgr, sids[u_denied_mgr.id]),
        }
    finally:
        app.dependency_overrides.pop(get_db_session, None)
        async with SessionLocal() as db:
            # Collect any leads created under our test pipeline
            if tracked["pipelines"]:
                pipe_lids = list((await db.execute(select(CrmLead.id).where(CrmLead.pipeline_id.in_(tracked["pipelines"])))).scalars().all())
                all_lids = list(set(tracked["leads"] + pipe_lids))
                if all_lids:
                    extra_cids = list((await db.execute(select(CrmLead.company_id).where(CrmLead.id.in_(all_lids), CrmLead.company_id.is_not(None)))).scalars().all())
                    tracked["companies"].extend(extra_cids)
                    await db.execute(delete(CrmFollowUp).where(CrmFollowUp.lead_id.in_(all_lids)))
                    await db.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_(all_lids)))
                    await db.execute(delete(CrmStageHistory).where(CrmStageHistory.lead_id.in_(all_lids)))
                    await db.execute(delete(CrmAssignmentHistory).where(CrmAssignmentHistory.lead_id.in_(all_lids)))
                    await db.execute(delete(CrmLead).where(CrmLead.id.in_(all_lids)))
                pipe_bids = list((await db.execute(select(CrmImportBatch.id).where(CrmImportBatch.selected_pipeline_id.in_(tracked["pipelines"])))).scalars().all())
                all_bids = list(set(tracked["batches"] + pipe_bids))
                if all_bids:
                    await db.execute(delete(CrmImportBatch).where(CrmImportBatch.id.in_(all_bids)))
                await db.execute(delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id.in_(tracked["pipelines"])))
                await db.execute(delete(CrmPipeline).where(CrmPipeline.id.in_(tracked["pipelines"])))
            if tracked["companies"]:
                await db.execute(delete(Company).where(Company.id.in_(list(set(tracked["companies"])))))
            if tracked["users"]:
                await db.execute(delete(AuthSession).where(AuthSession.user_id.in_(tracked["users"])))
                await db.execute(delete(CrmSalespersonConfig).where(CrmSalespersonConfig.user_id.in_(tracked["users"])))
                await db.execute(delete(DepartmentLeadershipAssignment).where(DepartmentLeadershipAssignment.employee_id.in_(tracked["users"])))
                await db.execute(delete(UserPermission).where(UserPermission.user_id.in_(tracked["users"])))
                await db.execute(delete(UserRole).where(UserRole.user_id.in_(tracked["users"])))
                await db.execute(delete(User).where(User.id.in_(tracked["users"])))
            if tracked["roles"]:
                await db.execute(delete(RolePermission).where(RolePermission.role_id.in_(tracked["roles"])))
                await db.execute(delete(Role).where(Role.id.in_(tracked["roles"])))
            await db.commit()
        await engine.dispose()


async def _global_ah_for_lead(client: AsyncClient, headers: dict[str, str], lead_id: str) -> list[dict]:
    r = await client.get("/api/v1/crm/assignment-history?page_size=100", headers=headers)
    assert r.status_code == 200, r.text
    return [it for it in r.json()["data"]["items"] if it["lead_id"] == lead_id]


# =============================================================================
# SCENARIOS 1–16 & 25: FULL CROSS-DEPT LIFECYCLE (A -> B -> UNASSIGNED)
# =============================================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_scenarios_01_to_16_and_25_cross_dept_lifecycle_and_privacy(wave5_env):
    env = wave5_env
    tag = env["tag"]
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        # Scenario 1: Dept A Manager creates & assigns lead to Salesperson A1
        r_create = await client.post(
            "/api/v1/crm/leads",
            json={
                "contact_name": f"W5 Lifecycle Prospect {tag}",
                "phone": f"+9197100{tag}",
                "company_id": str(env["comp_a"].id),
                "pipeline_id": str(env["pipe"].id),
                "assigned_to": str(env["u_sp_a1"].id),
            },
            headers=env["hdr_mgr_a"],
        )
        assert r_create.status_code == 201, r_create.text
        lead_id = r_create.json()["data"]["id"]
        lead_code = r_create.json()["data"]["lead_code"]

        # Scenario 2: Dept A Manager & Salesperson A1 have expected access; Dept B denied
        for h in (env["hdr_mgr_a"], env["hdr_sp_a1"], env["hdr_admin"]):
            assert (await client.get(f"/api/v1/crm/leads/{lead_id}", headers=h)).status_code == 200
            assert (await client.get(f"/api/v1/crm/leads/{lead_id}/timeline", headers=h)).status_code == 200
            assert (await client.get(f"/api/v1/crm/assignment-history?lead_id={lead_id}", headers=h)).status_code == 200
            assert len(await _global_ah_for_lead(client, h, lead_id)) == 1
        for h in (env["hdr_mgr_b"], env["hdr_sp_b1"]):
            assert (await client.get(f"/api/v1/crm/leads/{lead_id}", headers=h)).status_code == 403
            assert (await client.get(f"/api/v1/crm/assignment-history?lead_id={lead_id}", headers=h)).status_code == 403
            assert len(await _global_ah_for_lead(client, h, lead_id)) == 0

        # Scenario 3: Admin reassigns lead from Dept A (sp_a1) -> Dept B (sp_b1)
        r_re = await client.post(
            f"/api/v1/crm/leads/{lead_id}/reassign",
            json={"new_salesperson_id": str(env["u_sp_b1"].id), "reason": "Transferred to Dept B specialist"},
            headers=env["hdr_admin"],
        )
        assert r_re.status_code == 200, r_re.text

        # Scenario 4 & BLK-02: Dept A Manager and former Salesperson A1 immediately lose ALL access (incl. global AH!)
        for h in (env["hdr_mgr_a"], env["hdr_sp_a1"]):
            assert (await client.get(f"/api/v1/crm/leads/{lead_id}", headers=h)).status_code == 403
            assert (await client.patch(f"/api/v1/crm/leads/{lead_id}", json={"notes": "Illegal"}, headers=h)).status_code == 403
            assert (await client.get(f"/api/v1/crm/leads/{lead_id}/timeline", headers=h)).status_code == 403
            assert (await client.get(f"/api/v1/crm/assignment-history?lead_id={lead_id}", headers=h)).status_code == 403
            leaked_rows = await _global_ah_for_lead(client, h, lead_id)
            assert leaked_rows == [], f"BLK-02 REPRO: Former dept/rep leaked global AH rows while owned by Dept B: {leaked_rows}"

        # Scenario 5 & 6: Dept B Manager & Salesperson B1 gain access and log confidential Dept B activity
        for h in (env["hdr_mgr_b"], env["hdr_sp_b1"]):
            assert (await client.get(f"/api/v1/crm/leads/{lead_id}", headers=h)).status_code == 200
            assert (await client.get(f"/api/v1/crm/assignment-history?lead_id={lead_id}", headers=h)).status_code == 200
            assert len(await _global_ah_for_lead(client, h, lead_id)) == 2
        r_conf_act = await client.post(
            f"/api/v1/crm/leads/{lead_id}/activities",
            json={
                "activity_type": "note",
                "subject": "CONFIDENTIAL DEPT B PRICING MARGIN",
                "description": "Internal Dept B floor margin 13.75%",
            },
            headers=env["hdr_mgr_b"],
        )
        assert r_conf_act.status_code == 201, r_conf_act.text

        # Also add a follow-up owned by sp_b1 to verify follow-up list scoping too
        r_fu_b = await client.post(
            f"/api/v1/crm/leads/{lead_id}/follow-ups",
            json={"follow_up_type": "call", "due_at": (_utcnow() + timedelta(days=1)).isoformat(), "notes": "Dept B private callback"},
            headers=env["hdr_sp_b1"],
        )
        assert r_fu_b.status_code == 201

        # Scenario 7: Lead becomes UNASSIGNED after Dept B ownership
        async with env["SessionLocal"]() as db:
            ld = await db.get(CrmLead, uuid.UUID(lead_id))
            ld.assigned_to = None
            cf = dict(ld.custom_fields or {})
            cf["assignment_status"] = "unassigned"
            cf["unassigned_reason"] = "dept_b_reallocation"
            ld.custom_fields = cf
            db.add(
                CrmAssignmentHistory(
                    lead_id=ld.id,
                    previous_owner_id=env["u_sp_b1"].id,
                    new_owner_id=None,
                    assignment_method="manual_unassign",
                    assigned_by=env["u_admin"].id,
                    reason="Unassigned from Dept B rep for Dept B team redistribution",
                    created_at=_utcnow() + timedelta(seconds=2),
                )
            )
            await db.commit()

        # Scenario 8 & 14: Dept B Manager RETAINS authorized access across ALL endpoints + unassigned queue + AH
        assert (await client.get(f"/api/v1/crm/leads/{lead_id}", headers=env["hdr_mgr_b"])).status_code == 200
        assert (await client.patch(f"/api/v1/crm/leads/{lead_id}", json={"priority": "high"}, headers=env["hdr_mgr_b"])).status_code == 200
        r_tl_b = await client.get(f"/api/v1/crm/leads/{lead_id}/timeline", headers=env["hdr_mgr_b"])
        assert r_tl_b.status_code == 200 and "CONFIDENTIAL DEPT B PRICING MARGIN" in r_tl_b.text
        r_unass_b = await client.get(f"/api/v1/crm/leads?pipeline_id={env['pipe'].id}&unassigned_only=true", headers=env["hdr_mgr_b"])
        assert r_unass_b.status_code == 200 and lead_id in {it["id"] for it in r_unass_b.json()["data"]["items"]}
        r_ah_b_lead = await client.get(f"/api/v1/crm/assignment-history?lead_id={lead_id}", headers=env["hdr_mgr_b"])
        assert r_ah_b_lead.status_code == 200 and r_ah_b_lead.json()["data"]["total"] == 3
        ah_b_global = await _global_ah_for_lead(client, env["hdr_mgr_b"], lead_id)
        assert len(ah_b_global) == 3

        # Scenario 9, 10, 11, 12 & 25 (BLK-01 & BLK-02): Dept A Manager remains EXPLICITLY DENIED everywhere!
        assert (await client.get(f"/api/v1/crm/leads/{lead_id}", headers=env["hdr_mgr_a"])).status_code == 403, (
            "BLK-01 REPRO: Dept A Manager regained lead detail access after Dept B unassignment!"
        )
        assert (await client.patch(f"/api/v1/crm/leads/{lead_id}", json={"notes": "Hijack"}, headers=env["hdr_mgr_a"])).status_code == 403
        assert (await client.post(f"/api/v1/crm/leads/{lead_id}/reassign", json={"new_salesperson_id": str(env["u_sp_a1"].id), "reason": "Hijack back to Dept A"}, headers=env["hdr_mgr_a"])).status_code == 403
        assert (await client.post(f"/api/v1/crm/leads/{lead_id}/stage", json={"stage_id": str(env["st_qual"].id)}, headers=env["hdr_mgr_a"])).status_code == 403
        r_tl_a = await client.get(f"/api/v1/crm/leads/{lead_id}/timeline", headers=env["hdr_mgr_a"])
        assert r_tl_a.status_code == 403 and "CONFIDENTIAL DEPT B PRICING MARGIN" not in r_tl_a.text
        assert (await client.get(f"/api/v1/crm/leads/{lead_id}/activities", headers=env["hdr_mgr_a"])).status_code == 403
        assert (await client.get(f"/api/v1/crm/leads/{lead_id}/follow-ups", headers=env["hdr_mgr_a"])).status_code == 403
        assert (await client.get(f"/api/v1/crm/leads/{lead_id}/quotations", headers=env["hdr_mgr_a"])).status_code == 403
        assert (await client.get(f"/api/v1/crm/assignment-history?lead_id={lead_id}", headers=env["hdr_mgr_a"])).status_code == 403

        # Unassigned queue, global leads list, global follow-ups, and global AH exclude Lead L for Dept A!
        r_unass_a = await client.get(f"/api/v1/crm/leads?pipeline_id={env['pipe'].id}&unassigned_only=true", headers=env["hdr_mgr_a"])
        assert r_unass_a.status_code == 200 and lead_id not in {it["id"] for it in r_unass_a.json()["data"]["items"]}
        r_list_a = await client.get(f"/api/v1/crm/leads?search={lead_code}", headers=env["hdr_mgr_a"])
        assert r_list_a.status_code == 200 and lead_id not in {it["id"] for it in r_list_a.json()["data"]["items"]}
        r_fu_a = await client.get("/api/v1/crm/follow-ups?status=all&page_size=100", headers=env["hdr_mgr_a"])
        assert r_fu_a.status_code == 200 and lead_id not in {it["lead_id"] for it in r_fu_a.json()["data"]["items"]}
        assert await _global_ah_for_lead(client, env["hdr_mgr_a"], lead_id) == []

        # Scenario 13: Neither former Dept A rep (sp_a1) nor former Dept B rep (sp_b1) can access after unassignment
        for h_sp in (env["hdr_sp_a1"], env["hdr_sp_b1"]):
            assert (await client.get(f"/api/v1/crm/leads/{lead_id}", headers=h_sp)).status_code == 403
            assert (await client.get(f"/api/v1/crm/leads/{lead_id}/timeline", headers=h_sp)).status_code == 403
            assert (await client.get(f"/api/v1/crm/assignment-history?lead_id={lead_id}", headers=h_sp)).status_code == 403
            assert await _global_ah_for_lead(client, h_sp, lead_id) == []

        # Scenario 15: Admin/SuperAdmin retains full authorized access
        assert (await client.get(f"/api/v1/crm/leads/{lead_id}", headers=env["hdr_admin"])).status_code == 200
        assert (await client.get(f"/api/v1/crm/leads/{lead_id}/timeline", headers=env["hdr_admin"])).status_code == 200
        assert (await client.get(f"/api/v1/crm/assignment-history?lead_id={lead_id}", headers=env["hdr_admin"])).json()["data"]["total"] == 3
        assert len(await _global_ah_for_lead(client, env["hdr_admin"], lead_id)) == 3

        # Scenario 16: Explicitly denied manager AND explicitly denied SuperAdmin remain 403 across all endpoints
        for h_den in (env["hdr_denied"], env["hdr_admin_denied"]):
            assert (await client.get(f"/api/v1/crm/leads/{lead_id}", headers=h_den)).status_code == 403
            assert (await client.get(f"/api/v1/crm/leads/{lead_id}/timeline", headers=h_den)).status_code == 403
            assert (await client.get(f"/api/v1/crm/assignment-history?lead_id={lead_id}", headers=h_den)).status_code == 403
            assert (await client.get("/api/v1/crm/assignment-history", headers=h_den)).status_code == 403
            assert (await client.get(f"/api/v1/crm/leads?pipeline_id={env['pipe'].id}&unassigned_only=true", headers=h_den)).status_code == 403

        # Dept B Manager can legitimately reassign Dept B's unassigned lead to another Dept B rep (sp_b2)
        r_re_b2 = await client.post(
            f"/api/v1/crm/leads/{lead_id}/reassign",
            json={"new_salesperson_id": str(env["u_sp_b2"].id), "reason": "Reassigned within Dept B team"},
            headers=env["hdr_mgr_b"],
        )
        assert r_re_b2.status_code == 200 and r_re_b2.json()["data"]["assigned_to"] == str(env["u_sp_b2"].id)


# =============================================================================
# SCENARIO 17 (BLK-03): UNASSIGNED LEAD WITH created_by IS NULL
# =============================================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_scenario_17_created_by_null_unassigned_lead_admin_only(wave5_env):
    env = wave5_env
    tag = env["tag"]
    phone_null = f"+9197200{tag}"
    async with env["SessionLocal"]() as db:
        ld_null = CrmLead(
            lead_code=f"W5-NULLC-{tag}",
            name="System Unattributed Lead",
            original_phone=phone_null,
            normalized_phone=phone_null,
            company_id=env["comp_b"].id,
            company_name=env["comp_b"].company_name,
            pipeline_id=env["pipe"].id,
            stage_id=env["st_open"].id,
            created_by=None,
            assigned_to=None,
            status="new",
        )
        db.add(ld_null)
        await db.flush()
        lid = str(ld_null.id)
        env["tracked"]["leads"].append(ld_null.id)
        await db.commit()

    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        # Both Dept A & Dept B managers AND salespersons MUST be denied (403) and excluded from queues!
        for h in (env["hdr_mgr_a"], env["hdr_mgr_b"], env["hdr_sp_a1"], env["hdr_sp_b1"]):
            assert (await client.get(f"/api/v1/crm/leads/{lid}", headers=h)).status_code == 403, (
                "BLK-03 REPRO: created_by IS NULL unassigned lead exposed to non-admin!"
            )
            assert (await client.get(f"/api/v1/crm/leads/{lid}/timeline", headers=h)).status_code == 403
            assert (await client.get(f"/api/v1/crm/assignment-history?lead_id={lid}", headers=h)).status_code == 403
            r_list = await client.get(f"/api/v1/crm/leads?pipeline_id={env['pipe'].id}", headers=h)
            assert r_list.status_code == 200 and lid not in {it["id"] for it in r_list.json()["data"]["items"]}
        for h_mgr in (env["hdr_mgr_a"], env["hdr_mgr_b"]):
            r_uq = await client.get(f"/api/v1/crm/leads?pipeline_id={env['pipe'].id}&unassigned_only=true", headers=h_mgr)
            assert r_uq.status_code == 200 and lid not in {it["id"] for it in r_uq.json()["data"]["items"]}

        # CSV duplicate preview for Manager A MUST mask matched_lead_code and company_id!
        csv_dup = f"Name,Number,Campaign\nProbe Null,{phone_null},ProbeCamp\n".encode("utf-8")
        r_prev = await client.post(
            "/api/v1/crm/import/preview",
            data={"pipeline_id": str(env["pipe"].id)},
            files={"file": ("null_dup.csv", csv_dup, "text/csv")},
            headers=env["hdr_mgr_a"],
        )
        assert r_prev.status_code == 200
        row0 = r_prev.json()["data"]["rows"][0]
        assert row0["status"] == "CRM_DUPLICATE"
        assert row0["matched_lead_code"] is None, f"BLK-03 REPRO: CSV preview leaked created_by=NULL lead_code: {row0}"
        assert row0["company_id"] is None

        # Duplicate manual lead creation by Manager A MUST NOT leak lead_code in 409 message!
        r_dup_m = await client.post(
            "/api/v1/crm/leads",
            json={"contact_name": "Probe Manual", "phone": phone_null, "pipeline_id": str(env["pipe"].id)},
            headers=env["hdr_mgr_a"],
        )
        assert r_dup_m.status_code == 409 and f"W5-NULLC-{tag}" not in r_dup_m.text

        # Admin/SuperAdmin retains full access
        assert (await client.get(f"/api/v1/crm/leads/{lid}", headers=env["hdr_admin"])).status_code == 200
        r_uq_adm = await client.get(f"/api/v1/crm/leads?pipeline_id={env['pipe'].id}&unassigned_only=true", headers=env["hdr_admin"])
        assert lid in {it["id"] for it in r_uq_adm.json()["data"]["items"]}


# =============================================================================
# SCENARIO 18: NEVER-ASSIGNED LEAD CREATED BY DEPT A
# =============================================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_scenario_18_never_assigned_lead_preserves_creator_team_scope(wave5_env):
    env = wave5_env
    tag = env["tag"]
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        r_na = await client.post(
            "/api/v1/crm/leads",
            json={
                "contact_name": f"Never Assigned DeptA {tag}",
                "phone": f"+9197300{tag}",
                "pipeline_id": str(env["pipe"].id),
            },
            headers=env["hdr_mgr_a"],
        )
        assert r_na.status_code == 201, r_na.text
        lid = r_na.json()["data"]["id"]
        assert r_na.json()["data"]["assigned_to"] is None

        # Dept A Manager & Admin: allowed; Dept B Manager & Salesperson B1: 403 & excluded
        assert (await client.get(f"/api/v1/crm/leads/{lid}", headers=env["hdr_mgr_a"])).status_code == 200
        r_uq_a = await client.get(f"/api/v1/crm/leads?pipeline_id={env['pipe'].id}&unassigned_only=true", headers=env["hdr_mgr_a"])
        assert lid in {it["id"] for it in r_uq_a.json()["data"]["items"]}
        assert (await client.get(f"/api/v1/crm/leads/{lid}", headers=env["hdr_admin"])).status_code == 200

        assert (await client.get(f"/api/v1/crm/leads/{lid}", headers=env["hdr_mgr_b"])).status_code == 403
        assert (await client.get(f"/api/v1/crm/leads/{lid}/timeline", headers=env["hdr_mgr_b"])).status_code == 403
        assert (await client.get(f"/api/v1/crm/assignment-history?lead_id={lid}", headers=env["hdr_mgr_b"])).status_code == 403
        r_uq_b = await client.get(f"/api/v1/crm/leads?pipeline_id={env['pipe'].id}&unassigned_only=true", headers=env["hdr_mgr_b"])
        assert lid not in {it["id"] for it in r_uq_b.json()["data"]["items"]}


# =============================================================================
# SCENARIOS 19, 20, 21: MULTI-HOP (A->B->A->B->UNASSIGNED), ADMIN UNASSIGN, MISSING ACTORS
# =============================================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_scenarios_19_20_21_multihop_admin_unassign_and_missing_actor_refs(wave5_env):
    env = wave5_env
    tag = env["tag"]
    now = _utcnow()
    async with env["SessionLocal"]() as db:
        # Scenario 19: A -> B -> A -> B -> unassigned
        ld19 = CrmLead(
            lead_code=f"W5-S19-{tag}", name="MultiHop A-B-A-B Unassigned",
            original_phone=f"+9197401{tag}", normalized_phone=f"+9197401{tag}",
            pipeline_id=env["pipe"].id, stage_id=env["st_open"].id,
            created_by=env["u_mgr_a"].id, assigned_to=None, status="new",
        )
        # Scenario 20: Assigned to B, then unassigned by Admin WITHOUT explicit unassign row (latest row is new_owner=sp_b1)
        ld20 = CrmLead(
            lead_code=f"W5-S20-{tag}", name="Admin Unassign Latest Owner B",
            original_phone=f"+9197402{tag}", normalized_phone=f"+9197402{tag}",
            pipeline_id=env["pipe"].id, stage_id=env["st_open"].id,
            created_by=env["u_mgr_a"].id, assigned_to=None, status="new",
        )
        # Scenario 21: Historical assignment records with missing actor references (assigned_by=None)
        ld21 = CrmLead(
            lead_code=f"W5-S21-{tag}", name="Missing AssignedBy Actor Lead",
            original_phone=f"+9197403{tag}", normalized_phone=f"+9197403{tag}",
            pipeline_id=env["pipe"].id, stage_id=env["st_open"].id,
            created_by=env["u_mgr_a"].id, assigned_to=None, status="new",
        )
        db.add_all([ld19, ld20, ld21])
        await db.flush()
        env["tracked"]["leads"].extend([ld19.id, ld20.id, ld21.id])

        db.add_all([
            # S19: A -> B -> A -> B -> None
            CrmAssignmentHistory(lead_id=ld19.id, previous_owner_id=None, new_owner_id=env["u_sp_a1"].id, assignment_method="manual", assigned_by=env["u_mgr_a"].id, reason="Hop 1 A", created_at=now - timedelta(minutes=5)),
            CrmAssignmentHistory(lead_id=ld19.id, previous_owner_id=env["u_sp_a1"].id, new_owner_id=env["u_sp_b1"].id, assignment_method="manual", assigned_by=env["u_admin"].id, reason="Hop 2 B", created_at=now - timedelta(minutes=4)),
            CrmAssignmentHistory(lead_id=ld19.id, previous_owner_id=env["u_sp_b1"].id, new_owner_id=env["u_sp_a1"].id, assignment_method="manual", assigned_by=env["u_admin"].id, reason="Hop 3 A", created_at=now - timedelta(minutes=3)),
            CrmAssignmentHistory(lead_id=ld19.id, previous_owner_id=env["u_sp_a1"].id, new_owner_id=env["u_sp_b1"].id, assignment_method="manual", assigned_by=env["u_admin"].id, reason="Hop 4 B", created_at=now - timedelta(minutes=2)),
            CrmAssignmentHistory(lead_id=ld19.id, previous_owner_id=env["u_sp_b1"].id, new_owner_id=None, assignment_method="manual_unassign", assigned_by=env["u_admin"].id, reason="Hop 5 Unassigned from B", created_at=now - timedelta(minutes=1)),
            # S20: A -> B, then assigned_to cleared directly by Admin
            CrmAssignmentHistory(lead_id=ld20.id, previous_owner_id=None, new_owner_id=env["u_sp_a1"].id, assignment_method="manual", assigned_by=env["u_mgr_a"].id, reason="Init A", created_at=now - timedelta(minutes=3)),
            CrmAssignmentHistory(lead_id=ld20.id, previous_owner_id=env["u_sp_a1"].id, new_owner_id=env["u_sp_b1"].id, assignment_method="manual", assigned_by=env["u_admin"].id, reason="Moved to B", created_at=now - timedelta(minutes=2)),
            # S21: Missing assigned_by=None on both assignment & unassignment
            CrmAssignmentHistory(lead_id=ld21.id, previous_owner_id=None, new_owner_id=env["u_sp_b1"].id, assignment_method="import", assigned_by=None, reason="Legacy import to B", created_at=now - timedelta(minutes=2)),
            CrmAssignmentHistory(lead_id=ld21.id, previous_owner_id=env["u_sp_b1"].id, new_owner_id=None, assignment_method="manual_unassign", assigned_by=None, reason="Legacy unassign from B", created_at=now - timedelta(minutes=1)),
        ])
        await db.commit()
        ids = [str(ld19.id), str(ld20.id), str(ld21.id)]

    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        for lid in ids:
            # Dept B Manager: authorized (200 across detail, timeline, per-lead AH, global AH, unassigned queue)
            assert (await client.get(f"/api/v1/crm/leads/{lid}", headers=env["hdr_mgr_b"])).status_code == 200
            assert (await client.get(f"/api/v1/crm/leads/{lid}/timeline", headers=env["hdr_mgr_b"])).status_code == 200
            assert (await client.get(f"/api/v1/crm/assignment-history?lead_id={lid}", headers=env["hdr_mgr_b"])).status_code == 200
            assert len(await _global_ah_for_lead(client, env["hdr_mgr_b"], lid)) >= 2

            # Dept A Manager: DENIED (403 across direct endpoints; 0 rows in global AH & unassigned queue)
            assert (await client.get(f"/api/v1/crm/leads/{lid}", headers=env["hdr_mgr_a"])).status_code == 403
            assert (await client.get(f"/api/v1/crm/leads/{lid}/timeline", headers=env["hdr_mgr_a"])).status_code == 403
            assert (await client.get(f"/api/v1/crm/assignment-history?lead_id={lid}", headers=env["hdr_mgr_a"])).status_code == 403
            assert await _global_ah_for_lead(client, env["hdr_mgr_a"], lid) == []

            # Admin: allowed
            assert (await client.get(f"/api/v1/crm/leads/{lid}", headers=env["hdr_admin"])).status_code == 200


# =============================================================================
# SCENARIO 22: AMBIGUOUS OR INCOMPLETE OWNERSHIP HISTORY -> FAIL CLOSED
# =============================================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_scenario_22_ambiguous_or_incomplete_history_fails_closed(wave5_env):
    env = wave5_env
    tag = env["tag"]
    tied_ts = _utcnow()
    async with env["SessionLocal"]() as db:
        # 22a: Tied timestamps at MAX(created_at) with conflicting owners (sp_a1 vs sp_b1)
        ld_tie = CrmLead(
            lead_code=f"W5-TIE-{tag}", name="Ambiguous Tied Timestamp Lead",
            original_phone=f"+9197501{tag}", normalized_phone=f"+9197501{tag}",
            pipeline_id=env["pipe"].id, stage_id=env["st_open"].id,
            created_by=env["u_mgr_a"].id, assigned_to=None, status="new",
        )
        # 22b: Incomplete latest history row (previous_owner_id=None, new_owner_id=None) after prior A1 assignment
        ld_inc = CrmLead(
            lead_code=f"W5-INC-{tag}", name="Incomplete Latest History Lead",
            original_phone=f"+9197502{tag}", normalized_phone=f"+9197502{tag}",
            pipeline_id=env["pipe"].id, stage_id=env["st_open"].id,
            created_by=env["u_mgr_a"].id, assigned_to=None, status="new",
        )
        db.add_all([ld_tie, ld_inc])
        await db.flush()
        env["tracked"]["leads"].extend([ld_tie.id, ld_inc.id])

        db.add_all([
            CrmAssignmentHistory(lead_id=ld_tie.id, previous_owner_id=None, new_owner_id=env["u_sp_a1"].id, assignment_method="manual", assigned_by=env["u_admin"].id, reason="Tie A", created_at=tied_ts),
            CrmAssignmentHistory(lead_id=ld_tie.id, previous_owner_id=None, new_owner_id=env["u_sp_b1"].id, assignment_method="manual", assigned_by=env["u_admin"].id, reason="Tie B", created_at=tied_ts),
            CrmAssignmentHistory(lead_id=ld_inc.id, previous_owner_id=None, new_owner_id=env["u_sp_a1"].id, assignment_method="manual", assigned_by=env["u_mgr_a"].id, reason="Old A", created_at=tied_ts - timedelta(minutes=2)),
            CrmAssignmentHistory(lead_id=ld_inc.id, previous_owner_id=None, new_owner_id=None, assignment_method="manual_unassign", assigned_by=None, reason="Corrupted/deleted owner record", created_at=tied_ts),
        ])
        await db.commit()
        tie_id, inc_id = str(ld_tie.id), str(ld_inc.id)

    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        for lid in (tie_id, inc_id):
            # BOTH Dept A Manager AND Dept B Manager MUST FAIL CLOSED (403 + 0 global AH + excluded from unassigned queue)!
            for h_mgr in (env["hdr_mgr_a"], env["hdr_mgr_b"]):
                assert (await client.get(f"/api/v1/crm/leads/{lid}", headers=h_mgr)).status_code == 403, (
                    f"Ambiguous/incomplete history lead {lid} did NOT fail closed for manager!"
                )
                assert (await client.get(f"/api/v1/crm/leads/{lid}/timeline", headers=h_mgr)).status_code == 403
                assert (await client.get(f"/api/v1/crm/assignment-history?lead_id={lid}", headers=h_mgr)).status_code == 403
                assert await _global_ah_for_lead(client, h_mgr, lid) == []
                r_uq = await client.get(f"/api/v1/crm/leads?pipeline_id={env['pipe'].id}&unassigned_only=true", headers=h_mgr)
                assert lid not in {it["id"] for it in r_uq.json()["data"]["items"]}

            # Admin retains recovery access (200)
            assert (await client.get(f"/api/v1/crm/leads/{lid}", headers=env["hdr_admin"])).status_code == 200
            assert len(await _global_ah_for_lead(client, env["hdr_admin"], lid)) == 2


# =============================================================================
# SCENARIOS 23 & 24: SOFT-DELETED LEAD HISTORY & PAGINATION/FILTER BYPASS CHECKS
# =============================================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_scenarios_23_24_soft_deleted_history_and_filter_bypass_blocked(wave5_env):
    env = wave5_env
    tag = env["tag"]
    now = _utcnow()
    async with env["SessionLocal"]() as db:
        batch_b = CrmImportBatch(
            batch_name=f"W5 DeptB Batch {tag}",
            import_source="csv",
            selected_pipeline_id=env["pipe"].id,
            initiated_by=env["u_mgr_b"].id,
            status="completed",
            total_count=1,
            success_count=1,
        )
        db.add(batch_b)
        await db.flush()
        env["tracked"]["batches"].append(batch_b.id)

        ld_b_batch = CrmLead(
            lead_code=f"W5-BAT-{tag}", name="Dept B Batch Lead",
            original_phone=f"+9197601{tag}", normalized_phone=f"+9197601{tag}",
            pipeline_id=env["pipe"].id, stage_id=env["st_open"].id,
            created_by=env["u_mgr_a"].id, assigned_to=env["u_sp_b1"].id, status="new",
        )
        ld_del = CrmLead(
            lead_code=f"W5-DEL-{tag}", name="Soft Deleted Lead",
            original_phone=f"+9197602{tag}", normalized_phone=f"+9197602{tag}",
            pipeline_id=env["pipe"].id, stage_id=env["st_open"].id,
            created_by=env["u_mgr_b"].id, assigned_to=env["u_sp_b1"].id, status="new",
            deleted_at=now,
        )
        db.add_all([ld_b_batch, ld_del])
        await db.flush()
        env["tracked"]["leads"].extend([ld_b_batch.id, ld_del.id])

        db.add_all([
            CrmAssignmentHistory(lead_id=ld_b_batch.id, previous_owner_id=env["u_sp_a1"].id, new_owner_id=env["u_sp_b1"].id, assignment_method="round_robin", assigned_by=env["u_admin"].id, batch_id=batch_b.id, reason="Batch B assign", created_at=now),
            CrmAssignmentHistory(lead_id=ld_del.id, previous_owner_id=None, new_owner_id=env["u_sp_b1"].id, assignment_method="manual", assigned_by=env["u_mgr_b"].id, reason="Deleted lead history", created_at=now),
        ])
        await db.commit()
        batch_b_id, lid_b_batch, lid_del = str(batch_b.id), str(ld_b_batch.id), str(ld_del.id)

    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        # Scenario 23: Soft-deleted lead history returns 404 on ?lead_id= and 0 rows globally (even for Admin!)
        for h in (env["hdr_mgr_b"], env["hdr_mgr_a"], env["hdr_admin"]):
            assert (await client.get(f"/api/v1/crm/assignment-history?lead_id={lid_del}", headers=h)).status_code == 404
            assert await _global_ah_for_lead(client, h, lid_del) == []

        # Scenario 24: Pagination & filters cannot bypass ownership checks!
        # Out-of-scope salesperson_id filter on /assignment-history -> EXPLICIT 403 Forbidden (not silent 200!)
        assert (await client.get(f"/api/v1/crm/assignment-history?salesperson_id={env['u_sp_b1'].id}", headers=env["hdr_mgr_a"])).status_code == 403
        assert (await client.get(f"/api/v1/crm/assignment-history?salesperson_id={env['u_sp_b1'].id}", headers=env["hdr_sp_a1"])).status_code == 403
        # Out-of-scope assigned_to filter on /crm/leads -> EXPLICIT 403 Forbidden!
        assert (await client.get(f"/api/v1/crm/leads?assigned_to={env['u_sp_b1'].id}", headers=env["hdr_mgr_a"])).status_code == 403
        assert (await client.get(f"/api/v1/crm/leads?assigned_to={env['u_sp_b1'].id}", headers=env["hdr_sp_a1"])).status_code == 403
        # Salesperson unassigned_only=true -> EXPLICIT 403 Forbidden!
        assert (await client.get("/api/v1/crm/leads?unassigned_only=true", headers=env["hdr_sp_a1"])).status_code == 403
        # Filtering global AH by batch_id & walking pagination pages cannot leak Dept B lead to Dept A Manager
        r_bat_a = await client.get(f"/api/v1/crm/assignment-history?batch_id={batch_b_id}&page=1&page_size=100", headers=env["hdr_mgr_a"])
        assert r_bat_a.status_code == 200 and lid_b_batch not in {it["lead_id"] for it in r_bat_a.json()["data"]["items"]}
        # Filtering by own rep (sp_a1, who was previous_owner_id on ld_b_batch) cannot leak Dept B lead!
        r_prev_a = await client.get(f"/api/v1/crm/assignment-history?salesperson_id={env['u_sp_a1'].id}&page=1&page_size=100", headers=env["hdr_mgr_a"])
        assert r_prev_a.status_code == 200 and lid_b_batch not in {it["lead_id"] for it in r_prev_a.json()["data"]["items"]}
        # Dept B Manager CAN query batch_id and see ld_b_batch
        r_bat_b = await client.get(f"/api/v1/crm/assignment-history?batch_id={batch_b_id}&page=1&page_size=100", headers=env["hdr_mgr_b"])
        assert r_bat_b.status_code == 200 and lid_b_batch in {it["lead_id"] for it in r_bat_b.json()["data"]["items"]}
