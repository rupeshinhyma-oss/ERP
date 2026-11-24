import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PayrollPage } from "@/pages/hrms/PayrollPage";
import { ExpensesPage } from "@/pages/hrms/ExpensesPage";

afterEach(() => {
  cleanup();
});

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

const mockToast = vi.fn();
vi.mock("@/lib/toast", () => ({
  useToast: () => mockToast,
}));

vi.mock("@/lib/api", () => ({
  API_BASE: "/api/v1",
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  apiPostMultipart: vi.fn(),
  errorMessage: (err: any) => err?.message || "Error",
}));

vi.mock("@/lib/auth", () => ({
  Auth: {
    getAccessToken: vi.fn(() => "mock-wave1-bearer-token"),
  },
}));

let mockAuthState = {
  profile: {
    id: "emp-1",
    username: "emp_eng",
    role: "employee",
    roles: ["employee", "Engineering"],
    permissions: [] as string[],
  },
  isSuperAdmin: false,
  isAuthenticated: true,
  hasPermission: (code: string) => {
    const perms = mockAuthState.profile.permissions || [];
    if (perms.includes(`deny:${code}`) || perms.includes(`block:${code}`)) return false;
    if (perms.includes("*") || perms.includes(code)) return true;
    // Replicate real Auth.hasPermission() employee self-service default for core HRMS modules
    const isHr = mockAuthState.profile.roles.some((r) => r.toLowerCase() === "hr");
    if (!isHr && ["hrms.attendance", "hrms.leave", "hrms.assets", "hrms.expenses", "hrms.site_visits", "hrms.payroll"].includes(code)) {
      return true;
    }
    return false;
  },
};

vi.mock("@/lib/hooks", () => ({
  useAuth: () => mockAuthState,
}));

import { apiGet } from "@/lib/api";

describe("HRMS Wave 1 P0 Frontend Remediation — Payslip Privacy & Receipt Security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/hrms/payroll/payslips")) {
        return Promise.resolve({
          data: [
            {
              id: "ps-own-1",
              payroll_id: "pr-1",
              payroll_month: "2026-10",
              employee_id: "emp-1",
              employee_code: "EMP-101",
              employee_name: "Ordinary Employee",
              department: "Engineering",
              designation: "Engineer",
              annual_ctc: 420000,
              monthly_ctc: 35000,
              working_days: 26,
              present_days: 26,
              paid_leave_days: 0,
              holiday_days: 1,
              weekend_days: 4,
              lop_days: 0,
              gross_amount: 35000,
              lop_deduction: 0,
              total_deductions: 2300,
              net_salary: 32700,
              status: "APPROVED",
              earnings_breakdown: [],
              deductions_breakdown: [],
              additions_breakdown: [],
            },
          ],
        });
      }
      if (url.includes("/hrms/expenses/summary")) {
        return Promise.resolve({
          data: {
            total_count: 1,
            total_amount: 450,
            pending_count: 1,
            pending_amount: 450,
            approved_count: 0,
            approved_amount: 0,
            rejected_count: 0,
            rejected_amount: 0,
            reimbursed_count: 0,
            reimbursed_amount: 0,
            draft_count: 0,
            draft_amount: 0,
          },
        });
      }
      if (url.includes("/hrms/expenses")) {
        return Promise.resolve({
          data: [
            {
              id: "exp-secure-1",
              expense_code: "EXP-0101",
              employee_id: "emp-1",
              employee_name: "Ordinary Employee",
              expense_date: "2026-11-18",
              category: "Travel",
              amount: 450,
              currency: "INR",
              description: "Airport cab",
              receipt_url: "/uploads/private/expenses/abc_cab.pdf",
              receipt_filename: "cab.pdf",
              status: "PENDING",
              created_at: "2026-11-18T10:00:00Z",
              updated_at: "2026-11-18T10:00:00Z",
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });
  });

  it("HRMS-BUG-08: Ordinary Employee sees 'My Salary Slips' (not Admin Payroll tabs) and never calls /monthly or /employees", async () => {
    mockAuthState = {
      ...mockAuthState,
      isSuperAdmin: false,
      profile: {
        id: "emp-1",
        username: "emp_eng",
        role: "employee",
        roles: ["employee", "Engineering"],
        permissions: [],
      },
    };

    render(
      <MemoryRouter>
        <PayrollPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/My Approved Salary Slips/i)).toBeDefined();
      expect(screen.getByText("2026-10")).toBeDefined();
    });

    expect(document.getElementById("tab-setup-btn")).toBeNull();
    expect(document.getElementById("tab-salary-btn")).toBeNull();
    expect(document.getElementById("tab-monthly-btn")).toBeNull();

    const calledUrls = (apiGet as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(calledUrls.some((u: string) => u.includes("/hrms/payroll/payslips"))).toBe(true);
    expect(calledUrls.some((u: string) => u.includes("/hrms/payroll/monthly"))).toBe(false);
    expect(calledUrls.some((u: string) => u.includes("/hrms/payroll/employees"))).toBe(false);
  });

  it("Area F: Department Manager sees self-service 'My Salary Slips' only and never Admin Payroll tabs", async () => {
    mockAuthState = {
      ...mockAuthState,
      isSuperAdmin: false,
      profile: {
        id: "mgr-1",
        username: "mgr_eng",
        role: "department_manager",
        roles: ["department_manager", "Engineering"],
        permissions: [],
      },
    };

    render(
      <MemoryRouter>
        <PayrollPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/My Approved Salary Slips/i)).toBeDefined();
    });

    expect(document.getElementById("tab-setup-btn")).toBeNull();
    expect(document.getElementById("tab-salary-btn")).toBeNull();
    expect(document.getElementById("tab-monthly-btn")).toBeNull();

    const calledUrls = (apiGet as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(calledUrls.some((u: string) => u.includes("/hrms/payroll/monthly"))).toBe(false);
    expect(calledUrls.some((u: string) => u.includes("/hrms/payroll/employees"))).toBe(false);
  });

  it("Area F/G: HR with explicit deny:hrms.payroll sees Payroll Access Restricted and fires zero payroll API calls", async () => {
    mockAuthState = {
      ...mockAuthState,
      isSuperAdmin: false,
      profile: {
        id: "hr-deny-1",
        username: "hr_denied",
        role: "hr",
        roles: ["hr"],
        permissions: ["hrms.attendance", "hrms.leave", "deny:hrms.payroll"],
      },
    };

    render(
      <MemoryRouter>
        <PayrollPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Payroll Access Restricted/i)).toBeDefined();
    });

    expect((apiGet as any).mock.calls.length).toBe(0);
  });

  it("HRMS-BUG-07: ExpensesPage opens receipt via authenticated /hrms/expenses/{id}/receipt fetch with Bearer header", async () => {
    mockAuthState = {
      ...mockAuthState,
      isSuperAdmin: false,
      profile: {
        id: "emp-1",
        username: "emp_eng",
        role: "employee",
        roles: ["employee", "Engineering"],
        permissions: [],
      },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" })),
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    const origCreateUrl = window.URL.createObjectURL;
    const origRevokeUrl = window.URL.revokeObjectURL;
    window.URL.createObjectURL = vi.fn(() => "blob:mock-receipt-url");
    window.URL.revokeObjectURL = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    try {
      render(
        <MemoryRouter>
          <ExpensesPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("EXP-0101")).toBeDefined();
      });

      // Ensure no raw unauthenticated anchor tag points directly to /uploads/expenses
      const anchors = Array.from(document.querySelectorAll("a"));
      expect(anchors.some((a) => (a.getAttribute("href") || "").includes("/uploads/"))).toBe(false);

      const receiptBtn = screen.getByRole("button", { name: /Receipt/i });
      fireEvent.click(receiptBtn);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/v1/hrms/expenses/exp-secure-1/receipt",
          expect.objectContaining({
            method: "GET",
            headers: { Authorization: "Bearer mock-wave1-bearer-token" },
          })
        );
      });
      expect(openSpy).toHaveBeenCalledWith("blob:mock-receipt-url", "_blank", "noopener,noreferrer");
    } finally {
      globalThis.fetch = origFetch;
      window.URL.createObjectURL = origCreateUrl;
      window.URL.revokeObjectURL = origRevokeUrl;
      openSpy.mockRestore();
    }
  });
});
