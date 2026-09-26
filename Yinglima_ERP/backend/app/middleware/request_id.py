"""
Request ID Middleware.

Assigns a unique correlation ID to every incoming HTTP request. This ID is:

1. Read from an inbound ``X-Request-ID`` header if the caller (or an
   upstream gateway/load balancer) already supplied one, so a single
   request can be traced across multiple services.
2. Otherwise generated fresh as a UUID4.
3. Stored in a ``ContextVar`` (see :mod:`app.core.logging`) so every log
   line emitted while handling this request is automatically tagged with
   it, without threading it through every function signature.
4. Attached to ``request.state.request_id`` so route handlers/services can
   read it directly if needed (e.g. to embed it in the response envelope).
5. Echoed back to the client on the ``X-Request-ID`` response header.
"""

from __future__ import annotations

import re
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging import request_id_ctx_var

REQUEST_ID_HEADER = "X-Request-ID"
CORRELATION_ID_HEADER = "X-Correlation-ID"


def _sanitize_correlation_id(raw_id: str | None) -> str:
    """Sanitize incoming correlation ID to safe alphanumeric, dash, and underscore."""
    if not raw_id:
        return str(uuid.uuid4())
    cleaned = re.sub(r"[^a-zA-Z0-9_\-]", "", raw_id)[:64]
    return cleaned if len(cleaned) >= 4 else str(uuid.uuid4())


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Attach a correlation ID to every request and its logs/response."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        """Generate/propagate the request ID, store it, and echo it back."""
        raw_id = request.headers.get(CORRELATION_ID_HEADER) or request.headers.get(REQUEST_ID_HEADER)
        request_id = _sanitize_correlation_id(raw_id)

        token = request_id_ctx_var.set(request_id)
        request.state.request_id = request_id
        request.state.correlation_id = request_id
        try:
            response = await call_next(request)
        finally:
            request_id_ctx_var.reset(token)

        response.headers[REQUEST_ID_HEADER] = request_id
        response.headers[CORRELATION_ID_HEADER] = request_id
        return response
