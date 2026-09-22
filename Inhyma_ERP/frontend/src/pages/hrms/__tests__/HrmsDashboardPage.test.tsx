import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { HrmsDashboardPage } from "../HrmsDashboardPage";
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

// Mock LocationMapPicker to avoid Leaflet canvas/DOM dependencies in JSDOM
vi.mock("@/components/hrms/LocationMapPicker", () => ({
  LocationMapPicker: ({
    latitude,
    longitude,
    radiusMeters,
    onChange,
    readOnly,
  }: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
    onChange?: (c: { latitude: number; longitude: number; address?: string }) => void;
    readOnly?: boolean;
  }) => (
    <div data-testid="mock-location-map-picker">
      <div data-testid="mock-map-lat">{latitude}</div>
      <div data-testid="mock-map-lng">{longitude}</div>
      <div data-testid="mock-map-radius">{radiusMeters}</div>
      {!readOnly && (
        <button
          type="button"
          data-testid="mock-drag-pin-btn"
          onClick={() =>
            onChange?.({
              latitude: 19.080000,
              longitude: 72.880000,
              address: "Adjusted Pin Address, Mumbai",
            })
          }
        >
          Simulate Drag Pin
        </button>
      )}
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

describe("HrmsDashboardPage (OTU HR Plus Architecture)", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
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

  it("verifies sidebar navigation contains exactly one HRMS entry and no separate location modules", () => {
    const hrmsSection = NAV_SECTIONS.find((s) => s.label === "HRMS");
    expect(hrmsSection).toBeDefined();
    expect(hrmsSection?.items).toHaveLength(1);
    expect(hrmsSection?.items[0].key).toBe("hrms");
    expect(hrmsSection?.items[0].path).toBe("/hrms");

    // Verify separate sidebar modules do not exist
    const allNavKeys = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.key));
    expect(allNavKeys).not.toContain("hrms-locations");
    expect(allNavKeys).not.toContain("hrms-employee-locations");
    expect(allNavKeys).not.toContain("hrms-wfh");
  });

  it("renders with activeKey='hrms' in AppShell and renders all 4 internal tabs", () => {
    render(
      <BrowserRouter>
        <HrmsDashboardPage />
      </BrowserRouter>
    );

    const shell = screen.getByTestId("app-shell");
    expect(shell.getAttribute("data-active-key")).toBe("hrms");

    expect(screen.getByTestId("tab-overview")).toBeTruthy();
    expect(screen.getByTestId("tab-punch")).toBeTruthy();
    expect(screen.getByTestId("tab-locations")).toBeTruthy();
    expect(screen.getByTestId("tab-history")).toBeTruthy();
  });

  it("renders welcome header with time-based greeting and employee details", () => {
    render(
      <BrowserRouter>
        <HrmsDashboardPage />
      </BrowserRouter>
    );

    const welcome = screen.getByTestId("welcome-section");
    expect(welcome).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /Good (Morning|Afternoon|Evening), Rupesh Malla!/i })
    ).toBeTruthy();
    expect(screen.getByText(/General Manager/i)).toBeTruthy();
    expect(screen.getByText(/EMP-007/i)).toBeTruthy();
  });

  it("renders the 4 Attendance Summary cards in Overview tab", () => {
    render(
      <BrowserRouter>
        <HrmsDashboardPage />
      </BrowserRouter>
    );

    const section = screen.getByTestId("attendance-summary-section");
    expect(section).toBeTruthy();

    expect(screen.getByText("Present Today")).toBeTruthy();
    expect(screen.getByText("Working Hours Today")).toBeTruthy();
    expect(screen.getByText("This Month Attendance")).toBeTruthy();
    expect(screen.getByText("Leave Balance")).toBeTruthy();
    expect(screen.getByText("7h 45m")).toBeTruthy();
    expect(screen.getByText("22 / 24 Days")).toBeTruthy();
    expect(screen.getByText("14 Days")).toBeTruthy();
  });

  it("renders Holiday Calendar widget with month matrix and upcoming holidays", () => {
    render(
      <BrowserRouter>
        <HrmsDashboardPage />
      </BrowserRouter>
    );

    const holidaySection = screen.getByTestId("holiday-calendar-section");
    expect(holidaySection).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Holiday Calendar/i })).toBeTruthy();
    expect(screen.getAllByText("Sun").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "‹" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "›" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Today" })).toBeTruthy();
  });

  it("switches to Punch tab and displays live ticking timer, assigned office selector, and punch toggle", () => {
    render(
      <MemoryRouter initialEntries={["/hrms?tab=punch"]}>
        <HrmsDashboardPage />
      </MemoryRouter>
    );

    // Live timer
    const timerDisplay = screen.getByTestId("live-timer-display");
    expect(timerDisplay).toBeTruthy();
    expect(timerDisplay.textContent).toMatch(/\d{2}h \d{2}m \d{2}s/);

    // Assigned Office Selector
    const selector = screen.getByTestId("assigned-office-selector") as HTMLSelectElement;
    expect(selector).toBeTruthy();
    expect(selector.options.length).toBeGreaterThan(0);
    expect(selector.options[0].text).toContain("[Primary]");

    // Punch toggle button
    const punchToggleBtn = screen.getByTestId("punch-toggle-btn");
    expect(punchToggleBtn).toBeTruthy();
    expect(punchToggleBtn.textContent).toContain("Punch Out");

    // Click to punch out
    fireEvent.click(punchToggleBtn);
    expect(punchToggleBtn.textContent).toContain("Punch In");
    expect(screen.getByText(/Punched out successfully/i)).toBeTruthy();

    // Request WFH button in Punch tab
    const requestWfhBtn = screen.getByTestId("punch-request-wfh-btn");
    expect(requestWfhBtn).toBeTruthy();
  });

  it("renders Admin Locations management tab with table and employee assignments subtab", () => {
    render(
      <MemoryRouter initialEntries={["/hrms?tab=locations"]}>
        <HrmsDashboardPage />
      </MemoryRouter>
    );

    // Header & Add Location button
    expect(screen.getByRole("heading", { name: /Manage Locations/i })).toBeTruthy();
    const addLocBtn = screen.getByTestId("add-location-btn");
    expect(addLocBtn).toBeTruthy();

    // Locations table
    const table = screen.getByTestId("locations-table");
    expect(table).toBeTruthy();
    expect(screen.getByText("Mumbai BKC Office")).toBeTruthy();

    // Switch to Employee Assignments subtab
    const assignmentsSubtabBtn = screen.getByTestId("subtab-assignments");
    fireEvent.click(assignmentsSubtabBtn);

    const assignTable = screen.getByTestId("employee-assignments-table");
    expect(assignTable).toBeTruthy();
    expect(screen.getByTestId("assign-btn-u-101")).toBeTruthy();
  });

  it("opens Add Location as an in-page modal without route navigation, without 'Not Found' error, and follows ERP layout", async () => {
    render(
      <MemoryRouter initialEntries={["/hrms?tab=locations"]}>
        <HrmsDashboardPage />
      </MemoryRouter>
    );

    // Ensure no "Not Found" message or red banner is present
    expect(screen.queryByText(/The requested resource was not found/i)).toBeNull();
    expect(screen.queryByText(/Not Found/i)).toBeNull();

    // Click + Add Location button
    const addLocBtn = screen.getByTestId("add-location-btn");
    fireEvent.click(addLocBtn);

    // Modal opens controlled by component state
    const stepper = screen.getByTestId("modal-stepper");
    expect(stepper).toBeTruthy();
    expect(screen.getByText("Address & Details")).toBeTruthy();
    expect(screen.getByText("Map Confirmation")).toBeTruthy();

    // Step 1: Two-column fields + full-width address + radius chips
    const nameInput = screen.getByPlaceholderText(/Mumbai BKC Office/i);
    expect(nameInput).toBeTruthy();
    const addressInput = screen.getByPlaceholderText(/Enter building number/i);
    expect(addressInput).toBeTruthy();

    // Radius chips
    expect(screen.getAllByText("150m").length).toBeGreaterThan(0);
    expect(screen.getAllByText("200m").length).toBeGreaterThan(0);
    expect(screen.getByText("500m")).toBeTruthy();

    // Fill form and continue to map
    fireEvent.change(nameInput, { target: { value: "Hyderabad Tech Hub" } });
    fireEvent.change(addressInput, { target: { value: "HITEC City, Madhapur, Hyderabad, Telangana" } });

    // Select a radius chip in modal
    const chips200 = screen.getAllByText("200m");
    fireEvent.click(chips200[chips200.length - 1]);

    const continueBtn = screen.getByRole("button", { name: /Continue to Map/i });
    fireEvent.click(continueBtn);

    // Step 2: Map & telemetry (wait for geocode resolution)
    await waitFor(() => {
      expect(screen.getByText("LATITUDE")).toBeTruthy();
    });
    expect(screen.getByText("LONGITUDE")).toBeTruthy();
    expect(screen.getByText("GEOFENCE RADIUS")).toBeTruthy();
    expect(screen.getByTestId("mock-location-map-picker")).toBeTruthy();

    // Confirm Location and Back buttons exist
    expect(screen.getByRole("button", { name: /Confirm Location/i })).toBeTruthy();
    const backBtn = screen.getByRole("button", { name: /Back/i });
    expect(backBtn).toBeTruthy();

    // Click Back returns to Step 1
    fireEvent.click(backBtn);
    expect(screen.getByPlaceholderText(/Mumbai BKC Office/i)).toBeTruthy();

    // Still no "Not Found" anywhere
    expect(screen.queryByText(/Not Found/i)).toBeNull();
  });

  it("renders regular employee (non-admin) Locations view with read-only primary and additional workplaces", () => {
    mockCurrentUser = {
      profile: {
        id: "u-102",
        full_name: "Staff Employee",
        username: "staff",
        employee_code: "EMP-099",
        roles: ["Staff"],
        role: "staff",
      },
      isSuperAdmin: false,
      hasPermission: () => false,
    };

    render(
      <MemoryRouter initialEntries={["/hrms?tab=locations"]}>
        <HrmsDashboardPage />
      </MemoryRouter>
    );

    // Non-admin heading
    expect(screen.getByRole("heading", { name: /My Assigned Work Locations/i })).toBeTruthy();
    expect(screen.getByText(/Read-only view:/i)).toBeTruthy();

    // Admin Add Location button should NOT exist
    expect(screen.queryByTestId("add-location-btn")).toBeNull();

    // Primary workplace card
    expect(screen.getByTestId("employee-primary-location-card")).toBeTruthy();
    expect(screen.getByText(/★ PRIMARY WORKPLACE/i)).toBeTruthy();

    // Additional workplace card
    expect(screen.getByTestId("employee-additional-locations-card")).toBeTruthy();
  });

  it("switches to History tab and renders Attendance Logs and WFH Requests table with manager approval queue", () => {
    render(
      <MemoryRouter initialEntries={["/hrms?tab=history"]}>
        <HrmsDashboardPage />
      </MemoryRouter>
    );

    // Attendance logs
    expect(screen.getByTestId("attendance-logs-table")).toBeTruthy();
    expect(screen.getByText("Attendance Logs & Punch Records")).toBeTruthy();

    // WFH Requests
    expect(screen.getByTestId("my-wfh-requests-table")).toBeTruthy();
    expect(screen.getByTestId("history-request-wfh-btn")).toBeTruthy();

    // Manager queue (since admin)
    expect(screen.getByTestId("pending-wfh-queue-table")).toBeTruthy();
    expect(screen.getByText(/Manager Approval Queue/i)).toBeTruthy();
  });
});
