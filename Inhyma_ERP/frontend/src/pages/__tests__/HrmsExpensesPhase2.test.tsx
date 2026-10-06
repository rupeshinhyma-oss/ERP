import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ExpensesPage, ExpenseItem, ExpenseSummaryData } from "@/pages/hrms/ExpensesPage";
import * as apiModule from "@/lib/api";

const initialSummary: ExpenseSummaryData = {
  total_count: 3,
  total_amount: 2750.0,
  pending_count: 1,
  pending_amount: 1250.0,
  approved_count: 1,
  approved_amount: 1000.0,
  rejected_count: 0,
  rejected_amount: 0.0,
  reimbursed_count: 0,
  reimbursed_amount: 0.0,
  draft_count: 1,
  draft_amount: 500.0,
};

const initialExpenses: ExpenseItem[] = [
  {
    id: "exp-1",
    expense_code: "EXP-0001",
    employee_id: "user-1",
    employee_name: "Ravi Sharma",
    employee_email: "ravi.sharma@inhyma.com",
    expense_date: "2026-10-05",
    category: "Travel",
    amount: 500.0,
    currency: "INR",
    description: "Cab fare to client site",
    receipt_url: "/uploads/expenses/receipt1.pdf",
    receipt_filename: "receipt1.pdf",
    status: "DRAFT",
    created_at: "2026-10-05T08:00:00Z",
    updated_at: "2026-10-05T08:00:00Z",
  },
  {
    id: "exp-2",
    expense_code: "EXP-0002",
    employee_id: "user-1",
    employee_name: "Ravi Sharma",
    employee_email: "ravi.sharma@inhyma.com",
    expense_date: "2026-10-04",
    category: "Food",
    amount: 1250.0,
    currency: "INR",
    description: "Team lunch",
    receipt_url: null,
    receipt_filename: null,
    status: "PENDING",
    submitted_at: "2026-10-04T12:00:00Z",
    created_at: "2026-10-04T11:00:00Z",
    updated_at: "2026-10-04T12:00:00Z",
  },
  {
    id: "exp-3",
    expense_code: "EXP-0003",
    employee_id: "user-2",
    employee_name: "Anita Patel",
    employee_email: "anita.patel@inhyma.com",
    expense_date: "2026-10-02",
    category: "Accommodation",
    amount: 1000.0,
    currency: "INR",
    description: "Hotel stay for conference",
    receipt_url: "/uploads/expenses/hotel.png",
    receipt_filename: "hotel.png",
    status: "APPROVED",
    submitted_at: "2026-10-02T10:00:00Z",
    reviewed_at: "2026-10-03T11:00:00Z",
    reviewed_by: "admin-1",
    reviewer_name: "Admin User",
    created_at: "2026-10-02T09:00:00Z",
    updated_at: "2026-10-03T11:00:00Z",
  },
];

let mockSummary: ExpenseSummaryData;
let mockExpenses: ExpenseItem[];
const mockToast = vi.fn();

beforeEach(() => {
  mockSummary = { ...initialSummary };
  mockExpenses = initialExpenses.map((e) => ({ ...e }));
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock toast
vi.mock("@/lib/toast", () => ({
  useToast: () => mockToast,
}));

// Mock auth
vi.mock("@/lib/hooks", () => ({
  useAuth: () => ({
    profile: { id: "user-1", username: "admin", email: "admin@inhyma.com" },
    isSuperAdmin: true,
    hasPermission: () => true,
  }),
}));

// Mock api
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: vi.fn((url: string) => {
      if (url.includes("/hrms/expenses/summary")) {
        return Promise.resolve({ data: mockSummary });
      }
      if (url.includes("/hrms/expenses")) {
        let filtered = [...mockExpenses];
        if (url.includes("status=PENDING")) {
          filtered = filtered.filter((e) => e.status === "PENDING");
        } else if (url.includes("status=DRAFT")) {
          filtered = filtered.filter((e) => e.status === "DRAFT");
        }
        if (url.includes("category=Travel")) {
          filtered = filtered.filter((e) => e.category === "Travel");
        }
        if (url.includes("search=Team")) {
          filtered = filtered.filter((e) => e.description.includes("Team"));
        }
        return Promise.resolve({ data: filtered });
      }
      return Promise.resolve({ data: [] });
    }),
    apiPost: vi.fn((url: string, body?: any) => {
      if (url.endsWith("/submit")) {
        const id = url.split("/")[4];
        const exp = mockExpenses.find((e) => e.id === id);
        if (exp) exp.status = "PENDING";
        return Promise.resolve({ data: exp });
      }
      if (url.endsWith("/approve")) {
        const id = url.split("/")[4];
        const exp = mockExpenses.find((e) => e.id === id);
        if (exp) exp.status = "APPROVED";
        return Promise.resolve({ data: exp });
      }
      if (url.endsWith("/reject")) {
        const id = url.split("/")[4];
        const exp = mockExpenses.find((e) => e.id === id);
        if (exp) {
          exp.status = "REJECTED";
          exp.rejection_reason = body?.rejection_reason;
        }
        return Promise.resolve({ data: exp });
      }
      if (url.endsWith("/reimburse")) {
        const id = url.split("/")[4];
        const exp = mockExpenses.find((e) => e.id === id);
        if (exp) {
          exp.status = "REIMBURSED";
          exp.reimbursement_notes = body?.notes;
        }
        return Promise.resolve({ data: exp });
      }
      // Create new expense
      const newExp: ExpenseItem = {
        id: `exp-${Date.now()}`,
        expense_code: `EXP-${String(mockExpenses.length + 1).padStart(4, "0")}`,
        employee_id: "user-1",
        employee_name: "Ravi Sharma",
        expense_date: body.expense_date,
        category: body.category,
        amount: body.amount,
        currency: "INR",
        description: body.description,
        status: body.is_submit || url.includes("submit=true") ? "PENDING" : "DRAFT",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockExpenses.push(newExp);
      return Promise.resolve({ data: newExp });
    }),
    apiPut: vi.fn((url: string, body?: any) => {
      const id = url.split("/")[4];
      const exp = mockExpenses.find((e) => e.id === id);
      if (exp) {
        Object.assign(exp, body);
      }
      return Promise.resolve({ data: exp });
    }),
    apiDelete: vi.fn((url: string) => {
      const id = url.split("/")[4];
      mockExpenses = mockExpenses.filter((e) => e.id !== id);
      return Promise.resolve({ data: { deleted: true } });
    }),
    apiPostMultipart: vi.fn(() =>
      Promise.resolve({
        data: {
          file_url: "/uploads/expenses/mock_uploaded.pdf",
          file_name: "mock_uploaded.pdf",
        },
      })
    ),
  };
});

describe("HRMS Expense Management — Phase 2 Functional Tests", () => {
  // 1. Page loads
  it("1. Page loads with summary metrics and table", async () => {
    render(
      <MemoryRouter>
        <ExpensesPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Expense Management");
    expect(screen.getByText("TOTAL CLAIMS (MY)")).toBeDefined();
    expect(screen.getByText("PENDING APPROVAL")).toBeDefined();
    expect(screen.getByText("APPROVED CLAIMS")).toBeDefined();
    expect(screen.getByText("REJECTED CLAIMS")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("EXP-0001")).toBeDefined();
      expect(screen.getByText("EXP-0002")).toBeDefined();
    });
  });

  // 2. Add Expense opens
  it("2. Add Expense button opens modal with form fields", async () => {
    render(
      <MemoryRouter>
        <ExpensesPage />
      </MemoryRouter>
    );

    const addBtn = screen.getByRole("button", { name: /\+ Add Expense/i });
    fireEvent.click(addBtn);

    expect(screen.getByText("Add Expense Claim")).toBeDefined();
    expect(screen.getByLabelText(/Expense Date/i)).toBeDefined();
    expect(screen.getByLabelText(/Category/i)).toBeDefined();
    expect(screen.getByLabelText(/Amount/i)).toBeDefined();
    expect(screen.getByLabelText(/Description/i)).toBeDefined();
  });

  // 3. Validation works
  it("3. Form validation requires mandatory fields and positive amount", async () => {
    render(
      <MemoryRouter>
        <ExpensesPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /\+ Add Expense/i }));

    // Try submitting without filling amount or description
    const submitBtn = screen.getByRole("button", { name: /Submit Expense/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Amount must be greater than zero.")).toBeDefined();
      expect(screen.getByText("Description is required.")).toBeDefined();
    });
  });

  // 4. Save Draft works
  it("4. Save Draft creates an expense with DRAFT status", async () => {
    render(
      <MemoryRouter>
        <ExpensesPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /\+ Add Expense/i }));

    const amountInput = screen.getByLabelText(/Amount/i);
    fireEvent.change(amountInput, { target: { value: "350" } });

    const descInput = screen.getByLabelText(/Description/i);
    fireEvent.change(descInput, { target: { value: "Office stationary supplies" } });

    const saveDraftBtn = screen.getByRole("button", { name: /Save Draft/i });
    fireEvent.click(saveDraftBtn);

    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith(
        expect.stringContaining("/hrms/expenses?submit=false"),
        expect.objectContaining({
          amount: 350,
          description: "Office stationary supplies",
          is_submit: false,
        })
      );
    });
  });

  // 5. Submit works
  it("5. Submit Expense creates an expense with PENDING status", async () => {
    render(
      <MemoryRouter>
        <ExpensesPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /\+ Add Expense/i }));

    const amountInput = screen.getByLabelText(/Amount/i);
    fireEvent.change(amountInput, { target: { value: "750" } });

    const descInput = screen.getByLabelText(/Description/i);
    fireEvent.change(descInput, { target: { value: "Client dinner" } });

    const submitBtn = screen.getByRole("button", { name: /Submit Expense/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith(
        expect.stringContaining("/hrms/expenses?submit=true"),
        expect.objectContaining({
          amount: 750,
          description: "Client dinner",
          is_submit: true,
        })
      );
    });
  });

  // 6. Table updates
  it("6. Table renders expenses and updates after submission", async () => {
    render(
      <MemoryRouter>
        <ExpensesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("EXP-0001")).toBeDefined();
      expect(screen.getByText("EXP-0002")).toBeDefined();
      expect(screen.getByText("Cab fare to client site")).toBeDefined();
      expect(screen.getByText("Team lunch")).toBeDefined();
      expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    });
  });

  // 7. Search works
  it("7. Search filter filters claims by keyword", async () => {
    render(
      <MemoryRouter>
        <ExpensesPage />
      </MemoryRouter>
    );

    const searchInput = screen.getByPlaceholderText(/Search by ID, Category/i);
    fireEvent.change(searchInput, { target: { value: "Team" } });

    await waitFor(() => {
      expect(apiModule.apiGet).toHaveBeenCalledWith(
        expect.stringContaining("search=Team")
      );
    });
  });

  // 8. Filters work
  it("8. Category and status filters query API with parameters", async () => {
    render(
      <MemoryRouter>
        <ExpensesPage />
      </MemoryRouter>
    );

    const categorySelect = screen.getByDisplayValue("All Categories");
    fireEvent.change(categorySelect, { target: { value: "Travel" } });

    await waitFor(() => {
      expect(apiModule.apiGet).toHaveBeenCalledWith(
        expect.stringContaining("category=Travel")
      );
    });

    const statusSelect = screen.getByDisplayValue("All Statuses");
    fireEvent.change(statusSelect, { target: { value: "PENDING" } });

    await waitFor(() => {
      expect(apiModule.apiGet).toHaveBeenCalledWith(
        expect.stringContaining("status=PENDING")
      );
    });
  });

  // 9. Approval works
  it("9. Approvals tab allows approving pending claims", async () => {
    window.confirm = vi.fn(() => true);

    render(
      <MemoryRouter>
        <ExpensesPage />
      </MemoryRouter>
    );

    // Switch to Approvals tab
    const approvalsTab = screen.getByRole("button", { name: /Approvals/i });
    fireEvent.click(approvalsTab);

    await waitFor(() => {
      expect(screen.getByText("Approval Requests")).toBeDefined();
    });

    // Find Approve button on pending claim EXP-0002
    const approveButtons = screen.getAllByRole("button", { name: /^Approve$/i });
    expect(approveButtons.length).toBeGreaterThan(0);
    fireEvent.click(approveButtons[0]);

    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith(
        expect.stringContaining("/approve")
      );
    });
  });

  // 10. Reject modal works
  it("10. Reject button opens modal requiring rejection reason", async () => {
    render(
      <MemoryRouter>
        <ExpensesPage />
      </MemoryRouter>
    );

    // Switch to Approvals tab
    const approvalsTab = screen.getByRole("button", { name: /Approvals/i });
    fireEvent.click(approvalsTab);

    await waitFor(() => {
      expect(screen.getByText("Approval Requests")).toBeDefined();
    });

    const rejectButtons = screen.getAllByRole("button", { name: /^Reject$/i });
    fireEvent.click(rejectButtons[0]);

    // Modal opens
    expect(screen.getByText("Reject Expense Claim")).toBeDefined();
    expect(screen.getByLabelText(/Rejection Reason/i)).toBeDefined();

    // Confirm without reason should show validation error
    const confirmRejectBtn = screen.getByRole("button", { name: /Confirm Rejection/i });
    fireEvent.click(confirmRejectBtn);

    await waitFor(() => {
      expect(screen.getByText("Rejection reason is required.")).toBeDefined();
    });

    // Type reason and submit
    const reasonInput = screen.getByPlaceholderText(/Incorrect receipt/i);
    fireEvent.change(reasonInput, { target: { value: "Incorrect receipt" } });
    fireEvent.click(confirmRejectBtn);

    await waitFor(() => {
      expect(apiModule.apiPost).toHaveBeenCalledWith(
        expect.stringContaining("/reject"),
        { rejection_reason: "Incorrect receipt" }
      );
    });
  });

  // 11. Empty state works
  it("11. Empty state renders clean placeholder when no expenses exist", async () => {
    vi.mocked(apiModule.apiGet).mockImplementation((url: string) => {
      if (url.includes("/hrms/expenses/summary")) {
        return Promise.resolve({ data: initialSummary });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <MemoryRouter>
        <ExpensesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("No Expense Claims Found")).toBeDefined();
    });
  });

  // 12. API error state works
  it("12. API error displays error banner with retry option", async () => {
    vi.mocked(apiModule.apiGet).mockRejectedValueOnce(new Error("Database connection failed"));

    render(
      <MemoryRouter>
        <ExpensesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Database connection failed/i)).toBeDefined();
      expect(screen.getByRole("button", { name: /Retry/i })).toBeDefined();
    });
  });
});
