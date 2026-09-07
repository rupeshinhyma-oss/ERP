"""
Request ID Middleware.

Stamps every request with a correlation ID (`X-Request-ID`), echoed back in
the response envelope's `meta.request_id`. Mirrors Yinglima_ERP's
`app.middleware.request_id`.
"""

from __future__ import annotations

import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Assign (or propagate) a correlation ID for every incoming request."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        """Attach a request ID to `request.state` and the outgoing response header."""
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response
