import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LeavePage } from "@/pages/hrms/LeavePage";

const initialRequests = [
  {
    id: "req-1",
    employee_id: "emp-1",
    employee_name: "Test Employee",
    leave_type_id: "lt-cl",
    leave_type_name: "Casual Leave",
    from_date: "2026-10-05",
    to_date: "2026-10-06",
    number_of_days: 2,
    reason: "Family event",
    attachment: "https://example.com/cert.pdf",
    attachment_url: "https://example.com/cert.pdf",
    status: "PENDING",
    approval_status: "PENDING",
    created_by_name: "Test Employee",
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-01T10:00:00Z",
  },
  {
    id: "req-2",
    employee_id: "emp-1",
    employee_name: "Test Employee",
    leave_type_id: "lt-sl",
    leave_type_name: "Sick Leave",
    from_date: "2026-09-10",
    to_date: "2026-09-11",
    number_of_days: 2,
    reason: "Fever and flu",
    attachment: null,
    attachment_url: null,
    status: "APPROVED",
    approval_status: "APPROVED",
    created_by_name: "Test Employee",
    created_at: "2026-09-08T10:00:00Z",
    updated_at: "2026-09-09T10:00:00Z",
  },
];

let mockRequests = [...initialRequests];

beforeEach(() => {
  mockRequests = initialRequests.map((r) => ({ ...r }));
});

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
    if (url.includes("/hrms/leave/applicable-types")) {
      return Promise.resolve({
        data: [
          {
            id: "lt-cl",
            name: "Casual Leave",
            code: "CL",
            leave_type: "REGULAR",
            is_paid: true,
            annual_balance: 12,
            max_consecutive_days: 3,
            is_active: true,
          },
          {
            id: "lt-sl",
            name: "Sick Leave",
            code: "SL",
            leave_type: "REGULAR",
            is_paid: true,
            annual_balance: 10,
            max_consecutive_days: 5,
            is_active: true,
          },
          {
            id: "lt-lwp",
            name: "Leave Without Pay",
            code: "LWP",
            leave_type: "UNPAID",
            is_paid: false,
            annual_balance: 0,
            max_consecutive_days: 30,
            is_active: true,
          },
        ],
      });
    }
    if (url.includes("/hrms/leave/types")) {
      return Promise.resolve({
        data: [
          {
            id: "lt-cl",
            name: "Casual Leave",
            code: "CL",
            leave_type: "REGULAR",
            is_paid: true,
            annual_balance: 12,
            max_consecutive_days: 3,
            is_active: true,
          },
        ],
      });
    }
    if (url.includes("/hrms/leave/balances")) {
      return Promise.resolve({
        data: [
          {
            id: "bal-cl",
            employee_id: "emp-1",
            employee_name: "Test Employee",
            leave_type_id: "lt-cl",
            leave_type_name: "Casual Leave",
            allocated: 12,
            consumed: 2,
            adjusted: 0,
            available: 10,
            year: 2026,
          },
          {
            id: "bal-sl",
            employee_id: "emp-1",
            employee_name: "Test Employee",
            leave_type_id: "lt-sl",
            leave_type_name: "Sick Leave",
            allocated: 10,
            consumed: 2,
            adjusted: 0,
            available: 8,
            year: 2026,
          },
        ],
      });
    }
    if (url.includes("/hrms/leave/calculate-days")) {
      return Promise.resolve({
        data: {
          number_of_days: 2,
          total_calendar_days: 2,
          weekly_off_days: 0,
          holiday_days: 0,
          holiday_names: [],
        },
      });
    }
    if (url.includes("/hrms/leave/requests")) {
      return Promise.resolve({
        data: mockRequests,
      });
    }
    if (url.includes("/hrms/leave/holidays")) {
      return Promise.resolve({ data: [] });
    }
    if (url.includes("/hrms/leave/plans")) {
      return Promise.resolve({ data: [] });
    }
    return Promise.resolve({ data: [] });
  }),
  apiPost: vi.fn((url: string, payload: any) => {
    if (url.includes("/hrms/leave/requests")) {
      const newReq = {
        id: "req-new",
        employee_id: "emp-1",
        employee_name: "Test Employee",
        leave_type_id: payload.leave_type_id,
        leave_type_name: "Casual Leave",
        from_date: payload.from_date,
        to_date: payload.to_date,
        number_of_days: 2,
        reason: payload.reason,
        attachment: payload.attachment || null,
        attachment_url: payload.attachment || null,
        status: "PENDING",
        approval_status: "PENDING",
        created_by_name: "Test Employee",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockRequests = [newReq, ...mockRequests];
      return Promise.resolve({ data: newReq });
    }
    return Promise.resolve({ data: { success: true } });
  }),
  apiPatch: vi.fn((url: string) => {
    if (url.includes("/cancel")) {
      mockRequests = mockRequests.map((r) =>
        r.id === "req-1" ? { ...r, status: "CANCELLED" } : r
      );
      return Promise.resolve({ data: { ...mockRequests[0], status: "CANCELLED" } });
    }
    return Promise.resolve({ data: { success: true } });
  }),
  apiPut: vi.fn(() => Promise.resolve({ data: { success: true } })),
  apiPostMultipart: vi.fn(() =>
    Promise.resolve({
      data: {
        file_url: "https://example.com/uploads/leave_doc.pdf",
        filename: "leave_doc.pdf",
      },
    })
  ),
}));

describe("HRMS Leave Management — Phase 2: Employee Leave Request & My Leaves", () => {
  it("loads My Leaves tab with Available Leave Balances", async () => {
    render(
      <MemoryRouter>
        <LeavePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Available Leave Balances")).toBeDefined();
      expect(screen.getAllByText("Casual Leave")[0]).toBeDefined();
      expect(screen.getByText("10")).toBeDefined();
      expect(screen.getAllByText("Sick Leave")[0]).toBeDefined();
      expect(screen.getByText("8")).toBeDefined();
    });
  });

  it("loads applicable leave requests and displays table columns", async () => {
    render(
      <MemoryRouter>
        <LeavePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Leave Requests")).toBeDefined();
      expect(screen.getByText("Family event")).toBeDefined();
      expect(screen.getByText("Fever and flu")).toBeDefined();
    });

    // PENDING request has Cancel button, APPROVED request does NOT
    const cancelBtns = screen.getAllByRole("button", { name: "Cancel" });
    expect(cancelBtns.length).toBe(1);

    const viewBtns = screen.getAllByRole("button", { name: "View" });
    expect(viewBtns.length).toBe(2);
  });

  it("opens Apply Leave modal with dynamic applicable leave types and calculated days", async () => {
    render(
      <MemoryRouter>
        <LeavePage />
      </MemoryRouter>
    );

    const applyBtns = await screen.findAllByRole("button", { name: /\+ Request Leave/i });
    fireEvent.click(applyBtns[0]);

    await waitFor(() => {
      expect(screen.getByText("Apply for Leave")).toBeDefined();
      expect(screen.getByText(/Number of Days:/i)).toBeDefined();
    });
  });

  it("opens Request Details modal when clicking View", async () => {
    render(
      <MemoryRouter>
        <LeavePage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Family event")).toBeDefined();
    const viewBtns = screen.getAllByRole("button", { name: "View" });
    fireEvent.click(viewBtns[0]);

    await waitFor(() => {
      expect(screen.getByText("Leave Request Details")).toBeDefined();
      expect(screen.getByText("View Attachment Document")).toBeDefined();
    });
  });

  it("allows cancelling a PENDING request", async () => {
    window.confirm = vi.fn(() => true);

    render(
      <MemoryRouter>
        <LeavePage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Family event")).toBeDefined();
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalled();
    });
  });

  it("shows empty state when no leave requests match", async () => {
    render(
      <MemoryRouter>
        <LeavePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Leave Requests")).toBeDefined();
    });

    const selects = screen.getAllByRole("combobox");
    const statusSelect = selects.find((s) => (s as HTMLSelectElement).value === "ALL");
    if (statusSelect) {
      fireEvent.change(statusSelect, { target: { value: "REJECTED" } });
      await waitFor(() => {
        expect(screen.getByText("No leave requests found.")).toBeDefined();
      });
    }
  });
});
