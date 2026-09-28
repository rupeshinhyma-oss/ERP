"""
Phase 4: Comprehensive Federation SSO Handoff & Callback Tests for Inhyma ERP.

Tests cover:
- Valid ERP_Main -> Inhyma handoff (via /federation/exchange and /federation/sso-login)
- Invalid signature / corrupted token
- Expired handoff (expired ID token and expired/rejected auth code)
- Wrong target ERP (audience isolation: Yinglima token presented to Inhyma)
- Unauthorized user (SUSPENDED or REVOKED membership)
- Valid user with no Inhyma membership (404 from ERP_Main or missing local user)
- Successful local session creation with effective roles & permissions
- Direct Inhyma password login still works
- Direct logout still works
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Request

from app.auth.security import hash_password
from app.auth.service import AuthService, LoginContext
from app.core.config import settings
from app.core.exceptions import ForbiddenException, UnauthorizedException
from app.federation import routes as fed_routes
from app.federation import token_verification as tv
from app.federation.erp_main_client import MembershipLookupError
from app.federation.schemas import FederationExchangeRequest, FederationSsoLoginRequest
from app.federation.token_exchange_client import TokenExchangeError
from app.users.models import User, UserStatus


@pytest.fixture
def rsa_keypair():
    """Generate a real RSA keypair for signing test tokens."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return private_key, private_pem


@pytest.fixture(autouse=True)
def _setup_federation_env(monkeypatch):
    """Set standard federation client settings for Inhyma in tests."""
    monkeypatch.setattr(settings, "INHYMA_SSO_ENABLED", True)
    monkeypatch.setattr(settings, "FEDERATION_CLIENT_ID", "inhyma-client-test")
    monkeypatch.setattr(settings, "FEDERATION_CLIENT_SECRET", "test-secret-12345")
    monkeypatch.setattr(settings, "ERP_MAIN_ISSUER", "http://127.0.0.1:8000")

    # Reset JWKS cache
    tv._jwks_cache._keys_by_kid = {}
    tv._jwks_cache._fetched_at = 0.0
    yield
    tv._jwks_cache._keys_by_kid = {}
    tv._jwks_cache._fetched_at = 0.0


def _populate_jwks_cache(kid: str, private_key) -> None:
    """Pre-populate the Relying Party JWKS cache with test public key."""
    tv._jwks_cache._keys_by_kid[kid] = private_key.public_key()
    tv._jwks_cache._fetched_at = time.monotonic()


def _mint_id_token(private_key, *, kid: str = "test-kid", **claims_override) -> str:
    """Mint a signed RS256 federation ID token from ERP_Main."""
    now = datetime.now(timezone.utc)
    claims = {
        "iss": settings.ERP_MAIN_ISSUER,
        "sub": str(uuid.uuid4()),
        "aud": "inhyma-client-test",
        "exp": now + timedelta(minutes=5),
        "iat": now,
        "jti": f"jti-{uuid.uuid4().hex[:8]}",
        "type": "federation_id_token",
    }
    claims.update(claims_override)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return jwt.encode(claims, private_pem, algorithm="RS256", headers={"kid": kid})


def _mock_request() -> Request:
    return Request(
        scope={
            "type": "http",
            "method": "POST",
            "headers": [],
            "state": {"request_id": "req-phase4-test"},
            "client": ("127.0.0.1", 12345),
        }
    )


# ---------------------------------------------------------------------------
# 1. Valid ERP_Main -> Inhyma Handoff (via Exchange & SSO-Login)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_valid_erp_main_to_inhyma_handoff_exchange(rsa_keypair):
    """
    Valid authorization code is exchanged server-to-server for an ID token,
    membership is resolved as ACTIVE, and a local Inhyma session is established.
    """
    private_key, _ = rsa_keypair
    _populate_jwks_cache("kid-1", private_key)

    global_user_id = uuid.uuid4()
    local_user_id = uuid.uuid4()
    id_token = _mint_id_token(private_key, kid="kid-1", sub=str(global_user_id))

    mock_local_user = User(
        id=local_user_id,
        username="local_tester",
        email="tester@inhyma.test",
        first_name="Local",
        last_name="Tester",
        status=UserStatus.ACTIVE,
        is_active=True,
        must_change_password=False,
        created_at=datetime.now(timezone.utc),
    )

    mock_db = AsyncMock()
    mock_auth_service = AsyncMock()
    mock_auth_service.issue_session_for_federated_user.return_value = ("access-jwt-1", "refresh-jwt-1")
    mock_auth_service.get_user_effective_permissions.return_value = {"sales.read", "buyers.read"}

    mock_rbac_service = AsyncMock()
    role_mock = MagicMock()
    role_mock.name = "Sales Officer"
    mock_rbac_service.list_roles_for_user.return_value = [role_mock]

    context = LoginContext(ip_address="127.0.0.1", user_agent="TestBrowser")

    with (
        patch("app.federation.routes.exchange_code_for_id_token", AsyncMock(return_value=id_token)) as mock_exchange,
        patch(
            "app.federation.routes.lookup_membership",
            AsyncMock(return_value={"local_user_id": str(local_user_id), "status": "ACTIVE"}),
        ),
        patch("app.federation.routes.UserRepository") as mock_user_repo_cls,
    ):
        mock_user_repo = AsyncMock()
        mock_user_repo.get_by_id.return_value = mock_local_user
        mock_user_repo_cls.return_value = mock_user_repo

        req_payload = FederationExchangeRequest(
            code="auth-code-valid-999",
            redirect_uri="http://localhost:5174/auth/callback",
        )
        response = await fed_routes.exchange(
            payload=req_payload,
            request=_mock_request(),
            db=mock_db,
            auth_service=mock_auth_service,
            rbac_service=mock_rbac_service,
            context=context,
        )

        mock_exchange.assert_called_once_with(
            code="auth-code-valid-999",
            redirect_uri="http://localhost:5174/auth/callback",
            code_verifier=None,
        )
        assert response["success"] is True
        data = response["data"]
        assert data["access_token"] == "access-jwt-1"
        assert data["refresh_token"] == "refresh-jwt-1"
        assert data["user"]["id"] == str(local_user_id)
        assert data["user"]["username"] == "local_tester"
        assert "sales.read" in data["user"]["permissions"]
        assert "Sales Officer" in data["user"]["roles"]


@pytest.mark.asyncio
async def test_valid_erp_main_to_inhyma_handoff_sso_login(rsa_keypair):
    """
    Valid pre-exchanged ID token presented to /federation/sso-login
    establishes a local session identically.
    """
    private_key, _ = rsa_keypair
    _populate_jwks_cache("kid-1", private_key)

    global_user_id = uuid.uuid4()
    local_user_id = uuid.uuid4()
    id_token = _mint_id_token(private_key, kid="kid-1", sub=str(global_user_id))

    mock_local_user = User(
        id=local_user_id,
        username="local_tester",
        email="tester@inhyma.test",
        status=UserStatus.ACTIVE,
        is_active=True,
        must_change_password=False,
        created_at=datetime.now(timezone.utc),
    )

    mock_db = AsyncMock()
    mock_auth_service = AsyncMock()
    mock_auth_service.issue_session_for_federated_user.return_value = ("access-jwt-2", "refresh-jwt-2")
    mock_auth_service.get_user_effective_permissions.return_value = {"users.read"}

    mock_rbac_service = AsyncMock()
    mock_rbac_service.list_roles_for_user.return_value = []

    context = LoginContext(ip_address="127.0.0.1", user_agent="TestBrowser")

    with (
        patch(
            "app.federation.routes.lookup_membership",
            AsyncMock(return_value={"local_user_id": str(local_user_id), "status": "ACTIVE"}),
        ),
        patch("app.federation.routes.UserRepository") as mock_user_repo_cls,
    ):
        mock_user_repo = AsyncMock()
        mock_user_repo.get_by_id.return_value = mock_local_user
        mock_user_repo_cls.return_value = mock_user_repo

        req_payload = FederationSsoLoginRequest(id_token=id_token)
        response = await fed_routes.sso_login(
            payload=req_payload,
            request=_mock_request(),
            db=mock_db,
            auth_service=mock_auth_service,
            rbac_service=mock_rbac_service,
            context=context,
        )

        assert response["success"] is True
        assert response["data"]["access_token"] == "access-jwt-2"


# ---------------------------------------------------------------------------
# 2. Invalid Signature / Token
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_invalid_token_signature_rejected(rsa_keypair):
    """A token signed with an unknown or untrusted private key fails signature verification."""
    private_key, _ = rsa_keypair
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    # Cache has private_key's public key under "kid-1", but token is signed by other_key
    _populate_jwks_cache("kid-1", private_key)
    token = _mint_id_token(other_key, kid="kid-1")

    mock_db = AsyncMock()
    mock_auth_service = AsyncMock()
    mock_rbac_service = AsyncMock()
    context = LoginContext(ip_address="127.0.0.1")

    with pytest.raises(UnauthorizedException, match="Invalid or expired federation token."):
        await fed_routes.sso_login(
            payload=FederationSsoLoginRequest(id_token=token),
            request=_mock_request(),
            db=mock_db,
            auth_service=mock_auth_service,
            rbac_service=mock_rbac_service,
            context=context,
        )


@pytest.mark.asyncio
async def test_corrupted_token_string_rejected():
    """A malformed non-JWT token string is rejected."""
    mock_db = AsyncMock()
    mock_auth_service = AsyncMock()
    mock_rbac_service = AsyncMock()
    context = LoginContext(ip_address="127.0.0.1")

    with pytest.raises(UnauthorizedException, match="Invalid or expired federation token."):
        await fed_routes.sso_login(
            payload=FederationSsoLoginRequest(id_token="not.a.valid.jwt.string"),
            request=_mock_request(),
            db=mock_db,
            auth_service=mock_auth_service,
            rbac_service=mock_rbac_service,
            context=context,
        )


@pytest.mark.asyncio
async def test_invalid_authorization_code_rejected():
    """When ERP_Main rejects an invalid or replayed code, exchange fails with UnauthorizedException."""
    mock_db = AsyncMock()
    mock_auth_service = AsyncMock()
    mock_rbac_service = AsyncMock()
    context = LoginContext(ip_address="127.0.0.1")

    with patch(
        "app.federation.routes.exchange_code_for_id_token",
        AsyncMock(side_effect=TokenExchangeError("ERP_Main rejected code")),
    ):
        with pytest.raises(UnauthorizedException, match="Invalid or expired authorization code."):
            await fed_routes.exchange(
                payload=FederationExchangeRequest(
                    code="bad-or-replayed-code",
                    redirect_uri="http://localhost:5174/auth/callback",
                ),
                request=_mock_request(),
                db=mock_db,
                auth_service=mock_auth_service,
                rbac_service=mock_rbac_service,
                context=context,
            )


# ---------------------------------------------------------------------------
# 3. Expired Handoff
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_expired_handoff_token_rejected(rsa_keypair):
    """An ID token whose exp timestamp is in the past is rejected."""
    private_key, _ = rsa_keypair
    _populate_jwks_cache("kid-1", private_key)

    past = datetime.now(timezone.utc) - timedelta(minutes=10)
    expired_token = _mint_id_token(private_key, kid="kid-1", exp=past, iat=past - timedelta(minutes=5))

    mock_db = AsyncMock()
    mock_auth_service = AsyncMock()
    mock_rbac_service = AsyncMock()
    context = LoginContext(ip_address="127.0.0.1")

    with pytest.raises(UnauthorizedException, match="Invalid or expired federation token."):
        await fed_routes.sso_login(
            payload=FederationSsoLoginRequest(id_token=expired_token),
            request=_mock_request(),
            db=mock_db,
            auth_service=mock_auth_service,
            rbac_service=mock_rbac_service,
            context=context,
        )


# ---------------------------------------------------------------------------
# 4. Wrong Target ERP (Audience Isolation)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_wrong_target_erp_audience_rejected(rsa_keypair):
    """
    Cross-ERP isolation: a token issued by ERP_Main for Yinglima (aud=yinglima-client)
    presented to Inhyma (aud=inhyma-client-test) MUST be rejected.
    """
    private_key, _ = rsa_keypair
    _populate_jwks_cache("kid-1", private_key)

    yinglima_token = _mint_id_token(private_key, kid="kid-1", aud="yinglima-client-id")

    mock_db = AsyncMock()
    mock_auth_service = AsyncMock()
    mock_rbac_service = AsyncMock()
    context = LoginContext(ip_address="127.0.0.1")

    with pytest.raises(UnauthorizedException, match="Invalid or expired federation token."):
        await fed_routes.sso_login(
            payload=FederationSsoLoginRequest(id_token=yinglima_token),
            request=_mock_request(),
            db=mock_db,
            auth_service=mock_auth_service,
            rbac_service=mock_rbac_service,
            context=context,
        )


# ---------------------------------------------------------------------------
# 5. Unauthorized User (Membership Not ACTIVE)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["SUSPENDED", "REVOKED", "PENDING"])
async def test_unauthorized_user_membership_status_rejected(rsa_keypair, status):
    """
    If ERP_Main returns a non-ACTIVE membership (SUSPENDED/REVOKED/PENDING),
    the handoff is fail-closed rejected with 403 Forbidden.
    """
    private_key, _ = rsa_keypair
    _populate_jwks_cache("kid-1", private_key)

    token = _mint_id_token(private_key, kid="kid-1")

    mock_db = AsyncMock()
    mock_auth_service = AsyncMock()
    mock_rbac_service = AsyncMock()
    context = LoginContext(ip_address="127.0.0.1")

    with patch(
        "app.federation.routes.lookup_membership",
        AsyncMock(return_value={"local_user_id": str(uuid.uuid4()), "status": status}),
    ):
        with pytest.raises(ForbiddenException, match="You do not have an active membership for this ERP."):
            await fed_routes.sso_login(
                payload=FederationSsoLoginRequest(id_token=token),
                request=_mock_request(),
                db=mock_db,
                auth_service=mock_auth_service,
                rbac_service=mock_rbac_service,
                context=context,
            )


# ---------------------------------------------------------------------------
# 6. Valid User with No Inhyma Membership / Missing Local Account
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_user_with_no_inhyma_membership_rejected(rsa_keypair):
    """When ERP_Main returns 404 / MembershipLookupError, access is denied with 403 Forbidden."""
    private_key, _ = rsa_keypair
    _populate_jwks_cache("kid-1", private_key)

    token = _mint_id_token(private_key, kid="kid-1")

    mock_db = AsyncMock()
    mock_auth_service = AsyncMock()
    mock_rbac_service = AsyncMock()
    context = LoginContext(ip_address="127.0.0.1")

    with patch(
        "app.federation.routes.lookup_membership",
        AsyncMock(side_effect=MembershipLookupError("404 Not Found")),
    ):
        with pytest.raises(ForbiddenException, match="You do not have an active membership for this ERP."):
            await fed_routes.sso_login(
                payload=FederationSsoLoginRequest(id_token=token),
                request=_mock_request(),
                db=mock_db,
                auth_service=mock_auth_service,
                rbac_service=mock_rbac_service,
                context=context,
            )


@pytest.mark.asyncio
async def test_valid_membership_missing_local_user_rejected(rsa_keypair):
    """If membership points to a local user id that does not exist in Inhyma, access is denied."""
    private_key, _ = rsa_keypair
    _populate_jwks_cache("kid-1", private_key)

    token = _mint_id_token(private_key, kid="kid-1")

    mock_db = AsyncMock()
    mock_auth_service = AsyncMock()
    mock_rbac_service = AsyncMock()
    context = LoginContext(ip_address="127.0.0.1")

    with (
        patch(
            "app.federation.routes.lookup_membership",
            AsyncMock(return_value={"local_user_id": str(uuid.uuid4()), "status": "ACTIVE"}),
        ),
        patch("app.federation.routes.UserRepository") as mock_user_repo_cls,
    ):
        mock_user_repo = AsyncMock()
        mock_user_repo.get_by_id.return_value = None  # User row missing
        mock_user_repo_cls.return_value = mock_user_repo

        with pytest.raises(ForbiddenException, match="The local account for this membership no longer exists."):
            await fed_routes.sso_login(
                payload=FederationSsoLoginRequest(id_token=token),
                request=_mock_request(),
                db=mock_db,
                auth_service=mock_auth_service,
                rbac_service=mock_rbac_service,
                context=context,
            )


@pytest.mark.asyncio
async def test_local_user_inactive_or_suspended_blocks_session(rsa_keypair):
    """
    Local user status remains authoritative: even if ERP_Main's membership is ACTIVE,
    a deactivated or locked local user is blocked from receiving a local session.
    """
    local_user = User(
        id=uuid.uuid4(),
        username="blocked_local",
        status=UserStatus.SUSPENDED,
        is_active=False,
    )
    auth_service = AuthService(
        user_repository=AsyncMock(),
        role_repository=AsyncMock(),
        session_repository=AsyncMock(),
        token_blacklist_repository=AsyncMock(),
        password_history_repository=AsyncMock(),
        cache=AsyncMock(),
    )
    context = LoginContext(ip_address="127.0.0.1")

    with pytest.raises(UnauthorizedException, match="This account is not active."):
        await auth_service.issue_session_for_federated_user(local_user, context)


# ---------------------------------------------------------------------------
# 7. Successful Local Session Creation
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_successful_local_session_creation_details(rsa_keypair):
    """
    Verify that issue_session_for_federated_user creates a session row,
    mints access & refresh tokens, and returns them properly.
    """
    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        username="active_user",
        email="active@inhyma.test",
        status=UserStatus.ACTIVE,
        is_active=True,
    )

    mock_user_repo = AsyncMock()
    mock_session_repo = AsyncMock()
    mock_token_blacklist_repo = AsyncMock()
    mock_cache = AsyncMock()

    auth_service = AuthService(
        user_repository=mock_user_repo,
        role_repository=AsyncMock(),
        session_repository=mock_session_repo,
        token_blacklist_repository=mock_token_blacklist_repo,
        password_history_repository=AsyncMock(),
        cache=mock_cache,
    )
    # Mock effective permissions lookup
    auth_service.get_user_effective_permissions = AsyncMock(return_value={"inventory.read"})

    context = LoginContext(ip_address="10.0.0.1", user_agent="PytestBrowser", device_info="TestDevice")
    access_token, refresh_token = await auth_service.issue_session_for_federated_user(user, context)

    assert isinstance(access_token, str) and len(access_token) > 20
    assert isinstance(refresh_token, str) and len(refresh_token) > 20

    # Ensure session repository created a session row with matching metadata
    mock_session_repo.create.assert_called_once()
    create_kwargs = mock_session_repo.create.call_args[1]
    assert create_kwargs["user_id"] == user_id
    assert create_kwargs["device_info"] == "TestDevice"
    assert create_kwargs["user_agent"] == "PytestBrowser"


# ---------------------------------------------------------------------------
# 8. Direct Inhyma Login Still Works
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_direct_inhyma_login_still_works():
    """Direct username/password login path continues to function normally."""
    user_id = uuid.uuid4()
    pwd = "SecretPassword123!"
    p_hash = hash_password(pwd)

    user = User(
        id=user_id,
        username="direct_user",
        email="direct@inhyma.test",
        password_hash=p_hash,
        status=UserStatus.ACTIVE,
        is_active=True,
        has_login=True,
        must_change_password=False,
        failed_login_count=0,
        locked_until=None,
        created_at=datetime.now(timezone.utc),
    )

    mock_user_repo = AsyncMock()
    mock_user_repo.get_by_identifier.return_value = user
    mock_session_repo = AsyncMock()
    mock_token_blacklist_repo = AsyncMock()
    mock_cache = AsyncMock()
    mock_cache.get.return_value = None

    auth_service = AuthService(
        user_repository=mock_user_repo,
        role_repository=AsyncMock(),
        session_repository=mock_session_repo,
        token_blacklist_repository=mock_token_blacklist_repo,
        password_history_repository=AsyncMock(),
        cache=mock_cache,
    )
    auth_service.get_user_effective_permissions = AsyncMock(return_value={"all"})

    context = LoginContext(ip_address="127.0.0.1")
    logged_user, access_token, refresh_token = await auth_service.login(
        identifier="direct_user",
        password=pwd,
        context=context,
    )

    assert logged_user.id == user_id
    assert access_token is not None
    assert refresh_token is not None


@pytest.mark.asyncio
async def test_direct_inhyma_login_rejects_wrong_password():
    """Direct login rejects incorrect password as before."""
    user = User(
        id=uuid.uuid4(),
        username="direct_user",
        password_hash=hash_password("RealPassword123!"),
        status=UserStatus.ACTIVE,
        is_active=True,
        has_login=True,
        must_change_password=False,
        failed_login_count=0,
        locked_until=None,
        created_at=datetime.now(timezone.utc),
    )

    mock_user_repo = AsyncMock()
    mock_user_repo.get_by_identifier.return_value = user
    mock_cache = AsyncMock()
    mock_cache.get.return_value = None

    auth_service = AuthService(
        user_repository=mock_user_repo,
        role_repository=AsyncMock(),
        session_repository=AsyncMock(),
        token_blacklist_repository=AsyncMock(),
        password_history_repository=AsyncMock(),
        cache=mock_cache,
    )

    with pytest.raises(UnauthorizedException, match="Invalid username/email/phone number or password."):
        await auth_service.login(
            identifier="direct_user",
            password="WrongPassword999!",
            context=LoginContext(ip_address="127.0.0.1"),
        )


# ---------------------------------------------------------------------------
# 9. Logout Still Works
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_logout_revokes_session_and_blacklists_token():
    """Logout invalidates access token and revokes active session."""
    user_id = uuid.uuid4()
    user = User(id=user_id, username="logout_user", status=UserStatus.ACTIVE, is_active=True)

    mock_session_repo = AsyncMock()
    active_session = MagicMock()
    active_session.is_active = True
    active_session.expires_at = datetime.now(timezone.utc) + timedelta(days=1)
    mock_session_repo.get_by_refresh_jti.return_value = active_session

    mock_token_blacklist_repo = AsyncMock()
    mock_cache = AsyncMock()

    auth_service = AuthService(
        user_repository=AsyncMock(),
        role_repository=AsyncMock(),
        session_repository=mock_session_repo,
        token_blacklist_repository=mock_token_blacklist_repo,
        password_history_repository=AsyncMock(),
        cache=mock_cache,
    )
    auth_service.get_user_effective_permissions = AsyncMock(return_value=set())

    # Issue a real token pair to have a valid refresh token payload
    context = LoginContext(ip_address="127.0.0.1")
    access_token, refresh_token = await auth_service.issue_session_for_federated_user(user, context)

    # Perform logout
    exp_time = datetime.now(timezone.utc) + timedelta(minutes=15)
    await auth_service.logout(
        access_token_jti="access-jti-123",
        access_token_exp=exp_time,
        refresh_token=refresh_token,
    )

    # Check access token was blacklisted
    assert mock_token_blacklist_repo.blacklist.call_count >= 1
    # Check session was revoked
    mock_session_repo.revoke.assert_called_once_with(active_session, reason="logout")
