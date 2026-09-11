"""
ERP_Main Client Tests (Relying Party side).

Unit-level tests for `app.federation.erp_main_client.lookup_membership`,
using mocked HTTP responses (no live ERP_Main instance required) --
verifies this ERP correctly distinguishes success, "no membership,"
network failure, and malformed-response cases, and always raises the
same `MembershipLookupError` type so callers can treat every failure
mode uniformly as "deny access" (Phase 4 Step 53).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
import pytest

from app.federation import erp_main_client as client_module


class _FakeResponse:
    """A minimal stand-in for an httpx.Response, just enough for lookup_membership's own logic."""

    def __init__(self, *, status_code: int, json_body: dict | None = None, text: str = "") -> None:
        """Store the canned response shape."""
        self.status_code = status_code
        self._json_body = json_body or {}
        self.text = text

    def json(self) -> dict:
        """Return the canned JSON body."""
        return self._json_body


def _patched_client(response: _FakeResponse | None = None, *, raise_exc: Exception | None = None):
    """Build an async context manager standing in for `httpx.AsyncClient()`, returning/raising as configured."""
    mock_client = AsyncMock()
    if raise_exc is not None:
        mock_client.get.side_effect = raise_exc
    else:
        mock_client.get.return_value = response
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = False
    return patch("httpx.AsyncClient", return_value=mock_client)


@pytest.mark.asyncio
async def test_successful_lookup_returns_membership_data():
    """A 200 response with a membership payload is returned as-is."""
    fake = _FakeResponse(
        status_code=200,
        json_body={"data": {"global_user_id": str(uuid4()), "local_user_id": "local-1", "status": "ACTIVE"}},
    )
    with _patched_client(fake):
        result = await client_module.lookup_membership(uuid4())
    assert result["local_user_id"] == "local-1"
    assert result["status"] == "ACTIVE"


@pytest.mark.asyncio
async def test_404_response_raises_membership_lookup_error():
    """A 404 (no membership for this ERP) raises MembershipLookupError, not a silent None/False."""
    fake = _FakeResponse(status_code=404, json_body={"success": False}, text="not found")
    with _patched_client(fake):
        with pytest.raises(client_module.MembershipLookupError):
            await client_module.lookup_membership(uuid4())


@pytest.mark.asyncio
async def test_network_failure_raises_membership_lookup_error():
    """A network-level failure (ERP_Main unreachable) raises MembershipLookupError, not an unhandled httpx exception."""
    with _patched_client(raise_exc=httpx.ConnectError("connection refused")):
        with pytest.raises(client_module.MembershipLookupError):
            await client_module.lookup_membership(uuid4())


@pytest.mark.asyncio
async def test_malformed_response_body_raises_membership_lookup_error():
    """A 200 response with no 'data' key is treated as a failure, not as an empty-but-valid membership."""
    fake = _FakeResponse(status_code=200, json_body={"success": True, "data": None})
    with _patched_client(fake):
        with pytest.raises(client_module.MembershipLookupError):
            await client_module.lookup_membership(uuid4())
