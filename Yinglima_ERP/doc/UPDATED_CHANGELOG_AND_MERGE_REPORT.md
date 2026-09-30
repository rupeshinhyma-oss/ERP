# Ecosystem Changelog & Git Merge Report

**Date:** September 30, 2026  
**Repository:** `https://github.com/rupeshinhyma-oss/ERP.git`  
**Merge Commit:** `daef444 Merge remote-tracking branch 'origin/main'`  
**Branch Status:** Local `main` branch cleanly merged with `origin/main` and pushed.

---

## 1. Executive Summary

A full multi-repository synchronization was completed. Remote updates from `origin/main` for **ERP_Main** and **Inhyma_ERP** (Leads, Follow Ups, and Platform Authorization cleanup) were pulled and merged cleanly, while **100% of all local optimizations and enhancements for Yinglima_ERP have been safely preserved and verified**.

---

## 2. Remote Changes Pulled & Merged (Inhyma_ERP & ERP_Main)

### A. Inhyma_ERP (`Inhyma_ERP/`)
1. **Follow Ups Module:**
   - Implemented complete Follow Ups module (`FollowUpsPage.tsx`, backend models, repositories, routes, and tests).
2. **Leads Module & Cascading Address:**
   - Implemented Leads module (`LeadsPage.tsx`, `ClientNameAutocomplete.tsx`, backend models, routes, and test suite).
   - Added cascading address selection across Country, State, District, and City.
3. **Company & Master Enhancements:**
   - Added district lookups and address cascading in Companies and Organization screens.

### B. ERP_Main (`ERP_Main/`)
1. **Platform Authorization & Roles Cleanup:**
   - Removed obsolete modules and redundant launcher components.
   - Refactored `PlatformAuthz.tsx` and platform authorization tests.
2. **Global Autocomplete Blocker:**
   - Added `autocompleteBlocker.ts` to suppress browser autofill bubbles across all inputs.

---

## 3. Local Changes Retained & Committed (Yinglima_ERP)

All local modifications for **Yinglima_ERP** were staged, verified, and committed:

### A. Dual-Mode Excel/CSV Import & Safe Update
- Enabled interactive action toggle ("➕ Add New Records Only" vs "✏️ Update / Modify Existing Records") in `ImportWizard.tsx` and `MasterPage.tsx`.
- Guaranteed **Zero Data Loss**: Empty or blank spreadsheet cells never overwrite existing values.
- Covered Product Master (`/masters/products`) and all System Masters (`uom`, `currencies`, `countries`, `states`, `cities`, `brands`, `hsn`, `product-categories`, `product-sub-categories`, `buyer-types`, `supplier-types`, `company-list`).
- Verified via automated test suite `tests/test_dual_mode_master_import.py` (100% pass rate).

### B. Supplier Factory Video & Inspection Folder Multi-Link Input (`visit_media`)
- Implemented `VideoTagInput` in `fields.tsx` and integrated into `Suppliers.tsx`.
- Supports multiple links with smart icon pills (YouTube, Google Drive, OneDrive, Video).
- Clickable pills open directly in a new tab (`target="_blank"`).

### C. Company Name Typeahead, Suggestion & Enter Key Support
- Enhanced `SearchableDropdown.tsx` with `sublabel` support to show supplier types next to suggestions.
- Suggestions cleanly grouped under `EXISTING SIMILAR SUPPLIERS`.
- Dynamic `Use "<Typed>" (New)` option with `↵ Enter` keyboard badge.
- Full keyboard navigation: pressing `Enter` or clicking immediately accepts custom name and closes dropdown.
- Exact duplicate prevention strictly enforced.

### D. Product Gallery & Media Deletion Persistence
- Fixed photo deletion persistence in PostgreSQL without cascade or reference validation errors.
- Added image error fallbacks for unavailable cloud storage.

---

## 4. Verification & Health Summary

| Component | Status | Verification Detail |
| :--- | :--- | :--- |
| **Git Working Tree** | Clean | Working tree clean; pushed to `origin/main` (`1a64cd7..daef444`). |
| **Yinglima Backend** | Healthy | Pytest ran `test_dual_mode_master_import.py` and `test_health.py` with 8/8 passed. |
| **Yinglima Frontend** | Built | `npm run build` completed in 2.67s with 0 TypeScript errors. |
