"""A person ERP_Main allows into this ERP must get in, however the ERP key is spelled -- and nobody else may."""

from __future__ import annotations

import pytest

from app.core.config import settings
from app.core.exceptions import ForbiddenException
from app.federation.erp_keys import describe_denial, erp_access_matches
from tests.test_sso_handover_central_verification import _call, _central, _token

MINE = {"inhyma", "erp-01"}


@pytest.mark.parametrize(
    "offered",
    [["inhyma", "control-plane"], ["INHYMA"], ["erp_01", "control-plane"], ["erp-01"], ["inhyma_erp"], ["inhyma-erp"], ["*"], ["control-plane", "Inhyma ERP"]],
)
def test_this_erp_is_recognised_however_its_key_is_spelled(offered):
    assert erp_access_matches(MINE, offered) is True


@pytest.mark.parametrize(
    "offered",
    [["yinglima", "control-plane"], ["erp_02"], ["control-plane"], [], ["xyz_01"], ["yinglima_erp"], [None, ""], ["erp"], ["01"]],
)
def test_other_erps_and_empty_lists_are_never_accepted(offered):
    assert erp_access_matches(MINE, offered) is False


def test_the_denial_message_says_what_was_offered_and_what_this_erp_is():
    msg = describe_denial(MINE, ["yinglima", "control-plane"])
    assert "['yinglima']" in msg and "erp-01" in msg and "inhyma" in msg


@pytest.fixture(autouse=True)
def _central_on(monkeypatch):
    monkeypatch.setattr(settings, "SSO_HANDOVER_REQUIRE_CENTRAL_VERIFICATION", True)


@pytest.mark.asyncio
async def test_a_member_whose_registry_key_is_spelled_differently_gets_in(monkeypatch):
    """ERP_Main knows this ERP as 'erp_01' (underscore); the front end offers 'inhyma'. This used to be a 403."""
    _central(monkeypatch, allowed_erps=["erp_01", "control-plane"], role="global_user")
    out, auth = await _call(_token(allowed_erps=["inhyma"], role="global_user"))
    assert out["data"]["access_token"] == "access-token"
    auth.issue_session_for_federated_user.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_member_of_another_erp_is_still_refused_with_a_clear_reason(monkeypatch):
    _central(monkeypatch, allowed_erps=["yinglima", "control-plane"], role="global_user")
    with pytest.raises(ForbiddenException) as caught:
        await _call(_token(allowed_erps=["inhyma"], role="global_user"))
    assert "ERP_Main grants access to ['yinglima']" in str(caught.value)


@pytest.mark.asyncio
async def test_a_token_that_only_offers_another_erp_is_refused(monkeypatch):
    _central(monkeypatch, allowed_erps=["inhyma", "control-plane"], role="global_user")
    with pytest.raises(ForbiddenException):
        await _call(_token(allowed_erps=["yinglima"], role="global_user"))
