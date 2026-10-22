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
   - Primary Supplier, HSN Code, GST Rate %, Refund VAT % (green badge), Standard Price, Standard Cost, Color/Material, and Purchasable/Sellable status.
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
  - Enter packaging quantity, carton dimensions (L × W × H in cm), and Gross Weight per carton.
  - Verify that CBM per carton computes automatically and formats to 6 decimal places.
- [ ] **Detail Drawer & Lightbox Zoom:**
  - Click any product row in the table. Verify the 720px side drawer opens smoothly.
  - Click on the top photo thumbnail. Verify the full-screen lightbox modal opens with the high-resolution photo.
- [ ] **Linked Lookup in Planning:**
  - Open Shipment Planning. Verify that changes to Packaging Quantity or Supplier Name in Product Master automatically propagate to linked shipment planning columns.
- [ ] **Dual Mode Import:**
  - Upload a spreadsheet in "Update Existing" mode with empty cells in optional columns. Verify existing database values are preserved intact.

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
