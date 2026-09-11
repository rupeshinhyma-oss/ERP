"""
Async Database Engine.

Owns the single `AsyncEngine` / `async_sessionmaker` pair for ERP_Main's
own database. Nothing here ever points at Yinglima's (or any other ERP's)
`DATABASE_URL` -- see docs/MULTI_ERP_ARCHITECTURE.md §6 (Database
Separation) for why that boundary is load-bearing, not incidental.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    """Return the process-wide `AsyncEngine`, creating it on first use."""
    global _engine
    if _engine is None:
        connect_args = {}
        if settings.DATABASE_URL.startswith("sqlite"):
            # SQLite's default driver rejects cross-thread/task use of the
            # same connection; async SQLite access needs this relaxed.
            connect_args["check_same_thread"] = False
        elif getattr(settings, "DATABASE_DISABLE_STATEMENT_CACHE", False):
            # Required when connecting through a transaction-mode PgBouncer / Supabase pooler
            connect_args["statement_cache_size"] = 0
            connect_args["prepared_statement_name_func"] = lambda: ""
        engine_kwargs = {
            "echo": settings.DATABASE_ECHO,
            "connect_args": connect_args,
        }
        if not settings.DATABASE_URL.startswith("sqlite"):
            from sqlalchemy.pool import AsyncAdaptedQueuePool
            engine_kwargs.update({
                "poolclass": AsyncAdaptedQueuePool,
                "pool_size": getattr(settings, "DATABASE_POOL_SIZE", 10),
                "max_overflow": getattr(settings, "DATABASE_MAX_OVERFLOW", 20),
                "pool_timeout": getattr(settings, "DATABASE_POOL_TIMEOUT_SECONDS", 30),
                "pool_recycle": getattr(settings, "DATABASE_POOL_RECYCLE_SECONDS", 1800),
                "pool_pre_ping": True,
            })
        _engine = create_async_engine(
            settings.DATABASE_URL,
            **engine_kwargs,
        )
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """Return the process-wide `async_sessionmaker`, creating it on first use."""
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(bind=get_engine(), expire_on_commit=False)
    return _sessionmaker


async def dispose_engine() -> None:
    """Dispose of the engine's connection pool cleanly (called on shutdown)."""
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None
