import { describe, it, expect } from "vitest";
import { NAV_SECTIONS } from "@/lib/nav";
import { ICONS, type IconKey } from "@/components/icons";

describe("Sidebar Navigation Icons Uniqueness", () => {
  it("ensures every top-level navigation item has a unique icon in NAV_SECTIONS", () => {
    const allItems = NAV_SECTIONS.flatMap((section) => section.items);
    const iconsUsed: string[] = allItems.map((item) => item.icon);

    const duplicateIcons = iconsUsed.filter(
      (icon, idx) => iconsUsed.indexOf(icon) !== idx
    );

    if (duplicateIcons.length > 0) {
      const itemsWithDuplicates = allItems
        .filter((item) => duplicateIcons.includes(item.icon))
        .map((item) => `${item.label} (${item.key} -> icon: ${item.icon})`);

      throw new Error(
        `Duplicate navigation icons found: [${Array.from(new Set(duplicateIcons)).join(", ")}].\n` +
          `Affected items:\n${itemsWithDuplicates.join("\n")}`
      );
    }

    expect(new Set(iconsUsed).size).toBe(allItems.length);
    expect(duplicateIcons).toHaveLength(0);
  });

  it("ensures every icon referenced in NAV_SECTIONS exists in ICONS map and is a valid component", () => {
    const allItems = NAV_SECTIONS.flatMap((section) => section.items);

    for (const item of allItems) {
      const Component = ICONS[item.icon as IconKey];
      expect(
        Component,
        `Icon "${item.icon}" used by item "${item.label}" must exist in ICONS map`
      ).toBeDefined();
      expect(typeof Component).toBe("function");
    }
  });

  it("ensures all specific renamed icons match domain expectations", () => {
    const findItem = (key: string) => {
      for (const section of NAV_SECTIONS) {
        const found = section.items.find((i) => i.key === key);
        if (found) return found;
      }
      return undefined;
    };

    expect(findItem("stock-adjustment")?.icon).toBe("sliders");
    expect(findItem("stock-transfer")?.icon).toBe("transfer");
    expect(findItem("import-purchases")?.icon).toBe("ship");
    expect(findItem("reports-re-order")?.icon).toBe("reorder");
    expect(findItem("reports-stock-transactions")?.icon).toBe("refresh");
    expect(findItem("reports-deleted-orders")?.icon).toBe("fileX");
    expect(findItem("reports-general")?.icon).toBe("pieChart");
    expect(findItem("hrms-attendance")?.icon).toBe("userCheck");
    expect(findItem("hrms-expenses")?.icon).toBe("receipt");
    expect(findItem("hrms-setup")?.icon).toBe("userCog");
    expect(findItem("effective-permissions")?.icon).toBe("key");
    expect(findItem("masters-group")?.icon).toBe("database");
  });
});
