import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImpExpDropdown } from "../ImportWizard";

describe("ImpExpDropdown", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders professional SVG icon badges for SAMPLE FILE, IMPORT, and EXPORT without emojis", () => {
    const onOpenImportPage = vi.fn();
    const onExportCsv = vi.fn();

    const { container } = render(
      <ImpExpDropdown
        apiBase="/companies"
        entityName="supplier"
        importHeaders={[{ key: "company_name", label: "Company Name", required: true }]}
        onSummary={vi.fn()}
        onError={vi.fn()}
        onComplete={vi.fn()}
        onExportCsv={onExportCsv}
        onOpenImportPage={onOpenImportPage}
      />
    );

    const trigger = screen.getByRole("button", { name: /Imp \/ Exp/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const menu = screen.getByRole("menu");
    expect(menu.textContent).not.toMatch(/[📄📥📤]/u);

    const sampleItem = screen.getByRole("menuitem", { name: "SAMPLE FILE" });
    const importItem = screen.getByRole("menuitem", { name: "IMPORT" });
    const exportItem = screen.getByRole("menuitem", { name: "EXPORT" });

    expect(sampleItem.querySelector(".imp-exp-icon-badge--sample svg")).toBeTruthy();
    expect(importItem.querySelector(".imp-exp-icon-badge--import svg")).toBeTruthy();
    expect(exportItem.querySelector(".imp-exp-icon-badge--export svg")).toBeTruthy();
    expect(container.querySelectorAll(".imp-exp-menu-item svg").length).toBe(3);

    fireEvent.click(importItem);
    expect(onOpenImportPage).toHaveBeenCalledTimes(1);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "EXPORT" }));
    expect(onExportCsv).toHaveBeenCalledTimes(1);
  });
});

