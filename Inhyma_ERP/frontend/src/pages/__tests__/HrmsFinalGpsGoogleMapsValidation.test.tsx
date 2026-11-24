import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TrackingMap } from "@/components/TrackingMap";
import * as googleMapsLib from "@/lib/googleMaps";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  errorMessage: (e: unknown, fallback = "Error") => (e instanceof Error ? e.message : fallback),
  API_BASE: "/api/v1",
}));

const mockUser = {
  id: "emp-1",
  username: "emp1",
  email: "emp1@test.local",
  display_name: "Employee One",
  role: "EMPLOYEE",
  is_superuser: false,
  permissions: ["hrms.view", "hrms.site_visits.view"],
};

const mockHasPermission = (p: string) => p === "hrms.view" || p === "hrms.site_visits.view";

vi.mock("@/lib/hooks", () => ({
  useAuth: () => ({
    user: mockUser,
    profile: mockUser,
    isSuperAdmin: false,
    isAuthenticated: true,
    hasPermission: mockHasPermission,
  }),
}));

const mockToastFn = vi.fn();
vi.mock("@/lib/toast", () => ({
  useToast: () => mockToastFn,
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: any }) => <div data-testid="appshell">{children}</div>,
}));

vi.mock("@/components/Breadcrumb", () => ({
  Breadcrumb: () => <div data-testid="breadcrumb" />,
}));

import { apiGet, apiPost } from "@/lib/api";
import SiteVisitPage from "@/pages/hrms/SiteVisitPage";
import { PayrollPage } from "@/pages/hrms/PayrollPage";

describe("HRMS Final GPS & Google Maps Reliability Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("DEF-05b: TrackingMap switches to Google Maps Unavailable on async gm_authFailure", async () => {
    let errorCb: ((detail: googleMapsLib.GoogleMapsErrorDetail) => void) | null = null;
    vi.spyOn(googleMapsLib, "subscribeGoogleMapsError").mockImplementation((cb) => {
      errorCb = cb;
      return () => {
        errorCb = null;
      };
    });

    render(
      <TrackingMap
        points={[{ lat: 19.199824, lng: 72.956795, type: "start", label: "Thane HQ" }]}
        polyline={[
          { lat: 19.199824, lng: 72.956795 },
          { lat: 19.205, lng: 72.96 },
        ]}
        title="Live Route"
      />
    );

    await waitFor(() => {
      expect(errorCb).not.toBeNull();
    });

    act(() => {
      errorCb?.({
        type: "AUTH_FAILURE",
        message: "Google Maps Platform authentication failed (billing/key).",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Google Maps Unavailable")).toBeTruthy();
      expect(
        screen.getByText("Google Maps Platform authentication failed (billing/key).")
      ).toBeTruthy();
    });
  });

  it("DEF-05b: TrackingMap HTML-escapes marker labels/addresses in InfoWindow and fits polyline bounds", async () => {
    let capturedHtml = "";
    const fitBoundsSpy = vi.fn();
    const extendSpy = vi.fn();
    const setOptionsSpy = vi.fn();
    let clickHandler: (() => void) | null = null;

    const fakeMaps: any = {
      Map: class {
        setCenter = vi.fn();
        setZoom = vi.fn();
        panTo = vi.fn();
        fitBounds = fitBoundsSpy;
        addListener = vi.fn();
      },
      Marker: class {
        setMap = vi.fn();
        setPosition = vi.fn();
        getPosition = () => ({ lat: () => 19.2, lng: () => 72.95 });
        addListener = (ev: string, fn: () => void) => {
          if (ev === "click") clickHandler = fn;
        };
      },
      Polyline: class {
        setMap = vi.fn();
        setPath = vi.fn();
        setOptions = setOptionsSpy;
      },
      LatLngBounds: class {
        extend = extendSpy;
      },
      InfoWindow: class {
        setContent = (html: string) => {
          capturedHtml = html;
        };
        open = vi.fn();
        close = vi.fn();
      },
      event: { clearInstanceListeners: vi.fn() },
    };

    vi.spyOn(googleMapsLib, "loadGoogleMapsSdk").mockResolvedValue(fakeMaps);

    const { rerender } = render(
      <TrackingMap
        points={[
          {
            lat: 19.199824,
            lng: 72.956795,
            type: "start",
            label: "<img src=x onerror=alert(1)>HQ",
            address: "<script>evil()</script>Thane",
          },
        ]}
        polyline={[
          { lat: 19.199824, lng: 72.956795 },
          { lat: 19.21, lng: 72.97 },
        ]}
        isSimulated={false}
      />
    );

    await waitFor(() => {
      expect(fitBoundsSpy).toHaveBeenCalled();
      expect(clickHandler).not.toBeNull();
    });

    // Polyline coordinates were included in fitBounds even with only 1 marker
    expect(extendSpy.mock.calls.length).toBeGreaterThanOrEqual(3);

    // Clicking marker escapes HTML payloads
    act(() => {
      clickHandler?.();
    });
    expect(capturedHtml).not.toContain("<script>");
    expect(capturedHtml).not.toContain("<img src=x");
    expect(capturedHtml).toContain("&lt;img src=x onerror=alert(1)&gt;HQ");
    expect(capturedHtml).toContain("&lt;script&gt;evil()&lt;/script&gt;Thane");

    // Toggling isSimulated updates existing polyline strokeColor
    rerender(
      <TrackingMap
        points={[{ lat: 19.199824, lng: 72.956795, type: "start", label: "Safe" }]}
        polyline={[
          { lat: 19.199824, lng: 72.956795 },
          { lat: 19.21, lng: 72.97 },
        ]}
        isSimulated={true}
      />
    );

    await waitFor(() => {
      expect(setOptionsSpy).toHaveBeenCalledWith({ strokeColor: "#d97706" });
    });
  });

  it("DEF-06: SiteVisitPage flushes offline-buffered live tracking points on online reconnect & allows STOP without GPS", async () => {
    const activeSess = {
      id: "sess-offline-1",
      employee_id: "emp-1",
      status: "ACTIVE",
      start_time: new Date(Date.now() - 60000).toISOString(),
      total_points: 1,
      points_count: 1,
      is_detailed_tracking_enabled: false,
      detailed_interval_minutes: 5,
      route_summary: [{ lat: 19.1998, lng: 72.9568, time: new Date().toISOString() }],
    };

    // Pre-seed an offline buffered point from an interrupted network state
    const queuedPoint = {
      latitude: 19.2045,
      longitude: 72.9591,
      accuracy: 11.5,
      recorded_at: new Date(Date.now() - 25000).toISOString(),
    };
    sessionStorage.setItem("hrms_tracking_queue_sess-offline-1", JSON.stringify([queuedPoint]));

    (apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/hrms/tracking/active")) return Promise.resolve({ data: activeSess });
      if (url.includes("/hrms/tracking/sessions")) return Promise.resolve({ data: [activeSess] });
      if (url.includes("/hrms/site-visits")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    const postCalls: Array<{ url: string; body: any }> = [];
    (apiPost as any).mockImplementation((url: string, body: any) => {
      postCalls.push({ url, body });
      return Promise.resolve({ data: { recorded_count: 1, status: "COMPLETED" } });
    });

    // Simulate GPS unavailable indoors when Stop Tracking is clicked
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (_ok: any, err: any) => err({ code: 2, message: "Position unavailable" }),
      },
    });

    render(
      <MemoryRouter>
        <SiteVisitPage />
      </MemoryRouter>
    );

    // Auto-flush on mount/online sends the buffered point with its preserved original recorded_at timestamp
    await waitFor(() => {
      const flushCall = postCalls.find((c) => c.url === "/hrms/tracking/points");
      expect(flushCall).toBeDefined();
      expect(flushCall?.body.session_id).toBe("sess-offline-1");
      expect(flushCall?.body.points[0].recorded_at).toBe(queuedPoint.recorded_at);
      expect(flushCall?.body.points[0].latitude).toBe(19.2045);
    });

    // Switch to Live Tracking tab and click Stop Tracking while GPS is unavailable -> MUST still stop cleanly with end_location: null!
    const liveTab = await screen.findByText("Live Tracking");
    fireEvent.click(liveTab);
    const stopBtn = await screen.findByText("Stop Tracking");
    fireEvent.click(stopBtn);

    await waitFor(() => {
      const stopCall = postCalls.find((c) => c.url === "/hrms/tracking/sess-offline-1/stop");
      expect(stopCall).toBeDefined();
      expect(stopCall?.body).toEqual({ end_location: null });
    });
  });

  it("OBS-01: PayrollPage wraps wide tables in .table-responsive without hiding columns", async () => {
    (apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/hrms/payroll/payslips")) return Promise.resolve({ data: [] });
      if (url.includes("/hrms/payroll/components")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    const { container } = render(
      <MemoryRouter>
        <PayrollPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("My Approved Salary Slips")).toBeTruthy();
    });

    // Verify all 9 salary slip columns are preserved inside .table-responsive
    const wrapper = container.querySelector(".table-responsive");
    expect(wrapper).not.toBeNull();
    const headers = Array.from(wrapper!.querySelectorAll("th")).map((el) => el.textContent?.trim());
    expect(headers).toEqual([
      "Payroll Month",
      "Working Days",
      "Present",
      "LOP Days",
      "Gross Salary",
      "Deductions",
      "Net Salary",
      "Status",
      "Actions",
    ]);
  });
});
