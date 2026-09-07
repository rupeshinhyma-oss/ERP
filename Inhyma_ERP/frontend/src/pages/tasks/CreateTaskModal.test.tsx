import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CreateTaskModal } from "./CreateTaskModal";

// Mock tasksApi and getAvailableAssignees
vi.mock("@/lib/tasksApi", () => ({
  createTask: vi.fn().mockResolvedValue({ id: "mock-task-123" }),
  getAvailableAssignees: vi.fn().mockResolvedValue([]),
  fetchEscalateOptions: vi.fn().mockResolvedValue({
    reporting_managers: [],
    department_managers: [],
    organization_users: [],
  }),
  tasksApi: {
    fetchLabels: vi.fn().mockResolvedValue([]),
    fetchSprints: vi.fn().mockResolvedValue([]),
    fetchTemplates: vi.fn().mockResolvedValue([]),
    getTasks: vi.fn().mockResolvedValue({ items: [] }),
    uploadTaskFile: vi.fn().mockResolvedValue({ file_url: "/test.png", file_size: 100 }),
  },
}));

describe("CreateTaskModal Lifecycle & QA Verification", () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders null when isOpen is false", () => {
    const { container } = render(<CreateTaskModal {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders modal dialog when isOpen is true", () => {
    render(<CreateTaskModal {...defaultProps} />);
    expect(screen.getByText("+ Create New Task")).toBeTruthy();
    expect(screen.getByText("Create Task")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("calls onClose when the '✕' close button is clicked", () => {
    render(<CreateTaskModal {...defaultProps} />);
    const closeBtn = screen.getByText("✕");
    fireEvent.click(closeBtn);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the 'Cancel' button is clicked", () => {
    render(<CreateTaskModal {...defaultProps} />);
    const cancelBtn = screen.getByText("Cancel");
    fireEvent.click(cancelBtn);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the Escape key is pressed", () => {
    render(<CreateTaskModal {...defaultProps} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("validates that due date cannot be earlier than start date", () => {
    render(<CreateTaskModal {...defaultProps} />);
    const titleInput = screen.getByPlaceholderText("e.g. Website Redesign");
    fireEvent.change(titleInput, { target: { value: "Test Task" } });

    const dateInputs = document.querySelectorAll('input[type="date"]');
    const startDateInput = dateInputs[0] as HTMLInputElement;
    const dueDateInput = dateInputs[1] as HTMLInputElement;

    expect(startDateInput).toBeTruthy();
    expect(dueDateInput).toBeTruthy();

    fireEvent.change(startDateInput, { target: { value: "2026-09-10" } });
    fireEvent.change(dueDateInput, { target: { value: "2026-09-05" } });

    const submitBtn = screen.getByText("Create Task");
    fireEvent.click(submitBtn);

    expect(screen.getByText("Due date cannot be earlier than start date.")).toBeTruthy();
  });
});
