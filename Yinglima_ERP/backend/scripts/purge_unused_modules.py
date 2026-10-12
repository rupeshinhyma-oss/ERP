"""
Purge all unused/retired permission modules completely from the database:
- employee.*
- orgdepartment.*
- task.*
- reporting.*
"""

import sys
sys.path.insert(0, ".")
import asyncio
from sqlalchemy import text
from app.database.engine import get_sessionmaker, dispose_engine
from app.core.logging import configure_logging, get_logger

logger = get_logger(__name__)

UNUSED_MODULES = [
    "employee",
    "orgdepartment",
    "task",
    "reporting",
    "department",
    "designation",
    "reports",
    "settings",
    "crm",
    "cache",
    "queue",
]

async def purge_unused_modules():
    configure_logging()
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # 1. Fetch matching permissions
        placeholders = ",".join(repr(m) for m in UNUSED_MODULES)
        res = await session.execute(text(f"SELECT id, code, module FROM permissions WHERE module IN ({placeholders})"))
        perms = res.fetchall()
        print(f"Found {len(perms)} unused permissions across modules: {UNUSED_MODULES}\n")
        
        if not perms:
            print("No unused permissions found. Database is already clean.")
            await dispose_engine()
            return

        perm_ids = [str(p[0]) for p in perms]
        perm_ids_sql = ",".join(f"'{pid}'" for pid in perm_ids)

        # 2. Delete from user_permissions
        up_del = await session.execute(text(f"DELETE FROM user_permissions WHERE permission_id IN ({perm_ids_sql})"))
        print(f"Deleted {up_del.rowcount} user_permissions overrides.")

        # 3. Delete from role_permissions
        rp_del = await session.execute(text(f"DELETE FROM role_permissions WHERE permission_id IN ({perm_ids_sql})"))
        print(f"Deleted {rp_del.rowcount} role_permissions grants.")

        # 4. Delete from permissions
        p_del = await session.execute(text(f"DELETE FROM permissions WHERE id IN ({perm_ids_sql})"))
        print(f"Deleted {p_del.rowcount} permissions.")

        await session.commit()
        print("\nCommit successful!")

        # 5. Verify remaining modules
        rem_res = await session.execute(text("SELECT module, count(*) FROM permissions GROUP BY module ORDER BY module"))
        rem_rows = rem_res.fetchall()
        print(f"\nRemaining permission modules in system: {len(rem_rows)}")
        total_perms = 0
        for mod, count in rem_rows:
            print(f"  {mod}: {count}")
            total_perms += count
        print(f"Total remaining active permissions: {total_perms}")

    await dispose_engine()

if __name__ == "__main__":
    asyncio.run(purge_unused_modules())
