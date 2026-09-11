"""
In-Memory Rate Limiter for Global Auth Endpoints (Phase 4 Step 42).

A minimal, dependency-free sliding-window limiter keyed by an arbitrary
string (e.g. `f"{ip}:{email}"`). Deliberately simple and explicitly
scoped: this is single-process, in-memory state, which is the right
trade-off for the same reason ERP_Main's existing `app.database.engine`
defaults to SQLite for local/dev -- correctness for a single instance,
not a claim of distributed correctness. A production multi-worker
deployment should replace the in-memory store with a shared one (Redis,
etc.) without changing this module's public interface
(`RateLimiter.check_and_record`).

Protects: login, password reset request, token endpoint (Steps 42/43).
"""

from __future__ import annotations

import time
from collections import defaultdict


class RateLimiter:
    """A simple sliding-window rate limiter: at most `max_attempts` calls per `window_seconds` per key."""

    def __init__(self, *, max_attempts: int, window_seconds: int) -> None:
        """Configure the limiter's window and threshold."""
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: dict[str, list[float]] = defaultdict(list)

    def check_and_record(self, key: str) -> bool:
        """
        Record one attempt for `key` and return True if it is still within the allowed rate.

        Returns False (and still records the attempt) once the caller has
        exceeded `max_attempts` within the current window -- callers
        should treat a False return as "reject this request," typically
        with a 429.
        """
        now = time.monotonic()
        window_start = now - self.window_seconds
        attempts = self._attempts[key]
        # Drop attempts outside the current window.
        attempts[:] = [t for t in attempts if t > window_start]
        attempts.append(now)
        return len(attempts) <= self.max_attempts

    def reset(self, key: str) -> None:
        """Clear recorded attempts for `key` (e.g. after a successful login)."""
        self._attempts.pop(key, None)
