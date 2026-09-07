"""
Standard API Response Envelope.

Identical shape to Yinglima_ERP's `app.core.responses`, so that any future
client written against one control-plane-family API already knows how to
parse the other:

Success::

    {
        "success": true,
        "message": "Success",
        "data": { ... },
        "errors": [],
        "meta": { "request_id": "...", "timestamp": "..." }
    }

Error::

    {
        "success": false,
        "message": "ERP not found.",
        "data": null,
        "errors": [{ "code": "NOT_FOUND", "message": "ERP not found.", "details": null }],
        "meta": { "request_id": "...", "timestamp": "..." }
    }
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

DataT = TypeVar("DataT")


class ResponseMeta(BaseModel):
    """Envelope metadata attached to every API response."""

    request_id: str = Field(..., description="Correlation ID for this request, echoed from the X-Request-ID header.")
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="UTC timestamp at which the response was generated.",
    )


class ErrorDetail(BaseModel):
    """A single structured error entry inside the `errors` list."""

    code: str = Field(..., description="Stable, machine-readable error code, e.g. 'NOT_FOUND'.")
    message: str = Field(..., description="Human-readable error message.")
    field: str | None = Field(default=None, description="The request field this error relates to, if applicable.")
    details: Any | None = Field(default=None, description="Optional structured error context.")


class SuccessResponse(BaseModel, Generic[DataT]):
    """Standard success envelope wrapping any endpoint's actual payload."""

    success: bool = True
    message: str = "Success"
    data: DataT | None = None
    errors: list[ErrorDetail] = Field(default_factory=list)
    meta: ResponseMeta


class ErrorResponse(BaseModel):
    """Standard error envelope."""

    success: bool = False
    message: str
    data: None = None
    errors: list[ErrorDetail]
    meta: ResponseMeta


def build_success_response(data: Any, *, request_id: str, message: str = "Success") -> dict:
    """Build a success envelope dict, ready to return from a route or exception handler."""
    return {
        "success": True,
        "message": message,
        "data": data,
        "errors": [],
        "meta": {"request_id": request_id, "timestamp": datetime.now(timezone.utc).isoformat()},
    }


def build_error_response(*, request_id: str, message: str, code: str, details: Any = None) -> dict:
    """Build an error envelope dict, ready to return from an exception handler."""
    return {
        "success": False,
        "message": message,
        "data": None,
        "errors": [{"code": code, "message": message, "field": None, "details": details}],
        "meta": {"request_id": request_id, "timestamp": datetime.now(timezone.utc).isoformat()},
    }
