import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AttendancePage, formatDateTimeIST, formatDateIST, TIMEZONE_IST } from "../hrms/AttendancePage";
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
      profile: { id: "user-1", username: "employee", role: "EMPLOYEE", full_name: "Inhyma Employee" },
      isSuperAdmin: false,
      hasPermission: () => false,
    }),
  };
});

describe("Day 3.6 IST Timezone & Absent Regularization Tests", () => {
  it("formatDateTimeIST and formatDateIST format correctly in Asia/Kolkata (IST)", () => {
    expect(TIMEZONE_IST).toBe("Asia/Kolkata");

    // 05:16:00 UTC is exactly 10:46 AM IST (+5:30)
    const formattedPunchIn = formatDateTimeIST("2026-09-28T05:16:00Z");
    expect(formattedPunchIn).toMatch(/10:46\s*AM/i);
    expect(formattedPunchIn).not.toContain("05:16");

    // 06:01:00 UTC is exactly 11:31 AM IST (+5:30)
    const formattedHalfDay = formatDateTimeIST("2026-09-28T06:01:00Z");
    expect(formattedHalfDay).toMatch(/11:31\s*AM/i);

    // Date formatting in IST
    const formattedDate = formatDateIST("2026-09-28T05:16:00Z");
    expect(formattedDate).toContain("28");
    expect(formattedDate).toContain("Sep");
    expect(formattedDate).toContain("2026");
  });

  it("renders Absent day with pencil icon and opens Regularization Drawer with 7 reasons", async () => {
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
      address: "Lodha Supremus, Thane West",
      latitude: 19.199824,
      longitude: 72.956795,
      radius_meters: 150.0,
    };

    const mockCalendarDays = [
      {
        date: "2026-09-08",
        day_number: 8,
        day_name: "Tue",
        status: "ABSENT",
        punch_in: null,
        punch_out: null,
        working_minutes: null,
        late_minutes: 0,
        early_exit_minutes: 0,
        is_irregular: false,
        regularization_status: "NONE",
        can_regularize: true,
        attendance_id: null,
      },
    ];

    vi.mocked(apiModule.apiGet).mockImplementation(async (url: string) => {
      if (url.includes("/hrms/attendance/policy")) return { data: mockPolicy } as any;
      if (url.includes("/hrms/attendance/assigned-office")) return { data: mockOffice } as any;
      if (url.includes("/hrms/attendance/today")) return { data: null } as any;
      if (url.includes("/hrms/attendance/calendar")) return { data: mockCalendarDays } as any;
      if (url.includes("/hrms/attendance/regularizations")) return { data: [] } as any;
      return { data: null } as any;
    });

    vi.mocked(apiModule.apiPost).mockResolvedValue({
      data: {
        id: "reg-new-1",
        status: "PENDING",
        reason: "Work From Home",
        punch_in_time: "10:30 AM",
        punch_out_time: "07:00 PM",
      },
    } as any);

    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    // Wait for Absent day to appear
    await waitFor(() => {
      expect(screen.getByTestId("calendar-day-2026-09-08")).toBeDefined();
    });

    // Check pencil icon on Absent day
    const pencilBtn = screen.getByTestId("regularize-btn-2026-09-08");
    expect(pencilBtn).toBeDefined();

    // Click pencil icon to open drawer
    fireEvent.click(pencilBtn);

    // Verify Drawer opens
    await waitFor(() => {
      expect(screen.getByTestId("regularization-drawer")).toBeDefined();
    });

    // Check prefilled fields
    const punchInInput = screen.getByTestId("regularization-punch-in-input") as HTMLInputElement;
    const punchOutInput = screen.getByTestId("regularization-punch-out-input") as HTMLInputElement;
    expect(punchInInput.value).toBe("10:30");
    expect(punchOutInput.value).toBe("19:00");

    // Check auto-calculated total hours
    const totalHoursBadge = screen.getByTestId("regularization-total-hours");
    expect(totalHoursBadge.textContent).toContain("8h30m");

    // Verify all 7 required reasons exist in the dropdown
    const reasonSelect = screen.getByTestId("regularization-reason-select") as HTMLSelectElement;
    const options = Array.from(reasonSelect.options).map((o) => o.value);
    const expectedReasons = [
      "Work From Home",
      "Missing Punch",
      "Client Meeting",
      "Medical Emergency",
      "Traffic Delay",
      "GPS Issue",
      "Other",
    ];
    for (const reason of expectedReasons) {
      expect(options).toContain(reason);
    }

    // Fill Remarks (Required)
    const noteInput = screen.getByTestId("regularization-note-input");
    fireEvent.change(noteInput, { target: { value: "Worked remotely due to planned maintenance." } });

    // Submit regularization request
    const submitBtn = screen.getByTestId("submit-regularization-btn");
    fireEvent.click(submitBtn);

    // Verify apiPost called with correct payload
    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith(
        "/hrms/attendance/regularization",
        expect.objectContaining({
          date: "2026-09-08",
          reason: "Work From Home",
          punch_in: "10:30 AM",
          punch_out: "7:00 PM",
        })
      );
    });
  });
});
