import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { LeadsPage } from "../LeadsPage";
import { apiGet } from "@/lib/api";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock toast
vi.mock("@/lib/toast", () => ({
  useToast: () => vi.fn(),
}));

// Mock api
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));

describe("LeadsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/masters/lead-sources")) {
        return Promise.resolve({
          data: [{ id: "1", name: "IndiaMart" }, { id: "2", name: "Website" }],
        });
      }
      if (url.includes("/masters/states")) {
        return Promise.resolve({
          data: [
            { id: "state-gujarat-1", name: "Gujarat" },
            { id: "state-maharashtra-2", name: "Maharashtra" },
          ],
        });
      }
      if (url.includes("/masters/districts")) {
        if (url.includes("state-gujarat-1") || url.includes("Gujarat")) {
          return Promise.resolve({
            data: [
              { id: "dist-ahmedabad-1", name: "Ahmedabad", state_id: "state-gujarat-1" },
              { id: "dist-valsad-2", name: "Valsad", state_id: "state-gujarat-1" },
            ],
          });
        }
        if (url.includes("state-maharashtra-2") || url.includes("Maharashtra")) {
          return Promise.resolve({
            data: [
              { id: "dist-mumbai-3", name: "Mumbai", state_id: "state-maharashtra-2" },
              { id: "dist-pune-4", name: "Pune", state_id: "state-maharashtra-2" },
            ],
          });
        }
      }
      if (url.includes("/masters/cities")) {
        if (url.includes("dist-valsad-2") || url.includes("Valsad")) {
          return Promise.resolve({
            data: [
              { id: "city-vapi-1", name: "Vapi", district_id: "dist-valsad-2" },
              { id: "city-umbergaon-2", name: "Umbergaon", district_id: "dist-valsad-2" },
            ],
          });
        }
        if (url.includes("dist-ahmedabad-1") || url.includes("Ahmedabad")) {
          return Promise.resolve({
            data: [
              { id: "city-ahmedabad-3", name: "Ahmedabad City", district_id: "dist-ahmedabad-1" },
              { id: "city-sanand-4", name: "Sanand", district_id: "dist-ahmedabad-1" },
            ],
          });
        }
      }
      if (url.includes("/leads")) {
        return Promise.resolve({
          data: {
            items: [],
            total: 0,
          },
        });
      }
      return Promise.resolve({ data: [] });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders exact page title 'Leads' and AppShell with activeKey='leads'", async () => {
    render(
      <BrowserRouter>
        <LeadsPage />
      </BrowserRouter>
    );

    expect(screen.getByRole("heading", { name: "Leads" })).toBeTruthy();
    expect(screen.getByTestId("app-shell").getAttribute("data-active-key")).toBe("leads");
  });

  it("renders all 3 top action buttons matching screenshot: Filter, + ADD NEW, and DELETE", async () => {
    render(
      <BrowserRouter>
        <LeadsPage />
      </BrowserRouter>
    );

    expect(document.getElementById("btn-filter-leads")).toBeTruthy();
    expect(screen.getByRole("button", { name: /\+ ADD NEW/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /DELETE/i })).toBeTruthy();
  });

  it("renders all 10 filter fields matching reference screenshot", async () => {
    render(
      <BrowserRouter>
        <LeadsPage />
      </BrowserRouter>
    );

    // Open filter panel by clicking filter toggle button (collapsed by default)
    fireEvent.click(document.getElementById("btn-filter-leads")!);

    // Row 1
    expect(screen.getByText("Lead Date Range")).toBeTruthy();
    expect(screen.getByText("Lead Created By")).toBeTruthy();
    expect(screen.getAllByText("Business Type").length).toBeGreaterThanOrEqual(2);

    // Row 2
    expect(screen.getByText("State")).toBeTruthy();
    expect(screen.getByText("District")).toBeTruthy();
    expect(screen.getByText("City")).toBeTruthy();

    // Row 3
    expect(screen.getByText("Lead Source")).toBeTruthy();
    expect(screen.getAllByText("Priority").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Lead Allotted To")).toBeTruthy();

    // Row 4
    expect(screen.getByText("Lead Status")).toBeTruthy();
    expect(document.getElementById("btn-filter-reset")).toBeTruthy();
    expect(document.getElementById("btn-filter-search")).toBeTruthy();
  });

  it("renders Items/Page selector defaulting to 50 and Search... input box", async () => {
    render(
      <BrowserRouter>
        <LeadsPage />
      </BrowserRouter>
    );

    const itemsPerPage = document.getElementById("leads-items-per-page") as HTMLSelectElement;
    expect(itemsPerPage).toBeTruthy();
    expect(itemsPerPage.value).toBe("50");
    expect(screen.getByText("Items/Page")).toBeTruthy();

    const searchInput = screen.getByPlaceholderText("Search...");
    expect(searchInput).toBeTruthy();
  });

  it("renders all 13 table column headers matching reference screenshot", async () => {
    render(
      <BrowserRouter>
        <LeadsPage />
      </BrowserRouter>
    );

    expect(document.getElementById("select-all-leads")).toBeTruthy();
    expect(screen.getByText("Sr. No.")).toBeTruthy();
    expect(screen.getByText("Company Name")).toBeTruthy();
    expect(screen.getAllByText("Business Type").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Source")).toBeTruthy();
    expect(screen.getByText("Contact Person")).toBeTruthy();
    expect(screen.getAllByText("Priority").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Area/City")).toBeTruthy();
    expect(screen.getByText("District / State")).toBeTruthy();
    expect(screen.getByText("Requirements")).toBeTruthy();
    expect(screen.getAllByText(/Allotted To/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Added On")).toBeTruthy();
    expect(screen.getByText("Action")).toBeTruthy();
  });

  it("displays 'No Data Available In Table' when empty matching screenshot", async () => {
    render(
      <BrowserRouter>
        <LeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("No Data Available In Table")).toBeTruthy();
    });

    expect(screen.getByText("Showing 0 To 0 Of 0 Entries")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
  });

  it("renders shimmer skeleton loader rows in the table during data loading", () => {
    // Keep loading promise unresolved to verify skeleton rows
    (apiGet as any).mockImplementation(() => new Promise(() => {}));

    render(
      <BrowserRouter>
        <LeadsPage />
      </BrowserRouter>
    );

    const skeletonLines = document.querySelectorAll(".skeleton-line");
    expect(skeletonLines.length).toBeGreaterThan(0);
    const skeletonBadges = document.querySelectorAll(".skeleton-badge");
    expect(skeletonBadges.length).toBeGreaterThan(0);
  });

  it("opens 'Add Lead' drawer with all fields matching screenshot on clicking '+ ADD NEW' button", async () => {
    render(
      <BrowserRouter>
        <LeadsPage />
      </BrowserRouter>
    );

    const addBtn = screen.getByRole("button", { name: /\+ ADD NEW/i });
    fireEvent.click(addBtn);

    // 1. Header
    expect(screen.getByRole("heading", { name: "Add Lead" })).toBeTruthy();

    // 2. Lead Source *
    expect(screen.getByText(/Lead Source/i)).toBeTruthy();
    expect(document.getElementById("lead-source-select")).toBeTruthy();

    // 3. Company Name * and Add Company link
    expect(screen.getAllByText(/Company Name/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Add Company")).toBeTruthy();
    expect(screen.getByPlaceholderText("Search Company Name")).toBeTruthy();

    // 4. Address
    expect(screen.getByText("Address")).toBeTruthy();
    expect(document.getElementById("lead-address-input")).toBeTruthy();

    // 5. Area and State *
    expect(screen.getByText("Area")).toBeTruthy();
    expect(document.getElementById("lead-area-input")).toBeTruthy();
    expect(screen.getAllByText(/State/i).length).toBeGreaterThanOrEqual(1);
    expect(document.getElementById("lead-state-select")).toBeTruthy();

    // 6. District and City
    expect(screen.getAllByText(/District/i).length).toBeGreaterThanOrEqual(1);
    expect(document.getElementById("lead-district-select")).toBeTruthy();
    expect(screen.getAllByText(/City/i).length).toBeGreaterThanOrEqual(1);
    expect(document.getElementById("lead-city-select")).toBeTruthy();

    // 7. Contact Person, Designation, Priority (A, B, C radios)
    expect(screen.getByPlaceholderText("Contact Person")).toBeTruthy();
    expect(screen.getByText("Designation")).toBeTruthy();
    expect(document.getElementById("lead-designation-input")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "A" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "B" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "C" })).toBeTruthy();

    // 8. Contact Number and Email
    expect(screen.getByText("Contact Number")).toBeTruthy();
    expect(document.getElementById("lead-contact-phone-input")).toBeTruthy();
    expect(screen.getByText("Email")).toBeTruthy();
    expect(document.getElementById("lead-contact-email-input")).toBeTruthy();

    // 9. Clients Requirements
    expect(screen.getByText("Clients Requirements")).toBeTruthy();
    expect(document.getElementById("lead-requirements-input")).toBeTruthy();

    // 10. Submit Button
    expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
  });

  it("toggles collapsible filter panel on clicking filter button (collapsed by default)", async () => {
    render(
      <BrowserRouter>
        <LeadsPage />
      </BrowserRouter>
    );

    const filterBtn = document.getElementById("btn-filter-leads")!;
    // Filter panel is off by default
    expect(document.getElementById("leads-filter-card")).toBeNull();

    // Clicking filter button opens panel
    fireEvent.click(filterBtn);
    expect(document.getElementById("leads-filter-card")).toBeTruthy();

    // Clicking filter button again closes panel
    fireEvent.click(filterBtn);
    expect(document.getElementById("leads-filter-card")).toBeNull();
  });

  it("extracts unique filter options dynamically from the leads list and filters correctly", async () => {
    (apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/leads")) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "lead-1",
                company_name: "Apex Valves & Automation",
                business_type: "Manufacturer",
                source: "IndiaMart",
                contact_person: "Rajesh Sharma",
                contact_phone: "9876543210",
                priority: "High",
                area: "GIDC",
                city: "Vapi",
                district: "Valsad",
                state: "Gujarat",
                requirements: "Boiler Automation Valves",
                allotted_to: "Rupesh Malla",
                created_by: "Admin User",
                lead_status: "New",
                added_on: "2026-09-29",
              },
              {
                id: "lead-2",
                company_name: "Zenith Packaging",
                business_type: "Trader",
                source: "Website",
                contact_person: "Amit Patel",
                contact_phone: "9876543211",
                priority: "Medium",
                area: "MIDC",
                city: "Pune",
                district: "Pune",
                state: "Maharashtra",
                requirements: "Stretch Wrapping Machine",
                allotted_to: "Dhairya Shah",
                created_by: "Sales Executive",
                lead_status: "Contacted",
                added_on: "2026-09-28",
              },
            ],
            total: 2,
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <BrowserRouter>
        <LeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Apex Valves & Automation")).toBeTruthy();
      expect(screen.getByText("Zenith Packaging")).toBeTruthy();
    });

    // Open filter panel by clicking filter toggle button
    fireEvent.click(document.getElementById("btn-filter-leads")!);

    // Verify dynamic extraction in "Lead Created By" dropdown
    const createdBySelect = document.getElementById("filter-lead-created-by") as HTMLSelectElement;
    expect(createdBySelect).toBeTruthy();
    const createdByOptions = Array.from(createdBySelect.options).map((o) => o.text);
    expect(createdByOptions).toContain("Admin User");
    expect(createdByOptions).toContain("Sales Executive");

    // Verify dynamic extraction in "State" dropdown
    const stateSelect = document.getElementById("filter-state") as HTMLSelectElement;
    expect(stateSelect).toBeTruthy();
    const stateOptions = Array.from(stateSelect.options).map((o) => o.text);
    expect(stateOptions).toContain("Gujarat");
    expect(stateOptions).toContain("Maharashtra");

    // Filter by State = Gujarat
    fireEvent.change(stateSelect, { target: { value: "Gujarat" } });

    // Table now filters reactively based on data
    await waitFor(() => {
      expect(screen.getByText("Apex Valves & Automation")).toBeTruthy();
    });
    expect(screen.queryByText("Zenith Packaging")).toBeNull();

    // Click Reset to clear filters
    const resetBtn = document.getElementById("btn-filter-reset")!;
    fireEvent.click(resetBtn);

    // Both leads restored
    await waitFor(() => {
      expect(screen.getByText("Apex Valves & Automation")).toBeTruthy();
      expect(screen.getByText("Zenith Packaging")).toBeTruthy();
    });
  });

  it("sorts table records ascending and descending when clicking column headers", async () => {
    const mockLeadsData = [
      {
        id: "lead-1",
        company_name: "Zenith Packaging",
        business_type: "Manufacturer",
        source: "IndiaMart",
        contact_person: "Rajesh",
        priority: "Low",
        city: "Mumbai",
        state: "Maharashtra",
        requirements: "Corrugated boxes",
        allotted_to: "Sales Team B",
        lead_status: "New",
      },
      {
        id: "lead-2",
        company_name: "Apex Valves & Automation",
        business_type: "Retail",
        source: "Website",
        contact_person: "Amit",
        priority: "Urgent",
        city: "Ahmedabad",
        state: "Gujarat",
        requirements: "Industrial valves",
        allotted_to: "Sales Team A",
        lead_status: "Qualified",
      },
    ];

    (apiGet as any).mockImplementation((url: string) => {
      if (url.includes("/leads")) {
        return Promise.resolve({
          data: {
            items: mockLeadsData,
            total: 2,
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <BrowserRouter>
        <LeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Zenith Packaging")).toBeTruthy();
      expect(screen.getByText("Apex Valves & Automation")).toBeTruthy();
    });

    // Click "Company Name" column header to sort Ascending
    const companyHeader = screen.getByText("Company Name");
    fireEvent.click(companyHeader);

    // Verify Apex Valves comes first in table rows
    const rowsAsc = document.querySelectorAll("#leads-table tbody tr");
    expect(rowsAsc[0]?.textContent).toContain("Apex Valves & Automation");
    expect(rowsAsc[1]?.textContent).toContain("Zenith Packaging");

    // Click "Company Name" again to sort Descending
    fireEvent.click(companyHeader);

    const rowsDesc = document.querySelectorAll("#leads-table tbody tr");
    expect(rowsDesc[0]?.textContent).toContain("Zenith Packaging");
    expect(rowsDesc[1]?.textContent).toContain("Apex Valves & Automation");
  });

  it("allows typing and dropdown selection in the Lead Source combobox in Add Lead drawer", async () => {
    render(
      <BrowserRouter>
        <LeadsPage />
      </BrowserRouter>
    );

    const addBtn = screen.getByRole("button", { name: /\+ ADD NEW/i });
    fireEvent.click(addBtn);

    const sourceInput = document.getElementById("lead-source-select") as HTMLInputElement;
    expect(sourceInput).toBeTruthy();
    expect(sourceInput.placeholder).toBe("Select");

    // Toggle button exists to open dropdown
    const toggleBtn = document.getElementById("lead-source-select-toggle");
    expect(toggleBtn).toBeTruthy();
    fireEvent.click(toggleBtn!);

    // Can click an option from the dropdown
    const indiamartOption = screen.getByText("IndiaMart");
    expect(indiamartOption).toBeTruthy();
    fireEvent.click(indiamartOption);

    // Selected value is updated
    expect(sourceInput.value).toBe("IndiaMart");

    // Can also freely type custom lead source
    fireEvent.change(sourceInput, { target: { value: "Direct Referral" } });
    expect(sourceInput.value).toBe("Direct Referral");
  });

  it("cascades Master State -> District -> City in the Add Lead drawer using typable comboboxes", async () => {
    render(
      <BrowserRouter>
        <LeadsPage />
      </BrowserRouter>
    );

    const addBtn = screen.getByRole("button", { name: /\+ ADD NEW/i });
    fireEvent.click(addBtn);

    const stateInput = document.getElementById("lead-state-select") as HTMLInputElement;
    const districtInput = document.getElementById("lead-district-select") as HTMLInputElement;
    const cityInput = document.getElementById("lead-city-select") as HTMLInputElement;

    expect(stateInput).toBeTruthy();
    expect(districtInput).toBeTruthy();
    expect(cityInput).toBeTruthy();

    // District and City should initially be disabled
    expect(districtInput.disabled).toBe(true);
    expect(districtInput.placeholder).toContain("Select State First");
    expect(cityInput.disabled).toBe(true);
    expect(cityInput.placeholder).toContain("Select District First");

    // Select State: Gujarat
    const stateToggle = document.getElementById("lead-state-select-toggle");
    fireEvent.click(stateToggle!);
    await waitFor(() => {
      expect(screen.getByText("Gujarat")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Gujarat"));

    // District is now enabled
    await waitFor(() => {
      expect(districtInput.disabled).toBe(false);
    });

    // Open District dropdown
    const districtToggle = document.getElementById("lead-district-select-toggle");
    fireEvent.click(districtToggle!);
    await waitFor(() => {
      expect(screen.getByText("Ahmedabad")).toBeTruthy();
      expect(screen.getByText("Valsad")).toBeTruthy();
      // Mumbai should NOT be present under Gujarat
      expect(screen.queryByText("Mumbai")).toBeNull();
    });
    fireEvent.click(screen.getByText("Valsad"));

    // City is now enabled
    await waitFor(() => {
      expect(cityInput.disabled).toBe(false);
    });

    // Open City dropdown
    const cityToggle = document.getElementById("lead-city-select-toggle");
    fireEvent.click(cityToggle!);
    await waitFor(() => {
      expect(screen.getByText("Vapi")).toBeTruthy();
      expect(screen.getByText("Umbergaon")).toBeTruthy();
      // Sanand should NOT be present under Valsad
      expect(screen.queryByText("Sanand")).toBeNull();
    });
    fireEvent.click(screen.getByText("Vapi"));
    expect(cityInput.value).toBe("Vapi");

    // Changing State resets District and City
    fireEvent.click(stateToggle!);
    await waitFor(() => {
      expect(screen.getByText("Maharashtra")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Maharashtra"));

    expect(districtInput.value).toBe("");
    expect(cityInput.value).toBe("");
    expect(cityInput.disabled).toBe(true);
  });
});


