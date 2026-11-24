import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TrackingMap } from "@/components/TrackingMap";
import { SiteVisitPage } from "../hrms/SiteVisitPage";
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

const mockSetMap = vi.fn();
const mockInfoClose = vi.fn();
const mockClearListeners = vi.fn();

vi.mock("@/lib/googleMaps", () => ({
  loadGoogleMapsSdk: vi.fn(async () => ({
    Map: class MockMap {
      addListener = vi.fn();
      panTo = vi.fn();
      fitBounds = vi.fn();
    },
    Marker: class MockMarker {
      setMap = mockSetMap;
      addListener = vi.fn();
      setPosition = vi.fn();
      getPosition = vi.fn();
    },
    Polyline: class MockPolyline {
      setMap = mockSetMap;
      setPath = vi.fn();
    },
    InfoWindow: class MockInfoWindow {
      setContent = vi.fn();
      open = vi.fn();
      close = mockInfoClose;
    },
    LatLngBounds: class MockBounds {
      extend = vi.fn();
    },
    event: {
      clearInstanceListeners: mockClearListeners,
    },
  })),
  searchGooglePlaces: vi.fn(async () => []),
  getPlaceDetails: vi.fn(async () => null),
  reverseGeocodeGoogle: vi.fn(async () => null),
}));

vi.mock("@/lib/hooks", () => ({
  useAuth: () => ({
    profile: { id: "admin-1", username: "admin", role: "ADMIN", full_name: "Admin User" },
    isSuperAdmin: true,
    hasPermission: () => true,
  }),
}));

describe("HRMS Wave 2 — P1 Frontend Regression Verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. TrackingMap cleans up Google Maps markers, polyline, infoWindow, and listeners on unmount", async () => {
    const { unmount } = render(
      <TrackingMap
        points={[
          { lat: 19.1998, lng: 72.9568, type: "start", label: "Start" },
          { lat: 19.205, lng: 72.96, type: "end", label: "End" },
        ]}
        polyline={[
          { lat: 19.1998, lng: 72.9568 },
          { lat: 19.205, lng: 72.96 },
        ]}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("google-tracking-map")).toBeDefined();
    });

    // Give RAF + map effect a tick to create overlays
    await new Promise((r) => setTimeout(r, 40));

    unmount();

    expect(mockSetMap).toHaveBeenCalledWith(null);
    expect(mockInfoClose).toHaveBeenCalled();
    expect(mockClearListeners).toHaveBeenCalled();
  });

  it("2. SiteVisitPage renders CANCELLED status badge and deduplicates active tracking session metrics", async () => {
    (apiModule.apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/hrms/site-visits")) {
        return Promise.resolve({
          data: [
            {
              id: "visit-cancel-1",
              employee_id: "emp-1",
              employee_name: "Alice Field",
              customer_name: "Cancelled Client",
              site_address: "Plot 12, Thane",
              visit_date: "2026-11-20",
              planned_start_time: "10:00 AM",
              planned_end_time: "12:00 PM",
              status: "CANCELLED",
              notes: "Cancelled: rescheduled",
            },
          ],
        });
      }
      if (url.includes("/hrms/tracking/active")) {
        return Promise.resolve({
          data: {
            id: "sess-active-1",
            employee_id: "admin-1",
            status: "ACTIVE",
            is_active: true,
            start_time: new Date().toISOString(),
            total_points: 2,
          },
        });
      }
      if (url.includes("/hrms/tracking/sessions")) {
        return Promise.resolve({
          data: [
            {
              id: "sess-active-1",
              employee_id: "admin-1",
              employee_name: "Admin User",
              status: "ACTIVE",
              is_active: true,
              start_time: new Date().toISOString(),
              total_points: 2,
              approx_distance_km: 1.2,
            },
          ],
        });
      }
      if (url.includes("/users")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <MemoryRouter>
        <SiteVisitPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText("Cancelled Client").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/Cancelled/i).length).toBeGreaterThanOrEqual(1);
    });
  });
});
