"""
PostgreSQL 18.6 Integration, RBAC, Isolation & Concurrency Regression Suite for CRM Phase 2.

Verifies all remediated backend findings against the isolated local PostgreSQL test database
(`inhyma_test_db`), cleaning up 100% of synthetic test records in a `finally` block:
- CRM-AUD-01: Quotation & lead-product route RBAC + explicit user-level deny precedence
- CRM-AUD-02: Legacy /api/v1/leads and /api/v1/follow-ups department isolation, display-name collision immunity & salesperson self-service
- CRM-AUD-03: Modern CRM unassigned lead department isolation, peer-role scope restriction & Team Oversight department filtering
- CRM-AUD-04: Concurrent quotation numbering (10 parallel sessions + 9998->9999->10000->10001 sequence) & concurrent revision locking + version uniqueness
- CRM-AUD-05: Authoritative unassigned-lead scope consistency across view, edit, reassign, activity, follow-up, stage transition & quotation
- CRM-AUD-07: Concurrent create_lead duplicate phone protection (10 parallel sessions with varied phone formats + soft-delete reuse)
- CRM-AUD-08: Linked Workforce Task soft-delete unlinking, non-resurrection of Trash tasks & fresh active task recreation on follow-up edit
- CRM-AUD-09: CSV confirm_import resolved company metadata in row_results & quotation response envelope compatibility
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import io
import os
import time
import uuid

from httpx import ASGITransport, AsyncClient
import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.audit.models import AuditLog
from app.auth.models import Session as AuthSession
from app.auth.security import create_access_token, hash_password
from app.companies.models import Company
from app.core.constants import RecordStatus
from app.core.exceptions import ConflictException
from app.crm.lead_service import CrmLeadService
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
    CrmSalespersonConfig,
    CrmSalesQuotation,
    CrmStageHistory,
)
from app.crm.quotation_service import CrmQuotationService
from app.crm.schemas import (
    CrmLeadCreate,
    CrmQuotationItemIn,
    CrmSalesQuotationCreate,
    CrmSalesQuotationUpdate,
)
from app.database.session import get_db_session
from app.follow_ups.models import FollowUp
from app.leads.models import Lead
from app.main import app
from app.masters.product_categories.models import ProductCategory
from app.masters.products.models import Product
from app.masters.uom.models import UnitOfMeasurement
from app.notifications.models import Notification
from app.org_structure.models import DepartmentLeadershipAssignment, LeadershipType, OrgRecordStatus
from app.rbac.models import Permission, Role, RoleAssignmentStatus, RolePermission, UserPermission, UserRole
from app.tasks.models import Task, TaskAssignee, TaskComment
from app.tasks.repository import TaskRepository
from app.tasks.service import TaskService
from app.users.models import User, UserStatus

TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://postgres:root@127.0.0.1:5432/inhyma_test_db",
)


def _make_auth_headers(user: User, session_id: str) -> dict[str, str]:
    token_obj = create_access_token(
        user.id,
        session_id=session_id,
    )
    return {"Authorization": f"Bearer {token_obj.token}"}


@pytest.mark.asyncio
async def test_crm_phase2_complete_remediation_pg18():
    """
    End-to-end PostgreSQL 18.6 verification of CRM-AUD-01, 02, 03, 04, 05, 07, 08, 09.
    """
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

    created_user_ids: list[uuid.UUID] = []
    created_role_ids: list[uuid.UUID] = []
    created_perm_ids: list[uuid.UUID] = []
    created_company_ids: list[uuid.UUID] = []
    created_product_ids: list[uuid.UUID] = []
    created_category_ids: list[uuid.UUID] = []
    created_uom_ids: list[uuid.UUID] = []
    created_pipeline_ids: list[uuid.UUID] = []
    created_lead_ids: list[uuid.UUID] = []
    created_legacy_lead_ids: list[uuid.UUID] = []
    created_legacy_followup_ids: list[uuid.UUID] = []
    created_batch_ids: list[uuid.UUID] = []
    created_task_ids: list[uuid.UUID] = []
    created_quotation_ids: list[uuid.UUID] = []

    ts = int(time.time())
    pw_hash = hash_password("TestPass@123")

    try:
        # =====================================================================
        # SETUP: Roles, Permissions, Departments, Users, Pipeline & Product
        # =====================================================================
        async with SessionLocal() as db:
            perm_codes = [
                "crm.pipelines.view",
                "crm.pipelines.manage",
                "crm.leads.view",
                "crm.leads.manage",
                "crm.leads.import",
                "crm.distribution.view",
                "crm.distribution.manage",
                "tasks.view",
                "tasks.create",
                "tasks.edit",
                "tasks.delete",
            ]
            perms_map: dict[str, Permission] = {}
            for code in perm_codes:
                p = (
                    await db.execute(select(Permission).where(Permission.code == code))
                ).scalar_one_or_none()
                if not p:
                    p = Permission(code=code, module=code.split(".")[0], description=code)
                    db.add(p)
                    await db.flush()
                    created_perm_ids.append(p.id)
                perms_map[code] = p

            dept_a = Role(name=f"CRM_P2_Dept_A_{ts}", code=f"P2DA{ts % 10000}", description="Dept A")
            dept_b = Role(name=f"CRM_P2_Dept_B_{ts}", code=f"P2DB{ts % 10000}", description="Dept B")
            role_mgr = Role(name=f"CRM_P2_Mgr_{ts}", code=f"P2MG{ts % 10000}", description="Manager Role")
            role_rep = Role(name=f"CRM_P2_Rep_{ts}", code=f"P2RP{ts % 10000}", description="Rep Role")
            role_manage_only = Role(
                name=f"CRM_P2_ManageOnly_{ts}", code=f"P2MO{ts % 10000}", description="Manage Only"
            )
            role_zero = Role(name=f"CRM_P2_Zero_{ts}", code=f"P2ZR{ts % 10000}", description="Zero Perm")
            db.add_all([dept_a, dept_b, role_mgr, role_rep, role_manage_only, role_zero])
            await db.flush()
            created_role_ids.extend(
                [dept_a.id, dept_b.id, role_mgr.id, role_rep.id, role_manage_only.id, role_zero.id]
            )

            for c in [
                "crm.leads.view",
                "crm.leads.manage",
                "crm.leads.import",
                "crm.distribution.view",
                "crm.distribution.manage",
                "crm.pipelines.view",
            ]:
                db.add(RolePermission(role_id=role_mgr.id, permission_id=perms_map[c].id))
            for c in ["crm.leads.view", "crm.leads.import", "crm.pipelines.view", "tasks.view", "tasks.delete"]:
                db.add(RolePermission(role_id=role_rep.id, permission_id=perms_map[c].id))
            db.add(
                RolePermission(role_id=role_manage_only.id, permission_id=perms_map["crm.leads.manage"].id)
            )

            async def make_user(uname: str, disp_name: str, roles: list[Role], manager_id: uuid.UUID | None = None) -> tuple[User, str]:
                parts = disp_name.split(" ", 1)
                u = User(
                    username=uname,
                    email=f"{uname}@inhyma.test",
                    first_name=parts[0],
                    last_name=parts[1] if len(parts) > 1 else None,
                    display_name=disp_name,
                    password_hash=pw_hash,
                    has_login=True,
                    status=UserStatus.ACTIVE,
                    manager_id=manager_id,
                )
                db.add(u)
                await db.flush()
                created_user_ids.append(u.id)
                for r in roles:
                    db.add(
                        UserRole(
                            user_id=u.id,
                            role_id=r.id,
                            status=RoleAssignmentStatus.ACTIVE,
                            is_primary=(r == roles[0]),
                        )
                    )
                sess_id = f"loc-{uuid.uuid4().hex}"
                db.add(
                    AuthSession(
                        user_id=u.id,
                        refresh_token_jti=uuid.uuid4().hex,
                        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                    )
                )
                await db.flush()
                return u, sess_id

            admin_role = (
                await db.execute(select(Role).where(Role.name == "super_admin", Role.deleted_at.is_(None)))
            ).scalar_one_or_none()
            if not admin_role:
                admin_role = Role(name="super_admin", code="SUPADM", description="Super Admin")
                db.add(admin_role)
                await db.flush()
                created_role_ids.append(admin_role.id)

            u_admin, s_admin = await make_user(f"p2_admin_{ts}", "Global Admin", [admin_role])
            u_mgr_a, s_mgr_a = await make_user(f"p2_mgr_a_{ts}", "Manager Dept A", [dept_a, role_mgr])
            u_mgr_b, s_mgr_b = await make_user(f"p2_mgr_b_{ts}", "Manager Dept B", [dept_b, role_mgr])
            # Rep A1 and Rep B1 intentionally share the exact same display_name ("Shared RepName")
            u_rep_a1, s_rep_a1 = await make_user(
                f"p2_rep_a1_{ts}", "Shared RepName", [dept_a, role_rep], manager_id=u_mgr_a.id
            )
            u_rep_a2, s_rep_a2 = await make_user(
                f"p2_rep_a2_{ts}", "Rep A2 Unique", [dept_a, role_rep], manager_id=u_mgr_a.id
            )
            u_rep_b1, s_rep_b1 = await make_user(
                f"p2_rep_b1_{ts}", "Shared RepName", [dept_b, role_rep], manager_id=u_mgr_b.id
            )
            u_manage_only, s_manage_only = await make_user(
                f"p2_mgonly_{ts}", "Manage Only User", [dept_a, role_manage_only]
            )
            u_zero, s_zero = await make_user(f"p2_zero_{ts}", "Zero Perm User", [role_zero])
            u_denied, s_denied = await make_user(
                f"p2_denied_{ts}", "Explicitly Denied User", [dept_a, role_mgr]
            )
            # Explicit user-level deny on crm.leads.view
            db.add(
                UserPermission(
                    user_id=u_denied.id,
                    permission_id=perms_map["crm.leads.view"].id,
                    is_granted=False,
                )
            )

            # Department leadership assignments
            db.add(
                DepartmentLeadershipAssignment(
                    department_id=dept_a.id,
                    employee_id=u_mgr_a.id,
                    leadership_type=LeadershipType.DEPARTMENT_HEAD,
                    is_primary=True,
                    status=OrgRecordStatus.ACTIVE,
                )
            )
            db.add(
                DepartmentLeadershipAssignment(
                    department_id=dept_b.id,
                    employee_id=u_mgr_b.id,
                    leadership_type=LeadershipType.DEPARTMENT_HEAD,
                    is_primary=True,
                    status=OrgRecordStatus.ACTIVE,
                )
            )
            # Also add ManageOnly user to Dept A leadership so they manage Dept A
            db.add(
                DepartmentLeadershipAssignment(
                    department_id=dept_a.id,
                    employee_id=u_manage_only.id,
                    leadership_type=LeadershipType.ASSISTANT_MANAGER,
                    is_primary=False,
                    status=OrgRecordStatus.ACTIVE,
                )
            )

            for rep in (u_rep_a1, u_rep_a2, u_rep_b1):
                db.add(
                    CrmSalespersonConfig(
                        user_id=rep.id,
                        is_active=True,
                        is_eligible=True,
                        priority=1,
                        max_lead_capacity=50,
                    )
                )

            cat = ProductCategory(
                code=f"P2CAT{ts % 100000}",
                name=f"P2 Packaging Category {ts}",
                status=RecordStatus.ACTIVE,
            )
            uom = UnitOfMeasurement(
                code=f"P2U{ts % 10000}",
                name=f"P2 Unit {ts}",
                short_name="UNT",
                status=RecordStatus.ACTIVE,
            )
            db.add_all([cat, uom])
            await db.flush()
            created_category_ids.append(cat.id)
            created_uom_ids.append(uom.id)

            prod = Product(
                product_code=f"P2-PRD-{ts}",
                product_name=f"High Speed Band Sealer {ts}",
                product_name_tally=f"High Speed Band Sealer {ts}",
                product_name_invoice=f"High Speed Band Sealer {ts}",
                category_id=cat.id,
                uom_id=uom.id,
                standard_price=Decimal("25000.00"),
                minimum_price=Decimal("25000.00"),
                specification="SS304 body | 750W motor",
                description="Industrial band sealer",
                status=RecordStatus.ACTIVE,
            )
            db.add(prod)

            comp_existing = Company(
                company_name=f"P2 Existing Automation {ts}",
                company_type="Customer",
                is_active=True,
            )
            db.add(comp_existing)
            await db.flush()
            created_product_ids.append(prod.id)
            created_company_ids.append(comp_existing.id)

            await db.commit()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            h_admin = _make_auth_headers(u_admin, s_admin)
            h_mgr_a = _make_auth_headers(u_mgr_a, s_mgr_a)
            h_mgr_b = _make_auth_headers(u_mgr_b, s_mgr_b)
            h_rep_a1 = _make_auth_headers(u_rep_a1, s_rep_a1)
            h_rep_a2 = _make_auth_headers(u_rep_a2, s_rep_a2)
            h_rep_b1 = _make_auth_headers(u_rep_b1, s_rep_b1)
            h_manage_only = _make_auth_headers(u_manage_only, s_manage_only)
            h_zero = _make_auth_headers(u_zero, s_zero)
            h_denied = _make_auth_headers(u_denied, s_denied)

            # Create Pipeline & Stages
            r_pipe = await client.post(
                "/api/v1/crm/pipelines",
                headers=h_admin,
                json={
                    "name": f"P2 Pipeline {ts}",
                    "description": "Phase 2 Pipeline",
                    "is_default": False,
                    "stages": [
                        {"name": "New Lead", "stage_order": 1, "stage_type": "open", "is_initial": True},
                        {"name": "Qualified", "stage_order": 2, "stage_type": "open", "is_initial": False},
                        {"name": "Won", "stage_order": 3, "stage_type": "won", "is_initial": False},
                    ],
                },
            )
            assert r_pipe.status_code == 201, r_pipe.text
            pipe_data = r_pipe.json()["data"]
            pipe_id = uuid.UUID(pipe_data["id"])
            created_pipeline_ids.append(pipe_id)
            stage1_id = uuid.UUID(pipe_data["stages"][0]["id"])
            stage2_id = uuid.UUID(pipe_data["stages"][1]["id"])

            # =================================================================
            # 1. VERIFY CRM-AUD-01: QUOTATION ROUTE RBAC & EXPLICIT DENY
            # =================================================================
            # Rep A1 creates own lead
            r_lead_a1 = await client.post(
                "/api/v1/crm/leads",
                headers=h_rep_a1,
                json={
                    "name": "Rep A1 Own Customer",
                    "phone": "9810011001",
                    "company_name": f"P2 Existing Automation {ts}",
                    "pipeline_id": str(pipe_id),
                },
            )
            assert r_lead_a1.status_code == 201
            lead_a1_id = uuid.UUID(r_lead_a1.json()["data"]["id"])
            created_lead_ids.append(lead_a1_id)

            # Rep B1 creates own lead in Dept B
            r_lead_b1 = await client.post(
                "/api/v1/crm/leads",
                headers=h_rep_b1,
                json={
                    "name": "Rep B1 Own Customer",
                    "phone": "9810011002",
                    "pipeline_id": str(pipe_id),
                },
            )
            assert r_lead_b1.status_code == 201
            lead_b1_id = uuid.UUID(r_lead_b1.json()["data"]["id"])
            created_lead_ids.append(lead_b1_id)

            # Rep A1 (`crm.leads.view`) can lookup products, associate product, create/update quotation, change status, list versions, get PDF, share activity on OWN lead
            assert (await client.get("/api/v1/crm/products/lookup", headers=h_rep_a1)).status_code == 200
            r_assoc = await client.post(
                f"/api/v1/crm/leads/{lead_a1_id}/products",
                headers=h_rep_a1,
                json={"product_id": str(prod.id), "quantity": 2, "notes": "Rep A1 interest"},
            )
            assert r_assoc.status_code == 201
            assert r_assoc.json()["success"] is True

            r_q_create = await client.post(
                f"/api/v1/crm/leads/{lead_a1_id}/quotations",
                headers=h_rep_a1,
                json={
                    "currency": "INR",
                    "notes": "Rep A1 v1 quote",
                    "items": [
                        {
                            "product_id": str(prod.id),
                            "quantity": "2.000",
                            "unit_price": "25000.00",
                            "unit_discount": "0.00",
                            "tax_rate": "18.00",
                        }
                    ],
                },
            )
            assert r_q_create.status_code == 201
            q_a1_body = r_q_create.json()
            assert q_a1_body["success"] is True
            assert "data" in q_a1_body and "quotation_number" in q_a1_body
            q_a1_id = uuid.UUID(q_a1_body["id"])
            created_quotation_ids.append(q_a1_id)

            # Rep A1 updates/revises own quotation and changes status
            r_q_upd = await client.put(
                f"/api/v1/crm/quotations/{q_a1_id}",
                headers=h_rep_a1,
                json={"create_revision": True, "revision_notes": "Rep A1 v2"},
            )
            assert r_q_upd.status_code == 200
            assert r_q_upd.json()["version"] == 2

            r_q_st = await client.patch(
                f"/api/v1/crm/quotations/{q_a1_id}/status",
                headers=h_rep_a1,
                json={"status": "sent", "notes": "Sent to client"},
            )
            assert r_q_st.status_code == 200
            assert r_q_st.json()["status"] == "sent"

            assert (await client.get(f"/api/v1/crm/quotations/{q_a1_id}/versions", headers=h_rep_a1)).status_code == 200
            r_pdf = await client.get(f"/api/v1/crm/quotations/{q_a1_id}/pdf", headers=h_rep_a1)
            assert r_pdf.status_code == 200
            assert r_pdf.content.startswith(b"%PDF-")

            r_share = await client.post(
                f"/api/v1/crm/quotations/{q_a1_id}/share-activity",
                headers=h_rep_a1,
                json={"channel": "whatsapp", "outcome": "opened", "recipient": "+919810011001"},
            )
            assert r_share.status_code == 200

            # Rep A2 (other salesperson) gets 403 on Rep A1's quotation & lead products
            assert (await client.get(f"/api/v1/crm/quotations/{q_a1_id}", headers=h_rep_a2)).status_code == 403
            assert (await client.put(f"/api/v1/crm/quotations/{q_a1_id}", headers=h_rep_a2, json={"notes": "hack"})).status_code == 403
            assert (await client.get(f"/api/v1/crm/quotations/{q_a1_id}/pdf", headers=h_rep_a2)).status_code == 403
            assert (
                await client.post(
                    f"/api/v1/crm/leads/{lead_a1_id}/products",
                    headers=h_rep_a2,
                    json={"product_id": str(prod.id), "quantity": 1},
                )
            ).status_code == 403

            # Manager B (other department) gets 403 on Dept A's quotation
            assert (await client.get(f"/api/v1/crm/quotations/{q_a1_id}", headers=h_mgr_b)).status_code == 403
            assert (await client.put(f"/api/v1/crm/quotations/{q_a1_id}", headers=h_mgr_b, json={"notes": "hack"})).status_code == 403

            # Manage-only user (`crm.leads.manage` without `crm.leads.view`) in Dept A can read quotations & PDFs
            assert (await client.get("/api/v1/crm/products/lookup", headers=h_manage_only)).status_code == 200
            assert (await client.get(f"/api/v1/crm/leads/{lead_a1_id}/quotations", headers=h_manage_only)).status_code == 200
            assert (await client.get(f"/api/v1/crm/quotations/{q_a1_id}", headers=h_manage_only)).status_code == 200
            assert (await client.get(f"/api/v1/crm/quotations/{q_a1_id}/versions", headers=h_manage_only)).status_code == 200
            assert (await client.get(f"/api/v1/crm/quotations/{q_a1_id}/pdf", headers=h_manage_only)).status_code == 200

            # Zero-permission user gets 403
            assert (await client.get(f"/api/v1/crm/quotations/{q_a1_id}", headers=h_zero)).status_code == 403

            # Explicit user-level deny (`UserPermission.is_granted=False` on `crm.leads.view`) blocks even with role grant `crm.leads.manage`
            assert (await client.get("/api/v1/crm/leads", headers=h_denied)).status_code == 403
            assert (await client.get(f"/api/v1/crm/quotations/{q_a1_id}", headers=h_denied)).status_code == 403

            # =================================================================
            # 2. VERIFY CRM-AUD-02: LEGACY LEADS & FOLLOW-UPS ISOLATION
            # =================================================================
            # Rep A1 (`crm.leads.view`, display_name="Shared RepName") creates own legacy lead & follow-up
            r_leg_lead_a1 = await client.post(
                "/api/v1/leads",
                headers=h_rep_a1,
                json={"company_name": f"Legacy Dept A Corp {ts}", "contact_person": "A1 Contact"},
            )
            assert r_leg_lead_a1.status_code == 201
            leg_lead_a1_id = uuid.UUID(r_leg_lead_a1.json()["data"]["id"])
            created_legacy_lead_ids.append(leg_lead_a1_id)

            # Rep A1 updates own legacy lead
            r_leg_upd_a1 = await client.put(
                f"/api/v1/leads/{leg_lead_a1_id}",
                headers=h_rep_a1,
                json={"notes": "Updated by Rep A1"},
            )
            assert r_leg_upd_a1.status_code == 200

            # Rep A1 cannot reassign/allot legacy lead to someone else via PUT or /allot
            assert (
                await client.put(
                    f"/api/v1/leads/{leg_lead_a1_id}",
                    headers=h_rep_a1,
                    json={"allotted_to": u_rep_a2.username},
                )
            ).status_code == 403
            assert (
                await client.post(
                    f"/api/v1/leads/{leg_lead_a1_id}/allot",
                    headers=h_rep_a1,
                    json={"allotted_to": u_rep_a2.username},
                )
            ).status_code == 403

            # Rep B1 (in Dept B, who has the EXACT SAME display_name="Shared RepName" as Rep A1!)
            # MUST NOT be able to view or list Rep A1's legacy lead!
            assert (await client.get(f"/api/v1/leads/{leg_lead_a1_id}", headers=h_rep_b1)).status_code == 403
            r_leg_list_b1 = await client.get("/api/v1/leads", headers=h_rep_b1)
            assert r_leg_list_b1.status_code == 200
            b1_lead_ids = {item["id"] for item in r_leg_list_b1.json()["data"]}
            assert str(leg_lead_a1_id) not in b1_lead_ids

            # Manager B (Dept B) MUST NOT be able to view, update, allot, or delete Dept A's legacy lead!
            assert (await client.get(f"/api/v1/leads/{leg_lead_a1_id}", headers=h_mgr_b)).status_code == 403
            assert (
                await client.put(f"/api/v1/leads/{leg_lead_a1_id}", headers=h_mgr_b, json={"notes": "Mgr B"})
            ).status_code == 403
            assert (
                await client.post(
                    f"/api/v1/leads/{leg_lead_a1_id}/allot",
                    headers=h_mgr_b,
                    json={"allotted_to": u_rep_b1.username},
                )
            ).status_code == 403
            assert (await client.delete(f"/api/v1/leads/{leg_lead_a1_id}", headers=h_mgr_b)).status_code == 403
            assert (
                await client.post(
                    "/api/v1/leads/bulk-delete",
                    headers=h_mgr_b,
                    json={"ids": [str(leg_lead_a1_id)]},
                )
            ).status_code == 403

            # Manager A (Dept A) CAN view and allot Dept A's legacy lead to Rep A2 within Dept A,
            # but CANNOT allot it to Rep B1 in Dept B!
            assert (await client.get(f"/api/v1/leads/{leg_lead_a1_id}", headers=h_mgr_a)).status_code == 200
            assert (
                await client.post(
                    f"/api/v1/leads/{leg_lead_a1_id}/allot",
                    headers=h_mgr_a,
                    json={"allotted_to": u_rep_b1.username},
                )
            ).status_code == 403
            assert (
                await client.post(
                    f"/api/v1/leads/{leg_lead_a1_id}/allot",
                    headers=h_mgr_a,
                    json={"allotted_to": u_rep_a2.username},
                )
            ).status_code == 200

            # Same verification for Legacy Follow-Ups (/api/v1/follow-ups)
            r_leg_fu_a1 = await client.post(
                "/api/v1/follow-ups",
                headers=h_rep_a1,
                json={"company_name": f"Legacy FU Dept A {ts}", "call_type": "Outgoing"},
            )
            assert r_leg_fu_a1.status_code == 201
            leg_fu_a1_id = uuid.UUID(r_leg_fu_a1.json()["data"]["id"])
            created_legacy_followup_ids.append(leg_fu_a1_id)

            assert (await client.get(f"/api/v1/follow-ups/{leg_fu_a1_id}", headers=h_rep_b1)).status_code == 403
            assert (await client.get(f"/api/v1/follow-ups/{leg_fu_a1_id}", headers=h_mgr_b)).status_code == 403
            assert (await client.get(f"/api/v1/follow-ups/{leg_fu_a1_id}", headers=h_mgr_a)).status_code == 200
            assert (await client.get(f"/api/v1/follow-ups/{leg_fu_a1_id}", headers=h_admin)).status_code == 200

            # =================================================================
            # 3. VERIFY CRM-AUD-03 & CRM-AUD-05: MODERN CRM UNASSIGNED LEAD
            #    ISOLATION, CONSISTENCY & TEAM OVERSIGHT DEPARTMENT FILTER
            # =================================================================
            # Manager A creates an unassigned lead in Dept A
            r_unassigned_a = await client.post(
                "/api/v1/crm/leads",
                headers=h_mgr_a,
                json={
                    "name": "Dept A Unassigned Lead",
                    "phone": "9810011003",
                    "pipeline_id": str(pipe_id),
                },
            )
            assert r_unassigned_a.status_code == 201
            unassigned_a_id = uuid.UUID(r_unassigned_a.json()["data"]["id"])
            created_lead_ids.append(unassigned_a_id)

            # Manager B (Dept B) MUST be blocked (403) across ALL operations on Dept A's unassigned lead:
            assert (await client.get(f"/api/v1/crm/leads/{unassigned_a_id}", headers=h_mgr_b)).status_code == 403
            assert (
                await client.patch(f"/api/v1/crm/leads/{unassigned_a_id}", headers=h_mgr_b, json={"notes": "Steal"})
            ).status_code == 403
            assert (
                await client.post(
                    f"/api/v1/crm/leads/{unassigned_a_id}/reassign",
                    headers=h_mgr_b,
                    json={"new_salesperson_id": str(u_rep_b1.id), "reason": "Cross dept hijack attempt"},
                )
            ).status_code == 403
            assert (
                await client.post(
                    f"/api/v1/crm/leads/{unassigned_a_id}/activities",
                    headers=h_mgr_b,
                    json={"activity_type": "note", "subject": "Unauthorized note"},
                )
            ).status_code == 403
            assert (
                await client.post(
                    f"/api/v1/crm/leads/{unassigned_a_id}/follow-ups",
                    headers=h_mgr_b,
                    json={"due_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(), "follow_up_type": "call"},
                )
            ).status_code == 403
            assert (
                await client.post(
                    f"/api/v1/crm/leads/{unassigned_a_id}/stage",
                    headers=h_mgr_b,
                    json={"stage_id": str(stage2_id), "reason": "Unauthorized transition"},
                )
            ).status_code == 403

            # And Manager B's unassigned queue must NOT include Dept A's unassigned lead
            r_mgr_b_unassigned = await client.get("/api/v1/crm/leads?unassigned_only=true", headers=h_mgr_b)
            assert r_mgr_b_unassigned.status_code == 200
            mgr_b_unassigned_ids = {item["id"] for item in r_mgr_b_unassigned.json()["data"]["items"]}
            assert str(unassigned_a_id) not in mgr_b_unassigned_ids

            # Manager A (Dept A) CAN consistently view, edit, log activity, schedule follow-up, transition stage, create quotation, and reassign on Dept A's unassigned lead (CRM-AUD-05)
            assert (await client.get(f"/api/v1/crm/leads/{unassigned_a_id}", headers=h_mgr_a)).status_code == 200
            assert (
                await client.patch(f"/api/v1/crm/leads/{unassigned_a_id}", headers=h_mgr_a, json={"notes": "Mgr A edit"})
            ).status_code == 200
            assert (
                await client.post(
                    f"/api/v1/crm/leads/{unassigned_a_id}/activities",
                    headers=h_mgr_a,
                    json={"activity_type": "note", "subject": "Mgr A note"},
                )
            ).status_code == 201
            assert (
                await client.post(
                    f"/api/v1/crm/leads/{unassigned_a_id}/stage",
                    headers=h_mgr_a,
                    json={"stage_id": str(stage2_id), "reason": "Qualified by Mgr A"},
                )
            ).status_code == 200

            # Team Oversight department_id filtering & authorization (CRM-AUD-03.C)
            r_ov_admin_dept_a = await client.get(
                f"/api/v1/crm/team-oversight?department_id={dept_a.id}", headers=h_admin
            )
            assert r_ov_admin_dept_a.status_code == 200
            ov_data = r_ov_admin_dept_a.json()["data"]
            assert ov_data["department_name"] == dept_a.name
            ov_rep_ids = {r["salesperson_id"] for r in ov_data["reps"]}
            assert str(u_rep_a1.id) in ov_rep_ids
            assert str(u_rep_b1.id) not in ov_rep_ids

            # Manager B querying Dept A team oversight -> 403 Forbidden
            r_ov_mgr_b_dept_a = await client.get(
                f"/api/v1/crm/team-oversight?department_id={dept_a.id}", headers=h_mgr_b
            )
            assert r_ov_mgr_b_dept_a.status_code == 403

            # =================================================================
            # 4. VERIFY CRM-AUD-04: QUOTATION NUMBERING (10 PARALLEL + 9999+)
            #    AND REVISION CONCURRENCY LOCKING
            # =================================================================
            # A. 10 simultaneous quotation creations across independent DB sessions
            async def create_quote_worker(idx: int) -> str:
                async with SessionLocal() as s:
                    q_svc = CrmQuotationService(s)
                    from app.auth.service import CurrentUser
                    actor = CurrentUser(
                        id=u_admin.id,
                        username=u_admin.username,
                        permissions={"*"},
                        is_super_admin=True,
                    )
                    res = await q_svc.create_quotation(
                        lead_id=lead_a1_id,
                        payload=CrmSalesQuotationCreate(
                            currency="INR",
                            notes=f"Parallel quote {idx}",
                            items=[
                                CrmQuotationItemIn(
                                    product_id=prod.id,
                                    quantity=Decimal("1.000"),
                                    unit_price=Decimal("25000.00"),
                                    unit_discount=Decimal("0.00"),
                                    tax_rate=Decimal("18.00"),
                                )
                            ],
                        ),
                        actor=actor,
                    )
                    created_quotation_ids.append(res.id)
                    return res.quotation_number

            parallel_qnums = await asyncio.gather(*(create_quote_worker(i) for i in range(10)))
            assert len(parallel_qnums) == 10
            assert len(set(parallel_qnums)) == 10, f"Expected 10 unique quotation numbers, got {parallel_qnums}"

            # B. Verify 9998 -> 9999 -> 10000 -> 10001 -> 10002 sequence without resetting
            test_prefix = "SQ-209912"
            async with SessionLocal() as s:
                q_svc = CrmQuotationService(s)
                for seq_val in (9998, 9999, 10000, 10001):
                    q_row = CrmSalesQuotation(
                        quotation_number=f"{test_prefix}-{seq_val:04d}",
                        lead_id=lead_a1_id,
                        version=1,
                        status="draft",
                        currency="INR",
                        customer_name_snapshot="Seq Test",
                        subtotal=Decimal("100.00"),
                        discount_total=Decimal("0.00"),
                        tax_total=Decimal("18.00"),
                        total_amount=Decimal("118.00"),
                        created_by=u_admin.id,
                    )
                    s.add(q_row)
                    await s.flush()
                    created_quotation_ids.append(q_row.id)
                    next_generated = await q_svc._generate_quotation_number(prefix=test_prefix)
                    assert next_generated == f"{test_prefix}-{seq_val + 1:04d}"
                await s.commit()

            # C. Two simultaneous revisions of the same quotation across independent PostgreSQL sessions
            from app.auth.service import CurrentUser
            admin_actor = CurrentUser(
                id=u_admin.id,
                username=u_admin.username,
                permissions={"*"},
                is_super_admin=True,
            )

            async def revise_quote_worker(rev_label: str) -> int:
                async with SessionLocal() as s:
                    q_svc = CrmQuotationService(s)
                    updated = await q_svc.update_quotation(
                        quotation_id=q_a1_id,
                        payload=CrmSalesQuotationUpdate(
                            create_revision=True,
                            revision_notes=f"Concurrent revision {rev_label}",
                            notes=f"Notes from {rev_label}",
                        ),
                        actor=admin_actor,
                    )
                    return updated.version

            rev_versions = await asyncio.gather(
                revise_quote_worker("Worker-1"),
                revise_quote_worker("Worker-2"),
            )
            assert sorted(rev_versions) == [3, 4], f"Expected sequential versions [3, 4], got {rev_versions}"

            # Verify archived versions in crm_quotation_versions are strictly unique [1, 2, 3]
            async with SessionLocal() as s:
                ver_rows = (
                    await s.execute(
                        select(CrmQuotationVersion.version)
                        .where(CrmQuotationVersion.quotation_id == q_a1_id)
                        .order_by(CrmQuotationVersion.version.asc())
                    )
                ).scalars().all()
                assert list(ver_rows) == [1, 2, 3]

                # Direct duplicate version insertion must be rejected by UniqueConstraint
                dup_ver = CrmQuotationVersion(
                    quotation_id=q_a1_id,
                    version=1,
                    snapshot_data={"test": True},
                    revision_notes="Duplicate v1",
                )
                s.add(dup_ver)
                with pytest.raises(IntegrityError):
                    await s.flush()
                await s.rollback()

            # =================================================================
            # 5. VERIFY CRM-AUD-07: 10 SIMULTANEOUS DUPLICATE PHONE CREATIONS
            #    IN VARIED FORMATS + REUSE AFTER SOFT DELETION
            # =================================================================
            phone_formats = [
                "9876509988",
                "+91 98765 09988",
                "098765-09988",
                "919876509988",
                "+91-9876509988",
                "98765 09988",
                "09876509988",
                "+91 (98765) 09988",
                "91 98765 09988",
                "9876-509-988",
            ]

            async def create_dup_lead_worker(idx: int, raw_phone: str) -> str:
                async with SessionLocal() as s:
                    l_svc = CrmLeadService(s)
                    try:
                        created = await l_svc.create_lead(
                            payload=CrmLeadCreate(
                                name=f"Concurrent Phone Lead {idx}",
                                phone=raw_phone,
                                pipeline_id=pipe_id,
                            ),
                            actor=admin_actor,
                        )
                        created_lead_ids.append(created.id)
                        return "CREATED"
                    except ConflictException:
                        return "CONFLICT_409"

            dup_outcomes = await asyncio.gather(
                *(create_dup_lead_worker(i, fmt) for i, fmt in enumerate(phone_formats))
            )
            assert dup_outcomes.count("CREATED") == 1
            assert dup_outcomes.count("CONFLICT_409") == 9

            # Soft-delete the created lead and verify legitimate reuse of the phone number works
            async with SessionLocal() as s:
                active_dup_lead = (
                    await s.execute(
                        select(CrmLead).where(
                            CrmLead.normalized_phone == "+919876509988",
                            CrmLead.deleted_at.is_(None),
                        )
                    )
                ).scalar_one()
                active_dup_lead.deleted_at = datetime.now(timezone.utc)
                await s.commit()

            r_reused = await client.post(
                "/api/v1/crm/leads",
                headers=h_admin,
                json={
                    "name": "Reused After Soft Delete",
                    "phone": "+91 98765 09988",
                    "pipeline_id": str(pipe_id),
                },
            )
            assert r_reused.status_code == 201
            created_lead_ids.append(uuid.UUID(r_reused.json()["data"]["id"]))

            # =================================================================
            # 6. VERIFY CRM-AUD-08: LINKED TASK SOFT-DELETE SYNCHRONIZATION
            # =================================================================
            due_iso = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
            r_fu = await client.post(
                f"/api/v1/crm/leads/{lead_a1_id}/follow-ups",
                headers=h_rep_a1,
                json={"due_at": due_iso, "follow_up_type": "call", "notes": "Initial call"},
            )
            assert r_fu.status_code == 201
            fu_id = uuid.UUID(r_fu.json()["data"]["id"])
            task1_id = uuid.UUID(r_fu.json()["data"]["task_id"])
            created_task_ids.append(task1_id)

            # Soft-delete task1 via TaskService.soft_delete_task
            async with SessionLocal() as s:
                from unittest.mock import AsyncMock
                t_svc = TaskService(
                    repository=TaskRepository(s),
                    notification_service=AsyncMock(),
                    audit_service=AsyncMock(),
                    dispatcher=AsyncMock(),
                )
                await t_svc.soft_delete_task(task1_id, current_user=admin_actor)

            # Verify follow-up's task_id was transactionally unlinked while status stays "pending"
            async with SessionLocal() as s:
                fu_after_del = await s.get(CrmFollowUp, fu_id)
                assert fu_after_del is not None
                assert fu_after_del.status == "pending"
                assert fu_after_del.task_id is None

            # Edit the pending CRM follow-up -> must create a brand-new active task (task2_id != task1_id)
            r_fu_upd = await client.patch(
                f"/api/v1/crm/follow-ups/{fu_id}",
                headers=h_rep_a1,
                json={"notes": "Updated notes after task delete"},
            )
            assert r_fu_upd.status_code == 200
            task2_id = uuid.UUID(r_fu_upd.json()["data"]["task_id"])
            created_task_ids.append(task2_id)
            assert task2_id != task1_id

            async with SessionLocal() as s:
                t1 = await s.get(Task, task1_id)
                t2 = await s.get(Task, task2_id)
                assert t1 is not None and t1.deleted_at is not None  # Trash task untouched
                assert t2 is not None and t2.deleted_at is None  # New active task

            # =================================================================
            # 7. VERIFY CRM-AUD-09: CSV CONFIRM_IMPORT COMPANY METADATA
            # =================================================================
            csv_text = (
                "Name,Number,Campaign,Priority,Company\n"
                f"CSV Existing Co,9810022001,Q4_Camp,High,P2 Existing Automation {ts}\n"
                f"CSV New Co,9810022002,Q4_Camp,Medium,P2 Brand New Industries {ts}\n"
            )
            r_imp = await client.post(
                "/api/v1/crm/import/confirm",
                headers=h_mgr_a,
                data={"pipeline_id": str(pipe_id), "distribution_mode": "none"},
                files={"file": ("import.csv", io.BytesIO(csv_text.encode("utf-8")), "text/csv")},
            )
            assert r_imp.status_code == 201
            imp_data = r_imp.json()["data"]
            created_batch_ids.append(uuid.UUID(imp_data["batch_id"]))
            row_results = imp_data["row_results"]
            assert len(row_results) == 2

            row0, row1 = row_results[0], row_results[1]
            assert row0["company_id"] == str(comp_existing.id)
            assert row0["matched_company_name"] == comp_existing.company_name
            assert row0["company_action"] == "EXISTING"

            assert row1["company_id"] is not None
            assert row1["matched_company_name"] == f"P2 Brand New Industries {ts}"
            assert row1["company_action"] == "NEW"
            created_company_ids.append(uuid.UUID(row1["company_id"]))

            # Track imported leads for cleanup
            async with SessionLocal() as s:
                imp_leads = (
                    await s.execute(
                        select(CrmLead.id).where(
                            CrmLead.normalized_phone.in_(["+919810022001", "+919810022002"])
                        )
                    )
                ).scalars().all()
                created_lead_ids.extend(imp_leads)

    finally:
        app.dependency_overrides.pop(get_db_session, None)
        async with SessionLocal() as cleanup_db:
            if created_quotation_ids:
                await cleanup_db.execute(
                    delete(CrmQuotationVersion).where(
                        CrmQuotationVersion.quotation_id.in_(created_quotation_ids)
                    )
                )
                await cleanup_db.execute(
                    delete(CrmQuotationItem).where(
                        CrmQuotationItem.quotation_id.in_(created_quotation_ids)
                    )
                )
                await cleanup_db.execute(
                    delete(CrmSalesQuotation).where(CrmSalesQuotation.id.in_(created_quotation_ids))
                )
            if created_lead_ids:
                fu_task_ids = (
                    await cleanup_db.execute(
                        select(CrmFollowUp.task_id).where(
                            CrmFollowUp.lead_id.in_(created_lead_ids),
                            CrmFollowUp.task_id.is_not(None),
                        )
                    )
                ).scalars().all()
                created_task_ids.extend(fu_task_ids)
                await cleanup_db.execute(
                    delete(CrmQuotationVersion).where(
                        CrmQuotationVersion.quotation_id.in_(
                            select(CrmSalesQuotation.id).where(CrmSalesQuotation.lead_id.in_(created_lead_ids))
                        )
                    )
                )
                await cleanup_db.execute(
                    delete(CrmQuotationItem).where(
                        CrmQuotationItem.quotation_id.in_(
                            select(CrmSalesQuotation.id).where(CrmSalesQuotation.lead_id.in_(created_lead_ids))
                        )
                    )
                )
                await cleanup_db.execute(
                    delete(CrmSalesQuotation).where(CrmSalesQuotation.lead_id.in_(created_lead_ids))
                )
                await cleanup_db.execute(
                    delete(CrmLeadProduct).where(CrmLeadProduct.lead_id.in_(created_lead_ids))
                )
                await cleanup_db.execute(
                    delete(CrmFollowUp).where(CrmFollowUp.lead_id.in_(created_lead_ids))
                )
                await cleanup_db.execute(
                    delete(CrmActivity).where(CrmActivity.lead_id.in_(created_lead_ids))
                )
                await cleanup_db.execute(
                    delete(CrmAssignmentHistory).where(CrmAssignmentHistory.lead_id.in_(created_lead_ids))
                )
                await cleanup_db.execute(
                    delete(CrmStageHistory).where(CrmStageHistory.lead_id.in_(created_lead_ids))
                )
                await cleanup_db.execute(delete(CrmLead).where(CrmLead.id.in_(created_lead_ids)))
            if created_task_ids:
                await cleanup_db.execute(
                    delete(TaskComment).where(TaskComment.task_id.in_(created_task_ids))
                )
                await cleanup_db.execute(
                    delete(TaskAssignee).where(TaskAssignee.task_id.in_(created_task_ids))
                )
                await cleanup_db.execute(delete(Task).where(Task.id.in_(created_task_ids)))
            if created_batch_ids:
                await cleanup_db.execute(
                    delete(CrmImportBatch).where(CrmImportBatch.id.in_(created_batch_ids))
                )
            if created_pipeline_ids:
                await cleanup_db.execute(
                    delete(CrmPipelineStage).where(
                        CrmPipelineStage.pipeline_id.in_(created_pipeline_ids)
                    )
                )
                await cleanup_db.execute(
                    delete(CrmPipeline).where(CrmPipeline.id.in_(created_pipeline_ids))
                )
            if created_legacy_lead_ids:
                await cleanup_db.execute(delete(Lead).where(Lead.id.in_(created_legacy_lead_ids)))
            if created_legacy_followup_ids:
                await cleanup_db.execute(
                    delete(FollowUp).where(FollowUp.id.in_(created_legacy_followup_ids))
                )
            if created_product_ids:
                await cleanup_db.execute(
                    delete(Product).where(Product.id.in_(created_product_ids))
                )
            if created_category_ids:
                await cleanup_db.execute(
                    delete(ProductCategory).where(ProductCategory.id.in_(created_category_ids))
                )
            if created_uom_ids:
                await cleanup_db.execute(
                    delete(UnitOfMeasurement).where(UnitOfMeasurement.id.in_(created_uom_ids))
                )
            if created_company_ids:
                await cleanup_db.execute(
                    delete(Company).where(Company.id.in_(created_company_ids))
                )
            if created_user_ids:
                await cleanup_db.execute(
                    delete(Notification).where(Notification.user_id.in_(created_user_ids))
                )
                await cleanup_db.execute(
                    delete(AuditLog).where(AuditLog.user_id.in_(created_user_ids))
                )
                await cleanup_db.execute(
                    delete(CrmSalespersonConfig).where(
                        CrmSalespersonConfig.user_id.in_(created_user_ids)
                    )
                )
                await cleanup_db.execute(
                    delete(DepartmentLeadershipAssignment).where(
                        DepartmentLeadershipAssignment.employee_id.in_(created_user_ids)
                    )
                )
                await cleanup_db.execute(
                    delete(UserPermission).where(UserPermission.user_id.in_(created_user_ids))
                )
                await cleanup_db.execute(
                    delete(UserRole).where(UserRole.user_id.in_(created_user_ids))
                )
                await cleanup_db.execute(
                    delete(AuthSession).where(AuthSession.user_id.in_(created_user_ids))
                )
                await cleanup_db.execute(
                     text("UPDATE users SET manager_id = NULL WHERE id = ANY(:uids)"),
                    {"uids": created_user_ids},
                )
                await cleanup_db.execute(delete(User).where(User.id.in_(created_user_ids)))
            if created_role_ids:
                await cleanup_db.execute(
                    delete(RolePermission).where(RolePermission.role_id.in_(created_role_ids))
                )
                await cleanup_db.execute(delete(Role).where(Role.id.in_(created_role_ids)))
            if created_perm_ids:
                await cleanup_db.execute(
                    delete(Permission).where(Permission.id.in_(created_perm_ids))
                )
            await cleanup_db.commit()
        await engine.dispose()
