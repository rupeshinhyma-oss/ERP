# Module Guide: Agents & Buyers (`buyers`)

**System:** Yinglima_ERP  
**Module:** Customer & Overseas Buyer Management (`/buyers`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-15  

---

## 1. Overview & Purpose

The **Buyers** module tracks international importers, buying agents, and corporate clients (primarily in India, UAE, and overseas markets). It maintains client profiles, shipping addresses, credit limits, VIP grades (Grade A, B, C), business potential, and historical inquiries.

---

## 2. Key Architecture & File Map

### Frontend:
* **List Page:** [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx) (Route: `/buyers`)
* **Executive Detail Side Drawer (720px):** Embedded `SideDrawer` in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx) triggered by blue Company Name hyperlink
* **Form Modal:** Create & Edit Buyer Modal in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx)
* **Lookups & Caching:** `useLookup` & `useLookupNames` in [`src/lib/lookups.ts`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/lib/lookups.ts) with zero-latency in-memory category & sub-category resolution

### Backend:
* **Routes:** [`app/buyers/routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/buyers/routes.py)
* **Service:** [`app/buyers/service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/buyers/service.py)
* **Schemas:** [`app/buyers/schemas.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/buyers/schemas.py) (`BuyerRead`, `BuyerCreate`, `BuyerUpdate`, `BuyerListItemRead`, `BuyerContactRead`)
* **Models:** [`app/buyers/models.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/buyers/models.py) (`buyers`, `buyer_contacts`, `buyer_category_links`, `buyer_sub_category_links`)

---

## 3. Data Flow & Cross-Module Dependencies

```
[Buyer Master]
       │
       ├──> Inquiries & Quotations: Buyer receives formal RFQ quotation
       ├──> Sales Process: Buyer is assigned to sales orders and CI sheets
       └──> Shipment Planning: Consignee name and destination port (e.g. Mumbai, Nhava Sheva)
```

---

## 4. Executive Side Drawer (Complete View) & In-Memory Category Architecture

### 720px Executive Side Drawer Specification:
- **Trigger:** Clicking on the blue `company_name` link in the Buyer table.
- **Loading State:** Instant render with initial row data, followed by background `GET /buyers/:id` fetch displaying `⏳ Loading full details...` indicator until settled.
- **Card Structure (5 Executive Cards matching Suppliers module):**
  1. **🏢 Company Profile & Classification:** Company Name, Buyer Type, Tax ID (TIN / GST), Country, City, Category chips (`🏷️`), Sub-Category chips (`📂`), Currently Buying From, Product Range, Remarks.
  2. **👤 Primary Contact Information:** Contact Person, Designation, Calling Number (`📞 tel:`), WhatsApp Number with official vector `<WhatsAppIcon size={16} />` and direct `https://wa.me/...` link (`↗`), Email badges (`mailto:`), Website links (`🌐 ↗`).
  3. **📍 Location & Postal Delivery Address:** Country, City, Full Postal Delivery Address.
  4. **📊 Pipeline Status & Commercial Evaluation:** Client Grade pill (`GRADE A/B/C`), Current Status pill (`EXISTING/NEW`), Potential Status pill (`YES/NO`), Reason for Potential Status.
  5. **👥 Additional Contacts Roster:** Displays all secondary contacts from `detailBuyer.contacts` with Person Name, Designation, Calling Number, WhatsApp Number with WhatsApp SVG icon, and Email.
- **History Synchronization:** Supports deep linking via `?id=` query parameter and full synchronization with browser back navigation via `useModalHistorySync`.

### Category & Sub-Category In-Memory Performance:
- **Root Cause of Slowness:** Previously, opening or typing in Category multi-select panels fired un-cached network requests (`/masters/product-categories?page=1&page_size=250`) and separate per-ID queries for every pre-filled chip.
- **Zero-Latency In-Memory Fix:**
  - `fetchCategoryOptions` and `fetchSubCategoryOptions` filter directly against in-memory `categories.items` and `subCategories.items` (already loaded by `useLookup`).
  - `fetchNameLabel`, `fetchCategoryLabel`, and `fetchSubCategoryLabel` resolve names immediately in 0ms from `categories.items`, `subCategories.items`, `categoryNamesFallback`, and `subCategoryNamesFallback` without making extra HTTP calls.
  - All fetcher and resolver callbacks are stabilized with `useCallback` to prevent unnecessary component re-renders.

---

## 5. Location Hierarchy (`State / Province`) & Company Name Non-Clickable Master Reference

### Location Hierarchy (Country ➡️ State/Province ➡️ City):
- **Database Column:** `state_id UUID NULL REFERENCES states(id)` added via migration [`7a8b9c0d1e2f_add_state_id_to_buyers.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/alembic/versions/7a8b9c0d1e2f_add_state_id_to_buyers.py).
- **Form Layout:** Under Location Details, a clean 3-column responsive grid:
  1. `Country *` (Mandatory SearchableDropdown)
  2. `State / Province (Optional)` (SearchableDropdown dynamically filtered by `country_id`, resets on Country change)
  3. `City (Optional)` (SearchableDropdown filtered by `state_id` or `country_id`)
- **Executive Drawer:** Location Details card displays Country, State / Province, and City in prominent structured badges.

### Non-Clickable Reference-Only Company Name Suggestions (No Popup):
- **Design Pattern (matching `Suppliers.tsx`):**
  - Eliminated the intrusive `window.confirm` modal popup (`Buyer "{name}" already exists in Master...`).
  - As user types in the Company Name input, a floating card displays matching existing buyers: `"Existing in Master (N) | Reference Only (Non-selectable)"`.
  - Suggestion items have `pointerEvents: "none"` and cannot overwrite or hijack user input.
  - If exact company name match is detected, a non-blocking inline red warning banner alerts the user: `⚠️ A buyer with this exact name already exists. You can still save if intentional.`

### Dual Contacts in Import & Export Templates:
- **Columns Supported:**
  - Primary Contact: `Contact Salutation`, `Contact Person Name`, `Designation`, `Calling Number`, `WhatsApp Number`
  - Secondary Contact: `Contact Person 2`, `Designation 2`, `Calling Number 2`, `WhatsApp Number 2`
- **Import Engine:** Creates secondary contacts (`is_primary=False`) in `buyer_contacts` both during new buyer insertion and when updating existing buyers.
- **Export Engine:** Exports `State / Province` (between Country and City) and all secondary contact fields across CSV and XLSX formats.

---

## 6. Added On / By User Attribution & Auto Title Case

### 1. Auto Capitalization (Title Case) on Company Name:
- **Real-Time Input Capitalization:** The **Name of Company** input utilizes `autoTitleCase` to automatically capitalize the first letter of each word in real-time (e.g., `om packaging mulund` $\rightarrow$ `Om Packaging Mulund`), matching Supplier Master conventions while preserving acronyms (e.g., `PVT LTD`, `LLP`).

### 2. "Added On / By" Attribution in Main Table:
- **Database Column:** `created_by_id UUID NULL REFERENCES users(id)` added via migration [`8b9c0d1e2f3a_add_created_by_to_buyers.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/alembic/versions/8b9c0d1e2f3a_add_created_by_to_buyers.py).
- **Table Column Header:** **Added On / By** displaying the formatted registration date and the creator user name (e.g. `2026-10-15 by Admin User`).

### 3. Full-Text Search Input Specifications & Digit Normalization:
- **Search Field Placeholder:** `Search company, country, contact, city, phone...`
- **Phone Digit Matching (`func.regexp_replace`):** Searching bare digits (e.g. `7738417257` or `865641654651`) matches formatted numbers (`+91 7738417257`, `+86 5641654651`) on both primary contacts and child `BuyerContact` records.
- **Geographic & Contact Coverage:** Searches Company Name, Country (`Country.name`, `code`), State (`State.name`), City, Address, Primary & Secondary Contacts (`person_name`, `designation`), emails (`BuyerEmail`), and product range.

---

## 7. What Needs to Be Verified (Testing Checklist)

- [ ] **Buyer Creation & In-Memory Category Speed:**
  - Open "Add Buyer" modal. Verify Category & Sub-Category dropdowns open instantly (<10ms) with zero lag.
  - Type in category search and verify instant client-side filtering.
- [ ] **State / Province Selection & Cascade:**
  - In Add/Edit Buyer modal, select a Country (e.g. India or Pakistan).
  - Verify `State / Province` dropdown populates with states belonging to that country.
  - Changing Country resets State and City.
- [ ] **Non-Clickable Company Name Reference & Duplicate Warning:**
  - Type an existing Buyer company name.
  - Verify suggestion box shows "Existing in Master | Reference Only" without being clickable.
  - Verify inline duplicate alert banner shows without any modal popups or confirmation dialogs.
- [ ] **Blue Link Click & 720px Side Drawer:**
  - Click on any blue Company Name hyperlink in the table.
  - Verify 720px side drawer slides in smoothly.
  - Verify all 5 executive cards display complete data (profile, contact, address with State/Province, pipeline evaluation, additional contacts).
  - Test clicking WhatsApp link (opens `https://wa.me/...` in new tab).
  - Test clicking Calling number (initiates `tel:` link).
- [ ] **Import / Export with Dual Contacts & State:**
  - Export CSV and XLSX; verify `State / Province` and `Contact Person 2` columns.
  - Import sample file with secondary contact and verify both contacts appear in buyer roster.
- [ ] **Client Grade & Potential:**
  - Check that updating Client Grade (A, B, C) or Potential requires appropriate permissions (`buyer.clientgrade`, `buyer.potential`).
- [ ] **Soft-Delete Protection:**
  - Verify soft-delete leaves associated historical inquiries and planning rows intact.

---

## 8. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Strict rules to observe when modifying the Buyers module:**

1. **Permission Chokepoints:**
   - Viewing requires `buyer.view`.
   - Editing special fields (Grade, Potential, Status) is gated by individual fine-grained permissions (`buyer.clientgrade`, `buyer.potential`, `buyer.currentstatus`).
2. **Consignee Consistency:**
   - In Sales Process and Shipment Planning, changing buyer contact details must not retroactively corrupt historical, closed shipment documents.

---

## 9. Comprehensive Multi-Field Search & Digit-Normalized Phone Search

The buyer list search bar (`placeholder="Search company, country, contact, city, phone..."`) executes a multi-table database query matching:
1. **Digit-Normalized Phone Search:**
   - Supports search across primary calling/WhatsApp numbers and child `BuyerContact` numbers with automated non-digit stripping (`regexp_replace(col, '\D', '', 'g') ILIKE '%digits%'`).
   - Searching `9561914519` or `+919561914519` finds buyers whose contacts are stored as `+91 9561914519`.
2. **City & Address Fields:**
   - Directly matches `Buyer.city` (e.g. `Mumbai`, `Thane`, `Indore`) and `Buyer.address`.
3. **Country & Province / State:**
   - Matches linked `Country.name`, `Country.code`, `State.name`, and `State.code` via subqueries.
4. **Contacts & Roster:**
   - Queries `BuyerContact.person_name`, `designation`, `email`, and phone numbers.

