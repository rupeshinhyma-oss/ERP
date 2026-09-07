"""ERP Service Credential Repository -- pure DB access, no business rules."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.service_identity.models import ErpServiceCredential


class ErpServiceCredentialRepository:
    """Data access for the `erp_service_credentials` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_by_identifier(self, credential_identifier: str) -> ErpServiceCredential | None:
        """Fetch a single credential by its public identifier, or None if not found."""
        result = await self.db.execute(
            select(ErpServiceCredential).where(ErpServiceCredential.credential_identifier == credential_identifier)
        )
        return result.scalar_one_or_none()

    async def get_by_id(self, credential_id: uuid.UUID) -> ErpServiceCredential | None:
        """Fetch a single credential by its internal id, or None if not found."""
        result = await self.db.execute(select(ErpServiceCredential).where(ErpServiceCredential.id == credential_id))
        return result.scalar_one_or_none()

    async def list_for_erp(self, erp_instance_id: uuid.UUID) -> list[ErpServiceCredential]:
        """List every credential (active or not) belonging to an ERP instance."""
        result = await self.db.execute(
            select(ErpServiceCredential)
            .where(ErpServiceCredential.erp_instance_id == erp_instance_id)
            .order_by(ErpServiceCredential.created_at.desc())
        )
        return list(result.scalars().all())

    async def create(self, credential: ErpServiceCredential) -> ErpServiceCredential:
        """Persist a new credential row and flush so its generated id is available."""
        self.db.add(credential)
        await self.db.flush()
        await self.db.refresh(credential)
        return credential
