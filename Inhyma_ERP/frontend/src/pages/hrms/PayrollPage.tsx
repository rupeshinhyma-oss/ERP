import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import {
  IconCoins,
  IconPlus,
  IconEdit,
  IconTrash,
  IconCheckSquare,
  IconSearch,
  IconFileText,
  IconRefresh,
} from "@/components/icons";
import { apiDelete, apiGet, apiPost, apiPut, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import { generatePayslipPdf, formatInr } from "@/lib/payrollPayslipPdf";
import { PayrollDrawer } from "@/components/PayrollDrawer";
import "./hrms.css";

// ===========================================================================
// Types
// ===========================================================================

export interface PayrollComponent {
  id: string;
  name: string;
  code: string;
  component_type: "EARNING" | "DEDUCTION";
  calculation_type: string; // "PERCENTAGE" | "FIXED" | "PERCENTAGE_OF_CTC" | "PERCENTAGE_OF_BASIC"
  value: number;
  calculation_basis?: string | null;
  is_taxable: boolean;
  is_statutory: boolean;
  display_order: number;
  is_active: boolean;
  description?: string | null;
}

export interface SalaryBreakdownItem {
  component_id?: string | null;
  code: string;
  name: string;
  type: string;
  calculation_type: string;
  calculation_basis?: string | null;
  rate_or_pct: number;
  monthly_amount: number;
  annual_amount: number;
}

export interface SalaryPreviewData {
  annual_ctc: number;
  monthly_ctc: number;
  earnings: SalaryBreakdownItem[];
  deductions: SalaryBreakdownItem[];
  monthly_gross: number;
  total_deductions: number;
  estimated_net_salary: number;
  annual_gross: number;
  annual_net: number;
}

export interface EmployeeSalaryItem {
  employee_id: string;
  employee_name: string;
  employee_code: string;
  department: string;
  designation: string;
  annual_ctc: number | null;
  monthly_ctc: number | null;
  effective_from: string | null;
  has_salary: boolean;
  salary_id?: string | null;
  revision_count: number;
  structure_breakdown?: SalaryPreviewData | null;
  status: string;
}

export interface SalaryRevision {
  id: string;
  employee_id: string;
  annual_ctc: number;
  monthly_ctc: number;
  effective_from: string;
  is_active: boolean;
  structure_breakdown?: SalaryPreviewData | null;
  notes?: string | null;
  created_at: string;
}

export interface PayrollEditAuditEntry {
  timestamp: string;
  edited_by_id?: string;
  edited_by_name?: string;
  reason: string;
  changes: Record<string, { old: any; new: any }>;
}

export interface MonthlyPayrollItem {
  id: string;
  payroll_id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  department: string;
  designation: string;
  payroll_month: string;
  annual_ctc: number;
  monthly_ctc: number;
  working_days: number;
  present_days: number;
  paid_leave_days: number;
  holiday_days: number;
  weekend_days: number;
  lop_days: number;
  earnings_breakdown: Array<{ name: string; monthly_amount: number; code?: string }>;
  deductions_breakdown: Array<{ name: string; monthly_amount: number; code?: string }>;
  additions_breakdown: Array<{ title: string; amount: number; reason?: string }>;
  lop_deduction: number;
  gross_amount: number;
  total_deductions: number;
  net_salary: number;
  status: string;
  calculation_details?: any;
  edit_history?: PayrollEditAuditEntry[];
}

export interface MonthlyPayrollRecord {
  id: string;
  payroll_month: string;
  payroll_year: number;
  month_number: number;
  status: string; // DRAFT / REVIEW / APPROVED
  total_employees: number;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  working_days: number;
  weekend_days: number;
  holiday_days: number;
  processed_at?: string | null;
  approved_at?: string | null;
  notes?: string | null;
  items: MonthlyPayrollItem[];
}

export function formatMonthDisplay(monthStr?: string): string {
  if (!monthStr) return "";
  try {
    const [year, month] = monthStr.split("-");
    const d = new Date(parseInt(year), parseInt(month) - 1, 1);
    return d.toLocaleString("en-US", { month: "long", year: "numeric" });
  } catch {
    return monthStr;
  }
}

// ===========================================================================
// Payroll Page Component
// ===========================================================================

export function PayrollPage() {
  const { profile, isSuperAdmin, hasPermission } = useAuth();
  const showToast = useToast();

  // Check if current user is HR or Admin
  const isAdmin = useMemo(() => {
    return Boolean(
      isSuperAdmin ||
      hasPermission("*") ||
      hasPermission("admin") ||
      hasPermission("hrms") ||
      hasPermission("hrms.manage") ||
      hasPermission("hrms.view") ||
      hasPermission("hrms.update") ||
      hasPermission("hrms.approve") ||
      hasPermission("hrms:admin") ||
      hasPermission("hrms:payroll:manage") ||
      hasPermission("user.view") ||
      hasPermission("user.manage") ||
      profile?.username === "admin" ||
      profile?.username === "super_admin" ||
      profile?.username === "hr" ||
      String((profile as any)?.role || "").toLowerCase() === "hr" ||
      String((profile as any)?.role || "").toLowerCase() === "admin" ||
      profile?.roles?.some((r: any) => String(r.name || r).toLowerCase() === "hr" || String(r.name || r).toLowerCase() === "admin")
    );
  }, [isSuperAdmin, hasPermission, profile]);

  // PRIMARY WORKFLOW TABS: Strictly 3 tabs for Admin
  const [activeTab, setActiveTab] = useState<"setup" | "salary" | "monthly">("setup");

  // ---------------------------------------------------------------------------
  // TAB 1: Global Setup State (Configuration-Driven Earnings & Deductions)
  // ---------------------------------------------------------------------------
  const [components, setComponents] = useState<PayrollComponent[]>([]);
  const [loadingComponents, setLoadingComponents] = useState(false);
  const [showComponentModal, setShowComponentModal] = useState(false);
  const [editingComponent, setEditingComponent] = useState<PayrollComponent | null>(null);

  const [compForm, setCompForm] = useState({
    name: "",
    code: "",
    component_type: "EARNING" as "EARNING" | "DEDUCTION",
    calculation_type: "PERCENTAGE", // "PERCENTAGE" | "FIXED"
    value: 50,
    calculation_basis: "CTC", // "CTC", "BASIC", "GROSS", or custom component code
    is_taxable: true,
    is_statutory: false,
    display_order: 1,
    is_active: true,
    description: "",
  });

  // Live Rule Simulator inside Setup
  const [testAnnualCtc, setTestAnnualCtc] = useState<number>(420000);
  const [setupPreview, setSetupPreview] = useState<SalaryPreviewData | null>(null);

  const fetchComponents = useCallback(async () => {
    try {
      setLoadingComponents(true);
      const res = await apiGet<PayrollComponent[]>("/hrms/payroll/components?include_inactive=true");
      setComponents(res.data || []);
    } catch (err) {
      showToast(errorMessage(err) || "Failed to load payroll rules", "error");
    } finally {
      setLoadingComponents(false);
    }
  }, [showToast]);

  const fetchSetupPreview = useCallback(async (ctc: number) => {
    if (ctc <= 0) return;
    try {
      const res = await apiPost<SalaryPreviewData>("/hrms/payroll/preview", {
        annual_ctc: ctc,
      });
      setSetupPreview(res.data);
    } catch {
      // preview calculation fallback
    }
  }, []);

  const openAddComponent = (type: "EARNING" | "DEDUCTION") => {
    setEditingComponent(null);
    setCompForm({
      name: "",
      code: "",
      component_type: type,
      calculation_type: type === "EARNING" ? "PERCENTAGE" : "FIXED",
      value: type === "EARNING" ? 50 : 200,
      calculation_basis: type === "EARNING" ? "CTC" : "BASIC",
      is_taxable: true,
      is_statutory: false,
      display_order: components.length + 1,
      is_active: true,
      description: "",
    });
    setShowComponentModal(true);
  };

  const openEditComponent = (comp: PayrollComponent) => {
    setEditingComponent(comp);
    let calcType = "FIXED";
    let calcBasis = comp.calculation_basis || "CTC";

    if (comp.calculation_type && comp.calculation_type.includes("PERCENTAGE")) {
      calcType = "PERCENTAGE";
      if (comp.calculation_type === "PERCENTAGE_OF_BASIC") calcBasis = "BASIC";
      else if (comp.calculation_type === "PERCENTAGE_OF_CTC") calcBasis = "CTC";
      else if (comp.calculation_basis) calcBasis = comp.calculation_basis;
    }

    setCompForm({
      name: comp.name,
      code: comp.code,
      component_type: comp.component_type,
      calculation_type: calcType,
      value: comp.value,
      calculation_basis: calcBasis,
      is_taxable: comp.is_taxable,
      is_statutory: comp.is_statutory,
      display_order: comp.display_order,
      is_active: comp.is_active,
      description: comp.description || "",
    });
    setShowComponentModal(true);
  };

  const handleSaveComponent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!compForm.name.trim() || !compForm.code.trim()) {
      showToast("Name and Code are required.", "error");
      return;
    }

    const payload = {
      name: compForm.name.trim(),
      code: compForm.code.trim().toUpperCase(),
      component_type: compForm.component_type,
      calculation_type: compForm.calculation_type,
      value: Number(compForm.value),
      calculation_basis: compForm.calculation_type === "PERCENTAGE" ? compForm.calculation_basis : null,
      is_taxable: compForm.is_taxable,
      is_statutory: compForm.is_statutory,
      display_order: compForm.display_order,
      is_active: compForm.is_active,
      description: compForm.description.trim() || null,
    };

    try {
      if (editingComponent) {
        await apiPut(`/hrms/payroll/components/${editingComponent.id}`, payload);
        showToast(`Payroll component '${payload.name}' updated.`, "success");
      } else {
        await apiPost("/hrms/payroll/components", payload);
        showToast(`Payroll component '${payload.name}' created.`, "success");
      }
      setShowComponentModal(false);
      setEditingComponent(null);
      fetchComponents();
      fetchSetupPreview(testAnnualCtc);
    } catch (err) {
      showToast(errorMessage(err) || "Failed to save payroll component", "error");
    }
  };

  const handleDeleteComponent = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this payroll component?")) return;
    try {
      await apiDelete(`/hrms/payroll/components/${id}`);
      showToast("Payroll component deleted.", "success");
      await fetchComponents();
      await fetchSetupPreview(testAnnualCtc);
      await fetchEmployeeSalaries();
      if (activeTab === "monthly") {
        await fetchMonthlyPayroll(selectedMonth);
      }
    } catch (err) {
      showToast(errorMessage(err) || "Failed to delete component", "error");
    }
  };

  const handleToggleActiveComponent = async (comp: PayrollComponent) => {
    try {
      await apiPut(`/hrms/payroll/components/${comp.id}`, {
        name: comp.name,
        code: comp.code,
        component_type: comp.component_type,
        calculation_type: comp.calculation_type,
        value: comp.value,
        calculation_basis: comp.calculation_basis,
        is_taxable: comp.is_taxable,
        is_statutory: comp.is_statutory,
        display_order: comp.display_order,
        is_active: !comp.is_active,
        description: comp.description,
      });
      showToast(`Component '${comp.name}' set to ${!comp.is_active ? "Active" : "Inactive"}.`, "success");
      await fetchComponents();
      await fetchSetupPreview(testAnnualCtc);
      await fetchEmployeeSalaries();
      if (activeTab === "monthly") {
        await fetchMonthlyPayroll(selectedMonth);
      }
    } catch (err) {
      showToast(errorMessage(err) || "Failed to update component status", "error");
    }
  };

  const earningComponents = useMemo(() => {
    return components.filter((c) => c.component_type === "EARNING");
  }, [components]);

  const deductionComponents = useMemo(() => {
    return components.filter((c) => c.component_type === "DEDUCTION");
  }, [components]);

  // ---------------------------------------------------------------------------
  // TAB 2: Employee Salaries State (Real System Employees)
  // ---------------------------------------------------------------------------
  const [employeeSalaries, setEmployeeSalaries] = useState<EmployeeSalaryItem[]>([]);
  const [salarySearch, setSalarySearch] = useState("");
  const [loadingSalaries, setLoadingSalaries] = useState(false);
  const [showSalaryModal, setShowSalaryModal] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<EmployeeSalaryItem | null>(null);
  const [assignForm, setAssignForm] = useState({
    annual_ctc: 420000,
    effective_from: new Date().toISOString().split("T")[0],
    notes: "",
  });
  const [liveEmpPreview, setLiveEmpPreview] = useState<SalaryPreviewData | null>(null);
  const [savingSalary, setSavingSalary] = useState(false);
  const [revisions, setRevisions] = useState<SalaryRevision[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(false);

  const fetchEmployeeSalaries = useCallback(async () => {
    try {
      setLoadingSalaries(true);
      const res = await apiGet<EmployeeSalaryItem[]>("/hrms/payroll/employees");
      setEmployeeSalaries(res.data || []);
    } catch (err) {
      showToast(errorMessage(err) || "Failed to load employee salaries", "error");
    } finally {
      setLoadingSalaries(false);
    }
  }, [showToast]);

  // Live preview for employee modal as Annual CTC changes
  useEffect(() => {
    let active = true;
    const compute = async () => {
      if (assignForm.annual_ctc > 0) {
        try {
          const res = await apiPost<SalaryPreviewData>("/hrms/payroll/preview", {
            annual_ctc: assignForm.annual_ctc,
          });
          if (active) setLiveEmpPreview(res.data);
        } catch {
          // ignore
        }
      }
    };
    compute();
    return () => {
      active = false;
    };
  }, [assignForm.annual_ctc]);

  const openSalaryModal = async (emp: EmployeeSalaryItem) => {
    setSelectedEmp(emp);
    const initialCtc = emp.annual_ctc && emp.annual_ctc > 0 ? emp.annual_ctc : 420000;
    setAssignForm({
      annual_ctc: initialCtc,
      effective_from: emp.effective_from || new Date().toISOString().split("T")[0],
      notes: "",
    });
    setShowSalaryModal(true);

    try {
      setLoadingRevisions(true);
      const res = await apiGet<SalaryRevision[]>(
        `/hrms/payroll/salary/history/${emp.employee_id}`
      );
      setRevisions(res.data || []);
    } catch {
      setRevisions([]);
    } finally {
      setLoadingRevisions(false);
    }
  };

  const handleSaveSalary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmp) return;
    if (assignForm.annual_ctc <= 0) {
      showToast("Please enter a valid Annual CTC greater than 0.", "error");
      return;
    }
    try {
      setSavingSalary(true);
      await apiPost("/hrms/payroll/salary/assign", {
        employee_id: selectedEmp.employee_id,
        annual_ctc: Number(assignForm.annual_ctc),
        effective_from: assignForm.effective_from,
        notes: assignForm.notes,
      });
      showToast(`Salary structure assigned to ${selectedEmp.employee_name}.`, "success");
      setShowSalaryModal(false);
      fetchEmployeeSalaries();
    } catch (err) {
      showToast(errorMessage(err) || "Failed to assign salary", "error");
    } finally {
      setSavingSalary(false);
    }
  };

  // ---------------------------------------------------------------------------
  // TAB 3: Monthly Payroll State (Attendance-driven, Editable, Approval & Reopen)
  // ---------------------------------------------------------------------------
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  });

  const [monthlyPayroll, setMonthlyPayroll] = useState<MonthlyPayrollRecord | null>(null);
  const [loadingPayroll, setLoadingPayroll] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [approving, setApproving] = useState(false);


  // Controlled Reopen Modal (After Approval)
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [submittingReopen, setSubmittingReopen] = useState(false);

  const fetchMonthlyPayroll = useCallback(async (month: string) => {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return;
    try {
      setLoadingPayroll(true);
      const res = await apiGet<MonthlyPayrollRecord>(`/hrms/payroll/monthly/${month}?auto_calculate=true`);
      setMonthlyPayroll(res.data);
    } catch {
      setMonthlyPayroll(null);
    } finally {
      setLoadingPayroll(false);
    }
  }, []);

  const handleCalculatePayroll = async () => {
    const month = selectedMonth || (new Date().toISOString().slice(0, 7));
    try {
      setCalculating(true);
      const res = await apiPost<MonthlyPayrollRecord>("/hrms/payroll/calculate", {
        payroll_month: month,
      });
      setMonthlyPayroll(res.data);
      showToast(`Payroll recalculated from authoritative attendance for ${month}.`, "success");
    } catch (err) {
      showToast(errorMessage(err) || "Failed to calculate payroll", "error");
    } finally {
      setCalculating(false);
    }
  };

  const handleApprovePayroll = async () => {
    const month = selectedMonth || (new Date().toISOString().slice(0, 7));
    if (!window.confirm(`Approve and lock payroll for ${month}? After approval, payroll is locked and payslips are published to employees.`)) {
      return;
    }
    try {
      setApproving(true);
      await apiPost(`/hrms/payroll/monthly/${month}/approve`, {
        payroll_month: month,
      });
      showToast(`Payroll for ${month} approved and locked. Payslips published to employees.`, "success");
      fetchMonthlyPayroll(month);
    } catch (err) {
      showToast(errorMessage(err) || "Failed to approve payroll", "error");
    } finally {
      setApproving(false);
    }
  };


  const handleReopenPayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenReason.trim()) {
      showToast("A reason is required to reopen an approved payroll.", "error");
      return;
    }
    const month = selectedMonth || (new Date().toISOString().slice(0, 7));

    try {
      setSubmittingReopen(true);
      await apiPost("/hrms/payroll/reopen", {
        payroll_month: month,
        reason: reopenReason.trim(),
      });
      showToast(`Payroll for ${month} reopened for review.`, "success");
      setShowReopenModal(false);
      setReopenReason("");
      fetchMonthlyPayroll(month);
    } catch (err) {
      showToast(errorMessage(err) || "Failed to reopen payroll", "error");
    } finally {
      setSubmittingReopen(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Right-Side Details Drawer & Edit Payroll State
  // ---------------------------------------------------------------------------
  const [viewingItem, setViewingItem] = useState<MonthlyPayrollItem | null>(null);
  const [isDrawerEditing, setIsDrawerEditing] = useState(false);
  const [editAdjType, setEditAdjType] = useState<"EARNING" | "DEDUCTION">("EARNING");
  const [editComponentCode, setEditComponentCode] = useState("");
  const [customAdjTitle, setCustomAdjTitle] = useState("");
  const [editAmount, setEditAmount] = useState<number | string>("");
  const [editReason, setEditReason] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const handleOpenEditDrawer = () => {
    if (!viewingItem) return;
    setIsDrawerEditing(true);
    setEditAdjType("EARNING");
    const firstCode = viewingItem.earnings_breakdown?.[0]?.code || "";
    setEditComponentCode(firstCode || "__NEW_EARNING__");
    setCustomAdjTitle(firstCode ? "" : "Additional Earning");
    const existing = viewingItem.earnings_breakdown?.find(
      (e) => (e.code || "").toUpperCase() === firstCode.toUpperCase()
    );
    setEditAmount(existing ? existing.monthly_amount : 0);
    setEditReason("");
  };

  const handleAdjTypeChange = (newType: "EARNING" | "DEDUCTION") => {
    setEditAdjType(newType);
    if (newType === "EARNING") {
      const firstCode = viewingItem?.earnings_breakdown?.[0]?.code || "";
      setEditComponentCode(firstCode || "__NEW_EARNING__");
      setCustomAdjTitle(firstCode ? "" : "Additional Earning");
      const existing = viewingItem?.earnings_breakdown?.find(
        (e) => (e.code || "").toUpperCase() === firstCode.toUpperCase()
      );
      setEditAmount(existing ? existing.monthly_amount : 0);
    } else {
      const firstCode = viewingItem?.deductions_breakdown?.[0]?.code || "";
      setEditComponentCode(firstCode || "__NEW_DEDUCTION__");
      setCustomAdjTitle(firstCode ? "" : "Deduction Adjustment");
      const existing = viewingItem?.deductions_breakdown?.find(
        (d) => (d.code || "").toUpperCase() === firstCode.toUpperCase()
      );
      setEditAmount(existing ? existing.monthly_amount : 0);
    }
  };

  const handleComponentSelectChange = (code: string) => {
    setEditComponentCode(code);
    if (code === "__NEW_EARNING__") {
      setCustomAdjTitle("Additional Earning");
      setEditAmount(0);
      return;
    }
    if (code === "__NEW_DEDUCTION__") {
      setCustomAdjTitle("Deduction Adjustment");
      setEditAmount(0);
      return;
    }
    setCustomAdjTitle("");
    if (editAdjType === "EARNING") {
      const existing = viewingItem?.earnings_breakdown?.find(
        (e) => (e.code || "").toUpperCase() === code.toUpperCase()
      );
      if (existing) setEditAmount(existing.monthly_amount);
    } else {
      const existing = viewingItem?.deductions_breakdown?.find(
        (d) => (d.code || "").toUpperCase() === code.toUpperCase()
      );
      if (existing) setEditAmount(existing.monthly_amount);
    }
  };

  const handleSaveDrawerEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!viewingItem) return;
    if (!editReason.trim()) {
      showToast("A reason is required to adjust payroll calculation.", "error");
      return;
    }
    const amt = Number(editAmount);
    if (isNaN(amt) || amt < 0) {
      showToast("Please enter a valid non-negative amount.", "error");
      return;
    }

    try {
      setSavingEdit(true);
      if (editComponentCode === "__NEW_EARNING__" || editComponentCode === "__NEW_DEDUCTION__" || !editComponentCode) {
        // Save via authoritative monthly adjustments API
        await apiPost("/hrms/payroll/adjustments", {
          employee_id: viewingItem.employee_id,
          payroll_month: viewingItem.payroll_month || selectedMonth,
          adjustment_type: editAdjType === "EARNING" ? "ADDITION" : "DEDUCTION",
          title: customAdjTitle.trim() || (editAdjType === "EARNING" ? "Additional Earning" : "Deduction Adjustment"),
          amount: amt,
          reason: editReason.trim(),
        });
        const res = await apiPost<MonthlyPayrollRecord>("/hrms/payroll/calculate", {
          payroll_month: selectedMonth,
        });
        setMonthlyPayroll(res.data);
        const updatedItem = res.data.items?.find((i) => i.id === viewingItem.id || i.employee_id === viewingItem.employee_id);
        if (updatedItem) setViewingItem(updatedItem);
      } else {
        const payload: any = {
          reason: editReason.trim(),
        };
        if (editAdjType === "EARNING") {
          payload.earnings_updates = { [editComponentCode]: amt };
        } else {
          payload.deductions_updates = { [editComponentCode]: amt };
        }

        const res = await apiPut<MonthlyPayrollItem>(`/hrms/payroll/items/${viewingItem.id}`, payload);
        if (res.data) {
          setViewingItem(res.data);
          setMonthlyPayroll((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              items: prev.items.map((it) => (it.id === res.data.id ? res.data : it)),
            };
          });
          fetchMonthlyPayroll(selectedMonth);
        }
      }
      setIsDrawerEditing(false);
      showToast("Payroll adjustment applied and recalculated successfully.", "success");
    } catch (err) {
      showToast(errorMessage(err) || "Failed to update payroll item", "error");
    } finally {
      setSavingEdit(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Employee View: My Salary Slips
  // ---------------------------------------------------------------------------
  const [myPayslips, setMyPayslips] = useState<MonthlyPayrollItem[]>([]);
  const [loadingMyPayslips, setLoadingMyPayslips] = useState(false);

  const fetchMyPayslips = useCallback(async () => {
    try {
      setLoadingMyPayslips(true);
      const res = await apiGet<MonthlyPayrollItem[]>("/hrms/payroll/payslips");
      setMyPayslips(res.data || []);
    } catch (err) {
      showToast(errorMessage(err) || "Failed to load payslips", "error");
    } finally {
      setLoadingMyPayslips(false);
    }
  }, [showToast]);

  // Initial load hooks
  useEffect(() => {
    if (isAdmin) {
      fetchComponents();
      fetchSetupPreview(testAnnualCtc);
      fetchEmployeeSalaries();
    } else {
      fetchMyPayslips();
    }
  }, [isAdmin, fetchComponents, fetchSetupPreview, testAnnualCtc, fetchEmployeeSalaries, fetchMyPayslips]);

  useEffect(() => {
    if (isAdmin && activeTab === "monthly") {
      fetchMonthlyPayroll(selectedMonth);
    }
  }, [isAdmin, activeTab, selectedMonth, fetchMonthlyPayroll]);

  // PDF Download Handler
  const handleDownloadPdf = (item: MonthlyPayrollItem) => {
    try {
      const doc = generatePayslipPdf({
        company_name: "INHYMA ENTERPRISES PVT. LTD.",
        employee_name: item.employee_name,
        employee_code: item.employee_code,
        department: item.department,
        designation: item.designation,
        payroll_month: item.payroll_month,
        annual_ctc: item.annual_ctc,
        monthly_ctc: item.monthly_ctc,
        working_days: item.working_days,
        present_days: item.present_days,
        paid_leave_days: item.paid_leave_days,
        holiday_days: item.holiday_days,
        weekend_days: item.weekend_days,
        lop_days: item.lop_days,
        earnings_breakdown: item.earnings_breakdown || [],
        deductions_breakdown: item.deductions_breakdown || [],
        additions_breakdown: item.additions_breakdown || [],
        lop_deduction: item.lop_deduction,
        gross_amount: item.gross_amount,
        total_deductions: item.total_deductions,
        net_salary: item.net_salary,
        status: item.status,
      });
      const filename = `Payslip_${item.employee_code}_${item.payroll_month}.pdf`;
      doc.save(filename);
      showToast(`Downloaded ${filename}`, "success");
    } catch (err) {
      showToast(errorMessage(err) || "Failed to generate PDF", "error");
    }
  };

  // Filtered employees for Tab 2
  const filteredEmployees = useMemo(() => {
    if (!salarySearch.trim()) return employeeSalaries;
    const q = salarySearch.toLowerCase();
    return employeeSalaries.filter(
      (e) =>
        (e.employee_name || "").toLowerCase().includes(q) ||
        (e.employee_code || "").toLowerCase().includes(q) ||
        (e.department || "").toLowerCase().includes(q) ||
        (e.designation || "").toLowerCase().includes(q)
    );
  }, [employeeSalaries, salarySearch]);

  // Helper to format basis display
  const formatBasisDisplay = (comp: PayrollComponent) => {
    if (comp.calculation_type === "FIXED") return "Fixed Amount";
    const basis = comp.calculation_basis || (comp.calculation_type && comp.calculation_type.includes("BASIC") ? "BASIC" : "CTC");
    if (basis === "CTC") return "% of Monthly CTC";
    if (basis === "BASIC") return "% of Basic Salary";
    if (basis === "GROSS") return "% of Gross Earnings";
    return `% of ${basis}`;
  };

  // ===========================================================================
  // NON-ADMIN / EMPLOYEE VIEW: My Salary Slips
  // ===========================================================================
  if (!isAdmin) {
    return (
      <AppShell activeKey="hrms-payroll">
        <main className="page">
          <Breadcrumb trail={["HRMS", "My Salary Slips"]} />

          <div className="page-header" style={{ marginBottom: "20px" }}>
            <div>
              <h1 style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <IconCoins /> Payroll — My Salary Slips
              </h1>
              <div className="page-subtitle">
                <span>My Approved Salary Slips</span> — View and download your official approved monthly salary statements.
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="table-responsive">
              <table className="table" style={{ width: "100%", margin: 0 }}>
                <thead style={{ background: "#f8fafc" }}>
                  <tr>
                    <th>Payroll Month</th>
                    <th>Working Days</th>
                    <th>Present</th>
                    <th>LOP Days</th>
                    <th>Gross Salary</th>
                    <th>Deductions</th>
                    <th>Net Salary</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingMyPayslips ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                        Loading your salary slips...
                      </td>
                    </tr>
                  ) : myPayslips.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                        No approved salary slips available yet. Approved payslips will appear here after payroll processing.
                      </td>
                    </tr>
                  ) : (
                    myPayslips.map((ps) => (
                      <tr key={ps.id}>
                        <td style={{ fontWeight: 700, color: "#1e293b" }}>{ps.payroll_month}</td>
                        <td>{ps.working_days}</td>
                        <td style={{ color: "#15803d", fontWeight: 600 }}>{ps.present_days}</td>
                        <td style={{ color: ps.lop_days > 0 ? "#b91c1c" : "#64748b", fontWeight: ps.lop_days > 0 ? 700 : 400 }}>
                          {ps.lop_days}
                        </td>
                        <td style={{ fontWeight: 600 }}>{formatInr(ps.gross_amount)}</td>
                        <td style={{ color: "#b91c1c" }}>{formatInr(ps.total_deductions)}</td>
                        <td style={{ fontWeight: 800, color: "#0f172a" }}>{formatInr(ps.net_salary)}</td>
                        <td>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: "4px",
                              fontSize: "11px",
                              fontWeight: 700,
                              background: "#dcfce7",
                              color: "#15803d",
                            }}
                          >
                            APPROVED
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: "8px" }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              onClick={() => setViewingItem(ps)}
                            >
                              View Details
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => handleDownloadPdf(ps)}
                              style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                            >
                              <IconFileText /> Download PDF
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payslip View Drawer */}
          <PayrollDrawer
            isOpen={Boolean(viewingItem)}
            onClose={() => setViewingItem(null)}
            category="Salary Statement"
            title={viewingItem ? viewingItem.employee_name : "Payslip Details"}
            subtitle={
              viewingItem ? (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginTop: "2px" }}>
                  <code style={{ background: "#f1f5f9", padding: "1px 5px", borderRadius: "3px" }}>
                    {viewingItem.employee_code}
                  </code>
                  <span>· {viewingItem.department}</span>
                  <span style={{ fontWeight: 600, color: "#2563eb" }}>· {formatMonthDisplay(viewingItem.payroll_month)}</span>
                </div>
              ) : null
            }
            headerRight={
              <span
                style={{
                  display: "inline-block",
                  padding: "3px 8px",
                  borderRadius: "4px",
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  background: "#dcfce7",
                  color: "#15803d",
                }}
              >
                APPROVED
              </span>
            }
            footer={
              <div style={{ display: "flex", gap: "10px", width: "100%", justifyContent: "space-between" }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setViewingItem(null)}
                >
                  Close
                </button>
                {viewingItem && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleDownloadPdf(viewingItem)}
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <IconFileText /> Download PDF
                  </button>
                )}
              </div>
            }
          >
            {viewingItem && (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Employee Info Header */}
                <div style={{ background: "#f8fafc", padding: "12px 16px", borderRadius: "6px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "13px" }}>
                  <div><strong>Employee:</strong> {viewingItem.employee_name} ({viewingItem.employee_code})</div>
                  <div><strong>Department:</strong> {viewingItem.department}</div>
                  <div><strong>Designation:</strong> {viewingItem.designation}</div>
                  <div><strong>Payroll Month:</strong> {formatMonthDisplay(viewingItem.payroll_month)}</div>
                </div>

                {/* Calendar / Attendance Metrics */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px", background: "#f1f5f9", padding: "10px", borderRadius: "6px", textAlign: "center", fontSize: "12px" }}>
                  <div><div style={{ color: "#64748b" }}>Working</div><strong>{viewingItem.working_days}</strong></div>
                  <div><div style={{ color: "#64748b" }}>Present</div><strong style={{ color: "#15803d" }}>{viewingItem.present_days}</strong></div>
                  <div><div style={{ color: "#64748b" }}>Paid Leave</div><strong>{viewingItem.paid_leave_days}</strong></div>
                  <div><div style={{ color: "#64748b" }}>Hol / Sun</div><strong>{viewingItem.holiday_days} / {viewingItem.weekend_days}</strong></div>
                  <div><div style={{ color: "#64748b" }}>LOP</div><strong style={{ color: viewingItem.lop_days > 0 ? "#b91c1c" : "#64748b" }}>{viewingItem.lop_days}</strong></div>
                </div>

                {/* Earnings & Deductions Breakdown */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px" }}>
                    <div style={{ fontWeight: 700, color: "#15803d", marginBottom: "8px", borderBottom: "1px solid #e2e8f0", paddingBottom: "4px" }}>
                      Earnings
                    </div>
                    {viewingItem.earnings_breakdown && viewingItem.earnings_breakdown.map((e, idx) => (
                      <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "13px" }}>
                        <span>{e.name}</span>
                        <span style={{ fontWeight: 600 }}>{formatInr(e.monthly_amount)}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #e2e8f0", paddingTop: "6px", marginTop: "6px", fontWeight: 700 }}>
                      <span>Gross Salary</span>
                      <span style={{ color: "#15803d" }}>{formatInr(viewingItem.gross_amount)}</span>
                    </div>
                  </div>

                  <div style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px" }}>
                    <div style={{ fontWeight: 700, color: "#b91c1c", marginBottom: "8px", borderBottom: "1px solid #e2e8f0", paddingBottom: "4px" }}>
                      Deductions
                    </div>
                    {viewingItem.deductions_breakdown && viewingItem.deductions_breakdown.map((d, idx) => (
                      <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "13px" }}>
                        <span>{d.name}</span>
                        <span style={{ fontWeight: 600 }}>{formatInr(d.monthly_amount)}</span>
                      </div>
                    ))}
                    {viewingItem.lop_deduction > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "13px", color: "#b91c1c" }}>
                        <span>Loss of Pay ({viewingItem.lop_days} days)</span>
                        <span style={{ fontWeight: 600 }}>{formatInr(viewingItem.lop_deduction)}</span>
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #e2e8f0", paddingTop: "6px", marginTop: "6px", fontWeight: 700 }}>
                      <span>Total Deductions</span>
                      <span style={{ color: "#b91c1c" }}>{formatInr(viewingItem.total_deductions)}</span>
                    </div>
                  </div>
                </div>

                {/* Net Payout Summary */}
                <div style={{ padding: "14px", background: "#0f172a", color: "#ffffff", borderRadius: "6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "11px", textTransform: "uppercase", color: "#94a3b8" }}>Net Payout</div>
                    <div style={{ fontSize: "20px", fontWeight: 800, color: "#34d399" }}>{formatInr(viewingItem.net_salary)}</div>
                  </div>
                </div>
              </div>
            )}
          </PayrollDrawer>
        </main>
      </AppShell>
    );
  }

  // ===========================================================================
  // ADMIN / HR VIEW: Strictly 3 Tabs (Setup, Salary, Monthly Payroll)
  // ===========================================================================
  return (
    <AppShell activeKey="hrms-payroll">
      <main className="page">
        <Breadcrumb trail={["HRMS", "Payroll"]} />

        <div className="page-header" style={{ marginBottom: "16px" }}>
          <div>
            <h1 style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <IconCoins /> Payroll Management
            </h1>
            <div className="page-subtitle">
              Configuration-driven rules, employee Annual CTC, authoritative attendance & LOP calculation, pre-approval audit corrections, and approval locking.
            </div>
          </div>
        </div>

        {/* PRIMARY WORKFLOW: Strictly 3 Tabs */}
        <div
          style={{
            display: "flex",
            gap: "12px",
            borderBottom: "2px solid #e2e8f0",
            marginBottom: "20px",
          }}
        >
          <button
            type="button"
            id="tab-setup-btn"
            onClick={() => setActiveTab("setup")}
            style={{
              padding: "10px 18px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "setup" ? "2px solid #2563eb" : "2px solid transparent",
              color: activeTab === "setup" ? "#2563eb" : "#64748b",
              marginBottom: "-2px",
              transition: "all 0.15s ease",
            }}
          >
            1. Setup
          </button>

          <button
            type="button"
            id="tab-salary-btn"
            onClick={() => setActiveTab("salary")}
            style={{
              padding: "10px 18px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "salary" ? "2px solid #2563eb" : "2px solid transparent",
              color: activeTab === "salary" ? "#2563eb" : "#64748b",
              marginBottom: "-2px",
              transition: "all 0.15s ease",
            }}
          >
            2. Salary
          </button>

          <button
            type="button"
            id="tab-monthly-btn"
            onClick={() => setActiveTab("monthly")}
            style={{
              padding: "10px 18px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "monthly" ? "2px solid #2563eb" : "2px solid transparent",
              color: activeTab === "monthly" ? "#2563eb" : "#64748b",
              marginBottom: "-2px",
              transition: "all 0.15s ease",
            }}
          >
            3. Monthly Payroll
          </button>
        </div>

        {/* ================================================================= */}
        {/* TAB 1: SETUP (Configuration-Driven Earnings & Deductions)          */}
        {/* ================================================================= */}
        {activeTab === "setup" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* 1. EARNINGS CONFIGURATION */}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div
                style={{
                  padding: "16px 20px",
                  borderBottom: "1px solid #e2e8f0",
                  background: "#f8fafc",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: "16px", color: "#1e293b", fontWeight: 700 }}>
                    Configured Earnings
                  </h3>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                    Define organization earning components (e.g. Basic Salary, HRA, Allowances). No earning is assumed unless configured here.
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  id="btn-add-earning"
                  onClick={() => openAddComponent("EARNING")}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  <IconPlus /> Add Earning
                </button>
              </div>

              <div className="table-responsive">
                <table className="table" style={{ width: "100%", margin: 0 }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th>Earning Name</th>
                      <th>Code</th>
                      <th>Calculation Type</th>
                      <th>Value</th>
                      <th>Calculation Basis</th>
                      <th>Status</th>
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingComponents ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", padding: "28px", color: "#64748b" }}>
                          Loading configured earnings...
                        </td>
                      </tr>
                    ) : earningComponents.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", padding: "28px", color: "#64748b" }}>
                          No earning components configured yet. Click <strong>'Add Earning'</strong> to add your organization's salary components.
                        </td>
                      </tr>
                    ) : (
                      earningComponents.map((comp) => (
                        <tr key={comp.id}>
                          <td style={{ fontWeight: 600, color: "#1e293b" }}>{comp.name}</td>
                          <td>
                            <code style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: "4px" }}>
                              {comp.code}
                            </code>
                          </td>
                          <td>
                            <span style={{ fontWeight: 600, color: "#334155" }}>
                              {comp.calculation_type === "FIXED" ? "Fixed Amount" : "Percentage"}
                            </span>
                          </td>
                          <td style={{ fontWeight: 700, color: "#15803d" }}>
                            {comp.calculation_type === "FIXED" ? formatInr(comp.value) : `${comp.value}%`}
                          </td>
                          <td style={{ fontSize: "13px", color: "#64748b" }}>
                            {formatBasisDisplay(comp)}
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => handleToggleActiveComponent(comp)}
                              style={{
                                border: "none",
                                background: comp.is_active ? "#ecfdf5" : "#f1f5f9",
                                color: comp.is_active ? "#059669" : "#64748b",
                                padding: "3px 10px",
                                borderRadius: "12px",
                                fontSize: "11px",
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              {comp.is_active ? "● Active" : "○ Inactive"}
                            </button>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <div style={{ display: "inline-flex", gap: "6px" }}>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline"
                                title="Edit Earning"
                                onClick={() => openEditComponent(comp)}
                              >
                                <IconEdit />
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline btn-danger"
                                title="Delete Earning"
                                onClick={() => handleDeleteComponent(comp.id)}
                              >
                                <IconTrash />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 2. DEDUCTIONS CONFIGURATION */}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div
                style={{
                  padding: "16px 20px",
                  borderBottom: "1px solid #e2e8f0",
                  background: "#f8fafc",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: "16px", color: "#1e293b", fontWeight: 700 }}>
                    Configured Deductions
                  </h3>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                    Define organization deduction components (e.g. Professional Tax, Provident Fund, Insurance). Only configured deductions will apply.
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  id="btn-add-deduction"
                  onClick={() => openAddComponent("DEDUCTION")}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  <IconPlus /> Add Deduction
                </button>
              </div>

              <div className="table-responsive">
                <table className="table" style={{ width: "100%", margin: 0 }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th>Deduction Name</th>
                      <th>Code</th>
                      <th>Calculation Type</th>
                      <th>Value</th>
                      <th>Calculation Basis</th>
                      <th>Status</th>
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingComponents ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", padding: "28px", color: "#64748b" }}>
                          Loading configured deductions...
                        </td>
                      </tr>
                    ) : deductionComponents.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", padding: "28px", color: "#64748b" }}>
                          No deduction components configured yet. Click <strong>'Add Deduction'</strong> to create a rule.
                        </td>
                      </tr>
                    ) : (
                      deductionComponents.map((comp) => (
                        <tr key={comp.id}>
                          <td style={{ fontWeight: 600, color: "#1e293b" }}>{comp.name}</td>
                          <td>
                            <code style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: "4px" }}>
                              {comp.code}
                            </code>
                          </td>
                          <td>
                            <span style={{ fontWeight: 600, color: "#334155" }}>
                              {comp.calculation_type === "FIXED" ? "Fixed Amount" : "Percentage"}
                            </span>
                          </td>
                          <td style={{ fontWeight: 700, color: "#b91c1c" }}>
                            {comp.calculation_type === "FIXED" ? formatInr(comp.value) : `${comp.value}%`}
                          </td>
                          <td style={{ fontSize: "13px", color: "#64748b" }}>
                            {formatBasisDisplay(comp)}
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => handleToggleActiveComponent(comp)}
                              style={{
                                border: "none",
                                background: comp.is_active ? "#ecfdf5" : "#f1f5f9",
                                color: comp.is_active ? "#059669" : "#64748b",
                                padding: "3px 10px",
                                borderRadius: "12px",
                                fontSize: "11px",
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              {comp.is_active ? "● Active" : "○ Inactive"}
                            </button>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <div style={{ display: "inline-flex", gap: "6px" }}>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline"
                                title="Edit Deduction"
                                onClick={() => openEditComponent(comp)}
                              >
                                <IconEdit />
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline btn-danger"
                                title="Delete Deduction"
                                onClick={() => handleDeleteComponent(comp.id)}
                              >
                                <IconTrash />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 3. DYNAMIC SETUP PREVIEW (Strictly configured components only) */}
            <div className="card" style={{ padding: "20px", background: "#f8fafc", border: "1px solid #cbd5e1" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "12px",
                  marginBottom: "16px",
                }}
              >
                <div>
                  <h4 style={{ margin: 0, fontSize: "15px", color: "#1e293b", fontWeight: 700 }}>
                    Live Payroll Setup Rule Preview
                  </h4>
                  <div style={{ fontSize: "12px", color: "#64748b" }}>
                    Calculates dynamically using <strong>ONLY your currently configured earning & deduction rules</strong> on sample Annual CTC.
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <label htmlFor="test-ctc-input" style={{ fontSize: "13px", fontWeight: 600, color: "#334155" }}>
                    Test Annual CTC (₹):
                  </label>
                  <input
                    id="test-ctc-input"
                    type="number"
                    step="1000"
                    value={testAnnualCtc}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setTestAnnualCtc(val);
                      fetchSetupPreview(val);
                    }}
                    className="form-control"
                    style={{ width: "160px", padding: "6px 10px" }}
                  />
                </div>
              </div>

              {setupPreview ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
                  {/* Earnings column */}
                  <div style={{ background: "#ffffff", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #f1f5f9", paddingBottom: "6px", marginBottom: "8px" }}>
                      <span style={{ fontWeight: 700, color: "#15803d", fontSize: "13px" }}>Configured Earnings</span>
                      <span style={{ fontWeight: 700, color: "#15803d", fontSize: "13px" }}>Monthly</span>
                    </div>
                    {setupPreview.earnings.length === 0 ? (
                      <div style={{ padding: "12px 0", color: "#94a3b8", fontSize: "12px", fontStyle: "italic" }}>
                        No earning components configured. Gross earnings = ₹ 0.00
                      </div>
                    ) : (
                      setupPreview.earnings.map((e, idx) => (
                        <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "13px", color: "#334155" }}>
                          <span>{e.name}</span>
                          <span style={{ fontWeight: 600 }}>{formatInr(e.monthly_amount)}</span>
                        </div>
                      ))
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #e2e8f0", paddingTop: "8px", marginTop: "8px", fontWeight: 700 }}>
                      <span>Gross Earnings</span>
                      <span style={{ color: "#15803d" }}>{formatInr(setupPreview.monthly_gross)}</span>
                    </div>
                  </div>

                  {/* Deductions column */}
                  <div style={{ background: "#ffffff", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #f1f5f9", paddingBottom: "6px", marginBottom: "8px" }}>
                      <span style={{ fontWeight: 700, color: "#b91c1c", fontSize: "13px" }}>Configured Deductions</span>
                      <span style={{ fontWeight: 700, color: "#b91c1c", fontSize: "13px" }}>Monthly</span>
                    </div>
                    {setupPreview.deductions.length === 0 ? (
                      <div style={{ padding: "12px 0", color: "#94a3b8", fontSize: "12px", fontStyle: "italic" }}>
                        No deduction components configured. Total deductions = ₹ 0.00
                      </div>
                    ) : (
                      setupPreview.deductions.map((d, idx) => (
                        <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "13px", color: "#334155" }}>
                          <span>{d.name}</span>
                          <span style={{ fontWeight: 600 }}>{formatInr(d.monthly_amount)}</span>
                        </div>
                      ))
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #e2e8f0", paddingTop: "8px", marginTop: "8px", fontWeight: 700 }}>
                      <span>Total Deductions</span>
                      <span style={{ color: "#b91c1c" }}>{formatInr(setupPreview.total_deductions)}</span>
                    </div>
                  </div>

                  {/* Net Summary column */}
                  <div style={{ background: "#0f172a", color: "#ffffff", padding: "14px", borderRadius: "8px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ fontSize: "12px", textTransform: "uppercase", color: "#94a3b8" }}>
                      Calculated Net Pay
                    </div>
                    <div style={{ fontSize: "24px", fontWeight: 800, color: "#34d399", margin: "8px 0" }}>
                      {formatInr(setupPreview.estimated_net_salary)}
                    </div>
                    <div style={{ fontSize: "12px", color: "#cbd5e1" }}>
                      Net = Gross ({formatInr(setupPreview.monthly_gross)}) - Deductions ({formatInr(setupPreview.total_deductions)})
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 2: SALARY (Employee Salary Assignment - Real Employees)       */}
        {/* ================================================================= */}
        {activeTab === "salary" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "12px",
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: "17px", color: "#1e293b" }}>Employee Salaries</h3>
                <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#64748b" }}>
                  Real employee directory CTC assignment. Uses actual employee records from the HRMS database.
                </p>
              </div>

              {/* Search Filter */}
              <div style={{ position: "relative", minWidth: "280px" }}>
                <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}>
                  <IconSearch />
                </span>
                <input
                  type="text"
                  placeholder="Search by name, ID, department..."
                  value={salarySearch}
                  onChange={(e) => setSalarySearch(e.target.value)}
                  className="form-control"
                  style={{ paddingLeft: "32px", fontSize: "13px" }}
                />
              </div>
            </div>

            {/* Employee Salary List Table */}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div className="table-responsive">
                <table className="table" style={{ width: "100%", margin: 0 }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th>Employee ID</th>
                      <th>Employee Name</th>
                      <th>Department</th>
                      <th>Designation</th>
                      <th>Annual CTC</th>
                      <th>Monthly CTC</th>
                      <th>Effective From</th>
                      <th>Status</th>
                      <th style={{ textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingSalaries ? (
                      <tr>
                        <td colSpan={9} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                          Loading employees...
                        </td>
                      </tr>
                    ) : filteredEmployees.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                          {employeeSalaries.length === 0
                            ? "No employees available"
                            : `No employees matching "${salarySearch}".`}
                        </td>
                      </tr>
                    ) : (
                      filteredEmployees.map((emp) => (
                        <tr key={emp.employee_id}>
                          <td>
                            <code style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: "4px" }}>
                              {emp.employee_code}
                            </code>
                          </td>
                          <td style={{ fontWeight: 600, color: "#1e293b" }}>{emp.employee_name}</td>
                          <td style={{ color: "#475569" }}>{emp.department}</td>
                          <td style={{ color: "#475569" }}>{emp.designation}</td>
                          <td style={{ fontWeight: 700, color: emp.annual_ctc ? "#0f172a" : "#94a3b8" }}>
                            {emp.annual_ctc ? formatInr(emp.annual_ctc) : "—"}
                          </td>
                          <td style={{ fontWeight: 600, color: emp.monthly_ctc ? "#15803d" : "#94a3b8" }}>
                            {emp.monthly_ctc ? formatInr(emp.monthly_ctc) : "—"}
                          </td>
                          <td style={{ fontSize: "13px", color: "#475569" }}>{emp.effective_from || "—"}</td>
                          <td>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 8px",
                                borderRadius: "4px",
                                fontSize: "11px",
                                fontWeight: 700,
                                background: emp.has_salary ? "#dcfce7" : "#f1f5f9",
                                color: emp.has_salary ? "#15803d" : "#64748b",
                              }}
                            >
                              {emp.has_salary ? "Configured" : "Not Set"}
                            </span>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              onClick={() => openSalaryModal(emp)}
                            >
                              Configure Salary
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 3: MONTHLY PAYROLL (Authoritative Attendance, Edit & Approval)*/}
        {/* ================================================================= */}
        {activeTab === "monthly" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Top Toolbar */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "14px",
                background: "#f8fafc",
                padding: "16px 20px",
                borderRadius: "8px",
                border: "1px solid #e2e8f0",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                <div>
                  <label htmlFor="payroll-month-select" style={{ fontSize: "12px", fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
                    Payroll Month:
                  </label>
                  <input
                    id="payroll-month-select"
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => {
                      if (e.target.value) setSelectedMonth(e.target.value);
                    }}
                    className="form-control"
                    style={{ fontWeight: 600, padding: "6px 12px", width: "170px" }}
                  />
                </div>

                <button
                  type="button"
                  id="btn-calculate-payroll"
                  className="btn btn-outline"
                  disabled={calculating || (monthlyPayroll?.status === "APPROVED")}
                  onClick={handleCalculatePayroll}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  <IconRefresh /> {calculating ? "Calculating Attendance..." : "Generate / Recalculate Payroll"}
                </button>
              </div>

              {/* Status and Approval controls */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                {monthlyPayroll && (
                  <span
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 700,
                      background:
                        monthlyPayroll.status === "APPROVED"
                          ? "#dcfce7"
                          : monthlyPayroll.status === "REVIEW" || monthlyPayroll.status === "PROCESSED"
                          ? "#dbeafe"
                          : "#fef3c7",
                      color:
                        monthlyPayroll.status === "APPROVED"
                          ? "#15803d"
                          : monthlyPayroll.status === "REVIEW" || monthlyPayroll.status === "PROCESSED"
                          ? "#1d4ed8"
                          : "#b45309",
                    }}
                  >
                    STATUS: {monthlyPayroll.status === "APPROVED" ? "APPROVED / LOCKED" : monthlyPayroll.status === "REVIEW" || monthlyPayroll.status === "PROCESSED" ? "REVIEW / EDITABLE" : "DRAFT"}
                  </span>
                )}

                {/* Approve button when in REVIEW or PROCESSED or DRAFT */}
                {monthlyPayroll && monthlyPayroll.status !== "APPROVED" && (
                  <button
                    type="button"
                    id="btn-approve-payroll"
                    className="btn btn-success"
                    disabled={approving}
                    onClick={handleApprovePayroll}
                    style={{
                      background: "#16a34a",
                      color: "#ffffff",
                      border: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <IconCheckSquare /> {approving ? "Approving..." : "Approve Payroll"}
                  </button>
                )}

                {/* Controlled Reopen button when APPROVED */}
                {monthlyPayroll && monthlyPayroll.status === "APPROVED" && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => {
                      setReopenReason("");
                      setShowReopenModal(true);
                    }}
                    style={{
                      borderColor: "#f59e0b",
                      color: "#b45309",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    Reopen Payroll
                  </button>
                )}
              </div>
            </div>

            {/* Attendance & Metrics Summary Bar */}
            {monthlyPayroll && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "14px" }}>
                <div className="card" style={{ padding: "14px 18px", margin: 0 }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Payable & Working Days</div>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", marginTop: "4px" }}>
                    {monthlyPayroll.working_days} <span style={{ fontSize: "12px", fontWeight: 500, color: "#64748b" }}>(+ {monthlyPayroll.weekend_days} Sun, {monthlyPayroll.holiday_days} Hol)</span>
                  </div>
                </div>

                <div className="card" style={{ padding: "14px 18px", margin: 0 }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Employees Processed</div>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", marginTop: "4px" }}>
                    {monthlyPayroll.total_employees}
                  </div>
                </div>

                <div className="card" style={{ padding: "14px 18px", margin: 0 }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Total Gross Earnings</div>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#15803d", marginTop: "4px" }}>
                    {formatInr(monthlyPayroll.total_gross)}
                  </div>
                </div>

                <div className="card" style={{ padding: "14px 18px", margin: 0 }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Total Deductions (incl LOP)</div>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#b91c1c", marginTop: "4px" }}>
                    {formatInr(monthlyPayroll.total_deductions)}
                  </div>
                </div>

                <div className="card" style={{ padding: "14px 18px", margin: 0, background: "#0f172a", color: "#ffffff" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>Net Salary Payout</div>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#34d399", marginTop: "4px" }}>
                    {formatInr(monthlyPayroll.total_net)}
                  </div>
                </div>
              </div>
            )}

            {/* Attendance Integration Notice */}
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "10px 14px", borderRadius: "6px", fontSize: "12px", color: "#166534" }}>
              <strong>Attendance is the Source of Truth:</strong> Working days, present days, leaves, and LOP are automatically retrieved from the Attendance module. If attendance requires correction, update the records or regularizations in the Attendance module, then click <strong>Generate / Recalculate Payroll</strong>.
            </div>

            {/* Monthly Payroll Review Table */}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div className="table-responsive">
                <table className="table" style={{ width: "100%", margin: 0 }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th>Employee</th>
                      <th>Employee ID</th>
                      <th>Working Days</th>
                      <th>Present</th>
                      <th>Leave</th>
                      <th>LOP</th>
                      <th>Gross</th>
                      <th>Deductions</th>
                      <th>Net Pay</th>
                      <th>Status</th>
                      <th style={{ textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingPayroll ? (
                      <tr>
                        <td colSpan={11} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                          Loading monthly payroll...
                        </td>
                      </tr>
                    ) : !monthlyPayroll || monthlyPayroll.items.length === 0 ? (
                      <tr>
                        <td colSpan={11} style={{ textAlign: "center", padding: "36px", color: "#64748b" }}>
                          {employeeSalaries.length === 0
                            ? "No employees available"
                            : employeeSalaries.every((e) => !e.has_salary)
                            ? "No salary configured for employees"
                            : `No payroll calculated yet for ${selectedMonth}. Click [ Generate / Recalculate Payroll ] above to process actual attendance, leaves, and salary structures.`}
                        </td>
                      </tr>
                    ) : (
                      monthlyPayroll.items.map((it) => (
                        <tr key={it.id}>
                          <td>
                            <div style={{ fontWeight: 600, color: "#1e293b" }}>{it.employee_name}</div>
                            <div style={{ fontSize: "11px", color: "#64748b" }}>{it.department}</div>
                          </td>
                          <td>
                            <code style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: "4px", fontSize: "12px" }}>
                              {it.employee_code}
                            </code>
                          </td>
                          <td style={{ fontWeight: 600 }}>{it.working_days}</td>
                          <td>
                            {it.calculation_details?.attendance_available === false ? (
                              <span style={{ fontSize: "11px", color: "#b45309", fontWeight: 600, background: "#fef3c7", padding: "2px 6px", borderRadius: "4px" }}>
                                Attendance Not Available
                              </span>
                            ) : (
                              <span style={{ color: "#15803d", fontWeight: 600 }}>{it.present_days}</span>
                            )}
                          </td>
                          <td style={{ color: "#0369a1" }}>{it.paid_leave_days}</td>
                          <td style={{ color: it.lop_days > 0 ? "#b91c1c" : "#64748b", fontWeight: it.lop_days > 0 ? 700 : 400 }}>
                            {it.lop_days > 0 ? `${it.lop_days} days` : "0"}
                          </td>
                          <td style={{ fontWeight: 600 }}>{formatInr(it.gross_amount)}</td>
                          <td style={{ color: "#b91c1c", fontWeight: 600 }}>
                            {formatInr(it.total_deductions)}
                            {it.lop_deduction > 0 && (
                              <div style={{ fontSize: "10px", color: "#b91c1c" }}>
                                (LOP: {formatInr(it.lop_deduction)})
                              </div>
                            )}
                          </td>
                          <td style={{ fontWeight: 800, color: "#0f172a" }}>{formatInr(it.net_salary)}</td>
                          <td>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 8px",
                                borderRadius: "4px",
                                fontSize: "11px",
                                fontWeight: 700,
                                background: it.status === "APPROVED" ? "#dcfce7" : "#dbeafe",
                                color: it.status === "APPROVED" ? "#15803d" : "#1d4ed8",
                              }}
                            >
                              {it.status === "APPROVED" ? "APPROVED" : "REVIEW"}
                            </span>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <div style={{ display: "inline-flex", gap: "6px" }}>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline"
                                onClick={() => {
                                  setViewingItem(it);
                                  setIsDrawerEditing(false);
                                }}
                              >
                                View Details
                              </button>
                              {it.status === "APPROVED" && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  onClick={() => handleDownloadPdf(it)}
                                  title="Download PDF"
                                  style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                                >
                                  <IconFileText /> PDF
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* PAYROLL COMPONENT DRAWER: ADD / EDIT EARNING OR DEDUCTION         */}
        {/* ================================================================= */}
        <PayrollDrawer
          isOpen={showComponentModal}
          onClose={() => setShowComponentModal(false)}
          category="Payroll Setup"
          title={
            editingComponent
              ? `Edit ${compForm.component_type === "EARNING" ? "Earning" : "Deduction"} Component`
              : `Add ${compForm.component_type === "EARNING" ? "Earning" : "Deduction"} Component`
          }
          subtitle={
            compForm.component_type === "EARNING"
              ? "Configure organization earning component rule"
              : "Configure organization deduction component rule"
          }
          width="480px"
          onSubmit={handleSaveComponent}
          footer={
            <>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setShowComponentModal(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Save Component
              </button>
            </>
          }
        >
          {/* Component Type */}
          <div>
            <label className="form-label" style={{ fontWeight: 600 }}>Component Type *</label>
            <select
              className="form-control"
              value={compForm.component_type}
              onChange={(e) =>
                setCompForm({
                  ...compForm,
                  component_type: e.target.value as "EARNING" | "DEDUCTION",
                  calculation_basis: e.target.value === "EARNING" ? "CTC" : "BASIC",
                })
              }
            >
              <option value="EARNING">Earning</option>
              <option value="DEDUCTION">Deduction</option>
            </select>
          </div>

          {/* Code */}
          <div>
            <label className="form-label" style={{ fontWeight: 600 }}>Code *</label>
            <input
              type="text"
              required
              placeholder="e.g. BASIC, HRA, PT, PF, TA"
              className="form-control"
              value={compForm.code}
              onChange={(e) => setCompForm({ ...compForm, code: e.target.value.toUpperCase().replace(/\s+/g, "_") })}
            />
            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
              Unique uppercase identifier used in formulas and salary slips.
            </div>
          </div>

          {/* Component Name */}
          <div>
            <label className="form-label" style={{ fontWeight: 600 }}>Component Name *</label>
            <input
              type="text"
              required
              placeholder={compForm.component_type === "EARNING" ? "e.g. Basic Salary, Transport Allowance" : "e.g. Professional Tax, Provident Fund"}
              className="form-control"
              value={compForm.name}
              onChange={(e) => setCompForm({ ...compForm, name: e.target.value })}
            />
          </div>

          {/* Calculation Type */}
          <div>
            <label className="form-label" style={{ fontWeight: 600 }}>Calculation Type *</label>
            <select
              className="form-control"
              value={compForm.calculation_type}
              onChange={(e) =>
                setCompForm({
                  ...compForm,
                  calculation_type: e.target.value,
                })
              }
            >
              <option value="PERCENTAGE">Percentage (%)</option>
              <option value="FIXED">Fixed Amount (₹)</option>
            </select>
          </div>

          {/* Value: adapts label and unit based on calculation_type */}
          <div>
            <label className="form-label" style={{ fontWeight: 600 }}>
              {compForm.calculation_type === "FIXED" ? "Fixed Amount (₹) *" : "Percentage Value (%) *"}
            </label>
            <div style={{ position: "relative" }}>
              {compForm.calculation_type === "FIXED" && (
                <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", fontWeight: 700, color: "#64748b" }}>
                  ₹
                </span>
              )}
              <input
                type="number"
                step="0.01"
                min="0"
                required
                className="form-control"
                style={compForm.calculation_type === "FIXED" ? { paddingLeft: "26px" } : { paddingRight: "26px" }}
                value={compForm.value}
                onChange={(e) => setCompForm({ ...compForm, value: Number(e.target.value) })}
              />
              {compForm.calculation_type === "PERCENTAGE" && (
                <span style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", fontWeight: 700, color: "#64748b" }}>
                  %
                </span>
              )}
            </div>
          </div>

          {/* Calculation Basis: only when Percentage */}
          {compForm.calculation_type === "PERCENTAGE" && (
            <div>
              <label className="form-label" style={{ fontWeight: 600 }}>Calculation Basis *</label>
              <select
                className="form-control"
                value={compForm.calculation_basis}
                onChange={(e) => setCompForm({ ...compForm, calculation_basis: e.target.value })}
              >
                <option value="CTC">Percentage of Monthly CTC (CTC)</option>
                <option value="BASIC">Percentage of Basic Salary (BASIC)</option>
                <option value="GROSS">Percentage of Gross Earnings (GROSS)</option>
                {components
                  .filter((c) => c.code !== compForm.code)
                  .map((c) => (
                    <option key={c.id} value={c.code}>
                      Percentage of {c.name} ({c.code})
                    </option>
                  ))}
              </select>
              <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
                Specify the base amount to which this percentage applies.
              </div>
            </div>
          )}

          {/* Active Toggle */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", background: "#f8fafc", padding: "12px 14px", borderRadius: "6px", border: "1px solid #e2e8f0", marginTop: "4px" }}>
            <input
              type="checkbox"
              id="comp-active-check"
              checked={compForm.is_active}
              onChange={(e) => setCompForm({ ...compForm, is_active: e.target.checked })}
              style={{ marginTop: "3px", cursor: "pointer", width: "16px", height: "16px" }}
            />
            <div>
              <label htmlFor="comp-active-check" style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b", cursor: "pointer", display: "block" }}>
                Active Component
              </label>
              <span style={{ fontSize: "11px", color: "#64748b" }}>
                Only active components participate in salary structure previews and monthly payroll calculations.
              </span>
            </div>
          </div>
        </PayrollDrawer>

        {/* ================================================================= */}
        {/* MODAL 2: CONFIGURE EMPLOYEE SALARY (Real System Employee)         */}
        {/* ================================================================= */}
        <PayrollDrawer
          isOpen={Boolean(showSalaryModal && selectedEmp)}
          onClose={() => setShowSalaryModal(false)}
          category="Payroll Salary"
          title="Configure Employee Salary"
          subtitle={selectedEmp ? `Employee: ${selectedEmp.employee_code} • ${selectedEmp.employee_name} (${selectedEmp.department})` : ""}
          width="500px"
          onSubmit={handleSaveSalary}
          footer={
            <>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setShowSalaryModal(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={savingSalary}
              >
                {savingSalary ? "Saving..." : "Save Salary"}
              </button>
            </>
          }
        >
          {selectedEmp && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div>
                  <label className="form-label" style={{ fontWeight: 700, color: "#1e293b" }}>
                    Annual CTC (₹) *
                  </label>
                  <input
                    type="number"
                    step="1000"
                    min="1"
                    required
                    className="form-control"
                    value={assignForm.annual_ctc}
                    onChange={(e) => setAssignForm({ ...assignForm, annual_ctc: Number(e.target.value) })}
                    placeholder="e.g. 420000"
                    style={{ fontSize: "15px", fontWeight: 700 }}
                  />
                </div>

                <div>
                  <label className="form-label" style={{ fontWeight: 700, color: "#1e293b" }}>
                    Effective From *
                  </label>
                  <input
                    type="date"
                    required
                    className="form-control"
                    value={assignForm.effective_from}
                    onChange={(e) => setAssignForm({ ...assignForm, effective_from: e.target.value })}
                    style={{ fontSize: "14px" }}
                  />
                </div>
              </div>

              {/* Monthly Salary Preview based on Configured Rules */}
              {liveEmpPreview && (
                <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "8px", border: "1px solid #cbd5e1" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a", textTransform: "uppercase" }}>
                      Monthly Salary Preview
                    </span>
                    <div style={{ fontSize: "13px", color: "#475569" }}>
                      Monthly CTC: <strong style={{ color: "#15803d" }}>{formatInr(liveEmpPreview.monthly_ctc)}</strong>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                    {/* Earnings */}
                    <div style={{ background: "#ffffff", padding: "10px 12px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                      <div style={{ fontWeight: 700, color: "#15803d", fontSize: "12px", marginBottom: "6px" }}>
                        Earnings
                      </div>
                      {liveEmpPreview.earnings.length === 0 ? (
                        <div style={{ fontSize: "11px", color: "#94a3b8", fontStyle: "italic" }}>No configured earnings</div>
                      ) : (
                        liveEmpPreview.earnings.map((e, idx) => (
                          <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", padding: "3px 0" }}>
                            <span>{e.name}</span>
                            <span style={{ fontWeight: 600 }}>{formatInr(e.monthly_amount)}</span>
                          </div>
                        ))
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #f1f5f9", paddingTop: "6px", marginTop: "4px", fontWeight: 700, fontSize: "12px" }}>
                        <span>Gross Salary</span>
                        <span style={{ color: "#15803d" }}>{formatInr(liveEmpPreview.monthly_gross)}</span>
                      </div>
                    </div>

                    {/* Deductions */}
                    <div style={{ background: "#ffffff", padding: "10px 12px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                      <div style={{ fontWeight: 700, color: "#b91c1c", fontSize: "12px", marginBottom: "6px" }}>
                        Deductions
                      </div>
                      {liveEmpPreview.deductions.length === 0 ? (
                        <div style={{ fontSize: "11px", color: "#94a3b8", fontStyle: "italic" }}>No configured deductions</div>
                      ) : (
                        liveEmpPreview.deductions.map((d, idx) => (
                          <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", padding: "3px 0" }}>
                            <span>{d.name}</span>
                            <span style={{ fontWeight: 600 }}>{formatInr(d.monthly_amount)}</span>
                          </div>
                        ))
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #f1f5f9", paddingTop: "6px", marginTop: "4px", fontWeight: 700, fontSize: "12px" }}>
                        <span>Total Deductions</span>
                        <span style={{ color: "#b91c1c" }}>{formatInr(liveEmpPreview.total_deductions)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Estimated Net */}
                  <div style={{ marginTop: "12px", padding: "10px 14px", background: "#0f172a", borderRadius: "6px", display: "flex", justifyContent: "space-between", alignItems: "center", color: "#ffffff" }}>
                    <span style={{ fontSize: "12px", textTransform: "uppercase", color: "#94a3b8" }}>Calculated Net Pay</span>
                    <span style={{ fontSize: "18px", fontWeight: 800, color: "#34d399" }}>{formatInr(liveEmpPreview.estimated_net_salary)}</span>
                  </div>
                </div>
              )}

              {/* Revision History */}
              <div style={{ marginTop: "16px" }}>
                <h5 style={{ margin: "0 0 8px 0", fontSize: "13px", fontWeight: 700, color: "#475569" }}>
                  Salary Revision History
                </h5>
                {loadingRevisions ? (
                  <div style={{ fontSize: "12px", color: "#64748b", padding: "8px 0" }}>Loading revision history...</div>
                ) : revisions.length === 0 ? (
                  <div style={{ fontSize: "12px", color: "#94a3b8", fontStyle: "italic" }}>No previous revisions on record.</div>
                ) : (
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: "6px", overflow: "hidden" }}>
                    <table className="table" style={{ width: "100%", margin: 0, fontSize: "12px" }}>
                      <thead style={{ background: "#f8fafc" }}>
                        <tr>
                          <th>Effective From</th>
                          <th>Annual CTC</th>
                          <th>Monthly CTC</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {revisions.map((rev) => (
                          <tr key={rev.id}>
                            <td>{rev.effective_from}</td>
                            <td style={{ fontWeight: 700 }}>{formatInr(rev.annual_ctc)}</td>
                            <td style={{ color: "#15803d", fontWeight: 600 }}>{formatInr(rev.monthly_ctc)}</td>
                            <td>
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "1px 6px",
                                  borderRadius: "4px",
                                  fontSize: "10px",
                                  fontWeight: 700,
                                  background: rev.is_active ? "#ecfdf5" : "#f1f5f9",
                                  color: rev.is_active ? "#059669" : "#64748b",
                                }}
                              >
                                {rev.is_active ? "Current" : "Historical"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </PayrollDrawer>

        {/* ================================================================= */}
        {/* MODAL 4: CONTROLLED REOPEN PAYROLL                                */}
        {/* ================================================================= */}
        <PayrollDrawer
          isOpen={showReopenModal}
          onClose={() => setShowReopenModal(false)}
          category="Monthly Payroll"
          title={`Reopen Approved Payroll — ${selectedMonth}`}
          subtitle="Unlock finalized payroll records for administrative audit corrections"
          width="480px"
          onSubmit={handleReopenPayroll}
          footer={
            <>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setShowReopenModal(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-danger"
                disabled={submittingReopen}
              >
                {submittingReopen ? "Reopening..." : "Confirm & Reopen"}
              </button>
            </>
          }
        >
          <div style={{ background: "#fef2f2", color: "#991b1b", padding: "12px 14px", borderRadius: "6px", fontSize: "12.5px", border: "1px solid #fecaca", lineHeight: 1.5 }}>
            <strong>Warning:</strong> Reopening returns this payroll run to REVIEW status and unlocks employee records for correction. An audit log entry will be permanently recorded.
          </div>

          <div>
            <label className="form-label" style={{ fontWeight: 700 }}>Reason for Reopening *</label>
            <textarea
              required
              rows={4}
              className="form-control"
              placeholder="e.g. Audit correction needed for 2 employees with retro leave approvals"
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
            />
          </div>
        </PayrollDrawer>

        {/* ================================================================= */}
        {/* RIGHT-SIDE DRAWER: VIEW PAYROLL DETAILS & EDIT PAYROLL            */}
        {/* ================================================================= */}
        <PayrollDrawer
          isOpen={Boolean(viewingItem)}
          onClose={() => {
            setViewingItem(null);
            setIsDrawerEditing(false);
          }}
          category="Payroll Details"
          title={isDrawerEditing ? "Edit Payroll Record" : (viewingItem ? viewingItem.employee_name : "Payroll Calculation Details")}
          subtitle={
            viewingItem ? (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginTop: "2px" }}>
                <code style={{ background: "#f1f5f9", padding: "1px 5px", borderRadius: "3px" }}>
                  {viewingItem.employee_code}
                </code>
                <span>· {viewingItem.department}</span>
                <span style={{ fontWeight: 600, color: "#2563eb" }}>· {formatMonthDisplay(viewingItem.payroll_month)}</span>
              </div>
            ) : null
          }
          headerRight={
            viewingItem ? (
              <span
                style={{
                  display: "inline-block",
                  padding: "3px 8px",
                  borderRadius: "4px",
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  background:
                    viewingItem.status === "APPROVED"
                      ? "#dcfce7"
                      : viewingItem.status === "REVIEW" || viewingItem.status === "PROCESSED"
                      ? "#dbeafe"
                      : "#fef3c7",
                  color:
                    viewingItem.status === "APPROVED"
                      ? "#15803d"
                      : viewingItem.status === "REVIEW" || viewingItem.status === "PROCESSED"
                      ? "#1d4ed8"
                      : "#b45309",
                }}
              >
                {viewingItem.status === "APPROVED"
                  ? "APPROVED"
                  : viewingItem.status === "REVIEW" || viewingItem.status === "PROCESSED"
                  ? "PENDING APPROVAL"
                  : "DRAFT"}
              </span>
            ) : null
          }
          width="520px"
          footer={
            isDrawerEditing ? (
              <>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setIsDrawerEditing(false)}
                  disabled={savingEdit}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="payroll-edit-form"
                  className="btn btn-primary"
                  disabled={savingEdit}
                >
                  {savingEdit ? "Recalculating..." : "Save & Recalculate"}
                </button>
              </>
            ) : (
              <>
                {viewingItem && viewingItem.status !== "APPROVED" ? (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={handleOpenEditDrawer}
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <IconEdit /> Edit Payroll
                  </button>
                ) : viewingItem ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#15803d" }}>
                      ✓ Payroll Approved
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleDownloadPdf(viewingItem)}
                      style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                    >
                      <IconFileText /> Download PDF
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setViewingItem(null);
                    setIsDrawerEditing(false);
                  }}
                >
                  Close
                </button>
              </>
            )
          }
        >
          {viewingItem && (
            <>
              {/* Mode 1: Edit Mode */}
              {isDrawerEditing ? (
                  <form id="payroll-edit-form" onSubmit={handleSaveDrawerEdit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", padding: "12px", borderRadius: "6px", fontSize: "12px", color: "#1e40af" }}>
                      <strong>Edit Payroll:</strong> Adjust earning or deduction components.
                      <div style={{ marginTop: "4px", color: "#475569" }}>
                        Attendance values are managed in Attendance. Correct the attendance record there and recalculate payroll.
                      </div>
                    </div>

                    <div>
                      <label className="form-label" style={{ fontWeight: 600 }}>Adjustment Type *</label>
                      <select
                        className="form-control"
                        value={editAdjType}
                        onChange={(e) => handleAdjTypeChange(e.target.value as "EARNING" | "DEDUCTION")}
                      >
                        <option value="EARNING">Earnings Adjustment</option>
                        <option value="DEDUCTION">Deduction Adjustment</option>
                      </select>
                    </div>

                    <div>
                      <label className="form-label" style={{ fontWeight: 600 }}>Select Component or Adjustment *</label>
                      <select
                        className="form-control"
                        value={editComponentCode}
                        onChange={(e) => handleComponentSelectChange(e.target.value)}
                      >
                        {editAdjType === "EARNING" ? (
                          <>
                            {viewingItem.earnings_breakdown && viewingItem.earnings_breakdown.map((e, idx) => (
                              <option key={idx} value={e.code || e.name.toUpperCase()}>
                                {e.name} ({e.code || e.name.toUpperCase()}) — {formatInr(e.monthly_amount)}
                              </option>
                            ))}
                            <option value="__NEW_EARNING__">+ Additional Earning / Allowance</option>
                          </>
                        ) : (
                          <>
                            {viewingItem.deductions_breakdown && viewingItem.deductions_breakdown.map((d, idx) => (
                              <option key={idx} value={d.code || d.name.toUpperCase()}>
                                {d.name} ({d.code || d.name.toUpperCase()}) — {formatInr(d.monthly_amount)}
                              </option>
                            ))}
                            <option value="__NEW_DEDUCTION__">+ Other Deduction Adjustment</option>
                          </>
                        )}
                      </select>
                    </div>

                    {(editComponentCode === "__NEW_EARNING__" || editComponentCode === "__NEW_DEDUCTION__") && (
                      <div>
                        <label className="form-label" style={{ fontWeight: 600 }}>Adjustment Title / Name *</label>
                        <input
                          type="text"
                          required
                          className="form-control"
                          placeholder={editAdjType === "EARNING" ? "e.g. Performance Bonus" : "e.g. Penalty / Loan Adjustment"}
                          value={customAdjTitle}
                          onChange={(e) => setCustomAdjTitle(e.target.value)}
                        />
                      </div>
                    )}

                    <div>
                      <label className="form-label" style={{ fontWeight: 600 }}>Adjusted Monthly Amount (₹) *</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        className="form-control"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="form-label" style={{ fontWeight: 600 }}>Reason for Correction *</label>
                      <textarea
                        required
                        rows={3}
                        className="form-control"
                        placeholder="e.g. Manual correction after payroll review"
                        value={editReason}
                        onChange={(e) => setEditReason(e.target.value)}
                      />
                    </div>
                  </form>
                ) : (
                  <>
                    {/* ATTENDANCE SUMMARY (READ ONLY) */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          Attendance Summary
                        </div>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "2px 6px",
                            borderRadius: "4px",
                            background: "#f1f5f9",
                            color: "#475569",
                          }}
                        >
                          Source: Attendance
                        </span>
                      </div>

                      {viewingItem.calculation_details?.attendance_available === false ? (
                        <div style={{ background: "#fffbeb", border: "1px solid #fef3c7", padding: "10px 14px", borderRadius: "6px", fontSize: "12px", color: "#92400e", marginBottom: "8px" }}>
                          <strong>Attendance Not Available:</strong> No attendance or leave records tracked for this employee in {formatMonthDisplay(viewingItem.payroll_month)}.
                        </div>
                      ) : null}

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px", background: "#f8fafc", border: "1px solid #e2e8f0", padding: "10px", borderRadius: "6px", textAlign: "center" }}>
                        <div>
                          <div style={{ fontSize: "10px", color: "#64748b" }}>Working</div>
                          <div style={{ fontSize: "15px", fontWeight: 800, color: "#0f172a" }}>{viewingItem.working_days}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: "10px", color: "#64748b" }}>Present</div>
                          <div style={{ fontSize: "15px", fontWeight: 800, color: "#15803d" }}>{viewingItem.present_days}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: "10px", color: "#64748b" }}>Paid Leave</div>
                          <div style={{ fontSize: "15px", fontWeight: 800, color: "#0284c7" }}>{viewingItem.paid_leave_days}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: "10px", color: "#64748b" }}>Hol / Sun</div>
                          <div style={{ fontSize: "15px", fontWeight: 800, color: "#475569" }}>{viewingItem.holiday_days + viewingItem.weekend_days}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: "10px", color: "#64748b" }}>LOP</div>
                          <div style={{ fontSize: "15px", fontWeight: 800, color: viewingItem.lop_days > 0 ? "#dc2626" : "#64748b" }}>{viewingItem.lop_days}</div>
                        </div>
                      </div>
                    </div>

                    {/* SALARY / EARNINGS */}
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                        Salary / Earnings
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
                        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", padding: "8px 12px", borderRadius: "6px" }}>
                          <div style={{ fontSize: "11px", color: "#64748b" }}>Annual CTC</div>
                          <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>{formatInr(viewingItem.annual_ctc)}</div>
                        </div>
                        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", padding: "8px 12px", borderRadius: "6px" }}>
                          <div style={{ fontSize: "11px", color: "#64748b" }}>Monthly CTC</div>
                          <div style={{ fontSize: "14px", fontWeight: 700, color: "#15803d" }}>{formatInr(viewingItem.monthly_ctc)}</div>
                        </div>
                      </div>

                      <div style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px", background: "#ffffff" }}>
                        <div style={{ fontWeight: 700, color: "#15803d", fontSize: "11px", textTransform: "uppercase", marginBottom: "6px" }}>
                          Configured Earnings
                        </div>
                        {viewingItem.earnings_breakdown && viewingItem.earnings_breakdown.length === 0 ? (
                          <div style={{ fontSize: "12px", color: "#94a3b8", fontStyle: "italic", padding: "4px 0" }}>
                            No earning components configured
                          </div>
                        ) : (
                          (viewingItem.earnings_breakdown || []).map((e, idx) => (
                            <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "13px" }}>
                              <span>{e.name}</span>
                              <span style={{ fontWeight: 600 }}>{formatInr(e.monthly_amount)}</span>
                            </div>
                          ))
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #e2e8f0", paddingTop: "8px", marginTop: "6px", fontWeight: 700, fontSize: "13px" }}>
                          <span>Gross Earnings</span>
                          <span style={{ color: "#15803d" }}>{formatInr(viewingItem.gross_amount)}</span>
                        </div>
                      </div>
                    </div>

                    {/* DEDUCTIONS */}
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                        Deductions
                      </div>

                      <div style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px", background: "#ffffff" }}>
                        <div style={{ fontWeight: 700, color: "#b91c1c", fontSize: "11px", textTransform: "uppercase", marginBottom: "6px" }}>
                          Configured Deductions
                        </div>
                        {(!viewingItem.deductions_breakdown || viewingItem.deductions_breakdown.length === 0) && viewingItem.lop_deduction === 0 ? (
                          <div style={{ fontSize: "12px", color: "#94a3b8", fontStyle: "italic", padding: "4px 0" }}>
                            No configured deductions
                          </div>
                        ) : (
                          <>
                            {(viewingItem.deductions_breakdown || []).map((d, idx) => (
                              <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "13px" }}>
                                <span>{d.name}</span>
                                <span style={{ fontWeight: 600 }}>{formatInr(d.monthly_amount)}</span>
                              </div>
                            ))}
                            {viewingItem.lop_deduction > 0 && (
                              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "13px", color: "#b91c1c" }}>
                                <span>Loss of Pay ({viewingItem.lop_days} days)</span>
                                <span style={{ fontWeight: 600 }}>{formatInr(viewingItem.lop_deduction)}</span>
                              </div>
                            )}
                          </>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #e2e8f0", paddingTop: "8px", marginTop: "6px", fontWeight: 700, fontSize: "13px" }}>
                          <span>Total Deductions</span>
                          <span style={{ color: "#b91c1c" }}>{formatInr(viewingItem.total_deductions)}</span>
                        </div>
                      </div>
                    </div>

                    {/* FINAL PAY */}
                    <div style={{ background: "#0f172a", color: "#ffffff", padding: "14px 18px", borderRadius: "8px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#94a3b8", marginBottom: "4px" }}>
                        <span>Gross Earnings</span>
                        <span>{formatInr(viewingItem.gross_amount)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#f87171", marginBottom: "8px" }}>
                        <span>Total Deductions</span>
                        <span>- {formatInr(viewingItem.total_deductions)}</span>
                      </div>
                      <div style={{ borderTop: "1px solid #334155", paddingTop: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#e2e8f0" }}>
                          Net Pay
                        </span>
                        <span style={{ fontSize: "22px", fontWeight: 800, color: "#34d399" }}>
                          {formatInr(viewingItem.net_salary)}
                        </span>
                      </div>
                    </div>

                    {/* AUDIT TRAIL */}
                    {viewingItem.edit_history && viewingItem.edit_history.length > 0 && (
                      <div>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                          Audit Trail ({viewingItem.edit_history.length})
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {viewingItem.edit_history.map((entry, idx) => (
                            <div key={idx} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "10px 12px", fontSize: "12px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", marginBottom: "4px" }}>
                                <span>Changed by: <strong>{entry.edited_by_name || "Admin"}</strong></span>
                                <span>{new Date(entry.timestamp).toLocaleString()}</span>
                              </div>
                              <div style={{ color: "#0f172a", fontWeight: 600, marginBottom: "4px" }}>
                                Reason: {entry.reason}
                              </div>
                              {entry.changes && Object.entries(entry.changes).map(([field, diff]: [string, any], cIdx) => (
                                <div key={cIdx} style={{ fontSize: "11px", color: "#475569" }}>
                                  • {field}: <del style={{ color: "#ef4444" }}>{diff.old ?? "—"}</del> → <ins style={{ color: "#16a34a", textDecoration: "none", fontWeight: 600 }}>{diff.new}</ins>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
            </>
          )}
        </PayrollDrawer>
      </main>
    </AppShell>
  );
}
