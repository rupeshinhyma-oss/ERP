/**
 * Sidebar Navigation Structure and Page Titles for ERP_Main Control Plane.
 *
 * Implements the 8 primary ecosystem navigation sections:
 * 1. Dashboard
 * 2. ERPs
 * 3. Users & Access
 * 4. Organizations
 * 5. Integrations
 * 6. Synchronization
 * 7. Monitoring & Audit
 * 8. Settings
 */

import type { IconKey } from "@/components/icons";

export interface NavItem {
  key: string;
  label: string;
  path: string;
  icon: IconKey;
  permission?: string;
  superAdminOnly?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const DEFAULT_BRAND_NAME = "ERP Dashboard";

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "DASHBOARD",
    items: [
      { key: "dashboard", label: "Dashboard", path: "/dashboard", icon: "dashboard" },
    ],
  },
  {
    label: "ERPS",
    items: [
      { key: "erp-switcher", label: "ERP Switcher", path: "/erps/switcher", icon: "layers" },
      { key: "erp-registry", label: "ERP Registry", path: "/erps/registry", icon: "server" },
      { key: "erp-instances", label: "ERP Instances", path: "/erps/instances", icon: "cpu" },
      { key: "erp-modules", label: "ERP Modules", path: "/erps/modules", icon: "package" },
    ],
  },
  {
    label: "USERS & ACCESS",
    items: [
      { key: "users", label: "Global Users", path: "/access/users", icon: "users" },
      { key: "roles", label: "Roles", path: "/access/roles", icon: "userCheck", superAdminOnly: true },
      { key: "permissions", label: "Permissions", path: "/access/permissions", icon: "key", superAdminOnly: true },
      { key: "memberships", label: "ERP Memberships", path: "/access/memberships", icon: "link" },
      { key: "access-policies", label: "Access Policies", path: "/access/policies", icon: "lock", superAdminOnly: true },
    ],
  },
  {
    label: "ORGANIZATIONS",
    items: [
      { key: "companies", label: "Companies", path: "/organizations/companies", icon: "building" },
      { key: "organizations", label: "Organizations", path: "/organizations", icon: "orgChart" },
      { key: "departments", label: "Departments", path: "/organizations/departments", icon: "briefcase" },
      { key: "business-units", label: "Business Units", path: "/organizations/business-units", icon: "factory" },
    ],
  },
  {
    label: "INTEGRATIONS",
    items: [
      { key: "integrations", label: "Integrations", path: "/integrations", icon: "network" },
      { key: "subscriptions", label: "Subscriptions", path: "/integrations/subscriptions", icon: "rss" },
      { key: "integration-events", label: "Integration Events", path: "/integrations/events", icon: "zap" },
      { key: "delivery-status", label: "Delivery Status", path: "/integrations/deliveries", icon: "send" },
      { key: "failed-events", label: "Failed Events", path: "/integrations/failed", icon: "alertCircle" },
      { key: "dead-letter-queue", label: "Dead Letter Queue", path: "/integrations/dlq", icon: "trash" },
    ],
  },
  {
    label: "SYNCHRONIZATION",
    items: [
      { key: "sync-policies", label: "Sync Policies", path: "/sync/policies", icon: "sliders" },
      { key: "data-ownership", label: "Data Ownership", path: "/sync/ownership", icon: "shield" },
      { key: "entity-mappings", label: "Entity Mappings", path: "/sync/mappings", icon: "arrowLeftRight" },
      { key: "reconciliation", label: "Reconciliation", path: "/sync/reconciliation", icon: "scale" },
      { key: "conflicts", label: "Conflicts", path: "/sync/conflicts", icon: "alertTriangle" },
      { key: "repair-replay", label: "Repair / Replay", path: "/sync/repair", icon: "refresh" },
      { key: "snapshots", label: "Snapshots", path: "/sync/snapshots", icon: "camera" },
    ],
  },
  {
    label: "MONITORING & AUDIT",
    items: [
      { key: "system-health", label: "System Health", path: "/monitoring/system", icon: "activity" },
      { key: "erp-health", label: "ERP Health", path: "/monitoring/erps", icon: "heart" },
      { key: "queue-health", label: "Queue Health", path: "/monitoring/queue", icon: "database" },
      { key: "realtime-connections", label: "Realtime Connections", path: "/monitoring/realtime", icon: "radio" },
      { key: "workers", label: "Workers", path: "/monitoring/workers", icon: "terminal" },
      { key: "alerts", label: "Alerts", path: "/monitoring/alerts", icon: "bell" },
      { key: "audit", label: "Global Audit Logs", path: "/monitoring/audit", icon: "fileText" },
      { key: "security-events", label: "Security Events", path: "/monitoring/security", icon: "eye" },
    ],
  },
  {
    label: "SETTINGS",
    items: [
      { key: "settings-general", label: "ERP_Main Settings", path: "/settings", icon: "settings" },
      { key: "settings-security", label: "Security & Federation", path: "/settings/security", icon: "globe" },
      { key: "settings-sessions", label: "Active Sessions", path: "/settings/sessions", icon: "monitor" },
      { key: "settings-notifications", label: "Notifications", path: "/settings/notifications", icon: "mail" },
    ],
  },
];

export const NAV_ITEMS_BY_KEY: Record<string, NavItem> = {};
for (const section of NAV_SECTIONS) {
  for (const item of section.items) {
    NAV_ITEMS_BY_KEY[item.key] = item;
  }
}

// Support legacy keys in NAV_ITEMS_BY_KEY for backwards compatibility
NAV_ITEMS_BY_KEY["erps"] = NAV_ITEMS_BY_KEY["erp-registry"];
NAV_ITEMS_BY_KEY["my-erps"] = NAV_ITEMS_BY_KEY["erp-switcher"];
NAV_ITEMS_BY_KEY["integration"] = NAV_ITEMS_BY_KEY["integrations"];
NAV_ITEMS_BY_KEY["health"] = NAV_ITEMS_BY_KEY["system-health"];
NAV_ITEMS_BY_KEY["authz"] = NAV_ITEMS_BY_KEY["roles"];
NAV_ITEMS_BY_KEY["reporting"] = { key: "reporting", label: "Reports & Exports", path: "/reporting", icon: "barChart" };
NAV_ITEMS_BY_KEY["search"] = { key: "search", label: "Federated Search", path: "/search", icon: "search" };

export const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "ERP Ecosystem Dashboard",
  
  // ERPs
  "/erps": "ERP Registry",
  "/erps/registry": "ERP Registry",
  "/erps/switcher": "ERP Switcher (Authorized ERPs)",
  "/my-erps": "ERP Switcher (Authorized ERPs)",
  "/erps/instances": "ERP Runtime Instances",
  "/erps/modules": "ERP Module Catalog",
  
  // Users & Access
  "/access": "Users & Access Control",
  "/access/users": "Global Users Directory",
  "/users": "Global Users Directory",
  "/access/roles": "Platform Roles",
  "/authz": "Platform Roles & Permissions",
  "/access/permissions": "Platform Permissions",
  "/access/memberships": "ERP Memberships",
  "/memberships": "ERP Memberships",
  "/access/policies": "Platform Access Policies",
  "/conflicts": "Identity Linking Conflicts",

  // Organizations
  "/organizations": "Ecosystem Organizations & Structure",
  "/organizations/companies": "Operating Companies",
  "/organizations/departments": "Department Directory",
  "/organizations/business-units": "Business Units",

  // Integrations
  "/integrations": "ERP Integration Network",
  "/integration": "ERP Integration Network",
  "/integrations/subscriptions": "Event Routing Subscriptions",
  "/integrations/events": "Integration Events Directory",
  "/integrations/deliveries": "Event Delivery Lifecycle Status",
  "/integrations/failed": "Failed Deliveries & Retries",
  "/integrations/dlq": "Dead Letter Queue & Operations",

  // Synchronization
  "/sync": "Cross-ERP Data Synchronization",
  "/sync/policies": "Entity Synchronization Policies",
  "/sync/ownership": "Data Authoritative Ownership",
  "/sync/mappings": "Cross-ERP Entity ID Mappings",
  "/sync/reconciliation": "Data Reconciliation",
  "/sync/conflicts": "Synchronization Conflicts",
  "/sync/repair": "Event Repair & Replay Operations",
  "/sync/snapshots": "Data Projection Snapshots",

  // Monitoring & Audit
  "/monitoring": "System & Ecosystem Monitoring",
  "/monitoring/system": "Platform Subsystem Health",
  "/health": "Platform Subsystem Health",
  "/monitoring/erps": "ERP Node Health & Heartbeats",
  "/monitoring/queue": "Durable Queue & Outbox Health",
  "/monitoring/realtime": "Realtime WebSocket Connections",
  "/monitoring/workers": "Background Workers Status",
  "/monitoring/alerts": "Actionable Operational Alerts",
  "/monitoring/audit": "Global Compliance Audit Log",
  "/audit": "Global Compliance Audit Log",
  "/monitoring/security": "Security Events & Access Audits",

  // Settings
  "/settings": "Control Plane Settings",
  "/settings/security": "Security & OIDC Federation",
  "/settings/sessions": "Active Platform Sessions",
  "/settings/notifications": "Alert & Webhook Notifications",

  // Reports & Search
  "/reporting": "Global Reporting & Export Jobs",
  "/search": "Universal Federated Search",
  "/login": "Sign In",
  "/403": "Access Denied",
};

export function getSectionTabs(sectionLabel: string): NavItem[] {
  const section = NAV_SECTIONS.find(
    (s) => s.label.toUpperCase() === sectionLabel.toUpperCase()
  );
  return section ? section.items : [];
}

export const ERP_SECTION_TABS = getSectionTabs("ERPS");
export const ACCESS_SECTION_TABS = getSectionTabs("USERS & ACCESS");
export const ORG_SECTION_TABS = getSectionTabs("ORGANIZATIONS");
export const INTEGRATION_SECTION_TABS = getSectionTabs("INTEGRATIONS");
export const SYNC_SECTION_TABS = getSectionTabs("SYNCHRONIZATION");
export const MONITORING_SECTION_TABS = getSectionTabs("MONITORING & AUDIT");
export const SETTINGS_SECTION_TABS = getSectionTabs("SETTINGS");

