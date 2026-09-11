"""
HTTP ERP Provisioning Adapter (Prompt 2 Section 11).

Communicates with any compliant ERP instance over HTTP via its internal
service endpoints (/api/v1/internal/users/check and /provision).
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings
from app.core.exceptions import BadRequestException
from app.erp_registry.models import ErpInstance
from app.identity_linking.adapters.base import BaseErpProvisioningAdapter

logger = logging.getLogger(__name__)


class HttpErpProvisioningAdapter(BaseErpProvisioningAdapter):
    """Standard adapter communicating with ERPs via their internal REST endpoints."""

    def __init__(self, timeout: float = 10.0) -> None:
        self.timeout = timeout

    def _get_headers(self, erp: ErpInstance) -> dict[str, str]:
        """Construct machine-to-machine authentication headers."""
        # Uses platform secret / service credential to authenticate calls to ERP instances
        token = getattr(settings, "PLATFORM_JWT_SECRET_KEY", "system-internal-token")
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-Caller-Source": "ERP_Main",
        }

    async def check_local_user(self, erp: ErpInstance, email_or_username: str) -> dict[str, Any] | None:
        """Check if an account exists in the target ERP."""
        if not erp.base_url:
            logger.warning("ERP instance %s has no base_url configured; skipping live check.", erp.key)
            return None

        url = f"{erp.base_url.rstrip('/')}/api/v1/internal/users/check"
        payload = {"identifier": email_or_username}

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(url, json=payload, headers=self._get_headers(erp))
                if response.status_code == 200:
                    data = response.json().get("data", {})
                    if data.get("exists"):
                        return data
                return None
        except Exception as exc:
            logger.warning("Failed to reach ERP %s at %s for user check: %s", erp.key, url, exc)
            return None

    async def provision_local_user(
        self,
        erp: ErpInstance,
        *,
        email: str,
        display_name: str,
        username: str | None = None,
        first_name: str | None = None,
        last_name: str | None = None,
        target_organization_id: str | None = None,
    ) -> dict[str, Any]:
        """Provision a minimal user account in the target ERP."""
        if not erp.base_url:
            raise BadRequestException(f"ERP instance '{erp.key}' has no base_url configured for provisioning.")

        url = f"{erp.base_url.rstrip('/')}/api/v1/internal/users/provision"
        payload = {
            "email": email,
            "display_name": display_name,
            "username": username,
            "first_name": first_name or display_name.split()[0],
            "last_name": last_name or (display_name.split()[-1] if len(display_name.split()) > 1 else None),
            "target_organization_id": target_organization_id,
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(url, json=payload, headers=self._get_headers(erp))
                if response.status_code in (200, 201):
                    data = response.json().get("data", {})
                    if "local_user_id" in data:
                        return data
                raise BadRequestException(
                    f"ERP {erp.key!r} provisioning failed with HTTP {response.status_code}: {response.text[:200]}"
                )
        except httpx.HTTPError as exc:
            raise BadRequestException(f"Could not connect to ERP {erp.key!r} at {url}: {exc}") from exc
