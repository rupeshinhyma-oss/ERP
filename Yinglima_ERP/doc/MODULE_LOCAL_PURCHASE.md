# Module Guide: Local Purchase (`local_purchase`)

**System:** Yinglima_ERP  
**Module:** Local Procurement & Purchases (`/purchases/local`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-12  

---

## 1. Overview & Purpose

The **Local Purchase** module allows China operations to record domestic procurement orders, manage supplier invoices/bills, track line items, calculate totals, handle taxes, and export purchase orders. It bridges domestic Chinese procurement with international shipment planning.

---

## 2. Key Architecture & File Map

### Frontend:
* **Form & Editing:** [`LocalPurchaseForm.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchaseForm.tsx) (Route: `/purchases/local/new`, `/purchases/local/:id/edit`)
* **List Page:** [`LocalPurchases.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchases.tsx) (Route: `/purchases/local`)
* **Detail Modal:** [`LocalPurchaseDetailModal.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchaseDetailModal.tsx)
* **Searchable Combobox:** [`SearchableDropdown.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/SearchableDropdown.tsx)

### Backend:
* **Service:** [`service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/purchases/local/service.py)
* **Schemas:** [`schemas.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/purchases/local/schemas.py)
* **Storage Utility:** [`storage.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/common/storage.py)
* **Routes:** `app/purchases/local/routes.py`
* **Models:** `app/purchases/local/models.py` (`local_purchases`, `local_purchase_items`)

---

## 3. What Was Changed / Updated

### Release 2026-10-13: Latency & Form Optimization
1. **Lookup Endpoint Normalization:**
   - Standardized supplier lookup URL from `/suppliers?page_size=1000` to `/suppliers`, enabling global lookup caching and avoiding heavy unpaginated payload transfers.
2. **Parallelized Line Item Quote Fetching:**
   - Product pricing lookups for unquoted items (`/inventory/product-prices/{id}/suppliers`) now run concurrently using `Promise.all` and update component state in a single batch, reducing form load latency to 269 ms.

### Release 2026-10-12: Supplier Searchable Combobox & Cloud Storage
1. **Supplier Searchable Combobox (Type-Ahead):**
   - Replaced static HTML `<select>` with interactive `SearchableDropdown`.
   - Users can type any partial name (e.g. "San", "LT") to filter suppliers in real time.
   - Supports keyboard navigation (Arrow Up, Down, Enter, Escape) and quick clear (`✕`).
   - Keeps standard red error validation border if submitted empty.
2. **Bill Document Cloud Storage (Supabase):**
   - Added cloud storage upload for invoice documents (`invoice_file_path`, `invoice_file_name`) targeting Supabase Storage.
   - Added direct file download actions in both the Form and the Detail Modal.
3. **Bill Extraction Auto-Fill Integration:**
   - When the user clicks **⚡ Extract Bill Data**, any supplier identified by the AI extractor automatically matches against the supplier directory and pre-populates the type-ahead search bar.

---

## 4. What Needs to Be Verified (Testing Checklist)

When touching this module, always verify the following:

- [ ] **Supplier Selection & Filtering:**
  - Open `/purchases/local/new`.
  - Type 2–3 letters into the Supplier box. Suggestions must filter dynamically.
  - Press Down Arrow + Enter. The supplier must select properly and display their name.
- [ ] **Validation on Submit:**
  - Submit the form without picking a supplier. A red border and error message must appear.
  - Picking a supplier must immediately clear the error.
- [ ] **Line Items & Calculation:**
  - Add at least 2 line items with Quantity, Unit Price, and Tax rate.
  - Verify Subtotal, Total Tax, and Grand Total update instantaneously without NaN or rounding errors.
- [ ] **Bill Document Upload & Download:**
  - Attach an invoice PDF or image.
  - Save the purchase order.
  - Open the Detail Modal (`LocalPurchaseDetailModal.tsx`) and click the download button. The original invoice must download cleanly.
- [ ] **Edit Mode Pre-Fill:**
  - Open an existing purchase order for editing (`/purchases/local/:id/edit`).
  - Verify the supplier name is pre-populated in the search bar, not blank or showing an empty ID.
- [ ] **Permission Gates:**
  - Users with `local_purchase.view` can browse and view orders.
  - Users lacking `local_purchase.create` or `local_purchase.update` must not see the Save or Edit buttons.

---

## 5. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Do NOT alter or remove the following core behaviors under any circumstances:**

1. **Dual State Synchronization (`supplierId` + `supplierName`):**
   - Both `supplier_id` (UUID) and `supplier_name` (string) must be preserved in state and submitted together. Downstream reports and exports rely on `supplier_name` being immediately available without join latency.
2. **No Fallback Costing to Master Product Prices:**
   - In Sales Process and Shipment Planning, unmatched local purchase products must strictly evaluate to `$0.00 / ¥0.00` and **never silently fall back** to the global product catalog price.
3. **Soft-Delete Cascade:**
   - Deleting a Local Purchase must soft-delete its child `local_purchase_items` rows (`deleted_at IS NOT NULL`). Hard-deleting rows directly via SQL breaks trash recovery.
4. **Storage URL Handling:**
   - When downloading an invoice file, ensure the Supabase signed URL generation handles spaces and Unicode filenames safely via `encodeURIComponent` or backend proxy.
5. **No Auto-Submit on Enter:**
   - Selecting a supplier from the dropdown via keyboard `Enter` must NOT prematurely submit the entire purchase order form. `e.preventDefault()` must remain on dropdown key handlers.
