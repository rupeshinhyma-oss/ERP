"""
Cross-ERP Reliability, Retry Policy & Peer Circuit Breaker (Phase 8F).

Provides:
1. DeliveryRetryPolicy: Distinguishes retryable vs. non-retryable errors, calculates
   bounded exponential backoff with randomized jitter.
2. Error Sanitization: Regex-based redaction of secrets, passwords, and tokens.
3. PeerCircuitBreakerService: Redis-free, database-backed circuit breaker and cooldown
   tracking to prevent retry storms when peers are offline.
"""

from __future__ import annotations

import random
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.integration.models import PeerHealthState

logger = get_logger(__name__)

# Error codes and classification
RETRYABLE_STATUS_CODES = {408, 425, 429, 500, 502, 503, 504}
NON_RETRYABLE_STATUS_CODES = {400, 401, 403, 404, 405, 422}

_SENSITIVE_PATTERNS = [
    (re.compile(r"(?i)(bearer\s+)[A-Za-z0-9_\-\.]+"), r"\1[REDACTED]"),
    (re.compile(r"(?i)(password[\"']?\s*[:=]\s*[\"'])[^\"']+([\"'])"), r"\1[REDACTED]\2"),
    (re.compile(r"(?i)(secret[\"']?\s*[:=]\s*[\"'])[^\"']+([\"'])"), r"\1[REDACTED]\2"),
    (re.compile(r"(?i)(token[\"']?\s*[:=]\s*[\"'])[^\"']+([\"'])"), r"\1[REDACTED]\2"),
    (re.compile(r"(?i)(authorization[\"']?\s*[:=]\s*[\"'])[^\"']+([\"'])"), r"\1[REDACTED]\2"),
]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def sanitize_error(text: str | None) -> str:
    """Redact passwords, bearer tokens, and secrets from error strings."""
    if not text:
        return ""
    sanitized = str(text)
    for pattern, repl in _SENSITIVE_PATTERNS:
        sanitized = pattern.sub(repl, sanitized)
    return sanitized[:2000]


class DeliveryRetryPolicy:
    """Evaluates retryability and calculates backoff with jitter."""

    BASE_DELAY_SECONDS: float = 5.0
    MAX_DELAY_SECONDS: float = 300.0
    JITTER_SECONDS: float = 2.0

    @classmethod
    def is_retryable(
        cls,
        status_code: int | None = None,
        exc: Exception | None = None,
    ) -> bool:
        """Return True if the failure is transient and eligible for retry."""
        if status_code is not None:
            if status_code in NON_RETRYABLE_STATUS_CODES:
                return False
            if status_code in RETRYABLE_STATUS_CODES:
                return True
            if 400 <= status_code < 500:
                return False
            if status_code >= 500:
                return True

        if exc is not None:
            if isinstance(
                exc,
                (
                    httpx.TimeoutException,
                    httpx.ConnectError,
                    httpx.ConnectTimeout,
                    httpx.ReadTimeout,
                    httpx.NetworkError,
                    ConnectionError,
                    OSError,
                ),
            ):
                return True
            if isinstance(exc, (ValueError, KeyError, TypeError)):
                return False

        return False

    @classmethod
    def calculate_backoff(
        cls,
        attempt: int,
        base_delay: float | None = None,
        max_delay: float | None = None,
        jitter: float | None = None,
    ) -> float:
        """Calculate exponential backoff with randomized jitter."""
        b = base_delay or cls.BASE_DELAY_SECONDS
        m = max_delay or cls.MAX_DELAY_SECONDS
        j = jitter or cls.JITTER_SECONDS

        delay = min(m, b * (2 ** max(0, attempt - 1)))
        delay += random.uniform(0.1, j)
        return round(delay, 2)


class PeerCircuitBreakerService:
    """
    Database-backed peer circuit breaker and cooldown tracking (Redis-free).
    """

    FAILURE_THRESHOLD: int = 5
    COOLDOWN_SECONDS: int = 30

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_or_create(self, peer_id: str) -> PeerHealthState:
        """Fetch or initialize the circuit state for peer_id."""
        norm_id = peer_id.lower().strip()
        stmt = select(PeerHealthState).where(PeerHealthState.peer_id == norm_id)
        res = await self.db.execute(stmt)
        state = res.scalar_one_or_none()
        if state is None:
            state = PeerHealthState(
                peer_id=norm_id,
                circuit_state="CLOSED",
                consecutive_failures=0,
                consecutive_successes=0,
            )
            self.db.add(state)
            await self.db.flush()
        return state

    async def can_attempt_delivery(self, peer_id: str) -> tuple[bool, str]:
        """
        Check if an outbound request to peer_id is permitted.
        Returns (is_allowed, circuit_state).
        """
        state = await self.get_or_create(peer_id)
        now = _utcnow()

        if state.circuit_state == "CLOSED":
            return True, "CLOSED"

        if state.circuit_state == "OPEN":
            if state.cooldown_until and now >= state.cooldown_until:
                state.circuit_state = "HALF_OPEN"
                await self.db.flush()
                logger.info("Circuit breaker for peer '%s' transitioned to HALF_OPEN (probe allowed).", peer_id)
                return True, "HALF_OPEN"
            return False, "OPEN_COOLDOWN"

        if state.circuit_state == "HALF_OPEN":
            return True, "HALF_OPEN"

        return True, "CLOSED"

    async def record_success(self, peer_id: str) -> None:
        """Record a successful delivery: closes circuit and resets failure counters."""
        state = await self.get_or_create(peer_id)
        state.circuit_state = "CLOSED"
        state.consecutive_failures = 0
        state.consecutive_successes += 1
        state.cooldown_until = None
        state.last_success_at = _utcnow()
        await self.db.flush()

    async def record_failure(self, peer_id: str, error_code: str = "") -> None:
        """Record a delivery failure: trips circuit to OPEN if threshold exceeded."""
        state = await self.get_or_create(peer_id)
        state.consecutive_failures += 1
        state.consecutive_successes = 0
        state.last_failure_at = _utcnow()

        if state.consecutive_failures >= self.FAILURE_THRESHOLD:
            state.circuit_state = "OPEN"
            state.cooldown_until = _utcnow() + timedelta(seconds=self.COOLDOWN_SECONDS)
            logger.warning(
                "Circuit breaker tripped to OPEN for peer '%s' after %d consecutive failures. Cooldown until %s.",
                peer_id,
                state.consecutive_failures,
                state.cooldown_until.isoformat(),
            )
        await self.db.flush()

    async def list_all_states(self) -> list[PeerHealthState]:
        """List all peer health states for operational inspection."""
        stmt = select(PeerHealthState).order_by(PeerHealthState.peer_id.asc())
        res = await self.db.execute(stmt)
        return list(res.scalars().all())
