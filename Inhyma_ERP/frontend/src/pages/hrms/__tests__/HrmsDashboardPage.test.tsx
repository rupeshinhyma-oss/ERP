import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { HrmsAttendancePage } from "../HrmsAttendancePage";
import { HrmsLandingDashboardPage } from "../HrmsLandingDashboardPage";
import { NAV_SECTIONS } from "@/lib/nav";

// Mock AppShell to focus test assertions on HRMS page content and active key binding
vi.mock("@/components/AppShell", () => ({
  AppShell: ({
    children,
    activeKey,
  }: {
    children: React.ReactNode;
    activeKey: string;
  }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mutable mock user auth state
let mockCurrentUser = {
  profile: {
    id: "u-101",
    full_name: "Rupesh Malla",
    username: "rupesh",
    employee_code: "EMP-007",
    roles: ["General Manager"],
    role: "admin",
  },
  isSuperAdmin: true,
  hasPermission: () => true,
};

vi.mock("@/lib/hooks", async () => {
  const actual = await vi.importActual<any>("@/lib/hooks");
  return {
    ...actual,
    useAuth: () => mockCurrentUser,
  };
});

describe("Inhyma ERP HRMS — Navigation & Attendance Module", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.clearAllMocks();
    mockCurrentUser = {
      profile: {
        id: "u-101",
        full_name: "Rupesh Malla",
        username: "rupesh",
        employee_code: "EMP-007",
        roles: ["General Manager"],
        role: "admin",
      },
      isSuperAdmin: true,
      hasPermission: () => true,
    };
  });

  it("verifies sidebar navigation contains single HRMS module with exactly two submenus (Attendance, Setup)", () => {
    const hrmsSection = NAV_SECTIONS.find((s) => s.label === "HRMS");
    expect(hrmsSection).toBeDefined();
    expect(hrmsSection?.items).toHaveLength(1);

    const hrmsNav = hrmsSection?.items[0];
    expect(hrmsNav?.key).toBe("hrms");
    expect(hrmsNav?.path).toBe("/hrms/attendance");
    expect(hrmsNav?.children).toBeDefined();
    expect(hrmsNav?.children).toHaveLength(2);

    const childKeys = hrmsNav?.children?.map((c) => c.key);
    expect(childKeys).toEqual([
      "hrms-attendance",
      "hrms-setup",
    ]);

    // Setup requires admin permission in nav
    const setupNav = hrmsNav?.children?.find((c) => c.key === "hrms-setup");
    expect(setupNav?.permission).toBe("hrms.admin");
  });

  it("renders HRMS Landing Dashboard (/hrms/dashboard) with welcome section, KPIs, quick actions, and holiday calendar", () => {
    render(
      <MemoryRouter>
        <HrmsLandingDashboardPage />
      </MemoryRouter>
    );

    const shell = screen.getByTestId("app-shell");
    expect(shell.getAttribute("data-active-key")).toBe("hrms");

    // Welcome section
    expect(screen.getByTestId("welcome-section")).toBeTruthy();
    expect(screen.getByText(/Rupesh Malla/i)).toBeTruthy();

    // Summary KPIs
    expect(screen.getByTestId("attendance-summary-section")).toBeTruthy();
    expect(screen.getByText("Present Today")).toBeTruthy();
    expect(screen.getByText("Working Hours Today")).toBeTruthy();
    expect(screen.getByText("This Month Attendance")).toBeTruthy();
    expect(screen.getByText("Leave Balance")).toBeTruthy();

    // Quick actions & Holiday widget
    expect(screen.getByTestId("quick-actions-section")).toBeTruthy();
    expect(screen.getByTestId("holiday-calendar-section")).toBeTruthy();
  });

  it("renders Attendance Page with activeKey='hrms' and displays strictly 3 internal tabs (View, Approval, Settings)", () => {
    render(
      <BrowserRouter>
        <HrmsAttendancePage />
      </BrowserRouter>
    );

    const shell = screen.getByTestId("app-shell");
    expect(shell.getAttribute("data-active-key")).toBe("hrms");

    expect(screen.getByTestId("tab-view")).toBeTruthy();
    expect(screen.getByTestId("tab-approval")).toBeTruthy();
    expect(screen.getByTestId("tab-settings")).toBeTruthy();
  });

  it("hides Settings tab from non-admin employees on Attendance page", () => {
    mockCurrentUser = {
      profile: {
        id: "u-102",
        full_name: "Rahul Verma",
        username: "rahul",
        employee_code: "EMP-042",
        roles: ["Software Engineer"],
        role: "employee",
      },
      isSuperAdmin: false,
      hasPermission: () => false,
    };

    render(
      <MemoryRouter initialEntries={["/hrms/attendance?tab=settings"]}>
        <HrmsAttendancePage />
      </MemoryRouter>
    );

    // Regular employee sees only View and Approval
    expect(screen.getByTestId("tab-view")).toBeTruthy();
    expect(screen.getByTestId("tab-approval")).toBeTruthy();
    expect(screen.queryByTestId("tab-settings")).toBeNull();

    // Default redirected away from settings to view
    expect(screen.getByTestId("attendance-view-container")).toBeTruthy();
  });

  it("renders Attendance View with Punch Card, Live Working Timer, Assigned Office, and Location Status", () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance?tab=view"]}>
        <HrmsAttendancePage />
      </MemoryRouter>
    );

    expect(screen.getByTestId("attendance-view-container")).toBeTruthy();
    expect(screen.getByTestId("welcome-section")).toBeTruthy();
    expect(screen.getByTestId("attendance-punch-card")).toBeTruthy();
    expect(screen.getByTestId("punch-live-timer")).toBeTruthy();
    expect(screen.getByTestId("location-status-badge")).toBeTruthy();
    expect(screen.getAllByText("Inhyma Thane Office").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Mumbai BKC Office")).toBeNull();

    // Dev GPS selector exists in header
    expect(screen.getByTestId("dev-gps-select")).toBeTruthy();
  });

  it("blocks punch in when employee is outside assigned office geofence and displays distance", () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance?tab=view"]}>
        <HrmsAttendancePage />
      </MemoryRouter>
    );

    const punchToggle = screen.getByTestId("punch-toggle-btn");

    // Simulate moving outside assigned office (e.g. Pune Office, 120km away)
    const gpsSelect = screen.getByTestId("dev-gps-select");
    fireEvent.change(gpsSelect, { target: { value: "loc-pune" } });

    // Attempt to Punch In while outside geofence
    fireEvent.click(punchToggle);

    // Error banner blocks punch and displays current distance
    expect(screen.getByText(/Punch Blocked/i)).toBeTruthy();
    expect(screen.getByText(/120 km away/i)).toBeTruthy();
  });

  it("triggers 30-second geofence warning countdown when punched in and moving outside office, and returns safely", () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance?tab=view"]}>
        <HrmsAttendancePage />
      </MemoryRouter>
    );

    // Punch in inside assigned office first
    const punchToggle = screen.getByTestId("punch-toggle-btn");
    fireEvent.click(punchToggle);

    // Move outside geofence during active shift
    const gpsSelect = screen.getByTestId("dev-gps-select");
    fireEvent.change(gpsSelect, { target: { value: "loc-remote" } });

    // Warning modal pops up immediately with 30-second warning
    expect(screen.getByTestId("geofence-warning-modal")).toBeTruthy();
    expect(screen.getByText(/You have moved outside your assigned punch location/i)).toBeTruthy();

    // Click "Return Inside" button
    const returnBtn = screen.getByTestId("return-inside-geofence-btn");
    fireEvent.click(returnBtn);

    // Warning modal dismissed and returned to normal shift
    expect(screen.queryByTestId("geofence-warning-modal")).toBeNull();
    expect(screen.getByText(/Returned inside assigned office geofence/i)).toBeTruthy();
  });

  it("clicking the edit icon on an irregular day opens the right-side Regularization Drawer with Work From Home option", async () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance?tab=view"]}>
        <HrmsAttendancePage
          initialDaysForTesting={[
            {
              date: "2026-09-07",
              dayNumber: 7,
              weekday: "Mon",
              status: "Late Punch",
              punch_in: "09:00",
              punch_out: "18:00",
              total_hours: "9h 00m",
              is_irregular: true,
            },
          ]}
        />
      </MemoryRouter>
    );

    // Irregular day (e.g. Sept 7 - Late Punch) has edit button
    const editBtn = screen.getByTestId("edit-day-2026-09-07");
    expect(editBtn).toBeTruthy();

    fireEvent.click(editBtn);

    // Right-side drawer opens with title "Regularize Request"
    await waitFor(() => {
      expect(screen.getByTestId("regularize-drawer")).toBeTruthy();
    });

    expect(screen.getByText("Regularize Request")).toBeTruthy();

    // Pre-filled date & inputs
    const dateInput = screen.getByTestId("reg-attendance-date") as HTMLInputElement;
    expect(dateInput.value).toBe("2026-09-07");

    const checkInInput = screen.getByTestId("reg-check-in") as HTMLInputElement;
    const checkOutInput = screen.getByTestId("reg-check-out") as HTMLInputElement;
    expect(checkInInput.value).toBe("09:00");
    expect(checkOutInput.value).toBe("18:00");

    // Auto-calculated total hours
    const totalHoursDisplay = screen.getByTestId("reg-total-hours");
    expect(totalHoursDisplay.textContent).toContain("9h 00m");

    // Change checkout time to verify auto-calculation
    fireEvent.change(checkOutInput, { target: { value: "19:30" } });
    expect(totalHoursDisplay.textContent).toContain("10h 30m");

    // Reason dropdown contains "Work From Home"
    const reasonSelect = screen.getByTestId("reg-reason-select") as HTMLSelectElement;
    expect(reasonSelect).toBeTruthy();
    fireEvent.change(reasonSelect, { target: { value: "Work From Home" } });
    expect(reasonSelect.value).toBe("Work From Home");

    // Submit single regularization request
    const sendBtn = screen.getByTestId("reg-send-btn");
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByText(/sent to manager for approval/i)).toBeTruthy();
      expect(screen.queryByTestId("regularize-drawer")).toBeNull();
    });
  });

  it("renders unified Approval page with requests, approve/reject actions, and adjust against employee leave", async () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance?tab=approval"]}>
        <HrmsAttendancePage />
      </MemoryRouter>
    );

    expect(screen.getByTestId("approval-page-container")).toBeTruthy();
    expect(screen.getByTestId("approval-filter-row")).toBeTruthy();
    expect(screen.getByTestId("approval-requests-list")).toBeTruthy();

    // Requests and irregularities listed
    expect(screen.getByText("Amit Verma")).toBeTruthy();
    expect(screen.getByText("EMP-014")).toBeTruthy();
    expect(screen.getByText("Sneha Patel")).toBeTruthy();

    // Irregularity has "Adjust Against Leave" action
    const adjustBtn = screen.getByTestId("adjust-leave-btn-app-1");
    expect(adjustBtn).toBeTruthy();
    fireEvent.click(adjustBtn);

    // Modal opens for leave deduction
    await waitFor(() => {
      expect(screen.getByTestId("review-modal-form")).toBeTruthy();
    });

    const leaveSelect = screen.getByTestId("adjust-leave-type-select");
    expect(leaveSelect).toBeTruthy();

    const confirmBtn = screen.getByTestId("confirm-review-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText(/Adjusted 0.5 Day/i)).toBeTruthy();
    });
  });

  it("renders Settings page with 3 internal tabs and overtime empty & saved states", () => {
    render(
      <MemoryRouter initialEntries={["/hrms/attendance?tab=settings"]}>
        <HrmsAttendancePage />
      </MemoryRouter>
    );

    expect(screen.getByTestId("settings-container")).toBeTruthy();

    // Tab 1: Configure Attendance (no mandatory break, live summary card)
    expect(screen.getByTestId("config-attendance-section")).toBeTruthy();
    expect(screen.getByTestId("config-shift-select")).toBeTruthy();
    expect(screen.getByTestId("config-summary-card")).toBeTruthy();
    expect(screen.queryByText(/Mandatory Break/i)).toBeNull();

    // Tab 2: Attendance Exemption
    const tabExemption = screen.getByTestId("settings-subtab-exemption");
    fireEvent.click(tabExemption);
    expect(screen.getByTestId("exemptions-table")).toBeTruthy();
    expect(screen.getByText("Flexible Hours")).toBeTruthy();
    expect(screen.getByText("Skip Late Rule")).toBeTruthy();
    expect(screen.getByText("Skip Geofence")).toBeTruthy();

    // Tab 3: Configure Overtime
    const tabOvertime = screen.getByTestId("settings-subtab-overtime");
    fireEvent.click(tabOvertime);

    expect(screen.getByTestId("config-overtime-section")).toBeTruthy();
    expect(screen.getByTestId("ot-min-hours")).toBeTruthy();
    expect(screen.getByTestId("ot-weekoff-cb")).toBeTruthy();
    expect(screen.getByTestId("ot-holiday-cb")).toBeTruthy();
    expect(screen.getByTestId("ot-workingday-cb")).toBeTruthy();
    expect(screen.getByTestId("ot-approval-cb")).toBeTruthy();

    // Initially displays empty state
    expect(screen.getByTestId("ot-empty-state")).toBeTruthy();
    expect(screen.getByText(/No overtime configured/i)).toBeTruthy();

    // Save Overtime
    const saveOtBtn = screen.getByTestId("ot-save-btn");
    fireEvent.click(saveOtBtn);

    // Displays configured summary card
    expect(screen.getByTestId("ot-saved-summary")).toBeTruthy();
    expect(screen.queryByTestId("ot-empty-state")).toBeNull();
  });
});
