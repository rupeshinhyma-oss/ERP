# Module Guide: Product Prices & Quotation Matrix (`product_prices`)

**System:** Yinglima_ERP  
**Module:** Inventory — Product Prices (`/inventory/product-prices`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-27  

---

## 1. Overview & Purpose

The **Product Prices Directory** (`ProductPrices.tsx`) serves as the central vendor quotation catalog and price comparison engine for Yinglima ERP. Procurement officers, sales executives, and managers use this module to:
1. Maintain and compare multi-supplier price quotes (in CNY, USD, EUR, INR) across all products.
2. View normalized domestic and international currency conversions using live system FX rates.
3. Manage Minimum Order Quantities (MOQ), vendor notes, and quote validity dates.
4. Manually designate and manage company **Preferred Suppliers** independently of price discovery.
5. Launch the **Product Trade History 360° Drawer** to inspect historical PO bills, confirmed sale processes, and actual margin realizations.

---

## 2. Key Architecture & File Map

### Frontend:
* **Directory Page:** [`frontend/src/pages/ProductPrices.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/ProductPrices.tsx) (Route: `/inventory/product-prices`)
* **Trade History 360° Drawer:** [`frontend/src/components/ProductTradeHistoryDrawer.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/ProductTradeHistoryDrawer.tsx)
* **Searchable Dropdown Components:** [`frontend/src/components/SearchableDropdown.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/SearchableDropdown.tsx)

### Backend:
* **Router & Endpoints:** [`backend/app/masters/product_prices/routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/masters/product_prices/routes.py)
* **Service Layer:** [`backend/app/masters/product_prices/service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/masters/product_prices/service.py)
* **Repository & SQL CTEs:** [`backend/app/masters/product_prices/repository.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/masters/product_prices/repository.py)
* **Pydantic Schemas:** [`backend/app/masters/product_prices/schemas.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/masters/product_prices/schemas.py)
* **Database Models:** [`backend/app/suppliers/models.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/suppliers/models.py) (`supplier_product_links`), [`backend/app/masters/products/models.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/masters/products/models.py) (`products.supplier_id`)

---

## 3. Core Architectural Rule: Strict Separation Between Lowest Price & Preferred Supplier

### The Business Rationale:
In industrial procurement and international trade, **the cheapest supplier is NOT automatically the preferred supplier**. 
* A vendor quoting the lowest rate may have poor manufacturing quality, high defect rates, long lead times, severe MOQ restrictions, or unfavorable payment terms.
* Consequently, **Lowest Price** is an objective financial metric, whereas **Preferred Supplier** is an executive / operational decision.

### How the System Enforces This Separation:
1. **Objective "Best Price (Quote)" Calculation:**
   * In the main table, the **"Best Price (Quote)"** column displays the lowest active quotation for the SKU.
   * In the expandable **Supplier Quotations & Comparison** sub-table, the lowest quote is tagged with a distinct green **`LOWEST`** badge (`#16a34a`).
   * Entering a lower price quote **NEVER** automatically flips the supplier's preference status.

2. **100% Manual Preferred Supplier Control:**
   * A supplier is designated as the Preferred Supplier **ONLY** when a user explicitly performs a manual action:
     - Clicking the **`⭐ Set Preferred`** button on that supplier's row in the quotation sub-table.
     - Deliberately ticking the **`⭐ Set as Preferred Supplier for this product`** checkbox when adding or assigning a quote.
   * If the user has NOT manually chosen a preferred vendor:
     - The main row displays the lowest quote under "Best Price (Quote)".
     - The "Supplier Brand" column displays the supplier name **WITHOUT** any `⭐ Preferred` badge.
     - All suppliers in the sub-table provide a clickable **`⭐ Set Preferred`** button.
   * When a preferred supplier is set:
     - The sub-table displays a gold **`⭐ PREFERRED`** badge and an action button **`⭐ Preferred (Unset)`**.
     - Clicking **`⭐ Preferred (Unset)`** immediately removes the preference (`products.supplier_id = null`), returning the product to neutral manual mode.

3. **Safe Defaults When Adding Quotes:**
   * In the **"+ Quote" / "+ Assign" Modal**, the checkbox `⭐ Set as Preferred Supplier for this product` is **UNCHECKED by default** (`assignIsPreferred: false`).
   * In the **"+ Add Another Supplier Quote"** inline sub-table form, `subTableIsPreferred` is **UNCHECKED by default** (`false`).
   * Submitting a quote records the vendor price without altering existing company supplier preferences unless explicitly instructed.

---

## 4. REST Endpoints Reference

| Method | Endpoint | Description | Permission |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/inventory/product-prices` | Paginated product price directory with best prices and supplier count | `product.view` |
| `GET` | `/api/v1/inventory/product-prices/{product_id}/suppliers` | List all supplier quotes for an expanded product | `product.view` |
| `POST` | `/api/v1/inventory/product-prices/assign` | Insert or update a supplier-product price quote (`supplier_product_links`) | `product.update` |
| `PATCH` | `/api/v1/inventory/product-prices/{link_id}` | Inline-edit unit price, currency, MOQ, or notes | `product.update` |
| `DELETE` | `/api/v1/inventory/product-prices/{link_id}` | Delete a vendor quote link | `product.update` |
| `PUT` | `/api/v1/inventory/product-prices/{product_id}/preferred-supplier` | Manually select or clear the preferred supplier (`products.supplier_id`) | `product.update` |
| `GET` | `/api/v1/inventory/product-prices/suppliers-lookup` | Lightweight supplier dropdown lookup | `product.view` |
| `GET` | `/api/v1/inventory/product-prices/export` | Export price catalog to Excel (.xlsx) or CSV | `product.export` |
| `POST` | `/api/v1/inventory/product-prices/import` | Universal Excel bulk price quote import | `product.import` |

---

## 5. UI Features & Performance Optimizations

1. **Expandable Accordion Sub-Table:**
   * Clicking **`Compare ▾`** expands the sub-table revealing all competing vendor quotes, contact info (Call, WeChat), location, quoted price, currency, MOQ, notes, and updated date.
   * Clicking **`Close ▴`** closes the comparison sub-table.
2. **Instant Optimistic UI & In-Memory List Cache:**
   * Adding quotes, deleting quotes, inline-editing prices, or toggling preferred supplier updates the UI in **0ms** optimistically.
   * `productPriceListCache.clear()` automatically invalidates cached query pages upon price or preference modifications to ensure fresh data across filters.
3. **Inline Quick-Edit:**
   * Authorized users can click the pencil icon (`✏️`) or click the unit price in the sub-table to enter a new price, press `Enter` to commit, or `Esc` to cancel.
