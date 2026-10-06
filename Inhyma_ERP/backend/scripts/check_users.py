import asyncio
from app.database.engine import get_sessionmaker
from sqlalchemy import text

async def main():
    sm = get_sessionmaker()
    async with sm() as session:
        users = (await session.execute(text("""
            SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.employee_code, u.status, u.is_active, u.has_login,
                   array_agg(r.name) as roles
            FROM users u
            LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'ACTIVE'
            LEFT JOIN roles r ON r.id = ur.role_id
            WHERE u.username IN ('admin', 'alice', 'sales_manager', 'john', 'ops_employee')
            GROUP BY u.id, u.username, u.email, u.first_name, u.last_name, u.employee_code, u.status, u.is_active, u.has_login;
        """))).fetchall()
        print("=== MATCHED USERS ===")
        for u in users:
            print(u)

if __name__ == "__main__":
    asyncio.run(main())
