import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AttendancePage } from "../hrms/AttendancePage";
import * as apiModule from "@/lib/api";

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

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock("@/lib/hooks", async () => {
  const actual = await vi.importActual<any>("@/lib/hooks");
  return {
    ...actual,
    useAuth: () => ({
      profile: { id: "admin-1", username: "admin", role: "ADMIN", full_name: "System Admin" },
      isSuperAdmin: true,
      hasPermission: () => true,
    }),
  };
});

describe("HRMS Regularization → Approval Integration Tests", () => {
  const mockPolicy = {
    id: "pol-1",
    shift_start_time: "10:30",
    shift_end_time: "19:00",
    grace_period_minutes: 15,
    half_day_threshold_minutes: 60,
    geofence_radius_meters: 150.0,
  };

  const mockOffice = {
    id: "loc-thane-1",
    name: "Inhyma Thane Office",
    address: "Office No 421, 4th Floor, Lodha Supremus, Thane West",
    latitude: 19.199824,
    longitude: 72.956795,
    radius_meters: 150.0,
  };

  const mockCalendarDays = [
    {
      date: "2026-09-02",
      day_number: 2,
      day_name: "Wed",
      status: "LATE",
      punch_in: "10:55 AM",
      punch_out: "07:05 PM",
      working_minutes: 490,
      late_minutes: 25,
      early_exit_minutes: 0,
      is_irregular: true,
      regularization_status: "PENDING",
      can_regularize: true,
      attendance_id: "att-2",
    },
    {
      date: "2026-09-03",
      day_number: 3,
      day_name: "Thu",
      status: "PRESENT",
      punch_in: "10:20 AM",
      punch_out: "07:00 PM",
      working_minutes: 520,
      late_minutes: 0,
      early_exit_minutes: 0,
      is_irregular: false,
      regularization_status: "NONE",
      can_regularize: false,
      attendance_id: "att-3",
    },
  ];

  const mockRegularizations = [
    {
      id: "reg-1",
      employee_id: "emp-101",
      employee_name: "Omkar Kulkarni",
      employee_email: "omkar.k@inhyma.com",
      attendance_record_id: "att-2",
      attendance_date: "2026-09-02",
      request_type: "LATE_PUNCH",
      reason: "Train delay due to waterlogging",
      notes: "Central Railway mainline disrupted",
      status: "PENDING",
      submitted_at: "2026-09-02T11:00:00Z",
      reviewed_at: null,
      reviewed_by: null,
      reviewed_by_name: null,
      manager_remarks: null,
      action_taken: null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(apiModule.apiGet).mockImplementation(async (url: string) => {
      if (url.includes("/hrms/attendance/policy")) return { data: mockPolicy } as any;
      if (url.includes("/hrms/attendance/assigned-office")) return { data: mockOffice } as any;
      if (url.includes("/hrms/attendance/today")) return { data: null } as any;
      if (url.includes("/hrms/attendance/calendar")) return { data: mockCalendarDays } as any;
      if (url.includes("/hrms/attendance/regularizations")) return { data: mockRegularizations } as any;
      return { data: null } as any;
    });

    vi.mocked(apiModule.apiPatch).mockResolvedValue({
      data: { ...mockRegularizations[0], status: "APPROVED" },
    } as any);

    vi.mocked(apiModule.apiPost).mockResolvedValue({
      data: {
        id: "reg-new",
        employee_id: "admin-1",
        employee_name: "System Admin",
        attendance_date: "2026-09-02",
        status: "APPROVED",
        action_taken: "DIRECT_REGULARIZE",
      },
    } as any);
  });

  it("renders pending regularization in the Approval Tab with live data and columns", async () => {
    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    // Switch to Approval tab
    const approvalBtn = screen.getByRole("button", { name: /approval/i });
    fireEvent.click(approvalBtn);

    // Check table headers and employee details
    await waitFor(() => {
      expect(screen.getByTestId("pending-approvals-table")).toBeDefined();
      expect(screen.getByText("Omkar Kulkarni")).toBeDefined();
      expect(screen.getByText("Train delay due to waterlogging")).toBeDefined();
      expect(screen.getByTestId("approve-btn-reg-1")).toBeDefined();
      expect(screen.getByTestId("reject-btn-reg-1")).toBeDefined();
      expect(screen.getByTestId("adjust-leave-btn-reg-1")).toBeDefined();
    });
  });

  it("approves regularization request and updates status", async () => {
    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    const approvalBtn = screen.getByRole("button", { name: /approval/i });
    fireEvent.click(approvalBtn);

    await waitFor(() => {
      expect(screen.getByTestId("approve-btn-reg-1")).toBeDefined();
    });

    const approveBtn = screen.getByTestId("approve-btn-reg-1");
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(apiModule.apiPatch).toHaveBeenCalledWith(
        "/hrms/attendance/regularizations/reg-1/approve",
        expect.objectContaining({ action: "APPROVE" })
      );
    });
  });

  it("rejects regularization request (Mark LOP)", async () => {
    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    const approvalBtn = screen.getByRole("button", { name: /approval/i });
    fireEvent.click(approvalBtn);

    await waitFor(() => {
      expect(screen.getByTestId("reject-btn-reg-1")).toBeDefined();
    });

    const rejectBtn = screen.getByTestId("reject-btn-reg-1");
    fireEvent.click(rejectBtn);

    await waitFor(() => {
      expect(apiModule.apiPatch).toHaveBeenCalledWith(
        "/hrms/attendance/regularizations/reg-1/reject",
        expect.objectContaining({ action: "REJECT_LOP" })
      );
    });
  });

  it("adjusts regularization request against leave", async () => {
    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    const approvalBtn = screen.getByRole("button", { name: /approval/i });
    fireEvent.click(approvalBtn);

    await waitFor(() => {
      expect(screen.getByTestId("adjust-leave-btn-reg-1")).toBeDefined();
    });

    const adjustBtn = screen.getByTestId("adjust-leave-btn-reg-1");
    fireEvent.click(adjustBtn);

    await waitFor(() => {
      expect(apiModule.apiPatch).toHaveBeenCalledWith(
        "/hrms/attendance/regularizations/reg-1/approve",
        expect.objectContaining({ action: "ADJUST_LEAVE" })
      );
    });
  });

  it("displays Pending Regularization badge on calendar day and keeps pencil icon visible", async () => {
    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Pending Regularization")).toBeDefined();
      expect(screen.getByTestId("regularize-btn-2026-09-02")).toBeDefined();
    });
  });

  it("allows Admin to regularize directly from the drawer", async () => {
    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("regularize-btn-2026-09-02")).toBeDefined();
    });

    const regBtn = screen.getByTestId("regularize-btn-2026-09-02");
    fireEvent.click(regBtn);

    await waitFor(() => {
      expect(screen.getByTestId("regularization-drawer")).toBeDefined();
      expect(screen.getByTestId("direct-regularize-btn")).toBeDefined();
    });

    const directBtn = screen.getByTestId("direct-regularize-btn");
    fireEvent.click(directBtn);

    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith(
        "/hrms/attendance/regularization",
        expect.objectContaining({ direct_regularize: true })
      );
    });
  });
});
