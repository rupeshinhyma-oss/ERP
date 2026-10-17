import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { LeadImportPage } from "../crm/LeadImportPage";
import * as apiModule from "@/lib/api";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock Toast
vi.mock("@/lib/toast", () => ({
  useToast: () => vi.fn(),
}));

const mockAuth = vi.hoisted(() => ({
  isSuperAdmin: true,
  permissions: ["crm.leads.manage", "crm.leads.import", "*"],
  roles: ["admin"],
  profile: { id: "user-admin", username: "admin", full_name: "Admin User", roles: ["admin"] } as any,
}));

vi.mock("@/lib/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hooks")>()),
  useAuth: () => ({
    profile: mockAuth.profile,
    isSuperAdmin: mockAuth.isSuperAdmin,
    hasPermission: (code?: string | null) => {
      if (mockAuth.isSuperAdmin) return true;
      if (mockAuth.permissions.includes("*")) return true;
      return code ? mockAuth.permissions.includes(code) : true;
    },
  }),
}));

const MOCK_PIPELINES = [
  {
    id: "pipe-1",
    name: "Standard B2B Pipeline",
    description: "Main inbound sales",
    is_default: true,
    is_active: true,
    stage_count: 3,
    stages: [
      {
        id: "stage-1",
        pipeline_id: "pipe-1",
        name: "New Inbound Leads",
        stage_order: 0,
        stage_type: "open",
        is_initial: true,
        is_active: true,
      },
      {
        id: "stage-2",
        pipeline_id: "pipe-1",
        name: "Won Deal",
        stage_order: 1,
        stage_type: "won",
        is_initial: false,
        is_active: true,
      },
    ],
  },
];

const MOCK_PREVIEW_RESPONSE = {
  total_rows: 3,
  valid_candidate_count: 1,
  duplicate_crm_count: 1,
  duplicate_file_count: 1,
  invalid_count: 0,
  conflict_count: 0,
  pipeline_id: "pipe-1",
  pipeline_name: "Standard B2B Pipeline",
  initial_stage_id: "stage-1",
  initial_stage_name: "New Inbound Leads",
  can_import: true,
  rows: [
    {
      row_number: 2,
      name: "Rohit Sharma",
      original_phone: "9876543210",
      normalized_phone: "+919876543210",
      campaign: "Google_Q4",
      status: "VALID",
      validation_message: "Valid lead candidate ready for import.",
      is_valid_candidate: true,
      matched_lead_code: null,
    },
    {
      row_number: 3,
      name: "Virat Kohli",
      original_phone: "9123456789",
      normalized_phone: "+919123456789",
      campaign: "Facebook_Oct",
      status: "CRM_DUPLICATE",
      validation_message: "Contact already exists in CRM (Lead Code: CRM-2026-001).",
      is_valid_candidate: false,
      matched_lead_code: "CRM-2026-001",
    },
    {
      row_number: 4,
      name: "Rohit Sharma",
      original_phone: "9876543210",
      normalized_phone: "+919876543210",
      campaign: "Google_Q4",
      status: "FILE_DUPLICATE",
      validation_message: "Repeated contact within this CSV file (matches row 2).",
      is_valid_candidate: false,
      matched_lead_code: null,
    },
  ],
};

const MOCK_CONFIRM_RESPONSE = {
  batch_id: "batch-1",
  batch_name: "Test Inbound Batch",
  status: "completed",
  display_status: "Success",
  total_rows: 3,
  success_count: 1,
  duplicate_skipped_count: 2,
  failed_count: 0,
  pipeline_id: "pipe-1",
  pipeline_name: "Standard B2B Pipeline",
  sanitized_error_summary: null,
  row_results: MOCK_PREVIEW_RESPONSE.rows,
};

const MOCK_BATCHES = [
  {
    id: "batch-1",
    batch_name: "Previous October Batch",
    import_source: "csv",
    selected_pipeline_id: "pipe-1",
    pipeline_name: "Standard B2B Pipeline",
    initiated_by: "user-1",
    initiator_name: "Admin User",
    status: "completed",
    display_status: "Success",
    total_count: 50,
    success_count: 45,
    failed_count: 0,
    skipped_count: 5,
    created_at: "2026-10-12T10:00:00Z",
    sanitized_error_summary: null,
  },
  {
    id: "batch-2",
    batch_name: "Problematic Batch Test",
    import_source: "csv",
    selected_pipeline_id: "pipe-1",
    pipeline_name: "Standard B2B Pipeline",
    initiated_by: "user-1",
    initiator_name: "Admin User",
    status: "failed",
    display_status: "Failure",
    total_count: 11,
    success_count: 0,
    failed_count: 3,
    skipped_count: 8,
    created_at: "2026-10-13T09:00:00Z",
    sanitized_error_summary: JSON.stringify([
      { row: 10, outcome: "Invalid Name", reason: "Name cannot be blank.", action: "Provide a contact or prospect name in the Name column." },
      { row: 11, outcome: "Invalid Phone", reason: "Phone number cannot be blank.", action: "Provide a 10-digit Indian mobile number or valid E.164 phone number." },
      { row: 12, outcome: "Invalid Campaign", reason: "Campaign cannot be blank.", action: "Specify the origin marketing campaign or source tag." },
    ]),
  },
];

describe("LeadImportPage", () => {
  beforeEach(() => {
    mockAuth.isSuperAdmin = true;
    mockAuth.permissions = ["crm.leads.manage", "crm.leads.import", "*"];
    mockAuth.roles = ["admin"];
    mockAuth.profile = { id: "user-admin", username: "admin", full_name: "Admin User", roles: ["admin"] };

    window.URL.createObjectURL = vi.fn().mockReturnValue("blob:http://localhost/mock-blob-uuid");
    window.URL.revokeObjectURL = vi.fn();

    vi.spyOn(apiModule, "apiDownloadBlob").mockResolvedValue({
      blob: new Blob(["Name,Number,Campaign\nRajesh Kumar,9876543210,Google_Search_Q4\n"], { type: "text/csv" }),
      filename: "inhyma_crm_leads_template.csv",
    });

    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/crm/pipelines?is_active=true")) {
        return Promise.resolve({ data: MOCK_PIPELINES as any, meta: undefined });
      }
      if (url.includes("/crm/pipelines/pipe-1")) {
        return Promise.resolve({ data: MOCK_PIPELINES[0] as any, meta: undefined });
      }
      if (url.includes("/crm/import/batches/batch-2")) {
        return Promise.resolve({ data: MOCK_BATCHES[1] as any, meta: undefined });
      }
      if (url.includes("/crm/import/batches")) {
        return Promise.resolve({ data: MOCK_BATCHES as any, meta: undefined });
      }
      if (url.includes("/crm/distribution/salespeople")) {
        return Promise.resolve({
          data: [
            { user_id: "rep-1", display_name: "Alice Johnson", username: "alice", is_active: true, is_eligible: true, active_leads_count: 3, max_lead_capacity: 10 },
            { user_id: "rep-2", display_name: "Bob Smith", username: "bob", is_active: true, is_eligible: true, active_leads_count: 8, max_lead_capacity: 10 },
          ] as any,
          meta: undefined,
        });
      }
      return Promise.resolve({ data: [] as any, meta: undefined });
    });

    vi.spyOn(apiModule, "apiPostMultipart").mockImplementation((url: string) => {
      if (url.includes("/crm/import/preview")) {
        return Promise.resolve({ data: MOCK_PREVIEW_RESPONSE as any, meta: undefined });
      }
      if (url.includes("/crm/import/confirm")) {
        return Promise.resolve({ data: MOCK_CONFIRM_RESPONSE as any, meta: undefined });
      }
      return Promise.resolve({ data: {} as any, meta: undefined });
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderComponent = (props: any = {}) =>
    render(
      <BrowserRouter>
        <LeadImportPage {...props} />
      </BrowserRouter>
    );

  it("renders page header, guided wizard steps, and required columns notice", async () => {
    renderComponent();

    expect(screen.getByRole("heading", { name: "Lead Import" })).toBeDefined();
    expect(screen.getByText("1. Choose CSV")).toBeDefined();
    expect(screen.getByText("2. Target Pipeline")).toBeDefined();
    expect(screen.getByText("3. Preview & Dedupe")).toBeDefined();
    expect(screen.getByText("4. Confirm Import")).toBeDefined();
    expect(screen.getByText("5. View Results")).toBeDefined();

    // Required columns checklist
    expect(screen.getByText("Name")).toBeDefined();
    expect(screen.getByText("Number")).toBeDefined();
    expect(screen.getByText("Campaign")).toBeDefined();

    // Template download action
    const downloadBtn = screen.getByRole("button", { name: /Download CSV Template/i });
    expect(downloadBtn).toBeDefined();
    fireEvent.click(downloadBtn);
    expect(apiModule.apiDownloadBlob).toHaveBeenCalledWith("/api/v1/crm/import/template");
  });

  it("validates file selection and advances to Step 2 and Step 3 preview", async () => {
    renderComponent();

    // Cannot advance without a file
    const nextBtn = screen.getByText("Continue to Pipeline Selection \u2192") as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);

    // Simulate file drop
    const file = new File(["Name,Number,Campaign\nRohit,9876543210,Camp\n"], "leads.csv", {
      type: "text/csv",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("leads.csv")).toBeDefined();
      expect((screen.getByText("Continue to Pipeline Selection \u2192") as HTMLButtonElement).disabled).toBe(false);
    });

    // Advance to Step 2
    fireEvent.click(screen.getByText("Continue to Pipeline Selection \u2192"));

    await waitFor(() => {
      expect(screen.getByText("Select Destination CRM Pipeline")).toBeDefined();
      expect(screen.getByText(/Standard B2B Pipeline/)).toBeDefined();
      expect(screen.getByText(/New Inbound Leads/)).toBeDefined();
    });

    // Advance to Step 3 (Preview)
    const validateBtn = screen.getByText("Validate & Preview Leads \u2192");
    fireEvent.click(validateBtn);

    await waitFor(() => {
      expect(screen.getByText("Valid Candidates")).toBeDefined();
      expect(screen.getAllByText("Rohit Sharma").length).toBe(2);
      expect(screen.getByText("Virat Kohli")).toBeDefined();
      expect(screen.getByText(/matches row 2/i)).toBeDefined();
    });
  });

  it("completes full import and renders Step 5 with Success binary status and navigation", async () => {
    renderComponent();

    // Set file
    const file = new File(["Name,Number,Campaign\nRohit,9876543210,Camp\n"], "leads.csv", {
      type: "text/csv",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("leads.csv")).toBeDefined());
    fireEvent.click(screen.getByText("Continue to Pipeline Selection \u2192"));

    await waitFor(() => expect(screen.getByText(/New Inbound Leads/)).toBeDefined());
    const validateBtn = screen.getByText("Validate & Preview Leads \u2192");
    fireEvent.click(validateBtn);

    await waitFor(() => expect(screen.getByText("Proceed to Confirmation \u2192")).toBeDefined());
    fireEvent.click(screen.getByText("Proceed to Confirmation \u2192"));

    // Step 4: Confirm
    await waitFor(() => {
      expect(screen.getByText("Confirm Lead Import")).toBeDefined();
      expect(screen.getByText("Confirm and Commit Import")).toBeDefined();
    });

    fireEvent.click(screen.getByText("Confirm and Commit Import"));

    // Step 5: View Results
    await waitFor(() => {
      expect(screen.getByText("Import Successful")).toBeDefined();
      expect(screen.getByText("Success")).toBeDefined();
      expect(screen.getByText("View Imported Leads")).toBeDefined();
      expect(screen.getByText("Import Another CSV")).toBeDefined();
      expect(screen.getByText("View Batch History")).toBeDefined();
      // Verify redundant actions are removed
      expect(screen.queryByText("Back to CRM")).toBeNull();
      expect(screen.queryByText("Start Another Import")).toBeNull();
      expect(screen.queryByText("View All Import Batches")).toBeNull();
      // Verify redundant metric cards are removed
      expect(screen.queryByText("Assigned")).toBeNull();
      expect(screen.queryByText("Unassigned")).toBeNull();
    });
  });

  it("handles mixed import with failed rows displaying strictly Failure binary status", async () => {
    vi.spyOn(apiModule, "apiPostMultipart").mockImplementation((url: string) => {
      if (url.includes("/crm/import/preview")) {
        return Promise.resolve({ data: MOCK_PREVIEW_RESPONSE as any, meta: undefined });
      }
      if (url.includes("/crm/import/confirm")) {
        return Promise.resolve({
          data: {
            ...MOCK_CONFIRM_RESPONSE,
            status: "failed",
            display_status: "Failure",
            success_count: 1,
            duplicate_skipped_count: 1,
            failed_count: 1,
            sanitized_error_summary: JSON.stringify([
              { row: 4, outcome: "Invalid Field", reason: "Name cannot be blank.", action: "Provide a contact or prospect name in the Name column." }
            ]),
          } as any,
          meta: undefined,
        });
      }
      return Promise.resolve({ data: {} as any, meta: undefined });
    });

    renderComponent();

    // Advance to Step 4
    const file = new File(["Name,Number,Campaign\nRohit,9876543210,Camp\n"], "leads.csv", {
      type: "text/csv",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("leads.csv")).toBeDefined());
    fireEvent.click(screen.getByText("Continue to Pipeline Selection \u2192"));

    await waitFor(() => expect(screen.getByText(/New Inbound Leads/)).toBeDefined());
    const validateBtn = screen.getByText("Validate & Preview Leads \u2192");
    fireEvent.click(validateBtn);

    await waitFor(() => expect(screen.getByText("Proceed to Confirmation \u2192")).toBeDefined());
    fireEvent.click(screen.getByText("Proceed to Confirmation \u2192"));

    await waitFor(() => expect(screen.getByText("Confirm and Commit Import")).toBeDefined());
    fireEvent.click(screen.getByText("Confirm and Commit Import"));

    // Step 5: Verify honest Failure binary status for batch with failed rows
    await waitFor(() => {
      expect(screen.getByText("Import Failed")).toBeDefined();
      expect(screen.getByText(/could not be processed/i)).toBeDefined();
      expect(screen.getByText("View Imported Leads")).toBeDefined();
      expect(screen.getByText("Import Another CSV")).toBeDefined();
      expect(screen.getByText("View Batch History")).toBeDefined();
      expect(screen.getByText("Failed Rows Breakdown (1)")).toBeDefined();
      expect(screen.getByText("Row 4")).toBeDefined();
      expect(screen.getByText("Name cannot be blank.")).toBeDefined();
    });
  });

  it("switches to Batch History tab and renders binary statuses and batch details modal", async () => {
    renderComponent();

    const historyTabBtn = screen.getByRole("button", { name: "Batch History" });
    fireEvent.click(historyTabBtn);

    await waitFor(() => {
      expect(screen.getByText("Import Batches")).toBeDefined();
      expect(screen.getByText("Previous October Batch")).toBeDefined();
      expect(screen.getByText("Problematic Batch Test")).toBeDefined();
      expect(screen.getByText("Success")).toBeDefined();
      expect(screen.getByText("Failure")).toBeDefined();
      // Ensure no partially_completed labels
      expect(screen.queryByText(/partially/i)).toBeNull();
    });

    // Click "View Details" on the problematic batch
    const viewDetailButtons = screen.getAllByRole("button", { name: "View Details" });
    expect(viewDetailButtons.length).toBe(2);
    fireEvent.click(viewDetailButtons[1]);

    // Verify modal opens with breakdown of the 3 failed rows
    await waitFor(() => {
      expect(screen.getByText("Failed Rows Breakdown (3)")).toBeDefined();
      expect(screen.getByText("Row 10")).toBeDefined();
      expect(screen.getByText("Row 11")).toBeDefined();
      expect(screen.getByText("Row 12")).toBeDefined();
      expect(screen.getByText("Phone number cannot be blank.")).toBeDefined();
      expect(screen.getByText("Provide a 10-digit Indian mobile number or valid E.164 phone number.")).toBeDefined();
    });

    // Close modal
    const closeBtn = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText("Failed Rows Breakdown (3)")).toBeNull();
    });
  });

  it("displays lead distribution controls in Step 4 and confirms import with selected salespeople", async () => {
    const postMultipartSpy = vi.spyOn(apiModule, "apiPostMultipart").mockImplementation((url: string) => {
      if (url.includes("/crm/import/preview")) {
        return Promise.resolve({ data: MOCK_PREVIEW_RESPONSE as any, meta: undefined });
      }
      if (url.includes("/crm/import/confirm")) {
        return Promise.resolve({ data: MOCK_CONFIRM_RESPONSE as any, meta: undefined });
      }
      return Promise.resolve({ data: {} as any, meta: undefined });
    });

    renderComponent();

    // Advance to Step 4
    const file = new File(["Name,Number,Campaign\nRohit,9876543210,Camp\n"], "leads.csv", {
      type: "text/csv",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("leads.csv")).toBeDefined());
    fireEvent.click(screen.getByText("Continue to Pipeline Selection \u2192"));

    await waitFor(() => expect(screen.getByText(/New Inbound Leads/)).toBeDefined());
    const validateBtn = screen.getByText("Validate & Preview Leads \u2192");
    fireEvent.click(validateBtn);

    await waitFor(() => expect(screen.getByText("Proceed to Confirmation \u2192")).toBeDefined());
    fireEvent.click(screen.getByText("Proceed to Confirmation \u2192"));

    await waitFor(() => expect(screen.getByText("Confirm and Commit Import")).toBeDefined());

    // Step 4: Verify all 4 distribution modes are displayed
    expect(screen.getByText("Lead Distribution & Assignment Mode")).toBeDefined();
    expect(screen.getByText(/Automatic Distribution/i)).toBeDefined();
    expect(screen.getByText(/Distribute Across Selected Representatives/i)).toBeDefined();
    expect(screen.getByText(/Assign All Leads to Single Representative/i)).toBeDefined();
    expect(screen.getByText(/Import Without Assignment/i)).toBeDefined();

    // Select Mode 2: Selected Representatives
    const mode2Card = screen.getByText(/Distribute Across Selected Representatives/i);
    fireEvent.click(mode2Card);

    // Reps should be listed with workload/capacity
    await waitFor(() => {
      expect(screen.getByText("Alice Johnson")).toBeDefined();
      expect(screen.getByText("Bob Smith")).toBeDefined();
    });

    // Select Alice Johnson
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(checkboxes[0]);

    // Commit import
    const confirmBtn = screen.getByText("Confirm and Commit Import");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(postMultipartSpy).toHaveBeenCalledWith(
        "/api/v1/crm/import/confirm",
        expect.any(FormData)
      );
    });

    // Verify form data sent
    const calledFormData = postMultipartSpy.mock.calls[postMultipartSpy.mock.calls.length - 1][1] as FormData;
    expect(calledFormData.get("distribution_mode")).toBe("selected_reps");
    expect(calledFormData.get("distribution_strategy")).toBe("round_robin");
    expect(calledFormData.get("selected_salesperson_ids")).toContain("rep-1");
  });

  it("enforces salesperson view and forced self-assignment in Step 4 without exposing team distribution or unassigned options", async () => {
    mockAuth.isSuperAdmin = false;
    mockAuth.permissions = ["crm.leads.import", "crm.leads.view"];
    mockAuth.roles = ["salesperson"];
    mockAuth.profile = {
      id: "sp-john-123",
      username: "john",
      full_name: "John Salesperson",
      roles: ["salesperson"],
    };

    const postMultipartSpy = vi.spyOn(apiModule, "apiPostMultipart");

    renderComponent();

    // Select file
    const file = new File(["Name,Number,Campaign\nProspect,9876543210,Campaign_A\n"], "john_leads.csv", {
      type: "text/csv",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("john_leads.csv")).toBeDefined());
    fireEvent.click(screen.getByText("Continue to Pipeline Selection \u2192"));

    await waitFor(() => expect(screen.getByText(/New Inbound Leads/)).toBeDefined());
    fireEvent.click(screen.getByText("Validate & Preview Leads \u2192"));

    await waitFor(() => expect(screen.getByText("Proceed to Confirmation \u2192")).toBeDefined());
    fireEvent.click(screen.getByText("Proceed to Confirmation \u2192"));

    // Step 4: Salesperson should only see self-assignment card
    await waitFor(() => {
      expect(screen.getByText("Confirm Lead Import")).toBeDefined();
      expect(screen.getByText("Lead Assignment")).toBeDefined();
      expect(screen.getByText(/Assigned Directly to You \(John Salesperson\)/i)).toBeDefined();
    });

    // Verify team distribution and unassigned options are NOT exposed to salesperson
    expect(screen.queryByText(/Automatic Distribution/i)).toBeNull();
    expect(screen.queryByText(/Distribute Across Selected Representatives/i)).toBeNull();
    expect(screen.queryByText(/Assign All Leads to Single Representative/i)).toBeNull();
    expect(screen.queryByText(/Import Without Assignment/i)).toBeNull();

    // Confirm import
    const confirmBtn = screen.getByText("Confirm and Commit Import");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(postMultipartSpy).toHaveBeenCalledWith(
        "/api/v1/crm/import/confirm",
        expect.any(FormData)
      );
    });

    // Verify form data forces single_salesperson self-assignment
    const calledFormData = postMultipartSpy.mock.calls[postMultipartSpy.mock.calls.length - 1][1] as FormData;
    expect(calledFormData.get("distribution_mode")).toBe("single_salesperson");
    expect(calledFormData.get("target_salesperson_id")).toBe("sp-john-123");
  });

  it("View Imported Leads button closes the modal and triggers refresh callback", async () => {
    const onCloseMock = vi.fn();
    const onSuccessMock = vi.fn();

    renderComponent({ embedded: true, onClose: onCloseMock, onSuccess: onSuccessMock });

    // Select file & advance to step 5
    const file = new File(["Name,Number,Campaign\nRohit,9876543210,Camp\n"], "leads.csv", { type: "text/csv" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("leads.csv")).toBeDefined());
    fireEvent.click(screen.getByText("Continue to Pipeline Selection \u2192"));

    await waitFor(() => expect(screen.getByText(/New Inbound Leads/)).toBeDefined());
    fireEvent.click(screen.getByText("Validate & Preview Leads \u2192"));

    await waitFor(() => expect(screen.getByText("Proceed to Confirmation \u2192")).toBeDefined());
    fireEvent.click(screen.getByText("Proceed to Confirmation \u2192"));

    await waitFor(() => expect(screen.getByText("Confirm and Commit Import")).toBeDefined());
    fireEvent.click(screen.getByText("Confirm and Commit Import"));

    await waitFor(() => expect(screen.getByText("View Imported Leads")).toBeDefined());

    // Click "View Imported Leads"
    fireEvent.click(screen.getByText("View Imported Leads"));

    // Verify onClose was called to dismiss modal, and onSuccess was called to refresh leads
    expect(onCloseMock).toHaveBeenCalled();
    expect(onSuccessMock).toHaveBeenCalled();
  });

  it("Import Another CSV resets wizard completely and returns to Step 1 without resubmitting", async () => {
    const postMultipartSpy = vi.spyOn(apiModule, "apiPostMultipart");
    renderComponent();

    // Advance to step 5
    const file = new File(["Name,Number,Campaign\nRohit,9876543210,Camp\n"], "leads.csv", { type: "text/csv" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("leads.csv")).toBeDefined());
    fireEvent.click(screen.getByText("Continue to Pipeline Selection \u2192"));

    await waitFor(() => expect(screen.getByText(/New Inbound Leads/)).toBeDefined());
    fireEvent.click(screen.getByText("Validate & Preview Leads \u2192"));

    await waitFor(() => expect(screen.getByText("Proceed to Confirmation \u2192")).toBeDefined());
    fireEvent.click(screen.getByText("Proceed to Confirmation \u2192"));

    await waitFor(() => expect(screen.getByText("Confirm and Commit Import")).toBeDefined());
    fireEvent.click(screen.getByText("Confirm and Commit Import"));

    await waitFor(() => expect(screen.getByText("Import Another CSV")).toBeDefined());

    const callsBefore = postMultipartSpy.mock.calls.length;

    // Click "Import Another CSV"
    fireEvent.click(screen.getByText("Import Another CSV"));

    // Verify returned to Step 1
    await waitFor(() => {
      expect(screen.getByText("1. Choose CSV")).toBeDefined();
      expect(screen.getByText(/Click to browse or drop CSV here/i)).toBeDefined();
      expect(screen.queryByText("Import Successful")).toBeNull();
    });

    // Verify clicking does not submit the import again
    expect(postMultipartSpy.mock.calls.length).toBe(callsBefore);
  });

  it("View Batch History switches to the existing history tab", async () => {
    renderComponent();

    // Advance to step 5
    const file = new File(["Name,Number,Campaign\nRohit,9876543210,Camp\n"], "leads.csv", { type: "text/csv" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("leads.csv")).toBeDefined());
    fireEvent.click(screen.getByText("Continue to Pipeline Selection \u2192"));

    await waitFor(() => expect(screen.getByText(/New Inbound Leads/)).toBeDefined());
    fireEvent.click(screen.getByText("Validate & Preview Leads \u2192"));

    await waitFor(() => expect(screen.getByText("Proceed to Confirmation \u2192")).toBeDefined());
    fireEvent.click(screen.getByText("Proceed to Confirmation \u2192"));

    await waitFor(() => expect(screen.getByText("Confirm and Commit Import")).toBeDefined());
    fireEvent.click(screen.getByText("Confirm and Commit Import"));

    await waitFor(() => expect(screen.getByText("View Batch History")).toBeDefined());

    // Click "View Batch History"
    fireEvent.click(screen.getByText("View Batch History"));

    // Verify history tab content is active
    await waitFor(() => {
      expect(screen.getByText("Import Batches")).toBeDefined();
      expect(screen.getByText("Previous October Batch")).toBeDefined();
    });
  });

  it("displays Partial Success with correct counts and compact failed rows table when some rows fail", async () => {
    vi.spyOn(apiModule, "apiPostMultipart").mockImplementation((url: string) => {
      if (url.includes("/crm/import/preview")) {
        return Promise.resolve({ data: MOCK_PREVIEW_RESPONSE as any, meta: undefined });
      }
      if (url.includes("/crm/import/confirm")) {
        return Promise.resolve({
          data: {
            ...MOCK_CONFIRM_RESPONSE,
            status: "completed",
            display_status: "Partial",
            total_rows: 4,
            success_count: 2,
            duplicate_skipped_count: 1,
            failed_count: 1,
            sanitized_error_summary: JSON.stringify([
              { row: 4, outcome: "Invalid Field", reason: "Invalid phone number format", action: "Provide a 10-digit mobile number." }
            ]),
          } as any,
          meta: undefined,
        });
      }
      return Promise.resolve({ data: {} as any, meta: undefined });
    });

    renderComponent();

    // Advance to step 5
    const file = new File(["Name,Number,Campaign\nRohit,9876543210,Camp\n"], "leads.csv", { type: "text/csv" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("leads.csv")).toBeDefined());
    fireEvent.click(screen.getByText("Continue to Pipeline Selection \u2192"));

    await waitFor(() => expect(screen.getByText(/New Inbound Leads/)).toBeDefined());
    fireEvent.click(screen.getByText("Validate & Preview Leads \u2192"));

    await waitFor(() => expect(screen.getByText("Proceed to Confirmation \u2192")).toBeDefined());
    fireEvent.click(screen.getByText("Proceed to Confirmation \u2192"));

    await waitFor(() => expect(screen.getByText("Confirm and Commit Import")).toBeDefined());
    fireEvent.click(screen.getByText("Confirm and Commit Import"));

    // Step 5: Verify Partial Success
    await waitFor(() => {
      expect(screen.getByText("Partial Success")).toBeDefined();
      expect(screen.getByText("Import Partially Completed")).toBeDefined();
      expect(screen.getByText("Total Rows")).toBeDefined();
      expect(screen.getByText("Leads Created")).toBeDefined();
      expect(screen.getByText("Duplicates Skipped")).toBeDefined();
      expect(screen.getByText("Failed Rows")).toBeDefined();
      expect(screen.getByText("Failed Rows Breakdown (1)")).toBeDefined();
      expect(screen.getByText("Row 4")).toBeDefined();
      expect(screen.getByText("Invalid phone number format")).toBeDefined();
      expect(screen.getByText("Provide a 10-digit mobile number.")).toBeDefined();

      // Ensure no assigned/unassigned cards
      expect(screen.queryByText("Assigned")).toBeNull();
      expect(screen.queryByText("Unassigned")).toBeNull();
    });
  });
});

