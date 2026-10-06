import asyncio
from app.database.engine import get_sessionmaker
from sqlalchemy import text

async def main():
    sm = get_sessionmaker()
    async with sm() as session:
        res = (await session.execute(text("""
            SELECT u.username, r.name, ur.is_primary, ur.assignment_type, ur.status
            FROM user_roles ur
            JOIN users u ON u.id = ur.user_id
            JOIN roles r ON r.id = ur.role_id
            WHERE u.username IN ('admin', 'alice', 'sales_manager', 'john', 'ops_employee');
        """))).fetchall()
        for r in res:
            print(r)

if __name__ == "__main__":
    asyncio.run(main())
