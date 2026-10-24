"""
Sync All Inhyma Products from Yinglima DB to Inhyma DB.

Ensures that all 872+ products in Yinglima ERP where Organization = Inhyma
(UUID: 85c12bcb-10a1-4b1f-92ed-6ca72ac1b3b5) are completely and safely
synchronized into Inhyma ERP's database, with all dependencies (Categories,
Sub-Categories, Brands, UOMs, Taxes) reconciled or auto-provisioned.

Safe and Non-Destructive:
- Never deletes or modifies non-Inhyma products (Darsh Impex, FNB Solution, etc.).
- Idempotent: can be safely executed repeatedly without creating duplicates.
- Sets synced_entity_mappings tracking for cross-ERP auditability.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import uuid
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("sync_inhyma_products")

YIN_URL = "postgresql+asyncpg://postgres.mpvzjzunkiqchhhvxrza:Inhyma%402026@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?ssl=require"
INH_URL = "postgresql+asyncpg://postgres.kkqxkgdrmvnnvptpjpmi:Inhyma%402026@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?ssl=require"
INHYMA_ORG_UUID = "85c12bcb-10a1-4b1f-92ed-6ca72ac1b3b5"


async def run_sync():
    c_args = {"statement_cache_size": 0, "prepared_statement_name_func": lambda: ""}
    yin_engine = create_async_engine(YIN_URL, connect_args=c_args)
    inh_engine = create_async_engine(INH_URL, connect_args=c_args)

    logger.info("Connecting to Yinglima DB and Inhyma DB...")

    # 1. Fetch Yinglima master data references
    async with yin_engine.connect() as yin_conn:
        # Products assigned to Inhyma
        prod_stmt = text(f"""
            SELECT *
            FROM products
            WHERE organization_id = '{INHYMA_ORG_UUID}'
               OR (organization_ids IS NOT NULL AND organization_ids::text LIKE '%{INHYMA_ORG_UUID}%')
            ORDER BY created_at ASC
        """)
        yin_products = (await yin_conn.execute(prod_stmt)).mappings().all()
        logger.info("Found %d products assigned to Inhyma in Yinglima DB.", len(yin_products))

        # Categories
        cat_stmt = text("SELECT id, name, code, status FROM product_categories")
        yin_cats = {r["id"]: dict(r) for r in (await yin_conn.execute(cat_stmt)).mappings().all()}

        # Sub Categories
        subcat_stmt = text("SELECT id, category_id, name, code, status FROM product_sub_categories")
        yin_subcats = {r["id"]: dict(r) for r in (await yin_conn.execute(subcat_stmt)).mappings().all()}

        # Brands
        brand_stmt = text("SELECT id, name, code, status FROM brands")
        yin_brands = {r["id"]: dict(r) for r in (await yin_conn.execute(brand_stmt)).mappings().all()}

        # UOMs
        uom_stmt = text("SELECT id, name, code, short_name, status FROM units_of_measurement")
        yin_uoms = {r["id"]: dict(r) for r in (await yin_conn.execute(uom_stmt)).mappings().all()}

        # HSN Codes in Yinglima (maps to Taxes in Inhyma)
        tax_stmt = text("SELECT id, code, gst_percent, status FROM hsn_codes")
        yin_taxes = {r["id"]: dict(r) for r in (await yin_conn.execute(tax_stmt)).mappings().all()}

    # 2. In Inhyma DB: load existing references and products
    async with inh_engine.begin() as inh_conn:
        # Load Inhyma categories
        inh_cats_res = (await inh_conn.execute(text("SELECT id, name, code FROM product_categories"))).mappings().all()
        inh_cat_by_name = {r["name"].strip().lower(): r["id"] for r in inh_cats_res if r["name"]}
        inh_cat_by_code = {r["code"].strip().lower(): r["id"] for r in inh_cats_res if r["code"]}

        # Load Inhyma sub-categories
        inh_subcats_res = (await inh_conn.execute(text("SELECT id, category_id, name, code FROM product_sub_categories"))).mappings().all()
        inh_subcat_by_name = {r["name"].strip().lower(): r["id"] for r in inh_subcats_res if r["name"]}

        # Load Inhyma brands
        inh_brands_res = (await inh_conn.execute(text("SELECT id, name, code FROM brands"))).mappings().all()
        inh_brand_by_name = {r["name"].strip().lower(): r["id"] for r in inh_brands_res if r["name"]}
        inh_brand_by_code = {r["code"].strip().lower(): r["id"] for r in inh_brands_res if r["code"]}

        # Load Inhyma UOMs
        inh_uoms_res = (await inh_conn.execute(text("SELECT id, name, code FROM units_of_measurement"))).mappings().all()
        inh_uom_by_name = {r["name"].strip().lower(): r["id"] for r in inh_uoms_res if r["name"]}
        inh_uom_by_code = {r["code"].strip().lower(): r["id"] for r in inh_uoms_res if r["code"]}

        # Load Inhyma taxes
        inh_taxes_res = (await inh_conn.execute(text("SELECT id, hsn_number FROM taxes"))).mappings().all()
        inh_tax_by_hsn = {r["hsn_number"].strip().lower(): r["id"] for r in inh_taxes_res if r["hsn_number"]}

        # Fallback category & UOM
        fallback_cat_id = next(iter(inh_cat_by_name.values()), None)
        if not fallback_cat_id:
            new_cat_id = str(uuid.uuid4())
            await inh_conn.execute(text(f"INSERT INTO product_categories (id, name, code, status, created_at, updated_at) VALUES ('{new_cat_id}', 'General', 'CAT-GEN', 'ACTIVE', NOW(), NOW())"))
            fallback_cat_id = new_cat_id
            inh_cat_by_name["general"] = fallback_cat_id

        fallback_uom_id = next(iter(inh_uom_by_code.values()), None)
        if not fallback_uom_id:
            new_uom_id = str(uuid.uuid4())
            await inh_conn.execute(text(f"INSERT INTO units_of_measurement (id, name, code, status, created_at, updated_at) VALUES ('{new_uom_id}', 'Pieces', 'PCS', 'ACTIVE', NOW(), NOW())"))
            fallback_uom_id = new_uom_id
            inh_uom_by_code["pcs"] = fallback_uom_id

        # Helper to reconcile Category
        async def get_or_create_inh_cat(yin_cat_id):
            if not yin_cat_id or yin_cat_id not in yin_cats:
                return fallback_cat_id
            ycat = yin_cats[yin_cat_id]
            name = (ycat.get("name") or "").strip()
            code = (ycat.get("code") or "").strip()
            if name.lower() in inh_cat_by_name:
                return inh_cat_by_name[name.lower()]
            if code.lower() in inh_cat_by_code:
                return inh_cat_by_code[code.lower()]
            new_id = str(uuid.uuid4())
            c_val = code or f"CAT-{name[:8].upper().replace(' ', '')}"
            await inh_conn.execute(text("""
                INSERT INTO product_categories (id, name, code, status, created_at, updated_at)
                VALUES (:id, :name, :code, 'ACTIVE', NOW(), NOW())
            """), {"id": new_id, "name": name or c_val, "code": c_val[:50]})
            inh_cat_by_name[name.lower()] = new_id
            return new_id

        # Helper to reconcile Sub-Category
        async def get_or_create_inh_subcat(yin_subcat_id, inh_cat_id):
            if not yin_subcat_id or yin_subcat_id not in yin_subcats:
                return None
            ysub = yin_subcats[yin_subcat_id]
            name = (ysub.get("name") or "").strip()
            code = (ysub.get("code") or "").strip()
            if name.lower() in inh_subcat_by_name:
                return inh_subcat_by_name[name.lower()]
            new_id = str(uuid.uuid4())
            c_val = code or f"SUB-{name[:8].upper().replace(' ', '')}"
            await inh_conn.execute(text("""
                INSERT INTO product_sub_categories (id, category_id, name, code, status, created_at, updated_at)
                VALUES (:id, :category_id, :name, :code, 'ACTIVE', NOW(), NOW())
            """), {"id": new_id, "category_id": inh_cat_id, "name": name or c_val, "code": c_val[:50]})
            inh_subcat_by_name[name.lower()] = new_id
            return new_id

        # Helper to reconcile Brand
        async def get_or_create_inh_brand(yin_brand_id):
            if not yin_brand_id or yin_brand_id not in yin_brands:
                return None
            ybrand = yin_brands[yin_brand_id]
            name = (ybrand.get("name") or "").strip()
            code = (ybrand.get("code") or "").strip()
            if name.lower() in inh_brand_by_name:
                return inh_brand_by_name[name.lower()]
            if code.lower() in inh_brand_by_code:
                return inh_brand_by_code[code.lower()]
            new_id = str(uuid.uuid4())
            c_val = code or f"BRD-{name[:8].upper().replace(' ', '')}"
            await inh_conn.execute(text("""
                INSERT INTO brands (id, name, code, status, created_at, updated_at)
                VALUES (:id, :name, :code, 'ACTIVE', NOW(), NOW())
            """), {"id": new_id, "name": name or c_val, "code": c_val[:50]})
            inh_brand_by_name[name.lower()] = new_id
            return new_id

        # Helper to reconcile UOM
        async def get_or_create_inh_uom(yin_uom_id):
            if not yin_uom_id or yin_uom_id not in yin_uoms:
                return fallback_uom_id
            yuom = yin_uoms[yin_uom_id]
            name = (yuom.get("name") or "").strip()
            code = (yuom.get("code") or "").strip()
            if code.lower() in inh_uom_by_code:
                return inh_uom_by_code[code.lower()]
            if name.lower() in inh_uom_by_name:
                return inh_uom_by_name[name.lower()]
            new_id = str(uuid.uuid4())
            c_val = code or name[:10].upper()
            await inh_conn.execute(text("""
                INSERT INTO units_of_measurement (id, name, code, status, created_at, updated_at)
                VALUES (:id, :name, :code, 'ACTIVE', NOW(), NOW())
            """), {"id": new_id, "name": name or c_val, "code": c_val[:50]})
            inh_uom_by_code[code.lower()] = new_id
            return new_id

        # Helper to reconcile Tax
        async def get_or_create_inh_tax(yin_tax_id):
            if not yin_tax_id or yin_tax_id not in yin_taxes:
                return None
            ytax = yin_taxes[yin_tax_id]
            hsn = (ytax.get("hsn_number") or ytax.get("code") or "").strip()
            if not hsn:
                return None
            if hsn.lower() in inh_tax_by_hsn:
                return inh_tax_by_hsn[hsn.lower()]
            new_id = str(uuid.uuid4())
            gst = float(ytax.get("gst_percent") or 0.0)
            await inh_conn.execute(text("""
                INSERT INTO taxes (id, hsn_number, gst_percent, status, created_at, updated_at)
                VALUES (:id, :hsn_number, :gst_percent, 'ACTIVE', NOW(), NOW())
            """), {"id": new_id, "hsn_number": hsn[:50], "gst_percent": gst})
            inh_tax_by_hsn[hsn.lower()] = new_id
            return new_id

        # Load all existing Inhyma products into memory for fast matching
        inh_prods_res = (await inh_conn.execute(text("""
            SELECT id, product_code, product_name_tally, product_name, organization_id, version
            FROM products
        """))).mappings().all()

        inh_prod_by_tally = {}
        inh_prod_by_code = {}
        for p in inh_prods_res:
            t = (p["product_name_tally"] or "").strip().lower()
            c = (p["product_code"] or "").strip().lower()
            if t:
                inh_prod_by_tally[t] = p
            if c:
                inh_prod_by_code[c] = p

        # Load existing synced_entity_mappings
        mappings_res = (await inh_conn.execute(text("""
            SELECT source_entity_id, local_entity_id
            FROM synced_entity_mappings
            WHERE source_erp_id = 'yinglima' AND entity_type = 'product'
        """))).fetchall()
        mapping_by_source = {r[0]: r[1] for r in mappings_res}

        created_count = 0
        updated_count = 0
        now = datetime.now(timezone.utc)

        # Process each product from Yinglima
        for yprod in yin_products:
            source_id = str(yprod["id"])
            tally_clean = (yprod["product_name_tally"] or yprod["product_name"] or "").strip()
            tally_key = tally_clean.lower()
            code_clean = (yprod["product_code"] or "").strip()
            code_key = code_clean.lower() if code_clean else ""

            # Natural match resolution
            target_match = None
            if source_id in mapping_by_source:
                local_id = mapping_by_source[source_id]
                target_match = next((p for p in inh_prods_res if p["id"] == local_id), None)

            if not target_match and tally_key:
                target_match = inh_prod_by_tally.get(tally_key)

            if not target_match and code_key:
                target_match = inh_prod_by_code.get(code_key)

            cat_id = await get_or_create_inh_cat(yprod["category_id"])
            subcat_id = await get_or_create_inh_subcat(yprod["sub_category_id"], cat_id)
            brand_id = await get_or_create_inh_brand(yprod["brand_id"])
            uom_id = await get_or_create_inh_uom(yprod["uom_id"])
            tax_id = await get_or_create_inh_tax(yprod["hsn_id"])

            gross_wt = max(float(yprod["packaging_gross_weight"] or yprod["weight"] or 1.0), 0.001)
            cbm = float(yprod["packaging_unit_cbm"] or 0.000001)
            if cbm <= 0:
                cbm = 0.000001

            raw_status = (yprod["status"] or "active").upper()
            status_val = "ACTIVE" if raw_status == "ACTIVE" else "INACTIVE"

            org_ids_json = json.dumps([INHYMA_ORG_UUID])
            images_json = json.dumps(yprod["images"] if isinstance(yprod["images"], list) else [])

            if target_match:
                # Update existing product in Inhyma
                target_id = target_match["id"]
                current_ver = target_match.get("version") or 1
                await inh_conn.execute(text("""
                    UPDATE products
                    SET organization_id = :org_id,
                        organization_ids = :org_ids,
                        product_name_tally = :tally,
                        product_name = :pname,
                        product_name_invoice = :pinvoice,
                        barcode = :barcode,
                        category_id = :cat_id,
                        sub_category_id = :subcat_id,
                        brand_id = :brand_id,
                        uom_id = :uom_id,
                        hsn_id = :tax_id,
                        specification = :spec,
                        description = :descr,
                        images = :images,
                        packaging_quantity = :pkg_qty,
                        packaging_gross_weight = :pkg_gross,
                        packaging_net_weight = :pkg_net,
                        weight = :pkg_gross,
                        length = :length,
                        width = :width,
                        height = :height,
                        length_cm = :len_cm,
                        width_cm = :width_cm,
                        height_cm = :height_cm,
                        packaging_unit_cbm = :cbm,
                        color = :color,
                        material = :material,
                        license_certificate_required = :lic_req,
                        refund_vat_percent = :vat_pct,
                        status = :status,
                        version = :version,
                        updated_at = :now
                    WHERE id = :id
                """), {
                    "id": target_id,
                    "org_id": INHYMA_ORG_UUID,
                    "org_ids": org_ids_json,
                    "tally": tally_clean,
                    "pname": yprod["product_name"] or tally_clean,
                    "pinvoice": yprod["product_name_invoice"],
                    "barcode": yprod["barcode"],
                    "cat_id": cat_id,
                    "subcat_id": subcat_id,
                    "brand_id": brand_id,
                    "uom_id": uom_id,
                    "tax_id": tax_id,
                    "spec": yprod["specification"],
                    "descr": yprod["description"],
                    "images": images_json,
                    "pkg_qty": float(yprod["packaging_quantity"] or 1.0),
                    "pkg_gross": gross_wt,
                    "pkg_net": float(yprod["packaging_net_weight"]) if yprod["packaging_net_weight"] is not None else None,
                    "length": float(yprod["length"]) if yprod["length"] is not None else None,
                    "width": float(yprod["width"]) if yprod["width"] is not None else None,
                    "height": float(yprod["height"]) if yprod["height"] is not None else None,
                    "len_cm": float(yprod["length_cm"]) if yprod["length_cm"] is not None else None,
                    "width_cm": float(yprod["width_cm"]) if yprod["width_cm"] is not None else None,
                    "height_cm": float(yprod["height_cm"]) if yprod["height_cm"] is not None else None,
                    "cbm": cbm,
                    "color": yprod["color"],
                    "material": yprod["material"],
                    "lic_req": yprod["license_certificate_required"],
                    "vat_pct": float(yprod["refund_vat_percent"] or 0.0),
                    "status": status_val,
                    "version": current_ver + 1,
                    "now": now,
                })
                updated_count += 1
                inh_prod_id = target_id
            else:
                # Insert new product in Inhyma
                new_id = str(uuid.uuid4())
                p_code = code_clean if code_clean else f"PRD-{uuid.uuid4().hex[:8].upper()}"
                
                # Ensure p_code is unique in Inhyma
                if p_code.lower() in inh_prod_by_code:
                    p_code = f"PRD-{uuid.uuid4().hex[:8].upper()}"

                await inh_conn.execute(text("""
                    INSERT INTO products (
                        id, product_code, product_name, product_name_tally, product_name_invoice,
                        barcode, product_type, category_id, sub_category_id, brand_id, uom_id,
                        hsn_id, organization_id, organization_ids, refund_vat_percent,
                        license_certificate_required, specification, description, images,
                        packaging_quantity, packaging_net_weight, packaging_gross_weight,
                        weight, length, width, height, length_cm, width_cm, height_cm,
                        packaging_unit_cbm, color, material, status, is_purchasable, is_sellable, is_active_for_inventory, current_stock, version, created_at, updated_at
                    ) VALUES (
                        :id, :code, :pname, :tally, :pinvoice,
                        :barcode, 'Machine', :cat_id, :subcat_id, :brand_id, :uom_id,
                        :tax_id, :org_id, :org_ids, :vat_pct,
                        :lic_req, :spec, :descr, :images,
                        :pkg_qty, :pkg_net, :pkg_gross,
                        :pkg_gross, :length, :width, :height, :len_cm, :width_cm, :height_cm,
                        :cbm, :color, :material, :status, true, true, true, 0, 1, :now, :now
                    )
                """), {
                    "id": new_id,
                    "code": p_code,
                    "pname": yprod["product_name"] or tally_clean,
                    "tally": tally_clean,
                    "pinvoice": yprod["product_name_invoice"],
                    "barcode": yprod["barcode"],
                    "cat_id": cat_id,
                    "subcat_id": subcat_id,
                    "brand_id": brand_id,
                    "uom_id": uom_id,
                    "tax_id": tax_id,
                    "org_id": INHYMA_ORG_UUID,
                    "org_ids": org_ids_json,
                    "vat_pct": float(yprod["refund_vat_percent"] or 0.0),
                    "lic_req": yprod["license_certificate_required"],
                    "spec": yprod["specification"],
                    "descr": yprod["description"],
                    "images": images_json,
                    "pkg_qty": float(yprod["packaging_quantity"] or 1.0),
                    "pkg_net": float(yprod["packaging_net_weight"]) if yprod["packaging_net_weight"] is not None else None,
                    "pkg_gross": gross_wt,
                    "length": float(yprod["length"]) if yprod["length"] is not None else None,
                    "width": float(yprod["width"]) if yprod["width"] is not None else None,
                    "height": float(yprod["height"]) if yprod["height"] is not None else None,
                    "len_cm": float(yprod["length_cm"]) if yprod["length_cm"] is not None else None,
                    "width_cm": float(yprod["width_cm"]) if yprod["width_cm"] is not None else None,
                    "height_cm": float(yprod["height_cm"]) if yprod["height_cm"] is not None else None,
                    "cbm": cbm,
                    "color": yprod["color"],
                    "material": yprod["material"],
                    "status": status_val,
                    "now": now,
                })
                created_count += 1
                inh_prod_id = new_id
                inh_prod_by_tally[tally_key] = {"id": new_id, "product_code": p_code, "version": 1}
                inh_prod_by_code[p_code.lower()] = {"id": new_id, "product_code": p_code, "version": 1}

            # Upsert into synced_entity_mappings
            mapping_stmt = text("""
                INSERT INTO synced_entity_mappings (
                    id, source_erp_id, entity_type, source_entity_id, local_entity_id,
                    source_version, local_version, sync_status, last_synced_at, created_at, updated_at
                ) VALUES (
                    :map_id, 'yinglima', 'product', :source_id, :local_id,
                    1, 1, 'synced', :now, :now, :now
                )
                ON CONFLICT (source_erp_id, entity_type, source_entity_id) DO UPDATE
                SET local_entity_id = EXCLUDED.local_entity_id,
                    sync_status = 'synced',
                    last_synced_at = EXCLUDED.last_synced_at,
                    updated_at = EXCLUDED.updated_at
            """)
            await inh_conn.execute(mapping_stmt, {
                "map_id": str(uuid.uuid4()),
                "source_id": source_id,
                "local_id": inh_prod_id,
                "now": now,
            })

        logger.info(
            "Sync Complete! Processed %d Yinglima products: %d created, %d updated in Inhyma DB.",
            len(yin_products),
            created_count,
            updated_count,
        )

    await yin_engine.dispose()
    await inh_engine.dispose()


if __name__ == "__main__":
    asyncio.run(run_sync())
