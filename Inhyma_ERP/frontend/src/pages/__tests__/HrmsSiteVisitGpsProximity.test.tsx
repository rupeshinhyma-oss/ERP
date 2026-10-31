import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

vi.mock("@/components/TrackingMap", () => ({
  TrackingMap: () => <div data-testid="tracking-map" />,
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

let mockCurrentUser = {
  id: "emp-uuid-1",
  username: "rahul",
  role: "EMPLOYEE",
  full_name: "Rahul Sharma",
};

vi.mock("@/lib/hooks", () => ({
  useAuth: () => ({
    profile: mockCurrentUser,
    isSuperAdmin: false,
    hasPermission: () => true,
  }),
}));

describe("HRMS Site Visit — Fresh GPS & Proximity Verification (Phase 2 Frontend)", () => {
  const scheduledVisit = {
    id: "visit-101",
    employee_id: "emp-uuid-1",
    employee_name: "Rahul Sharma",
    customer_name: "Client Logistics Hub",
    site_address: "Plot 50, Turbhe MIDC, Navi Mumbai",
    site_latitude: 19.1998,
    site_longitude: 72.9568,
    visit_date: "2026-10-31",
    planned_start_time: "10:00",
    planned_end_time: "18:00",
    status: "SCHEDULED",
    notes: "Site Inspection",
    check_in_time: null,
    check_in_latitude: null,
    check_in_longitude: null,
    check_in_accuracy: null,
    check_in_distance_meters: null,
    check_out_time: null,
    check_out_latitude: null,
    check_out_longitude: null,
    check_out_accuracy: null,
    check_out_distance_meters: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(apiModule.apiGet).mockImplementation(async (path: string) => {
      if (path.includes("/hrms/site-visits")) {
        return { data: [scheduledVisit] } as any;
      }
      if (path.includes("/users")) {
        return { data: [{ id: "emp-uuid-1", full_name: "Rahul Sharma" }] } as any;
      }
      return { data: [] } as any;
    });

    vi.mocked(apiModule.apiPost).mockResolvedValue({
      data: {
        ...scheduledVisit,
        status: "CHECKED_IN",
        check_in_time: "2026-10-31T10:05:00Z",
        check_in_latitude: 19.1999,
        check_in_longitude: 72.9569,
        check_in_accuracy: 15.0,
        check_in_distance_meters: 15.4,
      },
      message: "Checked in successfully! (15.4m away)",
    } as any);

    // Mock navigator.geolocation
    const mockGeolocation = {
      getCurrentPosition: vi.fn((success) => {
        success({
          coords: {
            latitude: 19.1999,
            longitude: 72.9569,
            accuracy: 15.0,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        });
      }),
      watchPosition: vi.fn((success) => {
        success({
          coords: {
            latitude: 19.1999,
            longitude: 72.9569,
            accuracy: 15.0,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        });
        return 1;
      }),
      clearWatch: vi.fn(),
    };
    Object.defineProperty(global.navigator, "geolocation", {
      value: mockGeolocation,
      configurable: true,
      writable: true,
    });
  });

  it("submits fresh coordinates, accuracy, and ISO timestamp when checking in", async () => {
    render(
      <MemoryRouter>
        <SiteVisitPage />
      </MemoryRouter>
    );

    // Wait for the scheduled visit to render
    const checkInBtns = await screen.findAllByRole("button", { name: "Check In" });
    fireEvent.click(checkInBtns[0]);

    // Modal opens -> click Confirm Check In
    const confirmBtn = await screen.findByRole("button", { name: /confirm check in/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith(
        "/hrms/site-visits/visit-101/check-in",
        expect.objectContaining({
          latitude: 19.1999,
          longitude: 72.9569,
          accuracy: 15.0,
          gps_timestamp: expect.any(String),
        })
      );
    });
  });

  it("blocks check-in when acquired GPS accuracy exceeds 100 metres", async () => {
    // Return weak accuracy (>100m)
    const weakGeo = {
      getCurrentPosition: vi.fn((success) => {
        success({
          coords: {
            latitude: 19.1999,
            longitude: 72.9569,
            accuracy: 150.0,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        });
      }),
      watchPosition: vi.fn((success) => {
        success({
          coords: {
            latitude: 19.1999,
            longitude: 72.9569,
            accuracy: 150.0,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        });
        return 2;
      }),
      clearWatch: vi.fn(),
    };
    Object.defineProperty(global.navigator, "geolocation", {
      value: weakGeo,
      configurable: true,
      writable: true,
    });

    render(
      <MemoryRouter>
        <SiteVisitPage />
      </MemoryRouter>
    );

    const checkInBtns = await screen.findAllByRole("button", { name: "Check In" });
    fireEvent.click(checkInBtns[0]);

    const confirmBtn = await screen.findByRole("button", { name: /confirm check in/i });
    fireEvent.click(confirmBtn);

    // apiPost should NOT be called due to weak accuracy (> 100m)
    await waitFor(() => {
      expect(apiModule.apiPost).not.toHaveBeenCalled();
    });
  });

  it("initiates GPS capture with 20000ms timeout, high accuracy, and maximumAge 0", async () => {
    let capturedOptions: PositionOptions | undefined;
    const mockGeo = {
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn((_success, _error, options) => {
        capturedOptions = options;
        return 42;
      }),
      clearWatch: vi.fn(),
    };
    Object.defineProperty(global.navigator, "geolocation", {
      value: mockGeo,
      configurable: true,
      writable: true,
    });

    render(
      <MemoryRouter>
        <SiteVisitPage />
      </MemoryRouter>
    );

    const checkInBtns = await screen.findAllByRole("button", { name: "Check In" });
    fireEvent.click(checkInBtns[0]);

    await waitFor(() => {
      expect(mockGeo.watchPosition).toHaveBeenCalled();
    });

    expect(capturedOptions).toEqual({
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    });
  });

  it("cleans up active watchPosition and safety timer when modal is closed", async () => {
    const mockGeo = {
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn(() => 77),
      clearWatch: vi.fn(),
    };
    Object.defineProperty(global.navigator, "geolocation", {
      value: mockGeo,
      configurable: true,
      writable: true,
    });

    render(
      <MemoryRouter>
        <SiteVisitPage />
      </MemoryRouter>
    );

    const checkInBtns = await screen.findAllByRole("button", { name: "Check In" });
    fireEvent.click(checkInBtns[0]);

    await waitFor(() => {
      expect(mockGeo.watchPosition).toHaveBeenCalled();
    });

    // Close modal via Cancel button
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(mockGeo.clearWatch).toHaveBeenCalledWith(77);
    });
  });

  it("handles GPS timeout gracefully after 20 seconds without duplicate errors", async () => {
    const mockGeo = {
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn((_success, error) => {
        // Trigger timeout error
        setTimeout(() => {
          error({
            code: 3,
            message: "Geolocation timeout",
          });
        }, 10);
        return 88;
      }),
      clearWatch: vi.fn(),
    };
    Object.defineProperty(global.navigator, "geolocation", {
      value: mockGeo,
      configurable: true,
      writable: true,
    });

    render(
      <MemoryRouter>
        <SiteVisitPage />
      </MemoryRouter>
    );

    const checkInBtns = await screen.findAllByRole("button", { name: "Check In" });
    fireEvent.click(checkInBtns[0]);

    await waitFor(() => {
      expect(screen.getByText(/Location request timed out \(20s\)\. Please click Retry Location\./i)).toBeDefined();
    });
  });

  it("ignores late GPS callbacks belonging to an earlier acquisition attempt", async () => {
    let firstAttemptSuccessCallback: ((pos: any) => void) | null = null;
    let watchCallCount = 0;

    const mockGeo = {
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn((success) => {
        watchCallCount++;
        if (watchCallCount === 1) {
          firstAttemptSuccessCallback = success;
          // First attempt provides an initial weak reading so retry is available
          success({
            coords: {
              latitude: 12.0,
              longitude: 70.0,
              accuracy: 200.0,
            },
            timestamp: Date.now(),
          });
        } else {
          // Second attempt succeeds with fresh good fix (<= 25m triggers finalizeReading)
          success({
            coords: {
              latitude: 19.1998,
              longitude: 72.9568,
              accuracy: 20.0,
            },
            timestamp: Date.now(),
          });
        }
        return watchCallCount;
      }),
      clearWatch: vi.fn(),
    };
    Object.defineProperty(global.navigator, "geolocation", {
      value: mockGeo,
      configurable: true,
      writable: true,
    });

    render(
      <MemoryRouter>
        <SiteVisitPage />
      </MemoryRouter>
    );

    const checkInBtns = await screen.findAllByRole("button", { name: "Check In" });
    fireEvent.click(checkInBtns[0]);

    await waitFor(() => {
      expect(mockGeo.watchPosition).toHaveBeenCalled();
    });

    // User clicks Retry Location to increment attemptId
    const retryBtn = await screen.findByRole("button", { name: /retry location/i });
    fireEvent.click(retryBtn);

    // Now late callback from attempt 1 arrives with stale/bad data
    if (firstAttemptSuccessCallback) {
      (firstAttemptSuccessCallback as any)({
        coords: {
          latitude: 12.3456,
          longitude: 65.4321,
          accuracy: 999.0,
        },
        timestamp: Date.now() - 50000,
      });
    }

    // State should NOT be overwritten with the stale 999m accuracy or stale coords
    await waitFor(() => {
      expect(screen.getByText(/Location captured/i)).toBeDefined();
    });
  });

  it("displays coarse accuracy guidance when GPS accuracy > 500m", async () => {
    const coarseGeo = {
      getCurrentPosition: vi.fn((success) => {
        success({
          coords: {
            latitude: 19.1999,
            longitude: 72.9569,
            accuracy: 850.0, // > 500m Coarse
          },
          timestamp: Date.now(),
        });
      }),
      watchPosition: vi.fn((success) => {
        success({
          coords: {
            latitude: 19.1999,
            longitude: 72.9569,
            accuracy: 850.0,
          },
          timestamp: Date.now(),
        });
        return 99;
      }),
      clearWatch: vi.fn(),
    };
    Object.defineProperty(global.navigator, "geolocation", {
      value: coarseGeo,
      configurable: true,
      writable: true,
    });

    render(
      <MemoryRouter>
        <SiteVisitPage />
      </MemoryRouter>
    );

    const checkInBtns = await screen.findAllByRole("button", { name: "Check In" });
    fireEvent.click(checkInBtns[0]);

    // Should display Precise Location guidance in status
    await waitFor(() => {
      expect(
        screen.getByText(/GPS accuracy is coarse \(±850m\)\. Please enable Precise Location in your device browser settings\./i)
      ).toBeDefined();
    });

    // Confirm check in should be rejected
    const confirmBtn = await screen.findByRole("button", { name: /confirm check in/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiModule.apiPost).not.toHaveBeenCalled();
    });
  });

  it("displays weak accuracy warning when GPS accuracy is between 101m and 500m", async () => {
    const weakGeo = {
      getCurrentPosition: vi.fn((success) => {
        success({
          coords: {
            latitude: 19.1999,
            longitude: 72.9569,
            accuracy: 250.0, // 100m < accuracy <= 500m
          },
          timestamp: Date.now(),
        });
      }),
      watchPosition: vi.fn((success) => {
        success({
          coords: {
            latitude: 19.1999,
            longitude: 72.9569,
            accuracy: 250.0,
          },
          timestamp: Date.now(),
        });
        return 101;
      }),
      clearWatch: vi.fn(),
    };
    Object.defineProperty(global.navigator, "geolocation", {
      value: weakGeo,
      configurable: true,
      writable: true,
    });

    render(
      <MemoryRouter>
        <SiteVisitPage />
      </MemoryRouter>
    );

    const checkInBtns = await screen.findAllByRole("button", { name: "Check In" });
    fireEvent.click(checkInBtns[0]);

    // Should display weak accuracy warning in status
    await waitFor(() => {
      expect(
        screen.getByText((content) => content.includes("GPS accuracy is weak") && content.includes("250m") && content.includes("exceeds 100m limit"))
      ).toBeDefined();
    });

    const confirmBtn = await screen.findByRole("button", { name: /confirm check in/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiModule.apiPost).not.toHaveBeenCalled();
    });
  });
});
