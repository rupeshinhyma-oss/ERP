"""
Identity Linking & ERP Provisioning Exceptions (Phase 5).

Structured domain exceptions representing specific failure modes during
ERP_Main -> Spoke ERP user provisioning and identity synchronization.
"""

from __future__ import annotations

from app.core.exceptions import BadRequestException


class ErpProvisioningError(BadRequestException):
    """Base exception for all ERP provisioning failures."""

    def __init__(
        self,
        message: str,
        *,
        erp_key: str,
        status_code: int = 400,
        is_transient: bool = False,
        error_type: str = "UNKNOWN",
    ) -> None:
        super().__init__(message)
        self.message = message
        self.erp_key = erp_key
        self.status_code = status_code
        self.is_transient = is_transient
        self.error_type = error_type

    def __repr__(self) -> str:
        return (
            f"<{self.__class__.__name__} erp_key={self.erp_key!r} status_code={self.status_code} "
            f"is_transient={self.is_transient} error_type={self.error_type!r}>"
        )


class ErpUnreachableError(ErpProvisioningError):
    """Target ERP instance is unreachable due to network error."""

    def __init__(self, erp_key: str, details: str = "") -> None:
        msg = f"ERP instance '{erp_key}' is unreachable."
        if details:
            msg += f" Details: {details}"
        super().__init__(msg, erp_key=erp_key, status_code=503, is_transient=True, error_type="ERP_UNREACHABLE")


class ErpTimeoutError(ErpProvisioningError):
    """Call to target ERP instance timed out."""

    def __init__(self, erp_key: str, details: str = "") -> None:
        msg = f"Request to ERP instance '{erp_key}' timed out."
        if details:
            msg += f" Details: {details}"
        super().__init__(msg, erp_key=erp_key, status_code=504, is_transient=True, error_type="TIMEOUT")


class ErpConnectionError(ErpProvisioningError):
    """Connection attempt to target ERP instance failed."""

    def __init__(self, erp_key: str, details: str = "") -> None:
        msg = f"Failed to connect to ERP instance '{erp_key}'."
        if details:
            msg += f" Details: {details}"
        super().__init__(msg, erp_key=erp_key, status_code=502, is_transient=True, error_type="CONNECTION_FAILURE")


class ErpAuthError(ErpProvisioningError):
    """Machine-to-machine authentication or authorization failure with target ERP."""

    def __init__(self, erp_key: str, status_code: int = 401, details: str = "") -> None:
        msg = f"Authentication/authorization failed for ERP '{erp_key}' (HTTP {status_code})."
        if details:
            msg += f" Details: {details}"
        super().__init__(msg, erp_key=erp_key, status_code=status_code, is_transient=False, error_type="AUTH_FAILURE")


class ErpNotFoundError(ErpProvisioningError):
    """Provisioning endpoint or resource was not found on target ERP."""

    def __init__(self, erp_key: str, details: str = "") -> None:
        msg = f"Provisioning endpoint not found on ERP '{erp_key}' (HTTP 404)."
        if details:
            msg += f" Details: {details}"
        super().__init__(msg, erp_key=erp_key, status_code=404, is_transient=False, error_type="NOT_FOUND")


class ErpConflictError(ErpProvisioningError):
    """Remote ERP rejected provisioning due to conflicting state (HTTP 409)."""

    def __init__(self, erp_key: str, details: str = "") -> None:
        msg = f"Remote ERP '{erp_key}' rejected operation due to conflict (HTTP 409)."
        if details:
            msg += f" Details: {details}"
        super().__init__(msg, erp_key=erp_key, status_code=409, is_transient=False, error_type="REMOTE_CONFLICT")


class ErpRateLimitError(ErpProvisioningError):
    """Remote ERP rate limited the provisioning call (HTTP 429)."""

    def __init__(self, erp_key: str, details: str = "") -> None:
        msg = f"Rate limited by ERP '{erp_key}' (HTTP 429)."
        if details:
            msg += f" Details: {details}"
        super().__init__(msg, erp_key=erp_key, status_code=429, is_transient=True, error_type="RATE_LIMITED")


class ErpServerError(ErpProvisioningError):
    """Target ERP instance encountered an internal server error (HTTP 5xx)."""

    def __init__(self, erp_key: str, status_code: int = 500, details: str = "") -> None:
        msg = f"ERP '{erp_key}' returned internal server error (HTTP {status_code})."
        if details:
            msg += f" Details: {details}"
        super().__init__(msg, erp_key=erp_key, status_code=status_code, is_transient=True, error_type="SERVER_ERROR")


class ErpMalformedResponseError(ErpProvisioningError):
    """Remote ERP returned a response that could not be parsed or was missing required fields."""

    def __init__(self, erp_key: str, details: str = "") -> None:
        msg = f"Received malformed response from ERP '{erp_key}'."
        if details:
            msg += f" Details: {details}"
        super().__init__(msg, erp_key=erp_key, status_code=502, is_transient=False, error_type="MALFORMED_RESPONSE")


class IdentityConflictDetectedError(ErpProvisioningError):
    """An identity conflict was detected (e.g. local user belongs to a different GlobalUser)."""

    def __init__(self, erp_key: str, local_user_id: str, conflicting_global_user_id: str) -> None:
        msg = (
            f"Local user '{local_user_id}' in ERP '{erp_key}' is already linked to "
            f"another GlobalUser '{conflicting_global_user_id}'."
        )
        super().__init__(msg, erp_key=erp_key, status_code=409, is_transient=False, error_type="IDENTITY_CONFLICT")
        self.local_user_id = local_user_id
        self.conflicting_global_user_id = conflicting_global_user_id
