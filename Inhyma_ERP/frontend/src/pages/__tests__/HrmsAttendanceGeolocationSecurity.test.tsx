import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AttendancePage } from "@/pages/hrms/AttendancePage";
import * as apiModule from "@/lib/api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  errorMessage: (err: any) => err?.message || "Error",
}));

const mockProfile = {
  id: "ea2b5763-5a4d-4f21-8bff-adc3e6cb8235",
  username: "regular_user",
  role: "EMPLOYEE",
  full_name: "Regular Employee",
  permissions: [],
};

vi.mock("@/lib/hooks", () => ({
  useAuth: () => ({
    profile: mockProfile,
    isSuperAdmin: false,
    isAuthenticated: true,
    hasPermission: () => false,
  }),
}));

const mockPolicy = {
  id: "pol-1",
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
  half_day_threshold_minutes: 60,
  enable_early_exit: false,
  early_exit_buffer_minutes: 0,
  mark_early_exit: false,
  auto_regularization_early_exit: false,
  missing_punch_out: false,
  missing_punch_in: false,
  auto_mark_irregular: false,
  require_regularization: false,
  consecutive_late_warning: false,
  auto_email_notification: false,
  auto_manager_notification: false,
  holiday_overtime: false,
  weekend_overtime: false,
  flexible_shift: false,
  grace_extension: false,
};

const mockOffice = {
  id: "loc-1",
  name: "Headquarters Office",
  address: "100 Tech Park, Mumbai",
  latitude: 19.0760,
  longitude: 72.8777,
  radius_meters: 150,
};

describe("DEF-ATT-02: Geolocation Requirement & Simulator Removal Verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(apiModule.apiGet).mockImplementation(async (url: string) => {
      if (url.includes("/hrms/attendance/policy")) return { data: mockPolicy } as any;
      if (url.includes("/hrms/attendance/assigned-office")) return { data: mockOffice } as any;
      if (url.includes("/hrms/attendance/today")) return { data: null } as any;
      if (url.includes("/hrms/attendance/calendar")) return { data: [] } as any;
      if (url.includes("/hrms/attendance/regularizations")) return { data: [] } as any;
      return { data: null } as any;
    });

    // Mock navigator.geolocation as unavailable
    Object.defineProperty(globalThis.navigator, "geolocation", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  it("does not render the production location simulator panel", async () => {
    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Punch Card Container")).toBeDefined();
    });

    // Location simulator headers and buttons must NOT exist in the DOM
    expect(screen.queryByText(/Testing Location Simulator/i)).toBeNull();
    expect(screen.queryByText(/Inside \(10m\)/i)).toBeNull();
    expect(screen.queryByText(/Edge \(135m\)/i)).toBeNull();
    expect(screen.queryByText(/Outside \(500m\)/i)).toBeNull();
  });

  it("disables Punch In and blocks action when browser geolocation is unavailable", async () => {
    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("punch-in-button")).toBeDefined();
    });

    const punchInBtn = screen.getByTestId("punch-in-button");
    // Button must be disabled because isInsideGeofence is false without coordinates
    expect(punchInBtn).toHaveProperty("disabled", true);
    expect(screen.getByText(/Outside Geofence/i)).toBeDefined();

    // Even if clicked, no API call occurs
    fireEvent.click(punchInBtn);
    expect(apiModule.apiPost).not.toHaveBeenCalledWith(
      "/hrms/attendance/punch-in",
      expect.anything()
    );
  });

  it("blocks punch-out and shows error alert when browser geolocation is unavailable", async () => {
    // Provide a record where user is already punched in
    vi.mocked(apiModule.apiGet).mockImplementation(async (url: string) => {
      if (url.includes("/hrms/attendance/policy")) return { data: mockPolicy } as any;
      if (url.includes("/hrms/attendance/assigned-office")) return { data: mockOffice } as any;
      if (url.includes("/hrms/attendance/today")) {
        return {
          data: {
            id: "att-1",
            employee_id: mockProfile.id,
            attendance_date: "2026-10-29",
            punch_in: "2026-10-29T10:30:00Z",
            punch_out: null,
            punched_in: true,
            punched_out: false,
            status: "PRESENT",
            working_minutes: 60,
          },
        } as any;
      }
      if (url.includes("/hrms/attendance/calendar")) return { data: [] } as any;
      if (url.includes("/hrms/attendance/regularizations")) return { data: [] } as any;
      return { data: null } as any;
    });

    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("punch-out-button")).toBeDefined();
    });

    const punchOutBtn = screen.getByTestId("punch-out-button");
    fireEvent.click(punchOutBtn);

    await waitFor(() => {
      expect(screen.getByText(/Please enable browser GPS before punching out/i)).toBeDefined();
    });

    // apiPost for punch-out must NOT be invoked without GPS
    expect(apiModule.apiPost).not.toHaveBeenCalledWith(
      "/hrms/attendance/punch-out",
      expect.anything()
    );
  });

  it("proves office coordinates are not used as automatic fallback", async () => {
    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Punch Card Container")).toBeDefined();
    });

    // Geolocation status should show Acquiring GPS or GPS Denied, never Connected from office data
    expect(screen.queryByText(/Inside \(0m\)/i)).toBeNull();
    expect(screen.getByText(/Acquiring GPS\.\.\./i)).toBeDefined();
  });
});
