import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { CrmLeadsPage } from "../crm/CrmLeadsPage";
import * as apiModule from "@/lib/api";
import { Auth } from "@/lib/auth";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

const mockToast = vi.fn();
vi.mock("@/lib/toast", () => ({
  useToast: () => mockToast,
}));

const TEST_PIPELINES = [
  { id: "pipe-1", name: "Primary Sales Pipeline" },
  { id: "pipe-2", name: "Enterprise Pipeline" },
];

const PIPE_1_STAGES = [
  { id: "st-1-1", pipeline_id: "pipe-1", name: "New Lead", stage_order: 1, stage_type: "open", is_initial: true, is_active: true },
  { id: "st-1-2", pipeline_id: "pipe-1", name: "Qualified", stage_order: 2, stage_type: "open", is_initial: false, is_active: true },
];

const PIPE_2_STAGES = [
  { id: "st-2-1", pipeline_id: "pipe-2", name: "Inbound Discovery", stage_order: 1, stage_type: "open", is_initial: true, is_active: true },
  { id: "st-2-2", pipeline_id: "pipe-2", name: "POC Review", stage_order: 2, stage_type: "open", is_initial: false, is_active: true },
];

const TEST_SALESPEOPLE = [
  { user_id: "user-1", username: "rep1", display_name: "Alice Rep", active_lead_count: 5 },
  { user_id: "user-2", username: "rep2", display_name: "Bob Rep", active_lead_count: 3 },
];

describe("CRM Manual Lead Creation Flow (UI & Modal Verification)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();

    // Default admin user
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(true);
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "admin-user-id",
      username: "admin",
      roles: ["super_admin"],
    } as any);

    // Mock API requests
    vi.spyOn(apiModule, "apiGet").mockImplementation(async (url: string) => {
      if (url.includes("/api/v1/crm/pipelines/pipe-1")) {
        return { data: { id: "pipe-1", name: "Primary Sales Pipeline", stages: PIPE_1_STAGES } };
      }
      if (url.includes("/api/v1/crm/pipelines/pipe-2")) {
        return { data: { id: "pipe-2", name: "Enterprise Pipeline", stages: PIPE_2_STAGES } };
      }
      if (url.includes("/api/v1/crm/pipelines")) {
        return { data: TEST_PIPELINES };
      }
      if (url.includes("salespeople")) {
        return { data: TEST_SALESPEOPLE };
      }
      if (url.includes("/api/v1/crm/leads")) {
        return { data: { items: [], total: 0, page: 1, page_size: 25, total_pages: 1 } };
      }
      return { data: {} };
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("opens create lead modal with initial fields populated", async () => {
    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    // Wait for initial pipelines to load
    await waitFor(() => {
      expect(apiModule.apiGet).toHaveBeenCalledWith(expect.stringContaining("/api/v1/crm/pipelines"));
    });

    // Find and click the + Add Lead button
    const addLeadButtons = screen.getAllByRole("button", { name: /\+ Add Lead/i });
    expect(addLeadButtons.length).toBeGreaterThan(0);
    fireEvent.click(addLeadButtons[0]);

    // Modal dialog should be displayed
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Create New CRM Lead")).toBeTruthy();

    // Required fields are present
    expect(screen.getByTestId("create-lead-name")).toBeTruthy();
    expect(screen.getByTestId("create-lead-phone")).toBeTruthy();
    expect(screen.getByTestId("create-lead-email")).toBeTruthy();
    expect(screen.getByTestId("create-lead-company")).toBeTruthy();
    expect(screen.getByTestId("create-lead-pipeline")).toBeTruthy();
    expect(screen.getByTestId("create-lead-stage")).toBeTruthy();
    expect(screen.getByTestId("create-lead-priority")).toBeTruthy();
    expect(screen.getByTestId("create-lead-campaign")).toBeTruthy();
    expect(screen.getByTestId("create-lead-notes")).toBeTruthy();
    expect(screen.getByTestId("create-lead-submit-btn")).toBeTruthy();
  });

  it("submits lead creation payload successfully for admin", async () => {
    const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      data: {
        id: "created-lead-123",
        lead_code: "LD-2026-999",
        name: "Acme Healthcare",
      },
    } as any);

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(apiModule.apiGet).toHaveBeenCalledWith(expect.stringContaining("/api/v1/crm/pipelines"));
    });

    const addLeadBtn = screen.getAllByRole("button", { name: /\+ Add Lead/i })[0];
    fireEvent.click(addLeadBtn);

    await screen.findByRole("dialog");

    // Fill the form
    fireEvent.change(screen.getByTestId("create-lead-name"), { target: { value: "Dr. Suresh Verma" } });
    fireEvent.change(screen.getByTestId("create-lead-phone"), { target: { value: "9876543210" } });
    fireEvent.change(screen.getByTestId("create-lead-email"), { target: { value: "suresh@acme.com" } });
    fireEvent.change(screen.getByTestId("create-lead-company"), { target: { value: "Acme Healthcare Ltd" } });
    fireEvent.change(screen.getByTestId("create-lead-campaign"), { target: { value: "Direct Search" } });
    fireEvent.change(screen.getByTestId("create-lead-notes"), { target: { value: "Enterprise customer request" } });

    // Submit form
    fireEvent.click(screen.getByTestId("create-lead-submit-btn"));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/api/v1/crm/leads", expect.objectContaining({
        contact_name: "Dr. Suresh Verma",
        phone: "9876543210",
        email: "suresh@acme.com",
        company_name: "Acme Healthcare Ltd",
        campaign: "Direct Search",
        notes: "Enterprise customer request",
      }));
    });

    expect(mockToast).toHaveBeenCalledWith("Lead created successfully!", "success");
  });

  it("displays duplicate phone conflict message clearly when conflict error is returned", async () => {
    vi.spyOn(apiModule, "apiPost").mockRejectedValue({
      status: 409,
      data: {
        message: "A lead with phone '+919876543210' already exists (Lead Code: LD-2026-001). Duplicate lead creation prevented.",
      },
    });

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(apiModule.apiGet).toHaveBeenCalledWith(expect.stringContaining("/api/v1/crm/pipelines"));
    });

    fireEvent.click(screen.getAllByRole("button", { name: /\+ Add Lead/i })[0]);
    await screen.findByRole("dialog");

    fireEvent.change(screen.getByTestId("create-lead-name"), { target: { value: "Duplicate Lead" } });
    fireEvent.change(screen.getByTestId("create-lead-phone"), { target: { value: "9876543210" } });

    fireEvent.click(screen.getByTestId("create-lead-submit-btn"));

    // Verify alert message is displayed in modal
    const alert = await screen.findByRole("alert");
    expect(alert).toBeTruthy();
    expect(alert.textContent).toMatch(/already exists/i);
    expect(alert.textContent).toMatch(/Duplicate lead creation prevented/i);
  });

  it("shows self-assigned indicator for salespeople and omits assignee selection", async () => {
    // Switch to salesperson
    vi.spyOn(Auth, "hasPermission").mockImplementation((perm?: string | null) => perm === "crm.leads.view");
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(false);
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "rep-user-id",
      username: "salesperson1",
      roles: ["salesperson"],
    } as any);

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(apiModule.apiGet).toHaveBeenCalledWith(expect.stringContaining("/api/v1/crm/pipelines"));
    });

    fireEvent.click(screen.getAllByRole("button", { name: /\+ Add Lead/i })[0]);
    await screen.findByRole("dialog");

    // Assignee dropdown should NOT be present; self-assigned banner should be visible
    expect(screen.queryByTestId("create-lead-assigned-to")).toBeNull();
    const selfAssigned = screen.getByTestId("create-lead-self-assigned");
    expect(selfAssigned).toBeTruthy();
    expect(selfAssigned.textContent).toMatch(/Self-Assigned/i);
  });
});
