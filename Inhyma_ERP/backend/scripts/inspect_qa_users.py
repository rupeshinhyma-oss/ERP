import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.database.session import get_sessionmaker
from app.users.models import User
from app.rbac.models import Role, UserRole

async def main():
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        usernames = ["admin", "alice", "sales_manager", "john", "ops_employee"]
        users = list((await session.execute(select(User).where(User.deleted_at.is_(None)))).scalars().all())
        print(f"=== TOTAL USERS IN POSTGRESQL: {len(users)} ===")
        for user in users:
            ur_stmt = select(Role.name).join(UserRole, UserRole.role_id == Role.id).where(UserRole.user_id == user.id, UserRole.status == "ACTIVE")
            roles = list((await session.execute(ur_stmt)).scalars().all())
            roles_str = ", ".join(roles) if roles else "None"
            print(f"User: {user.username:15} | UUID: {user.id} | Code: {user.employee_code} | Name: {user.first_name} {user.last_name} | Roles: [{roles_str}] | Active: {user.is_active} | ManagerID: {user.manager_id}")

if __name__ == "__main__":
    asyncio.run(main())
