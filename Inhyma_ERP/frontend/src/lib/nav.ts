/**
 * Sidebar structure and page titles.
 *
 * Ported from NAV_SECTIONS / PAGE_TITLES in nav.js. Labels, ordering, group
 * names, icons and permission codes are unchanged; the `.html` hrefs become
 * router paths.
 */

import type { IconKey } from "@/components/icons";

export interface NavSubItem {
  key: string;
  label: string;
  path: string;
  icon?: IconKey;
  permission?: string;
  superAdminOnly?: boolean;
}

export interface NavItem {
  key: string;
  label: string;
  path?: string;
  icon: IconKey;
  permission?: string;
  superAdminOnly?: boolean;
  children?: NavSubItem[];
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "DASHBOARD",
    items: [
      { key: "dashboard", label: "Dashboard", path: "/dashboard", icon: "dashboard" },
    ],
  },
  {
    label: "CONTACT",
    items: [
      { key: "companies", label: "Companies", path: "/companies", icon: "building", permission: "company.view" },
      { key: "buyers", label: "Buyers", path: "/buyers", icon: "shoppingBag", permission: "buyer.view" },
    ],
  },
  {
    label: "INVENTORY",
    items: [
      { key: "product-stock", label: "Product Stock", path: "/product-stock/list", icon: "stock", permission: "product.view" },
      { key: "stock-adjustment", label: "Stock Adjustment", path: "/stock-adjustment", icon: "sliders", permission: "product.view" },
      { key: "stock-transfer", label: "Stock Transfer", path: "/stock-transfer", icon: "truck", permission: "product.view" },
      { key: "masters-products", label: "Product Master", path: "/product/list", icon: "box", permission: "product.view" },
      { key: "product-gallery", label: "Product Gallery", path: "/product-gallery", icon: "image", permission: "productgallery.view" },
      { key: "masters-categories", label: "Categories", path: "/masters/categories", icon: "layers", permission: "category.view" },
      { key: "masters-subcategories", label: "Sub Categories", path: "/masters/subcategories", icon: "folderTree", permission: "subcategory.view" },
      { key: "masters-brands", label: "Brands", path: "/masters/brands", icon: "award", permission: "brand.view" },
      { key: "masters-supplier-types", label: "Supplier Types", path: "/masters/supplier-types", icon: "network", permission: "suppliertype.view" },
      { key: "masters-buyer-types", label: "Buyer Types", path: "/masters/buyer-types", icon: "idCard", permission: "buyertype.view" },
    ],
  },
  {
    label: "SALE",
    items: [
      { key: "proforma", label: "Proforma", path: "/proforma-invoice/list", icon: "fileText" },
      { key: "inquiries", label: "Inquiries", path: "/inquiries", icon: "fileText", permission: "inquiry.view" },
      { key: "sales-process", label: "Sales Process", path: "/sales/process", icon: "shoppingCart" },
      { key: "discount-payments", label: "Discount Payments", path: "/discount-payments/list", icon: "creditCard" },
    ],
  },
  {
    label: "PURCHASE",
    items: [
      { key: "local-purchases", label: "Local Purchase", path: "/purchase-order/list", icon: "shoppingBag", permission: "purchase.view" },
      { key: "import-purchases", label: "Import Purchase", path: "/purchase-order/import-purchase-list", icon: "truck", permission: "purchase.view" },
      { key: "purchase-suppliers", label: "Suppliers", path: "/suppliers", icon: "factory", permission: "supplier.view" },
    ],
  },
  {
    label: "REPORTS",
    items: [
      { key: "reports-re-order", label: "Re-Order", path: "/reports/re-order", icon: "stock", permission: "report.view" },
      { key: "reports-stock-transactions", label: "Stock Transactions", path: "/reports/stock-transactions", icon: "refresh", permission: "report.view" },
      { key: "reports-deleted-orders", label: "Deleted Orders", path: "/reports/deleted-orders", icon: "trash", permission: "report.view" },
      { key: "reports-general", label: "General Reports", path: "/reports/general", icon: "fileText", permission: "report.view" },
    ],
  },
  {
    label: "PLANNING",
    items: [
      { key: "planning", label: "Shipment Planning", path: "/planning", icon: "truck", permission: "planning.view" },
    ],
  },
  {
    label: "TASK",
    items: [
      { key: "tasks", label: "Tasks", path: "/tasks", icon: "task" },
      { key: "technical-tasks", label: "Technical Tasks", path: "/technical-task/list", icon: "wrench" },
      { key: "marketing-tasks", label: "Marketing Tasks", path: "/marketing-task/list", icon: "messageSquare" },
    ],
  },
  {
    label: "USER MANAGEMENT",
    items: [
      { key: "users", label: "Users", path: "/users", icon: "user", permission: "user.view" },
      { key: "positions", label: "Positions", path: "/positions", icon: "briefcase", permission: "position.view" },
      { key: "rbac", label: "Departments & Permissions", path: "/rbac", icon: "shield", permission: "roles_permissions.view" },
      { key: "effective-permissions", label: "Effective Permissions", path: "/effective-permissions", icon: "shield", permission: "roles_permissions.view" },
    ],
  },
  {
    label: "SETTINGS",
    items: [
      {
        key: "masters-group",
        label: "Masters",
        icon: "masters",
        children: [
          { key: "masters-cities", label: "Cities", path: "/masters/cities", permission: "city.view" },
          { key: "masters-districts", label: "Districts", path: "/masters/districts", permission: "district.view" },
          { key: "masters-states", label: "States", path: "/masters/states", permission: "state.view" },
          { key: "masters-taxes", label: "Taxes", path: "/masters/taxes", permission: "tax.view" },
          { key: "masters-additional-charges", label: "Additional Charges", path: "/masters/additional-charges", permission: "additionalcharge.view" },
          { key: "masters-social-media", label: "Social Media", path: "/masters/social-media", permission: "socialmedia.view" },
          { key: "masters-agent-types", label: "Agent Types", path: "/masters/agent-types", permission: "agenttype.view" },
          { key: "masters-company-categories", label: "Company Categories", path: "/masters/company-categories", permission: "companycategory.view" },
          { key: "masters-company-sectors", label: "Company Sectors", path: "/masters/company-sectors", permission: "companysector.view" },
          { key: "masters-warehouses", label: "Warehouses", path: "/masters/warehouses", permission: "warehouse.view" },
          { key: "masters-uom", label: "UOM", path: "/masters/uom", permission: "uom.view" },
          { key: "masters-billing-company", label: "Billing Company", path: "/masters/billing-company", permission: "billingcompany.view" },
          { key: "masters-technicians", label: "Technicians", path: "/masters/technicians", permission: "technician.view" },
          { key: "masters-banks", label: "Bank", path: "/masters/banks", permission: "bank.view" },
          { key: "masters-transport", label: "Transport", path: "/masters/transport", permission: "transport.view" },
          { key: "masters-payment-terms", label: "Payment Terms", path: "/masters/payment-terms", permission: "payment_term.view" },
          { key: "masters-lead-sources", label: "Lead Sources", path: "/masters/lead-sources", permission: "lead_source.view" },
          { key: "masters-adjustment-purpose", label: "Adjustment Purpose", path: "/masters/adjustment-purpose", permission: "adjustment_purpose.view" },
          { key: "masters-call-types", label: "Call Types", path: "/masters/call-types", permission: "call_type.view" },
        ],
      },
      { key: "masters-countries", label: "Countries", path: "/masters/countries", icon: "globe", permission: "country.view" },
      { key: "masters-currencies", label: "Currencies", path: "/masters/currencies", icon: "coins", permission: "currency.view" },
      { key: "organization", label: "Organization Settings", path: "/organization", icon: "settings", permission: "organization.manage" },
      { key: "masters-company-list", label: "Organization List", path: "/masters/company-list", icon: "building", permission: "organizationlist.view" },
      { key: "audit", label: "Audit Log", path: "/audit", icon: "clock", permission: "audit.view" },
      { key: "trash", label: "Trash", path: "/trash", icon: "trash", permission: "trash.view" },
    ],
  },
  {
    label: "CALL LOG",
    items: [
      { key: "call-logs-follow-up", label: "Follow Up Logs", path: "/call-logs/follow-up", icon: "fileText" },
    ],
  },
];

export const PAGE_TITLES: Record<string, string> = {
  trash: "Trash Management",
  dashboard: "Dashboard",
  reports: "Reports & Analytics",
  buyers: "Agents & Buyers",
  inquiries: "Inquiries",
  proforma: "Proforma Invoices",
  "sales-process": "Sales Process",
  "discount-payments": "Discount Payments",
  "local-purchases": "Local Purchase",
  "import-purchases": "Import Purchase",
  "purchase-suppliers": "Suppliers",
  "reports-re-order": "Re-Order",
  "reports-stock-transactions": "Stock Transactions",
  "reports-deleted-orders": "Deleted Orders",
  "reports-general": "General Reports",
  planning: "Shipment Planning",
  crm: "Customer Relationship Management",
  sales: "Sales Process",
  purchase: "Purchasing",
  inventory: "Inventory & Stock",
  manufacturing: "Manufacturing",
  finance: "Finance & Accounts",
  hrms: "Human Resource Management",
  organization: "Organization Settings",
  users: "Users",
  employees: "Employees",
  positions: "Positions & Designations",
  "org-chart": "Organization Chart",
  "masters-company-list": "Organization List",
  "masters-countries": "Countries (National Level)",
  "masters-states": "States",
  "masters-districts": "Districts",
  "masters-cities": "Cities",
  "masters-currencies": "Currencies",
  "masters-uom": "UOM",
  "masters-brands": "Brands",
  "masters-supplier-types": "Supplier Types",
  "masters-buyer-types": "Buyer Types",
  "masters-categories": "Categories",
  "masters-subcategories": "Sub Categories",
  "product-stock": "Product Stock",
  "stock-adjustment": "Stock Adjustment",
  "stock-transfer": "Stock Transfer",
  "masters-products": "Product Master",
  suppliers: "Suppliers",
  companies: "Companies",
  audit: "Audit Log",
  rbac: "Departments & Permissions",
  "effective-permissions": "Effective Permissions Inspector",
  "employee-form": "Employee Form",
  "employee-detail": "Employee Detail",
  "403": "Access Restricted",
  "my-tasks": "My Tasks",
  tasks: "Task Management",
  "technical-tasks": "Technical Task List",
  "marketing-tasks": "Marketing Tasks",
  "tasks-kanban": "Tasks Kanban Board",
  "tasks-calendar": "Tasks Calendar",

  // Masters from screenshot
  "masters-taxes": "Taxes",
  "masters-additional-charges": "Additional Charges",
  "masters-social-media": "Social Media",
  "masters-agent-types": "Agent Types",
  "masters-company-categories": "Company Categories",
  "masters-company-sectors": "Company Sectors",
  "masters-warehouses": "Warehouses",
  "masters-billing-company": "Billing Company",
  "masters-technicians": "Technicians",
  "masters-bank": "Bank",
  "masters-transport": "Transport",
  "masters-payment-terms": "Payment Terms",
  "masters-lead-sources": "Lead Sources",
  "masters-adjustment-purpose": "Adjustment Purpose",
  "masters-call-types": "Call Types",
  "call-logs-follow-up": "Follow Up Logs",
};

export const DEFAULT_BRAND_NAME = "Inhyma";

/** Flat lookup of every nav item by key, for the page-access check. */
export const NAV_ITEMS_BY_KEY: Record<string, NavItem | NavSubItem> = NAV_SECTIONS.reduce(
  (acc, section) => {
    section.items.forEach((item) => {
      acc[item.key] = item;
      if (item.children) {
        item.children.forEach((child) => {
          acc[child.key] = child;
        });
      }
    });
    return acc;
  },
  {} as Record<string, NavItem | NavSubItem>
);

if (NAV_ITEMS_BY_KEY["purchase-suppliers"] && !NAV_ITEMS_BY_KEY["suppliers"]) {
  NAV_ITEMS_BY_KEY["suppliers"] = NAV_ITEMS_BY_KEY["purchase-suppliers"];
}

/**
 * Old filename -> new path, for bookmark compatibility.
 */
export const LEGACY_REDIRECTS: Record<string, string> = {
  "/index.html": "/dashboard",
  "/login.html": "/login",
  "/403.html": "/403",
  "/organization.html": "/organization",
  "/audit.html": "/audit",
  "/users.html": "/users",
  "/rbac.html": "/rbac",
  "/effective-permissions.html": "/effective-permissions",
  "/teams.html": "/users",
  "/teams": "/users",
  "/suppliers.html": "/suppliers",
  "/supplier/list": "/suppliers",
  "/supplier": "/suppliers",
  "/buyers.html": "/buyers",
  "/inquiries.html": "/inquiries",
  "/masters-countries.html": "/masters/countries",
  "/masters-states.html": "/masters/states",
  "/masters-districts.html": "/masters/districts",
  "/masters-cities.html": "/masters/cities",
  "/masters-currencies.html": "/masters/currencies",
  "/masters-taxes.html": "/masters/taxes",
  "/tax/list": "/masters/taxes",
  "/masters-uom.html": "/masters/uom",
  "/masters-brands.html": "/masters/brands",
  "/masters-categories.html": "/masters/categories",
  "/masters-subcategories.html": "/masters/subcategories",
  "/masters-products.html": "/masters/products",
  "/proforma-invoice/list": "/proforma-invoice/list",
  "/sale-process/list": "/sales/process",
  "/sales-process/list": "/sales/process",
  "/discount-payments/list": "/discount-payments/list",
  "/purchase/local": "/purchase-order/list",
  "/purchase/local/list": "/purchase-order/list",
  "/purchase-order": "/purchase-order/list",
  "/purchase-order.html": "/purchase-order/list",
  "/purchase-order/list": "/purchase-order/list",
  "/product-stock": "/product-stock/list",
  "/product-stock.html": "/product-stock/list",
  "/product_stock/list": "/product-stock/list",
  "/stock-transfer.html": "/stock-transfer",
  "/transfer.html": "/transfer/list",
  "/additionalcharges/list": "/masters/additional-charges",
  "/masters-social-media.html": "/masters/social-media",
  "/social/list": "/masters/social-media",
  "/masters-agent-types.html": "/masters/agent-types",
  "/agent/role/list": "/masters/agent-types",
  "/masters-company-categories.html": "/masters/company-categories",
  "/company/category/list": "/masters/company-categories",
  "/masters-company-sectors.html": "/masters/company-sectors",
  "/company/sector/list": "/masters/company-sectors",
  "/masters-warehouses.html": "/masters/warehouses",
  "/warehouse/list": "/masters/warehouses",
  "/masters-billing-company.html": "/masters/billing-company",
  "/company/list": "/masters/billing-company",
  "/company/addedit": "/masters/billing-company",
  "/masters-technicians.html": "/masters/technicians",
  "/technician/list": "/masters/technicians",
  "/masters-bank.html": "/masters/banks",
  "/masters-banks.html": "/masters/banks",
  "/bank/list": "/masters/banks",
  "/masters/bank": "/masters/banks",
  "/trash.html": "/trash",
  "/tasks.html": "/tasks",
  "/technical-tasks": "/technical-task/list",
  "/technical-tasks.html": "/technical-task/list",
  "/marketing-tasks": "/marketing-task/list",
  "/marketing-tasks.html": "/marketing-task/list",
  // Both of these were already redirect-only stubs in the original.
  "/employee-detail.html": "/users",
  "/employee-form.html": "/users",
  "/org-chart": "/users",
  "/org-chart.html": "/users",
};

/**
 * Resolve any URL the app might be handed.
 */
export function resolveLegacyUrl(url: string): string {
  const absolute = url.startsWith("./") ? url.slice(1) : url;
  return LEGACY_REDIRECTS[absolute] ?? absolute;
}