import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { PipelineSetupPage, CrmPipelineItem } from "../crm/PipelineSetupPage";
import * as apiModule from "@/lib/api";
import { auth } from "@/lib/auth";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

const MOCK_PIPELINES: CrmPipelineItem[] = [
  {
    id: "pipe-1",
    name: "Enterprise Sales",
    description: "Inbound enterprise leads",
    is_default: true,
    is_active: true,
    stage_count: 4,
    lead_count: 12,
    created_at: "2026-10-12T10:00:00Z",
    updated_at: "2026-10-12T10:00:00Z",
    stages: [
      {
        id: "stage-1",
        pipeline_id: "pipe-1",
        name: "Discovery",
        stage_order: 1,
        stage_type: "open",
        is_initial: true,
        is_active: true,
        lead_count: 5,
        created_at: "2026-10-12T10:00:00Z",
        updated_at: "2026-10-12T10:00:00Z",
      },
      {
        id: "stage-2",
        pipeline_id: "pipe-1",
        name: "Proposal Sent",
        stage_order: 2,
        stage_type: "open",
        is_initial: false,
        is_active: true,
        lead_count: 4,
        created_at: "2026-10-12T10:00:00Z",
        updated_at: "2026-10-12T10:00:00Z",
      },
      {
        id: "stage-3",
        pipeline_id: "pipe-1",
        name: "Closed Won",
        stage_order: 3,
        stage_type: "won",
        is_initial: false,
        is_active: true,
        lead_count: 2,
        created_at: "2026-10-12T10:00:00Z",
        updated_at: "2026-10-12T10:00:00Z",
      },
      {
        id: "stage-4",
        pipeline_id: "pipe-1",
        name: "Closed Lost",
        stage_order: 4,
        stage_type: "lost",
        is_initial: false,
        is_active: true,
        lead_count: 1,
        created_at: "2026-10-12T10:00:00Z",
        updated_at: "2026-10-12T10:00:00Z",
      },
    ],
  },
  {
    id: "pipe-2",
    name: "Partner Channel",
    description: "B2B distributor leads",
    is_default: false,
    is_active: true,
    stage_count: 2,
    lead_count: 3,
    created_at: "2026-10-12T10:00:00Z",
    updated_at: "2026-10-12T10:00:00Z",
    stages: [],
  },
];

describe("PipelineSetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
    vi.spyOn(auth, "hasPermission").mockReturnValue(true);
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url === "/api/v1/crm/pipelines") {
        return Promise.resolve({ data: MOCK_PIPELINES }) as any;
      }
      if (url.startsWith("/api/v1/crm/pipelines/pipe-1")) {
        return Promise.resolve({ data: MOCK_PIPELINES[0] }) as any;
      }
      return Promise.resolve({ data: [] }) as any;
    });
  });

  afterEach(() => {
    cleanup();
  });

  const renderComponent = async () => {
    const rendered = render(
      <BrowserRouter>
        <PipelineSetupPage />
      </BrowserRouter>
    );
    await waitFor(() => {
      expect(screen.queryByText(/Loading pipelines.../i)).toBeNull();
    });
    return rendered;
  };

  it("renders header, breadcrumb, metrics, and active navigation key", async () => {
    await renderComponent();

    expect(screen.getByTestId("app-shell").getAttribute("data-active-key")).toBe("crm-pipelines");
    expect(screen.getByRole("heading", { level: 1, name: /Pipeline Setup/i })).toBeTruthy();
    expect(screen.getByText("Total Pipelines")).toBeTruthy();
    expect(screen.getByText("Default Pipeline")).toBeTruthy();
    expect(screen.getAllByText("Enterprise Sales").length).toBeGreaterThanOrEqual(1);
  });

  it("lists all pipelines with status pills, default badges, and stage counts", async () => {
    await renderComponent();

    expect(screen.getAllByText("Enterprise Sales").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Partner Channel")).toBeTruthy();
    expect(screen.getByText("★ Default")).toBeTruthy();
    expect(screen.getByText("4 Stages")).toBeTruthy();
    expect(screen.getByText("2 Stages")).toBeTruthy();
  });

  it("opens create pipeline modal and allows typing pipeline details", async () => {
    await renderComponent();

    const addBtn = screen.getByRole("button", { name: /Add Pipeline/i });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Create Pipeline" })).toBeTruthy();
    });

    const nameInput = screen.getByPlaceholderText(/Inbound Enterprise Sales/i);
    fireEvent.change(nameInput, { target: { value: "New Government Tender" } });
    expect((nameInput as HTMLInputElement).value).toBe("New Government Tender");
  });

  it("opens stage management drawer with ordered stages and stage type indicators", async () => {
    await renderComponent();

    const manageButtons = screen.getAllByRole("button", { name: /Manage Stages/i });
    fireEvent.click(manageButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Stages: Enterprise Sales")).toBeTruthy();
      expect(screen.getByText("Discovery")).toBeTruthy();
      expect(screen.getByText("Proposal Sent")).toBeTruthy();
      expect(screen.getByText("Closed Won")).toBeTruthy();
      expect(screen.getByText("Closed Lost")).toBeTruthy();
    });

    // Check Initial Stage badge
    expect(screen.getByText("★ Initial Stage")).toBeTruthy();

    // Check classification badges
    expect(screen.getByText("✓ Closed Won")).toBeTruthy();
    expect(screen.getByText("✕ Closed Lost")).toBeTruthy();

    // Check action icon buttons presence and clickability
    expect(screen.getByRole("button", { name: "Edit Discovery" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Proposal Sent" })).toBeTruthy();

    // Verify initial stage has disabled delete button with explanatory tooltip
    const initialDeleteBtn = screen.getByRole("button", { name: "Delete Discovery" });
    expect((initialDeleteBtn as HTMLButtonElement).disabled).toBe(true);
    expect(initialDeleteBtn.getAttribute("title")).toContain("Initial stage cannot be deleted");

    // Verify non-initial stage has enabled delete button
    const nonInitialDeleteBtn = screen.getByRole("button", { name: "Delete Proposal Sent" });
    expect((nonInitialDeleteBtn as HTMLButtonElement).disabled).toBe(false);

    // Verify initial stage has disabled status toggle
    const initialActiveBtn = screen.getByRole("button", { name: "Active" });
    expect((initialActiveBtn as HTMLButtonElement).disabled).toBe(true);
    expect(initialActiveBtn.getAttribute("title")).toContain("Initial landing stage must remain active");
  });

  it("opens edit stage modal from stage drawer with reachable cancel and update controls", async () => {
    await renderComponent();

    const manageButtons = screen.getAllByRole("button", { name: /Manage Stages/i });
    fireEvent.click(manageButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Stages: Enterprise Sales")).toBeTruthy();
    });

    // Click edit on "Proposal Sent" stage
    const editBtn = screen.getByRole("button", { name: "Edit Proposal Sent" });
    fireEvent.click(editBtn);

    // Verify Edit Stage modal appears with prepopulated name and controls
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Edit Pipeline Stage" })).toBeTruthy();
      expect(screen.getByDisplayValue("Proposal Sent")).toBeTruthy();
      expect(screen.getByRole("button", { name: /Update Stage/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Cancel/i })).toBeTruthy();
    });
  });

  it("defaults to Standard Template and displays the 5 editable stages in create drawer", async () => {
    await renderComponent();

    const addBtn = screen.getByRole("button", { name: /Add Pipeline/i });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Create Pipeline" })).toBeTruthy();
    });

    // Check strategy selection options
    expect(screen.getByText("Standard Template")).toBeTruthy();
    expect(screen.getByText("RECOMMENDED")).toBeTruthy();
    expect(screen.getByText("Custom Pipeline")).toBeTruthy();

    const stdRadio = screen.getByLabelText(/Standard Template/i);
    expect((stdRadio as HTMLInputElement).checked).toBe(true);

    // Verify all 5 standard stages are rendered
    expect(screen.getAllByText("New Lead").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Contacted").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Proposal Sent").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Closed Won").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Closed Lost").length).toBeGreaterThanOrEqual(1);

    // Verify exactly one initial stage
    const initialBadges = screen.getAllByText("★ Initial Stage");
    expect(initialBadges.length).toBe(1);
  });

  it("has a single vertical scroll container with fixed header and reachable footer", async () => {
    await renderComponent();

    const addBtn = screen.getByRole("button", { name: /Add Pipeline/i });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Create Pipeline" })).toBeTruthy();
    });

    // Verify single primary vertical scroll container
    const scrollBody = screen.getByTestId("pipeline-drawer-scroll-body");
    expect(scrollBody).toBeTruthy();
    expect(scrollBody.style.overflowY).toBe("auto");

    // Verify fixed action footer
    const footer = screen.getByTestId("pipeline-drawer-footer");
    expect(footer).toBeTruthy();
    expect(footer.style.flexShrink).toBe("0");

    // Action buttons inside footer
    expect(screen.getByRole("button", { name: /Cancel/i })).toBeTruthy();
    expect(screen.getByTestId("pipeline-submit-btn")).toBeTruthy();
  });

  it("switches to Custom Pipeline with empty stages and allows adding custom stages", async () => {
    await renderComponent();

    const addBtn = screen.getByRole("button", { name: /Add Pipeline/i });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Create Pipeline" })).toBeTruthy();
    });

    // Switch to Custom Pipeline directly (untouched standard stages switch directly)
    const customOption = screen.getByText("Custom Pipeline");
    fireEvent.click(customOption);

    // Verify empty state is displayed
    await waitFor(() => {
      expect(screen.getByText("No stages configured yet")).toBeTruthy();
    });

    // Open add stage modal
    const addStageBtn = screen.getByRole("button", { name: /Add First Stage/i });
    fireEvent.click(addStageBtn);

    await waitFor(() => {
      expect(screen.getByText("Add Stage to Pipeline")).toBeTruthy();
    });

    // Fill stage details
    const stageNameInput = screen.getByPlaceholderText(/Inquiries, Needs Analysis/i);
    fireEvent.change(stageNameInput, { target: { value: "Lead Assessment" } });

    const submitStageBtn = screen.getByTestId("draft-stage-submit-btn");
    fireEvent.click(submitStageBtn);

    // Verify stage appears in list
    await waitFor(() => {
      expect(screen.getByText("Lead Assessment")).toBeTruthy();
    });
  });

  it("prompts confirmation when switching to Standard Template if custom stages were added", async () => {
    await renderComponent();

    const addBtn = screen.getByRole("button", { name: /Add Pipeline/i });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Create Pipeline" })).toBeTruthy();
    });

    // Switch to Custom Pipeline
    fireEvent.click(screen.getByText("Custom Pipeline"));

    // Add a custom stage
    const addFirstStageBtn = screen.getByRole("button", { name: /Add First Stage/i });
    fireEvent.click(addFirstStageBtn);

    const stageNameInput = screen.getByPlaceholderText(/Inquiries, Needs Analysis/i);
    fireEvent.change(stageNameInput, { target: { value: "Bespoke Discovery" } });
    fireEvent.click(screen.getByTestId("draft-stage-submit-btn"));

    await waitFor(() => {
      expect(screen.getByText("Bespoke Discovery")).toBeTruthy();
    });

    // Now try switching back to Standard Template
    fireEvent.click(screen.getByText("Standard Template"));

    // Confirmation modal should appear
    await waitFor(() => {
      expect(screen.getByText("Reset to Standard Template?")).toBeTruthy();
      expect(screen.getByText(/Any customized stages will be discarded/i)).toBeTruthy();
    });

    // Confirm the replacement
    const confirmBtn = screen.getByRole("button", { name: /Confirm Action/i });
    fireEvent.click(confirmBtn);

    // Standard stages should now be restored in the stage list
    await waitFor(() => {
      expect(screen.getAllByText("New Lead").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Closed Won").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows validation error next to field when pipeline name is empty on submission", async () => {
    await renderComponent();

    const addBtn = screen.getByRole("button", { name: /Add Pipeline/i });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Create Pipeline" })).toBeTruthy();
    });

    // Try submitting with empty name
    const form = screen.getByTestId("pipeline-drawer-scroll-body").closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getAllByText(/Pipeline name is required and cannot be blank/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("allows reordering stages and setting a different initial stage", async () => {
    await renderComponent();

    const addBtn = screen.getByRole("button", { name: /Add Pipeline/i });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Create Pipeline" })).toBeTruthy();
    });

    // "Contacted" is initially open and not initial. Click "Set Initial"
    const setInitialButtons = screen.getAllByRole("button", { name: /Set Initial/i });
    expect(setInitialButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(setInitialButtons[0]);

    // Check that "Initial Stage" badge moved
    await waitFor(() => {
      const initialBadges = screen.getAllByText("★ Initial Stage");
      expect(initialBadges.length).toBe(1);
    });

    // Reorder stage down
    const downButtons = screen.getAllByRole("button", { name: /down/i });
    expect(downButtons.length).toBeGreaterThan(0);
    fireEvent.click(downButtons[0]);
  });

  it("handles long stage lists inside scroll container while keeping footer buttons reachable", async () => {
    await renderComponent();

    const addBtn = screen.getByRole("button", { name: /Add Pipeline/i });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Create Pipeline" })).toBeTruthy();
    });

    // Add 5 more stages to make a long list of 10 stages
    for (let i = 1; i <= 5; i++) {
      const addStageBtn = screen.getByRole("button", { name: /Add Stage/i });
      fireEvent.click(addStageBtn);

      await waitFor(() => {
        expect(screen.getByText("Add Stage to Pipeline")).toBeTruthy();
      });

      const stageInput = screen.getByPlaceholderText(/Inquiries, Needs Analysis/i);
      fireEvent.change(stageInput, { target: { value: `Custom Phase ${i}` } });

      const submitStageBtn = screen.getByTestId("draft-stage-submit-btn");
      fireEvent.click(submitStageBtn);

      await waitFor(() => {
        expect(screen.getByText(`Custom Phase ${i}`)).toBeTruthy();
      });
    }

    // Verify 10 stages exist
    const scrollBody = screen.getByTestId("pipeline-drawer-scroll-body");
    expect(scrollBody).toBeTruthy();
    expect(screen.getByText("Custom Phase 5")).toBeTruthy();

    // Verify footer buttons remain present and reachable
    const footer = screen.getByTestId("pipeline-drawer-footer");
    expect(footer).toBeTruthy();
    const createBtn = screen.getByTestId("pipeline-submit-btn");
    expect(createBtn).toBeTruthy();
    expect(createBtn.textContent).toBe("Create Pipeline");
  });

  it("prompts confirmation when switching from edited Standard Template to Custom Pipeline", async () => {
    await renderComponent();

    const addBtn = screen.getByRole("button", { name: /Add Pipeline/i });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Create Pipeline" })).toBeTruthy();
    });

    // Edit the first stage name from "New Lead" to "Brand New Prospect"
    const editStageBtn = screen.getByRole("button", { name: /Edit New Lead/i });
    fireEvent.click(editStageBtn);

    await waitFor(() => {
      expect(screen.getByText("Edit Stage")).toBeTruthy();
    });

    const stageInput = screen.getByPlaceholderText(/Inquiries, Needs Analysis/i);
    fireEvent.change(stageInput, { target: { value: "Brand New Prospect" } });
    fireEvent.click(screen.getByTestId("draft-stage-submit-btn"));

    await waitFor(() => {
      expect(screen.getByText("Brand New Prospect")).toBeTruthy();
    });

    // Try switching to Custom Pipeline
    fireEvent.click(screen.getByText("Custom Pipeline"));

    // Confirmation modal should appear before discarding edits
    await waitFor(() => {
      expect(screen.getByText("Clear Stages for Custom Pipeline?")).toBeTruthy();
      expect(screen.getByText(/will clear your customized stages/i)).toBeTruthy();
    });

    // Confirm discarding
    const confirmBtn = screen.getByRole("button", { name: /Confirm Action/i });
    fireEvent.click(confirmBtn);

    // Should now be in Custom Pipeline with empty state
    await waitFor(() => {
      expect(screen.getByText("No stages configured yet")).toBeTruthy();
    });
  });

  it("validates that at least one stage is required when stages are removed", async () => {
    await renderComponent();

    const addBtn = screen.getByRole("button", { name: /Add Pipeline/i });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Create Pipeline" })).toBeTruthy();
    });

    // Switch to Custom Pipeline directly
    fireEvent.click(screen.getByText("Custom Pipeline"));

    await waitFor(() => {
      expect(screen.getByText("No stages configured yet")).toBeTruthy();
    });

    // Fill valid pipeline name
    const nameInput = screen.getByPlaceholderText(/Inbound Enterprise Sales/i);
    fireEvent.change(nameInput, { target: { value: "Empty Stage Pipeline" } });

    // Submit with 0 stages
    const form = screen.getByTestId("pipeline-drawer-scroll-body").closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getAllByText(/At least one stage is required before creating a pipeline/i).length).toBeGreaterThanOrEqual(1);
    });
  });
});
