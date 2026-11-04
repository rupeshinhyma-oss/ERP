import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NAV_SECTIONS, NAV_ITEMS_BY_KEY, PAGE_TITLES } from "@/lib/nav";
import { FinancialPlanningReportPage } from "@/pages/FinancialPlanningReportPage";
import { CargoOverviewPage } from "@/pages/CargoOverviewPage";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ activeKey, children }: { activeKey: string; children: React.ReactNode }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

describe("Financial Planning Report & Cargo Overview Modules", () => {
  afterEach(() => {
    cleanup();
  });

  it("registers Financial Planning Report and Cargo Overview under REPORTS in nav.ts with report.view permission", () => {
    const reportsSection = NAV_SECTIONS.find((s) => s.label === "REPORTS");
    expect(reportsSection).toBeDefined();

    const finItem = reportsSection?.items.find((i) => i.key === "reports-financial-planning");
    expect(finItem).toBeDefined();
    expect(finItem?.label).toBe("Financial Planning Report");
    expect(finItem?.path).toBe("/reports/financial-planning");
    expect(finItem?.permission).toBe("report.view");
    expect(NAV_ITEMS_BY_KEY["reports-financial-planning"]).toBeDefined();
    expect(PAGE_TITLES["reports-financial-planning"]).toBe("Financial Planning Report");

    const cargoItem = reportsSection?.items.find((i) => i.key === "reports-cargo-overview");
    expect(cargoItem).toBeDefined();
    expect(cargoItem?.label).toBe("Cargo Overview");
    expect(cargoItem?.path).toBe("/reports/cargo-overview");
    expect(cargoItem?.permission).toBe("report.view");
    expect(NAV_ITEMS_BY_KEY["reports-cargo-overview"]).toBeDefined();
    expect(PAGE_TITLES["reports-cargo-overview"]).toBe("Cargo Overview");
  });

  it("renders Financial Planning Report blank module shell cleanly", () => {
    render(
      <MemoryRouter initialEntries={["/reports/financial-planning"]}>
        <FinancialPlanningReportPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId("app-shell").getAttribute("data-active-key")).toBe("reports-financial-planning");
    expect(screen.getByRole("heading", { name: "Financial Planning Report" })).toBeTruthy();
    expect(screen.getByTestId("financial-planning-blank-canvas")).toBeTruthy();
  });

  it("renders Cargo Overview blank module shell cleanly", () => {
    render(
      <MemoryRouter initialEntries={["/reports/cargo-overview"]}>
        <CargoOverviewPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId("app-shell").getAttribute("data-active-key")).toBe("reports-cargo-overview");
    expect(screen.getByRole("heading", { name: "Cargo Overview" })).toBeTruthy();
    expect(screen.getByTestId("cargo-overview-blank-canvas")).toBeTruthy();
  });
});

