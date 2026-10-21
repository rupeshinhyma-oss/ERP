import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PaymentsPage } from "../PaymentsPage";
import * as technicalTasksApi from "@/lib/technicalTasksApi";

// Mock AppShell to render children simply
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

// Mock apiGet / api helpers
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: [] }),
  errorMessage: (err: unknown) =>
    err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error",
  isAbortError: () => false,
}));

describe("PaymentsPage", () => {
  const sampleSummary = {
    total_payment: 150000,
    paid: 95000,
    due: 55000,
    pending_count: 5,
    completed_count: 8,
  };

  const sampleTasks = [
    {
      id: "pay-task-1",
      company_name: "SUN PHARMA LTD",
      task_type: "Physical Visit",
      city: "Vadodara",
      priority: "A",
      machine_model: "GF5000F Granular Filler FFS",
      contact_person_name: "Anil Sharma",
      contact_phone: "+91 98980 12345",
      task_created_date: "15-10-2026",
      created_by_name: "Inhyma Admin",
      task_approved_by: "Inhyma Admin",
      task_allotted_to: "Devendra Marade",
      service_type: "Chargeable",
      service_charge: 25000,
      collected_amount: 15000,
      payment_status: "Pending",
      status: "Approved",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(technicalTasksApi, "fetchPaymentSummary").mockResolvedValue(sampleSummary);
    vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
      data: sampleTasks as any,
      meta: { total: 1, page: 1, page_size: 10, total_pages: 1 } as any,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders page header, KPI cards, and action buttons properly", async () => {
    render(
      <MemoryRouter>
        <PaymentsPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Payments" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /\+ ADD NEW/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /DELETE/i })).toBeTruthy();
    expect(screen.getByTitle("Toggle Filter Options")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("TOTAL PAYMENT")).toBeTruthy();
      expect(screen.getByText("PAID")).toBeTruthy();
      expect(screen.getByText("DUE")).toBeTruthy();
      expect(screen.getByText("₹ 1,50,000.00")).toBeTruthy();
      expect(screen.getByText("₹ 95,000.00")).toBeTruthy();
      expect(screen.getByText("₹ 55,000.00")).toBeTruthy();
    });
  });

  it("renders Pending and Completed tabs inside the card with counts", async () => {
    render(
      <MemoryRouter>
        <PaymentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Pending \(5\)/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Completed \(8\)/i })).toBeTruthy();
    });
  });

  it("renders table row with payment details and action menu", async () => {
    render(
      <MemoryRouter>
        <PaymentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SUN PHARMA LTD")).toBeTruthy();
      expect(screen.getByText("Vadodara")).toBeTruthy();
      expect(screen.getByText("GF5000F Granular Filler FFS")).toBeTruthy();
      expect(screen.getByText("Chargable")).toBeTruthy();
      expect(screen.getByText("Paid: ₹15,000")).toBeTruthy();
      expect(screen.getByText("Due: ₹10,000")).toBeTruthy();
    });
  });

  it("toggles filter panel and applies deferred filter on Search click, and clears on Reset", async () => {
    const fetchSpy = vi.spyOn(technicalTasksApi, "fetchTechnicalTasks");

    render(
      <MemoryRouter>
        <PaymentsPage />
      </MemoryRouter>
    );

    // Filter panel should be closed initially
    expect(screen.queryByText("Filter Options")).toBeNull();

    // Toggle filter panel open
    fireEvent.click(screen.getByTitle("Toggle Filter Options"));
    expect(screen.getByText("Filter Options")).toBeTruthy();

    // Fill in City filter
    const cityInput = screen.getByPlaceholderText(/Select or type city/i);
    fireEvent.change(cityInput, { target: { value: "Surat" } });

    // Both Reset and Search buttons are present
    const resetBtn = screen.getByRole("button", { name: "Reset" });
    const searchBtn = screen.getByRole("button", { name: "Search" });
    expect(resetBtn).toBeTruthy();
    expect(searchBtn).toBeTruthy();

    // The fetch should not have been called with city yet (deferred filter pattern)
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ city: "Surat" }));

    // Click Search to apply filter
    fireEvent.click(searchBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ city: "Surat" }));
    });

    // Now click Reset
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect((cityInput as HTMLInputElement).value).toBe("");
    });
  });

  it("renders rich empty state when no payment records are returned", async () => {
    vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, page_size: 10, total_pages: 1 } as any,
    });

    render(
      <MemoryRouter>
        <PaymentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("No payment records found")).toBeTruthy();
      expect(screen.getByText(/No pending payments available/i)).toBeTruthy();
    });
  });
});
