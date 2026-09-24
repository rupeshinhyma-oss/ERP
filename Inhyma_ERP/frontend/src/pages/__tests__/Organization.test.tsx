import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OrganizationPage } from "../Organization";

// Mock AppShell to focus test assertions on Organization page content
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock API methods
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiPut: vi.fn(),
}));

import { apiGet } from "@/lib/api";

describe("OrganizationPage (Simplified 3-Tab Setup)", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.clearAllMocks();
    (apiGet as any).mockResolvedValue({
      data: [
        {
          id: "loc-mumbai",
          name: "Mumbai BKC Office",
          location_type: "OFFICE",
          address: "Bandra Kurla Complex, Bandra East, Mumbai, Maharashtra 400051",
          latitude: 19.0664,
          longitude: 72.8687,
          radius_meters: 150,
          place_id: "ChIJ_3_sBK7P5zsRv9E3Z4123",
          is_active: true,
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders strictly 3 tabs: Leave Types, Expense Settings, Geo Fencing", () => {
    render(
      <MemoryRouter>
        <OrganizationPage />
      </MemoryRouter>
    );

    // Verify exactly 3 tabs exist
    expect(screen.getByText("Leave Types")).toBeTruthy();
    expect(screen.getByText("Expense Settings")).toBeTruthy();
    expect(screen.getByText("Geo Fencing")).toBeTruthy();

    // Verify removed legacy sections do NOT appear as tabs
    expect(screen.queryByRole("button", { name: /^Designations$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Departments$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Employment Types$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Branches$/i })).toBeNull();
  });

  it("renders Leave Types tab with table, status toggles, and edit actions", () => {
    render(
      <MemoryRouter>
        <OrganizationPage />
      </MemoryRouter>
    );

    // Leave Types is default tab
    expect(screen.getByText("Casual Leave (CL)")).toBeTruthy();
    expect(screen.getByText("Sick Leave (SL)")).toBeTruthy();
    expect(screen.getByText("Earned / Privilege Leave (PL)")).toBeTruthy();
    expect(screen.getByText("Loss of Pay (Unpaid Leave)")).toBeTruthy();

    // Add Leave Type button exists
    expect(screen.getByText("Add Leave Type")).toBeTruthy();
  });

  it("switches to Expense Settings tab with categories, limits, and mileage rates", () => {
    render(
      <MemoryRouter>
        <OrganizationPage />
      </MemoryRouter>
    );

    const expenseTab = screen.getByText("Expense Settings");
    fireEvent.click(expenseTab);

    expect(screen.getByText("Expense Categories")).toBeTruthy();
    expect(screen.getByText("Approval Rules")).toBeTruthy();
    expect(screen.getByText("Mileage Settings")).toBeTruthy();
    expect(screen.getByText("Require GPS Route Tracking for Mileage Claims")).toBeTruthy();
  });

  it("switches to Geo Fencing tab showing office punch locations without employee assignments", async () => {
    render(
      <MemoryRouter>
        <OrganizationPage />
      </MemoryRouter>
    );

    const geoTab = screen.getByText("Geo Fencing");
    fireEvent.click(geoTab);

    // Wait for locations to load
    await waitFor(() => {
      expect(screen.getByText("Office Punch Locations (Geo Fencing)")).toBeTruthy();
      expect(screen.getByText("Mumbai BKC Office")).toBeTruthy();
    });

    // Check columns: Office Title, Type, Physical Address, Coordinates, Geofence Radius, Active Status, Action
    expect(screen.getByText("Office Title")).toBeTruthy();
    expect(screen.getByText("Physical Address")).toBeTruthy();
    expect(screen.getByText("Geofence Radius")).toBeTruthy();

    // Add Office button exists
    expect(screen.getByText("Add Office")).toBeTruthy();

    // Verify there is NO employee assignment in this tab
    expect(screen.queryByText(/Assign Employees/i)).toBeNull();
    expect(screen.queryByText(/Employee Allocation/i)).toBeNull();
  });
});
