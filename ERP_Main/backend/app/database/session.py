"""
Database Session Dependency.

Exposes `get_db_session`, the single FastAPI dependency every route/service
in ERP_Main uses to obtain an `AsyncSession`. Same commit/rollback/close
transaction policy as Yinglima_ERP's `app.database.session`:

- Committed automatically if the request handler completes without raising.
- Rolled back automatically if any exception propagates out.
- Always closed in the `finally` block.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from app.database.engine import get_sessionmaker

logger = logging.getLogger(__name__)


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield a transactional, per-request `AsyncSession`."""
    session_factory = get_sessionmaker()
    session = session_factory()
    try:
        yield session
        await session.commit()
    except BaseException as exc:
        try:
            await session.rollback()
        except Exception:
            pass
        if not isinstance(exc, (asyncio.CancelledError, KeyboardInterrupt, GeneratorExit)):
            logger.exception("Session rolled back due to an unhandled exception.")
        raise
    finally:
        try:
            await session.close()
        except Exception:
            pass
