"""
Bootstrap / Seed Script.

Populates the database with the minimum data needed to log in and start
administering the system through the API itself:

1. The full permission set (``user.create``, ``inventory.read``, etc.).
2. Exactly two system roles:
     - ``super_admin`` (displayed to users as "Admin") -- full access to
       every permission in the system. This role is reserved for the single
       hardcoded bootstrap admin account (``settings.BOOTSTRAP_ADMIN_USERNAME``)
       and is protected from deletion/rename. No one else should ever be
       assigned this role through the normal "assign role" API (see
       ``app.rbac.service.RBACService`` / ``app.users.service.UserService``
       for the enforcement of this rule).
     - ``user`` -- the default, low-privilege role automatically assigned to
       every other newly-created account, granting basic read access.
3. A bootstrap admin user (credentials from ``settings.BOOTSTRAP_ADMIN_*``)
   assigned the ``super_admin`` role.

The previous version of this script also seeded a duplicate, fully-
privileged ``admin`` role plus a set of hardcoded per-department business
roles (sales/purchase/hr/accounts/inventory/logistics). Those have been
removed: they duplicated ``super_admin``'s access (in the case of
``admin``) or encoded assumptions about the organization's department
structure that don't belong in a generic seed script. Use the Roles &
Permissions screen to create whatever custom roles your organization
actually needs.

Idempotent: safe to run multiple times. Existing permissions/roles/the
admin user are left untouched (looked up by their unique code/name/username
and skipped if already present) rather than duplicated or overwritten.

Usage:
    python -m scripts.seed
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone

from sqlalchemy import select

from app.auth.security import hash_password
from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.database.engine import dispose_engine, get_sessionmaker
from app.rbac.models import Permission, Role, RolePermission
from app.rbac.repository import PermissionRepository, RoleRepository
from app.users.models import User, UserStatus
from app.users.repository import UserRepository

logger = get_logger(__name__)

# --- Bootstrap permission set (Module -> Page -> Action -> Scope hierarchy) ---
BOOTSTRAP_PERMISSIONS: list[tuple[str, str, str, str, str, str]] = [
    # (code, module, page, action, scope, description)
    # Users
    ("user.view", "user", "users", "view", "ALL", "View user accounts; use search and the Active/Inactive tabs."),
    ("user.create", "user", "users", "create", "ALL", "Create user accounts."),
    ("user.action", "user", "users", "manage", "ALL", "Use the Actions menu on a user row: view details, edit profile, reset password, assign role, permission overrides, activate/deactivate, suspend/unsuspend, unlock, force logout, and delete."),
    # HRMS Module
    ("hrms.view", "hrms", "hrms", "view", "ALL", "View HRMS modules: Attendance, Leave, Expenses, Site Visit, Payroll, Setup."),
    ("hrms.create", "hrms", "hrms", "create", "ALL", "Create leave requests, regularization requests, and HRMS records."),
    ("hrms.update", "hrms", "hrms", "update", "ALL", "Edit HRMS records, leave types, holidays, and policies."),
    ("hrms.approve", "hrms", "hrms", "approve", "ALL", "Approve or reject leave requests and attendance regularizations."),
    ("hrms.manage", "hrms", "hrms", "manage", "ALL", "Full administrative control over HRMS setup, leave types, adjustments, and approvals."),
    ("hrms.location_assignments.manage", "hrms", "hrms-setup", "manage", "ALL", "Assign primary and additional office locations to employees for multi-location attendance."),
    ("hrms.attendance", "hrms", "attendance", "view", "ALL", "Access HRMS Attendance module."),
    ("hrms.leave", "hrms", "leave", "view", "ALL", "Access HRMS Leave module."),
    ("hrms.assets", "hrms", "assets", "view", "ALL", "Access HRMS Asset Management module."),
    ("hrms.expenses", "hrms", "expenses", "view", "ALL", "Access HRMS Expense Management module."),
    ("hrms.site_visits", "hrms", "site_visits", "view", "ALL", "Access HRMS Site Visit module."),
    ("hrms.payroll", "hrms", "payroll", "view", "ALL", "Access HRMS Payroll module."),
    ("hrms.payroll.configure", "hrms", "payroll", "manage", "ALL", "Configure salary structures and payroll setup."),
    ("hrms.payroll.approve", "hrms", "payroll", "approve", "ALL", "Approve and lock monthly payroll."),
    ("hrms.setup", "hrms", "setup", "manage", "ALL", "Access HRMS Setup and global configuration."),
    # CRM Module
    ("crm.pipelines.view", "crm", "crm-pipelines", "view", "ALL", "View CRM pipelines and stage configuration"),
    ("crm.pipelines.manage", "crm", "crm-pipelines", "manage", "ALL", "Create, update, reorder and manage CRM pipelines and stages"),
    ("crm.leads.import", "crm", "crm-leads", "import", "ALL", "Import CRM leads via CSV files"),
    ("crm.leads.view", "crm", "crm-leads", "view", "ALL", "View CRM leads and import batches"),
    ("crm.leads.manage", "crm", "crm-leads", "manage", "ALL", "Full administrative control over CRM leads"),
    # Employee was merged into User (Organization/Employee/IAM upgrade,
    # merge phase) -- there is no separate employee.* permission family
    # anymore. Managing "the employee directory" now means managing users
    # (some of whom have has_login=False), governed entirely by the
    # user.* permissions above.
    # Departments were merged into Roles (Organization/Employee/IAM upgrade,
    # merge phase) -- department management (create/edit/delete, employee
    # assignment, leadership) now goes through the existing
    # "roles_permissions.*" permissions below via the same "Departments &
    # Permissions" screen. There is no separate orgdepartment.* permission
    # family anymore.
    # Positions / Designations (Organization/Employee/IAM upgrade).
    ("position.view", "position", "positions", "view", "ALL", "View positions/designations and their assigned employees."),
    ("position.create", "position", "positions", "create", "ALL", "Create positions/designations."),
    ("position.update", "position", "positions", "update", "ALL", "Edit positions, and manage employee position assignments."),
    ("position.delete", "position", "positions", "delete", "ALL", "Delete positions/designations."),
    # Reporting Structure / Org Chart (Organization/Employee/IAM upgrade).
    ("reporting.view", "reporting", "org-chart", "view", "ALL", "View reporting relationships and the organization chart."),
    ("reporting.manage", "reporting", "org-chart", "manage", "ALL", "Create, change, or remove employee reporting relationships."),
    # Organization Settings (Super Admin system-level)
    ("organization.manage", "organization", "organization", "manage", "ALL", "View and manage system organization profile."),
    # Organization List (Configurations > Organization List; distinct page from
    # Organization Settings above -- lists group entities/companies and their
    # branches). Previously referenced a "company.view" permission in
    # frontend/src/lib/nav.ts that was never actually seeded, and the entire
    # backend module (create/update/delete/activate/deactivate) had NO
    # permission check at all.
    ("organizationlist.view", "organizationlist", "masters-company-list", "view", "ALL", "View the Organization List; use search and the Active/Inactive tabs."),
    ("organizationlist.create", "organizationlist", "masters-company-list", "create", "ALL", "Create organizations/companies."),
    ("organizationlist.update", "organizationlist", "masters-company-list", "update", "ALL", "Edit and activate/deactivate organizations/companies."),
    ("organizationlist.delete", "organizationlist", "masters-company-list", "delete", "ALL", "Delete organizations/companies."),
    ("organizationlist.export", "organizationlist", "masters-company-list", "export", "ALL", "Export Organization List data."),
    ("organizationlist.import", "organizationlist", "masters-company-list", "import", "ALL", "Import Organization List data."),
    ("organizationlist.bulk_action", "organizationlist", "masters-company-list", "manage", "ALL", "Use Bulk Actions in the Organization List."),
    # Trash (System > Trash). Deliberately view-only by design: restoring,
    # permanently deleting, and emptying trash are NOT gated by this or any
    # other permission -- that matches how this module already behaves today
    # and is an intentional, explicit choice, not an oversight.
    ("trash.view", "trash", "trash", "view", "ALL", "View the Trash (list of soft-deleted items)."),
    # Roles & Permissions (User Management > Roles & Permissions). This page
    # is currently superAdminOnly in the frontend nav, and every backend route
    # in app.rbac.routes has NO permission check at all -- it relies entirely
    # on that frontend-only gate. Adding real permissions here, enforced on
    # the backend, is what actually makes this page grantable to a
    # non-super-admin role for the first time.
    ("roles_permissions.view", "roles_permissions", "rbac", "view", "ALL", "View roles and their permission assignments."),
    ("roles_permissions.create", "roles_permissions", "rbac", "create", "ALL", "Create a new role (+ ADD NEW), including via Clone Role Permissions."),
    ("roles_permissions.action", "roles_permissions", "rbac", "manage", "ALL", "Per-role actions: delete a single role, grant/revoke a permission on a role, and manage a user's individual permission overrides."),
    ("roles_permissions.bulk_action", "roles_permissions", "rbac", "manage", "ALL", "Bulk-delete selected roles (the green DELETE button)."),
    # Suppliers
    ("supplier.view", "supplier", "suppliers", "view", "ALL", "View the supplier list and contacts; use search, filters, and the Active/Inactive tabs."),
    ("supplier.create", "supplier", "suppliers", "create", "ALL", "Create suppliers via Quick Add or Add New, and add supplier contacts."),
    ("supplier.update", "supplier", "suppliers", "update", "ALL", "Edit suppliers (Action > Edit), activate/deactivate, and edit contacts."),
    ("supplier.delete", "supplier", "suppliers", "delete", "ALL", "Delete suppliers (Action > Delete) and remove supplier contacts."),
    ("supplier.export", "supplier", "suppliers", "export", "ALL", "Export supplier data."),
    ("supplier.import", "supplier", "suppliers", "import", "ALL", "Import supplier data."),
    ("supplier.bulk_action", "supplier", "suppliers", "manage", "ALL", "Use Bulk Actions (bulk activate, deactivate, or delete) in the supplier list."),
    ("supplier.grade_edit", "supplier", "suppliers", "update", "ALL", "Edit the Grade dropdown in the supplier list (read-only without this)."),
    ("supplier.potential_edit", "supplier", "suppliers", "update", "ALL", "Edit the Potential dropdown in the supplier list (read-only without this)."),
    # Companies
    ("company.view", "company", "companies", "view", "ALL", "View the company list and contacts; use search, filters, and the Active/Inactive tabs."),
    ("company.quick_add", "company", "companies", "create", "ALL", "Show + QUICK ADD button and create companies via Quick Add drawer."),
    ("company.create", "company", "companies", "create", "ALL", "Show + ADD NEW button and create companies via full Add Company form."),
    ("company.update", "company", "companies", "update", "ALL", "Show Action column Edit button, edit companies (Action > Edit), activate/deactivate, and edit contacts."),
    ("company.delete", "company", "companies", "delete", "ALL", "Delete companies (Bulk Actions > Bulk Delete) and remove company contacts."),
    ("company.export", "company", "companies", "export", "ALL", "Show EXPORT option in Imp / Exp menu and export company data."),
    ("company.import", "company", "companies", "import", "ALL", "Show SAMPLE FILE and IMPORT options in Imp / Exp menu and import company data."),
    ("company.bulk_action", "company", "companies", "manage", "ALL", "Show selection checkboxes and Bulk Actions menu (Bulk Activate / Bulk Deactivate) in the company list."),
    ("company.grade_edit", "company", "companies", "update", "ALL", "Edit the Grade dropdown in the company list (read-only without this)."),
    ("company.potential_edit", "company", "companies", "update", "ALL", "Edit the Potential dropdown in the company list (read-only without this)."),
    ("company.manage", "company", "companies", "manage", "ALL", "Full administrative control over Companies, including Quick Add, Add New, Grade/Potential edits, Import, Export, Bulk Actions, Action Edit, and Delete."),
    # Agents (Contact > Agents)
    ("agent.view", "agent", "agents", "view", "ALL", "View the agent list and details; use search and filters."),
    ("agent.create", "agent", "agents", "create", "ALL", "Create new agents."),
    ("agent.update", "agent", "agents", "update", "ALL", "Edit existing agents."),
    ("agent.delete", "agent", "agents", "delete", "ALL", "Delete agents."),
    ("agent.bulk_action", "agent", "agents", "manage", "ALL", "Bulk-delete selected agents."),
    # Industrial Zones (Contact > Industrial Zones)
    ("zone.view", "zone", "industrial-zones", "view", "ALL", "View industrial zones; use search and filters."),
    ("zone.create", "zone", "industrial-zones", "create", "ALL", "Create industrial zones."),
    ("zone.update", "zone", "industrial-zones", "update", "ALL", "Edit industrial zones."),
    ("zone.delete", "zone", "industrial-zones", "delete", "ALL", "Delete industrial zones."),
    ("zone.bulk_action", "zone", "industrial-zones", "manage", "ALL", "Bulk-delete selected industrial zones."),
    # Supplier Types (Configurations master; independent of the Suppliers module above)
    ("suppliertype.view", "suppliertype", "supplier-types", "view", "ALL", "View supplier types; use search, filters, and the Active/Inactive tabs."),
    ("suppliertype.create", "suppliertype", "supplier-types", "create", "ALL", "Create supplier types."),
    ("suppliertype.update", "suppliertype", "supplier-types", "update", "ALL", "Edit and activate/deactivate supplier types."),
    ("suppliertype.delete", "suppliertype", "supplier-types", "delete", "ALL", "Delete supplier types."),
    ("suppliertype.export", "suppliertype", "supplier-types", "export", "ALL", "Export supplier type data."),
    ("suppliertype.import", "suppliertype", "supplier-types", "import", "ALL", "Import supplier type data."),
    ("suppliertype.bulk_action", "suppliertype", "supplier-types", "manage", "ALL", "Use Bulk Actions in the supplier type list."),
    # Buyers (Clients)
    ("buyer.view", "buyer", "buyers", "view", "ALL", "View the buyer list and contacts; use search, filters, and the Active/Inactive tabs."),
    ("buyer.create", "buyer", "buyers", "create", "ALL", "Create buyers via Add New Buyer, and add buyer contacts."),
    ("buyer.update", "buyer", "buyers", "update", "ALL", "Edit buyers (Action > Edit); activate/deactivate; edit contacts."),
    ("buyer.delete", "buyer", "buyers", "delete", "ALL", "Delete buyers (Action > Delete) and remove buyer contacts."),
    ("buyer.export", "buyer", "buyers", "export", "ALL", "Export buyer data."),
    ("buyer.import", "buyer", "buyers", "import", "ALL", "Import buyer data."),
    ("buyer.bulk_action", "buyer", "buyers", "manage", "ALL", "Use Bulk Actions (bulk activate, deactivate, or delete) in the buyer list."),
    ("buyer.currentstatus", "buyer", "buyers", "update", "ALL", "Edit the Current Status dropdown in the buyer list and edit form (read-only without this)."),
    ("buyer.potential", "buyer", "buyers", "update", "ALL", "Edit the Potential dropdown in the buyer list and edit form (read-only without this)."),
    ("buyer.clientgrade", "buyer", "buyers", "update", "ALL", "Edit the Client Grade dropdown in the buyer list and edit form (read-only without this)."),
    # Buyer Types (Configurations master; independent of the Buyers module above)
    ("buyertype.view", "buyertype", "buyer-types", "view", "ALL", "View buyer types; use search, filters, and the Active/Inactive tabs."),
    ("buyertype.create", "buyertype", "buyer-types", "create", "ALL", "Create buyer types."),
    ("buyertype.update", "buyertype", "buyer-types", "update", "ALL", "Edit and activate/deactivate buyer types."),
    ("buyertype.delete", "buyertype", "buyer-types", "delete", "ALL", "Delete buyer types."),
    ("buyertype.export", "buyertype", "buyer-types", "export", "ALL", "Export buyer type data."),
    ("buyertype.import", "buyertype", "buyer-types", "import", "ALL", "Import buyer type data."),
    ("buyertype.bulk_action", "buyertype", "buyer-types", "manage", "ALL", "Use Bulk Actions in the buyer type list."),
    # Master Data Configurations
    ("country.view", "country", "masters-countries", "view", "ALL", "View countries."),
    ("country.create", "country", "masters-countries", "create", "ALL", "Create countries."),
    ("country.update", "country", "masters-countries", "update", "ALL", "Update countries."),
    ("country.delete", "country", "masters-countries", "delete", "ALL", "Delete countries."),
    ("country.export", "country", "masters-countries", "export", "ALL", "Export country data."),
    ("country.import", "country", "masters-countries", "import", "ALL", "Import country data."),
    ("country.bulk_action", "country", "masters-countries", "manage", "ALL", "Use Bulk Actions in the country list."),
    ("state.view", "state", "masters-states", "view", "ALL", "View states."),
    ("state.create", "state", "masters-states", "create", "ALL", "Create states."),
    ("state.update", "state", "masters-states", "update", "ALL", "Update states."),
    ("state.delete", "state", "masters-states", "delete", "ALL", "Delete states."),
    ("state.export", "state", "masters-states", "export", "ALL", "Export state data."),
    ("state.import", "state", "masters-states", "import", "ALL", "Import state data."),
    ("state.bulk_action", "state", "masters-states", "manage", "ALL", "Use Bulk Actions in the state list."),
    ("district.view", "district", "masters-districts", "view", "ALL", "View districts."),
    ("district.create", "district", "masters-districts", "create", "ALL", "Create districts."),
    ("district.update", "district", "masters-districts", "update", "ALL", "Update districts."),
    ("district.delete", "district", "masters-districts", "delete", "ALL", "Delete districts."),
    ("district.export", "district", "masters-districts", "export", "ALL", "Export district data."),
    ("district.import", "district", "masters-districts", "import", "ALL", "Import district data."),
    ("district.bulk_action", "district", "masters-districts", "manage", "ALL", "Use Bulk Actions in the district list."),
    ("city.view", "city", "masters-cities", "view", "ALL", "View cities."),
    ("city.create", "city", "masters-cities", "create", "ALL", "Create cities."),
    ("city.update", "city", "masters-cities", "update", "ALL", "Update cities."),
    ("city.delete", "city", "masters-cities", "delete", "ALL", "Delete cities."),
    ("city.export", "city", "masters-cities", "export", "ALL", "Export city data."),
    ("city.import", "city", "masters-cities", "import", "ALL", "Import city data."),
    ("city.bulk_action", "city", "masters-cities", "manage", "ALL", "Use Bulk Actions in the city list."),
    ("currency.view", "currency", "masters-currencies", "view", "ALL", "View currencies."),
    ("currency.create", "currency", "masters-currencies", "create", "ALL", "Create currencies."),
    ("currency.update", "currency", "masters-currencies", "update", "ALL", "Update currencies."),
    ("currency.delete", "currency", "masters-currencies", "delete", "ALL", "Delete currencies."),
    ("currency.export", "currency", "masters-currencies", "export", "ALL", "Export currency data."),
    ("currency.import", "currency", "masters-currencies", "import", "ALL", "Import currency data."),
    ("currency.bulk_action", "currency", "masters-currencies", "manage", "ALL", "Use Bulk Actions in the currency list."),
    ("uom.view", "uom", "masters-uom", "view", "ALL", "View units of measurement."),
    ("uom.create", "uom", "masters-uom", "create", "ALL", "Create units of measurement."),
    ("uom.update", "uom", "masters-uom", "update", "ALL", "Update units of measurement."),
    ("uom.delete", "uom", "masters-uom", "delete", "ALL", "Delete units of measurement."),
    ("uom.export", "uom", "masters-uom", "export", "ALL", "Export unit of measurement data."),
    ("uom.import", "uom", "masters-uom", "import", "ALL", "Import unit of measurement data."),
    ("uom.bulk_action", "uom", "masters-uom", "manage", "ALL", "Use Bulk Actions in the unit of measurement list."),
    ("tax.view", "tax", "masters-taxes", "view", "ALL", "View taxes and HSN numbers."),
    ("tax.create", "tax", "masters-taxes", "create", "ALL", "Create tax entries."),
    ("tax.update", "tax", "masters-taxes", "update", "ALL", "Update tax entries."),
    ("tax.delete", "tax", "masters-taxes", "delete", "ALL", "Delete tax entries."),
    ("tax.export", "tax", "masters-taxes", "export", "ALL", "Export tax data."),
    ("tax.import", "tax", "masters-taxes", "import", "ALL", "Import tax data."),
    ("tax.bulk_action", "tax", "masters-taxes", "manage", "ALL", "Use Bulk Actions in the taxes list."),
    # Additional Charges Master
    ("additionalcharge.view", "additionalcharge", "masters-additional-charges", "view", "ALL", "View additional charges; use search, filters, and the Active/Inactive tabs."),
    ("additionalcharge.create", "additionalcharge", "masters-additional-charges", "create", "ALL", "Create additional charges."),
    ("additionalcharge.update", "additionalcharge", "masters-additional-charges", "update", "ALL", "Edit and activate/deactivate additional charges."),
    ("additionalcharge.delete", "additionalcharge", "masters-additional-charges", "delete", "ALL", "Delete additional charges."),
    ("additionalcharge.export", "additionalcharge", "masters-additional-charges", "export", "ALL", "Export additional charges data."),
    ("additionalcharge.import", "additionalcharge", "masters-additional-charges", "import", "ALL", "Import additional charges data."),
    ("additionalcharge.bulk_action", "additionalcharge", "masters-additional-charges", "manage", "ALL", "Use Bulk Actions in the additional charges list."),
    # Social Media Master
    ("socialmedia.view", "socialmedia", "masters-social-media", "view", "ALL", "View social media platforms; use search, filters, and the Active/Inactive tabs."),
    ("socialmedia.create", "socialmedia", "masters-social-media", "create", "ALL", "Create social media platforms."),
    ("socialmedia.update", "socialmedia", "masters-social-media", "update", "ALL", "Edit and activate/deactivate social media platforms."),
    ("socialmedia.delete", "socialmedia", "masters-social-media", "delete", "ALL", "Delete social media platforms."),
    ("socialmedia.export", "socialmedia", "masters-social-media", "export", "ALL", "Export social media data."),
    ("socialmedia.import", "socialmedia", "masters-social-media", "import", "ALL", "Import social media data."),
    ("socialmedia.bulk_action", "socialmedia", "masters-social-media", "manage", "ALL", "Use Bulk Actions in the social media list."),
    # Agent Types Master
    ("agenttype.view", "agenttype", "masters-agent-types", "view", "ALL", "View agent types; use search, filters, and the Active/Inactive tabs."),
    ("agenttype.create", "agenttype", "masters-agent-types", "create", "ALL", "Create agent types."),
    ("agenttype.update", "agenttype", "masters-agent-types", "update", "ALL", "Edit and activate/deactivate agent types."),
    ("agenttype.delete", "agenttype", "masters-agent-types", "delete", "ALL", "Delete agent types."),
    ("agenttype.export", "agenttype", "masters-agent-types", "export", "ALL", "Export agent types data."),
    ("agenttype.import", "agenttype", "masters-agent-types", "import", "ALL", "Import agent types data."),
    ("agenttype.bulk_action", "agenttype", "masters-agent-types", "manage", "ALL", "Use Bulk Actions in the agent types list."),
    # Company Categories Master
    ("companycategory.view", "companycategory", "masters-company-categories", "view", "ALL", "View company categories; use search, filters, and the Active/Inactive tabs."),
    ("companycategory.create", "companycategory", "masters-company-categories", "create", "ALL", "Create company categories."),
    ("companycategory.update", "companycategory", "masters-company-categories", "update", "ALL", "Edit and activate/deactivate company categories."),
    ("companycategory.delete", "companycategory", "masters-company-categories", "delete", "ALL", "Delete company categories."),
    ("companycategory.export", "companycategory", "masters-company-categories", "export", "ALL", "Export company categories data."),
    ("companycategory.import", "companycategory", "masters-company-categories", "import", "ALL", "Import company categories data."),
    ("companycategory.bulk_action", "companycategory", "masters-company-categories", "manage", "ALL", "Use Bulk Actions in the company categories list."),
    # Company Sectors Master
    ("companysector.view", "companysector", "masters-company-sectors", "view", "ALL", "View company sectors; use search, filters, and the Active/Inactive tabs."),
    ("companysector.create", "companysector", "masters-company-sectors", "create", "ALL", "Create company sectors."),
    ("companysector.update", "companysector", "masters-company-sectors", "update", "ALL", "Edit and activate/deactivate company sectors."),
    ("companysector.delete", "companysector", "masters-company-sectors", "delete", "ALL", "Delete company sectors."),
    ("companysector.export", "companysector", "masters-company-sectors", "export", "ALL", "Export company sectors data."),
    ("companysector.import", "companysector", "masters-company-sectors", "import", "ALL", "Import company sectors data."),
    ("companysector.bulk_action", "companysector", "masters-company-sectors", "manage", "ALL", "Use Bulk Actions in the company sectors list."),
    # Warehouses Master
    ("warehouse.view", "warehouse", "masters-warehouses", "view", "ALL", "View warehouses; use search, filters, and the Active/Inactive tabs."),
    ("warehouse.create", "warehouse", "masters-warehouses", "create", "ALL", "Create warehouses."),
    ("warehouse.update", "warehouse", "masters-warehouses", "update", "ALL", "Edit and activate/deactivate warehouses."),
    ("warehouse.delete", "warehouse", "masters-warehouses", "delete", "ALL", "Delete warehouses."),
    ("warehouse.export", "warehouse", "masters-warehouses", "export", "ALL", "Export warehouse data."),
    ("warehouse.import", "warehouse", "masters-warehouses", "import", "ALL", "Import warehouse data."),
    ("warehouse.bulk_action", "warehouse", "masters-warehouses", "manage", "ALL", "Use Bulk Actions in the warehouse list."),
    ("brand.view", "brand", "masters-brands", "view", "ALL", "View brands; use search, filters, and the Active/Inactive tabs."),
    ("brand.create", "brand", "masters-brands", "create", "ALL", "Show + ADD NEW button and create brands."),
    ("brand.update", "brand", "masters-brands", "update", "ALL", "Show Action column Edit button and edit brands."),
    ("brand.delete", "brand", "masters-brands", "delete", "ALL", "Show Action column Delete button and Bulk Delete option, and delete brands."),
    ("brand.export", "brand", "masters-brands", "export", "ALL", "Show EXPORT option in Imp / Exp menu and export brand data."),
    ("brand.import", "brand", "masters-brands", "import", "ALL", "Show SAMPLE FILE and IMPORT options in Imp / Exp menu and import brand data."),
    ("brand.bulk_action", "brand", "masters-brands", "bulk_action", "ALL", "Show selection checkboxes and Bulk Actions menu (Bulk Activate / Bulk Inactive) in the brand list."),
    ("brand.status_edit", "brand", "masters-brands", "status_edit", "ALL", "Toggle the inline Status switch (active/inactive) in Brands."),
    ("brand.manage", "brand", "masters-brands", "manage", "ALL", "Full administrative control over Brands, including View, Add New, Import, Export, Bulk Actions, Status toggle, Action Edit, and Action Delete."),
    ("category.view", "category", "masters-categories", "view", "ALL", "View product categories; use search, filters, and the Active/Inactive tabs."),
    ("category.create", "category", "masters-categories", "create", "ALL", "Show + ADD NEW button and create product categories."),
    ("category.update", "category", "masters-categories", "update", "ALL", "Show Action column Edit button and edit product categories."),
    ("category.delete", "category", "masters-categories", "delete", "ALL", "Show Action column Delete button and Bulk Delete option, and delete product categories."),
    ("category.export", "category", "masters-categories", "export", "ALL", "Show EXPORT option in Imp / Exp menu and export product category data."),
    ("category.import", "category", "masters-categories", "import", "ALL", "Show SAMPLE FILE and IMPORT options in Imp / Exp menu and import product category data."),
    ("category.bulk_action", "category", "masters-categories", "bulk_action", "ALL", "Show selection checkboxes and Bulk Actions menu (Bulk Activate / Bulk Inactive) in the product category list."),
    ("category.status_edit", "category", "masters-categories", "status_edit", "ALL", "Toggle the inline Status switch (active/inactive) in Product Categories."),
    ("category.manage", "category", "masters-categories", "manage", "ALL", "Full administrative control over Product Categories, including View, Add New, Import, Export, Bulk Actions, Status toggle, Action Edit, and Action Delete."),
    ("subcategory.view", "subcategory", "masters-subcategories", "view", "ALL", "View product sub-categories; use search, filters, and the Active/Inactive tabs."),
    ("subcategory.create", "subcategory", "masters-subcategories", "create", "ALL", "Show + ADD NEW button and create product sub-categories."),
    ("subcategory.update", "subcategory", "masters-subcategories", "update", "ALL", "Show Action column Edit button and edit product sub-categories."),
    ("subcategory.delete", "subcategory", "masters-subcategories", "delete", "ALL", "Show Action column Delete button and Bulk Delete option, and delete product sub-categories."),
    ("subcategory.export", "subcategory", "masters-subcategories", "export", "ALL", "Show EXPORT option in Imp / Exp menu and export product sub-category data."),
    ("subcategory.import", "subcategory", "masters-subcategories", "import", "ALL", "Show SAMPLE FILE and IMPORT options in Imp / Exp menu and import product sub-category data."),
    ("subcategory.bulk_action", "subcategory", "masters-subcategories", "bulk_action", "ALL", "Show selection checkboxes and Bulk Actions menu (Bulk Activate / Bulk Inactive) in the product sub-category list."),
    ("subcategory.status_edit", "subcategory", "masters-subcategories", "status_edit", "ALL", "Toggle the inline Status switch (active/inactive) in Product Sub-Categories."),
    ("subcategory.manage", "subcategory", "masters-subcategories", "manage", "ALL", "Full administrative control over Product Sub-Categories, including View, Add New, Import, Export, Bulk Actions, Status toggle, Action Edit, and Action Delete."),
    # Transport Master
    ("transport.view", "transport", "masters-transport", "view", "ALL", "View transport carriers; use search, filters, and status tabs."),
    ("transport.create", "transport", "masters-transport", "create", "ALL", "Create transport entries."),
    ("transport.update", "transport", "masters-transport", "update", "ALL", "Edit and activate/deactivate transports."),
    ("transport.delete", "transport", "masters-transport", "delete", "ALL", "Delete transports."),
    ("transport.export", "transport", "masters-transport", "export", "ALL", "Export transport data."),
    ("transport.import", "transport", "masters-transport", "import", "ALL", "Import transport data."),
    ("transport.bulk_action", "transport", "masters-transport", "manage", "ALL", "Use Bulk Actions in the transport list."),
    # Payment Terms Master
    ("payment_term.view", "payment_term", "masters-payment-terms", "view", "ALL", "View payment terms; use search, filters, and status tabs."),
    ("payment_term.create", "payment_term", "masters-payment-terms", "create", "ALL", "Create payment terms."),
    ("payment_term.update", "payment_term", "masters-payment-terms", "update", "ALL", "Edit and activate/deactivate payment terms."),
    ("payment_term.delete", "payment_term", "masters-payment-terms", "delete", "ALL", "Delete payment terms."),
    ("payment_term.export", "payment_term", "masters-payment-terms", "export", "ALL", "Export payment terms data."),
    ("payment_term.import", "payment_term", "masters-payment-terms", "import", "ALL", "Import payment terms data."),
    ("payment_term.bulk_action", "payment_term", "masters-payment-terms", "manage", "ALL", "Use Bulk Actions in the payment terms list."),
    # Lead Sources Master
    ("lead_source.view", "lead_source", "masters-lead-sources", "view", "ALL", "View lead sources; use search, filters, and status tabs."),
    ("lead_source.create", "lead_source", "masters-lead-sources", "create", "ALL", "Create lead sources."),
    ("lead_source.update", "lead_source", "masters-lead-sources", "update", "ALL", "Edit and activate/deactivate lead sources."),
    ("lead_source.delete", "lead_source", "masters-lead-sources", "delete", "ALL", "Delete lead sources."),
    ("lead_source.export", "lead_source", "masters-lead-sources", "export", "ALL", "Export lead sources data."),
    ("lead_source.import", "lead_source", "masters-lead-sources", "import", "ALL", "Import lead sources data."),
    ("lead_source.bulk_action", "lead_source", "masters-lead-sources", "manage", "ALL", "Use Bulk Actions in the lead sources list."),
    # Adjustment Purposes Master
    ("adjustment_purpose.view", "adjustment_purpose", "masters-adjustment-purpose", "view", "ALL", "View adjustment purposes; use search, filters, and status tabs."),
    ("adjustment_purpose.create", "adjustment_purpose", "masters-adjustment-purpose", "create", "ALL", "Create adjustment purposes."),
    ("adjustment_purpose.update", "adjustment_purpose", "masters-adjustment-purpose", "update", "ALL", "Edit and activate/deactivate adjustment purposes."),
    ("adjustment_purpose.delete", "adjustment_purpose", "masters-adjustment-purpose", "delete", "ALL", "Delete adjustment purposes."),
    ("adjustment_purpose.export", "adjustment_purpose", "masters-adjustment-purpose", "export", "ALL", "Export adjustment purposes data."),
    ("adjustment_purpose.import", "adjustment_purpose", "masters-adjustment-purpose", "import", "ALL", "Import adjustment purposes data."),
    ("adjustment_purpose.bulk_action", "adjustment_purpose", "masters-adjustment-purpose", "manage", "ALL", "Use Bulk Actions in the adjustment purposes list."),
    # Call Types Master
    ("call_type.view", "call_type", "masters-call-types", "view", "ALL", "View call types; use search, filters, and status tabs."),
    ("call_type.create", "call_type", "masters-call-types", "create", "ALL", "Create call types."),
    ("call_type.update", "call_type", "masters-call-types", "update", "ALL", "Edit and activate/deactivate call types."),
    ("call_type.delete", "call_type", "masters-call-types", "delete", "ALL", "Delete call types."),
    ("call_type.export", "call_type", "masters-call-types", "export", "ALL", "Export call types data."),
    ("call_type.import", "call_type", "masters-call-types", "import", "ALL", "Import call types data."),
    ("call_type.bulk_action", "call_type", "masters-call-types", "manage", "ALL", "Use Bulk Actions in the call types list."),
    # Product & Masters Management
    ("product.view", "product", "masters-products", "view", "ALL", "View products (Product Master and Product Gallery); use search, filters, and the Active/Inactive tabs."),
    ("product.create", "product", "masters-products", "create", "ALL", "Show + ADD NEW button and create products."),
    ("product.update", "product", "masters-products", "update", "ALL", "Show Action column Edit button, edit products, activate/deactivate products, and manage machine-spare mappings."),
    ("product.delete", "product", "masters-products", "delete", "ALL", "Delete products (Bulk Actions > Bulk Delete)."),
    ("product.export", "product", "masters-products", "export", "ALL", "Show EXPORT option in Imp / Exp menu and export product records."),
    ("product.import", "product", "masters-products", "import", "ALL", "Show SAMPLE FILE and IMPORT options in Imp / Exp menu and import product records."),
    ("product.bulk_action", "product", "masters-products", "bulk_action", "ALL", "Show selection checkboxes and Bulk Actions menu (Bulk Activate / Bulk Inactive) in the Product Master list."),
    ("product.manage", "product", "masters-products", "manage", "ALL", "Full administrative control over Product Master, including View, Add New, Import, Export, Bulk Actions, Action Edit, and Delete."),
    # Product Gallery (Inventory > Product Gallery; separate page from Product
    # Master above). Deliberately view-only: this page has no create/edit/
    # delete/bulk actions of its own to gate (the two photo-delete buttons it
    # does have are already separately gated on product.update /
    # supplier.update).
    ("productgallery.view", "productgallery", "product-gallery", "view", "ALL", "View the Product & Supplier Gallery."),
    # Product Stock (Inventory > Product Stock)
    ("product_stock.view", "product_stock", "product-stock", "view", "ALL", "View the Product Stock page, warehouse balances, and stock breakup details."),
    ("product_stock.export", "product_stock", "product-stock", "export", "ALL", "Show Export button and export Product Stock data to Excel."),
    ("product_stock.manage", "product_stock", "product-stock", "manage", "ALL", "Full administrative control over Product Stock, including viewing balances, breakup details, and exporting."),
    # Stock Adjustment (Inventory > Stock Adjustment)
    ("stock_adjustment.view", "stock_adjustment", "stock-adjustment", "view", "ALL", "View the Stock Adjustment list and adjustment details."),
    ("stock_adjustment.create", "stock_adjustment", "stock-adjustment", "create", "ALL", "Show + Add New (Stock IN / Stock OUT) and create stock adjustments."),
    ("stock_adjustment.export", "stock_adjustment", "stock-adjustment", "export", "ALL", "Show Export button and export Stock Adjustment records to CSV."),
    ("stock_adjustment.delete", "stock_adjustment", "stock-adjustment", "delete", "ALL", "Show Delete action and delete stock adjustment records."),
    ("stock_adjustment.download", "stock_adjustment", "stock-adjustment", "download", "ALL", "Show Download action and download Stock Adjustment PDF vouchers."),
    ("stock_adjustment.manage", "stock_adjustment", "stock-adjustment", "manage", "ALL", "Full administrative control over Stock Adjustment, including viewing, + Add New (Stock IN/OUT), Export, Delete, and Downloads."),
    # Stock Transfer (Inventory > Stock Transfer)
    ("stock_transfer.view", "stock_transfer", "stock-transfer", "view", "ALL", "View the Stock Transfer list (All tab) and transfer details."),
    ("stock_transfer.create", "stock_transfer", "stock-transfer", "create", "ALL", "Show + ADD NEW and create new stock transfers."),
    ("stock_transfer.export", "stock_transfer", "stock-transfer", "export", "ALL", "Show Export and Export Selected buttons and export Stock Transfer records to CSV."),
    ("stock_transfer.bulk_action", "stock_transfer", "stock-transfer", "bulk_action", "ALL", "Enable row selection checkboxes and the Bulk Actions dropdown on Stock Transfer."),
    ("stock_transfer.cancel", "stock_transfer", "stock-transfer", "cancel", "ALL", "Show Cancel action (row menu & Bulk Cancel) and cancel stock transfers."),
    ("stock_transfer.download", "stock_transfer", "stock-transfer", "download", "ALL", "Show Download action and download Stock Transfer PDF orders."),
    ("stock_transfer.pending.view", "stock_transfer", "stock-transfer", "pending.view", "ALL", "View the Pending status tab on Stock Transfer."),
    ("stock_transfer.confirmed.view", "stock_transfer", "stock-transfer", "confirmed.view", "ALL", "View the Confirmed status tab on Stock Transfer."),
    ("stock_transfer.received.view", "stock_transfer", "stock-transfer", "received.view", "ALL", "View the Received status tab on Stock Transfer."),
    ("stock_transfer.cancel.view", "stock_transfer", "stock-transfer", "cancel.view", "ALL", "View the Cancel status tab on Stock Transfer."),
    ("stock_transfer.pending", "stock_transfer", "stock-transfer", "pending", "ALL", "Transition or mark Stock Transfer stage as Pending."),
    ("stock_transfer.confirmed", "stock_transfer", "stock-transfer", "confirmed", "ALL", "Transition or confirm Stock Transfer stage as Confirmed."),
    ("stock_transfer.received", "stock_transfer", "stock-transfer", "received", "ALL", "Transition or receive Stock Transfer stage into destination physical warehouse (Received)."),
    ("stock_transfer.manage", "stock_transfer", "stock-transfer", "manage", "ALL", "Full administrative control over Stock Transfer, including View, Add New, Export, Bulk Actions, Cancel, Download, and all stages & stage views."),
    # Audit Log
    ("audit.view", "audit", "audit", "view", "ALL", "View audit log entries."),
    # Standalone Task Module
    ("task.view", "task", "tasks", "view", "ALL", "View own assigned and created tasks; access Enterprise Tasks."),
    ("task.create", "task", "tasks", "create", "ALL", "Create new standalone workforce tasks, sprints, templates, and recurring schedules."),
    ("task.department_view", "task", "tasks", "view", "DEPARTMENT", "View all tasks belonging to user's department(s) (read visibility for Department Managers)."),
    ("task.all_view", "task", "tasks", "view", "ALL", "View all tasks across all departments (read-only visibility without task management rights)."),
    ("task.assign", "task", "tasks", "manage", "ALL", "Assign tasks to users within authorized scope."),
    ("task.escalate", "task", "tasks", "action", "ALL", "Manually escalate tasks to managers or candidate users."),
    ("task.manage", "task", "tasks", "manage", "ALL", "Administrative task access: view and manage all tasks across all departments."),
    ("task.delete", "task", "tasks", "delete", "ALL", "Delete tasks and recurring task schedules."),
    # Technical Tasks Module
    ("technicaltask.view", "technicaltask", "technical-tasks", "view", "ALL", "View Technical Tasks module and All tab."),
    ("technicaltask.pending.view", "technicaltask", "technical-tasks", "view", "ALL", "View the Pending status tab in Technical Tasks."),
    ("technicaltask.approved.view", "technicaltask", "technical-tasks", "view", "ALL", "View the Approved status tab in Technical Tasks."),
    ("technicaltask.completed.view", "technicaltask", "technical-tasks", "view", "ALL", "View the Completed status tab in Technical Tasks."),
    ("technicaltask.cancel.view", "technicaltask", "technical-tasks", "view", "ALL", "View the Cancel status tab in Technical Tasks."),
    ("technicaltask.create", "technicaltask", "technical-tasks", "create", "ALL", "Show + ADD NEW button and create new technical tasks."),
    ("technicaltask.bulk_action", "technicaltask", "technical-tasks", "manage", "ALL", "Show Bulk Actions menu (bulk approve, bulk complete, bulk delete) in Technical Tasks."),
    ("technicaltask.action.view", "technicaltask", "technical-tasks", "view", "ALL", "View the Action (3-dots) column in the Technical Tasks table."),
    ("technicaltask.call_logs.view", "technicaltask", "technical-tasks", "view", "ALL", "View Call Logs in Action menu and access the Call & Task Logs detail page."),
    ("technicaltask.approve", "technicaltask", "technical-tasks", "approve", "ALL", "View/use Approved action (Pending stage), allot technicians, and override service/charge details."),
    ("technicaltask.complete", "technicaltask", "technical-tasks", "update", "ALL", "View/use Completed action (Approved stage) and bulk mark completed."),
    ("technicaltask.cancel", "technicaltask", "technical-tasks", "update", "ALL", "View/use Cancel action (Approved stage) in Technical Tasks."),
    ("technicaltask.reopen", "technicaltask", "technical-tasks", "approve", "ALL", "View/use Reopen / Reassign action (Cancel stage) in Technical Tasks."),
    ("technicaltask.update", "technicaltask", "technical-tasks", "update", "ALL", "View/use Edit action in Technical Tasks and add call logs."),
    ("technicaltask.delete", "technicaltask", "technical-tasks", "delete", "ALL", "View/use Delete action in Technical Tasks."),
    ("technicaltask.manage", "technicaltask", "technical-tasks", "manage", "ALL", "Full administrative control over technical tasks, including all tabs, action menu items, editing/deleting approved tasks, and reopening cancelled tasks."),
    # Payments Module (independent of Technical Tasks)
    ("payment.view", "payment", "payments", "view", "ALL", "View Payments dashboard, KPIs, and All tab."),
    ("payment.pending.view", "payment", "payments", "view", "ALL", "View the Pending tab in Payments."),
    ("payment.completed.view", "payment", "payments", "view", "ALL", "View the Completed tab in Payments."),
    ("payment.create", "payment", "payments", "create", "ALL", "Show + ADD NEW button and create new chargeable payment records in Payments."),
    ("payment.delete", "payment", "payments", "delete", "ALL", "Show DELETE button and delete pending payment records in Payments."),
    ("payment.action.view", "payment", "payments", "view", "ALL", "View the Action (3-dots) column in the Payments table."),
    ("payment.details.view", "payment", "payments", "view", "ALL", "View Details in the Action menu and open the Payment Details modal in Payments."),
    ("payment.update", "payment", "payments", "update", "ALL", "View/use Record Payment action (Action menu and Payment Details modal) and upload payment receipts in Payments."),
    ("payment.manage", "payment", "payments", "manage", "ALL", "Full administrative control over Payments, including all tabs, + ADD NEW, Delete, Action column, View Details, and Record Payment."),
    # Technician Gatepass & Wallet Management Module (independent of Technical Tasks and Payments)
    ("technician_operations.view", "technician_operations", "technician-operations", "view", "ALL", "View Technician Gatepass & Wallet Management module, KPIs, and master lookups."),
    ("technician_operations.gatepasses.view", "technician_operations", "technician-operations", "view", "ALL", "View the Spare Parts Gatepass & Returns tab in Technician Operations."),
    ("technician_operations.gatepass.create", "technician_operations", "technician-operations", "create", "ALL", "Show + Issue Outward Gatepass button and create outward spare parts gatepasses."),
    ("technician_operations.gatepass.return", "technician_operations", "technician-operations", "update", "ALL", "View/use Return action button on gatepasses to reconcile returned and consumed parts."),
    ("technician_operations.gatepass.draft_so", "technician_operations", "technician-operations", "view", "ALL", "View/use Draft SO action button on gatepasses to inspect billable consumed items."),
    ("technician_operations.gatepass.create_so", "technician_operations", "technician-operations", "create", "ALL", "View/use Create SO action button to launch a Sales Order for consumed gatepass parts."),
    ("technician_operations.gatepass.link_so", "technician_operations", "technician-operations", "update", "ALL", "View/use Link SO action button to link an existing Sales Order to a gatepass."),
    ("technician_operations.gatepass.print", "technician_operations", "technician-operations", "view", "ALL", "View/use Print action button to print outward/return gatepass slips."),
    ("technician_operations.gatepass.details", "technician_operations", "technician-operations", "view", "ALL", "View/use Details action button to inspect full gatepass details."),
    ("technician_operations.wallets.view", "technician_operations", "technician-operations", "view", "ALL", "View the Technician Wallets & Field Collections tab and transaction ledger."),
    ("technician_operations.wallet.create", "technician_operations", "technician-operations", "create", "ALL", "Show Record Wallet Transaction header button and record any wallet transaction type."),
    ("technician_operations.wallet.balances.view", "technician_operations", "technician-operations", "view", "ALL", "View Technician Live Wallet Balances (Cash in Hand) cards section."),
    ("technician_operations.wallet.collect", "technician_operations", "technician-operations", "create", "ALL", "View/use + Collect action button on technician wallet cards to record field collections."),
    ("technician_operations.wallet.handover", "technician_operations", "technician-operations", "create", "ALL", "View/use Handover action button on technician wallet cards to record deposits to accounts."),
    ("technician_operations.wallet.expense", "technician_operations", "technician-operations", "create", "ALL", "View/use Expense action button on technician wallet cards to record field expenses."),
    ("technician_operations.warranty.view", "technician_operations", "technician-operations", "view", "ALL", "View the Machine Warranty Registry & Validator tab and warranty registry table."),
    ("technician_operations.warranty.create", "technician_operations", "technician-operations", "create", "ALL", "Show Register Machine Warranty button and create machine warranty policies."),
    ("technician_operations.warranty.validate", "technician_operations", "technician-operations", "view", "ALL", "View/use Live Machine Serial Warranty Validator widget and Verify Serial lookup."),
    ("technician_operations.update", "technician_operations", "technician-operations", "update", "ALL", "Legacy gatepass update permission (record spare parts returns and link Sales Orders)."),
    ("technician_operations.manage", "technician_operations", "technician-operations", "manage", "ALL", "Full administrative control over Technician Gatepass, Wallet & Warranty Management, including all tabs, actions, wallet cards, and warranty validator."),
    # Proforma Invoices (Sale > Proforma)
    ("proforma.view", "proforma", "proforma-invoice", "view", "ALL", "View Proforma Invoices module, All summary card, and All tab."),
    ("proforma.pending.view", "proforma", "proforma-invoice", "pending.view", "ALL", "View the Pending summary card and Pending status tab in Proforma Invoices."),
    ("proforma.admin_approved.view", "proforma", "proforma-invoice", "admin_approved.view", "ALL", "View the Admin Approved summary card and Admin Approved status tab in Proforma Invoices."),
    ("proforma.confirmed.view", "proforma", "proforma-invoice", "confirmed.view", "ALL", "View the Confirmed summary card and Confirmed status tab in Proforma Invoices."),
    ("proforma.cancelled.view", "proforma", "proforma-invoice", "cancelled.view", "ALL", "View the Cancelled summary card and Cancelled status tab in Proforma Invoices."),
    ("proforma.create", "proforma", "proforma-invoice", "create", "ALL", "Show + ADD NEW button and create proforma invoices."),
    ("proforma.action.view", "proforma", "proforma-invoice", "action.view", "ALL", "View the Action (3-dots) column in the Proforma Invoices table."),
    ("proforma.download", "proforma", "proforma-invoice", "download", "ALL", "Show Download / View PDF action, Proforma No. PDF link, and PDF viewer page."),
    ("proforma.details.view", "proforma", "proforma-invoice", "details.view", "ALL", "Show View Details in the Action menu and open the Proforma Detail drawer."),
    ("proforma.update", "proforma", "proforma-invoice", "update", "ALL", "Show Edit in the Action menu and edit proforma invoices (within permitted stages)."),
    ("proforma.approve", "proforma", "proforma-invoice", "approve", "ALL", "Approve proforma invoices (Pending -> Admin Approved stage) and allow admin-stage edits when paired with Edit."),
    ("proforma.confirm", "proforma", "proforma-invoice", "confirm", "ALL", "Confirm proforma invoices and auto-create Sales Order (Admin Approved -> Confirmed stage)."),
    ("proforma.cancel", "proforma", "proforma-invoice", "cancel", "ALL", "Cancel proforma invoices (Pending / Admin Approved -> Cancelled stage)."),
    ("proforma.delete", "proforma", "proforma-invoice", "delete", "ALL", "Show Delete in the Action menu and delete proforma invoices at deletable stages."),
    ("proforma.manage", "proforma", "proforma-invoice", "manage", "ALL", "Full administrative control over Proforma Invoices, including View, all stage views, + Add New, Action column, PDF Download, View Details, Edit, Approve, Confirm, Cancel, and Delete."),
    # Local Purchase (Purchase > Local Purchase)
    ("localpurchase.view", "localpurchase", "purchase-local", "view", "ALL", "View Local Purchase module, orders table, and order details modal."),
    ("localpurchase.create", "localpurchase", "purchase-local", "create", "ALL", "Show + ADD NEW button and create new local purchase orders."),
    ("localpurchase.import", "localpurchase", "purchase-local", "import", "ALL", "Show Sample File and Import options in Imp / Exp menu and import local purchases from CSV/Excel."),
    ("localpurchase.export", "localpurchase", "purchase-local", "export", "ALL", "Show Export option in Imp / Exp menu and export local purchases to CSV."),
    ("localpurchase.bulk_action", "localpurchase", "purchase-local", "bulk_action", "ALL", "Show row selection checkboxes and Bulk Actions dropdown on Local Purchase."),
    ("localpurchase.download", "localpurchase", "purchase-local", "download", "ALL", "Show Download Purchase in Action menu, clickable Bill File links, and Local Purchase PDF/bill viewer."),
    ("localpurchase.update", "localpurchase", "purchase-local", "update", "ALL", "Show Edit in Action menu (pending stage) and update pending local purchases and bill attachments."),
    ("localpurchase.confirm", "localpurchase", "purchase-local", "confirm", "ALL", "Show Confirm in Action menu / Bulk Actions and confirm local purchases (adds physical warehouse stock)."),
    ("localpurchase.delete", "localpurchase", "purchase-local", "delete", "ALL", "Show Delete in Action menu (pending stage) / Bulk Actions and delete pending local purchases."),
    ("localpurchase.manage", "localpurchase", "purchase-local", "manage", "ALL", "Full administrative control over Local Purchase, including View, Add New, Import + Sample, Export, Bulk Actions, Download Purchase, Edit, Confirm, and Delete."),
    ("saleorder.view", "saleorder", "sales-process", "view", "ALL", "View Sales Process module, All / Admin Confirmed To LR KPI cards, All tab, and Sales Orders."),
    ("saleorder.pending.view", "saleorder", "sales-process", "pending.view", "ALL", "View the Pending summary card and Pending status tab in Sales Process."),
    ("saleorder.sales_confirmed.view", "saleorder", "sales-process", "sales_confirmed.view", "ALL", "View the Sales Confirmed status tab and orders in Sales Process."),
    ("saleorder.admin_approved.view", "saleorder", "sales-process", "admin_approved.view", "ALL", "View the Admin Approved summary card and Admin Approved status tab in Sales Process."),
    ("saleorder.acc_confirmed.view", "saleorder", "sales-process", "acc_confirmed.view", "ALL", "View the Acc. Confirmed status tab and orders in Sales Process."),
    ("saleorder.gatepass_created.view", "saleorder", "sales-process", "gatepass_created.view", "ALL", "View the Gatepass Created status tab and orders in Sales Process."),
    ("saleorder.dispatched.view", "saleorder", "sales-process", "dispatched.view", "ALL", "View the Dispatched status tab and orders in Sales Process."),
    ("saleorder.gatepass_cancelled.view", "saleorder", "sales-process", "gatepass_cancelled.view", "ALL", "View the Gatepass Cancelled status tab and orders in Sales Process."),
    ("saleorder.lr.view", "saleorder", "sales-process", "lr.view", "ALL", "View the LR summary card and LR status tab in Sales Process."),
    ("saleorder.cancelled.view", "saleorder", "sales-process", "cancelled.view", "ALL", "View the Cancelled summary card and Cancelled status tab in Sales Process."),
    ("saleorder.create", "saleorder", "sales-process", "create", "ALL", "Show + ADD NEW button and create sales orders."),
    ("saleorder.export", "saleorder", "sales-process", "export", "ALL", "Show Export button and export sales orders spreadsheet."),
    ("saleorder.details.view", "saleorder", "sales-process", "details.view", "ALL", "Open Sales Details modal by clicking Order No. and view order details/timeline."),
    ("saleorder.action.view", "saleorder", "sales-process", "action.view", "ALL", "View the Action (3-dots) column in the Sales Process table."),
    ("saleorder.update", "saleorder", "sales-process", "update", "ALL", "Show Edit in the Action menu and edit sales order details (within editable stages)."),
    ("saleorder.duplicate", "saleorder", "sales-process", "duplicate", "ALL", "Show Duplicate in the Action menu (LR stage) and duplicate sales orders."),
    ("saleorder.download", "saleorder", "sales-process", "download", "ALL", "Show Download Gatepass in the Action menu, clickable Gatepass links, and Gatepass/Order PDF viewers."),
    ("saleorder.files", "saleorder", "sales-process", "files", "ALL", "Show SO Files in the Action menu and upload or manage order PO, Tally, E-Way, and LR documents."),
    ("saleorder.confirm", "saleorder", "sales-process", "confirm", "ALL", "Move Pending sales orders to Sales Confirmed stage."),
    ("saleorder.approve", "saleorder", "sales-process", "approve", "ALL", "Move Sales Confirmed orders to Admin Approved stage."),
    ("saleorder.accounts", "saleorder", "sales-process", "accounts", "ALL", "Confirm Admin Approved orders at Acc. Confirmed (Accounts) stage."),
    ("saleorder.warehouse", "saleorder", "sales-process", "warehouse", "ALL", "Manage Gatepass Created, Dispatched, Gatepass Cancelled, and LR warehouse stages."),
    ("saleorder.cancel", "saleorder", "sales-process", "cancel", "ALL", "Cancel sales orders (Action menu Cancel or Status Drawer Cancelled stage)."),
    ("saleorder.delete", "saleorder", "sales-process", "delete", "ALL", "Show Delete in the Action menu and delete sales orders (stage rules apply)."),
    ("saleorder.manage", "saleorder", "sales-process", "manage", "ALL", "Full administrative control over Sales Process & Orders, including View, all 9 stage views, + Add New, Export, Details, Action column, Edit, Duplicate, Download, SO Files, stage transitions, Cancel, Delete, and Restore."),
    # Discount Payments (Sale > Discount Payments — isolated from saleorder.*)
    ("discount_payment.view", "discount_payment", "discount-payments", "view", "ALL", "View Discount Payments module, KPI cards, All tab, and discount payment records."),
    ("discount_payment.pending.view", "discount_payment", "discount-payments", "pending.view", "ALL", "View the Pending tab and pending discount payment records."),
    ("discount_payment.completed.view", "discount_payment", "discount-payments", "completed.view", "ALL", "View the Completed tab and settled discount payment records."),
    ("discount_payment.adjust", "discount_payment", "discount-payments", "adjust", "ALL", "Show Action column & Adjust Discount to record partial/full discount settlements."),
    ("discount_payment.payments.view", "discount_payment", "discount-payments", "payments.view", "ALL", "Show Action column & List Payments to inspect installment settlement history."),
    ("discount_payment.manage", "discount_payment", "discount-payments", "manage", "ALL", "Full administrative control over Discount Payments, including View, Pending/Completed tabs, Adjust Discount, and List Payments."),
    # CRM & Lead Management
    ("crm.pipelines.view", "crm", "crm-pipelines", "view", "ALL", "View CRM pipelines and stage configuration."),
    ("crm.pipelines.manage", "crm", "crm-pipelines", "manage", "ALL", "Create, update, reorder and manage CRM pipelines and stages."),
    ("crm.distribution.view", "crm", "crm-distribution", "view", "ALL", "View CRM salesperson distribution and territory assignments."),
    ("crm.distribution.manage", "crm", "crm-distribution", "manage", "ALL", "Configure salesperson lead assignment eligibility, territories, and priorities."),
    ("crm.leads.import", "crm", "crm-leads", "import", "ALL", "Import CRM leads via CSV files."),
    ("crm.leads.view", "crm", "crm-leads", "view", "ALL", "View CRM leads and import batches."),
    ("crm.leads.manage", "crm", "crm-leads", "manage", "ALL", "Full administrative control over CRM leads."),
    # Feed & Broadcast Messaging
    ("feed.view", "feed", "feed", "view", "ALL", "View accessible announcements and broadcast messages."),
    ("feed.interact", "feed", "feed", "interact", "ALL", "React to and comment on visible feed announcements and reply in own direct message conversations."),
    ("feed.create", "feed", "feed", "create", "ALL", "Create and publish feed announcements to all or selected employees."),
    ("feed.manage", "feed", "feed", "manage", "ALL", "Full administrative management of all feed announcements, drafts, and recipients."),
    # Banks Master
    ("bank.view", "bank", "masters-banks", "view", "ALL", "View banks; use search, filters, and status tabs."),
    ("bank.create", "bank", "masters-banks", "create", "ALL", "Create bank accounts."),
    ("bank.update", "bank", "masters-banks", "update", "ALL", "Edit and activate/deactivate banks."),
    ("bank.delete", "bank", "masters-banks", "delete", "ALL", "Delete banks."),
    ("bank.export", "bank", "masters-banks", "export", "ALL", "Export bank data."),
    ("bank.import", "bank", "masters-banks", "import", "ALL", "Import bank data."),
    ("bank.bulk_action", "bank", "masters-banks", "manage", "ALL", "Use Bulk Actions in the bank list."),
    # Billing Companies Master
    ("billingcompany.view", "billingcompany", "masters-billing-company", "view", "ALL", "View billing companies; use search, filters, and status tabs."),
    ("billingcompany.create", "billingcompany", "masters-billing-company", "create", "ALL", "Create billing companies."),
    ("billingcompany.update", "billingcompany", "masters-billing-company", "update", "ALL", "Edit and activate/deactivate billing companies."),
    ("billingcompany.delete", "billingcompany", "masters-billing-company", "delete", "ALL", "Delete billing companies."),
    ("billingcompany.export", "billingcompany", "masters-billing-company", "export", "ALL", "Export billing company data."),
    ("billingcompany.import", "billingcompany", "masters-billing-company", "import", "ALL", "Import billing company data."),
    ("billingcompany.bulk_action", "billingcompany", "masters-billing-company", "manage", "ALL", "Use Bulk Actions in the billing company list."),
    # Reports & Cargo Overview
    ("report.view", "report", "reports", "view", "ALL", "View Reports & Analytics modules (Re-Order, Stock Transactions, Deleted Orders, General Reports, Financial Planning Report, Cargo Overview)."),
    ("cargo_overview.view", "cargo_overview", "reports-cargo-overview", "view", "ALL", "View the Cargo Overview list, warehouse/stage tabs, and consignment header summary."),
    ("cargo_overview.finance.view", "cargo_overview", "reports-cargo-overview", "view", "ALL", "View Section 1: Finance Planning inside Cargo Overview."),
    ("cargo_overview.gallery.view", "cargo_overview", "reports-cargo-overview", "view", "ALL", "View Section 2: Consignment Gallery (22 document slots) and download uploaded documents."),
    ("cargo_overview.gallery.upload", "cargo_overview", "reports-cargo-overview", "create", "ALL", "Upload documents to Consignment Gallery slots inside Cargo Overview."),
    ("cargo_overview.gallery.delete", "cargo_overview", "reports-cargo-overview", "delete", "ALL", "Delete manually uploaded documents from Consignment Gallery slots."),
    ("cargo_overview.cargo_status.view", "cargo_overview", "reports-cargo-overview", "view", "ALL", "View Section 3: Cargo Status — Shipment Checklist Details and cargo remarks."),
    ("cargo_overview.cargo_status.edit", "cargo_overview", "reports-cargo-overview", "update", "ALL", "Toggle Cargo Status checklist items (Yes/No) and edit ETD, ETA, Expected Arrival, Forwarder, Clearing Agent, and Cargo Remarks."),
    ("cargo_overview.product_summary.view", "cargo_overview", "reports-cargo-overview", "view", "ALL", "View Section 4: Product Summary inside Cargo Overview."),
]

SUPER_ADMIN_ROLE_NAME = "super_admin"
SUPER_ADMIN_DISPLAY_NAME = "Admin"
USER_ROLE_NAME = "user"
TECHNICIAN_ROLE_NAME = "technician"

# The default role automatically assigned to every newly-created account
# (see app.users.service.UserService.create_user). Grants read-only/basic
# access to the modules any logged-in employee needs day to day; anything
# more privileged is granted explicitly by an administrator via the Roles &
# Permissions screen.
USER_ROLE_PERMISSION_CODES: list[str] = [
    "user.view",
    "position.view",
    "reporting.view",
    "country.view",
    "state.view",
    "district.view",
    "city.view",
    "currency.view",
    "uom.view",
    "tax.view",
    "brand.view",
    "category.view",
    "subcategory.view",
    "transport.view",
    "payment_term.view",
    "lead_source.view",
    "adjustment_purpose.view",
    "call_type.view",
    "product.view",
    "productgallery.view",
    "supplier.view",
    "company.view",
    "buyer.view",
    "task.view",
    "task.assign",
    "task.escalate",
    "feed.view",
    "feed.interact",
]


async def seed() -> None:
    """Run the idempotent bootstrap seed."""
    configure_logging()
    session_factory = get_sessionmaker()

    try:
        async with session_factory() as session:
            permission_repo = PermissionRepository(session)
            role_repo = RoleRepository(session)
            user_repo = UserRepository(session)

            # --- 1. Permissions (bulk-loaded in 1 query to avoid 300+ network round-trips) ---
            existing_perms = (await session.scalars(select(Permission))).all()
            perms_by_code: dict[str, Permission] = {p.code: p for p in existing_perms}
            created_permissions: list[Permission] = []
            seen_codes: set[str] = set()
            dirty_perms = False
            for code, module, page, action, scope, description in BOOTSTRAP_PERMISSIONS:
                existing = perms_by_code.get(code)
                if existing is not None:
                    if existing.page != page or existing.action != action or existing.scope != scope:
                        existing.page = page
                        existing.action = action
                        existing.scope = scope
                        dirty_perms = True
                    if code not in seen_codes:
                        created_permissions.append(existing)
                        seen_codes.add(code)
                    continue
                permission = await permission_repo.create(
                    code=code,
                    module=module,
                    page=page,
                    action=action,
                    scope=scope,
                    description=description,
                )
                perms_by_code[code] = permission
                created_permissions.append(permission)
                seen_codes.add(code)
                logger.info("Seeded permission.", extra={"code": code})
            if dirty_perms:
                await session.flush()

            # --- 2. System roles -----------------------------------------------------------
            # Exactly two system roles are seeded: "super_admin" (shown to users as
            # "Admin" -- reserved for the single bootstrap admin account) and
            # "user" (the default role every other new account gets). Both are
            # marked is_system=True so they can't be deleted or renamed from the
            # Roles & Permissions screen.
            role = await role_repo.get_by_name(SUPER_ADMIN_ROLE_NAME, include_deleted=True)
            if role is None:
                role = await role_repo.create(
                    name=SUPER_ADMIN_ROLE_NAME,
                    description=(
                        "Full-access system administrator role, reserved for the single "
                        "hardcoded bootstrap admin account. Cannot be deleted, renamed, "
                        "or assigned to any other user."
                    ),
                    is_system=True,
                )
                logger.info("Seeded role.", extra={"role_name": SUPER_ADMIN_ROLE_NAME})
                for permission in created_permissions:
                    session.add(RolePermission(role_id=role.id, permission_id=permission.id))
                await session.flush()
            else:
                # (a soft-deleted role is NOT un-deleted here -- the database is the truth)
                # Idempotent top-up: make sure any newly-added bootstrap permission
                # (e.g. organization.manage) is granted even if this role already existed.
                existing_codes = {link.permission.code for link in role.permission_links}
                for permission in created_permissions:
                    if permission.code not in existing_codes:
                        await role_repo.add_permission(role, permission)

            user_role = await role_repo.get_by_name(USER_ROLE_NAME, include_deleted=True)
            if user_role is None:
                user_role = await role_repo.create(
                    name=USER_ROLE_NAME,
                    description=(
                        "Default role automatically assigned to every new user account. "
                        "Grants basic read access; additional permissions are granted "
                        "explicitly by an administrator."
                    ),
                    is_system=True,
                )
                logger.info("Seeded role.", extra={"role_name": USER_ROLE_NAME})
                for code in dict.fromkeys(USER_ROLE_PERMISSION_CODES):
                    permission = perms_by_code.get(code) or await permission_repo.get_by_code(code)
                    if permission:
                        session.add(RolePermission(role_id=user_role.id, permission_id=permission.id))
                await session.flush()
            else:
                # Idempotent top-up: if the default `user` role grants `feed.view`,
                # ensure `feed.interact` is also granted so employees can react, comment,
                # and reply in their own 1:1 DMs without granting `feed.create`.
                existing_user_codes = {link.permission.code for link in user_role.permission_links}
                if "feed.view" in existing_user_codes and "feed.interact" not in existing_user_codes:
                    interact_perm = perms_by_code.get("feed.interact") or await permission_repo.get_by_code(
                        "feed.interact"
                    )
                    if interact_perm:
                        await role_repo.add_permission(user_role, interact_perm)
                        logger.info("Granted feed.interact to default user role.")

            technician_role = await role_repo.get_by_name(TECHNICIAN_ROLE_NAME, include_deleted=True)
            if technician_role is None:
                technician_role = await role_repo.create(
                    name=TECHNICIAN_ROLE_NAME,
                    description=(
                        "Fixed system department for field service technicians. "
                        "Users assigned to this department appear in Technical Tasks, "
                        "Technician Gatepasses, and Technician Wallets."
                    ),
                    is_system=True,
                )
                logger.info("Seeded role.", extra={"role_name": TECHNICIAN_ROLE_NAME})
            elif not technician_role.is_system:
                technician_role.is_system = True
                await session.flush()

            # Idempotent top-up for Sales Manager role: ensure crm.distribution.view and crm.leads.import are granted
            sales_mgr_role = await role_repo.get_by_name("Sales Manager", include_deleted=False)
            if sales_mgr_role is not None:
                for top_up_code in ("crm.distribution.view", "crm.leads.import"):
                    perm = perms_by_code.get(top_up_code) or await permission_repo.get_by_code(top_up_code)
                    if perm:
                        existing_grant_stmt = select(RolePermission).where(
                            RolePermission.role_id == sales_mgr_role.id,
                            RolePermission.permission_id == perm.id,
                        )
                        if (await session.execute(existing_grant_stmt)).scalar_one_or_none() is None:
                            session.add(RolePermission(role_id=sales_mgr_role.id, permission_id=perm.id))
                            logger.info("Granted %s to Sales Manager role.", top_up_code)
                await session.flush()

            # --- 3. Bootstrap admin user ----------------------------------------------------
            from app.rbac.models import UserRole, RoleAssignmentType, RoleAssignmentStatus

            admin = await user_repo.get_by_username(settings.BOOTSTRAP_ADMIN_USERNAME)
            if admin is None:
                admin = await user_repo.get_by_email(settings.BOOTSTRAP_ADMIN_EMAIL)

            # FIRST-INSTALL GUARD (runs on every start/deploy): create bootstrap data only on a fresh database.  Whatever is in
            # the database afterwards is the truth -- never reset a password, un-delete, or re-create what was deleted.
            # One-off recovery: start once with BOOTSTRAP_FORCE_RESET=true.
            from sqlalchemy import func as _func
            from app.users.models import User as _UserRow

            _any_user = (await session.scalar(select(_func.count()).select_from(_UserRow))) or 0
            _force = os.environ.get("BOOTSTRAP_FORCE_RESET", "").strip().lower() in {"1", "true", "yes"}

            if admin is None and _any_user and not _force:
                logger.info("Users already exist; the bootstrap admin was not re-created (it may have been deleted on purpose).")
            elif admin is None:
                admin = await user_repo.create(
                    username=settings.BOOTSTRAP_ADMIN_USERNAME,
                    email=settings.BOOTSTRAP_ADMIN_EMAIL,
                    password_hash=hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD),
                    status=UserStatus.ACTIVE,
                    is_active=True,
                    must_change_password=False,
                    password_changed_at=datetime.now(timezone.utc),
                )
                session.add(
                    UserRole(
                        user_id=admin.id,
                        role_id=role.id,
                        assignment_type=RoleAssignmentType.PRIMARY,
                        is_primary=True,
                        status=RoleAssignmentStatus.ACTIVE,
                        assigned_at=datetime.now(timezone.utc),
                    )
                )
                await session.flush()
                logger.info("Seeded bootstrap admin user.", extra={"username": settings.BOOTSTRAP_ADMIN_USERNAME})
            elif _force:
                admin.email = settings.BOOTSTRAP_ADMIN_EMAIL
                admin.password_hash = hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD)
                admin.status = UserStatus.ACTIVE
                admin.is_active = True
                admin.must_change_password = False
                admin.failed_login_count = 0
                admin.locked_until = None
                if hasattr(admin, "deleted_at") and admin.deleted_at is not None:
                    admin.deleted_at = None

                ur_stmt = select(UserRole).where(UserRole.user_id == admin.id, UserRole.role_id == role.id)
                existing_ur = (await session.execute(ur_stmt)).scalars().first()
                if existing_ur is None:
                    session.add(
                        UserRole(
                            user_id=admin.id,
                            role_id=role.id,
                            assignment_type=RoleAssignmentType.PRIMARY,
                            is_primary=True,
                            status=RoleAssignmentStatus.ACTIVE,
                            assigned_at=datetime.now(timezone.utc),
                        )
                    )
                else:
                    existing_ur.status = RoleAssignmentStatus.ACTIVE
                    existing_ur.assignment_type = RoleAssignmentType.PRIMARY
                    existing_ur.is_primary = True
                await session.flush()
                logger.info("Updated bootstrap admin user to match standard credentials.", extra={"username": settings.BOOTSTRAP_ADMIN_USERNAME})
            else:
                logger.info("Bootstrap admin already exists; left completely untouched.")

            # Seed China provinces and major cities (fresh database only)
            from scripts import seed_china_geo as _geo

            _country_rows = (await session.scalar(select(_func.count()).select_from(_geo.Country))) or 0
            if _country_rows == 0 or _force:
                await _geo.seed_china(session)
            else:
                logger.info("Country master data already present; geography seed skipped.")

            await session.commit()
    finally:
        await dispose_engine()

    print(
        "Seed complete.\n"
        f"  Admin username: {settings.BOOTSTRAP_ADMIN_USERNAME}\n"
        f"  Admin email: {settings.BOOTSTRAP_ADMIN_EMAIL}\n"
        "  Admin password: (BOOTSTRAP_ADMIN_PASSWORD from the environment; applied on first install only)\n",
        flush=True,
    )


async def _run_seed_with_retry(max_retries: int = 5, delay: float = 2.0) -> None:
    last_exc = None
    for attempt in range(1, max_retries + 1):
        try:
            await seed()
            return
        except Exception as exc:
            last_exc = exc
            if attempt < max_retries:
                logger.warning(
                    f"Seed connection attempt {attempt}/{max_retries} failed: {exc}. Retrying in {delay:.1f}s..."
                )
                await asyncio.sleep(delay)
                delay *= 1.5
            else:
                raise last_exc


if __name__ == "__main__":
    asyncio.run(_run_seed_with_retry())
