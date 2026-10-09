"""
Master Planning Migration: Clean Wipe & Seed from Official Excel Workbook.

File: D:\\Om work1\\ERP\\Yinglima_ERP\\doc\\Master Planning Sheet China TO India (66).xlsx
Populates:
- Clean Suppliers
- Clean Products (with HS Codes, UOM, Packaging Weights & CBMs)
- Clean Buyers (Inhyma branches)
- Shipment Planning Sheets:
    * GJ Branch (Inhyma Ahmedabad) -> GJ14, GJ15 + Remarks
    * MP Branch (Inhyma Indore)     -> MP -06 + Remarks
    * Mum Branch (Inhyma Mumbai)    -> Mum 45, Mum 48, Mum 48-B, Mum 49, Mum 50, Mum 51 + Remarks
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid

# Ensure backend root is on sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import openpyxl
from sqlalchemy import text, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.database.engine import get_sessionmaker
from app.core.constants import RecordStatus

import app.masters.countries.models  # noqa: F401
import app.masters.states.models  # noqa: F401
import app.masters.cities.models  # noqa: F401
import app.masters.brands.models  # noqa: F401
import app.masters.hsn.models  # noqa: F401
import app.masters.uom.models  # noqa: F401
import app.masters.product_categories.models  # noqa: F401
import app.masters.product_sub_categories.models  # noqa: F401
import app.masters.company_list.models  # noqa: F401
import app.suppliers.models  # noqa: F401
import app.buyers.models  # noqa: F401
import app.users.models  # noqa: F401
import app.organizations.models  # noqa: F401
import app.rbac.models  # noqa: F401
import app.audit.models  # noqa: F401
import app.planning.models  # noqa: F401

from app.masters.products.models import Product
from app.masters.product_categories.models import ProductCategory
from app.masters.uom.models import UnitOfMeasurement
from app.suppliers.models import Supplier
from app.buyers.models import Buyer
from app.planning.models import (
    PlanningSheet, PlanningRow, PlanningColumn, PlanningCell,
    PlanningColumnDataType
)

EXCEL_PATH = r"D:\Om work1\ERP\Yinglima_ERP\doc\Master Planning Sheet China TO India (66).xlsx"
ADMIN_USER_ID = uuid.UUID("84d1a995-261c-4c6d-94ef-7667b759c460")
INHYMA_ORG_ID = uuid.UUID("85c12bcb-10a1-4b1f-92ed-6ca72ac1b3b5")

GJ_SHEET_ID = uuid.UUID("6d59e349-ed1c-4714-bf18-e5766696933e")
MP_SHEET_ID = uuid.UUID("ad370419-d05b-489f-9bef-2613d2d3949c")

async def run_migration(target_db_url: str | None = None):
    print(f"Loading workbook: {EXCEL_PATH}...")
    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    ws_gj = wb["GJ Branch"]
    ws_mp = wb["MP Branch"]
    ws_s2 = wb["Sheet2"] if "Sheet2" in wb.sheetnames else None

    # 1. Sheet2 Metadata (HS codes, UOM, rate)
    sheet2_info = {}
    if ws_s2:
        for r in range(1, ws_s2.max_row + 1):
            name = ws_s2.cell(r, 1).value
            if not name:
                continue
            name_str = str(name).strip()
            hs = ws_s2.cell(r, 2).value
            uom = ws_s2.cell(r, 3).value
            rate = ws_s2.cell(r, 5).value
            sheet2_info[name_str.lower()] = {
                "hs_code": str(hs).strip() if hs else None,
                "uom": str(uom).strip() if uom else "NOS",
                "rate": float(rate) if rate and isinstance(rate, (int, float)) else 0.0,
            }
    print(f"Loaded {len(sheet2_info)} products metadata from Sheet2.")

    # 2. Extract GJ Branch Items
    gj_items = []
    for r in range(2, ws_gj.max_row + 1):
        desc = ws_gj.cell(r, 1).value
        if not desc or str(desc).strip() == "" or "Total" in str(desc):
            continue
        tally = ws_gj.cell(r, 2).value or desc
        gj14_qty = ws_gj.cell(r, 4).value
        gj14_rmk = ws_gj.cell(r, 5).value
        gj15_qty = ws_gj.cell(r, 6).value
        gj15_rmk = ws_gj.cell(r, 7).value
        sup_name = ws_gj.cell(r, 8).value
        sup_city = ws_gj.cell(r, 9).value
        pkg_qty = ws_gj.cell(r, 10).value
        unit_wt = ws_gj.cell(r, 11).value
        cbm = ws_gj.cell(r, 12).value

        gj_items.append({
            "description": str(desc).strip(),
            "tally_name": str(tally).strip(),
            "gj14_qty": gj14_qty,
            "gj14_rmk": str(gj14_rmk).strip() if gj14_rmk else None,
            "gj15_qty": gj15_qty,
            "gj15_rmk": str(gj15_rmk).strip() if gj15_rmk else None,
            "supplier_name": str(sup_name).strip() if sup_name else None,
            "supplier_city": str(sup_city).strip() if sup_city else None,
            "pkg_qty": float(pkg_qty) if pkg_qty and isinstance(pkg_qty, (int, float)) else 1.0,
            "unit_weight": float(unit_wt) if unit_wt and isinstance(unit_wt, (int, float)) else 0.0,
            "cbm": float(cbm) if cbm and isinstance(cbm, (int, float)) else 0.0,
        })
    print(f"Loaded {len(gj_items)} items from GJ Branch.")

    # 3. Extract MP Branch Items
    mp_items = []
    for r in range(2, ws_mp.max_row + 1):
        desc = ws_mp.cell(r, 1).value
        if not desc or str(desc).strip() == "" or "Total" in str(desc):
            continue
        mp06_qty = ws_mp.cell(r, 4).value
        mp06_rmk = ws_mp.cell(r, 5).value
        sup_name = ws_mp.cell(r, 6).value
        sup_city = ws_mp.cell(r, 7).value
        pkg_qty = ws_mp.cell(r, 8).value
        unit_wt = ws_mp.cell(r, 9).value
        cbm = ws_mp.cell(r, 10).value

        mp_items.append({
            "description": str(desc).strip(),
            "tally_name": str(desc).strip(),
            "mp06_qty": mp06_qty,
            "mp06_rmk": str(mp06_rmk).strip() if mp06_rmk else None,
            "supplier_name": str(sup_name).strip() if sup_name else None,
            "supplier_city": str(sup_city).strip() if sup_city else None,
            "pkg_qty": float(pkg_qty) if pkg_qty and isinstance(pkg_qty, (int, float)) else 1.0,
            "unit_weight": float(unit_wt) if unit_wt and isinstance(unit_wt, (int, float)) else 0.0,
            "cbm": float(cbm) if cbm and isinstance(cbm, (int, float)) else 0.0,
        })
    print(f"Loaded {len(mp_items)} items from MP Branch.")

    if target_db_url:
        connect_args = {"statement_cache_size": 0, "prepared_statement_name_func": lambda: ""}
        eng = create_async_engine(target_db_url, connect_args=connect_args)
        sm = async_sessionmaker(bind=eng, class_=AsyncSession, expire_on_commit=False)
    else:
        sm = get_sessionmaker()
    async with sm() as session:
        # Phase 1: Wiping old dummy/test records in strict order
        print("\n--- PHASE 1: Wiping old dummy/test records ---")
        wipe_stmts = [
            "DELETE FROM inquiry_messages",
            "DELETE FROM quotations",
            "DELETE FROM rfqs",
            "DELETE FROM inquiry_items",
            "DELETE FROM inquiries",
            "DELETE FROM consignment_codes",
            "DELETE FROM sales_order_items",
            "DELETE FROM sales_orders",
            "DELETE FROM local_purchase_items",
            "DELETE FROM local_purchases",
            "DELETE FROM planning_cells",
            "DELETE FROM planning_rows",
            "DELETE FROM planning_columns",
            "DELETE FROM supplier_product_links",
            "DELETE FROM supplier_emails",
            "DELETE FROM supplier_contacts",
            "DELETE FROM supplier_category_links",
            "DELETE FROM supplier_sub_category_links",
            "DELETE FROM buyer_emails",
            "DELETE FROM buyer_contacts",
            "DELETE FROM buyer_category_links",
            "DELETE FROM buyer_sub_category_links",
            "DELETE FROM products",
            "DELETE FROM suppliers",
            "DELETE FROM buyers",
        ]
        for sql in wipe_stmts:
            res = await session.execute(text(sql))
            table_name = sql.split()[-1]
            print(f"Wiped {table_name}: {res.rowcount} deleted.")
        await session.commit()
        print("Phase 1 complete: all old dummy tables wiped clean.\n")

        # Phase 2: Resolving Master Dependencies
        print("--- PHASE 2: Resolving Master Dependencies ---")
        country_res = await session.execute(text("SELECT id FROM countries WHERE LOWER(name) LIKE '%china%' LIMIT 1"))
        china_country_id = country_res.scalar()
        if not china_country_id:
            country_res = await session.execute(text("SELECT id FROM countries LIMIT 1"))
            china_country_id = country_res.scalar()

        india_res = await session.execute(text("SELECT id FROM countries WHERE LOWER(name) LIKE '%india%' LIMIT 1"))
        india_country_id = india_res.scalar() or china_country_id

        state_res = await session.execute(text(f"SELECT id FROM states WHERE country_id='{china_country_id}' LIMIT 1"))
        china_state_id = state_res.scalar()
        if not china_state_id:
            state_res = await session.execute(text("SELECT id FROM states LIMIT 1"))
            china_state_id = state_res.scalar()

        city_res = await session.execute(text("SELECT id, LOWER(name) FROM cities"))
        city_map = {name: cid for cid, name in city_res.fetchall()}
        default_city_id = city_map.get("wenzhou") or list(city_map.values())[0]

        # Categories
        cat_res = await session.execute(select(ProductCategory))
        categories = cat_res.scalars().all()
        cat_map = {c.name.lower(): c.id for c in categories}
        pkg_cat_id = cat_map.get("packaging machines") or list(cat_map.values())[0]
        spare_cat_id = cat_map.get("packaging machine spares") or cat_map.get("spare parts") or list(cat_map.values())[0]
        mat_cat_id = cat_map.get("material handling equipments") or pkg_cat_id

        # UOMs
        uom_res = await session.execute(select(UnitOfMeasurement))
        uoms = uom_res.scalars().all()
        uom_map = {u.code.upper(): u.id for u in uoms}
        default_uom_id = uom_map.get("NOS") or uom_map.get("PCS") or list(uom_map.values())[0]
        pcs_uom_id = uom_map.get("PCS") or default_uom_id

        # Phase 3: Seed Clean Suppliers
        print("\n--- PHASE 3: Seeding Clean Suppliers ---")
        unique_suppliers = {}
        for it in gj_items + mp_items:
            s_name = it.get("supplier_name")
            if s_name:
                clean_s = s_name.strip()
                if clean_s.lower() not in unique_suppliers:
                    unique_suppliers[clean_s.lower()] = {
                        "name": clean_s,
                        "city": it.get("supplier_city") or "Wenzhou",
                    }

        supplier_db_map = {}
        for k, sinfo in unique_suppliers.items():
            city_id = city_map.get(sinfo["city"].lower()) or default_city_id
            sup = Supplier(
                company_name=sinfo["name"][:250],
                country_id=china_country_id,
                state_id=china_state_id,
                city_id=city_id,
                supplier_type="manufacturer",
            )
            session.add(sup)
            await session.flush()
            supplier_db_map[k] = sup.id
            supplier_db_map[sinfo["name"]] = sup.id

        await session.commit()
        print(f"Seeded {len(supplier_db_map)//2} clean suppliers.")

        # Phase 4: Seed Clean Products
        print("\n--- PHASE 4: Seeding Clean Products ---")
        unique_products = {}
        for it in gj_items + mp_items:
            p_desc = it["description"]
            p_key = p_desc.lower()
            if p_key not in unique_products:
                unique_products[p_key] = it

        product_db_map = {}
        counter = 1
        for p_key, it in unique_products.items():
            p_desc = it["description"]
            p_code = f"DAR-{counter:05d}"
            counter += 1

            # Detect category
            is_spare = any(kw in p_key for kw in ["spare", "part", "roller", "blade", "heater", "wheel", "transformer", "sensor", "cutter", "plate", "switch"])
            is_material = any(kw in p_key for kw in ["scissor", "pallet", "stacker", "hpt", "forklift", "truck"])

            if is_spare:
                cat_id = spare_cat_id
                uom_id = pcs_uom_id
            elif is_material:
                cat_id = mat_cat_id
                uom_id = default_uom_id
            else:
                cat_id = pkg_cat_id
                uom_id = default_uom_id

            s2_meta = sheet2_info.get(p_key)
            hs_code_str = s2_meta.get("hs_code") if s2_meta else ("8422.90.90" if is_spare else "8422.30.90")

            s_name = it.get("supplier_name")
            s_id = supplier_db_map.get(s_name.lower()) if s_name else None

            prod = Product(
                product_code=p_code,
                product_name=p_desc[:250],
                product_name_tally=(it.get("tally_name") or p_desc)[:250],
                product_name_invoice=p_desc[:250],
                barcode=hs_code_str[:100] if hs_code_str else None,
                category_id=cat_id,
                uom_id=uom_id,
                supplier_id=s_id,
                packaging_quantity=it.get("pkg_qty") or 1.0,
                packaging_gross_weight=it.get("unit_weight") or 1.0,
                weight=it.get("unit_weight") or 1.0,
                packaging_unit_cbm=it.get("cbm") or 0.01,
            )
            session.add(prod)
            await session.flush()
            product_db_map[p_key] = prod.id
            product_db_map[p_desc] = prod.id

        await session.commit()
        print(f"Seeded {len(unique_products)} clean products into Product Master.")

        # Phase 5: Seed Buyers
        print("\n--- PHASE 5: Seeding Clean Buyers ---")
        buyer_names = [
            ("Inhyma Ahmedabad (GJ Branch)", "Ahmedabad"),
            ("Inhyma Indore (MP Branch)", "Indore"),
            ("Inhyma Mumbai (Mum Branch)", "Mumbai"),
            ("Darsh Impex Mumbai", "Mumbai"),
        ]
        buyer_db_map = {}
        for b_name, b_city in buyer_names:
            buyer = Buyer(
                company_name=b_name,
                country_id=india_country_id,
                city=b_city,
            )
            session.add(buyer)
            await session.flush()
            buyer_db_map[b_name] = buyer.id
        await session.commit()
        print(f"Seeded {len(buyer_names)} clean buyers.")

        # Phase 6: Populate Planning Sheets (GJ, MP, MUM)
        print("\n--- PHASE 6: Populating Shipment Planning Sheets ---")

        # 6A. GJ Branch Sheet
        sheet_gj = await session.get(PlanningSheet, GJ_SHEET_ID)
        if not sheet_gj:
            sheet_gj = PlanningSheet(
                id=GJ_SHEET_ID,
                name="Inhyma Ahmedabad",
                organization_id=INHYMA_ORG_ID,
                branch_id="br_1786607390334_uitw",
                mum_group_label="GJ",
                created_by=ADMIN_USER_ID,
            )
            session.add(sheet_gj)
        else:
            sheet_gj.name = "Inhyma Ahmedabad"
            sheet_gj.mum_group_label = "GJ"
            sheet_gj.branch_id = "br_1786607390334_uitw"
        await session.flush()

        gj_cols_def = [
            ("GJ14", PlanningColumnDataType.NUMBER, 0),
            ("GJ14 Remark", PlanningColumnDataType.TEXT, 1),
            ("GJ15", PlanningColumnDataType.NUMBER, 2),
            ("GJ15 Remark", PlanningColumnDataType.TEXT, 3),
            ("Supplier Name", PlanningColumnDataType.TEXT, 4),
            ("Supplier City", PlanningColumnDataType.TEXT, 5),
            ("PKG QTY", PlanningColumnDataType.NUMBER, 6),
            ("UNIT WEIGHT/PKG (KG)", PlanningColumnDataType.NUMBER, 7),
            ("CBM/PKG (KG)", PlanningColumnDataType.NUMBER, 8),
        ]
        gj_col_objs = {}
        for c_name, c_type, c_pos in gj_cols_def:
            col = PlanningColumn(
                sheet_id=GJ_SHEET_ID,
                name=c_name,
                data_type=c_type,
                position=c_pos,
                created_by=ADMIN_USER_ID,
            )
            session.add(col)
            await session.flush()
            gj_col_objs[c_name] = col.id

        gj_cell_count = 0
        seen_pids_gj = set()
        for pos, it in enumerate(gj_items):
            pid = product_db_map.get(it["description"].lower())
            if pid in seen_pids_gj:
                linked_id = None
            else:
                linked_id = pid
                if pid:
                    seen_pids_gj.add(pid)
            row = PlanningRow(
                sheet_id=GJ_SHEET_ID,
                label=it["description"][:500],
                position=pos,
                linked_record_id=linked_id,
                created_by=ADMIN_USER_ID,
            )
            session.add(row)
            await session.flush()

            cells_to_add = [
                (gj_col_objs["GJ14"], str(it["gj14_qty"]) if it["gj14_qty"] is not None else ""),
                (gj_col_objs["GJ14 Remark"], it["gj14_rmk"] or ""),
                (gj_col_objs["GJ15"], str(it["gj15_qty"]) if it["gj15_qty"] is not None else ""),
                (gj_col_objs["GJ15 Remark"], it["gj15_rmk"] or ""),
                (gj_col_objs["Supplier Name"], it["supplier_name"] or ""),
                (gj_col_objs["Supplier City"], it["supplier_city"] or ""),
                (gj_col_objs["PKG QTY"], str(it["pkg_qty"]) if it["pkg_qty"] else "1"),
                (gj_col_objs["UNIT WEIGHT/PKG (KG)"], str(it["unit_weight"]) if it["unit_weight"] else "0"),
                (gj_col_objs["CBM/PKG (KG)"], str(it["cbm"]) if it["cbm"] else "0"),
            ]
            for col_id, val in cells_to_add:
                if val != "":
                    cell = PlanningCell(
                        row_id=row.id,
                        column_id=col_id,
                        value=val,
                    )
                    session.add(cell)
                    gj_cell_count += 1
        await session.commit()
        print(f"Populated GJ Branch: {len(gj_items)} rows, 9 columns, {gj_cell_count} cells.")

        # 6B. MP Branch Sheet
        sheet_mp = await session.get(PlanningSheet, MP_SHEET_ID)
        if not sheet_mp:
            sheet_mp = PlanningSheet(
                id=MP_SHEET_ID,
                name="Inhyma  Indore",
                organization_id=INHYMA_ORG_ID,
                branch_id="br_1786607543358_ugll",
                mum_group_label="MP",
                created_by=ADMIN_USER_ID,
            )
            session.add(sheet_mp)
        else:
            sheet_mp.name = "Inhyma  Indore"
            sheet_mp.mum_group_label = "MP"
            sheet_mp.branch_id = "br_1786607543358_ugll"
        await session.flush()

        mp_cols_def = [
            ("MP -06", PlanningColumnDataType.NUMBER, 0),
            ("MP-06 Remarks", PlanningColumnDataType.TEXT, 1),
            ("Supplier Name", PlanningColumnDataType.TEXT, 2),
            ("Supplier City", PlanningColumnDataType.TEXT, 3),
            ("PKG QTY", PlanningColumnDataType.NUMBER, 4),
            ("UNIT WEIGHT/PKG (KG)", PlanningColumnDataType.NUMBER, 5),
            ("CBM/PKG (KG)", PlanningColumnDataType.NUMBER, 6),
        ]
        mp_col_objs = {}
        for c_name, c_type, c_pos in mp_cols_def:
            col = PlanningColumn(
                sheet_id=MP_SHEET_ID,
                name=c_name,
                data_type=c_type,
                position=c_pos,
                created_by=ADMIN_USER_ID,
            )
            session.add(col)
            await session.flush()
            mp_col_objs[c_name] = col.id

        mp_cell_count = 0
        seen_pids_mp = set()
        for pos, it in enumerate(mp_items):
            pid = product_db_map.get(it["description"].lower())
            if pid in seen_pids_mp:
                linked_id = None
            else:
                linked_id = pid
                if pid:
                    seen_pids_mp.add(pid)
            row = PlanningRow(
                sheet_id=MP_SHEET_ID,
                label=it["description"][:500],
                position=pos,
                linked_record_id=linked_id,
                created_by=ADMIN_USER_ID,
            )
            session.add(row)
            await session.flush()

            cells_to_add = [
                (mp_col_objs["MP -06"], str(it["mp06_qty"]) if it["mp06_qty"] is not None else ""),
                (mp_col_objs["MP-06 Remarks"], it["mp06_rmk"] or ""),
                (mp_col_objs["Supplier Name"], it["supplier_name"] or ""),
                (mp_col_objs["Supplier City"], it["supplier_city"] or ""),
                (mp_col_objs["PKG QTY"], str(it["pkg_qty"]) if it["pkg_qty"] else "1"),
                (mp_col_objs["UNIT WEIGHT/PKG (KG)"], str(it["unit_weight"]) if it["unit_weight"] else "0"),
                (mp_col_objs["CBM/PKG (KG)"], str(it["cbm"]) if it["cbm"] else "0"),
            ]
            for col_id, val in cells_to_add:
                if val != "":
                    cell = PlanningCell(
                        row_id=row.id,
                        column_id=col_id,
                        value=val,
                    )
                    session.add(cell)
                    mp_cell_count += 1
        await session.commit()
        print("\n=== ALL MASTER DATA AND PLANNING SHEETS (GJ & MP) MIGRATED SUCCESSFULLY! ===")

if __name__ == "__main__":
    db_url = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("TARGET_DATABASE_URL")
    asyncio.run(run_migration(db_url))
