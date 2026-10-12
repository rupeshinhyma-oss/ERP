"""Database-driven workflow rules shared by Proforma Invoices and the Purchase modules.

Every rule lives in the ``meta`` of an ``option_lists`` row (one row per status, one group per
document type), so allowed transitions and who may act are data, not code:

    next               list of statuses reachable from this one
    admin_only_to      targets only an administrator may move to
    perm_to            {target: permission_code}  -> administrator OR holder of that permission
    reason_required_to targets that need a reason
    edit               "any" | "admin" | "none" | "perm:<code>"
    delete             true | false | "any" | "admin" | "none" | "perm:<code>"
    initial            true on the status a new document starts in
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import CurrentUser
from app.core.constants import RecordStatus
from app.core.exceptions import (
    BadRequestException,
    ConflictException,
    ForbiddenException,
    ServiceUnavailableException,
)
from app.masters.option_lists.models import OptionList


async def load_group(db: AsyncSession, group: str) -> list[OptionList]:
    stmt = (
        select(OptionList)
        .where(OptionList.group_key == group, OptionList.deleted_at.is_(None), OptionList.status == RecordStatus.ACTIVE)
        .order_by(OptionList.sort_order)
    )
    return list((await db.execute(stmt)).scalars().all())


async def load_status_rules(db: AsyncSession, group: str) -> dict[str, dict[str, Any]]:
    """Return ``{status: rules}`` for the workflow statuses configured for ``group``."""
    rules = {r.value: {**(r.meta or {}), "label": r.label} for r in await load_group(db, group) if r.meta and "next" in r.meta}
    if not rules:
        raise ServiceUnavailableException(f"Workflow rules '{group}' are not configured.")
    return rules


def initial_status(rules: dict[str, dict]) -> str:
    for name, meta in rules.items():
        if meta.get("initial"):
            return name
    raise BadRequestException("Workflow rules do not define an initial status.")


def is_admin(user: CurrentUser, admin_permission: str | None = None) -> bool:
    return bool(user.is_admin or "*" in user.permissions or (admin_permission and admin_permission in user.permissions))


def _allowed(mode: Any, user: CurrentUser | None, admin_permission: str | None) -> bool:
    """Evaluate an edit/delete mode for ``user`` (None user = anonymous: only 'any' passes)."""
    if mode is True or mode == "any":
        return True
    if user is None or mode in (False, None, "none"):
        return False
    if mode == "admin":
        return is_admin(user, admin_permission)
    if isinstance(mode, str) and mode.startswith("perm:"):
        return is_admin(user, admin_permission) or mode[5:] in user.permissions
    return False


def check_transition(
    rules: dict[str, dict],
    current: str,
    target: str,
    user: CurrentUser,
    reason: str | None,
    *,
    admin_permission: str | None = None,
) -> None:
    """Raise unless ``current -> target`` is allowed for ``user`` under the configured rules."""
    if target not in rules:
        raise BadRequestException(f"Unknown status '{target}'.")
    cur = rules.get(current)
    if cur is None or target not in cur.get("next", []):
        raise ConflictException(f"A document cannot move from '{current}' to '{target}'.")
    if target in cur.get("admin_only_to", []) and not is_admin(user, admin_permission):
        raise ForbiddenException("Only an administrator can perform this action.")
    required = (cur.get("perm_to") or {}).get(target)
    if required and not (is_admin(user, admin_permission) or required in user.permissions):
        raise ForbiddenException("You do not have permission to perform this action.")
    if target in cur.get("reason_required_to", []) and not (reason or "").strip():
        raise BadRequestException("A reason is required for this action.")


def check_editable(rules: dict[str, dict], status: str, user: CurrentUser, *, admin_permission: str | None = None) -> None:
    mode = (rules.get(status) or {}).get("edit", "none")
    if _allowed(mode, user, admin_permission):
        return
    if mode == "admin" or (isinstance(mode, str) and mode.startswith("perm:")):
        raise ForbiddenException("You do not have permission to edit this document at this stage.")
    raise ConflictException(f"This document cannot be edited once it is '{status}'.")


def check_deletable(
    rules: dict[str, dict], status: str, user: CurrentUser | None = None, *, admin_permission: str | None = None
) -> None:
    mode = (rules.get(status) or {}).get("delete", False)
    if _allowed(mode, user, admin_permission):
        return
    if mode == "admin" or (isinstance(mode, str) and mode.startswith("perm:")):
        raise ForbiddenException("Only an administrator can delete this document at this stage.")
    raise ConflictException(f"This document cannot be deleted when it is '{status}'.")