# Module Guide: System Settings, Audit Logs & Trash (`system_settings`)

**System:** Yinglima_ERP  
**Module:** ERP Settings, Audit Logs & Trash Recovery (`/organization`, `/audit`, `/trash`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-11-28  

---

## 1. Overview & Purpose

This module handles governance, data protection, and traceability:
1. **ERP Settings (`/organization`):** Company corporate profile, default currencies, system logos, invoice header text, and tax IDs.
2. **Audit Logs (`/audit`):** Immutable append-only log of every user login, role assignment, record creation, update, and deletion across the system.
3. **Trash Management (`/trash`):** Central bin for soft-deleted records across all modules (Suppliers, Buyers, Products, Local Purchases, Inquiries, Planning). Provides 1-click **Restore** or permanent **Purge**.

---

## 2. Key Architecture & File Map

### Frontend:
* **Settings & Branding:** `Organization.tsx` (`/organization`), `src/lib/brand.ts` (`BLANK_FAVICON_URL`, `subscribeBrandLogo`, cross-tab `storage` sync), `AppShell.tsx`, `Login.tsx`, `NetworkStatusNotifier.tsx`, `index.html`, `src/pages/__tests__/OrganizationLogo.test.tsx`
* **Audit Log Viewer:** `Audit.tsx` (Route: `/audit`)
* **Trash Management:** `Trash.tsx` (Route: `/trash`)

### Backend:
* **Organizations & Branding Service/Routes:** `app/organizations/{models,schemas,repository,service,routes}.py`, `alembic/versions/z0a1b2c3d4e7_add_organization_logo_data.py` (`organizations.logo_data`), `app/common/storage.py` (`delete_stored_file`), `app/main.py` (`/uploads/branding`), `tests/test_organization_logo.py`
* **Audit Service & Routes:** `app/audit/service.py`, `app/audit/routes.py`
* **Trash Service & Routes:** `app/trash/service.py`, `app/trash/routes.py`
* **Models:** `app/organizations/models.py` (`organizations`), `app/audit/models.py` (`audit_logs`), Base Model `SoftDeleteMixin` (`deleted_at`, `deleted_by`)

---

## 3. Soft-Delete & Trash Recovery Lifecycle

```
[User clicks Delete on any record]
              │
              ├──> Sets `deleted_at = NOW()`, `deleted_by = user.id`
              ├──> Appends AUDIT_LOG entry with action `DELETE`
              │
[Record disappears from active list, immediately visible in /trash]
              │
              ├───> [User clicks "Restore"] ──> Sets `deleted_at = NULL` (Record restored)
              └───> [Admin clicks "Purge"]   ──> Runs hard DB DELETE (Permanent deletion)
```

---

## 4. What Needs to Be Verified (Testing Checklist)

- [ ] **Soft Delete & Immediate Trash Visibility:**
  - Soft-delete a Supplier, Product, or Local Purchase order.
  - Navigate to `/trash`. The record must appear with timestamp, deleter identity, and module name.
- [ ] **1-Click Restore:**
  - In `/trash`, click **Restore**. The record must vanish from trash and immediately reappear in its source module.
- [ ] **Audit Trail Immutability:**
  - Perform an edit on a product or supplier. Check `/audit`. The change must record with actor ID, IP address, changed fields, and timestamp.
  - Audit logs cannot be edited or deleted by any user (including Super Admin).
- [ ] **Permission Gates:**
  - Viewing audit logs requires `audit.view`.
  - Viewing trash requires `trash.view`.
  - Restoring / purging items requires `trash.action`.
- [ ] **Company Logo Upload, Safe Replacement & Blank-State Removal (`/organization`):**
  - Clicking **Remove Logo** clears `logo_url`/`logo_data` via `DELETE /api/v1/organizations/logo` and leaves ERP Settings preview, top-left sidebar header, login header, and browser tab favicon blank/white with zero `/logo.png` fallback.
  - Clicking **Change PNG Logo** and cancelling or failing upload preserves the existing logo intact; once upload succeeds (`POST /api/v1/organizations/logo`), the previous logo file is deleted and all UI surfaces/favicons update immediately across open tabs.

---

## 5. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Strict security and data integrity constraints:**

1. **No Hard Deletes in Operational Endpoints:**
   - Every `DELETE` route across Suppliers, Buyers, Products, Inquiries, Planning, and Local Purchases must implement `SoftDeleteMixin`. Hard `session.delete()` is only permitted inside the administrative Trash Purge service.
2. **Audit Log Non-Repudiation:**
   - Audit log rows are strictly append-only. There is intentionally no `PATCH` or `DELETE` route for `audit_logs` in the entire API codebase.

---

## 6. High-Speed Unified Trash Query Architecture & In-Memory SWR Caching (Release 2026-10-26)

### 6.1 Single Database Round-Trip (`UNION ALL`)
- Previously, `TrashService.list_trash` issued 22 separate SQL `SELECT` queries across 22 individual tables over the network sequentially, causing latency to spike to ~948 ms.
- Re-architected into a single consolidated `UNION ALL` query using SQL literal selects:
  ```sql
  SELECT 'suppliers' AS module_name, id, COALESCE(CAST(name AS text), CAST(id AS text)) AS record_name, deleted_at, deleted_by FROM suppliers WHERE deleted_at IS NOT NULL
  UNION ALL
  SELECT 'products' AS module_name, id, COALESCE(CAST(name AS text), CAST(id AS text)) AS record_name, deleted_at, deleted_by FROM products WHERE deleted_at IS NOT NULL
  ... (across all 22 registered soft-deleted tables)
  ORDER BY deleted_at DESC
  ```
- Added partial database indexes on `(deleted_at) WHERE deleted_at IS NOT NULL` across high-volume tables.
- **Result:** Latency dropped from **948.63 ms** to **257.58 ms** (~4x faster).

### 6.2 Frontend 0ms SWR In-Memory Caching (`frontend/src/pages/Trash.tsx`)
- Integrated `trashCache` in-memory snapshot with silent background revalidation.
- Navigating to `/trash` or returning via back button renders the data table and category counter badges at **0ms** immediately without skeleton reset.
- Background revalidation refreshes live state silently.



## 7. Master Production Readiness Remediation (2026-11-28)
- **Audit Log Pagination Optimization (`BUG-026`, `audit/repository.py`):**
  - Overrode `AuditRepository.paginated_list()` to execute an indexed page query plus a separate narrow `SELECT COUNT(audit_logs.id)` query instead of materializing wide JSON `TEXT` columns inside `COUNT(*) OVER ()`.
- **Federation Health Latency & Least-Privilege Exposure (`BUG-026`, `api/v1/health.py`):**
  - `GET /api/v1/health/federation` now returns an immediate minimal payload anonymously (0 outbound peer HTTP probes) and runs parallel `asyncio.gather` peer checks with a 2.0s timeout and 15s TTL cache only for authenticated operators/spoke services.
- **WebSocket Pool & Connection Safety (`BUG-014`, `auth/dependencies.py`, `events/routes.py`, `planning/routes.py`, `database/engine.py`):**
  - Replaced `Depends(get_db_session)` on long-lived WebSocket endpoints with short-lived `verify_websocket_token()` sessions released immediately after auth handshake; bounded production pool to `pool_size=10, max_overflow=10` and enabled `NullPool` under pytest.
- **Production Boot Guards & Test DB Isolation (`BUG-005`, `BUG-015`, `core/config.py`, `tests/conftest.py`):**
  - Enforced startup validation rejecting default/weak JWT secrets, insecure dev flags, and wildcard CORS in production (`ENVIRONMENT=production`).
  - Hardened `tests/conftest.py` to refuse hosted/Supabase/production DB URLs during pytest and default to an isolated disposable SQLite file cleaned up on session exit.
- **Durable Events, Integration Error Mapping & Fresh-DB Migrations (`BUG-008`, `BUG-011`, `BUG-013`, `BUG-024`, `BUG-025`):**
  - Fixed `durable_events/routes.py` keyword argument calls (`db=db`), mapped domain/validation errors cleanly in `integration/routes.py` (`400`/`409`/`200 NOOP` instead of `500`), made fresh-DB Alembic migrations idempotent through single head `h0c1d2e3f4a5` (reconciling `products.supplier_id` and `supplier_product_links.updated_at`), and assigned distinct sidebar navigation icons (`IconBarChart`, `IconClipboardList`, `IconReceipt`, `IconTag`) in `nav.ts`.
