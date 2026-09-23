import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { HrmsLocationsPage } from "../HrmsLocationsPage";
import { HrmsEmployeeLocationsPage } from "../HrmsEmployeeLocationsPage";
import { HrmsWfhRequestsPage } from "../HrmsWfhRequestsPage";
import * as api from "@/lib/api";

// Mock AppShell to focus test assertions on HRMS page content
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock useAuth hook
vi.mock("@/lib/hooks", async () => {
  const actual = await vi.importActual<any>("@/lib/hooks");
  return {
    ...actual,
    useAuth: () => ({
      profile: {
        id: "u-101",
        full_name: "Admin User",
        username: "admin",
        employee_code: "EMP-001",
        role: "admin",
        roles: ["admin"],
      },
      isSuperAdmin: true,
      hasPermission: () => true,
    }),
  };
});

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

const MOCK_LOCATIONS = [
  {
    id: "loc-1",
    name: "Mumbai BKC Office",
    location_type: "OFFICE",
    address: "Bandra Kurla Complex, Mumbai, Maharashtra 400051",
    latitude: 19.0664,
    longitude: 72.8687,
    radius_meters: 150,
    is_active: true,
    assigned_employees_count: 12,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
  },
  {
    id: "loc-2",
    name: "Gujarat GIDC Warehouse",
    location_type: "WAREHOUSE",
    address: "Plot 12, GIDC Industrial Estate, Vadodara, Gujarat",
    latitude: 22.3072,
    longitude: 73.1812,
    radius_meters: 250,
    is_active: true,
    assigned_employees_count: 5,
    created_at: "2026-09-05T11:00:00Z",
    updated_at: "2026-09-05T11:00:00Z",
  },
  {
    id: "loc-3",
    name: "Sanand Factory",
    location_type: "FACTORY",
    address: "Sanand Auto Hub, Ahmedabad, Gujarat",
    latitude: 22.9912,
    longitude: 72.3815,
    radius_meters: 300,
    is_active: false,
    assigned_employees_count: 0,
    created_at: "2026-09-10T09:00:00Z",
    updated_at: "2026-09-10T09:00:00Z",
  },
];

const MOCK_ASSIGNMENTS = [
  {
    user_id: "u-101",
    employee_name: "Rupesh Malla",
    employee_code: "EMP-007",
    email: "rupesh@inhyma.com",
    role: "General Manager",
    primary_location: {
      id: "loc-1",
      name: "Mumbai BKC Office",
      location_type: "OFFICE",
      address: "Bandra Kurla Complex, Mumbai",
      radius_meters: 150,
      is_primary: true,
    },
    additional_locations: [
      {
        id: "loc-2",
        name: "Gujarat GIDC Warehouse",
        location_type: "WAREHOUSE",
        address: "Vadodara, Gujarat",
        radius_meters: 250,
        is_primary: false,
      },
    ],
  },
];

const MOCK_WFH_REQUESTS = [
  {
    id: "wfh-1",
    user_id: "u-102",
    employee_name: "Amit Sharma",
    employee_code: "EMP-014",
    wfh_date: "2026-09-23",
    reason: "Focused code review & home internet setup",
    address: "Flat 204, Powai Heights, Mumbai",
    latitude: 19.1176,
    longitude: 72.9060,
    radius_meters: 150,
    status: "PENDING",
    submitted_at: "2026-09-22T08:30:00Z",
  },
];

describe("HRMS Location Management & WFH Requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(api, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/api/v1/hrms/locations")) return Promise.resolve({ data: MOCK_LOCATIONS } as any);
      if (url.includes("/api/v1/hrms/employee-assignments")) return Promise.resolve({ data: MOCK_ASSIGNMENTS } as any);
      if (url.includes("/api/v1/hrms/wfh-requests/pending")) return Promise.resolve({ data: MOCK_WFH_REQUESTS } as any);
      if (url.includes("/api/v1/hrms/wfh-requests/my")) return Promise.resolve({ data: [] } as any);
      return Promise.resolve({ data: [] } as any);
    });
    vi.spyOn(api, "apiPost").mockImplementation((url: string, body: any) => {
      if (url.includes("/api/v1/hrms/geocode")) {
        return Promise.resolve({
          data: {
            latitude: 19.0664,
            longitude: 72.8687,
            display_name: "Resolved BKC, Mumbai",
          },
        } as any);
      }
      if (url.includes("/api/v1/hrms/locations")) {
        return Promise.resolve({
          data: { id: "loc-new", ...body, is_active: true, assigned_employees_count: 0 },
        } as any);
      }
      if (url.includes("/api/v1/hrms/wfh-requests")) {
        return Promise.resolve({
          data: { id: "wfh-new", ...body, status: "PENDING" },
        } as any);
      }
      return Promise.resolve({ data: { success: true } } as any);
    });
    vi.spyOn(api, "apiPatch").mockImplementation(() => Promise.resolve({ data: { success: true } } as any));
    vi.spyOn(api, "apiPut").mockImplementation(() => Promise.resolve({ data: { success: true } } as any));
  });

  afterEach(() => {
    cleanup();
  });

  // Test 1: HrmsLocationsPage Table Rendering
  it("renders location management list with locations, types, and stats", async () => {
    render(
      <BrowserRouter>
        <HrmsLocationsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Mumbai BKC Office")).toBeTruthy();
      expect(screen.getByText("Gujarat GIDC Warehouse")).toBeTruthy();
      expect(screen.getByText("Sanand Factory")).toBeTruthy();
    });

    expect(screen.getByText("Total Locations")).toBeTruthy();
    expect(screen.getByText("Active Geofences")).toBeTruthy();
    expect(screen.getByText("Staff Assigned")).toBeTruthy();
    expect(screen.getByTestId("add-location-btn")).toBeTruthy();
  });

  // Test 2: Add Location 3-Step Flow
  it("executes the 3-step Add Location flow (Details -> Map Pin Resolution -> Save)", async () => {
    render(
      <BrowserRouter>
        <HrmsLocationsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Mumbai BKC Office")).toBeTruthy();
    });

    // Step 1: Click Add Location
    fireEvent.click(screen.getByTestId("add-location-btn"));
    expect(screen.getByTestId("input-location-name")).toBeTruthy();

    fireEvent.change(screen.getByTestId("input-location-name"), {
      target: { value: "Pune Tech Branch" },
    });
    fireEvent.change(screen.getByTestId("input-address"), {
      target: { value: "Hinjewadi Phase 1, Pune, Maharashtra" },
    });

    // Proceed to Map
    fireEvent.click(screen.getByTestId("proceed-to-map-btn"));

    // Step 2: Interactive map with resolved pin
    await waitFor(() => {
      expect(screen.getByTestId("mock-location-map-picker")).toBeTruthy();
      expect(screen.getByTestId("confirm-save-location-btn")).toBeTruthy();
    });

    // Simulate dragging pin
    fireEvent.click(screen.getByTestId("mock-drag-pin-btn"));

    // Step 3: Save Confirmed Location
    fireEvent.click(screen.getByTestId("confirm-save-location-btn"));

    await waitFor(() => {
      expect(api.apiPost).toHaveBeenCalledWith(
        "/api/v1/hrms/locations",
        expect.objectContaining({
          name: "Pune Tech Branch",
          radius_meters: 150,
        })
      );
    });
  });

  // Test 3: Soft-disable toggle
  it("triggers soft-disable on location without hard-deleting", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <BrowserRouter>
        <HrmsLocationsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("toggle-status-btn-loc-1")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("toggle-status-btn-loc-1"));

    await waitFor(() => {
      expect(api.apiPatch).toHaveBeenCalledWith("/api/v1/hrms/locations/loc-1/toggle-status", {});
    });
  });

  // Test 4: Employee Location Assignment
  it("renders employee location allocation and enforces 1 primary location", async () => {
    render(
      <BrowserRouter>
        <HrmsEmployeeLocationsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Rupesh Malla")).toBeTruthy();
      expect(screen.getByText("Mumbai BKC Office")).toBeTruthy();
    });

    // Open Assign modal
    fireEvent.click(screen.getByTestId("assign-btn-u-101"));

    await waitFor(() => {
      expect(screen.getByTestId("select-primary-location")).toBeTruthy();
    });

    // Select primary location and save
    fireEvent.change(screen.getByTestId("select-primary-location"), {
      target: { value: "loc-1" },
    });
    fireEvent.click(screen.getByTestId("save-assignment-btn"));

    await waitFor(() => {
      expect(api.apiPut).toHaveBeenCalledWith(
        "/api/v1/hrms/employees/u-101/locations",
        expect.objectContaining({
          primary_location_id: "loc-1",
        })
      );
    });
  });

  // Test 5: Manager Approval Queue for WFH Requests
  it("renders pending WFH requests in manager queue and handles approval", async () => {
    render(
      <BrowserRouter>
        <HrmsWfhRequestsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Amit Sharma")).toBeTruthy();
      expect(screen.getByText("Focused code review & home internet setup")).toBeTruthy();
    });

    // Click Review button
    fireEvent.click(screen.getByTestId("review-btn-wfh-1"));

    await waitFor(() => {
      expect(screen.getByTestId("btn-approve-wfh")).toBeTruthy();
    });

    // Approve request
    fireEvent.click(screen.getByTestId("btn-approve-wfh"));

    await waitFor(() => {
      expect(api.apiPatch).toHaveBeenCalledWith(
        "/api/v1/hrms/wfh-requests/wfh-1/review",
        expect.objectContaining({
          status: "APPROVED",
        })
      );
    });
  });
});
