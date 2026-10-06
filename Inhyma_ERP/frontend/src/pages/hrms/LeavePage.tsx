import React, { useEffect, useState, useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import {
  IconCalendar,
  IconCheckSquare,
  IconClose,
  IconFileText,
  IconFilter,
  IconRefresh,
} from "@/components/icons";
import { DatePicker, parseDDMMYYYY, formatDDMMYYYY } from "@/components/DatePicker";
import { useAuth } from "@/lib/hooks";
import { apiGet, apiPost, apiPatch, apiPut, apiDelete, apiPostMultipart } from "@/lib/api";
import "./hrms.css";

// ---------------------------------------------------------------------------
// Helper Functions: Date Normalization
// ---------------------------------------------------------------------------

function toISO(dateStr: string): string {
  if (!dateStr) return "";
  const d = parseDDMMYYYY(dateStr);
  if (!d) return dateStr;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toDDMMYYYY(dateStr: string): string {
  if (!dateStr) return "";
  const d = parseDDMMYYYY(dateStr);
  if (!d) return dateStr;
  return formatDDMMYYYY(d);
}

function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return "-";
  const d = parseDDMMYYYY(dateStr);
  if (!d) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

type LeaveTab = "my-leaves" | "approvals" | "holiday" | "adjustments" | "leave-types";
type ActiveModal = null | "apply" | "approve" | "detail" | "adjustment" | "holiday" | "type";

interface LeaveType {
  id: string;
  name: string;
  code?: string;
  description?: string;
  leave_type: string;
  is_paid: boolean;
  annual_balance: number;
  carry_forward_allowed: boolean;
  carry_forward_days: number;
  max_consecutive_days: number;
  monthly_accrual: boolean;
  accrual_amount?: number;
  min_notice_days?: number;
  allow_half_day?: boolean;
  allow_backdated?: boolean;
  require_attachment?: boolean;
  attendance_based_accrual?: boolean;
  attendance_based_condition?: string;
  attendance_based_reward?: number;
  attendance_based_departments?: string;
  allocation_unit?: string;
  accrual_frequency?: string;
  applicable_to?: string;
  applicable_departments?: string;
  applicable_branches?: string;
  count_weekends_as_leave?: boolean;
  count_holidays_as_leave?: boolean;
  allow_negative_balance?: boolean;
  is_active: boolean;
}

interface Holiday {
  id: string;
  name: string;
  holiday_date: string;
  number_of_days: number;
  branch_applicability: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface EmployeeBalance {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type_id: string;
  leave_type_name: string;
  allocated: number;
  consumed: number;
  adjusted: number;
  available: number;
  year: number;
}

interface MatrixRow {
  employee_id: string;
  employee_name: string;
  employee_code?: string;
  employee_email?: string;
  branch?: string;
  department?: string;
  balances: Record<
    string,
    {
      allocated: number;
      consumed: number;
      adjusted: number;
      available: number;
      total_leave?: number;
    }
  >;
}

interface LeaveAdjustmentAudit {
  id: string;
  employee_id: string;
  employee_name?: string;
  leave_type_id: string;
  leave_type_name?: string;
  adjustment_type: string;
  amount: number;
  previous_balance: number;
  new_balance: number;
  reason: string;
  remarks?: string | null;
  source?: string;
  effective_date?: string | null;
  adjusted_by_name?: string | null;
  created_at: string;
}

interface LeaveRequest {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type_id: string;
  leave_type_name: string;
  from_date: string;
  to_date: string;
  number_of_days: number;
  reason: string;
  attachment?: string | null;
  attachment_url?: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  approval_status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  created_by_name: string;
  updated_by_name: string;
  approved_by_name?: string | null;
  approval_remarks?: string | null;
  created_at: string;
  updated_at: string;
}

export function LeavePage() {
  const [activeTab, setActiveTab] = useState<LeaveTab>("my-leaves");
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Core Data Stores
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [applicableLeaveTypes, setApplicableLeaveTypes] = useState<LeaveType[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [myBalances, setMyBalances] = useState<EmployeeBalance[]>([]);
  const [matrixRows, setMatrixRows] = useState<MatrixRow[]>([]);
  const [myRequests, setMyRequests] = useState<LeaveRequest[]>([]);
  const [approvals, setApprovals] = useState<LeaveRequest[]>([]);

  // Loading & Calculation State
  const [loadingBalances, setLoadingBalances] = useState<boolean>(false);
  const [loadingRequests, setLoadingRequests] = useState<boolean>(false);
  const [calculatingDays, setCalculatingDays] = useState<boolean>(false);
  const [calcError, setCalcError] = useState<string | null>(null);

  // My Leaves Filter State
  const [myLeavesFilterType, setMyLeavesFilterType] = useState<string>("");
  const [myLeavesFilterStatus, setMyLeavesFilterStatus] = useState<string>("ALL");

  // Request Details Modal
  const [selectedDetailRequest, setSelectedDetailRequest] = useState<LeaveRequest | null>(null);

  // Attachment Upload State
  const [uploadingAttachment, setUploadingAttachment] = useState<boolean>(false);
  const [attachmentFileName, setAttachmentFileName] = useState<string>("");

  // Single Modal State (guarantees only ONE modal/dialog can be active at a time)
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);

  // RBAC / User Permissions
  const { profile, isSuperAdmin, hasPermission } = useAuth();
  const isAdmin = Boolean(
    !profile ||
    isSuperAdmin ||
    profile?.role === "ADMIN" ||
    profile?.role === "super_admin" ||
    profile?.username === "admin" ||
    hasPermission?.("*") ||
    hasPermission?.("hrms.manage") ||
    hasPermission?.("hrms:admin")
  );

  const isManager = Boolean(
    profile?.role === "MANAGER" ||
    profile?.role === "HR" ||
    hasPermission?.("hrms.approve") ||
    hasPermission?.("hrms:approval")
  );

  const canApprove = Boolean(
    !profile ||
    isAdmin ||
    isManager ||
    hasPermission?.("hrms.approve") ||
    hasPermission?.("hrms:approval")
  );

  const canManageHolidays = Boolean(
    !profile ||
    isAdmin ||
    hasPermission?.("hrms.manage") ||
    hasPermission?.("hrms.leave.manage_holidays")
  );

  const canAdjustBalances = Boolean(
    !profile ||
    isAdmin ||
    hasPermission?.("hrms.manage") ||
    hasPermission?.("hrms.leave.adjust_balance")
  );

  const canManageLeaveTypes = Boolean(
    !profile ||
    isAdmin ||
    hasPermission?.("hrms.manage") ||
    hasPermission?.("hrms.leave.manage_types")
  );

  // Target item states for edit/action
  const [selectedHoliday, setSelectedHoliday] = useState<Holiday | null>(null);
  const [selectedType, setSelectedType] = useState<LeaveType | null>(null);
  const [targetApproval, setTargetApproval] = useState<LeaveRequest | null>(null);
  const [approvalActionType, setApprovalActionType] = useState<"approve" | "reject">("approve");
  const [approvalRemarks, setApprovalRemarks] = useState<string>("");

  // Leave Adjustment Form State
  const [adjEmployeeId, setAdjEmployeeId] = useState<string>("");
  const [adjEmployeeName, setAdjEmployeeName] = useState<string>("");
  const [adjEmployeeCode, setAdjEmployeeCode] = useState<string>("");
  const [adjLeaveTypeId, setAdjLeaveTypeId] = useState<string>("");
  const [adjType, setAdjType] = useState<"ADD" | "DEDUCT" | "CORRECTION">("ADD");
  const [adjAmount, setAdjAmount] = useState<number>(1);
  const [adjEffectiveDate, setAdjEffectiveDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [adjReason, setAdjReason] = useState<string>("");
  const [adjRemarks, setAdjRemarks] = useState<string>("");
  const [adjHistory, setAdjHistory] = useState<LeaveAdjustmentAudit[]>([]);

  // Leave Adjustment Filters State
  const [adjDepartmentFilter, setAdjDepartmentFilter] = useState<string>("ALL");
  const [adjBranchFilter, setAdjBranchFilter] = useState<string>("ALL");
  const [adjLeaveTypeFilter, setAdjLeaveTypeFilter] = useState<string>("ALL");
  const [adjEmployeeFilter, setAdjEmployeeFilter] = useState<string>("ALL");
  const [adjEmployeeDepartment, setAdjEmployeeDepartment] = useState<string>("General");

  // Apply Leave Form State
  const [applyLeaveTypeId, setApplyLeaveTypeId] = useState<string>("");
  const [applyFromDate, setApplyFromDate] = useState<string>("");
  const [applyToDate, setApplyToDate] = useState<string>("");
  const [applyCalculatedDays, setApplyCalculatedDays] = useState<number>(0);
  const [applyReason, setApplyReason] = useState<string>("");
  const [applyAttachment, setApplyAttachment] = useState<string>("");

  // Holiday Form State
  const [holidayName, setHolidayName] = useState<string>("");
  const [holidayDate, setHolidayDate] = useState<string>("");
  const [holidayDays, setHolidayDays] = useState<number>(1);
  const [holidayBranch, setHolidayBranch] = useState<string>("ALL");
  const [holidayActive, setHolidayActive] = useState<boolean>(true);

  // Leave Type Form State
  const [typeName, setTypeName] = useState<string>("");
  const [typeCode, setTypeCode] = useState<string>("");
  const [typeDescription, setTypeDescription] = useState<string>("");
  const [typeCategory, setTypeCategory] = useState<string>("REGULAR");
  const [typeIsPaid, setTypeIsPaid] = useState<boolean>(true);
  const [typeAnnualBalance, setTypeAnnualBalance] = useState<number>(12);
  const [typeAllocationUnit, setTypeAllocationUnit] = useState<string>("DAYS");
  const [typeMonthlyAccrual, setTypeMonthlyAccrual] = useState<boolean>(false);
  const [typeAccrualFrequency, setTypeAccrualFrequency] = useState<string>("MONTHLY");
  const [typeAccrualAmount, setTypeAccrualAmount] = useState<number>(1);
  const [typeCarryForwardAllowed, setTypeCarryForwardAllowed] = useState<boolean>(false);
  const [typeCarryForwardDays, setTypeCarryForwardDays] = useState<number>(0);
  const [typeMaxConsecutive, setTypeMaxConsecutive] = useState<number>(0); // 0 = No Limit
  const [typeAllowHalfDay, setTypeAllowHalfDay] = useState<boolean>(true);
  const [typeAllowBackdated, setTypeAllowBackdated] = useState<boolean>(false);
  const [typeMinNoticeDays, setTypeMinNoticeDays] = useState<number>(0);
  const [typeRequireAttachment, setTypeRequireAttachment] = useState<boolean>(false);
  const [typeAllowNegativeBalance, setTypeAllowNegativeBalance] = useState<boolean>(false);
  const [typeCountWeekends, setTypeCountWeekends] = useState<boolean>(false);
  const [typeCountHolidays, setTypeCountHolidays] = useState<boolean>(false);
  const [typeApplicableTo, setTypeApplicableTo] = useState<string>("ALL");
  const [typeApplicableDepartments, setTypeApplicableDepartments] = useState<string>("");
  const [typeApplicableBranches, setTypeApplicableBranches] = useState<string>("");
  const [typeAttendanceAccrual, setTypeAttendanceAccrual] = useState<boolean>(false);
  const [typeAttendanceCondition, setTypeAttendanceCondition] = useState<string>("Full Month Attendance");
  const [typeAttendanceReward, setTypeAttendanceReward] = useState<number>(1);
  const [typeAttendanceDepartments, setTypeAttendanceDepartments] = useState<string>("");
  const [typeActive, setTypeActive] = useState<boolean>(true);

  // Approval Filters
  const [filterEmployee, setFilterEmployee] = useState<string>("");
  const [filterLeaveType, setFilterLeaveType] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  // Adjustment Search Filter
  const [adjSearch, setAdjSearch] = useState<string>("");

  // -------------------------------------------------------------------------
  // Data Fetching
  // -------------------------------------------------------------------------

  const fetchLeaveTypes = async () => {
    try {
      const res = await apiGet<any>("/hrms/leave/types");
      const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
      if (Array.isArray(list)) {
        setLeaveTypes(list);
        if (!applyLeaveTypeId && list.length > 0) {
          setApplyLeaveTypeId(list[0].id);
        }
      }
    } catch {
      // quiet failover
    }
  };

  const fetchApplicableLeaveTypes = async () => {
    try {
      const res = await apiGet<any>("/hrms/leave/applicable-types");
      const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
      if (Array.isArray(list)) {
        setApplicableLeaveTypes(list);
        if (list.length > 0 && (!applyLeaveTypeId || !list.some((t: LeaveType) => t.id === applyLeaveTypeId))) {
          setApplyLeaveTypeId(list[0].id);
        }
      }
    } catch {
      // quiet failover
    }
  };

  const fetchMyBalances = async () => {
    try {
      setLoadingBalances(true);
      const res = await apiGet<any>(`/hrms/leave/balances?year=${selectedYear}`);
      const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
      if (Array.isArray(list)) {
        setMyBalances(list);
      }
    } catch {
      // quiet failover
    } finally {
      setLoadingBalances(false);
    }
  };

  const fetchMyRequests = async () => {
    try {
      setLoadingRequests(true);
      const res = await apiGet<any>("/hrms/leave/requests");
      const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
      if (Array.isArray(list)) {
        setMyRequests(list);
      }
    } catch {
      // quiet failover
    } finally {
      setLoadingRequests(false);
    }
  };

  const fetchApprovals = async () => {
    try {
      const params = new URLSearchParams();
      if (filterStatus && filterStatus !== "ALL") params.append("status", filterStatus);
      if (filterLeaveType) params.append("leave_type_id", filterLeaveType);
      const url = `/hrms/leave/approvals?${params.toString()}`;
      const res = await apiGet<any>(url);
      const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
      if (Array.isArray(list)) {
        setApprovals(list);
      }
    } catch {
      // quiet failover
    }
  };

  const fetchHolidays = async () => {
    try {
      const res = await apiGet<any>("/hrms/leave/holidays");
      const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
      if (Array.isArray(list)) {
        setHolidays(list);
      }
    } catch {
      // quiet failover
    }
  };

  const fetchMatrix = async () => {
    try {
      const res = await apiGet<any>(`/hrms/leave/matrix?year=${selectedYear}`);
      const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
      if (Array.isArray(list)) {
        setMatrixRows(list);
      }
    } catch {
      // quiet failover
    }
  };

  const [dbDepartments, setDbDepartments] = useState<string[]>([]);
  const [dbBranches, setDbBranches] = useState<string[]>([]);

  const fetchAdjustmentHistory = async (empId: string, ltId?: string) => {
    try {
      let url = `/hrms/leave/adjustments/history?employee_id=${empId}`;
      if (ltId) url += `&leave_type_id=${ltId}`;
      const res = await apiGet<any>(url);
      const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
      if (Array.isArray(list)) {
        setAdjHistory(list);
      }
    } catch {
      // quiet failover
    }
  };

  const fetchOrgDepartmentsAndBranches = async () => {
    try {
      const [rolesRes, locsRes] = await Promise.allSettled([
        apiGet<any>("/rbac/roles"),
        apiGet<any>("/hrms/setup/locations"),
      ]);
      if (rolesRes.status === "fulfilled") {
        const roles = Array.isArray(rolesRes.value.data) ? rolesRes.value.data : rolesRes.value.data?.data || [];
        if (Array.isArray(roles)) {
          const depts = roles.map((r: any) => {
            const n = r.name || "";
            return n === "super_admin" ? "Admin" : (n === "user" ? "User" : n);
          }).filter(Boolean);
          setDbDepartments(Array.from(new Set(depts)));
        }
      }
      if (locsRes.status === "fulfilled") {
        const locs = Array.isArray(locsRes.value.data) ? locsRes.value.data : locsRes.value.data?.data || [];
        if (Array.isArray(locs)) {
          const branches = locs.map((l: any) => l.name).filter(Boolean);
          setDbBranches(Array.from(new Set(branches)));
        }
      }
    } catch {
      // quiet failover
    }
  };

  // Initial load
  useEffect(() => {
    fetchLeaveTypes();
    fetchOrgDepartmentsAndBranches();
  }, []);

  // Tab driven fetching
  useEffect(() => {
    if (activeTab === "my-leaves") {
      fetchMyBalances();
      fetchMyRequests();
      fetchApplicableLeaveTypes();
    } else if (activeTab === "approvals") {
      fetchApprovals();
    } else if (activeTab === "holiday") {
      fetchHolidays();
    } else if (activeTab === "adjustments") {
      fetchMatrix();
      fetchOrgDepartmentsAndBranches();
    } else if (activeTab === "leave-types") {
      fetchLeaveTypes();
    }
  }, [activeTab, selectedYear, filterStatus, filterLeaveType]);

  // -------------------------------------------------------------------------
  // Automatic Working Days Calculation (Via Backend /hrms/leave/calculate-days)
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!applyFromDate || !applyToDate) {
      setApplyCalculatedDays(0);
      setCalcError(null);
      return;
    }
    const from = new Date(applyFromDate);
    const to = new Date(applyToDate);
    if (from > to) {
      setApplyCalculatedDays(0);
      setCalcError("From date cannot be after To date.");
      return;
    }
    setCalcError(null);

    let isMounted = true;
    const fetchCalc = async () => {
      try {
        setCalculatingDays(true);
        const params = new URLSearchParams({
          from_date: applyFromDate,
          to_date: applyToDate,
        });
        if (applyLeaveTypeId) params.append("leave_type_id", applyLeaveTypeId);
        const res = await apiGet<any>(`/hrms/leave/calculate-days?${params.toString()}`);
        if (isMounted) {
          const days = res.data?.number_of_days ?? res.data?.total_calendar_days ?? 0;
          setApplyCalculatedDays(days);
        }
      } catch {
        if (isMounted) {
          // Calendar-day fallback
          const diffTime = Math.abs(to.getTime() - from.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
          setApplyCalculatedDays(diffDays);
        }
      } finally {
        if (isMounted) setCalculatingDays(false);
      }
    };
    fetchCalc();
    return () => {
      isMounted = false;
    };
  }, [applyFromDate, applyToDate, applyLeaveTypeId]);

  // -------------------------------------------------------------------------
  // Action Handlers
  // -------------------------------------------------------------------------

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingAttachment(true);
      setErrorMsg(null);
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiPostMultipart<any>("/hrms/leave/upload-attachment", formData);
      const url = res.data?.file_url || (res as any).file_url || "";
      setApplyAttachment(url);
      setAttachmentFileName(file.name);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to upload attachment file.");
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleViewRequest = (req: LeaveRequest) => {
    setSelectedDetailRequest(req);
    setActiveModal("detail");
  };

  const handleApplyLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!applyLeaveTypeId || !applyFromDate || !applyToDate) {
      setErrorMsg("Please select a leave type and valid date range.");
      return;
    }

    if (new Date(applyFromDate) > new Date(applyToDate)) {
      setErrorMsg("From date cannot be after To date.");
      return;
    }

    if (applyCalculatedDays <= 0) {
      setErrorMsg("Selected date range contains no leave days.");
      return;
    }

    // Validate applicable leave types
    const selectedLt = applicableLeaveTypes.find((t) => t.id === applyLeaveTypeId) ||
      leaveTypes.find((t) => t.id === applyLeaveTypeId);

    if (!selectedLt) {
      setErrorMsg("This leave type is not currently available under your active leave plan.");
      return;
    }

    // Consecutive days check
    if (selectedLt.max_consecutive_days && selectedLt.max_consecutive_days > 0 && applyCalculatedDays > selectedLt.max_consecutive_days) {
      setErrorMsg(`Maximum ${selectedLt.max_consecutive_days} consecutive days are allowed for ${selectedLt.name}.`);
      return;
    }

    // Balance check for paid leaves
    if (selectedLt.is_paid) {
      const bal = myBalances.find((b) => b.leave_type_id === selectedLt.id);
      const available = bal ? bal.available : 0;
      if (applyCalculatedDays > available) {
        setErrorMsg(`Insufficient ${selectedLt.name} balance. Available: ${available} days.`);
        return;
      }
    }

    try {
      setLoading(true);
      const payload = {
        leave_type_id: applyLeaveTypeId,
        from_date: applyFromDate,
        to_date: applyToDate,
        reason: applyReason.trim(),
        attachment: applyAttachment || null,
      };
      await apiPost<LeaveRequest>("/hrms/leave/requests", payload);
      setSuccessMsg("Leave application submitted successfully.");
      setActiveModal(null);
      setApplyReason("");
      setApplyAttachment("");
      setAttachmentFileName("");
      fetchMyRequests();
      fetchMyBalances();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to submit leave request.");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelRequest = async (reqId: string) => {
    if (!window.confirm("Are you sure you want to cancel this leave application?")) return;
    try {
      setLoading(true);
      await apiPatch<LeaveRequest>(`/hrms/leave/requests/${reqId}/cancel`, {});
      setSuccessMsg("Leave request cancelled successfully.");
      fetchMyRequests();
      fetchMyBalances();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to cancel request.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAdjustment = (row: MatrixRow) => {
    setAdjEmployeeId(row.employee_id);
    setAdjEmployeeName(row.employee_name);
    setAdjEmployeeCode(row.employee_code || "");
    setAdjEmployeeDepartment(row.department || "General");
    const firstLt = activeLeaveTypes[0]?.id || leaveTypes[0]?.id || "";
    setAdjLeaveTypeId(firstLt);
    setAdjType("ADD");
    setAdjAmount(1);
    setAdjEffectiveDate(new Date().toISOString().split("T")[0]);
    setAdjReason("");
    setAdjRemarks("");
    fetchAdjustmentHistory(row.employee_id, firstLt);
    setActiveModal("adjustment");
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!adjReason.trim()) {
      setErrorMsg("Adjustment reason is strictly required for auditability.");
      return;
    }
    if (adjAmount <= 0) {
      setErrorMsg("Adjustment amount must be greater than zero.");
      return;
    }

    try {
      setLoading(true);
      const payload = {
        employee_id: adjEmployeeId,
        leave_type_id: adjLeaveTypeId,
        adjustment_type: adjType,
        amount: adjAmount,
        reason: adjReason.trim(),
        remarks: adjRemarks.trim() || undefined,
        effective_date: adjEffectiveDate || undefined,
        year: selectedYear,
      };
      await apiPost<LeaveAdjustmentAudit>("/hrms/leave/adjustments", payload);
      setSuccessMsg("Balance adjustment recorded successfully.");
      setActiveModal(null);
      fetchMatrix();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save adjustment.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenApprovalModal = (req: LeaveRequest, action: "approve" | "reject" = "approve") => {
    setTargetApproval(req);
    setApprovalActionType(action);
    setApprovalRemarks("");
    setActiveModal("approve");
  };

  const handleExecuteApproval = async (actionOverride?: "approve" | "reject") => {
    if (!targetApproval) return;
    const finalAction = actionOverride || approvalActionType;
    try {
      setLoading(true);
      const url = `/hrms/leave/approvals/${targetApproval.id}/${finalAction}`;
      const payload = { approval_remarks: approvalRemarks };
      await apiPatch<LeaveRequest>(url, payload);
      setSuccessMsg(
        finalAction === "approve"
          ? "Leave request approved and balance consumed."
          : "Leave request rejected."
      );
      setActiveModal(null);
      setTargetApproval(null);
      fetchApprovals();
    } catch (err: any) {
      setErrorMsg(err.message || `Failed to ${finalAction} request.`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayName.trim() || !holidayDate) {
      setErrorMsg("Holiday Name and Date are required.");
      return;
    }
    try {
      setLoading(true);
      const payload = {
        name: holidayName.trim(),
        holiday_date: holidayDate,
        number_of_days: holidayDays,
        branch_applicability: holidayBranch,
        is_active: holidayActive,
      };
      if (selectedHoliday) {
        await apiPut<Holiday>(`/hrms/leave/holidays/${selectedHoliday.id}`, payload);
      } else {
        await apiPost<Holiday>("/hrms/leave/holidays", payload);
      }
      setSuccessMsg("Holiday saved successfully.");
      setActiveModal(null);
      fetchHolidays();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save holiday.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAddType = () => {
    setSelectedType(null);
    setTypeName("");
    setTypeCode("");
    setTypeDescription("");
    setTypeCategory("REGULAR");
    setTypeIsPaid(true);
    setTypeAnnualBalance(12);
    setTypeAllocationUnit("DAYS");
    setTypeMonthlyAccrual(false);
    setTypeAccrualFrequency("MONTHLY");
    setTypeAccrualAmount(1);
    setTypeCarryForwardAllowed(false);
    setTypeCarryForwardDays(0);
    setTypeMaxConsecutive(0); // 0 = No limit
    setTypeAllowHalfDay(true);
    setTypeAllowBackdated(false);
    setTypeMinNoticeDays(0);
    setTypeRequireAttachment(false);
    setTypeAllowNegativeBalance(false);
    setTypeCountWeekends(false);
    setTypeCountHolidays(false);
    setTypeApplicableTo("ALL");
    setTypeApplicableDepartments("");
    setTypeApplicableBranches("");
    setTypeAttendanceAccrual(false);
    setTypeAttendanceCondition("Full Month Attendance");
    setTypeAttendanceReward(1);
    setTypeAttendanceDepartments("");
    setTypeActive(true);
    setActiveModal("type");
  };

  const handleOpenEditType = (lt: LeaveType) => {
    setSelectedType(lt);
    setTypeName(lt.name);
    setTypeCode(lt.code || "");
    setTypeDescription(lt.description || "");
    setTypeCategory(lt.leave_type || "REGULAR");
    setTypeIsPaid(lt.is_paid);
    setTypeAnnualBalance(lt.annual_balance ?? 12);
    setTypeAllocationUnit(lt.allocation_unit || "DAYS");
    setTypeMonthlyAccrual(Boolean(lt.monthly_accrual));
    setTypeAccrualFrequency(lt.accrual_frequency || "MONTHLY");
    setTypeAccrualAmount(lt.accrual_amount ?? 1);
    setTypeCarryForwardAllowed(Boolean(lt.carry_forward_allowed));
    setTypeCarryForwardDays(lt.carry_forward_days ?? 0);
    setTypeMaxConsecutive(lt.max_consecutive_days ?? 0);
    setTypeAllowHalfDay(lt.allow_half_day !== false);
    setTypeAllowBackdated(Boolean(lt.allow_backdated));
    setTypeMinNoticeDays(lt.min_notice_days ?? 0);
    setTypeRequireAttachment(Boolean(lt.require_attachment));
    setTypeAllowNegativeBalance(Boolean(lt.allow_negative_balance));
    setTypeCountWeekends(Boolean(lt.count_weekends_as_leave));
    setTypeCountHolidays(Boolean(lt.count_holidays_as_leave));
    setTypeApplicableTo(lt.applicable_to || "ALL");
    setTypeApplicableDepartments(lt.applicable_departments || "");
    setTypeApplicableBranches(lt.applicable_branches || "");
    setTypeAttendanceAccrual(Boolean(lt.attendance_based_accrual));
    setTypeAttendanceCondition(lt.attendance_based_condition || "Full Month Attendance");
    setTypeAttendanceReward(lt.attendance_based_reward ?? 1);
    setTypeAttendanceDepartments(lt.attendance_based_departments || "");
    setTypeActive(lt.is_active);
    setActiveModal("type");
  };

  const handleToggleTypeStatus = async (lt: LeaveType) => {
    try {
      setLoading(true);
      await apiPatch(`/hrms/leave/types/${lt.id}/status`, { is_active: !lt.is_active });
      setSuccessMsg(`Leave Type "${lt.name}" marked as ${!lt.is_active ? "ACTIVE" : "INACTIVE"}.`);
      fetchLeaveTypes();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to update leave type status.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteType = async (lt: LeaveType) => {
    if (!window.confirm(`Are you sure you want to delete leave type "${lt.name}"?`)) return;
    try {
      setLoading(true);
      await apiDelete(`/hrms/leave/types/${lt.id}`);
      setSuccessMsg(`Leave Type "${lt.name}" deleted successfully.`);
      fetchLeaveTypes();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to delete leave type.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typeName.trim() || !typeCode.trim()) {
      setErrorMsg("Leave Type Name and Code are required.");
      return;
    }
    try {
      setLoading(true);
      const payload = {
        name: typeName.trim(),
        code: typeCode.trim().toUpperCase(),
        description: typeDescription.trim() || null,
        leave_type: typeCategory,
        is_paid: typeIsPaid,
        annual_balance: Number(typeAnnualBalance),
        allocation_unit: typeAllocationUnit,
        monthly_accrual: typeMonthlyAccrual,
        accrual_frequency: typeMonthlyAccrual ? typeAccrualFrequency : null,
        accrual_amount: typeMonthlyAccrual ? Number(typeAccrualAmount) : 0,
        carry_forward_allowed: typeCarryForwardAllowed,
        carry_forward_days: typeCarryForwardAllowed ? Number(typeCarryForwardDays) : 0,
        max_consecutive_days: Number(typeMaxConsecutive),
        allow_half_day: typeAllowHalfDay,
        allow_backdated: typeAllowBackdated,
        min_notice_days: Number(typeMinNoticeDays),
        require_attachment: typeRequireAttachment,
        allow_negative_balance: typeAllowNegativeBalance,
        count_weekends_as_leave: typeCountWeekends,
        count_holidays_as_leave: typeCountHolidays,
        applicable_to: typeApplicableTo,
        applicable_departments: typeApplicableTo === "DEPARTMENT" || typeApplicableTo === "CUSTOM" ? typeApplicableDepartments.trim() || null : null,
        applicable_branches: typeApplicableTo === "BRANCH" || typeApplicableTo === "CUSTOM" ? typeApplicableBranches.trim() || null : null,
        attendance_based_accrual: typeAttendanceAccrual,
        attendance_based_condition: typeAttendanceAccrual ? typeAttendanceCondition.trim() || null : null,
        attendance_based_reward: typeAttendanceAccrual ? Number(typeAttendanceReward) : 0,
        attendance_based_departments: typeAttendanceAccrual ? typeAttendanceDepartments.trim() || null : null,
        is_active: typeActive,
      };
      if (selectedType) {
        await apiPut<LeaveType>(`/hrms/leave/types/${selectedType.id}`, payload);
        setSuccessMsg(`Leave Type "${payload.name}" updated successfully.`);
      } else {
        await apiPost<LeaveType>("/hrms/leave/types", payload);
        setSuccessMsg(`Leave Type "${payload.name}" created successfully.`);
      }
      setActiveModal(null);
      fetchLeaveTypes();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save leave type.");
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Computed values
  // -------------------------------------------------------------------------

  // Matrix calculation with dynamic leave types and filters
  const activeLeaveTypes = useMemo(() => {
    return leaveTypes.filter((lt) => lt.is_active);
  }, [leaveTypes]);

  const matrixDepartments = useMemo(() => {
    const set = new Set<string>(dbDepartments);
    matrixRows.forEach((r) => {
      if (r.department && r.department.trim()) set.add(r.department.trim());
    });
    return Array.from(set).sort();
  }, [dbDepartments, matrixRows]);

  const matrixBranches = useMemo(() => {
    const set = new Set<string>(dbBranches);
    matrixRows.forEach((r) => {
      if (r.branch && r.branch.trim()) set.add(r.branch.trim());
    });
    return Array.from(set).sort();
  }, [dbBranches, matrixRows]);

  const filteredMatrix = useMemo(() => {
    return matrixRows.filter((r) => {
      if (adjEmployeeFilter !== "ALL" && r.employee_id !== adjEmployeeFilter) {
        return false;
      }
      if (adjSearch.trim()) {
        const term = adjSearch.toLowerCase();
        const matchesName = r.employee_name.toLowerCase().includes(term);
        const matchesCode = r.employee_code && r.employee_code.toLowerCase().includes(term);
        const matchesEmail = r.employee_email && r.employee_email.toLowerCase().includes(term);
        if (!matchesName && !matchesCode && !matchesEmail) return false;
      }
      if (adjDepartmentFilter !== "ALL") {
        const target = adjDepartmentFilter.toLowerCase().trim();
        const rowDept = (r.department || "").toLowerCase().trim();
        const isMatch = (
          rowDept === target ||
          (target === "admin" && (rowDept === "super_admin" || rowDept === "admin")) ||
          (target === "super_admin" && (rowDept === "admin" || rowDept === "super_admin")) ||
          (target === "user" && rowDept === "user")
        );
        if (!isMatch) return false;
      }
      if (adjBranchFilter !== "ALL") {
        const target = adjBranchFilter.toLowerCase().trim();
        const rowBranch = (r.branch || "").toLowerCase().trim();
        if (rowBranch !== target) return false;
      }
      return true;
    });
  }, [matrixRows, adjEmployeeFilter, adjSearch, adjDepartmentFilter, adjBranchFilter]);

  const filteredApprovals = useMemo(() => {
    return approvals.filter((a) => {
      if (filterEmployee && !a.employee_name.toLowerCase().includes(filterEmployee.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [approvals, filterEmployee]);

  const filteredMyRequests = useMemo(() => {
    return myRequests.filter((r) => {
      if (myLeavesFilterType && myLeavesFilterType !== "ALL" && r.leave_type_id !== myLeavesFilterType) {
        return false;
      }
      if (myLeavesFilterStatus && myLeavesFilterStatus !== "ALL" && r.status !== myLeavesFilterStatus) {
        return false;
      }
      if (selectedYear && r.from_date) {
        const reqYear = parseInt(r.from_date.slice(0, 4), 10);
        if (!isNaN(reqYear) && reqYear !== selectedYear) return false;
      }
      return true;
    });
  }, [myRequests, myLeavesFilterType, myLeavesFilterStatus, selectedYear]);

  // Current selected employee available balance in adjustment drawer
  const currentAdjTargetBalance = useMemo(() => {
    if (!adjEmployeeId || !adjLeaveTypeId) return 0;
    const row = matrixRows.find((r) => r.employee_id === adjEmployeeId);
    if (!row) return 0;
    const lt = leaveTypes.find((t) => t.id === adjLeaveTypeId);
    if (!lt) return 0;
    const balObj = row.balances[lt.id] || row.balances[lt.name];
    return balObj ? balObj.available : 0;
  }, [adjEmployeeId, adjLeaveTypeId, matrixRows, leaveTypes]);

  const previewResultingBalance = useMemo(() => {
    if (adjType === "ADD") {
      return roundTwo(currentAdjTargetBalance + (adjAmount || 0));
    }
    if (adjType === "DEDUCT") {
      return roundTwo(Math.max(0, currentAdjTargetBalance - (adjAmount || 0)));
    }
    return roundTwo(adjAmount || 0);
  }, [currentAdjTargetBalance, adjType, adjAmount]);

  function roundTwo(num: number) {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  return (
    <AppShell activeKey="hrms-leave">
      <main className="page">
        <Breadcrumb trail={["HRMS", "Leave"]} />

        <div className="page-header" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1>Leave</h1>
              <div className="page-subtitle">
                Manage employee leave requests and balances
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <select
                className="form-control"
                style={{ width: 115, fontWeight: 600 }}
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
              >
                {[2024, 2025, 2026, 2027, 2028].map((y) => (
                  <option key={y} value={y}>
                    Year {y}
                  </option>
                ))}
              </select>

              {activeTab === "my-leaves" && (
                <button
                  type="button"
                  id="btn-request-leave"
                  className="btn btn-primary"
                  onClick={() => {
                    fetchApplicableLeaveTypes();
                    setActiveModal("apply");
                  }}
                >
                  <IconFileText />
                  <span>+ Request Leave</span>
                </button>
              )}
              {activeTab === "holiday" && canManageHolidays && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setSelectedHoliday(null);
                    setHolidayName("");
                    setHolidayDate("");
                    setHolidayDays(1);
                    setHolidayBranch("ALL");
                    setHolidayActive(true);
                    setActiveModal("holiday");
                  }}
                >
                  + Add Holiday
                </button>
              )}
              {activeTab === "leave-types" && canManageLeaveTypes && (
                <button
                  type="button"
                  id="btn-add-leave-type"
                  className="btn btn-primary"
                  onClick={handleOpenAddType}
                >
                  <IconFileText />
                  <span>+ Add Leave Type</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Global Feedback Banner */}
        {errorMsg && (
          <div className="card" style={{ background: "#fef2f2", borderColor: "#fecaca", padding: "12px 16px", color: "#991b1b", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{errorMsg}</span>
              <button type="button" className="btn-icon" onClick={() => setErrorMsg(null)}>
                <IconClose />
              </button>
            </div>
          </div>
        )}
        {successMsg && (
          <div className="card" style={{ background: "#f0fdf4", borderColor: "#bbf7d0", padding: "12px 16px", color: "#166534", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{successMsg}</span>
              <button type="button" className="btn-icon" onClick={() => setSuccessMsg(null)}>
                <IconClose />
              </button>
            </div>
          </div>
        )}

        {/* Navigation Tabs Bar */}
        <div className="hrms-tabs-nav" style={{ marginBottom: 20 }}>
          <button
            type="button"
            className={`hrms-tab-btn ${activeTab === "my-leaves" ? "active" : ""}`}
            onClick={() => setActiveTab("my-leaves")}
          >
            <IconCalendar />
            <span>My Leaves</span>
          </button>
          {canApprove && (
            <button
              type="button"
              className={`hrms-tab-btn ${activeTab === "approvals" ? "active" : ""}`}
              onClick={() => setActiveTab("approvals")}
            >
              <IconCheckSquare />
              <span>Leave Approvals</span>
            </button>
          )}
          {canManageLeaveTypes && (
            <button
              type="button"
              className={`hrms-tab-btn ${activeTab === "leave-types" ? "active" : ""}`}
              onClick={() => setActiveTab("leave-types")}
            >
              <IconFileText />
              <span>Leave Types</span>
            </button>
          )}
          {canManageHolidays && (
            <button
              type="button"
              className={`hrms-tab-btn ${activeTab === "holiday" ? "active" : ""}`}
              onClick={() => setActiveTab("holiday")}
            >
              <IconCalendar />
              <span>Holiday</span>
            </button>
          )}
          {canAdjustBalances && (
            <button
              type="button"
              className={`hrms-tab-btn ${activeTab === "adjustments" ? "active" : ""}`}
              onClick={() => setActiveTab("adjustments")}
            >
              <IconRefresh />
              <span>Leave Adjustment</span>
            </button>
          )}
        </div>

        {/* =================================================================== */}
        {/* TAB 1: MY LEAVES                                                    */}
        {/* =================================================================== */}
        {activeTab === "my-leaves" && (
          <div>
            {/* Section 1: Available Leave Balances */}
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="card-header">
                <div>
                  <h2 className="hrms-section-title">Available Leave Balances</h2>
                  <div className="hrms-section-desc">Current available quotas applicable to your active leave plan</div>
                </div>
                <span className="hrms-badge-shell">Annual Quota ({selectedYear})</span>
              </div>

              <div style={{ padding: "0 20px 20px 20px" }}>
                {loadingBalances ? (
                  <div className="hrms-placeholder-box" style={{ padding: "30px 20px" }}>
                    <p className="hrms-placeholder-text">Loading leave balances...</p>
                  </div>
                ) : myBalances.length === 0 ? (
                  <div className="hrms-placeholder-box">
                    <div className="hrms-placeholder-icon">
                      <IconCalendar />
                    </div>
                    <h3 className="hrms-placeholder-title">No Active Leave Allocations</h3>
                    <p className="hrms-placeholder-text">
                      No active leave allocations found for {selectedYear}. Once assigned by HRMS Leave Plans, quotas will appear here.
                    </p>
                  </div>
                ) : (
                  <div className="hrms-leave-cards-grid">
                    {myBalances.map((bal) => (
                      <div key={bal.id} className="hrms-leave-stat-card" style={{ padding: "16px 20px" }}>
                        <div className="hrms-leave-card-title">
                          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-heading, #0f172a)" }}>
                            {bal.leave_type_name}
                          </span>
                        </div>
                        <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 6 }}>
                          <span style={{ fontSize: 13, color: "var(--color-muted, #64748b)", fontWeight: 500 }}>Available:</span>
                          <span style={{ fontSize: 24, fontWeight: 800, color: bal.available > 0 ? "#16a34a" : "var(--color-muted, #94a3b8)" }}>
                            {bal.available}
                          </span>
                          <span style={{ fontSize: 13, color: "var(--color-muted, #64748b)", fontWeight: 500 }}>
                            Day{bal.available === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div style={{ marginTop: 8, fontSize: 11, color: "var(--color-muted, #64748b)", display: "flex", gap: 12, borderTop: "1px solid #f1f5f9", paddingTop: 6 }}>
                          <span>Allocated: {bal.allocated + bal.adjusted}</span>
                          <span>Consumed: {bal.consumed}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Leave Requests Card */}
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="hrms-section-title">Leave Requests</h2>
                  <div className="hrms-section-desc">Chronological history of applied, pending, approved and rejected leaves</div>
                </div>
                <span className="hrms-badge-shell">{filteredMyRequests.length} Records</span>
              </div>

              {/* Filters Bar: Year, Leave Type, Status */}
              <div className="hrms-leave-filter-bar">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-muted)" }}>Filters:</span>
                </div>

                <select
                  className="form-control"
                  style={{ width: 130 }}
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                >
                  {[2024, 2025, 2026, 2027, 2028].map((y) => (
                    <option key={y} value={y}>Year {y}</option>
                  ))}
                </select>

                <select
                  className="form-control"
                  style={{ width: 180 }}
                  value={myLeavesFilterType}
                  onChange={(e) => setMyLeavesFilterType(e.target.value)}
                >
                  <option value="">All Leave Types</option>
                  {applicableLeaveTypes.map((lt) => (
                    <option key={lt.id} value={lt.id}>
                      {lt.name}
                    </option>
                  ))}
                </select>

                <select
                  className="form-control"
                  style={{ width: 160 }}
                  value={myLeavesFilterStatus}
                  onChange={(e) => setMyLeavesFilterStatus(e.target.value)}
                >
                  <option value="ALL">All Statuses</option>
                  <option value="PENDING">PENDING</option>
                  <option value="APPROVED">APPROVED</option>
                  <option value="REJECTED">REJECTED</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
              </div>

              {loadingRequests ? (
                <div className="hrms-placeholder-box" style={{ padding: "40px 20px" }}>
                  <p className="hrms-placeholder-text">Loading leave requests...</p>
                </div>
              ) : filteredMyRequests.length === 0 ? (
                <div className="hrms-placeholder-box" style={{ padding: "40px 20px" }}>
                  <div className="hrms-placeholder-icon">
                    <IconCalendar />
                  </div>
                  <h3 className="hrms-placeholder-title">No leave requests found.</h3>
                  <p className="hrms-placeholder-text">
                    There are no leave requests matching your current filter criteria.
                  </p>
                </div>
              ) : (
                <div className="hrms-approval-table-wrapper">
                  <table className="hrms-approval-table">
                    <thead>
                      <tr>
                        <th>SR No.</th>
                        <th>Leave Type</th>
                        <th>From</th>
                        <th>To</th>
                        <th>No. of Days</th>
                        <th>Reason</th>
                        <th>Attachment</th>
                        <th>Created By</th>
                        <th>Updated By</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMyRequests.map((req, idx) => (
                        <tr key={req.id}>
                          <td>{idx + 1}</td>
                          <td style={{ fontWeight: 600 }}>{req.leave_type_name}</td>
                          <td>{req.from_date}</td>
                          <td>{req.to_date}</td>
                          <td>
                            <strong>{req.number_of_days}</strong>
                          </td>
                          <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {req.reason}
                          </td>
                          <td>
                            {req.attachment || req.attachment_url ? (
                              <a
                                href={(req.attachment || req.attachment_url) ?? undefined}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: "#2563eb", textDecoration: "underline" }}
                              >
                                View
                              </a>
                            ) : (
                              <span style={{ color: "var(--color-muted)" }}>-</span>
                            )}
                          </td>
                          <td>{req.created_by_name || "Self"}</td>
                          <td>{req.updated_by_name || "-"}</td>
                          <td>
                            <span
                              className={`hrms-badge hrms-badge-${req.status.toLowerCase()}`}
                            >
                              {req.status}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{ fontSize: 11, padding: "3px 8px" }}
                                onClick={() => handleViewRequest(req)}
                              >
                                View
                              </button>
                              {req.status === "PENDING" && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  style={{ fontSize: 11, padding: "3px 8px", color: "#dc2626" }}
                                  onClick={() => handleCancelRequest(req.id)}
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: LEAVE APPROVALS                                              */}
        {/* =================================================================== */}
        {activeTab === "approvals" && (
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="hrms-section-title">Leave Approvals</h2>
                <div className="hrms-section-desc">Review submitted employee leave requests and process approvals</div>
              </div>
              <span className="hrms-badge-shell">{filteredApprovals.length} Requests</span>
            </div>

            {/* Approval Filter Bar */}
            <div className="hrms-leave-filter-bar">
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 200 }}>
                <IconFilter />
                <input
                  type="text"
                  placeholder="Filter by employee name..."
                  className="form-control"
                  style={{ width: "100%" }}
                  value={filterEmployee}
                  onChange={(e) => setFilterEmployee(e.target.value)}
                />
              </div>

              <select
                className="form-control"
                style={{ width: 180 }}
                value={filterLeaveType}
                onChange={(e) => setFilterLeaveType(e.target.value)}
              >
                <option value="">All Leave Types</option>
                {leaveTypes.map((lt) => (
                  <option key={lt.id} value={lt.id}>
                    {lt.name}
                  </option>
                ))}
              </select>

              <select
                className="form-control"
                style={{ width: 150 }}
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING">PENDING</option>
                <option value="APPROVED">APPROVED</option>
                <option value="REJECTED">REJECTED</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </div>

            {filteredApprovals.length === 0 ? (
              <div className="hrms-placeholder-box">
                <div className="hrms-placeholder-icon">
                  <IconCheckSquare />
                </div>
                <h3 className="hrms-placeholder-title">No Leave Requests Found</h3>
                <p className="hrms-placeholder-text">
                  There are no pending employee leave requests matching your current filters.
                </p>
              </div>
            ) : (
              <div className="hrms-approval-table-wrapper">
                <table className="hrms-approval-table">
                  <thead>
                    <tr>
                      <th>SR No.</th>
                      <th>Employee</th>
                      <th>Leave Type</th>
                      <th>From</th>
                      <th>To</th>
                      <th>No. of Days</th>
                      <th>Reason</th>
                      <th>Attachment</th>
                      <th>Created By</th>
                      <th>Updated By</th>
                      <th>Approval Status</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredApprovals.map((req, idx) => (
                      <tr key={req.id}>
                        <td>{idx + 1}</td>
                        <td style={{ fontWeight: 600 }}>{req.employee_name}</td>
                        <td>{req.leave_type_name}</td>
                        <td>{req.from_date}</td>
                        <td>{req.to_date}</td>
                        <td>
                          <strong>{req.number_of_days}</strong>
                        </td>
                        <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {req.reason}
                        </td>
                        <td>
                          {req.attachment_url ? (
                            <a
                              href={req.attachment_url}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: "#2563eb", textDecoration: "underline" }}
                            >
                              View
                            </a>
                          ) : (
                            <span style={{ color: "var(--color-muted)" }}>-</span>
                          )}
                        </td>
                        <td>{req.created_by_name}</td>
                        <td>{req.updated_by_name}</td>
                        <td>
                          <span
                            className={`hrms-badge hrms-badge-${req.approval_status.toLowerCase()}`}
                          >
                            {req.approval_status}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`hrms-badge hrms-badge-${req.status.toLowerCase()}`}
                          >
                            {req.status}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              style={{ padding: "4px 8px", fontSize: 11 }}
                              onClick={() => handleViewRequest(req)}
                            >
                              View
                            </button>
                            {req.approval_status === "PENDING" && canApprove ? (
                              <div className="hrms-approval-actions" style={{ display: "inline-flex", gap: 6 }}>
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  style={{ padding: "4px 10px", fontSize: 11, background: "#059669" }}
                                  onClick={() => handleOpenApprovalModal(req, "approve")}
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  style={{ padding: "4px 10px", fontSize: 11, color: "#dc2626" }}
                                  onClick={() => handleOpenApprovalModal(req, "reject")}
                                >
                                  Reject
                                </button>
                              </div>
                            ) : (
                              <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
                                {req.approval_remarks || (req.approval_status === "PENDING" ? "Pending Review" : "Processed")}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: HOLIDAY MASTER                                               */}
        {/* =================================================================== */}
        {activeTab === "holiday" && (
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="hrms-section-title">Holiday Master</h2>
                <div className="hrms-section-desc">
                  Company holidays evaluated branch-wise for leave validation and attendance calculations
                </div>
              </div>
              <span className="hrms-badge-shell">{holidays.length} Holidays</span>
            </div>

            {holidays.length === 0 ? (
              <div className="hrms-placeholder-box">
                <div className="hrms-placeholder-icon">
                  <IconCalendar />
                </div>
                <h3 className="hrms-placeholder-title">No Holidays Found</h3>
                <p className="hrms-placeholder-text">
                  Use the "+ Add Holiday" button above to configure company calendar holidays.
                </p>
              </div>
            ) : (
              <div className="hrms-approval-table-wrapper">
                <table className="hrms-approval-table">
                  <thead>
                    <tr>
                      <th>SR No.</th>
                      <th>Holiday Name</th>
                      <th>Date</th>
                      <th>Number of Days</th>
                      <th>Branch Applicability</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holidays.map((hol, idx) => (
                      <tr key={hol.id}>
                        <td>{idx + 1}</td>
                        <td style={{ fontWeight: 600 }}>{hol.name}</td>
                        <td>{hol.holiday_date}</td>
                        <td>{hol.number_of_days}</td>
                        <td>
                          <span
                            className="hrms-badge"
                            style={{ background: "#e0e7ff", color: "#3730a3" }}
                          >
                            {hol.branch_applicability === "ALL"
                              ? "All Branches"
                              : hol.branch_applicability}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`hrms-badge hrms-badge-${hol.is_active ? "active" : "inactive"}`}
                          >
                            {hol.is_active ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: 11, padding: "3px 8px" }}
                            onClick={() => {
                              setSelectedHoliday(hol);
                              setHolidayName(hol.name);
                              setHolidayDate(hol.holiday_date);
                              setHolidayDays(hol.number_of_days);
                              setHolidayBranch(hol.branch_applicability);
                              setHolidayActive(hol.is_active);
                              setActiveModal("holiday");
                            }}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 4: LEAVE ADJUSTMENT MATRIX                                      */}
        {/* =================================================================== */}
        {/* =================================================================== */}
        {/* TAB 4: LEAVE ADJUSTMENT                                             */}
        {/* =================================================================== */}
        {activeTab === "adjustments" && (
          <div className="card">
            <div className="card-header" style={{ flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2 className="hrms-section-title">Leave Adjustment</h2>
                <div className="hrms-section-desc">
                  Employee balance overview with audited manual balance adjustments
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder="Search employee or code..."
                  className="input"
                  style={{ width: 170 }}
                  value={adjSearch}
                  onChange={(e) => setAdjSearch(e.target.value)}
                />
                <select
                  className="form-control"
                  style={{ width: 150 }}
                  value={adjDepartmentFilter}
                  onChange={(e) => setAdjDepartmentFilter(e.target.value)}
                  title="Department Filter"
                >
                  <option value="ALL">All Departments</option>
                  {matrixDepartments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <select
                  className="form-control"
                  style={{ width: 140 }}
                  value={adjBranchFilter}
                  onChange={(e) => setAdjBranchFilter(e.target.value)}
                  title="Branch Filter"
                >
                  <option value="ALL">All Branches</option>
                  {matrixBranches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <select
                  className="form-control"
                  style={{ width: 160 }}
                  value={adjEmployeeFilter}
                  onChange={(e) => setAdjEmployeeFilter(e.target.value)}
                  title="Employee Filter"
                >
                  <option value="ALL">All Employees</option>
                  {matrixRows.map((r) => (
                    <option key={r.employee_id} value={r.employee_id}>
                      {r.employee_name}
                    </option>
                  ))}
                </select>
                <select
                  className="form-control"
                  style={{ width: 150 }}
                  value={adjLeaveTypeFilter}
                  onChange={(e) => setAdjLeaveTypeFilter(e.target.value)}
                  title="Leave Type Filter"
                >
                  <option value="ALL">All Leave Types</option>
                  {activeLeaveTypes.map((lt) => (
                    <option key={lt.id} value={lt.id}>
                      {lt.name}
                    </option>
                  ))}
                </select>
                <span className="hrms-badge-shell">{filteredMatrix.length} Employees</span>
              </div>
            </div>

            {filteredMatrix.length === 0 ? (
              <div className="hrms-placeholder-box">
                <div className="hrms-placeholder-icon">
                  <IconRefresh />
                </div>
                <h3 className="hrms-placeholder-title">No Leave Balances Found</h3>
                <p className="hrms-placeholder-text">
                  No employee balances match the selected filters. Check back or change filter options.
                </p>
              </div>
            ) : (
              <div className="hrms-approval-table-wrapper">
                <table className="hrms-approval-table">
                  <thead>
                    <tr>
                      <th style={{ width: "24%" }}>Employee</th>
                      <th style={{ width: "16%" }}>Department</th>
                      <th style={{ width: "48%" }}>Leave Balance Summary</th>
                      <th style={{ width: "12%", textAlign: "center" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMatrix.map((row) => {
                      const activeBalances = activeLeaveTypes
                        .filter((lt) => {
                          if (adjLeaveTypeFilter !== "ALL" && lt.id !== adjLeaveTypeFilter) {
                            return false;
                          }
                          return true;
                        })
                        .map((lt) => {
                          const bal = row.balances[lt.id] || row.balances[lt.name];
                          const avail = bal ? bal.available : 0;
                          return { lt, avail };
                        });

                      return (
                        <tr key={row.employee_id}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{row.employee_name}</div>
                            <div style={{ fontSize: 11, color: "var(--color-muted)", display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                              {row.employee_code && <span>ID: {row.employee_code}</span>}
                              {row.branch && row.branch !== "All Branches" && <span>• {row.branch}</span>}
                            </div>
                          </td>
                          <td>
                            <span className="hrms-badge" style={{ background: "#f1f5f9", color: "#334155" }}>
                              {row.department || "General"}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                              {activeBalances.length === 0 ? (
                                <span style={{ fontSize: 12, color: "var(--color-muted)" }}>No active allocations</span>
                              ) : (
                                activeBalances.map(({ lt, avail }) => (
                                  <span
                                    key={lt.id}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 4,
                                      padding: "3px 8px",
                                      background: avail > 0 ? "#f0fdf4" : "#f8fafc",
                                      border: `1px solid ${avail > 0 ? "#bbf7d0" : "#e2e8f0"}`,
                                      borderRadius: 6,
                                      fontSize: 12,
                                    }}
                                  >
                                    <span style={{ color: "#334155", fontWeight: 500 }}>{lt.name}:</span>
                                    <strong style={{ color: avail > 0 ? "#166534" : "#64748b" }}>{avail}</strong>
                                  </span>
                                ))
                              )}
                            </div>
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              style={{ fontSize: 11, padding: "4px 12px" }}
                              onClick={() => handleOpenAdjustment(row)}
                              title={`Adjust balance for ${row.employee_name}`}
                            >
                              Adjust
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB: LEAVE TYPES MASTER                                             */}
        {/* =================================================================== */}
        {activeTab === "leave-types" && (
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="hrms-section-title">Leave Types Master</h2>
                <div className="hrms-section-desc">
                  Configure entitlement rules, accrual schedules, carry-forward, and consecutive limits
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="hrms-badge-shell">{leaveTypes.length} Types</span>
                {canManageLeaveTypes && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleOpenAddType}
                  >
                    + Add Leave Type
                  </button>
                )}
              </div>
            </div>

            {leaveTypes.length === 0 ? (
              <div className="hrms-placeholder-box">
                <div className="hrms-placeholder-icon">
                  <IconFileText />
                </div>
                <h3 className="hrms-placeholder-title">No Leave Types Configured</h3>
                <p className="hrms-placeholder-text">
                  Create your organization's leave policies like Casual Leave, Sick Leave, Earned Leave, and custom leave types.
                </p>
                {canManageLeaveTypes && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ marginTop: 12 }}
                    onClick={handleOpenAddType}
                  >
                    + Add Leave Type
                  </button>
                )}
              </div>
            ) : (
              <div className="hrms-approval-table-wrapper">
                <table className="hrms-approval-table">
                  <thead>
                    <tr>
                      <th>Leave Type</th>
                      <th>Code</th>
                      <th>Paid / Unpaid</th>
                      <th>Annual Allocation</th>
                      <th>Accrual</th>
                      <th>Carry Forward</th>
                      <th>Max Consecutive Days</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaveTypes.map((lt) => (
                      <tr key={lt.id}>
                        <td>
                          <div style={{ fontWeight: 600, color: "var(--color-heading, #0f172a)" }}>{lt.name}</div>
                          {lt.description && (
                            <div style={{ fontSize: 11, color: "var(--color-muted, #64748b)" }}>{lt.description}</div>
                          )}
                          {lt.applicable_to && lt.applicable_to !== "ALL" && (
                            <div style={{ fontSize: 10, color: "#0284c7", marginTop: 2 }}>
                              Scope: {lt.applicable_to} {lt.applicable_departments ? `(${lt.applicable_departments})` : lt.applicable_branches ? `(${lt.applicable_branches})` : ""}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className="hrms-badge-shell" style={{ fontWeight: 700 }}>
                            {lt.code || "N/A"}
                          </span>
                        </td>
                        <td>
                          <span
                            className="hrms-badge"
                            style={{
                              background: lt.is_paid ? "#dcfce7" : "#f1f5f9",
                              color: lt.is_paid ? "#166534" : "#475569",
                              border: `1px solid ${lt.is_paid ? "#bbf7d0" : "#e2e8f0"}`,
                            }}
                          >
                            {lt.is_paid ? "PAID" : "UNPAID"}
                          </span>
                        </td>
                        <td>
                          <strong>{lt.annual_balance}</strong> {lt.allocation_unit ? lt.allocation_unit.toLowerCase() : "days"}
                        </td>
                        <td>
                          {lt.monthly_accrual ? (
                            <span style={{ fontSize: 12 }}>
                              {lt.accrual_frequency ? lt.accrual_frequency.charAt(0) + lt.accrual_frequency.slice(1).toLowerCase() : "Monthly"}
                              {lt.accrual_amount ? ` (${lt.accrual_amount} d/mo)` : ""}
                            </span>
                          ) : (
                            <span style={{ color: "var(--color-muted, #64748b)" }}>No</span>
                          )}
                          {lt.attendance_based_accrual && (
                            <div style={{ fontSize: 10, color: "#16a34a", marginTop: 2 }}>
                              +{lt.attendance_based_reward ?? 1}d on Full Attendance
                            </div>
                          )}
                        </td>
                        <td>
                          {lt.carry_forward_allowed ? (
                            <span style={{ color: "#166534", fontWeight: 600 }}>
                              Yes {lt.carry_forward_days > 0 ? `(Max ${lt.carry_forward_days}d)` : ""}
                            </span>
                          ) : (
                            <span style={{ color: "var(--color-muted, #64748b)" }}>No</span>
                          )}
                        </td>
                        <td>
                          {lt.max_consecutive_days && lt.max_consecutive_days > 0 ? (
                            <span>{lt.max_consecutive_days} Days</span>
                          ) : (
                            <span className="hrms-badge-shell" style={{ fontSize: 11 }}>No Limit</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`hrms-badge hrms-badge-${lt.is_active ? "active" : "inactive"}`}
                          >
                            {lt.is_active ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              style={{ fontSize: 11, padding: "3px 8px" }}
                              onClick={() => handleOpenEditType(lt)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              style={{
                                fontSize: 11,
                                padding: "3px 8px",
                                color: lt.is_active ? "#b45309" : "#166534",
                              }}
                              onClick={() => handleToggleTypeStatus(lt)}
                              title={lt.is_active ? "Deactivate leave type" : "Activate leave type"}
                            >
                              {lt.is_active ? "Disable" : "Enable"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              style={{ fontSize: 11, padding: "3px 8px", color: "#dc2626" }}
                              onClick={() => handleDeleteType(lt)}
                              title="Delete leave type"
                            >
                              Delete
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
        )}

        {/* =================================================================== */}
        {/* MODAL: APPLY LEAVE                                                  */}
        {/* =================================================================== */}
        {activeModal === "apply" && (() => {
          const selectedLtInModal = applicableLeaveTypes.find((t) => t.id === applyLeaveTypeId);
          const selectedBalInModal = selectedLtInModal ? myBalances.find((b) => b.leave_type_id === selectedLtInModal.id) : null;
          const availableInModal = selectedBalInModal ? selectedBalInModal.available : 0;
          const isOverConsecutive = Boolean(selectedLtInModal && selectedLtInModal.max_consecutive_days && selectedLtInModal.max_consecutive_days > 0 && applyCalculatedDays > selectedLtInModal.max_consecutive_days);
          const isInsufficientBalance = Boolean(selectedLtInModal && selectedLtInModal.is_paid && applyCalculatedDays > availableInModal);
          const isDateRangeInvalid = Boolean(applyFromDate && applyToDate && applyFromDate > applyToDate);

          return (
            <div className="hrms-modal-overlay">
              <div className="hrms-action-modal-card" style={{ maxWidth: 540 }}>
                <div className="hrms-action-modal-header">
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Apply for Leave</h3>
                  <button type="button" className="btn-icon" aria-label="Close" onClick={() => setActiveModal(null)}>
                    <IconClose />
                  </button>
                </div>

                <form onSubmit={handleApplyLeave}>
                  <div className="hrms-action-modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {/* Leave Type Dropdown */}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontWeight: 600 }}>Leave Type *</label>
                      {applicableLeaveTypes.length === 0 ? (
                        <div style={{ padding: "10px 12px", background: "#fef2f2", color: "#991b1b", borderRadius: 6, fontSize: 13, border: "1px solid #fecaca" }}>
                          No leave types are currently assigned to you.
                        </div>
                      ) : (
                        <>
                          <select
                            className="form-control"
                            style={{ width: "100%" }}
                            value={applyLeaveTypeId}
                            onChange={(e) => setApplyLeaveTypeId(e.target.value)}
                            required
                          >
                            {applicableLeaveTypes.map((t) => {
                              const bal = myBalances.find((b) => b.leave_type_id === t.id);
                              const availLabel = t.is_paid ? `(Available: ${bal ? bal.available : 0} Days)` : "(Unpaid)";
                              return (
                                <option key={t.id} value={t.id}>
                                  {t.name} {availLabel}
                                </option>
                              );
                            })}
                          </select>
                          {selectedLtInModal && (
                            <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 600, color: selectedLtInModal.is_paid ? "#16a34a" : "#64748b" }}>
                              {selectedLtInModal.is_paid
                                ? `Available Balance: ${availableInModal} Day${availableInModal === 1 ? "" : "s"}`
                                : "Leave Without Pay (Unpaid)"}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Date Pickers */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" htmlFor="apply-from-date" style={{ fontWeight: 600 }}>From Date *</label>
                        <DatePicker
                          id="apply-from-date"
                          value={toDDMMYYYY(applyFromDate)}
                          onChange={(val) => setApplyFromDate(toISO(val))}
                          placeholder="Select date"
                          ariaLabel="From Date"
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" htmlFor="apply-to-date" style={{ fontWeight: 600 }}>To Date *</label>
                        <DatePicker
                          id="apply-to-date"
                          value={toDDMMYYYY(applyToDate)}
                          onChange={(val) => setApplyToDate(toISO(val))}
                          placeholder="Select date"
                          ariaLabel="To Date"
                        />
                      </div>
                    </div>

                    {/* Number of Days (Calculated, read-only) */}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontWeight: 600 }}>Number of Days</label>
                      <div
                        className="form-control"
                        style={{
                          background: "var(--color-bg-secondary, #f8fafc)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          height: "auto",
                          padding: "9px 12px",
                        }}
                      >
                        <span style={{ color: "var(--color-muted, #64748b)", fontSize: 13, fontWeight: 500 }}>Number of Days:</span>
                        <strong style={{ color: "var(--color-primary, #2563eb)", fontSize: 15 }}>
                          {calculatingDays ? "Calculating..." : `${applyCalculatedDays} Day${applyCalculatedDays === 1 ? "" : "s"}`}
                        </strong>
                      </div>
                    </div>

                    {(isDateRangeInvalid || calcError) && (
                      <div style={{ padding: "8px 12px", background: "#fef2f2", color: "#b91c1c", borderRadius: 6, fontSize: 12.5, border: "1px solid #fecaca" }}>
                        {calcError || "From date cannot be after To date."}
                      </div>
                    )}

                    {/* Consecutive Days Warning */}
                    {isOverConsecutive && selectedLtInModal && (
                      <div style={{ padding: "8px 12px", background: "#fffbeb", color: "#b45309", borderRadius: 6, fontSize: 12.5, border: "1px solid #fde68a" }}>
                        Maximum {selectedLtInModal.max_consecutive_days} consecutive days are allowed for {selectedLtInModal.name}.
                      </div>
                    )}

                    {/* Insufficient Balance Warning */}
                    {isInsufficientBalance && selectedLtInModal && (
                      <div style={{ padding: "8px 12px", background: "#fef2f2", color: "#b91c1c", borderRadius: 6, fontSize: 12.5, border: "1px solid #fecaca" }}>
                        Insufficient {selectedLtInModal.name} balance. Available: {availableInModal} days.
                      </div>
                    )}

                    {/* Reason */}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontWeight: 600 }}>Reason *</label>
                      <textarea
                        className="form-control"
                        style={{ width: "100%", height: 80, resize: "vertical" }}
                        placeholder="Enter reason..."
                        value={applyReason}
                        onChange={(e) => setApplyReason(e.target.value)}
                        required
                      />
                    </div>

                    {/* Attachment Upload */}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontWeight: 600 }}>Attachment (Optional)</label>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "8px 12px",
                          background: "var(--color-bg-secondary, #f8fafc)",
                          border: "1px dashed var(--color-border, #cbd5e1)",
                          borderRadius: 6,
                        }}
                      >
                        <label
                          className="btn btn-secondary btn-sm"
                          style={{
                            cursor: uploadingAttachment ? "not-allowed" : "pointer",
                            margin: 0,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            fontWeight: 500,
                          }}
                        >
                          <IconFileText />
                          <span>{uploadingAttachment ? "Uploading..." : "Choose File"}</span>
                          <input
                            type="file"
                            onChange={handleFileUpload}
                            disabled={uploadingAttachment}
                            style={{ display: "none" }}
                          />
                        </label>
                        <span
                          style={{
                            fontSize: 13,
                            color: attachmentFileName ? "#166534" : "var(--color-muted, #64748b)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontWeight: attachmentFileName ? 600 : 400,
                          }}
                        >
                          {attachmentFileName || (applyAttachment ? "File uploaded" : "No file chosen")}
                        </span>
                      </div>
                      {applyAttachment && !attachmentFileName && (
                        <input
                          type="text"
                          className="form-control"
                          style={{ width: "100%", marginTop: 6 }}
                          placeholder="or paste attachment URL..."
                          value={applyAttachment}
                          onChange={(e) => setApplyAttachment(e.target.value)}
                        />
                      )}
                    </div>
                  </div>

                  <div className="hrms-action-modal-footer">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setActiveModal(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={
                        loading ||
                        uploadingAttachment ||
                        applyCalculatedDays <= 0 ||
                        isDateRangeInvalid ||
                        isOverConsecutive ||
                        isInsufficientBalance ||
                        applicableLeaveTypes.length === 0
                      }
                    >
                      {loading ? "Submitting..." : "Submit"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          );
        })()}

        {/* =================================================================== */}
        {/* MODAL: LEAVE REQUEST DETAILS                                        */}
        {/* =================================================================== */}
        {activeModal === "detail" && selectedDetailRequest && (
          <div className="hrms-modal-overlay">
            <div className="hrms-action-modal-card" style={{ maxWidth: 560 }}>
              <div className="hrms-action-modal-header">
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Leave Request Details</h3>
                <button type="button" className="btn-icon" aria-label="Close" onClick={() => setActiveModal(null)}>
                  <IconClose />
                </button>
              </div>
              <div className="hrms-action-modal-body" style={{ gap: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label className="form-label" style={{ fontSize: 11, color: "var(--color-muted)" }}>Leave Type</label>
                    <div style={{ fontWeight: 600 }}>{selectedDetailRequest.leave_type_name}</div>
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: 11, color: "var(--color-muted)" }}>Number of Days</label>
                    <div style={{ fontWeight: 700, color: "#2563eb" }}>{selectedDetailRequest.number_of_days} Days</div>
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: 11, color: "var(--color-muted)" }}>From Date</label>
                    <div>{selectedDetailRequest.from_date}</div>
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: 11, color: "var(--color-muted)" }}>To Date</label>
                    <div>{selectedDetailRequest.to_date}</div>
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: 11, color: "var(--color-muted)" }}>Status</label>
                    <div>
                      <span className={`hrms-badge hrms-badge-${selectedDetailRequest.status.toLowerCase()}`}>
                        {selectedDetailRequest.status}
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: 11, color: "var(--color-muted)" }}>Approval Status</label>
                    <div>
                      <span className={`hrms-badge hrms-badge-${(selectedDetailRequest.approval_status || "PENDING").toLowerCase()}`}>
                        {selectedDetailRequest.approval_status || "PENDING"}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: 11, color: "var(--color-muted)" }}>Reason</label>
                  <div style={{ background: "#f8fafc", padding: "10px 12px", borderRadius: 6, fontSize: 13 }}>
                    {selectedDetailRequest.reason}
                  </div>
                </div>

                {selectedDetailRequest.approval_remarks && (
                  <div>
                    <label className="form-label" style={{ fontSize: 11, color: "var(--color-muted)" }}>Manager Remarks</label>
                    <div style={{ background: "#f1f5f9", padding: "10px 12px", borderRadius: 6, fontSize: 13, color: "#334155" }}>
                      {selectedDetailRequest.approval_remarks}
                    </div>
                  </div>
                )}

                <div>
                  <label className="form-label" style={{ fontSize: 11, color: "var(--color-muted)" }}>Attachment</label>
                  <div>
                    {selectedDetailRequest.attachment || selectedDetailRequest.attachment_url ? (
                      <a
                        href={(selectedDetailRequest.attachment || selectedDetailRequest.attachment_url) ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#2563eb", textDecoration: "underline", fontSize: 13 }}
                      >
                        View Attachment Document
                      </a>
                    ) : (
                      <span style={{ color: "var(--color-muted)", fontSize: 13 }}>No attachment uploaded</span>
                    )}
                  </div>
                </div>

                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12, color: "var(--color-muted)" }}>
                  <div>Created By: {selectedDetailRequest.created_by_name || "Self"}</div>
                  <div>Created Date: {selectedDetailRequest.created_at ? new Date(selectedDetailRequest.created_at).toLocaleString() : "-"}</div>
                  <div>Updated By: {selectedDetailRequest.updated_by_name || "-"}</div>
                  <div>Updated Date: {selectedDetailRequest.updated_at ? new Date(selectedDetailRequest.updated_at).toLocaleString() : "-"}</div>
                </div>
              </div>
              <div className="hrms-action-modal-footer">
                {selectedDetailRequest.status === "PENDING" && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ color: "#dc2626", marginRight: "auto" }}
                    onClick={() => {
                      setActiveModal(null);
                      handleCancelRequest(selectedDetailRequest.id);
                    }}
                  >
                    Cancel Request
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setActiveModal(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* DRAWER: LEAVE ADJUSTMENT WITH AUDIT TRAIL                          */}
        {/* =================================================================== */}
        {/* =================================================================== */}
        {/* MODAL: LEAVE ADJUSTMENT WITH AUDIT TRAIL                           */}
        {/* =================================================================== */}
        {activeModal === "adjustment" && (
          <div className="hrms-modal-overlay">
            <div
              className="hrms-action-modal-card"
              style={{
                maxWidth: 580,
                maxHeight: "90vh",
                overflowY: "auto",
              }}
            >
              <div className="hrms-action-modal-header">
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Adjust Leave Balance</h3>
                  <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 2 }}>
                    Adjust employee leave balance with authoritative audit trail
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label="Close"
                  onClick={() => setActiveModal(null)}
                >
                  <IconClose />
                </button>
              </div>

              <form onSubmit={handleSaveAdjustment}>
                <div className="hrms-action-modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontWeight: 600 }}>Employee</label>
                      <input
                        type="text"
                        className="form-control"
                        style={{ width: "100%", background: "#f8fafc", color: "#1e293b", fontWeight: 600 }}
                        readOnly
                        value={`${adjEmployeeName}${adjEmployeeCode ? ` (${adjEmployeeCode})` : ""}`}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontWeight: 600 }}>Department</label>
                      <input
                        type="text"
                        className="form-control"
                        style={{ width: "100%", background: "#f8fafc", color: "#1e293b" }}
                        readOnly
                        value={adjEmployeeDepartment || "General"}
                      />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontWeight: 600 }}>Leave Type *</label>
                      <select
                        className="form-control"
                        style={{ width: "100%" }}
                        value={adjLeaveTypeId}
                        onChange={(e) => {
                          setAdjLeaveTypeId(e.target.value);
                          fetchAdjustmentHistory(adjEmployeeId, e.target.value);
                        }}
                        required
                      >
                        {activeLeaveTypes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontWeight: 600 }}>Current Balance</label>
                      <input
                        type="text"
                        className="form-control"
                        style={{ width: "100%", background: "#f8fafc", fontWeight: 700, color: "#0f766e" }}
                        readOnly
                        value={`${currentAdjTargetBalance} Days`}
                      />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontWeight: 600 }}>Adjustment Type *</label>
                      <select
                        className="form-control"
                        style={{ width: "100%" }}
                        value={adjType}
                        onChange={(e) =>
                          setAdjType(e.target.value as "ADD" | "DEDUCT")
                        }
                      >
                        <option value="ADD">Add (+)</option>
                        <option value="DEDUCT">Deduct (-)</option>
                      </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontWeight: 600 }}>Adjustment *</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        className="form-control"
                        style={{ width: "100%" }}
                        value={adjAmount}
                        onChange={(e) => setAdjAmount(Number(e.target.value))}
                        required
                      />
                    </div>
                  </div>

                  {/* Dynamic Calculation Preview */}
                  <div className="hrms-calc-preview">
                    <div className="hrms-calc-step">
                      <span className="hrms-calc-step-lbl">Current Available</span>
                      <span className="hrms-calc-step-val">{currentAdjTargetBalance}</span>
                    </div>
                    <span className="hrms-calc-operator">
                      {adjType === "ADD" ? "+" : "-"}
                    </span>
                    <div className="hrms-calc-step">
                      <span className="hrms-calc-step-lbl">Adjustment</span>
                      <span className="hrms-calc-step-val">{adjAmount}</span>
                    </div>
                    <span className="hrms-calc-operator">=</span>
                    <div className="hrms-calc-step">
                      <span className="hrms-calc-step-lbl">Resulting Available</span>
                      <span className="hrms-calc-step-val" style={{ color: "#047857", fontWeight: 800 }}>
                        {previewResultingBalance} Days
                      </span>
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontWeight: 600 }}>Reason *</label>
                    <textarea
                      className="form-control"
                      style={{ width: "100%", height: 65 }}
                      placeholder="e.g. Monthly earned leave correction, overtime comp-off credit..."
                      value={adjReason}
                      onChange={(e) => setAdjReason(e.target.value)}
                      required
                    />
                  </div>

                  {/* Chronological Audit Trail History Table */}
                  <div style={{ marginTop: 6 }}>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 700,
                        marginBottom: 6,
                        color: "var(--color-text)",
                      }}
                    >
                      Adjustment History Trail
                    </div>
                    {adjHistory.length === 0 ? (
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "var(--color-muted)",
                          padding: "10px",
                          background: "#f8fafc",
                          borderRadius: 6,
                        }}
                      >
                        No prior balance adjustments recorded for this employee and leave type.
                      </div>
                    ) : (
                      <div
                        style={{
                          maxHeight: 160,
                          overflowY: "auto",
                          border: "1px solid #e2e8f0",
                          borderRadius: 6,
                        }}
                      >
                        <table className="hrms-approval-table" style={{ fontSize: 11 }}>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Type</th>
                              <th>Previous</th>
                              <th>Adjustment</th>
                              <th>New</th>
                              <th>Reason</th>
                              <th>Adjusted By</th>
                            </tr>
                          </thead>
                          <tbody>
                            {adjHistory.map((h) => {
                              const isPositive = h.amount > 0 || h.adjustment_type.includes("ADD") || h.adjustment_type.includes("CREDIT");
                              return (
                                <tr key={h.id}>
                                  <td>{h.created_at.split("T")[0]}</td>
                                  <td>
                                    <span
                                      className="hrms-badge"
                                      style={{
                                        background: isPositive ? "#dcfce7" : "#fee2e2",
                                        color: isPositive ? "#166534" : "#991b1b",
                                        fontSize: 10,
                                      }}
                                    >
                                      {h.adjustment_type}
                                    </span>
                                  </td>
                                  <td>{h.previous_balance}</td>
                                  <td style={{ fontWeight: 600, color: isPositive ? "#166534" : "#991b1b" }}>
                                    {isPositive ? `+${h.amount}` : h.amount}
                                  </td>
                                  <td style={{ fontWeight: 600 }}>{h.new_balance}</td>
                                  <td style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {h.reason}
                                  </td>
                                  <td>{h.adjusted_by_name || "Admin"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>

                <div className="hrms-action-modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setActiveModal(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? "Saving..." : "Save Adjustment"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* MODAL: APPROVE LEAVE REQUEST                                        */}
        {/* =================================================================== */}
        {activeModal === "approve" && targetApproval && (
          <div className="hrms-modal-overlay">
            <div className="hrms-action-modal-card" style={{ maxWidth: 500 }}>
              <div className="hrms-action-modal-header">
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                  Approve Leave Request
                </h3>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label="Close"
                  onClick={() => {
                    setActiveModal(null);
                    setTargetApproval(null);
                  }}
                >
                  <IconClose />
                </button>
              </div>

              <div className="hrms-action-modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Details Section */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 14,
                    padding: "14px 16px",
                    background: "var(--color-bg-secondary, #f8fafc)",
                    borderRadius: 8,
                    border: "1px solid var(--color-border, #e2e8f0)",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, color: "var(--color-muted, #64748b)", fontWeight: 500 }}>Employee:</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text, #0f172a)", marginTop: 2 }}>
                      {targetApproval.employee_name}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--color-muted, #64748b)", fontWeight: 500 }}>Leave:</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text, #0f172a)", marginTop: 2 }}>
                      {targetApproval.leave_type_name}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--color-muted, #64748b)", fontWeight: 500 }}>Duration:</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-text, #0f172a)", marginTop: 2 }}>
                      {formatDateDisplay(targetApproval.from_date)} → {formatDateDisplay(targetApproval.to_date)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--color-muted, #64748b)", fontWeight: 500 }}>Days:</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#16a34a", marginTop: 2 }}>
                      {targetApproval.number_of_days} Day{targetApproval.number_of_days === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>

                {/* Impact Card */}
                <div
                  style={{
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    padding: "12px 14px",
                    borderRadius: 6,
                    fontSize: 13,
                    color: "#1e40af",
                    lineHeight: 1.5,
                  }}
                >
                  Upon approval, {targetApproval.number_of_days} day{targetApproval.number_of_days === 1 ? "" : "s"} will be deducted from the employee's applicable leave balance/consumed quota.
                </div>

                {/* Reviewer Notes */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>
                    Approval Remarks / Reviewer Notes
                  </label>
                  <textarea
                    className="form-control"
                    style={{ width: "100%", height: 75, resize: "vertical" }}
                    placeholder="Enter approval or rejection remarks..."
                    value={approvalRemarks}
                    onChange={(e) => setApprovalRemarks(e.target.value)}
                  />
                </div>
              </div>

              <div className="hrms-action-modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setActiveModal(null);
                    setTargetApproval(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  style={{ background: "#dc2626", borderColor: "#dc2626", color: "#ffffff" }}
                  disabled={loading}
                  onClick={() => handleExecuteApproval("reject")}
                >
                  {loading && approvalActionType === "reject" ? "Rejecting..." : "Reject"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ background: "#16a34a", borderColor: "#16a34a", color: "#ffffff" }}
                  disabled={loading}
                  onClick={() => handleExecuteApproval("approve")}
                >
                  {loading && approvalActionType === "approve" ? "Approving..." : "Approve"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* MODAL: HOLIDAY ADD/EDIT                                             */}
        {/* =================================================================== */}
        {activeModal === "holiday" && (
          <div className="hrms-modal-overlay">
            <div className="hrms-action-modal-card" style={{ maxWidth: 480 }}>
              <div className="hrms-action-modal-header">
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                  {selectedHoliday ? "Edit Holiday" : "Add Holiday"}
                </h3>
                <button type="button" className="btn-icon" aria-label="Close" onClick={() => setActiveModal(null)}>
                  <IconClose />
                </button>
              </div>

              <form onSubmit={handleSaveHoliday}>
                <div className="hrms-action-modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontWeight: 600 }}>Holiday Name *</label>
                    <input
                      type="text"
                      className="form-control"
                      style={{ width: "100%" }}
                      placeholder="e.g. Independence Day, Diwali, Christmas"
                      value={holidayName}
                      onChange={(e) => setHolidayName(e.target.value)}
                      required
                    />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontWeight: 600 }}>Holiday Date *</label>
                      <DatePicker
                        value={toDDMMYYYY(holidayDate)}
                        onChange={(val) => setHolidayDate(toISO(val))}
                        placeholder="Select date"
                        ariaLabel="Holiday Date"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontWeight: 600 }}>Number of Days *</label>
                      <input
                        type="number"
                        min="1"
                        className="form-control"
                        style={{ width: "100%" }}
                        value={holidayDays}
                        onChange={(e) => setHolidayDays(Number(e.target.value))}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontWeight: 600 }}>Branch Applicability *</label>
                    <select
                      className="form-control"
                      style={{ width: "100%" }}
                      value={holidayBranch}
                      onChange={(e) => setHolidayBranch(e.target.value)}
                    >
                      <option value="ALL">All Branches</option>
                      <option value="Thane">Thane</option>
                      <option value="Pune">Pune</option>
                      <option value="Mumbai">Mumbai</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      id="holActive"
                      checked={holidayActive}
                      onChange={(e) => setHolidayActive(e.target.checked)}
                    />
                    <label htmlFor="holActive" style={{ fontSize: 13, cursor: "pointer" }}>
                      Active Holiday
                    </label>
                  </div>
                </div>

                <div className="hrms-action-modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setActiveModal(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? "Saving..." : "Save Holiday"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* MODAL: LEAVE TYPE CREATE/EDIT                                       */}
        {/* =================================================================== */}
        {activeModal === "type" && (
          <div className="hrms-modal-overlay">
            <div className="hrms-action-modal-card" style={{ maxWidth: 680, maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
              <div className="hrms-action-modal-header">
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                    {selectedType ? `Edit Leave Type: ${selectedType.name}` : "Create New Leave Type"}
                  </h3>
                  <div style={{ fontSize: 12, color: "var(--color-muted, #64748b)", marginTop: 2 }}>
                    Define entitlement rules, accrual schedules, departmental applicability, and operational constraints
                  </div>
                </div>
                <button type="button" className="btn-icon" aria-label="Close" onClick={() => setActiveModal(null)}>
                  <IconClose />
                </button>
              </div>

              <form onSubmit={handleSaveType} style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
                <div className="hrms-action-modal-body" style={{ flex: "1 1 auto", overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
                  {/* Section 1: Basic Information */}
                  <div>
                    <h4 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-muted, #64748b)", margin: "0 0 10px 0" }}>
                      1. Basic Information
                    </h4>
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontWeight: 600 }}>Leave Type Name *</label>
                        <input
                          type="text"
                          className="form-control"
                          style={{ width: "100%" }}
                          placeholder="e.g. Earned Leave, Privilege Leave, Sabbatical"
                          value={typeName}
                          onChange={(e) => setTypeName(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontWeight: 600 }}>Leave Code *</label>
                        <input
                          type="text"
                          className="form-control"
                          style={{ width: "100%" }}
                          placeholder="e.g. EL, PL, SL"
                          value={typeCode}
                          onChange={(e) => setTypeCode(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    <div className="form-group" style={{ marginTop: 10, marginBottom: 0 }}>
                      <label className="form-label" style={{ fontWeight: 600 }}>Description</label>
                      <input
                        type="text"
                        className="form-control"
                        style={{ width: "100%" }}
                        placeholder="Brief description of leave policy purpose"
                        value={typeDescription}
                        onChange={(e) => setTypeDescription(e.target.value)}
                      />
                    </div>

                    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 10 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={typeIsPaid}
                          onChange={(e) => setTypeIsPaid(e.target.checked)}
                        />
                        <span style={{ fontWeight: 500 }}>Paid Leave</span>
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={typeActive}
                          onChange={(e) => setTypeActive(e.target.checked)}
                        />
                        <span style={{ fontWeight: 500 }}>Active</span>
                      </label>
                    </div>
                  </div>

                  {/* Section 2: Allocation & Accrual */}
                  <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 14 }}>
                    <h4 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-muted, #64748b)", margin: "0 0 10px 0" }}>
                      2. Allocation & Accrual Rules
                    </h4>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontWeight: 600 }}>Annual Allocation *</label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          className="form-control"
                          style={{ width: "100%" }}
                          value={typeAnnualBalance}
                          onChange={(e) => setTypeAnnualBalance(Number(e.target.value))}
                          required
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontWeight: 600 }}>Allocation Unit</label>
                        <select
                          className="form-control"
                          style={{ width: "100%" }}
                          value={typeAllocationUnit}
                          onChange={(e) => setTypeAllocationUnit(e.target.value)}
                        >
                          <option value="DAYS">Days</option>
                          <option value="HOURS">Hours</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ marginTop: 10, background: "#f8fafc", padding: "10px 14px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
                        <input
                          type="checkbox"
                          checked={typeMonthlyAccrual}
                          onChange={(e) => setTypeMonthlyAccrual(e.target.checked)}
                        />
                        <span>Enable Periodic Accrual</span>
                      </label>

                      {typeMonthlyAccrual && (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label" style={{ fontSize: 12, fontWeight: 500 }}>Accrual Frequency</label>
                            <select
                              className="form-control"
                              style={{ width: "100%" }}
                              value={typeAccrualFrequency}
                              onChange={(e) => setTypeAccrualFrequency(e.target.value)}
                            >
                              <option value="MONTHLY">Monthly</option>
                              <option value="QUARTERLY">Quarterly</option>
                              <option value="YEARLY">Yearly</option>
                              <option value="CUSTOM">Custom</option>
                            </select>
                          </div>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label" style={{ fontSize: 12, fontWeight: 500 }}>Accrual Amount per Period</label>
                            <input
                              type="number"
                              min="0"
                              step="0.25"
                              className="form-control"
                              style={{ width: "100%" }}
                              placeholder="e.g. 1.5"
                              value={typeAccrualAmount}
                              onChange={(e) => setTypeAccrualAmount(Number(e.target.value))}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Section 3: Department-Specific Applicability */}
                  <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 14 }}>
                    <h4 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-muted, #64748b)", margin: "0 0 10px 0" }}>
                      3. Applicability Rules
                    </h4>
                    <div className="form-group" style={{ marginBottom: 10 }}>
                      <label className="form-label" style={{ fontWeight: 600 }}>Applicable To</label>
                      <select
                        className="form-control"
                        style={{ width: "100%" }}
                        value={typeApplicableTo}
                        onChange={(e) => setTypeApplicableTo(e.target.value)}
                      >
                        <option value="ALL">All Employees</option>
                        <option value="DEPARTMENT">Specific Department</option>
                        <option value="BRANCH">Specific Branch</option>
                        <option value="CUSTOM">Custom Department & Branch</option>
                      </select>
                    </div>

                    {(typeApplicableTo === "DEPARTMENT" || typeApplicableTo === "CUSTOM") && (
                      <div className="form-group" style={{ marginBottom: 8 }}>
                        <label className="form-label" style={{ fontSize: 12, fontWeight: 500 }}>Applicable Departments (comma-separated)</label>
                        <input
                          type="text"
                          className="form-control"
                          style={{ width: "100%" }}
                          placeholder="e.g. Technical, Sales"
                          value={typeApplicableDepartments}
                          onChange={(e) => setTypeApplicableDepartments(e.target.value)}
                        />
                      </div>
                    )}

                    {(typeApplicableTo === "BRANCH" || typeApplicableTo === "CUSTOM") && (
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: 12, fontWeight: 500 }}>Applicable Branches (comma-separated)</label>
                        <input
                          type="text"
                          className="form-control"
                          style={{ width: "100%" }}
                          placeholder="e.g. Thane, Pune"
                          value={typeApplicableBranches}
                          onChange={(e) => setTypeApplicableBranches(e.target.value)}
                        />
                      </div>
                    )}
                  </div>

                  {/* Section 4: Full Attendance Bonus / Conditional Accrual */}
                  <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 14 }}>
                    <h4 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-muted, #64748b)", margin: "0 0 10px 0" }}>
                      4. Conditional Attendance Reward
                    </h4>
                    <div style={{ background: "#f0fdf4", padding: "10px 14px", borderRadius: 8, border: "1px solid #bbf7d0" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", fontWeight: 600, color: "#166534" }}>
                        <input
                          type="checkbox"
                          checked={typeAttendanceAccrual}
                          onChange={(e) => setTypeAttendanceAccrual(e.target.checked)}
                        />
                        <span>Enable Attendance-Based Bonus Accrual</span>
                      </label>

                      {typeAttendanceAccrual && (
                        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginTop: 10 }}>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label" style={{ fontSize: 12, fontWeight: 500 }}>Condition</label>
                            <input
                              type="text"
                              className="form-control"
                              style={{ width: "100%" }}
                              value={typeAttendanceCondition}
                              onChange={(e) => setTypeAttendanceCondition(e.target.value)}
                            />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label" style={{ fontSize: 12, fontWeight: 500 }}>Reward (+Days)</label>
                            <input
                              type="number"
                              min="0.5"
                              step="0.5"
                              className="form-control"
                              style={{ width: "100%" }}
                              value={typeAttendanceReward}
                              onChange={(e) => setTypeAttendanceReward(Number(e.target.value))}
                            />
                          </div>
                          <div className="form-group" style={{ gridColumn: "1 / -1", marginBottom: 0 }}>
                            <label className="form-label" style={{ fontSize: 12, fontWeight: 500 }}>Applicable Department (optional)</label>
                            <input
                              type="text"
                              className="form-control"
                              style={{ width: "100%" }}
                              placeholder="e.g. Technical (Leave blank to apply to all departments)"
                              value={typeAttendanceDepartments}
                              onChange={(e) => setTypeAttendanceDepartments(e.target.value)}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Section 5: Consecutive Days, Calendar Rules & Constraints */}
                  <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 14 }}>
                    <h4 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-muted, #64748b)", margin: "0 0 10px 0" }}>
                      5. Rules & Constraints
                    </h4>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontWeight: 600 }}>
                          Max Consecutive Days (0 = No Limit)
                        </label>
                        <input
                          type="number"
                          min="0"
                          className="form-control"
                          style={{ width: "100%" }}
                          placeholder="e.g. 3, 5, 15 or 0 for unlimited"
                          value={typeMaxConsecutive}
                          onChange={(e) => setTypeMaxConsecutive(Number(e.target.value))}
                        />
                        <span style={{ fontSize: 11, color: "var(--color-muted, #64748b)" }}>
                          {typeMaxConsecutive === 0 ? "Currently: No consecutive limit" : `Currently: Max ${typeMaxConsecutive} days at a time`}
                        </span>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontWeight: 600 }}>Min Advance Notice (Days)</label>
                        <input
                          type="number"
                          min="0"
                          className="form-control"
                          style={{ width: "100%" }}
                          value={typeMinNoticeDays}
                          onChange={(e) => setTypeMinNoticeDays(Number(e.target.value))}
                        />
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={typeAllowHalfDay}
                          onChange={(e) => setTypeAllowHalfDay(e.target.checked)}
                        />
                        <span>Allow Half Day</span>
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={typeAllowBackdated}
                          onChange={(e) => setTypeAllowBackdated(e.target.checked)}
                        />
                        <span>Allow Backdated Requests</span>
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={typeRequireAttachment}
                          onChange={(e) => setTypeRequireAttachment(e.target.checked)}
                        />
                        <span>Require Supporting Attachment</span>
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={typeAllowNegativeBalance}
                          onChange={(e) => setTypeAllowNegativeBalance(e.target.checked)}
                        />
                        <span>Allow Negative Balance</span>
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={typeCountWeekends}
                          onChange={(e) => setTypeCountWeekends(e.target.checked)}
                        />
                        <span>Count Weekends as Leave</span>
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={typeCountHolidays}
                          onChange={(e) => setTypeCountHolidays(e.target.checked)}
                        />
                        <span>Count Holidays as Leave</span>
                      </label>
                    </div>
                  </div>

                  {/* Section 6: Carry Forward Policy */}
                  <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 14 }}>
                    <h4 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-muted, #64748b)", margin: "0 0 10px 0" }}>
                      6. Carry Forward Policy
                    </h4>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "center" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={typeCarryForwardAllowed}
                          onChange={(e) => setTypeCarryForwardAllowed(e.target.checked)}
                        />
                        <span style={{ fontWeight: 500 }}>Allow Carry Forward</span>
                      </label>
                      {typeCarryForwardAllowed && (
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: 12, fontWeight: 500 }}>Max Carry Forward (Days)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            className="form-control"
                            style={{ width: "100%" }}
                            value={typeCarryForwardDays}
                            onChange={(e) => setTypeCarryForwardDays(Number(e.target.value))}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="hrms-action-modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setActiveModal(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? "Saving..." : selectedType ? "Update Leave Type" : "Save Leave Type"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
