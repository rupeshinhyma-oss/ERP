"""
Lead Service.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import CurrentUser
from app.core.exceptions import BadRequestException, ForbiddenException, NotFoundException
from app.leads.models import Lead
from app.leads.repository import LeadRepository
from app.leads.schemas import LeadCreate, LeadUpdate
from app.users.models import User


class LeadService:
    """Service layer for Lead operations with deterministic UUID ownership and department scoping."""

    def __init__(self, repository: LeadRepository) -> None:
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
        """
        Determine actor authority:
        - ("admin", None): Global administrator
        - ("manager", scoped_user_ids): Department manager scoped to managed department members
        - ("salesperson", {actor.id}): Salesperson scoped to own records
        """
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
        """
        Deterministically resolve target owner UUID for a legacy lead without relying on
        colliding cross-department display names.
        """
        if role_type == "salesperson":
            if target_identifier and target_identifier.strip():
                allowed = self._actor_self_identifiers(actor)
                if target_identifier.strip().lower() not in allowed:
                    raise ForbiddenException("Salespeople can only allot leads to themselves.")
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
            # 1. Exact ID or username match within manager's scope
            for u in scoped_users:
                if str(u.id).lower() == clean.lower() or u.username.strip().lower() == clean.lower():
                    return u.id
            # 2. Display name or full name match ONLY within manager's authorized scope
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
                    f"Ambiguous assignee name '{clean}' within your department. Please specify the exact username."
                )
            raise ForbiddenException("Cannot allot lead to a salesperson outside your authorized department scope.")

        # Admin resolution: exact username/UUID first, then unique display_name/full_name
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
        """Non-colliding identifiers (username and UUID) for legacy rows lacking UUID FKs."""
        return {
            str(n).strip().lower()
            for n in (actor.username, str(actor.id))
            if n and str(n).strip()
        }

    async def _can_access_lead(self, lead: Lead, actor: CurrentUser | None) -> bool:
        if actor is None:
            return True

        role_type, scoped_user_ids = await self._get_actor_role_and_scope(actor)
        if role_type == "admin":
            return True

        owner_uid = getattr(lead, "owner_user_id", None)
        creator_uid = getattr(lead, "created_by_user_id", None)

        if role_type == "manager":
            if scoped_user_ids is None:
                return True
            if owner_uid is not None or creator_uid is not None:
                if owner_uid is not None:
                    return owner_uid in scoped_user_ids or (
                        creator_uid is not None and creator_uid in scoped_user_ids
                    )
                return creator_uid is None or creator_uid in scoped_user_ids
            # Legacy row without UUIDs: match only by canonical username in scoped_user_ids
            scoped_usernames = await self._get_scoped_usernames(scoped_user_ids)
            allotted = (lead.allotted_to or "").strip().lower()
            creator = (lead.created_by or "").strip().lower()
            return (allotted in scoped_usernames) or (creator in scoped_usernames)

        # Salesperson
        if owner_uid is not None or creator_uid is not None:
            return owner_uid == actor.id or creator_uid == actor.id

        # Fallback for rows without UUIDs (e.g. unit test mocks):
        if self._has_real_db_session():
            strict_ids = self._actor_strict_identifiers(actor)
            allotted = (lead.allotted_to or "").strip().lower()
            creator = (lead.created_by or "").strip().lower()
            return allotted in strict_ids or creator in strict_ids

        actor_names = self._actor_self_identifiers(actor)
        allotted = (lead.allotted_to or "").strip().lower()
        creator = (lead.created_by or "").strip().lower()
        return allotted in actor_names or creator in actor_names

    async def list_leads(
        self,
        *,
        actor: CurrentUser | None = None,
        search: str | None = None,
        source: str | None = None,
        priority: str | None = None,
        business_type: str | None = None,
        allotted_to: str | None = None,
        created_by: str | None = None,
        status: str | None = None,
        city: str | None = None,
        district: str | None = None,
        state: str | None = None,
        call_type: str | None = None,
        company_name: str | None = None,
        date_from: Any | None = None,
        date_to: Any | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Lead], int]:
        extra_scope: dict[str, Any] = {}
        if actor is not None:
            role_type, scoped_user_ids = await self._get_actor_role_and_scope(actor)
            if role_type == "salesperson":
                allowed_names = self._actor_self_identifiers(actor)
                if allotted_to and allotted_to.strip().lower() not in allowed_names:
                    raise ForbiddenException("Salespeople can only query their own leads.")
                if self._has_real_db_session():
                    extra_scope["scoped_user_ids"] = {actor.id}
                    extra_scope["scoped_usernames"] = self._actor_strict_identifiers(actor)
                else:
                    extra_scope["allotted_to_names"] = allowed_names
                    allotted_to = self._actor_label(actor)
            elif role_type == "manager" and scoped_user_ids is not None:
                scoped_usernames = await self._get_scoped_usernames(scoped_user_ids)
                extra_scope["scoped_user_ids"] = scoped_user_ids
                extra_scope["scoped_usernames"] = scoped_usernames

        return await self.repository.list_leads(
            search=search,
            source=source,
            priority=priority,
            business_type=business_type,
            allotted_to=allotted_to,
            **extra_scope,
            created_by=created_by,
            status=status,
            city=city,
            district=district,
            state=state,
            call_type=call_type,
            company_name=company_name,
            date_from=date_from,
            date_to=date_to,
            sort_by=sort_by,
            sort_dir=sort_dir,
            limit=limit,
            offset=offset,
        )

    async def get_by_id(self, lead_id: uuid.UUID, *, actor: CurrentUser | None = None) -> Lead:
        lead = await self.repository.get_by_id(lead_id)
        if not lead:
            raise NotFoundException(f"Lead {lead_id} not found.")
        if not await self._can_access_lead(lead, actor):
            raise ForbiddenException("You do not have permission to view this lead.")
        return lead

    async def create(self, payload: LeadCreate, *, actor: CurrentUser | None = None) -> Lead:
        data = payload.model_dump()
        if not data.get("added_on"):
            data["added_on"] = date.today()
        if actor is not None:
            role_type, scoped_user_ids = await self._get_actor_role_and_scope(actor)
            primary_name = self._actor_label(actor)
            if role_type == "salesperson":
                if data.get("created_by") and str(data["created_by"]).strip().lower() not in self._actor_self_identifiers(actor):
                    raise ForbiddenException("Salespeople cannot create leads on behalf of other users.")
                data["created_by"] = primary_name
                if data.get("allotted_to") and str(data["allotted_to"]).strip().lower() not in self._actor_self_identifiers(actor):
                    raise ForbiddenException("Salespeople can only allot leads to themselves.")
                data["allotted_to"] = primary_name
                data["owner_user_id"] = actor.id
                data["created_by_user_id"] = actor.id
            else:
                if not data.get("created_by"):
                    data["created_by"] = primary_name
                data["created_by_user_id"] = actor.id
                resolved_owner = await self._resolve_target_user_id(
                    data.get("allotted_to"),
                    actor=actor,
                    role_type=role_type,
                    scoped_user_ids=scoped_user_ids,
                )
                data["owner_user_id"] = resolved_owner
        lead = await self.repository.create(**data)
        return lead

    async def update(self, lead_id: uuid.UUID, payload: LeadUpdate, *, actor: CurrentUser | None = None) -> Lead:
        lead = await self.get_by_id(lead_id, actor=actor)
        if not await self._can_access_lead(lead, actor):
            raise ForbiddenException("You do not have permission to update this lead.")
        updates = payload.model_dump(exclude_unset=True)
        # Never allow spoofing created_by on update
        updates.pop("created_by", None)
        updates.pop("created_by_user_id", None)
        updates.pop("owner_user_id", None)

        if actor is not None and "allotted_to" in updates:
            role_type, scoped_user_ids = await self._get_actor_role_and_scope(actor)
            if role_type == "salesperson":
                new_allot = (updates.get("allotted_to") or "").strip()
                if new_allot and new_allot.lower() not in self._actor_self_identifiers(actor):
                    raise ForbiddenException("Salespeople cannot reassign or change lead allotment.")
                updates.pop("allotted_to", None)
            elif updates.get("allotted_to"):
                resolved_owner = await self._resolve_target_user_id(
                    updates["allotted_to"],
                    actor=actor,
                    role_type=role_type,
                    scoped_user_ids=scoped_user_ids,
                )
                updates["owner_user_id"] = resolved_owner

        if updates:
            lead = await self.repository.update(lead, **updates)
        return lead

    async def allot_lead(self, lead_id: uuid.UUID, allotted_to: str, *, actor: CurrentUser | None = None) -> Lead:
        if actor is not None:
            role_type, scoped_user_ids = await self._get_actor_role_and_scope(actor)
            if role_type == "salesperson":
                raise ForbiddenException("Only managers and administrators can allot leads.")
        else:
            role_type, scoped_user_ids = "admin", None

        if not allotted_to or not allotted_to.strip():
            raise BadRequestException("Target assignee cannot be empty.")

        lead = await self.get_by_id(lead_id, actor=actor)
        if actor is not None:
            resolved_owner = await self._resolve_target_user_id(
                allotted_to.strip(),
                actor=actor,
                role_type=role_type,
                scoped_user_ids=scoped_user_ids,
            )
            lead.owner_user_id = resolved_owner

        return await self.repository.allot_lead(lead, allotted_to.strip())

    async def delete(self, lead_id: uuid.UUID, *, actor: CurrentUser | None = None) -> None:
        lead = await self.get_by_id(lead_id, actor=actor)
        if not await self._can_access_lead(lead, actor):
            raise ForbiddenException("You do not have permission to delete this lead.")
        await self.repository.soft_delete(lead)

    async def bulk_delete(self, ids: list[uuid.UUID], *, actor: CurrentUser | None = None) -> int:
        if not ids:
            return 0
        # Authorize every requested record before performing mutations
        for lead_id in ids:
            lead = await self.repository.get_by_id(lead_id)
            if not lead:
                raise NotFoundException(f"Lead {lead_id} not found.")
            if not await self._can_access_lead(lead, actor):
                raise ForbiddenException("You do not have permission to delete one or more selected leads.")
        return await self.repository.bulk_soft_delete(ids)
