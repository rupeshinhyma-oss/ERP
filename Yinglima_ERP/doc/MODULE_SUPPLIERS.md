# Module Guide: Suppliers & Vendor Directory (`suppliers`)

**System:** Yinglima_ERP  
**Module:** Supplier & Factory Management (`/suppliers`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-12  

---

## 1. Overview & Purpose

The **Suppliers** module manages the core directory of Chinese manufacturers, trading companies, and local vendors. It stores factory profiles, contact persons, WeChat IDs, bank account details for domestic RMB settlements, product categories served, quality ratings, and factory visit media attachments.

---

## 2. Key Architecture & File Map

### Frontend:
* **List Page:** [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx) (Route: `/suppliers`)
* **Detail Modal / Drawer:** `SupplierDetailDrawer.tsx` / `SupplierDetailModal.tsx`
* **Form Modal:** `SupplierFormModal.tsx` (Create & Edit)
* **Lookups:** `useSuppliersLookup()` in `src/lib/lookups.ts`

### Backend:
* **Routes:** [`app/suppliers/routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/suppliers/routes.py)
* **Service:** [`app/suppliers/service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/suppliers/service.py)
* **Schemas:** `app/suppliers/schemas.py`
* **Models:** `app/suppliers/models.py` (`suppliers`, `supplier_contacts`, `supplier_bank_accounts`)
* **Storage:** Supabase Storage (`supplier-attachments`, business cards, factory visit photos)

---

## 3. Data Flow & Cross-Module Dependencies

```
[Supplier Master]
       │
       ├──> Local Purchase: Provides supplier selection (searchable combobox)
       ├──> Inquiries & Quotations: Vendor price quotes and factory sourcing
       ├──> Shipment Planning: Vendor origin tracking and cargo readiness
       └──> Product Prices: Historical vendor purchase price logs
```

---

## 4. What Needs to Be Verified (Testing Checklist)

- [ ] **Creation & Validation:**
  - Create supplier with Company Name, Contact Person, Phone, WeChat ID, and Bank Account.
  - Verify duplicate name prevention if configured.
- [ ] **Bank & Tax Details:**
  - Enter RMB bank account number, bank branch name, and tax ID. Verify persistence.
- [ ] **Media & Visiting Cards:**
  - Upload visiting card or factory photo. Ensure preview works and Supabase link generates securely.
- [ ] **Soft-Delete & Trash Recovery:**
  - Delete a supplier. Ensure it disappears from the active directory and is available in `/trash` with restore functionality.
- [ ] **Lookup Availability in Downstream Modules:**
  - Verify that newly created suppliers immediately show up in the Local Purchase searchable dropdown without requiring server restart.

---

## 5. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Strict rules to observe when modifying the Suppliers module:**

1. **Permission Gates:**
   - Viewing requires `supplier.view`.
   - Modifying requires `supplier.update`.
   - Deleting requires `supplier.delete`.
2. **WeChat ID & Phone Formatting:**
   - China mobile numbers (11 digits) and international phone formatting must accept hyphens and spaces without input mask errors.
3. **No Hard Delete of Suppliers with Historical Purchases:**
   - Never run raw SQL `DELETE FROM suppliers`. Suppliers referenced in `local_purchases` or `planning_items` must use soft-delete (`deleted_at`) to preserve purchase history and audit trails.
