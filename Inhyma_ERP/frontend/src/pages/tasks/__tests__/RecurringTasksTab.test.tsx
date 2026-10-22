import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { RecurringTasksTab } from "../RecurringTasksTab";
import { tasksApi } from "@/lib/tasksApi";
import type { AvailableUser, TaskRecurringSchedule, TaskSummary } from "@/types/tasks";

// Mock tasksApi
vi.mock("@/lib/tasksApi", () => ({
  tasksApi: {
    fetchRecurringSchedules: vi.fn(),
    fetchRecurringInstances: vi.fn(),
    pauseRecurringSchedule: vi.fn(),
    resumeRecurringSchedule: vi.fn(),
    archiveRecurringSchedule: vi.fn(),
    unarchiveRecurringSchedule: vi.fn(),
    restoreRecurringSchedule: vi.fn(),
    deleteRecurringSchedule: vi.fn(),
    generateRecurringTasks: vi.fn(),
    previewRecurrence: vi.fn(),
    createRecurringSchedule: vi.fn(),
    updateRecurringSchedule: vi.fn(),
  },
}));

describe("RecurringTasksTab UI & Interactions", () => {
  afterEach(cleanup);
  const mockUsers: AvailableUser[] = [
    { id: "u-1", full_name: "Alice Engineer", department: "Engineering" },
    { id: "u-2", full_name: "Bob Manager", department: "Engineering" },
  ];

  const mockSchedules: TaskRecurringSchedule[] = [
    {
      id: "sch-1",
      title: "Monthly Security Patching",
      description: "Apply regular monthly OS patches",
      department: "Engineering",
      assignee_id: "u-1",
      manager_id: "u-2",
      priority: "HIGH",
      issue_type: "TASK",
      frequency: "MONTHLY",
      recurrence_config: { day_type: "SPECIFIC_DAY", day_of_month: 28 },
      reminder_lead_days: 3,
      escalation_timing_type: "ON_DUE_DATE",
      escalation_offset_days: 0,
      escalation_repeat_interval_days: 7,
      status: "ACTIVE",
      effective_start_date: "2026-10-01",
      effective_end_date: null,
      next_due_date: "2026-10-28",
      next_period: "2026-10",
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
    },
  ];

  const mockDueInstances: TaskSummary[] = [
    {
      id: "t-rec-1",
      title: "Monthly Security Patching [2026-10]",
      description: "Apply regular monthly OS patches",
      priority: "HIGH",
      status: "TODO",
      recurring_schedule_id: "sch-1",
      recurrence_period: "2026-10",
      due_date: "2026-10-28",
      subtask_total: 0,
      subtask_completed: 0,
      comment_count: 0,
      escalation_count: 0,
      assignees: [{ id: "a-1", task_id: "t-rec-1", user_id: "u-1", assignment_role: "ASSIGNEE", created_at: "2026-10-01T00:00:00Z" }],
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
    },
  ];

  const mockHistoryInstances: TaskSummary[] = [
    {
      id: "t-rec-past",
      title: "Monthly Security Patching [2026-09]",
      description: "Apply regular monthly OS patches",
      priority: "HIGH",
      status: "DONE",
      approval_status: "APPROVED",
      recurring_schedule_id: "sch-1",
      recurrence_period: "2026-09",
      due_date: "2026-09-28",
      subtask_total: 0,
      subtask_completed: 0,
      comment_count: 2,
      escalation_count: 0,
      assignees: [{ id: "a-2", task_id: "t-rec-past", user_id: "u-1", assignment_role: "ASSIGNEE", created_at: "2026-09-01T00:00:00Z" }],
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-28T00:00:00Z",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (tasksApi.fetchRecurringSchedules as any).mockResolvedValue(mockSchedules);
    (tasksApi.fetchRecurringInstances as any).mockImplementation(({ history_only }: any) =>
      Promise.resolve(history_only ? mockHistoryInstances : mockDueInstances)
    );
    (tasksApi.previewRecurrence as any).mockResolvedValue({
      frequency: "MONTHLY",
      next_period: "2026-11",
      next_due_date: "2026-11-28",
      explanation: "Calculated next month on day 28",
    });
  });

  it("renders Schedules sub-tab by default and displays loaded schedules", async () => {
    const handleSelectTask = vi.fn();
    render(
      <RecurringTasksTab
        onSelectTask={handleSelectTask}
        availableUsers={mockUsers}
        canManageTasks={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Monthly Security Patching")).toBeDefined();
    });

    expect(screen.getByText("MONTHLY")).toBeDefined();
    expect(screen.getByText("Monthly (Day 28)")).toBeDefined();
    expect(screen.getByText("2026-10-28")).toBeDefined();
    expect(screen.getByText("ACTIVE")).toBeDefined();
  });

  it("handles pause action on an active schedule", async () => {
    (tasksApi.pauseRecurringSchedule as any).mockResolvedValue({
      ...mockSchedules[0],
      status: "PAUSED",
    });

    render(
      <RecurringTasksTab
        onSelectTask={vi.fn()}
        availableUsers={mockUsers}
        canManageTasks={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Monthly Security Patching")).toBeDefined();
    });

    const pauseButton = screen.getByTitle("Pause schedule");
    fireEvent.click(pauseButton);

    await waitFor(() => {
      expect(tasksApi.pauseRecurringSchedule).toHaveBeenCalledWith("sch-1");
    });
  });

  it("switches to Due / Upcoming sub-tab and opens Task Drawer on click", async () => {
    const handleSelectTask = vi.fn();
    render(
      <RecurringTasksTab
        onSelectTask={handleSelectTask}
        availableUsers={mockUsers}
        canManageTasks={true}
      />
    );

    const upcomingTabBtn = screen.getByRole("button", { name: /Due \/ Upcoming/i });
    fireEvent.click(upcomingTabBtn);

    await waitFor(() => {
      expect(screen.getByText("Monthly Security Patching [2026-10]")).toBeDefined();
    });

    expect(screen.getByText("Period: 2026-10")).toBeDefined();

    const openBtn = screen.getByText(/Open Task/i);
    fireEvent.click(openBtn);

    expect(handleSelectTask).toHaveBeenCalledWith("t-rec-1");
  });

  it("switches to History sub-tab and renders completed records", async () => {
    const handleSelectTask = vi.fn();
    render(
      <RecurringTasksTab
        onSelectTask={handleSelectTask}
        availableUsers={mockUsers}
        canManageTasks={true}
      />
    );

    const historyTabBtn = screen.getByRole("button", { name: /History & Audit/i });
    fireEvent.click(historyTabBtn);

    await waitFor(() => {
      expect(screen.getByText("Monthly Security Patching [2026-09]")).toBeDefined();
    });

    expect(screen.getByText("Verified by Manager")).toBeDefined();
    expect(screen.getByText("✅ Completed")).toBeDefined();
  });

  it("opens Create Schedule modal and previews next occurrence calculation", async () => {
    render(
      <RecurringTasksTab
        onSelectTask={vi.fn()}
        availableUsers={mockUsers}
        canManageTasks={true}
      />
    );

    const newBtn = screen.getByRole("button", { name: /New Recurring Schedule/i });
    fireEvent.click(newBtn);

    await waitFor(() => {
      expect(screen.getByText("Create Recurring Task Schedule")).toBeDefined();
    });

    // Check compact 4 sections navigation exist
    expect(screen.getByRole("button", { name: /1\. Task Details/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /2\. Schedule/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /3\. Reminders/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /4\. Active Period/i })).toBeDefined();

    // Check live occurrence preview banner is displayed
    await waitFor(() => {
      expect(tasksApi.previewRecurrence).toHaveBeenCalled();
      expect(screen.getByText(/Next Occurrence Timeline Preview/i)).toBeDefined();
    });

    // Switch to Schedule section
    const scheduleTabBtn = screen.getByRole("button", { name: /2\. Schedule/i });
    fireEvent.click(scheduleTabBtn);

    // Check frequency switcher buttons exist
    expect(screen.getByText("📅 Monthly")).toBeDefined();
    expect(screen.getByText("📊 Quarterly")).toBeDefined();
    expect(screen.getByText("📆 Yearly")).toBeDefined();
  });

  it("supports Specific Months and switching frequency in schedule tab", async () => {
    render(
      <RecurringTasksTab
        onSelectTask={vi.fn()}
        availableUsers={mockUsers}
        canManageTasks={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /New Recurring Schedule/i }));

    await waitFor(() => {
      expect(screen.getByText("Create Recurring Task Schedule")).toBeDefined();
    });

    // Navigate to Schedule section
    fireEvent.click(screen.getByRole("button", { name: /2\. Schedule/i }));

    // Switch to Specific Months
    const specificMonthsRadio = screen.getByLabelText(/Specific Months/i);
    fireEvent.click(specificMonthsRadio);

    // Jan-Dec month chips should be visible
    expect(screen.getByText("Jan")).toBeDefined();
    expect(screen.getByText("Dec")).toBeDefined();

    // Switch to Quarterly
    fireEvent.click(screen.getByText("📊 Quarterly"));
    expect(screen.getByText(/Select Applicable Quarters/i)).toBeDefined();

    // Switch to Yearly
    fireEvent.click(screen.getByText("📆 Yearly"));
    expect(screen.getByText(/Year Cadence Basis/i)).toBeDefined();
    expect(screen.getByText(/Financial Year/i)).toBeDefined();
  });

  it("displays archived schedules and handles restore action without showing pause or resume", async () => {
    const archivedSchedule: TaskRecurringSchedule = {
      ...mockSchedules[0],
      id: "sch-archived",
      title: "Archived Monthly Task",
      status: "ARCHIVED",
    };
    (tasksApi.fetchRecurringSchedules as any).mockResolvedValue([archivedSchedule]);
    (tasksApi.unarchiveRecurringSchedule as any).mockResolvedValue({
      ...archivedSchedule,
      status: "ACTIVE",
    });

    render(
      <RecurringTasksTab
        onSelectTask={vi.fn()}
        availableUsers={mockUsers}
        canManageTasks={true}
      />
    );

    // Switch filter to ARCHIVED
    const statusSelect = screen.getByRole("combobox");
    fireEvent.change(statusSelect, { target: { value: "ARCHIVED" } });

    await waitFor(() => {
      expect(screen.getByText("Archived Monthly Task")).toBeDefined();
    });

    // Check status badge
    expect(screen.getByText("ARCHIVED")).toBeDefined();

    // Verify Pause and Resume buttons are NOT rendered
    expect(screen.queryByTitle("Pause schedule")).toBeNull();
    expect(screen.queryByTitle("Resume schedule")).toBeNull();

    // Verify Restore button IS rendered
    const restoreBtn = screen.getByTitle("Restore schedule");
    expect(restoreBtn).toBeDefined();

    // Click restore
    fireEvent.click(restoreBtn);

    await waitFor(() => {
      expect(tasksApi.unarchiveRecurringSchedule).toHaveBeenCalledWith("sch-archived");
    });
  });

  it("hides management action buttons when canManageTasks is false", async () => {
    render(
      <RecurringTasksTab
        onSelectTask={vi.fn()}
        availableUsers={mockUsers}
        canManageTasks={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Monthly Security Patching")).toBeDefined();
    });

    // View button should be present instead of Edit
    expect(screen.getByTitle("View schedule")).toBeDefined();

    // Pause, Resume, Archive, Delete buttons should NOT be rendered
    expect(screen.queryByTitle("Pause schedule")).toBeNull();
    expect(screen.queryByTitle("Resume schedule")).toBeNull();
    expect(screen.queryByTitle("Archive schedule")).toBeNull();
    expect(screen.queryByTitle("Delete schedule")).toBeNull();
    expect(screen.queryByRole("button", { name: /New Recurring Schedule/i })).toBeNull();
  });
});

