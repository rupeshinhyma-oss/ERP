/**
 * Sidebar Navigation Structure and Page Titles for ERP_Main Control Plane.
 *
 * Ecosystem navigation sections:
 * 1. Dashboard
 * 2. Users & Access
 * 3. Monitoring & Audit
 * 4. Settings
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
    label: "USERS & ACCESS",
    items: [
      { key: "users", label: "User & Access", path: "/access/users", icon: "users" },
    ],
  },
  {
    label: "MONITORING & AUDIT",
    items: [
      { key: "audit", label: "Global Audit Logs", path: "/monitoring/audit", icon: "fileText" },
    ],
  },
  {
    label: "SETTINGS",
    items: [
      { key: "settings-general", label: "ERP_Main Settings", path: "/settings", icon: "settings" },
    ],
  },
];

export const ACCESS_SECTION_TABS: NavItem[] = [
  { key: "users", label: "Global Users", path: "/access/users", icon: "users" },
  { key: "roles", label: "Roles", path: "/access/roles", icon: "userCheck", superAdminOnly: true },
  { key: "permissions", label: "Permissions", path: "/access/permissions", icon: "key", superAdminOnly: true },
];

export const NAV_ITEMS_BY_KEY: Record<string, NavItem> = {};
for (const section of NAV_SECTIONS) {
  for (const item of section.items) {
    NAV_ITEMS_BY_KEY[item.key] = item;
  }
}
for (const tab of ACCESS_SECTION_TABS) {
  if (!NAV_ITEMS_BY_KEY[tab.key]) {
    NAV_ITEMS_BY_KEY[tab.key] = tab;
  }
}

NAV_ITEMS_BY_KEY["erps"] = NAV_ITEMS_BY_KEY["erp-switcher"] || NAV_ITEMS_BY_KEY["erp-registry"];
NAV_ITEMS_BY_KEY["my-erps"] = NAV_ITEMS_BY_KEY["erp-switcher"];
NAV_ITEMS_BY_KEY["integration"] = NAV_ITEMS_BY_KEY["integrations"];
NAV_ITEMS_BY_KEY["health"] = NAV_ITEMS_BY_KEY["system-health"];
NAV_ITEMS_BY_KEY["authz"] = NAV_ITEMS_BY_KEY["roles"];
NAV_ITEMS_BY_KEY["reporting"] = { key: "reporting", label: "Reports & Exports", path: "/reporting", icon: "barChart" };
NAV_ITEMS_BY_KEY["search"] = { key: "search", label: "Federated Search", path: "/search", icon: "search" };
NAV_ITEMS_BY_KEY["access"] = NAV_ITEMS_BY_KEY["users"];

export const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "ERP Ecosystem Dashboard",
  
  // ERPs
  "/erps": "ERP Switcher",
  "/erps/switcher": "ERP Switcher",
  "/my-erps": "ERP Switcher",
  
  // Users & Access
  "/access": "Users & Access Control",
  "/access/users": "Global Users",
  "/users": "Global Users",
  "/access/roles": "Roles & Access Policies",
  "/authz": "Roles & Access Policies",
  "/access/permissions": "Platform Permissions",
  "/access/memberships": "ERP Memberships",
  "/memberships": "ERP Memberships",
  "/access/policies": "Roles & Access Policies",
  "/conflicts": "Identity Linking Conflicts",




  // Monitoring & Audit
  "/monitoring/audit": "Global Compliance Audit Log",
  "/audit": "Global Compliance Audit Log",

  // Settings
  "/settings": "Control Plane Settings",
  "/settings/general": "Control Plane Settings",

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
export const ORG_SECTION_TABS = getSectionTabs("ORGANIZATIONS");
export const INTEGRATION_SECTION_TABS = getSectionTabs("INTEGRATIONS");
export const SYNC_SECTION_TABS = getSectionTabs("SYNCHRONIZATION");
export const MONITORING_SECTION_TABS = getSectionTabs("MONITORING & AUDIT");
export const SETTINGS_SECTION_TABS = getSectionTabs("SETTINGS");

