/**
 * CrmLeadsPage — CRM Lead Database & Assignment Verification.
 *
 * Implements Lead Database / Ownership view and Assignment Audit History:
 * - Real-time server-side pagination, search, and filters.
 * - Ownership visibility: Assigned salesperson vs Unassigned.
 * - Persisted unassigned reason tracking.
 * - Integrated Assignment History tab and per-lead timeline drawer.
 * - RBAC & Departmental scoping enforced on backend.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { apiGet, apiPost, apiPut, apiPatch, apiDownloadBlob, errorMessage } from "@/lib/api";
import { Auth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { LeadImportPage } from "./LeadImportPage";
import {
  IconRefresh,
  IconUpload,
  IconUsers,
  IconClock,
  IconUserCheck,
} from "@/components/icons";

export interface CrmProductLookupItem {
  id: string;
  product_code: string;
  product_name: string;
  specification?: string | null;
  description?: string | null;
  category?: string | null;
  retail_price?: number | null;
  wholesale_price?: number | null;
  tax_rate?: number | null;
  uom?: string | null;
  images?: string[];
  is_sellable: boolean;
  is_active: boolean;
}

export interface CrmLeadProductItem {
  id: string;
  lead_id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  specification?: string | null;
  description?: string | null;
  uom?: string | null;
  selected_image_url?: string | null;
  notes?: string | null;
  created_at: string;
  created_by?: string | null;
}

export interface CrmQuotationItemDraft {
  product_id: string;
  product_name: string;
  product_code: string;
  description: string;
  specification: string;
  uom: string;
  available_images: string[];
  include_images: boolean;
  selected_image_url: string;
  include_specifications: boolean;
  demo_link: string;
  quantity: number | "";
  unit_price: number | "";
  suggested_price: number;
  catalog_tax_rate?: number | null;
  price_confirmed: boolean;
  unit_discount: number | "";
  discount_percent?: number | "";
  tax_rate: number | "";
}

export interface CrmQuotationItemRead {
  id: string;
  quotation_id?: string;
  position: number;
  product_id: string;
  product_name: string;
  product_code: string;
  description?: string | null;
  specification?: string | null;
  uom: string;
  include_images: boolean;
  selected_image_url?: string | null;
  include_specifications: boolean;
  demo_link?: string | null;
  quantity: number;
  unit_price: number;
  unit_discount: number;
  tax_rate: number;
  taxable_amount: number;
  tax_amount: number;
  total_amount: number;
}

export interface CrmQuotationVersionRead {
  id: string;
  quotation_id: string;
  version: number;
  snapshot_data: any;
  revision_notes?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
}

export interface CrmSalesQuotationRead {
  id: string;
  quotation_number: string;
  lead_id: string;
  company_id?: string | null;
  version: number;
  status: string;
  quotation_date: string;
  valid_until?: string | null;
  currency: string;
  customer_name_snapshot: string;
  customer_phone_snapshot?: string | null;
  customer_email_snapshot?: string | null;
  company_name_snapshot?: string | null;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total_amount: number;
  payment_terms?: string | null;
  delivery_terms?: string | null;
  notes?: string | null;
  terms_and_conditions?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at?: string | null;
  items: CrmQuotationItemRead[];
  revisions?: CrmQuotationVersionRead[];
}

export interface CrmTimelineItem {
  id: string;
  timeline_type?: string;
  item_type?: string;
  timestamp: string;
  title: string;
  description?: string | null;
  actor_id?: string | null;
  actor_name?: string | null;
  actor_email?: string | null;
  badge?: string | null;
  metadata?: Record<string, any> | null;
}

export interface CrmTimelineResponse {
  lead_id: string;
  lead_code?: string;
  lead_name?: string;
  items: CrmTimelineItem[];
  total?: number;
}

export interface CrmFollowUpItem {
  id: string;
  lead_id: string;
  lead_code?: string | null;
  lead_name?: string | null;
  lead_phone?: string | null;
  lead_company?: string | null;
  lead_priority?: string | null;
  lead_stage_name?: string | null;
  lead_pipeline_name?: string | null;
  follow_up_type: string;
  activity_type?: string;
  due_at: string;
  status: "pending" | "completed" | "cancelled";
  notes?: string | null;
  priority?: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  assignee_name?: string | null;
  assignee_email?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  creator_name?: string | null;
  completed_at?: string | null;
  completed_by?: string | null;
  completion_notes?: string | null;
  created_at: string;
  updated_at: string;
  is_overdue?: boolean;
}

export interface CrmDailyWorkSummaryData {
  salesperson_id: string;
  salesperson_name: string;
  overdue_follow_ups: number;
  due_today_follow_ups: number;
  upcoming_follow_ups: number;
  active_leads: number;
}

export interface CrmStageCountItem {
  stage_id: string;
  stage_name: string;
  stage_type?: string | null;
  count: number;
}

export interface CrmRepOversightItem {
  salesperson_id: string;
  salesperson_name: string;
  salesperson_email?: string | null;
  active_lead_count: number;
  overdue_follow_up_count: number;
  due_today_follow_up_count: number;
  month_won_count: number;
  month_lost_count: number;
  stage_distribution: CrmStageCountItem[];
}

export interface CrmTeamOversightResponseData {
  scope_type: string;
  department_id?: string | null;
  department_name?: string | null;
  reps: CrmRepOversightItem[];
  total_active_leads: number;
  total_overdue_follow_ups: number;
  total_due_today_follow_ups: number;
  total_month_won: number;
  total_month_lost: number;
}

export interface CrmFollowUpPaginationResponse {
  items: CrmFollowUpItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface CrmStageOption {
  id: string;
  pipeline_id: string;
  name: string;
  stage_order: number;
  stage_type: "open" | "won" | "lost";
  is_initial: boolean;
  is_active: boolean;
}

export interface CrmFollowUpSummary {
  id: string;
  due_at: string;
  follow_up_type: string;
  priority: string;
  notes?: string | null;
  assigned_to?: string | null;
  assignee_name?: string | null;
  is_overdue?: boolean;
}

export interface CrmStageHistoryItem {
  id: string;
  lead_id: string;
  from_stage_id?: string | null;
  from_stage_name?: string | null;
  to_stage_id: string;
  to_stage_name: string;
  transitioned_by?: string | null;
  transitioner_name?: string | null;
  transition_reason?: string | null;
  transitioned_at: string;
}

export interface CrmStageHistoryListResponse {
  items: CrmStageHistoryItem[];
  total: number;
}

export interface CrmActivityItem {
  id: string;
  lead_id: string;
  activity_type: string;
  subject?: string | null;
  description?: string | null;
  outcome?: string | null;
  performed_by?: string | null;
  performer_name?: string | null;
  performer_email?: string | null;
  activity_at: string;
  created_at: string;
  is_system_event?: boolean;
}

export interface CrmActivityPaginationResponse {
  items: CrmActivityItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface CrmLeadListItem {
  id: string;
  lead_code: string;
  name: string;
  original_phone: string;
  normalized_phone?: string | null;
  email?: string | null;
  company_name?: string | null;
  company_id?: string | null;
  company_city?: string | null;
  company_gstin?: string | null;
  campaign?: string | null;
  source_type: string;
  source_detail?: string | null;
  pipeline_id?: string | null;
  pipeline_name?: string | null;
  stage_id?: string | null;
  stage_name?: string | null;
  stage_type?: string | null;
  created_by?: string | null;
  assigned_to?: string | null;
  assigned_salesperson_name?: string | null;
  assigned_salesperson_email?: string | null;
  status: string;
  priority: string;
  assignment_status: string;
  unassigned_reason?: string | null;
  last_contacted_at?: string | null;
  next_follow_up_at?: string | null;
  next_pending_follow_up?: CrmFollowUpSummary | null;
  won_at?: string | null;
  lost_at?: string | null;
  lost_reason?: string | null;
  created_at: string;
  updated_at?: string | null;
  custom_fields?: Record<string, any> | null;
}

export interface CrmLeadPaginationResponse {
  items: CrmLeadListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface CrmAssignmentHistoryItem {
  id: string;
  lead_id: string;
  lead_code?: string | null;
  lead_name?: string | null;
  previous_owner_id?: string | null;
  previous_owner_name?: string | null;
  new_owner_id?: string | null;
  new_owner_name?: string | null;
  assignment_method: string;
  assigned_by?: string | null;
  assigned_by_name?: string | null;
  reason?: string | null;
  batch_id?: string | null;
  batch_name?: string | null;
  created_at: string;
}

export interface CrmAssignmentHistoryPaginationResponse {
  items: CrmAssignmentHistoryItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface CrmPipelineOption {
  id: string;
  name: string;
}

interface CrmSalespersonOption {
  user_id: string;
  display_name?: string;
  full_name?: string;
  username: string;
  email?: string;
  department?: string | null;
  is_active: boolean;
  is_eligible: boolean;
  active_lead_count: number;
  max_lead_capacity?: number | null;
  remaining_capacity?: number | null;
  ineligibility_reasons?: string[];
}

/**
 * Normalizes a phone number to standard international format (digits only, e.g. 919876543210 or 14155552671)
 * for use in WhatsApp click-to-chat URLs (https://wa.me/<number>).
 * 
 * Rules:
 * - If null/empty or non-usable: returns null.
 * - Handles leading "+" (e.g. "+1 (415) 555-2671" -> "14155552671", "+44 7911 123456" -> "447911123456").
 * - Handles leading "00" international prefix (e.g. "00447911123456" -> "447911123456").
 * - Preserves existing country code if present: does NOT blindly prepend India's code ("91") if an international code already exists.
 * - If 10 digits without country code (e.g. "9876543210"): prepends default ERP Indian country code "91" -> "919876543210".
 * - If 11 digits starting with "0" trunk prefix (e.g. "09876543210"): strips leading "0" -> 10 digits -> "919876543210".
 * - If already 11-15 digits with existing country code (e.g. "14155552671", "447911123456", "919876543210"): keeps as-is.
 * - Returns null if usable phone digits are fewer than 10 (or fewer than 7 with explicit country code).
 */
export function normalizeWhatsAppPhone(rawPhone: string | null | undefined): string | null {
  if (!rawPhone) return null;
  const trimmed = rawPhone.trim();
  if (!trimmed) return null;

  // Check if explicitly prefixed with "+" or "00"
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 7 ? digits : null;
  }
  if (trimmed.startsWith("00")) {
    const digits = trimmed.slice(2).replace(/\D/g, "");
    return digits.length >= 7 ? digits : null;
  }

  const allDigits = trimmed.replace(/\D/g, "");
  if (!allDigits) return null;

  // If 11 digits starting with 0 trunk prefix (e.g. 09876543210 in India)
  if (allDigits.length === 11 && allDigits.startsWith("0")) {
    const tenDigits = allDigits.slice(1);
    return `91${tenDigits}`;
  }

  // If 10 digits (standard Indian mobile without country prefix)
  if (allDigits.length === 10) {
    return `91${allDigits}`;
  }

  // If already 11 to 15 digits (contains country code, e.g. 14155552671, 919876543210, 447911123456)
  if (allDigits.length >= 11 && allDigits.length <= 15) {
    return allDigits;
  }

  return null;
}

export function CrmLeadsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const showToast = useToast();

  const [activeTab, setActiveTab] = useState<"leads" | "kanban" | "unassigned" | "team_oversight" | "history">("leads");

  // Deep link tracking to avoid repeated fetches / reopening loops
  const processedDeepLinkIdRef = useRef<string | null>(null);

  // Embedded CSV Import Modal State
  const [importModalOpen, setImportModalOpen] = useState(false);

  // Check URL query parameters for ?import=open
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get("import") === "open") {
      setImportModalOpen(true);
    }
  }, [location.search]);

  // Kanban State
  const [kanbanPipelineId, setKanbanPipelineId] = useState("");
  const [kanbanStages, setKanbanStages] = useState<CrmStageOption[]>([]);
  const [kanbanLeads, setKanbanLeads] = useState<CrmLeadListItem[]>([]);
  const [loadingKanban, setLoadingKanban] = useState(false);
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);
  const [movingLeadId, setMovingLeadId] = useState<string | null>(null);

  // Manual Lead Creation State
  const [createLeadModalOpen, setCreateLeadModalOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createCompany, setCreateCompany] = useState("");
  const [createCompanyId, setCreateCompanyId] = useState<string>("");
  const [companySuggestions, setCompanySuggestions] = useState<
    Array<{ id: string; company_name: string; city_name?: string; state_name?: string; tax_id_number?: string }>
  >([]);
  const [showCompanySuggestions, setShowCompanySuggestions] = useState(false);
  const [ambiguousCandidates, setAmbiguousCandidates] = useState<
    Array<{ id: string; company_name: string; tax_id_number?: string; contact_full_name?: string }> | null
  >(null);
  const [createPipelineId, setCreatePipelineId] = useState("");
  const [createStageId, setCreateStageId] = useState("");
  const [createPriority, setCreatePriority] = useState("medium");
  const [createCampaign, setCreateCampaign] = useState("");
  const [createAssignedTo, setCreateAssignedTo] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createPipelineStages, setCreatePipelineStages] = useState<CrmStageOption[]>([]);

  // Team Oversight State
  const [teamOversight, setTeamOversight] = useState<CrmTeamOversightResponseData | null>(null);
  const [loadingTeamOversight, setLoadingTeamOversight] = useState(false);
  const [teamOversightError, setTeamOversightError] = useState<string | null>(null);

  // Lead Filters & State
  const [leads, setLeads] = useState<CrmLeadListItem[]>([]);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [leadsPage, setLeadsPage] = useState(1);
  const leadsPageSize = 25;
  const [leadsTotalPages, setLeadsTotalPages] = useState(0);
  const [loadingLeads, setLoadingLeads] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const [selectedSalespersonId, setSelectedSalespersonId] = useState("");
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");

  // Metadata options
  const [pipelines, setPipelines] = useState<CrmPipelineOption[]>([]);
  const [salespeople, setSalespeople] = useState<CrmSalespersonOption[]>([]);

  // Lead detail drawer & lifecycle state
  const [selectedLead, setSelectedLead] = useState<CrmLeadListItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"overview" | "activities" | "followups" | "quotations" | "history">("overview");
  const [drawerAction, setDrawerAction] = useState<null | "log_activity" | "schedule_followup">(null);

  // Activities State
  const [leadActivities, setLeadActivities] = useState<CrmActivityItem[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [activityPage, setActivityPage] = useState(1);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityTotalPages, setActivityTotalPages] = useState(1);
  const [activityTypeFilter, setActivityTypeFilter] = useState<"all" | "manual" | "system">("all");

  // Stage History State
  const [leadStageHistory, setLeadStageHistory] = useState<CrmStageHistoryItem[]>([]);
  const [loadingStageHistory, setLoadingStageHistory] = useState(false);

  // Assignment History
  const [leadHistory, setLeadHistory] = useState<CrmAssignmentHistoryItem[]>([]);
  const [loadingLeadHistory, setLoadingLeadHistory] = useState(false);

  // Follow-ups & Actions
  const [pendingFollowUps, setPendingFollowUps] = useState<CrmFollowUpItem[]>([]);
  const [allFollowUps, setAllFollowUps] = useState<CrmFollowUpItem[]>([]);
  const [loadingPendingFollowUps, setLoadingPendingFollowUps] = useState(false);
  const [loadingAllFollowUps, setLoadingAllFollowUps] = useState(false);
  const [completingFollowUpId, setCompletingFollowUpId] = useState<string | null>(null);
  const [completionNotes, setCompletionNotes] = useState("");
  const [completionSubmitting, setCompletionSubmitting] = useState(false);

  // Timeline (legacy & unified)
  const [_timelineItems, setTimelineItems] = useState<CrmTimelineItem[]>([]);

  // Pipeline Stages for Stage Change
  const [pipelineStages, setPipelineStages] = useState<CrmStageOption[]>([]);
  const [loadingPipelineStages, setLoadingPipelineStages] = useState(false);

  // Log Activity Form State
  const [actType, setActType] = useState("call");
  const [actSubject, setActSubject] = useState("");
  const [actDescription, setActDescription] = useState("");
  const [actOutcome, setActOutcome] = useState("");
  const [actTime, setActTime] = useState("");
  const [actSubmitting, setActSubmitting] = useState(false);
  const [actError, setActError] = useState<string | null>(null);

  // Schedule Follow-up Form State
  const [fuType, setFuType] = useState("call");
  const [fuDueAt, setFuDueAt] = useState("");
  const [fuPriority, setFuPriority] = useState("medium");
  const [fuNotes, setFuNotes] = useState("");
  const [fuSubmitting, setFuSubmitting] = useState(false);
  const [fuError, setFuError] = useState<string | null>(null);

  // Change Stage Modal State
  const [changeStageModalOpen, setChangeStageModalOpen] = useState(false);
  const [targetStageId, setTargetStageId] = useState("");
  const [stageReason, setStageReason] = useState("");
  const [stageLostReason, setStageLostReason] = useState("");
  const [stageSubmitting, setStageSubmitting] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);


  // Tab 5: Quotations State
  const [leadQuotations, setLeadQuotations] = useState<CrmSalesQuotationRead[]>([]);
  const [loadingLeadQuotations, setLoadingLeadQuotations] = useState(false);
  const [leadQuotationsError, setLeadQuotationsError] = useState<string | null>(null);
  const [selectedQuotationDetail, setSelectedQuotationDetail] = useState<CrmSalesQuotationRead | null>(null);
  const [quotationVersions, setQuotationVersions] = useState<CrmQuotationVersionRead[]>([]);
  const [loadingQuotationVersions, setLoadingQuotationVersions] = useState(false);
  const [activeQuotationDetailTab, setActiveQuotationDetailTab] = useState<"current" | "revisions">("current");
  const [showQuotationModal, setShowQuotationModal] = useState(false);
  const [editingQuotationId, setEditingQuotationId] = useState<string | null>(null);
  const [isRevisionMode, setIsRevisionMode] = useState(false);
  const [revisionNotes, setRevisionNotes] = useState("");
  const [quoteSaving, setQuoteSaving] = useState(false);
  const [downloadingPdfKey, setDownloadingPdfKey] = useState<string | null>(null);
  const [sharingQuotationKey, setSharingQuotationKey] = useState<string | null>(null);
  const [pdfRetryQuotation, setPdfRetryQuotation] = useState<{
    id: string;
    quotationNumber: string;
    version: number;
  } | null>(null);
  const [emailClientModalQuote, setEmailClientModalQuote] = useState<CrmSalesQuotationRead | null>(null);
  const [selectedEmailClient, setSelectedEmailClient] = useState<"gmail" | "default">(() => {
    try {
      return (localStorage.getItem("crm_preferred_email_client") as "gmail" | "default") || "gmail";
    } catch {
      return "gmail";
    }
  });

  // Quotation Form Fields
  const [quoteCurrency, setQuoteCurrency] = useState("INR");
  const [quoteDate, setQuoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [quoteNotes, setQuoteNotes] = useState("");
  const [quoteTerms, setQuoteTerms] = useState("");
  const [quoteLineItems, setQuoteLineItems] = useState<CrmQuotationItemDraft[]>([]);
  const [quoteLineSearch, setQuoteLineSearch] = useState("");
  const [quoteLineSearchResults, setQuoteLineSearchResults] = useState<any[]>([]);
  const [searchingQuoteProducts, setSearchingQuoteProducts] = useState(false);
  const [productSearchError, setProductSearchError] = useState<string | null>(null);
  const [uomLookup, setUomLookup] = useState<Record<string, string>>({
    "uom-nos": "NOS",
    "uom-set": "SET",
    "uom-kgs": "KGS",
    "uom-pcs": "PCS",
    "uom-mtr": "MTR",
    "uom-ltr": "LTR",
    "uom-box": "BOX",
    "uom-roll": "ROLL",
  });

  useEffect(() => {
    apiGet<any[]>("/masters/uom?limit=250&status=active")
      .then((res) => {
        const items = Array.isArray(res?.data) ? res.data : [];
        if (items.length > 0) {
          const map: Record<string, string> = {
            "uom-nos": "NOS",
            "uom-set": "SET",
            "uom-kgs": "KGS",
            "uom-pcs": "PCS",
            "uom-mtr": "MTR",
            "uom-ltr": "LTR",
            "uom-box": "BOX",
            "uom-roll": "ROLL",
          };
          items.forEach((u: any) => {
            if (u.id) map[u.id] = u.code || u.name;
          });
          setUomLookup(map);
        }
      })
      .catch(() => {});
  }, []);

  // Global Assignment History Tab State
  const [historyItems, setHistoryItems] = useState<CrmAssignmentHistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const historyPageSize = 25;
  const [historyTotalPages, setHistoryTotalPages] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Reassign modal state
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [leadToReassign, setLeadToReassign] = useState<CrmLeadListItem | null>(null);
  const [targetSalespersonId, setTargetSalespersonId] = useState("");
  const [reassignReason, setReassignReason] = useState("");
  const [reassigning, setReassigning] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);

  const canManageLeads = Auth.hasPermission("crm.leads.manage");
  const isSuperAdmin = Auth.isSuperAdmin();
  const userProfile = Auth.getProfile();
  const isManager = Boolean(
    isSuperAdmin ||
    (userProfile?.roles && userProfile.roles.some((r: any) => {
      const roleStr = typeof r === "string" ? r : (r?.name || "");
      return roleStr.toLowerCase().includes("manager") || roleStr.toLowerCase().includes("admin");
    })) ||
    Auth.hasPermission("crm.distribution.view")
  );
  const isSalesperson = !isSuperAdmin && !isManager;

  const selectedTargetSalesperson = useMemo(() => {
    if (!Array.isArray(salespeople)) return undefined;
    return salespeople.find((sp) => sp.user_id === targetSalespersonId);
  }, [salespeople, targetSalespersonId]);

  const selectedTargetStage = useMemo(() => {
    return pipelineStages.find((st) => st.id === targetStageId);
  }, [pipelineStages, targetStageId]);

  const isTargetStageLost = selectedTargetStage?.stage_type === "lost";

  const filteredActivities = useMemo(() => {
    return leadActivities.filter((act) => {
      if (activityTypeFilter === "manual") return !act.is_system_event;
      if (activityTypeFilter === "system") return !!act.is_system_event;
      return true;
    });
  }, [leadActivities, activityTypeFilter]);

  const handleOpenReassignModal = (lead: CrmLeadListItem) => {
    setLeadToReassign(lead);
    setTargetSalespersonId("");
    setReassignReason("");
    setReassignError(null);
    setReassignModalOpen(true);
  };

  // Load pipeline options
  useEffect(() => {
    async function fetchMetadata() {
      try {
        const pipeRes = await apiGet<CrmPipelineOption[]>("/api/v1/crm/pipelines?is_active=true");
        const pipeData = pipeRes?.data || (Array.isArray(pipeRes) ? pipeRes : []);
        setPipelines(pipeData);
      } catch {
        // Non-blocking
      }
      try {
        const spRes = await apiGet<CrmSalespersonOption[]>("/api/v1/crm/distribution/salespeople");
        const spData = Array.isArray(spRes?.data) ? spRes.data : Array.isArray(spRes) ? spRes : [];
        setSalespeople(spData);
      } catch {
        // Non-blocking if unauthorized
        setSalespeople([]);
      }
    }
    fetchMetadata();
  }, []);

  // Fetch leads
  const fetchLeads = useCallback(async () => {
    setLoadingLeads(true);
    try {
      const isUnassigned = activeTab === "unassigned";
      const params = new URLSearchParams();
      params.set("page", leadsPage.toString());
      params.set("page_size", leadsPageSize.toString());
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (selectedPipelineId) params.set("pipeline_id", selectedPipelineId);

      if (selectedSalespersonId && !isUnassigned) params.set("assigned_to", selectedSalespersonId);
      if (isUnassigned) params.set("unassigned_only", "true");
      if (selectedCampaign.trim()) params.set("campaign", selectedCampaign.trim());
      if (selectedStatus) params.set("status", selectedStatus);

      const res = await apiGet<CrmLeadPaginationResponse>(`/api/v1/crm/leads?${params.toString()}`);
      const data: CrmLeadPaginationResponse = res?.data || res;
      setLeads(data.items || []);
      setLeadsTotal(data.total || 0);
      setLeadsTotalPages(data.total_pages || 0);
    } catch (err: any) {
      showToast(errorMessage(err) || "Failed to load CRM leads.", "error");
      setLeads([]);
    } finally {
      setLoadingLeads(false);
    }
  }, [leadsPage, leadsPageSize, searchQuery, selectedPipelineId, selectedSalespersonId, selectedCampaign, selectedStatus, activeTab, showToast]);

  // Fetch assignment history
  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const params = new URLSearchParams();
      params.set("page", historyPage.toString());
      params.set("page_size", historyPageSize.toString());
      if (selectedSalespersonId) params.set("salesperson_id", selectedSalespersonId);

      const res = await apiGet<CrmAssignmentHistoryPaginationResponse>(`/api/v1/crm/assignment-history?${params.toString()}`);
      const data: CrmAssignmentHistoryPaginationResponse = res?.data || res;
      setHistoryItems(data.items || []);
      setHistoryTotal(data.total || 0);
      setHistoryTotalPages(data.total_pages || 0);
    } catch (err: any) {
      showToast(errorMessage(err) || "Failed to load assignment history.", "error");
      setHistoryItems([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [historyPage, historyPageSize, selectedSalespersonId, showToast]);

  // Fetch Kanban board data
  const fetchKanbanData = useCallback(async (pipelineId: string) => {
    if (!pipelineId) return;
    setLoadingKanban(true);
    try {
      const pipeRes = await apiGet<any>(`/api/v1/crm/pipelines/${pipelineId}`);
      const pipeData = pipeRes?.data || pipeRes;
      const stages: CrmStageOption[] = (pipeData?.stages || []).filter((s: CrmStageOption) => s.is_active !== false);
      stages.sort((a, b) => a.stage_order - b.stage_order);
      setKanbanStages(stages);

      const leadsRes = await apiGet<CrmLeadPaginationResponse>(`/api/v1/crm/leads?pipeline_id=${pipelineId}&page_size=100`);
      const leadsData: CrmLeadPaginationResponse = leadsRes?.data || leadsRes;
      setKanbanLeads(leadsData.items || []);
    } catch (err: any) {
      showToast(errorMessage(err) || "Failed to load Kanban board.", "error");
      setKanbanStages([]);
      setKanbanLeads([]);
    } finally {
      setLoadingKanban(false);
    }
  }, [showToast]);

  // Load Kanban whenever activeTab === "kanban" or kanbanPipelineId changes
  useEffect(() => {
    if (activeTab === "kanban") {
      const targetId = kanbanPipelineId || (pipelines.length > 0 ? pipelines[0].id : "");
      if (targetId && targetId !== kanbanPipelineId) {
        setKanbanPipelineId(targetId);
      }
      if (targetId) {
        fetchKanbanData(targetId);
      }
    }
  }, [activeTab, kanbanPipelineId, pipelines, fetchKanbanData]);

  // Role and ownership check for lead card stage transitions
  const canUserMoveLead = useCallback((lead: CrmLeadListItem): boolean => {
    if (isSuperAdmin) return true;
    if (isManager) {
      // Sales Manager may move leads within their authorized team scope
      return true;
    }
    // Salesperson: may move only leads assigned to or created by them
    const myId = userProfile?.id;
    if (!myId) return false;
    return lead.assigned_to === myId || lead.created_by === myId;
  }, [isSuperAdmin, isManager, userProfile?.id]);

  // Kanban Drag-and-Drop Handlers
  const handleCardDragStart = (e: React.DragEvent, lead: CrmLeadListItem) => {
    if (!canUserMoveLead(lead) || movingLeadId) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("text/plain", lead.id);
    e.dataTransfer.effectAllowed = "move";
    setDraggedLeadId(lead.id);
  };

  const handleStageDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverStageId !== stageId) {
      setDragOverStageId(stageId);
    }
  };

  const handleStageDragLeave = (_e: React.DragEvent, stageId: string) => {
    if (dragOverStageId === stageId) {
      setDragOverStageId(null);
    }
  };

  const handleStageDrop = async (e: React.DragEvent, targetStage: CrmStageOption) => {
    e.preventDefault();
    setDragOverStageId(null);
    const leadId = e.dataTransfer.getData("text/plain") || draggedLeadId;
    setDraggedLeadId(null);

    if (!leadId) return;
    if (movingLeadId) return;

    const lead = kanbanLeads.find((l) => l.id === leadId);
    if (!lead) return;

    // Do nothing if dropped on the same stage
    if (lead.stage_id === targetStage.id) return;

    // Validate that destination stage belongs to the lead's pipeline
    if (lead.pipeline_id && targetStage.pipeline_id && lead.pipeline_id !== targetStage.pipeline_id) {
      showToast("Cross-pipeline stage transitions are not allowed.", "error");
      return;
    }

    // Role-based permission verification
    if (!canUserMoveLead(lead)) {
      showToast("You do not have permission to move this lead.", "error");
      return;
    }

    // Moving to a Lost stage requires mandatory minimum-length reason prompt
    if (targetStage.stage_type === "lost") {
      setSelectedLead(lead);
      setTargetStageId(targetStage.id);
      setStageReason("");
      setStageLostReason("");
      setStageError(null);
      setChangeStageModalOpen(true);
      if (lead.pipeline_id) {
        fetchPipelineStages(lead.pipeline_id);
      }
      return;
    }

    // Optimistic UI update for open or won stage
    const previousStageId = lead.stage_id;
    const previousStageName = lead.stage_name;
    const previousStageType = lead.stage_type;
    const previousStatus = lead.status;
    const previousWonAt = lead.won_at;
    const previousLostAt = lead.lost_at;
    const previousLostReason = lead.lost_reason;

    const nextStatus = targetStage.stage_type === "won" ? "won" : "in_progress";
    const nextWonAt = targetStage.stage_type === "won" ? new Date().toISOString() : null;

    setMovingLeadId(lead.id);
    setKanbanLeads((prev) =>
      prev.map((l) =>
        l.id === lead.id
          ? {
              ...l,
              stage_id: targetStage.id,
              stage_name: targetStage.name,
              stage_type: targetStage.stage_type,
              status: nextStatus,
              won_at: nextWonAt,
              lost_at: null,
              lost_reason: null,
            }
          : l
      )
    );

    try {
      const res = await apiPost<CrmLeadListItem>(`/api/v1/crm/leads/${lead.id}/stage`, {
        stage_id: targetStage.id,
        reason: `Moved to ${targetStage.name} via Kanban`,
      });
      const updatedLead = res?.data || res;
      showToast(`Lead moved to '${targetStage.name}'`, "success");

      setKanbanLeads((prev) =>
        prev.map((l) => (l.id === updatedLead.id ? updatedLead : l))
      );
      setLeads((prev) =>
        prev.map((l) => (l.id === updatedLead.id ? updatedLead : l))
      );
    } catch (err: any) {
      // Revert card to original stage on failure
      setKanbanLeads((prev) =>
        prev.map((l) =>
          l.id === lead.id
            ? {
                ...l,
                stage_id: previousStageId,
                stage_name: previousStageName,
                stage_type: previousStageType,
                status: previousStatus,
                won_at: previousWonAt,
                lost_at: previousLostAt,
                lost_reason: previousLostReason,
              }
            : l
        )
      );
      const msg = errorMessage(err) || "Failed to move stage.";
      showToast(msg, "error");
    } finally {
      setMovingLeadId(null);
    }
  };

  // When pipeline changes for create lead modal, load its stages
  useEffect(() => {
    if (!createPipelineId) {
      setCreatePipelineStages([]);
      setCreateStageId("");
      return;
    }
    async function loadStages() {
      try {
        const res = await apiGet<any>(`/api/v1/crm/pipelines/${createPipelineId}`);
        const data = res?.data || res;
        const stages: CrmStageOption[] = (data?.stages || []).filter((s: CrmStageOption) => s.is_active !== false);
        stages.sort((a, b) => a.stage_order - b.stage_order);
        setCreatePipelineStages(stages);
        if (stages.length > 0) {
          const initial = stages.find((s) => s.is_initial) || stages[0];
          setCreateStageId(initial.id);
        } else {
          setCreateStageId("");
        }
      } catch {
        setCreatePipelineStages([]);
        setCreateStageId("");
      }
    }
    loadStages();
  }, [createPipelineId]);

  // Open Create Lead Modal
  const handleOpenCreateModal = () => {
    setCreateName("");
    setCreatePhone("");
    setCreateEmail("");
    setCreateCompany("");
    setCreatePriority("medium");
    setCreateCampaign("");
    setCreateNotes("");
    setCreateError(null);
    const defaultPipe = (activeTab === "kanban" && kanbanPipelineId)
      ? kanbanPipelineId
      : pipelines.length > 0
      ? pipelines[0].id
      : "";
    setCreatePipelineId(defaultPipe);
    setCreateAssignedTo("");
    setCreateLeadModalOpen(true);
  };

  // Submit Create Lead
  const handleCompanyInputChange = async (val: string) => {
    setCreateCompany(val);
    setCreateCompanyId("");
    setAmbiguousCandidates(null);
    if (val.trim().length >= 2) {
      try {
        const res = await apiGet<any>(`/api/v1/companies/lookup?q=${encodeURIComponent(val.trim())}&limit=8`);
        const list = res?.data || res || [];
        setCompanySuggestions(Array.isArray(list) ? list : []);
        setShowCompanySuggestions(true);
      } catch {
        setCompanySuggestions([]);
      }
    } else {
      setCompanySuggestions([]);
      setShowCompanySuggestions(false);
    }
  };

  const selectCompanySuggestion = (comp: { id: string; company_name: string }) => {
    setCreateCompanyId(comp.id);
    setCreateCompany(comp.company_name);
    setCompanySuggestions([]);
    setShowCompanySuggestions(false);
    setAmbiguousCandidates(null);
    setCreateError(null);
  };

  const handleCreateLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) {
      setCreateError("Contact name is required.");
      return;
    }
    if (!createPhone.trim()) {
      setCreateError("Phone number is required.");
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      await apiPost("/api/v1/crm/leads", {
        contact_name: createName.trim(),
        phone: createPhone.trim(),
        email: createEmail.trim() || null,
        company_name: createCompany.trim() || null,
        company_id: createCompanyId || null,
        pipeline_id: createPipelineId || null,
        stage_id: createStageId || null,
        priority: createPriority,
        campaign: createCampaign.trim() || null,
        assigned_to: createAssignedTo || null,
        notes: createNotes.trim() || null,
      });
      showToast("Lead created successfully!", "success");
      setCreateLeadModalOpen(false);
      setCreateCompanyId("");
      setCompanySuggestions([]);
      setShowCompanySuggestions(false);
      setAmbiguousCandidates(null);
      fetchLeads();
      if (activeTab === "kanban" && kanbanPipelineId) {
        fetchKanbanData(kanbanPipelineId);
      }
    } catch (err: any) {
      const candidates =
        err?.response?.data?.errors?.[0]?.details?.candidates ||
        err?.details?.candidates ||
        err?.response?.data?.details?.candidates;
      if (candidates && Array.isArray(candidates) && candidates.length > 0) {
        setAmbiguousCandidates(candidates);
        setCreateError("Multiple matching companies found. Please select the intended company below:");
      } else {
        const msg = errorMessage(err) || "Failed to create lead.";
        setCreateError(msg);
        showToast(msg, "error");
      }
    } finally {
      setCreateSubmitting(false);
    }
  };

  // Fetch Team Oversight
  const fetchTeamOversight = useCallback(async () => {
    setLoadingTeamOversight(true);
    setTeamOversightError(null);
    try {
      const res = await apiGet<CrmTeamOversightResponseData>("/api/v1/crm/team-oversight");
      const data: CrmTeamOversightResponseData = res?.data || res;
      setTeamOversight(data);
    } catch (err: any) {
      const msg = errorMessage(err) || "Failed to load team oversight.";
      setTeamOversightError(msg);
      setTeamOversight(null);
    } finally {
      setLoadingTeamOversight(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "team_oversight") {
      fetchTeamOversight();
    } else if (activeTab === "history") {
      fetchHistory();
    } else {
      fetchLeads();
    }
  }, [
    activeTab,
    fetchTeamOversight,
    fetchLeads,
    fetchHistory,
  ]);

  function getLocalDateTimeString(date: Date = new Date()): string {
    const pad = (n: number) => n.toString().padStart(2, "0");
    const yyyy = date.getFullYear();
    const MM = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
  }

  function formatDateTime(dateStr?: string | null): string {
    if (!dateStr) return "—";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  }

  const fetchTimeline = useCallback(async (leadId: string) => {
    try {
      const res = await apiGet<CrmTimelineResponse>(`/api/v1/crm/leads/${leadId}/timeline`);
      const data = res?.data || res;
      setTimelineItems(data?.items || []);
    } catch {
      setTimelineItems([]);
    }
  }, []);

  const fetchPendingFollowUps = useCallback(async (leadId: string) => {
    setLoadingPendingFollowUps(true);
    try {
      const res = await apiGet<CrmFollowUpPaginationResponse>(`/api/v1/crm/follow-ups?lead_id=${leadId}&status=pending&page_size=50`);
      const data = res?.data || res;
      setPendingFollowUps(data?.items || []);
    } catch {
      setPendingFollowUps([]);
    } finally {
      setLoadingPendingFollowUps(false);
    }
  }, []);

  const fetchAllFollowUps = useCallback(async (leadId: string) => {
    setLoadingAllFollowUps(true);
    try {
      const res = await apiGet<CrmFollowUpPaginationResponse>(`/api/v1/crm/follow-ups?lead_id=${leadId}&page_size=50`);
      const data = res?.data || res;
      setAllFollowUps(data?.items || []);
    } catch {
      setAllFollowUps([]);
    } finally {
      setLoadingAllFollowUps(false);
    }
  }, []);

  const fetchLeadActivities = useCallback(async (leadId: string, page = 1) => {
    setLoadingActivities(true);
    try {
      const res = await apiGet<CrmActivityPaginationResponse>(`/api/v1/crm/leads/${leadId}/activities?page=${page}&page_size=20`);
      const data = res?.data || res;
      setLeadActivities(data?.items || []);
      setActivityPage(data?.page || 1);
      setActivityTotal(data?.total || 0);
      setActivityTotalPages(data?.total_pages || 1);
    } catch {
      setLeadActivities([]);
    } finally {
      setLoadingActivities(false);
    }
  }, []);

  const fetchLeadStageHistory = useCallback(async (leadId: string) => {
    setLoadingStageHistory(true);
    try {
      const res = await apiGet<CrmStageHistoryListResponse>(`/api/v1/crm/leads/${leadId}/stage-history`);
      const data = res?.data || res;
      setLeadStageHistory(data?.items || []);
    } catch {
      setLeadStageHistory([]);
    } finally {
      setLoadingStageHistory(false);
    }
  }, []);

  const fetchPipelineStages = useCallback(async (pipelineId: string) => {
    setLoadingPipelineStages(true);
    try {
      const res = await apiGet<any>(`/api/v1/crm/pipelines/${pipelineId}`);
      const data = res?.data || res;
      const stages: CrmStageOption[] = data?.stages || [];
      stages.sort((a, b) => a.stage_order - b.stage_order);
      setPipelineStages(stages);
    } catch {
      setPipelineStages([]);
    } finally {
      setLoadingPipelineStages(false);
    }
  }, []);

  const refreshSelectedLead = useCallback(async (leadId: string) => {
    try {
      const res = await apiGet<CrmLeadListItem>(`/api/v1/crm/leads/${leadId}`);
      const data = res?.data || res;
      if (data && data.id) {
        setSelectedLead(data);
        setLeads((prev) => prev.map((l) => (l.id === data.id ? data : l)));
        if (data.pipeline_id) {
          fetchPipelineStages(data.pipeline_id);
        }
      }
    } catch {
      // Non-blocking
    }
  }, [fetchPipelineStages]);


  const fetchLeadQuotations = useCallback(async (leadId: string) => {
    setLoadingLeadQuotations(true);
    setLeadQuotationsError(null);
    try {
      const res = await apiGet<any>(`/api/v1/crm/leads/${leadId}/quotations`);
      const raw = res?.data !== undefined ? res.data : res;
      const items = Array.isArray(raw) ? raw : (raw?.items || []);
      setLeadQuotations(items);
    } catch (err: any) {
      setLeadQuotations([]);
      setLeadQuotationsError(errorMessage(err) || "Failed to load sales quotations.");
    } finally {
      setLoadingLeadQuotations(false);
    }
  }, []);

  const fetchQuotationDetailAndVersions = async (quotationId: string) => {
    setLoadingQuotationVersions(true);
    try {
      const [qRes, vRes] = await Promise.all([
        apiGet<any>(`/api/v1/crm/quotations/${quotationId}`),
        apiGet<any>(`/api/v1/crm/quotations/${quotationId}/versions`),
      ]);
      const qData = qRes?.data !== undefined ? qRes.data : qRes;
      const vData = vRes?.data !== undefined ? vRes.data : vRes;
      setSelectedQuotationDetail(qData);
      setQuotationVersions(Array.isArray(vData) ? vData : (vData?.items || []));
      setActiveQuotationDetailTab("current");
    } catch (err: any) {
      showToast(errorMessage(err) || "Failed to load quotation detail.", "error");
    } finally {
      setLoadingQuotationVersions(false);
    }
  };


  const searchProductsForQuotation = async (query: string) => {
    setQuoteLineSearch(query);
    setProductSearchError(null);
    if (!query.trim()) {
      setQuoteLineSearchResults([]);
      return;
    }
    setSearchingQuoteProducts(true);
    try {
      // Reusing the working ERP Product Master API: /masters/products (active only)
      const res = await apiGet<any>(`/masters/products?search=${encodeURIComponent(query.trim())}&limit=50&status=active`);
      let items: any[] = [];
      if (Array.isArray(res?.data)) {
        items = res.data;
      } else if (Array.isArray((res?.data as any)?.items)) {
        items = (res.data as any).items;
      } else if (Array.isArray((res as any)?.items)) {
        items = (res as any).items;
      }
      items = items.filter((p: any) => p?.is_active !== false && String(p?.status ?? "active").toLowerCase() !== "inactive");
      setQuoteLineSearchResults(items);
      if (items.length === 0) {
        setProductSearchError(`No products found matching "${query.trim()}".`);
      }
    } catch (err: any) {
      const msg = errorMessage(err) || "Failed to fetch products from Product Master.";
      setProductSearchError(msg);
      setQuoteLineSearchResults([]);
    } finally {
      setSearchingQuoteProducts(false);
    }
  };

  const handleFocusProductSearch = async () => {
    if (quoteLineSearchResults.length === 0 && !searchingQuoteProducts) {
      setSearchingQuoteProducts(true);
      setProductSearchError(null);
      try {
        const res = await apiGet<any>("/masters/products?limit=25&status=active");
        let items: any[] = [];
        if (Array.isArray(res?.data)) {
          items = res.data;
        } else if (Array.isArray((res?.data as any)?.items)) {
          items = (res.data as any).items;
        } else if (Array.isArray((res as any)?.items)) {
          items = (res as any).items;
        }
        items = items.filter((p: any) => p?.is_active !== false && String(p?.status ?? "active").toLowerCase() !== "inactive");
        setQuoteLineSearchResults(items);
      } catch {
        // Keep calm on background prefetch
      } finally {
        setSearchingQuoteProducts(false);
      }
    }
  };

  const handleAddProductToQuotation = (prod: any) => {
    const existing = quoteLineItems.find((it) => it.product_id === prod.id);
    const prodName = prod.product_name || prod.product_name_tally || "Product";
    if (existing) {
      showToast(`"${prodName}" is already in this quotation draft.`, "warning");
      return;
    }
    const availableImgs = prod.images || (prod.image_url ? [prod.image_url] : []);
    const suggestedPrice = prod.standard_price || prod.retail_price || prod.wholesale_price || 0;
    const catTax = prod.gst_percent ?? prod.tax_rate ?? null;
    const uom = (prod.uom_id && uomLookup[prod.uom_id]) || prod.uom || "Unit";
    const specs = prod.specification || "";
    const newLine: CrmQuotationItemDraft = {
      product_id: prod.id,
      product_name: prodName,
      product_code: prod.product_code || "-",
      description: prod.description || "",
      specification: specs,
      uom: uom,
      available_images: availableImgs,
      include_images: availableImgs.length > 0,
      selected_image_url: availableImgs.length > 0 ? availableImgs[0] : "",
      include_specifications: Boolean(specs),
      demo_link: "",
      quantity: 1,
      unit_price: "",
      suggested_price: suggestedPrice,
      catalog_tax_rate: catTax,
      price_confirmed: false,
      unit_discount: 0,
      discount_percent: 0,
      tax_rate: "",
    };
    setQuoteLineItems((prev) => [...prev, newLine]);
    setQuoteLineSearch("");
    setQuoteLineSearchResults([]);
    setProductSearchError(null);
    showToast(`Added "${prodName}". Enter unit price and tax rate.`, "info");
  };

  const handleOpenNewQuotationModal = () => {
    setEditingQuotationId(null);
    setIsRevisionMode(false);
    setRevisionNotes("");
    setQuoteCurrency("INR");
    const d = new Date();
    setQuoteDate(d.toISOString().slice(0, 10));
    setQuoteNotes("");
    setQuoteTerms("");
    setQuoteLineSearch("");
    setQuoteLineSearchResults([]);
    setProductSearchError(null);
    setQuoteLineItems([]);
    setShowQuotationModal(true);
  };

  const handleOpenEditOrRevisionModal = (quote: CrmSalesQuotationRead, isRev: boolean) => {
    setEditingQuotationId(quote.id);
    setIsRevisionMode(isRev);
    setRevisionNotes(isRev ? `Revision ${quote.version + 1} - commercial renegotiation` : "");
    setQuoteCurrency(quote.currency || "INR");
    setQuoteDate(quote.quotation_date ? quote.quotation_date.slice(0, 10) : new Date().toISOString().slice(0, 10));
    setQuoteNotes(quote.notes || "");
    setQuoteTerms(quote.terms_and_conditions || "");
    setQuoteLineSearch("");
    setQuoteLineSearchResults([]);
    setProductSearchError(null);
    const mappedItems: CrmQuotationItemDraft[] = quote.items.map((it) => ({
      product_id: it.product_id,
      product_name: it.product_name,
      product_code: it.product_code,
      description: it.description || "",
      specification: it.specification || "",
      uom: it.uom || "Unit",
      available_images: it.selected_image_url ? [it.selected_image_url] : [],
      include_images: it.include_images,
      selected_image_url: it.selected_image_url || "",
      include_specifications: it.include_specifications,
      demo_link: it.demo_link || "",
      quantity: it.quantity,
      unit_price: it.unit_price,
      suggested_price: it.unit_price,
      catalog_tax_rate: it.tax_rate,
      price_confirmed: true,
      unit_discount: it.unit_discount || 0,
      discount_percent: it.unit_price && it.unit_discount ? Math.round(((it.unit_discount / it.unit_price) * 100) * 10) / 10 : 0,
      tax_rate: it.tax_rate,
    }));
    setQuoteLineItems(mappedItems);
    setShowQuotationModal(true);
  };

  const handleSaveQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    if (quoteSaving) return;

    if (quoteLineItems.length === 0) {
      showToast("Please add at least one product line item to the quotation.", "error");
      return;
    }
    for (let i = 0; i < quoteLineItems.length; i++) {
      const it = quoteLineItems[i];
      const lineNum = i + 1;
      const prodName = it.product_name || `Line ${lineNum}`;

      // Quantity validation
      const qty = typeof it.quantity === "number" ? it.quantity : parseFloat(String(it.quantity));
      if (it.quantity === "" || isNaN(qty) || qty <= 0) {
        showToast(`Line ${lineNum} (${prodName}): Please enter a valid quantity greater than 0.`, "error");
        return;
      }

      // Unit price validation: entered manually by user and > 0
      const uprice = typeof it.unit_price === "number" ? it.unit_price : parseFloat(String(it.unit_price));
      if (it.unit_price === "" || isNaN(uprice) || uprice <= 0) {
        showToast(`Line ${lineNum} (${prodName}): Unit price must be manually entered and greater than 0.`, "error");
        return;
      }

      // Tax rate validation: explicitly entered, including zero when applicable
      if (it.tax_rate === "" || it.tax_rate === null || it.tax_rate === undefined) {
        showToast(`Line ${lineNum} (${prodName}): Please explicitly select or enter a tax rate (enter 0 for tax-exempt).`, "error");
        return;
      }
      const trate = typeof it.tax_rate === "number" ? it.tax_rate : parseFloat(String(it.tax_rate));
      if (isNaN(trate) || trate < 0 || trate > 100) {
        showToast(`Line ${lineNum} (${prodName}): Tax rate must be between 0% and 100%.`, "error");
        return;
      }

      // Discount validation: backend rules (>= 0 and <= unit_price)
      const udisc = it.unit_discount === "" ? 0 : (typeof it.unit_discount === "number" ? it.unit_discount : parseFloat(String(it.unit_discount)));
      if (isNaN(udisc) || udisc < 0) {
        showToast(`Line ${lineNum} (${prodName}): Unit discount cannot be negative.`, "error");
        return;
      }
      if (udisc > uprice) {
        showToast(`Line ${lineNum} (${prodName}): Unit discount (₹${udisc}) cannot exceed unit price (₹${uprice}).`, "error");
        return;
      }
    }

    setQuoteSaving(true);
    try {
      const itemsPayload = quoteLineItems.map((it) => ({
        product_id: it.product_id,
        include_images: it.include_images,
        selected_image_url: it.include_images && it.selected_image_url ? it.selected_image_url : undefined,
        include_specifications: it.include_specifications,
        demo_link: it.demo_link ? it.demo_link.trim() : undefined,
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price),
        unit_discount: Number(it.unit_discount || 0),
        tax_rate: Number(it.tax_rate),
        description: it.description ? it.description.trim() || undefined : undefined,
        specification: it.specification ? it.specification.trim() || undefined : undefined,
        uom: it.uom || undefined,
      }));

      const finalNotes = quoteNotes ? quoteNotes.trim() || undefined : undefined;

      let savedQuote: CrmSalesQuotationRead | null = null;
      if (editingQuotationId) {
        const res = await apiPut<CrmSalesQuotationRead>(`/api/v1/crm/quotations/${editingQuotationId}`, {
          create_revision: isRevisionMode,
          revision_notes: isRevisionMode ? (revisionNotes.trim() || undefined) : undefined,
          currency: quoteCurrency,
          notes: finalNotes,
          terms_and_conditions: quoteTerms ? quoteTerms.trim() || undefined : undefined,
          items: itemsPayload,
        });
        savedQuote = res?.data || (res as any);
      } else {
        const res = await apiPost<CrmSalesQuotationRead>(`/api/v1/crm/leads/${selectedLead.id}/quotations`, {
          currency: quoteCurrency,
          notes: finalNotes,
          terms_and_conditions: quoteTerms ? quoteTerms.trim() || undefined : undefined,
          items: itemsPayload,
        });
        savedQuote = res?.data || (res as any);
      }

      setShowQuotationModal(false);
      setPdfRetryQuotation(null);
      await fetchLeadQuotations(selectedLead.id);
      fetchLeadActivities(selectedLead.id, 1);

      showToast(
        isRevisionMode
          ? "New quotation revision created successfully!"
          : `Quotation draft ${savedQuote?.quotation_number ? `(${savedQuote.quotation_number}) ` : ""}saved successfully!`,
        "success"
      );
    } catch (err: any) {
      showToast(errorMessage(err) || "Failed to save quotation.", "error");
    } finally {
      setQuoteSaving(false);
    }
  };

  const handleQuotationStatusChange = async (quotationId: string, newStatus: string) => {
    if (!selectedLead) return;
    const note = window.prompt(`Enter optional notes for marking quotation as ${newStatus}:`);
    if (note === null) return;
    try {
      await apiPatch(`/api/v1/crm/quotations/${quotationId}/status`, {
        status: newStatus,
        notes: note.trim() || undefined,
      });
      showToast(`Quotation status updated to ${newStatus}.`, "success");
      fetchLeadQuotations(selectedLead.id);
      fetchLeadActivities(selectedLead.id, 1);
      if (selectedQuotationDetail && selectedQuotationDetail.id === quotationId) {
        fetchQuotationDetailAndVersions(quotationId);
      }
    } catch (err: any) {
      showToast(errorMessage(err) || "Failed to update quotation status.", "error");
    }
  };

  const handleDownloadQuotationPdf = async (
    quotationId: string,
    quotationNumber: string,
    version?: number,
    action: "download" | "view" = "download",
    options: { suppressToast?: boolean; successMessage?: string } = {}
  ): Promise<boolean> => {
    const downloadKey = `${quotationId}-${version ?? "curr"}-${action}`;
    setDownloadingPdfKey(downloadKey);
    try {
      const versionParam = version !== undefined ? `?version=${version}` : "";
      const { blob, filename } = await apiDownloadBlob(`/api/v1/crm/quotations/${quotationId}/pdf${versionParam}`);
      if (!blob || blob.size === 0) {
        throw new Error("Generated PDF is empty or invalid. Please check quotation details.");
      }
      const url = window.URL.createObjectURL(blob);
      const downloadName = filename || `${quotationNumber}_v${version ?? 1}.pdf`;

      if (action === "view") {
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (!opened) {
          // Fallback if popup blocker intercepted the new tab: trigger direct file download
          const a = document.createElement("a");
          a.href = url;
          a.download = downloadName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          showToast(`Popup was blocked by your browser. Quotation ${quotationNumber} (v${version ?? 1}) was downloaded instead.`, "warning");
        } else {
          if (!options.suppressToast) {
            showToast(options.successMessage || `Quotation ${quotationNumber} (v${version ?? 1}) opened in new tab.`, "success");
          }
        }
        setTimeout(() => {
          try {
            window.URL.revokeObjectURL(url);
          } catch {
            // ignore
          }
        }, 60000);
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = downloadName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => {
          try {
            window.URL.revokeObjectURL(url);
          } catch {
            // ignore
          }
        }, 5000);
        if (!options.suppressToast) {
          showToast(options.successMessage || `Quotation ${quotationNumber} (v${version ?? 1}) downloaded successfully.`, "success");
        }
      }
      return true;
    } catch (err: any) {
      if (!options.suppressToast) {
        showToast(errorMessage(err) || "Failed to generate quotation PDF.", "error");
      }
      return false;
    } finally {
      setDownloadingPdfKey(null);
    }
  };

  const executeShareQuotationEmail = async (quote: CrmSalesQuotationRead, clientType: "gmail" | "default") => {
    const key = `email-${quote.id}`;
    if (sharingQuotationKey) return;
    setSharingQuotationKey(key);

    try {
      localStorage.setItem("crm_preferred_email_client", clientType);
      setSelectedEmailClient(clientType);
    } catch {
      // ignore storage error
    }

    const recipient = (quote.customer_email_snapshot || selectedLead?.email || "").trim();
    const contactName = (
      quote.customer_name_snapshot && quote.customer_name_snapshot !== "—"
        ? quote.customer_name_snapshot
        : selectedLead?.name || ""
    ).trim();

    const formattedAmount = quote.total_amount != null
      ? Number(quote.total_amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "0.00";

    const subject = `Quotation ${quote.quotation_number} (v${quote.version}) — Inhyma Solutions LLP`;

    const bodyLines = [
      contactName ? `Dear ${contactName},` : "Dear Customer,",
      "",
      `Please find attached our quotation ${quote.quotation_number} (v${quote.version}), amounting to INR ${formattedAmount}.`,
      "",
      "Regards,",
      "Inhyma Solutions LLP",
    ];
    const body = bodyLines.join("\n");

    try {
      // 1. Download official PDF from backend before opening composer
      const { blob, filename } = await apiDownloadBlob(`/api/v1/crm/quotations/${quote.id}/pdf?version=${quote.version}`);
      if (!blob || blob.size === 0) {
        throw new Error("Generated PDF is empty or invalid. Please check quotation details.");
      }
      const pdfFileName = filename || `${quote.quotation_number}_v${quote.version}.pdf`;

      // 2. Download PDF to device
      if (typeof window !== "undefined" && typeof window.URL?.createObjectURL === "function") {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = pdfFileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => {
          try {
            window.URL?.revokeObjectURL(url);
          } catch {
            // ignore
          }
        }, 5000);
      }

      // 3. Open selected composer (Gmail web in new browser tab vs Default Desktop App)
      if (clientType === "gmail") {
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(recipient)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        const opened = window.open(gmailUrl, "_blank", "noopener,noreferrer");
        if (!opened) {
          showToast(
            "Popup was blocked by your browser. Quotation PDF was downloaded, but Gmail could not be opened automatically. Please allow popups or use the Default Email App.",
            "warning"
          );
        } else {
          showToast(
            recipient
              ? `Quotation PDF downloaded. Gmail composer opened for ${recipient} — please attach the downloaded PDF before sending.`
              : "Quotation PDF downloaded. Gmail composer opened — please specify recipient and attach the downloaded PDF before sending.",
            "info"
          );
        }
      } else {
        const mailtoUrl = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.location.href = mailtoUrl;

        showToast(
          recipient
            ? `Quotation PDF downloaded. Email composer opened for ${recipient} — please attach the downloaded PDF before sending.`
            : "Quotation PDF downloaded. Email composer opened — please specify recipient and attach the downloaded PDF before sending.",
          "info"
        );
      }

      // 4. Record sharing activity without claiming sent/delivered
      await apiPost(`/api/v1/crm/quotations/${quote.id}/share-activity`, {
        channel: "email",
        outcome: "opened",
        recipient: recipient || undefined,
        version: quote.version,
        details: clientType === "gmail"
          ? "Gmail web composer opened; PDF downloaded for manual attachment"
          : "Default desktop email client opened; PDF downloaded for manual attachment",
      });

      if (selectedLead) {
        fetchLeadActivities(selectedLead.id, 1);
      }
    } catch (err: any) {
      showToast(errorMessage(err) || "Failed to generate quotation PDF.", "error");
      try {
        await apiPost(`/api/v1/crm/quotations/${quote.id}/share-activity`, {
          channel: "email",
          outcome: "failed",
          recipient: recipient || undefined,
          version: quote.version,
          details: errorMessage(err) || "Error occurred during share initiation",
        });
      } catch {
        // ignore logging failure
      }
    } finally {
      setSharingQuotationKey(null);
    }
  };

  const handleShareQuotationEmail = (quote: CrmSalesQuotationRead, clientType?: "gmail" | "default") => {
    if (clientType) {
      executeShareQuotationEmail(quote, clientType);
    } else {
      setEmailClientModalQuote(quote);
    }
  };

  const handleShareQuotationWhatsApp = async (quote: CrmSalesQuotationRead) => {
    const key = `wa-${quote.id}`;
    if (sharingQuotationKey) return;

    const rawPhone = (quote.customer_phone_snapshot || selectedLead?.normalized_phone || selectedLead?.original_phone || "").trim();
    const cleanPhone = normalizeWhatsAppPhone(rawPhone);

    if (!cleanPhone) {
      showToast("Missing or invalid customer phone number. Please update lead contact details to share via WhatsApp.", "warning");
      return;
    }

    setSharingQuotationKey(key);

    const contactName = (
      quote.customer_name_snapshot && quote.customer_name_snapshot !== "—"
        ? quote.customer_name_snapshot
        : selectedLead?.name || ""
    ).trim();
    const formattedAmount = quote.total_amount != null
      ? Number(quote.total_amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "0.00";

    const messageLines = [
      contactName ? `Dear ${contactName},` : "Dear Customer,",
      "",
      `Please find our quotation ${quote.quotation_number} (v${quote.version}) for INR ${formattedAmount}.`,
      "",
      "Regards,",
      "Inhyma Solutions LLP",
    ];
    const waMessage = messageLines.join("\n");

    try {
      // Open WhatsApp directly via click-to-chat URL (no navigator.share or native dialog, no unwanted PDF download side effect)
      const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMessage)}`;
      const opened = window.open(waUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        showToast("Popup was blocked by your browser. Please allow popups or open WhatsApp manually.", "warning");
      } else {
        showToast("WhatsApp chat opened with quotation details.", "info");
      }

      // Record sharing activity without claiming sent/delivered
      await apiPost(`/api/v1/crm/quotations/${quote.id}/share-activity`, {
        channel: "whatsapp",
        outcome: "opened",
        recipient: `+${cleanPhone}`,
        version: quote.version,
        details: "WhatsApp chat opened with quotation details",
      });

      if (selectedLead) {
        fetchLeadActivities(selectedLead.id, 1);
      }
    } catch (err: any) {
      showToast(errorMessage(err) || "Failed to open WhatsApp.", "error");
      try {
        await apiPost(`/api/v1/crm/quotations/${quote.id}/share-activity`, {
          channel: "whatsapp",
          outcome: "failed",
          recipient: `+${cleanPhone}`,
          version: quote.version,
          details: errorMessage(err) || "Error occurred during WhatsApp share",
        });
      } catch {
        // ignore logging failure
      }
    } finally {
      setSharingQuotationKey(null);
    }
  };

  // Open lead details and load lead-specific assignment timeline, unified timeline, pending follow-ups, and pipeline stages
  const handleOpenLeadDrawer = async (lead: CrmLeadListItem) => {
    setSelectedLead(lead);
    setDrawerOpen(true);
    setDrawerTab("overview");
    setDrawerAction(null);
    setCompletingFollowUpId(null);
    setCompletionNotes("");
    setActError(null);
    setFuError(null);
    setSelectedQuotationDetail(null);

    setActTime(getLocalDateTimeString());
    setFuDueAt(getLocalDateTimeString(new Date(Date.now() + 24 * 60 * 60 * 1000)));

    refreshSelectedLead(lead.id);
    fetchLeadActivities(lead.id, 1);
    fetchPendingFollowUps(lead.id);
    fetchAllFollowUps(lead.id);
    fetchLeadStageHistory(lead.id);
    fetchTimeline(lead.id);
    fetchLeadQuotations(lead.id);
    if (lead.pipeline_id) {
      fetchPipelineStages(lead.pipeline_id);
    }

    setLoadingLeadHistory(true);
    try {
      const res = await apiGet<CrmAssignmentHistoryPaginationResponse>(`/api/v1/crm/assignment-history?lead_id=${lead.id}&page_size=50`);
      const data = res?.data || res;
      setLeadHistory(data?.items || []);
    } catch {
      setLeadHistory([]);
    } finally {
      setLoadingLeadHistory(false);
    }
  };

  // Deep-linking: Support /crm/leads?leadId=<uuid> and /crm/leads?id=<uuid>
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const targetLeadId = (searchParams.get("leadId") || searchParams.get("id"))?.trim();

    if (!targetLeadId) {
      processedDeepLinkIdRef.current = null;
      return;
    }

    if (processedDeepLinkIdRef.current === targetLeadId) {
      return;
    }

    processedDeepLinkIdRef.current = targetLeadId;

    // Check if the lead is already present in loaded leads or kanbanLeads
    const existingLead =
      leads.find((l) => l.id === targetLeadId) ||
      kanbanLeads.find((l) => l.id === targetLeadId);

    if (existingLead) {
      handleOpenLeadDrawer(existingLead);
      return;
    }

    // Otherwise fetch the lead directly by ID
    async function fetchDeepLinkedLead() {
      try {
        const res = await apiGet<CrmLeadListItem>(`/api/v1/crm/leads/${targetLeadId}`);
        const data = res?.data || res;
        if (data && data.id) {
          handleOpenLeadDrawer(data);
        } else {
          showToast("Lead not found or you do not have permission to view it.", "error");
        }
      } catch (err: any) {
        showToast(errorMessage(err) || "Lead not found or you do not have permission to view it.", "error");
      }
    }

    fetchDeepLinkedLead();
  }, [location.search, leads, kanbanLeads, handleOpenLeadDrawer, showToast]);

  const handleLogActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    if (!actSubject.trim()) {
      setActError("Activity subject is required.");
      return;
    }
    setActSubmitting(true);
    setActError(null);
    try {
      await apiPost(`/api/v1/crm/leads/${selectedLead.id}/activities`, {
        activity_type: actType,
        subject: actSubject.trim(),
        description: actDescription.trim() || null,
        outcome: actOutcome.trim() || null,
        activity_at: actTime ? new Date(actTime).toISOString() : null,
      });
      showToast("Activity logged successfully!", "success");
      setActSubject("");
      setActDescription("");
      setActOutcome("");
      setActTime(getLocalDateTimeString());
      setDrawerAction(null);
      fetchLeadActivities(selectedLead.id, 1);
      fetchTimeline(selectedLead.id);
      refreshSelectedLead(selectedLead.id);
    } catch (err: any) {
      const msg = errorMessage(err) || "Failed to log activity.";
      setActError(msg);
      showToast(msg, "error");
    } finally {
      setActSubmitting(false);
    }
  };

  const handleScheduleFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    if (!fuDueAt) {
      setFuError("Due date and time are required.");
      return;
    }
    setFuSubmitting(true);
    setFuError(null);
    try {
      await apiPost(`/api/v1/crm/leads/${selectedLead.id}/follow-ups`, {
        follow_up_type: fuType,
        due_at: new Date(fuDueAt).toISOString(),
        notes: fuNotes.trim() || null,
        assigned_to: selectedLead.assigned_to || null,
      });
      showToast("Follow-up scheduled successfully!", "success");
      setFuNotes("");
      setFuDueAt(getLocalDateTimeString(new Date(Date.now() + 24 * 60 * 60 * 1000)));
      setDrawerAction(null);
      fetchLeadActivities(selectedLead.id, 1);
      fetchPendingFollowUps(selectedLead.id);
      fetchAllFollowUps(selectedLead.id);
      fetchTimeline(selectedLead.id);
      refreshSelectedLead(selectedLead.id);

    } catch (err: any) {
      const msg = errorMessage(err) || "Failed to schedule follow-up.";
      setFuError(msg);
      showToast(msg, "error");
    } finally {
      setFuSubmitting(false);
    }
  };

  const handleUpdateFollowUpStatus = async (
    followUpId: string,
    status: "completed" | "cancelled",
    notes?: string,
    outcome?: string
  ) => {
    setCompletionSubmitting(true);
    try {
      const payload: Record<string, any> = {
        status,
        completion_notes: notes?.trim() || null,
      };
      if (outcome !== undefined) {
        payload.outcome = outcome?.trim() || null;
      }
      await apiPatch(`/api/v1/crm/follow-ups/${followUpId}/status`, payload);
      showToast(
        status === "completed" ? "Follow-up marked completed!" : "Follow-up cancelled.",
        "success"
      );
      setCompletingFollowUpId(null);
      setCompletionNotes("");

      if (selectedLead) {
        fetchLeadActivities(selectedLead.id, 1);
        fetchPendingFollowUps(selectedLead.id);
        fetchAllFollowUps(selectedLead.id);
        fetchTimeline(selectedLead.id);
        refreshSelectedLead(selectedLead.id);
      }
    } catch (err: any) {
      showToast(errorMessage(err) || "Failed to update follow-up status.", "error");
    } finally {
      setCompletionSubmitting(false);
    }
  };

  const handleStageTransition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead || !targetStageId) return;
    const targetStage = pipelineStages.find((s) => s.id === targetStageId);
    if (!targetStage) {
      setStageError("Please select a valid stage.");
      return;
    }
    if (targetStage.stage_type === "lost") {
      if (stageLostReason.trim().length < 3) {
        setStageError("A meaningful lost reason (minimum 3 characters) is required.");
        return;
      }
    }
    setStageSubmitting(true);
    setStageError(null);
    try {
      const res = await apiPost<CrmLeadListItem>(`/api/v1/crm/leads/${selectedLead.id}/stage`, {
        stage_id: targetStageId,
        reason: stageReason.trim() || null,
        lost_reason: targetStage.stage_type === "lost" ? stageLostReason.trim() : null,
      });
      const updatedLead = res?.data || res;
      showToast(`Lead moved to stage '${updatedLead.stage_name || targetStage.name}'!`, "success");
      setSelectedLead(updatedLead);
      setLeads((prev) => prev.map((l) => (l.id === updatedLead.id ? updatedLead : l)));
      setKanbanLeads((prev) => prev.map((l) => (l.id === updatedLead.id ? updatedLead : l)));
      setChangeStageModalOpen(false);
      setTargetStageId("");
      setStageReason("");
      setStageLostReason("");
      fetchTimeline(updatedLead.id);
    } catch (err: any) {
      const msg = errorMessage(err) || "Failed to transition stage.";
      setStageError(msg);
      showToast(msg, "error");
    } finally {
      setStageSubmitting(false);
    }
  };

  const handleConfirmReassign = async () => {
    if (!leadToReassign || !targetSalespersonId) return;
    if (reassignReason.trim().length < 5) {
      setReassignError("Reassignment reason is mandatory and must be at least 5 characters.");
      return;
    }
    setReassigning(true);
    setReassignError(null);
    try {
      const res = await apiPost<any>(`/api/v1/crm/leads/${leadToReassign.id}/reassign`, {
        new_salesperson_id: targetSalespersonId,
        reason: reassignReason.trim(),
      });
      showToast(`Lead ${leadToReassign.lead_code} successfully reassigned!`, "success");
      setReassignModalOpen(false);
      setLeadToReassign(null);
      fetchLeads();
      fetchHistory();
      if (selectedLead && selectedLead.id === leadToReassign.id) {
        const updatedLeadData = res?.data || res;
        setSelectedLead(updatedLeadData);
        handleOpenLeadDrawer(updatedLeadData);
      }
    } catch (err: any) {
      const msg = errorMessage(err) || "Failed to reassign lead.";
      setReassignError(msg);
      showToast(msg, "error");
    } finally {
      setReassigning(false);
    }
  };

  const formatUnassignedReason = (reason?: string | null) => {
    if (!reason) return "Pending automated/manual distribution";
    switch (reason) {
      case "all_candidates_at_capacity":
        return "All salespeople have reached their maximum lead capacity cap";
      case "no_eligible_salespeople":
        return "No active, eligible salespeople configured in distribution pool";
      case "no_candidates_in_territory":
        return "No eligible salespeople assigned to lead territory/state";
      case "duplicate_lead":
        return "Identified as duplicate lead";
      default:
        return reason.replace(/_/g, " ");
    }
  };

  return (
    <AppShell activeKey="crm-leads">
      <div style={{ width: "100%", maxWidth: "1600px", margin: "0 auto", padding: "1.25rem 1.5rem", boxSizing: "border-box", minWidth: 0 }}>
        <Breadcrumb trail={["CRM", "Lead Database"]} />

        {/* Page Header */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            marginTop: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                CRM Lead Database & Ownership
              </h1>
              <span
                style={{
                  display: "inline-block",
                  padding: "0.2rem 0.5rem",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  backgroundColor: "#eff6ff",
                  color: "#1d4ed8",
                  borderRadius: "9999px",
                }}
              >
                RBAC Scoped
              </span>
            </div>
            <p style={{ margin: "0.35rem 0 0 0", fontSize: "0.875rem", color: "#64748b" }}>
              Verify lead ownership, inspect automated assignment outcomes, and audit assignment history across teams.
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                if (activeTab === "history") fetchHistory();
                else if (activeTab === "team_oversight") fetchTeamOversight();
                else fetchLeads();
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.45rem 0.85rem",
                fontSize: "0.8125rem",
                fontWeight: 600,
                borderRadius: "0.375rem",
                backgroundColor: "#fff",
                color: "#475569",
                border: "1px solid #cbd5e1",
                cursor: "pointer",
              }}
            >
              <IconRefresh style={{ width: "14px", height: "14px" }} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => navigate("/crm/distribution")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.45rem 0.85rem",
                fontSize: "0.8125rem",
                fontWeight: 600,
                borderRadius: "0.375rem",
                backgroundColor: "#fff",
                color: "#2563eb",
                border: "1px solid #93c5fd",
                cursor: "pointer",
              }}
            >
              <IconUsers style={{ width: "14px", height: "14px" }} />
              Salesperson Workload
            </button>
            <button
              type="button"
              onClick={handleOpenCreateModal}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.45rem 0.95rem",
                fontSize: "0.8125rem",
                fontWeight: 600,
                borderRadius: "0.375rem",
                backgroundColor: "#059669",
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
            >
              + Add Lead
            </button>
            <button
              type="button"
              data-testid="crm-import-leads-btn"
              onClick={() => setImportModalOpen(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.45rem 0.95rem",
                fontSize: "0.8125rem",
                fontWeight: 600,
                borderRadius: "0.375rem",
                backgroundColor: "#2563eb",
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
            >
              <IconUpload style={{ width: "14px", height: "14px" }} />
              Import Leads
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid #e2e8f0",
            marginBottom: "1.25rem",
            gap: "0.5rem",
            overflowX: "auto",
          }}
        >
          <button
            type="button"
            onClick={() => {
              setActiveTab("leads");
              setLeadsPage(1);
            }}
            style={{
              padding: "0.625rem 1rem",
              fontSize: "0.875rem",
              fontWeight: activeTab === "leads" ? 600 : 500,
              color: activeTab === "leads" ? "#2563eb" : "#64748b",
              borderBottom: activeTab === "leads" ? "2px solid #2563eb" : "2px solid transparent",
              background: "none",
              borderLeft: "none",
              borderRight: "none",
              borderTop: "none",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {isSalesperson ? "My Leads" : "All Leads"}
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("kanban");
            }}
            style={{
              padding: "0.625rem 1rem",
              fontSize: "0.875rem",
              fontWeight: activeTab === "kanban" ? 600 : 500,
              color: activeTab === "kanban" ? "#2563eb" : "#64748b",
              borderBottom: activeTab === "kanban" ? "2px solid #2563eb" : "2px solid transparent",
              background: "none",
              borderLeft: "none",
              borderRight: "none",
              borderTop: "none",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Pipeline Kanban
          </button>
          {isManager && (
            <button
              type="button"
              onClick={() => {
                setActiveTab("unassigned");
                setLeadsPage(1);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                padding: "0.625rem 1rem",
                fontSize: "0.875rem",
                fontWeight: activeTab === "unassigned" ? 600 : 500,
                color: activeTab === "unassigned" ? "#dc2626" : "#64748b",
                borderBottom: activeTab === "unassigned" ? "2px solid #dc2626" : "2px solid transparent",
                background: "none",
                borderLeft: "none",
                borderRight: "none",
                borderTop: "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <span>Unassigned Leads</span>
              <span
                style={{
                  fontSize: "0.75rem",
                  padding: "0.1rem 0.4rem",
                  borderRadius: "9999px",
                  backgroundColor: activeTab === "unassigned" ? "#fee2e2" : "#f1f5f9",
                  color: activeTab === "unassigned" ? "#dc2626" : "#64748b",
                  fontWeight: 600,
                }}
              >
                Action Required
              </span>
            </button>
          )}
          {isManager && (
            <button
              type="button"
              onClick={() => {
                setActiveTab("team_oversight");
              }}
              style={{
                padding: "0.625rem 1rem",
                fontSize: "0.875rem",
                fontWeight: activeTab === "team_oversight" ? 600 : 500,
                color: activeTab === "team_oversight" ? "#2563eb" : "#64748b",
                borderBottom: activeTab === "team_oversight" ? "2px solid #2563eb" : "2px solid transparent",
                background: "none",
                borderLeft: "none",
                borderRight: "none",
                borderTop: "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Team Oversight
            </button>
          )}
          {isManager && (
            <button
              type="button"
              onClick={() => {
                setActiveTab("history");
                setHistoryPage(1);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                padding: "0.625rem 1rem",
                fontSize: "0.875rem",
                fontWeight: activeTab === "history" ? 600 : 500,
                color: activeTab === "history" ? "#2563eb" : "#64748b",
                borderBottom: activeTab === "history" ? "2px solid #2563eb" : "2px solid transparent",
                background: "none",
                borderLeft: "none",
                borderRight: "none",
                borderTop: "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <IconClock style={{ width: "15px", height: "15px" }} />
              <span>Assignment Audit History</span>
            </button>
          )}
        </div>

        {/* Filters Toolbar */}
        {(activeTab === "leads" || activeTab === "unassigned" || activeTab === "history") && (
          <div
            style={{
              background: "#fff",
              borderRadius: "0.5rem",
              border: "1px solid #e2e8f0",
              padding: "0.875rem 1rem",
              marginBottom: "1rem",
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem",
              alignItems: "center",
            }}
          >
            {(activeTab === "leads" || activeTab === "unassigned") && (
              <>
              {/* Search */}
              <div style={{ flex: "1 1 200px" }}>
                <input
                  type="text"
                  placeholder="Search name, phone, email, lead code..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setLeadsPage(1);
                      fetchLeads();
                    }
                  }}
                  style={{
                    width: "100%",
                    padding: "0.45rem 0.75rem",
                    fontSize: "0.8125rem",
                    borderRadius: "0.375rem",
                    border: "1px solid #cbd5e1",
                    outline: "none",
                  }}
                />
              </div>

              {/* Pipeline Filter */}
              <div style={{ minWidth: "150px" }}>
                <select
                  value={selectedPipelineId}
                  onChange={(e) => {
                    setSelectedPipelineId(e.target.value);
                    setLeadsPage(1);
                  }}
                  style={{
                    width: "100%",
                    padding: "0.45rem 0.65rem",
                    fontSize: "0.8125rem",
                    borderRadius: "0.375rem",
                    border: "1px solid #cbd5e1",
                    backgroundColor: "#fff",
                  }}
                >
                  <option value="">All Pipelines</option>
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Salesperson Filter (hidden in Unassigned tab) */}
              {activeTab === "leads" && (
                <div style={{ minWidth: "160px" }}>
                  <select
                    value={selectedSalespersonId}
                    onChange={(e) => {
                      setSelectedSalespersonId(e.target.value);
                      setLeadsPage(1);
                    }}
                    style={{
                      width: "100%",
                      padding: "0.45rem 0.65rem",
                      fontSize: "0.8125rem",
                      borderRadius: "0.375rem",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#fff",
                    }}
                  >
                    <option value="">All Salespeople</option>
                    {salespeople.map((sp) => (
                      <option key={sp.user_id} value={sp.user_id}>
                        {sp.display_name || sp.username}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Campaign Filter */}
              <div style={{ minWidth: "140px" }}>
                <input
                  type="text"
                  placeholder="Filter campaign..."
                  value={selectedCampaign}
                  onChange={(e) => setSelectedCampaign(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setLeadsPage(1);
                      fetchLeads();
                    }
                  }}
                  style={{
                    width: "100%",
                    padding: "0.45rem 0.65rem",
                    fontSize: "0.8125rem",
                    borderRadius: "0.375rem",
                    border: "1px solid #cbd5e1",
                  }}
                />
              </div>

              {/* Apply / Clear */}
              <button
                type="button"
                onClick={() => {
                  setLeadsPage(1);
                  fetchLeads();
                }}
                style={{
                  padding: "0.45rem 0.85rem",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  borderRadius: "0.375rem",
                  backgroundColor: "#0f172a",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Apply Filters
              </button>

              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedPipelineId("");
                  setSelectedSalespersonId("");
                  setSelectedCampaign("");
                  setSelectedStatus("");
                  setLeadsPage(1);
                }}
                style={{
                  padding: "0.45rem 0.75rem",
                  fontSize: "0.8125rem",
                  borderRadius: "0.375rem",
                  backgroundColor: "#fff",
                  color: "#64748b",
                  border: "1px solid #cbd5e1",
                  cursor: "pointer",
                }}
              >
                Reset
              </button>

              <button
                type="button"
                onClick={handleOpenCreateModal}
                style={{
                  padding: "0.45rem 0.85rem",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  borderRadius: "0.375rem",
                  backgroundColor: "#059669",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  marginLeft: "auto",
                }}
              >
                + Add Lead
              </button>
            </>
          )}

          {activeTab === "history" && (
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", width: "100%" }}>
              <span style={{ fontSize: "0.8125rem", color: "#64748b", fontWeight: 500 }}>
                Filter History By Salesperson:
              </span>
              <select
                value={selectedSalespersonId}
                onChange={(e) => {
                  setSelectedSalespersonId(e.target.value);
                  setHistoryPage(1);
                }}
                style={{
                  minWidth: "200px",
                  padding: "0.45rem 0.65rem",
                  fontSize: "0.8125rem",
                  borderRadius: "0.375rem",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#fff",
                }}
              >
                <option value="">All Salespeople</option>
                {salespeople.map((sp) => (
                  <option key={sp.user_id} value={sp.user_id}>
                    {sp.display_name || sp.username}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setSelectedSalespersonId("");
                  setHistoryPage(1);
                }}
                style={{
                  padding: "0.45rem 0.75rem",
                  fontSize: "0.8125rem",
                  borderRadius: "0.375rem",
                  backgroundColor: "#fff",
                  color: "#64748b",
                  border: "1px solid #cbd5e1",
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
        )}

        {/* TAB 1 & 2: LEADS TABLE (All Leads / Unassigned) */}
        {(activeTab === "leads" || activeTab === "unassigned") && (
          <div
            style={{
              background: "#fff",
              borderRadius: "0.5rem",
              border: "1px solid #e2e8f0",
              overflow: "hidden",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                overflowX: "auto",
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                WebkitOverflowScrolling: "touch",
                boxSizing: "border-box",
              }}
            >
              <table
                style={{
                  width: "100%",
                  minWidth: "1390px",
                  tableLayout: "fixed",
                  borderCollapse: "collapse",
                  textAlign: "left",
                  fontSize: "0.8125rem",
                  boxSizing: "border-box",
                }}
              >
                <colgroup>
                  <col style={{ width: "190px" }} />
                  <col style={{ width: "150px" }} />
                  <col style={{ width: "140px" }} />
                  <col style={{ width: "160px" }} />
                  <col style={{ width: "170px" }} />
                  <col style={{ width: "230px" }} />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "230px" }} />
                </colgroup>
                <thead>
                  <tr
                    style={{
                      backgroundColor: "#f8fafc",
                      borderBottom: "1px solid #e2e8f0",
                      color: "#475569",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    <th style={{ padding: "0.75rem 1rem", width: "190px", minWidth: "190px", boxSizing: "border-box", position: "static", whiteSpace: "nowrap" }}>Lead</th>
                    <th style={{ padding: "0.75rem 1rem", width: "150px", minWidth: "150px", boxSizing: "border-box", position: "static", whiteSpace: "nowrap" }}>Contact</th>
                    <th style={{ padding: "0.75rem 1rem", width: "140px", minWidth: "140px", boxSizing: "border-box", position: "static", whiteSpace: "nowrap" }}>Pipeline & Stage</th>
                    <th style={{ padding: "0.75rem 1rem", width: "160px", minWidth: "160px", boxSizing: "border-box", position: "static", whiteSpace: "nowrap" }}>Campaign / Source</th>
                    <th style={{ padding: "0.75rem 1rem", width: "170px", minWidth: "170px", boxSizing: "border-box", position: "static", whiteSpace: "nowrap" }}>Assigned Salesperson</th>
                    <th style={{ padding: "0.75rem 1rem", width: "230px", minWidth: "230px", boxSizing: "border-box", position: "static", whiteSpace: "nowrap" }}>Assignment Reason</th>
                    <th style={{ padding: "0.75rem 1rem", width: "120px", minWidth: "120px", boxSizing: "border-box", position: "static", whiteSpace: "nowrap" }}>Created Date</th>
                    <th style={{ padding: "0.75rem 1rem", width: "230px", minWidth: "230px", boxSizing: "border-box", position: "static", whiteSpace: "nowrap", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingLeads ? (
                    <tr>
                      <td colSpan={8} style={{ padding: "3rem 1rem", textAlign: "center", color: "#64748b" }}>
                        Loading CRM leads...
                      </td>
                    </tr>
                  ) : leads.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: "3rem 1rem", textAlign: "center", color: "#64748b" }}>
                        <div style={{ maxWidth: "360px", margin: "0 auto" }}>
                          <IconUserCheck style={{ width: "36px", height: "36px", color: "#94a3b8", margin: "0 auto 0.5rem" }} />
                          <div style={{ fontWeight: 600, color: "#0f172a", fontSize: "0.9375rem" }}>
                            {activeTab === "unassigned" ? "No unassigned leads found" : "No leads found"}
                          </div>
                          <p style={{ fontSize: "0.8125rem", color: "#64748b", marginTop: "0.25rem" }}>
                            {activeTab === "unassigned"
                              ? "All leads within your authorized scope are currently assigned."
                              : "No leads matched your search and filter criteria."}
                          </p>
                          <div style={{ marginTop: "1rem" }}>
                            <button
                              type="button"
                              onClick={handleOpenCreateModal}
                              style={{
                                padding: "0.45rem 0.95rem",
                                fontSize: "0.8125rem",
                                fontWeight: 600,
                                borderRadius: "0.375rem",
                                backgroundColor: "#059669",
                                color: "#fff",
                                border: "none",
                                cursor: "pointer",
                              }}
                            >
                              + Create Lead
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    leads.map((lead) => {
                      const isUnassigned = !lead.assigned_to;
                      return (
                        <tr
                          key={lead.id}
                          style={{
                            borderBottom: "1px solid #f1f5f9",
                            backgroundColor: isUnassigned && activeTab === "unassigned" ? "#fffcfc" : "transparent",
                          }}
                        >
                          {/* Lead Identifier */}
                          <td style={{ padding: "0.75rem 1rem", verticalAlign: "middle", boxSizing: "border-box", overflow: "hidden" }}>
                            <div style={{ fontWeight: 600, color: "#0f172a", whiteSpace: "normal", wordBreak: "break-word", overflowWrap: "anywhere" }}>{lead.name}</div>
                            <div style={{ display: "flex", gap: "0.35rem", alignItems: "center", marginTop: "0.15rem", flexWrap: "wrap" }}>
                              <span
                                style={{
                                  fontSize: "0.7rem",
                                  color: "#3b82f6",
                                  backgroundColor: "#eff6ff",
                                  padding: "0.05rem 0.35rem",
                                  borderRadius: "0.25rem",
                                  fontFamily: "monospace",
                                  fontWeight: 600,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {lead.lead_code}
                              </span>
                              {lead.company_name && (
                                <span style={{ fontSize: "0.75rem", color: "#64748b", whiteSpace: "normal", wordBreak: "break-word" }}>
                                  • {lead.company_name}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Contact Info */}
                          <td style={{ padding: "0.75rem 1rem", verticalAlign: "middle", boxSizing: "border-box", overflow: "hidden" }}>
                            <div style={{ fontWeight: 500, color: "#334155", whiteSpace: "nowrap" }}>{lead.original_phone}</div>
                            {lead.email && (
                              <div
                                style={{
                                  fontSize: "0.75rem",
                                  color: "#94a3b8",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  maxWidth: "100%",
                                }}
                                title={lead.email}
                              >
                                {lead.email}
                              </div>
                            )}
                          </td>

                          {/* Pipeline & Stage */}
                          <td style={{ padding: "0.75rem 1rem", verticalAlign: "middle", boxSizing: "border-box", overflow: "hidden" }}>
                            <div style={{ fontWeight: 500, color: "#0f172a", whiteSpace: "normal", wordBreak: "break-word", overflowWrap: "anywhere" }}>
                              {lead.pipeline_name || "—"}
                            </div>
                            {lead.stage_name && (
                              <span
                                style={{
                                  display: "inline-block",
                                  marginTop: "0.2rem",
                                  fontSize: "0.7rem",
                                  padding: "0.1rem 0.4rem",
                                  borderRadius: "0.25rem",
                                  backgroundColor: "#f1f5f9",
                                  color: "#475569",
                                  whiteSpace: "normal",
                                  wordBreak: "break-word",
                                  overflowWrap: "anywhere",
                                }}
                              >
                                {lead.stage_name}
                              </span>
                            )}
                          </td>

                          {/* Campaign & Source */}
                          <td
                            style={{
                              padding: "0.75rem 1rem",
                              verticalAlign: "middle",
                              boxSizing: "border-box",
                              overflow: "hidden",
                              whiteSpace: "normal",
                              wordBreak: "break-word",
                              overflowWrap: "anywhere",
                            }}
                          >
                            <div
                              style={{
                                fontWeight: 500,
                                color: "#334155",
                                whiteSpace: "normal",
                                wordBreak: "break-word",
                                overflowWrap: "anywhere",
                                lineHeight: 1.35,
                              }}
                            >
                              {lead.campaign || "—"}
                            </div>
                            <div
                              style={{
                                fontSize: "0.75rem",
                                color: "#64748b",
                                marginTop: "0.15rem",
                                whiteSpace: "normal",
                                wordBreak: "break-word",
                                overflowWrap: "anywhere",
                              }}
                            >
                              {lead.source_type}
                            </div>
                          </td>

                          {/* Assigned Salesperson or Unassigned */}
                          <td
                            style={{
                              padding: "0.75rem 1rem",
                              verticalAlign: "middle",
                              boxSizing: "border-box",
                              overflow: "hidden",
                              whiteSpace: "normal",
                            }}
                          >
                            {lead.assigned_to ? (
                              <div style={{ minWidth: 0, overflow: "hidden" }}>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.35rem",
                                    fontWeight: 600,
                                    color: "#0f172a",
                                    minWidth: 0,
                                  }}
                                >
                                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#10b981", flexShrink: 0 }} />
                                  <span
                                    style={{
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                      display: "inline-block",
                                    }}
                                    title={lead.assigned_salesperson_name || "Assigned"}
                                  >
                                    {lead.assigned_salesperson_name || "Assigned"}
                                  </span>
                                </div>
                                {lead.assigned_salesperson_email && (
                                  <div
                                    style={{
                                      fontSize: "0.7rem",
                                      color: "#94a3b8",
                                      paddingLeft: "0.75rem",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                    title={lead.assigned_salesperson_email}
                                  >
                                    {lead.assigned_salesperson_email}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.3rem",
                                  padding: "0.2rem 0.55rem",
                                  borderRadius: "9999px",
                                  fontSize: "0.75rem",
                                  fontWeight: 600,
                                  backgroundColor: "#fef2f2",
                                  color: "#991b1b",
                                  border: "1px solid #fecaca",
                                  whiteSpace: "nowrap",
                                  flexShrink: 0,
                                }}
                              >
                                <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#ef4444", flexShrink: 0 }} />
                                Unassigned
                              </span>
                            )}
                          </td>

                          {/* Assignment Status & Reason */}
                          <td
                            style={{
                              padding: "0.75rem 1rem",
                              verticalAlign: "middle",
                              boxSizing: "border-box",
                              overflow: "hidden",
                              whiteSpace: "normal",
                              wordBreak: "break-word",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {isUnassigned ? (
                              <span
                                title={formatUnassignedReason(lead.unassigned_reason)}
                                style={{
                                  fontSize: "0.75rem",
                                  color: "#b91c1c",
                                  lineHeight: 1.4,
                                  display: "block",
                                  whiteSpace: "normal",
                                  wordBreak: "break-word",
                                  overflowWrap: "anywhere",
                                }}
                              >
                                {formatUnassignedReason(lead.unassigned_reason)}
                              </span>
                            ) : (
                              <span
                                style={{
                                  fontSize: "0.75rem",
                                  color: "#16a34a",
                                  fontWeight: 500,
                                  whiteSpace: "normal",
                                  wordBreak: "break-word",
                                }}
                              >
                                Successfully Assigned
                              </span>
                            )}
                          </td>

                          {/* Created Date */}
                          <td
                            style={{
                              padding: "0.75rem 1rem",
                              color: "#64748b",
                              whiteSpace: "nowrap",
                              verticalAlign: "middle",
                              boxSizing: "border-box",
                              overflow: "hidden",
                            }}
                          >
                            {new Date(lead.created_at).toLocaleDateString()}
                          </td>

                          {/* Actions */}
                          <td
                            style={{
                              padding: "0.75rem 1rem",
                              textAlign: "right",
                              whiteSpace: "nowrap",
                              verticalAlign: "middle",
                              boxSizing: "border-box",
                            }}
                          >
                            <div
                              style={{
                                display: "inline-flex",
                                gap: "0.5rem",
                                alignItems: "center",
                                justifyContent: "flex-end",
                                flexWrap: "nowrap",
                                width: "100%",
                              }}
                            >
                              {isManager && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenReassignModal(lead)}
                                  style={{
                                    padding: "0.35rem 0.75rem",
                                    fontSize: "0.75rem",
                                    fontWeight: 600,
                                    borderRadius: "0.375rem",
                                    border: "1px solid #bfdbfe",
                                    backgroundColor: "#eff6ff",
                                    color: "#1d4ed8",
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                    flexShrink: 0,
                                  }}
                                  title="Reassign lead to an eligible salesperson"
                                >
                                  Reassign
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleOpenLeadDrawer(lead)}
                                style={{
                                  padding: "0.35rem 0.75rem",
                                  fontSize: "0.75rem",
                                  fontWeight: 600,
                                  borderRadius: "0.375rem",
                                  border: "1px solid #cbd5e1",
                                  backgroundColor: "#fff",
                                  color: "#0f172a",
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                  flexShrink: 0,
                                }}
                              >
                                History & Details
                              </button>
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
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.75rem 1rem",
                borderTop: "1px solid #e2e8f0",
                backgroundColor: "#f8fafc",
                fontSize: "0.8125rem",
                color: "#64748b",
              }}
            >
              <div>
                Showing {leads.length > 0 ? (leadsPage - 1) * leadsPageSize + 1 : 0} to{" "}
                {Math.min(leadsPage * leadsPageSize, leadsTotal)} of {leadsTotal} leads
              </div>

              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <button
                  type="button"
                  disabled={leadsPage <= 1 || loadingLeads}
                  onClick={() => setLeadsPage((p) => Math.max(p - 1, 1))}
                  style={{
                    padding: "0.35rem 0.75rem",
                    borderRadius: "0.375rem",
                    border: "1px solid #cbd5e1",
                    backgroundColor: leadsPage <= 1 ? "#f1f5f9" : "#fff",
                    color: leadsPage <= 1 ? "#94a3b8" : "#0f172a",
                    cursor: leadsPage <= 1 ? "not-allowed" : "pointer",
                  }}
                >
                  Previous
                </button>
                <span>
                  Page {leadsPage} of {leadsTotalPages || 1}
                </span>
                <button
                  type="button"
                  disabled={leadsPage >= leadsTotalPages || loadingLeads}
                  onClick={() => setLeadsPage((p) => p + 1)}
                  style={{
                    padding: "0.35rem 0.75rem",
                    borderRadius: "0.375rem",
                    border: "1px solid #cbd5e1",
                    backgroundColor: leadsPage >= leadsTotalPages ? "#f1f5f9" : "#fff",
                    color: leadsPage >= leadsTotalPages ? "#94a3b8" : "#0f172a",
                    cursor: leadsPage >= leadsTotalPages ? "not-allowed" : "pointer",
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB: PIPELINE KANBAN */}
        {activeTab === "kanban" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* Kanban Controls Bar */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "1rem",
                backgroundColor: "#fff",
                borderRadius: "0.5rem",
                border: "1px solid #e2e8f0",
                padding: "0.75rem 1rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                {pipelines.length > 1 ? (
                  <>
                    <label htmlFor="kanban-pipeline-select" style={{ fontSize: "0.875rem", fontWeight: 600, color: "#1e293b" }}>
                      Select Pipeline:
                    </label>
                    <select
                      id="kanban-pipeline-select"
                      data-testid="kanban-pipeline-select"
                      value={kanbanPipelineId || (pipelines.length > 0 ? pipelines[0].id : "")}
                      onChange={(e) => {
                        setKanbanPipelineId(e.target.value);
                      }}
                      style={{
                        padding: "0.45rem 0.75rem",
                        fontSize: "0.8125rem",
                        borderRadius: "0.375rem",
                        border: "1px solid #cbd5e1",
                        backgroundColor: "#fff",
                        minWidth: "220px",
                        fontWeight: 600,
                      }}
                    >
                      {pipelines.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </>
                ) : pipelines.length === 1 ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "#1e293b" }}>Pipeline:</span>
                    <span
                      style={{
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        padding: "0.25rem 0.65rem",
                        backgroundColor: "#f1f5f9",
                        borderRadius: "0.375rem",
                        color: "#0f172a",
                        border: "1px solid #e2e8f0",
                      }}
                    >
                      {pipelines[0].name}
                    </span>
                  </div>
                ) : (
                  <span style={{ fontSize: "0.875rem", color: "#64748b" }}>No active pipelines found</span>
                )}

                <button
                  type="button"
                  data-testid="kanban-refresh-btn"
                  onClick={() => {
                    const pid = kanbanPipelineId || (pipelines.length > 0 ? pipelines[0].id : "");
                    if (pid) fetchKanbanData(pid);
                  }}
                  disabled={loadingKanban}
                  style={{
                    padding: "0.45rem 0.75rem",
                    fontSize: "0.8125rem",
                    borderRadius: "0.375rem",
                    backgroundColor: "#f8fafc",
                    border: "1px solid #cbd5e1",
                    cursor: loadingKanban ? "not-allowed" : "pointer",
                    color: "#475569",
                  }}
                >
                  <IconRefresh style={{ width: "12px", height: "12px", display: "inline-block", marginRight: "0.25rem" }} />
                  {loadingKanban ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span style={{ fontSize: "0.8125rem", color: "#64748b" }}>
                  Total Pipeline Leads: <strong data-testid="kanban-total-leads">{kanbanLeads.length}</strong>
                </span>
                <button
                  type="button"
                  onClick={handleOpenCreateModal}
                  style={{
                    padding: "0.45rem 0.85rem",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    borderRadius: "0.375rem",
                    backgroundColor: "#059669",
                    color: "#fff",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  + Add Lead
                </button>
              </div>
            </div>

            {/* Kanban Board Container */}
            {loadingKanban ? (
              <div
                data-testid="kanban-loading-state"
                style={{ padding: "3rem", textAlign: "center", backgroundColor: "#fff", borderRadius: "0.5rem", border: "1px solid #e2e8f0", color: "#64748b" }}
              >
                Loading pipeline stages and leads...
              </div>
            ) : kanbanStages.length === 0 ? (
              <div
                data-testid="kanban-empty-stages"
                style={{ padding: "3rem", textAlign: "center", backgroundColor: "#fff", borderRadius: "0.5rem", border: "1px solid #e2e8f0", color: "#64748b" }}
              >
                No active stages found for this pipeline.
              </div>
            ) : (
              <div
                data-testid="kanban-board"
                style={{
                  display: "flex",
                  gap: "1rem",
                  overflowX: "auto",
                  paddingBottom: "1rem",
                  alignItems: "flex-start",
                  minHeight: "550px",
                  WebkitOverflowScrolling: "touch",
                }}
              >
                {kanbanStages.map((stage) => {
                  const stageLeads = kanbanLeads.filter((l) => l.stage_id === stage.id);
                  const isWon = stage.stage_type === "won";
                  const isLost = stage.stage_type === "lost";
                  const isDragOver = dragOverStageId === stage.id;
                  const headerBg = isWon ? "#ecfdf5" : isLost ? "#fef2f2" : "#f1f5f9";
                  const headerColor = isWon ? "#065f46" : isLost ? "#991b1b" : "#1e293b";

                  return (
                    <div
                      key={stage.id}
                      data-testid={`kanban-column-${stage.id}`}
                      data-stage-type={stage.stage_type}
                      role="region"
                      aria-label={`${stage.name} column`}
                      onDragOver={(e) => handleStageDragOver(e, stage.id)}
                      onDragLeave={(e) => handleStageDragLeave(e, stage.id)}
                      onDrop={(e) => handleStageDrop(e, stage)}
                      style={{
                        flex: "0 0 280px",
                        width: "280px",
                        backgroundColor: isDragOver ? "#eff6ff" : "#f8fafc",
                        borderRadius: "0.5rem",
                        border: isDragOver ? "2px solid #3b82f6" : "1px solid #e2e8f0",
                        display: "flex",
                        flexDirection: "column",
                        maxHeight: "750px",
                        transition: "background-color 0.15s ease, border-color 0.15s ease",
                      }}
                    >
                      {/* Column Header */}
                      <div
                        style={{
                          padding: "0.75rem 1rem",
                          backgroundColor: headerBg,
                          borderBottom: "1px solid #e2e8f0",
                          borderTopLeftRadius: "0.5rem",
                          borderTopRightRadius: "0.5rem",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={{ fontWeight: 700, fontSize: "0.875rem", color: headerColor }}>
                            {stage.name}
                          </span>
                          {stage.is_initial && (
                            <span style={{ fontSize: "0.65rem", padding: "0.1rem 0.35rem", borderRadius: "9999px", backgroundColor: "#dbeafe", color: "#1e40af", fontWeight: 600 }}>
                              Initial
                            </span>
                          )}
                        </div>
                        <span
                          data-testid={`stage-count-${stage.id}`}
                          style={{
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            padding: "0.15rem 0.5rem",
                            borderRadius: "9999px",
                            backgroundColor: "#fff",
                            color: headerColor,
                            border: "1px solid #cbd5e1",
                          }}
                        >
                          {stageLeads.length}
                        </span>
                      </div>

                      {/* Column Cards Drop Area */}
                      <div
                        style={{
                          padding: "0.75rem",
                          overflowY: "auto",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.75rem",
                          flex: 1,
                          minHeight: "160px",
                        }}
                      >
                        {stageLeads.length === 0 ? (
                          <div
                            style={{
                              padding: "2rem 0.5rem",
                              textAlign: "center",
                              color: isDragOver ? "#2563eb" : "#94a3b8",
                              fontSize: "0.8125rem",
                              border: isDragOver ? "2px dashed #3b82f6" : "1px dashed #cbd5e1",
                              borderRadius: "0.375rem",
                              backgroundColor: isDragOver ? "#dbeafe" : "transparent",
                              transition: "all 0.15s ease",
                            }}
                          >
                            {isDragOver ? "Drop lead here" : "No leads in this stage"}
                          </div>
                        ) : (
                          stageLeads.map((lead) => {
                            const pri = (lead.priority || "medium").toLowerCase();
                            const priBg =
                              pri === "urgent" ? "#fee2e2" :
                              pri === "high" ? "#ffedd5" :
                              pri === "low" ? "#f0fdf4" : "#fef3c7";
                            const priColor =
                              pri === "urgent" ? "#991b1b" :
                              pri === "high" ? "#c2410c" :
                              pri === "low" ? "#166534" : "#b45309";

                            const isMovable = canUserMoveLead(lead);
                            const isCurrentlyDragging = draggedLeadId === lead.id;
                            const isCurrentlyMoving = movingLeadId === lead.id;

                            return (
                              <div
                                key={lead.id}
                                data-testid={`kanban-card-${lead.id}`}
                                draggable={isMovable && !movingLeadId}
                                onDragStart={(e) => handleCardDragStart(e, lead)}
                                onDragEnd={() => {
                                  setDraggedLeadId(null);
                                  setDragOverStageId(null);
                                }}
                                aria-grabbed={isCurrentlyDragging}
                                style={{
                                  backgroundColor: isCurrentlyDragging ? "#f1f5f9" : "#fff",
                                  border: isCurrentlyDragging
                                    ? "2px dashed #3b82f6"
                                    : isCurrentlyMoving
                                    ? "1px solid #93c5fd"
                                    : "1px solid #e2e8f0",
                                  borderRadius: "0.375rem",
                                  padding: "0.75rem",
                                  boxShadow: isCurrentlyDragging ? "none" : "0 1px 2px rgba(0,0,0,0.04)",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "0.5rem",
                                  opacity: isCurrentlyDragging ? 0.6 : isCurrentlyMoving ? 0.7 : 1,
                                  cursor: isMovable && !movingLeadId ? "grab" : "default",
                                  position: "relative",
                                  transition: "box-shadow 0.15s ease, border-color 0.15s ease, opacity 0.15s ease",
                                }}
                              >
                                {isCurrentlyMoving && (
                                  <div
                                    data-testid={`moving-overlay-${lead.id}`}
                                    style={{
                                      position: "absolute",
                                      top: 0,
                                      left: 0,
                                      right: 0,
                                      bottom: 0,
                                      backgroundColor: "rgba(255, 255, 255, 0.75)",
                                      backdropFilter: "blur(1px)",
                                      borderRadius: "0.375rem",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: "0.75rem",
                                      fontWeight: 600,
                                      color: "#2563eb",
                                      zIndex: 3,
                                    }}
                                  >
                                    Moving stage...
                                  </div>
                                )}

                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                                  <div
                                    onClick={() => handleOpenLeadDrawer(lead)}
                                    style={{
                                      fontWeight: 600,
                                      fontSize: "0.875rem",
                                      color: "#1e40af",
                                      cursor: "pointer",
                                      wordBreak: "break-word",
                                      textDecoration: "underline",
                                    }}
                                  >
                                    {lead.name}
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                                    {!isMovable && (
                                      <span
                                        title="View only: You do not have permissions to move this lead"
                                        style={{
                                          fontSize: "0.65rem",
                                          padding: "0.1rem 0.35rem",
                                          borderRadius: "0.25rem",
                                          backgroundColor: "#f1f5f9",
                                          color: "#64748b",
                                          fontWeight: 500,
                                        }}
                                      >
                                        🔒 View only
                                      </span>
                                    )}
                                    <span
                                      style={{
                                        fontSize: "0.7rem",
                                        fontWeight: 700,
                                        textTransform: "capitalize",
                                        padding: "0.1rem 0.35rem",
                                        borderRadius: "0.25rem",
                                        backgroundColor: priBg,
                                        color: priColor,
                                        flexShrink: 0,
                                      }}
                                    >
                                      {lead.priority || "Medium"}
                                    </span>
                                  </div>
                                </div>

                                <div style={{ fontSize: "0.75rem", color: "#64748b", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                                    <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#3b82f6" }}>
                                      {lead.lead_code}
                                    </span>
                                    {lead.company_name && <span>• {lead.company_name}</span>}
                                  </div>
                                  {lead.original_phone && <div>📞 {lead.original_phone}</div>}
                                  <div>
                                    👤 {lead.assigned_salesperson_name ? (
                                      <span style={{ color: "#0f172a", fontWeight: 500 }}>{lead.assigned_salesperson_name}</span>
                                    ) : (
                                      <span style={{ color: "#dc2626", fontStyle: "italic" }}>Unassigned</span>
                                    )}
                                  </div>
                                </div>

                                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.35rem", borderTop: "1px solid #f1f5f9", paddingTop: "0.5rem" }}>
                                  {isMovable && (
                                    <button
                                      type="button"
                                      data-testid={`move-stage-btn-${lead.id}`}
                                      disabled={isCurrentlyMoving}
                                      onClick={() => {
                                        setSelectedLead(lead);
                                        setTargetStageId(lead.stage_id || "");
                                        setStageReason("");
                                        setStageLostReason("");
                                        setStageError(null);
                                        setChangeStageModalOpen(true);
                                        if (lead.pipeline_id) {
                                          fetchPipelineStages(lead.pipeline_id);
                                        }
                                      }}
                                      style={{
                                        padding: "0.25rem 0.5rem",
                                        fontSize: "0.7rem",
                                        fontWeight: 600,
                                        backgroundColor: "#f8fafc",
                                        border: "1px solid #cbd5e1",
                                        borderRadius: "0.25rem",
                                        color: "#334155",
                                        cursor: isCurrentlyMoving ? "not-allowed" : "pointer",
                                      }}
                                    >
                                      Move Stage
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleOpenLeadDrawer(lead)}
                                    style={{
                                      padding: "0.25rem 0.5rem",
                                      fontSize: "0.7rem",
                                      fontWeight: 600,
                                      backgroundColor: "#eff6ff",
                                      border: "1px solid #bfdbfe",
                                      borderRadius: "0.25rem",
                                      color: "#1d4ed8",
                                      cursor: "pointer",
                                    }}
                                  >
                                    View
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ASSIGNMENT AUDIT HISTORY */}
        {activeTab === "history" && (
          <div
            style={{
              background: "#fff",
              borderRadius: "0.5rem",
              border: "1px solid #e2e8f0",
              overflow: "hidden",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                overflowX: "auto",
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                WebkitOverflowScrolling: "touch",
                boxSizing: "border-box",
              }}
            >
              <table
                style={{
                  width: "100%",
                  minWidth: "1280px",
                  tableLayout: "fixed",
                  borderCollapse: "collapse",
                  textAlign: "left",
                  fontSize: "0.8125rem",
                  boxSizing: "border-box",
                }}
              >
                <colgroup>
                  <col style={{ width: "160px" }} />
                  <col style={{ width: "180px" }} />
                  <col style={{ width: "150px" }} />
                  <col style={{ width: "150px" }} />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "150px" }} />
                  <col style={{ width: "130px" }} />
                  <col style={{ width: "240px" }} />
                </colgroup>
                <thead>
                  <tr
                    style={{
                      backgroundColor: "#f8fafc",
                      borderBottom: "1px solid #e2e8f0",
                      color: "#475569",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    <th style={{ padding: "0.75rem 1rem", width: "160px", minWidth: "160px", boxSizing: "border-box", position: "static", whiteSpace: "nowrap" }}>Date & Time</th>
                    <th style={{ padding: "0.75rem 1rem", width: "180px", minWidth: "180px", boxSizing: "border-box", position: "static", whiteSpace: "nowrap" }}>Lead</th>
                    <th style={{ padding: "0.75rem 1rem", width: "150px", minWidth: "150px", boxSizing: "border-box", position: "static", whiteSpace: "nowrap" }}>Previous Owner</th>
                    <th style={{ padding: "0.75rem 1rem", width: "150px", minWidth: "150px", boxSizing: "border-box", position: "static", whiteSpace: "nowrap" }}>New Owner</th>
                    <th style={{ padding: "0.75rem 1rem", width: "120px", minWidth: "120px", boxSizing: "border-box", position: "static", whiteSpace: "nowrap" }}>Method</th>
                    <th style={{ padding: "0.75rem 1rem", width: "150px", minWidth: "150px", boxSizing: "border-box", position: "static", whiteSpace: "nowrap" }}>Assigned By</th>
                    <th style={{ padding: "0.75rem 1rem", width: "130px", minWidth: "130px", boxSizing: "border-box", position: "static", whiteSpace: "nowrap" }}>Batch</th>
                    <th style={{ padding: "0.75rem 1rem", width: "240px", minWidth: "240px", boxSizing: "border-box", position: "static", whiteSpace: "nowrap" }}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingHistory ? (
                    <tr>
                      <td colSpan={8} style={{ padding: "3rem 1rem", textAlign: "center", color: "#64748b" }}>
                        Loading assignment audit history...
                      </td>
                    </tr>
                  ) : historyItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: "3rem 1rem", textAlign: "center", color: "#64748b" }}>
                        No assignment history records found.
                      </td>
                    </tr>
                  ) : (
                    historyItems.map((hist) => (
                      <tr key={hist.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "0.75rem 1rem", color: "#475569", whiteSpace: "nowrap" }}>
                          {new Date(hist.created_at).toLocaleString()}
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <div style={{ fontWeight: 600, color: "#0f172a" }}>{hist.lead_name || "—"}</div>
                          {hist.lead_code && (
                            <span style={{ fontSize: "0.7rem", color: "#3b82f6", fontFamily: "monospace" }}>
                              {hist.lead_code}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "0.75rem 1rem", color: "#64748b" }}>
                          {hist.previous_owner_name || <span style={{ color: "#94a3b8" }}>Unassigned</span>}
                        </td>
                        <td style={{ padding: "0.75rem 1rem", fontWeight: 600, color: hist.new_owner_name ? "#065f46" : "#991b1b" }}>
                          {hist.new_owner_name || <span style={{ color: "#dc2626" }}>Unassigned</span>}
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "0.15rem 0.45rem",
                              borderRadius: "0.25rem",
                              fontSize: "0.7rem",
                              fontWeight: 600,
                              backgroundColor: "#f1f5f9",
                              color: "#334155",
                            }}
                          >
                            {hist.assignment_method}
                          </span>
                        </td>
                        <td style={{ padding: "0.75rem 1rem", color: "#475569" }}>
                          {hist.assigned_by_name || "System"}
                        </td>
                        <td style={{ padding: "0.75rem 1rem", color: "#64748b" }}>
                          {hist.batch_name || "—"}
                        </td>
                        <td
                          style={{
                            padding: "0.75rem 1rem",
                            color: "#334155",
                            verticalAlign: "middle",
                            boxSizing: "border-box",
                            whiteSpace: "normal",
                            wordBreak: "break-word",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {hist.reason || "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.75rem 1rem",
                borderTop: "1px solid #e2e8f0",
                backgroundColor: "#f8fafc",
                fontSize: "0.8125rem",
                color: "#64748b",
              }}
            >
              <div>
                Showing {historyItems.length > 0 ? (historyPage - 1) * historyPageSize + 1 : 0} to{" "}
                {Math.min(historyPage * historyPageSize, historyTotal)} of {historyTotal} records
              </div>

              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <button
                  type="button"
                  disabled={historyPage <= 1 || loadingHistory}
                  onClick={() => setHistoryPage((p) => Math.max(p - 1, 1))}
                  style={{
                    padding: "0.35rem 0.75rem",
                    borderRadius: "0.375rem",
                    border: "1px solid #cbd5e1",
                    backgroundColor: historyPage <= 1 ? "#f1f5f9" : "#fff",
                    color: historyPage <= 1 ? "#94a3b8" : "#0f172a",
                    cursor: historyPage <= 1 ? "not-allowed" : "pointer",
                  }}
                >
                  Previous
                </button>
                <span>
                  Page {historyPage} of {historyTotalPages || 1}
                </span>
                <button
                  type="button"
                  disabled={historyPage >= historyTotalPages || loadingHistory}
                  onClick={() => setHistoryPage((p) => p + 1)}
                  style={{
                    padding: "0.35rem 0.75rem",
                    borderRadius: "0.375rem",
                    border: "1px solid #cbd5e1",
                    backgroundColor: historyPage >= historyTotalPages ? "#f1f5f9" : "#fff",
                    color: historyPage >= historyTotalPages ? "#94a3b8" : "#0f172a",
                    cursor: historyPage >= historyTotalPages ? "not-allowed" : "pointer",
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

                {/* TEAM OVERSIGHT TAB */}
        {activeTab === "team_oversight" && (
          <div>
            {/* Header & Scoping Banner */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.75rem",
                marginBottom: "1.25rem",
              }}
            >
              <div>
                <h2 style={{ fontSize: "1.125rem", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  Manager Team Oversight
                </h2>
                <div style={{ fontSize: "0.8125rem", color: "#64748b", marginTop: "0.25rem" }}>
                  Real-time pipeline and follow-up oversight scoped to authorized teams and representatives.
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.375rem",
                    padding: "0.35rem 0.75rem",
                    borderRadius: "9999px",
                    backgroundColor: "#e0e7ff",
                    color: "#3730a3",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                  }}
                >
                  <span>Scope:</span>
                  <span>{teamOversight?.scope_type?.toUpperCase() || "DEPARTMENT"}</span>
                  {teamOversight?.department_name && <span>({teamOversight.department_name})</span>}
                </span>

                <button
                  type="button"
                  onClick={fetchTeamOversight}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.45rem 0.85rem",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    borderRadius: "0.375rem",
                    border: "1px solid #cbd5e1",
                    backgroundColor: "#fff",
                    color: "#475569",
                    cursor: "pointer",
                  }}
                >
                  <IconRefresh style={{ width: "14px", height: "14px" }} />
                  Refresh
                </button>
              </div>
            </div>

            {/* Error Message */}
            {teamOversightError && (
              <div
                style={{
                  padding: "0.75rem 1rem",
                  backgroundColor: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: "0.5rem",
                  color: "#991b1b",
                  fontSize: "0.875rem",
                  marginBottom: "1rem",
                }}
              >
                ⚠️ {teamOversightError}
              </div>
            )}

            {/* Oversight KPI Overview Cards */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "1rem",
                marginBottom: "1.25rem",
              }}
            >
              <div
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  padding: "1rem",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                }}
              >
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748b" }}>Team Active Leads</div>
                <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#0f172a", marginTop: "0.35rem" }}>
                  {loadingTeamOversight ? "..." : (teamOversight?.total_active_leads ?? 0)}
                </div>
              </div>

              <div
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  padding: "1rem",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                }}
              >
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#dc2626" }}>Overdue Follow-ups</div>
                <div style={{ fontSize: "1.75rem", fontWeight: 700, color: (teamOversight?.total_overdue_follow_ups ?? 0) > 0 ? "#dc2626" : "#0f172a", marginTop: "0.35rem" }}>
                  {loadingTeamOversight ? "..." : (teamOversight?.total_overdue_follow_ups ?? 0)}
                </div>
              </div>

              <div
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  padding: "1rem",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                }}
              >
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#d97706" }}>Due Today</div>
                <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#d97706", marginTop: "0.35rem" }}>
                  {loadingTeamOversight ? "..." : (teamOversight?.total_due_today_follow_ups ?? 0)}
                </div>
              </div>

              <div
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  padding: "1rem",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                }}
              >
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#059669" }}>This Month Won</div>
                <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#059669", marginTop: "0.35rem" }}>
                  {loadingTeamOversight ? "..." : (teamOversight?.total_month_won ?? 0)}
                </div>
              </div>

              <div
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  padding: "1rem",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                }}
              >
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748b" }}>This Month Lost</div>
                <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#64748b", marginTop: "0.35rem" }}>
                  {loadingTeamOversight ? "..." : (teamOversight?.total_month_lost ?? 0)}
                </div>
              </div>
            </div>

            {/* Rep-by-rep Breakdown Table */}
            <div
              style={{
                backgroundColor: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: "0.5rem",
                overflow: "hidden",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              }}
            >
              {loadingTeamOversight ? (
                <div style={{ padding: "3rem", textAlign: "center", color: "#64748b" }}>
                  Loading team performance data...
                </div>
              ) : !teamOversight || teamOversight.reps.length === 0 ? (
                <div style={{ padding: "3rem 1.5rem", textAlign: "center" }}>
                  <div style={{ fontSize: "1rem", fontWeight: 600, color: "#1e293b" }}>
                    No representatives found
                  </div>
                  <div style={{ fontSize: "0.875rem", color: "#64748b", marginTop: "0.25rem" }}>
                    No sales representatives exist in your assigned team or scope.
                  </div>
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem", textAlign: "left" }}>
                    <thead>
                      <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Sales Representative</th>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Active Leads</th>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Overdue</th>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Due Today</th>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Won (Month)</th>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Lost (Month)</th>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Pipeline Distribution</th>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 600, textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamOversight.reps.map((rep) => (
                        <tr key={rep.salesperson_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "0.75rem 1rem" }}>
                            <div style={{ fontWeight: 600, color: "#0f172a" }}>{rep.salesperson_name}</div>
                            <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{rep.salesperson_email || "—"}</div>
                          </td>
                          <td style={{ padding: "0.75rem 1rem" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "0.15rem 0.5rem",
                                borderRadius: "9999px",
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                backgroundColor: "#ecfdf5",
                                color: "#047857",
                              }}
                            >
                              {rep.active_lead_count}
                            </span>
                          </td>
                          <td style={{ padding: "0.75rem 1rem" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "0.15rem 0.5rem",
                                borderRadius: "9999px",
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                backgroundColor: rep.overdue_follow_up_count > 0 ? "#fee2e2" : "#f1f5f9",
                                color: rep.overdue_follow_up_count > 0 ? "#b91c1c" : "#64748b",
                              }}
                            >
                              {rep.overdue_follow_up_count}
                            </span>
                          </td>
                          <td style={{ padding: "0.75rem 1rem" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "0.15rem 0.5rem",
                                borderRadius: "9999px",
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                backgroundColor: rep.due_today_follow_up_count > 0 ? "#fef3c7" : "#f1f5f9",
                                color: rep.due_today_follow_up_count > 0 ? "#b45309" : "#64748b",
                              }}
                            >
                              {rep.due_today_follow_up_count}
                            </span>
                          </td>
                          <td style={{ padding: "0.75rem 1rem" }}>
                            <span style={{ fontWeight: 600, color: "#059669" }}>
                              {rep.month_won_count}
                            </span>
                          </td>
                          <td style={{ padding: "0.75rem 1rem" }}>
                            <span style={{ color: "#64748b" }}>
                              {rep.month_lost_count}
                            </span>
                          </td>
                          <td style={{ padding: "0.75rem 1rem" }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", maxWidth: "320px" }}>
                              {rep.stage_distribution.length === 0 ? (
                                <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>No active leads</span>
                              ) : (
                                rep.stage_distribution.map((s, idx) => (
                                  <span
                                    key={idx}
                                    style={{
                                      display: "inline-block",
                                      padding: "0.15rem 0.4rem",
                                      borderRadius: "0.25rem",
                                      fontSize: "0.7rem",
                                      backgroundColor: "#f8fafc",
                                      border: "1px solid #e2e8f0",
                                      color: "#334155",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {s.stage_name}: <strong>{s.count}</strong>
                                  </span>
                                ))
                              )}
                            </div>
                          </td>
                          <td style={{ padding: "0.75rem 1rem", textAlign: "right" }}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSalespersonId(rep.salesperson_id);
                                setActiveTab("leads");
                                setLeadsPage(1);
                              }}
                              style={{
                                padding: "0.35rem 0.75rem",
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                backgroundColor: "#2563eb",
                                color: "#fff",
                                border: "none",
                                borderRadius: "0.375rem",
                                cursor: "pointer",
                              }}
                            >
                              View Leads
                            </button>
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

        {/* LEAD DETAIL & ASSIGNMENT TIMELINE DRAWER */}
        {drawerOpen && selectedLead && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="drawer-lead-title"
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15, 23, 42, 0.4)",
              zIndex: 9999,
              display: "flex",
              justifyContent: "flex-end",
            }}
            onClick={() => setDrawerOpen(false)}
          >
            <div
              style={{
                width: "100%",
                maxWidth: "600px",
                height: "100%",
                backgroundColor: "#fff",
                display: "flex",
                flexDirection: "column",
                boxShadow: "-4px 0 20px rgba(0,0,0,0.15)",
                overflowY: "auto",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div
                style={{
                  padding: "1.25rem 1.5rem",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  position: "sticky",
                  top: 0,
                  backgroundColor: "#fff",
                  zIndex: 10,
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <h2 id="drawer-lead-title" style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                      {selectedLead.name}
                    </h2>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: "#2563eb",
                        backgroundColor: "#eff6ff",
                        padding: "0.1rem 0.45rem",
                        borderRadius: "0.25rem",
                        fontFamily: "monospace",
                        fontWeight: 600,
                      }}
                    >
                      {selectedLead.lead_code}
                    </span>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        padding: "0.1rem 0.45rem",
                        borderRadius: "0.25rem",
                        backgroundColor:
                          selectedLead.priority === "urgent"
                            ? "#fee2e2"
                            : selectedLead.priority === "high"
                            ? "#ffedd5"
                            : "#f1f5f9",
                        color:
                          selectedLead.priority === "urgent"
                            ? "#b91c1c"
                            : selectedLead.priority === "high"
                            ? "#c2410c"
                            : "#475569",
                        textTransform: "uppercase",
                      }}
                    >
                      {selectedLead.priority || "Normal"}
                    </span>
                  </div>
                  <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.8125rem", color: "#64748b" }}>
                    Created on {new Date(selectedLead.created_at).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close lead drawer"
                  onClick={() => setDrawerOpen(false)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "1.25rem",
                    cursor: "pointer",
                    color: "#94a3b8",
                    padding: "0.25rem",
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Drawer Body */}
              <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                {/* Drawer Quick Actions Bar */}
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                    padding: "0.75rem",
                    backgroundColor: "#f8fafc",
                    borderRadius: "0.5rem",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <button
                    type="button"
                    disabled={!canManageLeads}
                    title={!canManageLeads ? "You do not have permission to log activities" : ""}
                    onClick={() => {
                      setDrawerAction(drawerAction === "log_activity" ? null : "log_activity");
                      setActError(null);
                    }}
                    style={{
                      padding: "0.4rem 0.75rem",
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      borderRadius: "0.375rem",
                      border: "1px solid #cbd5e1",
                      backgroundColor: drawerAction === "log_activity" ? "#2563eb" : "#fff",
                      color: drawerAction === "log_activity" ? "#fff" : "#1e293b",
                      cursor: canManageLeads ? "pointer" : "not-allowed",
                      opacity: canManageLeads ? 1 : 0.6,
                    }}
                  >
                    + Log Activity
                  </button>

                  <button
                    type="button"
                    disabled={!canManageLeads}
                    title={!canManageLeads ? "You do not have permission to schedule follow-ups" : ""}
                    onClick={() => {
                      setDrawerAction(drawerAction === "schedule_followup" ? null : "schedule_followup");
                      setFuError(null);
                    }}
                    style={{
                      padding: "0.4rem 0.75rem",
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      borderRadius: "0.375rem",
                      border: "1px solid #cbd5e1",
                      backgroundColor: drawerAction === "schedule_followup" ? "#2563eb" : "#fff",
                      color: drawerAction === "schedule_followup" ? "#fff" : "#1e293b",
                      cursor: canManageLeads ? "pointer" : "not-allowed",
                      opacity: canManageLeads ? 1 : 0.6,
                    }}
                  >
                    + Schedule Follow-Up
                  </button>

                  <button
                    type="button"
                    disabled={!canManageLeads}
                    title={!canManageLeads ? "You do not have permission to change stages" : ""}
                    onClick={() => {
                      setTargetStageId(selectedLead.stage_id || "");
                      setStageReason("");
                      setStageLostReason("");
                      setStageError(null);
                      setChangeStageModalOpen(true);
                      if (selectedLead.pipeline_id) {
                        fetchPipelineStages(selectedLead.pipeline_id);
                      }
                    }}
                    style={{
                      padding: "0.4rem 0.75rem",
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      borderRadius: "0.375rem",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#fff",
                      color: "#1e293b",
                      cursor: canManageLeads ? "pointer" : "not-allowed",
                      opacity: canManageLeads ? 1 : 0.6,
                    }}
                  >
                    Change Stage
                  </button>

                  {isManager && (
                    <button
                      type="button"
                      onClick={() => handleOpenReassignModal(selectedLead)}
                      style={{
                        padding: "0.4rem 0.75rem",
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        borderRadius: "0.375rem",
                        border: "1px solid #cbd5e1",
                        backgroundColor: "#fff",
                        color: "#1e293b",
                        cursor: "pointer",
                      }}
                    >
                      Reassign Lead
                    </button>
                  )}
                </div>

                {/* Inline Form: Log Activity */}
                {drawerAction === "log_activity" && (
                  <form
                    onSubmit={handleLogActivity}
                    style={{
                      backgroundColor: "#f8fafc",
                      border: "1px solid #cbd5e1",
                      borderRadius: "0.5rem",
                      padding: "1rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.75rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <h4 style={{ fontSize: "0.875rem", fontWeight: 700, margin: 0, color: "#0f172a" }}>
                        Log New Lead Activity
                      </h4>
                      <button
                        type="button"
                        onClick={() => setDrawerAction(null)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: "0.875rem" }}
                      >
                        ✕
                      </button>
                    </div>

                    {actError && (
                      <div style={{ fontSize: "0.75rem", color: "#b91c1c", backgroundColor: "#fee2e2", padding: "0.4rem 0.6rem", borderRadius: "0.25rem" }}>
                        {actError}
                      </div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                      <div>
                        <label htmlFor="act-type-select" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                          Activity Type *
                        </label>
                        <select
                          id="act-type-select"
                          value={actType}
                          onChange={(e) => setActType(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "0.4rem 0.5rem",
                            fontSize: "0.8125rem",
                            borderRadius: "0.375rem",
                            border: "1px solid #cbd5e1",
                            backgroundColor: "#fff",
                          }}
                        >
                          <option value="call">Call</option>
                          <option value="meeting">Meeting</option>
                          <option value="note">Note / Comment</option>
                          <option value="email">Email</option>
                          <option value="whatsapp">WhatsApp</option>
                          <option value="site_visit">Site Visit</option>
                          <option value="task">Task / Follow-up</option>
                        </select>
                      </div>

                      <div>
                        <label htmlFor="act-time-input" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                          Activity Date & Time
                        </label>
                        <input
                          id="act-time-input"
                          type="datetime-local"
                          value={actTime}
                          onChange={(e) => setActTime(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "0.4rem 0.5rem",
                            fontSize: "0.8125rem",
                            borderRadius: "0.375rem",
                            border: "1px solid #cbd5e1",
                            backgroundColor: "#fff",
                            boxSizing: "border-box",
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="act-subject-input" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                        Subject / Summary *
                      </label>
                      <input
                        id="act-subject-input"
                        type="text"
                        placeholder="e.g. Discovery call about solar installation"
                        value={actSubject}
                        onChange={(e) => setActSubject(e.target.value)}
                        required
                        style={{
                          width: "100%",
                          padding: "0.4rem 0.5rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #cbd5e1",
                          backgroundColor: "#fff",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>

                    <div>
                      <label htmlFor="act-desc-input" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                        Details / Notes
                      </label>
                      <textarea
                        id="act-desc-input"
                        rows={2}
                        placeholder="Key points discussed, questions asked, next steps..."
                        value={actDescription}
                        onChange={(e) => setActDescription(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "0.4rem 0.5rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #cbd5e1",
                          backgroundColor: "#fff",
                          boxSizing: "border-box",
                          resize: "vertical",
                        }}
                      />
                    </div>

                    <div>
                      <label htmlFor="act-outcome-input" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                        Outcome / Result (Optional)
                      </label>
                      <input
                        id="act-outcome-input"
                        type="text"
                        placeholder="e.g. Interested in commercial tier, send proposal"
                        value={actOutcome}
                        onChange={(e) => setActOutcome(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "0.4rem 0.5rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #cbd5e1",
                          backgroundColor: "#fff",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                      <button
                        type="button"
                        onClick={() => setDrawerAction(null)}
                        style={{
                          padding: "0.375rem 0.75rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #cbd5e1",
                          backgroundColor: "#fff",
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={actSubmitting || !actSubject.trim()}
                        style={{
                          padding: "0.375rem 0.875rem",
                          fontSize: "0.8125rem",
                          fontWeight: 600,
                          borderRadius: "0.375rem",
                          border: "none",
                          backgroundColor: actSubmitting || !actSubject.trim() ? "#94a3b8" : "#2563eb",
                          color: "#fff",
                          cursor: actSubmitting || !actSubject.trim() ? "not-allowed" : "pointer",
                        }}
                      >
                        {actSubmitting ? "Logging..." : "Save Activity"}
                      </button>
                    </div>
                  </form>
                )}

                {/* Inline Form: Schedule Follow-Up */}
                {drawerAction === "schedule_followup" && (
                  <form
                    onSubmit={handleScheduleFollowUp}
                    style={{
                      backgroundColor: "#f8fafc",
                      border: "1px solid #cbd5e1",
                      borderRadius: "0.5rem",
                      padding: "1rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.75rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <h4 style={{ fontSize: "0.875rem", fontWeight: 700, margin: 0, color: "#0f172a" }}>
                        Schedule Follow-Up Task
                      </h4>
                      <button
                        type="button"
                        onClick={() => setDrawerAction(null)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: "0.875rem" }}
                      >
                        ✕
                      </button>
                    </div>

                    {fuError && (
                      <div style={{ fontSize: "0.75rem", color: "#b91c1c", backgroundColor: "#fee2e2", padding: "0.4rem 0.6rem", borderRadius: "0.25rem" }}>
                        {fuError}
                      </div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                      <div>
                        <label htmlFor="fu-type-select" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                          Follow-up Type *
                        </label>
                        <select
                          id="fu-type-select"
                          value={fuType}
                          onChange={(e) => setFuType(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "0.4rem 0.5rem",
                            fontSize: "0.8125rem",
                            borderRadius: "0.375rem",
                            border: "1px solid #cbd5e1",
                            backgroundColor: "#fff",
                          }}
                        >
                          <option value="call">Call</option>
                          <option value="meeting">Meeting</option>
                          <option value="email">Email</option>
                          <option value="whatsapp">WhatsApp</option>
                          <option value="task">Task / Review</option>
                        </select>
                      </div>

                      <div>
                        <label htmlFor="fu-priority-select" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                          Priority
                        </label>
                        <select
                          id="fu-priority-select"
                          value={fuPriority}
                          onChange={(e) => setFuPriority(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "0.4rem 0.5rem",
                            fontSize: "0.8125rem",
                            borderRadius: "0.375rem",
                            border: "1px solid #cbd5e1",
                            backgroundColor: "#fff",
                          }}
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="fu-due-input" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                        Due Date & Time *
                      </label>
                      <input
                        id="fu-due-input"
                        type="datetime-local"
                        value={fuDueAt}
                        onChange={(e) => setFuDueAt(e.target.value)}
                        required
                        style={{
                          width: "100%",
                          padding: "0.4rem 0.5rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #cbd5e1",
                          backgroundColor: "#fff",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>

                    <div>
                      <label htmlFor="fu-notes-input" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                        Notes / Objective
                      </label>
                      <textarea
                        id="fu-notes-input"
                        rows={2}
                        placeholder="Action items, agenda, questions to ask..."
                        value={fuNotes}
                        onChange={(e) => setFuNotes(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "0.4rem 0.5rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #cbd5e1",
                          backgroundColor: "#fff",
                          boxSizing: "border-box",
                          resize: "vertical",
                        }}
                      />
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                      <button
                        type="button"
                        onClick={() => setDrawerAction(null)}
                        style={{
                          padding: "0.375rem 0.75rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #cbd5e1",
                          backgroundColor: "#fff",
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={fuSubmitting || !fuDueAt}
                        style={{
                          padding: "0.375rem 0.875rem",
                          fontSize: "0.8125rem",
                          fontWeight: 600,
                          borderRadius: "0.375rem",
                          border: "none",
                          backgroundColor: fuSubmitting || !fuDueAt ? "#94a3b8" : "#2563eb",
                          color: "#fff",
                          cursor: fuSubmitting || !fuDueAt ? "not-allowed" : "pointer",
                        }}
                      >
                        {fuSubmitting ? "Scheduling..." : "Schedule Follow-Up"}
                      </button>
                    </div>
                  </form>
                )}

                {/* Contextual Tabs Navigation (Strict order: Overview, Activities, Follow-ups, Products, Quotations, History) */}
                <div>
                  <div
                    style={{
                      display: "flex",
                      borderBottom: "2px solid #e2e8f0",
                      marginBottom: "1.25rem",
                      gap: "0.25rem",
                      overflowX: "auto",
                    }}
                  >
                    {[
                      { key: "overview", label: "Overview" },
                      { key: "activities", label: `Activities (${activityTotal || leadActivities.length})` },
                      { key: "followups", label: `Follow-ups (${pendingFollowUps.length})` },
                      { key: "quotations", label: `Quotations (${leadQuotations.length})` },
                      { key: "history", label: "History" },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => {
                          setDrawerTab(tab.key as any);
                          if (selectedLead) {
                            if (tab.key === "quotations") fetchLeadQuotations(selectedLead.id);
                          }
                        }}
                        style={{
                          padding: "0.6rem 0.85rem",
                          fontSize: "0.8125rem",
                          fontWeight: drawerTab === tab.key ? 700 : 500,
                          color: drawerTab === tab.key ? "#2563eb" : "#64748b",
                          borderBottom: drawerTab === tab.key ? "3px solid #2563eb" : "3px solid transparent",
                          backgroundColor: "transparent",
                          borderTop: "none",
                          borderLeft: "none",
                          borderRight: "none",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* TAB 1: OVERVIEW */}
                  {drawerTab === "overview" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                      {/* Linked Company Master Card */}
                      <div
                        style={{
                          background: selectedLead.company_id ? "#f0fdf4" : "#f8fafc",
                          border: `1px solid ${selectedLead.company_id ? "#bbf7d0" : "#e2e8f0"}`,
                          borderRadius: "0.5rem",
                          padding: "1rem",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", color: selectedLead.company_id ? "#15803d" : "#64748b" }}>
                            Linked Company Master
                          </div>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              padding: "0.15rem 0.5rem",
                              borderRadius: "9999px",
                              backgroundColor: selectedLead.company_id ? "#dcfce7" : "#f1f5f9",
                              color: selectedLead.company_id ? "#166534" : "#475569",
                            }}
                          >
                            {selectedLead.company_id ? "Master Linked" : "Unlinked"}
                          </span>
                        </div>

                        {selectedLead.company_id ? (
                          <div style={{ marginTop: "0.5rem" }}>
                            <div style={{ fontSize: "1rem", fontWeight: 700, color: "#0f172a" }}>
                              {selectedLead.company_name || "Named Company Record"}
                            </div>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: "0.5rem",
                                marginTop: "0.5rem",
                                fontSize: "0.8125rem",
                              }}
                            >
                              <div>
                                <span style={{ color: "#64748b", fontSize: "0.75rem" }}>Company ID:</span>
                                <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#334155", marginTop: "0.1rem" }}>
                                  {selectedLead.company_id}
                                </div>
                              </div>
                              <div>
                                <span style={{ color: "#64748b", fontSize: "0.75rem" }}>City / Location:</span>
                                <div style={{ fontWeight: 600, color: "#1e293b", marginTop: "0.1rem" }}>
                                  {selectedLead.company_city || "—"}
                                </div>
                              </div>
                              {selectedLead.company_gstin && (
                                <div style={{ gridColumn: "span 2" }}>
                                  <span style={{ color: "#64748b", fontSize: "0.75rem" }}>Tax / GSTIN:</span>
                                  <div style={{ fontWeight: 600, color: "#1e293b", marginTop: "0.1rem" }}>
                                    {selectedLead.company_gstin}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div style={{ marginTop: "0.5rem", fontSize: "0.8125rem", color: "#64748b" }}>
                            {selectedLead.company_name ? (
                              <span>Snapshot: <strong>{selectedLead.company_name}</strong> (No persistent company master ID linked)</span>
                            ) : (
                              <span>No company record linked to this lead.</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Next Pending Follow-up Card */}
                      <div
                        style={{
                          background: selectedLead.next_pending_follow_up
                            ? (new Date(selectedLead.next_pending_follow_up.due_at) < new Date() ? "#fff1f2" : "#eff6ff")
                            : "#f8fafc",
                          border: `1px solid ${
                            selectedLead.next_pending_follow_up
                              ? (new Date(selectedLead.next_pending_follow_up.due_at) < new Date() ? "#fecdd3" : "#bfdbfe")
                              : "#e2e8f0"
                          }`,
                          borderRadius: "0.5rem",
                          padding: "1rem",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              color: selectedLead.next_pending_follow_up
                                ? (new Date(selectedLead.next_pending_follow_up.due_at) < new Date() ? "#be123c" : "#1d4ed8")
                                : "#64748b",
                            }}
                          >
                            Next Pending Follow-Up
                          </div>
                          {selectedLead.next_pending_follow_up && (
                            <span
                              style={{
                                fontSize: "0.7rem",
                                fontWeight: 700,
                                textTransform: "uppercase",
                                padding: "0.15rem 0.5rem",
                                borderRadius: "9999px",
                                backgroundColor: new Date(selectedLead.next_pending_follow_up.due_at) < new Date() ? "#fee2e2" : "#dbeafe",
                                color: new Date(selectedLead.next_pending_follow_up.due_at) < new Date() ? "#991b1b" : "#1e40af",
                              }}
                            >
                              {new Date(selectedLead.next_pending_follow_up.due_at) < new Date() ? "Overdue" : selectedLead.next_pending_follow_up.follow_up_type}
                            </span>
                          )}
                        </div>

                        {selectedLead.next_pending_follow_up ? (
                          <div style={{ marginTop: "0.5rem" }}>
                            <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#0f172a" }}>
                              {selectedLead.next_pending_follow_up.notes || `${selectedLead.next_pending_follow_up.follow_up_type.toUpperCase()} Follow-up`}
                            </div>
                            <div style={{ fontSize: "0.8125rem", color: "#475569", marginTop: "0.25rem" }}>
                              Due: <strong>{formatDateTime(selectedLead.next_pending_follow_up.due_at)}</strong>
                            </div>
                            <div style={{ marginTop: "0.5rem" }}>
                              <button
                                type="button"
                                onClick={() => setDrawerTab("followups")}
                                style={{
                                  fontSize: "0.75rem",
                                  fontWeight: 600,
                                  color: "#2563eb",
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  cursor: "pointer",
                                  textDecoration: "underline",
                                }}
                              >
                                Manage in Follow-ups tab →
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ marginTop: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "0.8125rem", color: "#64748b" }}>
                              No upcoming follow-up scheduled.
                            </span>
                            {canManageLeads && (
                              <button
                                type="button"
                                onClick={() => setDrawerAction("schedule_followup")}
                                style={{
                                  fontSize: "0.75rem",
                                  fontWeight: 600,
                                  color: "#2563eb",
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  textDecoration: "underline",
                                }}
                              >
                                + Schedule Now
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Ownership & Lifecycle Card */}
                      <div
                        style={{
                          background: selectedLead.assigned_to ? "#f8fafc" : "#fff1f2",
                          border: `1px solid ${selectedLead.assigned_to ? "#e2e8f0" : "#fecdd3"}`,
                          borderRadius: "0.5rem",
                          padding: "1rem",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              color: selectedLead.assigned_to ? "#0f766e" : "#be123c",
                            }}
                          >
                            Ownership & Milestones
                          </div>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              padding: "0.15rem 0.5rem",
                              borderRadius: "9999px",
                              backgroundColor: selectedLead.assigned_to ? "#dcfce7" : "#fee2e2",
                              color: selectedLead.assigned_to ? "#166534" : "#991b1b",
                            }}
                          >
                            {selectedLead.assigned_to ? "Assigned" : "Unassigned"}
                          </span>
                        </div>

                        <div style={{ marginTop: "0.5rem", fontSize: "0.9375rem", fontWeight: 700, color: "#0f172a" }}>
                          {selectedLead.assigned_salesperson_name ? (
                            <span>Assigned to {selectedLead.assigned_salesperson_name}</span>
                          ) : (
                            <span style={{ color: "#be123c" }}>Unassigned</span>
                          )}
                        </div>
                        {selectedLead.assigned_salesperson_email && (
                          <div style={{ fontSize: "0.8125rem", color: "#64748b", marginTop: "0.1rem" }}>
                            {selectedLead.assigned_salesperson_email}
                          </div>
                        )}

                        {!selectedLead.assigned_to && selectedLead.unassigned_reason && (
                          <div style={{ marginTop: "0.4rem", fontSize: "0.8125rem", color: "#b91c1c", lineHeight: 1.35 }}>
                            <strong>Unassigned Reason: </strong>
                            {formatUnassignedReason(selectedLead.unassigned_reason)}
                          </div>
                        )}

                        {/* Lifecycle Milestones */}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: "0.75rem",
                            marginTop: "0.75rem",
                            paddingTop: "0.75rem",
                            borderTop: "1px solid #e2e8f0",
                            fontSize: "0.8125rem",
                          }}
                        >
                          <div>
                            <span style={{ color: "#64748b", fontSize: "0.75rem" }}>Created At:</span>
                            <div style={{ fontWeight: 600, color: "#1e293b", marginTop: "0.1rem" }}>
                              {formatDateTime(selectedLead.created_at)}
                            </div>
                          </div>
                          <div>
                            <span style={{ color: "#64748b", fontSize: "0.75rem" }}>Last Updated:</span>
                            <div style={{ fontWeight: 600, color: "#1e293b", marginTop: "0.1rem" }}>
                              {formatDateTime(selectedLead.updated_at)}
                            </div>
                          </div>
                          <div>
                            <span style={{ color: "#64748b", fontSize: "0.75rem" }}>Last Contacted:</span>
                            <div style={{ fontWeight: 600, color: "#1e293b", marginTop: "0.1rem" }}>
                              {selectedLead.last_contacted_at ? formatDateTime(selectedLead.last_contacted_at) : "Never"}
                            </div>
                          </div>
                          <div>
                            <span style={{ color: "#64748b", fontSize: "0.75rem" }}>Next Follow-Up:</span>
                            <div style={{ fontWeight: 600, color: "#1e293b", marginTop: "0.1rem" }}>
                              {selectedLead.next_follow_up_at ? formatDateTime(selectedLead.next_follow_up_at) : "None scheduled"}
                            </div>
                          </div>
                          {selectedLead.won_at && (
                            <div style={{ gridColumn: "span 2", color: "#15803d", fontWeight: 600 }}>
                              Won on {formatDateTime(selectedLead.won_at)}
                            </div>
                          )}
                          {selectedLead.lost_at && (
                            <div style={{ gridColumn: "span 2", color: "#b91c1c", fontSize: "0.8125rem" }}>
                              <strong>Lost: </strong> {formatDateTime(selectedLead.lost_at)}
                              {selectedLead.lost_reason && <span> — Reason: {selectedLead.lost_reason}</span>}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Lead Attributes */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.875rem", fontSize: "0.8125rem" }}>
                        <div>
                          <span style={{ color: "#64748b" }}>Contact Phone:</span>
                          <div style={{ fontWeight: 600, color: "#0f172a", marginTop: "0.15rem" }}>
                            {selectedLead.original_phone}
                          </div>
                        </div>
                        <div>
                          <span style={{ color: "#64748b" }}>Email Address:</span>
                          <div style={{ fontWeight: 600, color: "#0f172a", marginTop: "0.15rem" }}>
                            {selectedLead.email || "—"}
                          </div>
                        </div>
                        <div>
                          <span style={{ color: "#64748b" }}>Pipeline:</span>
                          <div style={{ fontWeight: 600, color: "#0f172a", marginTop: "0.15rem" }}>
                            {selectedLead.pipeline_name || "—"}
                          </div>
                        </div>
                        <div>
                          <span style={{ color: "#64748b" }}>Current Stage:</span>
                          <div style={{ fontWeight: 600, color: "#0f172a", marginTop: "0.15rem" }}>
                            {selectedLead.stage_name || "—"}
                          </div>
                        </div>
                        <div>
                          <span style={{ color: "#64748b" }}>Campaign:</span>
                          <div style={{ fontWeight: 600, color: "#0f172a", marginTop: "0.15rem" }}>
                            {selectedLead.campaign || "—"}
                          </div>
                        </div>
                        <div>
                          <span style={{ color: "#64748b" }}>Source Type:</span>
                          <div style={{ fontWeight: 600, color: "#0f172a", marginTop: "0.15rem" }}>
                            {selectedLead.source_type}
                          </div>
                        </div>
                        <div>
                          <span style={{ color: "#64748b" }}>Priority:</span>
                          <div style={{ marginTop: "0.2rem" }}>
                            <select
                              value={(selectedLead.priority || "medium").toLowerCase()}
                              disabled={!canManageLeads && !isSuperAdmin}
                              onChange={async (e) => {
                                const newPri = e.target.value;
                                try {
                                  await apiPatch(`/api/v1/crm/leads/${selectedLead.id}`, { priority: newPri });
                                  showToast(`Priority updated to ${newPri}!`, "success");
                                  refreshSelectedLead(selectedLead.id);
                                  fetchLeads();
                                  if (activeTab === "kanban" && kanbanPipelineId) {
                                    fetchKanbanData(kanbanPipelineId);
                                  }
                                } catch (err: any) {
                                  showToast(errorMessage(err) || "Failed to update priority.", "error");
                                }
                              }}
                              style={{
                                padding: "0.25rem 0.5rem",
                                fontSize: "0.8125rem",
                                fontWeight: 600,
                                borderRadius: "0.25rem",
                                border: "1px solid #cbd5e1",
                                backgroundColor: "#fff",
                                textTransform: "capitalize",
                                cursor: (canManageLeads || isSuperAdmin) ? "pointer" : "not-allowed",
                              }}
                            >
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                              <option value="urgent">Urgent</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <span style={{ color: "#64748b" }}>Lead Status:</span>
                          <div style={{ fontWeight: 600, color: "#0f172a", marginTop: "0.15rem", textTransform: "capitalize" }}>
                            {selectedLead.status.replace("_", " ")}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 2: ACTIVITIES */}
                  {drawerTab === "activities" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                        <div style={{ display: "flex", gap: "0.35rem" }}>
                          {[
                            { key: "all", label: `All (${leadActivities.length})` },
                            { key: "manual", label: `Notes (${leadActivities.filter((a) => !a.is_system_event).length})` },
                            { key: "system", label: `System (${leadActivities.filter((a) => a.is_system_event).length})` },
                          ].map((f) => (
                            <button
                              key={f.key}
                              type="button"
                              onClick={() => setActivityTypeFilter(f.key as any)}
                              style={{
                                padding: "0.25rem 0.6rem",
                                fontSize: "0.75rem",
                                fontWeight: activityTypeFilter === f.key ? 700 : 500,
                                borderRadius: "9999px",
                                border: "1px solid #cbd5e1",
                                backgroundColor: activityTypeFilter === f.key ? "#0f172a" : "#fff",
                                color: activityTypeFilter === f.key ? "#fff" : "#475569",
                                cursor: "pointer",
                              }}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>

                        {canManageLeads && (
                          <button
                            type="button"
                            onClick={() => {
                              setDrawerAction("log_activity");
                              setActError(null);
                            }}
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              color: "#2563eb",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              textDecoration: "underline",
                            }}
                          >
                            + Log Activity
                          </button>
                        )}
                      </div>

                      {loadingActivities ? (
                        <div style={{ fontSize: "0.8125rem", color: "#64748b", padding: "1rem 0" }}>Loading activities...</div>
                      ) : (
                        filteredActivities.length === 0 ? (
                          <div style={{ fontSize: "0.8125rem", color: "#94a3b8", fontStyle: "italic", padding: "1rem 0" }}>
                            No activities recorded for this lead matching filter.
                          </div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                            {filteredActivities.map((act) => (
                                <div
                                  key={act.id}
                                  style={{
                                    borderLeft: `3px solid ${act.is_system_event ? "#64748b" : "#2563eb"}`,
                                    backgroundColor: act.is_system_event ? "#f8fafc" : "#ffffff",
                                    border: "1px solid #e2e8f0",
                                    borderLeftWidth: "3px",
                                    borderLeftColor: act.is_system_event ? "#64748b" : "#2563eb",
                                    borderRadius: "0.375rem",
                                    padding: "0.75rem",
                                    fontSize: "0.8125rem",
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.35rem" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                      <span
                                        style={{
                                          fontSize: "0.65rem",
                                          fontWeight: 700,
                                          textTransform: "uppercase",
                                          padding: "0.1rem 0.35rem",
                                          borderRadius: "0.25rem",
                                          backgroundColor: act.is_system_event ? "#f1f5f9" : "#eff6ff",
                                          color: act.is_system_event ? "#475569" : "#1d4ed8",
                                        }}
                                      >
                                        {act.is_system_event ? "SYSTEM" : "NOTE"}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: "0.65rem",
                                          fontWeight: 600,
                                          textTransform: "uppercase",
                                          padding: "0.1rem 0.35rem",
                                          borderRadius: "0.25rem",
                                          backgroundColor: "#f8fafc",
                                          color: "#64748b",
                                          border: "1px solid #e2e8f0",
                                        }}
                                      >
                                        {act.activity_type.replace("_", " ")}
                                      </span>
                                      <span style={{ fontWeight: 600, color: "#0f172a" }}>
                                        {act.subject}
                                      </span>
                                    </div>
                                    <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                                      {formatDateTime(act.activity_at || act.created_at)}
                                    </span>
                                  </div>

                                  {act.description && (
                                    <div style={{ fontSize: "0.8125rem", color: "#334155", marginTop: "0.35rem", lineHeight: 1.4 }}>
                                      {act.description}
                                    </div>
                                  )}

                                  {act.outcome && (
                                    <div style={{ fontSize: "0.75rem", color: "#059669", marginTop: "0.3rem" }}>
                                      <strong>Outcome: </strong> {act.outcome}
                                    </div>
                                  )}

                                  <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.35rem" }}>
                                    By: <strong>{act.performer_name || "System"}</strong>
                                  </div>
                                </div>
                              ))}

                              {/* Activity Pagination Controls */}
                              {activityTotalPages > 1 && (
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "0.5rem" }}>
                                  <button
                                    type="button"
                                    disabled={activityPage <= 1}
                                    onClick={() => fetchLeadActivities(selectedLead.id, activityPage - 1)}
                                    style={{
                                      padding: "0.3rem 0.6rem",
                                      fontSize: "0.75rem",
                                      borderRadius: "0.25rem",
                                      border: "1px solid #cbd5e1",
                                      backgroundColor: "#fff",
                                      cursor: activityPage <= 1 ? "not-allowed" : "pointer",
                                      opacity: activityPage <= 1 ? 0.5 : 1,
                                    }}
                                  >
                                    Previous
                                  </button>
                                  <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                                    Page {activityPage} of {activityTotalPages} ({activityTotal} items)
                                  </span>
                                  <button
                                    type="button"
                                    disabled={activityPage >= activityTotalPages}
                                    onClick={() => fetchLeadActivities(selectedLead.id, activityPage + 1)}
                                    style={{
                                      padding: "0.3rem 0.6rem",
                                      fontSize: "0.75rem",
                                      borderRadius: "0.25rem",
                                      border: "1px solid #cbd5e1",
                                      backgroundColor: "#fff",
                                      cursor: activityPage >= activityTotalPages ? "not-allowed" : "pointer",
                                      opacity: activityPage >= activityTotalPages ? 0.5 : 1,
                                    }}
                                  >
                                    Next
                                  </button>
                                </div>
                              )}
                            </div>
                        )
                      )}
                    </div>
                  )}

                  {/* TAB 3: FOLLOW-UPS */}
                  {drawerTab === "followups" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h4 style={{ fontSize: "0.875rem", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                          Active Pending Follow-Ups ({pendingFollowUps.length})
                        </h4>
                        {canManageLeads && (
                          <button
                            type="button"
                            onClick={() => {
                              setDrawerAction("schedule_followup");
                              setFuError(null);
                            }}
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              color: "#2563eb",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              textDecoration: "underline",
                            }}
                          >
                            + Schedule Follow-Up
                          </button>
                        )}
                      </div>

                      {loadingPendingFollowUps ? (
                        <div style={{ fontSize: "0.8125rem", color: "#64748b" }}>Loading follow-ups...</div>
                      ) : pendingFollowUps.length === 0 ? (
                        <div style={{ fontSize: "0.8125rem", color: "#94a3b8", fontStyle: "italic" }}>
                          No pending follow-ups scheduled for this lead.
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                          {pendingFollowUps.map((fu) => {
                            const isOverdue = new Date(fu.due_at) < new Date();
                            const isCompleting = completingFollowUpId === fu.id;

                            return (
                              <div
                                key={fu.id}
                                style={{
                                  border: `1px solid ${isOverdue ? "#fecdd3" : "#cbd5e1"}`,
                                  backgroundColor: isOverdue ? "#fff1f2" : "#f8fafc",
                                  borderRadius: "0.5rem",
                                  padding: "0.875rem",
                                  fontSize: "0.8125rem",
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                                  <div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                      <span
                                        style={{
                                          fontSize: "0.7rem",
                                          fontWeight: 700,
                                          textTransform: "uppercase",
                                          padding: "0.1rem 0.35rem",
                                          borderRadius: "0.25rem",
                                          backgroundColor: isOverdue ? "#fee2e2" : "#e0e7ff",
                                          color: isOverdue ? "#991b1b" : "#3730a3",
                                        }}
                                      >
                                        {fu.follow_up_type}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: "0.7rem",
                                          fontWeight: 600,
                                          textTransform: "uppercase",
                                          padding: "0.1rem 0.35rem",
                                          borderRadius: "0.25rem",
                                          backgroundColor:
                                            fu.priority === "urgent" || fu.priority === "high"
                                              ? "#fee2e2"
                                              : fu.priority === "low"
                                              ? "#f1f5f9"
                                              : "#fef3c7",
                                          color:
                                            fu.priority === "urgent" || fu.priority === "high"
                                              ? "#991b1b"
                                              : fu.priority === "low"
                                              ? "#475569"
                                              : "#92400e",
                                        }}
                                      >
                                        {fu.priority}
                                      </span>
                                    </div>
                                    <div style={{ fontWeight: 600, color: "#0f172a", marginTop: "0.35rem" }}>
                                      {fu.notes || `${fu.follow_up_type.toUpperCase()} Follow-up`}
                                    </div>
                                  </div>
                                  <div style={{ textAlign: "right" }}>
                                    <span
                                      style={{
                                        fontSize: "0.75rem",
                                        fontWeight: 600,
                                        color: isOverdue ? "#b91c1c" : "#1e293b",
                                      }}
                                    >
                                      {formatDateTime(fu.due_at)}
                                    </span>
                                    {isOverdue && (
                                      <div style={{ fontSize: "0.7rem", color: "#dc2626", fontWeight: 700 }}>
                                        OVERDUE
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {fu.notes && (
                                  <div style={{ fontSize: "0.8125rem", color: "#475569", marginTop: "0.35rem" }}>
                                    {fu.notes}
                                  </div>
                                )}

                                <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.35rem" }}>
                                  Created by: <strong>{fu.created_by_name || "System"}</strong>
                                </div>

                                {/* Actions / Complete Form */}
                                {canManageLeads && (
                                  <div style={{ marginTop: "0.75rem", paddingTop: "0.5rem", borderTop: "1px solid #e2e8f0" }}>
                                    {isCompleting ? (
                                      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                                        <input
                                          type="text"
                                          placeholder="Enter completion outcome / notes..."
                                          value={completionNotes}
                                          onChange={(e) => setCompletionNotes(e.target.value)}
                                          style={{
                                            padding: "0.35rem 0.5rem",
                                            fontSize: "0.8125rem",
                                            borderRadius: "0.375rem",
                                            border: "1px solid #cbd5e1",
                                          }}
                                        />
                                        <div style={{ display: "flex", gap: "0.35rem", justifyContent: "flex-end" }}>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setCompletingFollowUpId(null);
                                              setCompletionNotes("");
                                            }}
                                            style={{
                                              padding: "0.25rem 0.5rem",
                                              fontSize: "0.75rem",
                                              borderRadius: "0.25rem",
                                              border: "1px solid #cbd5e1",
                                              backgroundColor: "#fff",
                                              cursor: "pointer",
                                            }}
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            type="button"
                                            disabled={completionSubmitting}
                                            onClick={() => handleUpdateFollowUpStatus(fu.id, "completed", completionNotes)}
                                            style={{
                                              padding: "0.25rem 0.6rem",
                                              fontSize: "0.75rem",
                                              fontWeight: 600,
                                              borderRadius: "0.25rem",
                                              border: "none",
                                              backgroundColor: "#16a34a",
                                              color: "#fff",
                                              cursor: completionSubmitting ? "not-allowed" : "pointer",
                                            }}
                                          >
                                            {completionSubmitting ? "Saving..." : "Confirm Complete"}
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div style={{ display: "flex", gap: "0.5rem" }}>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setCompletingFollowUpId(fu.id);
                                            setCompletionNotes("");
                                          }}
                                          style={{
                                            padding: "0.25rem 0.6rem",
                                            fontSize: "0.75rem",
                                            fontWeight: 600,
                                            borderRadius: "0.25rem",
                                            border: "1px solid #86efac",
                                            backgroundColor: "#f0fdf4",
                                            color: "#166534",
                                            cursor: "pointer",
                                          }}
                                        >
                                          ✓ Mark Completed
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleUpdateFollowUpStatus(fu.id, "cancelled")}
                                          style={{
                                            padding: "0.25rem 0.6rem",
                                            fontSize: "0.75rem",
                                            fontWeight: 600,
                                            borderRadius: "0.25rem",
                                            border: "1px solid #fecdd3",
                                            backgroundColor: "#fff1f2",
                                            color: "#991b1b",
                                            cursor: "pointer",
                                          }}
                                        >
                                          ✕ Cancel Follow-Up
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Past Follow-ups History */}
                      <div style={{ marginTop: "1rem" }}>
                        <h4 style={{ fontSize: "0.875rem", fontWeight: 700, color: "#0f172a", marginBottom: "0.5rem" }}>
                          Follow-Up History
                        </h4>
                        {loadingAllFollowUps ? (
                          <div style={{ fontSize: "0.8125rem", color: "#64748b" }}>Loading history...</div>
                        ) : (
                          (() => {
                            const past = allFollowUps.filter((f) => f.status !== "pending");
                            if (past.length === 0) {
                              return (
                                <div style={{ fontSize: "0.8125rem", color: "#94a3b8", fontStyle: "italic" }}>
                                  No completed or cancelled follow-ups yet.
                                </div>
                              );
                            }
                            return (
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                                {past.map((pf) => (
                                  <div
                                    key={pf.id}
                                    style={{
                                      padding: "0.6rem 0.75rem",
                                      border: "1px solid #e2e8f0",
                                      borderRadius: "0.375rem",
                                      backgroundColor: "#f8fafc",
                                      fontSize: "0.8125rem",
                                    }}
                                  >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                        <span
                                          style={{
                                            fontSize: "0.65rem",
                                            fontWeight: 700,
                                            textTransform: "uppercase",
                                            padding: "0.1rem 0.35rem",
                                            borderRadius: "0.25rem",
                                            backgroundColor: pf.status === "completed" ? "#dcfce7" : "#fee2e2",
                                            color: pf.status === "completed" ? "#166534" : "#991b1b",
                                          }}
                                        >
                                          {pf.status}
                                        </span>
                                        <span style={{ fontWeight: 600, color: "#0f172a" }}>
                                          {pf.notes || `${pf.follow_up_type.toUpperCase()} Follow-up`}
                                        </span>
                                      </div>
                                      <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                                        {formatDateTime(pf.due_at)}
                                      </span>
                                    </div>
                                    {pf.completion_notes && (
                                      <div style={{ fontSize: "0.75rem", color: "#059669", marginTop: "0.25rem" }}>
                                        <strong>Notes: </strong> {pf.completion_notes}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            );
                          })()
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 4: QUOTATIONS */}
                  {drawerTab === "quotations" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                      {/* Top Action Bar */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <h4 style={{ fontSize: "0.875rem", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                            Sales Quotations ({leadQuotations.length})
                          </h4>
                          <p style={{ fontSize: "0.75rem", color: "#64748b", margin: "0.15rem 0 0 0" }}>
                            Dedicated sales quotations with decimal-safe calculations and revision snapshots.
                          </p>
                        </div>
                        {canManageLeads && (
                          <button
                            type="button"
                            data-testid="crm-new-quotation-btn"
                            onClick={handleOpenNewQuotationModal}
                            style={{
                              padding: "0.4rem 0.85rem",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              borderRadius: "0.375rem",
                              border: "none",
                              backgroundColor: "#2563eb",
                              color: "#fff",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: "0.35rem",
                            }}
                          >
                            <span>+</span> New Quotation
                          </button>
                        )}
                      </div>

                      {/* PDF Retry Banner if generation failed after save */}
                      {pdfRetryQuotation && (
                        <div
                          data-testid="pdf-retry-banner"
                          style={{
                            marginBottom: "1rem",
                            padding: "0.75rem 1rem",
                            borderRadius: "0.5rem",
                            backgroundColor: "#fffbeb",
                            border: "1px solid #fde68a",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "0.75rem",
                            flexWrap: "wrap",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span style={{ fontSize: "1.1rem" }}>⚠️</span>
                            <div>
                              <strong style={{ fontSize: "0.8125rem", color: "#92400e", display: "block" }}>
                                Quotation saved, but PDF generation failed.
                              </strong>
                              <span style={{ fontSize: "0.75rem", color: "#b45309" }}>
                                Quotation {pdfRetryQuotation.quotationNumber} (v{pdfRetryQuotation.version}) was saved to database. Click Retry to download the PDF without recreating the quotation.
                              </span>
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <button
                              type="button"
                              data-testid="retry-pdf-download-btn"
                              disabled={downloadingPdfKey !== null}
                              onClick={async () => {
                                const ok = await handleDownloadQuotationPdf(
                                  pdfRetryQuotation.id,
                                  pdfRetryQuotation.quotationNumber,
                                  pdfRetryQuotation.version,
                                  "download"
                                );
                                if (ok) {
                                  setPdfRetryQuotation(null);
                                }
                              }}
                              style={{
                                padding: "0.35rem 0.75rem",
                                fontSize: "0.75rem",
                                fontWeight: 700,
                                borderRadius: "0.375rem",
                                border: "1px solid #d97706",
                                backgroundColor: "#f59e0b",
                                color: "#fff",
                                cursor: downloadingPdfKey !== null ? "not-allowed" : "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "0.3rem",
                              }}
                            >
                              <span>📥</span> Retry PDF Download
                            </button>
                            <button
                              type="button"
                              onClick={() => setPdfRetryQuotation(null)}
                              title="Dismiss notification"
                              style={{
                                padding: "0.35rem 0.5rem",
                                fontSize: "0.75rem",
                                borderRadius: "0.375rem",
                                border: "1px solid #cbd5e1",
                                backgroundColor: "#fff",
                                color: "#64748b",
                                cursor: "pointer",
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Quotations List */}
                      {loadingLeadQuotations ? (
                        <div style={{ fontSize: "0.8125rem", color: "#64748b", padding: "1rem", textAlign: "center" }}>
                          Loading sales quotations...
                        </div>
                      ) : leadQuotationsError ? (
                        <div
                          data-testid="crm-quotations-error-container"
                          style={{
                            padding: "2rem 1.5rem",
                            textAlign: "center",
                            backgroundColor: "#fef2f2",
                            border: "1px solid #fecaca",
                            borderRadius: "0.5rem",
                          }}
                        >
                          <div style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>⚠️</div>
                          <h4 style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#991b1b", margin: "0 0 0.25rem 0" }}>
                            Failed to Load Quotations
                          </h4>
                          <p style={{ fontSize: "0.8125rem", color: "#b91c1c", margin: "0 0 0.75rem 0", maxWidth: "420px", marginLeft: "auto", marginRight: "auto" }}>
                            {leadQuotationsError}
                          </p>
                          <button
                            type="button"
                            data-testid="crm-quotations-retry-btn"
                            onClick={() => selectedLead && fetchLeadQuotations(selectedLead.id)}
                            style={{
                              padding: "0.4rem 0.85rem",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              borderRadius: "0.375rem",
                              border: "1px solid #dc2626",
                              backgroundColor: "#dc2626",
                              color: "#fff",
                              cursor: "pointer",
                            }}
                          >
                            Retry
                          </button>
                        </div>
                      ) : leadQuotations.length === 0 ? (
                        <div
                          style={{
                            padding: "2rem 1.5rem",
                            textAlign: "center",
                            backgroundColor: "#f8fafc",
                            border: "1px dashed #cbd5e1",
                            borderRadius: "0.5rem",
                          }}
                        >
                          <div style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>📄</div>
                          <h4 style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#0f172a", margin: "0 0 0.25rem 0" }}>
                            No Quotations Created Yet
                          </h4>
                          <p style={{ fontSize: "0.8125rem", color: "#64748b", margin: 0, maxWidth: "380px", marginLeft: "auto", marginRight: "auto" }}>
                            Generate formal commercial sales quotations with confirmed quantities, explicit unit prices, and GST rates.
                          </p>
                          {canManageLeads && (
                            <button
                              type="button"
                              data-testid="crm-create-first-quotation-btn"
                              onClick={handleOpenNewQuotationModal}
                              style={{
                                marginTop: "0.75rem",
                                padding: "0.4rem 0.85rem",
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                borderRadius: "0.375rem",
                                border: "none",
                                backgroundColor: "#2563eb",
                                color: "#fff",
                                cursor: "pointer",
                              }}
                            >
                              + Create First Quotation
                            </button>
                          )}
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                          {leadQuotations.map((quote) => {
                            const statusColor =
                              quote.status === "draft"
                                ? { bg: "#fef3c7", text: "#92400e" }
                                : quote.status === "sent"
                                ? { bg: "#dbeafe", text: "#1e40af" }
                                : quote.status === "accepted"
                                ? { bg: "#dcfce7", text: "#166534" }
                                : quote.status === "rejected"
                                ? { bg: "#fee2e2", text: "#991b1b" }
                                : { bg: "#f1f5f9", text: "#475569" };

                            return (
                              <div
                                key={quote.id}
                                style={{
                                  backgroundColor: "#fff",
                                  border: "1px solid #e2e8f0",
                                  borderRadius: "0.5rem",
                                  padding: "1rem",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "0.75rem",
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
                                  <div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                      <strong style={{ fontSize: "0.9375rem", color: "#0f172a" }}>
                                        {quote.quotation_number}
                                      </strong>
                                      <span
                                        style={{
                                          fontSize: "0.7rem",
                                          fontWeight: 700,
                                          backgroundColor: "#f1f5f9",
                                          color: "#334155",
                                          padding: "0.1rem 0.4rem",
                                          borderRadius: "9999px",
                                        }}
                                      >
                                        v{quote.version}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: "0.7rem",
                                          fontWeight: 700,
                                          textTransform: "uppercase",
                                          backgroundColor: statusColor.bg,
                                          color: statusColor.text,
                                          padding: "0.15rem 0.5rem",
                                          borderRadius: "9999px",
                                        }}
                                      >
                                        {quote.status}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>
                                      Date: {quote.quotation_date ? quote.quotation_date.slice(0, 10) : "—"}
                                      {quote.valid_until && <span> • Valid until: {quote.valid_until.slice(0, 10)}</span>}
                                    </div>
                                  </div>

                                  <div style={{ textAlign: "right" }}>
                                    <div style={{ fontSize: "1.0625rem", fontWeight: 700, color: "#0f172a" }}>
                                      ₹{Number(quote.total_amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                    <div style={{ fontSize: "0.7rem", color: "#64748b" }}>
                                      Subtotal: ₹{Number(quote.subtotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })} • Tax: ₹{Number(quote.tax_total).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                    </div>
                                  </div>
                                </div>

                                {/* Items overview */}
                                <div style={{ fontSize: "0.75rem", color: "#475569", backgroundColor: "#f8fafc", padding: "0.5rem 0.75rem", borderRadius: "0.375rem" }}>
                                  <strong>{quote.items.length} Line Item{quote.items.length === 1 ? "" : "s"}:</strong>{" "}
                                  {quote.items.map((it) => `${it.product_name} (${it.quantity} ${it.uom})`).join(", ")}
                                </div>

                                {/* Actions row */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #f1f5f9", paddingTop: "0.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
                                  <div style={{ display: "flex", gap: "0.5rem" }}>
                                    <button
                                      type="button"
                                      onClick={() => fetchQuotationDetailAndVersions(quote.id)}
                                      style={{
                                        fontSize: "0.75rem",
                                        fontWeight: 600,
                                        padding: "0.3rem 0.6rem",
                                        borderRadius: "0.25rem",
                                        border: "1px solid #cbd5e1",
                                        backgroundColor: "#fff",
                                        color: "#2563eb",
                                        cursor: "pointer",
                                      }}
                                    >
                                      View Details & History
                                    </button>

                                    <button
                                      type="button"
                                      data-testid={`view-quote-pdf-${quote.id}`}
                                      disabled={downloadingPdfKey === `${quote.id}-${quote.version}-view`}
                                      onClick={() => handleDownloadQuotationPdf(quote.id, quote.quotation_number, quote.version, "view")}
                                      style={{
                                        fontSize: "0.75rem",
                                        fontWeight: 600,
                                        padding: "0.3rem 0.6rem",
                                        borderRadius: "0.25rem",
                                        border: "1px solid #cbd5e1",
                                        backgroundColor: "#f8fafc",
                                        color: "#334155",
                                        cursor: downloadingPdfKey === `${quote.id}-${quote.version}-view` ? "not-allowed" : "pointer",
                                        opacity: downloadingPdfKey === `${quote.id}-${quote.version}-view` ? 0.7 : 1,
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "0.25rem",
                                      }}
                                      title="View quotation PDF in new browser tab"
                                    >
                                      👁️ {downloadingPdfKey === `${quote.id}-${quote.version}-view` ? "Opening..." : "View PDF"}
                                    </button>

                                    <button
                                      type="button"
                                      data-testid={`download-quote-pdf-${quote.id}`}
                                      disabled={downloadingPdfKey === `${quote.id}-${quote.version}-download`}
                                      onClick={() => handleDownloadQuotationPdf(quote.id, quote.quotation_number, quote.version, "download")}
                                      style={{
                                        fontSize: "0.75rem",
                                        fontWeight: 600,
                                        padding: "0.3rem 0.6rem",
                                        borderRadius: "0.25rem",
                                        border: "1px solid #bfdbfe",
                                        backgroundColor: "#eff6ff",
                                        color: "#1d4ed8",
                                        cursor: downloadingPdfKey === `${quote.id}-${quote.version}-download` ? "not-allowed" : "pointer",
                                        opacity: downloadingPdfKey === `${quote.id}-${quote.version}-download` ? 0.7 : 1,
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "0.25rem",
                                      }}
                                    >
                                      📄 {downloadingPdfKey === `${quote.id}-${quote.version}-download` ? "Downloading..." : "Download PDF"}
                                    </button>

                                    <button
                                      type="button"
                                      data-testid={`email-quote-btn-${quote.id}`}
                                      disabled={sharingQuotationKey === `email-${quote.id}`}
                                      onClick={() => handleShareQuotationEmail(quote)}
                                      style={{
                                        fontSize: "0.75rem",
                                        fontWeight: 600,
                                        padding: "0.3rem 0.6rem",
                                        borderRadius: "0.25rem",
                                        border: "1px solid #cbd5e1",
                                        backgroundColor: "#fff",
                                        color: "#0369a1",
                                        cursor: sharingQuotationKey === `email-${quote.id}` ? "not-allowed" : "pointer",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "0.25rem",
                                      }}
                                    >
                                      ✉️ {sharingQuotationKey === `email-${quote.id}` ? "Opening..." : "Email"}
                                    </button>

                                    <button
                                      type="button"
                                      data-testid={`wa-quote-btn-${quote.id}`}
                                      disabled={sharingQuotationKey === `wa-${quote.id}`}
                                      onClick={() => handleShareQuotationWhatsApp(quote)}
                                      style={{
                                        fontSize: "0.75rem",
                                        fontWeight: 600,
                                        padding: "0.3rem 0.6rem",
                                        borderRadius: "0.25rem",
                                        border: "1px solid #bbf7d0",
                                        backgroundColor: "#f0fdf4",
                                        color: "#15803d",
                                        cursor: sharingQuotationKey === `wa-${quote.id}` ? "not-allowed" : "pointer",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "0.25rem",
                                      }}
                                    >
                                      💬 {sharingQuotationKey === `wa-${quote.id}` ? "Opening..." : "WhatsApp"}
                                    </button>

                                    {canManageLeads && (
                                      <button
                                        type="button"
                                        onClick={() => handleOpenEditOrRevisionModal(quote, quote.status !== "draft")}
                                        style={{
                                          fontSize: "0.75rem",
                                          fontWeight: 600,
                                          padding: "0.3rem 0.6rem",
                                          borderRadius: "0.25rem",
                                          border: "1px solid #cbd5e1",
                                          backgroundColor: "#fff",
                                          color: "#334155",
                                          cursor: "pointer",
                                        }}
                                      >
                                        {quote.status === "draft" ? "Edit Draft" : `+ Create Revision (v${quote.version + 1})`}
                                      </button>
                                    )}
                                  </div>

                                  {canManageLeads && (
                                    <div style={{ display: "flex", gap: "0.35rem" }}>
                                      {quote.status === "draft" && (
                                        <button
                                          type="button"
                                          onClick={() => handleQuotationStatusChange(quote.id, "sent")}
                                          style={{
                                            fontSize: "0.7rem",
                                            fontWeight: 600,
                                            padding: "0.25rem 0.5rem",
                                            borderRadius: "0.25rem",
                                            border: "1px solid #bfdbfe",
                                            backgroundColor: "#eff6ff",
                                            color: "#1d4ed8",
                                            cursor: "pointer",
                                          }}
                                        >
                                          Mark Sent
                                        </button>
                                      )}
                                      {quote.status === "sent" && (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => handleQuotationStatusChange(quote.id, "accepted")}
                                            style={{
                                              fontSize: "0.7rem",
                                              fontWeight: 600,
                                              padding: "0.25rem 0.5rem",
                                              borderRadius: "0.25rem",
                                              border: "1px solid #bbf7d0",
                                              backgroundColor: "#f0fdf4",
                                              color: "#15803d",
                                              cursor: "pointer",
                                            }}
                                          >
                                            Mark Accepted
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleQuotationStatusChange(quote.id, "rejected")}
                                            style={{
                                              fontSize: "0.7rem",
                                              fontWeight: 600,
                                              padding: "0.25rem 0.5rem",
                                              borderRadius: "0.25rem",
                                              border: "1px solid #fecdd3",
                                              backgroundColor: "#fff1f2",
                                              color: "#be123c",
                                              cursor: "pointer",
                                            }}
                                          >
                                            Mark Rejected
                                          </button>
                                        </>
                                      )}
                                      {quote.status !== "cancelled" && quote.status !== "accepted" && (
                                        <button
                                          type="button"
                                          onClick={() => handleQuotationStatusChange(quote.id, "cancelled")}
                                          style={{
                                            fontSize: "0.7rem",
                                            padding: "0.25rem 0.5rem",
                                            borderRadius: "0.25rem",
                                            border: "1px solid #e2e8f0",
                                            backgroundColor: "#fff",
                                            color: "#64748b",
                                            cursor: "pointer",
                                          }}
                                        >
                                          Cancel
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 6: HISTORY */}
                  {drawerTab === "history" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                      {/* Section 1: Pipeline Stage Transitions */}
                      <div>
                        <h4 style={{ fontSize: "0.875rem", fontWeight: 700, color: "#0f172a", marginBottom: "0.75rem" }}>
                          Pipeline Stage Transitions ({leadStageHistory.length})
                        </h4>
                        {loadingStageHistory ? (
                          <div style={{ fontSize: "0.8125rem", color: "#64748b" }}>Loading stage transitions...</div>
                        ) : leadStageHistory.length === 0 ? (
                          <div style={{ fontSize: "0.8125rem", color: "#94a3b8", fontStyle: "italic" }}>
                            No pipeline stage transitions recorded for this lead.
                          </div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                            {leadStageHistory.map((st) => (
                              <div
                                key={st.id}
                                style={{
                                  borderLeft: "3px solid #f59e0b",
                                  padding: "0.6rem 0.75rem",
                                  backgroundColor: "#fffbeb",
                                  border: "1px solid #fef3c7",
                                  borderLeftWidth: "3px",
                                  borderLeftColor: "#f59e0b",
                                  borderRadius: "0.375rem",
                                  fontSize: "0.8125rem",
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <div style={{ fontWeight: 600, color: "#0f172a" }}>
                                    {st.from_stage_name ? `${st.from_stage_name} → ` : "Initial Stage → "}
                                    <span style={{ color: "#b45309" }}>{st.to_stage_name}</span>
                                  </div>
                                  <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                                    {formatDateTime(st.transitioned_at)}
                                  </span>
                                </div>
                                {st.transition_reason && (
                                  <div style={{ fontSize: "0.75rem", color: "#475569", marginTop: "0.2rem" }}>
                                    Note: {st.transition_reason}
                                  </div>
                                )}
                                <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>
                                  Changed by: <strong>{st.transitioner_name || "System"}</strong>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Section 2: Ownership Assignment History */}
                      <div>
                        <h4 style={{ fontSize: "0.875rem", fontWeight: 700, color: "#0f172a", marginBottom: "0.75rem" }}>
                          Ownership Assignment History ({leadHistory.length})
                        </h4>
                        {loadingLeadHistory ? (
                          <div style={{ fontSize: "0.8125rem", color: "#64748b" }}>Loading assignment history...</div>
                        ) : leadHistory.length === 0 ? (
                          <div style={{ fontSize: "0.8125rem", color: "#94a3b8", fontStyle: "italic" }}>
                            No ownership assignment changes recorded for this lead.
                          </div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                            {leadHistory.map((h) => (
                              <div
                                key={h.id}
                                style={{
                                  borderLeft: "3px solid #2563eb",
                                  padding: "0.6rem 0.75rem",
                                  backgroundColor: "#f8fafc",
                                  border: "1px solid #e2e8f0",
                                  borderLeftWidth: "3px",
                                  borderLeftColor: "#2563eb",
                                  borderRadius: "0.375rem",
                                  fontSize: "0.8125rem",
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <div style={{ fontWeight: 600, color: "#0f172a" }}>
                                    {h.new_owner_name ? `Assigned to ${h.new_owner_name}` : "Marked Unassigned"}
                                  </div>
                                  <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                                    {formatDateTime(h.created_at)}
                                  </span>
                                </div>
                                <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.15rem" }}>
                                  Method: <strong>{h.assignment_method}</strong> • By:{" "}
                                  <strong>{h.assigned_by_name || "System"}</strong>
                                </div>
                                {h.reason && (
                                  <div style={{ fontSize: "0.75rem", color: "#475569", marginTop: "0.2rem" }}>
                                    Reason: {h.reason}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CHANGE LEAD STAGE MODAL */}
        {changeStageModalOpen && selectedLead && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="change-stage-modal-title"
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15, 23, 42, 0.4)",
              zIndex: 10000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "1rem",
            }}
            onClick={() => {
              if (!stageSubmitting) setChangeStageModalOpen(false);
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: "480px",
                backgroundColor: "#fff",
                borderRadius: "0.75rem",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                padding: "1.5rem",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                id="change-stage-modal-title"
                style={{ fontSize: "1.125rem", fontWeight: 700, color: "#0f172a", margin: "0 0 1rem 0" }}
              >
                Change Lead Stage
              </h3>
              <p style={{ fontSize: "0.875rem", color: "#64748b", margin: "0 0 1.25rem 0" }}>
                Lead: <strong>{selectedLead.name}</strong> ({selectedLead.lead_code})
                <br />
                Pipeline: <strong>{selectedLead.pipeline_name || "—"}</strong>
              </p>

              {stageError && (
                <div style={{ marginBottom: "1rem", fontSize: "0.75rem", color: "#b91c1c", backgroundColor: "#fee2e2", padding: "0.5rem 0.75rem", borderRadius: "0.375rem" }}>
                  {stageError}
                </div>
              )}

              <form onSubmit={handleStageTransition} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div>
                  <label
                    htmlFor="target-stage-select"
                    style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#334155", marginBottom: "0.35rem" }}
                  >
                    Select New Stage *
                  </label>
                  {loadingPipelineStages ? (
                    <div style={{ fontSize: "0.8125rem", color: "#64748b" }}>Loading pipeline stages...</div>
                  ) : (
                    <select
                      id="target-stage-select"
                      value={targetStageId}
                      onChange={(e) => setTargetStageId(e.target.value)}
                      disabled={stageSubmitting}
                      style={{
                        width: "100%",
                        padding: "0.5rem 0.75rem",
                        fontSize: "0.875rem",
                        borderRadius: "0.375rem",
                        border: "1px solid #cbd5e1",
                        backgroundColor: "#fff",
                      }}
                    >
                      <option value="">-- Choose Stage --</option>
                      {pipelineStages
                        .filter((st) => st.is_active !== false || st.id === selectedLead.stage_id)
                        .map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.name} ({st.stage_type.toUpperCase()}) {st.id === selectedLead.stage_id ? "— (Current)" : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="stage-reason-input"
                    style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#334155", marginBottom: "0.35rem" }}
                  >
                    Transition Note / Reason (Optional)
                  </label>
                  <input
                    id="stage-reason-input"
                    type="text"
                    placeholder="e.g. Budget approved, scheduled demo..."
                    value={stageReason}
                    onChange={(e) => setStageReason(e.target.value)}
                    disabled={stageSubmitting}
                    style={{
                      width: "100%",
                      padding: "0.5rem 0.75rem",
                      fontSize: "0.875rem",
                      borderRadius: "0.375rem",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#fff",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                {isTargetStageLost && (
                  <div>
                    <label
                      htmlFor="lost-reason-input"
                      style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#b91c1c", marginBottom: "0.35rem" }}
                    >
                      Lost Reason * (Mandatory for lost stages)
                    </label>
                    <textarea
                      id="lost-reason-input"
                      rows={3}
                      placeholder="e.g. Budget constraints, chose competitor, unresponsive..."
                      value={stageLostReason}
                      onChange={(e) => setStageLostReason(e.target.value)}
                      disabled={stageSubmitting}
                      style={{
                        width: "100%",
                        padding: "0.5rem 0.75rem",
                        fontSize: "0.875rem",
                        borderRadius: "0.375rem",
                        border: stageLostReason.trim().length < 3 ? "1px solid #ef4444" : "1px solid #cbd5e1",
                        backgroundColor: "#fff",
                        boxSizing: "border-box",
                      }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.25rem", fontSize: "0.75rem" }}>
                      <span style={{ color: stageLostReason.trim().length < 3 ? "#ef4444" : "#16a34a" }}>
                        {stageLostReason.trim().length < 3 ? "Minimum 3 characters required" : "Valid reason"}
                      </span>
                      <span style={{ color: "#64748b" }}>{stageLostReason.length} chars</span>
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1rem" }}>
                  <button
                    type="button"
                    onClick={() => setChangeStageModalOpen(false)}
                    disabled={stageSubmitting}
                    style={{
                      padding: "0.5rem 1rem",
                      fontSize: "0.875rem",
                      borderRadius: "0.375rem",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#fff",
                      color: "#334155",
                      cursor: stageSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      stageSubmitting ||
                      !targetStageId ||
                      targetStageId === selectedLead.stage_id ||
                      (isTargetStageLost && stageLostReason.trim().length < 3)
                    }
                    style={{
                      padding: "0.5rem 1.25rem",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      borderRadius: "0.375rem",
                      border: "none",
                      backgroundColor:
                        stageSubmitting ||
                        !targetStageId ||
                        targetStageId === selectedLead.stage_id ||
                        (isTargetStageLost && stageLostReason.trim().length < 3)
                          ? "#94a3b8"
                          : "#2563eb",
                      color: "#fff",
                      cursor:
                        stageSubmitting ||
                        !targetStageId ||
                        targetStageId === selectedLead.stage_id ||
                        (isTargetStageLost && stageLostReason.trim().length < 3)
                          ? "not-allowed"
                          : "pointer",
                    }}
                  >
                    {stageSubmitting ? "Updating Stage..." : "Confirm Stage Change"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* REASSIGN LEAD MODAL */}
        {reassignModalOpen && leadToReassign && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reassign-modal-title"
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15, 23, 42, 0.5)",
              zIndex: 10000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "1rem",
            }}
            onClick={() => setReassignModalOpen(false)}
          >
            <div
              style={{
                width: "100%",
                maxWidth: "560px",
                backgroundColor: "#fff",
                borderRadius: "0.5rem",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div
                style={{
                  padding: "1rem 1.25rem",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: "#f8fafc",
                }}
              >
                <div>
                  <h3 id="reassign-modal-title" style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "#0f172a" }}>
                    Reassign Lead Ownership
                  </h3>
                  <p style={{ margin: "0.15rem 0 0 0", fontSize: "0.8rem", color: "#64748b" }}>
                    Transfer lead to an eligible sales representative with verified workload capacity.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReassignModalOpen(false)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "1.25rem",
                    color: "#94a3b8",
                    cursor: "pointer",
                    padding: "0.25rem",
                    lineHeight: 1,
                  }}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              {/* Modal Body */}
              <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem", maxHeight: "75vh", overflowY: "auto" }}>
                {/* Lead Summary Card */}
                <div
                  style={{
                    padding: "0.85rem 1rem",
                    backgroundColor: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "0.375rem",
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "0.6rem",
                    fontSize: "0.8125rem",
                  }}
                >
                  <div>
                    <span style={{ color: "#64748b", fontSize: "0.75rem" }}>Lead Name:</span>
                    <div style={{ fontWeight: 600, color: "#0f172a" }}>{leadToReassign.name}</div>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", fontSize: "0.75rem" }}>Lead Code:</span>
                    <div style={{ fontWeight: 600, color: "#2563eb", fontFamily: "monospace" }}>{leadToReassign.lead_code}</div>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", fontSize: "0.75rem" }}>Current Owner:</span>
                    <div style={{ fontWeight: 600, color: leadToReassign.assigned_to ? "#0f172a" : "#dc2626" }}>
                      {leadToReassign.assigned_salesperson_name || "Unassigned"}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", fontSize: "0.75rem" }}>Pipeline / Stage:</span>
                    <div style={{ fontWeight: 500, color: "#475569" }}>
                      {leadToReassign.pipeline_name || "—"} / {leadToReassign.stage_name || "—"}
                    </div>
                  </div>
                </div>

                {/* Target Salesperson Select */}
                <div>
                  <label htmlFor="target-salesperson-select" style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#334155", marginBottom: "0.35rem" }}>
                    Target Sales Representative <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <select
                    id="target-salesperson-select"
                    value={targetSalespersonId}
                    onChange={(e) => {
                      setTargetSalespersonId(e.target.value);
                      setReassignError(null);
                    }}
                    style={{
                      width: "100%",
                      padding: "0.55rem 0.75rem",
                      fontSize: "0.875rem",
                      border: "1px solid #cbd5e1",
                      borderRadius: "0.375rem",
                      backgroundColor: "#fff",
                      color: "#0f172a",
                    }}
                  >
                    <option value="">-- Select Sales Representative --</option>
                    {salespeople
                      .filter(
                        (sp) =>
                          ((sp as any).is_active !== false && (sp as any).is_active_user !== false) ||
                          sp.user_id === leadToReassign.assigned_to
                      )
                      .map((sp) => {
                      const isCurrentOwner = sp.user_id === leadToReassign.assigned_to;
                      const capText = sp.max_lead_capacity !== null && sp.max_lead_capacity !== undefined
                        ? `Cap: ${sp.max_lead_capacity} (${sp.remaining_capacity ?? (sp.max_lead_capacity - sp.active_lead_count)} rem)`
                        : "Unlimited";
                      const statusTag = !sp.is_eligible
                        ? " [Not Eligible]"
                        : isCurrentOwner
                        ? " [Current Owner]"
                        : "";
                      return (
                        <option
                          key={sp.user_id}
                          value={sp.user_id}
                          disabled={isCurrentOwner}
                        >
                          {sp.display_name || sp.full_name || sp.username} — Active: {sp.active_lead_count} | {capText}{statusTag}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Target Salesperson Workload / Capacity Card */}
                {selectedTargetSalesperson && (
                  <div
                    style={{
                      padding: "0.85rem 1rem",
                      backgroundColor: selectedTargetSalesperson.is_eligible ? "#eff6ff" : "#fef2f2",
                      border: `1px solid ${selectedTargetSalesperson.is_eligible ? "#bfdbfe" : "#fecaca"}`,
                      borderRadius: "0.375rem",
                      fontSize: "0.8125rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                      <span style={{ fontWeight: 700, color: selectedTargetSalesperson.is_eligible ? "#1e40af" : "#991b1b" }}>
                        {selectedTargetSalesperson.display_name || selectedTargetSalesperson.full_name || selectedTargetSalesperson.username}
                        {selectedTargetSalesperson.department && (
                          <span style={{ fontWeight: 400, color: "#64748b", marginLeft: "0.4rem" }}>
                            ({selectedTargetSalesperson.department})
                          </span>
                        )}
                      </span>
                      <span
                        style={{
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          padding: "0.15rem 0.45rem",
                          borderRadius: "9999px",
                          backgroundColor: selectedTargetSalesperson.is_eligible ? "#dbeafe" : "#fee2e2",
                          color: selectedTargetSalesperson.is_eligible ? "#1e40af" : "#991b1b",
                        }}
                      >
                        {selectedTargetSalesperson.is_eligible ? "Eligible" : "Not Eligible"}
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", marginTop: "0.35rem" }}>
                      <div>
                        <span style={{ color: "#64748b", fontSize: "0.7rem" }}>Active Workload:</span>
                        <div style={{ fontWeight: 700, color: "#0f172a" }}>
                          {selectedTargetSalesperson.active_lead_count} leads
                        </div>
                      </div>
                      <div>
                        <span style={{ color: "#64748b", fontSize: "0.7rem" }}>Configured Capacity:</span>
                        <div style={{ fontWeight: 700, color: "#0f172a" }}>
                          {selectedTargetSalesperson.max_lead_capacity ?? "Unlimited"}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: "#64748b", fontSize: "0.7rem" }}>Remaining:</span>
                        <div
                          style={{
                            fontWeight: 700,
                            color:
                              selectedTargetSalesperson.remaining_capacity !== null &&
                              selectedTargetSalesperson.remaining_capacity !== undefined &&
                              selectedTargetSalesperson.remaining_capacity <= 0
                                ? "#dc2626"
                                : "#16a34a",
                          }}
                        >
                          {selectedTargetSalesperson.remaining_capacity !== null &&
                          selectedTargetSalesperson.remaining_capacity !== undefined
                            ? `${selectedTargetSalesperson.remaining_capacity} left`
                            : "Unlimited"}
                        </div>
                      </div>
                    </div>

                    {selectedTargetSalesperson.ineligibility_reasons && selectedTargetSalesperson.ineligibility_reasons.length > 0 && (
                      <div style={{ marginTop: "0.4rem", color: "#b91c1c", fontSize: "0.75rem" }}>
                        <strong>Ineligibility Note: </strong>
                        {selectedTargetSalesperson.ineligibility_reasons.join(", ")}
                      </div>
                    )}

                    {selectedTargetSalesperson.max_lead_capacity !== null &&
                      selectedTargetSalesperson.max_lead_capacity !== undefined &&
                      selectedTargetSalesperson.remaining_capacity !== null &&
                      selectedTargetSalesperson.remaining_capacity !== undefined &&
                      selectedTargetSalesperson.remaining_capacity <= 0 && (
                        <div
                          style={{
                            marginTop: "0.4rem",
                            padding: "0.4rem 0.6rem",
                            backgroundColor: "#fee2e2",
                            border: "1px solid #fecaca",
                            borderRadius: "0.25rem",
                            color: "#991b1b",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                          }}
                        >
                          ⚠️ Salesperson has reached maximum lead capacity ({selectedTargetSalesperson.active_lead_count} / {selectedTargetSalesperson.max_lead_capacity}). Select another eligible salesperson or adjust capacity limits in Salesperson Configuration.
                        </div>
                    )}
                  </div>
                )}

                {/* Reassignment Reason */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                    <label htmlFor="reassign-reason-input" style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#334155" }}>
                      Reassignment Justification Reason <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: reassignReason.trim().length >= 5 ? "#16a34a" : "#dc2626",
                        fontWeight: 500,
                      }}
                    >
                      {reassignReason.trim().length} / 5 min chars
                    </span>
                  </div>
                  <textarea
                    id="reassign-reason-input"
                    rows={3}
                    value={reassignReason}
                    onChange={(e) => setReassignReason(e.target.value)}
                    placeholder="Enter mandatory reason for lead reassignment (minimum 5 characters)..."
                    style={{
                      width: "100%",
                      padding: "0.6rem 0.75rem",
                      fontSize: "0.875rem",
                      border: "1px solid #cbd5e1",
                      borderRadius: "0.375rem",
                      fontFamily: "inherit",
                      resize: "vertical",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                {/* Error Banner */}
                {reassignError && (
                  <div
                    style={{
                      padding: "0.75rem 1rem",
                      backgroundColor: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: "0.375rem",
                      color: "#b91c1c",
                      fontSize: "0.8125rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    <span>⚠️</span>
                    <div>{reassignError}</div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div
                style={{
                  padding: "0.85rem 1.25rem",
                  borderTop: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.75rem",
                  backgroundColor: "#f8fafc",
                }}
              >
                <button
                  type="button"
                  onClick={() => setReassignModalOpen(false)}
                  disabled={reassigning}
                  style={{
                    padding: "0.5rem 1rem",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    borderRadius: "0.375rem",
                    border: "1px solid #cbd5e1",
                    backgroundColor: "#fff",
                    color: "#475569",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmReassign}
                  disabled={
                    reassigning ||
                    !targetSalespersonId ||
                    reassignReason.trim().length < 5 ||
                    (selectedTargetSalesperson && !selectedTargetSalesperson.is_eligible) ||
                    (selectedTargetSalesperson &&
                      selectedTargetSalesperson.max_lead_capacity !== null &&
                      selectedTargetSalesperson.max_lead_capacity !== undefined &&
                      selectedTargetSalesperson.remaining_capacity !== null &&
                      selectedTargetSalesperson.remaining_capacity !== undefined &&
                      selectedTargetSalesperson.remaining_capacity <= 0)
                  }
                  style={{
                    padding: "0.5rem 1.25rem",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    borderRadius: "0.375rem",
                    border: "none",
                    backgroundColor:
                      !targetSalespersonId ||
                      reassignReason.trim().length < 5 ||
                      (selectedTargetSalesperson && !selectedTargetSalesperson.is_eligible) ||
                      (selectedTargetSalesperson &&
                        selectedTargetSalesperson.max_lead_capacity !== null &&
                        selectedTargetSalesperson.max_lead_capacity !== undefined &&
                        selectedTargetSalesperson.remaining_capacity !== null &&
                        selectedTargetSalesperson.remaining_capacity !== undefined &&
                        selectedTargetSalesperson.remaining_capacity <= 0)
                        ? "#94a3b8"
                        : "#2563eb",
                    color: "#fff",
                    cursor:
                      !targetSalespersonId ||
                      reassignReason.trim().length < 5 ||
                      (selectedTargetSalesperson && !selectedTargetSalesperson.is_eligible) ||
                      (selectedTargetSalesperson &&
                        selectedTargetSalesperson.max_lead_capacity !== null &&
                        selectedTargetSalesperson.max_lead_capacity !== undefined &&
                        selectedTargetSalesperson.remaining_capacity !== null &&
                        selectedTargetSalesperson.remaining_capacity !== undefined &&
                        selectedTargetSalesperson.remaining_capacity <= 0)
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  {reassigning ? "Reassigning..." : "Confirm Reassignment"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MANUAL LEAD CREATION MODAL */}
        {createLeadModalOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-lead-modal-title"
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15, 23, 42, 0.5)",
              zIndex: 10000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "1rem",
            }}
            onClick={() => setCreateLeadModalOpen(false)}
          >
            <div
              style={{
                width: "100%",
                maxWidth: "600px",
                maxHeight: "90vh",
                backgroundColor: "#fff",
                borderRadius: "0.5rem",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <form onSubmit={handleCreateLeadSubmit} style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
                <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #e2e8f0" }}>
                  <h3 id="create-lead-modal-title" style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, color: "#0f172a" }}>
                    Create New CRM Lead
                  </h3>
                  <div style={{ fontSize: "0.8125rem", color: "#64748b", marginTop: "0.25rem" }}>
                    Add a single lead manually with contact validation, duplicate protection, and pipeline assignment.
                  </div>
                </div>

                <div style={{ padding: "1.25rem 1.5rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {createError && (
                    <div
                      role="alert"
                      data-testid="create-lead-error"
                      style={{
                        padding: "0.75rem 1rem",
                        backgroundColor: "#fef2f2",
                        border: "1px solid #fecdd3",
                        borderRadius: "0.375rem",
                        color: "#991b1b",
                        fontSize: "0.8125rem",
                      }}
                    >
                      {createError}
                    </div>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#334155", marginBottom: "0.35rem" }}>
                        Contact Name *
                      </label>
                      <input
                        type="text"
                        required
                        data-testid="create-lead-name"
                        value={createName}
                        onChange={(e) => setCreateName(e.target.value)}
                        placeholder="e.g. John Doe"
                        style={{
                          width: "100%",
                          padding: "0.5rem 0.75rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #cbd5e1",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#334155", marginBottom: "0.35rem" }}>
                        Phone Number *
                      </label>
                      <input
                        type="text"
                        required
                        data-testid="create-lead-phone"
                        value={createPhone}
                        onChange={(e) => setCreatePhone(e.target.value)}
                        placeholder="e.g. 9876543210 or +919876543210"
                        style={{
                          width: "100%",
                          padding: "0.5rem 0.75rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #cbd5e1",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#334155", marginBottom: "0.35rem" }}>
                        Email Address
                      </label>
                      <input
                        type="email"
                        data-testid="create-lead-email"
                        value={createEmail}
                        onChange={(e) => setCreateEmail(e.target.value)}
                        placeholder="e.g. john@example.com"
                        style={{
                          width: "100%",
                          padding: "0.5rem 0.75rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #cbd5e1",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>

                    <div style={{ position: "relative" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                        <label style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#334155" }}>
                          Company Name
                        </label>
                        {createCompanyId && (
                          <span style={{ fontSize: "0.75rem", color: "#16a34a", fontWeight: 600 }}>
                            ✓ Linked to existing company
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        data-testid="create-lead-company"
                        value={createCompany}
                        onChange={(e) => handleCompanyInputChange(e.target.value)}
                        onFocus={() => {
                          if (companySuggestions.length > 0) setShowCompanySuggestions(true);
                        }}
                        placeholder="Search existing company or type new..."
                        style={{
                          width: "100%",
                          padding: "0.5rem 0.75rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: createCompanyId ? "1.5px solid #16a34a" : "1px solid #cbd5e1",
                          boxSizing: "border-box",
                        }}
                      />
                      {showCompanySuggestions && companySuggestions.length > 0 && (
                        <div
                          style={{
                            position: "absolute",
                            top: "100%",
                            left: 0,
                            right: 0,
                            zIndex: 50,
                            backgroundColor: "#fff",
                            border: "1px solid #cbd5e1",
                            borderRadius: "0.375rem",
                            boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)",
                            maxHeight: "180px",
                            overflowY: "auto",
                            marginTop: "2px",
                          }}
                        >
                          <div style={{ padding: "0.375rem 0.75rem", fontSize: "0.7rem", color: "#64748b", textTransform: "uppercase", fontWeight: 700, backgroundColor: "#f8fafc" }}>
                            Existing Companies ({companySuggestions.length})
                          </div>
                          {companySuggestions.map((c) => (
                            <div
                              key={c.id}
                              onClick={() => selectCompanySuggestion(c)}
                              style={{
                                padding: "0.5rem 0.75rem",
                                fontSize: "0.8125rem",
                                cursor: "pointer",
                                borderBottom: "1px solid #f1f5f9",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f0fdf4")}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#fff")}
                            >
                              <div>
                                <strong style={{ color: "#1e293b" }}>{c.company_name}</strong>
                                {c.city_name && <span style={{ color: "#64748b", marginLeft: "0.5rem", fontSize: "0.75rem" }}>({c.city_name})</span>}
                              </div>
                              {c.tax_id_number && (
                                <span style={{ fontSize: "0.7rem", color: "#475569", backgroundColor: "#f1f5f9", padding: "0.125rem 0.375rem", borderRadius: "0.25rem" }}>
                                  {c.tax_id_number}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Ambiguous candidates disambiguation picker */}
                      {ambiguousCandidates && ambiguousCandidates.length > 0 && (
                        <div
                          style={{
                            marginTop: "0.5rem",
                            padding: "0.625rem",
                            backgroundColor: "#fffbeb",
                            border: "1px solid #fde68a",
                            borderRadius: "0.375rem",
                          }}
                        >
                          <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#92400e", marginBottom: "0.35rem" }}>
                            Select Intended Company:
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                            {ambiguousCandidates.map((cand) => (
                              <button
                                key={cand.id}
                                type="button"
                                onClick={() => selectCompanySuggestion(cand)}
                                style={{
                                  textAlign: "left",
                                  padding: "0.375rem 0.5rem",
                                  fontSize: "0.75rem",
                                  backgroundColor: "#fff",
                                  border: "1px solid #fcd34d",
                                  borderRadius: "0.25rem",
                                  cursor: "pointer",
                                  display: "flex",
                                  justifyContent: "space-between",
                                }}
                              >
                                <strong>{cand.company_name}</strong>
                                {cand.tax_id_number && <span style={{ color: "#64748b" }}>GST: {cand.tax_id_number}</span>}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#334155", marginBottom: "0.35rem" }}>
                        Target Pipeline
                      </label>
                      <select
                        data-testid="create-lead-pipeline"
                        value={createPipelineId}
                        onChange={(e) => {
                          setCreatePipelineId(e.target.value);
                          setCreateStageId("");
                        }}
                        style={{
                          width: "100%",
                          padding: "0.5rem 0.75rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #cbd5e1",
                          backgroundColor: "#fff",
                          boxSizing: "border-box",
                        }}
                      >
                        {pipelines.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#334155", marginBottom: "0.35rem" }}>
                        Initial Stage
                      </label>
                      <select
                        data-testid="create-lead-stage"
                        value={createStageId}
                        onChange={(e) => setCreateStageId(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "0.5rem 0.75rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #cbd5e1",
                          backgroundColor: "#fff",
                          boxSizing: "border-box",
                        }}
                      >
                        {createPipelineStages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.stage_type})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#334155", marginBottom: "0.35rem" }}>
                        Priority
                      </label>
                      <select
                        data-testid="create-lead-priority"
                        value={createPriority}
                        onChange={(e) => setCreatePriority(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "0.5rem 0.75rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #cbd5e1",
                          backgroundColor: "#fff",
                          fontWeight: 600,
                          boxSizing: "border-box",
                        }}
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium (Default)</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#334155", marginBottom: "0.35rem" }}>
                        Campaign / Source
                      </label>
                      <input
                        type="text"
                        data-testid="create-lead-campaign"
                        value={createCampaign}
                        onChange={(e) => setCreateCampaign(e.target.value)}
                        placeholder="e.g. Inbound Direct, Referral"
                        style={{
                          width: "100%",
                          padding: "0.5rem 0.75rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #cbd5e1",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  </div>

                  {/* Assignee Selection */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#334155", marginBottom: "0.35rem" }}>
                      Assignee
                    </label>
                    {canManageLeads || isSuperAdmin ? (
                      <select
                        data-testid="create-lead-assigned-to"
                        value={createAssignedTo}
                        onChange={(e) => setCreateAssignedTo(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "0.5rem 0.75rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #cbd5e1",
                          backgroundColor: "#fff",
                          boxSizing: "border-box",
                        }}
                      >
                        <option value="">Leave Unassigned</option>
                        {salespeople
                          .filter((sp) => (sp as any).is_active !== false && (sp as any).is_active_user !== false)
                          .map((sp) => (
                          <option key={sp.user_id} value={sp.user_id}>
                            {sp.display_name || sp.username} ({sp.active_lead_count} active leads)
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div
                        data-testid="create-lead-self-assigned"
                        style={{ padding: "0.5rem 0.75rem", backgroundColor: "#f1f5f9", borderRadius: "0.375rem", fontSize: "0.8125rem", color: "#475569" }}
                      >
                        Self-Assigned (leads created by representatives are automatically assigned to you)
                      </div>
                    )}
                  </div>

                  {/* Initial Notes */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#334155", marginBottom: "0.35rem" }}>
                      Initial Notes / Description
                    </label>
                    <textarea
                      rows={3}
                      data-testid="create-lead-notes"
                      value={createNotes}
                      onChange={(e) => setCreateNotes(e.target.value)}
                      placeholder="Add any initial background or requirements..."
                      style={{
                        width: "100%",
                        padding: "0.5rem 0.75rem",
                        fontSize: "0.8125rem",
                        borderRadius: "0.375rem",
                        border: "1px solid #cbd5e1",
                        resize: "vertical",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>

                <div
                  style={{
                    padding: "0.85rem 1.5rem",
                    borderTop: "1px solid #e2e8f0",
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "0.75rem",
                    backgroundColor: "#f8fafc",
                  }}
                >
                  <button
                    type="button"
                    data-testid="create-lead-cancel-btn"
                    onClick={() => setCreateLeadModalOpen(false)}
                    disabled={createSubmitting}
                    style={{
                      padding: "0.5rem 1rem",
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      borderRadius: "0.375rem",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#fff",
                      color: "#475569",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    data-testid="create-lead-submit-btn"
                    disabled={createSubmitting}
                    style={{
                      padding: "0.5rem 1.25rem",
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      borderRadius: "0.375rem",
                      border: "none",
                      backgroundColor: createSubmitting ? "#94a3b8" : "#059669",
                      color: "#fff",
                      cursor: createSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {createSubmitting ? "Creating Lead..." : "Create Lead"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Embedded CSV Import Wizard Modal */}
        {importModalOpen && (
          <div
            data-testid="crm-import-modal-overlay"
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
              padding: "1rem",
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setImportModalOpen(false);
              }
            }}
          >
            <div
              data-testid="crm-import-modal-container"
              style={{
                backgroundColor: "#fff",
                borderRadius: "0.75rem",
                width: "100%",
                maxWidth: "1280px",
                maxHeight: "92vh",
                overflowY: "auto",
                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
                display: "flex",
                flexDirection: "column",
                position: "relative",
              }}
            >
              <LeadImportPage
                embedded={true}
                onClose={() => setImportModalOpen(false)}
                onSuccess={() => {
                  fetchLeads();
                  const pid = kanbanPipelineId || (pipelines.length > 0 ? pipelines[0].id : "");
                  if (pid) fetchKanbanData(pid);
                }}
              />
            </div>
          </div>
        )}

        {/* CREATE / EDIT / REVISE SALES QUOTATION MODAL */}
        {/* CREATE / EDIT / REVISE SALES QUOTATION MODAL (REBUILT REFERENCE DESIGN) */}
        {showQuotationModal && selectedLead && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="quotation-modal-title"
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15, 23, 42, 0.65)",
              backdropFilter: "blur(4px)",
              zIndex: 10001,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "1rem",
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget && !quoteSaving) {
                setShowQuotationModal(false);
              }
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: "1180px",
                maxHeight: "94vh",
                backgroundColor: "#fff",
                borderRadius: "0.75rem",
                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                border: "1px solid #e2e8f0",
              }}
            >
              {/* Modal Header */}
              <div
                style={{
                  padding: "1.25rem 1.5rem",
                  borderBottom: "1px solid #e2e8f0",
                  backgroundColor: "#f8fafc",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
                  <div>
                    <h3 id="quotation-modal-title" style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                      {editingQuotationId
                        ? isRevisionMode
                          ? `Create Quotation Revision (v${(leadQuotations.find((q) => q.id === editingQuotationId)?.version || 1) + 1})`
                          : "Edit Quotation"
                        : "Create Quotation"}
                    </h3>
                    <div style={{ fontSize: "0.8125rem", color: "#64748b", marginTop: "0.25rem" }}>
                      Authorized CRM Quotation Editor • Linked to Lead & Product Master
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={quoteSaving}
                    onClick={() => setShowQuotationModal(false)}
                    style={{
                      fontSize: "1.25rem",
                      border: "none",
                      background: "none",
                      cursor: quoteSaving ? "not-allowed" : "pointer",
                      color: "#64748b",
                      padding: "0.25rem 0.5rem",
                      borderRadius: "0.25rem",
                    }}
                  >
                    ✕
                  </button>
                </div>

                {/* Warning when customer or company details are genuinely missing */}
                {(!selectedLead.company_name && !selectedLead.company_id && !selectedLead.email && !selectedLead.original_phone && !selectedLead.normalized_phone) && (
                  <div
                    data-testid="quotation-missing-details-warning"
                    style={{
                      backgroundColor: "#fffbeb",
                      border: "1px solid #fde68a",
                      color: "#92400e",
                      padding: "0.625rem 0.875rem",
                      borderRadius: "0.375rem",
                      fontSize: "0.8125rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      marginBottom: "0.75rem",
                    }}
                  >
                    <span>⚠️</span>
                    <div>
                      <strong>Missing Customer Details:</strong> This lead has neither a registered Company Master record nor contact information. The quotation PDF will omit missing company/contact fields cleanly without fabricating placeholders.
                    </div>
                  </div>
                )}

                {/* Section A: Header Fields (Customer, Quotation Number, Version, Currency, Date) */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: "1rem",
                    backgroundColor: "#fff",
                    padding: "0.875rem 1rem",
                    borderRadius: "0.5rem",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  {/* Customer / Company */}
                  <div>
                    <span style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                      Customer / Company
                    </span>
                    <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "#0f172a", marginTop: "0.15rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {selectedLead.company_name || selectedLead.name || "Customer"}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#2563eb", fontWeight: 600 }}>
                      {selectedLead.lead_code} {selectedLead.name ? `(${selectedLead.name})` : ""}
                    </div>
                  </div>

                  {/* Quotation Number */}
                  <div>
                    <span style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                      Quotation Number
                    </span>
                    <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "#0f172a", marginTop: "0.15rem", fontFamily: "monospace" }}>
                      {editingQuotationId
                        ? leadQuotations.find((q) => q.id === editingQuotationId)?.quotation_number || "Draft"
                        : "QTN-PREVIEW (Auto)"}
                    </div>
                    <span style={{ fontSize: "0.7rem", color: "#64748b" }}>
                      {editingQuotationId ? "Existing Record" : "Assigned on save"}
                    </span>
                  </div>

                  {/* Version */}
                  <div>
                    <span style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                      Version
                    </span>
                    <div style={{ marginTop: "0.15rem" }}>
                      <span style={{ display: "inline-block", padding: "0.15rem 0.5rem", backgroundColor: "#eff6ff", color: "#1d4ed8", fontWeight: 700, borderRadius: "0.25rem", fontSize: "0.8125rem" }}>
                        v{isRevisionMode
                          ? (leadQuotations.find((q) => q.id === editingQuotationId)?.version || 1) + 1
                          : editingQuotationId
                          ? leadQuotations.find((q) => q.id === editingQuotationId)?.version || 1
                          : 1}
                      </span>
                    </div>
                  </div>

                  {/* Currency */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: "0.15rem" }}>
                      Currency
                    </label>
                    <select
                      value={quoteCurrency}
                      onChange={(e) => setQuoteCurrency(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "0.35rem 0.5rem",
                        fontSize: "0.8125rem",
                        borderRadius: "0.25rem",
                        border: "1px solid #cbd5e1",
                        backgroundColor: "#fff",
                        fontWeight: 600,
                        color: "#0f172a",
                      }}
                    >
                      <option value="INR">INR (₹ Indian Rupee)</option>
                      <option value="USD">USD ($ US Dollar)</option>
                      <option value="EUR">EUR (€ Euro)</option>
                      <option value="GBP">GBP (£ British Pound)</option>
                      <option value="AED">AED (د.إ UAE Dirham)</option>
                    </select>
                  </div>

                  {/* Quotation Date */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: "0.15rem" }}>
                      Quotation Date
                    </label>
                    <input
                      type="date"
                      value={quoteDate}
                      onChange={(e) => setQuoteDate(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "0.35rem 0.5rem",
                        fontSize: "0.8125rem",
                        borderRadius: "0.25rem",
                        border: "1px solid #cbd5e1",
                        backgroundColor: "#fff",
                        boxSizing: "border-box",
                        color: "#0f172a",
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Scrollable Form Body */}
              <form onSubmit={handleSaveQuotation} style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1 }}>
                <div style={{ padding: "1.25rem 1.5rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                  {/* Revision justification note if in revision mode */}
                  {isRevisionMode && (
                    <div
                      style={{
                        padding: "0.85rem 1rem",
                        backgroundColor: "#eff6ff",
                        border: "1px solid #bfdbfe",
                        borderRadius: "0.375rem",
                      }}
                    >
                      <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 700, color: "#1e40af", marginBottom: "0.25rem" }}>
                        Revision Justification Notes *
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Revised pricing after customer negotiation; updated quantities"
                        value={revisionNotes}
                        onChange={(e) => setRevisionNotes(e.target.value)}
                        required
                        style={{
                          width: "100%",
                          padding: "0.45rem 0.65rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.25rem",
                          border: "1px solid #cbd5e1",
                          backgroundColor: "#fff",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  )}

                  {/* Section C: Product Master Search & Line-Item Table */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <h4 style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                          Product Line Items ({quoteLineItems.length})
                        </h4>
                        <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                          Select products from Product Master catalog. Commercial values (Price, Discount %, Tax %) are entered manually.
                        </span>
                      </div>
                      {quoteLineItems.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setQuoteLineItems([])}
                          style={{
                            fontSize: "0.75rem",
                            color: "#ef4444",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            textDecoration: "underline",
                          }}
                        >
                          Clear all items
                        </button>
                      )}
                    </div>

                    {/* Product Master Search Bar */}
                    <div style={{ position: "relative" }}>
                      <input
                        type="text"
                        placeholder="🔍 Search Product Master by product name or code (e.g. DAR-01849, INH-00758, Ink Cup, Pump...)"
                        value={quoteLineSearch}
                        onFocus={handleFocusProductSearch}
                        onChange={(e) => searchProductsForQuotation(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "0.6rem 0.85rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #2563eb",
                          backgroundColor: "#f8fafc",
                          boxSizing: "border-box",
                        }}
                      />

                      {searchingQuoteProducts && (
                        <div style={{ fontSize: "0.75rem", color: "#2563eb", marginTop: "0.25rem", fontWeight: 500 }}>
                          Searching Product Master catalog...
                        </div>
                      )}

                      {/* Error banner if search failed */}
                      {productSearchError && (
                        <div
                          style={{
                            padding: "0.5rem 0.75rem",
                            backgroundColor: "#fef2f2",
                            border: "1px solid #fecaca",
                            borderRadius: "0.375rem",
                            color: "#b91c1c",
                            fontSize: "0.8125rem",
                            marginTop: "0.35rem",
                          }}
                        >
                          ⚠️ {productSearchError}
                        </div>
                      )}

                      {/* Search Results Dropdown */}
                      {quoteLineSearchResults.length > 0 && (
                        <div
                          style={{
                            position: "absolute",
                            top: "100%",
                            left: 0,
                            right: 0,
                            zIndex: 100,
                            marginTop: "0.25rem",
                            maxHeight: "260px",
                            overflowY: "auto",
                            backgroundColor: "#fff",
                            border: "1px solid #cbd5e1",
                            borderRadius: "0.375rem",
                            boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
                          }}
                        >
                          {quoteLineSearchResults.map((prod) => (
                            <div
                              key={prod.id}
                              onClick={() => handleAddProductToQuotation(prod)}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                padding: "0.6rem 0.85rem",
                                borderBottom: "1px solid #f1f5f9",
                                cursor: "pointer",
                                transition: "background-color 0.15s ease",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#eff6ff")}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#fff")}
                            >
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                  <span
                                    style={{
                                      fontSize: "0.75rem",
                                      fontFamily: "monospace",
                                      fontWeight: 700,
                                      color: "#1d4ed8",
                                      backgroundColor: "#eff6ff",
                                      padding: "0.15rem 0.4rem",
                                      borderRadius: "0.25rem",
                                    }}
                                  >
                                    {prod.product_code}
                                  </span>
                                  <strong style={{ fontSize: "0.875rem", color: "#0f172a" }}>
                                    {prod.product_name}
                                  </strong>
                                  {prod.brand && (
                                    <span style={{ fontSize: "0.75rem", color: "#64748b", backgroundColor: "#f1f5f9", padding: "0.1rem 0.35rem", borderRadius: "0.25rem" }}>
                                      {prod.brand}
                                    </span>
                                  )}
                                  {prod.category && (
                                    <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                                      • {prod.category}
                                    </span>
                                  )}
                                </div>
                                {prod.specification && (
                                  <div style={{ fontSize: "0.75rem", color: "#475569" }}>
                                    {prod.specification}
                                  </div>
                                )}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", flexShrink: 0 }}>
                                {prod.retail_price && (
                                  <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                                    Catalog Ref: ₹{Number(prod.retail_price).toLocaleString("en-IN")}
                                  </span>
                                )}
                                <span
                                  style={{
                                    fontSize: "0.75rem",
                                    fontWeight: 700,
                                    color: "#2563eb",
                                    backgroundColor: "#dbeafe",
                                    padding: "0.25rem 0.6rem",
                                    borderRadius: "0.25rem",
                                  }}
                                >
                                  + Select
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Table Structure: | # | Product Details | Qty | Price | UOM | Discount % | Tax % | Total | Action | */}
                    <div style={{ border: "1px solid #cbd5e1", borderRadius: "0.5rem", overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.8125rem" }}>
                        <thead>
                          <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1px solid #cbd5e1", color: "#475569" }}>
                            <th style={{ padding: "0.6rem 0.5rem", width: "35px", textAlign: "center", fontWeight: 700 }}>#</th>
                            <th style={{ padding: "0.6rem 0.75rem", minWidth: "260px", fontWeight: 700 }}>Product Details</th>
                            <th style={{ padding: "0.6rem 0.5rem", width: "80px", fontWeight: 700 }}>Qty *</th>
                            <th style={{ padding: "0.6rem 0.5rem", width: "120px", fontWeight: 700 }}>Price (₹) *</th>
                            <th style={{ padding: "0.6rem 0.5rem", width: "70px", fontWeight: 700 }}>UOM</th>
                            <th style={{ padding: "0.6rem 0.5rem", width: "95px", fontWeight: 700 }}>Discount %</th>
                            <th style={{ padding: "0.6rem 0.5rem", width: "125px", fontWeight: 700 }}>Tax % *</th>
                            <th style={{ padding: "0.6rem 0.75rem", width: "110px", textAlign: "right", fontWeight: 700 }}>Total (₹)</th>
                            <th style={{ padding: "0.6rem 0.5rem", width: "45px", textAlign: "center", fontWeight: 700 }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {quoteLineItems.length === 0 ? (
                            <tr>
                              <td colSpan={9} style={{ padding: "2rem", textAlign: "center", backgroundColor: "#f8fafc", color: "#64748b" }}>
                                <div style={{ fontSize: "1.25rem", marginBottom: "0.35rem" }}>📦</div>
                                <strong>No product line items added.</strong>
                                <div style={{ fontSize: "0.8125rem", marginTop: "0.25rem" }}>
                                  Type in the search box above to find and select products from Product Master.
                                </div>
                              </td>
                            </tr>
                          ) : (
                            quoteLineItems.map((item, idx) => {
                              const q = typeof item.quantity === "number" ? item.quantity : parseFloat(String(item.quantity)) || 0;
                              const p = typeof item.unit_price === "number" ? item.unit_price : parseFloat(String(item.unit_price)) || 0;
                              const discPct = item.discount_percent === "" || item.discount_percent === undefined ? 0 : Number(item.discount_percent) || 0;
                              const discAmt = (p * discPct) / 100;
                              const lineSub = q * p;
                              const lineDisc = q * discAmt;
                              const lineTaxable = Math.max(0, lineSub - lineDisc);
                              const tr = item.tax_rate === "" || item.tax_rate === undefined ? 0 : Number(item.tax_rate) || 0;
                              const lineTax = (lineTaxable * tr) / 100;
                              const lineTotal = lineTaxable + lineTax;

                              return (
                                <tr key={item.product_id} style={{ borderBottom: idx < quoteLineItems.length - 1 ? "1px solid #e2e8f0" : "none", backgroundColor: idx % 2 === 0 ? "#fff" : "#fafafa" }}>
                                  {/* # */}
                                  <td style={{ padding: "0.6rem 0.5rem", textAlign: "center", color: "#64748b", fontWeight: 600 }}>
                                    {idx + 1}
                                  </td>

                                  {/* Product Details */}
                                  <td style={{ padding: "0.6rem 0.75rem", verticalAlign: "top" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                                      <span
                                        style={{
                                          fontSize: "0.75rem",
                                          fontFamily: "monospace",
                                          fontWeight: 700,
                                          color: "#1d4ed8",
                                          backgroundColor: "#eff6ff",
                                          padding: "0.1rem 0.35rem",
                                          borderRadius: "0.25rem",
                                        }}
                                      >
                                        {item.product_code}
                                      </span>
                                      <strong style={{ fontSize: "0.8125rem", color: "#0f172a" }}>
                                        {item.product_name}
                                      </strong>
                                    </div>
                                    {item.specification && (
                                      <div style={{ fontSize: "0.75rem", color: "#64748b", fontStyle: "italic", marginTop: "0.2rem" }}>
                                        {item.specification}
                                      </div>
                                    )}
                                    <input
                                      type="text"
                                      placeholder="Optional quotation-specific description / notes..."
                                      value={item.description || ""}
                                      onChange={(e) => {
                                        const desc = e.target.value;
                                        setQuoteLineItems((prev) =>
                                          prev.map((it, i) => (i === idx ? { ...it, description: desc } : it))
                                        );
                                      }}
                                      style={{
                                        width: "100%",
                                        marginTop: "0.35rem",
                                        padding: "0.3rem 0.5rem",
                                        fontSize: "0.75rem",
                                        borderRadius: "0.25rem",
                                        border: "1px solid #cbd5e1",
                                        backgroundColor: "#fff",
                                        boxSizing: "border-box",
                                      }}
                                    />
                                  </td>

                                  {/* Qty */}
                                  <td style={{ padding: "0.6rem 0.5rem", verticalAlign: "top" }}>
                                    <input
                                      type="number"
                                      min="1"
                                      step="1"
                                      value={item.quantity}
                                      placeholder="1"
                                      onChange={(e) => {
                                        const raw = e.target.value;
                                        const val = raw === "" ? "" : Math.max(1, parseInt(raw) || 1);
                                        setQuoteLineItems((prev) =>
                                          prev.map((it, i) => (i === idx ? { ...it, quantity: val } : it))
                                        );
                                      }}
                                      style={{
                                        width: "100%",
                                        padding: "0.35rem 0.4rem",
                                        fontSize: "0.8125rem",
                                        borderRadius: "0.25rem",
                                        border: "1px solid #cbd5e1",
                                        textAlign: "center",
                                        boxSizing: "border-box",
                                      }}
                                    />
                                  </td>

                                  {/* Price */}
                                  <td style={{ padding: "0.6rem 0.5rem", verticalAlign: "top" }}>
                                    <input
                                      type="number"
                                      min="0.01"
                                      step="0.01"
                                      value={item.unit_price}
                                      placeholder="Enter price *"
                                      onChange={(e) => {
                                        const raw = e.target.value;
                                        const val = raw === "" ? "" : Math.max(0, parseFloat(raw) || 0);
                                        const pVal = val === "" ? 0 : val;
                                        const dPct = item.discount_percent === "" || item.discount_percent === undefined ? 0 : Number(item.discount_percent) || 0;
                                        const uDisc = Math.round((pVal * (dPct / 100)) * 100) / 100;
                                        setQuoteLineItems((prev) =>
                                          prev.map((it, i) => (i === idx ? { ...it, unit_price: val, unit_discount: uDisc, price_confirmed: true } : it))
                                        );
                                      }}
                                      style={{
                                        width: "100%",
                                        padding: "0.35rem 0.4rem",
                                        fontSize: "0.8125rem",
                                        borderRadius: "0.25rem",
                                        border: (item.unit_price === "" || Number(item.unit_price) <= 0) ? "1px solid #ef4444" : "1px solid #cbd5e1",
                                        backgroundColor: (item.unit_price === "" || Number(item.unit_price) <= 0) ? "#fff5f5" : "#fff",
                                        boxSizing: "border-box",
                                      }}
                                    />
                                    {item.suggested_price > 0 && (
                                      <div style={{ fontSize: "0.65rem", color: "#64748b", marginTop: "0.15rem" }}>
                                        Ref: ₹{item.suggested_price.toLocaleString("en-IN")}
                                      </div>
                                    )}
                                  </td>

                                  {/* UOM */}
                                  <td style={{ padding: "0.6rem 0.5rem", verticalAlign: "top" }}>
                                    <span
                                      style={{
                                        display: "inline-block",
                                        padding: "0.25rem 0.4rem",
                                        backgroundColor: "#f1f5f9",
                                        borderRadius: "0.25rem",
                                        fontSize: "0.75rem",
                                        fontWeight: 600,
                                        color: "#475569",
                                        textAlign: "center",
                                        width: "100%",
                                        boxSizing: "border-box",
                                      }}
                                    >
                                      {item.uom || "NOS"}
                                    </span>
                                  </td>

                                  {/* Discount % */}
                                  <td style={{ padding: "0.6rem 0.5rem", verticalAlign: "top" }}>
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      step="0.1"
                                      value={item.discount_percent ?? ""}
                                      placeholder="0"
                                      onChange={(e) => {
                                        const raw = e.target.value;
                                        const val = raw === "" ? "" : Math.max(0, Math.min(100, parseFloat(raw) || 0));
                                        const numPct = val === "" ? 0 : val;
                                        const pVal = typeof item.unit_price === "number" ? item.unit_price : parseFloat(String(item.unit_price)) || 0;
                                        const uDisc = Math.round((pVal * (numPct / 100)) * 100) / 100;
                                        setQuoteLineItems((prev) =>
                                          prev.map((it, i) => (i === idx ? { ...it, discount_percent: val, unit_discount: uDisc } : it))
                                        );
                                      }}
                                      style={{
                                        width: "100%",
                                        padding: "0.35rem 0.4rem",
                                        fontSize: "0.8125rem",
                                        borderRadius: "0.25rem",
                                        border: "1px solid #cbd5e1",
                                        textAlign: "center",
                                        boxSizing: "border-box",
                                      }}
                                    />
                                    {Number(item.unit_discount) > 0 && (
                                      <div style={{ fontSize: "0.65rem", color: "#16a34a", marginTop: "0.15rem", textAlign: "center" }}>
                                        -₹{Number(item.unit_discount).toFixed(2)}
                                      </div>
                                    )}
                                  </td>

                                  {/* Tax % */}
                                  <td style={{ padding: "0.6rem 0.5rem", verticalAlign: "top" }}>
                                    <select
                                      value={item.tax_rate !== "" ? String(item.tax_rate) : ""}
                                      onChange={(e) => {
                                        const raw = e.target.value;
                                        const val = raw === "" ? "" : parseFloat(raw);
                                        setQuoteLineItems((prev) =>
                                          prev.map((it, i) => (i === idx ? { ...it, tax_rate: val } : it))
                                        );
                                      }}
                                      style={{
                                        width: "100%",
                                        padding: "0.35rem 0.35rem",
                                        fontSize: "0.8125rem",
                                        borderRadius: "0.25rem",
                                        border: item.tax_rate === "" ? "1px solid #ef4444" : "1px solid #cbd5e1",
                                        backgroundColor: item.tax_rate === "" ? "#fff5f5" : "#fff",
                                        boxSizing: "border-box",
                                      }}
                                    >
                                      <option value="">-- Tax * --</option>
                                      <option value="18">18% GST</option>
                                      <option value="12">12% GST</option>
                                      <option value="5">5% GST</option>
                                      <option value="28">28% GST</option>
                                      <option value="0">0% (Exempt)</option>
                                    </select>
                                    {item.catalog_tax_rate !== null && item.catalog_tax_rate !== undefined && (
                                      <div style={{ fontSize: "0.65rem", color: "#64748b", marginTop: "0.15rem" }}>
                                        Ref: {item.catalog_tax_rate}%
                                      </div>
                                    )}
                                  </td>

                                  {/* Total */}
                                  <td style={{ padding: "0.6rem 0.75rem", verticalAlign: "top", textAlign: "right" }}>
                                    <strong style={{ fontSize: "0.875rem", color: "#0f172a" }}>
                                      ₹{lineTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </strong>
                                  </td>

                                  {/* Action */}
                                  <td style={{ padding: "0.6rem 0.5rem", verticalAlign: "top", textAlign: "center" }}>
                                    <button
                                      type="button"
                                      onClick={() => setQuoteLineItems((prev) => prev.filter((_, i) => i !== idx))}
                                      title="Remove item"
                                      style={{
                                        background: "none",
                                        border: "none",
                                        color: "#ef4444",
                                        cursor: "pointer",
                                        fontSize: "0.9rem",
                                        padding: "0.2rem 0.4rem",
                                        borderRadius: "0.25rem",
                                      }}
                                    >
                                      🗑️
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

                  {/* Section D: Notes and Terms & Conditions (2 columns) */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 700, color: "#334155", marginBottom: "0.35rem" }}>
                        Notes (Optional)
                      </label>
                      <textarea
                        rows={3}
                        value={quoteNotes}
                        onChange={(e) => setQuoteNotes(e.target.value)}
                        placeholder="Add client-facing notes or remarks..."
                        style={{
                          width: "100%",
                          padding: "0.5rem 0.65rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #cbd5e1",
                          backgroundColor: "#fff",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 700, color: "#334155", marginBottom: "0.35rem" }}>
                        Terms and Conditions (Optional)
                      </label>
                      <textarea
                        rows={3}
                        value={quoteTerms}
                        onChange={(e) => setQuoteTerms(e.target.value)}
                        placeholder="Enter terms and conditions..."
                        style={{
                          width: "100%",
                          padding: "0.5rem 0.65rem",
                          fontSize: "0.8125rem",
                          borderRadius: "0.375rem",
                          border: "1px solid #cbd5e1",
                          backgroundColor: "#fff",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  </div>

                  {/* Section E: Financial Summary */}
                  {(() => {
                    let totalSub = 0;
                    let totalDisc = 0;
                    let totalTaxable = 0;
                    let totalTax = 0;
                    let grandTotal = 0;

                    quoteLineItems.forEach((it) => {
                      const q = typeof it.quantity === "number" ? it.quantity : parseFloat(String(it.quantity)) || 0;
                      const p = typeof it.unit_price === "number" ? it.unit_price : parseFloat(String(it.unit_price)) || 0;
                      const dPct = it.discount_percent === "" || it.discount_percent === undefined ? 0 : Number(it.discount_percent) || 0;
                      const dAmt = (p * dPct) / 100;
                      const sub = q * p;
                      const disc = q * dAmt;
                      const taxable = Math.max(0, sub - disc);
                      const tr = it.tax_rate === "" || it.tax_rate === undefined ? 0 : Number(it.tax_rate) || 0;
                      const tax = (taxable * tr) / 100;
                      totalSub += sub;
                      totalDisc += disc;
                      totalTaxable += taxable;
                      totalTax += tax;
                      grandTotal += taxable + tax;
                    });

                    return (
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "flex-end",
                          marginTop: "0.5rem",
                        }}
                      >
                        <div
                          style={{
                            width: "100%",
                            maxWidth: "380px",
                            backgroundColor: "#f8fafc",
                            border: "1px solid #cbd5e1",
                            borderRadius: "0.5rem",
                            padding: "0.875rem 1rem",
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.45rem",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", color: "#475569" }}>
                            <span>Subtotal</span>
                            <span>₹{totalSub.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", color: "#16a34a" }}>
                            <span>Discount</span>
                            <span>-₹{totalDisc.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", color: "#475569", borderTop: "1px dashed #cbd5e1", paddingTop: "0.35rem" }}>
                            <span>Taxable Amount</span>
                            <span>₹{totalTaxable.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", color: "#475569" }}>
                            <span>Tax</span>
                            <span>₹{totalTax.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: "1rem",
                              fontWeight: 800,
                              color: "#0f172a",
                              borderTop: "2px solid #cbd5e1",
                              paddingTop: "0.45rem",
                              marginTop: "0.15rem",
                            }}
                          >
                            <span>Grand Total ({quoteCurrency})</span>
                            <span>₹{grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Section F: Modal Footer & Save Button */}
                <div
                  style={{
                    padding: "1rem 1.5rem",
                    borderTop: "1px solid #e2e8f0",
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "0.75rem",
                    backgroundColor: "#f8fafc",
                  }}
                >
                  <button
                    type="button"
                    disabled={quoteSaving}
                    onClick={() => setShowQuotationModal(false)}
                    style={{
                      padding: "0.5rem 1rem",
                      fontSize: "0.875rem",
                      borderRadius: "0.375rem",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#fff",
                      cursor: quoteSaving ? "not-allowed" : "pointer",
                      color: "#475569",
                    }}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={quoteSaving || quoteLineItems.length === 0}
                    style={{
                      padding: "0.5rem 1.25rem",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      borderRadius: "0.375rem",
                      border: "none",
                      backgroundColor: quoteSaving || quoteLineItems.length === 0 ? "#94a3b8" : "#2563eb",
                      color: "#fff",
                      cursor: quoteSaving || quoteLineItems.length === 0 ? "not-allowed" : "pointer",
                    }}
                  >
                    {quoteSaving
                      ? "Saving Draft Quotation..."
                      : editingQuotationId
                      ? isRevisionMode
                        ? "Save New Revision"
                        : "Update Quotation"
                      : "Save Draft Quotation"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* QUOTATION DETAIL & REVISION HISTORY MODAL */}
        {selectedQuotationDetail && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="quotation-detail-title"
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15, 23, 42, 0.6)",
              backdropFilter: "blur(4px)",
              zIndex: 10001,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "1rem",
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setSelectedQuotationDetail(null);
              }
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: "960px",
                maxHeight: "90vh",
                backgroundColor: "#fff",
                borderRadius: "0.75rem",
                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              {/* Header */}
              <div
                style={{
                  padding: "1.25rem 1.5rem",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  backgroundColor: "#f8fafc",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <h3 id="quotation-detail-title" style={{ fontSize: "1.125rem", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                      {selectedQuotationDetail.quotation_number}
                    </h3>
                    <span style={{ fontSize: "0.75rem", fontWeight: 700, backgroundColor: "#f1f5f9", padding: "0.15rem 0.5rem", borderRadius: "9999px" }}>
                      v{selectedQuotationDetail.version}
                    </span>
                    <span style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", padding: "0.15rem 0.5rem", borderRadius: "9999px", backgroundColor: "#dbeafe", color: "#1e40af" }}>
                      {selectedQuotationDetail.status}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "#64748b", marginTop: "0.2rem" }}>
                    Customer: <strong>{selectedQuotationDetail.customer_name_snapshot}</strong>
                    {selectedQuotationDetail.company_name_snapshot && (
                      <span> • Company: <strong>{selectedQuotationDetail.company_name_snapshot}</strong></span>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <button
                    type="button"
                    data-testid="modal-view-quote-pdf"
                    disabled={downloadingPdfKey === `${selectedQuotationDetail.id}-${selectedQuotationDetail.version}-view`}
                    onClick={() => handleDownloadQuotationPdf(selectedQuotationDetail.id, selectedQuotationDetail.quotation_number, selectedQuotationDetail.version, "view")}
                    style={{
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      padding: "0.4rem 0.8rem",
                      borderRadius: "0.375rem",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#f8fafc",
                      color: "#334155",
                      cursor: downloadingPdfKey === `${selectedQuotationDetail.id}-${selectedQuotationDetail.version}-view` ? "not-allowed" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                    }}
                    title="View quotation PDF in new browser tab"
                  >
                    👁️ {downloadingPdfKey === `${selectedQuotationDetail.id}-${selectedQuotationDetail.version}-view` ? "Opening..." : "View PDF"}
                  </button>

                  <button
                    type="button"
                    data-testid="modal-download-quote-pdf"
                    disabled={downloadingPdfKey === `${selectedQuotationDetail.id}-${selectedQuotationDetail.version}-download`}
                    onClick={() => handleDownloadQuotationPdf(selectedQuotationDetail.id, selectedQuotationDetail.quotation_number, selectedQuotationDetail.version, "download")}
                    style={{
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      padding: "0.4rem 0.8rem",
                      borderRadius: "0.375rem",
                      border: "1px solid #bfdbfe",
                      backgroundColor: "#eff6ff",
                      color: "#1d4ed8",
                      cursor: downloadingPdfKey === `${selectedQuotationDetail.id}-${selectedQuotationDetail.version}-download` ? "not-allowed" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                    }}
                  >
                    📄 {downloadingPdfKey === `${selectedQuotationDetail.id}-${selectedQuotationDetail.version}-download` ? "Downloading..." : `Download PDF (v${selectedQuotationDetail.version})`}
                  </button>

                  <button
                    type="button"
                    data-testid="modal-email-quote-btn"
                    disabled={sharingQuotationKey === `email-${selectedQuotationDetail.id}`}
                    onClick={() => handleShareQuotationEmail(selectedQuotationDetail)}
                    style={{
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      padding: "0.4rem 0.85rem",
                      borderRadius: "0.375rem",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#fff",
                      color: "#0369a1",
                      cursor: sharingQuotationKey === `email-${selectedQuotationDetail.id}` ? "not-allowed" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                    }}
                  >
                    ✉️ {sharingQuotationKey === `email-${selectedQuotationDetail.id}` ? "Opening..." : "Email"}
                  </button>

                  <button
                    type="button"
                    data-testid="modal-wa-quote-btn"
                    disabled={sharingQuotationKey === `wa-${selectedQuotationDetail.id}`}
                    onClick={() => handleShareQuotationWhatsApp(selectedQuotationDetail)}
                    style={{
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      padding: "0.4rem 0.85rem",
                      borderRadius: "0.375rem",
                      border: "1px solid #bbf7d0",
                      backgroundColor: "#f0fdf4",
                      color: "#15803d",
                      cursor: sharingQuotationKey === `wa-${selectedQuotationDetail.id}` ? "not-allowed" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                    }}
                  >
                    💬 {sharingQuotationKey === `wa-${selectedQuotationDetail.id}` ? "Opening..." : "WhatsApp"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedQuotationDetail(null)}
                    style={{
                      fontSize: "1.25rem",
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      color: "#64748b",
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Sub-tabs: Current Snapshot vs Revision History */}
              <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", backgroundColor: "#fff", padding: "0 1.5rem" }}>
                <button
                  type="button"
                  onClick={() => setActiveQuotationDetailTab("current")}
                  style={{
                    padding: "0.6rem 1rem",
                    fontSize: "0.8125rem",
                    fontWeight: activeQuotationDetailTab === "current" ? 700 : 500,
                    color: activeQuotationDetailTab === "current" ? "#2563eb" : "#64748b",
                    borderBottom: activeQuotationDetailTab === "current" ? "3px solid #2563eb" : "3px solid transparent",
                    background: "none",
                    borderTop: "none",
                    borderLeft: "none",
                    borderRight: "none",
                    cursor: "pointer",
                  }}
                >
                  Current Revision (v{selectedQuotationDetail.version})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveQuotationDetailTab("revisions")}
                  style={{
                    padding: "0.6rem 1rem",
                    fontSize: "0.8125rem",
                    fontWeight: activeQuotationDetailTab === "revisions" ? 700 : 500,
                    color: activeQuotationDetailTab === "revisions" ? "#2563eb" : "#64748b",
                    borderBottom: activeQuotationDetailTab === "revisions" ? "3px solid #2563eb" : "3px solid transparent",
                    background: "none",
                    borderTop: "none",
                    borderLeft: "none",
                    borderRight: "none",
                    cursor: "pointer",
                  }}
                >
                  Archived Revision History ({quotationVersions.length})
                </button>
              </div>

              {/* Body */}
              <div style={{ padding: "1.25rem 1.5rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "1rem", flex: 1 }}>
                {activeQuotationDetailTab === "current" ? (
                  <>
                    {/* Meta info */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem", fontSize: "0.8125rem", backgroundColor: "#f8fafc", padding: "0.75rem 1rem", borderRadius: "0.375rem" }}>
                      <div>
                        <span style={{ color: "#64748b" }}>Date:</span> <strong>{selectedQuotationDetail.quotation_date ? selectedQuotationDetail.quotation_date.slice(0, 10) : "—"}</strong>
                      </div>
                      <div>
                        <span style={{ color: "#64748b" }}>Valid Until:</span> <strong>{selectedQuotationDetail.valid_until ? selectedQuotationDetail.valid_until.slice(0, 10) : "No expiry"}</strong>
                      </div>
                      <div>
                        <span style={{ color: "#64748b" }}>Payment Terms:</span> <strong>{selectedQuotationDetail.payment_terms || "Standard"}</strong>
                      </div>
                      <div>
                        <span style={{ color: "#64748b" }}>Delivery:</span> <strong>{selectedQuotationDetail.delivery_terms || "Standard"}</strong>
                      </div>
                    </div>

                    {/* Line Items Table */}
                    <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "0.375rem" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem", textAlign: "left" }}>
                        <thead>
                          <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                            <th style={{ padding: "0.5rem 0.75rem" }}>#</th>
                            <th style={{ padding: "0.5rem 0.75rem" }}>Product</th>
                            <th style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>Qty</th>
                            <th style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>Unit Price</th>
                            <th style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>Discount</th>
                            <th style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>Tax Rate</th>
                            <th style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedQuotationDetail.items.map((it, idx) => (
                            <tr key={it.id || idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                              <td style={{ padding: "0.5rem 0.75rem", color: "#64748b" }}>{it.position}</td>
                              <td style={{ padding: "0.5rem 0.75rem" }}>
                                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                                  {it.include_images && it.selected_image_url && (
                                    <img
                                      src={it.selected_image_url}
                                      alt={it.product_name}
                                      style={{ width: "36px", height: "36px", objectFit: "cover", borderRadius: "0.25rem", border: "1px solid #e2e8f0" }}
                                    />
                                  )}
                                  <div>
                                    <div style={{ fontWeight: 600, color: "#0f172a" }}>
                                      {it.product_name}
                                    </div>
                                    <div style={{ fontSize: "0.7rem", color: "#64748b" }}>
                                      {it.product_code}
                                    </div>
                                    {it.include_specifications && it.specification && (
                                      <div style={{ fontSize: "0.7rem", color: "#059669", marginTop: "0.15rem" }}>
                                        Specs: {it.specification}
                                      </div>
                                    )}
                                    {it.demo_link && (
                                      <div style={{ fontSize: "0.7rem", marginTop: "0.15rem" }}>
                                        <a href={it.demo_link} target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
                                          📺 Demo Link
                                        </a>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>
                                {it.quantity} {it.uom}
                              </td>
                              <td style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>
                                ₹{Number(it.unit_price).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              </td>
                              <td style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>
                                ₹{Number(it.unit_discount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              </td>
                              <td style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>
                                {it.tax_rate}%
                              </td>
                              <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                                ₹{Number(it.total_amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Financial Summary */}
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <div style={{ width: "300px", display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.8125rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#64748b" }}>Subtotal:</span>
                          <strong>₹{Number(selectedQuotationDetail.subtotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#64748b" }}>Discount Total:</span>
                          <strong>- ₹{Number(selectedQuotationDetail.discount_total).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#64748b" }}>Tax Total (GST):</span>
                          <strong>+ ₹{Number(selectedQuotationDetail.tax_total).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #0f172a", paddingTop: "0.35rem", fontSize: "1rem" }}>
                          <span style={{ fontWeight: 700 }}>Total Amount:</span>
                          <strong style={{ color: "#0f172a" }}>
                            ₹{Number(selectedQuotationDetail.total_amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </strong>
                        </div>
                      </div>
                    </div>

                    {/* Terms */}
                    {selectedQuotationDetail.terms_and_conditions && (
                      <div style={{ fontSize: "0.75rem", color: "#475569", backgroundColor: "#f8fafc", padding: "0.75rem", borderRadius: "0.375rem" }}>
                        <strong>Terms & Conditions:</strong>
                        <div style={{ whiteSpace: "pre-line", marginTop: "0.25rem" }}>
                          {selectedQuotationDetail.terms_and_conditions}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div>
                    {loadingQuotationVersions ? (
                      <div style={{ fontSize: "0.8125rem", color: "#64748b", padding: "1rem", textAlign: "center" }}>
                        Loading revision history...
                      </div>
                    ) : quotationVersions.length === 0 ? (
                      <div
                        style={{
                          padding: "2rem 1.5rem",
                          textAlign: "center",
                          backgroundColor: "#f8fafc",
                          border: "1px dashed #cbd5e1",
                          borderRadius: "0.5rem",
                        }}
                      >
                        <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>📜</div>
                        <h4 style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#0f172a", margin: "0 0 0.25rem 0" }}>
                          No Prior Revisions
                        </h4>
                        <p style={{ fontSize: "0.8125rem", color: "#64748b", margin: 0, maxWidth: "420px", marginLeft: "auto", marginRight: "auto" }}>
                          This quotation is currently on version 1. When a quotation is revised, an immutable historical snapshot of each previous revision is permanently stored here.
                        </p>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        {quotationVersions.map((rev) => {
                          const snapshot = rev.snapshot_data || {};
                          const header = snapshot.header || snapshot;
                          const revItems = snapshot.items || [];

                          return (
                            <div
                              key={rev.id}
                              style={{
                                border: "1px solid #cbd5e1",
                                borderRadius: "0.5rem",
                                padding: "1rem",
                                backgroundColor: "#f8fafc",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                  <strong style={{ fontSize: "0.9375rem", color: "#0f172a" }}>
                                    Revision v{rev.version}
                                  </strong>
                                  <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                                    Archived on {formatDateTime(rev.created_at)}
                                  </span>
                                  {rev.created_by_name && (
                                    <span style={{ fontSize: "0.75rem", color: "#334155" }}>
                                      by {rev.created_by_name}
                                    </span>
                                  )}
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                  <div style={{ fontWeight: 700, color: "#0f172a", fontSize: "0.9375rem" }}>
                                    ₹{Number(header.total_amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                  </div>
                                  <button
                                    type="button"
                                    data-testid={`view-rev-pdf-${rev.id}`}
                                    disabled={downloadingPdfKey === `${selectedQuotationDetail.id}-${rev.version}-view`}
                                    onClick={() => handleDownloadQuotationPdf(selectedQuotationDetail.id, selectedQuotationDetail.quotation_number, rev.version, "view")}
                                    style={{
                                      fontSize: "0.75rem",
                                      fontWeight: 600,
                                      padding: "0.25rem 0.5rem",
                                      borderRadius: "0.25rem",
                                      border: "1px solid #cbd5e1",
                                      backgroundColor: "#f8fafc",
                                      color: "#334155",
                                      cursor: downloadingPdfKey === `${selectedQuotationDetail.id}-${rev.version}-view` ? "not-allowed" : "pointer",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "0.25rem",
                                    }}
                                    title="View revision PDF in new tab"
                                  >
                                    👁️ View
                                  </button>

                                  <button
                                    type="button"
                                    data-testid={`download-rev-pdf-${rev.id}`}
                                    disabled={downloadingPdfKey === `${selectedQuotationDetail.id}-${rev.version}-download`}
                                    onClick={() => handleDownloadQuotationPdf(selectedQuotationDetail.id, selectedQuotationDetail.quotation_number, rev.version, "download")}
                                    style={{
                                      fontSize: "0.75rem",
                                      fontWeight: 600,
                                      padding: "0.25rem 0.5rem",
                                      borderRadius: "0.25rem",
                                      border: "1px solid #bfdbfe",
                                      backgroundColor: "#eff6ff",
                                      color: "#1d4ed8",
                                      cursor: downloadingPdfKey === `${selectedQuotationDetail.id}-${rev.version}-download` ? "not-allowed" : "pointer",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "0.25rem",
                                    }}
                                  >
                                    📄 {downloadingPdfKey === `${selectedQuotationDetail.id}-${rev.version}-download` ? "..." : `PDF v${rev.version}`}
                                  </button>
                                </div>
                              </div>

                              {rev.revision_notes && (
                                <div style={{ fontSize: "0.75rem", color: "#1e40af", backgroundColor: "#eff6ff", padding: "0.35rem 0.6rem", borderRadius: "0.25rem", marginBottom: "0.5rem" }}>
                                  <strong>Revision Notes:</strong> {rev.revision_notes}
                                </div>
                              )}

                              <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                                <strong>Items in Snapshot ({revItems.length}):</strong>{" "}
                                {revItems.map((it: any) => `${it.product_name} (${it.quantity} @ ₹${it.unit_price})`).join(", ")}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div
                style={{
                  padding: "1rem 1.5rem",
                  borderTop: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "flex-end",
                  backgroundColor: "#f8fafc",
                }}
              >
                <button
                  type="button"
                  onClick={() => setSelectedQuotationDetail(null)}
                  style={{
                    padding: "0.5rem 1rem",
                    fontSize: "0.875rem",
                    borderRadius: "0.375rem",
                    border: "1px solid #cbd5e1",
                    backgroundColor: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Email Client Selection Modal */}
        {emailClientModalQuote && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15, 23, 42, 0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10000,
              padding: "1rem",
            }}
            onClick={() => setEmailClientModalQuote(null)}
          >
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "0.75rem",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                maxWidth: "460px",
                width: "100%",
                padding: "1.5rem",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
                <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, color: "#0f172a" }}>
                  Choose Email Client
                </h3>
                <button
                  type="button"
                  onClick={() => setEmailClientModalQuote(null)}
                  data-testid="cancel-email-client-modal"
                  style={{
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    fontSize: "1.25rem",
                    color: "#64748b",
                    padding: "0.25rem",
                  }}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <p style={{ margin: "0 0 1.25rem 0", fontSize: "0.875rem", color: "#64748b" }}>
                Select how you would like to compose the email for quotation{" "}
                <strong style={{ color: "#0f172a" }}>{emailClientModalQuote.quotation_number}</strong>.
                The quotation PDF will be automatically downloaded so you can attach it.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
                <button
                  type="button"
                  data-testid="choose-gmail-btn"
                  onClick={() => {
                    const q = emailClientModalQuote;
                    setEmailClientModalQuote(null);
                    executeShareQuotationEmail(q, "gmail");
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.85rem",
                    padding: "0.85rem 1rem",
                    borderRadius: "0.5rem",
                    border: selectedEmailClient === "gmail" ? "2px solid #2563eb" : "1px solid #e2e8f0",
                    backgroundColor: selectedEmailClient === "gmail" ? "#eff6ff" : "#ffffff",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ fontSize: "1.5rem" }}>🌐</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontWeight: 700, fontSize: "0.9375rem", color: "#0f172a" }}>Gmail (Browser)</span>
                      {selectedEmailClient === "gmail" && (
                        <span style={{ fontSize: "0.6875rem", fontWeight: 700, backgroundColor: "#dbeafe", color: "#1d4ed8", padding: "0.1rem 0.4rem", borderRadius: "9999px" }}>
                          Preferred
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "0.8125rem", color: "#64748b", marginTop: "0.15rem" }}>
                      Open Gmail compose directly in a new browser tab
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  data-testid="choose-default-email-btn"
                  onClick={() => {
                    const q = emailClientModalQuote;
                    setEmailClientModalQuote(null);
                    executeShareQuotationEmail(q, "default");
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.85rem",
                    padding: "0.85rem 1rem",
                    borderRadius: "0.5rem",
                    border: selectedEmailClient === "default" ? "2px solid #2563eb" : "1px solid #e2e8f0",
                    backgroundColor: selectedEmailClient === "default" ? "#eff6ff" : "#ffffff",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ fontSize: "1.5rem" }}>💻</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontWeight: 700, fontSize: "0.9375rem", color: "#0f172a" }}>Default Email App</span>
                      {selectedEmailClient === "default" && (
                        <span style={{ fontSize: "0.6875rem", fontWeight: 700, backgroundColor: "#dbeafe", color: "#1d4ed8", padding: "0.1rem 0.4rem", borderRadius: "9999px" }}>
                          Preferred
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "0.8125rem", color: "#64748b", marginTop: "0.15rem" }}>
                      Open system mail client (Outlook, Apple Mail, Thunderbird, etc.)
                    </div>
                  </div>
                </button>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setEmailClientModalQuote(null)}
                  style={{
                    padding: "0.5rem 1rem",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    borderRadius: "0.375rem",
                    border: "1px solid #cbd5e1",
                    backgroundColor: "#ffffff",
                    color: "#475569",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );

}
