import asyncio
from app.database.engine import get_engine
from sqlalchemy import text

async def check():
    engine = get_engine()
    async with engine.connect() as conn:
        res = await conn.execute(text("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'user_permissions' ORDER BY ordinal_position"))
        cols = res.fetchall()
        print("COLUMNS IN user_permissions:", cols)
        
        # Also check current alembic version in database
        v_res = await conn.execute(text("SELECT version_num FROM alembic_version"))
        print("ALEMBIC VERSION IN DB:", v_res.fetchall())

asyncio.run(check())
