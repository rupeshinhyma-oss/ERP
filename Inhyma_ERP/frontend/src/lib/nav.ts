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
    label: "TASK",
    items: [
      { key: "tasks", label: "Tasks", path: "/tasks", icon: "task" },
      { key: "technical-tasks", label: "Technical Tasks", path: "/technical-task/list", icon: "wrench" },
      { key: "technician-operations", label: "Technician Ops & Wallet", path: "/technician-operations", icon: "truck" },
    ],
  },
  {
    label: "CONTACT",
    items: [
      { key: "companies", label: "Companies", path: "/companies", icon: "building", permission: "company.view" },
      { key: "agents", label: "Agents", path: "/agents", icon: "user", permission: "agent.view" },
      { key: "industrial-zones", label: "Industrial Zones", path: "/industrial/zones/list", icon: "pin", permission: "zone.view" },
    ],
  },
  {
    label: "INVENTORY",
    items: [
      { key: "product-stock", label: "Product Stock", path: "/product-stock/list", icon: "stock", permission: "product.view" },
      { key: "stock-adjustment", label: "Stock Adjustment", path: "/stock-adjustment", icon: "sliders", permission: "product.view" },
      { key: "stock-transfer", label: "Stock Transfer", path: "/stock-transfer", icon: "transfer", permission: "product.view" },
      { key: "price-list", label: "Price List", path: "/price-list", icon: "creditCard", permission: "product.view" },
      { key: "masters-products", label: "Product Master", path: "/product/list", icon: "box", permission: "product.view" },
      { key: "product-gallery", label: "Product Gallery", path: "/product-gallery", icon: "image", permission: "productgallery.view" },
      { key: "masters-categories", label: "Categories", path: "/masters/categories", icon: "layers", permission: "category.view" },
      { key: "masters-subcategories", label: "Sub Categories", path: "/masters/subcategories", icon: "folderTree", permission: "subcategory.view" },
      { key: "masters-brands", label: "Brands", path: "/masters/brands", icon: "award", permission: "brand.view" },
    ],
  },
  {
    label: "SALE",
    items: [
      { key: "proforma", label: "Proforma", path: "/proforma-invoice/list", icon: "fileText" },
      { key: "sales-process", label: "Sales Process", path: "/sales/process", icon: "shoppingCart" },
      { key: "discount-payments", label: "Discount Payments", path: "/discount-payments/list", icon: "creditCard" },
    ],
  },
  {
    label: "PURCHASE",
    items: [
      { key: "local-purchases", label: "Local Purchase", path: "/purchase/localpurchase", icon: "shoppingBag", permission: "purchase.view" },
      { key: "import-purchases", label: "Import Purchase", path: "/purchase/importpurchase", icon: "ship", permission: "purchase.view" },
      { key: "purchase-suppliers", label: "Suppliers", path: "/purchase/suppliers", icon: "factory", permission: "supplier.view" },
    ],
  },
  {
    label: "REPORTS",
    items: [
      { key: "reports-re-order", label: "Re-Order", path: "/reports/re-order", icon: "reorder", permission: "report.view" },
      { key: "reports-stock-transactions", label: "Stock Transactions", path: "/reports/stock-transactions", icon: "refresh", permission: "report.view" },
      { key: "reports-deleted-orders", label: "Deleted Orders", path: "/reports/deleted-orders", icon: "fileX", permission: "report.view" },
      { key: "reports-general", label: "General Reports", path: "/reports/general", icon: "pieChart", permission: "report.view" },
    ],
  },
  {
    label: "HRMS",
    items: [
      { key: "hrms-attendance", label: "Attendance", path: "/hrms/attendance", icon: "userCheck", permission: "hrms.attendance" },
      { key: "hrms-leave", label: "Leave", path: "/hrms/leave", icon: "calendar", permission: "hrms.leave" },
      { key: "hrms-assets", label: "Asset Management", path: "/hrms/assets", icon: "barcode", permission: "hrms.assets" },
      { key: "hrms-expenses", label: "Expense Management", path: "/hrms/expenses", icon: "receipt", permission: "hrms.expenses" },
      { key: "hrms-site-visit", label: "Site Visit", path: "/hrms/site-visit", icon: "map", permission: "hrms.site_visits" },
      { key: "hrms-payroll", label: "Payroll", path: "/hrms/payroll", icon: "coins", permission: "hrms.payroll" },
      { key: "hrms-setup", label: "Setup", path: "/hrms/setup", icon: "userCog", permission: "hrms.setup" },
    ],
  },
  {
    label: "USER MANAGEMENT",
    items: [
      { key: "users", label: "Users", path: "/users", icon: "user", permission: "user.view" },
      { key: "positions", label: "Positions", path: "/positions", icon: "briefcase", permission: "position.view" },
      { key: "rbac", label: "Departments & Permissions", path: "/rbac", icon: "shield", permission: "roles_permissions.view" },
      { key: "effective-permissions", label: "Effective Permissions", path: "/effective-permissions", icon: "key", permission: "roles_permissions.view" },
    ],
  },
  {
    label: "SETTINGS",
    items: [
      {
        key: "masters-group",
        label: "Masters",
        icon: "database",
        children: [
          { key: "masters-cities", label: "Cities", path: "/masters/cities", permission: "city.view" },
          { key: "masters-districts", label: "Districts", path: "/masters/districts", permission: "district.view" },
          { key: "masters-states", label: "States", path: "/masters/states", permission: "state.view" },
          { key: "masters-countries", label: "Countries", path: "/masters/countries", permission: "country.view" },
          { key: "masters-currencies", label: "Currencies", path: "/masters/currencies", permission: "currency.view" },
          { key: "masters-taxes", label: "Taxes", path: "/masters/taxes", permission: "tax.view" },
          { key: "masters-price-list", label: "Price List Master", path: "/masters/price-list", permission: "product.view" },
          { key: "masters-additional-charges", label: "Additional Charges", path: "/masters/additional-charges", permission: "additionalcharge.view" },
          { key: "masters-social-media", label: "Social Media", path: "/masters/social-media", permission: "socialmedia.view" },
          { key: "masters-agent-types", label: "Agent Types", path: "/masters/agent-types", permission: "agenttype.view" },
          { key: "masters-company-categories", label: "Company Categories", path: "/masters/company-categories", permission: "companycategory.view" },
          { key: "masters-company-sectors", label: "Company Sectors", path: "/masters/company-sectors", permission: "companysector.view" },
          { key: "masters-supplier-types", label: "Supplier Types", path: "/masters/supplier-types", permission: "suppliertype.view" },
          { key: "masters-buyer-types", label: "Buyer Types", path: "/masters/buyer-types", permission: "buyertype.view" },
          { key: "masters-warehouses", label: "Warehouses", path: "/masters/warehouses", permission: "warehouse.view" },
          { key: "masters-uom", label: "UOM", path: "/masters/uom", permission: "uom.view" },
          { key: "masters-billing-company", label: "Billing Company", path: "/masters/billing-company", permission: "billingcompany.view" },
          { key: "masters-company-list", label: "Organization List", path: "/masters/company-list", permission: "organizationlist.view" },
          { key: "masters-technicians", label: "Technicians", path: "/masters/technicians", permission: "technician.view" },
          { key: "masters-banks", label: "Bank", path: "/masters/banks", permission: "bank.view" },
          { key: "masters-transport", label: "Transport", path: "/masters/transport", permission: "transport.view" },
          { key: "masters-payment-terms", label: "Payment Terms", path: "/masters/payment-terms", permission: "payment_term.view" },
          { key: "masters-lead-sources", label: "Lead Sources", path: "/masters/lead-sources", permission: "lead_source.view" },
          { key: "masters-adjustment-purpose", label: "Adjustment Purpose", path: "/masters/adjustment-purpose", permission: "adjustment_purpose.view" },
          { key: "masters-call-types", label: "Call Types", path: "/masters/call-types", permission: "call_type.view" },
        ],
      },
      { key: "organization", label: "ERP Settings", path: "/organization", icon: "settings", permission: "organization.manage" },
      { key: "audit", label: "Audit Log", path: "/audit", icon: "clock", permission: "audit.view" },
      { key: "trash", label: "Trash", path: "/trash", icon: "trash", permission: "trash.view" },
    ],
  },
  {
    label: "CALL LOG",
    items: [
      { key: "call-logs-follow-up", label: "Follow Up Logs", path: "/follow-up/list", icon: "phone" },
    ],
  },
  {
    label: "LEAD",
    items: [
      { key: "leads", label: "Leads", path: "/lead/list", icon: "clipboard" },
    ],
  },
];

export const PAGE_TITLES: Record<string, string> = {
  agents: "Agents",
  "industrial-zones": "Industrial Zones",
  leads: "Leads",
  "lead-list": "Leads",
  trash: "Trash Management",
  dashboard: "Dashboard",
  reports: "Reports & Analytics",
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
  organization: "ERP Settings",
  "erp-settings": "ERP Settings",
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
  "tasks-kanban": "Tasks Kanban Board",
  "tasks-calendar": "Tasks Calendar",

  // Masters from screenshot
  "masters-taxes": "Taxes",
  "masters-price-list": "Price List Management",
  "price-list": "Price List Management",
  "product-prices": "Price List Management",
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
  "follow-ups": "Follow Ups",
  "follow-up": "Follow Ups",
  "follow-up-list": "Follow Ups",
  "hrms-attendance": "Attendance",
  "hrms-leave": "Leave",
  "hrms-assets": "Asset Management",
  "hrms-expenses": "Expense Management",
  "hrms-site-visit": "Site Visit",
  "hrms-payroll": "Payroll",
  "hrms-setup": "HRMS Setup",
};

export const DEFAULT_BRAND_NAME = "ERP";

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
  "/suppliers.html": "/purchase/suppliers",
  "/supplier/list": "/purchase/suppliers",
  "/supplier": "/purchase/suppliers",
  "/suppliers": "/purchase/suppliers",
  "/purchase/suppliers": "/purchase/suppliers",
  "/inquiries.html": "/proforma-invoice/list",
  "/inquiries": "/proforma-invoice/list",
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
  "/purchase/local": "/purchase/localpurchase",
  "/purchase/local/list": "/purchase/localpurchase",
  "/purchase/local-purchase": "/purchase/localpurchase",
  "/purchase-order": "/purchase/localpurchase",
  "/purchase-order.html": "/purchase/localpurchase",
  "/purchase-order/list": "/purchase/localpurchase",
  "/purchase/import": "/purchase/importpurchase",
  "/purchase/import/list": "/purchase/importpurchase",
  "/purchase/import-purchase": "/purchase/importpurchase",
  "/purchase-order/import": "/purchase/importpurchase",
  "/purchase-order/import-purchase-list": "/purchase/importpurchase",
  "/product-stock": "/product-stock/list",
  "/product-stock.html": "/product-stock/list",
  "/product_stock/list": "/product-stock/list",
  "/transaction_report/list": "/reports/stock-transactions",
  "/transaction-report/list": "/reports/stock-transactions",
  "/delete_order_report/list": "/reports/deleted-orders",
  "/delete-order-report/list": "/reports/deleted-orders",
  "/product-reorder/list": "/reports/re-order",
  "/product_reorder/list": "/reports/re-order",
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
  "/planning": "/dashboard",
  "/planning.html": "/dashboard",
  "/trash.html": "/trash",
  "/tasks.html": "/tasks",
  "/technical-tasks": "/technical-task/list",
  "/technical-tasks.html": "/technical-task/list",
  // Both of these were already redirect-only stubs in the original.
  "/employee-detail.html": "/users",
  "/employee-form.html": "/users",
  "/org-chart": "/users",
  "/org-chart.html": "/users",
  "/lead/list.html": "/lead/list",
  "/leads.html": "/lead/list",
  "/leads": "/lead/list",
  "/lead": "/lead/list",
  "/leads/list": "/lead/list",
  "/technicians/gatepass": "/technician-operations?tab=gatepasses",
  "/technicians/wallet": "/technician-operations?tab=wallets",
  "/warranty": "/technician-operations?tab=warranty",
  "/technician-gatepass/list": "/technician-operations?tab=gatepasses",
  "/technician-wallet/list": "/technician-operations?tab=wallets",
  "/machine-warranty/list": "/technician-operations?tab=warranty",
};

/**
 * Resolve any URL the app might be handed.
 */
export function resolveLegacyUrl(url: string): string {
  const absolute = url.startsWith("./") ? url.slice(1) : url;
  return LEGACY_REDIRECTS[absolute] ?? absolute;
}