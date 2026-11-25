import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PermissionMatrixEditor } from "../PermissionMatrixEditor";
import { PERMISSION_SECTIONS, groupPermissionsByModule } from "@/lib/permissionLabels";
import type { Permission } from "@/types";

const SAMPLE_PERMS: Permission[] = [
  { id: "1", code: "trash.view", module: "trash", page: "trash", action: "view", scope: "ALL", description: "" },
  { id: "2", code: "warehouse.view", module: "warehouse", page: "masters-warehouses", action: "view", scope: "ALL", description: "" },
  { id: "3", code: "city.view", module: "city", page: "masters-cities", action: "view", scope: "ALL", description: "" },
  { id: "4", code: "user.view", module: "user", page: "users", action: "view", scope: "ALL", description: "" },
  { id: "5", code: "finance_report.view", module: "finance_report", page: "finance-report", action: "view", scope: "ALL", description: "" },
  { id: "6", code: "planning.view", module: "planning", page: "planning", action: "view", scope: "ALL", description: "" },
  { id: "7", code: "local_purchase.view", module: "local_purchase", page: "local-purchases", action: "view", scope: "ALL", description: "" },
  { id: "8", code: "sale_process.manage", module: "sale_process", page: "sale-process", action: "manage", scope: "ALL", description: "" },
  { id: "9", code: "sale_process.view", module: "sale_process", page: "sale-process", action: "view", scope: "ALL", description: "" },
  { id: "10", code: "sale_process.create", module: "sale_process", page: "sale-process", action: "create", scope: "ALL", description: "" },
  { id: "11", code: "product.view", module: "product", page: "masters-products", action: "view", scope: "ALL", description: "" },
  { id: "12", code: "supplier.view", module: "supplier", page: "suppliers", action: "view", scope: "ALL", description: "" },
];

describe("Yinglima PermissionMatrixEditor left-sidebar navigation alignment", () => {
  afterEach(() => {
    cleanup();
  });

  it("orders PERMISSION_SECTIONS identically to Yinglima left sidebar navigation", () => {
    expect(PERMISSION_SECTIONS.map((s) => s.title)).toEqual([
      "CONTACT",
      "INVENTORY",
      "SALE",
      "PURCHASE",
      "PLANNING",
      "FINANCE",
      "USER MANAGEMENT",
      "SETTINGS — Masters",
      "SETTINGS — System",
    ]);
    const grouped = groupPermissionsByModule(SAMPLE_PERMS);
    expect(grouped.sale_process.map((p) => p.code)).toEqual([
      "sale_process.view",
      "sale_process.create",
      "sale_process.manage",
    ]);
  });

  it("renders section accordions in sidebar order (CONTACT -> INVENTORY -> SALE -> PURCHASE -> PLANNING -> FINANCE -> USER MANAGEMENT -> SETTINGS)", () => {
    const { container } = render(
      <PermissionMatrixEditor
        allPermissions={SAMPLE_PERMS}
        checkedCodes={new Set()}
        onToggleCode={vi.fn()}
        onSelectAllInModule={vi.fn()}
        onSelectAllInSection={vi.fn()}
        onSetAllCodes={vi.fn()}
      />
    );

    const text = container.textContent || "";
    const order = [
      "CONTACT",
      "INVENTORY",
      "SALE",
      "PURCHASE",
      "PLANNING",
      "FINANCE",
      "USER MANAGEMENT",
      "SETTINGS — Masters",
      "SETTINGS — System",
    ];
    for (let i = 0; i < order.length - 1; i++) {
      const a = text.indexOf(order[i]);
      const b = text.indexOf(order[i + 1]);
      expect(a).toBeGreaterThan(-1);
      expect(b).toBeGreaterThan(a);
    }
    expect(screen.getByText("Warehouses")).toBeTruthy();
  });
});
