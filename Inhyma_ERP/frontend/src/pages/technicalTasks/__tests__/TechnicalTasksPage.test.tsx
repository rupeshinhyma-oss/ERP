import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TechnicalTasksPage } from "../TechnicalTasksPage";
import * as technicalTasksApi from "@/lib/technicalTasksApi";

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
      expect(screen.getByText(/All\s*\(\s*1\s*\)/)).toBeTruthy();
      expect(screen.getByText(/Pending\s*\(\s*0\s*\)/)).toBeTruthy();
      expect(screen.getByText(/Approved\s*\(\s*1\s*\)/)).toBeTruthy();
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

  it("renders system empty state with Add New Task button when database has no tasks", async () => {
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
      expect(screen.getByRole("button", { name: /\+ Add New Task/i })).toBeTruthy();
    });

    // Clicking "+ Add New Task" opens the Add modal
    fireEvent.click(screen.getByRole("button", { name: /\+ Add New Task/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Add Technical Task" })).toBeTruthy();
    });
  });
});

