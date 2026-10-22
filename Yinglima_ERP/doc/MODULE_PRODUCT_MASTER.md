# Module Guide: Product Master & Catalog (`products`)

**System:** Yinglima_ERP  
**Module:** Products Master, Prices & Gallery (`/masters/products`, `/inventory/product-prices`, `/product-gallery`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-12  

---

## 1. Overview & Purpose

The **Product Master** module is the central repository for all physical items, packaging specifications, technical dimensions, carton capacities, CBM calculations, historical purchase prices, and product gallery photography.

---

## 2. Key Architecture & File Map

### Frontend:
* **Product Master List:** `Products.tsx` (Route: `/masters/products`)
* **Product Form Modal:** `ProductFormModal.tsx`
* **Product Prices:** `ProductPrices.tsx` (Route: `/inventory/product-prices`)
* **Product Gallery:** `ProductGallery.tsx` (Route: `/product-gallery`)

### Backend:
* **Routes:** [`app/products/routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/products/routes.py), `app/inventory/product_prices/routes.py`, `app/product_gallery/routes.py`
* **Services:** `app/products/service.py`, `app/inventory/product_prices/service.py`
* **Models:** `app/products/models.py` (`products`), `product_prices`, `product_gallery`
* **Storage:** Supabase Storage (`product-media`, images, spec sheets)

---

## 3. Core Formulas & Dimension Specifications

```
CBM per Carton = (Length (cm) * Width (cm) * Height (cm)) / 1,000,000
Total Cartons = Quantity / Pkg (pieces per carton)
Total CBM = Total Cartons * CBM per Carton
Total Gross Weight (kg) = Total Cartons * Gross Weight per Carton (kg)
```

---

## 4. What Needs to Be Verified (Testing Checklist)

- [ ] **Packaging Ratio Calculation:**
  - Enter `Pkg` (units per box/carton), carton dimensions (L × W × H in cm), and Gross Weight per carton.
  - Verify that CBM per carton computes automatically and formats to 4 decimal places.
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

## 5. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Strict rules to observe when modifying the Product Master module:**

1. **Dimensional Multipliers:**
   - Always ensure carton measurements use centimeters (cm) and volume converts by dividing by `1,000,000` to yield cubic meters ($\text{m}^3$).
2. **Costing Isolation:**
   - Unmatched products in Sales Process or Planning must **NEVER** silently pull catalog prices. Sales Process must strictly default unmatched products to `$0.00 / ¥0.00`.
3. **Packaging Unit Stability:**
   - Do not allow deletion of Units of Measurement (UOM) that are actively tied to catalog items.
4. **Strict One-Way Synchronization ($Yinglima \rightarrow Inhyma$):**
   - Products sync only from Yinglima to Inhyma when `Organization = Inhyma`. Never sync back from Inhyma to Yinglima.
   - Deactivation cascades from Yinglima to Inhyma, but never from Inhyma to Yinglima.
   - Cross-ERP dispatch failures must fail open (never block the local transaction) and defer to the transactional outbox queue worker.

---

## 6. Cross-ERP One-Way Product Synchronization to Inhyma

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
1. **Immediate HTTP Dispatch:** Dispatches immediately to Inhyma's `/api/v1/integration/events` using `PEER_SERVICE_CREDENTIALS`.
2. **Transactional Outbox Persistence:** Every event is committed to `integration_outbox_events` and `integration_outbox_deliveries`.
3. **Async Queue Retry:** If Inhyma is sleeping, restarted, or experiencing temporary network partitions, the background worker polls and retries with exponential backoff.
4. **Auto-Provisioning in Inhyma:** Inhyma's receiver adapter automatically creates missing Categories, Sub-Categories, Brands, UOMs, and Taxes on the fly so missing foreign keys never cause sync failures.
