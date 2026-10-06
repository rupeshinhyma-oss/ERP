import asyncio
from app.database.session import AsyncSessionLocal
from sqlalchemy import select
from app.models.user import User
from app.models.auth import Role, UserRole

async def check():
    async with AsyncSessionLocal() as db:
        users = (await db.execute(select(User))).scalars().all()
        print(f"Total users in DB: {len(users)}")
        for u in users:
            roles = (await db.execute(select(Role.name).join(UserRole, UserRole.role_id == Role.id).where(UserRole.user_id == u.id))).scalars().all()
            print(f"User: {u.username:<15} | ID: {str(u.id):<36} | Active: {u.is_active} | Super: {u.is_super_admin} | Dept: {getattr(u, 'department', None)} | Roles: {roles}")

if __name__ == "__main__":
    asyncio.run(check())
