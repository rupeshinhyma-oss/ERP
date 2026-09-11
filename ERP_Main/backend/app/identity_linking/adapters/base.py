"""
Base ERP Provisioning Adapter Interface (Prompt 2 Section 11).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from app.erp_registry.models import ErpInstance


class BaseErpProvisioningAdapter(ABC):
    """Abstract interface for provisioning and inspecting local accounts in an ERP instance."""

    @abstractmethod
    async def check_local_user(self, erp: ErpInstance, email_or_username: str) -> dict[str, Any] | None:
        """
        Check if a user account already exists in the target ERP by email or username.

        Returns a dictionary containing `{"exists": True, "local_user_id": ..., "email": ...}`
        or None if no matching account exists.
        """
        raise NotImplementedError

    @abstractmethod
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
        """
        Provision the minimum required local ERP user account.

        Returns a dictionary containing at least `{"local_user_id": str, "created": bool}`.
        """
        raise NotImplementedError
