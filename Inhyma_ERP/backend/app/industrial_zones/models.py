"""
Industrial Zone ORM Model.

Tracks industrial clusters, zones, geographic locations, number of industries,
zone grades, target machine categories, and related marketing intelligence.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class IndustrialZone(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """An Industrial Zone / Cluster entity."""

    __tablename__ = "industrial_zones"

    zone_name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    state: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    district: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    nearby_city: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    distance_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    num_industries: Mapped[int | None] = mapped_column(Integer, nullable=True)
    zone_grade: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)  # "A" or "B"
    industry_types: Mapped[str | None] = mapped_column(String(255), nullable=True)
    potential_machine_categories: Mapped[str | None] = mapped_column(String(255), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:
        return f"<IndustrialZone id={self.id!r} zone_name={self.zone_name!r} grade={self.zone_grade!r}>"
