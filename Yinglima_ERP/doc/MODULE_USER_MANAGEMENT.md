# Module Guide: User Management, Positions & Departments (`user_management`)

**System:** Yinglima_ERP  
**Module:** User Accounts, Employee Positions & Departments/RBAC (`/users`, `/positions`, `/rbac`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-12  

---

## 1. Overview & Purpose

The **User Management** module encompasses:
1. **User Accounts & Passwords (`/users`):** Workforce members, login credentials, central SSO federation status, lockouts, and direct permission overrides.
2. **Positions & Designations (`/positions`):** Job titles, ranks, and reporting structures.
3. **Departments & Permissions (`/rbac`):** Department-Role converged units, permission matrices, parent/child department hierarchies, and user assignment types (PRIMARY, SECONDARY, TEMPORARY, PROJECT, ACTING).

---

## 2. Key Architecture & File Map

### Frontend:
* **Users Page:** `Users.tsx` (Route: `/users`)
* **Positions Page:** `Positions.tsx` (Route: `/positions`)
* **Departments & RBAC Matrix:** `Rbac.tsx` (Route: `/rbac`)
* **User Overrides Modal:** `UserPermissionOverrideModal.tsx`
* **Department Hierarchy Card:** `DepartmentHierarchyCard.tsx`

### Backend:
* **User Routes & Service:** `app/users/routes.py`, `app/users/service.py`
* **RBAC Routes & Service:** `app/rbac/routes.py`, `app/rbac/service.py`
* **Positions Routes:** `app/positions/routes.py`
* **Database Models:** `app/users/models.py` (`users`), `app/rbac/models.py` (`roles`, `permissions`, `role_permissions`, `user_roles`, `user_permissions`, `department_hierarchy`)

---

## 3. Precedence Hierarchy & Effective Permissions

$$\text{Effective Permissions} = \left( \bigcup_{r \in \text{ActiveRoles}} \text{Permissions}(r) \cup \text{UserGrants} \right) \setminus \text{UserDenies}$$

* **Super Admin:** Passes all checks unconditionally (`AdminPermissionSet`).
* **Active Roles:** Must be `status == ACTIVE` and within `[effective_from, effective_to]`.
* **User Overrides:** Explicit grants (`is_granted=True`) and explicit revokes (`is_granted=False`) take highest priority.

---

## 4. Query Batching & Performance (Release 2026-10-13)

- **Batched User Enrichment in `/users`:**
  - Implemented `_batch_users_with_roles` in `app/users/routes.py` to replace sequential 4-query-per-user lookup with 3 batched SQL `IN (...)` queries (roles, managers, employee positions).
  - Eliminates the N+1 query cascade, reducing network round trips to Supabase from 40+ down to 3 and cutting response time from **2,928 ms to 620 ms**.
- **Eager Loading in `/rbac/roles`:**
  - Replaced 45 serial permission queries with SQLAlchemy `selectinload(Role.permission_links).selectinload(RolePermission.permission)` in `list_all_with_permissions`.
  - Dropped response time from **5,464 ms to 340 ms (16x faster)**.

---

## 5. What Needs to Be Verified (Testing Checklist)

- [ ] **Role Permission Save & Cache Invalidation:**
  - In `/rbac`, modify a department's permissions and click **Save Changes**.
  - Verify `user_perms:{user_id}` cache key is immediately invalidated so changes take effect without re-logging in.
- [ ] **User Override Modal:**
  - In `/users`, open a user's action menu ➔ **Permissions**.
  - Explicitly DENY an action that their department has. Verify that action immediately disappears or disables for that user.
- [ ] **Department Hierarchy (Multi-Parent / Multi-Child):**
  - Connect a child department to a parent. Verify circular hierarchy prevention (cycle detection).
- [ ] **Account Lockout on Failed Logins:**
  - 5 failed login attempts lock account for 15 minutes (`UserStatus.LOCKED`). Verify lockout message.

---

## 6. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Strict security and organizational constraints:**

1. **System Role Protection:**
   - The `super_admin` role has `is_system=True`. Never permit deleting or renaming `super_admin`.
2. **Central SSO Identity Consistency:**
   - In a multi-ERP setup, user accounts synchronized via Central Control Plane (`ERP_Main`) must preserve their central UUIDs and emails. Local edits must not disconnect federation identifiers.
3. **Soft-Delete Cascade Safety:**
   - Deleting a Role does NOT hard-delete `RolePermission` or `UserRole` rows. Soft-deleted roles have `deleted_at IS NOT NULL` and are excluded from effective permission resolution until purged.
4. **Dynamic Central Control Plane Linkage:**
   - Central user management navigation (`centralUsersUrl`) derives its host strictly from the active ERP registry via `getEcosystemErps()`, eliminating hardcoded local development hostnames or ports.

