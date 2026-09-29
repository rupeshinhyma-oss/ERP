# ERP_Main — Changelog & Function Changes History

**System:** ERP_Main Control Plane  
**Scope:** Chronological engineering changes, function updates, UI hardening, and bug fixes.

---

## [Release 2026-09-29] — Global Autocomplete Blocker & UI Hardening

### 1. Global Autocomplete & Autofill Suppression System
- **File Added:** [`ERP_Main/frontend/src/lib/autocompleteBlocker.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/lib/autocompleteBlocker.ts).
- **Core Functionality:**
  - Automated continuous DOM `MutationObserver` on `document.body` detecting all newly mounted forms and inputs.
  - Automatically injects `autocomplete="off"`, `autocapitalize="off"`, `spellcheck="false"`, `data-lpignore="true"` (LastPass disabler), and `data-form-type="other"` (1Password/Bitwarden heuristic disabler).
  - Implemented document-level capture-phase `focusin` event interceptor to guarantee suppression attributes are active prior to browser suggestions rendering.
- **Root Initialization:** Connected to application lifecycle in [`ERP_Main/frontend/src/App.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/App.tsx).
- **Explicit Form Hardening:**
  - Hardened inputs across [`GlobalUsers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/pages/GlobalUsers.tsx), [`PlatformAuthz.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/pages/PlatformAuthz.tsx), and [`ErpRegistry.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/pages/ErpRegistry.tsx).

### 2. Wheel Scroll Lockout & Spin-Button Elimination
- **Document Wheel Listener:** Added passive `wheel` listener in [`ERP_Main/frontend/src/main.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/main.tsx) that immediately triggers `.blur()` on `input[type="number"]` when scrolled, preventing accidental numeric value mutations.
- **CSS Spin-Button Removal:** Updated [`ERP_Main/frontend/src/styles/style.css`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/styles/style.css) with `-webkit-outer-spin-button` and `-webkit-inner-spin-button` display suppression and `-moz-appearance: textfield`.

---

## [Release 2026-09-26] — Access Governance Unification & True Spoke Deprovisioning

### 1. Unified Access Grants UI
- **Retired Standalone Tab:** Removed redundant `/access/memberships` navigation tab and routed all traffic directly to `/access/users`.
- **Integrated Modal Controls:** Replaced decoupled membership assignment with unified "ERP Access Grants" checkboxes inside the Global User Create and Edit modals.
- **Clean Badge Normalization:** Unassigned or revoked spoke access now renders as neutral gray `None` badges (`Inhyma: • None`).

### 2. True Spoke User Deprovisioning
- **Internal RPC Adapter:** Implemented `deprovision_local_user()` in [`adapters/http_adapter.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/identity_linking/adapters/http_adapter.py) invoking spoke endpoint `POST /api/v1/internal/users/{id}/deprovision`.
- **Automated Revocation:** Unchecking an access grant terminates remote sessions and soft-deletes the local spoke record so they disappear from the spoke user table.
- **Root Admin Protection:** Enforced safety invariants preventing the deprovisioning of `admin@example.com`.

### 3. Conditional Navigation Architecture
- **Single-ERP Users:** Automatically redirected from central login (`:5170`) to their authorized spoke ERP (`:5173` or `:5174`) with an SSO handover token; switcher dropdown is hidden.
- **Multi-ERP Users:** Retained on the central ERP Dashboard with access to the topbar Ecosystem Switcher.

### 4. Ecosystem Switcher Bug Fix (Alice Wonder)
- **Attribute Fix:** Resolved `AttributeError: type object 'ErpInstance' has no attribute 'erp_key'` by correcting the query to `select(ErpMembership, ErpInstance.key)` in `ecosystem_session.py`.
- **Session Cookie Generation:** Allowed `ihm_ecosystem_session` to be issued properly with `allowed_erps: ["yinglima", "inhyma", "control-plane"]`.

---

## [Phases 1–7] — Core Infrastructure & Projections
- Implemented OpenID Connect (OIDC) authority, RS256 token signing, and JWKS endpoint.
- Built ERP Registry with spoke discovery and health probes.
- Built Event Ingestion and Materialized Projections Engine with Dead Letter Queue.
- Implemented asynchronous CSV/XLSX export engine with directory traversal protection.
