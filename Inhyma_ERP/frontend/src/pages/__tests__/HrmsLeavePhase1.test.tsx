import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LeavePage } from "@/pages/hrms/LeavePage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock api methods
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn((url: string) => {
    if (url.includes("/hrms/leave/types")) {
      return Promise.resolve({
        data: [
          {
            id: "lt-1",
            name: "Casual Leave",
            code: "CL",
            leave_type: "REGULAR",
            is_paid: true,
            annual_balance: 12,
            carry_forward_allowed: false,
            carry_forward_days: 0,
            max_consecutive_days: 3,
            monthly_accrual: false,
            is_active: true,
          },
          {
            id: "lt-2",
            name: "Sick Leave",
            code: "SL",
            leave_type: "REGULAR",
            is_paid: true,
            annual_balance: 10,
            carry_forward_allowed: false,
            carry_forward_days: 0,
            max_consecutive_days: 5,
            monthly_accrual: false,
            is_active: true,
          },
        ],
      });
    }
    if (url.includes("/hrms/leave/balances")) {
      return Promise.resolve({
        data: [
          {
            id: "bal-1",
            employee_id: "emp-1",
            employee_name: "Somil Shah",
            leave_type_id: "lt-1",
            leave_type_name: "Casual Leave",
            allocated: 12,
            consumed: 2,
            adjusted: 1,
            available: 11,
            year: 2026,
          },
        ],
      });
    }
    if (url.includes("/hrms/leave/matrix")) {
      return Promise.resolve({
        data: [
          {
            employee_id: "emp-1",
            employee_name: "Somil Shah",
            employee_email: "somil.shah@inhyma.com",
            balances: {
              "Casual Leave": {
                allocated: 12,
                consumed: 2,
                adjusted: 1,
                available: 11,
              },
            },
          },
        ],
      });
    }
    if (url.includes("/hrms/leave/holidays")) {
      return Promise.resolve({
        data: [
          {
            id: "hol-1",
            name: "Diwali",
            holiday_date: "2026-11-08",
            number_of_days: 2,
            branch_applicability: "Thane",
            is_active: true,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
      });
    }
    if (url.includes("/hrms/leave/plans")) {
      return Promise.resolve({
        data: [
          {
            id: "plan-1",
            name: "Thane Technical Plan",
            effective_from: "2026-01-01",
            effective_to: "2026-12-31",
            branch: "Thane",
            department: "Technical",
            leave_type_ids: ["lt-1"],
            leave_type_names: ["Casual Leave"],
            is_active: true,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
      });
    }
    if (url.includes("/hrms/leave/approvals") || url.includes("/hrms/leave/requests")) {
      return Promise.resolve({
        data: [
          {
            id: "req-1",
            employee_id: "emp-1",
            employee_name: "Somil Shah",
            leave_type_id: "lt-1",
            leave_type_name: "Casual Leave",
            from_date: "2026-06-01",
            to_date: "2026-06-02",
            number_of_days: 2,
            reason: "Personal vacation",
            status: "PENDING",
            approval_status: "PENDING",
            created_by_name: "Somil Shah",
            updated_by_name: "Somil Shah",
            created_at: "2026-05-20T00:00:00Z",
            updated_at: "2026-05-20T00:00:00Z",
          },
        ],
      });
    }
    return Promise.resolve({ data: [] });
  }),
  apiPost: vi.fn(() => Promise.resolve({ data: {} })),
  apiPatch: vi.fn(() => Promise.resolve({ data: {} })),
  apiPut: vi.fn(() => Promise.resolve({ data: {} })),
}));

describe("HRMS Leave Management — Phase 1 Component Tests", () => {
  it("renders Leave page with 4 navigation tabs and verifies Leave Plans is removed", async () => {
    render(
      <MemoryRouter>
        <LeavePage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Leave");
    expect(screen.getByText("My Leaves")).toBeDefined();
    expect(screen.getByText("Leave Approvals")).toBeDefined();
    expect(screen.getByText("Holiday")).toBeDefined();
    expect(screen.getByText("Leave Adjustment")).toBeDefined();
    // Verifies Scenario K: No "Leave Plans" tab
    expect(screen.queryByText("Leave Plans")).toBeNull();
  });

  it("switches to Leave Approvals tab and displays approval table", async () => {
    render(
      <MemoryRouter>
        <LeavePage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText("Leave Approvals"));

    await waitFor(() => {
      expect(screen.getByText("Review submitted employee leave requests and process approvals")).toBeDefined();
      expect(screen.getAllByText("Somil Shah")[0]).toBeDefined();
      expect(screen.getByText("Approve")).toBeDefined();
      expect(screen.getByText("Reject")).toBeDefined();
    });
  });

  it("switches to Holiday Master and displays configured holidays", async () => {
    render(
      <MemoryRouter>
        <LeavePage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText("Holiday"));

    await waitFor(() => {
      expect(screen.getByText("Holiday Master")).toBeDefined();
      expect(screen.getByText("Diwali")).toBeDefined();
      expect(screen.getByText("+ Add Holiday")).toBeDefined();
    });
  });

  it("switches to Leave Adjustment and opens adjustment drawer with dynamic preview", async () => {
    render(
      <MemoryRouter>
        <LeavePage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText("Leave Adjustment"));

    await waitFor(() => {
      expect(screen.getByText("Somil Shah")).toBeDefined();
      const adjustBtn = screen.getByText("Adjust");
      expect(adjustBtn).toBeDefined();
      fireEvent.click(adjustBtn);
    });

    await waitFor(() => {
      expect(screen.getByText("Adjust Leave Balance")).toBeDefined();
      expect(screen.getByText("Current Available")).toBeDefined();
      expect(screen.getByText("Resulting Available")).toBeDefined();
      expect(screen.getByText("Save Adjustment")).toBeDefined();
    });
  });

  it("verifies Scenario K: Leave Plans tab is not in navigation", async () => {
    render(
      <MemoryRouter>
        <LeavePage />
      </MemoryRouter>
    );

    expect(screen.queryByText("Leave Plans")).toBeNull();
  });
});
