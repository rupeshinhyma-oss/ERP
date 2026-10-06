import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { IconCreditCard, IconFileText, IconCoins, IconReceipt } from "@/components/icons";
import { apiDelete, apiGet, apiPost, apiPostMultipart, apiPut, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import "./hrms.css";

// ===========================================================================
// Type Definitions
// ===========================================================================

export type ExpenseStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "REIMBURSED";

export interface ExpenseItem {
  id: string;
  expense_code: string;
  employee_id: string;
  employee_name?: string | null;
  employee_email?: string | null;
  employee_code?: string | null;
  expense_date: string;
  category: string;
  amount: number;
  currency: string;
  description: string;
  location_id?: string | null;
  receipt_url?: string | null;
  receipt_filename?: string | null;
  status: ExpenseStatus;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  reviewer_name?: string | null;
  rejection_reason?: string | null;
  reimbursed_at?: string | null;
  reimbursed_by?: string | null;
  reimburser_name?: string | null;
  reimbursement_notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseSummaryData {
  total_count: number;
  total_amount: number;
  pending_count: number;
  pending_amount: number;
  approved_count: number;
  approved_amount: number;
  rejected_count: number;
  rejected_amount: number;
  reimbursed_count: number;
  reimbursed_amount: number;
  draft_count: number;
  draft_amount: number;
}

export const EXPENSE_CATEGORIES = [
  "Travel",
  "Food",
  "Accommodation",
  "Transport",
  "Office Supplies",
  "Communication",
  "Other",
] as const;

const ALLOWED_RECEIPT_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "pdf"];
const MAX_RECEIPT_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

// ===========================================================================
// Main Expense Management Component
// ===========================================================================

export function ExpensesPage() {
  const toast = useToast();
  const { profile, isSuperAdmin, hasPermission } = useAuth();

  // RBAC: Check approval and admin permissions
  const canApprove = useMemo(() => {
    return Boolean(
      isSuperAdmin ||
      hasPermission?.("*") ||
      hasPermission?.("hrms.manage") ||
      hasPermission?.("hrms.approve") ||
      hasPermission?.("hrms:admin") ||
      hasPermission?.("hrms:approval") ||
      hasPermission?.("hrms:approve") ||
      hasPermission?.("hrms.expense.approve") ||
      (profile?.username && (profile.username.toLowerCase() === "admin" || profile.username.toLowerCase().startsWith("admin")))
    );
  }, [isSuperAdmin, hasPermission, profile]);

  // View state: 'my' (Self-Service) vs 'approvals' (Admin / Manager Approval)
  const [viewMode, setViewMode] = useState<"my" | "approvals">("my");

  // Summary Metrics
  const [summary, setSummary] = useState<ExpenseSummaryData>({
    total_count: 0,
    total_amount: 0,
    pending_count: 0,
    pending_amount: 0,
    approved_count: 0,
    approved_amount: 0,
    rejected_count: 0,
    rejected_amount: 0,
    reimbursed_count: 0,
    reimbursed_amount: 0,
    draft_count: 0,
    draft_amount: 0,
  });

  // Expense List State
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Filter Bar State
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Modals State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseItem | null>(null);
  const [detailExpense, setDetailExpense] = useState<ExpenseItem | null>(null);
  const [rejectingExpense, setRejectingExpense] = useState<ExpenseItem | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectionError, setRejectionError] = useState<string | null>(null);
  const [reimbursingExpense, setReimbursingExpense] = useState<ExpenseItem | null>(null);
  const [reimbursementNotes, setReimbursementNotes] = useState("");
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  // Form State for Add / Edit Modal
  const [formDate, setFormDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [formCategory, setFormCategory] = useState<string>("Travel");
  const [formAmount, setFormAmount] = useState<string>("");
  const [formDescription, setFormDescription] = useState<string>("");
  const [formReceiptFile, setFormReceiptFile] = useState<File | null>(null);
  const [formValidationErrors, setFormValidationErrors] = useState<Record<string, string>>({});

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setApiError(null);
    try {
      // 1. Fetch Summary Statistics
      const summaryRes = await apiGet<ExpenseSummaryData>(
        `/hrms/expenses/summary?view_mode=${viewMode}`
      );
      if (summaryRes?.data) {
        setSummary(summaryRes.data);
      }

      // 2. Fetch Expense List with Scoping and Filters
      const queryParams = new URLSearchParams();
      queryParams.set("view_mode", viewMode);
      if (statusFilter && statusFilter !== "ALL") queryParams.set("status", statusFilter);
      if (categoryFilter && categoryFilter !== "ALL") queryParams.set("category", categoryFilter);
      if (searchTerm.trim()) queryParams.set("search", searchTerm.trim());
      if (startDate) queryParams.set("start_date", startDate);
      if (endDate) queryParams.set("end_date", endDate);

      const listRes = await apiGet<ExpenseItem[]>(`/hrms/expenses?${queryParams.toString()}`);
      if (listRes?.data) {
        setExpenses(listRes.data);
      }
    } catch (err: unknown) {
      const msg = errorMessage(err);
      setApiError(msg || "Failed to load expense records from PostgreSQL database.");
      toast(msg || "Failed to load expenses.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [viewMode, statusFilter, categoryFilter, searchTerm, startDate, endDate, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reset view to 'my' if user lacks approval permissions
  useEffect(() => {
    if (!canApprove && viewMode === "approvals") {
      setViewMode("my");
    }
  }, [canApprove, viewMode]);

  // ---------------------------------------------------------------------------
  // Modal Handlers & Form Reset
  // ---------------------------------------------------------------------------

  const openAddModal = () => {
    setEditingExpense(null);
    setFormDate(new Date().toISOString().split("T")[0]);
    setFormCategory("Travel");
    setFormAmount("");
    setFormDescription("");
    setFormReceiptFile(null);
    setFormValidationErrors({});
    setIsAddModalOpen(true);
  };

  const openEditModal = (exp: ExpenseItem) => {
    setEditingExpense(exp);
    setFormDate(exp.expense_date);
    setFormCategory(exp.category);
    setFormAmount(String(exp.amount));
    setFormDescription(exp.description);
    setFormReceiptFile(null);
    setFormValidationErrors({});
    setIsAddModalOpen(true);
  };

  const closeAddModal = () => {
    setIsAddModalOpen(false);
    setEditingExpense(null);
    setFormValidationErrors({});
  };

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formDate || !formDate.trim()) {
      errors.date = "Expense Date is required.";
    }

    if (!formCategory || !formCategory.trim()) {
      errors.category = "Category is required.";
    }

    const amt = parseFloat(formAmount);
    if (isNaN(amt) || amt <= 0) {
      errors.amount = "Amount must be greater than zero.";
    }

    if (!formDescription || !formDescription.trim()) {
      errors.description = "Description is required.";
    }

    if (formReceiptFile) {
      const ext = formReceiptFile.name.split(".").pop()?.toLowerCase();
      if (!ext || !ALLOWED_RECEIPT_EXTENSIONS.includes(ext)) {
        errors.receipt = `Invalid file type. Allowed formats: ${ALLOWED_RECEIPT_EXTENSIONS.join(", ")}`;
      } else if (formReceiptFile.size > MAX_RECEIPT_SIZE_BYTES) {
        errors.receipt = "File size exceeds the 50MB limit.";
      }
    }

    setFormValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ---------------------------------------------------------------------------
  // Create / Update / Submit Expense
  // ---------------------------------------------------------------------------

  const handleSaveOrSubmit = async (isDirectSubmit: boolean) => {
    if (!validateForm()) {
      toast("Please correct the errors in the form.", "warning");
      return;
    }

    setIsSubmittingAction(true);
    try {
      let receiptUrl = editingExpense?.receipt_url || null;
      let receiptFilename = editingExpense?.receipt_filename || null;

      // 1. Upload receipt if file selected
      if (formReceiptFile) {
        const formData = new FormData();
        formData.append("file", formReceiptFile);
        const uploadRes = await apiPostMultipart<{ file_url: string; file_name: string }>(
          "/hrms/expenses/upload-receipt",
          formData
        );
        if (uploadRes?.data) {
          receiptUrl = uploadRes.data.file_url;
          receiptFilename = uploadRes.data.file_name;
        }
      }

      const payload = {
        expense_date: formDate,
        category: formCategory,
        amount: parseFloat(formAmount),
        description: formDescription.trim(),
        receipt_url: receiptUrl,
        receipt_filename: receiptFilename,
        is_submit: isDirectSubmit,
      };

      if (editingExpense) {
        // Edit existing draft
        await apiPut(`/hrms/expenses/${editingExpense.id}`, payload);
        if (isDirectSubmit) {
          await apiPost(`/hrms/expenses/${editingExpense.id}/submit`);
          toast("Expense claim submitted for approval.", "success");
        } else {
          toast("Expense draft saved successfully.", "success");
        }
      } else {
        // Create new claim
        await apiPost(`/hrms/expenses?submit=${isDirectSubmit}`, payload);
        toast(
          isDirectSubmit ? "Expense claim submitted for approval." : "Expense draft saved successfully.",
          "success"
        );
      }

      closeAddModal();
      await loadData();
    } catch (err: unknown) {
      toast(errorMessage(err) || "Failed to save expense claim.", "error");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Submit Draft from Table
  // ---------------------------------------------------------------------------

  const handleSubmitDraft = async (exp: ExpenseItem) => {
    if (!window.confirm(`Submit claim ${exp.expense_code} for approval?`)) return;
    setIsLoading(true);
    try {
      await apiPost(`/hrms/expenses/${exp.id}/submit`);
      toast(`Claim ${exp.expense_code} submitted for approval.`, "success");
      await loadData();
    } catch (err: unknown) {
      toast(errorMessage(err) || "Failed to submit expense.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete Draft
  // ---------------------------------------------------------------------------

  const handleDeleteDraft = async (exp: ExpenseItem) => {
    if (!window.confirm(`Are you sure you want to delete draft claim ${exp.expense_code}?`)) return;
    setIsLoading(true);
    try {
      await apiDelete(`/hrms/expenses/${exp.id}`);
      toast(`Draft claim ${exp.expense_code} deleted successfully.`, "success");
      await loadData();
    } catch (err: unknown) {
      toast(errorMessage(err) || "Failed to delete expense draft.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Approve Expense
  // ---------------------------------------------------------------------------

  const handleApproveExpense = async (exp: ExpenseItem) => {
    if (!window.confirm(`Approve claim ${exp.expense_code} for ₹${exp.amount.toFixed(2)}?`)) return;
    setIsLoading(true);
    try {
      await apiPost(`/hrms/expenses/${exp.id}/approve`);
      toast(`Claim ${exp.expense_code} approved successfully.`, "success");
      if (detailExpense?.id === exp.id) setDetailExpense(null);
      await loadData();
    } catch (err: unknown) {
      toast(errorMessage(err) || "Failed to approve expense claim.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Reject Expense
  // ---------------------------------------------------------------------------

  const openRejectModal = (exp: ExpenseItem) => {
    setRejectingExpense(exp);
    setRejectionReason("");
    setRejectionError(null);
  };

  const handleConfirmReject = async () => {
    if (!rejectingExpense) return;
    if (!rejectionReason.trim()) {
      setRejectionError("Rejection reason is required.");
      return;
    }

    setIsSubmittingAction(true);
    try {
      await apiPost(`/hrms/expenses/${rejectingExpense.id}/reject`, {
        rejection_reason: rejectionReason.trim(),
      });
      toast(`Claim ${rejectingExpense.expense_code} rejected.`, "success");
      setRejectingExpense(null);
      if (detailExpense?.id === rejectingExpense.id) setDetailExpense(null);
      await loadData();
    } catch (err: unknown) {
      toast(errorMessage(err) || "Failed to reject expense claim.", "error");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Reimburse Expense
  // ---------------------------------------------------------------------------

  const openReimburseModal = (exp: ExpenseItem) => {
    setReimbursingExpense(exp);
    setReimbursementNotes("");
  };

  const handleConfirmReimburse = async () => {
    if (!reimbursingExpense) return;
    setIsSubmittingAction(true);
    try {
      await apiPost(`/hrms/expenses/${reimbursingExpense.id}/reimburse`, {
        notes: reimbursementNotes.trim() || undefined,
      });
      toast(`Claim ${reimbursingExpense.expense_code} marked as reimbursed.`, "success");
      setReimbursingExpense(null);
      if (detailExpense?.id === reimbursingExpense.id) setDetailExpense(null);
      await loadData();
    } catch (err: unknown) {
      toast(errorMessage(err) || "Failed to mark expense as reimbursed.", "error");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Status Badge Helper
  // ---------------------------------------------------------------------------

  const renderStatusBadge = (status: ExpenseStatus) => {
    switch (status) {
      case "DRAFT":
        return <span className="hrms-badge hrms-badge-neutral">Draft</span>;
      case "PENDING":
        return (
          <span
            className="hrms-badge"
            style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}
          >
            Pending
          </span>
        );
      case "APPROVED":
        return <span className="hrms-badge hrms-badge-success">Approved</span>;
      case "REJECTED":
        return <span className="hrms-badge hrms-badge-danger">Rejected</span>;
      case "REIMBURSED":
        return <span className="hrms-badge hrms-badge-info">Reimbursed</span>;
      default:
        return <span className="hrms-badge hrms-badge-neutral">{status}</span>;
    }
  };

  const formatCurrency = (val: number) => {
    return `₹${Number(val || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <AppShell activeKey="hrms-expenses">
      <main className="page">
        <Breadcrumb trail={["HRMS", "Expense Management"]} />

        {/* Page Header */}
        <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "20px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: "var(--color-text, #0f172a)" }}>
              Expense Management
            </h1>
            <div className="page-subtitle" style={{ color: "var(--color-muted, #64748b)", fontSize: "14px", marginTop: "4px" }}>
              Track employee expense claims, reimbursements, and receipts.
            </div>
          </div>

          <div>
            <button
              type="button"
              id="btn-add-expense"
              className="btn btn-primary"
              style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 600 }}
              onClick={openAddModal}
            >
              <IconCreditCard style={{ width: "16px", height: "16px" }} />
              + Add Expense
            </button>
          </div>
        </div>

        {/* Section 1: Top Real Database Summary Cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "16px",
            marginBottom: "20px",
          }}
        >
          {/* Card 1: Total */}
          <div
            className="card"
            style={{ padding: "16px 20px", margin: 0, background: "var(--color-surface, #ffffff)", border: "1px solid var(--color-border, #e2e8f0)", borderRadius: "8px" }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
              TOTAL CLAIMS ({viewMode === "my" ? "MY" : "ALL"})
            </div>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#0f172a", marginBottom: "2px" }}>
              {formatCurrency(summary.total_amount)}
            </div>
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              {summary.total_count} total {summary.total_count === 1 ? "claim" : "claims"}
            </div>
          </div>

          {/* Card 2: Pending */}
          <div
            className="card"
            style={{ padding: "16px 20px", margin: 0, background: "var(--color-surface, #ffffff)", border: "1px solid var(--color-border, #e2e8f0)", borderRadius: "8px" }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#d97706", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
              PENDING APPROVAL
            </div>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#d97706", marginBottom: "2px" }}>
              {formatCurrency(summary.pending_amount)}
            </div>
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              {summary.pending_count} pending {summary.pending_count === 1 ? "review" : "reviews"}
            </div>
          </div>

          {/* Card 3: Approved */}
          <div
            className="card"
            style={{ padding: "16px 20px", margin: 0, background: "var(--color-surface, #ffffff)", border: "1px solid var(--color-border, #e2e8f0)", borderRadius: "8px" }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
              APPROVED CLAIMS
            </div>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#16a34a", marginBottom: "2px" }}>
              {formatCurrency(summary.approved_amount)}
            </div>
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              {summary.approved_count} approved ({summary.reimbursed_count} reimbursed)
            </div>
          </div>

          {/* Card 4: Rejected */}
          <div
            className="card"
            style={{ padding: "16px 20px", margin: 0, background: "var(--color-surface, #ffffff)", border: "1px solid var(--color-border, #e2e8f0)", borderRadius: "8px" }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
              REJECTED CLAIMS
            </div>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#dc2626", marginBottom: "2px" }}>
              {formatCurrency(summary.rejected_amount)}
            </div>
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              {summary.rejected_count} rejected {summary.rejected_count === 1 ? "claim" : "claims"}
            </div>
          </div>
        </div>

        {/* Tab Navigation: My Expenses vs Approvals */}
        <div className="hrms-tabs-nav">
          <button
            type="button"
            id="tab-my-expenses"
            className={`hrms-tab-btn ${viewMode === "my" ? "active" : ""}`}
            onClick={() => setViewMode("my")}
          >
            <IconCoins style={{ width: "16px", height: "16px" }} />
            My Expenses
          </button>

          {canApprove && (
            <button
              type="button"
              id="tab-approvals"
              className={`hrms-tab-btn ${viewMode === "approvals" ? "active" : ""}`}
              onClick={() => setViewMode("approvals")}
            >
              <IconFileText style={{ width: "16px", height: "16px" }} />
              Approvals
              {summary.pending_count > 0 && (
                <span
                  style={{
                    background: "#d97706",
                    color: "#ffffff",
                    fontSize: "10px",
                    fontWeight: 700,
                    borderRadius: "9999px",
                    padding: "1px 6px",
                    marginLeft: "4px",
                  }}
                >
                  {summary.pending_count}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Filter Bar */}
        <div
          className="card"
          style={{
            padding: "14px 18px",
            marginBottom: "16px",
            background: "var(--color-surface, #ffffff)",
            border: "1px solid var(--color-border, #e2e8f0)",
            borderRadius: "8px",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
            {/* Search Input */}
            <div style={{ flex: "1 1 200px", minWidth: "180px" }}>
              <input
                type="text"
                id="filter-search"
                className="form-control"
                placeholder="Search by ID, Category, Description..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ width: "100%", padding: "7px 12px", fontSize: "13px" }}
              />
            </div>

            {/* Status Filter */}
            <div style={{ minWidth: "140px" }}>
              <select
                id="filter-status"
                className="form-control"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ width: "100%", padding: "7px 10px", fontSize: "13px" }}
              >
                <option value="ALL">All Statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="REIMBURSED">Reimbursed</option>
              </select>
            </div>

            {/* Category Filter */}
            <div style={{ minWidth: "150px" }}>
              <select
                id="filter-category"
                className="form-control"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                style={{ width: "100%", padding: "7px 10px", fontSize: "13px" }}
              >
                <option value="ALL">All Categories</option>
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Start Date */}
            <div style={{ minWidth: "130px" }}>
              <input
                type="date"
                id="filter-start-date"
                className="form-control"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                title="From Date"
                style={{ width: "100%", padding: "7px 10px", fontSize: "13px" }}
              />
            </div>

            {/* End Date */}
            <div style={{ minWidth: "130px" }}>
              <input
                type="date"
                id="filter-end-date"
                className="form-control"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                title="To Date"
                style={{ width: "100%", padding: "7px 10px", fontSize: "13px" }}
              />
            </div>

            {/* Reset Filters */}
            {(searchTerm || statusFilter !== "ALL" || categoryFilter !== "ALL" || startDate || endDate) && (
              <button
                type="button"
                id="btn-reset-filters"
                className="btn btn-outline"
                style={{ padding: "6px 12px", fontSize: "12px", fontWeight: 600 }}
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("ALL");
                  setCategoryFilter("ALL");
                  setStartDate("");
                  setEndDate("");
                }}
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* API Error Alert */}
        {apiError && (
          <div
            id="expense-api-error"
            style={{
              padding: "12px 16px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#991b1b",
              borderRadius: "8px",
              marginBottom: "16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <strong>Error:</strong> {apiError}
            </div>
            <button
              type="button"
              className="btn btn-outline"
              style={{ padding: "4px 10px", fontSize: "12px" }}
              onClick={loadData}
            >
              Retry
            </button>
          </div>
        )}

        {/* Expenses Table Card */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="card-header" style={{ padding: "16px 20px" }}>
            <div>
              <h2 className="hrms-section-title">
                {viewMode === "my" ? "My Expense Claims" : "Approval Requests"}
              </h2>
              <div className="hrms-section-desc">
                {viewMode === "my"
                  ? "Track your submitted claims, approval statuses, and reimbursements."
                  : "Review, approve, or reject employee expense claims across the organization."}
              </div>
            </div>
            <span className="hrms-badge-shell">
              {expenses.length} {expenses.length === 1 ? "Record" : "Records"}
            </span>
          </div>

          {isLoading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--color-muted, #64748b)" }}>
              Loading expenses from database...
            </div>
          ) : expenses.length === 0 ? (
            /* Empty State */
            <div className="hrms-placeholder-box" id="empty-state" style={{ margin: "20px" }}>
              <div className="hrms-placeholder-icon">
                <IconReceipt />
              </div>
              <h3 className="hrms-placeholder-title">
                {viewMode === "my" ? "No Expense Claims Found" : "No Pending Approvals"}
              </h3>
              <p className="hrms-placeholder-text">
                {viewMode === "my"
                  ? "You have not submitted any expense claims matching your filter criteria. Click '+ Add Expense' above to create a new draft or submit a claim."
                  : "There are currently no expense claims requiring approval matching your filter criteria."}
              </p>
            </div>
          ) : (
            <div className="hrms-table-container" style={{ margin: 0, border: "none" }}>
              <table className="hrms-table" id="expenses-table">
                <thead>
                  <tr>
                    <th>Expense ID</th>
                    {viewMode === "approvals" && <th>Employee</th>}
                    <th>Date</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Receipt</th>
                    <th style={{ textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((exp) => (
                    <tr key={exp.id} id={`expense-row-${exp.id}`}>
                      {/* Expense ID */}
                      <td style={{ fontWeight: 600, color: "var(--color-primary, #0061f2)" }}>
                        {exp.expense_code}
                      </td>

                      {/* Employee (in approvals view) */}
                      {viewMode === "approvals" && (
                        <td>
                          <div style={{ fontWeight: 600 }}>{exp.employee_name || "Employee"}</div>
                          {exp.employee_email && (
                            <div style={{ fontSize: "11px", color: "var(--color-muted, #64748b)" }}>
                              {exp.employee_email}
                            </div>
                          )}
                        </td>
                      )}

                      {/* Date */}
                      <td>{exp.expense_date}</td>

                      {/* Category */}
                      <td>
                        <span style={{ fontWeight: 500 }}>{exp.category}</span>
                      </td>

                      {/* Description */}
                      <td style={{ maxWidth: "260px" }}>
                        <div
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={exp.description}
                        >
                          {exp.description}
                        </div>
                      </td>

                      {/* Amount */}
                      <td style={{ fontWeight: 700, color: "var(--color-text, #0f172a)" }}>
                        {formatCurrency(exp.amount)}
                      </td>

                      {/* Status */}
                      <td>{renderStatusBadge(exp.status)}</td>

                      {/* Receipt */}
                      <td>
                        {exp.receipt_url ? (
                          <a
                            href={exp.receipt_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hrms-btn-action"
                            style={{ color: "var(--color-primary, #0061f2)", textDecoration: "none" }}
                            title={exp.receipt_filename || "View receipt"}
                          >
                            <IconReceipt style={{ width: "13px", height: "13px" }} />
                            Receipt
                          </a>
                        ) : (
                          <span style={{ color: "var(--color-muted, #94a3b8)", fontSize: "12px" }}>
                            —
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: "6px", justifyContent: "flex-end" }}>
                          {/* Self-Service Actions for DRAFT */}
                          {viewMode === "my" && exp.status === "DRAFT" && (
                            <>
                              <button
                                type="button"
                                className="hrms-btn-action"
                                title="Edit draft"
                                onClick={() => openEditModal(exp)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="hrms-btn-action"
                                style={{ color: "#16a34a", borderColor: "#bbf7d0" }}
                                title="Submit for approval"
                                onClick={() => handleSubmitDraft(exp)}
                              >
                                Submit
                              </button>
                              <button
                                type="button"
                                className="hrms-btn-action btn-danger"
                                title="Delete draft"
                                onClick={() => handleDeleteDraft(exp)}
                              >
                                Delete
                              </button>
                            </>
                          )}

                          {/* Approval Actions for Authorized Approvers */}
                          {canApprove && exp.status === "PENDING" && (
                            <>
                              <button
                                type="button"
                                className="hrms-btn-action"
                                style={{ background: "#ecfdf5", color: "#065f46", borderColor: "#a7f3d0" }}
                                title="Approve claim"
                                onClick={() => handleApproveExpense(exp)}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className="hrms-btn-action btn-danger"
                                title="Reject claim"
                                onClick={() => openRejectModal(exp)}
                              >
                                Reject
                              </button>
                            </>
                          )}

                          {/* Reimbursement Action for Approved Claims */}
                          {canApprove && exp.status === "APPROVED" && (
                            <button
                              type="button"
                              className="hrms-btn-action"
                              style={{ background: "#eff6ff", color: "#1e40af", borderColor: "#bfdbfe" }}
                              title="Mark Reimbursed"
                              onClick={() => openReimburseModal(exp)}
                            >
                              Mark Reimbursed
                            </button>
                          )}

                          {/* General View Details Button */}
                          <button
                            type="button"
                            className="hrms-btn-action"
                            title="View details"
                            onClick={() => setDetailExpense(exp)}
                          >
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ================================================================= */}
        {/* ADD / EDIT EXPENSE MODAL                                          */}
        {/* ================================================================= */}
        {isAddModalOpen && (
          <div className="hrms-modal-backdrop" onClick={closeAddModal}>
            <div
              className="hrms-modal-card"
              style={{ maxWidth: "560px" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div
                className="hrms-modal-header"
                style={{
                  padding: "16px 20px",
                  borderBottom: "1px solid var(--color-border, #e2e8f0)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#0f172a" }}>
                    {editingExpense ? `Edit Expense (${editingExpense.expense_code})` : "Add Expense Claim"}
                  </h3>
                  <div style={{ fontSize: "12.5px", color: "#64748b", marginTop: "2px" }}>
                    Submit travel, food, accommodation, or operational claims.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeAddModal}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "20px",
                    lineHeight: 1,
                    cursor: "pointer",
                    color: "#94a3b8",
                  }}
                >
                  &times;
                </button>
              </div>

              {/* Modal Body */}
              <div className="hrms-modal-body" style={{ padding: "20px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {/* Expense Date * */}
                  <div>
                    <label htmlFor="modal-expense-date" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                      Expense Date <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <input
                      type="date"
                      id="modal-expense-date"
                      className="form-control"
                      value={formDate}
                      onChange={(e) => setFormDate(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px" }}
                    />
                    {formValidationErrors.date && (
                      <div style={{ color: "#dc2626", fontSize: "12px", marginTop: "4px" }}>
                        {formValidationErrors.date}
                      </div>
                    )}
                  </div>

                  {/* Category * */}
                  <div>
                    <label htmlFor="modal-expense-category" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                      Category <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <select
                      id="modal-expense-category"
                      className="form-control"
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px" }}
                    >
                      {EXPENSE_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                    {formValidationErrors.category && (
                      <div style={{ color: "#dc2626", fontSize: "12px", marginTop: "4px" }}>
                        {formValidationErrors.category}
                      </div>
                    )}
                  </div>

                  {/* Amount * */}
                  <div>
                    <label htmlFor="modal-expense-amount" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                      Amount <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <input
                      type="number"
                      id="modal-expense-amount"
                      className="form-control"
                      placeholder="0.00"
                      min="0.01"
                      step="0.01"
                      value={formAmount}
                      onChange={(e) => setFormAmount(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px" }}
                    />
                    {formValidationErrors.amount && (
                      <div style={{ color: "#dc2626", fontSize: "12px", marginTop: "4px" }}>
                        {formValidationErrors.amount}
                      </div>
                    )}
                  </div>

                  {/* Description * */}
                  <div>
                    <label htmlFor="modal-expense-description" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                      Description <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <textarea
                      id="modal-expense-description"
                      className="form-control"
                      rows={3}
                      placeholder="Provide business reason and vendor details..."
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", resize: "vertical" }}
                    />
                    {formValidationErrors.description && (
                      <div style={{ color: "#dc2626", fontSize: "12px", marginTop: "4px" }}>
                        {formValidationErrors.description}
                      </div>
                    )}
                  </div>

                  {/* Receipt File */}
                  <div>
                    <label htmlFor="modal-expense-receipt" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                      Receipt Attachment
                    </label>
                    <input
                      type="file"
                      id="modal-expense-receipt"
                      className="form-control"
                      accept=".png,.jpg,.jpeg,.webp,.pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setFormReceiptFile(file);
                      }}
                      style={{ width: "100%", padding: "6px 10px" }}
                    />
                    <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "4px" }}>
                      Accepted formats: PNG, JPG, JPEG, WEBP, PDF (Max 50MB)
                    </div>
                    {editingExpense?.receipt_url && !formReceiptFile && (
                      <div style={{ marginTop: "6px", fontSize: "12px" }}>
                        Current receipt:{" "}
                        <a
                          href={editingExpense.receipt_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "var(--color-primary, #0061f2)" }}
                        >
                          {editingExpense.receipt_filename || "View Attachment"}
                        </a>
                      </div>
                    )}
                    {formValidationErrors.receipt && (
                      <div style={{ color: "#dc2626", fontSize: "12px", marginTop: "4px" }}>
                        {formValidationErrors.receipt}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div
                className="hrms-modal-footer"
                style={{
                  padding: "14px 20px",
                  borderTop: "1px solid var(--color-border, #e2e8f0)",
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                  background: "#f8fafc",
                }}
              >
                <button
                  type="button"
                  id="modal-btn-cancel"
                  className="btn btn-outline"
                  onClick={closeAddModal}
                  disabled={isSubmittingAction}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  id="modal-btn-save-draft"
                  className="btn btn-outline"
                  onClick={() => handleSaveOrSubmit(false)}
                  disabled={isSubmittingAction}
                >
                  {isSubmittingAction ? "Saving..." : "Save Draft"}
                </button>
                <button
                  type="button"
                  id="modal-btn-submit"
                  className="btn btn-primary"
                  onClick={() => handleSaveOrSubmit(true)}
                  disabled={isSubmittingAction}
                >
                  {isSubmittingAction ? "Submitting..." : "Submit Expense"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* REJECTION REASON MODAL                                            */}
        {/* ================================================================= */}
        {rejectingExpense && (
          <div className="hrms-modal-backdrop" onClick={() => setRejectingExpense(null)}>
            <div
              className="hrms-modal-card"
              style={{ maxWidth: "460px" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="hrms-modal-header"
                style={{
                  padding: "16px 20px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#991b1b" }}>
                  Reject Expense Claim
                </h3>
                <button
                  type="button"
                  onClick={() => setRejectingExpense(null)}
                  style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#94a3b8" }}
                >
                  &times;
                </button>
              </div>

              <div className="hrms-modal-body" style={{ padding: "20px" }}>
                <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "#475569" }}>
                  Please state the reason for rejecting claim <strong>{rejectingExpense.expense_code}</strong>.
                  This will be recorded permanently in PostgreSQL.
                </p>

                <label htmlFor="rejection-reason-input" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                  Rejection Reason <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <textarea
                  id="rejection-reason-input"
                  className="form-control"
                  rows={3}
                  placeholder="e.g. Incorrect receipt, missing invoice, unauthorized trip..."
                  value={rejectionReason}
                  onChange={(e) => {
                    setRejectionReason(e.target.value);
                    if (rejectionError) setRejectionError(null);
                  }}
                  style={{ width: "100%", padding: "8px 12px" }}
                />
                {rejectionError && (
                  <div style={{ color: "#dc2626", fontSize: "12px", marginTop: "4px" }}>
                    {rejectionError}
                  </div>
                )}
              </div>

              <div
                className="hrms-modal-footer"
                style={{
                  padding: "12px 20px",
                  borderTop: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                  background: "#f8fafc",
                }}
              >
                <button
                  type="button"
                  id="btn-cancel-reject"
                  className="btn btn-outline"
                  onClick={() => setRejectingExpense(null)}
                  disabled={isSubmittingAction}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  id="btn-confirm-reject"
                  className="btn btn-danger"
                  style={{ background: "#dc2626", color: "#ffffff", border: "none" }}
                  onClick={handleConfirmReject}
                  disabled={isSubmittingAction}
                >
                  {isSubmittingAction ? "Rejecting..." : "Confirm Rejection"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* REIMBURSEMENT MODAL                                               */}
        {/* ================================================================= */}
        {reimbursingExpense && (
          <div className="hrms-modal-backdrop" onClick={() => setReimbursingExpense(null)}>
            <div
              className="hrms-modal-card"
              style={{ maxWidth: "460px" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="hrms-modal-header"
                style={{
                  padding: "16px 20px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#1e40af" }}>
                  Mark as Reimbursed
                </h3>
                <button
                  type="button"
                  onClick={() => setReimbursingExpense(null)}
                  style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#94a3b8" }}
                >
                  &times;
                </button>
              </div>

              <div className="hrms-modal-body" style={{ padding: "20px" }}>
                <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "#475569" }}>
                  Disburse <strong>{formatCurrency(reimbursingExpense.amount)}</strong> for claim{" "}
                  <strong>{reimbursingExpense.expense_code}</strong>.
                </p>

                <label htmlFor="reimbursement-notes-input" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                  Reimbursement Notes (Optional)
                </label>
                <textarea
                  id="reimbursement-notes-input"
                  className="form-control"
                  rows={2}
                  placeholder="e.g. Bank transfer reference #123456 or cash voucher..."
                  value={reimbursementNotes}
                  onChange={(e) => setReimbursementNotes(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px" }}
                />
              </div>

              <div
                className="hrms-modal-footer"
                style={{
                  padding: "12px 20px",
                  borderTop: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                  background: "#f8fafc",
                }}
              >
                <button
                  type="button"
                  id="btn-cancel-reimburse"
                  className="btn btn-outline"
                  onClick={() => setReimbursingExpense(null)}
                  disabled={isSubmittingAction}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  id="btn-confirm-reimburse"
                  className="btn btn-primary"
                  onClick={handleConfirmReimburse}
                  disabled={isSubmittingAction}
                >
                  {isSubmittingAction ? "Processing..." : "Confirm Reimbursed"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* EXPENSE DETAIL MODAL                                              */}
        {/* ================================================================= */}
        {detailExpense && (
          <div className="hrms-modal-backdrop" onClick={() => setDetailExpense(null)}>
            <div
              className="hrms-modal-card"
              style={{ maxWidth: "600px" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="hrms-modal-header"
                style={{
                  padding: "16px 20px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#0f172a" }}>
                    {detailExpense.expense_code}
                  </h3>
                  {renderStatusBadge(detailExpense.status)}
                </div>
                <button
                  type="button"
                  onClick={() => setDetailExpense(null)}
                  style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#94a3b8" }}
                >
                  &times;
                </button>
              </div>

              <div className="hrms-modal-body" style={{ padding: "20px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "16px" }}>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                      Employee
                    </div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a", marginTop: "2px" }}>
                      {detailExpense.employee_name || "Employee"}
                    </div>
                    {detailExpense.employee_email && (
                      <div style={{ fontSize: "12px", color: "#64748b" }}>{detailExpense.employee_email}</div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                      Expense Date
                    </div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a", marginTop: "2px" }}>
                      {detailExpense.expense_date}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                      Category
                    </div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a", marginTop: "2px" }}>
                      {detailExpense.category}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                      Amount
                    </div>
                    <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-primary, #0061f2)", marginTop: "2px" }}>
                      {formatCurrency(detailExpense.amount)}
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: "4px" }}>
                    Description
                  </div>
                  <div
                    style={{
                      padding: "10px 12px",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: "6px",
                      fontSize: "13.5px",
                      color: "#1e293b",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {detailExpense.description}
                  </div>
                </div>

                {/* Receipt Preview / Link */}
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: "4px" }}>
                    Receipt
                  </div>
                  {detailExpense.receipt_url ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <a
                        href={detailExpense.receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-outline"
                        style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px" }}
                      >
                        <IconReceipt style={{ width: "14px", height: "14px" }} />
                        Open Receipt Attachment
                      </a>
                      <span style={{ fontSize: "12px", color: "#64748b" }}>
                        ({detailExpense.receipt_filename || "receipt"})
                      </span>
                    </div>
                  ) : (
                    <div style={{ fontSize: "13px", color: "#94a3b8" }}>No receipt attached.</div>
                  )}
                </div>

                {/* Rejection Reason (if rejected) */}
                {detailExpense.rejection_reason && (
                  <div style={{ marginBottom: "16px", padding: "12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#991b1b", textTransform: "uppercase", marginBottom: "4px" }}>
                      Rejection Reason
                    </div>
                    <div style={{ fontSize: "13px", color: "#991b1b" }}>
                      {detailExpense.rejection_reason}
                    </div>
                  </div>
                )}

                {/* Reimbursement Details (if reimbursed) */}
                {detailExpense.reimbursed_at && (
                  <div style={{ marginBottom: "16px", padding: "12px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "6px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#1e40af", textTransform: "uppercase", marginBottom: "4px" }}>
                      Reimbursement Details
                    </div>
                    <div style={{ fontSize: "13px", color: "#1e40af" }}>
                      Reimbursed by: {detailExpense.reimburser_name || "Finance Admin"}
                    </div>
                    {detailExpense.reimbursement_notes && (
                      <div style={{ fontSize: "12.5px", color: "#3b82f6", marginTop: "2px" }}>
                        Notes: {detailExpense.reimbursement_notes}
                      </div>
                    )}
                  </div>
                )}

                {/* Audit Timestamps */}
                <div style={{ fontSize: "11.5px", color: "#94a3b8", borderTop: "1px solid #e2e8f0", paddingTop: "12px" }}>
                  <div>Created: {new Date(detailExpense.created_at).toLocaleString()}</div>
                  {detailExpense.submitted_at && <div>Submitted: {new Date(detailExpense.submitted_at).toLocaleString()}</div>}
                  {detailExpense.reviewed_at && <div>Reviewed: {new Date(detailExpense.reviewed_at).toLocaleString()}</div>}
                </div>
              </div>

              {/* Modal Footer */}
              <div
                className="hrms-modal-footer"
                style={{
                  padding: "12px 20px",
                  borderTop: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                  background: "#f8fafc",
                }}
              >
                {canApprove && detailExpense.status === "PENDING" && (
                  <>
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ color: "#dc2626" }}
                      onClick={() => {
                        const exp = detailExpense;
                        setDetailExpense(null);
                        openRejectModal(exp);
                      }}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleApproveExpense(detailExpense)}
                    >
                      Approve Claim
                    </button>
                  </>
                )}

                {canApprove && detailExpense.status === "APPROVED" && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      const exp = detailExpense;
                      setDetailExpense(null);
                      openReimburseModal(exp);
                    }}
                  >
                    Mark Reimbursed
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setDetailExpense(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
