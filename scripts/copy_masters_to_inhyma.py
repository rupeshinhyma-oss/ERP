"""
Sync master catalogs and product data from Yinglima_ERP to Inhyma_ERP.
"""

import asyncio
import asyncpg
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

def load_env_db_url(env_file_path: Path) -> str:
    for line in env_file_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("DATABASE_URL="):
            val = line.split("=", 1)[1].strip().strip('"').strip("'")
            return val.replace("postgresql+asyncpg://", "postgresql://")
    return ""

async def copy_table(conn_src, conn_dst, table_name: str):
    # Find common columns between src and dst
    cols_src = {r["column_name"] for r in await conn_src.fetch("""
        SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1
    """, table_name)}
    cols_dst = {r["column_name"] for r in await conn_dst.fetch("""
        SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1
    """, table_name)}
    
    common_cols = sorted(list(cols_src & cols_dst))
    cols_sql = ", ".join(f'"{c}"' for c in common_cols)
    placeholders = ", ".join(f"${i+1}" for i in range(len(common_cols)))
    
    # Read rows from src
    rows = await conn_src.fetch(f'SELECT {cols_sql} FROM "{table_name}"')
    if not rows:
        print(f"  [{table_name}] 0 rows in source (skipped)")
        return
        
    inserted = 0
    # Determine primary key or conflict target
    pk_cols = [r["column_name"] for r in await conn_dst.fetch("""
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = $1
        ORDER BY kcu.ordinal_position;
    """, table_name)]
    
    conflict_clause = "ON CONFLICT DO NOTHING"
    insert_sql = f'INSERT INTO "{table_name}" ({cols_sql}) VALUES ({placeholders}) {conflict_clause}'
    
    # Batch execute in chunks of 500
    chunk_size = 500
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i:i+chunk_size]
        data = [tuple(r[c] for c in common_cols) for r in chunk]
        res = await conn_dst.executemany(insert_sql, data)
        inserted += len(chunk)
        
    count_now = await conn_dst.fetchval(f'SELECT COUNT(*) FROM "{table_name}"')
    print(f"  [{table_name:28}] Copied {len(rows)} source rows -> Inhyma count: {count_now}")

async def main():
    url_src = load_env_db_url(BASE_DIR / "Yinglima_ERP" / "backend" / ".env")
    url_dst = load_env_db_url(BASE_DIR / "Inhyma_ERP" / "backend" / ".env")
    
    conn_src = await asyncpg.connect(url_src, statement_cache_size=0)
    conn_dst = await asyncpg.connect(url_dst, statement_cache_size=0)
    
    print("==================================================================")
    print("COPYING MASTER DATA FROM YINGLIMA_ERP TO INHYMA_ERP")
    print("==================================================================")
    
    # Add parity columns to Inhyma before copy
    pre_ddl = [
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id UUID;",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS packaging_weight NUMERIC(12, 3);",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS packaging_length NUMERIC(12, 3);",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS packaging_width NUMERIC(12, 3);",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS packaging_height NUMERIC(12, 3);",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS master_box_qty NUMERIC(12, 3);",
        "ALTER TABLE supplier_product_links ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();",
        "ALTER TABLE supplier_product_links ADD COLUMN IF NOT EXISTS currency VARCHAR(10);",
        "ALTER TABLE supplier_product_links ADD COLUMN IF NOT EXISTS unit_price NUMERIC(14, 2);",
        "ALTER TABLE supplier_product_links ADD COLUMN IF NOT EXISTS moq NUMERIC(12, 3);",
        "ALTER TABLE supplier_product_links ADD COLUMN IF NOT EXISTS notes TEXT;",
    ]
    for ddl in pre_ddl:
        await conn_dst.execute(ddl)
        
    tables_in_order = [
        "countries",
        "states",
        "cities",
        "currencies",
        "units_of_measurement",
        "hsn_codes",
        "brands",
        "product_categories",
        "product_sub_categories",
        "master_companies",
        "supplier_types",
        "buyer_types",
        "suppliers",
        "supplier_category_links",
        "supplier_sub_category_links",
        "products",
        "supplier_product_links",
    ]
    
    for t in tables_in_order:
        await copy_table(conn_src, conn_dst, t)
        
    await conn_src.close()
    await conn_dst.close()
    print("\n[COMPLETE] Master data sync completed successfully!")

if __name__ == "__main__":
    asyncio.run(main())
