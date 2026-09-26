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
        password: str | None = None,
    ) -> dict[str, Any]:
        """
        Provision the minimum required local ERP user account.

        Returns a dictionary containing at least `{"local_user_id": str, "created": bool}`.
        """
        raise NotImplementedError

    @abstractmethod
    async def set_local_user_access(
        self, erp: ErpInstance, local_user_id: str, *, allow_login: bool, reason: str | None = None
    ) -> dict[str, Any] | None:
        """
        Block or restore a local account's ability to authenticate in the target ERP.

        Used by GlobalUser status changes (suspend/disable/re-enable) and
        by ErpMembership suspend/restore, to enforce ERP_Main's central
        access decision on the local side -- never to modify local
        RBAC/roles, and never to delete or provision an account.

        Returns a dictionary containing at least `{"local_user_id": str,
        "can_login": bool}` on success, or None if the target ERP could
        not be reached (a soft failure -- see HttpErpProvisioningAdapter
        for why this is intentionally non-fatal to the caller).
        """
        raise NotImplementedError

    async def deprovision_local_user(
        self, erp: ErpInstance, local_user_id: str, *, reason: str | None = None
    ) -> dict[str, Any] | None:
        """
        Remove/deprovision a local user account when access is removed in ERP_Main.
        """
        return None