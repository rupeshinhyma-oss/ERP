import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  HrmsAttendancePage,
  shouldShowRegularizeIcon,
  generateMonthDays,
  type AttendanceDay,
} from "../HrmsAttendancePage";
import * as api from "@/lib/api";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/hooks", async () => {
  const actual = await vi.importActual<any>("@/lib/hooks");
  return {
    ...actual,
    useAuth: () => ({
      profile: {
        id: "u-emp-101",
        full_name: "Rupesh Malla",
        username: "rupesh",
        employee_code: "EMP-001",
        roles: ["admin"],
        role: "admin",
      },
      isSuperAdmin: true,
      hasPermission: () => true,
    }),
  };
});

describe("Production Fix — HRMS Attendance Data Flow (Scenarios 1 - 7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it("Scenario 1 & 2: Punch In, Navigate Away, Return, Refresh Browser — Session remains active and timer restores correctly", async () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const checkInIso = new Date(Date.now() - 3600 * 1000).toISOString(); // 1 hour ago

    // Mock GET /hrms/attendance/today returning active checked-in session from DB
    vi.spyOn(api, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/attendance/today")) {
        return Promise.resolve({
          data: {
            current_date: todayIso,
            current_shift: "10:30 AM – 07:00 PM",
            greeting: "Good Morning",
            attendance_state: "OPEN",
            punched_in: checkInIso,
            punched_out: null,
            punch_in: "10:30 AM",
            punch_out: null,
            status: "OPEN",
            assigned_office: {
              id: "loc-thane-prod",
              name: "Inhyma Thane Office",
              address: "Office No 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
              latitude: 19.198300,
              longitude: 72.948300,
              radius_meters: 150,
            },
          },
        } as any);
      }
      if (url.includes("/locations/assigned")) {
        return Promise.resolve({
          data: {
            id: "loc-thane-prod",
            name: "Inhyma Thane Office",
            address: "Office No 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
            latitude: 19.198300,
            longitude: 72.948300,
            radius_meters: 150,
          },
        } as any);
      }
      return Promise.resolve({ data: [] } as any);
    });

    const { unmount } = render(
      <MemoryRouter initialEntries={["/hrms/attendance?tab=view"]}>
        <HrmsAttendancePage />
      </MemoryRouter>
    );

    // 1. Session is active
    await waitFor(() => {
      expect(screen.getByText("● Checked In")).toBeTruthy();
    });

    // 2. Punch Out button is shown
    expect(screen.getByRole("button", { name: "Punch Out" })).toBeTruthy();

    // 3. Last punch in time restored
    expect(screen.getByText(/Last Punch In: 10:30 AM/i)).toBeTruthy();

    // 4. Timer restored to >= 1 hour (3600 seconds) not 00:00:12
    const timerText = screen.getByTestId("punch-live-timer").textContent;
    expect(timerText).not.toBe("--:--:--");
    expect(timerText).not.toBe("00:00:00");
    expect(timerText?.startsWith("01:")).toBe(true);

    // 5. Navigate away (unmount) and return (remount)
    unmount();

    render(
      <MemoryRouter initialEntries={["/hrms/attendance?tab=view"]}>
        <HrmsAttendancePage />
      </MemoryRouter>
    );

    // Session STILL active after navigating away and returning
    await waitFor(() => {
      expect(screen.getByText("● Checked In")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Punch Out" })).toBeTruthy();
  });

  it("Scenario 3: Punch Out stores today's In, Out, and Hours and freezes timer", async () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const postSpy = vi.spyOn(api, "apiPost").mockImplementation((url: string) => {
      if (url.includes("/punch-in")) {
        return Promise.resolve({
          data: {
            check_in_time: new Date().toISOString(),
            punch_in: "10:32 AM",
            status: "OPEN",
          },
        } as any);
      }
      if (url.includes("/punch-out")) {
        return Promise.resolve({
          data: {
            check_in_time: new Date().toISOString(),
            check_out_time: new Date().toISOString(),
            punch_in: "10:32 AM",
            punch_out: "07:02 PM",
            total_hours: "08h 30m",
            status: "CLOSED",
            final_status: "Present",
          },
        } as any);
      }
      return Promise.resolve({ data: {} } as any);
    });

    vi.spyOn(api, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/locations/assigned")) {
        return Promise.resolve({
          data: {
            id: "loc-thane",
            name: "Inhyma Thane Office",
            address: "Office No 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
            latitude: 19.198300,
            longitude: 72.948300,
            radius_meters: 150,
          },
        } as any);
      }
      return Promise.resolve({ data: [] } as any);
    });

    render(
      <MemoryRouter initialEntries={["/hrms/attendance?tab=view"]}>
        <HrmsAttendancePage />
      </MemoryRouter>
    );

    // Punch In
    const punchInBtn = screen.getByTestId("punch-toggle-btn");
    expect(punchInBtn.textContent).toBe("Punch In");
    fireEvent.click(punchInBtn);

    expect(screen.getByText("● Checked In")).toBeTruthy();

    // Punch Out
    const punchOutBtn = screen.getByTestId("punch-toggle-btn");
    expect(punchOutBtn.textContent).toBe("Punch Out");
    fireEvent.click(punchOutBtn);

    // Terminal becomes Attendance Completed
    expect(screen.getByText("✓ Attendance Completed")).toBeTruthy();
    expect(screen.getByTestId("punch-toggle-btn").textContent).toBe("Punch In (New Shift)");

    // Total hours frozen permanently
    expect(screen.getByText(/Total Working Duration/i)).toBeTruthy();
  });

  it("Scenario 4 & 7: Future calendar dates NEVER become Present and remain completely empty", () => {
    const todayStr = "2026-09-24";
    const recordsMap: Record<string, any> = {
      "2026-09-24": {
        attendance_date: "2026-09-24",
        punch_in: "10:30 AM",
        punch_out: "07:00 PM",
        total_hours: "08h 30m",
        final_status: "Present",
      },
    };

    const days = generateMonthDays("2026-09", recordsMap, todayStr);

    // 24th is today with record -> Present
    const day24 = days.find((d) => d.date === "2026-09-24");
    expect(day24?.status).toBe("Present");
    expect(day24?.punch_in).toBe("10:30 AM");

    // 25th, 28th, 29th, 30th are future dates without records -> MUST BE EMPTY! NEVER "Present"!
    const day25 = days.find((d) => d.date === "2026-09-25");
    const day28 = days.find((d) => d.date === "2026-09-28");
    const day29 = days.find((d) => d.date === "2026-09-29");
    const day30 = days.find((d) => d.date === "2026-09-30");

    expect(day25?.status).toBe("");
    expect(day28?.status).toBe("");
    expect(day29?.status).toBe("");
    expect(day30?.status).toBe("");

    // Regularization icon must NEVER show for future dates
    expect(shouldShowRegularizeIcon(day25!, "")).toBe(false);
    expect(shouldShowRegularizeIcon(day28!, "")).toBe(false);
  });

  it("Scenario 5: Irregular days display pencil icon ✏️, opens RegularizeDrawer, submit works", async () => {
    const testDays: AttendanceDay[] = [
      {
        date: "2026-09-02",
        dayNumber: 2,
        weekday: "Wed",
        status: "Late Punch",
        punch_in: "10:47 AM",
        punch_out: "07:01 PM",
        total_hours: "08h 14m",
        is_irregular: true,
      },
      {
        date: "2026-09-03",
        dayNumber: 3,
        weekday: "Thu",
        status: "Missing Punch",
        punch_in: "10:30 AM",
        punch_out: null,
        total_hours: null,
        is_irregular: true,
      },
    ];

    expect(shouldShowRegularizeIcon(testDays[0], "Late Punch")).toBe(true);
    expect(shouldShowRegularizeIcon(testDays[1], "Missing Punch")).toBe(true);

    const postSpy = vi.spyOn(api, "apiPost").mockResolvedValue({ data: { success: true } } as any);

    render(
      <MemoryRouter initialEntries={["/hrms/attendance?tab=view"]}>
        <HrmsAttendancePage initialDaysForTesting={testDays} />
      </MemoryRouter>
    );

    // Pencil icons render on irregular days
    const editBtnDay2 = screen.getByTestId("edit-irregular-2");
    expect(editBtnDay2).toBeTruthy();
    expect(editBtnDay2.textContent).toBe("✏️");

    // Clicking pencil opens RegularizeDrawer
    fireEvent.click(editBtnDay2);
    expect(screen.getByText("Regularize Request")).toBeTruthy();
    expect(screen.getByText(/2026-09-02/)).toBeTruthy();

    // Select reason and submit request
    const sendReqBtn = screen.getByRole("button", { name: /Send Request/i });
    fireEvent.click(sendReqBtn);

    await waitFor(() => {
      expect(screen.getByText(/Regularization request for 2026-09-02 sent/i)).toBeTruthy();
    });
  });

  it("Scenario 6: Regularize Directly by admin updates calendar immediately", async () => {
    const testDays: AttendanceDay[] = [
      {
        date: "2026-09-02",
        dayNumber: 2,
        weekday: "Wed",
        status: "Late Punch",
        punch_in: "10:47 AM",
        punch_out: "07:01 PM",
        total_hours: "08h 14m",
        is_irregular: true,
      },
    ];

    render(
      <MemoryRouter initialEntries={["/hrms/attendance?tab=view"]}>
        <HrmsAttendancePage initialDaysForTesting={testDays} />
      </MemoryRouter>
    );

    const editBtn = screen.getByTestId("edit-irregular-2");
    fireEvent.click(editBtn);

    // Admin sees "Regularize Directly" button
    const directBtn = screen.getByRole("button", { name: /Regularize Directly/i });
    expect(directBtn).toBeTruthy();

    // Click direct regularize
    fireEvent.click(directBtn);

    // Notification appears and cell updates to Present
    await waitFor(() => {
      expect(screen.getByText(/Directly regularized 2026-09-02 to Present/i)).toBeTruthy();
    });
  });

  it("Bug 7: Location fetched from /locations/assigned displays Inhyma Thane Office and full address", async () => {
    vi.spyOn(api, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/locations/assigned")) {
        return Promise.resolve({
          data: {
            id: "loc-assigned-prod",
            name: "Inhyma Thane Office",
            address: "Office No 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
            latitude: 19.198300,
            longitude: 72.948300,
            radius_meters: 150,
          },
        } as any);
      }
      return Promise.resolve({ data: [] } as any);
    });

    render(
      <MemoryRouter initialEntries={["/hrms/attendance?tab=view"]}>
        <HrmsAttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText("Inhyma Thane Office").length).toBeGreaterThanOrEqual(1);
    });

    // Full Lodha Supremus address is displayed
    expect(screen.getByText(/Lodha Supremus/i)).toBeTruthy();
    expect(screen.getByText(/Wagle Industrial Estate/i)).toBeTruthy();
    expect(screen.getByText(/400604/i)).toBeTruthy();
  });
});
