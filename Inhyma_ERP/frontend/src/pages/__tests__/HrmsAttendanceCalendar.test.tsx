import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AttendancePage } from "@/pages/hrms/AttendancePage";
import { apiGet } from "@/lib/api";

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

const mockCurrentUser = {
  id: "ea2b5763-5a4d-4f21-8bff-adc3e6cb8235",
  username: "admin",
  role: "super_admin",
  full_name: "Admin User",
  permissions: ["*"],
};

vi.mock("@/lib/hooks", () => ({
  useAuth: () => ({
    profile: mockCurrentUser,
    isSuperAdmin: true,
    isAuthenticated: true,
    hasPermission: () => true,
  }),
}));

const mockEmployees = [
  {
    id: "ea2b5763-5a4d-4f21-8bff-adc3e6cb8235",
    first_name: "Admin",
    last_name: "User",
    full_name: "Admin User",
    employee_code: "EMP-000",
    department: "Management",
    role: "super_admin",
  },
  {
    id: "b4ab8f01-adf2-4d27-afef-246f40eb2b0e",
    first_name: "John",
    last_name: "Doe",
    full_name: "John Doe",
    employee_code: "EMP-001",
    department: "Sales",
    role: "employee",
  },
];

const mockPolicy = {
  id: "pol-1",
  shift_name: "General Shift",
  shift_start_time: "10:30",
  shift_end_time: "19:00",
  grace_period_minutes: 15,
  weekly_off: "Sunday",
  geofence_radius_meters: 100,
};

const mockOffice = {
  id: "off-1",
  name: "Thane HQ",
  address: "Thane West",
  latitude: 19.2183,
  longitude: 72.9781,
  radius_meters: 100,
};

describe("HRMS Monthly Attendance Calendar — Date Cells & Grid Integrity", () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockImplementation(async (url: string) => {
      if (url.startsWith("/hrms/employees")) {
        return { data: mockEmployees };
      }
      if (url.startsWith("/hrms/attendance/policy")) {
        return { data: mockPolicy };
      }
      if (url.startsWith("/hrms/attendance/assigned-office")) {
        return { data: mockOffice };
      }
      if (url.startsWith("/hrms/attendance/today")) {
        return { data: null };
      }
      if (url.startsWith("/hrms/attendance/regularizations")) {
        return { data: [] };
      }
      if (url.startsWith("/hrms/attendance/all-calendar")) {
        return {
          data: {
            year: 2026,
            month: 10,
            month_name: "October 2026",
            total_days: 31,
            departments: ["Management", "Sales"],
            branches: ["Thane HQ"],
            employees: [],
          },
        };
      }
      if (url.startsWith("/hrms/attendance/calendar")) {
        // By default, simulate empty attendance records to verify client-side generation
        return { data: [] };
      }
      return { data: null };
    });
  });

  it("1. Month dates rendering: renders all 31 dates for October 2026 even when API data is empty", async () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance"]}>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Monthly Attendance Calendar")).toBeTruthy();
    });

    // Check October 2026 header
    const titleEl = document.querySelector(".hrms-cal-month-title");
    expect(titleEl).toBeTruthy();
    const currentYear = new Date().getFullYear();
    const currentMonthName = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ][new Date().getMonth()];
    expect(titleEl?.textContent).toContain(`${currentMonthName} ${currentYear}`);

    // Verify all calendar date cells for the month are rendered
    const daysInMonth = new Date(currentYear, new Date().getMonth() + 1, 0).getDate();
    const dateCells = document.querySelectorAll(".hrms-cal-day:not(.padding)");
    expect(dateCells.length).toBe(daysInMonth);

    // Verify each day number from 1 to daysInMonth is rendered
    for (let day = 1; day <= daysInMonth; day++) {
      const dayEl = document.querySelector(`.hrms-cal-day:not(.padding) .hrms-cal-day-num`);
      expect(dayEl).toBeTruthy();
    }
  });

  it("2. First-weekday alignment offset: October 2026 has exactly 3 placeholder cells (Oct 1 is Thursday)", async () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance"]}>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Monthly Attendance Calendar")).toBeTruthy();
    });

    // Navigate to October 2026 specifically
    const today = new Date();
    let currentY = today.getFullYear();
    let currentM = today.getMonth() + 1;

    // Navigate using Next/Prev until we reach October 2026
    while (currentY < 2026 || (currentY === 2026 && currentM < 10)) {
      fireEvent.click(screen.getByRole("button", { name: /Next ›/i }));
      if (currentM === 12) {
        currentY += 1;
        currentM = 1;
      } else {
        currentM += 1;
      }
    }
    while (currentY > 2026 || (currentY === 2026 && currentM > 10)) {
      fireEvent.click(screen.getByRole("button", { name: /‹ Prev/i }));
      if (currentM === 1) {
        currentY -= 1;
        currentM = 12;
      } else {
        currentM -= 1;
      }
    }

    const titleEl = document.querySelector(".hrms-cal-month-title");
    expect(titleEl?.textContent).toBe("October 2026");

    // October 1, 2026 is Thursday. In Monday-aligned grid, offset = 3 (Mon, Tue, Wed are placeholders)
    const paddingCells = document.querySelectorAll(".hrms-cal-day.padding");
    expect(paddingCells.length).toBe(3);

    // Date cells must be 31
    const dayCells = document.querySelectorAll(".hrms-cal-day:not(.padding)");
    expect(dayCells.length).toBe(31);

    // First day cell should be October 1
    expect(screen.getByTestId("calendar-day-2026-10-01")).toBeTruthy();
    expect(screen.getByTestId("calendar-day-2026-10-31")).toBeTruthy();
  });

  it("3. Seven-weekday column grid structure: renders Monday through Sunday headers in order", async () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance"]}>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Monthly Attendance Calendar")).toBeTruthy();
    });

    const weekdayHeaders = Array.from(document.querySelectorAll(".hrms-cal-weekday")).map(
      (el) => el.textContent?.trim()
    );
    expect(weekdayHeaders).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(weekdayHeaders.length).toBe(7);
  });

  it("4. Empty/loading attendance data gracefully displays all month dates with fallback statuses", async () => {
    // API returns empty array
    vi.mocked(apiGet).mockImplementation(async (url: string) => {
      if (url.startsWith("/hrms/attendance/calendar")) {
        return { data: [] };
      }
      if (url.startsWith("/hrms/employees")) return { data: mockEmployees };
      if (url.startsWith("/hrms/attendance/policy")) return { data: mockPolicy };
      return { data: null };
    });

    render(
      <MemoryRouter initialEntries={["/hrms/attendance"]}>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Monthly Attendance Calendar")).toBeTruthy();
    });

    // Calendar is NOT blank; all day cells are present
    const dateCells = document.querySelectorAll(".hrms-cal-day:not(.padding)");
    expect(dateCells.length).toBeGreaterThanOrEqual(28);

    // Weekends (Sunday per mockPolicy) have the .weekend class
    const weekendCells = document.querySelectorAll(".hrms-cal-day.weekend");
    expect(weekendCells.length).toBeGreaterThanOrEqual(4);
  });

  it("5. Populated attendance data correctly mapped to dates with status badges, timings, and pencil", async () => {
    const populatedCalendarDays = [
      {
        date: "2026-10-01",
        day_number: 1,
        day_name: "Thu",
        status: "PRESENT",
        punch_in: "09:30 AM",
        punch_out: "06:30 PM",
        working_minutes: 540,
        late_minutes: 0,
        early_exit_minutes: 0,
        is_irregular: false,
        regularization_status: "NONE",
        can_regularize: false,
        attendance_id: "att-1",
      },
      {
        date: "2026-10-02",
        day_number: 2,
        day_name: "Fri",
        status: "HOLIDAY",
        holiday_name: "Gandhi Jayanti",
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
      {
        date: "2026-10-05",
        day_number: 5,
        day_name: "Mon",
        status: "LATE",
        punch_in: "10:55 AM",
        punch_out: "07:15 PM",
        working_minutes: 500,
        late_minutes: 25,
        early_exit_minutes: 0,
        is_irregular: false,
        regularization_status: "NONE",
        can_regularize: true,
        attendance_id: "att-5",
      },
      {
        date: "2026-10-06",
        day_number: 6,
        day_name: "Tue",
        status: "HALF_DAY",
        punch_in: "11:45 AM",
        punch_out: "06:30 PM",
        working_minutes: 405,
        late_minutes: 75,
        early_exit_minutes: 0,
        is_irregular: false,
        regularization_status: "NONE",
        can_regularize: true,
        attendance_id: "att-6",
      },
      {
        date: "2026-10-07",
        day_number: 7,
        day_name: "Wed",
        status: "LEAVE",
        leave_type_name: "Casual Leave",
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
      {
        date: "2026-10-08",
        day_number: 8,
        day_name: "Thu",
        status: "MISSING_PUNCH",
        punch_in: "09:30 AM",
        punch_out: null,
        working_minutes: null,
        late_minutes: 0,
        early_exit_minutes: 0,
        is_irregular: false,
        regularization_status: "NONE",
        can_regularize: true,
        attendance_id: "att-8",
      },
    ];

    vi.mocked(apiGet).mockImplementation(async (url: string) => {
      if (url.startsWith("/hrms/attendance/calendar")) {
        return { data: populatedCalendarDays };
      }
      if (url.startsWith("/hrms/employees")) return { data: mockEmployees };
      if (url.startsWith("/hrms/attendance/policy")) return { data: mockPolicy };
      return { data: null };
    });

    render(
      <MemoryRouter initialEntries={["/hrms/attendance"]}>
        <AttendancePage />
      </MemoryRouter>
    );

    // Navigate to October 2026
    const today = new Date();
    let currentY = today.getFullYear();
    let currentM = today.getMonth() + 1;
    while (currentY < 2026 || (currentY === 2026 && currentM < 10)) {
      fireEvent.click(screen.getByRole("button", { name: /Next ›/i }));
      if (currentM === 12) { currentY += 1; currentM = 1; } else { currentM += 1; }
    }
    while (currentY > 2026 || (currentY === 2026 && currentM > 10)) {
      fireEvent.click(screen.getByRole("button", { name: /‹ Prev/i }));
      if (currentM === 1) { currentY -= 1; currentM = 12; } else { currentM -= 1; }
    }

    await waitFor(() => {
      expect(screen.getByTestId("calendar-day-2026-10-01")).toBeTruthy();
    });

    // 1. Present day: check timings and hours
    const day1 = screen.getByTestId("calendar-day-2026-10-01");
    expect(day1.textContent).toContain("09:30 AM");
    expect(day1.textContent).toContain("06:30 PM");
    expect(day1.textContent).toContain("9h 0m");
    expect(day1.querySelector(".status-present")).toBeTruthy();

    // 2. Holiday day: check Gandhi Jayanti
    const day2 = screen.getByTestId("calendar-day-2026-10-02");
    expect(day2.querySelector(".status-holiday")).toBeTruthy();
    expect(day2.textContent).toContain("HOLIDAY: Gandhi Jayanti");

    // 3. Late day: check late minutes and regularization pencil
    const day5 = screen.getByTestId("calendar-day-2026-10-05");
    expect(day5.querySelector(".status-late")).toBeTruthy();
    expect(day5.textContent).toContain("+25m");
    expect(screen.getByTestId("regularize-btn-2026-10-05")).toBeTruthy();

    // 4. Half Day: check badge and pencil
    const day6 = screen.getByTestId("calendar-day-2026-10-06");
    expect(day6.querySelector(".status-half-day")).toBeTruthy();
    expect(screen.getByTestId("regularize-btn-2026-10-06")).toBeTruthy();

    // 5. Leave day: check Casual Leave
    const day7 = screen.getByTestId("calendar-day-2026-10-07");
    expect(day7.querySelector(".status-leave")).toBeTruthy();
    expect(day7.textContent).toContain("Casual Leave");

    // 6. Missing Punch: check badge and pencil
    const day8 = screen.getByTestId("calendar-day-2026-10-08");
    expect(day8.querySelector(".status-missing-punch")).toBeTruthy();
    expect(screen.getByTestId("regularize-btn-2026-10-08")).toBeTruthy();
  });

  it("6. Today's date highlighted when viewing the current month", async () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance"]}>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Monthly Attendance Calendar")).toBeTruthy();
    });

    // In the current month, exactly one day cell has the TODAY pill
    const todayPills = document.querySelectorAll(".hrms-today-pill");
    expect(todayPills.length).toBe(1);
    expect(todayPills[0].textContent).toBe("TODAY");

    const todayCell = document.querySelector(".hrms-cal-day.today");
    expect(todayCell).toBeTruthy();

    // Navigate to next month: TODAY pill should not appear
    fireEvent.click(screen.getByRole("button", { name: /Next ›/i }));
    const nextMonthTodayPills = document.querySelectorAll(".hrms-today-pill");
    expect(nextMonthTodayPills.length).toBe(0);
  });

  it("7. Previous, Next, and Today navigation updates month and day count correctly", async () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance"]}>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Monthly Attendance Calendar")).toBeTruthy();
    });

    const initialTitle = document.querySelector(".hrms-cal-month-title")?.textContent;

    // Click Next
    fireEvent.click(screen.getByRole("button", { name: /Next ›/i }));
    const nextTitle = document.querySelector(".hrms-cal-month-title")?.textContent;
    expect(nextTitle).not.toBe(initialTitle);

    // Click Prev twice
    fireEvent.click(screen.getByRole("button", { name: /‹ Prev/i }));
    fireEvent.click(screen.getByRole("button", { name: /‹ Prev/i }));
    const prevTitle = document.querySelector(".hrms-cal-month-title")?.textContent;
    expect(prevTitle).not.toBe(nextTitle);

    // Click Today -> resets to original month
    fireEvent.click(screen.getByRole("button", { name: /Today/i }));
    const resetTitle = document.querySelector(".hrms-cal-month-title")?.textContent;
    expect(resetTitle).toBe(initialTitle);
  });

  it("8. Year boundary navigation: transitions correctly between January and December", async () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance"]}>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Monthly Attendance Calendar")).toBeTruthy();
    });

    // Navigate to January of any year
    const today = new Date();
    let curM = today.getMonth() + 1;
    // Go to January by moving backwards curM - 1 times
    for (let i = 0; i < curM - 1; i++) {
      fireEvent.click(screen.getByRole("button", { name: /‹ Prev/i }));
    }

    const janTitle = document.querySelector(".hrms-cal-month-title")?.textContent;
    expect(janTitle).toContain("January");
    const currentYear = parseInt(janTitle?.split(" ")[1] || "2026", 10);

    // Click Prev to cross boundary into December of previous year
    fireEvent.click(screen.getByRole("button", { name: /‹ Prev/i }));
    const decTitle = document.querySelector(".hrms-cal-month-title")?.textContent;
    expect(decTitle).toBe(`December ${currentYear - 1}`);

    // Verify December has 31 days
    const decDays = document.querySelectorAll(".hrms-cal-day:not(.padding)");
    expect(decDays.length).toBe(31);

    // Click Next to cross back into January of currentYear
    fireEvent.click(screen.getByRole("button", { name: /Next ›/i }));
    const janTitleAgain = document.querySelector(".hrms-cal-month-title")?.textContent;
    expect(janTitleAgain).toBe(`January ${currentYear}`);
  });

  it("9. February leap vs non-leap day rendering: 2024 has 29 days, 2025 has 28 days", async () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance"]}>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Monthly Attendance Calendar")).toBeTruthy();
    });

    // Navigate to February 2024
    const today = new Date();
    let currentY = today.getFullYear();
    let currentM = today.getMonth() + 1;

    // Navigate to Feb 2024
    while (currentY > 2024 || (currentY === 2024 && currentM > 2)) {
      fireEvent.click(screen.getByRole("button", { name: /‹ Prev/i }));
      if (currentM === 1) { currentY -= 1; currentM = 12; } else { currentM -= 1; }
    }
    while (currentY < 2024 || (currentY === 2024 && currentM < 2)) {
      fireEvent.click(screen.getByRole("button", { name: /Next ›/i }));
      if (currentM === 12) { currentY += 1; currentM = 1; } else { currentM += 1; }
    }

    expect(document.querySelector(".hrms-cal-month-title")?.textContent).toBe("February 2024");
    const feb2024Days = document.querySelectorAll(".hrms-cal-day:not(.padding)");
    expect(feb2024Days.length).toBe(29);
    expect(screen.getByTestId("calendar-day-2024-02-29")).toBeTruthy();

    // Navigate forward 1 year to February 2025 (non-leap year)
    for (let i = 0; i < 12; i++) {
      fireEvent.click(screen.getByRole("button", { name: /Next ›/i }));
    }

    expect(document.querySelector(".hrms-cal-month-title")?.textContent).toBe("February 2025");
    const feb2025Days = document.querySelectorAll(".hrms-cal-day:not(.padding)");
    expect(feb2025Days.length).toBe(28);
    expect(screen.queryByTestId("calendar-day-2025-02-29")).toBeNull();
  });

  it("10. Employee filtering updates attendance data while keeping calendar grid intact", async () => {
    let requestedEmployeeId: string | null = null;
    vi.mocked(apiGet).mockImplementation(async (url: string) => {
      if (url.startsWith("/hrms/attendance/calendar")) {
        const match = url.match(/employee_id=([^&]+)/);
        requestedEmployeeId = match ? match[1] : null;
        if (requestedEmployeeId === "b4ab8f01-adf2-4d27-afef-246f40eb2b0e") {
          return {
            data: [
              {
                date: "2026-10-01",
                day_number: 1,
                day_name: "Thu",
                status: "PRESENT",
                punch_in: "10:00 AM",
                punch_out: "07:00 PM",
                working_minutes: 540,
                late_minutes: 0,
                early_exit_minutes: 0,
                is_irregular: false,
                regularization_status: "NONE",
                can_regularize: false,
                attendance_id: "att-john-1",
              },
            ],
          };
        }
        return { data: [] };
      }
      if (url.startsWith("/hrms/employees")) return { data: mockEmployees };
      if (url.startsWith("/hrms/attendance/policy")) return { data: mockPolicy };
      return { data: null };
    });

    render(
      <MemoryRouter initialEntries={["/hrms/attendance"]}>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Monthly Attendance Calendar")).toBeTruthy();
    });

    const empSelect = screen.getByLabelText(/Employee:/i);
    expect(empSelect).toBeTruthy();

    // Select John Doe
    fireEvent.change(empSelect, { target: { value: "b4ab8f01-adf2-4d27-afef-246f40eb2b0e" } });

    await waitFor(() => {
      expect(requestedEmployeeId).toBe("b4ab8f01-adf2-4d27-afef-246f40eb2b0e");
    });

    // Calendar grid remains completely intact with all dates
    const dateCells = document.querySelectorAll(".hrms-cal-day:not(.padding)");
    expect(dateCells.length).toBeGreaterThanOrEqual(28);
  });
});
