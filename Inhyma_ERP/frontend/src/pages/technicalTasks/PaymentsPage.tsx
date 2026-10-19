import React, { useState, useEffect, useCallback, useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { Pagination } from "@/components/Pagination";
import type { PaginationMeta } from "@/types";
import {
  fetchTechnicalTasks,
  fetchPaymentSummary,
  recordTechnicalTaskPayment,
  createTechnicalTask,
  bulkDeleteTechnicalTasks,
  uploadPaymentScreenshot,
  type TechnicalTaskListParams,
} from "@/lib/technicalTasksApi";
import type {
  TechnicalTask,
  TechnicalTaskPaymentSummary,
  TechnicalTaskCreatePayload,
} from "@/types/technicalTasks";
import { ClientNameAutocomplete, type CompanyAutocompleteItem } from "@/components/ClientNameAutocomplete";
import { errorMessage } from "@/lib/api";
import { Banner, Modal } from "@/components/ui";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import "@/styles/payments.css";

function formatCurrency(amount: number | null | undefined): string {
  const val = Number(amount || 0);
  return val.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatNumber(amount: number | null | undefined): string {
  const val = Number(amount || 0);
  return val.toLocaleString("en-IN");
}

type TabType = "pending" | "completed";

const TechnicalPaymentsSkeletonRows: React.FC<{ count?: number }> = ({ count = 8 }) => (
  <>
    {Array.from({ length: count }).map((_, index) => (
      <tr key={`tech-payment-skeleton-${index}`} className="table-skeleton-row">
        <td style={{ width: 36, padding: "12px" }}>
          <div className="skeleton-box" style={{ width: 16, height: 16, borderRadius: 4 }} />
        </td>
        <td style={{ padding: "12px" }}><div className="skeleton-line" style={{ width: "80%" }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-line" style={{ width: "65%" }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-line" style={{ width: "55%" }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-badge" style={{ width: 60 }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-line" style={{ width: "75%" }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-line" style={{ width: "65%" }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-line" style={{ width: "70%" }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-line" style={{ width: "60%" }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-line" style={{ width: "65%" }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-line" style={{ width: "60%" }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-line" style={{ width: "55%" }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-badge" style={{ width: 75 }} /></td>
        <td style={{ width: 44, padding: "12px", textAlign: "center" }}>
          <div className="skeleton-box" style={{ width: 26, height: 26, borderRadius: 4, margin: "0 auto" }} />
        </td>
      </tr>
    ))}
  </>
);

export function PaymentsPage() {
  // Tabs & Summary
  const [activeTab, setActiveTab] = useState<TabType>("pending");
  const [summary, setSummary] = useState<TechnicalTaskPaymentSummary>({
    total_payment: 0,
    paid: 0,
    due: 0,
    pending_count: 0,
    completed_count: 0,
  });

  // Table Data & State
  const [tasks, setTasks] = useState<TechnicalTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalRecords, setTotalRecords] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filter Drawer State
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterCity, setFilterCity] = useState("");
  const [filterTaskType, setFilterTaskType] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterTechnician, setFilterTechnician] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const [appliedFilters, setAppliedFilters] = useState({
    city: "",
    taskType: "",
    priority: "",
    technician: "",
    dateFrom: "",
    dateTo: "",
  });

  // Modals & Action Menus
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [recordPaymentTask, setRecordPaymentTask] = useState<TechnicalTask | null>(null);
  const [detailTask, setDetailTask] = useState<TechnicalTask | null>(null);
  const [addNewOpen, setAddNewOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  // Record Payment Form State
  const [collectAmount, setCollectAmount] = useState<string>("");
  const [paymentMode, setPaymentMode] = useState<string>("Company Acc");
  const [paymentDate, setPaymentDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [referenceNo, setReferenceNo] = useState<string>("");
  const [paymentScreenshotUrl, setPaymentScreenshotUrl] = useState<string>("");
  const [paymentRemarks, setPaymentRemarks] = useState<string>("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);

  // Add New Payment Task Form State
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyId, setNewCompanyId] = useState<string | null>(null);
  const [newCity, setNewCity] = useState("");
  const [newTaskType, setNewTaskType] = useState("Physical Visit");
  const [newMachineModel, setNewMachineModel] = useState("GF5000F Granular Filler FFS");
  const [newContactPerson, setNewContactPerson] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newServiceCharge, setNewServiceCharge] = useState("10000");
  const [newCollectedAmount, setNewCollectedAmount] = useState("5000");
  const [newPaymentMode, setNewPaymentMode] = useState("Company Acc");
  const [newPaymentDate, setNewPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newRefNo, setNewRefNo] = useState("");
  const [newRemarks, setNewRemarks] = useState("");
  const [savingNewPayment, setSavingNewPayment] = useState(false);

  // Close action menus when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest(".payment-action-menu-wrapper")) {
        setOpenActionMenuId(null);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  // Fetch Payment Summary (KPIs & tab counts)
  const loadSummary = useCallback(async () => {
    try {
      const data = await fetchPaymentSummary();
      setSummary(data);
    } catch (err) {
      console.error("Failed to load payment summary:", err);
    }
  }, []);

  // Fetch Tasks for the active tab and filters
  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params: TechnicalTaskListParams = {
        service_type: "Chargeable",
        payment_collected: activeTab === "pending" ? "pending" : "completed",
        page,
        page_size: pageSize,
      };

      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }
      if (appliedFilters.city.trim()) params.city = appliedFilters.city.trim();
      if (appliedFilters.taskType.trim()) params.task_type = appliedFilters.taskType.trim();
      if (appliedFilters.priority.trim()) params.priority = appliedFilters.priority.trim();
      if (appliedFilters.technician.trim()) params.task_allotted_to = appliedFilters.technician.trim();
      if (appliedFilters.dateFrom) params.date_from = appliedFilters.dateFrom;
      if (appliedFilters.dateTo) params.date_to = appliedFilters.dateTo;

      const res = await fetchTechnicalTasks(params);
      const items = res.data || [];
      setTasks(items);
      const meta = res.meta;
      const total = meta?.pagination?.total_records ?? items.length;
      setTotalRecords(total);
    } catch (err) {
      console.error("Failed to load payment tasks:", err);
      setBanner({ type: "error", message: errorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, [
    activeTab,
    page,
    pageSize,
    searchQuery,
    appliedFilters,
  ]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Handle Tab Switch
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setPage(1);
    setSelectedIds(new Set());
  };

  // Selection helpers
  const allCurrentSelected = tasks.length > 0 && tasks.every((t) => selectedIds.has(t.id));
  const toggleSelectAll = () => {
    if (allCurrentSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tasks.map((t) => t.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Open Record Payment Modal
  const openRecordPayment = (task: TechnicalTask) => {
    setRecordPaymentTask(task);
    const charge = Number(task.service_charge || 0);
    const paid = Number(task.collected_amount || 0);
    const due = Math.max(0, charge - paid);
    setCollectAmount(due > 0 ? String(due) : "");
    setPaymentMode(task.payment_mode || "Company Acc");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setReferenceNo("");
    setPaymentScreenshotUrl(task.payment_screenshot || "");
    setPaymentRemarks("");
    setOpenActionMenuId(null);
  };

  // Handle Screenshot File Upload
  const handleScreenshotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingScreenshot(true);
    try {
      const res = await uploadPaymentScreenshot(file);
      setPaymentScreenshotUrl(res.file_url);
      setBanner({ type: "success", message: "Screenshot uploaded successfully." });
    } catch (err) {
      setBanner({ type: "error", message: errorMessage(err) });
    } finally {
      setUploadingScreenshot(false);
    }
  };

  // Submit Payment Record
  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recordPaymentTask) return;
    const amt = parseFloat(collectAmount);
    if (isNaN(amt) || amt <= 0) {
      setBanner({ type: "error", message: "Please enter a valid payment amount greater than 0." });
      return;
    }
    if (!paymentMode.trim()) {
      setBanner({ type: "error", message: "Please select a payment mode." });
      return;
    }

    setSavingPayment(true);
    try {
      await recordTechnicalTaskPayment(recordPaymentTask.id, {
        amount: amt,
        payment_mode: paymentMode.trim(),
        payment_date: paymentDate || undefined,
        reference_no: referenceNo.trim() || undefined,
        payment_screenshot: paymentScreenshotUrl || undefined,
        remarks: paymentRemarks.trim() || undefined,
      });

      setBanner({
        type: "success",
        message: `Payment of ₹${formatNumber(amt)} successfully recorded for ${recordPaymentTask.company_name}.`,
      });
      setRecordPaymentTask(null);
      await loadSummary();
      await loadTasks();
    } catch (err) {
      setBanner({ type: "error", message: errorMessage(err) });
    } finally {
      setSavingPayment(false);
    }
  };

  // Submit Add New Payment & Task
  const handleCreateNewPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim()) {
      setBanner({ type: "error", message: "Please provide Company Name." });
      return;
    }
    if (!newCity.trim()) {
      setBanner({ type: "error", message: "Please provide City." });
      return;
    }
    const charge = parseFloat(newServiceCharge);
    if (isNaN(charge) || charge <= 0) {
      setBanner({ type: "error", message: "Please enter a valid Total Amount greater than 0." });
      return;
    }
    const collected = parseFloat(newCollectedAmount || "0");

    setSavingNewPayment(true);
    try {
      const payload: TechnicalTaskCreatePayload = {
        company_name: newCompanyName.trim(),
        company_id: newCompanyId,
        city: newCity.trim(),
        task_type: newTaskType,
        machine_model: newMachineModel.trim() || "Service Charges",
        contact_person_name: newContactPerson.trim() || undefined,
        contact_phone: newContactPhone.trim() || undefined,
        service_type: "Chargeable",
        service_charge: charge,
        payment_terms: "100% Against Completion",
        call_type: "Physical Visit",
        priority: "A",
        status: collected >= charge ? "Completed" : "Approved",
        payment_status: collected >= charge ? "Paid" : "Pending",
      };

      const created = await createTechnicalTask(payload);

      // If payment was recorded upfront, record it
      if (collected > 0) {
        await recordTechnicalTaskPayment(created.id, {
          amount: collected,
          payment_mode: newPaymentMode,
          payment_date: newPaymentDate,
          reference_no: newRefNo || undefined,
          remarks: newRemarks || undefined,
        });
      }

      setBanner({
        type: "success",
        message: `Payment task for ${newCompanyName} created successfully.`,
      });
      setAddNewOpen(false);
      resetNewForm();
      await loadSummary();
      await loadTasks();
    } catch (err) {
      setBanner({ type: "error", message: errorMessage(err) });
    } finally {
      setSavingNewPayment(false);
    }
  };

  const resetNewForm = () => {
    setNewCompanyName("");
    setNewCompanyId(null);
    setNewCity("");
    setNewTaskType("Physical Visit");
    setNewMachineModel("GF5000F Granular Filler FFS");
    setNewContactPerson("");
    setNewContactPhone("");
    setNewServiceCharge("10000");
    setNewCollectedAmount("5000");
    setNewPaymentMode("Company Acc");
    setNewRefNo("");
    setNewRemarks("");
  };

  // Bulk Delete
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      const deletedCount = await bulkDeleteTechnicalTasks(Array.from(selectedIds));
      setBanner({
        type: "success",
        message: `Successfully deleted ${deletedCount} record(s).`,
      });
      setSelectedIds(new Set());
      setDeleteConfirmOpen(false);
      await loadSummary();
      await loadTasks();
    } catch (err) {
      setBanner({ type: "error", message: errorMessage(err) });
    }
  };

  // Reset Filters
  const handleResetFilters = () => {
    setFilterCity("");
    setFilterTaskType("");
    setFilterPriority("");
    setFilterTechnician("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setPage(1);
    setAppliedFilters({
      city: "",
      taskType: "",
      priority: "",
      technician: "",
      dateFrom: "",
      dateTo: "",
    });
  };

  // Search / Apply Filters
  const handleSearchFilters = () => {
    setPage(1);
    setAppliedFilters({
      city: filterCity,
      taskType: filterTaskType,
      priority: filterPriority,
      technician: filterTechnician,
      dateFrom: filterDateFrom,
      dateTo: filterDateTo,
    });
  };

  // Total pages
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  const paginationMeta: PaginationMeta = useMemo(() => ({
    current_page: page,
    total_pages: totalPages,
    total_records: totalRecords,
    page_size: pageSize,
    has_next: page < totalPages,
    has_previous: page > 1,
  }), [page, totalPages, totalRecords, pageSize]);

  return (
    <AppShell activeKey="payments">
      <ErrorBoundary title="Payments Module Error">
        <main className="page page-payments">
          {banner && (
            <div style={{ marginBottom: "16px" }}>
              <Banner
                error={banner.type === "error" ? banner.message : undefined}
                success={banner.type === "success" ? banner.message : undefined}
              />
            </div>
          )}

          {/* Top Header */}
          <div
            className="page-header"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <div>
              <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#1e293b" }}>Payments</h1>
            </div>

            <div className="page-header-actions" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              {/* Filter Toggle Button */}
              <button
                type="button"
                className="btn btn-filter-toggle"
                style={{
                  background: "#556987",
                  color: "#ffffff",
                  padding: "8px 14px",
                  borderRadius: "6px",
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                }}
                onClick={() => setFilterOpen((prev) => !prev)}
                title="Toggle Filter Options"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
              </button>

              {/* + ADD NEW */}
              <button
                type="button"
                className="btn btn-add-new"
                style={{
                  height: "36px",
                  padding: "0 18px",
                  background: "#0061f2",
                  color: "#ffffff",
                  fontWeight: 600,
                  fontSize: "13px",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 1px 2px rgba(0, 97, 242, 0.2)",
                  whiteSpace: "nowrap",
                }}
                onClick={() => setAddNewOpen(true)}
              >
                + ADD NEW
              </button>

              {/* DELETE */}
              <button
                type="button"
                className="btn btn-delete"
                style={{
                  height: "36px",
                  padding: "0 16px",
                  background: selectedIds.size > 0 ? "#dc2626" : "#cbd5e1",
                  color: "#ffffff",
                  fontWeight: 600,
                  fontSize: "13px",
                  border: "none",
                  borderRadius: "6px",
                  cursor: selectedIds.size > 0 ? "pointer" : "not-allowed",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  transition: "background 0.15s ease",
                  whiteSpace: "nowrap",
                }}
                disabled={selectedIds.size === 0}
                onClick={() => {
                  if (selectedIds.size > 0) setDeleteConfirmOpen(true);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                DELETE {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
              </button>
            </div>
          </div>

          {/* Collapsible Filter Panel */}
          {filterOpen && (
            <div
              id="payments-filter-card"
              className="card"
              style={{
                background: "#ffffff",
                borderRadius: "10px",
                border: "1px solid #cbd5e1",
                padding: "20px",
                marginBottom: "16px",
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: "14px", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px", marginBottom: "14px" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                Filter Options
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", columnGap: "20px", rowGap: "14px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>City</label>
                  <input
                    type="text"
                    placeholder="All / Select or type city..."
                    value={filterCity}
                    onChange={(e) => setFilterCity(e.target.value)}
                    style={{ width: "100%", height: "36px", padding: "0 10px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>Task Type</label>
                  <select
                    value={filterTaskType}
                    onChange={(e) => setFilterTaskType(e.target.value)}
                    style={{ width: "100%", height: "36px", padding: "0 10px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px", outline: "none", boxSizing: "border-box", background: "#ffffff", color: "#334155" }}
                  >
                    <option value="">All</option>
                    <option value="Physical Visit">Physical Visit</option>
                    <option value="Telecall">Telecall</option>
                    <option value="Online Support">Online Support</option>
                    <option value="Installation">Installation</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>Priority</label>
                  <select
                    value={filterPriority}
                    onChange={(e) => setFilterPriority(e.target.value)}
                    style={{ width: "100%", height: "36px", padding: "0 10px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px", outline: "none", boxSizing: "border-box", background: "#ffffff", color: "#334155" }}
                  >
                    <option value="">All</option>
                    <option value="A">Priority A</option>
                    <option value="B">Priority B</option>
                    <option value="C">Priority C</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>Task Allotted To</label>
                  <input
                    type="text"
                    placeholder="All / Allotted to..."
                    value={filterTechnician}
                    onChange={(e) => setFilterTechnician(e.target.value)}
                    style={{ width: "100%", height: "36px", padding: "0 10px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
                <div style={{ gridColumn: "span 2" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>Task Create Date Range</label>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type="date"
                      value={filterDateFrom}
                      onChange={(e) => setFilterDateFrom(e.target.value)}
                      style={{ flex: 1, height: "36px", padding: "0 10px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px", outline: "none", boxSizing: "border-box" }}
                    />
                    <span style={{ color: "#94a3b8", fontSize: "13px", fontWeight: 500 }}>to</span>
                    <input
                      type="date"
                      value={filterDateTo}
                      onChange={(e) => setFilterDateTo(e.target.value)}
                      style={{ flex: 1, height: "36px", padding: "0 10px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px", outline: "none", boxSizing: "border-box" }}
                    />
                  </div>
                </div>
              </div>

              {/* Bottom-right Reset and Search buttons matching Companies exactly */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "18px" }}>
                <button
                  type="button"
                  className="btn-filter-reset"
                  onClick={handleResetFilters}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="btn-filter-search"
                  onClick={handleSearchFilters}
                >
                  Search
                </button>
              </div>
            </div>
          )}

          {/* 3 KPI Summary Cards */}
          <div
            className="card"
            style={{
              background: "#ffffff",
              borderRadius: "10px",
              border: "1px solid #cbd5e1",
              padding: "18px 24px",
              marginBottom: "16px",
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px" }}>
              <div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>
                  TOTAL PAYMENT
                </div>
                <div style={{ fontSize: "24px", fontWeight: 700, color: "#0f172a" }}>
                  ₹ {formatCurrency(summary.total_payment)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>
                  PAID
                </div>
                <div style={{ fontSize: "24px", fontWeight: 700, color: "#16a34a" }}>
                  ₹ {formatCurrency(summary.paid)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>
                  DUE
                </div>
                <div style={{ fontSize: "24px", fontWeight: 700, color: "#0f172a" }}>
                  ₹ {formatCurrency(summary.due)}
                </div>
              </div>
            </div>
          </div>

          {/* Unified Main Data Card (Tabs + Toolbar + Table + Pagination) */}
          <div
            className="card"
            style={{
              background: "#ffffff",
              borderRadius: "10px",
              border: "1px solid #cbd5e1",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
              overflow: "hidden",
            }}
          >
            {/* Tabs inside Card */}
            <div
              style={{
                display: "flex",
                gap: "20px",
                borderBottom: "1px solid #e2e8f0",
                padding: "6px 16px 0",
                background: "#ffffff",
                overflowX: "auto",
              }}
            >
              <button
                type="button"
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: activeTab === "pending" ? "2.5px solid #0061f2" : "2.5px solid transparent",
                  color: activeTab === "pending" ? "#0061f2" : "#64748b",
                  fontWeight: 700,
                  fontSize: "13.5px",
                  paddingBottom: "8px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
                onClick={() => handleTabChange("pending")}
              >
                Pending ({summary.pending_count})
              </button>
              <button
                type="button"
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: activeTab === "completed" ? "2.5px solid #0061f2" : "2.5px solid transparent",
                  color: activeTab === "completed" ? "#0061f2" : "#64748b",
                  fontWeight: 700,
                  fontSize: "13.5px",
                  paddingBottom: "8px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
                onClick={() => handleTabChange("completed")}
              >
                Completed ({summary.completed_count})
              </button>
            </div>

            {/* Sub-toolbar inside Card */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 16px",
                gap: "10px",
                flexWrap: "wrap",
                borderBottom: "1px solid #f1f5f9",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span style={{ fontSize: "13px", color: "#64748b", fontWeight: 500 }}>Items/Page</span>
              </div>

              <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  style={{
                    width: "260px",
                    padding: "8px 36px 8px 14px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth="2"
                  style={{ position: "absolute", right: "12px", pointerEvents: "none" }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
            </div>

            {/* Table with responsive horizontal scroll */}
            <div style={{ width: "100%", overflowX: "auto" }}>
              <table className="payments-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ width: 40, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={allCurrentSelected}
                        onChange={toggleSelectAll}
                        style={{ cursor: "pointer", width: 16, height: 16 }}
                      />
                    </th>
                    <th>Company Name</th>
                    <th>Task Type</th>
                    <th>City</th>
                    <th style={{ textAlign: "center" }}>Priority</th>
                    <th>Machine & Model</th>
                    <th>Contact Person</th>
                    <th>Task Date & Task By</th>
                    <th>Task Approved By</th>
                    <th>Task Allotted To</th>
                    <th>Total Amount</th>
                    <th>Paid/Due</th>
                    <th>Task Status</th>
                    <th style={{ width: 50, textAlign: "center" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <TechnicalPaymentsSkeletonRows count={pageSize > 10 ? 8 : pageSize} />
                  ) : tasks.length === 0 ? (
                    <tr>
                      <td colSpan={14} style={{ textAlign: "center", padding: "60px 20px" }}>
                        <div
                          style={{
                            width: "48px",
                            height: "48px",
                            margin: "0 auto 12px",
                            borderRadius: "50%",
                            background: "#f1f5f9",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#94a3b8",
                          }}
                        >
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="2" y="5" width="20" height="14" rx="2" />
                            <line x1="2" y1="10" x2="22" y2="10" />
                          </svg>
                        </div>
                        <div style={{ fontSize: "15px", fontWeight: 600, color: "#1e293b", marginBottom: "4px" }}>
                          No payment records found
                        </div>
                        <div style={{ fontSize: "13px", color: "#64748b" }}>
                          {searchQuery || Object.values(appliedFilters).some(Boolean)
                            ? "Try clearing or adjusting your search / filter criteria."
                            : `No ${activeTab} payments available.`}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    tasks.map((task) => {
                      const isSelected = selectedIds.has(task.id);
                      const serviceCharge = Number(task.service_charge || 0);
                      const paidAmount = Number(task.collected_amount || 0);
                      const dueAmount = Math.max(0, serviceCharge - paidAmount);

                      // Task type badge class
                      const taskTypeLower = (task.task_type || "").toLowerCase();
                      const taskTypeBadge = taskTypeLower.includes("physical")
                        ? "physical"
                        : taskTypeLower.includes("telecall")
                        ? "telecall"
                        : "default";

                      // Status badge class
                      const statusLower = (task.status || "").toLowerCase();
                      const statusBadge = statusLower.includes("complete")
                        ? "completed"
                        : statusLower.includes("approve")
                        ? "approved"
                        : "pending";

                      return (
                        <tr key={task.id} className={isSelected ? "selected" : ""}>
                          <td style={{ textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectRow(task.id)}
                              style={{ cursor: "pointer", width: 15, height: 15 }}
                            />
                          </td>
                          <td>
                            <a
                              href="#details"
                              className="payment-company-link"
                              onClick={(e) => {
                                e.preventDefault();
                                setDetailTask(task);
                              }}
                            >
                              {task.company_name}
                            </a>
                          </td>
                          <td>
                            <span className={`badge-task-type ${taskTypeBadge}`}>
                              {task.task_type || "Physical Visit"}
                            </span>
                          </td>
                          <td>{task.city || "-"}</td>
                          <td style={{ textAlign: "center", fontWeight: 600 }}>{task.priority || "A"}</td>
                          <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={task.machine_model}>
                            {task.machine_model || "Service Charges"}
                          </td>
                          <td>
                            {task.contact_person_name || "-"}{" "}
                            {task.contact_phone ? (
                              <span style={{ color: "#64748b" }}>/ {task.contact_phone}</span>
                            ) : null}
                          </td>
                          <td>
                            <span>{task.task_created_date || "-"}</span>{" "}
                            <span style={{ color: "#64748b" }}>{task.created_by_name || "Inhyma Admin"}</span>
                          </td>
                          <td>{task.task_approved_by || "Inhyma Admin"}</td>
                          <td>{task.task_allotted_to || "ABC"}</td>
                          <td>
                            <div className="payment-amount-cell">
                              <span className="badge-chargeable">Chargable</span>
                              <span style={{ fontWeight: 600 }}>₹{formatNumber(serviceCharge)}</span>
                            </div>
                          </td>
                          <td>
                            <div className="payment-due-cell">
                              {paidAmount > 0 && (
                                <div className="payment-paid-text">
                                  Paid: ₹{formatNumber(paidAmount)}
                                </div>
                              )}
                              {dueAmount > 0 ? (
                                <div className="payment-due-text">
                                  Due: ₹{formatNumber(dueAmount)}
                                </div>
                              ) : (
                                paidAmount === 0 && <div className="payment-due-text">Due: ₹{formatNumber(serviceCharge)}</div>
                              )}
                            </div>
                          </td>
                          <td>
                            <span className={`badge-task-status ${statusBadge}`}>
                              {task.status || "Approved"}
                            </span>
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <div className="payment-action-menu-wrapper">
                              <button
                                type="button"
                                className="btn-payment-action"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenActionMenuId(openActionMenuId === task.id ? null : task.id);
                                }}
                              >
                                &#8942;
                              </button>

                              {openActionMenuId === task.id && (
                                <div className="payment-action-dropdown">
                                  <button
                                    type="button"
                                    onClick={() => openRecordPayment(task)}
                                  >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M6 3h12" />
                                      <path d="M6 8h12" />
                                      <path d="m6 13 8.5 8" />
                                      <path d="M6 13h3" />
                                      <path d="M9 13c6.667 0 6.667-10 0-10" />
                                    </svg>
                                    Record Payment
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDetailTask(task);
                                      setOpenActionMenuId(null);
                                    }}
                                  >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                      <circle cx="12" cy="12" r="3" />
                                    </svg>
                                    View Details
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls inside Card matching Companies */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 16px",
                borderTop: "1px solid #e2e8f0",
                background: "#ffffff",
                flexWrap: "wrap",
                gap: "10px",
              }}
            >
              <div style={{ fontSize: "13px", color: "#64748b" }}>
                Showing{" "}
                <strong style={{ color: "#1e293b" }}>
                  {totalRecords === 0 ? 0 : (page - 1) * pageSize + 1}
                </strong>
                {" "}–{" "}
                <strong style={{ color: "#1e293b" }}>
                  {Math.min(page * pageSize, totalRecords)}
                </strong>
                {" "}of{" "}
                <strong style={{ color: "#1e293b" }}>{totalRecords}</strong>
                {" "}total (Page {page} of {Math.max(1, Math.ceil(totalRecords / pageSize))})
              </div>

              <Pagination
                pagination={paginationMeta}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
              />
            </div>
          </div>

          {/* Record / Collect Payment Modal */}
          {recordPaymentTask && (
            <Modal
              open={Boolean(recordPaymentTask)}
              variant="center"
              title={`Record Payment — ${recordPaymentTask.company_name}`}
              onClose={() => setRecordPaymentTask(null)}
            >
              <form onSubmit={handleSavePayment} className="payment-modal-form">
                <div className="payment-summary-box">
                  <div>
                    <div className="payment-summary-stat-label">Total Amount</div>
                    <div className="payment-summary-stat-val" style={{ color: "#0f172a" }}>
                      ₹{formatNumber(recordPaymentTask.service_charge || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="payment-summary-stat-label">Already Paid</div>
                    <div className="payment-summary-stat-val" style={{ color: "#16a34a" }}>
                      ₹{formatNumber(recordPaymentTask.collected_amount || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="payment-summary-stat-label">Balance Due</div>
                    <div className="payment-summary-stat-val" style={{ color: "#dc2626" }}>
                      ₹{formatNumber(Math.max(0, Number(recordPaymentTask.service_charge || 0) - Number(recordPaymentTask.collected_amount || 0)))}
                    </div>
                  </div>
                </div>

                <div className="payment-form-grid">
                  <div className="payment-form-group">
                    <label>Amount to Collect (₹) *</label>
                    <input
                      type="number"
                      step="any"
                      required
                      placeholder="Enter amount"
                      value={collectAmount}
                      onChange={(e) => setCollectAmount(e.target.value)}
                    />
                  </div>

                  <div className="payment-form-group">
                    <label>Payment Mode *</label>
                    <select
                      value={paymentMode}
                      onChange={(e) => setPaymentMode(e.target.value)}
                    >
                      <option value="Company Acc">Company Acc</option>
                      <option value="Self collect">Self collect</option>
                      <option value="UPI / QR">UPI / QR</option>
                      <option value="Cheque">Cheque</option>
                      <option value="Cash">Cash</option>
                      <option value="Bank Transfer (NEFT/RTGS)">Bank Transfer</option>
                    </select>
                  </div>

                  <div className="payment-form-group">
                    <label>Payment Date</label>
                    <input
                      type="date"
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                    />
                  </div>

                  <div className="payment-form-group">
                    <label>Reference / UTR / Cheque No</label>
                    <input
                      type="text"
                      placeholder="e.g. UTR12345678"
                      value={referenceNo}
                      onChange={(e) => setReferenceNo(e.target.value)}
                    />
                  </div>

                  <div className="payment-form-group full-width">
                    <label>Payment Screenshot / Receipt</label>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={handleScreenshotUpload}
                        disabled={uploadingScreenshot}
                      />
                      {uploadingScreenshot && <span style={{ fontSize: "12px", color: "#007bff" }}>Uploading...</span>}
                      {paymentScreenshotUrl && (
                        <a
                          href={paymentScreenshotUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: "12px", color: "#007bff", textDecoration: "underline" }}
                        >
                          View Uploaded
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="payment-form-group full-width">
                    <label>Remarks / Notes</label>
                    <textarea
                      placeholder="Enter payment remarks or collection notes..."
                      value={paymentRemarks}
                      onChange={(e) => setPaymentRemarks(e.target.value)}
                    />
                  </div>
                </div>

                <div className="payment-modal-footer">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setRecordPaymentTask(null)}
                    disabled={savingPayment}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={savingPayment}
                  >
                    {savingPayment ? "Saving..." : "Save Payment"}
                  </button>
                </div>
              </form>
            </Modal>
          )}

          {/* Add New Payment / Task Modal */}
          {addNewOpen && (
            <Modal
              open={addNewOpen}
              variant="center"
              title="Add New Payment"
              onClose={() => setAddNewOpen(false)}
            >
              <form onSubmit={handleCreateNewPayment} className="payment-modal-form">
                <div className="payment-form-grid">
                  <div className="payment-form-group full-width">
                    <label>Company Name *</label>
                    <ClientNameAutocomplete
                      value={newCompanyName}
                      onChange={setNewCompanyName}
                      onSelectCompany={(item: CompanyAutocompleteItem) => {
                        setNewCompanyName(item.company_name);
                        setNewCompanyId(item.id || null);
                        if (item.city_name) setNewCity(item.city_name);
                        if (item.contact_full_name) setNewContactPerson(item.contact_full_name);
                        if (item.contact_calling_number) setNewContactPhone(item.contact_calling_number);
                      }}
                      placeholder="Search or enter company..."
                      required
                    />
                  </div>

                  <div className="payment-form-group">
                    <label>City *</label>
                    <input
                      type="text"
                      required
                      placeholder="City"
                      value={newCity}
                      onChange={(e) => setNewCity(e.target.value)}
                    />
                  </div>

                  <div className="payment-form-group">
                    <label>Task Type</label>
                    <select
                      value={newTaskType}
                      onChange={(e) => setNewTaskType(e.target.value)}
                    >
                      <option value="Physical Visit">Physical Visit</option>
                      <option value="Telecall">Telecall</option>
                      <option value="Online Support">Online Support</option>
                      <option value="Installation">Installation</option>
                    </select>
                  </div>

                  <div className="payment-form-group full-width">
                    <label>Machine & Model</label>
                    <input
                      type="text"
                      placeholder="e.g. GF5000F Granular Filler FFS"
                      value={newMachineModel}
                      onChange={(e) => setNewMachineModel(e.target.value)}
                    />
                  </div>

                  <div className="payment-form-group">
                    <label>Contact Person</label>
                    <input
                      type="text"
                      placeholder="Contact name"
                      value={newContactPerson}
                      onChange={(e) => setNewContactPerson(e.target.value)}
                    />
                  </div>

                  <div className="payment-form-group">
                    <label>Contact Phone</label>
                    <input
                      type="text"
                      placeholder="Phone number"
                      value={newContactPhone}
                      onChange={(e) => setNewContactPhone(e.target.value)}
                    />
                  </div>

                  <div className="payment-form-group">
                    <label>Total Chargeable Amount (₹) *</label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={newServiceCharge}
                      onChange={(e) => setNewServiceCharge(e.target.value)}
                    />
                  </div>

                  <div className="payment-form-group">
                    <label>Collected Amount (₹)</label>
                    <input
                      type="number"
                      step="any"
                      placeholder="Amount collected now"
                      value={newCollectedAmount}
                      onChange={(e) => setNewCollectedAmount(e.target.value)}
                    />
                  </div>

                  <div className="payment-form-group">
                    <label>Payment Mode</label>
                    <select
                      value={newPaymentMode}
                      onChange={(e) => setNewPaymentMode(e.target.value)}
                    >
                      <option value="Company Acc">Company Acc</option>
                      <option value="Self collect">Self collect</option>
                      <option value="UPI / QR">UPI / QR</option>
                      <option value="Cheque">Cheque</option>
                      <option value="Cash">Cash</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                    </select>
                  </div>

                  <div className="payment-form-group">
                    <label>Payment Date</label>
                    <input
                      type="date"
                      value={newPaymentDate}
                      onChange={(e) => setNewPaymentDate(e.target.value)}
                    />
                  </div>

                  <div className="payment-form-group full-width">
                    <label>Reference No</label>
                    <input
                      type="text"
                      placeholder="Transaction / Reference ID"
                      value={newRefNo}
                      onChange={(e) => setNewRefNo(e.target.value)}
                    />
                  </div>

                  <div className="payment-form-group full-width">
                    <label>Remarks</label>
                    <textarea
                      placeholder="Additional remarks..."
                      value={newRemarks}
                      onChange={(e) => setNewRemarks(e.target.value)}
                    />
                  </div>
                </div>

                <div className="payment-modal-footer">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setAddNewOpen(false)}
                    disabled={savingNewPayment}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={savingNewPayment}
                  >
                    {savingNewPayment ? "Creating..." : "Save Payment"}
                  </button>
                </div>
              </form>
            </Modal>
          )}

          {/* Details Modal */}
          {detailTask && (
            <Modal
              open={Boolean(detailTask)}
              variant="center"
              title={`Payment Details — ${detailTask.company_name}`}
              onClose={() => setDetailTask(null)}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="payment-summary-box">
                  <div>
                    <div className="payment-summary-stat-label">Total Amount</div>
                    <div className="payment-summary-stat-val">₹{formatNumber(detailTask.service_charge || 0)}</div>
                  </div>
                  <div>
                    <div className="payment-summary-stat-label">Collected</div>
                    <div className="payment-summary-stat-val" style={{ color: "#16a34a" }}>
                      ₹{formatNumber(detailTask.collected_amount || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="payment-summary-stat-label">Balance Due</div>
                    <div className="payment-summary-stat-val" style={{ color: "#dc2626" }}>
                      ₹{formatNumber(Math.max(0, Number(detailTask.service_charge || 0) - Number(detailTask.collected_amount || 0)))}
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px", fontSize: "13px" }}>
                  <div><strong>Company:</strong> {detailTask.company_name}</div>
                  <div><strong>City:</strong> {detailTask.city || "-"}</div>
                  <div><strong>Machine & Model:</strong> {detailTask.machine_model || "-"}</div>
                  <div><strong>Task Type:</strong> {detailTask.task_type || "-"}</div>
                  <div><strong>Contact Person:</strong> {detailTask.contact_person_name || "-"} ({detailTask.contact_phone || "-"})</div>
                  <div><strong>Task Date:</strong> {detailTask.task_created_date || "-"}</div>
                  <div><strong>Approved By:</strong> {detailTask.task_approved_by || "-"}</div>
                  <div><strong>Allotted To:</strong> {detailTask.task_allotted_to || "-"}</div>
                  <div><strong>Payment Status:</strong> {detailTask.payment_status || "Pending"}</div>
                  <div><strong>Payment Mode:</strong> {detailTask.payment_mode || "-"}</div>
                  <div><strong>Task Status:</strong> {detailTask.status}</div>
                </div>

                {detailTask.payment_screenshot && (
                  <div>
                    <strong style={{ fontSize: "12px" }}>Payment Screenshot / Receipt:</strong>
                    <div style={{ marginTop: 6 }}>
                      <a href={detailTask.payment_screenshot} target="_blank" rel="noreferrer">
                        <img
                          src={detailTask.payment_screenshot}
                          alt="Payment Screenshot"
                          style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 4, border: "1px solid #e2e8f0" }}
                        />
                      </a>
                    </div>
                  </div>
                )}

                <div className="payment-modal-footer">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setDetailTask(null)}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      const t = detailTask;
                      setDetailTask(null);
                      openRecordPayment(t);
                    }}
                  >
                    Record Payment
                  </button>
                </div>
              </div>
            </Modal>
          )}

          {/* Bulk Delete Confirm Modal */}
          {deleteConfirmOpen && (
            <Modal
              open={deleteConfirmOpen}
              variant="center"
              title="Confirm Delete"
              onClose={() => setDeleteConfirmOpen(false)}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <p style={{ margin: 0, fontSize: "14px", color: "#334155" }}>
                  Are you sure you want to delete the <strong>{selectedIds.size}</strong> selected payment record(s)?
                </p>
                <div className="payment-modal-footer">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setDeleteConfirmOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ backgroundColor: "#dc2626" }}
                    onClick={handleBulkDelete}
                  >
                    Yes, Delete
                  </button>
                </div>
              </div>
            </Modal>
          )}
        </main>
      </ErrorBoundary>
    </AppShell>
  );
}

export default PaymentsPage;
