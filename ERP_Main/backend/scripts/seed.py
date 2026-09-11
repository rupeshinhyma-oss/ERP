"""
Bootstrap / Seed Script for ERP_Main Global Control Plane.

Runs in order:
1. scripts.seed_registry        -- registers Yinglima and Inhyma ERP instances and modules
2. scripts.seed_platform_authz   -- seeds the 32 platform permissions and 4 starter roles
3. Bootstrap Platform Super Admin -- seeds admin@platform.local (role: SUPER_ADMIN)
4. Bootstrap Global User         -- seeds admin@platform.local with memberships to Yinglima & Inhyma

Idempotent: safe to run multiple times. Existing records are preserved and never overwritten.

Usage:
    python -m scripts.seed
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import uuid

from sqlalchemy import select

from app.database.engine import dispose_engine, get_sessionmaker
from app.erp_memberships.models import ErpMembership, ErpMembershipStatus
from app.erp_registry.models import ErpInstance
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.repository import GlobalAuditRepository
from app.global_audit.service import GlobalAuditService
from app.core.config import settings
from app.global_auth.models import GlobalUserCredential
from app.global_auth.security import hash_password as hash_global_password
from app.global_users.models import GlobalUser, GlobalUserStatus
from app.platform_auth.models import PlatformAdmin, PlatformAdminRole
from app.platform_auth.security import hash_password as hash_admin_password
from app.platform_authz.models import AuthorizationScope, PlatformRole, PlatformRoleAssignment
from scripts import seed_platform_authz, seed_registry

BOOTSTRAP_EMAIL = settings.BOOTSTRAP_ADMIN_EMAIL
BOOTSTRAP_PASSWORD = settings.BOOTSTRAP_ADMIN_PASSWORD
BOOTSTRAP_DISPLAY_NAME = settings.BOOTSTRAP_ADMIN_NAME


async def seed_bootstrap_accounts() -> None:
    """Idempotently seed the bootstrap PlatformAdmin and GlobalUser accounts."""
    session_factory = get_sessionmaker()
    async with session_factory() as db:
        audit = GlobalAuditService(repository=GlobalAuditRepository(db))

        # ------------------------------------------------------------------
        # 1. Platform Super Admin (Control Plane Admin)
        # ------------------------------------------------------------------
        admin_stmt = select(PlatformAdmin).where(PlatformAdmin.email == BOOTSTRAP_EMAIL)
        existing_admin = await db.scalar(admin_stmt)
        if existing_admin is None:
            admin = PlatformAdmin(
                email=BOOTSTRAP_EMAIL,
                display_name=BOOTSTRAP_DISPLAY_NAME,
                password_hash=hash_admin_password(BOOTSTRAP_PASSWORD),
                role=PlatformAdminRole.SUPER_ADMIN,
                is_active=True,
            )
            db.add(admin)
            await db.flush()
            await audit.record(
                event_type=AuditEventType.PLATFORM_ADMIN_CREATED,
                actor_type=AuditActorType.SYSTEM,
                actor_label="scripts.seed",
                target_type="platform_admin",
                target_id=admin.id,
                details={"role": admin.role.value, "bootstrap": True},
            )
            print(f"Created bootstrap Platform Admin: {BOOTSTRAP_EMAIL} (role: {admin.role.value})")
        else:
            print(f"Platform Admin {BOOTSTRAP_EMAIL} already exists (skipped).")

        # ------------------------------------------------------------------
        # 2. Global User (End-User Identity for SSO & Memberships)
        # ------------------------------------------------------------------
        user_stmt = select(GlobalUser).where(GlobalUser.primary_email == BOOTSTRAP_EMAIL)
        existing_user = await db.scalar(user_stmt)
        if existing_user is None:
            user = GlobalUser(
                primary_email=BOOTSTRAP_EMAIL,
                display_name=BOOTSTRAP_DISPLAY_NAME,
                status=GlobalUserStatus.ACTIVE,
            )
            db.add(user)
            await db.flush()

            # Global credential
            cred = GlobalUserCredential(
                global_user_id=user.id,
                password_hash=hash_global_password(BOOTSTRAP_PASSWORD),
                must_change_password=False,
            )
            db.add(cred)
            await db.flush()
            print(f"Created bootstrap Global User: {BOOTSTRAP_EMAIL}")
            existing_user = user
        else:
            print(f"Global User {BOOTSTRAP_EMAIL} already exists (skipped).")

        # ------------------------------------------------------------------
        # 3. Memberships for Yinglima and Inhyma
        # ------------------------------------------------------------------
        instances_stmt = select(ErpInstance)
        instances = (await db.scalars(instances_stmt)).all()
        now = datetime.now(timezone.utc)

        for instance in instances:
            membership_by_local = await db.scalar(
                select(ErpMembership).where(
                    ErpMembership.erp_instance_id == instance.id,
                    ErpMembership.local_user_id == "1",
                )
            )
            if membership_by_local is not None:
                if membership_by_local.global_user_id != existing_user.id:
                    membership_by_local.global_user_id = existing_user.id
                    membership_by_local.status = ErpMembershipStatus.ACTIVE
                    print(f"Updated membership: re-linked {instance.key} (local_user_id='1') -> {BOOTSTRAP_EMAIL}")
                else:
                    print(f"Membership for {instance.key} already exists (skipped).")
            else:
                membership = ErpMembership(
                    global_user_id=existing_user.id,
                    erp_instance_id=instance.id,
                    local_user_id="1",  # Local super_admin id in Yinglima/Inhyma
                    status=ErpMembershipStatus.ACTIVE,
                    linked_at=now,
                    verified_at=now,
                )
                db.add(membership)
                print(f"Linked membership: {BOOTSTRAP_EMAIL} -> {instance.key} (local_user_id='1')")

        # ------------------------------------------------------------------
        # 4. Global Role Assignment (PLATFORM_SUPER_ADMIN)
        # ------------------------------------------------------------------
        role_stmt = select(PlatformRole).where(PlatformRole.role_key == "PLATFORM_SUPER_ADMIN")
        super_admin_role = await db.scalar(role_stmt)
        if super_admin_role is not None:
            assignment_stmt = select(PlatformRoleAssignment).where(
                PlatformRoleAssignment.global_user_id == existing_user.id,
                PlatformRoleAssignment.role_id == super_admin_role.id,
                PlatformRoleAssignment.scope == AuthorizationScope.GLOBAL,
            )
            existing_assignment = await db.scalar(assignment_stmt)
            if existing_assignment is None:
                assignment = PlatformRoleAssignment(
                    global_user_id=existing_user.id,
                    role_id=super_admin_role.id,
                    scope=AuthorizationScope.GLOBAL,
                    erp_instance_id=None,
                    is_active=True,
                    assigned_by=uuid.UUID(int=0),
                )
                db.add(assignment)
                print(f"Assigned PLATFORM_SUPER_ADMIN role to {BOOTSTRAP_EMAIL}")
            else:
                print(f"PLATFORM_SUPER_ADMIN assignment already exists (skipped).")

        await db.commit()
    await dispose_engine()


async def main() -> None:
    """Execute all seed steps in sequence."""
    print("\n[scripts.seed] 1. Seeding ERP Registry...")
    await seed_registry.seed()

    print("\n[scripts.seed] 2. Seeding Platform Authorization Catalog & Roles...")
    await seed_platform_authz.seed()

    print("\n[scripts.seed] 3. Seeding Bootstrap Accounts & Memberships...")
    await seed_bootstrap_accounts()

    print("\n" + "=" * 70)
    print("ERP_Main Bootstrap Complete!")
    print(f"  Platform Admin:    {BOOTSTRAP_EMAIL}")
    print(f"  Global User:       {BOOTSTRAP_EMAIL}")
    print(f"  Initial Password:  {BOOTSTRAP_PASSWORD}")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
