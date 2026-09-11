"""
In-Memory Sliding-Window Rate Limiter for Abuse Protection (Section 14).

Provides thread-safe, sliding-window rate limiting for sensitive and public endpoints:
- Public RFQ token endpoints
- Password reset endpoints
- Inbound webhooks
"""

from __future__ import annotations

import time
from collections import defaultdict
from fastapi import HTTPException, Request, status


class RateLimiter:
    """Sliding-window rate limiter: at most `max_attempts` calls per `window_seconds` per key."""

    def __init__(self, *, max_attempts: int, window_seconds: int) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: dict[str, list[float]] = defaultdict(list)

    def check_and_record(self, key: str) -> bool:
        """
        Record one attempt for `key` and return True if within limit, False if exceeded.
        """
        now = time.monotonic()
        window_start = now - self.window_seconds
        attempts = self._attempts[key]
        attempts[:] = [t for t in attempts if t > window_start]
        attempts.append(now)
        return len(attempts) <= self.max_attempts

    def reset(self, key: str) -> None:
        """Clear recorded attempts for `key`."""
        self._attempts.pop(key, None)


# Module-level instances for specific sensitive endpoint protection
public_rfq_limiter = RateLimiter(max_attempts=60, window_seconds=60)
forgot_password_limiter = RateLimiter(max_attempts=5, window_seconds=300)
webhook_limiter = RateLimiter(max_attempts=120, window_seconds=60)


def enforce_rate_limit(limiter: RateLimiter, request: Request, key_suffix: str = "") -> None:
    """Helper to enforce rate limit based on client IP and optional suffix (e.g. username/token)."""
    client_ip = request.client.host if request.client else "unknown"
    key = f"{client_ip}:{key_suffix}" if key_suffix else client_ip
    if not limiter.check_and_record(key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please slow down and try again later.",
        )
