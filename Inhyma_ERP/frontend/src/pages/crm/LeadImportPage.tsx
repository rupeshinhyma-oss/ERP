/**
 * LeadImportPage — Inhyma CRM CSV Lead Import & Duplicate Detection.
 *
 * Implements Phase 4 Guided Import Flow:
 * - AppShell with activeKey="crm-import"
 * - Breadcrumb: Home / CRM / Import Leads
 * - 5-Step Guided Wizard:
 *     Step 1: Choose CSV (file dropzone, required columns notice, template download)
 *     Step 2: Choose Destination Pipeline (active pipeline selection, landing stage verification)
 *     Step 3: Validate & Preview (stats cards, duplicate detection breakdown, filterable row table)
 *     Step 4: Confirm Import (atomic transactional commit confirmation, honest safety notices)
 *     Step 5: View Results (batch summary, created leads list, skipped duplicate log, row-level error reports)
 * - Import Batch History view tab with scoped batch listing.
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { apiGet, apiPostMultipart, apiDownloadBlob, errorMessage } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { useAuth } from "@/lib/hooks";
import { StatusBadge } from "@/components/ui";
import {
  IconRefresh,
  IconUpload,
  IconDownload,
  IconPipeline,
  IconClock,
  IconFileText,
} from "@/components/icons";

export interface CrmPipelineItem {
  id: string;
  name: string;
  description?: string | null;
  is_default: boolean;
  is_active: boolean;
  stage_count: number;
}

export interface CrmStageItem {
  id: string;
  pipeline_id: string;
  name: string;
  stage_order: number;
  stage_type: "open" | "won" | "lost";
  is_initial: boolean;
  is_active: boolean;
}

export interface CrmPipelineDetail extends CrmPipelineItem {
  stages: CrmStageItem[];
}

export interface CrmImportRowPreview {
  row_number: number;
  name: string;
  original_phone: string;
  normalized_phone?: string | null;
  campaign: string;
  status: "VALID" | "CRM_DUPLICATE" | "FILE_DUPLICATE" | "INVALID" | "CONFLICT_IN_FILE";
  validation_message: string;
  is_valid_candidate: boolean;
  matched_lead_code?: string | null;
  company?: string | null;
  company_id?: string | null;
  matched_company_name?: string | null;
  company_action?: "EXISTING" | "NEW" | "AMBIGUOUS" | "NONE" | string | null;
  company_resolution_note?: string | null;
}

export interface CrmImportPreviewResponse {
  total_rows: number;
  valid_candidate_count: number;
  duplicate_crm_count: number;
  duplicate_file_count: number;
  invalid_count: number;
  conflict_count: number;
  pipeline_id: string;
  pipeline_name: string;
  initial_stage_id: string;
  initial_stage_name: string;
  rows: CrmImportRowPreview[];
  can_import: boolean;
}

export interface CrmImportConfirmResponse {
  batch_id: string;
  batch_name: string;
  status: string;
  display_status?: string;
  total_rows: number;
  success_count: number;
  duplicate_skipped_count: number;
  failed_count: number;
  assigned_count?: number;
  unassigned_count?: number;
  pipeline_id: string;
  pipeline_name: string;
  sanitized_error_summary?: string | null;
  row_results: CrmImportRowPreview[];
}

export interface CrmImportBatchRead {
  id: string;
  batch_name: string;
  import_source: string;
  selected_pipeline_id?: string | null;
  pipeline_name?: string | null;
  initiated_by?: string | null;
  initiator_name?: string | null;
  status: string;
  display_status?: string;
  total_count: number;
  success_count: number;
  failed_count: number;
  skipped_count: number;
  assigned_count?: number | null;
  unassigned_count?: number | null;
  created_at: string;
  completed_at?: string | null;
  sanitized_error_summary?: string | null;
}

export interface ImportSalespersonItem {
  user_id: string;
  full_name: string;
  display_name?: string;
  username: string;
  email?: string;
  department?: string | null;
  is_active: boolean;
  is_eligible: boolean;
  priority?: number;
  max_lead_capacity?: number | null;
  active_lead_count: number;
  remaining_capacity?: number | null;
  ineligibility_reasons?: string[];
}

export interface SanitizedErrorItem {
  row: number;
  outcome?: string;
  reason: string;
  action?: string;
}

export function getOutcomeFromReason(reason: string, explicitOutcome?: string): string {
  if (explicitOutcome) return explicitOutcome;
  const r = reason.toLowerCase();
  if (r.includes("name cannot be blank") || r.includes("missing name") || (r.includes("name") && !r.includes("campaign"))) {
    return "Invalid Name";
  }
  if (r.includes("phone") || r.includes("digit") || r.includes("number cannot be blank")) {
    return "Invalid Phone";
  }
  if (r.includes("campaign")) {
    return "Invalid Campaign";
  }
  if (r.includes("malformed") || r.includes("missing header") || r.includes("column")) {
    return "Malformed Row";
  }
  return "Invalid Field";
}

export function getRemediationAction(reason: string, explicitAction?: string): string {
  if (explicitAction) return explicitAction;
  const r = reason.toLowerCase();
  if (r.includes("name cannot be blank")) return "Provide a contact or prospect name in the Name column.";
  if (r.includes("phone number cannot be blank")) return "Provide a 10-digit Indian mobile number or valid E.164 phone number.";
  if (r.includes("campaign cannot be blank")) return "Specify the origin marketing campaign or source tag.";
  if (r.includes("phone") || r.includes("digit")) return "Check phone number formatting. Use 10 digits or E.164 international format.";
  if (r.includes("malformed")) return "Ensure all 3 required columns (Name, Number, Campaign) are present.";
  return "Verify the row fields meet import requirements and retry.";
}

export function parseSanitizedErrors(raw: string | null | undefined): SanitizedErrorItem[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) {
      return parsed.map((item: any) => {
        const reason = item.reason || item.message || String(item);
        return {
          row: item.row ?? item.row_number ?? 0,
          outcome: item.outcome || getOutcomeFromReason(reason),
          reason: reason,
          action: item.action || getRemediationAction(reason),
        };
      });
    }
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.row_errors)) {
        return parsed.row_errors.map((item: any) => {
          const reason = item.reason || item.message || String(item);
          return {
            row: item.row ?? item.row_number ?? 0,
            outcome: item.outcome || getOutcomeFromReason(reason),
            reason: reason,
            action: item.action || getRemediationAction(reason),
          };
        });
      }
      if (Array.isArray(parsed.errors)) {
        return parsed.errors.map((errStr: string, idx: number) => ({
          row: idx + 1,
          outcome: getOutcomeFromReason(errStr),
          reason: errStr,
          action: getRemediationAction(errStr),
        }));
      }
    }
  } catch {
    return [{ row: 1, outcome: "Batch Error", reason: String(raw), action: getRemediationAction(String(raw)) }];
  }
  return [];
}


export function getBatchBinaryStatus(batch: {
  status: string;
  display_status?: string;
  failed_count: number;
  success_count?: number;
  skipped_count?: number;
}): {
  label: "Success" | "Failure";
  color: string;
  bg: string;
} {
  const isSuccess =
    batch.display_status === "Success" ||
    batch.status === "completed" ||
    batch.status === "success" ||
    (batch.status !== "failed" && ((batch.success_count ?? 0) > 0 || (batch.skipped_count ?? 0) > 0));
  if (isSuccess && batch.display_status !== "Failure") {
    return { label: "Success", color: "#059669", bg: "#ecfdf5" };
  }
  return { label: "Failure", color: "#dc2626", bg: "#fef2f2" };
}

type WizardStep = 1 | 2 | 3 | 4 | 5;

const formatError = (err: unknown, fallback: string): string => errorMessage(err) || fallback;

export interface LeadImportPageProps {
  embedded?: boolean;
  onClose?: () => void;
  onSuccess?: () => void;
}

export function LeadImportPage({ embedded = false, onClose, onSuccess }: LeadImportPageProps = {}) {
  const navigate = useNavigate();
  const showToast = useToast();
  const toast = useMemo(() => {
    if (typeof showToast === "function") {
      return {
        success: (msg: string) => showToast(msg, "success"),
        error: (msg: string) => showToast(msg, "error"),
        warning: (msg: string) => showToast(msg, "warning"),
        info: (msg: string) => showToast(msg, "info"),
      };
    }
    return (showToast || {}) as {
      success: (msg: string) => void;
      error: (msg: string) => void;
      warning: (msg: string) => void;
      info: (msg: string) => void;
    };
  }, [showToast]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { profile, isSuperAdmin, hasPermission } = useAuth();

  const isSalesManagerOrAdmin = useMemo(() => {
    if (isSuperAdmin) return true;
    if (hasPermission("crm.leads.manage") || hasPermission("*")) return true;
    const roles = profile?.roles || [];
    return roles.some((r: string) =>
      ["admin", "super_admin", "sales_manager", "department_manager", "manager"].includes(r.toLowerCase())
    );
  }, [profile, isSuperAdmin, hasPermission]);

  const isSalesperson = !isSalesManagerOrAdmin;

  // Tab View: 'import' or 'history'
  const [activeTab, setActiveTab] = useState<"import" | "history">("import");

  // Pipelines state
  const [pipelines, setPipelines] = useState<CrmPipelineItem[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [selectedPipelineDetail, setSelectedPipelineDetail] = useState<CrmPipelineDetail | null>(null);
  const [loadingPipelines, setLoadingPipelines] = useState(false);

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [customBatchName, setCustomBatchName] = useState<string>("");

  // Lead Distribution Mode state (Step 4)
  const [distributionMode, setDistributionMode] = useState<"default_rules" | "selected_reps" | "single_salesperson" | "none">("default_rules");
  const [distributionStrategy, setDistributionStrategy] = useState<"round_robin" | "least_active">("round_robin");
  const [selectedRepIds, setSelectedRepIds] = useState<string[]>([]);
  const [singleRepId, setSingleRepId] = useState<string>("");
  const [salespeople, setSalespeople] = useState<ImportSalespersonItem[]>([]);

  // Preview & Results state
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [previewData, setPreviewData] = useState<CrmImportPreviewResponse | null>(null);
  const [importResult, setImportResult] = useState<CrmImportConfirmResponse | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Preview table filter
  const [previewFilter, setPreviewFilter] = useState<string>("ALL");
  const [previewSearch, setPreviewSearch] = useState<string>("");

  // Batches history state
  const [batches, setBatches] = useState<CrmImportBatchRead[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [selectedBatchDetail, setSelectedBatchDetail] = useState<CrmImportBatchRead | null>(null);
  const [loadingBatchDetail, setLoadingBatchDetail] = useState(false);

  const handleOpenBatchDetail = async (id: string) => {
    setLoadingBatchDetail(true);
    try {
      const res = await apiGet<CrmImportBatchRead>(`/api/v1/crm/import/batches/${id}`);
      if (res.data) {
        setSelectedBatchDetail(res.data);
      }
    } catch (err) {
      toast.error(formatError(err, "Failed to load batch details."));
    } finally {
      setLoadingBatchDetail(false);
    }
  };

  // Fetch active pipelines on mount
  const fetchPipelines = async () => {
    setLoadingPipelines(true);
    try {
      const res = await apiGet<CrmPipelineItem[]>("/api/v1/crm/pipelines?is_active=true");
      if (res.data) {
        setPipelines(res.data);
        // Pre-select default pipeline if available
        const defaultPipe = res.data.find((p) => p.is_default);
        if (defaultPipe && !selectedPipelineId) {
          setSelectedPipelineId(defaultPipe.id);
        } else if (res.data.length > 0 && !selectedPipelineId) {
          setSelectedPipelineId(res.data[0].id);
        }
      }
    } catch (err) {
      toast.error(formatError(err, "Failed to load CRM pipelines."));
    } finally {
      setLoadingPipelines(false);
    }
  };

  // Fetch selected pipeline details (for landing stage verification)
  useEffect(() => {
    if (!selectedPipelineId) {
      setSelectedPipelineDetail(null);
      return;
    }
    const fetchDetail = async () => {
      try {
        const res = await apiGet<CrmPipelineDetail>(`/api/v1/crm/pipelines/${selectedPipelineId}`);
        if (res.data) {
          setSelectedPipelineDetail(res.data);
        }
      } catch {
        setSelectedPipelineDetail(null);
      }
    };
    fetchDetail();
  }, [selectedPipelineId]);

  // Fetch batch history
  const fetchBatches = async () => {
    setLoadingBatches(true);
    try {
      const res = await apiGet<CrmImportBatchRead[]>("/api/v1/crm/import/batches");
      if (res.data) {
        setBatches(res.data);
      }
    } catch (err) {
      toast.error(formatError(err, "Failed to load import batch history."));
    } finally {
      setLoadingBatches(false);
    }
  };

  const fetchSalespeople = async () => {
    try {
      const res = await apiGet<ImportSalespersonItem[]>("/api/v1/crm/distribution/salespeople");
      const list = res?.data || (Array.isArray(res) ? res : []);
      setSalespeople(list);
    } catch {
      // Non-blocking
    }
  };

  useEffect(() => {
    fetchPipelines();
    fetchSalespeople();
  }, []);

  useEffect(() => {
    if (activeTab === "history") {
      fetchBatches();
    }
  }, [activeTab]);

  // Check initial stage of selected pipeline
  const initialLandingStage = useMemo(() => {
    if (!selectedPipelineDetail || !selectedPipelineDetail.stages) return null;
    return (
      selectedPipelineDetail.stages.find(
        (s) => s.is_active && s.is_initial && s.stage_type === "open"
      ) ||
      selectedPipelineDetail.stages.find((s) => s.is_active && s.stage_type === "open") ||
      null
    );
  }, [selectedPipelineDetail]);

  // Handle file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (!file.name.toLowerCase().endsWith(".csv")) {
        toast.error("Please upload a CSV file (.csv).");
        return;
      }
      setSelectedFile(file);
      setErrorBanner(null);
      // Auto-suggest batch name
      const baseName = file.name.replace(/\.csv$/i, "").replace(/[_-]/g, " ");
      setCustomBatchName(baseName);
    }
  };

  // Drag & drop handlers
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (!file.name.toLowerCase().endsWith(".csv")) {
        toast.error("Please drop a valid CSV file (.csv).");
        return;
      }
      setSelectedFile(file);
      setErrorBanner(null);
      const baseName = file.name.replace(/\.csv$/i, "").replace(/[_-]/g, " ");
      setCustomBatchName(baseName);
    }
  };

  // Download template
  const handleDownloadTemplate = async () => {
    try {
      const { blob, filename } = await apiDownloadBlob("/api/v1/crm/import/template");
      if (!blob) {
        throw new Error("Empty template response received from server.");
      }
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename || "inhyma_crm_leads_template.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => {
        window.URL.revokeObjectURL(downloadUrl);
      }, 1000);
      toast.success("Sample CSV template downloaded.");
    } catch (err) {
      toast.error(formatError(err, "Could not download CSV template. Please verify your permissions and network connection."));
    }
  };

  // Step 2 -> 3: Run Validation & Preview
  const handleRunPreview = async () => {
    if (!selectedFile) {
      toast.error("Please select a CSV file first.");
      return;
    }
    if (!selectedPipelineId) {
      toast.error("Please select a destination CRM pipeline.");
      return;
    }
    if (!initialLandingStage) {
      toast.error(
        "Selected pipeline has no active initial open stage. Please configure stages in Pipeline Setup."
      );
      return;
    }

    setIsValidating(true);
    setErrorBanner(null);

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("pipeline_id", selectedPipelineId);

    try {
      const res = await apiPostMultipart<CrmImportPreviewResponse>(
        "/api/v1/crm/import/preview",
        formData
      );
      if (res.data) {
        setPreviewData(res.data);
        setCurrentStep(3);
        toast.success("CSV validated successfully. Review preview below.");
      }
    } catch (err) {
      const msg = formatError(err, "Failed to validate CSV file.");
      setErrorBanner(msg);
      toast.error(msg);
    } finally {
      setIsValidating(false);
    }
  };

  // Step 4: Execute Confirmed Import
  const handleConfirmImport = async () => {
    if (!selectedFile || !selectedPipelineId) {
      toast.error("Missing file or pipeline selection.");
      return;
    }
    if (!isSalesperson) {
      if (distributionMode === "selected_reps" && selectedRepIds.length === 0) {
        toast.error("Please select at least one salesperson for distribution.");
        return;
      }
      if (distributionMode === "single_salesperson" && !singleRepId) {
        toast.error("Please select a target sales representative.");
        return;
      }
    }

    setIsImporting(true);
    setErrorBanner(null);

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("pipeline_id", selectedPipelineId);
    if (customBatchName.trim()) {
      formData.append("batch_name", customBatchName.trim());
    }

    if (isSalesperson) {
      formData.append("distribution_mode", "single_salesperson");
      if (profile?.id) {
        formData.append("target_salesperson_id", profile.id);
      }
    } else {
      formData.append("distribution_mode", distributionMode);
      if (distributionMode === "selected_reps") {
        formData.append("distribution_strategy", distributionStrategy);
        formData.append("selected_salesperson_ids", selectedRepIds.join(","));
      } else if (distributionMode === "single_salesperson") {
        formData.append("target_salesperson_id", singleRepId);
      } else if (distributionMode === "none") {
        formData.append("auto_assign", "false");
      }
    }

    try {
      const res = await apiPostMultipart<CrmImportConfirmResponse>(
        "/api/v1/crm/import/confirm",
        formData
      );
      if (res.data) {
        setImportResult(res.data);
        setCurrentStep(5);
        toast.success(
          `Import successful! ${res.data.success_count} leads created, ${res.data.duplicate_skipped_count} skipped.`
        );
        if (onSuccess) {
          onSuccess();
        }
      }
    } catch (err) {
      const msg = formatError(err, "Import execution failed.");
      setErrorBanner(msg);
      toast.error(msg);
    } finally {
      setIsImporting(false);
    }
  };

  // Reset wizard completely
  const handleImportAnotherCsv = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setPreviewData(null);
    setImportResult(null);
    setErrorBanner(null);
    setCustomBatchName("");
    setSelectedPipelineId("");
    setSelectedPipelineDetail(null);
    setDistributionMode("default_rules");
    setDistributionStrategy("round_robin");
    setSelectedRepIds([]);
    setSingleRepId("");
    setPreviewFilter("ALL");
    setPreviewSearch("");
    setCurrentStep(1);
    setActiveTab("import");
  };

  const handleViewImportedLeads = () => {
    if (onSuccess) {
      onSuccess();
    }
    if (onClose) {
      onClose();
    } else {
      navigate("/crm/leads");
    }
  };

  const handleViewBatchHistory = () => {
    setActiveTab("history");
  };

  // Filter preview rows
  const filteredPreviewRows = useMemo(() => {
    if (!previewData) return [];
    return previewData.rows.filter((row) => {
      // Status filter
      if (previewFilter === "VALID" && row.status !== "VALID") return false;
      if (previewFilter === "CRM_DUPLICATE" && row.status !== "CRM_DUPLICATE") return false;
      if (
        previewFilter === "FILE_DUPLICATE" &&
        row.status !== "FILE_DUPLICATE" &&
        row.status !== "CONFLICT_IN_FILE"
      )
        return false;
      if (previewFilter === "INVALID" && row.status !== "INVALID") return false;

      // Text search
      if (previewSearch.trim()) {
        const q = previewSearch.toLowerCase();
        const matchName = row.name.toLowerCase().includes(q);
        const matchPhone = row.original_phone.includes(q);
        const matchCamp = row.campaign.toLowerCase().includes(q);
        const matchMsg = row.validation_message.toLowerCase().includes(q);
        if (!matchName && !matchPhone && !matchCamp && !matchMsg) return false;
      }

      return true;
    });
  }, [previewData, previewFilter, previewSearch]);

  const content = (
    <main
      className="page"
      style={{
        maxWidth: embedded ? "100%" : "1350px",
        margin: "0 auto",
        boxSizing: "border-box",
        padding: embedded ? "1.25rem" : undefined,
      }}
    >
      {/* Top Header & Breadcrumb */}
      <div className="page-header" style={{ marginBottom: "16px" }}>
        <div>
          {!embedded && <Breadcrumb trail={["CRM", "Import Leads"]} />}
          <h1
            style={{
              margin: embedded ? "0 0 4px 0" : "4px 0 2px 0",
              fontSize: embedded ? "1.25rem" : "20px",
              fontWeight: 700,
              color: "var(--color-text, #0f172a)",
            }}
          >
            Lead Import
          </h1>
          <div className="page-subtitle" style={{ fontSize: "13px", color: "var(--color-muted, #64748b)" }}>
            Bulk import raw campaign leads into CRM pipelines with automated duplicate protection.
          </div>
        </div>

        <div className="page-header-actions" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="btn btn-secondary"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              padding: "7px 14px",
            }}
            title="Download standard CSV format with required headers"
          >
            <IconDownload width={15} height={15} style={{ color: "#0061f2" }} />
            <span>Download CSV Template</span>
          </button>
          {embedded && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "7px 14px",
                fontSize: "13px",
                fontWeight: 600,
              }}
            >
              ✕ Close
            </button>
          )}
        </div>
      </div>

        {/* Tab Navigation */}
        <div
          className="tabs-nav"
          style={{
            display: "flex",
            gap: "8px",
            borderBottom: "2px solid #e2e8f0",
            marginBottom: "20px",
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab("import")}
            style={{
              padding: "10px 18px",
              fontWeight: 600,
              fontSize: "14px",
              background: "none",
              border: "none",
              borderBottom: activeTab === "import" ? "2px solid #0061f2" : "2px solid transparent",
              marginBottom: "-2px",
              cursor: "pointer",
              color: activeTab === "import" ? "#0061f2" : "#64748b",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              transition: "all 0.15s ease",
            }}
          >
            <span>Guided Import</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            style={{
              padding: "10px 18px",
              fontWeight: 600,
              fontSize: "14px",
              background: "none",
              border: "none",
              borderBottom: activeTab === "history" ? "2px solid #0061f2" : "2px solid transparent",
              marginBottom: "-2px",
              cursor: "pointer",
              color: activeTab === "history" ? "#0061f2" : "#64748b",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              transition: "all 0.15s ease",
            }}
          >
            <span>Batch History</span>
          </button>
        </div>

        {errorBanner && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              borderRadius: "6px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#b91c1c",
              fontSize: "13px",
              marginBottom: "16px",
            }}
          >
            <span>{errorBanner}</span>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              style={{
                background: "none",
                border: "none",
                color: "#b91c1c",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: "12px",
                textDecoration: "underline",
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* TAB 1: GUIDED IMPORT WIZARD */}
        {activeTab === "import" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Step Progress Tracker */}
            <div
              className="card"
              style={{
                padding: "12px 18px",
                marginBottom: "0px",
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  overflowX: "auto",
                }}
              >
                {[
                  { step: 1, title: "1. Choose CSV", desc: "Select or drop file" },
                  { step: 2, title: "2. Target Pipeline", desc: "Select pipeline & stage" },
                  { step: 3, title: "3. Preview & Dedupe", desc: "Review matched records" },
                  { step: 4, title: "4. Confirm Import", desc: "Commit leads safely" },
                  { step: 5, title: "5. View Results", desc: "Summary & outcomes" },
                ].map((s, idx, arr) => {
                  const isCurrent = currentStep === s.step;
                  const isPassed = currentStep > s.step;
                  return (
                    <React.Fragment key={s.step}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flexShrink: 0,
                        }}
                      >
                        <div
                          style={{
                            width: "24px",
                            height: "24px",
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "11px",
                            fontWeight: 700,
                            background: isPassed ? "#10b981" : isCurrent ? "#0061f2" : "#f1f5f9",
                            color: isPassed || isCurrent ? "#ffffff" : "#64748b",
                            border: isPassed || isCurrent ? "none" : "1px solid #cbd5e1",
                          }}
                        >
                          {isPassed ? "✓" : s.step}
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: "12px",
                              fontWeight: isCurrent ? 700 : 600,
                              color: isCurrent ? "#0061f2" : isPassed ? "#0f172a" : "#64748b",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {s.title}
                          </div>
                          <div style={{ fontSize: "10.5px", color: "#94a3b8", whiteSpace: "nowrap" }}>
                            {s.desc}
                          </div>
                        </div>
                      </div>
                      {idx < arr.length - 1 && (
                        <div
                          style={{
                            flex: 1,
                            minWidth: "16px",
                            height: "2px",
                            background: isPassed ? "#10b981" : "#e2e8f0",
                          }}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            {/* STEP 1: CHOOSE CSV FILE */}
            {currentStep === 1 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div className="card" style={{ padding: "24px", margin: 0 }}>
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      border: "2px dashed #cbd5e1",
                      borderRadius: "8px",
                      padding: "36px 20px",
                      background: "#fafafa",
                      textAlign: "center",
                      cursor: "pointer",
                      transition: "border-color 0.15s ease",
                      marginBottom: "20px",
                    }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      style={{ display: "none" }}
                      onChange={handleFileChange}
                    />
                    <div
                      style={{
                        width: "48px",
                        height: "48px",
                        borderRadius: "50%",
                        background: "#eff6ff",
                        color: "#0061f2",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 12px auto",
                      }}
                    >
                      <IconUpload width={22} height={22} style={{ display: "block" }} />
                    </div>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: "#0f172a", marginBottom: "4px" }}>
                      {selectedFile ? selectedFile.name : "Click to browse or drop CSV here"}
                    </div>
                    <div style={{ fontSize: "12px", color: "#64748b", maxWidth: "460px", margin: "0 auto 14px auto" }}>
                      {selectedFile
                        ? `Size: ${(selectedFile.size / 1024).toFixed(1)} KB — File selected and ready for next step.`
                        : "Supports standard CSV files up to 5MB (max 5,000 rows). Safe quoted headers supported."}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: "12px", padding: "6px 14px" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                    >
                      {selectedFile ? "Replace File" : "Select CSV File"}
                    </button>
                  </div>

                  {/* CSV Requirements Section */}
                  <div
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: "6px",
                      padding: "16px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#475569",
                        textTransform: "uppercase",
                        letterSpacing: "0.03em",
                        marginBottom: "12px",
                      }}
                    >
                      <IconFileText width={14} height={14} style={{ color: "#0061f2" }} />
                      <span>Required CSV Columns</span>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                        gap: "12px",
                      }}
                    >
                      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px" }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>Name</div>
                        <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
                          Prospect or company contact name. Must not be empty.
                        </div>
                      </div>
                      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px" }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>Number</div>
                        <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
                          Phone/Mobile number. Indian (10 digits) or international E.164.
                        </div>
                      </div>
                      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px" }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>Campaign</div>
                        <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
                          Origin marketing source/campaign name (e.g. Google_Q4, Facebook_Oct).
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: "11px", color: "#64748b", marginTop: "10px" }}>
                      * Headers are matched case-insensitively. Extra or unknown columns are safely ignored.
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "20px" }}>
                    <button
                      type="button"
                      disabled={!selectedFile}
                      onClick={() => setCurrentStep(2)}
                      className="btn btn-primary"
                      style={{ padding: "8px 20px" }}
                    >
                      Continue to Pipeline Selection &rarr;
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: CHOOSE DESTINATION PIPELINE */}
            {currentStep === 2 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div className="card" style={{ padding: "24px", margin: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <IconPipeline width={18} height={18} style={{ color: "#0061f2" }} />
                    <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#0f172a" }}>
                      Select Destination CRM Pipeline
                    </h3>
                  </div>
                  <p style={{ margin: "0 0 20px 0", fontSize: "12.5px", color: "#64748b" }}>
                    New non-duplicate leads will land in the initial open stage of the chosen pipeline.
                  </p>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                      gap: "16px",
                      marginBottom: "20px",
                    }}
                  >
                    <div className="field" style={{ margin: 0 }}>
                      <label style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", color: "#475569" }}>
                        Destination Pipeline <span style={{ color: "#dc2626" }}>*</span>
                      </label>
                      <select
                        value={selectedPipelineId}
                        onChange={(e) => setSelectedPipelineId(e.target.value)}
                        disabled={loadingPipelines}
                        style={{
                          height: "38px",
                          padding: "0 10px",
                          fontSize: "13.5px",
                          border: "1px solid #cbd5e1",
                          borderRadius: "6px",
                          background: "#ffffff",
                          color: "#0f172a",
                        }}
                      >
                        <option value="" disabled>
                          {loadingPipelines ? "Loading pipelines..." : "Select an active pipeline..."}
                        </option>
                        {pipelines.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} {p.is_default ? "(Default Pipeline)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="field" style={{ margin: 0 }}>
                      <label style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", color: "#475569" }}>
                        Batch Name (Optional)
                      </label>
                      <input
                        type="text"
                        value={customBatchName}
                        onChange={(e) => setCustomBatchName(e.target.value)}
                        placeholder="e.g. October Facebook Leads Batch"
                        style={{
                          height: "38px",
                          padding: "0 10px",
                          fontSize: "13.5px",
                          border: "1px solid #cbd5e1",
                          borderRadius: "6px",
                          background: "#ffffff",
                          color: "#0f172a",
                        }}
                      />
                    </div>
                  </div>

                  {/* Landing Stage Verification Alert */}
                  {selectedPipelineDetail && (
                    <div
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: "6px",
                        padding: "12px 16px",
                        background: "#f8fafc",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "8px",
                        marginBottom: "20px",
                      }}
                    >
                      <div>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "#475569" }}>Verified Landing Stage:</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                          <span style={{ fontSize: "14px", fontWeight: 600, color: "#0061f2" }}>
                            {initialLandingStage ? initialLandingStage.name : "None Found"}
                          </span>
                          {initialLandingStage && <StatusBadge status="active" />}
                        </div>
                      </div>
                      {!initialLandingStage && (
                        <div style={{ fontSize: "12px", color: "#dc2626", fontWeight: 500 }}>
                          ⚠️ This pipeline has no active open initial stage. Please configure one in Pipeline Setup first.
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px" }}>
                    <button
                      type="button"
                      onClick={() => setCurrentStep(1)}
                      className="btn btn-secondary"
                    >
                      &larr; Back to CSV
                    </button>

                    <button
                      type="button"
                      disabled={!selectedPipelineId || !initialLandingStage || isValidating}
                      onClick={handleRunPreview}
                      className="btn btn-primary"
                      style={{ padding: "8px 20px" }}
                    >
                      {isValidating ? "Validating CSV & Checking Duplicates..." : "Validate & Preview Leads \u2192"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: PREVIEW & DUPLICATE REPORT */}
            {currentStep === 3 && previewData && (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Metric Summary Cards */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: "12px",
                  }}
                >
                  <div className="card" style={{ padding: "14px", margin: 0 }}>
                    <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", color: "#64748b" }}>
                      Total Rows
                    </div>
                    <div style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a", marginTop: "4px" }}>
                      {previewData.total_rows}
                    </div>
                  </div>

                  <div className="card" style={{ padding: "14px", margin: 0, borderLeft: "3px solid #10b981" }}>
                    <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", color: "#059669" }}>
                      Valid Candidates
                    </div>
                    <div style={{ fontSize: "22px", fontWeight: 700, color: "#059669", marginTop: "4px" }}>
                      {previewData.valid_candidate_count}
                    </div>
                    <div style={{ fontSize: "10.5px", color: "#64748b" }}>Ready to create</div>
                  </div>

                  <div className="card" style={{ padding: "14px", margin: 0, borderLeft: "3px solid #0061f2" }}>
                    <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", color: "#0061f2" }}>
                      CRM Duplicates
                    </div>
                    <div style={{ fontSize: "22px", fontWeight: 700, color: "#0061f2", marginTop: "4px" }}>
                      {previewData.duplicate_crm_count}
                    </div>
                    <div style={{ fontSize: "10.5px", color: "#64748b" }}>Campaign attributed</div>
                  </div>

                  <div className="card" style={{ padding: "14px", margin: 0, borderLeft: "3px solid #f59e0b" }}>
                    <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", color: "#d97706" }}>
                      File Duplicates
                    </div>
                    <div style={{ fontSize: "22px", fontWeight: 700, color: "#d97706", marginTop: "4px" }}>
                      {previewData.duplicate_file_count}
                    </div>
                    <div style={{ fontSize: "10.5px", color: "#64748b" }}>Repeated in CSV</div>
                  </div>

                  <div className="card" style={{ padding: "14px", margin: 0, borderLeft: "3px solid #dc2626" }}>
                    <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", color: "#dc2626" }}>
                      Invalid Rows
                    </div>
                    <div style={{ fontSize: "22px", fontWeight: 700, color: "#dc2626", marginTop: "4px" }}>
                      {previewData.invalid_count}
                    </div>
                    <div style={{ fontSize: "10.5px", color: "#64748b" }}>Will be skipped</div>
                  </div>
                </div>

                {/* Filter and Search Bar */}
                <div
                  className="card"
                  style={{
                    padding: "10px 14px",
                    margin: 0,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "10px",
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                    {[
                      { key: "ALL", label: `All Rows (${previewData.total_rows})` },
                      { key: "VALID", label: `Valid Candidates (${previewData.valid_candidate_count})` },
                      { key: "CRM_DUPLICATE", label: `CRM Duplicates (${previewData.duplicate_crm_count})` },
                      { key: "FILE_DUPLICATE", label: `File Duplicates (${previewData.duplicate_file_count})` },
                      { key: "INVALID", label: `Invalid (${previewData.invalid_count})` },
                    ].map((btn) => {
                      const active = previewFilter === btn.key;
                      return (
                        <button
                          key={btn.key}
                          type="button"
                          onClick={() => setPreviewFilter(btn.key)}
                          style={{
                            padding: "5px 10px",
                            fontSize: "12px",
                            fontWeight: 600,
                            borderRadius: "4px",
                            border: active ? "1px solid #0061f2" : "1px solid #e2e8f0",
                            background: active ? "#0061f2" : "#ffffff",
                            color: active ? "#ffffff" : "#475569",
                            cursor: "pointer",
                          }}
                        >
                          {btn.label}
                        </button>
                      );
                    })}
                  </div>

                  <input
                    type="text"
                    placeholder="Search preview rows..."
                    value={previewSearch}
                    onChange={(e) => setPreviewSearch(e.target.value)}
                    style={{
                      padding: "6px 10px",
                      fontSize: "12.5px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      minWidth: "220px",
                    }}
                  />
                </div>

                {/* Preview Table */}
                <div className="card" style={{ padding: 0, margin: 0, overflow: "hidden" }}>
                  <div className="table-scroll" style={{ maxHeight: "450px", overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                      <thead style={{ background: "#f8fafc", position: "sticky", top: 0, zIndex: 2 }}>
                        <tr style={{ borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
                          <th style={{ padding: "10px 12px", fontWeight: 600, color: "#475569", width: "60px" }}>Row #</th>
                          <th style={{ padding: "10px 12px", fontWeight: 600, color: "#475569" }}>Name</th>
                          <th style={{ padding: "10px 12px", fontWeight: 600, color: "#475569" }}>Company</th>
                          <th style={{ padding: "10px 12px", fontWeight: 600, color: "#475569" }}>Phone (Normalized)</th>
                          <th style={{ padding: "10px 12px", fontWeight: 600, color: "#475569" }}>Campaign</th>
                          <th style={{ padding: "10px 12px", fontWeight: 600, color: "#475569" }}>Outcome Status</th>
                          <th style={{ padding: "10px 12px", fontWeight: 600, color: "#475569" }}>Validation Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPreviewRows.length === 0 ? (
                          <tr>
                            <td colSpan={7} style={{ padding: "30px", textAlign: "center", color: "#94a3b8" }}>
                              No rows match the selected filter.
                            </td>
                          </tr>
                        ) : (
                          filteredPreviewRows.map((r) => {
                            let badgeColor = "#475569";
                            let badgeBg = "#f1f5f9";
                            if (r.status === "VALID") {
                              badgeColor = "#059669";
                              badgeBg = "#ecfdf5";
                            } else if (r.status === "CRM_DUPLICATE") {
                              badgeColor = "#0061f2";
                              badgeBg = "#eff6ff";
                            } else if (r.status === "FILE_DUPLICATE") {
                              badgeColor = "#d97706";
                              badgeBg = "#fffbeb";
                            } else if (r.status === "CONFLICT_IN_FILE") {
                              badgeColor = "#7c3aed";
                              badgeBg = "#f5f3ff";
                            } else if (r.status === "INVALID") {
                              badgeColor = "#dc2626";
                              badgeBg = "#fef2f2";
                            }

                            const companyAction = r.company_action || (r.company_id ? "EXISTING" : r.company ? "NEW" : "NONE");

                            return (
                              <tr key={r.row_number} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                <td style={{ padding: "8px 12px", color: "#64748b", fontFamily: "monospace" }}>{r.row_number}</td>
                                <td style={{ padding: "8px 12px", fontWeight: 600, color: "#0f172a" }}>{r.name || "—"}</td>
                                <td style={{ padding: "8px 12px" }}>
                                  {companyAction === "EXISTING" ? (
                                    <div>
                                      <div style={{ fontWeight: 600, color: "#0f172a", fontSize: "12px" }}>
                                        {r.matched_company_name || r.company}
                                      </div>
                                      <span
                                        style={{
                                          display: "inline-block",
                                          padding: "1px 6px",
                                          borderRadius: "4px",
                                          fontSize: "10px",
                                          fontWeight: 600,
                                          background: "#eff6ff",
                                          color: "#1d4ed8",
                                          marginTop: "2px",
                                        }}
                                      >
                                        Existing (Reused)
                                      </span>
                                    </div>
                                  ) : companyAction === "NEW" ? (
                                    <div>
                                      <div style={{ fontWeight: 600, color: "#0f172a", fontSize: "12px" }}>
                                        {r.company || r.matched_company_name}
                                      </div>
                                      <span
                                        style={{
                                          display: "inline-block",
                                          padding: "1px 6px",
                                          borderRadius: "4px",
                                          fontSize: "10px",
                                          fontWeight: 600,
                                          background: "#ecfdf5",
                                          color: "#047857",
                                          marginTop: "2px",
                                        }}
                                      >
                                        New Company
                                      </span>
                                      {r.company_resolution_note?.includes("Reuses") && (
                                        <div style={{ fontSize: "10px", color: "#64748b", marginTop: "1px" }}>
                                          Reuses proposed
                                        </div>
                                      )}
                                    </div>
                                  ) : companyAction === "AMBIGUOUS" ? (
                                    <div>
                                      <div style={{ fontWeight: 600, color: "#b91c1c", fontSize: "12px" }}>
                                        {r.company || "Ambiguous"}
                                      </div>
                                      <span
                                        style={{
                                          display: "inline-block",
                                          padding: "1px 6px",
                                          borderRadius: "4px",
                                          fontSize: "10px",
                                          fontWeight: 700,
                                          background: "#fef2f2",
                                          color: "#dc2626",
                                          marginTop: "2px",
                                        }}
                                      >
                                        Ambiguous Match
                                      </span>
                                    </div>
                                  ) : (
                                    <span style={{ color: "#94a3b8", fontSize: "11.5px", fontStyle: "italic" }}>
                                      No company (unlinked)
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: "8px 12px" }}>
                                  <div style={{ fontFamily: "monospace", color: "#0f172a" }}>
                                    {r.normalized_phone || r.original_phone}
                                  </div>
                                  {r.normalized_phone && r.normalized_phone !== r.original_phone && (
                                    <div style={{ fontSize: "10.5px", color: "#94a3b8" }}>Orig: {r.original_phone}</div>
                                  )}
                                </td>
                                <td style={{ padding: "8px 12px", color: "#64748b", fontFamily: "monospace" }}>{r.campaign || "—"}</td>
                                <td style={{ padding: "8px 12px" }}>
                                  <span
                                    style={{
                                      display: "inline-block",
                                      padding: "2px 8px",
                                      borderRadius: "999px",
                                      fontSize: "11px",
                                      fontWeight: 700,
                                      color: badgeColor,
                                      background: badgeBg,
                                    }}
                                  >
                                    {r.status}
                                  </span>
                                </td>
                                <td style={{ padding: "8px 12px", color: "#64748b", fontSize: "11.5px" }}>
                                  {r.validation_message}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(2)}
                    className="btn btn-secondary"
                  >
                    &larr; Back to Pipeline
                  </button>

                  <button
                    type="button"
                    disabled={!previewData.can_import}
                    onClick={() => setCurrentStep(4)}
                    className="btn btn-primary"
                    style={{ padding: "8px 20px" }}
                  >
                    Proceed to Confirmation &rarr;
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: CONFIRM IMPORT */}
            {currentStep === 4 && previewData && (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div className="card" style={{ maxWidth: "650px", width: "100%", padding: "24px", margin: 0 }}>
                  <h3 style={{ margin: "0 0 6px 0", fontSize: "17px", fontWeight: 700, color: "#0f172a" }}>
                    Confirm Lead Import
                  </h3>
                  <p style={{ margin: "0 0 18px 0", fontSize: "12.5px", color: "#64748b" }}>
                    Please review the import summary before committing changes to the CRM database.
                  </p>

                  <div
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: "6px",
                      padding: "16px",
                      marginBottom: "16px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                      fontSize: "13px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#64748b" }}>Destination Pipeline:</span>
                      <span style={{ fontWeight: 600, color: "#0f172a" }}>{previewData.pipeline_name}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#64748b" }}>Landing Stage:</span>
                      <span style={{ fontWeight: 600, color: "#0061f2" }}>{previewData.initial_stage_name}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#64748b" }}>New Leads to Create:</span>
                      <span style={{ fontWeight: 700, color: "#059669" }}>{previewData.valid_candidate_count}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#64748b" }}>Existing CRM Duplicates:</span>
                      <span style={{ fontWeight: 700, color: "#0061f2" }}>
                        {previewData.duplicate_crm_count} (Preserved, campaign recorded)
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#64748b" }}>Repeated in File / Errors:</span>
                      <span style={{ fontWeight: 700, color: "#d97706" }}>
                        {previewData.duplicate_file_count + previewData.invalid_count} (Skipped)
                      </span>
                    </div>
                  </div>

                  {/* Lead Distribution Controls */}
                  <div style={{ marginBottom: "20px" }}>
                    <h4 style={{ margin: "0 0 6px 0", fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>
                      {isSalesperson ? "Lead Assignment" : "Lead Distribution & Assignment Mode"}
                    </h4>

                    {isSalesperson ? (
                      <div
                        style={{
                          padding: "14px 16px",
                          borderRadius: "6px",
                          background: "#f0fdf4",
                          border: "1px solid #bbf7d0",
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                        }}
                      >
                        <div style={{ fontSize: "24px" }}>👤</div>
                        <div>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: "#166534" }}>
                            Assigned Directly to You ({profile?.full_name || profile?.username || "You"})
                          </div>
                          <div style={{ fontSize: "12px", color: "#15803d", marginTop: "2px" }}>
                            All new valid leads created from this CSV import will be automatically assigned to your personal account. Team distribution and other assignees are not available for salesperson accounts.
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p style={{ margin: "0 0 12px 0", fontSize: "12px", color: "#64748b" }}>
                          Choose how genuinely new leads created by this batch will be assigned. Existing duplicates will never be reassigned.
                        </p>

                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                          {/* Mode 1: Automatic / Default Rules */}
                          <label
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: "10px",
                              padding: "12px",
                              borderRadius: "6px",
                              border: `1px solid ${distributionMode === "default_rules" ? "#0061f2" : "#e2e8f0"}`,
                              background: distributionMode === "default_rules" ? "#eff6ff" : "#fff",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="radio"
                              name="distributionMode"
                              value="default_rules"
                              checked={distributionMode === "default_rules"}
                              onChange={() => setDistributionMode("default_rules")}
                              style={{ marginTop: "3px" }}
                            />
                            <div>
                              <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                                Automatic Distribution (Default Assignment Rules)
                              </div>
                              <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
                                Distribute new leads automatically using system assignment configs (territory matching, round-robin cursors, and capacity caps).
                              </div>
                            </div>
                          </label>

                          {/* Mode 2: Selected Representatives */}
                          <label
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: "10px",
                              padding: "12px",
                              borderRadius: "6px",
                              border: `1px solid ${distributionMode === "selected_reps" ? "#0061f2" : "#e2e8f0"}`,
                              background: distributionMode === "selected_reps" ? "#eff6ff" : "#fff",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="radio"
                              name="distributionMode"
                              value="selected_reps"
                              checked={distributionMode === "selected_reps"}
                              onChange={() => setDistributionMode("selected_reps")}
                              style={{ marginTop: "3px" }}
                            />
                            <div style={{ width: "100%" }}>
                              <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                                Distribute Across Selected Representatives
                              </div>
                              <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
                                Distribute leads across a selected pool of eligible salespeople using a chosen strategy.
                              </div>

                              {distributionMode === "selected_reps" && (
                                <div
                                  style={{
                                    marginTop: "12px",
                                    padding: "12px",
                                    background: "#ffffff",
                                    border: "1px solid #cbd5e1",
                                    borderRadius: "6px",
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div style={{ marginBottom: "10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>
                                      Distribution Strategy:
                                    </label>
                                    <select
                                      value={distributionStrategy}
                                      onChange={(e) => setDistributionStrategy(e.target.value as any)}
                                      style={{
                                        fontSize: "12px",
                                        padding: "4px 8px",
                                        borderRadius: "4px",
                                        border: "1px solid #cbd5e1",
                                      }}
                                    >
                                      <option value="round_robin">Round-Robin (Sequential Rotation)</option>
                                      <option value="least_active">Least-Active (Lowest Active Workload)</option>
                                    </select>
                                  </div>

                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                                    <span style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>
                                      Select Salespeople ({selectedRepIds.length} selected):
                                    </span>
                                    <div style={{ display: "flex", gap: "8px" }}>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const eligibleIds = salespeople.filter(s => s.is_eligible && s.is_active !== false).map(s => s.user_id);
                                          setSelectedRepIds(eligibleIds);
                                        }}
                                        style={{
                                          fontSize: "11px",
                                          background: "none",
                                          border: "none",
                                          color: "#0061f2",
                                          cursor: "pointer",
                                          textDecoration: "underline",
                                        }}
                                      >
                                        Select All Eligible
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setSelectedRepIds([])}
                                        style={{
                                          fontSize: "11px",
                                          background: "none",
                                          border: "none",
                                          color: "#64748b",
                                          cursor: "pointer",
                                          textDecoration: "underline",
                                        }}
                                      >
                                        Deselect All
                                      </button>
                                    </div>
                                  </div>

                                  <div style={{ maxHeight: "180px", overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: "4px" }}>
                                    {salespeople.filter((sp) => sp.is_active !== false).map((sp) => {
                                      const isChecked = selectedRepIds.includes(sp.user_id);
                                      const capInfo = sp.max_lead_capacity !== null && sp.max_lead_capacity !== undefined
                                        ? `Cap: ${sp.max_lead_capacity} (${sp.remaining_capacity ?? (sp.max_lead_capacity - sp.active_lead_count)} rem)`
                                        : "Unlimited";
                                      return (
                                        <div
                                          key={sp.user_id}
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            padding: "6px 10px",
                                            borderBottom: "1px solid #f1f5f9",
                                            backgroundColor: !sp.is_eligible ? "#f8fafc" : isChecked ? "#f0fdf4" : "#fff",
                                            opacity: sp.is_eligible ? 1 : 0.6,
                                          }}
                                        >
                                          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: sp.is_eligible ? "pointer" : "not-allowed", fontSize: "12px" }}>
                                            <input
                                              type="checkbox"
                                              disabled={!sp.is_eligible}
                                              checked={isChecked}
                                              onChange={(e) => {
                                                if (e.target.checked) {
                                                  setSelectedRepIds((prev) => [...prev, sp.user_id]);
                                                } else {
                                                  setSelectedRepIds((prev) => prev.filter((id) => id !== sp.user_id));
                                                }
                                              }}
                                            />
                                            <span style={{ fontWeight: 600, color: "#0f172a" }}>
                                              {sp.display_name || sp.full_name || sp.username}
                                            </span>
                                          </label>
                                          <div style={{ fontSize: "11px", color: "#64748b", display: "flex", alignItems: "center", gap: "6px" }}>
                                            <span>Workload: {sp.active_lead_count} | {capInfo}</span>
                                            {!sp.is_eligible && (
                                              <span style={{ padding: "1px 6px", borderRadius: "999px", background: "#fee2e2", color: "#dc2626", fontSize: "10px", fontWeight: 700 }}>
                                                Ineligible
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          </label>

                          {/* Mode 3: Single Salesperson */}
                          <label
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: "10px",
                              padding: "12px",
                              borderRadius: "6px",
                              border: `1px solid ${distributionMode === "single_salesperson" ? "#0061f2" : "#e2e8f0"}`,
                              background: distributionMode === "single_salesperson" ? "#eff6ff" : "#fff",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="radio"
                              name="distributionMode"
                              value="single_salesperson"
                              checked={distributionMode === "single_salesperson"}
                              onChange={() => setDistributionMode("single_salesperson")}
                              style={{ marginTop: "3px" }}
                            />
                            <div style={{ width: "100%" }}>
                              <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                                Assign All Leads to Single Representative
                              </div>
                              <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
                                Allocate every new lead in this batch directly to one specific eligible representative.
                              </div>

                              {distributionMode === "single_salesperson" && (
                                <div
                                  style={{
                                    marginTop: "12px",
                                    padding: "12px",
                                    background: "#ffffff",
                                    border: "1px solid #cbd5e1",
                                    borderRadius: "6px",
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                                    Choose Representative:
                                  </label>
                                  <select
                                    value={singleRepId}
                                    onChange={(e) => setSingleRepId(e.target.value)}
                                    style={{
                                      width: "100%",
                                      fontSize: "12.5px",
                                      padding: "6px 8px",
                                      borderRadius: "4px",
                                      border: "1px solid #cbd5e1",
                                    }}
                                  >
                                    <option value="">-- Select Sales Representative --</option>
                                    {salespeople.filter((sp) => sp.is_active !== false).map((sp) => {
                                      const capInfo = sp.max_lead_capacity !== null && sp.max_lead_capacity !== undefined
                                        ? `Cap: ${sp.max_lead_capacity} (${sp.remaining_capacity ?? (sp.max_lead_capacity - sp.active_lead_count)} rem)`
                                        : "Unlimited";
                                      return (
                                        <option
                                          key={sp.user_id}
                                          value={sp.user_id}
                                          disabled={!sp.is_eligible}
                                        >
                                          {sp.display_name || sp.full_name || sp.username} — Workload: {sp.active_lead_count} | {capInfo}{!sp.is_eligible ? " [Ineligible]" : ""}
                                        </option>
                                      );
                                    })}
                                  </select>
                                </div>
                              )}
                            </div>
                          </label>

                          {/* Mode 4: Unassigned */}
                          <label
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: "10px",
                              padding: "12px",
                              borderRadius: "6px",
                              border: `1px solid ${distributionMode === "none" ? "#0061f2" : "#e2e8f0"}`,
                              background: distributionMode === "none" ? "#eff6ff" : "#fff",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="radio"
                              name="distributionMode"
                              value="none"
                              checked={distributionMode === "none"}
                              onChange={() => setDistributionMode("none")}
                              style={{ marginTop: "3px" }}
                            />
                            <div>
                              <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                                Import Without Assignment (Leave Unassigned)
                              </div>
                              <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
                                Create leads in destination pipeline as unassigned for manual review or later allocation.
                              </div>
                            </div>
                          </label>
                        </div>
                      </>
                    )}
                  </div>

                  <div
                    style={{
                      background: "#eff6ff",
                      border: "1px solid #bfdbfe",
                      borderRadius: "6px",
                      padding: "12px",
                      fontSize: "12px",
                      color: "#1e40af",
                      lineHeight: 1.5,
                      marginBottom: "20px",
                    }}
                  >
                    💡 <strong>Safe Ownership & Routing Notice:</strong> Leads created in this import are assigned {isSalesperson ? "directly to you" : "according to your selected distribution mode"}.
                    Existing duplicate leads remain in their current stage and owner without modification.
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <button
                      type="button"
                      disabled={isImporting}
                      onClick={() => setCurrentStep(3)}
                      className="btn btn-secondary"
                    >
                      &larr; Back to Preview
                    </button>

                    <button
                      type="button"
                      disabled={isImporting}
                      onClick={handleConfirmImport}
                      className="btn btn-primary"
                      style={{ padding: "8px 24px" }}
                    >
                      {isImporting ? "Importing Leads..." : "Confirm and Commit Import"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 5: VIEW RESULTS */}
            {currentStep === 5 && importResult && (() => {
              const isFailed =
                importResult.status === "failed" ||
                importResult.display_status === "Failure" ||
                (importResult.failed_count > 0 &&
                  importResult.success_count === 0 &&
                  importResult.duplicate_skipped_count === 0);

              const isPartial = !isFailed && importResult.failed_count > 0;

              const resultStatus = isFailed
                ? "Failed"
                : isPartial
                ? "Partial Success"
                : "Success";

              const headerIconBg = isFailed
                ? "#fef2f2"
                : isPartial
                ? "#fffbeb"
                : "#ecfdf5";
              const headerIconColor = isFailed
                ? "#dc2626"
                : isPartial
                ? "#d97706"
                : "#059669";
              const headerIcon = isFailed ? "✕" : isPartial ? "!" : "✓";
              const resultTitle = isFailed
                ? "Import Failed"
                : isPartial
                ? "Import Partially Completed"
                : "Import Successful";

              const resultSubtitle = isFailed ? (
                <span>
                  Batch <strong style={{ color: "#0f172a" }}>{importResult.batch_name}</strong> failed to import.{" "}
                  {importResult.failed_count} {importResult.failed_count === 1 ? "row" : "rows"} could not be processed.
                </span>
              ) : isPartial ? (
                <span>
                  Batch <strong style={{ color: "#0f172a" }}>{importResult.batch_name}</strong> was partially imported into{" "}
                  <strong style={{ color: "#0f172a" }}>{importResult.pipeline_name}</strong>.{" "}
                  {importResult.success_count} leads created, {importResult.duplicate_skipped_count} duplicates preserved, and{" "}
                  {importResult.failed_count} {importResult.failed_count === 1 ? "row" : "rows"} failed.
                </span>
              ) : (
                <span>
                  Batch <strong style={{ color: "#0f172a" }}>{importResult.batch_name}</strong> was successfully committed to CRM pipeline{" "}
                  <strong style={{ color: "#0f172a" }}>{importResult.pipeline_name}</strong>.{" "}
                  {importResult.success_count > 0
                    ? `${importResult.success_count} leads created${
                        importResult.duplicate_skipped_count > 0
                          ? `, ${importResult.duplicate_skipped_count} duplicates preserved`
                          : ""
                      }.`
                    : `${importResult.duplicate_skipped_count} contacts recognized and safely preserved as existing leads.`}
                </span>
              );

              const parsedErrors = parseSanitizedErrors(importResult.sanitized_error_summary);
              const failedRowsList =
                parsedErrors.length > 0
                  ? parsedErrors
                  : (importResult.row_results || [])
                      .filter((r) => r.status === "INVALID")
                      .map((r) => ({
                        row: r.row_number,
                        outcome: "Invalid Field",
                        reason: r.validation_message || "Validation failed for row",
                        action: getRemediationAction(r.validation_message),
                      }));

              return (
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <div
                    className="card"
                    style={{
                      maxWidth: "640px",
                      width: "100%",
                      padding: "20px 24px",
                      textAlign: "center",
                      margin: 0,
                      borderRadius: "8px",
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <div
                      style={{
                        width: "42px",
                        height: "42px",
                        borderRadius: "50%",
                        background: headerIconBg,
                        color: headerIconColor,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "20px",
                        fontWeight: 700,
                        margin: "0 auto 10px auto",
                      }}
                    >
                      {headerIcon}
                    </div>

                    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#0f172a" }}>
                        {resultTitle}
                      </h3>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: "999px",
                          fontSize: "11px",
                          fontWeight: 700,
                          color: headerIconColor,
                          background: headerIconBg,
                        }}
                      >
                        {resultStatus}
                      </span>
                    </div>

                    <p style={{ margin: "0 0 16px 0", fontSize: "12.5px", color: "#64748b", lineHeight: 1.4 }}>
                      {resultSubtitle}
                    </p>

                    {/* Compact 4-Card Summary: Total rows, Leads created, Duplicates skipped, Failed rows */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                        gap: "10px",
                        marginBottom: "18px",
                      }}
                    >
                      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "10px 8px" }}>
                        <div style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Total Rows</div>
                        <div style={{ fontSize: "18px", fontWeight: 700, color: "#0f172a", marginTop: "2px" }}>{importResult.total_rows}</div>
                      </div>
                      <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: "6px", padding: "10px 8px" }}>
                        <div style={{ fontSize: "11px", color: "#059669", textTransform: "uppercase", fontWeight: 600 }}>Leads Created</div>
                        <div style={{ fontSize: "18px", fontWeight: 700, color: "#059669", marginTop: "2px" }}>{importResult.success_count}</div>
                      </div>
                      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "6px", padding: "10px 8px" }}>
                        <div style={{ fontSize: "11px", color: "#0061f2", textTransform: "uppercase", fontWeight: 600 }}>Duplicates Skipped</div>
                        <div style={{ fontSize: "18px", fontWeight: 700, color: "#0061f2", marginTop: "2px" }}>{importResult.duplicate_skipped_count}</div>
                      </div>
                      <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px", padding: "10px 8px" }}>
                        <div style={{ fontSize: "11px", color: "#dc2626", textTransform: "uppercase", fontWeight: 600 }}>Failed Rows</div>
                        <div style={{ fontSize: "18px", fontWeight: 700, color: "#dc2626", marginTop: "2px" }}>{importResult.failed_count}</div>
                      </div>
                    </div>

                    {/* Compact Failed Rows Breakdown Table */}
                    {importResult.failed_count > 0 && (
                      <div
                        style={{
                          marginBottom: "18px",
                          textAlign: "left",
                          border: "1px solid #fecaca",
                          borderRadius: "6px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            background: "#fef2f2",
                            padding: "8px 12px",
                            borderBottom: "1px solid #fecaca",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <span style={{ fontSize: "12px", fontWeight: 700, color: "#991b1b" }}>
                            Failed Rows Breakdown ({importResult.failed_count})
                          </span>
                          <span style={{ fontSize: "11px", color: "#b91c1c" }}>
                            Actionable failure reasons & guidance
                          </span>
                        </div>
                        <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11.5px" }}>
                            <thead style={{ background: "#f8fafc" }}>
                              <tr style={{ borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
                                <th style={{ padding: "6px 10px", width: "85px", color: "#475569" }}>CSV Row</th>
                                <th style={{ padding: "6px 10px", color: "#475569" }}>Reason for Failure</th>
                                <th style={{ padding: "6px 10px", color: "#475569" }}>How to Correct</th>
                              </tr>
                            </thead>
                            <tbody>
                              {failedRowsList.length === 0 ? (
                                <tr>
                                  <td colSpan={3} style={{ padding: "10px", textAlign: "center", color: "#64748b" }}>
                                    {importResult.failed_count} row validation errors encountered.
                                  </td>
                                </tr>
                              ) : (
                                failedRowsList.map((err, i) => (
                                  <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                    <td style={{ padding: "6px 10px", fontFamily: "monospace", fontWeight: 600, color: "#0f172a" }}>
                                      Row {err.row}
                                    </td>
                                    <td style={{ padding: "6px 10px", color: "#dc2626" }}>
                                      {err.reason}
                                    </td>
                                    <td style={{ padding: "6px 10px", color: "#0061f2", fontWeight: 500 }}>
                                      {err.action || getRemediationAction(err.reason)}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Action Buttons: 2 Primary + 1 Secondary */}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "12px",
                        width: "100%",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          justifyContent: "center",
                          alignItems: "center",
                          gap: "10px",
                          width: "100%",
                        }}
                      >
                        {/* PRIMARY ACTION 1 */}
                        <button
                          type="button"
                          onClick={handleViewImportedLeads}
                          className="btn btn-primary"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "8px 20px",
                            fontSize: "13.5px",
                            fontWeight: 600,
                            backgroundColor: "#2563eb",
                            color: "#ffffff",
                            borderRadius: "6px",
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          <IconFileText width={15} height={15} />
                          <span>View Imported Leads</span>
                        </button>

                        {/* PRIMARY ACTION 2 */}
                        <button
                          type="button"
                          onClick={handleImportAnotherCsv}
                          className="btn btn-secondary"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "8px 18px",
                            fontSize: "13.5px",
                            fontWeight: 600,
                            backgroundColor: "#ffffff",
                            color: "#334155",
                            border: "1px solid #cbd5e1",
                            borderRadius: "6px",
                            cursor: "pointer",
                          }}
                        >
                          <IconUpload width={15} height={15} />
                          <span>Import Another CSV</span>
                        </button>
                      </div>

                      {/* SECONDARY ACTION */}
                      <button
                        type="button"
                        onClick={handleViewBatchHistory}
                        style={{
                          background: "none",
                          border: "none",
                          padding: "4px 8px",
                          fontSize: "12.5px",
                          fontWeight: 500,
                          color: "#0061f2",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          textDecoration: "underline",
                        }}
                      >
                        <IconClock width={13} height={13} />
                        <span>View Batch History</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* TAB 2: BATCH HISTORY */}
        {activeTab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "4px",
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>Import Batches</h3>
                <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#64748b" }}>
                  Audit log of lead imports committed to Inhyma ERP.
                </p>
              </div>

              <button
                type="button"
                onClick={fetchBatches}
                disabled={loadingBatches}
                className="btn btn-secondary"
                style={{ fontSize: "12px", padding: "6px 12px" }}
              >
                <IconRefresh width={14} height={14} />
                <span>{loadingBatches ? "Refreshing..." : "Refresh"}</span>
              </button>
            </div>

            <div className="card" style={{ padding: 0, margin: 0, overflow: "hidden" }}>
              <div className="table-scroll">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr style={{ borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
                      <th style={{ padding: "10px 14px", fontWeight: 600, color: "#475569" }}>Batch Name</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, color: "#475569" }}>Pipeline</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, color: "#475569" }}>Initiator</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, color: "#475569" }}>Date & Time</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, color: "#475569" }}>Status</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, color: "#475569", textAlign: "right" }}>Total</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, color: "#475569", textAlign: "right" }}>Created</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, color: "#16a34a", textAlign: "right" }}>Assigned</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, color: "#ea580c", textAlign: "right" }}>Unassigned</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, color: "#475569", textAlign: "right" }}>Duplicates</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, color: "#475569", textAlign: "right" }}>Failed</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, color: "#475569", textAlign: "center" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.length === 0 ? (
                      <tr>
                        <td colSpan={12} style={{ padding: "30px", textAlign: "center", color: "#94a3b8" }}>
                          {loadingBatches ? "Loading batch history..." : "No lead import batches recorded yet."}
                        </td>
                      </tr>
                    ) : (
                      batches.map((b) => {
                        const binStatus = getBatchBinaryStatus(b);
                        return (
                          <tr key={b.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "10px 14px", fontWeight: 600, color: "#0f172a" }}>{b.batch_name}</td>
                            <td style={{ padding: "10px 14px", color: "#64748b" }}>{b.pipeline_name || "—"}</td>
                            <td style={{ padding: "10px 14px", color: "#64748b" }}>{b.initiator_name || "System"}</td>
                            <td style={{ padding: "10px 14px", color: "#64748b", fontFamily: "monospace" }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                <IconClock width={13} height={13} style={{ color: "#94a3b8" }} />
                                {new Date(b.created_at).toLocaleString()}
                              </span>
                            </td>
                            <td style={{ padding: "10px 14px" }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "3px 10px",
                                  borderRadius: "999px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  color: binStatus.color,
                                  background: binStatus.bg,
                                  border: `1px solid ${binStatus.label === "Success" ? "#a7f3d0" : "#fecaca"}`,
                                }}
                              >
                                {binStatus.label}
                              </span>
                            </td>
                            <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: "#0f172a" }}>
                              {b.total_count}
                            </td>
                            <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: "#059669" }}>
                              {b.success_count}
                            </td>
                            <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: "#16a34a" }}>
                              {b.assigned_count ?? 0}
                            </td>
                            <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: "#ea580c" }}>
                              {b.unassigned_count ?? 0}
                            </td>
                            <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "monospace", color: "#0061f2" }}>
                              {b.skipped_count}
                            </td>
                            <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "monospace", color: "#dc2626" }}>
                              {b.failed_count}
                            </td>
                            <td style={{ padding: "10px 14px", textAlign: "center" }}>
                              <button
                                type="button"
                                onClick={() => handleOpenBatchDetail(b.id)}
                                disabled={loadingBatchDetail}
                                className="btn btn-secondary"
                                style={{
                                  padding: "4px 10px",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                }}
                              >
                                View Details
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* BATCH DETAIL MODAL */}
            {selectedBatchDetail && (
              <div
                role="dialog"
                aria-modal="true"
                style={{
                  position: "fixed",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: "rgba(15, 23, 42, 0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 9999,
                  padding: "20px",
                }}
                onClick={() => setSelectedBatchDetail(null)}
              >
                <div
                  style={{
                    background: "#ffffff",
                    borderRadius: "10px",
                    maxWidth: "760px",
                    width: "100%",
                    maxHeight: "85vh",
                    display: "flex",
                    flexDirection: "column",
                    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
                    overflow: "hidden",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Modal Header */}
                  <div
                    style={{
                      padding: "18px 24px",
                      borderBottom: "1px solid #e2e8f0",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                          {selectedBatchDetail.batch_name}
                        </h3>
                        {(() => {
                          const status = getBatchBinaryStatus(selectedBatchDetail);
                          return (
                            <span
                              style={{
                                padding: "3px 10px",
                                borderRadius: "999px",
                                fontSize: "11px",
                                fontWeight: 700,
                                color: status.color,
                                background: status.bg,
                                border: `1px solid ${status.label === "Success" ? "#a7f3d0" : "#fecaca"}`,
                              }}
                            >
                              {status.label}
                            </span>
                          );
                        })()}
                      </div>
                      <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#64748b" }}>
                        Pipeline: <strong>{selectedBatchDetail.pipeline_name || "—"}</strong> • Initiated by:{" "}
                        <strong>{selectedBatchDetail.initiator_name || "System"}</strong> •{" "}
                        {new Date(selectedBatchDetail.created_at).toLocaleString()}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedBatchDetail(null)}
                      style={{
                        background: "none",
                        border: "none",
                        fontSize: "20px",
                        lineHeight: 1,
                        color: "#94a3b8",
                        cursor: "pointer",
                        padding: "4px 8px",
                      }}
                      title="Close"
                    >
                      ×
                    </button>
                  </div>

                  {/* Modal Body */}
                  <div style={{ padding: "20px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "18px" }}>
                    {/* Metrics Grid */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                        gap: "10px",
                      }}
                    >
                      <div style={{ padding: "12px", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                        <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 600 }}>Total Rows</div>
                        <div style={{ fontSize: "18px", fontWeight: 700, color: "#0f172a", marginTop: "2px" }}>
                          {selectedBatchDetail.total_count}
                        </div>
                      </div>
                      <div style={{ padding: "12px", background: "#ecfdf5", borderRadius: "6px", border: "1px solid #a7f3d0" }}>
                        <div style={{ fontSize: "11px", color: "#065f46", fontWeight: 600 }}>Created Leads</div>
                        <div style={{ fontSize: "18px", fontWeight: 700, color: "#059669", marginTop: "2px" }}>
                          {selectedBatchDetail.success_count}
                        </div>
                      </div>
                      <div style={{ padding: "12px", background: "#f0fdf4", borderRadius: "6px", border: "1px solid #86efac" }}>
                        <div style={{ fontSize: "11px", color: "#16a34a", fontWeight: 600 }}>Assigned</div>
                        <div style={{ fontSize: "18px", fontWeight: 700, color: "#16a34a", marginTop: "2px" }}>
                          {selectedBatchDetail.assigned_count ?? 0}
                        </div>
                      </div>
                      <div style={{ padding: "12px", background: "#fff7ed", borderRadius: "6px", border: "1px solid #fed7aa" }}>
                        <div style={{ fontSize: "11px", color: "#ea580c", fontWeight: 600 }}>Unassigned</div>
                        <div style={{ fontSize: "18px", fontWeight: 700, color: "#ea580c", marginTop: "2px" }}>
                          {selectedBatchDetail.unassigned_count ?? 0}
                        </div>
                      </div>
                      <div style={{ padding: "12px", background: "#eff6ff", borderRadius: "6px", border: "1px solid #bfdbfe" }}>
                        <div style={{ fontSize: "11px", color: "#1e40af", fontWeight: 600 }}>Duplicates</div>
                        <div style={{ fontSize: "18px", fontWeight: 700, color: "#0061f2", marginTop: "2px" }}>
                          {selectedBatchDetail.skipped_count}
                        </div>
                      </div>
                      <div
                        style={{
                          padding: "12px",
                          background: selectedBatchDetail.failed_count > 0 ? "#fef2f2" : "#f8fafc",
                          borderRadius: "6px",
                          border: `1px solid ${selectedBatchDetail.failed_count > 0 ? "#fecaca" : "#e2e8f0"}`,
                        }}
                      >
                        <div
                          style={{
                            fontSize: "11px",
                            color: selectedBatchDetail.failed_count > 0 ? "#991b1b" : "#64748b",
                            fontWeight: 600,
                          }}
                        >
                          Failed Rows
                        </div>
                        <div
                          style={{
                            fontSize: "18px",
                            fontWeight: 700,
                            color: selectedBatchDetail.failed_count > 0 ? "#dc2626" : "#64748b",
                            marginTop: "2px",
                          }}
                        >
                          {selectedBatchDetail.failed_count}
                        </div>
                      </div>
                    </div>

                    {/* Row-Level Errors breakdown */}
                    {selectedBatchDetail.failed_count > 0 && (() => {
                      const modalErrors = parseSanitizedErrors(selectedBatchDetail.sanitized_error_summary);
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <h4 style={{ margin: 0, fontSize: "13.5px", fontWeight: 700, color: "#b91c1c" }}>
                              Failed Rows Breakdown ({selectedBatchDetail.failed_count})
                            </h4>
                            <span style={{ fontSize: "11px", color: "#64748b" }}>
                              Accurate row numbers & actionable remediation
                            </span>
                          </div>

                          {modalErrors.length > 0 ? (
                            <div style={{ border: "1px solid #fecaca", borderRadius: "6px", overflow: "hidden" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                                <thead style={{ background: "#fef2f2" }}>
                                  <tr style={{ borderBottom: "1px solid #fecaca", textAlign: "left" }}>
                                    <th style={{ padding: "8px 12px", fontWeight: 600, color: "#991b1b", width: "70px" }}>CSV Row</th>
                                    <th style={{ padding: "8px 12px", fontWeight: 600, color: "#991b1b", width: "110px" }}>Outcome</th>
                                    <th style={{ padding: "8px 12px", fontWeight: 600, color: "#991b1b" }}>Failure Reason</th>
                                    <th style={{ padding: "8px 12px", fontWeight: 600, color: "#991b1b" }}>How to Fix</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {modalErrors.map((re, idx) => (
                                    <tr key={idx} style={{ borderBottom: "1px solid #fee2e2", background: "#ffffff" }}>
                                      <td style={{ padding: "8px 12px", fontWeight: 700, color: "#991b1b" }}>
                                        Row {re.row}
                                      </td>
                                      <td style={{ padding: "8px 12px", color: "#dc2626", fontWeight: 600 }}>
                                        {re.outcome || "Failure"}
                                      </td>
                                      <td style={{ padding: "8px 12px", color: "#475569" }}>
                                        {re.reason}
                                      </td>
                                      <td style={{ padding: "8px 12px", color: "#065f46", fontSize: "11.5px" }}>
                                        {re.action || getRemediationAction(re.reason)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div
                              style={{
                                padding: "12px 14px",
                                background: "#fef2f2",
                                borderRadius: "6px",
                                border: "1px solid #fecaca",
                                fontSize: "12px",
                                color: "#991b1b",
                              }}
                            >
                              <p style={{ margin: 0, fontWeight: 600 }}>
                                Batch was marked failed due to {selectedBatchDetail.failed_count} uncommitted or invalid rows.
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {selectedBatchDetail.failed_count === 0 && (
                      <div
                        style={{
                          padding: "14px 16px",
                          background: "#ecfdf5",
                          borderRadius: "6px",
                          border: "1px solid #a7f3d0",
                          fontSize: "12.5px",
                          color: "#065f46",
                        }}
                      >
                        <strong>Success:</strong> This batch completed processing with 0 failed rows. All valid leads were committed and existing records were safely preserved.
                      </div>
                    )}
                  </div>

                  {/* Modal Footer */}
                  <div
                    style={{
                      padding: "12px 24px",
                      borderTop: "1px solid #e2e8f0",
                      background: "#f8fafc",
                      display: "flex",
                      justifyContent: "flex-end",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedBatchDetail(null)}
                      className="btn btn-secondary"
                      style={{ fontSize: "12px", padding: "6px 16px" }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
  );

  if (embedded) {
    return content;
  }

  return <AppShell activeKey="crm-import">{content}</AppShell>;
}
