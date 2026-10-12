"""Logging out of an ERP is reported to ERP_Main server-to-server, so the person is signed out everywhere."""
from __future__ import annotations

import httpx
import pytest

from app.core.config import settings
from app.federation import erp_main_client


class _Resp:
    def __init__(self, code): self.status_code = code


def _patch_http(monkeypatch, *, status=200, boom=False):
    seen = {}

    class FakeClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json=None, headers=None):
            if boom: raise httpx.ConnectError("down")
            seen.update(url=url, json=json, headers=headers); return _Resp(status)

    monkeypatch.setattr(erp_main_client.httpx, "AsyncClient", FakeClient)
    return seen


@pytest.mark.asyncio
async def test_reports_the_signout_with_credential_and_erp_key(monkeypatch):
    monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL", "shared-secret-0123456789")
    monkeypatch.setattr(settings, "ERP_MAIN_API_BASE_URL", "https://main.example/api/v1/")
    seen = _patch_http(monkeypatch)
    assert await erp_main_client.push_signout_to_erp_main("a@example.com") is True
    assert seen["url"] == "https://main.example/api/v1/internal/users/signout"
    assert seen["json"] == {"email": "a@example.com"}
    assert seen["headers"]["Authorization"] == "Bearer shared-secret-0123456789"
    assert seen["headers"]["X-ERP-Key"] == settings.ERP_KEY


@pytest.mark.asyncio
async def test_a_failed_report_never_breaks_the_local_logout(monkeypatch):
    monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL", "shared-secret-0123456789")
    _patch_http(monkeypatch, boom=True)
    assert await erp_main_client.push_signout_to_erp_main("a@example.com") is False
    _patch_http(monkeypatch, status=401)
    assert await erp_main_client.push_signout_to_erp_main("a@example.com") is False


@pytest.mark.asyncio
async def test_does_nothing_without_a_configured_credential(monkeypatch):
    monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL", "CHANGE-ME-placeholder")
    monkeypatch.setattr(settings, "FEDERATION_SERVICE_CREDENTIAL", "")
    seen = _patch_http(monkeypatch)
    assert await erp_main_client.push_signout_to_erp_main("a@example.com") is False
    assert seen == {}
