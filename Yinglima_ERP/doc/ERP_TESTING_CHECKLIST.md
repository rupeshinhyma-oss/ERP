# Yinglima ERP — Master Test Suite & Interactive Checklist

**System:** Yinglima ERP (China Procurement & Trade Export Engine)  
**Execution Type:** Manual Operator UI Verification & Automated AI Regression Suite  
**Instructions:** For each test case, mark `[x] PASS` or `[ ] FAIL` and record observations in the Notes column.

---

## 1. Master Testing Execution Dashboard

| Module | Total Tests | Manual UI Tests | Automated Script Tests | Status |
| :--- | :---: | :---: | :---: | :---: |
| **1. Suppliers Module** | 12 | 10 | 2 | `READY FOR TESTING` |
| **2. Buyers Module** | 8 | 7 | 1 | `READY FOR TESTING` |
| **3. Product Master Module** | 15 | 12 | 3 | `READY FOR TESTING` |
| **4. Product Prices Module** | 10 | 8 | 2 | `READY FOR TESTING` |
| **5. Inquiries & RFQ Module** | 10 | 8 | 2 | `READY FOR TESTING` |
| **6. Local Purchase Module** | 16 | 13 | 3 | `READY FOR TESTING` |
| **7. Shipment Planning Module**| 12 | 10 | 2 | `READY FOR TESTING` |
| **8. Sale Process & CI Module**| 20 | 16 | 4 | `READY FOR TESTING` |
| **9. Master Data & Settings** | 8 | 6 | 2 | `READY FOR TESTING` |
| **10. User Management & Auth** | 8 | 6 | 2 | `READY FOR TESTING` |

---

## 2. Module 1: Suppliers (`/suppliers`)

| Test ID | Test Description | Test Steps | Expected Behavior | Result | Notes / Observed Behavior |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `SUP-01` | **Add New Supplier (Happy Path)** | 1. Click `+ Add Supplier`<br>2. Fill Company Name, China, Zhejiang, Wenzhou.<br>3. Fill Contact Person & Phone.<br>4. Click Save. | Supplier is created; appears at top of table with green success toast. | [ ] PASS<br>[ ] FAIL | |
| `SUP-02` | **Duplicate Company Name Validation** | 1. Click `+ Add Supplier`<br>2. Type the exact same Company Name as an existing supplier.<br>3. Click outside or blur field. | Red inline warning appears: `⛔ Supplier already exists`. Save button disabled. | [ ] PASS<br>[ ] FAIL | |
| `SUP-03` | **Similar Supplier Suggestion Dropdown** | 1. Type partial name of existing supplier (e.g. `Dingye`). | Dropdown shows `EXISTING SIMILAR SUPPLIERS` with supplier types. | [ ] PASS<br>[ ] FAIL | |
| `SUP-04` | **Geographic Cascading Selection** | 1. Select Country = `China`.<br>2. Check State dropdown.<br>3. Select State = `Zhejiang`.<br>4. Check City dropdown. | State dropdown lists Chinese provinces. City dropdown filters to Zhejiang cities (Wenzhou, Ningbo, Hangzhou). | [ ] PASS<br>[ ] FAIL | |
| `SUP-05` | **Visit Photo Upload** | 1. Upload 2 JPG/PNG photos in Visit Photos area.<br>2. Save supplier.<br>3. Open supplier detail modal. | Photos render as thumbnails; clicking opens high-res image modal. | [ ] PASS<br>[ ] FAIL | |
| `SUP-06` | **Visit Photo Deletion** | 1. Edit supplier with photos.<br>2. Click `🗑` delete on one photo.<br>3. Save supplier. | Deleted photo disappears; remaining photo is preserved in database. | [ ] PASS<br>[ ] FAIL | |
| `SUP-07` | **Video Links Pill Rendering** | 1. Add YouTube and Google Drive links in Video Links field.<br>2. Save and view detail. | Renders interactive pills: `▶️ YouTube` and `📁 Google Drive`. Clicking opens in new tab. | [ ] PASS<br>[ ] FAIL | |
| `SUP-08` | **Status Governance (New -> Existing)** | 1. Change status from `New` to `Existing`.<br>2. Save supplier.<br>3. Edit supplier again. | Once saved as `Existing`, cannot be reverted back to `New`. | [ ] PASS<br>[ ] FAIL | |
| `SUP-09` | **Supplier Search & Filters** | 1. Type city name or contact person in global search box.<br>2. Filter by Grade `A`. | Table filters in real-time matching search query and grade. | [ ] PASS<br>[ ] FAIL | |
| `SUP-10` | **Export Suppliers to Excel** | 1. Click `Export` button in top bar. | Downloads `Suppliers_YYYY-MM-DD.xlsx` containing all active suppliers with complete fields. | [ ] PASS<br>[ ] FAIL | |
| `SUP-11` | **Soft Delete Supplier** | 1. Click `🗑` delete button on row.<br>2. Confirm deletion dialog. | Row disappears from active table; `deleted_at` timestamp set in DB. | [ ] PASS<br>[ ] FAIL | |
| `SUP-12` | **Duplicate Phone/WeChat Alert** | 1. Add supplier with identical phone number to existing supplier. | Warning banner warns operator of duplicate phone number conflict. | [ ] PASS<br>[ ] FAIL | |

---

## 3. Module 2: Buyers (`/buyers`)

| Test ID | Test Description | Test Steps | Expected Behavior | Result | Notes / Observed Behavior |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `BUY-01` | **Add New Buyer** | 1. Click `+ Add Buyer`.<br>2. Enter Inhyma Industrial, India, Mumbai.<br>3. Enter GST/Tax ID & Contact.<br>4. Click Save. | Buyer created and visible in list; searchable by name or country. | [ ] PASS<br>[ ] FAIL | |
| `BUY-02` | **Duplicate Buyer Name Check** | 1. Try adding buyer with identical existing name. | Red error alert prevents creating duplicate buyer profile. | [ ] PASS<br>[ ] FAIL | |
| `BUY-03` | **Add Delivery Branches** | 1. In Buyer form, add 2 delivery branches (e.g. `Mumbai Central` & `Nhava Sheva`).<br>2. Save. | Branches saved in `branches` JSON array; available in Sale Process dropdown. | [ ] PASS<br>[ ] FAIL | |
| `BUY-04` | **Edit Buyer Details** | 1. Edit address and phone of an existing buyer.<br>2. Save and reopen. | Updated address and contact details persist cleanly. | [ ] PASS<br>[ ] FAIL | |
| `BUY-05` | **Soft Delete Buyer** | 1. Delete a test buyer. | Buyer disappears from list; cannot be assigned to new Inquiries. | [ ] PASS<br>[ ] FAIL | |
| `BUY-06` | **Export Buyers to Excel** | 1. Click `Export` button. | Generates formatted Excel file with all buyers and branch locations. | [ ] PASS<br>[ ] FAIL | |
| `BUY-07` | **Inquiry Dropdown Linkage** | 1. Navigate to `/inquiries/new`.<br>2. Open Buyer dropdown. | Newly created buyer appears immediately in the dropdown list. | [ ] PASS<br>[ ] FAIL | |
| `BUY-08` | **Sale Process Buyer Linkage** | 1. Navigate to `/sale/process/new`.<br>2. Select Buyer. | Buyer address and branch options populate automatically. | [ ] PASS<br>[ ] FAIL | |

---

## 4. Module 3: Product Master (`/products`)

| Test ID | Test Description | Test Steps | Expected Behavior | Result | Notes / Observed Behavior |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `PRD-01` | **Add New Product (Happy Path)** | 1. Click `+ Add Product`.<br>2. Enter Name, SKU, Category, UOM.<br>3. Pick HS Code `8422.30.00`.<br>4. Enter Length `88`, Width `42`, Height `38`.<br>5. Click Save. | Product created with auto-calculated CBM `0.140448 m³` and Refund VAT `13.00%`. | [ ] PASS<br>[ ] FAIL | |
| `PRD-02` | **Live Dimension to CBM Auto-Math** | 1. In product form, type L=`100`, W=`50`, H=`40`.<br>2. Observe CBM field. | CBM auto-updates to `0.200000 m³` immediately without manual calculation. | [ ] PASS<br>[ ] FAIL | |
| `PRD-03` | **Duplicate Product Name Check** | 1. Type an existing product name into Name field.<br>2. Pause 300ms. | Red inline warning: `⚠️ Product name already exists in master!`. Save disabled. | [ ] PASS<br>[ ] FAIL | |
| `PRD-04` | **HSN Refund VAT Auto-Sync** | 1. Select HSN `8422.30.00`. | Refund VAT % auto-populates to `13.00%` directly from HSN table. | [ ] PASS<br>[ ] FAIL | |
| `PRD-05` | **Dual-Mode Import: Add New Records** | 1. Click `Import`.<br>2. Select mode `➕ Add New Records Only`.<br>3. Upload CSV with 3 new items and 1 existing item. | 3 new items imported; 1 existing item safely skipped with warning count. | [ ] PASS<br>[ ] FAIL | |
| `PRD-06` | **Dual-Mode Import: Update Existing** | 1. Select mode `✏️ Update Existing Records`.<br>2. Upload CSV modifying dimensions of 2 existing products. | Existing products updated with new dimensions; empty columns in CSV do NOT erase DB values. | [ ] PASS<br>[ ] FAIL | |
| `PRD-07` | **Product Image Upload & Preview** | 1. Upload 3 photos to Product Gallery tab.<br>2. Save product.<br>3. View product in list. | Main thumbnail renders in table; clicking opens carousel gallery. | [ ] PASS<br>[ ] FAIL | |
| `PRD-08` | **Product Image Deletion** | 1. Edit product, remove 1 image.<br>2. Save. | Image removed from database and cloud storage without orphan errors. | [ ] PASS<br>[ ] FAIL | |
| `PRD-09` | **Gross Weight vs Net Weight Validation** | 1. Enter Net Weight = `50 kg` and Gross Weight = `40 kg`. | Form shows validation warning: Gross Weight must be greater than or equal to Net Weight. | [ ] PASS<br>[ ] FAIL | |
| `PRD-10` | **Status Toggle Switch** | 1. Click active/inactive switch on product row. | Product toggles between Active and Inactive; status updates optimistically in DB. | [ ] PASS<br>[ ] FAIL | |
| `PRD-11` | **Export Products Catalog** | 1. Click `Export` -> `Full Catalog (Excel)`. | Downloads spreadsheet containing all 3,500+ products with dimensions, CBM, and HSN. | [ ] PASS<br>[ ] FAIL | |
| `PRD-12` | **Quick Filter by Category** | 1. Filter by `Packaging Machinery`. | Table filters instantly; displays matching machines with category badges. | [ ] PASS<br>[ ] FAIL | |
| `PRD-13` | **Search by China HS Code** | 1. Type `8422` in search bar. | All machinery under HS Code 8422 display with refund tax rates. | [ ] PASS<br>[ ] FAIL | |
| `PRD-14` | **Soft Delete & Trash Tab** | 1. Delete a product.<br>2. Switch to `Trash / Archive` tab.<br>3. Click `Restore`. | Product restored back to active catalog with original SKU. | [ ] PASS<br>[ ] FAIL | |
| `PRD-15` | **UOM Consistency** | 1. Create product with UOM = `SET`.<br>2. Add to Sale Process. | UOM transfers as `SET` rather than defaulting to `NOS`. | [ ] PASS<br>[ ] FAIL | |

---

## 5. Module 4: Product Prices (Quotation Matrix) (`/product-prices`)

| Test ID | Test Description | Test Steps | Expected Behavior | Result | Notes / Observed Behavior |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `PRC-01` | **Add Supplier Quotation** | 1. Click `+ Add Price / Quote`.<br>2. Pick Product, Supplier, Price `450.00 ¥`, Currency `CNY`.<br>3. Save. | Quote added; appears under product quotation accordion. | [ ] PASS<br>[ ] FAIL | |
| `PRC-02` | **Accordion Quotation Comparison** | 1. Click `Compare ▾` on product with multiple quotes. | Expands sub-table displaying all factory bids side-by-side with dates and MOQs. | [ ] PASS<br>[ ] FAIL | |
| `PRC-03` | **Set Manual Preferred Supplier** | 1. In accordion, click `[⭐ Set Preferred]` on factory with higher quality but slightly higher rate.<br>2. Observe table. | Golden `⭐ PREFERRED` badge moves to that factory; `products.supplier_id` updated in DB. | [ ] PASS<br>[ ] FAIL | |
| `PRC-04` | **Automatic Lowest Bid Badge** | 1. Compare 3 quotes: ¥400, ¥450, ¥500. | Factory with ¥400 automatically displays green `[ LOWEST ]` badge. | [ ] PASS<br>[ ] FAIL | |
| `PRC-05` | **Currency Switcher Parity** | 1. Switch global currency toggle to `USD ($)`. | Quotations convert to USD using live exchange rate; converted hint `(~$ 67.16)` appears. | [ ] PASS<br>[ ] FAIL | |
| `PRC-06` | **Inheritance in Local Purchase** | 1. Create new Local Purchase for that product and select the preferred supplier. | Unit rate auto-fills with that supplier's exact quoted price. | [ ] PASS<br>[ ] FAIL | |
| `PRC-07` | **MOQ Auto-Inheritance** | 1. Supplier quote has MOQ = `50`.<br>2. Add product to Local Purchase. | Quantity initializes to `50` units matching MOQ. | [ ] PASS<br>[ ] FAIL | |
| `PRC-08` | **Delete Quotation** | 1. Delete an outdated factory quote from accordion. | Quote removed; remaining quotes re-evaluated for lowest badge. | [ ] PASS<br>[ ] FAIL | |
| `PRC-09` | **Export Price Directory** | 1. Click `Export Price Matrix`. | Downloads complete quotation benchmark report across all suppliers. | [ ] PASS<br>[ ] FAIL | |
| `PRC-10` | **Quote Fallback in Sale Process** | 1. Load consignment with product that has NO confirmed Local Purchase but HAS a quote. | Sourcing falls back cleanly to preferred supplier quotation rate. | [ ] PASS<br>[ ] FAIL | |

---

## 6. Module 5: Inquiries & RFQ Engine (`/inquiries`)

| Test ID | Test Description | Test Steps | Expected Behavior | Result | Notes / Observed Behavior |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `INQ-01` | **Create New RFQ Inquiry** | 1. Click `+ New Inquiry`.<br>2. Pick Buyer, Date, add 2 products with quantities.<br>3. Save. | Inquiry created with status `Draft`; line items total displayed. | [ ] PASS<br>[ ] FAIL | |
| `INQ-02` | **Assign Candidate Suppliers** | 1. In Inquiry, check 3 candidate factories from supplier picker.<br>2. Save. | Suppliers linked to inquiry; RFQ action button enabled. | [ ] PASS<br>[ ] FAIL | |
| `INQ-03` | **Dispatch RFQ Email** | 1. Click `✉️ Send RFQ to Suppliers`. | Backend generates professional bilingual email and sends via SMTP; status updates to `Sent`. | [ ] PASS<br>[ ] FAIL | |
| `INQ-04` | **WeChat Quick Link Generation** | 1. Click `💬 WeChat Share Link`. | Copies unique RFQ portal URL for Chinese factory to submit price quote without logging in. | [ ] PASS<br>[ ] FAIL | |
| `INQ-05` | **Public Supplier Quote Portal** | 1. Open generated RFQ link in incognito browser.<br>2. Fill Unit Price `¥680`, MOQ `5`, Lead Time `15 days`.<br>3. Submit. | Factory quotation recorded directly into inquiry without authentication errors. | [ ] PASS<br>[ ] FAIL | |
| `INQ-06` | **Inbound Email Reply Detection** | 1. Simulate supplier replying to RFQ email with price attachment. | Background IMAP poller catches reply, updates status to `Replied`. | [ ] PASS<br>[ ] FAIL | |
| `INQ-07` | **AI Price Extraction** | 1. Click `⚡ AI Extract Quotes` on inquiry with supplier reply. | AI parses email body & attachment, extracting rates into comparison columns. | [ ] PASS<br>[ ] FAIL | |
| `INQ-08` | **Close / Convert Inquiry** | 1. Accept quote and click `Convert to Local Purchase`. | Opens Local Purchase pre-filled with accepted supplier and negotiated rates. | [ ] PASS<br>[ ] FAIL | |
| `INQ-09` | **Export Inquiry Summary** | 1. Click `Export PDF / Excel`. | Generates customer inquiry quotation summary sheet. | [ ] PASS<br>[ ] FAIL | |
| `INQ-10` | **License Required Highlight** | 1. Add product that has `license_certificate_required` set. | Inquiry line highlights in RED warning operator of export license requirement. | [ ] PASS<br>[ ] FAIL | |

---

## 7. Module 6: Local Purchase (Domestic Procurement) (`/purchase/local`)

| Test ID | Test Description | Test Steps | Expected Behavior | Result | Notes / Observed Behavior |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `LP-01` | **Create Local Purchase (Happy Path)** | 1. Pick Supplier Dingye.<br>2. Invoice No `INV-001`, Date `Today`.<br>3. Add FR900 MSH, Qty `10`, Rate `713.00 ¥`.<br>4. Enter Total Value `8056.90 ¥`. | Basic = `¥7,130.00`, VAT = `¥926.90`. Green match banner appears! | [ ] PASS<br>[ ] FAIL | |
| `LP-02` | **Green Match Banner Trigger** | 1. Ensure `Invoice Total with VAT` matches `(Basic + VAT + Expenses)`. | Green bar displays: `✔ Invoice Total Matches Line Items Perfectly (¥ 8,056.90)`. | [ ] PASS<br>[ ] FAIL | |
| `LP-03` | **Red Mismatch Warning** | 1. Intentionally enter Invoice Total = `¥8,000.00` while items sum to `¥8,056.90`. | Glowing red alert appears showing variance of `-¥56.90`. Save blocked or warned. | [ ] PASS<br>[ ] FAIL | |
| `LP-04` | **Landing Expense Allocation (Value-Based)**| 1. Enter Transport Freight = `¥500.00` across 2 products of different values. | Expenses allocated proportionally based on basic value; `Unit Landing Rate` updates. | [ ] PASS<br>[ ] FAIL | |
| `LP-05` | **Confirm Local Purchase** | 1. Click `Confirm Order` button.<br>2. Confirm dialog. | Status changes to `Confirmed`; lock icon appears; rates become available for Sale Process! | [ ] PASS<br>[ ] FAIL | |
| `LP-06` | **Draft Status Isolation** | 1. Leave Local Purchase in `Draft` status.<br>2. Open Sale Process. | Sale Process does NOT source price from Draft; only `Confirmed` purchases are sourced! | [ ] PASS<br>[ ] FAIL | |
| `LP-07` | **Bill Document Upload (PDF/Image)** | 1. Upload scanned tax invoice invoice.pdf.<br>2. Save and view detail modal. | File preview and download link available in modal. | [ ] PASS<br>[ ] FAIL | |
| `LP-08` | **AI Bill Data Extraction** | 1. Click `⚡ Extract Bill Data` and upload invoice image. | AI scans Chinese tax invoice, extracting Invoice No, Date, Total, and line items. | [ ] PASS<br>[ ] FAIL | |
| `LP-09` | **CSV/Excel Bill Import** | 1. Click `Import Bill (CSV/Excel)`.<br>2. Upload purchase items sheet. | Line items populate into table with quantities and unit rates automatically. | [ ] PASS<br>[ ] FAIL | |
| `LP-10` | **Duplicate Invoice No Prevention** | 1. Create second purchase with identical Invoice No for same supplier. | System blocks submission: `Invoice No already exists for this supplier`. | [ ] PASS<br>[ ] FAIL | |
| `LP-11` | **Dynamic VAT % Modification** | 1. Change VAT % on line item from `13%` to `9%` (e.g. for agricultural parts). | VAT recalculates to `Item Total × 9%`; green match bar dynamically re-evaluates. | [ ] PASS<br>[ ] FAIL | |
| `LP-12` | **Zero Quantity Rejection** | 1. Enter Qty `0` on line item and attempt save. | Validation error highlights field in red: `Quantity must be greater than 0`. | [ ] PASS<br>[ ] FAIL | |
| `LP-13` | **Export Local Purchases to Excel** | 1. Click `Export` button in list view. | Generates complete domestic purchase journal with basic, VAT, and landing totals. | [ ] PASS<br>[ ] FAIL | |
| `LP-14` | **Local Purchase PDF Generation** | 1. In detail modal, click `Print / Download PDF`. | Generates official bilingual purchase order voucher with signature and stamp blocks. | [ ] PASS<br>[ ] FAIL | |
| `LP-15` | **Soft Delete Local Purchase** | 1. Delete a draft purchase. | Deleted safely; does not affect historical cost records. | [ ] PASS<br>[ ] FAIL | |
| `LP-16` | **Edit Confirmed Purchase (Admin Unlock)** | 1. Admin unlocks confirmed purchase to edit invoice date.<br>2. Re-confirms. | Updates cleanly with audit log entry. | [ ] PASS<br>[ ] FAIL | |

---

## 8. Module 7: Shipment Planning (`/planning`)

| Test ID | Test Description | Test Steps | Expected Behavior | Result | Notes / Observed Behavior |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `PLN-01` | **Create Planning Sheet** | 1. Click `+ New Sheet`.<br>2. Name sheet `Container Exp 2026-10`.<br>3. Pick Container Type `40HQ`. | Sheet initialized with target container capacity `68.000 m³`. | [ ] PASS<br>[ ] FAIL | |
| `PLN-02` | **Add Consignment Column** | 1. Click `+ Add Consignment`.<br>2. Enter Consignment Code `Muminhyma 5`, Buyer `Inhyma Mumbai`. | Consignment column added to grid; ready for row entries. | [ ] PASS<br>[ ] FAIL | |
| `PLN-03` | **Row Product Linkage** | 1. Type product name in label or select product link.<br>2. Pick FR900 Band Sealer MSH. | Row linked to Product Master; unit CBM `0.140448` and weights auto-populate. | [ ] PASS<br>[ ] FAIL | |
| `PLN-04` | **Quantity to CBM Dynamic Math** | 1. Enter Qty `50` in consignment column. | Total CBM auto-calculates: `50 × 0.140448 = 7.0224 m³`. | [ ] PASS<br>[ ] FAIL | |
| `PLN-05` | **Carton Box Ceiling Math** | 1. Product packaging qty = `4`. Enter order qty = `10`. | Number of boxes evaluates to `CEILING(10 / 4) = 3 boxes`. | [ ] PASS<br>[ ] FAIL | |
| `PLN-06` | **Container Capacity Utilization KPI** | 1. Add rows until total CBM reaches `65.5 m³` on a 40HQ container (`68 m³`). | KPI bar shows `96.3% Utilized` in green. | [ ] PASS<br>[ ] FAIL | |
| `PLN-07` | **Overfilled Container Warning** | 1. Add rows exceeding `68.0 m³` (e.g. `72.0 m³`). | KPI bar turns red warning `⚠️ Container volume exceeded by 4.0 m³!`. | [ ] PASS<br>[ ] FAIL | |
| `PLN-08` | **Row Reordering & Grouping** | 1. Drag row handle or use move up/down buttons. | Row order updates smoothly without losing linked product IDs. | [ ] PASS<br>[ ] FAIL | |
| `PLN-09` | **Export Planning Sheet to Excel** | 1. Click `Export Spreadsheet`. | Generates exact multi-consignment grid Excel file matching packing list specifications. | [ ] PASS<br>[ ] FAIL | |
| `PLN-10` | **Consignment Auto-Load in Sale Process**| 1. Open `/sale/process/new`.<br>2. Select consignment `Muminhyma 5`.<br>3. Click `Auto-Load Items`. | All planned products, quantities, and CBM values populate directly into the CI table! | [ ] PASS<br>[ ] FAIL | |
| `PLN-11` | **Removed Buggy Link Row Button Check** | 1. Click on individual cells in the planning grid. | Buggy popup modal does NOT open; cell editing is direct and clean. | [ ] PASS<br>[ ] FAIL | |
| `PLN-12` | **Trash & Restore Planning Sheet** | 1. Delete planning sheet.<br>2. Restore from trash. | Sheet restores with all consignments and formula cell values intact. | [ ] PASS<br>[ ] FAIL | |

---

## 9. Module 8: Sale Process & Official Commercial Invoice (`/sale/process`)

| Test ID | Test Description | Test Steps | Expected Behavior | Result | Notes / Observed Behavior |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `SAL-01` | **Sourcing from Confirmed Local Purchase** | 1. In `/sale/process/new`, add FR900 MSH (which has Confirmed LP: Rate 713 ¥, VAT 13%). | - Supplier shows `Dingye Machinery` with `[✓ Local Purchase]`.<br>- Col 8 shows `805.69 ¥`.<br>- Col 9 shows `713.00 ¥`. | [ ] PASS<br>[ ] FAIL | |
| `SAL-02` | **Exact 16-Column CI Header Display** | 1. Ensure Costing & Supplier Columns is Active.<br>2. Inspect table headers. | Displays all 16 official columns wrapped cleanly on two lines matching Excel sheet. | [ ] PASS<br>[ ] FAIL | |
| `SAL-03` | **UOM Regular Value Display (No Grey Placeholder)**| 1. Inspect UOM column on newly added items. | UOM displays **NOS** in bold, solid dark text (`#0f172a`), NOT faint grey placeholder. | [ ] PASS<br>[ ] FAIL | |
| `SAL-04` | **UOM In-Place Editing** | 1. Click UOM cell and change `NOS` to `SET`.<br>2. Click outside. | Value updates to `SET` and persists in memory and payload. | [ ] PASS<br>[ ] FAIL | |
| `SAL-05` | **Clean Freight Box Input Handling** | 1. Click Ocean Freight input when it is 0. | Value is blank with placeholder `0.00`; no need to backspace/erase zero! Text auto-selects. | [ ] PASS<br>[ ] FAIL | |
| `SAL-06` | **Container CBM Auto-Fill on Recalculate**| 1. Leave Total Container CBM as `0`.<br>2. Click `⚡ Recalculate CFR Rates`. | Total Container CBM auto-fills with the exact sum of line item CBMs (`0.637 m³`). | [ ] PASS<br>[ ] FAIL | |
| `SAL-07` | **Line Item Total CBM Editing & Recalc** | 1. Manually edit Line 1 CBM from `0.12` to `0.25`.<br>2. Click Recalculate. | Total Container CBM updates; Line 1 freight share increases proportionally. | [ ] PASS<br>[ ] FAIL | |
| `SAL-08` | **Price RMB Placeholder Cleanliness** | 1. Inspect newly added product with no Local Purchase. | Unit Price(RMB) Incl. VAT shows blank with placeholder `0.00` (not stuck `0`). | [ ] PASS<br>[ ] FAIL | |
| `SAL-09` | **Profit % Margin Calculation (Col 10)**| 1. Col 9 = `713.00 ¥`, Profit % = `3%`. | Col 10 = `713.00 × 1.03 = 734.39 ¥`. | [ ] PASS<br>[ ] FAIL | |
| `SAL-10` | **FOB Price USD Conversion (Col 11)** | 1. Col 10 = `734.39 ¥`, USD Rate = `6.70`. | Col 11 = `734.39 / 6.70 = $109.610`. | [ ] PASS<br>[ ] FAIL | |
| `SAL-11` | **Freight per Unit Allocation (Col 12)** | 1. Total Freight = `$1,065`, Cont. CBM = `0.637`, Line CBM = `0.12`, Qty = `10`. | Freight/Unit = `(1065 / 0.637) × (0.12 / 10) = $20.063`. | [ ] PASS<br>[ ] FAIL | |
| `SAL-12` | **CFR Price Round-Up Formula (Col 13)** | 1. FOB = `$109.610`, Freight = `$20.063`.<br>2. Sum = `129.673`. | CFR Price/Unit evaluates to `ROUNDUP(129.673, 2) = $129.68`. | [ ] PASS<br>[ ] FAIL | |
| `SAL-13` | **Unit Price USD Override (USD Currency)**| 1. Set Currency to `USD ($)`.<br>2. Type negotiated price `$135.00` in Col 6. | Unit Price overrides to `$135.00`; Total Amount USD recalculates to `$1,350.00`. | [ ] PASS<br>[ ] FAIL | |
| `SAL-14` | **Unit Price Read-Only in RMB Currency** | 1. Set Currency to `RMB (¥)`.<br>2. Try typing in Col 6. | Col 6 is locked read-only displaying auto-calculated CFR price. | [ ] PASS<br>[ ] FAIL | |
| `SAL-15` | **Total Supplier Amount Math (Col 16)** | 1. Col 8 = `805.69 ¥`, Qty = `10`. | Total Supplier Amount = `805.69 × 10 = ¥8,056.90` (matches Local Purchase bill!). | [ ] PASS<br>[ ] FAIL | |
| `SAL-16` | **CI Modal 16-Column View Toggle** | 1. View created order in `/sale/process`.<br>2. Toggle `[ 📊 Full Costing & Supplier Engine ]`. | Detail modal displays full 16-column grid with container KPI cards above invoice. | [ ] PASS<br>[ ] FAIL | |
| `SAL-17` | **Standard Customer CI View (7 Columns)** | 1. In modal, toggle `[ 📄 Standard Customer CI ]`. | Hides internal factory purchase prices and margins; displays clean 7-column customer invoice! | [ ] PASS<br>[ ] FAIL | |
| `SAL-18` | **Export Dual-Sheet Excel (CI + Packing List)**| 1. Click `Export Official Excel (CI + Packing)`. | Downloads formatted workbook: Sheet 1 `CI` (16 columns), Sheet 2 `Packing List` (weights & pkgs). | [ ] PASS<br>[ ] FAIL | |
| `SAL-19` | **Save & Re-edit Sale Process Order** | 1. Save order.<br>2. Click Edit on saved order.<br>3. Verify all 16 column inputs. | All parameters, container freight, CBMs, and UOM values load back completely intact. | [ ] PASS<br>[ ] FAIL | |
| `SAL-20` | **Invoice Valuation Summary Alignment** | 1. Check summary card at bottom right. | Shows Basic Line Value, Tax/VAT, and Total Quantity aligned with items table. | [ ] PASS<br>[ ] FAIL | |

---

## 10. Automated Test Execution Commands

Run these automated regression tests via terminal to verify backend integrity:

```powershell
# 1. Run Sale Process Costing & Local Purchase Extraction Unit Tests
& "D:\Om work1\ERP\Yinglima_ERP\backend\.venv\Scripts\pytest.exe" tests/test_sale_costing.py -v

# 2. Run Local Purchase Landing Cost & VAT Unit Tests
& "D:\Om work1\ERP\Yinglima_ERP\backend\.venv\Scripts\pytest.exe" tests/test_local_purchase.py -v

# 3. Verify Frontend Production Compilation
cd "D:\Om work1\ERP\Yinglima_ERP\frontend"
npm run build
```
