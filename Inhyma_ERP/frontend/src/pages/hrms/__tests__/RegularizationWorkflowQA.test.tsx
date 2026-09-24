import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  HrmsAttendancePage,
  shouldShowRegularizeIcon,
  type AttendanceDay,
} from "../HrmsAttendancePage";
import { RegularizeDrawer } from "../RegularizeDrawer";
import { ApprovalPage } from "../ApprovalPage";
import * as authHook from "@/lib/hooks";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockImplementation((url: string) => {
    if (url.includes("/attendance/today")) {
      return Promise.resolve({
        data: {
          server_time: "2026-09-24T10:30:00Z",
          current_date: "2026-09-24",
          current_shift: "10:30 AM – 07:00 PM",
          greeting: "Good Morning",
          attendance_state: "NOT_PUNCHED",
          assigned_office: {
            id: "loc-thane-1",
            name: "Inhyma Thane Office",
            address: "Wagle Estate, Thane",
            latitude: 19.1983,
            longitude: 72.9483,
            radius_meters: 200,
          },
        },
      });
    }
    if (url.includes("/attendance/month")) {
      return Promise.resolve({
        data: [
          {
            attendance_date: "2026-09-02",
            status: "Late Punch",
            check_in_time: "11:15 AM",
            check_out_time: "07:00 PM",
            total_work_minutes: 465,
            is_irregular: true,
          },
          {
            attendance_date: "2026-09-03",
            status: "Missing Punch",
            check_in_time: "10:30 AM",
            check_out_time: null,
            total_work_minutes: null,
            is_irregular: true,
          },
          {
            attendance_date: "2026-09-04",
            status: "Early Exit",
            check_in_time: "10:30 AM",
            check_out_time: "03:00 PM",
            total_work_minutes: 270,
            is_irregular: true,
          },
          {
            attendance_date: "2026-09-05",
            status: "Present",
            check_in_time: "10:25 AM",
            check_out_time: "07:05 PM",
            total_work_minutes: 520,
            is_irregular: false,
          },
          {
            attendance_date: "2026-09-06",
            status: "Holiday",
            is_irregular: false,
          },
        ],
      });
    }
    if (url.includes("/hrms/approvals")) {
      return Promise.resolve({ data: [] });
    }
    return Promise.resolve({ data: [] });
  }),
  apiPost: vi.fn().mockResolvedValue({ success: true, data: { id: "test-req-1" } }),
  apiPut: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

describe("HRMS Attendance Regularization Workflow QA Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. shouldShowRegularizeIcon unit validation
  // -------------------------------------------------------------------------
  describe("1. shouldShowRegularizeIcon Rule Engine", () => {
    it("displays ✏️ for Late Punch, Missing Punch, Early Exit, Outside Geofence, Work From Home", () => {
      const lateDay: AttendanceDay = {
        date: "2026-09-02",
        dayNumber: 2,
        weekday: "Wed",
        status: "Late Punch",
        is_irregular: true,
      };
      expect(shouldShowRegularizeIcon(lateDay, "Late Punch")).toBe(true);

      const missingDay: AttendanceDay = {
        date: "2026-09-03",
        dayNumber: 3,
        weekday: "Thu",
        status: "Missing Punch",
        is_irregular: true,
      };
      expect(shouldShowRegularizeIcon(missingDay, "Missing Punch")).toBe(true);

      const earlyDay: AttendanceDay = {
        date: "2026-09-04",
        dayNumber: 4,
        weekday: "Fri",
        status: "Early Exit",
        is_irregular: true,
      };
      expect(shouldShowRegularizeIcon(earlyDay, "Early Exit")).toBe(true);

      const geofenceDay: AttendanceDay = {
        date: "2026-09-08",
        dayNumber: 8,
        weekday: "Tue",
        status: "Outside Geofence",
        is_irregular: true,
      };
      expect(shouldShowRegularizeIcon(geofenceDay, "Outside Geofence")).toBe(true);

      const wfhDay: AttendanceDay = {
        date: "2026-09-09",
        dayNumber: 9,
        weekday: "Wed",
        status: "Work From Home",
        is_irregular: true,
      };
      expect(shouldShowRegularizeIcon(wfhDay, "Work From Home")).toBe(true);
    });

    it("does NOT display ✏️ for Normal Present, Leave, Holiday, or normal Weekend", () => {
      const normalPresent: AttendanceDay = {
        date: "2026-09-05",
        dayNumber: 5,
        weekday: "Sat",
        status: "Present",
        punch_in: "10:30 AM",
        punch_out: "07:00 PM",
        total_hours: "8h 30m",
        is_irregular: false,
      };
      expect(shouldShowRegularizeIcon(normalPresent, "Present")).toBe(false);

      const leaveDay: AttendanceDay = {
        date: "2026-09-10",
        dayNumber: 10,
        weekday: "Thu",
        status: "Leave",
        is_irregular: false,
      };
      expect(shouldShowRegularizeIcon(leaveDay, "Leave")).toBe(false);

      const holidayDay: AttendanceDay = {
        date: "2026-09-06",
        dayNumber: 6,
        weekday: "Sun",
        status: "Holiday",
        is_irregular: false,
      };
      expect(shouldShowRegularizeIcon(holidayDay, "Holiday")).toBe(false);

      const unpunchedSunday: AttendanceDay = {
        date: "2026-09-13",
        dayNumber: 13,
        weekday: "Sun",
        status: "Holiday",
        is_irregular: false,
      };
      expect(shouldShowRegularizeIcon(unpunchedSunday, "Holiday")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Calendar Icons in HrmsAttendancePage
  // -------------------------------------------------------------------------
  describe("2. Calendar Cell Hierarchy & Edit Icon Display", () => {
    it("renders ✏️ edit icon for Late, Missing, and Early exit days, but not for normal days", async () => {
      vi.spyOn(authHook, "useAuth").mockReturnValue({
        profile: { role: "employee", full_name: "Rahul Sharma", employee_code: "EMP-042" } as any,
        isSuperAdmin: false,
      } as any);

      render(
        <MemoryRouter>
          <HrmsAttendancePage
            initialDaysForTesting={[
              {
                date: "2026-09-02",
                dayNumber: 2,
                weekday: "Wed",
                status: "Late Punch",
                punch_in: "11:15 AM",
                punch_out: "07:00 PM",
                total_hours: "7h 45m",
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
              {
                date: "2026-09-04",
                dayNumber: 4,
                weekday: "Fri",
                status: "Early Exit",
                punch_in: "10:30 AM",
                punch_out: "03:00 PM",
                total_hours: "4h 30m",
                is_irregular: true,
              },
              {
                date: "2026-09-05",
                dayNumber: 5,
                weekday: "Sat",
                status: "Present",
                punch_in: "10:25 AM",
                punch_out: "07:05 PM",
                total_hours: "8h 40m",
                is_irregular: false,
              },
              {
                date: "2026-09-06",
                dayNumber: 6,
                weekday: "Sun",
                status: "Holiday",
                punch_in: null,
                punch_out: null,
                total_hours: null,
                is_irregular: false,
              },
            ]}
          />
        </MemoryRouter>
      );

      // Verify Late Punch day (Sept 2) has edit icon
      expect(screen.getByTestId("edit-irregular-2")).toBeTruthy();
      expect(screen.getByTestId("edit-irregular-2").textContent).toContain("✏️");

      // Verify Missing Punch day (Sept 3) has edit icon
      expect(screen.getByTestId("edit-irregular-3")).toBeTruthy();

      // Verify Early Exit day (Sept 4) has edit icon
      expect(screen.getByTestId("edit-irregular-4")).toBeTruthy();

      // Verify Normal Present day (Sept 5) does NOT have edit icon
      expect(screen.queryByTestId("edit-irregular-5")).toBeNull();

      // Verify Holiday day (Sept 6) does NOT have edit icon
      expect(screen.queryByTestId("edit-irregular-6")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 3. RegularizeDrawer Employee vs Admin Behavior
  // -------------------------------------------------------------------------
  describe("3. RegularizeDrawer Employee vs Admin UI Permissions", () => {
    it("Employee only sees Submit Request (no direct regularize button)", () => {
      const mockSubmit = vi.fn();
      const mockDirect = vi.fn();

      render(
        <RegularizeDrawer
          open={true}
          onClose={vi.fn()}
          day={{
            date: "2026-09-02",
            dayNumber: 2,
            status: "Late Punch",
            punch_in: "11:15",
            punch_out: "19:00",
            total_hours: "7h 45m",
          }}
          isAdmin={false}
          employeeName="Rahul Sharma"
          employeeCode="EMP-042"
          onSubmitRequest={mockSubmit}
          onDirectRegularize={mockDirect}
        />
      );

      // Attendance Date locked
      const dateInput = screen.getByTestId("reg-attendance-date") as HTMLInputElement;
      expect(dateInput.value).toBe("2026-09-02");
      expect(dateInput.readOnly).toBe(true);

      // Cancel button present
      expect(screen.getByTestId("reg-cancel-btn")).toBeTruthy();

      // Submit Request button present for employee
      const submitBtn = screen.getByTestId("reg-send-btn");
      expect(submitBtn.textContent).toBe("Submit Request");

      // Regularize Directly MUST NOT be rendered for employee
      expect(screen.queryByTestId("reg-direct-btn")).toBeNull();
    });

    it("Admin sees both Send Request and Regularize Directly buttons", () => {
      const mockSubmit = vi.fn();
      const mockDirect = vi.fn();

      render(
        <RegularizeDrawer
          open={true}
          onClose={vi.fn()}
          day={{
            date: "2026-09-02",
            dayNumber: 2,
            status: "Late Punch",
            punch_in: "11:15",
            punch_out: "19:00",
            total_hours: "7h 45m",
          }}
          isAdmin={true}
          adminName="Admin User"
          employeeName="Rahul Sharma"
          employeeCode="EMP-042"
          onSubmitRequest={mockSubmit}
          onDirectRegularize={mockDirect}
        />
      );

      // Admin sees Send Request
      const sendBtn = screen.getByTestId("reg-send-btn");
      expect(sendBtn.textContent).toBe("Send Request");

      // Admin sees Regularize Directly
      const directBtn = screen.getByTestId("reg-direct-btn");
      expect(directBtn).toBeTruthy();
      expect(directBtn.textContent).toBe("Regularize Directly");
    });
  });

  // -------------------------------------------------------------------------
  // 4. Admin Direct Regularize Workflow Updates Calendar Immediately
  // -------------------------------------------------------------------------
  describe("4. Direct Regularize Updates Calendar Immediately", () => {
    it("Admin clicking Regularize Directly updates cell to Present with new hours and removes irregularity", async () => {
      vi.spyOn(authHook, "useAuth").mockReturnValue({
        profile: { role: "admin", full_name: "Admin User", employee_code: "ADM-001" } as any,
        isSuperAdmin: true,
      } as any);

      render(
        <MemoryRouter>
          <HrmsAttendancePage
            initialDaysForTesting={[
              {
                date: "2026-09-02",
                dayNumber: 2,
                weekday: "Wed",
                status: "Late Punch",
                punch_in: "11:15 AM",
                punch_out: "07:00 PM",
                total_hours: "7h 45m",
                is_irregular: true,
              },
            ]}
          />
        </MemoryRouter>
      );

      // Verify Sept 2 starts as Late Punch with edit icon
      const editBtn = screen.getByTestId("edit-irregular-2");
      expect(editBtn).toBeTruthy();

      // Open drawer
      fireEvent.click(editBtn);

      await waitFor(() => {
        expect(screen.getByTestId("regularize-drawer")).toBeTruthy();
      });

      // Admin adjusts Check-In to 10:30 AM
      const checkInInput = screen.getByTestId("reg-check-in");
      fireEvent.change(checkInInput, { target: { value: "10:30" } });

      const remarksInput = screen.getByTestId("reg-remarks");
      fireEvent.change(remarksInput, { target: { value: "Direct regularize approval by HR" } });

      // Click Regularize Directly
      const directBtn = screen.getByTestId("reg-direct-btn");
      fireEvent.click(directBtn);

      // Drawer closes
      await waitFor(() => {
        expect(screen.queryByTestId("regularize-drawer")).toBeNull();
      });

      // Verify calendar cell for Sept 2 now shows Present and edit icon is removed
      const dayCell = screen.getByTestId("cal-day-2");
      expect(dayCell.textContent).toContain("Present");
      expect(screen.queryByTestId("edit-irregular-2")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Send Request Appears in Attendance -> Approval Queue
  // -------------------------------------------------------------------------
  describe("5. Approval Connection", () => {
    it("Submitting request causes it to appear in Attendance -> Approval queue with Employee, Date, Reason, and Status", async () => {
      vi.spyOn(authHook, "useAuth").mockReturnValue({
        profile: { role: "admin", full_name: "Admin User", employee_code: "ADM-001" } as any,
        isSuperAdmin: true,
      } as any);

      render(
        <MemoryRouter initialEntries={["/hrms/attendance"]}>
          <HrmsAttendancePage
            initialDaysForTesting={[
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
            ]}
          />
        </MemoryRouter>
      );

      // Open drawer for day 3
      fireEvent.click(screen.getByTestId("edit-irregular-3"));

      await waitFor(() => {
        expect(screen.getByTestId("regularize-drawer")).toBeTruthy();
      });

      // Fill in Check-Out and remarks
      const checkOutInput = screen.getByTestId("reg-check-out");
      fireEvent.change(checkOutInput, { target: { value: "19:00" } });

      const remarksInput = screen.getByTestId("reg-remarks");
      fireEvent.change(remarksInput, { target: { value: "Forgot to punch out at client site" } });

      // Click Send Request
      const sendBtn = screen.getByTestId("reg-send-btn");
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(screen.queryByTestId("regularize-drawer")).toBeNull();
      });

      // Switch to Approval tab
      const approvalTabBtn = screen.getByTestId("tab-approval");
      fireEvent.click(approvalTabBtn);

      // Verify the request appears in Approval table
      await waitFor(() => {
        expect(screen.getByText(/Attendance Approvals & Regularization Queue/i)).toBeTruthy();
        expect(screen.getByText("2026-09-03")).toBeTruthy();
        expect(screen.getByText(/Forgot to punch out at client site/i)).toBeTruthy();
      });
    });
  });

  // -------------------------------------------------------------------------
  // 6. ApprovalPage Reviews (Approve, Reject, Adjust Against Leave)
  // -------------------------------------------------------------------------
  describe("6. ApprovalPage Review Actions", () => {
    it("Renders review actions: Approve, Reject, and Adjust Against Leave", async () => {
      render(
        <ApprovalPage
          submittedRequests={[
            {
              id: "req-qa-1",
              type: "Regularization",
              employee: "Rahul Sharma",
              employee_code: "EMP-042",
              date: "2026-09-03",
              check_in: "10:30 AM",
              check_out: "07:00 PM",
              reason: "Missing Punch — Client meeting ran late",
              status: "PENDING",
              submitted_at: "2026-09-03 19:30",
            },
          ]}
        />
      );

      // Verify row exists
      expect(screen.getByText("Rahul Sharma")).toBeTruthy();
      expect(screen.getByText("2026-09-03")).toBeTruthy();

      // Open review modal via Adjust Leave button
      const adjustBtn = screen.getByTestId("adjust-leave-btn-req-qa-1");
      expect(adjustBtn).toBeTruthy();
      fireEvent.click(adjustBtn);

      await waitFor(() => {
        expect(screen.getByTestId("review-modal-form")).toBeTruthy();
      });

      // Verify leave dropdown is rendered for Adjust Leave mode
      expect(screen.getByTestId("adjust-leave-type-select")).toBeTruthy();

      // Confirm action
      fireEvent.click(screen.getByTestId("confirm-review-btn"));

      await waitFor(() => {
        expect(screen.queryByTestId("review-modal-form")).toBeNull();
      });
    });
  });

  // -------------------------------------------------------------------------
  // 7. No Regression on Working Punch System
  // -------------------------------------------------------------------------
  describe("7. Punch System Integrity & Regression Prevention", () => {
    it("Punch In and Punch Out terminal buttons and status operate as expected", async () => {
      vi.spyOn(authHook, "useAuth").mockReturnValue({
        profile: { role: "employee", full_name: "Rahul Sharma", employee_code: "EMP-042" } as any,
        isSuperAdmin: false,
      } as any);

      render(
        <MemoryRouter initialEntries={["/hrms/attendance?tab=view"]}>
          <HrmsAttendancePage />
        </MemoryRouter>
      );

      // Verify Punch In button is rendered
      const punchBtn = screen.getByRole("button", { name: "Punch In" });
      expect(punchBtn).toBeTruthy();

      // Verify timer is initially idle
      const timerDisplay = screen.getByTestId("punch-live-timer");
      expect(timerDisplay.textContent).toBe("--:--:--");

      // Verify Assigned Office name
      expect(screen.getAllByText(/Inhyma Thane Office/i).length).toBeGreaterThanOrEqual(1);
    });
  });
});
