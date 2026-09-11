import asyncio
import asyncpg
from pathlib import Path
import uuid

BASE_DIR = Path(__file__).resolve().parent.parent

def load_env_db_url(env_file_path: Path) -> str:
    for line in env_file_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("DATABASE_URL="):
            val = line.split("=", 1)[1].strip().strip('"').strip("'")
            return val.replace("postgresql+asyncpg://", "postgresql://")
    return ""

async def main():
    url_y = load_env_db_url(BASE_DIR / "Yinglima_ERP" / "backend" / ".env")
    url_i = load_env_db_url(BASE_DIR / "Inhyma_ERP" / "backend" / ".env")
    
    conn_y = await asyncpg.connect(url_y, statement_cache_size=0)
    conn_i = await asyncpg.connect(url_i, statement_cache_size=0)
    
    india_id_i = await conn_i.fetchval("SELECT id FROM countries WHERE name = 'India'")
    china_id_i = await conn_i.fetchval("SELECT id FROM countries WHERE name = 'China'")
    
    india_id_y = await conn_y.fetchval("SELECT id FROM countries WHERE name = 'India'")
    china_id_y = await conn_y.fetchval("SELECT id FROM countries WHERE name = 'China'")
    
    # 1. Copy Indian States and Cities from Yinglima to Inhyma
    states_y = await conn_y.fetch("SELECT * FROM states WHERE country_id = $1", india_id_y)
    state_map = {}
    for s in states_y:
        # Check if exists in Inhyma
        sid_i = await conn_i.fetchval("SELECT id FROM states WHERE name = $1 AND country_id = $2", s["name"], india_id_i)
        if not sid_i:
            sid_i = s["id"]
            await conn_i.execute("""
                INSERT INTO states (id, country_id, name, code, status, created_at, updated_at, version)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
                ON CONFLICT (id) DO NOTHING
            """, sid_i, india_id_i, s["name"], s["code"], s["status"], s["created_at"], s["updated_at"])
            print(f"Inserted Indian state into Inhyma: {s['name']}")
        state_map[s["id"]] = sid_i
        
        # Copy cities for this state
        cities_y = await conn_y.fetch("SELECT * FROM cities WHERE state_id = $1", s["id"])
        for ct in cities_y:
            cid_i = await conn_i.fetchval("SELECT id FROM cities WHERE name = $1 AND state_id = $2", ct["name"], sid_i)
            if not cid_i:
                await conn_i.execute("""
                    INSERT INTO cities (id, country_id, state_id, name, status, created_at, updated_at, version)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
                    ON CONFLICT (id) DO NOTHING
                """, ct["id"], india_id_i, sid_i, ct["name"], ct["status"], ct["created_at"], ct["updated_at"])
                
    # 2. Chinese states mapping
    states_china_y = await conn_y.fetch("SELECT * FROM states WHERE country_id = $1", china_id_y)
    for s in states_china_y:
        sid_i = await conn_i.fetchval("SELECT id FROM states WHERE name = $1 AND country_id = $2", s["name"], china_id_i)
        if sid_i:
            state_map[s["id"]] = sid_i
            # City mapping
            cities_cy = await conn_y.fetch("SELECT * FROM cities WHERE state_id = $1", s["id"])
            for ct in cities_cy:
                city_id_i = await conn_i.fetchval("SELECT id FROM cities WHERE name = $1 AND state_id = $2", ct["name"], sid_i)
                if not city_id_i:
                    await conn_i.execute("""
                        INSERT INTO cities (id, country_id, state_id, name, status, created_at, updated_at, version)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
                        ON CONFLICT (id) DO NOTHING
                    """, ct["id"], china_id_i, sid_i, ct["name"], ct["status"], ct["created_at"], ct["updated_at"])

    # 3. Build full city map
    city_map = {}
    cities_y_all = await conn_y.fetch("SELECT id, name FROM cities")
    for ct in cities_y_all:
        ct_i = await conn_i.fetchval("SELECT id FROM cities WHERE name = $1", ct["name"])
        if ct_i:
            city_map[ct["id"]] = ct_i
            
    # 4. Copy Suppliers
    country_map = {india_id_y: india_id_i, china_id_y: china_id_i}
    sups = await conn_y.fetch("SELECT * FROM suppliers")
    cols = [k for k in sups[0].keys()]
    
    for s in sups:
        row = dict(s)
        row["country_id"] = country_map.get(row["country_id"], india_id_i)
        row["state_id"] = state_map.get(row["state_id"])
        row["city_id"] = city_map.get(row["city_id"])
        
        # Fallbacks for mandatory FKs
        if not row["state_id"]:
            row["state_id"] = await conn_i.fetchval("SELECT id FROM states WHERE country_id = $1 LIMIT 1", row["country_id"])
        if not row["city_id"]:
            row["city_id"] = await conn_i.fetchval("SELECT id FROM cities WHERE state_id = $1 LIMIT 1", row["state_id"])
            
        cols_sql = ", ".join(f'"{c}"' for c in cols)
        placeholders = ", ".join(f"${i+1}" for i in range(len(cols)))
        values = tuple(row[c] for c in cols)
        await conn_i.execute(f'INSERT INTO suppliers ({cols_sql}) VALUES ({placeholders}) ON CONFLICT (id) DO NOTHING', *values)
        print(f"Synced supplier to Inhyma: {row['company_name']}")

    # 5. Supplier category links & product links
    from datetime import datetime, timezone
    cat_links = await conn_y.fetch("SELECT * FROM supplier_category_links")
    for cl in cat_links:
        row = dict(cl)
        cols_cl = list(row.keys())
        values = []
        for c in cols_cl:
            v = row[c]
            if isinstance(v, datetime):
                v = v.replace(tzinfo=None)
            values.append(v)
        cols_sql = ", ".join(f'"{c}"' for c in cols_cl)
        placeholders = ", ".join(f"${i+1}" for i in range(len(cols_cl)))
        await conn_i.execute(f'INSERT INTO supplier_category_links ({cols_sql}) VALUES ({placeholders}) ON CONFLICT DO NOTHING', *values)

    prod_links = await conn_y.fetch("SELECT * FROM supplier_product_links")
    for pl in prod_links:
        row = dict(pl)
        cols_pl = list(row.keys())
        values = []
        for c in cols_pl:
            v = row[c]
            if isinstance(v, datetime):
                v = v.replace(tzinfo=None)
            values.append(v)
        cols_sql = ", ".join(f'"{c}"' for c in cols_pl)
        placeholders = ", ".join(f"${i+1}" for i in range(len(cols_pl)))
        await conn_i.execute(f'INSERT INTO supplier_product_links ({cols_sql}) VALUES ({placeholders}) ON CONFLICT DO NOTHING', *values)

    sup_cnt = await conn_i.fetchval("SELECT COUNT(*) FROM suppliers")
    prod_cnt = await conn_i.fetchval("SELECT COUNT(*) FROM products")
    print(f"\n[DONE] Inhyma Suppliers: {sup_cnt} | Inhyma Products: {prod_cnt}")
    
    await conn_y.close()
    await conn_i.close()

if __name__ == "__main__":
    asyncio.run(main())
