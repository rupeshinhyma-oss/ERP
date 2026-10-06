import asyncio
from app.database.engine import get_sessionmaker
from sqlalchemy import text

async def main():
    sm = get_sessionmaker()
    async with sm() as session:
        users = (await session.execute(text("""
            SELECT id, username, first_name, last_name, employee_code, is_active, status
            FROM users
            WHERE is_active = true AND deleted_at IS NULL;
        """))).fetchall()
        print(f"Total active users: {len(users)}")
        for u in users:
            print(" ", u)

if __name__ == "__main__":
    asyncio.run(main())
