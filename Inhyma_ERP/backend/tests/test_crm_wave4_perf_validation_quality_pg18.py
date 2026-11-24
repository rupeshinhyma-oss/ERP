"""
PostgreSQL 18 Integration, Performance, Data-Quality & Validation Suite for
Lead Management Phase 2 / Wave 4 (LM-DEF-022 through LM-DEF-030).

Runs strictly against the isolated local PostgreSQL 18 test database (`inhyma_test_db`),
cleaning up 100% of synthetic test records in a `finally` block.
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
from sqlalchemy import delete, event, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.audit.models import AuditLog
from app.auth.models import Session as AuthSession
from app.auth.security import create_access_token, hash_password
from app.companies.models import Company
from app.core.constants import RecordStatus
from app.crm.import_service import sanitize_csv_cell
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
    CrmRoundRobinCursor,
    CrmSalespersonConfig,
    CrmSalespersonTerritory,
    CrmSalesQuotation,
    CrmStageHistory,
)
from app.database.base import _utcnow
from app.database.session import get_db_session
from app.main import app
from app.masters.product_categories.models import ProductCategory
from app.masters.products.models import Product
from app.masters.uom.models import UnitOfMeasurement
from app.notifications.models import Notification
from app.org_structure.models import DepartmentLeadershipAssignment, LeadershipType, OrgRecordStatus
from app.rbac.models import Permission, Role, RoleAssignmentStatus, RolePermission, UserPermission, UserRole
from app.tasks.models import Task, TaskAssignee, TaskComment
from app.users.models import User, UserStatus

TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://postgres:root@127.0.0.1:5432/inhyma_test_db",
)


def _auth_headers(user: User, session_id: str) -> dict[str, str]:
    tok = create_access_token(user.id, session_id=session_id)
    return {"Authorization": f"Bearer {tok.token}"}


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def wave4_env():
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

    tracked: dict[str, list[uuid.UUID]] = {
        "users": [],
        "roles": [],
        "perms": [],
        "pipelines": [],
        "leads": [],
        "batches": [],
        "companies": [],
        "quotations": [],
        "products": [],
        "categories": [],
        "uoms": [],
        "tasks": [],
    }

    ts = int(time.time())
    tag = f"{ts % 100000:05d}"
    pw_hash = hash_password("Wave4Test@2026!")

    try:
        async with SessionLocal() as db:
            perm_codes = [
                "crm.pipelines.view",
                "crm.pipelines.manage",
                "crm.leads.view",
                "crm.leads.manage",
                "crm.leads.import",
                "crm.distribution.view",
                "crm.distribution.manage",
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
                sa_role = Role(name="super_admin", code=f"W4SA{tag}", description="Super Admin")
                db.add(sa_role)
                await db.flush()
                tracked["roles"].append(sa_role.id)

            dept_a = Role(name=f"W4_DeptA_{tag}", code=f"W4DA{tag}", description="Wave4 Dept A")
            dept_b = Role(name=f"W4_DeptB_{tag}", code=f"W4DB{tag}", description="Wave4 Dept B")
            role_mgr = Role(name=f"W4_Mgr_{tag}", code=f"W4MG{tag}", description="Wave4 Manager")
            role_sp = Role(name=f"W4_Rep_{tag}", code=f"W4RP{tag}", description="Wave4 Rep")
            db.add_all([dept_a, dept_b, role_mgr, role_sp])
            await db.flush()
            tracked["roles"].extend([dept_a.id, dept_b.id, role_mgr.id, role_sp.id])

            for c in perm_codes:
                db.add(RolePermission(role_id=role_mgr.id, permission_id=perms[c].id))
            for c in ("crm.pipelines.view", "crm.leads.view", "crm.leads.import"):
                db.add(RolePermission(role_id=role_sp.id, permission_id=perms[c].id))

            async def mk_user(uname: str, dname: str, roles: list[Role], *, manager_id: uuid.UUID | None = None, is_active: bool = True) -> User:
                u = User(
                    username=uname,
                    email=f"{uname}@w4.inhyma.local",
                    display_name=dname,
                    password_hash=pw_hash,
                    has_login=True,
                    is_active=is_active,
                    status=UserStatus.ACTIVE if is_active else UserStatus.INACTIVE,
                    manager_id=manager_id,
                )
                db.add(u)
                await db.flush()
                tracked["users"].append(u.id)
                for idx, r in enumerate(roles):
                    db.add(UserRole(user_id=u.id, role_id=r.id, status=RoleAssignmentStatus.ACTIVE, is_primary=(idx == 0)))
                return u

            u_sa = await mk_user(f"w4_sa_{tag}", "Wave4 SuperAdmin", [sa_role])
            u_mgr_a = await mk_user(f"w4_mgra_{tag}", "Wave4 Manager A", [dept_a, role_mgr])
            u_mgr_b = await mk_user(f"w4_mgrb_{tag}", "Wave4 Manager B", [dept_b, role_mgr])
            u_sp_a1 = await mk_user(f"w4_spa1_{tag}", "Wave4 Salesperson A1", [dept_a, role_sp], manager_id=u_mgr_a.id)
            u_sp_b1 = await mk_user(f"w4_spb1_{tag}", "Wave4 Salesperson B1", [dept_b, role_sp], manager_id=u_mgr_b.id)
            u_inactive = await mk_user(f"w4_inact_{tag}", "Wave4 Former Inactive", [dept_a, role_sp], is_active=False)
            u_denied = await mk_user(f"w4_den_{tag}", "Wave4 Denied User", [dept_a, role_mgr])

            db.add_all([
                DepartmentLeadershipAssignment(
                    department_id=dept_a.id, employee_id=u_mgr_a.id,
                    leadership_type=LeadershipType.DEPARTMENT_HEAD, is_primary=True, status=OrgRecordStatus.ACTIVE,
                ),
                DepartmentLeadershipAssignment(
                    department_id=dept_b.id, employee_id=u_mgr_b.id,
                    leadership_type=LeadershipType.DEPARTMENT_HEAD, is_primary=True, status=OrgRecordStatus.ACTIVE,
                ),
                UserPermission(user_id=u_denied.id, permission_id=perms["crm.leads.view"].id, is_granted=False),
            ])

            sessions: dict[uuid.UUID, str] = {}
            for usr in (u_sa, u_mgr_a, u_mgr_b, u_sp_a1, u_sp_b1, u_denied):
                sid = str(uuid.uuid4())
                db.add(AuthSession(id=uuid.UUID(sid), user_id=usr.id, refresh_token_jti=f"w4_{sid}", expires_at=_utcnow() + timedelta(hours=2)))
                sessions[usr.id] = sid

            # Companies for GSTIN & batch matching (strict 15-char Indian GSTIN format)
            comp_gst = Company(
                company_name=f"W4 GST Precision Systems {tag}",
                tax_id_number="29WAGST1234A1Z9",
                is_active=True,
            )
            comp_conflict = Company(
                company_name=f"W4 Conflict Corp {tag}",
                tax_id_number="27WACNF1111A1Z5",
                is_active=True,
            )
            comp_shared_1 = Company(company_name=f"W4 Batch Alpha {tag}", is_active=True)
            comp_shared_2 = Company(company_name=f"W4 Batch Beta {tag}", is_active=True)
            db.add_all([comp_gst, comp_conflict, comp_shared_1, comp_shared_2])
            await db.flush()
            tracked["companies"].extend([comp_gst.id, comp_conflict.id, comp_shared_1.id, comp_shared_2.id])

            # Products & UOMs for LM-DEF-026 & LM-DEF-027
            cat = ProductCategory(code=f"W4CAT{tag}", name=f"W4 Category {tag}", status=RecordStatus.ACTIVE)
            uom_kg = UnitOfMeasurement(code=f"W4KG{tag[:2]}", name=f"W4 Kilogram {tag}", short_name="KG", status=RecordStatus.ACTIVE)
            uom_set = UnitOfMeasurement(code=f"W4ST{tag[:2]}", name=f"W4 Set {tag}", short_name="SET", status=RecordStatus.ACTIVE)
            uom_inactive = UnitOfMeasurement(code=f"W4IN{tag[:2]}", name=f"W4 Legacy Drum {tag}", short_name="DRM", status=RecordStatus.INACTIVE)
            db.add_all([cat, uom_kg, uom_set, uom_inactive])
            await db.flush()
            tracked["categories"].append(cat.id)
            tracked["uoms"].extend([uom_kg.id, uom_set.id, uom_inactive.id])

            prod_kg = Product(
                product_code=f"W4-KG-{tag}",
                product_name=f"Wave4 Industrial Ink {tag}",
                product_name_tally=f"Wave4 Industrial Ink {tag}",
                category_id=cat.id,
                uom_id=uom_kg.id,
                standard_price=Decimal("1500.00"),
                is_sellable=True,
                status=RecordStatus.ACTIVE,
            )
            prod_set = Product(
                product_code=f"W4-SET-{tag}",
                product_name=f"Wave4 Pad Assembly {tag}",
                product_name_tally=f"Wave4 Pad Assembly {tag}",
                category_id=cat.id,
                uom_id=uom_set.id,
                standard_price=Decimal("12000.00"),
                is_sellable=True,
                status=RecordStatus.ACTIVE,
            )
            prod_inact_uom = Product(
                product_code=f"W4-DRM-{tag}",
                product_name=f"Wave4 Solvent Drum {tag}",
                product_name_tally=f"Wave4 Solvent Drum {tag}",
                category_id=cat.id,
                uom_id=uom_inactive.id,
                standard_price=Decimal("8500.00"),
                is_sellable=True,
                status=RecordStatus.ACTIVE,
            )
            db.add_all([prod_kg, prod_set, prod_inact_uom])
            await db.flush()
            tracked["products"].extend([prod_kg.id, prod_set.id, prod_inact_uom.id])

            # Pipeline & Stages (open, won, lost)
            pipe = CrmPipeline(name=f"W4 Pipeline {tag}", is_default=False, is_active=True, created_by=u_sa.id)
            db.add(pipe)
            await db.flush()
            tracked["pipelines"].append(pipe.id)

            st_open = CrmPipelineStage(pipeline_id=pipe.id, name="New", stage_order=1, stage_type="open", is_initial=True, is_active=True)
            st_qual = CrmPipelineStage(pipeline_id=pipe.id, name="Qualified", stage_order=2, stage_type="open", is_initial=False, is_active=True)
            st_won = CrmPipelineStage(pipeline_id=pipe.id, name="Won", stage_order=3, stage_type="won", is_initial=False, is_active=True)
            st_lost = CrmPipelineStage(pipeline_id=pipe.id, name="Lost", stage_order=4, stage_type="lost", is_initial=False, is_active=True)
            db.add_all([st_open, st_qual, st_won, st_lost])
            await db.flush()

            lead_base = CrmLead(
                lead_code=f"W4-BASE-{tag}",
                name="Wave4 Base Lead",
                original_phone=f"+9193100{tag}",
                normalized_phone=f"+9193100{tag}",
                pipeline_id=pipe.id,
                stage_id=st_open.id,
                assigned_to=u_sp_a1.id,
                created_by=u_mgr_a.id,
                status="new",
            )
            db.add(lead_base)
            await db.flush()
            tracked["leads"].append(lead_base.id)

            await db.commit()

        yield {
            "engine": engine,
            "SessionLocal": SessionLocal,
            "tracked": tracked,
            "tag": tag,
            "pipe": pipe,
            "st_open": st_open,
            "st_qual": st_qual,
            "st_won": st_won,
            "st_lost": st_lost,
            "comp_gst": comp_gst,
            "comp_conflict": comp_conflict,
            "comp_shared_1": comp_shared_1,
            "comp_shared_2": comp_shared_2,
            "uom_kg": uom_kg,
            "uom_set": uom_set,
            "uom_inactive": uom_inactive,
            "prod_kg": prod_kg,
            "prod_set": prod_set,
            "prod_inact_uom": prod_inact_uom,
            "u_sa": u_sa,
            "u_mgr_a": u_mgr_a,
            "u_mgr_b": u_mgr_b,
            "u_sp_a1": u_sp_a1,
            "u_sp_b1": u_sp_b1,
            "u_inactive": u_inactive,
            "u_denied": u_denied,
            "lead_base": lead_base,
            "hdr_sa": _auth_headers(u_sa, sessions[u_sa.id]),
            "hdr_mgr_a": _auth_headers(u_mgr_a, sessions[u_mgr_a.id]),
            "hdr_mgr_b": _auth_headers(u_mgr_b, sessions[u_mgr_b.id]),
            "hdr_sp_a1": _auth_headers(u_sp_a1, sessions[u_sp_a1.id]),
            "hdr_sp_b1": _auth_headers(u_sp_b1, sessions[u_sp_b1.id]),
            "hdr_denied": _auth_headers(u_denied, sessions[u_denied.id]),
        }
    finally:
        app.dependency_overrides.pop(get_db_session, None)
        async with SessionLocal() as db:
            # Find any additional leads/companies created during tests by our pipeline or tag
            extra_leads = list(
                (await db.execute(select(CrmLead.id).where(CrmLead.pipeline_id.in_(tracked["pipelines"])))).scalars().all()
            ) if tracked["pipelines"] else []
            all_lead_ids = list(set(tracked["leads"]) | set(extra_leads))

            extra_batches = list(
                (await db.execute(select(CrmImportBatch.id).where(CrmImportBatch.selected_pipeline_id.in_(tracked["pipelines"])))).scalars().all()
            ) if tracked["pipelines"] else []
            all_batch_ids = list(set(tracked["batches"]) | set(extra_batches))

            # Collect linked tasks before deleting follow-ups
            if all_lead_ids:
                fu_task_ids = list(
                    (await db.execute(select(CrmFollowUp.task_id).where(CrmFollowUp.lead_id.in_(all_lead_ids), CrmFollowUp.task_id.is_not(None)))).scalars().all()
                )
                tracked["tasks"].extend(fu_task_ids)
                q_ids = list(
                    (await db.execute(select(CrmSalesQuotation.id).where(CrmSalesQuotation.lead_id.in_(all_lead_ids)))).scalars().all()
                )
                all_q_ids = list(set(tracked["quotations"]) | set(q_ids))
                if all_q_ids:
                    await db.execute(delete(CrmQuotationVersion).where(CrmQuotationVersion.quotation_id.in_(all_q_ids)))
                    await db.execute(delete(CrmQuotationItem).where(CrmQuotationItem.quotation_id.in_(all_q_ids)))
                await db.execute(delete(CrmSalesQuotation).where(CrmSalesQuotation.lead_id.in_(all_lead_ids)))
                await db.execute(delete(CrmLeadProduct).where(CrmLeadProduct.lead_id.in_(all_lead_ids)))
                await db.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_(all_lead_ids)))
                await db.execute(delete(CrmFollowUp).where(CrmFollowUp.lead_id.in_(all_lead_ids)))
                await db.execute(delete(CrmStageHistory).where(CrmStageHistory.lead_id.in_(all_lead_ids)))
                await db.execute(delete(CrmAssignmentHistory).where(CrmAssignmentHistory.lead_id.in_(all_lead_ids)))

                # Track any auto-created companies from our leads
                lead_comp_ids = list(
                    (await db.execute(select(CrmLead.company_id).where(CrmLead.id.in_(all_lead_ids), CrmLead.company_id.is_not(None)))).scalars().all()
                )
                tracked["companies"].extend(lead_comp_ids)
                await db.execute(delete(CrmLead).where(CrmLead.id.in_(all_lead_ids)))

            if all_batch_ids:
                await db.execute(delete(CrmAssignmentHistory).where(CrmAssignmentHistory.batch_id.in_(all_batch_ids)))
                await db.execute(delete(CrmImportBatch).where(CrmImportBatch.id.in_(all_batch_ids)))

            if tracked["tasks"]:
                tids = list(set(tracked["tasks"]))
                await db.execute(delete(TaskComment).where(TaskComment.task_id.in_(tids)))
                await db.execute(delete(TaskAssignee).where(TaskAssignee.task_id.in_(tids)))
                await db.execute(delete(Task).where(Task.id.in_(tids)))

            if tracked["users"]:
                cfg_ids = list((await db.execute(select(CrmSalespersonConfig.id).where(CrmSalespersonConfig.user_id.in_(tracked["users"])))).scalars().all())
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
            if tracked["companies"]:
                cids = list(set(tracked["companies"]))
                await db.execute(delete(Company).where(Company.id.in_(cids)))
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
async def test_lm_def_022_csv_company_matching_batched_no_n_plus_1(wave4_env):
    env = wave4_env
    tag = env["tag"]

    # Build a 120-row CSV referencing repeated existing companies + distinct new companies + blank company
    lines = ["Name,Number,Campaign,Priority,Company"]
    for i in range(120):
        phone = f"94{tag[:3]}{i:05d}"
        if i % 4 == 0:
            comp = env["comp_shared_1"].company_name
        elif i % 4 == 1:
            comp = env["comp_shared_2"].company_name
        elif i % 4 == 2:
            comp = f"W4 Distinct NewCo {tag} {i % 15}"
        else:
            comp = ""
        lines.append(f"Batch Contact {i},{phone},W4_Perf_Camp,medium,{comp}")
    csv_bytes = "\n".join(lines).encode("utf-8")

    query_count = 0

    def _count_sql(conn, cursor, statement, parameters, context, executemany):
        nonlocal query_count
        query_count += 1

    event.listen(env["engine"].sync_engine, "before_cursor_execute", _count_sql)
    try:
        async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
            # Preview 120 rows: batched company lookup must execute far fewer than O(N) queries!
            query_count = 0
            r_prev = await client.post(
                "/api/v1/crm/import/preview",
                data={"pipeline_id": str(env["pipe"].id)},
                files={"file": ("batch_120.csv", csv_bytes, "text/csv")},
                headers=env["hdr_sa"],
            )
            prev_queries = query_count
            assert r_prev.status_code == 200, r_prev.text
            prev_data = r_prev.json()["data"]
            assert prev_data["valid_candidate_count"] == 120
            # Under N+1, 120 rows with 90 company values would run ~185+ queries. Batched must stay <= 25!
            assert prev_queries <= 25, f"LM-DEF-022 REPRO: 120-row CSV preview ran {prev_queries} SQL queries (N+1)!"

            # Confirm 120 rows (distribution_mode=none): company lookups must not re-fire per row!
            query_count = 0
            r_conf = await client.post(
                "/api/v1/crm/import/confirm",
                data={"pipeline_id": str(env["pipe"].id), "auto_assign": "false", "distribution_mode": "none"},
                files={"file": ("batch_120.csv", csv_bytes, "text/csv")},
                headers=env["hdr_sa"],
            )
            assert r_conf.status_code == 201, r_conf.text
            conf_data = r_conf.json()["data"]
            assert conf_data["success_count"] == 120
            # Check exact company matching accuracy
            matched_c1 = sum(1 for r in conf_data["row_results"] if r["company_id"] == str(env["comp_shared_1"].id))
            matched_c2 = sum(1 for r in conf_data["row_results"] if r["company_id"] == str(env["comp_shared_2"].id))
            assert matched_c1 == 30 and matched_c2 == 30
    finally:
        event.remove(env["engine"].sync_engine, "before_cursor_execute", _count_sql)


@pytest.mark.asyncio(loop_scope="module")
async def test_lm_def_023_gstin_company_matching_integration(wave4_env):
    env = wave4_env
    tag = env["tag"]
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        # 1. Manual lead with different company name but exact valid GSTIN (lowercase + spaces) -> links comp_gst!
        r_gst = await client.post(
            "/api/v1/crm/leads",
            json={
                "contact_name": "GST Linked Lead",
                "phone": f"+9195100{tag}",
                "company_name": "Completely Different Brand Label",
                "pipeline_id": str(env["pipe"].id),
                "custom_fields": {"gstin": "  29wagst1234a1z9  "},
            },
            headers=env["hdr_sa"],
        )
        assert r_gst.status_code == 201, r_gst.text
        d_gst = r_gst.json()["data"]
        assert d_gst["company_id"] == str(env["comp_gst"].id), (
            f"LM-DEF-023 REPRO: GSTIN failed to link existing company (got {d_gst['company_id']} / {d_gst['company_name']})"
        )

        # 2. Same company name as comp_conflict, but DIFFERENT valid GSTIN -> must NOT merge silently (409 Conflict)!
        r_cnf = await client.post(
            "/api/v1/crm/leads",
            json={
                "contact_name": "GST Conflict Lead",
                "phone": f"+9195101{tag}",
                "company_name": env["comp_conflict"].company_name,
                "pipeline_id": str(env["pipe"].id),
                "custom_fields": {"gstin": "29DIFCO1234A1Z8"},
            },
            headers=env["hdr_sa"],
        )
        assert r_cnf.status_code in (400, 409), f"Expected conflict/error for same name + different GSTIN, got {r_cnf.status_code} {r_cnf.text}"

        # 3. Malformed GSTIN on manual lead -> controlled 400/422 (never merges!)
        r_bad = await client.post(
            "/api/v1/crm/leads",
            json={
                "contact_name": "Bad GST Lead",
                "phone": f"+9195102{tag}",
                "company_name": f"BadGSTCo {tag}",
                "pipeline_id": str(env["pipe"].id),
                "custom_fields": {"gstin": "NOT-A-VALID-GST"},
            },
            headers=env["hdr_sa"],
        )
        assert r_bad.status_code in (400, 422), f"Expected 400/422 for malformed GSTIN, got {r_bad.status_code}"

        # 4. CSV import with GSTIN column: exact match, lowercase match, invalid GSTIN, duplicate GSTIN in file
        csv_text = "\n".join([
            "Name,Number,Campaign,Company,GSTIN",
            f"CSV GST Exact,95200{tag},GST_Camp,Unrelated Name,29WAGST1234A1Z9",
            f"CSV GST Lower,95201{tag},GST_Camp,Another Alias,  29wagst1234a1z9 ",
            f"CSV GST Bad,95202{tag},GST_Camp,BadCo,INVALID123",
            f"CSV GST Conflict,95203{tag},GST_Camp,{env['comp_conflict'].company_name},24OTHER9999A1Z2",
            f"CSV GST New1,95204{tag},GST_Camp,W4 Fresh GST Corp {tag},27WANEW1234A1Z1",
            f"CSV GST New2,95205{tag},GST_Camp,W4 Fresh GST Corp {tag},27WANEW1234A1Z1",
        ]).encode("utf-8")

        r_cp = await client.post(
            "/api/v1/crm/import/preview",
            data={"pipeline_id": str(env["pipe"].id)},
            files={"file": ("gst.csv", csv_text, "text/csv")},
            headers=env["hdr_sa"],
        )
        assert r_cp.status_code == 200, r_cp.text
        rows_by_name = {r["name"]: r for r in r_cp.json()["data"]["rows"]}
        assert rows_by_name["CSV GST Exact"]["company_id"] == str(env["comp_gst"].id)
        assert rows_by_name["CSV GST Lower"]["company_id"] == str(env["comp_gst"].id)
        assert rows_by_name["CSV GST Bad"]["status"] == "INVALID"
        assert rows_by_name["CSV GST Conflict"]["status"] == "INVALID"

        r_cc = await client.post(
            "/api/v1/crm/import/confirm",
            data={"pipeline_id": str(env["pipe"].id), "auto_assign": "false", "distribution_mode": "none"},
            files={"file": ("gst.csv", csv_text, "text/csv")},
            headers=env["hdr_sa"],
        )
        assert r_cc.status_code == 201, r_cc.text
        c_rows = {r["name"]: r for r in r_cc.json()["data"]["row_results"]}
        assert c_rows["CSV GST Exact"]["company_id"] == str(env["comp_gst"].id)
        assert c_rows["CSV GST New1"]["company_id"] is not None
        assert c_rows["CSV GST New1"]["company_id"] == c_rows["CSV GST New2"]["company_id"]


@pytest.mark.asyncio(loop_scope="module")
async def test_lm_def_025_email_format_validation(wave4_env):
    env = wave4_env
    tag = env["tag"]
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        # Invalid emails rejected with 422 on manual create
        for idx, bad_email in enumerate(["not-an-email", "missingdomain@", "@nodomain.com", "a@@b.com", "a b@example.com", "user@nodot"]):
            r_bad = await client.post(
                "/api/v1/crm/leads",
                json={
                    "contact_name": f"Bad Email {idx}",
                    "phone": f"+919530{idx}{tag[:5]}",
                    "email": bad_email,
                    "pipeline_id": str(env["pipe"].id),
                },
                headers=env["hdr_sa"],
            )
            assert r_bad.status_code == 422, f"LM-DEF-025 REPRO: Invalid email {bad_email!r} accepted with {r_bad.status_code}"

        # Valid email with subdomain + mixed-case local part + surrounding whitespace -> local part preserved!
        r_ok = await client.post(
            "/api/v1/crm/leads",
            json={
                "contact_name": "Valid Email Lead",
                "phone": f"+9195390{tag}",
                "email": "  Alice.Smith+CRM@Sub.Example.CO.IN  ",
                "pipeline_id": str(env["pipe"].id),
            },
            headers=env["hdr_sa"],
        )
        assert r_ok.status_code == 201, r_ok.text
        created = r_ok.json()["data"]
        assert created["email"] == "Alice.Smith+CRM@sub.example.co.in", f"Unexpected email normalization: {created['email']}"

        # Invalid email rejected on PATCH update
        r_upd_bad = await client.patch(
            f"/api/v1/crm/leads/{created['id']}",
            json={"email": "still-not-valid"},
            headers=env["hdr_sa"],
        )
        assert r_upd_bad.status_code == 422

        # Optional blank email allowed
        r_blank = await client.post(
            "/api/v1/crm/leads",
            json={
                "contact_name": "Blank Email Lead",
                "phone": f"+9195391{tag}",
                "email": "   ",
                "pipeline_id": str(env["pipe"].id),
            },
            headers=env["hdr_sa"],
        )
        assert r_blank.status_code == 201
        assert r_blank.json()["data"]["email"] is None

        # CSV import optional Email validation
        csv_email = "\n".join([
            "Name,Number,Campaign,Email",
            f"CSV Valid Email,95400{tag},EmailCamp,Valid.User@sub.example.com",
            f"CSV Blank Email,95401{tag},EmailCamp,",
            f"CSV Bad Email,95402{tag},EmailCamp,not-an-email",
        ]).encode("utf-8")
        r_ep = await client.post(
            "/api/v1/crm/import/preview",
            data={"pipeline_id": str(env["pipe"].id)},
            files={"file": ("emails.csv", csv_email, "text/csv")},
            headers=env["hdr_sa"],
        )
        assert r_ep.status_code == 200
        e_rows = {r["name"]: r for r in r_ep.json()["data"]["rows"]}
        assert e_rows["CSV Valid Email"]["status"] == "VALID"
        assert e_rows["CSV Blank Email"]["status"] == "VALID"
        assert e_rows["CSV Bad Email"]["status"] == "INVALID"


@pytest.mark.asyncio(loop_scope="module")
async def test_lm_def_026_actual_product_uom_in_quotation_lookup(wave4_env):
    env = wave4_env
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        # Product lookup returns actual UOM code/short_name from units_of_measurement (NOT hardcoded "Nos"!)
        r_kg = await client.get(f"/api/v1/crm/products/lookup?q={env['prod_kg'].product_code}", headers=env["hdr_sp_a1"])
        assert r_kg.status_code == 200, r_kg.text
        kg_item = next(i for i in r_kg.json()["data"]["items"] if i["id"] == str(env["prod_kg"].id))
        assert kg_item["uom"] == env["uom_kg"].code, f"LM-DEF-026 REPRO: Expected UOM {env['uom_kg'].code!r}, got {kg_item['uom']!r}"

        r_set = await client.get(f"/api/v1/crm/products/lookup?q={env['prod_set'].product_code}", headers=env["hdr_sp_a1"])
        assert r_set.status_code == 200
        set_item = next(i for i in r_set.json()["data"]["items"] if i["id"] == str(env["prod_set"].id))
        assert set_item["uom"] == env["uom_set"].code

        # Product with inactive UOM still resolves its stored UOM cleanly
        r_inact = await client.get(f"/api/v1/crm/products/lookup?q={env['prod_inact_uom'].product_code}", headers=env["hdr_sp_a1"])
        assert r_inact.status_code == 200
        inact_item = next(i for i in r_inact.json()["data"]["items"] if i["id"] == str(env["prod_inact_uom"].id))
        assert inact_item["uom"] == env["uom_inactive"].code

        # Associate product & list_lead_products also return actual UOM
        r_assoc = await client.post(
            f"/api/v1/crm/leads/{env['lead_base'].id}/products",
            json={"product_id": str(env["prod_kg"].id)},
            headers=env["hdr_sp_a1"],
        )
        assert r_assoc.status_code == 201, r_assoc.text
        assert r_assoc.json()["data"]["uom"] == env["uom_kg"].code

        r_lp = await client.get(f"/api/v1/crm/leads/{env['lead_base'].id}/products", headers=env["hdr_sp_a1"])
        assert r_lp.status_code == 200
        lp_kg = next(i for i in r_lp.json()["data"]["items"] if i["product_id"] == str(env["prod_kg"].id))
        assert lp_kg["uom"] == env["uom_kg"].code

        # Unauthorized lookup blocked
        assert (await client.get("/api/v1/crm/products/lookup", headers=env["hdr_denied"])).status_code == 403

        # Multi-line quotation with omitted line uom defaults to actual product UOM (NOT hardcoded "Nos"!)
        r_q = await client.post(
            f"/api/v1/crm/leads/{env['lead_base'].id}/quotations",
            json={
                "currency": "INR",
                "items": [
                    {"product_id": str(env["prod_kg"].id), "quantity": 2, "unit_price": 1500, "tax_rate": 18},
                    {"product_id": str(env["prod_set"].id), "quantity": 1, "unit_price": 12000, "tax_rate": 18},
                ],
            },
            headers=env["hdr_sp_a1"],
        )
        assert r_q.status_code == 201, r_q.text
        q_data = r_q.json()["data"]
        uoms_by_prod = {it["product_id"]: it["uom"] for it in q_data["items"]}
        assert uoms_by_prod[str(env["prod_kg"].id)] == env["uom_kg"].code
        assert uoms_by_prod[str(env["prod_set"].id)] == env["uom_set"].code
        # Verify PDF renders cleanly with actual UOMs
        r_pdf = await client.get(f"/api/v1/crm/quotations/{q_data['id']}/pdf", headers=env["hdr_sp_a1"])
        assert r_pdf.status_code == 200 and r_pdf.content.startswith(b"%PDF")


@pytest.mark.asyncio(loop_scope="module")
async def test_lm_def_027_quotation_activity_currency(wave4_env):
    env = wave4_env
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        # Create USD quotation (Decimal precision: 333.57 * 1.18 = 393.6126 -> 393.61)
        r_usd = await client.post(
            f"/api/v1/crm/leads/{env['lead_base'].id}/quotations",
            json={
                "currency": "USD",
                "items": [
                    {"product_id": str(env["prod_kg"].id), "quantity": 1, "unit_price": "333.57", "tax_rate": "18"},
                ],
            },
            headers=env["hdr_sp_a1"],
        )
        assert r_usd.status_code == 201, r_usd.text
        q_usd = r_usd.json()["data"]
        q_num = q_usd["quotation_number"]
        assert q_usd["currency"] == "USD"
        assert Decimal(str(q_usd["total_amount"])) == Decimal("393.61")

        # Update / create revision in USD
        r_rev = await client.patch(
            f"/api/v1/crm/quotations/{q_usd['id']}",
            json={
                "currency": "USD",
                "create_revision": True,
                "revision_notes": "Updated export pricing",
                "items": [
                    {"product_id": str(env["prod_kg"].id), "quantity": 2, "unit_price": "500.00", "tax_rate": "0"},
                ],
            },
            headers=env["hdr_sp_a1"],
        )
        assert r_rev.status_code == 200, r_rev.text

        # Inspect logged activities on lead_base
        r_acts = await client.get(f"/api/v1/crm/leads/{env['lead_base'].id}/activities?page_size=50", headers=env["hdr_sp_a1"])
        assert r_acts.status_code == 200
        q_acts = [a for a in r_acts.json()["data"]["items"] if q_num in (a.get("subject") or "")]
        create_act = next(a for a in q_acts if a["activity_type"] == "quotation_created")
        update_act = next(a for a in q_acts if a["activity_type"] == "quotation_updated")

        assert "393.61 USD" in create_act["subject"], f"LM-DEF-027 REPRO: create subject hardcoded INR: {create_act['subject']}"
        assert "INR" not in create_act["subject"]
        assert "1,000.00 USD" in update_act["subject"], f"LM-DEF-027 REPRO: update subject hardcoded INR: {update_act['subject']}"
        assert "INR" not in update_act["subject"]


@pytest.mark.asyncio(loop_scope="module")
async def test_lm_def_028_follow_up_timeline_actor_identity(wave4_env):
    env = wave4_env
    tag = env["tag"]
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        # Create dedicated lead assigned to sp_a1
        r_ld = await client.post(
            "/api/v1/crm/leads",
            json={
                "contact_name": "Timeline Actor Lead",
                "phone": f"+9195500{tag}",
                "pipeline_id": str(env["pipe"].id),
                "assigned_to": str(env["u_sp_a1"].id),
            },
            headers=env["hdr_mgr_a"],
        )
        assert r_ld.status_code == 201, r_ld.text
        lid = r_ld.json()["data"]["id"]

        due_iso = (_utcnow() + timedelta(days=1)).isoformat()

        # 1. Pending follow-up created by Manager A, assigned to Salesperson A1 -> actor MUST be Manager A!
        r_fu1 = await client.post(
            f"/api/v1/crm/leads/{lid}/follow-ups",
            json={"follow_up_type": "call", "due_at": due_iso, "assigned_to": str(env["u_sp_a1"].id), "notes": "Pending_By_MgrA"},
            headers=env["hdr_mgr_a"],
        )
        assert r_fu1.status_code == 201, r_fu1.text
        fu1_id = r_fu1.json()["data"]["id"]

        # 2. Follow-up created by Manager A, COMPLETED by Salesperson A1 -> actor MUST be Salesperson A1!
        r_fu2 = await client.post(
            f"/api/v1/crm/leads/{lid}/follow-ups",
            json={"follow_up_type": "email", "due_at": due_iso, "assigned_to": str(env["u_sp_a1"].id), "notes": "Completed_By_SpA1"},
            headers=env["hdr_mgr_a"],
        )
        assert r_fu2.status_code == 201
        fu2_id = r_fu2.json()["data"]["id"]
        assert (await client.patch(f"/api/v1/crm/follow-ups/{fu2_id}/status", json={"status": "completed"}, headers=env["hdr_sp_a1"])).status_code == 200

        # 3. Follow-up created by Salesperson A1, CANCELLED by Manager A -> actor MUST be Manager A!
        r_fu3 = await client.post(
            f"/api/v1/crm/leads/{lid}/follow-ups",
            json={"follow_up_type": "meeting", "due_at": due_iso, "assigned_to": str(env["u_sp_a1"].id), "notes": "Cancelled_By_MgrA"},
            headers=env["hdr_sp_a1"],
        )
        assert r_fu3.status_code == 201
        fu3_id = r_fu3.json()["data"]["id"]
        assert (await client.patch(f"/api/v1/crm/follow-ups/{fu3_id}/status", json={"status": "cancelled"}, headers=env["hdr_mgr_a"])).status_code == 200

        # 4. Historical follow-up created by inactive actor + one with missing creator (created_by=None)
        async with env["SessionLocal"]() as db:
            fu_inact = CrmFollowUp(
                lead_id=uuid.UUID(lid),
                assigned_to=env["u_sp_a1"].id,
                created_by=env["u_inactive"].id,
                follow_up_type="whatsapp",
                due_at=_utcnow() + timedelta(days=2),
                status="pending",
                notes="Created_By_Inactive",
            )
            fu_none = CrmFollowUp(
                lead_id=uuid.UUID(lid),
                assigned_to=env["u_sp_a1"].id,
                created_by=None,
                follow_up_type="demo",
                due_at=_utcnow() + timedelta(days=3),
                status="pending",
                notes="Created_By_None",
            )
            db.add_all([fu_inact, fu_none])
            await db.commit()
            fu_inact_id, fu_none_id = str(fu_inact.id), str(fu_none.id)

        # Fetch unified timeline
        r_tl = await client.get(f"/api/v1/crm/leads/{lid}/timeline", headers=env["hdr_mgr_a"])
        assert r_tl.status_code == 200, r_tl.text
        tl_by_id = {it["id"]: it for it in r_tl.json()["data"]["items"] if it["timeline_type"] == "follow_up"}

        # Check 1: Pending by Manager A
        assert tl_by_id[fu1_id]["actor_id"] == str(env["u_mgr_a"].id)
        assert tl_by_id[fu1_id]["actor_name"] == "Wave4 Manager A", (
            f"LM-DEF-028 REPRO: actor_id={tl_by_id[fu1_id]['actor_id']} mismatched actor_name={tl_by_id[fu1_id]['actor_name']!r}"
        )

        # Check 2: Completed by Salesperson A1
        assert tl_by_id[fu2_id]["actor_id"] == str(env["u_sp_a1"].id)
        assert tl_by_id[fu2_id]["actor_name"] == "Wave4 Salesperson A1"

        # Check 3: Cancelled by Manager A
        assert tl_by_id[fu3_id]["actor_id"] == str(env["u_mgr_a"].id)
        assert tl_by_id[fu3_id]["actor_name"] == "Wave4 Manager A"

        # Check 4: Inactive actor preserved; missing creator returns None (NOT assignee!)
        assert tl_by_id[fu_inact_id]["actor_id"] == str(env["u_inactive"].id)
        assert tl_by_id[fu_inact_id]["actor_name"] == "Wave4 Former Inactive"
        assert tl_by_id[fu_none_id]["actor_id"] is None
        assert tl_by_id[fu_none_id]["actor_name"] is None

        # Cross-dept timeline remains 403
        assert (await client.get(f"/api/v1/crm/leads/{lid}/timeline", headers=env["hdr_mgr_b"])).status_code == 403


@pytest.mark.asyncio(loop_scope="module")
async def test_lm_def_029_duplicate_csv_headers_and_formula_sanitization(wave4_env):
    env = wave4_env
    tag = env["tag"]
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        # A. Duplicate CSV headers rejected with 400 (exact, case-different, whitespace-different, alias conflict)
        dup_csvs = [
            b"Name,Number,Campaign,Name\nAlice,9610000001,CampA,Overwritten\n",
            b"name,Number,Campaign,NAME\nAlice,9610000001,CampA,Overwritten\n",
            b"Name,Number,Campaign,  Name  \nAlice,9610000001,CampA,Overwritten\n",
            b"Name,Contact Name,Number,Campaign\nAlice,Bob,9610000001,CampA\n",
        ]
        for idx, raw in enumerate(dup_csvs):
            r = await client.post(
                "/api/v1/crm/import/preview",
                data={"pipeline_id": str(env["pipe"].id)},
                files={"file": (f"dup_{idx}.csv", raw, "text/csv")},
                headers=env["hdr_sa"],
            )
            assert r.status_code == 400, f"LM-DEF-029(A) REPRO: Duplicate header CSV #{idx} returned {r.status_code} instead of 400"
            assert "duplicate" in r.text.lower()

        # Valid alias + extra unknown column still succeeds
        ok_alias = f"Contact Name,Phone Number,Campaign,ExtraCol\nAlias Person,96110{tag},AliasCamp,Ignored\n".encode("utf-8")
        r_alias = await client.post(
            "/api/v1/crm/import/preview",
            data={"pipeline_id": str(env["pipe"].id)},
            files={"file": ("alias.csv", ok_alias, "text/csv")},
            headers=env["hdr_sa"],
        )
        assert r_alias.status_code == 200 and r_alias.json()["data"]["valid_candidate_count"] == 1

        # B. Manual lead formula sanitization (POST & PATCH) + non-double-prefixing + preserving phones & negative numbers
        r_f = await client.post(
            "/api/v1/crm/leads",
            json={
                "contact_name": "=HYPERLINK(\"http://evil.test\",\"Click\")",
                "phone": f"+9196200{tag}",
                "company_name": f"  @SUM(1+1) Corp {tag}",
                "campaign": "+CMD|' /C calc'!A0",
                "source_detail": "=1+2+3",
                "notes": "-2+3+cmd|' /C calc'!A0",
                "pipeline_id": str(env["pipe"].id),
            },
            headers=env["hdr_sa"],
        )
        assert r_f.status_code == 201, r_f.text
        fd = r_f.json()["data"]
        assert fd["name"].startswith("'="), f"LM-DEF-029(B) REPRO: Manual lead stored raw formula name={fd['name']!r}"
        assert fd["company_name"].startswith("'@"), f"LM-DEF-029(B) REPRO: Manual lead stored raw formula company={fd['company_name']!r}"
        assert fd["campaign"].startswith("'+"), f"LM-DEF-029(B) REPRO: Manual lead stored raw formula campaign={fd['campaign']!r}"
        assert fd["source_detail"].startswith("'="), f"LM-DEF-029(B) REPRO: Manual lead stored raw formula source_detail={fd['source_detail']!r}"
        # Verify DB-persisted notes column is also neutralized
        async with env["SessionLocal"]() as db:
            db_lead = await db.get(CrmLead, uuid.UUID(fd["id"]))
            assert db_lead is not None and (db_lead.notes or "").startswith("'-"), (
                f"LM-DEF-029(B) REPRO: Manual lead stored raw formula notes={getattr(db_lead, 'notes', None)!r}"
            )
        # Legitimate phone preserved without quote prefix!
        assert fd["original_phone"] == f"+9196200{tag}"
        assert fd["normalized_phone"] == f"+9196200{tag}"

        # PATCH with already-sanitized formula must NOT double-prefix; pure negative number preserved
        r_fp = await client.patch(
            f"/api/v1/crm/leads/{fd['id']}",
            json={
                "name": fd["name"],
                "notes": "-150.25",
                "campaign": "\t=1+1",
            },
            headers=env["hdr_sa"],
        )
        assert r_fp.status_code == 200, r_fp.text
        fpd = r_fp.json()["data"]
        assert not fpd["name"].startswith("''="), f"Double-prefixed sanitized value: {fpd['name']!r}"
        assert fpd["campaign"].startswith("'="), f"Leading tab before formula not neutralized: {fpd['campaign']!r}"
        async with env["SessionLocal"]() as db:
            db_lead_upd = await db.get(CrmLead, uuid.UUID(fd["id"]))
            assert db_lead_upd is not None and db_lead_upd.notes == "-150.25", (
                f"Corrupted legitimate negative number: {getattr(db_lead_upd, 'notes', None)!r}"
            )

        # Export helper sanitize_csv_cell preserves safe values & never double-prefixes
        assert sanitize_csv_cell("=SUM(A1:A2)") == "'=SUM(A1:A2)"
        assert sanitize_csv_cell("'=SUM(A1:A2)") == "'=SUM(A1:A2)"
        assert sanitize_csv_cell("+919876543210") == "+919876543210"
        assert sanitize_csv_cell("-42.5") == "-42.5"
        assert sanitize_csv_cell("  =CMD|test") == "'=CMD|test"


@pytest.mark.asyncio(loop_scope="module")
async def test_lm_def_030_direct_lost_stage_lost_reason_validation(wave4_env):
    env = wave4_env
    tag = env["tag"]
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        # 1. Direct POST /crm/leads into lost stage WITHOUT lost_reason -> rejected 400!
        r_no_reason = await client.post(
            "/api/v1/crm/leads",
            json={
                "contact_name": "Direct Lost Missing Reason",
                "phone": f"+9196300{tag}",
                "pipeline_id": str(env["pipe"].id),
                "stage_id": str(env["st_lost"].id),
            },
            headers=env["hdr_sa"],
        )
        assert r_no_reason.status_code == 400, (
            f"LM-DEF-030 REPRO: Direct lost-stage create without lost_reason returned {r_no_reason.status_code}"
        )

        # 2. Direct POST /crm/leads into lost stage with short lost_reason ("no") -> rejected 400!
        r_short = await client.post(
            "/api/v1/crm/leads",
            json={
                "contact_name": "Direct Lost Short Reason",
                "phone": f"+9196301{tag}",
                "pipeline_id": str(env["pipe"].id),
                "stage_id": str(env["st_lost"].id),
                "lost_reason": "no",
            },
            headers=env["hdr_sa"],
        )
        assert r_short.status_code == 400

        # 3. Direct POST /crm/leads into lost stage WITH valid lost_reason -> 201 + persists lost_reason!
        r_ok_lost = await client.post(
            "/api/v1/crm/leads",
            json={
                "contact_name": "Direct Lost Valid Reason",
                "phone": f"+9196302{tag}",
                "pipeline_id": str(env["pipe"].id),
                "stage_id": str(env["st_lost"].id),
                "lost_reason": "Customer selected local competitor",
            },
            headers=env["hdr_sa"],
        )
        assert r_ok_lost.status_code == 201, r_ok_lost.text
        lost_lead = r_ok_lost.json()["data"]
        assert lost_lead["status"] == "lost"
        assert lost_lead["lost_reason"] == "Customer selected local competitor"

        # 4. Unrelated PATCH update on existing lost lead preserves lost_reason
        r_upd = await client.patch(
            f"/api/v1/crm/leads/{lost_lead['id']}",
            json={"notes": "Post-mortem recorded"},
            headers=env["hdr_sa"],
        )
        assert r_upd.status_code == 200
        assert r_upd.json()["data"]["lost_reason"] == "Customer selected local competitor"

        # 5. Transition from lost -> open clears lost_reason; transition back to lost without reason -> 400; with reason -> 200
        r_reopen = await client.post(
            f"/api/v1/crm/leads/{lost_lead['id']}/stage",
            json={"stage_id": str(env["st_qual"].id), "reason": "Customer re-engaged"},
            headers=env["hdr_sa"],
        )
        assert r_reopen.status_code == 200
        assert r_reopen.json()["data"]["lost_reason"] is None

        r_relost_bad = await client.post(
            f"/api/v1/crm/leads/{lost_lead['id']}/stage",
            json={"stage_id": str(env["st_lost"].id)},
            headers=env["hdr_sa"],
        )
        assert r_relost_bad.status_code == 400

        r_relost_ok = await client.post(
            f"/api/v1/crm/leads/{lost_lead['id']}/stage",
            json={"stage_id": str(env["st_lost"].id), "lost_reason": "Price gap unresolved"},
            headers=env["hdr_sa"],
        )
        assert r_relost_ok.status_code == 200
        assert r_relost_ok.json()["data"]["lost_reason"] == "Price gap unresolved"

        # 6. Cross-dept / denied user blocked on stage transition -> 403
        assert (
            await client.post(
                f"/api/v1/crm/leads/{env['lead_base'].id}/stage",
                json={"stage_id": str(env["st_lost"].id), "lost_reason": "Unauthorized attempt"},
                headers=env["hdr_mgr_b"],
            )
        ).status_code == 403
        assert (
            await client.post(
                f"/api/v1/crm/leads/{env['lead_base'].id}/stage",
                json={"stage_id": str(env["st_lost"].id), "lost_reason": "Denied attempt"},
                headers=env["hdr_denied"],
            )
        ).status_code == 403
