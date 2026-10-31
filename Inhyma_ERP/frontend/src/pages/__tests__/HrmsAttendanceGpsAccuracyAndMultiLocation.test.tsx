import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AttendancePage } from "../hrms/AttendancePage";
import * as apiModule from "@/lib/api";

afterEach(() => {
  cleanup();
});

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

// Mock useAuth
vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useAuth: () => ({
      profile: { id: "emp-1", username: "employee_one", role: "EMPLOYEE", display_name: "Employee One" },
      isSuperAdmin: false,
      hasPermission: () => true,
    }),
  };
});

// Mock API layer
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  API_BASE: "http://localhost:8000/api",
}));

describe("HRMS Attendance — Multi-Location, Fresh GPS & Accuracy UI Verification", () => {
  const mockOfficePrimary = {
    id: "loc-mumbai",
    name: "Mumbai HQ (Primary)",
    address: "Bandra Kurla Complex, Mumbai",
    latitude: 19.066,
    longitude: 72.868,
    radius_meters: 150,
  };

  const mockOfficeAdd1 = {
    id: "loc-gujarat",
    name: "Gujarat Branch (Additional)",
    address: "SG Highway, Ahmedabad, Gujarat",
    latitude: 23.033,
    longitude: 72.508,
    radius_meters: 150,
  };

  const mockPolicy = {
    id: "policy-1",
    shift_name: "General Shift",
    shift_start_time: "10:30",
    shift_end_time: "19:00",
    geofence_radius_meters: 150,
    enable_grace: true,
    grace_period_minutes: 15,
    enable_late_marks: true,
    count_late_monthly: true,
    monthly_late_limit: 3,
    third_late_action: "Half Day",
    enable_direct_half_day: true,
    direct_half_day_time: "11:31",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (apiModule.apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/hrms/attendance/policy")) {
        return Promise.resolve({ data: mockPolicy });
      }
      if (url.includes("/hrms/attendance/assigned-office")) {
        return Promise.resolve({ data: mockOfficePrimary });
      }
      if (url.includes("/hrms/attendance/permitted-offices")) {
        return Promise.resolve({ data: [mockOfficePrimary, mockOfficeAdd1] });
      }
      if (url.includes("/hrms/attendance/today")) {
        return Promise.resolve({
          data: {
            id: null,
            employee_id: "emp-1",
            attendance_date: "2026-10-31",
            punched_in: false,
            punched_out: false,
            status: "NOT_PUNCHED",
            assigned_office: mockOfficePrimary,
            permitted_offices: [mockOfficePrimary, mockOfficeAdd1],
          },
        });
      }
      if (url.includes("/hrms/attendance/calendar")) {
        return Promise.resolve({ data: [] });
      }
      if (url.includes("/hrms/attendance/regularizations")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: null });
    });
  });

  it("Scenario 6: Frontend does not block an authorized additional office and displays matching office", async () => {
    // Setup geolocation positioned at Gujarat Branch (additional location)
    let geoOptionsCaptured: PositionOptions | undefined;
    const mockGeolocation = {
      getCurrentPosition: vi.fn((success, _error, options) => {
        geoOptionsCaptured = options;
        success({
          coords: {
            latitude: 23.033, // Exactly at Gujarat office
            longitude: 72.508,
            accuracy: 8.0,
          },
          timestamp: Date.now(),
        });
      }),
    };
    Object.defineProperty(globalThis.navigator, "geolocation", {
      value: mockGeolocation,
      configurable: true,
      writable: true,
    });

    (apiModule.apiPost as any).mockResolvedValue({
      data: {
        id: "att-rec-1",
        employee_id: "emp-1",
        attendance_date: "2026-10-31",
        punch_in: new Date().toISOString(),
        punch_out: null,
        status: "PRESENT",
        office_location_id: "loc-gujarat",
        office_name: "Gujarat Branch (Additional)",
        punch_in_distance: 0.0,
        punch_in_accuracy_meters: 8.0,
      },
    });

    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Punch Card Container")).toBeDefined();
    });

    // Refresh GPS to evaluate geofence against all permitted locations
    const refreshGpsBtn = screen.getByRole("button", { name: /refresh gps/i });
    fireEvent.click(refreshGpsBtn);

    // Frontend must detect inside geofence at Gujarat Branch
    await waitFor(() => {
      expect(screen.getByText(/✓ Inside Geofence: Gujarat Branch/i)).toBeDefined();
    });

    // Verify High Confidence accuracy badge is rendered
    expect(screen.getByText(/High Confidence \(±8m\)/i)).toBeDefined();

    // Verify punch-in button is enabled
    const punchInBtn = screen.getByTestId("punch-in-button");
    expect(punchInBtn).toHaveProperty("disabled", false);

    // Click Punch In
    fireEvent.click(punchInBtn);

    // Verify fresh GPS acquisition used options: enableHighAccuracy: true, maximumAge: 0, timeout: 20000
    expect(geoOptionsCaptured).toEqual({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    });

    // Verify API called with fresh coordinates and accuracy
    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith(
        "/hrms/attendance/punch-in",
        expect.objectContaining({
          latitude: 23.033,
          longitude: 72.508,
          accuracy: 8.0,
        })
      );
    });
  });

  it("Scenario 10: GPS timeout prevents punch submission and displays clear error", async () => {
    const mockGeolocation = {
      getCurrentPosition: vi.fn((_success, error) => {
        error({
          code: 3, // TIMEOUT
          message: "Timeout expired",
        });
      }),
    };
    Object.defineProperty(globalThis.navigator, "geolocation", {
      value: mockGeolocation,
      configurable: true,
      writable: true,
    });

    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Punch Card Container")).toBeDefined();
    });

    const refreshGpsBtn = screen.getByRole("button", { name: /refresh gps/i });
    fireEvent.click(refreshGpsBtn);

    await waitFor(() => {
      expect(screen.getByText(/GPS location request timed out/i)).toBeDefined();
    });

    // No punch API call should have been attempted
    expect(apiModule.apiPost).not.toHaveBeenCalledWith(
      "/hrms/attendance/punch-in",
      expect.anything()
    );
  });

  it("Scenario 11: Permission denial provides retry instructions state", async () => {
    const mockGeolocation = {
      getCurrentPosition: vi.fn((_success, error) => {
        error({
          code: 1, // PERMISSION_DENIED
          message: "User denied Geolocation",
        });
      }),
    };
    Object.defineProperty(globalThis.navigator, "geolocation", {
      value: mockGeolocation,
      configurable: true,
      writable: true,
    });

    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Punch Card Container")).toBeDefined();
    });

    const refreshGpsBtn = screen.getByRole("button", { name: /refresh gps/i });
    fireEvent.click(refreshGpsBtn);

    await waitFor(() => {
      expect(screen.getByText(/Location permission denied. Please allow GPS access in your browser settings/i)).toBeDefined();
    });
  });

  it("Scenario 17: Poor GPS accuracy (> 100m) is rejected by centralized policy", async () => {
    const mockGeolocation = {
      getCurrentPosition: vi.fn((success) => {
        success({
          coords: {
            latitude: 19.066,
            longitude: 72.868,
            accuracy: 150.0, // > 100m unacceptable
          },
          timestamp: Date.now(),
        });
      }),
    };
    Object.defineProperty(globalThis.navigator, "geolocation", {
      value: mockGeolocation,
      configurable: true,
      writable: true,
    });

    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Punch Card Container")).toBeDefined();
    });

    const refreshGpsBtn = screen.getByRole("button", { name: /refresh gps/i });
    fireEvent.click(refreshGpsBtn);

    // Displays poor accuracy badge and policy message
    await waitFor(() => {
      expect(screen.getByText(/Poor Accuracy \(±150m\)/i)).toBeDefined();
      expect(screen.getByText(/Geofence validation requires accuracy within 100m/i)).toBeDefined();
    });

    // Attempting punch in should be blocked by policy
    const punchInBtn = screen.getByTestId("punch-in-button");
    fireEvent.click(punchInBtn);

    await waitFor(() => {
      expect(screen.getByText(/GPS accuracy is too poor/i)).toBeDefined();
    });

    expect(apiModule.apiPost).not.toHaveBeenCalledWith(
      "/hrms/attendance/punch-in",
      expect.anything()
    );
  });

  it("Scenario 18: Coarse GPS accuracy (> 500m) displays Precise Location guidance", async () => {
    const mockGeolocation = {
      getCurrentPosition: vi.fn((success) => {
        success({
          coords: {
            latitude: 19.066,
            longitude: 72.868,
            accuracy: 1200.0, // > 500m Coarse
          },
          timestamp: Date.now(),
        });
      }),
    };
    Object.defineProperty(globalThis.navigator, "geolocation", {
      value: mockGeolocation,
      configurable: true,
      writable: true,
    });

    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Punch Card Container")).toBeDefined();
    });

    const refreshGpsBtn = screen.getByRole("button", { name: /refresh gps/i });
    fireEvent.click(refreshGpsBtn);

    // Displays Coarse Accuracy badge and Precise Location guidance
    await waitFor(() => {
      expect(screen.getByText(/Coarse Accuracy \(±1200m\)/i)).toBeDefined();
      expect(
        screen.getByText(/GPS accuracy is coarse \(±1200m\)\. Please enable Precise Location in your device browser settings\./i)
      ).toBeDefined();
    });

    // Attempting punch in should be blocked by policy
    const punchInBtn = screen.getByTestId("punch-in-button");
    fireEvent.click(punchInBtn);

    expect(apiModule.apiPost).not.toHaveBeenCalledWith(
      "/hrms/attendance/punch-in",
      expect.anything()
    );
  });
});

