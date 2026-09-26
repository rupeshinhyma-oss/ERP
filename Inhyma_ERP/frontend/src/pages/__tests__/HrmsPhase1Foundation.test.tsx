import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NAV_SECTIONS, PAGE_TITLES } from "@/lib/nav";
import { AttendancePage } from "@/pages/hrms/AttendancePage";
import { LeavePage } from "@/pages/hrms/LeavePage";
import { ExpensesPage } from "@/pages/hrms/ExpensesPage";
import { SiteVisitPage } from "@/pages/hrms/SiteVisitPage";
import { PayrollPage } from "@/pages/hrms/PayrollPage";
import { SetupPage } from "@/pages/hrms/SetupPage";

afterEach(() => {
  cleanup();
});

// Mock AppShell to keep unit tests fast and focused on page shells and activeKey
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

describe("HRMS Phase 1 — Foundation Tests", () => {
  describe("Phase 1 — Sidebar Navigation Structure", () => {
    it("includes HRMS section with exactly 6 modules in NAV_SECTIONS", () => {
      const hrmsSection = NAV_SECTIONS.find((s) => s.label === "HRMS");
      expect(hrmsSection).toBeDefined();
      expect(hrmsSection?.items).toHaveLength(6);

      const itemKeys = hrmsSection?.items.map((i) => i.key);
      expect(itemKeys).toEqual([
        "hrms-attendance",
        "hrms-leave",
        "hrms-expenses",
        "hrms-site-visit",
        "hrms-payroll",
        "hrms-setup",
      ]);

      const itemPaths = hrmsSection?.items.map((i) => i.path);
      expect(itemPaths).toEqual([
        "/hrms/attendance",
        "/hrms/leave",
        "/hrms/expenses",
        "/hrms/site-visit",
        "/hrms/payroll",
        "/hrms/setup",
      ]);

      const itemLabels = hrmsSection?.items.map((i) => i.label);
      expect(itemLabels).toEqual([
        "Attendance",
        "Leave",
        "Expense Management",
        "Site Visit",
        "Payroll",
        "Setup",
      ]);

      // Ensure no HRMS Dashboard submenu
      expect(itemLabels).not.toContain("HRMS Dashboard");
      expect(itemLabels).not.toContain("Dashboard");
    });

    it("has all HRMS page titles configured in PAGE_TITLES", () => {
      expect(PAGE_TITLES["hrms-attendance"]).toBe("Attendance");
      expect(PAGE_TITLES["hrms-leave"]).toBe("Leave");
      expect(PAGE_TITLES["hrms-expenses"]).toBe("Expense Management");
      expect(PAGE_TITLES["hrms-site-visit"]).toBe("Site Visit");
      expect(PAGE_TITLES["hrms-payroll"]).toBe("Payroll");
      expect(PAGE_TITLES["hrms-setup"]).toBe("HRMS Setup");
    });
  });

  describe("Phase 3 — Attendance Page Shell", () => {
    it("renders header, breadcrumbs, tabs and handles tab switching", () => {
      render(
        <MemoryRouter>
          <AttendancePage />
        </MemoryRouter>
      );

      // Verify activeKey passed to AppShell
      const shell = screen.getByTestId("app-shell");
      expect(shell.getAttribute("data-active-key")).toBe("hrms-attendance");

      // Verify header and subtitle
      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Attendance");
      expect(
        screen.getByText("Enterprise punch tracking, geofence verification, calendar, and regularization.")
      ).toBeDefined();

      // View Tab (Default)
      expect(screen.getByText("Punch Card Container")).toBeDefined();
      expect(screen.getByText("Punch functionality will be available here.")).toBeDefined();
      expect(screen.getByText("Monthly Calendar Container")).toBeDefined();
      expect(screen.getByText("Attendance calendar will appear here.")).toBeDefined();

      // Switch to Approval Tab
      const approvalTabBtn = screen.getByRole("button", { name: /approval/i });
      fireEvent.click(approvalTabBtn);

      expect(screen.getByText("Pending Requests")).toBeDefined();
      expect(screen.getByText("No Pending Requests")).toBeDefined();
      expect(screen.getByText("Approved Requests")).toBeDefined();
      expect(screen.getByText("No Approved Requests")).toBeDefined();

      // Switch to Settings Tab
      const settingsTabBtn = screen.getByRole("button", { name: /settings/i });
      fireEvent.click(settingsTabBtn);

      expect(screen.getByText("Attendance Policy Configuration")).toBeDefined();

      // Switch to Attendance Exemption sub-tab
      const exemptionSubTabBtn = screen.getByRole("button", { name: /attendance exemption/i });
      fireEvent.click(exemptionSubTabBtn);
      expect(screen.getByText("Attendance Exemption Management")).toBeDefined();

      // Switch to Overtime sub-tab
      const overtimeSubTabBtn = screen.getByRole("button", { name: /overtime/i });
      fireEvent.click(overtimeSubTabBtn);
      expect(screen.getByText("Overtime Calculation Rules")).toBeDefined();
    });
  });

  describe("Phase 4 — Leave Module Shell", () => {
    it("renders Leave Balance, Apply Leave, and Leave History sections", () => {
      render(
        <MemoryRouter>
          <LeavePage />
        </MemoryRouter>
      );

      const shell = screen.getByTestId("app-shell");
      expect(shell.getAttribute("data-active-key")).toBe("hrms-leave");

      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Leave");
      expect(screen.getByText("Leave Balance")).toBeDefined();
      expect(screen.getByText("Leave Balance Overview")).toBeDefined();
      expect(screen.getByText("Apply Leave")).toBeDefined();
      expect(screen.getByText("Leave Application Form")).toBeDefined();
      expect(screen.getByText("Leave History")).toBeDefined();
      expect(screen.getByText("No Leave History")).toBeDefined();
    });
  });

  describe("Phase 5 — Expense Management Shell", () => {
    it("renders Expense Summary, New Claim, and Recent Claims sections", () => {
      render(
        <MemoryRouter>
          <ExpensesPage />
        </MemoryRouter>
      );

      const shell = screen.getByTestId("app-shell");
      expect(shell.getAttribute("data-active-key")).toBe("hrms-expenses");

      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Expense Management");
      expect(screen.getByText("Expense Summary")).toBeDefined();
      expect(screen.getByText("Expense Claims Summary")).toBeDefined();
      expect(screen.getByText("New Claim")).toBeDefined();
      expect(screen.getByText("New Expense Claim Form")).toBeDefined();
      expect(screen.getByText("Recent Claims")).toBeDefined();
      expect(screen.getByText("No Recent Claims")).toBeDefined();
    });
  });

  describe("Phase 6 — Site Visit Shell", () => {
    it("renders Today's Visits, Active Visit, and Visit History sections", () => {
      render(
        <MemoryRouter>
          <SiteVisitPage />
        </MemoryRouter>
      );

      const shell = screen.getByTestId("app-shell");
      expect(shell.getAttribute("data-active-key")).toBe("hrms-site-visit");

      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Site Visit");
      expect(screen.getByText("Today's Visits")).toBeDefined();
      expect(screen.getByText("No Visits Scheduled Today")).toBeDefined();
      expect(screen.getByText("Active Visit")).toBeDefined();
      expect(screen.getByText("No Active Visit In Progress")).toBeDefined();
      expect(screen.getByText("Visit History")).toBeDefined();
      expect(screen.getByText("No Visit History Available")).toBeDefined();
    });
  });

  describe("Phase 7 — Payroll Shell", () => {
    it("renders Current Payslip, Salary Structure, and Payroll History sections", () => {
      render(
        <MemoryRouter>
          <PayrollPage />
        </MemoryRouter>
      );

      const shell = screen.getByTestId("app-shell");
      expect(shell.getAttribute("data-active-key")).toBe("hrms-payroll");

      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Payroll");
      expect(screen.getByText("Current Payslip")).toBeDefined();
      expect(screen.getByText("Current Payslip Statement")).toBeDefined();
      expect(screen.getByText("Salary Structure")).toBeDefined();
      expect(screen.getByText("Salary Structure Overview")).toBeDefined();
      expect(screen.getByText("Payroll History")).toBeDefined();
      expect(screen.getByText("No Payroll History Available")).toBeDefined();
    });
  });

  describe("Phase 8 — Setup Shell", () => {
    it("renders Leave Types, Expense Settings, and Geo Fencing tabs with switching", () => {
      render(
        <MemoryRouter>
          <SetupPage />
        </MemoryRouter>
      );

      const shell = screen.getByTestId("app-shell");
      expect(shell.getAttribute("data-active-key")).toBe("hrms-setup");

      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("HRMS Setup");

      // Tab 1: Leave Types (Default)
      expect(screen.getByText("Leave Types & Entitlements")).toBeDefined();
      expect(screen.getByText("Leave Types Configuration")).toBeDefined();

      // Switch to Tab 2: Expense Settings
      const expenseTabBtn = screen.getByRole("button", { name: /expense settings/i });
      fireEvent.click(expenseTabBtn);
      expect(screen.getByText("Expense Settings & Categories")).toBeDefined();
      expect(screen.getByText("Expense Policy Configuration")).toBeDefined();

      // Switch to Tab 3: Geo Fencing
      const geoFencingTabBtn = screen.getByRole("button", { name: /geo fencing/i });
      fireEvent.click(geoFencingTabBtn);
      expect(screen.getByText("Geo Fencing Parameters")).toBeDefined();
      expect(screen.getByText("Geofencing & Boundary Setup")).toBeDefined();
    });
  });
});
