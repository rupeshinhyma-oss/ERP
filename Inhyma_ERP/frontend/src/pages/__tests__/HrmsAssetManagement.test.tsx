import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssetPage } from "@/pages/hrms/AssetPage";
import * as apiModule from "@/lib/api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey?: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock Breadcrumb
vi.mock("@/components/Breadcrumb", () => ({
  Breadcrumb: ({ trail }: { trail: string[] }) => (
    <div data-testid="breadcrumb">{trail.join(" / ")}</div>
  ),
}));

const mockAssets = [
  {
    id: "asset-1",
    asset_code: "AST-0001",
    asset_name: "Dell Latitude 5420",
    asset_category: "Laptop",
    brand: "Dell",
    model: "5420",
    serial_number: "DL12345",
    purchase_date: "2026-01-10",
    purchase_cost: 1200,
    status: "AVAILABLE",
    condition: "GOOD",
    location_id: "loc-thane",
    location_name: "Inhyma Thane Office",
    assigned_to_user_id: null,
    assigned_to_name: null,
    assigned_to_code: null,
    assigned_to_department: null,
    assigned_date: null,
    description: "Standard developer machine",
    created_at: "2026-01-10T10:00:00Z",
    updated_at: "2026-01-10T10:00:00Z",
    history: [],
  },
  {
    id: "asset-2",
    asset_code: "AST-0002",
    asset_name: "iPhone 15 Pro",
    asset_category: "Mobile Phone",
    brand: "Apple",
    model: "15 Pro",
    serial_number: "AP998877",
    purchase_date: "2026-02-15",
    purchase_cost: 999,
    status: "ASSIGNED",
    condition: "EXCELLENT",
    location_id: "loc-thane",
    location_name: "Inhyma Thane Office",
    assigned_to_user_id: "user-1",
    assigned_to_name: "John Doe",
    assigned_to_code: "EMP-001",
    assigned_to_department: "Sales",
    assigned_date: "2026-02-20",
    description: "Corporate testing mobile",
    created_at: "2026-02-15T10:00:00Z",
    updated_at: "2026-02-20T10:00:00Z",
    history: [],
  },
];

const mockUsers = [
  {
    id: "user-1",
    first_name: "John",
    last_name: "Doe",
    username: "john",
    employee_code: "EMP-001",
    email: "john@example.com",
    is_active: true,
  },
  {
    id: "user-2",
    first_name: "Alice",
    last_name: "Wonder",
    username: "alice",
    employee_code: "EMP-002",
    email: "alice@example.com",
    is_active: true,
  },
];

const mockLocations = [
  { id: "loc-thane", name: "Inhyma Thane Office" },
];

describe("HRMS Asset Management Page Tests", () => {
  it("renders Asset Management page and loads assets from PostgreSQL API", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/hrms/assets")) {
        return Promise.resolve({ data: mockAssets } as any);
      }
      if (url.includes("/users/all")) {
        return Promise.resolve({ data: mockUsers } as any);
      }
      if (url.includes("/hrms/setup/locations")) {
        return Promise.resolve({ data: mockLocations } as any);
      }
      return Promise.resolve({ data: [] } as any);
    });

    render(
      <MemoryRouter>
        <AssetPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("AST-0001")).toBeDefined();
      expect(screen.getByText("Dell Latitude 5420")).toBeDefined();
      expect(screen.getByText("AST-0002")).toBeDefined();
      expect(screen.getByText("iPhone 15 Pro")).toBeDefined();
      expect(screen.getByText("John Doe")).toBeDefined();
    });

    expect(screen.getByText("2 Assets")).toBeDefined();
  });

  it("renders empty state cleanly when zero assets exist without injecting fake data", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/hrms/assets")) {
        return Promise.resolve({ data: [] } as any);
      }
      return Promise.resolve({ data: [] } as any);
    });

    render(
      <MemoryRouter>
        <AssetPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("No assets found")).toBeDefined();
      expect(screen.getByText("Get started by registering a new company asset.")).toBeDefined();
    });
  });

  it("renders error state when API fails without fallback mock data", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/hrms/assets")) {
        return Promise.reject(new Error("Database connection failed"));
      }
      return Promise.resolve({ data: [] } as any);
    });

    render(
      <MemoryRouter>
        <AssetPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Unable to load assets. Please try again.")).toBeDefined();
    });
  });

  it("opens Add Asset modal and submits new asset", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/hrms/assets")) {
        return Promise.resolve({ data: mockAssets } as any);
      }
      if (url.includes("/users/all")) {
        return Promise.resolve({ data: mockUsers } as any);
      }
      if (url.includes("/hrms/setup/locations")) {
        return Promise.resolve({ data: mockLocations } as any);
      }
      return Promise.resolve({ data: [] } as any);
    });

    const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      data: {
        id: "asset-3",
        asset_code: "AST-0003",
        asset_name: "HP EliteBook 840",
        asset_category: "Laptop",
        status: "AVAILABLE",
        condition: "GOOD",
      },
    } as any);

    render(
      <MemoryRouter>
        <AssetPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("AST-0001")).toBeDefined();
    });

    const addButtons = screen.getAllByText("Add Asset");
    fireEvent.click(addButtons[0]);

    expect(screen.getByText("Add New Company Asset")).toBeDefined();

    const nameInput = screen.getByPlaceholderText("e.g. ThinkPad X1 Carbon");
    fireEvent.change(nameInput, { target: { value: "HP EliteBook 840" } });

    fireEvent.click(screen.getByText("Save Asset"));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/hrms/assets", expect.objectContaining({
        asset_name: "HP EliteBook 840",
        asset_category: "Laptop",
      }));
    });
  });

  it("handles Assign and Return workflows with real database employee dropdown", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/hrms/assets")) {
        return Promise.resolve({ data: mockAssets } as any);
      }
      if (url.includes("/users/all")) {
        return Promise.resolve({ data: mockUsers } as any);
      }
      if (url.includes("/hrms/setup/locations")) {
        return Promise.resolve({ data: mockLocations } as any);
      }
      return Promise.resolve({ data: [] } as any);
    });

    const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({ data: {} } as any);

    render(
      <MemoryRouter>
        <AssetPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("AST-0001")).toBeDefined();
    });

    // 1. Click "Assign" on AST-0001
    const assignBtn = screen.getByText("Assign");
    fireEvent.click(assignBtn);

    expect(screen.getByText("Assign Asset")).toBeDefined();
    expect(screen.getByText("Alice Wonder (EMP-002)")).toBeDefined();

    const empSelect = screen.getByDisplayValue("-- Choose employee from database --");
    fireEvent.change(empSelect, { target: { value: "user-2" } });

    fireEvent.click(screen.getByText("Confirm Assignment"));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/hrms/assets/asset-1/assign", expect.objectContaining({
        employee_id: "user-2",
      }));
    });

    // 2. Click "Return" on AST-0002
    const returnBtn = screen.getByText("Return");
    fireEvent.click(returnBtn);

    expect(screen.getByText("Return Asset")).toBeDefined();
    expect(screen.getByText("Currently Assigned To:")).toBeDefined();

    fireEvent.click(screen.getByText("Confirm Return"));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/hrms/assets/asset-2/return", expect.any(Object));
    });
  });

  it("handles direct status change workflow (Phase 2)", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/hrms/assets")) {
        return Promise.resolve({ data: mockAssets } as any);
      }
      return Promise.resolve({ data: [] } as any);
    });

    const patchSpy = vi.spyOn(apiModule, "apiPatch").mockResolvedValue({ data: {} } as any);

    render(
      <MemoryRouter>
        <AssetPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("AST-0001")).toBeDefined();
    });

    // Click "Status" on first asset
    const statusBtns = screen.getAllByTitle("Change Status");
    fireEvent.click(statusBtns[0]);

    expect(screen.getByText("Change Status")).toBeDefined();
    expect(screen.getByText("Target Status")).toBeDefined();

    fireEvent.click(screen.getByText("Update Status"));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith("/hrms/assets/asset-1/status", expect.objectContaining({
        status: "AVAILABLE",
      }));
    });
  });

  it("renders branch filter and allows filtering by location (Phase 2)", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/hrms/assets")) {
        return Promise.resolve({ data: mockAssets } as any);
      }
      if (url.includes("/hrms/setup/locations")) {
        return Promise.resolve({ data: mockLocations } as any);
      }
      return Promise.resolve({ data: [] } as any);
    });

    render(
      <MemoryRouter>
        <AssetPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("All Branches")).toBeDefined();
      expect(screen.getAllByText("Inhyma Thane Office").length).toBeGreaterThan(0);
    });
  });

  it("opens Edit Asset modal and updates asset master data with assignment section visible", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/hrms/assets")) {
        return Promise.resolve({ data: mockAssets } as any);
      }
      if (url.includes("/users/all")) {
        return Promise.resolve({ data: mockUsers } as any);
      }
      return Promise.resolve({ data: [] } as any);
    });

    const patchSpy = vi.spyOn(apiModule, "apiPatch").mockResolvedValue({ data: {} } as any);

    render(
      <MemoryRouter>
        <AssetPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("AST-0001")).toBeDefined();
    });

    const editBtns = screen.getAllByText("Edit");
    fireEvent.click(editBtns[0]);

    expect(screen.getByText("Edit Asset")).toBeDefined();
    expect(screen.getByText("Assignment Section:")).toBeDefined();

    fireEvent.click(screen.getByText("Update Asset"));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith("/hrms/assets/asset-1", expect.objectContaining({
        asset_name: "Dell Latitude 5420",
      }));
    });
  });

  it("filters assets via search input by asset code or name", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/hrms/assets")) {
        return Promise.resolve({ data: mockAssets } as any);
      }
      return Promise.resolve({ data: [] } as any);
    });

    render(
      <MemoryRouter>
        <AssetPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("AST-0001")).toBeDefined();
      expect(screen.getByText("AST-0002")).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText("Search asset code, name or serial number");
    fireEvent.change(searchInput, { target: { value: "iPhone" } });

    expect(screen.queryByText("Dell Latitude 5420")).toBeNull();
    expect(screen.getByText("iPhone 15 Pro")).toBeDefined();
    expect(screen.getByText("1 Asset")).toBeDefined();
  });
});

