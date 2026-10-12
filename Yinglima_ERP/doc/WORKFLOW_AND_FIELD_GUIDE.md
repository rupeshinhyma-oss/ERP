# Yinglima ERP — Master Workflow & Field Reference Guide

**System:** Yinglima ERP (China Procurement & Trade Export Engine)  
**Target Audience:** Operations, QA Testers, System Administrators, and Developers  
**Purpose:** Comprehensive blueprint of every module, form field, data source, duplicate constraint, and end-to-end testing workflow with realistic copy-paste test data.

---

## 1. System Ecosystem & End-to-End Workflow Map

```
┌─────────────────┐       ┌────────────────────┐       ┌──────────────────────┐
│ 1. SUPPLIERS    │ ───>  │ 4. PRODUCT PRICES  │ ───>  │ 7. LOCAL PURCHASE    │
│ & BUYERS        │       │ (Quotation Matrix) │       │ (Confirmed Invoices) │
└─────────────────┘       └────────────────────┘       └──────────────────────┘
         │                           │                            │
         ▼                           ▼                            ▼
┌─────────────────┐       ┌────────────────────┐       ┌──────────────────────┐
│ 3. PRODUCT      │ ───>  │ 6. INQUIRIES (RFQ) │ ───>  │ 8. SHIPMENT PLANNING │
│ MASTER          │       │ & AI Mailbox       │       │ (Container CBM Grid) │
└─────────────────┘       └────────────────────┘       └──────────────────────┘
                                                                  │
                                                                  ▼
                                                       ┌──────────────────────┐
                                                       │ 9. SALE PROCESS      │
                                                       │ (16-Col CI & Export) │
                                                       └──────────────────────┘
```

### The 7 Core Operational Phases
1. **Master Setup:** Register verified Chinese factory **Suppliers** and overseas **Buyers**.
2. **Product Cataloging:** Build **Product Master** specifications (Dimensions, CBM, Weights, China HS Code, 13% Refund VAT).
3. **Price Discovery:** Record supplier quotes in **Product Prices**, setting manual preferred suppliers (`⭐ Preferred`).
4. **Client Inquiry / RFQ:** Receive buyer requirement, generate RFQ in **Inquiries**, auto-dispatch emails to suppliers, ingest replies with AI bill extraction.
5. **Domestic Factory Purchase:** Execute **Local Purchase** in RMB (`¥`), allocating landing costs (transport/offloading) and tracking 13% domestic VAT. Status moved to `Confirmed`.
6. **Container Planning:** Allocate planned order items into shipping container consignments in **Shipment Planning** (optimizing 20GP/40GP/40HQ CBM).
7. **Export Commercial Invoicing (CI):** Pull planned consignment into **Sale Process**, auto-sourcing factory RMB rates and supplier names from Confirmed Local Purchases, allocating container freight per m³, adding export margin %, computing FOB/CFR USD prices, and generating official 16-column Excel trade documents (`CI` + `Packing List`).

---

## 2. Module 1: Suppliers (`/suppliers`)

### Business Purpose
Captures verified Chinese factories, trading companies, and agents. Sourced throughout the ERP for quotation benchmarking, RFQ dispatch, Local Purchase procurement, and Commercial Invoices.

### Form Fields & Source Reference

| Field Label | Input Type | Source of Truth | Validations / Constraints | System Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **Company Name** | Text / Typeahead | User Typed | Required, Min 2 chars | Checks for existing similar suppliers. Shows `⛔ Supplier already exists` if duplicate. |
| **Supplier Type** | Dropdown | Master (`supplier_types`) | Optional | Choices: `Manufacturer`, `Trader`, `Dealer`, `Agent`, `Exporter`. |
| **Country** | Dropdown | Master (`countries`) | Required | Defaults to **China**. |
| **Province / State** | Dropdown | Master (`states`) | Required | Filtered dynamically by selected Country (e.g., Zhejiang, Guangdong). |
| **City** | Dropdown | Master (`cities`) | Required | Filtered dynamically by selected Province (e.g., Wenzhou, Ningbo, Shenzhen). |
| **Town / District** | Text | User Typed | Optional | Street, industrial zone, or sub-district. |
| **Detailed Address** | Textarea | User Typed | Optional | Full factory address in English/Chinese. |
| **Tax ID / USCC** | Text | User Typed | Optional | China Unified Social Credit Code (18 digits). |
| **Contact Person** | Text | User Typed | Optional | Primary sales contact at factory. |
| **Mobile / Phone** | Text | User Typed | Optional | Checked for duplicate phone numbers across suppliers. |
| **Email ID** | Email | User Typed | Optional | Target address for automated RFQ mail dispatch. |
| **WeChat ID** | Text | User Typed | Optional | Primary communication channel in China. |
| **Supplier Grade** | Dropdown | Enum | Optional | `A`, `B`, or `C`. |
| **Current Status** | Dropdown | Enum | Default `New` | Once moved to `Existing`, business rules lock it from returning to `New`. |
| **Potential** | Dropdown | Enum | Default `Select` | `Yes` or `No`. |
| **Visit Photos** | Multi-File | User Upload | JPG, PNG, WEBP (<10MB) | Persisted to Supabase storage; gallery preview. |
| **Video Links** | Text / Tags | User Typed | Valid URLs | Smart pills: YouTube `▶️`, Google Drive `📁`, OneDrive `📂`, Video `🎥`. |

### Duplicate Matching & Edge Cases
- **Duplicate Name Alert:** Typing an existing company name highlights the input in red with `⛔ Supplier already exists` and disables submission.
- **Similar Name Warning:** Shows `EXISTING SIMILAR SUPPLIERS` dropdown allowing user to link an existing supplier instead of creating duplicate records.

### Copy-Paste Test Dataset
```json
{
  "company_name": "Zhejiang Dingye Machinery Co., Ltd.",
  "supplier_type": "Manufacturer",
  "country": "China",
  "state": "Zhejiang",
  "city": "Wenzhou",
  "address": "No. 158 Dongmeng Road, Ruian City, Wenzhou, Zhejiang, China",
  "tax_id_number": "91330381712345678X",
  "contact_full_name": "Kevin Chen",
  "contact_calling_number": "+86 138 5771 9988",
  "contact_wechat_number": "dingye_kevin",
  "contact_email": "sales@dingyemachinery.com",
  "supplier_grade": "A",
  "current_status": "Existing",
  "potential": "Yes"
}
```

---

## 3. Module 2: Buyers (`/buyers`)

### Business Purpose
Maintains international customer records (importers, distributors, retail brands) who receive Commercial Invoices, Proforma Invoices, and Shipments.

### Form Fields & Source Reference

| Field Label | Input Type | Source of Truth | Validations / Constraints | System Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **Company Name** | Text | User Typed | Required, Unique | Primary buyer identifier across Inquiries & Sales Orders. |
| **Buyer Type** | Dropdown | Master (`buyer_types`) | Optional | `Importer`, `Wholesaler`, `Direct Retailer`. |
| **Country** | Dropdown | Master (`countries`) | Required | Target destination country (e.g., India, UAE, USA). |
| **Province / State** | Dropdown | Master (`states`) | Required | State/Province for customs destination clearance. |
| **City** | Dropdown | Master (`cities`) | Required | Destination city. |
| **Full Address** | Textarea | User Typed | Required | Printed directly onto Commercial Invoice recipient block. |
| **IEC / Tax / GST No**| Text | User Typed | Optional | Importer Exporter Code or National Tax ID. |
| **Contact Person** | Text | User Typed | Optional | Printed onto Commercial Invoice recipient header. |
| **Phone Number** | Text | User Typed | Optional | Contact telephone/mobile. |
| **Email ID** | Email | User Typed | Optional | Invoice and quotation dispatch target. |
| **Branches / Delivery Locations** | Sub-table | User Typed | Optional | Supports multiple delivery branches (e.g., Mumbai, Delhi, Nhava Sheva). |

### Copy-Paste Test Dataset
```json
{
  "company_name": "Inhyma Industrial Pack Solutions Pvt Ltd",
  "buyer_type": "Importer",
  "country": "India",
  "state": "Maharashtra",
  "city": "Mumbai",
  "address": "Plot 42, MIDC Industrial Area, Andheri East, Mumbai 400093, India",
  "tax_id_number": "27AAACI1234F1Z5",
  "contact_person": "Rupesh Patel",
  "phone": "+91 98200 12345",
  "email": "procurement@inhyma.com",
  "branch_name": "Nhava Sheva Warehouse Unit 2"
}
```

---

## 4. Module 3: Product Master (`/products`)

### Business Purpose
The central catalog of all purchasable and sellable machinery, spare parts, and packaging consumables. Defines physical dimensions, HSN codes, and export tax rules.

### Form Fields & Source Reference

| Field Label | Input Type | Source of Truth | Validations / Constraints | System Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **Product Name** | Text | User Typed | Required, Unique | System name used internally across ERP. |
| **Invoice Product Name**| Text | User Typed | Optional | Formal export description printed onto official Commercial Invoice. |
| **Product Code / SKU**| Text | User / Auto | Unique | e.g. `INH-01039`. Auto-generated if omitted. |
| **Category** | Dropdown | Master (`product_categories`) | Required | e.g. `Packaging Machinery`, `Filling Systems`. |
| **Sub-Category** | Dropdown | Master (`product_sub_categories`)| Optional | Filtered by selected Category. |
| **Primary Supplier** | Dropdown / Search | Master (`suppliers`) | Optional | Preferred factory mapped to `products.supplier_id`. Fully supported in CSV/Excel Export & Import. |
| **China HS Code** | Dropdown / Search | Master (`hsn_codes`) | Required | 8 or 10-digit China export HS Code (e.g., `8422.30.00`). |
| **Primary UOM** | Dropdown | Master (`units_of_measurement`)| Required | Defaults to `NOS` (or `PCS`, `SET`). |
| **Refund VAT (%)** | Number (%) | Master (`hsn_codes`) | 0.00% to 17.00% | Inherited from HS Code (Default: **13.00%**). Crucial for CI cost breakdown! |
| **Length (cm)** | Number (cm) | User Typed | >= 0 | Outer packaging carton length. |
| **Width (cm)** | Number (cm) | User Typed | >= 0 | Outer packaging carton width. |
| **Height (cm)** | Number (cm) | User Typed | >= 0 | Outer packaging carton height. |
| **Packaging Unit CBM**| Number (m³) | Auto Computed | Formula | `= (L × W × H) / 1,000,000`. Overridable if irregular pack. |
| **Packaging Quantity**| Number | User Typed | Default `1.0` | Number of product units per master carton. |
| **Gross Weight (kg)** | Number (kg) | User Typed | >= Net Weight | Master carton gross weight with crate/pallet. |
| **Net Weight (kg)** | Number (kg) | User Typed | <= Gross Weight | Naked machine/product weight. |
| **Standard Cost (¥)** | Number (RMB)| User Typed | Optional | Fallback purchase price if no Local Purchase exists. |
| **Product Photos** | Multi-File | User Upload | JPG, PNG (<10MB) | Up to 10 photos saved to Supabase storage. |

### Duplicate Matching & Edge Cases
- **Duplicate Name Check:** Live debounce validation queries `/masters/products/check-name`. If duplicate exists, displays red text `⚠️ Product name already exists in master!` and disables the Save button.
- **Zero Dimension Trap:** If L, W, or H is `0`, CBM evaluates to `0.000000`, causing freight allocation in Sale Process to become zero. Always supply dimensions or CBM.

### Copy-Paste Test Dataset
```json
{
  "product_name": "FR900 Continuous Band Sealer MSH",
  "product_name_invoice": "CONTINUOUS HORIZONTAL BAND SEALER MODEL FR-900 (PAINTED BODY)",
  "product_code": "INH-01039",
  "category": "Packaging Machinery",
  "hsn_code": "8422.30.00",
  "uom": "NOS",
  "refund_vat_percent": 13.0,
  "length": 88.0,
  "width": 42.0,
  "height": 38.0,
  "packaging_unit_cbm": 0.140448,
  "packaging_quantity": 1.0,
  "packaging_gross_weight": 23.5,
  "packaging_net_weight": 21.0
}
```

---

## 5. Module 4: Product Prices (Quotation Matrix) (`/product-prices`)

### Business Purpose
Multi-supplier quotation comparison grid. Tracks competitive factory quotes, minimum order quantities (MOQ), and designates the benchmark **Preferred Supplier** (`⭐ Preferred`).

### Key Workflow & Controls
1. **Compare Quotations (`Compare ▾`):** Expands row to reveal all factory bids for the item.
2. **Assign Preferred Supplier (`[⭐ Set Preferred]`):** Sets `products.supplier_id`. When Local Purchase or Inquiry adds this product, this supplier auto-fills first.
3. **Lowest Bid Badge (`[ LOWEST ]`):** Auto-highlights the cheapest available quote for immediate cost comparison.
4. **Live Multi-Currency Parity:** Instant currency switching (`USD`, `RMB/CNY`, `EUR`, `INR`) with converted estimate hints `(~$ ...)`.

---

## 6. Module 5: Inquiries & RFQ Engine (`/inquiries`)

### Business Purpose
Captures customer requests, dispatches automated Request for Quotation (RFQ) emails to candidate Chinese factories, and parses supplier replies via IMAP mail poller and AI bill extraction.

### Step-by-Step Flow
1. **Create Inquiry:** Select Buyer, Inquiry Date, and add requested products with target quantities.
2. **Assign Suppliers:** Select 1 or more Chinese factories from Supplier master.
3. **Dispatch RFQ:** System formats email with product specifications and sends via backend SMTP.
4. **Supplier Reply Ingestion:** Backend background poller checks `INBOX` and `[Gmail]/Sent Mail`, matches RFQ subject token, and updates status to `Replied`.
5. **AI Extraction:** Extracts unit prices, lead times, and terms directly into quotation comparison lines.

---

## 7. Module 6: Local Purchase (Domestic China Procurement) (`/purchase/local`)

### Business Purpose
Records actual domestic factory purchase invoices in Chinese Yuan (`¥` RMB). Calculates Value-Based (VB) landing costs and provides the **Primary Source of Truth** for factory purchase rates and suppliers in the Sale Process.

### Form Fields & Source Reference

| Field Label | Input Type | Source of Truth | Validations / Constraints | System Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **Supplier** | Dropdown | Master (`suppliers`) | Required | Verified Chinese factory where goods were bought. |
| **Invoice No** | Text | Factory Invoice | Required, Unique per supplier | Official domestic invoice number. |
| **Invoice Date** | Date | Factory Invoice | Required | Domestic tax invoice issue date. |
| **Invoice Total Value with VAT (¥)** | Number (RMB) | Factory Invoice | Required, > 0 | **Total cash payable to factory including 13% VAT**. |
| **Bill Document** | File Upload | PDF, Excel, Image | Optional | Scanned tax invoice or factory delivery challan. |
| **Packing & Forwarding (¥)** | Number (RMB) | Expense Voucher | Optional, >= 0 | Allocated proportionally to line items. |
| **Transport / Freight (¥)** | Number (RMB) | Expense Voucher | Optional, >= 0 | Domestic trucking to warehouse/port. |
| **Offloading Charges (¥)** | Number (RMB) | Expense Voucher | Optional, >= 0 | Labor charges for container loading. |
| **Other Misc Charges (¥)** | Number (RMB) | Expense Voucher | Optional, >= 0 | Documentation or testing fees. |
| **Line Items Table:** | | | | |
| - *Product Name* | Search / Add | Product Master | Required | Catalog item. |
| - *Quantity* | Number | User Typed | Required, > 0 | Quantity delivered by factory. |
| - *Unit Rate (¥)* | Number | User Typed | Required, > 0 | **Basic purchase rate EXCLUDING VAT per unit**. |
| - *VAT %* | Number (%) | Default 13% | 0% to 17% | Chinese VAT rate on domestic invoice. |
| - *Item Total (¥)* | Read-only | Formula | `= Qty × Unit Rate` | Basic item total before tax. |
| - *VAT Amount (¥)* | Read-only | Formula | `= Item Total × (VAT% / 100)` | Domestic VAT amount. |
| - *Unit Landing Rate (¥)* | Read-only | Formula | `= Unit Rate + Expense/Unit` | Landed factory cost per unit. |
| - *Total Landing Rate (¥)* | Read-only | Formula | `= Qty × Unit Landing Rate` | Total landed expenditure. |

### Validation Bar: "Invoice Total Matches Line Items Perfectly"
- System sums: `Basic Items Total + Total VAT Amount + Total Expenses`.
- Compares against top field: `Invoice Total Value with VAT (¥)`.
- If difference is `< 0.05 ¥`, displays a glowing green banner:  
  `✔ Invoice Total Matches Line Items Perfectly (¥ 8,056.90)`.
- If mismatch, displays red mismatch alert showing exact variance.

### Copy-Paste Test Dataset
```json
{
  "supplier": "Zhejiang Dingye Machinery Co., Ltd.",
  "invoice_no": "INV-DY-2026-0089",
  "invoice_date": "2026-10-05",
  "invoice_total_value": 8056.90,
  "expenses": {
    "packing_forwarding": 0.00,
    "transport_freight": 0.00,
    "offloading": 0.00,
    "other_misc": 0.00
  },
  "items": [
    {
      "product": "FR900 Band Sealer MSH",
      "quantity": 10,
      "unit_rate": 713.00,
      "vat_rate": 13.0
    }
  ]
}
```

---

## 8. Module 7: Shipment Planning (`/planning`)

### Business Purpose
Container packing and consignment management grid. Consolidates multiple orders into physical shipping containers (20GP, 40GP, 40HQ), tracking volume utilization (CBM) and packaging units.

### Container Capacity Standards
- **20GP (General Purpose):** Max usable payload ~`28.0 m³`, ~`21,000 kg`.
- **40GP (General Purpose):** Max usable payload ~`58.0 m³`, ~`26,000 kg`.
- **40HQ (High Cube):** Max usable payload ~`68.0 m³`, ~`26,000 kg`.
- **45HQ (High Cube):** Max usable payload ~`78.0 m³`, ~`28,000 kg`.

### Key Columns & Formula Actions
- **Consignment Column:** Groups rows under a specific destination consignment (e.g. `Muminhyma 5`).
- **Linked Record ID:** Links row to Product Master. Automatically derives CBM per piece and gross weight.
- **Quantity Planned:** Number of physical units assigned to the container.
- **Total CBM:** `= Packaging CBM / Packaging Qty * Planned Qty`.
- **Total Carton Boxes:** `= CEILING(Planned Qty / Packaging Qty)`.

---

## 9. Module 8: Sale Process & Official Commercial Invoice (`/sale/process`)

### Business Purpose
The primary export billing engine. Replicates Yinglima's official Commercial Invoice spreadsheet (`doc/Yinglima_CI_Inhyma_YL-EXP2026-54.xlsx`, Row 14). Calculates container ocean freight allocations, export profit margins, FOB prices, and CFR rates.

### The 16 Official Commercial Invoice Columns

| Col # | Exact Column Header | Data Source & Formula | Editable? | Notes & Purpose |
| :---: | :--- | :--- | :---: | :--- |
| **1** | `Sr.No` | Sequential row index (1, 2, 3...) | Auto | Row numbering. |
| **2** | `Description` | Product Name & Code from Master | Read-only | Official commercial product description. |
| **3** | `HS CODE AS PER CHINA` | `hsn_codes.code` via Product Master | Read-only | 8-digit China customs export declaration code. |
| **4** | `UOM` | `units_of_measurement` (Default: `NOS`)| Editable | Unit of Measurement (e.g. `NOS`, `PCS`, `SET`). |
| **5** | `Quantity` | From Consignment or User Entered | Editable | Planned consignment export quantity. |
| **6** | `Unit Price (USD)` | `= Col 13 (CFR Price/Unit)` | Editable (USD)| Final billed price to buyer. Can be overridden in USD. |
| **7** | `Total Amount (USD)` | `= Col 6 × Col 5 (Unit Price USD × Qty)`| Read-only | Total export invoice line value in US Dollars. |
| **8** | `Unit Price(RMB) Including VAT`| **Auto-sourced from Confirmed Local Purchase** | Editable (¥)| `= LP Unit Rate × (1 + LP VAT% / 100)`. Green badge `[✓ Local Purchase]`. |
| **9** | `Unit Price(RMB) Excluding VAT`| `= Col 8 / (1 + (HSN Refund VAT% / 100))` | Read-only | Strips domestic VAT. Equals LP Unit Rate exactly! |
| **10** | `Including Profit X%` | `= Col 9 × (1 + (Profit% / 100))` | Read-only | Adds export trading profit margin (Default: `3%`). |
| **11** | `FOB PRICE (USD @rate)` | `= Col 10 / USD Exchange Rate` | Read-only | Pure FOB port price in USD (Default exchange rate: `6.70`). |
| **12** | `Freight, Local charges, COC`| `(Total Freight $ / Container CBM) × (Line CBM / Qty)`| Read-only | Value-based ocean & local freight allocated per unit. |
| **13** | `CFR Price/Unit` | `= ROUNDUP(Col 11 + Col 12, 2)` | Read-only | Combined CFR price rounded up to nearest cent. |
| **14** | `Supplier` | Auto-sourced from Confirmed Local Purchase | Read-only | Chinese factory supplier name. |
| **15** | `Total CBM` | `= (Unit Packaging CBM × Boxes)` | Editable | Total volume of this line item in cubic meters. |
| **16** | `Total Supplier Amount` | `= Col 8 × Col 5 (Price RMB Incl. VAT × Qty)`| Read-only | Total RMB payable to Chinese factory for this line. |

---

## 10. Module 9: User Management & Role Governance (`/users`)

### Business Purpose
Controls user identities, business roles, and multi-ERP permission matrix.

### Governance Structure
- **Global Roles:** Admin, Procurement Manager, Sales Executive, Logistics Operator, Viewer.
- **Module Permissions:** Discrete Granular access flags:
  - `sales.read`, `sales.write`, `sales.delete`, `sales.export`
  - `purchases.read`, `purchases.write`, `purchases.delete`, `purchases.confirm`
  - `masters.read`, `masters.write`, `masters.delete`
- **Soft Delete & Session Revocation:** Deleting a user revokes active JWT bearer tokens immediately and hides the user from assignment dropdowns.

---

## 11. Module 10: Master Data & System Settings (`/masters/*`)

### Complete Master Tables Reference
1. **Company List (`/masters/company-list`):** Operating entities (`Yinglima LLP`, `Inhyma ERP`).
2. **Countries, States, Cities (`/masters/geo`):** Hierarchical geographic records.
3. **Currencies & Exchange Rates (`/masters/currencies`):** Base currency definition and live conversion table.
4. **HSN Codes (`/masters/hsn`):** China export HS codes with GST and Refund VAT rates.
5. **Units of Measurement (`/masters/uom`):** Primary and secondary measurement units.
6. **Product Categories & Sub-Categories:** Two-tier classification tree.
7. **Brands:** Customer and manufacturer brands.
8. **Option Lists:** Centralized dynamic dropdown options repository.
