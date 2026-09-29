# Yinglima_ERP — Changelog & Function Changes History

**System:** Yinglima_ERP (China Procurement)  
**Scope:** Functional updates, schema changes, UI hardening, and bug fixes.

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
