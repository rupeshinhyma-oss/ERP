"""Global User Repository -- pure DB access, no business rules."""

from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.global_users.models import GlobalUser


class GlobalUserRepository:
    """Data access for the `global_users` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_by_id(self, user_id: uuid.UUID) -> GlobalUser | None:
        """Fetch a single Global User by id, or None if not found."""
        result = await self.db.execute(select(GlobalUser).where(GlobalUser.id == user_id))
        return result.scalar_one_or_none()

    async def get_by_email(self, primary_email: str) -> GlobalUser | None:
        """Fetch a single Global User by primary email, or None if not found."""
        result = await self.db.execute(select(GlobalUser).where(GlobalUser.primary_email == primary_email))
        return result.scalar_one_or_none()

    async def list_all(
        self,
        *,
        limit: int = 100,
        offset: int = 0,
        search: str | None = None,
        status: str | None = None,
        erp_id: uuid.UUID | None = None,
        no_erp: bool = False,
    ) -> list[GlobalUser]:
        """List Global Users, paged; optional name/email search, status filter (comma list) and ERP filters."""
        stmt = select(GlobalUser)
        if search and search.strip():
            like = f"%{search.strip().lower()}%"
            stmt = stmt.where(
                or_(func.lower(GlobalUser.primary_email).like(like), func.lower(GlobalUser.display_name).like(like))
            )
        if status and status.strip().upper() not in ("", "ALL"):
            wanted = [s.strip().upper() for s in status.split(",") if s.strip()]
            if wanted:
                stmt = stmt.where(GlobalUser.status.in_(wanted))
        if erp_id is not None or no_erp:
            from app.erp_memberships.models import ErpMembership, ErpMembershipStatus

            live = select(ErpMembership.id).where(
                ErpMembership.global_user_id == GlobalUser.id, ErpMembership.status != ErpMembershipStatus.REVOKED
            )
            if erp_id is not None:
                stmt = stmt.where(live.where(ErpMembership.erp_instance_id == erp_id).exists())
            else:
                stmt = stmt.where(~live.exists())
        result = await self.db.execute(stmt.order_by(GlobalUser.created_at, GlobalUser.id).limit(limit).offset(offset))
        return list(result.scalars().all())

    async def create(self, user: GlobalUser) -> GlobalUser:
        """Persist a new `GlobalUser` row and flush so its generated id is available."""
        self.db.add(user)
        await self.db.flush()
        await self.db.refresh(user)
        return user