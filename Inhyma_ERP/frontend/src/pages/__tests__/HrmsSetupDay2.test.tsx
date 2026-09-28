import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SetupPage } from "../hrms/SetupPage";
import * as apiModule from "@/lib/api";

afterEach(() => {
  cleanup();
});

// Mock AppShell to keep unit tests fast and focused on page shells and activeKey
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock API layer
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

const { mockMapsSdk } = vi.hoisted(() => ({
  mockMapsSdk: {
    Map: vi.fn().mockImplementation(() => ({
      setCenter: vi.fn(),
      setZoom: vi.fn(),
    })),
    Marker: vi.fn().mockImplementation(() => ({
      setPosition: vi.fn(),
      getPosition: vi.fn().mockReturnValue({ lat: () => 19.199824, lng: () => 72.956795 }),
      addListener: vi.fn(),
    })),
    Circle: vi.fn().mockImplementation(() => ({
      setCenter: vi.fn(),
      setRadius: vi.fn(),
    })),
  },
}));

// Mock Google Maps SDK loader and place helpers
vi.mock("@/lib/googleMaps", () => ({
  loadGoogleMapsSdk: vi.fn().mockImplementation(() => Promise.resolve(mockMapsSdk)),
  searchGooglePlaces: vi.fn().mockResolvedValue([]),
  fetchGooglePlaceDetails: vi.fn().mockResolvedValue(null),
  reverseGeocodeGoogle: vi.fn().mockResolvedValue(null),
}));

describe("HRMS Day 2 — Setup Module Tests", () => {
  const mockLeaveTypes = [
    {
      id: "leave-1",
      name: "Casual Leave",
      code: "CL",
      leave_type: "CASUAL",
      is_paid: true,
      annual_balance: 12,
      carry_forward_days: 0,
      max_consecutive_days: 3,
      monthly_accrual: false,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    },
    {
      id: "leave-2",
      name: "Sick Leave",
      code: "SL",
      leave_type: "SICK",
      is_paid: true,
      annual_balance: 12,
      carry_forward_days: 0,
      max_consecutive_days: 5,
      monthly_accrual: false,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    },
    {
      id: "leave-3",
      name: "Privilege Leave",
      code: "PL",
      leave_type: "PRIVILEGE",
      is_paid: true,
      annual_balance: 18,
      carry_forward_days: 10,
      max_consecutive_days: 10,
      monthly_accrual: true,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    },
  ];

  const mockCategories = [
    {
      id: "cat-1",
      name: "Travel",
      code: "EXP-TRV",
      description: "Business travel expenses",
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    },
    {
      id: "cat-2",
      name: "Meals",
      code: "EXP-MLS",
      description: "Client and team food expenses",
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    },
  ];

  const mockExpenseSettings = {
    id: "settings-1",
    approval_team_lead: true,
    approval_manager: true,
    approval_accounts: true,
    max_claim_amount: 50000,
    receipt_required: true,
    auto_approval_limit: 500,
    submission_window_days: 30,
  };

  const mockLocations = [
    {
      id: "loc-thane",
      name: "Inhyma Thane Office",
      location_type: "OFFICE",
      address:
        "Office No 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
      latitude: 19.199824,
      longitude: 72.956795,
      radius_meters: 150,
      is_active: true,
      employees_assigned: 15,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiModule.apiGet).mockImplementation(async (url: string) => {
      if (url.includes("/hrms/setup/leave-types")) {
        return { data: mockLeaveTypes } as any;
      }
      if (url.includes("/hrms/setup/expense-categories")) {
        return { data: mockCategories } as any;
      }
      if (url.includes("/hrms/setup/expense-settings")) {
        return { data: mockExpenseSettings } as any;
      }
      if (url.includes("/hrms/setup/locations")) {
        return { data: mockLocations } as any;
      }
      return { data: null } as any;
    });

    vi.mocked(apiModule.apiPost).mockResolvedValue({
      data: { id: "new-id", success: true },
    } as any);

    vi.mocked(apiModule.apiPut).mockResolvedValue({
      data: { success: true },
    } as any);

    vi.mocked(apiModule.apiPatch).mockResolvedValue({
      data: { success: true },
    } as any);

    vi.mocked(apiModule.apiDelete).mockResolvedValue({
      data: { success: true },
    } as any);
  });

  // =========================================================================
  // TAB 1: LEAVE TYPES TESTS
  // =========================================================================
  describe("Tab 1: Leave Types", () => {
    it("renders leave types table and seed leaves from database", async () => {
      render(
        <MemoryRouter>
          <SetupPage />
        </MemoryRouter>
      );

      expect(screen.getByText("Leave Types & Entitlements")).toBeDefined();

      await waitFor(() => {
        expect(screen.getByText("Casual Leave")).toBeDefined();
        expect(screen.getByText("Sick Leave")).toBeDefined();
        expect(screen.getByText("Privilege Leave")).toBeDefined();
      });

      // Verify columns
      expect(screen.getByText("Annual Balance")).toBeDefined();
      expect(screen.getByText("Carry Forward")).toBeDefined();
      expect(screen.getByText("Max Consecutive")).toBeDefined();
    });

    it("opens Add Leave Type modal and submits new leave type", async () => {
      render(
        <MemoryRouter>
          <SetupPage />
        </MemoryRouter>
      );

      const addBtn = screen.getByRole("button", { name: /\+ Add Leave Type/i });
      fireEvent.click(addBtn);

      await waitFor(() => {
        expect(screen.getByText("Add Leave Type")).toBeDefined();
      });

      // Fill in Name
      const nameInput = screen.getByPlaceholderText(/e\.g\. Casual Leave/i);
      fireEvent.change(nameInput, { target: { value: "Maternity Leave" } });

      // Submit form
      const submitBtn = screen.getByRole("button", { name: /Create Leave Type/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(apiModule.apiPost).toHaveBeenCalledWith(
          "/hrms/setup/leave-types",
          expect.objectContaining({
            name: "Maternity Leave",
            is_paid: true,
          })
        );
      });
    });

    it("toggles status of leave type (Disable / Enable)", async () => {
      render(
        <MemoryRouter>
          <SetupPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Casual Leave")).toBeDefined();
      });

      const disableBtns = screen.getAllByRole("button", { name: /^Disable$/i });
      expect(disableBtns.length).toBeGreaterThan(0);
      fireEvent.click(disableBtns[0]);

      await waitFor(() => {
        expect(apiModule.apiPatch).toHaveBeenCalledWith(
          "/hrms/setup/leave-types/leave-1/status",
          expect.objectContaining({ is_active: false })
        );
      });
    });
  });

  // =========================================================================
  // TAB 2: EXPENSE SETTINGS TESTS
  // =========================================================================
  describe("Tab 2: Expense Settings", () => {
    it("renders expense categories and workflow options when switching to tab", async () => {
      render(
        <MemoryRouter>
          <SetupPage />
        </MemoryRouter>
      );

      const expenseTabBtn = screen.getByRole("button", { name: /Expense Settings/i });
      fireEvent.click(expenseTabBtn);

      await waitFor(() => {
        expect(screen.getByText("Travel")).toBeDefined();
        expect(screen.getByText("Meals")).toBeDefined();
        expect(screen.getByText("Approval Workflow")).toBeDefined();
        expect(screen.getByText("Claim Rules")).toBeDefined();
      });
    });

    it("saves updated approval workflow and claim limits", async () => {
      render(
        <MemoryRouter>
          <SetupPage />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole("button", { name: /Expense Settings/i }));

      await waitFor(() => {
        expect(screen.getByText("Approval Workflow")).toBeDefined();
      });

      const saveBtn = screen.getByRole("button", { name: /Save Expense Settings/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(apiModule.apiPut).toHaveBeenCalledWith(
          "/hrms/setup/expense-settings",
          expect.objectContaining({
            approval_team_lead: true,
            approval_manager: true,
            approval_accounts: true,
            max_claim_amount: 50000,
            submission_window_days: 30,
          })
        );
      });
    });

    it("opens Add Expense Category modal and creates a category", async () => {
      render(
        <MemoryRouter>
          <SetupPage />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole("button", { name: /Expense Settings/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /\+ Add Category/i })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: /\+ Add Category/i }));

      await waitFor(() => {
        expect(screen.getByText("Add Expense Category")).toBeDefined();
      });

      const nameInput = screen.getByPlaceholderText(/e\.g\. Travel, Meals, Fuel, Lodging/i);
      fireEvent.change(nameInput, { target: { value: "Fuel & Transport" } });

      const submitBtn = screen.getByRole("button", { name: /Create Category/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(apiModule.apiPost).toHaveBeenCalledWith(
          "/hrms/setup/expense-categories",
          expect.objectContaining({
            name: "Fuel & Transport",
          })
        );
      });
    });
  });

  // =========================================================================
  // TAB 3: GEO FENCING TESTS
  // =========================================================================
  describe("Tab 3: Geo Fencing", () => {
    it("renders office list with Thane seed data and columns", async () => {
      render(
        <MemoryRouter>
          <SetupPage />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole("button", { name: /Geo Fencing/i }));

      await waitFor(() => {
        expect(screen.getByText("Inhyma Thane Office")).toBeDefined();
        expect(screen.getByText(/Lodha Supremus/i)).toBeDefined();
        expect(screen.getByText(/150\s*m/)).toBeDefined();
        expect(screen.getByText(/15\s*assigned/)).toBeDefined();
      });
    });

    it("opens Add Office modal and provides radius selector pills", async () => {
      render(
        <MemoryRouter>
          <SetupPage />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole("button", { name: /Geo Fencing/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /\+ Add Office/i })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: /\+ Add Office/i }));

      await waitFor(() => {
        expect(screen.getByText("Add Office Location")).toBeDefined();
        expect(screen.getByRole("button", { name: "50m" })).toBeDefined();
        expect(screen.getByRole("button", { name: "100m" })).toBeDefined();
        expect(screen.getByRole("button", { name: "150m" })).toBeDefined();
        expect(screen.getByRole("button", { name: "200m" })).toBeDefined();
        expect(screen.getByRole("button", { name: "250m" })).toBeDefined();
        expect(screen.getByRole("button", { name: "500m" })).toBeDefined();
        expect(screen.getByRole("button", { name: "1000m" })).toBeDefined();
      });
    });

    it("triggers soft delete on office location with confirmation", async () => {
      // Mock window.confirm
      vi.spyOn(window, "confirm").mockReturnValue(true);

      render(
        <MemoryRouter>
          <SetupPage />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole("button", { name: /Geo Fencing/i }));

      await waitFor(() => {
        expect(screen.getByText("Inhyma Thane Office")).toBeDefined();
      });

      const deleteBtns = screen.getAllByRole("button", { name: /Delete/i });
      expect(deleteBtns.length).toBeGreaterThan(0);
      fireEvent.click(deleteBtns[0]);

      await waitFor(() => {
        expect(apiModule.apiDelete).toHaveBeenCalledWith("/hrms/setup/locations/loc-thane");
      });
    });
  });
});
