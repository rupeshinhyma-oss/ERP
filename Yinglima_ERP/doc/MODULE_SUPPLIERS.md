# Module Guide & Master Requirement Specification: Suppliers & Vendor Directory (`/suppliers`)

**System:** Yinglima_ERP (China Procurement & Sourcing)  
**Module:** Supplier & Factory Management (`/suppliers`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-13  
**Document Purpose:** Single source of truth detailing the exact business requirements, data structures, field validations, UI layouts, side-drawer specifications, and downstream cross-module integrations for the Supplier module.

---

## 1. Executive Overview & Purpose

The **Suppliers** module serves as Yinglima ERP's central supplier relationship management (SRM) and vendor directory. It manages:
* **Factory Profiles & Qualifications:** Manufacturing capabilities, product categories, brands, factory physical address, and Chinese tax IDs.
* **Direct Communication Channels:** Primary contact persons, WeChat IDs, WhatsApp direct links, telephone numbers, and email rosters.
* **Factory Inspection & Due Diligence:** On-site factory visit logs, inspection remarks, cloud video links (YouTube, Google Drive, OneDrive, Vimeo), and inspection photos.
* **Commercial Status & Pipeline Evaluation:** Supplier quality grades (A/B/C), commercial status (`New` vs. `Existing`), potential qualification (`Yes` / `No`), and strategic strengths.
* **Multiple Contact Management:** Secondary contacts categorized by territory (Local China, Export India, Export Africa, etc.).
* **Downstream Integration:** Automatic supplier lookup and quote fetching in **Local Purchases** (searchable type-ahead), **Inquiries & Quotations**, **Product Prices**, and **Shipment Planning**.

---

## 2. Comprehensive Field & Data Specifications

The Supplier master profile consists of five distinct logical sections:

### 2.1 Company Profile & Location Details
| Field Name | Type | Constraints / Rules | Description |
| :--- | :--- | :--- | :--- |
| **Company Name\*** | Text + Floating Suggestions | Required, free-form text input with intelligent reference dropdown | Registered business or factory name. **Smart Floating Suggestion Dropdown:** As the user types, a floating autocomplete dropdown displays matching suppliers from the master (prioritizing prefix matches, e.g. typing "O" lists "Om" first). **Untouchable / Non-Selectable:** The dropdown is purely informational (`pointer-events: none`); clicking will not select or overwrite user input. **Duplicate Detection:** Triggers instant duplicate warning if an exact name match exists. |
| **Supplier Type** | Select | `Manufacturer` / `Trader` / `Select` | Specifies if the vendor is a direct factory or a trading/agent company. |
| **Brand Description** | Text | Optional | Proprietary brands manufactured or marketed by the supplier. |
| **Tax ID / GST Number** | Text | Optional | Unified Social Credit Code (China) or foreign tax registration number. |
| **Country\*** | Select | Default: **China**, Editable | Country of registration/factory origin. |
| **Province / State\*** | Select | Dependent master dropdown (Strict Master Only, Custom Text Disabled) | State or province (e.g. Guangdong, Zhejiang, Jiangsu) strictly selected from Province Master. |
| **City\*** | Select | Dependent master dropdown | City of manufacturing facility or sales office (e.g. Foshan, Ningbo, Wenzhou) from City Master. |
| **Address** | Text | Positioned in Tab 1 (Geography) spanning full-width (3 columns) | Complete street/building address of factory or office. |

#### 2.1.1 Floating Master Suggestion Dropdown (Untouchable / Non-Selectable)
When typing into the **Name of Company** field in the Supplier Creation & Edit form:
* **Floating Type-Ahead Autocomplete:** A clean floating dropdown container appears directly beneath the input field (elevation `z-index: 100`) as soon as the user types characters.
* **Prefix-First Prioritization:** Suppliers whose company names start with the typed search query (e.g. typing `"o"` or `"om"` places `"Om"` at the very top) are sorted above suppliers that merely contain the substring elsewhere.
* **Untouchable / Non-Selectable Architecture:** Suggestions have `pointer-events: none` and `user-select: none`. Users **cannot** click, enter, or select an item from the dropdown to overwrite what they are typing. It serves purely as a visual lookup of existing master suppliers so users don't create accidental duplicates while typing a new supplier name freely.
* **Visual Status Indicators:** Each suggestion row clearly displays the company name, category/supplier type badge (e.g. `Manufacturer` / `Trader`), and `(In master)` tag.
* **Master Duplicate Enforcement:** If what the user types matches an existing supplier name in the database, an immediate red alert badge (`⛔ Supplier already exists in Supplier Master! Cannot save duplicate.`) renders at the top of the dropdown and below the input field when blurred.

### 2.2 Product Capabilities & Categorization
| Field Name | Type | Constraints / Rules | Description |
| :--- | :--- | :--- | :--- |
| **Product Categories** | Multi-Select | Linked to Category Master | Primary industries served (e.g., Machines, Food Ingredients, Chemicals, Pumps). |
| **Key Strength Sub-Category (multiple)** | Multi-Select | Dependent on Product Categories | Specific sub-categories supplied. Grouped hierarchically under parent Categories with select-all per group. |
| **Products Supplied (multiple)** | Multi-Select | Dependent on Sub-Categories & Categories | Specific catalogue items supplied. Grouped hierarchically under Sub-Categories with select-all per group. |
| **Secondary Products** | Textarea | Description | Supplementary or non-core items the factory can fabricate or source on demand. |

#### 2.2.1 3-Tier Cascading Categorization & Grouped Multi-Panel Architecture
The Supplier profile establishes a strict 3-tier hierarchical relationship across product categorization:
```
[ Product Categories (multiple) ]
              │ (Filters)
              ▼
[ Key Strength Sub-Categories (multiple) ] ── (Grouped by Category)
              │ (Filters)
              ▼
[ Products Supplied (multiple) ] ────────── (Grouped by Sub-Category)
```

1. **Category Selection (`Product Categories`):**
   * Multi-select searchable panel allowing one or more parent categories (e.g., *Chemicals*, *Consumable Category*).
   * **Auto-Pruning:** When a user removes a category, any previously selected Sub-Categories and Products belonging to that removed category are automatically pruned.

2. **Sub-Category Selection (`Key Strength Sub-Category`):**
   * **Disabled State:** Disabled with placeholder `"-- Please select Category first --"` if no parent category is selected.
   * **Grouped Dropdown Panel:** Sub-categories appear organized under bold Category headers (e.g. `[ ] Chemicals (0/2 selected)`, `[ ] Consumable Category (0/1 selected)`).
   * Users can check individual sub-categories, click the category header checkbox to select all sub-categories in that category, or use master `Select All`.
   * **Auto-Pruning:** Deselecting a sub-category automatically prunes any selected Products that belong to that sub-category.

3. **Products Supplied Selection (`Products Supplied`):**
   * **Disabled & Placeholder States:**
     * If no Category selected: `"-- Please select Category first --"` (disabled).
     * If Category selected but no Sub-Category selected: `"-- Please select Sub-Categories first --"` (disabled).
     * Once Sub-Categories are selected: `"-- Select Products Supplied --"` (enabled).
   * **Strict Catalog Filtering:** The dropdown strictly lists active products from Product Master whose `category_id` matches the selected categories AND whose `sub_category_id` matches the selected sub-categories.
   * **Grouped Multi-Panel Architecture:** When opened, products are dynamically grouped under their corresponding Sub-Category (e.g. `[ ] Boiler and Cooling Tower Chemicals (0/5 selected)`, `[ ] Other Chemicals (0/7 selected)`). If multiple categories are selected, headers display as `${Category} › ${Sub-Category}` for complete clarity.
   * **Bulk Selection Capabilities:**
     * Top master `Select All` to select all available matching products.
     * Group header checkbox to select/unselect all products under that specific sub-category in a single click.
     * Individual product checkboxes with instant tag removal (`✕`).
   * **Searchability:** Typing in the search bar filters products by code or name while preserving the group layout.

### 2.3 Primary Contact & Digital Channels
| Field Name | Type | Constraints / Rules | Description |
| :--- | :--- | :--- | :--- |
| **Contact Person** | Text | Salutation (`Mr.` / `Mrs.` / `Ms.`) + Full Name | Primary commercial contact or key account manager. |
| **Designation** | Text | Optional | Job title (e.g., Sales Director, Export Manager, GM). |
| **Calling Number** | Text | Strict 7–11 digit subscriber check + Country prefix | Direct voice phone. Format: `+<CountryCode> <Number>`. Clickable `tel:` link. |
| **WhatsApp Number** | Text | Strict 7–11 digit subscriber check + Country prefix | WhatsApp contact. Generates direct clickable `https://wa.me/<number>` link. |
| **WeChat Number / ID** | Text | Phone number or WeChat ID | WeChat contact for Chinese suppliers. Displayed with WeChat icon. |
| **Email Addresses** | Multi-Text | Comma-separated RFC emails | Contact emails. Displayed as individual clickable `mailto:` tags. |
| **Primary Website** | URL | Validated hyperlink | Official factory website. Clickable external link (`🌐` and `↗`). |
| **Secondary Website** | URL | Validated hyperlink | 1688.com, Made-in-China, or Alibaba storefront. Clickable external link. |

### 2.4 Factory Visit & Inspection Media
| Field Name | Type | Constraints / Rules | Description |
| :--- | :--- | :--- | :--- |
| **Visited Factory / Office?** | Boolean | `Yes` / `No` (Default: `No`) | Indicates if an on-site audit/inspection was conducted by the team. |
| **Visit Remarks** | Textarea | Contextual: Enabled when visited | Audit observations, machine capabilities, QC checks, factory capacity notes. |
| **Factory Videos / Cloud Links** | URLs | Comma/line separated | Links to YouTube, Google Drive, OneDrive, Vimeo, or cloud inspection folders. Automatically parsed into branded clickable badges. |
| **Visit Photos & Media** | File Upload | Image formats, Supabase Storage | High-res photos of factory exterior, production line, testing lab, or visiting cards. Thumbnails preview directly in the side drawer. |

### 2.5 Pipeline Status & Commercial Evaluation
| Field Name | Type | Constraints / Rules | Description |
| :--- | :--- | :--- | :--- |
| **Supplier Grade** | Select | `Grade A` / `Grade B` / `Grade C` / `Select` | Vendor classification based on quality, reliability, lead times, and price competitiveness. |
| **Current Status** | Select | `Existing` / `New` / `Select` | Commercial lifecycle status. **Strict Business Rule:** Once marked `Existing`, it cannot be changed back to `New` (one-way progression). |
| **Potential (Yes / No)** | Select | `Yes` / `No` / `Select` (Stored as `yes` / `no`) | High-priority supplier qualification flag. Preselected accurately in edit forms. |
| **Reason for Potential** | Textarea | Optional | Rationale behind the potential rating (e.g. "Exclusive direct pricing", "Advanced automated equipment", "Poor response time"). |
| **Overall Remarks** | Textarea | Optional | General vendor summary, negotiating history, payment terms, or key strengths. |

### 2.6 Additional Contacts Roster
A supplier can have multiple secondary contacts. Each contact record stores:
* **Salutation & Person Name:** (e.g. *Mr. Chen Wei*)
* **Designation:** (e.g. *Export Sales Manager*)
* **Handling Territory:** (e.g. *Local China*, *Export India*, *Export Africa*, *Export Middle East*)
* **Country:** Dropdown (Default: *China*)
* **Calling Number:** Formatted with country prefix and clickable `tel:` link.
* **WhatsApp Number:** Formatted with clickable `https://wa.me/...` link.
* **WeChat Number / ID:** Formatted with WeChat icon.
* **Email Address:** Formatted with clickable `mailto:` link.

---

## 3. List Table & Filter Bar Specifications

### 3.1 Top Filter Bar
The top filter section enables multi-criteria filtering across the supplier directory:
1. **Category** (Searchable Master Dropdown)
2. **Product Sub Category** (Cascaded / Unlocked Master Dropdown)
3. **Product** (Cascaded / Unlocked Master Dropdown)
4. **Country** (Dropdown)
5. **Province / State** (Cascaded Dropdown)
6. **City** (Cascaded Dropdown)
7. **Supplier Type** (`Manufacturer` / `Trader` / `All`)
8. **Supplier Grade** (`Grade A` / `Grade B` / `Grade C` / `All`)
9. **Current Status** (`Existing` / `New` / `All`)
10. **Potential** (`Yes` / `No` / `All`)
11. **Visited Factory / Office?** (`Yes` / `No` / `All`)

### 3.1.1 Full-Text Search Input Specifications
The search input (`Search company, country, contact, city, phone...`) performs deep matching across all visible and related supplier data:
* **Company & Contact Names:** Case-insensitive substring matching plus space and hyphen normalization (e.g. `Chen Wei` matches `Chen-Wei` or `ChenWei`).
* **Phone Numbers (Digit Normalization):** Compares stripped digits via `regexp_replace(phone, '\D', '', 'g') ILIKE '%digits%'` so searching raw digits (`9561914519` or `13800138000`) instantly matches formatted numbers (`+91 9561914519`, `+86 138-0013-8000`). Checks calling numbers, WhatsApp, and WeChat numbers on both primary and all child `SupplierContact` records.
* **Child Contacts & Emails:** Searches secondary contact person names, designations, WeChat IDs, and child emails (`SupplierEmail`).
* **Geographic Masters:** Resolves linked `Country.name`, `Country.code`, `State.name`, and `City.name` via foreign keys.
* **Catalog Products & Categories:** Searches linked products (`product_name`, `product_code`, `product_name_tally`, `product_name_invoice`) and linked category/subcategory names.

### 3.2 List Table Columns & In-Line Actions
* **Checkbox:** Selection for bulk actions and exports.
* **Sr. No.:** Sequential row indexing.
* **Company Name:** Styled as a prominent blue link. **Clicking opens the 720px Side Drawer**.
* **Product Categories & Sub-Categories:** Shows up to 5 chip badges; additional chips are viewable via eye icon expander or tooltip.
* **Country / City / Province:** Geographic location summary.
* **Brand:** Supplier brand names.
* **Supplier Type:** Manufacturer vs. Trader indicator.
* **Current Status:** `Existing` vs. `New` badge.
* **Supplier Grade:** Inline editable dropdown for instant updating.
* **Potential:** Inline editable dropdown (`Yes` / `No`) for instant qualification updating.
* **Actions:**
  * **Edit:** Opens the full multi-section Edit Modal.
  * **Delete / Inactive:** Subject to deletion protection rules.

### 3.3 Two-Way Synchronization: List View (Inline Changes) ↔ Inside Form ↔ Complete View (Side Drawer)

To ensure seamless operational efficiency, the Supplier module implements real-time two-way synchronization between the three viewing/editing modes:

```
    ┌─────────────────────────────────────────────────────────────┐
    │                      DATABASE / API                         │
    │             (Single Source of Truth: /suppliers)             │
    └──────────────────────▲───────────────▲──────────────────────┘
                           │               │
        Inline Table Edit  │               │ Full Form Submit
        (Grade / Potential)│               │ (All Fields)
                           ▼               ▼
┌─────────────────────────────┐         ┌─────────────────────────────┐
│      LIST TABLE VIEW        │         │      INSIDE FORM MODAL      │
│  • Inline Grade Dropdown    │◄───────►│  • Part 1: Basic & Contacts │
│  • Inline Potential Dropdown│  Sync   │  • Part 2: Factory & Profile│
│  • One-click Drawer Trigger │         │  • Part 3: Secondary Roster │
└──────────────┬──────────────┘         └─────────────────────────────┘
               │
               │ Opens on Company Name Click
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 COMPLETE VIEW (720px SIDE DRAWER)                   │
│  • 360° Complete inspection of all form fields                      │
│  • Read-only visual presentation with direct action links            │
│  • "✏️ Edit Supplier" button to launch Inside Form with live data   │
└─────────────────────────────────────────────────────────────────────┘
```

1. **Inline Table Changes (Grade & Potential):**
   * Users can modify **Supplier's Grade** (`Grade A`, `Grade B`, `Grade C`) and **Potential** (`Yes`, `No`) directly from the table row without opening any modal.
   * Selecting an option sends an immediate background patch request to `/suppliers/:id`.
   * **Instant Form & Complete View Sync:** When a user opens the **Inside Form** or the **Complete View (Drawer)** for that supplier, it immediately displays the updated Grade and Potential.
2. **Inside Form Changes Reflecting in List Table & Complete View:**
   * When saving updates inside the **Inside Form Modal**, the table row immediately updates without needing a full page reload.
   * If the **Complete View (Drawer)** is open, its card badges (e.g. Grade pill, Potential YES/NO badge, contact details) re-render with the latest saved data.
3. **Complete View (Side Drawer) as Master Auditor:**
   * The Side Drawer acts as the **Complete View**, aggregating all data from the inside form (Part 1, Part 2, and Additional Contacts) into an executive, clean 5-card layout.
   * If any data discrepancy or missing field is noticed in the Complete View, clicking `✏️ Edit Supplier` at the top right of the drawer immediately opens the Inside Form with all current values pre-loaded.

### 3.4 Deletion & Protection Rules
> [!IMPORTANT]
> **Data Integrity Constraint:**
> 1. If `Current Status == "Existing"` OR `Potential == "Yes"`, the row **CANNOT be deleted**. The Delete action is blocked/disabled to prevent accidental loss of active business relationships. The supplier can only be toggled to `Inactive`.
> 2. Deletion is permitted **ONLY** if `Current Status` is `"New"` (or unselected) **AND** `Potential` is `"No"` (or unselected).
> 3. Deleting a supplier initiates a **Soft Delete** (`deleted_at`), moving the record to the system **Trash** module (`/trash`) where it can be inspected or restored.

---

## 4. Side Drawer Specification (Detail View — 720px Layout)

When any supplier company name is clicked in the table, the **Side Drawer** slides in from the right:

* **Width:** Configured to `maxWidth: 720px; width: 100%` to provide a clear, two-column layout while keeping the background table visible.
* **Header:**
  * Supplier title: `Supplier Detail #<Company Name>`
  * Subtitle: `Supplier Type: <Type> | Status: <Active/Inactive>`
  * Primary Action: `✏️ Edit Supplier` button (opens the edit modal directly from the drawer).
* **Card 1: 🏢 Company Profile & Classification:**
  * Company Name, Supplier Type, Brand Description, Tax ID / GST Number, Country, State, City, Full Address.
  * Category chips, Sub-Category chips, Products Supplied chips, Secondary Products description.
* **Card 2: 👤 Primary Contact Information:**
  * Contact Person, Designation.
  * Calling Number with direct clickable `tel:` link (`📞`).
  * WhatsApp Number with official WhatsApp SVG logo symbol (`#25D366`) and direct clickable `https://wa.me/...` link (`↗`).
  * WeChat Number/ID with official WeChat SVG dual-bubble symbol (`#07C160`).
  * Email Addresses rendered as individual badges with clickable `mailto:` links.
  * Primary & Secondary Websites rendered with `🌐` and open-in-new-tab `↗` links.
* **Card 3: 🏭 Factory Visit & Inspection Media:**
  * Factory Visited Status: Green `✓ Yes, Visited` or neutral `No` badge.
  * Visit Remarks: Detailed inspector notes.
  * Factory Videos & Cloud Folders: Smart interactive pill badges detecting link type:
    * `▶️ YouTube Video ↗`
    * `📁 Google Drive ↗`
    * `📂 OneDrive ↗`
    * `🎬 Vimeo ↗`
    * `🎥 Video Link ↗`
  * Factory Photos & Attachments: Thumbnail image grid opening full-resolution media in new tabs.
* **Card 4: 📊 Pipeline Status & Commercial Evaluation:**
  * Supplier Grade (e.g. `Grade A`).
  * Current Status pill (`Existing` / `New`).
  * Potential Status: Distinct green `YES` or red `NO` badge.
  * Reason for Potential Status.
  * Overall Remarks & Key Strengths.
* **Card 5: 👥 Additional Contacts:**
  * Renders every secondary contact card with name, designation, handling territory badge (`📍 Local China`, `📍 Export India`, etc.), and clickable phone, WhatsApp, WeChat, and email links.

---

## 5. Downstream Cross-Module Integrations

```
┌────────────────────────────────────────────────────────┐
│                   SUPPLIER MASTER                      │
│                 (Directory of Record)                  │
└──────────────────────────┬─────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌──────────────────┐┌──────────────┐┌──────────────────┐
│  LOCAL PURCHASE  ││  INQUIRIES   ││  PRODUCT PRICES  │
│  Type-ahead bar  ││  Sourcing &  ││  Purchase cost   │
│  Auto-quotes &   ││  WeChat/Mail ││  history &       │
│  Bill extraction ││  broadcast   ││  vendor quotes   │
└──────────────────┘└──────────────┘└──────────────────┘
```

1. **Local Purchase Module (`/purchase/local`):**
   * Uses `SearchableDropdown` for instant type-ahead filtering by supplier name.
   * Auto-resolves supplier details when **⚡ Extract Bill Data** OCR scans an incoming invoice.
   * Automatically queries supplier product price logs to pre-fill unit prices on purchase line items.
2. **Inquiries & Sourcing Module (`/inquiries`):**
   * Matches product categories to active suppliers to build candidate sourcing pools.
   * Pulls contact emails and WeChat IDs to broadcast quotation requests.
3. **Product Prices Module (`/prices`):**
   * Links supplier IDs to historical purchasing logs, maintaining price curves across different factory vendors.
4. **Shipment Planning Module (`/planning`):**
   * Tracks factory cargo readiness dates, origin ports, and dispatch addresses.

---

## 6. Maintenance & Change History

* **2026-10-14 (Strict Province Master Selection Enforcement):**
  * **Removed Custom Text & Enter Prompt:** Removed `allowCustomText={true}` and `onTextChange` from `field-province` in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx).
  * **Master Integrity:** Province dropdown now strictly queries and validates against the Province Master (`/masters/states`). Eliminated `Use "..." (New) ↵ Enter` custom prompt. Non-master text typed by users is not added on Enter and is discarded on blur, matching Country and City behavior.
* **2026-10-14 (Form Layout Rebalancing & Address Relocation to Tab 1):**
  * **Address Relocated to Tab 1:** Moved `Address` into **Tab 1 (General Information & Geography)**, positioned immediately under Country, Province, and City, spanning the full width across 3 columns (`gridColumn: "1 / -1"`).
  * **Tab 2 Balanced into 2×3 Grid:** Removed `Address` and `Town` from Tab 2, arranging the remaining 6 profile fields into a balanced 2-row × 3-column layout (Row 1: *Tax ID Number, Primary Website, Secondary Website*; Row 2: *Supplier Grade, Current Status, Potential*), completely eliminating gaps.
* **2026-10-14 (Complete Removal of `Town` Column & DB Migration 86ea2b62aa9c):**
  * **Database Migration:** Applied Alembic migration `86ea2b62aa9c_drop_town_from_suppliers.py` to permanently drop `town` column from `suppliers` table.
  * **Backend Elimination:** Removed `town` from `Supplier` ORM model, Pydantic schemas (`SupplierCreate`, `SupplierUpdate`, `SupplierRead`), constants (`IMPORT_HEADERS`, `EXPORT_HEADERS`), `validators.py`, `service.py`, `routes.py`, `repository.py`, and `search/service.py`.
  * **Frontend Elimination:** Removed `town` from `Suppliers.tsx` (headers, empty form, edit pre-population, save payload, and drawer summary card), `sampleTemplate.ts`, and `ImportWizard.tsx`.
* **2026-10-14 (Dual Contacts in Import/Export, Column Widening & Multi-Number Support):**
  * **Dual Contacts Support:** Extended Excel/CSV sample export and import wizard to support 2 contacts: `Contact Person 2`, `Designation 2`, `Calling Number 2`, `WhatsApp Number 2`, `WeChat Number 2`.
  * **Multi-Number Support:** Validates and normalizes multiple phone numbers separated by commas/slashes (e.g., `+86 13800000001, +86 13800000002`).
  * **Schema Widening:** Applied migration `41a972a6d3d4_widen_supplier_phone_columns.py` widening `contact_calling_number`, `contact_whatsapp_number`, and `contact_wechat_number` to `VARCHAR(150)`.
* **2026-10-14 (Table Column Optimization: 15 to 11 Columns & Horizontal Scroll Elimination):**
  * **Company Name & Brand Merged:** Combined Company Name and Brand Description into a single column (`Company Name & Brand`). Implemented 2-line clamp (`-webkit-line-clamp: 2`) with hover tooltip for long company names, plus an underneath badge (`🏷️ <Brand>`) for the brand.
  * **Category & Sub-Category Merged:** Combined Category and Sub-Category chips into a single column (`Category & Sub-Category`) with clear visual hierarchy (`🏷️ <Category>` on line 1, `↳ 📂 <Sub-Category>` on line 2).
  * **Products Supplied & Secondary Products Merged:** Combined Primary Products Supplied chips and Secondary Products description into a unified single column (`Products Supplied & Secondary`) with products on line 1 and secondary products underneath on line 2 (`↳ <Secondary>`).
  * **Country Column Removed from Table Display:** Hidden the redundant `Country` (`China`) column from the frontend list view to save horizontal space and eliminate scroll fatigue.
  * **Unified Frozen Columns & Alignment:** Refactored table headers, skeleton rows, and freeze column toggles to 11 columns (`SUPPLIER_TABLE_COLUMNS`), updating `TableMessageRow colSpan={11}`.
* **2026-10-13 (Supplier Form Header Labels Simplification):**
  * Simplified `Product Category (multiple)` heading to **`Category`**.
  * Renamed `Key Strength Sub-Category (multiple)` heading to **`Sub Category (key strength)`**.
* **2026-10-13 (Unlocked Top Filter Dropdowns with Master Search & 'All' Support):**
  * Unlocked **Key Strength Sub Category**, **Province / State**, and **City** dropdowns in the top filter bar of [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx).
  * Removed `disabled` locks and set default placeholder to `"All"`.
  * Configured dynamic fetching from respective master endpoints (`/masters/product-sub-categories`, `/masters/states`, `/masters/cities`):
    * If parent is selected, searches within that parent hierarchy.
    * If no parent is selected, enables full typeahead search across all respective master records directly with an `"All"` reset option.
* **2026-10-13 (Sidebar Navigation Active-Click Return to Main Table):**
  * Configured active navigation click in [`AppShell.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/AppShell.tsx) and [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx).
  * Clicking "Suppliers" in the sidebar when inside "+ Add Supplier" or the Side Drawer smoothly resets and returns to the main supplier list table.
  * Preserves exact sequential browser history for forward/backward arrows between modules (e.g. Suppliers ⇄ Buyers).
* **2026-10-13 (Floating Non-Selectable Master Suggestion Dropdown for Company Name):**
  * Implemented floating suggestion dropdown under **Name of Company** input in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx).
  * Configured prefix-first ranking (e.g. typing "O" ranks "Om" first).
  * Set `pointer-events: none` on suggestions so dropdown is strictly informational ("untouchable") and cannot overwrite user input.
  * Preserved full free-form typing freedom with real-time exact duplicate blocking.
* **2026-10-13 (Side Drawer & Potential Dropdown Alignment):**
  * Expanded Side Drawer to **720px width** with clean 5-card layout.
  * Added **Tax ID**, **Town**, **Visit Remarks**, and **Factory Video Links** (with smart YouTube, Drive, OneDrive badges) to the Side Drawer.
  * Fixed case-sensitivity bug where database `potential: "yes"` did not match capitalized `<option value="Yes">` in the Edit Modal.
  * Synchronized code in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx).
* **2026-10-12 (Local Purchase Searchable Dropdown):**
  * Upgraded Local Purchase supplier field from static `<select>` to dynamic type-ahead `SearchableDropdown`.

---

## 7. Master Quality Assurance (QA) & Verification Audit Checklist

This audit checklist outlines the mandatory verification criteria for the **Suppliers** module. Every QA engineer, developer, and system auditor must use these criteria to verify end-to-end data integrity, UI/UX responsiveness, and system performance.

### 7.1 Form Dropdown Behavior & Master Integrity Checklist

| UI Element / Field | Type & Source | Expected Behavior & Validation Rules | Pass / Fail Criteria |
| :--- | :--- | :--- | :--- |
| **Company Name Floating Suggestions** | Floating Type-Ahead Autocomplete | • As user types, floating dropdown shows matching master suppliers.<br>• **Prefix-First Ranking:** Typing "O" or "Om" puts "Om..." at the top before fuzzy matches.<br>• **Untouchable / Non-Selectable:** `pointer-events: none;` clicking or pressing Enter does NOT select or overwrite what the user typed.<br>• **Duplicate Alert:** Exact name matches display an instant red warning banner (`⛔ Supplier already exists in Supplier Master! Cannot save duplicate.`). | **PASS:** Free typing is completely preserved; Enter does not force-select; duplicate banner alerts user immediately.<br>**FAIL:** Dropdown overwrites user typing or allows saving exact duplicate name. |
| **Supplier Type** | Static Select | Options: `Manufacturer`, `Trader`, `Select`. Default is `Select`. | **PASS:** Correct options display and save cleanly to DB. |
| **Country** | Searchable Master Select (`/masters/countries`) | Default preselected as **China**. Allows searching and selecting any valid country from Country Master. | **PASS:** Defaults to China; changing country cascades to Province filter. |
| **Province / State** | Strict Master Select (`/masters/states`) | • Dropdown strictly queries active records from `/masters/states` for the selected Country.<br>• **Custom Text & Enter Prompt Disabled:** `allowCustomText={false}`. No `Use "..." (New) ↵ Enter` prompt.<br>• Non-master text typed by users is rejected and discarded on blur or Enter. | **PASS:** User can ONLY select verified provinces from master; pressing Enter on unlisted text does NOT add the item.<br>**FAIL:** Custom text creates a new phantom province or saves unverified string. |
| **City** | Master Select (`/masters/cities`) | • Options filtered by selected Province/State.<br>• Strictly verified against City Master. | **PASS:** Lists cities belonging to selected province; persists selected city ID and name accurately. |
| **Category** | Multi-Select Master (`/masters/product-categories`) | • Searchable multi-tag dropdown.<br>• Selecting categories unlocks and filters Sub-Category options.<br>• **Auto-Pruning:** Removing a category automatically removes all child Sub-Categories and Products previously selected. | **PASS:** Multi-tag chips render cleanly; deselecting category cascades auto-prune to sub-categories and products. |
| **Sub Category (key strength)** | Cascading Grouped Multi-Select | • **Disabled state:** If no category selected, disabled with placeholder `"-- Please select Category first --"`.<br>• **Grouped Panel:** Organized under bold Category headers with `(x/y selected)` count.<br>• Header checkbox selects/deselects all sub-categories in that category.<br>• **Auto-Pruning:** Removing a sub-category automatically prunes its associated products. | **PASS:** Displays grouped under parent category; bulk select-all works per group; auto-prunes dependent products on deselect. |
| **Products Supplied** | Cascading Grouped Multi-Select | • **Disabled states:** Disabled if no Category or Sub-Category selected.<br>• **Grouped Panel:** Products grouped by `${Category} › ${Sub-Category}` header.<br>• Top master `Select All`, group header select-all, and individual product checkboxes.<br>• Tag chips with instant removal (`✕`). | **PASS:** Only displays products matching selected categories and sub-categories; bulk selection functions correctly. |
| **Supplier Grade** | Select | Options: `Grade A`, `Grade B`, `Grade C`, `Select`. | **PASS:** Persists grade; matches table inline dropdown. |
| **Current Status** | Select | Options: `New`, `Existing`.<br>• **One-Way Progression Rule:** Once marked `Existing`, it cannot be changed back to `New`. | **PASS:** Transition to `Existing` locks out reversion to `New`. |
| **Potential** | Select | Options: `Yes`, `No`, `Select` (Stored as lowercase `yes` / `no` in DB).<br>• Edit modal pre-populates accurately (case-insensitive mapping). | **PASS:** Pre-selects `Yes` or `No` accurately without resetting to blank when opening Edit modal. |
| **Visited Factory / Office?** | Boolean Toggle (`Yes` / `No`) | • Default: `No`.<br>• When toggled to `Yes`, enables **Visit Remarks**, **Factory Videos**, and **Visit Photos & Media** upload. | **PASS:** Contextual inspection inputs smoothly expand when toggled to `Yes`. |

---

### 7.2 Saving, Inline Editing & Two-Way Sync Verification

```
[ Inside Form Modal ]  <====== Real-Time 2-Way Sync ======>  [ List Table Inline ]
         │                                                            │
         │ (Full Profile Save)                         (Instant Patch │ Grade & Potential)
         ▼                                                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   CENTRAL DATABASE (/suppliers)                         │
└────────────────────────────────────────────────────────────────────────┘
                                 │
                                 │ Opens via Blue Link
                                 ▼
               [ Complete View (720px Side Drawer) ]
```

1. **Inside Form Modal Creation & Update:**
   * **Mandatory Field Enforcement:** Submitting without `Company Name`, `Country`, `Province`, `City`, or `Category` stops submission with clear input highlights.
   * **Clean Save & Persistence:** Submitting valid form sends `POST` (create) or `PUT` (edit) to `/suppliers`, displays success toast, closes modal, and refreshes table without losing active pagination/filters.
   * **Edit Pre-population:** Opening edit modal loads 100% of existing supplier fields, including multi-select arrays, secondary contacts, address, and media links.
2. **Table Row Inline Editing (Grade & Potential):**
   * **Grade Dropdown:** Modifying the grade inline triggers an immediate background `PATCH /suppliers/:id` with `{ supplier_grade: newGrade }`.
   * **Potential Dropdown:** Modifying potential inline triggers an immediate background `PATCH /suppliers/:id` with `{ potential: newPotential }`.
   * **Optimistic UI:** Row state updates instantly with visual feedback; reverts if network error occurs.
3. **Two-Way Synchronization Across Modes:**
   * Changing Grade or Potential via **Inline Table Edit** immediately reflects in the **Complete View (Side Drawer)** and **Inside Form Modal** without requiring a page refresh.
   * Saving updates via **Inside Form Modal** immediately updates the corresponding row cells and badge indicators in the **List Table View**.

---

### 7.3 Blue Company Name Link & Complete View (720px Side Drawer) Audit

> [!IMPORTANT]
> **Core UX Requirement: Blue Company Name Link = Complete View (720px Side Drawer)**  
> Clicking the company name link in the table must NEVER trigger a full page navigation or open a partial preview. It MUST slide open the **720px Side Drawer** displaying the **100% complete, full detail profile** of that supplier across all 5 structured cards.

#### Verification Points for Blue Link & Side Drawer:
1. **Interactive Blue Link Styling:**
   * Company name must render in bold blue link color (`#2563eb` / `#1d4ed8`) with pointer cursor and subtle underline on hover.
   * Clicking the link opens the 720px Side Drawer from the right edge with a smooth 60fps hardware-accelerated transition.
2. **Complete 5-Card Information Architecture:**
   * **Header Bar:**
     * Prominent title: `Supplier Detail #<Company Name>`
     * Badges: Supplier Type (`Manufacturer` / `Trader`), Active/Inactive status badge.
     * Direct Action Button: `✏️ Edit Supplier` button that immediately launches the full edit modal with pre-populated values.
   * **Card 1: 🏢 Company Profile & Classification:**
     * Complete display of Company Name, Supplier Type, Brand, Tax ID / Unified Social Credit Code, Country, Province/State, City.
     * **Full Address:** Renders complete street/building address spanning full width.
     * **Categorization Badges:** All Product Categories, Sub-Categories, Products Supplied rendered as colored tag chips, plus Secondary Products text.
   * **Card 2: 👤 Primary Contact Information:**
     * Primary Contact Person & Designation.
     * Calling Number with direct clickable `tel:` link (`📞`).
     * WhatsApp Number with official WhatsApp SVG symbol (`#25D366`) and direct one-click `https://wa.me/<number>` link (`↗`).
     * WeChat Number / ID with official WeChat SVG dual-bubble symbol (`#07C160`).
     * Email Addresses rendered as individual badges with clickable `mailto:` links.
     * Primary Website & Secondary Website rendered with `🌐` and `↗` links opening in new browser tabs.
   * **Card 3: 🏭 Factory Visit & Inspection Media:**
     * Factory Visited status: Green `✓ Yes, Visited` or neutral `No` badge.
     * Inspector Visit Remarks formatted with proper line breaks.
     * Factory Videos & Cloud Folders: Smart interactive badges recognizing YouTube (`▶️ YouTube Video ↗`), Google Drive (`📁 Google Drive ↗`), OneDrive (`📂 OneDrive ↗`), Vimeo (`🎬 Vimeo ↗`), or generic cloud links.
     * Factory Inspection Photos: Responsive thumbnail grid allowing full-resolution click-to-preview.
   * **Card 4: 📊 Pipeline Status & Commercial Evaluation:**
     * Supplier Grade pill (`Grade A` / `Grade B` / `Grade C`).
     * Current Status pill (`Existing` / `New`).
     * Potential Status: Distinct green `YES` or red `NO` badge.
     * Reason for Potential: Detailed narrative of why supplier is or isn't high-potential.
     * Overall Remarks: Strategic notes and payment terms.
   * **Card 5: 👥 Additional Contacts Roster:**
     * Displays all secondary contact profiles.
     * Each contact card includes: Name, Designation, Handling Territory badge (`📍 Local China`, `📍 Export India`, `📍 Export Africa`, etc.), and clickable phone, WhatsApp, WeChat, and email links.

---

### 7.4 Table Column Architecture & Layout Checklist (11 Consolidated Columns)

To eliminate horizontal scrolling fatigue and provide maximum information density, the Supplier list table is consolidated into **11 optimized columns**:

| Col # | Column Header | Content & Layout Rules | Verification Check |
| :---: | :--- | :--- | :--- |
| **1** | `[ ]` (Checkbox) | Row selection checkbox for bulk operations and export. | Multi-select and Select All in header operate smoothly. |
| **2** | `Sr. No.` | Sequential row index based on current page offset. | Correct sequence across pagination pages. |
| **3** | `Company Name & Brand` | • **Line 1:** Company Name in **blue link** with 2-line text clamp (`-webkit-line-clamp: 2`) and full name hover tooltip.<br>• **Line 2:** Brand Description rendered underneath with tag badge (`🏷️ <Brand>`). | Clicking blue name opens 720px Side Drawer; long names clamp gracefully without breaking row height. |
| **4** | `Category & Sub-Category` | • **Line 1:** Category chips (`🏷️ <Category>`).<br>• **Line 2:** Sub-category chips indented underneath (`↳ 📂 <Sub-Category>`). | Clear visual hierarchy; eye-expander or tooltip shows chips exceeding limit. |
| **5** | `Products Supplied & Secondary` | • **Line 1:** Primary Products Supplied chips.<br>• **Line 2:** Secondary products description text (`↳ <Secondary>`). | Consolidated in a single column without horizontal overflow. |
| **6** | `Province & City` | Geographic location formatted as `<Province>, <City>` (e.g. `Guangdong, Foshan`). | Accurate geographic location; redundant Country column hidden. |
| **7** | `Supplier Type` | Badge: `Manufacturer` (blue) vs. `Trader` (purple). | High-contrast visual differentiation. |
| **8** | `Status` | Pill badge: `Existing` (emerald green) vs. `New` (amber). | Clear lifecycle status indication. |
| **9** | `Grade` | **Inline editable dropdown:** `Grade A`, `Grade B`, `Grade C`. | Dropdown changes immediately save in background without opening modal. |
| **10** | `Potential` | **Inline editable dropdown:** `Yes` (green), `No` (gray). | Dropdown changes immediately save in background without opening modal. |
| **11** | `Actions` | • `✏️ Edit`: Opens full Edit Modal.<br>• `🗑️ Delete`: Soft-deletes record (blocked if `Existing` or `Potential == Yes`). | Deletion protection enforces business rules; edit pre-populates all data. |

* **Layout Constraints:**
  * **Zero Horizontal Scrollbar on 1080p:** 11-column consolidated layout fits cleanly within standard 1920×1080 screen resolution.
  * **Freeze Columns Support:** Checkbox, Sr. No., and Company Name & Brand can be pinned to the left edge while horizontally panning extra columns on smaller screens.
  * **Column Customizer:** Column visibility toggle dropdown allows toggling columns on and off dynamically.

---

### 7.5 Top Multi-Filter Views & Search Reset Verification

| Filter Control | Source / Options | Operational Verification Rules | Reset Behavior |
| :--- | :--- | :--- | :--- |
| **Global Keyword Search** | Text input | Searches across `company_name`, `brand_description`, `contact_person`, and `products_supplied`. Debounced at 250ms. | Clearing input resets table to unfiltered state. |
| **Category** | Searchable Master Dropdown | Filters suppliers associated with selected parent categories. Unlocks and restricts Product Sub Category filter. | Resetting restores all categories. |
| **Product Sub Category** | Unlocked Typeahead Master | • When Category selected: filters within that category.<br>• **When Category empty:** Allows direct typeahead search across **ALL** sub-categories in the master database.<br>• Includes `"All"` reset option. | Selecting `"All"` clears filter and queries all sub-categories. |
| **Product** | Unlocked Typeahead Master | • When Sub-Category / Category selected: filters within that hierarchy.<br>• **When Category empty:** Allows direct typeahead search across **ALL** products in the master database.<br>• Includes `"All"` reset option. | Selecting `"All"` clears product restriction. |
| **Country** | Master Select | Defaults to all or China. Filtering by country cascades to Province filter. | Resetting to `"All"` queries all countries. |
| **Province / State** | Unlocked Typeahead Master | • When Country selected: lists provinces of that country.<br>• **When Country empty:** Allows direct typeahead search across **ALL** provinces in the master database.<br>• Includes `"All"` reset option. | Selecting `"All"` clears province restriction. |
| **City** | Unlocked Typeahead Master | • When Province selected: lists cities of that province.<br>• **When Province empty:** Allows direct typeahead search across **ALL** cities in the master database.<br>• Includes `"All"` reset option. | Selecting `"All"` clears city restriction. |
| **Supplier Type** | Select | Options: `All`, `Manufacturer`, `Trader`. | `"All"` displays both types. |
| **Supplier Grade** | Select | Options: `All`, `Grade A`, `Grade B`, `Grade C`. | `"All"` displays all grades. |
| **Current Status** | Select | Options: `All`, `Existing`, `New`. | `"All"` displays both statuses. |
| **Potential** | Select | Options: `All`, `Yes`, `No`. | `"All"` displays both potential flags. |
| **Visited Factory / Office?** | Select | Options: `All`, `Yes`, `No`. | `"All"` displays both visited statuses. |

---

### 7.6 Bulk Import & Export Pipeline Verification

1. **Sample Template Generation & Export:**
   * Export action generates valid `.xlsx` / `.csv` spreadsheet with comprehensive headers:
     * Company Details: `Name of Company*`, `Supplier Type`, `Brand Description`, `Tax ID Number`, `Country*`, `Province / State*`, `City*`, `Address`.
     * Product Capabilities: `Product Category (multiple)*`, `Key Strength Sub-Category (multiple)`, `Products Supplied (multiple)`, `Secondary Products`.
     * **Primary Contact:** `Contact Person`, `Designation`, `Calling Number`, `WhatsApp Number`, `WeChat Number / ID`, `Email Addresses`, `Primary Website`, `Secondary Website`.
     * **Secondary Contact (Dual Contact Support):** `Contact Person 2`, `Designation 2`, `Calling Number 2`, `WhatsApp Number 2`, `WeChat Number 2`.
     * Audit & Commercials: `Visited Factory / Office?`, `Visit Remarks`, `Factory Videos / Cloud Links`, `Supplier Grade`, `Current Status`, `Potential (Yes / No)`, `Reason for Potential`, `Overall Remarks`.
   * **Schema Verification:** Confirms `Town` column is permanently absent from export headers.
2. **Multi-Number Phone Parsing & Schema Limits:**
   * Supports comma and slash-delimited multi-numbers in phone columns (e.g. `+86 13800000001, +86 13800000002 / +86 13800000003`).
   * Database phone columns accommodate up to 150 characters (`VARCHAR(150)`).
3. **Import Duplicate Detection & Master Resolution:**
   * Verifies company name against existing database records; blocks accidental duplicates or provides merge options.
   * Auto-resolves Province and City names against master databases with fuzzy/exact matching.
   * **Cross-Module Isolation:** Strictly enforces that Supplier import templates are only accepted in `/suppliers/import` and rejected if attempted inside `/buyers/import`.

---

### 7.7 Loading Time & System Performance Benchmarks

To guarantee high system responsiveness, the Supplier module must adhere to the following performance benchmarks:

| Performance Metric | Target Benchmark | Architectural Optimization & Verification Method |
| :--- | :--- | :--- |
| **Initial Table Load (API Latency)** | **< 100 ms** (Cached) / **< 300 ms** (Cold) | • Backend route `GET /api/v1/suppliers` implements in-memory caching (TTL 60s) with automatic invalidation on create/update/delete events.<br>• Eager loading (`selectinload`) for categories, sub-categories, and secondary contacts eliminates N+1 query bottlenecks.<br>• Latency dropped from ~606 ms to **91.48 ms** for cached requests. |
| **Instant Navigation (SWR Cache)** | **0 ms** (Instant) | • `Suppliers.tsx` utilizes `supplierListCache` preserving table state in client memory across router navigations.<br>• Renders instantaneously at 0ms with silent background revalidation, eliminating skeleton flickering. |
| **In-Memory Master Dropdown Lookups** | **0 ms** (Cached) | • Master lookup lists (Categories, Countries, Provinces, Cities) are fetched once and cached in-memory.<br>• Opening or re-opening Create/Edit Modal or Dropdown filters renders immediately with zero network delay. |
| **Inline Edit Background PATCH** | **< 150 ms** | • Modifying Grade or Potential triggers optimistic UI update immediately.<br>• Lightweight background `PATCH /api/v1/suppliers/:id` completes in < 150ms without re-fetching full table. |
| **Complete View (720px Side Drawer) Render** | **< 50 ms** (60 FPS) | • Side Drawer renders instantly utilizing existing loaded row state without blocking loading spinners.<br>• CSS transitions run via GPU-accelerated `transform: translateX(0)` at steady 60 FPS. |
| **Keyword Search & Filter Debouncing** | **250 ms debounce** | • Typing in the global search bar debounces API requests by 250ms to prevent request spamming during active keystrokes. |
| **Frontend Bundle & DOM Performance** | **< 3.5s Production Build** | • Vite production bundle compiles cleanly with 0 TypeScript errors.<br>• Table renders cleanly with virtualized/paginated DOM nodes preventing memory leaks. |

---

### 7.8 Contact Persons Auto-Promotion, Primary Management & Two-Way Profile Sync

To ensure zero discrepancy between vendor profile headers and contact roster sub-tables:

1. **Auto-Promotion on Initial Contact Entry:**
   - When a supplier is created without contact details (or has blank `contact_full_name`), the first contact added via the **Contacts** tab is automatically designated as `is_primary = True`.
   - The backend service (`SupplierService.add_contact`) updates the parent `Supplier` row columns (`contact_salutation`, `contact_full_name`, `contact_designation`, `contact_calling_number`, `contact_whatsapp_number`, `contact_wechat_number`, and appends the email to `emails`).
2. **Instant Frontend Profile Form Reflection:**
   - In `frontend/src/pages/Suppliers.tsx`, submitting a contact drawer immediately triggers `refreshSupplierProfileAfterContactChange()`, which updates both `form` state and the background `rows` table without waiting for page reload.
   - When switching back to the **Profile** tab, all inputs under **Primary Contact Information** are populated with the newly saved contact's details.
3. **1-Click "★ Make Primary" & Demotion Handling:**
   - Secondary contacts feature a `★ Make Primary` action button.
   - Promoting a secondary contact via `POST /suppliers/:id/contacts/:contact_id/make-primary` atomically demotes the previous primary contact (`is_primary = False`), assigns `is_primary = True` to the selected contact, and synchronizes the supplier's main profile columns.
4. **Primary Contact Protection:**
   - Direct deletion of a primary contact is blocked (`ConflictException`). The user must designate another contact as primary first before removing a former primary contact, preventing orphaned profile data.
5. **Pre-Fill Hydration for Existing Records:**
   - Opening `openModal()` on a supplier whose `contact_full_name` was previously unpopulated automatically falls back to hydrating from the supplier's primary contact (or first contact in roster), eliminating blank inputs.

---

### 7.9 Lightweight Active Supplier Dropdown Lookup (`GET /api/v1/suppliers/lookup`)

Downstream procurement modules (e.g. **Local Purchase Order**, **Local Purchases Table**, **Inquiries & Quotations**, **Product Prices**) frequently render type-ahead comboboxes to select suppliers.

1. **Ultra-Slim Payload:**
   - Instead of serializing the entire `Supplier` model with all relations (25 KB to 3 MB), `GET /api/v1/suppliers/lookup` returns strictly `{ id, company_name, brand_description, supplier_type }`.
   - Payload size is **4.43 KB** for 44 active suppliers (an 82% reduction).
2. **In-Memory Cache & Sub-Millisecond Search:**
   - Backed by `CacheManager` dropdown cache (`suppliers::dropdown`).
   - Supports optional `?search=<term>` query parameter which evaluates in memory, returning filtered results in **< 1 ms**.
3. **Automatic Active Status Enforcement:**
   - By definition, the lookup query executes with `WHERE deleted_at IS NULL AND is_active = true`.
   - Inactive suppliers (e.g. `LT1`) are omitted automatically, preventing obsolete or inactive vendors from being inadvertently selected for new purchase orders.

---

### 7.10 Active vs Inactive Tab Cache Isolation & Universal Status Filtering

1. **Tab Structure on Master View (`/suppliers`):**
   - The top of the supplier list renders two distinct navigation tabs: **Active** (default) and **Inactive**.
   - The Active tab displays all operational vendors where `is_active = true` (44 suppliers).
   - The Inactive tab displays deactivated vendors where `is_active = false` (e.g. `LT1`), enabling reviewing, reactivation, or permanent soft-deletion according to deletion eligibility rules.
2. **Backend List Query Cache Key (`backend/app/suppliers/routes.py`):**
   - The `/api/v1/suppliers` list query cache key explicitly incorporates exact filter parameters:
     ```python
     filters_repr = ":".join(f"{k}={v}" for k, v in sorted(query.filters.exact.items()))
     cache_key = f"suppliers:{page}:{page_size}:{search}:{filters_repr}:{cat}:{sub_cat}:{prod}"
     ```
   - This prevents cross-tab cache pollution between `is_active=true` and `is_active=false`.
   - All supplier list cache entries are grouped under the `"suppliers"` namespace and invalidated atomically via `delete_namespace("suppliers")` upon any supplier mutation, activation, deactivation, or deletion.
3. **Frontend Tab Switching & Clean Loading State:**
   - Switching between Active and Inactive immediately clears the table rows (`setRows([])`) to eliminate UI flicker.
   - The frontend fallback cache strictly distinguishes default queries on the Active tab from the Inactive tab, ensuring the Inactive tab always reflects true database state.

---

### 7.11 Comprehensive Multi-Field Search & Digit-Normalized Phone Search

The supplier list search bar (`placeholder="Search company, country, contact, city, phone..."`) executes a deeply integrated database search matching all displayed and linked vendor metadata:

1. **Digit-Normalized Phone Search:**
   - Phone numbers stored with international formatting, spaces, or hyphens (e.g. `+91 9561914519` or `+86 138-0013-8000`) match even when users search raw unformatted digits (e.g. `9561914519`, `+919561914519`, or `13800138000`).
   - Uses `regexp_replace(col, '\D', '', 'g') ILIKE '%digits%'` across both primary vendor phone columns (`contact_calling_number`, `contact_whatsapp_number`, `contact_wechat_number`) and child contact records (`SupplierContact.calling_number`, `whatsapp_number`, `wechat_number`).
2. **Contact Persons & WeChat IDs:**
   - Child contact roster members (`SupplierContact.person_name`, `designation`, `email`, `calling_number`, `whatsapp_number`, `wechat_number`) are matched directly through `exists()` subqueries.
3. **Geography & Master Tables:**
   - Searches match country names and codes (`Country.name`, `Country.code`), province/state names (`State.name`, `State.code`), and city names (`City.name`).
4. **Space and Hyphen Normalization:**
   - Strips whitespace and hyphens for company and contact names to support variations (e.g. "Young Sun" vs "Youngsun").
5. **Products & Categories:**
   - Matches linked product categories, sub-categories, and catalogue products (`product_name`, `product_code`, `product_name_tally`, `product_name_invoice`).

