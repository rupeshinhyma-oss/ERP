"""
FollowUp Service.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import CurrentUser
from app.core.exceptions import BadRequestException, ForbiddenException, NotFoundException
from app.follow_ups.models import FollowUp
from app.follow_ups.repository import FollowUpRepository
from app.follow_ups.schemas import FollowUpCreate, FollowUpUpdate
from app.users.models import User


class FollowUpService:
    """Service layer for FollowUp operations with deterministic UUID ownership and department scoping."""

    def __init__(self, repository: FollowUpRepository) -> None:
        self.repository = repository

    def _has_real_db_session(self) -> bool:
        session = getattr(self.repository, "session", None)
        return isinstance(session, AsyncSession)

    def _is_manager_or_admin(self, actor: CurrentUser | None) -> bool:
        if actor is None:
            return True
        raw_perms = set(actor.permissions or ())
        if "deny:crm.leads.view" in raw_perms or "deny:crm.leads.manage" in raw_perms:
            return False
        if (
            actor.is_admin
            or actor.is_super_admin
            or actor.username == "admin"
            or "*" in raw_perms
            or "super_admin" in raw_perms
        ):
            return True
        if "crm.leads.manage" in raw_perms:
            return True
        return False

    async def _get_actor_role_and_scope(
        self, actor: CurrentUser | None
    ) -> tuple[str, set[uuid.UUID] | None]:
        if actor is None:
            return "admin", None

        if self._has_real_db_session():
            from app.crm.lead_service import CrmLeadService

            role_type, scoped_ids = await CrmLeadService(self.repository.session).get_actor_role_and_scope(actor)
            return role_type, scoped_ids

        raw_perms = set(actor.permissions or ())
        if (
            actor.is_admin
            or actor.is_super_admin
            or actor.username == "admin"
            or "*" in raw_perms
            or "super_admin" in raw_perms
        ):
            return "admin", None
        if "crm.leads.manage" in raw_perms:
            return "manager", None
        return "salesperson", {actor.id}

    async def _get_scoped_usernames(self, scoped_user_ids: set[uuid.UUID] | None) -> set[str]:
        if not scoped_user_ids or not self._has_real_db_session():
            return set()
        stmt = select(User.username).where(
            User.id.in_(list(scoped_user_ids)),
            User.deleted_at.is_(None),
        )
        rows = (await self.repository.session.execute(stmt)).scalars().all()
        return {str(u).strip().lower() for u in rows if u and str(u).strip()}

    async def _resolve_target_user_id(
        self,
        target_identifier: str | None,
        *,
        actor: CurrentUser,
        role_type: str,
        scoped_user_ids: set[uuid.UUID] | None,
    ) -> uuid.UUID | None:
        if role_type == "salesperson":
            if target_identifier and target_identifier.strip():
                allowed = self._actor_self_identifiers(actor)
                if target_identifier.strip().lower() not in allowed:
                    raise ForbiddenException("Salespeople can only assign follow-ups to themselves.")
            return actor.id

        if not target_identifier or not target_identifier.strip():
            return actor.id

        clean = target_identifier.strip()
        if not self._has_real_db_session():
            return None

        session: AsyncSession = self.repository.session
        if role_type == "manager" and scoped_user_ids is not None:
            stmt = select(User).where(
                User.id.in_(list(scoped_user_ids)),
                User.deleted_at.is_(None),
            )
            scoped_users = list((await session.execute(stmt)).scalars().all())
            for u in scoped_users:
                if str(u.id).lower() == clean.lower() or u.username.strip().lower() == clean.lower():
                    return u.id
            name_matches = [
                u
                for u in scoped_users
                if (u.display_name and u.display_name.strip().lower() == clean.lower())
                or (u.full_name and u.full_name.strip().lower() == clean.lower())
            ]
            if len(name_matches) == 1:
                return name_matches[0].id
            if len(name_matches) > 1:
                raise BadRequestException(
                    f"Ambiguous marketing person name '{clean}' within your department. Please specify the exact username."
                )
            raise ForbiddenException("Cannot assign follow-up to a user outside your authorized department scope.")

        try:
            as_uuid = uuid.UUID(clean)
            u_by_id = await session.get(User, as_uuid)
            if u_by_id and u_by_id.deleted_at is None:
                return u_by_id.id
        except ValueError:
            pass

        u_by_uname = (
            await session.execute(
                select(User).where(func.lower(User.username) == clean.lower(), User.deleted_at.is_(None))
            )
        ).scalar_one_or_none()
        if u_by_uname:
            return u_by_uname.id

        name_stmt = select(User).where(
            User.deleted_at.is_(None),
            (func.lower(User.display_name) == clean.lower()) | (func.lower(User.full_name) == clean.lower()),
        )
        matches = list((await session.execute(name_stmt)).scalars().all())
        if len(matches) == 1:
            return matches[0].id
        return None

    @staticmethod
    def _actor_label(actor: CurrentUser) -> str:
        return actor.display_name or actor.full_name or actor.username

    @staticmethod
    def _actor_self_identifiers(actor: CurrentUser) -> set[str]:
        return {
            str(n).strip().lower()
            for n in (actor.display_name, actor.full_name, actor.username, str(actor.id))
            if n and str(n).strip()
        }

    @staticmethod
    def _actor_strict_identifiers(actor: CurrentUser) -> set[str]:
        return {
            str(n).strip().lower()
            for n in (actor.username, str(actor.id))
            if n and str(n).strip()
        }

    async def _can_access_follow_up(self, item: FollowUp, actor: CurrentUser | None) -> bool:
        if actor is None:
            return True

        role_type, scoped_user_ids = await self._get_actor_role_and_scope(actor)
        if role_type == "admin":
            return True

        owner_uid = getattr(item, "owner_user_id", None)
        creator_uid = getattr(item, "created_by_user_id", None)

        if role_type == "manager":
            if scoped_user_ids is None:
                return True
            if owner_uid is not None or creator_uid is not None:
                if owner_uid is not None:
                    return owner_uid in scoped_user_ids or (
                        creator_uid is not None and creator_uid in scoped_user_ids
                    )
                return creator_uid is None or creator_uid in scoped_user_ids
            scoped_usernames = await self._get_scoped_usernames(scoped_user_ids)
            person = (item.marketing_person or "").strip().lower()
            return person in scoped_usernames

        # Salesperson
        if owner_uid is not None or creator_uid is not None:
            return owner_uid == actor.id or creator_uid == actor.id

        if self._has_real_db_session():
            strict_ids = self._actor_strict_identifiers(actor)
            person = (item.marketing_person or "").strip().lower()
            return person in strict_ids

        actor_names = self._actor_self_identifiers(actor)
        person = (item.marketing_person or "").strip().lower()
        return person in actor_names

    async def list_follow_ups(
        self,
        *,
        actor: CurrentUser | None = None,
        search: str | None = None,
        call_type: str | None = None,
        marketing_person: str | None = None,
        business_type: str | None = None,
        state: str | None = None,
        district: str | None = None,
        city: str | None = None,
        current_status: str | None = None,
        category: str | None = None,
        client_grade: str | None = None,
        potential_type: str | None = None,
        business_category: str | None = None,
        company_name: str | None = None,
        call_category: str | None = None,
        direct_import_from_china: str | None = None,
        monthly_import_volume: str | None = None,
        lead_status: str | None = None,
        entry_source: str | None = None,
        added_date: Any | None = None,
        date_from: Any | None = None,
        date_to: Any | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[FollowUp], int]:
        extra_scope: dict[str, Any] = {}
        if actor is not None:
            role_type, scoped_user_ids = await self._get_actor_role_and_scope(actor)
            if role_type == "salesperson":
                allowed_names = self._actor_self_identifiers(actor)
                if marketing_person and marketing_person.strip().lower() not in allowed_names:
                    raise ForbiddenException("Users can only query their own follow-ups.")
                if self._has_real_db_session():
                    extra_scope["scoped_user_ids"] = {actor.id}
                    extra_scope["scoped_usernames"] = self._actor_strict_identifiers(actor)
                else:
                    extra_scope["marketing_person_names"] = allowed_names
                    marketing_person = self._actor_label(actor)
            elif role_type == "manager" and scoped_user_ids is not None:
                scoped_usernames = await self._get_scoped_usernames(scoped_user_ids)
                extra_scope["scoped_user_ids"] = scoped_user_ids
                extra_scope["scoped_usernames"] = scoped_usernames

        return await self.repository.list_follow_ups(
            search=search,
            call_type=call_type,
            marketing_person=marketing_person,
            **extra_scope,
            business_type=business_type,
            state=state,
            district=district,
            city=city,
            current_status=current_status,
            category=category,
            client_grade=client_grade,
            potential_type=potential_type,
            business_category=business_category,
            company_name=company_name,
            call_category=call_category,
            direct_import_from_china=direct_import_from_china,
            monthly_import_volume=monthly_import_volume,
            lead_status=lead_status,
            entry_source=entry_source,
            added_date=added_date,
            date_from=date_from,
            date_to=date_to,
            sort_by=sort_by,
            sort_dir=sort_dir,
            limit=limit,
            offset=offset,
        )

    async def get_by_id(self, item_id: uuid.UUID, *, actor: CurrentUser | None = None) -> FollowUp:
        item = await self.repository.get_by_id(item_id)
        if not item:
            raise NotFoundException(f"Follow-up log {item_id} not found.")
        if not await self._can_access_follow_up(item, actor):
            raise ForbiddenException("You do not have permission to view this follow-up log.")
        return item

    async def create(self, payload: FollowUpCreate, *, actor: CurrentUser | None = None) -> FollowUp:
        data = payload.model_dump()
        if not data.get("added_on"):
            data["added_on"] = date.today()
        if actor is not None:
            role_type, scoped_user_ids = await self._get_actor_role_and_scope(actor)
            primary_name = self._actor_label(actor)
            if role_type == "salesperson":
                if data.get("marketing_person") and str(data["marketing_person"]).strip().lower() not in self._actor_self_identifiers(actor):
                    raise ForbiddenException("Salespeople can only create follow-up logs for themselves.")
                data["marketing_person"] = primary_name
                data["owner_user_id"] = actor.id
                data["created_by_user_id"] = actor.id
            else:
                if not data.get("marketing_person"):
                    data["marketing_person"] = primary_name
                data["created_by_user_id"] = actor.id
                resolved_owner = await self._resolve_target_user_id(
                    data.get("marketing_person"),
                    actor=actor,
                    role_type=role_type,
                    scoped_user_ids=scoped_user_ids,
                )
                data["owner_user_id"] = resolved_owner
        item = await self.repository.create(**data)
        return item

    async def update(self, item_id: uuid.UUID, payload: FollowUpUpdate, *, actor: CurrentUser | None = None) -> FollowUp:
        item = await self.get_by_id(item_id, actor=actor)
        if not await self._can_access_follow_up(item, actor):
            raise ForbiddenException("You do not have permission to update this follow-up log.")
        updates = payload.model_dump(exclude_unset=True)
        updates.pop("created_by_user_id", None)
        updates.pop("owner_user_id", None)

        if actor is not None and "marketing_person" in updates:
            role_type, scoped_user_ids = await self._get_actor_role_and_scope(actor)
            if role_type == "salesperson":
                new_mp = (updates.get("marketing_person") or "").strip()
                if new_mp and new_mp.lower() not in self._actor_self_identifiers(actor):
                    raise ForbiddenException("Salespeople cannot reassign follow-up logs to another user.")
                updates.pop("marketing_person", None)
            elif updates.get("marketing_person"):
                resolved_owner = await self._resolve_target_user_id(
                    updates["marketing_person"],
                    actor=actor,
                    role_type=role_type,
                    scoped_user_ids=scoped_user_ids,
                )
                updates["owner_user_id"] = resolved_owner

        if updates:
            item = await self.repository.update(item, **updates)
        return item

    async def delete(self, item_id: uuid.UUID, *, actor: CurrentUser | None = None) -> None:
        item = await self.get_by_id(item_id, actor=actor)
        if not await self._can_access_follow_up(item, actor):
            raise ForbiddenException("You do not have permission to delete this follow-up log.")
        await self.repository.soft_delete(item)

    async def bulk_delete(self, ids: list[uuid.UUID], *, actor: CurrentUser | None = None) -> int:
        if not ids:
            return 0
        for item_id in ids:
            item = await self.repository.get_by_id(item_id)
            if not item:
                raise NotFoundException(f"Follow-up log {item_id} not found.")
            if not await self._can_access_follow_up(item, actor):
                raise ForbiddenException("You do not have permission to delete one or more selected follow-up logs.")
        return await self.repository.bulk_soft_delete(ids)
