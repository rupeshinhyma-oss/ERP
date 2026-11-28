"""Wave C & Wave D regression tests for Inhyma_ERP (BUG-020, BUG-026)."""

from __future__ import annotations

import time
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event

from app.audit.models import AuditAction, AuditLog
from app.audit.repository import AuditRepository
from app.common.filtering import FilterParams
from app.common.list_query import ListQueryParams
from app.common.pagination import PageParams
from app.common.search import SearchParams
from app.common.sorting import SortParams
from app.database.engine import get_engine, get_sessionmaker
from app.hrms.asset_service import HrmsAssetService
from app.hrms.payroll_routes import get_hrms_user_context, get_payroll_service
from app.main import create_application


def _make_hrms_ctx(*, is_admin: bool = False, is_hr: bool = False, can_config: bool = False):
    return SimpleNamespace(
        user_id=uuid.uuid4(),
        is_admin=is_admin,
        is_hr=is_hr,
        require_module_access=lambda _mod: None,
        can_configure_salary=lambda: can_config,
    )


@pytest.mark.asyncio
async def test_bug020_monthly_payroll_uncalculated_returns_200_null_and_no_autocreate():
    """BUG-020: GET /hrms/payroll/monthly/{month} must return 200 {data: null} instead of 404."""
    app = create_application()
    mock_svc = SimpleNamespace(
        get_monthly_payroll=AsyncMock(return_value=None),
        calculate_monthly_payroll=AsyncMock(),
    )
    app.dependency_overrides[get_hrms_user_context] = lambda: _make_hrms_ctx(is_admin=True, is_hr=True)
    app.dependency_overrides[get_payroll_service] = lambda: mock_svc

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            resp = await client.get("/api/v1/hrms/payroll/monthly/2099-01")
            assert resp.status_code == 200
            body = resp.json()
            assert body["success"] is True
            assert body["data"] is None
            assert "2099-01" in body["message"]
            mock_svc.calculate_monthly_payroll.assert_not_awaited()
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_bug020_monthly_payroll_regular_employee_still_forbidden():
    """BUG-020: Non-admin / non-HR employee must still receive 403 Forbidden."""
    app = create_application()
    mock_svc = SimpleNamespace(
        get_monthly_payroll=AsyncMock(return_value=None),
        calculate_monthly_payroll=AsyncMock(),
    )
    app.dependency_overrides[get_hrms_user_context] = lambda: _make_hrms_ctx(is_admin=False, is_hr=False)
    app.dependency_overrides[get_payroll_service] = lambda: mock_svc

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            resp = await client.get("/api/v1/hrms/payroll/monthly/2099-01")
            assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_bug026_audit_repository_avoids_window_count_over_wide_rows():
    """BUG-026: AuditRepository.paginated_list must separate narrow COUNT(id) from page query (no OVER())."""
    engine = get_engine()
    executed_sql: list[str] = []

    def _capture_sql(_conn, _cursor, statement, _params, _context, _executemany):
        executed_sql.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", _capture_sql)
    try:
        from app.database.base import Base
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        sm = get_sessionmaker()
        async with sm() as session:
            # Insert a couple of audit log entries cleanly
            session.add(
                AuditLog(
                    action=AuditAction.CREATE,
                    module="audit",
                    description="BUG-026 regression probe",
                )
            )
            await session.flush()

            executed_sql.clear()
            repo = AuditRepository(session)
            query = ListQueryParams(
                page=PageParams(page=1, page_size=20),
                sort=SortParams(),
                search=SearchParams(),
                filters=FilterParams(),
            )
            rows, total = await repo.paginated_list(query)
            assert total >= 1
            assert len(rows) >= 1
            assert len(executed_sql) == 2
            assert all("OVER" not in sql.upper() for sql in executed_sql), (
                f"Expected separated page + narrow COUNT(id) without WindowAgg OVER(), got: {executed_sql}"
            )
            await session.rollback()
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _capture_sql)


@pytest.mark.asyncio
async def test_bug026_hrms_assets_summary_is_single_query_and_list_is_bounded():
    """BUG-026: HrmsAssetService.get_summary runs in 1 SQL query and list_assets avoids N+1."""
    engine = get_engine()
    executed_sql: list[str] = []

    def _capture_sql(_conn, _cursor, statement, _params, _context, _executemany):
        executed_sql.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", _capture_sql)
    try:
        from app.database.base import Base
        import app.hrms.models  # noqa: F401
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        sm = get_sessionmaker()
        async with sm() as session:
            svc = HrmsAssetService(session)

            executed_sql.clear()
            summary = await svc.get_summary()
            assert hasattr(summary, "total_assets") and summary.total_assets == 0
            assert len(executed_sql) == 1, f"Expected 1 aggregated query for get_summary, ran {len(executed_sql)}"

            executed_sql.clear()
            listing = await svc.list_assets(page=1, page_size=20)
            assert isinstance(listing, (list, tuple))
            assert len(executed_sql) <= 4, f"Expected <=4 queries for list_assets, ran {len(executed_sql)}"
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _capture_sql)


@pytest.mark.asyncio
async def test_bug026_federation_health_anonymous_is_fast_minimal_and_no_outbound_probes():
    """BUG-026: Anonymous GET /health/federation must return minimal payload immediately with 0 outbound HTTP probes."""
    app = create_application()
    transport = ASGITransport(app=app)
    with patch("httpx.AsyncClient", side_effect=AssertionError("Anonymous federation health must not probe peers")):
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            t0 = time.perf_counter()
            resp = await client.get("/api/v1/health/federation")
            elapsed_ms = (time.perf_counter() - t0) * 1000
            assert resp.status_code == 200
            data = resp.json()["data"]
            assert data["status"] in {"healthy", "degraded"}
            assert "sso_enabled" in data
            assert "probes" not in data
            assert "erp_main_probes" not in data
            assert elapsed_ms < 500
