# Module Guide: System Settings, Audit Logs & Trash (`system_settings`)

**System:** Yinglima_ERP  
**Module:** ERP Settings, Audit Logs & Trash Recovery (`/organization`, `/audit`, `/trash`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-12  

---

## 1. Overview & Purpose

This module handles governance, data protection, and traceability:
1. **ERP Settings (`/organization`):** Company corporate profile, default currencies, system logos, invoice header text, and tax IDs.
2. **Audit Logs (`/audit`):** Immutable append-only log of every user login, role assignment, record creation, update, and deletion across the system.
3. **Trash Management (`/trash`):** Central bin for soft-deleted records across all modules (Suppliers, Buyers, Products, Local Purchases, Inquiries, Planning). Provides 1-click **Restore** or permanent **Purge**.

---

## 2. Key Architecture & File Map

### Frontend:
* **Settings:** `Organization.tsx` (Route: `/organization`)
* **Audit Log Viewer:** `Audit.tsx` (Route: `/audit`)
* **Trash Management:** `Trash.tsx` (Route: `/trash`)

### Backend:
* **Audit Service & Routes:** `app/audit/service.py`, `app/audit/routes.py`
* **Trash Service & Routes:** `app/trash/service.py`, `app/trash/routes.py`
* **Models:** `app/audit/models.py` (`audit_logs`), Base Model `SoftDeleteMixin` (`deleted_at`, `deleted_by`)

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

---

## 5. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Strict security and data integrity constraints:**

1. **No Hard Deletes in Operational Endpoints:**
   - Every `DELETE` route across Suppliers, Buyers, Products, Inquiries, Planning, and Local Purchases must implement `SoftDeleteMixin`. Hard `session.delete()` is only permitted inside the administrative Trash Purge service.
2. **Audit Log Non-Repudiation:**
   - Audit log rows are strictly append-only. There is intentionally no `PATCH` or `DELETE` route for `audit_logs` in the entire API codebase.
