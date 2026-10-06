import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PayrollPage } from "@/pages/hrms/PayrollPage";
import { generatePayslipPdf, formatInr } from "@/lib/payrollPayslipPdf";

afterEach(() => {
  cleanup();
});

// Mock AppShell to keep test isolated and super fast
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock API client
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  errorMessage: (err: any) => err?.message || "Error",
}));

let mockCurrentUser = {
  id: "admin-uuid-1",
  username: "admin",
  role: "ADMIN",
  full_name: "Admin User",
  permissions: ["*"],
};

vi.mock("@/lib/hooks", () => ({
  useAuth: () => ({
    profile: mockCurrentUser,
    isSuperAdmin: true,
    isAuthenticated: true,
    hasPermission: () => true,
  }),
}));

const mockToast = vi.fn();
vi.mock("@/lib/toast", () => ({
  useToast: () => mockToast,
}));

import { apiGet, apiPost } from "@/lib/api";

describe("HRMS Payroll Module — Comprehensive Frontend Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/components")) {
        return Promise.resolve({
          data: [
            {
              id: "comp-1",
              name: "Basic Salary",
              code: "BASIC",
              component_type: "EARNING",
              calculation_type: "PERCENTAGE_OF_CTC",
              value: 50.0,
              is_active: true,
              display_order: 1,
            },
            {
              id: "comp-2",
              name: "House Rent Allowance (HRA)",
              code: "HRA",
              component_type: "EARNING",
              calculation_type: "PERCENTAGE_OF_BASIC",
              value: 40.0,
              is_active: true,
              display_order: 2,
            },
            {
              id: "comp-3",
              name: "Provident Fund (PF)",
              code: "PF",
              component_type: "DEDUCTION",
              calculation_type: "PERCENTAGE_OF_BASIC",
              value: 12.0,
              is_active: true,
              display_order: 3,
            },
            {
              id: "comp-4",
              name: "Professional Tax (PT)",
              code: "PT",
              component_type: "DEDUCTION",
              calculation_type: "FIXED",
              value: 200.0,
              is_active: true,
              display_order: 4,
            },
          ],
        });
      }
      if (url.includes("/employees")) {
        return Promise.resolve({
          data: [
            {
              employee_id: "emp-101",
              employee_code: "EMP-001",
              employee_name: "Rahul Sharma",
              department: "Engineering",
              designation: "Software Engineer",
              annual_ctc: 420000,
              monthly_ctc: 35000,
              effective_from: "2026-04-01",
              has_salary: true,
              revision_count: 2,
              status: "ACTIVE",
            },
            {
              employee_id: "emp-102",
              employee_code: "EMP-002",
              employee_name: "Priya Verma",
              department: "Operations",
              designation: "HR Associate",
              annual_ctc: 360000,
              monthly_ctc: 30000,
              effective_from: "2026-04-01",
              has_salary: true,
              revision_count: 1,
              status: "ACTIVE",
            },
          ],
        });
      }
      if (url.includes("/salary/history/")) {
        return Promise.resolve({
          data: [
            {
              id: "sal-rev-1",
              employee_id: "emp-101",
              annual_ctc: 420000,
              monthly_ctc: 35000,
              effective_from: "2026-10-01",
              is_active: true,
              created_at: "2026-10-01T10:00:00Z",
              notes: "Annual increment",
            },
          ],
        });
      }
      if (url.includes("/monthly/")) {
        return Promise.resolve({
          data: {
            id: "pr-oct-2026",
            payroll_month: "2026-10",
            payroll_year: 2026,
            status: "PROCESSED",
            total_gross: 65000,
            total_net: 58000,
            total_deductions: 7000,
            employee_count: 2,
            items: [
              {
                id: "item-1",
                payroll_id: "pr-oct-2026",
                employee_id: "emp-101",
                employee_code: "EMP-001",
                employee_name: "Rahul Sharma",
                department: "Engineering",
                designation: "Software Engineer",
                annual_ctc: 420000,
                monthly_ctc: 35000,
                working_days: 27,
                present_days: 27,
                paid_leave_days: 0,
                holiday_days: 1,
                weekend_days: 4,
                lop_days: 0,
                gross_amount: 35000,
                lop_deduction: 0,
                total_deductions: 2300,
                net_salary: 32700,
                status: "PROCESSED",
                earnings_breakdown: [{ name: "Basic Salary", monthly_amount: 17500 }],
                deductions_breakdown: [{ name: "Provident Fund (PF)", monthly_amount: 2100 }],
                additions_breakdown: [],
              },
            ],
          },
        });
      }
      if (url.includes("/payslips")) {
        return Promise.resolve({
          data: [
            {
              id: "item-approved-1",
              payroll_id: "pr-oct-2026",
              payroll_month: "2026-10",
              employee_id: "emp-101",
              employee_code: "EMP-001",
              employee_name: "Rahul Sharma",
              department: "Engineering",
              designation: "Software Engineer",
              annual_ctc: 420000,
              monthly_ctc: 35000,
              working_days: 27,
              present_days: 27,
              paid_leave_days: 0,
              holiday_days: 1,
              weekend_days: 4,
              lop_days: 0,
              gross_amount: 35000,
              lop_deduction: 0,
              total_deductions: 2300,
              net_salary: 32700,
              status: "APPROVED",
              earnings_breakdown: [{ name: "Basic Salary", monthly_amount: 17500 }],
              deductions_breakdown: [{ name: "PF", monthly_amount: 2100 }],
              additions_breakdown: [],
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });

    (apiPost as any).mockImplementation((url: string, payload: any) => {
      if (url.includes("/preview")) {
        const ctc = payload.annual_ctc || 420000;
        const monthly = ctc / 12;
        const basic = monthly * 0.5;
        const hra = basic * 0.4;
        const allow = monthly - basic - hra;
        const pf = basic * 0.12;
        const pt = 200;
        const deductions = pf + pt;
        return Promise.resolve({
          data: {
            annual_ctc: ctc,
            monthly_ctc: monthly,
            monthly_gross: monthly,
            total_deductions: deductions,
            estimated_net_salary: monthly - deductions,
            annual_gross: ctc,
            annual_net: (monthly - deductions) * 12,
            earnings: [
              { name: "Basic Salary", monthly_amount: basic, annual_amount: basic * 12 },
              { name: "House Rent Allowance (HRA)", monthly_amount: hra, annual_amount: hra * 12 },
              { name: "Special Allowance", monthly_amount: allow, annual_amount: allow * 12 },
            ],
            deductions: [
              { name: "Provident Fund (PF)", monthly_amount: pf, annual_amount: pf * 12 },
              { name: "Professional Tax (PT)", monthly_amount: pt, annual_amount: pt * 12 },
            ],
          },
        });
      }
      return Promise.resolve({ data: { success: true } });
    });
  });

  it("renders the 3 required tabs: Setup, Salary, and Monthly Payroll", async () => {
    render(
      <MemoryRouter>
        <PayrollPage />
      </MemoryRouter>
    );

    expect(document.getElementById("tab-setup-btn")).toBeDefined();
    expect(document.getElementById("tab-salary-btn")).toBeDefined();
    expect(document.getElementById("tab-monthly-btn")).toBeDefined();
  });

  it("Setup Tab: renders configurable components table and live rule previewer", async () => {
    render(
      <MemoryRouter>
        <PayrollPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Configured Earnings/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Configured Deductions/i).length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText("Basic Salary").length).toBeGreaterThan(0);
    expect(screen.getAllByText("House Rent Allowance (HRA)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Provident Fund (PF)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Professional Tax (PT)").length).toBeGreaterThan(0);

    expect(document.getElementById("btn-add-earning")).toBeDefined();
    expect(document.getElementById("btn-add-deduction")).toBeDefined();
    expect(screen.getByText("Live Payroll Setup Rule Preview")).toBeDefined();
  });

  it("Salary Tab: lists employees and opens Edit Salary modal with live monthly preview", async () => {
    render(
      <MemoryRouter>
        <PayrollPage />
      </MemoryRouter>
    );

    // Switch to Salary tab
    fireEvent.click(document.getElementById("tab-salary-btn")!);

    await waitFor(() => {
      expect(screen.getByText("Rahul Sharma")).toBeDefined();
    });

    const editBtn = screen.getAllByText("Configure Salary")[0];
    fireEvent.click(editBtn);

    // Modal should open
    await waitFor(() => {
      expect(screen.getByText("Configure Employee Salary")).toBeDefined();
    });
    expect(screen.getAllByText(/Annual CTC/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Effective From/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Monthly Salary Preview/i).length).toBeGreaterThan(0);
  });

  it("Monthly Payroll Tab: allows selecting month and reviewing payroll calculations", async () => {
    render(
      <MemoryRouter>
        <PayrollPage />
      </MemoryRouter>
    );

    // Switch to Monthly Payroll tab
    fireEvent.click(document.getElementById("tab-monthly-btn")!);

    await waitFor(() => {
      expect(screen.getByText(/Payroll Month/i)).toBeDefined();
      expect(document.getElementById("btn-calculate-payroll")).toBeDefined();
    });
  });

  it("Monthly Payroll Tab: attendance is strictly read-only and no Correct Payroll Record modal exists", async () => {
    render(
      <MemoryRouter>
        <PayrollPage />
      </MemoryRouter>
    );

    // Switch to Monthly Payroll tab
    fireEvent.click(document.getElementById("tab-monthly-btn")!);

    await waitFor(() => {
      expect(screen.getByText("Rahul Sharma")).toBeDefined();
    });

    // Verify there is NO "Correct Payroll Record" modal or button
    expect(screen.queryByText(/Correct Payroll Record/i)).toBeNull();

    // Verify "Attendance is the Source of Truth" notice is visible
    expect(screen.getByText(/Attendance is the Source of Truth/i)).toBeDefined();

    // Click "View Details" on the first employee row
    const viewDetailsButtons = screen.getAllByText("View Details");
    expect(viewDetailsButtons.length).toBeGreaterThan(0);
    fireEvent.click(viewDetailsButtons[0]);

    // Right-side drawer should open with Payroll Details
    await waitFor(() => {
      expect(screen.getAllByText(/Payroll Details/i).length).toBeGreaterThan(0);
    });

    // Attendance summary must be displayed
    expect(screen.getByText(/Attendance Summary/i)).toBeDefined();
    expect(screen.getAllByText("Working Days").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Present").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Paid Leave").length).toBeGreaterThan(0);

    // Verify there are NO editable text/number inputs for attendance
    expect(screen.queryByPlaceholderText(/manual tax correction/i)).toBeNull();

    // Verify Edit Payroll button exists in drawer for draft/review payroll
    expect(screen.getByText("Edit Payroll")).toBeDefined();

    // Verify recalculate button exists
    const recalcBtn = document.getElementById("btn-calculate-payroll");
    expect(recalcBtn).toBeDefined();
  });

  it("PDF Generator: generates salary slip PDF correctly without errors", () => {
    // Test INR currency formatter
    expect(formatInr(420000)).toContain("4,20,000");

    // Test PDF generation execution
    expect(() => {
      generatePayslipPdf({
        company_name: "Inhyma Tech ERP",
        payroll_month: "October 2026",
        employee_name: "Rahul Sharma",
        employee_code: "EMP-001",
        department: "Engineering",
        designation: "Software Engineer",
        annual_ctc: 420000,
        monthly_ctc: 35000,
        working_days: 27,
        present_days: 27,
        paid_leave_days: 0,
        holiday_days: 1,
        weekend_days: 4,
        lop_days: 0,
        earnings_breakdown: [
          { name: "Basic Salary", monthly_amount: 17500 },
          { name: "HRA", monthly_amount: 7000 },
        ],
        deductions_breakdown: [
          { name: "PF", monthly_amount: 2100 },
          { name: "PT", monthly_amount: 200 },
        ],
        additions_breakdown: [],
        lop_deduction: 0,
        gross_amount: 35000,
        total_deductions: 2300,
        net_salary: 32700,
        status: "APPROVED",
      });
    }).not.toThrow();
  });
});

