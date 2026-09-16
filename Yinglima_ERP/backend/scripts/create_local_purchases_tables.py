"""Create local_purchases and local_purchase_items database tables."""
import asyncio
from app.database.engine import get_engine
from app.database.base import Base
import app.users.models
import app.suppliers.models
import app.masters.company_list.models
import app.masters.products.models
import app.purchases.local.models

async def main():
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Tables local_purchases and local_purchase_items created successfully.")

if __name__ == "__main__":
    asyncio.run(main())
