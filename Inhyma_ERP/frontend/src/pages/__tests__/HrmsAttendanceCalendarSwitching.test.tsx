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

let mockCurrentUser = {
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
  {
    id: "7fe1352f-82f5-45df-bf3c-554c35d80cfc",
    first_name: "Operations",
    last_name: "Employee",
    full_name: "Operations Employee",
    employee_code: "EMP-004",
    department: "Operations",
    role: "employee",
  },
];

const mockCalendarDays = Array.from({ length: 31 }, (_, i) => ({
  date: `2026-10-${String(i + 1).padStart(2, "0")}`,
  day_number: i + 1,
  day_name: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][i % 7],
  status: i % 7 === 0 || i % 7 === 6 ? "WEEKEND" : "PRESENT",
  is_weekend: i % 7 === 0 || i % 7 === 6,
  is_holiday: false,
  punch_in: "2026-10-01T09:00:00Z",
  punch_out: "2026-10-01T17:30:00Z",
  total_hours: "8h 30m",
  worked_duration: "8h 30m",
}));

const mockAllCalendarMatrix = {
  year: 2026,
  month: 10,
  month_name: "October 2026",
  total_days: 31,
  departments: ["Management", "Sales", "Operations"],
  branches: ["Main Office", "Warehouse"],
  employees: [
    {
      employee_id: "b4ab8f01-adf2-4d27-afef-246f40eb2b0e",
      employee_code: "EMP-001",
      employee_name: "John Doe",
      department: "Sales",
      branch: "Main Office",
      summary: { present_days: 20, absent_days: 0, late_days: 1, leave_days: 0 },
      dates: {},
    },
    {
      employee_id: "7fe1352f-82f5-45df-bf3c-554c35d80cfc",
      employee_code: "EMP-004",
      employee_name: "Operations Employee",
      department: "Operations",
      branch: "Warehouse",
      summary: { present_days: 22, absent_days: 0, late_days: 0, leave_days: 0 },
      dates: {},
    },
  ],
};

const mockPolicy = {
  id: "pol-1",
  shift_name: "Standard Day Shift",
  shift_start_time: "10:30",
  shift_end_time: "19:00",
  grace_period_minutes: 15,
  grace_end_time: "10:45",
  direct_half_day_time: "11:31",
  geofence_radius_meters: 100,
};

const mockOffice = {
  id: "off-1",
  name: "Inhyma Thane HQ",
  address: "Thane West",
  latitude: 19.2183,
  longitude: 72.9781,
  radius_meters: 100,
};

describe("HRMS Attendance — Employee-Specific Calendar & RBAC Verification", () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockImplementation(async (url: string) => {
      if (url.startsWith("/hrms/employees")) {
        return { data: mockEmployees };
      }
      if (url.startsWith("/hrms/attendance/all-calendar")) {
        return { data: mockAllCalendarMatrix };
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
      if (url.startsWith("/hrms/attendance/calendar")) {
        return { data: mockCalendarDays };
      }
      if (url.startsWith("/hrms/attendance/regularizations")) {
        return { data: [] };
      }
      return { data: null };
    });
  });

  it("1. Renders Attendance page with employee selector for privileged user", async () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance"]}>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Monthly Attendance Calendar")).toBeTruthy();
    });

    // Employee selection dropdown exists for privileged user
    const selectEl = screen.getByLabelText(/Employee:/i);
    expect(selectEl).toBeTruthy();
  });

  it("2. Switches to All Employees matrix and displays EMP-001 and EMP-004", async () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance?view=all"]}>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("All Employees Attendance Calendar")).toBeTruthy();
    });

    // Verify employee codes are displayed instead of raw UUIDs
    await waitFor(() => {
      expect(screen.getByText("EMP-001")).toBeTruthy();
      expect(screen.getByText("John Doe")).toBeTruthy();
      expect(screen.getByText("EMP-004")).toBeTruthy();
    });
  });

  it("3. Clicking 'Open' for John Doe switches to John's individual calendar with banner", async () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance?view=all"]}>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("EMP-001")).toBeTruthy();
    });

    // Find and click the 'Open' button for John
    const openButtons = screen.getAllByRole("button", { name: /^Open$/i });
    expect(openButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(openButtons[0]);

    // Calendar should update to John Doe's calendar
    await waitFor(() => {
      expect(screen.getByText(/Viewing Attendance: John Doe/i)).toBeTruthy();
      expect(screen.getByText(/John Doe \(EMP-001\) — Monthly Attendance Calendar/i)).toBeTruthy();
    });
  });

  it("4. URL query params correctly load specific employee on direct navigation", async () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance?employee_id=b4ab8f01-adf2-4d27-afef-246f40eb2b0e&view=individual"]}>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Viewing Attendance: John Doe/i)).toBeTruthy();
      expect(screen.getByText(/John Doe \(EMP-001\) — Monthly Attendance Calendar/i)).toBeTruthy();
    });
  });

  it("5. Preserves selected employee across month navigation", async () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance?employee_id=b4ab8f01-adf2-4d27-afef-246f40eb2b0e&view=individual"]}>
        <AttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Viewing Attendance: John Doe/i)).toBeTruthy();
    });

    // Navigate to previous month
    const prevBtn = screen.getByRole("button", { name: /‹ Prev/i });
    fireEvent.click(prevBtn);

    // Selected employee remains John Doe
    await waitFor(() => {
      expect(screen.getByText(/Viewing Attendance: John Doe/i)).toBeTruthy();
      expect(screen.getByText(/John Doe \(EMP-001\) — Monthly Attendance Calendar/i)).toBeTruthy();
    });
  });
});
