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
  supplier: "Suppliers",
  suppliertype: "Supplier Types",
  planning: "Shipment Planning",
  product: "Products Master",
  productgallery: "Product Gallery",
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
  position: "Positions & Designations",
  organization: "Organizations",
  audit: "System Audit Logs",
  trash: "Trash",
  roles_permissions: "Departments & Permissions",
  inquiry: "Inquiries & Quotations",
  product_price: "Product Prices",
  local_purchase: "Local Purchase",
  sale_process: "Sale Process",
  stock_movement: "Stock Movement",
  notification_settings: "Notification Rules",
  warehouse: "Warehouses",
  payment_mode: "Payment Modes / Bank Accounts",
  finance_report: "Financial Report",
  consignment_overview: "Consignment Overview",
  vat_return: "VAT Return",
};

/** Icons for every module in the ERP system. */
export const MODULE_ICONS: Record<string, string> = {
  supplier: "🚚",
  buyer: "🤝",
  sale_process: "🛒",
  planning: "🚢",
  inquiry: "📩",
  local_purchase: "🛒",
  product: "📦",
  product_price: "🏷️",
  productgallery: "🖼️",
  stock_movement: "📦",
  user: "👤",
  position: "🎖️",
  roles_permissions: "🛡️",
  notification_settings: "🔔",
  city: "🏙️",
  state: "🗺️",
  country: "🌍",
  currency: "💱",
  uom: "⚖️",
  hsn: "🔢",
  category: "📂",
  subcategory: "📁",
  brand: "🏷️",
  suppliertype: "🏭",
  buyertype: "🏢",
  organizationlist: "🏛️",
  payment_mode: "🏦",
  warehouse: "🏭",
  finance_report: "💰",
  consignment_overview: "📋",
  vat_return: "🧾",
  organization: "⚙️",
  audit: "📜",
  trash: "🗑️",
  dashboard: "📊",
};

export type PermissionSectionId =
  | "contact"
  | "inventory"
  | "sale"
  | "purchase"
  | "planning"
  | "finance"
  | "user_management"
  | "settings_masters"
  | "settings_system";

export interface PermissionSection {
  id: PermissionSectionId;
  title: string;
  pillLabel: string;
  icon: string;
  description: string;
  modules: string[];
}

/**
 * Left-sidebar navigation section & module order (`nav.ts` -> `NAV_SECTIONS`),
 * rendered top-to-bottom in PermissionMatrixEditor (`/rbac` and `/users`).
 */
export const PERMISSION_SECTIONS: PermissionSection[] = [
  {
    id: "contact",
    title: "CONTACT",
    pillLabel: "CONTACT",
    icon: "🤝",
    description: "Suppliers and Buyers",
    modules: ["supplier", "buyer"],
  },
  {
    id: "inventory",
    title: "INVENTORY",
    pillLabel: "INVENTORY",
    icon: "📦",
    description: "Product Master, Product Prices, Product Gallery, and Stock Movement",
    modules: ["product", "product_price", "productgallery", "stock_movement"],
  },
  {
    id: "sale",
    title: "SALE",
    pillLabel: "SALE",
    icon: "🛒",
    description: "Sale Process and Inquiries",
    modules: ["sale_process", "inquiry"],
  },
  {
    id: "purchase",
    title: "PURCHASE",
    pillLabel: "PURCHASE",
    icon: "🛍️",
    description: "Local Purchase",
    modules: ["local_purchase"],
  },
  {
    id: "planning",
    title: "PLANNING",
    pillLabel: "PLANNING",
    icon: "🚢",
    description: "Shipment Planning",
    modules: ["planning"],
  },
  {
    id: "finance",
    title: "FINANCE",
    pillLabel: "FINANCE",
    icon: "💰",
    description: "Financial Report, Consignment Overview, and VAT Return",
    modules: ["finance_report", "consignment_overview", "vat_return"],
  },
  {
    id: "user_management",
    title: "USER MANAGEMENT",
    pillLabel: "USER MANAGEMENT",
    icon: "👥",
    description: "Users, Positions, and Departments & Permissions",
    modules: ["user", "position", "roles_permissions"],
  },
  {
    id: "settings_masters",
    title: "SETTINGS — Masters",
    pillLabel: "Masters",
    icon: "🗄️",
    description: "Cities, Provinces, Countries, Currencies, UOM, HSN, Categories, Brands, Types, Payment Modes, and Warehouses",
    modules: [
      "city",
      "state",
      "country",
      "currency",
      "uom",
      "hsn",
      "category",
      "subcategory",
      "brand",
      "suppliertype",
      "buyertype",
      "organizationlist",
      "payment_mode",
      "warehouse",
    ],
  },
  {
    id: "settings_system",
    title: "SETTINGS — System",
    pillLabel: "System",
    icon: "⚙️",
    description: "Notification Rules, ERP Settings, Audit Log, and Trash",
    modules: ["notification_settings", "organization", "audit", "trash"],
  },
];

export function getSectionForModule(modKey: string): PermissionSectionId {
  for (const s of PERMISSION_SECTIONS) {
    if (s.modules.includes(modKey)) return s.id;
  }
  return "settings_system";
}

const ACTION_LABELS: Record<string, string> = {
  read: "View",
  view: "View",
  create: "Create",
  update: "Edit",
  delete: "Delete",
  export: "Export",
  import: "Import",
  approve: "Approve Quotation",
  send_message: "Send Messages",
  manage: "Manage All",
  action: "Actions",
  bulk_action: "Bulk Actions",
  grade_edit: "Edit Grade",
  potential_edit: "Edit Potential",
  currentstatus: "Current Status",
  potential: "Potential",
  clientgrade: "Client Grade",
  cancel: "Cancel / Reverse",
  inward: "Inward to Warehouse",
};

export const ACTION_ICONS: Record<string, string> = {
  view: "👁️",
  read: "👁️",
  create: "➕",
  update: "✏️",
  delete: "🗑️",
  export: "📤",
  import: "📥",
  approve: "✅",
  send_message: "💬",
  manage: "⚙️",
  action: "⚡",
  bulk_action: "📑",
  grade_edit: "⭐",
  potential_edit: "📈",
  currentstatus: "📊",
  potential: "📈",
  clientgrade: "⭐",
  cancel: "↩️",
  inward: "📦",
  restore: "♻️",
};

/**
 * A few permission codes have three dot-segments (e.g. "planning.textyn.edit")
 * where the generic last-segment splitter in friendlyPermissionLabel would
 * collapse them all down to the same unhelpful "Edit" label. These are
 * special-cased by their exact, full code instead.
 */
const FULL_CODE_LABELS: Record<string, string> = {
  "planning.view": "View Planning Sheets",
  "planning.sheet.manage": "Manage Sheets & Tabs",
  "planning.column.manage": "Manage Columns (Add / Edit)",
  "planning.cell.edit": "Edit Cells & Remarks",
  "planning.textyn.edit": "Edit TEST(Y/N) Column",
  "planning.approvaldate.edit": "Edit APPROVAL DATE Column",
  "planning.colorstatusred.edit": "Set Status: Red (Requirement)",
  "planning.colorstatusgreen.edit": "Set Status: Green (Purchased)",
  "organization.manage": "Manage Organization Profile",
  "roles_permissions.action": "Manage Roles & Overrides",
  "user.action": "Manage Users & Overrides",
  "buyer.currentstatus": "Current Status",
  "buyer.potential": "Potential",
  "buyer.clientgrade": "Client Grade",
  "supplier.currentstatus": "Current Status",
  "trash.restore": "Restore from Trash",
  "trash.delete": "Permanent Delete / Empty Trash",
  "inquiry.approve": "Approve Quotation",
  "inquiry.send_message": "Send Messages (Email/WeChat)",
  "local_purchase.export": "Export / Print",
  "local_purchase.inward": "Inward to Warehouse",
  "local_purchase.price_history": "View Price History",
  "product_price.trade_history": "View Trade History",
  "productgallery.products.view": "View Product Photos",
  "productgallery.suppliers.view": "View Supplier Photos",
  "productgallery.quotations.view": "View Quotation Docs",
  "productgallery.delete": "Delete Photos / Media",
  "stock_movement.inward.view": "View Inward Register",
  "stock_movement.outward.view": "View Outward Register",
  "stock_movement.ledger.view": "View Current Stock Ledger",
  "sale_process.approve": "Update Status / Workflow",
  "sale_process.export": "Export Excel & CI/Packing Docs",
  "notification_settings.manage": "Manage Notification Rules",
  // Financial Report
  "finance_report.view": "View Financial Report & History",
  "finance_report.create": "Record Payment (+ Add Payment)",
  "finance_report.update": "Edit Terms, Due Date & Agent Bill",
  "finance_report.delete": "Delete Payment Installment",
  "finance_report.export": "Export Financial Planner Excel",
  // Consignment Overview (Section-Level Granular Permissions)
  "consignment_overview.view": "View Consignment List & Header",
  "consignment_overview.finance.view": "View Section 1: Finance Planning",
  "consignment_overview.gallery.view": "View Section 2: Consignment Gallery",
  "consignment_overview.gallery.upload": "Upload Documents (Consignment Gallery)",
  "consignment_overview.gallery.delete": "Delete Documents (Consignment Gallery)",
  "consignment_overview.cargo_status.view": "View Section 3: Cargo Status Checklist",
  "consignment_overview.cargo_status.edit": "Edit Cargo Status, ETD/ETA & Remarks",
  "consignment_overview.product_summary.view": "View Section 4: Product Summary",
  // VAT Return
  "vat_return.view": "View VAT Return & Breakdown",
  "vat_return.create": "Create Manual EXP Entry",
  "vat_return.update": "Edit Breakdown, Rebate % & Filing Date",
  "vat_return.receipt": "Record & Delete VAT Refund Receipts",
  "vat_return.import": "Import Excel / CSV",
  "vat_return.export": "Export 2-Sheet Excel Workbook",
};

/** "product.create" -> "Create"; unknown actions fall back to the raw code. */
export function friendlyPermissionLabel(code: string): string {
  if (FULL_CODE_LABELS[code]) return FULL_CODE_LABELS[code];
  const parts = code.split(".");
  const action = parts[parts.length - 1];
  return ACTION_LABELS[action] || parts.slice(1).join(" ") || code;
}

export function friendlyActionIcon(code: string): string {
  if (code.includes("colorstatusred")) return "🔴";
  if (code.includes("colorstatusgreen")) return "🟢";
  if (code.includes("approvaldate")) return "📅";
  if (code.includes("textyn")) return "🧪";
  if (code === "consignment_overview.finance.view") return "💰";
  if (code === "consignment_overview.gallery.view") return "📂";
  if (code === "consignment_overview.gallery.upload") return "📤";
  if (code === "consignment_overview.gallery.delete") return "🗑️";
  if (code === "consignment_overview.cargo_status.view") return "🚢";
  if (code === "consignment_overview.cargo_status.edit") return "✅";
  if (code === "consignment_overview.product_summary.view") return "📦";
  if (code === "vat_return.receipt") return "💳";
  if (code === "local_purchase.price_history" || code === "product_price.trade_history") return "📜";
  if (code === "productgallery.products.view") return "📦";
  if (code === "productgallery.suppliers.view") return "🏭";
  if (code === "productgallery.quotations.view") return "📄";
  if (code === "stock_movement.inward.view") return "📥";
  if (code === "stock_movement.outward.view") return "📤";
  if (code === "stock_movement.ledger.view") return "📊";
  const parts = code.split(".");
  const action = parts[parts.length - 1];
  return ACTION_ICONS[action] || "🔹";
}

const _SEMANTIC_LAST_SEGMENT_RANK: Record<string, number> = {
  view: 0,
  read: 0,
  create: 2,
  import: 3,
  export: 3,
  bulk_action: 3,
  action: 4,
  inward: 4,
  price_history: 4,
  trade_history: 4,
  currentstatus: 4,
  potential: 4,
  clientgrade: 4,
  grade_edit: 4,
  potential_edit: 4,
  approve: 5,
  send_message: 5,
  receipt: 5,
  cancel: 5,
  update: 6,
  edit: 6,
  delete: 7,
  restore: 7,
  manage: 8,
};

function _permissionSortRank(code: string): number {
  const parts = code.split(".");
  if (parts.length >= 3 && parts[parts.length - 1] === "view") {
    return 1;
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
    const modKey = p.module || p.code.split(".")[0];
    if (!groups[modKey]) groups[modKey] = [];
    groups[modKey].push(p);
  }
  for (const modKey of Object.keys(groups)) {
    groups[modKey] = sortModulePermissions(groups[modKey]);
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
export const RESERVED_ROLE_NAMES = new Set(["super_admin", "user", "admin"]);

/**
 * Friendly display name for a role name coming back from the API.
 * "super_admin" reads as "Admin" and "user" as "User" everywhere in the
 * UI -- used by the Roles & Permissions page, the Users page, and the
 * Shipment Planning column role-lock picker so a role name renders
 * identically no matter where it's shown.
 */
export function roleDisplayName(name: string): string {
  if (name === "super_admin") return "Admin";
  if (name === "employee" || name === "user") return "User";
  return name;
}