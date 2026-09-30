import asyncio
import json
import os
import sys
from datetime import datetime, date
from uuid import UUID
from decimal import Decimal
from sqlalchemy import text
from app.database.engine import get_sessionmaker

class CustomEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, (datetime, date)):
            return o.isoformat()
        if isinstance(o, UUID):
            return str(o)
        if isinstance(o, Decimal):
            return float(o)
        return super().default(o)

def sql_quote(val):
    if val is None:
        return "NULL"
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, bool):
        return "TRUE" if val else "FALSE"
    if isinstance(val, (dict, list)):
        s = json.dumps(val, cls=CustomEncoder).replace("'", "''")
        return f"'{s}'"
    s = str(val).replace("'", "''")
    return f"'{s}'"

async def main():
    print("Connecting to Supabase PostgreSQL database...")
    session_factory = get_sessionmaker()
    backup_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backups"))
    os.makedirs(backup_dir, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    sql_path = os.path.join(backup_dir, f"yinglima_backup_{timestamp}.sql")
    json_path = os.path.join(backup_dir, f"yinglima_backup_{timestamp}.json")

    async with session_factory() as session:
        # Get all table names in public schema
        res = await session.execute(text("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        """))
        tables = [r[0] for r in res.all() if r[0] != 'alembic_version']

        print(f"Found {len(tables)} tables to backup.")
        
        all_data = {}
        sql_lines = [
            f"-- Yinglima ERP Database Backup",
            f"-- Generated: {datetime.now().isoformat()}",
            f"-- Tables: {len(tables)}",
            "",
            "SET statement_timeout = 0;",
            "SET lock_timeout = 0;",
            "SET client_encoding = 'UTF8';",
            "SET standard_conforming_strings = on;",
            "",
        ]

        total_rows = 0

        for table in tables:
            # Query all rows
            row_res = await session.execute(text(f'SELECT * FROM "{table}"'))
            columns = list(row_res.keys())
            rows = row_res.fetchall()
            
            row_dicts = []
            for row in rows:
                row_dicts.append(dict(zip(columns, row)))
            
            all_data[table] = row_dicts
            total_rows += len(rows)
            print(f"  [OK] {table:<35} : {len(rows):>4} records")

            if rows:
                col_names_str = ", ".join(f'"{c}"' for c in columns)
                sql_lines.append(f"\n-- Table: {table} ({len(rows)} records)")
                for r in row_dicts:
                    vals_str = ", ".join(sql_quote(r[c]) for c in columns)
                    sql_lines.append(f'INSERT INTO "{table}" ({col_names_str}) VALUES ({vals_str}) ON CONFLICT DO NOTHING;')

    # Save SQL file
    with open(sql_path, "w", encoding="utf-8") as f:
        f.write("\n".join(sql_lines))

    # Save JSON file
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(all_data, f, cls=CustomEncoder, indent=2)

    sql_size_kb = os.path.getsize(sql_path) / 1024
    json_size_kb = os.path.getsize(json_path) / 1024

    print(f"\n==========================================")
    print(f"SUCCESS! Database backup complete:")
    print(f"  Total tables : {len(tables)}")
    print(f"  Total records: {total_rows}")
    print(f"  SQL file     : {sql_path} ({sql_size_kb:.1f} KB)")
    print(f"  JSON file    : {json_path} ({json_size_kb:.1f} KB)")
    print(f"==========================================")

if __name__ == "__main__":
    asyncio.run(main())
