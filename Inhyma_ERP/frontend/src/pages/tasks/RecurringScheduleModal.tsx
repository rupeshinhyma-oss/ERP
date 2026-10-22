import React, { useEffect, useState } from "react";
import type {
  AvailableUser,
  QuarterScheduleDetail,
  RecurrenceConfig,
  RecurrenceFrequency,
  RecurrencePreviewResponse,
  TaskPriority,
  TaskRecurringSchedule,
  TaskRecurringScheduleCreateInput,
  TaskRecurringScheduleUpdateInput,
} from "@/types/tasks";
import { tasksApi } from "@/lib/tasksApi";

interface RecurringScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  scheduleToEdit?: TaskRecurringSchedule | null;
  availableUsers: AvailableUser[];
}

const DEPARTMENTS = [
  "Frontend",
  "Backend",
  "Cloud Setup",
  "IT",
  "Director",
  "Management",
  "Design",
  "QA",
  "Sales",
  "Operations",
  "Finance",
  "HR",
];

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const QUARTER_PRESET_MONTHS: Record<string, number> = {
  Q1: 3,  // March
  Q2: 6,  // June
  Q3: 9,  // September
  Q4: 12, // December
};

export const RecurringScheduleModal: React.FC<RecurringScheduleModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  scheduleToEdit,
  availableUsers,
}) => {
  const isEditing = Boolean(scheduleToEdit);

  // Active form section tab: "details" | "schedule" | "reminders" | "period"
  const [activeSection, setActiveSection] = useState<"details" | "schedule" | "reminders" | "period">("details");

  // --- 1. Task Details State ---
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [department, setDepartment] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");

  // --- 2. Schedule State ---
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("MONTHLY");

  // Monthly State
  const [monthlyMode, setMonthlyMode] = useState<"EVERY_MONTH" | "SPECIFIC_MONTHS">("EVERY_MONTH");
  const [monthlySelectedMonths, setMonthlySelectedMonths] = useState<number[]>([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const [monthlyDayType, setMonthlyDayType] = useState<"SPECIFIC_DAY" | "LAST_DAY" | "LAST_WORKING_DAY">("SPECIFIC_DAY");
  const [monthlyDay, setMonthlyDay] = useState(28);

  // Quarterly State
  const [selectedQuarters, setSelectedQuarters] = useState<Array<"Q1" | "Q2" | "Q3" | "Q4">>(["Q1", "Q2", "Q3", "Q4"]);
  const [quarterConfigs, setQuarterConfigs] = useState<Record<string, QuarterScheduleDetail>>({
    Q1: { month: 3, day_type: "SPECIFIC_DAY", day: 31 },
    Q2: { month: 6, day_type: "SPECIFIC_DAY", day: 30 },
    Q3: { month: 9, day_type: "SPECIFIC_DAY", day: 30 },
    Q4: { month: 12, day_type: "SPECIFIC_DAY", day: 31 },
  });

  // Yearly State
  const [yearType, setYearType] = useState<"CALENDAR" | "FINANCIAL">("CALENDAR");
  const [financialYearStartMonth, setFinancialYearStartMonth] = useState(4); // April
  const [yearlyDueMonth, setYearlyDueMonth] = useState(12); // Dec
  const [yearlyDayType, setYearlyDayType] = useState<"SPECIFIC_DAY" | "LAST_DAY" | "LAST_WORKING_DAY">("SPECIFIC_DAY");
  const [yearlyDay, setYearlyDay] = useState(31);

  // --- 3. Reminders & Escalation State ---
  const [reminderLeadDays, setReminderLeadDays] = useState(3);
  const [escalationTimingType, setEscalationTimingType] = useState<string>("ON_DUE_DATE");
  const [escalationOffsetValue, setEscalationOffsetValue] = useState(0);
  const [escalationOffsetUnit, setEscalationOffsetUnit] = useState<"DAYS" | "WEEKS">("DAYS");
  const [escalationRepeatIntervalDays, setEscalationRepeatIntervalDays] = useState(7);
  const [holdUntil, setHoldUntil] = useState("");
  const [holdReason, setHoldReason] = useState("");

  // --- 4. Active Period State ---
  const [effectiveStartDate, setEffectiveStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [effectiveEndDate, setEffectiveEndDate] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "PAUSED">("ACTIVE");
  const [updatePendingInstances, setUpdatePendingInstances] = useState(false);

  // --- Live Preview & Async State ---
  const [preview, setPreview] = useState<RecurrencePreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Populate form on edit or reset on create
  useEffect(() => {
    if (scheduleToEdit) {
      setTitle(scheduleToEdit.title);
      setDescription(scheduleToEdit.description || "");
      setDepartment(scheduleToEdit.department || "");
      setAssigneeId(scheduleToEdit.assignee_id);
      setManagerId(scheduleToEdit.manager_id);
      setPriority(scheduleToEdit.priority || "MEDIUM");
      setFrequency(scheduleToEdit.frequency);
      setStatus(scheduleToEdit.status === "PAUSED" ? "PAUSED" : "ACTIVE");

      const cfg = scheduleToEdit.recurrence_config || {};
      if (scheduleToEdit.frequency === "MONTHLY") {
        setMonthlyMode(cfg.month_mode === "SPECIFIC_MONTHS" ? "SPECIFIC_MONTHS" : "EVERY_MONTH");
        setMonthlySelectedMonths(cfg.months && cfg.months.length > 0 ? cfg.months : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        setMonthlyDayType(cfg.day_type || "SPECIFIC_DAY");
        setMonthlyDay(cfg.day_of_month || cfg.day || 28);
      } else if (scheduleToEdit.frequency === "QUARTERLY") {
        const qList = (cfg.quarters && cfg.quarters.length > 0 ? cfg.quarters : ["Q1", "Q2", "Q3", "Q4"]) as Array<"Q1" | "Q2" | "Q3" | "Q4">;
        setSelectedQuarters(qList);
        const qMap = cfg.quarter_dates || cfg.quarter_schedules || {};
        const populated: Record<string, QuarterScheduleDetail> = {
          Q1: { month: 3, day_type: "SPECIFIC_DAY", day: 31 },
          Q2: { month: 6, day_type: "SPECIFIC_DAY", day: 30 },
          Q3: { month: 9, day_type: "SPECIFIC_DAY", day: 30 },
          Q4: { month: 12, day_type: "SPECIFIC_DAY", day: 31 },
        };
        for (const q of ["Q1", "Q2", "Q3", "Q4"]) {
          if (qMap[q]) {
            populated[q] = {
              month: qMap[q].month || QUARTER_PRESET_MONTHS[q],
              day_type: qMap[q].day_type || "SPECIFIC_DAY",
              day: qMap[q].day || qMap[q].day_of_month || 30,
            };
          }
        }
        setQuarterConfigs(populated);
      } else if (scheduleToEdit.frequency === "YEARLY") {
        setYearType(cfg.year_type || "CALENDAR");
        setFinancialYearStartMonth(cfg.financial_year_start_month || cfg.fy_start_month || 4);
        setYearlyDueMonth(cfg.due_month || cfg.month || 12);
        setYearlyDayType(cfg.day_type || "SPECIFIC_DAY");
        setYearlyDay(cfg.due_day || cfg.day || 31);
      }

      setReminderLeadDays(scheduleToEdit.reminder_lead_days ?? 3);
      setEscalationTimingType(scheduleToEdit.escalation_timing_type || "ON_DUE_DATE");
      setEscalationOffsetValue(scheduleToEdit.escalation_offset_days ?? 0);
      setEscalationOffsetUnit("DAYS");
      setEscalationRepeatIntervalDays(scheduleToEdit.escalation_repeat_interval_days ?? 7);

      setEffectiveStartDate(
        scheduleToEdit.effective_start_date
          ? scheduleToEdit.effective_start_date.split("T")[0]
          : new Date().toISOString().split("T")[0]
      );
      setEffectiveEndDate(scheduleToEdit.effective_end_date ? scheduleToEdit.effective_end_date.split("T")[0] : "");
      setHoldUntil(scheduleToEdit.hold_until ? scheduleToEdit.hold_until.split("T")[0] : "");
      setHoldReason(scheduleToEdit.hold_reason || "");
      setUpdatePendingInstances(false);
      setActiveSection("details");
    } else {
      setTitle("");
      setDescription("");
      setDepartment(availableUsers[0]?.department || "");
      setAssigneeId(availableUsers[0]?.id || "");
      setManagerId(availableUsers[0]?.id || "");
      setPriority("MEDIUM");
      setFrequency("MONTHLY");
      setStatus("ACTIVE");

      setMonthlyMode("EVERY_MONTH");
      setMonthlySelectedMonths([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      setMonthlyDayType("SPECIFIC_DAY");
      setMonthlyDay(28);

      setSelectedQuarters(["Q1", "Q2", "Q3", "Q4"]);
      setQuarterConfigs({
        Q1: { month: 3, day_type: "SPECIFIC_DAY", day: 31 },
        Q2: { month: 6, day_type: "SPECIFIC_DAY", day: 30 },
        Q3: { month: 9, day_type: "SPECIFIC_DAY", day: 30 },
        Q4: { month: 12, day_type: "SPECIFIC_DAY", day: 31 },
      });

      setYearType("CALENDAR");
      setFinancialYearStartMonth(4);
      setYearlyDueMonth(12);
      setYearlyDayType("SPECIFIC_DAY");
      setYearlyDay(31);

      setReminderLeadDays(3);
      setEscalationTimingType("ON_DUE_DATE");
      setEscalationOffsetValue(0);
      setEscalationOffsetUnit("DAYS");
      setEscalationRepeatIntervalDays(7);

      setEffectiveStartDate(new Date().toISOString().split("T")[0]);
      setEffectiveEndDate("");
      setHoldUntil("");
      setHoldReason("");
      setUpdatePendingInstances(false);
      setErrorMessage("");
      setActiveSection("details");
    }
  }, [scheduleToEdit, isOpen, availableUsers]);

  // Compute calculated escalation offset in calendar days
  const calculatedEscalationOffsetDays =
    escalationTimingType === "ON_DUE_DATE"
      ? 0
      : escalationOffsetUnit === "WEEKS"
      ? Number(escalationOffsetValue) * 7
      : Number(escalationOffsetValue);

  // Build active recurrence_config
  const buildCurrentConfig = (): RecurrenceConfig => {
    if (frequency === "MONTHLY") {
      return {
        month_mode: monthlyMode,
        months: monthlyMode === "SPECIFIC_MONTHS" ? monthlySelectedMonths : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        day_type: monthlyDayType,
        day_of_month: monthlyDayType === "SPECIFIC_DAY" ? Number(monthlyDay) : undefined,
      };
    }
    if (frequency === "QUARTERLY") {
      const qDates: Record<string, QuarterScheduleDetail> = {};
      selectedQuarters.forEach((q) => {
        qDates[q] = {
          month: quarterConfigs[q]?.month || QUARTER_PRESET_MONTHS[q],
          day_type: quarterConfigs[q]?.day_type || "SPECIFIC_DAY",
          day: quarterConfigs[q]?.day_type === "SPECIFIC_DAY" ? Number(quarterConfigs[q]?.day || 30) : undefined,
        };
      });
      return {
        quarters: selectedQuarters,
        quarter_dates: qDates,
      };
    }
    return {
      year_type: yearType,
      financial_year_start_month: yearType === "FINANCIAL" ? Number(financialYearStartMonth) : undefined,
      fy_start_month: yearType === "FINANCIAL" ? Number(financialYearStartMonth) : undefined,
      due_month: Number(yearlyDueMonth),
      day_type: yearlyDayType,
      due_day: yearlyDayType === "SPECIFIC_DAY" ? Number(yearlyDay) : undefined,
    };
  };

  // Live Recurrence Preview effect
  useEffect(() => {
    if (!isOpen) return;

    let isCurrent = true;
    const fetchPreview = async () => {
      setPreviewLoading(true);
      try {
        const cfg = buildCurrentConfig();
        const res = await tasksApi.previewRecurrence({
          frequency,
          recurrence_config: cfg,
          start_date: effectiveStartDate || undefined,
          effective_end_date: effectiveEndDate || undefined,
          reminder_lead_days: Number(reminderLeadDays),
          escalation_timing_type: escalationTimingType,
          escalation_offset_days: calculatedEscalationOffsetDays,
          escalation_repeat_interval_days: Number(escalationRepeatIntervalDays),
          hold_until: holdUntil || null,
        });
        if (isCurrent) {
          setPreview(res);
          setErrorMessage("");
        }
      } catch (err: any) {
        if (isCurrent) {
          setPreview(null);
        }
      } finally {
        if (isCurrent) setPreviewLoading(false);
      }
    };

    const timer = setTimeout(fetchPreview, 200);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [
    frequency,
    monthlyMode,
    monthlySelectedMonths,
    monthlyDayType,
    monthlyDay,
    selectedQuarters,
    quarterConfigs,
    yearType,
    financialYearStartMonth,
    yearlyDueMonth,
    yearlyDayType,
    yearlyDay,
    effectiveStartDate,
    effectiveEndDate,
    reminderLeadDays,
    escalationTimingType,
    calculatedEscalationOffsetDays,
    escalationRepeatIntervalDays,
    holdUntil,
    isOpen,
  ]);

  // Validation Warnings check
  const getValidationWarning = (): string | null => {
    if (escalationTimingType === "BEFORE_DUE_DATE") {
      if (calculatedEscalationOffsetDays > Number(reminderLeadDays)) {
        return `Notice: Manager escalation (${calculatedEscalationOffsetDays} days before due date) occurs before the reminder starts (${reminderLeadDays} days before). Ensure this early escalation is intentional.`;
      }
    }
    if (effectiveEndDate && effectiveStartDate && effectiveEndDate < effectiveStartDate) {
      return "Validation error: Effective End Date cannot precede Effective Start Date.";
    }
    return null;
  };

  const validationWarning = getValidationWarning();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMessage("Please enter a title for the recurring task.");
      setActiveSection("details");
      return;
    }
    if (!assigneeId) {
      setErrorMessage("Please select an assigned employee.");
      setActiveSection("details");
      return;
    }
    if (!managerId) {
      setErrorMessage("Please select a manager/reviewer.");
      setActiveSection("details");
      return;
    }
    if (frequency === "MONTHLY" && monthlyMode === "SPECIFIC_MONTHS" && monthlySelectedMonths.length === 0) {
      setErrorMessage("Please select at least one month for specific-months recurrence.");
      setActiveSection("schedule");
      return;
    }
    if (frequency === "QUARTERLY" && selectedQuarters.length === 0) {
      setErrorMessage("Please select at least one quarter for quarterly recurrence.");
      setActiveSection("schedule");
      return;
    }
    if (effectiveEndDate && effectiveStartDate && effectiveEndDate < effectiveStartDate) {
      setErrorMessage("Effective end date cannot precede effective start date.");
      setActiveSection("period");
      return;
    }
    if (holdUntil && (!holdReason || !holdReason.trim())) {
      setErrorMessage("Please provide a hold reason when setting a Hold Until date.");
      setActiveSection("reminders");
      return;
    }

    setSubmitting(true);
    setErrorMessage("");

    try {
      const config = buildCurrentConfig();

      if (isEditing && scheduleToEdit) {
        const updatePayload: TaskRecurringScheduleUpdateInput = {
          title: title.trim(),
          description: description.trim() || null,
          department: department.trim() || null,
          assignee_id: assigneeId,
          manager_id: managerId,
          priority,
          frequency,
          recurrence_config: config,
          reminder_lead_days: Number(reminderLeadDays),
          escalation_timing_type: escalationTimingType,
          escalation_offset_days: calculatedEscalationOffsetDays,
          escalation_repeat_interval_days: Number(escalationRepeatIntervalDays),
          effective_start_date: effectiveStartDate,
          effective_end_date: effectiveEndDate || null,
          hold_until: holdUntil || null,
          hold_reason: holdReason || null,
          status: status,
          update_pending_instances: updatePendingInstances,
        };
        await tasksApi.updateRecurringSchedule(scheduleToEdit.id, updatePayload);
      } else {
        const createPayload: TaskRecurringScheduleCreateInput = {
          title: title.trim(),
          description: description.trim() || null,
          department: department.trim() || null,
          assignee_id: assigneeId,
          manager_id: managerId,
          priority,
          frequency,
          recurrence_config: config,
          reminder_lead_days: Number(reminderLeadDays),
          escalation_timing_type: escalationTimingType,
          escalation_offset_days: calculatedEscalationOffsetDays,
          escalation_repeat_interval_days: Number(escalationRepeatIntervalDays),
          effective_start_date: effectiveStartDate,
          effective_end_date: effectiveEndDate || null,
          hold_until: holdUntil || null,
          hold_reason: holdReason || null,
        };
        await tasksApi.createRecurringSchedule(createPayload);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to save recurring task schedule.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyQ1ToAllSelected = () => {
    const q1 = quarterConfigs.Q1 || { month: 3, day_type: "SPECIFIC_DAY", day: 31 };
    setQuarterConfigs((prev) => ({
      ...prev,
      Q2: { month: QUARTER_PRESET_MONTHS.Q2, day_type: q1.day_type, day: q1.day },
      Q3: { month: QUARTER_PRESET_MONTHS.Q3, day_type: q1.day_type, day: q1.day },
      Q4: { month: QUARTER_PRESET_MONTHS.Q4, day_type: q1.day_type, day: q1.day },
    }));
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "760px",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.05)",
          border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#f8fafc",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "16px" }}>🔄</span>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                {isEditing ? "Edit Recurring Task Schedule" : "Create Recurring Task Schedule"}
              </h3>
            </div>
            <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#64748b" }}>
              Company working week is Monday–Saturday. Public holidays are not considered.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "22px",
              cursor: "pointer",
              color: "#64748b",
              lineHeight: 1,
              padding: "4px",
            }}
          >
            &times;
          </button>
        </div>

        {/* Live Timeline & Occurrence Preview Banner (Always Visible) */}
        <div
          style={{
            padding: "12px 20px",
            background: preview?.hold_active ? "#fffbeb" : "#f0fdf4",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "14px" }}>⚡</span>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: preview?.hold_active ? "#92400e" : "#166534" }}>
                Next Occurrence Timeline Preview
              </span>
              {previewLoading && (
                <span style={{ fontSize: "11.5px", color: "#15803d" }}>(calculating...)</span>
              )}
            </div>

            {preview?.next_period && (
              <div style={{ display: "flex", gap: "6px" }}>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: "12px",
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                    color: "#0f172a",
                  }}
                >
                  Period: {preview.next_period}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: "12px",
                    background: "#2563eb",
                    color: "#ffffff",
                  }}
                >
                  Due: {preview.formatted_due_date || preview.next_due_date}
                </span>
              </div>
            )}
          </div>

          {preview?.formatted_due_date ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginTop: "4px" }}>
              <div style={{ background: "#ffffff", padding: "6px 10px", borderRadius: "6px", border: "1px solid #e2e8f0", fontSize: "11.5px" }}>
                <div style={{ color: "#64748b", fontWeight: 600 }}>🔔 Reminder Starts</div>
                <div style={{ fontWeight: 700, color: "#1e293b", marginTop: "1px" }}>
                  {preview.formatted_reminder_date || preview.reminder_date}
                </div>
                <div style={{ fontSize: "10.5px", color: "#64748b" }}>{reminderLeadDays} days prior to deadline</div>
              </div>

              <div style={{ background: "#ffffff", padding: "6px 10px", borderRadius: "6px", border: "1px solid #e2e8f0", fontSize: "11.5px" }}>
                <div style={{ color: "#64748b", fontWeight: 600 }}>⚠️ Manager Escalation</div>
                <div style={{ fontWeight: 700, color: "#b91c1c", marginTop: "1px" }}>
                  {preview.formatted_escalation_date || preview.escalation_date}
                </div>
                <div style={{ fontSize: "10.5px", color: "#64748b" }}>
                  {escalationTimingType === "ON_DUE_DATE"
                    ? "On due date"
                    : escalationTimingType === "BEFORE_DUE_DATE"
                    ? `${calculatedEscalationOffsetDays}d before due date`
                    : `${calculatedEscalationOffsetDays}d after (overdue)`}
                </div>
              </div>

              <div style={{ background: "#ffffff", padding: "6px 10px", borderRadius: "6px", border: "1px solid #e2e8f0", fontSize: "11.5px" }}>
                <div style={{ color: "#64748b", fontWeight: 600 }}>🔁 Repeat Escalation</div>
                <div style={{ fontWeight: 700, color: "#334155", marginTop: "1px" }}>
                  Every {escalationRepeatIntervalDays} days
                </div>
                <div style={{ fontSize: "10.5px", color: "#64748b" }}>While task remains open</div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: "12px", color: "#15803d" }}>
              {preview?.explanation || "Calculating next occurrence based on schedule rules..."}
            </div>
          )}

          {preview?.hold_active && (
            <div style={{ fontSize: "11.5px", color: "#b45309", marginTop: "2px" }}>
              ⏸️ Active Hold Till {holdUntil}: Reminders and escalations are suppressed while the task is held.
            </div>
          )}
        </div>

        {/* Section Navigation Tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid #e2e8f0",
            background: "#fafafa",
            padding: "0 16px",
            gap: "4px",
          }}
        >
          {[
            { key: "details", label: "1. Task Details", icon: "📝" },
            { key: "schedule", label: "2. Schedule & Cadence", icon: "📅" },
            { key: "reminders", label: "3. Reminders & Escalation", icon: "⏰" },
            { key: "period", label: "4. Active Period", icon: "🛡️" },
          ].map((tab) => (
            <button
              type="button"
              key={tab.key}
              onClick={() => setActiveSection(tab.key as any)}
              style={{
                padding: "10px 14px",
                background: "none",
                border: "none",
                borderBottom: activeSection === tab.key ? "2px solid #2563eb" : "2px solid transparent",
                fontWeight: activeSection === tab.key ? 700 : 500,
                fontSize: "12.5px",
                color: activeSection === tab.key ? "#2563eb" : "#64748b",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                whiteSpace: "nowrap",
                marginBottom: "-1px",
              }}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ overflowY: "auto", padding: "18px 20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {errorMessage && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: "6px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#b91c1c",
                fontSize: "12.5px",
              }}
            >
              ⚠️ {errorMessage}
            </div>
          )}

          {validationWarning && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                background: "#fffbeb",
                border: "1px solid #fef08a",
                color: "#92400e",
                fontSize: "12px",
              }}
            >
              ℹ️ {validationWarning}
            </div>
          )}

          {/* ================= SECTION 1: TASK DETAILS ================= */}
          {activeSection === "details" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Task Title *
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Monthly Branch Inventory Audit or Quarterly Statutory Filing"
                    required
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Department
                  </label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      background: "#ffffff",
                      boxSizing: "border-box",
                    }}
                  >
                    <option value="">-- Select Department --</option>
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Description / Standard Operating Procedure (SOP)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Provide instructions or checklist to be included on every recurring instance generated..."
                  rows={2}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Assigned Employee *
                  </label>
                  <select
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    required
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      background: "#ffffff",
                      boxSizing: "border-box",
                    }}
                  >
                    <option value="">Select Employee</option>
                    {availableUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name} {u.department ? `(${u.department})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Reviewer / Manager *
                  </label>
                  <select
                    value={managerId}
                    onChange={(e) => setManagerId(e.target.value)}
                    required
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      background: "#ffffff",
                      boxSizing: "border-box",
                    }}
                  >
                    <option value="">Select Reviewer</option>
                    {availableUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name} {u.department ? `(${u.department})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Priority
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TaskPriority)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      background: "#ffffff",
                      boxSizing: "border-box",
                    }}
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
                <button
                  type="button"
                  onClick={() => setActiveSection("schedule")}
                  style={{
                    padding: "7px 16px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    background: "#f8fafc",
                    color: "#1e293b",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Next: Schedule & Cadence &rarr;
                </button>
              </div>
            </div>
          )}

          {/* ================= SECTION 2: SCHEDULE & CADENCE ================= */}
          {activeSection === "schedule" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {/* Frequency Selector */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "6px" }}>
                  Recurrence Frequency
                </label>
                <div style={{ display: "flex", gap: "8px" }}>
                  {(["MONTHLY", "QUARTERLY", "YEARLY"] as RecurrenceFrequency[]).map((f) => (
                    <button
                      type="button"
                      key={f}
                      onClick={() => setFrequency(f)}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        borderRadius: "6px",
                        border: frequency === f ? "2px solid #2563eb" : "1px solid #cbd5e1",
                        background: frequency === f ? "#eff6ff" : "#ffffff",
                        color: frequency === f ? "#1d4ed8" : "#475569",
                        fontWeight: frequency === f ? 700 : 500,
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      {f === "MONTHLY" ? "📅 Monthly" : f === "QUARTERLY" ? "📊 Quarterly" : "📆 Yearly"}
                    </button>
                  ))}
                </div>
              </div>

              {/* MONTHLY CONFIGURATION */}
              {frequency === "MONTHLY" && (
                <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                      Month Cadence
                    </label>
                    <div style={{ display: "flex", gap: "16px" }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="monthly_mode"
                          checked={monthlyMode === "EVERY_MONTH"}
                          onChange={() => setMonthlyMode("EVERY_MONTH")}
                        />
                        <span>Every Month (Jan–Dec)</span>
                      </label>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="monthly_mode"
                          checked={monthlyMode === "SPECIFIC_MONTHS"}
                          onChange={() => setMonthlyMode("SPECIFIC_MONTHS")}
                        />
                        <span>Specific Months Only</span>
                      </label>
                    </div>
                  </div>

                  {/* Specific Months selector chips */}
                  {monthlyMode === "SPECIFIC_MONTHS" && (
                    <div style={{ background: "#ffffff", padding: "10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "#475569" }}>Select Applicable Months:</span>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            type="button"
                            onClick={() => setMonthlySelectedMonths([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])}
                            style={{ fontSize: "11px", padding: "2px 6px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "4px", cursor: "pointer" }}
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() => setMonthlySelectedMonths([])}
                            style={{ fontSize: "11px", padding: "2px 6px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "4px", cursor: "pointer" }}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "6px" }}>
                        {MONTH_NAMES.map((m, idx) => {
                          const mNum = idx + 1;
                          const isSelected = monthlySelectedMonths.includes(mNum);
                          return (
                            <button
                              type="button"
                              key={m}
                              onClick={() => {
                                if (isSelected) {
                                  setMonthlySelectedMonths(monthlySelectedMonths.filter((x) => x !== mNum));
                                } else {
                                  setMonthlySelectedMonths([...monthlySelectedMonths, mNum].sort((a, b) => a - b));
                                }
                              }}
                              style={{
                                padding: "6px",
                                borderRadius: "4px",
                                border: isSelected ? "1.5px solid #2563eb" : "1px solid #cbd5e1",
                                background: isSelected ? "#eff6ff" : "#ffffff",
                                color: isSelected ? "#1d4ed8" : "#475569",
                                fontSize: "12px",
                                fontWeight: isSelected ? 700 : 500,
                                cursor: "pointer",
                              }}
                            >
                              {m}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Monthly Due Date Rule */}
                  <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "12px", alignItems: "center" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                        Due Date Rule
                      </label>
                      <select
                        value={monthlyDayType}
                        onChange={(e) => setMonthlyDayType(e.target.value as any)}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "13px",
                          background: "#ffffff",
                        }}
                      >
                        <option value="SPECIFIC_DAY">Specific Day of Month (1–31)</option>
                        <option value="LAST_WORKING_DAY">Last Working Day (Mon–Sat)</option>
                        <option value="LAST_DAY">Last Calendar Day</option>
                      </select>
                    </div>

                    {monthlyDayType === "SPECIFIC_DAY" ? (
                      <div>
                        <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                          Day of Month (1–31)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={31}
                          value={monthlyDay}
                          onChange={(e) => setMonthlyDay(Math.min(31, Math.max(1, Number(e.target.value))))}
                          style={{
                            width: "100%",
                            padding: "8px 10px",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            fontSize: "13px",
                            boxSizing: "border-box",
                          }}
                        />
                      </div>
                    ) : (
                      <div style={{ fontSize: "11.5px", color: "#64748b", paddingTop: "16px" }}>
                        {monthlyDayType === "LAST_WORKING_DAY"
                          ? "Automatically picks final Mon–Sat (steps back from Sun)."
                          : "Automatically uses the final calendar day (28, 29, 30, or 31)."}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* QUARTERLY CONFIGURATION */}
              {frequency === "QUARTERLY" && (
                <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                      <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>
                        Select Applicable Quarters & Deadline Config
                      </label>
                      <button
                        type="button"
                        onClick={copyQ1ToAllSelected}
                        style={{
                          fontSize: "11px",
                          padding: "2px 8px",
                          background: "#ffffff",
                          border: "1px solid #cbd5e1",
                          borderRadius: "4px",
                          color: "#2563eb",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                        title="Copy Q1 day rule to Q2, Q3, and Q4"
                      >
                        📋 Copy Q1 Rule to All Quarters
                      </button>
                    </div>

                    <div style={{ display: "flex", gap: "12px", marginBottom: "12px" }}>
                      {(["Q1", "Q2", "Q3", "Q4"] as const).map((q) => {
                        const isChecked = selectedQuarters.includes(q);
                        return (
                          <label
                            key={q}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              padding: "6px 12px",
                              borderRadius: "6px",
                              border: isChecked ? "1.5px solid #2563eb" : "1px solid #cbd5e1",
                              background: isChecked ? "#eff6ff" : "#ffffff",
                              cursor: "pointer",
                              fontSize: "13px",
                              fontWeight: 700,
                              color: isChecked ? "#1d4ed8" : "#475569",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedQuarters([...selectedQuarters, q]);
                                else setSelectedQuarters(selectedQuarters.filter((item) => item !== q));
                              }}
                            />
                            <span>{q}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Quarter Detail Rows */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {(["Q1", "Q2", "Q3", "Q4"] as const).map((q) => {
                      if (!selectedQuarters.includes(q)) return null;
                      const qConf = quarterConfigs[q] || { month: QUARTER_PRESET_MONTHS[q], day_type: "SPECIFIC_DAY", day: 30 };
                      return (
                        <div
                          key={q}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "70px 1.2fr 1.5fr 100px",
                            gap: "8px",
                            alignItems: "center",
                            background: "#ffffff",
                            padding: "8px 12px",
                            borderRadius: "6px",
                            border: "1px solid #e2e8f0",
                          }}
                        >
                          <span style={{ fontWeight: 700, color: "#1e293b", fontSize: "13px" }}>{q}</span>

                          {/* Due Month */}
                          <select
                            value={qConf.month || QUARTER_PRESET_MONTHS[q]}
                            onChange={(e) => {
                              const newM = Number(e.target.value);
                              setQuarterConfigs({
                                ...quarterConfigs,
                                [q]: { ...qConf, month: newM },
                              });
                            }}
                            style={{ padding: "6px 8px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "12px", background: "#ffffff" }}
                          >
                            {MONTH_NAMES.map((m, idx) => (
                              <option key={m} value={idx + 1}>
                                {m} (Month {idx + 1})
                              </option>
                            ))}
                          </select>

                          {/* Day Type */}
                          <select
                            value={qConf.day_type || "SPECIFIC_DAY"}
                            onChange={(e) => {
                              const newType = e.target.value as any;
                              setQuarterConfigs({
                                ...quarterConfigs,
                                [q]: { ...qConf, day_type: newType },
                              });
                            }}
                            style={{ padding: "6px 8px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "12px", background: "#ffffff" }}
                          >
                            <option value="SPECIFIC_DAY">Specific Day</option>
                            <option value="LAST_WORKING_DAY">Last Working Day (Mon–Sat)</option>
                            <option value="LAST_DAY">Last Calendar Day</option>
                          </select>

                          {/* Day input if specific day */}
                          {qConf.day_type === "SPECIFIC_DAY" ? (
                            <input
                              type="number"
                              min={1}
                              max={31}
                              value={qConf.day || 30}
                              onChange={(e) => {
                                const newD = Math.min(31, Math.max(1, Number(e.target.value)));
                                setQuarterConfigs({
                                  ...quarterConfigs,
                                  [q]: { ...qConf, day: newD },
                                });
                              }}
                              placeholder="Day"
                              style={{ width: "100%", padding: "6px 8px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "12px", boxSizing: "border-box" }}
                            />
                          ) : (
                            <span style={{ fontSize: "11px", color: "#64748b" }}>Auto-calc</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* YEARLY CONFIGURATION */}
              {frequency === "YEARLY" && (
                <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "12px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                        Year Cadence Basis
                      </label>
                      <select
                        value={yearType}
                        onChange={(e) => setYearType(e.target.value as any)}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "13px",
                          background: "#ffffff",
                        }}
                      >
                        <option value="CALENDAR">Calendar Year (Jan–Dec)</option>
                        <option value="FINANCIAL">Financial Year (e.g. Apr–Mar)</option>
                      </select>
                    </div>

                    {yearType === "FINANCIAL" && (
                      <div>
                        <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                          Financial Year Start Month
                        </label>
                        <select
                          value={financialYearStartMonth}
                          onChange={(e) => setFinancialYearStartMonth(Number(e.target.value))}
                          style={{
                            width: "100%",
                            padding: "8px 10px",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            fontSize: "13px",
                            background: "#ffffff",
                          }}
                        >
                          <option value={4}>April (India / UK standard: FY2026-27)</option>
                          <option value={1}>January</option>
                          <option value={7}>July</option>
                          <option value={10}>October</option>
                        </select>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1fr", gap: "12px", alignItems: "center" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                        Due Month
                      </label>
                      <select
                        value={yearlyDueMonth}
                        onChange={(e) => setYearlyDueMonth(Number(e.target.value))}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "13px",
                          background: "#ffffff",
                        }}
                      >
                        {MONTH_NAMES.map((m, idx) => (
                          <option key={m} value={idx + 1}>
                            {m} (Month {idx + 1})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                        Due Day Rule
                      </label>
                      <select
                        value={yearlyDayType}
                        onChange={(e) => setYearlyDayType(e.target.value as any)}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "13px",
                          background: "#ffffff",
                        }}
                      >
                        <option value="SPECIFIC_DAY">Specific Day of Month</option>
                        <option value="LAST_WORKING_DAY">Last Working Day (Mon–Sat)</option>
                        <option value="LAST_DAY">Last Calendar Day</option>
                      </select>
                    </div>

                    {yearlyDayType === "SPECIFIC_DAY" ? (
                      <div>
                        <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                          Day (1–31)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={31}
                          value={yearlyDay}
                          onChange={(e) => setYearlyDay(Math.min(31, Math.max(1, Number(e.target.value))))}
                          style={{
                            width: "100%",
                            padding: "8px 10px",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            fontSize: "13px",
                            boxSizing: "border-box",
                          }}
                        />
                      </div>
                    ) : (
                      <div style={{ fontSize: "11.5px", color: "#64748b", paddingTop: "18px" }}>
                        {yearlyDayType === "LAST_WORKING_DAY" ? "Mon–Sat Working Day" : "Month-end calendar day"}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px" }}>
                <button
                  type="button"
                  onClick={() => setActiveSection("details")}
                  style={{
                    padding: "7px 14px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    color: "#64748b",
                    fontSize: "12.5px",
                    cursor: "pointer",
                  }}
                >
                  &larr; Back to Details
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection("reminders")}
                  style={{
                    padding: "7px 16px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    background: "#f8fafc",
                    color: "#1e293b",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Next: Reminders & Escalation &rarr;
                </button>
              </div>
            </div>
          )}

          {/* ================= SECTION 3: REMINDERS & ESCALATION ================= */}
          {activeSection === "reminders" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {/* Timeline Configuration Cards */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                {/* Reminder Start */}
                <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                    <span>🔔</span>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b" }}>
                      Reminder Notification Start
                    </label>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={reminderLeadDays}
                      onChange={(e) => setReminderLeadDays(Math.max(0, Number(e.target.value)))}
                      style={{
                        width: "80px",
                        padding: "7px 10px",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                        fontSize: "13px",
                      }}
                    />
                    <span style={{ fontSize: "12.5px", color: "#334155" }}>calendar days before due date</span>
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b", marginTop: "6px" }}>
                    Notifies assignee and owner to begin execution ahead of the deadline.
                  </div>
                </div>

                {/* Manager Escalation */}
                <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                    <span>⚠️</span>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b" }}>
                      Manager Escalation Timing
                    </label>
                  </div>
                  <select
                    value={escalationTimingType}
                    onChange={(e) => setEscalationTimingType(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "7px 10px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "12.5px",
                      background: "#ffffff",
                    }}
                  >
                    <option value="ON_DUE_DATE">On Due Date (Standard Deadline)</option>
                    <option value="AFTER_DUE_DATE">After Due Date (Overdue SLA Breach)</option>
                    <option value="BEFORE_DUE_DATE">Before Due Date (Proactive Review)</option>
                  </select>

                  {escalationTimingType !== "ON_DUE_DATE" && (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px" }}>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={escalationOffsetValue}
                        onChange={(e) => setEscalationOffsetValue(Math.max(1, Number(e.target.value)))}
                        style={{
                          width: "70px",
                          padding: "6px 8px",
                          borderRadius: "4px",
                          border: "1px solid #cbd5e1",
                          fontSize: "12.5px",
                        }}
                      />
                      <select
                        value={escalationOffsetUnit}
                        onChange={(e) => setEscalationOffsetUnit(e.target.value as any)}
                        style={{
                          padding: "6px 8px",
                          borderRadius: "4px",
                          border: "1px solid #cbd5e1",
                          fontSize: "12px",
                          background: "#ffffff",
                        }}
                      >
                        <option value="DAYS">Days</option>
                        <option value="WEEKS">Weeks</option>
                      </select>
                      <span style={{ fontSize: "12px", color: "#64748b" }}>
                        {escalationTimingType === "BEFORE_DUE_DATE" ? "prior" : "after due date"}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Repeat Escalation & Manager Recipient */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "6px" }}>
                    🔁 Repeat Escalation Interval
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={escalationRepeatIntervalDays}
                      onChange={(e) => setEscalationRepeatIntervalDays(Math.max(1, Number(e.target.value)))}
                      style={{
                        width: "80px",
                        padding: "7px 10px",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                        fontSize: "13px",
                      }}
                    />
                    <span style={{ fontSize: "12.5px", color: "#334155" }}>days while task remains open</span>
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
                    Re-notifies the manager recursively until the instance is marked Done or Verified.
                  </div>
                </div>

                <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "6px" }}>
                    👤 Escalation Recipient
                  </label>
                  <div style={{ fontSize: "12.5px", color: "#0f172a", fontWeight: 600 }}>
                    {availableUsers.find((u) => u.id === managerId)?.full_name || "Assigned Reviewer / Manager"}
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
                    Escalations log to the instance timeline and notify this manager via in-app notifications.
                  </div>
                </div>
              </div>

              {/* Hold Till (Optional) */}
              <div style={{ background: "#fefce8", padding: "12px", borderRadius: "8px", border: "1px solid #fef08a" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                  <span>⏸️</span>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#854d0e" }}>
                    Optional Initial Hold (Hold Till)
                  </label>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "10px" }}>
                  <div>
                    <input
                      type="date"
                      value={holdUntil}
                      onChange={(e) => setHoldUntil(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "6px 8px",
                        borderRadius: "4px",
                        border: "1px solid #fde047",
                        fontSize: "12.5px",
                        background: "#ffffff",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      placeholder="Reason for hold (required if hold date set)..."
                      value={holdReason}
                      onChange={(e) => setHoldReason(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "6px 10px",
                        borderRadius: "4px",
                        border: "1px solid #fde047",
                        fontSize: "12.5px",
                        background: "#ffffff",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>
                <div style={{ fontSize: "11px", color: "#713f12", marginTop: "6px" }}>
                  Note: In accordance with standard Task Module rules, held tasks suppress automated reminders and SLA escalations until the hold period expires.
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px" }}>
                <button
                  type="button"
                  onClick={() => setActiveSection("schedule")}
                  style={{
                    padding: "7px 14px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    color: "#64748b",
                    fontSize: "12.5px",
                    cursor: "pointer",
                  }}
                >
                  &larr; Back to Schedule
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection("period")}
                  style={{
                    padding: "7px 16px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    background: "#f8fafc",
                    color: "#1e293b",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Next: Active Period &rarr;
                </button>
              </div>
            </div>
          )}

          {/* ================= SECTION 4: ACTIVE PERIOD & DATA SAFETY ================= */}
          {activeSection === "period" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Effective Start Date *
                  </label>
                  <input
                    type="date"
                    value={effectiveStartDate}
                    onChange={(e) => setEffectiveStartDate(e.target.value)}
                    required
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Effective End Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={effectiveEndDate}
                    onChange={(e) => setEffectiveEndDate(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Schedule State
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      background: "#ffffff",
                      boxSizing: "border-box",
                    }}
                  >
                    <option value="ACTIVE">Active (Generating instances)</option>
                    <option value="PAUSED">Paused (Temporarily halted)</option>
                  </select>
                </div>
              </div>

              {/* Data Safety Box (Edit Mode) */}
              {isEditing && (
                <div style={{ background: "#fffbeb", padding: "12px 14px", borderRadius: "8px", border: "1px solid #fde68a" }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "12.5px", color: "#92400e", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={updatePendingInstances}
                      onChange={(e) => setUpdatePendingInstances(e.target.checked)}
                      style={{ marginTop: "3px" }}
                    />
                    <div>
                      <strong>Update pending / uncompleted instances for this schedule</strong>
                      <div style={{ fontSize: "11px", color: "#78350f", marginTop: "2px" }}>
                        By default, editing only applies to future cycles. Checking this explicitly updates any currently open, unverified instances while preserving completed historical records.
                      </div>
                    </div>
                  </label>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-start", marginTop: "8px" }}>
                <button
                  type="button"
                  onClick={() => setActiveSection("reminders")}
                  style={{
                    padding: "7px 14px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    color: "#64748b",
                    fontSize: "12.5px",
                    cursor: "pointer",
                  }}
                >
                  &larr; Back to Reminders
                </button>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderTop: "1px solid #e2e8f0",
              paddingTop: "14px",
              marginTop: "4px",
            }}
          >
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              All dates respect company Monday–Saturday working calendar.
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#475569",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={submitting}
                style={{
                  padding: "8px 22px",
                  borderRadius: "6px",
                  border: "none",
                  background: "#2563eb",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: submitting ? "not-allowed" : "pointer",
                  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
                }}
              >
                {submitting ? "Saving..." : isEditing ? "Save Changes" : "Create Schedule"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
