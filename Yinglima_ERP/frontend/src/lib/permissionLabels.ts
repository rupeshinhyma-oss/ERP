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
  warehouse: "🏭",
  finance_report: "💰",
  consignment_overview: "📋",
  vat_return: "🧾",
  organization: "⚙️",
  audit: "📜",
  trash: "🗑️",
  dashboard: "📊",
};

export interface PermissionSection {
  id: "core" | "inventory" | "finance" | "admin" | "masters";
  title: string;
  icon: string;
  description: string;
  modules: string[];
}

export const PERMISSION_SECTIONS: PermissionSection[] = [
  {
    id: "core",
    title: "Core Business & Operations",
    icon: "🏢",
    description: "Suppliers, Buyers, Sale Process, Planning, Inquiries, and Local Purchase",
    modules: ["supplier", "buyer", "sale_process", "planning", "inquiry", "local_purchase"],
  },
  {
    id: "inventory",
    title: "Inventory & Catalog",
    icon: "📦",
    description: "Product Master, Product Prices, Gallery, and Stock Movements",
    modules: ["product", "product_price", "productgallery", "stock_movement"],
  },
  {
    id: "finance",
    title: "Finance & Export",
    icon: "💰",
    description: "Financial Report, Consignment Overview (Finance, Gallery, Cargo Status, Product Summary), and VAT Return",
    modules: ["finance_report", "consignment_overview", "vat_return"],
  },
  {
    id: "admin",
    title: "User & Department Management",
    icon: "👥",
    description: "User Accounts, Designations, and Department Permissions",
    modules: ["user", "position", "roles_permissions"],
  },
  {
    id: "masters",
    title: "Settings & Masters",
    icon: "⚙️",
    description: "13 Lookup Tables (including Warehouses), Notification Rules, Organization Profile, Audit Logs, and Trash",
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
      "warehouse",
      "notification_settings",
      "organization",
      "audit",
      "trash",
    ],
  },
];

export function getSectionForModule(modKey: string): "core" | "inventory" | "finance" | "admin" | "masters" {
  for (const s of PERMISSION_SECTIONS) {
    if (s.modules.includes(modKey)) return s.id;
  }
  return "masters";
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
};

/**
 * A few permission codes have three dot-segments (e.g. "planning.textyn.edit")
 * where the generic last-segment splitter in friendlyPermissionLabel would
 * collapse them all down to the same unhelpful "Edit" label. These are
 * special-cased by their exact, full code instead.
 */
const FULL_CODE_LABELS: Record<string, string> = {
  "planning.textyn.edit": "Edit TEST(Y/N) Column",
  "planning.approvaldate.edit": "Edit APPROVAL DATE Column",
  "planning.colorstatusred.edit": "Set Status: Red",
  "planning.colorstatusgreen.edit": "Set Status: Green",
  "buyer.currentstatus": "Current Status",
  "buyer.potential": "Potential",
  "buyer.clientgrade": "Client Grade",
  "inquiry.approve": "Approve Quotation",
  "inquiry.send_message": "Send Messages (Email/WeChat)",
  "local_purchase.export": "Export / Print",
  "local_purchase.inward": "Inward to Warehouse",
  "sale_process.approve": "Update Status / Workflow",
  "sale_process.export": "Export Excel & CI/Packing Docs",
  "stock_movement.cancel": "Cancel / Reverse Movement",
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
  const parts = code.split(".");
  const action = parts[parts.length - 1];
  return ACTION_ICONS[action] || "🔹";
}

export function groupPermissionsByModule(permissions: Permission[]): Record<string, Permission[]> {
  const groups: Record<string, Permission[]> = {};
  for (const p of permissions) {
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