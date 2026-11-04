import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TechnicalTasksPage } from "../TechnicalTasksPage";
import * as technicalTasksApi from "@/lib/technicalTasksApi";
import { apiGet } from "@/lib/api";

// Auth state the page reads through useAuth (admin by default; individual tests switch to a normal user).
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

// Mock apiGet for lookups and api helpers
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: [] }),
  apiPost: vi.fn().mockResolvedValue({ data: {} }),
  apiPut: vi.fn().mockResolvedValue({ data: {} }),
  apiPatch: vi.fn().mockResolvedValue({ data: {} }),
  apiDelete: vi.fn().mockResolvedValue({ data: {} }),
  errorMessage: (err: unknown) =>
    err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error",
  isAbortError: () => false,
}));

describe("TechnicalTasksPage", () => {
  const sampleTasks = [
    {
      id: "task-1",
      company_name: "SHREE KHODIYAR ENTERPRISE",
      task_type: "In-House",
      city: "Ahmedabad",
      third_party: null,
      priority: "A",
      machine_model: "XM12.7 Handy Printer Metal Body 12.7mm",
      task_description: "Motherboard repair required",
      contact_person_name: "Rajesh Patel",
      contact_designation: "Manager",
      contact_phone: "+91 98250 11223",
      created_by_name: "Sushant Dhawade",
      task_created_date: "17-09-2026",
      service_type: "Chargeable",
      service_charge: 4500,
      call_type: "Repair",
      task_approved_by: "Sushant Dhawade",
      task_approved_date: "17-09-2026",
      task_allotted_to: "Devendra Marade",
      payment_status: "Pending",
      status: "Approved",
      version: 1,
      created_at: "2026-09-17T05:30:00Z",
      updated_at: "2026-09-17T05:30:00Z",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
      data: sampleTasks as any,
      meta: { total: 1, page: 1, page_size: 50, total_pages: 1 } as any,
    });
    vi.spyOn(technicalTasksApi, "fetchTechnicalTaskCounts").mockResolvedValue({
      all: 1,
      pending: 0,
      approved: 1,
      completed: 0,
      cancel: 0,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders page header and action buttons", async () => {
    render(
      <MemoryRouter>
        <TechnicalTasksPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Technical Task List" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /\+ QUICK ADD/i })).toBeNull();
    expect(screen.getByRole("button", { name: /\+ ADD NEW/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Imp \/ Exp/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bulk Actions/i })).toBeTruthy();
  });

  it("renders tab counts correctly", async () => {
    render(
      <MemoryRouter>
        <TechnicalTasksPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/^All\s*\(\s*1\s*\)$/)).toBeTruthy();
      expect(screen.getByText(/^Pending\s*\(\s*0\s*\)$/)).toBeTruthy();
      expect(screen.getByText(/^Approved\s*\(\s*1\s*\)$/)).toBeTruthy();
      expect(screen.getByText(/^Completed\s*\(\s*0\s*\)$/)).toBeTruthy();
      expect(screen.getByText(/^Cancel\s*\(\s*0\s*\)$/)).toBeTruthy();
      expect(screen.queryByText(/Payment Pending/i)).toBeNull();
    });
  });

  it("renders task rows and badges", async () => {
    render(
      <MemoryRouter>
        <TechnicalTasksPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SHREE KHODIYAR ENTERPRISE")).toBeTruthy();
      expect(screen.getAllByText("XM12.7 Handy Printer Metal Body 12.7mm").length).toBeGreaterThan(0);
    });
  });

  it("opens Detail drawer when clicking Detail button or Company Name", async () => {
    render(
      <MemoryRouter>
        <TechnicalTasksPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SHREE KHODIYAR ENTERPRISE")).toBeTruthy();
    });

    const detailButtons = screen.getAllByRole("button", { name: /Detail/i });
    fireEvent.click(detailButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("View Detail #task-1")).toBeTruthy();
      expect(screen.getByText("Motherboard repair required")).toBeTruthy();
      expect(screen.getByText("Task Type")).toBeTruthy();
      expect(screen.getByText("Current Status")).toBeTruthy();
    });

    // Close the drawer
    const closeBtn = screen.getByRole("button", { name: /×/ });
    fireEvent.click(closeBtn);

    // Clicking the company name also opens the View Detail drawer
    const companyBtn = screen.getByRole("button", { name: "SHREE KHODIYAR ENTERPRISE" });
    fireEvent.click(companyBtn);

    await waitFor(() => {
      expect(screen.getByText("View Detail #task-1")).toBeTruthy();
    });
  });

  it("opens Add New modal when clicking + ADD NEW button with screenshot fields", async () => {
    render(
      <MemoryRouter>
        <TechnicalTasksPage />
      </MemoryRouter>
    );

    const addNewBtn = screen.getByRole("button", { name: /\+ ADD NEW/i });
    fireEvent.click(addNewBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Add Technical Task" })).toBeTruthy();
      expect(screen.getByPlaceholderText("Search for Company Name")).toBeTruthy();
      expect(screen.getByPlaceholderText("Contact Person")).toBeTruthy();
      expect(screen.getByPlaceholderText("Search Product...")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
    });
  });

  it("renders skeleton loading rows while fetching data", async () => {
    let resolveTasks: (value: any) => void;
    const taskPromise = new Promise((resolve) => {
      resolveTasks = resolve;
    });

    vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockReturnValue(taskPromise as any);

    render(
      <MemoryRouter>
        <TechnicalTasksPage />
      </MemoryRouter>
    );

    const skeletonRows = screen.getAllByTestId("skeleton-row");
    expect(skeletonRows.length).toBeGreaterThan(0);

    // Resolve promise to clean up
    resolveTasks!({
      data: sampleTasks,
      meta: { total: 1, page: 1, page_size: 50, total_pages: 1 },
    });

    await waitFor(() => {
      expect(screen.queryAllByTestId("skeleton-row").length).toBe(0);
      expect(screen.getByText("SHREE KHODIYAR ENTERPRISE")).toBeTruthy();
    });
  });

  it("renders error fallback and retry button when fetching tasks fails", async () => {
    const fetchSpy = vi
      .spyOn(technicalTasksApi, "fetchTechnicalTasks")
      .mockRejectedValueOnce(new Error("Network gateway timeout"));

    render(
      <MemoryRouter>
        <TechnicalTasksPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Failed to Load Technical Tasks")).toBeTruthy();
      expect(screen.getAllByText(/Network gateway timeout/i).length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: /Try Again/i })).toBeTruthy();
    });

    // Mock next call as successful
    fetchSpy.mockResolvedValueOnce({
      data: sampleTasks as any,
      meta: { total: 1, page: 1, page_size: 50, total_pages: 1 } as any,
    });

    fireEvent.click(screen.getByRole("button", { name: /Try Again/i }));

    await waitFor(() => {
      expect(screen.getByText("SHREE KHODIYAR ENTERPRISE")).toBeTruthy();
    });
  });

  it("renders filter empty state with Clear All Filters button when filters yield 0 results", async () => {
    vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, page_size: 50, total_pages: 1 } as any,
    });

    render(
      <MemoryRouter>
        <TechnicalTasksPage />
      </MemoryRouter>
    );

    // Enter search query to trigger filter empty state
    const searchInput = screen.getByPlaceholderText("Search...");
    fireEvent.change(searchInput, { target: { value: "Unknown Nonexistent Task" } });

    await waitFor(() => {
      expect(screen.getByText("No technical tasks found matching your filters")).toBeTruthy();
      expect(screen.getByRole("button", { name: /Clear All Filters/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Clear All Filters/i }));

    await waitFor(() => {
      expect((screen.getByPlaceholderText("Search...") as HTMLInputElement).value).toBe("");
    });
  });

  it("renders system empty state when database has no tasks and opens Add modal via header + ADD NEW button", async () => {
    vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, page_size: 50, total_pages: 1 } as any,
    });

    render(
      <MemoryRouter>
        <TechnicalTasksPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("No technical tasks in the system yet")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /\+ Add New Task/i })).toBeNull();
    });

    // Header "+ ADD NEW" button opens the Add modal
    fireEvent.click(screen.getByRole("button", { name: /\+ ADD NEW/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Add Technical Task" })).toBeTruthy();
    });
  });

  it("filters tasks by serial number and displays serial badge in table", async () => {
    const tasksWithSerial = [
      {
        ...sampleTasks[0],
        id: "task-sn-1",
        serial_number: "INH-2026-MC001",
      },
    ];

    const fetchSpy = vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
      data: tasksWithSerial as any,
      meta: { total: 1, page: 1, page_size: 50, total_pages: 1 } as any,
    });

    render(
      <MemoryRouter>
        <TechnicalTasksPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("task-row-serial-number")).toBeTruthy();
      expect(screen.getByText("SN: INH-2026-MC001")).toBeTruthy();
    });

    // Clicking the serial badge triggers filtering by serial number
    fireEvent.click(screen.getByTestId("task-row-serial-number"));

    await waitFor(() => {
      expect((screen.getByTestId("filter-serial-number") as HTMLInputElement).value).toBe("INH-2026-MC001");
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          serial_number: "INH-2026-MC001",
        })
      );
    });
  });

  it("autofills machine and customer details when looking up serial number in Add modal", async () => {
    vi.spyOn(technicalTasksApi, "lookupTaskSerialNumber").mockResolvedValue({
      serial_number: "INH-2026-MC001",
      machine_model: "XM12.7 Handy Printer Metal Body 12.7mm",
      company_name: "SHREE KHODIYAR ENTERPRISE",
      city: "Ahmedabad",
      contact_person: "Rajesh Patel",
      contact_phone: "+91 98250 11223",
      warranty_status: "UNDER_WARRANTY",
      warranty_end_date: "2027-09-17",
      invoice_number: "INV-2026-001",
      past_tasks_count: 2,
      past_tasks: [],
    });

    render(
      <MemoryRouter>
        <TechnicalTasksPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /\+ ADD NEW/i }));

    await waitFor(() => {
      expect(screen.getByTestId("radio-product-serial")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("radio-product-serial"));

    await waitFor(() => {
      expect(screen.getByTestId("field-serial-number")).toBeTruthy();
    });

    const snInput = screen.getByTestId("field-serial-number");
    fireEvent.change(snInput, { target: { value: "INH-2026-MC001" } });

    const lookupBtn = screen.getByTestId("btn-lookup-serial");
    expect(lookupBtn).toBeTruthy();
    fireEvent.click(lookupBtn);

    await waitFor(() => {
      expect(screen.getByTestId("serial-lookup-info")).toBeTruthy();
      expect(screen.getByText(/Customer: SHREE KHODIYAR ENTERPRISE/i)).toBeTruthy();
      expect((screen.getByPlaceholderText("Search for Company Name") as HTMLInputElement).value).toBe(
        "SHREE KHODIYAR ENTERPRISE"
      );
    });
  });

  it("enforces mandatory cancellation remarks and performs reopen/reassign workflow", async () => {
    const cancelledTask = {
      ...sampleTasks[0],
      id: "task-cancelled-1",
      status: "Cancel",
      cancel_remarks: "Customer decided to defer visit",
    };

    vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
      data: [cancelledTask] as any,
      meta: { total: 1, page: 1, page_size: 50, total_pages: 1 } as any,
    });

    const reopenSpy = vi.spyOn(technicalTasksApi, "reopenTechnicalTask").mockResolvedValue({
      ...cancelledTask,
      status: "Approved",
      task_allotted_to: "Devendra Marade",
      cancel_remarks: null,
    } as any);

    render(
      <MemoryRouter>
        <TechnicalTasksPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("SHREE KHODIYAR ENTERPRISE")).toBeTruthy();
    });

    // Open detail drawer
    const detailButtons = screen.getAllByRole("button", { name: /Detail/i });
    fireEvent.click(detailButtons[0]);

    await waitFor(() => {
      expect(screen.getByTestId("drawer-btn-reopen-task")).toBeTruthy();
    });

    // Click reopen action
    fireEvent.click(screen.getByTestId("drawer-btn-reopen-task"));

    await waitFor(() => {
      expect(screen.getByText(/Reopen \/ Reassign Cancelled Task/i)).toBeTruthy();
      expect(screen.getByTestId("btn-save-status")).toBeTruthy();
    });

    // Submit reopen
    fireEvent.click(screen.getByTestId("btn-save-status"));

    await waitFor(() => {
      expect(reopenSpy).toHaveBeenCalledWith(
        "task-cancelled-1",
        expect.objectContaining({
          status: "Approved",
        })
      );
    });
  });

  it("sends date range, service type, third-party city and payment filters to the API", async () => {
    const spy = vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
      data: sampleTasks as any,
      meta: { total: 1, page: 1, page_size: 50, total_pages: 1 } as any,
    });

    render(
      <MemoryRouter>
        <TechnicalTasksPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTitle("Toggle Filter Options"));
    fireEvent.change(screen.getByLabelText("Created from"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Created to"), { target: { value: "2026-10-15" } });
    expect(screen.getByText("Third-Party Site City")).toBeTruthy();
    expect(screen.getByText("Payment Collected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      const last = spy.mock.calls[spy.mock.calls.length - 1][0] as Record<string, unknown>;
      expect(last.date_from).toBe("2026-10-01");
      expect(last.date_to).toBe("2026-10-15");
    });
  });

  const openMenuFor = async (text: string) => {
    await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
    fireEvent.click(screen.getByText("⋮"));
  };

  it("opens Approve & Allot Task modal on Approved click, enforces technician allotment, and supports approver overrides", async () => {
    (apiGet as any).mockImplementation(async (path: string) => {
      if (path.startsWith("/masters/technicians?")) {
        throw new Error("403 Forbidden: technician.view required");
      }
      if (path === "/masters/technicians/lookup") {
        return { data: [{ name: "Devendra Marade" }] };
      }
      return { data: [] };
    });
    try {
      const pending = {
        ...sampleTasks[0],
        status: "Pending",
        service_type: "Free",
        service_charge: 0,
        payment_terms: "",
        task_allotted_to: null,
        task_approved_by: null,
      };
      vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
        data: [pending] as any,
        meta: { total: 1, page: 1, page_size: 50, total_pages: 1 } as any,
      });
      const statusSpy = vi
        .spyOn(technicalTasksApi, "updateTechnicalTaskStatus")
        .mockResolvedValue({ ...pending, status: "Approved", task_allotted_to: "Devendra Marade" } as any);

      render(<MemoryRouter><TechnicalTasksPage /></MemoryRouter>);
      await openMenuFor("SHREE KHODIYAR ENTERPRISE");

      expect(screen.queryByText("Approve")).toBeNull();
      const approvedBtn = screen.getByRole("button", { name: /✅\s*Approved/ });
      expect(approvedBtn).toBeTruthy();
      fireEvent.click(approvedBtn);

      await waitFor(() => {
        expect(screen.getByTestId("status-task-modal")).toBeTruthy();
        expect(screen.getByText(/Approve & Allot Task/i)).toBeTruthy();
      });

      // Saving without selecting Task Allotted To is blocked with inline modal error
      fireEvent.click(screen.getByTestId("btn-save-status"));
      await waitFor(() => {
        expect(screen.getByTestId("status-modal-error").textContent).toMatch(
          /Select the technician \(Task Allotted To\) before approving/i
        );
      });
      expect(statusSpy).not.toHaveBeenCalled();

      // Select technician (loaded via /masters/technicians/lookup fallback) and override Free -> Chargeable
      const techSelect = screen.getByTestId("approve-technician") as HTMLSelectElement;
      await screen.findByRole("option", { name: "Devendra Marade" });
      fireEvent.change(techSelect, { target: { value: "Devendra Marade" } });
      expect(screen.queryByTestId("status-modal-error")).toBeNull();
      fireEvent.change(screen.getByTestId("approve-service-type"), { target: { value: "Chargeable" } });
      fireEvent.change(await screen.findByTestId("approve-amount"), { target: { value: "3500" } });
      fireEvent.change(screen.getByTestId("approve-terms"), { target: { value: "50% advance" } });
      fireEvent.click(screen.getByTestId("btn-save-status"));

      await waitFor(() => {
        expect(statusSpy).toHaveBeenCalledWith(
          "task-1",
          "Approved",
          "",
          expect.objectContaining({
            task_allotted_to: "Devendra Marade",
            service_type: "Chargeable",
            service_charge: 3500,
            payment_terms: "50% advance",
          })
        );
      });
    } finally {
      (apiGet as any).mockImplementation(async () => ({ data: [] }));
    }
  });

  it("opens Complete Technical Task modal on Completed click and mandatory remarks modal on Cancel click", async () => {
    const approved = { ...sampleTasks[0], status: "Approved", task_approved_by: "Admin" };
    vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
      data: [approved] as any,
      meta: { total: 1, page: 1, page_size: 50, total_pages: 1 } as any,
    });
    const statusSpy = vi
      .spyOn(technicalTasksApi, "updateTechnicalTaskStatus")
      .mockResolvedValue({ ...approved, status: "Completed", payment_status: "Pending" } as any);

    const { unmount } = render(<MemoryRouter><TechnicalTasksPage /></MemoryRouter>);
    await openMenuFor("SHREE KHODIYAR ENTERPRISE");

    expect(screen.queryByText("Complete Task")).toBeNull();
    expect(screen.queryByText("Cancel Task")).toBeNull();
    const completedBtn = screen.getByRole("button", { name: /✔️\s*Completed/ });
    const cancelBtn = screen.getByRole("button", { name: /❌\s*Cancel/ });
    expect(completedBtn).toBeTruthy();
    expect(cancelBtn).toBeTruthy();

    // Chargeable task -> Completed opens payment collection modal; choosing 'No' marks work Completed with payment_status Pending (tracked in /payments)
    fireEvent.click(completedBtn);
    await waitFor(() => {
      expect(screen.getByText(/Complete Technical Task/i)).toBeTruthy();
      expect(screen.getByText(/Did you collect payment/i)).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText(/No \(Pending in Payments\)/i));
    fireEvent.click(screen.getByTestId("btn-save-status"));

    await waitFor(() => {
      expect(statusSpy).toHaveBeenCalledWith(
        "task-1",
        "Completed",
        "",
        expect.objectContaining({
          payment_status: "Pending",
          payment_collected: false,
        })
      );
    });
    unmount();

    // Cancel opens mandatory remarks modal and blocks blank submission
    statusSpy.mockClear();
    statusSpy.mockResolvedValue({ ...approved, status: "Cancel" } as any);
    render(<MemoryRouter><TechnicalTasksPage /></MemoryRouter>);
    await openMenuFor("SHREE KHODIYAR ENTERPRISE");
    fireEvent.click(screen.getByRole("button", { name: /❌\s*Cancel/ }));

    await waitFor(() => {
      expect(screen.getByTestId("cancel-task-modal")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("btn-confirm-cancel"));
    expect(screen.getByText("Cancellation remarks are strictly mandatory.")).toBeTruthy();
    expect(statusSpy).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("cancel-remarks-input"), {
      target: { value: "Client requested cancellation due to plant shutdown" },
    });
    fireEvent.click(screen.getByTestId("btn-confirm-cancel"));

    await waitFor(() => {
      expect(statusSpy).toHaveBeenCalledWith(
        "task-1",
        "Cancel",
        "Client requested cancellation due to plant shutdown",
        expect.objectContaining({
          cancel_remarks: "Client requested cancellation due to plant shutdown",
        })
      );
    });
  });

  it("blocks reopen to Approved of a chargeable task without an amount in the Reopen modal", async () => {
    const cancelled = { ...sampleTasks[0], status: "Cancel", task_allotted_to: "Devendra Marade", service_charge: 0 };
    vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
      data: [cancelled] as any,
      meta: { total: 1, page: 1, page_size: 50, total_pages: 1 } as any,
    });
    const reopenSpy = vi.spyOn(technicalTasksApi, "reopenTechnicalTask").mockResolvedValue({} as any);

    render(<MemoryRouter><TechnicalTasksPage /></MemoryRouter>);
    await openMenuFor("SHREE KHODIYAR ENTERPRISE");
    fireEvent.click(screen.getByText("Reopen / Reassign"));
    fireEvent.change(await screen.findByTestId("approve-service-type"), { target: { value: "Chargeable" } });
    await screen.findByTestId("approve-amount");
    fireEvent.click(screen.getByTestId("btn-save-status"));

    await waitFor(() => expect(screen.getByText(/Amount is required for chargeable tasks/i)).toBeTruthy());
    expect(reopenSpy).not.toHaveBeenCalled();
  });

  it("hides admin-level actions (edit approved by others, delete after Pending) from normal users", async () => {
    authState.isSuperAdmin = false;
    authState.username = "sales1";
    authState.perms = [
      "technicaltask.view",
      "technicaltask.create",
      "technicaltask.update",
      "technicaltask.approve",
      "technicaltask.delete",
    ];
    try {
      vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
        data: [sampleTasks[0]] as any, // Approved by "Sushant Dhawade"
        meta: { total: 1, page: 1, page_size: 50, total_pages: 1 } as any,
      });
      render(<MemoryRouter><TechnicalTasksPage /></MemoryRouter>);
      await openMenuFor("SHREE KHODIYAR ENTERPRISE");
      expect(screen.getByText("Call Logs")).toBeTruthy();
      expect(screen.getByRole("button", { name: /✔️\s*Completed/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: /❌\s*Cancel/ })).toBeTruthy();
      expect(screen.queryByText("Edit")).toBeNull();
      expect(screen.queryByText("Delete")).toBeNull();
    } finally {
      authState.isSuperAdmin = true;
      authState.username = "admin";
      authState.perms = [];
    }
  });

  it("shows Edit and Delete for a Pending task to normal users, and Delete for admins on any stage", async () => {
    authState.isSuperAdmin = false;
    authState.username = "sales1";
    authState.perms = [
      "technicaltask.view",
      "technicaltask.create",
      "technicaltask.update",
      "technicaltask.approve",
      "technicaltask.delete",
    ];
    try {
      vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
        data: [{ ...sampleTasks[0], status: "Pending", task_approved_by: null }] as any,
        meta: { total: 1, page: 1, page_size: 50, total_pages: 1 } as any,
      });
      render(<MemoryRouter><TechnicalTasksPage /></MemoryRouter>);
      await openMenuFor("SHREE KHODIYAR ENTERPRISE");
      expect(screen.getByText("Edit")).toBeTruthy();
      expect(screen.getByText("Delete")).toBeTruthy();
    } finally {
      authState.isSuperAdmin = true;
      authState.username = "admin";
      authState.perms = [];
    }
  });

  it("gates header buttons and row actions by granular technicaltask.* permissions and registers RBAC metadata", async () => {
    const { NAV_ITEMS_BY_KEY } = await import("@/lib/nav");
    const { MODULE_NAMES, friendlyPermissionLabel } = await import("@/lib/permissionLabels");

    expect(NAV_ITEMS_BY_KEY["technical-tasks"]?.permission).toBe("technicaltask.view");
    expect(NAV_ITEMS_BY_KEY["payments"]?.permission).toBe("technicaltask.view");
    expect(MODULE_NAMES.technicaltask).toBe("Technical Tasks");
    expect(friendlyPermissionLabel("technicaltask.view")).toBe("View");
    expect(friendlyPermissionLabel("technicaltask.create")).toBe("Create");
    expect(friendlyPermissionLabel("technicaltask.update")).toBe("Edit");
    expect(friendlyPermissionLabel("technicaltask.approve")).toBe("Approve");
    expect(friendlyPermissionLabel("technicaltask.delete")).toBe("Delete");
    expect(friendlyPermissionLabel("technicaltask.export")).toBe("Export");
    expect(friendlyPermissionLabel("technicaltask.bulk_action")).toBe("Bulk Actions");
    expect(friendlyPermissionLabel("technicaltask.manage")).toBe("Manage All");

    authState.isSuperAdmin = false;
    authState.username = "viewer1";
    authState.perms = ["technicaltask.view"];
    try {
      vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
        data: [{ ...sampleTasks[0], status: "Pending", task_approved_by: null }] as any,
        meta: { total: 1, page: 1, page_size: 50, total_pages: 1 } as any,
      });
      render(<MemoryRouter><TechnicalTasksPage /></MemoryRouter>);

      expect(screen.queryByText("+ ADD NEW")).toBeNull();
      expect(screen.queryByText(/Imp \/ Exp/)).toBeNull();
      expect(screen.queryByText(/Bulk Actions/)).toBeNull();

      await openMenuFor("SHREE KHODIYAR ENTERPRISE");
      expect(screen.queryByText("View Details")).toBeNull();
      expect(screen.getByText("Call Logs")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /✅\s*Approved/ })).toBeNull();
      expect(screen.queryByText("Edit")).toBeNull();
      expect(screen.queryByText("Delete")).toBeNull();
    } finally {
      authState.isSuperAdmin = true;
      authState.username = "admin";
      authState.perms = [];
    }
  });

  it("shows only Call Logs and admin Delete (no Payment Collected or Reopen) for Completed unpaid tasks", async () => {
    vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
      data: [{ ...sampleTasks[0], status: "Completed", payment_status: "Pending" }] as any,
      meta: { total: 1, page: 1, page_size: 50, total_pages: 1 } as any,
    });
    render(<MemoryRouter><TechnicalTasksPage /></MemoryRouter>);
    await openMenuFor("SHREE KHODIYAR ENTERPRISE");
    expect(screen.getByText("Call Logs")).toBeTruthy();
    expect(screen.queryByText("Payment Collected")).toBeNull();
    expect(screen.queryByText("Reopen / Reassign")).toBeNull();
  });

  it("shows the Contact Person dropdown with the company's contacts and fills designation + number", async () => {
    (apiGet as any).mockImplementation(async (path: string) =>
      path.includes("/contacts")
        ? {
          data: [
            { person_name: "Rajesh Patel", designation: "Manager", calling_number: "9825011223" },
            { person_name: "Meena Shah", designation: "Accounts", calling_number: "9825099999" },
          ]
        }
        : { data: [] }
    );
    try {
      vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
        data: [{ ...sampleTasks[0], status: "Pending", company_id: "company-1", task_approved_by: null }] as any,
        meta: { total: 1, page: 1, page_size: 50, total_pages: 1 } as any,
      });
      render(<MemoryRouter><TechnicalTasksPage /></MemoryRouter>);
      await openMenuFor("SHREE KHODIYAR ENTERPRISE");
      fireEvent.click(screen.getByText("Edit"));
      const select = (await screen.findByTestId("contact-person-select")) as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "Meena Shah" } });
      await waitFor(() => {
        expect((screen.getByPlaceholderText("Designation e.g. Manager") as HTMLInputElement).value).toBe("Accounts");
        expect((screen.getByPlaceholderText("Mobile / Calling Number") as HTMLInputElement).value).toBe("9825099999");
      });
    } finally {
      (apiGet as any).mockImplementation(async () => ({ data: [] }));
    }
  });

  it("toggles Product Option between All Products and Product by Serial No. in Add Task form", async () => {
    vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
      data: [] as any,
      meta: { total: 0, page: 1, page_size: 50, total_pages: 1 } as any,
    });
    const lookupSpy = vi.spyOn(technicalTasksApi, "lookupTaskSerialNumber").mockResolvedValue({
      serial_number: "INH-2026-MC001",
      machine_model: "AP-500 Sealer",
      company_name: "ALPHA PACKAGING",
      city: "Ahmedabad",
      contact_person: "Mr. Patel",
      contact_phone: "9876543210",
      warranty_status: "Active",
      past_tasks_count: 0,
      past_tasks: [],
    });

    render(
      <MemoryRouter>
        <TechnicalTasksPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText("+ ADD NEW"));
    expect(screen.getByText("Product Option")).toBeTruthy();

    // Default mode is All Products -> shows Search Product placeholder
    expect((screen.getByTestId("radio-product-all") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByPlaceholderText("Search Product...")).toBeTruthy();
    expect(screen.queryByTestId("field-serial-number")).toBeNull();

    // Switch to Product by Serial No.
    fireEvent.click(screen.getByTestId("radio-product-serial"));
    expect((screen.getByTestId("radio-product-serial") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId("field-serial-number")).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter Product Name")).toBeTruthy();
    expect(screen.getByTestId("btn-lookup-serial")).toBeTruthy();

    // Type serial number and perform lookup
    fireEvent.change(screen.getByTestId("field-serial-number"), { target: { value: "INH-2026-MC001" } });
    fireEvent.click(screen.getByTestId("btn-lookup-serial"));

    await waitFor(() => {
      expect(lookupSpy).toHaveBeenCalledWith("INH-2026-MC001");
      expect(screen.getByText("AP-500 Sealer")).toBeTruthy();
    });

    // Switch back to All Products
    fireEvent.click(screen.getByTestId("radio-product-all"));
    expect(screen.getByPlaceholderText("Search Product...")).toBeTruthy();
    expect(screen.queryByTestId("field-serial-number")).toBeNull();
  });

  it("opens Machine & Model dropdown when clicked and supports both write and dropdown selection", async () => {
    vi.mocked(technicalTasksApi.fetchTechnicalTasks).mockResolvedValueOnce({
      data: sampleTasks,
      meta: { pagination: { total_items: sampleTasks.length } },
    });

    render(
      <MemoryRouter>
        <TechnicalTasksPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText("+ ADD NEW"));
    const machineInput = screen.getByPlaceholderText("Search Product...") as HTMLInputElement;
    expect(machineInput).toBeTruthy();

    // Clicking the input opens the dropdown list
    fireEvent.click(machineInput);
    expect(screen.getByTestId("field-machine-model-dropdown")).toBeTruthy();
    expect(screen.getByText("ISL150 Rotary PFS 4 Stations")).toBeTruthy();

    // Clicking an option selects it
    fireEvent.click(screen.getByText("ISL150 Rotary PFS 4 Stations"));
    expect(machineInput.value).toBe("ISL150 Rotary PFS 4 Stations");
    expect(screen.queryByTestId("field-machine-model-dropdown")).toBeNull();

    // Typing custom text works and keeps dropdown open for matching/custom options
    fireEvent.change(machineInput, { target: { value: "Custom Model 9000" } });
    expect(machineInput.value).toBe("Custom Model 9000");
    expect(screen.getByTestId("field-machine-model-dropdown")).toBeTruthy();
    expect(screen.getByText('Use "Custom Model 9000" as custom machine/model')).toBeTruthy();

    // Clicking the toggle button closes dropdown
    const toggleBtn = screen.getByTestId("field-machine-model-toggle");
    fireEvent.click(toggleBtn);
    expect(screen.queryByTestId("field-machine-model-dropdown")).toBeNull();

    // Clicking toggle button again re-opens dropdown
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("field-machine-model-dropdown")).toBeTruthy();
  });
});