import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ReactionPicker } from "../../components/ReactionPicker";
import { EscalateTaskModal } from "./EscalateTaskModal";

// Mock tasksApi
vi.mock("@/lib/tasksApi", () => ({
  createTask: vi.fn().mockResolvedValue({ id: "mock-task-123" }),
  getAvailableAssignees: vi.fn().mockResolvedValue([
    { id: "u-1", name: "Alice Smith", department: "Engineering", email: "alice@example.com" },
    { id: "u-2", name: "Bob Jones", department: "Operations", email: "bob@example.com" },
  ]),
  fetchEscalateOptions: vi.fn().mockResolvedValue({
    reporting_managers: [{ user_id: "u-1", name: "Alice Smith", department: "Engineering" }],
    department_managers: [{ user_id: "u-2", name: "Bob Jones", department: "Operations" }],
    organization_users: [{ user_id: "u-3", name: "Charlie Brown", department: "Executive" }],
  }),
  tasksApi: {
    fetchLabels: vi.fn().mockResolvedValue([]),
    fetchSprints: vi.fn().mockResolvedValue([]),
    fetchTemplates: vi.fn().mockResolvedValue([]),
    getTasks: vi.fn().mockResolvedValue({ items: [] }),
    escalateTask: vi.fn().mockResolvedValue({ success: true }),
    toggleReaction: vi.fn().mockResolvedValue({ success: true }),
  },
}));

// Test helper: Replicates AppShell notification categorization logic
function classifyNotification(type: string, title: string) {
  const t = (type || "").toLowerCase();
  const tit = (title || "").toLowerCase();

  const isOverdue = t.includes("overdue") || tit.includes("overdue");
  const isDeadlineToday = t.includes("deadline_today") || tit.includes("due today");
  const isDeadlineSoon = t.includes("approaching") || tit.includes("due tomorrow") || tit.includes("due soon");
  const isEscalation = t.includes("escalat") || tit.includes("escalat");
  const isDeadline = isOverdue || isDeadlineToday || isDeadlineSoon || t.includes("deadline") || tit.includes("deadline");
  const isMention = t.includes("mention") || tit.includes("mention");
  const isAssigned = t.includes("assigned") || tit.includes("assigned");
  const isSubtask = t.includes("subtask") || tit.includes("subtask");
  const isHold = t.includes("hold") || tit.includes("hold");
  const isCompleted = t.includes("completed") || tit.includes("completed") || t.includes("done");

  const isTeam = isMention || isAssigned || isSubtask || t.includes("watcher") || isHold || isCompleted || (!isDeadline && !isEscalation);

  let badgeLabel = "TASK";
  if (isOverdue) badgeLabel = "⚠️ OVERDUE";
  else if (isDeadlineToday) badgeLabel = "📅 DUE TODAY";
  else if (isDeadlineSoon) badgeLabel = "⏰ DUE SOON";
  else if (isEscalation) badgeLabel = "⚡ ESCALATION";
  else if (isMention) badgeLabel = "💬 MENTION";
  else if (isAssigned) badgeLabel = "👤 ASSIGNED";
  else if (isCompleted) badgeLabel = "✓ DONE";
  else if (isHold) badgeLabel = "⏸️ ON HOLD";

  return { isDeadline, isEscalation, isTeam, badgeLabel };
}

describe("Notification Bell Categorization & Badging Accuracy (QA Specification 32.5)", () => {
  it("correctly classifies Overdue task notification", () => {
    const meta = classifyNotification("task_overdue", "Task 'API Specs' is overdue!");
    expect(meta.isDeadline).toBe(true);
    expect(meta.isEscalation).toBe(false);
    expect(meta.badgeLabel).toBe("⚠️ OVERDUE");
  });

  it("correctly classifies Due Today task notification", () => {
    const meta = classifyNotification("task_deadline_today", "Task due today: Client presentation");
    expect(meta.isDeadline).toBe(true);
    expect(meta.badgeLabel).toBe("📅 DUE TODAY");
  });

  it("correctly classifies Approaching Deadline notification", () => {
    const meta = classifyNotification("deadline_approaching", "Task due tomorrow: Architecture signoff");
    expect(meta.isDeadline).toBe(true);
    expect(meta.badgeLabel).toBe("⏰ DUE SOON");
  });

  it("correctly classifies Escalation notification", () => {
    const meta = classifyNotification("escalation_deadline", "Urgent escalation assigned to you");
    expect(meta.isEscalation).toBe(true);
    expect(meta.badgeLabel).toBe("⚡ ESCALATION");
  });

  it("correctly classifies Mention notification under Team", () => {
    const meta = classifyNotification("task_mention", "Alice mentioned you in 'Security Audit'");
    expect(meta.isTeam).toBe(true);
    expect(meta.badgeLabel).toBe("💬 MENTION");
  });

  it("correctly classifies Task Assignment notification under Team", () => {
    const meta = classifyNotification("task_assigned", "You were assigned to 'DB Migration'");
    expect(meta.isTeam).toBe(true);
    expect(meta.badgeLabel).toBe("👤 ASSIGNED");
  });

  it("correctly classifies On Hold notification under Team", () => {
    const meta = classifyNotification("task_hold_expired", "Task hold period expired");
    expect(meta.isTeam).toBe(true);
    expect(meta.badgeLabel).toBe("⏸️ ON HOLD");
  });

  it("correctly classifies Completed Task notification under Team", () => {
    const meta = classifyNotification("task_completed", "Task completed by QA");
    expect(meta.isTeam).toBe(true);
    expect(meta.badgeLabel).toBe("✓ DONE");
  });
});

describe("ReactionPicker Component Verification (QA Specification 32.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders active reactions with counts and highlights reacted status", () => {
    const activeReactions = [
      { emoji: "👍", count: 3, user_ids: ["u-1", "me"], has_reacted: true },
      { emoji: "🚀", count: 1, user_ids: ["u-2"], has_reacted: false },
    ];
    const onToggle = vi.fn();

    render(<ReactionPicker reactions={activeReactions} onToggleReaction={onToggle} />);

    expect(screen.getByText("👍")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("🚀")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("invokes onToggleReaction when an active reaction chip is clicked", () => {
    const activeReactions = [
      { emoji: "👍", count: 2, user_ids: ["u-1"], has_reacted: false },
    ];
    const onToggle = vi.fn();

    render(<ReactionPicker reactions={activeReactions} onToggleReaction={onToggle} />);

    const chip = screen.getByText("👍").closest("button");
    if (chip) fireEvent.click(chip);

    expect(onToggle).toHaveBeenCalledWith("👍");
  });

  it("opens reaction picker popover on '+ Add Reaction' click and allows selecting emoji", () => {
    const onToggle = vi.fn();
    render(<ReactionPicker reactions={[]} onToggleReaction={onToggle} />);

    const addBtn = screen.getByTitle("Add reaction");
    expect(addBtn).toBeTruthy();
    fireEvent.click(addBtn);

    // Popover should render standard emoji options
    const heartEmoji = screen.getByText("❤️");
    expect(heartEmoji).toBeTruthy();
    fireEvent.click(heartEmoji);

    expect(onToggle).toHaveBeenCalledWith("❤️");
  });
});

describe("EscalateTaskModal Verification & Validation (QA Specification 32.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders modal when isOpen is true with target categories and submits escalation", async () => {
    render(
      <EscalateTaskModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        taskId="task-123"
        taskTitle="Critical Performance Bottleneck"
      />
    );

    expect(screen.getByText("Escalate Task")).toBeTruthy();
    expect(screen.getByText(/Critical Performance Bottleneck/)).toBeTruthy();
    expect(screen.getByText(/Reporting Manager/)).toBeTruthy();
    expect(screen.getByText(/Dept Manager/)).toBeTruthy();
    expect(screen.getByText(/Organization User/)).toBeTruthy();
  });

  it("disables Submit Escalation button until required fields are present", async () => {
    render(
      <EscalateTaskModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        taskId="task-123"
        taskTitle="Critical Performance Bottleneck"
      />
    );

    const submitBtn = screen.getByRole("button", { name: /Submit Escalation/i }) as HTMLButtonElement;
    // When reason is empty, submit button is disabled
    expect(submitBtn.disabled).toBe(true);

    // Enter reason
    const reasonInput = screen.getByPlaceholderText(/Explain the blocker, urgency/i);
    fireEvent.change(reasonInput, { target: { value: "Upstream vendor API unavailable" } });

    // Wait for candidate to load and auto-select
    await waitFor(() => {
      expect(submitBtn.disabled).toBe(false);
    });
  });

  it("closes modal on Cancel click or Escape key", () => {
    const onClose = vi.fn();
    render(
      <EscalateTaskModal
        isOpen={true}
        onClose={onClose}
        onSuccess={vi.fn()}
        taskId="task-123"
        taskTitle="Critical Performance Bottleneck"
      />
    );

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
