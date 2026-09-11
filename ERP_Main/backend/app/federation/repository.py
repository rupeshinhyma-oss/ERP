"""Federation Repository -- pure DB access, no business rules."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.federation.models import AuthorizationRequest, FederationClient, SigningKey, SigningKeyStatus


class SigningKeyRepository:
    """Data access for the `federation_signing_keys` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_active(self) -> SigningKey | None:
        """Fetch the current ACTIVE signing key, or None if none exists yet."""
        result = await self.db.execute(select(SigningKey).where(SigningKey.status == SigningKeyStatus.ACTIVE))
        return result.scalars().first()

    async def get_by_kid(self, kid: str) -> SigningKey | None:
        """Fetch a signing key by its `kid`, or None if not found."""
        result = await self.db.execute(select(SigningKey).where(SigningKey.kid == kid))
        return result.scalar_one_or_none()

    async def list_publishable(self) -> list[SigningKey]:
        """List every key still worth publishing in JWKS (ACTIVE or RETIRING, never RETIRED)."""
        result = await self.db.execute(
            select(SigningKey).where(SigningKey.status != SigningKeyStatus.RETIRED)
        )
        return list(result.scalars().all())

    async def create(self, key: SigningKey) -> SigningKey:
        """Persist a signing key row and flush so its generated id is available."""
        self.db.add(key)
        await self.db.flush()
        await self.db.refresh(key)
        return key


class FederationClientRepository:
    """Data access for the `federation_clients` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_by_id(self, client_row_id: uuid.UUID) -> FederationClient | None:
        """Fetch a federation client by its internal row id, or None if not found."""
        result = await self.db.execute(select(FederationClient).where(FederationClient.id == client_row_id))
        return result.scalar_one_or_none()

    async def get_by_client_id(self, client_id: str) -> FederationClient | None:
        """Fetch a federation client by its public `client_id`, or None if not found."""
        result = await self.db.execute(select(FederationClient).where(FederationClient.client_id == client_id))
        return result.scalar_one_or_none()

    async def get_by_erp_instance_id(self, erp_instance_id: uuid.UUID) -> FederationClient | None:
        """Fetch the federation client registered for a given ERP instance, or None if not registered."""
        result = await self.db.execute(
            select(FederationClient).where(FederationClient.erp_instance_id == erp_instance_id)
        )
        return result.scalar_one_or_none()

    async def create(self, client: FederationClient) -> FederationClient:
        """Persist a new federation client row and flush so its generated id is available."""
        self.db.add(client)
        await self.db.flush()
        await self.db.refresh(client)
        return client


class AuthorizationRequestRepository:
    """Data access for the `federation_authorization_requests` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_by_code(self, authorization_code: str) -> AuthorizationRequest | None:
        """Fetch an authorization request by its authorization code, or None if not found."""
        result = await self.db.execute(
            select(AuthorizationRequest).where(AuthorizationRequest.authorization_code == authorization_code)
        )
        return result.scalar_one_or_none()

    async def create(self, request_row: AuthorizationRequest) -> AuthorizationRequest:
        """Persist a new authorization request row and flush so its generated id is available."""
        self.db.add(request_row)
        await self.db.flush()
        await self.db.refresh(request_row)
        return request_row
