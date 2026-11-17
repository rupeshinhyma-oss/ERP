"""
Feed Module RBAC & Permission Helpers.

Enforces the Feed permission contract using the existing ERP RBAC tables
(``Permission``, ``RolePermission``, ``UserPermission``) and ``CurrentUser``:
- ``feed.view``   : View Feed page, posts, comments, readership (own), and DMs.
                    (``feed.manage`` satisfies ``feed.view`` unless ``deny:feed.view`` is set,
                    matching ``frontend/src/lib/auth.ts``.)
- ``feed.create`` : Create/edit own posts, comments, reactions, DMs, and query eligible
                    audience recipients/departments.
- ``feed.manage`` : Moderate (delete) other users' visible published posts and comments.
- ``deny:feed.*`` : Explicit per-user deny overrides ALWAYS take precedence over role grants,
                    wildcards, and administrator flags.
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any
import uuid

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.exceptions import ForbiddenException
from app.database.session import get_db_session
from app.rbac.models import Permission, UserPermission

FEED_PERMISSION_CODES: tuple[str, ...] = ("feed.view", "feed.create", "feed.manage")


def extract_raw_permissions(actor: CurrentUser) -> set[str]:
    """
    Copy ``actor.permissions`` into a plain Python ``set`` so ``AdminPermissionSet``
    (whose ``__contains__`` always returns ``True``) cannot synthesize non-existent
    permission strings or false ``deny:*`` entries.
    """
    return set(actor.permissions or ())


async def load_explicit_feed_denies(
    session: AsyncSession | None, user_id: uuid.UUID, raw_perms: set[str]
) -> set[str]:
    """
    Resolve explicit ``deny:feed.*`` / ``block:feed.*`` overrides from both the
    resolved ``CurrentUser.permissions`` set and ``user_permissions`` (`is_granted=False`).
    """
    denies: set[str] = set()
    for code in FEED_PERMISSION_CODES:
        if f"deny:{code}" in raw_perms or f"block:{code}" in raw_perms:
            denies.add(code)

    # Query DB `user_permissions` directly when a real AsyncSession is bound, ensuring
    # explicit per-user revokes apply even on accounts holding `super_admin`.
    if isinstance(session, AsyncSession):
        stmt = (
            select(Permission.code)
            .join(UserPermission, UserPermission.permission_id == Permission.id)
            .where(
                UserPermission.user_id == user_id,
                UserPermission.is_granted.is_(False),
                Permission.code.in_(FEED_PERMISSION_CODES),
            )
        )
        res = await session.execute(stmt)
        denies.update(res.scalars().all())

    return denies


def evaluate_feed_permission(
    raw_perms: set[str], explicit_denies: set[str], required_code: str
) -> bool:
    """
    Evaluate whether ``required_code`` is granted under strict deny precedence.
    - Explicit ``deny:feed.view`` blocks all Feed module access.
    - Explicit ``deny:<required_code>`` always overrides grants/wildcards.
    - Role labels (e.g. "Admin" in role name) never substitute for permission grants.
    """
    if "feed.view" in explicit_denies:
        return False
    if required_code in explicit_denies:
        return False

    if required_code in raw_perms or "*" in raw_perms:
        return True

    if required_code == "feed.view":
        if "feed.manage" not in explicit_denies and (
            "feed.manage" in raw_perms or "feed.read" in raw_perms
        ):
            return True

    return False


def require_feed_permission(
    permission_code: str,
) -> Callable[..., Coroutine[Any, Any, CurrentUser]]:
    """FastAPI route dependency enforcing a single Feed permission with deny precedence."""

    async def _checker(
        current_user: CurrentUser = Depends(get_current_user),
        db: AsyncSession = Depends(get_db_session),
    ) -> CurrentUser:
        raw_perms = extract_raw_permissions(current_user)
        denies = await load_explicit_feed_denies(db, current_user.id, raw_perms)
        if not evaluate_feed_permission(raw_perms, denies, permission_code):
            raise ForbiddenException(
                f"Permission denied. This action requires the {permission_code!r} permission."
            )
        return current_user

    return _checker


def require_feed_any_permission(
    *permission_codes: str,
) -> Callable[..., Coroutine[Any, Any, CurrentUser]]:
    """FastAPI route dependency enforcing at least one of the given Feed permissions."""

    async def _checker(
        current_user: CurrentUser = Depends(get_current_user),
        db: AsyncSession = Depends(get_db_session),
    ) -> CurrentUser:
        raw_perms = extract_raw_permissions(current_user)
        denies = await load_explicit_feed_denies(db, current_user.id, raw_perms)
        if not any(evaluate_feed_permission(raw_perms, denies, c) for c in permission_codes):
            joined = " or ".join(repr(c) for c in permission_codes)
            raise ForbiddenException(
                f"Permission denied. This action requires {joined}."
            )
        return current_user

    return _checker
