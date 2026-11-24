"""
INHYMA ERP — LEAD MANAGEMENT PHASE 2 / WAVE 1 REGRESSION SUITE (PostgreSQL 18)

Reproduces and verifies the 5 authorized P1 Security, Privacy & Data-Integrity defects:
- LM-DEF-001: Soft-deleted CRM leads excluded from list, detail, counts, quotations & reuse intact
- LM-DEF-002: Pipeline & stage deactivation guards block active leads (status not in won/lost)
- LM-DEF-003: CSV confirm_import masks out-of-scope CRM_DUPLICATE lead_code & company metadata
- LM-DEF-004: POST /crm/leads/backfill-companies enforced Admin-only + domain AuditLog recorded
- LM-DEF-005: Former salesperson creator loses access across all endpoints after reassignment
- Cross-cutting RBAC/IDOR (9 personas) & CRM Follow-Up <-> Enterprise Tasks bidirectional sync

Runs against isolated local PostgreSQL test DB (`inhyma_test_db`) and cleans up 100% of
synthetic test data in `finally`. Zero migrations executed.
"""

from __future__ import annotations

import io
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://postgres:root@127.0.0.1:5432/inhyma_test_db",
)
os.environ["DATABASE_URL"] = TEST_DB_URL

from app.audit.models import AuditLog
from app.auth.models import Session as AuthSession
from app.auth.security import create_access_token, hash_password
from app.companies.models import Company
from app.core.constants import RecordStatus
from app.crm.models import (
    CrmActivity,
    CrmAssignmentHistory,
    CrmFollowUp,
    CrmImportBatch,
    CrmLead,
    CrmLeadProduct,
    CrmPipeline,
    CrmPipelineStage,
    CrmQuotationItem,
    CrmQuotationVersion,
    CrmSalesQuotation,
    CrmSalespersonConfig,
    CrmStageHistory,
)
from app.database.session import get_db_session
from app.main import app
from app.masters.product_categories.models import ProductCategory
from app.masters.products.models import Product
from app.masters.uom.models import UnitOfMeasurement
from app.notifications.models import Notification
from app.org_structure.models import DepartmentLeadershipAssignment, LeadershipType, OrgRecordStatus
from app.rbac.models import Permission, Role, RoleAssignmentStatus, RolePermission, UserPermission, UserRole
from app.tasks.models import Task, TaskAssignee, TaskComment, TaskStatus
from app.users.models import User, UserStatus


def _auth_headers(user_id: uuid.UUID) -> dict[str, str]:
    tok = create_access_token(user_id)
    return {"Authorization": f"Bearer {tok.token}"}


@pytest_asyncio.fixture
async def wave1_env():
    """Provision isolated synthetic personas, roles, pipeline, product & companies, then clean up 100%."""
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

    tag = uuid.uuid4().hex[:6]
    # Unique phone base (6 digits) to avoid colliding with any pre-existing records
    p_base = str(int(tag, 16) % 899999 + 100000)

    tracked: dict[str, list[uuid.UUID]] = {
        "users": [],
        "roles": [],
        "perms": [],
        "companies": [],
        "products": [],
        "categories": [],
        "uoms": [],
        "pipelines": [],
        "leads": [],
        "batches": [],
        "tasks": [],
        "quotations": [],
    }

    pw_hash = hash_password("Wave1Test@2026!")

    try:
        async with SessionLocal() as db:
            perm_codes = [
                "crm.leads.view",
                "crm.leads.manage",
                "crm.leads.import",
                "crm.pipelines.view",
                "crm.pipelines.manage",
                "crm.distribution.view",
                "crm.distribution.manage",
                "task.view",
                "task.create",
                "task.update",
                "task.delete",
            ]
            pmap: dict[str, Permission] = {}
            for code in perm_codes:
                p = (await db.execute(select(Permission).where(Permission.code == code))).scalar_one_or_none()
                if not p:
                    p = Permission(code=code, module=code.split(".")[0], action=code.split(".")[-1], description=code)
                    db.add(p)
                    await db.flush()
                    tracked["perms"].append(p.id)
                pmap[code] = p

            sa_role = (await db.execute(select(Role).where(Role.name == "super_admin", Role.deleted_at.is_(None)))).scalar_one_or_none()
            if not sa_role:
                sa_role = Role(name="super_admin", code=f"W1SA{tag}", description="Super Admin")
                db.add(sa_role)
                await db.flush()
                tracked["roles"].append(sa_role.id)

            admin_role = (await db.execute(select(Role).where(Role.name == "admin", Role.deleted_at.is_(None)))).scalar_one_or_none()
            if not admin_role:
                admin_role = Role(name="admin", code=f"W1AD{tag}", description="Admin")
                db.add(admin_role)
                await db.flush()
                tracked["roles"].append(admin_role.id)

            dept_a = Role(name=f"W1_DeptA_{tag}", code=f"W1DA{tag}", description="Wave 1 Dept A")
            dept_b = Role(name=f"W1_DeptB_{tag}", code=f"W1DB{tag}", description="Wave 1 Dept B")
            mgr_role = Role(name=f"W1_Mgr_{tag}", code=f"W1MG{tag}", description="Wave 1 Manager Perms")
            rep_role = Role(name=f"W1_Rep_{tag}", code=f"W1RP{tag}", description="Wave 1 Rep Perms")
            zero_role = Role(name=f"W1_Zero_{tag}", code=f"W1ZR{tag}", description="Wave 1 Zero Perms")
            db.add_all([dept_a, dept_b, mgr_role, rep_role, zero_role])
            await db.flush()
            tracked["roles"].extend([dept_a.id, dept_b.id, mgr_role.id, rep_role.id, zero_role.id])

            for c in [
                "crm.leads.view", "crm.leads.manage", "crm.leads.import",
                "crm.pipelines.view", "crm.distribution.view", "crm.distribution.manage",
                "task.view", "task.create", "task.update", "task.delete",
            ]:
                db.add(RolePermission(role_id=mgr_role.id, permission_id=pmap[c].id))
            for c in ["crm.leads.view", "crm.leads.import", "crm.pipelines.view", "task.view", "task.update"]:
                db.add(RolePermission(role_id=rep_role.id, permission_id=pmap[c].id))

            async def mk_user(
                uname: str,
                dname: str,
                roles: list[Role],
                *,
                manager_id: uuid.UUID | None = None,
                is_active: bool = True,
                deleted: bool = False,
            ) -> User:
                u = User(
                    username=uname,
                    email=f"{uname}@w1.inhyma.local",
                    display_name=dname,
                    password_hash=pw_hash,
                    has_login=True,
                    is_active=is_active,
                    status=UserStatus.ACTIVE if is_active else UserStatus.INACTIVE,
                    manager_id=manager_id,
                    deleted_at=datetime.now(timezone.utc) if deleted else None,
                )
                db.add(u)
                await db.flush()
                tracked["users"].append(u.id)
                for idx, r in enumerate(roles):
                    db.add(UserRole(user_id=u.id, role_id=r.id, status=RoleAssignmentStatus.ACTIVE, is_primary=(idx == 0)))
                return u

            u_sa = await mk_user(f"w1_sa_{tag}", "W1 SuperAdmin", [sa_role])
            u_admin = await mk_user(f"w1_adm_{tag}", "W1 Admin", [admin_role])
            u_admin_denied = await mk_user(f"w1_admden_{tag}", "W1 Admin Denied", [admin_role])
            u_mgr_a = await mk_user(f"w1_mgra_{tag}", "W1 Mgr A", [dept_a, mgr_role])
            u_mgr_b = await mk_user(f"w1_mgrb_{tag}", "W1 Mgr B", [dept_b, mgr_role])
            u_sp_a1 = await mk_user(f"w1_spa1_{tag}", "W1 Rep A1", [dept_a, rep_role], manager_id=u_mgr_a.id)
            u_sp_a2 = await mk_user(f"w1_spa2_{tag}", "W1 Rep A2", [dept_a, rep_role], manager_id=u_mgr_a.id)
            u_sp_b1 = await mk_user(f"w1_spb1_{tag}", "W1 Rep B1", [dept_b, rep_role], manager_id=u_mgr_b.id)
            u_denied = await mk_user(f"w1_den_{tag}", "W1 Denied Mgr", [dept_a, mgr_role])
            u_zero = await mk_user(f"w1_zero_{tag}", "W1 Zero User", [zero_role])
            u_inactive = await mk_user(f"w1_inact_{tag}", "W1 Inactive", [dept_a, rep_role], is_active=False)
            u_deleted = await mk_user(f"w1_del_{tag}", "W1 Deleted", [dept_a, rep_role], deleted=True)

            db.add_all([
                DepartmentLeadershipAssignment(
                    department_id=dept_a.id, employee_id=u_mgr_a.id,
                    leadership_type=LeadershipType.DEPARTMENT_HEAD, is_primary=True, status=OrgRecordStatus.ACTIVE,
                ),
                DepartmentLeadershipAssignment(
                    department_id=dept_b.id, employee_id=u_mgr_b.id,
                    leadership_type=LeadershipType.DEPARTMENT_HEAD, is_primary=True, status=OrgRecordStatus.ACTIVE,
                ),
                UserPermission(user_id=u_denied.id, permission_id=pmap["crm.leads.view"].id, is_granted=False),
                UserPermission(user_id=u_admin_denied.id, permission_id=pmap["crm.leads.manage"].id, is_granted=False),
            ])

            for rep in (u_sp_a1, u_sp_a2, u_sp_b1):
                db.add(CrmSalespersonConfig(user_id=rep.id, is_active=True, is_eligible=True, priority=1, max_lead_capacity=50))

            cat = ProductCategory(code=f"W1CAT{tag}", name=f"W1 Category {tag}", status=RecordStatus.ACTIVE)
            uom = UnitOfMeasurement(code=f"W1U{tag}", name=f"W1 Unit {tag}", short_name="U", status=RecordStatus.ACTIVE)
            db.add_all([cat, uom])
            await db.flush()
            tracked["categories"].append(cat.id)
            tracked["uoms"].append(uom.id)

            prod = Product(
                product_code=f"W1-PRD-{tag}",
                product_name=f"W1 Machine {tag}",
                product_name_tally=f"W1 Machine {tag}",
                category_id=cat.id,
                uom_id=uom.id,
                standard_price=Decimal("10000.00"),
                is_sellable=True,
                status=RecordStatus.ACTIVE,
            )
            comp_a = Company(company_name=f"W1 Alpha Robotics {tag}", is_active=True)
            comp_b = Company(company_name=f"W1 Secret DeptB Corp {tag}", is_active=True)
            db.add_all([prod, comp_a, comp_b])
            await db.flush()
            tracked["products"].append(prod.id)
            tracked["companies"].extend([comp_a.id, comp_b.id])

            pipe = CrmPipeline(name=f"W1 Pipeline {tag}", is_default=False, is_active=True, created_by=u_admin.id)
            db.add(pipe)
            await db.flush()
            tracked["pipelines"].append(pipe.id)

            stg_new = CrmPipelineStage(pipeline_id=pipe.id, name="New Lead", stage_order=1, stage_type="open", is_initial=True, is_active=True)
            stg_work = CrmPipelineStage(pipeline_id=pipe.id, name="Working", stage_order=2, stage_type="open", is_initial=False, is_active=True)
            stg_won = CrmPipelineStage(pipeline_id=pipe.id, name="Closed Won", stage_order=3, stage_type="won", is_initial=False, is_active=True)
            stg_lost = CrmPipelineStage(pipeline_id=pipe.id, name="Closed Lost", stage_order=4, stage_type="lost", is_initial=False, is_active=True)
            db.add_all([stg_new, stg_work, stg_won, stg_lost])
            await db.commit()

        async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://wave1.local") as client:
            yield {
                "client": client,
                "SessionLocal": SessionLocal,
                "tag": tag,
                "p_base": p_base,
                "tracked": tracked,
                "users": {
                    "sa": u_sa, "admin": u_admin, "admin_denied": u_admin_denied,
                    "mgr_a": u_mgr_a, "mgr_b": u_mgr_b,
                    "sp_a1": u_sp_a1, "sp_a2": u_sp_a2, "sp_b1": u_sp_b1,
                    "denied": u_denied, "zero": u_zero, "inactive": u_inactive, "deleted": u_deleted,
                },
                "headers": {
                    "sa": _auth_headers(u_sa.id),
                    "admin": _auth_headers(u_admin.id),
                    "admin_denied": _auth_headers(u_admin_denied.id),
                    "mgr_a": _auth_headers(u_mgr_a.id),
                    "mgr_b": _auth_headers(u_mgr_b.id),
                    "sp_a1": _auth_headers(u_sp_a1.id),
                    "sp_a2": _auth_headers(u_sp_a2.id),
                    "sp_b1": _auth_headers(u_sp_b1.id),
                    "denied": _auth_headers(u_denied.id),
                    "zero": _auth_headers(u_zero.id),
                    "inactive": _auth_headers(u_inactive.id),
                    "deleted": _auth_headers(u_deleted.id),
                },
                "pipe": pipe,
                "stages": {"new": stg_new, "work": stg_work, "won": stg_won, "lost": stg_lost},
                "comp_a": comp_a,
                "comp_b": comp_b,
                "prod": prod,
            }
    finally:
        app.dependency_overrides.pop(get_db_session, None)
        async with SessionLocal() as cleanup_db:
            # Capture any extra leads created via API under our test pipeline or users
            extra_leads = (
                await cleanup_db.execute(
                    select(CrmLead.id).where(
                        (CrmLead.pipeline_id.in_(tracked["pipelines"]))
                        | (CrmLead.created_by.in_(tracked["users"]))
                    )
                )
            ).scalars().all()
            all_lead_ids = list(set(tracked["leads"]) | set(extra_leads))

            if all_lead_ids:
                fu_tids = (
                    await cleanup_db.execute(
                        select(CrmFollowUp.task_id).where(
                            CrmFollowUp.lead_id.in_(all_lead_ids),
                            CrmFollowUp.task_id.is_not(None),
                        )
                    )
                ).scalars().all()
                tracked["tasks"].extend(fu_tids)
                q_ids = (
                    await cleanup_db.execute(
                        select(CrmSalesQuotation.id).where(CrmSalesQuotation.lead_id.in_(all_lead_ids))
                    )
                ).scalars().all()
                all_q_ids = list(set(tracked["quotations"]) | set(q_ids))
                if all_q_ids:
                    await cleanup_db.execute(delete(CrmQuotationVersion).where(CrmQuotationVersion.quotation_id.in_(all_q_ids)))
                    await cleanup_db.execute(delete(CrmQuotationItem).where(CrmQuotationItem.quotation_id.in_(all_q_ids)))
                    await cleanup_db.execute(delete(CrmSalesQuotation).where(CrmSalesQuotation.id.in_(all_q_ids)))
                await cleanup_db.execute(delete(CrmLeadProduct).where(CrmLeadProduct.lead_id.in_(all_lead_ids)))
                await cleanup_db.execute(delete(CrmFollowUp).where(CrmFollowUp.lead_id.in_(all_lead_ids)))
                await cleanup_db.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_(all_lead_ids)))
                await cleanup_db.execute(delete(CrmAssignmentHistory).where(CrmAssignmentHistory.lead_id.in_(all_lead_ids)))
                await cleanup_db.execute(delete(CrmStageHistory).where(CrmStageHistory.lead_id.in_(all_lead_ids)))
                await cleanup_db.execute(delete(CrmLead).where(CrmLead.id.in_(all_lead_ids)))

            if tracked["tasks"]:
                await cleanup_db.execute(delete(TaskComment).where(TaskComment.task_id.in_(tracked["tasks"])))
                await cleanup_db.execute(delete(TaskAssignee).where(TaskAssignee.task_id.in_(tracked["tasks"])))
                await cleanup_db.execute(delete(Task).where(Task.id.in_(tracked["tasks"])))

            extra_batches = (
                await cleanup_db.execute(
                    select(CrmImportBatch.id).where(CrmImportBatch.initiated_by.in_(tracked["users"]))
                )
            ).scalars().all()
            all_batch_ids = list(set(tracked["batches"]) | set(extra_batches))
            if all_batch_ids:
                await cleanup_db.execute(delete(CrmImportBatch).where(CrmImportBatch.id.in_(all_batch_ids)))

            if tracked["pipelines"]:
                await cleanup_db.execute(delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id.in_(tracked["pipelines"])))
                await cleanup_db.execute(delete(CrmPipeline).where(CrmPipeline.id.in_(tracked["pipelines"])))

            if tracked["products"]:
                await cleanup_db.execute(delete(Product).where(Product.id.in_(tracked["products"])))
            if tracked["categories"]:
                await cleanup_db.execute(delete(ProductCategory).where(ProductCategory.id.in_(tracked["categories"])))
            if tracked["uoms"]:
                await cleanup_db.execute(delete(UnitOfMeasurement).where(UnitOfMeasurement.id.in_(tracked["uoms"])))

            # Also remove any auto-created companies linked to our test users
            extra_cos = (
                await cleanup_db.execute(select(Company.id).where(Company.sales_person_id.in_(tracked["users"])))
            ).scalars().all()
            all_co_ids = list(set(tracked["companies"]) | set(extra_cos))
            if all_co_ids:
                await cleanup_db.execute(delete(Company).where(Company.id.in_(all_co_ids)))

            if tracked["users"]:
                await cleanup_db.execute(delete(Notification).where(Notification.user_id.in_(tracked["users"])))
                await cleanup_db.execute(delete(AuditLog).where(AuditLog.user_id.in_(tracked["users"])))
                await cleanup_db.execute(delete(CrmSalespersonConfig).where(CrmSalespersonConfig.user_id.in_(tracked["users"])))
                await cleanup_db.execute(delete(DepartmentLeadershipAssignment).where(DepartmentLeadershipAssignment.employee_id.in_(tracked["users"])))
                await cleanup_db.execute(delete(UserPermission).where(UserPermission.user_id.in_(tracked["users"])))
                await cleanup_db.execute(delete(UserRole).where(UserRole.user_id.in_(tracked["users"])))
                await cleanup_db.execute(delete(AuthSession).where(AuthSession.user_id.in_(tracked["users"])))
                await cleanup_db.execute(text("UPDATE users SET manager_id = NULL WHERE id = ANY(:uids)"), {"uids": tracked["users"]})
                await cleanup_db.execute(delete(User).where(User.id.in_(tracked["users"])))

            if tracked["roles"]:
                await cleanup_db.execute(delete(RolePermission).where(RolePermission.role_id.in_(tracked["roles"])))
                await cleanup_db.execute(delete(Role).where(Role.id.in_(tracked["roles"])))
            if tracked["perms"]:
                await cleanup_db.execute(delete(Permission).where(Permission.id.in_(tracked["perms"])))
            await cleanup_db.commit()
        await engine.dispose()


# =============================================================================
# LM-DEF-001: SOFT-DELETED CRM LEADS REMAIN VISIBLE
# =============================================================================
@pytest.mark.asyncio
async def test_lm_def_001_soft_deleted_crm_leads_excluded_from_list_detail_counts_and_reuse(wave1_env):
    client = wave1_env["client"]
    H = wave1_env["headers"]
    SessionLocal = wave1_env["SessionLocal"]
    pipe = wave1_env["pipe"]
    comp_a = wave1_env["comp_a"]
    prod = wave1_env["prod"]
    p_base = wave1_env["p_base"]
    tag = wave1_env["tag"]

    # Create 2 active leads in Dept A + 1 active lead in Dept B
    r_act = await client.post("/api/v1/crm/leads", headers=H["sp_a1"], json={
        "name": f"W1 Active {tag}", "phone": f"91{p_base}01", "company_id": str(comp_a.id), "pipeline_id": str(pipe.id),
    })
    assert r_act.status_code == 201, r_act.text
    act_id = r_act.json()["data"]["id"]

    r_del = await client.post("/api/v1/crm/leads", headers=H["sp_a1"], json={
        "name": f"W1 SoftDel {tag}", "phone": f"91{p_base}02", "company_id": str(comp_a.id), "pipeline_id": str(pipe.id),
    })
    assert r_del.status_code == 201, r_del.text
    del_id = r_del.json()["data"]["id"]

    r_b = await client.post("/api/v1/crm/leads", headers=H["sp_b1"], json={
        "name": f"W1 DeptB Active {tag}", "phone": f"91{p_base}03", "company_id": str(comp_a.id), "pipeline_id": str(pipe.id),
    })
    assert r_b.status_code == 201, r_b.text
    b_id = r_b.json()["data"]["id"]

    # Attach quotation & follow-up to the lead about to be soft-deleted
    r_q = await client.post(f"/api/v1/crm/leads/{del_id}/quotations", headers=H["sp_a1"], json={
        "items": [{"product_id": str(prod.id), "quantity": "1", "unit_price": "1000", "unit_discount": "0", "tax_rate": "18"}]
    })
    assert r_q.status_code == 201
    q_id = r_q.json()["data"]["id"]

    r_fu = await client.post(f"/api/v1/crm/leads/{del_id}/follow-ups", headers=H["sp_a1"], json={
        "due_at": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(),
        "follow_up_type": "call", "notes": "Follow-up on deleted lead",
    })
    assert r_fu.status_code == 201

    # Soft-delete `del_id`
    async with SessionLocal() as db:
        ld = await db.get(CrmLead, uuid.UUID(del_id))
        ld.deleted_at = datetime.now(timezone.utc)
        await db.commit()

    # 1. Active lead still visible in list & detail
    r_get_act = await client.get(f"/api/v1/crm/leads/{act_id}", headers=H["sp_a1"])
    assert r_get_act.status_code == 200
    r_list_sp = await client.get(f"/api/v1/crm/leads?pipeline_id={pipe.id}", headers=H["sp_a1"])
    assert r_list_sp.status_code == 200
    sp_ids = {x["id"] for x in r_list_sp.json()["data"]["items"]}
    assert act_id in sp_ids
    assert del_id not in sp_ids, "Soft-deleted lead leaked into salesperson list_leads!"
    assert r_list_sp.json()["data"]["total"] == 1

    # 2. Admin list & total count must exclude soft-deleted lead (only act_id + b_id = 2)
    r_list_adm = await client.get(f"/api/v1/crm/leads?pipeline_id={pipe.id}", headers=H["admin"])
    assert r_list_adm.status_code == 200
    adm_ids = {x["id"] for x in r_list_adm.json()["data"]["items"]}
    assert del_id not in adm_ids, "Soft-deleted lead leaked into admin list_leads!"
    assert r_list_adm.json()["data"]["total"] == 2

    # 3. Direct GET /crm/leads/{del_id} returns 404 for Admin, Manager, and Salesperson
    for persona in ("admin", "mgr_a", "sp_a1"):
        r_g = await client.get(f"/api/v1/crm/leads/{del_id}", headers=H[persona])
        assert r_g.status_code == 404, f"{persona} got HTTP {r_g.status_code} on soft-deleted lead!"

    # 4. Secondary leak check: quotation & PDF on soft-deleted parent lead return 404
    assert (await client.get(f"/api/v1/crm/quotations/{q_id}", headers=H["admin"])).status_code == 404
    assert (await client.get(f"/api/v1/crm/quotations/{q_id}/pdf", headers=H["admin"])).status_code == 404

    # 5. Daily work summary & team oversight follow-up counts exclude follow-ups on soft-deleted lead
    r_dws = await client.get("/api/v1/crm/daily-work/summary", headers=H["sp_a1"])
    assert r_dws.status_code == 200
    dws = r_dws.json()["data"]
    assert dws["due_today_follow_ups"] + dws["overdue_follow_ups"] + dws["upcoming_follow_ups"] == 0

    # 6. Cross-department active lead isolation unchanged
    assert (await client.get(f"/api/v1/crm/leads/{b_id}", headers=H["sp_a1"])).status_code == 403
    assert (await client.get(f"/api/v1/crm/leads/{b_id}", headers=H["mgr_a"])).status_code == 403

    # 7. Phone reuse for soft-deleted lead remains functional
    r_reuse = await client.post("/api/v1/crm/leads", headers=H["sp_a1"], json={
        "name": f"W1 Reused {tag}", "phone": f"91{p_base}02", "company_id": str(comp_a.id), "pipeline_id": str(pipe.id),
    })
    assert r_reuse.status_code == 201


# =============================================================================
# LM-DEF-002: PIPELINE & STAGE DEACTIVATION GUARDS BROKEN
# =============================================================================
@pytest.mark.asyncio
async def test_lm_def_002_pipeline_and_stage_deactivation_guards_active_leads(wave1_env):
    client = wave1_env["client"]
    H = wave1_env["headers"]
    SessionLocal = wave1_env["SessionLocal"]
    pipe = wave1_env["pipe"]
    stgs = wave1_env["stages"]
    comp_a = wave1_env["comp_a"]
    p_base = wave1_env["p_base"]
    tag = wave1_env["tag"]

    # Create active lead (status='new') in non-initial open stage 'Working'
    r_ld = await client.post("/api/v1/crm/leads", headers=H["admin"], json={
        "name": f"W1 Active Stage Lead {tag}",
        "phone": f"92{p_base}01",
        "company_id": str(comp_a.id),
        "pipeline_id": str(pipe.id),
        "stage_id": str(stgs["work"].id),
        "assigned_to": str(wave1_env["users"]["sp_a1"].id),
    })
    assert r_ld.status_code == 201, r_ld.text
    ld_id = r_ld.json()["data"]["id"]

    # 1. Stage deactivation MUST be blocked (400) while active lead ('new') is in it
    r_stg_toggle = await client.post(f"/api/v1/crm/pipelines/{pipe.id}/stages/{stgs['work'].id}/toggle-active", headers=H["admin"])
    assert r_stg_toggle.status_code == 400, f"Expected 400 blocking stage deactivation, got {r_stg_toggle.status_code}"

    r_stg_put = await client.put(f"/api/v1/crm/pipelines/{pipe.id}/stages/{stgs['work'].id}", headers=H["admin"], json={"is_active": False})
    assert r_stg_put.status_code == 400

    # 2. Pipeline deactivation MUST be blocked (400) while active lead is in it
    r_pipe_toggle = await client.post(f"/api/v1/crm/pipelines/{pipe.id}/toggle-active", headers=H["admin"])
    assert r_pipe_toggle.status_code == 400, f"Expected 400 blocking pipeline deactivation, got {r_pipe_toggle.status_code}"

    r_pipe_put = await client.put(f"/api/v1/crm/pipelines/{pipe.id}", headers=H["admin"], json={"is_active": False})
    assert r_pipe_put.status_code == 400

    # 3. Also verify 'contacted' status blocks deactivation
    await client.post(f"/api/v1/crm/leads/{ld_id}/activities", headers=H["admin"], json={"activity_type": "call", "subject": "Touch"})
    assert (await client.post(f"/api/v1/crm/pipelines/{pipe.id}/stages/{stgs['work'].id}/toggle-active", headers=H["admin"])).status_code == 400

    # Verify lead was NOT silently moved or altered
    ld_chk = (await client.get(f"/api/v1/crm/leads/{ld_id}", headers=H["admin"])).json()["data"]
    assert ld_chk["stage_id"] == str(stgs["work"].id)
    assert ld_chk["status"] == "contacted"

    # 4. Move lead to terminal 'Closed Won' -> 'Working' stage has 0 active leads & pipeline has 0 open leads!
    r_win = await client.post(f"/api/v1/crm/leads/{ld_id}/stage", headers=H["admin"], json={"stage_id": str(stgs["won"].id)})
    assert r_win.status_code == 200 and r_win.json()["data"]["status"] == "won"

    # Also add a soft-deleted active lead into 'Working' -> MUST NOT block deactivation!
    async with SessionLocal() as db:
        db.add(CrmLead(
            name=f"W1 Deleted Blocker {tag}",
            original_phone=f"92{p_base}02",
            normalized_phone=f"+9192{p_base}02",
            pipeline_id=pipe.id,
            stage_id=stgs["work"].id,
            status="new",
            deleted_at=datetime.now(timezone.utc),
        ))
        await db.commit()

    # Now deactivating 'Working' stage succeeds (200)
    r_stg_ok = await client.post(f"/api/v1/crm/pipelines/{pipe.id}/stages/{stgs['work'].id}/toggle-active", headers=H["admin"])
    assert r_stg_ok.status_code == 200 and r_stg_ok.json()["data"]["is_active"] is False

    # And deactivating 'Closed Won' stage with only terminal 'won' lead succeeds (200)
    r_won_stg_ok = await client.post(f"/api/v1/crm/pipelines/{pipe.id}/stages/{stgs['won'].id}/toggle-active", headers=H["admin"])
    assert r_won_stg_ok.status_code == 200 and r_won_stg_ok.json()["data"]["is_active"] is False

    # Initial stage of active pipeline MUST still be protected (400)
    r_init_blk = await client.post(f"/api/v1/crm/pipelines/{pipe.id}/stages/{stgs['new'].id}/toggle-active", headers=H["admin"])
    assert r_init_blk.status_code == 400

    # Non-default pipeline with ONLY won/lost/deleted leads can be deactivated (200)
    r_pipe_ok = await client.post(f"/api/v1/crm/pipelines/{pipe.id}/toggle-active", headers=H["admin"])
    assert r_pipe_ok.status_code == 200 and r_pipe_ok.json()["data"]["is_active"] is False


# =============================================================================
# LM-DEF-003: CSV CONFIRM_IMPORT EXPOSES OUT-OF-SCOPE LEAD DATA
# =============================================================================
@pytest.mark.asyncio
async def test_lm_def_003_csv_confirm_masks_out_of_scope_duplicate_lead_and_company_data(wave1_env):
    client = wave1_env["client"]
    H = wave1_env["headers"]
    SessionLocal = wave1_env["SessionLocal"]
    pipe = wave1_env["pipe"]
    comp_b = wave1_env["comp_b"]
    p_base = wave1_env["p_base"]
    tag = wave1_env["tag"]

    # Dept B owns confidential lead linked to comp_b with priority='urgent'
    r_b = await client.post("/api/v1/crm/leads", headers=H["sp_b1"], json={
        "name": f"DeptB VIP {tag}",
        "phone": f"93{p_base}01",
        "company_id": str(comp_b.id),
        "campaign": "DeptB_Orig_Camp",
        "priority": "urgent",
        "pipeline_id": str(pipe.id),
    })
    assert r_b.status_code == 201, r_b.text
    lead_b = r_b.json()["data"]
    lead_b_id = lead_b["id"]
    lead_b_code = lead_b["lead_code"]

    csv_payload = (
        "Name,Number,Campaign,Priority,Company\n"
        f"Probe Contact,93{p_base}01,CrossDept_Camp_1,Low,\n"
        f"FileDup Row,93{p_base}02,New_Camp,Medium,\n"
        f"FileDup Row,93{p_base}02,New_Camp,Medium,\n"
        f"Conflict Row,93{p_base}02,Other_Camp,High,\n"
    ).encode("utf-8")

    # 1. Cross-department Salesperson A1 preview & confirm MUST mask ALL identifying data of Dept B lead!
    r_prev_a1 = await client.post(
        "/api/v1/crm/import/preview", headers=H["sp_a1"],
        data={"pipeline_id": str(pipe.id)},
        files={"file": ("probe.csv", csv_payload, "text/csv")},
    )
    assert r_prev_a1.status_code == 200
    prev_a1_dup = next(r for r in r_prev_a1.json()["data"]["rows"] if r["status"] == "CRM_DUPLICATE")
    assert prev_a1_dup["matched_lead_code"] is None
    assert prev_a1_dup["company_id"] is None
    assert prev_a1_dup["matched_company_name"] is None
    assert prev_a1_dup["priority"] == "low"  # caller's CSV value, NOT Dept B's 'urgent'!
    assert lead_b_code not in r_prev_a1.text
    assert comp_b.company_name not in r_prev_a1.text

    r_conf_a1 = await client.post(
        "/api/v1/crm/import/confirm", headers=H["sp_a1"],
        data={"pipeline_id": str(pipe.id), "batch_name": f"W1 Privacy {tag}"},
        files={"file": ("probe.csv", csv_payload, "text/csv")},
    )
    assert r_conf_a1.status_code == 201, r_conf_a1.text
    conf_a1_rows = r_conf_a1.json()["data"]["row_results"]
    conf_a1_dup = next(r for r in conf_a1_rows if r["status"] == "CRM_DUPLICATE")
    assert conf_a1_dup["matched_lead_code"] is None, f"LEAKED lead_code: {conf_a1_dup}"
    assert conf_a1_dup["company_id"] is None, f"LEAKED company_id: {conf_a1_dup}"
    assert conf_a1_dup["matched_company_name"] is None, f"LEAKED company_name: {conf_a1_dup}"
    assert conf_a1_dup["priority"] == "low", f"LEAKED priority: {conf_a1_dup}"
    assert lead_b_code not in r_conf_a1.text, "Dept B lead_code leaked in confirm JSON!"
    assert comp_b.company_name not in r_conf_a1.text, "Dept B company_name leaked in confirm JSON!"

    # Verify FILE_DUPLICATE and CONFLICT_IN_FILE preserved cleanly
    statuses = [r["status"] for r in conf_a1_rows]
    assert "FILE_DUPLICATE" in statuses and "CONFLICT_IN_FILE" in statuses

    # 2. Cross-department Manager A MUST also receive masked duplicate info
    csv_mgr_a = f"Name,Number,Campaign,Priority,Company\nMgrA Probe,93{p_base}01,CrossDept_Camp_2,Medium,\n".encode("utf-8")
    r_conf_mgra = await client.post(
        "/api/v1/crm/import/confirm", headers=H["mgr_a"],
        data={"pipeline_id": str(pipe.id), "distribution_mode": "none"},
        files={"file": ("mgra.csv", csv_mgr_a, "text/csv")},
    )
    assert r_conf_mgra.status_code == 201
    row_mgra = r_conf_mgra.json()["data"]["row_results"][0]
    assert row_mgra["status"] == "CRM_DUPLICATE"
    assert row_mgra["matched_lead_code"] is None
    assert row_mgra["company_id"] is None
    assert row_mgra["matched_company_name"] is None
    assert lead_b_code not in r_conf_mgra.text
    assert comp_b.company_name not in r_conf_mgra.text

    # 3. Authorized same-dept Manager B & Admin STILL see full authorized metadata
    csv_in_scope = f"Name,Number,Campaign,Priority,Company\nInScope Probe,93{p_base}01,DeptB_Camp_3,Low,\n".encode("utf-8")
    for authorized in ("mgr_b", "sp_b1", "admin"):
        r_p = await client.post(
            "/api/v1/crm/import/preview", headers=H[authorized],
            data={"pipeline_id": str(pipe.id)},
            files={"file": ("in.csv", csv_in_scope, "text/csv")},
        )
        assert r_p.status_code == 200
        assert r_p.json()["data"]["rows"][0]["matched_lead_code"] == lead_b_code

    r_conf_mgrb = await client.post(
        "/api/v1/crm/import/confirm", headers=H["mgr_b"],
        data={"pipeline_id": str(pipe.id), "distribution_mode": "none"},
        files={"file": ("in.csv", csv_in_scope, "text/csv")},
    )
    assert r_conf_mgrb.status_code == 201
    row_mgrb = r_conf_mgrb.json()["data"]["row_results"][0]
    assert row_mgrb["matched_lead_code"] == lead_b_code
    assert row_mgrb["company_id"] == str(comp_b.id)
    assert row_mgrb["matched_company_name"] == comp_b.company_name

    # 4. Existing Dept B lead preserved owner/name/stage/company & appended campaign_history
    async with SessionLocal() as db:
        lb_db = await db.get(CrmLead, uuid.UUID(lead_b_id))
        assert lb_db.assigned_to == wave1_env["users"]["sp_b1"].id
        assert lb_db.name == f"DeptB VIP {tag}"
        assert lb_db.company_id == comp_b.id
        assert lb_db.campaign == "DeptB_Orig_Camp"
        camps = {c["campaign"] for c in (lb_db.custom_fields or {}).get("campaign_history", [])}
        assert {"CrossDept_Camp_1", "CrossDept_Camp_2", "DeptB_Camp_3"}.issubset(camps)


# =============================================================================
# LM-DEF-004: GLOBAL COMPANY BACKFILL ADMIN-ONLY + AUDIT LOG
# =============================================================================
@pytest.mark.asyncio
async def test_lm_def_004_backfill_companies_admin_only_and_audit_logged(wave1_env):
    client = wave1_env["client"]
    H = wave1_env["headers"]
    SessionLocal = wave1_env["SessionLocal"]
    pipe = wave1_env["pipe"]
    stgs = wave1_env["stages"]
    comp_a = wave1_env["comp_a"]
    comp_b = wave1_env["comp_b"]
    p_base = wave1_env["p_base"]
    tag = wave1_env["tag"]

    # Seed unlinked leads in Dept A & Dept B + 1 unmatched lead
    async with SessionLocal() as db:
        ul_a = CrmLead(
            name=f"Unlinked A {tag}", original_phone=f"94{p_base}01", normalized_phone=f"+9194{p_base}01",
            company_name=comp_a.company_name, company_id=None,
            pipeline_id=pipe.id, stage_id=stgs["new"].id,
            created_by=wave1_env["users"]["sp_a1"].id, assigned_to=wave1_env["users"]["sp_a1"].id,
        )
        ul_b = CrmLead(
            name=f"Unlinked B {tag}", original_phone=f"94{p_base}02", normalized_phone=f"+9194{p_base}02",
            company_name=comp_b.company_name, company_id=None,
            pipeline_id=pipe.id, stage_id=stgs["new"].id,
            created_by=wave1_env["users"]["sp_b1"].id, assigned_to=wave1_env["users"]["sp_b1"].id,
        )
        ul_unm = CrmLead(
            name=f"Unmatched B {tag}", original_phone=f"94{p_base}03", normalized_phone=f"+9194{p_base}03",
            company_name=f"NonExistent Corp {tag}", company_id=None,
            pipeline_id=pipe.id, stage_id=stgs["new"].id,
            created_by=wave1_env["users"]["sp_b1"].id, assigned_to=wave1_env["users"]["sp_b1"].id,
        )
        db.add_all([ul_a, ul_b, ul_unm])
        await db.commit()
        ul_a_id, ul_b_id, ul_unm_id = ul_a.id, ul_b.id, ul_unm.id

    # 1. Department Manager A (with crm.leads.manage) MUST be rejected with 403!
    r_mgra = await client.post("/api/v1/crm/leads/backfill-companies", headers=H["mgr_a"])
    assert r_mgra.status_code == 403, f"Dept Manager allowed to run global backfill! HTTP {r_mgra.status_code}: {r_mgra.text}"
    assert str(ul_b_id) not in r_mgra.text and f"NonExistent Corp {tag}" not in r_mgra.text

    # 2. Salesperson, Zero-perm, Explicitly Denied Manager, AND Explicitly Denied Admin all rejected (403)
    for blocked_persona in ("sp_a1", "zero", "denied", "admin_denied"):
        r_blk = await client.post("/api/v1/crm/leads/backfill-companies", headers=H[blocked_persona])
        assert r_blk.status_code == 403, f"{blocked_persona} got {r_blk.status_code} on backfill-companies!"

    # Verify ZERO leads were mutated by any blocked actor
    async with SessionLocal() as db:
        assert (await db.get(CrmLead, ul_a_id)).company_id is None
        assert (await db.get(CrmLead, ul_b_id)).company_id is None

    # 3. Authorized Admin succeeds (200), links unambiguous leads, and records domain AuditLog
    r_adm = await client.post("/api/v1/crm/leads/backfill-companies", headers=H["admin"])
    assert r_adm.status_code == 200, r_adm.text
    bf_data = r_adm.json()["data"]
    assert bf_data["safely_linked"] >= 2

    async with SessionLocal() as db:
        assert (await db.get(CrmLead, ul_a_id)).company_id == comp_a.id
        assert (await db.get(CrmLead, ul_b_id)).company_id == comp_b.id
        assert (await db.get(CrmLead, ul_unm_id)).company_id is None

        aud_rows = (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.user_id == wave1_env["users"]["admin"].id,
                    AuditLog.module == "crm",
                    AuditLog.endpoint == "/api/v1/crm/leads/backfill-companies",
                )
            )
        ).scalars().all()
        assert len(aud_rows) >= 1, "Missing domain AuditLog record for backfill-companies!"
        assert aud_rows[-1].entity_type == "CrmLead"


# =============================================================================
# LM-DEF-005: FORMER SALESPERSON RETAINS ACCESS AFTER REASSIGNMENT
# =============================================================================
@pytest.mark.asyncio
async def test_lm_def_005_former_salesperson_loses_access_after_reassignment_across_all_endpoints(wave1_env):
    client = wave1_env["client"]
    H = wave1_env["headers"]
    SessionLocal = wave1_env["SessionLocal"]
    pipe = wave1_env["pipe"]
    stgs = wave1_env["stages"]
    comp_a = wave1_env["comp_a"]
    prod = wave1_env["prod"]
    p_base = wave1_env["p_base"]
    tag = wave1_env["tag"]
    u = wave1_env["users"]

    # 1. Salesperson A1 creates lead -> assigned to self -> full access
    r_own = await client.post("/api/v1/crm/leads", headers=H["sp_a1"], json={
        "name": f"W1 Reassign Target {tag}", "phone": f"95{p_base}01",
        "company_id": str(comp_a.id), "pipeline_id": str(pipe.id),
    })
    assert r_own.status_code == 201, r_own.text
    lead_id = r_own.json()["data"]["id"]
    lead_code = r_own.json()["data"]["lead_code"]

    # Pre-reassignment: A1 adds activity, follow-up, product, quotation
    r_act = await client.post(f"/api/v1/crm/leads/{lead_id}/activities", headers=H["sp_a1"], json={"activity_type": "call", "subject": "Initial A1 call"})
    assert r_act.status_code == 201
    r_fu = await client.post(f"/api/v1/crm/leads/{lead_id}/follow-ups", headers=H["sp_a1"], json={
        "due_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "follow_up_type": "call", "notes": "A1 scheduled call",
    })
    assert r_fu.status_code == 201
    fu_id = r_fu.json()["data"]["id"]
    r_prod = await client.post(f"/api/v1/crm/leads/{lead_id}/products", headers=H["sp_a1"], json={"product_id": str(prod.id)})
    assert r_prod.status_code == 201
    r_q = await client.post(f"/api/v1/crm/leads/{lead_id}/quotations", headers=H["sp_a1"], json={
        "items": [{"product_id": str(prod.id), "quantity": "1", "unit_price": "5000", "unit_discount": "0", "tax_rate": "18"}]
    })
    assert r_q.status_code == 201
    q_id = r_q.json()["data"]["id"]

    # 2. Unassigned lead created by A1 -> A1 retains legitimate access while unassigned!
    async with SessionLocal() as db:
        unass_ld = CrmLead(
            name=f"W1 Unassigned Creator {tag}", original_phone=f"95{p_base}02", normalized_phone=f"+9195{p_base}02",
            company_id=comp_a.id, company_name=comp_a.company_name,
            pipeline_id=pipe.id, stage_id=stgs["new"].id,
            created_by=u["sp_a1"].id, assigned_to=None,
        )
        db.add(unass_ld)
        await db.commit()
        unass_id = str(unass_ld.id)
    assert (await client.get(f"/api/v1/crm/leads/{unass_id}", headers=H["sp_a1"])).status_code == 200
    sp_unass_list = {x["id"] for x in (await client.get(f"/api/v1/crm/leads?pipeline_id={pipe.id}", headers=H["sp_a1"])).json()["data"]["items"]}
    assert unass_id in sp_unass_list

    # 3. Admin reassigns `lead_id` from Salesperson A1 (Dept A) -> Salesperson B1 (Dept B)
    r_reas = await client.post(f"/api/v1/crm/leads/{lead_id}/reassign", headers=H["admin"], json={
        "new_salesperson_id": str(u["sp_b1"].id),
        "reason": "Reassigned to Dept B West specialist",
    })
    assert r_reas.status_code == 200, r_reas.text

    # 4. Former creator A1 MUST be denied across EVERY endpoint!
    r_list_a1 = await client.get(f"/api/v1/crm/leads?pipeline_id={pipe.id}", headers=H["sp_a1"])
    assert lead_id not in {x["id"] for x in r_list_a1.json()["data"]["items"]}, "Reassigned lead still in former creator's list!"

    assert (await client.get(f"/api/v1/crm/leads/{lead_id}", headers=H["sp_a1"])).status_code == 403
    assert (await client.patch(f"/api/v1/crm/leads/{lead_id}", headers=H["sp_a1"], json={"notes": "Stale edit"})).status_code == 403
    assert (await client.post(f"/api/v1/crm/leads/{lead_id}/stage", headers=H["sp_a1"], json={"stage_id": str(stgs["work"].id)})).status_code == 403
    assert (await client.get(f"/api/v1/crm/leads/{lead_id}/stage-history", headers=H["sp_a1"])).status_code == 403
    assert (await client.get(f"/api/v1/crm/leads/{lead_id}/timeline", headers=H["sp_a1"])).status_code == 403
    assert (await client.get(f"/api/v1/crm/leads/{lead_id}/activities", headers=H["sp_a1"])).status_code == 403
    assert (await client.post(f"/api/v1/crm/leads/{lead_id}/activities", headers=H["sp_a1"], json={"activity_type": "note", "subject": "Sneaky"})).status_code == 403
    assert (await client.get(f"/api/v1/crm/leads/{lead_id}/follow-ups", headers=H["sp_a1"])).status_code == 403
    assert (await client.post(f"/api/v1/crm/leads/{lead_id}/follow-ups", headers=H["sp_a1"], json={"due_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(), "follow_up_type": "call"})).status_code == 403
    assert (await client.patch(f"/api/v1/crm/follow-ups/{fu_id}", headers=H["sp_a1"], json={"notes": "Hijack FU"})).status_code == 403
    assert (await client.patch(f"/api/v1/crm/follow-ups/{fu_id}/status", headers=H["sp_a1"], json={"status": "cancelled"})).status_code == 403
    assert (await client.post(f"/api/v1/crm/follow-ups/{fu_id}/sync-task", headers=H["sp_a1"])).status_code == 403
    # Global /crm/follow-ups must NOT leak the reassigned lead's follow-up back to former creator A1
    r_fu_list_a1 = await client.get("/api/v1/crm/follow-ups?status=all", headers=H["sp_a1"])
    assert fu_id not in {x["id"] for x in r_fu_list_a1.json()["data"]["items"]}
    # Lead products & quotations
    assert (await client.get(f"/api/v1/crm/leads/{lead_id}/products", headers=H["sp_a1"])).status_code == 403
    assert (await client.post(f"/api/v1/crm/leads/{lead_id}/products", headers=H["sp_a1"], json={"product_id": str(prod.id)})).status_code == 403
    assert (await client.get(f"/api/v1/crm/leads/{lead_id}/quotations", headers=H["sp_a1"])).status_code == 403
    assert (await client.post(f"/api/v1/crm/leads/{lead_id}/quotations", headers=H["sp_a1"], json={"items": [{"product_id": str(prod.id), "quantity": "1", "unit_price": "100", "unit_discount": "0", "tax_rate": "18"}]})).status_code == 403
    assert (await client.get(f"/api/v1/crm/quotations/{q_id}", headers=H["sp_a1"])).status_code == 403
    assert (await client.get(f"/api/v1/crm/quotations/{q_id}/pdf", headers=H["sp_a1"])).status_code == 403
    assert (await client.get(f"/api/v1/crm/quotations/{q_id}/versions", headers=H["sp_a1"])).status_code == 403

    # Duplicate-phone probe by former creator A1 must NOT leak lead_code
    r_dup_probe = await client.post("/api/v1/crm/leads", headers=H["sp_a1"], json={"name": "DupProbe", "phone": f"95{p_base}01"})
    assert r_dup_probe.status_code == 409
    assert lead_code not in r_dup_probe.text

    # Former Dept A Manager MUST also lose access once lead belongs to Dept B!
    assert (await client.get(f"/api/v1/crm/leads/{lead_id}", headers=H["mgr_a"])).status_code == 403
    assert (await client.patch(f"/api/v1/crm/leads/{lead_id}", headers=H["mgr_a"], json={"notes": "Cross-dept mgr edit"})).status_code == 403

    # 5. New assignee (B1), Dept B Manager, and Admin all have full access; created_by & history preserved!
    for ok_persona in ("sp_b1", "mgr_b", "admin"):
        r_ok = await client.get(f"/api/v1/crm/leads/{lead_id}", headers=H[ok_persona])
        assert r_ok.status_code == 200
        assert r_ok.json()["data"]["created_by"] == str(u["sp_a1"].id)
        assert r_ok.json()["data"]["assigned_to"] == str(u["sp_b1"].id)

    # 6. Also test intra-department reassignment (A1 -> A2): A1 denied, A2 & Manager A allowed!
    r_intra = await client.post("/api/v1/crm/leads", headers=H["sp_a1"], json={
        "name": f"W1 Intra Lead {tag}", "phone": f"95{p_base}03",
        "company_id": str(comp_a.id), "pipeline_id": str(pipe.id),
    })
    intra_id = r_intra.json()["data"]["id"]
    r_reas2 = await client.post(f"/api/v1/crm/leads/{intra_id}/reassign", headers=H["mgr_a"], json={
        "new_salesperson_id": str(u["sp_a2"].id),
        "reason": "Intra-team handoff to Rep A2",
    })
    assert r_reas2.status_code == 200
    assert (await client.get(f"/api/v1/crm/leads/{intra_id}", headers=H["sp_a1"])).status_code == 403
    assert (await client.get(f"/api/v1/crm/leads/{intra_id}", headers=H["sp_a2"])).status_code == 200
    assert (await client.get(f"/api/v1/crm/leads/{intra_id}", headers=H["mgr_a"])).status_code == 200

    # Assignment history preserved accurately
    r_hist = await client.get(f"/api/v1/crm/assignment-history?lead_id={lead_id}", headers=H["admin"])
    assert r_hist.status_code == 200
    assert any(h["previous_owner_id"] == str(u["sp_a1"].id) and h["new_owner_id"] == str(u["sp_b1"].id) for h in r_hist.json()["data"]["items"])


# =============================================================================
# CROSS-CUTTING: 9-PERSONA RBAC + CRM FOLLOW-UP <-> ENTERPRISE TASKS SYNC
# =============================================================================
@pytest.mark.asyncio
async def test_wave1_rbac_idor_and_crm_tasks_sync_regression(wave1_env):
    client = wave1_env["client"]
    H = wave1_env["headers"]
    SessionLocal = wave1_env["SessionLocal"]
    pipe = wave1_env["pipe"]
    comp_a = wave1_env["comp_a"]
    p_base = wave1_env["p_base"]
    tag = wave1_env["tag"]
    u = wave1_env["users"]

    # Inactive & deleted JWT blocked
    assert (await client.get("/api/v1/crm/leads", headers=H["inactive"])).status_code == 403
    assert (await client.get("/api/v1/crm/leads", headers=H["deleted"])).status_code == 401
    assert (await client.get("/api/v1/crm/leads", headers=H["denied"])).status_code == 403
    assert (await client.get("/api/v1/crm/leads", headers=H["zero"])).status_code == 403

    # Create lead as sp_a1 -> verify bidirectional CRM Follow-Up <-> Enterprise Tasks sync intact!
    r_ld = await client.post("/api/v1/crm/leads", headers=H["sp_a1"], json={
        "name": f"W1 Sync Lead {tag}", "phone": f"96{p_base}01",
        "company_id": str(comp_a.id), "pipeline_id": str(pipe.id), "priority": "urgent",
    })
    assert r_ld.status_code == 201
    ld_id = r_ld.json()["data"]["id"]

    # Schedule follow-up -> creates Task (TODO)
    r_fu1 = await client.post(f"/api/v1/crm/leads/{ld_id}/follow-ups", headers=H["sp_a1"], json={
        "due_at": (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat(),
        "follow_up_type": "demo", "notes": "Wave 1 sync verification",
    })
    assert r_fu1.status_code == 201
    fu1_id = uuid.UUID(r_fu1.json()["data"]["id"])
    t1_id = uuid.UUID(r_fu1.json()["data"]["task_id"])

    # Edit follow-up -> syncs Task without duplicate
    r_fu1_ed = await client.patch(f"/api/v1/crm/follow-ups/{fu1_id}", headers=H["sp_a1"], json={"notes": "Updated sync notes"})
    assert r_fu1_ed.status_code == 200 and r_fu1_ed.json()["data"]["task_id"] == str(t1_id)

    # Reverse sync: Complete Task in Enterprise Tasks -> marks CrmFollowUp completed!
    r_t_done = await client.patch(f"/api/v1/tasks/{t1_id}", headers=H["sp_a1"], json={"status": "DONE"})
    assert r_t_done.status_code == 200
    async with SessionLocal() as db:
        fu1_db = await db.get(CrmFollowUp, fu1_id)
        assert fu1_db.status == "completed" and fu1_db.completed_at is not None

    # Second follow-up: Delete Task -> unlinks follow-up (stays pending); /sync-task creates fresh Task
    r_fu2 = await client.post(f"/api/v1/crm/leads/{ld_id}/follow-ups", headers=H["sp_a1"], json={
        "due_at": (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat(),
        "follow_up_type": "call", "notes": "Trash unlink test",
    })
    assert r_fu2.status_code == 201
    fu2_id = uuid.UUID(r_fu2.json()["data"]["id"])
    t2_id = uuid.UUID(r_fu2.json()["data"]["task_id"])

    r_t_del = await client.delete(f"/api/v1/tasks/{t2_id}", headers=H["sa"])
    assert r_t_del.status_code == 200
    async with SessionLocal() as db:
        fu2_db = await db.get(CrmFollowUp, fu2_id)
        assert fu2_db.task_id is None and fu2_db.status == "pending"

    r_resync = await client.post(f"/api/v1/crm/follow-ups/{fu2_id}/sync-task", headers=H["sp_a1"])
    assert r_resync.status_code == 200
    t2_new_id = r_resync.json()["data"]["task_id"]
    assert t2_new_id and t2_new_id != str(t2_id)
    async with SessionLocal() as db:
        assert (await db.get(Task, t2_id)).deleted_at is not None
        assert (await db.get(Task, uuid.UUID(t2_new_id))).deleted_at is None
