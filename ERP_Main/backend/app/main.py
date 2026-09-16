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

import logging
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

logger = logging.getLogger(__name__)


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
        - Guarantee the bootstrap Platform Admin + Global User accounts
          exist, so a fresh/reset database is never stuck with no way to
          log in at all (see the try/except block below).
    Shutdown: dispose of the database engine's connection pool.
    """
    settings.validate_production_secrets()

    engine = get_engine()
    if settings.DATABASE_URL.startswith("sqlite"):
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    # Reliability fallback: guarantee the bootstrap Platform Admin account
    # exists every time this backend starts, with zero manual steps.
    # Previously `scripts/seed.py` had to be run by hand, and nothing here
    # ever reminded anyone to do it -- a freshly created or reset database
    # had no admin account at all, so every login attempt failed with a
    # plain "Invalid username/email/phone number or password.",
    # indistinguishable from a real typo.
    #
    # Calls `seed_bootstrap_accounts_with_session()`, NOT
    # `scripts.seed.seed_bootstrap_accounts()` -- the latter disposes the
    # shared database engine when it finishes (correct for a one-shot CLI
    # script, wrong here). Gated on an existence check first purely as an
    # optimization; `seed_bootstrap_accounts_with_session()` is itself
    # fully idempotent and -- as of this fix -- never resets an existing
    # account's password either way.
    #
    # Scope note: this only guarantees the Platform Admin + Global User
    # accounts (and, if the ERP registry/role catalog already exist, their
    # memberships and role assignment). It does NOT run the full
    # `scripts.seed.main()` chain (ERP registry + platform permission
    # catalog seeding) automatically -- those are one-time ecosystem setup
    # steps, not something to silently redo on every restart. On a
    # completely fresh ERP_Main database (nothing ever seeded at all), run
    # `python -m scripts.seed` once by hand; after that, this fallback
    # keeps the admin account itself from ever going missing again.
    try:
        from sqlalchemy import select
        from app.database.engine import get_sessionmaker
        from app.platform_auth.models import PlatformAdmin

        async with get_sessionmaker()() as _bootstrap_session:
            _existing_admin = await _bootstrap_session.scalar(
                select(PlatformAdmin).where(PlatformAdmin.email == settings.BOOTSTRAP_ADMIN_EMAIL)
            )

            if _existing_admin is None:
                logger.warning(
                    "No bootstrap Platform Admin found -- running the bootstrap-accounts seed "
                    "automatically so login is not blocked. This never runs again once the account exists."
                )
                from scripts.seed import seed_bootstrap_accounts_with_session as _run_bootstrap_seed

                await _run_bootstrap_seed(_bootstrap_session)
                await _bootstrap_session.commit()

            # Ensure federation clients and service credentials exist for seamless ERP switching
            try:
                from scripts.seed_federation import seed_federation_with_session as _run_fed_seed

                await _run_fed_seed(_bootstrap_session)
                await _bootstrap_session.commit()
            except Exception:
                logger.warning("Federation client check failed; continuing startup.", exc_info=True)
    except Exception:
        # Fail-open on purpose: if this check itself can't run for any
        # reason (e.g. a migration hasn't created the platform_admins
        # table yet on a brand-new database), that is a separate, louder
        # problem that will surface clearly on the very next request
        # anyway -- this safety net must never be the thing that prevents
        # the server from starting.
        logger.warning("Bootstrap admin existence check failed; continuing startup regardless.", exc_info=True)

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