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
| **Company Name\*** | Text | Required, keyword search enabled | Registered business or factory name. Checks for duplicate detection. |
| **Supplier Type** | Select | `Manufacturer` / `Trader` / `Select` | Specifies if the vendor is a direct factory or a trading/agent company. |
| **Brand Description** | Text | Optional | Proprietary brands manufactured or marketed by the supplier. |
| **Tax ID / GST Number** | Text | Optional | Unified Social Credit Code (China) or foreign tax registration number. |
| **Country\*** | Select | Default: **China**, Editable | Country of registration/factory origin. |
| **Province / State\*** | Select | Dependent dropdown | State or province (e.g. Guangdong, Zhejiang, Jiangsu). |
| **City\*** | Select | Dependent dropdown | City of manufacturing facility or sales office (e.g. Foshan, Ningbo, Wenzhou). |
| **Town** | Text | Optional | Sub-district, industrial park, or town level location. |
| **Address** | Textarea | Optional | Complete street/building address of factory or office. |

### 2.2 Product Capabilities & Categorization
| Field Name | Type | Constraints / Rules | Description |
| :--- | :--- | :--- | :--- |
| **Product Categories** | Multi-Select | Linked to Category Master | Primary industries served (e.g., Machines, Food Ingredients, Chemicals, Pumps). |
| **Sub-Categories** | Multi-Select | Linked to Sub-Category Master | Key strength sub-categories (e.g., Band Sealer, Citric Acid, Caustic Soda). |
| **Products Supplied** | Multi-Select | Linked to Product Master | Specific catalogue items supplied by this vendor. |
| **Secondary Products** | Textarea | Description | Supplementary or non-core items the factory can fabricate or source on demand. |

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
1. **Product Category** (Multi-select)
2. **Key Strength Product Sub-Category** (Multi-select)
3. **Country** (Dropdown)
4. **Province / State** (Cascaded Dropdown)
5. **City** (Cascaded Dropdown)
6. **Supplier Type** (`Manufacturer` / `Trader` / `All`)
7. **Supplier Grade** (`Grade A` / `Grade B` / `Grade C` / `All`)
8. **Current Status** (`Existing` / `New` / `All`)
9. **Potential** (`Yes` / `No` / `All`)
10. **Visited Factory / Office?** (`Yes` / `No` / `All`)

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
  * Company Name, Supplier Type, Brand Description, Tax ID / GST Number, Town, Country, State, City, Full Address.
  * Category chips, Sub-Category chips, Products Supplied chips, Secondary Products description.
* **Card 2: 👤 Primary Contact Information:**
  * Contact Person, Designation.
  * Calling Number with direct clickable `tel:` link.
  * WhatsApp Number with direct clickable `https://wa.me/...` link (`↗`).
  * WeChat Number/ID with WeChat badge (`🗨️`).
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

* **2026-10-13 (Side Drawer & Potential Dropdown Alignment):**
  * Expanded Side Drawer to **720px width** with clean 5-card layout.
  * Added **Tax ID**, **Town**, **Visit Remarks**, and **Factory Video Links** (with smart YouTube, Drive, OneDrive badges) to the Side Drawer.
  * Fixed case-sensitivity bug where database `potential: "yes"` did not match capitalized `<option value="Yes">` in the Edit Modal.
  * Synchronized code in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx).
* **2026-10-12 (Local Purchase Searchable Dropdown):**
  * Upgraded Local Purchase supplier field from static `<select>` to dynamic type-ahead `SearchableDropdown`.
