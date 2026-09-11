"""
Generic Projection Framework & Registry for Global Reporting (Phase 7).

Provides:
- ProjectionDefinition: Declarative registration of projection read models, source events, and mapping logic.
- ProjectionRegistry: Central catalog of all active and supported projections.
- ProjectionProcessor: Reusable processing pipeline handling idempotency, version sequencing, and checkpointing.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Generic, Type, TypeVar

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

TModel = TypeVar("TModel")


@dataclass
class ProjectionDefinition(Generic[TModel]):
    """
    Declarative specification of a projection read model.
    """

    entity_type: str
    event_types: list[str]
    model_class: Type[TModel]
    table_name: str
    id_field: str = "source_entity_id"
    version_field: str = "version"
    supports_search: bool = True
    display_name: str = ""
    description: str = ""
    # Transform function: (event_payload, event_metadata) -> dict of model fields
    mapper: Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]] | None = None
    search_fields: list[str] = field(default_factory=list)


class ProjectionRegistry:
    """
    Registry for all global reporting projections.
    """

    def __init__(self) -> None:
        self._projections_by_entity: dict[str, ProjectionDefinition[Any]] = {}
        self._projections_by_event: dict[str, list[ProjectionDefinition[Any]]] = {}

    def register(self, definition: ProjectionDefinition[Any]) -> None:
        """Register a projection definition."""
        self._projections_by_entity[definition.entity_type] = definition
        for ev in definition.event_types:
            if ev not in self._projections_by_event:
                self._projections_by_event[ev] = []
            if definition not in self._projections_by_event[ev]:
                self._projections_by_event[ev].append(definition)
        logger.info(
            "Registered projection for entity_type=%s, events=%s",
            definition.entity_type,
            definition.event_types,
        )

    def get_by_entity_type(self, entity_type: str) -> ProjectionDefinition[Any] | None:
        return self._projections_by_entity.get(entity_type)

    def get_by_event_type(self, event_type: str) -> list[ProjectionDefinition[Any]]:
        return self._projections_by_event.get(event_type, [])

    def list_all(self) -> list[ProjectionDefinition[Any]]:
        return list(self._projections_by_entity.values())

    def supported_entities(self) -> list[str]:
        return list(self._projections_by_entity.keys())


# Singleton global projection registry
registry = ProjectionRegistry()


def _register_defaults() -> None:
    from app.reporting.models import (
        GlobalBuyerProjection,
        GlobalInquiryProjection,
        GlobalProductProjection,
        GlobalSupplierProjection,
    )

    registry.register(
        ProjectionDefinition(
            entity_type="buyer",
            event_types=["buyer.created", "buyer.updated"],
            model_class=GlobalBuyerProjection,
            table_name="global_buyer_projections",
            display_name="Global Buyers",
            description="Buyer accounts across connected ERP instances.",
            search_fields=["company_name"],
        )
    )

    registry.register(
        ProjectionDefinition(
            entity_type="supplier",
            event_types=["supplier.created", "supplier.updated"],
            model_class=GlobalSupplierProjection,
            table_name="global_supplier_projections",
            display_name="Global Suppliers",
            description="Suppliers and vendor profiles across connected ERP instances.",
            search_fields=["name", "supplier_code"],
        )
    )

    registry.register(
        ProjectionDefinition(
            entity_type="product",
            event_types=["product.created", "product.updated"],
            model_class=GlobalProductProjection,
            table_name="global_product_projections",
            display_name="Global Products",
            description="Product catalog and master SKUs across connected ERP instances.",
            search_fields=["name", "product_code"],
        )
    )

    registry.register(
        ProjectionDefinition(
            entity_type="inquiry",
            event_types=["inquiry.created", "inquiry.updated"],
            model_class=GlobalInquiryProjection,
            table_name="global_inquiry_projections",
            display_name="Global Inquiries",
            description="Inquiry consignments and requirement lines across connected ERP instances.",
            search_fields=["inquiry_number", "buyer_name"],
        )
    )


_register_defaults()
