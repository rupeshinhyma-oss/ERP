"""
Exception Handler Registration.

Wires `AppException` (and FastAPI's own `RequestValidationError`) to the
standard response envelope defined in `app.core.responses`. Mirrors
Yinglima_ERP's `app.core.exception_handlers` pattern, trimmed to what
ERP_Main's registry module actually raises.
"""

from __future__ import annotations

import uuid

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.exceptions import AppException
from app.core.responses import build_error_response


def _request_id(request: Request) -> str:
    """Return the request's correlation ID, falling back to a fresh UUID if none was set."""
    return getattr(request.state, "request_id", None) or str(uuid.uuid4())


def register_exception_handlers(app: FastAPI) -> None:
    """Register every exception handler on the given FastAPI app instance."""

    @app.exception_handler(AppException)
    async def handle_app_exception(request: Request, exc: AppException) -> JSONResponse:
        """Translate any `AppException` subclass into the standard error envelope."""
        return JSONResponse(
            status_code=exc.status_code,
            content=jsonable_encoder(
                build_error_response(
                    request_id=_request_id(request),
                    message=exc.message,
                    code=exc.error_code,
                    details=exc.details,
                )
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        """Translate FastAPI/Pydantic request validation errors into the standard error envelope."""
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=jsonable_encoder(
                build_error_response(
                    request_id=_request_id(request),
                    message="Validation failed.",
                    code="VALIDATION_ERROR",
                    details=exc.errors(),
                )
            ),
        )
