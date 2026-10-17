"""
CRM Lead Assignment Engine Service.

Provides automated, concurrency-safe, policy-based lead distribution across eligible sales representatives:
1. Candidate Qualification:
   - User has active CrmSalespersonConfig with is_eligible=True and is_active=True.
   - ERP User is active, not soft-deleted, has_login=True, and status=UserStatus.ACTIVE.
   - Scoped to sales manager's departmental authority when actor is a scoped manager.
   - Enforces max_lead_capacity; skips candidates who are at or above configured capacity.
2. Decision & Prioritization Strategies:
   - Territory/State priority: matches lead's state against CrmSalespersonTerritory records.
   - General pool fallback when territory representatives are absent or saturated (configurable).
   - Round-robin (cursor-backed with SELECT ... FOR UPDATE).
   - Least-active lead distribution (lowest active open lead count).
   - Priority-based distribution (lower integer = higher priority).
3. Concurrency & Transaction Safety:
   - Atomic lead update, cursor advancement, and append-only CrmAssignmentHistory insertion.
   - Nested savepoint safe-initialization of CrmRoundRobinCursor under concurrent requests.
   - Real-time in-transaction capacity re-check to prevent over-allocation.
4. Idempotency:
   - Never overwrites an existing lead owner (assigned_to is not None).
   - Skips duplicate leads (status="CRM_DUPLICATE").
   - Explicit structured outcomes: assigned, skipped, unassigned with exact machine-readable reasons.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import uuid
from datetime import datetime, timezone
from typing import Any, Sequence

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.service import CurrentUser
from app.core.constants import RecordStatus
from app.core.exceptions import ForbiddenException
from app.core.logging import get_logger
from app.crm.models import (
    CrmAssignmentConfig,
    CrmAssignmentHistory,
    CrmLead,
    CrmRoundRobinCursor,
    CrmSalespersonConfig,
    CrmSalespersonTerritory,
)
from app.crm.service import CrmSalespersonDistributionService
from app.database.base import _utcnow
from app.masters.states.models import State
from app.users.models import User, UserStatus

logger = get_logger(__name__)


@dataclass
class SalespersonCandidate:
    """Salesperson candidate representation for assignment evaluation."""

    user_id: uuid.UUID
    username: str
    display_name: str | None
    priority: int
    max_lead_capacity: int | None
    active_lead_count: int
    territory_state_ids: set[uuid.UUID] = field(default_factory=set)


@dataclass
class LeadAssignmentResult:
    """Structured, machine-readable outcome of a lead assignment attempt."""

    lead_id: uuid.UUID
    assigned: bool
    status: str  # "assigned", "skipped", "unassigned"
    reason: str | None = None
    assigned_to: uuid.UUID | None = None
    previous_owner_id: uuid.UUID | None = None
    assignment_method: str | None = None
    history_id: uuid.UUID | None = None
    matched_state_id: uuid.UUID | None = None
    matched_state_name: str | None = None
    rule_name: str | None = None


class CrmAssignmentEngineService:
    """
    Lead Assignment Engine for Inhyma ERP CRM.

    Coordinates candidate eligibility, territory mapping, capacity limits,
    round-robin cursors, and append-only assignment history.
    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._distribution_service = CrmSalespersonDistributionService(session)

    # -------------------------------------------------------------------------
    # State / Territory Resolution
    # -------------------------------------------------------------------------

    async def resolve_lead_state(self, lead: CrmLead) -> State | None:
        """
        Defensively extract and normalize state/territory from lead.custom_fields.

        Does NOT guess territory from phone numbers or campaign names.
        Matches against active records in the `states` table.
        """
        cf = lead.custom_fields
        if not isinstance(cf, dict):
            return None

        # 1. Direct state_id check
        raw_state_id = cf.get("state_id") or cf.get("stateId") or cf.get("territory_id")
        if raw_state_id:
            try:
                state_uuid = uuid.UUID(str(raw_state_id))
                stmt = select(State).where(
                    State.id == state_uuid,
                    State.deleted_at.is_(None),
                    State.status == RecordStatus.ACTIVE,
                )
                state = (await self.session.execute(stmt)).scalar_one_or_none()
                if state:
                    return state
            except (ValueError, TypeError):
                logger.debug("Invalid UUID format in custom_fields for state_id: %s", raw_state_id)

        # 2. String state name or code check
        raw_state_name = cf.get("state") or cf.get("state_name") or cf.get("territory")
        if isinstance(raw_state_name, str) and raw_state_name.strip():
            clean_name = raw_state_name.strip()
            # Match by lower name or lower code
            stmt = select(State).where(
                (func.lower(State.name) == clean_name.lower())
                | (func.lower(State.code) == clean_name.lower()),
                State.deleted_at.is_(None),
                State.status == RecordStatus.ACTIVE,
            )
            state = (await self.session.execute(stmt)).scalars().first()
            if state:
                return state

        return None

    # -------------------------------------------------------------------------
    # Candidate Eligibility & Metrics
    # -------------------------------------------------------------------------

    async def get_active_lead_counts(self, user_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, int]:
        """
        Compute active CRM lead counts per salesperson.

        Follows established CRM capacity semantics:
        Any lead assigned to user, not soft-deleted, and status not in ('won', 'lost').
        """
        if not user_ids:
            return {}

        stmt = (
            select(CrmLead.assigned_to, func.count(CrmLead.id))
            .where(
                CrmLead.assigned_to.in_(user_ids),
                CrmLead.deleted_at.is_(None),
                CrmLead.status.notin_(["won", "lost"]),
            )
            .group_by(CrmLead.assigned_to)
        )
        rows = (await self.session.execute(stmt)).all()
        return {r[0]: int(r[1]) for r in rows if r[0] is not None}

    async def get_eligible_candidates(
        self,
        *,
        actor: CurrentUser | None = None,
        ignore_capacity: bool = False,
    ) -> list[SalespersonCandidate]:
        """
        Select all active and assignment-eligible salespeople.

        Rules:
        - CrmSalespersonConfig.is_eligible is True and is_active is True.
        - ERP User is_active is True, deleted_at is None, has_login is True, status is ACTIVE.
        - Constrained to actor's authorized scope if actor is provided and scoped.
        - Excludes candidates at or above max_lead_capacity unless ignore_capacity=True.
        """
        allowed_scope: set[uuid.UUID] | None = None
        if actor is not None:
            try:
                allowed_scope = await self._distribution_service.get_actor_scope(actor)
            except ForbiddenException:
                # Regular salesperson importing leads: scope is restricted strictly to themselves.
                # They cannot assign leads to other users.
                allowed_scope = {actor.id}

        stmt = (
            select(User, CrmSalespersonConfig)
            .join(CrmSalespersonConfig, CrmSalespersonConfig.user_id == User.id)
            .where(
                CrmSalespersonConfig.is_eligible.is_(True),
                CrmSalespersonConfig.is_active.is_(True),
                User.deleted_at.is_(None),
                User.is_active.is_(True),
                User.has_login.is_(True),
                User.status == UserStatus.ACTIVE,
            )
            .options(selectinload(CrmSalespersonConfig.territories))
        )

        if allowed_scope is not None:
            stmt = stmt.where(User.id.in_(list(allowed_scope)))

        rows = (await self.session.execute(stmt)).all()
        if not rows:
            return []

        user_ids = [u.id for u, _ in rows]
        lead_counts = await self.get_active_lead_counts(user_ids)

        candidates: list[SalespersonCandidate] = []
        for user, cfg in rows:
            active_count = lead_counts.get(user.id, 0)
            cap = cfg.max_lead_capacity

            # Enforce max_lead_capacity
            if not ignore_capacity and cap is not None and active_count >= cap:
                continue

            terr_state_ids = {t.state_id for t in cfg.territories if t.state_id}

            candidates.append(
                SalespersonCandidate(
                    user_id=user.id,
                    username=user.username or "",
                    display_name=user.display_name or user.full_name,
                    priority=cfg.priority if cfg.priority is not None else 1,
                    max_lead_capacity=cap,
                    active_lead_count=active_count,
                    territory_state_ids=terr_state_ids,
                )
            )

        return candidates

    # -------------------------------------------------------------------------
    # Concurrency-Safe Round-Robin Cursor
    # -------------------------------------------------------------------------

    async def _get_or_create_cursor_locked(self, pool_key: str) -> CrmRoundRobinCursor:
        """
        Retrieve round-robin cursor for pool_key with row-level lock (FOR UPDATE).

        Uses nested savepoint to handle concurrent initialization safely without
        aborting the outer transaction.
        """
        cursor_stmt = (
            select(CrmRoundRobinCursor)
            .where(CrmRoundRobinCursor.pool_key == pool_key)
            .with_for_update()
        )
        cursor = (await self.session.execute(cursor_stmt)).scalar_one_or_none()

        if cursor is None:
            try:
                async with self.session.begin_nested():
                    new_cursor = CrmRoundRobinCursor(
                        pool_key=pool_key,
                        last_assigned_user_id=None,
                        last_assigned_index=0,
                    )
                    self.session.add(new_cursor)
                    await self.session.flush()
                cursor = (await self.session.execute(cursor_stmt)).scalar_one()
            except IntegrityError:
                # Concurrent transaction inserted the row; lock existing
                cursor = (await self.session.execute(cursor_stmt)).scalar_one()

        return cursor

    # -------------------------------------------------------------------------
    # Active Configurations
    # -------------------------------------------------------------------------

    async def get_active_assignment_configs(self) -> list[CrmAssignmentConfig]:
        """Load all active assignment configs ordered by priority ascending."""
        stmt = (
            select(CrmAssignmentConfig)
            .where(CrmAssignmentConfig.is_active.is_(True))
            .order_by(CrmAssignmentConfig.priority.asc(), CrmAssignmentConfig.name.asc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    # -------------------------------------------------------------------------
    # Strategy Evaluation & Selection
    # -------------------------------------------------------------------------

    async def _select_candidate_for_pool(
        self,
        candidates: list[SalespersonCandidate],
        strategy: str,
        pool_key: str,
    ) -> tuple[SalespersonCandidate, str]:
        """
        Deterministically select a winning candidate from a pool according to the strategy.

        Returns: (winning_candidate, assignment_method_label)
        """
        if not candidates:
            raise ValueError("Candidate pool cannot be empty.")

        # 1. Least-Active Strategy
        if strategy == "least_active":
            # Lowest active leads, then highest priority (lowest integer), then username, user_id
            candidates_sorted = sorted(
                candidates,
                key=lambda c: (c.active_lead_count, c.priority, (c.username or "").lower(), c.user_id),
            )
            return candidates_sorted[0], "least_active"

        # 2. Priority Strategy
        if strategy == "priority":
            # Highest priority (lowest integer), then lowest active leads, then username, user_id
            candidates_sorted = sorted(
                candidates,
                key=lambda c: (c.priority, c.active_lead_count, (c.username or "").lower(), c.user_id),
            )
            return candidates_sorted[0], "priority"

        # 3. Round-Robin Strategy (Default)
        # Deterministic ordering for rotation
        candidates_sorted = sorted(
            candidates,
            key=lambda c: (c.priority, (c.username or "").lower(), c.user_id),
        )
        cursor = await self._get_or_create_cursor_locked(pool_key)
        n = len(candidates_sorted)

        # Find current index
        current_index = -1
        if cursor.last_assigned_user_id is not None:
            for idx, cand in enumerate(candidates_sorted):
                if cand.user_id == cursor.last_assigned_user_id:
                    current_index = idx
                    break

        if current_index >= 0:
            next_index = (current_index + 1) % n
        else:
            next_index = cursor.last_assigned_index % n

        winner = candidates_sorted[next_index]

        # Advance cursor
        cursor.last_assigned_user_id = winner.user_id
        cursor.last_assigned_index = next_index
        cursor.updated_at = _utcnow()

        if pool_key.startswith("territory:"):
            method = "state_priority"
        else:
            method = "round_robin"
        return winner, method

    # -------------------------------------------------------------------------
    # Core Lead Assignment
    # -------------------------------------------------------------------------

    async def assign_lead(
        self,
        lead: CrmLead,
        *,
        actor: CurrentUser | None = None,
        batch_id: uuid.UUID | None = None,
        commit: bool = True,
    ) -> LeadAssignmentResult:
        """
        Assign an individual lead according to configured distribution strategies.

        Ensures:
        - Never overwrites an existing lead owner.
        - Never assigns duplicate leads (CRM_DUPLICATE).
        - Respects salesperson eligibility, manager scope, territory, and capacity.
        - Atomically writes ownership, cursor advancement, and CrmAssignmentHistory.
        """
        # 1. Idempotency Check: Existing Owner
        if lead.assigned_to is not None:
            return LeadAssignmentResult(
                lead_id=lead.id,
                assigned=False,
                status="skipped",
                reason="already_assigned",
                assigned_to=lead.assigned_to,
            )

        # 2. Duplicate Ingestion Protection
        if getattr(lead, "status", None) == "CRM_DUPLICATE":
            return LeadAssignmentResult(
                lead_id=lead.id,
                assigned=False,
                status="skipped",
                reason="duplicate_lead",
                assigned_to=None,
            )

        # 3. Candidate Retrieval
        all_eligible = await self.get_eligible_candidates(actor=actor, ignore_capacity=False)
        if not all_eligible:
            # Diagnose why no candidate is available
            unfiltered = await self.get_eligible_candidates(actor=actor, ignore_capacity=True)
            reason = "all_candidates_at_capacity" if unfiltered else "no_eligible_salespeople"
            return LeadAssignmentResult(
                lead_id=lead.id,
                assigned=False,
                status="unassigned",
                reason=reason,
                assigned_to=None,
            )

        # 4. State / Territory Preference & Fallback Evaluation
        matched_state = await self.resolve_lead_state(lead)
        active_configs = await self.get_active_assignment_configs()
        primary_config = active_configs[0] if active_configs else None

        # Determine configured fallback rule (default: fallback_to_general=True)
        fallback_to_general = True
        rule_strategy = "round_robin"
        rule_name = None

        if primary_config:
            rule_name = primary_config.name
            rule_cfg = primary_config.configuration or {}
            if "fallback_to_general" in rule_cfg:
                fallback_to_general = bool(rule_cfg["fallback_to_general"])
            rule_strategy = rule_cfg.get("strategy") or primary_config.rule_type

        # Map candidate pool
        chosen_pool: list[SalespersonCandidate] = []
        pool_key = "default"
        is_territory_match = False

        if matched_state is not None:
            territory_candidates = [c for c in all_eligible if matched_state.id in c.territory_state_ids]
            if territory_candidates:
                chosen_pool = territory_candidates
                pool_key = f"territory:{matched_state.id}"
                is_territory_match = True
            else:
                # No territory candidates under capacity
                if not fallback_to_general:
                    return LeadAssignmentResult(
                        lead_id=lead.id,
                        assigned=False,
                        status="unassigned",
                        reason="no_territory_match",
                        assigned_to=None,
                        matched_state_id=matched_state.id,
                        matched_state_name=matched_state.name,
                        rule_name=rule_name,
                    )
                # Fallback permitted
                chosen_pool = all_eligible
                pool_key = "default"
        else:
            # No reliable state on lead
            chosen_pool = all_eligible
            pool_key = "default"

        if not chosen_pool:
            return LeadAssignmentResult(
                lead_id=lead.id,
                assigned=False,
                status="unassigned",
                reason="all_candidates_at_capacity" if is_territory_match else "no_eligible_salespeople",
                assigned_to=None,
                matched_state_id=matched_state.id if matched_state else None,
                matched_state_name=matched_state.name if matched_state else None,
                rule_name=rule_name,
            )

        # 5. Selection with In-Transaction Capacity Guard
        # If candidate pool has saturated members due to concurrency, rotate to next
        winner: SalespersonCandidate | None = None
        method_label: str = "auto_assign"
        active_pool = list(chosen_pool)

        while active_pool:
            selected_cand, selected_method = await self._select_candidate_for_pool(
                active_pool,
                strategy=rule_strategy,
                pool_key=pool_key,
            )

            # Database row lock on the candidate's CrmSalespersonConfig
            # Serializes capacity evaluation and assignment across concurrent transactions, workers, and pools
            cfg_lock_stmt = (
                select(CrmSalespersonConfig)
                .where(CrmSalespersonConfig.user_id == selected_cand.user_id)
                .with_for_update()
            )
            locked_cfg = (await self.session.execute(cfg_lock_stmt)).scalar_one_or_none()

            # In-transaction capacity verification under database row lock
            latest_count_map = await self.get_active_lead_counts([selected_cand.user_id])
            current_active = latest_count_map.get(selected_cand.user_id, 0)

            effective_cap = locked_cfg.max_lead_capacity if locked_cfg else selected_cand.max_lead_capacity
            if effective_cap is not None and current_active >= effective_cap:
                # Saturated under concurrent check: remove and re-evaluate remaining pool
                active_pool = [c for c in active_pool if c.user_id != selected_cand.user_id]
                continue

            winner = selected_cand
            method_label = selected_method
            break

        if winner is None:
            return LeadAssignmentResult(
                lead_id=lead.id,
                assigned=False,
                status="unassigned",
                reason="all_candidates_at_capacity",
                assigned_to=None,
                matched_state_id=matched_state.id if matched_state else None,
                matched_state_name=matched_state.name if matched_state else None,
                rule_name=rule_name,
            )

        # 6. Apply Ownership & Append History Atomically
        previous_owner_id = lead.assigned_to
        lead.assigned_to = winner.user_id

        reason_text = f"Automated lead assignment via {method_label}"
        if matched_state:
            reason_text += f" (state: {matched_state.name})"
        if rule_name:
            reason_text += f" [rule: {rule_name}]"

        history = CrmAssignmentHistory(
            lead_id=lead.id,
            previous_owner_id=previous_owner_id,
            new_owner_id=winner.user_id,
            assignment_method=method_label,
            assigned_by=actor.id if actor else None,
            reason=reason_text,
            batch_id=batch_id,
            created_at=_utcnow(),
        )
        self.session.add(history)
        await self.session.flush()

        if commit:
            await self.session.commit()
            await self.session.refresh(lead)

        return LeadAssignmentResult(
            lead_id=lead.id,
            assigned=True,
            status="assigned",
            reason=None,
            assigned_to=winner.user_id,
            previous_owner_id=previous_owner_id,
            assignment_method=method_label,
            history_id=history.id,
            matched_state_id=matched_state.id if matched_state else None,
            matched_state_name=matched_state.name if matched_state else None,
            rule_name=rule_name,
        )

    # -------------------------------------------------------------------------
    # Batch Assignment
    # -------------------------------------------------------------------------

    async def assign_batch(
        self,
        leads: Sequence[CrmLead],
        *,
        actor: CurrentUser | None = None,
        batch_id: uuid.UUID | None = None,
        commit: bool = True,
    ) -> list[LeadAssignmentResult]:
        """
        Assign a sequence of leads in order within a single transaction.

        Maintains atomic commit boundary: either all assigned leads commit,
        or session is rolled back upon unexpected exception.
        """
        results: list[LeadAssignmentResult] = []
        for lead in leads:
            res = await self.assign_lead(
                lead,
                actor=actor,
                batch_id=batch_id,
                commit=False,
            )
            results.append(res)

        if commit:
            await self.session.commit()

        return results

    # -------------------------------------------------------------------------
    # Distribution Across Selected Candidates
    # -------------------------------------------------------------------------

    async def assign_lead_to_candidates(
        self,
        lead: CrmLead,
        candidate_user_ids: Sequence[uuid.UUID],
        strategy: str = "round_robin",
        *,
        actor: CurrentUser | None = None,
        batch_id: uuid.UUID | None = None,
        commit: bool = True,
    ) -> LeadAssignmentResult:
        """
        Assign an individual lead across a specific list of selected candidate salespeople.
        Uses in-transaction row locking and capacity checks to prevent over-allocation.
        """
        if lead.assigned_to is not None:
            return LeadAssignmentResult(
                lead_id=lead.id,
                assigned=False,
                status="skipped",
                reason="already_assigned",
                assigned_to=lead.assigned_to,
            )

        if getattr(lead, "status", None) == "CRM_DUPLICATE":
            return LeadAssignmentResult(
                lead_id=lead.id,
                assigned=False,
                status="skipped",
                reason="duplicate_lead",
                assigned_to=None,
            )

        allowed_scope: set[uuid.UUID] | None = None
        if actor is not None:
            try:
                allowed_scope = await self._distribution_service.get_actor_scope(actor)
            except ForbiddenException:
                allowed_scope = {actor.id}

        stmt = (
            select(User, CrmSalespersonConfig)
            .join(CrmSalespersonConfig, CrmSalespersonConfig.user_id == User.id)
            .where(
                User.id.in_(list(candidate_user_ids)),
                CrmSalespersonConfig.is_eligible.is_(True),
                CrmSalespersonConfig.is_active.is_(True),
                User.deleted_at.is_(None),
                User.is_active.is_(True),
                User.has_login.is_(True),
                User.status == UserStatus.ACTIVE,
            )
            .options(selectinload(CrmSalespersonConfig.territories))
        )
        if allowed_scope is not None:
            stmt = stmt.where(User.id.in_(list(allowed_scope)))

        rows = (await self.session.execute(stmt)).all()
        if not rows:
            return LeadAssignmentResult(
                lead_id=lead.id,
                assigned=False,
                status="unassigned",
                reason="no_eligible_salespeople",
                assigned_to=None,
            )

        user_ids = [u.id for u, _ in rows]
        lead_counts = await self.get_active_lead_counts(user_ids)

        candidates: list[SalespersonCandidate] = []
        for user, cfg in rows:
            active_count = lead_counts.get(user.id, 0)
            cap = cfg.max_lead_capacity
            if cap is not None and active_count >= cap:
                continue

            terr_state_ids = {t.state_id for t in cfg.territories if t.state_id}
            candidates.append(
                SalespersonCandidate(
                    user_id=user.id,
                    username=user.username or "",
                    display_name=user.display_name or user.full_name,
                    priority=cfg.priority if cfg.priority is not None else 1,
                    max_lead_capacity=cap,
                    active_lead_count=active_count,
                    territory_state_ids=terr_state_ids,
                )
            )

        if not candidates:
            return LeadAssignmentResult(
                lead_id=lead.id,
                assigned=False,
                status="unassigned",
                reason="all_candidates_at_capacity",
                assigned_to=None,
            )

        pool_key = (
            f"import_batch:{batch_id}"
            if batch_id
            else f"custom_pool:{':'.join(sorted(str(u) for u in candidate_user_ids))[:100]}"
        )
        active_pool = list(candidates)
        winner: SalespersonCandidate | None = None
        method_label = f"selected_reps_{strategy}"

        while active_pool:
            selected_cand, _ = await self._select_candidate_for_pool(
                active_pool,
                strategy=strategy if strategy in ("least_active", "priority") else "round_robin",
                pool_key=pool_key,
            )

            cfg_lock_stmt = (
                select(CrmSalespersonConfig)
                .where(CrmSalespersonConfig.user_id == selected_cand.user_id)
                .with_for_update()
            )
            locked_cfg = (await self.session.execute(cfg_lock_stmt)).scalar_one_or_none()
            latest_count_map = await self.get_active_lead_counts([selected_cand.user_id])
            current_active = latest_count_map.get(selected_cand.user_id, 0)
            effective_cap = locked_cfg.max_lead_capacity if locked_cfg else selected_cand.max_lead_capacity

            if effective_cap is not None and current_active >= effective_cap:
                active_pool = [c for c in active_pool if c.user_id != selected_cand.user_id]
                continue

            winner = selected_cand
            break

        if winner is None:
            return LeadAssignmentResult(
                lead_id=lead.id,
                assigned=False,
                status="unassigned",
                reason="all_candidates_at_capacity",
                assigned_to=None,
            )

        previous_owner_id = lead.assigned_to
        lead.assigned_to = winner.user_id

        history = CrmAssignmentHistory(
            lead_id=lead.id,
            previous_owner_id=previous_owner_id,
            new_owner_id=winner.user_id,
            assignment_method=method_label,
            assigned_by=actor.id if actor else None,
            reason=f"Import distribution across selected representatives via {strategy}",
            batch_id=batch_id,
            created_at=_utcnow(),
        )
        self.session.add(history)
        await self.session.flush()

        if commit:
            await self.session.commit()
            await self.session.refresh(lead)

        return LeadAssignmentResult(
            lead_id=lead.id,
            assigned=True,
            status="assigned",
            reason=None,
            assigned_to=winner.user_id,
            previous_owner_id=previous_owner_id,
            assignment_method=method_label,
            history_id=history.id,
        )

    # -------------------------------------------------------------------------
    # Distribution to a Single Selected Salesperson
    # -------------------------------------------------------------------------

    async def assign_lead_to_single_salesperson(
        self,
        lead: CrmLead,
        target_salesperson_id: uuid.UUID,
        *,
        actor: CurrentUser | None = None,
        batch_id: uuid.UUID | None = None,
        commit: bool = True,
    ) -> LeadAssignmentResult:
        """
        Assign an individual lead directly to one target salesperson if eligible and within capacity.
        """
        if lead.assigned_to is not None:
            return LeadAssignmentResult(
                lead_id=lead.id,
                assigned=False,
                status="skipped",
                reason="already_assigned",
                assigned_to=lead.assigned_to,
            )

        if getattr(lead, "status", None) == "CRM_DUPLICATE":
            return LeadAssignmentResult(
                lead_id=lead.id,
                assigned=False,
                status="skipped",
                reason="duplicate_lead",
                assigned_to=None,
            )

        allowed_scope: set[uuid.UUID] | None = None
        if actor is not None:
            try:
                allowed_scope = await self._distribution_service.get_actor_scope(actor)
            except ForbiddenException:
                allowed_scope = {actor.id}

        if allowed_scope is not None and target_salesperson_id not in allowed_scope:
            return LeadAssignmentResult(
                lead_id=lead.id,
                assigned=False,
                status="unassigned",
                reason="salesperson_out_of_scope",
                assigned_to=None,
            )

        stmt = (
            select(User, CrmSalespersonConfig)
            .join(CrmSalespersonConfig, CrmSalespersonConfig.user_id == User.id)
            .where(
                User.id == target_salesperson_id,
                CrmSalespersonConfig.is_eligible.is_(True),
                CrmSalespersonConfig.is_active.is_(True),
                User.deleted_at.is_(None),
                User.is_active.is_(True),
                User.has_login.is_(True),
                User.status == UserStatus.ACTIVE,
            )
        )
        row = (await self.session.execute(stmt)).first()
        if not row:
            return LeadAssignmentResult(
                lead_id=lead.id,
                assigned=False,
                status="unassigned",
                reason="no_eligible_salespeople",
                assigned_to=None,
            )

        user, cfg = row

        # Lock config & verify capacity
        cfg_lock_stmt = (
            select(CrmSalespersonConfig)
            .where(CrmSalespersonConfig.user_id == target_salesperson_id)
            .with_for_update()
        )
        locked_cfg = (await self.session.execute(cfg_lock_stmt)).scalar_one_or_none()
        latest_count_map = await self.get_active_lead_counts([target_salesperson_id])
        current_active = latest_count_map.get(target_salesperson_id, 0)
        effective_cap = locked_cfg.max_lead_capacity if locked_cfg else cfg.max_lead_capacity

        if effective_cap is not None and current_active >= effective_cap:
            return LeadAssignmentResult(
                lead_id=lead.id,
                assigned=False,
                status="unassigned",
                reason="all_candidates_at_capacity",
                assigned_to=None,
            )

        previous_owner_id = lead.assigned_to
        lead.assigned_to = target_salesperson_id

        history = CrmAssignmentHistory(
            lead_id=lead.id,
            previous_owner_id=previous_owner_id,
            new_owner_id=target_salesperson_id,
            assignment_method="single_salesperson",
            assigned_by=actor.id if actor else None,
            reason="Import direct assignment to selected representative",
            batch_id=batch_id,
            created_at=_utcnow(),
        )
        self.session.add(history)
        await self.session.flush()

        if commit:
            await self.session.commit()
            await self.session.refresh(lead)

        return LeadAssignmentResult(
            lead_id=lead.id,
            assigned=True,
            status="assigned",
            reason=None,
            assigned_to=target_salesperson_id,
            previous_owner_id=previous_owner_id,
            assignment_method="single_salesperson",
            history_id=history.id,
        )
