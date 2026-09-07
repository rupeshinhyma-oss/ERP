"""
ERP_Main Exception Hierarchy.

Mirrors Yinglima_ERP's `app.core.exceptions`: every business error raised
anywhere in this codebase is a subclass of `AppException`, translated to
the standard response envelope by the exception handler registered in
`app.main`. `UnauthorizedException`/`ForbiddenException` were added in
Phase 3 alongside ERP_Main's first authentication/authorization layer;
the rest of Yinglima's hierarchy not defined here (RateLimited, etc.) is
still unused by anything in this codebase.
"""

from __future__ import annotations

from typing import Any


class AppException(Exception):
    """Base class for all ERP_Main-raised exceptions."""

    status_code: int = 500
    error_code: str = "INTERNAL_SERVER_ERROR"

    def __init__(self, message: str = "An unexpected error occurred.", *, details: Any = None) -> None:
        """Initialize the exception with a message and optional structured details."""
        self.message = message
        self.details = details
        super().__init__(message)


class NotFoundException(AppException):
    """Raised when a requested resource does not exist."""

    status_code = 404
    error_code = "NOT_FOUND"

    def __init__(self, message: str = "The requested resource was not found.", **kwargs: Any) -> None:
        """Initialize with a default 'not found' message."""
        super().__init__(message, **kwargs)


class ValidationException(AppException):
    """Raised when input fails business-level validation rules."""

    status_code = 422
    error_code = "VALIDATION_ERROR"

    def __init__(self, message: str = "Validation failed.", **kwargs: Any) -> None:
        """Initialize with a default validation-error message."""
        super().__init__(message, **kwargs)


class ConflictException(AppException):
    """Raised when a request conflicts with the current state of a resource (e.g. duplicate key)."""

    status_code = 409
    error_code = "CONFLICT"

    def __init__(self, message: str = "The request conflicts with existing data.", **kwargs: Any) -> None:
        """Initialize with a default conflict message."""
        super().__init__(message, **kwargs)


class UnauthorizedException(AppException):
    """
    Raised when a request lacks valid control-plane authentication credentials.

    Added in Phase 3 (see `app.platform_auth` for human-admin auth and
    `app.service_identity` for ERP-service credential auth) -- Phase 2's
    registry API had no authentication at all, so this type didn't exist
    until there was something to raise it for.
    """

    status_code = 401
    error_code = "UNAUTHORIZED"

    def __init__(self, message: str = "Authentication is required.", **kwargs: Any) -> None:
        """Initialize with a default unauthorized message."""
        super().__init__(message, **kwargs)


class ForbiddenException(AppException):
    """Raised when an authenticated actor lacks permission for a control-plane action."""

    status_code = 403
    error_code = "FORBIDDEN"

    def __init__(self, message: str = "You do not have permission to perform this action.", **kwargs: Any) -> None:
        """Initialize with a default forbidden message."""
        super().__init__(message, **kwargs)
