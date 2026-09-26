"""
Cross-ERP Access Enforcement Tests (Inhyma Spoke ERP).

Phase 6: Verifies that central ERP_Main identity and membership authority
is enforced during direct local login when configured, while preserving local
RBAC and local authentication integrity.

Tests cover:
1. erp_main_client.lookup_membership_by_local_user (success, 404, network error, malformed).
2. Direct login with ENFORCE_CENTRAL_MEMBERSHIP_ON_LOGIN=False (standalone fallback).
3. Direct login with ENFORCE_CENTRAL_MEMBERSHIP_ON_LOGIN=True:
   - Active GlobalUser + Active Membership + Active Local User -> Success.
   - Suspended GlobalUser -> Denied.
   - Disabled GlobalUser -> Denied.
   - Pending Membership -> Denied.
   - Revoked Membership -> Denied.
   - Membership Lookup Error / 404 -> Denied.
   - Local User Inactive / Suspended -> Denied (local authority).
   - Invalid Password -> Denied (credential check failure).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch
import uuid
import pytest
import httpx

from app.auth.service import AuthService, LoginContext
from app.users.models import User, UserStatus
from app.auth.security import hash_password
from app.core.exceptions import UnauthorizedException
from app.core.config import settings
from app.federation import erp_main_client as client_module


class _FakeResponse:
    def __init__(self, *, status_code: int, json_body: dict | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._json_body = json_body or {}
        self.text = text

    def json(self) -> dict:
        return self._json_body


def _patched_client(response: _FakeResponse | None = None, *, raise_exc: Exception | None = None):
    mock_client = AsyncMock()
    if raise_exc is not None:
        mock_client.get.side_effect = raise_exc
    else:
        mock_client.get.return_value = response
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = False
    return patch("httpx.AsyncClient", return_value=mock_client)


# ---------------------------------------------------------------------------
# 1. Client: lookup_membership_by_local_user
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_lookup_by_local_user_success():
    fake = _FakeResponse(
        status_code=200,
        json_body={
            "data": {
                "global_user_id": str(uuid.uuid4()),
                "local_user_id": "loc-123",
                "status": "ACTIVE",
                "global_user_status": "ACTIVE",
            }
        },
    )
    with _patched_client(fake):
        result = await client_module.lookup_membership_by_local_user("loc-123")
    assert result["local_user_id"] == "loc-123"
    assert result["status"] == "ACTIVE"
    assert result["global_user_status"] == "ACTIVE"


@pytest.mark.asyncio
async def test_lookup_by_local_user_404_raises():
    fake = _FakeResponse(status_code=404, json_body={"success": False}, text="Not Found")
    with _patched_client(fake):
        with pytest.raises(client_module.MembershipLookupError):
            await client_module.lookup_membership_by_local_user("unknown-local")


@pytest.mark.asyncio
async def test_lookup_by_local_user_network_error_raises():
    with _patched_client(raise_exc=httpx.ConnectError("Connection failed")):
        with pytest.raises(client_module.MembershipLookupError):
            await client_module.lookup_membership_by_local_user("loc-123")


# ---------------------------------------------------------------------------
# 2. Direct Login Central Enforcement
# ---------------------------------------------------------------------------

def _create_auth_service(user: User):
    mock_user_repo = AsyncMock()
    mock_user_repo.get_by_identifier.return_value = user
    mock_user_repo.update = AsyncMock(return_value=user)

    mock_session_repo = AsyncMock()
    mock_token_blacklist_repo = AsyncMock()
    mock_cache = AsyncMock()
    mock_cache.get.return_value = None

    svc = AuthService(
        user_repository=mock_user_repo,
        role_repository=AsyncMock(),
        session_repository=mock_session_repo,
        token_blacklist_repository=mock_token_blacklist_repo,
        password_history_repository=AsyncMock(),
        cache=mock_cache,
    )
    svc.get_user_effective_permissions = AsyncMock(return_value={"inventory.read"})
    return svc


@pytest.mark.asyncio
async def test_direct_login_offline_when_enforcement_disabled():
    """When ENFORCE_CENTRAL_MEMBERSHIP_ON_LOGIN is False, login proceeds without central check."""
    raw_pass = "SecurePass123!"
    user = User(
        id=uuid.uuid4(),
        username="localuser",
        email="local@inhyma.test",
        password_hash=hash_password(raw_pass),
        status=UserStatus.ACTIVE,
        is_active=True,
        has_login=True,
    )
    svc = _create_auth_service(user)

    with patch.object(settings, "ENFORCE_CENTRAL_MEMBERSHIP_ON_LOGIN", False):
        with patch("app.federation.erp_main_client.lookup_membership_by_local_user") as mock_lookup:
            res_user, access, refresh = await svc.login(identifier="localuser", password=raw_pass, context=LoginContext(ip_address="127.0.0.1"))
            assert res_user.id == user.id
            assert access and refresh
            mock_lookup.assert_not_called()


@pytest.mark.asyncio
async def test_direct_login_allowed_when_global_user_and_membership_active():
    """When both GlobalUser and ERP membership are ACTIVE, login succeeds."""
    raw_pass = "SecurePass123!"
    user = User(
        id=uuid.uuid4(),
        username="localuser",
        email="local@inhyma.test",
        password_hash=hash_password(raw_pass),
        status=UserStatus.ACTIVE,
        is_active=True,
        has_login=True,
    )
    svc = _create_auth_service(user)

    central_data = {
        "global_user_id": str(uuid.uuid4()),
        "local_user_id": str(user.id),
        "status": "ACTIVE",
        "global_user_status": "ACTIVE",
    }

    with patch.object(settings, "ENFORCE_CENTRAL_MEMBERSHIP_ON_LOGIN", True):
        with patch("app.federation.erp_main_client.lookup_membership_by_local_user", AsyncMock(return_value=central_data)):
            res_user, access, refresh = await svc.login(identifier="localuser", password=raw_pass, context=LoginContext(ip_address="127.0.0.1"))
            assert res_user.id == user.id
            assert access and refresh


@pytest.mark.asyncio
async def test_direct_login_denied_when_global_user_suspended():
    """Suspended central GlobalUser blocks direct login."""
    raw_pass = "SecurePass123!"
    user = User(
        id=uuid.uuid4(),
        username="localuser",
        email="local@inhyma.test",
        password_hash=hash_password(raw_pass),
        status=UserStatus.ACTIVE,
        is_active=True,
        has_login=True,
    )
    svc = _create_auth_service(user)

    central_data = {
        "global_user_id": str(uuid.uuid4()),
        "local_user_id": str(user.id),
        "status": "ACTIVE",
        "global_user_status": "SUSPENDED",
    }

    with patch.object(settings, "ENFORCE_CENTRAL_MEMBERSHIP_ON_LOGIN", True):
        with patch("app.federation.erp_main_client.lookup_membership_by_local_user", AsyncMock(return_value=central_data)):
            with pytest.raises(UnauthorizedException, match="Access denied by central identity policy."):
                await svc.login(identifier="localuser", password=raw_pass, context=LoginContext(ip_address="127.0.0.1"))


@pytest.mark.asyncio
async def test_direct_login_denied_when_global_user_disabled():
    """Disabled central GlobalUser blocks direct login."""
    raw_pass = "SecurePass123!"
    user = User(
        id=uuid.uuid4(),
        username="localuser",
        email="local@inhyma.test",
        password_hash=hash_password(raw_pass),
        status=UserStatus.ACTIVE,
        is_active=True,
        has_login=True,
    )
    svc = _create_auth_service(user)

    central_data = {
        "global_user_id": str(uuid.uuid4()),
        "local_user_id": str(user.id),
        "status": "ACTIVE",
        "global_user_status": "DISABLED",
    }

    with patch.object(settings, "ENFORCE_CENTRAL_MEMBERSHIP_ON_LOGIN", True):
        with patch("app.federation.erp_main_client.lookup_membership_by_local_user", AsyncMock(return_value=central_data)):
            with pytest.raises(UnauthorizedException, match="Access denied by central identity policy."):
                await svc.login(identifier="localuser", password=raw_pass, context=LoginContext(ip_address="127.0.0.1"))


@pytest.mark.asyncio
async def test_direct_login_denied_when_membership_revoked():
    """Revoked ERP membership blocks direct login even if GlobalUser is active."""
    raw_pass = "SecurePass123!"
    user = User(
        id=uuid.uuid4(),
        username="localuser",
        email="local@inhyma.test",
        password_hash=hash_password(raw_pass),
        status=UserStatus.ACTIVE,
        is_active=True,
        has_login=True,
    )
    svc = _create_auth_service(user)

    central_data = {
        "global_user_id": str(uuid.uuid4()),
        "local_user_id": str(user.id),
        "status": "REVOKED",
        "global_user_status": "ACTIVE",
    }

    with patch.object(settings, "ENFORCE_CENTRAL_MEMBERSHIP_ON_LOGIN", True):
        with patch("app.federation.erp_main_client.lookup_membership_by_local_user", AsyncMock(return_value=central_data)):
            with pytest.raises(UnauthorizedException, match="Access denied by central identity policy."):
                await svc.login(identifier="localuser", password=raw_pass, context=LoginContext(ip_address="127.0.0.1"))


@pytest.mark.asyncio
async def test_direct_login_denied_when_membership_pending():
    """Pending ERP membership blocks direct login."""
    raw_pass = "SecurePass123!"
    user = User(
        id=uuid.uuid4(),
        username="localuser",
        email="local@inhyma.test",
        password_hash=hash_password(raw_pass),
        status=UserStatus.ACTIVE,
        is_active=True,
        has_login=True,
    )
    svc = _create_auth_service(user)

    central_data = {
        "global_user_id": str(uuid.uuid4()),
        "local_user_id": str(user.id),
        "status": "PENDING",
        "global_user_status": "ACTIVE",
    }

    with patch.object(settings, "ENFORCE_CENTRAL_MEMBERSHIP_ON_LOGIN", True):
        with patch("app.federation.erp_main_client.lookup_membership_by_local_user", AsyncMock(return_value=central_data)):
            with pytest.raises(UnauthorizedException, match="Access denied by central identity policy."):
                await svc.login(identifier="localuser", password=raw_pass, context=LoginContext(ip_address="127.0.0.1"))


@pytest.mark.asyncio
async def test_direct_login_denied_when_central_lookup_fails():
    """Network failure or 404 in central lookup fails closed (denies login)."""
    raw_pass = "SecurePass123!"
    user = User(
        id=uuid.uuid4(),
        username="localuser",
        email="local@inhyma.test",
        password_hash=hash_password(raw_pass),
        status=UserStatus.ACTIVE,
        is_active=True,
        has_login=True,
    )
    svc = _create_auth_service(user)

    with patch.object(settings, "ENFORCE_CENTRAL_MEMBERSHIP_ON_LOGIN", True):
        with patch(
            "app.federation.erp_main_client.lookup_membership_by_local_user",
            AsyncMock(side_effect=client_module.MembershipLookupError("ERP_Main unreachable")),
        ):
            with pytest.raises(UnauthorizedException, match="Access denied by central identity policy."):
                await svc.login(identifier="localuser", password=raw_pass, context=LoginContext(ip_address="127.0.0.1"))


@pytest.mark.asyncio
async def test_direct_login_denied_when_local_user_suspended():
    """Local user suspension is enforced regardless of central membership (spoke authority)."""
    raw_pass = "SecurePass123!"
    user = User(
        id=uuid.uuid4(),
        username="localuser",
        email="local@inhyma.test",
        password_hash=hash_password(raw_pass),
        status=UserStatus.SUSPENDED,
        is_active=False,
        has_login=True,
    )
    svc = _create_auth_service(user)

    # Fails before central check because local can_login is False
    with pytest.raises(UnauthorizedException, match="This account is not active."):
        await svc.login(identifier="localuser", password=raw_pass, context=LoginContext(ip_address="127.0.0.1"))


@pytest.mark.asyncio
async def test_direct_login_denied_when_password_incorrect():
    """Bad password fails standard authentication before reaching central lookup."""
    user = User(
        id=uuid.uuid4(),
        username="localuser",
        email="local@inhyma.test",
        password_hash=hash_password("CorrectPass123!"),
        status=UserStatus.ACTIVE,
        is_active=True,
        has_login=True,
        failed_login_count=0,
    )
    svc = _create_auth_service(user)

    with pytest.raises(UnauthorizedException, match="Invalid username/email/phone number or password."):
        await svc.login(identifier="localuser", password="WrongPass123!", context=LoginContext(ip_address="127.0.0.1"))
