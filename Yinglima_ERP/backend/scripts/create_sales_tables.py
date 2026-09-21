"""Create sales_orders and sales_order_items database tables."""
import asyncio
from app.database.engine import get_engine
from app.database.base import Base
import app.users.models
import app.buyers.models
import app.planning.models
import app.masters.products.models
import app.sales.models

async def main():
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Tables sales_orders and sales_order_items created successfully.")

if __name__ == "__main__":
    asyncio.run(main())
