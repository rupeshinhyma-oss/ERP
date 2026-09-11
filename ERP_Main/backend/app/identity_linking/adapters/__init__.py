"""
ERP Provisioning Adapter Abstraction (Prompt 2 Section 11).
Decouples identity service from specific ERP implementations.
"""

from app.identity_linking.adapters.base import BaseErpProvisioningAdapter
from app.identity_linking.adapters.http_adapter import HttpErpProvisioningAdapter
from app.identity_linking.adapters.registry import ErpAdapterRegistry, get_adapter_registry

__all__ = [
    "BaseErpProvisioningAdapter",
    "HttpErpProvisioningAdapter",
    "ErpAdapterRegistry",
    "get_adapter_registry",
]
