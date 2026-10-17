import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GeneralReportsPage } from "../GeneralReportsPage";
import * as technicalTasksApi from "@/lib/technicalTasksApi";

// Mock AppShell to render children simply
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

describe("GeneralReportsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const sampleLogs = [
    {
      id: "log-1",
      task_id: "task-1",
      call_date: "2026-10-15",
      call_type: "Physical Visit",
      remarks: "Inspected nozzle alignment and verified seal integrity.",
      created_by: "Technician John",
      created_at: "2026-10-15T10:00:00Z",
      company_name: "ALPHA PACKAGING",
      city: "Ahmedabad",
      machine_model: "AP-500 Sealer",
      contact_person_name: "Mr. Patel",
      contact_phone: "9876543210",
      task_status: "Approved",
      task_allotted_to: "Technician John",
    },
    {
      id: "log-2",
      task_id: "task-2",
      call_date: "2026-10-14",
      call_type: "Payment Collected",
      remarks: "Received payment via Company Acc.",
      created_by: "Technician Mary",
      created_at: "2026-10-14T11:00:00Z",
      company_name: "BETA ENTERPRISES",
      city: "Mumbai",
      machine_model: "BT-200 Strapping",
      contact_person_name: "Ms. Sharma",
      contact_phone: "9123456780",
      task_status: "Completed",
      task_allotted_to: "Technician Mary",
    },
  ];

  const sampleSummary = {
    months: [
      { month: "2026-08", created: 8, completed: 6 },
      { month: "2026-09", created: 12, completed: 10 },
      { month: "2026-10", created: 15, completed: 14 },
    ],
    open_now: 9,
    closed_now: 45,
  };

  it("renders General Reports header and default Call Logs tab", async () => {
    vi.spyOn(technicalTasksApi, "fetchCallLogReport").mockResolvedValue({
      data: sampleLogs as any,
      meta: { total: 2, page: 1, page_size: 50, total_pages: 1 } as any,
    });

    render(
      <MemoryRouter initialEntries={["/reports/general"]}>
        <GeneralReportsPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "General Reports" })).toBeTruthy();
    expect(screen.getByTestId("tab-call-logs")).toBeTruthy();
    expect(screen.getByTestId("tab-monthly-summary")).toBeTruthy();
    expect(screen.getByTestId("section-call-logs")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("ALPHA PACKAGING")).toBeTruthy();
      expect(screen.getByText("BETA ENTERPRISES")).toBeTruthy();
    });
  });

  it("filters call logs by date range and search", async () => {
    const fetchSpy = vi.spyOn(technicalTasksApi, "fetchCallLogReport").mockResolvedValue({
      data: sampleLogs as any,
      meta: { total: 2, page: 1, page_size: 50, total_pages: 1 } as any,
    });

    render(
      <MemoryRouter initialEntries={["/reports/general?tab=call-logs"]}>
        <GeneralReportsPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText("Call date from"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Call date to"), { target: { value: "2026-10-15" } });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          date_from: "2026-10-01",
          date_to: "2026-10-15",
        })
      );
    });
  });

  it("switches to Monthly Summary tab and loads open vs closed analytics", async () => {
    vi.spyOn(technicalTasksApi, "fetchCallLogReport").mockResolvedValue({
      data: [] as any,
      meta: { total: 0 } as any,
    });
    const summarySpy = vi.spyOn(technicalTasksApi, "fetchMonthlySummary").mockResolvedValue(sampleSummary);

    render(
      <MemoryRouter initialEntries={["/reports/general"]}>
        <GeneralReportsPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("tab-monthly-summary"));

    await waitFor(() => {
      expect(screen.getByTestId("section-monthly-summary")).toBeTruthy();
      expect(summarySpy).toHaveBeenCalledWith(12);
      expect(screen.getByText("9")).toBeTruthy(); // open_now
      expect(screen.getByText("45")).toBeTruthy(); // closed_now
      expect(screen.getByText("35")).toBeTruthy(); // total raised in period (8 + 12 + 15)
      expect(screen.getByText("30")).toBeTruthy(); // total completed in period (6 + 10 + 14)
    });
  });

  it("opens Monthly Summary directly when tab param is provided", async () => {
    const summarySpy = vi.spyOn(technicalTasksApi, "fetchMonthlySummary").mockResolvedValue(sampleSummary);

    render(
      <MemoryRouter initialEntries={["/reports/general?tab=monthly-summary"]}>
        <GeneralReportsPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId("section-monthly-summary")).toBeTruthy();
    await waitFor(() => {
      expect(summarySpy).toHaveBeenCalledWith(12);
      expect(screen.getByText("Detailed Month-by-Month Breakdown")).toBeTruthy();
    });
  });
});
