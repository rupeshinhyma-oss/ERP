import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CrmLeadsPage, CrmLeadListItem } from "../crm/CrmLeadsPage";
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

const MOCK_LEADS: CrmLeadListItem[] = [
  {
    id: "lead-1",
    lead_code: "LD-2026-001",
    name: "Acme Corporation",
    original_phone: "+919876543210",
    email: "contact@acme.com",
    company_name: "Acme Corp",
    campaign: "Q3 Inbound",
    source_type: "company_campaign",
    pipeline_id: "pipe-1",
    pipeline_name: "Direct Sales",
    stage_id: "stage-1",
    stage_name: "New Prospect",
    assigned_to: "user-1",
    assigned_salesperson_name: "John Doe",
    status: "new",
    priority: "high",
    assignment_status: "assigned",
    created_at: "2026-10-12T10:00:00Z",
  },
  {
    id: "lead-2",
    lead_code: "LD-2026-002",
    name: "Stark Industries",
    original_phone: "+919876543211",
    email: "tony@stark.com",
    company_name: "Stark Industries",
    campaign: "Webinar Event",
    source_type: "import",
    pipeline_id: "pipe-1",
    pipeline_name: "Direct Sales",
    stage_id: "stage-1",
    stage_name: "New Prospect",
    assigned_to: null,
    status: "new",
    priority: "medium",
    assignment_status: "unassigned",
    created_at: "2026-10-13T11:00:00Z",
  },
];

describe("CrmLeadsPage Deep Linking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(true);
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "admin-1",
      full_name: "Admin User",
      roles: ["admin"],
      permissions: ["*"],
    } as any);

    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/crm/pipelines")) {
        return Promise.resolve({ data: [{ id: "pipe-1", name: "Direct Sales" }] });
      }
      if (url.includes("/crm/distribution/salespeople")) {
        return Promise.resolve({ data: [] });
      }
      if (url.includes("/crm/leads/lead-external")) {
        return Promise.resolve({
          data: {
            id: "lead-external",
            lead_code: "LD-2026-EXT",
            name: "External Enterprises",
            original_phone: "+919123456780",
            email: "external@enterprises.com",
            company_name: "External Enterprises",
            pipeline_id: "pipe-1",
            stage_id: "stage-1",
            stage_name: "New Prospect",
            status: "new",
            priority: "medium",
            created_at: "2026-10-15T10:00:00Z",
          },
        });
      }
      if (url.includes("/crm/leads/forbidden-id")) {
        const error: any = new Error("Forbidden access");
        error.response = { status: 403, data: { detail: "You do not have permission to view this lead." } };
        return Promise.reject(error);
      }
      if (url.includes("/crm/leads/missing-id")) {
        const error: any = new Error("Not Found");
        error.response = { status: 404, data: { detail: "Lead missing-id not found." } };
        return Promise.reject(error);
      }
      if (url.match(/\/crm\/leads\/[^?]+$/)) {
        const id = url.split("/crm/leads/")[1];
        const match = MOCK_LEADS.find((l) => l.id === id);
        return Promise.resolve({ data: match || MOCK_LEADS[0] });
      }
      if (url.includes("/crm/leads")) {
        return Promise.resolve({
          data: {
            items: MOCK_LEADS,
            total: MOCK_LEADS.length,
            page: 1,
            page_size: 25,
            total_pages: 1,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("opens lead drawer automatically when ?leadId=<uuid> is present in URL", async () => {
    render(
      <MemoryRouter initialEntries={["/crm/leads?leadId=lead-1"]}>
        <CrmLeadsPage />
      </MemoryRouter>
    );

    // Wait for the drawer title with lead-1 information
    await waitFor(() => {
      const titleEl = document.getElementById("drawer-lead-title");
      expect(titleEl).toBeTruthy();
      expect(titleEl?.textContent).toContain("Acme Corporation");
    });

    // Check that drawer tabs are rendered
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Overview/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Quotations/i })).toBeTruthy();
    });
  });

  it("opens lead drawer automatically when ?id=<uuid> is used for deep linking", async () => {
    render(
      <MemoryRouter initialEntries={["/crm/leads?id=lead-external"]}>
        <CrmLeadsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const titleEl = document.getElementById("drawer-lead-title");
      expect(titleEl).toBeTruthy();
      expect(titleEl?.textContent).toContain("External Enterprises");
    });
  });

  it("handles missing record ID gracefully with an error toast", async () => {
    render(
      <MemoryRouter initialEntries={["/crm/leads?leadId=missing-id"]}>
        <CrmLeadsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringMatching(/not found|permission/i),
        "error"
      );
    });
  });

  it("handles 403 permission error on deep link gracefully", async () => {
    render(
      <MemoryRouter initialEntries={["/crm/leads?leadId=forbidden-id"]}>
        <CrmLeadsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringMatching(/permission|Forbidden/i),
        "error"
      );
    });
  });

  it("preserves existing ?import=open behavior", async () => {
    render(
      <MemoryRouter initialEntries={["/crm/leads?import=open"]}>
        <CrmLeadsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("crm-import-modal-container")).toBeTruthy();
    });
  });
});
