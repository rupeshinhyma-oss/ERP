import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SiteVisitPage } from "../hrms/SiteVisitPage";
import { AttendancePage } from "../hrms/AttendancePage";
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

let mockCurrentUser = {
  id: "admin-uuid-1",
  username: "admin",
  role: "ADMIN",
  full_name: "Admin User",
};

vi.mock("@/lib/hooks", () => ({
  useAuth: () => ({
    profile: mockCurrentUser,
    isSuperAdmin: mockCurrentUser.role === "ADMIN",
    hasPermission: () => mockCurrentUser.role === "ADMIN",
  }),
}));

describe("Site Visit + Live Tracking + Attendance Regularization Tests", () => {
  const mockVisits = [
    {
      id: "visit-1",
      employee_id: "emp-uuid-1",
      employee_name: "Rahul Sharma",
      customer_name: "ABC Industries",
      site_address: "Plot 42, Turbhe MIDC, Navi Mumbai",
      visit_date: "2026-10-06",
      planned_start_time: "10:00 AM",
      planned_end_time: "07:00 PM",
      status: "SCHEDULED",
      notes: "Quarterly ERP setup audit",
      check_in_time: null,
      check_in_latitude: null,
      check_in_longitude: null,
      check_out_time: null,
      check_out_latitude: null,
      check_out_longitude: null,
    },
  ];

  const mockUsersList = [
    { id: "emp-uuid-1", full_name: "Rahul Sharma", email: "rahul@example.com", is_active: true },
    { id: "emp-uuid-2", full_name: "Pooja Mehta", email: "pooja@example.com", is_active: true },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentUser = {
      id: "admin-uuid-1",
      username: "admin",
      role: "ADMIN",
      full_name: "Admin User",
    };

    (apiModule.apiGet as any).mockImplementation((url: string) => {
      // 1. Evidence endpoint (matches both regularization evidence and site-visit evidence)
      if (url.includes("/evidence")) {
        return Promise.resolve({
          data: {
            employee_id: "emp-uuid-1",
            employee_name: "Rahul Sharma",
            date: "2026-10-06",
            reason: "Customer site visit",
            attendance_issue: "Missing Punch",
            site_visits: [
              {
                id: "visit-1",
                customer_site_name: "ABC Industries",
                site_address: "Plot 42, Turbhe MIDC",
                visit_date: "2026-10-06",
                planned_start_time: "10:00 AM",
                planned_end_time: "07:00 PM",
                status: "COMPLETED",
                check_in_time: "2026-10-06T10:42:00Z",
                check_in_latitude: 19.076,
                check_in_longitude: 72.8777,
                check_out_time: "2026-10-06T18:35:00Z",
                check_out_latitude: 19.0762,
                check_out_longitude: 72.8779,
              },
            ],
            tracking_sessions: [
              {
                id: "track-1",
                employee_name: "Rahul Sharma",
                session_date: "2026-10-06",
                start_time: "2026-10-06T09:35:00Z",
                end_time: "2026-10-06T19:05:00Z",
                total_duration_seconds: 27000,
                approximate_distance_km: 24.3,
                is_active: false,
                route_summary: [
                  { lat: 19.076, lng: 72.8777, time: "2026-10-06T09:35:00Z" },
                  { lat: 19.1, lng: 72.9, time: "2026-10-06T14:00:00Z" },
                  { lat: 19.12, lng: 72.92, time: "2026-10-06T19:05:00Z" },
                ],
              },
            ],
          },
        });
      }

      // 2. Regularizations list
      if (url.includes("/hrms/attendance/regularizations")) {
        return Promise.resolve({
          data: [
            {
              id: "reg-site-1",
              employee_id: "emp-uuid-1",
              employee_name: "Rahul Sharma",
              attendance_date: "2026-10-06",
              request_type: "MISSING_PUNCH",
              reason: "Customer site visit",
              notes: "Auditing client infrastructure at ABC Industries",
              status: "PENDING",
              punch_in: "10:00",
              punch_out: "19:00",
              total_hours: "9h00m",
            },
          ],
        });
      }

      // 3. Site visits and tracking
      if (url.includes("/hrms/site-visits")) return Promise.resolve({ data: mockVisits });
      if (url.includes("/hrms/tracking/active")) return Promise.resolve({ data: null });
      if (url.includes("/hrms/tracking/sessions")) return Promise.resolve({ data: [] });
      if (url.includes("/users")) return Promise.resolve({ data: mockUsersList });

      // 4. Attendance general
      if (url.includes("/hrms/attendance/today")) return Promise.resolve({ data: null });
      if (url.includes("/hrms/attendance/policy")) return Promise.resolve({ data: null });
      if (url.includes("/hrms/attendance/assigned-office")) return Promise.resolve({ data: null });
      if (url.includes("/hrms/attendance/calendar")) return Promise.resolve({ data: [] });

      return Promise.resolve({ data: [] });
    });

    (apiModule.apiPost as any).mockImplementation((url: string, body: any) => {
      if (url === "/hrms/site-visits") {
        return Promise.resolve({
          data: {
            ...body,
            id: "visit-created-1",
            employee_name: "Rahul Sharma",
            status: "SCHEDULED",
          },
        });
      }
      if (url === "/hrms/tracking/start") {
        return Promise.resolve({
          data: {
            id: "track-created-1",
            session_date: "2026-10-06",
            start_time: "2026-10-06T09:35:00Z",
            is_active: true,
            total_duration_seconds: 0,
            approximate_distance_km: 0,
          },
        });
      }
      if (url.includes("/check-in")) {
        return Promise.resolve({
          data: {
            ...mockVisits[0],
            status: "CHECKED_IN",
            check_in_time: "2026-10-06T10:42:00Z",
            check_in_latitude: 19.076,
            check_in_longitude: 72.8777,
          },
        });
      }
      if (url.includes("/check-out")) {
        return Promise.resolve({
          data: {
            ...mockVisits[0],
            status: "COMPLETED",
            check_out_time: "2026-10-06T18:35:00Z",
            check_out_latitude: 19.0762,
            check_out_longitude: 72.8779,
          },
        });
      }
      if (url.includes("/stop")) {
        return Promise.resolve({
          data: {
            id: "track-1",
            is_active: false,
            total_duration_seconds: 27000,
            approximate_distance_km: 24.3,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    (apiModule.apiPatch as any).mockImplementation(() => {
      return Promise.resolve({ data: { status: "APPROVED" } });
    });
  });

  it("1. Admin sees Schedule Site Visit button and table with assigned visits", async () => {
    render(
      <MemoryRouter>
        <SiteVisitPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Site Visit & Live Tracking" })).toBeDefined();
      expect(screen.getByRole("button", { name: /schedule site visit/i })).toBeDefined();
      expect(screen.getAllByText("ABC Industries").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Rahul Sharma").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("2. Admin schedules a site visit via modal", async () => {
    render(
      <MemoryRouter>
        <SiteVisitPage />
      </MemoryRouter>
    );

    const scheduleBtn = await screen.findByRole("button", { name: /schedule site visit/i });
    fireEvent.click(scheduleBtn);

    expect(screen.getByRole("heading", { name: "Schedule Site Visit" })).toBeDefined();

    // Select employee
    const empSelect = document.getElementById("modal-sv-employee") as HTMLSelectElement;
    fireEvent.change(empSelect, { target: { value: "emp-uuid-1" } });

    // Customer name
    const custInput = document.getElementById("modal-sv-customer") as HTMLInputElement;
    fireEvent.change(custInput, { target: { value: "XYZ Global Midc" } });

    // Address
    const addrInput = document.getElementById("modal-sv-address") as HTMLTextAreaElement;
    fireEvent.change(addrInput, { target: { value: "Plot 10, Bhosari MIDC, Pune" } });

    // Date
    const dateInput = document.getElementById("modal-sv-date") as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-10-07" } });

    // Submit
    const submitBtn = screen.getByRole("button", { name: /assign & schedule/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith(
        "/hrms/site-visits",
        expect.objectContaining({
          customer_site_name: "XYZ Global Midc",
          employee_id: "emp-uuid-1",
        })
      );
    });
  });

  it("3. Employee sees assigned visits and can check in with GPS", async () => {
    mockCurrentUser = {
      id: "emp-uuid-1",
      username: "rahul",
      role: "EMPLOYEE",
      full_name: "Rahul Sharma",
    };

    render(
      <MemoryRouter>
        <SiteVisitPage />
      </MemoryRouter>
    );

    const checkInBtns = await screen.findAllByRole("button", { name: "Check In" });
    fireEvent.click(checkInBtns[0]);

    const confirmBtn = await screen.findByRole("button", { name: /confirm check in/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith(
        "/hrms/site-visits/visit-1/check-in",
        expect.any(Object)
      );
    });
  });

  it("4. Live Tracking can be started independently without affecting site visit check-in", async () => {
    mockCurrentUser = {
      id: "emp-uuid-1",
      username: "rahul",
      role: "EMPLOYEE",
      full_name: "Rahul Sharma",
    };

    render(
      <MemoryRouter>
        <SiteVisitPage />
      </MemoryRouter>
    );

    const liveTrackingTab = screen.getByRole("button", { name: "Live Tracking" });
    fireEvent.click(liveTrackingTab);

    const startTrackingBtn = await screen.findByRole("button", { name: /start live tracking/i });
    expect(screen.getByText("Not Started")).toBeDefined();

    fireEvent.click(startTrackingBtn);

    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith(
        "/hrms/tracking/start",
        expect.any(Object)
      );
    });
  });

  it("5. Attendance Regularization includes 'Customer site visit' in reason select and opens Evidence Modal", async () => {
    render(
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    );

    // Switch to Approval Tab
    const approvalTabBtn = screen.getByRole("button", { name: /approval/i });
    fireEvent.click(approvalTabBtn);

    await waitFor(() => {
      expect(screen.getByTestId("pending-approvals-table")).toBeDefined();
      expect(screen.getByText("Rahul Sharma")).toBeDefined();
      expect(screen.getByTestId("review-evidence-btn-reg-site-1")).toBeDefined();
    });

    // Click Evidence button
    const evidenceBtn = screen.getByTestId("review-evidence-btn-reg-site-1");
    fireEvent.click(evidenceBtn);

    // Verify Evidence Modal contents
    await waitFor(() => {
      expect(screen.getByTestId("regularization-evidence-modal")).toBeDefined();
      expect(screen.getByText("ABC Industries")).toBeDefined();
      expect(screen.getByText(/24.3 km/i)).toBeDefined();
      expect(screen.getByTestId("view-route-btn-track-1")).toBeDefined();
    });

    // Click View Route in evidence modal
    const viewRouteBtn = screen.getByTestId("view-route-btn-track-1");
    fireEvent.click(viewRouteBtn);

    await waitFor(() => {
      expect(screen.getByTestId("route-detail-modal")).toBeDefined();
      expect(screen.getByText("Travel Route & GPS Checkpoints")).toBeDefined();
    });

    // Close Route modal
    const closeBtn = screen.getByTestId("close-route-modal-btn");
    fireEvent.click(closeBtn);

    // Approve from within the evidence modal
    const approveBtn = screen.getByTestId("evidence-approve-btn");
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(apiModule.apiPatch).toHaveBeenCalledWith(
        "/hrms/attendance/regularizations/reg-site-1/approve",
        expect.objectContaining({
          action: "APPROVE",
        })
      );
    });
  });
});
