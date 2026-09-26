"""
Request ID Middleware.

Stamps every request with a correlation ID (`X-Request-ID`), echoed back in
the response envelope's `meta.request_id`. Mirrors Yinglima_ERP's
`app.middleware.request_id`.
"""

from __future__ import annotations

import re
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response


def _sanitize_correlation_id(raw_id: str | None) -> str:
    """Sanitize incoming correlation ID to safe alphanumeric, dash, and underscore."""
    if not raw_id:
        return str(uuid.uuid4())
    cleaned = re.sub(r"[^a-zA-Z0-9_\-]", "", raw_id)[:64]
    return cleaned if len(cleaned) >= 4 else str(uuid.uuid4())


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Assign (or propagate) a correlation ID for every incoming request."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        """Attach a correlation ID to `request.state` and outgoing response headers."""
        raw_id = request.headers.get("x-correlation-id") or request.headers.get("x-request-id")
        correlation_id = _sanitize_correlation_id(raw_id)
        request.state.request_id = correlation_id
        request.state.correlation_id = correlation_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = correlation_id
        response.headers["X-Correlation-ID"] = correlation_id
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Inject protective HTTP security headers on all responses."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        return response

