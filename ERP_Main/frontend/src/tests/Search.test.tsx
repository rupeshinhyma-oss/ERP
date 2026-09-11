import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Search } from "../pages/Search";
import { Auth } from "../lib/auth";
import { GlobalSessionProvider } from "../lib/session";
import { ToastProvider } from "../lib/toast";
import * as apiModule from "../lib/api";

describe("Search Page", () => {
  const mockErps = [
    {
      id: "erp-uuid-1",
      key: "yinglima",
      display_name: "Yinglima ERP",
      status: "ACTIVE",
      base_url: "http://localhost:8001",
    },
    {
      id: "erp-uuid-2",
      key: "inhyma",
      display_name: "Inhyma ERP",
      status: "ACTIVE",
      base_url: "http://localhost:8002",
    },
  ];

  const mockSearchResults = {
    results: [
      {
        id: "proj-1",
        source_erp_id: "erp-uuid-1",
        source_entity_type: "buyer",
        source_entity_id: "loc-buyer-101",
        company_name: "Acme Industrial Supplies",
        status: "ACTIVE",
        synced_at: "2026-09-08T10:00:00Z",
      },
      {
        id: "proj-2",
        source_erp_id: "erp-uuid-2",
        source_entity_type: "buyer",
        source_entity_id: "loc-buyer-202",
        company_name: "Horizon Global Logistics",
        status: "ACTIVE",
        synced_at: "2026-09-08T09:45:00Z",
      },
    ],
    total: 2,
    limit: 20,
    offset: 0,
    data_as_of: "2026-09-08T10:00:00Z",
  };

  const mockBuyerDetail = {
    id: "proj-1",
    source_erp_id: "erp-uuid-1",
    source_entity_type: "buyer",
    source_entity_id: "loc-buyer-101",
    company_name: "Acme Industrial Supplies",
    status: "ACTIVE",
    synced_at: "2026-09-08T10:00:00Z",
    last_event_id: "evt-uuid-9999-8888",
    last_event_occurred_at: "2026-09-08T09:59:00Z",
    created_at: "2026-09-08T09:59:00Z",
    updated_at: "2026-09-08T10:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Auth.setSession(
      "mock-token",
      {
        id: "user-id",
        display_name: "Operator",
        primary_email: "operator@example.com",
        status: "ACTIVE",
      },
      "global_user"
    );

    vi.spyOn(apiModule, "apiGet").mockImplementation(async (url: string) => {
      if (url === "/global/erp-instances") {
        return mockErps;
      }
      if (url.startsWith("/global/search/buyers")) {
        if (url.includes("q=EmptyQuery")) {
          return { results: [], total: 0, limit: 20, offset: 0, data_as_of: "2026-09-08T10:00:00Z" };
        }
        return mockSearchResults;
      }
      if (url.startsWith("/global/projections/buyers/proj-1")) {
        return mockBuyerDetail;
      }
      if (url.startsWith("/auth/sessions/current")) {
        return { is_valid: true };
      }
      return null;
    });
  });

  const renderSearch = (initialRoute = "/search") => {
    return render(
      <MemoryRouter initialEntries={[initialRoute]}>
        <GlobalSessionProvider>
          <ToastProvider>
            <Search />
          </ToastProvider>
        </GlobalSessionProvider>
      </MemoryRouter>
    );
  };

  it("renders search bar and default projection results", async () => {
    renderSearch();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Federated Platform Search/i })).toBeDefined();
      expect(screen.getByPlaceholderText(/Search cross-ERP projections/i)).toBeDefined();
      expect(screen.getByText("Acme Industrial Supplies")).toBeDefined();
      expect(screen.getByText("Horizon Global Logistics")).toBeDefined();
    });
  });

  it("renders entity type filter with disabled planned entities", async () => {
    renderSearch();

    await waitFor(() => {
      expect(screen.getByText("Buyers (Supported)")).toBeDefined();
      expect(screen.getByText("Suppliers (Not Yet Supported)")).toBeDefined();
    });
  });

  it("opens projection detail inspection drawer and displays metadata", async () => {
    renderSearch();

    await waitFor(() => {
      expect(screen.getByText("Acme Industrial Supplies")).toBeDefined();
    });

    const inspectButtons = screen.getAllByRole("button", { name: /^Inspect$/i });
    fireEvent.click(inspectButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Projection Record Inspection")).toBeDefined();
      expect(screen.getByText("GLOBAL PROJECTION ID")).toBeDefined();
      expect(screen.getByText("proj-1")).toBeDefined();
      expect(screen.getAllByText(/loc-buyer-101/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("evt-uuid-9999-8888")).toBeDefined();
    });
  });

  it("renders safe deep-linking button as disabled with honest explanation", async () => {
    renderSearch();

    await waitFor(() => {
      expect(screen.getByText("Acme Industrial Supplies")).toBeDefined();
    });

    const openButtons = screen.getAllByRole("button", { name: /Open in ERP/i });
    expect((openButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect(openButtons[0].getAttribute("title")).toBe(
      "Deep linking to local buyer record in source ERP is not yet configured"
    );
  });

  it("displays empty state when search returns zero results", async () => {
    renderSearch("/search?q=EmptyQuery");

    await waitFor(() => {
      expect(screen.getByText("No Projections Found")).toBeDefined();
    });
  });
});
