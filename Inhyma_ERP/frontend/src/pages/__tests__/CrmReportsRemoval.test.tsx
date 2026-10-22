import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Navigate } from "react-router-dom";
import { NAV_SECTIONS } from "@/lib/nav";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/toast", () => ({
  useToast: () => vi.fn(),
}));

describe("CRM Reports & Analytics Removal Verification", () => {
  afterEach(() => {
    cleanup();
  });

  it("ensures NAV_SECTIONS CRM section does not contain Reports & Analytics", () => {
    const crmSection = NAV_SECTIONS.find((sec) => sec.label === "CRM");
    expect(crmSection).toBeDefined();
    const reportsItem = crmSection?.items.find(
      (item) => item.key === "crm-reports" || item.label.toLowerCase().includes("reports")
    );
    expect(reportsItem).toBeUndefined();
  });

  it("ensures unrelated ERP REPORTS section is untouched and contains its reports", () => {
    const reportsSection = NAV_SECTIONS.find((sec) => sec.label === "REPORTS");
    expect(reportsSection).toBeDefined();
    expect(reportsSection?.items.length).toBeGreaterThan(0);
    const generalReport = reportsSection?.items.find((item) => item.key === "reports-general");
    expect(generalReport).toBeDefined();
  });

  it("redirects direct access from /crm/reports to /crm/leads", () => {
    render(
      <MemoryRouter initialEntries={["/crm/reports"]}>
        <Routes>
          <Route path="/crm/reports" element={<Navigate to="/crm/leads" replace />} />
          <Route path="/crm/leads" element={<div data-testid="leads-page-1">CRM Leads Page</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId("leads-page-1")).toBeDefined();
  });

  it("redirects direct access from /crm/analytics to /crm/leads", () => {
    render(
      <MemoryRouter initialEntries={["/crm/analytics"]}>
        <Routes>
          <Route path="/crm/analytics" element={<Navigate to="/crm/leads" replace />} />
          <Route path="/crm/leads" element={<div data-testid="leads-page-2">CRM Leads Page</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId("leads-page-2")).toBeDefined();
  });
});
