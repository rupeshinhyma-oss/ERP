/**
 * Sidebar Navigation Structure and Page Titles for ERP_Main Control Plane.
 *
 * Defines the control plane navigation tree while reusing the exact
 * layout, group conventions, and styling patterns from Yinglima/Inhyma.
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
    label: "ERP MANAGEMENT",
    items: [
      { key: "erps", label: "ERP Registry", path: "/erps", icon: "server" },
      { key: "my-erps", label: "My ERPs (Launcher)", path: "/my-erps", icon: "layers" },
    ],
  },
  {
    label: "IDENTITY & ACCESS",
    items: [
      { key: "users", label: "Global Users", path: "/users", icon: "users" },
      { key: "memberships", label: "ERP Memberships", path: "/memberships", icon: "link" },
      { key: "conflicts", label: "Identity Conflicts", path: "/conflicts", icon: "alertTriangle" },
      { key: "authz", label: "Platform Roles", path: "/authz", icon: "shield", superAdminOnly: true },
    ],
  },
  {
    label: "INTEGRATION",
    items: [
      { key: "integration", label: "Integration Monitor", path: "/integration", icon: "activity" },
    ],
  },
  {
    label: "AUDIT & COMPLIANCE",
    items: [
      { key: "audit", label: "Global Audit", path: "/audit", icon: "fileText" },
    ],
  },
  {
    label: "REPORTING & SEARCH",
    items: [
      { key: "reporting", label: "Reports & Exports", path: "/reporting", icon: "barChart" },
      { key: "search", label: "Federated Search", path: "/search", icon: "search" },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      { key: "health", label: "Health & Settings", path: "/health", icon: "settings" },
    ],
  },
];

export const NAV_ITEMS_BY_KEY: Record<string, NavItem> = {};
for (const section of NAV_SECTIONS) {
  for (const item of section.items) {
    NAV_ITEMS_BY_KEY[item.key] = item;
  }
}

export const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "ERP Dashboard",
  "/erps": "ERP Registry",
  "/my-erps": "My Authorized ERPs",
  "/users": "Global Users",
  "/memberships": "ERP Memberships",
  "/conflicts": "Identity Linking Conflicts",
  "/authz": "Platform Roles & Permissions",
  "/integration": "Integration Control Panel",
  "/audit": "Global Audit Log",
  "/reporting": "Global Reporting & Export Jobs",
  "/search": "Federated Platform Search",
  "/health": "System Health & Settings",
  "/login": "Sign In",
  "/403": "Access Denied",
};
