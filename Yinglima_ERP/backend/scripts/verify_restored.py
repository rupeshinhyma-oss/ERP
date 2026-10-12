import asyncio
import sys
sys.path.insert(0, ".")
from sqlalchemy import text
from app.database.engine import get_sessionmaker

async def verify():
    session_maker = get_sessionmaker()
    async with session_maker() as s:
        sheets = (await s.execute(text("SELECT id, name FROM planning_sheets WHERE name IN ('Inhyma  Indore', 'Inhyma Ahmedabad', 'Inhyma Mumbai') ORDER BY name"))).fetchall()
        for sid, sname in sheets:
            print(f"\n=== Sheet: {sname} ===")
            cols = (await s.execute(text("SELECT name, position FROM planning_columns WHERE sheet_id=:sid AND deleted_at IS NULL ORDER BY position"), {"sid": sid})).fetchall()
            for cname, pos in cols:
                print(f"   pos {pos}: {cname}")
            
            cells = (await s.execute(text("""
                SELECT r.label, c.name, cell.value 
                FROM planning_cells cell
                JOIN planning_columns c ON cell.column_id=c.id
                JOIN planning_rows r ON cell.row_id=r.id
                WHERE c.sheet_id=:sid AND c.name IN ('TALLY ENTRY POSTED (Y/N)', 'APPROVAL DATE') AND cell.value IS NOT NULL AND cell.value != ''
                LIMIT 5
            """), {"sid": sid})).fetchall()
            print(f"   Sample cells ({len(cells)} shown):")
            for rlabel, cname, val in cells:
                print(f"      [{rlabel[:35]}] -> {cname} = {val}")

if __name__ == "__main__":
    asyncio.run(verify())
