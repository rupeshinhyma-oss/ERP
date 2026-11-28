"""
INHYMA ERP — LEAD MANAGEMENT PHASE 2 / WAVE 2 RELIABILITY & CONCURRENCY SUITE (PostgreSQL 18)

Reproduces and verifies the 7 authorized Wave 2 audit defects:
- LM-DEF-006: Concurrent CSV import phone-number race (sorted advisory locks + savepoint fallback)
- LM-DEF-007: Pipeline default-selection PostgreSQL deadlock (global lock ordering + partial unique index)
- LM-DEF-010: Legacy follow-up bulk-delete HTTP 500 (SoftDeleteMixin read-only is_deleted)
- LM-DEF-011: Legacy lead/follow-up date-filter HTTP 500 (asyncpg Date parameter typing)
- LM-DEF-021: Legacy lead/follow-up invalid sort_by HTTP 500 (allowlist + sort_dir validation)
- LM-DEF-015: CRM follow-up state machine & concurrency (FOR UPDATE + terminal guards + idempotency)
- LM-DEF-016: CRM quotation status state machine (allowed transition map + terminal guards + idempotency)

Runs strictly against isolated local PostgreSQL 18 (`inhyma_test_db`) using independent
database sessions per concurrent request and cleans up 100% of synthetic test records in `finally`.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://postgres:root@127.0.0.1:5432/inhyma_test_db",
)

pytestmark = [pytest.mark.asyncio, pytest.mark.postgres]

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
from app.follow_ups.models import FollowUp
from app.follow_ups.repository import FollowUpRepository
from app.leads.models import Lead
from app.leads.repository import LeadRepository
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
async def wave2_env():
    """Provision isolated personas, roles, pipelines, product & companies on PG18 and clean up 100%."""
    engine = create_async_engine(TEST_DB_URL, echo=False, pool_size=25, max_overflow=25)
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
    # Distinct 6-digit phone stem for this test invocation
    p_base = str((int(tag, 16) % 799999) + 100000)

    tracked: dict[str, list[uuid.UUID]] = {
        "users": [],
        "roles": [],
        "perms": [],
        "companies": [],
        "products": [],
        "categories": [],
        "uoms": [],
        "pipelines": [],
        "legacy_leads": [],
        "legacy_follow_ups": [],
    }

    async with SessionLocal() as db:
        needed_codes = [
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
        perms: dict[str, Permission] = {}
        for code in needed_codes:
            p = (await db.execute(select(Permission).where(Permission.code == code))).scalar_one_or_none()
            if not p:
                p = Permission(code=code, module=code.split(".")[0], action=code.split(".")[-1], description=f"Wave2 {code}")
                db.add(p)
                await db.flush()
                tracked["perms"].append(p.id)
            perms[code] = p

        async def _get_or_create_role(name: str, is_system: bool = False) -> Role:
            r = (await db.execute(select(Role).where(Role.name == name, Role.deleted_at.is_(None)))).scalar_one_or_none()
            if not r:
                r = Role(name=name, code=f"W2_{uuid.uuid4().hex[:8].upper()}", description=f"Wave2 {name}", is_system=is_system)
                db.add(r)
                await db.flush()
                tracked["roles"].append(r.id)
            return r

        r_admin = await _get_or_create_role("admin", is_system=True)
        r_dept_a = await _get_or_create_role(f"W2_DeptA_{tag}")
        r_dept_b = await _get_or_create_role(f"W2_DeptB_{tag}")
        r_mgr = await _get_or_create_role(f"w2_sales_manager_{tag}")
        r_sp = await _get_or_create_role(f"w2_salesperson_{tag}")

        mgr_codes = [
            "crm.leads.view", "crm.leads.manage", "crm.leads.import", "crm.pipelines.view",
            "crm.distribution.view", "crm.distribution.manage",
            "task.view", "task.create", "task.update",
        ]
        sp_codes = [
            "crm.leads.view", "crm.leads.import", "crm.pipelines.view",
            "task.view", "task.create", "task.update",
        ]
        for code in mgr_codes:
            db.add(RolePermission(role_id=r_mgr.id, permission_id=perms[code].id))
        for code in sp_codes:
            db.add(RolePermission(role_id=r_sp.id, permission_id=perms[code].id))
        await db.flush()

        pw = hash_password("Wave2Pass!123")

        async def _mk_user(uname: str, full: str, mgr_id: uuid.UUID | None = None) -> User:
            u = User(
                username=f"w2_{uname}_{tag}",
                email=f"w2_{uname}_{tag}@inhyma.test",
                password_hash=pw,
                display_name=full,
                is_active=True,
                has_login=True,
                status=UserStatus.ACTIVE,
                manager_id=mgr_id,
            )
            db.add(u)
            await db.flush()
            tracked["users"].append(u.id)
            return u

        u_admin = await _mk_user("admin", f"W2 Admin {tag}")
        u_mgr_a = await _mk_user("mgr_a", f"W2 MgrA {tag}")
        u_mgr_b = await _mk_user("mgr_b", f"W2 MgrB {tag}")
        u_sp_a1 = await _mk_user("sp_a1", f"W2 RepA1 {tag}", mgr_id=u_mgr_a.id)
        u_sp_b1 = await _mk_user("sp_b1", f"W2 RepB1 {tag}", mgr_id=u_mgr_b.id)
        u_zero = await _mk_user("zero", f"W2 Zero {tag}")
        u_denied = await _mk_user("denied", f"W2 Denied {tag}")

        db.add_all([
            UserRole(user_id=u_admin.id, role_id=r_admin.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=u_mgr_a.id, role_id=r_mgr.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=u_mgr_a.id, role_id=r_dept_a.id, status=RoleAssignmentStatus.ACTIVE),
            UserRole(user_id=u_mgr_b.id, role_id=r_mgr.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=u_mgr_b.id, role_id=r_dept_b.id, status=RoleAssignmentStatus.ACTIVE),
            UserRole(user_id=u_sp_a1.id, role_id=r_sp.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=u_sp_a1.id, role_id=r_dept_a.id, status=RoleAssignmentStatus.ACTIVE),
            UserRole(user_id=u_sp_b1.id, role_id=r_sp.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=u_sp_b1.id, role_id=r_dept_b.id, status=RoleAssignmentStatus.ACTIVE),
            UserRole(user_id=u_denied.id, role_id=r_mgr.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=u_denied.id, role_id=r_dept_a.id, status=RoleAssignmentStatus.ACTIVE),
            DepartmentLeadershipAssignment(
                department_id=r_dept_a.id, employee_id=u_mgr_a.id,
                leadership_type=LeadershipType.DEPARTMENT_HEAD, is_primary=True, status=OrgRecordStatus.ACTIVE,
            ),
            DepartmentLeadershipAssignment(
                department_id=r_dept_b.id, employee_id=u_mgr_b.id,
                leadership_type=LeadershipType.DEPARTMENT_HEAD, is_primary=True, status=OrgRecordStatus.ACTIVE,
            ),
            UserPermission(user_id=u_denied.id, permission_id=perms["crm.leads.view"].id, is_granted=False),
            UserPermission(user_id=u_denied.id, permission_id=perms["crm.leads.manage"].id, is_granted=False),
            CrmSalespersonConfig(user_id=u_sp_a1.id, is_eligible=True, is_active=True, priority=1, max_lead_capacity=100),
            CrmSalespersonConfig(user_id=u_sp_b1.id, is_eligible=True, is_active=True, priority=1, max_lead_capacity=100),
        ])

        comp_a = Company(
            company_name=f"W2 Alpha Corp {tag}",
            contact_full_name="Alpha Contact",
            contact_calling_number=f"+9171{p_base}01",
            sales_person_id=u_sp_a1.id,
            is_active=True,
        )
        comp_b = Company(
            company_name=f"W2 Beta Confidential {tag}",
            contact_full_name="Beta Contact",
            contact_calling_number=f"+9172{p_base}01",
            sales_person_id=u_sp_b1.id,
            is_active=True,
        )
        db.add_all([comp_a, comp_b])
        await db.flush()
        tracked["companies"].extend([comp_a.id, comp_b.id])

        uom = UnitOfMeasurement(code=f"W2U{tag}", name=f"W2 Nos {tag}", short_name="Nos", status=RecordStatus.ACTIVE)
        cat = ProductCategory(code=f"W2C{tag}", name=f"W2 Cat {tag}", status=RecordStatus.ACTIVE)
        db.add_all([uom, cat])
        await db.flush()
        tracked["uoms"].append(uom.id)
        tracked["categories"].append(cat.id)
        prod = Product(
            product_name=f"W2 Machine {tag}",
            product_name_tally=f"W2 Machine {tag}",
            product_code=f"W2P-{tag.upper()}",
            category_id=cat.id,
            uom_id=uom.id,
            standard_price=Decimal("10000.00"),
            is_sellable=True,
            status=RecordStatus.ACTIVE,
        )
        db.add(prod)
        await db.flush()
        tracked["products"].append(prod.id)

        async def _mk_pipeline(suffix: str, is_def: bool = False) -> tuple[CrmPipeline, dict[str, CrmPipelineStage]]:
            p = CrmPipeline(
                name=f"W2 Pipeline {suffix} {tag}",
                is_default=is_def,
                is_active=True,
                created_by=u_admin.id,
            )
            db.add(p)
            await db.flush()
            tracked["pipelines"].append(p.id)
            s_new = CrmPipelineStage(pipeline_id=p.id, name="New", stage_order=1, stage_type="open", is_initial=True, is_active=True)
            s_work = CrmPipelineStage(pipeline_id=p.id, name="Working", stage_order=2, stage_type="open", is_initial=False, is_active=True)
            s_won = CrmPipelineStage(pipeline_id=p.id, name="Won", stage_order=3, stage_type="won", is_initial=False, is_active=True)
            db.add_all([s_new, s_work, s_won])
            await db.flush()
            return p, {"new": s_new, "work": s_work, "won": s_won}

        p1, stgs1 = await _mk_pipeline("P1", is_def=True)
        p2, stgs2 = await _mk_pipeline("P2", is_def=False)
        p3, stgs3 = await _mk_pipeline("P3", is_def=False)

        await db.commit()

    headers = {
        "admin": _auth_headers(u_admin.id),
        "mgr_a": _auth_headers(u_mgr_a.id),
        "mgr_b": _auth_headers(u_mgr_b.id),
        "sp_a1": _auth_headers(u_sp_a1.id),
        "sp_b1": _auth_headers(u_sp_b1.id),
        "zero": _auth_headers(u_zero.id),
        "denied": _auth_headers(u_denied.id),
    }
    users = {
        "admin": u_admin,
        "mgr_a": u_mgr_a,
        "mgr_b": u_mgr_b,
        "sp_a1": u_sp_a1,
        "sp_b1": u_sp_b1,
        "zero": u_zero,
        "denied": u_denied,
    }

    try:
        async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://testserver") as client:
            yield {
                "client": client,
                "headers": headers,
                "users": users,
                "SessionLocal": SessionLocal,
                "pipes": {"p1": p1, "p2": p2, "p3": p3},
                "stages": {"p1": stgs1, "p2": stgs2, "p3": stgs3},
                "comp_a": comp_a,
                "comp_b": comp_b,
                "prod": prod,
                "tag": tag,
                "p_base": p_base,
                "tracked": tracked,
            }
    finally:
        app.dependency_overrides.pop(get_db_session, None)
        async with SessionLocal() as cdb:
            # Find all CRM leads created during this test
            lead_ids = list(
                (
                    await cdb.execute(
                        select(CrmLead.id).where(
                            (CrmLead.pipeline_id.in_(tracked["pipelines"]))
                            | (CrmLead.created_by.in_(tracked["users"]))
                        )
                    )
                ).scalars().all()
            )
            task_ids: list[uuid.UUID] = []
            if lead_ids:
                fu_tids = list(
                    (
                        await cdb.execute(
                            select(CrmFollowUp.task_id).where(
                                CrmFollowUp.lead_id.in_(lead_ids),
                                CrmFollowUp.task_id.is_not(None),
                            )
                        )
                    ).scalars().all()
                )
                task_ids.extend(fu_tids)
                q_ids = list(
                    (
                        await cdb.execute(
                            select(CrmSalesQuotation.id).where(CrmSalesQuotation.lead_id.in_(lead_ids))
                        )
                    ).scalars().all()
                )
                if q_ids:
                    await cdb.execute(delete(CrmQuotationVersion).where(CrmQuotationVersion.quotation_id.in_(q_ids)))
                    await cdb.execute(delete(CrmQuotationItem).where(CrmQuotationItem.quotation_id.in_(q_ids)))
                    await cdb.execute(delete(CrmSalesQuotation).where(CrmSalesQuotation.id.in_(q_ids)))
                await cdb.execute(delete(CrmLeadProduct).where(CrmLeadProduct.lead_id.in_(lead_ids)))
                await cdb.execute(delete(CrmFollowUp).where(CrmFollowUp.lead_id.in_(lead_ids)))
                await cdb.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_(lead_ids)))
                await cdb.execute(delete(CrmStageHistory).where(CrmStageHistory.lead_id.in_(lead_ids)))
                await cdb.execute(delete(CrmAssignmentHistory).where(CrmAssignmentHistory.lead_id.in_(lead_ids)))
                await cdb.execute(delete(CrmLead).where(CrmLead.id.in_(lead_ids)))

            extra_tasks = list(
                (await cdb.execute(select(Task.id).where(Task.created_by.in_(tracked["users"])))).scalars().all()
            )
            all_tids = list(set(task_ids) | set(extra_tasks))
            if all_tids:
                await cdb.execute(delete(TaskComment).where(TaskComment.task_id.in_(all_tids)))
                await cdb.execute(delete(TaskAssignee).where(TaskAssignee.task_id.in_(all_tids)))
                await cdb.execute(delete(Task).where(Task.id.in_(all_tids)))

            # Legacy leads & follow-ups
            await cdb.execute(
                delete(Lead).where(
                    (Lead.id.in_(tracked["legacy_leads"]))
                    | (Lead.created_by_user_id.in_(tracked["users"]))
                    | (Lead.owner_user_id.in_(tracked["users"]))
                )
            )
            await cdb.execute(
                delete(FollowUp).where(
                    (FollowUp.id.in_(tracked["legacy_follow_ups"]))
                    | (FollowUp.created_by_user_id.in_(tracked["users"]))
                    | (FollowUp.owner_user_id.in_(tracked["users"]))
                )
            )

            await cdb.execute(delete(CrmImportBatch).where(CrmImportBatch.initiated_by.in_(tracked["users"])))
            if tracked["pipelines"]:
                await cdb.execute(delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id.in_(tracked["pipelines"])))
                await cdb.execute(delete(CrmPipeline).where(CrmPipeline.id.in_(tracked["pipelines"])))
            if tracked["products"]:
                await cdb.execute(delete(Product).where(Product.id.in_(tracked["products"])))
            if tracked["categories"]:
                await cdb.execute(delete(ProductCategory).where(ProductCategory.id.in_(tracked["categories"])))
            if tracked["uoms"]:
                await cdb.execute(delete(UnitOfMeasurement).where(UnitOfMeasurement.id.in_(tracked["uoms"])))

            extra_cos = list(
                (await cdb.execute(select(Company.id).where(Company.sales_person_id.in_(tracked["users"])))).scalars().all()
            )
            all_cos = list(set(tracked["companies"]) | set(extra_cos))
            if all_cos:
                await cdb.execute(delete(Company).where(Company.id.in_(all_cos)))

            if tracked["users"]:
                await cdb.execute(delete(Notification).where(Notification.user_id.in_(tracked["users"])))
                await cdb.execute(delete(CrmSalespersonConfig).where(CrmSalespersonConfig.user_id.in_(tracked["users"])))
                await cdb.execute(delete(DepartmentLeadershipAssignment).where(DepartmentLeadershipAssignment.employee_id.in_(tracked["users"])))
                await cdb.execute(delete(UserPermission).where(UserPermission.user_id.in_(tracked["users"])))
                await cdb.execute(delete(UserRole).where(UserRole.user_id.in_(tracked["users"])))
                await cdb.execute(delete(AuthSession).where(AuthSession.user_id.in_(tracked["users"])))
                await cdb.execute(text("UPDATE users SET manager_id = NULL WHERE id = ANY(:uids)"), {"uids": tracked["users"]})
                await cdb.execute(delete(User).where(User.id.in_(tracked["users"])))
            if tracked["roles"]:
                await cdb.execute(delete(RolePermission).where(RolePermission.role_id.in_(tracked["roles"])))
                await cdb.execute(delete(Role).where(Role.id.in_(tracked["roles"])))
            if tracked["perms"]:
                await cdb.execute(delete(Permission).where(Permission.id.in_(tracked["perms"])))
            await cdb.commit()
        await engine.dispose()


# =============================================================================
# 1. LM-DEF-006: CONCURRENT CSV IMPORT PHONE-NUMBER RACE
# =============================================================================
@pytest.mark.asyncio
async def test_lm_def_006_concurrent_csv_import_phone_race(wave2_env):
    client = wave2_env["client"]
    H = wave2_env["headers"]
    SessionLocal = wave2_env["SessionLocal"]
    p1 = wave2_env["pipes"]["p1"]
    comp_b = wave2_env["comp_b"]
    p_base = wave2_env["p_base"]
    tag = wave2_env["tag"]

    async def _confirm_csv(csv_text: str, persona: str = "admin", batch_name: str = "RaceBatch", dist_mode: str = "none"):
        return await client.post(
            "/api/v1/crm/import/confirm",
            headers=H[persona],
            data={
                "pipeline_id": str(p1.id),
                "batch_name": batch_name,
                "distribution_mode": dist_mode,
            },
            files={"file": ("import.csv", csv_text.encode("utf-8"), "text/csv")},
        )

    # Scenario 1: Two simultaneous imports with the exact same normalized phone
    ph1 = f"81{p_base}01"
    c1a = f"Name,Number,Campaign,Priority\nRace Pair A,{ph1},Camp_Pair_A,High\n"
    c1b = f"Name,Number,Campaign,Priority\nRace Pair B,{ph1},Camp_Pair_B,Low\n"
    r1a, r1b = await asyncio.gather(
        _confirm_csv(c1a, batch_name=f"PairA-{tag}"),
        _confirm_csv(c1b, batch_name=f"PairB-{tag}"),
    )
    assert r1a.status_code == 201, f"Pair A failed with HTTP {r1a.status_code}: {r1a.text}"
    assert r1b.status_code == 201, f"Pair B failed with HTTP {r1b.status_code}: {r1b.text}"
    d1a, d1b = r1a.json()["data"], r1b.json()["data"]
    assert d1a["success_count"] + d1b["success_count"] == 1
    assert d1a["duplicate_skipped_count"] + d1b["duplicate_skipped_count"] == 1
    row_statuses_pair = {d1a["row_results"][0]["status"], d1b["row_results"][0]["status"]}
    assert row_statuses_pair == {"VALID", "CRM_DUPLICATE"}

    # Verify DB has exactly 1 lead and BOTH campaigns preserved non-destructively!
    async with SessionLocal() as db:
        rows_ph1 = (await db.execute(select(CrmLead).where(CrmLead.normalized_phone == f"+91{ph1}", CrmLead.deleted_at.is_(None)))).scalars().all()
        assert len(rows_ph1) == 1
        camps = {c["campaign"] for c in (rows_ph1[0].custom_fields or {}).get("campaign_history", [])}
        assert {"Camp_Pair_A", "Camp_Pair_B"}.issubset(camps)

    # Scenario 2: Ten simultaneous imports with the exact same normalized phone
    ph2 = f"82{p_base}02"
    ten_res = await asyncio.gather(*[
        _confirm_csv(
            f"Name,Number,Campaign,Priority\nTenLead {i},{ph2},TenCamp_{i},Medium\n",
            batch_name=f"Ten-{i}-{tag}",
        )
        for i in range(10)
    ])
    for idx, res in enumerate(ten_res):
        assert res.status_code == 201, f"Ten-race #{idx} returned HTTP {res.status_code}: {res.text}"
    assert sum(r.json()["data"]["success_count"] for r in ten_res) == 1
    assert sum(r.json()["data"]["duplicate_skipped_count"] for r in ten_res) == 9
    async with SessionLocal() as db:
        rows_ph2 = (await db.execute(select(CrmLead).where(CrmLead.normalized_phone == f"+91{ph2}", CrmLead.deleted_at.is_(None)))).scalars().all()
        assert len(rows_ph2) == 1
        camps_ten = {c["campaign"] for c in (rows_ph2[0].custom_fields or {}).get("campaign_history", [])}
        assert len(camps_ten) == 10

    # Scenario 3: Same phone in 4 formats (+91, 0-prefix, 10-digit national, 91-prefix) concurrently
    ph3 = f"83{p_base}03"
    formats = [f"+91{ph3}", f"0{ph3}", ph3, f"91{ph3}"]
    fmt_res = await asyncio.gather(*[
        _confirm_csv(f"Name,Number,Campaign\nFmtUser {i},{fmt},FmtCamp_{i}\n", batch_name=f"Fmt-{i}-{tag}")
        for i, fmt in enumerate(formats)
    ])
    assert all(r.status_code == 201 for r in fmt_res), [r.status_code for r in fmt_res]
    assert sum(r.json()["data"]["success_count"] for r in fmt_res) == 1
    assert sum(r.json()["data"]["duplicate_skipped_count"] for r in fmt_res) == 3

    # Scenario 4: Same phone repeated inside a single CSV file
    ph4 = f"84{p_base}04"
    csv_intra = (
        f"Name,Number,Campaign\n"
        f"Intra One,{ph4},IntraCamp\n"
        f"Intra One,{ph4},IntraCamp\n"
    )
    r_intra = await _confirm_csv(csv_intra, batch_name=f"Intra-{tag}")
    assert r_intra.status_code == 201
    assert r_intra.json()["data"]["success_count"] == 1
    assert r_intra.json()["data"]["duplicate_skipped_count"] == 1
    assert [r["status"] for r in r_intra.json()["data"]["row_results"]] == ["VALID", "FILE_DUPLICATE"]

    # Scenario 5: Different phones imported concurrently
    diff_res = await asyncio.gather(*[
        _confirm_csv(f"Name,Number,Campaign\nDiffUser {i},85{p_base}0{i},DiffCamp_{i}\n", batch_name=f"Diff-{i}-{tag}")
        for i in range(4)
    ])
    assert all(r.status_code == 201 and r.json()["data"]["success_count"] == 1 for r in diff_res)

    # Scenario 6: Overlapping multi-phone CSVs in OPPOSITE row order (deadlock-freedom check!)
    o1, o2, o3 = f"86{p_base}01", f"86{p_base}02", f"86{p_base}03"
    csv_fwd = (
        "Name,Number,Campaign\n"
        f"Ov1,{o1},FwdCamp\n"
        f"Ov2,{o2},FwdCamp\n"
        f"Ov3,{o3},FwdCamp\n"
    )
    csv_rev = (
        "Name,Number,Campaign\n"
        f"Ov3,{o3},RevCamp\n"
        f"Ov2,{o2},RevCamp\n"
        f"Ov1,{o1},RevCamp\n"
    )
    rf, rr = await asyncio.gather(
        _confirm_csv(csv_fwd, batch_name=f"OvFwd-{tag}"),
        _confirm_csv(csv_rev, batch_name=f"OvRev-{tag}"),
    )
    assert rf.status_code == 201 and rr.status_code == 201, f"Overlap race failed: {rf.status_code}/{rr.status_code}"
    assert rf.json()["data"]["success_count"] + rr.json()["data"]["success_count"] == 3
    assert rf.json()["data"]["duplicate_skipped_count"] + rr.json()["data"]["duplicate_skipped_count"] == 3

    # Scenario 7: Concurrent manual POST /crm/leads vs CSV import for same normalized phone
    ph7 = f"87{p_base}07"
    r_man, r_csv7 = await asyncio.gather(
        client.post(
            "/api/v1/crm/leads",
            headers=H["admin"],
            json={"name": f"Manual Race {tag}", "phone": ph7, "pipeline_id": str(p1.id)},
        ),
        _confirm_csv(f"Name,Number,Campaign\nCSV Race {tag},{ph7},ManCsvCamp\n", batch_name=f"ManCsv-{tag}"),
    )
    assert r_csv7.status_code == 201, f"CSV vs manual race failed: {r_csv7.status_code} {r_csv7.text}"
    assert r_man.status_code in (201, 409), f"Manual vs CSV race unexpected status: {r_man.status_code} {r_man.text}"
    if r_man.status_code == 201:
        assert r_csv7.json()["data"]["success_count"] == 0
        assert r_csv7.json()["data"]["duplicate_skipped_count"] == 1
    else:
        assert r_csv7.json()["data"]["success_count"] == 1
    async with SessionLocal() as db:
        cnt7 = (await db.execute(select(func.count(CrmLead.id)).where(CrmLead.normalized_phone == f"+91{ph7}", CrmLead.deleted_at.is_(None)))).scalar_one()
        assert cnt7 == 1

    # Scenario 8: Cross-department duplicate privacy preserved after locking (Wave 1 LM-DEF-003 check)
    ph8 = f"88{p_base}08"
    r_b = await client.post(
        "/api/v1/crm/leads",
        headers=H["sp_b1"],
        json={
            "name": f"DeptB Secret {tag}", "phone": ph8,
            "company_id": str(comp_b.id), "priority": "urgent", "pipeline_id": str(p1.id),
        },
    )
    assert r_b.status_code == 201
    lead_b_code = r_b.json()["data"]["lead_code"]
    r_priv = await _confirm_csv(
        f"Name,Number,Campaign,Priority\nProbe A1,{ph8},PrivCamp,Low\n",
        persona="sp_a1",
        batch_name=f"Priv-{tag}",
    )
    assert r_priv.status_code == 201
    priv_row = r_priv.json()["data"]["row_results"][0]
    assert priv_row["status"] == "CRM_DUPLICATE"
    assert priv_row["matched_lead_code"] is None
    assert priv_row["company_id"] is None
    assert priv_row["matched_company_name"] is None
    assert priv_row["priority"] == "low"
    assert lead_b_code not in r_priv.text and comp_b.company_name not in r_priv.text


# =============================================================================
# 2. LM-DEF-007: PIPELINE DEFAULT-SELECTION POSTGRESQL DEADLOCK
# =============================================================================
@pytest.mark.asyncio
async def test_lm_def_007_pipeline_default_deadlock_and_concurrency(wave2_env):
    client = wave2_env["client"]
    H = wave2_env["headers"]
    SessionLocal = wave2_env["SessionLocal"]
    p1, p2, p3 = wave2_env["pipes"]["p1"], wave2_env["pipes"]["p2"], wave2_env["pipes"]["p3"]

    # Scenario 1: Two concurrent set-default requests across 5 rounds (AB/BA deadlock trigger!)
    for rnd in range(5):
        ra, rb = await asyncio.gather(
            client.post(f"/api/v1/crm/pipelines/{p1.id}/set-default", headers=H["admin"]),
            client.post(f"/api/v1/crm/pipelines/{p2.id}/set-default", headers=H["admin"]),
        )
        assert ra.status_code == 200, f"Round {rnd} P1 failed: HTTP {ra.status_code} {ra.text}"
        assert rb.status_code == 200, f"Round {rnd} P2 failed: HTTP {rb.status_code} {rb.text}"

    # Scenario 2: Ten concurrent default-pipeline changes alternating P1, P2, P3
    targets = [p1.id, p2.id, p3.id, p1.id, p2.id, p3.id, p2.id, p1.id, p3.id, p2.id]
    ten_res = await asyncio.gather(*[
        client.post(f"/api/v1/crm/pipelines/{pid}/set-default", headers=H["admin"])
        for pid in targets
    ])
    for i, r in enumerate(ten_res):
        assert r.status_code == 200, f"Ten default #{i} failed: HTTP {r.status_code} {r.text}"

    # Scenario 3: Concurrent set-default and update_pipeline(is_default=True)
    ru1, ru2 = await asyncio.gather(
        client.post(f"/api/v1/crm/pipelines/{p1.id}/set-default", headers=H["admin"]),
        client.put(f"/api/v1/crm/pipelines/{p3.id}", headers=H["admin"], json={"is_default": True}),
    )
    assert ru1.status_code == 200, f"set-default failed: {ru1.status_code} {ru1.text}"
    assert ru2.status_code == 200, f"update_pipeline(is_default=True) failed: {ru2.status_code} {ru2.text}"

    # Scenario 4: Concurrent toggle-active (deactivation) and set-default on same/other pipelines
    rt1, rt2, rt3 = await asyncio.gather(
        client.post(f"/api/v1/crm/pipelines/{p1.id}/set-default", headers=H["admin"]),
        client.post(f"/api/v1/crm/pipelines/{p1.id}/toggle-active", headers=H["admin"]),
        client.post(f"/api/v1/crm/pipelines/{p2.id}/set-default", headers=H["admin"]),
    )
    for r in (rt1, rt2, rt3):
        assert r.status_code in (200, 400), f"Unexpected status in toggle/default race: {r.status_code} {r.text}"

    # Scenario 5: Nonexistent / deleted pipeline returns controlled 404
    assert (await client.post(f"/api/v1/crm/pipelines/{uuid.uuid4()}/set-default", headers=H["admin"])).status_code == 404

    # Scenario 6: Invariant — EXACTLY ONE active default pipeline exists & it is active!
    async with SessionLocal() as db:
        defs = (
            await db.execute(
                select(CrmPipeline).where(
                    CrmPipeline.id.in_([p1.id, p2.id, p3.id]),
                    CrmPipeline.is_default.is_(True),
                    CrmPipeline.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        assert len(defs) == 1, f"Expected exactly 1 active default pipeline, found {len(defs)}"
        assert defs[0].is_active is True


# =============================================================================
# 3. LM-DEF-010: LEGACY FOLLOW-UP BULK-DELETE HTTP 500
# =============================================================================
@pytest.mark.asyncio
async def test_lm_def_010_legacy_follow_up_bulk_delete(wave2_env):
    client = wave2_env["client"]
    H = wave2_env["headers"]
    SessionLocal = wave2_env["SessionLocal"]
    u = wave2_env["users"]
    tag = wave2_env["tag"]
    tracked = wave2_env["tracked"]

    async with SessionLocal() as db:
        f_a1 = FollowUp(company_name=f"W2 FU A1 {tag}", marketing_person=u["sp_a1"].username, owner_user_id=u["sp_a1"].id, created_by_user_id=u["sp_a1"].id, added_on=date(2026, 11, 10))
        f_a2 = FollowUp(company_name=f"W2 FU A2 {tag}", marketing_person=u["sp_a1"].username, owner_user_id=u["sp_a1"].id, created_by_user_id=u["sp_a1"].id, added_on=date(2026, 11, 11))
        f_a3 = FollowUp(company_name=f"W2 FU A3 {tag}", marketing_person=u["sp_a1"].username, owner_user_id=u["sp_a1"].id, created_by_user_id=u["sp_a1"].id, added_on=date(2026, 11, 12))
        f_b1 = FollowUp(company_name=f"W2 FU B1 {tag}", marketing_person=u["sp_b1"].username, owner_user_id=u["sp_b1"].id, created_by_user_id=u["sp_b1"].id, added_on=date(2026, 11, 12))
        db.add_all([f_a1, f_a2, f_a3, f_b1])
        await db.commit()
        tracked["legacy_follow_ups"].extend([f_a1.id, f_a2.id, f_a3.id, f_b1.id])

    # 1. Empty selection -> controlled 422
    assert (await client.post("/api/v1/follow-ups/bulk-delete", headers=H["admin"], json={"ids": []})).status_code == 422

    # 2. Unauthorized personas denied (403)
    for blocked in ("sp_a1", "zero", "denied"):
        assert (await client.post("/api/v1/follow-ups/bulk-delete", headers=H[blocked], json={"ids": [str(f_a1.id)]})).status_code == 403

    # 3. Manager A cannot bulk-delete Dept B record -> 403, nothing deleted!
    assert (await client.post("/api/v1/follow-ups/bulk-delete", headers=H["mgr_a"], json={"ids": [str(f_a1.id), str(f_b1.id)]})).status_code == 403

    # 4. Mixed valid + missing UUID -> atomic 404, valid record stays intact!
    assert (await client.post("/api/v1/follow-ups/bulk-delete", headers=H["mgr_a"], json={"ids": [str(f_a1.id), str(uuid.uuid4())]})).status_code == 404
    async with SessionLocal() as db:
        assert (await db.get(FollowUp, f_a1.id)).deleted_at is None

    # 5. Authorized Manager A bulk-deletes 2 Dept A follow-ups (including duplicate ID in payload) -> 200 OK!
    r_del = await client.post(
        "/api/v1/follow-ups/bulk-delete",
        headers=H["mgr_a"],
        json={"ids": [str(f_a1.id), str(f_a2.id), str(f_a1.id)]},
    )
    assert r_del.status_code == 200, f"bulk-delete failed: HTTP {r_del.status_code} {r_del.text}"
    assert r_del.json()["data"]["deleted_count"] == 2

    # Verify soft-deleted (recoverable, NOT hard-deleted) and f_a3 / f_b1 untouched
    async with SessionLocal() as db:
        db_a1 = await db.get(FollowUp, f_a1.id)
        db_a2 = await db.get(FollowUp, f_a2.id)
        db_a3 = await db.get(FollowUp, f_a3.id)
        db_b1 = await db.get(FollowUp, f_b1.id)
        assert db_a1 is not None and db_a1.deleted_at is not None and db_a1.is_deleted is True
        assert db_a2 is not None and db_a2.deleted_at is not None and db_a2.is_deleted is True
        assert db_a3 is not None and db_a3.deleted_at is None
        assert db_b1 is not None and db_b1.deleted_at is None

    # 6. Already-deleted record returns controlled 404 (not 500)
    assert (await client.post("/api/v1/follow-ups/bulk-delete", headers=H["mgr_a"], json={"ids": [str(f_a1.id)]})).status_code == 404


# =============================================================================
# 4. LM-DEF-011: LEGACY DATE FILTER HTTP 500
# =============================================================================
@pytest.mark.asyncio
async def test_lm_def_011_legacy_date_filters_leads_and_follow_ups(wave2_env):
    client = wave2_env["client"]
    H = wave2_env["headers"]
    SessionLocal = wave2_env["SessionLocal"]
    u = wave2_env["users"]
    tag = wave2_env["tag"]
    tracked = wave2_env["tracked"]

    d1, d2, d3 = date(2026, 10, 10), date(2026, 10, 15), date(2026, 10, 20)
    async with SessionLocal() as db:
        l1 = Lead(company_name=f"W2D_{tag}_D1", owner_user_id=u["sp_a1"].id, created_by_user_id=u["sp_a1"].id, added_on=d1)
        l2 = Lead(company_name=f"W2D_{tag}_D2", owner_user_id=u["sp_a1"].id, created_by_user_id=u["sp_a1"].id, added_on=d2)
        l3 = Lead(company_name=f"W2D_{tag}_D3", owner_user_id=u["sp_a1"].id, created_by_user_id=u["sp_a1"].id, added_on=d3)
        f1 = FollowUp(company_name=f"W2D_{tag}_D1", owner_user_id=u["sp_a1"].id, created_by_user_id=u["sp_a1"].id, added_on=d1)
        f2 = FollowUp(company_name=f"W2D_{tag}_D2", owner_user_id=u["sp_a1"].id, created_by_user_id=u["sp_a1"].id, added_on=d2)
        f3 = FollowUp(company_name=f"W2D_{tag}_D3", owner_user_id=u["sp_a1"].id, created_by_user_id=u["sp_a1"].id, added_on=d3)
        db.add_all([l1, l2, l3, f1, f2, f3])
        await db.commit()
        tracked["legacy_leads"].extend([l1.id, l2.id, l3.id])
        tracked["legacy_follow_ups"].extend([f1.id, f2.id, f3.id])

    for ep in ("/api/v1/leads", "/api/v1/follow-ups"):
        # 1. date_from only
        r_from = await client.get(f"{ep}?search=W2D_{tag}&date_from=2026-10-15", headers=H["admin"])
        assert r_from.status_code == 200, f"{ep} date_from failed: {r_from.status_code} {r_from.text}"
        assert {x["company_name"] for x in r_from.json()["data"]} == {f"W2D_{tag}_D2", f"W2D_{tag}_D3"}

        # 2. date_to only
        r_to = await client.get(f"{ep}?search=W2D_{tag}&date_to=2026-10-15", headers=H["admin"])
        assert r_to.status_code == 200, f"{ep} date_to failed: {r_to.status_code} {r_to.text}"
        assert {x["company_name"] for x in r_to.json()["data"]} == {f"W2D_{tag}_D1", f"W2D_{tag}_D2"}

        # 3. date_from + date_to inclusive range
        r_rng = await client.get(f"{ep}?search=W2D_{tag}&date_from=2026-10-10&date_to=2026-10-20", headers=H["admin"])
        assert r_rng.status_code == 200
        assert len(r_rng.json()["data"]) == 3

        # 4. Same-day boundary
        r_same = await client.get(f"{ep}?search=W2D_{tag}&date_from=2026-10-15&date_to=2026-10-15", headers=H["admin"])
        assert r_same.status_code == 200
        assert [x["company_name"] for x in r_same.json()["data"]] == [f"W2D_{tag}_D2"]

        # 5. Empty date params -> graceful 200 (all 3 rows)
        r_emp = await client.get(f"{ep}?search=W2D_{tag}&date_from=&date_to=", headers=H["admin"])
        assert r_emp.status_code == 200
        assert len(r_emp.json()["data"]) == 3

        # 6. Invalid date string -> controlled 4xx (never 500)
        for bad in ("not-a-date", "2026-13-45", "10-15-2026"):
            r_bad = await client.get(f"{ep}?date_from={bad}", headers=H["admin"])
            assert r_bad.status_code in (400, 422), f"{ep} bad date_from={bad} returned {r_bad.status_code}"

    # 7. added_date only on /api/v1/follow-ups + empty + invalid
    r_add = await client.get(f"/api/v1/follow-ups?search=W2D_{tag}&added_date=2026-10-15", headers=H["admin"])
    assert r_add.status_code == 200, f"added_date failed: {r_add.status_code} {r_add.text}"
    assert [x["company_name"] for x in r_add.json()["data"]] == [f"W2D_{tag}_D2"]
    assert (await client.get(f"/api/v1/follow-ups?search=W2D_{tag}&added_date=", headers=H["admin"])).status_code == 200
    assert (await client.get("/api/v1/follow-ups?added_date=bad-date", headers=H["admin"])).status_code in (400, 422)


# =============================================================================
# 5. LM-DEF-021: LEGACY INVALID sort_by HTTP 500
# =============================================================================
@pytest.mark.asyncio
async def test_lm_def_021_legacy_sort_by_allowlist_leads_and_follow_ups(wave2_env):
    client = wave2_env["client"]
    H = wave2_env["headers"]
    SessionLocal = wave2_env["SessionLocal"]
    u = wave2_env["users"]
    tag = wave2_env["tag"]
    tracked = wave2_env["tracked"]

    async with SessionLocal() as db:
        l_a = Lead(company_name=f"W2S_{tag}_Alpha", city="Ahmedabad", owner_user_id=u["sp_a1"].id, added_on=date(2026, 11, 1))
        l_z = Lead(company_name=f"W2S_{tag}_Zeta", city="Surat", owner_user_id=u["sp_a1"].id, added_on=date(2026, 11, 2))
        f_a = FollowUp(company_name=f"W2S_{tag}_Alpha", city="Ahmedabad", owner_user_id=u["sp_a1"].id, added_on=date(2026, 11, 1))
        f_z = FollowUp(company_name=f"W2S_{tag}_Zeta", city="Surat", owner_user_id=u["sp_a1"].id, added_on=date(2026, 11, 2))
        db.add_all([l_a, l_z, f_a, f_z])
        await db.commit()
        tracked["legacy_leads"].extend([l_a.id, l_z.id])
        tracked["legacy_follow_ups"].extend([f_a.id, f_z.id])

    for ep, allowlist in (
        ("/api/v1/leads", LeadRepository.sortable_fields),
        ("/api/v1/follow-ups", FollowUpRepository.sortable_fields),
    ):
        # 1. Every supported sort field works in asc and desc
        for field in allowlist:
            r_asc = await client.get(f"{ep}?search=W2S_{tag}&sort_by={field}&sort_dir=asc", headers=H["admin"])
            assert r_asc.status_code == 200, f"{ep} sort_by={field} asc failed: {r_asc.status_code}"
        # Verify asc vs desc ordering on company_name
        r_c_asc = await client.get(f"{ep}?search=W2S_{tag}&sort_by=company_name&sort_dir=asc", headers=H["admin"])
        r_c_desc = await client.get(f"{ep}?search=W2S_{tag}&sort_by=company_name&sort_dir=desc", headers=H["admin"])
        assert [x["company_name"] for x in r_c_asc.json()["data"]] == [f"W2S_{tag}_Alpha", f"W2S_{tag}_Zeta"]
        assert [x["company_name"] for x in r_c_desc.json()["data"]] == [f"W2S_{tag}_Zeta", f"W2S_{tag}_Alpha"]

        # 2. Default ordering when omitted & empty string
        assert (await client.get(f"{ep}?search=W2S_{tag}", headers=H["admin"])).status_code == 200
        assert (await client.get(f"{ep}?search=W2S_{tag}&sort_by=", headers=H["admin"])).status_code in (200, 400)

        # 3. Dangerous / invalid sort_by values MUST return controlled 400 (NEVER 500!)
        for bad_sort in ("__tablename__", "is_deleted", "metadata", "__class__", "nonexistent_field", "created_at; DROP TABLE leads"):
            r_bad = await client.get(f"{ep}?sort_by={bad_sort}", headers=H["admin"])
            assert r_bad.status_code == 400, f"{ep} sort_by={bad_sort} returned {r_bad.status_code}: {r_bad.text}"

        # 4. Invalid sort_dir MUST return controlled 400 (NEVER 500!)
        for bad_dir in ("sideways", "asc; DROP TABLE leads", "up"):
            r_bd = await client.get(f"{ep}?sort_by=company_name&sort_dir={bad_dir}", headers=H["admin"])
            assert r_bd.status_code == 400, f"{ep} sort_dir={bad_dir} returned {r_bd.status_code}"

        # 5. Combined filter + sort + pagination
        r_comb = await client.get(
            f"{ep}?search=W2S_{tag}&date_from=2026-11-01&sort_by=company_name&sort_dir=asc&page=1&page_size=1",
            headers=H["admin"],
        )
        assert r_comb.status_code == 200
        assert len(r_comb.json()["data"]) == 1
        assert r_comb.json()["data"][0]["company_name"] == f"W2S_{tag}_Alpha"
        assert r_comb.json()["meta"]["total"] == 2


# =============================================================================
# 6. LM-DEF-015: CRM FOLLOW-UP STATE MACHINE & CONCURRENCY
# =============================================================================
@pytest.mark.asyncio
async def test_lm_def_015_follow_up_state_machine_and_concurrency(wave2_env):
    client = wave2_env["client"]
    H = wave2_env["headers"]
    SessionLocal = wave2_env["SessionLocal"]
    p1 = wave2_env["pipes"]["p1"]
    comp_a = wave2_env["comp_a"]
    p_base = wave2_env["p_base"]
    tag = wave2_env["tag"]
    u = wave2_env["users"]

    # Create lead owned by sp_a1
    r_ld = await client.post("/api/v1/crm/leads", headers=H["sp_a1"], json={
        "name": f"W2 FU State Lead {tag}", "phone": f"75{p_base}01",
        "company_id": str(comp_a.id), "pipeline_id": str(p1.id),
    })
    assert r_ld.status_code == 201
    lead_id = r_ld.json()["data"]["id"]

    async def _mk_fu(note: str) -> tuple[str, str]:
        r = await client.post(f"/api/v1/crm/leads/{lead_id}/follow-ups", headers=H["sp_a1"], json={
            "due_at": (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat(),
            "follow_up_type": "call", "notes": note,
        })
        assert r.status_code == 201
        return r.json()["data"]["id"], r.json()["data"]["task_id"]

    # 1. pending -> completed; repeated completed -> idempotent; completed -> cancelled REJECTED!
    fu1_id, t1_id = await _mk_fu("FU1 Complete Test")
    r_c1 = await client.patch(f"/api/v1/crm/follow-ups/{fu1_id}/status", headers=H["sp_a1"], json={"status": "completed", "completion_notes": "Spoke with buyer"})
    assert r_c1.status_code == 200
    orig_completed_at = r_c1.json()["data"]["completed_at"]
    assert orig_completed_at is not None

    # Count activities & task comments after first completion
    async with SessionLocal() as db:
        act_cnt_1 = (await db.execute(select(func.count(CrmActivity.id)).where(CrmActivity.lead_id == uuid.UUID(lead_id), CrmActivity.activity_type == "follow_up_completed"))).scalar_one()
        cmt_cnt_1 = (await db.execute(select(func.count(TaskComment.id)).where(TaskComment.task_id == uuid.UUID(t1_id)))).scalar_one()
        t1_db = await db.get(Task, uuid.UUID(t1_id))
        assert t1_db.status == TaskStatus.DONE and t1_db.deleted_at is None

    # Repeated completion -> idempotent 200, NO duplicate activity, NO duplicate comment, timestamp preserved!
    r_c1_rep = await client.patch(f"/api/v1/crm/follow-ups/{fu1_id}/status", headers=H["sp_a1"], json={"status": "completed", "completion_notes": "Second click"})
    assert r_c1_rep.status_code == 200
    assert r_c1_rep.json()["data"]["completed_at"] == orig_completed_at
    async with SessionLocal() as db:
        act_cnt_2 = (await db.execute(select(func.count(CrmActivity.id)).where(CrmActivity.lead_id == uuid.UUID(lead_id), CrmActivity.activity_type == "follow_up_completed"))).scalar_one()
        cmt_cnt_2 = (await db.execute(select(func.count(TaskComment.id)).where(TaskComment.task_id == uuid.UUID(t1_id)))).scalar_one()
        assert act_cnt_2 == act_cnt_1, f"Duplicate completion activity created! {act_cnt_1} -> {act_cnt_2}"
        assert cmt_cnt_2 == cmt_cnt_1, f"Duplicate task comment created! {cmt_cnt_1} -> {cmt_cnt_2}"

    # Completed -> Cancelled MUST BE REJECTED (409) & linked DONE Task untouched!
    r_c_to_x = await client.patch(f"/api/v1/crm/follow-ups/{fu1_id}/status", headers=H["sp_a1"], json={"status": "cancelled"})
    assert r_c_to_x.status_code == 409, f"Completed -> cancelled allowed! HTTP {r_c_to_x.status_code}"
    async with SessionLocal() as db:
        t1_after = await db.get(Task, uuid.UUID(t1_id))
        fu1_after = await db.get(CrmFollowUp, uuid.UUID(fu1_id))
        assert fu1_after.status == "completed" and fu1_after.completed_at is not None
        assert t1_after.status == TaskStatus.DONE and t1_after.deleted_at is None

    # 2. pending -> cancelled; repeated cancelled -> idempotent; cancelled -> completed REJECTED!
    fu2_id, t2_id = await _mk_fu("FU2 Cancel Test")
    r_x1 = await client.patch(f"/api/v1/crm/follow-ups/{fu2_id}/status", headers=H["sp_a1"], json={"status": "cancelled"})
    assert r_x1.status_code == 200
    async with SessionLocal() as db:
        x_act_1 = (await db.execute(select(func.count(CrmActivity.id)).where(CrmActivity.lead_id == uuid.UUID(lead_id), CrmActivity.activity_type == "follow_up_cancelled"))).scalar_one()
    r_x1_rep = await client.patch(f"/api/v1/crm/follow-ups/{fu2_id}/status", headers=H["sp_a1"], json={"status": "cancelled"})
    assert r_x1_rep.status_code == 200
    async with SessionLocal() as db:
        x_act_2 = (await db.execute(select(func.count(CrmActivity.id)).where(CrmActivity.lead_id == uuid.UUID(lead_id), CrmActivity.activity_type == "follow_up_cancelled"))).scalar_one()
        assert x_act_2 == x_act_1, f"Duplicate cancel activity created! {x_act_1} -> {x_act_2}"

    r_x_to_c = await client.patch(f"/api/v1/crm/follow-ups/{fu2_id}/status", headers=H["sp_a1"], json={"status": "completed"})
    assert r_x_to_c.status_code == 409, f"Cancelled -> completed allowed! HTTP {r_x_to_c.status_code}"

    # 3. Invalid status rejected (422)
    assert (await client.patch(f"/api/v1/crm/follow-ups/{fu2_id}/status", headers=H["sp_a1"], json={"status": "reopened"})).status_code == 422

    # 4. Two concurrent completion requests -> both 200, exactly 1 new activity & 1 task comment!
    fu3_id, t3_id = await _mk_fu("FU3 Concurrent Complete")
    async with SessionLocal() as db:
        before_comp = (await db.execute(select(func.count(CrmActivity.id)).where(CrmActivity.lead_id == uuid.UUID(lead_id), CrmActivity.activity_type == "follow_up_completed"))).scalar_one()
    rc_a, rc_b = await asyncio.gather(
        client.patch(f"/api/v1/crm/follow-ups/{fu3_id}/status", headers=H["sp_a1"], json={"status": "completed", "completion_notes": "A"}),
        client.patch(f"/api/v1/crm/follow-ups/{fu3_id}/status", headers=H["sp_a1"], json={"status": "completed", "completion_notes": "B"}),
    )
    assert rc_a.status_code == 200 and rc_b.status_code == 200
    async with SessionLocal() as db:
        after_comp = (await db.execute(select(func.count(CrmActivity.id)).where(CrmActivity.lead_id == uuid.UUID(lead_id), CrmActivity.activity_type == "follow_up_completed"))).scalar_one()
        t3_cmts = (await db.execute(select(func.count(TaskComment.id)).where(TaskComment.task_id == uuid.UUID(t3_id)))).scalar_one()
        assert after_comp - before_comp == 1, f"Concurrent complete created {after_comp - before_comp} activities!"
        assert t3_cmts == 1, f"Concurrent complete created {t3_cmts} task comments!"

    # 5. Concurrent complete vs cancel (3 rounds) -> strictly ONE 200 and ONE 409, consistent Task!
    for rnd in range(3):
        fux_id, tx_id = await _mk_fu(f"FU Race {rnd}")
        r_comp, r_canc = await asyncio.gather(
            client.patch(f"/api/v1/crm/follow-ups/{fux_id}/status", headers=H["sp_a1"], json={"status": "completed"}),
            client.patch(f"/api/v1/crm/follow-ups/{fux_id}/status", headers=H["sp_a1"], json={"status": "cancelled"}),
        )
        codes = sorted([r_comp.status_code, r_canc.status_code])
        assert codes == [200, 409], f"Round {rnd} complete vs cancel returned {codes} (expected [200, 409])!"
        async with SessionLocal() as db:
            fu_db = await db.get(CrmFollowUp, uuid.UUID(fux_id))
            t_db = await db.get(Task, uuid.UUID(tx_id))
            if fu_db.status == "completed":
                assert t_db.status == TaskStatus.DONE and t_db.deleted_at is None
            else:
                assert fu_db.status == "cancelled"
                assert t_db.status == TaskStatus.ON_HOLD and t_db.deleted_at is not None

    # 6. Cross-department & Wave 1 reassignment RBAC regression
    fu_rbac_id, _ = await _mk_fu("FU RBAC")
    assert (await client.patch(f"/api/v1/crm/follow-ups/{fu_rbac_id}/status", headers=H["sp_b1"], json={"status": "completed"})).status_code == 403
    assert (await client.patch(f"/api/v1/crm/follow-ups/{fu_rbac_id}/status", headers=H["mgr_b"], json={"status": "completed"})).status_code == 403
    assert (await client.post(f"/api/v1/crm/leads/{lead_id}/reassign", headers=H["admin"], json={
        "new_salesperson_id": str(u["sp_b1"].id), "reason": "Wave 2 RBAC regression handoff",
    })).status_code == 200
    assert (await client.patch(f"/api/v1/crm/follow-ups/{fu_rbac_id}/status", headers=H["sp_a1"], json={"status": "completed"})).status_code == 403


# =============================================================================
# 7. LM-DEF-016: CRM QUOTATION STATUS STATE MACHINE
# =============================================================================
@pytest.mark.asyncio
async def test_lm_def_016_quotation_status_state_machine(wave2_env):
    client = wave2_env["client"]
    H = wave2_env["headers"]
    SessionLocal = wave2_env["SessionLocal"]
    p1 = wave2_env["pipes"]["p1"]
    comp_a = wave2_env["comp_a"]
    prod = wave2_env["prod"]
    p_base = wave2_env["p_base"]
    tag = wave2_env["tag"]
    u = wave2_env["users"]

    r_ld = await client.post("/api/v1/crm/leads", headers=H["sp_a1"], json={
        "name": f"W2 Quote Lead {tag}", "phone": f"76{p_base}01",
        "company_id": str(comp_a.id), "pipeline_id": str(p1.id),
    })
    assert r_ld.status_code == 201
    lead_id = r_ld.json()["data"]["id"]

    async def _mk_quote() -> str:
        r = await client.post(f"/api/v1/crm/leads/{lead_id}/quotations", headers=H["sp_a1"], json={
            "items": [{"product_id": str(prod.id), "quantity": "2", "unit_price": "10000", "unit_discount": "0", "tax_rate": "18"}]
        })
        assert r.status_code == 201
        return r.json()["data"]["id"]

    async def _act_count() -> int:
        async with SessionLocal() as db:
            return (
                await db.execute(
                    select(func.count(CrmActivity.id)).where(
                        CrmActivity.lead_id == uuid.UUID(lead_id),
                        CrmActivity.activity_type == "quotation_status_change",
                    )
                )
            ).scalar_one()

    # Path 1: draft -> cancelled (terminal); cancelled -> accepted/sent/draft REJECTED; repeated cancelled idempotent
    q1 = await _mk_quote()
    # Direct draft -> accepted must be rejected (must be sent first)
    assert (await client.patch(f"/api/v1/crm/quotations/{q1}/status", headers=H["sp_a1"], json={"status": "accepted"})).status_code == 409
    assert (await client.patch(f"/api/v1/crm/quotations/{q1}/status", headers=H["sp_a1"], json={"status": "cancelled"})).status_code == 200
    cnt_after_cancel = await _act_count()
    # Repeated cancelled -> idempotent 200, no extra activity
    assert (await client.patch(f"/api/v1/crm/quotations/{q1}/status", headers=H["sp_a1"], json={"status": "cancelled"})).status_code == 200
    assert await _act_count() == cnt_after_cancel
    # Cancelled -> accepted / sent / draft / rejected / revised ALL rejected with 409 & zero misleading activities!
    for illegal in ("accepted", "sent", "draft", "rejected", "revised"):
        r_ill = await client.patch(f"/api/v1/crm/quotations/{q1}/status", headers=H["sp_a1"], json={"status": illegal})
        assert r_ill.status_code == 409, f"cancelled -> {illegal} returned {r_ill.status_code}"
    assert await _act_count() == cnt_after_cancel

    # Invalid enum rejected (422)
    assert (await client.patch(f"/api/v1/crm/quotations/{q1}/status", headers=H["sp_a1"], json={"status": "bogus"})).status_code == 422

    # Path 2: draft -> sent -> accepted (terminal); repeated accepted idempotent; accepted -> cancelled/rejected REJECTED
    q2 = await _mk_quote()
    assert (await client.patch(f"/api/v1/crm/quotations/{q2}/status", headers=H["sp_a1"], json={"status": "sent"})).status_code == 200
    assert (await client.patch(f"/api/v1/crm/quotations/{q2}/status", headers=H["sp_a1"], json={"status": "accepted"})).status_code == 200
    cnt_after_acc = await _act_count()
    assert (await client.patch(f"/api/v1/crm/quotations/{q2}/status", headers=H["sp_a1"], json={"status": "accepted"})).status_code == 200
    assert await _act_count() == cnt_after_acc
    for illegal in ("cancelled", "rejected", "draft", "sent", "revised"):
        assert (await client.patch(f"/api/v1/crm/quotations/{q2}/status", headers=H["sp_a1"], json={"status": illegal})).status_code == 409
    assert await _act_count() == cnt_after_acc

    # Path 3: draft -> sent -> rejected -> revised -> sent -> cancelled; PLUS sent edit archives immutable v1 snapshot & PDF works!
    q3 = await _mk_quote()
    assert (await client.patch(f"/api/v1/crm/quotations/{q3}/status", headers=H["sp_a1"], json={"status": "sent"})).status_code == 200
    # Edit sent quotation -> archives v1 snapshot, bumps to v2 draft, PDF v1 & v2 valid
    r_rev = await client.patch(f"/api/v1/crm/quotations/{q3}", headers=H["sp_a1"], json={"revision_notes": "Updated pricing"})
    assert r_rev.status_code == 200 and r_rev.json()["version"] == 2 and r_rev.json()["status"] == "draft"
    r_pdf_v1 = await client.get(f"/api/v1/crm/quotations/{q3}/pdf?version=1", headers=H["sp_a1"])
    assert r_pdf_v1.status_code == 200 and r_pdf_v1.content.startswith(b"%PDF-")
    # Transition v2: draft -> sent -> rejected -> revised -> sent -> cancelled
    for nxt in ("sent", "rejected", "revised", "sent", "cancelled"):
        r_st = await client.patch(f"/api/v1/crm/quotations/{q3}/status", headers=H["sp_a1"], json={"status": nxt})
        assert r_st.status_code == 200 and r_st.json()["status"] == nxt

    # Cross-department & Wave 1 reassignment authorization regression
    q4 = await _mk_quote()
    assert (await client.patch(f"/api/v1/crm/quotations/{q4}/status", headers=H["sp_b1"], json={"status": "sent"})).status_code == 403
    assert (await client.patch(f"/api/v1/crm/quotations/{q4}/status", headers=H["mgr_b"], json={"status": "sent"})).status_code == 403
    assert (await client.post(f"/api/v1/crm/leads/{lead_id}/reassign", headers=H["admin"], json={
        "new_salesperson_id": str(u["sp_b1"].id), "reason": "Wave 2 quotation RBAC handoff",
    })).status_code == 200
    assert (await client.patch(f"/api/v1/crm/quotations/{q4}/status", headers=H["sp_a1"], json={"status": "sent"})).status_code == 403
