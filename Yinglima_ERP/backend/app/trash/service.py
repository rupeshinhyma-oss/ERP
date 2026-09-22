"""
Trash Service -- Queries and manages soft-deleted items across all system models.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Type

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ConflictException, NotFoundException

# Import every model that supports soft-delete (has SoftDeleteMixin), so
# Trash can list/restore/purge it. This list is deliberately exhaustive --
# see app/database/base.py's SoftDeleteMixin docstring for the policy:
# every user-facing delete in the system is a soft delete, so every
# soft-deletable model belongs here or it becomes invisible to Trash and
# to the 4-year auto-purge worker (app.trash.purge_worker).
from app.masters.products.models import Product
from app.masters.product_categories.models import ProductCategory
from app.masters.product_sub_categories.models import ProductSubCategory
from app.masters.brands.models import Brand
from app.masters.uom.models import UnitOfMeasurement
from app.masters.hsn.models import HsnCode
from app.masters.countries.models import Country
from app.masters.states.models import State
from app.masters.cities.models import City
from app.masters.currencies.models import Currency
from app.masters.supplier_types.models import SupplierType
from app.masters.buyer_types.models import BuyerType
from app.masters.company_list.models import MasterCompany
from app.suppliers.models import Supplier, SupplierContact
from app.buyers.models import Buyer, BuyerContact
from app.users.models import User
from app.rbac.models import Role
from app.inquiries.models import ConsignmentCode, Inquiry, InquiryItem
from app.planning.models import PlanningChangeLog, PlanningSheet, PlanningRow, PlanningColumn, PlanningStatusTag

# (model class, primary display-name attribute, secondary "code"-like
# attribute or None). ``name_attr`` MUST be a real attribute on the model
# -- getattr() silently falls through to the generic "{entity_type} {id}"
# fallback in list_trash() below for a typo'd/nonexistent attribute name,
# which is exactly what previously happened for "Product" (used "title"/
# "sku", but Product's real fields are "product_name"/"product_code" --
# every deleted product in Trash showed a blank, useless label because of
# this). Verify against the actual model file when adding a new entry.
MODEL_MAP: dict[str, tuple[Type[Any], str, str | None]] = {
    "Product": (Product, "product_name", "product_code"),
    "Category": (ProductCategory, "name", "code"),
    "SubCategory": (ProductSubCategory, "name", "code"),
    "Brand": (Brand, "name", "code"),
    "UOM": (UnitOfMeasurement, "name", "code"),
    "HSN Code": (HsnCode, "code", None),
    "Country": (Country, "name", "code"),
    "State": (State, "name", "code"),
    "City": (City, "name", None),
    "Currency": (Currency, "name", "code"),
    "Supplier Type": (SupplierType, "name", "code"),
    "Buyer Type": (BuyerType, "name", "code"),
    "Company": (MasterCompany, "name", "code"),
    "Supplier": (Supplier, "company_name", "supplier_code"),
    "Supplier Contact": (SupplierContact, "person_name", None),
    "Buyer": (Buyer, "company_name", None),
    "Buyer Contact": (BuyerContact, "person_name", None),
    "User": (User, "username", "employee_code"),
    "Role": (Role, "name", None),
    "Consignment Code": (ConsignmentCode, "code", None),
    "Inquiry": (Inquiry, "id", None),
    "Inquiry Item": (InquiryItem, "id", None),
    "Planning Sheet": (PlanningSheet, "name", None),
    "Planning Row": (PlanningRow, "label", None),
    "Planning Column": (PlanningColumn, "name", None),
    "Planning Status Tag": (PlanningStatusTag, "label", None),
}

# Phase 8 item 9/16: list_trash() used to run an UNBOUNDED
# `SELECT * WHERE deleted_at IS NOT NULL` against every one of the models
# above, on every single Trash page load, then merge-sorted the entire
# result set in Python. A trash bin is, by nature, an ever-growing table
# (nothing is ever hard-deleted from it until a user restores it or the
# retention window elapses -- see TrashPurgeWorker), so this had no
# ceiling -- it would have gotten slower forever. Each model is now capped
# to its MOST RECENTLY deleted rows (already the ones the user cares
# about -- Trash is sorted newest-first) via `ORDER BY deleted_at DESC
# LIMIT N` pushed into Postgres, bounding total worst-case rows fetched at
# ``len(MODEL_MAP) * _PER_MODEL_FETCH_CAP`` instead of "every soft-deleted
# row that has ever existed". True cross-table keyset pagination isn't
# practical here (heterogeneous tables, no common UNION-able shape), so
# this bounded-fetch-then-merge approach is the safe middle ground.
_PER_MODEL_FETCH_CAP = 200


class TrashService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_trash(self) -> list[dict[str, Any]]:
        """
        Return recently soft-deleted records across registered models,
        newest-first, bounded per model (see ``_PER_MODEL_FETCH_CAP``
        above) so this endpoint stays fast as the trash bin grows.
        """
        results: list[dict[str, Any]] = []

        for entity_type, (model_cls, name_attr, code_attr) in MODEL_MAP.items():
            if not hasattr(model_cls, "deleted_at"):
                continue

            stmt = (
                select(model_cls)
                .where(model_cls.deleted_at.is_not(None))
                .order_by(model_cls.deleted_at.desc())
                .limit(_PER_MODEL_FETCH_CAP)
            )
            res = await self.db.execute(stmt)
            rows = res.scalars().all()

            for row in rows:
                name_val = getattr(row, name_attr, None) or f"{entity_type} {row.id}"
                if entity_type == "User" and hasattr(row, "first_name") and row.first_name:
                    name_val = f"{row.first_name} {row.last_name or ''}".strip()

                code_val = getattr(row, code_attr, None) if code_attr else None
                details = f"Code: {code_val}" if code_val else None

                # purge_at is informational only -- the ACTUAL purge
                # decision is made by TrashPurgeWorker re-deriving this
                # same "deleted_at + TRASH_RETENTION_DAYS" cutoff straight
                # from the DB at purge time, not by trusting a value
                # handed back from a previous list_trash() response.
                purge_at = (
                    row.deleted_at + timedelta(days=settings.TRASH_RETENTION_DAYS)
                    if row.deleted_at is not None
                    else None
                )

                results.append({
                    "id": str(row.id),
                    "entity_type": entity_type,
                    "name": str(name_val),
                    "details": details,
                    "deleted_at": row.deleted_at,
                    "purge_at": purge_at,
                })

        # Sort the merged (already-capped) results by deleted_at descending.
        results.sort(key=lambda x: x["deleted_at"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return results

    async def restore_item(self, entity_type: str, item_id: str) -> bool:
        """
        Restore a single soft-deleted item by setting deleted_at = None.

        Phase 8: no longer commits internally -- see module docstring on
        why the caller (route) now commits once after its whole loop, per
        the "minimize DB round trips" / "keep transactions focused" rules
        (items 18-19). ``app.database.session.get_db_session`` commits
        automatically once the request handler returns without error, so
        an explicit commit here was both redundant on the single-item
        path and actively harmful on the bulk (loop) path -- see
        ``app.trash.routes``.
        """
        if entity_type not in MODEL_MAP:
            raise NotFoundException(f"Unknown entity type '{entity_type}'.")

        model_cls, _, _ = MODEL_MAP[entity_type]
        uid = uuid.UUID(item_id)
        stmt = select(model_cls).where(model_cls.id == uid)
        res = await self.db.execute(stmt)
        row = res.scalar_one_or_none()

        if row is None:
            raise NotFoundException(f"{entity_type} with ID '{item_id}' not found.")

        row.deleted_at = None
        await self.db.flush()
        try:
            from app.cache.dependency import get_cache_manager
            cache = get_cache_manager()
            await cache.invalidate_dropdown()
        except Exception:
            pass
        return True

    async def check_dependencies(self, entity_type: str, item_id: uuid.UUID) -> list[str]:
        """
        Check whether an entity is referenced by historical/active business records.
        Returns a human-readable list of dependencies (e.g. ['2 Local Purchase orders', '1 Inquiry Quotation']).
        """
        deps: list[str] = []
        if entity_type == "Supplier":
            # Check local purchases
            try:
                from app.purchases.local.models import LocalPurchase
                lp_res = await self.db.execute(
                    select(func.count()).select_from(LocalPurchase).where(LocalPurchase.supplier_id == item_id)
                )
                lp_count = lp_res.scalar_one()
                if lp_count > 0:
                    deps.append(f"{lp_count} Local Purchase order{'s' if lp_count > 1 else ''}")
            except Exception:
                pass

            # Check inquiry quotes and RFQs
            try:
                from app.inquiries.models import Quotation, RFQ
                q_res = await self.db.execute(
                    select(func.count()).select_from(Quotation).where(Quotation.supplier_id == item_id)
                )
                q_count = q_res.scalar_one()
                if q_count > 0:
                    deps.append(f"{q_count} Inquiry Quotation{'s' if q_count > 1 else ''}")

                rfq_res = await self.db.execute(
                    select(func.count()).select_from(RFQ).where(RFQ.supplier_id == item_id)
                )
                rfq_count = rfq_res.scalar_one()
                if rfq_count > 0:
                    deps.append(f"{rfq_count} RFQ Dispatch{'es' if rfq_count > 1 else ''}")
            except Exception:
                pass

        elif entity_type == "Buyer":
            try:
                from app.inquiries.models import Inquiry
                inq_res = await self.db.execute(
                    select(func.count()).select_from(Inquiry).where(Inquiry.buyer_id == item_id)
                )
                inq_count = inq_res.scalar_one()
                if inq_count > 0:
                    deps.append(f"{inq_count} Inquiry{'ies' if inq_count > 1 else ''}")
            except Exception:
                pass

            try:
                from app.sales.models import SaleOrder
                so_res = await self.db.execute(
                    select(func.count()).select_from(SaleOrder).where(SaleOrder.buyer_id == item_id)
                )
                so_count = so_res.scalar_one()
                if so_count > 0:
                    deps.append(f"{so_count} Sale Order{'s' if so_count > 1 else ''}")
            except Exception:
                pass

        elif entity_type == "Product":
            try:
                from app.inquiries.models import InquiryItem
                ii_res = await self.db.execute(
                    select(func.count()).select_from(InquiryItem).where(InquiryItem.product_id == item_id)
                )
                ii_count = ii_res.scalar_one()
                if ii_count > 0:
                    deps.append(f"{ii_count} Inquiry Line Item{'s' if ii_count > 1 else ''}")
            except Exception:
                pass

            try:
                from app.purchases.local.models import LocalPurchaseItem
                lpi_res = await self.db.execute(
                    select(func.count()).select_from(LocalPurchaseItem).where(LocalPurchaseItem.product_id == item_id)
                )
                lpi_count = lpi_res.scalar_one()
                if lpi_count > 0:
                    deps.append(f"{lpi_count} Local Purchase Item{'s' if lpi_count > 1 else ''}")
            except Exception:
                pass

            try:
                from app.sales.models import SaleOrderItem
                soi_res = await self.db.execute(
                    select(func.count()).select_from(SaleOrderItem).where(SaleOrderItem.product_id == item_id)
                )
                soi_count = soi_res.scalar_one()
                if soi_count > 0:
                    deps.append(f"{soi_count} Sale Order Item{'s' if soi_count > 1 else ''}")
            except Exception:
                pass

        elif entity_type in ("Category", "SubCategory", "Brand", "UOM", "HSN Code"):
            try:
                col_name = {
                    "Category": "category_id",
                    "SubCategory": "sub_category_id",
                    "Brand": "brand_id",
                    "UOM": "uom_id",
                    "HSN Code": "hsn_code_id",
                }.get(entity_type)
                if col_name and hasattr(Product, col_name):
                    col = getattr(Product, col_name)
                    prod_res = await self.db.execute(
                        select(func.count()).select_from(Product).where(col == item_id)
                    )
                    prod_count = prod_res.scalar_one()
                    if prod_count > 0:
                        deps.append(f"{prod_count} Product{'s' if prod_count > 1 else ''}")
            except Exception:
                pass

        return deps

    async def hard_delete_item(self, entity_type: str, item_id: str) -> bool:
        """
        Permanently delete a soft-deleted item from the database.

        Checks for existing transaction/business references before deleting.
        If references exist, blocks deletion and explains the dependencies to protect
        audit/accounting integrity.
        """
        if entity_type not in MODEL_MAP:
            raise NotFoundException(f"Unknown entity type '{entity_type}'.")

        model_cls, name_attr, _ = MODEL_MAP[entity_type]
        uid = uuid.UUID(item_id)
        stmt = select(model_cls).where(model_cls.id == uid)
        res = await self.db.execute(stmt)
        row = res.scalar_one_or_none()

        if row is None:
            raise NotFoundException(f"{entity_type} with ID '{item_id}' not found.")

        item_name = getattr(row, name_attr, None) or f"{entity_type} {item_id}"

        # 1. Check for historical foreign-key dependencies before deleting
        deps = await self.check_dependencies(entity_type, uid)
        if deps:
            deps_str = ", ".join(deps)
            raise ConflictException(
                f"Cannot permanently delete {entity_type} '{item_name}' because it is linked to {deps_str}. "
                "This record will remain safely Archived in Trash to protect accounting and historical records."
            )

        if entity_type == "Planning Sheet":
            await self.db.execute(delete(PlanningChangeLog).where(PlanningChangeLog.sheet_id == uid))

        try:
            async with self.db.begin_nested():
                await self.db.delete(row)
                await self.db.flush()
        except IntegrityError:
            raise ConflictException(
                f"Cannot permanently delete {entity_type} '{item_name}' because other records in the system depend on it. "
                "This record will remain safely Archived in Trash."
            )

        return True

    async def empty_trash(self) -> tuple[int, int]:
        """
        Permanently hard-delete soft-deleted records across all models.
        Skips records that have active foreign-key dependencies so that
        past transaction history (Local Purchases, Inquiry Quotes) remains protected.

        Returns:
            (deleted_count, skipped_count)
        """
        deleted_count = 0
        skipped_count = 0

        for entity_type, (model_cls, _, _) in MODEL_MAP.items():
            if not hasattr(model_cls, "deleted_at"):
                continue

            if entity_type == "Planning Sheet":
                await self.db.execute(
                    delete(PlanningChangeLog).where(
                        PlanningChangeLog.sheet_id.in_(
                            select(PlanningSheet.id).where(PlanningSheet.deleted_at.is_not(None))
                        )
                    )
                )

            stmt = select(model_cls).where(model_cls.deleted_at.is_not(None))
            res = await self.db.execute(stmt)
            rows = res.scalars().all()

            for row in rows:
                uid = row.id
                deps = await self.check_dependencies(entity_type, uid)
                if deps:
                    skipped_count += 1
                    continue

                try:
                    async with self.db.begin_nested():
                        await self.db.delete(row)
                        await self.db.flush()
                        deleted_count += 1
                except IntegrityError:
                    skipped_count += 1

        if deleted_count > 0:
            await self.db.flush()

        return deleted_count, skipped_count

    async def purge_expired(self, *, retention_days: int | None = None) -> dict[str, int]:
        """
        Permanently hard-delete soft-deleted records PAST their retention window.

        Unlike ``empty_trash()`` (which nukes everything in Trash right
        now, on explicit user request), this only removes rows where
        ``deleted_at`` is older than ``retention_days`` (defaults to
        ``settings.TRASH_RETENTION_DAYS``, i.e. 4 years) -- this is the
        method the automatic daily purge job
        (``app.trash.purge_worker.TrashPurgeWorker``) calls, so recently
        soft-deleted records stay restorable for the FULL retention
        window and are never touched by this method until their window
        has actually elapsed. A record any user restores before then
        (``restore_item``, which clears ``deleted_at``) is completely
        exempt: this method only ever matches rows that are STILL
        soft-deleted AND old enough, so a restored-then-re-deleted record
        correctly gets a fresh cutoff from its new ``deleted_at``, not its
        original one.

        Returns a dict of ``{entity_type: rows_purged}`` for logging
        purposes, omitting entity types that had nothing to purge.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(
            days=retention_days if retention_days is not None else settings.TRASH_RETENTION_DAYS
        )

        purged_by_type: dict[str, int] = {}
        for entity_type, (model_cls, _, _) in MODEL_MAP.items():
            if not hasattr(model_cls, "deleted_at"):
                continue
            stmt = delete(model_cls).where(
                model_cls.deleted_at.is_not(None),
                model_cls.deleted_at < cutoff,
            )
            res = await self.db.execute(stmt)
            rowcount = res.rowcount or 0
            if rowcount:
                purged_by_type[entity_type] = rowcount

        if purged_by_type:
            await self.db.flush()
        return purged_by_type