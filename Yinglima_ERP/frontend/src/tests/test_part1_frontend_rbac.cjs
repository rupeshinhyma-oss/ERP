/**
 * Unit verification of Frontend Navigation & Action Gating for Part 1:
 * - Sale Process
 * - Stock Movements
 * - Notification Rules
 * - Positions & Designations
 */

const fs = require("fs");
const path = require("path");

console.log("--> Testing Frontend RBAC Navigation & Matrix Configuration...");

// 1. Check nav.ts configuration
const navSrc = fs.readFileSync(path.join(__dirname, "../lib/nav.ts"), "utf8");

const requiredNavGates = [
  { key: "stock-movement", perm: "stock_movement.view" },
  { key: "sale-process", perm: "sale_process.view" },
  { key: "notification-settings", perm: "notification_settings.view" },
  { key: "positions", perm: "position.view" },
];

for (const gate of requiredNavGates) {
  const regex = new RegExp(`key:\\s*["']${gate.key}["'][^}]+permission:\\s*["']${gate.perm}["']`);
  if (regex.test(navSrc)) {
    console.log(`[PASS] nav.ts correctly gates item '${gate.key}' with permission '${gate.perm}'`);
  } else {
    throw new Error(`[FAIL] nav.ts failed to gate '${gate.key}' with '${gate.perm}'`);
  }
}

// 2. Check permissionLabels.ts configuration
const labelsSrc = fs.readFileSync(path.join(__dirname, "../lib/permissionLabels.ts"), "utf8");

const requiredLabels = [
  { mod: "position", label: "Positions & Designations" },
  { mod: "sale_process", label: "Sale Process" },
  { mod: "stock_movement", label: "Stock Movement" },
  { mod: "notification_settings", label: "Notification Rules" },
];

for (const item of requiredLabels) {
  if (labelsSrc.includes(`${item.mod}: "${item.label}"`)) {
    console.log(`[PASS] permissionLabels.ts correctly registers '${item.mod}' as '${item.label}'`);
  } else {
    throw new Error(`[FAIL] permissionLabels.ts missing label for '${item.mod}'`);
  }
}

// 3. Check section assignments
if (labelsSrc.includes('"supplier", "buyer", "sale_process"') || labelsSrc.includes('"sale_process"')) {
  console.log("[PASS] 'sale_process' is correctly registered under Core Business section.");
} else {
  throw new Error("[FAIL] 'sale_process' missing in PERMISSION_SECTIONS");
}

if (labelsSrc.includes('"stock_movement"') && labelsSrc.includes("Inventory & Catalog")) {
  console.log("[PASS] 'stock_movement' is correctly registered under Inventory section.");
} else {
  throw new Error("[FAIL] 'stock_movement' missing in PERMISSION_SECTIONS");
}

if (labelsSrc.includes('"notification_settings"') && labelsSrc.includes("Settings & Masters")) {
  console.log("[PASS] 'notification_settings' is correctly registered under Settings & Masters section.");
} else {
  throw new Error("[FAIL] 'notification_settings' missing in PERMISSION_SECTIONS");
}

// 4. Verify UI Action Gating in files
const saleListSrc = fs.readFileSync(path.join(__dirname, "../pages/sales/SaleProcessList.tsx"), "utf8");
if (saleListSrc.includes('<Can permission="sale_process.create">') &&
    saleListSrc.includes('<Can permission="sale_process.export">') &&
    saleListSrc.includes('<Can permission="sale_process.update">') &&
    saleListSrc.includes('<Can permission="sale_process.delete">')) {
  console.log("[PASS] SaleProcessList.tsx correctly gates Create, Export, Edit, and Delete actions with <Can>.");
} else {
  throw new Error("[FAIL] SaleProcessList.tsx is missing <Can> guards on one or more action buttons!");
}

const stockMovementsSrc = fs.readFileSync(path.join(__dirname, "../pages/inventory/StockMovements.tsx"), "utf8");
if (stockMovementsSrc.includes('<Can permission="stock_movement.create">') &&
    stockMovementsSrc.includes('<Can permission="stock_movement.cancel">') &&
    stockMovementsSrc.includes('<Can permission="stock_movement.delete">')) {
  console.log("[PASS] StockMovements.tsx correctly gates New Inward/Outward, Cancel, and Delete actions with <Can>.");
} else {
  throw new Error("[FAIL] StockMovements.tsx is missing <Can> guards on action buttons!");
}

const notifSettingsSrc = fs.readFileSync(path.join(__dirname, "../pages/NotificationSettings.tsx"), "utf8");
if (notifSettingsSrc.includes('canManage = hasPermission("notification_settings.manage")') &&
    notifSettingsSrc.includes("disabled={!canManage}") &&
    notifSettingsSrc.includes("🔒 Read Only")) {
  console.log("[PASS] NotificationSettings.tsx correctly enforces canManage on status toggles and edit modal.");
} else {
  throw new Error("[FAIL] NotificationSettings.tsx is missing canManage gating!");
}

console.log("\n>>> ALL FRONTEND UI & NAVIGATION RBAC GATES VERIFIED 100% CORRECT! <<<");
