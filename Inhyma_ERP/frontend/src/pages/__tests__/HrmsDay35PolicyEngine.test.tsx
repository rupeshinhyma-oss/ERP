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

// Mock API module
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiPut: vi.fn(),
}));

// Mock Auth hook (Admin role)
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

describe("HRMS Day 3.5 — Attendance Policy Engine & Improvements", () => {
  const mockPolicy = {
    id: "policy-1",
    shift_name: "General Shift",
    shift_start_time: "10:30",
    shift_end_time: "19:00",
    weekly_off: "Sunday",
    payroll_cycle: "1st–End of Month",
    geofence_radius_meters: 150,
    enable_grace: true,
    grace_period_minutes: 15,
    grace_end_time: "10:45",
    enable_late_marks: true,
    late_start_time: "10:46",
    count_late_monthly: true,
    monthly_late_limit: 3,
    third_late_action: "Half Day",
    enable_direct_half_day: true,
    direct_half_day_time: "11:31",
    half_day_threshold_minutes: 61,
    enable_early_exit: true,
    early_exit_buffer_minutes: 15,
    mark_early_exit: true,
    auto_regularization_early_exit: true,
    missing_punch_out: true,
    missing_punch_in: true,
    auto_mark_irregular: true,
    require_regularization: true,
    consecutive_late_warning: false,
    auto_email_notification: false,
    auto_manager_notification: false,
    holiday_overtime: false,
    weekend_overtime: false,
    flexible_shift: false,
    grace_extension: false,
  };

  const mockOffice = {
    id: "off-1",
    name: "Inhyma Thane HQ",
    address: "Thane West, Maharashtra 400601",
    latitude: 19.2183,
    longitude: 72.9781,
    radius_meters: 150,
  };

  const mockCalendar = [
    {
      date: "2026-09-01",
      day_number: 1,
      day_name: "Tue",
      status: "PRESENT",
      punch_in: "10:25 AM",
      punch_out: "07:05 PM",
      working_minutes: 520,
      late_minutes: 0,
      early_exit_minutes: 0,
      is_irregular: false,
      regularization_status: "NONE",
      can_regularize: false,
      attendance_id: "att-1",
    },
    {
      date: "2026-09-02",
      day_number: 2,
      day_name: "Wed",
      status: "LATE",
      punch_in: "10:48 AM",
      punch_out: "07:15 PM",
      working_minutes: 507,
      late_minutes: 18,
      early_exit_minutes: 0,
      is_irregular: true,
      regularization_status: "NONE",
      can_regularize: true,
      attendance_id: "att-2",
    },
    {
      date: "2026-09-06",
      day_number: 6,
      day_name: "Sun",
      status: "WEEKEND",
      punch_in: null,
      punch_out: null,
      working_minutes: 0,
      late_minutes: 0,
      early_exit_minutes: 0,
      is_irregular: false,
      regularization_status: "NONE",
      can_regularize: false,
      attendance_id: null,
    },
  ];

  const mockRegularizations = [
    {
      id: "reg-1",
      employee_id: "emp-1",
      employee_name: "Vijay Kumar",
      employee_email: "vijay@inhyma.com",
      attendance_date: "2026-09-26",
      request_type: "LATE_PUNCH",
      reason: "Traffic Delay",
      notes: "Traffic jam at junction",
      punch_in_time: "10:52 AM",
      punch_out_time: "07:01 PM",
      total_hours: "8h09m",
      status: "PENDING",
      submitted_at: "2026-09-26T11:00:00Z",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(apiModule.apiGet).mockImplementation(async (url: string) => {
      if (url === "/hrms/attendance/policy") return { data: mockPolicy } as any;
      if (url === "/hrms/attendance/assigned-office") return { data: mockOffice } as any;
      if (url === "/hrms/attendance/today") return { data: null } as any;
      if (url.startsWith("/hrms/attendance/calendar")) return { data: mockCalendar } as any;
      if (url === "/hrms/attendance/regularizations") return { data: mockRegularizations } as any;
      return { data: null } as any;
    });

    vi.mocked(apiModule.apiPut).mockResolvedValue({ data: { ...mockPolicy, grace_period_minutes: 20 } } as any);
    vi.mocked(apiModule.apiPost).mockResolvedValue({ data: { success: true } } as any);
    vi.mocked(apiModule.apiPatch).mockResolvedValue({ data: { success: true } } as any);
  });

  it("renders editable Policy Engine in Settings tab with live preview and saves changes", async () => {
    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    // Switch to Settings tab
    const settingsBtn = screen.getByRole("button", { name: /settings/i });
    fireEvent.click(settingsBtn);

    // Verify Basic Rules fields
    const shiftNameInput = await screen.findByTestId("policy-shift-name-input");
    expect(shiftNameInput).toBeDefined();
    expect((shiftNameInput as HTMLInputElement).value).toBe("General Shift");

    // Verify Grace Period auto calculation
    const graceEndsBadge = screen.getByTestId("policy-grace-ends-badge");
    expect(graceEndsBadge.textContent).toContain("10:45 AM");

    // Verify Late Starts After auto calculation
    const lateStartsBadge = screen.getByTestId("policy-late-starts-badge");
    expect(lateStartsBadge.textContent).toContain("10:46 AM");

    // Verify Live Preview card values
    expect(screen.getByText("Live Policy Preview")).toBeDefined();
    expect(screen.getByText("10:30 AM–7:00 PM")).toBeDefined();
    expect(screen.getByText("Until 10:45 AM")).toBeDefined();
    expect(screen.getAllByText("10:46 AM").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("11:31 AM")).toBeDefined();
    expect(screen.getByText("150m")).toBeDefined();

    // Edit shift start time & grace minutes to check live preview reactivity
    const graceMinutesInput = screen.getByTestId("policy-grace-minutes-input");
    fireEvent.change(graceMinutesInput, { target: { value: "20" } });

    // Save policy
    const saveBtn = screen.getByTestId("save-policy-btn");
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(apiModule.apiPut).toHaveBeenCalledWith(
        "/hrms/attendance/policy",
        expect.objectContaining({
          shift_name: "General Shift",
          grace_period_minutes: 20,
          grace_end_time: "10:50",
          late_start_time: "10:51",
        })
      );
    });
  });

  it("renders updated Approval tab columns: Employee, Date, Punch In, Punch Out, Hours, Reason, Status, Actions", async () => {
    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    // Switch to Approval tab
    const approvalBtn = screen.getByRole("button", { name: /approval/i });
    fireEvent.click(approvalBtn);

    await waitFor(() => {
      expect(screen.getByTestId("pending-approvals-table")).toBeDefined();
    });

    // Verify table headers
    expect(screen.getByText("Punch In")).toBeDefined();
    expect(screen.getByText("Punch Out")).toBeDefined();
    expect(screen.getByText("Hours")).toBeDefined();

    // Verify row data matching Vijay Kumar 8h09m
    expect(screen.getByText("Vijay Kumar")).toBeDefined();
    expect(screen.getByText("10:52 AM")).toBeDefined();
    expect(screen.getByText("07:01 PM")).toBeDefined();
    expect(screen.getByText("8h09m")).toBeDefined();
    expect(screen.getByText("Traffic Delay")).toBeDefined();
    expect(screen.getByTestId("approve-btn-reg-1")).toBeDefined();
    expect(screen.getByTestId("reject-btn-reg-1")).toBeDefined();
    expect(screen.getByTestId("adjust-leave-btn-reg-1")).toBeDefined();
  });

  it("renders Regularization Drawer with editable Punch In/Out, auto live total hours, reasons, and Admin options", async () => {
    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    const regBtn = await screen.findByTestId("regularize-btn-2026-09-02");
    fireEvent.click(regBtn);

    await waitFor(() => {
      expect(screen.getByTestId("regularization-drawer")).toBeDefined();
    });

    // Check editable Punch In & Punch Out inputs
    const punchInInput = screen.getByTestId("regularization-punch-in-input") as HTMLInputElement;
    const punchOutInput = screen.getByTestId("regularization-punch-out-input") as HTMLInputElement;
    expect(punchInInput).toBeDefined();
    expect(punchOutInput).toBeDefined();

    // Total hours auto badge
    const hoursBadge = screen.getByTestId("regularization-total-hours");
    expect(hoursBadge.textContent).toContain("8h27m");

    // Change punch out time and check live total hours updates
    fireEvent.change(punchOutInput, { target: { value: "19:01" } });
    expect(hoursBadge.textContent).toContain("8h13m");

    // Admin direct regularize button is visible
    expect(screen.getByTestId("direct-regularize-btn")).toBeDefined();
    expect(screen.getByTestId("submit-regularization-btn")).toBeDefined();
  });
});
