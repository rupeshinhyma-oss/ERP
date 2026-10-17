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
  observe() { }
  unobserve() { }
  disconnect() { }
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
      if (url.includes("/masters/cities/lookup")) {
        const all = [
          { id: "city-ahm-1", name: "Ahmedabad City", district_id: "dist-ahmedabad-1", state_id: "state-gujarat-1" },
          { id: "city-sanand-2", name: "Sanand", district_id: "dist-ahmedabad-1", state_id: "state-gujarat-1" },
          { id: "city-surat-3", name: "Surat City", district_id: "dist-surat-2", state_id: "state-gujarat-1" },
        ];
        const m = url.match(/district_id=([^&]+)/);
        return Promise.resolve({ data: m ? all.filter((c) => c.district_id === m[1]) : all });
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

    // Now District should be enabled, but City still waits for a District
    await waitFor(() => {
      expect(districtTrigger?.textContent).toContain("Select");
      expect(cityTrigger?.textContent).toContain("Select District First");
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

  it("list filter: District unlocks after State, City unlocks after District and shows ONLY that district's cities", async () => {
    const getSpy = api.apiGet as unknown as ReturnType<typeof vi.spyOn>;
    render(
      <BrowserRouter>
        <CompaniesPage />
      </BrowserRouter>
    );
    fireEvent.click(screen.getByTitle("Toggle Filter Options"));

    const district = (await screen.findByTestId("filter-district")) as HTMLSelectElement;
    const city = (await screen.findByTestId("filter-city")) as HTMLSelectElement;
    expect(district.disabled).toBe(true);
    expect(city.disabled).toBe(true);

    // State -> District
    const stateSelect = district.parentElement!.previousElementSibling!.querySelector("select") as HTMLSelectElement;
    await waitFor(() => expect(stateSelect.options.length).toBeGreaterThan(1));
    fireEvent.change(stateSelect, { target: { value: "state-gujarat-1" } });
    await waitFor(() => {
      expect(district.disabled).toBe(false);
      expect(Array.from(district.options).map((o) => o.textContent)).toEqual(
        expect.arrayContaining(["Ahmedabad", "Surat"])
      );
    });
    // City is still locked until a district is chosen
    expect(city.disabled).toBe(true);

    // District -> City (only that district's cities, no "all cities of the state" fallback)
    fireEvent.change(district, { target: { value: "dist-ahmedabad-1" } });
    await waitFor(() => {
      expect(city.disabled).toBe(false);
      const names = Array.from(city.options).map((o) => o.textContent);
      expect(names).toEqual(expect.arrayContaining(["Ahmedabad City", "Sanand"]));
      expect(names).not.toContain("Surat City");
    });

    // The list request filters on the district id
    await waitFor(() => {
      const urls = (getSpy as any).mock.calls.map((c: any[]) => String(c[0]));
      expect(urls.some((u: string) => u.startsWith("/companies") && u.includes("district_id=dist-ahmedabad-1"))).toBe(true);
    });

    // Changing the State clears District and City again
    fireEvent.change(stateSelect, { target: { value: "state-maharashtra-2" } });
    await waitFor(() => {
      expect(district.value).toBe("");
      expect(city.value).toBe("");
      expect(city.disabled).toBe(true);
    });
  });

  it("Quick Add: Save & Exit creates company and closes the drawer", async () => {
    const postSpy = vi.spyOn(api, "apiPost").mockResolvedValue({
      data: {
        id: "new-comp-1",
        company_name: "Quick Test Co",
        tax_id_number: "24AAAAA0000A1Z5",
        state_id: "state-gujarat-1",
        district_id: "dist-ahmedabad-1",
        city_id: "city-ahm-1",
        emails: [],
        contacts: [],
        social_media: [],
        is_active: true,
      },
    });

    render(
      <BrowserRouter>
        <CompaniesPage />
      </BrowserRouter>
    );

    // Open quick add
    fireEvent.click(screen.getByRole("button", { name: /\+ QUICK ADD/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Add Company" })).toBeTruthy());

    // Fill required fields
    const nameInput = document.getElementById("quick_company_name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Quick Test Co" } });

    const gstInput = document.getElementById("quick_tax_id_number") as HTMLInputElement;
    fireEvent.change(gstInput, { target: { value: "24AAAAA0000A1Z5" } });

    // Select State
    const stateTrigger = document.getElementById("quick_state_id");
    fireEvent.click(stateTrigger!);
    await waitFor(() => expect(screen.getByText("Gujarat")).toBeTruthy());
    fireEvent.click(screen.getByText("Gujarat"));

    // Click Save & Exit
    const saveExitBtn = screen.getByRole("button", { name: /Save & Exit/i });
    fireEvent.click(saveExitBtn);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/companies", expect.objectContaining({
        company_name: "Quick Test Co",
        tax_id_number: "24AAAAA0000A1Z5",
        state_id: "state-gujarat-1",
      }));
      // Drawer is closed
      expect(document.querySelector(".side-drawer-backdrop.open")).toBeNull();
    });
  });

  it("Quick Add: Save & Continue creates company and opens Full Add New form with the same data", async () => {
    const postSpy = vi.spyOn(api, "apiPost").mockResolvedValue({
      data: {
        id: "new-comp-2",
        company_name: "Continue Co",
        tax_id_number: "24BBBBB0000B1Z5",
        state_id: "state-gujarat-1",
        district_id: "dist-ahmedabad-1",
        city_id: "city-ahm-1",
        area: "Sanand GIDC",
        contact_salutation: "Mr",
        contact_full_name: "John Doe",
        contact_designation: "Manager",
        contact_calling_number: "9876543210",
        contact_whatsapp_number: "9876543210",
        contact_indiamart_number: "",
        primary_website: "https://example.com",
        sales_person_id: "user-1",
        emails: [],
        contacts: [],
        social_media: [],
        is_active: true,
      },
    });

    render(
      <BrowserRouter>
        <CompaniesPage />
      </BrowserRouter>
    );

    // Open quick add
    fireEvent.click(screen.getByRole("button", { name: /\+ QUICK ADD/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Add Company" })).toBeTruthy());

    // Fill required fields
    const nameInput = document.getElementById("quick_company_name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Continue Co" } });

    const gstInput = document.getElementById("quick_tax_id_number") as HTMLInputElement;
    fireEvent.change(gstInput, { target: { value: "24BBBBB0000B1Z5" } });

    // Select State
    const stateTrigger = document.getElementById("quick_state_id");
    fireEvent.click(stateTrigger!);
    await waitFor(() => expect(screen.getByText("Gujarat")).toBeTruthy());
    fireEvent.click(screen.getByText("Gujarat"));

    // Click Save & Continue
    const saveContinueBtn = screen.getByRole("button", { name: /Save & Continue/i });
    fireEvent.click(saveContinueBtn);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/companies", expect.objectContaining({
        company_name: "Continue Co",
        tax_id_number: "24BBBBB0000B1Z5",
        state_id: "state-gujarat-1",
      }));
      // Quick drawer is closed
      expect(document.querySelector(".side-drawer-backdrop.open")).toBeNull();
      // Full Add New form is open with the same data
      expect(screen.getByRole("heading", { name: "Add New Company" })).toBeTruthy();
      expect(screen.getByText(/Basic info saved from Quick Add/i)).toBeTruthy();
      expect(screen.getByDisplayValue("Continue Co")).toBeTruthy();
      expect(screen.getByDisplayValue("24BBBBB0000B1Z5")).toBeTruthy();
    });
  });
});