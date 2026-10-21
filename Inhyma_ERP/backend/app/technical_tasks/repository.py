"""
Technical Task Repository.

Every query here is written to stay index-friendly at millions of rows:

* status / task type / call type / service type / priority / technician use EXACT matches (B-tree), never
  ``lower(col)`` or ``ILIKE`` -- the UI only offers values from fixed dropdowns / masters.
* city / third-party city use a prefix match on ``lower(col)`` (served by ``ix_tt_*_city_prefix``).
* the free-text search ORs only trigram-indexed columns (``ix_technical_tasks_*_trgm``).
* the default "Pending first, then Approved ..." ordering uses the DB-generated ``status_rank`` column
  (``ix_tt_rank_created``) instead of a CASE sort over the whole table.
* the page is a plain LIMIT query (stops after one page); the total is a CAPPED count (never scans millions of
  rows -- beyond COUNT_CAP the UI shows "10000+" and users narrow the filters).
* tab counts are ONE grouped query with a few-second cache; bulk delete is ONE UPDATE.
"""

from __future__ import annotations

import time
import uuid
from datetime import date, datetime, timezone
from typing import Any, Iterable

from sqlalchemy import extract, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.technical_tasks.models import TechnicalTask, TechnicalTaskCallLog

# Tab key -> every stored spelling of that status (older rows used a few variants).
TAB_STATUSES: dict[str, tuple[str, ...]] = {
    "pending": ("Pending",),
    "approved": ("Approved",),
    "payment_pending": ("Payment Pending", "payment_pending"),
    "completed": ("Completed",),
    "cancel": ("Cancel", "Cancelled"),
}
_TAB_ALIASES = {"cancelled": "cancel", "payment pending": "payment_pending"}

# Totals above this are reported as "COUNT_CAP+" (an exact count of millions of rows is never needed by the UI).
COUNT_CAP = 10_000

# Tab counts are cheap but every user hits them on every page load; cache a few seconds per scope.
_COUNTS_TTL_SECONDS = 5.0
_counts_cache: dict[tuple, tuple[float, dict[str, int]]] = {}


# The month-wise dashboard scans a year or more of tasks; a short cache keeps it cheap for many viewers.
_SUMMARY_TTL_SECONDS = 30.0
_summary_cache: dict[tuple, tuple[float, list[dict[str, Any]]]] = {}


def invalidate_counts_cache() -> None:
    """Drop cached tab counts / dashboard series (called after any write so the writer's screen is exact)."""
    _counts_cache.clear()
    _summary_cache.clear()


_SORTABLE = {
    "company_name": TechnicalTask.company_name,
    "city": TechnicalTask.city,
    "priority": TechnicalTask.priority,
    "status": TechnicalTask.status_rank,
    "created_at": TechnicalTask.created_at,
    "task_created_date": TechnicalTask.task_created_date,
}


def normalize_tab(tab: str | None) -> str | None:
    """Return the canonical tab key (pending/approved/payment_pending/completed/cancel) or None for 'all'."""
    if not tab:
        return None
    key = tab.strip().lower()
    if key in ("", "all"):
        return None
    key = _TAB_ALIASES.get(key, key.replace(" ", "_"))
    return key if key in TAB_STATUSES else key


class TechnicalTaskRepository(BaseRepository[TechnicalTask]):
    """Repository for TechnicalTask entities."""

    searchable_fields = (
        "company_name", "city", "machine_model", "serial_number", "contact_person_name",
        "contact_phone", "task_description", "task_allotted_to", "task_approved_by", "created_by_name",
    )
    sortable_fields = tuple(_SORTABLE)
    filterable_fields = ("task_type", "city", "priority", "service_type", "call_type", "task_allotted_to", "status", "serial_number")

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, TechnicalTask)

    # ------------------------------------------------------------------ scoping
    def _apply_scope(
        self,
        stmt: Any,
        *,
        creator_user_id: uuid.UUID | None = None,
        creator_username: str | None = None,
        exclude_tabs: Iterable[str] = (),
    ) -> Any:
        """Data isolation: restrict to a user's own tasks and/or hide whole statuses (None = no restriction)."""
        if creator_user_id is not None or creator_username:
            conds = []
            if creator_user_id is not None:
                conds.append(TechnicalTask.created_by_user_id == creator_user_id)
            if creator_username:
                # Rows created before created_by_user_id existed only carry the name.
                conds.append(TechnicalTask.created_by_name == creator_username)
            stmt = stmt.where(or_(*conds))
        hidden: list[str] = []
        for tab in exclude_tabs:
            hidden.extend(TAB_STATUSES.get(tab, ()))
        if hidden:
            stmt = stmt.where(TechnicalTask.status.not_in(hidden))
        return stmt

    # ------------------------------------------------------------------ counts
    async def get_counts(self, **scope: Any) -> dict[str, int]:
        """All tab counts in ONE grouped query (index-only scan on ix_tt_status_created), cached a few seconds."""
        cache_key = (id(self.session.sync_session.get_bind()), scope.get("creator_user_id"), scope.get("creator_username"), tuple(scope.get("exclude_tabs", ())))
        hit = _counts_cache.get(cache_key)
        now = time.monotonic()
        if hit and now - hit[0] < _COUNTS_TTL_SECONDS:
            return dict(hit[1])

        stmt = (
            select(TechnicalTask.status, func.count(TechnicalTask.id))
            .where(TechnicalTask.deleted_at.is_(None))
            .group_by(TechnicalTask.status)
        )
        stmt = self._apply_scope(stmt, **scope)
        rows = (await self.session.execute(stmt)).all()

        counts = {key: 0 for key in TAB_STATUSES}
        total = 0
        for status_value, n in rows:
            total += n
            key = normalize_tab(status_value or "")
            if key in counts:
                counts[key] += n
        result = {"all": total, **counts}
        _counts_cache[cache_key] = (now, result)
        return dict(result)

    async def get_payment_summary(self, **scope: Any) -> dict[str, Any]:
        """Aggregate payment summary for Chargeable technical tasks: total_payment, paid, due, counts."""
        stmt = (
            select(
                func.coalesce(func.sum(TechnicalTask.service_charge), 0).label("total_payment"),
                func.coalesce(func.sum(TechnicalTask.collected_amount), 0).label("paid"),
                func.count(TechnicalTask.id).filter(
                    or_(
                        TechnicalTask.payment_status.is_(None),
                        TechnicalTask.payment_status.in_(("Pending", "pending", "Partial", "partial")),
                        func.coalesce(TechnicalTask.collected_amount, 0) < func.coalesce(TechnicalTask.service_charge, 0),
                    )
                ).label("pending_count"),
                func.count(TechnicalTask.id).filter(
                    or_(
                        TechnicalTask.payment_status.in_(("Paid", "paid")),
                        func.coalesce(TechnicalTask.collected_amount, 0) >= func.coalesce(TechnicalTask.service_charge, 0),
                    )
                ).label("completed_count"),
            )
            .where(TechnicalTask.deleted_at.is_(None))
            .where(TechnicalTask.service_type == "Chargeable")
        )
        stmt = self._apply_scope(stmt, **scope)
        row = (await self.session.execute(stmt)).one()
        total_payment = float(row.total_payment or 0)
        paid = float(row.paid or 0)
        due = max(0.0, total_payment - paid)
        return {
            "total_payment": total_payment,
            "paid": paid,
            "due": due,
            "pending_count": int(row.pending_count or 0),
            "completed_count": int(row.completed_count or 0),
        }

    # ------------------------------------------------------------------ list
    async def list_tasks(
        self,
        *,
        tab: str | None = None,
        search: str | None = None,
        serial_number: str | None = None,
        city: str | None = None,
        third_party_city: str | None = None,
        task_type: str | None = None,
        call_type: str | None = None,
        service_type: str | None = None,
        priority: str | None = None,
        technician: str | None = None,
        payment_collected: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
        limit: int = 50,
        offset: int = 0,
        **scope: Any,
    ) -> tuple[list[TechnicalTask], int]:
        """Filtered, paginated tasks plus the total matching count (single round trip)."""
        stmt = self._apply_scope(self._base_select(), **scope)

        tab_key = normalize_tab(tab)
        if tab_key:
            stmt = stmt.where(TechnicalTask.status.in_(TAB_STATUSES.get(tab_key, (tab.strip(),))))

        if serial_number and serial_number.strip():
            stmt = stmt.where(TechnicalTask.serial_number.ilike(f"%{serial_number.strip()}%"))  # trigram-indexed
        if city and city.strip():
            stmt = stmt.where(func.lower(TechnicalTask.city).like(city.strip().lower() + "%"))
        if third_party_city and third_party_city.strip():
            stmt = stmt.where(func.lower(TechnicalTask.third_party_city).like(third_party_city.strip().lower() + "%"))
        if task_type and task_type.strip():
            stmt = stmt.where(TechnicalTask.task_type == task_type.strip())
        if call_type and call_type.strip():
            stmt = stmt.where(TechnicalTask.call_type == call_type.strip())
        if service_type and service_type.strip():
            stmt = stmt.where(TechnicalTask.service_type == service_type.strip())
        if priority and priority.strip():
            stmt = stmt.where(TechnicalTask.priority == priority.strip().upper())
        if technician and technician.strip():
            stmt = stmt.where(TechnicalTask.task_allotted_to == technician.strip())
        if date_from:
            stmt = stmt.where(TechnicalTask.task_created_date >= date_from)
        if date_to:
            stmt = stmt.where(TechnicalTask.task_created_date <= date_to)
        if payment_collected and payment_collected.strip():
            pc = payment_collected.strip().lower()
            if pc in ("yes", "paid", "collected", "true", "completed"):
                stmt = stmt.where(TechnicalTask.service_type == "Chargeable").where(
                    or_(
                        TechnicalTask.payment_status.in_(("Paid", "paid")),
                        func.coalesce(TechnicalTask.collected_amount, 0) >= func.coalesce(TechnicalTask.service_charge, 0),
                    )
                )
            elif pc in ("no", "pending", "false"):
                stmt = stmt.where(TechnicalTask.service_type == "Chargeable").where(
                    or_(
                        TechnicalTask.payment_status.is_(None),
                        TechnicalTask.payment_status.in_(("Pending", "pending", "Partial", "partial")),
                        func.coalesce(TechnicalTask.collected_amount, 0) < func.coalesce(TechnicalTask.service_charge, 0),
                    )
                )

        if search and search.strip():
            pattern = f"%{search.strip()}%"
            stmt = stmt.where(or_(*(getattr(TechnicalTask, f).ilike(pattern) for f in self.searchable_fields)))

        # Ordering. Default = Pending, Approved, Payment Pending, Completed, Cancel, newest first inside each.
        desc = sort_dir.lower() != "asc"
        sort_col = _SORTABLE.get(sort_by, TechnicalTask.created_at)
        if sort_by in ("created_at", "") or sort_by not in _SORTABLE:
            if tab_key:
                order = [TechnicalTask.created_at.desc() if desc else TechnicalTask.created_at.asc(), TechnicalTask.id]
            else:
                order = [TechnicalTask.status_rank.asc(), TechnicalTask.created_at.desc() if desc else TechnicalTask.created_at.asc(), TechnicalTask.id]
        else:
            order = [sort_col.desc() if desc else sort_col.asc(), TechnicalTask.created_at.desc(), TechnicalTask.id]

        # Page: plain LIMIT query -- Postgres stops after `limit` rows using the status_rank / created_at index.
        rows = list((await self.session.execute(stmt.order_by(*order).offset(offset).limit(limit))).scalars().all())

        # Total: exact when the page is not full (no extra query), otherwise a CAPPED count.
        if offset == 0 and len(rows) < limit:
            return rows, len(rows)
        capped = stmt.order_by(None).limit(COUNT_CAP + 1).subquery()
        total = (await self.session.execute(select(func.count()).select_from(capped))).scalar() or 0
        return rows, int(total)

    async def get_for_update(self, task_id: uuid.UUID) -> TechnicalTask | None:
        """Fetch a task and lock its row so two simultaneous status changes cannot overwrite each other."""
        stmt = self._base_select().where(TechnicalTask.id == task_id).with_for_update()
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def find_by_serial(self, serial_number: str) -> list[TechnicalTask]:
        """Return the most recent tasks for a machine serial number (capped; served by ix_tt_serial_lower)."""
        stmt = (
            self._base_select()
            .where(func.lower(TechnicalTask.serial_number) == serial_number.strip().lower())
            .order_by(TechnicalTask.created_at.desc())
            .limit(50)
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def bulk_soft_delete(self, ids: list[uuid.UUID], only_pending: bool = False) -> int:
        """Soft-delete all given tasks with ONE UPDATE statement (no row loading).

        ``only_pending`` is used for non-admin users: only Pending tasks may be deleted by them.
        """
        if not ids:
            return 0
        stmt = (
            update(TechnicalTask)
            .where(TechnicalTask.id.in_(ids), TechnicalTask.deleted_at.is_(None))
            .values({TechnicalTask.deleted_at: datetime.now(timezone.utc)})  # column-keyed form: type-checker friendly
        )
        if only_pending:
            stmt = stmt.where(TechnicalTask.status == "Pending")
        result = await self.session.execute(stmt)
        await self.session.flush()
        return int(result.rowcount or 0)

    async def create_call_log(
        self,
        task_id: uuid.UUID,
        call_date: date,
        call_type: str,
        remarks: str,
        created_by: str,
    ) -> TechnicalTaskCallLog:
        """Create a new technical call log entry."""
        log = TechnicalTaskCallLog(
            id=uuid.uuid4(),
            task_id=task_id,
            call_date=call_date,
            call_type=call_type,
            remarks=remarks,
            created_by=created_by,
        )
        self.session.add(log)
        await self.session.flush()
        return log

    async def list_call_logs(self, task_id: uuid.UUID, limit: int = 500) -> list[TechnicalTaskCallLog]:
        """Call logs for one task, newest first (capped so a runaway task cannot return unbounded rows)."""
        stmt = (
            select(TechnicalTaskCallLog)
            .where(TechnicalTaskCallLog.task_id == task_id)
            .order_by(TechnicalTaskCallLog.created_at.desc())
            .limit(limit)
        )
        return list((await self.session.execute(stmt)).scalars().all())

    # ------------------------------------------------------------------ call-log report
    async def call_log_report(
        self,
        *,
        date_from: date | None = None,
        date_to: date | None = None,
        call_type: str | None = None,
        created_by: str | None = None,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
        **scope: Any,
    ) -> tuple[list[dict[str, Any]], int]:
        """Separate report of ALL technical call logs (not tied to one task), newest first, capped total."""
        L, T = TechnicalTaskCallLog, TechnicalTask
        stmt = select(L, T).join(T, T.id == L.task_id).where(T.deleted_at.is_(None))
        stmt = self._apply_scope(stmt, **scope)
        if date_from:
            stmt = stmt.where(L.call_date >= date_from)
        if date_to:
            stmt = stmt.where(L.call_date <= date_to)
        if call_type and call_type.strip():
            stmt = stmt.where(L.call_type == call_type.strip())
        if created_by and created_by.strip():
            stmt = stmt.where(L.created_by == created_by.strip())
        if search and search.strip():
            pattern = f"%{search.strip()}%"
            stmt = stmt.where(or_(T.company_name.ilike(pattern), T.machine_model.ilike(pattern),
                                  T.contact_person_name.ilike(pattern), T.serial_number.ilike(pattern)))

        rows = (await self.session.execute(
            stmt.order_by(L.call_date.desc(), L.created_at.desc(), L.id).offset(offset).limit(limit)
        )).all()
        items = [
            {
                "id": log.id, "task_id": log.task_id, "call_date": log.call_date, "call_type": log.call_type,
                "remarks": log.remarks, "created_by": log.created_by, "created_at": log.created_at,
                "company_name": task.company_name, "city": task.city, "machine_model": task.machine_model,
                "contact_person_name": task.contact_person_name, "contact_phone": task.contact_phone,
                "task_status": task.status, "task_allotted_to": task.task_allotted_to,
            }
            for log, task in rows
        ]
        if offset == 0 and len(items) < limit:
            return items, len(items)
        capped = stmt.order_by(None).with_only_columns(L.id).limit(COUNT_CAP + 1).subquery()
        total = (await self.session.execute(select(func.count()).select_from(capped))).scalar() or 0
        return items, int(total)

    # ------------------------------------------------------------------ monthly summary
    async def monthly_summary(self, months: int = 12, **scope: Any) -> list[dict[str, Any]]:
        """Per month: tasks raised vs tasks completed (Open vs Closed month-wise dashboard). Two grouped queries."""
        months = max(1, min(months, 36))
        cache_key = (id(self.session.sync_session.get_bind()), months, scope.get("creator_user_id"),
                     scope.get("creator_username"), tuple(scope.get("exclude_tabs", ())))
        hit = _summary_cache.get(cache_key)
        if hit and time.monotonic() - hit[0] < _SUMMARY_TTL_SECONDS:
            return [dict(r) for r in hit[1]]
        today = date.today()
        y, m = today.year, today.month - (months - 1)
        while m <= 0:
            m += 12
            y -= 1
        since = date(y, m, 1)

        T = TechnicalTask
        cy, cm = extract("year", T.task_created_date), extract("month", T.task_created_date)
        created_stmt = (
            select(cy, cm, func.count(T.id)).where(T.deleted_at.is_(None), T.task_created_date >= since).group_by(cy, cm)
        )
        dy, dm = extract("year", T.completed_date), extract("month", T.completed_date)
        done_stmt = (
            select(dy, dm, func.count(T.id))
            .where(T.deleted_at.is_(None), T.completed_date.is_not(None), T.completed_date >= since)
            .group_by(dy, dm)
        )
        created_stmt = self._apply_scope(created_stmt, **scope)
        done_stmt = self._apply_scope(done_stmt, **scope)
        created = {(int(a), int(b)): n for a, b, n in (await self.session.execute(created_stmt)).all()}
        done = {(int(a), int(b)): n for a, b, n in (await self.session.execute(done_stmt)).all()}

        out: list[dict[str, Any]] = []
        yy, mm = since.year, since.month
        for _ in range(months):
            out.append({"month": f"{yy:04d}-{mm:02d}", "created": created.get((yy, mm), 0), "completed": done.get((yy, mm), 0)})
            mm += 1
            if mm > 12:
                mm, yy = 1, yy + 1
        _summary_cache[cache_key] = (time.monotonic(), [dict(r) for r in out])
        return out