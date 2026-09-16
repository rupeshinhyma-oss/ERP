import asyncio
from app.database.engine import get_sessionmaker
from sqlalchemy import text

COLUMNS_TO_ADD = [
    ("pincode", "VARCHAR(20)"),
    ("company_category", "VARCHAR(150)"),
    ("product_manufacture_or_supply", "TEXT"),
    ("machines_buying_from", "TEXT"),
    ("spares_buying_from", "TEXT"),
    ("products_interested", "TEXT"),
    ("gst_registration_date", "VARCHAR(50)"),
    ("age_of_company", "VARCHAR(50)"),
    ("social_media", "JSON"),
]

async def migrate():
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        for col_name, col_type in COLUMNS_TO_ADD:
            sql = f"ALTER TABLE companies ADD COLUMN IF NOT EXISTS {col_name} {col_type};"
            print(f"Executing: {sql}")
            await session.execute(text(sql))
        await session.commit()
    print("Migration finished successfully.")

if __name__ == "__main__":
    asyncio.run(migrate())
