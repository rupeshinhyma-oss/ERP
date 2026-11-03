import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TechnicalTasksPage } from "../TechnicalTasksPage";
import { TechnicalTaskDetailPage } from "../TechnicalTaskDetailPage";
import * as technicalTasksApi from "@/lib/technicalTasksApi";
import type { TechnicalTask, TechnicalTaskCallLog, TechnicalTaskLog } from "@/types/technicalTasks";

const authState = vi.hoisted(() => ({ isSuperAdmin: true, username: "admin", perms: [] as string[] }));
vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({
      profile: { username: authState.username, display_name: "Admin" },
      isSuperAdmin: authState.isSuperAdmin,
      hasPermission: (code?: string | null) => authState.isSuperAdmin || !code || authState.perms.includes(code),
    }),
  };
});

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

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

describe("TechnicalTaskDetailPage & Call Logs Navigation", () => {
  const sampleTask: TechnicalTask = {
    id: "task-uuid-101",
    task_number: 7,
    company_name: "ACME PACKAGING SYSTEMS",
    task_type: "Telecall",
    city: "Vadodara",
    priority: "A",
    machine_model: "ISL250 Rotary Filler",
    serial_number: "SN-2026-77",
    task_description: "Sensor calibration check",
    contact_person_name: "Rohan Mehta",
    contact_designation: "Plant Head",
    contact_phone: "9876501234",
    created_by_name: "Admin",
    task_created_date: "2026-11-02",
    service_type: "Free",
    call_type: "Repair",
    task_allotted_to: null,
    status: "Pending",
    version: 1,
    created_at: "2026-11-02T10:30:00Z",
    updated_at: "2026-11-02T10:30:00Z",
  };

  const sampleTaskLogs: TechnicalTaskLog[] = [
    {
      id: "tlog-1",
      task_id: "task-uuid-101",
      updated_by: "Admin",
      title: "Create Technical Task",
      status: "Pending",
      created_at: "2026-11-02T10:30:00Z",
    },
  ];

  beforeEach(() => {
    authState.isSuperAdmin = true;
    authState.perms = [];
    vi.clearAllMocks();

    vi.spyOn(technicalTasksApi, "fetchTechnicalTasks").mockResolvedValue({
      data: [sampleTask],
      meta: { pagination: { page: 1, page_size: 50, total_records: 1, total_pages: 1 } },
    });
    vi.spyOn(technicalTasksApi, "fetchTechnicalTaskCounts").mockResolvedValue({
      all: 1,
      pending: 1,
      approved: 0,
      completed: 0,
      cancel: 0,
    });
    vi.spyOn(technicalTasksApi, "fetchTechnicalTask").mockResolvedValue(sampleTask);
    vi.spyOn(technicalTasksApi, "fetchTaskCallLogs").mockResolvedValue([]);
    vi.spyOn(technicalTasksApi, "fetchTaskLogs").mockResolvedValue(sampleTaskLogs);
  });

  afterEach(() => {
    cleanup();
  });

  it("navigates from Technical Task List row Call Logs action to /technical-task/detail/:id and renders Task & Company Details", async () => {
    render(
      <MemoryRouter initialEntries={["/technical-task/list"]}>
        <Routes>
          <Route path="/technical-task/list" element={<TechnicalTasksPage />} />
          <Route path="/technical-task/detail/:id" element={<TechnicalTaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("ACME PACKAGING SYSTEMS")).toBeTruthy();
    });

    // Open row Action menu (⋮) and click Call Logs
    fireEvent.click(screen.getByText("⋮"));
    const callLogsMenuBtn = await screen.findByText("Call Logs");
    fireEvent.click(callLogsMenuBtn);

    // Verify dedicated detail page renders with dynamic fields
    await waitFor(() => {
      expect(screen.getByText("Technical Task #7")).toBeTruthy();
    });
    expect(screen.getByText("Task Details")).toBeTruthy();
    expect(screen.getByText("Nature Of Complain / Description")).toBeTruthy();
    expect(screen.getByText("Sensor calibration check")).toBeTruthy();
    expect(screen.getByText("ISL250 Rotary Filler | SN-2026-77")).toBeTruthy();
    expect(screen.getByText("November 2, 2026")).toBeTruthy();

    expect(screen.getByText("Company Details")).toBeTruthy();
    expect(screen.getByText("ACME PACKAGING SYSTEMS")).toBeTruthy();
    expect(screen.getByText("Rohan Mehta")).toBeTruthy();
    expect(screen.getByText("9876501234")).toBeTruthy();

    // Default Call Log Summary tab empty state
    expect(screen.getByText("Call Log Summary")).toBeTruthy();
    expect(screen.getByText("Task Log Summary")).toBeTruthy();
    expect(screen.getByText("No Data Available In Table")).toBeTruthy();
    expect(screen.getByText("Showing 0 To 0 Of 0 Entries")).toBeTruthy();
  });

  it("switches to Task Log Summary and submits a new Call Log via the Add Call Log right drawer", async () => {
    const storedLogs: TechnicalTaskCallLog[] = [];
    vi.spyOn(technicalTasksApi, "fetchTaskCallLogs").mockImplementation(async () => [...storedLogs]);
    const createSpy = vi.spyOn(technicalTasksApi, "createTaskCallLog").mockImplementation(async (_id, payload) => {
      const created: TechnicalTaskCallLog = {
        id: "clog-1",
        task_id: sampleTask.id,
        call_date: "2026-11-02",
        call_type: payload.call_type,
        remarks: payload.remarks,
        created_by: "Admin",
        created_at: "2026-11-02T11:15:00Z",
      };
      storedLogs.push(created);
      return created;
    });

    render(
      <MemoryRouter initialEntries={["/technical-task/detail/7"]}>
        <Routes>
          <Route path="/technical-task/detail/:id" element={<TechnicalTaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Technical Task #7")).toBeTruthy();
    });

    // Switch to Task Log Summary tab
    fireEvent.click(screen.getByText("Task Log Summary"));
    await waitFor(() => {
      expect(screen.getByText("Updated By")).toBeTruthy();
      expect(screen.getByText("Create Technical Task")).toBeTruthy();
    });

    // Click + ADD NEW CALL LOG -> opens right-side Add Call Log drawer
    fireEvent.click(screen.getByTestId("btn-open-add-call-log"));
    expect(screen.getByText("Add Call Log")).toBeTruthy();

    const telecallRadio = screen.getByLabelText("Telecall") as HTMLInputElement;
    const visitRadio = screen.getByLabelText("Physical Visit") as HTMLInputElement;
    expect(telecallRadio.checked).toBe(true);

    // Select Physical Visit and enter Remarks
    fireEvent.click(visitRadio);
    expect(visitRadio.checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Remarks"), {
      target: { value: "Inspected rotary head on-site and aligned sensor." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith("task-uuid-101", {
        call_type: "Physical Visit",
        remarks: "Inspected rotary head on-site and aligned sensor.",
      });
    });

    // Drawer closes and Call Log Summary displays the newly created entry
    await waitFor(() => {
      expect(screen.getByText("Inspected rotary head on-site and aligned sensor.")).toBeTruthy();
      expect(screen.getByText("Showing 1 To 1 Of 1 Entries")).toBeTruthy();
    });
  });

  it("hides + ADD NEW CALL LOG for view-only users without update/create permission", async () => {
    authState.isSuperAdmin = false;
    authState.perms = ["technicaltask.view"];

    render(
      <MemoryRouter initialEntries={["/technical-task/detail/7"]}>
        <Routes>
          <Route path="/technical-task/detail/:id" element={<TechnicalTaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Technical Task #7")).toBeTruthy();
    });
    expect(screen.queryByTestId("btn-open-add-call-log")).toBeNull();
  });
});
