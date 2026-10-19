# Yinglima_ERP — Changelog & Function Changes History

**System:** Yinglima_ERP (China Procurement)  
**Scope:** Functional updates, schema changes, UI hardening, and bug fixes.
## [Release 2026-10-14] — Seed First-Install Guards, Inbound Email DB Deduplication & Handover Account Protection

### 1. Database Seed First-Install Protection (`BOOTSTRAP_FORCE_RESET`)
- **Non-Destructive Bootstrap Guard:**
  - Hardened `backend/scripts/seed.py` so that automatic startup scripts in container environments (e.g. Render build/start commands) cannot overwrite or corrupt existing production database rows.
  - If existing users, organizations, or permissions exist, seeding halts safely unless `BOOTSTRAP_FORCE_RESET=true` is explicitly provided.
  - Master geography seeding (`countries`, `states`, `districts`, `cities`) skips insertion if existing rows are present, protecting customized data.

### 2. Atomic Inbound Email Deduplication (`email_inbound_processed`)
- **Persistent Database Deduplication Ledger:**
  - Added PostgreSQL table `email_inbound_processed` (`backend/app/inquiries/models.py`) to prevent duplicate quote processing and double API consumption when the inbound email poller restarts.
  - Keyed by `(message_id, uid, inquiry_id, supplier_id)`.
  - Poller checks `SELECT 1 FROM email_inbound_processed WHERE message_id = :mid` before invoking AI extraction or recording quotation attachments.
  - Incorporates a 30-minute historical baseline cutoff on initialization: emails older than 30 minutes are stamped into the deduplication ledger without creating duplicate quotes.

### 3. SSO Handover Local Account Guards & Disabled User Rejection
- **Enforcing Local User Status on Federated Handover:**
  - Updated `POST /api/v1/auth/sso-handover` in `backend/app/api/v1/auth.py`.
  - When an incoming handover ticket is presented for a user with `is_active=False` or `deleted_at IS NOT NULL`, the system immediately rejects the handover with `401 Unauthorized` ("Account is inactive or disabled on this ERP instance").
  - Prevents terminated or suspended users from re-activating accounts via central SSO.
  - Respects `SSO_HANDOVER_AUTO_PROVISION=false`: blocks unauthorized user creation during handover.

### 4. Shared Token Pair Types Restoration
- **Session Types Alignment:**
  - Restored `TokenPair` in `backend/app/auth/security.py` and aligned with `TokenResponse` in `backend/app/auth/schemas.py`, ensuring full compatibility with session-scoped token handlers.

---

## [Release 2026-10-14] — Resilient Central Federation, DNS Winsock Isolation & Live Diagnostics

### 1. Multi-URL Central Control Plane Discovery
- **Config Fallback Array (`erp_main_api_base_urls()` in `app/core/config.py`):**
  - Added multi-candidate discovery searching across `ERP_MAIN_API_BASE_URL`, `ERP_MAIN_URL`, and fallback default URLs.
  - Enables seamless spoke communication across custom cloud domains and internal Render platform URLs.

### 2. Outbound IPv4 Binding & Sleeping Container Wake-Up Budget
- **IPv4 Socket Binding (`0.0.0.0`):**
  - In `backend/app/federation/erp_main_client.py`, `httpx.AsyncClient` binds outbound traffic to `0.0.0.0`, eliminating IPv6 connection drops on container platforms.
- **40-Second Cold-Start Sleeping Budget:**
  - Extended federation timeout budget to 40 seconds (`httpx.Timeout(40.0, connect=20.0)`), allowing sleeping Render instances to wake up cleanly without timing out SSO handovers.

### 3. 900-Second Stale Session Cache Fallback
- **Partition Tolerance (`_from_cache`):**
  - If ERP_Main is temporarily unreachable or undergoing deployment, active session validations fall back to local memory cache for up to 900 seconds (15 minutes).
  - Flags validated session as `_from_cache = True`, maintaining system uptime without dropping active operations.

### 4. Platform-Gated Winsock DNS Isolation
- **Platform Gating (`sys.platform.startswith("win")`):**
  - In `backend/app/core/dns_resilience.py`, DNS caching is platform-gated to Windows workstations only.
  - Linux production environments run unpatched, relying on native `glibc` DNS resolution.
  - Caching key uses 5-tuple `(host, port, family, type, proto)`, preserving exact port destinations and preventing localhost collisions.

### 5. Central Federation Health Diagnostics
- **Endpoint `GET /api/v1/health/federation`:**
  - Added spoke diagnostic endpoint to test real-time federation health, connectivity latency (ms), and reachable endpoints against ERP_Main.

---

## [Release 2026-10-14] — Database-Backed Organization Branding & Storage Quota Protection

### 1. Versioned Database-Persisted Organization Logo
- **Streaming Endpoint `GET /api/v1/organizations/logo?v={sha1}`:**
  - Stored enterprise logos directly in PostgreSQL `organizations.logo_data` and streamed via public endpoint with immutable caching (`Cache-Control: public, max-age=86400, immutable`).
  - SHA-1 hash query parameter guarantees immediate cache invalidation whenever the logo is updated in settings.

### 2. Client-Side Storage Quota Guards
- **Safe Quota Degradation in `brand.ts` and `Organization.tsx`:**
  - Wrapped `localStorage.setItem` for large brand assets in `try/catch` handlers.
  - Prevents `QuotaExceededError` crashes on mobile and webview browsers when storing large base64 logos, falling back gracefully to remote URLs or in-memory state.

---

## [Release 2026-10-14] — Universal Filter Button UI Standardization

### 1. Enterprise UI Harmonization
- Standardized all module filter buttons to match the Companies reference:
  - Color palette: `#556987` solid background, `#475569` on hover, permanently locked to `#556987` when active.
  - Geometry: `padding: 8px 14px`, `border-radius: 6px`, no hardcoded square dimensions.
  - Icon: 16x16px SVG funnel icon.
  - Clean surface: zero counter badges or colored dots on the button face.
  - Default state: all filter drawers initialize collapsed (`useState(false)`).

---

## [Release 2026-10-14] — Session-Scoped Tokens (one login = one session id)

- Access and refresh tokens carry a `sid` claim (`auth/security.py`). `AuthService._issue_token_pair` binds both tokens to one session id; refresh keeps it. `TokenResponse` gains `session_id` and `session_mode` (`"central"` or `"local"`).
- **Login** opens the login's central session via ERP_Main (`federation/erp_main_client.open_central_session`) only *after* the password is verified. If ERP_Main cannot be reached or refuses, the login still succeeds with a local session id `loc-<uuid>`.
- **SSO handover** issues tokens carrying the verified central `sid`.
- **Per-session revocation:** `AuthService.revoke_session` stores `sid:<sid>` in `token_blacklist` (cached), closes that session's WebSockets (`ConnectionManager.disconnect_session`). `verify_access_token` and `refresh` reject a revoked `sid` and, for central sessions, ask ERP_Main at most every 45 s (`central_session_state`, fail-open) so a lost message cannot leave a session alive.
- **New endpoint:** `POST /api/v1/internal/sessions/{sid}/revoke` (service credential). `POST /auth/logout` now revokes the token's session and reports it to ERP_Main (`push_session_signout_to_erp_main`); it no longer signs the person out of their other logins.
- **Frontend:** the login page uses the session id from the login reply; a fresh handover always replaces a saved session; no stored default-admin login; scoped cookie clearing; visible reason when an automatic sign-in fails.
- **Reliability hardening:** when ERP_Main cannot be reached during a handover the ERP now answers **503** (`EcosystemSessionUnavailable`) instead of 401, so the browser retries instead of treating it as "session ended"; the login's central call uses short timeouts (connect 1.5 s, read 3 s) so a login never hangs. Browser: one shared handover exchange per arrival, retries 0.7/2.5/6 s, per-status messages, "Signing you in..." state, a switcher that validates before navigating (and no longer declares hooks after an early return), and a watcher that checks immediately then every 30 s / 2 min (was 2.5 s).
## [Release 2026-10-15] — Buyer Master "Added On / By" Attribution & Company Name Auto Title Case

### 1. Auto Capitalization (Title Case) on Buyer Company Name
- **Frontend Real-time Title Case in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Integrated `autoTitleCase` on the **Name of Company** input field.
  - Automatically capitalizes the first letter of each typed word in real-time (e.g., `om dhanashree` $\rightarrow$ `Om Dhanashree`), exactly matching the behavior of Supplier Master.
  - Non-destructive to uppercase acronyms (e.g. `PVT LTD`, `LLP`, `IBM` remain intact).
  - 100% compatible with backend case-insensitive duplicate checks (`lower(trim(company_name))`) and search queries.

### 2. "Added On / By" User Attribution in Buyer Master Table
- **Database & Migration ([`8b9c0d1e2f3a_add_created_by_to_buyers.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/alembic/versions/8b9c0d1e2f3a_add_created_by_to_buyers.py)):**
  - Added `created_by_id` column (`UUID NULL REFERENCES users(id) ON DELETE SET NULL`) to `buyers` table with index.
  - Backfilled existing 6 buyers to the system `admin` user.
- **Backend Service & Routes:**
  - Automatically captures the current authenticated user's ID upon buyer creation and CSV/XLSX file imports.
  - Resolves creator display names efficiently via single-batch lookup (`attach_creator_names`) and returns `created_by_name` in `BuyerListItemRead`.
- **Frontend Table UI in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Updated column header to **Added On / By**.
  - Renders formatted date with subtext `by {created_by_name || "—"}` in clean, read-only layout without affecting column freeze or sorting configurations.

## [Release 2026-10-15] — Products Master Table Streamlining & 720px Executive Detail Drawer with Top Photo Zoom

### 1. Products Master External Table Streamlining
- **Removed Status & Branches Columns from Main View in [`Products.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/masters/Products.tsx):**
  - Removed the `Status` toggle column and `Branches` chips column from `columnHeaders` and `columns`.
  - Saves considerable horizontal space and eliminates visual clutter, allowing Product Name, Code, Brand, Categories, Supplier, and Packaging metrics to fit cleanly without horizontal crowding.
  - Full operating branch assignments and active/inactive status badges are now centrally consolidated in the executive detail drawer.

### 2. Upgraded 720px Executive Product Detail Drawer
- **Matching Design Standards of Buyers & Suppliers in [`Products.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/masters/Products.tsx):**
  - Widened the Product Detail `<SideDrawer>` from standard ~480px to `720px` (`maxWidth: "95vw"`).
  - **Top Photo Hero Identity Card:**
    - Products with photos display a compact 124px × 124px photo thumbnail at the **very TOP** side-by-side with product identity (Tally name, invoice name, status badge, code, barcode, and classification chips).
    - If multiple images exist, a mini thumbnail strip enables instant switcher preview.
    - If a product has no photo, the identity block gracefully expands across the full width without blank boxes or wasted space.
    - **Clear Headline Labels for Product Code, HSN Code & Barcode:** Added explicit bold labels (`🏷️ Product Code: ...`, `🧾 HSN Code: ...`, `🔢 Barcode: ...`) in the top hero badge row and drawer header subtitle so users and warehouse personnel immediately recognize every identifier without ambiguity.
  - **Click-to-Zoom Lightbox Modal:**
    - Clicking on the top photo thumbnail opens a full-screen blurred lightbox overlay displaying the high-resolution photo with an overlay close button.
  - **🏢 Operating Locations & Assigned Branches Card:**
    - Displays organization badges (`🏛️ Inhyma Group`) and all assigned operating branches (`🏢 Inhyma Ahmedabad (IA1)`), or clear `🌐 All Branches / General Distribution` badge if unrestricted.
  - **📐 Packaging & Physical Dimensions Card:**
    - Structured 2-column grid displaying Primary UOM, Secondary UOM (with conversion factor), Packaging Quantity, Net Weight (kg), Gross Weight (kg), Dimensions (L × W × H cm), Packaging Unit CBM (formatted to 6 decimal places in bold blue `0.000000 CBM`), and MOQ.
  - **🏷️ Classification, Sourcing & Tax Card:**
    - Primary Supplier, HSN Code, GST Rate %, Refund VAT % (green badge), Standard Price, Standard Cost, Color/Material, and Purchasable/Sellable status.
  - **📜 Compliance, Licenses & Specifications Card:**
    - High-visibility alert banner for `license_certificate_required` and dedicated sections for technical specifications and notes.
  - **🕒 System Timestamps & Action Footer:**
    - Shows Created/Updated timestamps, `[ 📜 Trade & Price History ]` drawer launcher, and `[ ✏️ Edit Product ]` action.

## [Release 2026-10-15] — Buyer State/Province Field, Non-Clickable Reference Suggestions, Dual Contacts Import/Export & Performance Hardening

### 1. Replaced Black Box Confirm Dialog with Non-Clickable Reference-Only Suggestions
- **Elimination of Popup in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Removed intrusive `window.confirm` popup (`Buyer "{name}" already exists in Master. Would you like to open it to edit?`) triggered on typing or clicking existing company names.
  - Replaced with a non-clickable reference-only dropdown matching `Suppliers.tsx` standard (`Existing in Master (N) | Reference Only (Non-selectable)`). Items have `pointerEvents: "none"` and cannot overwrite user input.
  - Added non-blocking inline duplicate warning banner (`⚠️ A buyer with this exact name already exists. You can still save if intentional.`) to alert users without interrupting data entry.

### 2. Full-Stack State / Province Field (Form, DB, Import & Export, Side Drawer)
- **Database Migration [`7a8b9c0d1e2f_add_state_id_to_buyers.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/alembic/versions/7a8b9c0d1e2f_add_state_id_to_buyers.py):**
  - Added `state_id` column (`UUID NULL REFERENCES states(id)`) to `buyers` table with index.
- **Backend Service, Schemas & Models:**
  - Updated `Buyer` model, `BuyerCreate`, `BuyerUpdate`, `BuyerRead`, and `BuyerListItemRead` with `state_id`.
  - Injected `StateRepository` into `BuyerService` and `dependencies.py` to validate state existence and country linkage (`_validate_state`).
- **Frontend Form & Side Drawer in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Restructured Location Details into a 3-column responsive grid: `Country *` | `State / Province (Optional)` | `City (Optional)`.
  - `State / Province` cascades dynamically from selected `Country` and resets when Country changes.
  - Displayed `State / Province` in the 720px Executive Side Drawer Location & Delivery Address card.
  - **Dynamic City Locking:** Locked City field (`disabled={!formStateId}`) showing placeholder `-- Please select State / Province first --` until a State is selected, matching Product Sub Category behavior. Automatically clears City if State or Country is changed.

### 3. Removal of Grade D Option
- **Clean Alignment with Master Specifications:**
  - Removed `<option value="D">Grade D</option>` from the inline Client Grade table select in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx).
  - Client Grade options now strictly adhere to standard A, B, and C (`Grade A`, `Grade B`, `Grade C`) across all table inline edits, filter headers, modal forms, and backend schemas.

### 4. Dual Contacts (`Contact Person 2`) in Import & Export Templates
- **Template Updates in [`constants.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/buyers/constants.py) & [`sampleTemplate.ts`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/lib/sampleTemplate.ts):**
  - Export & Import headers updated to include `State / Province` (positioned between Country and City) and secondary contact fields (`Contact Person 2`, `Designation 2`, `Calling Number 2`, `WhatsApp Number 2`).
- **Import Engine Support in [`validators.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/buyers/validators.py) & [`service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/buyers/service.py):**
  - Resolves `State / Province` text to `state_id` matching State master under the specified country.
  - Automatically extracts and persists secondary contacts (`is_primary=False`) in `buyer_contacts` alongside primary contacts, both on new insert and on updating existing buyers.

### 5. Contact Drawer Widening, Direct-Click Email Compose & Brand Icons
- **Direct-Click Email Compose in [`fields.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/fields.tsx):**
  - Removed the copy button from `EmailTagInput` chips.
  - Clicking on an email chip directly triggers email compose (`mailto:${email}` with `✉️` indicator) in the user's email client (e.g. Gmail/Outlook).
  - Maintained the quick `✕` remove button to delete tags.
- **Contact Side Drawer Width & Scrollbar Elimination in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Increased Contact Side Drawer width from `480px` to `600px` (`maxWidth: "94vw"`, `overflowX: "hidden"`).
  - Calling Number and WhatsApp Number inputs now fit side-by-side with generous breathing room and zero horizontal scrolling.
  - Replaced plain text email input with `EmailTagInput`, allowing multiple emails with chip management.
  - Added visual branding icons: `📞` for Calling Number, official green `<WhatsAppIcon />` for WhatsApp Number, and `✉️` for Email IDs.
  - Contact table rows now display multiple clickable email badges and official WhatsApp icon.

### 6. Top Filter Cleanup: "All Status" Label & "Reset Filters" Button
- **Top Filter Header Standardization in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Replaced the plain `Advanced Filters` title and red `Clear All Filters ✕` text link with the standard `Filter Options` header featuring a funnel SVG icon and a dedicated `[ Reset Filters ]` button matching `Suppliers.tsx` (`#f1f5f9` background, `#cbd5e1` border, 6px radius).
  - Corrected the Current Status filter dropdown's all-option label from `All Statuses` to `All Status`.

### 7. Form Field Label Simplification ("Category" & "Sub Category")
- **Clean Labeling in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Updated the Classification & Product Interest section labels in the Add/Edit Buyer modal from `Product Category (multiple)` and `Product Sub Category (multiple)` to **`Category`** and **`Sub Category`** for cleaner, more concise form presentation.

### 8. Merged "Category & Sub-Category" Table Column with Enhanced Width & Chips
- **Space-Saving Unified Layout in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Merged the separate `PRODUCT CATEGORY` and `PRODUCT SUB CATEGORY` table columns into a single unified **`Category & Sub-Category`** column (11 columns total instead of 12).
  - Displays Category badges with `🏷️` on top and Sub-Category badges with `↳ 📁` directly beneath, saving significant horizontal table width.
  - Increased the combined column's width (`width: 240px`, `minWidth: 220px`, `maxWidth: 300px`) and chip popover max-width (`175px`) so multi-selected categories and sub-categories render cleanly with their `+N` count badges and full popovers.
  - Updated Freeze Columns popover, column indices, skeleton rows, and sort order.

### 9. Buyer Contacts Auto-Promotion, "Make Primary" & Full Two-Way Sync (Tab 1 ↔ Tab 2)
- **Auto-Promotion of Initial Contact in [`service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/buyers/service.py):**
  - Resolved the disconnect where buyers created without contact details on Tab 1 ("Profile") had empty profile fields even after adding contacts in Tab 2 ("Contacts").
  - If a buyer has no primary contact yet (or `contact_full_name` is empty), adding the first contact person in Tab 2 automatically sets `is_primary=True` and syncs `contact_salutation`, `contact_full_name`, `contact_designation`, `contact_calling_number`, `contact_whatsapp_number`, and `emails` directly to the `buyers` row.
- **Dedicated "Make Primary" Promotion Endpoint:**
  - Added `POST /api/v1/buyers/{buyer_id}/contacts/{contact_id}/make-primary` in [`routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/buyers/routes.py).
  - Calling this promotes the selected contact to `is_primary=True`, demotes previous primary contacts to `is_primary=False`, and syncs all profile and contact phone/email fields into the `buyers` table row.
- **Frontend Two-Way Profile & Table Re-Sync in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Added `★ Make Primary` action button for team members in the Tab 2 Contacts Table.
  - Added `★ Set as Primary Contact Person (syncs directly to Profile tab)` checkbox in the Contact Person side drawer (defaults to checked if no primary contact exists yet).
  - Implemented `refreshBuyerProfileAfterContactChange`: saving, editing, promoting, or deleting contacts now immediately refreshes Tab 1 profile form, Tab 2 contacts list, the main table row, and the 720px side detail drawer.
  - Comprehensive unit test suite in [`test_buyer_contact_sync.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/tests/test_buyer_contact_sync.py) with 100% pass rate.

### 10. Verified Performance Benchmarks & Zero Regressions
- **Response Times (Measured on warm database engine):**
  - `GET /buyers` paginated query: **~310 ms** (under 350 ms target).
  - CSV Export generation (28 columns): **~421 ms**.
  - XLSX Export generation (28 columns): **~398 ms**.
  - Bulk Import execution (with State & Contact 2 resolution): **~1,130 ms**.
- **Test Suite:** 16 of 16 tests passing (13 durable & sync tests + 3 contact sync tests); frontend build passes cleanly in 2.52s with 0 errors.

## [Release 2026-10-14] — Buyer Module Category Loading Optimization & Full 720px Detail Drawer

### 1. In-Memory Category & Sub-Category Performance Optimization in Buyer Form
- **Zero-Latency In-Memory Resolution in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Eliminated the 4-5s delay and duplicate network calls when opening and typing in the Category & Sub-Category multi-select fields in the Buyer Create/Edit modal.
  - Replaced uncached network fetches with memoized in-memory filtering against `categories.items` and `subCategories.items` (already prefetched and cached by `useLookup`).
  - Added in-memory fast-path lookup to `fetchNameLabel` for `/masters/product-categories`, `/masters/product-sub-categories`, `/masters/buyer-types`, and `/masters/countries`, eliminating individual per-chip network queries when pre-populating multi-select values.
  - Stabilized callback references with `useCallback` (`fetchCategoryOptions`, `fetchCategoryLabel`, `fetchSubCategoryOptions`, `fetchSubCategoryLabel`) to eliminate redundant effect re-executions during modal interactions.

### 2. Full Detail View on Blue Link Click (Buyer 720px Side Drawer)
- **Executive Detail Drawer in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Clicking any blue Buyer Company Name hyperlink opens a 720px side drawer (`SideDrawer`) fetching the complete buyer profile from `GET /buyers/:id` with background loading indicator (`⏳ Loading full details...`).
  - Organized into 5 executive cards matching the Supplier module standard:
    1. **🏢 Company Profile & Classification:** Company Name, Buyer Type, Tax ID (TIN / GST), Country, City, Category chips (`🏷️`), Sub-Category chips (`📂`), Currently Buying From, Product Range, Remarks.
    2. **👤 Primary Contact Information:** Contact Person, Designation, Calling Number (`📞 tel:`), WhatsApp Number with official vector `<WhatsAppIcon size={16} />` and direct `https://wa.me/...` link (`↗`), Email badges (`mailto:`), Website links (`🌐 ↗`).
    3. **📍 Location & Postal Delivery Address:** Country, City, Full Postal Delivery Address.
    4. **📊 Pipeline Status & Commercial Evaluation:** Client Grade pill (`GRADE A/B/C`), Current Status pill (`EXISTING/NEW`), Potential Status pill (`YES/NO`), Reason for Potential Status.
    5. **👥 Additional Contacts Roster:** Displays all secondary contacts from `detailBuyer.contacts` with Person Name, Designation, Calling Number, WhatsApp Number with WhatsApp SVG icon, and Email.
  - Supports deep-linking via `?id=` query parameter and full synchronization with browser back navigation via `useModalHistorySync`.

## [Release 2026-10-14] — Supplier Dual Contacts, Town Removal, Address Relocation & Master Validation

### 1. Dual Contacts in Supplier Import / Export & Multi-Number Support
- **Dual Contacts Pipeline in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx), [`service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/suppliers/service.py), and [`constants.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/suppliers/constants.py):**
  - Extended import and export templates to support secondary contacts: `Contact Person 2`, `Designation 2`, `Calling Number 2`, `WhatsApp Number 2`, and `WeChat Number 2`.
  - Added support for comma/slash-separated multiple phone numbers with normalization.
  - Applied migration [`41a972a6d3d4_widen_supplier_phone_columns.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/alembic/versions/41a972a6d3d4_widen_supplier_phone_columns.py) to widen phone columns to `VARCHAR(150)`.

### 2. Complete Removal of `Town` Column across Entire Stack
- **Database & Codebase Purge in [`models.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/suppliers/models.py) and [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Generated and applied Alembic migration [`86ea2b62aa9c_drop_town_from_suppliers.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/alembic/versions/86ea2b62aa9c_drop_town_from_suppliers.py).
  - Dropped `town` from `Supplier` model, Pydantic schemas (`SupplierCreate`, `SupplierUpdate`, `SupplierRead`), routes, repositories, search service, import/export headers, and frontend drawer/form bindings.

### 3. Form Layout Rebalancing & Address Relocation to Tab 1
- **Full-Width Address under Geography:**
  - Relocated `Address` field to **Tab 1 (General Information)** immediately beneath Country, Province, and City, spanning all 3 columns (`gridColumn: "1 / -1"`).
  - Removed `Address` and `Town` from Tab 2, rebalancing the remaining 6 profile fields into a symmetrical **2-row × 3-column** grid without empty cells.

### 4. Strict Province Master Validation
- **Master Integrity in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Removed `allowCustomText={true}` and `onTextChange` from `field-province`.
  - Eliminated `Use "..." (New) ↵ Enter` prompt; users can strictly select valid states from the Province Master (`/masters/states`), matching Country and City behavior.

### 5. Table Column Optimization: Column Consolidation (15 to 11 Columns) & Horizontal Scroll Elimination

### 1. Merged Company Name & Brand Column
- **2-Line Clamping & Informational Pill Tag in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Consolidated separate "Company Name" and "Brand" columns into a unified **"Company Name & Brand"** column.
  - Implemented 2-line clamping (`-webkit-line-clamp: 2`) with hover tooltip (`title={s.company_name}`) to comfortably accommodate long company names without breaking row layout.
  - Placed the Brand directly underneath as a subtle pill badge (`🏷️ <Brand>`) when present.

### 2. Merged Category & Sub-Category Column
- **Hierarchical Vertical Display in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Combined "Product Category" and "Key Strength Sub-Category" into **"Category & Sub-Category"**.
  - Renders category chips on line 1 and sub-category chips underneath on line 2 (`↳ 📂 <Sub-Category>`), maintaining full popover modal inspection.

### 3. Merged Products Supplied & Secondary Products Column
- **Unified Product Portfolio Presentation in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Combined Primary Products Supplied chips and Secondary Products description into a unified single column **"Products Supplied & Secondary"**.
  - Primary products render on line 1 (`📦 <Products> (+N)`), and secondary products render directly underneath on line 2 (`↳ 📦 <Secondary>`).

### 4. Removed Redundant Country Column from Frontend Table
- **Streamlined Geographic Column:**
  - Hidden the redundant `Country` (`China`) column from the list view table while preserving City and Province, saving 90px+ of horizontal space. Country remains intact in database models, edit forms, and Side Drawer.

### 5. Synchronized Skeleton Loader, Sorting & Freeze Menu
- **11-Column Unified System:**
  - Updated `displayOrder`, `SUPPLIER_TABLE_COLUMNS`, header sorting switch, and `SupplierSkeletonRows` to the new 11-column index structure.
  - Adjusted `TableMessageRow colSpan` to 11.

### 6. Master Quality Assurance (QA) & Verification Audit Checklist Added
- **Comprehensive Audit Specification in [`MODULE_SUPPLIERS.md`](file:///d:/Om%20work1/ERP/Yinglima_ERP/doc/MODULE_SUPPLIERS.md):**
  - Added dedicated Section 7 covering: Form dropdown integrity & cascading rules, Saving & two-way sync across table inline and inside form modal, Blue Company Name link triggering the 720px Side Drawer (Complete View) with 5 structured cards, 11-column layout verification, Top filter views with unlocked master search and 'All' reset, Dual contacts in import/export, and Loading time benchmarks (<300ms API, 0ms cached dropdowns).

### 7. Simplified Top Filter Dropdown Labels
- **Filter Labels Refined in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Renamed `Product Category` ➔ **`Category`**.
  - Renamed `Key Strength Sub Category` ➔ **`Product Sub Category`**.
  - Renamed `Product Supplied` ➔ **`Product`**.
  - Preserved all underlying cascading queries, debouncing, master lookups, and `"All"` reset behavior.

### 8. Official WhatsApp & WeChat SVG Brand Icons in Side Drawers
- **Icon Upgrades in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx) and [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Replaced generic chat bubble emojis (`💬` and `🗨️`) with crisp, official vector SVG brand symbols.
  - **WhatsApp:** Green `#25D366` SVG icon paired with clickable `https://wa.me/...` direct link.
  - **WeChat:** Green `#07C160` SVG dual-bubble icon for instant recognition.
  - Applied across Primary Contact Information (Card 2) and Additional Contacts (Card 5).

---

## [Release 2026-10-13] — Supplier Module Side Drawer Expansion, Potential Dropdown Fix & Master Documentation

### 1. Supplier Detail Side Drawer Overhaul (720px 2-Column Executive Layout)
- **Expanded Width & Structured Cards in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Expanded drawer from 480px to **720px** (`maxWidth: 720px, width: 100%`) for a spacious, non-overlapping dual-column layout.
  - Added 5 structured cards: Company Profile & Classification, Primary Contact Information, Factory Visit & Inspection Media, Pipeline Status & Commercial Evaluation, and Additional Contacts.
  - Implemented smart clickable badges for inspection videos and cloud folders (`▶️ YouTube Video ↗`, `📁 Google Drive ↗`, `📂 OneDrive ↗`, `🎬 Vimeo ↗`, `🎥 Video Link ↗`).
  - Added direct clickable links for Phone (`tel:`), WhatsApp (`https://wa.me/...`), Email (`mailto:`), and official websites.

### 2. Potential Dropdown Case-Sensitivity Bug Fix
- **Option Value Alignment in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Normalized database potential values (`"yes"` / `"no"`) with the Edit Modal's dropdown options, resolving the bug where suppliers with Potential = Yes were reverting to "Select Potential" upon opening the modal.

### 3. Supplier Master Requirement Specification Document
- **Master Documentation in [`MODULE_SUPPLIERS.md`](file:///d:/Om%20work1/ERP/Yinglima_ERP/doc/MODULE_SUPPLIERS.md):**
  - Compiled the complete master specification for the Supplier module, including field validations (calling number digit restrictions, WeChat/WhatsApp handling), business logic (one-way New -> Existing progression, deletion protection rules), side drawer architecture, and downstream cross-module integrations with Local Purchase, Sourcing, and Planning.

### 4. Floating Reference-Only Master Suggestion Dropdown for Supplier Company Name
- **Floating Suggestion Architecture in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Implemented an autocomplete-style floating suggestion container underneath the "Name of Company" field on the Supplier create/edit form.
  - Prioritizes prefix matches so typing `"o"` or `"om"` places matching suppliers like `"Om"` at the very top of the suggestion list.
  - Configured with `pointer-events: none` and `user-select: none` ("untouchable") to ensure suggestions are purely visual/informational and cannot be accidentally clicked or selected to overwrite user text.
  - Integrated real-time exact duplicate detection that blocks saving and shows an alert both inside the dropdown and beneath the blurred input field.

### 5. Sidebar Active-Click Page State Reset & Sequential History Preservation
- **Active Navigation Reset in [`AppShell.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/AppShell.tsx), [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx), and [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Fixed an issue where clicking on "Suppliers" in the sidebar while viewing the "Add Supplier" form did nothing because React Router ignored clicks to the currently active URL.
  - Added an active-click event bus (`erp:nav-active-click`) in `AppShell.tsx` that signals the mounted view to close any open forms, drawers, or import views and return directly to the main table/list.
  - Maintained strict browser history sequencing: navigating between pages (e.g. Suppliers ⇄ Buyers) pushes standard browser history entries so back and forward browser arrows work with 100% fidelity.

### 6. 3-Tier Cascading Categorization & Grouped Multi-Panel Dropdown for Products Supplied
- **Hierarchical Products Supplied Dropdown in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Upgraded **Products Supplied (multiple)** to dynamically filter products by both selected **Product Category (multiple)** and **Key Strength Sub-Category (multiple)**.
  - Configured intelligent disabled states: disabled with `"-- Please select Category first --"` if no category is selected, or `"-- Please select Sub-Categories first --"` if categories are chosen but no sub-categories have been selected yet.
  - When multiple categories and sub-categories are selected, products render in a grouped multi-panel dropdown organized under their parent Sub-Categories (labeled `${Category} › ${Sub-Category}` or `${Sub-Category}`), matching the UX design of the Sub-Category dropdown.
  - Supported master `Select All`, category/sub-category group-level select-all checkboxes with count indicators `(X/Y selected)`, and individual product checkboxes.
  - Implemented automatic pruning: removing a category prunes any selected sub-categories and products belonging to that category; removing a sub-category prunes any selected products under that sub-category.
### 7. Universal Top Filter Bar Unlock & Typeahead Master Search
- **Standardized Top Filter UX Across All Active ERP Modules:**
  - Upgraded top filter dropdowns in **Suppliers** (`Suppliers.tsx`), **Product Master** (`masters/Products.tsx`), **Buyers** (`Buyers.tsx`), **Product Prices** (`ProductPrices.tsx`), **Product Gallery** (`ProductGallery.tsx`), and **Local Purchases** (`LocalPurchases.tsx`).
  - **Eliminated Locked / Disabled Fields:** Completely removed arbitrary `disabled={!parent}` locks on cascading filters (such as *Sub Category*, *Province / State*, *City*).
  - **Master Typeahead Search with 'All' Support:** Every dropdown includes a live `Search / Type here...` input and an `"All"` reset option at the top.
  - **Dynamic Contextual Scoping:** If a parent filter is chosen, options are scoped to that parent; if no parent filter is chosen, users can search and select across all records directly from the respective master lookup/endpoint without friction.

---

## [Release 2026-10-13] — Latency & Response-Time Optimization Across Backend & Frontend

### 1. Backend N+1 Query Elimination & Eager Loading
- **RBAC Roles Preloading in [`repository.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/rbac/repository.py), [`routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/rbac/routes.py), and [`service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/rbac/service.py):**
  - Replaced serial loop querying permissions for each role (`for r in roles: await get_permission_codes_for_role(r.id)`) with `list_all_with_permissions` using SQLAlchemy `selectinload(Role.permission_links).selectinload(RolePermission.permission)`.
  - Dropped database round trips from 45 serial queries down to 2 batched queries.
  - Response time dropped from **5,464 ms to 340 ms (16x faster)**.
- **User Management Batching in [`users/routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/users/routes.py):**
  - Implemented `_batch_users_with_roles` replacing the 4 sequential queries per user row (roles, manager, position, employee position) with 3 single SQL queries using `IN (...)`.
  - Response time dropped from **2,928 ms to 620 ms (4.7x faster)**.

### 2. 0ms Fast-Path In-Memory DNS Resolution
- **Winsock DNS Bypass in [`dns_resilience.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/core/dns_resilience.py):**
  - Added an in-memory 60-second TTL fast-path cache to prevent repetitive Windows Winsock system calls (160ms each) on pooled Supabase connections across Yinglima ERP, Inhyma ERP, and Central ERP Main.

### 3. Frontend Route Code-Splitting with `React.lazy`
- **Dynamic Module Loading in [`App.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/App.tsx):**
  - Converted secondary and master pages to `React.lazy` dynamic imports wrapped with `<Suspense>`.
  - Initial production JavaScript bundle dropped from **1,497.86 kB (1.5 MB) down to 266.16 kB (82% smaller)**.
  - Heavy third-party packages such as SheetJS (`xlsx` at 429 kB) are now loaded strictly on-demand when Excel export/import actions occur.

### 4. Shell Caching & Form Optimization
- **Profile & Brand Caching in [`auth.ts`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/lib/auth.ts), [`AppShell.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/AppShell.tsx), and [`brand.ts`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/lib/brand.ts):**
  - Added 10-second throttling to `/auth/profile` sync to eliminate redundant network hits during navigation.
  - Added memory caching and in-flight request deduplication to `resolveBrandName()`, reducing `/organizations/public` calls to 0.99 ms.
- **Local Purchase Quote Optimization in [`LocalPurchaseForm.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchaseForm.tsx):**
  - Corrected lookup URL from `/suppliers?page_size=1000` to standard `/suppliers` to enable global caching.
  - Line-item quote lookups now execute in parallel via `Promise.all` and update state in a single batch, reducing form load latency to 269 ms.

---
## [Release 2026-10-12] — Local Purchase Supplier Type-Ahead, Bill Document Cloud Storage & RBAC Master Documentation

### 1. Local Purchase Supplier Searchable Combobox & Extraction Auto-Fill
- **Type-Ahead Autocomplete in [`LocalPurchaseForm.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchaseForm.tsx):**
  - Replaced the static HTML `<select>` dropdown with the application's reusable [`SearchableDropdown`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/SearchableDropdown.tsx).
  - Users can now type characters (e.g. "San", "LT", "Young") to filter suppliers in real time with keyboard navigation (Arrow Up/Down + Enter) and a quick-clear (`✕`) button.
  - Selecting a supplier automatically syncs with quotation line-item pricing and planning sheet imports.
- **Bill Document Cloud Storage in Supabase & Download Action:**
  - Extended local purchase backend schemas and services ([`schemas.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/purchases/local/schemas.py), [`service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/purchases/local/service.py), [`storage.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/common/storage.py)) to upload and persist invoice files (PDFs, images, Excel) to Supabase Storage.
  - Added direct invoice document download actions on both [`LocalPurchaseForm.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchaseForm.tsx) and [`LocalPurchaseDetailModal.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchaseDetailModal.tsx).
  - When **⚡ Extract Bill Data** runs, any detected supplier name or ID automatically resolves against the supplier database and pre-fills the type-ahead search bar.

### 2. Comprehensive RBAC & Permissions Master Guide
- **Master Documentation in [`ROLES_AND_PERMISSIONS_MASTER_GUIDE.md`](file:///d:/Om%20work1/ERP/Yinglima_ERP/doc/ROLES_AND_PERMISSIONS_MASTER_GUIDE.md):**
  - Created a full architectural and operational guide covering Yinglima ERP's Role-Based Access Control (RBAC) engine.
  - Documented the Department-Role convergence, the 3-tier precedence hierarchy (Super Admin > Department Defaults > User Overrides), and the mathematical effective permission formula.
  - Included a complete matrix of all 25 modules and their fine-grained permission codes (`module.action`), backend dependencies (`require_permission`), frontend UI guards (`<Can>`, `hasPermission`), and real-time Redis/memory cache invalidation lifecycles.

---

## [Release 2026-10-10] — Cross-Ecosystem Single Sign-Out (SLO), M2M Force Logout API & WebSocket Disconnect

### 1. Internal Machine-to-Machine Force-Logout API
- **Endpoint Implementation in [`internal_users.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/api/v1/internal_users.py):**
  - Added `POST /api/v1/internal/users/{identifier}/logout` guarded by `internal_service_dep` HMAC authentication.
  - Accepts local UUID or email/username prefix to resolve the user record.
  - Invokes `auth_service.force_logout_user(user.id)`, invalidating active sessions and recording a revocation timestamp to blacklist bearer tokens.
  - Emits real-time `FORCE_LOGOUT` frame across live WebSocket channels (`ws_manager.disconnect_user(str(user.id))`) to instantly disconnect open browser sessions.
- **Unit Test Coverage:**
  - Added `test_internal_logout_endpoint_works` in [`test_internal_users_foreign_keys.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/tests/test_internal_users_foreign_keys.py).

### 2. Multi-Origin Browser Session Invalidation & Shared Cookie Logout
- **Cross-Port Cookie Synchronization in [`ecosystemSession.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ecosystemSession.ts):**
  - Sets `ihm_ecosystem_logged_out=1` cookie on logout across domain `localhost` and configured subdomains with root path `/`.
  - Added `isExplicitlyLoggedOut()` helper checking both `sessionStorage` and the shared cookie marker.
  - Clears `ihm_ecosystem_logged_out` on fresh logins via `setEcosystemCookie()`.
- **Fast Watcher & App Lifecycle Defense:**
  - Configured `initEcosystemSessionWatcher()` to poll every 2.5 seconds and trigger on window focus and visibility changes.
  - In [`AppShell.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/components/AppShell.tsx), verified `isExplicitlyLoggedOut()` on mount and immediately purged local auth state (`Auth.clear()`) if any other ecosystem tab or app logged out.
  - In [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ssoBridge.ts), updated `isExplicitLogout` to use `isExplicitlyLoggedOut()`, preventing automatic SSO re-authentication after a user explicitly logged out.

---

## [Release 2026-10-10] — Spoke 403 Loop Elimination, Address Bar Query Sanitization & Cross-ERP Failover Redirection

### 1. Spoke ERP 403 Loop Prevention & Failover Cross-ERP Redirection
- **Immediate Address Bar Query Sanitization in [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ssoBridge.ts):**
  - In `processIncomingSsoHandover()`, stripped `sso_handover` from `window.location.search` immediately upon parsing via `window.history.replaceState`. Prevents re-submitting rejected tickets on browser refreshes or navigation changes.
- **Failover Cross-ERP Redirection on 403 Forbidden:**
  - When backend `POST /api/v1/auth/sso-handover` responds with 403 (e.g. user `userb@gmail.com` granted only Inhyma attempts to access Yinglima), the `catch` block clears stale credentials (`Auth.clear()`) and inspects the active central session.
  - Automatically redirects users to their granted spoke ERP (e.g. Inhyma at `http://localhost:5174/dashboard?sso_handover=...`) or the official central control plane (`http://localhost:5170/dashboard`), avoiding endless 403 exception retries.
- **AppShell & App Lifecycle Loop Defense:**
  - In [`AppShell.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/components/AppShell.tsx), sanitized `location.search` when redirecting to `/login` to ensure rejected handover parameters are not carried into login route state.
  - In [`App.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/App.tsx), added `ssoProcessedRef = useRef(false)` guard preventing repeated invocations across component re-renders.
  - In [`Login.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/Login.tsx), added mount-time handover processing parity with Inhyma ERP.

### 2. Auto-Activation on Central SSO Handover & Eviction Guard
- **Verified Account Auto-Activation in [`auth/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/auth/routes.py):**
  - In `sso_handover_login`, when central verification confirms the user is authorized for Yinglima, any existing account marked inactive or soft-deleted is automatically restored (`deleted_at = None`, `is_active = True`, `status = UserStatus.ACTIVE`). Unregistered users are auto-provisioned on the fly. Eliminates 403 errors when central permissions are restored.
- **Central Verification Before Eviction in [`AppShell.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/components/AppShell.tsx):**
  - Gated the logged-in access check behind `verifyCentralEcosystemSession`. Prevents stale localhost browser cookies from evicting newly authenticated users and eliminates multi-tab redirect loops.
- **Failover SSO Error Signaling in [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ssoBridge.ts):**
  - Appended `?sso_error=handover_failed` when redirecting back to the control plane, allowing ERP_Main to halt automated bouncing and retain the user on the control plane dashboard.

---

## [Release 2026-10-10] — Production HTTPS Mixed Content Elimination, Supabase PgBouncer Statement Cache Auto-Disable, Cascading Category Enforcement & Bi-Directional Password Sync Federation

### 1. Production Origin Security, Dynamic SSO Routing & User Isolation
- **`isLocalhost()` Security Interceptor:**
  - In [`ecosystemSession.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ecosystemSession.ts) and [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ssoBridge.ts), wrapped all `http://localhost:*` fallback URLs with `isLocalhost()` guards.
  - In production HTTPS deployments (e.g. Render, Cloudflare, custom domains), insecure `http://` calls to ports `:8000`, `:8001`, `:8002`, `:5170`, `:5173`, and `:5174` are suppressed, eliminating browser Mixed Content blocking errors (`Blocked loading mixed active content`).
- **Dynamic SSO Route Handling (`routeForCentralSession`):**
  - Added `routeForCentralSession` and `createSsoHandoverUrlFromSession` in [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ssoBridge.ts) to handle multi-ERP routing directly from central session data.
  - Users with 0 granted spoke ERPs (e.g. `User A`, `User B`, `User C`, `User D` with `allowed_erps = ["control-plane"]`) or $\ge 2$ spoke ERPs are automatically redirected to `http://localhost:5170/dashboard`.
  - Users with exactly 1 other spoke ERP are redirected to their assigned ERP dashboard.
- **User Isolation Guard:**
  - In `processIncomingSsoHandover()`, if the incoming ticket or cookie email differs from the local cached profile, `Auth.clear()` runs immediately to enforce strict account isolation and avoid session leakage across logins.
  - Direct navigation to Yinglima routes (`/dashboard`) by unassigned users triggers an automatic bounce to `http://localhost:5170/dashboard`.

### 2. Dual-Path Centralized Spoke Login (`Login.tsx`)
- **Central Session Routing & Graceful SSO Fallback in [`Login.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/Login.tsx):**
  - Updated the login workflow to perform local authentication while concurrently establishing the central ecosystem session with `ERP_Main`.
  - Supports flexible user lookup by canonical email, display name (e.g. `User A`), or username prefix.
  - If a user is not authorized for Yinglima (including zero-grant users), `routeForCentralSession` immediately redirects them via SSO handover to the official central dashboard (`http://localhost:5170/dashboard`) or their designated spoke ERP rather than throwing an unhandled error.
  - If a user's password was changed on another ERP and has not yet synced locally, the verified central session logs them in via SSO handover, preventing user lockouts.
  - Fails closed: if the user's central session is reported revoked or inactive, login is rejected immediately.

### 3. Bi-Directional Password Synchronization with ERP_Main
- **Password Fanout Client [`erp_main_client.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/federation/erp_main_client.py):**
  - Added `push_password_to_erp_main(email, new_password)` transmitting password changes to `ERP_Main` via `POST /internal/users/password` using internal service credentials.
- **Route Interceptors:**
  - Hooked into `change_password` in [`auth/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/auth/routes.py) and `reset_password` in [`users/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/users/routes.py).
  - Automatically pushes password updates to ERP_Main so they propagate across the entire multi-ERP ecosystem without raising into or interrupting the local caller.
- **Automated Test Suite:**
  - Added [`test_password_sync_to_erp_main.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/tests/test_password_sync_to_erp_main.py).

### 4. SSO Handover Central Verification Guard
- **Fail-Closed Session Confirmation in [`auth/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/auth/routes.py):**
  - Integrated `verify_ecosystem_session(session_id)` from [`erp_main_client.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/federation/erp_main_client.py) into `sso_handover_login`.
  - When `SSO_HANDOVER_REQUIRE_CENTRAL_VERIFICATION` is enabled, the backend verifies the central session against ERP_Main's live database before generating local tokens.
  - Ensures tokens constructed client-side cannot bypass access governance, and immediately rejects revoked or suspended accounts.
- **Automated Test Suite:**
  - Added [`test_sso_handover_central_verification.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/tests/test_sso_handover_central_verification.py).

### 5. Central Identity Protection on Local Profile Edits
- **Email Modification Lock in [`users/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/users/routes.py):**
  - Implemented `enforce_central_identity(user_service, user_id, payload)`.
  - Form re-submissions containing the existing email are permitted, but attempting to modify an email address locally throws `ForbiddenException("A user's email is managed centrally. Please change it from the ERP_Main Control Panel.")`, preventing broken SSO identity mappings.

### 6. Cascading Category Enforcement in Master Data UI
- **Required Category Selection Before Subcategory Population:**
  - In [`Products.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/masters/Products.tsx), [`Suppliers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx), [`Buyers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx), and [`SearchableDropdown.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/components/SearchableDropdown.tsx):
  - Strictly requires selecting a Primary Category before the Subcategory dropdown can be populated or selected.
  - Subcategory is disabled and indicates `"Select category first"` until a category is chosen.
  - Changing or clearing the Category automatically resets the selected Subcategory.

### 7. Database Connection Hardening for Supabase Transaction Pooler (PgBouncer)
- **Prepared Statement Cache Auto-Disable:**
  - In [`app/database/engine.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/database/engine.py), implemented `_statement_cache_must_be_disabled()`.
  - Auto-detects port 6543 / PgBouncer connection strings and disables asyncpg's prepared statement cache (`statement_cache_size=0`), preventing `DuplicatePreparedStatementError`.

### 8. Local Purchase Boolean Simplification
- In [`app/sales/service.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/sales/service.py), simplified `is_from_local_purchase` logic for clean, deterministic sourcing attribution.

### 9. Python Virtualenv Interpreter Resolution in `server.py`
- Fixed Windows virtual environment symlink resolution by using `sys.executable` directly rather than `Path(sys.executable).resolve()`.

### 10. Spare-Part Support in Sale Process Order Processing (`is_spare`)
- **Backend Schema & Service Extensions ([`models.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/sales/models.py), [`schemas.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/sales/schemas.py), [`service.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/sales/service.py)):**
  - Added `is_spare` boolean column to `sales_order_items` with validation in request schemas.
  - Handled spare-part unit pricing, packaging, and commercial calculations in `service.py`.
- **Frontend Interface ([`SaleProcessForm.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/sales/SaleProcessForm.tsx), [`SaleProcessDetailModal.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/sales/SaleProcessDetailModal.tsx), [`saleProcess.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/types/saleProcess.ts)):**
  - Added interactive spare-part toggle and product picker to differentiate main machines from spare components.
  - Added `[Spare]` visual badges and dedicated costing column displays in both the form and order detail modal.

### 11. Master Shipment Planning `(Blanks)` Filter & Migration Suite
- **Planning Grid Empty Cell Filtering ([`planning/repository.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/planning/repository.py), [`Planning.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/Planning.tsx)):**
  - Added `(Blanks)` filter option in column filter dropdowns, allowing logistics operators to filter container sheets for rows with unset values.
- **Migration & Health Diagnostic Scripts:**
  - Added [`migrate_master_planning.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/scripts/migrate_master_planning.py) for robust automated migration of master planning workbook data.
  - Added [`update_product_branches.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/scripts/update_product_branches.py) and [`inspect_counts.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/scripts/inspect_counts.py).

---

## [Release 2026-10-05] — Commercial Invoice (CI) 16-Column Costing Engine & Local Purchase Supplier Sourcing

### 1. Supplier & Purchase Price Source of Truth (Confirmed Local Purchase)
- **Primary Sourcing from Confirmed Local Purchase History:**
  - For Sale Process orders (`/sale/process/new` & `SaleProcessForm.tsx`), the **Supplier** and **Unit Price (RMB) Including VAT** are pulled directly from the **latest Confirmed Local Purchase order** for that product (`LocalPurchaseItem` joined to `LocalPurchase`).
  - Fallback logic: If the item has not yet been ordered via Local Purchase, the system queries preferred quotations in `supplier_product_links` (`Product Prices`), followed by `standard_cost` from Product Master.
  - Visual verification: Added `[✓ Local Purchase]` badge next to the supplier name in both the form and detail modal tables.

### 2. Dynamic HSN Refund VAT & Product Master Real-Value Sync
- **HSN Database Real-Value Migration:**
  - Standardized all 144 active HSN codes in `hsn_codes` table to `gst_percent = 18.00%` and `refund_vat_percent = 13.00%`.
  - Synced all 3,546 products in `products` table with their linked HSN's `13.00%` Refund VAT.
- **Dynamic Formula for Price Excluding VAT:**
  - Plain English formula: `Unit Price Excluding VAT = Unit Price Including VAT / (1 + (HSN Refund VAT% / 100))`.
  - For standard 13.00% VAT, `¥113.00 Incl. VAT` dynamically yields `¥100.00 Excl. VAT`.

### 3. Full 16-Column Commercial Invoice Engine (Exact Excel Spreadsheet Replica)
- Matches Yinglima's official export commercial invoice spreadsheet (`doc/Yinglima_CI_Inhyma_YL-EXP2026-54.xlsx`):
  1. `SR.NO` — Sequential item number.
  2. `SUPPLIER` — Sourced from Confirmed Local Purchase history with `[✓ Local Purchase]` badge.
  3. `DESCRIPTION` — Product Name & Code.
  4. `CHINA HS CODE` — Official China export HS Code.
  5. `QUANTITY` — Number of units planned in consignment.
  6. `UNIT PRICE (RMB) INCL. VAT` — Factory purchase rate from Local Purchase invoice.
  7. `UNIT PRICE (RMB) EXCL. VAT` — Price without VAT (`Price Incl. VAT / (1 + Refund VAT%)`).
  8. `PROFIT %` — Profit margin (default 3.00%, editable).
  9. `PRICE WITH PROFIT (RMB)` — `Price Excl. VAT * (1 + (Profit% / 100))`.
  10. `FOB PRICE (USD)` — `Price With Profit (RMB) / USD Exchange Rate (6.70)`.
  11. `TOTAL CBM (M³)` — `Packaging CBM / Packaging Qty * Planned Qty`.
  12. `FREIGHT/UNIT (USD)` — `Total Container Freight / Container CBM * Item CBM / Qty`.
  13. `CFR PRICE/UNIT (USD)` — `FOB Price (USD) + Freight/Unit (USD)`.
  14. `TOTAL AMOUNT CFR (USD)` — `Quantity * CFR Price/Unit (USD)`.
  15. `TOTAL SUPPLIER AMOUNT (RMB)` — `Quantity * Unit Price (RMB) Incl. VAT`.
  16. `REMARKS` — Packing notes or consignment instructions.

### 4. Database Schema & Backend Trade Engine Extensions
- **`sales_orders` Table:**
  - Added `ocean_freight_usd`, `local_charges_coc_usd`, `usd_exchange_rate`, `profit_percent`, `total_container_cbm`.
- **`sales_order_items` Table:**
  - Added `supplier_id`, `supplier_name`, `unit_price_rmb_with_vat`, `unit_price_rmb_ex_vat`, `profit_percent`, `fob_price_usd`, `freight_unit_usd`, `cfr_price_usd`, `cbm_per_unit`, `total_cbm`, `total_supplier_amount_rmb`.
- **API Endpoints:**
  - `GET /api/v1/sales/products/{product_id}/costing-info`: returns complete costing payload with Local Purchase supplier.
  - `GET /api/v1/sales/orders/{id}/trade-details`: returns all 16 CI columns with container costing metrics.
  - `GET /api/v1/sales/orders/{id}/trade-documents/excel`: generates official 16-column Excel spreadsheet.

### 5. Frontend UI Upgrades in Sale Process Form & Detail Modal
- **`SaleProcessForm.tsx`:**
  - Sourcing from Local Purchase when extracting consignments or adding individual items.
  - Added Container & Export Freight panel (Ocean freight, local COC charges, USD rate, profit %, container CBM).
  - Added toggle `[ 📊 Costing & Supplier Columns (Active) ]` to display all 16 calculation columns inline.
- **`SaleProcessDetailModal.tsx`:**
  - Added CI View Mode toggle: `[ 📊 Full Costing & Supplier Engine (16 Columns - Excel Replica) ]` vs `[ 📄 Standard Customer CI (7 Columns) ]`.
  - Added Freight and Costing KPI cards above invoice (Ocean freight, COC charges, total freight, rate/CBM, exchange rate, profit margin, total supplier payable).

---

## [Release 2026-10-05] — Production Deployment Readiness, Zero-LAN URL Decoupling & Multi-Cloud Infrastructure

### 1. Quotation Portal URL Parametrization
- **Eliminated Hardcoded LAN Fallback:** In [`routes.py:1057`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/inquiries/routes.py#L1057), replaced the hardcoded `192.168.1.23:5173` LAN IP fallback with `(request.headers.get("origin") or getattr(settings, "FRONTEND_URL", "http://localhost:5173")).rstrip("/")`. Automated RFQ quotation email links now resolve dynamically to the live production domain.

### 2. Central Control Plane Dynamic Navigation & SSO Handover
- **Decoupled User Management Link:** In [`Users.tsx:990`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/Users.tsx#L990), replaced hardcoded `http://localhost:5170/access/users` with dynamic URL resolution from `getEcosystemErps()` / `VITE_CONTROL_PLANE_URL`.
- **SSO Handover Integration:** Wrapped the button link with `createSsoHandoverUrl` so operators navigating to the Central Dashboard are seamlessly authenticated.

### 3. Multi-ERP Ecosystem & Session Synchronization
- **Configurable Spoke & Control Plane URLs:** Updated [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ssoBridge.ts) to read `VITE_CONTROL_PLANE_URL`, `VITE_CONTROL_PLANE_API_URL`, `VITE_YINGLIMA_URL`, `VITE_INHYMA_URL`, and `VITE_API_ORIGIN`.
- **Cross-Subdomain SSO Cookies:** Updated [`ecosystemSession.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ecosystemSession.ts) to support `VITE_CENTRAL_AUTH_API` and `VITE_COOKIE_DOMAIN`.
- **Pydantic Settings:** Added `BACKEND_URL` and `FRONTEND_URL` to the `Settings` class in [`config.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/core/config.py).

### 4. Cloud Infrastructure Assets
- **Docker & Nginx:** Added [`frontend/Dockerfile`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/Dockerfile) and [`frontend/nginx.conf`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/nginx.conf) with SPA fallback rewrites and asset caching.
- **Render Blueprint:** Added [`render.yaml`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/render.yaml) for 1-click Render web service and static site provisioning.
- **Dynamic Port Binding:** Updated [`backend/Dockerfile`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/Dockerfile) to dynamically bind to `${PORT:-8001}`.
- **Compose Orchestration:** Added [`docker-compose.prod.yml`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/docker-compose.prod.yml).

## [Release 2026-10-10] — Real-Time Provisioning Synchronization & Soft-Deleted User Restoration
- **Re-Granting Restoration:** Updated `POST /api/v1/internal/users/provision` in [`internal_users.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/api/v1/internal_users.py) to look up users by email regardless of `deleted_at`. When access is restored in ERP_Main, any soft-deleted user is reactivated (`deleted_at = None`, `is_active = True`, `status = ACTIVE`) and their password updated if provided.
- **Dynamic List Filtering:** Soft-deleted users are omitted from active user queries (`/users`), while restored users immediately reappear upon being granted access.

---

## [Release 2026-10-10 Part 2] — Ecosystem Session Reliability, Cross-ERP Switching & False Logout Elimination

### 1. Root Cause Resolution for False Logouts and Switch Loops
- **Session Revocation Disambiguation:** In [`ecosystemSession.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ecosystemSession.ts), the `ihm_ecosystem_logged_out` cookie was previously written as a generic `"1"`, causing newly established sessions to be flagged as revoked.
- **Session-ID Keyed Revocation:** `clearEcosystemCookie(sessionId)` now records the exact revoked session ID inside `ihm_ecosystem_logged_out`. `isExplicitlyLoggedOut(currentSessionId)` only flags revocation if the cookie's recorded ID matches the current active session.
- **SSO Handover Exemption:** Added immediate exemption for incoming SSO handover navigation (`sso_handover` query param in URL) ensuring switching users are never rejected as logged out.
- **Cross-Domain/Port Cleansing:** Added `clearCookieEverywhere` and `setCookieEverywhere` covering host-only, `localhost`, `127.0.0.1`, current hostname, and `VITE_COOKIE_DOMAIN`.

### 2. Multi-Tab Session Synchronization & Polling Loop Hardening
- **Watcher Polling Loop Fix:** Removed redundant calls to `clearEcosystemCookie()` inside periodic polling, preventing perpetual renewal of the 60-second logout window.
- **Tab Focus Stale State Recovery:** Window `focus` events purge stale tab-scoped `ihm_explicit_logout` flags when an active local session exists.

### 3. Switcher Fallbacks & Local Login Session Recovery
- **Switch Failure Fallback:** Wrapped `handleSwitch` in [`EcosystemSwitcher.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/components/EcosystemSwitcher.tsx) in try/catch blocks with direct navigation fallback.
- **Local Login Fallback Session:** In [`Login.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/Login.tsx), local login automatically establishes a fallback ecosystem session cookie if central control plane communication is degraded.

### 4. Backend Multi-Identifier & Role-Based Authorization
- **Comprehensive Key Resolution:** In [`routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/auth/routes.py), `sso_handover_login` matches against all known Yinglima identifiers (`yinglima`, `erp-02`, and dynamic `settings.ERP_KEY`), eliminating 403 Forbidden false rejections when central permissions use machine keys or friendly names.
- **Central Authority & Super Admin Exemption:** Central role verification honors `central.get("role") == "super_admin"` with ecosystem-wide access, preventing super admins or users with valid grants from getting trapped in redirect loops.

---

## [Release 2026-10-03] — Machine Identifiers & Dynamic Company Branding from ERP Settings

### 1. Backend Machine Identifiers (`erp-01` and `erp-02`)
- **Machine Identification Contract:** Added `ERP_INSTANCE_ID = "erp-02"` in [`config.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/core/config.py) for backend routing, heartbeat checks, and machine-to-machine federation.
- **Public Branding Endpoint (`GET /organizations/public`):** Added in [`organizations/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/organizations/routes.py) returning `{ company_name, legal_name, logo_url, erp_id }` unauthenticated.

### 2. Dynamic Human-Facing Branding from ERP Settings
- **Dynamic Brand Resolver:** Updated [`brand.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/brand.ts) and [`nav.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/nav.ts) to default to generic `"ERP"` and dynamically resolve the active company name from `GET /organizations/public`, persisting to `localStorage` (`erp_org_company_name`) for 0ms flicker-free hydration.
- **Dynamic Forms & Portals:**
  - [`PublicSupplierQuotePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/PublicSupplierQuotePage.tsx): RFQ title and footer dynamically display the resolved organization name.
  - [`SaleProcessForm.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/sales/SaleProcessForm.tsx): Organization name state defaults to `getCachedBrandName()`.
  - [`Users.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/Users.tsx): Replaced static naming with generic subtitle.
- **Cross-ERP Switcher:** Updated [`EcosystemSwitcher.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/components/EcosystemSwitcher.tsx) and [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ssoBridge.ts) to dynamically resolve peer ERP company names from peer `/organizations/public` endpoints.
- **Automated Regression Suite:** Added [`brandResolution.test.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/__tests__/brandResolution.test.ts).

---

## [Release 2026-09-30] — Dual-Mode Master Import & Safe Update Engine

### 1. Dual-Mode Excel/CSV Import ("Add New" vs "Update Existing")
- **Interactive Action Switcher (`ImportWizard.tsx`, `MasterPage.tsx`):**
  - **➕ Add New Records Only (Create):** Strictly inserts new records; skips matching entries to prevent accidental duplicates.
  - **✏️ Update / Modify Existing Records (Safe Enrichment):** Matches existing records by unique code or name and updates filled columns.
  - **Zero Data Loss Guarantee:** Empty or blank cells in the uploaded spreadsheet are completely ignored and will **never** overwrite or erase existing database values.
- **Full Masters Coverage:** Enabled across Product Master (`/masters/products`) and all System Masters (`uom`, `currencies`, `countries`, `states`, `cities`, `brands`, `hsn`, `product-categories`, `product-sub-categories`, `buyer-types`, `supplier-types`, `company-list`).
- **Automated Verification Suite:** Verified via [`tests/test_dual_mode_master_import.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/tests/test_dual_mode_master_import.py) with 100% pass rate.

---

## [Release 2026-09-29] — Supplier Multi-Media Links, Company Autocomplete & Gallery Fixes

### 1. Supplier Multi-Media & Inspection Links (`visit_media`)
- **File Added:** `VideoTagInput` in [`Yinglima_ERP/frontend/src/components/fields.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/fields.tsx) integrated into [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx).
- Supports multiple links (comma/Enter separated) with smart icon pills (YouTube `▶️`, Google Drive `📁`, OneDrive `📂`, Video `🎥`).
- Clickable pills open directly in a new tab (`target="_blank"`).

### 2. Company Name Typeahead, Suggestion & Enter Key Support
- Enhanced [`SearchableDropdown.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/SearchableDropdown.tsx) with `sublabel` support to show supplier types (`manufacturer`, `dealer / trader`) next to suggestions.
- Suggestions cleanly grouped under `EXISTING SIMILAR SUPPLIERS`.
- Dynamic `Use "<Typed>" (New)` option with `↵ Enter` keyboard badge.
- Full keyboard navigation: pressing `Enter` or clicking immediately accepts custom name and closes dropdown.
- Exact duplicate prevention (`⛔ Supplier already exists`) strictly enforced.

### 3. Product Gallery & Media Deletion Persistence
- Fixed photo deletion persistence in PostgreSQL without cascade or reference validation errors.
- Added image error fallbacks for unavailable cloud storage.

---

## [Release 2026-09-29] — Global Autocomplete Blocker & Ecosystem Form Hardening

### 1. Global Autocomplete & Autofill Blocker System
- **File Added:** [`Yinglima_ERP/frontend/src/lib/autocompleteBlocker.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/autocompleteBlocker.ts).
- **Core Functionality:**
  - Automated continuous DOM `MutationObserver` on `document.body` detecting all newly mounted forms and inputs.
  - Automatically injects `autocomplete="off"`, `autocapitalize="off"`, `spellcheck="false"`, `data-lpignore="true"` (LastPass disabler), and `data-form-type="other"` (1Password/Bitwarden heuristic disabler).
  - Implemented document-level capture-phase `focusin` event interceptor to guarantee suppression attributes are active prior to browser suggestions rendering.
- **Root Initialization:** Connected to application lifecycle in [`Yinglima_ERP/frontend/src/App.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/App.tsx).

### 2. Wheel Scroll Lockout & Spin-Button Elimination
- Preserved existing passive wheel blur listener and CSS spin-button suppression, ensuring alignment across all 3 ERP frontends.

---

## [Release 2026-09-26] — Spoke Deprovisioning & Ecosystem Switcher Synchronization

### 1. Internal Deprovisioning Endpoint
- **File Added:** [`Yinglima_ERP/backend/app/api/v1/internal_users.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/api/v1/internal_users.py).
- Implemented `POST /api/v1/internal/users/{id}/deprovision` to revoke active sessions and set `deleted_at = NOW()`, `is_active = False`.
- Added soft-delete filtering in `UserRepository.search()` to ensure deprovisioned users disappear from `/users`.

### 2. Spoke User Management Cleanup
- Removed local password reset and forced logout buttons from spoke UI, centralizing user governance in `ERP_Main`.

### 3. Proactive Ecosystem Session Sync & SSO Identity Preservation
- Updated topbar `EcosystemSwitcher.tsx` to call `establishCentralEcosystemSession` on mount, ensuring newly assigned permissions reflect without full re-login.
- Updated `ssoBridge.ts` to read `Auth.getProfile()?.email` and `first_name` so switching users switch under their own identity without falling back to admin.

---

## [Prior Releases] — Core Procurement & Planning Engine
- **Inbound IMAP Poller & AI Extractor:** Bidirectional mailbox poller inspecting `INBOX` and `[Gmail]/Sent Mail`. First supplier reply triggers GPT extraction; subsequent replies bypass AI for zero wasted API costs.
- **Master Shipment Planning Sheets:** Dynamic spreadsheet grid with automated CBM optimization for 20GP, 40GP, 40HQ, and 45HQ shipping containers.
- **Supabase Media Storage:** Cloud persistent storage for supplier visit photos and quotation attachments.
