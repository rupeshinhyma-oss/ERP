"""
/auth/sso-handover must not trust the browser.

The handover token is assembled client-side, so on its own it proves nothing.  The ERP now
asks ERP_Main whether the central session is active, belongs to the same email, and grants
access to THIS ERP.  Any doubt (unreachable, revoked, mismatch, no access) means no session.
"""

from __future__ import annotations

import base64
import json
import time
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import Request

from app.auth import routes as auth_routes
from app.auth.routes import SsoHandoverRequest, sso_handover_login
from app.core.config import settings
from app.core.exceptions import ForbiddenException, UnauthorizedException
from app.federation.erp_main_client import EcosystemSessionError
from app.users import routes as user_routes
from app.users.models import User, UserStatus
from app.users.schemas import UserUpdate

EMAIL = "admin@example.com"
ERP_KEY = settings.ERP_KEY.lower()


def _token(**over) -> str:
    body = {
        "sig": "ihm_erp_sso_v1",
        "ts": int(time.time() * 1000),
        "email": EMAIL,
        "session_id": "11111111-1111-4111-8111-111111111111",
        "allowed_erps": ["*"],
        "role": "super_admin",
    }
    body.update(over)
    return base64.b64encode(json.dumps(body).encode()).decode()


def _request() -> Request:
    return Request(
        scope={
            "type": "http", "method": "POST", "path": "/api/v1/auth/sso-handover", "query_string": b"",
            "headers": [], "server": ("test", 80), "scheme": "http", "client": ("127.0.0.1", 1),
            "state": {"request_id": "req-test"},
        }
    )


def _user() -> User:
    return User(
        id=uuid.uuid4(), username="admin", email=EMAIL, password_hash="x", status=UserStatus.ACTIVE,
        is_active=True, has_login=True, must_change_password=False, failed_login_count=0,
        created_at=datetime.now(timezone.utc),
    )


def _deps(user: User | None):
    result = MagicMock()
    result.scalars.return_value.first.return_value = user
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    auth = MagicMock()
    auth.issue_session_for_federated_user = AsyncMock(return_value=("access-token", "refresh-token"))
    auth.get_user_effective_permissions = AsyncMock(return_value={"x"})
    rbac = MagicMock()
    rbac.list_roles_for_user = AsyncMock(return_value=[])
    audit = MagicMock()
    audit.record = AsyncMock()
    return db, auth, rbac, audit


async def _call(token: str, user: User | None = None):
    db, auth, rbac, audit = _deps(user if user is not None else _user())
    ctx = MagicMock()
    ctx.ip_address, ctx.user_agent = "127.0.0.1", "pytest"
    out = await sso_handover_login(
        payload=SsoHandoverRequest(email=EMAIL, sso_token=token, target_erp=ERP_KEY),
        request=_request(), db=db, auth_service=auth, rbac_service=rbac, context=ctx, audit_service=audit,
    )
    return out, auth


@pytest.fixture(autouse=True)
def _on(monkeypatch):
    monkeypatch.setattr(settings, "SSO_HANDOVER_REQUIRE_CENTRAL_VERIFICATION", True)


def _central(monkeypatch, **data):
    reply = {"active": True, "email": EMAIL, "allowed_erps": ["*"], **data}
    mock = AsyncMock(return_value=reply)
    monkeypatch.setattr(auth_routes, "verify_ecosystem_session", mock)
    return mock


@pytest.mark.asyncio
async def test_forged_token_without_a_central_session_is_rejected():
    with pytest.raises(UnauthorizedException):
        await _call(_token(session_id=""))


@pytest.mark.asyncio
async def test_local_standalone_session_id_is_not_a_central_session():
    with pytest.raises(UnauthorizedException):
        await _call(_token(session_id="ihm-sess-1728000000000"))


@pytest.mark.asyncio
async def test_forged_session_id_unknown_to_erp_main_is_rejected(monkeypatch):
    _central(monkeypatch, active=False, notFound=True)
    with pytest.raises(UnauthorizedException):
        await _call(_token())


@pytest.mark.asyncio
async def test_revoked_central_session_is_rejected(monkeypatch):
    _central(monkeypatch, active=False, revoked=True)
    with pytest.raises(UnauthorizedException):
        await _call(_token())


@pytest.mark.asyncio
async def test_session_belonging_to_a_different_email_is_rejected(monkeypatch):
    _central(monkeypatch, email="someone.else@example.com")
    with pytest.raises(UnauthorizedException):
        await _call(_token())


@pytest.mark.asyncio
async def test_user_not_assigned_to_this_erp_is_forbidden_even_if_token_claims_wildcard(monkeypatch):
    _central(monkeypatch, allowed_erps=["some-other-erp", "control-plane"])
    with pytest.raises(ForbiddenException):
        await _call(_token(allowed_erps=["*"]))  # the browser's claim is ignored; ERP_Main decides


@pytest.mark.asyncio
async def test_erp_main_unreachable_fails_closed_and_issues_no_session(monkeypatch):
    monkeypatch.setattr(auth_routes, "verify_ecosystem_session", AsyncMock(side_effect=EcosystemSessionError("down")))
    db, auth, rbac, audit = _deps(_user())
    with pytest.raises(UnauthorizedException):
        await sso_handover_login(
            payload=SsoHandoverRequest(email=EMAIL, sso_token=_token(), target_erp=ERP_KEY),
            request=_request(), db=db, auth_service=auth, rbac_service=rbac, context=MagicMock(), audit_service=audit,
        )
    auth.issue_session_for_federated_user.assert_not_called()


@pytest.mark.asyncio
async def test_valid_central_session_with_access_signs_in(monkeypatch):
    verify = _central(monkeypatch, allowed_erps=[ERP_KEY, "control-plane"])
    out, auth = await _call(_token())
    assert out["data"]["access_token"] == "access-token"
    auth.issue_session_for_federated_user.assert_awaited_once()
    verify.assert_awaited_once()


@pytest.mark.asyncio
async def test_super_admin_wildcard_from_erp_main_is_accepted(monkeypatch):
    _central(monkeypatch, allowed_erps=["*"])
    out, _ = await _call(_token())
    assert out["data"]["access_token"] == "access-token"


@pytest.mark.asyncio
async def test_emergency_switch_restores_the_old_behaviour(monkeypatch):
    monkeypatch.setattr(settings, "SSO_HANDOVER_REQUIRE_CENTRAL_VERIFICATION", False)
    verify = _central(monkeypatch)
    out, _ = await _call(_token(session_id=""))
    assert out["data"]["access_token"] == "access-token"
    verify.assert_not_called()


# ---- identity is central: a local admin cannot repoint a user's email -----------------

@pytest.mark.asyncio
async def test_local_admin_cannot_change_a_users_email():
    svc = MagicMock()
    svc.user_repository.get_by_id = AsyncMock(return_value=_user())
    with pytest.raises(ForbiddenException):
        await user_routes.enforce_central_identity(svc, uuid.uuid4(), UserUpdate(email="attacker@example.com"))


@pytest.mark.asyncio
async def test_resending_the_same_email_or_editing_other_fields_is_allowed():
    svc = MagicMock()
    svc.user_repository.get_by_id = AsyncMock(return_value=_user())
    await user_routes.enforce_central_identity(svc, uuid.uuid4(), UserUpdate(email="ADMIN@example.com"))  # same, any case
    await user_routes.enforce_central_identity(svc, uuid.uuid4(), UserUpdate(first_name="Renamed"))  # no email field
