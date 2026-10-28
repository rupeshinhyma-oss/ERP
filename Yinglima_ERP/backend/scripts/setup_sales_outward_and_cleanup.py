import asyncio
import logging
from sqlalchemy import text
from app.database.engine import get_sessionmaker, dispose_engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("migration_and_cleanup")

async def main():
    sm = get_sessionmaker()
    async with sm() as session:
        logger.info("1. Adding stock_movement columns to sales_orders if not exists...")
        await session.execute(text("ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS stock_movement_id UUID REFERENCES stock_movements(id) ON DELETE SET NULL"))
        await session.execute(text("ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS stock_movement_number VARCHAR(100)"))
        await session.execute(text("CREATE INDEX IF NOT EXISTS ix_sales_orders_stock_movement_id ON sales_orders (stock_movement_id)"))
        await session.commit()
        logger.info("Columns added to sales_orders successfully.")

        logger.info("2. Clearing old test stock movements (INW-2026-0003, INW-2026-0002)...")
        # First unlink from local_purchases
        await session.execute(text("""
            UPDATE local_purchases 
            SET stock_movement_id = NULL, stock_movement_number = NULL, status = 'Confirmed'
            WHERE stock_movement_number IN ('INW-2026-0003', 'INW-2026-0002')
        """))
        
        # Delete items of these movements
        await session.execute(text("""
            DELETE FROM stock_movement_items 
            WHERE movement_id IN (
                SELECT id FROM stock_movements WHERE movement_no IN ('INW-2026-0003', 'INW-2026-0002')
            )
        """))

        # Delete the movements
        await session.execute(text("""
            DELETE FROM stock_movements WHERE movement_no IN ('INW-2026-0003', 'INW-2026-0002')
        """))

        await session.commit()
        logger.info("Stock movements cleared cleanly.")

    await dispose_engine()

if __name__ == "__main__":
    asyncio.run(main())
