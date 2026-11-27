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
  feed: "Feed",
  organizationlist: "Organization List",
  buyer: "Agents & Buyers (Legacy)",
  buyertype: "Buyer Types",
  company: "Companies",
  agent: "Agents",
  zone: "Industrial Zones",
  crm: "CRM & Lead Management",
  supplier: "Suppliers",
  suppliertype: "Supplier Types",
  product: "Product Master",
  productgallery: "Product Gallery",
  product_stock: "Product Stock",
  stock_adjustment: "Stock Adjustment",
  stock_transfer: "Stock Transfer",
  category: "Categories",
  subcategory: "Sub-Categories",
  brand: "Brands",
  tax: "Taxes & HSN",
  hsn: "HSN Codes",
  uom: "Units of Measurement (UOM)",
  currency: "Currencies",
  country: "Countries",
  state: "States & Provinces",
  district: "Districts",
  city: "Cities",
  additionalcharge: "Additional Charges",
  socialmedia: "Social Media",
  agenttype: "Agent Types",
  companycategory: "Company Categories",
  companysector: "Company Sectors",
  warehouse: "Warehouses",
  billingcompany: "Billing Companies",
  bank: "Banks",
  transport: "Transport",
  payment_term: "Payment Terms",
  lead_source: "Lead Sources",
  adjustment_purpose: "Adjustment Purposes",
  call_type: "Call Types",
  user: "Users & Accounts",
  position: "Positions",
  reporting: "Reporting & Org Chart",
  organization: "ERP Settings",
  audit: "Audit Log",
  trash: "Trash",
  roles_permissions: "Departments & Permissions",
  hrms: "HRMS & Workforce",
  task: "Tasks & Work Management",
  technicaltask: "Technical Tasks",
  payment: "Payments",
  technician_operations: "Technician Gatepass & Wallet Management",
  proforma: "Proforma Invoices",
  saleorder: "Sales Process & Orders",
  discount_payment: "Discount Payments",
  localpurchase: "Local Purchase",
  purchase: "Purchase Orders",
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
  "product.view": "View",
  "product.create": "+ Add New (Create)",
  "product.update": "Action: Edit",
  "product.delete": "Delete (Bulk)",
  "product.export": "Export",
  "product.import": "Import (Sample + Import)",
  "product.bulk_action": "Bulk Actions",
  "product.manage": "Manage All",
  "category.view": "View",
  "category.create": "+ Add New (Create)",
  "category.update": "Action: Edit",
  "category.delete": "Action: Delete",
  "category.export": "Export",
  "category.import": "Import (Sample + Import)",
  "category.bulk_action": "Bulk Actions",
  "category.status_edit": "Status",
  "category.manage": "Manage All",
  "subcategory.view": "View",
  "subcategory.create": "+ Add New (Create)",
  "subcategory.update": "Action: Edit",
  "subcategory.delete": "Action: Delete",
  "subcategory.export": "Export",
  "subcategory.import": "Import (Sample + Import)",
  "subcategory.bulk_action": "Bulk Actions",
  "subcategory.status_edit": "Status",
  "subcategory.manage": "Manage All",
  "brand.view": "View",
  "brand.create": "+ Add New (Create)",
  "brand.update": "Action: Edit",
  "brand.delete": "Action: Delete",
  "brand.export": "Export",
  "brand.import": "Import (Sample + Import)",
  "brand.bulk_action": "Bulk Actions",
  "brand.status_edit": "Status",
  "brand.manage": "Manage All",
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
  // Proforma Invoices
  "proforma.view": "View",
  "proforma.pending.view": "View Pending Stage",
  "proforma.admin_approved.view": "View Admin Approved Stage",
  "proforma.confirmed.view": "View Confirmed Stage",
  "proforma.cancelled.view": "View Cancelled Stage",
  "proforma.create": "+ Add New (Create)",
  "proforma.action.view": "View Action Column (⋮)",
  "proforma.download": "Action: Download / View PDF",
  "proforma.details.view": "Action: View Details",
  "proforma.update": "Action: Edit",
  "proforma.approve": "Stage: Admin Approved (Approve)",
  "proforma.confirm": "Stage: Confirmed (Confirm & Create SO)",
  "proforma.cancel": "Stage: Cancelled (Cancel)",
  "proforma.delete": "Action: Delete",
  "proforma.manage": "Manage All",
  // Sales Process & Orders
  "saleorder.view": "View",
  "saleorder.pending.view": "View Pending Stage",
  "saleorder.sales_confirmed.view": "View Sales Confirmed Stage",
  "saleorder.admin_approved.view": "View Admin Approved Stage",
  "saleorder.acc_confirmed.view": "View Acc. Confirmed Stage",
  "saleorder.gatepass_created.view": "View Gatepass Created Stage",
  "saleorder.dispatched.view": "View Dispatched Stage",
  "saleorder.gatepass_cancelled.view": "View Gatepass Cancelled Stage",
  "saleorder.lr.view": "View LR Stage",
  "saleorder.cancelled.view": "View Cancelled Stage",
  "saleorder.create": "+ Add New (Create)",
  "saleorder.export": "Export",
  "saleorder.details.view": "Action: View Details",
  "saleorder.action.view": "View Action Column (⋮)",
  "saleorder.update": "Action: Edit",
  "saleorder.duplicate": "Action: Duplicate",
  "saleorder.download": "Action: Download Gatepass / PDF",
  "saleorder.files": "Action: SO Files",
  "saleorder.confirm": "Stage: Sales Confirmed (Confirm)",
  "saleorder.approve": "Stage: Admin Approved (Approve)",
  "saleorder.accounts": "Stage: Acc. Confirmed (Accounts)",
  "saleorder.warehouse": "Stage: Gatepass / Dispatch / LR (Warehouse)",
  "saleorder.cancel": "Action: Cancel",
  "saleorder.delete": "Action: Delete",
  "saleorder.manage": "Manage All",
  // Discount Payments
  "discount_payment.view": "View",
  "discount_payment.pending.view": "View Pending",
  "discount_payment.completed.view": "View Completed",
  "discount_payment.adjust": "Action: Adjust Discount",
  "discount_payment.payments.view": "Action: List Payments",
  "discount_payment.manage": "Manage All",
  // Local Purchase
  "localpurchase.view": "View",
  "localpurchase.create": "+ Add New (Create)",
  "localpurchase.import": "Import (Sample + Import)",
  "localpurchase.export": "Export",
  "localpurchase.bulk_action": "Bulk Actions",
  "localpurchase.download": "Action: Download Purchase",
  "localpurchase.update": "Action: Edit",
  "localpurchase.confirm": "Action: Confirm (Add Stock)",
  "localpurchase.delete": "Action: Delete",
  "localpurchase.manage": "Manage All",
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
  "discount_payment.action.view",
  "inquiry.view",
  "inquiry.create",
  "inquiry.update",
  "inquiry.delete",
  "inquiry.approve",
  "quotation.create",
  "quotation.approve",
  "quotation.delete",
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

export interface NavPermissionSection {
  id: string;
  title: string;
  modules: string[];
}

/**
 * Left-sidebar navigation section order (`nav.ts` -> `NAV_SECTIONS`), used by
 * `/rbac` and `/users` permission matrices so cards match the left sidebar top-to-bottom.
 */
export const NAV_PERMISSION_SECTIONS: NavPermissionSection[] = [
  { id: "dashboard", title: "DASHBOARD", modules: ["feed", "dashboard"] },
  { id: "task", title: "TASK", modules: ["task", "technicaltask", "payment", "technician_operations"] },
  { id: "contact", title: "CONTACT", modules: ["company", "agent", "zone", "buyer"] },
  { id: "crm", title: "CRM", modules: ["crm"] },
  {
    id: "inventory",
    title: "INVENTORY",
    modules: ["product_stock", "stock_adjustment", "stock_transfer", "product", "productgallery", "category", "subcategory", "brand"],
  },
  { id: "sale", title: "SALE", modules: ["proforma", "saleorder", "discount_payment"] },
  { id: "purchase", title: "PURCHASE", modules: ["localpurchase", "purchase", "supplier"] },
  { id: "reports", title: "REPORTS", modules: ["report", "cargo_overview"] },
  { id: "hrms", title: "HRMS", modules: ["hrms"] },
  { id: "user_management", title: "USER MANAGEMENT", modules: ["user", "position", "roles_permissions", "reporting"] },
  {
    id: "settings_masters",
    title: "SETTINGS — MASTERS",
    modules: [
      "city",
      "district",
      "state",
      "country",
      "currency",
      "tax",
      "hsn",
      "additionalcharge",
      "socialmedia",
      "agenttype",
      "companycategory",
      "companysector",
      "suppliertype",
      "buyertype",
      "warehouse",
      "uom",
      "billingcompany",
      "organizationlist",
      "bank",
      "transport",
      "payment_term",
      "lead_source",
      "adjustment_purpose",
      "call_type",
    ],
  },
  { id: "settings_system", title: "SETTINGS — SYSTEM", modules: ["organization", "audit", "trash"] },
];

const _SEMANTIC_LAST_SEGMENT_RANK: Record<string, number> = {
  view: 0,
  read: 0,
  create: 2,
  quick_add: 2,
  import: 3,
  export: 3,
  bulk_action: 3,
  download: 4,
  details: 4,
  files: 4,
  duplicate: 4,
  adjust: 4,
  status_edit: 4,
  grade_edit: 4,
  potential_edit: 4,
  currentstatus: 4,
  potential: 4,
  clientgrade: 4,
  action: 4,
  approve: 5,
  accounts: 5,
  confirm: 5,
  confirmed: 5,
  received: 5,
  warehouse: 5,
  complete: 5,
  reopen: 5,
  pending: 5,
  cancel: 5,
  update: 6,
  delete: 7,
  manage: 8,
};

function _permissionSortRank(code: string): number {
  const parts = code.split(".");
  if (parts.length >= 3 && parts[parts.length - 1] === "view") {
    return parts[parts.length - 2] === "action" ? 4 : 1;
  }
  const last = parts[parts.length - 1];
  return _SEMANTIC_LAST_SEGMENT_RANK[last] ?? 5;
}

export function sortModulePermissions(items: Permission[]): Permission[] {
  return [...items].sort((a, b) => {
    const rankDiff = _permissionSortRank(a.code) - _permissionSortRank(b.code);
    return rankDiff !== 0 ? rankDiff : a.code.localeCompare(b.code);
  });
}

export function groupPermissionsByModule(permissions: Permission[]): Record<string, Permission[]> {
  const groups: Record<string, Permission[]> = {};
  for (const p of permissions) {
    if (DEPRECATED_PERMISSION_CODES.has(p.code)) continue;
    const modKey = p.module || p.code.split(".")[0];
    if (!groups[modKey]) groups[modKey] = [];
    groups[modKey].push(p);
  }
  for (const modKey of Object.keys(groups)) {
    groups[modKey] = sortModulePermissions(groups[modKey]);
  }
  return groups;
}

export interface OrderedPermissionSection {
  id: string;
  title: string;
  moduleKeys: string[];
}

/** Order grouped permission module keys according to left-sidebar navigation sections. */
export function groupPermissionsIntoNavSections(
  groups: Record<string, Permission[]>,
  allowedModKeys?: string[]
): OrderedPermissionSection[] {
  const allowedSet = allowedModKeys ? new Set(allowedModKeys) : null;
  const hasMod = (modKey: string) => Boolean(groups[modKey]?.length) && (!allowedSet || allowedSet.has(modKey));

  const seen = new Set<string>();
  const sections: OrderedPermissionSection[] = [];

  for (const sec of NAV_PERMISSION_SECTIONS) {
    const moduleKeys: string[] = [];
    for (const modKey of sec.modules) {
      if (hasMod(modKey) && !seen.has(modKey)) {
        seen.add(modKey);
        moduleKeys.push(modKey);
      }
    }
    if (moduleKeys.length > 0) {
      sections.push({ id: sec.id, title: sec.title, moduleKeys });
    }
  }

  const remaining = Object.keys(groups)
    .filter((modKey) => hasMod(modKey) && !seen.has(modKey))
    .sort();
  if (remaining.length > 0) {
    sections.push({ id: "other", title: "OTHER", moduleKeys: remaining });
  }

  return sections;
}

export interface FilteredPermissionModule {
  modKey: string;
  items: Permission[];
}

export interface FilteredPermissionSection {
  id: string;
  title: string;
  modules: FilteredPermissionModule[];
}

/**
 * Filter nav-ordered permission sections and module items by a free-text query
 * (matches section title, module label/key, permission code, friendly label, or description).
 */
export function filterNavPermissionSections(
  groups: Record<string, Permission[]>,
  query: string,
  allowedModKeys?: string[]
): FilteredPermissionSection[] {
  const sections = groupPermissionsIntoNavSections(groups, allowedModKeys);
  const q = query.trim().toLowerCase();

  if (!q) {
    return sections.map((sec) => ({
      id: sec.id,
      title: sec.title,
      modules: sec.moduleKeys.map((modKey) => ({ modKey, items: groups[modKey] })),
    }));
  }

  const out: FilteredPermissionSection[] = [];
  for (const sec of sections) {
    const sectionMatch = sec.title.toLowerCase().includes(q);
    const matchedModules: FilteredPermissionModule[] = [];

    for (const modKey of sec.moduleKeys) {
      const modName = (MODULE_NAMES[modKey] || modKey).toLowerCase();
      const moduleMatch = sectionMatch || modName.includes(q) || modKey.toLowerCase().includes(q);
      const items = moduleMatch
        ? groups[modKey]
        : groups[modKey].filter(
            (p) =>
              p.code.toLowerCase().includes(q) ||
              friendlyPermissionLabel(p.code).toLowerCase().includes(q) ||
              (p.description || "").toLowerCase().includes(q)
          );
      if (items.length > 0) {
        matchedModules.push({ modKey, items });
      }
    }

    if (matchedModules.length > 0) {
      out.push({ id: sec.id, title: sec.title, modules: matchedModules });
    }
  }
  return out;
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