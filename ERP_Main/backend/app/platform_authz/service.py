"""
Platform Authorization Service.

Business rules for Phase 5's GlobalUser-based RBAC:

- `create_role` / `create_permission` / `grant_permission_to_role`: fully
  data-driven role/permission definition (Section 5-7) -- no permission
  set is ever hardcoded in a Python function; every check flows through
  `compute_effective_permissions`.
- `assign_role` / `revoke_assignment`: grants/revokes a role for a
  GlobalUser, optionally ERP-scoped, with scope/erp_instance_id
  consistency enforced again here (defense in depth on top of the
  schema-layer check, since this method is also reachable from seed
  scripts that skip the Pydantic schema entirely).
- `compute_effective_permissions`: the SINGLE function every permission
  check in this codebase calls (Section 33: "one clearly defined
  function/service that computes effective permissions... never
  duplicate authorization logic across multiple files"). Excludes
  expired and revoked assignments and permissions from inactive roles
  (Section 34) -- fail-closed by construction: anything not explicitly,
  currently, actively granted is simply absent from the result, never
  defaulted to "allowed."
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.core.exceptions import ConflictException, ForbiddenException, NotFoundException
from app.erp_registry.repository import ErpInstanceRepository
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.service import GlobalAuditService
from app.global_users.repository import GlobalUserRepository
from app.platform_authz.models import (
    AuthorizationScope,
    PlatformPermission,
    PlatformRole,
    PlatformRoleAssignment,
    RolePermission,
)
from app.platform_authz.repository import (
    PlatformPermissionRepository,
    PlatformRoleAssignmentRepository,
    PlatformRoleRepository,
)
from app.platform_authz.schemas import (
    PlatformPermissionCreate,
    PlatformRoleAssignmentCreate,
    PlatformRoleCreate,
    PlatformRoleUpdate,
)


class PlatformAuthzService:
    """Orchestrates platform role/permission definition, assignment, and effective-permission computation."""

    def __init__(
        self,
        role_repository: PlatformRoleRepository,
        permission_repository: PlatformPermissionRepository,
        assignment_repository: PlatformRoleAssignmentRepository,
        global_user_repository: GlobalUserRepository,
        erp_instance_repository: ErpInstanceRepository,
        audit: GlobalAuditService,
    ) -> None:
        """Wire the service to its repositories and the global audit service."""
        self.role_repository = role_repository
        self.permission_repository = permission_repository
        self.assignment_repository = assignment_repository
        self.global_user_repository = global_user_repository
        self.erp_instance_repository = erp_instance_repository
        self.audit = audit

    async def create_permission(
        self, payload: PlatformPermissionCreate, *, actor_id: uuid.UUID, actor_label: str
    ) -> PlatformPermission:
        """Define a new platform permission. Rejects a duplicate key with 409 Conflict."""
        existing = await self.permission_repository.get_by_key(payload.permission_key)
        if existing is not None:
            raise ConflictException(f"A permission with key {payload.permission_key!r} already exists.")

        permission = PlatformPermission(permission_key=payload.permission_key, description=payload.description)
        created = await self.permission_repository.create(permission)
        await self.audit.record(
            event_type=AuditEventType.PLATFORM_PERMISSION_CREATED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor_id,
            actor_label=actor_label,
            target_type="platform_permission",
            target_id=created.id,
            details={"permission_key": created.permission_key},
        )
        return created

    async def list_permissions(self) -> list[PlatformPermission]:
        """List every defined platform permission."""
        return await self.permission_repository.list_all()

    async def create_role(self, payload: PlatformRoleCreate, *, actor_id: uuid.UUID, actor_label: str) -> PlatformRole:
        """Create a new platform role. Rejects a duplicate key with 409 Conflict."""
        existing = await self.role_repository.get_by_key(payload.role_key)
        if existing is not None:
            raise ConflictException(f"A role with key {payload.role_key!r} already exists.")

        role = PlatformRole(
            role_key=payload.role_key, display_name=payload.display_name, description=payload.description
        )
        created = await self.role_repository.create(role)
        await self.audit.record(
            event_type=AuditEventType.PLATFORM_ROLE_CREATED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor_id,
            actor_label=actor_label,
            target_type="platform_role",
            target_id=created.id,
            details={"role_key": created.role_key},
        )
        return created

    async def update_role(
        self, role_id: uuid.UUID, payload: PlatformRoleUpdate, *, actor_id: uuid.UUID, actor_label: str
    ) -> PlatformRole:
        """
        Update a role's metadata or active flag.

        Setting `is_active=False` immediately voids every assignment
        referencing this role for authorization purposes (Section 5) --
        `compute_effective_permissions` checks the role's own
        `is_active` flag on every call, so this takes effect instantly
        without needing to touch any `PlatformRoleAssignment` row.
        """
        role = await self.get_role(role_id)
        updates = payload.model_dump(exclude_unset=True)
        for field, value in updates.items():
            setattr(role, field, value)
        await self.role_repository.create(role)  # flush + refresh
        await self.audit.record(
            event_type=AuditEventType.PLATFORM_ROLE_UPDATED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor_id,
            actor_label=actor_label,
            target_type="platform_role",
            target_id=role.id,
            details={"fields_updated": sorted(updates.keys())},
        )
        return role

    async def get_role(self, role_id: uuid.UUID) -> PlatformRole:
        """Fetch a role by id, or raise 404."""
        role = await self.role_repository.get_by_id(role_id)
        if role is None:
            raise NotFoundException(f"No platform role found with id {role_id}.")
        return role

    async def list_roles(self) -> list[PlatformRole]:
        """List every defined platform role."""
        return await self.role_repository.list_all()

    async def grant_permission_to_role(
        self, role_id: uuid.UUID, permission_key: str, *, actor_id: uuid.UUID, actor_label: str
    ) -> RolePermission:
        """
        Grant a permission to a role (idempotent: re-granting an already-held permission is a no-op success).

        This is the ONLY place a role's grant set changes -- there is no
        separate "set the whole permission list" endpoint, so every grant
        is individually audited (Section 30).
        """
        role = await self.get_role(role_id)
        permission = await self.permission_repository.get_by_key(permission_key)
        if permission is None:
            raise NotFoundException(f"No permission found with key {permission_key!r}.")

        existing_link = await self.role_repository.get_role_permission_link(role.id, permission.id)
        if existing_link is not None:
            return existing_link  # idempotent: already granted

        link = RolePermission(role_id=role.id, permission_id=permission.id)
        created_link = await self.role_repository.create_role_permission_link(link)
        await self.audit.record(
            event_type=AuditEventType.PLATFORM_ROLE_PERMISSION_GRANTED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor_id,
            actor_label=actor_label,
            target_type="platform_role",
            target_id=role.id,
            details={"permission_key": permission_key},
        )
        return created_link

    async def revoke_permission_from_role(
        self, role_id: uuid.UUID, permission_key: str, *, actor_id: uuid.UUID, actor_label: str
    ) -> bool:
        """Revoke a permission from a role. Idempotent -- revoking a non-held permission returns False without error."""
        role = await self.get_role(role_id)
        permission = await self.permission_repository.get_by_key(permission_key)
        if permission is None:
            raise NotFoundException(f"No permission found with key {permission_key!r}.")

        deleted = await self.role_repository.delete_role_permission_link(role.id, permission.id)
        if deleted:
            await self.audit.record(
                event_type=AuditEventType.PLATFORM_ROLE_PERMISSION_REVOKED,
                actor_type=AuditActorType.HUMAN_ADMIN,
                actor_id=actor_id,
                actor_label=actor_label,
                target_type="platform_role",
                target_id=role.id,
                details={"permission_key": permission_key},
            )
        return deleted

    async def assign_role(
        self, global_user_id: uuid.UUID, payload: PlatformRoleAssignmentCreate, *, actor_id: uuid.UUID, actor_label: str
    ) -> PlatformRoleAssignment:
        """
        Assign a platform role to a GlobalUser, optionally scoped to one ERP.

        Fail-closed validation, in order: GlobalUser exists; role exists
        and is active; if scope=ERP, the named ERP exists; scope/
        erp_instance_id consistency (defense in depth -- the schema layer
        already checked this, but this method is also called directly by
        seed scripts that bypass the Pydantic schema). Re-activating a
        previously-revoked identical assignment is idempotent rather than
        raising a duplicate-key conflict, since "assign again after
        revoking" is a normal, expected admin action.
        """
        if payload.scope == AuthorizationScope.ERP and payload.erp_instance_id is None:
            raise ForbiddenException("erp_instance_id is required when scope=ERP.")
        if payload.scope == AuthorizationScope.GLOBAL and payload.erp_instance_id is not None:
            raise ForbiddenException("erp_instance_id must be omitted when scope=GLOBAL.")

        global_user = await self.global_user_repository.get_by_id(global_user_id)
        if global_user is None:
            raise NotFoundException(f"No Global User found with id {global_user_id}.")

        role = await self.role_repository.get_by_key(payload.role_key)
        if role is None:
            raise NotFoundException(f"No platform role found with key {payload.role_key!r}.")
        if not role.is_active:
            raise ForbiddenException(f"Role {payload.role_key!r} is not active and cannot be assigned.")

        if payload.erp_instance_id is not None:
            erp_instance = await self.erp_instance_repository.get_by_id(payload.erp_instance_id)
            if erp_instance is None:
                raise NotFoundException(f"No ERP instance found with id {payload.erp_instance_id}.")

        existing = await self.assignment_repository.get_existing(global_user_id, role.id, payload.erp_instance_id)
        if existing is not None:
            if existing.is_active:
                raise ConflictException("This Global User already holds this role in this scope.")
            existing.is_active = True
            existing.revoked_at = None
            existing.revoked_by = None
            existing.assigned_by = actor_id
            existing.expires_at = payload.expires_at
            updated = await self.assignment_repository.create(existing)  # flush + refresh
            await self.audit.record(
                event_type=AuditEventType.PLATFORM_ROLE_ASSIGNED,
                actor_type=AuditActorType.HUMAN_ADMIN,
                actor_id=actor_id,
                actor_label=actor_label,
                target_type="global_user",
                target_id=global_user_id,
                details={"role_key": role.role_key, "scope": payload.scope.value, "reactivated": True},
            )
            return updated

        assignment = PlatformRoleAssignment(
            global_user_id=global_user_id,
            role_id=role.id,
            scope=payload.scope,
            erp_instance_id=payload.erp_instance_id,
            assigned_by=actor_id,
            expires_at=payload.expires_at,
        )
        created = await self.assignment_repository.create(assignment)
        await self.audit.record(
            event_type=AuditEventType.PLATFORM_ROLE_ASSIGNED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor_id,
            actor_label=actor_label,
            target_type="global_user",
            target_id=global_user_id,
            details={"role_key": role.role_key, "scope": payload.scope.value},
        )
        return created

    async def revoke_assignment(
        self, assignment_id: uuid.UUID, *, actor_id: uuid.UUID, actor_label: str
    ) -> PlatformRoleAssignment:
        """Revoke a role assignment. The row remains for audit history; only `is_active`/`revoked_*` change."""
        assignment = await self.assignment_repository.get_by_id(assignment_id)
        if assignment is None:
            raise NotFoundException(f"No role assignment found with id {assignment_id}.")

        assignment.is_active = False
        assignment.revoked_at = datetime.now(timezone.utc)
        assignment.revoked_by = actor_id
        updated = await self.assignment_repository.create(assignment)  # flush + refresh
        await self.audit.record(
            event_type=AuditEventType.PLATFORM_ROLE_REVOKED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor_id,
            actor_label=actor_label,
            target_type="global_user",
            target_id=assignment.global_user_id,
            details={"role_id": str(assignment.role_id)},
        )
        return updated

    async def list_assignments_for_user(self, global_user_id: uuid.UUID) -> list[PlatformRoleAssignment]:
        """List every assignment (active or not) for a GlobalUser."""
        return await self.assignment_repository.list_for_user(global_user_id)

    async def compute_effective_permissions(
        self, global_user_id: uuid.UUID
    ) -> tuple[set[str], dict[uuid.UUID, set[str]]]:
        """
        Compute a GlobalUser's effective platform permissions.

        Returns `(global_permissions, erp_permissions)`, where
        `erp_permissions` maps `erp_instance_id -> set[str]` for
        ERP-scoped grants. Excludes: inactive/revoked assignments,
        expired assignments, and permissions belonging to an inactive
        role (Section 34) -- every one of these exclusions happens here,
        in this one function, so there is exactly one place that could
        ever get "what counts as currently granted" wrong, not several.
        """
        assignments = await self.assignment_repository.list_active_for_user(global_user_id)
        now = datetime.now(timezone.utc)

        global_permissions: set[str] = set()
        erp_permissions: dict[uuid.UUID, set[str]] = {}

        for assignment in assignments:
            if assignment.expires_at is not None:
                expires_at = assignment.expires_at
                if expires_at.tzinfo is None:
                    expires_at = expires_at.replace(tzinfo=timezone.utc)
                if expires_at <= now:
                    continue

            role = assignment.role
            if role is None or not role.is_active:
                continue

            permission_keys = {link.permission.permission_key for link in role.permission_links}

            if assignment.scope == AuthorizationScope.GLOBAL:
                global_permissions.update(permission_keys)
            else:
                bucket = erp_permissions.setdefault(assignment.erp_instance_id, set())
                bucket.update(permission_keys)

        return global_permissions, erp_permissions

    async def has_permission(
        self, global_user_id: uuid.UUID, permission_key: str, *, erp_instance_id: uuid.UUID | None = None
    ) -> bool:
        """
        Return True if a GlobalUser currently holds `permission_key`, globally or for the given ERP.

        A global grant satisfies an ERP-scoped check (Section 9: a
        platform-wide operator's permissions apply everywhere), but an
        ERP-scoped grant for ERP A never satisfies a check for ERP B or
        a global-scope check (Section 28) -- enforced by only ever
        consulting `erp_permissions[erp_instance_id]` when a specific
        `erp_instance_id` was actually passed in.
        """
        global_permissions, erp_permissions = await self.compute_effective_permissions(global_user_id)
        if permission_key in global_permissions:
            return True
        if erp_instance_id is not None and permission_key in erp_permissions.get(erp_instance_id, set()):
            return True
        return False
