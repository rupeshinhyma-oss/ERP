"""
ERP_Main Application Entry Point.

Defines `create_application`, the FastAPI app factory for the global
control plane. Mirrors Yinglima_ERP's `app.main` composition-root pattern.
Phase 2 shipped the ERP Registry with no auth at all; Phase 3 adds
platform-admin auth, ERP service credentials, Global Users, Memberships,
and the global audit log -- still no background workers/queue/cache,
since none of that is needed yet.

Per Phase 2 Step 21 / Phase 3 Step 28 (Performance/availability): this
service is never called by Yinglima (or any other ERP) during normal
business operations, and its own unavailability never blocks any local
ERP's ordinary operation. It exists so ERP instances can be registered,
looked up, and (new in Phase 3) linked to Global Users -- nothing here
sits in the request path of any existing ERP's business APIs.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.exception_handlers import register_exception_handlers
from app.core.middleware import RequestIdMiddleware, SecurityHeadersMiddleware
from app.database.base import Base
from app.database.engine import dispose_engine, get_engine


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Manage application startup and shutdown.

    Startup:
        - Refuse to boot in production with placeholder secrets or
          wildcard CORS (Phase 3 Step 53) -- see
          `Settings.validate_production_secrets()`.
        - Eagerly create the database engine and (for the SQLite local-
          dev/test path only) create tables directly from metadata, since
          this service has no Alembic migration history to run yet in a
          fresh container -- the real Alembic migrations in
          `alembic/versions/` are what provision a Postgres deployment.
    Shutdown: dispose of the database engine's connection pool.
    """
    settings.validate_production_secrets()

    engine = get_engine()
    if settings.DATABASE_URL.startswith("sqlite"):
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    yield

    await dispose_engine()


def create_application() -> FastAPI:
    """Build and configure the ERP_Main FastAPI application instance."""
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        docs_url=settings.DOCS_URL,
        redoc_url=settings.REDOC_URL,
        openapi_url=settings.OPENAPI_URL,
        lifespan=lifespan,
    )

    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins_list,
        allow_credentials=settings.CORS_ALLOW_CREDENTIALS,
        # Explicit, not wildcard, alongside allow_credentials=True (Phase
        # 3 Step 53) -- this control plane's frontend only ever needs
        # these methods/headers; Authorization carries platform-admin
        # and ERP-service bearer tokens.
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    )

    register_exception_handlers(app)

    app.include_router(api_router, prefix=settings.API_V1_PREFIX)

    return app


app = create_application()
