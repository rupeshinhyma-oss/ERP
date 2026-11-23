/**
 * Shared permission display helpers.
 *
 * Used by both the Roles & Permissions page (role editor, user-override
 * checkbox grid) and the Users page (per-user permission overrides modal
 * opened from the row action menu) so a permission code renders identically
 * -- same friendly label, same module grouping -- no matter which page you
 * manage it from.
 */

import type { Permission } from "@/types";

/** Friendly category names for permission modules. */
export const MODULE_NAMES: Record<string, string> = {
  dashboard: "Dashboard",
  organizationlist: "Organization List",
  buyer: "Agents & Buyers",
  buyertype: "Buyer Types",
  company: "Companies",
  supplier: "Suppliers",
  suppliertype: "Supplier Types",
  product: "Products Master",
  productgallery: "Product Gallery",
  product_stock: "Product Stock",
  stock_adjustment: "Stock Adjustment",
  stock_transfer: "Stock Transfer",
  category: "Categories",
  subcategory: "Sub-Categories",
  brand: "Brands",
  hsn: "HSN Codes",
  uom: "Units of Measurement (UOM)",
  currency: "Currencies",
  country: "Countries",
  state: "States & Provinces",
  city: "Cities",
  user: "Users & Accounts",
  organization: "Organizations",
  audit: "System Audit Logs",
  trash: "Trash",
  roles_permissions: "Departments & Permissions",
  hrms: "HRMS & Workforce",
  task: "Tasks & Work Management",
  technicaltask: "Technical Tasks",
  payment: "Payments",
  technician_operations: "Technician Gatepass & Wallet Management",
  report: "Reports & Analytics",
  cargo_overview: "Cargo Overview",
};

const ACTION_LABELS: Record<string, string> = {
  read: "View",
  view: "View",
  create: "Create",
  update: "Edit",
  delete: "Delete",
  export: "Export",
  import: "Import",
  approve: "Approve",
  manage: "Manage All",
  action: "Actions",
  bulk_action: "Bulk Actions",
  grade_edit: "Edit Grade",
  potential_edit: "Edit Potential",
  currentstatus: "Current Status",
  potential: "Potential",
  clientgrade: "Client Grade",
};

/**
 * A few permission codes have three dot-segments (e.g. "planning.textyn.edit")
 * where the generic last-segment splitter in friendlyPermissionLabel would
 * collapse them all down to the same unhelpful "Edit" label. These are
 * special-cased by their exact, full code instead.
 */
const FULL_CODE_LABELS: Record<string, string> = {
  "buyer.currentstatus": "Current Status",
  "buyer.potential": "Potential",
  "buyer.clientgrade": "Client Grade",
  "task.view": "View Tasks",
  "task.create": "Create Tasks",
  "task.department_view": "Department Tasks View",
  "task.all_view": "All Tasks View (Read-Only)",
  "task.assign": "Assign Tasks",
  "task.escalate": "Escalate Tasks",
  "task.manage": "Manage All Tasks",
  "task.delete": "Delete Tasks",
  "hrms.location_assignments.manage": "Manage Location Assignments",
  "cargo_overview.view": "View Cargo Overview List & Header",
  "cargo_overview.finance.view": "View Section 1: Finance Planning",
  "cargo_overview.gallery.view": "View Section 2: Consignment Gallery",
  "cargo_overview.gallery.upload": "Upload Documents (Consignment Gallery)",
  "cargo_overview.gallery.delete": "Delete Documents (Consignment Gallery)",
  "cargo_overview.cargo_status.view": "View Section 3: Cargo Status Checklist",
  "cargo_overview.cargo_status.edit": "Edit Cargo Status, ETD/ETA & Remarks",
  "cargo_overview.product_summary.view": "View Section 4: Product Summary",
  "technicaltask.view": "View",
  "technicaltask.pending.view": "View Pending Tab",
  "technicaltask.approved.view": "View Approved Tab",
  "technicaltask.completed.view": "View Completed Tab",
  "technicaltask.cancel.view": "View Cancel Tab",
  "technicaltask.create": "+ Add New (Create)",
  "technicaltask.bulk_action": "Bulk Actions",
  "technicaltask.action.view": "View Action Column (⋮)",
  "technicaltask.call_logs.view": "Action: View Call Logs",
  "technicaltask.approve": "Action: Approved (Pending Stage)",
  "technicaltask.complete": "Action: Completed (Approved Stage)",
  "technicaltask.cancel": "Action: Cancel (Approved Stage)",
  "technicaltask.reopen": "Action: Reopen / Reassign (Cancel Stage)",
  "technicaltask.update": "Action: Edit",
  "technicaltask.delete": "Action: Delete",
  "technicaltask.manage": "Manage All",
  "payment.view": "View",
  "payment.pending.view": "View Pending Tab",
  "payment.completed.view": "View Completed Tab",
  "payment.create": "+ Add New (Create)",
  "payment.delete": "Delete",
  "payment.action.view": "View Action Column (⋮)",
  "payment.details.view": "Action: View Details",
  "payment.update": "Action: Record Payment",
  "payment.manage": "Manage All",
  "technician_operations.gatepasses.view": "View Tab: Gatepasses & Returns",
  "technician_operations.gatepass.create": "+ Issue Outward Gatepass",
  "technician_operations.gatepass.return": "Action: Return Parts",
  "technician_operations.gatepass.draft_so": "Action: Draft SO",
  "technician_operations.gatepass.create_so": "Action: Create SO",
  "technician_operations.gatepass.link_so": "Action: Link SO",
  "technician_operations.gatepass.print": "Action: Print Slip",
  "technician_operations.gatepass.details": "Action: View Details",
  "technician_operations.wallets.view": "View Tab: Wallets & Collections",
  "technician_operations.wallet.create": "Record Wallet Transaction",
  "technician_operations.wallet.balances.view": "Wallet: View Live Balances",
  "technician_operations.wallet.collect": "Wallet Card: + Collect",
  "technician_operations.wallet.handover": "Wallet Card: Handover",
  "technician_operations.wallet.expense": "Wallet Card: Expense",
  "technician_operations.warranty.view": "View Tab: Machine Warranty & Validator",
  "technician_operations.warranty.create": "Register Machine Warranty",
  "technician_operations.warranty.validate": "Warranty: Verify Serial Validator",
  "company.view": "View",
  "company.quick_add": "+ Quick Add",
  "company.create": "+ Add New (Create)",
  "company.update": "Action: Edit",
  "company.delete": "Delete (Bulk)",
  "company.export": "Export",
  "company.import": "Import (Sample + Import)",
  "company.bulk_action": "Bulk Actions",
  "company.grade_edit": "Grade Edit",
  "company.potential_edit": "Potential Edit",
  "company.manage": "Manage All",
  "product_stock.view": "View",
  "product_stock.export": "Export",
  "product_stock.manage": "Manage All",
  "stock_adjustment.view": "View",
  "stock_adjustment.create": "Add New (Stock In, Stock Out)",
  "stock_adjustment.export": "Export",
  "stock_adjustment.delete": "Delete",
  "stock_adjustment.download": "Downloads",
  "stock_adjustment.manage": "Manage All",
  // Stock Transfer
  "stock_transfer.view": "View",
  "stock_transfer.create": "+ Add New",
  "stock_transfer.export": "Export",
  "stock_transfer.bulk_action": "Bulk Actions",
  "stock_transfer.cancel": "Action: Cancel",
  "stock_transfer.download": "Action: Download",
  "stock_transfer.pending.view": "View Pending Stage",
  "stock_transfer.confirmed.view": "View Confirmed Stage",
  "stock_transfer.received.view": "View Received Stage",
  "stock_transfer.cancel.view": "View Cancel Stage",
  "stock_transfer.pending": "Stage: Pending",
  "stock_transfer.confirmed": "Stage: Confirmed",
  "stock_transfer.received": "Stage: Received",
  "stock_transfer.manage": "Manage All",
};

/** "product.create" -> "Create"; unknown actions fall back to the raw code. */
export function friendlyPermissionLabel(code: string): string {
  if (FULL_CODE_LABELS[code]) return FULL_CODE_LABELS[code];
  const parts = code.split(".");
  const action = parts[parts.length - 1];
  return ACTION_LABELS[action] || parts.slice(1).join(" ") || code;
}

/**
 * Obsolete permission codes kept out of permission catalogs, UI override panels,
 * and group selectors without destructively deleting legacy DB rows.
 */
export const DEPRECATED_PERMISSION_CODES = new Set<string>([
  "task.organization_view",
  "technician_operations.create",
  "planning.view",
  "planning.sheet.manage",
  "planning.column.manage",
  "planning.row.manage",
  "planning.cell.edit",
  "planning.textyn.edit",
  "planning.approvaldate.edit",
  "planning.colorstatusred.edit",
  "planning.colorstatusgreen.edit",
]);

export function filterActivePermissions(permissions: Permission[]): Permission[] {
  return permissions.filter((p) => !DEPRECATED_PERMISSION_CODES.has(p.code));
}

export function groupPermissionsByModule(permissions: Permission[]): Record<string, Permission[]> {
  const groups: Record<string, Permission[]> = {};
  for (const p of permissions) {
    if (DEPRECATED_PERMISSION_CODES.has(p.code)) continue;
    const modKey = p.module || p.code.split(".")[0];
    if (!groups[modKey]) groups[modKey] = [];
    groups[modKey].push(p);
  }
  return groups;
}

/**
 * Role names that are reserved by the system -- mirrors
 * `app.rbac.service.RESERVED_ROLE_NAMES` on the backend. "super_admin" is
 * the single hardcoded bootstrap admin account's role (shown to users as
 * "Admin") and cannot be assigned to anyone else. "user" is the default
 * role every other new account gets automatically. "admin" is blocked too,
 * so a same-named duplicate role can't be recreated after being retired.
 */
export const RESERVED_ROLE_NAMES = new Set(["super_admin", "user", "admin", "technician"]);

/**
 * Friendly display name for a role name coming back from the API.
 * "super_admin" reads as "Admin", "user" as "User", and "technician" as
 * "Technician" everywhere in the UI -- used by the Roles & Permissions
 * page, the Users page, and the Shipment Planning column role-lock picker
 * so a role name renders identically no matter where it's shown.
 */
export function roleDisplayName(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "super_admin") return "Admin";
  if (lower === "employee" || lower === "user") return "User";
  if (lower === "technician") return "Technician";
  return name;
}