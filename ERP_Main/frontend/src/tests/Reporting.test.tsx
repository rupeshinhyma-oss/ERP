import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Reporting } from "../pages/Reporting";
import { Auth } from "../lib/auth";
import { GlobalSessionProvider } from "../lib/session";
import { ToastProvider } from "../lib/toast";
import * as apiModule from "../lib/api";

describe("Reporting Page", () => {
  const mockDefinitions = [
    {
      report_key: "global_buyer_summary",
      name: "Global Buyer Projection Summary",
      description: "Cross-ERP buyer projection catalog synchronized from asynchronous events.",
      entity_type: "buyer",
      supported_formats: ["csv", "xlsx"],
      supported_filters: ["query", "status", "erp_ids"],
      status: "AVAILABLE",
      is_available: true,
    },
    {
      report_key: "global_supplier_summary",
      name: "Global Supplier Summary",
      description: "Cross-ERP supplier catalog (awaiting supplier integration events).",
      entity_type: "supplier",
      supported_formats: ["csv", "xlsx"],
      supported_filters: ["query", "status", "erp_ids"],
      status: "NOT_YET_SUPPORTED",
      is_available: false,
    },
  ];

  const mockBuyers = {
    results: [
      {
        id: "proj-1",
        source_erp_id: "erp-uuid-1",
        source_entity_type: "buyer",
        source_entity_id: "buyer-101",
        company_name: "Apex Global Traders",
        status: "ACTIVE",
        synced_at: "2026-09-08T10:00:00Z",
      },
    ],
    total: 1,
    limit: 20,
    offset: 0,
    data_as_of: "2026-09-08T10:00:00Z",
  };

  const mockExportJobs = [
    {
      id: "job-uuid-1",
      report_type: "global_buyer_summary",
      export_format: "csv",
      status: "PENDING",
      row_count: null,
      error_message: null,
      completed_at: null,
      created_at: "2026-09-08T09:30:00Z",
    },
  ];

  const mockErps = [
    {
      id: "erp-uuid-1",
      key: "yinglima",
      display_name: "Yinglima ERP",
      status: "ACTIVE",
    },
  ];

  const mockReconResult = {
    erp_id: "erp-uuid-1",
    erp_key: "yinglima",
    projection_count: 14,
    outbox_published_count: null,
    status: "UNKNOWN",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Auth.setSession(
      "mock-admin-token",
      {
        id: "admin-id",
        display_name: "Platform Admin",
        email: "admin@erp-main.local",
        role: "PLATFORM_ADMIN",
        is_active: true,
        created_at: new Date().toISOString(),
      },
      "platform_admin"
    );

    vi.spyOn(apiModule, "apiGet").mockImplementation(async (url: string) => {
      if (url === "/global/reports/definitions") {
        return mockDefinitions;
      }
      if (url.startsWith("/global/search/buyers")) {
        return mockBuyers;
      }
      if (url === "/global/reports/export") {
        return mockExportJobs;
      }
      if (url === "/global/erp-instances") {
        return mockErps;
      }
      if (url === "/global/dashboard") {
        return {
          projection_health: [
            {
              projection_type: "global_buyer_projection",
              last_processed_at: "2026-09-08T10:00:00Z",
              events_processed_count: 32,
              error_count: 0,
              lag_seconds: 0.8,
            },
          ],
        };
      }
      if (url.startsWith("/auth/sessions/current")) {
        return { is_valid: true };
      }
      return null;
    });

    vi.spyOn(apiModule, "apiPost").mockImplementation(async (url: string) => {
      if (url === "/global/reports/export") {
        return {
          id: "job-uuid-2",
          report_type: "global_buyer_summary",
          export_format: "xlsx",
          status: "PENDING",
          created_at: new Date().toISOString(),
        };
      }
      if (url.startsWith("/global/reconciliation/erps/")) {
        return mockReconResult;
      }
      return {};
    });
  });

  const renderReporting = (initialTab = "reports") => {
    return render(
      <MemoryRouter initialEntries={[`/reporting?tab=${initialTab}`]}>
        <GlobalSessionProvider>
          <ToastProvider>
            <Reporting />
          </ToastProvider>
        </GlobalSessionProvider>
      </MemoryRouter>
    );
  };

  it("renders Available Reports catalog tab with availability badges", async () => {
    renderReporting("reports");

    await waitFor(() => {
      expect(screen.getByText("Available Reports")).toBeDefined();
      expect(screen.getByText("Global Buyer Projection Summary")).toBeDefined();
      expect(screen.getByText("Global Supplier Summary")).toBeDefined();
      expect(screen.getByText("Available")).toBeDefined();
      expect(screen.getByText("Not Yet Supported")).toBeDefined();
    });
  });

  it("renders Buyer Projections tab and shows projection records", async () => {
    renderReporting("buyers");

    await waitFor(() => {
      expect(screen.getByText("Apex Global Traders")).toBeDefined();
      expect(screen.getByText("buyer-101")).toBeDefined();
    });
  });

  it("renders Export Jobs tab with honest PENDING status and disabled download button", async () => {
    renderReporting("exports");

    await waitFor(() => {
      expect(screen.getByText("GLOBAL BUYER SUMMARY")).toBeDefined();
      expect(screen.getByText("job-uuid-1")).toBeDefined();
      expect(screen.getByText("Pending")).toBeDefined();
      expect(screen.getByText("Awaiting asynchronous export worker fulfillment.")).toBeDefined();
    });

    // Verification of Section 16 requirement: no fake download button
    const downloadBtn = screen.getByRole("button", { name: /Download/i });
    expect((downloadBtn as HTMLButtonElement).disabled).toBe(true);
    expect(downloadBtn.getAttribute("title")).toBe(
      "Export file generation is pending backend execution. No fake download is offered."
    );
  });

  it("renders Projection Health & Reconciliation tab and displays honest UNKNOWN source count", async () => {
    renderReporting("health");

    await waitFor(() => {
      expect(screen.getByText("Projection Checkpoints & Event Stream Lag")).toBeDefined();
      expect(screen.getByText("global_buyer_projection")).toBeDefined();
      expect(screen.getByText("32")).toBeDefined();
      expect(screen.getByText("Yinglima ERP")).toBeDefined();
    });

    const reconBtn = screen.getByRole("button", { name: /Run Reconciliation Pass/i });
    fireEvent.click(reconBtn);

    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith("/global/reconciliation/erps/erp-uuid-1", {});
      expect(screen.getByText("Unknown (Unqueried)")).toBeDefined();
    });
  });

  it("submits a new export request through the modal", async () => {
    renderReporting("reports");

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /^Request Export$/i }).length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.click(screen.getAllByRole("button", { name: /^Request Export$/i })[0]);

    await waitFor(() => {
      expect(screen.getByText("Request Asynchronous Report Export")).toBeDefined();
    });

    const submitBtn = screen.getByRole("button", { name: /Submit Export Request/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith("/global/reports/export", {
        report_type: "global_buyer_summary",
        export_format: "csv",
      });
    });
  });
});
