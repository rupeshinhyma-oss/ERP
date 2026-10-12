import asyncio
import os
import uuid
import openpyxl
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

EXCEL_PATH = r"D:\Om work1\ERP\Yinglima_ERP\doc\Master Planning Sheet China TO India (66).xlsx"

DB_URLS = [
    ("mpvzjzunkiqchhhvxrza (backend/.env)", "postgresql+asyncpg://postgres.mpvzjzunkiqchhhvxrza:Inhyma%402026@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?ssl=require"),
    ("ohjxbikcnlihiftodspe", "postgresql+asyncpg://postgres.ohjxbikcnlihiftodspe:s8idqqiYOX9oAZwk@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?ssl=require"),
]

connect_args = {"statement_cache_size": 0, "prepared_statement_name_func": lambda: ""}

async def restore_columns():
    print(f"Loading Excel file: {EXCEL_PATH}...")
    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    ws_mp = wb["MP Branch"]
    ws_gj = wb["GJ Branch"]
    ws_mum = wb["Mum Branch"] if "Mum Branch" in wb.sheetnames else None

    # 1. Parse MP Branch data
    # Col 1: Description, Col 2: TALLY ENTRY POSTED (Y/N), Col 3: APPROVAL DATE
    mp_excel_data = {}
    for r in range(2, ws_mp.max_row + 1):
        desc = ws_mp.cell(r, 1).value
        if not desc or "Total" in str(desc):
            continue
        k = str(desc).strip().lower()
        tally = ws_mp.cell(r, 2).value
        appr = ws_mp.cell(r, 3).value
        mp_excel_data[k] = {
            "tally": str(tally).strip() if tally is not None else None,
            "approval_date": str(appr).strip() if appr is not None else None,
        }
    print(f"Loaded {len(mp_excel_data)} MP items from Excel.")

    # 2. Parse GJ Branch data
    # Col 1: Item Description, Col 2: Tally Name, Col 3: TALLY ENTRY POSTED (Y/N)
    gj_excel_data = {}
    for r in range(2, ws_gj.max_row + 1):
        desc = ws_gj.cell(r, 1).value
        if not desc or "Total" in str(desc):
            continue
        k = str(desc).strip().lower()
        tally = ws_gj.cell(r, 3).value
        gj_excel_data[k] = {
            "tally": str(tally).strip() if tally is not None else None,
            "approval_date": None,
        }
    print(f"Loaded {len(gj_excel_data)} GJ items from Excel.")

    # 3. Parse Mum Branch data if available
    # Col 1: Item Description, Col 2: TALLY ENTRY POSTED (Y/N)
    mum_excel_data = {}
    if ws_mum:
        for r in range(2, ws_mum.max_row + 1):
            desc = ws_mum.cell(r, 1).value
            if not desc or "Total" in str(desc):
                continue
            k = str(desc).strip().lower()
            tally = ws_mum.cell(r, 2).value
            mum_excel_data[k] = {
                "tally": str(tally).strip() if tally is not None else None,
                "approval_date": None,
            }
        print(f"Loaded {len(mum_excel_data)} Mum items from Excel.")

    for db_label, db_url in DB_URLS:
        print(f"\n=======================================================")
        print(f"Applying restore to: {db_label}")
        print(f"=======================================================")
        eng = create_async_engine(db_url, connect_args=connect_args)

        async with eng.begin() as conn:
            # Get admin user ID
            admin_row = (await conn.execute(text("SELECT id FROM users LIMIT 1"))).fetchone()
            admin_id = str(admin_row[0]) if admin_row else "84d1a995-261c-4c6d-94ef-7667b759c460"

            # Fetch active sheets
            sheets = (await conn.execute(text("SELECT id, name FROM planning_sheets WHERE deleted_at IS NULL"))).fetchall()

            for sheet_id, sheet_name in sheets:
                s_id_str = str(sheet_id)
                s_name_lower = sheet_name.lower()
                print(f"\nProcessing Sheet: '{sheet_name}' (ID: {s_id_str})...")

                # Determine which dataset to use for this sheet
                if "indore" in s_name_lower or "mp" in s_name_lower:
                    sheet_data = mp_excel_data
                elif "ahmedabad" in s_name_lower or "gj" in s_name_lower:
                    sheet_data = gj_excel_data
                elif "mumbai" in s_name_lower:
                    sheet_data = mum_excel_data
                else:
                    sheet_data = None

                # Check existing columns
                existing_cols = (await conn.execute(
                    text("SELECT id, name, position FROM planning_columns WHERE sheet_id = :sid AND deleted_at IS NULL ORDER BY position"),
                    {"sid": sheet_id}
                )).fetchall()

                col_map = {c[1]: {"id": str(c[0]), "pos": c[2]} for c in existing_cols}

                has_tally = "TALLY ENTRY POSTED (Y/N)" in col_map or "TEST(Y/N)" in col_map
                has_appr = "APPROVAL DATE" in col_map

                # If columns don't exist, we will add them and shift existing columns
                cols_to_add = []
                if not has_tally:
                    cols_to_add.append("TALLY ENTRY POSTED (Y/N)")
                if not has_appr:
                    cols_to_add.append("APPROVAL DATE")

                shift_amount = len(cols_to_add)

                if shift_amount > 0:
                    print(f"  Adding {cols_to_add} and shifting existing {len(existing_cols)} columns by +{shift_amount} positions...")
                    # Shift existing columns by shift_amount
                    await conn.execute(
                        text("UPDATE planning_columns SET position = position + :shift WHERE sheet_id = :sid AND deleted_at IS NULL"),
                        {"shift": shift_amount, "sid": sheet_id}
                    )

                    # Insert missing columns at pos 0 and 1
                    current_insert_pos = 0
                    for col_name in cols_to_add:
                        new_col_id = str(uuid.uuid4())
                        await conn.execute(
                            text("""
                                INSERT INTO planning_columns (
                                    id, sheet_id, name, data_type, source_type, position,
                                    enable_description, auto_populate_enabled, enable_status_color,
                                    created_by, created_at, updated_at
                                ) VALUES (
                                    :id, :sheet_id, :name, 'text', 'manual', :position,
                                    false, false, false,
                                    :created_by, NOW(), NOW()
                                )
                            """),
                            {
                                "id": new_col_id,
                                "sheet_id": sheet_id,
                                "name": col_name,
                                "position": current_insert_pos,
                                "created_by": admin_id,
                            }
                        )
                        col_map[col_name] = {"id": new_col_id, "pos": current_insert_pos}
                        current_insert_pos += 1
                        print(f"  Created column '{col_name}' at position {current_insert_pos - 1}.")
                else:
                    print(f"  Columns already exist on '{sheet_name}'.")

                # Resolve column IDs for inserting cell values
                tally_col_id = (col_map.get("TALLY ENTRY POSTED (Y/N)") or col_map.get("TEST(Y/N)"))["id"] if ("TALLY ENTRY POSTED (Y/N)" in col_map or "TEST(Y/N)" in col_map) else None
                appr_col_id = col_map.get("APPROVAL DATE")["id"] if "APPROVAL DATE" in col_map else None

                # Now match rows and populate cell values
                if sheet_data and (tally_col_id or appr_col_id):
                    # Fetch all rows for this sheet
                    rows = (await conn.execute(
                        text("SELECT id, label FROM planning_rows WHERE sheet_id = :sid AND deleted_at IS NULL"),
                        {"sid": sheet_id}
                    )).fetchall()

                    cells_inserted = 0
                    cells_updated = 0

                    for r_id, r_label in rows:
                        r_id_str = str(r_id)
                        k = (r_label or "").strip().lower()
                        item_vals = sheet_data.get(k)
                        if not item_vals:
                            continue

                        val_tally = item_vals.get("tally")
                        val_appr = item_vals.get("approval_date")

                        target_cells = []
                        if tally_col_id and val_tally:
                            target_cells.append((tally_col_id, val_tally))
                        if appr_col_id and val_appr:
                            target_cells.append((appr_col_id, val_appr))

                        for col_id_target, cell_val in target_cells:
                            # Upsert cell
                            existing_cell = (await conn.execute(
                                text("SELECT id FROM planning_cells WHERE row_id = :rid AND column_id = :cid"),
                                {"rid": r_id, "cid": col_id_target}
                            )).fetchone()

                            if existing_cell:
                                await conn.execute(
                                    text("UPDATE planning_cells SET value = :val, updated_at = NOW() WHERE id = :cid"),
                                    {"val": cell_val, "cid": existing_cell[0]}
                                )
                                cells_updated += 1
                            else:
                                await conn.execute(
                                    text("""
                                        INSERT INTO planning_cells (
                                            id, row_id, column_id, value, created_at, updated_at
                                        ) VALUES (
                                            :id, :rid, :cid, :val, NOW(), NOW()
                                        )
                                    """),
                                    {
                                        "id": str(uuid.uuid4()),
                                        "rid": r_id,
                                        "cid": col_id_target,
                                        "val": cell_val,
                                    }
                                )
                                cells_inserted += 1

                    print(f"  Data sync for '{sheet_name}': {cells_inserted} cells inserted, {cells_updated} cells updated.")

        print(f"\nDone restoring on {db_label}.")

if __name__ == "__main__":
    asyncio.run(restore_columns())
