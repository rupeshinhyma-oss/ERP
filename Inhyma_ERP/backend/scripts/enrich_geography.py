import asyncio
import os
import uuid
import asyncpg

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres.<PROJECT_REF>:<DB_PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require"
)

async def main():
    conn = await asyncpg.connect(DATABASE_URL, statement_cache_size=0)
    try:
        china_id = uuid.UUID('f275110a-9f79-4b1e-adb3-14ad7bb8be04')
        india_id = uuid.UUID('bf5a75c1-34e6-48ab-8a52-b537806107e0')

        # 1. Deactivate Chinese states and cities
        await conn.execute("UPDATE states SET status = 'INACTIVE' WHERE country_id = $1", china_id)
        await conn.execute("UPDATE cities SET status = 'INACTIVE' WHERE country_id = $1", china_id)
        await conn.execute("UPDATE countries SET status = 'INACTIVE' WHERE id = $1", china_id)
        print("Deactivated China records.")

        # 2. Fetch all 340 active Indian districts
        districts = await conn.fetch(
            "SELECT id, state_id, name FROM districts WHERE country_id = $1 AND status = 'ACTIVE'",
            india_id
        )
        print(f"Total active Indian districts: {len(districts)}")

        # Build district map: (state_id, name.lower()) -> district_id
        district_map = {}
        for d in districts:
            district_map[(d["state_id"], d["name"].strip().lower())] = d["id"]

        # Known aliases
        known_aliases = {
            "kalyan": "thane",
            "mumbai": "mumbai city",
            "noida": "gautam buddha nagar",
            "panaji": "north goa",
            "mapusa": "north goa",
            "margao": "south goa",
            "vasco da gama": "south goa",
            "kochi": "ernakulam",
            "hubli": "dharwad",
            "mangaluru": "dakshina kannada",
            "durgapur": "paschim bardhaman",
            "asansol": "paschim bardhaman",
            "siliguri": "darjeeling",
            "mohali": "sahibzada ajit singh nagar",
            "bihar sharif": "nalanda",
            "bengaluru": "bangalore urban",
        }

        # 3. Link existing Indian cities
        cities = await conn.fetch(
            "SELECT id, state_id, district_id, name FROM cities WHERE country_id = $1 AND status = 'ACTIVE'",
            india_id
        )
        print(f"Total active Indian cities: {len(cities)}")

        updated_count = 0
        for c in cities:
            c_name_lower = c["name"].strip().lower()
            target_district_id = district_map.get((c["state_id"], c_name_lower))
            if not target_district_id:
                alias = known_aliases.get(c_name_lower)
                if alias:
                    target_district_id = district_map.get((c["state_id"], alias))

            if target_district_id:
                await conn.execute(
                    "UPDATE cities SET district_id = $1 WHERE id = $2",
                    target_district_id, c["id"]
                )
                updated_count += 1

        print(f"Updated {updated_count} existing cities with district_id.")

        # 4. Insert default city for any district that does not yet have one
        existing_city_pairs = {
            (c["state_id"], c["name"].strip().lower()) for c in cities
        }
        created_cities = 0
        for d in districts:
            key = (d["state_id"], d["name"].strip().lower())
            if key not in existing_city_pairs:
                new_id = uuid.uuid4()
                await conn.execute(
                    """
                    INSERT INTO cities (id, country_id, state_id, district_id, name, status, created_at, updated_at, version)
                    VALUES ($1, $2, $3, $4, $5, 'ACTIVE', NOW(), NOW(), 1)
                    """,
                    new_id, india_id, d["state_id"], d["id"], d["name"].strip()
                )
                existing_city_pairs.add(key)
                created_cities += 1

        print(f"Created {created_cities} cities for districts.")

        total_cities = await conn.fetchval(
            "SELECT count(*) FROM cities WHERE country_id = $1 AND status = 'ACTIVE'",
            india_id
        )
        total_with_district = await conn.fetchval(
            "SELECT count(*) FROM cities WHERE country_id = $1 AND status = 'ACTIVE' AND district_id IS NOT NULL",
            india_id
        )
        print(f"Total active Indian cities now: {total_cities}, with district_id: {total_with_district}")

    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
