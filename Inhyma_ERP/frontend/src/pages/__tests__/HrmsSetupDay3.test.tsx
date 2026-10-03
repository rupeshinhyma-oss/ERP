import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AttendancePage } from "../hrms/AttendancePage";
import * as apiModule from "@/lib/api";

afterEach(() => {
  cleanup();
});

// Mock AppShell to keep unit tests fast and focused
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock API layer
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

describe("HRMS Day 3 — Employee Attendance Tests", () => {
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
      date: "2026-09-03",
      day_number: 3,
      day_name: "Thu",
      status: "HALF_DAY",
      punch_in: "11:35 AM",
      punch_out: "07:00 PM",
      working_minutes: 445,
      late_minutes: 65,
      early_exit_minutes: 0,
      is_irregular: true,
      regularization_status: "NONE",
      can_regularize: true,
      attendance_id: "att-3",
    },
    {
      date: "2026-09-04",
      day_number: 4,
      day_name: "Fri",
      status: "MISSING_PUNCH",
      punch_in: null,
      punch_out: null,
      working_minutes: null,
      late_minutes: 0,
      early_exit_minutes: 0,
      is_irregular: true,
      regularization_status: "NONE",
      can_regularize: true,
      attendance_id: null,
    },
    {
      date: "2026-09-05",
      day_number: 5,
      day_name: "Sat",
      status: "WEEKEND",
      punch_in: null,
      punch_out: null,
      working_minutes: null,
      late_minutes: 0,
      early_exit_minutes: 0,
      is_irregular: false,
      regularization_status: "NONE",
      can_regularize: false,
      attendance_id: null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(apiModule.apiGet).mockImplementation(async (url: string) => {
      if (url.includes("/hrms/attendance/policy")) {
        return { data: mockPolicy } as any;
      }
      if (url.includes("/hrms/attendance/assigned-office")) {
        return { data: mockOffice } as any;
      }
      if (url.includes("/hrms/attendance/today")) {
        return { data: null } as any;
      }
      if (url.includes("/hrms/attendance/calendar")) {
        return { data: mockCalendarDays } as any;
      }
      return { data: null } as any;
    });
  });

  // -------------------------------------------------------------------------
  // Test 1: Dashboard Elements Order & Mounting
  // -------------------------------------------------------------------------
  it("renders attendance dashboard with top status, office info, punch card, timer, summary, and calendar", async () => {
    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    // Header & Shell
    const shell = screen.getByTestId("app-shell");
    expect(shell.getAttribute("data-active-key")).toBe("hrms-attendance");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Attendance");

    // Top status items: Today's date, Assigned office, GPS status
    await waitFor(() => {
      expect(screen.getByText("Today's Date")).toBeDefined();
      expect(screen.getAllByText("Inhyma Thane Office").length).toBeGreaterThan(0);
    });

    // Punch Card & Working timer
    expect(screen.getByTestId("punch-in-button")).toBeDefined();
    expect(screen.getByTestId("live-working-timer")).toBeDefined();

    // Summary Card
    expect(screen.getByText("Punch In")).toBeDefined();
    expect(screen.getByText("Working Hours")).toBeDefined();
    expect(screen.getByText("Late Minutes")).toBeDefined();
    expect(screen.getByText("Geofence Status")).toBeDefined();

    // Calendar
    const expectedMonthYear = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
    expect(screen.getByText(expectedMonthYear)).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Test 2: Geofence Validation on Punch In
  // -------------------------------------------------------------------------
  it("blocks punch in when simulator is set to outside radius", async () => {
    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText("Inhyma Thane Office").length).toBeGreaterThan(0);
    });

    // Click Outside preset on Location Simulator
    const outsideBtn = screen.getByText(/Outside \(500m\)/i);
    fireEvent.click(outsideBtn);

    // Verify distance chip reflects outside status
    await waitFor(() => {
      expect(screen.getByText(/Outside Geofence/i)).toBeDefined();
    });

    // Punch in button should be disabled when outside geofence
    const punchInBtn = screen.getByTestId("punch-in-button");
    expect(punchInBtn.hasAttribute("disabled")).toBe(true);
  });

  it("allows punch in when simulator is set to inside radius and starts session", async () => {
    const mockPunchedRecord = {
      id: "att-today-1",
      employee_id: "emp-1",
      attendance_date: "2026-09-26",
      punch_in: new Date().toISOString(),
      punch_out: null,
      status: "PRESENT",
      working_minutes: 0,
      late_minutes: 0,
      early_exit_minutes: 0,
      office_location_id: "loc-thane-1",
      office_name: "Inhyma Thane Office",
      latitude: 19.199824,
      longitude: 72.956795,
      punch_in_distance: 12.0,
      punch_out_distance: null,
      is_irregular: false,
      regularization_status: "NONE",
      can_regularize: false,
    };

    vi.mocked(apiModule.apiPost).mockResolvedValueOnce({
      data: mockPunchedRecord,
    } as any);

    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText("Inhyma Thane Office").length).toBeGreaterThan(0);
    });

    // Click Inside preset
    const insideBtn = screen.getByText(/Inside \(10m\)/i);
    fireEvent.click(insideBtn);

    const punchInBtn = screen.getByTestId("punch-in-button");
    expect(punchInBtn.hasAttribute("disabled")).toBe(false);

    // Click Punch In
    fireEvent.click(punchInBtn);

    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith(
        "/hrms/attendance/punch-in",
        expect.objectContaining({
          latitude: expect.any(Number),
          longitude: expect.any(Number),
        })
      );
    });

    // Now punch card switches to Active Working Session with Punch Out button
    await waitFor(() => {
      expect(screen.getByTestId("punch-out-button")).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: Timer Persistence Across Refresh
  // -------------------------------------------------------------------------
  it("continues live timer based on actual punch_in timestamp from API", async () => {
    // Punch in was 1 hour 15 minutes ago
    const oneHour15MinsAgo = new Date(Date.now() - 75 * 60 * 1000).toISOString();

    const mockActiveRecord = {
      id: "att-today-1",
      employee_id: "emp-1",
      attendance_date: "2026-09-26",
      punch_in: oneHour15MinsAgo,
      punch_out: null,
      status: "PRESENT",
      working_minutes: 75,
      late_minutes: 0,
      early_exit_minutes: 0,
      office_location_id: "loc-thane-1",
      office_name: "Inhyma Thane Office",
      latitude: 19.199824,
      longitude: 72.956795,
      punch_in_distance: 15.0,
      punch_out_distance: null,
      is_irregular: false,
      regularization_status: "NONE",
      can_regularize: false,
    };

    vi.mocked(apiModule.apiGet).mockImplementation(async (url: string) => {
      if (url.includes("/hrms/attendance/today")) {
        return { data: mockActiveRecord } as any;
      }
      if (url.includes("/hrms/attendance/policy")) return { data: mockPolicy } as any;
      if (url.includes("/hrms/attendance/assigned-office")) return { data: mockOffice } as any;
      if (url.includes("/hrms/attendance/calendar")) return { data: mockCalendarDays } as any;
      return { data: null } as any;
    });

    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    // Live timer must display at least 01:15:XX
    await waitFor(() => {
      const timerText = screen.getByTestId("live-working-timer").textContent;
      expect(timerText).toMatch(/01:15:\d{2}/);
    });

    // Punch out button is present
    expect(screen.getByTestId("punch-out-button")).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Test 4: Punch Out Flow & Session Lock
  // -------------------------------------------------------------------------
  it("locks attendance after punch out", async () => {
    const mockActiveRecord = {
      id: "att-today-1",
      employee_id: "emp-1",
      attendance_date: "2026-09-26",
      punch_in: new Date(Date.now() - 3600000).toISOString(),
      punch_out: null,
      status: "PRESENT",
      working_minutes: 60,
      late_minutes: 0,
      early_exit_minutes: 0,
      office_location_id: "loc-thane-1",
      office_name: "Inhyma Thane Office",
      latitude: 19.199824,
      longitude: 72.956795,
      punch_in_distance: 10.0,
      punch_out_distance: null,
      is_irregular: false,
      regularization_status: "NONE",
      can_regularize: false,
    };

    const mockCompletedRecord = {
      ...mockActiveRecord,
      punch_out: new Date().toISOString(),
      working_minutes: 60,
    };

    vi.mocked(apiModule.apiGet).mockImplementation(async (url: string) => {
      if (url.includes("/hrms/attendance/today")) return { data: mockActiveRecord } as any;
      if (url.includes("/hrms/attendance/policy")) return { data: mockPolicy } as any;
      if (url.includes("/hrms/attendance/assigned-office")) return { data: mockOffice } as any;
      if (url.includes("/hrms/attendance/calendar")) return { data: mockCalendarDays } as any;
      return { data: null } as any;
    });

    vi.mocked(apiModule.apiPost).mockResolvedValueOnce({
      data: mockCompletedRecord,
    } as any);

    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    const punchOutBtn = await screen.findByTestId("punch-out-button");
    fireEvent.click(punchOutBtn);

    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith(
        "/hrms/attendance/punch-out",
        expect.any(Object)
      );
    });

    // After punching out, session is locked
    await waitFor(() => {
      expect(screen.getAllByText(/Attendance Locked for Today/i).length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Test 5: MANDATORY Calendar Edit Icon Rules
  // -------------------------------------------------------------------------
  it("renders Regularize button ONLY on irregular days and NEVER on normal Present", async () => {
    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("calendar-day-2026-09-01")).toBeDefined();
    });

    // Day 1: 2026-09-01 is normal PRESENT -> MUST NOT have regularize edit button
    const day1 = screen.getByTestId("calendar-day-2026-09-01");
    expect(day1).toBeDefined();
    expect(screen.queryByTestId("regularize-btn-2026-09-01")).toBeNull();

    // Day 2: 2026-09-02 is LATE -> MUST have regularize edit button
    expect(screen.getByTestId("regularize-btn-2026-09-02")).toBeDefined();

    // Day 3: 2026-09-03 is HALF_DAY -> MUST have regularize edit button
    expect(screen.getByTestId("regularize-btn-2026-09-03")).toBeDefined();

    // Day 4: 2026-09-04 is MISSING_PUNCH -> MUST have regularize edit button
    expect(screen.getByTestId("regularize-btn-2026-09-04")).toBeDefined();

    // Day 5: 2026-09-05 is WEEKEND -> No edit button
    expect(screen.queryByTestId("regularize-btn-2026-09-05")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 6: One-Day Regularization Drawer Interaction
  // -------------------------------------------------------------------------
  it("opens one-day regularization drawer when edit icon is clicked and submits request", async () => {
    vi.mocked(apiModule.apiPost).mockResolvedValueOnce({
      data: {
        id: "att-2",
        attendance_date: "2026-09-02",
        regularization_status: "PENDING",
        regularization_reason: "Traffic / Transit Delay",
      },
    } as any);

    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    const regBtnDay2 = await screen.findByTestId("regularize-btn-2026-09-02");
    fireEvent.click(regBtnDay2);

    // Regularization drawer opens
    await waitFor(() => {
      expect(screen.getByTestId("regularization-drawer")).toBeDefined();
      expect(screen.getByText("One-Day Regularization")).toBeDefined();
    });

    // Select reason & type note
    const reasonSelect = screen.getByTestId("regularization-reason-select");
    fireEvent.change(reasonSelect, { target: { value: "Traffic / Transit Delay" } });

    const noteInput = screen.getByTestId("regularization-note-input");
    fireEvent.change(noteInput, { target: { value: "Expressway traffic jam near Mulund toll" } });

    // Submit
    const submitBtn = screen.getByTestId("submit-regularization-btn");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith(
        "/hrms/attendance/regularization",
        expect.objectContaining({
          attendance_id: "att-2",
          date: "2026-09-02",
          reason: "Traffic / Transit Delay",
          note: "Expressway traffic jam near Mulund toll",
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // Test 7: Location Simulator presets (Inside, Edge, Outside)
  // -------------------------------------------------------------------------
  it("switches simulator presets and updates distance calculations", async () => {
    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText("Inhyma Thane Office").length).toBeGreaterThan(0);
    });

    // 1. Edge preset
    fireEvent.click(screen.getByText(/Edge \(135m\)/i));
    await waitFor(() => {
      expect(screen.getByText(/Simulator set: Edge of radius/i)).toBeDefined();
    });

    // 2. Outside preset
    fireEvent.click(screen.getByText(/Outside \(500m\)/i));
    await waitFor(() => {
      expect(screen.getByText(/Simulator set: Outside radius/i)).toBeDefined();
    });

    // 3. Inside preset
    fireEvent.click(screen.getByText(/Inside \(10m\)/i));
    await waitFor(() => {
      expect(screen.getByText(/Simulator set: Inside radius/i)).toBeDefined();
    });
  });
});
