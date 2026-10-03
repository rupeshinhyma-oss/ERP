import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LeavePage } from "@/pages/hrms/LeavePage";

const mockRequests = [
  {
    id: "req-pending",
    employee_id: "emp-101",
    employee_name: "Pooja Patil",
    leave_type_id: "lt-lwp",
    leave_type_name: "Leave Without Pay",
    from_date: "2026-10-12",
    to_date: "2026-10-14",
    number_of_days: 3,
    reason: "Personal family commitment",
    attachment: null,
    attachment_url: null,
    status: "PENDING",
    approval_status: "PENDING",
    created_by_name: "Pooja Patil",
    updated_by_name: "-",
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-01T10:00:00Z",
  },
  {
    id: "req-approved",
    employee_id: "emp-101",
    employee_name: "Pooja Patil",
    leave_type_id: "lt-cl",
    leave_type_name: "Casual Leave",
    from_date: "2026-09-01",
    to_date: "2026-09-02",
    number_of_days: 2,
    reason: "Annual vacation",
    attachment: "https://example.com/receipt.pdf",
    attachment_url: "https://example.com/receipt.pdf",
    status: "APPROVED",
    approval_status: "APPROVED",
    created_by_name: "Pooja Patil",
    updated_by_name: "Manager",
    created_at: "2026-08-25T10:00:00Z",
    updated_at: "2026-08-26T10:00:00Z",
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

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
            annual_balance: 25,
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
            annual_balance: 25,
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
    if (url.includes("/hrms/leave/balances")) {
      return Promise.resolve({
        data: [
          {
            id: "bal-cl",
            employee_id: "emp-101",
            employee_name: "Pooja Patil",
            leave_type_id: "lt-cl",
            leave_type_name: "Casual Leave",
            allocated: 25,
            consumed: 0,
            adjusted: 0,
            available: 25,
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
    if (url.includes("/hrms/leave/approvals")) {
      return Promise.resolve({
        data: mockRequests,
      });
    }
    return Promise.resolve({ data: [] });
  }),
  apiPost: vi.fn(() => Promise.resolve({ data: { success: true } })),
  apiPatch: vi.fn(() => Promise.resolve({ data: { success: true } })),
  apiPut: vi.fn(() => Promise.resolve({ data: { success: true } })),
  apiPostMultipart: vi.fn(() =>
    Promise.resolve({
      data: {
        file_url: "https://example.com/uploads/doc.pdf",
        filename: "doc.pdf",
      },
    })
  ),
}));

describe("HRMS Leave Module — Visual & Architectural Fixes", () => {
  it("renders ONLY ONE primary '+ Request Leave' button on the page", async () => {
    render(
      <MemoryRouter>
        <LeavePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Available Leave Balances")).toBeDefined();
    });

    const requestBtns = screen.getAllByRole("button", { name: /\+ Request Leave/i });
    expect(requestBtns.length).toBe(1);
    expect(requestBtns[0].id).toBe("btn-request-leave");
  });

  it("opens Apply for Leave modal with ERP styled controls, balance indicator, and DatePicker", async () => {
    render(
      <MemoryRouter>
        <LeavePage />
      </MemoryRouter>
    );

    const casualLeaves = await screen.findAllByText("Casual Leave");
    expect(casualLeaves.length).toBeGreaterThan(0);

    const requestBtn = screen.getByRole("button", { name: /\+ Request Leave/i });
    fireEvent.click(requestBtn);

    await waitFor(() => {
      expect(screen.getByText("Apply for Leave")).toBeDefined();
      expect(screen.getByText(/Available Balance: 25 Days/i)).toBeDefined();
      expect(screen.getByLabelText(/From Date/i)).toBeDefined();
      expect(screen.getByLabelText(/To Date/i)).toBeDefined();
      expect(screen.getByText("Choose File")).toBeDefined();
      expect(screen.getByRole("button", { name: "Submit" })).toBeDefined();
      expect(screen.getAllByRole("button", { name: "Cancel" }).length).toBeGreaterThan(0);
    });
  });

  it("renders Leave Requests table with all specified columns and badges", async () => {
    render(
      <MemoryRouter>
        <LeavePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Leave Requests")).toBeDefined();
      expect(screen.getByText("Chronological history of applied, pending, approved and rejected leaves")).toBeDefined();
      expect(screen.getByText("No. of Days")).toBeDefined();
      expect(screen.getByText("Personal family commitment")).toBeDefined();
      expect(screen.getByText("Annual vacation")).toBeDefined();
    });

    // Check status badges
    expect(screen.getAllByText("PENDING").length).toBeGreaterThan(0);
    expect(screen.getAllByText("APPROVED").length).toBeGreaterThan(0);
  });

  it("opens Approve Leave Request modal with employee, duration, impact card, and [Cancel][Reject][Approve] footer", async () => {
    render(
      <MemoryRouter>
        <LeavePage />
      </MemoryRouter>
    );

    // Switch to Leave Approvals tab
    const approvalsTab = screen.getByRole("button", { name: /Leave Approvals/i });
    fireEvent.click(approvalsTab);

    const approveBtns = await screen.findAllByRole("button", { name: "Approve" });
    fireEvent.click(approveBtns[0]);

    await waitFor(() => {
      // Check title
      expect(screen.getByText("Approve Leave Request")).toBeDefined();
      // Check details
      expect(screen.getAllByText("Pooja Patil").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Leave Without Pay").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/3 Days/i).length).toBeGreaterThan(0);
      // Check impact card
      expect(screen.getByText(/Upon approval, 3 days will be deducted from the employee's applicable leave balance\/consumed quota\./i)).toBeDefined();
      // Check reviewer notes
      expect(screen.getByText("Approval Remarks / Reviewer Notes")).toBeDefined();
      // Check 3 footer buttons
      expect(screen.getAllByRole("button", { name: "Cancel" }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("button", { name: "Reject" }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("button", { name: "Approve" }).length).toBeGreaterThan(0);
    });

    // Ensure Apply modal is NOT rendered at the same time
    expect(screen.queryByText("Apply for Leave")).toBeNull();
  });
});
