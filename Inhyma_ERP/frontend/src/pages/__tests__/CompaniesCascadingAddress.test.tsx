import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompaniesPage } from "../Companies";
import * as api from "@/lib/api";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

// Mock ResizeObserver for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

// Mock auth hook
vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    useAuth: () => ({
      hasPermission: () => true,
      user: { id: "1", username: "admin", role: "admin" },
    }),
    useSrNoJump: () => ({ request: vi.fn(), clear: vi.fn(), applyTo: vi.fn() }),
    isSrNoQuery: () => false,
    usePendingGuard: () => ({ isPending: () => false, guard: (fn: any) => fn }),
    useModalHistorySync: vi.fn(),
  };
});

describe("Companies Cascading Address Selection (State -> District -> City)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(api, "apiGet").mockImplementation((url: string): Promise<any> => {
      if (url.includes("/masters/states")) {
        return Promise.resolve({
          data: [
            { id: "state-gujarat-1", name: "Gujarat" },
            { id: "state-maharashtra-2", name: "Maharashtra" },
          ],
        });
      }
      if (url.includes("/masters/districts/lookup?state_id=state-gujarat-1")) {
        return Promise.resolve({
          data: [
            { id: "dist-ahmedabad-1", name: "Ahmedabad", state_id: "state-gujarat-1" },
            { id: "dist-surat-2", name: "Surat", state_id: "state-gujarat-1" },
          ],
        });
      }
      if (url.includes("/masters/districts/lookup?state_id=state-maharashtra-2")) {
        return Promise.resolve({
          data: [
            { id: "dist-mumbai-3", name: "Mumbai", state_id: "state-maharashtra-2" },
            { id: "dist-pune-4", name: "Pune", state_id: "state-maharashtra-2" },
          ],
        });
      }
      if (url.includes("/masters/cities")) {
        return Promise.resolve({
          data: [
            { id: "city-ahm-1", name: "Ahmedabad City", district_id: "dist-ahmedabad-1", state_id: "state-gujarat-1" },
            { id: "city-sanand-2", name: "Sanand", district_id: "dist-ahmedabad-1", state_id: "state-gujarat-1" },
            { id: "city-surat-3", name: "Surat City", district_id: "dist-surat-2", state_id: "state-gujarat-1" },
          ],
        });
      }
      if (url.includes("/companies/sales-persons")) {
        return Promise.resolve({
          data: [{ id: "user-1", full_name: "Sales Admin", username: "admin" }],
        });
      }
      return Promise.resolve({ data: [] });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("cascades correctly: selecting State unlocks District, and selecting District unlocks City", async () => {
    render(
      <BrowserRouter>
        <CompaniesPage />
      </BrowserRouter>
    );

    // Open Add Company quick drawer
    const quickAddBtn = screen.getByRole("button", { name: /\+ QUICK ADD/i });
    fireEvent.click(quickAddBtn);

    // Wait for drawer to open
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Add Company" })).toBeTruthy();
    });

    // District and City should initially be disabled or indicate state must be selected
    const districtTrigger = document.getElementById("quick_district");
    const cityTrigger = document.getElementById("quick_city_id");
    expect(districtTrigger).toBeTruthy();
    expect(cityTrigger).toBeTruthy();
    expect(districtTrigger?.textContent).toContain("Select");
    expect(cityTrigger?.textContent).toContain("Select");

    // Click State dropdown to open and choose Gujarat
    const stateTrigger = document.getElementById("quick_state_id");
    fireEvent.click(stateTrigger!);

    await waitFor(() => {
      expect(screen.getByText("Gujarat")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Gujarat"));

    // Now District should be enabled
    await waitFor(() => {
      expect(districtTrigger?.textContent).toContain("Select");
      expect(cityTrigger?.textContent).toContain("Select");
    });

    // Open District dropdown and choose Ahmedabad
    fireEvent.click(districtTrigger!);
    await waitFor(() => {
      expect(screen.getByText("Ahmedabad")).toBeTruthy();
      expect(screen.getByText("Surat")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Ahmedabad"));

    // Now City should be enabled and load cities for Ahmedabad
    await waitFor(() => {
      expect(cityTrigger?.textContent).toContain("Select");
    });

    // Open City dropdown
    fireEvent.click(cityTrigger!);
    await waitFor(() => {
      expect(screen.getByText("Ahmedabad City")).toBeTruthy();
      expect(screen.getByText("Sanand")).toBeTruthy();
      // Surat City should NOT be present under Ahmedabad district
      expect(screen.queryByText("Surat City")).toBeNull();
    });

    // Select Sanand
    fireEvent.click(screen.getByText("Sanand"));
    expect(cityTrigger?.textContent).toContain("Sanand");

    // Switching District to Surat should reset City selection
    fireEvent.click(districtTrigger!);
    await waitFor(() => {
      expect(screen.getByText("Surat")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Surat"));

    await waitFor(() => {
      expect(cityTrigger?.textContent).not.toContain("Sanand");
      expect(cityTrigger?.textContent).toContain("Select");
    });

    // Open City dropdown under Surat
    fireEvent.click(cityTrigger!);
    await waitFor(() => {
      expect(screen.getByText("Surat City")).toBeTruthy();
      expect(screen.queryByText("Ahmedabad City")).toBeNull();
    });
  });
});
