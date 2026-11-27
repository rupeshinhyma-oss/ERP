import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PermissionMatrixEditor } from "../PermissionMatrixEditor";
import { PERMISSION_SECTIONS, groupPermissionsByModule } from "@/lib/permissionLabels";
import type { Permission } from "@/types";

const SAMPLE_PERMS: Permission[] = [
  { id: "1", code: "trash.view", module: "trash", description: "" },
  { id: "2", code: "warehouse.view", module: "warehouse", description: "" },
  { id: "3", code: "city.view", module: "city", description: "" },
  { id: "4", code: "user.view", module: "user", description: "" },
  { id: "5", code: "finance_report.view", module: "finance_report", description: "" },
  { id: "6", code: "planning.view", module: "planning", description: "" },
  { id: "7", code: "local_purchase.view", module: "local_purchase", description: "" },
  { id: "8", code: "sale_process.manage", module: "sale_process", description: "" },
  { id: "9", code: "sale_process.view", module: "sale_process", description: "" },
  { id: "10", code: "sale_process.create", module: "sale_process", description: "" },
  { id: "11", code: "product.view", module: "product", description: "" },
  { id: "12", code: "supplier.view", module: "supplier", description: "" },
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
