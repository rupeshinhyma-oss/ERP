import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AttendancePage } from "../hrms/AttendancePage";
import { LeavePage } from "../hrms/LeavePage";
import { AssetPage } from "../hrms/AssetPage";
import { SiteVisitPage } from "../hrms/SiteVisitPage";
import * as apiModule from "@/lib/api";

let mockAuthState: any = {
  profile: { id: "emp-1", username: "emp1", role: "EMPLOYEE", full_name: "Test Employee", permissions: ["hrms.view"] },
  user: { id: "emp-1", username: "emp1", role: "EMPLOYEE", full_name: "Test Employee", permissions: ["hrms.view"] },
  isSuperAdmin: false,
  hasPermission: (perm: string) => perm === "hrms.view",
};

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

vi.mock("@/lib/api", () => ({
  API_BASE: "/api/v1",
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  apiPostMultipart: vi.fn(),
  errorMessage: (e: any) => e?.message || "Error",
}));

vi.mock("@/lib/toast", () => ({
  useToast: () => vi.fn(),
}));

vi.mock("@/lib/hooks", () => ({
  useAuth: () => mockAuthState,
}));

vi.mock("@/lib/googleMaps", () => ({
  loadGoogleMapsSdk: vi.fn(async () => ({})),
  searchGooglePlaces: vi.fn(async () => []),
  fetchGooglePlaceDetails: vi.fn(async () => null),
  reverseGeocodeGoogle: vi.fn(async () => null),
}));

afterEach(() => {
  cleanup();
});

describe("HRMS Wave 3 — P2/P3 Frontend Remediation Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState = {
      profile: { id: "emp-1", username: "emp1", role: "EMPLOYEE", full_name: "Test Employee", permissions: ["hrms.view"] },
      user: { id: "emp-1", username: "emp1", role: "EMPLOYEE", full_name: "Test Employee", permissions: ["hrms.view"] },
      isSuperAdmin: false,
      hasPermission: (perm: string) => perm === "hrms.view",
    };
  });

  it("W3-01 & W3-09: AttendancePage shows accurate shift copy, neutral acquiring GPS chip, and allows cancelling own PENDING regularization", async () => {
    // Keep geolocation pending so currentDistance stays null while acquiring GPS
    Object.defineProperty(globalThis.navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn(),
        watchPosition: vi.fn(() => 1),
        clearWatch: vi.fn(),
      },
    });

    (apiModule.apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/hrms/attendance/policy")) {
        return Promise.resolve({
          data: {
            id: "pol-1",
            shift_name: "General",
            shift_start_time: "10:30",
            shift_end_time: "19:00",
            geofence_radius_meters: 150,
            enable_early_exit: true,
            early_exit_buffer_minutes: 15,
          },
        });
      }
      if (url.includes("/hrms/attendance/assigned-office")) {
        return Promise.resolve({
          data: { id: "loc-1", name: "Thane HQ", address: "Thane", latitude: 19.2, longitude: 72.95, radius_meters: 150 },
        });
      }
      if (url.includes("/hrms/attendance/permitted-offices")) {
        return Promise.resolve({ data: [] });
      }
      if (url.includes("/hrms/attendance/today")) {
        return Promise.resolve({ data: null });
      }
      if (url.includes("/hrms/attendance/calendar")) {
        return Promise.resolve({ data: [] });
      }
      if (url.includes("/hrms/attendance/regularizations")) {
        return Promise.resolve({
          data: [
            {
              id: "reg-own-1",
              employee_id: "emp-1",
              employee_name: "Test Employee",
              attendance_date: "2026-11-18",
              punch_in_time: "10:30 AM",
              punch_out_time: "07:00 PM",
              total_hours: "8h 30m",
              reason: "Traffic Delay",
              status: "PENDING",
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });
    (apiModule.apiPatch as any).mockResolvedValue({ data: { id: "reg-own-1", status: "CANCELLED" } });

    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    // W3-09: No inaccurate Phase 1 placeholder text and no alarming red "Outside Geofence (— m)" while acquiring GPS
    await waitFor(() => {
      expect(
        screen.getByText("Verify your office geofence and punch in to begin your daily shift.")
      ).toBeDefined();
    });
    expect(screen.queryByText("Punch functionality will be available here.")).toBeNull();
    expect(screen.getByText(/Acquiring GPS location/i)).toBeDefined();
    expect(screen.queryByText(/Outside Geofence \(— m/i)).toBeNull();

    // W3-01: Switch to Approval tab and cancel own pending regularization
    fireEvent.click(screen.getByRole("button", { name: /approval/i }));
    const cancelBtn = await screen.findByTestId("cancel-reg-btn-reg-own-1");
    expect(cancelBtn).toBeDefined();
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(apiModule.apiPatch).toHaveBeenCalledWith(
        "/hrms/attendance/regularizations/reg-own-1/cancel",
        { reason: "Cancelled by employee" }
      );
    });
  });

  it("W3-02 & W3-10: LeavePage supports 0.5-day half-day leave toggle and makes ZERO admin/RBAC/setup 403 fetches for ordinary employees", async () => {
    const calledUrls: string[] = [];
    (apiModule.apiGet as any).mockImplementation((url: string) => {
      calledUrls.push(url);
      if (url.includes("/hrms/leave/applicable-types") || url.includes("/hrms/leave/types")) {
        return Promise.resolve({
          data: [
            {
              id: "lt-half-yes",
              name: "Casual Leave",
              code: "CL",
              is_paid: true,
              annual_balance: 12,
              allow_half_day: true,
              is_active: true,
            },
            {
              id: "lt-half-no",
              name: "Full Day Only Leave",
              code: "FDO",
              is_paid: true,
              annual_balance: 5,
              allow_half_day: false,
              is_active: true,
            },
          ],
        });
      }
      if (url.includes("/hrms/leave/balances")) {
        return Promise.resolve({
          data: [
            { leave_type_id: "lt-half-yes", leave_type_name: "Casual Leave", leave_type_code: "CL", allocated: 12, consumed: 0, available: 12, is_paid: true },
            { leave_type_id: "lt-half-no", leave_type_name: "Full Day Only Leave", leave_type_code: "FDO", allocated: 5, consumed: 0, available: 5, is_paid: true },
          ],
        });
      }
      if (url.includes("/hrms/leave/calculate-days")) {
        return Promise.resolve({
          data: { number_of_days: url.includes("is_half_day=true") ? 0.5 : 1 },
        });
      }
      return Promise.resolve({ data: [] });
    });
    (apiModule.apiPost as any).mockResolvedValue({ data: { id: "lr-1", number_of_days: 0.5 } });

    render(
      <MemoryRouter>
        <LeavePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(calledUrls.some((u) => u.includes("/hrms/leave/applicable-types"))).toBe(true);
    });

    // W3-10: Ordinary employee must NOT call admin-only /rbac/roles or /hrms/setup/locations
    expect(calledUrls.some((u) => u.includes("/rbac/roles"))).toBe(false);
    expect(calledUrls.some((u) => u.includes("/hrms/setup/locations"))).toBe(false);

    // Open Apply Leave modal
    fireEvent.click(screen.getByRole("button", { name: /\+ request leave/i }));

    const fromInput = await screen.findByLabelText("From Date");
    const toInput = await screen.findByLabelText("To Date");
    fireEvent.change(fromInput, { target: { value: "25/11/2026" } });
    fireEvent.change(toInput, { target: { value: "25/11/2026" } });

    // Half-day checkbox appears for single-day + allow_half_day=true
    const halfDayToggle = await screen.findByTestId("apply-half-day-toggle");
    fireEvent.click(halfDayToggle);

    // Session selector appears
    const sessionSelect = await screen.findByTestId("apply-half-day-session");
    fireEvent.change(sessionSelect, { target: { value: "SECOND_HALF" } });

    await waitFor(() => {
      expect(calledUrls.some((u) => u.includes("/hrms/leave/calculate-days") && u.includes("is_half_day=true"))).toBe(true);
      expect(screen.getByText(/0\.5 Days/i)).toBeDefined();
    });

    // Fill reason and submit
    fireEvent.change(screen.getByPlaceholderText("Enter reason..."), { target: { value: "Doctor appointment" } });
    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith(
        "/hrms/leave/requests",
        expect.objectContaining({
          leave_type_id: "lt-half-yes",
          is_half_day: true,
          half_day_session: "SECOND_HALF",
          number_of_days: 0.5,
        })
      );
    });
  });

  it("W3-10: AssetPage makes ZERO calls to /hrms/setup/locations or /users/all for non-admin employees", async () => {
    const calledUrls: string[] = [];
    (apiModule.apiGet as any).mockImplementation((url: string) => {
      calledUrls.push(url);
      return Promise.resolve({ data: [] });
    });

    render(
      <MemoryRouter>
        <AssetPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(calledUrls.some((u) => u.includes("/hrms/assets"))).toBe(true);
    });

    expect(calledUrls.some((u) => u.includes("/hrms/setup/locations"))).toBe(false);
    expect(calledUrls.some((u) => u.includes("/users/all"))).toBe(false);
    expect(calledUrls.some((u) => u.includes("/hrms/assets/summary"))).toBe(false);
  });

  it("W3-10 & W3-12: SiteVisitPage suppresses /users?status=ACTIVE for Manager/Employee and renders accurate sub-minute durations (0s, 45s, 1m 30s)", async () => {
    // Test as Department Manager (canManageVisits=true, canReadUsersDirectory=false)
    mockAuthState = {
      profile: { id: "mgr-1", username: "mgr1", role: "DEPARTMENT_MANAGER", full_name: "Sales Manager", permissions: ["hrms.view", "hrms.approve"] },
      user: { id: "mgr-1", username: "mgr1", role: "DEPARTMENT_MANAGER", full_name: "Sales Manager", permissions: ["hrms.view", "hrms.approve"] },
      isSuperAdmin: false,
      hasPermission: (perm: string) => perm === "hrms.view" || perm === "hrms.approve",
    };

    const calledUrls: string[] = [];
    (apiModule.apiGet as any).mockImplementation((url: string) => {
      calledUrls.push(url);
      if (url.includes("/hrms/tracking/sessions")) {
        return Promise.resolve({
          data: [
            {
              id: "ts-0s",
              employee_id: "emp-1",
              employee_name: "Zero Sec User",
              tracking_date: "2026-11-20",
              status: "COMPLETED",
              start_time: "2026-11-20T05:00:00Z",
              end_time: "2026-11-20T05:00:00Z",
              total_duration_minutes: 0,
              total_duration_seconds: 0,
              approx_distance_km: 0,
            },
            {
              id: "ts-45s",
              employee_id: "emp-2",
              employee_name: "Forty Five Sec User",
              tracking_date: "2026-11-20",
              status: "COMPLETED",
              start_time: "2026-11-20T05:00:00Z",
              end_time: "2026-11-20T05:00:45Z",
              total_duration_minutes: 0,
              total_duration_seconds: 45,
              approx_distance_km: 0.2,
            },
            {
              id: "ts-90s",
              employee_id: "emp-3",
              employee_name: "Ninety Sec User",
              tracking_date: "2026-11-20",
              status: "COMPLETED",
              start_time: "2026-11-20T05:00:00Z",
              end_time: "2026-11-20T05:01:30Z",
              total_duration_minutes: 1,
              total_duration_seconds: 90,
              approx_distance_km: 0.8,
            },
          ],
        });
      }
      if (url.includes("/hrms/tracking/active")) {
        return Promise.resolve({ data: null });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <MemoryRouter>
        <SiteVisitPage />
      </MemoryRouter>
    );

    // Switch to Live Tracking tab
    fireEvent.click(screen.getByRole("button", { name: /live tracking/i }));

    await waitFor(() => {
      expect(screen.getByText("Zero Sec User")).toBeDefined();
      expect(screen.getByText("0s")).toBeDefined();
      expect(screen.getByText("45s")).toBeDefined();
      expect(screen.getByText("1m 30s")).toBeDefined();
    });

    // W3-10: Manager uses /hrms/employees directly, NEVER admin-only /users?status=ACTIVE
    expect(calledUrls.some((u) => u.includes("/users?status=ACTIVE"))).toBe(false);
    expect(calledUrls.some((u) => u.includes("/hrms/employees"))).toBe(true);
  });
});
