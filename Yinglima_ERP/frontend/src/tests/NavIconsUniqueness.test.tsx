import { describe, it, expect } from "vitest";
import { NAV_SECTIONS } from "@/lib/nav";
import { ICONS, type IconKey } from "@/components/icons";

describe("Yinglima Sidebar Navigation Icons Uniqueness", () => {
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
});
