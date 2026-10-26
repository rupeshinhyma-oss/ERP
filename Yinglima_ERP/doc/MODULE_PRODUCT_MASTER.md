# Module Guide: Product Master & Catalog (`products`)

**System:** Yinglima_ERP  
**Module:** Products Master, Prices & Gallery (`/masters/products`, `/inventory/product-prices`, `/product-gallery`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-19  

---

## 1. Overview & Purpose

The **Product Master** module is the central repository for all physical items, packaging specifications, technical dimensions, carton capacities, CBM calculations, historical purchase prices, supplier linkages, and product gallery photography. It acts as the single source of truth for **Shipment Planning**, **Sales Process**, **Local Purchase**, and **Inquiries**.

---

## 2. Key Architecture & File Map

### Frontend:
* **Product Master List & Drawer:** [`Products.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/masters/Products.tsx) (Route: `/masters/products`)
* **Product Form Modal:** `ProductFormModal.tsx`
* **Product Prices:** [`ProductPrices.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/inventory/ProductPrices.tsx) (Route: `/inventory/product-prices`)
* **Product Gallery:** [`ProductGallery.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/inventory/ProductGallery.tsx) (Route: `/product-gallery`)

### Backend:
* **Routes & Endpoints:** [`app/products/routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/products/routes.py), `app/inventory/product_prices/routes.py`, `app/product_gallery/routes.py`
* **Service:** [`app/products/service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/products/service.py), `app/inventory/product_prices/service.py`
* **Data Models:** [`app/products/models.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/masters/products/models.py) (`products`), `product_prices`, `product_gallery`
* **Storage:** Supabase Storage (`product-media`, images, spec sheets)

---

## 3. 720px Executive Product Detail Drawer & Top Photo Lightbox

The product detail side drawer is standardized to a generous **720px executive layout** (`maxWidth: "95vw"`) matching the Buyer and Supplier master standards:

1. **Top Photo Hero Identity Card:**
   - Products with photos display a compact 124px × 124px photo thumbnail at the **very top** alongside product identity (Tally name, invoice name, status badge, code, barcode, and classification chips).
   - If multiple images exist, a mini thumbnail strip enables instant switcher preview.
   - If a product has no photo, the identity block gracefully expands across the full width without blank boxes or wasted space.
   - **Explicit Bold Labels:** Added clear labels (`🏷️ Product Code: ...`, `🧾 HSN Code: ...`, `🔢 Barcode: ...`) in the top hero badge row and drawer header subtitle so users and warehouse personnel immediately recognize every identifier without ambiguity.
2. **Click-to-Zoom Lightbox Modal:**
   - Clicking on the top photo thumbnail opens a full-screen blurred lightbox overlay displaying the high-resolution photo with an overlay close button.
3. **Operating Locations & Assigned Branches Card:**
   - Displays organization badges (`🏛️ Inhyma Group`) and all assigned operating branches (`🏢 Inhyma Ahmedabad (IA1)`), or clear `🌐 All Branches / General Distribution` badge if unrestricted.
4. **Packaging & Physical Dimensions Card:**
   - Structured 2-column grid displaying Primary UOM, Secondary UOM (with conversion factor), Packaging Quantity, Net Weight (kg), Gross Weight (kg), Dimensions (L × W × H cm), Packaging Unit CBM (formatted to 6 decimal places in bold blue `0.000000 CBM`), and MOQ.
5. **Classification, Sourcing & Tax Card:**
   - Primary Supplier, HSN Code, GST Rate %, Purchase VAT % (blue badge), Refund VAT % (green badge), Standard Price, Standard Cost, Color/Material, and Purchasable/Sellable status.
6. **Compliance, Licenses & Specifications Card:**
   - High-visibility alert banner for `license_certificate_required` and dedicated sections for technical specifications and notes.
7. **System Timestamps & Action Footer:**
   - Shows Created/Updated timestamps, `[ 📜 Trade & Price History ]` drawer launcher, and `[ ✏️ Edit Product ]` action.

---

## 4. Multi-Organization & Multi-Branch Scoping

Products support flexible organizational scoping via database fields:
* `organization_id`: Primary parent company/organization.
* `organization_ids`: JSON array of organization UUIDs authorized to distribute this product.
* `branch_ids`: JSON array of specific branch IDs authorized to plan and stock this product.

> **Logistics Impact:** The Shipment Planning module checks `organization_ids` and `branch_ids` to ensure each organization branch sheet only pulls products explicitly assigned to that location.

---

## 4.0. Dual-Mode Coexistence: Synced Products & Manually Added Products

The Product Master seamlessly supports both ingestion channels:
* **Synced Products (from Yinglima):** Machinery, tools, and procurement items synced from Yinglima via event-driven synchronization (`product.created`, `product.updated`, `product.deactivated`).
* **Manually Created Products (in Inhyma):** Local spare parts, custom modifications, and domestic items added directly via the `+ New Product` modal or Excel import.
* **Unified Querying:** Product queries operate directly against the unified `products` table without restrictive sync-mapping subqueries or hardcoded UUID blockades, ensuring newly added items appear immediately alongside synced catalog items.

---

## 4.1. Status Management & High-Speed Bulk Operations

* **Dedicated Bulk Status Endpoints:**
  * `POST /api/v1/masters/products/bulk-activate`: High-speed batch activation for selected product IDs in a single database round-trip.
  * `POST /api/v1/masters/products/bulk-deactivate`: High-speed batch deactivation ensuring all selected products have zero stock before transitioning to `inactive`.
* **Form Streamlining:**
  * The redundant `Status` select dropdown is removed from the Product creation and edit drawer form to prevent accidental status changes during standard edits.
  * New products are automatically created with `status = "active"`.
  * Status activation and deactivation are intentionally operated through the table's bulk action controls (`Bulk Activate` and `Bulk Inactive`).

---

## 5. Dual-Mode Excel/CSV Import ("Add New" vs "Update Existing")

The Product Master import engine supports dual-action modes:
* **➕ Add New Records Only (Create):** Inserts newly cataloged products; skips existing records to prevent accidental duplication.
* **✏️ Update / Modify Existing Records (Safe Enrichment):** Matches existing products by unique product code or Tally name and updates filled fields.
* **Zero Data Loss Guarantee:** Blank or empty cells in the uploaded spreadsheet are completely ignored and will **never** overwrite or erase existing database values.

---

## 6. Core Formulas & Dimension Specifications

$$\text{CBM per Carton} = \frac{\text{Length (cm)} \times \text{Width (cm)} \times \text{Height (cm)}}{1,000,000}$$
$$\text{Total Cartons} = \frac{\text{Quantity}}{\text{Packaging Quantity}}$$
$$\text{Total CBM} = \text{Total Cartons} \times \text{CBM per Carton}$$
$$\text{Total Gross Weight (kg)} = \text{Total Cartons} \times \text{Gross Weight per Carton (kg)}$$

---

## 7. What Needs to Be Verified (Testing Checklist)

- [ ] **Packaging Ratio Calculation:**
  - Enter packaging quantity (`Pkg` units per box/carton), carton dimensions (L × W × H in cm), and Gross Weight per carton.
  - Verify that CBM per carton computes automatically and formats properly.
- [ ] **Detail Drawer & Lightbox Zoom:**
  - Click any product row in the table. Verify the 720px side drawer opens smoothly.
  - Click on the top photo thumbnail. Verify the full-screen lightbox modal opens with the high-resolution photo.
- [ ] **Linked Lookup in Planning:**
  - Open Shipment Planning. Verify that changes to Packaging Quantity or Supplier Name in Product Master automatically propagate to linked shipment planning columns.
- [ ] **Dual Mode Import:**
  - Upload a spreadsheet in "Update Existing" mode with empty cells in optional columns. Verify existing database values are preserved intact.
- [ ] **HSN Code & Sub-Category Association:**
  - Pick a Category ➔ Pick a Subcategory ➔ Assign HSN code. Verify selection saves without resetting.
- [ ] **Product Prices Confidentiality:**
  - Ensure users without `product_price.view` cannot see historical vendor quote price cards or average unit purchase cost.
- [ ] **Gallery Upload:**
  - Upload image files (PNG/JPG/WEBP). Verify thumbnail and full-size modal view render correctly.
- [ ] **Cross-ERP Sync to Inhyma (`Organization = Inhyma`):**
  - Create or edit a product with `Organization = Inhyma`. Verify that the product is immediately created/updated in Inhyma ERP's Product Master with status matching active state.
  - Deactivate the product in Yinglima. Verify the corresponding product in Inhyma is automatically marked inactive.
  - Deactivate the product in Inhyma. Verify Yinglima product status remains untouched (strictly one-way).
  - Create or edit a product in Inhyma. Verify that no product or event is pushed to Yinglima.

---

## 8. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Strict rules to observe when modifying the Product Master module:**

1. **Dimensional Multipliers:**
   - Always ensure carton measurements use centimeters (cm) and volume converts by dividing by `1,000,000` to yield cubic meters ($\text{m}^3$).
2. **Costing & Price Isolation:**
   - Unmatched products in Sales Process or Planning must **NEVER** silently pull catalog prices. Sales Process must strictly default unmatched products to `$0.00 / ¥0.00`.
3. **Packaging Unit Stability:**
   - Do not allow deletion of Units of Measurement (UOM) that are actively tied to catalog items.
4. **Strict One-Way Synchronization ($Yinglima \rightarrow Inhyma$):**
   - Products sync only from Yinglima to Inhyma when `Organization = Inhyma`. Never sync back from Inhyma to Yinglima.
   - Deactivation cascades from Yinglima to Inhyma, but never from Inhyma to Yinglima.
   - Cross-ERP dispatch failures must fail open (never block the local transaction) and defer to the transactional outbox queue worker.

---

## 9. Cross-ERP One-Way Product Synchronization to Inhyma

### 6.1. Architecture & Business Rules
* **Trigger Condition:** Any product created or updated where `Organization = Inhyma` (single `organization_id` or multi-select `organization_ids` containing Inhyma's ID or slug), or any update/deactivation/deletion of a product previously synced to Inhyma.
* **Orchestrator Module:** [`app/masters/products/sync_inhyma.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/masters/products/sync_inhyma.py)
* **Lifecycle Hooks:**
  * `create_product`: triggers `sync_product_to_inhyma(db, product, event_type="product.created")`
  * `update_product`: triggers `sync_product_to_inhyma(db, product, event_type="product.updated")`
  * `activate_product`: triggers `sync_product_to_inhyma(db, product, event_type="product.updated", is_active=True)`
  * `deactivate_product`: triggers `sync_product_to_inhyma(db, product, event_type="product.deactivated", is_active=False)`
  * `delete_product`: triggers `sync_product_to_inhyma(db, product, event_type="product.deleted", is_active=False)`

### 6.2. Natural Key Translation & Inhyma Payload Mapping
Inhyma and Yinglima maintain independent relational UUID namespaces. Products are therefore transmitted with natural keys:
* `category_name` & `category_code`
* `sub_category_name` & `sub_category_code`
* `brand_name` & `brand_code`
* `uom_code` & `uom_name`
* `hsn_code`
* `length_cm`, `width_cm`, `height_cm`, `packaging_unit_cbm` (normalized)
* `packaging_gross_weight` (clamped to $\ge 0.001\text{ kg}$ to satisfy Inhyma schema checks)

### 6.3. Resilience & Fallback Mechanisms
1. **Immediate HTTP Dispatch:** Dispatches immediately to Inhyma's `/api/v1/integration/events` using `PEER_SERVICE_CREDENTIALS` / `FEDERATION_SERVICE_CREDENTIAL`.
2. **Transactional Outbox Persistence:** Every event is committed to `integration_outbox_events` and `integration_outbox_deliveries`.
3. **Async Queue Retry:** If Inhyma is sleeping, restarted, or experiencing temporary network partitions, the background worker polls and retries with exponential backoff.
4. **Auto-Provisioning in Inhyma:** Inhyma's receiver adapter automatically creates missing Categories, Sub-Categories, Brands, UOMs, and Taxes on the fly so missing foreign keys never cause sync failures.

### 6.4. Bulk Initial State Reconciliation Script
* **Script Location:** `backend/scripts/sync_all_inhyma_products.py`
* **Direct Pooler Database Connection:** Uses direct asynchronous database pooler connections with prepared statement caching disabled (`statement_cache_size=0`) to safely execute across Supabase PgBouncer instances.
* **Reconciliation Results:**
  * Total Yinglima catalog items assigned to Inhyma (`organization_id = 85c12bcb-10a1-4b1f-92ed-6ca72ac1b3b5`): **873 products**.
  * **319 products newly created** in Inhyma ERP with complete technical specs, CBM, packaging weights, and explicit Inhyma organization assignment.
  * **554 products updated** and reconciled in Inhyma ERP.
  * **873 records created** in `synced_entity_mappings` (`source_erp_id = 'yinglima'`, `entity_type = 'product'`) linking source and target UUIDs for permanent idempotent synchronization.
* **Zero Data Loss Guarantee & Strict Isolation:**
  * Darsh Impex (652 items), FNB Solution (769 items), and native domestic Indian spare parts (`INH-xxxxx`, 935 items) existing in Inhyma ERP's database were **100% preserved and untouched**. No rows were deleted or overwritten.
  * Inhyma ERP's Product Master frontend (`/product/list`) and repository query filters are scoped to `organization_id = '85c12bcb-10a1-4b1f-92ed-6ca72ac1b3b5'`, displaying both Yinglima-synced products and natively created Inhyma products while filtering out domestic spare parts (`INH-`) and other organizations.
### 6.5. Inactivation vs. Deletion Event Semantics
* **Inactivation (`status = 'inactive'`):**
  * Dispatches `event_type = "product.updated"` with `payload = {"status": "inactive", "is_active": False}`.
  * Inhyma's adapter sets `product.status = RecordStatus.INACTIVE` with `deleted_at = NULL`.
  * The product remains visible and navigable under Inhyma's **Inactive** tab (`/product/list`).
* **Reactivation (`status = 'active'`):**
  * Dispatches `event_type = "product.updated"` with `payload = {"status": "active", "is_active": True}`.
  * Inhyma's adapter sets `product.status = RecordStatus.ACTIVE`. The product immediately moves back into the **Active** tab.
* **Deletion (`DELETE /{id}`):**
  * Dispatches `event_type = "product.deleted"`.
  * Inhyma's adapter sets `deleted_at = _utcnow()` (soft-deleted), removing the product completely from both Active and Inactive catalog views.

---

## 10. Foreign Key Resilience & Supplier Link Hardening
* **Dangling Supplier Reference Prevention:**
  * When updating products that carry historic, migrated, or deleted `supplier_id` references, `ProductService._validate_references()` dynamically checks `suppliers` table existence and clears orphan IDs (`field_values["supplier_id"] = None`) rather than triggering foreign key violations.
  * `_sync_supplier_link()` guards the insertion into `supplier_product_links` by verifying the supplier exists and wrapping the database flush in a guarded handler.
  * In the edit form (`Products.tsx`), sub-categories are strictly filtered by `category_id`, preventing cross-category mismatches.

---

## 11. Bulk Action High-Speed Status Updates & Instant UI Cut-Off
* **High-Speed Single Request Endpoints:**
  * `POST /api/v1/masters/products/bulk-activate` — Single atomic query activating multiple products.
  * `POST /api/v1/masters/products/bulk-deactivate` — Single atomic query deactivating multiple products with zero-stock validation.
* **Instant 0ms UI Cut-Off:**
  * In `MasterPage.tsx`, executing **Bulk Inactive** while on the **Active** tab immediately strips the deactivated rows from the active view in 0ms, followed by background `reloadCounter` re-fetch to synchronize pagination counts and pull in succeeding page items.
  * Executing **Bulk Activate** while on the **Inactive** tab immediately cuts the activated rows from the inactive view and moves them to Active.
  * Editing an item's status in the form drawer and flipping its active/inactive state immediately removes it from the mismatched tab view.

---

## 12. Robust Media Filtering (`has_images`) & Product Gallery Performance
* **PostgreSQL Scalar Guard (`CASE WHEN json_typeof(Product.images) == 'array'`):**
  * In `ProductRepository._apply_dynamic_filters`, the `has_images` filter query previously executed `func.json_array_length(Product.images) > 0`.
  * Because PostgreSQL query optimizers evaluate `WHERE` predicates in arbitrary order and historical products can have JSON scalar strings or `null` values in `images`, calling `json_array_length()` on non-array JSON triggered `asyncpg.exceptions.InvalidParameterValueError: cannot get array length of a scalar` (HTTP 500).
  * **Solution:** Encapsulated image length computation within a SQL `case()` construct:
    ```python
    img_len = case(
        (
            and_(
                Product.images.is_not(None),
                func.json_typeof(Product.images) == "array",
            ),
            func.json_array_length(Product.images),
        ),
        else_=0,
    )
    if is_true:
        stmt = stmt.where(img_len > 0)
    else:
        stmt = stmt.where(img_len == 0)
    ```
  * Guarantees that `json_array_length` is only executed when `json_typeof(images) == 'array'`.
* **Product Gallery Integration (`ProductGallery.tsx`):**
  * When opening `/product-gallery`, the frontend fetches `GET /api/v1/masters/products?has_images=true&page_size=100&sort_by=created_at&sort_order=desc`.
  * With the safe array guard in place, this query executes in < 300ms, immediately returning products with photos without throwing 500 errors.

---

## 13. Dual VAT Architecture (`purchase_vat_percent` & `refund_vat_percent`)
* **Purchase VAT % (`purchase_vat_percent`):**
  * Stored on the `products` table as `numeric(5, 2) NOT NULL DEFAULT 0.00`.
  * When selecting an HSN code in the Product Add/Edit form modal, `purchase_vat_percent` is auto-filled from the selected HSN code's configured purchase VAT rate, while remaining freely editable for manual overrides.
  * Rendered as a prominent blue badge (`13%`) in the Executive Product Detail drawer.
  * Fully mapped in Product CSV/Excel Import (Add New & Update Existing) and Export.
* **Cross-ERP Tax Sync (`sync_inhyma.py`):**
  * When synchronizing products assigned to the Inhyma organization, the sync payload packages the HSN code, GST %, and Import Duty % (derived from Yinglima's HSN Master) alongside the product's Purchase VAT % and Refund VAT %.
  * Inhyma's product receives the complete tax profile, linking Indian Import Duty and GST seamlessly.
  * Inhyma ERP's `_resolve_tax()` adapter correctly maps `Tax.gst_percent` from `payload["gst_percent"]` and `Tax.import_duty_percent` from `payload["import_duty_percent"]`, updating existing tax records whenever Yinglima transmits revised rates.
* **Active / Inactive Status Sync Parity:**
  * When a product is deactivated in Yinglima (or reactivated to Active), the sync engine transmits the status transition.
  * In Inhyma ERP's product adapter, `product.status` is updated to `RecordStatus.INACTIVE` (or `ACTIVE`) while explicitly clearing `product.deleted_at = None`. This guarantees the product immediately displays in Inhyma's Inactive tab (or Active tab), rather than being hidden in soft-delete trash.


