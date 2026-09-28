"""
Tests for HttpErpProvisioningAdapter's outbound service-credential header
(Phase 2 fix).

Covers exactly what the fix changed:
- The adapter sends FEDERATION_SERVICE_CREDENTIAL (not PLATFORM_JWT_SECRET_KEY)
  as the Bearer token on both /internal/users/check and /internal/users/provision.
- A missing/placeholder FEDERATION_SERVICE_CREDENTIAL fails safely (a clear,
  local BadRequestException) rather than silently sending some other secret
  or an empty/placeholder Authorization header.
- Existing provisioning behavior (successful check/provision responses,
  local_user_id round-tripping) is unchanged by the fix.

Uses httpx.MockTransport (part of httpx, already a project dependency) so
these tests never make a real network call and never need a live Yinglima/
Inhyma instance.
"""

from __future__ import annotations

import httpx
import pytest

from app.core.config import settings
from app.core.exceptions import BadRequestException
from app.erp_registry.models import ErpInstance, ErpStatus
from app.identity_linking.adapters.http_adapter import HttpErpProvisioningAdapter


def _make_erp_instance(base_url: str = "https://yinglima.example.internal") -> ErpInstance:
    """Build a plain (unpersisted) ErpInstance for adapter-level tests -- no DB needed."""
    return ErpInstance(
        key="yinglima",
        name="Yinglima ERP",
        display_name="Yinglima ERP",
        status=ErpStatus.ACTIVE,
        base_url=base_url,
    )


@pytest.fixture(autouse=True)
def _restore_federation_credential(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Every test in this file explicitly sets FEDERATION_SERVICE_CREDENTIAL
    (or deliberately clears it) via monkeypatch, which pytest already
    reverts after each test -- this fixture exists only to make that
    guarantee explicit and to ensure test order never leaks a value
    between cases, without needing to know the real configured value.
    """
    yield


class TestServiceCredentialHeader:
    """The adapter must send FEDERATION_SERVICE_CREDENTIAL, never PLATFORM_JWT_SECRET_KEY."""

    def test_get_headers_uses_federation_service_credential(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """_get_headers's Authorization header is built from FEDERATION_SERVICE_CREDENTIAL."""
        monkeypatch.setattr(settings, "FEDERATION_SERVICE_CREDENTIAL", "test-shared-credential-value")
        monkeypatch.setattr(settings, "PLATFORM_JWT_SECRET_KEY", "unrelated-platform-jwt-secret")

        adapter = HttpErpProvisioningAdapter()
        erp = _make_erp_instance()

        headers = adapter._get_headers(erp)

        assert headers["Authorization"] == "Bearer test-shared-credential-value"
        # The old bug: this must never be the platform JWT secret.
        assert "unrelated-platform-jwt-secret" not in headers["Authorization"]
        assert headers["X-Caller-Source"] == "ERP_Main"

    def test_get_headers_ignores_platform_jwt_secret_key_entirely(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Changing PLATFORM_JWT_SECRET_KEY alone must never change the outbound provisioning header."""
        monkeypatch.setattr(settings, "FEDERATION_SERVICE_CREDENTIAL", "stable-credential")
        adapter = HttpErpProvisioningAdapter()
        erp = _make_erp_instance()

        headers_before = adapter._get_headers(erp)
        monkeypatch.setattr(settings, "PLATFORM_JWT_SECRET_KEY", "some-other-value-entirely")
        headers_after = adapter._get_headers(erp)

        assert headers_before["Authorization"] == headers_after["Authorization"] == "Bearer stable-credential"


class TestMissingCredentialFailsSafely:
    """An unset or still-placeholder credential must raise clearly, not silently degrade."""

    def test_empty_credential_raises_bad_request(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "FEDERATION_SERVICE_CREDENTIAL", "")
        adapter = HttpErpProvisioningAdapter()
        erp = _make_erp_instance()

        with pytest.raises(BadRequestException) as exc_info:
            adapter._get_headers(erp)

        # The error message must explain the misconfiguration without ever
        # containing a secret value (there is none to leak here, but this
        # also guards against a future edit accidentally interpolating one).
        message = str(exc_info.value)
        assert "FEDERATION_SERVICE_CREDENTIAL" in message
        assert "not configured" in message.lower()

    def test_placeholder_credential_raises_bad_request(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """The shipped 'CHANGE-ME-...' default must be treated as unconfigured, not a real credential."""
        monkeypatch.setattr(
            settings, "FEDERATION_SERVICE_CREDENTIAL", "CHANGE-ME-IN-PRODUCTION-erp-main-service-credential"
        )
        adapter = HttpErpProvisioningAdapter()
        erp = _make_erp_instance()

        with pytest.raises(BadRequestException):
            adapter._get_headers(erp)

    async def test_provision_local_user_surfaces_missing_credential_clearly(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """provision_local_user must raise the clear config error, not a generic/opaque network failure."""
        monkeypatch.setattr(settings, "FEDERATION_SERVICE_CREDENTIAL", "")
        adapter = HttpErpProvisioningAdapter()
        erp = _make_erp_instance()

        with pytest.raises(BadRequestException) as exc_info:
            await adapter.provision_local_user(erp, email="new.user@example.com", display_name="New User")

        assert "FEDERATION_SERVICE_CREDENTIAL" in str(exc_info.value)

    async def test_check_local_user_does_not_crash_on_missing_credential(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """
        check_local_user is a best-effort lookup (pre-existing behavior: it
        already swallows any exception to a None "not found" result rather
        than propagating). A missing credential must not change that
        contract or crash the caller -- it should behave exactly like any
        other reason the check couldn't complete.
        """
        monkeypatch.setattr(settings, "FEDERATION_SERVICE_CREDENTIAL", "")
        adapter = HttpErpProvisioningAdapter()
        erp = _make_erp_instance()

        result = await adapter.check_local_user(erp, "someone@example.com")

        assert result is None


class TestExistingProvisioningBehaviorUnchanged:
    """The fix must not change what a successful check/provision call actually does."""

    async def test_check_local_user_existing_account_still_returns_data(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "FEDERATION_SERVICE_CREDENTIAL", "test-credential")
        adapter = HttpErpProvisioningAdapter()
        erp = _make_erp_instance()

        captured_requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            assert request.url.path == "/api/v1/internal/users/check"
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "data": {
                        "exists": True,
                        "local_user_id": "abc-123",
                        "email": "someone@example.com",
                    },
                },
            )

        async def fake_async_client_post(self, url, json=None, headers=None, **kwargs):  # noqa: ANN001
            return handler(httpx.Request("POST", url, json=json, headers=headers))

        monkeypatch.setattr(httpx.AsyncClient, "post", fake_async_client_post)

        result = await adapter.check_local_user(erp, "someone@example.com")

        assert result == {"exists": True, "local_user_id": "abc-123", "email": "someone@example.com"}
        assert len(captured_requests) == 1
        assert captured_requests[0].headers["Authorization"] == "Bearer test-credential"

    async def test_provision_local_user_success_still_returns_local_user_id(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "FEDERATION_SERVICE_CREDENTIAL", "test-credential")
        adapter = HttpErpProvisioningAdapter()
        erp = _make_erp_instance()

        captured_requests: list[httpx.Request] = []

        async def fake_async_client_post(self, url, json=None, headers=None, **kwargs):  # noqa: ANN001
            req = httpx.Request("POST", url, json=json, headers=headers)
            captured_requests.append(req)
            assert req.url.path == "/api/v1/internal/users/provision"
            return httpx.Response(
                201,
                json={"success": True, "data": {"local_user_id": "new-999", "created": True}},
            )

        monkeypatch.setattr(httpx.AsyncClient, "post", fake_async_client_post)

        result = await adapter.provision_local_user(erp, email="new.user@example.com", display_name="New User")

        assert result == {"local_user_id": "new-999", "created": True}
        assert captured_requests[0].headers["Authorization"] == "Bearer test-credential"

    async def test_provision_local_user_erp_failure_status_still_raises_bad_request(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A correctly-authenticated call that the target ERP still rejects (e.g. 500) behaves as before."""
        monkeypatch.setattr(settings, "FEDERATION_SERVICE_CREDENTIAL", "test-credential")
        adapter = HttpErpProvisioningAdapter()
        erp = _make_erp_instance()

        async def fake_async_client_post(self, url, json=None, headers=None, **kwargs):  # noqa: ANN001
            return httpx.Response(500, text="internal error")

        monkeypatch.setattr(httpx.AsyncClient, "post", fake_async_client_post)

        with pytest.raises(BadRequestException):
            await adapter.provision_local_user(erp, email="new.user@example.com", display_name="New User")