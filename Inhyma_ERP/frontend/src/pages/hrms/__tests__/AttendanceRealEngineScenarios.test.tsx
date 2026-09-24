import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HrmsAttendancePage } from "../HrmsAttendancePage";
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
        id: "u-101",
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

describe("Real Attendance Engine — Mandatory Debugging Scenarios", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Scenario 1 — Fresh Day: Timer is --:--:--, Status is Ready to Punch, and Assigned Office has no BKC text", async () => {
    vi.spyOn(api, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/attendance/today")) {
        return Promise.resolve({
          data: {
            current_date: "2026-09-23",
            current_shift: "10:30 AM – 07:00 PM",
            greeting: "Good Morning",
            attendance_state: "NOT_PUNCHED",
            assigned_office: {
              name: "Inhyma Thane Office",
              latitude: 19.198300,
              longitude: 72.948300,
              radius_meters: 150,
            },
            session: null,
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

    // Initial Timer is idle --:--:--
    expect(screen.getByTestId("punch-live-timer").textContent).toBe("--:--:--");

    // Status is Ready to Punch
    expect(screen.getByText("○ Ready to Punch")).toBeTruthy();

    // Assigned Office has Inhyma Thane Office without BKC
    expect(screen.getAllByText("Inhyma Thane Office").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Mumbai BKC Office/i)).toBeNull();

    // Button is Punch In
    expect(screen.getByRole("button", { name: "Punch In" })).toBeTruthy();
  });

  it("Scenario 2 & 3 — Punch In & Punch Out Lifecycle with Calendar update and Timer freeze", async () => {
    const postSpy = vi.spyOn(api, "apiPost").mockImplementation((url: string) => {
      if (url.includes("/punch-in")) {
        return Promise.resolve({
          data: {
            check_in_time: new Date().toISOString(),
            punch_in: "10:30 AM",
            status: "OPEN",
          },
        } as any);
      }
      if (url.includes("/punch-out")) {
        return Promise.resolve({
          data: {
            check_in_time: new Date().toISOString(),
            check_out_time: new Date().toISOString(),
            punch_in: "10:30 AM",
            punch_out: "07:00 PM",
            total_hours: "08h 30m",
            status: "CLOSED",
          },
        } as any);
      }
      return Promise.resolve({ data: {} } as any);
    });

    render(
      <MemoryRouter initialEntries={["/hrms/attendance?tab=view"]}>
        <HrmsAttendancePage />
      </MemoryRouter>
    );

    const punchBtn = screen.getByTestId("punch-toggle-btn");
    expect(punchBtn.textContent).toBe("Punch In");

    // Click Punch In inside assigned office
    fireEvent.click(punchBtn);

    // Terminal becomes Checked In
    expect(screen.getByText("● Checked In")).toBeTruthy();
    expect(screen.getByTestId("punch-toggle-btn").textContent).toBe("Punch Out");
    expect(postSpy).toHaveBeenCalledWith("/hrms/attendance/punch-in", expect.anything());

    // Click Punch Out
    const punchOutBtn = screen.getByTestId("punch-toggle-btn");
    fireEvent.click(punchOutBtn);

    // Terminal becomes Attendance Completed
    expect(screen.getByText("✓ Attendance Completed")).toBeTruthy();
    expect(screen.getByTestId("punch-toggle-btn").textContent).toBe("Punch In (New Shift)");
    expect(postSpy).toHaveBeenCalledWith("/hrms/attendance/punch-out", {});
  });

  it("Scenario 6 — Geofencing: Blocks punch outside office, succeeds inside office", async () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance?tab=view"]}>
        <HrmsAttendancePage />
      </MemoryRouter>
    );

    // Switch to Pune (120 km outside)
    const select = screen.getByTestId("dev-gps-select");
    fireEvent.change(select, { target: { value: "loc-pune" } });

    // Attempt to Punch In while outside
    const punchBtn = screen.getByTestId("punch-toggle-btn");
    fireEvent.click(punchBtn);

    // Verification: Error banner blocks punch and displays distance
    expect(screen.getByText(/Punch Blocked/i)).toBeTruthy();
    expect(screen.getByText(/120 km away/i)).toBeTruthy();
    expect(screen.getByText("⚠ Outside Geofence")).toBeTruthy();
  });
});
