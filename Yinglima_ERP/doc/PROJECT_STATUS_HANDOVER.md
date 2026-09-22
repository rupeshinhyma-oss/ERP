# Yinglima ERP — Master Project Context & Handover Documentation

**Last Updated:** September 21, 2026 (17:30 IST)  
**Repository:** `https://github.com/rupeshinhyma-oss/Yinglima_ERP.git` (`d:\OM work\ERP_Main_Claude-main`)  
**Target Audience:** Antigravity AI Agent & Human Developers (Comprehensive onboarding & resume document)

---

## 1. Quick Resume Instruction for Antigravity AI
When starting Antigravity on a new machine or starting a new session, simply prompt:
> *"I switched laptops. Read `doc/PROJECT_STATUS_HANDOVER.md`, `doc/SYSTEM_DOCUMENTATION.md`, and `MODULES_AND_FEATURES_TEST_MANUAL.md` to resume our work."*

---

## 2. Executive Overview: What is this ERP?

### A. Business Domain & Purpose
This is a specialized, enterprise-grade **Global Procurement & Supply Chain ERP** built for **Yinglima Import & Export (Wenzhou) Co., Ltd. (盈骊玛进出口（温州）有限公司)** and **Inhyma**.
The platform orchestrates cross-border machinery and industrial packaging manufacturing trade between **Chinese factory suppliers** and **Indian importers/buyers**:
- **Buyers (India):** Request machinery, packaging equipment, conveyors, band sealers, and spare parts.
- **Suppliers (China):** Industrial machinery manufacturers (e.g. Wenzhou Brother Machinery, Hualian Machinery) who quote prices in Chinese Yuan (CNY / RMB).
- **Yinglima China Procurement Team:** Coordinates sourcing, multi-channel RFQs (Email + WeChat), price negotiations, shipment consolidation (CBM/weight planning), and Tally accounting entry.

---

## 3. Core Modules & System Architecture

### 1. Inquiries & Consignment Management (`/inquiries`) — The Heart of the ERP
Organized as a structured **3-Layer Procurement Hierarchy**:
- **Layer 1 — Buyer Selection:** Select or manage the buyer company placing the order.
- **Layer 2 — Consignment Batch:** Sourcing items are grouped into shipment consignments (e.g., `FB1`, `FB2`, `FB3`, `SEA 1`). Tracks total volume in CBM (Cubic Meters), gross weight (kg), and status (`Proposed` vs `Approved`).
- **Layer 3 — Product Line Items & Quotation Matrix:**
  - Individual machinery/parts ordered (e.g., *Band Sealer Conveyor for 10 Kgs*, *FR 900A Band Sealer MSV*).
  - Tracks target quantity, target price, brand preference, specifications, and received quotes count.
  - **Tally Status Toggle:** Clickable badge on each line item to flip between `Pending Tally` and `Tally Posted` (with real-time timestamp and auditor recording).

### 2. Multi-Channel Bulk RFQ Dispatch
- **Email RFQs (Isolated 1-on-1):** Dispatches automated RFQs to multiple suppliers simultaneously. Each supplier receives a strictly isolated email (never revealing competitor emails in `To:` or `Cc:`). Includes a secure public quote portal token link (`/quote/:token`).
- **Tencent WeCom & WeChat RFQs:** Dispatches bilingual (English + Chinese) Markdown RFQ cards directly into Chinese suppliers' WeChat accounts via Tencent WeCom API.

### 3. Automated Inbound AI Quotation Extraction
- **Inbound Email Worker (`backend/app/inquiries/email_inbound_worker.py`):** Runs an asynchronous IMAP inbox listener. Matches replying suppliers, finds the consignment batch (even with spaces like `[SEA 1]`), and invokes OpenAI GPT-4o-mini to extract prices, currency, quantities, payment terms, and delivery dates.
- **WeChat Webhook (`backend/app/inquiries/routes.py: /wechat/callback`):** Receives AES-256-CBC encrypted XML messages from Tencent when suppliers reply on WeChat. Decrypts messages, logs conversation history, and extracts quotes via AI.
- **Strict 1st-Conversation Policy:** AI quotation extraction operates strictly on the **first quotation reply** from a supplier for each item. Once the baseline quotation is recorded, all subsequent messages (counter-offers, chatter, logistics questions) are recorded in the timeline without calling OpenAI (0 token cost, 0 latency, zero risk of overwriting baseline quotes).
- **Quotation Matrix Comparison Modal:** Side-by-side comparison of all supplier quotations per item. Automatically highlights the lowest unit price in green, supports one-click `Approve Quote`, and auto-generates Purchase Orders (PO).

### 4. Master Shipment Planning Grid (`/planning`)
- Interactive spreadsheet workbook for logistics planners.
- Features dynamic column customization, container packing CBM calculations, multi-branch allocation, and container stuffing optimization.

### 5. Master Catalogs (`/masters`)
- **Products:** Complete catalog with specifications, product codes (`#DAR-01563`), UOMs, HSN codes, and Tally mapping names.
- **Suppliers:** Directory with contacts, emails, Chinese phone numbers (`+86`), Indian numbers (`+91`), and WeChat UserIDs.
- **Buyers, Brands, Categories, Subcategories, Currencies, Countries, UOMs.**

### 6. Security, RBAC & Audit Trail
- Multi-role permission system (Super Admin, Procurement Admin, Sales, Logistics).
- Immutable audit log capturing all entity creation, edit, status change, and deletion events.

---

## 4. Technology Stack & Infrastructure

| Layer | Technologies Used |
| :--- | :--- |
| **Frontend** | React 18, TypeScript, Vite, Vanilla CSS / Tailwind, Lucide Icons |
| **Backend API** | FastAPI, Python 3.11/3.12, SQLAlchemy 2.0 (Async), Pydantic v2, Alembic |
| **Database** | **Remote Cloud Supabase PostgreSQL** (`aws-0-ap-south-1.pooler.supabase.com`) |
| **Real-time Comms** | WebSocket Live Client (`/api/v1/events/ws`), EventDispatcher |
| **AI Quotation Engine** | OpenAI GPT-4o-mini with 3-attempt automated retry and exponential backoff |
| **WeChat Integration** | Tencent WeCom API, WXBizMsgCrypt AES-256-CBC encryption |
| **Email Service** | Python `aiosmtplib` (SMTP outbound), `imaplib` (IMAP inbound listener) |

---

## 5. Server Hosts, Endpoints & Credentials Overview

### A. Database (Cloud Supabase PostgreSQL)
- **Host / Pooler:** `aws-0-ap-south-1.pooler.supabase.com`
- **Port:** `6543` (Transaction Pooler) / `5432` (Direct Session)
- **Database Name:** `postgres`
- *Note: All persistent business data is in the cloud; local laptops only connect via credentials in `backend/.env`.*

### B. Tencent WeCom (企业微信) Configuration & Blue Tick (企业认证) Guide
- **Corp ID (`CorpId`):** `ww0aafdc97cca27e0a`
- **Agent ID (`AgentId`):** `1000002` (*Yinglima ERP Bot*)
- **Secret:** `8kzaUnGu34Q6aelEYTaVyB9xOH7EX7MSR6tsLpiL9B8`
- **Token:** `Nr8CIsNe`
- **EncodingAESKey:** `yoIVWBBr2iRASH0rIyu2H5VjsSVl1LcWAzXgwyAajLc`
- **API Endpoint:** `https://qyapi.weixin.qq.com`
- **Callback Inbound Path:** `/api/v1/inquiries/wechat/callback`
- **Whitelisted Enterprise IPs (Cloudflare Egress):**
  `104.28.232.96;104.28.232.97;104.28.200.92;104.28.200.96;104.28.200.97`
- **Admin Group:** `ERP Admins` (Paws / `paws` / `+91 8108294930` configured with full management rights).

#### Official Blue Tick (企业认证) Verification Protocol:
1. **VPN & Access from India**: Access Tencent WeCom admin portal (`https://work.weixin.qq.com`) using a VPN connected to **Hong Kong (HK)** or **Singapore** nodes for stable, high-speed connectivity to Tencent verification servers. Admin logs in by scanning QR code via WeCom mobile app.
2. **Verification Route**: `work.weixin.qq.com` ➔ **我的企业 (My Enterprise)** ➔ **企业信息 (Enterprise Info)** ➔ **企业认证 (Enterprise Verification)** ➔ Click **去认证 (Verify Now)**.
3. **Entity Options & Annual Fees**:
   - **Chinese Entity (*Yinglima Wenzhou - 盈骊玛*) [Recommended]**: Cost is **300 RMB / year (~₹3,600 INR)**. Requires Chinese Business License (营业执照), Corporate Bank Account for verification deposit/transfer, and Legal Rep ID / Authorization Letter with official red seal (公章).
   - **Overseas Entity (*Inhyma / Indian Entity*)**: Cost is **$99 USD / year (~₹8,300 INR)**. Requires Certificate of Incorporation (COI/MCA/GST), Director Passport/ID, signed authorization letter, and international credit card.
4. **Why Required**: Unlocks unrestricted external WeChat messaging with factory suppliers (微信互通), grants full daily API limits for ERP bulk RFQs, establishes supplier trust with the verified V badge, and prevents Tencent anti-spam account flagging. Audit takes 1–3 business days.

### C. Mail Servers
- **SMTP Host:** `smtp.gmail.com` (Port `587`, TLS)
- **IMAP Host:** `imap.gmail.com` (Port `993`, SSL)

---

## 6. Current Test Consignments & Verified Status

### Consignment `FB2` (Multi-Supplier Email Test)
- **Items:**
  1. *Band Sealer Conveyor for 10 Kgs (#INH-00209)*:
     - `QT-AUTO-01`: Wenzhou Brother Machinery (¥1,250 CNY)
     - `QT-AUTO-02`: Hualian Machinery Group (¥12,700 CNY)
  2. *FR 900A Band Sealer MSV (#DAR-01563)*:
     - `QT-AUTO-01`: Wenzhou Brother Machinery (¥1,680 CNY)
     - `QT-AUTO-02`: Hualian Machinery Group (¥7,000 CNY)
- **Verification:** Both suppliers' email replies successfully parsed and displayed in matrix under separate products.

### Consignment `FB3` (WeChat End-to-End Test)
- **Item:** *FR 900A Band Sealer MSV* (Qty: 89)
- **WeChat Outbound:** Dispatched to `paws` (`+91 8108294930`) with `errcode: 0, errmsg: 'ok'`.
- **WeChat Inbound Reply:** Simulated reply received and decrypted.
- **Quote Generated:** `QT-AUTO-01` (Unit price: ¥1,550 CNY, FOB Ningbo, 30% advance, 10 days delivery).

---

## 6.1. Recent Completed Features & Module Hardening (September 21, 2026)

### A. Completed & Verified Features:
1. **Sale Process Module (`src/pages/sales/`)**:
   - Integrated with **Shipment Planning**: Click **⚡ Auto-Load** to populate container consignment columns (`Muminhyma 1`, etc.) into order items without touching planning cells or status dots.
   - Replaced static buyer dropdown with a **searchable combobox** with live typing filter and auto-focus.
   - Added **consolidated unit rate error toast** with auto-scroll and red row highlighting.
   - Numeric inputs (`Quantity`, `Unit Rate`, `Tax %`) auto-select on click (`e.target.select()`) for immediate zero replacement.
2. **Supplier Module (`src/pages/Suppliers.tsx`)**:
   - **Cascading Category ➔ Sub-Category Filters**: Selecting categories restricts sub-categories to only matching items.
   - **Auto-Pruning**: Deselecting a category automatically prunes any orphaned sub-categories from selection.
   - **Multi-UUID Filters**: Backend `base_repository.py` now parses comma-separated UUIDs for dynamic `.in_()` filtering.
3. **Table UI & Two-Line Text Clamping (`Suppliers.tsx`, `Buyers.tsx`)**:
   - Overrode global `white-space: nowrap; height: 38px;` from `style.css` on Company Name column.
   - Implemented true **2-line box clamping** (`-webkit-line-clamp: 2`, `whiteSpace: "normal"`, `wordBreak: "break-word"`).
   - Tuned column breadths: Company Name to **290px**; Current Status to **105px** with **multi-line header wrapping**.
4. **Smart Trash Conflict Detection (`Product Master`, `Buyers`, `Suppliers`)**:
   - **Product Master (`MasterPage.tsx`)**: Mounted `<TrashConflictModal>` inside `useFullPageForm` return block.
   - **Backend Buyers (`buyers/repository.py` & `service.py`)**: Added `get_any_by_company_name` and company-name conflict checking (mirroring Supplier Master).
5. **Local Purchase Multi-Format Bill Extraction & Unregistered Items UX (`LocalPurchaseForm.tsx`, `LocalPurchaseService`)**:
   - **Dual Engine Extraction**: Supports uploading `.xlsx`, `.csv`, and `.pdf` files. Inbound line items automatically match against registered Product Master catalog by name/code.
   - **Header & Items Extraction**: Parses `Supplier Name`, `Invoice No`, `Invoice Date`, `Currency`, `Invoice Total Value`, `Quantity`, `Unit Rate`, `VAT %`, and `HSN`.
   - **Consolidated Notice Banner**: When products on an uploaded bill are not in Product Master, a top-level alert banner summarizes the count and row numbers (e.g. `⚠️ 1 Product in this bill is not registered in Product Master: "Special Titanium High-Speed Gear Wheel 45T" — Marked with ⚠️ Not in Master. These will be recorded as one-time purchase items.`), preventing visual clutter.
   - **Clean Inline Row Badging**: Unregistered rows display a warm alert border with a compact `⚠️ Not in Master` pill badge and extracted `Code: [SKU]` tag without disrupting table alignment or expanding row heights.
   - **Zero-Block Local Purchase**: Allows recording local/domestic purchases containing non-master items as one-time expense items (`product_id: null`).
   - **Standard & Stress Test Artifacts**: Bills provided in [`doc/example bil/`](file:///d:/Om%20work1/ERP/Yinglima_ERP/doc/example%20bil/) (`sample_supplier_bill.xlsx`, `sample_supplier_bill.pdf`, `messy_noisy_bill.xlsx`, `imperfect_messy_bill.pdf`).
6. **Scroll-Wheel Value Lockout & Precision Decimal Formatting (`main.tsx`, `style.css`, `LocalPurchaseForm.tsx`)**:
   - **Scroll-Wheel Lockout**: Added global wheel listener in `main.tsx` and explicit `onWheel={(e) => e.currentTarget.blur()}` across all numeric inputs (Quantity, Rate, VAT %, Expenses, Invoice Total) to prevent mouse wheel scrolling from accidentally changing values.
   - **Spin Button Suppression**: Added global CSS in `style.css` (`-webkit-appearance: none; -moz-appearance: textfield;`) on `input[type="number"]`.
   - **Precision Rounding & Clean Formatting**: `totalQuantity` in calculations now strictly rounds via `toFixed(2)`, and table footer formats with `.toLocaleString('en-US')` to prevent float artifacts like `18.009999999999998`.
7. **Product Price Directory Frozen Header & Sticky Sr. No. Column (`ProductPrices.tsx`)**:
   - **Sticky Top Headline**: Enclosed table in a responsive scroll container (`.table-scroll` with `maxHeight: calc(100vh - 270px)`, `minHeight: 380px`, `overflowY: auto`). All `<th>` cells (`Sr. No.`, `Product Name & Code`, `Category & Brand`, `Best Price`, `Primary Supplier`, `Actions`) are set to `position: sticky; top: 0; zIndex: 10/25` with `borderCollapse: separate; borderSpacing: 0`.
   - **Zero Header Loss**: When scrolling vertically through 50 or 100 products per page, the entire header row stays firmly pinned and visible at the top of the card.
   - **Horizontal Freeze**: `Sr. No.` column is locked with `position: sticky; left: 0; zIndex: 25 (th) / 5 (td)` so it remains in view during horizontal panning.
8. **Sale Process List Frozen Header & Pinned `#` (Sr. No.) Column (`SaleProcessList.tsx`)**:
   - **Sticky Top Headline**: Enclosed the orders table in a responsive scroll container (`.table-scroll` with `maxHeight: calc(100vh - 280px)`, `minHeight: 360px`, `overflowY: auto`, `overflowX: auto`). All 10 `<th>` headers (`#`, `Order Date`, `Order No`, `Consignment`, `Buyer / Branch`, `Items Qty`, `Total Amount`, `Status`, `Logistics Info`, `Actions`) are configured with `position: sticky; top: 0; zIndex: 10/25` with `borderCollapse: separate; borderSpacing: 0`.
   - **Pinned `#` (Sr. No.) Column**: Pinned `#` with `position: sticky; left: 0; zIndex: 25 (th) / 5 (td)` so order sequence numbers remain in view when panning horizontally.
   - **Row Divider Integrity**: Set explicit `borderBottom: 1px solid #f1f5f9` on each `<td>` cell so row separators render cleanly with `borderCollapse: separate`.

### B. Verification Checklist for Git Pull / Branch Switch:
1. **Build & Typing Verification**:
   ```bash
   cd Yinglima_ERP/frontend
   npm run build
   ```
   *Expect:* Exit code 0, 0 TypeScript errors.
2. **Manual Functional Checks**:
   - Supplier Add/Edit ➔ select `Chemicals` ➔ only chemical sub-categories appear.
   - Supplier table ➔ Company Names clamp at 2 lines; `CURRENT STATUS` wraps onto 2 lines in 105px column.
   - Product Master ➔ + New Product ➔ enter trashed name (e.g. `Test 78`) ➔ **"Record Already Exists in Trash"** modal pops up with 1-click restore.
   - Buyer Master ➔ delete test buyer (e.g. `Test 81`) ➔ create buyer `Test 81` ➔ **"Record Already Exists in Trash"** modal pops up with 1-click restore.

---

## 7. Mandatory AI & Developer Policies
1. **Living Documentation Policy (`AGENTS.md`):**
   - Whenever any API endpoint, schema, UI view, button, or logic changes, immediately update `doc/SYSTEM_DOCUMENTATION.md` and `MODULES_AND_FEATURES_TEST_MANUAL.md`.
2. **Zero Feature Loss & Zero Inaccuracies:**
   - Never break or strip existing cataloged features or UI layouts during development.
3. **Local Development Safety:**
   - **NO `git push`** without explicit user permission.

---

## 8. Laptop Migration & Setup Checklist

1. **Backup from Current Laptop:**
   - Copy the entire folder `d:\OM work\ERP_Main_Claude-main` to a USB drive or cloud zip.
   - **MANDATORY:** Ensure `backend/.env` is included in the copy (it is git-ignored and contains DB/API secrets).
2. **Setup on New Laptop:**
   - Prerequisites: Python 3.11/3.12, Node.js 18+, Antigravity IDE.
   - Paste the project directory.
   - In terminal 1 (Backend):
     ```bash
     cd backend
     python -m pip install -r requirements.txt
     python server.py --skip-migrate
     ```
   - In terminal 2 (Frontend):
     ```bash
     cd frontend
     npm install
     npm run dev
     ```
   - Open Antigravity IDE and log into your Google account.
   - Open folder `ERP_Main_Claude-main`.
   - Prompt Antigravity: *"I switched laptops. Read `doc/PROJECT_STATUS_HANDOVER.md` and resume our work."*
