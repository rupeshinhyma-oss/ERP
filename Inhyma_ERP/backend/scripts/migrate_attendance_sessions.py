"""
Migration script for attendance_sessions.
"""

import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool
from app.core.config import settings
from app.database.base import Base
import app.users.models  # noqa: F401
import app.rbac.models  # noqa: F401
import app.hrms.models  # noqa: F401


async def run_migration():
    url = str(settings.DATABASE_URL).replace(":5432", ":6543")
    print(f"Connecting via transaction pooler: {url[:45]}...")
    engine = create_async_engine(
        url,
        poolclass=NullPool,
        connect_args={"statement_cache_size": 0},
    )
    async with engine.begin() as conn:
        # Create all metadata tables
        await conn.run_sync(Base.metadata.create_all)

        # Alter hrms_attendance_logs
        await conn.execute(
            text("""
            ALTER TABLE hrms_attendance_logs
            ADD COLUMN IF NOT EXISTS late_mark BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS half_day BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS regularization_status VARCHAR(30);
            """)
        )

        # Check if attendance_sessions is a table or view
        res = await conn.execute(
            text("""
            SELECT table_name, table_type 
            FROM information_schema.tables 
            WHERE table_name IN ('attendance_sessions', 'hrms_attendance_logs');
            """)
        )
        print("Existing tables/views:", res.fetchall())

    await engine.dispose()
    print("Migration finished successfully!")


if __name__ == "__main__":
    asyncio.run(run_migration())
