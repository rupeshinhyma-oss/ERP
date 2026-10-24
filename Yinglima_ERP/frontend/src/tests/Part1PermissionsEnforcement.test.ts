import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Auth } from "@/lib/auth";
import { NAV_SECTIONS } from "@/lib/nav";
import type { Profile } from "@/types";

// Helper to simulate AppShell's visibleSections filtering
function getVisibleNavKeys(profile: Profile | null): string[] {
  Auth.updateProfile(profile!);
  const isSuperAdmin = Boolean(
    profile && Array.isArray(profile.roles) && profile.roles.includes("super_admin")
  );

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items
      .map((item) => {
        if (item.children) {
          const visibleChildren = item.children.filter((child) => {
            if (child.superAdminOnly && !isSuperAdmin) return false;
            return !child.permission || Auth.hasPermission(child.permission);
          });
          return { ...item, children: visibleChildren };
        }
        return item;
      })
      .filter((item) => {
        if (item.children) return item.children.length > 0;
        if (item.superAdminOnly && !isSuperAdmin) return false;
        return !item.permission || Auth.hasPermission(item.permission);
      }),
  })).filter((section) => section.items.length > 0);

  const keys: string[] = [];
  for (const sec of visibleSections) {
    for (const item of sec.items) {
      keys.push(item.key);
      if (item.children) {
        for (const child of item.children) {
          keys.push(child.key);
        }
      }
    }
  }
  return keys;
}

describe("Part 1: Dynamic Permission-Based Visibility Testing", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    Auth.clear();
    localStorage.clear();
  });

  /* -------------------------------------------------------------------------- */
  /* Scenario 1: Super Admin (Unrestricted Access)                             */
  /* -------------------------------------------------------------------------- */
  it("Scenario 1: Super Admin sees all navigation items and has all actions enabled", () => {
    const superAdminProfile: Profile = {
      id: "admin-1",
      username: "admin",
      email: "admin@yinglima.com",
      full_name: "Super Admin",
      roles: ["super_admin"],
      permissions: [],
    };
    Auth.updateProfile(superAdminProfile);

    // 1. Navigation visibility
    const visibleKeys = getVisibleNavKeys(superAdminProfile);
    expect(visibleKeys).toContain("sale-process");
    expect(visibleKeys).toContain("stock-movement");
    expect(visibleKeys).toContain("notification-settings");
    expect(visibleKeys).toContain("positions");

    // 2. Sale Process action permissions
    expect(Auth.hasPermission("sale_process.view")).toBe(true);
    expect(Auth.hasPermission("sale_process.create")).toBe(true);
    expect(Auth.hasPermission("sale_process.update")).toBe(true);
    expect(Auth.hasPermission("sale_process.approve")).toBe(true);
    expect(Auth.hasPermission("sale_process.delete")).toBe(true);
    expect(Auth.hasPermission("sale_process.export")).toBe(true);

    // 3. Stock Movement action permissions
    expect(Auth.hasPermission("stock_movement.view")).toBe(true);
    expect(Auth.hasPermission("stock_movement.create")).toBe(true);
    expect(Auth.hasPermission("stock_movement.cancel")).toBe(true);
    expect(Auth.hasPermission("stock_movement.delete")).toBe(true);

    // 4. Notification Settings action permissions
    expect(Auth.hasPermission("notification_settings.view")).toBe(true);
    expect(Auth.hasPermission("notification_settings.manage")).toBe(true);
  });

  /* -------------------------------------------------------------------------- */
  /* Scenario 2: View-Only User                                                 */
  /* -------------------------------------------------------------------------- */
  it("Scenario 2: View-Only user sees menus but action buttons (Create, Edit, Delete) are denied", () => {
    const viewOnlyProfile: Profile = {
      id: "viewer-1",
      username: "viewer",
      email: "viewer@yinglima.com",
      full_name: "Viewer Employee",
      roles: ["user"],
      permissions: [
        "sale_process.view",
        "stock_movement.view",
        "notification_settings.view",
        "position.view",
      ],
    };
    Auth.updateProfile(viewOnlyProfile);

    // 1. Navigation items show in sidebar
    const visibleKeys = getVisibleNavKeys(viewOnlyProfile);
    expect(visibleKeys).toContain("sale-process");
    expect(visibleKeys).toContain("stock-movement");
    expect(visibleKeys).toContain("notification-settings");
    expect(visibleKeys).toContain("positions");

    // 2. Sale Process buttons:
    // View is granted, but Create, Update, Delete, Export are strictly false (hidden by <Can>)
    expect(Auth.hasPermission("sale_process.view")).toBe(true);
    expect(Auth.hasPermission("sale_process.create")).toBe(false);
    expect(Auth.hasPermission("sale_process.update")).toBe(false);
    expect(Auth.hasPermission("sale_process.approve")).toBe(false);
    expect(Auth.hasPermission("sale_process.delete")).toBe(false);
    expect(Auth.hasPermission("sale_process.export")).toBe(false);

    // 3. Stock Movement buttons:
    // View is granted, but New Inward/Outward, Cancel, Delete are false (hidden by <Can>)
    expect(Auth.hasPermission("stock_movement.view")).toBe(true);
    expect(Auth.hasPermission("stock_movement.create")).toBe(false);
    expect(Auth.hasPermission("stock_movement.cancel")).toBe(false);
    expect(Auth.hasPermission("stock_movement.delete")).toBe(false);

    // 4. Notification Settings:
    // View is granted, but Manage is false (renders "🔒 Read Only" badge, disables toggles)
    expect(Auth.hasPermission("notification_settings.view")).toBe(true);
    expect(Auth.hasPermission("notification_settings.manage")).toBe(false);
  });

  /* -------------------------------------------------------------------------- */
  /* Scenario 3: Restricted User with ZERO Part 1 permissions                   */
  /* -------------------------------------------------------------------------- */
  it("Scenario 3: Restricted User does not see Part 1 items in sidebar at all", () => {
    const restrictedProfile: Profile = {
      id: "restricted-1",
      username: "restricted",
      email: "restricted@yinglima.com",
      full_name: "Restricted Employee",
      roles: ["user"],
      permissions: [
        "supplier.view",
        "buyer.view",
      ],
    };
    Auth.updateProfile(restrictedProfile);

    // Navigation items MUST NOT appear in the sidebar
    const visibleKeys = getVisibleNavKeys(restrictedProfile);
    expect(visibleKeys).not.toContain("sale-process");
    expect(visibleKeys).not.toContain("stock-movement");
    expect(visibleKeys).not.toContain("notification-settings");
    expect(visibleKeys).not.toContain("positions");

    // Allowed other modules still visible
    expect(visibleKeys).toContain("suppliers");
    expect(visibleKeys).toContain("buyers");

    // All Part 1 permissions are false
    expect(Auth.hasPermission("sale_process.view")).toBe(false);
    expect(Auth.hasPermission("stock_movement.view")).toBe(false);
    expect(Auth.hasPermission("notification_settings.view")).toBe(false);
    expect(Auth.hasPermission("position.view")).toBe(false);
  });

  /* -------------------------------------------------------------------------- */
  /* Scenario 4: Granular Operational Access (e.g. Sales Operator)              */
  /* -------------------------------------------------------------------------- */
  it("Scenario 4: Granular Sales Operator can Create and Edit but CANNOT Delete or Export", () => {
    const operatorProfile: Profile = {
      id: "operator-1",
      username: "operator",
      email: "operator@yinglima.com",
      full_name: "Sales Operator",
      roles: ["user"],
      permissions: [
        "sale_process.view",
        "sale_process.create",
        "sale_process.update",
      ],
    };
    Auth.updateProfile(operatorProfile);

    // Sidebar shows Sale Process
    const visibleKeys = getVisibleNavKeys(operatorProfile);
    expect(visibleKeys).toContain("sale-process");
    expect(visibleKeys).not.toContain("stock-movement");
    expect(visibleKeys).not.toContain("notification-settings");

    // Actions:
    // Create & Update are allowed
    expect(Auth.hasPermission("sale_process.create")).toBe(true);
    expect(Auth.hasPermission("sale_process.update")).toBe(true);

    // Delete, Export, Approve are strictly denied
    expect(Auth.hasPermission("sale_process.delete")).toBe(false);
    expect(Auth.hasPermission("sale_process.export")).toBe(false);
    expect(Auth.hasPermission("sale_process.approve")).toBe(false);
  });

  /* -------------------------------------------------------------------------- */
  /* Scenario 5: Stock Clerk (Can Record Inward/Outward but CANNOT Cancel/Delete) */
  /* -------------------------------------------------------------------------- */
  it("Scenario 5: Stock Clerk can record Inward/Outward entries but CANNOT Cancel or Delete movements", () => {
    const stockClerkProfile: Profile = {
      id: "clerk-1",
      username: "clerk",
      email: "stock@yinglima.com",
      full_name: "Stock Clerk",
      roles: ["user"],
      permissions: [
        "stock_movement.view",
        "stock_movement.create",
      ],
    };
    Auth.updateProfile(stockClerkProfile);

    // Sidebar shows Stock Movement
    const visibleKeys = getVisibleNavKeys(stockClerkProfile);
    expect(visibleKeys).toContain("stock-movement");
    expect(visibleKeys).not.toContain("sale-process");

    // Actions:
    expect(Auth.hasPermission("stock_movement.view")).toBe(true);
    expect(Auth.hasPermission("stock_movement.create")).toBe(true);

    // High-risk actions are denied
    expect(Auth.hasPermission("stock_movement.cancel")).toBe(false);
    expect(Auth.hasPermission("stock_movement.delete")).toBe(false);
  });

  /* -------------------------------------------------------------------------- */
  /* Scenario 6: Notification Admin (Can View and Edit Rules)                   */
  /* -------------------------------------------------------------------------- */
  it("Scenario 6: Notification Admin can view and manage notification rules", () => {
    const notifAdminProfile: Profile = {
      id: "notif-1",
      username: "notif_admin",
      email: "notif@yinglima.com",
      full_name: "Notification Manager",
      roles: ["user"],
      permissions: [
        "notification_settings.view",
        "notification_settings.manage",
      ],
    };
    Auth.updateProfile(notifAdminProfile);

    const visibleKeys = getVisibleNavKeys(notifAdminProfile);
    expect(visibleKeys).toContain("notification-settings");

    expect(Auth.hasPermission("notification_settings.view")).toBe(true);
    expect(Auth.hasPermission("notification_settings.manage")).toBe(true);
  });
});
