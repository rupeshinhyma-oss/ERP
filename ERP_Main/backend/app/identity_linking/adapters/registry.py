"""
ERP Provisioning Adapter Registry (Prompt 2 Section 11).

Maintains available provisioning adapters without hardcoded branching in business logic.
New ERPs are onboarded via configuration or adapter registration.
"""

from __future__ import annotations

from typing import Dict

from app.erp_registry.models import ErpInstance
from app.identity_linking.adapters.base import BaseErpProvisioningAdapter
from app.identity_linking.adapters.http_adapter import HttpErpProvisioningAdapter


class ErpAdapterRegistry:
    """Registry mapping ERP keys or capabilities to specific adapter implementations."""

    def __init__(self, default_adapter: BaseErpProvisioningAdapter | None = None) -> None:
        self._default_adapter = default_adapter or HttpErpProvisioningAdapter()
        self._adapters: Dict[str, BaseErpProvisioningAdapter] = {}

    def register(self, erp_key: str, adapter: BaseErpProvisioningAdapter) -> None:
        """Register a custom adapter for an ERP key."""
        self._adapters[erp_key.lower().strip()] = adapter

    def get_adapter(self, erp: ErpInstance) -> BaseErpProvisioningAdapter:
        """Resolve the appropriate adapter for this ERP instance."""
        return self._adapters.get(erp.key.lower().strip(), self._default_adapter)


_GLOBAL_REGISTRY: ErpAdapterRegistry | None = None


def get_adapter_registry() -> ErpAdapterRegistry:
    """Get the singleton adapter registry instance."""
    global _GLOBAL_REGISTRY
    if _GLOBAL_REGISTRY is None:
        _GLOBAL_REGISTRY = ErpAdapterRegistry()
    return _GLOBAL_REGISTRY
