import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SetupPage } from "../hrms/SetupPage";
import * as apiModule from "@/lib/api";

afterEach(() => {
  cleanup();
});

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock useAuth to grant superadmin & permission
vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useAuth: () => ({
      profile: { id: "admin-1", username: "admin", role: "ADMIN", display_name: "Admin User" },
      isSuperAdmin: true,
      hasPermission: (_perm?: string) => true,
    }),
  };
});

// Mock API layer
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  API_BASE: "http://localhost:8000/api",
}));

// Mock Google Maps SDK loader
vi.mock("@/lib/googleMaps", () => ({
  loadGoogleMapsSdk: vi.fn().mockResolvedValue({}),
  searchGooglePlaces: vi.fn().mockResolvedValue([]),
  fetchGooglePlaceDetails: vi.fn().mockResolvedValue(null),
  reverseGeocodeGoogle: vi.fn().mockResolvedValue(null),
}));

describe("HRMS Setup — Employee Location Assignment & Multi-Location UI", () => {
  const mockLocations = [
    {
      id: "loc-mumbai",
      name: "Mumbai HQ",
      location_type: "Head Office",
      address: "Bandra Kurla Complex, Mumbai",
      latitude: 19.066,
      longitude: 72.868,
      radius_meters: 100,
      is_active: true,
      employees_assigned: 5,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    },
    {
      id: "loc-gujarat",
      name: "Gujarat Branch",
      location_type: "Branch Office",
      address: "SG Highway, Ahmedabad, Gujarat",
      latitude: 23.033,
      longitude: 72.508,
      radius_meters: 150,
      is_active: true,
      employees_assigned: 2,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    },
    {
      id: "loc-mp",
      name: "MP Office",
      location_type: "Regional Office",
      address: "Vijay Nagar, Indore, MP",
      latitude: 22.753,
      longitude: 75.893,
      radius_meters: 120,
      is_active: true,
      employees_assigned: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    },
  ];

  const mockEmployeeLocations = [
    {
      employee_id: "emp-101",
      employee_name: "Employee A",
      employee_code: "EMP-001",
      department: "Engineering",
      email: "emp.a@inhyma.test",
      primary_location: {
        location_id: "loc-mumbai",
        location_name: "Mumbai HQ",
        location_type: "Head Office",
        address: "Bandra Kurla Complex, Mumbai",
        is_primary: true,
        is_active: true,
        radius_meters: 100,
      },
      additional_locations: [
        {
          location_id: "loc-gujarat",
          location_name: "Gujarat Branch",
          location_type: "Branch Office",
          address: "SG Highway, Ahmedabad, Gujarat",
          is_primary: false,
          is_active: true,
          radius_meters: 150,
        },
        {
          location_id: "loc-mp",
          location_name: "MP Office",
          location_type: "Regional Office",
          address: "Vijay Nagar, Indore, MP",
          is_primary: false,
          is_active: true,
          radius_meters: 120,
        },
      ],
      total_permitted_locations: 3,
      updated_at: new Date().toISOString(),
    },
    {
      employee_id: "emp-102",
      employee_name: "Employee B",
      employee_code: "EMP-002",
      department: "Sales",
      email: "emp.b@inhyma.test",
      primary_location: null,
      additional_locations: [],
      total_permitted_locations: 0,
      updated_at: new Date().toISOString(),
    },
  ];

  const mockHistory = [
    {
      id: "hist-1",
      user_id: "emp-101",
      location_id: "loc-mumbai",
      location_name: "Mumbai HQ",
      action: "ASSIGN_PRIMARY",
      is_primary: true,
      performed_by: "admin-1",
      performed_by_name: "Admin User",
      notes: "Primary office setup",
      created_at: new Date().toISOString(),
    },
    {
      id: "hist-2",
      user_id: "emp-101",
      location_id: "loc-gujarat",
      location_name: "Gujarat Branch",
      action: "ASSIGN_ADDITIONAL",
      is_primary: false,
      performed_by: "admin-1",
      performed_by_name: "Admin User",
      notes: "Assigned for western region client visits",
      created_at: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (apiModule.apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/history")) {
        return Promise.resolve({ data: mockHistory });
      }
      if (url.includes("/hrms/setup/locations")) {
        return Promise.resolve({ data: mockLocations });
      }
      if (url.includes("/hrms/setup/employee-locations")) {
        return Promise.resolve({ data: mockEmployeeLocations });
      }
      if (url.includes("/hrms/setup/leave-types")) {
        return Promise.resolve({ data: [] });
      }
      if (url.includes("/hrms/setup/expense-categories")) {
        return Promise.resolve({ data: [] });
      }
      if (url.includes("/hrms/setup/expense-settings")) {
        return Promise.resolve({ data: null });
      }
      return Promise.resolve({ data: [] });
    });
    (apiModule.apiPut as any).mockResolvedValue({
      data: {
        ...mockEmployeeLocations[0],
        total_permitted_locations: 2,
      },
    });
  });

  it("renders the Employee Location Assignment tab and switches to it", async () => {
    render(
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>
    );

    const tabBtn = screen.getByRole("button", { name: /employee location assignment/i });
    expect(tabBtn).toBeDefined();

    fireEvent.click(tabBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Employee Location Assignment" })).toBeDefined();
    });

    expect(screen.getByText(/assign primary and additional authorized office locations/i)).toBeDefined();
    expect(apiModule.apiGet).toHaveBeenCalledWith(
      expect.stringContaining("/hrms/setup/employee-locations")
    );
  });

  it("displays employees with primary location and additional location badges", async () => {
    render(
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>
    );

    const tabBtn = screen.getByRole("button", { name: /employee location assignment/i });
    fireEvent.click(tabBtn);

    await waitFor(() => {
      expect(screen.getByText("Employee A")).toBeDefined();
    });

    // Check Employee A has primary Mumbai HQ
    const mumbaiElements = screen.getAllByText("Mumbai HQ");
    expect(mumbaiElements.length).toBeGreaterThan(0);

    // Check Employee A has additional locations tags
    const gujaratElements = screen.getAllByText(/Gujarat Branch/);
    expect(gujaratElements.length).toBeGreaterThan(0);

    const mpElements = screen.getAllByText(/MP Office/);
    expect(mpElements.length).toBeGreaterThan(0);

    expect(screen.getByText("3 locations")).toBeDefined();

    // Check Employee B is Unassigned
    expect(screen.getByText("Employee B")).toBeDefined();
    expect(screen.getByText("Unassigned")).toBeDefined();
  });

  it("opens the location assignment modal and allows updating primary and additional locations", async () => {
    render(
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>
    );

    const tabBtn = screen.getByRole("button", { name: /employee location assignment/i });
    fireEvent.click(tabBtn);

    await waitFor(() => {
      expect(screen.getByText("Employee A")).toBeDefined();
    });

    // Find and click the 'Assign / Edit' button for Employee A
    const editButtons = screen.getAllByRole("button", { name: /assign \/ edit/i });
    expect(editButtons.length).toBeGreaterThan(0);
    fireEvent.click(editButtons[0]);

    // Modal should open
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Manage Office Locations/i })).toBeDefined();
    });

    expect(screen.getByText(/Every employee must have exactly one primary office location/i)).toBeDefined();

    // Check modal save button exists
    const saveBtn = screen.getByRole("button", { name: /save locations/i });
    expect(saveBtn).toBeDefined();

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(apiModule.apiPut).toHaveBeenCalledWith(
        "/hrms/setup/employee-locations/emp-101",
        expect.objectContaining({
          primary_location_id: "loc-mumbai",
        })
      );
    });
  });

  it("opens audit history modal and displays assignment events", async () => {
    render(
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>
    );

    const tabBtn = screen.getByRole("button", { name: /employee location assignment/i });
    fireEvent.click(tabBtn);

    await waitFor(() => {
      expect(screen.getByText("Employee A")).toBeDefined();
    });

    const historyButtons = screen.getAllByRole("button", { name: /history/i });
    fireEvent.click(historyButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Location Assignment History/i })).toBeDefined();
    });

    expect(apiModule.apiGet).toHaveBeenCalledWith(
      "/hrms/setup/employee-locations/emp-101/history"
    );

    await waitFor(() => {
      expect(screen.getByText("★ Assigned Primary")).toBeDefined();
      expect(screen.getByText("+ Assigned Additional")).toBeDefined();
      expect(screen.getAllByText("Admin User").length).toBe(2);
    });
  });

  it("supports adding additional locations via explicit selector and shows authorized locations summary", async () => {
    render(
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>
    );

    const tabBtn = screen.getByRole("button", { name: /employee location assignment/i });
    fireEvent.click(tabBtn);

    await waitFor(() => {
      expect(screen.getByText("Employee B")).toBeDefined();
    });

    // Click 'Assign / Edit' for Employee B (the second button)
    const editButtons = screen.getAllByRole("button", { name: /assign \/ edit/i });
    fireEvent.click(editButtons[1]);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Manage Office Locations/i })).toBeDefined();
    });

    // Primary select should be present
    const primarySelect = screen.getByRole("combobox", { name: /primary office location/i });
    fireEvent.change(primarySelect, { target: { value: "loc-mumbai" } });

    // Summary should show Primary: Mumbai HQ and Total: 1
    await waitFor(() => {
      expect(screen.getByText("★ Primary:")).toBeDefined();
      expect(screen.getByText(/Total permitted locations: 1/i)).toBeDefined();
    });

    // Verify explicit Add Location interaction
    const addLocSelect = screen.getByRole("combobox", { name: /add another permitted location/i });
    fireEvent.change(addLocSelect, { target: { value: "loc-gujarat" } });

    const addLocBtn = screen.getByRole("button", { name: /\+ Add Location/i });
    fireEvent.click(addLocBtn);

    // Summary should now show Additional and Total: 2
    await waitFor(() => {
      expect(screen.getByText("Additional:")).toBeDefined();
      expect(screen.getByText(/Total permitted locations: 2/i)).toBeDefined();
    });

    // Verify Additional Permitted Locations list contains Gujarat Branch checked and MP Office unchecked
    expect(screen.getByText(/Additional Permitted Locations/i)).toBeDefined();
    expect(screen.getByText("SG Highway, Ahmedabad, Gujarat")).toBeDefined();
    expect(screen.getByText("Vijay Nagar, Indore, MP")).toBeDefined();

    // Click save
    const saveBtn = screen.getByRole("button", { name: /save locations/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(apiModule.apiPut).toHaveBeenCalledWith(
        "/hrms/setup/employee-locations/emp-102",
        expect.objectContaining({
          primary_location_id: "loc-mumbai",
          additional_location_ids: ["loc-gujarat"],
        })
      );
    });
  });
});
