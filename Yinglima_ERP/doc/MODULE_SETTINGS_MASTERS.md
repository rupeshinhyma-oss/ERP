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
| **6. HSN Codes** | `/masters/hsn` | `Hsn.tsx` / `masters/hsn/` | `hsn_codes` | Harmonized System Tariff codes: GST %, Indian Import Duty %, China Purchase VAT %, and China Export VAT Refund %. |
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
[HSN Codes] ──> [Import Duty & GST synced to Inhyma; Purchase VAT & Refund VAT in Product Master]
[UOM] ──> [Packaging Specs, CBM/Carton Ratios in Planning Sheet]
```

---

## 4. HSN Master Multi-Tax Architecture (Dual VAT & Cross-ERP Duty)

The HSN Codes Master (`/masters/hsn`) provides a unified, cross-border tax taxonomy:
1. **GST % (`gst_percent`):** Goods & Services Tax rate (e.g. 18%).
2. **Import Duty % (`import_duty_percent`):** Customs import tariff percentage used when goods arrive in India. When Yinglima products are scoped to Inhyma, this rate syncs directly into Inhyma's product tax profile.
3. **Purchase VAT % (`purchase_vat_percent`):** Domestic Chinese input VAT rate (进项税) paid upon procurement (e.g. 13%, 9%, 6%). Auto-populates in Product Master when an HSN code is selected.
4. **Refund VAT % (`refund_vat_percent`):** Chinese export tax rebate rate (退税率) refunded upon export (e.g. 13%, 9%, 0%). Auto-populates in Product Master.
5. **Bulk Import Parity:** Full support for both **Add New** and **Update Existing** via CSV/XLSX, with sample template download auto-reflecting all 4 tax rates.

---

## 5. What Needs to Be Verified (Testing Checklist)

- [ ] **HSN Tax Configuration & Bulk Import:**
  - Create HSN code with GST %, Import Duty %, Purchase VAT %, and Refund VAT %.
  - Verify "+ New HSN Code" drawer opens with blank tax inputs and subtle "0" placeholders (not requiring users to backspace/erase a literal "0").
  - Import CSV with `Update Existing` checked; verify existing HSN codes update their tax rates without duplicate errors.
  - Download Sample Template (`📥 Sample Template`); verify `Import Duty %` and `Purchase VAT %` appear with valid numeric examples.
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
