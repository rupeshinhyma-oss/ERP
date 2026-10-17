# Module Guide: Settings Masters (`settings_masters`)

**System:** Yinglima_ERP  
**Module:** System Masters & Lookup Configuration  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-12  

---

## 1. Overview & Purpose

The **Masters** group (under `SETTINGS > Masters`) manages all system lookup entities and foundational reference data used across Yinglima ERP. Instead of fragmented documents, this single master document covers all **12 Lookup Entities** highlighted in the administration sidebar.

---

## 2. The 12 Master Entities Reference Matrix

| Entity | Route | Code Files (Frontend / Backend) | Primary DB Table | Purpose & Usage in ERP |
| :--- | :--- | :--- | :--- | :--- |
| **1. Cities** | `/masters/cities` | `Cities.tsx` / `masters/cities/` | `cities` | City lookup linked to Province & Country; used in Supplier/Buyer addresses. |
| **2. Provinces / States** | `/masters/states` | `States.tsx` / `masters/states/` | `states` | First-level administrative divisions linked to Country; filters city dropdowns. |
| **3. Countries** | `/masters/countries` | `Countries.tsx` / `masters/countries/` | `countries` | National level records (China, India, UAE, etc.), dial codes, and ISO codes. |
| **4. Currencies** | `/masters/currencies` | `Currencies.tsx` / `masters/currencies/` | `currencies` | Exchange rates, currency symbols (USD $, RMB ¥, INR ₹) for costing and quotes. |
| **5. Units of Measurement (UOM)** | `/masters/uom` | `UnitsOfMeasurement.tsx` / `masters/uom/` | `units_of_measurement` | Units like PCS, CTN, SET, KGS, SQM used in product packaging and quotes. |
| **6. HSN Codes** | `/masters/hsn` | `HsnCodes.tsx` / `masters/hsn/` | `hsn_codes` | Harmonized System Tariff codes, export tax refund rates (e.g. 13% China export VAT refund). |
| **7. Categories** | `/masters/categories` | `Categories.tsx` / `masters/categories/` | `categories` | Top-level product and catalog classifications (e.g. Hardware, Furniture, Electronics). |
| **8. Sub Categories** | `/masters/subcategories` | `SubCategories.tsx` / `masters/subcategories/` | `subcategories` | Second-level product groupings strictly tied to a parent Category (cascading dropdowns). |
| **9. Brands** | `/masters/brands` | `Brands.tsx` / `masters/brands/` | `brands` | Private labels and manufacturer brands associated with catalog products. |
| **10. Supplier Types** | `/masters/supplier-types`| `SupplierTypes.tsx` / `masters/supplier_types/`| `supplier_types`| Classifications (e.g. Direct Manufacturer, Trading Company, OEM Factory, Wholesaler). |
| **11. Buyer Types** | `/masters/buyer-types` | `BuyerTypes.tsx` / `masters/buyer_types/` | `buyer_types` | Classifications (e.g. Importer, Wholesale Distributor, Retail Chain, Commission Agent). |
| **12. Organization List**| `/masters/company-list` | `CompanyList.tsx` / `masters/companies/` | `companies` | List of legal entities, operating branches, and business units across China & India. |

---

## 3. Data Flow & Cross-Module Dependencies

```
[Countries] ──> [Provinces] ──> [Cities] ──> [Supplier & Buyer Addresses]
[Categories] ──> [SubCategories] ──> [Product Master]
[Currencies] ──> [Inquiry Quotations, Local Purchases, Sales Process]
[HSN Codes] ──> [China Export VAT Refund Calculations in Sales Process]
[UOM] ──> [Packaging Specs, CBM/Carton Ratios in Planning Sheet]
```

---

## 4. What Needs to Be Verified (Testing Checklist)

- [ ] **Cascading Geographic Dropdowns:**
  - Selecting Country "China" must only list Chinese provinces (e.g. Guangdong, Zhejiang).
  - Selecting Province "Guangdong" must filter city options to Guangzhou, Shenzhen, Foshan, etc.
- [ ] **Cascading Product Categories:**
  - In Product Master, selecting a Category must immediately filter Sub Categories. Switching Category must reset invalid Sub Categories.
- [ ] **HSN Tax Refund Application:**
  - In Sales Process CI sheet, verify that selecting an HSN code correctly loads the configured VAT refund percentage.
- [ ] **Soft-Delete Protection:**
  - Attempting to delete a Country/Province/Category currently in use by active Products or Suppliers must be handled gracefully or soft-deleted without cascading data loss.

---

## 5. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Strict rules to observe when modifying any Masters table:**

1. **Foreign Key Integrity:**
   - Sub Categories must maintain strict non-null foreign key references to `categories.id`.
   - Never allow orphan subcategories.
2. **Global Autocomplete Blocker & Mouse Wheel Scroll:**
   - Number inputs (e.g. exchange rates, VAT refund percentages) must respect the project's global wheel scroll blocker (`autocompleteBlocker.ts`) so accidental scrolling does not corrupt numeric rates.
3. **Lookup Caching:**
   - Lookup endpoints (e.g. `/api/v1/lookups/currencies`, `/api/v1/lookups/categories`) are cached on the frontend via `lookups.ts`. When creating a new master record, invalidate or refetch the lookup cache so forms show the new item immediately.
