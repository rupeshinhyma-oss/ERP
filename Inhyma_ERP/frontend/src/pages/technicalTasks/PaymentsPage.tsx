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
      if (filterCity.trim()) params.city = filterCity.trim();
      if (filterTaskType.trim()) params.task_type = filterTaskType.trim();
      if (filterPriority.trim()) params.priority = filterPriority.trim();
      if (filterTechnician.trim()) params.task_allotted_to = filterTechnician.trim();
      if (filterDateFrom) params.date_from = filterDateFrom;
      if (filterDateTo) params.date_to = filterDateTo;

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
    filterCity,
    filterTaskType,
    filterPriority,
    filterTechnician,
    filterDateFrom,
    filterDateTo,
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
        <div className="page-payments">
          {banner && (
            <Banner
              error={banner.type === "error" ? banner.message : undefined}
              success={banner.type === "success" ? banner.message : undefined}
            />
          )}

          {/* Top Header */}
          <div className="payments-header">
            <h1 className="payments-title">Payments</h1>
            <div className="payments-header-actions">
              <button
                type="button"
                className={`btn-payment-filter ${filterOpen ? "active" : ""}`}
                onClick={() => setFilterOpen((prev) => !prev)}
                title="Filter records"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
              </button>

              <button
                type="button"
                className="btn-payment-add"
                onClick={() => setAddNewOpen(true)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                + ADD NEW
              </button>

              <button
                type="button"
                className="btn-payment-delete"
                onClick={() => {
                  if (selectedIds.size === 0) {
                    setBanner({ type: "info", message: "Please select one or more items to delete." });
                    return;
                  }
                  setDeleteConfirmOpen(true);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                DELETE
              </button>
            </div>
          </div>

          {/* 3 KPI Summary Cards */}
          <div className="payment-kpi-container">
            <div className="payment-kpi-card">
              <div className="payment-kpi-label">TOTAL PAYMENT</div>
              <div className="payment-kpi-value total">
                ₹ {formatCurrency(summary.total_payment)}
              </div>
            </div>
            <div className="payment-kpi-card">
              <div className="payment-kpi-label">PAID</div>
              <div className="payment-kpi-value paid">
                ₹ {formatCurrency(summary.paid)}
              </div>
            </div>
            <div className="payment-kpi-card">
              <div className="payment-kpi-label">DUE</div>
              <div className="payment-kpi-value due">
                ₹ {formatCurrency(summary.due)}
              </div>
            </div>
          </div>

          {/* Tabs: Pending (count) | Completed (count) */}
          <div className="payments-tabs-nav">
            <button
              type="button"
              className={`payments-tab-item ${activeTab === "pending" ? "active" : ""}`}
              onClick={() => handleTabChange("pending")}
            >
              Pending ({summary.pending_count})
            </button>
            <button
              type="button"
              className={`payments-tab-item ${activeTab === "completed" ? "active" : ""}`}
              onClick={() => handleTabChange("completed")}
            >
              Completed ({summary.completed_count})
            </button>
          </div>

          {/* Subbar: Items/Page & Search */}
          <div className="payments-subbar">
            <div>
              <select
                className="payments-page-size-select"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                <option value={10}>10 Items/Page</option>
                <option value={25}>25 Items/Page</option>
                <option value={50}>50 Items/Page</option>
                <option value={100}>100 Items/Page</option>
              </select>
            </div>

            <div className="payments-search-wrapper">
              <span className="payments-search-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>

          {/* Collapsible Filter Panel */}
          {filterOpen && (
            <div className="payments-filter-panel">
              <div className="payments-filter-grid">
                <div className="payments-filter-item">
                  <label>City</label>
                  <input
                    type="text"
                    placeholder="Filter by city..."
                    value={filterCity}
                    onChange={(e) => setFilterCity(e.target.value)}
                  />
                </div>
                <div className="payments-filter-item">
                  <label>Task Type</label>
                  <select
                    value={filterTaskType}
                    onChange={(e) => setFilterTaskType(e.target.value)}
                  >
                    <option value="">All Types</option>
                    <option value="Physical Visit">Physical Visit</option>
                    <option value="Telecall">Telecall</option>
                    <option value="Online Support">Online Support</option>
                    <option value="Installation">Installation</option>
                  </select>
                </div>
                <div className="payments-filter-item">
                  <label>Priority</label>
                  <select
                    value={filterPriority}
                    onChange={(e) => setFilterPriority(e.target.value)}
                  >
                    <option value="">All Priorities</option>
                    <option value="A">Priority A</option>
                    <option value="B">Priority B</option>
                    <option value="C">Priority C</option>
                  </select>
                </div>
                <div className="payments-filter-item">
                  <label>Technician</label>
                  <input
                    type="text"
                    placeholder="Allotted to..."
                    value={filterTechnician}
                    onChange={(e) => setFilterTechnician(e.target.value)}
                  />
                </div>
                <div className="payments-filter-item">
                  <label>From Date</label>
                  <input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                  />
                </div>
                <div className="payments-filter-item">
                  <label>To Date</label>
                  <input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                  />
                </div>
                <div>
                  <button
                    type="button"
                    className="btn-filter-reset"
                    onClick={handleResetFilters}
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Data Table */}
          <div className="payments-table-card">
            <div className="payments-table-responsive">
              <table className="payments-table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        checked={allCurrentSelected}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th>Company Name</th>
                    <th>Task Type</th>
                    <th>City</th>
                    <th>Priority</th>
                    <th>Machine & Model</th>
                    <th>Contact Person</th>
                    <th>Task Date & Task By</th>
                    <th>Task Approved By</th>
                    <th>Task Allotted To</th>
                    <th>Total Amount</th>
                    <th>Paid/Due</th>
                    <th>Task Status</th>
                    <th style={{ width: 44, textAlign: "center" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <TechnicalPaymentsSkeletonRows count={pageSize > 10 ? 8 : pageSize} />
                  ) : tasks.length === 0 ? (
                    <tr>
                      <td colSpan={14} style={{ textAlign: "center", padding: "48px 14px", color: "#64748b", fontSize: "14px" }}>
                        No Data
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
                          <td>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectRow(task.id)}
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
                          <td style={{ fontWeight: 600 }}>{task.priority || "A"}</td>
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

            {/* Pagination Controls */}
            <div className="pagination" style={{ padding: "8px 16px 16px" }}>
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
        </div>
      </ErrorBoundary>
    </AppShell>
  );
}

export default PaymentsPage;
