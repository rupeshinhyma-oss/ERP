"""
HTTP ERP Provisioning Adapter (Prompt 2 Section 11 / Phase 5).

Communicates with any compliant ERP instance over HTTP via its internal
service endpoints (/api/v1/internal/users/check and /provision).
Handles transient errors, connection failures, timeouts, and status codes
with structured domain exceptions.
"""

from __future__ import annotations

import ipaddress
import logging
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.config import EnvironmentEnum, settings
from app.core.exceptions import BadRequestException
from app.erp_registry.models import ErpInstance
from app.identity_linking.adapters.base import BaseErpProvisioningAdapter
from app.identity_linking.exceptions import (
    ErpAuthError,
    ErpConnectionError,
    ErpConflictError,
    ErpMalformedResponseError,
    ErpNotFoundError,
    ErpProvisioningError,
    ErpRateLimitError,
    ErpServerError,
    ErpTimeoutError,
    ErpUnreachableError,
)

logger = logging.getLogger(__name__)


def _is_local_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").strip().lower()
    if not host:
        return False
    if host in {"localhost", "localhost.localdomain", "0.0.0.0"} or host.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(host)
        return bool(ip.is_loopback or ip.is_private or ip.is_unspecified)
    except ValueError:
        return False


class HttpErpProvisioningAdapter(BaseErpProvisioningAdapter):
    """Standard adapter communicating with ERPs via their internal REST endpoints."""

    def __init__(self, timeout: float = 10.0) -> None:
        self.timeout = timeout

    def _resolve_erp_api_url(self, erp: ErpInstance) -> str:
        """
        Resolve the target ERP's backend API origin strictly from `.env` / environment
        (`<KEY>_API_URL`), falling back to `erp.base_url` ONLY when environment-compatible.
        Never falls back to hard-coded localhost ports or cross-environment addresses.
        """
        configured = settings.get_erp_api_url(erp.key)
        env = getattr(settings, "ENVIRONMENT", None)

        if configured:
            if env == EnvironmentEnum.LOCAL and not _is_local_url(configured):
                return ""
            if env == EnvironmentEnum.PRODUCTION and _is_local_url(configured):
                return ""
            return configured

        base = (erp.base_url or "").strip().rstrip("/")
        if base.endswith("/dashboard"):
            base = base[: -len("/dashboard")].rstrip("/")
        if not base:
            return ""

        if env == EnvironmentEnum.LOCAL and not _is_local_url(base):
            return ""
        if env == EnvironmentEnum.PRODUCTION and _is_local_url(base):
            return ""

        if "-frontend." in base:
            return base.replace("-frontend.", "-backend.")
        if "-frontend" in base:
            return base.replace("-frontend", "-backend")

        return base

    def _get_headers(
        self,
        erp: ErpInstance,
        *,
        correlation_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, str]:
        """
        Construct machine-to-machine authentication headers.

        Uses explicit spoke credential via `settings.get_service_credential_for_erp(erp.key)`,
        falling back to `settings.FEDERATION_SERVICE_CREDENTIAL` for backward compatibility.
        """
        credential = settings.get_service_credential_for_erp(erp.key)
        if not credential or "CHANGE-ME" in credential:
            raise BadRequestException(
                f"Service credential for ERP '{erp.key}' is not configured (missing or still a placeholder value). "
                f"Set ERP_MAIN_TO_{erp.key.upper()}_SERVICE_CREDENTIAL (or FEDERATION_SERVICE_CREDENTIAL) "
                f"in ERP_Main's environment."
            )
        headers = {
            "Authorization": f"Bearer {credential}",
            "Content-Type": "application/json",
            "X-Caller-Source": "ERP_Main",
        }
        if correlation_id:
            headers["X-Correlation-ID"] = correlation_id
            headers["X-Request-ID"] = correlation_id
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    async def check_local_user(
        self, erp: ErpInstance, email_or_username: str, *, raise_errors: bool = True
    ) -> dict[str, Any] | None:
        """
        Check if an account exists in the target ERP.

        Returns data dictionary if user exists, None if user does not exist,
        or raises structured ErpProvisioningError on communication/remote errors.
        """
        api_base = self._resolve_erp_api_url(erp)
        if not api_base:
            clean_key = (erp.key or "ERP").upper().replace("-", "_")
            msg = f"No API URL configured for ERP instance '{erp.key}'. Set {clean_key}_API_URL in .env / environment."
            if raise_errors:
                raise ErpUnreachableError(erp.key, msg)
            logger.warning("%s Skipping live check.", msg)
            return None

        try:
            headers = self._get_headers(erp)
        except BadRequestException:
            # Missing or unconfigured credential; best-effort lookup returns None
            logger.warning("Missing or placeholder federation credential; skipping live check for ERP %s.", erp.key)
            return None

        url = f"{api_base}/api/v1/internal/users/check"
        payload = {"identifier": email_or_username}

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(url, json=payload, headers=headers)
                if response.status_code == 200:
                    try:
                        res_json = response.json()
                        data = res_json.get("data", {})
                    except Exception as e:
                        if raise_errors:
                            raise ErpMalformedResponseError(erp.key, f"Invalid JSON returned: {e}") from e
                        return None
                    if not isinstance(data, dict):
                        if raise_errors:
                            raise ErpMalformedResponseError(erp.key, "Response data is not a dictionary")
                        return None
                    if data.get("exists"):
                        if "local_user_id" not in data:
                            if raise_errors:
                                raise ErpMalformedResponseError(erp.key, "Response missing local_user_id")
                        return data
                    return None
                elif response.status_code == 404:
                    return None
                elif response.status_code in (401, 403):
                    if raise_errors:
                        raise ErpAuthError(erp.key, response.status_code, response.text[:200])
                    return None
                elif response.status_code == 409:
                    if raise_errors:
                        raise ErpConflictError(erp.key, response.text[:200])
                    return None
                elif response.status_code == 429:
                    if raise_errors:
                        raise ErpRateLimitError(erp.key, response.text[:200])
                    return None
                elif 500 <= response.status_code < 600:
                    if raise_errors:
                        raise ErpServerError(erp.key, response.status_code, response.text[:200])
                    return None
                else:
                    if raise_errors:
                        raise ErpProvisioningError(
                            f"Unexpected HTTP {response.status_code} from ERP {erp.key!r}: {response.text[:200]}",
                            erp_key=erp.key,
                            status_code=response.status_code,
                            is_transient=False,
                        )
                    return None
        except (ErpProvisioningError, BadRequestException):
            raise
        except httpx.TimeoutException as exc:
            if raise_errors:
                raise ErpTimeoutError(erp.key, str(exc)) from exc
            logger.warning("Timeout checking local user in ERP %s at %s: %s", erp.key, url, exc)
            return None
        except httpx.ConnectError as exc:
            if raise_errors:
                raise ErpConnectionError(erp.key, str(exc)) from exc
            logger.warning("Connection failure checking local user in ERP %s at %s: %s", erp.key, url, exc)
            return None
        except httpx.HTTPError as exc:
            if raise_errors:
                raise ErpUnreachableError(erp.key, str(exc)) from exc
            logger.warning("HTTP error checking local user in ERP %s at %s: %s", erp.key, url, exc)
            return None

    async def provision_local_user(
        self,
        erp: ErpInstance,
        *,
        email: str,
        display_name: str,
        username: str | None = None,
        first_name: str | None = None,
        last_name: str | None = None,
        target_organization_id: str | None = None,
        password: str | None = None,
        correlation_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Provision a minimal user account in the target ERP."""
        api_base = self._resolve_erp_api_url(erp)
        if not api_base:
            clean_key = (erp.key or "ERP").upper().replace("-", "_")
            raise ErpUnreachableError(
                erp.key,
                f"ERP instance '{erp.key}' has no API URL configured for this environment. Set {clean_key}_API_URL in .env / environment.",
            )

        url = f"{api_base}/api/v1/internal/users/provision"
        payload = {
            "email": email,
            "display_name": display_name,
            "username": username,
            "first_name": first_name or display_name.split()[0],
            "last_name": last_name or (display_name.split()[-1] if len(display_name.split()) > 1 else None),
            "target_organization_id": target_organization_id,
        }
        if password:
            payload["password"] = password

        try:
            headers = self._get_headers(erp, correlation_id=correlation_id, idempotency_key=idempotency_key)
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(url, json=payload, headers=headers)
                if response.status_code in (200, 201):
                    try:
                        res_json = response.json()
                        data = res_json.get("data", {})
                    except Exception as e:
                        raise ErpMalformedResponseError(erp.key, f"Invalid JSON returned: {e}") from e
                    if not isinstance(data, dict) or "local_user_id" not in data:
                        raise ErpMalformedResponseError(erp.key, "Provision response missing local_user_id")
                    return data
                elif response.status_code in (401, 403):
                    raise ErpAuthError(erp.key, response.status_code, response.text[:200])
                elif response.status_code == 404:
                    raise ErpNotFoundError(erp.key, response.text[:200])
                elif response.status_code == 409:
                    raise ErpConflictError(erp.key, response.text[:200])
                elif response.status_code == 429:
                    raise ErpRateLimitError(erp.key, response.text[:200])
                elif 500 <= response.status_code < 600:
                    raise ErpServerError(erp.key, response.status_code, response.text[:200])
                else:
                    raise ErpProvisioningError(
                        f"ERP {erp.key!r} provisioning failed with HTTP {response.status_code}: {response.text[:200]}",
                        erp_key=erp.key,
                        status_code=response.status_code,
                        is_transient=False,
                    )
        except (ErpProvisioningError, BadRequestException):
            raise
        except httpx.TimeoutException as exc:
            raise ErpTimeoutError(erp.key, str(exc)) from exc
        except httpx.ConnectError as exc:
            raise ErpConnectionError(erp.key, str(exc)) from exc
        except httpx.HTTPError as exc:
            raise ErpUnreachableError(erp.key, f"Could not connect to ERP {erp.key!r} at {url}: {exc}") from exc

    async def set_local_user_access(
        self, erp: ErpInstance, local_user_id: str, *, allow_login: bool, reason: str | None = None
    ) -> dict[str, Any] | None:
        """
        Block or restore a local account's ability to authenticate.

        Deliberately soft-fails (logs a warning, returns None) rather than
        raising when the target ERP can't be reached or configured.
        """
        api_base = self._resolve_erp_api_url(erp)
        if not api_base:
            logger.warning(
                "ERP instance %s has no API URL configured for this environment; cannot sync local access for %s.",
                erp.key,
                local_user_id,
            )
            return None

        url = f"{api_base}/api/v1/internal/users/{local_user_id}/access"
        payload = {"allow_login": allow_login, "reason": reason}

        try:
            headers = self._get_headers(erp)
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(url, json=payload, headers=headers)
                if response.status_code == 200:
                    return response.json().get("data", {})
                logger.warning(
                    "ERP %s rejected local access sync for %s: HTTP %s: %s",
                    erp.key,
                    local_user_id,
                    response.status_code,
                    response.text[:200],
                )
                return None
        except Exception as exc:
            logger.warning(
                "Failed to reach ERP %s at %s to sync local access for %s: %s", erp.key, url, local_user_id, exc
            )
            return None

    async def deprovision_local_user(
        self, erp: ErpInstance, local_user_id: str, *, reason: str | None = None
    ) -> dict[str, Any] | None:
        """
        Remove/deprovision a local user account in the target spoke ERP.
        Deliberately soft-fails (logs a warning, returns None) rather than raising if unreachable.
        """
        api_base = self._resolve_erp_api_url(erp)
        if not api_base:
            logger.warning(
                "ERP instance %s has no API URL configured for this environment; cannot deprovision local user %s.",
                erp.key,
                local_user_id,
            )
            return None

        url = f"{api_base}/api/v1/internal/users/{local_user_id}/deprovision"
        try:
            headers = self._get_headers(erp)
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(url, json={"reason": reason}, headers=headers)
                if response.status_code == 200:
                    return response.json().get("data", {})
                logger.warning(
                    "ERP %s rejected deprovisioning for %s: HTTP %s: %s",
                    erp.key,
                    local_user_id,
                    response.status_code,
                    response.text[:200],
                )
                return None
        except Exception as exc:
            logger.warning(
                "Failed to reach ERP %s at %s to deprovision local user %s: %s", erp.key, url, local_user_id, exc
            )
            return None

    async def revoke_session(self, erp: ErpInstance, session_id: str, *, reason: str | None = "central_logout") -> bool:
        """
        Tell an ERP that ONE central session ended: every token issued under that session id stops working there.
        Other sessions of the same person (other browsers/devices) are not touched.
        Soft-fails (returns False) if the ERP is unreachable -- the ERP also re-checks central sessions itself, so a
        missed message cannot leave the session alive for long.
        """
        api_base = self._resolve_erp_api_url(erp)
        if not api_base:
            logger.warning("ERP instance %s has no API URL configured; cannot revoke session %s.", erp.key, session_id)
            return False
        url = f"{api_base}/api/v1/internal/sessions/{session_id}/revoke"
        try:
            headers = self._get_headers(erp)
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(url, json={"reason": reason}, headers=headers)
            if response.status_code == 200:
                return True
            logger.warning("ERP %s rejected revoke of session %s: HTTP %s", erp.key, session_id, response.status_code)
            return False
        except Exception as exc:
            logger.warning("Could not reach ERP %s to revoke session %s: %s", erp.key, session_id, exc)
            return False

    async def logout_local_user(
        self, erp: ErpInstance, local_user_id_or_email: str, *, reason: str | None = "global_logout"
    ) -> dict[str, Any] | None:
        """
        Trigger immediate force logout of the user across all devices in the target spoke ERP.
        Terminates live WebSocket connections, revokes local sessions, and invalidates in-flight tokens.
        Deliberately soft-fails (logs a warning, returns None) rather than raising if unreachable.
        """
        api_base = self._resolve_erp_api_url(erp)
        if not api_base:
            logger.warning(
                "ERP instance %s has no API URL configured; cannot logout local user %s.",
                erp.key,
                local_user_id_or_email,
            )
            return None

        url = f"{api_base}/api/v1/internal/users/{local_user_id_or_email}/logout"
        try:
            headers = self._get_headers(erp)
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(url, json={"reason": reason}, headers=headers)
                if response.status_code == 200:
                    return response.json().get("data", {})
                logger.warning(
                    "ERP %s rejected force-logout for %s: HTTP %s: %s",
                    erp.key,
                    local_user_id_or_email,
                    response.status_code,
                    response.text[:200],
                )
                return None
        except Exception as exc:
            logger.warning(
                "Failed to reach ERP %s at %s to logout user %s: %s", erp.key, url, local_user_id_or_email, exc
            )
            return None
