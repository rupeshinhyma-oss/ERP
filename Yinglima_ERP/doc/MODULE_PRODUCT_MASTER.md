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
