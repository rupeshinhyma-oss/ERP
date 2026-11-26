import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PaymentsPage } from "../PaymentsPage";
import * as technicalTasksApi from "@/lib/technicalTasksApi";

const authState = vi.hoisted(() => ({ isSuperAdmin: true, username: "admin", perms: [] as string[] }));
vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({
      profile: { username: authState.username },
      isSuperAdmin: authState.isSuperAdmin,
      hasPermission: (code?: string | null) => authState.isSuperAdmin || !code || authState.perms.includes(code),
    }),
  };
});

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
    all_count: 13,
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
      const dueEl = screen.getByTestId("payment-kpi-due");
      expect(dueEl.textContent).toBe("₹ 55,000.00");
      expect(dueEl.style.color).toBe("rgb(220, 38, 38)");
    });
  });

  it("renders All, Pending, and Completed tabs inside the card with counts and switches stage", async () => {
    const fetchSpy = vi.spyOn(technicalTasksApi, "fetchTechnicalTasks");
    render(
      <MemoryRouter>
        <PaymentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /All \(13\)/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Pending \(5\)/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Completed \(8\)/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /All \(13\)/i }));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ payment_collected: "all" }));
    });
  });

  it("renders table row with payment details, dynamic dashes for unassigned fields, and RBAC gating", async () => {
    vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
      data: [{ ...sampleTasks[0], task_approved_by: null, task_allotted_to: null }] as any,
      meta: { total: 1, page: 1, page_size: 10, total_pages: 1 } as any,
    });

    const { unmount } = render(
      <MemoryRouter>
        <PaymentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SUN PHARMA LTD")).toBeTruthy();
      expect(screen.getByText("Vadodara")).toBeTruthy();
      expect(screen.getByText("GF5000F Granular Filler FFS")).toBeTruthy();
      expect(screen.getByText("Chargeable")).toBeTruthy();
      expect(screen.queryByText("ABC")).toBeNull();
      expect(screen.getByText("Paid: ₹15,000")).toBeTruthy();
      expect(screen.getByText("Due: ₹10,000")).toBeTruthy();
    });
    unmount();

    authState.isSuperAdmin = false;
    authState.perms = ["payment.view", "technicaltask.manage"];
    try {
      render(
        <MemoryRouter>
          <PaymentsPage />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /All \(13\)/i })).toBeTruthy();
      });
      expect(screen.queryByRole("button", { name: /\+ ADD NEW/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /DELETE/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /Pending \(5\)/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /Completed \(8\)/i })).toBeNull();
      expect(screen.queryByRole("columnheader", { name: /Action/i })).toBeNull();
      expect(screen.queryByRole("button", { name: "⋮" })).toBeNull();
    } finally {
      authState.isSuperAdmin = true;
      authState.perms = [];
    }
  });

  it("enforces granular tab, Action column, View Details, and Record Payment permissions", async () => {
    const fetchSpy = vi.spyOn(technicalTasksApi, "fetchTechnicalTasks");
    authState.isSuperAdmin = false;
    authState.perms = ["payment.view", "payment.pending.view", "payment.action.view", "payment.details.view"];
    try {
      const { unmount } = render(
        <MemoryRouter>
          <PaymentsPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ payment_collected: "pending" }));
      });
      expect(screen.getByRole("button", { name: /All \(13\)/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Pending \(5\)/i })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Completed \(8\)/i })).toBeNull();
      expect(screen.getByRole("columnheader", { name: /Action/i })).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "⋮" }));
      expect(screen.queryByRole("button", { name: /Record Payment/i })).toBeNull();
      const viewDetailsBtn = screen.getByRole("button", { name: /View Details/i });
      fireEvent.click(viewDetailsBtn);

      await waitFor(() => {
        expect(screen.getByText("Payment Details — SUN PHARMA LTD")).toBeTruthy();
      });
      expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Record Payment" })).toBeNull();
      unmount();

      authState.perms = ["payment.view", "payment.completed.view", "payment.action.view", "payment.update"];
      render(
        <MemoryRouter>
          <PaymentsPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ payment_collected: "completed" }));
      });
      expect(screen.queryByRole("button", { name: /Pending \(5\)/i })).toBeNull();
      expect(screen.getByRole("button", { name: /Completed \(8\)/i })).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "⋮" }));
      expect(screen.getByRole("button", { name: /Record Payment/i })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /View Details/i })).toBeNull();
    } finally {
      authState.isSuperAdmin = true;
      authState.perms = [];
    }
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

  it("opens Payment Details modal with padded body, detail grid, and footer when company link is clicked", async () => {
    const { container } = render(
      <MemoryRouter>
        <PaymentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SUN PHARMA LTD")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("SUN PHARMA LTD"));

    await waitFor(() => {
      expect(screen.getByText("Payment Details — SUN PHARMA LTD")).toBeTruthy();
    });

    expect(container.querySelector(".payment-modal-container .payment-modal-body")).toBeTruthy();
    expect(container.querySelector(".payment-detail-grid")).toBeTruthy();
    expect(container.querySelector(".modal-footer.payment-modal-footer")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record Payment" })).toBeTruthy();
  });

  it("opens Record Payment modal with custom file upload dropzone, supports uploading and removing receipt", async () => {
    const uploadSpy = vi.spyOn(technicalTasksApi, "uploadPaymentScreenshot").mockResolvedValue({
      file_url: "https://example.com/receipt-123.png",
      file_name: "receipt-123.png",
    });
    vi.spyOn(technicalTasksApi, "recordTechnicalTaskPayment").mockResolvedValue({} as any);

    render(
      <MemoryRouter>
        <PaymentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SUN PHARMA LTD")).toBeTruthy();
    });

    // Open Action menu and click Record Payment
    const actionBtn = screen.getByRole("button", { name: "⋮" });
    fireEvent.click(actionBtn);

    const recordOption = screen.getByRole("button", { name: /Record Payment/i });
    fireEvent.click(recordOption);

    // Modal opens
    await waitFor(() => {
      expect(screen.getByText("Record Payment — SUN PHARMA LTD")).toBeTruthy();
    });

    // Verify custom upload dropzone is rendered
    expect(screen.getByText(/Choose file/i)).toBeTruthy();
    expect(screen.getByText(/or drag & drop receipt here/i)).toBeTruthy();
    expect(screen.getByText(/Supports PNG, JPG, JPEG, WEBP or PDF \(max 10MB\)/i)).toBeTruthy();

    // Verify hidden file input is present
    const fileInput = screen.getByTestId("payment-screenshot-input") as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    expect(fileInput.style.display).toBe("none");

    // Upload a receipt file
    const file = new File(["dummy content"], "receipt-123.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadSpy).toHaveBeenCalledWith(file);
      expect(screen.getByText("receipt-123.png")).toBeTruthy();
      expect(screen.getByText(/Receipt attached/i)).toBeTruthy();
      expect(screen.getByRole("button", { name: /Remove/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Change/i })).toBeTruthy();
      expect(screen.getByRole("link", { name: /View/i })).toBeTruthy();
    });

    // Test removing the screenshot
    const removeBtn = screen.getByRole("button", { name: /Remove/i });
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(screen.queryByText("receipt-123.png")).toBeNull();
      expect(screen.getByText(/Choose file/i)).toBeTruthy();
    });
  });
});
